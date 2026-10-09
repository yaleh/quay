// plugin/scripts/driver-config.ts — 声明式 driver 配置加载 + 并发 cap 单一真相源（AC155）。
// (tasks/gap-ac155-config-merge-control-state-split-event-polling)
//
// WHY THIS EXISTS（manager-phase-goal.md ### AC155 / SPEC-unified-driver-architecture §2.6）：
// 并发 cap 此前有【三份「单一真相源」】：CAP_DEFAULT=5（promotion 字面量）/ resolveConcurrency（worker 读
// QUAY_MAX_TASK_SUBAGENTS env）/ FIXED_EFFECTIVE_CAP=5（cap-from-gate 字面量）。本模块把这三份收成一份：
// 声明式配置 `drivers.yml`（git 版本化 · 人写 · 重启生效）+ 一个加载函数 loadDriverConfig + 一个解析函数
// driverCap。⛔ 运行时控制态（.quay/worker-control.json / .quay/promotion-control.json）绝不并进本文件
// （机器热写 · gitignored —— 机器改人的源文件 = CLAUDE.md 11b 同族）。

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/** 声明式配置文件的仓库相对路径（git 版本化，与 .quay/profiles.yml 同族——⛔ 非 .quay 运行时态）。 */
export const DRIVERS_CONFIG_REL = "plugin/scripts/drivers.yml";

// 并发 cap 的单一回退字面量。concurrency-default-fallback：drivers.yml 缺失/不可解析时保守回退到
// 历史固定值 5（与旧三份字面量的值一致）。⛔ 全仓库唯一一个并发数值字面量——其余并发值都从
// drivers.yml 经 loadDriverConfig/driverCap 派生（gap-concurrency-literal-only-at-definition-points）。
export const DEFAULT_DRIVER_CAP = 5;

/** 缺省轮询间隔（ms）与协调地板（s）——非并发量，但同属「配置合并」的声明式侧回退。 */
export const DEFAULT_INTERVAL_MS = 30_000;
export const DEFAULT_RECONCILE_INTERVAL_SECS = 300;

/** 一个 kind 的配置块。 */
export interface DriverKindConfig {
  cap: number;
  intervalMs: number;
  reconcileIntervalSecs: number;
}

/** 完整 driver 配置（promotion + worker + outer + quality + meta + goal）。 */
export interface DriverConfig {
  promotion: DriverKindConfig;
  worker: DriverKindConfig;
  outer: DriverKindConfig;
  quality: DriverKindConfig;
  meta: DriverKindConfig;
  goal: DriverKindConfig;
}

/** 缺省配置（drivers.yml 缺失/不可解析时的回退；也是 parse 的 base）。 */
export function defaultDriverConfig(): DriverConfig {
  return {
    promotion: { cap: DEFAULT_DRIVER_CAP, intervalMs: DEFAULT_INTERVAL_MS, reconcileIntervalSecs: 0 },
    worker: { cap: DEFAULT_DRIVER_CAP, intervalMs: DEFAULT_INTERVAL_MS, reconcileIntervalSecs: DEFAULT_RECONCILE_INTERVAL_SECS },
    // AC143：outer 例程型 kind 无并发概念（例程是「读→报」，非「spawn 执行者」）；cap 仅为字段齐整
    // （⛔ 不参与裁决）。intervalMs 是轮询节奏（= outer tick ~20min 可由 drivers.yml 覆盖）。
    outer: { cap: DEFAULT_DRIVER_CAP, intervalMs: DEFAULT_INTERVAL_MS, reconcileIntervalSecs: 0 },
    // AC144：quality 例程型 kind（B15/B17 两条例程），同 outer——无并发概念、cap 仅为字段齐整。
    quality: { cap: DEFAULT_DRIVER_CAP, intervalMs: DEFAULT_INTERVAL_MS, reconcileIntervalSecs: 0 },
    // meta：机制演进复核例程型 kind，同 quality/outer——无并发概念，cap 仅为字段齐整。
    meta: { cap: DEFAULT_DRIVER_CAP, intervalMs: DEFAULT_INTERVAL_MS, reconcileIntervalSecs: 0 },
    // goal：goal 机械环例程型 kind，同 quality/outer/meta——无并发概念，cap 仅为字段齐整。
    goal: { cap: DEFAULT_DRIVER_CAP, intervalMs: DEFAULT_INTERVAL_MS, reconcileIntervalSecs: 0 },
  };
}

/** 从任意解析结果合并出一个 DriverKindConfig（缺失/非数值字段取缺省，⛔ 不信任输入形状）。 */
function mergeKindConfig(raw: unknown, d: DriverKindConfig): DriverKindConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    cap: num(r.cap, d.cap),
    intervalMs: num(r.interval_ms, d.intervalMs),
    reconcileIntervalSecs: num(r.reconcile_interval_secs, d.reconcileIntervalSecs),
  };
}

/** 读 drivers.yml 并合并为 DriverConfig。读失败/不可解析 ⇒ 缺省配置（⛔ 不抛——常驻循环不得因 config
 *  拼写炸掉；fail-open 到保守缺省，与旧三份字面量的值一致）。 */
