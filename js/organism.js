// Organism renderer: a custom 2D-canvas force simulation + biological rendering.
// Organs (directories) repel each other; cells (files) cluster inside their organ,
// veins (imports) carry glowing pulses; membranes are traced live around each organ.

import { LANGS } from './genome.js';

const TAU = Math.PI * 2;
const BINS = 56;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

function hsl(h, s, l, a = 1) { return `hsla(${h} ${s}% ${l}% / ${a})`; }

/** Pre-rendered cell sprite: glow halo, cytoplasm, membrane ring, nucleus. */
function makeCellSprite(h, s, l, kind = 'normal') {
  const S = 96, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), m = S / 2;
  const R = m * 0.46; // body radius within sprite

  const halo = g.createRadialGradient(m, m, R * 0.8, m, m, m);
  halo.addColorStop(0, hsl(h, s, l, kind === 'scar' ? 0.08 : 0.28));
  halo.addColorStop(1, hsl(h, s, l, 0));
  g.fillStyle = halo; g.fillRect(0, 0, S, S);

  const body = g.createRadialGradient(m - R * 0.3, m - R * 0.3, R * 0.1, m, m, R);
  body.addColorStop(0, hsl(h, s, Math.min(92, l + 22), 0.95));
  body.addColorStop(0.65, hsl(h, s, l, 0.85));
  body.addColorStop(1, hsl(h, s, l - 18, 0.9));
  g.fillStyle = body; g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();

  g.lineWidth = S * 0.025;
  g.strokeStyle = hsl(h, s, Math.min(95, l + 25), kind === 'scar' ? 0.35 : 0.9);
  if (kind === 'scar') g.setLineDash([S * 0.05, S * 0.04]);
  g.beginPath(); g.arc(m, m, R, 0, TAU); g.stroke();

  if (kind !== 'scar') {
    g.fillStyle = hsl(h, s - 10, Math.min(97, l + 30), 0.95);
    g.beginPath(); g.arc(m + R * 0.12, m + R * 0.08, R * 0.28, 0, TAU); g.fill();
  } else {
    g.strokeStyle = hsl(0, 30, 20, 0.8); g.lineWidth = S * 0.02; g.setLineDash([]);
    g.beginPath(); g.moveTo(m - R * 0.5, m - R * 0.3); g.lineTo(m, m + R * 0.1); g.lineTo(m + R * 0.4, m - R * 0.4); g.stroke();
  }
  return { canvas: c, scale: S / (R * 2) }; // draw size = radius*2*scale
}

function makeGlowSprite(h, s, l) {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, hsl(h, s, 96, 1));
  gr.addColorStop(0.2, hsl(h, s, l + 10, 0.8));
  gr.addColorStop(1, hsl(h, s, l, 0));
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return c;
}

export class Organism {
  constructor(canvas, { onHover, onSelect } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onHover = onHover; this.onSelect = onSelect;
    this.cam = { x: 0, y: 0, z: 1 };
    this.camTarget = { x: 0, y: 0, z: 1 };
    this.autoFit = true;
    this.filter = 'all';            // 'all' | 'scars' | 'stress'
    this.showVeins = true;
    this.selected = null; this.hovered = null; this.focusOrgan = null;
    this.time = 0; this.running = false;
    this.sprites = {}; this.glows = {};
    for (const [k, L] of Object.entries(LANGS)) {
      this.sprites[k] = makeCellSprite(L.hue, L.sat, L.light);
      this.glows[k] = makeGlowSprite(L.hue, L.sat, L.light);
    }
    this.scarSprite = makeCellSprite(355, 28, 42, 'scar');
    this.stressGlow = makeGlowSprite(8, 100, 60);
    this.motes = Array.from({ length: 90 }, () => ({
      x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.3, s: Math.random() * 0.4 + 0.1, p: Math.random() * TAU,
    }));
    this._bindInput();
    this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
  }

