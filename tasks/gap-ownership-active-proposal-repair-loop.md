---
id: gap-ownership-active-proposal-repair-loop
title: "ownership-active investigation loop: bounded proposal-repair on
  ArchGuard slice-delta rejection (classify
  evidence_gap/invalid_move/tool_limitation/honest_abstain, retry ≤3 rounds,
  same commit+scope, no new dirs, no source edits, no hardcoded answer)"
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

本任务是「端到端架构自举实验」(用户 2026-10-11 批准推动)的下一刀——承接刚实测的真实读数:当前 produc­tion carrier(`.quay/ownership-shadow-proposals.jsonl`,90 条/21 候选)里,**11/11 次**package-cycle 候选到达 ArchGuard `slice-delta` 这一步都被拒绝(`NO_EDGE_EXPLAINED_BY_MOVES` ×4、`MOVE_TO_NOT_AN_INTERNAL_DIR`(`"model"`/`"gate/contract"`/`"gate/core"`/`"gate/runtime"`) ×4、"切法覆盖不足"(部分符号未被覆盖,拒绝文本已点名具体符号) ×2、其余 1 条),这是 `gap-ownership-active-limited-proposal-mode` 准入门限(§条件2)至今无法满足的唯一真实瓶颈。本任务只做一件事:对这类拒绝做**严格有界的反馈修复重试**,修不成就诚实 abstain——**不改变任何既有安全闸门、不绕过 3 连续轮次准入、不凭空建目录、不改源代码、不硬编码四环答案**。

<!-- dedup-ref -->
去重已查:`tasks/*.md` 无 "proposal repair"/"slice-delta retry"/"move rewrite" 同机制任务(搜索零命中);`gap-ownership-active-investigation-loop-shadow`(done)只建了一次性投研环,从未对拒绝做过重试;`gap-ownership-active-limited-proposal-mode`(done)只读拒绝结果判准入,不修复。两者均不碰,本任务是它们之间的新增中间层。

## Proposal

新增 `docs/analysis/ownership-active-proposal-repair.mjs`:

1. `classifyRejection(sliceDelta)`——纯函数,**枚举、不布尔**(硬规则 3),把一次 `slice_delta` 拒绝归到四类之一:
   - `evidence_gap`——拒绝原因表明判断者缺一个本可查到的事实(目前实测的 11 条真实拒绝里暂未观察到这类样本;模块仍声明该枚举值并给出可触发它的合成样本,如实记录"生产未见,结构上保留"而不是编一个假案例充数)。
   - `invalid_move`——移动集本身不完整/不正确,但**拒绝文本已经携带足够结构反馈去修**:`NO_EDGE_EXPLAINED_BY_MOVES`(有未被任何移动解释的边)、"切法覆盖不足"(拒绝文本已点名具体未覆盖符号)、`MOVE_TO_NOT_AN_INTERNAL_DIR`(目标目录不存在,但 Quay 这边可以查出 scope 内**真实存在**的目录列表反馈回去,✅这一步**不经 ArchGuard**,只用 `grep`/`find` 查当前 commit 的真实目录结构——与 ArchGuard liaison 核实过这不需要 ArchGuard 新增接口)。
   - `tool_limitation`——拒绝本质上是原语能力边界,修复会要求凭空建目录/改源代码才能绕开(如重试后依然只能用一个不存在的目录才能解释某条边)——**不进入重试循环,直接终态为 abstain**,但与下面的 `honest_abstain` 区分记录"为什么不可修"(供 liaison/下一刀参考,而不是和"修过还是不行"混在一起)。
   - `honest_abstain`——**fail-closed 默认值**(硬规则 3b):拒绝文本本身无法解析/不属于已知三类任一 ⇒ 直接判这一档,**不得静默归类为可修**;也是重试轮次耗尽后的最终落点。
2. `attemptRepair({ candidateRecord, root, invokeJudge, maxRounds })`——有界修复会话(`maxRounds` 默认 3,上限硬编码为常量,不接受外部调大):
   - 先 `classifyRejection`;`tool_limitation`/`honest_abstain` **立即**终止,0 轮重试,记录分类理由。
   - `invalid_move`/`evidence_gap`:**锁定同一个 `ref_commit` + `scope_root`**(与原投研轮次完全相同——重试函数接收原始 provenance 并断言不变,改commit/scope 视为编程错误抛异常,不是重试);每轮只把**结构事实反馈**(未覆盖符号列表、真实存在的目录清单、未被解释的边列表——均为可机械核验的图事实,不包含任何历史 GOAL 的"正确答案")喂给同一个无工具纯补全 judge,请其修订移动集;重新跑 `slice-delta`;重新分类;可修复则继续直到计算出通过负对照的 delta 或轮次耗尽;轮次耗尽 ⇒ `honest_abstain`。
   - 每一轮(分类结果、喂给 judge 的反馈文本、judge 的修订输出、新的 slice-delta 读数、本轮成本)都追加写入新载体记录类型 `repair_attempt`(`architecture-evidence-store.mjs` 新增 `appendRepairAttemptRecord`,必填字段同其余三类:`tool/ref/ts/sha256`等,外加 `attempt_no`、`bucket`、`locked_commit`、`locked_scope`)。
