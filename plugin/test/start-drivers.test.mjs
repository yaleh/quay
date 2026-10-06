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
//     start-drivers-cli-resolution.test.mjs), planServeAction (the serve decision),
//     probeServeStaleness + readServeHostPid (the three-valued readings the reload path is built on),
//     readAdmissionRefusal (the marker reader that tells 「refused」 from 「exited」).
//   - full flow (hermetic): a fake `quay` CLI scripts `driver status`/`driver start` and, for
//     `serve`, behaves as a MINIATURE FAITHFUL HOST — it takes the same same-root admission lock
//     (O_EXCL + stale reclaim), publishes a carrier naming itself and its bound port, and answers
//     `/health`. run#1 starts everything; run#2 SPAWNS AGAIN and is refused by the lock, which is
//     the point (gap-serve-same-root-admission-lock): there is no pre-flight liveness probe left to
//     short-circuit with, so the "already running" verdict comes from the host process itself.
//   - stale reload (gap-serve-stale-signal-has-no-consumer): the live host answers /health with
//     `stale:true` ⇒ the script must SIGTERM it (identified from `.quay/server.json`), WAIT FOR ITS
//     PID TO DIE, and start a fresh host — which reclaims the dead host's lock. Mirror half: an
//     unreadable /health is NOT-EVALUATED — its own literal, host untouched. Third half: a refusal
//     with no readable carrier is NOT-EVALUATED with its own reason, and is not a failure.
//   - failure relay: a fake CLI whose `driver start` exits 1 with a "halted" message — the script
//     must relay that verbatim (not swallow / not misreport), and fail non-zero.
//   - stopServeHost: waits for the PID (not a port), and a SIGTERM-ignoring host is reported
//     `still-alive` — never `stopped`.
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
  planServeAction,
  probeServeStaleness,
  readServeHostPid,
  readAdmissionRefusal,
  stopServeHost,
  SERVE_ADMISSION_REFUSED_MARKER,
} from "../scripts/start-drivers.ts";
// The shared envelope's availability predicate (the SAME one `startServe` consults) — used here only
// to decide whether the scope membership of the spawned host can be MEASURED on this host.
import { systemdScopeAvailable } from "../../packages/quay/src/systemd-scope.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "start-drivers.ts");
const SKILL = path.join(REPO_ROOT, "plugin", "skills", "drivers", "SKILL.md");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runScript(args, opts = {}) {
  return spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
    timeout: opts.timeout || 60000,
  });
}

/** Bind an ephemeral port and release it — a mostly-safe free-port source for the explicit-port case. */
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

/** Does a TCP port answer an HTTP request? (The tests' OWN reading of 「the host is up」 — ⛔ not a
 *  helper the script under test has: since gap-serve-same-root-admission-lock the script never
 *  probes a port itself.) */
