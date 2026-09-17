#!/usr/bin/env node
// dev-stats-collect.ts — README 开发过程统计的**机械产出面** (GOAL-021 / AC-277,
// tasks/gap-dev-stats-collect-from-production-carriers).
//
// ── 它回答什么问题 ────────────────────────────────────────────────────────────────────
// README 里那段「开发过程统计」的数字，**是脚本算出来的，还是有人手填的**？本文件是那段数字的
// 唯一产出面：`--write` 生成，`--check` 判漂移，AC-277 的 criterion 逐字读同一个块。
//
// ── 三条形态约束（都是判据的逐字语义决定的，缺一即恒红）──────────────────────────────
// ① **输出扁平标量 JSON**：`--json` 的 stdout 是一个对象，每个顶层值都是 int 或 string。
//    判据的判定是 `missing = [k for k, v in fresh.items() if str(v) not in embedded_text]` ——
//    若某个值是 list/dict，Python 的 `str(v)` 是带单引号的 repr（`{'a': 1}` 形），几乎不可能在
//    README 里逐字出现 ⇒ 该键**恒进 missing** ⇒ 判据结构性不可满足。
// ② **每个值都能在 README 的 `<!-- dev-stats:start/end -->` 块文本里逐字找到**（子串）。
// ③ **`--write` 是唯一写面**，人不得手填数字；`--check` 是它的只读判定。
//
// ── 为什么输出是「钉在一个提交上的快照」而不是「当前时刻的读数」──────────────────────
// 这是本文件最重要的一条设计决定，理由是**判据能不能取两个值**：
//   README.md 是**被 git 跟踪**的文件，判据（AC-277）每次评估都会**重新计算**这些量并比对块内值。
//   若这些量是「当前时刻」的（如 `git rev-list --count develop`），那 develop 每前进一个提交、
//   每立案一条任务，块就**立刻过期** ⇒ 判据在落地后几分钟内转红，并**永久保持红**（每次刷新只
//   买到几分钟绿）——一个恒红的检查与一个恒绿的检查同样是零信息（硬规则 3b/4：读数取不到两个
//   值 = 不是测量）。更隐蔽的一层：fan-in 把本任务合进 develop 时会**自己造一个新提交**，所以
//   「落地那一刻算出的提交数」在合并完成的一瞬间就已经不等于 develop 的当前值。
//   ⇒ 输出是**在一个提交（块里逐字写出的 `Snapshot commit:`）上对**被跟踪载体**的读数**。判据
//   因此**永远可满足**（重算走同一个提交），而**仍然能取假**：任何人把块里某个值改成不匹配该
//   提交的读数，判据立刻红。漂移检测的语义是「块内值 == 该提交上的真值」，不是「块内值 == 此刻
//   的真值」——后者是一个**必然漂移**的断言，不是一个防漂移的断言。
//   代价（诚实标注）：块里的数字描述的是**那个提交时点**的仓库，不是「现在」。刷新是显式的
//   `--write`（节奏=按需），块自身带提交号，所以读者知道快照点在哪。
//
// ── 为什么只用**被 git 跟踪**的载体 ───────────────────────────────────────────────────
// 实测过：同一个仓库的两个任务 worktree 对 gitignored 载体**不一致**（一个 worktree 里有
// `.quay/gate-events.jsonl`，另一个没有）。⇒ 统计只从 `git ls-tree` / `git grep <commit>` 这类
// **任何检出读数都相同**的来源派生。⛔ 不读 `.quay/*.jsonl`（主检出与 worktree 读数会分叉，判据
// 会在某些 worktree 里结构性不可满足）；⛔ 不读本文件自己产出的东西、⛔ 不写死常量（两者都是
// 硬规则 4 的自我回显）。
//
// ── 哪些键**不进**统计对象（每一条都是「这个量在判据语义下取不到假」）────────────────────
// 判据比的是 `str(v)` 的**子串**，所以一个值的**位数**就是它的判定能力：
//   • **值为 0 的键省略** —— `0` 是几乎所有多位数数字的子串 ⇒ 恒不可判为 missing。
//   • **值 < 10（个位数）的键省略** —— 单字符数字在块里几乎必然作为别的值的子串出现 ⇒ 同上。
//   • **快照提交号不进 `--json`（只作为块里的一行元数据 `Snapshot commit: <sha>`）** ——
//     判据遍历的是 `--json` 的**顶层键**；把 40 位十六进制塞进被遍历的键集，等于往块里加进约 39 个
//     2 字符子串与 38 个 3 字符子串 ⇒ 每个 1–3 位的统计量都会**撞上它** ⇒ 那些键的漂移恒不可检。
//     提交号是**出处元数据**而不是统计量，故不进统计对象；它仍逐字写在块里，`--check` 用它定位
//     快照点，且**改坏它照样会被发现**（换了提交 ⇒ 在那个提交上重算出的值对不上块 ⇒ 漂移）。
//   ⇒ 三者的共同形态是硬规则 4：一个**结构上不可能取假的量不是测量**。剩下的每一个键都是
//     「至少两位数、且不靠别的键当子串撞上」的量。
//
// ── ⛔ 节奏：按需，⛔ 不得接进任何每轮驱动 ─────────────────────────────────────────────
// README.md 是被 git 跟踪的。一个每轮自动 `--write` 的调用点会让工作树**每轮变脏**，而 fan-in 的
// `benign-runtime-dirty` 通道只放行**未跟踪**（`??`）的路径 ⇒ **之后每一次 fan-in 的 ff 都会失败**
// （同族教训逐字记在 plugin/scripts/ci-runs-collect.ts 的头注释里：它正因此把载体从 tracked 改判为
// gitignored）。本脚本没有这样的调用点，也不该有：`--write` 由人/任务实现者在需要刷新时显式跑，
// 并在**同一次提交里**带上刷新后的 README.md。只读的 `--check` 可以接线（它不写任何东西）。
//
// 用法:
//   node --experimental-strip-types plugin/scripts/dev-stats-collect.ts --json
//   node --experimental-strip-types plugin/scripts/dev-stats-collect.ts --write
//   node --experimental-strip-types plugin/scripts/dev-stats-collect.ts --check [--json]
//   node --experimental-strip-types plugin/scripts/dev-stats-collect.ts --json --ref <commit>
// 退出码: 0 = 成功（--check 时为「块与快照一致」）；1 = --check 判出漂移（stderr 带 CAUSE=stats-drift）；
//         2 = 用法/环境错误（README 缺失、标记块不完整/不成对、提交号解析不出——**读不懂 ≠ 一致**，
//             硬规则 3b）。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./repo-root.ts";
import { isDirectEntry } from "./gate-script-base.ts";

