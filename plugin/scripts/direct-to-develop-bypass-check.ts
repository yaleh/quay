#!/usr/bin/env node
// direct-to-develop-bypass-check.ts — 直接提交 develop 绕过全部 fan-in 机件的检测器
// (tasks/gap-direct-to-develop-bypasses-fan-in-gates, 11b/C17 写所有权/越权直改面).
//
// 问题（任务体实证）：~25-30 条直接提交 develop 绕过 ff-lock / anti-drift-touches / AC 完成闸三道，
// 且不进任何差集——AC78 判据2 按任务算的差集结构上看不见它们（7e64a86b 是最近一条）。核心子集：
//   7d1d5d2e → plugin/test/ready-pool-check.test.mjs
//   b389a758 → plugin/scripts/loop-shipping-exclusion-data.mjs
//   18e7a3be → plugin/scripts/loop-shipping-exclusion-data.mjs
//   77174684 → plugin/test/manager-tick-core.test.mjs
//   7e64a86b → plugin/skills/init/SKILL.md
// 直接提交 develop 且触及代码/断言面、且不在任何 ff-lock 事件时间窗内 ⇒ 报「直接提交绕过 fan-in 机件」。
//
// 判定原理（reflog 是 ground truth）：`git merge --ff-only` 只移动 ref、不创建 commit——一个通过
// fan-in 落地的 task 提交在 DAG 上与直接提交看起来完全一样（单亲线性链），唯一区分它们的读面是
// develop 的 REFLOG：fan-in 落地记 `merge task/<id>: Fast-forward`，直接提交记 `commit: <msg>`
// （或 `commit (amend):` / `commit (merge):`）。因此本检测器以 `git log -g develop` 的 action
// 为「直接提交」主信号（CLAUDE.md 硬规则 2：按位置判定，不按关键词——commit subject 里出现
// 「fan-in」不算，reflog action 才算）。
//
// 排除集（denominator 谓词，AC3 判据 25 vs 30 的差异就在排除集——本谓词记录在任务体）：
//   设计内 = 按设计就该直接提交 develop 的文件（GREEN，不误报）：
//     · 记账/转向/遥测面：tasks/ docs/ orchestration/ adr/ .quay/ plugin/loop/ measurements/
//       milestones/（任务体、分析文档、执行核、ADR、遥测都是各层直接写）
//     · 机件面：.claude/（agent harness 的 workflow/skill——manager 独占）
//       plugin/skills/manager/**（manager 独占 SKILL.md + 结构上无 fan-in 路——无任务/无 worktree，
//       fan-in-execute.js 无 task 即 bad-args；同 .claude/ 类。⛔ 粒度到 manager/**，不含 init/——
//       后者是产品交付面真红，7e64a86b 必须仍红；635ec831（manager/SKILL.md）转绿）
//     · 指引面：CLAUDE.md（本仓库唯一每会话自动注入的文档，管理者独占直写）
//     · 基础设施：.gitignore .gitattributes .npmrc .github/（CI/build 配置）
//     · 热修 fan-in 机件本身：plugin/scripts/fan-in-* plugin/test/fan-in-*（机制坏了无法 self-fan-in，
//       引导问题——5e54bb37 正是此类）
//   代码/断言面 = 排除集之外的一切，含 plugin/scripts/*、plugin/test/*、plugin/skills/**/*.md
//     （SKILL.md 是产品交付面，不是记账面——7e64a86b（init/）因此报红；manager/** 是 manager 独占面、
//     635ec831 因此转绿）、packages/**、scripts/test.sh 等。
//
//   ⚠️ 与 fan-in-execute.js:87 code_delta 谓词的关系（AC1）：复用其「排除记账/遥测面」的精神，
//   但**不排除全部 .md**（该谓词的 `[.]md$` 是为「develop delta 要不要重跑全量」服务的——.md
//   变化不需全量；本检测器问的是「是不是绕过 fan-in」，产品面 .md（SKILL.md）同样是交付物，必须
//   报红）。差异即 25（inner 独立谓词，排除全部 .md）vs 30（manager 谓词）的来源，写在此处。
//
// ff-lock 时间窗（AC1 第三条件）：fan-in-ff-merge.sh 的持锁段在 .quay/fan-in-merge-lock-events.jsonl
// 写 acquire/release 对（毫秒级）。一个直接提交若落在某个 acquire→release 区间内 ⇒ 可能属 fan-in
// 落地 ⇒ 不报（保守口径：when in doubt, don't flag）。复用 fan-in-ff-protocol-check.ts 的
// buildLockHoldIntervals（同源不新造）。锁事件不成对 ⇒ 该子检查 NOT-EVALUATED，不得与合格同形
// （硬规则 3b）。
//
// 基线（--baseline）：历史欠账（~30 条直接提交）是已文档化债务；生产接线传 enforcement 落点的
// develop HEAD 作基线，只扫基线之后的新直接提交——新违规才红（同 fan-in-ff-protocol-check.ts
// --baseline cd4f49b4 的 enforcement-boundary 模式）。无基线 = 扫 develop 全史（审计用，历史上
// 会红）。`--commits <csv>` = 显式回放指定 commit（真样本 replay 的 fixture seam，跳过 reflog
// 扫描）。
//
// Exit codes: 0 = PASS / NOT-EVALUATED（读 `evaluated`：false = 无法评估，绝不与合格同形）；
//             1 = RED（直接提交绕过 fan-in 机件）；2 = usage/environment 错误。
//
// Run:
//   node --experimental-strip-types direct-to-develop-bypass-check.ts --root <dir>
//       [--develop <ref>] [--baseline <ref>] [--lock-events <file>] [--commits <csv>]
//       [--json] [--help]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import { buildLockHoldIntervals } from "./fan-in-ff-protocol-check.ts";

