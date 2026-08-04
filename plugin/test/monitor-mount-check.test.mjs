// @test-group governance
// monitor-mount-check.test.mjs — gap-nothing-checks-whether-the-monitor-is-mounted-or-aimed-right.
// Verifies the three criteria of the outer's Monitor mount check (plugin/scripts/monitor-mount-check.sh):
//   (1) mounted             — a real process whose argv[0..1] == `bash <abs inner-state.sh>` exists;
//   (2) targetRoot          — the resolved work root (argv's ../.. or INNER_STATE_WORK_ROOT override)
//                             compared to this repo's root;
//   (3) delivered           — the SHARED session-liveness events file has fresh events (AC9,
//                             gap-liveness-mounting-is-a-single-flight-role-with-no-owner:
//                             ownedByThisSession is ABOLISHED — the criterion is "事件是否真的送达",
//                             not "是不是本会话挂的". AC20c is one-mount-many-subscribe: another
//                             session's mount + normal delivery must PASS; no mount ⇒ FAIL.)
// Plus the AC2 self-match negative control (substring in the checker's own argv must NOT count),
// AC6 (N>1 pids is ONE logical monitor), AC7 (zero writes), AC8 (INIT carries work_root), and
// AC10 (node:test + @test-group governance).
//
// Isolation: every fake monitor is spawned against a mkdtemp script path, and the checker is pointed
// at that path via MONITOR_CHECK_INNER_STATE — so a REAL monitor mounted in the quay repo can never
// leak into these assertions.
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
const INNER_STATE = path.join(REPO_ROOT, "plugin", "scripts", "inner-state.sh");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mmc-"));
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── fake-monitor helpers ────────────────────────────────────────────────────────────────────────────

function writeStubInnerState(innerPath) {
  fs.mkdirSync(path.dirname(innerPath), { recursive: true });
  fs.writeFileSync(innerPath, "#!/usr/bin/env bash\nwhile true; do sleep 1; done\n", "utf8");
}

// Spawn a real `bash <innerPath>` process as a child of THIS test (i.e. inside the current session's
// process tree). Returns the ChildProcess so the caller can kill it.
function spawnInSessionFake(innerPath, env = {}) {
  return spawn("bash", [innerPath], { env: { ...process.env, ...env }, stdio: "ignore" });
}

