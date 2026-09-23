// @test-group product
// AC95 (gap-ac95-webui-15-views) — the six new design views (dashboard · system · manager · tests ·
// sessions · architecture) must each be a REAL route returning 200 with mechanism-sourced data
// (AC1/AC2), never a placeholder page; and every data source must render an honest empty state
// (未接入/无数据) rather than blank/0 when unavailable (AC3).
//
// Three layers of verification:
//   1. Pure parse functions are unit-tested against the producing mechanisms' actual text shapes
//      (resource-gate.sh / process-budget.sh / loop-driver-check.sh /
//      observer-registry.conf / verification-round.jsonl) — the AC2 "numbers come from the
//      mechanism" contract is pinned at the parse boundary.
//   2. The six routes are integration-tested against a real started server + temp workspace: 200 +
//      non-placeholder content for each, and honest empty states when the source is absent.
//   3. renderSiteNav exposes all 15 views (the design's navGroupDefs) so the views are reachable.
//
// Run (scoped): node --test packages/quay/test/serve-ac95-views.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import {
  parseResourceGateJson,
  parseProcessBudgetJson,
  parseLoopDriverJson,
  parseObserverRegistry,
  parseVerificationRound,
  classifySessionLayer,
  readManager,
  readTranscriptTail,
  readTests,
  scriptBasename,
  RESOURCE_GATE_REL,
  PROCESS_BUDGET_REL,
  RESOURCE_GATE_NAME,
  PROCESS_BUDGET_NAME,
} from "../src/observation.ts";
import { renderSiteNav } from "../src/serve-handlers.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// `freePort()` DELETED — probe-then-bind is a TOCTOU over the shared ephemeral-port space, and its
// loopback probe did not even match startServer's 0.0.0.0 bind. Measured EADDRINUSE + the fix (bind
// port 0, read server.address().port) are recorded in packages/quay/test/serve-board.test.mjs.

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** git-init a temp workspace with the native provider wired to a local tasks dir. */
function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "ac95 fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: ws });
  return ws;
}

// ── Pure parse-function unit tests (AC2/AC99: numbers from the producing mechanism's --json) ────────

test("AC2: parseResourceGateJson extracts the mechanism's --json fields", () => {
  const json = JSON.stringify({
    cpu_stall_avg10: 55.21,
    cpu_stall_avg300: 15.12,
    cpu_limit: 60,
    mem_avail_mb: 8380,
    mem_limit_mb: 2048,
    loadavg: 23.9,
    load_threshold: 32,
    load_over_factor: 2,
    nproc: 16,
    node_procs: 74,
    verdict: "GO",
    reason: "=> GO: 资源充足，可以跑",
  });
  const r = parseResourceGateJson(json);
  assert.equal(r.cpuStallAvg10, 55.21);
  assert.equal(r.cpuStallAvg300, 15.12);
  assert.equal(r.memAvailMb, 8380);
  assert.equal(r.loadAvg, 23.9);
  assert.equal(r.nproc, 16);
  assert.equal(r.nodeProcs, 74);
  assert.equal(r.verdict, "GO");
  // AC99/AC3 — the loadavg threshold is carried from the mechanism (computed from nproc), never
  // recomputed with a host literal in the UI.
  assert.equal(r.loadThreshold, 32);
  assert.equal(r.loadOverFactor, 2);
});

test("AC2: parseResourceGateJson tolerates unmeasurable signals as null (硬规则③b)", () => {
  const json = JSON.stringify({ cpu_stall_avg10: null, cpu_stall_avg300: null, mem_avail_mb: null, loadavg: null, nproc: 16, node_procs: 74, verdict: "WAIT", load_threshold: 32, load_over_factor: 2 });
  const r = parseResourceGateJson(json);
  assert.equal(r.cpuStallAvg10, null);
  assert.equal(r.loadAvg, null);
  assert.equal(r.verdict, "WAIT");
  assert.equal(r.loadThreshold, 32);
});

test("AC2: parseProcessBudgetJson extracts the budget --json fields", () => {
  const json = JSON.stringify({ total_budget: 16, in_use: 18, available: 0, verdict: "WAIT", node_comm_mainthread: 0, node_cmdline_procs: 25, instrument_failure: 0 });
  const r = parseProcessBudgetJson(json);
  assert.equal(r.totalBudget, 16);
  assert.equal(r.inUse, 18);
  assert.equal(r.available, 0);
  assert.equal(r.verdict, "WAIT");
});

