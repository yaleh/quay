// @test-group engine
// start-drivers.test.mjs — tasks/gap-skill-start-drivers-webserver.
// Tests for plugin/scripts/start-drivers.ts — the idempotent wrapper that brings the promotion +
// worker + outer + goal drivers and the web server into a running state via the quay CLI (the drivers
// skill's ONE executable delegate).
//
// Coverage:
//   - pure helpers: parseDriverStatus (alive/dead/unreadable are three distinguishable values),
//     resolveWorkspaceRoot, resolveCliInvocation (explicit/source-tree/vendor-bundle/PATH
//     precedence — the vendor-bundle branch and its own coverage live in
//     start-drivers-cli-resolution.test.mjs), planActions (the idempotency decision, INCLUDING its
//     staleness dimension), probeUrl, probeServeStaleness + readServeHostPid (the two three-valued
//     readings the stale-reload path is built on).
//   - full flow (hermetic): a fake `quay` CLI scripts `driver status`/`driver start` and actually
//     listens for `serve`, proving run#1 starts everything and run#2 starts nothing (idempotent).
//   - stale reload (gap-serve-stale-signal-has-no-consumer): a REAL separate server process answers
//     /health with `stale:true`; the script must SIGTERM it (identified from `.quay/server.json`),
//     wait for the port, and start a fresh one — then SKIP on the next run because it is now fresh.
//     Mirror half: an unreadable /health is NOT-EVALUATED — its own literal, host untouched.
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
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  parseDriverStatus,
  resolveWorkspaceRoot,
  resolveCliInvocation,
  planActions,
  probeUrl,
  probeServeStaleness,
  readServeHostPid,
} from "../scripts/start-drivers.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "start-drivers.ts");
const SKILL = path.join(REPO_ROOT, "plugin", "skills", "drivers", "SKILL.md");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const rootArg = argv[argv.indexOf("--root") + 1];
  const health = process.env.FAKE_QUAY_HEALTH || '{"ok":true,"stale":false,"evaluated":true}';
  if (rootArg && process.env.FAKE_QUAY_WRITE_SERVER_JSON === "1") {
    try {
      fs.mkdirSync(rootArg + "/.quay", { recursive: true });
      fs.writeFileSync(rootArg + "/.quay/server.json", JSON.stringify({ schemaVersion: 1, pid: process.pid, startedAt: new Date().toISOString(), services: [] }));
    } catch (e) { /* best-effort, mirrors the real host */ }
  }
  http.createServer((req, res) => {
    if (req.url && req.url.indexOf("/health") === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(health);
    } else {
      res.end("ok");
    }
  }).listen(port, host);
} else {
  process.exit(2);
}
`;
  fs.writeFileSync(fake, src, "utf8");
  return fake;
}

/** A standalone HTTP server PROCESS (not an in-test server) — so the reload path's SIGTERM has a
 *  real target and "the old host is gone" is observable. Answers `healthBody` on /health, "ok"
 *  elsewhere. Resolves once it actually answers. */
async function startForeignServer(dir, healthBody) {
  const f = path.join(dir, "foreign-server.js");
  fs.writeFileSync(f, `const http = require("node:http");