// ── Constants ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * 设计内路径谓词（GREEN——按设计就该直接提交 develop）。一个直接提交只有在其**所有**改动文件
 * 都命中本谓词时才是设计内；任一文件落在排除集之外即为代码/断言面。
 * ⚠️ 维护注记：加新的排除项 = 收窄代码/断言面（少报红）。这里每一条都有任务体/CLAUDE.md 里的
 * 归属（记账面 / manager 独占 / 热修机件 / 基础设施）。若一条未来不再成立（例如 plugin/loop/ 从
 * 遥测面变成产品面），先从任务体改判，再改此处——两处必须同步。
 */
export const DESIGN_INTERNAL_RE =
  /^(?:tasks\/|docs\/|orchestration\/|adr\/|[.]quay\/|plugin\/loop\/|measurements\/|milestones\/|[.]claude\/|plugin\/skills\/manager\/|CLAUDE[.]md$|[.]gitignore$|[.]gitattributes$|[.]npmrc$|[.]github\/|plugin\/scripts\/fan-in-|plugin\/test\/fan-in-)/;

/** 一条 repo-相对路径是否落在设计内排除集（按设计就该直接提交 develop）。PURE。 */
export function isDesignInternalPath(relPath) {
  return DESIGN_INTERNAL_RE.test(String(relPath ?? ""));
}

/** 一个直接提交的判定。PURE——测试注入 {sha, files, epoch, subject, action}。 */
export function classifyCommit(commit, lockHoldIntervals) {
  const files = Array.isArray(commit?.files) ? commit.files : [];
  const codeSurfaceFiles = files.filter((f) => !isDesignInternalPath(f));
  const inLockWindow =
    Array.isArray(lockHoldIntervals) &&
    typeof commit.epoch === "number" &&
    lockHoldIntervals.some((iv) => iv && iv.start <= commit.epoch && commit.epoch <= iv.end);
  const designInternal = codeSurfaceFiles.length === 0;
  return {
    sha: commit?.sha ?? "?",
    subject: commit?.subject ?? "",
    action: commit?.action ?? "commit",
    epoch: commit?.epoch ?? null,
    files,
    codeSurfaceFiles,
    designInternal,
    inLockWindow: Boolean(inLockWindow),
    bypass: !designInternal && !inLockWindow,
  };
}

/**
 * 聚合判定：对收集到的直接提交逐条分类。`evaluated` 由调用方判定（reflog 读不到 / 锁窗口读不出
 * ⇒ 不在此处），本函数只产出分类明细 + denominator 计数（AC3 的排除集谓词对应的是
 * `codeSurfaceCommits` 口径，见头注释）。PURE。
 */
