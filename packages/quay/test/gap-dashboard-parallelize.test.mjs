// @test-group product
// gap-webui-dashboard-manager-slow-parallelize — WebUI dashboard/manager 页 13-14s 串行 → 并行.
//
// The page latency root cause was SERIAL mechanism-script probes:
//   readSystem  ran resource-gate.sh(1.65s) → process-budget.sh(0.35s) sequentially;
//   readManager ran loop-driver-check.sh(1.26s) → session-liveness.sh(2.31s) →
//                slot-refill.ts(9.10s) → git(0.01s) sequentially;
//   handleDashboard  awaited readSystem THEN readManager (≈14.7s total).
//
// The fix (this task) makes each of those independent probes CONCURRENT (Promise.all), and adds a
// SHORT-TTL cache (30s) for the slot-refill sub-probe — the single most expensive probe — scoped to
// the WebUI display surface only. The cache provably cannot pollute A22's read of truth: A22 runs
// slot-refill.ts as a SEPARATE process (its own execFile, never importing observation.ts), so the
// serve-side in-memory cache shares no state with it (AC3).
//
// Two layers of verification:
//   1. STRUCTURAL (AC1/AC2): the source bodies of readSystem / readManager / handleDashboard must
//      contain a Promise.all whose arguments are exactly the independent probes — the parallel
//      structure is pinned by source (the same trick tick-core-static-check.ts uses for the
//      orchestrator tick cores).
//   2. BEHAVIORAL (AC3): the pool-metrics cache (now reading the promotion-driver round carrier,
//      per AC136 — gap-ac136-web-truth-source-follows-driver) must (a) return the SAME pool object
//      on a second readManager call within TTL, (b) be cleared by clearPoolMetricsCache (forcing a
//      fresh read), and (c) never change what the slot-refill SUBPROCESS (A22's path) returns.
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-parallelize.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { readManager, readManagerLight, clearPoolMetricsCache, POOL_METRICS_CACHE_TTL_MS } from "../src/observation.ts";
import { readTaskSummary, clearTaskSummaryCache, TASK_SUMMARY_CACHE_TTL_MS } from "../src/serve-handlers.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const OBSERVATION_SRC = path.join(__dirname, "..", "src", "observation.ts");
const SERVE_HANDLERS_SRC = path.join(__dirname, "..", "src", "serve-handlers.ts");
const SLOT_REFILL_TS = path.join(REPO_ROOT, "plugin", "scripts", "slot-refill.ts");

// ── Structural helpers (AC1/AC2: the parallel structure is pinned in source) ───────────────────

/** Extract `export async function <name>(...) { ... }` (balanced parens + braces) from a source file.
 *  Skips the balanced PARAMETER LIST first — parameter types can contain braces (e.g. `cfg:
 *  { workspaceRoot: string }`), so the body start is the first `{` after the params close. */
function fnBody(src, fnName) {
  const re = new RegExp(`function\\s+${fnName}\\s*\\(`);
  const m = re.exec(src);
  assert.ok(m, `${fnName} found in ${src.length}-char source`);
  let i = m.index + m[0].length; // just after '('
  let parenDepth = 1;
  while (i < src.length && parenDepth > 0) {
    if (src[i] === "(") parenDepth++;
    else if (src[i] === ")") parenDepth--;
    i++;
  }
  // Now past the params; advance to the body's opening `{` (return type may follow, no braces).
  while (i < src.length && src[i] !== "{") i++;
  assert.ok(src[i] === "{", `${fnName} has a body`);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`${fnName} body not terminated`);
}

/**
 * Assert that <fnName>'s body runs ALL <probes> inside a single `Promise.all([ ... ])` call —
 * i.e. every probe string appears between the `Promise.all(` and the closing `]);`, and NO probe
 * is ever AWAITED anywhere in the function (serial would be `await <probe>(...)` before/after the
 * Promise.all). The `await`-form check is comment-safe: prose like "Serial was readSystem(≈2s)"
 * carries no `await`, so a comment cannot fake a serial read. This pins the "串行→并行" structure
 * the AC requires.
 */
function assertConcurrent(src, fnName, probes) {
  const body = fnBody(src, fnName);
  const allIdx = body.indexOf("Promise.all");
  assert.ok(allIdx >= 0, `${fnName} uses Promise.all`);
  const closeIdx = body.indexOf("]);", allIdx);
  assert.ok(closeIdx >= 0, `${fnName}'s Promise.all is array-argument form ending in ]);`);
  const span = body.slice(allIdx, closeIdx);
  for (const probe of probes) {
    assert.ok(span.includes(probe), `${fnName}'s Promise.all includes ${probe}`);
    assert.ok(!new RegExp(`await\\s+${probe}\\b`).test(body), `${fnName}: ${probe} is never awaited serially (parallel via Promise.all)`);
  }
}

