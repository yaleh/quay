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
import { execFileSync } from "node:child_process";
import { readFrontmatter } from "./gate-script-base.ts";
import { parseTask, readDependsOn, readTaskStatusAtRef } from "./task-schema.ts";
// gap-task-ops-consolidate-driver-frontmatter-writers：frontmatter parse/patch + commit 单一真相源
// 上收到 task-ops.ts（⛔ 本文件不再各写一份 regex+writeFileSync+git 序列）。
import { splitTaskFile, statusFromFrontmatter, patchStatusField, commitTaskFile, hasPriorCommit } from "./task-ops.ts";
// gap-task-status-events-contract-v1（本文件的两个 status writer 接线）：kernel 单一事件写入器 +
// 转移表判 kind + git blob 摘要（`git hash-object` 的纯函数形）。⛔ 不在此重写「写事件」的第二份。
// GOAL-037（AC-362）filtered-empty 归因：waitedMinutes 的载体读面 = kernel 单一转移视图读取器
// （⛔ 不手搓 jsonl 解析，硬规则 1）。
import { edgeKindFor, appendTaskStatusEvent, gitBlobSha, readTaskStatusTransitions } from "../../packages/quay/src/kernel/task-transition.ts";
import { parseTouches, checkTouchesPair, normalizePath, matchGlob } from "./touches-orthogonality-check.ts";
import { expandDeclaredTouches } from "./concurrent-batch-scheduler.ts";
// GOAL-037（AC-365）放宽谓词的【配置面】：只读，单一实现在 AC-364 的模块里（硬规则 1 / 5b——
// ⛔ 本文件不复写第二个 config 解析器）。
// ⚠️ 账本面（AC-363 的 `readRelaxedDispatchLedger`）**故意不 import**：`relaxed-dispatch-ledger.ts`
// 已从本文件取 `WORKER_OUTCOME_REL`，反向再 import 会形成【值环】，而 `import-graph-check` 的
// shrink-only 棘轮把 valueSccs 钉在 0（新环是 RED，且基线只许降不许升）。名额读数因此由 `ctx` 带入
// （见 `FilterContext.relaxedInFlight`）；⛔ 本文件不自己解析那份 jsonl，也不复写它的路径语义。
import { loadTouchesRelaxConfig, type TouchesRelaxConfig } from "./touches-relax-config.ts";
// gap-develop-sync-reset-hard-destroys-third-party-project-tree：终局解可弃性判定复用【既有的】
// 任务板/文档面清单（⛔ 不重写第二份——driver-filters.ts 自己的头注释即「不重写、只复用」）。
import { DOC_SURFACES } from "./select-static-checks-for-touches.ts";
import { TASK_STATUS, TASK_STATUSES, isTaskStatus } from "./task-status.ts";

// ── 谓词上下文 ───────────────────────────────────────────────────────────────────────────────────────

/** 派发前过滤的上下文（两 driver 各自构造，谓词只读）。 */
export interface FilterContext {
  /** repo root（读 tasks/<id>.md 用）。 */
  root: string;
  /** 当前在飞任务 id（notInFlight / touchesDisjoint 用）。 */
  inFlight: string[];
  /** 已耗尽重试上限的任务 id（retryCapNotExhausted 用；worker 无重试上限 ⇒ 空集）。 */
  retryExhausted: Set<string>;
  /** GOAL-037（AC-365）：当前**已被放宽派发**的在飞任务数（`touchesDisjointOrAged` 的
   *  `quota-available` 条件读它）。缺省 0 —— 在 shadow 下这是一个**结构性事实**（影子期不放行 ⇒
   *  没有任何任务是被放宽派发的），不是「猜一个默认值」。
   *  ⛔ 由调用方带入而非本文件去读 AC-363 的账本：`relaxed-dispatch-ledger.ts` 已从本文件取
   *  `WORKER_OUTCOME_REL`，反向 import 会形成值环（`import-graph-check` 的 shrink-only 棘轮把
   *  valueSccs 钉在 0）。live 下由 AC-366 从账本算出后经此传入。 */
  relaxedInFlight?: number;
}

/** 构造缺省上下文（inFlight/retryExhausted 空集），调用方按需覆盖。 */
export function makeFilterContext(
  root: string,
  overrides: Partial<Omit<FilterContext, "root">> = {},
): FilterContext {
  return { root, inFlight: [], retryExhausted: new Set(), ...overrides };
}

/** GOAL-036：一轮派发里 {inFlight, retryExhausted} 的【单一计算点】。纯函数——只读入参、无 I/O、无
 *  await，输入相同必得相同输出（determinism）。抽出的原因：worker-driver 的驻留环里两个消费者
 *  （ready-pool 与 apply-filters）原本各自独立调用 `inFlightTasks()`，两调用间夹着一个 `await`
 *  （readyPoolCheck 是异步子进程调用），该窗口内 running/coldInflight 变动 ⇒ 同轮的两次读数可能
 *  不一致，尽管两者本应看到同一份【轮起点快照】。
 *  ⛔ 只覆盖 {inFlight, retryExhausted}：backoff（isBackedOff + Date.now()）【不在】本函数内——它必须
 *  按候选、在过滤那一刻取【新鲜】的 Date.now()，预计算进轮起点快照会复活已修的
 *  gap-worker-driver-selector-api-error-no-backoff AC2。 */
export function computeDispatchExclusion(
  running: { task: string }[],
  coldInflight: Set<string>,
  retryState: RetryState,
): { inFlight: string[]; retryExhausted: Set<string> } {
  return {
    inFlight: running.map((r) => r.task).concat([...coldInflight]),
    retryExhausted: retryState.needsHuman,
  };
}

/** 一个可组合过滤谓词。`predicate(ctx)` 从上下文构造 `(id) => boolean`（一次构造、逐候选判定），
 *  `true` = 保留该候选，`false` = 滤掉。 */
export interface TaskFilter {
  name: string;
  predicate: (ctx: FilterContext) => (id: string) => boolean;
}

// ── 共享的依赖判定核（ready-pool-check 的 depsReadyFor 亦复用，⛔ 不各写一遍） ────────────────────────

// 依赖判定的【三值】核（gap-superseded-dependency-blocks-dispatch-forever）。
//
// WHY THREE VALUES, NOT ONE BOOLEAN（硬规则 3b + 硬规则 4c）：
// `superseded` 是【终态】——该前置被人裁定退役（前提被删除），其继任者承载真依赖。
// 修前 `allDepsDone` 只认 `done` ⇒ 一条指向 superseded 的任务 `depsReady` 【恒为 false】，
// 且【没有任何事件能把它翻过来】。于是它在台账里与「依赖尚未满足」**同形**（`depsReady=false`），
// 生产上表现为连续 260+ 轮 `unfixable:["depsReady==false"]` 的永久停摆（实证对象
// gap-ac194-production-criterion-owner）。这正是硬规则 3b 的形态：**不可满足**被伪装成**尚未满足**。
// 反向的同形同样禁止：把退役依赖静默当成 `done`（那就把「它的前提没了」伪装成「它的前提做完了」）。
// ⇒ 判定必须给出【可区分的读数】：退役依赖走**自己的集合**，既不与 done 合并，也不落进 blocking。
//
// 同一条原则在本仓的散文路径上【已经修过】——ready-pool-check.ts prosePrereqRefs 的 add() 逐字写着
// 「A retired task (`superseded`) is not a current-prereq target — its successor carries the real
// dependency」，并与 `done` 一起排除出 gap 集。本条是把同一个判据补到【关系边】这条路径上
// （硬规则 5b：同一原则的其它适用点）。

/** 单条依赖的判定态。
 *  `done`       — 已落地，前置已满足（正常路径）。
 *  `superseded` — 该前置已被人裁定退役（终态）。**不再阻塞**，但 ⛔ 不等于 done。
 *  `blocking`   — 仍须等待：todo / ready / needs-human / 读不出（null）/ 任何未知取值。fail-closed。 */
export type DepVerdict = "done" | "superseded" | "blocking";

/** 依赖判定的【可区分读数】。`ready` 是给既有布尔消费方（谓词 / 准入合取）的投影；
 *  「有没有退役依赖」这件事**只在 `supersededDeps` 上可见**——⛔ 不合并进 `doneDeps`
 *  （硬规则 3b：一个判定若能区分「已退役」与「已完成」，它才能把永久停摆与一切正常分开）。
 *  `blockingDeps` 与 `doneDeps` 同时非空是可能的，`ready` 只由 `blockingDeps` 决定。 */
export interface DepsReadiness {
  /** 没有【活的】未满足前置（`blockingDeps` 为空）。⚠️ ready ≠ 「依赖全 done」—— 见 `supersededDeps`。 */
  ready: boolean;
  /** 已落地（`done`）的依赖 id。 */
  doneDeps: string[];
  /** 已退役（`superseded`）的依赖 id —— 单独一类，⛔ 既不入 `doneDeps` 也不入 `blockingDeps`。 */
  supersededDeps: string[];
  /** 仍阻塞的依赖 id（todo / ready / needs-human / 读不出 / 未知）—— fail-closed 集合。 */
  blockingDeps: string[];
}

/** 状态词 → 三值判定。**单一真相源**：所有依赖边判定（本文件 depsSatisfied、ready-pool-check
 *  depsReadinessFor、slot-refill depsReadyFor、portfolio-choice findUnmetDependency）共用这一份，
 *  ⛔ 不各写一遍 `=== "done" || === "superseded"`。
 *  读不懂/缺失/无此键（`null` / `undefined`）⇒ `blocking`（fail-closed：⛔ 不得伪装成 done 或
 *  superseded）。`undefined` 是 Map `.get()` 的缺失形态（portfolio-choice 的 statusById），与 `null`
 *  同为「读不出」，⛔ 不因为类型更宽就换一个判定。 */
export function judgeDepStatus(status: string | null | undefined): DepVerdict {
  if (status === TASK_STATUS.DONE) return "done";
  if (status === TASK_STATUS.SUPERSEDED) return "superseded";
  return "blocking";
}

/** 依赖集判定核。`depIds` 空 ⇒ `ready=true` 且三个集合皆空（真无依赖；⛔ 不是「读不懂」——
 *  读不懂由 `statusOf` 返回 null 表达）。同一条 depId 重复出现 ⇒ 逐次入集（不静默去重）。 */
export function judgeDeps(depIds: string[], statusOf: (depId: string) => string | null): DepsReadiness {
  const out: DepsReadiness = { ready: true, doneDeps: [], supersededDeps: [], blockingDeps: [] };
  for (const depId of depIds) {
    switch (judgeDepStatus(statusOf(depId))) {
      case "done":
        out.doneDeps.push(depId);
        break;
      case "superseded":
        out.supersededDeps.push(depId);
        break;
      default:
        out.blockingDeps.push(depId);
        out.ready = false;
    }
  }
  return out;
}

/** 依赖是否【不再需要等待】：每个依赖要么 done，要么已被裁定退役（superseded）。
 *  ⚠️ 名字里的 `Done` 是 gap-ac152 起的既有 API 名（driver-runtime 再导出、单测逐字钉着、
 *  下游 skip 台账写 `depsReady=false`），语义是「没有【活的】未满足前置」，不是「字面全 done」。
 *  两者的区别**不在这里**（这里是布尔投影），而在 `judgeDeps` 的 `doneDeps` / `supersededDeps`
 *  两个【分开的】集合上——需要区分时用 `judgeDeps`，⛔ 不要从这个布尔值上猜。
 *  仍 fail-closed：`ready` / `todo` / `needs-human` / 读不出（null）/ 未知取值 ⇒ false。 */
export function allDepsDone(depIds: string[], statusOf: (depId: string) => string | null): boolean {
  return judgeDeps(depIds, statusOf).ready;
}

// readTaskStatusAtRef — SINGLE-SOURCE in task-schema.ts (gap-task-status-parsing-reimplemented-13-sites).
// Formerly verbatim-copied here + ready-pool-check.ts + worker-driver.ts (async); now imported + re-exported
// (driver-filters.test.mjs imports it from this module). The canonical-source rationale (develop ref, NOT
// the stale main checkout — 硬规则 4b) is documented on readTaskStatus below.
export { readTaskStatusAtRef };

/** 读任务 status frontmatter。canonical source = develop ref（readTaskStatusAtRef）；ref 读不可用
 *  （非 git root / 任务尚未入 develop）⇒ 退回盘上 `<root>/tasks/<id>.md`（既有行为——单测临时目录、
 *  repo-less root 的 no-op 回退）。⛔ develop 可用时不得读主检出盘上 status（陈旧快照）。缺失/读失败
 *  ⇒ null。 */
export function readTaskStatus(root: string, taskId: string): string | null {
  const refStatus = readTaskStatusAtRef(root, "develop", taskId);
  if (refStatus !== null) return refStatus;
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

/** 候选的 depends_on 全部【不再需要等待】（done，或已被裁定退役的 superseded —— 见 judgeDeps：
 *  一个指向 superseded 的依赖没有任何未来事件能翻成 done，若在此处仍当阻塞，候选就是永久不可派发）。
 *  ⛔ ready / todo / 读不出 仍阻塞。候选自身文件读失败 ⇒ false（fail-closed）。
 *  需要区分「依赖已退役」与「依赖全 done」时用 judgeDeps（谓词按契约只回布尔）。 */
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
    const { expand, readTouches } = makeTouchesSideReaders(ctx);
    const inFlight = ctx.inFlight.map(readTouches);
    return (id) => inFlight.every((ifp) => checkTouchesPair(readTouches(id), ifp, expand).disjoint);
  },
};

