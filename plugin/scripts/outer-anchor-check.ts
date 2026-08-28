// outer-anchor-check.ts — AC80 三层 prompt 正本 + 不变式检查器（outer + inner 两层的 CronCreate 锚）。
// (tasks/gap-ac80-prompt-canonical-and-invariant-checker, AC1-AC4 + DoD).
//
// 回答的问题（@instrument）：「outer/inner 的 CronCreate 锚 prompt 是否（①）有 git 跟踪正本、
//   （②）保持纯指针形式（不渗入状态/决策）、且（③）正本内容与真正投进 CronCreate 的活 prompt 逐字节一致？」
//
// 背景（人 2026-08-14 裁定「把三层统一应用 CronCreate 加入本阶段目标和 AC，包括配套工作」）：
//   manager 已有正本（orchestration/manager-tick-prompt.txt）+ 不变式检查（manager-anchor-check.py）。
//   AC80 把同一形态扩到 outer + inner，且判据3（真难点）超出 manager 模型：
//   正本文件 与 真正投进 CronCreate 的字符串 是两份副本，而副本会漂——实证：manager-loop-tick.md 的
//   豁免面副本在人裁定后立刻过期，审计读的正是那份过期副本。故检查器必须【比对正本内容 vs 活 prompt
//   逐字节】，只查「文件存在」不算（AC80 判据3）。
//
// 判据3 的活 prompt 来源：CronList 的显示文本会被截断（以 … 结尾），检查器绝不解析它——活 prompt 由
// 操作者/调用方以完整值经 `--cron-prompt <text>` 或 stdin 传入（CronList 是 session 内工具，脚本无法
// 直接调用）。比对用 UTF-8 字节（Buffer），含空白逐字节一致。
//
// 各层正本（per-layer 适配，勿对 manager 模型逐字照抄——每层正本的指针形态是设计决定）：
//   --layer inner → plugin/loop/fast-mode-loop-tick.md 内 AC80-INNER-ANCHOR-BEGIN/END 之间的 prompt 段
//                   （AC80 C17 建议：outer 把内层 CronCreate prompt 原文逐字落入该段；落地前=缺失）。
//                   该 prompt 自带 AC81 哨兵清扫规则（CronList + 清扫），故 inner 要求内联哨兵规则。
//   --layer outer → orchestration/outer-tick-prompt.txt（outer 已建，commit 72b99cda；缺失=NOT-EVALUATED）。
//                   outer 的正本是【1 跳直指执行核】形态（入口 orchestrator-tick-core.md，理由档案按需
//                   src:N 查，不要全读）——哨兵清扫规则由执行核持有，不要求内联（强制内联会误伤真实正本）。
// 两层共同的不变量（对 manager 模型逐条保留）：必须是指针（指向执行核）；不得渗入状态（ISO 日期 /
//   提交号 / 任务名）；不得携带本轮决策词；正本文件无未提交改动（漂移未经审阅）。
//
// 退出码（硬规则 3b：无法评估 ≠ 合格，独立取值）：
//   0 = OK（正本存在 + 指针形式合格 + 活 prompt 逐字节一致，判据3 已评估）
//   1 = VIOLATED（任一检查失败：指针形式违反 / 正本未提交改动 / 判据3 逐字节不一致）
//   2 = NOT-EVALUATED（正本缺失 / inner 段标记缺失 / 未提供活 prompt——判据3 无法评估，NOT pass）
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/outer-anchor-check.ts \
//       --layer inner|outer [--root <repo>] [--canonical-file <path>] \
//       [--cron-prompt '<完整活 prompt>' | --stdin] [--json]
//   --layer <inner|outer>   必选（--help 除外）：选定层与正本来源 + 指针要求。
//   --root <dir>            仓库根（默认 cwd）。
//   --canonical-file <path> 覆盖正本来源（fixture 接缝，测试用；此时跳过工作树未提交检查）。
//   --cron-prompt <text>    活 CronList prompt 的【完整】值（脚本无法调用 CronList，由调用方传入）。
//   --stdin                 从 stdin 读完整活 prompt（取代 --cron-prompt；剥一个尾部换行）。
//   --json                  机器可读输出 { ok, code, reason, layer, findings, byteCompare }。
//   （判据3 的活 prompt 绝不取自 CronList 显示文本——它被截断，恒误报。）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { verified, notEvaluated, failed, driverResultToExit } from "./checker-io.ts";
import type { DriverResult } from "./checker-io.ts";

