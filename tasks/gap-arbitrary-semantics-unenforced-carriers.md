---
id: gap-arbitrary-semantics-unenforced-carriers
title: 武断实现语义缺可执行承接：⑬ 计数规则无单实现守卫 / ⑥⑦⑧ 冲突消解只活在 prompt 散文 / ⑫⑭ 载体未定位
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：与 DSI（Domain Semantic Induction）会话「quay 软件开发领域模型」的三轮讨论，经双方逐条核载体后收敛。DSI 的 14 条候选原子中，**只有 1 条是真正的代码重复风险**（⑬），3 条是「散文承载、未被强制执行」（⑥⑦⑧），2 条（⑫⑭）在讨论表里的载体引用是错的、尚未定位。其余 8 条（①②③④⑤⑨⑩⑪）已具名集中 / 已自述 / 只需可发现性，**本任务不处理**，证据留在 `## Evidence` 附录。

核心判断：这批原子的真正问题不是「没写清」，而是**没有可执行承接**——一条语义要么由代码执行、要么由检查器断言，否则它只是散文，而散文会被改写掉（ADR-004）。已实证的形态：⑥⑦⑧ 的规则活在 `plugin/scripts/worker-driver.ts:2966-2982` 的 prompt 字符串里，守卫是 `plugin/test/worker-driver-resident-s07.test.mjs:57-59` 的 `assert.match(p, /judge WHICH side deleted/)`——**断言字符串在场，不验行为**；worker 不照做，套件仍绿（硬规则 9：可见性 ≠ 执行）。

⛔ **明确排除的验收口径**：不以任何「|D| 下降 / 原子数减少」作为完成证据。|D| 只是已捕获子集（残差 R≈100、覆盖率 13%），压它最省力的路径是写散文让它离开 D，方向与目标相反。另：DSI 的 held-out ΔG 为负（跨项目 −6.9pp / worker −25pp），双方已同意「验证前不拿 D 当重构罗盘」，本任务也不引用其度量。

## Plan

**1. ⑬ 计数规则补「只允许一个实现」守卫。**
现状：`plugin/freshness-producers.json:38` 是唯一声明；`plugin/scripts/freshness-producer-coverage-check.ts:339` 读它；`plugin/test/freshness-distance-counting.test.mjs:361` 用「改声明 → 判决跟着动」证明了派生。但**没有任何检查阻止有人手写第二份计数规则**。做法：新增/扩展现有 checker，枚举仓库中「提交数 → 速率」计数的实现点，要求恰好 1 处且必须读 `delivery_face.command`；第二处出现即红。

**2. ⑥⑦⑧ 冲突消解协议从散文变成可执行承接。**
现状载体 `plugin/scripts/worker-driver.ts:2966-2982`：⑥=规则 (3) dual-copy、⑦=规则 (5) modify/delete、⑧=规则 (1)/(4) outline/tick doc。二选一（可混用）：
- **(i) 机械化**：把可机械判定的部分移进 driver 执行（如 dual-copy 两副本 byte-identical 同步、modify/delete 的删除侧判定、outline/tick doc 直取 develop）；
- **(ii) 契约检查**：对仍必须由 agent 执行的部分，用 `drive-contract-check.ts` 的手法断言**行为发生**，而不是字符串在场。
⛔ 只把 prompt 写得更醒目、或再加一条 `assert.match` 都不算。

**3. ⑫⑭ 载体重新定位并纠正错误引用。**
已确证的错误：`plugin/scripts/checker-io.ts` 是 `DriverResult` ↔ exit code 的三义映射，**不是**「同签名红先看 checker 自身 exit 0」；`packages/quay/src/goal-merge.ts:177` 的 `not-evaluated` 是 ⑩ 的载体，**不是** ⑭（探针失败 ≠ 套件红）。本步交付：⑫（同签名红 3 轮 ⇒ 被红 checker 自身 exit 0 ⇒ 欠 re-anchor）与 ⑭（探针失败只落 Fact failed/not-evaluated）的真 `file:line` + 当前承接方式；若发现同 ⑬ 的单实现风险，追加为独立 AC 或后继任务，不在本任务里顺手扩大范围。

## Acceptance Criteria