export function loadDriverConfig(root: string): DriverConfig {
  const d = defaultDriverConfig();
  const file = path.join(root, DRIVERS_CONFIG_REL);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return d;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    return d;
  }
  const kinds = (parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).kinds : undefined) as
    | Record<string, unknown>
    | undefined;
  if (!kinds || typeof kinds !== "object") return d;
  return {
    promotion: mergeKindConfig(kinds.promotion, d.promotion),
    worker: mergeKindConfig(kinds.worker, d.worker),
    outer: mergeKindConfig(kinds.outer, d.outer),
    quality: mergeKindConfig(kinds.quality, d.quality),
    meta: mergeKindConfig(kinds.meta, d.meta),
    goal: mergeKindConfig(kinds.goal, d.goal),
  };
}

/** 单一并发 cap 解析（AC1 取假消点）：explicit（CLI --cap/--concurrency）优先 → drivers.yml cap →
 *  保守缺省 DEFAULT_DRIVER_CAP。⛔ 全仓库并发解析只此一份——promotion resolveCap / worker
 *  resolveConcurrency / cap-from-gate effective_cap 全部经本函数或 loadDriverConfig 派生。 */
export function driverCap(root: string, kind: "promotion" | "worker" | "outer" | "quality" | "meta" | "goal", explicit?: number): number {
  if (explicit != null && Number.isInteger(explicit) && explicit >= 1) return explicit;
  const c = loadDriverConfig(root)[kind].cap;
  if (Number.isInteger(c) && c >= 1) return c;
  return DEFAULT_DRIVER_CAP;
}

// ── routine 配额（gap-routine-quota-canonical-config-and-policy-gate）─────────────────────────────
// routine 限流闸的 K / 窗口 / 全局天花板 的声明式真相源，与 drivers.yml 的 `routine_quota` 段同源
// （⛔ 不新开第二个配置加载入口——与 DriverConfig 同文件、同风格、同一 DRIVERS_CONFIG_REL）。
//
// WHY（任务 Finding）：routine-file-gate.ts 的 DEFAULT_RATE=3 / FILING_WINDOW_MS=24h 曾是【孤儿字面量】，
// 不经任何统一配置面派生，且没有任何「全局」维度——per-routine 分账之后没有同时存在的全局上限，是
// 「K×R 可无上限增长」的结构性原因。本段把它收口进来，并补一个全局天花板。

/** 缺省 routine 窗口（ms）——= 24h。与 routine-file-gate.ts 既有 FILING_WINDOW_MS 缺省值逐字一致
 *  （迁移兼容：routine-file-gate.ts 的 FILING_WINDOW_MS 现由本常量派生）。
 *  concurrency-default-fallback: ⛔ 这不是【并发数】——是 routine 立案的【速率】配额缺省，其单一定义点
 *  就是本模块（drivers.yml `routine_quota` 段是真相源，此处是一致回退）。名字含 `quota` 只因 P1 关键词表
 *  把 CPU quota（P3）与 routine quota 共用；按 checker『非并发但撞关键词须显式声明以保持诚实』条款在此
 *  声明（同 RED_BACKLOG_CAP_DEFAULT 先例），⛔ 不是悄悄写死。 */
export const DEFAULT_ROUTINE_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 单 routine 缺省上限 K——与既有 DEFAULT_RATE 逐字一致（迁移兼容，同上）。
 *  concurrency-default-fallback: 同上——routine 速率配额缺省，非并发数。 */
export const DEFAULT_ROUTINE_QUOTA_K = 3;
/** 全部 routine 合计的缺省硬上限。⚠️ 结构性保守选择（详见 drivers.yml routine_quota 段注释），
 *  ⛔ 不是从事故阈值反推的实测值。
 *  concurrency-default-fallback: 同上——routine 速率配额缺省，非并发数。 */
export const DEFAULT_ROUTINE_QUOTA_GLOBAL_CEILING = 12;

/** routine 配额配置。 */
export interface RoutineQuotaConfig {
  windowMs: number;
  defaultK: number;
  globalCeiling: number;
  /** 具名 routine 的 K 覆盖（缺省 = defaultK）。已过滤掉非法项与「大于 globalCeiling」的荒谬项。 */
  perRoutine: Readonly<Record<string, number>>;
  /** 非空 ⇒ 配置【读到了】但至少一个字段被回退到缺省（fail-closed 取值的危险方向）。
   *  ⛔ 用来把「读不到」（文件缺失/坏 YAML/无本段 ⇒ 空数组）与「读到但荒谬」（有值 ⇒ 非空数组）
   *  区分开——两者都归一到缺省，但读者必须能读出是哪一种（硬规则 3b：读不懂不得与合格同形）。 */
  warnings: readonly string[];
}