export const EXIT_OK = 0;
export const EXIT_VIOLATED = 1;
export const EXIT_NOT_EVALUATED = 2;

/** inner 正本段落的提取标记（C17 建议落进 plugin/loop/fast-mode-loop-tick.md 的注释）。 */
export const INNER_ANCHOR_BEGIN_MARK = "AC80-INNER-ANCHOR-BEGIN";
export const INNER_ANCHOR_END_MARK = "AC80-INNER-ANCHOR-END";

export interface LayerConfig {
  canonicalRel: string;
  requiredPointers: string[];
  /** inner 的 AC81 哨兵清扫规则内联在 prompt 里，必须强制；outer 由执行核持有，不内联。 */
  requireSentinel: boolean;
}

export const LAYERS: Record<string, LayerConfig> = {
  inner: {
    canonicalRel: "plugin/loop/fast-mode-loop-tick.md",
    requiredPointers: [
      "orchestration/fast-mode-tick-core.md",
      "docs/analysis/fast-mode-loop-tick.md",
      "inner-tick-log.jsonl",
      "orchestration/manager-phase-goal.md",
    ],
    requireSentinel: true,
  },
  outer: {
    canonicalRel: "orchestration/outer-tick-prompt.txt",
    requiredPointers: ["orchestrator-tick-core.md"],
    requireSentinel: false,
  },
};

/** 状态渗入判据（对 manager-anchor-check.py ③ 逐字保留）。 */
const ISO_DATE_RE = /20\d\d-\d\d-\d\d/;
const COMMIT_HASH_RE = /\b[0-9a-f]{7,40}\b/;
const TASK_NAME_RE = /gap-[a-z][a-z0-9-]{5,}/;

/** 决策词判据（对 manager-anchor-check.py ④ 逐字保留）。 */
export const DECISION_WORDS = ["本轮重点", "优先", "先做", "暂停", "跳过", "派发"];

// ── 正本提取 ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * 从正本来源原始文本中提取 canonical prompt 字符串。
 * - outer：整个文件去掉一个尾部换行（正本即 prompt 本身，单行）。
 * - inner：AC80-INNER-ANCHOR-BEGIN 注释行之后、AC80-INNER-ANCHOR-END 标记之前的全部内容，
 *          去掉一个尾部换行（段落行终止符）。提取不到 ⇒ null（=正本缺失，NOT-EVALUATED）。
 * 该函数同时用于默认路径与 `--canonical-file` 覆盖——测试经覆盖接缝走同一提取路径。
 */
export function extractCanonical(text: string, layer: string): string | null {
  if (layer === "outer") {
    return text.replace(/\n$/, "");
  }
  const beginIdx = text.indexOf(INNER_ANCHOR_BEGIN_MARK);
  if (beginIdx < 0) return null;
  const contentStart = text.indexOf("\n", beginIdx);
  if (contentStart < 0) return null;
  const endMarkPos = text.indexOf(INNER_ANCHOR_END_MARK);
  if (endMarkPos < 0) return null;
  // 内容结束于 END 标记行的行首（`\n` 之前），而不是 END 标记本身（否则会带上 `<!-- ` 前缀）。
  const endLineStart = text.lastIndexOf("\n", endMarkPos);
  const endIdx = endLineStart <= contentStart ? endMarkPos : endLineStart;
  if (endIdx <= contentStart) return null;
  const content = text.slice(contentStart + 1, endIdx);
  return content.replace(/\n$/, "");
}

// ── 指针形式判据（对 manager-anchor-check.py ①-④ 逐条镜像，per-layer 适配）─────────────────────────────

/** 返回违反项数组；空数组 = 指针形式合格。 */
export function pointerFormFindings(canonical: string, layer: string): string[] {
  const cfg = LAYERS[layer];
  const bad: string[] = [];
  for (const p of cfg.requiredPointers) {
    if (!canonical.includes(p)) bad.push(`缺指向 ${p}`);
  }
  if (cfg.requireSentinel) {
    if (!canonical.includes("CronList")) bad.push("缺哨兵清扫规则（CronList）");
    if (!canonical.includes("清扫")) bad.push("缺哨兵清扫规则（清扫）");
  }
  if (ISO_DATE_RE.test(canonical)) bad.push("含 ISO 日期（状态渗入）");
  if (COMMIT_HASH_RE.test(canonical)) bad.push("含提交号（状态渗入）");
  if (TASK_NAME_RE.test(canonical)) bad.push("含任务名（状态渗入）");
  for (const w of DECISION_WORDS) {
    if (canonical.includes(w)) bad.push(`含决策词「${w}」`);
  }
  return bad;
}

