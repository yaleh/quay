// @test-group governance
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

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

import {
  defaultPromotionCheckArgv,
  isLlmInvocation,
  runPromotionRound,
  computeRoundRecord,
  appendRoundRecord,
  computeOutcomeRecords,
  appendOutcomeRecord,
  parseIntervalMs,
  resolveCap,
  classifyCandidate,
  buildFixWorkerPrompt,
  buildFixWorkerArgv,
  spawnFixWorker,
  runFixPass,
  computeReverifyOutcome,
  advanceRetryCap,
  markNeedsHuman,
  ROUND_LOG_REL,
  OUTCOME_LOG_REL,
  INTERVAL_MS_DEFAULT,
  CAP_DEFAULT,
  MAX_FIX_RETRIES_DEFAULT,
  FIX_WORKER_TIMEOUT_MS,
} from "../scripts/promotion-driver.ts";
// AC150-3：资源门/halt 判定与 worker-driver 共用同一份实现（driver-shared.ts）。
import {
  resourceGateCheck as sharedResourceGateCheck,
  isHalted as sharedIsHalted,
  readControlState,
  writeControlState,
  defaultControlState,
  applyHalt,
  PROMOTION_CONTROL_STATE_REL,
} from "../scripts/driver-shared.ts";
import { resourceGateCheck as workerResourceGateCheck, isHalted as workerIsHalted } from "../scripts/worker-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.resolve(__dirname, "..", "scripts", "promotion-driver.ts");
// launchArgv（经 policy 解析 kind → profile）需要一个带 .quay/profiles.yml + .claude/launch.settings.json
// 的 root——L3 后默认 fix-worker argv 不再 `bash quay-launch.sh`，改用真实 repo root 读真 profiles.yml。
const REPO_ROOT = path.resolve(__dirname, "..", "..");
// The REAL ready-pool-check lives in the worktree's plugin/scripts (not under the temp task root), so
// the AC2 test injects it via --ready-pool-cmd pointing at this path — the same seam worker-driver's
// resident-loop tests use. splitArgs splits on whitespace, so both paths here are space-free.
const READY_POOL_SCRIPT = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `promotion-driver-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  return dir;
}

// A minimal contract-shape todo body carrying the four artifacts (Proposal/Contract/AC/DoD) + the
// C8 self-touch (own tasks/<id>.md in ## Touches) — the exact shape ready-pool-check --apply promotes.
function eligibleTodoBody(id) {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars long.",
    "## Contract",
    "measure   ready_pool = ready-pool-check stdout pool field, definitely over forty chars.",
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough to count as an item",
    "- [ ] another AC item that is long enough to count as an item",
    "- [ ] a third AC item that is long enough to count as an item",
    "- [ ] a fourth AC item that is long enough to count as an item",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned, over forty chars long.",
    "## Touches",
    `- tasks/${id}.md`,
  ].join("\n");
}

function writeTask(root, id, status = "todo") {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "labels:",
    "  - gap",
    "parent: null",
    "children: []",
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${eligibleTodoBody(id)}`);
}

// A contract-shape todo with DoD < 40 non-whitespace chars (the AC2 falsifiable fixture): fourArtifacts
// is false with missingArtifacts=["dod"] — the gate's structured "哪一项不合格" signal.
function dodShortTodoBody(id) {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars long.",
    "## Contract",
    "measure   ready_pool = ready-pool-check stdout pool field, definitely over forty chars.",
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough to count as an item",
    "- [ ] another AC item that is long enough to count as an item",
    "- [ ] a third AC item that is long enough to count as an item",
    "- [ ] a fourth AC item that is long enough to count as an item",
    "## Definition of Done",
    "short",
    "## Touches",
    `- tasks/${id}.md`,
  ].join("\n");
}

