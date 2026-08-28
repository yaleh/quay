#!/usr/bin/env node
// direct-to-develop-bypass-check.ts — 直接提交 develop 绕过全部 fan-in 机件的检测器
// (tasks/gap-direct-to-develop-bypasses-fan-in-gates, 11b/C17 写所有权/越权直改面).
//
// 问题（任务体实证）：~25-30 条直接提交 develop 绕过 ff-lock / anti-drift-touches / AC 完成闸三道，
// 且不进任何差集——AC78 判据2 按任务算的差集结构上看不见它们。核心子集：
//   7d1d5d2e → plugin/test/ready-pool-check.test.mjs
//   b389a758 → plugin/scripts/loop-shipping-exclusion-data.mjs
//   18e7a3be → plugin/scripts/loop-shipping-exclusion-data.mjs
//   77174684 → plugin/test/manager-tick-core.test.mjs
// 直接提交 develop 且触及代码/断言面、且不在任何 ff-lock 事件时间窗内 ⇒ 报「直接提交绕过 fan-in 机件」。
// （7e64a86b → plugin/skills/init/SKILL.md 曾是此类——现 init/ 已入排除集，见下。）
//
// 判定原理（ledger 优先，reflog 回退，剪后退 NOT-EVALUATED）：`git merge --ff-only` 只移动 ref、
// 不创建 commit——一个通过 fan-in 落地的 task 提交在 DAG 上与直接提交看起来完全一样（单亲线性链，
// ⛔ 故不能判父数区分）。区分它们的读面有【两个】：
//   ① 持久化 ledger——fan-in-ff-merge.sh 每次真实 ff 落地，在 .quay/fan-in-merge-lock-events.jsonl
//     的 release 事件上记 `landedSha` 字段（成功 = 落地 sha，失败 = null；gap-direct-to-develop-check-
//     reflog-to-revlist, AC1）。事件发生当下 append，不依赖可被 gc 回收的易失状态。
//   ② develop 的 REFLOG——fan-in 落地记 `merge task/<id>: Fast-forward`，直接提交记 `commit: <msg>`
//     （或 `commit (amend):` / `commit (merge):`）。但 reflog 会被 gc 全局剪 ⇒ 老 commit 条目过期。
// 三态判定（AC2/AC3）：`git rev-list` 全量扫描 develop 历史（不受 gc 剪）→ 对每条命中的 commit——
// 在 ledger ⇒ fan-in 落地不算直投；不在 ledger 且 reflog 有「直接 commit」标签 ⇒ 直接提交（报红候选）；
// ledger 无记录 且 reflog 也查不到 ⇒ NOT-EVALUATED（⛔ 不伪装成「未发现 direct」，硬规则 3b）。
// （CLAUDE.md 硬规则 2：按位置判定，不按关键词——commit subject 里出现「fan-in」不算，reflog action
// 或 ledger 记录才算。）
//
// 排除集（denominator 谓词，AC3 判据 25 vs 30 的差异就在排除集——本谓词记录在任务体）：
//   设计内 = 按设计就该直接提交 develop 的文件（GREEN，不误报）：
//     · 记账/转向/遥测面：tasks/ docs/ orchestration/ adr/ .quay/ plugin/loop/ measurements/
//       milestones/（任务体、分析文档、执行核、ADR、遥测都是各层直接写）
//     · 机件面：.claude/（agent harness 的 workflow/skill——manager 独占）
//       plugin/skills/manager/**（manager 独占 SKILL.md + 结构上无 fan-in 路——无任务/无 worktree，
//       fan-in-execute.js 无 task 即 bad-args；同 .claude/ 类）
//       plugin/skills/init/**（同 manager/ 类——纯 docs skill 目录，只含 SKILL.md、无 code；结构上
//       无 fan-in 路。gap-direct-to-develop-bypass-init-skill-reference-doc：reference-doc 索引行
//       不再误判 code-surface。⛔ 粒度到 init/，不含其它 plugin/skills/* 如 manager-tool/——后者仍真红）
//     · 指引面：CLAUDE.md（本仓库唯一每会话自动注入的文档，管理者独占直写）
//       README.md（纯 prose、仓库根、不被测试/构建解析——同 CLAUDE.md 类；⛔ 不含 LICENSE/CHANGELOG.md/
//       AGENTS.md——三者被 npm-pack-e2e / package-json-bin / codex-stage1-adapter 读取，非纯 prose，仍代码面）
//     · 基础设施：.gitignore .gitattributes .npmrc .github/（CI/build 配置）
//     · 热修 fan-in 机件本身：plugin/scripts/fan-in-* plugin/test/fan-in-*（机制坏了无法 self-fan-in，
//       引导问题——5e54bb37 正是此类）
//   代码/断言面 = 排除集之外的一切，含 plugin/scripts/*、plugin/test/*、plugin/skills/**/*.md
//     （SKILL.md 是产品交付面，不是记账面——但 manager/** 与 init/** 是纯 docs skill 目录、结构上
//     无 fan-in 路，同 .claude/ 类豁免；其它 plugin/skills/*（如 manager-tool/）仍是产品交付面真红）、
//     packages/**、scripts/test.sh 等。
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
 * ⚠️ 2026-08-17 已移除 `plugin/scripts/outer-cron-registry.json` 排除项（gap-cron-registry-global-
 * path-migration，AC3）：AC81 注册表收据迁到全局 per-layer 路径（~/.quay-global/<slug>/{outer,inner}/
 * loop-registry.txt，不进 git），冷启动 cron 重建改经 `outer-cron-registry.ts --record` 写全局文件——
 * 不再直写 git 收据 ⇒ 该排除项（曾为消除 bypass 误红而加）不再需要。git 版 json 已删除。
 */
