// @test-group engine
// session-liveness-helpers.mjs — shared helpers for the session-liveness test family.
//
// Split out of session-liveness.test.mjs (2026-08-07, gap-session-liveness-tail-capped-split):
// the original 2125-line file was the lowconc phase's TAIL CAP — measured 211.4s wall-clock vs a
// 589.8s÷3 = 196.6s even-split floor at cc=3, so the lowconc phase could never drop below 211.4s
// no matter the concurrency. Splitting the one file into per-family files (events / heartbeat /
// signals) lets cc=3 run them in PARALLEL, so the phase returns to the floor. Shared helpers live
// here so every split file resolves the SAME session-liveness.sh surface (the quay-init-loop split
// pattern, quay-init-loop-helpers.mjs).
//
// SPLIT CONCURRENCY SAFETY (the one non-mechanical change): the split files run as SEPARATE node
// processes at cc=3, and each file's after() sweep must NOT remove another file's ACTIVE hermetic
// probe tmpdir (a sweep of /tmp/session-liveness-* while a sibling file is mid-`makeHermeticProbe`
// would delete its tmux socket + fixtures → spurious failures). Each test file therefore calls
// `setProbeTmpPrefix("<file-specific>")` at the top; the probe constructors read that prefix and
// each file's after() sweeps only its OWN prefix. The test BODIES are byte-identical to the
// original — only their file placement changed.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

// STAGE 1 (gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe): this helper isolated by
// TMUX_TMPDIR + deleting $TMUX but had NO explicit `-S`. Route the hermetic path through the
// tmux-session library so BOTH conditions are structural (explicit -S + $TMUX stripped). The real
// probe path (env === process.env, targeting the manager box's REAL quay-0 session) deliberately
// keeps the default-socket resolution — it never starts/kills a server.
import { tmux as isolatedTmux } from "../scripts/tmux-session.ts";
// RUNTIME per-run namespace sweep functions (gap-leak-residue-per-run-namespace-isolation):
// full-suite-runner.ts imports them directly, so they MUST live in a PRODUCTION module
// (plugin/scripts/session-liveness-sweep.mjs — shipped in the npm-pack bundle), NOT here:
// package.sh excludes plugin/test/ from the bundle, so a runner→test-helper import broke
// build-plugin-dist (round 123/124 real regression). This helper RE-EXPORTS them so the
// session-liveness test family keeps resolving the same names (single source of truth).
import {
  runIdOf, runNamespaceRoot, dirHasLiveOwner, serverPidOf, panePidsOf,
  sweepRunNamespaces, sweepRunNamespace, serverPidsOfByCmdline,
  registerServer, killRegisteredServers, readServerRegistry,
} from "../scripts/session-liveness-sweep.mjs";
export { runIdOf, runNamespaceRoot, dirHasLiveOwner, serverPidOf, panePidsOf, sweepRunNamespaces, sweepRunNamespace, serverPidsOfByCmdline, registerServer, killRegisteredServers, readServerRegistry };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPT = path.resolve(__dirname, "..", "scripts", "session-liveness.sh");
export const PROBE_TARGET = "quay-0:probe"; // the manager's real, dedicated probe session

// ── per-file hermetic tmp isolation ─────────────────────────────────────────────
// Each split file owns a DISTINCT prefix so its after() sweep can never delete a
// sibling file's active probe dir (see the SPLIT CONCURRENCY SAFETY note above).
//
// PER-RUN NAMESPACE (gap-leak-residue-per-run-namespace-isolation, 2026-08-13): the probe
// tmp ROOT is `os.tmpdir()` UNLESS the runner delivered QUAY_RUN_ID — then every probe lives
// under `/tmp/quay-run-<runId>/`, a per-run namespace so the suite-tail tmux-leak-scan has a
// subtree to scan ("本轮创建的东西 = 一棵子树") and cross-run residue is never misattributed
// (AC4 negative control). The runner's unified cleanup then has a PATH-OWNERSHIP +
// OWNER-LIVENESS criterion (dirHasLiveOwner) instead of the forbidden name-based kill
// (invariant no_pkill_by_name_on_live = 1). A probe's dir is `<runRoot>/<prefix>XXXXXX`
// (mkdtemp), so the file-granularity isolation (one prefix per split file) is preserved
// INSIDE the namespace. When QUAY_RUN_ID is unset (a scoped `--for-task` run, a direct file
// run, a legacy caller) the legacy `<os.tmpdir()>/<prefix>` root is used — byte-for-behavior
// the pre-namespace layout, so existing tests that create residue directly under /tmp keep
// their sweep semantics.
let probeTmpPrefix = "session-liveness-";
export function setProbeTmpPrefix(p) { probeTmpPrefix = p; }
export function probeTmpPrefixOf() { return probeTmpPrefix; }

/** The base directory probes are created under: the per-run namespace when QUAY_RUN_ID is
 * set, else the legacy os.tmpdir(). The namespace dir is created on first use.
 * (runIdOf/runNamespaceRoot are imported+re-exported from the production sweep module above.)
 * Exported so sweepTmp callers can create residue in the SAME base the sweeper scans (AC4/AC3
 * in session-liveness-sweep.test.mjs: a residue created under os.tmpdir() is invisible to
 * sweepTmp when the runner namespaced the run — the round 126 wall-clock regression). */