function writeDodShortTask(root, id, status = "todo") {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "labels:",
    "  - gap",
    "parent: null",
    "children: []",
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${dodShortTodoBody(id)}`);
}

function readStatus(root, id) {
  const raw = fs.readFileSync(path.join(root, "tasks", `${id}.md`), "utf8");
  const m = raw.match(/^status:\s*([\w-]+)\s*$/m);
  return m ? m[1] : null;
}

function runDriver(root, args) {
  return execFileSync(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root, ...args,
  ], { encoding: "utf8" });
}

function readRoundLines(root) {
  const file = path.join(root, ROUND_LOG_REL);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function readOutcomeLines(root) {
  const file = path.join(root, OUTCOME_LOG_REL);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// space-free counter command (splitArgs splits on whitespace) — mirrors worker-driver's counterNodeE.
function counterNodeE(counterFile, logExpr) {
  const f = JSON.stringify(counterFile);
  return `node -e n=0;try{n=Number(require('fs').readFileSync(${f},'utf8'))}catch{};require('fs').writeFileSync(${f},String(n+1));console.log(${logExpr})`;
}

// The real ready-pool-check --apply command (full pool + land promotions) against the temp task root.
// Injected via --ready-pool-cmd so the AC2 test exercises the REAL promotion path (not a fake).
function realReadyPoolCmd(root) {
  return `node --experimental-strip-types ${READY_POOL_SCRIPT} --root ${root} --cap 5 --apply --json`;
}

// AC132 capture seam: --fix-worker-cmd replaces the fix-worker command PREFIX, and the driver appends
// the structured prompt as the LAST argv element. This script writes that last element (process.argv[1]
// for `node -e <script> <prompt>`) to the capture file — so the test can read the prompt the worker
// actually received. splitArgs splits on whitespace ⇒ the script text must be space-free.
function fixWorkerCaptureCmd(captureFile) {
  const f = JSON.stringify(captureFile);
  return `node -e require('fs').writeFileSync(${f},process.argv[1]||'')`;
}

// AC133 seam: a fix worker that "claims success" (exit 0) but changes NOTHING — the falsifiable
// fixture for "⛔ 不信 worker 自述". It also increments a counter so the retry-cap test can count how
// many times the driver actually spawned it (space-free node -e, splitArgs splits on whitespace).
function fixWorkerNoopCounter(counterFile) {
  const f = JSON.stringify(counterFile);
  return `node -e n=0;try{n=Number(require('fs').readFileSync(${f},'utf8'))}catch{};require('fs').writeFileSync(${f},String(n+1));process.exit(0)`;
}

// AC133 positive-control fixer: a REAL fix worker (a .cjs helper, since `node -e` must be space-free)
// that actually rewrites the DoD-short fixture to a ≥40-char DoD, then exits 0. Returns the space-free
// command prefix `node <abs path>`; the driver appends the prompt as the last arg (ignored here).
function writeDoDFixer(root) {
  const file = path.join(root, "fix-dod.cjs");
  fs.writeFileSync(file, [
    "const fs=require('fs');",
    "const path=require('path');",
    "const dir=path.join(process.cwd(),'tasks');",
    "for(const f of fs.readdirSync(dir)){",
    "  if(!f.endsWith('.md'))continue;",
    "  const p=path.join(dir,f);",
    "  let raw=fs.readFileSync(p,'utf8');",
    "  raw=raw.replace('short','standard DoD — the five clauses; meta-enforcer fixture-pinned, over forty chars long.');",
    "  fs.writeFileSync(p,raw);",
    "}",
    "process.exit(0);",
  ].join("\n"));
  return `node ${file}`;
}

// ── pure functions ─────────────────────────────────────────────────────────────────────────────────

test("defaultPromotionCheckArgv — full-pool --apply (never --targeted) + --cap + --json", () => {
  const argv = defaultPromotionCheckArgv("/r", 5);
  assert.equal(argv[0], "node");
  assert.equal(argv[1], "--experimental-strip-types");
  assert.equal(argv[2], "/r/plugin/scripts/ready-pool-check.ts");
  assert.ok(argv.includes("--apply"), "AC130: the resident round applies promotions (A22 heartbeat path)");
  assert.ok(argv.includes("--json"));
  assert.deepEqual(argv.slice(argv.indexOf("--root"), argv.indexOf("--root") + 2), ["--root", "/r"]);
  assert.deepEqual(argv.slice(argv.indexOf("--cap"), argv.indexOf("--cap") + 2), ["--cap", "5"]);
  assert.ok(!argv.includes("--targeted"), "AC130: full-pool determination, NOT a single --targeted task");
});

test("parseIntervalMs / resolveCap — defaults + valid + invalid (fail-closed on bad input)", () => {
  assert.equal(parseIntervalMs(undefined).value, INTERVAL_MS_DEFAULT);
  assert.equal(parseIntervalMs("25").value, 25);
  assert.equal(parseIntervalMs("0").value, 0, "zero interval is legal (test seam)");
  assert.equal(parseIntervalMs("-5").ok, false, "negative interval rejected");
  assert.equal(parseIntervalMs("abc").ok, false, "non-numeric interval rejected");

  assert.equal(resolveCap(undefined).value, CAP_DEFAULT);
  assert.equal(resolveCap("7").value, 7);
  assert.equal(resolveCap("0").ok, false, "cap must be positive");
  assert.equal(resolveCap("2.5").ok, false, "cap must be an integer");
});

test("runPromotionRound — parses pool/promotions/applied_promotions from the injected full-pool output", () => {
  const cmd = ["node", "-e", "console.log(JSON.stringify({pool:2,should_apply:true,promotions:[{id:'gap-a',reason:'r'},{id:'gap-b',reason:'r'}],applied_promotions:[{id:'gap-a',ok:true,from:'todo',to:'ready',deliveryCritical:false}]}))"];
  const r = runPromotionRound("/r", cmd, 5);
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.equal(r.pool, 2);
  assert.equal(r.shouldApply, true);
  assert.deepEqual(r.promotedIds, ["gap-a", "gap-b"], "promotedIds = the gate's eligible-promotion id list");
  // MULTI-PATH TOUCHES GUARD (gap-promotion-driver-commit-bypasses-precommit-touches-guard): the driver
  // re-map now propagates reason + committed so a blocked promotion is not silent in the ledger.
  assert.deepEqual(r.applied, [{ id: "gap-a", ok: true, from: "todo", to: "ready", deliveryCritical: false, reason: null, committed: false }]);
});

test("runPromotionRound — fail-closed: non-zero exit / unparseable output ⇒ error, ⛔ not 'no candidates'", () => {
  const nonZero = runPromotionRound("/r", ["node", "-e", "process.exit(1)"], 5);
  assert.equal(nonZero.ok, false, "non-zero exit ⇒ fail-closed");
  assert.match(nonZero.error, /exited 1/);
  assert.deepEqual(nonZero.promotedIds, [], "no fabricated promotions on read failure (硬规则 3b)");

  const garbage = runPromotionRound("/r", ["node", "-e", "console.log('not json')"], 5);
  assert.equal(garbage.ok, false);
  assert.match(garbage.error, /unparseable/);
});

test("computeRoundRecord — action ∈ promote|fix|none|error derived from the round", () => {
  const base = { round: 1, runId: "pm-1", pid: 42, at: "2026-08-22T00:00:00.000Z", pool: 1, shouldApply: true, applied: [], promotePathLlmInvoked: false, fixes: [] };
  assert.equal(computeRoundRecord({ ...base, promotedIds: ["gap-a"], error: null }).action, "promote");
  assert.equal(computeRoundRecord({ ...base, promotedIds: [], error: null }).action, "none");
  assert.equal(computeRoundRecord({ ...base, promotedIds: [], error: "boom" }).action, "error");
  assert.equal(
    computeRoundRecord({ ...base, promotedIds: [], error: null, fixes: [{ id: "gap-f", spawned: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], exitCode: 0 }] }).action,
    "fix",
    "AC132: a round that spawned a fix worker is a 'fix' round",
  );
  const rec = computeRoundRecord({ ...base, promotedIds: ["gap-a"], error: null });
  assert.equal(rec.run_id, "pm-1");
  assert.equal(rec.pid, 42);
  assert.equal(rec.promote_path_llm_invoked, false, "AC131: round record carries promote_path_llm_invoked=false on the mechanical promotion path");
  assert.deepEqual(rec.fixes, [], "AC132: no fix worker ⇒ fixes empty");
  assert.ok(rec.ts && rec.round, "ts/round present");
});

test("appendRoundRecord — pure append, never truncates (two lines survive)", (t) => {
  const root = makeRoot("append");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, ROUND_LOG_REL);
  const rec = (r) => computeRoundRecord({ round: r, runId: "pm-1", pid: 1, at: "t", pool: 0, shouldApply: false, promotedIds: [], applied: [], error: null, promotePathLlmInvoked: false, fixes: [] });
  appendRoundRecord(file, rec(1));
  appendRoundRecord(file, rec(2));
  assert.equal(readRoundLines(root).length, 2, "two appended lines");
});

// ── AC1: resident loop (does not exit after one round; enters next round after interval) ────────────

test("AC1 — resident loop runs N rounds without exiting (--max-rounds bounds it; interval between rounds)", (t) => {
  const root = makeRoot("ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const counter = path.join(root, "rpc.cnt");
  const out = runDriver(root, [
    "--ready-pool-cmd", counterNodeE(counter, "JSON.stringify({pool:1,should_apply:false,promotions:[],applied_promotions:[]})"),
    "--interval", "5",
    "--max-rounds", "3",
    "--json",
  ]);
  const events = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const rounds = events.filter((e) => e.event === "round");
  assert.equal(rounds.length, 3, "AC1: three rounds emitted — the loop kept going after the first, never exited");
  assert.deepEqual(rounds.map((r) => r.round), [1, 2, 3]);
  assert.equal(Number(fs.readFileSync(counter, "utf8")), 3, "ready-pool-check invoked exactly 3 times (one full-pool call per round)");
  const records = readRoundLines(root);
  assert.equal(records.length, 3, "one round record per round");
  assert.deepEqual(records.map((r) => r.action), ["none", "none", "none"]);
});

test("AC1 — --once runs exactly one round then exits (single-shot seam)", (t) => {
  const root = makeRoot("once");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = runDriver(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({pool:0,should_apply:false,promotions:[],applied_promotions:[]}))",
    "--once", "--json",
  ]);
  const events = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.filter((e) => e.event === "round").length, 1, "--once runs one round");
});

// ── liveness 接线（gap-resident-driver-stable-carrier-liveness Finding：liveness 子命令零调用者）──
// AC2 承诺「driver/supervisor 死时有机件在窗口内检测并报告」，但此前没有任何东西调 liveness 子命令
// （log 13h 无更新）。修法 = driver 自身 round 循环每轮顺手调一次（promotion 侧接线）。本组验证：
// ①resident loop 每轮真调 liveness（counter 缝）、②检出的死亡进 round record（⛔ 不静默丢）。

test("liveness wiring — resident loop calls the liveness checker each round + round record carries it", (t) => {
  const root = makeRoot("liveness-wire");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const livenessCnt = path.join(root, "liveness.cnt");
  runDriver(root, [
    "--ready-pool-cmd", counterNodeE(path.join(root, "rpc.cnt"), "JSON.stringify({pool:0,should_apply:false,promotions:[],applied_promotions:[]})"),
    "--liveness-cmd", counterNodeE(livenessCnt, "JSON.stringify({kind:'promotion',deaths:'none',running:true})"),
    "--interval", "5",
    "--max-rounds", "3",
    "--json",
  ]);
  assert.equal(Number(fs.readFileSync(livenessCnt, "utf8")), 3, "liveness checked once per round (3 rounds)");
  const records = readRoundLines(root);
  assert.equal(records.length, 3, "three round records");
  for (const rec of records) {
    assert.equal(rec.liveness.checked, true, `round carries liveness.checked=true: ${JSON.stringify(rec.liveness)}`);
    assert.equal(rec.liveness.deaths, null, "healthy check ⇒ deaths=null");
    assert.equal(rec.liveness.running, true);
  }
});

test("liveness death surfacing — a death reported by the checker is carried into the round record (⛔ not dropped)", (t) => {
  const root = makeRoot("liveness-death");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  runDriver(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({pool:0,should_apply:false,promotions:[],applied_promotions:[]}))",
    "--liveness-cmd", "node -e console.log(JSON.stringify({kind:'promotion',deaths:'supervisor_dead,driver_orphaned',running:false}))",
    "--once", "--json",
  ]);
  const records = readRoundLines(root);
  assert.equal(records.length, 1, "one round");
  const liveness = records[0].liveness;
  assert.equal(liveness.checked, true);
  assert.match(liveness.deaths, /supervisor_dead/, `supervisor_dead surfaced: ${liveness.deaths}`);
  assert.match(liveness.deaths, /driver_orphaned/, "orphan driver explicitly named");
  assert.equal(liveness.running, false, "running=false — the orphan driver is NOT misjudged as in-service");
});

// ── AC2 (falsifiable): stop the driver ⇒ a newly-eligible todo is NOT promoted ─────────────────────

test("AC2 — stop the driver (SIGTERM) ⇒ newly-eligible todo is not promoted; alive driver promotes it", async (t) => {
  const root = makeRoot("ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-eligible-1", "todo");

  const pidFile = path.join(root, "driver.pid");
  const driver = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root,
    "--ready-pool-cmd", realReadyPoolCmd(root),
    "--interval", "25", "--cap", "5", "--pid-file", pidFile, "--json",
  ], { stdio: ["ignore", "pipe", "ignore"] });
  let buf = "";
  driver.stdout.on("data", (d) => { buf += d; });

  // Positive control: while the driver is ALIVE, the eligible todo gets promoted (todo → ready).
  let promoted = false;
  for (let i = 0; i < 300 && !promoted; i++) {
    if (readStatus(root, "gap-eligible-1") === "ready") promoted = true;
    else await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(promoted, true, "AC2 positive: the living driver promoted the eligible todo via full-pool --apply");

  // Stop the driver and wait for it to fully exit.
  driver.kill("SIGTERM");
  const exitCode = await new Promise((resolve) => { driver.on("close", (c) => resolve(c)); });
  assert.equal(exitCode, 0, "SIGTERM ⇒ clean exit (0)");
  const events = buf.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.event === "stop" && e.reason === "signal"), "the signal stop is recorded, not silent");

  // Negative control: AFTER the driver is dead, a NEW eligible todo appears in the pool…
  writeTask(root, "gap-eligible-2", "todo");
  await new Promise((r) => setTimeout(r, 500)); // ≫ interval — any live driver round would have run by now

  // …and it is NOT promoted (proving promotion is driven by the driver, not some outer tick).
  assert.equal(readStatus(root, "gap-eligible-2"), "todo", "AC2 falsifiable: after stop, the newly-eligible todo stays todo");

  // Non-vacuous guard: the SAME task IS genuinely eligible — a single driver round (--once) promotes it.
  runDriver(root, ["--ready-pool-cmd", realReadyPoolCmd(root), "--cap", "5", "--once"]);
  assert.equal(readStatus(root, "gap-eligible-2"), "ready", "guard: gap-eligible-2 was eligible all along — only the stopped driver held it back");
});

// ── AC131 (falsifiable): qualified todo promoted via A22 --apply, zero LLM, promote_path_llm_invoked=false ─────

test("isLlmInvocation — falsifiable SET-based derivation (AC140-4 AC1 + AC2；⛔ not a claude literal)", () => {
  assert.equal(isLlmInvocation(["claude", "-p", "fix task X"]), true, "claude -p is an LLM invocation (default set)");
  assert.equal(isLlmInvocation(["/usr/local/bin/claude", "print"]), true, "absolute claude path is an LLM invocation");
  assert.equal(isLlmInvocation(["node", "--experimental-strip-types", "/r/plugin/scripts/ready-pool-check.ts", "--apply"]), false, "ready-pool-check is mechanical, not an LLM");
  assert.equal(isLlmInvocation([]), false, "empty argv is not an LLM invocation");
  // AC140-4 AC1: the judgment reads the CONFIGURED set, not the literal `claude`.
  // AC140-4 AC2 (能取假): 配 wrapper（claude-fjdac 进集合）后，isLlmInvocation(<wrapper argv>) 必须返回 true。
  assert.equal(isLlmInvocation(["claude-fjdac", "-p", "fix task X"], ["claude", "claude-fjdac"]), true, "AC2: claude-fjdac in the configured set ⇒ isLlmInvocation(<wrapper argv>)=true");
  assert.equal(isLlmInvocation(["claude-fjdac", "-p", "fix task X"]), false, "取假对照: claude-fjdac NOT in the default set ⇒ false (the SET decides, not the literal)");
});

test("AC131 AC1 — the promotion path spawns no LLM: default argv mechanical + round promotePathLlmInvoked=false", (t) => {
  const root = makeRoot("ac131-ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // The default promotion command is the mechanical ready-pool-check, never an LLM CLI.
  const argv = defaultPromotionCheckArgv(root, 5);
  assert.equal(argv[0], "node");
  assert.equal(isLlmInvocation(argv), false, "AC131: default promotion argv is not an LLM invocation");

  // A mechanical round reports promotePathLlmInvoked=false — and isLlmInvocation is falsifiable (claude ⇒ true),
  // so this is a DERIVED measurement of the spawned argv, not a hardcoded false (hard rule 4).
  const r = runPromotionRound(root, ["node", "-e", "console.log(JSON.stringify({pool:1,should_apply:true,promotions:[{id:'gap-x'}],applied_promotions:[{id:'gap-x',ok:true,from:'todo',to:'ready',deliveryCritical:false}]}))"], 5);
  assert.equal(r.ok, true);
  assert.equal(r.promotePathLlmInvoked, false, "AC131 AC1: the mechanical promotion round reports promotePathLlmInvoked=false");
});

test("AC131 AC2 — four-artifact + empty-deps todo promoted to ready in one round, outcome promote_path_llm_invoked=false", (t) => {
  const root = makeRoot("ac131-ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // four artifacts (Proposal/Contract/AC/DoD) + Touches self-touch, frontmatter has no depends_on ⇒ deps empty.
  writeTask(root, "gap-ac131-eligible", "todo");

  // One driver round (--once) with the REAL ready-pool-check --apply against the temp workspace.
  runDriver(root, ["--ready-pool-cmd", realReadyPoolCmd(root), "--cap", "5", "--once"]);

  assert.equal(readStatus(root, "gap-ac131-eligible"), "ready", "AC131 AC2: eligible todo promoted to ready within one round");

  const records = readRoundLines(root);
  assert.equal(records.length, 1, "exactly one round record");
  const rec = records[0];
  assert.equal(rec.action, "promote");
  assert.ok(rec.promoted_ids.includes("gap-ac131-eligible"), "the promoted id is recorded in the outcome");
  assert.equal(rec.promote_path_llm_invoked, false, "AC131 AC2: the outcome record carries promote_path_llm_invoked=false (the falsifiable half)");
});

// ── AC132 (falsifiable): ineligible todo → short-lived fix worker with the gate's STRUCTURED input ──

test("classifyCandidate — A24 classification (三可修 / 五不可修), ⛔ not re-designed", () => {
  const base = {
    id: "gap-a", fourArtifacts: true, missingArtifacts: [], selfTouchOk: true, touchesResolve: true,
    depsReady: true, retiredMechanism: false, superseded: false, compound: false, prosePrereqGap: [],
  };
  // fixable: DoD missing (fourArtifacts=false)
  const dod = classifyCandidate({ ...base, fourArtifacts: false, missingArtifacts: ["dod"] });
  assert.equal(dod.fixable, true);
  assert.deepEqual(dod.missing, ["fourArtifacts=false missing=[dod]"], "structured identifier verbatim from the gate");
  assert.equal(dod.unfixable.length, 0);
  assert.ok(dod.prompt.includes("fourArtifacts=false missing=[dod]"), "fixable ⇒ prompt carries the structured identifier");

  // fixable: self-touch + touches (two fixable items)
  const st = classifyCandidate({ ...base, selfTouchOk: false, touchesResolve: false });
  assert.equal(st.fixable, true);
  assert.deepEqual(st.missing, ["selfTouchOk=false", "touchesResolve=false"]);

  // unfixable: deps not ready ⇒ no spawn, reason recorded
  const deps = classifyCandidate({ ...base, depsReady: false });
  assert.equal(deps.fixable, false);
  assert.deepEqual(deps.unfixable, ["depsReady=false"]);
  assert.equal(deps.prompt, null, "unfixable ⇒ no fix worker prompt");

  // each of the other four unfixable classes records its own reason
  assert.deepEqual(classifyCandidate({ ...base, retiredMechanism: true }).unfixable, ["retiredMechanism=true"]);
  assert.deepEqual(classifyCandidate({ ...base, superseded: true }).unfixable, ["superseded=true"]);
  assert.deepEqual(classifyCandidate({ ...base, compound: true }).unfixable, ["compound=true"]);
  assert.deepEqual(classifyCandidate({ ...base, prosePrereqGap: ["gap-z"] }).unfixable, ["prosePrereqGap=[gap-z]"]);

  // mixed: fixable AND unfixable ⇒ NOT fixable (the unfixable blocker is the real obstacle)
  const mixed = classifyCandidate({ ...base, fourArtifacts: false, missingArtifacts: ["dod"], depsReady: false });
  assert.equal(mixed.fixable, false, "a fixable item plus an unfixable blocker ⇒ no spawn");
  assert.deepEqual(mixed.unfixable, ["depsReady=false"]);
});

test("buildFixWorkerPrompt — task id + structured missing list, ⛔ not a prose directive", () => {
  const p = buildFixWorkerPrompt("gap-a", ["fourArtifacts=false missing=[dod]"]);
  assert.ok(p.includes("task_id=gap-a"), "the prompt carries the task id");
  assert.ok(p.includes("fourArtifacts=false missing=[dod]"), "the structured missing identifier is in the prompt");
  assert.ok(p.includes("structured_missing:"), "the prompt names the structured list (not 'go look what's wrong')");
});

test("buildFixWorkerArgv — default policy-resolved fix-worker; override prefix appends the prompt as the last arg", () => {
  const def = buildFixWorkerArgv("gap-a", ["fourArtifacts=false missing=[dod]"], REPO_ROOT);
  assert.equal(def[0], "claude-fjdac",
    "AC140-1/L3: fix worker resolves via policy to the profile launcher (⛔ bash quay-launch.sh)");
  assert.equal(def[def.indexOf("-n") + 1], "quay-fix-worker");
  assert.ok(def[def.length - 1].includes("fourArtifacts=false missing=[dod]"), "the prompt is the argv payload");

  const over = buildFixWorkerArgv("gap-a", ["fourArtifacts=false missing=[dod]"], REPO_ROOT, "node -e capture");
  assert.deepEqual(over.slice(0, 3), ["node", "-e", "capture"]);
  assert.ok(over[over.length - 1].includes("fourArtifacts=false missing=[dod]"), "override keeps the prompt as the last arg");
});

test("runFixPass — fixable spawns (exit 0), unfixable records reason without spawning", (t) => {
  const root = makeRoot("fixpass");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const decisions = [
    { id: "gap-fix", fixable: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], prompt: "p" },
    { id: "gap-nofix", fixable: false, missing: [], unfixable: ["depsReady=false"], prompt: null },
  ];
  const outcomes = runFixPass(decisions, root, "node -e process.exit(0)");
  assert.deepEqual(outcomes[0], { id: "gap-fix", spawned: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], exitCode: 0, stderr: null, timedOut: false });
  assert.deepEqual(outcomes[1], { id: "gap-nofix", spawned: false, missing: [], unfixable: ["depsReady=false"], exitCode: null, stderr: null, timedOut: false });
});

test("AC142 AC1 — spawnFixWorker captures stderr; outcome result.detail carries it (spawn 失败不再零诊断)", (t) => {
  const root = makeRoot("ac142-ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 一个写 stderr + exit 1 的 fix worker（模拟认证失败/报错——之前 10 条 spawned exit=1 零 stderr 不可诊断）。
  const r = spawnFixWorker(["node", "-e", "process.stderr.write('AUTH-ERROR: no credentials');process.exit(1)"], root);
  assert.equal(r.exitCode, 1, "spawn exit 1 is still captured");
  assert.equal(r.timedOut, false);
  assert.ok(r.stderr && r.stderr.includes("AUTH-ERROR"), `stderr captured (⛔ 不再 ignore): ${JSON.stringify(r.stderr)}`);

  // 诊断面落进可查载体（promotion-outcome.jsonl 的 result.detail）：spawn 失败时带 stderr 截断。
  const recs = computeOutcomeRecords({
    at: "t",
    applied: [],
    fixes: [{ id: "gap-x", spawned: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], exitCode: 1, stderr: r.stderr, timedOut: false }],
  });
  const fix = recs.find((o) => o.action === "fix");
  assert.equal(fix.result.ok, false);
  assert.ok(fix.result.detail.includes("stderr=AUTH-ERROR"), `detail carries stderr: ${fix.result.detail}`);
});

test("AC142 AC1 — spawnFixWorker timeout ⇒ timedOut=true + error (ETIMEDOUT), exitCode null", (t) => {
  const root = makeRoot("ac142-timeout");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = spawnFixWorker(["sleep", "5"], root, 300);
  assert.equal(r.timedOut, true, "timeout fired ⇒ timedOut=true");
  assert.ok(r.error, "timeout produces an error");
  assert.equal(r.exitCode, null, "no exit code on timeout");
});

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

// A self-contained temp root whose plugin/ is a SYMLINK to the worktree's plugin/ — so the driver's
// DEFAULT ready-pool-check argv (`node <root>/plugin/scripts/ready-pool-check.ts --root <root> ...`)
// resolves the REAL checker WITHOUT the --ready-pool-cmd injection seam (AC134 AC2: turn the seam off).
function makeSelfContainedRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `promotion-outcome-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.symlinkSync(path.resolve(__dirname, ".."), path.join(dir, "plugin"), "dir");
  return dir;
}