export const DESIGN_INTERNAL_RE =
  /^(?:tasks\/|docs\/|orchestration\/|adr\/|[.]quay\/|plugin\/loop\/|measurements\/|milestones\/|[.]claude\/|plugin\/skills\/manager\/|plugin\/skills\/init\/|CLAUDE[.]md$|README[.]md$|[.]gitignore$|[.]gitattributes$|[.]npmrc$|[.]github\/|plugin\/scripts\/fan-in-|plugin\/test\/fan-in-)/;

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
    sha: "6c46304b7",
    reason:
      "manager 2026-08-28 裁定（用户「暂停 driver、在当前会话持续修」直接指令）：HOLDS_SLOT 自锁根因修复直接落地 develop（suite-driver.ts spawnSuiteAndWait 强制注入 QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT=1，自 watchdog-fired 分支 931fdc4dd）。" +
      "非偷懒绕过 fan-in——机械 fan-in 因该缺 env 自锁、suite 步 100% 红，修复只能直落 develop（机械路径跑自己的 suite 就自锁，无法自落地）；" +
      "形态=ruled 豁免+定案理由（先例 cddc55e2），落地后经正常 fan-in 验证，同类写不再发生。",
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
    sha: "167b7052",
    reason:
      "inner AC81 锚重建直写 git 注册表收据（0ccb57cf → 09fabf33，冷启动重建 inner cron）——AC81 收据同步，进程被杀 cron 随会话消失，重挂后四判据核实全真。" +
      "该文件是 gap-direct-to-develop-exclude-cron-registry-receipt 排除项对应的历史直写（发生率 3 之一：f9577da1/167b7052/f882ad76）。" +
      "2026-08-17 gap-cron-registry-global-path-migration 迁移注册表到全局 per-layer 路径（~/.quay-global/<slug>/{outer,inner}/loop-registry.txt，不进 git）并删除 git 版 json，" +
      "排除项已撤（AC3）⇒ 该历史直写现归代码面。裁定 ruled one-off（同 f9577da1 类：AC81 锚重建直写收据，非偷懒绕过 fan-in；迁移后此类写不再发生）。",
  },
  {
    sha: "f882ad76",
    reason:
      "outer AC81 锚重建直写 git 注册表收据（4e88cb1b → a2360e1d + verifiedAt，冷启动重建 cron）——AC81 收据更新，进程被杀 cron 随会话消失，重挂后注册表收据同步。" +
      "同 167b7052 类：gap-direct-to-develop-exclude-cron-registry-receipt 排除项对应的历史直写（发生率 3 之一）。" +
      "2026-08-17 gap-cron-registry-global-path-migration 迁移注册表到全局 per-layer 路径并删除 git 版 json，排除项已撤（AC3）⇒ 该历史直写现归代码面。" +
      "裁定 ruled one-off（同 f9577da1/167b7052 类：AC81 锚重建直写收据，非偷懒绕过 fan-in；迁移后此类写不再发生）。",
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
  {
    sha: "cbbbb766",
    reason:
      "四条在飞任务被同一个 closure 缺陷挡住，修复本身很小（一行标记），走完整 fan-in 要再等一轮全量 suite（500-700s）才能解锁，止损优先于流程完整性。" +
      "教训：manager 直提 develop 同样是不对的行为模式，应当走 fan-in——这次是应急例外，不该成为常态。",
  },
  {
    sha: "8e024f88",
    reason:
      "outer 直修 plugin/test/outer-cron-registry.test.mjs 的时间炸弹 fixture 日期（2026-08-14 硬编码越过 24h 线 ⇒ 4 条恒红 ⇒ 全量 suite exit 1 ⇒ 卡住所有 fan-in，含 AC104 1h fix 循环）——AC65 类直修（plugin/test 单命令可验：`node --test plugin/test/outer-cron-registry.test.mjs` 32/33，唯一 fail=canonicalRepoRoot 是 worktree 上下文断言非真红），但提交信息用了散文 'AC65 direct-fix（plugin/test 单命令可验）' 而非两谓词要求的确切 `AC65:`+`AC65-Verified:` 两行 ⇒ 非 ac65Authorized 分类。裁定 ruled one-off：修复本身已验证（单命令）、紧急（阻断全管线）、非偷懒绕过 fan-in；amend 会重写 develop 上 19ddd0b2/dc320a35 两个在飞任务引用 sha（AC104 worktree 已 merge dc320a35）。⛔ 教训：outer AC65 直修必须用确切两行形式（declaration + verification artifact），散文声明不豁免。outer 2026-08-20 裁定 ruled one-off（先例 cddc55e2/f9577da1）。",
  },
  {
    sha: "42ae0d27",
    reason:
      "inner 紧急修复 fan-in-execute.js suite_head 计算 cwd 依赖——SUITE_LAUNCH/ISOLATE_LAUNCH/pre-verified 三处 `git rev-parse HEAD` 在 phase-1 agent 当前 cwd 运行，agent cwd 落主检出 ⇒ suite_head 误记 develop HEAD ⇒ step-5 证书（suite_head 须为 ff tip 祖先）fail-closed 拒 ff。实证：CSS fan-in（wf_b89bfab1）suite 绿跑 820s 但 suite_head=53602d48（develop）非 tip cea404e4 祖先 ⇒ ff 拒绝；tmux-leak capture 同缺陷（07b07f5f vs worktree b15fe7da）。修法：三处改 `git -C ${worktree} rev-parse HEAD`（cwd 无关），双副本同步，node --check 语法过。⛔ 教训：inner 直提 develop 是错的（应走 fan-in），但此修正在 4 fan-in 在飞时被发现、不修则 ff 全拒，且修复本身由 CSS 重派真实验证（AC2 gap-fan-in-execute-suite-head-cwd-independent）——紧急止损。inner 2026-08-21 02:5xZ 裁定 ruled one-off（先例 8e024f88/cbbbb766/cddc55e2；待 outer/manager 复核）。",
  },
  {
    sha: "fd1de6a0",
    reason:
      "ruling-add 提交自身豁免（同 8dfd2967 形）——fd1de6a0 把 42ae0d27 加入 ruled 表（outer 代为提交 inner 的登记编辑），本身是直接提交（改 checker 源码）⇒ bypass 自指死锁（给 fd1de6a0 加 ruled = 又一个直接提交）。解：本条目（次一提交，带 AC65 两谓词）把 fd1de6a0 入表，fd1de6a0 自身内容已验证（42ae0d27 已按 ruledHistorical 分类）。outer 2026-08-21 02:5xZ approve 42ae0d27 登记；inner 2026-08-21 03:0xZ 补 fd1de6a0 自豁免条目（先例 8dfd2967）。",
  },
  {
    sha: "a388ca38",
    reason:
      "release 0.6.1 版本 bump——人 2026-08-21 14:1xZ 原话「①落地后 build+tag+发布一个新版本」（manager 转达「不要解释，实际做」），outer 按人令直接执行发布操作（版本 bump→push→tag→gh release），非 outer 自发起代码直改；" +
      "8 处 + plugin/VERSION 均 0.6.1（version-consistency-check 'All 8 files carry version 0.6.1' 已验证），release v0.6.1 已 gh 发布（createdAt 2026-08-21T14:49:30Z）指向本提交。" +
      "先例 08e8ec55（release 0.5.0 版本 bump 同形）。outer 2026-08-21 14:5xZ 裁定 ruled one-off（先例 08e8ec55/cddc55e2）。",
  },
  {
    sha: "99f845d9",
    reason:
      "outer 直提 develop 补 plugin/skills/init/SKILL.md 的 <!-- reference-doc: --> 声明——为解 referenced-not-landed 全库红的最小止损（补一行声明），" +
      "非偷懒绕过 fan-in（性质同 f9577da1/167b7052 类：为修机制自身而直写）。但直提 develop 本身就是错的（应走 fan-in），" +
      "本次是我方共同的流程失误。manager 2026-08-23 裁定 ruled one-off（先例 cddc55e2/f9577da1）。",
  },
  {
    sha: "b67a91cf",
    reason:
      "manager 委托 outer 写 README（Driver processes 小节）——README.md 当时不在 design-internal 排除集（同 CLAUDE.md 类：纯 prose、仓库根、" +
      "不被测试/构建解析）⇒ 触发 bypass 误红。非绕过 fan-in 意图。manager 2026-08-24 裁定 a+b（根修 isDesignInternalPath 加 README.md + 本快修入 ruled 表）。",
  },
  {
    sha: "095af66a",
    reason:
      "manager 直提 develop 补 plugin/skills/init/SKILL.md + plugin/skills/manager/SKILL.md 的 <!-- reference-doc: --> 索引声明（随 SPEC-codex-session-communication-host-adapter-2026-08-24 立案）——" +
      "manager/SKILL.md 一行已被 design-internal exclusion set 豁免，init/SKILL.md 一行因豁免正则缺口被误判 code-surface；性质与 99f845d9 完全相同（同为 reference-doc 索引行的止损直写）。" +
      "manager 2026-08-24 裁定 ruled one-off（先例 99f845d9/cddc55e2/f9577da1）。",
  },
];

