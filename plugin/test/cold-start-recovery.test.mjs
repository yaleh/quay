// @test-group product
// cold-start-recovery.test.mjs — gap-cold-start-skill-has-no-recovery-branch (AC1-AC5).
//
// Pins the RECOVERY branch added to plugin/skills/cold-start/SKILL.md (the fresh-start path is
// pinned by the sibling cold-start-skill.test.mjs):
//   AC1 — the skill routes to the recovery branch when mid-flight state exists and to the
//         fresh-start branch when it doesn't (both directions taught in the doc).
//   AC2 — all three state classes (unclosed merged task / orphaned worktree+branch / ghost
//         telemetry) are detected via EXISTING tools — task-status-drift-check.ts,
//         fast-mode-telemetry.ts --report --json, git worktree list + git branch --list "task/*",
//         git merge-base --is-ancestor, --reconcile. Zero NEW detection logic beyond wiring.
//   AC3 — the recovery branch, once converged, uses the SAME AC8c checklist as fresh-start — no
//         separate acceptance framework.
//   AC4 — negative control: a genuinely clean workspace (no mid-flight state) takes the fresh-start
//         branch, not the recovery branch (must not false-positive).
//   AC5 — node:test + `// @test-group product` (skill/operational infra).
//
// The group is `product` (NOT the load-sensitive `lowconc` of the sibling cold-start-skill.test.mjs,
// which carries the real quay-init --loop rehearsal): these are hermetic text assertions over the
// skill doc, so they belong in the default-suite product group and must stay fast.
//
// Run:
//   scripts/test.sh --for-task gap-cold-start-skill-has-no-recovery-branch
//   node --test plugin/test/cold-start-recovery.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const skillPath = path.join(pluginDir, 'skills', 'cold-start', 'SKILL.md');
const skillSrc = fs.readFileSync(skillPath, 'utf8');

// Isolate the recovery-branch section: from the "### 0b." header to the next fresh-start step ("### 1.").
const recStart = skillSrc.indexOf('### 0b');
assert.ok(recStart !== -1, 'SKILL.md must contain a recovery-branch section ("### 0b")');
const recEnd = skillSrc.indexOf('### 1.', recStart);
assert.ok(recEnd !== -1, 'the recovery section must be followed by the fresh-start step "### 1"');
const recSection = skillSrc.slice(recStart, recEnd);

test('contract — SKILL.md contains a recovery branch (measure recovery_branch ≥ 1)', () => {
  const count = (skillSrc.match(/recovery/g) ?? []).length;
  assert.ok(count >= 1, `SKILL.md must mention "recovery" at least once (got ${count})`);
  assert.ok(recSection.includes('Recovery branch'), 'the recovery section must be titled as a branch');
});

test('AC1 — the skill routes recovery-vs-fresh-start on the three-check precondition (both directions)', () => {
  // Recovery is selected INSTEAD of fresh-start when a mid-flight state is present...
  assert.ok(recSection.includes('Select recovery (NOT fresh-start)'),
    'the skill must say recovery is selected instead of fresh-start');
  assert.match(recSection, /at least one of the three state classes/,
    'recovery selection must require a positive mid-flight finding');
  // ...and ALL THREE CLEAN routes to fresh-start (the negative direction).
  assert.match(recSection, /ALL THREE CLEAN/, 'all-clean must route to the fresh-start branch');
  assert.ok(recSection.includes('fresh-start branch (steps 1-9)'),
    'the all-clean direction must name fresh-start steps 1-9');
  // ANY finding routes to recovery (the positive direction).
  assert.match(recSection, /ANY finding/, 'any finding must route to the recovery steps');
  assert.ok(recSection.includes('recovery steps below'), 'the any-finding direction must point at the recovery steps');
  // The two branches are alternatives, never a parallel process.
  assert.ok(recSection.includes('converge THEN cold-start'),
    'recovery must converge, then enter the same tick loop — not a parallel process');
});