  /* ---------------- data ---------------- */
  setGenome(g) {
    this.g = g;
    this.selected = null; this.hovered = null; this.focusOrgan = null;
    this.autoFit = true; this.alpha = 1; this.birthClock = 0;

    const n = g.organs.length;
    const golden = 2.39996;
    g.organs.forEach((o, i) => {
      o.hue = (196 + i * 137.5) % 360;
      const d = 40 + 110 * Math.sqrt(i);
      o.x = Math.cos(i * golden) * d; o.y = Math.sin(i * golden) * d;
      o.vx = 0; o.vy = 0;
      const area = o.cells.reduce((s, id) => s + (this._radius(g.cells[id]) + 1.5) ** 2 * Math.PI, 0);
      o.R = Math.sqrt(area / Math.PI) * 1.25 + 14;
      o.bins = new Float32Array(BINS).fill(o.R);
      o.birth = (i / Math.max(1, n)) * 1.4;
    });
    g.cells.forEach((c) => {
      const o = g.organs[c.organ];
      const a = Math.random() * TAU, d = Math.random() * 6;
      c.x = o.x + Math.cos(a) * d; c.y = o.y + Math.sin(a) * d;
      c.vx = 0; c.vy = 0;
      c.r = this._radius(c);
      c.phase = Math.random() * TAU;
      c.birth = o.birth + 0.25 + Math.random() * 1.6;
    });

    // Aggregate cross-organ veins into organ-organ affinities.
    const aff = new Map();
    for (const v of g.veins) if (v.cross) {
      const a = g.cells[v.source].organ, b = g.cells[v.target].organ;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      aff.set(k, (aff.get(k) || 0) + 1);
    }
    this.organLinks = [...aff].map(([k, w]) => { const [a, b] = k.split('|').map(Number); return { a, b, w }; });

    // Vein curvature + pulse pool
    g.veins.forEach((v) => { v.bend = (Math.random() - 0.5) * 0.5; });
    this.pulses = Array.from({ length: Math.min(260, g.veins.length) }, () => this._newPulse());
    this.start();
  }

  _radius(c) { return clamp(2.4 + Math.sqrt(c.size) / 16, 2.4, 15); }

  _newPulse(veinIdx) {
    const veins = this.g.veins;
    return { v: veinIdx ?? Math.floor(Math.random() * veins.length), t: Math.random(), speed: 0.004 + Math.random() * 0.01 };
  }

