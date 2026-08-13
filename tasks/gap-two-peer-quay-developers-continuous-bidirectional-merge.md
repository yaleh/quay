---
id: gap-two-peer-quay-developers-continuous-bidirectional-merge
title: "TWO PEER quay developers (A/B machines) need CONTINUOUS BIDIRECTIONAL merge of each other's progress — the authority question (who is 'latest' for whom) is UNDEFINED; unlike archguard's one-way 'quay releases, downstream consumes', A and B both develop quay itself; claim-task.sh/branch-model already did TASK CLAIMING + integration branch but NOT bidirectional CODE merge (B's 40+ commits incl new SKILL.md exist only on B; A's master evolves --slot-status etc and B never pulls); human frame correction 2026-08-06 04:5xZ (replaces narrow gap-a-to-b-code-downsync-missing-slot-status-not-on-b which is withdrawn): symmetric 'both machines continuously apply latest and develop on latest', not 'A reaches B' one-way; whether this merges with config-preserving/claim-task/branch-model into one larger design OR stays separate small tasks is the outer ruling requested"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**两个对等的 quay 开发者（A/B 机）需要持续双向合并彼此的进展——「谁对谁是权威最新」未定义。**

**【人框架更正（2026-08-06 04:5xZ，管理者转达）】**：不是「A 的进展能到 B」单向，而是「**两台机器上
的 quay 项目都能持续应用最新版本，并在最新版本上继续开发**」——**对称的**。更深一层：A、B 都在独立
开发 quay 本身（不是 quay 装给下游，是 quay 开发它自己），**谁的版本对谁是权威的「最新」这件事本身
没有定义清楚**——不像 archguard「quay 稳定发布、archguard 下游消费」的单向关系。

**【症状（管理者 B 机实测）】**：`--slot-status` 没传播到 B 机（grep=0），B 重入 A 几小时前已解决的
盲区（5 个在飞括号无法区分真实/陈旧）。这只是一个症状——B 的 40+ 提交（含新 SKILL.md）只存在于 B
工作树，A 的 master 演进也到不了 B。

**【已有机制 vs 缺口】**：claim-task.sh / branch-model 已做**任务认领**（task/<id> 分支）+ **integration
分支**（多源汇入），但**只做了任务认领，没做双向代码合并**。AC15 判据③只覆盖 B→A 备份方向。

**【外层理解（供裁定）】**：这可能不是 config-preserving（安装态套壳）能解决的——是两个**对等**的
quay 开发者需要**持续合并彼此进展**。这比「--slot-status 单点缺失」大一层，且触及**权威模型**这个
未定义的设计决策。

### 选定机制

**裁定方向（外层建议，需人确认权威模型）**：
1. **承认对等**：A、B 都是 quay 的权威来源（非单向主从）——integration 分支就是为「多源汇入」设计
   的，跨主机是它的天然用例（branch-model 已建立）。
2. **双向代码合并**：扩展 claim-task / integration——不仅认领任务，还定期把对方 master 的进展
   合入自己的开发线（对称的 merge）。
3. **权威「最新」定义**：以 integration 分支为两机共识点——谁推 integration 谁推进，冲突在
   integration 层消解（branch-model 已有合并机制）。

## Acceptance Criteria

- [ ] AC1: 双向代码合并机制——A、B 各自能拉到对方最新（对称，非单向）
- [ ] AC2: 权威「最新」有定义——以 integration 分支为共识点（或人裁定的其它模型）
- [ ] AC3: B 机 `--slot-status` 等工具随双向合并到达（原窄任务症状解决）
- [ ] AC4: 与 gap-branch-model-integration-branch（done）交叉标注——integration 分支扩展到双向
       代码合并
- [ ] AC5: 与 gap-a-to-b-code-downsync-missing-slot-status-not-on-b（needs-human 撤回）交叉标注——
       本任务是其正确框架替代

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 实跑：A 能拉到 B 最新 + B 能拉到 A 最新（对称，双向各非零）——`git log` 对比贴出
- [ ] 权威「最新」定义落盘（develop/GitHub 共识点或人裁定的其它模型）并在机制中生效
- [ ] B 机 `--slot-status` 等工具随双向合并到达（grep=0 → 非零）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/claim-task.sh（双向合并同步，扩展 claim-task）+ plugin/scripts/integration-batch-merge.sh（扩展 integration）
- orchestration/manager-phase-goal.md（AC15 扩展：双向合并 + 权威定义）
- tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md（AC4 交叉标注）
- tasks/gap-a-to-b-code-downsync-missing-slot-status-not-on-b.md（AC5 交叉标注）
- tasks/gap-two-peer-quay-developers-continuous-bidirectional-merge.md（自身，C8 self-touch）

