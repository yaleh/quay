// @test-group engine
// promotion-driver.test.mjs — AC130 + AC131 + AC132 + AC134 (tasks/gap-ac130-promotion-driver-resident-loop,
// tasks/gap-ac131-promotion-mechanical-no-llm, tasks/gap-ac132-fix-worker-structured-input,
// tasks/gap-ac134-promotion-outcome-ledger): the resident
// promotion driver loops forever, calling ready-pool-check for the FULL-pool determination (never a
// single --targeted task) each round, does not exit after one round, and enters the next round after
// --interval. AC2 is the FALSIFIABLE half: stop the driver ⇒ a newly-eligible todo in the pool is NOT
// promoted — proving promotion is driven by the driver, not some outer tick.
// AC131 (falsifiable): a qualified todo (four artifacts complete + empty deps) is promoted to ready
// within one round via the mechanical A22 --apply path, with ZERO LLM — the round's outcome record
// carries promote_path_llm_invoked=false (derived from the spawned argv, not hardcoded).
// AC132 (falsifiable): an ineligible todo spawns a short-lived `claude -p` fix worker whose input is
// the task id + the gate's STRUCTURED missing list (A24 三可修/五不可修), never a prose directive.
// AC2: a DoD<40 todo ⇒ the fix worker's prompt carries the structured identifier (fourArtifacts=false
// missing=[dod]); a prompt with only the task id and no missing list would falsify it.
// AC134 (falsifiable): every determination/promotion/fix writes one structured outcome record to
// .quay/promotion-outcome.jsonl (gitignored) with task_id · gate(eligible + missing) · action
// (promote/fix/skip) · result · ts. AC2: the carrier holds REAL records from the real ready-pool-check
// against real task files (not fixture/injected output) — ≥ N records after the driver runs.
//
// The ready-pool-check command is injectable (--ready-pool-cmd) so the pure/loop tests never touch the
// real checker; the AC2 test drives the REAL ready-pool-check --apply against a temp workspace to prove
// the promotion lands on disk while the driver lives and does not after it is SIGTERM'd. The fix-worker
// command is injectable (--fix-worker-cmd) with the structured prompt appended as the last arg, so the
// AC132 AC2 test captures the prompt the worker actually received without spawning a real claude.
//
// Run: scripts/test.sh plugin/test/promotion-driver.test.mjs

// SPLIT from promotion-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 6/8 (6 tests). Shared fixtures: ./helpers/promotion-driver-harness.mjs (single source).

import { test } from "node:test";
import { OUTCOME_LOG_REL, appendOutcomeRecord, assert, classifyCandidate, computeOutcomeRecords, fixWorkerCaptureCmd, fixWorkerNoopCounter, fs, makeRoot, makeSelfContainedRoot, path, readOutcomeLines, readRoundLines, readStatus, realReadyPoolCmd, runDriver, writeDepBlockedTask, writeDodShortTask, writeTask } from "./helpers/promotion-driver-harness.mjs";