test("AC1: readSystem runs resource-gate + process-budget concurrently (Promise.all)", () => {
  const src = fs.readFileSync(OBSERVATION_SRC, "utf8");
  assertConcurrent(src, "readSystem", ["RESOURCE_GATE_REL", "PROCESS_BUDGET_REL"]);
  const body = fnBody(src, "readSystem");
  assert.equal((body.match(/Promise\.all/g) ?? []).length, 1, "readSystem has exactly one Promise.all");
});

test("AC1: readManager runs its four async probes concurrently (Promise.all)", () => {
  const src = fs.readFileSync(OBSERVATION_SRC, "utf8");
  assertConcurrent(src, "readManager", ["runLoopDriverProbe", "runLivenessProbe", "readPoolMetrics", "readDevelopLead"]);
  const body = fnBody(src, "readManager");
  assert.equal((body.match(/Promise\.all/g) ?? []).length, 1, "readManager has exactly one Promise.all");
});

test("AC2: handleDashboard runs readSystem + readManagerLight + readTaskSummary concurrently (Promise.all)", () => {
  const src = fs.readFileSync(SERVE_HANDLERS_SRC, "utf8");
  assertConcurrent(src, "handleDashboard", ["readSystem", "readManagerLight", "readTaskSummary"]);
});

// gap-webui-dashboard-load-time-optimization AC1: the dashboard's manager probe is the LIGHT path —
// loop-driver + liveness only. The ~9s slot-refill pool probe (readPoolMetrics) must NOT be reachable
// from readManagerLight (the /manager detail page's full readManager keeps it).
test("AC1: readManagerLight runs loop-driver + liveness concurrently and never calls readPoolMetrics", () => {
  const src = fs.readFileSync(OBSERVATION_SRC, "utf8");
  assertConcurrent(src, "readManagerLight", ["runLoopDriverProbe", "runLivenessProbe"]);
  const body = fnBody(src, "readManagerLight");
  assert.equal((body.match(/Promise\.all/g) ?? []).length, 1, "readManagerLight has exactly one Promise.all");
  assert.ok(!body.includes("readPoolMetrics"), "readManagerLight never calls readPoolMetrics (no slot-refill cold-call on the dashboard path)");
  assert.ok(!body.includes("readDevelopLead"), "readManagerLight never calls readDevelopLead (no git subprocess on the dashboard path)");
});

// ── Fixture workspace (fresh git repo — fast slot-refill, hermetic) ──────────────────────────────

function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "parallelize fixture\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: ws });
  return ws;
}

/** Run slot-refill the way A22 does — a SEPARATE `node plugin/scripts/slot-refill.ts --json`
 *  subprocess — and return its { pool, floor, deficit, cap }. */
function slotRefillSubprocess(cwd) {
  const out = execFileSync("node", ["--experimental-strip-types", SLOT_REFILL_TS, "--json"], {
    cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024,
  });
  const j = JSON.parse(out);
  return { pool: j.pool ?? null, floor: j.floor ?? null, deficit: j.deficit ?? null, cap: j.cap ?? null };
}

// ── Behavioral cache tests (AC3) ────────────────────────────────────────────────────────────────

/** Write a synthetic promotion-driver round record into the fixture workspace — the AC136 pool truth
 *  source (`.quay/promotion-round.jsonl`, one JSON line per round). */
function writePromotionRound(ws, pool = 7, promotedIds = []) {
  fs.writeFileSync(
    path.join(ws, ".quay", "promotion-round.jsonl"),
    `${JSON.stringify({ ts: new Date().toISOString(), round: 1, run_id: "test", action: "promote", pool, should_apply: true, promoted_ids: promotedIds, applied: [], error: null })}\n`,
    "utf8",
  );
}

