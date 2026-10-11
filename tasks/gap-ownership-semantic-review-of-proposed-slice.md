---
id: gap-ownership-semantic-review-of-proposed-slice
title: "independent domain-ownership semantic review of a proposed_slice:
  commit-locked symbol/caller/charter evidence + mechanical ownership facts + a
  blind judge emitting auditable hypotheses, counter-evidence, confidence and
  review/reject/abstain — evaluated on an isolated human-labeled set (advisory;
  no gate change)"
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ownership-active-code-comment-decision-leak
---
**type:** execution

## Proposal

**问题(实测,非推测)**:ArchGuard 0.1.40 发布后,端到端架构自举实验的投研环已能在默认路径上对 gate 四环产出"结构正确"的切法(`evaluated`、SCC 4→3、负对照可证伪、provenance `match`),但**结构正确 ≠ 归属正确**,而现有管线里**没有任何一层判断领域归属**:
- 2026-10-11 三次独立盲测反复收敛到 `gate/config/loader.ts → gate`(把 `discoverWorkspaceRoot`/`loadWorkspaceGates`/`readGatesConfig` 等配置加载与工作区根发现逻辑搬进 gate 引擎):生产 carrier `live:2026-10-11T09-28-34-622Z:1` move 3、隔离运行 `live:2026-10-11T10-11-51-115Z:2`、生产 `live:2026-10-11T10-24-36-709Z:2`。负对照 NC-E 证明 4→3 **全部**来自这一步;一次只读源码的盲审把它判为 ownership-regression;它与 GOAL-034 历史裁定的被否决宽移动同形。
- 隔离运行 `live:2026-10-11T11-03-06-609Z:1`(develop `add3e7318`,0.1.40,provenance `match`,4→3,NC 证伪)提出把 `goal-store`/`adr-store`/`document-store`/`validateContracts` 与 `Task` ABI 类型整体搬进 `kernel`——结构干净,而 kernel 的每个文件头都声明"不 import kernel 以外任何东西"。
准入闸今天只看条件 1-4(类型 / 可证伪 delta / 决策记忆 / 连续 3 轮),一旦 streak 达到 3,上述切法就会被写成 draft 交人——人是唯一防线。本任务补上**一层独立的领域归属语义审查**,输出给人审阅的可审计依据;**本任务只做 advisory(影子)层,不改准入判据**——是否把它升格为第 5 个条件,需要先看本任务的评估读数,留给人裁定(硬规则 12 / 硬规则 4 推论:先测量再设门)。

**设计(三层物理分区,沿用 archguard `arch-layer-review` 的"机械事实 / 声明规则 / LLM 解释"分区纪律,但它是改动后、人驱动、会读提案文档的审查;本任务是改动前、自动、零文档的审查——不重复)**:

1. **证据装配(确定性,commit 锁定)** `docs/analysis/ownership-semantic-review.mjs` 的 `assembleOwnershipEvidence({ root, commit, scopeRoot, slice })`:对每个 move 的每个符号,在锁定 commit 上(`git show`/`git grep`,绝不读工作树)取:声明片段;源文件的 import 语句(分类:node 内置 I/O、第三方、同目录、跨目录及目标目录);调用者(`git grep -w`,限 `scopeRoot`,按目录归组,区分同目录/跨目录);目标目录"章程"证据(目标目录内文件头注释 + 该目录**观测到的**对外 import 边界);搬走后源目录剩余的导出与将被清空的文件。每条证据带 `id/kind/path+range 或 command/sha256`;总字节有上限(复用 `DEFAULT_BUDGET.max_total_evidence_bytes`),截断须显式记录。**所有交给 judge 的文本先过 `redactDecisionReferences`**(依赖任务 `gap-ownership-active-code-comment-decision-leak` 提供),并遵守 `DENY_PATH_PATTERNS`。**bundle 中不得出现任何 SCC/cycle/delta/sccLeft/slice_delta 字段**——结构收益由 ArchGuard 判,归属由本层判,二者不互相替代。
2. **机械归属事实(确定性,无 LLM)** `ownershipFacts(bundle)`:逐 move 给出 `dest_boundary_violation`(目标目录观测边界为"不出本目录"而被搬文件 import 了目录外/非随迁的相对路径)、`io_pull`(被搬文件 import `node:fs`/`node:child_process`/`yaml` 等 I/O,而目标目录现无此类 import)、`source_hollowing`(搬后源目录只剩类型/barrel 或空文件)、`caller_locality`(调用者按目录的分布)。这些是**事实**,不是结论。
3. **盲审 judge(LLM,无工具)** `reviewOwnership({ bundle, facts, invokeJudge })`:judge 以 `--tools ""` 调用(复用投研环的 launcher 接缝,可注入),**输入只有 bundle 与 facts**;输出逐 move 与整体:`responsibility_hypothesis`、`evidence_refs[]`、`counter_evidence_refs[]`、`confidence ∈ {low,medium,high}`、`recommendation ∈ {review, reject, abstain}`。JS 校验:引用的证据 id 必须存在于 bundle,否则该 move 记为 `not-evaluated`(`UNGROUNDED_CITATION`);输出不可解析 ⇒ `not-evaluated`(与 `abstain` 区分);整体合成规则确定性(任一 reject ⇒ reject;否则任一 abstain/not-evaluated ⇒ abstain;全部 review ⇒ review);**带机械边界违例的 move 只有在 `counter_evidence_refs` 引用了该违例证据时才可给 `review`**(强制正面回应反证,而不是覆盖它)。
4. **隔离评估集与评估器** `docs/analysis/ownership-semantic-review-eval.mjs` + `plugin/fixtures/ownership-semantic-eval/cases.json`:标签**只给计分器**,审查函数签名里拿不到标签。目录加入 `DENY_PATH_PATTERNS`,投研器不可读。
5. **advisory 接入**:`ownership-active-limited-proposal.mjs` 新增 `--review`:对最新记录已算出 delta 的候选计算并输出审查;若 `--write` 写 draft,draft 正文附整体建议、逐 move 假设与证据引用。**合格判定逻辑一字不改**。

