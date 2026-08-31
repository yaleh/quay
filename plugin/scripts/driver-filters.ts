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
import { TASK_STATUS } from "./task-status.ts";

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
    if (statusOf(depId) !== TASK_STATUS.DONE) return false;
  }
  return true;
}

/** 读 `<ref>:tasks/<taskId>.md` 的 status frontmatter（git show；ref 不存在 / 文件缺失 / 读不懂 ⇒ null）。
 *  canonical source = develop ref——主检出（main/manager-doc）盘上 status 是陈旧快照（硬规则 4b 的
 *  代理量），派发谓词读它会把已 done/ready 的任务按陈旧 needs-human 滤掉
 *  （gap-driver-filters-readtaskstatus-stale-main-checkout）。与 ready-pool-check.ts 的
 *  readTaskStatusAtRef（batch 读，dispatch 整池）同判词；本文件取单任务 `git show` 形态——调用点是
 *  逐 id 的（notNeedsHuman 逐候选、depsSatisfied 逐依赖），⛔ 不上 batch（读一条却 batch 是浪费）。 */
export function readTaskStatusAtRef(root: string, ref: string, taskId: string): string | null {
  let raw: string;
  try {
    raw = execFileSync("git", ["-C", root, "show", `${ref}:tasks/${taskId}.md`], {
      timeout: 30_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("utf8");
  } catch {
    return null;
  }
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const statusLine = m[1].split("\n").map((l) => l.trim()).find((l) => l.startsWith("status:"));
  return statusLine ? (statusLine.slice("status:".length).trim() || null) : null;
}

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

// ── main/manager-doc ↔ develop 同步（gap-doc-develop-sync-semantic-conflict-resolution）──────────────
// 人 2026-08-31 裁定反转：写面保留 main/manager-doc，但状态/任务文件变更必须以 develop 为终点。同步 =
// 机械 ff-only + 语义兜底（机械失败升级确定性语义同步，develop 权威 wins），⛔ 静默 catch。
// 原实现（gap-fan-in-ff-ref-update-detach-develop）是 `: void` + `catch(_){}` 全吞 + `git merge develop`
// 静默 merge-fallback——实证 2026-08-31 一次 propagate 静默失败 ⇒ 4 任务状态分叉 + 主检出落后 develop
// 53 提交无痕（硬规则 3b 的镜像：同步失败 ⇒ 伪装成同步成功）。

/** doc↔develop 同步事件的仓库相对路径（gitignored 运行时日志，worker-outcome.jsonl 同族）。
 *  失败落痕：机械 ff-only 失败 / 语义兜底结果都写到这里，让「同步失败」在记录上可区分（⛔ 静默）。 */
export const DOC_DEVELOP_SYNC_EVENT_REL = ".quay/doc-develop-sync.jsonl";

/** 任务状态确定性优先级（develop 权威 wins 的机械表达）：done > needs-human > ready > todo。
 *  分叉消解取更「前进」的一侧，永不交 LLM（AC2）。 */
export const STATUS_PRIORITY: readonly string[] = ["todo", "ready", "needs-human", "done"];

/** 追加一条 doc↔develop 同步事件（create dir/file as needed）。纯 I/O。 */
export function writeDocDevelopSyncEvent(root: string, record: Record<string, unknown>): string {
  const file = path.join(root, DOC_DEVELOP_SYNC_EVENT_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n", "utf8");
  return file;
}

/** 确定性状态消解（AC2）：两状态分叉取优先级更高者（done>needs-human>ready>todo）。任一读不懂
 *  （非四态）⇒ 用另一侧；都读不懂 ⇒ null。纯函数，无 LLM、无 I/O。 */
export function resolveStatusPriority(a: string | null | undefined, b: string | null | undefined): string | null {
  const candidates = [a, b].filter(
    (s): s is string => typeof s === "string" && STATUS_PRIORITY.includes(s),
  );
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

/** 机械 ff-only push：把 `src` 快进到 develop（`git push . src:develop`）。ff 不成立 / git 出错 ⇒ false。 */
function ffPushToDevelop(root: string, src: string): boolean {
  try {
    execFileSync("git", ["-C", root, "push", ".", `${src}:develop`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** 语义兜底（机械 ff-only 失败后，AC3/AC4）：机械同步失败（ff 不成立）升级到确定性语义同步——
 *  ① `git merge develop -X theirs`（develop 权威 wins：冲突取 develop 侧；develop-only 提交与 doc-only
 *  提交都进历史，⛔ 不 reset/checkout 丢提交，AC4）；② 分叉任务状态按确定性优先级对齐（AC2，永不 LLM）；
 *  ③ ff push develop + 事件落痕。合并冲突（code/docs 语义冲突，机械不能消解）⇒ `git merge --abort`
 *  保树干净 + 事件升级（Claude Code 语义合并接手），返回 false。 */
export function semanticSyncDocToDevelop(root: string, cur: string): boolean {
  writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-semantic", phase: "begin", branch: cur });

  // ② 分叉任务状态确定性对齐（AC2）：merge -X theirs 把冲突侧统一取 develop，可能丢掉 doc 侧更
  // 「前进」的状态（doc=done vs develop=ready）⇒ 合并前先记录优先级胜出者，合并后按它回写。
  const alignments = collectStatusAlignments(root, cur);

  // ① merge develop（-X theirs = 冲突取 develop 侧，develop 权威 wins；⛔ 非静默 merge-fallback——
  // 这里不是「push 失败就吞掉」，而是显式升级语义兜底 + 落痕）。
  try {
    execFileSync("git", ["-C", root, "merge", "develop", "--no-edit", "-X", "theirs"], { stdio: "ignore" });
  } catch {
    try { execFileSync("git", ["-C", root, "merge", "--abort"], { stdio: "ignore" }); } catch { /* 无 merge 可 abort */ }
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-semantic-conflict", phase: "merge", branch: cur });
    return false;
  }

  // 回写优先级胜出的任务状态（仅当 doc 侧更前进时；否则 -X theirs 的 develop 侧已是正确值）。
  if (!applyStatusAlignments(root, alignments)) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-semantic-align-failed", phase: "align", branch: cur });
    return false;
  }

  // ③ ff push develop + 落痕。
  if (!ffPushToDevelop(root, cur)) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-semantic-ff-failed", phase: "push", branch: cur });
    return false;
  }
  writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-semantic-resolved", phase: "done", branch: cur });
  return true;
}

/** 收集分叉任务状态对齐：对每个 tasks/*.md，读 develop 与 cur 的 status，若分叉且优先级胜者是 doc 侧
 *  （即 cur 侧比 develop 更前进）⇒ 记录 { rel → 胜者 status }（合并后回写用）。纯读取，无 LLM。 */
function collectStatusAlignments(root: string, cur: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of listTaskFiles(root, cur)) {
    const developStatus = statusAtRef(root, "develop", rel);
    const curStatus = statusAtRef(root, cur, rel);
    if (developStatus === curStatus) continue;
    const resolved = resolveStatusPriority(developStatus, curStatus);
    // 只回写「doc 侧更前进」的情形（resolved ≠ develop 侧）；develop 侧更前进由 -X theirs 已保证。
    if (resolved !== null && resolved !== developStatus) out.set(rel, resolved);
  }
  return out;
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

/** 读 `<ref>:<rel>` 的 status frontmatter（`git show`）。ref/文件缺失 / 读不懂 ⇒ null。 */
function statusAtRef(root: string, ref: string, rel: string): string | null {
  let text: string;
  try {
    text = execFileSync("git", ["-C", root, "show", `${ref}:${rel}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const line = m[1].split("\n").map((l) => l.trim()).find((l) => l.startsWith("status:"));
  return line ? line.slice("status:".length).trim() || null : null;
}

/** 回写任务状态对齐（合并后）：对每个 {rel → status}，把工作树文件的 status 行改写为胜者（已对齐
 *  则跳过），`git add` 后一次性 `git commit --no-verify`（路径限定到改写过的文件，⛔ 裸 commit 扫共享
 *  索引）。无改写 ⇒ true（no-op）。写/提交失败 ⇒ false（事件落痕由调用方）。 */
function applyStatusAlignments(root: string, alignments: Map<string, string>): boolean {
  const changed: string[] = [];
  for (const [rel, status] of alignments) {
    const file = path.join(root, rel);
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return false;
    }
    const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(raw);
    if (!m) return false;
    const [, open, fm, close] = m;
    const statusLine = /^status:\s*\S+\s*$/m.exec(fm);
    if (!statusLine) return false;
    if (statusLine[0].replace(/^status:\s*/, "").trim() === status) continue; // 已对齐（merge 已保留 doc 侧胜者）
    const newFm = fm.replace(statusLine[0], `status: ${status}`);
    fs.writeFileSync(file, `${open}${newFm}${close}${raw.slice(m[0].length)}`, "utf8");
    changed.push(rel);
  }
  if (changed.length === 0) return true;
  for (const rel of changed) {
    try { execFileSync("git", ["-C", root, "add", "--", rel], { stdio: "ignore" }); } catch { return false; }
  }
  try {
    execFileSync(
      "git",
      ["-C", root, "commit", "--no-verify", "-m", "sync: 确定性 status 对齐（develop 权威 + done>needs-human>ready>todo）", "--", ...changed],
      { stdio: "ignore" },
    );
  } catch {
    return false;
  }
  return true;
}

/** Propagate the doc branch to develop（gap-doc-develop-sync-semantic-conflict-resolution）：主检出在
 *  doc-only 工作分支（main/manager-doc），翻转提交到那里必须到 develop，任务 worktree（从 develop 分支）
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
  if (ffPushToDevelop(root, cur)) return true; // 机械 ff-only 成功
  return semanticSyncDocToDevelop(root, cur); // 机械失败 ⇒ 升级语义兜底
}

// ── develop→doc 机械同步（ff-only + 分叉 guard，gap-main-manager-doc-doc-only-ff-only-tracking）───────
// 主检出（main/manager-doc）落后 develop 时生产跑的是旧代码（promotion-driver 常驻从主检出工作树加载，
// CLAUDE.md 分支同步纪律「需定期 merge develop 追上」）。旧实现是静默 merge-fallback——`git merge develop`
// 每次冲突，近 30 天 1795 次 "Merge branch 'develop' into main/manager-doc" 全由其产生。机械半边 =
// `git merge --ff-only develop`（纯快进；⛔ 分叉即拒绝，不静默 merge）；分叉即 guard 报红（独立取值，
// ⛔ 非「同步成功」同形，硬规则 3b）。语义兜底（分叉后怎么融）归父任务 gap-doc-develop-sync-semantic-
// conflict-resolution 的 semanticSyncDocToDevelop。

/** doc 工作分支名（主检出所在；develop = 权威基线）。 */
export const DOC_BRANCH = "main/manager-doc";

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
export function docBranchForkedFromDevelop(root: string, docBranch: string = DOC_BRANCH): boolean | null {
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
 *  失败（not-ff / error）落痕到 DOC_DEVELOP_SYNC_EVENT_REL（⛔ 静默）。 */
export function syncDevelopToDoc(root: string, docBranch: string = DOC_BRANCH): string {
  const cur = currentBranchName(root);
  if (cur === null) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-ff-error", phase: "read-branch" });
    return "error";
  }
  if (cur !== docBranch) return "not-doc";
  const forked = docBranchForkedFromDevelop(root, docBranch);
  if (forked === null) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-ff-error", phase: "rev-count" });
    return "error";
  }
  if (forked) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-not-ff", phase: "forked", branch: cur });
    return "not-ff";
  }
  const behind = revCountAhead(root, docBranch, "develop");
  if (behind === null) {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-ff-error", phase: "rev-count" });
    return "error";
  }
  if (behind === 0) return "already";
  try {
    execFileSync("git", ["-C", root, "merge", "--ff-only", "develop"], { stdio: "ignore" });
    return "synced";
  } catch {
    writeDocDevelopSyncEvent(root, { event: "doc-develop-sync-ff-error", phase: "merge" });
    return "error";
  }
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

/** 该 task 最近一条 exited-not-landed 的失败原因（AC2「上次失败原因」，读 worker-outcome.jsonl）。
 *  无记录 / 读失败 ⇒ null（读不懂 ≠ 无失败——但续做 prompt 以 "(unknown)" 呈现，不伪装成「没有失败」）。 */
export function lastExitedNotLandedReason(root: string, taskId: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, WORKER_OUTCOME_REL), "utf8");
  } catch {
    return null;
  }
  let last: string | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: { task?: unknown; final_state?: unknown; failure_reason?: unknown; mechanical_fan_in?: unknown };
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (rec.task === taskId && rec.final_state === "exited-not-landed") {
      last = formatExitedNotLandedReason(rec.failure_reason, rec.mechanical_fan_in);
    }
  }
  return last;
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
  // gap-needs-human-note-carries-step-verdict：注记携带最近 exited-not-landed 的实际失败步+判词
  // （⛔ 只写模板句会把 merge 冲突 / suite 红 / ac-gate 未勾等完全不同真因压扁成同一句——读注记无法区分）。
  // 无记录 / 读不懂 ⇒ 不追加该行（与旧行为同形，⛔ 不伪造成「有失败步」）。
  const stepVerdict = lastExitedNotLandedReason(root, id);
  const record =
    `\n## Needs-Human\n\n**执行 ${new Date().toISOString()} — 连续修满重试上限仍不合格（标 needs-human）**\n\n` +
    `- 阻碍原因：${reason}\n` +
    (stepVerdict ? `- 失败步/判词：${stepVerdict}\n` : "");
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
    return status !== null && status !== TASK_STATUS.NEEDS_HUMAN;
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
