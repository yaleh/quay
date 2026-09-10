// @test-group engine
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 real-install e2e (quay-init → python3 children); install family flake rotation; re-split lowconc 2026-08-12 (fixture-amortized — gap-suite-tiering-kind-heavy-not-a-mechanism)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each --loop test spawns a real quay-init.sh → python3 children. The install/quay-init family
// rotated flakes across groups under full-suite load, so the whole family is consolidated into the
// concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// GROUP NOTE (gap-serial-group-recompose-nested-runner-criterion → gap-install-family-tests-rotate-
// flakes-under-full-suite): routed to `serial`, not `lowconc`. The old criterion routed
// load-sensitive-but-not-nested files to lowconc; the family then rotated flakes across groups under
// full-suite load, so the serial criterion was extended to admit the install/quay-init family's
// real-install e2e and the family was consolidated into the concurrency-1 serial phase. The laydown
// template (one real install per file process) keeps each file's serial cost bounded.
// quay-init-loop-driver.test.mjs — split out of quay-init-loop.test.mjs (2026-08-07 inner red-window
// fix). The original 54-test single file exhausted the node:test worker event loop under heavy
// blocking spawnSync, self-failing at ~167s with 'Promise resolution is still pending'. Each split
// file keeps < ~19 tests, under the exhaustion threshold. Shared helpers in quay-init-loop-helpers.mjs.
// gap-quay-init-laydown-dominant-red-suite-blocker root-cause verdict 2026-08-07.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTmp, cleanup, diskWorktreeRoot, runInit, extractRefs, declaredSet, pluginDir, laydownWorkspace } from "./quay-init-loop-helpers.mjs";

// gap-the-tick-doc-ships-three-contradictory-loop-drivers
// 外层 tick 文档只声明一个循环驱动（CronCreate）；另外两个（ScheduleWakeup / /loop Nm）被显式处置。
// 双触发/不触发用 loop-driver-check.sh 机械检出（AC4/AC5/AC6）。
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const TICK_DOC = path.join(pluginDir, 'loop', 'orchestrator-loop-tick.md');
const DRIVER_TOKENS = ['CronCreate', 'ScheduleWakeup'];
const LOOP_NM_RE = /\/loop\s+[0-9]+m/;

function distinctDriverMechanisms(text) {
  const mechs = new Set(DRIVER_TOKENS.filter((t) => text.includes(t)));
  if (LOOP_NM_RE.test(text)) mechs.add('loop-interval');
  return mechs;
}

// ── AC1: the doc declares exactly ONE loop-driving mechanism ────────────────────────────────────────
test('AC1 — the outer tick doc declares exactly ONE loop-driving mechanism (CronCreate)', () => {
  const src = fs.readFileSync(TICK_DOC, 'utf8');
  assert.deepEqual([...distinctDriverMechanisms(src)].sort(), ['CronCreate'],
    'the outer tick doc must declare exactly one driver mechanism: CronCreate. ScheduleWakeup and /loop Nm are banned (AC1 band=1)');
});

test('AC1 (laid-down) — the rendered outer tick doc also declares exactly one driver after substitution', () => {
  // AC2 (gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles): this install
  // test now runs from the shared READ-ONLY laydown template (one real quay-init --loop per file)
  // instead of a fresh real install per test — the laid-down state is byte-identical, so the
  // assertion surface is unchanged.
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const outer = fs.readFileSync(path.join(ws, 'orchestration', 'orchestrator-loop-tick.md'), 'utf8');
    assert.deepEqual([...distinctDriverMechanisms(outer)].sort(), ['CronCreate'],
      'the laid-down outer tick doc must also declare exactly one driver (the negative control survives shipping)');
    assert.ok(outer.includes('loop-driver-check.sh'), 'the laid-down doc must reference the single-driver check (canonical bare script; 40→6 reverted — re-instate quay-suite.ts on re-merge)');
  } finally { cleanup(ws); }
});

