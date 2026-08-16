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
//   AC65 授权直修 carve-out（tasks/gap-ac65-direct-fix-vs-bypass-detector-conflict）：AC65
//   （orchestrator-tick-core.md:105）授权 outer「一条命令可验 ⇒ 可直接修 plugin/scripts」——与本检测器的
//   「plugin/scripts 直提交即 bypass」结构性冲突（首次具名样本 02b2b2fc）。修法 = 两谓词（inner 2026-08-15
//   重写，替换 sha 表——硬规则4：手抄表是回显，不参与判定）：
//     ① 声明谓词 `/^AC65:/m`——提交信息中 `AC65:` 开头的行（outer 声明/范围标记）。
//     ② 验证产物谓词 `/AC65-Verified:/m`——提交信息含 `AC65-Verified: <命令> => <输出摘要>` 行。
//     ac65Authorized = ① ∧ ②（两谓词独立，⛔ 声明行含 "AC65" 但不含 "AC65-Verified:"，旧 `/AC65/` 会按构造
//     使声明=免检，已弃）。声明 ∧ 无验证产物 ⇒ RED（判据3「验证输出必须贴出」首次有执行体）；无声明
//     code-surface 直投 ⇒ RED（现状保留）。⛔ 不是 plugin/scripts/* 文件名豁免（掩真直投，manager 已拒）。
//   ⛔ 02b2b2fc legacy 形态容忍：其消息正文含 `AC65 一条命令验证：<实际输出>`（旧声明+验证合一短语，无
//   `AC65-Verified:` 前缀但有实际验证输出）⇒ 声明/验证两谓词都容忍该 legacy 形态，02b2b2fc 重判为
//   ac65Authorized。不补写历史提交、不改历史消息。
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

// ── AC65 授权直修 carve-out（tasks/gap-ac65-direct-fix-vs-bypass-detector-conflict）─────────────
//
// 冲突（结构性，非发生率）：AC65（orchestrator-tick-core.md:105）授权 outer「一条命令可验 ⇒ 可直接修
// plugin/scripts 等」，而本检测器把 plugin/scripts/* 判为代码面 ⇒ 每次 AC65 直修都被标 bypass（首次
// 具名样本 02b2b2fc，round200 红 + parser fan-in 阻断）。两条规则的意图都保留：
//   · AC65：小改动（一条命令可验）不该为走全量 fan-in 而付出整轮验证代价——验证面允许快速直修。
//   · bypass-detector：代码面提交必须过审计链——不许静默直投 develop。
// 修法 = 【两谓词】（inner 2026-08-15 重写，替换 sha 表——硬规则4：手抄表是回显，不参与判定）：
//   · 声明谓词 `/^AC65:/m`（`AC65:` 开头的行——outer 声明/范围标记）。
//   · 验证产物谓词 `/AC65-Verified:/m`（`AC65-Verified: <命令> => <输出摘要>`）。
//   · ac65Authorized = 声明 ∧ 验证产物（两谓词独立——⛔ 声明行含 "AC65" 但不含 "AC65-Verified:"，
//     旧 `/AC65/` 会按构造使声明=免检，已弃）。声明 ∧ 无验证产物 ⇒ RED（判据3「验证输出必须贴出」执行体）；
//     无声明 code-surface 直投 ⇒ RED。⛔ 不是 plugin/scripts/* 文件名豁免（掩真直投，manager 已拒）。
//   · 02b2b2fc legacy 形态（`AC65 一条命令验证：<实际输出>`——旧声明+验证合一短语）由声明/验证两谓词
//     共同容忍，重判为 ac65Authorized（不补写历史、不改历史消息）。判定完全由提交消息承担，不依赖
//     `AC65_AUTHORIZED_DIRECT_FIXES`（该表降级为纯展示）。
/**
 * AC65 授权直修样本展示表——【已退役：纯展示，不参与判定】（inner 2026-08-15 两谓词重写后，判定完全由
 * 提交消息承担——`commitHasAc65Declaration` ∧ `commitHasAc65Verification`；硬规则4：手抄 sha 表是回显，
 * 不能当判定依据）。保留作历史样本 02b2b2fc 的可见记录。
 */
