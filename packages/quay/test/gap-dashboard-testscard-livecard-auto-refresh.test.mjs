// @test-group product
// gap-dashboard-testscard-livecard-auto-refresh — the dashboard liveCard/testsCard previously rendered
// a request-time snapshot that never changed until a manual reload (48h access log: /tests 152 hits,
// /live 62 hits, median interval ~12.6/23 min but spanning 1.4s→9h — the "tab left open, manual
// refresh" pattern). This adds a light, LOCAL auto-refresh: an inline script polls the /dashboard/cards
// JSON endpoint (which re-renders ONLY those two cards) and swaps each card's own DOM node — never a
// location.reload. This test pins:
//   AC1 — the rendered dashboard HTML carries the auto-refresh script (setInterval + fetch targeting
//         the card DOM nodes), and never a whole-page location.reload;
//   AC2 — the refresh period constant falls in the [30s, 60s] domain and is interpolated into the script;
//   AC3 — the script pauses when document.visibilityState !== "visible" and resumes on visibilitychange;
//   AC4 — the /dashboard/cards endpoint returns both card fragments as no-store JSON (the fetch target).
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-testscard-livecard-auto-refresh.test.mjs
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
import { renderDashboardPage, renderDashboardCardRefreshScript, DASHBOARD_CARD_REFRESH_MS } from "../src/serve-dashboard.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** Minimal-but-shape-valid dashboard args (the same benign shape gap-dashboard-taskcard-multistatus-
 *  minitable.test.mjs uses) — the auto-refresh script presence/absence depends on NO data, only on the
 *  render function injecting it. */
function makeDashboardArgs() {
  return {
    live: { status: "ok", liveState: "running", inFlight: [], concurrency: 0 },
    sys: {
      resourceGate: { status: "ok", verdict: "GO", cpuStallAvg10: null, loadAvg: null },
      processBudget: { status: "ok", verdict: "GO" },
    },
    mgr: { liveness: { sessions: [] }, loopDriver: { verdict: "GO" } },
    tests: { runs: [], reason: null },
    suiteRun: null,
    history: { status: "empty", commits: [] },
    tasks: [],
  };
}

test("AC1: the dashboard HTML carries the auto-refresh script targeting the card DOM (no location.reload)", () => {
  const html = renderDashboardPage(makeDashboardArgs());
  assert.ok(html.includes("setInterval"), "AC1: rendered HTML has setInterval (the timed poll)");
  assert.ok(html.includes("fetch("), "AC1: rendered HTML has a fetch call");
  assert.ok(html.includes('fetch("/dashboard/cards"'), "AC1: the fetch targets the /dashboard/cards data endpoint");
  assert.ok(html.includes('id="live-card"'), "AC1: liveCard carries a stable id for the script to swap");
  assert.ok(html.includes('id="tests-card"'), "AC1: testsCard carries a stable id for the script to swap");
  assert.ok(html.includes('getElementById("live-card")'), "AC1: the script targets the live-card DOM node only");
  assert.ok(html.includes('getElementById("tests-card")'), "AC1: the script targets the tests-card DOM node only");
  assert.ok(!html.includes("location.reload"), "AC1: the refresh never does a whole-page location.reload");
});

test("AC2: the refresh period constant falls in the [30s, 60s] domain and is interpolated into the script", () => {
  assert.ok(DASHBOARD_CARD_REFRESH_MS >= 30_000 && DASHBOARD_CARD_REFRESH_MS <= 60_000,
    `DASHBOARD_CARD_REFRESH_MS ${DASHBOARD_CARD_REFRESH_MS} is within [30000, 60000]`);
  const script = renderDashboardCardRefreshScript();
  assert.ok(script.includes(String(DASHBOARD_CARD_REFRESH_MS)),
    "AC2: the script interpolates the constant (the period is configurable in one place)");
});

test("AC3: the script pauses polling when hidden and resumes on visibilitychange", () => {
  const script = renderDashboardCardRefreshScript();
  assert.ok(script.includes('document.visibilityState !== "visible"'),
    "AC3: the poll is gated on visibilityState === visible (pauses when hidden)");
  assert.ok(script.includes("visibilitychange"),
    "AC3: a visibilitychange listener exists (resume path)");
  assert.ok(script.includes('document.visibilityState === "visible"'),
    "AC3: the resume path checks visibilityState === visible");
});

// ── Integration: the /dashboard/cards route is wired and returns the two swappable fragments ──────

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

function makeWorkspace(prefix) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}tasks-`));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "auto-refresh fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "fixture"], { cwd: ws });
  return { ws, tasksDir };
}

test("AC4: /dashboard/cards returns both card fragments as no-store JSON (the script's fetch target)", async () => {
  const { ws, tasksDir } = makeWorkspace("gap-autoref-");
  const cwd0 = process.cwd();
  let server;
  try {
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const dash = await request(port, "/dashboard");
    assert.equal(dash.status, 200, "AC1: GET /dashboard returns 200");
    assert.ok(dash.body.includes('fetch("/dashboard/cards"'), "AC1: the served /dashboard script fetches /dashboard/cards");
    assert.ok(dash.body.includes('id="live-card"'), "AC1: served /dashboard HTML carries id=live-card");
    assert.ok(dash.body.includes('id="tests-card"'), "AC1: served /dashboard HTML carries id=tests-card");
    assert.ok(dash.body.includes("setInterval"), "AC1: served /dashboard HTML carries the setInterval poll");

    const cards = await request(port, "/dashboard/cards");
    assert.equal(cards.status, 200, "AC4: GET /dashboard/cards returns 200");
    assert.equal(cards.headers["cache-control"], "no-store", "AC4: /dashboard/cards is no-store (never a cached snapshot)");
    const payload = JSON.parse(cards.body);
    assert.equal(typeof payload.liveCard, "string", "AC4: payload.liveCard is a string fragment");
    assert.equal(typeof payload.testsCard, "string", "AC4: payload.testsCard is a string fragment");
    assert.ok(payload.liveCard.includes('id="live-card"'), "AC4: the liveCard fragment carries its own id (self-swappable)");
    assert.ok(payload.testsCard.includes('id="tests-card"'), "AC4: the testsCard fragment carries its own id (self-swappable)");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