  /* ---------------- loop ---------------- */
  start() {
    if (this.running || !this.g) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now; this.time += dt; this.birthClock += dt;
      this._step();
      this._updateCamera();
      this._draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  reheat(a = 0.6) { this.alpha = Math.max(this.alpha, a); }

  /* ---------------- physics ---------------- */
  _step() {
    const g = this.g, A = this.alpha;
    if (A < 0.02) return;
    const organs = g.organs, cells = g.cells;

    // Organ-level: collide, centre gravity, cross-organ affinity.
    for (let i = 0; i < organs.length; i++) {
      const a = organs[i];
      a.vx -= a.x * 0.0025 * A; a.vy -= a.y * 0.0025 * A;
      for (let j = i + 1; j < organs.length; j++) {
        const b = organs[j];
        let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 0.01;
        const min = a.R + b.R + 26;
        if (d < min) {
          const f = ((min - d) / d) * 0.12;
          dx *= f; dy *= f;
          const wa = b.R / (a.R + b.R), wb = 1 - wa;
          a.vx -= dx * wa; a.vy -= dy * wa; b.vx += dx * wb; b.vy += dy * wb;
        }
      }
    }
    for (const { a, b, w } of this.organLinks) {
      const A1 = organs[a], B1 = organs[b];
      const dx = B1.x - A1.x, dy = B1.y - A1.y;
      const f = Math.min(0.002, 0.00012 * Math.sqrt(w)) * A;
      A1.vx += dx * f; A1.vy += dy * f; B1.vx -= dx * f; B1.vy -= dy * f;
    }
    for (const o of organs) { o.vx *= 0.7; o.vy *= 0.7; o.x += o.vx; o.y += o.vy; }

    // Cell-level: pull to organ centre.
    for (const c of cells) {
      const o = organs[c.organ];
      c.vx += (o.x - c.x) * 0.014 * A;
      c.vy += (o.y - c.y) * 0.014 * A;
    }
    // Intra-organ veins as soft springs.
    for (const v of g.veins) {
      if (v.cross) continue;
      const s = cells[v.source], t = cells[v.target];
      const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy) || 0.01;
      const f = ((d - (s.r + t.r + 8)) / d) * 0.012 * A;
      s.vx += dx * f; s.vy += dy * f; t.vx -= dx * f; t.vy -= dy * f;
    }
    // Collisions via spatial hash.
    const CELL = 34, grid = new Map();
    for (const c of cells) {
      const k = ((c.x / CELL) | 0) * 73856093 ^ ((c.y / CELL) | 0) * 19349663;
      (grid.get(k) || grid.set(k, []).get(k)).push(c);
    }
    for (const c of cells) {
      const gx = (c.x / CELL) | 0, gy = (c.y / CELL) | 0;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get(((gx + ox) * 73856093) ^ ((gy + oy) * 19349663));
        if (!bucket) continue;
        for (const d of bucket) {
          if (d.id <= c.id) continue;
          let dx = d.x - c.x, dy = d.y - c.y;
          const min = c.r + d.r + (c.organ === d.organ ? 1.6 : 10);
          const dist2 = dx * dx + dy * dy;
          if (dist2 < min * min) {
            const dist = Math.sqrt(dist2) || 0.01;
            const f = ((min - dist) / dist) * 0.5;
            dx *= f; dy *= f;
            c.vx -= dx; c.vy -= dy; d.vx += dx; d.vy += dy;
          }
        }
      }
    }
    for (const c of cells) {
      c.vx *= 0.55; c.vy *= 0.55;
      c.x += clamp(c.vx, -8, 8); c.y += clamp(c.vy, -8, 8);
    }
    this._updateMembranes();
    this.alpha = A * 0.993;
  }

  _updateMembranes() {
    const g = this.g;
    for (const o of g.organs) {
      let cx = 0, cy = 0;
      for (const id of o.cells) { cx += g.cells[id].x; cy += g.cells[id].y; }
      cx /= o.cells.length; cy /= o.cells.length;
      o.cx = cx; o.cy = cy;
      const raw = new Float32Array(BINS);
      for (const id of o.cells) {
        const c = g.cells[id];
        const dx = c.x - cx, dy = c.y - cy;
        const d = Math.hypot(dx, dy) + c.r + 9;
        const b = Math.floor(((Math.atan2(dy, dx) + Math.PI) / TAU) * BINS) % BINS;
        if (d > raw[b]) raw[b] = d;
        // spread a little to neighbours so sparse organs stay round
        const b1 = (b + 1) % BINS, b2 = (b + BINS - 1) % BINS;
        if (d * 0.94 > raw[b1]) raw[b1] = d * 0.94;
        if (d * 0.94 > raw[b2]) raw[b2] = d * 0.94;
      }
      let maxR = 0;
      for (let i = 0; i < BINS; i++) {
        const sm = (raw[(i + BINS - 2) % BINS] + raw[(i + BINS - 1) % BINS] * 2 + raw[i] * 3 + raw[(i + 1) % BINS] * 2 + raw[(i + 2) % BINS]) / 9;
        const target = Math.max(sm, raw[i] * 0.98, 16);
        o.bins[i] += (target - o.bins[i]) * 0.25;
        maxR = Math.max(maxR, o.bins[i]);
      }
      o.R = o.R * 0.9 + maxR * 0.1;
    }
  }

  /* ---------------- camera ---------------- */
  fit(instant = false) {
    const g = this.g; if (!g) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const list = this.focusOrgan != null ? [g.organs[this.focusOrgan]] : g.organs;
    for (const o of list) {
      const cx = o.cx ?? o.x, cy = o.cy ?? o.y;
      x0 = Math.min(x0, cx - o.R); y0 = Math.min(y0, cy - o.R);
      x1 = Math.max(x1, cx + o.R); y1 = Math.max(y1, cy + o.R + 20);
    }
    const pad = this.focusOrgan != null ? 1.5 : 1.12;
    const sideUI = this.w > 900 ? 380 : 0;
    const z = Math.min((this.w - sideUI) / ((x1 - x0) * pad), (this.h - 140) / ((y1 - y0) * pad));
    this.camTarget = { x: (x0 + x1) / 2 + (sideUI / 2) / z, y: (y0 + y1) / 2 - 20 / z, z: clamp(z, 0.08, 6) };
    if (instant) Object.assign(this.cam, this.camTarget);
  }
  _updateCamera() {
    if (this.autoFit) this.fit();
    const k = 0.08;
    this.cam.x += (this.camTarget.x - this.cam.x) * k;
    this.cam.y += (this.camTarget.y - this.cam.y) * k;
    this.cam.z += (this.camTarget.z - this.cam.z) * k;
  }
  toWorld(sx, sy) { return { x: (sx - this.w / 2) / this.cam.z + this.cam.x, y: (sy - this.h / 2) / this.cam.z + this.cam.y }; }

  /* ---------------- rendering ---------------- */
  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
  }

  _visibleState(c) {
    // returns alpha multiplier based on selection / filter / focus
    if (this.selected != null) {
      const s = this.g.cells[this.selected];
      if (c.id === s.id) return 1;
      if (s.deps.includes(c.id) || s.dependents.includes(c.id)) return 0.95;
      return 0.1;
    }
    if (this.filter === 'scars') return c.scar ? 1 : 0.12;
    if (this.filter === 'stress') return c.stressed ? 1 : 0.12;
    if (this.focusOrgan != null && c.organ !== this.focusOrgan) return 0.2;
    return 1;
  }

  _draw() {
    const { ctx, g, cam, dpr } = this;
    const W = this.w, H = this.h, t = this.time;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // ambient plasma motes (screen space)
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const x = ((m.x + t * 0.004 * m.s) % 1) * W, y = ((m.y + Math.sin(t * 0.2 + m.p) * 0.01) % 1) * H;
      ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t + m.p);
      ctx.fillStyle = '#7fb8ff';
      ctx.beginPath(); ctx.arc(x, y, m.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * (W / 2 - cam.x * cam.z), dpr * (H / 2 - cam.y * cam.z));
    const bc = this.birthClock;
    const born = (c) => clamp((bc - c.birth) / 0.7, 0, 1);

    // ---- membranes
    for (const o of g.organs) {
      const grow = clamp((bc - o.birth) / 0.9, 0, 1);
      if (grow <= 0 || o.cx == null) continue;
      const dim = (this.focusOrgan != null && this.focusOrgan !== o.id) || this.selected != null || this.filter !== 'all' ? 0.35 : 1;
      const pts = [];
      for (let i = 0; i < BINS; i++) {
        const a = (i / BINS) * TAU - Math.PI + (Math.PI / BINS);
        const wob = Math.sin(a * 5 + t * 0.9 + o.id) * 2.2 + Math.sin(a * 3 - t * 0.6) * 1.6;
        const r = (o.bins[i] + wob) * easeOutBack(grow);
        pts.push([o.cx + Math.cos(a) * r, o.cy + Math.sin(a) * r]);
      }
      ctx.beginPath();
      for (let i = 0; i <= BINS; i++) {
        const p = pts[i % BINS], q = pts[(i + 1) % BINS];
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(p[0], p[1], mx, my);
      }
      ctx.closePath();
      const fill = ctx.createRadialGradient(o.cx, o.cy, 0, o.cx, o.cy, o.R * 1.05);
      fill.addColorStop(0, hsl(o.hue, 70, 30, 0.10 * dim));
      fill.addColorStop(0.75, hsl(o.hue, 75, 38, 0.16 * dim));
      fill.addColorStop(1, hsl(o.hue, 85, 55, 0.30 * dim));
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 2.2 / Math.max(0.6, cam.z) + 1;
      ctx.strokeStyle = hsl(o.hue, 90, 68, 0.55 * dim);
      ctx.stroke();
      ctx.lineWidth = 7 / Math.max(0.6, cam.z);
      ctx.strokeStyle = hsl(o.hue, 90, 60, 0.08 * dim);
      ctx.stroke();
    }

    // ---- veins
    const sel = this.selected != null ? g.cells[this.selected] : null;
    if (this.showVeins && g.veins.length) {
      const drawVein = (v) => {
        const s = g.cells[v.source], e = g.cells[v.target];
        const mx = (s.x + e.x) / 2, my = (s.y + e.y) / 2;
        const dx = e.x - s.x, dy = e.y - s.y;
        v.cx = mx - dy * v.bend; v.cy = my + dx * v.bend;
        ctx.moveTo(s.x, s.y); ctx.quadraticCurveTo(v.cx, v.cy, e.x, e.y);
      };
      ctx.lineCap = 'round';
      const baseA = sel ? 0.04 : this.filter !== 'all' ? 0.05 : 0.16;
      // intra-organ, batched per organ colour
      const byOrgan = new Map();
      const cross = [];
      for (const v of g.veins) {
        const s = g.cells[v.source], e = g.cells[v.target];
        if (born(s) < 1 || born(e) < 1) continue;
        if (v.cross) cross.push(v); else (byOrgan.get(s.organ) || byOrgan.set(s.organ, []).get(s.organ)).push(v);
      }
      ctx.lineWidth = 0.9 / Math.max(0.5, cam.z) + 0.4;
      for (const [oid, list] of byOrgan) {
        ctx.beginPath(); list.forEach(drawVein);
        ctx.strokeStyle = hsl(g.organs[oid].hue, 90, 70, baseA); ctx.stroke();
      }
      ctx.beginPath(); cross.forEach(drawVein);
      ctx.strokeStyle = hsl(285, 90, 75, baseA * 1.3); ctx.stroke();

      if (sel) {
        ctx.lineWidth = 1.8 / Math.max(0.5, cam.z) + 0.5;
        ctx.beginPath();
        for (const v of g.veins) if (v.source === sel.id) drawVein(v);
        ctx.strokeStyle = 'hsla(190 100% 70% / 0.85)'; ctx.stroke();
        ctx.beginPath();
        for (const v of g.veins) if (v.target === sel.id) drawVein(v);
        ctx.strokeStyle = 'hsla(330 100% 72% / 0.85)'; ctx.stroke();
      }

      // pulses
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.pulses) {
        p.t += p.speed;
        if (p.t >= 1) {
          if (sel && Math.random() < 0.7) {
            const mine = g.veins.map((v, i) => [v, i]).filter(([v]) => v.source === sel.id || v.target === sel.id);
            Object.assign(p, this._newPulse(mine.length ? mine[Math.floor(Math.random() * mine.length)][1] : undefined), { t: 0 });
          } else Object.assign(p, this._newPulse(), { t: 0 });
        }
        const v = g.veins[p.v]; if (!v || v.cx == null) continue;
        const s = g.cells[v.source], e = g.cells[v.target];
        if (born(s) < 1 || born(e) < 1) continue;
        const a = this._visibleState(s) * this._visibleState(e);
        if (a < 0.5) continue;
        const u = 1 - p.t;
        const x = u * u * s.x + 2 * u * p.t * v.cx + p.t * p.t * e.x;
        const y = u * u * s.y + 2 * u * p.t * v.cy + p.t * p.t * e.y;
        const size = 7 / Math.max(0.7, cam.z) + 2;
        ctx.globalAlpha = Math.sin(p.t * Math.PI) * 0.9;
        ctx.drawImage(this.glows[s.lang], x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---- cells
    for (const c of g.cells) {
      const b = born(c); if (b <= 0) continue;
      const vis = this._visibleState(c);
      const breathe = 1 + Math.sin(t * 1.6 + c.phase) * 0.05;
      const hov = this.hovered === c.id ? 1.35 : 1;
      const r = c.r * easeOutBack(b) * breathe * hov;
      const sp = c.scar ? this.scarSprite : this.sprites[c.lang];
      const size = r * 2 * sp.scale;
      ctx.globalAlpha = vis * clamp(b * 1.5, 0, 1);
      ctx.drawImage(sp.canvas, c.x - size / 2, c.y - size / 2, size, size);
    }
    // stressed hotspots: throbbing red aura
    ctx.globalCompositeOperation = 'lighter';
    for (const c of g.stats.stressed) {
      if (born(c) < 1) continue;
      const vis = this._visibleState(c);
      const beat = (Math.sin(t * 4 + c.phase) + 1) / 2;
      const size = c.r * (5 + beat * 3);
      ctx.globalAlpha = vis * (0.35 + beat * 0.45);
      ctx.drawImage(this.stressGlow, c.x - size / 2, c.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // selection ring
    if (sel) {
      ctx.strokeStyle = 'hsla(190 100% 80% / 0.95)';
      ctx.lineWidth = 2 / cam.z;
      ctx.beginPath(); ctx.arc(sel.x, sel.y, sel.r + 6 / cam.z + Math.sin(t * 5) * 1.5 / cam.z, 0, TAU); ctx.stroke();
    }

    // ---- labels (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    for (const o of g.organs) {
      if (o.cx == null || clamp((bc - o.birth) / 0.9, 0, 1) < 0.6) continue;
      const sx = (o.cx - cam.x) * cam.z + W / 2, sy = (o.cy - o.R - 8 - cam.y) * cam.z + H / 2 - 6;
      if (o.R * cam.z < 22) continue;
      const dim = this.focusOrgan != null && this.focusOrgan !== o.id ? 0.35 : 1;
      ctx.font = '600 12px Outfit, system-ui, sans-serif';
      ctx.fillStyle = hsl(o.hue, 90, 82, 0.9 * dim);
      ctx.fillText(o.name.toUpperCase(), sx, sy);
      ctx.font = '400 10.5px "JetBrains Mono", monospace';
      ctx.fillStyle = `rgba(200,215,240,${0.45 * dim})`;
      ctx.fillText(`${o.cells.length} cells`, sx, sy + 14);
    }
    if (cam.z > 1.8) {
      ctx.font = '400 10px "JetBrains Mono", monospace';
      for (const c of g.cells) {
        const sr = c.r * cam.z;
        if (sr < 9 || this._visibleState(c) < 0.5) continue;
        const sx = (c.x - cam.x) * cam.z + W / 2, sy = (c.y - cam.y) * cam.z + H / 2;
        if (sx < -50 || sy < -20 || sx > W + 50 || sy > H + 20) continue;
        ctx.fillStyle = 'rgba(230,240,255,0.75)';
        ctx.fillText(c.name, sx, sy + sr + 12);
      }
    }
  }

  /* ---------------- input ---------------- */
  _pick(sx, sy) {
    if (!this.g) return null;
    const p = this.toWorld(sx, sy);
    let best = null, bd = Infinity;
    for (const c of this.g.cells) {
      const d = Math.hypot(c.x - p.x, c.y - p.y) - c.r;
      if (d < bd) { bd = d; best = c; }
    }
    return bd < 6 / this.cam.z ? best : null;
  }

  _bindInput() {
    const cv = this.canvas;
    let drag = null, moved = false;
    const pointers = new Map();
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      drag = { x: e.offsetX, y: e.offsetY, cx: this.camTarget.x, cy: this.camTarget.y };
      moved = false;
    });
    cv.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (pointers.size === 2 && prev) {
        // pinch zoom
        const [a, b] = [...pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        prev.x = e.offsetX; prev.y = e.offsetY;
        const [a2, b2] = [...pointers.values()];
        const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (before > 0) this._zoomAt((a2.x + b2.x) / 2, (a2.y + b2.y) / 2, after / before);
        moved = true; return;
      }
      if (prev) { prev.x = e.offsetX; prev.y = e.offsetY; }
      if (drag) {
        const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (moved) {
          this.autoFit = false;
          this.camTarget.x = drag.cx - dx / this.cam.z;
          this.camTarget.y = drag.cy - dy / this.cam.z;
          this.cam.x = this.camTarget.x; this.cam.y = this.camTarget.y;
          cv.style.cursor = 'grabbing';
        }
        return;
      }
      const c = this._pick(e.offsetX, e.offsetY);
      const id = c ? c.id : null;
      if (id !== this.hovered) { this.hovered = id; cv.style.cursor = c ? 'pointer' : 'grab'; }
      this.onHover?.(c, e.clientX, e.clientY);
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (drag && !moved) {
        const c = this._pick(e.offsetX, e.offsetY);
        this.select(c ? c.id : null);
      }
      drag = null; cv.style.cursor = 'grab';
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { this.hovered = null; this.onHover?.(null); });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    cv.addEventListener('dblclick', () => { this.focusOrgan = null; this.select(null); this.autoFit = true; });
  }

  _zoomAt(sx, sy, f) {
    this.autoFit = false;
    const before = this.toWorld(sx, sy);
    const z = clamp(this.camTarget.z * f, 0.05, 10);
    this.camTarget.z = z; this.cam.z = z;
    const after = this.toWorld(sx, sy);
    this.camTarget.x += before.x - after.x; this.camTarget.y += before.y - after.y;
    this.cam.x = this.camTarget.x; this.cam.y = this.camTarget.y;
  }

  select(id) {
    this.selected = id;
    this.onSelect?.(id != null ? this.g.cells[id] : null);
  }
  setFocusOrgan(id) { this.focusOrgan = id; this.selected = null; this.autoFit = true; }
  resetView() { this.focusOrgan = null; this.selected = null; this.filter = 'all'; this.autoFit = true; }

  /** Snapshot with watermark, for sharing. */
  exportPNG(label) {
    const out = document.createElement('canvas');
    out.width = this.canvas.width; out.height = this.canvas.height;
    const g = out.getContext('2d');
    const bg = g.createRadialGradient(out.width / 2, out.height / 2, 0, out.width / 2, out.height / 2, out.width * 0.7);
    bg.addColorStop(0, '#0d1430'); bg.addColorStop(1, '#04060f');
    g.fillStyle = bg; g.fillRect(0, 0, out.width, out.height);
    g.drawImage(this.canvas, 0, 0);
    const s = this.dpr;
    g.font = `600 ${18 * s}px Outfit, sans-serif`;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillText(`🧬 ${label}`, 28 * s, out.height - 48 * s);
    g.font = `400 ${12 * s}px "JetBrains Mono", monospace`;
    g.fillStyle = 'rgba(160,190,255,0.7)';
    g.fillText('sequenced with Codebase DNA', 28 * s, out.height - 26 * s);
    return out.toDataURL('image/png');
  }
}