- [x] AC1: ⑬ 单实现守卫落地且**能取假**——正臂：现状恰好 1 处实现、检查通过；负臂：注入第二份手写计数实现后该检查**必红**（任务体给出命令与红输出逐字）。
  - 命令（正臂，绿）：`node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --counting-rule-single-implementation --root <worktree> --json` ⇒ `"evaluated": true, "ok": true, "implementations": ["plugin/scripts/freshness-producer-coverage-check.ts"]`（exit 0）。
  - 命令（负臂，红）：往 `<tmp>/plugin/scripts/second-counting-rule.ts` 注入含 `rev-list --count --no-merges --merges merge-tree --write-tree` 的第二份实现后重跑 ⇒ `"ok": false, "implementations": [2 个]`，`"reason": "1 finding(s): 2 counting-rule implementations found (exactly 1 required): plugin/scripts/freshness-producer-coverage-check.ts, plugin/scripts/second-counting-rule.ts"`（exit 1）。
- [x] AC2: ⑥⑦⑧ 至少规则 (3)(4)(5) 有可执行承接——机械化或契约检查二选一；负臂：删掉/改错对应规则后检查**必红**（证明它不再只断言字符串在场）。
  - 载体：新增 `plugin/scripts/conflict-resolution-rules.ts`（决策 `conflictAction` 按位置判 (3)(4)(5) + 真 git 执行 `resolveConflictMechanically` + CLI `--judge`/`--resolve`）；规则的可执行承接由该模块 + 行为测试承担，⛔ 不靠 prompt 字符串（`worker-driver.ts` 未改——避免 prompt 变长触发 `gap-worker-prompt-note-family-slimming` 的 25% 棘轮）。
  - 命令（行为正臂，绿）：`node --experimental-strip-types --test plugin/test/worker-driver-resident-s07.test.mjs` ⇒ 8 pass / 0 fail，其中 3 条 AC2 用例：conflictAction 位置判定（dual-copy-sync / take-develop / delete-side / manual）、resolveConflictMechanically 真跑 `git checkout develop --` / `git rm` / 两副本 byte-identical 同步、负臂。
  - 命令（负臂，红）：把 `conflict-resolution-rules.ts` 的 `new Set(["DU", "UD"])` 改成 `new Set([])` 后 `node --experimental-strip-types <mutated> --judge tasks/x.md DU --json` ⇒ `"kind": "manual"`（exit 1），不再 `"delete-side"`——证明检查验的是行为不是字符串在场。
- [x] AC3: ⑫⑭ 的真载体在任务体 `## Evidence` 中逐个写明 `file:line` + 当前承接方式，并逐字纠正 `checker-io.ts` 与 `goal-merge.ts:177` 两处错误引用。
  - 见 `## Evidence` 的 ⑫⑭ 两条：均已写明真 `file:line` + 当前承接方式，并逐字纠正两处错误引用。

## Definition of Done

- 三条 AC 全部勾选，每条附**可复跑的命令与读数**（⛔ 不是「文件存在」或「测试绿了」）。
- `scripts/test.sh --for-task gap-arbitrary-semantics-unenforced-carriers` 绿；全量 suite 不回归。
- 改动落在生产载体：AC1/AC2 的检查进 `plugin/scripts/` 并被 test.sh 覆盖；AC3 的结论写进任务体，不是只写在会话里。
- ⛔ 完成证据中不得出现「|D| 下降」或类似计数下降。

## Evidence（附录：不单独立项的 4/5 类，均为已核载体）

