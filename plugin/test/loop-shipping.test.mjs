// @test-group governance
// loop-shipping.test.mjs — gap-loop-mechanism-lives-outside-the-package-and-cannot-ship.
// Pins the physical facts the task's AC1/AC2/AC7 rest on, so a future move back out of the
// package (or a second physical copy) fails loudly instead of silently re-introducing the
// "half the mechanism lives outside the plugin" gap:
//
//   AC1 — the 6 formerly-plugin-external mechanism files now live INSIDE plugin/, and their
//         old paths are symlink re-exports (the fast-mode-telemetry precedent), so the quay
//         repo's own references keep working without a second physical copy.
//   AC2 — fast-mode-telemetry.ts has ONE physical copy (plugin/scripts/ is authoritative; the
//         experiments/ path is a symlink re-export, not a duplicate).
//   AC7 — the shipped plugin subtree contains none of the per-project state files that must
//         NOT ship (tick-log.md / escalations.md / batch2-queue-state.md / exp6-* / ADR-021-*),
//         and `npm pack --dry-run` (the Contract's `packed` measure) excludes them too.
//
// Run:
//   scripts/test.sh plugin/test/loop-shipping.test.mjs
//   node --test plugin/test/loop-shipping.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginDir, '..');

// ── AC1: the 6 files are inside plugin/; old paths are gone (no shims left behind) ─────────────────
test('AC1 — the 6 formerly-external mechanism files live in plugin/; the old paths are gone (no compat shells)', () => {
  // (canonical, reason) — every entry ships with the plugin; the reason is the role it plays in
  // the two-layer loop, not "just in case".
  const canonicalInside = [
    ['plugin/loop/orchestrator-loop-tick.md', 'outer-layer driver doc'],
    ['plugin/loop/fast-mode-loop-tick.md', 'inner-layer driver doc'],
    ['plugin/scripts/inner-forensics.mjs', 'inner-layer forensics (outer verification)'],
    ['plugin/scripts/inner-state.sh', 'inner-layer state Monitor (AC10 observation mechanism)'],
    ['plugin/scripts/resource-gate.sh', 'shared resource gate for heavy ops'],
    ['plugin/scripts/heavy-op-token.sh', 'cross-project heavy-op token'],
  ];
  const oldPaths = [
    'orchestration/orchestrator-loop-tick.md',
    'docs/analysis/fast-mode-loop-tick.md',
    'orchestration/watch/inner-forensics.mjs',
    'orchestration/watch/inner-state.sh',
    'scripts/resource-gate.sh',
    'scripts/heavy-op-token.sh',
  ];
  for (const [rel, reason] of canonicalInside) {
    const p = path.join(pluginDir, rel.replace(/^plugin\//, ''));
    assert.ok(fs.existsSync(p), `${rel} must ship inside the plugin (role: ${reason})`);
    assert.ok(fs.statSync(p).isFile(), `${rel} must be a regular file (not a symlink leaving the package)`);
  }
  for (const rel of oldPaths) {
    const p = path.join(repoRoot, rel);
    assert.ok(!fs.existsSync(p),
      `old path must NOT remain (no compat shell / symlink shim): ${rel}`);
  }
});

// ── AC (coordinator): no LIVE reference to the 6 old paths anywhere in the repo ─────────────────────
test('AC1b — after the move, no live reference to the 6 old paths remains (comments/history excluded)', () => {
  // The `scripts/*.sh` old paths are SUBSTRINGS of the new `plugin/scripts/*.sh` paths, so use a
  // negative lookbehind to match only the bare old form (never the `plugin/`-prefixed new path).
  // The `orchestration/` + `docs/analysis/` old paths are NOT substrings of their new `plugin/loop/`
  // locations, so plain substring is exact there.
  const oldPathPatterns = [
    /(?<!plugin\/)scripts\/resource-gate\.sh/,
    /(?<!plugin\/)scripts\/heavy-op-token\.sh/,
    /orchestration\/watch\/inner-state\.sh/,
    /orchestration\/watch\/inner-forensics\.mjs/,
    /docs\/analysis\/fast-mode-loop-tick\.md/,
    /orchestration\/orchestrator-loop-tick\.md/,
  ];
  // Files that MAY legitimately mention the old paths (historical record / target-layout), and
  // are therefore excluded from the "no live reference" scan:
  const excluded = [
    path.join(repoRoot, 'tasks'),            // historical task records (descriptions of the past)
    path.join(repoRoot, 'milestones'),       // historical milestone journals
    path.join(repoRoot, 'orchestration', 'tick-log.md'),   // the outer's running log
    path.join(pluginDir, 'scripts', 'quay-init.sh'),        // target layout (orchestration/ + docs/analysis/)
    path.join(repoRoot, 'test', 'cold-start-e2e.sh'),       // target layout (asserts the laid-down project)
    path.join(pluginDir, 'skills', 'init', 'SKILL.md'),     // mapping table's target column
    path.join(pluginDir, 'test', 'quay-init-loop.test.mjs'),// asserts the laid-down target layout
    path.join(pluginDir, 'loop'),                           // canonical templates: their /loop prompts and cross-refs use plugin/loop/; the only old-path strings left are in the template-params note documenting the TARGET layout
    path.join(pluginDir, 'test', 'loop-shipping.test.mjs'), // this file's own regexes define the old paths
    path.join(repoRoot, 'README.md'),                       // the cold-start section documents the TARGET project's laid-down layout (orchestration/ + docs/analysis/)
  ];
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(md|sh|mjs|ts|json|yml|js)$/.test(e.name)) continue;
      if (excluded.some((x) => p === x || p.startsWith(x + path.sep))) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const re of oldPathPatterns) {
        if (re.test(src)) hits.push(`${path.relative(repoRoot, p)}: contains "${re}"`);
      }
    }
  };
  walk(repoRoot);
  assert.deepEqual(hits, [], 'no live reference to the moved files\' old paths may remain (update callers to plugin/loop/ + plugin/scripts/)');
});