// ── AC2 of gap-serve-labels-hardcode-mechanism-script-basenames: the /system labels are DERIVED
// from the single naming point (the REL constants), ⛔ not a second literal and ⛔ not a lookup
// table. The two arms below are what tells those apart — a table keyed by the two known rels would
// pass the second arm and fail the first.
test("AC2: scriptBasename is a general derivation — a rel in NO table yields its basename (negative control)", () => {
  // (a) the arm a LOOKUP TABLE cannot pass: a rel that appears in no table/constant anywhere.
  assert.equal(scriptBasename("scripts/whatever.sh"), "whatever.sh",
    "a rel in no table must still yield its basename — a table would return undefined/throw here");
  // …and it is not keyed on the directory either: same basename, arbitrary prefix.
  assert.equal(scriptBasename(path.join("some", "other", "dir", "whatever.sh")), "whatever.sh");
  // …nor restricted to `.sh` (the face is a derivation over rels, not a shell-script table).
  assert.equal(scriptBasename("plugin/scripts/thing.ts"), "thing.ts");
  // (b) the real labels come off the SAME single accessor.
  assert.equal(scriptBasename(RESOURCE_GATE_REL), "resource-gate.sh");
  assert.equal(scriptBasename(PROCESS_BUDGET_REL), "process-budget.sh");
  assert.equal(RESOURCE_GATE_NAME, "resource-gate.sh");
  assert.equal(PROCESS_BUDGET_NAME, "process-budget.sh");
  // (c) the property a SECOND LITERAL could not have: the label follows the rel. Taken on the
  // derivation face (no need to mutate the constant to falsify it).
  assert.equal(scriptBasename(path.join("scripts", "renamed-gate.sh")), "renamed-gate.sh");
  assert.equal(RESOURCE_GATE_NAME, scriptBasename(RESOURCE_GATE_REL));
});

test("AC2: parseLoopDriverJson extracts verdict + exit code + detail", () => {
  const r = parseLoopDriverJson(JSON.stringify({ verdict: "STALLED", exit_code: 3, detail: "loop-driver: STALLED (3) — no loop driver registered; the loop will never tick", driver_count: 0, mechanism: null, last_alive_min: null, liveness_min: 60 }));
  assert.equal(r.verdict, "STALLED");
  assert.equal(r.exitCode, 3);
  assert.match(r.detail, /no loop driver/);
  const live = parseLoopDriverJson(JSON.stringify({ verdict: "LIVE", exit_code: 0, detail: "loop-driver: LIVE (0) — 1 cron driver, fresh last-alive", driver_count: 1, mechanism: "cron", last_alive_min: 0, liveness_min: 60 }));
  assert.equal(live.verdict, "LIVE");
  assert.equal(live.exitCode, 0);
});

test("AC2: classifySessionLayer maps session names to the three layers (never drops to nothing)", () => {
  // Manager view's explicit target names + topology-style window-suffixed names + the manager's own.
  assert.equal(classifySessionLayer("outer"), "Outer");
  assert.equal(classifySessionLayer("inner"), "Inner");
  assert.equal(classifySessionLayer("quay-0:outer"), "Outer");
  assert.equal(classifySessionLayer("quay-0:inner"), "Inner");
  assert.equal(classifySessionLayer("quay-0:manager"), "Manager");
  assert.equal(classifySessionLayer("manager"), "Manager");
  assert.equal(classifySessionLayer("INNER"), "Inner"); // case-insensitive
  // A name carrying no layer marker must land in Other, never be dropped from the page.
  assert.equal(classifySessionLayer("quay"), "Other");
});

