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
// 判定原理（ledger 优先，reflog 括注回退，剪后退 NOT-EVALUATED）：`git merge --ff-only`（或机械
// `git push . src:develop`）只移动 ref、不创建 commit——一个通过 fan-in 落地的 task 提交在 DAG 上与直接
// 提交看起来完全一样（单亲线性链，⛔ 故不能判父数区分）。区分它们的读面有【两个】：
//   ① 持久化 ledger——fan-in-ff-merge.sh 每次真实 ff 落地，在 .quay/fan-in-merge-lock-events.jsonl
//     的 release 事件上记 `landedSha` 字段（成功 = 落地 sha，失败 = null；gap-direct-to-develop-check-
//     reflog-to-revlist, AC1）。事件发生当下 append，不依赖可被 gc 回收的易失状态。
//   ② develop 的 REFLOG——**按结构分类**（`classifyReflogAction`，⛔ 不是拼法白名单）：在 develop 上
//     **创建** commit 的记 `commit: <msg>`（`commit (amend):` / `commit (merge):` / `commit (initial):`）；
//     把 ref 移到**已存在的** commit（ref-level 落地）记 `push`（`git push . src:develop`）/
//     `merge <b>: Fast-forward`（`git merge --ff-only`）/ `branch: Reset to <t>`|`Created from <t>`
//     （`git branch -f` / `git checkout -B`）/ `reset: moving to <t>` / `fetch …`（任意 status 后缀）。
//     ⛔ 第四种拼法（`branch: Reset to`）曾不在白名单内 ⇒ 两条 tip 落进 unclassifiable ⇒ AC-194 恒 fail
//     （tasks/gap-ac194-reflog-action-vocabulary-incomplete）。但 reflog 会被 gc 全局剪 ⇒ 老 commit 条目过期。
// 扫描（gap-ac194-bypass-check-unclassifiable-window）：只扫 `git rev-list --first-parent baseline..develop`
// 的 first-parent spine（直投 commit 结构上必在 spine——直投那一刻成为 develop tip；off-spine commit 从未是
// tip ⇒ 结构上非直投、不参与判定，附读数 `offSpine`）。⛔ 不再扫全 DAG——ff/merge 只把 tip 记进 reflog，
// 分支上被并入的中间 commit 无独立 reflog 条目，扫全 DAG 会把 62%+ 的 commit 判成 unclassifiable 使判据
// 恒 fail。中间 spine commit 用 reflog 括注分类：落在某 fan-in 落地 [P, T]（T=落地 tip，P=前一条更旧 reflog
// 条目）之间 ⇒ fan-in delivered。
// 三态判定（AC2/AC3 + AC194）：对每条命中的 spine commit——在 ledger ⇒ fan-in 落地不算直投；不在 ledger 且
// reflog 有「直接 commit」标签 ⇒ 直接提交（报红候选）；是 fanin tip 或被括注覆盖 ⇒ fan-in delivered；ledger
// 无记录、非 direct、也不落进任何括注 ⇒ NOT-EVALUATED（⛔ 不伪装成「未发现 direct」，硬规则 3b）。
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
// Exit codes: 0 = PASS；1 = RED（直接提交绕过 fan-in 机件）；2 = usage/environment 错误；
//             3 = NOT-EVALUATED（`evaluated:false`——读不懂输入，硬规则 3b）。⛔ 与 PASS 不再共用
//             exit 0：只看退出码的消费者 `run_checker` 会把「读不懂却 exit 0」读成「合格」，把本
//             检测器要抓的直投提交静默放行（本任务 gap-bypass-check-unclassifiable-exits-zero 的
//             缺陷正是这一层——JSON 里已带 evaluated:false，但 ok:true ∧ exit 0 并列）。
//
// 分类覆盖率（AC4）+ 根因（AC3/AC194）：ff-merge（或 `git push .`）只在 reflog 记 tip、分支上的逐个
//   commit 无独立 reflog 条目 + reflog 深度有限（被 gc 剪）⇒ 旧全 DAG 扫描把 off-spine 621+ 条混进分类
//   分母、62% 不可分类。gap-ac194 修法 = 只扫 first-parent spine（100 条）+ reflog 括注把中间 spine commit
//   判 fan-in delivered ⇒ develop~100 窗 unclassifiable 归零、AC-194 `expect: exit 0` 可达。输出
//   `classification.{classified,total,firstParent,offSpine,ratio}` 把「这个守卫今天看得见多少」变成可读数。
//
// 落地词汇表按结构判定 + 根因点名（gap-ac194-reflog-action-vocabulary-incomplete，本任务的第二次「前提
//   变更」）：gap-ac194 把 unclassifiable 从 449 归零，但**落地词汇表仍写死在两种拼法上**——生产出现第三种
//   （`branch: Reset to HEAD`，`git branch -f develop <t>`）时判据再次变假而无人重评。⇒ 本次两件事：
//   ① `classifyReflogAction` 按结构判（`commit` 前缀 ⇒ direct；把 ref 移到已存在 commit 的形 ⇒ refMove；
//      其余 ⇒ unknown），`isReflogDirectCommit` 与括注构造都消费它（判定只留一份，⛔ 不并存两份谓词）；
//   ② **未分类的 action 形在失败那一刻被点名**（`reason = unsupported-reflog-action: <form>` +
//      `classification.unclassifiedActionForms`），而不是让下一个人从 `unclassifiable-commits-in-range`
//      计数反推（那正是本任务产生的方式）。refMove 可见而非静默豁免：`classification.refMoveIntroduced`
//      给出每次移动带入窗内的 first-parent sha 清单 + code-surface 标记，rewind 单列
//      `classification.nonForwardRefMoves`（传入集为空），⛔ 都不并入 fan-in 计数。
//
// Run:
//   node --experimental-strip-types direct-to-develop-bypass-check.ts --root <dir>
//       [--develop <ref>] [--baseline <ref>] [--lock-events <file>] [--commits <csv>]
//       [--json] [--help]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
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