/** README 里标记块的起止行（判据逐字匹配这两行）。 */
export const MARK_START = "<!-- dev-stats:start -->";
export const MARK_END = "<!-- dev-stats:end -->";
/** 块里记录快照提交的那一行的前缀（元数据行，⛔ 不是 `- key: value` 统计行）。 */
export const REF_LINE_PREFIX = "Snapshot commit: ";
/** 默认 README（相对 root）。 */
export const README_REL = "README.md";
/** 首次插入块时的落点锚（README 的一个既有二级标题）。 */
export const INSERT_ANCHOR = "## Deeper design and methodology material";
/** 脚本自身的仓库相对路径（测试与文档引用同一份字面量）。 */
export const SCRIPT_REL = "plugin/scripts/dev-stats-collect.ts";
/** 统计对象里数值键的最小值：小于它（含 0）的数值不构成可判定的量（见头注释）。 */
export const MIN_REPORTABLE_VALUE = 10;

export type StatValue = number | string;
export type Stats = Record<string, StatValue>;

/** 块的字段顺序（确定性输出 ⇒ `--write` 幂等）。 */
export const STAT_ORDER: readonly string[] = [
  "snapshot_date",
  "history_days",
  "tasks_total",
  "tasks_done",
  "tasks_ready",
  "tasks_todo",
  "tasks_needs_human",
  "tasks_superseded",
  "tasks_other",
  "commits_total",
  "scripts_total",
  "goals_total",
  "contributors_total",
];

// ── git 读取面 ────────────────────────────────────────────────────────────────────────

interface GitOpts {
  /** 允许退出码 1（`git grep` 无命中 = 「0 条命中」，⛔ 不是读失败）。 */
  allowEmpty?: boolean;
}

