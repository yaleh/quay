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

/** 完整 driver 配置（promotion + worker）。 */
export interface DriverConfig {
  promotion: DriverKindConfig;
  worker: DriverKindConfig;
}

/** 缺省配置（drivers.yml 缺失/不可解析时的回退；也是 parse 的 base）。 */
export function defaultDriverConfig(): DriverConfig {
  return {
    promotion: { cap: DEFAULT_DRIVER_CAP, intervalMs: DEFAULT_INTERVAL_MS, reconcileIntervalSecs: 0 },
    worker: { cap: DEFAULT_DRIVER_CAP, intervalMs: DEFAULT_INTERVAL_MS, reconcileIntervalSecs: DEFAULT_RECONCILE_INTERVAL_SECS },
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
  };
}

/** 单一并发 cap 解析（AC1 取假消点）：explicit（CLI --cap/--concurrency）优先 → drivers.yml cap →
 *  保守缺省 DEFAULT_DRIVER_CAP。⛔ 全仓库并发解析只此一份——promotion resolveCap / worker
 *  resolveConcurrency / cap-from-gate effective_cap 全部经本函数或 loadDriverConfig 派生。 */
export function driverCap(root: string, kind: "promotion" | "worker", explicit?: number): number {
  if (explicit != null && Number.isInteger(explicit) && explicit >= 1) return explicit;
  const c = loadDriverConfig(root)[kind].cap;
  if (Number.isInteger(c) && c >= 1) return c;
  return DEFAULT_DRIVER_CAP;
}