## AC

- [ ] AC1 证据装配:commit 锁定、限定 `scopeRoot`、遵守 deny-list、经 redact;每条证据有 `id/kind/定位/sha256`;字节上限生效且截断显式记录;对 bundle 做键名扫描,断言不含 `scc`/`cycle`/`delta`/`sccLeft`/`slice_delta`(负对照:人为注入一个 `sccLeft` 字段时测试转红)。
- [ ] AC2 机械事实正/负对照(真实 commit):P1(见 AC4,`gate/config/utils.ts → kernel` @`162f8c380`)`dest_boundary_violation=false`;N1(`gate/config/loader.ts` 的 `discoverWorkspaceRoot`/`resolveWorkspaceRootOrThrow`/`readGatesConfig`/`loadWorkspaceGateMetadata`/`loadWorkspaceGates` → `kernel` @`162f8c380`)`dest_boundary_violation=true` 且 `io_pull` 非空;`live:2026-10-11T11-03-06-609Z:1` 的 stores→kernel 切法 `dest_boundary_violation=true`。
- [ ] AC3 judge 契约:审查函数签名不含标签(结构测试);编造证据 id ⇒ 该 move `not-evaluated`/`UNGROUNDED_CITATION`;不可解析输出 ⇒ `not-evaluated`(≠`abstain`);整体合成规则逐分支有测试;带边界违例而未在 `counter_evidence_refs` 引用之的 `review` 被降为 `abstain`。
- [ ] AC4 隔离评估集:`cases.json` 至少含——**人工标注正例** P1 = GOAL-034 已落地切法(`gate/config/utils.ts`+`types.ts` 的 `shQuote`/`DEFAULT_ACCEPTANCE_TIMEOUT_MS`/`resolveAcceptanceTimeoutMs`/`resolveRunnerOptions`/`GateConfig`/`RunnerOptions` → `kernel`,@`162f8c380`)、P2 = GOAL-033 已落地切法(取 `plugin/fixtures/ownership-active-slice/goal-033-slice.json` 的 moves,@`1ac06fd85`);**人工标注负例** N1(见 AC2,标签来源 = GOAL-034 正文"停止扩大范围的信号"所列被否决的宽移动);以及**派生标签/无标签**的生产候选(上述三次 `loader → gate`、record 91 三步切法、stores→kernel),每条带 `label_source ∈ {human-approved, human-rejected, derived, unlabeled}`,计分时分开统计。`DENY_PATH_PATTERNS` 新增 `^plugin\/fixtures\/ownership-semantic-eval\/`(负对照:投研器 `read_file` 该文件 ⇒ `PATH_DENIED`)。
- [ ] AC5 真实评估运行(默认 launcher,真 judge):全集跑一遍,并对 P1、N1 各重复 1 次报告一致性;逐案记录建议/置信度/引用/机械事实/judge 调用数/bundle 字节/耗时;对人工标注案例给出混淆读数(误报 FP = 对正例判 reject;漏报 FN = 对负例判 review;abstain 单列、不算正确);小 n 只报读数不报比率。**运行前记录 judge prompt 的 sha256;看到结果后若改 prompt,必须全集重跑并同时报告两次**(防止按标签调参)。任何结果都是合法终态。
- [ ] AC6 泄露审计:对每个**实际发送**的 bundle 扫描 holdout 词汇(`GOAL-034`、`ownership-wrong`、`宽移动`、`Holdout B`、`not config-loading`)⇒ 0 命中;正对照:同一审计对一个未 redact 的 `gate/config/types.ts` bundle 必须报警。
- [ ] AC7 advisory 接入不改门:`--review` 开与关时,每个候选的 `eligible`/`reason`/`streak` 逐字相同(测试断言);`--write` 写出的 draft 正文含审查摘要与证据引用;无 `--write` 时不写任何 Goal。
- [ ] AC8 回归:既有 ownership-active / architecture-* 测试与新增测试全绿;`bash scripts/test.sh --for-task gap-ownership-semantic-review-of-proposed-slice` exit 0。

## DoD

`docs/analysis/ownership-semantic-review-report.md` 提交:设计(三分区)、AC5 逐案读数与混淆读数、成本(judge 调用/字节/耗时)、泄露审计结果、prompt sha、以及**留给人的未决判断**——是否把 `reject`(及/或 `abstain`)升格为准入条件 5、以何种证据门槛。⛔ 不改准入判据,不改 streak=3,不创建/激活任何 Goal(advisory 层只在人另行运行 `--write` 且候选已按原四条件合格时附在 draft 上),不向投研器暴露评估集,不从 GOAL 正文为审查器取材(GOAL-034 正文只用于离线标注评估集标签)。

## Touches

- docs/analysis/ownership-semantic-review.mjs (new)
- docs/analysis/ownership-semantic-review-eval.mjs (new)
- docs/analysis/ownership-semantic-review-report.md (new)
- docs/analysis/ownership-active-limited-proposal.mjs
- docs/analysis/ownership-active-contract.mjs
- plugin/fixtures/ownership-semantic-eval/cases.json (new)
- plugin/test/ownership-semantic-review.test.mjs (new)
- tasks/gap-ownership-semantic-review-of-proposed-slice.md