export function probeRoot() {
  const root = runNamespaceRoot();
  if (root === null) return os.tmpdir();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

// ── sweepTmp / dirHasLiveOwner — CLEANUP is OWNER-LIVENESS-based, never name-based (AC2/AC3/AC4
//    of gap-sweeptmp-pkill-kills-live-observers-two-layer-blind) ───────────────────────────────────
//
// 2026-08-08 incident: a cleanup ran a process-name batch kill of the session-liveness monitor
// processes (outer + manager) and killed them all — the two layers went blind simultaneously and
// the observers' own deaths had no observer. Root cause: the cleanup distinguished "leak residue"
// from "in-use instance" by PROCESS-NAME/PATH matching instead of OWNER-SESSION LIVENESS. A
// session-liveness process whose owner session is alive is IN-USE, not residue; name-based batch
// kills necessarily kill live monitors.
//
// THE RULES ENFORCED HERE (pinned by the AC2/AC4 sweep tests in session-liveness-sweep.test.mjs):
//   * sweepTmp NEVER kills processes — it only removes /tmp DIRECTORIES under the caller's own
//     test prefixes, and only those with NO live owner.
//   * A name-based batch kill of the session-liveness monitor (process-name `pkill` / `killall`)
//     is FORBIDDEN in the cleanup path (invariant no_pkill_by_name_on_live = 1 — the sweep test
//     scans the executable bodies for it).
//   * The residue-vs-in-use criterion is OWNER LIVENESS (dirHasLiveOwner), NOT name/path prefix.
// dirHasLiveOwner is IMPORTED + re-exported from plugin/scripts/session-liveness-sweep.mjs above.

// sweepTmp(...prefixes) — remove leftover probe dirs under the given prefixes (the suite-tail
// tmux-leak-scan's /tmp class). Each split test file's after() calls this with its OWN prefixes.
// The scanned base is `probeRoot()` — the per-run namespace root when QUAY_RUN_ID is set, else
// os.tmpdir() — so the after() sweep can never delete a sibling file's active probe dir (they
// use a DIFFERENT prefix) NOR a different run's namespace (they live under a different
// /tmp/quay-run-<runId>/ subtree — AC4 cross-run isolation).
// OWNER-LIVENESS GUARD (gap-sweeptmp-...): a dir with a LIVE owner (a tmux server holding a socket
// under it = an in-use hermetic probe) is SKIPPED — only owner-dead residue is removed. NEVER kills
// processes; NEVER pkill by name.
export function sweepTmp(...prefixes) {
  let entries = [];
  try { entries = fs.readdirSync(probeRoot()); } catch { return; }
  for (const name of entries) {
    if (!prefixes.some((p) => name.startsWith(p))) continue;
    const abs = path.join(probeRoot(), name);
    let isDir = false;
    try { isDir = fs.statSync(abs).isDirectory(); } catch { continue; }
    if (isDir && dirHasLiveOwner(abs)) continue; // owner session ALIVE → in-use, never clean
    try { fs.rmSync(abs, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// ── runner-level unified cleanup (gap-leak-residue-per-run-namespace-isolation AC2/AC3) ──────────────
// The runner calls `sweepRunNamespaces()` BEFORE the suite (and `sweepRunNamespace(ownId)` AFTER it,
// for its own subtree). The criterion is PATH OWNERSHIP (the /tmp/quay-run-* subtree) + OWNER
// LIVENESS (dirHasLiveOwner) — NEVER a process-name/path-prefix batch kill (invariant
// no_pkill_by_name_on_live = 1, the 2026-08-08 two-layer-blind incident). A namespace dir whose
// tmux server is STILL alive (a genuinely leaked, still-running probe) is SKIPPED — it is in-use,
// not residue (the same rule sweepTmp enforces). Both functions are fs-only (no spawn, no pkill),
// matching the sweepTmp/dirHasLiveOwner executable-body contract the sweep test pins. Returns
// { cleaned, dirs } so the runner can record the count + WHICH dirs into the verification-round
// record (AC3 — the leak is an observable metric, never a silently-cleared signal).
// sweepRunNamespaces/sweepRunNamespace are IMPORTED + re-exported from
// plugin/scripts/session-liveness-sweep.mjs above (single source of truth).

// ── hermetic-probe residue reaper (gap-session-liveness-cancelled-test-skips-finally) ──────────
// KNOWN-LOAD-SENSITIVE: under suite load a hermetic-probe test can be CANCELLED mid-run by
// node:test (the KNOWN-LOAD-SENSITIVE note in each split file documents this), which SKIPS the
// test's `finally { p.cleanup() }` → the probe's tmux server keeps running and its /tmp dir keeps
// its socket. sweepTmp skips live-owner dirs BY DESIGN (it must never kill an in-use sibling
// probe), so it cannot reclaim this class — the suite-tail tmux-leak-scan reds on it (round-254
// empirical: `ol-d3sym` leaked by a cancelled test under load 9.05).
//
// Each hermetic probe constructor REGISTERS its tmpdir here (process-local — a Set of absolute
// dir paths). `reapLiveOwners()` — called from each session-liveness file's after() BEFORE
// sweepTmp — kills still-alive servers for THIS process's OWN registered probes (never a sibling
// process's: the registry is per-process, so the SPLIT CONCURRENCY SAFETY and the cross-actor
// safety both hold by construction). The kill is `kill-server` on the STRUCTURALLY ISOLATED
// private socket (<dir>/sock/tmux-<uid>/default — TMUX_TMPDIR=<dir>/sock): a per-probe mkdtemp,
// so it can only kill THIS probe's server, never the real quay-0/archguard-2/meta-cc-4 sessions.
// (The repo-wide "never kill-server" rule is about a SHARED/UNKNOWN socket, whose kill-server
// blast radius is every session on that server; the private socket is the isolation that makes it
// safe — the same principle tmux-isolated.sh states for the "most dangerous command". Never pkill
// by name.) The dir is removed once its owner server is gone.
const __liveProbeTmpDirs = new Set();
export function __registerProbeTmp(tmp) { __liveProbeTmpDirs.add(tmp); }
export function __unregisterProbeTmp(tmp) { __liveProbeTmpDirs.delete(tmp); }

// ── leaked CHILD-process reaper (gap-session-liveness-teardown-unified-kill-servers) ──────────
// A cancelled hermetic-probe test skips its `finally`, so its spawned CHILD processes — the monitor
// (session-liveness.sh, spawnMonitor) and the transcript touch-loop (startTouchLoop) — survive too.
// They are NOT tmux servers (sweepTmp/reapLiveOwners do not cover them) and nothing else kills them
// → they accumulate across runs. Each constructor REGISTERS its child here (process-local Set of
// ChildProcess objects); `reapSpawnedChildren()` — called from the unified after() teardown BEFORE
// sweepTmp — SIGKILLs any STILL-RUNNING registered child (child.exitCode === null ⇒ not yet exited,
// so a pid REUSED after a normal exit is never killed). Never a name-based batch kill (invariant
// no_pkill_by_name_on_live = 1): the kill is per-child-handle, scoped to THIS process's own spawns.
const __liveChildProcs = new Set();
export function __registerChildProc(child) { __liveChildProcs.add(child); }
export function __unregisterChildProc(child) { __liveChildProcs.delete(child); }
export function reapSpawnedChildren() {
  for (const child of [...__liveChildProcs]) {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    } catch { /* already dead */ }
  }
  __liveChildProcs.clear();
}

// killProbeServer(abs) — kill ONE registered probe's tmux SERVER (kill-server) on its private
// socket. The definitive cleanup: the server exits regardless of its session/window state, so a
// fixture can never leave a live server behind (a live server pins the dir as owner-live, and
// sweepTmp would skip it forever — the leak-with-no-exit class this task closes).
export function killProbeServer(abs) {
  const sockDir = path.join(abs, "sock");
  const env = isolateTmuxEnv(sockDir);
  tmux(["kill-server"], env);
}

// killProbeServers() — after()-callable 判据1 (gap-session-liveness-fixture-tmux-not-killed):
// kill-server every still-alive private tmux server THIS process created. The session-liveness
// test files' after() calls this BEFORE reapLiveOwners/sweepTmp, so the hermetic fixture never
// leaks a tmux server (sweepTmp's owner-liveness guard — AC3 — is kept; it is not the fixture's
// cleanup). Does NOT remove dirs — reapLiveOwners removes them once the owners are dead.
export function killProbeServers() {
  for (const abs of [...__liveProbeTmpDirs]) {
    if (dirHasLiveOwner(abs)) killProbeServer(abs);
  }
}

// teardownProbe(abs) — the deterministic probe teardown shared by every hermetic-probe
// constructor's cleanup() AND reapLiveOwners(). kill-server FIRST (kill-session alone races server
// teardown under load), then RETRY until the owner actually dies (bounded) BEFORE unregistering:
// a still-alive server stays registered so after()'s reapLiveOwners() can retry it. This honors
// the "probe stays registered until the server is dead" contract that the cleanup() comment always
// stated but the code violated — cleanup() unregistered IMMEDIATELY after a single fire-and-forget
// kill-server, so a server whose kill raced/failed under suite load survived UNREACHABLE by the
// reaper (leak-with-no-exit; 2026-08-18 full-suite red: the ol-scd-c probe's server outlived the
// whole main phase and red'ed the suite-tail tmux-leak-scan). Retrying until the owner dies does
// NOT weaken the leak gate — a server nobody can kill never clears within the bound. Idempotent on
// an already-reaped probe (reapLiveOwners may have removed it first).
const PROBE_TEARDOWN_KILL_WAIT_MS = 10000;
export function teardownProbe(abs) {
  const deadline = Date.now() + PROBE_TEARDOWN_KILL_WAIT_MS;
  while (dirHasLiveOwner(abs) && Date.now() < deadline) {
    killProbeServer(abs);
    // Wait for the server to actually exit before re-killing (a sync wait via Atomics — no extra
    // process spawn in the cleanup path); re-kill only if it is STILL alive after the sub-wait.
    const sub = Date.now() + 500;
    while (Date.now() < sub && dirHasLiveOwner(abs)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  // HARD-KILL FALLBACK (gap-session-liveness-fixture-tmux-not-killed): a graceful `kill-server`
  // can race/fail under suite load, and the tmux server is a DETACHED daemon (PPID=1) — nobody
  // reaps it if the client-side kill never lands, so it survives the whole run and reds the
  // suite-tail tmux-leak-scan. Escalate to a DIRECT SIGKILL of the server's own PID (resolved via
  // its socket inode, serverPidOf) — a PID-targeted kill, NOT a name-based batch kill (invariant
  // no_pkill_by_name_on_live = 1). SIGKILL cannot be ignored, so this closes the orphan window.
  if (dirHasLiveOwner(abs)) {
    const pid = serverPidOf(abs);
    if (pid !== null && pid !== process.pid) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      const hard = Date.now() + PROBE_TEARDOWN_KILL_WAIT_MS;
      while (dirHasLiveOwner(abs) && Date.now() < hard) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  }
  // GHOST-SERVER DISCOVERY (gap-session-liveness-teardown-unified-kill-servers): a server that
  // closed its listening socket, lost its pane children (SIGHUP), and missed the pid cache is
  // INVISIBLE to dirHasLiveOwner/serverPidOf — PROVEN: after the socket dir is removed,
  // dirHasLiveOwner=false + serverPidOf=null while the server is STILL ALIVE (its cmdline retains
  // the socket path). Without this scan the teardown would hit the `!dirHasLiveOwner(abs)` branch
  // below, UNREGISTER the dir, and leave the live server orphaned forever — the leak that red'ed
  // the suite-tail tmux-leak-scan (ol-gap4/ol-scd-a/ol-subagent/tgt + a touch-loop, 62min). The
  // cmdline scan finds the server via its own argv (PID-targeted SIGKILL, never a name-based batch
  // kill — invariant no_pkill_by_name_on_live = 1). Run ONLY when the owner is invisible to the
  // socket/cache/pane-env checks — a visible owner is handled by the kill-loop + hard-kill above,
  // so a normal teardown never pays the /proc cmdline scan.
  let ghosts = [];
  if (!dirHasLiveOwner(abs)) {
    ghosts = serverPidsOfByCmdline(abs);
    for (const pid of ghosts) {
      if (pid === process.pid) continue;
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
    if (ghosts.length > 0) {
      // Bounded wait for the SIGKILL to land before re-evaluating the unregister decision.
      const ghostWait = Date.now() + 2000;
      while (Date.now() < ghostWait && serverPidsOfByCmdline(abs).length > 0) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
      ghosts = serverPidsOfByCmdline(abs); // re-read after the wait
    }
  }
  // Only unregister + remove once the owner is ACTUALLY dead — judged by BOTH the visibility
  // criterion (dirHasLiveOwner) AND the cmdline discovery (no tmux process still references the
  // socket path). If it survived even the hard kill (uninterruptible sleep / unreadable /proc),
  // LEAVE it registered so after()'s reapLiveOwners() can retry — the "probe stays registered
  // until the server is dead" contract, never orphan an unreachable live server.
  if (!dirHasLiveOwner(abs) && ghosts.length === 0) {
    // Kill the pane CHILDREN (the `exec -a claude-probe sleep 10000` fixtures) that survived the
    // server's death carrying TMUX/TMUX_TMPDIR in their inherited environ. PID-targeted SIGKILL,
    // never a name-based batch kill (invariant no_pkill_by_name_on_live = 1). Without this the
    // orphaned children accumulate (200+ observed → suite-wide load red'ing the load-sensitive
    // family) even though the dir itself is now swept (dirHasLiveOwner is socket-primary).
    for (const pid of panePidsOf(abs)) {
      if (pid === process.pid) continue;
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
    __unregisterProbeTmp(abs);
    try { fs.rmSync(abs, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

export function reapLiveOwners() {
  for (const abs of [...__liveProbeTmpDirs]) {
    teardownProbe(abs);
  }
}

// ── UNIFIED after() teardown (gap-session-liveness-teardown-unified-kill-servers) ──────────────
// Every session-liveness test file's after() hook calls THIS one shared cleanup, so the teardown
// surface is a SINGLE code path (not 12 divergent per-file hooks that drift — the 5b shape: the
// ol-scd-d point fix covered one path and ol-gap4/ol-scd-a/ol-subagent/tgt still leaked). It
// systematically clears the SET of everything a test process self-built:
//   1. killProbeServers()  — kill-server on every registered live probe's private socket.
//   2. reapLiveOwners()    — retry + hard-kill + ghost-cmdline-discovery, then remove dead dirs.
//   3. reapSpawnedChildren() — SIGKILL leaked monitors + touch-loops (cancelled-test finally skip).
//   4. sweepTmp(...)       — remove owner-dead residue dirs under the file's OWN prefixes.
// Files pass their OWN /tmp prefixes so the sweep never touches a sibling file's active probe
// (SPLIT CONCURRENCY SAFETY: each split file owns a distinct prefix).
export function sessionLivenessAfter(...prefixes) {
  // TRUE CATCH-ALL (gap-session-liveness-teardown-ol-scd-cf-leak): the durable-registry kill FIRST.
  // The in-memory Set below can lose an entry (teardownProbe unregisters a dir it misjudges
  // owner-dead while the server is still alive — the 5b recurrence that leaked ol-scd-c/f), but the
  // durable record — written at server-creation — survives, so this pass kills by the registry
  // regardless of the in-memory state. Scoped to THIS process (proc filter) so a sibling file's
  // active server is never touched (SPLIT CONCURRENCY SAFETY: each split file is a separate process).
  killRegisteredServers({ proc: process.pid });
  // 判据1 (gap-session-liveness-fixture-tmux-not-killed): kill-server 本进程创建的 tmux server —
  // sweepTmp 的 owner-liveness 保护（AC3）只跳过活 owner 目录，夹具不 kill ⇒ 泄漏无出口。
  killProbeServers();
  reapLiveOwners();
  reapSpawnedChildren();
  sweepTmp(...prefixes);
}

// ── availability guards ───────────────────────────────────────────────────────────
export const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

export const realProbeAvailable = (() => {
  if (!tmuxAvailable) return false;
  return paneHasClaudeChild(process.env, PROBE_TARGET);
})();

// ── helpers ────────────────────────────────────────────────────────────────────────

export function md5(s) {
  return createHash("md5").update(s).digest("hex").slice(0, 16);
}

export function tmux(args, env) {
  const e = env ?? process.env;
  // Hermetic path (env carries TMUX_TMPDIR): force the explicit `-S` to the socket tmux materializes
  // for that TMUX_TMPDIR — `<sockDir>/tmux-<uid>/default` — plus the library's $TMUX strip. BOTH
  // conditions, structural (a bare `tmux` here under an inherited $TMUX would land on the DEFAULT
  // server — the 2026-08-06 fifth-wipe crash path).
  if (e.TMUX_TMPDIR) {
    const sock = path.join(e.TMUX_TMPDIR, `tmux-${process.getuid()}`, "default");
    // tmux refuses to create the socket when its parent dir is absent (exit 0 with "error
    // creating ... (No such file or directory)") — pre-create it, matching the other hermetic
    // helpers' 0o700 socket-base dirs.
    fs.mkdirSync(path.dirname(sock), { recursive: true, mode: 0o700 });
    const r = isolatedTmux(args, { socket: sock, env: e });
    // AUTO-REGISTER a self-built tmux SERVER created OUTSIDE makeHermeticProbe (e.g. a test that
    // calls `tmux(["new-session", …], env)` directly — the events test's ol-cold/ol-env). The probe
    // dir is TMUX_TMPDIR's parent (<dir>/sock → <dir>), the same layout makeHermeticProbe uses, so
    // the unified after()'s reapLiveOwners() can kill this server too. Registration is idempotent
    // (Set) and only on SUCCESS — a failed new-session never starts a server.
    if (args[0] === "new-session" && r.status === 0) {
      const dir = path.dirname(e.TMUX_TMPDIR);
      __registerProbeTmp(dir);
      // TRUE CATCH-ALL (gap-session-liveness-teardown-ol-scd-cf-leak): durably register EVERY
      // self-built server at the moment of creation. The in-memory Set alone can lose an entry
      // (teardownProbe unregisters a dir it misjudges owner-dead while the server still lives — the
      // 5b recurrence that leaked ol-scd-c/f), and a crashed process loses the whole Set. The durable
      // record survives both, so after() and the suite-tail scan-kill can always find the server.
      registerServer(dir);
    }
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }
  // Real-probe path (env === process.env, targeting the manager box's REAL probe session): preserve
  // the existing default-socket resolution. These are capture/send-keys on an EXISTING session —
  // they never create or kill a server, so there is no crash surface here.
  const r = spawnSync("tmux", args, { encoding: "utf8", env: e });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// isolateTmuxEnv: point bare `tmux` at a PRIVATE server socket, so the monitor and the probe
// setup can never resolve to the real quay-0 / archguard-2 / meta-cc-4 sessions.
export function isolateTmuxEnv(sockDir) {
  const env = { ...process.env, TMUX_TMPDIR: sockDir };
  delete env.TMUX;
  return env;
}

// isClaudePid — replicate session_pid()'s claude test: a process IS claude by its NAME, not by a
// whole-cmdline grep (which would match a ".claude" path substring in a non-claude child's args —
// gap-session-liveness-session-pid-blind-to-claude-as-pane-process false-positive dimension).
// Two name sources, matching the script's _is_claude_pid():
//   1. /proc/<pid>/comm (process name) starts with "claude";
//   2. argv[0] (first NUL field of cmdline)'s basename contains "claude" (covers `exec -a
//      claude-probe sleep …` probes whose comm is "sleep"). Never greps the whole cmdline.
export function isClaudePid(pid) {
  try {
    const comm = fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    if (comm.startsWith("claude")) return true;
    const argv0 = (fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0] || "").trim();
    const base = argv0.split("/").pop() || "";
    if (base.includes("claude")) return true;
  } catch {
    /* /proc unreadable — not claude */
  }
  return false;
}

// paneHasClaudeChild — replicate session_pid(): the pane's OWN foreground process (pane_pid, the
// claude-as-pane-process case) OR any direct child of it is a claude process. NOT `pgrep -f`
// (handoff rule 3: it would match this very command).
export function paneHasClaudeChild(env, session) {
  const p = tmux(["list-panes", "-t", session, "-F", "#{pane_pid}"], env);
  if (p.status !== 0 || !p.stdout.trim()) return false;
  const panePid = p.stdout.trim();
  if (isClaudePid(panePid)) return true; // pane foreground process IS claude
  const kids = spawnSync("pgrep", ["-P", panePid], { encoding: "utf8" });
  for (const k of (kids.stdout ?? "").trim().split("\n").filter(Boolean)) {
    if (isClaudePid(k)) return true;
  }
  return false;
}

// ── load-robustness budget (gap-session-liveness-wall-clock-budget-false-positives, 2026-08-12;
//    gap-session-liveness-hangguard-ms-timeout, 2026-08-18) ─────────────────────────────────────
// A wait budget here is a HANG-GUARD, never a correctness criterion. Under suite load the real
// polling loop (session-liveness.sh sleep $INTERVAL) + real tmux + process spawn slow down — events
// arrive after a tight wall-clock budget → false red. The product isn't broken; the measurement
// window is too narrow. Every wait helper below polls a REAL signal (a marker line in the monitor's
// stdout, the round counter, a /proc liveness probe) and uses the budget only as an upper cap so a
// genuinely hung monitor still fails — slow-but-correct passes, hung-but-wrong still fails. A
// caller's explicit budget is CLAMPED UP to this floor (Math.max), so a tight literal can never
// reintroduce a false red (hard-rule-4-corollary-2: widen generously).
//
// 2026-08-18 (gap-session-liveness-hangguard-ms-timeout): the fixed 60_000 floor was "deliberately
// loose" in isolation but broke under the overlap phase — 16 concurrent test files saturate the
// 16-core host, and session-liveness.sh (≥2 node --experimental-strip-types subprocesses per round
// + tmux/git/proc scans) is CPU-starved to ≈20s/round, so 4 rounds exceeded 60s and the AC3 负控制
// false-hung (commit 43153e58). A fixed 180_000 literal would repeat the same mistake on the NEXT
// bigger host — its adequacy depends on host parallelism (hard-rule-4-corollary-2: a timeout whose
// reasonableness depends on machine spec must READ the host, not hardcode a literal). So the floor
// scales with os.availableParallelism(): the measured ≈20s/round at 16 cores is ≈1.25s/core/round,
// the deepest wait in this family is 4 rounds, and a ≈2.4× margin yields ~12s/core — 16 cores ⇒ 192s
// (≥ the 180s the suite-fix measured sufficient, ≥ the ~80s measured need), while a small host keeps
// the original 60s floor so a genuinely hung monitor still fails promptly.
const HOST_PARALLELISM = (() => {
  try { return os.availableParallelism(); } catch { /* node < 18.14 */ }
  return os.cpus().length || 1;
})();
export const HANG_GUARD_MS = Math.max(60_000, HOST_PARALLELISM * 12_000);
function hangGuard(ms) { return Math.max(ms ?? HANG_GUARD_MS, HANG_GUARD_MS); }

export async function waitForAlive(env, session, timeoutMs = HANG_GUARD_MS) {
  const deadline = Date.now() + hangGuard(timeoutMs);
  while (Date.now() < deadline) {
    if (paneHasClaudeChild(env, session)) return true;
    await sleep(100);
  }
  return paneHasClaudeChild(env, session);
}

// makeHermeticProbe(session) — a private tmux server + a pane whose shell owns a claude-cmdline
// child: a real `sleep` process with argv[0]="claude-probe", i.e. /proc cmdline = "claude-probe
// 10000". This is a process-detection stand-in, NOT a fake TUI: GONE/BACK/STALL/OVERDUE do not
// depend on TUI redraw, so a real TUI is not needed for them (only the busy criterion in test A is
// redraw-based and uses the real session).
//
// WIDE PANE (-x 200 -y 50, split-split 2026-08-07): the busy-shape judgment (classifyPaneState,
// ruling D) matches /esc to interrupt/ against the STATUS AREA. In a default 80-col detached tmux
// pane the long shell prompt + "esc to interrupt" WRAPS across lines ("esc to interr\nupt"), so
// the contiguous regex misses it and makePaneBusy→SESSION-RESUMED never fires (pre-existing
// isolated failure, gap-session-liveness-tail-capped-split). Pinning the pane size makes the busy
// text fit one line regardless of the tmux server's default size — deterministic hermetic busy
// detection. Process-detection tests are unaffected (they don't read pane dimensions).
export function makeHermeticProbe(session) {
  const tmp = fs.mkdtempSync(path.join(probeRoot(), probeTmpPrefix));
  __registerProbeTmp(tmp);
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  const newS = tmux(["new-session", "-d", "-x", "200", "-y", "50", "-s", session, "bash"], env);
  assert.equal(newS.status, 0, `tmux new-session failed: ${newS.stderr}`);
  tmux(["send-keys", "-t", session, "exec -a claude-probe sleep 10000 &"], env);
  tmux(["send-keys", "-t", session, "Enter"], env);
  return {
    tmp,
    env,
    session,
    cleanup() {
      // 判据1/AC1: kill the SERVER (kill-server, private socket) FIRST — kill-session alone races
      // server teardown under load and can leave a live server that is already-unregistered ⇒
      // unreachable by after()'s reapLiveOwners (leak-with-no-exit, 2026-08-14 full-suite red).
      // teardownProbe RETRIES kill-server until the owner dies BEFORE unregistering, so the probe
      // stays registered until the server is dead and after() can retry if interrupted.
      teardownProbe(tmp);
    },
  };
}

// makePlainPane(session) — a private tmux server + a bare bash pane with NO claude process at all.
// Used by the false-positive control (B3): a pane whose only child carries a ".claude" path in its
// cmdline must NOT be reported as a claude session.
export function makePlainPane(session) {
  const tmp = fs.mkdtempSync(path.join(probeRoot(), probeTmpPrefix));
  __registerProbeTmp(tmp);
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  const newS = tmux(["new-session", "-d", "-x", "200", "-y", "50", "-s", session, "bash"], env);
  assert.equal(newS.status, 0, `tmux new-session failed: ${newS.stderr}`);
  return {
    tmp,
    env,
    session,
    cleanup() {
      // 判据1/AC1: kill the SERVER (kill-server, private socket) FIRST — kill-session alone races
      // server teardown under load and can leave a live server that is already-unregistered ⇒
      // unreachable by after()'s reapLiveOwners (leak-with-no-exit, 2026-08-14 full-suite red).
      // teardownProbe RETRIES kill-server until the owner dies BEFORE unregistering, so the probe
      // stays registered until the server is dead and after() can retry if interrupted.
      teardownProbe(tmp);
    },
  };
}

// makeClaudePaneProcess(session) — a pane whose FOREGROUND process (pane_pid) IS a claude process:
// `exec -a claude-probe sleep 10000` REPLACES the pane's shell (no `&`, no child) — the exact
// claude-as-pane-process shape of the 3-window topology (pane cmdline IS claude; its only children
// would be MCP servers). The old session_pid grepped CHILDREN for "claude" and missed this shape →
// alive=0 always (gap-session-liveness-session-pid-blind-to-claude-as-pane-process).
export function makeClaudePaneProcess(session) {
  const tmp = fs.mkdtempSync(path.join(probeRoot(), probeTmpPrefix));
  __registerProbeTmp(tmp);
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  const newS = tmux(["new-session", "-d", "-x", "200", "-y", "50", "-s", session, "bash"], env);
  assert.equal(newS.status, 0, `tmux new-session failed: ${newS.stderr}`);
  tmux(["send-keys", "-t", session, "exec -a claude-probe sleep 10000"], env);
  tmux(["send-keys", "-t", session, "Enter"], env);
  return {
    tmp,
    env,
    session,
    cleanup() {
      // 判据1/AC1: kill the SERVER (kill-server, private socket) FIRST — kill-session alone races
      // server teardown under load and can leave a live server that is already-unregistered ⇒
      // unreachable by after()'s reapLiveOwners (leak-with-no-exit, 2026-08-14 full-suite red).
      // teardownProbe RETRIES kill-server until the owner dies BEFORE unregistering, so the probe
      // stays registered until the server is dead and after() can retry if interrupted.
      teardownProbe(tmp);
    },
  };
}

// makeTwoWindowSession(session) — a private tmux server with named windows "outer" and "inner"
// (the 3-window topology's role windows). Used by B4 to prove per-role target resolution: a
// window-suffixed SESSION_TMUX_SESSION (quay-0:inner) must target THAT window, not the default
// :outer window.
export function makeTwoWindowSession(session) {
  const tmp = fs.mkdtempSync(path.join(probeRoot(), probeTmpPrefix));
  __registerProbeTmp(tmp);
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  const newS = tmux(["new-session", "-d", "-x", "200", "-y", "50", "-s", session, "-n", "outer", "bash"], env);
  assert.equal(newS.status, 0, `tmux new-session failed: ${newS.stderr}`);
  const newW = tmux(["new-window", "-t", session, "-n", "inner", "bash"], env);
  assert.equal(newW.status, 0, `tmux new-window failed: ${newW.stderr}`);
  return {
    tmp,
    env,
    session,
    cleanup() {
      // 判据1/AC1: kill the SERVER (kill-server, private socket) FIRST — kill-session alone races
      // server teardown under load and can leave a live server that is already-unregistered ⇒
      // unreachable by after()'s reapLiveOwners (leak-with-no-exit, 2026-08-14 full-suite red).
      // teardownProbe RETRIES kill-server until the owner dies BEFORE unregistering, so the probe
      // stays registered until the server is dead and after() can retry if interrupted.
      teardownProbe(tmp);
    },
  };
}

// paneSelfIsClaude — the pane's OWN foreground process (pane_pid) is a claude process.
export function paneSelfIsClaude(env, session) {
  const p = tmux(["list-panes", "-t", session, "-F", "#{pane_pid}"], env);
  if (p.status !== 0 || !p.stdout.trim()) return false;
  return isClaudePid(p.stdout.trim());
}

export async function waitForSelfClaude(env, session, timeoutMs = HANG_GUARD_MS) {
  const deadline = Date.now() + hangGuard(timeoutMs);
  while (Date.now() < deadline) {
    if (paneSelfIsClaude(env, session)) return true;
    await sleep(100);
  }
  return paneSelfIsClaude(env, session);
}

// spawnMonitor — run the REAL session-liveness.sh with a fast test interval and overridable targets.
// 2026-08-06 (gap-session-liveness-remove-shared-events-and-lock): the shared events file + the
// mount lock are gone — each observer owns its own stdout stream, so there is NO global state to
// isolate and a spawned monitor can never collide with another mount. SL_ROUND_MARKER=1 (default in
// tests) prints one `# ROUND` per loop iteration as a deterministic round cadence (the old shared-file
// HEARTBEAT was the previous cadence carrier). cleanup() is a no-op keep-alive for the old call sites.
export function spawnMonitor(env, targets, { script = SCRIPT, tickLogs, transcripts, stallMin = 1, overdueMin = 1, interval = 1, loopMin, roundMarker = true, register = false } = {}) {
  const monEnv = {
    ...env,
    SESSION_TARGETS: targets,
    INTERVAL: String(interval),
    STALL_MIN: String(stallMin),
    OVERDUE_MIN: String(overdueMin),
    // The busy judgment consumes classifyPaneState (ADR-016 Amendment / ruling D). Pin the
    // classifier path so a COPY of the script (the AC6 mutation test) still resolves the real
    // classifier — BASH_SOURCE-relative lookup would point at the temp copy's directory.
    SL_CLASSIFY: path.resolve(__dirname, "..", "scripts", "pane-state-classify.ts"),
  };
  if (roundMarker) monEnv.SL_ROUND_MARKER = "1";
  if (tickLogs) monEnv.SESSION_HEARTBEATS = tickLogs;
  if (transcripts) monEnv.SESSION_TRANSCRIPTS = transcripts;
  if (loopMin !== undefined) monEnv.LOOP_MIN = String(loopMin);
  // Candidate-D self-registration (gap-sweeptmp-... AC5): tests OPT OUT by default so a spawned
  // monitor never writes a registry file into the REAL repo's .quay (spawnMonitor's env does not
  // set SESSION_ROOT, so the script's REPO_ROOT would resolve to the quay repo). Pass
  // register:true AND SESSION_ROOT:<tmp> to exercise the registration path hermetically.
  if (!register) monEnv.SL_NO_REGISTER = "1";
  const child = spawn("bash", [script], { env: monEnv });
  __registerChildProc(child); // reap in the unified after() if the test's finally is skipped
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  return {
    child,
    output: () => out,
    cleanup() { /* per-observer streams are process-local — nothing global to remove */ },
  };
}

// countRounds / waitForRounds — the stdout round cadence (`# ROUND` under SL_ROUND_MARKER). The old
// waitForHeartbeats read the shared events file; with the file gone, tests count rounds from stdout.
export function countRounds(mon) {
  return (mon.output().match(/# ROUND/g) || []).length;
}
export async function waitForRounds(mon, n, timeoutMs = HANG_GUARD_MS) {
  const deadline = Date.now() + hangGuard(timeoutMs);
  while (Date.now() < deadline) {
    if (countRounds(mon) >= n) return true;
    await sleep(100);
  }
  return countRounds(mon) >= n;
}

// waitForMoreRounds(mon, n, ...) — wait for the monitor to complete n ADDITIONAL rounds from NOW.
// waitForRounds is ABSOLUTE (count >= n); once a monitor has already run many rounds it returns
// immediately, so the "hold the shape for ≥N more rounds" checks (edge-trigger, negative-control
// spans) need this DELTA form. Same hermetic principle as waitForRounds: the `# ROUND` marker is the
// deterministic time source (time injection), never a fixed wall-clock sleep — the hang-guard is
// only an upper cap so a genuinely hung monitor still fails (slow-but-correct passes under load).
export async function waitForMoreRounds(mon, n, timeoutMs = HANG_GUARD_MS) {
  const target = countRounds(mon) + n;
  const deadline = Date.now() + hangGuard(timeoutMs);
  while (Date.now() < deadline) {
    if (countRounds(mon) >= target) return true;
    await sleep(100);
  }
  return countRounds(mon) >= target;
}

export async function waitForOutput(mon, pattern, timeoutMs = HANG_GUARD_MS) {
  const deadline = Date.now() + hangGuard(timeoutMs);
  while (Date.now() < deadline) {
    if (pattern.test(mon.output())) return true;
    await sleep(200);
  }
  return pattern.test(mon.output());
}

// makeBackdatedGitRepo — a temp git repo whose HEAD committer date is 2000, so
// `git -C <root> log -1 --format=%ct` is huge and the ≥STALL_MIN-minute criterion trips.
export function makeBackdatedGitRepo(dir) {
  const env = { ...process.env, GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
  const git = (args, cwd) => spawnSync("git", args, { encoding: "utf8", cwd, env });
  const init = git(["-c", "user.name=t", "-c", "user.email=t@t", "init", "-q", "-b", "master", dir]);
  assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  const add = git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], dir);
  assert.equal(add.status, 0, `git add failed: ${add.stderr}`);
  const commit = git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "old"], dir);
  assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
  const ct = git(["log", "-1", "--format=%ct"], dir);
  assert.ok(ct.status === 0 && Number(ct.stdout.trim()) < 1000000000, `commit must be backdated, got ${ct.stdout}`);
}

// makeFreshGitRepo — a temp git repo whose HEAD committer date is NOW (the incident-handling scenario:
// the outer produced commits during the red window). The multi-source heartbeat must count a fresh
// HEAD commit as liveness even when the tick-log is stale.
export function makeFreshGitRepo(dir) {
  const git = (args, cwd) => spawnSync("git", args, { encoding: "utf8", cwd });
  const init = git(["-c", "user.name=t", "-c", "user.email=t@t", "init", "-q", "-b", "master", dir]);
  assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  const add = git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], dir);
  assert.equal(add.status, 0, `git add failed: ${add.stderr}`);
  const commit = git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "fresh"], dir);
  assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
  const ct = git(["log", "-1", "--format=%ct"], dir);
  const now = Math.floor(Date.now() / 1000);
  assert.ok(ct.status === 0 && Number(ct.stdout.trim()) > now - 600,
    `commit must be fresh (within 10min), got ${ct.stdout}`);
}

// initGitRepo — a git repo at `dir` with one commit. `authorDate` (ISO-8601) controls the
// committer/author date; omit for a fresh (now) commit. The multi-source outer-heartbeat criterion
// (gap-outer-heartbeat-source-inverts-under-incident-handling) reads HEAD commit time as one source.
export function initGitRepo(dir, { authorDate } = {}) {
  const env = { ...process.env };
  if (authorDate) { env.GIT_AUTHOR_DATE = authorDate; env.GIT_COMMITTER_DATE = authorDate; }
  const git = (args, cwd) => spawnSync("git", args, { encoding: "utf8", cwd, env });
  const init = git(["-c", "user.name=t", "-c", "user.email=t@t", "init", "-q", "-b", "master", dir]);
  assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  const add = git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], dir);
  assert.equal(add.status, 0, `git add failed: ${add.stderr}`);
  const commit = git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "fresh"], dir);
  assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
}

// ── productization helpers (SPEC-outer-liveness-productization.md) ────────────────────────────────

export function makeTmp(prefix = "ol-prod-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
export function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// A worktree root quay-init's validation ACCEPTS: a real disk path, not tmpfs. /tmp is tmpfs on
// dev boxes and the sibling-of-repo default for a /tmp workspace would be rejected fail-closed
// (gap-the-shipped-tick-doc-... AC3). /var/tmp is the disk-backed tmp on Linux; prefer it.
export function diskWorktreeRoot() {
  for (const base of ["/var/tmp", os.tmpdir()]) {
    try {
      const t = spawnSync("stat", ["-f", "-c", "%T", base], { encoding: "utf8" });
      if (t.status === 0 && t.stdout.trim() !== "tmpfs") {
        return path.join(base, `quay-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
      }
    } catch { /* try next base */ }
  }
  return path.join(os.tmpdir(), `quay-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

export function runInit(workspace, args, pluginRoot = path.resolve(__dirname, "..")) {
  return spawnSync("bash", [path.join(pluginRoot, "scripts", "quay-init.sh"), ...args], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
}

// busy controls for a hermetic probe — SHAPE-based (ADR-016 Amendment / ruling D): the busy/idle
// judgment is classifyPaneState's bottom-region shape, so the probe is driven to the busy shape by
// TYPING "esc to interrupt" into its input line (no Enter — it stays in the status area, which is
// exactly the shape the classifier's BUSY_RE reads). The old content-hash busy loop (dates scrolling
// the pane) can no longer flip the verdict: with the whole-pane hash gone, a shape-stable pane is
// idle by definition. The claude child is job %1; nothing here touches it.
export function makePaneBusy(env, session) {
  tmux(["send-keys", "-t", session, "C-u"], env);   // clear any prior typed input
  tmux(["send-keys", "-t", session, "esc to interrupt"], env);  // typed, no Enter → status-area busy
}
export function makePaneIdle(env, session) {
  tmux(["send-keys", "-t", session, "C-u"], env);   // clear the input line → shape back to idle
}
// makePanePermissionPrompt(env, session) — type a blocking permission-confirmation SHAPE into the
// pane (no Enter — the pane's last content line carries the "Quick safety check" / "Enter to
// confirm" signature, so classifyPaneState reads permission-prompt and _sl_pane_verdict pins
// busy=0 intervention=1). gap-permission-prompt-merged-into-busy helper: same typing shape the
// candidate-B main-loop test already used inline, extracted for the intervention tests.
export function makePanePermissionPrompt(env, session) {
  tmux(["send-keys", "-t", session, "C-u"], env);   // clear any prior typed input
  tmux(["send-keys", "-t", session, "Quick safety check: Is this a project you created or one you trust? | Enter to confirm"], env);
}

// startTouchLoop — simulate a live session writing to its transcript: touch <file> every 0.5s.
// The spawned child is REGISTERED so the unified after()'s reapSpawnedChildren() SIGKILLs it if a
// cancelled test skips the caller's `toucher.kill("SIGKILL")` (gap-session-liveness-teardown-
// unified-kill-servers: one leaked touch-loop survived 62min alongside the leaked servers).
export function startTouchLoop(file) {
  const child = spawn("bash", ["-c", 'while true; do touch "$1"; sleep 0.5; done', "touch-loop", file],
    { stdio: "ignore" });
  __registerChildProc(child);
  return child;
}

// ── synthetic transcript records (stage-2/3/4 controllable JSONL content) ────────────────────────

export function userRecord(ts, content = "hello") {
  return JSON.stringify({ type: "user", message: { role: "user", content }, timestamp: ts });
}
export function assistantRecord(ts, text = "ok") {
  return JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] }, timestamp: ts });
}
export function apiErrorRecord(ts) {
  return JSON.stringify({ type: "assistant", isApiErrorMessage: true, apiErrorStatus: 429,
    message: { role: "assistant", content: [{ type: "text", text: "API Error: Request rejected (429)" }] },
    timestamp: ts });
}
export const isoAgo = (min) => new Date(Date.now() - min * 60000).toISOString();

// ── stage-3 synthetic transcript records (same top-level shape as real Claude Code JSONL) ────────

export function assistantToolUseRecord(ts) {
  return JSON.stringify({ type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "true" } }] },
    timestamp: ts });
}
export function assistantTextRecord(ts, text = "ok") {
  return JSON.stringify({ type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    timestamp: ts });
}
export function userInputRecord(ts, content = "hello") {
  return JSON.stringify({ type: "user", message: { role: "user", content }, timestamp: ts });
}

// writeTranscript —— 覆盖写 transcript 并可选回拨 mtime（回拨 = 陈旧：不发 marker-stale、hmin≥1）。
export function writeTranscript(file, records, backdateMin = 0) {
  fs.writeFileSync(file, records.join("\n") + "\n");
  if (backdateMin > 0) spawnSync("touch", ["-d", `${backdateMin} minutes ago`, file], { encoding: "utf8" });
}

// ── stage-4 saturation helper ────────────────────────────────────────────────────────────────────

// assistantUsageRecord —— assistant 消息带 usage.cache_read_input_tokens（真实 Claude Code JSONL 顶层的
// usage 结构字段，阶段四实测：内层 31.9 万、外层 62.5 万）。
export function assistantUsageRecord(ts, cacheRead) {
  return JSON.stringify({ type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
    usage: { input_tokens: 89, cache_creation_input_tokens: 0, cache_read_input_tokens: cacheRead, output_tokens: 111 },
    timestamp: ts });
}
