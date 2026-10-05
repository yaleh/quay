// process-kill-lib.ts — the shared process-termination primitive for plugin/scripts reapers.
//
// Why this module exists: a semantic-dedup-scan pass (.quay/routine-findings.jsonl, finding
// `kill-procs-pair`, routine `semantic-dedup-scan`, runId `semantic-dedup-scan-1791238550062`)
// found the SAME function written twice — `killProcs` in
//   plugin/scripts/orphan-session-check.ts   (the --kill-workspace primitive)
//   plugin/scripts/worktree-process-reaper.ts
// byte-identical in code (the only deltas were comments and a dead `const t0 = Date.now(); void t0;`
// pair whose removal is a no-op). One implementation now lives here; both reapers import it and
// re-export it, so every existing caller (the reapers' own call sites and their tests, which import
// `killProcs` from the reaper) keeps its import site — the same bind-locally-then-re-export shape
// `worktree-process-reaper.ts` already uses for the kernel's process-identity predicates.
//
// SCOPE: this module is deliberately ONLY the "stop a set of pids" primitive. Process IDENTITY /
// /proc READING stays in the kernel leaf `packages/quay/src/kernel/proc-identity.ts` (readProcCmdline
// / isQuayServe) — the split is read+classify (kernel, product-reachable) vs stop (mechanism-layer
// cleanup), which is why this half is a plugin/scripts module and not a kernel one.
//
// CONTRACT (pinned by both reapers' tests — plugin/test/orphan-session-check.test.mjs and
// plugin/test/worktree-process-reaper.test.mjs): SIGTERM each pid, wait a bounded grace for exit,
// SIGKILL survivors; FAIL-OPEN per pid — a process that already exited mid-enumeration is counted
// once as `killed`, never as `failed`. An empty pid list is a no-op returning all-zero counts.
//
// ⛔ The fail-open double-count trap is load-bearing and was a real defect (tasks/
// gap-suite-leaks-live-claude-sessions): a pid that is already gone raises ESRCH on the SIGTERM
// attempt — do NOT count it there, or it is counted again in the final not-alive branch. The
// single count point is the final loop; the SIGTERM catch only `continue`s.

/**
 * Stop a set of pids: SIGTERM each, wait a bounded grace for exit, SIGKILL survivors. Returns counts.
 * Fail-open per pid (a process that already exited mid-enumeration is not an error).
 */
export function killProcs(pids: number[], graceMs = 3000): { killed: number; sigkilled: number; failed: number } {
  let killed = 0;
  let sigkilled = 0;
  let failed = 0;
  if (pids.length === 0) return { killed, sigkilled, failed };
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      continue; // already gone (ESRCH) or not ours (EPERM) — counted once below
    }
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    const stillAlive = pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (stillAlive.length === 0) break;
    const sleepMs = Math.min(200, Math.max(0, deadline - Date.now()));
    if (sleepMs <= 0) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
  }
  for (const pid of pids) {
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (!alive) {
      killed += 1;
      continue;
    }
    try {
      process.kill(pid, "SIGKILL");
      sigkilled += 1;
      killed += 1;
    } catch {
      failed += 1;
    }
  }
  return { killed, sigkilled, failed };
}