3. **不改的红线(逐条可核)**:不触碰 `evaluateEntryBar` 四条件本身、`deterministicGate`/`quotaGate`、run-streak 计算——修复只影响"某一轮的 `slice_delta` 能不能被计算出来",修出来的轮次照旧要过同一套既有门限才可能进入受限提案;修复模块本身**不 import** `fileProposals`/`driveItems`/`fileDecisions`/`proposeDraftGoal`,**不写任何源码文件**,**不新建任何不存在的目录**(重试反馈只能从已存在目录里选,模块对"judge 又提了一个不存在的目录"这一事实本身要能检测并计入下一轮分类,不是信任 judge 说的话)。

## Plan

1. `classifyRejection`:对已实测的 4 种真实拒绝文本模式(逐字匹配已观察到的前缀/子串,不是宽松关键词)做分类测试;对一个编造的、未知形状的拒绝文本做测试,断言落到 `honest_abstain`(fail-closed 默认,不是崩溃也不是误判可修)。
2. `attemptRepair` 的"目录反馈"子函数:对当前 repo(锁定的 commit)用 `git ls-tree`/`find` 列出 scope 内真实存在的目录,构造反馈文本;测试断言该列表只含真实存在目录,不含任何编造项。
3. 有界性与锁定:测试断言 `maxRounds` 超过硬编码上限时被拒绝(不接受外部调大);测试断言 repair 会话内 `ref_commit`/`scope_root` 全程不变,人为篡改任一值时函数抛错而不是悄悄换着跑。
4. **负对照①(tool_limitation 不进入重试)**:构造一个 fixture 拒绝(`plugin/fixtures/ownership-active-slice/repair-tool-limitation-fixture.arch.json`,拒绝本质要求建一个不存在的目录才能解释一条边),断言 `attemptRepair` 0 轮重试直接 abstain,且分类为 `tool_limitation` 不是 `honest_abstain`(两者要可区分,供下一刀参考)。
5. **负对照②(修不成仍诚实 abstain)**:用一个总是重复同一个错误移动的 stub judge(模拟"修不好"),喂一个 `invalid_move` 拒绝,断言 `maxRounds` 轮耗尽后终态是 `honest_abstain`,不是编一个通过负对照的假 delta。
6. **反作弊:不硬编码四环答案**:测试对模块源码做字符串扫描,断言不出现该真实四环重构已知的具体移动字面量组合(如同时含 `driver-vocab.ts` 与 `gate/config` 等已被 GOAL-030~034 实际使用过的符号+目录对)作为写死的捷径;只允许出现在 fixture/测试数据里。
7. **历史 holdout 隔离复核**:测试断言 `ownership-active-proposal-repair.mjs` 不 import/不读取 `docs/architecture/quay-domain-model-2026-10-11.md`、任何 `GOAL-0*.md` 正文、`tasks/gap-*` 任何已完成任务的 body 作为反馈来源——反馈只能来自对当前锁定 commit 的机械查询(git/ArchGuard 只读查询),与 `gap-architecture-evidence-store-and-decision-memory` 已建立的 Holdout A/B 隔离纪律同构,不新增例外。
8. **可复现盲测(fixture,不依赖真实 judge/网络)**:`repair-invalid-move-fixture.arch.json` 构造一个确定性可修复的 `invalid_move` 场景(用 stub judge 第二轮给出正确移动),断言重试后 `slice_delta.status` 变为计算成功且负对照证伪通过;该 fixture 测试可重复运行,不依赖活的 LLM 判断,是"可复现盲测"的主载体。
9. **成本上限**:`attemptRepair` 每轮复用既有 `DEFAULT_BUDGET` 的证据预算量级(不新设更宽的量),总修复会话的 judge 调用次数硬顶 `maxRounds`;测试断言超出发出的 judge 调用计数在耗尽后归零(不会"多试一次")。
10. **集成**:在 `ownership-active-loop.mjs` 的 slice_delta 拒绝分支后挂一个**可选**调用 `attemptRepair`(默认关闭,需显式 `--repair` CLI 标志或选项开启,不改变现有 `--live`/`--replay` 默认行为);开启时,修复后的最终 slice_delta 结果替换原拒绝结果写入 carrier/evidence-store,并附带完整 `repair_attempt` 轮次trail。
11. **真实复跑(live,非 fixture,盲测)**:对当前 develop 尖端用 `--live --repair --rounds 1` 跑一次真实投研+修复,记录最终分类与(若有)修复结果到 `docs/analysis/ownership-active-proposal-repair-replay.md`;如实记录——哪怕结果仍是 `honest_abstain`(大概率,因为已知 11/11 次都是真实结构性拒绝),这也是本任务允许的合法终态,不得为了"有产出"而拼凑。
12. **与 ArchGuard liaison 的对齐记录**:本任务 Proposal 段已记录与「archguard 架构语义映射」会话确认的结论(目录反馈不需要 ArchGuard 新接口,查当前仓库真实目录即可);若该会话回复了不同意见,补一段记录在 DoD 报告里,不是事后口头传达。

