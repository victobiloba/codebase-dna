// Genome builder: turns a file list + source contents into an organism model.
//   organ  = top-level module/directory
//   cell   = file (size ∝ bytes, colour = language)
//   vein   = internal import/dependency
//   scar   = code file nothing imports (possible dead code)
//   stress = file imported by many others (high-risk hotspot)

export const LANGS = {
  js:     { name: 'JavaScript', hue: 48,  sat: 100, light: 62 },
  ts:     { name: 'TypeScript', hue: 212, sat: 100, light: 66 },
  py:     { name: 'Python',     hue: 152, sat: 70,  light: 58 },
  go:     { name: 'Go',         hue: 188, sat: 90,  light: 60 },
  rs:     { name: 'Rust',       hue: 22,  sat: 92,  light: 60 },
  c:      { name: 'C / C++',    hue: 262, sat: 82,  light: 72 },
  java:   { name: 'Java / Kotlin', hue: 332, sat: 86, light: 66 },
  rb:     { name: 'Ruby',       hue: 356, sat: 82,  light: 64 },
  php:    { name: 'PHP',        hue: 238, sat: 62,  light: 74 },
  swift:  { name: 'Swift',      hue: 12,  sat: 95,  light: 64 },
  cs:     { name: 'C#',         hue: 280, sat: 60,  light: 66 },
  vue:    { name: 'Vue / Svelte', hue: 140, sat: 62, light: 56 },
  style:  { name: 'Styles',     hue: 298, sat: 80,  light: 72 },
  html:   { name: 'HTML',       hue: 14,  sat: 96,  light: 63 },
  docs:   { name: 'Docs',       hue: 220, sat: 22,  light: 74 },
  config: { name: 'Config / Data', hue: 172, sat: 34, light: 60 },
  other:  { name: 'Other',      hue: 220, sat: 10,  light: 56 },
};

const EXT_LANG = [
  [/\.(m?jsx?|cjs)$/i, 'js'], [/\.[mc]?tsx?$/i, 'ts'], [/\.(py|pyi)$/i, 'py'], [/\.go$/i, 'go'],
  [/\.rs$/i, 'rs'], [/\.(c|cc|cpp|cxx|h|hh|hpp)$/i, 'c'], [/\.(java|kt|kts|scala)$/i, 'java'],
  [/\.rb$/i, 'rb'], [/\.php$/i, 'php'], [/\.swift$/i, 'swift'], [/\.cs$/i, 'cs'],
  [/\.(vue|svelte|astro)$/i, 'vue'], [/\.(s?css|less|sass|styl)$/i, 'style'], [/\.html?$/i, 'html'],
  [/\.(md|mdx|rst|txt|adoc)$/i, 'docs'], [/\.(json|ya?ml|toml|ini|xml|env|cfg|lock)$/i, 'config'],
];
export const langOf = (p) => EXT_LANG.find(([re]) => re.test(p))?.[1] || 'other';

// Files loaded by convention rather than by an import. Never reported as dead code.
const ENTRY_RE = new RegExp([
  // entry points
  /(^|\/)(index|main|app|server|cli|__init__|__main__|setup|conftest|manage|wsgi|asgi|mod|lib|build|noxfile|fabfile|gulpfile|gruntfile|jakefile)\.\w+$/,
  // tool configuration (vite.config.ts, .eslintrc.cjs, …)
  /config|(^|\/)\.[\w-]+rc\.\w+$/,
  // tests, stories, type declarations
  /\.(test|spec|e2e|bench|cy|stories|story|d)\.\w+$|(^|\/)(test_[^/]+|[^/]+_test)\.py$/,
  /(^|\/)(tests?|test-d|testing|__tests__|__mocks__|spec|e2e|cypress|playwright|\.storybook|examples?|samples?|scripts?|bin|docs?|benchmarks?|benchmarking|playgrounds?|sandbox|fixtures?|demo)\//,
  // file-system routing and metadata: Next.js, Nuxt, SvelteKit, Remix
  /(^|\/)pages\/|(^|\/)app\/routes\/|(^|\/)\+[\w.@-]+$/,
  /(^|\/)(page|layout|route|loading|error|global-error|not-found|template|default|middleware|instrumentation|robots|sitemap|manifest|icon|apple-icon|opengraph-image|twitter-image)\.[jt]sx?$/,
  // Django / Celery autodiscovery
  /(^|\/)(admin|apps|urls|settings|models|tasks|signals)\.py$|(^|\/)migrations\//,
].map((r) => r.source).join('|'), 'i');

