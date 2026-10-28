// Regression tests for the analysis engine (import tracing, dead-code and hotspot detection).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGenome, blastRadius, packGenome, unpackGenome, demoGenome } from '../js/genome.js';

const mk = (entries) => {
  const files = Object.keys(entries).map((path) => ({ path, size: 500 }));
  return { files, sources: new Map(Object.entries(entries).filter(([, s]) => s != null)) };
};
const cell = (g, p) => g.cells.find((c) => c.path === p);
const hasVein = (g, a, b) => g.veins.some((v) => v.source === cell(g, a).id && v.target === cell(g, b).id);

test('TS ESM ".js" specifiers resolve to .ts files', () => {
  const g = buildGenome(mk({
    'src/index.ts': "import { a } from './util/a.js';\nimport b from './b.mjs';",
    'src/util/a.ts': "export const a = 1; import './c.js';",
    'src/util/c.tsx': 'export {}',
    'src/b.mts': 'export default 1',
    'src/x.ts': "import './util/a.js'", 'src/y.ts': "import './util/a.js'", 'src/z.ts': "import './util/a.js'",
  }));
  assert.ok(hasVein(g, 'src/index.ts', 'src/util/a.ts'));
  assert.ok(hasVein(g, 'src/util/a.ts', 'src/util/c.tsx'));
  assert.ok(hasVein(g, 'src/index.ts', 'src/b.mts'));
  assert.equal(cell(g, 'src/b.mts').lang, 'ts');
  assert.equal(cell(g, 'src/util/c.tsx').scar, false);
});

test('package.json main/bin/exports targets are not dead code', () => {
  const g = buildGenome(mk({
    'package.json': JSON.stringify({ main: 'lib/axios.js', bin: { tool: './bin/run.js' }, exports: { '.': { import: './lib/esm.js', require: './lib/axios.js' } } }),
    'lib/axios.js': "require('./core.js')",
    'lib/core.js': "require('./helpers.js')",
    'lib/helpers.js': '', 'lib/esm.js': "import './core.js'", 'bin/run.js': '',
    'lib/orphan.js': "require('./helpers.js')",
  }));
  assert.ok(hasVein(g, 'package.json', 'lib/axios.js'));
  assert.ok(hasVein(g, 'package.json', 'lib/esm.js'));
  assert.equal(cell(g, 'lib/axios.js').scar, false);
  assert.equal(cell(g, 'lib/esm.js').scar, false);
  assert.equal(cell(g, 'lib/orphan.js').scar, true, 'genuinely unused file is still flagged');
  assert.equal(g.nutrients.length, 0, 'manifest paths never leak into external packages');
});

test('HTML <script src> marks scripts as used; CDN scripts ignored', () => {
  const g = buildGenome(mk({
    'index.html': '<script type="module" src="js/app.js?v=2"></script><script src="https://cdn.x/y.js"></script>',
    'web/index.html': '<script type="module" src="/src/main.ts"></script>',
    'web/src/main.ts': "import './view'",
    'web/src/view.ts': '',
    'js/app.js': "import './lib.js'", 'js/lib.js': '', 'js/a.js': "import './lib.js'", 'js/b.js': "import './lib.js'",
  }));
  assert.ok(hasVein(g, 'index.html', 'js/app.js'));
  assert.ok(hasVein(g, 'web/index.html', 'web/src/main.ts'), 'root-relative resolved against the HTML folder');
  assert.equal(cell(g, 'js/app.js').scar, false);
  assert.equal(g.nutrients.length, 0);
});

test('blast radius follows transitive dependents and survives cycles', () => {
  const g = buildGenome(mk({
    'a.js': "import './b.js'", 'b.js': "import './c.js'", 'c.js': "import './a.js'; import './d.js'", 'd.js': '',
    'e.js': "import './d.js'",
  }));
  assert.equal(blastRadius(g, cell(g, 'd.js').id), 4); // c, e, b, a
  assert.equal(blastRadius(g, cell(g, 'e.js').id), 0);
});

