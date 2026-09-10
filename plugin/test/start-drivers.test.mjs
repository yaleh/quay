// @test-group engine
// start-drivers.test.mjs — tasks/gap-skill-start-drivers-webserver.
// Tests for plugin/scripts/start-drivers.ts — the idempotent wrapper that brings the promotion +
// worker + outer + goal drivers and the web server into a running state via the quay CLI (the drivers
// skill's ONE executable delegate).
//
// Coverage:
//   - pure helpers: parseDriverStatus (alive/dead/unreadable are three distinguishable values),
//     resolveWorkspaceRoot, resolveCliInvocation (explicit/source-tree/PATH precedence),
//     planActions (the idempotency decision), probeUrl.
//   - full flow (hermetic): a fake `quay` CLI scripts `driver status`/`driver start` and actually
//     listens for `serve`, proving run#1 starts everything and run#2 starts nothing (idempotent).
//   - failure relay: a fake CLI whose `driver start` exits 1 with a "halted" message — the script
//     must relay that verbatim (not swallow / not misreport), and fail non-zero.
//   - structural: plugin/skills/drivers/SKILL.md references plugin/scripts/start-drivers.ts (the
//     laydown rule-(a) derivation anchor).
//
// Run: scripts/test.sh plugin/test/start-drivers.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  parseDriverStatus,
  resolveWorkspaceRoot,
  resolveCliInvocation,
  planActions,
  probeUrl,
} from "../scripts/start-drivers.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "start-drivers.ts");
const SKILL = path.join(REPO_ROOT, "plugin", "skills", "drivers", "SKILL.md");

function runScript(args, opts = {}) {
  return spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
    timeout: opts.timeout || 30000,
  });
}

/** Bind an ephemeral port and release it — a mostly-safe free-port source for the serve probe. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/** A fake `quay` CLI (CommonJS) — scripts driver status/start, actually listens for `serve`. */
function writeFakeQuay(dir) {
  const fake = path.join(dir, "fake-quay.js");
  const src = `const fs = require("node:fs");
const http = require("node:http");
const argv = process.argv.slice(2);
const log = process.env.FAKE_QUAY_LOG;
const stateFile = process.env.FAKE_QUAY_STATE;
const startExit = Number(process.env.FAKE_QUAY_START_EXIT || 0);
const startStderr = process.env.FAKE_QUAY_START_STDERR || "";
const startAlive = Number(process.env.FAKE_QUAY_START_ALIVE || 1);
const statusGarbage = Number(process.env.FAKE_QUAY_STATUS_GARBAGE || 0);
function rec(a) { if (log) fs.appendFileSync(log, JSON.stringify(a) + "\\n"); }
function state() { return (stateFile && fs.existsSync(stateFile)) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {}; }
const cmd = argv[0];
if (cmd === "driver") {
  const verb = argv[1];
  const kind = argv[argv.indexOf("--kind") + 1];
  if (verb === "status") {
    if (statusGarbage) { console.log("not-json-at-all"); process.exit(0); }
    const s = state();
    console.log(JSON.stringify({ kind: kind, alive: s[kind] ? 1 : 0 }));
    process.exit(0);
  }
  if (verb === "start") {
    rec(["start", kind]);
    if (startExit !== 0) { process.stderr.write(startStderr); process.exit(startExit); }
    const s = state();
    s[kind] = startAlive === 1;
    if (stateFile) fs.writeFileSync(stateFile, JSON.stringify(s));
    console.log("started: kind=" + kind);
    process.exit(0);
  }
  process.exit(2);
} else if (cmd === "serve") {
  rec(["serve"]);
  const port = Number(argv[argv.indexOf("--port") + 1]);
  const host = argv[argv.indexOf("--host") + 1];
  http.createServer((req, res) => { res.end("ok"); }).listen(port, host);
} else {
  process.exit(2);
}
`;
  fs.writeFileSync(fake, src, "utf8");
  return fake;
}

function makeWorkspaceRoot(parent) {
  const root = path.join(parent, "ws");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "providers: {}\n", "utf8");
  return root;
}

