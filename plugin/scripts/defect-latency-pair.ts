#!/usr/bin/env node
/**
 * defect-latency-pair.ts — 给「缺陷发现延迟」一个分布，而不是轶事。
 *
 * ── 它回答什么问题 ────────────────────────────────────────────────────────────────
 * 「本项目一个缺陷，从**被引入**到**被立案**，典型延迟是多少？p90 多长？尾部是哪些？
 *   哪一类缺陷延迟最久？」
 *
 * CLAUDE.md 的硬规则（静默失败一族）与 `docs/references/维度边界与结晶.md` §2.1 ②
 * 把「静默失败」判为最危险形态，判据是 `频率 × 失败是否会自己发出声音`，并引三个
 * **个案**数字（workflow 周期失败静默 21.5 h、1b 收尾每 tick 静默 8.5 h、A5 巡检
 * 「看见但没发现」数十轮）。个案不是分布。本脚本把那个判据变成可量的量。
 *
 * `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §7 第 5 条把
 * 它列进「需要先补仪器」——**现无现成字段**，`.quay/*.jsonl` 诸载体没有任何一条记录
 * 携带「缺陷引入时刻」。故本脚本**不改任何载体**，而是从已有的事实——git 历史——里
 * 把配对算出来，并把口径的失真**计数公示**。
 *
 * ── 配对口径（一图）──────────────────────────────────────────────────────────────
 *   t1（立案时刻）  = `tasks/<id>.md` **首次进入 git** 的那次提交的 committer 时刻
 *   t0（引入时刻）  = 该任务的**修复提交**所改的**旧行**，经 `git blame` 上溯到的
 *                     引入提交时刻（取不超过 t1 的最晚候选）
 *   latencyHours    = (t1 − t0) / 3600
 *
 * ── 修复提交怎么机械定位（本口径的承重件）────────────────────────────────────────
 * 本仓库的落地形状给了它一个**机械**入口，⛔ 不需要读任务正文、不按关键词猜：
 *
 *   驱动 fan-in 落地一个任务时，develop 上会出现一对提交（实测稳定）：
 *     D = `tasks: 翻 <id> done（driver 机械 fan-in）`      ← 单亲，翻状态
 *     M = `Merge branch 'develop' into task/<id>`          ← 双亲，p1 含 D
 *   于是该任务的修复提交 = `git log --no-merges M^1 ^M^2`
 *   （= 只在任务分支上、不在 develop 上的那批提交；p2 侧把「任务分支中途 merge 进来的
 *     develop 历史」整批排除掉，所以不会混进别的任务的提交。）
 *
 * ⚠️ 这条口径**有覆盖率上限**，且上限被本脚本**计数公示**，⛔ 不靠挑样本绕开：
 *   未落地的 gap 任务没有 D；部分落地形状没有可用的 M（直接 ff / 只翻状态）。
 *   两类都落在 `confidence="unresolvable"` 并各带自己的 reason 计数（见 `--emit-json`）。
 *
 * ── 失真率（口径量不了什么）──────────────────────────────────────────────────────
 * 三类已知失真，全部**计数**，⛔ 一条都不吞：
 *   ① `blame-suspect-relocation` — blame 落在重构 / 格式化 / 批量搬移提交上（按提交
 *      主题与改动文件数机械判定），指向的不是引入提交。降 `low` 并计数。
 *   ② `candidates>1` — 一次修复改多行 ⇒ 多个候选 t0（降 `low`，取不超过 t1 的最晚候选）。
 *   ③ `no-landing-commit` / `no-code-fix-commit` / `no-old-line-hunks` / `blame-failed`
 *      / `all-candidates-after-filing` — 修复提交无法机械定位或 blame 上溯不到。全部 `unresolvable`。
 *
 * ── 硬规则（本脚本按它们实现，不是注释里的口号）──────────────────────────────────
 * · **3b/6（读不懂 ≠ 合格）**：解析不出 / 定位不到 ⇒ `confidence="unresolvable"`，
 *   ⛔ 绝不与 `high` 共用输出形状（AC1 的字面要求）。
 * · **4b（别用代理量）**：t0/t1 全部取自 **git 对象上的 committer 时刻**这一外部可核量，
 *   ⛔ 不读任务体里的日期文字、不读 `.quay/*.jsonl` 的自述。
 * · **5（来源完备性）**：`tasks/` 的清单取自 **`git ls-tree <ref> tasks/`**（=该 ref 上
 *   真实存在的那批），⛔ 不用工作树 glob —— 后者会让「ref 上没有」读成「不存在」。
 *
 * Usage:
 *   node --experimental-strip-types plugin/scripts/defect-latency-pair.ts [--root <dir>] [--ref develop]
 *   node --experimental-strip-types plugin/scripts/defect-latency-pair.ts --emit-json
 *   node --experimental-strip-types plugin/scripts/defect-latency-pair.ts --sample 10 --seed 20260914
 *
 * 退出码：0 = 报出（含 unresolvable 段）；2 = 用法 / 环境错误（不是 git 根、ref 读不到）。
 */
import path from "node:path";
import { spawnSync } from "node:child_process";

// ── 取值词表：三态，⛔ 「读不出来」不得与「高置信」共用取值（硬规则 3b）──────────
export type Confidence = "high" | "low" | "unresolvable";

