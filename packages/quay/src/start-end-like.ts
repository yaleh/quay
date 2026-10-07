// start-end-like.ts — the ONE definition of fast-mode start/end event CLASSIFICATION, shared
// across the plugin/Core boundary.
//
// WHY THIS FILE EXISTS (gap-routine-semantic-dedup-scan-is-start-end-like-cross-surface, routine
// `semantic-dedup-scan`, finding `is-start-end-like-cross-surface`): `plugin/scripts/
// fast-mode-telemetry.ts`'s `aggregate()` and `packages/quay/src/observation.ts`'s `pairInFlight()`
// each carried their own copy of these two predicates, byte-identical in body. `observation.ts`
// DOCUMENTED itself as an "EXACT mirror" of the telemetry aggregate, but nothing pinned that claim
// at the source level — so the declared mirror could drift silently, and the two readers of the
// SAME `.workflow-events/*.jsonl` store would then disagree about which events are in-flight.
// Same resolution as the sibling finding `mergeenv-cross-layer-byte-identical-under-renamed-symbol`
// (Core leaf + plugin import): the pair moved into Core as the single definition, and both
// consumers import it.
//
// CLASSIFICATION IS BY TIMING MARKER PRESENCE, not the `eventKind` extra field alone (DEFECT-4
// fix): `eventKind` is not in A1a REQUIRED_FIELDS and `validateEvent` allows unknown extra fields,
// so a hand-edited Fast event may lack it. An event with no `eventKind` at all is still start-like
// if it carries `timing.startedAtMs` and no `timing.endedAtMs`.
//
// ⚠️ PRECONDITION, spelled out because both consumers' old doc comments OMITTED it and that
// omission is what made this predicate look simpler than it is: a truthy `timing` object is
// REQUIRED BEFORE the `eventKind` short-circuit is consulted. So `{eventKind: "start"}` with no
// `timing` (or `timing: null`, or a null event) is NEITHER start-like NOR end-like — `eventKind`
// can only ever ADD a classification to an event that already has a `timing` object, never supply
// one on its own. Behaviourally inert for real A1a events (every emitted start/end carries
// `timing`), but it is the actual contract, and start-end-like-ssot.test.mjs's oracle table pins
// it so a future "simplification" that hoists the `eventKind` check above the guard goes red.
//
// ⛔ NOT start-like and NOT end-like: the impl-complete boundary event
// (gap-inflight-states-missing-impl-complete-event) — a third task-lifecycle kind whose timing is
// all-null. It is a mid-span marker that splits start→end into start→impl-complete and
// impl-complete→end, so both predicates correctly return false for it.

/**
 * A fast-mode telemetry event, as far as start/end CLASSIFICATION is concerned — the minimal
 * structural shape both consumers can satisfy: Core's `observation.ts` `RawEvent` and the plugin's
 * untyped parsed A1a events. Deliberately does NOT include `stage`/`runId`/`taskId`: the
 * `blocked`-vs-task split and the pairing key are the CALLERS' concerns, not this predicate's.
 */
export interface TimingMarked {
  eventKind?: unknown;
  timing?: { startedAtMs?: unknown; endedAtMs?: unknown } | null;
}

/**
 * Start-like = a truthy `timing` AND (`eventKind === "start"` OR a present `timing.startedAtMs`
 * with an absent `timing.endedAtMs`). A null/absent event or a null/absent `timing` is never
 * start-like — see the module header's ⚠️ PRECONDITION note.
 */
export function isStartLike(e: TimingMarked | null | undefined): boolean {
  if (!e || !e.timing) return false;
  if (e.eventKind === "start") return true;
  return e.timing.startedAtMs != null && e.timing.endedAtMs == null;
}

/**
 * End-like = a truthy `timing` AND (`eventKind === "end"` OR a present `timing.endedAtMs`). A
 * null/absent event or a null/absent `timing` is never end-like — see the module header's
 * ⚠️ PRECONDITION note.
 */
export function isEndLike(e: TimingMarked | null | undefined): boolean {
  if (!e || !e.timing) return false;
  if (e.eventKind === "end") return true;
  return e.timing.endedAtMs != null;
}