// ── 工作树未提交检查（对 manager-anchor-check.py ⑤ 镜像）────────────────────────────────────────────────

/**
 * 返回 `git status --porcelain -- <relPath>` 输出；空串 = 干净（已提交且无改动）。
 * 未跟踪新文件也返回非空（porcelain 以 ?? 开头）——未提交的正本 = 漂移未经审阅。
 */
export function gitUncommitted(root: string, relPath: string): string {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", relPath], {
      cwd: root,
      encoding: "utf8",
    });
    return out.trim();
  } catch (err) {
    return `git-error: ${String(err)}`;
  }
}

// ── 判据3：逐字节比对 ───────────────────────────────────────────────────────────────────────────────────

export interface ByteDiffResult {
  match: boolean;
  actualBytes: number;
  expectedBytes: number;
  firstDiffByte: number;
}

/** UTF-8 字节级比对（含空白逐字节一致）。Buffer.equals 是字节相等；不等时报首个差异字节下标。 */
export function byteDiff(actual: string, expected: string): ByteDiffResult {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.equals(b)) return { match: true, actualBytes: a.length, expectedBytes: b.length, firstDiffByte: -1 };
  let first = Math.min(a.length, b.length);
  for (let i = 0; i < first; i++) {
    if (a[i] !== b[i]) {
      first = i;
      break;
    }
  }
  return { match: false, actualBytes: a.length, expectedBytes: b.length, firstDiffByte: first };
}

/** 差异附近上下文（UTF-8 切片，按字节窗；窗口在字符中间时 toString 会丢坏字节——只作诊断显示）。 */
export function formatDiffContext(canonical: string, live: string, firstDiffByte: number): string {
  const a = Buffer.from(canonical, "utf8");
  const b = Buffer.from(live, "utf8");
  const start = Math.max(0, firstDiffByte - 24);
  const ctxA = a.subarray(start, start + 80).toString("utf8").replace(/\n/g, "\\n");
  const ctxB = b.subarray(start, start + 80).toString("utf8").replace(/\n/g, "\\n");
  return `  canonical(${a.length}b): …${ctxA}…\n  live    (${b.length}b): …${ctxB}…\n  first differing byte at ${firstDiffByte}`;
}

// ── 主判定 ───────────────────────────────────────────────────────────────────────────────────────────────

export interface CheckOptions {
  layer: string;
  root: string;
  canonicalFileOverride?: string;
  cronPrompt: string | null;
}

export interface CheckResult {
  ok: boolean;
  code: number;
  reason: string;
  layer: string;
  canonicalPath: string;
  /** 提取出的正本 prompt 字符串（正本缺失/段缺失时为 null）。 */
  canonical: string | null;
  canonicalBytes: number;
  findings: string[];
  pointerForm: { ok: boolean; findings: string[] };
  byteCompare: {
    evaluated: boolean;
    ok: boolean;
    canonicalBytes: number;
    liveBytes: number;
    firstDiffByte: number;
    notEvaluatedReason?: string;
  };
  uncommitted: string;
  /** B4 (gap-b4-checker-reuse-driver-result): 判定收敛到 driver-result 的 DriverResult<T> 词表。
   *  `code` 由 driverResultToExit(driverResult) 派生——checker 不再自造第三态（硬规则 3b）。 */
  driverResult: DriverResult<unknown>;
}

