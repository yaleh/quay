// file-lock.ts — the KERNEL's generic exclusive-create file lock.
//
// SEAM SPLIT (tasks/gap-routine-architecture-analysis-god-module-task-transition-mixed-concerns,
// 2026-10-29): this primitive was written INSIDE `task-transition.ts`, beside the status-event
// carrier that was its first caller. A lock is not a task-status concept — it is a filesystem
// primitive any kernel consumer may need — so it now lives here and `task-status-events.ts`
// imports it. Every function below is VERBATIM from its previous home; the move changes no
// behaviour and no caller (task-transition.ts still re-exports all four symbols).
//
// A kernel file may import nothing outside `kernel/` except bare specifiers (`node:*`, npm). This
// one imports `node:fs` and nothing else. Enforced by `plugin/scripts/import-graph-check.ts`
// (`kernelViolations` must stay empty).
//
// ⛔ This is NOT a re-entrant lock and it does NOT create the parent directory: it takes a lock
// PATH, the caller owns the release ordering (`withFileLock` is the sane default).

import fs from "node:fs";

// ── the exclusive-create lock (ported from packages/quay-native/src/store.ts) ─────────────────────
//
// `gate-event-store.ts`'s own M161 note names this exact pattern as the port to make when concurrent
// writers to a `.quay/*.jsonl` carrier become real. They are real here: the promotion driver, the
// worker fan-in and the worker driver's needs-human path all write this one carrier from separate
// PROCESSES. `fs.openSync(lockPath, "wx")` is the atomic primitive; a lock whose holder crashed is
// reclaimed after `staleMs` (its mtime stops advancing).

export interface FileLockOptions {
  /** A lock older than this (mtime) is treated as abandoned and reclaimed. */
  staleMs?: number;
  /** Busy-wait between attempts. */
  retryMs?: number;
  /** Give up after this long, returning/raising rather than waiting forever. */
  timeoutMs?: number;
}

/** Acquire the exclusive-create lock at `lockPath`; returns it so the caller can release it. THROWS
 *  on a non-EEXIST error or on timeout — the caller decides whether to fail the write (this module's
 *  status writers must NOT: see `appendTaskStatusEvent`). */
export function acquireFileLock(lockPath: string, opts: FileLockOptions = {}): string {
  const staleMs = opts.staleMs ?? 5000;
  const retryMs = opts.retryMs ?? 10;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return lockPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          fs.rmSync(lockPath, { force: true });
          continue; // reclaim and retry immediately
        }
      } catch {
        continue; // the lock disappeared between EEXIST and stat — retry
      }
      if (Date.now() > deadline) throw new Error(`timed out acquiring lock ${lockPath}`);
      const until = Date.now() + retryMs;
      while (Date.now() < until) {
        /* spin — v0 simplest correct mechanism, same as the native task store */
      }
    }
  }
}

export function releaseFileLock(lockPath: string): void {
  fs.rmSync(lockPath, { force: true });
}

/** Run `fn` holding the lock at `lockPath`. */
export function withFileLock<T>(lockPath: string, fn: () => T): T {
  const held = acquireFileLock(lockPath);
  try {
    return fn();
  } finally {
    releaseFileLock(held);
  }
}
