// @test-group lowconc
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (B-class — spawns real monitor processes and waits on real process/argv state) so
// it runs in the concurrency-1 serial phase, never competing with the concurrency-8 main body.
// monitor-mount-check.test.mjs — gap-nothing-checks-whether-the-monitor-is-mounted-or-aimed-right,
// rewritten for gap-retire-inner-state-one-observer-targets-by-parameter (AC1): observation has
// exactly ONE tool, session-liveness.sh. Verifies the two criteria of the outer's Monitor mount
// check (plugin/scripts/monitor-mount-check.sh):
//   (1) mounted             — a real process whose argv[0..1] == `bash <abs|rel session-liveness.sh>`
//                             exists (basename match on argv[1], so absolute and relative launches
//                             both count; inner-state.sh is NO LONGER a pass condition);
//   (2) targetRoot          — the resolved work root (argv script's ../.. resolved via the process
//                             cwd, or the SESSION_ROOT env override) compared to this repo's root.
// The old (3) delivered criterion — the SHARED session-liveness events file having fresh events —
// was RETIRED 2026-08-06 (gap-session-liveness-remove-shared-events-and-lock): the shared file is
// gone, observation is a tree, and each observer owns its own stdout stream (who mounts owns it), so
// delivery is the owner's own Monitor stream, not a cross-observer file the checker could read.
// Plus the AC2 self-match negative control (substring in the checker's own argv must NOT count),
// AC6 (N>1 pids is ONE logical monitor), AC7 (zero writes), and the AC1 negative control
// (session-liveness deliberately not mounted ⇒ mounted=false ⇒ the six-key check judges cold start
// incomplete).
//
// Isolation: every fake monitor is spawned against a mkdtemp script path, and the checker is pointed
// at that path via MONITOR_CHECK_SESSION_LIVENESS — so a REAL monitor mounted in the quay repo can
// never leak into these assertions.
//
// Run:
//   scripts/test.sh plugin/test/monitor-mount-check.test.mjs
//   node --test plugin/test/monitor-mount-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}

const REPO_ROOT = _findRepoRoot(__dirname);
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "monitor-mount-check.sh");
const SESSION_LIVENESS = path.join(REPO_ROOT, "plugin", "scripts", "session-liveness.sh");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mmc-"));
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── fake-monitor helpers ────────────────────────────────────────────────────────────────────────────

function writeStubLiveness(livenessPath) {
  fs.mkdirSync(path.dirname(livenessPath), { recursive: true });
  fs.writeFileSync(livenessPath, "#!/usr/bin/env bash\nwhile true; do sleep 1; done\n", "utf8");
}

// Spawn a real `bash <livenessPath>` process as a child of THIS test (i.e. inside the current
// session's process tree). Returns the ChildProcess so the caller can kill it.
function spawnInSessionFake(livenessPath, env = {}) {
  return spawn("bash", [livenessPath], { env: { ...process.env, ...env }, stdio: "ignore" });
}

// Spawn a `bash <livenessPath>` that is orphaned to init (double-fork via a short-lived background
// wrapper), simulating a monitor left over from a PREVIOUS session. Returns { fakePid, wrapperPid }.
function spawnOrphanedFake(livenessPath, pidFile, env = {}) {
  const wrapper = spawn(
    "bash",
    ["-c", `bash '${livenessPath}' < /dev/null > /dev/null 2>&1 & echo $! > '${pidFile}'`],
    { env: { ...process.env, ...env }, stdio: "ignore", detached: true },
  );
  const wrapperPid = wrapper.pid;
  wrapper.unref();
  return { wrapperPid };
}

// /proc/<pid>/stat field 4 = ppid. The comm field (2) can contain spaces/parens — parse from the
// last `)` so the field offsets stay correct.
function readPpid(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const idx = stat.lastIndexOf(")");
    const fields = stat.slice(idx + 2).trim().split(/\s+/);
    return parseInt(fields[1], 10);
  } catch {
    return null;
  }
}

// Kill any lingering fake monitors under os.tmpdir() (defensive cleanup for orphaned fakes).
function killTmpdirMonitors() {
  for (const d of fs.readdirSync("/proc", { withFileTypes: true })) {
    if (!/^\d+$/.test(d.name)) continue;
    let cmd;
    try { cmd = fs.readFileSync(`/proc/${d.name}/cmdline`, "utf8"); } catch { continue; } // vanished mid-scan
    const [argv0, argv1] = cmd.split("\0");
    if (argv0 === "bash" && argv1 && argv1.startsWith(os.tmpdir()) && argv1.endsWith("session-liveness.sh")) {
      try { process.kill(parseInt(d.name, 10), "SIGKILL"); } catch { /* already gone */ }
    }
  }
}