test("AC132 AC2 — DoD<40 todo ⇒ fix worker prompt contains the structured missing identifier (falsifiable)", (t) => {
  const root = makeRoot("ac132-ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeDodShortTask(root, "gap-ac132-dodshort");

  const capture = path.join(root, "fix-prompt.txt");
  runDriver(root, [
    "--ready-pool-cmd", realReadyPoolCmd(root),
    "--fix-worker-cmd", fixWorkerCaptureCmd(capture),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--cap", "5", "--once",
  ]);

  const records = readRoundLines(root);
  assert.equal(records.length, 1, "exactly one round record");
  const fix = records[0].fixes.find((f) => f.id === "gap-ac132-dodshort");
  assert.ok(fix, "the ineligible todo produced a fix outcome");
  assert.equal(fix.spawned, true, "AC132 AC1: an ineligible (DoD<40) todo spawns a fix worker");
  assert.ok(fix.missing.includes("fourArtifacts=false missing=[dod]"), `structured missing list carried: ${JSON.stringify(fix.missing)}`);

  // AC2 falsifiable: the prompt the fix worker RECEIVED carries the structured identifier — not just the id.
  const prompt = fs.readFileSync(capture, "utf8");
  assert.ok(prompt.includes("task_id=gap-ac132-dodshort"), "prompt carries the task id");
  assert.ok(prompt.includes("fourArtifacts=false missing=[dod]"), `AC2: prompt carries the structured missing identifier (prompt=${JSON.stringify(prompt)})`);
});

// ── AC134 (falsifiable): 判定/晋升/修复各落一条 outcome（.quay/promotion-outcome.jsonl） ──────────




test("computeOutcomeRecords — applied⇒promote, spawned⇒fix, unfixable⇒skip (fields task_id/gate/action/result/ts)", () => {
  const at = "2026-08-22T00:00:00.000Z";
  const applied = [{ id: "gap-a", ok: true, from: "todo", to: "ready", deliveryCritical: false }];
  const fixes = [
    { id: "gap-fix", spawned: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], exitCode: 0 },
    { id: "gap-skip", spawned: false, missing: [], unfixable: ["depsReady=false"], exitCode: null },
    { id: "gap-mixed", spawned: false, missing: ["selfTouchOk=false"], unfixable: ["superseded=true"], exitCode: null },
  ];
  const recs = computeOutcomeRecords({ at, applied, fixes });
  assert.equal(recs.length, 4);
  const [prom, fix, skip, mixed] = recs;

  assert.equal(prom.task_id, "gap-a");
  assert.equal(prom.action, "promote");
  assert.deepEqual(prom.gate, { eligible: true, missing: [] }, "promote gate: eligible, no missing");
  assert.deepEqual(prom.result, { ok: true, detail: "todo->ready" });
  assert.equal(prom.ts, at);

  assert.equal(fix.task_id, "gap-fix");
  assert.equal(fix.action, "fix");
  assert.equal(fix.gate.eligible, false);
  assert.deepEqual(fix.gate.missing, ["fourArtifacts=false missing=[dod]"], "AC134: fix gate carries the structured missing list");
  assert.deepEqual(fix.result, { ok: true, detail: "spawned exit=0" });

  assert.equal(skip.task_id, "gap-skip");
  assert.equal(skip.action, "skip");
  assert.equal(skip.gate.eligible, false);
  assert.deepEqual(skip.gate.missing, ["depsReady=false"], "skip gate.missing = the unfixable blocker");

  assert.equal(mixed.action, "skip", "a fixable item plus an unfixable blocker ⇒ skip (not fix)");
  assert.deepEqual(mixed.gate.missing, ["selfTouchOk=false", "superseded=true"], "mixed skip carries fixable missing + unfixable blocker");
});


test("gap-fix-worker-edit-exit-4 — exit=4 但重闸判落地 ⇒ result.ok=true（⛔ result.ok 不再 = 裸 exitCode===0）", () => {
  const at = "2026-08-23T00:00:00.000Z";
  // exit=4（编辑成功后的事后非零退出）+ stderr 空（同 AC142 观测：stdout/stderr 均空）。
  const fixes = [{ id: "gap-fix", spawned: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], exitCode: 4, stderr: null, timedOut: false }];

  // 无 reverify ⇒ 退回 exitCode===0 ⇒ ok=false（旧行为；⛔ 不硬编码「exit-4=成功」——那是猜）。
  const noReverify = computeOutcomeRecords({ at, applied: [], fixes });
  assert.equal(noReverify.find((o) => o.action === "fix").result.ok, false, "无 reverify 时仍以退出码为准");

  // 有 reverify 且闸判 nowEligible ⇒ ok=true（fix landed，⛔ 不信 exit-4 这个事后非零退出码）。
  const reverify = { nowEligibleIds: ["gap-fix"], stillIneligibleIds: [] };
  const withReverify = computeOutcomeRecords({ at, applied: [], fixes, reverify });
  const fix = withReverify.find((o) => o.action === "fix");
  assert.equal(fix.result.ok, true, "重闸判落地 ⇒ ok=true（exit-4 不把 result.ok 打 false）");
  assert.ok(fix.result.detail.includes("fix landed"), `detail 标注落地: ${fix.result.detail}`);
});


