// App controller: wires the UI, data loading and the organism renderer together.
import { parseRepoInput, loadRepo, loadSources } from './github.js';
import { buildGenome, demoGenome, blastRadius, packGenome, unpackGenome, LANGS } from './genome.js';
import { Organism } from './organism.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmtBytes = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const fmtNum = (n) => n.toLocaleString();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const langColor = (k) => { const L = LANGS[k] || LANGS.other; return `hsl(${L.hue} ${L.sat}% ${L.light}%)`; };
const pct = (x) => `${Math.round(x * 100)}%`;
const slug = (g) => (g?.meta.full_name || 'organism').replace('/', '-');
const download = (name, href) => { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); };
const baseTitle = document.title;

let genome = null;
let current = null; // { owner, repo }
let busy = false;

/* ---------------- organism ---------------- */
const tooltip = $('#tooltip');
const organism = new Organism($('#organism'), {
  onHover(cell, x, y) {
    if (!cell) { tooltip.hidden = true; return; }
    const flags = [cell.scar && '🩹 possible dead code', cell.stressed && `🔥 hotspot · ${cell.inDeg} dependents`].filter(Boolean);
    tooltip.innerHTML = `<b>${esc(cell.name)}</b><code>${esc(cell.path)}</code>${flags.length ? `<div style="margin-top:.3rem">${flags.join('<br>')}</div>` : ''}`;
    tooltip.hidden = false;
    const r = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.min(x + 16, innerWidth - r.width - 10)}px`;
    tooltip.style.top = `${Math.min(y + 16, innerHeight - r.height - 10)}px`;
  },
  onSelect: showInspector,
});

/* ---------------- session cache ---------------- */
// Back/forward and re-opened share links skip the network: a full scan is
// up to ~1,400 file downloads, and the tree call counts against GitHub's 60/hr limit.
const CACHE_TTL = 30 * 60 * 1000;
const cacheKey = ({ owner, repo }) => `dna-cache:${owner}/${repo}`.toLowerCase();

function readCache(target) {
  try {
    const hit = JSON.parse(sessionStorage.getItem(cacheKey(target)));
    if (hit && Date.now() - hit.at < CACHE_TTL) return unpackGenome(hit.genome);
  } catch { /* storage blocked or entry corrupt: just re-sequence */ }
  return null;
}

function writeCache(target, g) {
  try {
    const value = JSON.stringify({ at: Date.now(), genome: packGenome(g) });
    try { sessionStorage.setItem(cacheKey(target), value); } catch {
      // Over quota: evict older specimens and retry once.
      Object.keys(sessionStorage).filter((k) => k.startsWith('dna-cache:')).forEach((k) => sessionStorage.removeItem(k));
      sessionStorage.setItem(cacheKey(target), value);
    }
  } catch { /* caching is best-effort */ }
}

/* ---------------- loading ---------------- */
const loader = $('#loader');
function progress(msg, p) {
  $('#loader-msg').textContent = msg;
  $('#loader-bar').style.width = `${Math.round(p * 100)}%`;
}

async function sequence(input, { pushHistory = true } = {}) {
  if (busy) return;
  const target = parseRepoInput(input);
  if (!target) return toast('Enter a repository like owner/repo or a GitHub URL.', true);
  busy = true;
  $$('.repo-form button').forEach((b) => (b.disabled = true));
  loader.hidden = false;
  progress('Sequencing genome…', 0.02);
  try {
    let g = readCache(target);
    if (!g) {
      const token = localStorage.getItem('dna-token') || '';
      const repo = await loadRepo(target, token, progress);
      const { sources, read } = await loadSources(target, repo.ref, repo.files, progress);
      progress('Growing organism…', 0.96);
      g = buildGenome({ ...repo, sources, read });
      writeCache(target, g); // before the renderer attaches layout state
    }
    genome = g;
    current = target;
    enterViewing();
    organism.setGenome(genome);
    renderPanel(genome);
    $('#topbar-input').value = `${target.owner}/${target.repo}`;
    if (pushHistory) history.pushState({ repo: `${target.owner}/${target.repo}` }, '', `?repo=${target.owner}/${target.repo}`);
    document.title = `${target.owner}/${target.repo} · Codebase DNA`;
  } catch (err) {
    console.error(err);
    toast(err.message || 'Something went wrong while sequencing.', true);
  } finally {
    loader.hidden = true;
    busy = false;
    $$('.repo-form button').forEach((b) => (b.disabled = false));
  }
}

function loadDemo(viewing) {
  genome = demoGenome();
  current = null;
  organism.setGenome(genome);
  renderPanel(genome);
  if (viewing) enterViewing();
}

function enterViewing() {
  document.body.classList.replace('mode-landing', 'mode-viewing');
  hideInspector();
}

/* ---------------- panel ---------------- */
function verdictFor(v) {
  if (v >= 85) return ['Thriving organism', 'hsl(168 100% 62%)'];
  if (v >= 70) return ['Healthy, minor scarring', 'hsl(185 100% 65%)'];
  if (v >= 50) return ['Stable, needs a check-up', 'hsl(45 100% 62%)'];
  return ['Critical: heavy scarring', 'hsl(355 90% 66%)'];
}

function countUp(el, to) {
  const from = 0, t0 = performance.now(), dur = 1200;
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - (1 - p) ** 3;
    el.textContent = fmtNum(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderPanel(g) {
  const m = g.meta;
  $('#repo-name').textContent = m.full_name || 'Unknown specimen';
  $('#repo-desc').textContent = m.description || (g.demo ? '' : 'No description.');
  const link = $('#repo-link');
  if (m.html_url) { link.href = m.html_url; link.hidden = false; } else link.hidden = true;

  const v = g.stats.vitality;
  countUp($('#vitality-score'), v);
  $('#vitality-ring').style.strokeDashoffset = 314.16 * (1 - v / 100);
  const [verdict, color] = verdictFor(v);
  $('#vitality-verdict').textContent = verdict;
  $('#vitality-verdict').style.color = color;
  $('#vitality-note').textContent = g.veins.length
    ? `${Math.round((g.stats.crossVeins / g.veins.length) * 100)}% of veins cross organs · ${Math.round(g.stats.scarRatio * 100)}% scarred.`
    : 'No internal imports detected. This language may not be supported for vein tracing yet.';

  countUp($('#stat-cells'), g.cells.length);
  countUp($('#stat-organs'), g.organs.length);
  countUp($('#stat-veins'), g.veins.length);
  countUp($('#stat-scars'), g.stats.scars.length);
  countUp($('#stat-stress'), g.stats.stressed.length);
  countUp($('#stat-nutrients'), g.nutrients.length);

  // Organs
  const maxCells = Math.max(...g.organs.map((o) => o.cells.length));
  $('#organ-list').innerHTML = g.organs.map((o) => {
    const c = `hsl(${o.hue} 90% 66%)`;
    return `<li><button data-organ="${o.id}" id="organ-${o.id}">
      <i class="swatch" style="color:${c}"></i>
      <span class="name">${esc(o.name)}</span>
      <span class="count">${o.cells.length} · ${fmtBytes(o.bytes)}</span>
      <span class="bar-mini"><i style="width:${(o.cells.length / maxCells) * 100}%;background:${c}"></i></span>
    </button></li>`;
  }).join('');

  // Diagnosis
  const cellBtn = (c, meta) => `<li><button data-cell="${c.id}">
      <i class="swatch" style="color:${langColor(c.lang)}"></i>
      <span class="name" title="${esc(c.path)}">${esc(c.path)}</span>
      <span class="count">${meta}</span></button></li>`;
  const stressed = g.stats.stressed.slice(0, 25);
  const scars = g.stats.scars.slice(0, 40);
  const partial = g.stats.coverage < 0.95;
  $('#diagnosis').innerHTML = `
    <section class="diag-section">
      <h4><i class="dot stress"></i>Hotspots (${g.stats.stressed.length})</h4>
      <p>Files many others depend on. Changes here ripple through the whole organism, so test them carefully. The second number is the blast radius: every file affected, directly or indirectly.</p>
      ${stressed.length ? `<ul class="list">${stressed.map((c) => cellBtn(c, `${c.inDeg}↙ · ${fmtNum(c.reach ?? blastRadius(g, c.id))}`)).join('')}</ul>` : '<div class="empty">No hotspots detected 🎉</div>'}
    </section>
    <section class="diag-section">
      <h4><i class="dot scar"></i>Scar tissue (${g.stats.scars.length})</h4>
      <p>Code files nothing imports. They may be dead code, or entry points we couldn't recognise.${partial ? ` Only ${pct(g.stats.coverage)} of source files could be read, so some of these may be used by files we didn't see.` : ''}</p>
      ${scars.length ? `<ul class="list">${scars.map((c) => cellBtn(c, fmtBytes(c.size))).join('')}</ul>` : '<div class="empty">No scar tissue found 🎉</div>'}
    </section>`;

  // Genes: languages + external deps
  const langs = Object.entries(g.langTotals).sort((a, b) => b[1] - a[1]);
  $('#genes').innerHTML = `
    <div class="diag-section"><h4>Cell types</h4></div>
    <div class="legend">${langs.map(([k, n]) => `<span style="color:${langColor(k)}"><i></i><b style="color:var(--ink-2);font-weight:500">${(LANGS[k] || LANGS.other).name}</b> ${n}</span>`).join('')}</div>
    <div class="diag-section"><h4>Nutrients <span class="muted" style="text-transform:none;letter-spacing:0">external packages</span></h4></div>
    ${g.nutrients.length ? g.nutrients.slice(0, 40).map(([n, c]) => `<div class="nutrient"><span>${esc(n)}</span><span>${c} ${c === 1 ? 'file' : 'files'}</span></div>`).join('') : '<div class="empty">No external dependencies detected</div>'}`;

  const notes = [];
  if (g.truncated) notes.push(`Large specimen: showing ${fmtNum(g.cells.length)} of ${fmtNum(g.totalFiles)} files.`);
  if (g.stats.coverage < 0.95) notes.push(`Read ${fmtNum(g.stats.read)} of ${fmtNum(g.stats.eligible)} source files (${pct(g.stats.coverage)}), so dead-code and hotspot results are partial.`);
  if (g.stats.parsedCount < g.cells.length * 0.5) notes.push(`Veins are traced for JS/TS, Python, Go and C/C++ (${fmtNum(g.stats.parsedCount)} files read).`);
  const note = $('#truncation-note');
  note.hidden = !notes.length;
  note.textContent = notes.join(' ');

  setTab('organs');
  setFilter('all');
}

/* ---------------- inspector ---------------- */
function showInspector(cell) {
  // Only diagnosis rows map to cells; organ rows keep their own focus highlight.
  $$('#diagnosis button').forEach((b) => b.classList.toggle('active', !!cell && b.dataset.cell == cell.id));
  if (!cell) return hideInspector();
  const o = genome.organs[cell.organ];
  $('#insp-organ').textContent = `organ · ${o.name}`;
  $('#insp-organ').style.color = `hsl(${o.hue} 90% 72%)`;
  $('#insp-name').textContent = cell.name;
  $('#insp-path').textContent = cell.path;
  $('#insp-size').textContent = fmtBytes(cell.size);
  $('#insp-out').textContent = cell.parsed ? cell.outDeg : '—';
  $('#insp-in').textContent = cell.inDeg;
  $('#insp-reach').textContent = fmtNum(cell.reach ?? blastRadius(genome, cell.id));
  const badges = [`<span class="badge" style="color:${langColor(cell.lang)}">${(LANGS[cell.lang] || LANGS.other).name}</span>`];
  if (cell.stressed) badges.push('<span class="badge stress">🔥 Hotspot</span>');
  if (cell.scar) badges.push('<span class="badge scar">🩹 Possible dead code</span>');
  if (!cell.stressed && !cell.scar && cell.parsed) badges.push('<span class="badge ok">Healthy</span>');
  $('#insp-badges').innerHTML = badges.join('');
  const link = $('#insp-link');
  if (current && genome.meta.default_branch) {
    link.href = `https://github.com/${current.owner}/${current.repo}/blob/${genome.meta.default_branch}/${cell.path}`;
    link.hidden = false;
  } else link.hidden = true;
  $('#inspector').hidden = false;
}
function hideInspector() { $('#inspector').hidden = true; }

/* ---------------- report ---------------- */
/** Markdown summary of the diagnosis, ready to paste into an issue, PR or chat. */
function buildReport(g) {
  const m = g.meta, s = g.stats;
  const blob = m.html_url && m.default_branch ? `${m.html_url}/blob/${m.default_branch}/` : null;
  const file = (c) => (blob ? `[\`${c.path}\`](${blob}${c.path.split('/').map(encodeURIComponent).join('/')})` : `\`${c.path}\``);
  const section = (title, blurb, rows) => ['', `## ${title}`, '', blurb, '', ...(rows.length ? rows : ['_None detected._'])];
  const more = (shown, total) => (total > shown ? [`- …and ${fmtNum(total - shown)} more`] : []);

  const hot = s.stressed.slice(0, 15), scars = s.scars.slice(0, 40), deps = g.nutrients.slice(0, 15);
  return [
    `# ${m.full_name || 'Repository'}: codebase health report`,
    '',
    `**Vitality ${s.vitality}/100**: ${verdictFor(s.vitality)[0].toLowerCase()}.`,
    '',
    '| Files | Modules | Internal imports | Hotspots | Possible dead code | External packages |',
    '|---:|---:|---:|---:|---:|---:|',
    `| ${fmtNum(g.cells.length)} | ${g.organs.length} | ${fmtNum(g.veins.length)} | ${s.stressed.length} | ${s.scars.length} | ${g.nutrients.length} |`,
    ...(s.coverage < 0.95 ? ['', `> Read ${fmtNum(s.read)} of ${fmtNum(s.eligible)} source files (${pct(s.coverage)}). Dead-code and hotspot results are partial.`] : []),
    ...(g.truncated ? ['', `> Large repository: analysed ${fmtNum(g.cells.length)} of ${fmtNum(g.totalFiles)} files.`] : []),
    ...section('Hotspots', 'Files many others depend on. Review and test changes here carefully.',
      [...hot.map((c) => `- ${file(c)}: imported by ${c.inDeg} files, ${fmtNum(c.reach ?? blastRadius(g, c.id))} affected in total`), ...more(hot.length, s.stressed.length)]),
    ...section('Possible dead code', 'Source files nothing imports. Confirm before deleting: they may be loaded dynamically, by config, or by tooling.',
      [...scars.map((c) => `- ${file(c)} (${fmtBytes(c.size)})`), ...more(scars.length, s.scars.length)]),
    ...section('Most-used external packages', 'Third-party packages ranked by how many files import them.',
      deps.map(([n, k]) => `- \`${n}\`: ${k} ${k === 1 ? 'file' : 'files'}`)),
    '',
    `_Generated with Codebase DNA from ${fmtNum(s.parsedCount)} scanned source files._`,
    '',
  ].join('\n');
}

/* ---------------- controls ---------------- */
function setTab(name) {
  $$('.tab').forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
  $$('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== name));
}
function setFilter(f) {
  organism.filter = f;
  organism.selected = null; hideInspector();
  $$('.seg-btn').forEach((b) => { const on = b.dataset.filter === f; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast${error ? ' error' : ''}`; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4200);
}

for (const id of ['#hero-form', '#topbar-form']) {
  $(id).addEventListener('submit', (e) => { e.preventDefault(); sequence(new FormData(e.target).get('repo')); });
}
$$('.chip').forEach((c) => c.addEventListener('click', () => { $('#hero-input').value = c.dataset.repo; sequence(c.dataset.repo); }));
$('#explore-demo').addEventListener('click', () => loadDemo(true));
$$('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
$$('.seg-btn').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.filter)));
$('#veins-toggle').addEventListener('change', (e) => (organism.showVeins = e.target.checked));
$('#fit-btn').addEventListener('click', () => { organism.resetView(); setFilter('all'); $$('#organ-list button').forEach((b) => b.classList.remove('active')); });
$('#inspector-close').addEventListener('click', () => organism.select(null));

$('#organ-list').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-organ]'); if (!b) return;
  const id = Number(b.dataset.organ);
  const same = organism.focusOrgan === id;
  organism.setFocusOrgan(same ? null : id);
  hideInspector();
  $$('#organ-list button').forEach((x) => x.classList.toggle('active', !same && x === b));
});
$('#diagnosis').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cell]'); if (!b) return;
  organism.filter = 'all';
  $$('.seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.filter === 'all'));
  const c = genome.cells[Number(b.dataset.cell)];
  organism.autoFit = false;
  organism.camTarget = { x: c.x + (innerWidth > 900 ? 180 / 2.4 : 0), y: c.y, z: 2.4 };
  organism.select(c.id);
});

$('#share-btn').addEventListener('click', async () => {
  const url = current ? `${location.origin}${location.pathname}?repo=${current.owner}/${current.repo}` : location.href;
  try { await navigator.clipboard.writeText(url); toast('🔗 Share link copied'); } catch { toast(url); }
});
$('#export-btn').addEventListener('click', () => {
  download(`${slug(genome)}-dna.png`, organism.exportPNG(genome?.meta.full_name || 'codebase'));
});
$('#report-btn').addEventListener('click', async () => {
  if (!genome) return;
  const md = buildReport(genome);
  try {
    await navigator.clipboard.writeText(md);
    toast('📋 Health report copied as Markdown');
  } catch {
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    download(`${slug(genome)}-report.md`, url);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Health report downloaded');
  }
});

const dialog = $('#token-dialog');
$('#token-btn').addEventListener('click', () => { $('#token-input').value = localStorage.getItem('dna-token') || ''; dialog.showModal(); });
dialog.addEventListener('close', () => {
  if (dialog.returnValue === 'save') { localStorage.setItem('dna-token', $('#token-input').value.trim()); toast('Token saved locally'); }
  if (dialog.returnValue === 'clear') { localStorage.removeItem('dna-token'); toast('Token cleared'); }
});

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dialog.open) { organism.select(null); }
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    (document.body.classList.contains('mode-viewing') ? $('#topbar-input') : $('#hero-input')).focus();
  }
});
addEventListener('popstate', () => {
  const r = new URLSearchParams(location.search).get('repo');
  if (r) return sequence(r, { pushHistory: false });
  // Back past the first specimen: return to the landing page instead of a stale view.
  document.body.classList.replace('mode-viewing', 'mode-landing');
  document.title = baseTitle;
  loadDemo(false);
});

/* ---------------- boot ---------------- */
document.body.classList.add('mode-landing');
loadDemo(false);
const initial = new URLSearchParams(location.search).get('repo');
if (initial) sequence(initial, { pushHistory: false });
