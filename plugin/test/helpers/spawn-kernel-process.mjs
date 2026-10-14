// spawn-kernel-process.mjs — the ONE test-side lifecycle helper for spawning a LONG-LIVED kernel
// process (a resident driver: promotion/worker/goal driver, driver-anchor, driver-runtime …) from a
// test, and guaranteeing the whole process GROUP is gone when the test ends.
//
// gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping. Measured
// 2026-10-14: a test-spawned resident driver (polling `--interval 25`) kept a whole suite scope alive
// for 18 hours (systemd scope run-u286396, MemoryPeak 17 GB, 42 656 CPU-seconds). The driver was a
// fixture child of a `node --test` file; when the test ended, nothing signalled it — a bare `spawn()`
// leaves the child alive, and `worktree-process-reaper.ts` (which keys on the WORKTREE cwd) cannot see
// a process whose worktree was removed because its task already landed `done`. The class: 38 test
// files start kernel drivers with async `spawn`, and there was no shared test-side lifecycle helper.
//
// THE CONTRACT (why each piece is here):
//   * `detached: true` — the child becomes its OWN process-group leader (pgid === pid). Every
//     descendant it spawns inherits that group, so ONE `kill(-pgid, …)` reaches the whole tree.
//     A group we own can only contain our own descendants, so this never signals a production
//     process (the "do not touch production drivers" constraint of the task).
//   * `t.after(...)` — node:test runs after-hooks on the test's SUCCESS, FAILURE and TIMEOUT paths
//     (measured; see the AC1 fixture tests). The hook reaps the group and THROWS if anything
//     survived, so a leak is a test FAILURE, never a silent survival.
//   * signal guards (SIGTERM/SIGINT/SIGHUP) + a `process.on("exit")` guard — node:test CANCELS a
//     test file by SIGTERMing the file's process, and a cancelled test does NOT run its `t.after`
//     hooks (measured): the file process dies before they can run. The signal guard therefore reaps
//     every group we own synchronously and then re-raises the signal (default disposition), and the
//     `exit` guard is the last-resort synchronous sweep for any other abrupt exit.
//
// USAGE
//   import { spawnKernelProcess } from "./helpers/spawn-kernel-process.mjs";
//   const { child, pid, pgid, stop } = spawnKernelProcess(t, process.execPath, [driver, "--root", r]);
//   // … drive the driver; nothing else to clean up — `t.after` reaps the group and fails on a leak.
//
// A helper in plugin/test/helpers/ (the tmp-workspace.mjs cross-package precedent): imported by
// plugin/test, no dependency-direction gate.

import { spawn } from "node:child_process";

/** Bounded grace between SIGTERM and SIGKILL (the Plan's "TERM, bounded wait, then KILL"). */
export const TERM_GRACE_MS_DEFAULT = 3000;
/** Bound for the post-KILL wait — after SIGKILL the group is gone or the kernel is wedged. */
const KILL_GRACE_MS = 2000;
const POLL_MS = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every process group THIS test file owns and has not yet reaped. Read by the signal/exit guards. */
const ownedGroups = new Set();

/**
 * Whether the process group `pgid` still has at least one member. `kill(-pgid, 0)` succeeds iff the
 * group exists — this is the DIRECT reading of the thing we promise (the group), not a proxy count of
 * some derived set (硬规则 4b). EPERM means the group exists but is not ours to signal (still alive).
 */
export function processGroupAlive(pgid) {
  if (!Number.isInteger(pgid) || pgid <= 1) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

/** Whether a single pid is alive (`kill(pid, 0)`), same "alive" semantics as processGroupAlive. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

/** Synchronous TERM+KILL of a group — the only shape usable from a signal / `exit` guard. */
function reapGroupSync(pgid) {
  try { process.kill(-pgid, "SIGTERM"); } catch { /* group already gone */ }
  try { process.kill(-pgid, "SIGKILL"); } catch { /* group already gone */ }
  ownedGroups.delete(pgid);
}

let guardsInstalled = false;
function installGuards() {
  if (guardsInstalled) return;
  guardsInstalled = true;
  // Last resort: any abrupt exit (including one no `t.after` hook saw) still sweeps every group.
  process.on("exit", () => {
    for (const pgid of [...ownedGroups]) reapGroupSync(pgid);
  });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    const onSignal = () => {
      for (const pgid of [...ownedGroups]) reapGroupSync(pgid);
      // Re-raise with OUR handler removed so the default disposition runs (a helper must not change
      // whether the process dies on a signal — only what it reaps on the way out).
      process.removeListener(sig, onSignal);
      try { process.kill(process.pid, sig); } catch { /* nothing left to do */ }
    };
    process.on(sig, onSignal);
  }
}

/**
 * Reap the process group `pgid`: SIGTERM the whole group, wait up to `graceMs` for it to empty, then
 * SIGKILL. Returns true iff the group is gone (the falsifiable reading — false means it survived).
 */
export async function stopKernelProcessGroup(pgid, { graceMs = TERM_GRACE_MS_DEFAULT } = {}) {
  if (!processGroupAlive(pgid)) {
    ownedGroups.delete(pgid);
    return true;
  }
  try { process.kill(-pgid, "SIGTERM"); } catch { /* raced to gone */ }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!processGroupAlive(pgid)) {
      ownedGroups.delete(pgid);
      return true;
    }
    await sleep(POLL_MS);
  }
  try { process.kill(-pgid, "SIGKILL"); } catch { /* raced to gone */ }
  const killDeadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < killDeadline) {
    if (!processGroupAlive(pgid)) {
      ownedGroups.delete(pgid);
      return true;
    }
    await sleep(POLL_MS);
  }
  return !processGroupAlive(pgid);
}

/**
 * Spawn `cmd args…` as a NEW PROCESS GROUP (its own pgid) and register cleanup with the node:test
 * context `t` (pass `null` to manage it yourself via the returned `stop`).
 *
 * Returns `{ child, pid, pgid, stop }`. `stop()` is idempotent and resolves true iff the group is
 * gone. The registered after-hook calls `stop()` and THROWS when the group survived — an after-hook
 * that throws fails the test, so a leaked group can never be a silent green.
 *
 * `opts` are forwarded to `spawn` (stdio/encoding/…); `detached` is forced true.
 */
export function spawnKernelProcess(t, cmd, args, opts = {}) {
  installGuards();
  const child = spawn(cmd, args, { ...opts, detached: true });
  const pgid = child.pid;
  ownedGroups.add(pgid);
  let stopped = false;
  const stop = async () => {
    if (stopped) return !processGroupAlive(pgid);
    stopped = true;
    return stopKernelProcessGroup(pgid);
  };
  if (t && typeof t.after === "function") {
    t.after(async () => {
      const gone = await stop();
      if (!gone) {
        throw new Error(
          `spawn-kernel-process: process group ${pgid} (${cmd}) survived cleanup — a resident kernel ` +
            `process leaked out of this test (TERM + ${TERM_GRACE_MS_DEFAULT}ms + KILL did not empty the group)`,
        );
      }
    });
  }
  return { child, pid: child.pid, pgid, stop };
}

/**
 * Run `body` and return the process groups the body spawned that are STILL ALIVE afterwards — the
 * pre-fix negative-control reading (nothing reaps a bare `spawn`), used by the AC1 fixtures.
 */
export function survivingGroups(pgids) {
  return pgids.filter((pgid) => processGroupAlive(pgid));
}
