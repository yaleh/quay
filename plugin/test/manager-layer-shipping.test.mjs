// @test-group governance
// manager-layer-shipping.test.mjs — gap-productize-the-manager-layer, AC1/AC2/AC3/AC4/AC5/AC6/AC7/AC8.
//
// The THIRD (manager) layer exists in practice (three layers run) but only two shipped — the manager
// mechanisms were all quay-local in orchestration/. This test pins the productization facts:
//
//   AC1/AC2 — plugin/skills/manager/SKILL.md exists (the Contract measure `third_layer_shipped` =
//             `ls plugin/skills/manager/` non-empty), crystallizing the cadence (daily review), the
//             three functions (planning / prioritization / trend), and the two verified rules
//             (§1.5 ask-vs-act, §1.6 event triage) — installable under plugin/, not quay-local.
//   AC3     — cold-start plugin/skills/cold-start/SKILL.md AC8c: the two dead keys
//             (`inner-state.sh`, the superseded send-keys pane-hash) are gone — grep
//             `inner-state.sh\|send-keys-verified` → 0 hits. (Key 4 was already fixed by
//             gap-cold-start-ac8c-key4-teaches-superseded-send-keys-hash; this pins the remaining
//             dead-key cleanup + the AC-SH1–4 no-longer-blocked mechanical proof.)
//   AC4     — the launch-config trio ships in the checked-in `.claude/launch.settings.json`
//             (`claude-fjdac` launcher + `--model deepseek-v4-flash` + env
//             `CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000`) and is referenced by the cold-start skill
//             (never a hand-typed shell one-liner).
//   AC5     — the manager planning function hangs a LIVE fast-mode strategic reference
//             (docs/proposals/fast-mode-cross-project-portability.md), not the SUPERSEDED roadmap.
//   AC6     — the manager SKILL indexes the orchestration/SPEC-*.md methodology sources
//             (index only, no batch crystallization) — every on-disk SPEC is listed.
//   AC7     — this file is node:test + // @test-group governance.
//   AC8     — delivery vs startup independence: the plugin SHIPS the manager layer (the file above),
//             but the project cold-start does NOT start it — quay-topology.sh builds only
//             `outer inner`, and the cold-start TOPOLOGY-IN-PLACE key states manager is NOT part of
//             the project topology (one network = one manager).
//
// Run:
//   scripts/test.sh plugin/test/manager-layer-shipping.test.mjs
//   node --test plugin/test/manager-layer-shipping.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginDir, '..');

const MANAGER_SKILL = path.join(pluginDir, 'skills', 'manager', 'SKILL.md');
const COLD_START_SKILL = path.join(pluginDir, 'skills', 'cold-start', 'SKILL.md');
const LAUNCH_SETTINGS = path.join(repoRoot, '.claude', 'launch.settings.json');
const TOPOLOGY_FACTORY = path.join(pluginDir, 'scripts', 'quay-topology.sh');
const PORTABILITY_DOC = path.join(repoRoot, 'docs', 'proposals', 'fast-mode-cross-project-portability.md');
const SPEC_DIR = path.join(repoRoot, 'orchestration');

// ── AC1/AC2: the manager layer ships as plugin/skills/manager/SKILL.md ──────────────────────────────
test('AC1/AC2 — plugin/skills/manager/SKILL.md exists (third_layer_shipped non-empty) and crystallizes cadence + three functions + two rules', () => {
  const mgrDir = path.dirname(MANAGER_SKILL);
  assert.ok(fs.existsSync(mgrDir), 'plugin/skills/manager/ must exist');
  const entries = fs.readdirSync(mgrDir);
  assert.ok(entries.length >= 1, `ls plugin/skills/manager/ must be non-empty (Contract measure third_layer_shipped), got: ${JSON.stringify(entries)}`);
  assert.ok(entries.includes('SKILL.md'), 'plugin/skills/manager/SKILL.md must be the shipped artifact');
  const src = fs.readFileSync(MANAGER_SKILL, 'utf8');
  assert.ok(src.trim().length > 500, 'the manager SKILL must carry real content, not a stub');

  // cadence = daily review
  assert.match(src, /每日复盘|daily review/, 'manager SKILL must crystallize the daily-review cadence (AC1)');
  // three functions: planning / prioritization / trend
  for (const fn of ['规划', '排序', '看趋势']) {
    assert.ok(src.includes(fn), `manager SKILL must crystallize the ${fn} function (AC1 three functions)`);
  }
  // two verified rules: §1.5 ask-vs-act + §1.6 event triage
  assert.match(src, /1\.5|ask-vs-act/, 'manager SKILL must carry the §1.5 ask-vs-act rule');
  assert.match(src, /1\.6|事件 triage|事件的分级处置/, 'manager SKILL must carry the §1.6 event-triage rule');
});

// ── AC3: cold-start AC8c dead keys are gone ─────────────────────────────────────────────────────────
test('AC3 — cold-start/SKILL.md AC8c has no dead-key references (inner-state.sh / send-keys pane-hash → 0 hits)', () => {
  const src = fs.readFileSync(COLD_START_SKILL, 'utf8');
  const deadKeyRe = /inner-state\.sh|send-keys-verified/;
  const hits = src.split('\n').map((l, i) => ({ i: i + 1, l })).filter(({ l }) => deadKeyRe.test(l));
  assert.deepEqual(hits, [], 'cold-start AC8c must contain NO dead-key reference (inner-state.sh, send-keys-verified) — the live observer is session-liveness.sh, the live delivery check is transcript-delivery-check.ts');
  // Positive control: the live mechanisms ARE present (the check must keep resolving power).
  assert.match(src, /session-liveness-mount\.sh/, 'cold-start must reference the live observer mount (session-liveness-mount.sh)');
  assert.match(src, /send-keys-reliable\.sh/, 'cold-start must reference the live reliable-send mechanism (send-keys-reliable.sh)');
});

