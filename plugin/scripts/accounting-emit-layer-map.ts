// accounting-emit-layer-map.ts — layer → mechanisms mapping (AC39, gap-ac39-accounting-emit-layer)
// (task gap-ac39-accounting-emit-layer, manager 034125).
//
// THE LAYER→MECHANISMS MAPPING TABLE (SPEC §2.5 / manager 034125): each layer's accounting-emit
// claims ONLY the mechanisms that layer actually uses. Before this file the default registry
// wrongly installed INNER mechanisms (cap-from-gate / slot-refill) on the manager, so the manager's
// four-tuple was permanently `missing=[cap-from-gate.last_run_epoch, slot-refill.last_run_epoch]`
// and `complete:false` — the "字段对齐 ≠ 内容对齐" defect AC39 names (P2-9's acceptance only proved
// the three-layer field set was identical, never that each layer's content matched its own layer).
//
// The corrected map (AC2 invariant `layer_map_correct`):
//   outer:   closure-lag-check / verification-round / full-suite-runner  (its 1b 收尾 mechanisms;
//            closure-lag-check stays HERE, never inner)
//   inner:   ready-pool-check --apply / slot-refill / fast-mode-telemetry --task-start / cap-from-gate
//            (cap-from-gate + slot-refill are INNER's mechanisms — the effective_cap the inner
//            dispatch decision reads and the refill it performs)
//   manager: manager-tick-log / Workflow / session-liveness  (its OWN trace mechanisms; NOT
//            cap-from-gate/slot-refill — those are inner's; Workflow = the meta-cc tool it drives
//            outer with; session-liveness = its monitor instrumentation, manager-tick-core A10).
//
// Single source: accounting-emit.ts imports MECHANISMS from here (never a second copy of the map).
// The layer's claimed mechanisms with a real on-disk trace carry `trace`; everything else is
// injected by the layer via `--mechanism` (its meta-cc-gathered times), per SPEC §2.5 最小改动.
//
// Contract invariants this carries:
//   layer_map_correct  — cap-from-gate/slot-refill ∈ inner, closure-lag-check ∈ outer,
//                        cap-from-gate/slot-refill ∉ manager.
//   occupancy.in_flight 三层统一 — lives in accounting-emit.ts's autoOccupancy + fast-mode-telemetry.ts's
//                        fast slot view; this file is only the mechanism-membership table.

export type MechanismTrace =
  | { file: string; keys: string[]; mtime?: boolean }
  | { dir: string; keys: string[]; mtime?: boolean };

export type MechanismDef = {
  name: string;
  periodHours: number;
  trace?: MechanismTrace;
};

/** Compatibility alias — accounting-emit.ts consumes MechanismSpec (per-layer resolved entries). */
export type MechanismSpec = MechanismDef;

// The per-mechanism definitions: period + on-disk trace (where one exists). Every name referenced by
// LAYER_MECHANISMS must appear here. `trace` is present ONLY for mechanisms with a real, defined
// on-disk trace in a live workspace; everything else is injected by the layer via `--mechanism`
// (its meta-cc-gathered last-run times).
export const MECHANISM_DEFS: Record<string, MechanismDef> = {
  // ── inner (slot management + dispatch cadence; period 0.42h = 25min fast-mode tick) ──
  "cap-from-gate": { name: "cap-from-gate", periodHours: 0.42 },
  "slot-refill": { name: "slot-refill", periodHours: 0.42 },
  "ready-pool-check --apply": { name: "ready-pool-check --apply", periodHours: 0.42 },
  "fast-mode-telemetry --task-start": { name: "fast-mode-telemetry --task-start", periodHours: 0.42 },
  // ── outer (closure pass + verification cadence; real on-disk traces) ──
  "closure-lag-check": {
    name: "closure-lag-check",
    periodHours: 1,
    trace: { file: ".quay/closure-pass-last-run.json", keys: ["ranAt", "at"] },
  },
  "verification-round": {
    name: "verification-round",
    periodHours: 24,
    trace: { file: ".quay/verification-round.jsonl", keys: ["at", "startedAt", "finishedAt"] },
  },
  "full-suite-runner": {
    name: "full-suite-runner",
    periodHours: 24,
    trace: { file: ".quay/full-suite-state.json", keys: ["finishedAt", "startedAt"] },
  },
  // ── manager (cross-project coordination cadence; period 0.33h = 20min manager tick) ──
  "manager-tick-log": {
    name: "manager-tick-log",
    periodHours: 0.33,
    trace: { file: "orchestration/manager-tick-log.md", keys: [], mtime: true },
  },
  // The manager's meta-cc heartbeat — the `Workflow` tool it drives outer with
  // (orchestration/manager-loop-tick.md:1007: meta-cc `tool_name=Workflow` → last(timestamp)).
  Workflow: { name: "Workflow", periodHours: 0.33 },
  // The manager's session-liveness monitor instrumentation (manager-tick-core A10).
  "session-liveness": { name: "session-liveness", periodHours: 0.33 },
};

// The layer → mechanisms mapping (THE table AC39 builds). Each layer emits exactly its own
// mechanisms — never the shared default.
export const LAYER_MECHANISMS: Record<string, string[]> = {
  inner: ["cap-from-gate", "slot-refill", "ready-pool-check --apply", "fast-mode-telemetry --task-start"],
  outer: ["closure-lag-check", "verification-round", "full-suite-runner"],
  manager: ["manager-tick-log", "Workflow", "session-liveness"],
};

/**
 * Resolve one layer's mechanism specs (name + period + trace) from the map + defs. Unknown names
 * fail closed (throw) so a stale map never silently drops a mechanism.
 */
export function layerMechanisms(layer: string): MechanismDef[] {
  const names = LAYER_MECHANISMS[layer] ?? [];
  return names.map((n) => {
    const def = MECHANISM_DEFS[n];
    if (!def) {
      throw new Error(`accounting-emit-layer-map: no MECHANISM_DEFS entry for '${n}' (layer '${layer}')`);
    }
    return { name: def.name, periodHours: def.periodHours, trace: def.trace };
  });
}

// The resolved per-layer mechanism arrays (integration-side API — accounting-emit.test.mjs imports
// MECHANISMS directly). Built from the table above so the two views can never drift apart.
export const MECHANISMS: Record<string, MechanismSpec[]> = Object.fromEntries(
  Object.keys(LAYER_MECHANISMS).map((layer) => [layer, layerMechanisms(layer)])
);