/** 缺省 routine 配额配置（drivers.yml 缺失/不可解析/无本段时的回退；也是 parse 的 base）。 */
export function defaultRoutineQuotaConfig(): RoutineQuotaConfig {
  return {
    windowMs: DEFAULT_ROUTINE_QUOTA_WINDOW_MS,
    defaultK: DEFAULT_ROUTINE_QUOTA_K,
    globalCeiling: DEFAULT_ROUTINE_QUOTA_GLOBAL_CEILING,
    perRoutine: {},
    warnings: [],
  };
}

/** 正整数（≥1）解析：合法 ⇒ 该值；否则 push 一条留痕并返回 fallback（fail-closed 到缺省）。
 *  ⛔ window_ms 取 0/负数/非数 会让窗口变空（计数恒 0 ⇒ 闸变松）——是「取值的危险方向」，必须回退。 */
function positiveIntOrFallback(v: unknown, fallback: number, warnings: string[], field: string): number {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1) return v;
  warnings.push(`routine_quota.${field}: ${JSON.stringify(v)} 不是正整数 ⇒ 回退缺省 ${fallback}`);
  return fallback;
}

/** 读 drivers.yml 的 `routine_quota` 段。读失败/不可解析/段缺失 ⇒ 缺省（fail-open 到保守缺省，
 *  同 loadDriverConfig 既有风格）。⚠️ 但【取值的危险方向】必须 fail-closed——任何会让限流变松的坏值
 *  （global_ceiling 为 -1/0/非数字；per_routine 某项为非法值、或大于 global_ceiling 使单 routine 就能
 *  撑爆全局上限）都回退到缺省，⛔ 不采用「读到了但荒谬」的值。两类失败都归一到缺省，但留痕可区分。 */
export function loadRoutineQuotaConfig(root: string): RoutineQuotaConfig {
  const d = defaultRoutineQuotaConfig();
  const file = path.join(root, DRIVERS_CONFIG_REL);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return d; // 读不到 ⇒ 缺省（无「读到但荒谬」可报，warnings 空）
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    return d;
  }
  const section = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).routine_quota : undefined;
  if (!section || typeof section !== "object") return d; // 段缺失 ⇒ 缺省

  const s = section as Record<string, unknown>;
  const warnings: string[] = [];
  // ⛔ 区分「字段缺席」（⇒ 静默取缺省，用户只是没写这项）与「字段在场但值荒谬」（⇒ 取缺省【并留痕】）。
  // 混同会让一个只写了 global_ceiling 的合法配置文件被记两条假留痕（留痕就失去「读出是哪一项荒谬」的意义）。
  const pick = (key: "window_ms" | "default_k" | "global_ceiling", fallback: number): number =>
    key in s ? positiveIntOrFallback(s[key], fallback, warnings, key) : fallback;
  const windowMs = pick("window_ms", d.windowMs);
  const defaultK = pick("default_k", d.defaultK);
  const globalCeiling = pick("global_ceiling", d.globalCeiling);

  // per_routine：非映射 ⇒ 忽略（留痕）；每项必须正整数且 ≤ globalCeiling，否则丢弃该项（fail-closed
  // 到缺省——该 routine 之后走 default_k）。丢弃而非钳到 ceiling，是为了让「配置荒谬」显式可见，
  // 同时不变式（单 routine 有效 K ≤ globalCeiling）由 routineK 的 min() 兜底，无论配置怎么写都成立。
  const perRoutine: Record<string, number> = {};
  const raw = s.per_routine;
  if (raw != null) {
    if (typeof raw !== "object" || Array.isArray(raw)) {
      warnings.push(`routine_quota.per_routine: ${JSON.stringify(raw)} 不是映射 ⇒ 忽略`);
    } else {
      for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
          warnings.push(`routine_quota.per_routine.${name}: ${JSON.stringify(v)} 不是正整数 ⇒ 丢弃该项（回退缺省 default_k）`);
          continue;
        }
        if (v > globalCeiling) {
          warnings.push(
            `routine_quota.per_routine.${name}: ${v} > global_ceiling ${globalCeiling} ⇒ 丢弃该项（单 routine 不得突破全局上限）`,
          );
          continue;
        }
        perRoutine[name] = v;
      }
    }
  }
  return { windowMs, defaultK, globalCeiling, perRoutine, warnings };
}

/** 单一入口：给定 routine 名，解析其【有效 K】（per_routine 覆盖 > default_k），并钳到全局天花板。
 *  ⛔ 不变式（AC3）：无论配置怎么写，返回的 K 恒 ≤ routineGlobalCeiling(root)——default_k 本身也可能
 *  大于一个被调低的 global_ceiling，因此钳位是必须的，不能只依赖加载期已过滤 per_routine。 */
export function routineK(root: string, routine: string | null): number {
  const cfg = loadRoutineQuotaConfig(root);
  const override = routine != null ? cfg.perRoutine[routine] : undefined;
  const k = override != null ? override : cfg.defaultK;
  return Math.min(k, cfg.globalCeiling);
}

/** 单一入口：全局天花板（全部 routine 合计的硬上限）。 */
export function routineGlobalCeiling(root: string): number {
  return loadRoutineQuotaConfig(root).globalCeiling;
}
