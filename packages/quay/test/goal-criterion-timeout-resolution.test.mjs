// @test-group product
// gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout — the goal path's criterion
// kill deadline is RESOLVED (env / --timeout), not a private literal.
//
// THE DEFECT THIS PINS: `quay goal gate` and its three siblings ran every criterion under a
// hardcoded 60000ms deadline of their own (`goal-store.ts` carried four of them, plus a private
// `SWEEP_CRITERION_TIMEOUT_MS`), so `QUAY_ACCEPTANCE_TIMEOUT_MS` / a per-gate `timeoutMs` / the
// task gate's `--timeout` — the whole DIR-046 configuration surface that the TASK acceptance gate
// honours — had NO effect on a goal criterion. A legitimately-slow criterion (> 60s) was therefore
// killed every round with no knob able to save it (GOAL-002 AC-014, the filing instance: a ~348s
// criterion that passes, killed at 60s).
//
// WHAT MAKES THESE ASSERTIONS FALSIFIABLE (and why each one is written the way it is):
//   · Every reading is taken through a PRODUCTION carrier — the goal-store CLI, or the gate path's
//     own JSON output — on a REAL workspace, never by importing the resolver and asking it about
//     itself. A test that only asserted `resolveAcceptanceTimeoutMs()` would pass on a tree where
//     none of the four call sites had been changed (hard rule 4 corollary 3).
//   · `sleep 2` is the probe criterion THROUGHOUT: longer than the 1000ms deadline, shorter than
//     the 5000ms one. Each measurement is taken in BOTH directions, because a one-directional case
//     cannot distinguish "the fix works" from "the fixture was never able to fail".
//   · The deadline is asserted not only through the runner's reason text but through the ELAPSED
//     reading (`sweep.ran[].ms`, the activation cost line), because a reason string could in
//     principle be produced by something other than the deadline actually governing the run.
//
// The four entry points this file must cover separately (⛔ NOT one assertion about one function):
//   (a) `goal gate <id>`                     — the AC3/AC4 tests below
//   (b) the bounded rotation sweep           — the AC6 (b) test below
//   (c) the P6 activation check              — the AC6 (c) test below
//   (d) the I5 achieved-but-failing reverify — the AC6 (d) test below
// (c) and (d) do not SURFACE the runner's reason string (that verb's JSON shape is an id list and
// a cost line respectively), so they assert the deadline through the observable each one does
// expose — an outcome differential and an elapsed-ms reading. ⛔ Substituting a fourth
// `resolveAcceptanceTimeoutMs()` unit assertion for those two would be exactly the
// "four assertions about one function" shape this AC forbids.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { resolveAcceptanceTimeoutMs, DEFAULT_ACCEPTANCE_TIMEOUT_MS } from "../src/gate/config/utils.ts";
import { runAcceptance } from "../src/gate/acceptance-runner.ts";

const GOAL_STORE = new URL("../src/goal-store.ts", import.meta.url).pathname;
const QUAY_BIN = new URL("../bin/quay.js", import.meta.url).pathname;

const GOAL_BODY = "goal body: background, scope, non-goals and exit conditions — long enough to satisfy the 40-char minimum";
const EXPECT = "the expected outcome this criterion proves";
/** `sleep 2`: > the 1000ms probe deadline, < the 5000ms one. ⛔ Carries no bare failure exit, so the
 *  write surface's criterion-attribution gate accepts it (gap-criterion-attribution-write-gate-at-birth). */
const SLOW = "sleep 2";