test("AC3: the pool-metrics cache returns the SAME pool object within TTL and clears on demand", async () => {
  const ws = makeWorkspace("gap-par-");
  try {
    clearPoolMetricsCache();
    writePromotionRound(ws, 7);
    const m1 = await readManager(ws);
    assert.equal(m1.pool.status, "ok", "readManager pool is a live promotion-round reading");
    assert.equal(m1.pool.cap, 5, "derived dispatch cap is 5 (the production truth)");
    assert.equal(m1.pool.pool, 7, "pool comes from the driver's round record");
    assert.equal(m1.pool.floor, 20, "floor = cap × 4 = 20");
    assert.equal(m1.pool.deficit, 13, "deficit = max(0, floor − pool)");

    // Second call within TTL → cached: the SAME object reference, no re-read.
    const m2 = await readManager(ws);
    assert.equal(m1.pool, m2.pool, "pool object is cached across readManager calls within TTL");

    // clearPoolMetricsCache() forces a fresh read → a DIFFERENT object reference.
    clearPoolMetricsCache();
    const m3 = await readManager(ws);
    assert.notEqual(m3.pool, m1.pool, "clearing the cache forces a fresh round-carrier read");
    assert.equal(m3.pool.status, "ok");

    assert.ok(POOL_METRICS_CACHE_TTL_MS > 0 && POOL_METRICS_CACHE_TTL_MS <= 60_000, `TTL ${POOL_METRICS_CACHE_TTL_MS}ms is a short bounded window`);
  } finally {
    clearPoolMetricsCache();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3: the slot-refill subprocess (A22's path) is independent of the serve-side cache", async () => {
  const ws = makeWorkspace("gap-par-a22-");
  try {
    clearPoolMetricsCache();
    writePromotionRound(ws, 7);
    const before = slotRefillSubprocess(ws); // A22's direct exec — no observation.ts involved
    await readManager(ws);                    // populate the serve-side pool-metrics cache
    const after = slotRefillSubprocess(ws);   // same direct exec, cache still populated
    assert.deepEqual(after, before, "the subprocess truth is byte-identical whether or not the serve cache holds a value");
  } finally {
    clearPoolMetricsCache();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3: A22's mechanism never imports the serve-side observation module (no shared state)", () => {
  const slotRefillSrc = fs.readFileSync(SLOT_REFILL_TS, "utf8");
  assert.ok(!/import[^;]*(observation|serve)/.test(slotRefillSrc), "plugin/scripts/slot-refill.ts does not import observation.ts/serve — A22 and the WebUI cache share no module state");
});

// ── Task-summary short-TTL cache (gap-webui-dashboard-load-time-optimization AC3) ─────────────────

/** A minimal mock ProviderClient whose taskList counts invocations and returns a stable fixture
 *  array — lets the test prove the cache-hit path never re-contacts the provider (so the provider's
 *  walkTasks never executes — the AC3 mechanical check). */
function mockTaskListClient(fixtureTasks) {
  const calls = { n: 0 };
  const client = {
    taskList: async () => { calls.n += 1; return { tasks: fixtureTasks, malformed: [] }; },
  };
  return { client, calls };
}

test("AC3: readTaskSummary caches the task array for 30s and never re-calls the provider on a hit", async () => {
  const root = path.join(os.tmpdir(), `gap-tsum-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const fixture = [
    { id: "A-1", title: "one", status: "done", labels: [], updatedAt: 1 },
    { id: "A-2", title: "two", status: "todo", labels: [], updatedAt: 2 },
  ];
  try {
    clearTaskSummaryCache();
    const { client, calls } = mockTaskListClient(fixture);

    const t1 = await readTaskSummary(root, client);
    assert.equal(t1, fixture, "first read returns the provider's task array");
    assert.equal(calls.n, 1, "first read calls client.taskList exactly once");

    // Second call within TTL → cache hit: the SAME array object, provider NOT re-contacted
    // (⇒ the provider's walkTasks does not execute — the AC3 mechanical check).
    const t2 = await readTaskSummary(root, client);
    assert.equal(t2, fixture, "cache hit returns the SAME array object (no re-read)");
    assert.equal(calls.n, 1, "cache hit does NOT re-call client.taskList (walkTasks not executed)");

    // A different workspace root is a different cache bucket (no cross-workspace board sharing).
    const other = `${root}-other`;
    await readTaskSummary(other, client);
    assert.equal(calls.n, 2, "a different workspace root is a cache miss (re-reads the provider)");

    // clearTaskSummaryCache() forces a fresh read.
    clearTaskSummaryCache();
    await readTaskSummary(root, client);
    assert.equal(calls.n, 3, "clearing the cache forces a fresh provider read");

    assert.ok(TASK_SUMMARY_CACHE_TTL_MS > 0 && TASK_SUMMARY_CACHE_TTL_MS <= 60_000, `TTL ${TASK_SUMMARY_CACHE_TTL_MS}ms is a short bounded window`);
  } finally {
    clearTaskSummaryCache();
  }
});
