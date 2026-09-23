// @test-group engine
// manager-layer-skill.test.mjs — gap-productize-the-manager-layer, AC7.
// Pins the shipped manager layer (the THIRD layer) + the cold-start AC8c dead-key fix:
//   AC1 — plugin/skills/manager/SKILL.md exists and is registered in plugin.json commands[]
//         (the manager layer ships under plugin/, not quay-local in orchestration/).
//   AC2 — installability: a cold start on another machine gets the manager layer — the plugin
//         manifest lists it AND the quay-init referenced ⊆ landed invariant holds (a manager
//         SKILL that referenced a file quay-init does not lay down would fail the cold-start
//         gate's laydown-set rehearsal).
//   AC3 — the cold-start AC8c dead keys are gone: `grep 'inner-state.sh\|send-keys-verified'`
//         on plugin/skills/cold-start/SKILL.md is 0 hits (Contract invoke/control).
//   AC4 — the launch config 三件套 (claude-fjdac launcher + a PINNED model + CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000)
//         is in the checked-in deliverable (.claude/launch.settings.json + .quay/profiles.yml),
//         referenced by the manager skill's launch section.
//         ⛔ The specific model id is a runtime-environment value (drifts with the gateway's /v1/models
//         export) — asserted as "pinned + non-empty", never as a literal (see profile-policy.test.mjs AC3).
//   AC5 — the manager skill's planning function carries a live roadmap/strategic counterpart
//         reference (cross-project portability) + the strategic-doc-staleness mechanism.
//   AC6 — the manager skill lists the SPEC methodology sources as an index (referenced, not
//         batch-crystallized).
//   AC8 — delivery ≠ startup: plugin ships the manager, but the cold-start skill does NOT
//         start it (TOPOLOGY-IN-PLACE excludes manager; no cold-start step drives it).
//
// Run:
//   scripts/test.sh plugin/test/manager-layer-skill.test.mjs
//   node --test plugin/test/manager-layer-skill.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginDir, '..');

const managerSkillPath = path.join(pluginDir, 'skills', 'manager', 'SKILL.md');
const coldStartSkillPath = path.join(pluginDir, 'skills', 'cold-start', 'SKILL.md');
const managerSkill = fs.existsSync(managerSkillPath) ? fs.readFileSync(managerSkillPath, 'utf8') : '';
const coldStartSkill = fs.readFileSync(coldStartSkillPath, 'utf8');

// ── AC1 — the third layer exists and ships under plugin/ ─────────────────────────────────────────────
test('AC1 — the manager layer SKILL.md exists (the third layer ships under plugin/)', () => {
  assert.ok(fs.existsSync(managerSkillPath), 'plugin/skills/manager/SKILL.md must exist (AC1, Contract measure ls plugin/skills/manager/)');
  assert.match(managerSkill, /^name:\s*quay-manager/m, 'skill name must be quay-manager');
  const fm = managerSkill.match(/^allowed-tools:\s*(.+)$/m);
  assert.ok(fm, 'manager skill must declare allowed-tools');
  assert.ok(fm[1].includes('Bash'), 'manager skill must allow Bash');
});

test('AC1 — the manager skill is registered in plugin.json commands[] (installed on any plugin install)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.ok(manifest.commands.includes('./skills/manager/SKILL.md'),
    'plugin.json commands[] must register the manager skill');
});

// ── The three layers exist (AC7 — "三层存在") ─────────────────────────────────────────────────────
test('AC7 — the three layers exist: outer + inner tick docs + the manager skill', () => {
  const outer = path.join(pluginDir, 'loop', 'orchestrator-loop-tick.md');
  const inner = path.join(pluginDir, 'loop', 'fast-mode-loop-tick.md');
  assert.ok(fs.existsSync(outer), 'outer layer (plugin/loop/orchestrator-loop-tick.md) must exist');
  assert.ok(fs.existsSync(inner), 'inner layer (plugin/loop/fast-mode-loop-tick.md) must exist');
  assert.ok(fs.existsSync(managerSkillPath), 'manager layer (plugin/skills/manager/SKILL.md) must exist');
});