test("gap-fix-worker-edit-exit-4 — exit=0 但重闸判仍不合格 ⇒ result.ok=false（⛔ 不信 exit-0 自述）", () => {
  const fixes = [{ id: "gap-fix", spawned: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], exitCode: 0, stderr: null, timedOut: false }];
  const reverify = { nowEligibleIds: [], stillIneligibleIds: ["gap-fix"] };
  const recs = computeOutcomeRecords({ at: "t", applied: [], fixes, reverify });
  const fix = recs.find((o) => o.action === "fix");
  assert.equal(fix.result.ok, false, "exit=0 但闸判仍不合格 ⇒ ok=false（AC133 ⛔ 不信 worker 自述）");
});


test("appendOutcomeRecord — pure append, never truncates (two lines survive)", (t) => {
  const root = makeRoot("outcome-append");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, OUTCOME_LOG_REL);
  const rec = (id, action) => ({ task_id: id, gate: { eligible: action === "promote", missing: [] }, action, result: { ok: true, detail: null }, ts: "t" });
  appendOutcomeRecord(file, rec("gap-1", "promote"));
  appendOutcomeRecord(file, rec("gap-2", "skip"));
  const lines = readOutcomeLines(root);
  assert.equal(lines.length, 2, "two appended outcome lines");
  assert.deepEqual(lines.map((l) => l.task_id), ["gap-1", "gap-2"]);
});


test("AC134 AC2 — real gate + real tasks ⇒ outcome ledger holds real promote/skip records (seam OFF)", (t) => {
  const root = makeSelfContainedRoot("ac134-ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-ac134-eligible", "todo");
  writeDepBlockedTask(root, "gap-ac134-depblocked");

  // DEFAULT argv — no --ready-pool-cmd, no --fix-worker-cmd (the injection seams are OFF). The only
  // difference from production is the temp root + symlinked plugin/ (real ready-pool-check).
  runDriver(root, ["--cap", "5", "--once"]);

  const lines = readOutcomeLines(root);
  assert.ok(lines.length >= 2, `AC134 AC2: ≥2 real outcome records, got ${lines.length} (${lines.map((l) => l.action).join(",")})`);

  const promote = lines.find((l) => l.task_id === "gap-ac134-eligible");
  assert.ok(promote, "the eligible task produced a promote outcome record");
  assert.equal(promote.action, "promote");
  assert.deepEqual(promote.gate, { eligible: true, missing: [] });
  assert.equal(promote.result.ok, true);

  const skip = lines.find((l) => l.task_id === "gap-ac134-depblocked");
  assert.ok(skip, "the dep-blocked task produced a skip outcome record");
  assert.equal(skip.action, "skip");
  assert.equal(skip.gate.eligible, false);
  assert.ok(skip.gate.missing.includes("depsReady=false"), `skip gate carries the blocker: ${JSON.stringify(skip.gate.missing)}`);

  // Every record carries the AC134 required fields (task_id · gate(含 missing) · action · result · ts).
  for (const l of lines) {
    assert.ok(l.task_id, "task_id present");
    assert.ok(l.gate && typeof l.gate.eligible === "boolean" && Array.isArray(l.gate.missing), "gate{eligible,missing} present");
    assert.ok(["promote", "fix", "skip", "needs-human"].includes(l.action), `action ∈ promote|fix|skip|needs-human (got ${l.action})`);
    assert.ok(l.result && typeof l.result.ok === "boolean", "result present");
    assert.ok(l.ts, "ts present");
  }

  // The promotion actually landed (real gate, not fixture): status flipped todo → ready.
  assert.equal(readStatus(root, "gap-ac134-eligible"), "ready", "the real gate promoted the eligible task");
});

// ── AC133 (falsifiable): 修完重跑同一个闸验证（⛔ 不信 worker 自述）+ 失败上限 needs-human ─────────

