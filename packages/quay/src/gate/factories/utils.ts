// Re-exports from the kernel (GOAL-034: the shared acceptance-runner primitives moved to
// `kernel/gate-run-options.ts`). Factory files continue to import from this path unchanged —
// this is the ONE deliberately retained in-directory barrel (GOAL-034 body: 有意保留的 re-export).

export type { GateConfig, RunnerOptions } from "../../kernel/gate-run-options.ts";
export { shQuote, resolveRunnerOptions } from "../../kernel/gate-run-options.ts";