/** 缺陷类型。`unclassified` 是一个**独立取值**，⛔ 不是「其它」的兜底同义（硬规则 3b）。 */
export type DefectType = "silent-failure" | "loud-failure" | "performance" | "doc-drift" | "unclassified";

export interface PairRecord {
  taskId: string;
  /** 缺陷引入时刻（ISO-8601，committer 时刻）。`unresolvable` 时为 null。 */
  t0: string | null;
  /** 立案时刻（ISO-8601，committer 时刻）。 */
  t1: string | null;
  /** (t1 − t0) / 3600。`unresolvable` 时为 null。 */
  latencyHours: number | null;
  /** 这个 t0 是怎么来的：`blame:<shape>` 或 `unresolvable:<reason>`。 */
  t0Method: string;
  confidence: Confidence;
  // ── 可核字段（AC3 的人工抽样复核就核这几个）────────────────────────────────
  t0Commit: string | null;
  t1Commit: string | null;
  landingCommit: string | null;
  fixCommit: string | null;
  /** blame 上溯命中的不同提交数（>1 ⇒ 口径失真 ②，降 low）。 */
  t0CandidateCommits: number;
  /** 候选中时刻晚于 t1 的条数（被丢弃；>0 ⇒ 口径失真 ② 的镜像半边）。 */
  candidatesAfterFiling: number;
  defectType: DefectType;
  /** 该任务是否有可用的 `Merge branch 'develop' into task/<id>` 落地提交。 */
  landingShape: "merge" | "done-only" | "none";
}

export interface Distribution {
  n: number;
  min: number | null;
  median: number | null;
  p90: number | null;
  max: number | null;
  mean: number | null;
}

export interface GroupReport {
  defectType: DefectType;
  n: number;
  distribution: Distribution;
  /** AC4：样本 <5 时必须标注「样本不足，不下结论」，⛔ 不照样给中位当结论。 */
  conclusionSuppressed: boolean;
}

export interface Report {
  generatedAt: string;
  ref: string;
  /** 该 ref 的 tip（**可复跑锚点**，AC：他人用同一命令行复现同一批配对）。 */
  refTip: string;
  /** 分母：尝试配对的 gap 任务总数（=参与运算的全部，⛔ 不是「成功那批」）。 */
  denominator: number;
  /** 可核配对（confidence != unresolvable）。 */
  verifiablePairs: number;
  /** 失真率 = unresolvable / denominator。 */
  unresolvableRate: number;
  unresolvableByReason: Record<string, number>;
  distribution: Distribution;
  tail: PairRecord[];
  byDefectType: GroupReport[];
  pairs: PairRecord[];
}

export const NOT_EVALUATED = "NOT-EVALUATED" as const;