const port = Number(process.argv[2]);
const host = process.argv[3];
const body = process.env.HEALTH_BODY || "";
http.createServer((req, res) => {
  if (req.url && req.url.indexOf("/health") === 0) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(body); }
  else { res.end("ok"); }
}).listen(port, host);
`, "utf8");
  const port = await freePort();
  const child = spawn(process.execPath, [f, String(port), "127.0.0.1"], {
    env: { ...process.env, HEALTH_BODY: healthBody },
    stdio: "ignore",
  });
  let exited = false;
  child.on("exit", () => { exited = true; });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await probeUrl("127.0.0.1", port, 300)) return { child, pid: child.pid, port, exited: () => exited };
    await sleep(50);
  }
  try { child.kill("SIGKILL"); } catch { /* gone */ }
  throw new Error(`foreign server never answered on ${port}`);
}

/** Is the process RUNNING — i.e. still serving? ⛔ `kill(pid, 0)` is true for a reaped-but-unwaited
 *  ZOMBIE too, so it answers "a pid entry exists", not "the host is alive"; the state field is the
 *  reading that actually distinguishes them. */
function pidRunning(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
  } catch {
    return false;
  }
}

/** Poll until the port answers, within a deadline — the SAME contract `startServe` itself offers.
 *  ⛔ A single immediate probe is the wrong reading: a freshly-spawned listener can be briefly
 *  unresponsive right after its parent exits (measured here: the first probe after the reload
 *  returned false, every probe from +200ms returned true), so a one-shot probe measures the test's
 *  timing rather than the script's behavior. */
async function waitForProbe(host, port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probeUrl(host, port, 1000)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(200);
  }
}

/** Publish the `.quay/server.json` carrier `quay serve` writes about itself — the reload path's ONLY
 *  pid source (⛔ not `.quay/serve.pid`, which goes stale). */
function writeServeCarrier(root, pid) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "server.json"),
    JSON.stringify({ schemaVersion: 1, pid, startedAt: new Date().toISOString(), services: [] }));
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
  // PATH fallback when no source tree AND no vendor bundle.
  // `pluginRoot: null` is the explicit "there is no plugin root to probe" seam — the vendor branch
  // (`<plugin-root>/vendor/quay/dist/quay.js`, gap-start-drivers-cli-resolve-blind-to-vendor-layout-
  // and-swallows-enoent) sits between the source tree and PATH, and would otherwise find THIS repo's
  // real bundle here and never reach PATH.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-cli2-"));
  const pathFallback = resolveCliInvocation(bare, undefined, { pluginRoot: null });
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

// AC3 (gap-serve-stale-signal-has-no-consumer) — BIDIRECTIONAL: the staleness dimension must move
// `startServe` in BOTH directions, otherwise the dimension is decoration.
test("AC3 — planActions: listening+STALE ⇒ start (reload); listening+FRESH ⇒ skip; NOT-EVALUATED ⇒ skip", () => {
  const base = { promotionAlive: true, workerAlive: true, outerAlive: true, goalAlive: true, serveListening: true };
  // (a) stale-but-reachable ⇒ MUST start. Before this task this was `false` — the defect.
  assert.equal(planActions({ ...base, serveStale: true }).startServe, true,
    "a listening-but-STALE server is not 'already running' — it must be reloaded");
  // (b) fresh-and-reachable ⇒ MUST skip (the negative control: (a) is not just "always true").
  assert.equal(planActions({ ...base, serveStale: false }).startServe, false,
    "a listening-and-FRESH server must NOT be restarted");
  // (c) listening but NOT-EVALUATED ⇒ skip (AC4: a reading we could not take is not a verdict in
  //     either direction) — and distinctly from (b): the caller reports the two differently.
  assert.equal(planActions({ ...base, serveStale: null }).startServe, false,
    "an unevaluated reading must not become a restart");
  assert.equal(planActions({ ...base }).startServe, false, "omitted staleness is not-evaluated, not stale");
  // (d) nothing listening ⇒ start regardless of staleness value.
  assert.equal(planActions({ ...base, serveListening: false, serveStale: false }).startServe, true);
  assert.equal(planActions({ ...base, serveListening: false, serveStale: null }).startServe, true);
});

// AC3/AC4 — the reading itself. Every "could not read" mode is a SEPARATE value from "fresh"
// (硬規則 3b), and none of them is "stale".
test("AC4 — probeServeStaleness: boolean stale is evaluated; every unreadable mode is NOT-EVALUATED with its own token", async () => {
  const port = await freePort();
  let body = JSON.stringify({ ok: true, stale: true, evaluated: true });
  let status = 200;
  const srv = http.createServer((req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  });
  await new Promise((resolve) => srv.listen(port, "127.0.0.1", resolve));

  // (a) evaluated, both directions
  assert.deepEqual(await probeServeStaleness("127.0.0.1", port, 1000), { evaluated: true, stale: true, reason: null });
  body = JSON.stringify({ ok: true, stale: false, evaluated: true });
  assert.deepEqual(await probeServeStaleness("127.0.0.1", port, 1000), { evaluated: true, stale: false, reason: null });

  // (b) the server's OWN not-evaluated value (stale:null) is NOT-EVALUATED here too — never "fresh"
  body = JSON.stringify({ ok: true, stale: null, evaluated: false, source: null });
  assert.deepEqual(await probeServeStaleness("127.0.0.1", port, 1000),
    { evaluated: false, stale: null, reason: "health-says-not-evaluated" });

  // (c) missing field / wrong type / unparseable body — three distinct tokens, none "fresh"
  body = JSON.stringify({ ok: true });
  assert.deepEqual(await probeServeStaleness("127.0.0.1", port, 1000),
    { evaluated: false, stale: null, reason: "no-stale-field" });
  body = JSON.stringify({ stale: "yes" });
  assert.deepEqual(await probeServeStaleness("127.0.0.1", port, 1000),
    { evaluated: false, stale: null, reason: "stale-not-boolean" });
  body = "not-json-at-all";
  assert.deepEqual(await probeServeStaleness("127.0.0.1", port, 1000),
    { evaluated: false, stale: null, reason: "unparseable-body" });

  // (d) a non-200 is not a health answer
  status = 404;
  body = JSON.stringify({ stale: false });
  assert.deepEqual(await probeServeStaleness("127.0.0.1", port, 1000),
    { evaluated: false, stale: null, reason: "http-404" });
  status = 200;

  await new Promise((resolve) => srv.close(resolve));

  // (e) nothing there at all
  assert.deepEqual(await probeServeStaleness("127.0.0.1", port, 500),
    { evaluated: false, stale: null, reason: "unreachable" });
});

test("readServeHostPid — present / absent / unreadable are three distinguishable values (硬規則 3b)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-carrier-"));
  try {
    assert.deepEqual(readServeHostPid(root), { state: "absent" }, "no carrier at all");
    writeServeCarrier(root, 4242);
    const present = readServeHostPid(root);
    assert.equal(present.state, "present");
    assert.equal(present.pid, 4242);
    assert.equal(typeof present.startedAt, "string", "the carrier's startedAt is carried through when present");
    // A carrier that exists but cannot be used is NOT "no server" — the reload path acts on the
    // difference (absent ⇒ nothing to kill; unreadable ⇒ refuse to guess).
    fs.writeFileSync(path.join(root, ".quay", "server.json"), "{ not json");
    assert.deepEqual(readServeHostPid(root), { state: "unreadable", reason: "unparseable" });
    fs.writeFileSync(path.join(root, ".quay", "server.json"), JSON.stringify({ schemaVersion: 1 }));
    assert.deepEqual(readServeHostPid(root), { state: "unreadable", reason: "no-usable-pid" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    assert.match(second.stdout, /code fresh/, "run#2 must have READ /health and seen a fresh code state");
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

// AC3 (gap-serve-stale-signal-has-no-consumer) — the END-TO-END half: a listening-but-STALE server
// must actually be REPLACED. Before this task the script saw "reachable" and skipped, leaving the
// pre-fix process serving forever (2026-08-23: 8.5h; 2026-09-14: 3h+, AC-179 oscillating 6/20) —
// every remedy was a human restart. This test pins the successor: the old host is gone AND a fresh
// one answers, with the second run proving the reload is not a loop (fresh ⇒ skip).
test("AC3 — listening-but-STALE serve is RELOADED (old host killed, fresh one started); then fresh ⇒ skip", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-stale-"));
  let foreign = null;
  try {
    const root = makeWorkspaceRoot(tmp);
    const fake = writeFakeQuay(tmp);
    const log = path.join(tmp, "log.jsonl");
    const stateFile = path.join(tmp, "state.json");
    // The pre-existing, STALE listener: a real separate process, answering /health with stale:true.
    foreign = await startForeignServer(tmp, JSON.stringify({ ok: true, stale: true, evaluated: true, source: "git" }));
    writeServeCarrier(root, foreign.pid);
    assert.ok(pidRunning(foreign.pid), "the foreign (stale) host is really running before the run");
    // Pre-alive drivers so the fake CLI prints nothing on stdout — the `--json` report is the only
    // stdout output, which is what the assertions below parse.
    fs.writeFileSync(stateFile, JSON.stringify({ promotion: true, worker: true, outer: true, goal: true }));
    const env = { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile, FAKE_QUAY_HEALTH: JSON.stringify({ ok: true, stale: false, evaluated: true, source: "git" }) };
    const args = ["--cli", fake, "--root", root, "--host", "127.0.0.1", "--port", String(foreign.port), "--serve-timeout", "10000", "--json"];

    const first = runScript(args, { env });
    assert.equal(first.status, 0, `stale reload run must exit 0:\n${first.stdout}\n${first.stderr}`);
    const report = JSON.parse(first.stdout);
    assert.equal(report.serve.state, "reloaded-stale", "the listening-but-stale server must be RELOADED, not skipped");
    assert.equal(report.serve.staleness, "stale");
    assert.equal(report.serve.previousPid, foreign.pid, "the stale host is identified from .quay/server.json");
    assert.match(first.stderr, /STALE \(code on disk newer than pid=/, "the reload is announced, not silent");
    // The old host is GONE (not merely reported gone) and a fresh one answers the probe.
    assert.equal(pidRunning(foreign.pid), false, "the stale host process must actually be gone (⛔ a zombie is gone too)");
    assert.equal(await waitForProbe("127.0.0.1", foreign.port), true, "a fresh server must be answering the port it freed");
    assert.deepEqual(readLogLines(log), [["serve"]], "exactly ONE serve spawn — the reload — and no driver churn (they were pre-alive)");

    // Second run: the replacement answers stale:false ⇒ NO reload, no second spawn (negative control).
    const second = runScript(args, { env });
    assert.equal(second.status, 0, `second run must exit 0:\n${second.stdout}\n${second.stderr}`);
    const report2 = JSON.parse(second.stdout);
    assert.equal(report2.serve.state, "already-listening");
    assert.equal(report2.serve.staleness, "fresh");
    assert.deepEqual(readLogLines(log), [["serve"]],
      "a FRESH listening server must not be restarted — reload is not a loop (still exactly one serve spawn)");

    const pidFile = path.join(root, ".quay", "serve.pid");
    if (fs.existsSync(pidFile)) {
      try { process.kill(Number(fs.readFileSync(pidFile, "utf8").trim()), "SIGKILL"); } catch { /* gone */ }
    }
  } finally {
    if (foreign && !foreign.exited()) { try { foreign.child.kill("SIGKILL"); } catch { /* gone */ } }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// AC4 (硬規則 3b) — the mirror half, END-TO-END: when /health cannot be read, the script must NOT
// launder the non-reading into an action. No restart (a reading we could not take is not "stale"),
// no "fresh" either — its own literal, said loudly.
test("AC4 — /health unreadable ⇒ NOT-EVALUATED literal, the host is left alone, and it is said loudly", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-noteval-"));
  let foreign = null;
  try {
    const root = makeWorkspaceRoot(tmp);
    const fake = writeFakeQuay(tmp);
    const log = path.join(tmp, "log.jsonl");
    const stateFile = path.join(tmp, "state.json");
    // Listening, answers GET / with 200 — but its /health carries no boolean `stale` at all.
    foreign = await startForeignServer(tmp, JSON.stringify({ ok: true }));
    writeServeCarrier(root, foreign.pid);
    fs.writeFileSync(stateFile, JSON.stringify({ promotion: true, worker: true, outer: true, goal: true }));
    const env = { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile, FAKE_QUAY_HEALTH: JSON.stringify({ ok: true }) };
    const args = ["--cli", fake, "--root", root, "--host", "127.0.0.1", "--port", String(foreign.port), "--serve-timeout", "3000", "--json"];

    const r = runScript(args, { env });
    assert.equal(r.status, 0, `an unreadable /health is not a start failure:\n${r.stdout}\n${r.stderr}`);
    const report = JSON.parse(r.stdout);
    assert.equal(report.serve.state, "already-listening");
    assert.equal(report.serve.staleness, "not-evaluated", "NOT-EVALUATED is its own value — ⛔ not 'fresh'");
    assert.equal(report.serve.stalenessReason, "no-stale-field");
    assert.ok(!("stale" in report.serve), "⛔ the not-evaluated case must not carry a stale verdict at all");
    assert.match(r.stderr, /staleness NOT-EVALUATED \(reason: no-stale-field\)/, "the non-reading is SAID, not silent");
    assert.match(r.stderr, /NOT restarting/, "⛔ a reading we could not take must not become a restart");
    // Concretely: the host is untouched and no replacement was spawned.
    assert.equal(pidRunning(foreign.pid), true, "the unreadable-health host must NOT be killed");
    assert.equal(readLogLines(log).filter((l) => l[0] === "serve").length, 0, "⛔ no serve spawn on a reading we could not take");
  } finally {
    if (foreign && !foreign.exited()) { try { foreign.child.kill("SIGKILL"); } catch { /* gone */ } }
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