const _dirs = [];
test.after(() => {
  for (const d of _dirs) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * A REAL workspace — the config is the provider map (CLAUDE.md: a bare `tasks/`/`goals/` directory
 * is NOT a legal workspace), and it is a git repo because the goal criterion's cwd is
 * `resolveGitRoot(goalDir)` (⛔ not `path.dirname` — hard rule 4 corollary 2). A non-git fixture
 * would exercise the fallback branch instead of the production one, and AC5 could not tell them
 * apart.
 */
function makeWorkspace(tag) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `goal-timeout-${tag}-`));
  _dirs.push(ws);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "goals"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    '    path: "."',
    '    mcp_entry: ["node", "mcp.js", "mcp"]',
    "    env: {}",
    "",
  ].join("\n"));
  const git = (...a) => execFileSync("git", ["-C", ws, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  return ws;
}

/**
 * Run the goal-store CLI against `ws` with a HERMETIC environment.
 *
 * ⛔ Two ambient variables would otherwise change what these tests measure, and both were observed
 * set in the developer shell while this file was written:
 *   · `QUAY_GOAL_ACCEPTANCE_ACTIVE` — the re-entrancy guard. It is INHERITED by children (that is
 *     how it bounds recursion), so any shell that has ever run a goal criterion keeps it, and every
 *     subprocess here would then REFUSE to run a criterion (`evaluated:false`) — which reads as
 *     "the fixture is wrong" rather than "the environment is dirty" (hard rule 3b).
 *   · `QUAY_ACCEPTANCE_*` — these ARE the knobs under test. An inherited value would make the
 *     "no env, no flag" assertion below a lie.
 */
function goal(ws, args, env = {}) {
  const childEnv = { ...process.env };
  for (const k of [
    "QUAY_GOAL_ACCEPTANCE_ACTIVE",
    "QUAY_ACCEPTANCE_TIMEOUT_MS",
    "QUAY_ACCEPTANCE_CWD",
    "QUAY_ACCEPTANCE_ENV",
  ]) delete childEnv[k];
  Object.assign(childEnv, env);
  return spawnSync("node", ["--experimental-strip-types", GOAL_STORE, "--root", ws, ...args], {
    encoding: "utf8",
    env: childEnv,
  });
}

/** Write a record, asserting the fixture write itself succeeded — a silently-failed setup write
 *  would otherwise surface as a confusing downstream assertion instead of naming itself. */
function write(ws, args, label) {
  const r = goal(ws, ["write", ...args]);
  assert.equal(r.status, 0, `fixture setup: ${label} must be written:\n${r.stdout}${r.stderr}`);
  return r;
}

/** AC FIRST, then its GOAL: an AC may name a GOAL that does not exist yet, while a GOAL in
 *  {draft, active} must already be named by ≥1 AC — so this order is legal at every instant. */
function seedGoal(ws, goalId, acSpecs) {
  for (const [acId, spec] of acSpecs) {
    write(ws, [
      acId, "--title", acId, "--status", spec.status, "--goal", goalId,
      "--criterion", spec.criterion, "--origin", "test fixture", "--expect", EXPECT,
      ...(spec.longTerm ? ["--long-term", "true"] : []),
    ], `${acId} (${spec.status})`);
  }
  write(ws, [goalId, "--title", goalId, "--status", "achieved", "--origin", "test fixture", "--body", GOAL_BODY], goalId);
}

// ── (a) `goal gate <id>` — goal-store.ts's own `gate` verb ────────────────────────────────────────

test("AC3 — QUAY_ACCEPTANCE_TIMEOUT_MS 生效：同一判据在 1000ms 下被 kill、在 5000ms 下通过（两个方向）", () => {
  const ws = makeWorkspace("env");
  seedGoal(ws, "GOAL-900", [["AC-900", { status: "draft", criterion: SLOW }]]);

  const short = goal(ws, ["gate", "AC-900", "--dry-run", "--json"], { QUAY_ACCEPTANCE_TIMEOUT_MS: "1000" });
  const s = JSON.parse(short.stdout);
  assert.equal(s.verdict, "fail", `1000ms < sleep 2 ⇒ must be killed:\n${short.stdout}${short.stderr}`);
  assert.match(s.reason, /timed out after 1000ms/, `reason names the deadline that killed it: ${s.reason}`);
  assert.equal(s.timeoutMs, 1000, "the printed JSON reports the deadline that governed the run");
  assert.equal(short.status, 1, "a failing criterion exits 1");

  const long = goal(ws, ["gate", "AC-900", "--dry-run", "--json"], { QUAY_ACCEPTANCE_TIMEOUT_MS: "5000" });
  const l = JSON.parse(long.stdout);
  assert.equal(l.verdict, "pass", `5000ms > sleep 2 ⇒ must pass:\n${long.stdout}${long.stderr}`);
  assert.equal(l.timeoutMs, 5000);
  assert.equal(long.status, 0);
});

test("AC4 — --timeout 优先于 env；无 env 无 flag 时为唯一默认值 60000（零等待读取）", () => {
  const ws = makeWorkspace("flag");
  seedGoal(ws, "GOAL-901", [["AC-901", { status: "draft", criterion: SLOW }]]);

  // flag > env: the AC's own stated precedence, asserted in the direction that distinguishes it.
  const flagged = goal(ws, ["gate", "AC-901", "--dry-run", "--timeout", "1000", "--json"], {
    QUAY_ACCEPTANCE_TIMEOUT_MS: "5000",
  });
  const f = JSON.parse(flagged.stdout);
  assert.match(f.reason, /timed out after 1000ms/, `--timeout must beat the 5000ms env:\n${flagged.stdout}${flagged.stderr}`);
  assert.equal(f.timeoutMs, 1000);

  // No env, no flag ⇒ the one default. ⛔ Asserted from the gate's own output rather than by waiting
  // 60 seconds for a kill: the deadline is a resolved value, so it is readable without being reached.
  const bare = goal(ws, ["gate", "AC-901", "--dry-run", "--json"]);
  const b = JSON.parse(bare.stdout);
  assert.equal(b.timeoutMs, 60000, "no env, no flag ⇒ the single default");
  assert.equal(b.verdict, "pass", "…and the criterion really ran to a verdict at that deadline (not killed)");

  // The pure half, asserted only as a COMPLEMENT (⛔ not as the whole claim — see the header).
  const saved = process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
  try {
    delete process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
    assert.equal(resolveAcceptanceTimeoutMs(), DEFAULT_ACCEPTANCE_TIMEOUT_MS);
    assert.equal(DEFAULT_ACCEPTANCE_TIMEOUT_MS, 60000);
    // Positive control for that predicate (hard rule 2: a zero/environment-count reading needs the
    // predicate dried against a KNOWN-true sample — otherwise "it read 60000" and "it ignores the
    // variable entirely" look identical).
    process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = "1234";
    assert.equal(resolveAcceptanceTimeoutMs(), 1234, "the resolver must actually read the env var");
    delete process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
    // A gateConfig `timeoutMs` is honoured (it is `resolveRunnerOptions`'s second precedence rung) —
    // and the goal path deliberately passes NO gateConfig, which is why the default is reachable at
    // all on that path. Both halves are asserted so the precedence ladder is pinned, not just its top.
    assert.equal(resolveAcceptanceTimeoutMs({ timeoutMs: 777 }), 777, "config is the second rung");
    assert.equal(resolveAcceptanceTimeoutMs({}), DEFAULT_ACCEPTANCE_TIMEOUT_MS, "no env + no config ⇒ the default");
  } finally {
    if (saved === undefined) delete process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
    else process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = saved;
  }
});

test("AC5 — goal 判据的 cwd 仍是 git root：QUAY_ACCEPTANCE_CWD 不改它", () => {
  const ws = makeWorkspace("cwd");
  const real = fs.realpathSync(ws);
  // The criterion asserts the cwd ITSELF, so the reading is produced by the criterion running, not
  // by reading a field the implementation chose to print. `pwd -P` (not `pwd`): the physical path,
  // so a symlinked tmpdir cannot make this pass for the wrong reason.
  const criterion = `[ "$(pwd -P)" = "${real}" ] || { echo "wrong cwd: $(pwd -P)" >&2; exit 1; }`;
  seedGoal(ws, "GOAL-902", [["AC-902", { status: "draft", criterion }]]);

  const r = goal(ws, ["gate", "AC-902", "--dry-run", "--json"], { QUAY_ACCEPTANCE_CWD: os.tmpdir() });
  const o = JSON.parse(r.stdout);
  assert.equal(o.verdict, "pass", `goal criterion must run in the git root (${real}), not in QUAY_ACCEPTANCE_CWD:\n${r.stdout}${r.stderr}`);

  // Positive control for the predicate itself (hard rule 2): the SAME criterion text, run with the
  // cwd the TASK gates would have picked, must FAIL. Without this, "the goal path kept the git
  // root" and "this criterion can never fail" are the same reading.
  const control = runAcceptance({ command: criterion, cwd: os.tmpdir() });
  assert.equal(control.ok, false, "the criterion must be able to detect a wrong cwd — else the assertion above is vacuous");
});

// ── (b) the bounded rotation sweep — goal-store.ts `sweepFrozen` ──────────────────────────────────

test("AC6(b) — 轮转扫描走同一解析来源：sweep 的 reason 与 elapsed-ms 都读到 1000ms 的界", () => {
  const ws = makeWorkspace("sweep");
  // Two FROZEN ACs (achieved, under an achieved GOAL, NO long-term ⇒ outside the I5 reverify scope),
  // never rotated before ⇒ both eligible, ordered deterministically (equal ages ⇒ id order).
  seedGoal(ws, "GOAL-903", [
    ["AC-903", { status: "achieved", criterion: SLOW }],
    ["AC-904", { status: "achieved", criterion: SLOW }],
  ]);

  const swept = goal(ws, ["check", "--stale-pass", "--sweep", "--budget", "1"], { QUAY_ACCEPTANCE_TIMEOUT_MS: "1000" });
  const s1 = JSON.parse(swept.stdout).sweep;
  assert.equal(s1.ran.length, 1, `one bounded rotation step:\n${swept.stdout}${swept.stderr}`);
  assert.equal(s1.ran[0].id, "AC-903", "least-recently-verified-first (both never touched ⇒ id order)");
  assert.equal(s1.ran[0].verdict, "fail", "a criterion killed at the deadline is a fail");
  assert.match(s1.ran[0].reason, /timed out after 1000ms/, `the sweep surfaces the runner's reason: ${s1.ran[0].reason}`);
  // ⛔ The ELAPSED reading, not just the reason text: it is what proves the 1000ms deadline actually
  // governed the run (a reason string alone could be produced by a branch that never ran anything).
  assert.ok(s1.ran[0].ms >= 900 && s1.ran[0].ms < 1900, `elapsed must be ~1000ms, got ${s1.ran[0].ms}ms`);

  // The other direction, on the AC the first sweep did not reach: at 5000ms the same probe passes.
  // (Also covers the rotation's self-resumption from the ledger alone — no cursor.)
  const swept2 = goal(ws, ["check", "--stale-pass", "--sweep", "--budget", "1"], { QUAY_ACCEPTANCE_TIMEOUT_MS: "5000" });
  const s2 = JSON.parse(swept2.stdout).sweep;
  assert.equal(s2.ran.length, 1);
  assert.equal(s2.ran[0].id, "AC-904", "the just-swept AC is no longer the least-recently-verified");
  assert.equal(s2.ran[0].verdict, "pass", `5000ms > sleep 2 ⇒ pass:\n${swept2.stdout}${swept2.stderr}`);
  assert.ok(s2.ran[0].ms >= 1900, `elapsed must be ~2000ms, got ${s2.ran[0].ms}ms`);
});

// ── (c) the P6 activation check — goal-store.ts `write` on a transition INTO active ───────────────

test("AC6(c) — 激活检查走同一解析来源：成本行的 elapsed/fail 反映解析后的界，而非字面 60s", () => {
  const ws = makeWorkspace("activation");
  // ⚠️ The activation gate fires on a TRANSITION into active (`prevStatus !== undefined`), so the
  // record must be born in a non-active status and then flipped — a create-as-active write never
  // reaches it at all.
  seedGoal(ws, "GOAL-905", [["AC-905", { status: "draft", criterion: SLOW }]]);

  const at1000 = goal(ws, ["write", "AC-905", "--status", "active"], { QUAY_ACCEPTANCE_TIMEOUT_MS: "1000" });
  assert.equal(at1000.status, 0, `a timeout is a definitive verdict ⇒ evaluable ⇒ activation allowed:\n${at1000.stdout}${at1000.stderr}`);
  const m1 = /activated AC-905 — criterion ran in (\d+)ms \((pass|fail)\)/.exec(at1000.stderr);
  assert.ok(m1, `the P10 cost line must be emitted: ${at1000.stderr}`);
  assert.equal(m1[2], "fail", "killed at 1000ms ⇒ the activation check reports a fail verdict");
  assert.ok(Number(m1[1]) >= 900 && Number(m1[1]) < 1900, `elapsed must be ~1000ms, got ${m1[1]}ms — a literal 60s would print ~2000ms (pass)`);

  // The other direction, on a second record so the transition is fresh (⛔ not a re-read of the
  // now-active AC-905, which would not be activating at all and would measure nothing).
  seedGoal(ws, "GOAL-906", [["AC-906", { status: "draft", criterion: SLOW }]]);
  const bare = goal(ws, ["write", "AC-906", "--status", "active"]);
  const m2 = /activated AC-906 — criterion ran in (\d+)ms \((pass|fail)\)/.exec(bare.stderr);
  assert.ok(m2, `the P10 cost line must be emitted: ${bare.stderr}`);
  assert.equal(m2[2], "pass", "no env ⇒ the criterion runs to completion");
  assert.ok(Number(m2[1]) >= 1900, `elapsed must be ~2000ms (not a ~1000ms kill), got ${m2[1]}ms`);
});

// ── (d) the I5 achieved-but-failing reverify — goal-store.ts `checkAchievedFailing` ───────────────

test("AC6(d) — 重新验证走同一解析来源：同一 achieved AC 在 1000ms 下报红、在 5000ms 下报绿", () => {
  const ws = makeWorkspace("reverify");
  // In scope via the `long-term: true` branch of `inAchievedReverifyScope` (the other branch is
  // "under an ACTIVE goal"), so no active goal is needed to put it in front of I5.
  seedGoal(ws, "GOAL-907", [["AC-907", { status: "achieved", criterion: SLOW, longTerm: true }]]);

  const short = goal(ws, ["check", "--achieved-failing"], { QUAY_ACCEPTANCE_TIMEOUT_MS: "1000" });
  const s = JSON.parse(short.stdout);
  assert.equal(s.evaluated, true, `the guard must not have refused (⛔ an unevaluated run is not a reading):\n${short.stdout}${short.stderr}`);
  assert.deepEqual(s.inScope, ["AC-907"], "the AC is in the I5 reverify scope");
  assert.deepEqual(s.achievedButFailing, ["AC-907"], "killed at 1000ms ⇒ currently failing");

  const long = goal(ws, ["check", "--achieved-failing"], { QUAY_ACCEPTANCE_TIMEOUT_MS: "5000" });
  const l = JSON.parse(long.stdout);
  assert.equal(l.evaluated, true);
  assert.deepEqual(l.inScope, ["AC-907"], "same population, same scope — ⛔ only the deadline differs");
  assert.deepEqual(l.achievedButFailing, [], "5000ms > sleep 2 ⇒ not failing");
});

// ── the single-source invariants (static, and independent of the four entry points above) ─────────

test("AC2 — 60000 默认值只在一处定义，其余引用该导出常量", () => {
  // The AC's own grep, run over the same scope but DISCOVERED by walking the tree (⛔ not a
  // hand-copied file list) so a NEW file spelling the literal is caught too.
  const srcDir = new URL("../src/", import.meta.url).pathname;
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) files.push(p);
    }
  };
  walk(path.join(srcDir, "gate"));
  files.push(path.join(srcDir, "goal-store.ts"));

  const DEFAULT_LITERAL = /=\s*60_?000\b|timeoutMs = 60000|: 60000\)/;
  const hits = files.filter((f) => DEFAULT_LITERAL.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(
    hits.map((f) => path.relative(srcDir, f)),
    ["gate/config/utils.ts"],
    `exactly one definition of the default, and it is the exported constant:\n${hits.join("\n")}`,
  );
  const utils = fs.readFileSync(path.join(srcDir, "gate", "config", "utils.ts"), "utf8");
  assert.match(utils, /export const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 60000;/, "the one definition is EXPORTED (⛔ not a private literal by another name)");
  // The runner's two entry points must reference it rather than respell it — the other half of
  // "one definition": a constant nobody imports is just a comment.
  const runner = fs.readFileSync(path.join(srcDir, "gate", "acceptance-runner.ts"), "utf8");
  assert.equal((runner.match(/timeoutMs = DEFAULT_ACCEPTANCE_TIMEOUT_MS/g) ?? []).length, 2, "runAcceptance + runAcceptanceCapture both default to the shared constant");
  assert.equal((runner.match(/timeoutMs = 60000/g) ?? []).length, 0, "⛔ no respelled default remains in the runner");
});

test("AC8 — cli/help.ts 的 goal 段出现 --timeout", () => {
  // ⚠️ CARRIER NOTE: this AC named `quay help goal`, which is a DEAD carrier — `help` is not a
  // top-level command, so it prints the generic usage fallback and exits 1 (`bin/quay.ts`'s
  // unknown-command branch, outside this task's Touches). The reading below is taken through the
  // carrier that actually reaches `cli/help.ts`: `quay goal --help`. The substantive claim — the
  // goal section documents the flag — is what is asserted.
  const r = spawnSync("node", [QUAY_BIN, "goal", "--help"], { encoding: "utf8" });
  const text = `${r.stdout}${r.stderr}`;
  assert.ok(text.includes("quay goal — goal + AC records"), `the goal section must be the one read:\n${text}`);
  const count = text.split("--timeout").length - 1;
  assert.ok(count >= 1, `the goal section must document --timeout (found ${count}):\n${text}`);
  assert.match(text, /quay goal gate <id> \[--timeout <ms>\]/, "the usage line names it next to the verb it applies to");
});
