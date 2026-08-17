// @test-group product
// AC95 (gap-ac95-webui-15-views) — the six new design views (dashboard · system · manager · tests ·
// sessions · architecture) must each be a REAL route returning 200 with mechanism-sourced data
// (AC1/AC2), never a placeholder page; and every data source must render an honest empty state
// (未接入/无数据) rather than blank/0 when unavailable (AC3).
//
// Three layers of verification:
//   1. Pure parse functions are unit-tested against the producing mechanisms' actual text shapes
//      (resource-gate.sh / process-budget.sh / loop-driver-check.sh / session-liveness.sh /
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
import net from "node:net";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import {
  parseResourceGateJson,
  parseProcessBudgetJson,
  parseLoopDriverJson,
  parseSessionLivenessJson,
  parseSessionLivenessOutput,
  parseObserverRegistry,
  parseVerificationRound,
  buildManagerSessionTargets,
  readManager,
  readTranscriptTail,
  readTests,
} from "../src/observation.ts";
import { renderSiteNav } from "../src/serve-handlers.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

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

test("AC2: parseLoopDriverJson extracts verdict + exit code + detail", () => {
  const r = parseLoopDriverJson(JSON.stringify({ verdict: "STALLED", exit_code: 3, detail: "loop-driver: STALLED (3) — no loop driver registered; the loop will never tick", driver_count: 0, mechanism: null, last_alive_min: null, liveness_min: 60 }));
  assert.equal(r.verdict, "STALLED");
  assert.equal(r.exitCode, 3);
  assert.match(r.detail, /no loop driver/);
  const live = parseLoopDriverJson(JSON.stringify({ verdict: "LIVE", exit_code: 0, detail: "loop-driver: LIVE (0) — 1 cron driver, fresh last-alive", driver_count: 1, mechanism: "cron", last_alive_min: 0, liveness_min: 60 }));
  assert.equal(live.verdict, "LIVE");
  assert.equal(live.exitCode, 0);
});

test("AC2: parseSessionLivenessJson extracts the --once --json sessions array", () => {
  const json = JSON.stringify({ sessions: [
    { name: "quay", alive: true, pid: 2138879, halted: false },
    { name: "outer", alive: false, pid: null, halted: false },
  ] });
  const rows = parseSessionLivenessJson(json);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "quay");
  assert.equal(rows[0].alive, true);
  assert.equal(rows[0].pid, 2138879);
  assert.equal(rows[0].halted, false);
  assert.equal(rows[1].alive, false);
  assert.equal(rows[1].pid, null);
});

test("AC2: parseSessionLivenessOutput keeps dead layers (no pid field) as GONE rows", () => {
  // session-liveness.sh emits `alive=0 halted=0` WITHOUT a pid= field when the target's session
  // is gone — a dead layer must still surface as a GONE card, never be silently dropped.
  const rows = parseSessionLivenessOutput(
    "SESSION-STATUS outer alive=0 halted=0\nSESSION-STATUS inner alive=1 pid=3266379 halted=0",
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "outer");
  assert.equal(rows[0].alive, false);
  assert.equal(rows[0].pid, null);
  assert.equal(rows[1].name, "inner");
  assert.equal(rows[1].alive, true);
  assert.equal(rows[1].pid, 3266379);
});