test('AC2 — all three state classes are detected via EXISTING tools, zero new detection logic', () => {
  // The three state classes are named explicitly.
  for (const cls of ['mid-flight worktree', 'ghost telemetry', 'task-status drift']) {
    assert.ok(recSection.includes(cls), `the recovery branch must name the "${cls}" state class`);
  }
  // Detection reuses the existing tools — no new detector names.
  assert.ok(recSection.includes('git worktree list'), 'mid-flight worktrees must enumerate via `git worktree list`');
  assert.ok(recSection.includes('git branch --list "task/*"'), 'mid-flight branches must enumerate via `git branch --list "task/*"`');
  assert.ok(recSection.includes('git merge-base --is-ancestor'), 'orphan verification must reuse `git merge-base --is-ancestor`');
  assert.ok(recSection.includes('fast-mode-telemetry.ts --report --json'), 'ghost telemetry must reuse `fast-mode-telemetry.ts --report --json`');
  assert.ok(recSection.includes('task-status-drift-check.ts'), 'task-status drift must reuse `task-status-drift-check.ts`');
  assert.ok(recSection.includes('--reconcile'), 'ghost telemetry resolution must reuse `fast-mode-telemetry.ts --reconcile`');
  // zero_new_detection: every backticked script/tool the recovery section references resolves to an
  // EXISTING file on disk (bare-filename convention resolves under plugin/scripts/; git commands are
  // not .ts/.sh files and are ignored). A fabricated "new detection" script would not exist here.
  const refs = [...recSection.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const scriptRefs = refs.map((r) => r.match(/([\w./-]+\.(?:ts|sh|mjs|js))/)).filter(Boolean).map((m) => m[1]);
  assert.ok(scriptRefs.length >= 4,
    `expected the recovery section to reference ≥4 existing scripts/tools, got ${scriptRefs.length}: ${scriptRefs.join(', ')}`);
  for (const ref of scriptRefs) {
    const base = ref.split('/').pop();
    const resolved = [
      path.join(pluginDir, 'scripts', base),
      path.join(pluginDir, base),
      path.join(pluginDir, '..', 'scripts', base),
    ].some((p) => fs.existsSync(p));
    assert.ok(resolved, `recovery branch must only reference EXISTING tools, got "${ref}"`);
  }
});

test('AC3 — recovery converges into the SAME AC8c checklist as fresh-start (no second acceptance framework)', () => {
  assert.match(recSection, /SAME AC8c/, 'recovery must converge into the SAME AC8c checklist as fresh-start');
  assert.match(recSection, /no second acceptance framework/, 'recovery must not invent a separate acceptance framework');
  // The fresh-start checklist is unchanged: the five AC8c keys are still in the skill
  // (MONITORS-MOUNTED / MONITORS-DELIVERING retired with session-liveness, 2026-09-03).
  for (const key of ['CRON-CREATED', 'INNER-DRIVEN',
    'TELEMETRY-RECORD', 'FIRST-TASK', 'TOPOLOGY-IN-PLACE']) {
    assert.ok(skillSrc.includes(key), `fresh-start AC8c checklist must be preserved (${key})`);
  }
});

test('AC4 — negative control: a genuinely clean workspace takes the fresh-start branch, not recovery', () => {
  // The routing must NOT false-positive: recovery selection requires a positive mid-flight finding;
  // a clean workspace (all three checks clean) falls through to fresh-start.
  assert.ok(recSection.includes('ALL THREE CLEAN'), 'all-clean (no mid-flight state) must route to fresh-start');
  assert.ok(recSection.includes('fresh-start branch (steps 1-9)'),
    'an all-clean workspace must take the fresh-start branch, never recovery');
  assert.match(recSection, /at least one of the three state classes/,
    'recovery selection must require at least one positive finding');
});

test('AC5 — this file is node:test and declared @test-group product (skill/operational infra)', () => {
  const self = fs.readFileSync(new URL(import.meta.url), 'utf8');
  assert.match(self, /@test-group product/, 'recovery tests must declare `// @test-group product`');
  assert.match(self, /import \{ test \} from ['"]node:test['"]/, 'recovery tests must use node:test');
});
