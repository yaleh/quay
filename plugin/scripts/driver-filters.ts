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

// ── commit-after-write（主检出 status 翻转写盘即提交；单一真相源，⛔ 不各写一份） ───────────────────

/** True when `root` is inside a git work tree (production root = the main checkout). False when git
 *  itself errors (unit-test temp dirs, or a repo-less root) — the commit is then a no-op, not a throw. */
export function isInsideGitWorkTree(root: string): boolean {
  try {
    const out = execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.toString().trim() === "true";
  } catch {
    return false;
  }
}

/** COMMIT-AFTER-WRITE (gap-mark-needs-human-commit-after-write): commit a single task file to git
 *  immediately after a mechanical status flip. pathspec-limited to `rel` (⛔ never a bare `git commit`,
 *  which would sweep whatever another layer staged into the SHARED index — memory
 *  git-commit-no-pathspec-commits-shared-index). `--no-verify` skips the pre-commit hook: a mechanical
 *  status flip is content-neutral. Repo-less unit-test temp dirs are a no-op (return false, not a throw).
 *  Returns true when the commit landed; false on repo-less / git error (surfaced as `committed: false`,
 *  observable not silent). */
export function commitTaskFile(root: string, rel: string, message: string): boolean {
  if (!isInsideGitWorkTree(root)) return false;
  try {
    execFileSync("git", ["-C", root, "add", "--", rel]);
    execFileSync("git", ["-C", root, "commit", "--no-verify", "-m", message, "--", rel]);
    return true;
  } catch {
    return false;
  }
}

/** Propagate the doc branch to develop (gap-fan-in-ff-ref-update-detach-develop): the main checkout
 *  sits on the doc-only work branch (main/manager-doc). A flip committed THERE must reach develop so
 *  task worktrees (branching from develop) see the new status — otherwise dispatch reads the new status
 *  on main/manager-doc while the worktree base (develop) still has the old one. Fast-forward push; if
 *  develop advanced (non-ff), merge develop first then push. Best-effort: a conflict leaves the flip on
 *  the doc branch and the next landing's merge-develop reconciles. */
export function propagateDocBranchToDevelop(root: string): void {
  try {
    const cur = execFileSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }).trim();
    if (!cur || cur === "develop") return;
    try {
      execFileSync("git", ["-C", root, "push", ".", `${cur}:develop`], { stdio: "ignore" });
    } catch (_) {
      // Develop advanced past the doc branch — merge it in, then push (fast-forward now).
      execFileSync("git", ["-C", root, "merge", "develop", "--no-edit"], { stdio: "ignore" });
      execFileSync("git", ["-C", root, "push", ".", `${cur}:develop`], { stdio: "ignore" });
    }
  } catch (_) { /* best-effort — next landing's merge-develop reconciles */ }
}

/** 把修满/派满上限仍不合格的任务标 needs-human（status todo/ready → needs-human）+ 追加一条
 *  `## Needs-Human` 审计记录（grep-able 原因，⛔ 静默翻转）。worker 派发的是 ready 任务、promotion
 *  修的是 todo 任务 ⇒ 两者都可翻 needs-human；其它状态（needs-human/done/superseded…）拒写。
 *  只在 status ∈ {todo, ready} 时写（并发保护，同 ready-pool-check 的 setTaskStatus）。
 *  COMMIT-AFTER-WRITE (gap-mark-needs-human-commit-after-write)：写盘即提交（复用 commitTaskFile 族，
 *  ⛔ 不写第四份）——翻转后主检出不留脏树（硬规则 11b：盘上翻转改变派发计算但对读 git 的人不可见）。
 *  返回 { id, ok, reason, committed }——ok=false 表示未写（missing/无 frontmatter/非 todo·ready）；
 *  committed=false 表示未提交（repo-less 单测临时目录 no-op，或 git 提交失败）。 */
export function markNeedsHuman(root: string, id: string, reason: string): { id: string; ok: boolean; reason: string; committed: boolean } {
  const file = path.join(root, "tasks", `${id}.md`);
  if (!fs.existsSync(file)) return { id, ok: false, reason: "missing", committed: false };
  const raw = fs.readFileSync(file, "utf8");
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(raw);
  if (!m) return { id, ok: false, reason: "no-frontmatter", committed: false };
  const [, open, fm, close] = m;
  const fromMatch = /^status:\s*(todo|ready)\s*$/m.exec(fm);
  if (!fromMatch) return { id, ok: false, reason: "not-todo", committed: false };
  const newFm = fm.replace(/^status:\s*(todo|ready)\s*$/m, "status: needs-human");
  const body = raw.slice(m[0].length);
  const record =
    `\n## Needs-Human\n\n**执行 ${new Date().toISOString()} — 连续修满重试上限仍不合格（标 needs-human）**\n\n` +
    `- 阻碍原因：${reason}\n`;
  fs.writeFileSync(file, `${open}${newFm}${close}${body}${record}`);
  const rel = path.join("tasks", `${id}.md`);
  const committed = commitTaskFile(root, rel, `tasks: ${id} ${fromMatch[1]}→needs-human（重试上限机械翻转）`);
  if (committed) propagateDocBranchToDevelop(root);
  return { id, ok: true, reason, committed };
}

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