const MAX_ORGANS = 14;
// Only languages with per-file imports can reveal unreferenced files.
// (Go shares code package-wide; C/C++ links .c files via headers.)
const SCAR_LANGS = new Set(['js', 'ts', 'py', 'vue']);

// Standard libraries aren't "nutrients" (external packages). Kept per language because
// names collide: "uuid" and "glob" are Python stdlib but popular npm packages.
// (Go needs no list: stdlib import paths have no dot in their first segment.)
const NODE_BUILTINS = new Set(('assert async_hooks buffer child_process cluster console constants crypto dgram ' +
  'diagnostics_channel dns domain events fs http http2 https inspector module net os path perf_hooks process punycode ' +
  'querystring readline repl stream string_decoder sys timers tls trace_events tty url util v8 vm wasi worker_threads zlib').split(' '));
const PY_STDLIB = new Set(('__future__ abc argparse array ast asyncio atexit base64 bdb binascii bisect builtins bz2 ' +
  'cProfile calendar cmath cmd code codecs codeop collections colorsys compileall concurrent configparser contextlib ' +
  'contextvars copy copyreg csv ctypes curses dataclasses datetime dbm decimal difflib dis doctest email encodings enum ' +
  'errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc getopt getpass gettext glob graphlib ' +
  'grp gzip hashlib heapq hmac html http imaplib importlib inspect io ipaddress itertools json keyword linecache locale ' +
  'logging lzma mailbox marshal math mimetypes mmap modulefinder msvcrt multiprocessing netrc numbers opcode operator ' +
  'optparse os pathlib pdb pickle pickletools pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty ' +
  'pwd py_compile pyclbr pydoc queue quopri random re readline reprlib resource rlcompleter runpy sched secrets select ' +
  'selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 ssl stat statistics string stringprep ' +
  'struct subprocess symtable sys sysconfig syslog tabnanny tarfile tempfile termios textwrap threading time timeit ' +
  'tkinter token tokenize tomllib trace traceback tracemalloc tty types typing unicodedata unittest urllib uuid venv ' +
  'warnings wave weakref webbrowser winreg winsound wsgiref xml xmlrpc zipapp zipfile zipimport zlib zoneinfo ' +
  'distutils imp cgi cgitb asyncore asynchat smtpd telnetlib pipes crypt imghdr').split(' '));

/* ---------------- organ assignment ---------------- */
function organKeyFn(files) {
  const counts = new Map();
  for (const f of files) {
    const top = f.path.includes('/') ? f.path.split('/')[0] : '(root)';
    counts.set(top, (counts.get(top) || 0) + 1);
  }
  // If one directory (e.g. src/ or packages/) dominates, split it one level deeper.
  const [dominant, n] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
  const splitDeep = dominant && dominant !== '(root)' && n / files.length > 0.45;
  return (p) => {
    const parts = p.split('/');
    if (parts.length === 1) return '(root)';
    if (splitDeep && parts[0] === dominant && parts.length > 2) return `${parts[0]}/${parts[1]}`;
    return parts[0];
  };
}

