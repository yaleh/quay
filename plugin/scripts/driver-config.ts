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

// ── goal 立案节流（gap-goal-driver-filing-throttle，`drivers.yml kinds.goal.filing`）──────────────
// WHY 这里是唯一声明点：立案节流此前**不存在**——`runGapSpawnPass` 只有每轮全局 `spawn_cap`，同一个 AC
// 只要仍处缺口态，下一轮就能再立案一次。生产读数（`.quay/goal-round.jsonl` 的 `gap_spawns`，2026-09-07
// → 2026-11-06）：373 次立案事件、172 个 AC、其中 74 个 AC 被重复立案；AC-214 同一 AC 立案 34 次、相邻
// 两次最短间隔 **2.9 分钟**（详细读数见 docs/evidence/2026-11-06-goal-filing-throttle.md）。
// ⇒ 成本不是「重复任务」，是同一 AC 的重复立案成本；节流是 per-AC 维度，不是全局名额维度。
//
// ⛔ 两个旋钮都是**策略值**（不是测量值），且都能由 drivers.yml 覆盖 —— 与 routine_quota 的先例同风格：
// 声明一个保守起点 + 说清它保守在哪，⛔ 不假装它是从事故阈值反推出来的最优值。
//   perAcCooldownMs：一次立案的**可观察结果**落定需要多久。实测同一 filed 行的核验延迟 475.7s
//     （spawned 07:49:45.867Z → filed 07:57:41.597Z），而真实重复间隔是 2.9–17.9 分钟 ⇒ 6h ≫ 两者，
//     使得任何在冷却窗内的重复立案，按构造都是对「世界没变」的再立案（硬规则 4 推论四：措辞是假说，
//     所以它同时是**可覆盖的配置项**，不是写死的常量）。
//   perAcPerDay：与同文件 `routine_quota.default_k: 3`（人已裁定的「单例程每日立案上限」）取同一个数
//     —— 同一条「每日立案上限」政策，两个消费面共用一个取值，⛔ 不另造第二个数。
// ⚠️ 两个缺省常量的**定义点**在 routine_quota 段之后（`DEFAULT_GOAL_FILING_*`）：perAcPerDay 直接引
// `DEFAULT_ROUTINE_QUOTA_K`，把定义放在它之前会撞 TDZ，而在两处各写一个 3 就是第二份字面量。

/** 立案节流配置。 */
export interface GoalFilingConfig {
  /** 同一 AC 两次立案之间的最小间隔（毫秒）。0 = 不设冷却（显式关闭，⛔ 不是「非法值」）。 */
  perAcCooldownMs: number;
  /** 同一 AC 在**尾随 24h 窗口**内的立案次数上限（≥1）。 */
  perAcPerDay: number;
  /** 非空 ⇒ 本段【读到了】但有字段被回退到缺省（硬规则 3b：与「没写这一段」不同形）。 */
  warnings: readonly string[];
}

/** 缺省立案节流配置（drivers.yml 缺失/无本段时的回退；也是 parse 的 base）。 */
export function defaultGoalFilingConfig(): GoalFilingConfig {
  return {
    perAcCooldownMs: DEFAULT_GOAL_FILING_COOLDOWN_MS,
    perAcPerDay: DEFAULT_GOAL_FILING_PER_AC_PER_DAY,
    warnings: [],
  };
}

/** goal kind 的配置块：通用三项 + 立案节流（⛔ 只有 goal 有 `filing` 段）。 */
export interface GoalKindConfig extends DriverKindConfig {
  filing: GoalFilingConfig;
}

/** 完整 driver 配置（promotion + worker + outer + quality + meta + goal）。 */
export interface DriverConfig {
  promotion: DriverKindConfig;
  worker: DriverKindConfig;
  outer: DriverKindConfig;
  quality: DriverKindConfig;
  meta: DriverKindConfig;
  goal: GoalKindConfig;
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
    // `filing` = 立案节流的两项（见上方「goal 立案节流」一节）；⛔ 只有 goal 有这一段。
    goal: { cap: DEFAULT_DRIVER_CAP, intervalMs: DEFAULT_INTERVAL_MS, reconcileIntervalSecs: 0, filing: defaultGoalFilingConfig() },
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
    // goal 的 filing 段与通用三项**分别**合并：`kinds.goal.filing` 是嵌套映射，⛔ 不能交给
    // mergeKindConfig（它只认 cap/interval_ms/reconcile_interval_secs 三个标量）。
    goal: {
      ...mergeKindConfig(kinds.goal, d.goal),
      filing: mergeGoalFilingConfig(goalFilingSectionOf(kinds.goal), d.goal.filing),
    },
  };
}

/** 取 `kinds.goal.filing` 段（非映射 ⇒ undefined，与「段不存在」同一路径 ⇒ 缺省）。 */
function goalFilingSectionOf(goalRaw: unknown): unknown {
  const r = (goalRaw && typeof goalRaw === "object" ? goalRaw : {}) as Record<string, unknown>;
  return r.filing;
}

