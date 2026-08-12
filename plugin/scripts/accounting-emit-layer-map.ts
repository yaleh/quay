// accounting-emit-layer-map.ts — per-layer mechanism registration (AC39, gap-ac39-accounting-emit-layer)
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
//   manager: manager-tick-log  (its OWN trace mechanism; NOT cap-from-gate/slot-refill — those are
//            inner's; the manager's other claimed mechanisms, e.g. Workflow, are injected by the
//            manager via `--mechanism` at tick time, not registered here)
//
// Single source: accounting-emit.ts imports MECHANISMS from here (never a second copy of the map).
// The layer's claimed mechanisms with a real on-disk trace carry `trace`; everything else is
// injected by the layer via `--mechanism` (its meta-cc-gathered times), per SPEC §2.5 最小改动.

export type MechanismSpec = {
  name: string;
  periodHours: number;
  trace?: { file?: string; dir?: string; keys: string[]; mtime?: boolean };
};

export const MECHANISMS: Record<string, MechanismSpec[]> = {
  outer: [
    {
      name: "closure-lag-check",
      periodHours: 1,
      trace: { file: ".quay/closure-pass-last-run.json", keys: ["ranAt", "at"] },
    },
    {
      name: "verification-round",
      periodHours: 24,
      trace: { file: ".quay/verification-round.jsonl", keys: ["at", "startedAt", "finishedAt"] },
    },
    {
      name: "full-suite-runner",
      periodHours: 24,
      trace: { file: ".quay/full-suite-state.json", keys: ["finishedAt", "startedAt"] },
    },
  ],
  inner: [
    { name: "ready-pool-check --apply", periodHours: 0.42 },
    { name: "slot-refill", periodHours: 0.42 },
    { name: "fast-mode-telemetry --task-start", periodHours: 0.42 },
    { name: "cap-from-gate", periodHours: 0.42 },
  ],
  manager: [
    {
      name: "manager-tick-log",
      periodHours: 0.33,
      trace: { file: "orchestration/manager-tick-log.md", keys: [], mtime: true },
    },
  ],
};