test('partial scans soften the scar penalty in vitality', () => {
  const entries = { 'src/hub.js': '' };
  for (let i = 0; i < 30; i++) entries[`src/f${i}.js`] = i < 6 ? "import './hub.js'" : '';
  const full = buildGenome({ ...mk(entries), eligible: 31 });
  const partial = buildGenome({ ...mk(entries), eligible: 310 });
  assert.equal(full.stats.coverage, 1);
  assert.ok(Math.abs(partial.stats.coverage - 0.1) < 1e-9);
  assert.ok(partial.stats.vitality > full.stats.vitality);
});

test('pack/unpack round-trips through JSON with live cell references', () => {
  const g = buildGenome(mk({
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`src/m${i}.js`, "import './core.js'"])),
    'src/core.js': '', 'src/dead.js': "import './core.js'",
  }));
  assert.ok(g.stats.stressed.length > 0);
  const back = unpackGenome(JSON.parse(JSON.stringify(packGenome(g))));
  assert.equal(back.stats.scars.length, g.stats.scars.length);
  assert.deepEqual(back.stats.stressed.map((c) => c.path), g.stats.stressed.map((c) => c.path));
  assert.ok(back.stats.stressed.every((c) => back.cells.includes(c)), 'stats point into cells, not copies');
  assert.equal(back.stats.stressed[0].reach, g.stats.stressed[0].reach);
  assert.ok(g.stats.scars, 'packing does not mutate the live genome');
});

test('Node "#subpath" imports resolve through the nearest package.json and never become nutrients', () => {
  const g = buildGenome(mk({
    'packages/svelte/package.json': JSON.stringify({ imports: {
      '#compiler/builders': './src/compiler/utils/builders.js',
      '#client': { types: './src/client/types.d.ts', default: './src/client/index.js' },
      '#lib/*': './src/lib/*.js',
    } }),
    'packages/svelte/src/compiler/utils/builders.js': '',
    'packages/svelte/src/client/index.js': '', 'packages/svelte/src/client/types.d.ts': '',
    'packages/svelte/src/lib/deep/thing.js': '',
    'packages/svelte/src/compiler/a.js': "import * as b from '#compiler/builders'; import '#client'; import '#lib/deep/thing'",
    'packages/svelte/src/compiler/b.js': "import * as b from '#compiler/builders'; import '#missing'",
    'other/x.js': "import '#compiler/builders'", // outside that package: no map applies
  }));
  const A = 'packages/svelte/src/compiler/a.js';
  assert.ok(hasVein(g, A, 'packages/svelte/src/compiler/utils/builders.js'));
  assert.ok(hasVein(g, A, 'packages/svelte/src/client/index.js'), 'conditional target skips "types"');
  assert.ok(hasVein(g, A, 'packages/svelte/src/lib/deep/thing.js'), 'wildcard pattern');
  assert.ok(!hasVein(g, 'other/x.js', 'packages/svelte/src/compiler/utils/builders.js'));
  assert.equal(cell(g, 'packages/svelte/src/compiler/utils/builders.js').scar, false);
  assert.deepEqual(g.nutrients, []);
});

test('convention-loaded files are not dead code; ordinary orphans still are', () => {
  const live = ['test-d/types.ts', 'pkg/test_models.py', 'pkg/models_test.py', 'web/app/dashboard/page.tsx', 'web/app/layout.tsx',
    'web/pages/about.tsx', 'kit/src/routes/+page.ts', 'site/app/routes/_index.tsx', 'shop/admin.py', 'shop/migrations/0001_initial.py',
    'src/__mocks__/fs.js', 'cypress/e2e/login.cy.ts', 'benchmarking/run.js', 'playgrounds/sandbox/run.js', '.eslintrc.cjs', 'src/Button.stories.tsx'];
  const entries = { 'src/used.js': '', 'src/orphan.js': "import './used.js'", 'src/orphan.py': 'import os' };
  for (const p of live) entries[p] = "import './x'";
  for (let i = 0; i < 6; i++) entries[`src/u${i}.js`] = "import './used.js'";
  const g = buildGenome(mk(entries));
  for (const p of live) assert.equal(cell(g, p).scar, false, p);
  assert.equal(cell(g, 'src/orphan.js').scar, true);
  assert.equal(cell(g, 'src/orphan.py').scar, true);
});

test('coverage uses product files read vs. product files in the whole repo', () => {
  const g = buildGenome({ ...mk({ 'a.js': "import './b.js'", 'b.js': '' }), eligible: 400, read: 100 });
  assert.equal(g.stats.coverage, 0.25);
  assert.equal(g.stats.read, 100);
  assert.equal(g.stats.eligible, 400);
});

