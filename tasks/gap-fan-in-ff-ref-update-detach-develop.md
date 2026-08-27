---
id: gap-fan-in-ff-ref-update-detach-develop
title: fan-in 目标 develop 脱离主检出——ff 改纯 ref 更新（脏树结构上无关），doc-only 工作分支，架构级替代
  449f111e 的 pre-flight 旁路
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-fan-in-driver-mechanical-orchestration
---
**type:** execution

> **排期（outer 2026-08-27 更新）**：depends_on `gap-fan-in-driver-mechanical-orchestration`（新 SPEC）——本任务改 fan-in-ff-merge.sh 的 ff→ref 更新，须排在 driver 机械编排落地之后，避免与新 SPEC 的 driver-driven ff 冲突。⛔ 非结构前置（本任务可经既有 re-dispatch 落地）。

## Proposal

人提出并要求立案的架构级方案（manager 读码确认），比 `gap-fan-in-ff-merge-benign-runtime-dirty-no-fast-path`（449f111e，pre-flight 良性脏加旁路）**更根本**——若本方案落地，449f111e 可能整条被 supersede（那条是在接受「闸」的前提下加旁路；本方案直接消掉闸存在的理由）。

**核心机制**：`git merge --ff-only` 之所以要求工作树干净，**仅仅因为 develop 被 checkout 在主检出里**（`fan-in-ff-merge.sh:394` `git -C "${root}" merge --ff-only`，root 即主检出）。若 develop **不被任何检出占用**，把它往前推退化为**纯 ref 更新**（`git push . task/x:develop` / `git fetch . task/x:develop`）——不碰任何工作树，主检出脏不脏**结构上无关**。⇒ 比「交集检查」更彻底：交集检查仍需判断、仍可能判错；ref 更新是**结构上不存在这个问题**。

**方案形态**：主检出改停在一条从 develop 创建的分支（manager/outer 的 .md 工作分支）：编辑 → 提交到该分支 → merge develop 进来 → ff 回 develop。

**⚠️ 承重墙（人明确附加）**：禁止在该分支执行需要测试的变更。若该分支带代码，它自己往 develop 合就需要全量 suite，所有问题原样搬家。**限定 doc-only 后**，它的合并永远走已有 doc-only 快速通道、永不需要 suite。**这条可机械强制**：复用现成 `--classify-delta`，非空即拒——不靠自觉，应进 AC。

**47 处 develop 引用（manager 粗分，实现方逐条复核）**：
- A类：仅表达「合并目标是 develop」语义 ⇒ 不受影响（fan-in-ff-protocol-check.ts:295 / worker-driver.ts:747 / fork-baseline.ts:167 等）；
- B类：假设「主检出当前分支 == 合并目标」⇒ 要动的核心（fan-in-ff-merge.sh:189/195 不符即 env-error exit 2，:394 从 merge --ff-only 改 ref 更新）；
- C类：cron 时刻现读 `branch --show-current` ⇒ 行为随主检出改分支而变，需确认可接受（periodic-push-backup.sh:35/101/132/174 备份推「当前分支」会变成工作分支而非 develop——⚠️ 影响备份语义；integration-batch-merge.sh:352/613/621/642 属已退役 classic loop，需先确认是否还活）。