## Touches

- docs/analysis/ownership-active-proposal-repair.mjs
- docs/analysis/ownership-active-loop.mjs
- docs/analysis/architecture-evidence-store.mjs
- docs/analysis/ownership-active-proposal-repair-replay.md
- plugin/test/ownership-active-proposal-repair.test.mjs
- plugin/fixtures/ownership-active-slice/repair-invalid-move-fixture.arch.json
- plugin/fixtures/ownership-active-slice/repair-tool-limitation-fixture.arch.json
- tasks/gap-ownership-active-proposal-repair-loop.md

## AC

- [ ] AC1 四类拒绝分类枚举且 fail-closed:对 4 种已实测真实拒绝文本精确分类到 `invalid_move`/`tool_limitation`;对一个合成未知拒绝文本分类到 `honest_abstain`(不是崩溃、不是误判为可修);`evidence_gap` 分支如实标注"生产未见"而非编造样本。
- [ ] AC2 锁定同一 commit+scope:人为传入与原记录不同的 `ref_commit`/`scope_root` 调用 `attemptRepair` 时函数抛错拒绝执行(不是悄悄换着跑)。
- [ ] AC3 负对照①(tool_limitation 零重试):`repair-tool-limitation-fixture.arch.json` 场景下 `attemptRepair` 记录 0 轮 judge 调用、直接 abstain、分类为 `tool_limitation`。
- [ ] AC4 负对照②(修不成仍诚实 abstain):stub judge 重复同一错误移动,`maxRounds` 耗尽后终态为 `honest_abstain`,未产出任何通过负对照的 delta。
- [ ] AC5 可复现盲测修复成功路径:`repair-invalid-move-fixture.arch.json`(确定性 stub judge 第二轮给出正确移动)下,`slice_delta.status` 从拒绝变为计算成功且负对照证伪通过,重试轮次 ≤ 3。
- [ ] AC6 反作弊:对 `ownership-active-proposal-repair.mjs` 源码做字符串扫描,断言不含已知四环重构的具体移动字面量组合(非 fixture/测试文件);同时断言该文件不 import 任何 `GOAL-0*` 正文/`docs/architecture/quay-domain-model-2026-10-11.md`/已完成 `gap-*` task body 作为反馈来源。
- [ ] AC7 真实 live 复跑(诚实终态,不得拼凑):`node --experimental-strip-types docs/analysis/ownership-active-loop.mjs --live --repair --rounds 1` 对当前 develop 尖端跑一次,结果(无论 computed 还是 honest_abstain)写入 `docs/analysis/ownership-active-proposal-repair-replay.md`。
- [ ] AC8 既有机制不回退:`evaluateEntryBar`/`deterministicGate`/`quotaGate`/run-streak 逻辑的既有回归测试(`plugin/test/ownership-active-loop.test.mjs`、`plugin/test/ownership-active-limited-proposal.test.mjs`)在本任务改动后继续全绿。
- [ ] AC9 全量回归绿:`bash scripts/test.sh --for-task gap-ownership-active-proposal-repair-loop` exit 0。

## DoD

`docs/analysis/ownership-active-proposal-repair-replay.md` 提交,记录:四类拒绝分类定义与(若有)已观察到的真实样例分布、两个负对照的读数、一次真实 live 复跑的诚实终态(含成本:轮次/judge 调用数/字节数)、与 ArchGuard liaison 会话核实的结论(是否需要新接口)。⛔ 本任务不新建任何不存在的目录、不改任何生产源码(仅 `docs/analysis/`/`plugin/test/`/`plugin/fixtures/` 范围)、不硬编码四环的真实答案、不触碰 `evaluateEntryBar` 四条件/安全闸门/run-streak 逻辑、不创建或激活任何 Goal/task——受限提案的准入门限与"最多 draft"的红线完全继承 `gap-ownership-active-limited-proposal-mode` 不变。全部新增测试 + 既有回归绿。