export const AC65_AUTHORIZED_DIRECT_FIXES: { sha: string; evidence: string }[] = [
  {
    sha: "02b2b2fc",
    evidence:
      "AC65 一条命令验证：A0 outer.ticklog quay 现含 A11+ 内容（full length 676 > 200）；新增测试（full 完整行 + 默认截断向后兼容），24/24 绿。",
  },
];

/** AC65 声明谓词——提交信息中 `AC65:` 开头的行（outer 按 AC65 授权直修的声明/范围标记）。PURE。 */
export const AC65_DECLARATION_RE = /^AC65:/m;

/** AC65 验证产物谓词——提交信息含 `AC65-Verified: <命令> => <输出摘要>` 行。⛔ 独立于声明谓词：只匹配
 *  `AC65-Verified:` 这个具体前缀，声明行（含 "AC65"）不会被它字面满足。PURE。 */
export const AC65_VERIFICATION_RE = /AC65-Verified:/m;

/** 02b2b2fc legacy 形态：`AC65 一条命令验证：<实际输出>`——旧声明+验证合一短语，无 `AC65-Verified:` 前缀
 *  但有实际验证输出。声明/验证两谓词都容忍它，使 02b2b2fc 重判为 ac65Authorized（不补写历史）。PURE。 */
export const AC65_LEGACY_RE = /AC65 一条命令验证/;

/** 一条 commit sha 是否命中 AC65 展示表（前缀匹配——git 可能给全量或缩写 sha）。纯展示，不参与判定。PURE。 */
export function findAc65Entry(sha, table = AC65_AUTHORIZED_DIRECT_FIXES) {
  if (!sha) return undefined;
  return (table ?? []).find((e) => e && sha.startsWith(e.sha));
}

/** 提交消息是否携带 AC65 声明（`^AC65:` 行，或 legacy `AC65 一条命令验证` 合一短语）。PURE。 */
export function commitHasAc65Declaration(message) {
  const s = String(message ?? "");
  return AC65_DECLARATION_RE.test(s) || AC65_LEGACY_RE.test(s);
}

/** 提交消息是否携带 AC65 验证产物（`AC65-Verified:` 行，或 legacy `AC65 一条命令验证` 合一短语）。PURE。 */
export function commitHasAc65Verification(message) {
  const s = String(message ?? "");
  return AC65_VERIFICATION_RE.test(s) || AC65_LEGACY_RE.test(s);
}

/** 提取验证产物行（ac65Evidence 展示面）——新形态自 `AC65-Verified:` 到行尾，或 legacy 自 `AC65 一条命令验证`
 *  到行尾。无匹配返回 null。PURE。 */
export function extractAc65Evidence(message) {
  const s = String(message ?? "");
  const m = s.match(/AC65-Verified:.*$/m);
  if (m) return m[0].trim();
  const lm = s.match(/AC65 一条命令验证.*$/m);
  if (lm) return lm[0].trim();
  return null;
}