/* ---------------- import extraction ---------------- */
// `import` must be followed by whitespace or "(" so the string 'import' in code (kind === 'import')
// isn't read as an import whose specifier runs to the next quote.
const JS_IMPORT = /(?:import\s[^'"]*?from\s*|import(?:\s+|\s*\(\s*)|export\s[^'"]*?from\s*|require\s*\(\s*)['"]([^'"\n]+)['"]/g;
// Names stay on one line unless parenthesised, or one match swallows the next import lines.
const PY_FROM = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[\w*, \t]+)/gm;
const PY_IMPORT = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm;
const GO_IMPORT_BLOCK = /import\s*\(([\s\S]*?)\)/g;
const GO_IMPORT_LINE = /import\s+(?:\w+\s+)?"([^"]+)"/g;
const C_INCLUDE = /#\s*include\s*"([^"]+)"/g;
const HTML_SCRIPT = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
const MANIFEST_FIELDS = ['main', 'module', 'browser', 'react-native', 'bin', 'exports', 'source'];

/** Every file path a package.json points at (main, bin, nested exports maps…). */
function manifestEntries(src) {
  let pkg;
  try { pkg = JSON.parse(src); } catch { return []; }
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const k of MANIFEST_FIELDS) walk(pkg?.[k]);
  return out;
}
const asRelative = (s) => (/^\.{0,2}\//.test(s) ? s : `./${s}`);
// A conditional exports/imports target: first non-"types" string ({ types, default } → default).
const pickTarget = (v) => (typeof v === 'string' ? v : v && typeof v === 'object'
  ? Object.entries(v).filter(([k]) => k !== 'types').map(([, x]) => pickTarget(x)).find(Boolean) : null);

function joinPath(dir, rel) {
  const out = dir ? dir.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}
const dirOf = (p) => p.split('/').slice(0, -1).join('/');

function buildResolvers(paths, sources) {
  const set = new Set(paths);
  const jsExts = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '.d.ts', '/index.d.ts'];
  const tryJs = (base) => {
    if (!base) { for (const e of jsExts) if (e.startsWith('/') && set.has(e.slice(1))) return e.slice(1); return null; }
    for (const e of jsExts) if (set.has(base + e)) return base + e;
    // TypeScript ESM imports './foo.js' while the file on disk is foo.ts.
    const stem = base.match(/^(.+)\.[mc]?jsx?$/)?.[1];
    if (stem) for (const e of ['.ts', '.tsx', '.mts', '.cts']) if (set.has(stem + e)) return stem + e;
    return null;
  };

  // From each package.json: its "imports" map (for "#compiler/builders" specifiers), and its
  // name, so importing a workspace package (or a library's tests importing itself) stays internal.
  const importMaps = [];
  const workspaces = new Map();
  const pkgDirs = [];
  const declared = new Set(); // every dependency named in any package.json
  for (const [p, src] of sources) {
    if (!/(^|\/)package\.json$/i.test(p)) continue;
    pkgDirs.push(dirOf(p));
    let pkg;
    try { pkg = JSON.parse(src); } catch { continue; }
    for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (pkg?.[k] && typeof pkg[k] === 'object') for (const d of Object.keys(pkg[k])) declared.add(d);
    }
    if (pkg?.imports && typeof pkg.imports === 'object') importMaps.push({ dir: dirOf(p), map: pkg.imports });
    if (typeof pkg?.name === 'string' && !workspaces.has(pkg.name)) workspaces.set(pkg.name, { dir: dirOf(p), pkg });
  }
  importMaps.sort((a, b) => b.dir.length - a.dir.length); // nearest package wins
  pkgDirs.sort((a, b) => b.length - a.length);
  const pkgRoot = (from) => pkgDirs.find((d) => !d || from.startsWith(`${d}/`)) ?? '';
  // Alias / baseUrl imports ("@/lib/x", "$lib/x", "components/Button") are rooted at the
  // importing file's package, or its src/ folder.
  const tryRooted = (from, rest) => {
    const root = pkgRoot(from);
    return tryJs(joinPath(root, `src/${rest}`)) || tryJs(joinPath(root, rest));
  };
  const tryWorkspace = ({ dir, pkg }, sub) => {
    const ex = pkg.exports;
    const map = ex && typeof ex === 'object' && Object.keys(ex).some((k) => k.startsWith('.')) ? ex : { '.': ex };
    const target = pickTarget(map[sub ? `./${sub}` : '.']) ?? (sub ? `./${sub}` : pickTarget(pkg.module ?? pkg.main) ?? './index');
    return tryJs(joinPath(dir, target));
  };
  const trySubpath = (from, spec) => {
    const pkg = importMaps.find((m) => !m.dir || from.startsWith(`${m.dir}/`));
    if (!pkg) return null;
    let target = pickTarget(pkg.map[spec]);
    for (const [k, v] of Object.entries(pkg.map)) {
      if (target) break;
      const [pre, post] = k.split('*');
      if (post != null && spec.startsWith(pre) && spec.endsWith(post) && spec.length >= k.length - 1) {
        target = pickTarget(v)?.replaceAll('*', spec.slice(pre.length, spec.length - post.length));
      }
    }
    return target?.startsWith('.') ? tryJs(joinPath(pkg.dir, target)) : null;
  };

  // Python: every dotted-suffix of every module path -> file
  const pyIndex = new Map();
  for (const p of paths) {
    if (!/\.py$/.test(p)) continue;
    const parts = p.replace(/\.py$/, '').replace(/\/__init__$/, '').split('/');
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(i).join('.');
      if (!pyIndex.has(key)) pyIndex.set(key, p);
    }
  }
  // Go: package directory suffix -> representative (largest) file
  const goDirs = new Map();
  for (const p of paths) if (/\.go$/.test(p) && !/_test\.go$/.test(p)) {
    const d = dirOf(p);
    if (!goDirs.has(d)) goDirs.set(d, p);
  }
  // C: basename / path-suffix lookup
  const cIndex = new Map();
  for (const p of paths) if (/\.(h|hh|hpp|c|cc|cpp)$/.test(p)) {
    const parts = p.split('/');
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(i).join('/');
      if (!cIndex.has(key)) cIndex.set(key, p);
    }
  }

  return {
    js(from, spec) {
      if (spec.startsWith('.')) return { internal: tryJs(joinPath(dirOf(from), spec)) };
      if (spec.startsWith('#')) return { internal: trySubpath(from, spec) }; // never an npm package
      if (/^[@~]\//.test(spec)) return { internal: tryRooted(from, spec.slice(2)) };
      if (/^\$lib(\/|$)/.test(spec)) return { internal: tryRooted(from, `lib${spec.slice(4)}`) };
      if (spec.startsWith('$')) return {}; // framework virtual modules ($app/…, $env/…)
      if (spec.startsWith('/')) return { internal: tryJs(spec.slice(1)) };
      if (/^(node|bun):/.test(spec)) return {}; // runtime built-ins
      const bare = spec.replace(/^(npm|jsr):/, '');
      const pkg = bare.startsWith('@') ? bare.split('/').slice(0, 2).join('/') : bare.split('/')[0];
      if (NODE_BUILTINS.has(pkg)) return {};
      const ws = workspaces.get(pkg);
      if (ws) return { internal: tryWorkspace(ws, bare.slice(pkg.length + 1)) };
      // tsconfig/jsconfig baseUrl ("components/Button"), unless it's a declared dependency.
      const local = !declared.has(pkg) && !bare.startsWith('@') && tryRooted(from, bare);
      return local ? { internal: local } : { external: pkg };
    },
    py(from, mod, names) {
      if (mod.startsWith('.')) {
        const dots = mod.match(/^\.+/)[0].length;
        let base = dirOf(from).split('/').filter(Boolean);
        base = base.slice(0, base.length - (dots - 1));
        const rest = mod.slice(dots).split('.').filter(Boolean);
        const out = [];
        const tryMod = (segs) => {
          const p = [...base, ...segs].join('/');
          if (set.has(p + '.py')) return p + '.py';
          if (set.has(p + '/__init__.py')) return p + '/__init__.py';
          return null;
        };
        for (const n of names) { const r = tryMod([...rest, n]); if (r) out.push(r); }
        if (!out.length) { const r = tryMod(rest); if (r) out.push(r); }
        return { internals: out };
      }
      const out = [];
      for (const n of names) { const r = pyIndex.get(`${mod}.${n}`); if (r) out.push(r); }
      if (!out.length) { const r = pyIndex.get(mod); if (r) out.push(r); }
      const top = mod.split('.')[0];
      return out.length ? { internals: out } : PY_STDLIB.has(top) ? {} : { external: top };
    },
    go(spec) {
      const segs = spec.split('/');
      for (let i = 0; i < segs.length; i++) {
        const r = goDirs.get(segs.slice(i).join('/'));
        if (r) return { internal: r };
      }
      return segs[0].includes('.') ? { external: segs.slice(0, 3).join('/') } : {}; // no dot = Go stdlib
    },
    c(from, spec) {
      const rel = joinPath(dirOf(from), spec);
      if (set.has(rel)) return { internal: rel };
      return { internal: cIndex.get(spec) || cIndex.get(spec.split('/').pop()) || null };
    },
  };
}