// A dep-blocked (unfixable) todo: `depends_on: gap-missing-dep` points at a task that does not exist
// ⇒ depsReady=false (fail closed) ⇒ classifyCandidate → unfixable (五不可修) ⇒ skip, no fix worker.
function writeDepBlockedTask(root, id) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    "status: todo",
    "labels:",
    "  - gap",
    "parent: null",
    "children: []",
    "depends_on:",
    "  - gap-missing-dep",
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${eligibleTodoBody(id)}`);
}

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

test("AC133 MAX_FIX_RETRIES_DEFAULT — 与 fan-in 侧 attempt>=3 同值，非新设阈值", () => {
  assert.equal(MAX_FIX_RETRIES_DEFAULT, 3, "default retry cap = 3 (gap-fan-in-relaunch-retry-cap 同值)");
});

test("computeReverifyOutcome — 闸的新判定归类：nowEligible / stillIneligible / notEvaluated / neither（纯函数）", () => {
  // gate now says eligible (promotions contains the id) ⇒ fix took
  const eligible = { ok: true, error: null, pool: 1, shouldApply: true, promotedIds: ["gap-a"], applied: [], promotePathLlmInvoked: false, fixDecisions: [] };
  const r1 = computeReverifyOutcome(["gap-a", "gap-b"], eligible);
  assert.deepEqual(r1.nowEligibleIds, ["gap-a"], "闸判合格 ⇒ nowEligible");
  assert.deepEqual(r1.stillIneligibleIds, []);
  assert.deepEqual(r1.notEvaluatedIds, [], "ok=true ⇒ 无 not-evaluated");

  // gate still says ineligible (fixDecisions contains eligible=false) ⇒ fix did NOT take
  const stillBad = {
    ok: true, error: null, pool: 1, shouldApply: false, promotedIds: [], applied: [], promotePathLlmInvoked: false,
    fixDecisions: [
      { id: "gap-a", fixable: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], prompt: "p" },
    ],
  };
  const r2 = computeReverifyOutcome(["gap-a"], stillBad);
  assert.deepEqual(r2.nowEligibleIds, [], "闸仍判不合格 ⇒ ⛔ 不得晋升");
  assert.deepEqual(r2.stillIneligibleIds, ["gap-a"], "闸仍判不合格 ⇒ stillIneligible（⛔ 不信 worker 自述「已修好」）");
  assert.deepEqual(r2.notEvaluatedIds, [], "ok=true ⇒ 无 not-evaluated");

  // neither (task left the todo pool) ⇒ not counted either way
  const gone = { ok: true, error: null, pool: 0, shouldApply: false, promotedIds: [], applied: [], promotePathLlmInvoked: false, fixDecisions: [] };
  const r3 = computeReverifyOutcome(["gap-z"], gone);
  assert.deepEqual(r3, { nowEligibleIds: [], stillIneligibleIds: [], notEvaluatedIds: [] }, "task vanished from the pool ⇒ neither");

  // ⛔ AC153：读不到输入（重跑闸 ok=false）⇒ 全部 notEvaluatedIds（不是 neither 静默丢弃，也不是
  // stillIneligible 误计入失败上限）。
  const unreadable = { ok: false, error: "ready-pool-check spawn failed", pool: null, shouldApply: false, promotedIds: [], applied: [], promotePathLlmInvoked: false, fixDecisions: [] };
  const r4 = computeReverifyOutcome(["gap-a", "gap-b"], unreadable);
  assert.deepEqual(r4.notEvaluatedIds, ["gap-a", "gap-b"], "重跑闸读不到 ⇒ notEvaluatedIds（⛔ 不是 neither/不是 stillIneligible）");
  assert.deepEqual(r4.nowEligibleIds, [], "读不到 ⇒ ⛔ 不晋升");
  assert.deepEqual(r4.stillIneligibleIds, [], "读不到 ⇒ ⛔ 不计失败上限");
});

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
