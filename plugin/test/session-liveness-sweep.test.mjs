// @test-group engine
// @load-sensitive wall-clock
// @load-sensitive-entry 2026-08-08 wall-clock (spawns real monitor + tmux servers); GROUP=serial deliberately
// session-liveness-sweep.test.mjs — AC2/AC3/AC4 (+ candidate-D registry, AC5) for
// gap-sweeptmp-pkill-kills-live-observers-two-layer-blind.
//
// GROUP = serial, NOT lowconc — DELIBERATELY: the AC2/AC3/AC5 tests below spawn REAL
// session-liveness monitor processes + hermetic tmux servers to prove the cleanup cannot kill them.
// The lowconc family (events/heartbeat/signals) is KNOWN-LOAD-SENSITIVE (gap-load-sensitive-session-
// family-confounds-step-three) — a concurrent extra monitor's classifyPaneState timing can trip the
// busy/idle shape race in signals. The serial group runs at concurrency 1 in its own phase, so this
// file can never perturb the load-sensitive lowconc family in the full suite (or in the scoped gate,
// where the selected files already run serially).
//
// 2026-08-08 incident: a cleanup ran a process-name batch kill of the session-liveness monitor
// processes and killed every live one (outer + manager) — two-layer observation went blind
// simultaneously and the observers' own deaths had no observer. Root cause: residue-vs-in-use was
// decided by PROCESS-NAME/PATH matching, not OWNER-SESSION LIVENESS. This file pins the fix:
//   AC2 (no_pkill_by_name_on_live): the cleanup surface has no name-based batch kill.
//   AC3 (owner-liveness criterion): sweepTmp skips a /tmp dir whose owner (tmux server) is alive.
//   AC4 (negative control): a live probe SURVIVES sweepTmp; an owner-dead residue is cleaned.
//   AC5 (candidate D, observer_death_detectable): a registered monitor's death is detectable via
//       the .quay registry + observer-registry-check.sh, not only via a passive Monitor failed.
//
// Part of the session-liveness family (gap-session-liveness-tail-capped-split): owns the
// /tmp prefix "session-liveness-swp-" — the after() below sweeps ONLY it.
//
// Run: scripts/test.sh plugin/test/session-liveness-sweep.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  tmuxAvailable,
  setProbeTmpPrefix, sessionLivenessAfter, sweepTmp, reapLiveOwners, dirHasLiveOwner, probeRoot, serverPidOf,
  makeHermeticProbe, spawnMonitor, waitForRounds, startTouchLoop, reapSpawnedChildren, serverPidsOfByCmdline,
  teardownProbe, killRegisteredServers, readServerRegistry,
} from "./session-liveness-helpers.mjs";
// serverPidViaPaneEnv is the socket-close-surviving fallback added by
// gap-session-liveness-teardown-ol-scd-d-residual; session-liveness-helpers.mjs does not re-export
// it (this task's Touches is scoped to the production module + this test), so import it directly.
// sockOfDir/serverRegistryPath are the durable-registry primitives (gap-session-liveness-teardown-
// ol-scd-cf-leak) the catch-all tests write synthetic dead-owner entries with. isLiveTmuxPid is the
// cmdline-based liveness check (a SIGKILL'd server may linger as a ZOMBIE until init reaps it, and
// process.kill(pid,0) returns true for a zombie — so the dead-assertion must read /proc/cmdline).
import { serverPidViaPaneEnv, sockOfDir, serverRegistryPath, isLiveTmuxPid } from "../scripts/session-liveness-sweep.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

setProbeTmpPrefix("session-liveness-swp-");
after(() => { sessionLivenessAfter("session-liveness-swp-"); });

const noTmux = tmuxAvailable ? false : "tmux not installed";