after(() => { killTmpdirMonitors(); });

function runChecker(extraEnv = {}) {
  const res = spawnSync("bash", [CHECKER, "--json"], { encoding: "utf8", env: { ...process.env, ...extraEnv } });
  assert.equal(res.status, 0, `checker failed (${res.status}): ${res.stderr}`);
  let data;
  try { data = JSON.parse(res.stdout); } catch (e) { assert.fail(`checker stdout not JSON: ${res.stdout}`); }
  return data;
}

// ── AC1: the three contract fields ──────────────────────────────────────────────────────────────────

test("AC1 — --json emits mounted / targetRoot / targetOk (all boolean where promised; ownedByThisSession AND delivered are GONE — per-observer streams, 2026-08-06)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const livenessPath = path.join(tmp, "plugin", "scripts", "session-liveness.sh");
    writeStubLiveness(livenessPath);
    const data = runChecker({ MONITOR_CHECK_SESSION_LIVENESS: livenessPath });
    assert.ok("mounted" in data, "mounted field missing");
    assert.ok("targetRoot" in data, "targetRoot field missing");
    assert.ok("targetOk" in data, "targetOk field missing");
    assert.equal(typeof data.mounted, "boolean");
    assert.equal(typeof data.targetOk, "boolean");
    assert.ok(!("ownedByThisSession" in data), "ownedByThisSession must be ABOLISHED");
    assert.ok(!("delivered" in data) && !("eventsFresh" in data) && !("eventsFile" in data),
      "delivered/eventsFresh/eventsFile must be REMOVED (2026-08-06 — the shared events file is gone; delivery is the owner's own Monitor stream, so the mount check is mounted + targetOk)");
  } finally { cleanup(tmp); }
});

// ── AC1 NEGATIVE CONTROL (gap-retire-inner-state-one-observer-targets-by-parameter AC1): ─────────────
// with session-liveness deliberately not mounted, the six-key check must still judge cold start
// incomplete — mounted=false. This is the whole point of collapsing to ONE monitor: a missing
// session-liveness mount must FAIL, and an inner-state mount must NOT make it PASS.

test("AC1 NEGATIVE — no session-liveness mounted ⇒ mounted=false (six-key judges cold start incomplete)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const livenessPath = path.join(tmp, "plugin", "scripts", "session-liveness.sh");
    writeStubLiveness(livenessPath);
    // No fake spawned — the ONLY liveness process would be a real one, excluded by the hermetic
    // script path. mounted=false + targetOk=false: fail-closed (the mount check no longer reads a
    // shared events file, 2026-08-06).
    const data = runChecker({ MONITOR_CHECK_SESSION_LIVENESS: livenessPath });
    assert.equal(data.mounted, false,
      "session-liveness deliberately not mounted must report mounted=false (AC1 negative control)");
    assert.equal(data.targetOk, false, "no mounted observer ⇒ targetOk=false (fail-closed)");
  } finally { cleanup(tmp); }
});

// ── AC2: self-match negative control ───────────────────────────────────────────────────────────────

test("AC2 — a command line that merely CONTAINS the script name must NOT count as a mount", () => {
  const tmp = makeTmpWorkspace();
  try {
    const livenessPath = path.join(tmp, "plugin", "scripts", "session-liveness.sh");
    writeStubLiveness(livenessPath);
    // No fake spawned. The checker's OWN argv carries livenessPath as a literal argument — a
    // substring matcher (the outer's first version, and pgrep -f) would match the querying command
    // itself. The basename predicate looks only at argv[1], so this must not count.
    const res = spawnSync("bash", [CHECKER, livenessPath, "--json"], {
      encoding: "utf8",
      env: { ...process.env, MONITOR_CHECK_SESSION_LIVENESS: livenessPath },
    });
    assert.equal(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout);
    assert.equal(data.mounted, false, "substring in the checker's own argv must not report a mount");
  } finally { cleanup(tmp); }
});

// ── AC3: unmounted vs mounted ──────────────────────────────────────────────────────────────────────