// ── AC3 — the cold-start AC8c dead keys are gone (Contract invoke/control: 0 hits) ───────────────────
test('AC3 — the cold-start skill has ZERO inner-state.sh / send-keys-verified references (AC8c dead-key fix)', () => {
  const deadKeys = ['inner-state.sh', 'send-keys-verified'];
  for (const dead of deadKeys) {
    assert.ok(!coldStartSkill.includes(dead),
      `plugin/skills/cold-start/SKILL.md must not reference the dead key "${dead}" (Contract invoke: 0 hits)`);
  }
  // The live replacement is present: the reliable-send mechanism (send-keys-reliable.sh) for the
  // INNER-DRIVEN delivery criterion.
  assert.match(coldStartSkill, /send-keys-reliable\.sh/s,
    'the cold-start skill must drive inner via the reliable-send mechanism (key4 fix reused)');
});

// ── AC4 — the launch config 三件套 is in the deliverable ────────────────────────────────────────────
test('AC4 — the launch config 三件套 (launcher + a pinned model + CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000) is checked in', () => {
  const settingsPath = path.join(repoRoot, '.claude', 'launch.settings.json');
  assert.ok(fs.existsSync(settingsPath), '.claude/launch.settings.json must exist (checked-in deliverable)');
  const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(s.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '917000', 'env must carry the 917000 context (三件套 #1)');
  // AC154: launcher/model now live in .quay/profiles.yml (profile 抽层), not _launchSpec.
  const profilesPath = path.join(repoRoot, '.quay', 'profiles.yml');
  assert.ok(fs.existsSync(profilesPath), '.quay/profiles.yml must exist (AC154 profile carrier)');
  const py = spawnSync('python3', ['-c', 'import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', profilesPath], { encoding: 'utf8' });
  assert.equal(py.status, 0, `profiles.yml must parse as YAML:\n${py.stderr}`);
  const p = JSON.parse(py.stdout);
  const outerProf = p.profiles[p.roles.outer.profile];
  assert.equal(outerProf.launcher, 'claude-fjdac', 'outer role must use claude-fjdac launcher (三件套 #2)');
  // 三件套 #3 的意图是「outer **自己钉住** model，不留给 wrapper 的默认」—— 与具体模型名无关。
  // ⛔ 不钉字面量：模型名是运行环境取值（随网关导出集合漂移），钉住它只会在换模型时烂掉。
  assert.equal(typeof outerProf.model, 'string', 'outer role must PIN a model (三件套 #3: 不留给 wrapper 默认)');
  assert.ok(outerProf.model.length > 0, 'outer role model must be a non-empty id');
  // The manager skill references the launch config for the manager's own start (tribal → installable),
  // WITHOUT exposing the bare launcher script — a skill is the user-facing interface, the launcher is
  // skill-internal (gap-quay-launch-sh-is-a-user-facing-surface-should-be-skill-internal AC2/AC4).
  assert.match(managerSkill, /launch\.settings\.json/,
    'the manager skill must teach launching the manager via the checked-in launch config, not a hand-typed one-liner');
  assert.ok(!/quay-launch\.sh/.test(managerSkill),
    'the manager skill must NOT reference the bare launcher script (it is skill-internal; users interact via the skill)');
});

// ── AC5 — the planning function has a live roadmap/strategic counterpart ─────────────────────────────
test('AC5 — the manager skill planning function carries a live roadmap/strategic-counterpart reference', () => {
  assert.match(managerSkill, /cross-project portability strategic question|portability/i,
    'the planning function must reference a live cross-project portability strategic counterpart');
  assert.match(managerSkill, /strategic-doc-staleness-check\.ts/s,
    'the planning/cadence function must reference the strategic-doc-staleness mechanism (the roadmap-staleness probe)');
  assert.match(managerSkill, /gap-fast-mode-cross-project-portability-strategic-question/,
    'the planning function must reference the live fast-mode strategic question task (AC5)');
});