/**
 * ref-level 落地读数的输出上界（`classification.refMoveIntroduced` / `nonForwardRefMoves`）。
 * ⚠️ 全史审计模式（无 `--baseline` / 大基线）下 refMove 括注实测达 969 条、JSON 1.64 MB ⇒ 只看 stdout 的
 * 消费者会被撑爆（`spawnSync` 默认 `maxBuffer` 1 MB ⇒ `ENOBUFS`、`status:null`——实测该模式下
 * `node --test` 的这个用例因此假红）。读数是【可见性辅助】、不是判定输入 ⇒ 截断到前 N 条（newest first，
 * 生产 AC-194 的两条 tip 在最前）并**显式给出总数**（⛔ 截断必须可见，硬规则④：不得让截断后的读数
 * 看起来像全量）。判定路径（RED/GREEN/NOT-EVALUATED）不受本上界影响。
 */
export const REF_MOVE_READOUT_LIMIT = 50;

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
    sha: "7b09d2060",
    reason:
      "manager 2026-08-28 裁定（用户「暂停 driver、在当前会话持续修」指令）：checker-mutation fixture S 默认 2→1（对齐 78d4f026c 的 S=1 默认，修复 suite-slot-ssot always-red baseline）。" +
      "非偷懒绕过 fan-in——机械 fan-in suite 步自锁修复链的一部分；形态=ruled 豁免+定案理由（先例 cddc55e2）。",
  },
  {
    sha: "37746907c",
    reason:
      "ruling-add 提交自身豁免（同 8dfd2967 形）——37746907c 把 6c46304b7 加入 ruled 表，本身是 manager 直接提交（改 checker 源码）⇒ bypass 自指死锁。" +
      "解：本条目把 37746907c 入表（6c46304b7 已按 ruledHistorical 分类）；用户「当前会话持续修」指令授权。形态=ruled 豁免+定案理由。",
  },
  {
    sha: "18b10880a",
    reason:
      "outer 撤回 60min 静默看门狗止血（SILENCE_MS_DEFAULT 15min——自锁根因确诊后止血无意义，撤回）——非偷懒绕过 fan-in；" +
      "形态=ruled 豁免+定案理由（先例 cddc55e2）。",
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
  {
    sha: "c789d1f49",
    reason:
      "用户直接 Manual fan-in（合并 fix/runtime-usage-ac4-host-corpus into develop）——无 task-tracked 分支，" +
      "针对 runtime-usage-inventory.test.mjs 的 AC4 host-corpus liveness 断言做直接 suite-red 修复。" +
      "非偷懒绕过 fan-in（性质同 cddc55e2/6c46304b7 类：直接修复而非绕过流程）。用户 2026-09-04 裁定 ruled one-off。",
  },
  {
    sha: "ae28758aa",
    reason:
      "release v0.8.0 分支合回 develop 的合并提交（SPEC §4.1 release 分支规程：release/vX.Y.Z 版本 bump 后" +
      "合回 develop、在合并点打 tag）——manager 2026-09-16 按人「推进 AC-274」指令直接执行的一次真实发布操作" +
      "（切 release/v0.8.0 → 15 处版本字面量去 -dev 后缀 → 合回 develop → 打 tag v0.8.0），非 manager 自发起" +
      "代码直改，也非偷懒绕过 fan-in——release 分支的切/合/删/打 tag 是 outer/manager 职责范围内的一次性" +
      "分支生命周期操作，不适合塞进 task-branch fan-in 这一为「改代码」设计的机制。" +
      "先例 08e8ec55（release 0.5.0 版本 bump）/a388ca38（release 0.6.1 版本 bump），本次是同一类事件的第三次。" +
      "manager 2026-09-16 裁定 ruled one-off（先例 08e8ec55/a388ca38/cddc55e2）。",
  },
  {
    sha: "806fee934",
    reason:
      "release v0.8.0 合回 develop 之后的下一轮 -dev bump 提交（SPEC §4.3 落实口径：合回 develop 之后立即" +
      "带上新的 -dev 后缀，⛔ 不留在无后缀的已发布版本号上）——与 ae28758aa 同一次发布操作的直接延续，" +
      "同一裁定依据（先例 08e8ec55/a388ca38/cddc55e2）。manager 2026-09-16 裁定 ruled one-off。",
  },
  {
    sha: "cf4f9bd9e",
    reason:
      "ruling-add 提交自身豁免（同 8dfd2967/fd1de6a0 形）——cf4f9bd9e 把 ae28758aa/806fee934 加入 ruled 表，" +
      "本身是 manager 直接提交（改 checker 源码）⇒ bypass 自指死锁（给 cf4f9bd9e 加 ruled = 又一个直接提交）。" +
      "解：本条目把 cf4f9bd9e 入表（ae28758aa/806fee934 已按 ruledHistorical 分类）。" +
      "manager 2026-09-16 裁定 ruled one-off（先例 8dfd2967/fd1de6a0）。",
  },
  {
    sha: "2d3a6fa35",
    reason:
      "人 2026-09-18 04:11:28Z 直接提交 develop 的 serve host 泄漏链修复（--orphan-serves 回收模式 + serve 堆上限，6 文件 459 插入）未登记 ⇒ 该静态检查 exit 1、scripts/test.sh 静态层 fail-closed，" +
      "使四条在飞 code-delta 任务的机械 fan-in 在 step=suite 恒红。裁定 ruled one-off：判据要抓的是「loop 偷懒绕过 fan-in」，而本提交作者是人（calvino.huang@gmail.com）、" +
      "内容是 serve 泄漏修复，属人的编辑而非 loop 绕 fan-in 的代码直改，不属于 detector 要抓的那一类。" +
      "落地机制：条目加在任务分支上经 fan-in 正规 land，⛔ 不需要再一次直投、也不需要自指豁免（先例 37746907c/cf4f9bd9e 的自指死锁在此不发生）。" +
      "人 2026-09-18 裁定 ruled one-off（先例 cddc55e2/6c46304b7/08e8ec55/ae28758aa）。",
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

// ── reflog action 词汇表：按结构判定，⛔ 不是拼法白名单 ────────────────────────────────────────────
//
// 缺陷（tasks/gap-ac194-reflog-action-vocabulary-incomplete）：旧 `isReflogFanIn` 只认 `push` 与
// `/Fast-forward/` 两种「ref-level 落地」拼法。生产上 develop 出现了第三种——`branch: Reset to HEAD`
// （`git branch -f develop <t>` / `git checkout -B develop <t>`）⇒ 落进 unclassifiable ⇒ 硬规则③b
// fail-closed ⇒ AC-194 `expect: exit 0` 结构上不可达。**判据的真值没变**（没有 commit 在 develop 上
// 被创建），变的是读面——`git branch -f develop <t>` / `git push . src:develop` / `git merge --ff-only`
// 在 DAG 上完全同形：都只把 develop ref 移到**已存在的** commit，都不创建 commit。
// ⇒ 修法 = 按结构判定（action 前缀 + rest 形状），⛔ 不再枚举拼法（旧白名单对第四种拼法结构上不可能发现）。
//
// 拼法由探针仓库实测（⛔ 无凭记忆字面量；本机 git 2.43.0，逐条贴原文）：
//   git commit                       → `commit: <subject>` / `commit (initial): …` / `commit (amend): …`
//                                      / `commit (merge): …`                        ⇒ direct
//   git push . <src>:<dst>           → `push`                                       ⇒ refMove
//   git fetch . <src>:<dst>          → `fetch -q . <src>:<dst>: <status>`（storing head/ref、
//                                      fast-forward、forced-update 均实测到）  ⇒ refMove
//   git merge --ff-only <b>          → `merge <b>: Fast-forward`                    ⇒ refMove
//   git branch -f <已存在 b> <t>     → `branch: Reset to <t>`                       ⇒ refMove
//   git checkout -B <已存在 b> <t>   → `branch: Reset to <t>`                       ⇒ refMove
//   git branch [-f] <新 b> <t>       → `branch: Created from <t>`                   ⇒ refMove
//   git reset --hard <t>（b 已检出） → `reset: moving to <full-sha>`                ⇒ refMove
//   git update-ref（无 -m）          → ``（空 gs）                                  ⇒ unknown
//   git update-ref -m <msg>          → `<msg>`（任意文本）                          ⇒ unknown
//   git rebase / git checkout / 非 ff merge（`merge <b>: Merge made by …`）         ⇒ unknown
//   ⚠️ `<t>` 是**命令行上传入的那个字面量**（实测：`git branch -f topic HEAD` ⇒ `Reset to HEAD`；
//      `git branch -f topic <sha>` ⇒ `Reset to <sha>`）——⛔ 不得解析该 token 来判类（它可以是
//      HEAD / HEAD~1 / 分支名 / sha），只能按 action 形判。
//   ⚠️ 解析陷阱（实测踩过一次）：action 词里可含任意分支名 ⇒ ⛔ 不能用通用的 `前缀: rest` 切分器
//      （`^([a-z() ]+?):` 对 `merge task/gap-foo: Fast-forward` 无匹配——`/` 不在字符类里 ⇒ 该形会被
//      误判成 unknown ⇒ 整个 ff 括注分类失效）。只能拿 git 自己的 action 词在整串开头匹配。
//
// 三态（⛔ unknown 一律 fail-closed，不与「合格」同形，硬规则③b）：
//   "direct"  = action 以 `commit` 开头 ⇒ 在 develop 上**创建**了 commit（直投候选）
//   "refMove" = 把 ref 移到**已存在的** commit（不创建 commit）⇒ 与 fan-in `push` 同类的 ref-level 落地
//   "unknown" = 读不懂的 action 形 ⇒ NOT-EVALUATED（reason 点名该形，见 unclassifiedActionForms）
//
// ⚠️ refMove ≠ 「已放行」：它可见而非静默豁免——独立计数 + 带入窗内的 first-parent commit 清单
//    （`rev-list --first-parent P..T`）及各自 code-surface 标记，⛔ 不得并入 fan-in 计数（那会把
//    「不知道」伪装成「合格」，硬规则④）。rewind（P 非 T 祖先）引入集为空且单独可见
//    （classification.nonForwardRefMoves）。
/** 一条 develop reflog action 的分类（结构判定，三态）。PURE——**判定只留一份**：`isReflogDirectCommit`
 *  与括注构造都消费它，⛔ 不再各持一份拼法谓词（那是本任务要修的漂移源）。
 *  返回 "direct" | "refMove" | "unknown"（词汇表与实测原文见上方）。 */
export function classifyReflogAction(gs) {
  const s = String(gs ?? "");
  if (!s) return "unknown"; // 空 gs（git update-ref 无 -m）——读不懂，fail-closed
  // ⚠️ 按 git 自己的 action 词汇表在**整串开头**匹配，⛔ 不做通用的 `前缀: rest` 切分——action 词里可以
  // 含任意分支名（`merge task/<id>` 含 `/`、`fetch -q . <sha>:refs/heads/<b>` 含 `-` `.` `:`），
  // 通用切分器会在这些字符上失配并把 `merge task/x: Fast-forward` 误判成 unknown（实测踩过：
  // `^([a-z() ]+?):` 对 `merge task/gap-foo: Fast-forward` 无匹配）。`\b` 边界防 `committed`/`merged` 误命中。
  if (/^commit\b/.test(s)) return "direct"; // 在 develop 上创建了 commit（`commit:` / `commit (amend):` / `commit (merge):` / `commit (initial):`）
  if (s === "push") return "refMove"; // git push . <src>:<dst>（git 只写这一个词）
  // git fetch <remote> <src>:<dst> ⇒ refMove —— **按结构**，⛔ 不看 status 后缀。
  //
  // 缺陷（tasks/gap-suite-ambient-reds-block-all-code-landings，第 4 类）：旧判据要求 `: storing
  // ref$`，而那只是一种后缀拼法。实测本仓自己的 author↔develop 传播产生的是
  //   fetch -q . author:develop: fast-forward
  // ⇒ 不匹配 ⇒ unknown ⇒ NOT-EVALUATED（`unsupported-reflog-action: fetch -q . author:develop, …`），
  // 整个 AC3 回放用例从 `unclassifiable-commits-in-range` 变成红。
  //
  // ⛔ 修法**不是**把 `fast-forward` 补进白名单——白名单对下一种拼法结构上不可能发现（本文件 :1150
  // 附近逐字写着这条，`branch: Reset to HEAD` 就是这样破掉 AC-194 的）。按结构：**`fetch` 这个
  // action 词只由 git-fetch 写出，而 git-fetch 在本地【从不创建 commit】**——它只能把 ref 指向
  // 一个从远端收到的、**已存在的**对象。所以任何以 `fetch` 开头的 reflog action 都必然是一次
  // ref-level 移动，与 status 后缀是什么无关。
  //
  // 后缀词表由探针仓库实测（clone 出一对 src/dst，逐条贴 %gs；⛔ 无凭记忆字面量）：
  //   git fetch <r> <src>:<已存在 ref>（ff）        → `fetch -q <r> <src>:<ref>: fast-forward`
  //   git fetch --force <r> <src>:<已存在 ref>（非ff）→ `fetch -q --force <r> <src>:<ref>: forced-update`
  //   git fetch <r> <分支名>:<新 ref>               → `fetch -q <r> <src>:refs/heads/<b>: storing head`
  //   git fetch <r> <sha>:<新 ref>                  → `fetch -q <r> <sha>:refs/heads/<b>: storing ref`
  // 四种后缀全落在这一条上；而它不看后缀 ⇒ 第五种出现时也自动正确（见 AC4 ④ 负控制）。
  if (/^fetch\b/.test(s)) return "refMove";
  if (/^merge\b/.test(s) && /: Fast-forward\s*$/.test(s)) return "refMove"; // git merge --ff-only <b>
  // git branch -f / -B / branch <b> <start>：`Reset to`（已存在分支）与 `Created from`（新分支）
  // 都只把 ref 指向**已存在的** commit。
  if (/^branch:\s*(?:Reset to|Created from)\b/.test(s)) return "refMove";
  if (/^reset:\s*moving to\b/.test(s)) return "refMove"; // git reset --hard <target>
  return "unknown"; // rebase / checkout / 非 ff merge / 任意 update-ref -m 文本 / …（fail-closed）
}

/** 一条 reflog action 的「形」——供 `classification.unclassifiedActionForms` 逐字点名根因。
 *  取 `前缀: rest` 的 action 前缀；无该形则整串；空串 ⇒ "(empty)"。PURE。 */
export function reflogActionForm(gs) {
  const s = String(gs ?? "");
  if (!s) return "(empty)";
  const i = s.indexOf(": ");
  if (i > 0) return s.slice(0, i).trim();
  return s.trim();
}

/** 一条 develop reflog action 是否为「直接提交」（`commit:` / `commit (amend):` / `commit (merge):`）。
 *  与 ref-level 落地的 `merge task/<id>: Fast-forward` / `push` / `branch: Reset to` 区分。
 *  PURE——**判定只留一份**：消费 `classifyReflogAction`（⛔ 不再自带一份 `startsWith("commit")`
 *  谓词——两份并存正是本任务要修的漂移源）。 */
export function isReflogDirectCommit(gs) {
  return classifyReflogAction(gs) === "direct";
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

/** [已退役] 旧「fan-in 落地」白名单谓词（`push` | `/Fast-forward/`）。**由 `classifyReflogAction` 取代**
 *  （硬规则⑤b/4：拼法白名单是漂移源——生产出现第三种落地拼法 `branch: Reset to` 时它结构上不可能发现）。
 *  ⛔ 不再导出、不再有任何调用点——保留此注记只为指向替代物，不保留死代码。
 *  （tasks/gap-ac194-reflog-action-vocabulary-incomplete） */

/** 从有序 reflog 行（`git log -g --format=%H%x09%gs develop` 输出，newest first）建立 ref-level 落地括注
 *  结构。返回 `{ refMoveTips, brackets }`：
 *   · `refMoveTips` = 所有 `refMove` 落地 tip（`push` / `merge …Fast-forward` / `branch: Reset to|Created from`
 *     / `reset: moving to` / `fetch …`）的 sha 集——tip 自己即一次落地（含 reflog 最老一条
 *     refMove tip，其「之前」超出 reflog 保留、无前一条条目可配对）；
 *   · `brackets` = 时间序（newest first）的 `{T, P}` 对——T = 本次落地 tip，P = 前一条 reflog 条目
 *     （更旧）的 sha；`rev-list --first-parent P..T` 即本次落地带入的 first-parent 提交（中间 commit 无独立
 *     reflog 条目，gap-ac194 括注分类）。
 *   ⛔ 最老一条 reflog 条目（无前一条）不产生括注——其「之前」超出 reflog 保留、不可分类（硬规则③b，不伪装
 *     成合格）。
 *   ⚠️ 判定**只留一份**：本函数消费 `classifyReflogAction(...)==="refMove"`，不再自持拼法谓词。
 *   PURE。 */
export function buildRefMoveBrackets(reflogLines) {
  const refMoveTips = new Set();
  const brackets = [];
  const entries = (reflogLines ?? []).map((line) => line.split("\t")).filter((p) => p[0] && p[1] != null);
  for (let i = 0; i < entries.length; i++) {
    const [sha, gs] = entries[i];
    if (classifyReflogAction(gs) !== "refMove") continue;
    refMoveTips.add(sha);
    const prev = i + 1 < entries.length ? entries[i + 1][0] : null; // 前一条（更旧）
    if (prev) brackets.push({ T: sha, P: prev });
  }
  return { refMoveTips, brackets };
}

/** spine 提交的落地方式（gap-ac194 括注分类的三态，纯判定——`gitDevelopDirectCommits` 把括注覆盖集算好后
 *  逐条喂入）：
 *   "fan-in"         ledger 有记录，或 refMoveTips（ref-level 落地 tip：push / Fast-forward / branch: Reset to
 *                    / Created from / reset: moving to / fetch …），或括注覆盖（中间 commit）
 *   "direct"         reflog 有「直接 commit」条目（报红候选）
 *   "unclassifiable" ledger 无记录、非 direct、非 refMoveTips、也不在任何括注区间（reflog 被 gc 剪 /
 *                    落不进括注的老 commit / **未分类 action 形的 tip** ⇒ NOT-EVALUATED，⛔ 不与合格同形）
 *  PURE。 */
export function classifySpineLandingMode(sha, ledgerShas, directSet, refMoveTips, refMoveCovered) {
  if (ledgerShas?.has(sha)) return "fan-in";
  if (!directSet) return "unclassifiable"; // reflog 不可读
  if (directSet.has(sha)) return "direct";
  if (refMoveTips?.has(sha) || refMoveCovered?.has(sha)) return "fan-in";
  return "unclassifiable";
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

/** `a` 是否为 `b` 的祖先（`git merge-base --is-ancestor`；同一 commit 视为是）。git 错误 ⇒ false
 *  （保守：读不出祖先关系时按「非前向」处理 ⇒ 计入 nonForwardRefMoves 可见，⛔ 不洗成前向落地）。 */
function isAncestor(root, a, b) {
  try {
    git(root, ["merge-base", "--is-ancestor", a, b]);
    return true;
  } catch {
    return false;
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
 * 返回 `{ direct, unclassifiable, totalReachable, firstParentCommits, offSpineCommits,
 * refMoveIntroduced, nonForwardRefMoves, unclassifiedActionForms }`（totalReachable = rev-list 命中条数，
 * 供分类覆盖率 `classified / total` 读数——AC4；后三项 = ref-level 落地的可见性读数 + 未分类 action 形的
 * 点名，见任务 gap-ac194-reflog-action-vocabulary-incomplete AC2/AC5/AC6）；rev-list 不可读（git 错误）
 * ⇒ 返回 null。只报【reachable from develop】的提交（rev-list 本身就只给出 develop 可达集）；baseline 用
 * `git rev-list <baseline>..develop` 一次完成 reachability + baseline 过滤。
 */
export function gitDevelopDirectCommits(root, develop, baseline, ledgerShas) {
  // first-parent spine 扫描（gap-ac194-bypass-check-unclassifiable-window）：直投 commit 结构上必在 spine
  // （直投那一刻成为 develop tip），off-spine commit 从未是 tip ⇒ 结构上非直投、不参与判定。⛔ 不再扫全 DAG
  // （旧全 DAG 把 merge 引入的 off-spine 621+ 条混进分类分母，把不可分类率推高到 62% 使判据恒 fail）。
  let spine;
  try {
    spine = baseline
      ? git(root, ["rev-list", "--first-parent", `${baseline}..${develop}`])
      : git(root, ["rev-list", "--first-parent", develop]);
  } catch {
    return null;
  }
  const reachable = spine.split("\n").map((s) => s.trim()).filter(Boolean);
  const spineSet = new Set(reachable);

  // off-spine 读数（AC4 附读数）：full DAG − first-parent = 结构上非直投、不参与判定的条数。
  let fullDag = null;
  try {
    fullDag = git(root, baseline ? ["rev-list", `${baseline}..${develop}`] : ["rev-list", develop])
      .split("\n").filter(Boolean);
  } catch {
    fullDag = null;
  }
  const offSpineCommits = fullDag ? Math.max(0, fullDag.length - reachable.length) : null;

  // reflog：direct（commit 直投）+ ref-level 落地括注（classifyReflogAction 的结构判定——push /
  // merge …Fast-forward / branch: Reset to|Created from / reset: moving to / fetch …；
  // ⛔ 不是拼法白名单）。reflogActionBySha 供未分类 action 形点名根因（AC2）。
  let reflogIndex = null;
  let refMoveTips = new Set();
  let brackets = [];
  const reflogActionBySha = new Map(); // sha → raw `%gs`（同一 sha 多条时取最新一条）
  try {
    const out = git(root, ["log", "-g", "--format=%H%x09%gs", develop]);
    const reflogLines = out.split("\n").filter(Boolean);
    reflogIndex = buildReflogIndex(reflogLines);
    const fb = buildRefMoveBrackets(reflogLines);
    refMoveTips = fb.refMoveTips;
    brackets = fb.brackets;
    for (const line of reflogLines) {
      const [sha, gs] = line.split("\t");
      if (sha && !reflogActionBySha.has(sha)) reflogActionBySha.set(sha, String(gs ?? ""));
    }
  } catch {
    reflogIndex = null; // reflog 不可读 ⇒ 所有非 ledger commit 都 unclassifiable（3b）
  }

  // 括注分类（gap-ac194）：spine 上无独立 reflog 条目的中间 commit，落在某次 ref-level 落地 [P, T] 之间
  // ⇒ fan-in delivered（非直投、非 unclassifiable）。
  //
  // ── 准入判据（gap-ac194-bracket-filter-drops-offspine-landing-tip，本判据第三次「前提变更」）────────
  // 现判据：**只排除「T 是窗底 baseline 的祖先」这一类括注**（`windowAncestors` = `rev-list <baseline>`），
  //   其余括注一律处理 ⇒ `refMoveCovered` 用**完整候选集**（见下「新判据是必要条件」）。
  // ⛔ 前判据（本任务修掉的那个）是「T 必须在当前 first-parent spine 上」，其理由写在旧注释里：「一次
  //   ref-level 落地到 develop 必然让 T 成为 develop tip（spine 成员）」。**该前提被实测证伪，且不是边角
  //   情形**：任务分支在工作树里 `git merge develop`（把当时的 develop tip 记成**第二父**）、随后该分支被
  //   ff fan-in ⇒ develop 的 first-parent spine 走的变成**任务分支那条线**，先前的落地 tip 落进第二父位置
  //   （develop 可达、离脊）。实测：develop reflog 最近 **200** 条 tip 里**只有 4 条**在当前 spine 上，
  //   **196 条是 develop 的祖先但不在当前 first-parent spine 上**。旧判据把它们的括注全部跳过 ⇒ 其带入的
  //   窗内 spine 提交无家可归 ⇒ unclassifiable（NOT-EVALUATED，exit 3）。
  // 新判据是**必要条件**（⛔ 不是充分条件）：T 是窗底 baseline 的祖先 ⇒ T 的祖先**全是** baseline 的祖先，
  //   而窗内 spine commit 按定义**不是** baseline 的祖先 ⇒ `rev-list --first-parent P..T` 结构上不可能含
  //   窗内 spine commit（做不了任何事，只是白跑一条 subprocess）。
  //   （用【窗底祖先集】而不是【窗内可达集】当排除集：后者要求 T 落在 develop 可达集内，会把「曾是 develop
  //    tip、后被 force-move 出可达集」的 T 一并跳过——那类 T 的括注同样可能带出窗内 spine 提交。窗底祖先集
  //   是**更宽**的排除集，只排除结构上确证做不了事的那些。）
  // 判据**能取假**（硬规则④——不是恒真）：①真直投有独立 `commit:` reflog 条目，而 `classifySpineLandingMode`
  //   里 `directSet` **先于** `refMoveCovered` 判定 ⇒ 扩大括注覆盖**结构上不可能**把真直投洗成 fan-in；
  //   ②带不出窗内提交的括注（含 reflog 已被 gc 剪、无条目的老 commit）仍保持 unclassifiable（硬规则③b）。
  // 成本（实测，本仓 3891 条 reflog / 3456 条括注）：旧判据准入 27 条；新判据准入 648 条（+621 条 subprocess，
  // 判据墙钟 2.0s → 7.0s，仍在 goal-gate 60s criterion 预算内）。
  //
  // 同时产出 refMove 的【可见性读数】（AC5）——admission 与静默豁免的分界就在这里：带入窗内的 first-parent
  // commit 清单 + 各自 code-surface 标记，⛔ 不并入 fan-in 计数（硬规则④：不得把「不知道」洗成「合格」）。
  // ⚠️ **可见性读数（`refMoveIntroduced` / `nonForwardRefMoves`）仍按窄口径**（`T ∈ spineSet`）：完整候选集
  // 会把 --json 撑到 376KB（实测），而覆盖集 `refMoveCovered` 才是判定输入 ⇒ 只有它用完整候选集。
  let windowAncestors = null; // 窗底（baseline）的祖先集——命中它 ⇒ 该括注结构上带入不了窗内 spine commit
  if (baseline) {
    try {
      windowAncestors = new Set(git(root, ["rev-list", baseline]).split("\n").filter(Boolean));
    } catch {
      windowAncestors = null; // 读不出 ⇒ 不排除任何括注（保守：多覆盖一点 ⇒ 由 directSet 优先级保证不掩真直投）
    }
  }
  const refMoveCovered = new Set();
  const refMoveIntroduced = [];
  const nonForwardRefMoves = [];
  if (reflogIndex) {
    for (const { T, P } of brackets) {
      // 准入（见上注——⛔ 不是「T 在当前 first-parent spine 上」）：只排除结构上确证带入不了窗内提交的括注。
      if (windowAncestors?.has(T)) continue;
      try {
        const intro = git(root, ["rev-list", "--first-parent", `${P}..${T}`]).split("\n").filter(Boolean);
        for (const s of intro) if (spineSet.has(s)) refMoveCovered.add(s);
        // 可见性读数按**窄口径**（T 在当前 first-parent spine 上）——见上注（--json 体量）。
        if (!spineSet.has(T)) continue;
        // rewind 判定（AC6）：P 非 T 祖先 ⇒ 这次移动是回退，带入集为空 ⇒ 单独可见，⛔ 不计入「带入了 commit
        // 的落地」。用显式祖先判定（不是「intro 为空」——P==T 的空移动也会给出空 intro，两者语义不同）。
        const forward = isAncestor(root, P, T);
        if (!forward) {
          nonForwardRefMoves.push({
            tip: T,
            prev: P,
            introduced: [], // 回退：P 非 T 祖先 ⇒ `rev-list --first-parent P..T` 为空（⛔ 不得计为「带入了 commit 的落地」）
            reason: "prev-not-ancestor-of-tip (rewind): rev-list --first-parent P..T is empty — this ref move introduced no commit",
          });
          continue;
        }
        refMoveIntroduced.push({
          tip: T,
          prev: P,
          introduced: intro.map((s) => {
            const files = gitCommitFiles(root, s);
            return {
              sha: s,
              codeSurface: files !== null && files.some((f) => !isDesignInternalPath(f)),
              files: files ?? null,
            };
          }),
        });
      } catch {
        // 括注不可读 ⇒ 该括注不覆盖任何 spine commit（其余保持 unclassifiable，fail-closed）
      }
    }
  }

  const direct = [];
  const unclassifiable = [];
  for (const sha of reachable) {
    const mode = classifySpineLandingMode(sha, ledgerShas, reflogIndex?.direct ?? null, refMoveTips, refMoveCovered);
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

  // 未分类 action 形的点名（AC2「根因在失败那一刻可见」）：unclassifiable 的 spine commit 若**有自己的
  // reflog 条目**且该 action 形读不懂（classifyReflogAction === "unknown"）⇒ 记形 + 计数 + 样本 sha，
  // 使 reason 能逐字点名 `unsupported-reflog-action: <form>`（旧版只报 unclassifiable-commits-in-range
  // 计数，下一个人要从计数反推是哪种拼法——gap-ac194 的第二次「前提变更」就是这么发生的）。
  // ⛔ 与「reflog 根本没有该条目的老 commit」（被 gc 剪）区分：后者没有形可点名，reason 保持计数形态。
  // ⚠️ 覆盖边界（实测踩过一次）：只对**真的落进 unclassifiable 的** commit 点名——一条 commit 若还有更旧的
  // `commit:` 条目（历史 reset/reapply 形态），`classifySpineLandingMode` 判它 direct（比 unclassifiable
  // 更严重的分类，且 code-surface 时直接 RED）⇒ 未知形在它身上不产生 unclassifiable、也就不会被点名。
  // 这是有意的：点名服务的是「reason 只给计数、下一个人要从计数反推」那个缺口，而不是给已判 direct 的
  // commit 附加注释。判据强度不受影响（direct 优先 = 更保守）。
  const unknownFormAcc = new Map(); // form → {form, count, sampleShas}
  for (const sha of unclassifiable) {
    const gs = reflogActionBySha.get(sha);
    if (gs === undefined) continue; // 无 reflog 条目（gc 剪）——无形可点名
    if (classifyReflogAction(gs) !== "unknown") continue;
    const form = reflogActionForm(gs);
    const e = unknownFormAcc.get(form) ?? { form, count: 0, sampleShas: [] };
    e.count += 1;
    if (e.sampleShas.length < 5) e.sampleShas.push(sha);
    unknownFormAcc.set(form, e);
  }
  const unclassifiedActionForms = [...unknownFormAcc.values()].sort(
    (a, b) => b.count - a.count || a.form.localeCompare(b.form),
  );

  return {
    direct,
    unclassifiable,
    totalReachable: reachable.length,
    firstParentCommits: reachable.length,
    offSpineCommits,
    refMoveIntroduced,
    nonForwardRefMoves,
    unclassifiedActionForms,
  };
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

const usage = `direct-to-develop-bypass-check.ts — 直接提交 develop 绕过全部 fan-in 机件的检测器
(tasks/gap-direct-to-develop-bypasses-fan-in-gates)

判定（AC1）：直接提交 develop ∧ 触及代码/断言面 ∧ 无 ff-lock 时间窗事件 ⇒ RED。
  · 直接提交 = develop reflog action 以 \`commit\` 开头（在 develop 上**创建**了 commit）；ref-level 落地
    （不创建 commit，把 ref 移到已存在的 commit）= \`push\` / \`merge …: Fast-forward\` /
    \`branch: Reset to|Created from <t>\` / \`reset: moving to <t>\` / \`fetch …\`（任意 status 后缀）——按结构判定
    （classifyReflogAction），⛔ 不是拼法白名单。读不懂的 action 形 ⇒ NOT-EVALUATED 且 reason 点名该形
    （\`unsupported-reflog-action: <form>\`）
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
  0  PASS — evaluated and no bypass
  1  RED — a direct commit to develop bypasses the fan-in mechanism
  2  usage / environment error
  3  NOT-EVALUATED — could not judge (read \`evaluated\`: false), never conflated with PASS (exit 0), 硬规则 3b`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(flagValue(args, "--root") ?? process.cwd());
  const develop = flagValue(args, "--develop") ?? "develop";
  const baseline = flagValue(args, "--baseline");
  const lockEventsFile = path.resolve(flagValue(args, "--lock-events") ?? path.join(root, ".quay", "fan-in-merge-lock-events.jsonl"));
  const commitsArg = flagValue(args, "--commits");
  const asJson = args.includes("--json");

  let commits = null;
  let unclassifiable = [];
  let totalScanned = 0;
  let firstParentCommits = 0;
  let offSpineCommits = null;
  let lockHoldIntervals = null;
  let lockSubEvaluated = false;
  let lockSubReason = "";
  // ref-level 落地可见性读数 + 未分类 action 形点名（gap-ac194-reflog-action-vocabulary-incomplete）。
  let refMoveIntroduced = [];
  let nonForwardRefMoves = [];
  let unclassifiedActionForms = [];

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
    totalScanned = commits.length;
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
      return 3;
    }
    commits = collected.direct;
    unclassifiable = collected.unclassifiable;
    totalScanned = collected.totalReachable;
    firstParentCommits = collected.firstParentCommits ?? totalScanned;
    offSpineCommits = collected.offSpineCommits ?? null;
    refMoveIntroduced = collected.refMoveIntroduced ?? [];
    nonForwardRefMoves = collected.nonForwardRefMoves ?? [];
    unclassifiedActionForms = collected.unclassifiedActionForms ?? [];
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
  // 根因点名（gap-ac194-reflog-action-vocabulary-incomplete AC2）：unclassifiable 中若有**读不懂的 action
  // 形**（有条目但 classifyReflogAction === "unknown"）⇒ reason 逐字点名该形，而不是只报计数。旧行为
  // （一律 "unclassifiable-commits-in-range"）使下一个人必须事后取证才能定位是哪种拼法——本任务正是那种
  // 反推的产物（第二次「前提变更」）。既有 reason 作为并列信息保留在 reasonSecondary。
  let reasonSecondary = null;
  if (evaluated && ok && unclassifiable.length > 0) {
    evaluated = false;
    if (unclassifiedActionForms.length > 0) {
      reason = `unsupported-reflog-action: ${unclassifiedActionForms.map((f) => f.form).join(", ")}`;
      reasonSecondary = "unclassifiable-commits-in-range";
    } else {
      reason = "unclassifiable-commits-in-range"; // reflog 空洞（gc 剪）——没有 action 形可点名
    }
  }

  // 分类覆盖率（AC4）：classified = 扫描范围内能被判定 landing-mode（fan-in / direct）的条数，
  // total = rev-list 命中总数；unclassifiable = total − classified（既不在 ledger 也不在 reflog）。
  const classified = totalScanned - unclassifiable.length;

  const result = {
    evaluated,
    ok,
    reason,
    reasonSecondary,
    baseline: baseline ?? null,
    develop,
    unclassifiableCommits: unclassifiable.length,
    unclassifiableSample: unclassifiable.slice(0, 20),
    classification: {
      classified,
      total: totalScanned,
      ratio: totalScanned > 0 ? classified / totalScanned : null,
      firstParent: firstParentCommits,
      offSpine: offSpineCommits,
      // ref-level 落地（refMove）的可见性读数（AC5/AC6）——⛔ 独立于 fan-in 计数：这两组数只回答
      // 「这次移动把哪些 first-parent commit 带进了窗、它们是不是 code-surface」，不参与 RED/GREEN 判定。
      // 截断到 REF_MOVE_READOUT_LIMIT（newest first）+ 显式总数（截断可见，见常量注释）。
      refMoveIntroduced: refMoveIntroduced.slice(0, REF_MOVE_READOUT_LIMIT),
      refMoveIntroducedTotal: refMoveIntroduced.length,
      // P 非 T 祖先的 refMove（rewind）——带入集为空，单列可见，⛔ 不计入「带入了 commit 的落地」。
      nonForwardRefMoves: nonForwardRefMoves.slice(0, REF_MOVE_READOUT_LIMIT),
      nonForwardRefMovesTotal: nonForwardRefMoves.length,
      // 读不懂的 action 形（有条目但 classifyReflogAction === "unknown"）——reason 逐字点名它们。
      unclassifiedActionForms,
      // 词汇表（结构判定，非白名单）——写在这里使 --json 的读者不必回读源码。
      refMoveVocabulary:
        "structural classification of the develop reflog action: 'direct' = action starts with `commit` (a commit was CREATED on develop); " +
        "'refMove' = the ref was moved to an EXISTING commit, no commit created (`push` | `merge <b>: Fast-forward` | " +
        "`branch: Reset to <t>` | `branch: Created from <t>` | `reset: moving to <t>` | `fetch …`); " +
        "'unknown' = unreadable action form ⇒ NOT-EVALUATED fail-closed, reason names the form (`unsupported-reflog-action: <form>`). " +
        "⛔ Not a spelling whitelist — a spelling whitelist is structurally blind to the next landing form (that is exactly how " +
        "`branch: Reset to HEAD` broke AC-194). refMove is VISIBLE, not silently exempt: refMoveIntroduced + nonForwardRefMoves " +
        "are read-outs ONLY and are never folded into the fan-in counts.",
    },
    denominator: {
      totalDirectCommits: verdict.totalCommits,
      codeSurfaceCommits: verdict.codeSurfaceCommits,
      designInternalCommits: verdict.designInternalCommits,
      inLockWindowCommits: verdict.inLockWindowCommits,
      ac65AuthorizedCommits: verdict.ac65AuthorizedCommits,
      ruledHistoricalCommits: verdict.ruledHistoricalCommits,
      unclassifiableCommits: unclassifiable.length,
      classifiedCommits: classified,
      totalScannedCommits: totalScanned,
      firstParentCommits,
      offSpineCommits,
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
    console.log(`  classification: classified=${classified} total=${totalScanned} first-parent=${firstParentCommits} off-spine=${offSpineCommits ?? "n/a"} ratio=${totalScanned > 0 ? (classified / totalScanned).toFixed(4) : "n/a"}`);
    console.log(`  lock-window: evaluated=${lockSubEvaluated} (${lockSubReason})`);
    // ref-level 落地可见性（AC5/AC6）：⛔ 这几行只是读数，不参与 RED/GREEN 判定。
    console.log(`  ref-level landings (refMove): brackets=${refMoveIntroduced.length} non-forward=${nonForwardRefMoves.length}${refMoveIntroduced.length > REF_MOVE_READOUT_LIMIT ? ` (showing first ${REF_MOVE_READOUT_LIMIT})` : ""}`);
    for (const rm of refMoveIntroduced.slice(0, REF_MOVE_READOUT_LIMIT)) {
      console.log(`      refMove tip=${rm.tip.slice(0, 10)} prev=${rm.prev.slice(0, 10)} introduced=${rm.introduced.length}`);
      for (const it of rm.introduced) console.log(`        ${it.sha.slice(0, 10)} code-surface=${it.codeSurface}${it.codeSurface && it.files ? ` (${it.files.join(", ")})` : ""}`);
    }
    for (const nf of nonForwardRefMoves.slice(0, REF_MOVE_READOUT_LIMIT)) {
      console.log(`      NON-FORWARD refMove tip=${nf.tip.slice(0, 10)} prev=${nf.prev.slice(0, 10)} — ${nf.reason}`);
    }
    if (unclassifiedActionForms.length > 0) {
      console.log(`  unsupported reflog action forms: ${unclassifiedActionForms.map((f) => `${f.form}×${f.count}`).join(", ")}`);
    }
    for (const c of codeSurfaceCandidates) {
      const tag = c.ruledHistorical ? "RULED-HISTORICAL" : c.bypass ? "RED" : c.ac65Authorized ? "AC65-AUTHORIZED" : c.inLockWindow ? "SKIP(in-lock-window)" : "design-internal";
      console.log(`  ${tag} ${c.sha} — ${c.subject}`);
      for (const f of c.codeSurfaceFiles) console.log(`      ${f}`);
      if (c.ruledHistorical && c.ruledReason) console.log(`      ruled reason: ${c.ruledReason}`);
      if (c.ac65Authorized && c.ac65Evidence) console.log(`      evidence: ${c.ac65Evidence}`);
    }
    if (verdict.totalCommits === 0) console.log("  (no direct commits in scan range)");
  }
  // 退出码三态（硬规则 3b + gap-not-evaluated-harness-third-state）：NOT-EVALUATED（evaluated:false）
  // ⇒ exit 3，⛔ 不再与 PASS（exit 0）同形——否则只看退出码的 `run_checker` 把「读不懂」读成「合格」。
  if (!evaluated) return 3;
  return ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "direct-to-develop-bypass-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