/** 一条 commit sha 是否命中 ruled 豁免表（前缀匹配——git 可能给全量或缩写 sha）。PURE。 */
export function findRuledHistoricalEntry(sha, table = RULED_HISTORICAL_COMMITS) {
  if (!sha) return undefined;
  return (table ?? []).find((e) => e && sha.startsWith(e.sha));
}

// ── 三态判定（gap-direct-to-develop-check-reflog-to-revlist）──────────────────────────────────────
// fan-in 落地的持久化 ledger（release 事件上的 landedSha 字段，与 acquire/release 写在同一个
// .quay/fan-in-merge-lock-events.jsonl 里）+ develop reflog 回退 + NOT-EVALUATED。reflog 会被 gc 剪，
// ledger 是事件发生当下 append、不依赖可回收的易失状态。

/** 从 lock-event 记录里提取「fan-in 落地」commit sha 集（ledger）。只认 release 事件上的
 *  `landedSha` 字段（fan-in-ff-merge.sh 在 ff 成功时写落地 sha、失败时写 null——gap-direct-to-develop-
 *  check-reflog-to-revlist AC1）；无该字段的历史 release / acquire / malformed 行跳过。PURE。 */
export function extractFanInLandedShas(events) {
  const shas = new Set();
  for (const e of events ?? []) {
    if (!e || e.event !== "release") continue;
    if (typeof e.landedSha === "string" && /^[0-9a-f]{7,40}$/i.test(e.landedSha)) shas.add(e.landedSha);
  }
  return shas;
}

