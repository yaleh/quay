// sync-sleep.ts — the ONE synchronous-sleep primitive (`Atomics.wait` on a throwaway
// `SharedArrayBuffer`), a kernel leaf.
//
// WHY THIS LEAF EXISTS (`.quay/routine-findings.jsonl` finding `sync-sleep-atomics`, routine
// `semantic-dedup-scan`, runId `semantic-dedup-scan-1793401709530`, 2026-10-30): the SAME
// byte-identical body —
//     Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// — was independently re-declared as a private function in four files under two names:
//   · `plugin/scripts/prepare-admission-check.ts`  `_syncSleepMs`
//   · `plugin/scripts/proposal-convergence.ts`     `_syncSleepMs`
//   · `plugin/scripts/sh-census-check.ts`          `sleepSync`
//   · `packages/quay/src/goal-preview.ts`          `sleepSync`
// and `plugin/scripts/process-kill-lib.ts` carried the body INLINE (no function at all) inside its
// SIGTERM grace loop. All five call sites are the same primitive: block the main thread for a
// bounded number of milliseconds without spawning a `sleep` subprocess and without a busy spin —
// the only Node-native way to do that synchronously.
//
// WHY THE KERNEL (same reachability argument as `kernel/regex-escape.ts` and `kernel/pid-alive.ts`):
// the copies span BOTH layers — three `plugin/scripts/*.ts` mechanism instruments AND the product-side
// `packages/quay/src/goal-preview.ts`. The kernel is the only placement both sides can reach. The
// direction must be plugin → kernel: `packages/**` importing `plugin/**` is a REVERSE EDGE
// (import-graph-check's `reverseEdges` ratchet, baselined at 0), so the product-side caller cannot
// import a methodology-side copy.
//
// KERNEL BOUNDARY (import-graph-check 第四规则): this file imports NOTHING. It is a leaf, so it can
// never participate in a value or type cycle, and the boundary rule that kernel files may not
// import outside the kernel is satisfied vacuously. The `Atomics` / `SharedArrayBuffer` /
// `Int32Array` symbols it uses are Node globals, not imports.
//
// NOT A CHECKER, NOT AN INSTRUMENT: it answers no question of its own and is deliberately absent
// from the capability catalog's QUESTION table — it is a primitive consumed by instruments that do.
//
// SCOPE: this is ONLY the synchronous sleep. Asynchronous sleep (a `setTimeout`-backed Promise that
// does NOT block the event loop) is a DIFFERENT primitive — the finding `async-sleep` filed the same
// run — and stays out of this leaf.

/**
 * Block the calling thread for at least `ms` milliseconds, synchronously, via `Atomics.wait` on a
 * fresh `SharedArrayBuffer`. This is the one Node-native way to sleep WITHOUT spawning a `sleep`
 * subprocess and WITHOUT a CPU-burning spin loop.
 *
 * ⛔ Synchronous-sleep contract, held by hand across the five former copies: this BLOCKS the whole
 * event loop — it exists only for the bounded backoff/grace windows the callers use (a lock retry
 * delay, a process-stop grace poll, a short read-retry backoff). Never use it for an unbounded
 * wait or on a hot path; an asynchronous waiter is the right tool there.
 *
 * @param ms sleep duration in milliseconds. Non-positive values (and non-finite ones) are a no-op —
 *          `Atomics.wait` returns immediately, which is the correct "don't sleep" reading for
 *          callers that compute a clamped `deadline - now` remainder.
 */
export function syncSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