/** touches 判定的两侧读取（展开器 + 逐 id 的 `parseTouches`）。抽出来只为让【谓词】与【归因】
 *  读同一份单一真相源函数（`expandDeclaredTouches` / `parseTouches`），⛔ 不是第二种重叠数学。 */
function makeTouchesSideReaders(ctx: FilterContext): {
  expand: (globs: string[]) => Set<string>;
  readTouches: (id: string) => { hasSection: boolean; globs: string[] };
} {
  return {
    expand: (globs) => expandDeclaredTouches(globs, ctx.root),
    readTouches: (id) => {
      const file = path.join(ctx.root, "tasks", `${id}.md`);
      let raw: string;
      try {
        raw = fs.readFileSync(file, "utf8");
      } catch {
        return { hasSection: false, globs: [] as string[] };
      }
      return parseTouches(parseTask(raw).body);
    },
  };
}

// ── GOAL-037（AC-365）：`touchesDisjointOrAged` —— off 逐候选同形 / shadow 只标注不放行 ────────────
//
// 为什么是【同一个】谓词而不是「再加一个」：GOAL-037 的整条生效路径（P1 shadow 观察 → P2 live 小名额
// → P4 评估）都以「touches 这一条判定在 off 下与现状逐字节相同」为前提。往 TASK_FILTERS 里【追加】第六
// 个谓词会让 off 下的过滤面多一条判定（那不是同形）；所以是 **取代** `touchesDisjoint` 在列表中的那一
// 格，`touchesDisjoint` 本身【保留导出】——它仍是 off 语义的单一实现（本条直接委托它），也是本条测试
// 用来独立算出基线的那个函数（硬规则 5b：⛔ 不写第二份 off 实现）。
//
// 判别力从哪来（硬规则 4：结构上不可能取假的量不是测量）：若 off 分支直接委托 `touchesDisjoint`，
// 那么「新谓词 vs 旧谓词」的断言会退化成自证。真正的判别力来自**配置块的存在不得泄漏进 off 决策**——
// 一个 `mode: off` 但 `after_minutes` / `max_relaxed_inflight` 齐备、且候选等待时长**确实超过**
// `after_minutes` 的 fixture，会让「只在『任务够老』上做判断、忘了先看 mode」的实现放行而变红。

/** 放宽词表的条件 id（稳定，按合取顺序求值）。⛔ 这里【没有】阈值——`after_minutes` /
 *  `max_relaxed_inflight` / `never_relax` / `shared_files` 全部来自 AC-364 读出的配置。 */
export const RELAX_CONDITIONS = [
  "touches-only-blocker",
  "waited-enough",
  "quota-available",
  "not-never-relax",
  "overlap-shared",
] as const;

export type RelaxCondition = (typeof RELAX_CONDITIONS)[number];

/** 一个候选本轮的放宽判定读数：`wouldRelax` + 首个不满足的条件 id（全满足 ⇒ `null`）。 */
export interface RelaxAnnotation {
  wouldRelax: boolean;
  relaxBlockedBy: RelaxCondition | null;
}

/** 本轮放宽判定的【轮起点状态】：配置与账本各读一次（⛔ 不逐候选重读盘——AC-364 / AC-363 的读取器
 *  都是每轮一次的调用）。`annotate` 为假时（off / 读不懂的声明）不产生任何标签：AC-364 的 fail-closed
 *  姿态——读不懂 ⇒ 按最保守的 off 行为，而 ⛔ 绝不放行。 */
interface RelaxRoundState {
  annotate: boolean;
  config: TouchesRelaxConfig;
  relaxedInFlight: number;
  readyAtMs: Map<string, number>;
  nowMs: number;
}

/** 构造本轮状态。配置每轮读一次（⛔ 不逐候选重读盘）。名额读数由 `ctx` 带入：`ctx.relaxedInFlight`
 *  缺省 0 —— 在 shadow 下这是结构性事实（影子期不放行 ⇒ 无任务是被放宽派发的）。 */
function makeRelaxRoundState(ctx: FilterContext): RelaxRoundState {
  const load = loadTouchesRelaxConfig(ctx.root);
  const config = load.config ?? { mode: "off" as const, shared_files: [], never_relax: [] };
  const annotate = load.state === "shadow" || load.state === "live";
  return {
    annotate,
    config,
    relaxedInFlight: ctx.relaxedInFlight ?? 0,
    // 等待时长的单一来源 = AC-362 已落地的 `buildReadyAtMsMap`（⛔ 不新写第二个 ready 时刻解析器）。
    readyAtMs: annotate ? buildReadyAtMsMap(ctx.root) : new Map(),
    nowMs: Date.now(),
  };
}

/** 重叠面 ⊆ `shared_files` 白名单（AC-364 的 `shared_files` 是**逐元素 glob**——配置测试里就给过一条
 *  星号式 glob，故逐元素 `matchGlob` 而非字符串相等）。空重叠面 ⇒ false：「无重叠」不是「重叠都在
 *  白名单里」，那是另一件事。 */
function overlapsAllShared(overlapFiles: string[], sharedFiles: string[]): boolean {
  if (overlapFiles.length === 0) return false;
  return overlapFiles.every((f) => sharedFiles.some((g) => matchGlob(g, f)));
}

/** 逐候选求值五条件的合取，返回首个不满足者。`blocked` = 本轮**所有**滤掉该候选的谓词名
 *  （条件①「只有该轮确实被 touches 单独挡住才允许放宽」的判定输入，GOAL-037 风险节逐字）。 */
function judgeRelaxCandidate(
  id: string,
  blocked: readonly string[],
  waits: number | null,
  overlaps: string[],
  state: RelaxRoundState,
): RelaxAnnotation {
  // ① touches-only-blocker —— 除 touches 外没有別的谓词也滤掉它。
  if (!(blocked.length === 1 && blocked[0] === TOUCHES_RELAX_FILTER_NAME)) {
    return { wouldRelax: false, relaxBlockedBy: "touches-only-blocker" };
  }
  // ② waited-enough —— 缺值（null）⇒ 条件为假（硬规则 6：缺值 = 未查，⛔ 不当 0，⛔ 不当 ∞）。
  const after = state.config.after_minutes;
  if (waits === null || after === undefined || !(waits >= after)) {
    return { wouldRelax: false, relaxBlockedBy: "waited-enough" };
  }
  // ③ quota-available —— 已放宽在飞数 < 名额（名额来自配置，⛔ 无内置回退）。
  const quota = state.config.max_relaxed_inflight;
  if (quota === undefined || !(state.relaxedInFlight < quota)) {
    return { wouldRelax: false, relaxBlockedBy: "quota-available" };
  }
  // ④ not-never-relax —— 候选 id 不在 `never_relax` 名单内。
  if (state.config.never_relax.includes(id)) {
    return { wouldRelax: false, relaxBlockedBy: "not-never-relax" };
  }
  // ⑤ overlap-shared —— 重叠面全部落在 `shared_files` 白名单内。
  if (!overlapsAllShared(overlaps, state.config.shared_files)) {
    return { wouldRelax: false, relaxBlockedBy: "overlap-shared" };
  }
  return { wouldRelax: true, relaxBlockedBy: null };
}

/** 谓词在列表中的名字。唯一定义点——`TASK_FILTERS` 的元素、判定里的条件①、trace 侧的条目选择、
 *  两条既有 pin 全部引用它（⛔ 不散落第二份字面量）。 */
const TOUCHES_RELAX_FILTER_NAME = "touchesDisjointOrAged";

/** 本轮对 `touchesDisjointOrAged` 的逐候选标签表。谓词一次构造、逐候选判定；标签在**判定那一刻**
 *  写进这张表，trace 侧按【同一次】过滤的结果读它（⛔ 不重跑谓词、⛔ 不另算一份重叠）。 */
interface RelaxAttribution {
  /** 该候选本轮**所有**滤掉它的谓词名（准入集合由 `applyTaskFilters` 逐候选喂进来）。 */
  setFilteredBy: (id: string, filteredBy: readonly string[]) => void;
  /** 该候选的标签（off / 未登记 ⇒ `null`——off 不做放宽判断）。 */
  annotationFor: (id: string) => RelaxAnnotation | null;
}

/** 谓词实例 → 它的标签表。谓词与标签表都是**同一个模块级对象**的字段 ⇒ WeakMap 关联的是
 *  `TASK_FILTERS` 里那一个元素本身（⛔ 不给 `TaskFilter` 接口加字段——那会让「新增谓词 = 往列表
 *  加一行」这条 AC152 纪律失真）。`predicate()` 可能被多次调用（每个消费点各自构造一次），故标签
 *  表在实例上保存【最后一次构造】的那一份，`applyTaskFilters` 用自己刚构造的那一份读。 */
const RELAX_ATTRIBUTION = new WeakMap<object, RelaxAttribution>();

/** 构造一轮的标签表（谓词与它成对出现）。 */
function makeRelaxAttribution(state: RelaxRoundState, ctx: FilterContext): RelaxAttribution {
  const annotations = new Map<string, RelaxAnnotation>();
  return {
    setFilteredBy: (id, filteredBy) => {
      if (!state.annotate) return; // off / 读不懂 ⇒ 不做放宽判断（⛔ 不产生任何标签）
      annotateRelax(id, state, ctx, annotations, filteredBy);
    },
    annotationFor: (id) => annotations.get(id) ?? null,
  };
}

/** 判定一个候选的放宽标签（仅在 `state.annotate` 时登记）。重叠面 = 候选与每个在飞对手的**真实**
 *  `checkTouchesPair(...).overlaps` 并集（复用同一份重叠数学，⛔ 不重写交集计算），并排除候选自身的
 *  任务文件（自 touch 不是与对手的冲突面——与 AC-362 的归因面同一口径）。 */
function annotateRelax(
  id: string,
  state: RelaxRoundState,
  ctx: FilterContext,
  annotations: Map<string, RelaxAnnotation>,
  filteredBy: readonly string[],
): void {
  const { expand, readTouches } = makeTouchesSideReaders(ctx);
  const self = readTouches(id);
  const selfTaskFile = normalizePath(path.join("tasks", `${id}.md`));
  const overlaps: string[] = [];
  for (const other of ctx.inFlight) {
    const pair = checkTouchesPair(self, readTouches(other), expand);
    if (pair.disjoint) continue;
    for (const f of pair.overlaps) if (normalizePath(f) !== selfTaskFile) overlaps.push(f);
  }
  const readyAt = state.readyAtMs.get(id);
  const waits = readyAt === undefined ? null : Math.floor((state.nowMs - readyAt) / 60000);
  annotations.set(id, judgeRelaxCandidate(id, filteredBy, waits, overlaps, state));
}

/** 构造一轮的判定：把标签表挂到**本次构造的那个谓词**上，并返回一个**逐调用委托**基线谓词的函数。
 *  ⛔ 委托是「直接调用 `touchesDisjoint.predicate(ctx)` 的返回值本身」：返回值、短路顺序、fail-closed
 *  缺省全部随之逐字节相同，且不产生第二份 off 实现（硬规则 5b）。shadow / live 的返回值与 off
 *  **完全一样**——本条只标注不放行（live 的放行语义是 AC-366 的活；⛔ 在这里放行会让取假形态变绿）。
 *  mode 的差别**只**喂标签表，⛔ 不参与返回值。
 *
 *  为什么标签表挂【构造出的那个函数】而不是列表里那个对象：`predicate(ctx)` 每个消费点各调一次
 *  （测试里同一模块会被多次构造），挂在模块级对象上会被后一次构造覆盖。 */
function makeTouchesDisjointOrAgedPredicate(ctx: FilterContext): (id: string) => boolean {
  const state = makeRelaxRoundState(ctx);
  const planOff = touchesDisjoint.predicate(ctx);
  const decision = (id: string): boolean => planOff(id);
  RELAX_ATTRIBUTION.set(decision, makeRelaxAttribution(state, ctx));
  return decision;
}

/** `touchesDisjoint` 在列表中的那一格被本条取代：`touch` 面的判定从「只看互斥」变成「互斥 or 够老」，
 *  而本条实现的是**前者不变 + 后者只观察**（off 逐候选同形 / shadow 只标注不放行）。 */
export const touchesDisjointOrAged: TaskFilter = {
  name: TOUCHES_RELAX_FILTER_NAME,
  predicate: (ctx) => makeTouchesDisjointOrAgedPredicate(ctx),
};

/** 候选未耗尽重试上限（AC133 失败上限）。retryExhausted 集合由 advanceRetryCap 填充（worker 从
 *  exited-not-landed 计数派生、promotion 从重验证仍不合格计数派生），两 driver 共用同一生产函数。 */