test("AC1: buildManagerSessionTargets builds outer+inner SESSION_TARGETS from the workspace env file", () => {
  const ws = makeWorkspace("ac95-mgr-targets-");
  try {
    fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
    fs.writeFileSync(path.join(ws, "orchestration", "session-liveness.env"), [
      "# comment",
      "SESSION_TMUX_SESSION=quay-0",
      'SESSION_TARGETS="quay /home/yale/work/quay quay-0:inner"',
    ].join("\n"));
    assert.equal(buildManagerSessionTargets(ws), `outer ${ws} quay-0:outer\ninner ${ws} quay-0:inner`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1: buildManagerSessionTargets strips quotes and window suffixes", () => {
  const ws = makeWorkspace("ac95-mgr-targets2-");
  try {
    fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
    fs.writeFileSync(path.join(ws, "orchestration", "session-liveness.env"), 'SESSION_TMUX_SESSION="quay-0:inner"\n');
    assert.equal(buildManagerSessionTargets(ws), `outer ${ws} quay-0:outer\ninner ${ws} quay-0:inner`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1: buildManagerSessionTargets returns null without a session name (fail-closed, no invented target)", () => {
  const ws = makeWorkspace("ac95-mgr-targets3-");
  try {
    assert.equal(buildManagerSessionTargets(ws), null); // no orchestration/session-liveness.env
    fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
    fs.writeFileSync(path.join(ws, "orchestration", "session-liveness.env"), 'SESSION_TARGETS="quay /home/yale/work/quay quay-0:inner"\n');
    assert.equal(buildManagerSessionTargets(ws), null); // SESSION_TMUX_SESSION absent
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1: readManager registers outer+inner targets (≥2 SESSION-STATUS rows) when the workspace has a session-liveness.env", async () => {
  const ws = makeWorkspace("ac95-mgr-read-");
  try {
    fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
    fs.writeFileSync(path.join(ws, "orchestration", "session-liveness.env"), "SESSION_TMUX_SESSION=quay-0\n");
    const mgr = await readManager(ws);
    assert.equal(mgr.liveness.status, "ok");
    assert(mgr.liveness.sessions.length >= 2, `≥2 SESSION-STATUS rows (got ${mgr.liveness.sessions.length})`);
    const names = mgr.liveness.sessions.map((s) => s.name);
    assert(names.includes("outer"), `sessions include outer (got ${names.join(",")})`);
    assert(names.includes("inner"), `sessions include inner (got ${names.join(",")})`);
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

test("AC3: readTests reports empty when verification-round.jsonl is absent", () => {
  const ws = makeWorkspace("ac95-empty-");
  try {
    const t = readTests(ws);
    assert.equal(t.status, "empty");
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
  const port = await freePort();
  const server = await startServer({ port, host: "127.0.0.1" });
  try {
    const routes = [
      ["/dashboard", "Dashboard"],
      ["/system", "System — 系统状态"],
      ["/manager", "Manager / Outer / Inner"],
      ["/tests", "Tests — 验证轮记录"],
      ["/sessions", "Sessions"],
      ["/architecture", "Architecture — 系统组件图"],
    ];
    for (const [route, title] of routes) {
      const r = await get(port, route);
      assert.equal(r.status, 200, `AC1: GET ${route} returns 200 (got ${r.status})`);
      assert(r.body.includes(title), `AC1: GET ${route} is not a placeholder — includes title "${title}"`);
      assert(r.body.includes("<main>"), `AC1: GET ${route} renders a real page`);
    }

    // /tests must show the fixture round's real data (AC2 — mechanism-sourced, not blank/0).
    const testsPage = await get(port, "/tests");
    assert(testsPage.body.includes("verification-round.jsonl"), "tests page names its data source");
    assert(testsPage.body.includes("42"), "tests page shows the fixture pass count");

    // /system reads real resource-gate output on Linux (no fixture needed).
    const sysPage = await get(port, "/system");
    assert(sysPage.body.includes("resource-gate.sh"), "system page names its data source");

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
  const port = await freePort();
  const server = await startServer({ port, host: "127.0.0.1" });
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

test("AC2: /manager renders ≥2 layer cards (Outer + Inner) when the workspace registers both targets", async () => {
  const ws = makeWorkspace("ac95-mgr-page-");
  fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
  fs.writeFileSync(path.join(ws, "orchestration", "session-liveness.env"), "SESSION_TMUX_SESSION=quay-0\n");
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
  const port = await freePort();
  const server = await startServer({ port, host: "127.0.0.1" });
  try {
    const r = await get(port, "/manager");
    assert.equal(r.status, 200, "GET /manager returns 200");
    // readManager passes an explicit SESSION_TARGETS override (outer + inner), so the page must
    // render at least two layer cards — never the single-target collapse this task fixes.
    assert(r.body.includes("outer"), "/manager renders an Outer card (got single-target collapse otherwise)");
    assert(r.body.includes("inner"), "/manager renders an Inner card");
    const outerHits = (r.body.match(/<div style="font-size:0.85rem[^>]*>outer<\/div>/g) ?? []).length;
    const innerHits = (r.body.match(/<div style="font-size:0.85rem[^>]*>inner<\/div>/g) ?? []).length;
    assert(outerHits >= 1, "Outer appears as a card label");
    assert(innerHits >= 1, "Inner appears as a card label");
  } finally {
    process.chdir(cwd0);
    server.close();
    (server.client).close?.();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