test('AC1 (skill) — the cold-start skill\'s only driver is CronCreate and it enforces the single-driver check', () => {
  const skill = fs.readFileSync(path.join(pluginDir, 'skills', 'cold-start', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('CronCreate'), 'the skill re-creates the cron via CronCreate');
  assert.ok(!skill.includes('ScheduleWakeup'), 'the skill must NOT instruct ScheduleWakeup (AC3 dispose)');
  assert.ok(!LOOP_NM_RE.test(skill), 'the skill must NOT instruct a /loop Nm invocation (AC3 dispose)');
  // 40→6 consolidation (SPEC-instruments-behind-one-entry.md) was reverted (7642849a,
  // gap-forty-to-six-remerge-needs-tests-updated-first): the skill invokes the check via the
  // canonical bare script `loop-driver-check.sh` (NOT the grouped entry `quay-suite.ts
  // loop-driver-check`). The test asserts the SAME command name the skill uses (AC2: docs and tests
  // must not each write their own). Re-instate the `quay-suite.ts` form when 40→6 is re-merged.
  assert.match(skill, /loop-driver-check\.sh/, 'the skill must run the single-driver check');
  assert.match(skill, /LIVE/, 'the skill must require the check to report LIVE');
  assert.match(skill, /double-trigger/i, 'the skill must name the double-trigger it prevents');
});

// ── AC4/AC5/AC6: loop-driver-check.sh — LIVE / DOUBLE-TRIGGER / STALLED ──────────────────────────────
const driverReg = (ws) => path.join(ws, '.quay', 'loop-driver.jsonl');
function writeDriver(ws, mech = 'cron', interval = '*/20 * * * *') {
  fs.mkdirSync(path.join(ws, '.quay'), { recursive: true });
  fs.appendFileSync(driverReg(ws), JSON.stringify({ mechanism: mech, interval, source: 'cold-start' }) + '\n', 'utf8');
}
function runDriverCheck(ws) {
  return spawnSync('bash', [path.join(ws, 'plugin', 'scripts', 'loop-driver-check.sh'), ws],
    { cwd: ws, encoding: 'utf8' });
}

test('AC4 — loop-driver-check.sh is laid down by quay-init --loop', () => {
  const { ws } = laydownWorkspace();
  try {
    assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'loop-driver-check.sh')),
      'loop-driver-check.sh must be laid down with the loop mechanism');
  } finally { cleanup(ws); }
});

test('AC6 — zero drivers = STALLED (the loop will never tick), exit 3', () => {
  const { ws } = laydownWorkspace();
  try {
    const c = runDriverCheck(ws);
    assert.equal(c.status, 3, `no driver must be STALLED (exit 3), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /STALLED/, 'must report STALLED, not "all normal"');
  } finally { cleanup(ws); }
});

test('AC4 — exactly one cron driver = LIVE, exit 0 (end-to-end: one trigger source)', () => {
  const { ws } = laydownWorkspace();
  try {
    writeDriver(ws, 'cron');
    const c = runDriverCheck(ws);
    assert.equal(c.status, 0, `one cron driver must be LIVE (exit 0), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /LIVE/, 'must report LIVE');
    assert.match(c.stdout, /\(1\)/, 'must report count 1');
  } finally { cleanup(ws); }
});

test('AC5 — a second driver = DOUBLE-TRIGGER, exit 4 (double-trigger negative control)', () => {
  const { ws } = laydownWorkspace();
  try {
    writeDriver(ws, 'cron');          // step 4: CronCreate
    writeDriver(ws, 'loop');          // §4a relapse: a second /loop driver
    const c = runDriverCheck(ws);
    assert.equal(c.status, 4, `two drivers must be DOUBLE-TRIGGER (exit 4), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /DOUBLE-TRIGGER/, 'must report DOUBLE-TRIGGER');
  } finally { cleanup(ws); }
});

test('AC6 (remove direction) — removing the only driver is detected as STALLED, not "all normal"', () => {
  const { ws } = laydownWorkspace();
  try {
    writeDriver(ws, 'cron');
    assert.equal(runDriverCheck(ws).status, 0, 'precondition: one driver is LIVE');
    fs.rmSync(driverReg(ws), { force: true });
    const c = runDriverCheck(ws);
    assert.equal(c.status, 3, `removing the only driver must be STALLED (exit 3), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /STALLED/, 'must report STALLED — silence is exactly what the non-trigger control forbids');
  } finally { cleanup(ws); }
});