export function checkAnchor(opts: CheckOptions): CheckResult {
  const { layer, root, cronPrompt } = opts;
  const cfg = LAYERS[layer];
  const canonicalPath = opts.canonicalFileOverride
    ? opts.canonicalFileOverride
    : path.join(root, cfg.canonicalRel);
  const relPath = opts.canonicalFileOverride ? canonicalPath : cfg.canonicalRel;

  // 正本缺失 ⇒ NOT-EVALUATED（独立取值，非通过；硬规则 3b）——由 DriverResult.not-evaluated 承载。
  if (!fs.existsSync(canonicalPath)) {
    const driverResult = notEvaluated(
      `MISSING-正本: ${relPath} 不存在（该层正本尚未落地；重挂 cron 时无对照物可 diff）`,
    );
    return {
      ok: false,
      code: driverResultToExit(driverResult),
      reason: driverResult.reason,
      layer,
      canonicalPath,
      canonical: null,
      canonicalBytes: -1,
      findings: [],
      pointerForm: { ok: false, findings: ["MISSING-正本"] },
      byteCompare: {
        evaluated: false,
        ok: false,
        canonicalBytes: -1,
        liveBytes: -1,
        firstDiffByte: -1,
        notEvaluatedReason: "正本缺失",
      },
      uncommitted: "",
      driverResult,
    };
  }

  const canonical = extractCanonical(fs.readFileSync(canonicalPath, "utf8"), layer);
  if (canonical === null) {
    const driverResult = notEvaluated(
      `MISSING-正本: ${relPath} 内未找到 ${INNER_ANCHOR_BEGIN_MARK}…${INNER_ANCHOR_END_MARK} 段（inner 正本段尚未落地）`,
    );
    return {
      ok: false,
      code: driverResultToExit(driverResult),
      reason: driverResult.reason,
      layer,
      canonicalPath,
      canonical: null,
      canonicalBytes: -1,
      findings: [],
      pointerForm: { ok: false, findings: ["MISSING-正本（提取标记未找到）"] },
      byteCompare: {
        evaluated: false,
        ok: false,
        canonicalBytes: -1,
        liveBytes: -1,
        firstDiffByte: -1,
        notEvaluatedReason: "正本段缺失",
      },
      uncommitted: "",
      driverResult,
    };
  }

  const pointerFindings = pointerFormFindings(canonical, layer);

  // 工作树未提交检查：仅默认路径（`--canonical-file` 是测试接缝，文件在仓库外，git 不可见）。
  const uncommitted = opts.canonicalFileOverride ? "" : gitUncommitted(root, relPath);
  if (uncommitted) pointerFindings.push(`正本有未提交改动（漂移未经审阅）: ${uncommitted}`);

  // 判据3：活 prompt 逐字节比对。
  const live = cronPrompt === null ? null : cronPrompt;
  const byteCompare = live === null
    ? {
        evaluated: false,
        ok: false,
        canonicalBytes: Buffer.byteLength(canonical, "utf8"),
        liveBytes: -1,
        firstDiffByte: -1,
        notEvaluatedReason: "未提供活 prompt（--cron-prompt/--stdin）——判据3 无法评估",
      }
    : (() => {
        const d = byteDiff(canonical, live);
        return {
          evaluated: true,
          ok: d.match,
          canonicalBytes: d.actualBytes,
          liveBytes: d.expectedBytes,
          firstDiffByte: d.firstDiffByte,
        };
      })();

  const findings = [...pointerFindings];
  if (byteCompare.evaluated && !byteCompare.ok) {
    findings.push(`判据3: 正本 vs 活 prompt 逐字节不一致（canonical ${byteCompare.canonicalBytes}b vs live ${byteCompare.liveBytes}b）`);
    // 2026-08-16 gap-ac81 诊断（根因可见化）：字节不符且活输入自身缺 required pointer ⇒ 活值疑似
    // 手工缩写/旧版（CronList 显示文本被截断以 … 结尾，绝不可作活值）——把「canonical 过时」与
    // 「live 喂错」分开，避免恒报 VIOLATED 却被误读为「正本过时」（实证：578B 假活值缺 docs/analysis 指针）。
    if (live !== null) {
      const liveForm = pointerFormFindings(live, layer);
      if (liveForm.length > 0) {
        findings.push(
          `判据3 诊断: 活 prompt 本身非合格指针（${liveForm.join(" / ")}）——活值疑似手工缩写/旧版，必须逐字等于 cron 完整 prompt（CronList 显示截断，不可作活值）`,
        );
      }
    }
  }

  // 判定收敛到 DriverResult 词表（B4）：code 由 driverResultToExit 派生，checker 不自造第三态。
  const driverResult: DriverResult<unknown> =
    findings.length > 0
      ? failed(findings.join(" / "))
      : !byteCompare.evaluated
        ? notEvaluated(byteCompare.notEvaluatedReason ?? "未提供活 prompt")
        : verified(canonical, "正本存在 + 指针形式合格 + 判据3 逐字节一致");

  const code = driverResultToExit(driverResult);
  let reason = "OK";
  if (driverResult.state === "failed") {
    reason = "VIOLATED: " + driverResult.reason;
  } else if (driverResult.state === "not-evaluated") {
    reason = "NOT-EVALUATED: 指针形式合格，但判据3 未评估——" + driverResult.reason;
  }

  return {
    ok: code === EXIT_OK,
    code,
    reason,
    layer,
    canonicalPath,
    canonical,
    canonicalBytes: Buffer.byteLength(canonical, "utf8"),
    findings,
    pointerForm: { ok: pointerFindings.length === 0, findings: pointerFindings },
    byteCompare: byteCompare as CheckResult["byteCompare"],
    uncommitted,
    driverResult,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `outer-anchor-check.ts — AC80 三层 prompt 正本 + 不变式检查器（outer/inner 的 CronCreate 锚）

  node --no-warnings --experimental-strip-types plugin/scripts/outer-anchor-check.ts \\
      --layer inner|outer [--root <repo>] [--canonical-file <path>] [--cron-prompt <text>|--stdin] [--json]

  --layer <inner|outer>   必选：inner=fast-mode-loop-tick.md 内 AC80 段；outer=orchestration/outer-tick-prompt.txt
  --root <dir>            仓库根（默认 cwd）
  --canonical-file <path> 覆盖正本来源（测试接缝；跳过工作树检查）
  --cron-prompt <text>    活 CronList prompt 完整值（脚本无法调用 CronList，由调用方传入；绝不解析 CronList 截断显示）
  --stdin                 从 stdin 读完整活 prompt（取代 --cron-prompt）
  --json                  机器可读输出

  退出码: 0=OK（正本存在+指针形式合格+逐字节一致）  1=VIOLATED（任一检查失败）  2=NOT-EVALUATED（正本缺失/未提供活 prompt）`;

function parseArgs(argv: string[]): {
  layer: string;
  root: string;
  canonicalFile: string | null;
  cronPrompt: string | null;
  stdin: boolean;
  json: boolean;
  help: boolean;
} {
  const out = {
    layer: "",
    root: process.cwd(),
    canonicalFile: null as string | null,
    cronPrompt: null as string | null,
    stdin: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--layer") out.layer = argv[++i] ?? "";
    else if (a === "--root") out.root = argv[++i] ?? out.root;
    else if (a === "--canonical-file") out.canonicalFile = argv[++i] ?? null;
    else if (a === "--cron-prompt") out.cronPrompt = argv[++i] ?? null;
    else if (a === "--stdin") out.stdin = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE + "\n");
    process.exit(0);
  }
  if (args.layer !== "inner" && args.layer !== "outer") {
    process.stderr.write("outer-anchor-check: --layer 必须为 inner 或 outer\n" + USAGE + "\n");
    process.exit(2);
  }
  let cronPrompt = args.cronPrompt;
  if (args.stdin) {
    cronPrompt = fs.readFileSync(0, "utf8").replace(/\n$/, "");
  }
  const result = checkAnchor({
    layer: args.layer,
    root: args.root,
    canonicalFileOverride: args.canonicalFile ?? undefined,
    cronPrompt,
  });
  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: result.ok,
          code: result.code,
          reason: result.reason,
          layer: result.layer,
          canonicalPath: result.canonicalPath,
          canonicalBytes: result.canonicalBytes,
          findings: result.findings,
          pointerForm: result.pointerForm,
          byteCompare: result.byteCompare,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    const tag =
      result.code === EXIT_OK ? "PASS" : result.code === EXIT_VIOLATED ? "VIOLATED" : "NOT-EVALUATED";
    process.stdout.write(`outer-anchor-check: ${tag} — ${result.reason}\n`);
    if (result.code === EXIT_OK) {
      process.stdout.write(
        `  layer=${result.layer} canonical=${path.basename(result.canonicalPath)} bytes=${result.canonicalBytes} 判据3 byte-identical\n`,
      );
    } else if (result.code === EXIT_VIOLATED) {
      if (result.pointerForm.findings.length > 0) {
        process.stdout.write(`  pointer-form: ${result.pointerForm.findings.join(" / ")}\n`);
      }
      if (result.byteCompare.evaluated && !result.byteCompare.ok) {
        process.stdout.write(
          formatDiffContext(result.canonical ?? "", cronPrompt ?? "", result.byteCompare.firstDiffByte) + "\n",
        );
      }
    }
  }
  process.exit(result.code);
}