## Contract

measure   bidi_sync = `git -C <A> log --oneline <integration>..origin/<B分支> | wc -l` stdout 的 commit 数（双向各自计数：A 见 B 进展 + B 见 A 进展）
band      bidi_sync = 双向都非零（A 能拉 B、B 能拉 A，对称）
invoke    `grep -rn '双向\|bidirectional\|integration.*merge\|权威' plugin/scripts/ orchestration/manager-phase-goal.md`
control   A 拉 B 最新 + B 拉 A 最新都可行（AC1）；权威定义明确（AC2）
resume    双向合并与权威定义分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T05:0xZ
changed: 人框架更正（对称双向 + 权威未定义）替代窄任务。撤回 gap-a-to-b-code-downsync（needs-human
存档），另立本任务。核心：两个对等 quay 开发者持续合并彼此进展；claim-task/integration 已做任务
认领未做双向代码合并；权威模型待人确认。是否并入 config-preserving/claim-task 成更大设计，或保持
分任务——裁定方向：保持分任务（config-preserving=安装态、本任务=仓库层对等合并，机制不同），但
本任务内部整合 claim-task+integration+双向合并。

## 权威模型更新（2026-08-06 05:4xZ，人方向方案已落盘）

**人已给出权威模型裁定**（`orchestration/PLAN-develop-branch-cutover-2026-08-06.md`，待确认未执行）：
- **develop = 跨机汇合点**（唯一），integration 用于持续开发；
- **GitHub = 唯一跨机同步点**（两机都 push/pull GitHub 的 develop，**两机不再直接同步**）；
- **master 冻结**（仅人要求时才从 develop 同步）；
- 任务分支 push 到 GitHub（认领/备份）。

**对本任务的影响**：AC2（权威「最新」定义）有了人裁定输入——develop/GitHub 替代「integration 分支共识」
的建议。双向合并的机制载体从「A/B 直连」改为「各自与 GitHub develop 同步」。claim-task.sh 已
`--remote` 参数化，指向 GitHub 即可（无需改代码）。

**本任务状态**：保持 todo——方案待人确认后，本任务按 develop/GitHub 模式实现双向合并（AC1 双向、
AC2 权威=develop/GitHub、AC3 B 机工具到达）。若方案被拒，回退 integration 共识。

## Evidence（outer 2026-08-12 只读评估——vhs 合并第一实例）

**触发条件**（manager 2026-08-12 与 outer 协商）：cli-import fan-in → 立即评估 vhs 合并；拖过 24h → 先合 vhs 再重构。cli-import 已落地（96ec81c7），触发已满足。

**实测冲突面**（3-way merge-file 实测，非 merge-tree 粗数）：
- `refs/remotes/vhs/integration` = 47543120（领先 96），我方领先 139，真分叉点 a1f8c8e4（14h）
- merge-tree「43 changed in both」→ 实际 **32 真冲突 / 11 自动干净**
- **bin/quay.ts 自动干净**（我方 run()/shell 改 6-344 行区，vhs 改 402-1821，hunk 不重叠）
- 真冲突聚类：tasks 17（add/add 超集类，per-hunk 取并集）/ tick-core 文档 7（orchestrator-loop-tick 8 冲突区）/ plugin scripts 闸 6（fast-mode-telemetry 5、accounting-emit 4、manager-arm 4、integration-batch-merge 2、capability-catalog 2、manager-start 2——验证机件类敏感，读两边意图）/ skills 2 / serve-handlers 3 区
- orchestration/manager-* 双改 4 条（manager-loop-tick/manager-tick-core + plugin/loop/manager-tick-core）——确认「manager 产出重」为持续冲突源

**执行计划**：round 绿后在临时 worktree 做合并（不碰主检出）；tasks 取并集；验证机件类（plugin/scripts 闸）逐块读两边意图，不盲解；合完 scoped 绿 → 全量验证轮 → fan-in。
