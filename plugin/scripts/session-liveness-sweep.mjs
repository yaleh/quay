// plugin/scripts/session-liveness-sweep.mjs — RUNTIME per-run namespace sweep functions.
//
// Extracted from plugin/test/session-liveness-helpers.mjs (2026-08-13,
// gap-leak-residue-per-run-namespace-isolation): the full-suite-runner imports these DIRECTLY at
// runtime, but they lived in a TEST helper — and package.sh EXCLUDES plugin/test/ from the shipped
// bundle ("quay's own suite — not a user-facing deliverable"), so build-plugin-dist failed to
// resolve `../test/session-liveness-helpers.mjs` and the npm-pack tarball never built (round 123/124
// real regression, verifiedCommit 776632e9; round 122 pre-#1/#2 was green).
//
// These are the fs-only runtime sweepers the runner calls before/after the suite:
//   sweepRunNamespaces()    pre-suite orphan sweep over ALL /tmp/quay-run-* dirs
//   sweepRunNamespace(id)    post-suite clean of THIS run's own subtree
// The criterion is PATH OWNERSHIP (the /tmp/quay-run-* subtree) + OWNER LIVENESS
// (dirHasLiveOwner) — NEVER a process-name/path-prefix batch kill (invariant
// no_pkill_by_name_on_live = 1, the 2026-08-08 two-layer-blind incident). A namespace dir whose
// tmux server is STILL alive (a genuinely leaked, still-running probe) is SKIPPED — it is in-use,
// not residue. Both sweepers are fs-only (no spawn, no pkill), matching the executable-body
// contract the session-liveness-sweep test pins. Returns { cleaned, dirs } so the runner can record
// the count + WHICH dirs into the verification-round record (the leak is an observable metric).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The runId the runner delivered via QUAY_RUN_ID ("" when this process is not namespaced —
 * a scoped/direct test invocation, or a legacy caller). The runner uses a SHORT id (8 hex
 * chars derived from the state-file UUID) so the tmux socket sun_path (~107 bytes) stays
 * well under the bound. */
export function runIdOf() {
  return (process.env.QUAY_RUN_ID ?? "").trim();
}

/** The per-run namespace root for `id`, or null when `id` is empty (no namespace). */
export function runNamespaceRoot(id = runIdOf()) {
  return id ? path.join(os.tmpdir(), `quay-run-${id}`) : null;
}

// ── dirHasLiveOwner — OWNER-LIVENESS criterion (gap-sweeptmp-pkill-kills-live-observers-two-layer-blind) ──
// 2026-08-08 incident: a cleanup ran a process-name batch kill of the session-liveness monitor
// processes (outer + manager) and killed them all — the two layers went blind simultaneously and
// the observers' own deaths had no observer. Root cause: the cleanup distinguished "leak residue"
// from "in-use instance" by PROCESS-NAME/PATH matching instead of OWNER-SESSION LIVENESS. A
// session-liveness process whose owner session is alive is IN-USE, not residue; name-based batch
// kills necessarily kill live monitors.
//
// THE RULES ENFORCED HERE (pinned by the AC2/AC4 sweep tests in session-liveness-sweep.test.mjs):
//   * sweepTmp/sweepers NEVER kill processes — they only remove /tmp DIRECTORIES under the caller's
//     own test prefixes, and only those with NO live owner.
//   * A name-based batch kill of the session-liveness monitor (process-name `pkill` / `killall`)
//     is FORBIDDEN in the cleanup path (invariant no_pkill_by_name_on_live = 1).
//   * The residue-vs-in-use criterion is OWNER LIVENESS (dirHasLiveOwner), NOT name/path prefix.
export function dirHasLiveOwner(dir) {
  // A live tmux server holds a unix socket under <dir>/sock (a hermetic probe started it with
  // TMUX_TMPDIR=<dir>/sock). /proc/net/unix lists only sockets bound by LIVE processes, so a stale
  // socket FILE with no live holder does NOT count as an owner.
  let abs;
  try { abs = fs.realpathSync(dir); } catch { return false; } // gone → not "alive"
  try {
    const netUnix = fs.readFileSync("/proc/net/unix", "utf8");
    for (const line of netUnix.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 8) { // num: ref protocol flags type st inode path
        const sock = parts.slice(7).join(" ");
        if (sock.startsWith(abs + "/")) return true;
      }
    }
    // Socket table READ and NO live socket under the dir → owner-dead. The environ fallback below
    // runs ONLY when this read FAILED (unreadable /proc/net/unix). It must NOT run here: a leaked
    // pane CHILD (the `exec -a claude-probe sleep 10000` fixture) survives the server's death
    // carrying the inherited TMUX_TMPDIR environ, and treating that orphan as a live owner left
    // dead-server dirs unswept (2026-08-18 full-suite red: 21 residual session-liveness-* dirs,
    // every one owner-dead but environ-marked by an orphaned `claude-probe 10000`).
    return false;
  } catch { /* /proc/net/unix unreadable — fall through to the environ check */ }
  try {
    const procs = fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n));
    for (const p of procs) {
      try {
        const environ = fs.readFileSync(`/proc/${p}/environ`, "utf8");
        for (const kv of environ.split("\0")) {
          if (kv.startsWith("TMUX_TMPDIR=") && kv.slice("TMUX_TMPDIR=".length).startsWith(abs + "/")) return true;
        }
      } catch { /* pid exited mid-scan */ }
    }
  } catch { /* /proc unreadable */ }
  return false;
}

