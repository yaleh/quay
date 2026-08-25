// plugin/scripts/driver-filters.ts — AC152: 派发前过滤的【可组合谓词列表】单一实现。
// (tasks/gap-ac152-filter-composable-predicate-list)
//
// WHY THIS EXISTS（manager-phase-goal.md ### AC152 / SPEC-unified-driver-architecture §2.1）：
// worker-driver 与 promotion-driver 各自维护一个派发前过滤谓词的【随机子集】——
//   notInFlight            worker 有       promotion 无
//   depsSatisfied          ⛔ 两个都无     ← ac138 白烧 15 分钟
//   touchesDisjoint        ⛔ 两个都无     ← Git-History 群组撞 serve-handlers.ts 的风险
//   retryCapNotExhausted   promotion 有    worker 无
//   notNeedsHuman          promotion 有    worker 无
// 同一个缺失的抽象有两种表现。本文件把五个谓词做成一个列表 TASK_FILTERS 里的元素，两 driver 共用
// （⛔ 不各写一遍）。AC1 取假（一条命令可验）：给两个 driver 同时新增一个谓词，若需要改两处以上
// ⇒ 假——新增 = 往 TASK_FILTERS 数组加一行，两 driver 经 applyTaskFilters 同时生效。
//
// 单一真相源（⛔ 本文件不重写、只复用）：
//   依赖解析 readDependsOn            → task-schema.ts
//   Touches 解析 parseTouches / 互斥  → touches-orthogonality-check.ts
//   声明路径展开 expandDeclaredTouches → concurrent-batch-scheduler.ts
//   frontmatter 读 readFrontmatter     → gate-script-base.ts

import fs from "node:fs";
import path from "node:path";
import { readFrontmatter } from "./gate-script-base.ts";
import { parseTask, readDependsOn } from "./task-schema.ts";
import { parseTouches, checkTouchesPair } from "./touches-orthogonality-check.ts";
import { expandDeclaredTouches } from "./concurrent-batch-scheduler.ts";

// ── 谓词上下文 ───────────────────────────────────────────────────────────────────────────────────────

/** 派发前过滤的上下文（两 driver 各自构造，谓词只读）。 */
export interface FilterContext {
  /** repo root（读 tasks/<id>.md 用）。 */
  root: string;
  /** 当前在飞任务 id（notInFlight / touchesDisjoint 用）。 */
  inFlight: string[];
  /** 已耗尽重试上限的任务 id（retryCapNotExhausted 用；worker 无重试上限 ⇒ 空集）。 */
  retryExhausted: Set<string>;
}

/** 构造缺省上下文（inFlight/retryExhausted 空集），调用方按需覆盖。 */
export function makeFilterContext(
  root: string,
  overrides: Partial<Omit<FilterContext, "root">> = {},
): FilterContext {
  return { root, inFlight: [], retryExhausted: new Set(), ...overrides };
}

/** 一个可组合过滤谓词。`predicate(ctx)` 从上下文构造 `(id) => boolean`（一次构造、逐候选判定），
 *  `true` = 保留该候选，`false` = 滤掉。 */
export interface TaskFilter {
  name: string;
  predicate: (ctx: FilterContext) => (id: string) => boolean;
}

// ── 共享的依赖判定核（ready-pool-check 的 depsReadyFor 亦复用，⛔ 不各写一遍） ────────────────────────

/** 依赖是否全部 done。`statusOf(depId)` 返回依赖的 status（读不懂/缺失 ⇒ null ⇒ 非 done ⇒ false）。
 *  `depIds` 空 ⇒ 真无依赖 ⇒ true（⛔ 不是「读不懂」——读不懂由 statusOf 返回 null 表达）。 */
export function allDepsDone(depIds: string[], statusOf: (depId: string) => string | null): boolean {
  if (depIds.length === 0) return true;
  for (const depId of depIds) {
    if (statusOf(depId) !== "done") return false;
  }
  return true;
}

/** 读任务 status frontmatter（`<root>/tasks/<id>.md`）。缺失/读失败 ⇒ null。 */
export function readTaskStatus(root: string, taskId: string): string | null {
  try {
    const fm = readFrontmatter(path.join(root, "tasks", `${taskId}.md`));
    return fm?.status ?? null;
  } catch {
    return null;
  }
}