**两个待确认二阶效应（⛔ 未验证，标待确认，不当已知事实用）**：
1. **盘上 `tasks/*.md` 语义会变**：CLAUDE.md 硬规则 11b 记「派发计算读盘上 tasks/*.md 非 git」。主检出改工作分支后，盘上是工作分支视图非 develop。多数无害（manager/outer 的 .md 编辑本就在那），但需逐个确认消费者（ready-pool-check / slot-refill / promotion-driver / web server）。
2. **竞态不消失，只变便宜**：工作分支往 develop ff 仍可能因期间任务落地撞分叉，仍要 merge develop 再重试。但 doc-only ⇒ 重试毫秒级，不再拖整轮全量 suite。⛔ 任务体里不得写成「竞态消失」——那是过度承诺。

## Plan

**阶段一（设计确认，先于实现，⛔ 不直接抢执行）**：① 47 处 develop 引用逐条落到 A/B/C 三类并留理由（尤其 C 类 periodic-push-backup 备份语义 + integration-batch-merge 是否还活）；② 二阶效应①的盘上 `tasks/*.md` 消费者逐个枚举（ready-pool-check / slot-refill / promotion-driver / web server）确认受影响面。**阶段二（实现）**：主检出切到 doc-only 工作分支；`fan-in-ff-merge.sh` 的 ff 动作从 `merge --ff-only` 改 ref 更新（`git push . / fetch .`）；`--classify-delta` 非空即拒（doc-only 机械强制）。

## 实现记录（AC4 分类 + 二阶效应确认，2026-08-27）

**A/B/C 三类分类**（47 处粗分，实现方逐条复核后落类）：

- **A类（仅「合并目标是 develop」语义，不受影响）**：`fan-in-ff-protocol-check.ts`（读锁事件/retry record，判非 ff 用 `--develop <ref>` 显式参数、不假设主检出分支）、`worker-driver.ts:823`（fan-in-execute args 的 `mergeTarget:"develop"` 字面量）、`fork-baseline.ts`（fork 基线默认 develop，ref-aware）、`fan-in-execute.js`（`mergeTarget ?? "develop"`）、`select-static-checks-for-touches.ts` / `runner-static-gate.ts` 等——这些只把 develop 当【分支名】，主检出改停工作分支不影响它们。
- **B类（假设「主检出当前分支 == 合并目标」，已改 dual-mode）**：`fan-in-ff-merge.sh` 的 ff 动作按主检出所在分支 **auto-select**——develop **仍检出** ⇒ 旧 `git merge --ff-only`（clean-tree 检查保留，含 auto-converge + benign-runtime-dirty）；develop **已脱离**（主检出停 doc-only 工作分支）⇒ 纯 ref 更新 `git push . refs/heads/task/<id>:refs/heads/develop`（不碰工作树、脏树结构上无关）。**dual-mode 是过渡**：让机制落地而不破生产（develop 仍检出时走旧 merge 路径），「脱离主检出」激活 + 消费者读法修复排 follow-up。
- **C类（cron/现读 `branch --show-current`，行为随主检出改分支而变，逐项确认）**：
  - `periodic-push-backup.sh:101/132/174`：备份推「当前分支」。✅ 确认：本脚本是 **B 机**周期备份（头注释「B-machine」），跑在 B 机自己的检出上——B 机 checkout 不受本任务「主检出脱离 develop」影响，仍停在 develop ⇒ **备份语义不受影响**。若未来 B 机检出也改停工作分支，需给 `--cron-line` 显式 `--branch develop`。
  - `integration-batch-merge.sh:352/613/621/642`：**已 RETIRED（AC48 2026-08-13，头注释「no production path should invoke it」）** ⇒ 归档、不活、不需改。

**二阶效应①（盘上 `tasks/*.md` 消费者，逐项确认，⛔ 不盲改）**：

- 四个消费者**全部读主检出盘上 `tasks/*.md`（非 git）**：`ready-pool-check.ts`（`--root` 读 tasks 目录）、`slot-refill.ts`（`buildTaskMetaById` readdir+readFile）、`promotion-driver.ts`（经 ready-pool-check `--apply` 读+写）、web server（serve.ts 经 native provider 读 tasks_dir）。
- ⚠️ 确认的受影响面：主检出改停工作分支后，任务经 ref 更新落地（develop ref 前进）**不碰主检出工作树** ⇒ 主检出盘上 `tasks/*.md` 相对 develop **滞后**（已落地任务的 status flip 不在盘上）⇒ 这些消费者读到陈旧视图（已落地任务仍显 ready ⇒ 有重派发风险）。
- ⛔ 结论：**「主检出脱离 develop」的激活动作不随本任务落地**——它要求先把这四个消费者从「读盘上 tasks」改为「读 develop ref（`git show develop:tasks/...`）或等价刷新机制」，否则重派发风险立现。本任务落地【机制】以 **dual-mode**（develop 仍检出 ⇒ 旧 merge 路径，不破生产；已脱离 ⇒ ref 更新路径），激活排到消费者修复的 follow-up。

## Acceptance Criteria

- [x] AC1（能取假，ff 改 ref 更新）：develop 脱离主检出后，ff 退化为纯 ref 更新（不碰工作树），主检出脏树不再阻塞任务 fan-in——生产回放 live-ghost 场景（`message-receipts.jsonl` 脏检出）不再 4 次 exited-not-landed；（⛔ 仍因脏树阻塞 ⇒ 假）。
- [x] AC2（能取假，doc-only 机械强制 + 负控制）：工作分支含代码变更时 `--classify-delta` 非空即拒合并；负控制：真代码变更必须被拒；（⛔ 代码变更放行 ⇒ 假）。
- [x] AC3（能取假，B类保护不破坏）：merge target 错配、非 ff、suite 运行中、锁超时等原有环境错误仍正确 `exit 2` 拒绝；（⛔ 保护退化 ⇒ 假）。
- [x] AC4（能取假，C类 + 二阶效应逐项确认）：47 处 develop 引用 A/B/C 分类逐条留理由；C 类备份语义（periodic-push-backup）+ 二阶效应①消费者枚举（ready-pool-check/slot-refill/promotion-driver/web server）逐项确认受影响面并留理由，⛔ 不盲改；（⛔ 有 C 类/消费者未确认即改 ⇒ 假）。

## Definition of Done

ff 以 dual-mode 落地（develop 仍检出 ⇒ `git merge --ff-only`；已脱离 ⇒ `git push .` ref 更新，auto-select）+ doc-only 机械强制落地；AC1-AC4 全勾；C 类备份语义与二阶效应①消费者逐项确认；live-ghost 场景回放脏树不再阻塞（ref 更新路径）。**「develop 脱离主检出」的激活动作是协调型 follow-up**（机制已落地为 dual-mode；激活要求先修四个消费者读盘上 tasks 的滞后，见实现记录二阶效应①），不随本任务落地。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（ff 改 dual-mode：merge target 已脱离 ⇒ `git push .` ref 更新；仍检出 ⇒ `git merge --ff-only` + clean-tree 检查保留）
- plugin/scripts/develop-work-ff.sh（新：doc-only 工作分支 → develop 的 ref 更新 + `--classify-delta` 机械强制）
- plugin/scripts/capability-catalog.sh（注册 develop-work-ff.sh 六表 + fan-in-ff-merge.sh 描述随 ff 改 ref 更新同步）
- plugin/test/fan-in-ff-merge.test.mjs（改写：ff 改 ref 更新、脏树不阻塞、merge target 脱离）
- plugin/test/develop-work-ff.test.mjs（新：doc-only 机械强制 + 负控制）
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs（develop 脱离主检出）
- plugin/test/fan-in-ff-executor-check.test.mjs（ff-retry 惰性增量测试随 develop 脱离改写）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY scripts 计数 +1）
- tasks/gap-fan-in-ff-ref-update-detach-develop.md（自身）