test("AC3 (negative) — no monitor mounted ⇒ mounted=false", () => {
  const tmp = makeTmpWorkspace();
  try {
    const livenessPath = path.join(tmp, "plugin", "scripts", "session-liveness.sh");
    writeStubLiveness(livenessPath);
    const data = runChecker({ MONITOR_CHECK_SESSION_LIVENESS: livenessPath });
    assert.equal(data.mounted, false);
  } finally { cleanup(tmp); }
});

test("AC3 (positive) — re-mount a monitor ⇒ mounted=true and the pid is reported", () => {
  const tmp = makeTmpWorkspace();
  const livenessPath = path.join(tmp, "plugin", "scripts", "session-liveness.sh");
  writeStubLiveness(livenessPath);
  const child = spawnInSessionFake(livenessPath, { SESSION_ROOT: tmp });
  try {
    const data = runChecker({ MONITOR_CHECK_SESSION_LIVENESS: livenessPath });
    assert.equal(data.mounted, true);
    assert.ok(Array.isArray(data.pids) && data.pids.includes(child.pid),
      `fake pid ${child.pid} must be in ${JSON.stringify(data.pids)}`);
    assert.equal(data.targetRoot, tmp);
    assert.equal(data.targetOk, true);
  } finally {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    cleanup(tmp);
  }
});

// ── AC4: wrong-target negative control ─────────────────────────────────────────────────────────────

test("AC4 — monitor aimed at ANOTHER repo ⇒ targetRoot differs and targetOk=false (reported)", () => {
  const tmp = makeTmpWorkspace();
  const other = makeTmpWorkspace();
  const livenessPath = path.join(tmp, "plugin", "scripts", "session-liveness.sh");
  writeStubLiveness(livenessPath);
  // The monitor process itself is aimed at `other` via SESSION_ROOT.
  const child = spawnInSessionFake(livenessPath, { SESSION_ROOT: other });
  try {
    const data = runChecker({ MONITOR_CHECK_SESSION_LIVENESS: livenessPath });
    assert.equal(data.mounted, true, "the mis-aimed monitor is still alive");
    assert.equal(data.targetRoot, other, "the effective root comes from the env override");
    assert.notEqual(data.targetRoot, tmp, "the effective root is NOT this repo's root");
    assert.equal(data.targetOk, false, "targetOk must be false and the wrong root must be reported");
  } finally {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    cleanup(tmp); cleanup(other);
  }
});

// ── AC5/AC9: delivery criterion RETIRED with the shared events file (2026-08-06) ───────────────────
// The old AC9 delivered criterion read the shared events.jsonl's mtime — "事件是否真的送达". The
// shared file is GONE (gap-session-liveness-remove-shared-events-and-lock): observation is a tree,
// each observer owns its own stdout stream (who mounts owns it), so delivery is verified by the
// OWNER's own Monitor stream (cold-start MONITORS-DELIVERING), never by a cross-observer file. The
// mount check therefore verifies exactly two things: mounted (an observer process exists) and
// targetOk (it is aimed at the right repo). Who mounted it is irrelevant — an orphaned monitor from
// a previous session, if alive and aimed right, still counts.

test("AC5 — a monitor orphaned to a PREVIOUS session is still detected as mounted and correctly aimed (who mounted is irrelevant)", async () => {
  const tmp = makeTmpWorkspace();
  const livenessPath = path.join(tmp, "plugin", "scripts", "session-liveness.sh");
  writeStubLiveness(livenessPath);
  const pidFile = path.join(tmp, "fake.pid");
  const { wrapperPid } = spawnOrphanedFake(livenessPath, pidFile, { SESSION_ROOT: tmp });
  let fakePid = null;
  try {
    for (let i = 0; i < 200 && !fs.existsSync(pidFile); i++) await sleep(25);
    fakePid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    assert.ok(Number.isInteger(fakePid), "orphaned fake monitor pid must be readable");
    // Wait until the short-lived wrapper has exited and the fake has been reparented out of the
    // test's process tree (ppid is no longer the wrapper / the test's own node process).
    for (let i = 0; i < 200; i++) {
      const ppid = readPpid(fakePid);
      if (ppid !== null && ppid !== wrapperPid && ppid !== process.pid) break;
      await sleep(25);
    }
    // No shared events file is involved: mounted + targetOk are the whole criterion now. The orphaned
    // process is alive and SESSION_ROOT=tmp ⇒ it is a live observer aimed at this (hermetic) repo.
    const data = runChecker({ MONITOR_CHECK_SESSION_LIVENESS: livenessPath });
    assert.equal(data.mounted, true, "the orphaned monitor IS alive — the miss would be silent");
    assert.equal(data.targetOk, true,
      "an alive observer aimed at this repo must report targetOk=true (who mounted it is irrelevant; the delivered criterion is gone with the shared file)");
  } finally {
    if (fakePid) { try { process.kill(fakePid, "SIGKILL"); } catch { /* already gone */ } }
    cleanup(tmp);
  }
});