function extractDeps(path, src, R) {
  const internal = new Set();
  const external = new Set();
  const add = (r) => {
    if (!r) return;
    if (r.internal && r.internal !== path) internal.add(r.internal);
    r.internals?.forEach((x) => x !== path && internal.add(x));
    if (r.external) external.add(r.external);
  };
  if (/\.(m?[jt]sx?|c[jt]s|vue|svelte)$/i.test(path)) {
    for (const m of src.matchAll(JS_IMPORT)) if (!/\s/.test(m[1])) add(R.js(path, m[1]));
  } else if (/\.py$/i.test(path)) {
    for (const m of src.matchAll(PY_FROM)) {
      const names = m[2].replace(/#.*$/gm, '').replace(/[()]/g, '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter((s) => s && s !== '*');
      add(R.py(path, m[1], names));
    }
    for (const m of src.matchAll(PY_IMPORT)) for (const mod of m[1].split(',')) add(R.py(path, mod.trim(), []));
  } else if (/\.go$/i.test(path)) {
    for (const m of src.matchAll(GO_IMPORT_BLOCK)) for (const s of m[1].matchAll(/"([^"]+)"/g)) add(R.go(s[1]));
    for (const m of src.matchAll(GO_IMPORT_LINE)) add(R.go(m[1]));
  } else if (/\.(c|cc|cpp|h|hh|hpp)$/i.test(path)) {
    for (const m of src.matchAll(C_INCLUDE)) add(R.c(path, m[1]));
  } else if (/(^|\/)package\.json$/i.test(path)) {
    for (const s of manifestEntries(src)) add(R.js(path, asRelative(s)));
  } else if (/\.html?$/i.test(path)) {
    for (const m of src.matchAll(HTML_SCRIPT)) {
      const s = m[1].split(/[?#]/)[0];
      if (/^([a-z][\w+.-]*:|\/\/)/i.test(s)) continue; // CDN / data: scripts
      // "/src/main.ts" is root-relative to the app (often the HTML's folder), else the repo.
      const r = R.js(path, s.startsWith('/') ? `.${s}` : asRelative(s));
      add(r.internal || !s.startsWith('/') ? r : R.js(path, s));
    }
  }
  return { internal, external };
}

/* ---------------- genome assembly ---------------- */
/**
 * @param eligible product source files in the whole repo; read = how many of those we fetched.
 *   Together they say how complete the import graph is (and so how far to trust dead-code flags).
 */
export function buildGenome({ files, sources = new Map(), meta = {}, truncated = false, totalFiles, eligible, read }) {
  const keyOf = organKeyFn(files);
  const R = buildResolvers(files.map((f) => f.path), sources);

  // Organs
  const organMap = new Map();
  for (const f of files) {
    const k = keyOf(f.path);
    if (!organMap.has(k)) organMap.set(k, { name: k, files: 0, bytes: 0 });
    const o = organMap.get(k);
    o.files++; o.bytes += f.size;
  }
  let organs = [...organMap.values()].sort((a, b) => b.files - a.files);
  const keep = new Set(organs.slice(0, MAX_ORGANS - 1).map((o) => o.name));
  const organName = (p) => { const k = keyOf(p); return keep.has(k) || organs.length <= MAX_ORGANS ? k : '(other)'; };
  if (organs.length > MAX_ORGANS) {
    const rest = organs.slice(MAX_ORGANS - 1);
    organs = [...organs.slice(0, MAX_ORGANS - 1), {
      name: '(other)', files: rest.reduce((s, o) => s + o.files, 0), bytes: rest.reduce((s, o) => s + o.bytes, 0),
    }];
  }
  organs.forEach((o, i) => { o.id = i; o.langs = {}; o.cells = []; });
  const organIdx = new Map(organs.map((o) => [o.name, o]));

  // Cells
  const cells = files.map((f, i) => {
    const lang = langOf(f.path);
    const organ = organIdx.get(organName(f.path));
    organ.langs[lang] = (organ.langs[lang] || 0) + 1;
    const cell = {
      id: i, path: f.path, name: f.path.split('/').pop(), size: f.size, lang, organ: organ.id,
      parsed: sources.has(f.path), inDeg: 0, outDeg: 0, deps: [], dependents: [],
    };
    organ.cells.push(i);
    return cell;
  });
  const byPath = new Map(cells.map((c) => [c.path, c]));

  // Veins
  const veins = [];
  const nutrients = new Map();
  for (const [path, src] of sources) {
    const from = byPath.get(path);
    if (!from) continue;
    const { internal, external } = extractDeps(path, src, R);
    for (const t of internal) {
      const to = byPath.get(t);
      if (!to) continue;
      veins.push({ source: from.id, target: to.id, cross: from.organ !== to.organ });
      from.deps.push(to.id); to.dependents.push(from.id);
      from.outDeg++; to.inDeg++;
    }
    for (const e of external) nutrients.set(e, (nutrients.get(e) || 0) + 1);
  }

  // Diagnostics
  const sortedIn = cells.map((c) => c.inDeg).sort((a, b) => b - a);
  const stressThreshold = Math.max(5, sortedIn[Math.floor(cells.length * 0.03)] || 0);
  const hasVeins = veins.length > 4;
  for (const c of cells) {
    c.stressed = c.inDeg >= stressThreshold;
    c.scar = hasVeins && c.parsed && c.inDeg === 0 && SCAR_LANGS.has(c.lang) && !ENTRY_RE.test(c.path);
  }

  const langTotals = {};
  for (const c of cells) langTotals[c.lang] = (langTotals[c.lang] || 0) + 1;
  const parsedCount = cells.filter((c) => c.parsed).length;
  const scars = cells.filter((c) => c.scar);
  const stressed = cells.filter((c) => c.stressed).sort((a, b) => b.inDeg - a.inDeg);
  const crossVeins = veins.filter((v) => v.cross).length;
  for (const c of stressed) c.reach = blastRadius({ cells }, c.id);

  // Vitality score: rewards modular, connected, scar-free organisms.
  // A partial scan misses importers and inflates the scar ratio, so weight it by coverage.
  read ??= parsedCount;
  const coverage = eligible ? Math.min(1, read / eligible) : 1;
  const scarRatio = parsedCount ? scars.length / parsedCount : 0;
  const crossRatio = veins.length ? crossVeins / veins.length : 0;
  const hotspotRatio = cells.length ? stressed.length / cells.length : 0;
  const vitality = Math.round(Math.max(8, Math.min(99,
    100 - scarRatio * 90 * coverage - Math.max(0, crossRatio - 0.35) * 40 - hotspotRatio * 120 - (hasVeins ? 0 : 15))));

  return {
    meta, truncated, totalFiles: totalFiles ?? files.length,
    organs, cells, veins,
    langTotals, nutrients: [...nutrients].sort((a, b) => b[1] - a[1]),
    stats: { parsedCount, read, eligible: eligible ?? read, coverage, scars, stressed, crossVeins, vitality, scarRatio },
  };
}

/** How many files are affected, directly or transitively, if this one changes. */
export function blastRadius(g, id) {
  const seen = new Set([id]), stack = [id];
  while (stack.length) {
    for (const d of g.cells[stack.pop()].dependents) if (!seen.has(d)) { seen.add(d); stack.push(d); }
  }
  return seen.size - 1;
}

/* ---------------- caching ---------------- */
// stats.scars / stats.stressed alias cell objects, so they're dropped and rebuilt
// rather than serialised as detached copies. Pack before the renderer adds layout state.
export function packGenome(g) {
  const { scars, stressed, ...stats } = g.stats;
  return { ...g, stats };
}
export function unpackGenome(g) {
  g.stats.scars = g.cells.filter((c) => c.scar);
  g.stats.stressed = g.cells.filter((c) => c.stressed).sort((a, b) => b.inDeg - a.inDeg);
  return g;
}

/* ---------------- procedural demo organism ---------------- */
export function demoGenome(seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const plan = [
    ['src/core', 'ts', 46], ['src/ui', 'ts', 58], ['src/api', 'ts', 30], ['lib', 'js', 34],
    ['server', 'py', 38], ['styles', 'style', 16], ['docs', 'docs', 18], ['tests', 'ts', 28], ['config', 'config', 10],
  ];
  const words = ['parser', 'router', 'store', 'cache', 'render', 'auth', 'session', 'stream', 'event', 'graph', 'worker', 'pool', 'codec', 'buffer', 'theme', 'layout', 'signal', 'hook', 'schema', 'query', 'model', 'client', 'utils', 'logger', 'queue', 'token', 'vector', 'atlas'];
  const ext = { ts: '.ts', js: '.js', py: '.py', style: '.css', docs: '.md', config: '.json' };
  const files = [];
  const used = new Set();
  for (const [dir, lang, n] of plan) for (let i = 0; i < n; i++) {
    let name; do name = `${pick(words)}${rnd() < 0.4 ? '-' + pick(words) : ''}${ext[lang]}`; while (used.has(dir + name));
    used.add(dir + name);
    files.push({ path: `${dir}/${name}`, size: Math.floor(400 + rnd() ** 2 * 24000) });
  }
  const g = buildGenome({ files, meta: { full_name: 'demo/living-organism', description: 'A procedurally grown sample organism', stargazers_count: 0 } });
  // Grow synthetic veins: mostly intra-organ, some cross-organ, a few hubs.
  const hubs = g.cells.filter(() => rnd() < 0.05).map((c) => c.id);
  for (const c of g.cells) {
    if (['docs', 'config', 'style'].includes(c.lang)) continue;
    c.parsed = true;
    const organCells = g.organs[c.organ].cells;
    const k = Math.floor(rnd() * 4);
    for (let i = 0; i < k; i++) {
      const t = rnd() < 0.25 ? pick(hubs) : rnd() < 0.8 ? pick(organCells) : pick(g.cells).id;
      if (t === c.id || c.deps.includes(t)) continue;
      const to = g.cells[t];
      g.veins.push({ source: c.id, target: t, cross: c.organ !== to.organ });
      c.deps.push(t); to.dependents.push(c.id); c.outDeg++; to.inDeg++;
    }
  }
  for (const c of g.cells) {
    c.stressed = c.inDeg >= 8;
    c.scar = c.parsed && c.inDeg === 0 && !ENTRY_RE.test(c.path) && rnd() < 0.5;
  }
  const scars = g.cells.filter((c) => c.scar);
  const stressed = g.cells.filter((c) => c.stressed).sort((a, b) => b.inDeg - a.inDeg);
  const parsedCount = g.cells.filter((c) => c.parsed).length;
  for (const c of stressed) c.reach = blastRadius(g, c.id);
  g.stats = {
    parsedCount, read: parsedCount, eligible: parsedCount, coverage: 1, scars, stressed,
    crossVeins: g.veins.filter((v) => v.cross).length, vitality: 81, scarRatio: scars.length / parsedCount,
  };
  g.nutrients = [['react', 40], ['zod', 22], ['fastapi', 18], ['lodash', 12], ['d3', 9], ['pydantic', 7]];
  g.demo = true;
  return g;
}