function portAnswers(port, host = "127.0.0.1", timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.request({ host, port, path: "/health", method: "GET", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function waitForPort(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await portAnswers(port)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(200);
  }
}

/** The fake `quay` CLI (CommonJS) — scripts driver status/start, and for `serve` acts as a
 *  MINIATURE FAITHFUL HOST: same-root admission lock (O_EXCL create + stale reclaim by pid liveness),
 *  a carrier naming itself and the port it actually bound, `/health` from env. Recording:
 *  ["serve","listening"] for a host that bound, ["serve","refused"] for one the lock turned away. */
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
const serveRoot = process.env.FAKE_QUAY_ROOT || "";
function rec(a) { if (log) fs.appendFileSync(log, JSON.stringify(a) + "\\n"); }
function state() { return (stateFile && fs.existsSync(stateFile)) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {}; }
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}
// Mirrors packages/quay/src/serve.ts:acquireServeAdmissionLock (minus the cmdline pid-reuse check,
// which a node -e fake cannot satisfy). Returns true when the lock was taken.
function tryLock(root) {
  const lock = root + "/.quay/server.lock";
  fs.mkdirSync(root + "/.quay", { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(lock, String(process.pid) + "\\n", { flag: "wx" });
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") return true;
      let holder = NaN;
      try { holder = parseInt(fs.readFileSync(lock, "utf8").trim(), 10); } catch (e2) { /* unreadable */ }
      if (Number.isInteger(holder) && holder > 0 && pidAlive(holder)) {
        process.stdout.write("quay serve: already running (pid=" + holder + ") [" +
          "${SERVE_ADMISSION_REFUSED_MARKER} self=" + process.pid + " holder=" + holder + "]\\n");
        return false;
      }
      try { fs.unlinkSync(lock); } catch (e2) { /* gone */ }
    }
  }
  return false;
}
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
  // gap-serve-binding-defaults-three-copies-to-one-definition-point: both flags are now OPTIONAL.
  // The real host resolves an absent one through the ONE definition point; this fake only needs the
  // same POSTURE (bind a kernel port when unnamed) so the forwarding contract stays exercised.
  const portIdx = argv.indexOf("--port");
  const hostIdx = argv.indexOf("--host");
  const wantPort = portIdx === -1 ? 0 : Number(argv[portIdx + 1]);
  const host = hostIdx === -1 ? "127.0.0.1" : argv[hostIdx + 1];
  const healthFile = process.env.FAKE_QUAY_HEALTH_FILE || "";
  // The body is read PER REQUEST when a file is named, so a test can change what the LIVE host says
  // about its own freshness between runs (that is exactly the reload scenario).
  function healthBody() {
    if (healthFile) { try { return fs.readFileSync(healthFile, "utf8"); } catch (e) { return ""; } }
    return process.env.FAKE_QUAY_HEALTH || '{"ok":true,"stale":false,"evaluated":true}';
  }
  if (serveRoot && !tryLock(serveRoot)) { rec(["serve", "refused"]); process.exit(0); }
  const srv = http.createServer((req, res) => {
    if (req.url && req.url.indexOf("/health") === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(healthBody());
    } else { res.end("ok"); }
  });
  srv.listen(wantPort, host, () => {
    const bound = srv.address().port;
    // Record BEFORE publishing the carrier: the caller (start-drivers) returns as soon as the
    // carrier names this pid, so a test reading the log right after that return must not race us.
    rec(["serve", "listening"]);
    if (serveRoot) {
      try {
        fs.writeFileSync(serveRoot + "/.quay/server.json", JSON.stringify({
          schemaVersion: 1, pid: process.pid, startedAt: new Date().toISOString(),
          services: [{ name: "web", pid: process.pid, host: host, port: bound, up: true }],
        }));
      } catch (e) { /* best-effort, mirrors the real host */ }
    }
    // The real host announces its bound port on stdout; the fake keeps that shape so a human reading
    // .quay/serve.log sees the same thing.
    console.log("quay serve: listening on http://" + host + ":" + bound);
  });
} else {
  process.exit(2);
}
`;
  fs.writeFileSync(fake, src, "utf8");
  return fake;
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

/** Publish the `.quay/server.json` carrier `quay serve` writes about itself — the reload path's ONLY
 *  pid+port source (⛔ not `.quay/serve.pid`, which goes stale). */
function writeServeCarrier(root, pid, port = 1234) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "server.json"),
    JSON.stringify({
      schemaVersion: 1, pid, startedAt: new Date().toISOString(),
      services: [{ name: "web", pid, host: "127.0.0.1", port, up: true }],
    }));
}

function makeWorkspaceRoot(parent) {
  const root = path.join(parent, "ws");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "providers: {}\n", "utf8");
  return root;
}

/** The `--json` report from a run's stdout. ⛔ Not `JSON.parse(stdout)`: the relayed driver-start
 *  output ("started: kind=…") shares that stream, so the report is the LAST line. */
function jsonReport(stdout) {
  const lines = String(stdout).trim().split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

function readLogLines(log) {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Kill the host the fake wrote into the carrier (and its lock file), so a test never leaks one. */
function reapFakeHost(root) {
  try {
    const carrier = JSON.parse(fs.readFileSync(path.join(root, ".quay", "server.json"), "utf8"));
    if (carrier && Number.isInteger(carrier.pid)) { try { process.kill(carrier.pid, "SIGKILL"); } catch { /* gone */ } }
  } catch { /* no carrier */ }
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

// gap-serve-same-root-admission-lock — the serve decision is now driven by the HOST's own admission
// verdict plus the staleness reading of the host it names. BIDIRECTIONAL: the staleness dimension
// must move the action in BOTH directions, otherwise the dimension is decoration.
test("planServeAction — a verdict of `started` needs no decision; otherwise staleness decides, and NOT-EVALUATED never becomes a restart", () => {
  assert.equal(planServeAction({ admission: "started" }), "started",
    "a host that bound is started — the staleness input is not consulted (there is no other host)");
  assert.equal(planServeAction({ admission: "started", staleness: true }), "started",
    "⛔ even a stale-looking input cannot turn a just-bound host into a reload");
  // (a) live host + STALE ⇒ MUST reload. Before gap-serve-stale-signal-has-no-consumer this was
  //     "already listening" — the defect that left a pre-fix server up for 8.5h / 3h.
  assert.equal(planServeAction({ admission: "already-running", staleness: true }), "reload");
  // (b) live host + FRESH ⇒ skip (the negative control: (a) is not just "always reload").
  assert.equal(planServeAction({ admission: "already-running", staleness: false }), "already-listening");
  // (c) live host + NOT-EVALUATED (null/undefined) ⇒ skip — 硬規則 3b: a reading we could not take is
  //     not a verdict in either direction; the caller reports it as its own literal.
  assert.equal(planServeAction({ admission: "already-running", staleness: null }), "already-listening");
  assert.equal(planServeAction({ admission: "already-running" }), "already-listening");
});

test("readAdmissionRefusal — the marker is bound to OUR child, and only bytes appended after OUR spawn count", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-marker-"));
  try {
    const log = path.join(dir, "serve.log");
    // A marker from a PREVIOUS run must not answer for this one.
    fs.writeFileSync(log, `quay serve: already running (pid=11) [${SERVE_ADMISSION_REFUSED_MARKER} self=999 holder=11]\n`);
    const offset = fs.statSync(log).size;
    assert.equal(readAdmissionRefusal(log, offset, 4242), null,
      "⛔ a marker already in the log before our spawn answers for a LATER spawn only if offset is ignored");
    // Our own child's marker, after the offset.
    fs.appendFileSync(log, `quay serve: already running (pid=11) [${SERVE_ADMISSION_REFUSED_MARKER} self=4242 holder=11]\n`);
    assert.deepEqual(readAdmissionRefusal(log, offset, 4242), { holderPid: 11 });
    // A CONCURRENT process's refusal (same window, different self) is not ours — the `self=` binding.
    assert.equal(readAdmissionRefusal(log, offset, 7777), null,
      "⛔ another spawn's refusal in the same byte window must not be read as ours");
    // A marker that names no readable holder still counts as a refusal (the verdict is the marker).
    fs.appendFileSync(log, `[$marker self=8888 holder=?]\n`.replace("$marker", SERVE_ADMISSION_REFUSED_MARKER));
    assert.deepEqual(readAdmissionRefusal(log, offset, 8888), { holderPid: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC4 (硬規則 3b) — the reading itself. Every "could not read" mode is a SEPARATE value from "fresh",
// and none of them is "stale".
test("probeServeStaleness: boolean stale is evaluated; every unreadable mode is NOT-EVALUATED with its own token", async () => {
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

test("readServeHostPid — present / absent / unreadable are three distinguishable values, and the present one carries the WEB PORT", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-carrier-"));
  try {
    assert.deepEqual(readServeHostPid(root), { state: "absent" }, "no carrier at all");
    writeServeCarrier(root, 4242, 45678);
    const present = readServeHostPid(root);
    assert.equal(present.state, "present");
    assert.equal(present.pid, 4242);
    assert.equal(typeof present.startedAt, "string", "the carrier's startedAt is carried through when present");
    assert.equal(present.port, 45678,
      "the web port is read back from the carrier — with an ephemeral default it is the only knowable address of the host");
    // A carrier with no usable web entry is still present (the host is live) but reports NO port — its
    // own value, never port 0 / never a guess.
    writeServeCarrier(root, 5, 0);
    assert.equal(readServeHostPid(root).port, null, "no usable web port ⇒ null (NOT-EVALUATED input), never 0");
    fs.writeFileSync(path.join(root, ".quay", "server.json"),
      JSON.stringify({ schemaVersion: 1, pid: 9, startedAt: new Date().toISOString(), services: [] }));
    assert.equal(readServeHostPid(root).port, null, "a carrier with no web service at all ⇒ null");
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

// ── stopServeHost: the wait is on the PID, not on a port (AC6) ───────────────────────────────
test("AC6 — stopServeHost waits for the PID: a cooperative host ⇒ `stopped` and the pid is really gone", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { stdio: "ignore" });
  await sleep(300);
  assert.equal(pidRunning(child.pid), true, "setup: the host is running before the stop");
  const res = await stopServeHost(child.pid, 8000);
  assert.equal(res.state, "stopped");
  assert.equal(pidRunning(child.pid), false, "⛔ `stopped` must mean the pid is GONE, not merely signalled");
});

test("AC6 — a SIGTERM-ignoring host is reported `still-alive`, never `stopped` (硬規則 3b)", async () => {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setTimeout(()=>{},60000)"], { stdio: "ignore" });
  await sleep(300);
  const res = await stopServeHost(child.pid, 1200);
  assert.equal(res.state, "still-alive",
    "⛔ a host that did not die must not share an output with one that did — the caller would spawn a second host on top of it");
  assert.equal(pidRunning(child.pid), true, "the SIGTERM-ignoring host is in fact still alive (the verdict is a reading)");
  // Control: the same call on a pid that dies ⇒ `stopped` (so `still-alive` is not just "always").
  try { child.kill("SIGKILL"); } catch { /* gone */ }
  await sleep(400);
  assert.equal((await stopServeHost(child.pid, 3000)).state, "stopped",
    "AC6 control: an already-dead pid is `stopped` (idempotent), so the two literals are distinguishable");
});

// ── full flow (hermetic, fake quay CLI) ──────────────────────────────────────────────────────

test("full flow — run#1 starts drivers + serve; run#2 SPAWNS AGAIN and is refused by the host's own lock (no pre-flight probe)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-flow-"));
  try {
    const root = makeWorkspaceRoot(tmp);
    const fake = writeFakeQuay(tmp);
    const log = path.join(tmp, "log.jsonl");
    const stateFile = path.join(tmp, "state.json");
    const env = { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile, FAKE_QUAY_ROOT: root };
    const args = ["--cli", fake, "--root", root, "--host", "127.0.0.1", "--serve-timeout", "15000", "--json"];

    const first = runScript(args, { env });
    assert.equal(first.status, 0, `first run must exit 0:\n${first.stdout}\n${first.stderr}`);
    const report = jsonReport(first.stdout);
    assert.equal(report.serve.state, "started", "run#1 binds the host");
    assert.ok(Number.isInteger(report.serve.port) && report.serve.port > 0,
      `run#1 reports the port the host ACTUALLY bound (got ${JSON.stringify(report.serve.port)})`);
    assert.equal(await waitForPort(report.serve.port), true, "the reported port really answers");
    assert.deepEqual(readLogLines(log), [["start", "promotion"], ["start", "worker"], ["start", "outer"], ["start", "goal"], ["serve", "listening"]]);

    const second = runScript(args, { env });
    assert.equal(second.status, 0, `second run must exit 0 (already-running is not a failure):\n${second.stdout}\n${second.stderr}`);
    const report2 = jsonReport(second.stdout);
    assert.equal(report2.serve.state, "already-listening");
    assert.equal(report2.serve.staleness, "fresh", "run#2 read /health from the LIVE host's carrier port and saw fresh code");
    assert.equal(report2.serve.port, report.serve.port, "the live host's port is reported from its carrier, not re-derived");
    // ⛔ THE POINT of this task's mechanism: run#2 DOES spawn the CLI (there is no pre-flight liveness
    // probe left to short-circuit with) — and the host's OWN lock is what turns it away.
    assert.deepEqual(readLogLines(log).slice(5), [["serve", "refused"]],
      "run#2 ATTEMPTED a serve start and was refused by the lock — idempotency comes from the host, not from a probe");
    assert.equal(readLogLines(log).filter((l) => l[0] === "serve" && l[1] === "listening").length, 1,
      "⛔ exactly ONE host ever bound — the refusal is what keeps a second host off this root");
  } finally {
    reapFakeHost(path.join(tmp, "ws"));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts ──────────────────
// The SECOND spawn site of the same host. `spawnHost` (Core `cli/server.ts`) is covered by
// `packages/quay/test/server-host-own-scope.test.mjs`; this is the `startServe` half — the SAME
// assertion (⛔ not a paraphrase): the spawned host's `/proc/<pid>/cgroup` is a transient
// `quay-serve-*.scope`, NOT the caller's cgroup, and the pid records on disk (`.quay/serve.pid` —
// which ONLY this spawn site writes — and the carrier) name that live process, whose cmdline is
// `serve`.
function cgroupPathOf(pid) {
  const m = /(?:^|\n)0::(\/\S*)/.exec(fs.readFileSync(`/proc/${pid}/cgroup`, "utf8"));
  return m ? m[1] : null;
}

/** Kill the host by PID (⛔ never `pkill -f`, which matches unrelated `quay.ts serve` peers) and wait
 *  for both its pid and its `--collect`ed transient scope to reach a terminal state. */
async function reapHostAndScope(pid, unit) {
  if (pid) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  const pidDeadline = Date.now() + 10000;
  while (pid && pidRunning(pid) && Date.now() < pidDeadline) await sleep(150);
  if (!unit) return;
  const scopeDeadline = Date.now() + 10000;
  while (Date.now() < scopeDeadline) {
    const show = spawnSync("systemctl", ["--user", "show", unit, "-p", "LoadState"], { encoding: "utf8" });
    if (/LoadState=(not-found|masked|dead|inactive)/.test(show.stdout ?? "")) break;
    await sleep(200);
  }
}

test("startServe — the host runs in its OWN `quay-serve-*.scope`, and its pid records name it", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-scope-"));
  // The workspace basename starts with `test-` so the unit is `quay-serve-test-…` and a residue check
  // can find it by name (AC7).
  const root = path.join(tmp, "test-ws");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "providers: {}\n", "utf8");
  const fake = writeFakeQuay(tmp);
  const env = { FAKE_QUAY_LOG: path.join(tmp, "log.jsonl"), FAKE_QUAY_STATE: path.join(tmp, "state.json"), FAKE_QUAY_ROOT: root };
  let hostPid = null;
  let unitName = null;
  try {
    const r = runScript(["--cli", fake, "--root", root, "--host", "127.0.0.1", "--serve-timeout", "15000", "--json"], { env });
    assert.equal(r.status, 0, `the run must exit 0:\n${r.stdout}\n${r.stderr}`);
    const report = jsonReport(r.stdout);
    assert.equal(report.serve.state, "started", "the host started");
    hostPid = report.serve.pid;
    assert.ok(Number.isInteger(hostPid) && hostPid > 0, `the report names the host pid (got ${JSON.stringify(hostPid)})`);

    // pid semantics are UNCHANGED by the envelope: `--scope` execs in place, so the pid written to
    // `.quay/serve.pid`, the carrier's pid and the report all name the SAME live process.
    const servePid = Number(fs.readFileSync(path.join(root, ".quay", "serve.pid"), "utf8").trim());
    const carrier = JSON.parse(fs.readFileSync(path.join(root, ".quay", "server.json"), "utf8"));
    assert.equal(servePid, hostPid, "`.quay/serve.pid` (written by startServe) names the reported host pid");
    assert.equal(carrier.pid, hostPid, "the on-disk carrier names the same pid");
    const cmdline = fs.readFileSync(`/proc/${hostPid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ");
    assert.ok(cmdline.includes("serve"), `the host is really \`serve\` (cmdline=${JSON.stringify(cmdline)})`);

    if (!systemdScopeAvailable()) {
      // 独立取值 (硬规则 3b): the cgroup membership was NOT measured here — ⛔ not read as 「checked and
      // fine」. The pid/record assertions above DID run in both modes.
      t.diagnostic("not-evaluated: systemd-run --user --scope unavailable on this host — the spawned host's cgroup membership was not measured");
      return;
    }
    const cg = cgroupPathOf(hostPid);
    assert.ok(cg, `could not read /proc/${hostPid}/cgroup`);
    unitName = cg.split("/").filter(Boolean).pop();
    const tail = cg.slice(cg.indexOf("/app.slice/"));
    assert.ok(tail.startsWith("/app.slice/quay-serve-"), `the host must live in its own quay-serve-* scope; got cgroup=${cg}`);
    assert.ok(tail.endsWith(".scope"), `…a transient scope; got cgroup=${cg}`);
    assert.notEqual(cg, cgroupPathOf(process.pid), "the host must NOT share the caller's cgroup");
  } finally {
    await reapHostAndScope(hostPid, unitName);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// gap-server-host-spawn-discards-stdio-while-start-drivers-logs-to-serve-log — the SIBLING half of
// the same contract. This script always logged; what it did NOT do was report when it could not.
test("serve-log-unavailable — an unopenable `.quay/serve.log` is REPORTED, and the host still starts", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-nolog-"));
  try {
    const root = makeWorkspaceRoot(tmp);
    // A DIRECTORY where the log file belongs: `open(path, "a")` fails with EISDIR, so the shared
    // helper must fall back to /dev/null — and SAY SO.
    fs.mkdirSync(path.join(root, ".quay", "serve.log"), { recursive: true });
    const fake = writeFakeQuay(tmp);
    const log = path.join(tmp, "log.jsonl");
    const stateFile = path.join(tmp, "state.json");
    const r = runScript(["--cli", fake, "--root", root, "--host", "127.0.0.1", "--serve-timeout", "15000", "--json"], {
      env: { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile, FAKE_QUAY_ROOT: root },
    });
    assert.match(r.stderr, /serve-log-unavailable/, "the degradation is NAMED — ⛔ before this it fell back to /dev/null in silence (硬規則 3b)");
    assert.match(r.stderr, /serve\.log/, "…and names the file an operator must fix");
    assert.equal(r.status, 0, `the host still started despite the unloggable file:\n${r.stdout}\n${r.stderr}`);
    assert.equal(jsonReport(r.stdout).serve.state, "started", "⛔ 「cannot write the log」 is not 「cannot start the host」");
  } finally {
    reapFakeHost(path.join(tmp, "ws"));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// AC3 (gap-serve-stale-signal-has-no-consumer) — the END-TO-END half: a live-but-STALE host must
// actually be REPLACED. Before that task the script saw "reachable" and skipped, leaving the pre-fix
// process serving forever (2026-08-23: 8.5h; 2026-09-14: 3h+, AC-179 oscillating 6/20) — every
// remedy was a human restart. This pins the successor: the old host is gone AND a fresh one answers,
// with the second run proving the reload is not a loop (fresh ⇒ skip).
test("AC3 — a live-but-STALE host is RELOADED (old host killed, fresh one started); then fresh ⇒ skip", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-stale-"));
  try {
    const root = makeWorkspaceRoot(tmp);
    const fake = writeFakeQuay(tmp);
    const log = path.join(tmp, "log.jsonl");
    const stateFile = path.join(tmp, "state.json");
    fs.writeFileSync(stateFile, JSON.stringify({ promotion: true, worker: true, outer: true, goal: true }));

    // The LIVE host answers /health from this FILE (read per request), so run#2 can change what the
    // already-running process says about its own freshness — that IS the reload scenario.
    const healthFile = path.join(tmp, "health.json");
    fs.writeFileSync(healthFile, JSON.stringify({ ok: true, stale: false, evaluated: true, source: "git" }));

    // run#1 — the fake starts a REAL host for this root (it takes the lock, publishes a carrier).
    const envFresh = { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile, FAKE_QUAY_ROOT: root, FAKE_QUAY_HEALTH_FILE: healthFile };
    const first = runScript(["--cli", fake, "--root", root, "--host", "127.0.0.1", "--serve-timeout", "15000", "--json"], { env: envFresh });
    assert.equal(first.status, 0, `run#1 must exit 0:\n${first.stdout}\n${first.stderr}`);
    const rep1 = jsonReport(first.stdout);
    assert.equal(rep1.serve.state, "started");
    const oldPid = readServeHostPid(root).pid;
    assert.equal(pidRunning(oldPid), true, "the live host is really running before the reload");

    // run#2 — the SAME live host now answers /health with stale:true ⇒ RELOAD.
    fs.writeFileSync(healthFile, JSON.stringify({ ok: true, stale: true, evaluated: true, source: "git" }));
    const second = runScript(["--cli", fake, "--root", root, "--host", "127.0.0.1", "--serve-timeout", "15000", "--json"], { env: envFresh });
    assert.equal(second.status, 0, `stale reload run must exit 0:\n${second.stdout}\n${second.stderr}`);
    const rep2 = jsonReport(second.stdout);
    assert.equal(rep2.serve.state, "reloaded-stale", "the live-but-stale host must be RELOADED, not skipped");
    assert.equal(rep2.serve.staleness, "stale");
    assert.equal(rep2.serve.previousPid, oldPid, "the stale host is identified from .quay/server.json");
    assert.match(second.stderr, /STALE \(code on disk newer than pid=/, "the reload is announced, not silent");
    // The old host is GONE (not merely reported gone) and a fresh one answers on a port.
    assert.equal(pidRunning(oldPid), false, "the stale host process must actually be gone (⛔ a zombie is gone too)");
    const newPid = readServeHostPid(root).pid;
    assert.notEqual(newPid, oldPid, "the replacement is a NEW process (the lock names it, not the dead one)");
    assert.equal(await waitForPort(rep2.serve.port), true, "the fresh host answers the port its carrier names");
    // The dead host's lock was reclaimed by the new one — the wait-on-pid is what makes that safe.
    assert.equal(fs.readFileSync(path.join(root, ".quay", "server.lock"), "utf8").trim(), String(newPid),
      "the replacement reclaimed the dead host's same-root lock (no second host was ever started on top of a live one)");

    // run#3 — the replacement now answers stale:false ⇒ NO reload, no third host (negative control).
    fs.writeFileSync(healthFile, JSON.stringify({ ok: true, stale: false, evaluated: true, source: "git" }));
    const third = runScript(["--cli", fake, "--root", root, "--host", "127.0.0.1", "--serve-timeout", "15000", "--json"], { env: envFresh });
    assert.equal(third.status, 0);
    const rep3 = jsonReport(third.stdout);
    assert.equal(rep3.serve.state, "already-listening");
    assert.equal(rep3.serve.staleness, "fresh");
    assert.equal(readServeHostPid(root).pid, newPid, "a FRESH host is not restarted — reload is not a loop");
    assert.equal(readLogLines(log).filter((l) => l[0] === "serve" && l[1] === "listening").length, 2,
      "exactly TWO hosts ever bound (run#1's and the reload's) across three runs");
  } finally {
    reapFakeHost(path.join(tmp, "ws"));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// AC4 (硬規則 3b) — the mirror half, END-TO-END: when /health cannot be read, the script must NOT
// launder the non-reading into an action. No restart (a reading we could not take is not "stale"),
// no "fresh" either — its own literal, said loudly.
test("AC4 — /health unreadable ⇒ NOT-EVALUATED literal, the host is left alone, and it is said loudly", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-noteval-"));
  try {
    const root = makeWorkspaceRoot(tmp);
    const fake = writeFakeQuay(tmp);
    const log = path.join(tmp, "log.jsonl");
    const stateFile = path.join(tmp, "state.json");
    fs.writeFileSync(stateFile, JSON.stringify({ promotion: true, worker: true, outer: true, goal: true }));
    const env = { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile, FAKE_QUAY_ROOT: root, FAKE_QUAY_HEALTH: JSON.stringify({ ok: true }) };
    const args = ["--cli", fake, "--root", root, "--host", "127.0.0.1", "--serve-timeout", "15000", "--json"];

    const first = runScript(args, { env });
    assert.equal(first.status, 0, `run#1:\n${first.stdout}\n${first.stderr}`);
    const livePid = readServeHostPid(root).pid;
    assert.equal(pidRunning(livePid), true, "setup: a live host exists");

    const r = runScript(args, { env });
    assert.equal(r.status, 0, `an unreadable /health is not a start failure:\n${r.stdout}\n${r.stderr}`);
    const report = jsonReport(r.stdout);
    assert.equal(report.serve.state, "already-listening");
    assert.equal(report.serve.staleness, "not-evaluated", "NOT-EVALUATED is its own value — ⛔ not 'fresh'");
    assert.equal(report.serve.stalenessReason, "no-stale-field");
    assert.ok(!("stale" in report.serve), "⛔ the not-evaluated case must not carry a stale verdict at all");
    assert.match(r.stderr, /staleness NOT-EVALUATED \(reason: no-stale-field\)/, "the non-reading is SAID, not silent");
    assert.match(r.stderr, /NOT restarting/, "⛔ a reading we could not take must not become a restart");
    assert.equal(pidRunning(livePid), true, "the unreadable-health host must NOT be killed");
    assert.equal(readServeHostPid(root).pid, livePid, "and no replacement host took the root");
  } finally {
    reapFakeHost(path.join(tmp, "ws"));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// gap-serve-same-root-admission-lock — the third occurrence mode: the host refuses (so a live host
// exists) but the CARRIER cannot be read, so freshness is unknowable. That is not an error: the
// requested end state holds. It must be its own literal, and it must not be laundered into a restart.
test("AC5 — a refusal with no readable carrier ⇒ NOT-EVALUATED (its own reason), exit 0, no restart", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-nocarrier-"));
  try {
    const root = makeWorkspaceRoot(tmp);
    const fake = writeFakeQuay(tmp);
    const log = path.join(tmp, "log.jsonl");
    const stateFile = path.join(tmp, "state.json");
    fs.writeFileSync(stateFile, JSON.stringify({ promotion: true, worker: true, outer: true, goal: true }));
    // A LIVE holder owns the lock (this test process), and no carrier exists at all.
    fs.writeFileSync(path.join(root, ".quay", "server.lock"), `${process.pid}\n`);
    const env = { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile, FAKE_QUAY_ROOT: root };
    const r = runScript(["--cli", fake, "--root", root, "--host", "127.0.0.1", "--serve-timeout", "15000", "--json"], { env });
    assert.equal(r.status, 0, `a refusal is not a failure (the requested end state holds):\n${r.stdout}\n${r.stderr}`);
    const report = jsonReport(r.stdout);
    assert.equal(report.serve.state, "already-listening");
    assert.equal(report.serve.staleness, "not-evaluated");
    assert.equal(report.serve.stalenessReason, "carrier-absent",
      "the reason names WHY freshness could not be read (its own token), not a generic 'not evaluated'");
    assert.equal(report.serve.pid, process.pid, "the refusal still reports the holder the lock named");
    assert.match(r.stderr, /staleness NOT-EVALUATED \(reason: carrier-absent\)/);
    assert.match(r.stderr, /NOT restarting/);
    // The refusal path never binds, so the fake's host never listened and nothing was killed.
    assert.equal(readLogLines(log).filter((l) => l[1] === "listening").length, 0, "⛔ no host was bound for this root");
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
    const haltMsg = "quay driver: promotion is halted (halted_by=test) — refusing to start; clear the halt first with: quay driver resume --kind promotion\n";
    const r = runScript(
      ["--cli", fake, "--root", root, "--host", "127.0.0.1", "--serve-timeout", "5000"],
      { env: { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile, FAKE_QUAY_ROOT: root, FAKE_QUAY_START_EXIT: "1", FAKE_QUAY_START_STDERR: haltMsg } },
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
    // start 退出码 0（打印 started），但 status 报 alive:0（driver 没真活）——正是 AC-203 的死因形态。
    const r = runScript(
      ["--cli", fake, "--root", root, "--host", "127.0.0.1", "--serve-timeout", "2000"],
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
    const r = runScript(
      ["--cli", fake, "--root", root, "--host", "127.0.0.1", "--serve-timeout", "2000"],
      { env: { FAKE_QUAY_LOG: log, FAKE_QUAY_STATE: stateFile, FAKE_QUAY_STATUS_GARBAGE: "1" } },
    );
    assert.notEqual(r.status, 0, "unreadable status after start must fail the script");
    assert.match(r.stderr, /could not parse `quay driver status/, "the read-unable reason is reported");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC4 (gap-serve-binding-defaults-three-copies-to-one-definition-point): the MECHANISM root cause.
// Before this task, `startServe` wrote `--port <n>` into EVERY spawned host's cmdline (n = the
// parser's seeded default 0). Seventeen `…criterion-cmdline-port-literal-stale` gaps had criteria
// that derived a live address from that literal, so they were structurally false (`addr=…:0`) while
// the mechanism itself was fine. The direct reading is the CHILD's own /proc/<pid>/cmdline.
function readCmdline(pid) {
  return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
}

test("AC4 — the spawned host's cmdline carries --port ONLY when the caller named one", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdr-ac4-"));
  try {
    // Arm (a): NO --port (and no --host): the flag must be ABSENT from the child's cmdline.
    const rootA = makeWorkspaceRoot(path.join(tmp, "a"));
    const fakeA = writeFakeQuay(path.join(tmp, "a"));
    const a = runScript(["--cli", fakeA, "--root", rootA, "--serve-timeout", "15000", "--json"], {
      env: {
        FAKE_QUAY_LOG: path.join(tmp, "a", "log.jsonl"),
        FAKE_QUAY_STATE: path.join(tmp, "a", "state.json"),
        FAKE_QUAY_ROOT: rootA,
      },
    });
    assert.equal(a.status, 0, `arm (a) must start:\n${a.stdout}\n${a.stderr}`);
    const repA = jsonReport(a.stdout);
    assert.equal(repA.serve.state, "started");
    const argvA = readCmdline(repA.serve.pid);
    assert.equal(argvA.includes("--port"), false,
      `⛔ an unnamed --port must NOT be written into the host's cmdline (got: ${argvA.join(" ")})`);
    assert.equal(argvA.includes("--host"), false,
      `⛔ an unnamed --host must NOT be written either — the host resolves its own default (got: ${argvA.join(" ")})`);
    // …and the report reads the host from the CARRIER (a direct reading), not from a flag it never had.
    assert.equal(repA.serve.host, "127.0.0.1", "the reported host comes from the carrier the host published");

    // Arm (b): an EXPLICIT --port must reach the child verbatim.
    const rootB = makeWorkspaceRoot(path.join(tmp, "b"));
    const fakeB = writeFakeQuay(path.join(tmp, "b"));
    const portB = await freePort();
    const b = runScript(["--cli", fakeB, "--root", rootB, "--host", "127.0.0.1", "--port", String(portB), "--serve-timeout", "15000", "--json"], {
      env: {
        FAKE_QUAY_LOG: path.join(tmp, "b", "log.jsonl"),
        FAKE_QUAY_STATE: path.join(tmp, "b", "state.json"),
        FAKE_QUAY_ROOT: rootB,
      },
    });
    assert.equal(b.status, 0, `arm (b) must start:\n${b.stdout}\n${b.stderr}`);
    const repB = jsonReport(b.stdout);
    assert.equal(repB.serve.state, "started");
    const argvB = readCmdline(repB.serve.pid);
    const at = argvB.indexOf("--port");
    assert.notEqual(at, -1, `an explicit --port must be forwarded (got: ${argvB.join(" ")})`);
    assert.equal(Number(argvB[at + 1]), portB, "…with the caller's exact value");
    assert.equal(repB.serve.port, portB, "and it is the port the host really bound");
  } finally {
    reapFakeHost(path.join(tmp, "a", "ws"));
    reapFakeHost(path.join(tmp, "b", "ws"));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC4 unit — parseArgs leaves host/port UNSET when unnamed, and still validates an explicit bad one", () => {
  const help = runScript(["--help"]);
  assert.match(help.stdout, /--host <ip>/, "the help still documents --host");
  assert.ok(!/default: 0\.0\.0\.0/.test(help.stdout),
    "the help text must no longer present a locally-declared host default — this script declares none");
  const bad = runScript(["--port", "not-a-number"]);
  assert.equal(bad.status, 2, "an explicit malformed --port is still a usage error");
  assert.match(bad.stderr, /invalid --port/);
});

test("the drivers skill references plugin/scripts/start-drivers.ts (the ONE delegate)", () => {
  const skill = fs.readFileSync(SKILL, "utf8");
  assert.match(skill, /plugin\/scripts\/start-drivers\.ts/,
    "SKILL.md must reference the delegate script by path (laydown rule-(a) derivation + skill correctness)");
  assert.match(skill, /^name: drivers$/m, "the skill is named drivers (== its directory name, so the slash form is /quay:drivers)");
  assert.ok(!/4173/.test(skill),
    "⛔ the skill must not document a hardcoded default port — the default is the kernel's ephemeral port");
});
