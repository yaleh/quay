// gate/shared/acceptance-runner.ts — FORWARDING re-export (tasks/gap-src-root-gate-cycle-break).
//
// The implementation moved DOWN to `core/acceptance-runner.ts`. Why: the goal store (now
// `core/goal-store.ts`) and the gate both run acceptance commands, and a `core/` module may not
// import `gate/` — so the runner must sit BELOW both layers. The src root also imported this path
// (`"" → gate`), which is what made the `"" ↔ gate` directory SCC possible in the first place.
//
// This path stays as the supported import surface for external consumers (tests, cli/).
// `gate/**` itself imports `../../core/acceptance-runner.ts` directly.
export * from "../../core/acceptance-runner.ts";
