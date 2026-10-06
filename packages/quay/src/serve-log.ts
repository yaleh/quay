// serve-log.ts — THE single definition point for where a spawned serve host's stdout/stderr goes.
//
// THE DEFECT THIS CLOSES (measured 2026-10-06, cantus 实测,
// gap-server-host-spawn-discards-stdio-while-start-drivers-logs-to-serve-log): the unified host has
// TWO spawn sites and they disagreed about the host's log routing —
//
//   entry                                        host stdout/stderr
//   ──────────────────────────────────────────   ─────────────────────────────────────────────
//   packages/quay/src/cli/server.ts  spawnHost   `stdio: "ignore"`  → DISCARDED
//   plugin/scripts/start-drivers.ts  startServe  append to `.quay/serve.log` (fallback /dev/null)
//
// — so a host that died on the `server start/add/restart` path left NOTHING anywhere: no stderr, no
// log line, only a stale `.quay/server.json` carrier and no way to read the cause. The same host,
// started through the drivers skill, logged fine. Two copies of "how to open the log and build the
// stdio" is the drift; this module is the one implementation both spawn sites now call (硬规则 5b —
// the fix is the shared source, not a second correct-looking copy that agrees today and drifts
// later).
//
// ⛔ LEAF DISCIPLINE (same rule as serve-binding.ts): node builtins only. This module is imported
// from BOTH sides of the kernel↔target boundary — Core (`cli/server.ts`) and the kernel
// (`plugin/scripts/start-drivers.ts`, a plugin→packages forward edge esbuild inlines into the
// shipped `dist/start-drivers.js`). An import edge of its own would put cycle risk on
// import-graph-check's zero-SCC baseline for no benefit.
//
// THREE-VALUED OUTPUT (硬规则 3b): "the log could not be opened" is its OWN value
// (`unavailable: true` + a `reason`), NEVER the same shape as "opened the real log" — a spawn site
// that silently substitutes /dev/null turns 「the host's death is unreadable」 into 「no output」,
// which is exactly the silence this module exists to end. The fallback to /dev/null is the
// convenience; reporting it is the contract (the caller must surface `SERVE_LOG_UNAVAILABLE`).
//
// ⛔ ONE log name: `.quay/serve.log`. The admission-marker reader and every "see .quay/serve.log"
// diagnostic in start-drivers.ts spell it through `serveLogPath`, never a second literal.

import fs from "node:fs";
import path from "node:path";

/** The host log's basename inside `<root>/.quay/`. ⛔ The ONE naming point — a second literal would
 *  let the reader and the writer drift onto different files while each looks correct. */
export const SERVE_LOG_BASENAME = "serve.log";

/** Stable token in the non-fatal warning a spawn site MUST emit when the log is unavailable. It is
 *  a token (not prose) so a test can assert the reading exists without matching a whole sentence. */
export const SERVE_LOG_UNAVAILABLE = "serve-log-unavailable";

/** What `spawn(..., { stdio })` accepts here: `["ignore", fd, fd]` (stdin dropped, stdout+stderr
 *  appended to the log fd) — or the literal `"ignore"` in the degenerate case where not even
 *  /dev/null could be opened, so the caller needs no branch of its own. */
export type ServeLogStdio = ["ignore", number, number] | "ignore";

export interface ServeLogHandle {
  /** The `serve.log` path this handle TRIED to open (the intended path even when `unavailable` —
   *  a diagnostic naming /dev/null would hide which file an operator must fix). */
  readonly path: string;
  /** Ready to hand to `spawn()`'s `stdio` option. */
  readonly stdio: ServeLogStdio;
  /** Byte size of `path` at open time — only bytes AFTER this belong to the child being spawned
   *  (the admission-marker reader's "ours, not a previous run's" window). `0` when the size could
   *  not be read: ⛔ never a silently-shared offset with an earlier run. */
  readonly startOffset: number;
  /** `true` iff the REAL log could not be opened (output went to /dev/null, or nowhere when even
   *  that failed). ⛔ A caller that ignores this reports 「nothing was logged」 for 「nothing COULD
   *  be logged」 — 硬规则 3b. */
  readonly unavailable: boolean;
  /** Non-null iff `unavailable`: the underlying OS error, verbatim (never a paraphrase). */
  readonly reason: string | null;
  /** Release the PARENT's copy of the fd. ⛔ Call it only AFTER `spawn()` has returned — the child
   *  holds its own dup, so closing before the spawn would leave the child with a stale number. */
  close(): void;
}

/** `<workspaceRoot>/.quay/serve.log` — the ONE spelling of the host log's location. */
export function serveLogPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".quay", SERVE_LOG_BASENAME);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Open the serve host's log and build the stdio the spawn sites pass to `spawn()`.
 *
 *  NEVER throws: a log that cannot be opened is a REPORTED degradation, not a reason to refuse to
 *  start the host (a host with nowhere to log is still better than no host — and it is exactly the
 *  case the caller must be able to see). */
export function openServeLog(workspaceRoot: string): ServeLogHandle {
  const target = serveLogPath(workspaceRoot);
  let fd: number | null = null;
  let unavailable = false;
  let reason: string | null = null;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fd = fs.openSync(target, "a");
  } catch (err) {
    // The mkdir/open pair is ONE attempt: a `.quay/` that cannot be created and a `serve.log` that
    // cannot be opened are the same reading — 「the real log is not available」.
    unavailable = true;
    reason = messageOf(err);
  }
  // The offset comes from the SAME file in both branches. When the log is unwritable the child's
  // bytes go to /dev/null, and whatever already sits in `serve.log` belongs to an EARLIER run — ⛔ an
  // admission marker found there must never be read as this spawn's (the `self=` binding is the
  // second guard; this offset is the first). A stat that fails leaves 0, the honest "could not read
  // a size" value here, because the reader still requires the marker to name our own child.
  let startOffset = 0;
  try {
    startOffset = fs.statSync(target).size;
  } catch {
    startOffset = 0;
  }
  if (fd === null) {
    try {
      fd = fs.openSync("/dev/null", "w");
    } catch (err2) {
      // Both failed: no stdio can be built at all. Keep `unavailable` true and hand back "ignore" so
      // the caller still spawns — with BOTH failures named, so the reason is not half-reported.
      reason = `${reason ?? "the serve log could not be opened"}; /dev/null also unwritable (${messageOf(err2)})`;
    }
  }
  const opened = fd;
  return {
    path: target,
    stdio: opened === null ? "ignore" : ["ignore", opened, opened],
    startOffset,
    unavailable,
    reason,
    close(): void {
      if (opened === null) return;
      try {
        fs.closeSync(opened);
      } catch {
        /* already released — close() is idempotent by contract */
      }
    },
  };
}