// ── Ruled-historical one-off 豁免（tasks/gap-direct-to-develop-ruled-historical-cddc55e2）──────────
//
// manager 2026-08-15 裁定：cddc55e2 直接提交 develop（inner 紧急回退自己刚造成的破坏）是 ruled one-off——
// 形态 = ruled 豁免 + 定案理由，非 AC65 sha 表；⛔ 判据3（声明∧无验证⇒红）不因此松动。先例 =
// fan-in-workflow-check.ts 的 `RULED_HISTORICAL_GAPS`（86a7c932 同形）。
//   · 入表提交分类为 `ruledHistorical`（可见 + 可审计，非静默掩盖）——独立分类，非 bypass、非 ac65Authorized
//     （两类在 detector 输出里可区分：`AC65-AUTHORIZED` vs `RULED-HISTORICAL`）。
//   · 豁免表【有界】：只覆盖这里列出的 ruled 案例；任一未入表的新直投仍红（能取假——豁免不能被静默扩展）。
//   · ⛔ 不改 sha 退役表机制（AC65 两谓词保持）；判据3 保持。
export const RULED_HISTORICAL_COMMITS: { sha: string; reason: string }[] = [
  {
    sha: "cddc55e2",
    reason:
      "inner 紧急回退自己刚造成的破坏——cddc55e2 回退的 232e4171 是 inner 在双副本漂移上的试错；" +
      "非偷懒绕过 fan-in，不属于 detector 要抓的那一类。manager 2026-08-15 裁定 ruled one-off（形态=ruled 豁免+定案理由，非 AC65 sha 表）",
  },
  {
    sha: "f9577da1",
    reason:
      "inner AC81 锚重建（OOM 死会话 ff96ad7e → 0ccb57cf）——CronList 为空判据① 假，按 AC81 清扫重建；" +
      "prompt sha256 与正本逐字节一致（828B/336ab987）。inner 紧急恢复自己刚发生的 OOM 死会话（同 cddc55e2 类：紧急直投，非偷懒绕过 fan-in）；" +
      "manager 2026-08-16 06:46Z tick-log 已识其为「历史直提」候选（round 214 分诊：bypass-check 候选含 f9577da1 inner AC81 重建 / 34ecfaa9）；" +
      "裁定 ruled one-off（形态=ruled 豁免+定案理由，非 AC65 sha 表，先例 cddc55e2）。",
  },
  {
    sha: "08e8ec55",
    reason:
      "release 0.5.0 版本 bump——人 2026-08-16 16:2xZ 逐字裁定的发布操作（bump→push→release），非 outer 自发起代码直改；" +
      "AC65 管自查直修不管执行人指令，outer 2026-08-16 16:3xZ 裁定 ruled one-off（先例 cddc55e2/f9577da1）。",
  },
  {
    sha: "f70507b6",
    reason:
      "inner 为 unblock AC1b develop 基线轮直提 develop——数据基线机制修正（dispatch-record-fingerprint-reason-check 加 DIR-103-B 豁免，gap-ac84 backfill 是 runtime 数据 gitignored 不需提交）。" +
      "⚠️ inner 直提 develop 是错的（应走 fan-in），教训已记；manager 2026-08-16 18:5xZ 裁定 ruled one-off 放行不 revert。" +
      "⛔ 豁免实现待收紧：LEGACY_NO_FINGERPRINT_TASK_IDS 按 taskId 判不带时间边界，注释自称「前向不追溯」代码给不出——收紧为 taskId ∧ ts<2026-08-16 + 补负控制（DIR-103-B 今天之后缺 fingerprint 必须红）。",
  },
  {
    sha: "8dfd2967",
    reason:
      "ruling-add 提交自身豁免——8dfd2967 把 f70507b6 加入 ruled 表，本身是 inner 直接提交（改 checker）⇒ bypass 自指死锁（给 8dfd2967 加 ruled = 又一个直接提交）。" +
      "解：8dfd2967 入表经 fan-in 正规 land（lock-window 豁免本任务提交）。inner 直提 develop 是错的（应走 fan-in），教训已记；outer 2026-08-16 19:0xZ 裁定 ruled one-off（先例 f70507b6）。",
  },
];

/** 一条 commit sha 是否命中 ruled 豁免表（前缀匹配——git 可能给全量或缩写 sha）。PURE。 */
export function findRuledHistoricalEntry(sha, table = RULED_HISTORICAL_COMMITS) {
  if (!sha) return undefined;
  return (table ?? []).find((e) => e && sha.startsWith(e.sha));
}