/** serverPidOf(dir) — the PID of the LIVE process holding a listening socket under `dir`
 * (the tmux SERVER daemon a hermetic probe started), or null when no such socket is live.
 * The server daemon is detached (PPID=1 after its `tmux new-session` client exits), so a graceful
 * `kill-server` that races/fails under suite load leaves it ORPHANED and unreachable by any parent
 * reap — the teardown hard-kill fallback (gap-session-liveness-fixture-tmux-not-killed) needs its
 * PID. Resolved by mapping the socket INODE from /proc/net/unix to the process holding it via
 * /proc/<pid>/fd/* (a PID-targeted lookup, fs-only — NOT a name-based batch kill; invariant
 * no_pkill_by_name_on_live = 1 is preserved). Only the LISTENING socket matches (<dir>/sock/...),
 * so a transient monitor CLIENT connection is never mistaken for the server. */
export function serverPidOf(dir) {
  let abs;
  try { abs = fs.realpathSync(dir); } catch { return null; }
  try {
    const netUnix = fs.readFileSync("/proc/net/unix", "utf8");
    const inodes = [];
    for (const line of netUnix.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 8) { // num: ref protocol flags type st inode path
        const sock = parts.slice(7).join(" ");
        if (sock.startsWith(abs + "/")) inodes.push(parts[6]);
      }
    }
    if (inodes.length === 0) return null;
    for (const p of fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n))) {
      try {
        const fdDir = `/proc/${p}/fd`;
        for (const fd of fs.readdirSync(fdDir)) {
          try {
            const link = fs.readlinkSync(`${fdDir}/${fd}`);
            for (const ino of inodes) {
              if (link === `socket:[${ino}]`) return Number(p);
            }
          } catch { /* fd vanished mid-scan */ }
        }
      } catch { /* pid exited mid-scan */ }
    }
  } catch { /* /proc unreadable */ }
  return null;
}

/** panePidsOf(dir) — PIDs of the pane CHILDREN a hermetic probe spawned (the
 * `exec -a claude-probe sleep 10000` fixtures) whose `TMUX=` env still points at this probe's
 * socket (<dir>/sock/tmux-<uid>/default). When the tmux SERVER dies (graceful kill-server OR the
 * teardownProbe SIGKILL hard-kill), these detached children are ORPHANED (PPID=1) but KEEP the
 * inherited TMUX/TMUX_TMPDIR environ — the old dirHasLiveOwner environ fallback mistook that orphan
 * for a live owner (so the dead-server dir was never swept), and the orphaned `sleep 10000`
 * processes accumulated across runs (200+ observed → suite-wide load that red'd the load-sensitive
 * family). fs-only (reads /proc/<pid>/environ, returns PIDs); the KILL is the CALLER's
 * PID-targeted SIGKILL, never a name-based batch kill (invariant no_pkill_by_name_on_live = 1). */
export function panePidsOf(dir) {
  let abs;
  try { abs = fs.realpathSync(dir); } catch { return []; }
  const pids = [];
  try {
    for (const p of fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n))) {
      try {
        const environ = fs.readFileSync(`/proc/${p}/environ`, "utf8");
        for (const kv of environ.split("\0")) {
          if (kv.startsWith("TMUX=") && kv.slice("TMUX=".length).startsWith(abs + "/")) {
            pids.push(Number(p));
            break;
          }
        }
      } catch { /* pid exited mid-scan */ }
    }
  } catch { /* /proc unreadable */ }
  return pids;
}

/** Pre-suite orphan sweeper over ALL /tmp/quay-run-* dirs. A namespace dir whose tmux server is
 * STILL alive (a leaked, still-running probe) is SKIPPED — it is in-use, not residue. fs-only,
 * never a process-name batch kill. Returns { cleaned, dirs }. */
export function sweepRunNamespaces() {
  const cleaned = [];
  let entries = [];
  try { entries = fs.readdirSync(os.tmpdir()); } catch { return { cleaned: 0, dirs: cleaned }; }
  for (const name of entries) {
    if (!name.startsWith("quay-run-")) continue;
    const abs = path.join(os.tmpdir(), name);
    let isDir = false;
    try { isDir = fs.statSync(abs).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    if (dirHasLiveOwner(abs)) continue; // a live owner anywhere in the namespace → in-use, never clean
    try { fs.rmSync(abs, { recursive: true, force: true }); } catch { /* best-effort */ continue; }
    cleaned.push(abs);
  }
  return { cleaned: cleaned.length, dirs: cleaned };
}

/** Clean ONE run's namespace (the runner's own post-suite pass): remove owner-dead residue
 * under `/tmp/quay-run-<id>/`, then the (now residue-free, owner-dead) namespace root itself.
 * Skips the whole namespace when it has a live owner. fs-only, same invariant as above. */
export function sweepRunNamespace(id) {
  const root = runNamespaceRoot(id);
  if (root === null) return { cleaned: 0, dirs: [] };
  const cleaned = [];
  let entries = [];
  try { entries = fs.readdirSync(root); } catch { return { cleaned: 0, dirs: [] }; }
  for (const name of entries) {
    const abs = path.join(root, name);
    let isDir = false;
    try { isDir = fs.statSync(abs).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    if (dirHasLiveOwner(abs)) continue;
    try { fs.rmSync(abs, { recursive: true, force: true }); } catch { /* best-effort */ continue; }
    cleaned.push(abs);
  }
  try {
    if (!dirHasLiveOwner(root)) fs.rmSync(root, { recursive: true, force: true });
  } catch { /* best-effort */ }
  return { cleaned: cleaned.length, dirs: cleaned };
}