// ── EXECUTOR-UNSATISFIABLE AC, UNANNOTATED (tasks/gap-promotion-driver-blind-to-unsatisfiable-ac-block) ──
// The driver half of the defect: the gate's `unsatisfiableUnannotatedAc.hits` was never read by
// classifyCandidate ⇒ the ledger wrote the information-free `detail:"ineligible-not-fixed"`, and — the
// worse half — a class that can NEVER spawn a fix worker (`fixable=false` ⇒ no spawn ⇒ `fixedIds` empty)
// was structurally unreachable from the AC133 retry-cap escalation, so the task spun FOREVER with no
// needs-human flip. AC1 pins the named-reason ledger record; AC2 pins the escalation OFF the
// `if (fixedIds.length > 0)` guard (取假: restore that guard and AC2 goes red); AC3 is the negative
// control — an EXISTING fixable class (fourArtifacts=false) still walks the fix path, NOT this one.

/** A space-free injectable ready-pool stub that emits ONE candidate carrying `cand`'s checks.
 *  `splitArgs` splits `--ready-pool-cmd` on whitespace, so the command text must carry none; JSON.stringify
 *  emits none, and the `hits` strings below are space-free by construction. The stub proves the DRIVER's
 *  consumption of the gate field deterministically (⛔ no dependence on a real task body). */
function stubReadyPoolCandidate(cand) {
  const payload = JSON.stringify({ pool: 1, should_apply: false, candidates: [cand], promotions: [], applied_promotions: [] });
  return `node -e console.log(${JSON.stringify(payload)})`;
}

// Space-free offending-item text (the only constraint the injectable stub places on it).
const UNSAT_HIT = "落地后复查";

const UNSAT_CANDIDATE = {
  id: "gap-unsat", eligible: false, fourArtifacts: true, missingArtifacts: [], selfTouchOk: true,
  touchesResolve: true, touchesNarrow: true, depsReady: true, retiredMechanism: false, superseded: false,
  compound: false, prosePrereqGap: [],
  unsatisfiableUnannotatedAc: { evaluated: true, status: "hit", hits: [UNSAT_HIT] },
};

const FIXABLE_CANDIDATE = {
  id: "gap-fixable", eligible: false, fourArtifacts: false, missingArtifacts: ["dod"], selfTouchOk: true,
  touchesResolve: true, touchesNarrow: true, depsReady: true, retiredMechanism: false, superseded: false,
  compound: false, prosePrereqGap: [],
  unsatisfiableUnannotatedAc: { evaluated: true, status: "clean", hits: [] },
};


test("computeOutcomeRecords — an unsatisfiable-AC block records a NAMED reason, ⛔ never the empty 'ineligible-not-fixed'", () => {
  const at = "2026-10-10T00:00:00.000Z";
  const HIT = "AC6 落地后复查：合入 develop 之后 sqlite3 agent 档不再增长";
  const base = {
    id: "gap-unsat", fourArtifacts: true, missingArtifacts: [], selfTouchOk: true, touchesResolve: true,
    depsReady: true, retiredMechanism: false, superseded: false, compound: false, prosePrereqGap: [],
  };
  // End-to-end through the producer: classifyCandidate builds the unfixable reason, the ledger writes it.
  const decision = classifyCandidate({ ...base, unsatisfiableUnannotatedAc: { evaluated: true, status: "hit", hits: [HIT] } });
  const recs = computeOutcomeRecords({
    at, applied: [],
    fixes: [{ id: decision.id, spawned: false, missing: decision.missing, unfixable: decision.unfixable, exitCode: null }],
  });
  assert.equal(recs.length, 1);
  const rec = recs[0];
  assert.equal(rec.action, "skip");
  assert.notEqual(rec.result.detail, "ineligible-not-fixed", "AC1: the information-free fallback IS the defect");
  assert.ok(rec.result.detail.length > 0, "AC1: result.detail is non-empty");
  assert.ok(rec.result.detail.includes(HIT), `AC1: result.detail contains the reason text: ${rec.result.detail}`);
  assert.ok(rec.gate.missing.includes(decision.unfixable[0]), "the reason is also carried on gate.missing");
});