test("AC9 (retired) — the shared-events delivery criterion is GONE: the checker's --json output carries no events-file field and the script has no live reader env for it", () => {
  const tmp = makeTmpWorkspace();
  try {
    const livenessPath = path.join(tmp, "plugin", "scripts", "session-liveness.sh");
    writeStubLiveness(livenessPath);
    const data = runChecker({ MONITOR_CHECK_SESSION_LIVENESS: livenessPath });
    assert.ok(!("delivered" in data) && !("eventsFresh" in data) && !("eventsFile" in data) && !("lastEvent" in data),
      "the --json output must not carry delivered/eventsFresh/eventsFile/lastEvent (per-observer streams, 2026-08-06)");
    const src = fs.readFileSync(CHECKER, "utf8");
    assert.ok(!src.includes("MONITOR_CHECK_EVENTS_FILE"),
      "the checker must not read a MONITOR_CHECK_EVENTS_FILE env (the shared events file is gone)");
  } finally { cleanup(tmp); }
});

// ── AC6: N>1 pids = one logical monitor ────────────────────────────────────────────────────────────

test("AC6 — a single logical monitor with N>1 pids reports mounted=true (not 'multiple monitors')", () => {
  const tmp = makeTmpWorkspace();
  const livenessPath = path.join(tmp, "plugin", "scripts", "session-liveness.sh");
  writeStubLiveness(livenessPath);
  const env = { SESSION_ROOT: tmp };
  const c1 = spawnInSessionFake(livenessPath, env);
  const c2 = spawnInSessionFake(livenessPath, env);
  try {
    const data = runChecker({ MONITOR_CHECK_SESSION_LIVENESS: livenessPath });
    assert.equal(data.mounted, true);
    assert.ok(data.pids.length >= 2, `expected >=2 pids, got ${JSON.stringify(data.pids)}`);
    assert.ok(data.pids.includes(c1.pid) && data.pids.includes(c2.pid));
    assert.equal(data.targetOk, true, "both pids resolve to the same correct target");
  } finally {
    try { c1.kill("SIGKILL"); } catch { /* already gone */ }
    try { c2.kill("SIGKILL"); } catch { /* already gone */ }
    cleanup(tmp);
  }
});

// ── AC7: zero writes + explicit read-only contract ────────────────────────────────────────────────

test("AC7 — checker is zero-write (git status unchanged) and declares the read-only contract", () => {
  const before = spawnSync("git", ["-C", REPO_ROOT, "status", "--short"], { encoding: "utf8" }).stdout;
  const res = spawnSync("bash", [CHECKER, "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  JSON.parse(res.stdout); // must be well-formed
  const after = spawnSync("git", ["-C", REPO_ROOT, "status", "--short"], { encoding: "utf8" }).stdout;
  assert.equal(after, before, "the checker must not write any file in the repo");
  const src = fs.readFileSync(CHECKER, "utf8");
  assert.match(src, /只读 \/proc/, "the script must explicitly declare it only reads /proc");
  assert.match(src, /不写任何文件/, "the script must explicitly declare it writes nothing");
});

// ── AC1 (rewrite): inner-state.sh is NO LONGER a pass condition ─────────────────────────────────────
// gap-retire-inner-state-one-observer-targets-by-parameter AC1: the checker must not treat an
// inner-state mount as a pass condition. A running inner-state.sh process (here: a stub) must NOT
// flip mounted=true — only a session-liveness.sh mount can.

test("AC1 (rewrite) — an inner-state.sh process is NOT a pass condition (mounted stays false)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const livenessPath = path.join(tmp, "plugin", "scripts", "session-liveness.sh");
    writeStubLiveness(livenessPath);
    // Spawn a stub named inner-state.sh — the RETIRED monitor. The checker points at the liveness
    // path; only a session-liveness mount may satisfy mounted.
    const innerStub = path.join(tmp, "plugin", "scripts", "inner-state.sh");
    writeStubLiveness(innerStub);
    const child = spawnInSessionFake(innerStub, { INNER_STATE_WORK_ROOT: tmp });
    try {
      const data = runChecker({ MONITOR_CHECK_SESSION_LIVENESS: livenessPath });
      assert.equal(data.mounted, false,
        "an inner-state.sh process must NOT count as a mount (retired — one observer, session-liveness.sh)");
    } finally {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }
  } finally { cleanup(tmp); }
});