function readLogLines(log) {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ── pure helpers ─────────────────────────────────────────────────────────────────────────────

test("parseDriverStatus — alive / dead / unreadable are three distinguishable values (硬规则 3b)", () => {
  assert.deepEqual(parseDriverStatus(JSON.stringify({ kind: "promotion", alive: 1 })), { alive: true, parsed: true });
  assert.deepEqual(parseDriverStatus(JSON.stringify({ kind: "worker", alive: 0 })), { alive: false, parsed: true });
  assert.deepEqual(parseDriverStatus("not json"), { alive: false, parsed: false });
  assert.deepEqual(parseDriverStatus(""), { alive: false, parsed: false });
});

test("resolveWorkspaceRoot — walks up to the .quay/config.yml, else null", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-root-"));
  fs.mkdirSync(path.join(root, "sub", "deep"), { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "providers: {}\n");
  assert.equal(resolveWorkspaceRoot(path.join(root, "sub", "deep")), root);
  assert.equal(resolveWorkspaceRoot(root), root);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-bare-"));
  assert.equal(resolveWorkspaceRoot(bare), null);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
});

test("resolveCliInvocation — explicit .ts / explicit .js / source-tree / PATH precedence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-cli-"));
  const ts = resolveCliInvocation(root, "/tmp/quay.ts");
  assert.equal(ts.argv0, process.execPath);
  assert.deepEqual(ts.args, ["--experimental-strip-types", path.resolve("/tmp/quay.ts")]);
  const js = resolveCliInvocation(root, "/tmp/quay.js");
  assert.deepEqual(js.args, [path.resolve("/tmp/quay.js")]);
  // source-tree fallback when packages/quay/bin/quay.ts exists
  fs.mkdirSync(path.join(root, "packages", "quay", "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, "packages", "quay", "bin", "quay.ts"), "");
  const src = resolveCliInvocation(root);
  assert.deepEqual(src.args, ["--experimental-strip-types", path.join(root, "packages", "quay", "bin", "quay.ts")]);
  // PATH fallback when no source tree
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-cli2-"));
  const pathFallback = resolveCliInvocation(bare);
  assert.equal(pathFallback.argv0, "quay");
  assert.deepEqual(pathFallback.args, []);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
});

test("planActions — the idempotency decision is pure", () => {
  assert.deepEqual(
    planActions({ promotionAlive: true, workerAlive: true, outerAlive: true, goalAlive: true, serveListening: true }),
    { startPromotion: false, startWorker: false, startOuter: false, startGoal: false, startServe: false },
  );
  assert.deepEqual(
    planActions({ promotionAlive: false, workerAlive: false, outerAlive: false, goalAlive: false, serveListening: false }),
    { startPromotion: true, startWorker: true, startOuter: true, startGoal: true, startServe: true },
  );
  assert.deepEqual(
    planActions({ promotionAlive: true, workerAlive: false, outerAlive: true, goalAlive: true, serveListening: true }),
    { startPromotion: false, startWorker: true, startOuter: false, startGoal: false, startServe: false },
  );
});

test("probeUrl — false with nothing listening, true once a server answers", async () => {
  const port = await freePort();
  assert.equal(await probeUrl("127.0.0.1", port, 500), false);
  const srv = http.createServer((req, res) => res.end("ok"));
  await new Promise((resolve) => srv.listen(port, "127.0.0.1", resolve));
  assert.equal(await probeUrl("127.0.0.1", port, 500), true);
  await new Promise((resolve) => srv.close(resolve));
});

// ── full flow (hermetic, fake quay CLI) ──────────────────────────────────────────────────────