export const retryCapNotExhausted: TaskFilter = {
  name: "retryCapNotExhausted",
  predicate: (ctx) => (id) => !ctx.retryExhausted.has(id),
};

// ── retryExhausted 集合的【生产面】（单一真相源：两 driver 共用，⛔ 不各写一遍计数/翻转逻辑）──────────

/** 失败上限缺省：同一任务连续 N 次未落地/未合格 ⇒ 标 needs-human。与 fan-in 侧 attempt>=3 同值
 *  （gap-fan-in-relaunch-retry-cap），非新设数值阈值——仅作「未传 --max-retries/--max-fix-retries」的
 *  手动/测试回退。concurrency-default-fallback: 重试次数上限（非并发 cap——`*_CAP*` 名须声明保持诚实，
 *  同 RED_BACKLOG_CAP_DEFAULT，declared per gap-concurrency-literal-only-at-definition-points）。 */
export const RETRY_CAP_DEFAULT = 3;

/** 失败上限的跨轮状态。counts = 每任务连续未落地/未合格的累计次数；needsHuman = 已标 needs-human
 *  （后续轮不再对其重派/修）。跨轮存活于常驻循环内（⛔ 不落盘——运行时状态，与进程同寿命）。 */
export interface RetryState {
  counts: Map<string, number>;
  needsHuman: Set<string>;
}

/** 推进失败上限：对每个仍未落地的 id 累计连续失败次数，达到 maxRetries 的进入 newlyNeedsHuman
 *  （去重——已标过的不重复返回）。原地更新传入 state，纯逻辑可单测（AC133 AC3）。 */
export function advanceRetryCap(
  state: RetryState,
  stillIneligibleIds: string[],
  maxRetries: number,
): string[] {
  const newly: string[] = [];
  for (const id of stillIneligibleIds) {
    const n = (state.counts.get(id) ?? 0) + 1;
    state.counts.set(id, n);
    if (n >= maxRetries && !state.needsHuman.has(id)) {
      state.needsHuman.add(id);
      newly.push(id);
    }
  }
  return newly;
}

/** 对账（gap-retrystate-needshuman-no-reconcile-with-disk-ready）：内存 needsHuman 集合随磁盘 status
 *  翻转对账——人对已标 needs-human 的任务翻回 ready/todo（或任务在他处被落地/关闭）后，磁盘 status
 *  已离开 needs-human ⇒ 从内存集合清除，下一轮即重新可派（⛔ 不重启——重启 = 把恢复外包给 supervisor
 *  才得以恢复，正是本缺陷的根）。同时清零该 id 的连续失败计数（counts）——人干预后给【全新】重试
 *  预算（⛔ 只清 needsHuman 不清 counts ⇒ 下一次失败 n=旧值+1 立即再标 needs-human，人干预被一次性
 *  消耗）。读不懂（status === null）⇒ 保留（缺值 = 未查，⛔ 不伪装成「人已翻回」——同 notNeedsHuman
 *  的 fail-closed）。返回本轮清除的 id（供观测/单测；非空 = 有对账发生，可观测非静默）。 */
export function reconcileNeedsHumanWithDisk(state: RetryState, root: string): string[] {
  const cleared: string[] = [];
  for (const id of [...state.needsHuman]) {
    const status = readTaskStatus(root, id);
    if (status !== null && status !== TASK_STATUS.NEEDS_HUMAN) {
      state.needsHuman.delete(id);
      state.counts.delete(id);
      cleared.push(id);
    }
  }
  return cleared;
}

// ── commit-after-write / first-registration 判定（单一真相源已上收 task-ops.ts，⛔ 本文件不各写一份） ──
// isInsideGitWorkTree / commitTaskFile / hasPriorCommit 迁至 task-ops.ts（gap-task-ops-consolidate-
// driver-frontmatter-writers），本文件 import 复用——markNeedsHuman 与 ready-pool-check.ts 的
// commitTaskStatus 共用同一份 commit primitive（gap-mark-needs-human-commit-after-write 修过的缺陷
// 不再在第四处复发）。

// ── author ↔ develop 同步（gap-doc-develop-sync-semantic-conflict-resolution）──────────────
// 人 2026-08-31 裁定反转：写面保留 author，但状态/任务文件变更必须以 develop 为终点。同步 =
// 机械 ff-only + 语义兜底（机械失败升级确定性语义同步，develop 权威 wins），⛔ 静默 catch。
// 原实现（gap-fan-in-ff-ref-update-detach-develop）是 `: void` + `catch(_){}` 全吞 + `git merge develop`
// 静默 merge-fallback——实证 2026-08-31 一次 propagate 静默失败 ⇒ 4 任务状态分叉 + 主检出落后 develop
// 53 提交无痕（硬规则 3b 的镜像：同步失败 ⇒ 伪装成同步成功）。

/** doc↔develop 同步事件的仓库相对路径（gitignored 运行时日志，worker-outcome.jsonl 同族）。
 *  失败落痕：机械 ff-only 失败 / 语义兜底结果都写到这里，让「同步失败」在记录上可区分（⛔ 静默）。 */
export const DOC_DEVELOP_SYNC_EVENT_REL = ".quay/doc-develop-sync.jsonl";

/** 终态（不可再前进一步的状态）：`done`（已落地，携带证据）/ `superseded`（被人裁定退役）。
 *  ⚠️ 分区（live vs terminal）目前没有规范模块可复用——规范表 `TASK_STATUSES`（task-status.ts）
 *  只给词汇表，不给分区。这里显式列出并登记进 AC3 的 sibling 审计（硬规则 5b），⛔ 不是又一份
 *  随手抄的第四份词汇表：词取自 `TASK_STATUS`，且下面的 `assertStatusPriorityCoversVocabulary()`
 *  会在分区漏词时【当场抛出】。 */
export const TERMINAL_TASK_STATUSES: readonly string[] = [TASK_STATUS.DONE, TASK_STATUS.SUPERSEDED];

/** 一个状态是否终态。`unknown:*` / null / 任意未知取值 ⇒ false（读不懂 ⇒ 不是终态，fail-closed）。 */
export function isTerminalTaskStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && TERMINAL_TASK_STATUSES.includes(status);
}

/** 任务状态确定性优先级（develop 权威 wins 的机械表达）：live 序 `todo < ready < needs-human`，
 *  其上是**终态**——`superseded` 高于一切 live 状态（终态永不输给 live：否则一次同步会把已退役
 *  的任务【复活】成可派发），`done` 又高于 `superseded`（携带落地证据；终态×终态的 tie 由
 *  `collectStatusAlignments` 显式落 event，⛔ 不静默）。
 *  ⚠️ 词取自规范表 `TASK_STATUS`（task-status.ts），⛔ 不再是第四份字面量清单——这正是本任务
 *  （gap-status-sync-priority-drops-superseded-…）修的缺陷：旧表只有 4 个词，`superseded` 被
 *  `includes` 静默丢弃 ⇒ develop=superseded / doc=ready 消解成 ready。 */
export const STATUS_PRIORITY: readonly string[] = [
  TASK_STATUS.TODO,
  TASK_STATUS.READY,
  TASK_STATUS.NEEDS_HUMAN,
  TASK_STATUS.SUPERSEDED,
  TASK_STATUS.DONE,
];

/** 自检（模块加载即执行）：`STATUS_PRIORITY` 必须**恰好**覆盖规范词汇表 `TASK_STATUSES`。
 *  为什么必须有它（硬规则 3b）：优先级表漏掉一个词时，`includes()` 会把该状态判成「读不懂」
 *  而被静默旁路——「漏一个词」与「表完整」在旧实现里同形。规范表将来加第六个状态时，这里
 *  当场抛出，而不是继续静默丢弃。 */
export function assertStatusPriorityCoversVocabulary(): void {
  const missing = TASK_STATUSES.filter((s) => !STATUS_PRIORITY.includes(s));
  const extra = STATUS_PRIORITY.filter((s) => !(TASK_STATUSES as readonly string[]).includes(s));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `STATUS_PRIORITY drifted from TASK_STATUSES: missing=[${missing.join(",")}] extra=[${extra.join(",")}]`,
    );
  }
}
assertStatusPriorityCoversVocabulary();

/** 「无法评估」的独立取值前缀（硬规则 3b）。与任何合法状态都不同形 ⇒ 消费方可区分
 *  「已消解出胜者」与「输入读不懂」。 */
export const UNKNOWN_STATUS_PREFIX = "unknown:";

