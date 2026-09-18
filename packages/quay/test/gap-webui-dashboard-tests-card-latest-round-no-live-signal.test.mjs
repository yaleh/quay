// @test-group product
// gap-webui-dashboard-tests-card-latest-round-no-live-signal — the /dashboard 测试 card previously
// rendered ONLY tests.runs[0] (the ledger's latest COMPLETED round). On the real deployment this
// showed a misleading "red · pass 0/0" while (a) a suite was genuinely RUNNING right now
// (`.quay/full-suite-state.json` state=running, no ledger row yet) and (b) the latest ledger row was
// a static-check GATE failure (pass=0/tests=0 by construction — the gate rejected before any test
// file ran), while the /tests page's full history showed a very different picture (neighboring green
// rounds with thousands of real tests). This test pins:
//   AC1 — a live-running suite (`full-suite-state.json` state=running, NO taskId field — the shape
//         full-suite-runner.ts actually writes) renders "运行中" + elapsed/runner/scope, not a stale
//         completed-round summary;
//   AC2 — with no suite running and the latest ledger round a gate-failure (pass=0/tests=0/
//         reason=gate-failed/gate=static-check), the card's headline does NOT read "pass 0/0" —
//         it names the gate instead;
//   AC3 — the recent-run list renders a per-round chip so the single latest row is never the only
//         signal, distinguishing gate-blocked rounds from real red (test failures) and green. (The
//         hover-only 近N轮 colour strip was removed by gap-dashboard-cards-layout-and-livecard-swimlane
//         AC1; its per-round colour + tooltip info now lives on the round-number chip below.)
//
// Run (scoped): node --test packages/quay/test/gap-webui-dashboard-tests-card-latest-round-no-live-signal.test.mjs
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { clearVerificationRoundCache } from "../src/observation.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

let server, port, originalCwd, workspaceRoot, tasksDir;

before(async () => {
  tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-testscard-tasks-"));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gap-testscard-ws-"));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "gap-testscard fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: workspaceRoot });
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
  // gap-ac179-criterion-cold-miss-30s-ttl-always-expired: /dashboard's request path now serves a
  // SNAPSHOT built by a background tick, so a fixture written and then read back in the same test
  // would otherwise race a 30 s refresh. Retire the tick here and rebuild EXPLICITLY (`rebuild()`
  // below) after each fixture write — the tests keep exercising the PRODUCTION path (rather than
  // switching the mechanism off, which would test a path production no longer takes).
  server.dashboardSnapshot.stop();
});

/** Write this file's fixture, then make the dashboard snapshot reflect it. */
async function rebuild() {
  clearVerificationRoundCache();
  await server.dashboardSnapshot.rebuildNow();
}

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

const roundsFile = () => path.join(workspaceRoot, ".quay", "verification-round.jsonl");
const stateFile = () => path.join(workspaceRoot, ".quay", "full-suite-state.json");

// Mixed history: mostly-green real rounds followed by a run of gate-blocked reds (pass=0/tests=0 by
// construction — the same shape as the real deployment's rounds 843-846).
const MIXED_ROUNDS = [
  { round: 1, state: "green", pass: 100, fail: 0, tests: 100, startedAt: "2026-09-01T08:00:00Z" },
  { round: 2, state: "green", pass: 101, fail: 0, tests: 101, startedAt: "2026-09-01T09:00:00Z" },
  { round: 3, state: "red", pass: 0, fail: 0, tests: 0, reason: "gate-failed", gate: "static-check", startedAt: "2026-09-01T10:00:00Z" },
  { round: 4, state: "red", pass: 0, fail: 0, tests: 0, reason: "gate-failed", gate: "static-check", startedAt: "2026-09-01T11:00:00Z" },
];

beforeEach(() => {
  // verification-round.jsonl 走 30s TTL 缓存（observation.ts readTests）——同文件内 AC1/AC2/AC3 已写
  // 入 MIXED_ROUNDS 并缓存；不清缓存，AC3b 的空账本断言会读到 AC3 的陈旧缓存而非诚实空态。
  clearVerificationRoundCache();
  fs.rmSync(roundsFile(), { force: true });
  fs.rmSync(stateFile(), { force: true });
});

test("AC1: a live-running suite (no taskId field, real writer shape) renders 运行中, not a stale round", async () => {
  fs.writeFileSync(roundsFile(), MIXED_ROUNDS.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const startedAt = new Date(Date.now() - 90_000).toISOString(); // 90s ago
  fs.writeFileSync(stateFile(), JSON.stringify({
    state: "running", runner: "inner", startedAt, laneCount: 16, scope: "worktree",
    runId: "mfi-some-task-1700000000000-abcdef", pid: 12345,
  }));
  await rebuild();
  const r = await request(port, "/dashboard?lang=zh");
  assert.equal(r.status, 200);
  assert.ok(r.body.includes("运行中"), "testsCard shows 运行中 while a suite is live");
  assert.ok(/已运行 1m3\ds|已运行 \d+s/.test(r.body), "testsCard shows an elapsed-time reading");
  assert.ok(r.body.includes("runner inner"), "testsCard names the runner");
});

test("AC2: no live suite + gate-blocked latest round names the gate, never a bare pass 0/0 headline", async () => {
  fs.writeFileSync(roundsFile(), MIXED_ROUNDS.map((r) => JSON.stringify(r)).join("\n") + "\n");
  // no full-suite-state.json — nothing currently running
  await rebuild();
  const r = await request(port, "/dashboard?lang=zh");
  assert.equal(r.status, 200);
  assert.ok(r.body.includes("gate 未过"), "gate-blocked latest round is labeled, not shown as bare pass 0/0");
  assert.ok(r.body.includes("static-check"), "the specific gate name is surfaced");
  assert.ok(!r.body.includes(">pass 0/0<"), "no literal pass-0/0 headline node (would misread as an empty suite)");
});

test("AC3: the recent-run list (round chips) distinguishes gate-blocked from real green/red", async () => {
  fs.writeFileSync(roundsFile(), MIXED_ROUNDS.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await rebuild();
  const r = await request(port, "/dashboard?lang=zh");
  assert.equal(r.status, 200);
  assert.ok(/#2/.test(r.body) && /#3/.test(r.body), "the recent-run list renders round chips for a green and a gate-blocked round (the single latest row is not the only signal)");
  assert.ok(r.body.includes("未执行测试"), "a gate-blocked round's tooltip says tests never ran (not 0/0 fail)");
  assert.ok(r.body.includes("pass 101/101"), "a real green round's tooltip carries its actual pass/tests count");
});

test("AC3b: an empty ledger (no verification-round.jsonl) still renders 200 with an honest empty state", async () => {
  await rebuild();
  const r = await request(port, "/dashboard?lang=zh");
  assert.equal(r.status, 200);
  assert.ok(r.body.includes("未接入") || r.body.includes("无验证轮记录"), "empty ledger → honest empty state, not a crash");
});