// ── AC6 — the SPEC methodology sources are indexed, not batch-crystallized ───────────────────────────
test('AC6 — the manager skill lists the SPEC methodology sources as an index', () => {
  assert.match(managerSkill, /Methodology sources \(SPEC index/m, 'the skill must have a SPEC-index section');
  assert.match(managerSkill, /SPEC-manager-productization-2026-08-05\.md/, 'the index must list the manager-productization SPEC');
  assert.match(managerSkill, /SPEC-outer-liveness-productization\.md/, 'the index must list the outer-liveness SPEC');
  assert.match(managerSkill, /SPEC-cold-start-one-liner\.md/, 'the index must list the cold-start-one-liner SPEC');
  // The index is an index, not a re-implementation — the skill references the sources.
  assert.match(managerSkill, /referenced, not batch-crystallized|not batch-crystallized/i,
    'the skill must state the SPECs are referenced, not batch-crystallized');
});

// ── AC8 — delivery ≠ startup: plugin ships manager, cold-start does NOT start it ─────────────────────
test('AC8 — the plugin ships the manager layer, but the cold-start skill does NOT start it', () => {
  // Delivery: the manager is in the plugin (AC1). Startup: the cold-start skill must not drive it.
  // TOPOLOGY-IN-PLACE explicitly excludes manager; the cold-start builds outer+inner only.
  assert.match(coldStartSkill, /manager is cross-project and NOT part of this topology/,
    'the cold-start TOPOLOGY-IN-PLACE key must state manager is NOT part of the project topology');
  assert.match(coldStartSkill, /two-window session topology|two-window/,
    'the cold-start must build a two-window (outer+inner) topology');
  // No cold-start step may instruct launching the manager session (delivery ≠ startup).
  assert.ok(!/quay-launch\.sh manager(?! --dry-run)/.test(coldStartSkill),
    'the cold-start skill must not instruct starting the manager session (quay-launch.sh manager)');
});

// ── The manager skill carries the two verified rules (§1.5 / §1.6) ──────────────────────────────────
test('AC1 — the manager skill crystallizes the two verified rules (§1.5 ask-vs-act, §1.6 event triage)', () => {
  // §1.5 ask-vs-act: implied-by-AC criterion.
  assert.match(managerSkill, /ask-vs-act/, 'the skill must name the §1.5 ask-vs-act rule');
  assert.match(managerSkill, /implied/i, 'the §1.5 criterion is "implied by my declared AC"');
  assert.match(managerSkill, /by an AC/i, 'the §1.5 criterion names the declared AC');
  assert.match(managerSkill, /Changing the AC itself/s, '§1.5 must say changing the AC itself ⇒ ask the human');
  // §1.6 event triage: only GONE/OVERDUE/NO-COMMIT are "should-have-moved-but-didn't".
  assert.match(managerSkill, /event triage/, 'the skill must name the §1.6 event triage rule');
  assert.match(managerSkill, /SESSION-RESUMED/, 'the triage table must cover SESSION-RESUMED');
  assert.match(managerSkill, /SESSION-GONE/, 'the triage table must cover SESSION-GONE');
  assert.match(managerSkill, /should have moved but didn.t/i, 'the §1.6 criterion must be stated');
});

// ── The manager skill is workspace-portable (no exp5/experiment-layout leak) ────────────────────────
test('AC7 — the manager skill carries no experiments/quay-perpetual-stream or exp5 references', () => {
  assert.ok(!/experiments\/quay-perpetual-stream|\bexp5\b/i.test(managerSkill),
    'the manager skill must be workspace-portable (no internal experiment-layout / exp5 leak)');
});
