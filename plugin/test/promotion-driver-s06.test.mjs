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
import { OUTCOME_LOG_REL, appendOutcomeRecord, assert, computeOutcomeRecords, fixWorkerCaptureCmd, fs, makeRoot, makeSelfContainedRoot, path, readOutcomeLines, readRoundLines, readStatus, realReadyPoolCmd, runDriver, writeDepBlockedTask, writeDodShortTask, writeTask } from "./helpers/promotion-driver-harness.mjs";

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