test("AC2 — a structurally-unspawnable block is ESCALATED to needs-human after RETRY_CAP_DEFAULT rounds (取假)", (t) => {
  const root = makeRoot("unsat-escalate");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // A valid todo on disk (markNeedsHuman needs frontmatter + todo status); the injected gate supplies
  // the unsatisfiable reading, so the body content is irrelevant to the judgment under test.
  writeTask(root, "gap-unsat", "todo");

  const counter = path.join(root, "fix.cnt");
  // RETRY_CAP_DEFAULT = 3 (driver-filters.ts) — 3 rounds, and the escalation must land on the LAST one.
  runDriver(root, [
    "--ready-pool-cmd", stubReadyPoolCandidate(UNSAT_CANDIDATE),
    "--fix-worker-cmd", fixWorkerNoopCounter(counter),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--cap", "5", "--max-fix-retries", "3", "--max-rounds", "3", "--interval", "5",
  ]);

  const outcomes = readOutcomeLines(root);
  const mine = outcomes.filter((o) => o.task_id === "gap-unsat");

  // The class is structurally UNSPAWNABLE: zero fix workers over the 3 rounds (this is why the old
  // `fixedIds.length > 0` escalation could never fire for it).
  assert.equal(fs.existsSync(counter), false, "⛔ no fix worker is spawned for a structurally-unspawnable class");

  // Every interception's skip record NAMES the reason (⛔ not the empty fallback).
  const skips = mine.filter((o) => o.action === "skip");
  assert.ok(skips.length >= 1, `skip records exist: ${JSON.stringify(mine.map((o) => o.action))}`);
  for (const s of skips) {
    assert.notEqual(s.result.detail, "ineligible-not-fixed", "the ledger NAMES a reason");
    assert.ok(s.result.detail.includes(UNSAT_HIT), `detail names the offending item: ${s.result.detail}`);
  }

  // Escalation: the 3rd consecutive interception flips it (取假: restoring `if (fixedIds.length > 0)`
  // around the escalation makes this assertion fail — no needs-human record is ever produced).
  const nh = mine.find((o) => o.action === "needs-human");
  assert.ok(nh, "AC2: the 3rd consecutive interception escalates to needs-human");
  assert.ok(nh.result.detail.includes(UNSAT_HIT), `AC2: the needs-human detail names the reason: ${nh.result.detail}`);
  assert.equal(readStatus(root, "gap-unsat"), "needs-human", "AC2: status flipped todo → needs-human on disk");
});


test("AC3 — a fixable ineligible (fourArtifacts=false) still walks the fix path, ⛔ not the structural escalation", (t) => {
  const root = makeRoot("unsat-negative-ctl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-fixable", "todo");

  const counter = path.join(root, "fix.cnt");
  // max-fix-retries 5 > 3 rounds ⇒ the fixable class never hits the retry cap within this window, so a
  // needs-human record can ONLY come from the new structural path — which must NOT claim this class.
  runDriver(root, [
    "--ready-pool-cmd", stubReadyPoolCandidate(FIXABLE_CANDIDATE),
    "--fix-worker-cmd", fixWorkerNoopCounter(counter),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--cap", "5", "--max-fix-retries", "5", "--max-rounds", "3", "--interval", "5",
  ]);

  const outcomes = readOutcomeLines(root);
  assert.ok(outcomes.some((o) => o.task_id === "gap-fixable" && o.action === "fix"),
    "the fixable class spawns a fix worker (action:fix) via the ORIGINAL path");
  assert.ok(!outcomes.some((o) => o.task_id === "gap-fixable" && o.action === "needs-human"),
    "⛔ the new structural escalation did NOT claim the existing fixable class");
  assert.equal(fs.readFileSync(counter, "utf8"), "3", "the fix worker ran once per round (3 rounds)");
});

