// GitHub data layer: fetches a repository's file tree and source contents.
// Tree comes from the REST API (60 req/hr unauthenticated – we use only 2).
// File contents come from raw.githubusercontent.com, which isn't API-rate-limited.

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

// Every rendered cell is parsed: a file only counts as "used" if we read the file
// that imports it, so a partial scan turns live code into false dead-code reports.
export const MAX_CELLS = 1400;      // max files rendered (and parsed)
const MAX_BYTES = 400_000;          // skip generated/minified giants
const CONCURRENCY = 32;             // raw.githubusercontent.com is a CDN on HTTP/2

/** Accepts "owner/repo", full GitHub URLs, or URLs with /tree/branch paths. */
export function parseRepoInput(input) {
  const s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m =
    s.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/i) ||
    s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

async function api(path, token) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { headers });
  if (res.status === 404) throw new Error('Repository not found (or it is private).');
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const mins = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : '?';
    throw new Error(`GitHub rate limit reached. Try again in ~${mins} min, or add a token.`);
  }
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  return res.json();
}

const IGNORED_DIRS = /(^|\/)(node_modules|vendor|dist|build|out|\.git|\.next|coverage|__pycache__|target|third_party|\.venv|venv)(\/|$)/i;
const IGNORED_FILES = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|otf|mp[34]|wav|zip|gz|tar|pdf|lock|min\.js|map|snap)$/i;

// Tests, fixtures, examples and docs. In big repos they can outnumber product code
// 20:1 (svelte), so they're rendered only if there's room and don't count toward coverage.
const SUPPORT_RE = /(^|\/)(tests?|test-d|testing|__tests__|__mocks__|spec|e2e|fixtures?|examples?|samples?|benchmarks?|benchmarking|playgrounds?|sandbox|docs?|demo)\/|\.(test|spec|bench|stories)\.\w+$/i;
const MANIFEST_RE = /(^|\/)package\.json$/i;
// Keep order when truncating: manifests (they name entry points), product code, support code, the rest.
const rank = (p) => (MANIFEST_RE.test(p) ? 0 : !isCode(p) ? 3 : SUPPORT_RE.test(p) ? 2 : 1);
const isSource = (f) => isParseable(f.path) && f.size < MAX_BYTES && !SUPPORT_RE.test(f.path);

/**
 * Loads repo metadata + recursive tree.
 * @returns {{meta, files: Array<{path,size}>, truncated:boolean, totalFiles:number, eligible:number}}
 *   eligible = product source files in the whole repo, rendered or not
 */
export async function loadRepo({ owner, repo }, token, onProgress) {
  onProgress?.('Sequencing genome…', 0.05);
  const meta = await api(`/repos/${owner}/${repo}`, token);
  onProgress?.('Reading chromosome map…', 0.15);
  const tree = await api(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`,
    token,
  );

  let files = tree.tree
    .filter((n) => n.type === 'blob')
    .filter((n) => !IGNORED_DIRS.test(n.path) && !IGNORED_FILES.test(n.path))
    .map((n) => ({ path: n.path, size: n.size || 0 }));

  const totalFiles = files.length;
  const eligible = files.filter(isSource).length;
  let truncated = tree.truncated;
  if (files.length > MAX_CELLS) {
    files.sort((a, b) => rank(a.path) - rank(b.path) || b.size - a.size);
    files = files.slice(0, MAX_CELLS);
    truncated = true;
  }
  return { meta, files, truncated, totalFiles, eligible, ref: tree.sha };
}

const CODE_RE = /\.(m?[jt]sx?|c[jt]s|py|go|c|cc|cpp|h|hpp|rs|java|kt|rb|php|swift|cs|vue|svelte)$/i;
// package.json and HTML are read too: they reference entry points that nothing else imports.
const PARSEABLE_RE = /\.(m?[jt]sx?|c[jt]s|py|go|c|cc|cpp|h|hpp|vue|svelte|html?)$|(^|\/)package\.json$/i;
export const isCode = (p) => (CODE_RE.test(p) ? 1 : 0);
export const isParseable = (p) => PARSEABLE_RE.test(p);

/**
 * Downloads source for every parseable file with bounded concurrency.
 * @returns {{sources: Map<string,string>, read: number}} read = product source files fetched
 */
export async function loadSources({ owner, repo }, ref, files, onProgress) {
  const targets = files.filter((f) => isParseable(f.path) && f.size < MAX_BYTES);
  const sources = new Map();
  let done = 0, read = 0;
  const queue = [...targets];
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      try {
        const res = await fetch(`${RAW}/${owner}/${repo}/${ref}/${f.path.split('/').map(encodeURIComponent).join('/')}`);
        if (res.ok) { sources.set(f.path, await res.text()); if (isSource(f)) read++; }
      } catch { /* skip unreachable files */ }
      done++;
      onProgress?.(`Tracing veins… ${done}/${targets.length}`, 0.25 + 0.65 * (done / targets.length));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { sources, read };
}