test("AC4/AC3 — sweepTmp keeps a LIVE probe (owner session alive) and cleans owner-dead residue", { skip: noTmux }, async () => {
  const p = makeHermeticProbe("swp-ac4");
  const liveDir = p.tmp;
  // residue: the SAME prefix, but with NO live tmux owner (no server socket under it).
  // Created under probeRoot() (NOT os.tmpdir()) so sweepTmp — which scans probeRoot() — can
  // see it: under a namespaced round (QUAY_RUN_ID set) the two bases differ, and a residue in
  // os.tmpdir() would be invisible to the sweeper (round 126 AC4/AC3 wall-clock regression).
  const residue = fs.mkdtempSync(path.join(probeRoot(), "session-liveness-swp-"));
  fs.mkdirSync(path.join(residue, "sock"), { recursive: true });
  try {
    assert.ok(dirHasLiveOwner(liveDir),
      "the live probe's tmp dir must report a LIVE owner (tmux server socket under <dir>/sock)");
    assert.ok(!dirHasLiveOwner(residue),
      "the owner-dead residue dir must report NO live owner");
    sweepTmp("session-liveness-swp-");
    assert.ok(fs.existsSync(liveDir),
      "IN-USE instance must survive cleanup (owner session alive → not residue)");
    assert.ok(!fs.existsSync(residue),
      "owner-dead residue must be removed by cleanup");
  } finally {
    p.cleanup();
    try { fs.rmSync(residue, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("reapLiveOwners — kills THIS process's still-alive hermetic probe server and removes the dir (cancelled-test residue)", { skip: noTmux }, async () => {
  // The KNOWN-LOAD-SENSITIVE family can have a test CANCELLED mid-run, skipping its finally →
  // the probe's tmux server survives. sweepTmp skips live-owner dirs BY DESIGN, so it cannot
  // reclaim this class; reapLiveOwners (called from each file's after() before sweepTmp) is the
  // reaper for it. This test proves the reaper kills this process's OWN registered probe.
  const p = makeHermeticProbe("swp-reap");
  try {
    assert.ok(dirHasLiveOwner(p.tmp),
      "the probe dir must report a LIVE owner before the reaper");
    reapLiveOwners();
    assert.ok(!dirHasLiveOwner(p.tmp),
      "reapLiveOwners must kill the live owner server (socket no longer held by a live process)");
    assert.ok(!fs.existsSync(p.tmp),
      "reapLiveOwners must remove the reaped probe dir");
    // the reaper replaced the probe's own cleanup — cleanup() must stay safe/idempotent on a
    // reaped probe (a cancelled test's finally may still run if the node:test abort allows it).
    p.cleanup();
    assert.ok(true, "cleanup on a reaped probe must not throw");
  } finally {
    try { p.cleanup(); } catch { /* already reaped */ }
  }
});

test("serverPidOf — resolves the tmux SERVER daemon's PID via its socket inode, null once killed", { skip: noTmux }, async () => {
  // The hard-kill fallback in teardownProbe (gap-session-liveness-fixture-tmux-not-killed) relies on
  // serverPidOf to find the DETACHED server daemon's PID (PPID=1, no parent to reap it). Prove the
  // primitive: a live probe's socket resolves to a REAL tmux server pid (cmdline "tmux"), and after
  // a graceful kill-server it resolves to null (socket no longer held by a live process).
  const p = makeHermeticProbe("swp-pid");
  try {
    const pid = serverPidOf(p.tmp);
    assert.ok(Number.isInteger(pid) && pid > 1,
      `serverPidOf must resolve a live server to a pid > 1, got ${pid}`);
    let cmdline = "";
    try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0]; } catch { /* /proc race */ }
    assert.match(cmdline, /tmux/,
      `serverPidOf must resolve to the tmux SERVER process, got pid ${pid} cmdline "${cmdline}"`);
    p.cleanup();
    assert.equal(serverPidOf(p.tmp), null,
      "serverPidOf must be null once the server is killed (socket no longer held live)");
  } finally {
    try { p.cleanup(); } catch { /* already reaped */ }
  }
});

test("AC1 (ol-scd-d residual) — teardown kills the self-built SESSION's SERVER process, not just its socket/panes", { skip: noTmux }, async () => {
  // gap-session-liveness-teardown-ol-scd-d-residual: 7c755610 fixed the kill-server exit + orphaned
  // pane-child paths, but the ol-scd-d test STILL leaked its self-started tmux server. The residual
  // shape: a server that closes its LISTENING socket but is STILL ALIVE (hanging in its graceful-exit
  // path under suite load) is invisible to the socket-based serverPidOf/dirHasLiveOwner, so the
  // teardown killed the pane children but NOT the server (session). The fix resolves the server pid
  // from the pane children's inherited TMUX environ — which SURVIVES the socket close — so the
  // hard-kill can still reach it. This proves both halves: the fallback resolves the SAME server pid,
  // and after teardown the server PROCESS is dead (the leak-scan's pgrep predicate), not merely the
  // socket gone.
  const p = makeHermeticProbe("swp-srvsession");
  try {
    const serverPid = serverPidOf(p.tmp);
    assert.ok(Number.isInteger(serverPid) && serverPid > 1,
      `must resolve the tmux server pid before teardown, got ${serverPid}`);
    assert.equal(serverPidViaPaneEnv(p.tmp), serverPid,
      "serverPidViaPaneEnv must resolve the SAME server pid via the pane children's TMUX env (the socket-close-surviving fallback)");
    p.cleanup();
    let procAlive = true;
    try { process.kill(serverPid, 0); } catch { procAlive = false; }
    assert.equal(procAlive, false,
      `the tmux server process ${serverPid} must be DEAD after teardown (not just socket-closed — a hanging server is the leak)`);
    assert.equal(serverPidViaPaneEnv(p.tmp), null,
      "serverPidViaPaneEnv must be null once the server is dead (a dead server's cmdline is empty)");
  } finally {
    try { p.cleanup(); } catch { /* already reaped */ }
  }
});

test("AC1 (unified teardown) — a GHOST server (socket dir removed, socket-criteria blind) is found by cmdline discovery and SIGKILL'd, NOT orphaned by an unregister+rm", { skip: noTmux }, async () => {
  // gap-session-liveness-teardown-unified-kill-servers: the leak that red'ed the suite-tail
  // tmux-leak-scan. A server that closed/lost its listening socket is INVISIBLE to the socket-based
  // criteria — PROVEN here: after rmSync of the socket dir, serverPidOf=null + dirHasLiveOwner=false
  // while the server is STILL ALIVE. Without the cmdline discovery the teardown would treat it as
  // owner-dead, UNREGISTER the dir, and orphan the live server forever. serverPidsOfByCmdline finds
  // it via its own argv (which retains the socket path), and teardownProbe SIGKILLs it.
  const p = makeHermeticProbe("swp-ghost");
  try {
    const serverPid = serverPidOf(p.tmp);
    assert.ok(Number.isInteger(serverPid) && serverPid > 1,
      `must resolve the server pid before the socket is removed, got ${serverPid}`);
    // Remove the socket dir — the server stays alive but becomes invisible to socket-based lookup.
    fs.rmSync(p.tmp, { recursive: true, force: true });
    assert.equal(serverPidOf(p.tmp), null, "serverPidOf must be null once the socket is gone");
    assert.equal(dirHasLiveOwner(p.tmp), false, "dirHasLiveOwner must be false once the socket is gone");
    const ghosts = serverPidsOfByCmdline(p.tmp);
    assert.ok(ghosts.includes(serverPid),
      `cmdline discovery must find the still-alive ghost server ${serverPid}, got [${ghosts}]`);
    // teardownProbe (the enhanced teardown) must kill the ghost, not orphan it.
    teardownProbe(p.tmp);
    let alive = true;
    try { process.kill(serverPid, 0); } catch { alive = false; }
    assert.equal(alive, false,
      `the ghost server ${serverPid} must be DEAD after teardownProbe (cmdline discovery + SIGKILL)`);
    assert.equal(serverPidsOfByCmdline(p.tmp).length, 0,
      "no tmux process may still reference the ghost socket path after teardown");
  } finally {
    try { p.cleanup(); } catch { /* already reaped */ }
  }
});

test("AC1 (TRUE catch-all) — a self-built server is DURABLY registered, and killRegisteredServers kills it even when the in-memory registration is lost (the ol-scd-c/f 5b shape)", { skip: noTmux }, async () => {
  // gap-session-liveness-teardown-ol-scd-cf-leak: the 5b recurrence — teardownProbe can misjudge a
  // still-alive server owner-dead and UNREGISTER the in-memory Set entry, orphaning it forever (the
  // socket-invisible + cmdline-miss path that left ol-scd-c/f leaking past the whole suite). The
  // TRUE catch-all is a DURABLE registry written at server-creation: the record survives the
  // in-memory loss, so a registry-driven kill can always find the server. This test proves both
  // halves: the probe is durably recorded, and killRegisteredServers (which does NOT depend on the
  // in-memory Set) resolves and SIGKILLs the still-alive server.
  const p = makeHermeticProbe("swp-regkill");
  try {
    const serverPid = serverPidOf(p.tmp);
    assert.ok(Number.isInteger(serverPid) && serverPid > 1,
      `must resolve the server pid before the kill, got ${serverPid}`);
    // The durable registry must contain THIS process's entry for this probe dir (written at
    // creation by the tmux() seam). Do NOT call p.cleanup() — the point is to prove the durable
    // record + registry kill find the server regardless of in-memory state.
    const durable = readServerRegistry().filter((e) => e.dir === p.tmp && e.proc === process.pid);
    assert.ok(durable.length >= 1,
      `the probe dir must be durably registered, got ${JSON.stringify(durable)}`);
    const killed = killRegisteredServers({ proc: process.pid });
    const hit = killed.find((k) => k.dir === p.tmp);
    assert.ok(hit,
      `killRegisteredServers must find + kill this process's registered server via the durable registry, got ${JSON.stringify(killed)}`);
    // isLiveTmuxPid reads /proc/<pid>/cmdline — a SIGKILL'd server may linger as a ZOMBIE until init
    // reaps it (process.kill(pid,0) returns true for a zombie), but a dead/zombie server's cmdline
    // is empty, so isLiveTmuxPid is the correct dead-assertion.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && isLiveTmuxPid(serverPid)) { await sleep(50); }
    assert.equal(isLiveTmuxPid(serverPid), false,
      `the registered server ${serverPid} must be DEAD after killRegisteredServers`);
  } finally {
    try { p.cleanup(); } catch { /* already killed */ }
  }
});

test("AC1 (TRUE catch-all) — killRegisteredServers({ deadProcOnly: true }) kills a CRASHED-process server but NEVER an alive process's server (cross-run safety)", { skip: noTmux }, async () => {
  // gap-session-liveness-teardown-ol-scd-cf-leak: the process-crash hole — a test process that dies
  // before its after() hook loses its in-memory registry, so its server survives. The durable
  // registry survives; the pre-suite/legacy suite-tail kill uses deadProcOnly (kill only entries
  // whose OWNING TEST PROCESS is dead) so a CONCURRENT scoped run's ACTIVE server is never touched.
  // Two probes: A (real owner, alive) must SURVIVE deadProcOnly; B (synthetic dead-owner entry) must
  // be KILLED.
  const a = makeHermeticProbe("swp-dp-a");
  const b = makeHermeticProbe("swp-dp-b");
  try {
    const aPid = serverPidOf(a.tmp);
    const bPid = serverPidOf(b.tmp);
    assert.ok(Number.isInteger(aPid) && aPid > 1, "probe A server pid must resolve");
    assert.ok(Number.isInteger(bPid) && bPid > 1, "probe B server pid must resolve");
    // A dead owning-process pid (spawn + await exit — node reaps it, so process.kill(pid,0) → ESRCH).
    const dead = spawn("true");
    await new Promise((res) => dead.on("exit", res));
    const deadProcPid = dead.pid;
    // Synthetic crashed-owner entry for B's server (its real entry has proc=THIS process, alive).
    fs.appendFileSync(serverRegistryPath(),
      JSON.stringify({ dir: b.tmp, sock: sockOfDir(b.tmp), pid: bPid, proc: deadProcPid, runId: "", ts: Date.now() }) + "\n",
      "utf8");
    const killed = killRegisteredServers({ deadProcOnly: true });
    const killedB = killed.find((k) => k.dir === b.tmp);
    assert.ok(killedB, `deadProcOnly must kill the crashed-owner server, got ${JSON.stringify(killed)}`);
    assert.ok(!killed.some((k) => k.dir === a.tmp),
      `deadProcOnly must NOT kill the alive-owner server (cross-run safety), got ${JSON.stringify(killed)}`);
    // B's server must be dead (cmdline-based — a SIGKILL'd server may be a zombie until init reaps
    // it); A's server must still be a LIVE tmux server (isLiveTmuxPid true = not killed).
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && isLiveTmuxPid(bPid)) { await sleep(50); }
    assert.equal(isLiveTmuxPid(bPid), false,
      `the crashed-owner server ${bPid} must be DEAD after deadProcOnly`);
    assert.equal(isLiveTmuxPid(aPid), true,
      `the alive-owner server ${aPid} must SURVIVE deadProcOnly`);
  } finally {
    try { a.cleanup(); } catch { /* already reaped */ }
    try { b.cleanup(); } catch { /* already reaped */ }
  }
});

test("reapSpawnedChildren — SIGKILLs a leaked touch-loop child (cancelled-test finally skip)", { skip: noTmux }, async () => {
  // gap-session-liveness-teardown-unified-kill-servers: alongside the leaked servers, ONE leaked
  // touch-loop (startTouchLoop) survived 62min — a cancelled test skips the caller's
  // `toucher.kill("SIGKILL")`. startTouchLoop now REGISTERS its child; reapSpawnedChildren (part of
  // the unified sessionLivenessAfter) reaps it by child handle (never a name-based batch kill).
  const touchFile = path.join(probeRoot(), "session-liveness-swp-touch.jsonl");
  const t = startTouchLoop(touchFile);
  try {
    assert.ok(t.exitCode === null && t.signalCode === null, "the touch-loop must be running before the reaper");
    reapSpawnedChildren();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && (t.exitCode === null && t.signalCode === null)) { await sleep(50); }
    assert.ok(t.signalCode === "SIGKILL" || t.exitCode !== null,
      `the touch-loop must be reaped by reapSpawnedChildren, exitCode=${t.exitCode} signalCode=${t.signalCode}`);
  } finally {
    try { t.kill("SIGKILL"); } catch { /* already reaped */ }
  }
});

test("AC2/AC3 — sweepTmp does NOT kill a live session-liveness monitor process", { skip: noTmux }, async () => {
  const p = makeHermeticProbe("swp-mon");
  const mon = spawnMonitor(p.env, `inner ${p.tmp} ${p.session}`);
  try {
    assert.ok(await waitForRounds(mon, 2), "monitor must establish ≥2 rounds before cleanup");
    sweepTmp("session-liveness-swp-");
    assert.ok(await waitForRounds(mon, 4),
      "monitor must STILL emit rounds after sweepTmp (cleanup must never kill an in-use observer)");
  } finally {
    mon.child.kill("SIGKILL");
    p.cleanup();
  }
});

test("AC2 — the cleanup surface has no name-based batch kill of session-liveness", () => {
  // invariant no_pkill_by_name_on_live = 1: the cleanup code has no process-name batch kill of
  // session-liveness monitors.
  // The doc comment in the helper mentions the forbidden command (as a prohibition note) — a naive
  // whole-file grep would self-trip, so we scan the EXECUTABLE function bodies (brace-matched),
  // which are the cleanup path proper. sweepTmp/dirHasLiveOwner must be fs-only (no spawn, no
  // pkill/killall); tmux-leak-scan.sh is a READ-ONLY assertion (scans pgrep/ls, never kills).
  // dirHasLiveOwner + the two runner sweepers moved to the PRODUCTION sweep module (plugin/scripts/
  // session-liveness-sweep.mjs, gap-leak-residue-per-run-namespace-isolation — a runtime import from
  // the test helper broke build-plugin-dist), so scan BOTH: the helper for sweepTmp, the production
  // module for dirHasLiveOwner/sweepRunNamespaces/sweepRunNamespace. The TRUE-CATCH-ALL registry
  // (gap-session-liveness-teardown-ol-scd-cf-leak) is now the CLEANUP SURFACE too — the whole point
  // of killRegisteredServers is to kill leaked servers — so its registry/read/resolve/kill functions
  // are scanned for the same no-name-based-kill / no-spawn invariant (each kill is a PID-targeted
  // process.kill SIGKILL, resolved via /proc — never pkill/killall/spawn).
  const fnBodies = (src, names) => {
    const bodies = {};
    for (const name of names) {
      const start = src.indexOf(`export function ${name}`);
      assert.ok(start !== -1, `cleanup function ${name} must exist in scanned source`);
      let i = src.indexOf("{", start);
      let depth = 0;
      for (let j = i; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") { depth--; if (depth === 0) { bodies[name] = src.slice(i, j + 1); break; } }
      }
      assert.ok(bodies[name], `could not brace-match ${name}`);
    }
    return bodies;
  };
  const helper = fs.readFileSync(path.join(__dirname, "..", "test", "session-liveness-helpers.mjs"), "utf8");
  const sweepModule = fs.readFileSync(path.join(__dirname, "..", "scripts", "session-liveness-sweep.mjs"), "utf8");
  const helperBodies = fnBodies(helper, ["sweepTmp"]);
  const sweepBodies = fnBodies(sweepModule, ["dirHasLiveOwner", "sweepRunNamespaces", "sweepRunNamespace", "serverPidsOfByCmdline", "registerServer", "readServerRegistry", "resolveRegisteredServerPid", "killRegisteredServers", "isLiveTmuxPid", "isProcAlive", "sockOfDir", "serverRegistryPath"]);
  for (const body of [...Object.values(helperBodies), ...Object.values(sweepBodies)]) {
    assert.ok(!/(?:pkill|killall|spawnSync|spawn)\s*\(/.test(body),
      `cleanup executable body must not contain a name-based kill or process spawn (fs-only cleanup): ${body}`);
  }
  const scan = fs.readFileSync(path.join(__dirname, "..", "scripts", "tmux-leak-scan.sh"), "utf8");
  const code = scan.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.ok(!/(?:pkill|killall)/.test(code),
    "tmux-leak-scan.sh executable lines must not contain pkill/killall (read-only assertion)");
});

test("AC5 (candidate D) — a registered observer's death is detectable, not only via a passive Monitor failed", { skip: noTmux }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-swp-"));
  const registryCheck = path.join(__dirname, "..", "scripts", "observer-registry-check.sh");
  try {
    const p = makeHermeticProbe("swp-reg");
    const mon = spawnMonitor({ ...p.env, SESSION_ROOT: root }, `inner ${p.tmp} ${p.session}`, { register: true });
    try {
      assert.ok(await waitForRounds(mon, 2), "registered monitor must establish rounds");
      // the registry file must appear under <root>/.quay
      const regDir = path.join(root, ".quay");
      assert.ok(fs.existsSync(regDir), ".quay must exist once the observer registers itself");
      const regs = fs.readdirSync(regDir).filter((f) => f.startsWith("session-liveness."));
      assert.equal(regs.length, 1, `expected one registry file, got ${regs.join(",")}`);
      const regFile = path.join(regDir, regs[0]);
      const reg = JSON.parse(fs.readFileSync(regFile, "utf8"));
      assert.equal(reg.pid, mon.child.pid, "registry must record the monitor's own pid");
      assert.equal(reg.root, root, "registry must record the observed root");

      // while the observer is alive: the registry check reports NO dead instance (exit 0).
      const alive = spawnSync("bash", [registryCheck, root, "--json"], { encoding: "utf8" });
      assert.equal(alive.status, 0, `registry check must exit 0 while the observer is alive:\n${alive.stdout}${alive.stderr}`);
      const aliveJson = JSON.parse(alive.stdout);
      assert.equal(aliveJson.ok, true, `no death expected while alive:\n${alive.stdout}`);
      assert.deepEqual(aliveJson.dead, [], `no death expected while alive:\n${alive.stdout}`);

      // kill the monitor WITHOUT letting it unregister (SIGKILL cannot be trapped) — the shape of
      // the incident (an observer killed by a name-based cleanup, no chance to clean up after
      // itself). Its death must now be DETECTABLE via the registry, not only via a Monitor failed.
      mon.child.kill("SIGKILL");
      await sleep(250);
      const dead = spawnSync("bash", [registryCheck, root], { encoding: "utf8" });
      assert.notEqual(dead.status, 0,
        `registry check must FAIL (non-zero) once the observer is dead:\n${dead.stdout}${dead.stderr}`);
      assert.ok(/session-liveness\.\d+\.json/.test(dead.stderr),
        `the dead instance must be named in the report:\n${dead.stderr}`);
    } finally {
      try { mon.child.kill("SIGKILL"); } catch { /* already dead */ }
      p.cleanup();
    }
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
