// @test-group governance
// promotion-driver.test.mjs — AC130 (tasks/gap-ac130-promotion-driver-resident-loop): the resident
// promotion driver loops forever, calling ready-pool-check for the FULL-pool determination (never a
// single --targeted task) each round, does not exit after one round, and enters the next round after
// --interval. AC2 is the FALSIFIABLE half: stop the driver ⇒ a newly-eligible todo in the pool is NOT
// promoted — proving promotion is driven by the driver, not some outer tick.
//
// The ready-pool-check command is injectable (--ready-pool-cmd) so the pure/loop tests never touch the
// real checker; the AC2 test drives the REAL ready-pool-check --apply against a temp workspace to prove
// the promotion lands on disk while the driver lives and does not after it is SIGTERM'd.
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
  runPromotionRound,
  computeRoundRecord,
  appendRoundRecord,
  parseIntervalMs,
  resolveCap,
  ROUND_LOG_REL,
  INTERVAL_MS_DEFAULT,
  CAP_DEFAULT,
} from "../scripts/promotion-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.resolve(__dirname, "..", "scripts", "promotion-driver.ts");
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

function readStatus(root, id) {
  const raw = fs.readFileSync(path.join(root, "tasks", `${id}.md`), "utf8");
  const m = raw.match(/^status:\s*(\w+)\s*$/m);
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
  assert.deepEqual(r.applied, [{ id: "gap-a", ok: true, from: "todo", to: "ready", deliveryCritical: false }]);
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

test("computeRoundRecord — action ∈ promote|none|error derived from the round", () => {
  const base = { round: 1, runId: "pm-1", pid: 42, at: "2026-08-22T00:00:00.000Z", pool: 1, shouldApply: true, applied: [] };
  assert.equal(computeRoundRecord({ ...base, promotedIds: ["gap-a"], error: null }).action, "promote");
  assert.equal(computeRoundRecord({ ...base, promotedIds: [], error: null }).action, "none");
  assert.equal(computeRoundRecord({ ...base, promotedIds: [], error: "boom" }).action, "error");
  const rec = computeRoundRecord({ ...base, promotedIds: ["gap-a"], error: null });
  assert.equal(rec.run_id, "pm-1");
  assert.equal(rec.pid, 42);
  assert.ok(rec.ts && rec.round, "ts/round present");
});

test("appendRoundRecord — pure append, never truncates (two lines survive)", (t) => {
  const root = makeRoot("append");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, ROUND_LOG_REL);
  const rec = (r) => computeRoundRecord({ round: r, runId: "pm-1", pid: 1, at: "t", pool: 0, shouldApply: false, promotedIds: [], applied: [], error: null });
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