test('AC3 — a disposed mechanism cannot become the sole driver (BANNED-MECHANISM, exit 5)', () => {
  const { ws } = laydownWorkspace();
  try {
    writeDriver(ws, 'wakeup');        // the disposed self-paced wakeup as the only driver
    const c = runDriverCheck(ws);
    assert.equal(c.status, 5, `a non-cron sole driver must be BANNED-MECHANISM (exit 5), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /BANNED-MECHANISM/, 'must report BANNED-MECHANISM');
  } finally { cleanup(ws); }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down
// referenced-set ⊆ landed-set, mechanically enforced (AC1/AC2/AC3/AC4/AC6/AC7/AC8/AC9).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const INIT_LOOP_ARGS = ['--loop', '--root', 'WS', '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0'];

// AC1/AC4 — after a real --loop install, EVERY plugin/scripts/* reference in the shipped skills +
// tick docs exists in the target (missing_after_install = 0). The referenced set is non-empty —
// a check that only ever sees the empty set is indistinguishable from one that sees nothing.
test('AC1/AC4 — every plugin/scripts/* reference in the shipped skills/tick docs lands after --loop (missing_after_install = 0)', () => {
  // AC2 (gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles): runs from the
  // shared READ-ONLY laydown template — install result is the template's captured stdout/stderr
  // (rewritten to this copy's path), laid-down state is byte-identical to a fresh real install.
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /verify-referenced-landed: OK/, 'quay-init must run the referenced⊆landed check and report OK');
    const refs = extractRefs(pluginDir, 'plugin/scripts');
    assert.ok(refs.length > 0, 'the referenced set must be non-empty (the check is not verifying the empty set)');
    for (const ref of refs) {
      assert.ok(fs.existsSync(path.join(ws, ref)), `referenced script must exist after install: ${ref}`);
    }
  } finally { cleanup(ws); }
});

// AC2 — the check must REPORT a real live specimen (send-keys-reliable.sh) when it is absent from
// the landing set. Reproduce the pre-fix state in a plugin copy by removing it from the shipped
// scripts dir (referenced by cold-start, unable to land) — the check names it and fails the install.
// NOTE: quay-topology.sh was a prior specimen, retired with the outer tmux session
// (gap-retire-outer-tmux-window-logic); send-keys-verified.sh was layer-retired by
// gap-cold-start-ac8c-key4 (key 4 now teaches send-keys-reliable.sh) — the specimen is the current
// live replacement.
test('AC2 — the check reports the live specimen (send-keys-reliable.sh) when it cannot land', () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.rmSync(path.join(src, 'scripts', 'send-keys-reliable.sh'), { force: true });
    const ws = makeTmp();
    try {
      const args = INIT_LOOP_ARGS.map((a) => (a === 'WS' ? ws : a));
      const r = runInit(ws, args, src);
      assert.notEqual(r.status, 0, 'the check must FAIL when a referenced script cannot land');
      assert.match(r.stderr, /send-keys-reliable\.sh/, 'must name send-keys-reliable.sh');
      assert.match(r.stderr, /referenced-not-landed/, 'must use the referenced-not-landed category');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// AC3 — bidirectional negative control: a skill reference to a script that does not ship ⇒ the
// check reports it; remove the reference ⇒ the check passes. Both directions.
test('AC3 — bidirectional control: an unlanded script reference is reported; removing it passes', () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    const skillPath = path.join(src, 'skills', 'cold-start', 'SKILL.md');
    const orig = fs.readFileSync(skillPath, 'utf8');
    // fail direction: add a call to a script that does not exist in plugin/scripts/.
    fs.writeFileSync(skillPath, `${orig}\nbash <root>/plugin/scripts/ghost-check.sh --does-not-exist\n`);
    const ws = makeTmp();
    try {
      const args = INIT_LOOP_ARGS.map((a) => (a === 'WS' ? ws : a));
      const r = runInit(ws, args, src);
      assert.notEqual(r.status, 0, 'a new unlanded script call must FAIL the check');
      assert.match(r.stderr, /ghost-check\.sh/, 'the failure must name the missing script');
      assert.match(r.stderr, /referenced-not-landed/, 'must use the referenced-not-landed category');
    } finally { cleanup(ws); }
    // pass direction: remove the call → the check passes again.
    fs.writeFileSync(skillPath, orig);
    const ws2 = makeTmp();
    try {
      const args2 = INIT_LOOP_ARGS.map((a) => (a === 'WS' ? ws2 : a));
      const r2 = runInit(ws2, args2, src);
      assert.equal(r2.status, 0, `removing the call must pass the check:\n${r2.stderr}`);
      assert.match(r2.stdout, /verify-referenced-landed: OK/, 'must report the check passing after removal');
    } finally { cleanup(ws2); }
  } finally { cleanup(src); }
});

// AC7 — the check covers orchestration/* and docs/analysis/* too. Every referenced file must be
// either landed in the target, or declared self-create / reference-doc in init/SKILL.md. Nothing
// may be referenced yet unaccounted-for (that would be drift the two-hand-maintained-lists check
// exists to catch).
test('AC7 — every orchestration/* and docs/analysis/* reference is landed or declared (complete classification)', () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const selfcreate = declaredSet(pluginDir, 'self-create');
    const refdoc = declaredSet(pluginDir, 'reference-doc');
    assert.ok(selfcreate.size > 0, 'init/SKILL.md must declare at least the local-state self-create files');
    assert.ok(refdoc.size > 0, 'init/SKILL.md must declare the quay reference-doc class');
    const refs = [...extractRefs(pluginDir, 'plugin/scripts'), ...extractRefs(pluginDir, 'orchestration'), ...extractRefs(pluginDir, 'docs/analysis')];
    assert.ok(refs.length > 0, 'the referenced set must be non-empty');
    for (const ref of refs) {
      const landed = fs.existsSync(path.join(ws, ref));
      const declared = selfcreate.has(ref) || refdoc.has(ref);
      assert.ok(landed || declared, `referenced file must be landed OR declared: ${ref}`);
    }
  } finally { cleanup(ws); }
});

// AC8 — local-state files are NOT shipped as empty factory copies (which would break the
// byte-identical upgrade check), and are declared self-create in init/SKILL.md with a command.
test('AC8 — local-state files are not shipped empty; they are declared self-create with a command', () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    // The local-state files must NOT be laid down by --loop (no empty factory copies).
    for (const f of ['orchestration/tick-log.md', 'orchestration/escalations.md',
      'docs/analysis/batch2-queue-state.md', 'docs/analysis/contract-violations.md']) {
      assert.ok(!fs.existsSync(path.join(ws, f)), `local-state file must NOT be shipped empty: ${f}`);
    }
    // The shipped init skill declares them self-create and gives the self-create command.
    const selfcreate = declaredSet(pluginDir, 'self-create');
    for (const f of ['orchestration/tick-log.md', 'orchestration/escalations.md',
      'docs/analysis/batch2-queue-state.md', 'docs/analysis/contract-violations.md']) {
      assert.ok(selfcreate.has(f), `must be declared self-create: ${f}`);
    }
    const initSkill = fs.readFileSync(path.join(pluginDir, 'skills', 'init', 'SKILL.md'), 'utf8');
    assert.match(initSkill, /Self-create command/, 'the declaration must give the self-create command');
    assert.match(initSkill, /touch orchestration\/tick-log\.md/, 'must give the self-create command for tick-log.md');
    assert.match(initSkill, /byte-identical upgrade check/, 'must state why empty copies are not shipped');
  } finally { cleanup(ws); }
});

// AC6 — quay-init.sh self-resolves its plugin root from its own path when the host does not inject
// CLAUDE_PLUGIN_ROOT (the documented Skill call), and still fails closed on an unusable root.
test('AC6 — quay-init self-resolves the plugin root without CLAUDE_PLUGIN_ROOT, and fails closed on a bad root', () => {
  const ws = makeTmp();
  try {
    const script = path.join(pluginDir, 'scripts', 'quay-init.sh');
    const env = { ...process.env };
    delete env.CLAUDE_PLUGIN_ROOT;
    const args = ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
      '--tmux-session', 'proj-0:0.0', '--worktree-root', diskWorktreeRoot()];
    const r = spawnSync('bash', [script, ...args], { cwd: ws, encoding: 'utf8', env });
    assert.equal(r.status, 0, `self-resolved init must exit 0:\n${r.stderr}`);
    assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'resource-gate.sh')), 'the loop mechanism must still land');
    // Fail-closed retained: a bad plugin root aborts, never a silent wrong path.
    const bad = spawnSync('bash', [script, ...args, '--plugin-root', '/nonexistent/plugin'],
      { cwd: ws, encoding: 'utf8', env });
    assert.equal(bad.status, 2, 'a bad plugin root must fail closed (exit 2)');
    assert.match(bad.stderr, /not a quay plugin/, 'must name the invalid plugin root');
  } finally { cleanup(ws); }
});