// ── gap-monitor-mount-check-stale-pids: dead-pid re-verification ─────────────────────────────────────
// A pid matched during the /proc scan can die between the scan and the output (TOCTOU). The checker
// must re-verify each pid before emitting and route dead pids to the independent `stale_pids` field —
// NOT silently drop them, and NOT let them satisfy mounted/targetOk (which must be judged on the LIVE
// set). MONITOR_CHECK_STALE_PIDS is the test seam (mirrors MONITOR_CHECK_SESSION_LIVENESS): it
// simulates "died between scan and output" by forcing the listed pids to be treated as dead — the
// TOCTOU window is not externally controllable, so a seam is the only deterministic way to exercise
// the routing logic with a REAL spawned monitor.

test("stale-pids AC1/AC3 — a dead pid goes to stale_pids (not pids) and mounted/targetOk are judged on the LIVE set only", () => {
  const tmp = makeTmpWorkspace();
  const livenessPath = path.join(tmp, "plugin", "scripts", "session-liveness.sh");
  writeStubLiveness(livenessPath);
  const child = spawnInSessionFake(livenessPath, { SESSION_ROOT: tmp });
  try {
    // The ONLY monitor is forced dead at re-verify time (simulates it dying after the scan).
    const data = runChecker({
      MONITOR_CHECK_SESSION_LIVENESS: livenessPath,
      MONITOR_CHECK_STALE_PIDS: String(child.pid),
    });
    assert.ok(Array.isArray(data.stale_pids), "stale_pids field must exist");
    assert.ok(data.stale_pids.includes(child.pid),
      `dead pid ${child.pid} must be REPORTED in stale_pids (not silently dropped), got ${JSON.stringify(data.stale_pids)}`);
    assert.ok(!data.pids.includes(child.pid),
      `dead pid ${child.pid} must NOT be in pids (live set only), got ${JSON.stringify(data.pids)}`);
    assert.equal(data.mounted, false,
      "mounted must be judged on the LIVE pid set — the only monitor is dead ⇒ false (AC3)");
    assert.equal(data.targetOk, false, "no live observer ⇒ targetOk=false (AC3)");
  } finally {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    cleanup(tmp);
  }
});

test("stale-pids AC1/AC3 (mixed) — a live pid stays in pids, a concurrent dead pid lands in stale_pids, mounted stays true", () => {
  const tmp = makeTmpWorkspace();
  const livenessPath = path.join(tmp, "plugin", "scripts", "session-liveness.sh");
  writeStubLiveness(livenessPath);
  const env = { SESSION_ROOT: tmp };
  const live = spawnInSessionFake(livenessPath, env);
  const doomed = spawnInSessionFake(livenessPath, env);
  try {
    const data = runChecker({
      MONITOR_CHECK_SESSION_LIVENESS: livenessPath,
      MONITOR_CHECK_STALE_PIDS: String(doomed.pid),
    });
    assert.ok(data.pids.includes(live.pid),
      `live pid ${live.pid} must stay in pids, got ${JSON.stringify(data.pids)}`);
    assert.ok(!data.pids.includes(doomed.pid),
      `dead pid ${doomed.pid} must NOT be in pids, got ${JSON.stringify(data.pids)}`);
    assert.ok(data.stale_pids.includes(doomed.pid),
      `dead pid ${doomed.pid} must be in stale_pids, got ${JSON.stringify(data.stale_pids)}`);
    assert.ok(!data.stale_pids.includes(live.pid),
      `live pid ${live.pid} must NOT be in stale_pids, got ${JSON.stringify(data.stale_pids)}`);
    assert.equal(data.mounted, true, "at least one LIVE observer ⇒ mounted=true (AC3)");
    assert.equal(data.targetOk, true, "live observer aimed at this repo ⇒ targetOk=true");
  } finally {
    try { live.kill("SIGKILL"); } catch { /* already gone */ }
    try { doomed.kill("SIGKILL"); } catch { /* already gone */ }
    cleanup(tmp);
  }
});
