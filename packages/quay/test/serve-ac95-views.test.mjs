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
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import {
  parseResourceGateOutput,
  parseProcessBudgetOutput,
  parseLoopDriverOutput,
  parseSessionLivenessOutput,
  parseObserverRegistry,
  parseVerificationRound,
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

// ── Pure parse-function unit tests (AC2: numbers from the producing mechanism's text) ───────────────

test("AC2: parseResourceGateOutput extracts the mechanism's report fields", () => {
  const text = `cpu_stall(some avg10)=55.21  [limit 60]   ok
cpu_stall(some avg300)=15.12
mem_avail=8380MB             [limit 2048] ok
loadavg=23.90             [limit nproc×2≈32] ok
nproc=16  node_procs=74  swap=0  [nproc-invariant ok]
=> GO: 资源充足，可以跑`;
  const r = parseResourceGateOutput(text);
  assert.equal(r.cpuStallAvg10, 55.21);
  assert.equal(r.cpuStallAvg300, 15.12);
  assert.equal(r.memAvailMb, 8380);
  assert.equal(r.loadAvg, 23.9);
  assert.equal(r.nproc, 16);
  assert.equal(r.nodeProcs, 74);
  assert.equal(r.verdict, "GO");
});

test("AC2: parseProcessBudgetOutput extracts the budget key=value fields", () => {
  const text = `total_budget=16
in_use=18
available=0
verdict=WAIT`;
  const r = parseProcessBudgetOutput(text);
  assert.equal(r.totalBudget, 16);
  assert.equal(r.inUse, 18);
  assert.equal(r.available, 0);
  assert.equal(r.verdict, "WAIT");
});

test("AC2: parseLoopDriverOutput extracts verdict + exit code + detail", () => {
  const r = parseLoopDriverOutput("loop-driver: STALLED (3) — no loop driver registered; the loop will never tick", 3);
  assert.equal(r.verdict, "STALLED");
  assert.equal(r.exitCode, 3);
  assert.match(r.detail, /no loop driver/);
  const live = parseLoopDriverOutput("loop-driver: LIVE (0) — 1 cron driver, fresh last-alive", 0);
  assert.equal(live.verdict, "LIVE");
  assert.equal(live.exitCode, 0);
});

test("AC2: parseSessionLivenessOutput extracts SESSION-STATUS rows", () => {
  const text = `session-liveness: starting pid=1 file=session-liveness.sh md5=x
SESSION-STATUS quay alive=1 pid=2138879 halted=0
SESSION-STATUS outer alive=0 pid=0 halted=0`;
  const rows = parseSessionLivenessOutput(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "quay");
  assert.equal(rows[0].alive, true);
  assert.equal(rows[0].pid, 2138879);
  assert.equal(rows[0].halted, false);
  assert.equal(rows[1].alive, false);
  assert.equal(rows[1].pid, null);
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
