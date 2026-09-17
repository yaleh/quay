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

// SPLIT from promotion-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/5 (9 tests). Shared fixtures: ./helpers/promotion-driver-harness.mjs (single source).

import { test } from "node:test";
import { PROMOTION_CONTROL_STATE_REL, __dirname, advanceRetryCap, applyHalt, assert, defaultControlState, fixWorkerCaptureCmd, fixWorkerNoopCounter, fs, makeRoot, markNeedsHuman, path, readControlState, readOutcomeLines, readRoundLines, readStatus, realReadyPoolCmd, runDriver, sharedIsHalted, sharedResourceGateCheck, spawn, workerIsHalted, workerResourceGateCheck, writeControlState, writeDoDFixer, writeDodShortTask, writeTask } from "./helpers/promotion-driver-harness.mjs";

test("advanceRetryCap — 连续失败达 N 次 ⇒ newlyNeedsHuman；去重不重复返回（纯函数）", () => {
  const state = { counts: new Map(), needsHuman: new Set() };
  assert.deepEqual(advanceRetryCap(state, ["gap-a"], 2), [], "1st failure < N ⇒ not yet needs-human");
  assert.deepEqual(advanceRetryCap(state, ["gap-a"], 2), ["gap-a"], "2nd failure ≥ N ⇒ needs-human");
  assert.deepEqual(advanceRetryCap(state, ["gap-a"], 2), [], "already marked ⇒ no duplicate");
  assert.equal(state.counts.get("gap-a"), 3, "count keeps accumulating (3 attempts)");
  assert.ok(state.needsHuman.has("gap-a"), "needsHuman set records the id");
});


test("markNeedsHuman — status todo→needs-human + ## Needs-Human 审计记录；非 todo 拒写（fail-closed）", (t) => {
  const root = makeRoot("mark-nh");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-nh", "todo");

  const ok = markNeedsHuman(root, "gap-nh", "test reason");
  assert.equal(ok.ok, true, "todo task marked needs-human");
  assert.equal(readStatus(root, "gap-nh"), "needs-human", "status flipped todo → needs-human");
  const body = fs.readFileSync(path.join(root, "tasks", "gap-nh.md"), "utf8");
  assert.ok(body.includes("## Needs-Human"), "grep-able ## Needs-Human audit record written");
  assert.ok(body.includes("test reason"), "the reason is recorded in the body");

  // fail-closed on a non-todo task (needs-human is not todo) ⇒ no double-mark
  const again = markNeedsHuman(root, "gap-nh", "again");
  assert.equal(again.ok, false, "needs-human task is not todo ⇒ refused");
  assert.equal(again.reason, "not-todo");
  assert.equal(readStatus(root, "gap-nh"), "needs-human", "status unchanged on refusal");

  // fail-closed on a missing task
  const missing = markNeedsHuman(root, "gap-ghost", "x");
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing");
});