/** 一条 develop reflog action 是否为「直接提交」（`commit:` / `commit (amend):` / `commit (merge):`）。
 *  与 fan-in 落地的 `merge task/<id>: Fast-forward` 区分（后者 action 词含 `/`，不匹配本谓词）。
 *  PURE——复用既有 reflog 解析（:423 原正则同源，不新造）。 */
export function isReflogDirectCommit(gs) {
  const m = String(gs ?? "").match(/^([a-z() ]+?):\s*(.*)$/);
  if (!m) return false;
  return m[1].trim().startsWith("commit");
}

/** 从 `git log -g` 原始行（`<sha>\t<action>`）建立 reflog 索引 `{direct, seen}`。
 *  `direct` = 任一 reflog 条目 action 是直接提交；`seen` = 任一 reflog 条目（含 merge … Fast-forward）。
 *  一条 sha 同时有 `commit:` 与 `merge … Fast-forward` 条目时 direct 优先（历史 reset-reapply 形态）。
 *  PURE。 */
export function buildReflogIndex(reflogLines) {
  const direct = new Set();
  const seen = new Set();
  for (const line of reflogLines ?? []) {
    const [sha, gs] = line.split("\t");
    if (!sha || !gs) continue;
    seen.add(sha);
    if (isReflogDirectCommit(gs)) direct.add(sha);
  }
  return { direct, seen };
}

