// gate-run-options.ts — kernel 单一实现：跑一个基于 shell 的 acceptance 检查所需的
// 通用原语（GateConfig / RunnerOptions 两类型 + shQuote / DEFAULT_ACCEPTANCE_TIMEOUT_MS /
// resolveAcceptanceTimeoutMs / resolveRunnerOptions 四导出）。
//
// WHY IT LIVES IN THE KERNEL (GOAL-034 第一刀；SPEC §2 P1: 共享原语落点 `packages/quay/src/kernel/`):
// 这四函数两类型原住 `gate/config/utils.ts`，但它们不是「config 加载」的职责——它们是
// **「如何跑一个基于 shell 的 acceptance 检查」的通用原语**，被 root（`goal-store.ts`）、
// cli（`cli/gate.ts`）、gate 本体（`acceptance-runner.ts`/`registry.ts`）、gate/config 自身
// （`loader.ts`/`index.ts`）、gate/factories（`goal.ts` 与同目录 barrel）共六个方向消费。
// 物理住在 `gate/config/` 使四方必须反向伸手进 `gate/` 内部才能拿到一个纯函数——
// root → gate/config 那条边的根因。落点论证同 `kernel/regex-escape.ts` / `kernel/verdict-parse.ts`。
//
// KERNEL BOUNDARY (import-graph-check 第四规则): this file imports NOTHING. It is a leaf, so it can
// never participate in a value or type cycle, and the boundary rule that kernel files may not import
// outside the kernel is satisfied vacuously. (The two types are declared HERE, not imported from
// `gate/config/types.ts`, precisely so this stays a leaf.)
//
// ⛔ `gate/config/utils.ts` was deleted, NOT left as a re-export shim (方法论第 2 节反搬壳原则):
// a shim at the old path would keep the very edge this slice removes. The one deliberate in-directory
// barrel that DOES stay is `gate/factories/utils.ts` — it re-exports these four names to its six
// sibling factory files, and its source was re-pointed here (GOAL-034 body: 有意保留的 re-export,
// not an oversight).

/** Shared gate configuration (cwd/timeoutMs). */
export interface GateConfig {
  cwd?: string;
  timeoutMs?: number;
}

/** Resolved runner configuration (always concrete). */
export interface RunnerOptions {
  cwd: string;
  timeoutMs: number;
  /** Per-provider `acceptance_env` file path, resolved and pinned via
   *  QUAY_ACCEPTANCE_ENV at the CLI/MCP layer — DIR-103-C. When set, the
   *  runner dot-sources this file before the acceptance command; missing
   *  file fails closed pre-execution. Undefined means no env file. */
  envFile?: string;
}

/**
 * Shell-quote one argument for safe interpolation into a `runAcceptance`
 * command string (spawnSync shell:true). Wraps in single quotes, escaping any
 * embedded single quote the POSIX-safe way: close, escaped quote, reopen.
 */
export function shQuote(arg: string): string {
  return `'${String(arg).replaceAll("'", `'\\''`)}'`;
}

/**
 * The acceptance runner's kill deadline when NOTHING overrides it — the SINGLE home of the
 * 60000ms default (gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout).
 * `runAcceptance` / `runAcceptanceCapture` default to it, and `resolveAcceptanceTimeoutMs` /
 * `resolveRunnerOptions` fall back to it.
 *
 * ⛔ Why this constant exists at all: the default used to be spelled as a bare `60000` literal in
 * FIVE places across three files — `acceptance-runner.ts` ×2, this module, and `goal-store.ts` ×4
 * (where it silently bypassed the whole DIR-046 configuration surface). Five copies of one number
 * is not five times the safety; it is one number that four readers cannot agree on. Exported, not
 * inlined, so `grep` for the default finds exactly one definition.
 */
export const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 60000;

/**
 * Resolve ONLY the acceptance runner's kill deadline (ms). This is the timeout half of
 * `resolveRunnerOptions`, extracted so the `goal` path (`goal-store.ts`) can honour the SAME
 * configuration surface WITHOUT inheriting the cwd rule.
 *
 * Precedence (unchanged, and deliberately the single source of it):
 *   pre-set `QUAY_ACCEPTANCE_TIMEOUT_MS` env var  >  this gate's own `gates.yml` `timeoutMs`
 *   field  >  `DEFAULT_ACCEPTANCE_TIMEOUT_MS` (60000).
 *
 * ⛔ Deliberately NOT cwd-aware. A caller that wants the cwd too calls `resolveRunnerOptions`.
 * The goal criterion's cwd is the git root (a deliberate choice — `hard rule 4 corollary 2`:
 * the value must not depend on where the process happens to have been started), while
 * `resolveRunnerOptions` prefers `QUAY_ACCEPTANCE_CWD`; adopting the whole options object would
 * silently relocate every goal criterion the moment someone set that variable.
 */
export function resolveAcceptanceTimeoutMs(gateConfig: GateConfig = {}): number {
  const envTimeout = Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS);
  if (Number.isFinite(envTimeout) && envTimeout > 0) return envTimeout;
  const cfgTimeout = gateConfig.timeoutMs;
  return typeof cfgTimeout === "number" && cfgTimeout > 0 ? cfgTimeout : DEFAULT_ACCEPTANCE_TIMEOUT_MS;
}

/**
 * DIR-046 (A/B) — resolve the acceptance runner's cwd/timeoutMs for ONE gate
 * invocation, with a single shared precedence rule used by every factory
 * (single-source, ADR-004):
 *
 *   cwd:       pre-set `QUAY_ACCEPTANCE_CWD` env var  >  this gate's own
 *              `gates.yml` `cwd` field  >  `process.cwd()`
 *   timeoutMs: pre-set `QUAY_ACCEPTANCE_TIMEOUT_MS` env var > this gate's
 *              own `gates.yml` `timeoutMs` field > the 60000ms default.
 *   envFile:   pre-set `QUAY_ACCEPTANCE_ENV` env var > undefined (no env
 *              file) — per DIR-103-C; the CLI/MCP layer pins the env var
 *              from the enabled provider's `acceptance_env` config key.
 *
 * The timeoutMs rule lives in `resolveAcceptanceTimeoutMs` (above) so the goal path can take it
 * without the cwd rule; this function only composes the three values.
 */
export function resolveRunnerOptions(gateConfig: GateConfig = {}): RunnerOptions {
  const cwd = process.env.QUAY_ACCEPTANCE_CWD || gateConfig.cwd || process.cwd();
  const timeoutMs = resolveAcceptanceTimeoutMs(gateConfig);
  const envFile = process.env.QUAY_ACCEPTANCE_ENV || undefined;
  return { cwd, timeoutMs, envFile };
}