function git(root: string, args: string[], opts: GitOpts = {}): string {
  try {
    // `core.quotepath=false`：ls-tree 对**非 ASCII 路径**（本仓 goals/ 下大量中文名）默认输出带
    // 八进制转义的引号形态（`"AC-…\346…"`）⇒ 一个 `.endsWith(".md")` 的过滤会**静默漏掉**它们
    // （实测：goals 的 157 个 .md 被数成 70 —— 87 个中文名被判成「不以 .md 结尾」）。
    return execFileSync("git", ["-C", root, "-c", "core.quotepath=false", ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e: any) {
    if (opts.allowEmpty && typeof e?.status === "number" && e.status === 1) return "";
    const stderr = typeof e?.stderr === "string" ? e.stderr.trim() : String(e?.message ?? e);
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

function lines(s: string): string[] {
  return s.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0);
}

/** 该提交能否在本检出解析出来（解析不出 ⇒ 调用方给 NOT-EVALUATED，⛔ 不当成 0——硬规则 6）。 */
export function refExists(root: string, ref: string): boolean {
  try {
    git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** 把 ref 解析成完整 sha（调用方保证它存在）。 */
export function resolveRef(root: string, ref: string): string {
  return git(root, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}

/**
 * 在 `commit` 上采集开发过程统计。**只读 git 对象库**（不读盘上未提交的内容）⇒ 主检出与任意
 * worktree 对同一个提交得到逐字相同的读数（这正是判据能在任何检出里成立的前提）。
 * 返回的对象**不含提交号**（理由见头注释「哪些键不进统计对象」）。
 */
export function collectStats(root: string, commit: string): Stats {
  const sha = resolveRef(root, commit);
  const raw: Record<string, StatValue> = {};
  raw.snapshot_date = git(root, ["log", "-1", "--format=%cs", sha]).trim();

  // 开发跨度：根提交时刻 → 该提交的时刻（天，向下取整）。
  const rootTimes = lines(git(root, ["log", "--format=%ct", "--max-parents=0", sha])).map((n) => Number(n));
  const refTime = Number(git(root, ["log", "-1", "--format=%ct", sha]).trim());
  if (rootTimes.length > 0 && Number.isFinite(refTime)) {
    raw.history_days = Math.floor((refTime - Math.min(...rootTimes)) / 86400);
  }

  // 任务：`tasks/**.md` 的总数，以及每条的 `status:`（每文件取第一处命中，⛔ 不是整篇 grep）。
  // ⚠️ 实测：`git ls-tree` 的 pathspec **不做 glob 展开**（`-- 'tasks/*.md'` 返回 0 条，
  // 而 `-- tasks` 返回全部）⇒ 目录面用 `-- tasks` + JS 里按扩展名过滤。
  const taskFiles = lines(git(root, ["ls-tree", "-r", "--name-only", sha, "--", "tasks"])).filter((p) =>
    p.endsWith(".md"),
  );
  raw.tasks_total = taskFiles.length;
  // `git grep` 的 pathspec **会**做 glob，但两种写法给的集合必须一致：这里两个面都用 `-- tasks`
  // （目录面），再**在 JS 里用同一个 `.md` 谓词过滤**（grep 不带 `-h`，靠 `path:` 前缀拿到路径）
  // ⇒ 不会出现「文件面 2223 / 状态面只覆盖一部分」而把 tasks_other 算成负数的情形。
  const statusOut = lines(git(root, ["grep", "-m1", "-E", "^status: ", sha, "--", "tasks"], { allowEmpty: true }));
  const byStatus = new Map<string, number>();
  let statusFiles = 0;
  for (const raw of statusOut) {
    // 指定了 <rev> 的 `git grep` 每行形如 `<sha>:<path>:<line>`（实测；`-h` 才会去掉前缀，
    // 而 `-h` 同时会去掉我们需要的路径）⇒ 先剥掉 sha 前缀，再按**第一个**冒号切路径。
    const line = raw.startsWith(`${sha}:`) ? raw.slice(sha.length + 1) : raw;
    const i = line.indexOf(":");
    if (i < 0) continue;
    if (!line.slice(0, i).endsWith(".md")) continue;
    const m = /^status:[ \t]*(.+?)[ \t]*$/.exec(line.slice(i + 1));
    if (!m) continue;
    statusFiles += 1;
    byStatus.set(m[1], (byStatus.get(m[1]) ?? 0) + 1);
  }
  // 读不懂 ≠ 0（硬规则 3b）：有任务文件却一条 status 都读不到 ⇒ 抛错，⛔ 不静默落成「全是 0」。
  if (taskFiles.length > 0 && statusFiles === 0) {
    throw new Error(`cannot read task statuses at ${sha} (${taskFiles.length} task files, 0 status lines)`);
  }
  const named = ["done", "ready", "todo", "needs-human", "superseded"] as const;
  let namedTotal = 0;
  for (const s of named) {
    const n = byStatus.get(s) ?? 0;
    namedTotal += n;
    raw[`tasks_${s.replace(/-/g, "_")}`] = n;
  }
  raw.tasks_other = taskFiles.length - namedTotal;

  raw.commits_total = Number(git(root, ["rev-list", "--count", sha]).trim());
  raw.scripts_total = lines(git(root, ["ls-tree", "-r", "--name-only", sha, "--", "plugin/scripts"])).filter((p) =>
    p.endsWith(".ts"),
  ).length;
  raw.goals_total = lines(git(root, ["ls-tree", "-r", "--name-only", sha, "--", "goals"])).filter((p) =>
    p.endsWith(".md"),
  ).length;
  raw.contributors_total = lines(git(root, ["shortlog", "-sn", sha])).length;

  // 只保留「至少两位数」的数值键（0 与个位数省略 —— 它们靠子串撞上别的键，恒不可判为漂移；
  // 硬规则 4：结构上不可能取假的量不是测量）。空字符串同理省略。
  const out: Stats = {};
  for (const k of STAT_ORDER) {
    const v = raw[k];
    if (v === undefined) continue;
    if (typeof v === "number" && Math.abs(v) < MIN_REPORTABLE_VALUE) continue;
    if (typeof v === "string" && v === "") continue;
    out[k] = v;
  }
  return out;
}

// ── 块的渲染 / 解析 / 比对 ────────────────────────────────────────────────────────────

/** 渲染标记块的**完整文本**（含两行标记与提交行），确定性（键序 = STAT_ORDER）。 */
export function renderBlock(stats: Stats, commit: string): string {
  const keys = [
    ...STAT_ORDER.filter((k) => k in stats),
    ...Object.keys(stats).filter((k) => !STAT_ORDER.includes(k)).sort(),
  ];
  return [
    MARK_START,
    `${REF_LINE_PREFIX}${commit}`,
    ...keys.map((k) => `- ${k}: ${stats[k]}`),
    MARK_END,
  ].join("\n");
}

export interface ParsedBlock {
  found: boolean;
  /** 两行标记之间的文本（不含标记行）。 */
  text: string;
  /** 块里逐字写出的快照提交（无该行 ⇒ null）。 */
  commit: string | null;
  /** 块里的统计键 → 逐字值（字符串形态）。 */
  entries: Record<string, string>;
  /** found=false 时的**可区分**原因（硬规则 3b：读不懂不与「没有块」同形）。 */
  reason: "absent" | "unterminated" | "reversed" | null;
}

const EMPTY_BLOCK: ParsedBlock = { found: false, text: "", commit: null, entries: {}, reason: "absent" };

/** 从一份 README 文本里解析标记块。三态可区分：absent（没有 start）/ unterminated / reversed。 */
export function parseBlock(readmeText: string): ParsedBlock {
  const all = readmeText.split("\n");
  const startIdx = all.indexOf(MARK_START);
  const endIdx = all.indexOf(MARK_END);
  if (startIdx === -1) return { ...EMPTY_BLOCK };
  if (endIdx === -1) return { ...EMPTY_BLOCK, reason: "unterminated" };
  if (endIdx < startIdx) return { ...EMPTY_BLOCK, reason: "reversed" };
  const body = all.slice(startIdx + 1, endIdx);
  const entries: Record<string, string> = {};
  let commit: string | null = null;
  for (const line of body) {
    const ref = new RegExp(`^${REF_LINE_PREFIX}([0-9a-f]{40})$`).exec(line);
    if (ref) commit = ref[1];
    const m = /^- ([A-Za-z0-9_]+):[ \t]*(.*)$/.exec(line);
    if (m) entries[m[1]] = m[2];
  }
  return { found: true, text: body.join("\n"), commit, entries, reason: null };
}

export interface BlockComparison {
  ok: boolean;
  /** 重算出的键里，值没在块文本中逐字出现的（与判据 python 段同形的子串规则）。 */
  missing: string[];
  /** 块里有、重算结果里没有的键（键被删/改名 ⇒ 也是漂移）。 */
  extra: string[];
}

/** 判定：重算值 vs 块文本。`missing` 与 AC-277 criterion 的 python 段**逐字同形**。 */
export function compareBlock(fresh: Stats, blockText: string): BlockComparison {
  const missing = Object.keys(fresh).filter((k) => !blockText.includes(String(fresh[k])));
  const extra = Object.keys(parseBlock([MARK_START, blockText, MARK_END].join("\n")).entries).filter(
    (k) => !(k in fresh),
  );
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/**
 * 把块写进 README 文本。两种形态：
 *   - 已有标记块 ⇒ **只替换两行标记之间**（块外一字不动 ⇒ 连续两次 `--write` 逐字节相同）。
 *   - 没有标记块 ⇒ 在 INSERT_ANCHOR 之前插入一个小节（含块）。锚不在 ⇒ 抛错（⛔ 不猜落点）。
 */
export function writeBlockInto(readmeText: string, block: string): string {
  const cur = parseBlock(readmeText);
  if (cur.found) {
    const all = readmeText.split("\n");
    const s = all.indexOf(MARK_START);
    const e = all.indexOf(MARK_END);
    return [...all.slice(0, s), ...block.split("\n"), ...all.slice(e + 1)].join("\n");
  }
  if (cur.reason !== "absent") {
    throw new Error(`README has a malformed dev-stats block (${cur.reason}) — fix it by hand, not by guessing`);
  }
  const all = readmeText.split("\n");
  const at = all.indexOf(INSERT_ANCHOR);
  if (at === -1) {
    throw new Error(`README has neither a dev-stats block nor the insertion anchor (${INSERT_ANCHOR})`);
  }
  const section = [
    "## Development process statistics",
    "",
    "Machine-generated from this repository's **tracked** development carriers (git history,",
    "`tasks/*.md`, `goals/*.md`, `plugin/scripts/*.ts`) by",
    "[`plugin/scripts/dev-stats-collect.ts`](plugin/scripts/dev-stats-collect.ts). The block is a",
    "snapshot pinned to the commit it names, so the values are stable and any hand-edited number",
    "stops matching — `--check` fails on that drift. Regenerate with `--write`; never edit by hand.",
    "",
    block,
    "",
  ];
  return [...all.slice(0, at), ...section, ...all.slice(at)].join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────

interface Cli {
  mode: "json" | "write" | "check";
  root: string;
  readme: string;
  ref: string | null;
  json: boolean;
}

const USAGE = `用法:
  node --experimental-strip-types ${SCRIPT_REL} --json [--ref <commit>] [--root <dir>]
  node --experimental-strip-types ${SCRIPT_REL} --write [--ref <commit>] [--root <dir>] [--readme <path>]
  node --experimental-strip-types ${SCRIPT_REL} --check [--json] [--root <dir>] [--readme <path>]
说明: --json 打印扁平标量统计 JSON（快照点 = README 块里写的那个提交，无块时取 HEAD）；
      --write 把标记块重写成当前快照（人不得手填）；--check 比对「重算值 vs 块内值」，
      漂移时 exit 1 且 stderr 带 CAUSE=stats-drift；--ref 显式钉快照点（--write 缺省 HEAD）。`;

function parseCli(argv: string[]): Cli {
  let mode: Cli["mode"] | null = null;
  let root = "";
  let readme = "";
  let ref: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(USAGE + "\n");
      process.exit(0);
    } else if (a === "--json") json = true;
    else if (a === "--write") mode = "write";
    else if (a === "--check") mode = "check";
    else if (a === "--ref") ref = argv[++i] ?? "";
    else if (a === "--root") root = argv[++i] ?? "";
    else if (a === "--readme") readme = argv[++i] ?? "";
    else throw new Error(`unknown argument: ${a}`);
  }
  // 缺省是**只读**的 --json：⛔ 无参运行绝不写 README（--write 必须显式）。
  if (!mode) mode = "json";
  return {
    mode,
    root: root ? path.resolve(root) : repoRoot(),
    readme: readme ? path.resolve(readme) : "",
    ref: ref || null,
    json,
  };
}

function fail(code: 1 | 2, cause: string, detail: string): never {
  process.stderr.write(`CAUSE=${cause} — ${detail}\n`);
  process.exit(code);
}

function main(argv: string[]): number {
  let cli: Cli;
  try {
    cli = parseCli(argv);
  } catch (e: any) {
    process.stderr.write(`${e?.message ?? e}\n${USAGE}\n`);
    return 2;
  }
  const readmePath = cli.readme || path.join(cli.root, README_REL);
  const readmeExists = fs.existsSync(readmePath);
  const readmeText = readmeExists ? fs.readFileSync(readmePath, "utf8") : "";
  const block = readmeExists ? parseBlock(readmeText) : EMPTY_BLOCK;

  // 快照点解析：显式 --ref > 块里写的提交 > HEAD。
  // `--write` 是**刷新**语义（缺省重新钉当前 HEAD），⛔ 不沿用块里的旧提交——否则刷新无从发生；
  // `--json`/`--check` 沿用块里的提交，这正是「读的与写的是同一个快照点」。
  const wantRef = cli.ref ?? (cli.mode === "write" ? null : block.found ? block.commit : null);
  const chosen = wantRef ?? "HEAD";
  let commit: string;
  let stats: Stats;
  try {
    if (!refExists(cli.root, chosen)) {
      return fail(2, "snapshot-ref-unresolvable", `cannot resolve ${chosen} in ${cli.root}`);
    }
    commit = resolveRef(cli.root, chosen);
    stats = collectStats(cli.root, commit);
  } catch (e: any) {
    return fail(2, "stats-unreadable", String(e?.message ?? e));
  }

  if (cli.mode === "json") {
    process.stdout.write(JSON.stringify(stats) + "\n");
    return 0;
  }

  if (cli.mode === "write") {
    if (!readmeExists) return fail(2, "readme-absent", `${readmePath} does not exist`);
    let next: string;
    try {
      next = writeBlockInto(readmeText, renderBlock(stats, commit));
    } catch (e: any) {
      return fail(2, "readme-block-unwritable", String(e?.message ?? e));
    }
    fs.writeFileSync(readmePath, next, "utf8");
    process.stdout.write(`dev-stats: wrote ${Object.keys(stats).length} field(s) pinned to ${commit}\n`);
    return 0;
  }

  // --check：三态（一致 / 漂移 / 读不懂），⛔ 后两者不得同形（硬规则 3b）。
  if (!readmeExists) return fail(2, "readme-marker-absent", `${readmePath} does not exist`);
  if (!block.found) {
    return fail(2, "readme-marker-absent", `README has no complete ${MARK_START}/${MARK_END} block (${block.reason})`);
  }
  if (!block.commit) return fail(2, "snapshot-ref-unresolvable", `block has no "${REF_LINE_PREFIX}<sha>" line`);
  if (!refExists(cli.root, block.commit)) {
    return fail(2, "snapshot-ref-unresolvable", `block names ${block.commit}, which does not resolve in ${cli.root}`);
  }
  // `stats` 已在 block.commit 上算好（上面的 chosen 解析），⛔ 不重算一遍。
  const cmp = compareBlock(stats, block.text);
  if (cli.json) process.stdout.write(JSON.stringify({ ...cmp, commit }) + "\n");
  if (!cmp.ok) {
    return fail(
      1,
      "stats-drift",
      `block differs from ${block.commit}: missing=[${cmp.missing.join(",")}] extra=[${cmp.extra.join(",")}]`,
    );
  }
  process.stdout.write(`dev-stats: consistent with ${block.commit}\n`);
  return 0;
}

// isDirectEntry 比的是**去扩展名的** basename（gate-script-base.ts:270），⛔ 不是带 .ts 的路径。
if (isDirectEntry(import.meta, process.argv[1], path.basename(SCRIPT_REL, ".ts"))) {
  process.exit(main(process.argv.slice(2)));
}