/** 一个直接提交的判定。PURE——测试注入 {sha, files, epoch, subject, message, action}。 */
export function classifyCommit(commit, lockHoldIntervals) {
  const files = Array.isArray(commit?.files) ? commit.files : [];
  const codeSurfaceFiles = files.filter((f) => !isDesignInternalPath(f));
  const inLockWindow =
    Array.isArray(lockHoldIntervals) &&
    typeof commit.epoch === "number" &&
    lockHoldIntervals.some((iv) => iv && iv.start <= commit.epoch && commit.epoch <= iv.end);
  const designInternal = codeSurfaceFiles.length === 0;
  // AC65 授权直修（两谓词，替换 sha 表——硬规则4）：声明（`^AC65:` 行或 legacy `AC65 一条命令验证`）
  // ∧ 验证产物（`AC65-Verified:` 行或 legacy）⇒ ac65Authorized（可见分类，非 bypass）。声明 ∧ 无验证产物
  // ⇒ 不豁免（判据3「验证输出必须贴出」执行体——旧 `/AC65/` 会按构造使声明=免检，已弃）；无声明 ⇒ 真直投
  // 仍红。判定完全由提交消息承担，不依赖手抄 sha 表。
  const ac65Authorized =
    commitHasAc65Declaration(commit?.message) && commitHasAc65Verification(commit?.message);
  // Ruled-historical 豁免（manager 裁定 one-off，先例 RULED_HISTORICAL_GAPS）：sha 命中 ruled 表 ⇒
  // ruledHistorical=true（独立分类，非 bypass、非 ac65Authorized——两类在输出里可区分）。豁免表有界，
  // 非入表新直投仍红（能取假）。
  const ruledEntry = findRuledHistoricalEntry(commit?.sha);
  const ruledHistorical = Boolean(ruledEntry);
  return {
    sha: commit?.sha ?? "?",
    subject: commit?.subject ?? "",
    action: commit?.action ?? "commit",
    epoch: commit?.epoch ?? null,
    files,
    codeSurfaceFiles,
    designInternal,
    inLockWindow: Boolean(inLockWindow),
    ac65Authorized,
    ac65Evidence: ac65Authorized ? extractAc65Evidence(commit?.message) : null,
    ruledHistorical,
    ruledReason: ruledEntry?.reason ?? null,
    bypass: !designInternal && !inLockWindow && !ac65Authorized && !ruledHistorical,
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
  const ac65AuthorizedCommits = classified.filter((c) => c.ac65Authorized);
  const ruledHistoricalCommits = classified.filter((c) => c.ruledHistorical);
  return {
    violations,
    reason: violations.length > 0 ? "direct-commit-bypasses-fan-in" : "no-direct-bypass",
    totalCommits: classified.length,
    codeSurfaceCommits: codeSurfaceCommits.length,
    designInternalCommits: designInternalCommits.length,
    inLockWindowCommits: inLockWindowCommits.length,
    ac65AuthorizedCommits: ac65AuthorizedCommits.length,
    ruledHistoricalCommits: ruledHistoricalCommits.length,
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

/** 一条 commit 的相对改动文件（vs 第一父）。父不存在（root commit）返回 null。
 *  ⚠️ `-c core.quotepath=false`：git 默认对含非 ASCII 的文件名输出 C-quoted 形态
 *  （`"docs/.../Quay\346\224\271\350\277\233\347\211\210WebUI.dc.html"`），前导引号使 `^docs/`
 *  等排除正则失效 ⇒ design-internal 文件被误判为 code-surface（2fdb6e32 false-positive）。
 *  关闭 quotepath 让 `--name-only` 输出原始路径字节，`^docs/` 等排除恢复对非 ASCII 路径生效。
 *  （tasks/gap-direct-bypass-check-quoted-path-false-positive） */
export function gitCommitFiles(root, sha) {
  try {
    const out = git(root, ["-c", "core.quotepath=false", "diff", "--name-only", `${sha}^`, sha]);
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

/** 一条 commit 的完整消息（%B，subject + body）——AC65 验证证据（一条命令可验的引用）读取面。 */
function gitCommitMessage(root, sha) {
  try {
    return git(root, ["log", "-1", "--format=%B", sha]).trim();
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
    const message = gitCommitMessage(root, sha); // AC65 验证证据读取面
    commits.push({ sha, subject, action, epoch, files, message });
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
  · AC65 授权直修 = 提交消息携带 AC65 声明（\`^AC65:\` 行）∧ 验证产物（\`AC65-Verified:\` 行）⇒ 报为
    ac65AuthorizedDirectFix（可见分类，非 bypass）——⛔ 非 plugin/scripts/* 文件名豁免；声明∧无验证产物
    （判据3）或无声明 code-surface 直投仍红；02b2b2fc legacy 形态（AC65 一条命令验证：<输出>）容忍
  · Ruled-historical 豁免 = sha 前缀命中 RULED_HISTORICAL_COMMITS（manager 裁定 one-off，先例
    fan-in-workflow-check RULED_HISTORICAL_GAPS）⇒ 报为 ruledHistorical（可见分类，非 bypass、非
    ac65Authorized——两类输出可区分：AC65-AUTHORIZED vs RULED-HISTORICAL）。豁免表有界，非入表新直投仍红

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
      return { sha, subject: gitCommitSubject(root, sha), action: "commit", epoch, files, message: gitCommitMessage(root, sha) };
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
  // 需要锁窗判定的候选 = 代码面 ∧ 非 AC65 授权直修 ∧ 非 ruled-historical 豁免（两者都是无条件豁免，
  // 不依赖锁窗）。
  const needLockWindow = codeSurfaceCandidates.some((c) => !c.ac65Authorized && !c.ruledHistorical);
  if (codeSurfaceCandidates.length === 0) {
    evaluated = true;
    ok = true;
    reason = verdict.totalCommits === 0 ? "no-direct-commits-in-range" : "no-code-surface-direct-commits";
  } else if (!needLockWindow) {
    // 所有代码面直接提交都是 AC65 授权直修 或 ruled-historical 豁免（可见+可审计 carve-out）——无 bypass
    // 可能。全 AC65 时保持既有 reason（既有测试断言 "ac65-authorized-direct-fix-only"）；含 ruled 时给
    // 可区分的 reason。
    const allAc65 = codeSurfaceCandidates.every((c) => c.ac65Authorized);
    evaluated = true;
    ok = true;
    reason = allAc65 ? "ac65-authorized-direct-fix-only" : "ac65-authorized-or-ruled-historical-only";
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
      ac65AuthorizedCommits: verdict.ac65AuthorizedCommits,
      ruledHistoricalCommits: verdict.ruledHistoricalCommits,
      predicate: "design-internal exclusion set (see header / task body): tasks/ docs/ orchestration/ adr/ .quay/ plugin/loop/ measurements/ milestones/ .claude/ plugin/skills/manager/ CLAUDE.md .gitignore .gitattributes .npmrc .github/ plugin/scripts/fan-in-* plugin/test/fan-in-*",
      ac65CarveOut: "AC65-authorized direct-fix (two predicates; sha table retired to display-only): commit message has AC65 declaration (/^AC65:/m) AND verification artifact (/AC65-Verified:/m) ⇒ ac65AuthorizedDirectFix (visible, NOT bypass); declaration with no verification artifact ⇒ RED (criterion-3); no declaration code-surface direct commit ⇒ RED. Legacy 02b2b2fc form (AC65 一条命令验证：<output>) tolerated. NOT a plugin/scripts/* filename exemption.",
      ruledHistoricalCarveOut: "RULED_HISTORICAL_COMMITS one-off exemption (manager 2026-08-15 ruling, tasks/gap-direct-to-develop-ruled-historical-cddc55e2): sha prefix match on the bounded ruled table ⇒ ruledHistorical (visible, NOT bypass, NOT ac65Authorized); any non-table direct commit still RED (exemption cannot be silently extended). Criterion-3 (declaration without verification ⇒ RED) unchanged.",
    },
    lockWindow: { evaluated: lockSubEvaluated, reason: lockSubReason },
    candidates: codeSurfaceCandidates.map((c) => ({
      sha: c.sha,
      subject: c.subject,
      codeSurfaceFiles: c.codeSurfaceFiles,
      inLockWindow: c.inLockWindow,
      confirmedBypass: c.bypass,
      ac65Authorized: c.ac65Authorized,
      ac65Evidence: c.ac65Evidence,
      ruledHistorical: c.ruledHistorical,
      ruledReason: c.ruledReason,
    })),
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    console.log(`direct-to-develop-bypass-check: evaluated=${evaluated} ok=${ok} (${reason})`);
    console.log(`  denominator: total=${verdict.totalCommits} code-surface=${verdict.codeSurfaceCommits} design-internal=${verdict.designInternalCommits} in-lock-window=${verdict.inLockWindowCommits} ac65-authorized=${verdict.ac65AuthorizedCommits} ruled-historical=${verdict.ruledHistoricalCommits}`);
    console.log(`  lock-window: evaluated=${lockSubEvaluated} (${lockSubReason})`);
    for (const c of codeSurfaceCandidates) {
      const tag = c.ruledHistorical ? "RULED-HISTORICAL" : c.bypass ? "RED" : c.ac65Authorized ? "AC65-AUTHORIZED" : c.inLockWindow ? "SKIP(in-lock-window)" : "design-internal";
      console.log(`  ${tag} ${c.sha} — ${c.subject}`);
      for (const f of c.codeSurfaceFiles) console.log(`      ${f}`);
      if (c.ruledHistorical && c.ruledReason) console.log(`      ruled reason: ${c.ruledReason}`);
      if (c.ac65Authorized && c.ac65Evidence) console.log(`      evidence: ${c.ac65Evidence}`);
    }
    if (verdict.totalCommits === 0) console.log("  (no direct commits in scan range)");
  }
  return evaluated && !ok ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "direct-to-develop-bypass-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