test("full flow — run#1 starts drivers + serve, run#2 starts nothing (idempotent)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-flow-"));
  try {
    const root = makeWorkspaceRoot(tmp);
    const fake = writeFakeQuay(tmp);
    const log = path.join(tmp, "log.jsonl");
    const stateFile = path.join(tmp, "state.json");
    const port = await freePort();
    const env = { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile };
    const args = ["--cli", fake, "--root", root, "--host", "127.0.0.1", "--port", String(port), "--serve-timeout", "10000"];

    const first = runScript(args, { env });
    assert.equal(first.status, 0, `first run must exit 0:\n${first.stdout}\n${first.stderr}`);
    assert.match(first.stdout, /promotion: started/);
    assert.match(first.stdout, /worker: started/);
    assert.match(first.stdout, /outer: started/);
    assert.match(first.stdout, /goal: started/);
    assert.match(first.stdout, /serve: started/);
    assert.deepEqual(readLogLines(log), [["start", "promotion"], ["start", "worker"], ["start", "outer"], ["start", "goal"], ["serve"]]);

    const second = runScript(args, { env });
    assert.equal(second.status, 0, `second run must exit 0:\n${second.stdout}\n${second.stderr}`);
    assert.match(second.stdout, /promotion: already running/);
    assert.match(second.stdout, /worker: already running/);
    assert.match(second.stdout, /outer: already running/);
    assert.match(second.stdout, /goal: already running/);
    assert.match(second.stdout, /serve: already listening/);
    assert.deepEqual(readLogLines(log), [["start", "promotion"], ["start", "worker"], ["start", "outer"], ["start", "goal"], ["serve"]],
      "second run must not re-start anything");

    // Reap the detached fake serve (pid written to .quay/serve.pid).
    const pidFile = path.join(root, ".quay", "serve.pid");
    if (fs.existsSync(pidFile)) {
      try { process.kill(Number(fs.readFileSync(pidFile, "utf8").trim()), "SIGKILL"); } catch { /* gone */ }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("halted start failure is relayed verbatim, not swallowed (exit non-zero)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-halt-"));
  try {
    const root = makeWorkspaceRoot(tmp);
    const fake = writeFakeQuay(tmp);
    const log = path.join(tmp, "log.jsonl");
    const stateFile = path.join(tmp, "state.json");
    const port = await freePort();
    const haltMsg = "quay driver: promotion is halted (halted_by=test) — refusing to start; clear the halt first with: quay driver resume --kind promotion\n";
    const r = runScript(
      ["--cli", fake, "--root", root, "--host", "127.0.0.1", "--port", String(port), "--serve-timeout", "2000"],
      { env: { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile, FAKE_QUAY_START_EXIT: "1", FAKE_QUAY_START_STDERR: haltMsg } },
    );
    assert.notEqual(r.status, 0, "a halted driver start must fail the script");
    assert.match(r.stderr, /halted/, "the CLI's halted reason is relayed verbatim");
    assert.match(r.stderr, /quay driver resume --kind promotion/, "the fix command is relayed");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── structural ────────────────────────────────────────────────────────────────────────────────

test("AC-203 — start exit 0 but status says NOT alive ⇒ the script exits non-zero (⛔ exit 0 is not 'started')", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-notalive-"));
  try {
    const root = makeWorkspaceRoot(tmp);
    const fake = writeFakeQuay(tmp);
    const log = path.join(tmp, "log.jsonl");
    const stateFile = path.join(tmp, "state.json");
    const port = await freePort();
    // start 退出码 0（打印 started），但 status 报 alive:0（driver 没真活）——正是 AC-203 的死因形态。
    const r = runScript(
      ["--cli", fake, "--root", root, "--host", "127.0.0.1", "--port", String(port), "--serve-timeout", "2000"],
      { env: { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile, FAKE_QUAY_START_ALIVE: "0" } },
    );
    assert.notEqual(r.status, 0, "start exit 0 + not alive must fail the script");
    assert.match(r.stderr, /not alive per `quay driver status`/, "the not-alive reason is reported");
    assert.ok(!/promotion: started/.test(r.stdout), "must NOT report started when the driver is not alive");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC-203 — start exit 0 but status unreadable ⇒ the script exits non-zero (read-unable is not 'alive')", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-unreadable-"));
  try {
    const root = makeWorkspaceRoot(tmp);
    const fake = writeFakeQuay(tmp);
    const log = path.join(tmp, "log.jsonl");
    const stateFile = path.join(tmp, "state.json");
    const port = await freePort();
    const r = runScript(
      ["--cli", fake, "--root", root, "--host", "127.0.0.1", "--port", String(port), "--serve-timeout", "2000"],
      { env: { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile, FAKE_QUAY_STATUS_GARBAGE: "1" } },
    );
    assert.notEqual(r.status, 0, "unreadable status after start must fail the script");
    assert.match(r.stderr, /could not parse `quay driver status/, "the read-unable reason is reported");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("the drivers skill references plugin/scripts/start-drivers.ts (the ONE delegate)", () => {
  const skill = fs.readFileSync(SKILL, "utf8");
  assert.match(skill, /plugin\/scripts\/start-drivers\.ts/,
    "SKILL.md must reference the delegate script by path (laydown rule-(a) derivation + skill correctness)");
  assert.match(skill, /^name: quay-drivers$/m, "the skill is named quay-drivers");
});