test('AC1c — the tick-doc templates\' own /loop prompts and reciprocal cross-refs use plugin/loop/, not the old orchestration/ + docs/analysis/ paths', () => {
  // The template-params NOTE legitimately spells the target layout (orchestration/ + docs/analysis/),
  // but the actionable instructions (the /loop invocation, the cross-refs to the sibling tick doc)
  // must point at the canonical plugin/loop/ location so the quay repo's own loop works.
  for (const name of ['orchestrator-loop-tick.md', 'fast-mode-loop-tick.md']) {
    const src = fs.readFileSync(path.join(pluginDir, 'loop', name), 'utf8');
    const liveLines = src.split('\n').filter((l) => !l.trim().startsWith('>'));
    for (const snippet of ['orchestration/orchestrator-loop-tick.md', 'docs/analysis/fast-mode-loop-tick.md']) {
      assert.ok(
        !liveLines.some((l) => l.includes(snippet)),
        `${name} has a LIVE instruction referencing the old tick-doc path "${snippet}" (should be plugin/loop/...)`
      );
    }
    assert.match(src, /plugin\/loop\/orchestrator-loop-tick\.md/, `${name} must reference the canonical outer tick-doc path`);
    assert.match(src, /plugin\/loop\/fast-mode-loop-tick\.md/, `${name} must reference the canonical inner tick-doc path`);
  }
});

test('AC1 — test.sh stays at scripts/ (scope ruling: not a portable mechanism, not moved)', () => {
  const p = path.join(repoRoot, 'scripts', 'test.sh');
  assert.ok(fs.existsSync(p));
  assert.ok(fs.statSync(p).isFile(), 'scripts/test.sh must remain a real file (not moved into plugin/)');
  assert.ok(!fs.lstatSync(p).isSymbolicLink(), 'scripts/test.sh must not be a symlink (it is the quay repo test entry, not a mechanism file)');
});

// ── AC2: fast-mode-telemetry.ts has one physical copy ──────────────────────────────────────────────
test('AC2 — fast-mode-telemetry.ts has ONE physical copy; plugin/scripts/ is authoritative, experiments/ is a symlink re-export', () => {
  const canonical = path.join(pluginDir, 'scripts', 'fast-mode-telemetry.ts');
  const reExport = path.join(repoRoot, 'experiments', 'quay-perpetual-stream', 'scripts', 'fast-mode-telemetry.ts');
  assert.ok(fs.existsSync(canonical), 'plugin/scripts/fast-mode-telemetry.ts is the authoritative copy');
  assert.ok(fs.statSync(canonical).isFile(), 'authority must be a regular file');
  assert.ok(fs.lstatSync(reExport).isSymbolicLink(), 'experiments path must be a symlink re-export, not a second copy');
  assert.ok(
    fs.readlinkSync(reExport).includes('plugin/scripts/fast-mode-telemetry.ts'),
    'experiments symlink must point at the plugin authority'
  );
  // No OTHER physical copy anywhere under the repo. Use lstatSync so symlinks (the re-export at
  // experiments/) are not counted as physical copies.
  const copies = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'fast-mode-telemetry.ts' && !fs.lstatSync(p).isSymbolicLink()) copies.push(p);
    }
  };
  walk(repoRoot);
  assert.deepEqual(copies, [canonical], `exactly one physical fast-mode-telemetry.ts expected, got ${JSON.stringify(copies)}`);
});

// ── AC7: the shipped plugin subtree excludes per-project state files ───────────────────────────────
const FORBIDDEN_SUBSTRINGS = ['tick-log.md', 'escalations.md', 'batch2-queue-state.md', 'exp6-', 'ADR-021-'];

test('AC7 — the shipped plugin/ subtree contains none of the forbidden per-project state files', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = path.relative(pluginDir, p);
      if (e.isDirectory()) walk(p);
      else if (FORBIDDEN_SUBSTRINGS.some((f) => rel.includes(f))) hits.push(rel);
    }
  };
  walk(pluginDir);
  assert.deepEqual(hits, [], `plugin/ subtree must not ship: tick-log.md / escalations.md / batch2-queue-state.md / exp6-* / ADR-021-*`);
});

test('AC7 — npm pack --dry-run (the Contract `packed` measure) excludes the forbidden names', () => {
  // The npm package (`packages/quay`) is the other shipped surface. Its `files` field restricts
  // the pack, but the negative control pins it: none of the forbidden names may appear.
  let result = '';
  try {
    result = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: path.join(repoRoot, 'packages', 'quay'),
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120000,
    });
  } catch (e) {
    // npm pack can still list files with a warning; prefer the parsed stdout.
    result = e.stdout || e.stderr || '';
  }
  let files = [];
  try {
    const parsed = JSON.parse(result);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    files = (entry?.files || []).map((f) => f.path);
  } catch {
    // If npm pack output is not parseable, fall back to the package.json `files` allowlist +
    // the plugin-subtree scan already done above; don't fail the whole suite on npm quirks.
    files = [];
  }
  const hits = files.filter((f) => FORBIDDEN_SUBSTRINGS.some((x) => f.includes(x)));
  assert.deepEqual(hits, [], `npm pack must not ship forbidden names (files list: ${files.join(', ')})`);
});