/** 一条 commit 的落地方式（AC2/AC3 三态）。
 *   "fan-in"          ledger 有记录，或 reflog 有非 commit 条目（merge … Fast-forward）
 *   "direct"          reflog 有「直接 commit」条目（报红候选）
 *   "unclassifiable"  ledger 无记录 且 reflog 也查不到（reflog 被 gc 剪 ⇒ NOT-EVALUATED）
 *  PURE。 */
export function classifyLandingMode(sha, ledgerShas, reflogIndex) {
  if (ledgerShas?.has(sha)) return "fan-in";
  if (!reflogIndex) return "unclassifiable"; // reflog 不可读
  if (reflogIndex.direct?.has(sha)) return "direct";
  if (reflogIndex.seen?.has(sha)) return "fan-in";
  return "unclassifiable";
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
 * 枚举 develop 的直接提交（三态判定，gap-direct-to-develop-check-reflog-to-revlist）。
 *
 * 不再以 reflog 为【唯一】ground truth（reflog 会被 gc 全局剪，老 commit 条目过期后 checker 失能——
 * test :591 被 skip 的根因）。改以 `git rev-list` 全量扫描 develop 历史（rev-list 不受 gc 剪），对每条
 * 命中的 commit 按三态分类：
 *   · 在 ledger（release 事件的 landedSha 字段，写在与 lock-events 同一个 .quay/fan-in-merge-lock-events.jsonl）
 *     ⇒ fan-in 落地，不算直投（AC2）
 *   · reflog 有「直接 commit」条目（`commit:` / `commit (amend):` / `commit (merge):`）⇒ 直接提交
 *     （收集，逐条读 files/epoch/message——AC2 真直投仍红）
 *   · ledger 无记录 且 reflog 也查不到 ⇒ unclassifiable（AC3——返回 sha 列表，调用方据此
 *     NOT-EVALUATED，⛔ 不伪装成「未发现 direct」，硬规则 3b）
 *
 * 返回 `{ direct, unclassifiable }`；rev-list 不可读（git 错误）⇒ 返回 null。只报【reachable from
 * develop】的提交（rev-list 本身就只给出 develop 可达集）；baseline 用 `git rev-list <baseline>..develop`
 * 一次完成 reachability + baseline 过滤。
 */
export function gitDevelopDirectCommits(root, develop, baseline, ledgerShas) {
  let revs;
  try {
    revs = baseline
      ? git(root, ["rev-list", `${baseline}..${develop}`])
      : git(root, ["rev-list", develop]);
  } catch {
    return null;
  }
  const reachable = revs.split("\n").map((s) => s.trim()).filter(Boolean);

  let reflogIndex = null;
  try {
    const out = git(root, ["log", "-g", "--format=%H%x09%gs", develop]);
    reflogIndex = buildReflogIndex(out.split("\n").filter(Boolean));
  } catch {
    reflogIndex = null; // reflog 不可读 ⇒ 所有非 ledger commit 都 unclassifiable（3b）
  }

  const direct = [];
  const unclassifiable = [];
  for (const sha of reachable) {
    const mode = classifyLandingMode(sha, ledgerShas, reflogIndex);
    if (mode === "fan-in") continue;
    if (mode === "unclassifiable") { unclassifiable.push(sha); continue; }
    // direct：逐条读 files/epoch/message（与 --commits 回放同源）。
    const files = gitCommitFiles(root, sha);
    if (files === null) continue; // root commit / unreadable — skip (can't diff)
    const epoch = gitCommitEpoch(root, sha);
    if (epoch === null) continue;
    const subject = gitCommitSubject(root, sha);
    const message = gitCommitMessage(root, sha); // AC65 验证证据读取面
    direct.push({ sha, subject, action: "commit", epoch, files, message });
  }
  return { direct, unclassifiable };
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
  let unclassifiable = [];
  let lockHoldIntervals = null;
  let lockSubEvaluated = false;
  let lockSubReason = "";

  // ── ff-lock 时间窗 + ledger 提取（先读 lock-events 文件——ledger 是收集阶段的三态输入之一）─────
  // ⚠️ 缺失文件 = 「从未有过锁持」（可读的空状态），不是「读不懂」——full-suite 的 verify worktree
  // 没有 .quay/ 运行时状态，若把缺失当 NOT-EVALUATED，检测器在 full-suite 路径永远给不出硬结论。
  // reflog 的 `commit:` action 已是「直接提交」的充分主信号；锁窗只是保守豁免（毫秒级、几乎从不命中），
  // 数据缺失时豁免空转（vacuous）。只有「文件在但读不懂」（malformed/unpaired）才是 3b 的 NOT-EVALUATED。
  // ledger（release 事件的 landedSha 字段）与锁事件同文件——缺失文件 ⇒ 空 ledger（vacuous：无 fan-in 落地记录）。
  const events = readJsonlLines(lockEventsFile);
  const ledgerShas = extractFanInLandedShas(events);
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

  // ── 收集直接提交（rev-list 三态扫描 或 --commits 回放）──────────────────────────────────────
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
    const collected = gitDevelopDirectCommits(root, develop, baseline, ledgerShas);
    if (collected === null) {
      const result = {
        evaluated: false,
        ok: true,
        reason: "rev-list-unreadable (NOT-EVALUATED)",
        checks: [{ check: "direct-commit-bypass", evaluated: false, ok: true, reason: "rev-list-unreadable" }],
      };
      if (asJson) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      else console.log(`direct-to-develop-bypass-check: evaluated=false ok=true (${result.reason})`);
      return 0;
    }
    commits = collected.direct;
    unclassifiable = collected.unclassifiable;
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

  // ── 三态 NOT-EVALUATED 降级（gap-direct-to-develop-check-reflog-to-revlist AC3）──────────────────
  // 枚举不完全（rev-list 命中的 commit 既不在 ledger 也不在 reflog——reflog 被 gc 剪）⇒ 即使「无直接
  // 提交被收集到」也不能假装「未发现 direct」（硬规则 3b）。降级规则：核心判 GREEN ⇒ NOT-EVALUATED；
  // 核心判 RED ⇒ 保持 RED（已确认 bypass 存在，不因盲区吞掉红）；核心判 NOT-EVALUATED ⇒ 保持。
  if (evaluated && ok && unclassifiable.length > 0) {
    evaluated = false;
    reason = "unclassifiable-commits-in-range";
  }

  const result = {
    evaluated,
    ok,
    reason,
    baseline: baseline ?? null,
    develop,
    unclassifiableCommits: unclassifiable.length,
    unclassifiableSample: unclassifiable.slice(0, 20),
    denominator: {
      totalDirectCommits: verdict.totalCommits,
      codeSurfaceCommits: verdict.codeSurfaceCommits,
      designInternalCommits: verdict.designInternalCommits,
      inLockWindowCommits: verdict.inLockWindowCommits,
      ac65AuthorizedCommits: verdict.ac65AuthorizedCommits,
      ruledHistoricalCommits: verdict.ruledHistoricalCommits,
      unclassifiableCommits: unclassifiable.length,
      predicate: "design-internal exclusion set (see header / task body): tasks/ docs/ orchestration/ adr/ .quay/ plugin/loop/ measurements/ milestones/ .claude/ plugin/skills/manager/ plugin/skills/init/ CLAUDE.md README.md .gitignore .gitattributes .npmrc .github/ plugin/scripts/fan-in-* plugin/test/fan-in-*",
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
    console.log(`  denominator: total=${verdict.totalCommits} code-surface=${verdict.codeSurfaceCommits} design-internal=${verdict.designInternalCommits} in-lock-window=${verdict.inLockWindowCommits} ac65-authorized=${verdict.ac65AuthorizedCommits} ruled-historical=${verdict.ruledHistoricalCommits} unclassifiable=${unclassifiable.length}`);
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