test('a repo importing its own package name links to the entry file, not an external package', () => {
  const g = buildGenome(mk({
    'package.json': JSON.stringify({ name: 'axios', main: 'index.js' }),
    'packages/kit/package.json': JSON.stringify({ name: '@acme/kit', exports: { '.': { types: './t.d.ts', import: './src/kit.js' }, './utils': './src/utils.js' } }),
    'index.js': "export * from './lib/axios.js'", 'lib/axios.js': '',
    'packages/kit/src/kit.js': '', 'packages/kit/src/utils.js': '',
    'test/a.js': "import axios from 'axios'; import { k } from '@acme/kit'; import u from '@acme/kit/utils'; import ext from 'react'",
  }));
  assert.ok(hasVein(g, 'test/a.js', 'index.js'));
  assert.ok(hasVein(g, 'test/a.js', 'packages/kit/src/kit.js'));
  assert.ok(hasVein(g, 'test/a.js', 'packages/kit/src/utils.js'));
  assert.deepEqual(g.nutrients.map(([n]) => n), ['react']);
});

test('stdlib filtering is per language: "uuid" is npm in JS but stdlib in Python', () => {
  const g = buildGenome(mk({
    'a.js': "import { v4 } from 'uuid'; import fs from 'node:fs'; import { test } from 'bun:test'; import { createRequire } from 'module'; import z from 'npm:zod'",
    'b.py': 'import uuid\nimport os, sys\nfrom collections import OrderedDict\nimport requests\nfrom flask import Flask',
  }));
  assert.deepEqual(g.nutrients.map(([n]) => n).sort(), ['flask', 'requests', 'uuid', 'zod']);
});

test('consecutive and parenthesised Python from-imports are all traced', () => {
  const g = buildGenome(mk({
    'app/__init__.py': [
      'from collections import OrderedDict',
      'from .views import index',
      'from .models import (',
      '    User,  # the user model',
      '    Post as P,',
      ')',
      'from . import helpers',
      'from .db import session; x = 1',
    ].join('\n'),
    'app/views.py': '', 'app/models.py': '', 'app/helpers.py': '', 'app/db.py': '',
  }));
  for (const t of ['app/views.py', 'app/models.py', 'app/helpers.py', 'app/db.py']) assert.ok(hasVein(g, 'app/__init__.py', t), t);
});

test("the string 'import' in code is not read as an import", () => {
  const g = buildGenome(mk({
    'a.js': "if (kind === 'import') {\n  continue;\n}\nconst s = 'import ' + name + 'x';\nimport y from 'real-dep';",
  }));
  assert.deepEqual(g.nutrients.map(([n]) => n), ['real-dep']);
});

test('aliases and baseUrl imports resolve per package; declared deps stay external', () => {
  const g = buildGenome(mk({
    'site/package.json': JSON.stringify({ dependencies: { debug: '1' } }),
    'site/src/lib/db.ts': '', 'site/src/debug.ts': '', 'site/types/index.d.ts': '', 'site/src/components/Button.tsx': '',
    'site/src/routes/a.ts': "import db from '$lib/db'; import { env } from '$env/static/private'; import { goto } from '$app/navigation'",
    'site/src/b.ts': "import d from 'debug'; import type { User } from 'types'; import B from 'components/Button'; import C from '@/components/Button'",
  }));
  assert.ok(hasVein(g, 'site/src/routes/a.ts', 'site/src/lib/db.ts'));
  assert.ok(hasVein(g, 'site/src/b.ts', 'site/types/index.d.ts'));
  assert.ok(hasVein(g, 'site/src/b.ts', 'site/src/components/Button.tsx'));
  assert.ok(!hasVein(g, 'site/src/b.ts', 'site/src/debug.ts'), 'declared npm dep wins over a same-named local file');
  assert.deepEqual(g.nutrients.map(([n]) => n), ['debug']);
});

test('demo organism still builds with new stats fields', () => {
  const g = demoGenome();
  assert.equal(g.stats.coverage, 1);
  assert.ok(g.stats.stressed.every((c) => typeof c.reach === 'number'));
});