- ① cleanTreeCheck：`packages/quay/src/fan-in/ff-merge.ts:240`（调用点 `:885`）
- ② attemptKey：`plugin/scripts/worker-fan-in.ts`（讨论表记 `:3715-3720`，待复核）
- ③ ffMode 两行派生：`packages/quay/src/fan-in/ff-merge.ts:881`
- ④ 锁域派生：`plugin/scripts/worker-fan-in.ts:1850` `fanInLockFileForMergeTarget`
- ⑤ ac-precheck：`plugin/scripts/worker-fan-in.ts:3288-3306`；reason 逐字已含「suite 前 fail-fast 拒翻」，且在 `suite-start`(`:3308`) 之前 return ⇒ 自述已存在，只剩「是否到人可见面」待验
- ⑨ `propagateDocBranchToDevelop` 唯一定义：`plugin/scripts/driver-filters.ts:1301`
- ⑩ sufficiency 人可见：`packages/quay/src/cli/goal.ts:409` / `:413`，说明在 `packages/quay/src/cli/help.ts:626`
- ⑪ `activeGoalIdsOf`：`plugin/scripts/goal-driver.ts:2148-2155`（⛔ 注意 `:876-888` 的 `inScopeAcsOf` 是 `{active,achieved,needs-human}` 另一个口径，勿混）
- ⑫ 真载体（同签名红 3 轮 ⇒ 先看被红 checker 自身 exit 0 ⇒ 欠 re-anchor）：`plugin/scripts/worker-fan-in.ts:1529-1559` `decideBaselineRedCircuitBreaker`（`LOOP DEADLOCK` 诊断在 `:1551`，`No other task in the carrier shares this signature yet` 分支在 `:1555`——「看似死锁」的形状）+ `plugin/scripts/sh-census-check.ts:874-877` `judge()`（`ok: over.length === 0 && shrink.raised.length === 0`）与 `:954-955`（`verdict.ok ? 0 : 1`）。区分信号：downward 普查移动（把文件移出 census 总体）时 checker 自身 exit 0（缩限合法），只有测试的 equality 断言红 ⇒ 是「欠 re-anchor」，不是 peer 死锁。
- ⑭ 真载体（探针失败≠套件红，只落 Fact failed/not-evaluated）：`plugin/scripts/probe-routine.ts:95`（载体 `.quay/routine-findings.jsonl`）、`:31-32`（「⛔ NOT a hot-path gate … The ONLY caller is the quality driver's routine table」= 结构上不进 fan-in/套件）、`:1079-1080`（spawn error ⇒ `fact("failed")`）、`:1088-1089`（FILE-ONLY guard 读不懂 ⇒ `fact("not-evaluated")`）、`:1092-1094`（FILE-ONLY 违约 ⇒ `fact("failed")`）、`:1098-1110`（探针输出读不懂 ⇒ `fact("failed")`）。
- ⛔ 纠错 1：`plugin/scripts/checker-io.ts` 是 `DriverResult` ↔ exit code 的三义映射（`driverResultToExit` `:48-57`：verified→0 / failed→1 / not-evaluated→2），**不是**「同签名红先看 checker 自身 exit 0」——那是 ⑫，真载体见上条。
- ⛔ 纠错 2：`packages/quay/src/goal-merge.ts:177` 的 `not-evaluated` 是 `readGoalSufficiency`（⑩ sufficiency 人可见，`covered | insufficient | not-evaluated` 三态之一）的载体，**不是** ⑭——⑭ 是探针失败落 Fact failed/not-evaluated，真载体见上条。
- 来源正本（只读，不在本仓）：`~/.claude/domain-semantic-induction/METHODOLOGY.md`、`~/.claude/domain-semantic-induction/gate-result-validity/D-slices-confirmed.md`
- 该轴仍暗,理由:本任务新增一个纯库模块（conflict-resolution-rules.ts，只 import node 内建 + gate-script-base）+ 一个 checker 模式 + 测试，未改 packages/ 依赖结构、未新增跨层 import，未运行 archguard ⇒ 无本任务可归因的 L_D/L_G 数值读数。

## Touches

- plugin/scripts/freshness-producer-coverage-check.ts
- plugin/test/freshness-distance-counting.test.mjs
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver-resident-s07.test.mjs
- plugin/scripts/conflict-resolution-rules.ts
- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-arbitrary-semantics-unenforced-carriers.md

## Needs-Human

**执行 2026-11-05T16:44:45.467Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: oom-killed (2) — recovery red set is NOT a subset of the develop baseline red set: added=plugin/test/full-suite-runner-cgroup.test.mjs changed=- — needs a code fix
- run_id：wk-prod-anchor
- session_id：07da625a-d056-4975-b056-cc8f0153a06e
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-arbitrary-semantics-unenforced-carriers~wk-prod-anchor~1793896230415-427678.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-arbitrary-semantics-unenforced-carriers-wk-prod-anchor.log