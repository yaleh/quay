// FIXTURE — the MEMOIZED-PROBE false positive of the unencapsulated-state concern (task
// gap-unencapsulated-state-clue-judge-e2e, GOAL-911 AC-924).
//
// PROVENANCE: mirrors two LIVE instances of the same shape in this repo —
//   packages/quay/src/gate/config/loader.ts:61   (`cachedSink`)
//   packages/quay/src/observation.ts:387         (`taskStatusRefCache`)
// Both are module-level caches that are written and read but never *rebuilt*: the state is a pure
// memoization of a deterministic computation, so there is no cluster of related mutable state and
// nothing outside the owning function can observe an inconsistent intermediate.
//
// WHY IT IS HERE: a mechanical clue reader cannot tell a memo from a cluster — both are `new Map()` +
// `.set()`. This fixture is the bait that proves the SEMANTIC layer refutes it while the clue layer
// keeps reporting it as a candidate (a clue is a lead, never a verdict).
//
// ⛔ Do not "fix" this file: the memo table is the thing under test. Never imported by production code.

export interface ProbeInput {
  readonly file: string;
  readonly salt: string;
}

export interface ProbeResult {
  readonly ok: boolean;
  readonly digest: string;
}

/** The memo table — the ONLY mutable module-level state in this file. */
const cache = new Map<string, ProbeResult>();

function keyOf(input: ProbeInput): string {
  return `${input.file}::${input.salt}`;
}

function compute(input: ProbeInput): ProbeResult {
  let h = 0;
  for (const ch of keyOf(input)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return { ok: true, digest: `d${(h >>> 0).toString(16)}` };
}

/** Pure memoization: the table is a function of its inputs and is never rebuilt or cleared. */
export function probe(input: ProbeInput): ProbeResult {
  const k = keyOf(input);
  const hit = cache.get(k);
  if (hit) return hit;
  const fresh = compute(input);
  cache.set(k, fresh);
  return fresh;
}

export function probeCacheSize(): number {
  return cache.size;
}