/** 追加一条 doc↔develop 同步事件（create dir/file as needed）。纯 I/O。 */
export function writeDocDevelopSyncEvent(root: string, record: Record<string, unknown>): string {
  const file = path.join(root, DOC_DEVELOP_SYNC_EVENT_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n", "utf8");
  return file;
}

/** 确定性状态消解（AC2）：两状态分叉取优先级更高者（见 `STATUS_PRIORITY`）。纯函数，无 LLM、无 I/O。
 *
 *  三种结果，取值【不同形】（硬规则 3b —— 旧实现把「读不懂」也伪装成另一侧胜出）：
 *    · 一个合法状态字符串       — 已消解出的胜者。
 *    · `unknown:<value>[,<value>]` — 输入里有**不在词汇表里的字面量**（读不懂）⇒ 无法评估，
 *      调用方必须跳过对齐并落痕，⛔ 不得让另一侧悄悄胜出（否则 "garbage vs ready" ⇒ ready）。
 *    · `null`                   — 两侧都没有可读的状态（缺失 / 都是 null）：真「未查」。
 *  一侧缺失、另一侧合法 ⇒ 返回合法侧（缺失不是一条与之冲突的主张，硬规则 6：缺值 = 未查）。 */
export function resolveStatusPriority(a: string | null | undefined, b: string | null | undefined): string | null {
  const values: Array<string | null | undefined> = [a, b];
  const unreadable = values.filter((s): s is string => typeof s === "string" && !isTaskStatus(s));
  if (unreadable.length > 0) return `${UNKNOWN_STATUS_PREFIX}${unreadable.join(",")}`;
  const candidates = values.filter((s): s is string => typeof s === "string" && isTaskStatus(s));
  if (candidates.length === 0) return null;
  const byPriority = (x: string, y: string) => STATUS_PRIORITY.indexOf(y) - STATUS_PRIORITY.indexOf(x);
  return [...candidates].sort(byPriority)[0];
}

/** 读当前分支名（`git branch --show-current`）。git 出错 ⇒ null（调用方以事件落痕，⛔ 静默）。 */
function currentBranchName(root: string): string | null {
  try {
    return execFileSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/** 机械 ff-only push：把 `src` 快进到 develop（`git push . src:develop`）。成功 ⇒ { ok:true }；
 *  失败（ff 不成立 / git 出错）⇒ { ok:false, detail }，detail = 真实 git stderr（⛔ 不丢弃——
 *  此前 semantic-ff-failed 8/15 次不可归因，硬规则 3b）。捕获 stderr 的写法与 syncDevelopToDoc
 *  的 ff-error 同形（trim + 前 3 行 + 300 字符截断）。 */
function ffPushToDevelop(root: string, src: string): { ok: boolean; detail?: string } {
  try {
    execFileSync("git", ["-C", root, "push", ".", `${src}:develop`], { stdio: ["ignore", "ignore", "pipe"] });
    return { ok: true };
  } catch (e) {
    const err = e as { stderr?: Buffer | string };
    const detail = String(err?.stderr ?? "").trim().split("\n").slice(0, 3).join(" | ").slice(0, 300);
    return { ok: false, detail: detail || "<no-stderr-captured>" };
  }
}

/** 语义兜底（机械 ff-only 失败后，AC3/AC4）：机械同步失败（ff 不成立）升级到确定性语义同步——
 *  ① `git merge develop -X theirs`（develop 权威 wins：冲突取 develop 侧；develop-only 提交与 doc-only
 *  提交都进历史，⛔ 不 reset/checkout 丢提交，AC4）；② 分叉任务状态按确定性优先级对齐（AC2，永不 LLM）；
 *  ③ ff push develop + 事件落痕。合并冲突（code/docs 语义冲突，机械不能消解）⇒ `git merge --abort`
 *  保树干净 + 事件升级（Claude Code 语义合并接手），返回 false。 */
// ── 终局解的【可弃性判定】（gap-develop-sync-reset-hard-destroys-third-party-project-tree）──────────
//
// 缺陷（2026-09-11 实测，orangevps；真机 e2e 目标 = 已升级的 meta-cc 副本）：终局解
// `git reset --hard develop` 丢弃的是【当前分支】的独有提交。它在本仓库成立的唯一前提是
// 「doc 工作分支是 develop 的一次性投影」——而 `resolveDocBranch` 把这句话实现成了「当前 checked-out
// 分支」（:442），于是该前提在**任何**项目上都自动为真。第三方项目里当前分支就是它自己的主线
// （实测副本：`main`，含 `chore: release v3.8.4` 等 release 提交，`discardedCount: 50`），reset 把
// 项目主线连同 `tasks/`（源项目 102 个任务文件）与 `.quay/config.yml` 一起抹掉。
//
// ⛔ 判据不落在分支名上：`author` 是逐项目不同的字面量（硬规则 4 推论二），且前一条任务
// （gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync）正是为消除它才把硬编码
// DOC_BRANCH 改成运行时派生——再引入一个新的分支名字面量等于把那个缺陷换个方向重犯。
// 判据落在**即将被丢弃的东西本身**（直接量，硬规则 4b）：
//   ① 被丢弃的提交只碰任务板/文档面（DOC_SURFACES，复用既有单一定义）⇒ 没有任何项目代码会丢失；
//   ② develop 的 `tasks/` 非空（当当前分支有任务板时）⇒ develop 是任务板的**有效权威**，
//      而不是一棵从未见过任务板的树（实测现场 reset 后 `tasks/*.md` 计数 = 0）。
// 两条都成立 ⇒ 丢掉的只是「develop 本可 supersede 的任务状态」⇒ 旧行为逐字不变
// （本仓库真实生产载体 .quay/doc-develop-sync.jsonl 的 3 次 take-develop，唯一非空的一次丢弃的
//  14 条全是 `goals: AC-NNN 写盘即提交（goal-store）` ⇒ ① 成立；develop 有任务板 ⇒ ② 成立）。
// 任一条不成立 ⇒ **拒绝**：工作树原样不动、事件携带被枚举的提交与越界面、返回 false（未同步）。
// ⛔ 返回 false 不是「静默失败」：调用方（promotion-driver:687-690）明示该返回值【仅供观测、不阻断本轮】，
// 且本条额外写一条可区分的 `…-take-develop-refused` 事件（硬规则 3b：拒绝与「已同步」不同形）。

/** 读 `<ref>:<dir>/` 下的文件清单（`git ls-tree -r --name-only <ref> -- <dir>`）。读失败 ⇒ null
 *  （读不懂 ≠ 空，硬规则 6——「develop 没有任务板」与「读不出 develop」不得同形）。 */
function lsTreeDir(root: string, ref: string, dir: string): string[] | null {
  try {
    const out = execFileSync("git", ["-C", root, "ls-tree", "-r", "--name-only", ref, "--", dir], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/** 将被 `reset --hard develop` 丢弃的提交所触碰的路径**并集**（`git log --pretty=format: --name-only
 *  develop..HEAD`）。读失败 ⇒ null（读不懂 ≠ 无路径）。 */
function discardedTouchedPaths(root: string): string[] | null {
  try {
    const out = execFileSync("git", ["-C", root, "log", "--pretty=format:", "--name-only", "develop..HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return [...new Set(out.split("\n").map((l) => l.trim()).filter(Boolean))];
  } catch {
    return null;
  }
}

/** 路径是否落在任务板/文档面（DOC_SURFACES 单一真相源）。`tasks/` 等条目自带尾斜杠 ⇒ 同时匹配
 *  目录本身与其内容（`tasks` / `tasks/x.md`）。未知路径 ⇒ false（fail-closed，硬规则 3b）。 */
function isDiscardableSurfacePath(rel: string): boolean {
  const p = String(rel).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!p) return true;
  return DOC_SURFACES.some((s) => (s.endsWith("/") ? p === s.slice(0, -1) || p.startsWith(s) : p === s));
}

/** 可弃性判定结果（三态可区分：可弃 / 不可弃【带成因】/ 读不懂——⛔ 后两者不同形，硬规则 3b）。 */
export interface DiscardabilityVerdict {
  disposable: boolean;
  /** disposable | non-doc-paths | develop-missing-task-board | unreadable */
  reason: string;
  /** reason=non-doc-paths 时越界的路径（截前 20 条）；其余成因 ⇒ 空表。 */
  offendingPaths: string[];
}

/** 终局解前的可弃性判定：见本段顶部注释的 ①/②。⛔ 纯读探测，不改变任何东西。 */
export function discardedCommitsAreDisposable(root: string): DiscardabilityVerdict {
  const paths = discardedTouchedPaths(root);
  if (paths === null) return { disposable: false, reason: "unreadable", offendingPaths: [] };
  const offending = paths.filter((p) => !isDiscardableSurfacePath(p)).slice(0, 20);
  if (offending.length > 0) return { disposable: false, reason: "non-doc-paths", offendingPaths: offending };
  const headTasks = lsTreeDir(root, "HEAD", "tasks/");
  const developTasks = lsTreeDir(root, "develop", "tasks/");
  if (headTasks === null || developTasks === null) {
    return { disposable: false, reason: "unreadable", offendingPaths: [] };
  }
  const boardOnHead = headTasks.filter((f) => f.endsWith(".md")).length;
  const boardOnDevelop = developTasks.filter((f) => f.endsWith(".md")).length;
  if (boardOnHead > 0 && boardOnDevelop === 0) {
    return { disposable: false, reason: "develop-missing-task-board", offendingPaths: [] };
  }
  return { disposable: true, reason: "disposable", offendingPaths: [] };
}

// ── 终局解的【工作树】守卫（gap-develop-sync-take-develop-reset-hard-wipes-uncommitted-tracked-edits-
//    in-shared-checkout）────────────────────────────────────────────────────────────────────────────
//
// sibling 任务（gap-develop-sync-reset-hard-destroys-third-party-project-tree）守住了 reset --hard 丢弃
// 【分支独有提交】的那半边；它不守【工作树】。而 `git reset --hard develop` 同时做两件破坏性的事
// （2026-10-14 实测，两条负控制见单测）：
//   ① 静默丢弃**已跟踪文件的未提交改动**（`M tracked.txt` → reset 后内容复原为 develop 版本，exit 0）；
//   ② 静默覆盖**未跟踪文件**——当该路径存在于 develop 树中时（untracked 文件被 develop 版本替换，
//      exit 0 无提示；路径不在 develop 树里则保留）。
// 实测生产（ClaudeCodeUI 2026-10-14）：take-develop 的 reset 抹掉了人已授权、尚未提交的
// `.quay/config.yml` 启用块（`arch_discovery` / `discovery_method`），**两个 routine 静默停用，无任何
// 事件点名这次损失**——事件只记 `discardedCount:0`（它数的是提交，不数工作树）。
// 修法（本任务 Plan 点 1，**拒绝**是保守默认）：reset 前先枚举工作树；有任何 reset 会破坏的状态 ⇒ 拒绝
// + 落一条可区分的 `…-take-develop-refused` 事件（列出路径）。可保留状态（未跟踪、且不在 develop 树里）
// 记进事件后照常 reset（point 3：让「reset 没丢东西」成为**测量**而非假设）。

/** 工作树脏态读数（`git status --porcelain`）。三态可区分（硬规则 3b/6）：
 *   · readable:false            — git status 读不懂（fail-closed：无法证明 reset 安全 ⇒ 不得 reset）。
 *   · readable:true, 非空数组    — 枚举出的已跟踪改动 / 未跟踪文件（reset --hard 的潜在牺牲品）。
 *   · readable:true, 空数组      — 干净（reset 不丢任何工作树状态）。 */
export interface WorkingTreeDirtiness {
  readable: boolean;
  /** 已跟踪文件的改动（porcelain 里非 `??` 的行：staged / unstaged / rename）。`reset --hard`
   *  **静默**丢弃它们（实测生产：未提交的 `.quay/config.yml` 启用被抹掉）。 */
  trackedDirty: string[];
  /** 未跟踪文件（porcelain 的 `??` 行）。reset --hard 不删【develop 树里没有的】；
   *  会**静默覆盖**【develop 树里有的】（实测）。 */
  untracked: string[];
}

/** 解析 `git status --porcelain`（v1：`XY<space>PATH`，rename 为 `XY<space>OLD -> NEW`）。纯函数。 */
export function parsePorcelain(raw: string): { trackedDirty: string[]; untracked: string[] } {
  const trackedDirty: string[] = [];
  const untracked: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    let p = line.slice(3);
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) p = p.slice(arrow + 4); // rename：记新路径
    if (xy === "??") untracked.push(p);
    else trackedDirty.push(p);
  }
  return { trackedDirty, untracked };
}

/** 工作树脏态读数。⛔ 纯读探测，不改变任何东西。读不懂 ⇒ readable:false（硬规则 6：读不懂 ≠ 干净）。
 *  `--untracked-files=all`：⛔ 不用裸 porcelain——它会把未跟踪【目录】折叠成一条 `?? dir/`
 *  （实测：`experiments/x/README.md` → `?? experiments/`），使「路径是否存在于 develop 树」的判据
 *  失真（折叠后的目录名匹配不上树里的文件路径）。 */
export function workingTreeDirtiness(root: string): WorkingTreeDirtiness {
  try {
    const out = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    const { trackedDirty, untracked } = parsePorcelain(out);
    return { readable: true, trackedDirty, untracked };
  } catch {
    return { readable: false, trackedDirty: [], untracked: [] };
  }
}

/** 未跟踪文件里【会被 `reset --hard develop` 静默覆盖】的那些（= 路径存在于 develop 树中）。
 *  读 develop 树失败 ⇒ null（读不懂 ≠ 无覆盖——硬规则 6）。untracked 为空 ⇒ []（无需读 develop）。 */
function untrackedOverwrittenByReset(root: string, untracked: string[]): string[] | null {
  if (untracked.length === 0) return [];
  const developPaths = lsTreeDir(root, "develop", ".");
  if (developPaths === null) return null;
  const tracked = new Set(developPaths);
  return untracked.filter((p) => tracked.has(p));
}

/** 落一条 take-develop 拒绝事件（拒绝与「已同步」必须在载体上不同形，硬规则 3b）。⛔ 无论成因为何，
 *  恒记工作树读数（point 3）——「拒了、工作树本来干净」与「拒了、工作树里正是这些路径」由此可区分。 */
function refuseTakeDevelop(
  root: string, cur: string, reason: string, offendingPaths: string[], discarded: string[], resolution: string,
): void {
  const dirt = workingTreeDirtiness(root);
  writeDocDevelopSyncEvent(root, {
    event: "doc-develop-sync-semantic-take-develop-refused", phase: "take-develop", branch: cur,
    reason, offendingPaths,
    workingTree: { trackedDirty: dirt.trackedDirty, untracked: dirt.untracked },
    discardedCount: discarded.length, discarded, resolution,
  });
}

/** 结构冲突下的终局解：硬取 develop，丢弃 doc 侧独有提交（人 2026-09-06 裁定允许）。
 *  **这是让「语义同步必成功、永不卡死」第一次真正成立的那一步**——在此之前结构冲突即
 *  return false 且无升级接线（实测 21/26 卡死在那里）。
 *  ⛔ 允许丢失 ≠ 允许静默丢失：被丢弃的提交先逐条枚举进事件（硬规则 3 枚举不布尔），
 *  再 reset。丢了什么在载体里查得到，⛔ 不是「同步成功」四个字。
 *  ⛔ 允许丢失 ≠ 允许丢任何东西（gap-develop-sync-reset-hard-destroys-third-party-project-tree）：
 *  人 2026-09-06 的裁定是【本仓库 doc 投影分支】的提交可弃，不是一个可以套到任意分支上的通行证。
 *  先过 `discardedCommitsAreDisposable`——不可弃 ⇒ 拒绝 + 落痕 + false，reset 不执行。
 *  ⛔ 提交可弃 ≠ 工作树可弃（gap-develop-sync-take-develop-reset-hard-wipes-uncommitted-tracked-
 *  edits-in-shared-checkout）：`reset --hard` 还静默丢【工作树】——已跟踪文件的未提交改动、以及
 *  develop 树里有的未跟踪文件。再过一个 `workingTreeDirtiness` 守卫——有会被破坏的状态 ⇒ 同样拒绝。 */
export function takeDevelopDiscardingDoc(root: string, cur: string): boolean {
  let discarded: string[] = [];
  try {
    const out = execFileSync("git", ["-C", root, "log", "--oneline", "--no-decorate", "develop..HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    discarded = out.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 50);
  } catch {
    discarded = ["<enumerate-failed>"]; // 读不出 ≠ 没丢（硬规则 6）——留一个可区分的取值
  }
  // 可弃性判定（本段顶部）：不可弃 ⇒ 不执行 reset。工作树原样不动，事件必须带回【被枚举的提交 +
  // 越界面 + 成因】——否则「拒绝了」与「同步成功了」在载体上同形（硬规则 3b）。
  const verdict = discardedCommitsAreDisposable(root);
  if (!verdict.disposable) {
    refuseTakeDevelop(root, cur, verdict.reason, verdict.offendingPaths, discarded, "refused-non-disposable-commits");
    return false;
  }
  // 工作树守卫（本段顶部 ①/②）：`reset --hard` 除丢提交外还静默丢工作树状态。先枚举，任何会被它破坏
  // 的状态 ⇒ 拒绝（保守默认，Plan 点 1）。判定序：读不懂 > 已跟踪脏 > 未跟踪会被覆盖。
  const dirt = workingTreeDirtiness(root);
  const overwritten = dirt.readable ? untrackedOverwrittenByReset(root, dirt.untracked) : [];
  const wtreeReason =
    !dirt.readable ? "working-tree-unreadable"
    : dirt.trackedDirty.length > 0 ? "dirty-working-tree"
    : overwritten === null ? "working-tree-unreadable"
    : overwritten.length > 0 ? "untracked-would-be-overwritten"
    : null;
  if (wtreeReason !== null) {
    const paths =
      wtreeReason === "dirty-working-tree" ? dirt.trackedDirty
      : wtreeReason === "untracked-would-be-overwritten" ? (overwritten ?? [])
      : [];
    refuseTakeDevelop(root, cur, wtreeReason, paths.slice(0, 20), discarded, `refused-${wtreeReason}`);
    return false;
  }
  try {
    execFileSync("git", ["-C", root, "reset", "--hard", "develop"], { stdio: "ignore" });
  } catch {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-semantic-take-develop-failed", phase: "reset", branch: cur });
    return false;
  }
  // 走到这里：trackedDirty 必为空（否则上面已拒绝）⇒「reset 没丢已跟踪工作树状态」是测量出来的。
  // 若存在未跟踪文件（且都【不在】develop 树里，故 reset 保留它们）⇒ 记进事件（point 3）。
  writeDocDevelopSyncEvent(root, {
    event: "doc-develop-sync-semantic-resolved", phase: "take-develop", branch: cur,
    resolution: "discarded-doc-commits", discardedCount: discarded.length, discarded,
    ...(dirt.untracked.length > 0 ? { workingTree: { trackedDirty: [], untracked: dirt.untracked } } : {}),
  });
  return true;
}

export function semanticSyncDocToDevelop(root: string, cur: string): boolean {
  writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-semantic", phase: "begin", branch: cur });

  // ② 分叉任务状态确定性对齐（AC2）：merge -X theirs 把冲突侧统一取 develop，可能丢掉 doc 侧更
  // 「前进」的状态（doc=done vs develop=ready）⇒ 合并前先记录优先级胜出者，合并后按它回写。
  const scan = collectStatusAlignments(root, cur);
  // 两类不可静默的分叉（硬规则 3b）：终态×终态的 tie（done vs superseded 的显式取舍）与
  // 「输入读不懂」的未评估项。都在合并【之前】落痕，让「跳过」与「已对齐」在载体上不同形。
  for (const tie of scan.ties) {
    writeDocDevelopSyncEvent(root, {
      event: "doc-develop-sync-status-tie", phase: "pre-merge", branch: cur, rel: tie.rel,
      develop: tie.develop, doc: tie.doc, resolved: tie.resolved, resolution: "prefer-done-landed-evidence",
    });
  }
  for (const un of scan.notEvaluated) {
    writeDocDevelopSyncEvent(root, {
      event: "doc-develop-sync-status-not-evaluated", phase: "pre-merge", branch: cur, rel: un.rel,
      develop: un.develop, doc: un.doc, resolved: un.resolved,
      resolution: "skipped-unreadable-status",
    });
  }

  // ① merge develop（-X theirs = 冲突取 develop 侧，develop 权威 wins；⛔ 非静默 merge-fallback——
  // 这里不是「push 失败就吞掉」，而是显式升级语义兜底 + 落痕）。
  try {
    execFileSync("git", ["-C", root, "merge", "develop", "--no-edit", "-X", "theirs"], { stdio: "ignore" });
  } catch {
    try { execFileSync("git", ["-C", root, "merge", "--abort"], { stdio: "ignore" }); } catch { /* 无 merge 可 abort */ }
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-semantic-conflict", phase: "merge", branch: cur });
    // ⊕ 人 2026-09-06 裁定：「merge 冲突时可以损失 author 分支的变更」。
    // 该裁定消解了原设计里的矛盾——`-X theirs` 只消解【内容】冲突，结构冲突（add/add、
    // delete/modify、rename）仍 throw；此前到此即 return false，且【无任何升级接线】
    // ⇒ 实测 26 次进入语义兜底、21 次停在这里，「必成功永不卡死」从未成立。
    // 现在结构冲突有了永远有效的解：硬取 develop。
    // ⛔ 允许丢失 ≠ 允许静默丢失：先枚举将被丢弃的 doc 侧提交并落痕，再重置。
    return takeDevelopDiscardingDoc(root, cur);
  }

  // 回写优先级胜出的任务状态（仅当 doc 侧更前进时；否则 -X theirs 的 develop 侧已是正确值）。
  if (!applyStatusAlignments(root, scan.alignments)) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-semantic-align-failed", phase: "align", branch: cur });
    return false;
  }

  // ③ ff push develop + 落痕。
  const pushed = ffPushToDevelop(root, cur);
  if (!pushed.ok) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-semantic-ff-failed", phase: "push", branch: cur, detail: pushed.detail });
    return false;
  }
  writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-semantic-resolved", phase: "done", branch: cur });
  return true;
}

/** 分叉状态扫描的三类结果（⛔ 不同形，硬规则 3b：消费方能区分「已消解」/「终态 tie」/「读不懂」）。 */
export interface StatusAlignmentScan {
  /** 只在【doc 侧胜出】时记 { rel → winner }（合并后回写用）；develop 侧胜出由 -X theirs 已保证。 */
  alignments: Map<string, string>;
  /** 终态×终态且不同的分叉（`done` vs `superseded`）：按 `STATUS_PRIORITY` 取 `done`，但**记录**。 */
  ties: Array<{ rel: string; develop: string; doc: string; resolved: string }>;
  /** 至少一侧是**词汇表外**的字面量 ⇒ 无法评估：跳过对齐，⛔ 不让另一侧胜出（落痕由调用方）。 */
  notEvaluated: Array<{ rel: string; develop: string | null; doc: string | null; resolved: string }>;
}

/** 收集分叉任务状态对齐：对每个 tasks/*.md，读 develop 与 cur 的 status，若分叉且优先级胜者是 doc 侧
 *  （即 cur 侧比 develop 更前进）⇒ 记录 { rel → 胜者 status }（合并后回写用）。纯读取，无 LLM、无 I/O。
 *  直接导出以便单测（AC2）——CLAUDE.md：要紧的分支密集决策函数都有直接 import 单测。 */
export function collectStatusAlignments(root: string, cur: string): StatusAlignmentScan {
  const scan: StatusAlignmentScan = { alignments: new Map<string, string>(), ties: [], notEvaluated: [] };
  for (const rel of listTaskFiles(root, cur)) {
    const developStatus = statusAtRef(root, "develop", rel);
    const curStatus = statusAtRef(root, cur, rel);
    if (developStatus === curStatus) continue;
    const resolved = resolveStatusPriority(developStatus, curStatus);
    // 读不懂（词汇表外字面量 / 两侧皆缺）⇒ 未评估：⛔ 旧实现会在此让另一侧胜出（"garbage" vs "ready"
    // ⇒ ready），把「无法评估」伪装成「已消解」——硬规则 3b。
    if (resolved === null || resolved.startsWith(UNKNOWN_STATUS_PREFIX)) {
      scan.notEvaluated.push({ rel, develop: developStatus, doc: curStatus, resolved: resolved ?? "<none-readable>" });
      continue;
    }
    // 终态×终态（done vs superseded）：显式取舍（done 携带落地证据）⇒ 记录下来，⛔ 不静默。
    if (isTerminalTaskStatus(developStatus) && isTerminalTaskStatus(curStatus)) {
      scan.ties.push({ rel, develop: developStatus, doc: curStatus, resolved });
    }
    // 只回写「doc 侧更前进」的情形（resolved ≠ develop 侧）；develop 侧更前进由 -X theirs 已保证。
    if (resolved !== developStatus) scan.alignments.set(rel, resolved);
  }
  return scan;
}

/** 列出 cur 分支 tasks/ 下的任务文件相对路径（`git ls-tree`）。读失败 ⇒ 空表（fail-open：对齐是
 *  「更前进」的增强，非必须；读不到 ⇒ 不增强，⛔ 不伪装成已对齐）。 */
function listTaskFiles(root: string, cur: string): string[] {
  try {
    const out = execFileSync("git", ["-C", root, "ls-tree", "-r", "--name-only", cur, "--", "tasks/"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".md"));
  } catch {
    return [];
  }
}

/** 读 `<ref>:<rel>` 的 status frontmatter（`git show`）。ref/文件缺失 / 读不懂 ⇒ null。
 *  gap-task-ops-consolidate-driver-frontmatter-writers：委托 task-schema.ts 的 readTaskStatusAtRef
 *  （单一 frontmatter parser，⛔ 不再本文件手搓 fence 切分 + startsWith 读 status）。 */
function statusAtRef(root: string, ref: string, rel: string): string | null {
  return readTaskStatusAtRef(root, ref, path.basename(rel, ".md"));
}

/** 回写任务状态对齐（合并后）：对每个 {rel → status}，把工作树文件的 status 行改写为胜者（已对齐
 *  则跳过），`git add` 后一次性 `git commit --no-verify`（路径限定到改写过的文件，⛔ 裸 commit 扫共享
 *  索引）。无改写 ⇒ true（no-op）。写/提交失败 ⇒ false（事件落痕由调用方）。
 *  gap-task-ops-consolidate-driver-frontmatter-writers：status 读/写经 task-ops.ts（splitTaskFile /
 *  statusFromFrontmatter / patchStatusField，单一 frontmatter parser，⛔ 不再本文件手搓 fence 切分 +
 *  status 行正则）。 */
function applyStatusAlignments(root: string, alignments: Map<string, string>): boolean {
  const changed: Array<{ rel: string; from: string; to: string; written: string }> = [];
  for (const [rel, status] of alignments) {
    const file = path.join(root, rel);
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return false;
    }
    const split = splitTaskFile(raw);
    if (!split) return false;
    const from = statusFromFrontmatter(split.frontmatterRaw);
    if (from === status) continue; // 已对齐（merge 已保留 doc 侧胜者）
    const patched = patchStatusField(split.frontmatterRaw, status);
    if (!patched.ok) return false;
    const written = `${split.open}${patched.fm}${split.close}${split.body}`;
    fs.writeFileSync(file, written, "utf8");
    changed.push({ rel, from: from ?? null, to: status, written });
  }
  if (changed.length === 0) return true;
  const paths = changed.map((c) => c.rel);
  // 事件时点 = status 写盘的时点（全部改写完成、提交之前）；事件本身在提交之后追加（硬规则 7 +
  // 契约 v1 的「先写 → 再提交 → 再落事件」顺序：evidence.commit 必须是被这次改动承载的那个提交）。
  const at = new Date().toISOString();
  for (const rel of paths) {
    try { execFileSync("git", ["-C", root, "add", "--", rel], { stdio: "ignore" }); } catch { return false; }
  }
  let commitSha: string | null = null;
  try {
    execFileSync(
      "git",
      ["-C", root, "commit", "--no-verify", "-m", "sync: 确定性 status 对齐（develop 权威 + done>needs-human>ready>todo）", "--", ...paths],
      { stdio: "ignore" },
    );
    commitSha = revParseHeadOf(root);
  } catch {
    return false;
  }
  // 每个被改写的任务一行 v1 事件（一个 status 变更 = 一条事件）。actor.kind = "unknown"：本模块是
  // 两 driver 共用的对齐器，从内部【读不出】是哪个 drive 触发的对齐，也不许按调用栈/消息文本猜
  // （硬规则 2/6）；`id` 点名的就是这次写入本身的入口。
  for (const c of changed) {
    appendTaskStatusEvent(root, {
      taskId: path.basename(c.rel, ".md"),
      from: c.from,
      to: c.to,
      kind: kindForStatusPair(c.from, c.to),
      actor: { kind: "unknown", id: "driver-filters applyStatusAlignments" },
      at,
      evidence: {
        commit: commitSha,
        statusBlobSha: gitBlobSha(c.written),
        ...(commitSha === null ? { commitAbsentReason: "git rev-parse HEAD returned no sha" } : {}),
      },
    });
  }
  return true;
}

/** `git rev-parse HEAD` at `root`, or null. Best-effort: null is recorded as "no commit", never a
 *  fabricated sha. */
function revParseHeadOf(root: string): string | null {
  try {
    const sha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^[0-9a-f]{40,64}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** The declared edge's `kind` for a `from → to` pair — the KERNEL lookup (ONE source; ⛔ never a
 *  guessed role). `allowLegacy` because a status ALIGNMENT replays whatever the authoritative side
 *  says, including an edge with no live writer. */
function kindForStatusPair(from: string, to: string): string | null {
  return edgeKindFor(from, to, { allowLegacy: true });
}

/** Propagate the doc branch to develop（gap-doc-develop-sync-semantic-conflict-resolution）：主检出在
 *  doc-only 工作分支（author），翻转提交到那里必须到 develop，任务 worktree（从 develop 分支）
 *  才看得到新 status。同步 = 机械 ff-only + 语义兜底：ff 快进成功 ⇒ true；ff 不成立 ⇒ 升级语义兜底
 *  （semanticSyncDocToDevelop）。⛔ 静默 catch 已消除——每一步失败都写事件（DOC_DEVELOP_SYNC_EVENT_REL）
 *  并返回 boolean（false = 未同步，可观测非静默）。 */
export function propagateDocBranchToDevelop(root: string): boolean {
  const cur = currentBranchName(root);
  if (cur === null) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-error", phase: "read-branch" });
    return false;
  }
  if (cur === "develop") return true; // 已在 develop ⇒ 无需同步（非失败）
  if (ffPushToDevelop(root, cur).ok) return true; // 机械 ff-only 成功
  return semanticSyncDocToDevelop(root, cur); // 机械失败 ⇒ 升级语义兜底
}

// ── develop→doc 机械同步（ff-only + 分叉 guard，gap-main-manager-doc-doc-only-ff-only-tracking）───────
// 主检出（author）落后 develop 时生产跑的是旧代码（promotion-driver 常驻从主检出工作树加载，
// CLAUDE.md 分支同步纪律「需定期 merge develop 追上」）。旧实现是静默 merge-fallback——`git merge develop`
// 每次冲突，近 30 天 1795 次 "Merge branch 'develop' into main/manager-doc" 全由其产生。机械半边 =
// `git merge --ff-only develop`（纯快进；⛔ 分叉即拒绝，不静默 merge）；分叉即 guard 报红（独立取值，
// ⛔ 非「同步成功」同形，硬规则 3b）。语义兜底（分叉后怎么融）归父任务 gap-doc-develop-sync-semantic-
// conflict-resolution 的 semanticSyncDocToDevelop。

/** 运行时派生 doc 工作分支名：唯一来源 = 当前 checked-out 分支（主检出所在），⛔ 不再硬编码 "author"。
 *  gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync：第三方项目工作分支非 author 时，
 *  硬编码恒 no-refs ⇒ 晋升写入对派发永久不可见。git 读分支失败 ⇒ null（⛔ 不兜底一个裸字面量——
 *  "author" 是本仓库自己的命名约定，逐项目不同；无 override 裸字面量正是 GOAL-012 B 域 TARGET
 *  target-identity-literal-check 的违例形。调用方以事件落痕 + 独立取值处理 null，硬规则 3b）。 */
export function resolveDocBranch(root: string): string | null {
  return currentBranchName(root);
}

/** `git rev-list --count <from>..<to>` 的提交数（to 独有、from 未含）。git 出错 / 非数 ⇒ null
 *  （读不懂 ≠ 0，⛔ 硬规则 6 不把读失败伪装成「无分叉」）。 */
function revCountAhead(root: string, from: string, to: string): number | null {
  try {
    const out = execFileSync("git", ["-C", root, "rev-list", "--count", `${from}..${to}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const n = Number(out.trim());
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/** 分叉 guard：doc 分支有 develop 未含的提交（`git rev-list --count develop..<docBranch>` > 0）⇒ 分叉
 *  （ff-only 无法同步 ⇒ 报红，返回 true）。读失败 ⇒ null（读不懂 ≠ 无分叉）。 */
export function docBranchForkedFromDevelop(root: string, docBranch: string | null = resolveDocBranch(root)): boolean | null {
  if (docBranch === null) return null; // 读分支失败 ⇒ null（读不懂 ≠ 无分叉）
  const ahead = revCountAhead(root, "develop", docBranch);
  return ahead === null ? null : ahead > 0;
}

/** 机械 develop→doc 同步（ff-only）：把 doc 分支快进到 develop（`git merge --ff-only develop`）。
 *  返回独立取值（⛔ 非「同步成功」同形，硬规则 3b）：
 *   - "synced"  — ff 成功，doc 已到 develop（`rev-parse <docBranch> develop` 相等）
 *   - "already" — doc 已与 develop 同 commit（无需同步，非失败）
 *   - "not-ff"  — 分叉：doc 有 develop 未含的提交 ⇒ 无法 ff-only 同步（guard 报红，升级语义兜底）
 *   - "not-doc" — 当前分支非 doc 分支（本函数只在主检出的 doc 分支上适用）
 *   - "error"   — git 出错 / 读分支失败（非静默）
 *  失败（not-ff / error）与成功（synced）都落痕到 DOC_DEVELOP_SYNC_EVENT_REL（⛔ 静默）——synced 也写
 *  事件是 AC4 生产载体（硬规则 3c）：成功同步若不留痕，「生产载体有记录」结构上不可满足（恒假）。
 *  not-doc 亦落痕 doc-develop-sync-branch-mismatch（携带 cur/expected）——分支改名 / driver 常驻进程里
 *  缓存的 doc 分支名陈旧时，这是唯一的观测信号（⛔ 裸 return 静默则与「无事发生」同形，硬规则 3b，
 *  gap-sync-develop-to-doc-not-doc-silent-noop）。
 *  already 不写（no-op，每轮写会刷日志）。 */
export function syncDevelopToDoc(root: string, docBranch: string | null = resolveDocBranch(root)): string {
  const cur = currentBranchName(root);
  if (cur === null) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-ff-error", phase: "read-branch" });
    return "error";
  }
  if (docBranch === null || cur !== docBranch) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-branch-mismatch", phase: "not-doc", cur, expected: docBranch });
    return "not-doc";
  }
  const forked = docBranchForkedFromDevelop(root, docBranch);
  if (forked === null) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-ff-error", phase: "rev-count" });
    return "error";
  }
  if (forked) {
    // ⛔ 此前只记 {ts,event,phase,branch} ⇒ 该读数【结构上不可解读】：无法区分「只领先
    // （良性——author 刚提交任务状态、无物可拉）」与「既领先又落后（真分叉）」。
    // 两个计数都记上，not-ff 才是一个能说明问题的量，而不只是一个计数器。
    const ahead = revCountAhead(root, "develop", docBranch);   // author 独有
    const behind = revCountAhead(root, docBranch, "develop");  // develop 独有
    writeDocDevelopSyncEvent(root, {
      event: "doc-develop-sync-not-ff", phase: "forked", branch: cur,
      ahead, behind, benign: behind === 0,
    });
    return "not-ff";
  }
  const behind = revCountAhead(root, docBranch, "develop");
  if (behind === null) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-ff-error", phase: "rev-count" });
    return "error";
  }
  if (behind === 0) return "already";
  try {
    // ⛔ 不用 stdio:"ignore"：此前 44 次 ff-error 全是 phase=merge，而 git 的错误原因被丢弃
    // ⇒ 最常见的硬失败【不可归因】（工作树脏？index lock？钩子？无从分辨）。捕获 stderr。
    execFileSync("git", ["-C", root, "merge", "--ff-only", "develop"], { stdio: ["ignore", "ignore", "pipe"] });
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-ff-synced", phase: "synced", branch: cur });
    return "synced";
  } catch (e) {
    // git 的 stderr 进事件 ⇒ 失败可归因（工作树脏 / index lock / 钩子拒绝各自可辨）。
    const err = e as { stderr?: Buffer | string };
    const detail = String(err?.stderr ?? "").trim().split("\n").slice(0, 3).join(" | ").slice(0, 300);
    writeDocDevelopSyncEvent(root, {
      event: "doc-develop-sync-ff-error", phase: "merge",
      detail: detail || "<no-stderr-captured>",
    });
    return "error";
  }
}

// ── 双向分歧检测同步（gap-sync-trigger-divergence-detection-bidirectional）─────────────────────────
// 两 driver 同步触发点原为「committed 翻转才触发」的单向 propagate——只在有翻转落地时触发且仅
// doc→develop 单向。缺口 2026-08-31：池空无翻转时同步一次不跑，develop 靠 fan-in 前进 ⇒ 主检出
// 落后 10 提交。本函数改【分歧检测】：读两 ref（author ↔ develop）不同即双向同步，⛔ 不依赖
// 翻转落地。方向：
//   - develop→doc = syncDevelopToDoc（机械 ff-only，develop 前进时把主检出快进）
//   - doc→develop = propagateDocBranchToDevelop（ff-only + 语义兜底，主检出翻转/立案到达 develop）
// 两 ref 相同 ⇒ 无分歧 ⇒ no-op（不写事件——每轮写会刷日志）。ref 读失败 / 分支未建（非 git / bare
// test repo）⇒ 返回 "no-refs"（可区分取值，⛔ 与「无分歧 already」同形，硬规则 3b/6），不写事件
// （写 .quay/ 会污染 repo-less/bare 单测临时目录的 clean-tree 断言）。分歧 ⇒ 双向同步 + 落痕
// "doc-develop-sync-bidirectional"——doc→develop 的 ff 成功路径本身不写事件，本落痕是 AC3 生产载体的
// 记录来源（「真实分歧触发后事件日志有记录」在 doc 前进的 ff 形态下仍取得到）。

/** 读 ref 的 commit SHA（`git rev-parse <ref>`）。ref 不存在 / git 出错 ⇒ null（读不懂 ≠ 相等）。 */
function revParse(root: string, ref: string): string | null {
  try {
    const out = execFileSync("git", ["-C", root, "rev-parse", ref], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** 双向分歧检测同步（gap-sync-trigger-divergence-detection-bidirectional）：读两 ref 不同即触发双向
 *  同步（develop→doc 后 doc→develop）。`docBranch` 缺省 = 运行时派生的当前 checked-out 分支
 *  （resolveDocBranch，⛔ 非硬编码 "author"——第三方项目工作分支任意命名）。返回独立取值：
 *   - "no-refs" — 读 ref 失败 / 双分支未建（非 git / bare test repo）⇒ 无同步对象（⛔ 非「无分歧」）
 *   - "already" — 两 ref 相同 ⇒ 无分歧（no-op，不写事件）
 *   - "synced"  — 分歧 ⇒ 双向同步已执行 + 落痕 doc-develop-sync-bidirectional 事件 */
export function syncDocDevelopBidirectional(root: string, docBranch: string | null = resolveDocBranch(root)): string {
  if (docBranch === null) return "no-refs"; // 读分支失败 ⇒ 无同步对象（⛔ 非「无分歧」）
  const docSha = revParse(root, docBranch);
  const developSha = revParse(root, "develop");
  if (docSha === null || developSha === null) return "no-refs";
  if (docSha === developSha) return "already";
  const developToDoc = syncDevelopToDoc(root, docBranch);
  const docToDevelop = propagateDocBranchToDevelop(root);
  writeDocDevelopSyncEvent(root, {
    event: "doc-develop-sync-bidirectional",
    phase: "done",
    developToDoc,
    docToDevelop: String(docToDevelop),
  });
  return "synced";
}

// ── needs-human 注记携带实际失败步（gap-needs-human-note-carries-step-verdict）───────────────────────
// 原 worker-driver.ts 的「上次 exited-not-landed 失败原因」读法上收到本文件（与 readTaskStatus 同族：
// 读 task/outcome 状态的单一真相源，⛔ worker-driver 不各写一份）。markNeedsHuman 与 worker 的续做
// prompt 共用同一读法 ⇒ 注记与续做提示读到的失败步同形。

/** outcome 文件的仓库相对路径（gitignored 运行时日志，dispatch-record.jsonl 同族）。 */
export const WORKER_OUTCOME_REL = ".quay/worker-outcome.jsonl";

/** 把一条 exited-not-landed 记录格式化为人可读的失败原因（gap-fan-in-merge-develop-derived-recompute-
 *  and-reason B）。优先读 mechanical_fan_in（step + reason 拼接成「step=merge-develop: CONFLICT in <file>」）
 *  ——merge develop 冲突的具体文件在 mechanical_fan_in.reason 里，通用 failure_reason 只写「task status=ready
 *  not done」，⛔ 不含冲突文件 ⇒ worker 无从精准 resolve。mechanical_fan_in 无 step（缺键 / 非 red / 非对象）
 *  ⇒ 回退 failure_reason（保留旧行为——非机械 fan-in 失败 / 落地未证实的记录仍读通用 reason）。 */
export function formatExitedNotLandedReason(failureReason: unknown, mechanicalFanIn: unknown): string | null {
  if (mechanicalFanIn && typeof mechanicalFanIn === "object") {
    const m = mechanicalFanIn as { step?: unknown; reason?: unknown };
    if (typeof m.step === "string" && m.step) {
      const reason = typeof m.reason === "string" && m.reason ? m.reason : "(no reason)";
      return `step=${m.step}: ${reason}`;
    }
  }
  return typeof failureReason === "string" ? failureReason : null;
}

/** 一条 exited-not-landed 尝试的机械读数（gap-worker-execution-history-index-not-reachable-from-task
 *  B/C）：worker-outcome.jsonl 该 task 的全部 exited-not-landed 记录，每条投影出 (ts, run_id, session_id,
 *  step, reason, fanInLog/suiteLog 绝对路径)。索引主键 = ts+step（⛔ 非 runId——runId 是 driver 轮次级、
 *  非 per-attempt，本例 3 次同 runId）。suiteLog = suite 红时真因文件（.quay/fan-in-suite-*.log）的绝对
 *  路径；fanInLog = 机械 fan-in 过程日志（.quay/fan-in-*.log）绝对路径。 */
export interface ExitedNotLandedAttempt {
  ts: string | null;
  runId: string | null;
  sessionId: string | null;
  /** mechanical_fan_in.step（非机械 fan-in 失败 / 读不懂 ⇒ null）。 */
  step: string | null;
  /** 格式化失败原因（formatExitedNotLandedReason：优先 step=…: reason，回退 failure_reason）。 */
  reason: string | null;
  /** fan-in 过程日志绝对路径（mechanical_fan_in.fanInLog 存在时非 null）。 */
  fanInLog: string | null;
  /** suite 真因日志绝对路径（mechanical_fan_in.suiteLog 存在时非 null——suite 红）。 */
  suiteLog: string | null;
}

/** 把 mechanical_fan_in 的日志 basename 还原成绝对路径（⛔ 记录只存 basename——与 fanInLog 同形，硬规则
 *  4c：不靠命名约定猜，也不把绝对路径写进 durable 索引）。basename 缺 / 非字符串 ⇒ null。 */
function outcomeLogPath(root: string, basename: unknown): string | null {
  return typeof basename === "string" && basename ? path.join(root, ".quay", basename) : null;
}

/** 该 task 全部 exited-not-landed 尝试（时间序 = 文件行序）。⛔ 只取最后一条是 B 的病根——重跑 worker
 *  看不到前两次栽在哪、也看不到日志路径。无记录 / 读失败 ⇒ []（读不懂 ≠ 无失败——空清单与「无记录」同形，
 *  续做 prompt 以 "(no prior attempts)" 呈现）。主键 ts+step（runId 非 per-attempt）。 */
export function exitedNotLandedAttempts(root: string, taskId: string): ExitedNotLandedAttempt[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, WORKER_OUTCOME_REL), "utf8");
  } catch {
    return [];
  }
  const attempts: ExitedNotLandedAttempt[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: {
      task?: unknown; final_state?: unknown; failure_reason?: unknown; mechanical_fan_in?: unknown;
      ts?: unknown; run_id?: unknown; session_id?: unknown;
    };
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (rec.task !== taskId || rec.final_state !== "exited-not-landed") continue;
    const mfi = rec.mechanical_fan_in as { step?: unknown; fanInLog?: unknown; suiteLog?: unknown } | undefined;
    attempts.push({
      ts: typeof rec.ts === "string" ? rec.ts : null,
      runId: typeof rec.run_id === "string" ? rec.run_id : null,
      sessionId: typeof rec.session_id === "string" ? rec.session_id : null,
      step: mfi && typeof mfi.step === "string" && mfi.step ? mfi.step : null,
      reason: formatExitedNotLandedReason(rec.failure_reason, rec.mechanical_fan_in),
      fanInLog: mfi ? outcomeLogPath(root, mfi.fanInLog) : null,
      suiteLog: mfi ? outcomeLogPath(root, mfi.suiteLog) : null,
    });
  }
  return attempts;
}

/** 该 task 最近一条 exited-not-landed 的失败原因（AC2「上次失败原因」，读 worker-outcome.jsonl）。
 *  无记录 / 读失败 ⇒ null（读不懂 ≠ 无失败——但续做 prompt 以 "(unknown)" 呈现，不伪装成「没有失败」）。
 *  ⛔ 单 reader：委托 exitedNotLandedAttempts（与 markNeedsHuman / 续做 prompt 共用同一读法，⛔ 各读一遍）。 */
export function lastExitedNotLandedReason(root: string, taskId: string): string | null {
  const attempts = exitedNotLandedAttempts(root, taskId);
  return attempts.length > 0 ? attempts[attempts.length - 1].reason : null;
}

// ── needs-human 成因类枚举【已退役】（gap-retire-needs-human-cause-enumeration，2026-09-20）─────
// 此处原有 needs-human 成因类的三态 frontmatter 字段（human-adjudication / blocked-outside-task /
// unclassified）、手写的「人须裁决」步骤名清单、以及第二类的再入队证据谓词（连同只服务于它的
// ff-escalation 读取器与 git ancestor 判定）。
// 实测（2026-09-20 直接量）：磁盘上带该字段的任务 37 个——human-adjudication 29 / unclassified 8 /
// blocked-outside-task 【0】；再入队证据谓词零个非测试调用者。即这套机制存在的全部理由（区分第二类
// 并据证据谓词再入队）在生产里一次都没发生过，且步骤名清单是开放世界（新增一个 fan-in 步骤就漏，
// 步骤名 `ff` 还会把证书闸失败错标成「develop 前进」）。
// 人的裁定（2026-09-20，逐字）：「needs-human 本来就不应该有『可机械再入队』的路径。」「我对靠枚举
// 成因字段做逻辑控制也没有太大信心 —— needs-human 的原因应当是异常，枚举异常是靠不住的。」
// ⇒ 整套删除，⛔ 不新增任何替代分类或再入队路径。磁盘上已有的 37 个遗留成因字段作惰性保留
// （⛔ 不批量改任务文件，硬规则 11b）。注记里的事实行（阻碍原因 / 失败步判词 / run_id / session_id /
// suite 日志 / fan-in 日志）全部保留。完整被删符号清单见任务体。

// gap-park-reason-mislabels-ac-precheck-as-suite-red 点 3：`## Needs-Human` 小标题与提交消息过去【恒写】
// 「重试上限」——实测（claudecodeui 2026-09-24→10-01）73 段小标题 + 73 条提交消息全写「重试上限」，而
// 走 RETRY-CAP(3) 路径的停派【0 条】；真因（AC 未全勾短路被误判为「suite 红归因不出」而两轮停派）恒被
// 写错。⇒ 由调用方传入【停派种类】，小标题/提交消息按种类选择（⛔ 不再写死一个词）。
/** needs-human 停派种类：`retry-cap` = 达重试上限而翻转；`stop-terminal` = 失败无法归因而停（与重试上限
 *  无关）；`quick-death-backoff` = 快速死亡退避耗尽而停（GOAL-035：此前该路径省略 kind 参数 ⇒ 落盘被静默
 *  误标成缺省 `retry-cap`，即使原因文案描述的是快速死亡退避）；`other` = 其它机械停派。 */
export type NeedsHumanKind = "retry-cap" | "stop-terminal" | "quick-death-backoff" | "other";

/** `## Needs-Human` 段小标题（按停派种类选择；⛔ 不写死）。 */
export function needsHumanHeading(kind: NeedsHumanKind): string {
  if (kind === "retry-cap") return "连续修满重试上限仍不合格（标 needs-human）";
  if (kind === "stop-terminal") return "停派终止（失败无法归因，⛔ 不再重派）";
  if (kind === "quick-death-backoff") return "连续快速死亡退避耗尽（标 needs-human）";
  return "机械停派（标 needs-human）";
}

/** needs-human 提交消息里的【停派】标签（按种类选择；⛔ 不写死「重试上限」）。 */
function needsHumanCommitLabel(kind: NeedsHumanKind): string {
  if (kind === "retry-cap") return "重试上限机械翻转";
  if (kind === "stop-terminal") return "归因不出机械停派";
  if (kind === "quick-death-backoff") return "快速死亡退避耗尽机械翻转";
  return "机械停派";
}

/** 把修满/派满上限仍不合格的任务标 needs-human（status todo/ready → needs-human）+ 追加一条
 *  `## Needs-Human` 审计记录（grep-able 原因，⛔ 静默翻转）。worker 派发的是 ready 任务、promotion
 *  修的是 todo 任务 ⇒ 两者都可翻 needs-human；其它状态（needs-human/done/superseded…）拒写。
 *  只在 status ∈ {todo, ready} 时写（并发保护，同 ready-pool-check 的 setTaskStatus）。
 *  COMMIT-AFTER-WRITE (gap-mark-needs-human-commit-after-write)：写盘即提交（复用 commitTaskFile 族，
 *  ⛔ 不写第四份）——翻转后主检出不留脏树（硬规则 11b：盘上翻转改变派发计算但对读 git 的人不可见）。
 *  返回 { id, ok, reason, committed }——ok=false 表示未写（missing/无 frontmatter/非 todo·ready）；
 *  committed=false 表示未提交（repo-less 单测临时目录 no-op，或 git 提交失败）。
 *  ⛔ 不再写成因类 frontmatter 字段、⛔ 不再返回 cause（gap-retire-needs-human-cause-enumeration：
 *  三态成因枚举已整套退役——零非测试读者、零 blocked-outside-task 生产样本；人的裁定「needs-human
 *  本来就不应该有『可机械再入队』的路径」。⛔ 不引入任何替代分类）。 */
export function markNeedsHuman(root: string, id: string, reason: string, kind: NeedsHumanKind = "retry-cap"): { id: string; ok: boolean; reason: string; committed: boolean } {
  const file = path.join(root, "tasks", `${id}.md`);
  if (!fs.existsSync(file)) return { id, ok: false, reason: "missing", committed: false };
  const raw = fs.readFileSync(file, "utf8");
  // gap-task-ops-consolidate-driver-frontmatter-writers：frontmatter 读/写经 task-ops.ts（splitTaskFile /
  // statusFromFrontmatter / patchStatusField，单一 parser，⛔ 不再手搓 status 行正则）。
  const split = splitTaskFile(raw);
  if (!split) return { id, ok: false, reason: "no-frontmatter", committed: false };
  const from = statusFromFrontmatter(split.frontmatterRaw);
  if (from !== TASK_STATUS.TODO && from !== TASK_STATUS.READY) return { id, ok: false, reason: "not-todo", committed: false };
  const patched = patchStatusField(split.frontmatterRaw, TASK_STATUS.NEEDS_HUMAN);
  if (!patched.ok) return { id, ok: false, reason: patched.reason, committed: false };
  // gap-needs-human-note-carries-step-verdict：注记携带最近 exited-not-landed 的实际失败步+判词
  // （⛔ 只写模板句会把 merge 冲突 / suite 红 / ac-gate 未勾等完全不同真因压扁成同一句——读注记无法区分）。
  // 无记录 / 读不懂 ⇒ 不追加该行（与旧行为同形，⛔ 不伪造成「有失败步」）。
  // gap-worker-execution-history-index-not-reachable-from-task C：注记补 run_id / 日志路径 / session_id
  // （复用同一 reader 已读的 outcome，⛔ 不新增 reader——exitedNotLandedAttempts 一次读文件，步判词与
  // 指针同源）。无对应字段 ⇒ 缺省该行（⛔ 不伪造）。
  const attempts = exitedNotLandedAttempts(root, id);
  const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
  const stepVerdict = lastAttempt ? lastAttempt.reason : null;
  const record =
    `\n## Needs-Human\n\n**执行 ${new Date().toISOString()} — ${needsHumanHeading(kind)}**\n\n` +
    `- 阻碍原因：${reason}\n` +
    (stepVerdict ? `- 失败步/判词：${stepVerdict}\n` : "") +
    (lastAttempt?.runId ? `- run_id：${lastAttempt.runId}\n` : "") +
    (lastAttempt?.sessionId ? `- session_id：${lastAttempt.sessionId}\n` : "") +
    (lastAttempt?.suiteLog ? `- suite 日志：${lastAttempt.suiteLog}\n` : "") +
    (lastAttempt?.fanInLog ? `- fan-in 日志：${lastAttempt.fanInLog}\n` : "");
  const written = `${split.open}${patched.fm}${split.close}${split.body}${record}`;
  fs.writeFileSync(file, written);
  const at = new Date().toISOString();
  const rel = path.join("tasks", `${id}.md`);
  // FIRST-REGISTRATION JUDGMENT (gap-promotion-commit-message-misleading-on-first-track)：目标文件此前
  // 从未提交（本次提交是其 git 诞生提交，谈不上 todo→needs-human「翻转」）⇒ 如实标「首次登记」，不得
  // 沿用暗示翻转发生的旧措辞。已有提交历史 ⇒ 真实翻转，按【停派种类】选措辞
  // （gap-park-reason-mislabels-ac-precheck-as-suite-red 点 3：⛔ 不再恒写「重试上限」）。
  const message = hasPriorCommit(root, rel)
    ? `tasks: ${id} ${from}→needs-human（${needsHumanCommitLabel(kind)}）`
    : `tasks: ${id} 首次登记（status=needs-human，${kind === "retry-cap" ? "重试上限机械落盘" : "机械停派落盘"}）`;
  const committed = commitTaskFile(root, rel, message);
  // gap-task-status-events-contract-v1: the SECOND writer this file owns now emits the v1 event too
  // (the first is applyStatusAlignments). Written AFTER the commit (硬规则 7 + the v1 ordering), so
  // `evidence.commit` names the commit that carries the flip — this is the transition that had ZERO
  // events before this task.
  appendTaskStatusEvent(root, {
    taskId: id,
    from,
    to: TASK_STATUS.NEEDS_HUMAN,
    kind: kindForStatusPair(from, TASK_STATUS.NEEDS_HUMAN),
    actor: { kind: "unknown", id: "driver-filters markNeedsHuman" },
    reason,
    at,
    evidence: {
      commit: committed ? revParseHeadOf(root) : null,
      statusBlobSha: gitBlobSha(written),
      ...(committed ? {} : { commitAbsentReason: "commitTaskFile did not land (repo-less workspace or git commit failed)" }),
    },
  });
  syncDocDevelopBidirectional(root); // 分歧检测双向同步（⛔ 不依赖 committed 翻转）
  return { id, ok: true, reason, committed };
}

/** 「标记一个任务 needs-human」这【一个决策】的全部副作用的唯一拥有者：内存 latch（needsHuman 集合 +
 *  可选 counts 覆写）与磁盘落盘承诺（markNeedsHuman）在这一处配对。worker-driver 的三条路径
 *  （stop-terminal / retry-cap / quick-death）都必须经此函数——⛔ 调用方不得再直接动
 *  state.needsHuman/state.counts（GOAL-035 AC-356 按位置核验：worker-driver.ts 对
 *  `retryState.needsHuman.add(`/`retryState.counts.set(` 的直接调用各为 0）。
 *  语义：已标记的 id 不重复加（latch 幂等，与 advanceRetryCap 的去重一致），但【磁盘承诺照常执行并
 *  返回】——返回值永不丢弃（旧 quick-death 调用点丢弃返回值 ⇒ 该转移在 needsHumanResults/`needs-human`
 *  json 事件里结构上不可见，正是硬规则 9「可见性 ≠ 执行」的一个真实实例）。
 *  `countsOverride` 供 stop-terminal 路径把重试预算记满（counts.set(id, maxRetries)，与旧行为逐字一致）；
 *  仅在该 id 尚未标记时生效（幂等）。失败态（missing / no-frontmatter / not-todo·ready / repo-less
 *  uncommitted）如实返回 ok:false/committed:false，⛔ 不抛、⛔ 不吞。 */
export function applyNeedsHumanTransition(
  state: RetryState,
  root: string,
  write: { id: string; reason: string; kind: NeedsHumanKind },
  opts: { countsOverride?: number } = {},
): { id: string; ok: boolean; reason: string; committed: boolean } {
  if (!state.needsHuman.has(write.id)) {
    state.needsHuman.add(write.id);
    if (opts.countsOverride !== undefined) state.counts.set(write.id, opts.countsOverride);
  }
  return markNeedsHuman(root, write.id, write.reason, write.kind);
}

/** 候选未被标 needs-human（status 非 needs-human）。读不懂 ⇒ fail-closed 滤掉（⛔ 读不懂 ≠ 合格）。 */
export const notNeedsHuman: TaskFilter = {
  name: "notNeedsHuman",
  predicate: (ctx) => (id) => {
    const status = readTaskStatus(ctx.root, id);
    return status !== null && status !== TASK_STATUS.NEEDS_HUMAN;
  },
};

// ── 可组合谓词列表（单一真相源：两 driver 共用，⛔ 不各写一遍） ─────────────────────────────────────

/** 派发前过滤的可组合谓词列表。新增谓词 = 往这里加一行，worker / promotion 两 driver 同时生效
 *  （经 applyTaskFilters 消费）。⛔ 本文件之外不得再出现一份谓词实现。 */
export const TASK_FILTERS: readonly TaskFilter[] = [
  notInFlight,
  depsSatisfied,
  touchesDisjointOrAged,
  retryCapNotExhausted,
  notNeedsHuman,
];

// ── GOAL-037 方案第 0 步：filtered-empty 轮的【逐候选 × 逐谓词】归因（⛔ 只增观测） ────────────────
//
// WHY（AC-362）：`filtered-empty` 这一个 stop_reason 字面量把五种互不相同的成因压成同形——候选分别被
// notInFlight / depsSatisfied / touchesDisjoint / retryCapNotExhausted / notNeedsHuman 滤掉。要判
// 「touches 单独把某任务挡了超过阈值 ⇒ 允许放宽」时，现有载体答不出「哪些候选是被 touches 挡的、被谁
// 挡的、挡了多久」⇒ 阈值/名额/自动收紧都无读数可依（硬规则 4 推论三：先要有穿过所有中间层、验收那
// 一刻仍取得到的量，才谈得上给它设阈值）。本条【只加观测】：applyTaskFilters 的返回集合与顺序逐个
// 不变，trace 走新增的可选参数，两个 driver 既有调用位点的判定输入不动。

/** 一个被滤掉的（候选 × 谓词）判定。`blocker` / `overlapFiles` **仅** touchesDisjoint 条目非空；
 *  `waitedMinutes` 读不到 ⇒ `null`（⛔ 不写 0——缺值 = 未查，硬规则 6）。 */
export interface FilterTraceEntry {
  /** 被滤掉的候选 task id。 */
  task: string;
  /** 滤掉它的谓词名（= 该谓词自己的 `TaskFilter.name`，⛔ 不另抄一份字面量——新增谓词仍只是一行）。 */
  filter: string;
  /** 仅 `touchesDisjoint` 非 null：`ctx.inFlight` 中【第一个】与其重叠的在飞 task id（顺序确定 ⇒
   *  读数可复现）。其余谓词恒 `null`。⚠️ 多对手时只记第一个——本条只做 AC 逐字要求的单 blocker 形状。 */
  blocker: string | null;
  /** 仅 `touchesDisjoint` 非空：由【真实】`checkTouchesPair(...).overlaps` 得出的交集（沿用其排序）。
   *  ⛔ 已排除候选自身的任务文件 `tasks/<候选 id>.md`（自 touch 会把该路径带进展开集，不是与对手的
   *  冲突面；排除后 blocker 仍被点名，可归因性不受损）。 */
  overlapFiles: string[];
  /** 「现在」与 `.quay/task-status-events.jsonl` 中该任务【第一条 `to:"ready"`】记录时刻之差（分钟）。
   *  读不到（无该记录 / 载体不可读）⇒ `null`（⛔ 不写 0）。 */
  waitedMinutes: number | null;
  /** **仅 `touchesDisjointOrAged` 条目**有（GOAL-037 / AC-365）：该候选在本轮 mode 下**会不会**被放宽。
   *  `mode: off`（含配置块缺失）⇒ 恒 `false` —— off 不做放宽判断，⛔ 不出现 `true`。判断只标注，
   *  ⛔ 不影响放行（off 与 shadow 的返回集合逐元素相同）。其余四个谓词的条目上**没有**这两个键。 */
  wouldRelax?: boolean;
  /** **仅 `touchesDisjointOrAged` 条目**有：首个不满足的放宽条件 id（`RELAX_CONDITIONS` 之一）；
   *  全满足 ⇒ `null`。off ⇒ 恒 `null`。 */
  relaxBlockedBy?: RelaxCondition | null;
}

/** trace 汇：`applyTaskFilters` 每发现一个被滤掉的（候选 × 谓词）就调用一次（逐条，⛔ 不短路）。 */
export type FilterTraceSink = (entry: FilterTraceEntry) => void;

/** 读一次 `.quay/task-status-events.jsonl`，建 task → 【首个】`to:"ready"` 时刻(ms) 的映射。
 *  ⛔ 每轮读一次（trace 路径上只调一次），⛔ 不逐候选重读全量 jsonl；解析走 kernel 的
 *  `readTaskStatusTransitions`（硬规则 1：⛔ 不手搓 jsonl 解析）。载体不可读 ⇒ 空映射 ⇒ 下游
 *  `waitedMinutes: null`（「读不到」，⛔ 不伪装成 0）。 */
export function buildReadyAtMsMap(root: string): Map<string, number> {
  const map = new Map<string, number>();
  let transitions: ReturnType<typeof readTaskStatusTransitions>["transitions"];
  try {
    transitions = readTaskStatusTransitions(root).transitions;
  } catch {
    return map; // 读不到 ⇒ 空映射（下游 null），⛔ 不抛、⛔ 不写成 0
  }
  for (const t of transitions) {
    if (t.to !== TASK_STATUS.READY) continue;
    const at = Date.parse(t.at);
    if (!Number.isFinite(at)) continue;
    // 载体序 ⇒ 首条即「第一次进入 ready」；⛔ 后来的 ready 记录不覆盖（硬规则 6 的另一半：不静默改判）。
    if (!map.has(t.taskId)) map.set(t.taskId, at);
  }
  return map;
}

/** touchesDisjoint 条目的归因面：对每个在飞对手跑【真实】`checkTouchesPair`，取首个非互斥者作
 *  `blocker`，其 `overlaps`（已排序）去掉候选自身任务文件后作 `overlapFiles`。
 *  ⛔ 不重写重叠数学（单一真相源 = touches-orthogonality-check 的 `parseTouches`/`checkTouchesPair`/
 *  `normalizePath` + concurrent-batch-scheduler 的 `expandDeclaredTouches`）；本函数只【再调一次】
 *  它们。存在这一份重复的读取闭包，正是因为 `touchesDisjoint` 谓词本身必须逐字不变（AC9 / Plan 1
 *  「五个谓词的实现一处不改」）——语义随谓词变化的方式，是两者读同一批单一真相源函数。 */
function makeTouchesAttributor(ctx: FilterContext): (id: string) => { blocker: string | null; overlapFiles: string[] } {
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
  return (id: string) => {
    const self = readTouches(id);
    // 候选自身的任务文件（规范化后比较；展开集里的条目由 normalizePath 产出）。
    const selfTaskFile = normalizePath(path.join("tasks", `${id}.md`));
    for (const other of ctx.inFlight) {
      const pair = checkTouchesPair(self, readTouches(other), expand);
      if (pair.disjoint) continue;
      return { blocker: other, overlapFiles: pair.overlaps.filter((f) => normalizePath(f) !== selfTaskFile) };
    }
    return { blocker: null, overlapFiles: [] };
  };
}

/** 对候选 id 列表应用谓词列表（缺省 = 全部 TASK_FILTERS；`names` 传子集——promotion 的 fix pass
 *  只消费 retryCapNotExhausted / notNeedsHuman，其余（deps/touches/in-flight）由 ready-pool-check 的
 *  eligible 已在闸内判定，再滤一遍会丢掉 AC134 的 skip 台账）。谓词逐个构造一次，再逐候选判定。
 *
 *  `trace`（GOAL-037，新增【可选】参数）：给了就逐候选 × 逐谓词判定，**被滤掉的**（候选 × 谓词）
 *  各产生一条 `FilterTraceEntry`（⛔ 不短路——一个候选可命中多个谓词，五个成因必须各自可辨）。
 *  ⛔ 给了 trace 也不改下面的返回表达式：集合与顺序逐个不变（AC9 特征化）。 */
export function applyTaskFilters(candidateIds: string[], ctx: FilterContext, names?: readonly string[], trace?: FilterTraceSink | null): string[] {
  const filters = names ? TASK_FILTERS.filter((f) => names.includes(f.name)) : [...TASK_FILTERS];
  const preds = filters.map((f) => f.predicate(ctx));
  if (trace) {
    // 载体每轮读一次并建映射（⛔ 不逐候选重读全量 jsonl）；now 本轮取一次，条目间的差只反映
    // ready 时刻之差（AC8 的 Δ 断言据此成立）。
    const readyAtMs = buildReadyAtMsMap(ctx.root);
    const nowMs = Date.now();
    const touchesAt = makeTouchesAttributor(ctx);
    // GOAL-037（AC-365）：touches 那一格的标签表（off ⇒ 恒无标签）。它挂在【本次过滤构造的那一个】
    // 谓词函数上，故这里读到的就是逐候选判定的同一份结果（⛔ 不重跑谓词）。
    const relaxIdx = filters.indexOf(touchesDisjointOrAged);
    const relaxAt = relaxIdx >= 0 ? RELAX_ATTRIBUTION.get(preds[relaxIdx]) ?? null : null;
    for (const id of candidateIds) {
      // 本轮**所有**滤掉该候选的谓词（准入集合的条件①「被 touches 单独挡住」的判定输入）。先收齐
      // 再发条目 ⇒ 条目内容与「一个候选可命中多个谓词」的语义一致（⛔ 不短路）；条目仍按 filters
      // 顺序发出，集合与顺序与逐条即时发出时逐个相同。
      const blocked: string[] = [];
      for (let i = 0; i < filters.length; i++) if (!preds[i](id)) blocked.push(filters[i].name);
      if (relaxAt) relaxAt.setFilteredBy(id, blocked);
      if (blocked.length === 0) continue;
      for (let i = 0; i < filters.length; i++) {
        const name = filters[i].name;
        if (!blocked.includes(name)) continue;
        const att = name === TOUCHES_RELAX_FILTER_NAME ? touchesAt(id) : { blocker: null, overlapFiles: [] as string[] };
        const readyAt = readyAtMs.get(id);
        const entry: FilterTraceEntry = {
          task: id,
          filter: name,
          blocker: att.blocker,
          overlapFiles: att.overlapFiles,
          waitedMinutes: readyAt === undefined ? null : Math.floor((nowMs - readyAt) / 60000),
        };
        // GOAL-037（AC-365）：两键**只**长在 touches 那一格上（⛔ 不改五个既有谓词的条目形状）。
        // off ⇒ `wouldRelax:false` + `relaxBlockedBy:null`（off 不做放宽判断，⛔ 不出现 true）；
        // shadow ⇒ 满足全部条件者 `true`、否则点名首个不满足的条件 id。
        if (name === TOUCHES_RELAX_FILTER_NAME) {
          const ann = relaxAt ? relaxAt.annotationFor(id) : null;
          entry.wouldRelax = ann ? ann.wouldRelax : false;
          entry.relaxBlockedBy = ann ? ann.relaxBlockedBy : null;
        }
        trace(entry);
      }
    }
  }
  return candidateIds.filter((id) => preds.every((p) => p(id)));
}
