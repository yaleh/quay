// accounting-emit-layer-map.ts — layer → mechanisms mapping (AC39)
// (task gap-ac39-accounting-emit-layer, manager 034125).
//
// The UNIFIED four-tuple emitter (accounting-emit.ts, SPEC §2.5) reports, per layer, the mechanisms
// THAT LAYER claims to use — each mechanism's last real execution time vs its claimed period. This
// file is the SINGLE source for the layer → mechanisms mapping: which mechanisms belong to which
// layer, and each mechanism's claimed period + on-disk trace (where a real trace exists).
//
// ROOT CAUSE this fixes (manager 034125 实测): the emitter previously gave every layer the SAME
// default mechanism set (cap-from-gate / slot-refill — INNER's slot-management mechanisms), so:
//   - manager's emit was permanently missing cap-from-gate / slot-refill (NOT manager mechanisms —
//     manager's own are manager-tick-log / Workflow heartbeat / session-liveness);
//   - inner's emit never carried cap-from-gate (it never got its own full set);
//   - outer's emit was correct (closure-lag-check etc.) but the mapping was implicit, not a table.
// ⇒ `complete=False` on all three layers. The fix (outer 裁定): an explicit layer→mechanisms map —
// cap-from-gate / slot-refill 归 inner, closure-lag-check 归 outer, occupancy.in_flight 三层统一
// (the in_flight unification lives in accounting-emit.ts's autoOccupancy + fast-mode-telemetry.ts's
// fast slot view; this file is only the mechanism-membership table).
//
// Contract invariants this carries:
//   layer_map_correct  — cap-from-gate/slot-refill ∈ inner, closure-lag-check ∈ outer,
//                        cap-from-gate/slot-refill ∉ manager.

export type MechanismTrace =
  | { file: string; keys: string[]; mtime?: boolean }
  | { dir: string; keys: string[]; mtime?: boolean };

export type MechanismDef = {
  name: string;
  periodHours: number;
  trace?: MechanismTrace;
};

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
  "Workflow": { name: "Workflow", periodHours: 0.33 },
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