// ── git 壳 ────────────────────────────────────────────────────────────────────
export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function git(root: string, args: string[]): GitResult {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { code: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** 单次 git 调用，非零退出抛错（调用点据此把该任务记为 unresolvable，⛔ 不静默取空）。 */
function gitOrThrow(root: string, args: string[]): string {
  const r = git(root, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} → exit ${r.code}: ${r.stderr.trim().slice(0, 200)}`);
  return r.stdout;
}

// ── 解析：`git log --name-only` 的提交块 ──────────────────────────────────────
export interface CommitWithFiles {
  sha: string;
  committerIso: string;
  subject: string;
  files: string[];
}

/**
 * 解析 `git log --no-merges --name-only --format=%x02%H%x01%cI%x01%s` 的输出。
 * 每个提交以 `\x02` 起头，随后一行元数据，再若干文件名行。
 */
export function parseNameOnlyLog(text: string): CommitWithFiles[] {
  const out: CommitWithFiles[] = [];
  let cur: CommitWithFiles | null = null;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("\x02")) {
      const [sha, iso, subject] = raw.slice(1).split("\x01");
      cur = { sha, committerIso: iso, subject: subject ?? "", files: [] };
      out.push(cur);
      continue;
    }
    if (cur === null) continue;
    const f = raw.trim();
    if (f) cur.files.push(f);
  }
  return out;
}

// ── 解析：`git diff --unified=0` 的 hunk 头 ───────────────────────────────────
export interface OldRange {
  file: string;
  /** 旧侧起始行（1-based）。 */
  start: number;
  /** 旧侧行数；0 = 纯插入（⛔ 没有「旧行」可上溯，不进候选）。 */
  count: number;
}

/**
 * 解析带 `--unified=0` 的 diff，返回**旧侧**被改动的行区间。
 * 纯插入（count=0）被保留在输出里（调用方据此报 `no-old-line-hunks`），
 * 但**不产生 t0 候选** —— 「这次修复凭空加了行」不对应任何引入时刻。
 */
export function parseDiffHunks(text: string): OldRange[] {
  const out: OldRange[] = [];
  let file: string | null = null;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).trim();
      file = p === "/dev/null" ? null : p.replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("diff --git ") || raw.startsWith("index ") || raw.startsWith("@@@")) continue;
    if (raw.startsWith("@@")) {
      if (!file) continue;
      const m = /^@@ -(\d+)(?:,(\d+))? \+/.exec(raw);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      out.push({ file, start, count });
    }
  }
  return out;
}

/** 解析 `git blame --line-porcelain` 的头行，返回命中的提交 SHA 多重集（保留重复 = 行数权重）。 */
export function parseBlamePorcelain(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const m = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/.exec(raw);
    if (m) out.push(m[1]);
  }
  return out;
}

// ── 缺陷类型分类（AC4 的分组）────────────────────────────────────────────────
// ⚠️ 这是**对任务正文的关键词分类**，是本脚本唯一一处「按关键词」的判定（硬规则 2 的
// 例外，且必须声明）：缺陷类型只写在散文里，没有结构化字段可读。
// 判法是**可复算的计数**而非「有/无」：对每类数它的命中**次数**，取命中最多的一类；
// 全零 ⇒ `unclassified`（独立取值，⛔ 不被塞进任何一类）。
const DEFECT_MARKERS: ReadonlyArray<readonly [DefectType, readonly RegExp[]]> = [
  [
    "silent-failure",
    [
      /静默/g, /无声/g, /不发出声音/g, /恒绿/g, /假绿/g, /看不见/g, /视而不见/g, /无信号/g,
      /吞掉/g, /不报错/g, /没有报/g, /没报/g, /silent/gi, /swallow/gi, /常量真|恒真|恒零/g,
      /伪装成/g, /同形/g,
    ],
  ],
  [
    "loud-failure",
    [
      /崩溃/g, /报错/g, /抛错/g, /异常退出/g, /crash/gi, /throw/gi, /非零退出/g, /失败退出/g,
      /红色|变红|红窗/g, /flaky/gi, /OOM/gi,
    ],
  ],
  [
    "performance",
    [
      /性能/g, /耗时/g, /延迟/g, /吞吐/g, /慢/g, /超时/g, /排队/g, /并发/g,
      /latency/gi, /perf(?:ormance)?/gi, /O\([^)]*\)/g,
    ],
  ],
  [
    "doc-drift",
    [
      /文档/g, /漂移/g, /过期/g, /陈旧/g, /正本/g, /指令/g,
      /README/g, /CLAUDE\.md/g, /注释/g, /doc(?:s|umentation)?/gi,
    ],
  ],
];

/** 命中次数最多的一类；全零 ⇒ `unclassified`。平票按 DEFECT_MARKERS 的顺序（静默 > 报错 > 性能 > 文档）。 */
export function classifyDefectType(body: string): { type: DefectType; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  let best: DefectType = "unclassified";
  let bestN = 0;
  for (const [name, pats] of DEFECT_MARKERS) {
    let n = 0;
    for (const p of pats) {
      const m = body.match(p);
      if (m) n += m.length;
    }
    counts[name] = n;
    if (n > bestN) {
      bestN = n;
      best = name;
    }
  }
  return { type: best, counts };
}

// ── 统计 ──────────────────────────────────────────────────────────────────────
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[i];
}

export function dist(xs: number[]): Distribution {
  if (xs.length === 0) return { n: 0, min: null, median: null, p90: null, max: null, mean: null };
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    median: percentile(s, 0.5),
    p90: percentile(s, 0.9),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

/** mulberry32 — 确定性 PRNG，让「随机取 10 条」可被他人用同一个 seed 复现（AC3）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从 `pool` 里确定性取 `n` 条（先按 taskId 排序，再 Fisher–Yates with seeded PRNG）。 */
export function sampleDeterministic<T extends { taskId: string }>(pool: T[], n: number, seed: number): T[] {
  const a = [...pool].sort((x, y) => (x.taskId < y.taskId ? -1 : x.taskId > y.taskId ? 1 : 0));
  const rnd = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

// ── 修复提交定位 ─────────────────────────────────────────────────────────────
const LANDING_MERGE_PREFIX = "Merge branch 'develop' into task/";

/** 翻 done 提交的两种实测主题形（drivers 两个时代的写法）。⛔ 只认主题，不认正文关键词。 */
export const DONE_SUBJECT = /^tasks: (?:翻 )?(\S+?)(?: flip)? done（/;

export interface LandingCommit {
  sha: string;
  parents: string[];
  iso: string;
}

export interface LandingIndex {
  /** taskId → 该任务的 `Merge branch 'develop' into task/<id>` 提交。 */
  merges: Map<string, LandingCommit[]>;
  /** taskId → 该任务的 `tasks: … done（…）` 提交。 */
  done: Map<string, LandingCommit[]>;
}

/** 一次 `git log` 建索引：落地提交与翻 done 提交。⛔ 不逐任务起子进程。 */
export function buildLandingIndex(root: string, ref: string): LandingIndex {
  const out = gitOrThrow(root, ["log", ref, "--format=%H%x01%P%x01%cI%x01%s"]);
  const merges = new Map<string, LandingCommit[]>();
  const done = new Map<string, LandingCommit[]>();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [sha, parents, iso, subject = ""] = line.split("\x01");
    const entry: LandingCommit = { sha, parents: parents.trim() ? parents.trim().split(" ") : [], iso };
    if (subject.startsWith(LANDING_MERGE_PREFIX)) {
      const id = subject.slice(LANDING_MERGE_PREFIX.length).trim();
      if (!merges.has(id)) merges.set(id, []);
      merges.get(id)!.push(entry);
    } else {
      const m = DONE_SUBJECT.exec(subject);
      if (m && m[1] !== "翻") {
        if (!done.has(m[1])) done.set(m[1], []);
        done.get(m[1])!.push(entry);
      }
    }
  }
  return { merges, done };
}

/** 该 ref 上真实存在的 gap 任务 id 清单（硬规则 5：清单取自 git，⛔ 不用工作树 glob）。 */
export function listGapTaskIds(root: string, ref: string): string[] {
  const out = gitOrThrow(root, ["ls-tree", "-r", "--name-only", ref, "tasks/"]);
  const ids: string[] = [];
  for (const p of out.split("\n")) {
    const b = p.trim().split("/").pop() ?? "";
    if (b.startsWith("gap-") && b.endsWith(".md")) ids.push(b.slice(0, -3));
  }
  return ids;
}

/** `tasks/<id>.md` **首次进入 git** 的提交（=立案提交）。返回 null ⇒ 无立案提交。 */
export function buildFilingIndex(root: string, ref: string): Map<string, { sha: string; iso: string }> {
  const out = gitOrThrow(root, ["log", ref, "--diff-filter=A", "--format=%H%x01%cI", "--name-only", "--", "tasks/gap-*.md"]);
  const map = new Map<string, { sha: string; iso: string }>();
  let cur: { sha: string; iso: string } | null = null;
  for (const raw of out.split("\n")) {
    if (raw.includes("\x01")) {
      const [sha, iso] = raw.split("\x01");
      cur = { sha, iso };
      continue;
    }
    const f = raw.trim();
    if (!cur || !f.startsWith("tasks/")) continue;
    const b = f.slice("tasks/".length);
    if (!b.startsWith("gap-") || !b.endsWith(".md")) continue;
    // `git log` 默认倒序 ⇒ 后出现的才是更早的「首次加入」。
    map.set(b.slice(0, -3), cur);
  }
  return map;
}

// ── 机械定位「修复提交」──────────────────────────────────────────────────────
export interface FixCommit {
  sha: string;
  iso: string;
}

/**
 * 该任务的修复提交 = `git log --no-merges <M>^1 ^<M>^2`。
 * ⛔ 返回 null（而非空数组）当落地形状不可机械解析 —— 调用方据此落 `unresolvable`。
 */
export function findFixCommits(root: string, tip: string, base: string, id: string): FixCommit[] | null {
  const out = git(root, ["log", "--no-merges", "--name-only", "--format=%x02%H%x01%cI%x01%s", tip, `^${base}`]);
  if (out.code !== 0) return null;
  const commits = parseNameOnlyLog(out.stdout);
  const res: FixCommit[] = [];
  for (const c of commits) {
    // ⛔ 只翻任务状态的 bookkeeping 提交（`tasks: 翻 <id> done` / `task_write by cli:`）不是修复提交。
    if (/^tasks: 翻 /.test(c.subject) || /task_write by cli:/.test(c.subject)) continue;
    if (!c.files.some((f) => !f.startsWith("tasks/"))) continue;
    res.push({ sha: c.sha, iso: c.committerIso });
  }
  return res;
}

/** 该任务是否已经有可用的落地 merge（用来报 `landingShape`，把失真分类说清楚）。 */
export function landingShapeOf(idx: LandingIndex, id: string): "merge" | "done-only" | "none" {
  if (idx.merges.has(id)) return "merge";
  if (idx.done.has(id)) return "done-only";
  return "none";
}

// ── blame 上溯 ───────────────────────────────────────────────────────────────
const SKIP_FILE = /^(tasks\/|\.quay\/|node_modules\/|plugin\/vendor\/|packages\/[^/]+\/dist\/)/;
const BULK_FILE = /^(package-lock\.json|\.gitignore)$/;
/** 测试文件：blame 它们得到的是**测试**的引入时刻，不是缺陷的。⛔ 优先用非测试文件。 */
const TEST_FILE = /(^|\/)test\/|\.test\.[cm]?[jt]s$|\.spec\.[cm]?[jt]s$/;

function worthBlamin(p: string): boolean {
  if (!p || SKIP_FILE.test(p)) return false;
  if (BULK_FILE.test(p)) return false;
  if (/\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip|gz|wasm)$/i.test(p)) return false;
  return true;
}

/**
 * 机械判定「这个提交像是重构 / 格式化 / 批量搬移」——blame 落在它上面时 t0 不可信
 * （口径失真 ①，AC5 要求单列并计数）。判据两条，都可当场复算：
 *   · 改动文件数 ≥ 25（批量）；或
 *   · 主题含重构/搬移词表（实测：一次 13 文件的服务端按关切拆分把 6 条配对的 t0
 *     全顶到拆分提交上 —— 故「拆分/收敛/重组」这一族必须进词表，只收 refactor/rename 不够）。
 */
export function looksLikeRelocation(subject: string, fileCount: number): boolean {
  if (fileCount >= 25) return true;
  return (
    /^\s*(?:refactor|refactoring|rename|renaming|move|moving|format|formatting|style|chore\(format\)|reformat|restructure|reorganize|split|extract|migrate|relocate)(?![a-z])/i.test(subject) ||
    /(重构|重命名|搬移|搬家|格式化|改名|拆分|拆出|收敛为|重组|归并|迁移)/.test(subject)
  );
}

export interface BlameCandidate {
  sha: string;
  iso: string;
}

/**
 * 对一次修复提交的**旧行**做 blame 上溯，返回候选引入提交（去重，按时刻升序）。
 * ⛔ 空数组 = 上溯不到（调用方落 unresolvable），⛔ 不是「t0 = 修复时刻」。
 */
export function blameOldLines(
  root: string,
  fixSha: string,
  ranges: OldRange[],
  opts: { maxFiles?: number; maxLines?: number } = {},
): { candidates: BlameCandidate[]; lines: number; blamedFiles: number; anyNonTest: boolean; error: string | null } {
  const maxFiles = opts.maxFiles ?? 12;
  const maxLines = opts.maxLines ?? 400;
  const byFile = new Map<string, OldRange[]>();
  for (const r of ranges) {
    if (r.count <= 0) continue;
    if (!worthBlamin(r.file)) continue;
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file)!.push(r);
  }
  // 非测试文件优先（blame 测试文件得到的是测试的引入时刻）。
  const files = [...byFile.keys()].sort((a, b) => Number(TEST_FILE.test(a)) - Number(TEST_FILE.test(b))).slice(0, maxFiles);
  const shas = new Set<string>();
  let lines = 0;
  let anyNonTest = false;
  for (const f of files) {
    const rs = byFile.get(f)!;
    const args = ["blame", "--line-porcelain"];
    let budget = 0;
    for (const r of rs) {
      if (budget >= maxLines) break;
      const take = Math.min(r.count, maxLines - budget);
      args.push("-L", `${r.start},+${take}`);
      budget += take;
    }
    if (budget === 0) continue;
    args.push(`${fixSha}^`, "--", f);
    const r = git(root, args);
    if (r.code !== 0) continue; // 该文件读不到：跳过，但由「候选是否为空」整体体现
    const got = parseBlamePorcelain(r.stdout);
    if (got.length === 0) continue;
    if (!TEST_FILE.test(f)) anyNonTest = true;
    for (const s of got) shas.add(s);
    lines += got.length;
  }
  if (shas.size === 0) return { candidates: [], lines, blamedFiles: 0, anyNonTest: false, error: null };
  // 一次性批量取 committer 时刻（⛔ 不逐 sha 起子进程）。
  const list = [...shas];
  const iso = new Map<string, string>();
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const out = git(root, ["log", "--no-walk=unsorted", "--format=%H%x01%cI", ...chunk]);
    if (out.code !== 0) return { candidates: [], lines, blamedFiles: files.length, anyNonTest, error: "commit-time-read-failed" };
    for (const l of out.stdout.split("\n")) {
      if (!l.includes("\x01")) continue;
      const [sha, ciso] = l.split("\x01");
      iso.set(sha, ciso);
    }
  }
  const cands: BlameCandidate[] = [];
  for (const s of list) {
    const c = iso.get(s);
    if (!c) return { candidates: [], lines, blamedFiles: files.length, anyNonTest, error: "commit-time-missing" };
    cands.push({ sha: s, iso: c });
  }
  cands.sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso) || (a.sha < b.sha ? -1 : 1));
  return { candidates: cands, lines, blamedFiles: files.length, anyNonTest, error: null };
}

// ── 单任务配对 ───────────────────────────────────────────────────────────────
export interface PairDeps {
  root: string;
  idx: LandingIndex;
  filing: Map<string, { sha: string; iso: string }>;
  bodyOf: (id: string) => string;
}

/** 一个 gap 任务的完整配对。⛔ 任何「读不出来」都落在 confidence="unresolvable" 上。 */
export function pairOne(id: string, deps: PairDeps): PairRecord {
  const { idx, filing } = deps;
  const shape = landingShapeOf(idx, id);
  const filed = filing.get(id);
  const body = deps.bodyOf(id);
  const defectType = classifyDefectType(body).type;

  const base: PairRecord = {
    taskId: id,
    t0: null,
    t1: filed ? filed.iso : null,
    latencyHours: null,
    t0Method: "unresolvable:no-filing-commit",
    confidence: "unresolvable",
    t0Commit: null,
    t1Commit: filed ? filed.sha : null,
    landingCommit: null,
    fixCommit: null,
    t0CandidateCommits: 0,
    candidatesAfterFiling: 0,
    defectType,
    landingShape: shape,
  };
  if (!filed) return base;

  const merges = idx.merges.get(id) ?? [];
  // 选落地 merge：其 p1 的祖先里含本任务的 `翻 done` 提交。取最早的一个
  // （更晚的 merge 只会多带一次 develop 合并，修复提交集合同样含在内）。
  const doneShas = new Set((idx.done.get(id) ?? []).map((d) => d.sha));
  const mergeBySha = new Map(merges.map((m) => [m.sha, m]));

  // 落地形状有两个实测变体，都要收（本仓库驱动演化的两个时代）：
  //   ① D 在 M 的 p1 上（`git log` 见 D 紧跟 M 之前）—— 任务分支里翻完 done 再 merge develop。
  //   ② M 在前、D 在后且 **D 的父提交就是这个 M**（翻 done 直接落在 merge 提交之后）。
  // 两者给出同一件事：(tip, base) —— 从任务落地尖到分叉点的提交区间。
  interface Cand { tip: string; base: string; iso: string; kind: string }
  const cands: Cand[] = [];
  for (const m of merges) {
    if (m.parents.length < 2) continue;
    cands.push({ tip: m.parents[0], base: m.parents[1], iso: m.iso, kind: "merge-p1" });
  }
  for (const d of idx.done.get(id) ?? []) {
    const p = d.parents[0];
    const pm = p ? mergeBySha.get(p) : undefined;
    if (pm && pm.parents.length >= 2) cands.push({ tip: d.sha, base: pm.parents[1], iso: d.iso, kind: "done-after-merge" });
  }
  // 慢路径：p1 是任务分支的其它提交（不含 done 本身），但祖先里含 done。
  if (cands.length === 0 || !cands.some((c) => c.tip === c.base || doneShas.has(c.tip))) {
    for (const m of merges.slice(0, 4)) {
      if (m.parents.length < 2) continue;
      const reach = git(deps.root, ["rev-list", "--max-count=3000", m.parents[0]]);
      if (reach.code !== 0) continue;
      if (reach.stdout.split("\n").some((s) => doneShas.has(s.trim()))) {
        cands.push({ tip: m.parents[0], base: m.parents[1], iso: m.iso, kind: "merge-p1-contains-done" });
        break;
      }
    }
  }
  // 取**最新**的候选（尖最远 ⇒ 修复提交集合最完整）。时刻相同则按 kind 稳定排序。
  cands.sort((a, b) => Date.parse(b.iso) - Date.parse(a.iso) || (a.tip < b.tip ? -1 : 1));
  if (cands.length === 0) {
    base.t0Method = `unresolvable:${shape === "none" ? "no-landing-commit" : "no-landing-merge-with-done"}`;
    return base;
  }

  let fixes: FixCommit[] | null = null;
  for (const c of cands) {
    const f = findFixCommits(deps.root, c.tip, c.base, id);
    if (f && f.length > 0) {
      fixes = f;
      base.landingCommit = c.tip;
      break;
    }
    if (base.landingCommit === null) base.landingCommit = c.tip;
  }
  if (!fixes || fixes.length === 0) {
    base.t0Method = "unresolvable:no-code-fix-commit";
    return base;
  }
  // 取**最早**的修复提交（第一条改动代码的提交）：缺陷的旧行最可能还在它的 diff 里。
  fixes.sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso) || (a.sha < b.sha ? -1 : 1));

  let sawHunks = false;
  for (const f of fixes) {
    const diff = git(deps.root, ["diff", "--unified=0", "--no-color", "--no-renames", "--text", `${f.sha}^`, f.sha, "--", "."]);
    if (diff.code !== 0) continue;
    const ranges = parseDiffHunks(diff.stdout);
    const usable = ranges.filter((r) => r.count > 0 && worthBlamin(r.file));
    if (usable.length === 0) continue;
    sawHunks = true;
    const bl = blameOldLines(deps.root, f.sha, usable);
    if (bl.error) {
      base.t0Method = `unresolvable:${bl.error}`;
      base.fixCommit = f.sha;
      return base;
    }
    if (bl.candidates.length === 0) continue;

    base.fixCommit = f.sha;
    const t1ms = Date.parse(filed.iso);
    const within = bl.candidates.filter((c) => Date.parse(c.iso) <= t1ms);
    base.t0CandidateCommits = bl.candidates.length;
    base.candidatesAfterFiling = bl.candidates.length - within.length;
    if (within.length === 0) {
      base.t0Method = "unresolvable:all-candidates-after-filing";
      return base;
    }
    // t0 = 不超过 t1 的**最晚**候选（该缺陷行最后一次成形的时刻）。
    const t0 = within[within.length - 1];
    base.t0 = t0.iso;
    base.t0Commit = t0.sha;
    base.latencyHours = (t1ms - Date.parse(t0.iso)) / 3_600_000;

    // ── confidence（AC1 的三取值）──────────────────────────────────────────
    // 判定顺序即优先级：**先报最不可信的那一条**（⛔ 不因为别处看起来干净就抬成 high）。
    const reloc = looksLikeRelocation(subjectOf(deps.root, t0.sha), fileCountOf(deps.root, t0.sha));
    const isMerge = parentsOf(deps.root, t0.sha).length >= 2;
    if (bl.candidates.length > 1) {
      base.confidence = "low";
      base.t0Method = `blame:latest-of-${bl.candidates.length}`;
    } else if (reloc) {
      base.confidence = "low";
      base.t0Method = "blame:suspect-relocation";
    } else if (isMerge) {
      // blame 落在 merge 提交上 ⇒ 该行是**合并决议**（含冲突消解）带进来的，
      // 引入提交在合并进去的那条分支里，本口径到此为止（实测：一条 1.4 h 的配对栽在这里）。
      base.confidence = "low";
      base.t0Method = "blame:suspect-merge-attribution";
    } else if (t0.sha === filed.sha) {
      // t0 就是立案提交本身 ⇒ t1 同时是「引入」与「立案」，t1 不是干净的立案时刻。
      base.confidence = "low";
      base.t0Method = "blame:same-as-filing";
    } else if (!bl.anyNonTest) {
      base.confidence = "low";
      base.t0Method = "blame:test-file-only";
    } else {
      base.confidence = "high";
      base.t0Method = "blame:single-commit";
    }
    return base;
  }
  base.t0Method = sawHunks ? "unresolvable:blame-yielded-no-candidate" : "unresolvable:no-old-line-hunks";
  return base;
}

// 这两个查询各自只对「即将成为 t0 的那几个提交」发起，缓存住避免重复。
const subjectCache = new Map<string, string>();
const fileCountCache = new Map<string, number>();
const parentsCache = new Map<string, string[]>();
function parentsOf(root: string, sha: string): string[] {
  const k = `${root}\x01${sha}`;
  if (!parentsCache.has(k)) {
    const r = git(root, ["log", "-1", "--format=%P", sha]);
    parentsCache.set(k, r.code === 0 && r.stdout.trim() ? r.stdout.trim().split(" ") : []);
  }
  return parentsCache.get(k)!;
}
function subjectOf(root: string, sha: string): string {
  const k = `${root}\x01${sha}`;
  if (!subjectCache.has(k)) {
    const r = git(root, ["log", "-1", "--format=%s", sha]);
    subjectCache.set(k, r.code === 0 ? r.stdout.trim() : "");
  }
  return subjectCache.get(k)!;
}
function fileCountOf(root: string, sha: string): number {
  const k = `${root}\x01${sha}`;
  if (!fileCountCache.has(k)) {
    const r = git(root, ["show", "--pretty=", "--name-only", sha]);
    fileCountCache.set(k, r.code === 0 ? r.stdout.split("\n").filter((s) => s.trim()).length : 0);
  }
  return fileCountCache.get(k)!;
}

// ── ref 上的任务正文（分类用；单次 cat-file --batch，⛔ 不逐任务起子进程）───────
export function readTaskBodies(root: string, ref: string, ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const tree = gitOrThrow(root, ["ls-tree", "-r", ref, "tasks/"]);
  const oid = new Map<string, string>();
  for (const l of tree.split("\n")) {
    const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(l);
    if (!m) continue;
    const b = m[2].split("/").pop() ?? "";
    if (b.startsWith("gap-") && b.endsWith(".md")) oid.set(b.slice(0, -3), m[1]);
  }
  const wanted = ids.filter((i) => oid.has(i));
  const r = spawnSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: wanted.map((i) => oid.get(i)!).join("\n") + "\n",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  const buf: Buffer = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout ?? "");
  // `<oid> blob <size>\n<size 字节正文>\n` 逐条消费 —— ⛔ 不按行切（正文自身含 \n，
  // 按行切会把「正文里的空行」读成下一条的头部，硬规则 2「按位置不按关键词」的同族错误）。
  let pos = 0;
  for (const id of wanted) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const hdr = /^([0-9a-f]{40}) blob (\d+)$/.exec(buf.subarray(pos, nl).toString("utf8"));
    if (!hdr) break;
    const size = Number(hdr[2]);
    const start = nl + 1;
    out.set(id, buf.subarray(start, start + size).toString("utf8"));
    pos = start + size + 1; // 跳过正文后的分隔换行
  }
  return out;
}

// ── 报告 ─────────────────────────────────────────────────────────────────────
export interface BuildOpts {
  ref?: string;
  /** 只算匹配该子串的任务（调试用；⛔ 不得用来出报告读数）。 */
  only?: string;
}

export function buildReport(root: string, opts: BuildOpts = {}): Report {
  const ref = opts.ref ?? "develop";
  const tip = gitOrThrow(root, ["rev-parse", ref]).trim();
  let ids = listGapTaskIds(root, ref);
  if (opts.only) ids = ids.filter((i) => i.includes(opts.only!));

  const idx = buildLandingIndex(root, ref);
  const filing = buildFilingIndex(root, ref);
  const bodies = readTaskBodies(root, ref, ids);

  const pairs: PairRecord[] = ids.map((id) => pairOne(id, { root, idx, filing, bodyOf: (i) => bodies.get(i) ?? "" }));

  const verifiable = pairs.filter((p) => p.confidence !== "unresolvable");
  const latencies = verifiable.map((p) => p.latencyHours!).filter((x) => Number.isFinite(x));
  const unresolvableByReason: Record<string, number> = {};
  for (const p of pairs) {
    if (p.confidence !== "unresolvable") continue;
    const reason = p.t0Method.replace(/^unresolvable:/, "");
    unresolvableByReason[reason] = (unresolvableByReason[reason] ?? 0) + 1;
  }
  const types: DefectType[] = ["silent-failure", "loud-failure", "performance", "doc-drift", "unclassified"];
  const byDefectType: GroupReport[] = types.map((t) => {
    const sub = verifiable.filter((p) => p.defectType === t);
    return {
      defectType: t,
      n: sub.length,
      distribution: dist(sub.map((p) => p.latencyHours!)),
      // AC4：样本 <5 ⇒ 标注「样本不足，不下结论」，⛔ 不照样给中位当结论。
      conclusionSuppressed: sub.length < 5,
    };
  });
  const tail = [...verifiable].sort((a, b) => b.latencyHours! - a.latencyHours!).slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    ref,
    refTip: tip,
    denominator: ids.length,
    verifiablePairs: verifiable.length,
    unresolvableRate: ids.length ? pairs.filter((p) => p.confidence === "unresolvable").length / ids.length : 0,
    unresolvableByReason,
    distribution: dist(latencies),
    tail,
    byDefectType,
    pairs,
  };
}

// ── 渲染 ─────────────────────────────────────────────────────────────────────
function fmtH(v: number | null): string {
  return v === null ? String(NOT_EVALUATED) : v.toFixed(1);
}

export function renderHuman(r: Report): string {
  const L: string[] = [];
  L.push("缺陷发现延迟分布 — 从「被引入」到「被立案」");
  L.push("");
  L.push(`ref=${r.ref} tip=${r.refTip.slice(0, 12)}  generatedAt=${r.generatedAt}`);
  L.push("");
  // AC2：分母与失真率必须与读数同在 stdout 上。
  L.push(`分母（尝试配对的 gap 任务总数）= ${r.denominator}`);
  L.push(`可核配对（confidence != unresolvable）= ${r.verifiablePairs}`);
  L.push(`失真率 unresolvable / 总数 = ${r.unresolvableRate.toFixed(4)}（${(r.unresolvableRate * 100).toFixed(1)}%）`);
  L.push("");
  L.push(`延迟分布（小时）：n=${r.distribution.n} min=${fmtH(r.distribution.min)} median=${fmtH(r.distribution.median)} p90=${fmtH(r.distribution.p90)} max=${fmtH(r.distribution.max)} mean=${fmtH(r.distribution.mean)}`);
  L.push("");
  L.push("尾部（最长 10 条）：");
  for (const t of r.tail) L.push(`  ${fmtH(t.latencyHours).padStart(9)} h  ${t.taskId}  (${t.confidence})`);
  L.push("");
  L.push("按缺陷类型分组：");
  for (const g of r.byDefectType) {
    const d = g.distribution;
    const note = g.conclusionSuppressed ? "  ⚠️ 样本不足，不下结论" : "";
    L.push(`  ${g.defectType.padEnd(16)} n=${String(g.n).padStart(4)} median=${fmtH(d.median)} p90=${fmtH(d.p90)} max=${fmtH(d.max)}${note}`);
  }
  L.push("");
  L.push("unresolvable 成因分类（口径量不了什么）：");
  const reasons = Object.entries(r.unresolvableByReason).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of reasons) L.push(`  ${String(v).padStart(5)}  ${k}`);
  if (reasons.length === 0) L.push("  （none）");
  L.push("");
  L.push("⛔ 「unresolvable」与「high」不同形：前者是没量到，后者是量到了（硬规则 3b）。");
  return L.join("\n");
}

export function renderSample(rows: PairRecord[], seed: number, pool: number): string {
  const L: string[] = [];
  L.push(`抽样复核（seed=${seed}，池 = confidence=="high" 的 ${pool} 条）`);
  for (const r of rows) {
    L.push(`${r.taskId}\tt0=${r.t0}\tt0sha=${r.t0Commit}\tt1=${r.t1}\tt1sha=${r.t1Commit}\tlatencyHours=${r.latencyHours === null ? "null" : r.latencyHours.toFixed(2)}\tfix=${r.fixCommit}`);
  }
  return L.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────
interface Args {
  root: string;
  ref: string;
  emitJson: boolean;
  sample: number | null;
  seed: number;
  only: string | null;
}

export function parseArgs(argv: string[]): Args | { error: string } {
  const a: Args = { root: process.cwd(), ref: "develop", emitJson: false, sample: null, seed: 20260914, only: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--root") a.root = argv[++i];
    else if (t === "--ref") a.ref = argv[++i];
    else if (t === "--emit-json" || t === "--json") a.emitJson = true;
    else if (t === "--sample") a.sample = Number(argv[++i]);
    else if (t === "--seed") a.seed = Number(argv[++i]);
    else if (t === "--only") a.only = argv[++i];
    else return { error: `unknown flag: ${t}` };
  }
  if (a.sample !== null && !Number.isFinite(a.sample)) return { error: "--sample needs a number" };
  if (!Number.isFinite(a.seed)) return { error: "--seed needs a number" };
  return a;
}

function main(argv: string[]): number {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n`);
    return 2;
  }
  const { root, ref, emitJson, sample, seed, only } = parsed;
  const isRepo = git(root, ["rev-parse", "--git-dir"]);
  if (isRepo.code !== 0) {
    process.stderr.write(`not a git repository: ${root}\n`);
    return 2;
  }
  const hasRef = git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (hasRef.code !== 0) {
    process.stderr.write(`ref not found: ${ref}\n`);
    return 2;
  }
  const report = buildReport(root, { ref, ...(only ? { only } : {}) });
  if (sample !== null) {
    const pool = report.pairs.filter((p) => p.confidence === "high");
    const rows = sampleDeterministic(pool, sample, seed);
    if (emitJson) process.stdout.write(JSON.stringify({ seed, poolSize: pool.length, rows }, null, 2) + "\n");
    else process.stdout.write(renderSample(rows, seed, pool.length) + "\n");
    return 0;
  }
  if (emitJson) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stdout.write(renderHuman(report) + "\n");
  return 0;
}

const isDirect = process.argv[1] != null && /defect-latency-pair\.(ts|js)$/.test(process.argv[1]);
if (isDirect) {
  process.exitCode = main(process.argv.slice(2));
}