// ── AC4: the launch-config trio ships in the checked-in settings file ───────────────────────────────
test('AC4 — the launch-config trio is checked-in (.claude/launch.settings.json): claude-fjdac + deepseek-v4-flash + CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000', () => {
  assert.ok(fs.existsSync(LAUNCH_SETTINGS), '.claude/launch.settings.json must exist (checked-in launch config)');
  const src = fs.readFileSync(LAUNCH_SETTINGS, 'utf8');
  assert.match(src, /claude-fjdac/, 'launch config must use the claude-fjdac launcher');
  assert.match(src, /deepseek-v4-flash/, 'launch config must set --model deepseek-v4-flash');
  assert.match(src, /CLAUDE_CODE_MAX_CONTEXT_TOKENS/, 'launch config must set CLAUDE_CODE_MAX_CONTEXT_TOKENS');
  assert.match(src, /917000/, 'CLAUDE_CODE_MAX_CONTEXT_TOKENS must be 917000');
  // The cold-start skill must document the launch config as checked-in (tribal knowledge → installable).
  const cold = fs.readFileSync(COLD_START_SKILL, 'utf8');
  assert.match(cold, /launch\.settings\.json/, 'cold-start skill must reference the checked-in launch config');
  assert.match(cold, /quay-launch\.sh/, 'cold-start skill must reference quay-launch.sh (never a hand-typed one-liner)');
});

// ── AC5: the manager planning function hangs a LIVE strategic reference ─────────────────────────────
test('AC5 — the manager SKILL planning function hangs the live fast-mode strategic reference (not the SUPERSEDED roadmap)', () => {
  const src = fs.readFileSync(MANAGER_SKILL, 'utf8');
  assert.ok(fs.existsSync(PORTABILITY_DOC), 'the strategic anchor doc must exist (docs/proposals/fast-mode-cross-project-portability.md)');
  assert.ok(src.includes('fast-mode-cross-project-portability.md'), 'manager SKILL planning function must reference the live portability strategic doc');
  assert.match(src, /SUPERSEDED|ADR-022/, 'manager SKILL must mark the old roadmap as superseded (not a live anchor)');
});

// ── AC6: the manager SKILL indexes the SPEC-*.md methodology sources ────────────────────────────────
test('AC6 — the manager SKILL indexes every on-disk orchestration/SPEC-*.md (index only, no batch crystallization)', () => {
  const specs = fs.readdirSync(SPEC_DIR).filter((f) => /^SPEC-.*\.md$/.test(f)).sort();
  assert.ok(specs.length >= 11, `expected ≥11 SPEC files, got ${specs.length}: ${JSON.stringify(specs)}`);
  const src = fs.readFileSync(MANAGER_SKILL, 'utf8');
  for (const spec of specs) {
    assert.ok(src.includes(spec), `manager SKILL must index ${spec} as a methodology source (AC6) — add "${spec}" to the SPEC index section of ${MANAGER_SKILL}`);
  }
  assert.match(src, /不批量|逐个按需/, 'the index must state SPECs are not batch-crystallized (AC6)');
});

// ── AC8: delivery vs startup independence — the plugin ships the manager, the cold-start does NOT start it ──
test('AC8 — cold-start must NOT start the manager (one network = one manager); the topology factory builds only outer+inner', () => {
  const cold = fs.readFileSync(COLD_START_SKILL, 'utf8');
  // The TOPOLOGY-IN-PLACE key must state manager is NOT part of the project topology.
  assert.match(cold, /manager is cross-project and NOT part of this topology|manager 跨项目|manager is cross-project/,
    'cold-start TOPOLOGY-IN-PLACE must state manager is NOT part of the project topology (AC8)');
  // The cold-start must NOT instruct creating/driving a manager window.
  const managerStartHits = cold.split('\n').filter((l) => /manager/i.test(l) && /(quay-launch\.sh manager|:manager|manager 窗口|manager window)/i.test(l));
  assert.deepEqual(managerStartHits, [], 'cold-start must not instruct starting a manager window (AC8)');

  // The topology factory builds outer + inner only (the manager is not a project-topology window).
  assert.ok(fs.existsSync(TOPOLOGY_FACTORY), 'plugin/scripts/quay-topology.sh must exist');
  const topo = fs.readFileSync(TOPOLOGY_FACTORY, 'utf8');
  assert.match(topo, /ROLES="outer inner"/, 'quay-topology.sh must build ONLY outer+inner windows (AC8)');
  assert.ok(!/ROLES=.*manager/.test(topo), 'quay-topology.sh must NOT include manager in the project-topology roles (AC8)');
});

// ── Contract measure guard: the shipping scan must not be starved ───────────────────────────────────
test('contract guard — the manager SKILL is not an empty shell and the cold-start corpus still resolves', () => {
  const mgr = fs.readFileSync(MANAGER_SKILL, 'utf8');
  const cold = fs.readFileSync(COLD_START_SKILL, 'utf8');
  assert.ok(mgr.split('\n').length >= 60, `manager SKILL must be a substantial doc (${mgr.split('\n').length} lines)`);
  assert.ok(cold.split('\n').length >= 150, `cold-start SKILL must remain a substantial doc (${cold.split('\n').length} lines)`);
});
