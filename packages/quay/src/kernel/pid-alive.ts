// pid-alive.ts — the ONE implementation of "is this pid a live process?" (`kill(pid, 0)`), as a
// kernel leaf.
//
// WHY THIS LEAF EXISTS (`.quay/routine-findings.jsonl` finding `pid-alive-three-copies`, routine
// `semantic-dedup-scan`, runId `semantic-dedup-scan-1792647604889`, 2026-10-22): the probe was
// written in three places — `packages/quay/src/core/server-state.ts` (the exported canonical copy),
// `plugin/scripts/discovery-method-routine.ts` (an importable leftover) and
// `plugin/scripts/start-drivers.ts` (kept as a copy because it is a direct entry and importing the
// whole `server-state.ts` would inline that module's closure into the shipped
// `dist/start-drivers.js`). Extracting the probe to a leaf with NO imports satisfies both sides at
// once: a product module and a bundled entry can share it without dragging either closure across
// (硬规则 5b — the same principle applied at every site the symbol is used).
//
// ── EPERM IS THE LOAD-BEARING BRANCH (硬规则 3b) ─────────────────────────────────────────────────
// `kill(pid, 0)` raising EPERM means the process EXISTS but belongs to another user — it is ALIVE.
// Reading that as DEAD is the `pidalive-eperm-opposite` defect (same routine,
// runId `semantic-dedup-scan-1789889905875`, 2026-09-20; re-filed 09-13 / 09-17): the callers that
// guard a FOREIGN pid carrier (`rmCarrierUnlessForeignLive`, `stopLegacyPair`) exist precisely to
// protect a live process that is not ours, and a probe that read EPERM as DEAD would delete that
// process's only on-disk record / report a running loop as stopped. Every other error — ESRCH in
// particular — means the process is gone.
//
// ── THE INPUT IS COERCED, NOT REQUIRED TO BE A NUMBER ────────────────────────────────────────────
// pid carriers are read as TEXT (`readPidFile` returns a string), so callers hand this function
// strings as well as numbers. Anything that is not a positive integer after coercion ⇒ not alive
// (读不懂 ⇒ 不报存活); the coercion itself is guarded because `Number(Symbol())` throws.
//
// Kernel boundary: this file imports nothing at all — bare specifiers only
// (`plugin/scripts/import-graph-check.ts` rule 4).

/** Direct quantity: is this pid a live process? `kill(pid, 0)` probes existence without signalling.
 *  EPERM (exists but not ours) is ALIVE; anything unreadable is not. */
export function pidAlive(pid: unknown): boolean {
  if (pid === null || pid === undefined || pid === "") return false;
  let n: number;
  try {
    n = Number(pid);
  } catch {
    return false; // not coercible ⇒ we could not read a pid ⇒ never report "alive"
  }
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}