// Spawn a `bash <innerPath>` that is orphaned to init (double-fork via a short-lived background
// wrapper), simulating a monitor left over from a PREVIOUS session. Returns { fakePid, wrapperPid }.
function spawnOrphanedFake(innerPath, pidFile, env = {}) {
  const wrapper = spawn(
    "bash",
    ["-c", `bash '${innerPath}' < /dev/null > /dev/null 2>&1 & echo $! > '${pidFile}'`],
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
    if (argv0 === "bash" && argv1 && argv1.startsWith(os.tmpdir()) && argv1.endsWith("inner-state.sh")) {
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

test("AC1 — --json emits mounted / targetRoot / delivered (all boolean where promised; ownedByThisSession is GONE)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const innerPath = path.join(tmp, "plugin", "scripts", "inner-state.sh");
    writeStubInnerState(innerPath);
    const data = runChecker({ MONITOR_CHECK_INNER_STATE: innerPath });
    assert.ok("mounted" in data, "mounted field missing");
    assert.ok("targetRoot" in data, "targetRoot field missing");
    assert.ok("delivered" in data, "delivered field missing (AC9: replaces ownedByThisSession)");
    assert.equal(typeof data.mounted, "boolean");
    assert.equal(typeof data.delivered, "boolean");
    assert.ok(!("ownedByThisSession" in data),
      "ownedByThisSession must be ABOLISHED (AC9 — the criterion is delivery, not ownership)");
  } finally { cleanup(tmp); }
});

// ── AC2: self-match negative control ───────────────────────────────────────────────────────────────

test("AC2 — a command line that merely CONTAINS the script name must NOT count as a mount", () => {
  const tmp = makeTmpWorkspace();
  try {
    const innerPath = path.join(tmp, "plugin", "scripts", "inner-state.sh");
    writeStubInnerState(innerPath);
    // No fake spawned. The checker's OWN argv carries innerPath as a literal argument — a substring
    // matcher (the outer's first version, and pgrep -f) would match the querying command itself.
    const res = spawnSync("bash", [CHECKER, innerPath, "--json"], {
      encoding: "utf8",
      env: { ...process.env, MONITOR_CHECK_INNER_STATE: innerPath },
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
    const innerPath = path.join(tmp, "plugin", "scripts", "inner-state.sh");
    writeStubInnerState(innerPath);
    const data = runChecker({ MONITOR_CHECK_INNER_STATE: innerPath });
    assert.equal(data.mounted, false);
  } finally { cleanup(tmp); }
});

test("AC3 (positive) — re-mount a monitor ⇒ mounted=true and the pid is reported", () => {
  const tmp = makeTmpWorkspace();
  const innerPath = path.join(tmp, "plugin", "scripts", "inner-state.sh");
  writeStubInnerState(innerPath);
  const child = spawnInSessionFake(innerPath, { INNER_STATE_WORK_ROOT: tmp });
  try {
    const data = runChecker({ MONITOR_CHECK_INNER_STATE: innerPath });
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
  const innerPath = path.join(tmp, "plugin", "scripts", "inner-state.sh");
  writeStubInnerState(innerPath);
  // The monitor process itself is aimed at `other` via INNER_STATE_WORK_ROOT.
  const child = spawnInSessionFake(innerPath, { INNER_STATE_WORK_ROOT: other });
  try {
    const data = runChecker({ MONITOR_CHECK_INNER_STATE: innerPath });
    assert.equal(data.mounted, true, "the mis-aimed monitor is still alive");
    assert.equal(data.targetRoot, other, "the effective root comes from the env override");
    assert.notEqual(data.targetRoot, tmp, "the effective root is NOT this repo's root");
    assert.equal(data.targetOk, false, "targetOk must be false and the wrong root must be reported");
  } finally {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    cleanup(tmp); cleanup(other);
  }
});

// ── AC5/AC9: delivery criterion replaces ownership ───────────────────────────────────────────────────
// AC9 (gap-liveness-mounting-is-a-single-flight-role-with-no-owner): ownedByThisSession is ABOLISHED.
// The criterion is "事件是否真的送达" (shared events file has new events / REPO-STALL visible), NOT
// "是不是本会话挂的". Negative control: a monitor from another session with NO fresh events ⇒ FAIL
// (delivered=false). Positive control: a monitor from another session WITH normal delivery ⇒ PASS
// (delivered=true) — the whole point of AC20c's one-mount-many-subscribe design.

test("AC5 — a monitor orphaned to a PREVIOUS session with NO fresh events ⇒ delivered=false (无人挂载 ⇒ FAIL)", async () => {
  const tmp = makeTmpWorkspace();
  const innerPath = path.join(tmp, "plugin", "scripts", "inner-state.sh");
  writeStubInnerState(innerPath);
  const pidFile = path.join(tmp, "fake.pid");
  const { wrapperPid } = spawnOrphanedFake(innerPath, pidFile, { INNER_STATE_WORK_ROOT: tmp });
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
    // The shared events file is ABSENT (no mount is delivering) ⇒ delivered=false, regardless of the
    // alive-but-orphaned process being a real inner-state monitor.
    // Hermetic: point MONITOR_CHECK_EVENTS_FILE at a temp path that does not exist, so the checker
    // must NOT see the REAL shared events file (the outer's live monitors write HEARTBEAT there —
    // fresh mtime ⇒ delivered=true would be correct for them, and wrong for this no-events scenario).
    const data = runChecker({ MONITOR_CHECK_INNER_STATE: innerPath, MONITOR_CHECK_EVENTS_FILE: path.join(tmp, "absent-events.jsonl") });
    assert.equal(data.mounted, true, "the orphaned monitor IS alive — the miss would be silent");
    assert.equal(data.delivered, false,
      "with no fresh shared events, delivery must FAIL (AC9: 无人挂载 ⇒ 必须判 FAIL)");
  } finally {
    if (fakePid) { try { process.kill(fakePid, "SIGKILL"); } catch { /* already gone */ } }
    cleanup(tmp);
  }
});

test("AC9 — a monitor from ANOTHER session with NORMAL delivery ⇒ delivered=true (别的会话挂的、投递正常 ⇒ PASS)", () => {
  const tmp = makeTmpWorkspace();
  const eventsFile = path.join(tmp, "events.jsonl");
  try {
    // The events file exists and is FRESH (just written) — someone (any session) is delivering.
    fs.writeFileSync(eventsFile, '{"ts":123,"event":"HEARTBEAT","name":"other","msg":"holder alive"}\n');
    const data = runChecker({
      MONITOR_CHECK_EVENTS_FILE: eventsFile,
      MONITOR_DELIVERY_FRESH_S: "300",
    });
    assert.equal(data.delivered, true,
      "fresh shared events must mean delivered=true even though NO process in this session mounted it (AC9 PASS direction)");
    assert.equal(data.eventsFresh, true);
    assert.equal(data.lastEvent, "HEARTBEAT");
  } finally { cleanup(tmp); }
});

// ── AC6: N>1 pids = one logical monitor ────────────────────────────────────────────────────────────

test("AC6 — a single logical monitor with N>1 pids reports mounted=true (not 'multiple monitors')", () => {
  const tmp = makeTmpWorkspace();
  const innerPath = path.join(tmp, "plugin", "scripts", "inner-state.sh");
  writeStubInnerState(innerPath);
  const env = { INNER_STATE_WORK_ROOT: tmp };
  const c1 = spawnInSessionFake(innerPath, env);
  const c2 = spawnInSessionFake(innerPath, env);
  try {
    const data = runChecker({ MONITOR_CHECK_INNER_STATE: innerPath });
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
  assert.match(src, /只读 \/proc 与共享事件文件/, "the read contract must extend to the shared events file (AC9 delivery check reads it)");
});

// ── AC8: inner-state.sh INIT event carries the resolved work root ─────────────────────────────────

test("AC8 (source) — inner-state.sh's INIT event line embeds the resolved work root", () => {
  const src = fs.readFileSync(INNER_STATE, "utf8");
  assert.match(src, /echo "INIT .*work_root=\$PWD/, "INIT must carry the resolved work root");
});

test("AC8 (behavioral) — running inner-state.sh against a temp root emits INIT with work_root=<root>", async () => {
  const tmp = makeTmpWorkspace();
  try {
    fs.mkdirSync(path.join(tmp, "plugin", "scripts"), { recursive: true });
    // Fake telemetry: reports one in-progress task so the INIT baseline event fires on the first loop.
    fs.writeFileSync(
      path.join(tmp, "plugin", "scripts", "fast-mode-telemetry.ts"),
      "const a=process.argv.slice(2);if(a.includes('--report')){process.stdout.write(JSON.stringify({inProgress:[{taskId:'AC8-demo',startedAtMs:Date.now()}],orphaned:[]}));}",
      "utf8",
    );
    const child = spawn("bash", [INNER_STATE], {
      env: { ...process.env, INNER_STATE_WORK_ROOT: tmp },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    try {
      // Generous budget: the full-suite fan-in may be running concurrently.
      for (let i = 0; i < 200 && !out.includes("INIT 挂载时的在飞任务"); i++) await sleep(50);
      assert.match(out, /INIT 挂载时的在飞任务: AC8-demo/, `INIT must fire on first loop: ${out}`);
      assert.ok(out.includes(`work_root=${tmp}`), `INIT must carry the resolved work root: ${out}`);
    } finally {
      child.kill("SIGKILL");
    }
  } finally { cleanup(tmp); }
});
