// FIXTURE — the DIAGNOSTIC-COUNTER false positive of the unencapsulated-state concern (task
// gap-unencapsulated-state-clue-judge-e2e, GOAL-911 AC-924).
//
// PROVENANCE: mirrors the LIVE counter `singleTaskGitSpawnCount` at packages/quay/src/observation.ts:397
// — a module-level `let` incremented on every spawn and only ever read for a diagnostic reading. It is
// monotone: nothing decrements it, nothing clears it, and no second reader depends on it being
// consistent with any other field. A counter is not a cluster.
//
// WHY IT IS HERE: `let` + reassignment is the strongest mechanical signal the clue reader has, and it
// is still not a confirmation. The judge must refute this sample while the clue layer reports it.
//
// ⛔ Do not "fix" this file: the monotone counter is the thing under test. Never imported by production.

let singleTaskGitSpawnCount = 0;

/** The monotone diagnostic counter — the ONLY mutable module-level state in this file. */
export function noteGitSpawn(): void {
  singleTaskGitSpawnCount += 1;
}

export function readGitSpawnCount(): number {
  return singleTaskGitSpawnCount;
}

/** A second, reset-free derived reading; it never mutates the counter. */
export function gitSpawnReading(): string {
  return `singleTaskGitSpawnCount=${singleTaskGitSpawnCount}`;
}