export function checkDirectCommits(commits, lockHoldIntervals) {
  const classified = (commits ?? []).map((c) => classifyCommit(c, lockHoldIntervals));
  const violations = classified.filter((c) => c.bypass);
  const codeSurfaceCommits = classified.filter((c) => c.codeSurfaceFiles.length > 0);
  const designInternalCommits = classified.filter((c) => c.designInternal);
  const inLockWindowCommits = classified.filter((c) => c.inLockWindow);
  return {
    violations,
    reason: violations.length > 0 ? "direct-commit-bypasses-fan-in" : "no-direct-bypass",
    totalCommits: classified.length,
    codeSurfaceCommits: codeSurfaceCommits.length,
    designInternalCommits: designInternalCommits.length,
    inLockWindowCommits: inLockWindowCommits.length,
    classified,
  };
}

// ── git / fs 边界（impure——测试可对纯判定直接注入，或对 CLI 用真实 temp repo）──────────────

function git(root, args, opts = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: opts.timeout ?? 15_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** 一条 commit 的相对改动文件（vs 第一父）。父不存在（root commit）返回 null。 */
export function gitCommitFiles(root, sha) {
  try {
    const out = git(root, ["diff", "--name-only", `${sha}^`, sha]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/** 一条 commit 的 committer epoch（秒）。 */
export function gitCommitEpoch(root, sha) {
  try {
    return Number(git(root, ["log", "-1", "--format=%ct", sha]).trim());
  } catch {
    return null;
  }
}

function gitCommitSubject(root, sha) {
  try {
    return git(root, ["log", "-1", "--format=%s", sha]).trim();
  } catch {
    return "";
  }
}

/**
 * 读 develop 的 reflog（git log -g），返回【已落地 develop 的】直接提交（action = `commit` 前缀）。
 * 每条：{sha, subject, action, epoch(committer), files}。files 逐个 `git diff` 取。
 *
 * 关键：只报【reachable from develop】的直接提交——一次直接提交后又被 reset 走（abandoned）的
 * commit 从未成为 develop 历史的一部分，不算绕过（mutation-case RESTORE 正是 reset 走代码提交）。
 * baseline 用 `git rev-list <baseline>..develop` 一次取「基线后已落地的 commit 集」（一条命令同时
 * 完成 reachability + baseline 过滤，而不是逐条 merge-base）。reflog 不可读 / 无 reflog
 * （fresh clone）⇒ 返回 null（调用方据此 NOT-EVALUATED）。
 */
export function gitReflogDirectCommits(root, develop, baseline) {
  let out;
  try {
    out = git(root, ["log", "-g", "--format=%H%x09%gs", develop]);
  } catch {
    return null;
  }
  const entries = out.split("\n").filter(Boolean);
  if (entries.length === 0) return null; // no reflog — cannot tell direct from ff (3b: 读不懂 ≠ 合格)
  // reachable set：基线后（或无基线 = 全史）已落地 develop 的 commit。空集合（baseline==develop）
  // 是合法的「无新直接提交」——rev-list 失败才 NOT-EVALUATED。
  let reachable;
  try {
    const revs = baseline
      ? git(root, ["rev-list", `${baseline}..${develop}`])
      : git(root, ["rev-list", develop]);
    reachable = new Set(revs.split("\n").map((s) => s.trim()).filter(Boolean));
  } catch {
    return null;
  }
  const commits = [];
  for (const line of entries) {
    const [sha, gs] = line.split("\t");
    if (!sha || !gs) continue;
    if (!reachable.has(sha)) continue; // 未落地 develop（reset 走 / 在基线外）⇒ 不算
    const m = gs.match(/^([a-z() ]+?):\s*(.*)$/);
    if (!m) continue;
    const action = m[1].trim();
    if (!action.startsWith("commit")) continue; // 只看 reflog `commit:`（含 amend / merge）
    const subject = m[2] ?? "";
    const files = gitCommitFiles(root, sha);
    if (files === null) continue; // root commit / unreadable — skip (can't diff)
    const epoch = gitCommitEpoch(root, sha);
    if (epoch === null) continue;
    commits.push({ sha, subject, action, epoch, files });
  }
  return commits;
}

function readJsonlLines(file) {
  if (!fs.existsSync(file)) return null;
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { out.push({ __unparseable: true }); }
  }
  return out;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `direct-to-develop-bypass-check.ts — 直接提交 develop 绕过全部 fan-in 机件的检测器
(tasks/gap-direct-to-develop-bypasses-fan-in-gates)

判定（AC1）：直接提交 develop ∧ 触及代码/断言面 ∧ 无 ff-lock 时间窗事件 ⇒ RED。
  · 直接提交 = develop reflog action 为 \`commit\`（fan-in 落地是 \`merge task/<id>: Fast-forward\`）
  · 代码/断言面 = 改动文件不落在设计内排除集（记账/转向/遥测面 + manager 独占 + 基础设施 +
    热修 fan-in 机件本身；头注释维护注记 + 任务体记录——denominator 谓词 25 vs 30 差异就在排除集）
  · ff-lock 时间窗 = commit 落在 fan-in-merge-lock-events.jsonl 某 acquire→release 区间内 ⇒ 不报

Usage:
  node --experimental-strip-types direct-to-develop-bypass-check.ts [--root <dir>]
      [--develop <ref>] [--baseline <ref>] [--lock-events <file>] [--commits <csv>]
      [--json] [--help]

  --root <dir>         repo root (default: cwd). develop reflog + lock events resolve under it.
  --develop <ref>      the merge-target ref to scan (default: develop)
  --baseline <ref>     ONLY direct commits strictly AFTER this ref are scanned (enforcement
                       boundary — historical debt is documented, not re-scanned). Without it the
                       full develop reflog is scanned (audit mode; historical direct commits RED).
  --lock-events <file> the fan-in-ff-merge.sh lock-event log (default <root>/.quay/
                       fan-in-merge-lock-events.jsonl). Lock events unpaired ⇒ the window
                       sub-check is NOT-EVALUATED (never conflated with green, 硬规则 3b).
  --commits <csv>      replay: scan EXACTLY these commit shas (reads files+epoch from git;
                       bypasses reflog scanning). The real-sample replay seam (AC3).
  --json               machine-readable output { evaluated, ok, violations:[...], ... }
  --help               this help

Exit codes:
  0  PASS or NOT-EVALUATED (read \`evaluated\` — false = could not judge, never conflated with green)
  1  RED — a direct commit to develop bypasses the fan-in mechanism
  2  usage / environment error`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const develop = getArgValue(args, "--develop") ?? "develop";
  const baseline = getArgValue(args, "--baseline");
  const lockEventsFile = path.resolve(getArgValue(args, "--lock-events") ?? path.join(root, ".quay", "fan-in-merge-lock-events.jsonl"));
  const commitsArg = getArgValue(args, "--commits");
  const asJson = args.includes("--json");

  let commits = null;
  let lockHoldIntervals = null;
  let lockSubEvaluated = false;
  let lockSubReason = "";

  // ── 收集直接提交（reflog 扫描 或 --commits 回放）────────────────────────────────────────────
  if (commitsArg !== undefined) {
    const shas = commitsArg.split(",").map((s) => s.trim()).filter(Boolean);
    commits = shas.map((sha) => {
      const files = gitCommitFiles(root, sha);
      const epoch = gitCommitEpoch(root, sha);
      if (files === null || epoch === null) return null;
      return { sha, subject: gitCommitSubject(root, sha), action: "commit", epoch, files };
    }).filter(Boolean);
    if (commits.length === 0) {
      process.stderr.write(`direct-to-develop-bypass-check: --commits resolved to 0 readable commits (shas: ${commitsArg})\n`);
      return 2;
    }
  } else {
    commits = gitReflogDirectCommits(root, develop, baseline);
    if (commits === null) {
      const result = {
        evaluated: false,
        ok: true,
        reason: "reflog-unreadable (NOT-EVALUATED)",
        checks: [{ check: "direct-commit-bypass", evaluated: false, ok: true, reason: "reflog-unreadable" }],
      };
      if (asJson) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      else console.log(`direct-to-develop-bypass-check: evaluated=false ok=true (${result.reason})`);
      return 0;
    }
  }

  // ── ff-lock 时间窗 ────────────────────────────────────────────────────────────────────────────
  // ⚠️ 缺失文件 = 「从未有过锁持」（可读的空状态），不是「读不懂」——full-suite 的 verify worktree
  // 没有 .quay/ 运行时状态，若把缺失当 NOT-EVALUATED，检测器在 full-suite 路径永远给不出硬结论。
  // reflog 的 `commit:` action 已是「直接提交」的充分主信号；锁窗只是保守豁免（毫秒级、几乎从不命中），
  // 数据缺失时豁免空转（vacuous）。只有「文件在但读不懂」（malformed/unpaired）才是 3b 的 NOT-EVALUATED。
  const events = readJsonlLines(lockEventsFile);
  if (events === null) {
    lockHoldIntervals = [];
    lockSubEvaluated = true;
    lockSubReason = "no-lock-events (vacuous: no lock holds)";
  } else if (events.some((e) => e && e.__unparseable)) {
    lockSubReason = "malformed-lock-events (NOT-EVALUATED)";
  } else {
    const { intervals, malformed } = buildLockHoldIntervals(events);
    if (malformed) {
      lockSubReason = "unpaired-lock-events (NOT-EVALUATED)";
    } else {
      lockHoldIntervals = intervals;
      lockSubEvaluated = true;
      lockSubReason = "lock-window-evaluated";
    }
  }

  const verdict = checkDirectCommits(commits, lockHoldIntervals);

  // ── 硬判定 / NOT-EVALUATED 裁定（硬规则 3b：读不懂输入不得返回与合格同形的值）──────────────
  // RED = 直接提交 ∧ 代码/断言面 ∧ 已确认不在锁窗内（锁窗需可评估）。
  // 锁窗口读不出 且 存在代码面直接提交 ⇒ NOT-EVALUATED（distinct value）——既非绿（不能把疑似
  // 违规洗成合格）也非红（无法确认「不在锁窗内」）。锁窗口读不出 且 无代码面直接提交 ⇒ PASS
  // （没有任何候选，锁窗与之无关）。
  let evaluated, ok, reason;
  // commits 已成功收集（reflog 可读 / --commits 已解析）⇒ 扫描本身是评估，空的扫描范围 = 可读的空
  // 结果（evaluated:true），不是「读不懂」——「读不懂」只发生在 reflog 不可读（早退）或锁窗 malformed。
  const codeSurfaceCandidates = verdict.classified.filter((c) => c.codeSurfaceFiles.length > 0);
  if (codeSurfaceCandidates.length === 0) {
    evaluated = true;
    ok = true;
    reason = verdict.totalCommits === 0 ? "no-direct-commits-in-range" : "no-code-surface-direct-commits";
  } else if (!lockSubEvaluated) {
    evaluated = false;
    ok = true;
    reason = "code-surface-direct-commits-but-lock-window-not-evaluated";
  } else {
    evaluated = true;
    ok = verdict.violations.length === 0;
    reason = ok ? "pass" : "direct-commit-bypasses-fan-in";
  }

  const result = {
    evaluated,
    ok,
    reason,
    baseline: baseline ?? null,
    develop,
    denominator: {
      totalDirectCommits: verdict.totalCommits,
      codeSurfaceCommits: verdict.codeSurfaceCommits,
      designInternalCommits: verdict.designInternalCommits,
      inLockWindowCommits: verdict.inLockWindowCommits,
      predicate: "design-internal exclusion set (see header / task body): tasks/ docs/ orchestration/ adr/ .quay/ plugin/loop/ measurements/ milestones/ .claude/ plugin/skills/manager/ CLAUDE.md .gitignore .gitattributes .npmrc .github/ plugin/scripts/fan-in-* plugin/test/fan-in-*",
    },
    lockWindow: { evaluated: lockSubEvaluated, reason: lockSubReason },
    candidates: codeSurfaceCandidates.map((c) => ({
      sha: c.sha,
      subject: c.subject,
      codeSurfaceFiles: c.codeSurfaceFiles,
      inLockWindow: c.inLockWindow,
      confirmedBypass: c.bypass,
    })),
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    console.log(`direct-to-develop-bypass-check: evaluated=${evaluated} ok=${ok} (${reason})`);
    console.log(`  denominator: total=${verdict.totalCommits} code-surface=${verdict.codeSurfaceCommits} design-internal=${verdict.designInternalCommits} in-lock-window=${verdict.inLockWindowCommits}`);
    console.log(`  lock-window: evaluated=${lockSubEvaluated} (${lockSubReason})`);
    for (const c of codeSurfaceCandidates) {
      const tag = c.bypass ? "RED" : c.inLockWindow ? "SKIP(in-lock-window)" : "design-internal";
      console.log(`  ${tag} ${c.sha} — ${c.subject}`);
      for (const f of c.codeSurfaceFiles) console.log(`      ${f}`);
    }
    if (verdict.totalCommits === 0) console.log("  (no direct commits in scan range)");
  }
  return evaluated && !ok ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "direct-to-develop-bypass-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