/**
 * 合并 `kinds.goal.filing`。⛔ 三类输入必须**可分**（硬规则 3b）：
 *   · 段不存在 / 不是映射 ⇒ 全部取缺省，`warnings` **为空**（「没写这一段」不是一个异常）；
 *   · 段在场且字段缺席 ⇒ 该字段取缺省，`warnings` 仍为空（用户只是没写这一项）；
 *   · 段在场但字段值荒谬 ⇒ 该字段回退缺省 **并留痕**（「读到但荒谬」，与「没写」不同形）。
 * 荒谬 = 会让节流**变松**或不可判读的取值：冷却 < 0 / 非有限数 / 非整数；每日上限 < 1 或非整数。
 * ⚠️ 冷却 `0` 是**合法值**（显式关闭节流，同 `ci_runs_collect_throttle_ms` 的 `>= 0` 约定），⛔ 不算荒谬。
 */
export function mergeGoalFilingConfig(raw: unknown, d: GoalFilingConfig): GoalFilingConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d, warnings: [] };
  const s = raw as Record<string, unknown>;
  const warnings: string[] = [];
  // ⚠️ 拼写两种都接受：本文件其余字段是 snake_case（`spawn_cap` / `gap_worker_timeout_ms`），而任务的 AC
  // 逐字写的是 `perAcCooldownMs` / `perAcPerDay`（= 本接口的字段名）。两处都必须能写 ⇒ 同义键，snake 优先。
  // ⛔ 这是**同一个旋钮的两种拼写**，不是两个旋钮：同义键同时给出且取值不同时，snake 胜出（确定、可测）。
  const pick = (snake: string, camel: string, fallback: number, valid: (v: unknown) => v is number, rule: string): number => {
    if (snake in s) {
      const v = s[snake];
      if (valid(v)) return v;
      warnings.push(`kinds.goal.filing.${snake}: ${JSON.stringify(v)} ${rule} ⇒ 回退缺省 ${fallback}`);
      return fallback;
    }
    if (camel in s) {
      const v = s[camel];
      if (valid(v)) return v;
      warnings.push(`kinds.goal.filing.${camel}: ${JSON.stringify(v)} ${rule} ⇒ 回退缺省 ${fallback}`);
      return fallback;
    }
    return fallback;
  };
  const isCooldown = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
  const isPerDay = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 1;
  return {
    perAcCooldownMs: pick("per_ac_cooldown_ms", "perAcCooldownMs", d.perAcCooldownMs, isCooldown, "不是 ≥0 的整数毫秒"),
    perAcPerDay: pick("per_ac_per_day", "perAcPerDay", d.perAcPerDay, isPerDay, "不是 ≥1 的整数"),
    warnings,
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

/** 缺省 per-AC 立案冷却（毫秒）。⚠️ **策略值**（不是测量值），推导理由见文件上方「goal 立案节流」
 *  一节：实测 filed 行核验延迟 475.7s、真实同 AC 重复立案间隔 2.9–17.9 分钟 ⇒ 6h ≫ 两者。
 *  concurrency-default-fallback: ⛔ 不是并发数——是【立案速率】的冷却缺省（同上一条的诚实声明条款）。 */
export const DEFAULT_GOAL_FILING_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** 缺省 per-AC 每日立案上限。⚠️ **策略值**，与 `DEFAULT_ROUTINE_QUOTA_K` **同一个取值**（同一条
 *  「每日立案上限」政策；⛔ 不另写一个 3 —— 那就成了第二个字面量）。
 *  concurrency-default-fallback: 同上——立案速率配额缺省，非并发数。 */
export const DEFAULT_GOAL_FILING_PER_AC_PER_DAY = DEFAULT_ROUTINE_QUOTA_K;

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

/** 单一入口：rate 窗口（ms，尾窗宽度）。立案计数的两个调用点（probe-routine.ts 的 per-routine /
 *  全局读数、meta-driver.ts 的 driveItems 全局读数）都从这里取窗口，⛔ 不再各自引用孤儿常量
 *  FILING_WINDOW_MS——那正是「`window_ms` 解析出来却无人消费」的缺口（硬规则 3b / 规则 9：
 *  声明了却不生效的旋钮，与「没有这个旋钮」同形）。缺省 = DEFAULT_ROUTINE_QUOTA_WINDOW_MS（24h），
 *  与旧常量逐字相等 ⇒ 缺省行为逐字节不变。 */
export function routineWindowMs(root: string): number {
  return loadRoutineQuotaConfig(root).windowMs;
}

// ── design-evolution-readings 的 dark-streak 策略轮数 ─────────────────────────────────────────────
// (tasks/gap-design-evolution-readings-emit-findings)
//
// ⛔ 定义点只有一处：`design-evolution-readings.ts` 的 `DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT`
// （该值是该机制唯一的策略数，注释里写明它是**策略选择**而非测量结果）。本文件只做**派生出口**——
// 驱动侧（quality-gate-driver）与配置解析侧从同一条 `driver-config` 面取到它，而不是各自再写一个字面量。
// ⚠️ 这是 re-export，不是第二份定义：改值只改 design-evolution-readings.ts 那一处。
// ⛔ 本文件不 import 任何其他模块去「猜」这个值（例如从 `.quay/config.yml` 读段）：段是**覆盖**面，
// 缺省值必须由代码定义，否则「配置没写」与「配置写坏了」会落到同一个数上。
export { DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT } from "./design-evolution-readings.ts";