test("AC1: readManager reports the liveness observer retired (empty, never fabricated) after 2026-09-03", async () => {
  const ws = makeWorkspace("ac95-mgr-read-");
  try {
    const mgr = await readManager(ws);
    assert.equal(mgr.liveness.status, "empty");
    assert.equal(mgr.liveness.sessions.length, 0);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2: parseObserverRegistry reads the | separated registration rows", () => {
  const text = `# comment
quay|active|.|quay-0|本仓库
meta-cc|offline|$HOME/work/meta-cc|meta-cc|兄弟项目
`;
  const rows = parseObserverRegistry(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "quay");
  assert.equal(rows[0].status, "active");
  assert.equal(rows[1].status, "offline");
});

test("AC2: parseVerificationRound reads a round record and skips malformed lines", () => {
  const line = JSON.stringify({
    round: 3, startedAt: "2026-08-17T00:00:00Z", durationMs: 180000, state: "red",
    pass: 900, fail: 2, cancelled: 0, tests: 902, reason: "failed", commit: "abc123def456",
    scope: "full", runner: "node --test", failures: [{ file: "serve.test.mjs", name: "x" }],
  });
  const r = parseVerificationRound(line);
  assert.equal(r.round, 3);
  assert.equal(r.state, "red");
  assert.equal(r.fail, 2);
  assert.equal(r.tests, 902);
  assert.equal(r.commit, "abc123def456");
  assert.deepEqual(r.failures, ["serve.test.mjs"]);
  assert.equal(parseVerificationRound("not json"), null);
});

test("AC2: parseVerificationRound reads a PRE-VERIFIED round record (gap-preverified-suite-bypasses-verification-round-ledger) — unknown fields (preverified/taskId/runId) tolerated, absent pass/fail/cancelled parse as null", () => {
  // The shape plugin/scripts/pre-verified-round-record.ts writes: a SuiteRoundRecord-compatible row
  // WITHOUT pass/fail/cancelled/tests (the pre-verified capture carries no test counts) and WITH the
  // preverified:true marker + taskId/runId for traceability. The /tests reader must render it
  // (absent counts → null, never a fabricated 0) and tolerate the unknown fields.
  const line = JSON.stringify({
    round: 228, startedAt: "2026-08-17T04:30:00.000Z", durationMs: 936519, laneCount: 8, load: 8.03,
    state: "green", runner: "outer", scope: "worktree",
    commit: "426b21ceaabbe7502334d92d79ce4a4a8d935fe9",
    preverified: true, taskId: "gap-x", runId: "fm-x-1",
  });
  const r = parseVerificationRound(line);
  assert.equal(r.round, 228);
  assert.equal(r.startedAt, "2026-08-17T04:30:00.000Z");
  assert.equal(r.durationMs, 936519);
  assert.equal(r.state, "green");
  assert.equal(r.scope, "worktree");
  assert.equal(r.commit, "426b21ceaabbe7502334d92d79ce4a4a8d935fe9");
  assert.equal(r.pass, null, "an absent pass count renders as null, never a fabricated 0");
  assert.equal(r.fail, null);
  assert.equal(r.cancelled, null);
  assert.equal(r.tests, null);
  assert.equal(r.runner, "outer");
});

test("AC2: parseVerificationRound reads a REAL-SUITE fan-in round record (gap-fan-in-realsuite-bypasses-verification-round-ledger) — preverified:false (distinct from a reused-capture round), absent pass/fail/cancelled parse as null", () => {
  // The shape plugin/scripts/pre-verified-round-record.ts writes with --preverified 0: the real-suite
  // branch (a full suite that RAN inside this fan-in via the detached `bash scripts/test.sh` path).
  // Same SuiteRoundRecord-compatible row as the pre-verified record, but preverified:false marks it as a
  // REAL run — the /tests reader must render it (absent counts → null) and tolerate the unknown fields.
  const line = JSON.stringify({
    round: 229, startedAt: "2026-08-17T19:45:00.000Z", durationMs: 1020000, laneCount: 16, load: 12.3,
    state: "green", runner: "outer", scope: "worktree",
    commit: "37b8afcf9d09a5e5f5f5f5f5f5f5f5f5f5f5f5f",
    cpu_time_s: 2592, cpu_source: "gnu-time",
    preverified: false, taskId: "gap-fan-in-turn-budget-suite-timeout", runId: "fm-1",
  });
  const r = parseVerificationRound(line);
  assert.equal(r.round, 229);
  assert.equal(r.startedAt, "2026-08-17T19:45:00.000Z");
  assert.equal(r.durationMs, 1020000, "durationMs = the real suite's wall-clock");
  assert.equal(r.state, "green");
  assert.equal(r.scope, "worktree");
  assert.equal(r.commit, "37b8afcf9d09a5e5f5f5f5f5f5f5f5f5f5f5f5f");
  assert.equal(r.pass, null, "an absent pass count renders as null, never a fabricated 0");
  assert.equal(r.fail, null);
  assert.equal(r.cancelled, null);
  assert.equal(r.tests, null);
  assert.equal(r.runner, "outer");
});

test("AC2: parseVerificationRound reads a PHASE-BEARING fan-in round record (gap-fan-in-verification-round-thin-schema-phase-gap) — serial/main/static phase ms + nproc/concurrentSuiteSlots/concurrentSuitesRunning render, absent on legacy rows", () => {
  // The shape plugin/scripts/pre-verified-round-record.ts writes with --suite-log: a fan-in landing row
  // carrying the SAME phase + concurrency axes full-suite-runner's rich rows carry. AC101's
  // lane-concurrency control round reads these via /tests to compare the fan-in baseline against a
  // control round at the same 口径. Legacy/thin rows (no such fields) must parse as null, never 0.
  const line = JSON.stringify({
    round: 234, startedAt: "2026-08-18T00:00:00.000Z", durationMs: 1020000, laneCount: 16, load: 12.3,
    state: "green", runner: "outer", scope: "worktree",
    commit: "37b8afcf9d09a5e5f5f5f5f5f5f5f5f5f5f5f5f",
    static_phase_ms: 12345, serial_phase_ms: 301234, lowconc_phase_ms: 0, main_phase_ms: 512345,
    nproc: 16, concurrentSuiteSlots: 2, concurrentSuitesRunning: 1,
    preverified: false, taskId: "gap-x", runId: "fm-x-1",
  });
  const r = parseVerificationRound(line);
  assert.equal(r.round, 234);
  assert.equal(r.state, "green");
  assert.equal(r.static_phase_ms, 12345, "static_phase_ms renders");
  assert.equal(r.serial_phase_ms, 301234, "serial_phase_ms renders");
  assert.equal(r.lowconc_phase_ms, 0, "lowconc_phase_ms renders 0 (a real value, not null)");
  assert.equal(r.main_phase_ms, 512345, "main_phase_ms renders");
  assert.equal(r.nproc, 16, "nproc renders");
  assert.equal(r.concurrentSuiteSlots, 2, "concurrentSuiteSlots renders");
  assert.equal(r.concurrentSuitesRunning, 1, "concurrentSuitesRunning renders");

  // Legacy/thin row (the pre-fix fan-in shape — no phase/concurrency fields) ⇒ null, never a fabricated 0.
  const thin = parseVerificationRound(JSON.stringify({
    round: 228, startedAt: "2026-08-17T04:30:00.000Z", durationMs: 936519, laneCount: 8, load: 8.03,
    state: "green", runner: "outer", scope: "worktree",
    commit: "426b21ceaabbe7502334d92d79ce4a4a8d935fe9",
    preverified: true, taskId: "gap-x", runId: "fm-x-1",
  }));
  assert.equal(thin.serial_phase_ms, undefined, "a thin row has no phase fields (absent-field contract)");
  assert.equal(thin.nproc, undefined, "a thin row has no concurrency fields");
});

test("AC3: readTests reports empty when verification-round.jsonl is absent", () => {
  const ws = makeWorkspace("ac95-empty-");
  try {
    const t = readTests(ws);
    // This workspace declares no suite entry and has no scripts/test.sh ⇒ the absence is a WIRING fact,
    // so the enumerated value is `empty-no-writer` (gap-verification-round-empty-state-lumps-three-
    // distinct-causes split the former catch-all `empty`; 「无数据」 is still what is rendered).
    assert.equal(t.status, "empty-no-writer");
    assert.equal(t.runs.length, 0);
    assert.match(t.reason, /未接入/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3: readTests parses a fixture round sequence newest-first", () => {
  const ws = makeWorkspace("ac95-tests-");
  try {
    fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".quay", "verification-round.jsonl"), [
      JSON.stringify({ round: 1, startedAt: "2026-08-16T00:00:00Z", durationMs: 1000, state: "green", pass: 5, fail: 0, cancelled: 0, tests: 5, reason: null, commit: "aaaa", scope: "full", runner: "node --test", failures: [] }),
      JSON.stringify({ round: 2, startedAt: "2026-08-17T00:00:00Z", durationMs: 2000, state: "red", pass: 4, fail: 1, cancelled: 0, tests: 5, reason: "failed", commit: "bbbb", scope: "full", runner: "node --test", failures: [{ file: "a.test.mjs" }] }),
    ].join("\n"));
    const t = readTests(ws);
    assert.equal(t.status, "ok");
    assert.equal(t.runs.length, 2);
    assert.equal(t.runs[0].round, 2); // file order preserved (suite writer appends oldest→newest); page labels 新→旧
    assert.equal(t.runs[0].state, "red");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// gap-tests-load-curve-time-window-fallback — view-level regression: a round whose runId now flows
// into the two-level load resolver must still render /tests 200 (and degrade to no-curve, not a 500)
// when that runId maps to no load file — the parse→render contract is untouched by the fallback.
test("regression: /tests renders a broken-key runId round as 200 with no fabricated curve (no 500)", async () => {
  const ws = makeWorkspace("ac95-fallback-reg-");
  const cwd0 = process.cwd();
  process.chdir(ws);
  // ⛔ never probe-then-bind (see packages/quay/test/serve-board.test.mjs header)
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  const port = server.address().port;
  try {
    fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".quay", "verification-round.jsonl"), [
      JSON.stringify({ round: 692, startedAt: "2026-08-29T17:28:27.282Z", durationMs: 60000, state: "red", runId: "wk-prod-1788022868", pass: 0, fail: 1, cancelled: 0, tests: 1, failures: [] }),
    ].join("\n"));
    const r = await get(port, "/tests");
    assert.equal(r.status, 200, "GET /tests with a broken-key runId round returns 200");
    // ⚠️ MIGRATED by gap-webui-tests-body-copy-en-zh (2026-09-18): this is a DEFAULT-LOCALE read
    // (`get` sends no lang cookie/param, and the default is `en`), so it pins the en token — which
    // the body-copy task moved from the Chinese-bearing composite to `Tests — verification rounds`.
    assert.ok(r.body.includes("Tests — verification rounds"), "the page still renders");
    assert.ok(!r.body.includes("<polyline"), "no load file → no fabricated curve");
  } finally {
    process.chdir(cwd0);
    server.close();
    server.client?.close?.();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3: readTranscriptTail reads the last user/assistant texts from a transcript JSONL tail", () => {
  const p = path.join(os.tmpdir(), `ac95-tx-${process.pid}.jsonl`);
  try {
    fs.writeFileSync(p, [
      JSON.stringify({ type: "user", timestamp: "2026-08-17T00:00:00Z", message: { role: "user", content: "hello" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-08-17T00:01:00Z", message: { role: "assistant", content: [{ type: "text", text: "hi there" }] } }),
    ].join("\n"));
    const r = readTranscriptTail(p, 5);
    assert.equal(r.status, "ok");
    assert.equal(r.messages.length, 2);
    assert.equal(r.messages[0].role, "user");
    assert.equal(r.messages[1].text, "hi there");
  } finally {
    fs.rmSync(p, { force: true });
  }
});

test("AC1: renderSiteNav lists all 15 views (design navGroupDefs)", () => {
  const nav = renderSiteNav("dashboard");
  for (const label of ["Dashboard", "Tasks", "Live", "Board", "System", "Manager", "Journal", "Git History", "Tests", "Sessions", "ADRs", "Goals", "Docs", "Architecture"]) {
    assert(nav.includes(label), `nav includes ${label}`);
  }
  assert(nav.includes('href="/dashboard"') === false, "current page is plain <strong>, not a link");
  assert(nav.includes('href="/system"'), "nav links to /system");
});

// ── Route integration tests (AC1: real 200 routes, non-placeholder; AC3: honest empty states) ───────

test("AC1/AC3: the six new routes return 200 with real content or honest empty state", async () => {
  const ws = makeWorkspace("ac95-routes-");
  // Give the workspace a packages/ tree + a verification round + a task so the views have real data.
  fs.mkdirSync(path.join(ws, "packages", "quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "packages", "quay-native"), { recursive: true });
  fs.mkdirSync(path.join(ws, "packages", "quay-github"), { recursive: true });
  for (const name of ["quay", "quay-native", "quay-github"]) {
    fs.writeFileSync(path.join(ws, "packages", name, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  }
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "verification-round.jsonl"), JSON.stringify({
    round: 1, startedAt: "2026-08-17T00:00:00Z", durationMs: 5000, state: "green", pass: 42, fail: 0, cancelled: 0, tests: 42, reason: null, commit: "abcdef123456", scope: "full", runner: "node --test", failures: [],
  }) + "\n");
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(ws, "tasks", "AC95-001.md"), `---\nid: AC95-001\ntitle: "demo"\nstatus: todo\nlabels: []\n---\n\n## Proposal\nx\n`);
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture data"], { cwd: ws });

  const cwd0 = process.cwd();
  process.chdir(ws);
  // ⛔ never probe-then-bind (see packages/quay/test/serve-board.test.mjs header)
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  const port = server.address().port;
  try {
    // ⚠️ These are DEFAULT-LOCALE readings (`get` sends no lang cookie/param), and the default is
    // `en` — so each entry pins the token that page's `<title>` carries under en.
    // ⚠️ MIGRATED by gap-webui-architecture-body-copy-en-zh (2026-09-18): the /architecture row used
    // to read `Architecture — 系统组件图`, because AC-303's `pageTitle` token carried a Chinese
    // subtitle and ROW 3's en column is the identity — so the page's own `<title>` rendered Chinese
    // under the DEFAULT locale. The body-copy task re-keyed the token (see serve-i18n.ts's RE-KEYED
    // note); the en row follows, and the pre-existing Chinese is asserted EXPLICITLY under zh below
    // rather than left to a default-locale read that only looked Chinese by accident.
    // ⚠️ MIGRATED by gap-webui-system-body-copy-en-zh (2026-09-18), same shape as the /architecture
    // row above: the /system row used to read `System — 系统状态`, because that page's subtitle was
    // hard-coded Chinese and the `<title>` rendered it verbatim under the DEFAULT locale. The
    // body-copy task moved the subtitle into serve-i18n.ts ROW 14 (the page NAME stays ROW 3's
    // token), so the en row follows, and the pre-existing Chinese is asserted EXPLICITLY under zh
    // below rather than left to a default-locale read that only looked Chinese by accident.
    // ⚠️ MIGRATED by gap-webui-tests-body-copy-en-zh (2026-09-18), same shape again: the /tests row
    // used to read `Tests — 验证轮记录`, because AC-298's `pageTitle` token was the FULL composite
    // (em dash and Chinese subtitle included) and ROW 3's en column is the identity — so the page's
    // own `<title>`/`<h1>` rendered Chinese under the DEFAULT locale. This task re-keyed it to the
    // bare `Tests` token with the subtitle appended from serve-i18n.ts ROW 20 (see that row's RE-KEYED
    // note); the en row follows, and the pre-existing Chinese is asserted EXPLICITLY under zh below.
    const routes = [
      ["/dashboard", "Dashboard"],
      ["/system", "System — system status"],
      ["/manager", "Manager / Outer / Inner"],
      ["/tests", "Tests — verification rounds"],
      ["/sessions", "Sessions"],
      ["/architecture", "Architecture — system component map"],
    ];
    for (const [route, title] of routes) {
      const r = await get(port, route);
      assert.equal(r.status, 200, `AC1: GET ${route} returns 200 (got ${r.status})`);
      assert(r.body.includes(title), `AC1: GET ${route} is not a placeholder — includes title "${title}"`);
      assert(/<main[\s>]/.test(r.body), `AC1: GET ${route} renders a real page`);
    }
    // …and the zh arm for the page this task moved, so the Chinese token is pinned EXPLICITLY (an
    // assertion that only ever reads the default locale cannot tell "still Chinese" from "never was
    // translated"). Both arms together are the re-key's contract: en moved, zh did not.
    const archZh = await get(port, "/architecture?lang=zh");
    assert(archZh.body.includes("架构 — 系统组件图"),
      "AC1: the zh <title>/<h1> token is the pre-existing Chinese, explicitly requested");
    // …and the zh page's BODY copy did not fall back to English. ⛔ Deliberately NOT phrased as
    // `!includes("system component map")`: that string IS on the zh page once, as the
    // `<meta name="description">` residue (already-English, passes through no dictionary, named
    // out-of-scope in serve-i18n.ts ROW 12). The arm asserts the copy that IS dictionary-backed.
    for (const zhCopy of ["数据源：", "组件最近变更（git 可证，近 7 天）", "末次提交"]) {
      assert(archZh.body.includes(zhCopy), `AC1: the zh page keeps its body copy ${JSON.stringify(zhCopy)}`);
    }
    assert(!archZh.body.includes("Last commit") && !archZh.body.includes("Source:"),
      "AC1: …and the zh body copy did not fall back to the en wording");

    // /tests must show the fixture round's real data (AC2 — mechanism-sourced, not blank/0).
    const testsPage = await get(port, "/tests");
    assert(testsPage.body.includes("verification-round.jsonl"), "tests page names its data source");
    assert(testsPage.body.includes("42"), "tests page shows the fixture pass count");
    // …and the zh arm for the page THIS task moved: the subtitle's Chinese is pinned EXPLICITLY, and
    // the default-locale read above is asserted to NOT carry it. Both arms together are the re-key's
    // contract: the en title moved, the zh one did not.
    const testsZh = await get(port, "/tests?lang=zh");
    assert(testsZh.body.includes("测试 — 验证轮记录"),
      "AC1: the zh /tests <title>/<h1> is the pre-existing Chinese, explicitly requested");
    assert(!testsPage.body.includes("验证轮记录"),
      "AC1: the default-locale /tests no longer carries the Chinese subtitle");
    // …and the zh page's BODY copy did not fall back to English (the dictionary-backed rows, i.e. the
    // copy this task's ROW 20 owns — ⛔ not `obsNote`'s shared-chrome label, which is out of scope).
    for (const zhCopy of ["数据源：", "最近测试记录分段时间轴", "历史运行（新→旧）"]) {
      assert(testsZh.body.includes(zhCopy), `AC1: the zh /tests keeps its body copy ${JSON.stringify(zhCopy)}`);
    }
    assert(testsPage.body.includes("Recent test-record timeline segments"),
      "AC1: the default-locale /tests renders its body copy in English");
    assert(!testsPage.body.includes("最近测试记录分段时间轴"),
      "AC1: …and that English copy is not merely alongside the Chinese one");

    // /system reads real resource-gate output on Linux (no fixture needed).
    const sysPage = await get(port, "/system");
    assert(sysPage.body.includes("resource-gate.sh"), "system page names its data source");

    // …and the zh arm for the page this task moved: the subtitle's Chinese is pinned EXPLICITLY, and
    // the en arm above is asserted to NOT carry it (both arms together are the move's contract: the
    // en title moved, the zh one did not).
    const sysZh = await get(port, "/system?lang=zh");
    assert(sysZh.body.includes("系统 — 系统状态"),
      "AC1: the zh <title>/<h1> is the pre-existing Chinese, explicitly requested");
    assert(!sysPage.body.includes("系统状态"),
      "AC1: the default-locale /system no longer carries the Chinese subtitle");

    // /architecture shows the packages/ components as a real table (not 未接入).
    const archPage = await get(port, "/architecture");
    assert(archPage.body.includes("quay-native") || archPage.body.includes("quay-github"), "architecture lists package components");
  } finally {
    process.chdir(cwd0);
    server.close();
    (server.client).close?.();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3: empty workspace still returns 200 with honest 未接入 states, never 500", async () => {
  const ws = makeWorkspace("ac95-bare-");
  const cwd0 = process.cwd();
  process.chdir(ws);
  // ⛔ never probe-then-bind (see packages/quay/test/serve-board.test.mjs header)
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  const port = server.address().port;
  try {
    const testsPage = await get(port, "/tests");
    assert.equal(testsPage.status, 200);
    assert(testsPage.body.includes("未接入") || testsPage.body.includes("无数据"), "empty tests → honest empty state");

    const archPage = await get(port, "/architecture");
    assert.equal(archPage.status, 200);
    assert(archPage.body.includes("未接入") || archPage.body.includes("无数据"), "no packages/ dir → honest empty state");

    const dash = await get(port, "/dashboard");
    assert.equal(dash.status, 200);
    assert(dash.body.includes("Dashboard"), "dashboard renders");
  } finally {
    process.chdir(cwd0);
    server.close();
    (server.client).close?.();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC99 (gap-ac99-webui-machine-readable-json): every Manager/System field traces to a stable-JSON
// mechanism, and at least one AC-level check reads the PRODUCTION carrier (the real script's --json
// stdout) — 硬规则④推论三: 关掉 fixture/注入 seam 后判据仍能通过才算测量，否则是回声.

const REPO_ROOT_AC99 = path.resolve(__dirname, "..", "..", "..");
const RES_GATE = path.join(REPO_ROOT_AC99, "plugin", "scripts", "resource-gate.sh");
const PROC_BUDGET = path.join(REPO_ROOT_AC99, "plugin", "scripts", "process-budget.sh");
const LOOP_DRV = path.join(REPO_ROOT_AC99, "plugin", "scripts", "loop-driver-check.sh");

function spawnJson(cmd, args, opts = {}) {
  const r = execFileSync(cmd, args, { encoding: "utf8", timeout: 30_000, ...opts });
  return JSON.parse(r.trim());
}

test("AC99 — resource-gate.sh/process-budget.sh --json are valid production JSON (nproc-derived load_threshold, AC3)", () => {
  const rg = spawnJson("bash", [RES_GATE, "--json"]);
  assert.ok(rg.verdict === "GO" || rg.verdict === "WAIT", `verdict must be GO or WAIT, got ${rg.verdict}`);
  assert.equal(typeof rg.nproc, "number");
  // AC3 — load_threshold is nproc × load_over_factor computed INSIDE the mechanism, never a host literal.
  assert.equal(rg.load_threshold, Math.round(rg.nproc * rg.load_over_factor));
  assert.equal(typeof rg.reason, "string");

  const pb = spawnJson("bash", [PROC_BUDGET, "--json"]);
  assert.ok(pb.verdict === "GO" || pb.verdict === "WAIT", `verdict must be GO or WAIT, got ${pb.verdict}`);
  assert.equal(typeof pb.total_budget, "number");
  assert.equal(pb.available, Math.max(0, pb.total_budget - pb.in_use));
});

test("AC99 — loop-driver-check.sh --json is valid production JSON with a recognizable verdict", () => {
  const ws = makeWorkspace("ac99-loop-");
  try {
    // A fresh workspace has no driver registry → STALLED (exit 3) — the exit code is the verdict
    // carrier; the JSON document is still emitted on stdout, so spawnSync (not execFileSync).
    const r = spawnSync("bash", [LOOP_DRV, "--json", ws], { encoding: "utf8", timeout: 30_000 });
    assert.equal(r.status, 3, "fresh workspace must be STALLED (exit 3)");
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.verdict, "STALLED");
    assert.equal(j.exit_code, 3);
    assert.equal(j.driver_count, 0);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2: /manager returns 200 and renders the retired liveness empty state (never fabricated)", async () => {
  const ws = makeWorkspace("ac95-mgr-page-");
  fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(ws, "packages", "quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "packages", "quay-native"), { recursive: true });
  fs.mkdirSync(path.join(ws, "packages", "quay-github"), { recursive: true });
  for (const name of ["quay", "quay-native", "quay-github"]) {
    fs.writeFileSync(path.join(ws, "packages", name, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  }
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture data"], { cwd: ws });

  const cwd0 = process.cwd();
  process.chdir(ws);
  // ⛔ never probe-then-bind (see packages/quay/test/serve-board.test.mjs header)
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  const port = server.address().port;
  try {
    const r = await get(port, "/manager");
    assert.equal(r.status, 200, "GET /manager returns 200");
    // The liveness observer was retired 2026-09-03 — the manager page must render the honest
    // empty state for liveness (the retired reason), never a fabricated outer/inner layer card.
    assert(r.body.includes("liveness observer retired 2026-09-03"), "/manager renders the retired liveness note");
  } finally {
    process.chdir(cwd0);
    server.close();
    (server.client).close?.();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