// ── 五个谓词（可组合列表的元素） ─────────────────────────────────────────────────────────────────────

/** 候选不在在飞集内。 */
export const notInFlight: TaskFilter = {
  name: "notInFlight",
  predicate: (ctx) => {
    const inFlight = new Set(ctx.inFlight);
    return (id) => !inFlight.has(id);
  },
};

/** 候选的 depends_on 全部 done（ac138 白烧一轮防）。候选自身文件读失败 ⇒ false（fail-closed）。 */
export const depsSatisfied: TaskFilter = {
  name: "depsSatisfied",
  predicate: (ctx) => (id) => {
    let frontmatterRaw: string;
    try {
      const text = fs.readFileSync(path.join(ctx.root, "tasks", `${id}.md`), "utf8");
      frontmatterRaw = parseTask(text).frontmatterRaw;
    } catch {
      return false; // 候选文件不可读 ⇒ fail-closed（不派发）
    }
    return allDepsDone(readDependsOn(frontmatterRaw), (depId) => readTaskStatus(ctx.root, depId));
  },
};

/** 候选的 ## Touches 与所有在飞任务的 Touches 互斥（fan-in 才炸防）。无在飞 ⇒ 全通过；读不懂
 *  ⇒ 视为无 Touches ⇒ checkTouchesPair 判 serialize ⇒ 滤掉（与 checkTouchesPair 的保守缺省同向）。 */
export const touchesDisjoint: TaskFilter = {
  name: "touchesDisjoint",
  predicate: (ctx) => {
    if (ctx.inFlight.length === 0) return () => true;
    const expand = (globs: string[]) => expandDeclaredTouches(globs, ctx.root);
    const readTouches = (id: string) => {
      const file = path.join(ctx.root, "tasks", `${id}.md`);
      let raw: string;
      try {
        raw = fs.readFileSync(file, "utf8");
      } catch {
        return { hasSection: false, globs: [] as string[] };
      }
      return parseTouches(parseTask(raw).body);
    };
    const inFlight = ctx.inFlight.map(readTouches);
    return (id) => inFlight.every((ifp) => checkTouchesPair(readTouches(id), ifp, expand).disjoint);
  },
};

/** 候选未耗尽重试上限（AC133 失败上限）。worker 无重试上限 ⇒ ctx.retryExhausted 空 ⇒ 恒 true。 */
export const retryCapNotExhausted: TaskFilter = {
  name: "retryCapNotExhausted",
  predicate: (ctx) => (id) => !ctx.retryExhausted.has(id),
};

/** 候选未被标 needs-human（status 非 needs-human）。读不懂 ⇒ fail-closed 滤掉（⛔ 读不懂 ≠ 合格）。 */
export const notNeedsHuman: TaskFilter = {
  name: "notNeedsHuman",
  predicate: (ctx) => (id) => {
    const status = readTaskStatus(ctx.root, id);
    return status !== null && status !== "needs-human";
  },
};

// ── 可组合谓词列表（单一真相源：两 driver 共用，⛔ 不各写一遍） ─────────────────────────────────────

/** 派发前过滤的可组合谓词列表。新增谓词 = 往这里加一行，worker / promotion 两 driver 同时生效
 *  （经 applyTaskFilters 消费）。⛔ 本文件之外不得再出现一份谓词实现。 */
export const TASK_FILTERS: readonly TaskFilter[] = [
  notInFlight,
  depsSatisfied,
  touchesDisjoint,
  retryCapNotExhausted,
  notNeedsHuman,
];

/** 对候选 id 列表应用谓词列表（缺省 = 全部 TASK_FILTERS；`names` 传子集——promotion 的 fix pass
 *  只消费 retryCapNotExhausted / notNeedsHuman，其余（deps/touches/in-flight）由 ready-pool-check 的
 *  eligible 已在闸内判定，再滤一遍会丢掉 AC134 的 skip 台账）。谓词逐个构造一次，再逐候选判定。 */
export function applyTaskFilters(candidateIds: string[], ctx: FilterContext, names?: readonly string[]): string[] {
  const filters = names ? TASK_FILTERS.filter((f) => names.includes(f.name)) : [...TASK_FILTERS];
  const preds = filters.map((f) => f.predicate(ctx));
  return candidateIds.filter((id) => preds.every((p) => p(id)));
}