test("AC133 AC2 — worker 声称修好（exit 0）但实际未改 ⇒ 驱动仍判不合格、⛔ 不得晋升（能取假）", (t) => {
  const root = makeRoot("ac133-ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeDodShortTask(root, "gap-ac133-dodshort");

  // fix worker = `node -e process.exit(0)` — exits 0 (claims success) but changes NOTHING.
  runDriver(root, [
    "--ready-pool-cmd", realReadyPoolCmd(root),
    "--fix-worker-cmd", "node -e process.exit(0)",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--cap", "5", "--once",
  ]);

  const records = readRoundLines(root);
  assert.equal(records.length, 1, "exactly one round record");
  const rec = records[0];

  // AC1: the driver RE-RAN the gate after the worker exited (reverify is present, not null).
  assert.ok(rec.reverify, "AC1: driver re-ran the gate after fix worker exit (reverify present)");
  assert.deepEqual(rec.reverify.stillIneligibleIds, ["gap-ac133-dodshort"],
    `AC2: the gate still judges it ineligible — worker's "success" was NOT trusted (reverify=${JSON.stringify(rec.reverify)})`);
  assert.deepEqual(rec.reverify.nowEligibleIds, [], "nothing promoted on the worker's empty claim");

  // AC2 falsifiable: the task is NOT promoted (status stays todo).
  assert.equal(readStatus(root, "gap-ac133-dodshort"), "todo", "AC2: worker claimed fixed but didn't ⇒ NOT promoted");

  // The fix outcome recorded a spawned worker (exit 0) but no promote outcome for this id.
  const outcomes = readOutcomeLines(root);
  assert.ok(outcomes.some((o) => o.task_id === "gap-ac133-dodshort" && o.action === "fix"), "a fix outcome was written");
  assert.ok(!outcomes.some((o) => o.task_id === "gap-ac133-dodshort" && o.action === "promote"), "⛔ no promote outcome for the unfixed task");
});


test("AC133 AC3 — 连续修 N 次仍不合格 ⇒ 标 needs-human 并停止修复循环（能取假）", (t) => {
  const root = makeRoot("ac133-ac3");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeDodShortTask(root, "gap-ac133-capped");

  const counter = path.join(root, "fix.cnt");
  // max-fix-retries 2: round 1 spawn(1) → round 2 spawn(2) ≥ N ⇒ needs-human → rounds 3-4 no spawn.
  runDriver(root, [
    "--ready-pool-cmd", realReadyPoolCmd(root),
    "--fix-worker-cmd", fixWorkerNoopCounter(counter),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--cap", "5", "--max-fix-retries", "2", "--max-rounds", "4", "--interval", "5",
  ]);

  // AC3 falsifiable: the driver stopped after N (2) fix attempts, not 4.
  assert.equal(Number(fs.readFileSync(counter, "utf8")), 2,
    "AC3: fix worker spawned exactly N=2 times, then the loop stopped spawning (⛔ 无限重修)");

  // The task was marked needs-human on disk (status flip + audit record).
  assert.equal(readStatus(root, "gap-ac133-capped"), "needs-human", "AC3: task marked needs-human after N failed fixes");
  const body = fs.readFileSync(path.join(root, "tasks", "gap-ac133-capped.md"), "utf8");
  assert.ok(body.includes("## Needs-Human"), "AC3: ## Needs-Human audit record written");

  // The round that hit the cap recorded the needs-human decision.
  const records = readRoundLines(root);
  const capRound = records.find((r) => r.needs_human && r.needs_human.includes("gap-ac133-capped"));
  assert.ok(capRound, "the needs-human decision is recorded in the round ledger");

  // An outcome record with action=needs-human is written (outer-consumable).
  const outcomes = readOutcomeLines(root);
  assert.ok(outcomes.some((o) => o.task_id === "gap-ac133-capped" && o.action === "needs-human"),
    "a needs-human outcome record is written for the capped task");
});


test("AC133 AC1 positive — fix worker 真的修好 ⇒ 重验证轮的闸判合格并晋升（重闸验证的非空证据）", (t) => {
  const root = makeRoot("ac133-pos");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeDodShortTask(root, "gap-ac133-fixed");

  // A REAL fixer rewrites the short DoD ⇒ the re-verify round's gate now judges it eligible and --apply
  // promotes it (status → ready). Proves the re-verify path can PROMOTE, not just detect failure.
  runDriver(root, [
    "--ready-pool-cmd", realReadyPoolCmd(root),
    "--fix-worker-cmd", writeDoDFixer(root),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--cap", "5", "--once",
  ]);

  assert.equal(readStatus(root, "gap-ac133-fixed"), "ready",
    "AC1 positive: worker actually fixed the DoD ⇒ re-verify gate promoted it (todo → ready)");

  const rec = readRoundLines(root)[0];
  assert.ok(rec.reverify, "reverify present");
  assert.deepEqual(rec.reverify.nowEligibleIds, ["gap-ac133-fixed"],
    `the gate's new judgment (now eligible) is what counts, not the worker's self-report (reverify=${JSON.stringify(rec.reverify)})`);
  assert.deepEqual(rec.reverify.stillIneligibleIds, [], "a genuinely-fixed task is not still-ineligible");
});

// ── AC150（falsifiable）：promotion 资源门 + 控制面 halt 与 worker-driver 共用同一份实现 ──────────


test("AC150-1 — resource gate WAIT ⇒ 本轮不 spawn fix worker（退避，⛔ 无 action=\"fix\" outcome）", (t) => {
  const root = makeRoot("ac150-1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeDodShortTask(root, "gap-ac150-rg");

  const capture = path.join(root, "fix-prompt.txt");
  runDriver(root, [
    "--ready-pool-cmd", realReadyPoolCmd(root),
    "--fix-worker-cmd", fixWorkerCaptureCmd(capture),
    "--resource-gate-cmd", "node -e process.exit(1)",
    "--cap", "5", "--once",
  ]);

  // WAIT ⇒ 退避：fix worker 未被 spawn（capture 文件不存在）、无 action="fix" outcome（AC150-1 取假）。
  assert.ok(!fs.existsSync(capture), "WAIT ⇒ no fix worker spawned (capture file absent)");
  const records = readRoundLines(root);
  assert.equal(records.length, 1, "exactly one round record");
  assert.equal(records[0].gate.go, false, "round record carries the resource-gate WAIT verdict");
  const outcomes = readOutcomeLines(root);
  assert.ok(!outcomes.some((o) => o.action === "fix"), `AC150-1 取假：WAIT 期间无 action="fix" outcome (${JSON.stringify(outcomes)})`);

  // Positive control：同一 fixture、gate GO ⇒ fix worker 被 spawn（证明该任务本可修，退避是资源门拦的）。
  const root2 = makeRoot("ac150-1-go");
  t.after(() => fs.rmSync(root2, { recursive: true, force: true }));
  writeDodShortTask(root2, "gap-ac150-rg-go");
  const capture2 = path.join(root2, "fix-prompt.txt");
  runDriver(root2, [
    "--ready-pool-cmd", realReadyPoolCmd(root2),
    "--fix-worker-cmd", fixWorkerCaptureCmd(capture2),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--cap", "5", "--once",
  ]);
  assert.ok(fs.existsSync(capture2), "gate GO ⇒ fix worker spawned (positive control)");
  assert.ok(readOutcomeLines(root2).some((o) => o.action === "fix"), "gate GO ⇒ action=\"fix\" outcome written");
});


test("AC150-2 — 控制态 pre-halted ⇒ 驱动停止晋升与 fix spawn（运行期 halt，⛔ 非只能 kill）", (t) => {
  const root = makeRoot("ac150-2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-ac150-eligible", "todo");
  // 预置 halt（走 driver-shared 的同一 writer，写 promotion-control.json）。
  writeControlState(root, applyHalt(defaultControlState(), "outer", true), PROMOTION_CONTROL_STATE_REL);

  const capture = path.join(root, "fix-prompt.txt");
  runDriver(root, [
    "--ready-pool-cmd", realReadyPoolCmd(root),
    "--fix-worker-cmd", fixWorkerCaptureCmd(capture),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--cap", "5", "--once",
  ]);

  // AC150-2 取假：halt 后下一轮仍晋升/仍 spawn fix worker ⇒ 假。这里 halted ⇒ 不晋升、不 spawn。
  assert.equal(readStatus(root, "gap-ac150-eligible"), "todo", "AC150-2 取假：halt 后不晋升（eligible todo 仍为 todo）");
  assert.ok(!fs.existsSync(capture), "halt ⇒ no fix worker spawned");
  const records = readRoundLines(root);
  assert.equal(records.length, 1, "exactly one (halted) round record");
  assert.equal(records[0].action, "halted", "round record action=halted");
  assert.equal(records[0].halted, true, "round record carries halted=true");
  const outcomes = readOutcomeLines(root);
  assert.equal(outcomes.length, 0, "halt ⇒ no promote/fix outcome written");

  // 正控制：同 fixture、未 halt ⇒ 驱动会晋升它（证明该任务本可晋，halt 才是拦住它的量）。
  const root2 = makeRoot("ac150-2-go");
  t.after(() => fs.rmSync(root2, { recursive: true, force: true }));
  writeTask(root2, "gap-ac150-eligible-go", "todo");
  runDriver(root2, ["--ready-pool-cmd", realReadyPoolCmd(root2), "--cap", "5", "--once"]);
  assert.equal(readStatus(root2, "gap-ac150-eligible-go"), "ready", "guard: eligible todo promoted when NOT halted");
});


test("AC150-3 — 资源门/halt 判定只有 driver-shared.ts 一份实现（⛔ 无复制粘贴）", () => {
  // 函数级同一份：worker-driver re-export 与 driver-shared 是同一个函数引用。
  assert.equal(sharedResourceGateCheck, workerResourceGateCheck, "resourceGateCheck 同一份实现（worker re-export = shared）");
  assert.equal(sharedIsHalted, workerIsHalted, "isHalted 同一份实现（worker re-export = shared）");

  // 取假（grep 形）：三个源文件里，resourceGateCheck / isHalted 只定义在 driver-shared.ts 一份；
  // worker-driver.ts 与 promotion-driver.ts 都只 import（⛔ 不各写一份独立实现）。
  const sharedSrc = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "driver-shared.ts"), "utf8");
  const workerSrc = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "worker-driver.ts"), "utf8");
  const promoSrc = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "promotion-driver.ts"), "utf8");
  assert.match(sharedSrc, /export function resourceGateCheck/, "resourceGateCheck defined in driver-shared.ts");
  assert.match(sharedSrc, /export function isHalted/, "isHalted defined in driver-shared.ts");
  assert.doesNotMatch(workerSrc, /export function resourceGateCheck/, "worker-driver.ts does NOT define resourceGateCheck");
  assert.doesNotMatch(workerSrc, /export function isHalted/, "worker-driver.ts does NOT define isHalted");
  assert.doesNotMatch(promoSrc, /export function resourceGateCheck/, "promotion-driver.ts does NOT define resourceGateCheck");
  assert.doesNotMatch(promoSrc, /export function isHalted/, "promotion-driver.ts does NOT define isHalted");
});


test("AC150-2 — promotion 控制态文件独立于 worker（halting one 不杀 another）", (t) => {
  const root = makeRoot("ac150-indep");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // promotion 读 promotion-control.json；worker 读 worker-control.json（driver-shared 参数化 rel）。
  writeControlState(root, applyHalt(defaultControlState(), "outer", true), PROMOTION_CONTROL_STATE_REL);
  // promotion 控制态 = halted（用同一 isHalted 实现读 promotion 文件）。
  assert.equal(readControlState(root, process.env, PROMOTION_CONTROL_STATE_REL).state.halted, true, "promotion control file halted");
  assert.equal(sharedIsHalted(root, process.env, PROMOTION_CONTROL_STATE_REL), true, "shared isHalted reads promotion-control.json");
});
