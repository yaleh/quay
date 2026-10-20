// gate/criterion-capability.ts — FORWARDING re-export (tasks/gap-src-root-gate-cycle-break).
//
// The implementation moved DOWN to `core/criterion-capability.ts`. The goal store (now
// `core/goal-store.ts`) is its other consumer, and a `core/` module may not import `gate/`.
// This path stays as the supported import surface for historical consumers.
export * from "../core/criterion-capability.ts";
