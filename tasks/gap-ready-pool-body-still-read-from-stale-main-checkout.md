---
id: gap-ready-pool-body-still-read-from-stale-main-checkout
title: 闸的 task body 仍从主检出磁盘读（status 那一维早已改读 develop 权威 ref）——propagate 失败时闸连读旧体烧满重试
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**已确证一例(2026-09-14 manager 复核,读生产载体 + 历史重放,非猜测)**:`gap-rework-multiplier-predictors` 被翻 needs-human 的真正原因不是立案质量,而是**闸连续三轮读到了过期的任务体**。

| 时刻 | 事件 |
|---|---|
| 04:47:15Z | 立案 `c21a93310`,`## Touches` 的 3 个新文件未标 `(new)` |
| ~05:00Z round185 | 闸判 `missing:["touchesResolve=false"]` ⇒ 派 fix worker ⇒ 超时 ⇒ 烧第 1 次重试 |
| **05:05:16Z** | **`c6ebc6c5b` 补上 `(new)` 标注——修复已完成** |
| 05:05:17Z | `.quay/store-commit-propagation.jsonl` 记该次 task_write **`propagated:false`**、`branchClass:"other"` |
| ~05:09Z round188 | 闸**仍**判 `touchesResolve=false` ⇒ 再派 ⇒ 超时 ⇒ 第 2 次 |
| ~05:12Z round189 | 闸**仍**判 `touchesResolve=false` ⇒ 再派 ⇒ 超时 ⇒ 第 3 次 ⇒ **翻 needs-human** |

**区分性对照(历史重放,硬规则 4 推论四)**:把两个历史版本的 body 喂进**同一个** `checkTaskTouchesResolve`、**同一个** root:
```
立案版 c21a93310（无 (new)）=> mustExist:5 missing:3 majorityMissing:true  ⇒ touchesResolve=false
修复版 c6ebc6c5b（有 (new)）=> mustExist:2 missing:0 majorityMissing:false ⇒ touchesResolve=true
```
⇒ 修复版**结构上就能过闸**。若「闸读的是最新 body」为真,round188/189 的读数应与重放一致;实测不一致 ⇒ **该前提为假,它们读到的不是修复版**。

**成因落在代码自己的注释上**:`ready-pool-check.ts:2315` 用 `fs.readdirSync(tasksDir)` 从**主检出磁盘**构建 `allTasks`,`:2442` 的 `checkTaskTouchesResolve(task.body, root)` 等 body 维度判定全部消费它。而**同一文件 `:1913` 的注释已写明这是「硬规则 4b 的陈旧代理量」**,并说明 **status 那一维早已改读 canonical develop ref**(`readTaskStatusAtRef`,由 `gap-ready-pool-depends-on-status-stale-read` / `gap-dispatch-reads-stale-main-checkout-task-status` 一族修过)。
⇒ **硬规则 5b 的标准形态:同一个原则只落实到了被报出来的那一维(status),body 这一维漏了。** 而 body 恰恰驱动 `touchesResolve` / `fourArtifacts` / `touchesNarrow` / `selfTouch` 四个晋升判据。

**⚠️ 发生率已测,且它【不支持】大动读源(硬规则 12,立案当轮给出,⛔ 不推给 AC)**:
- `.quay/store-commit-propagation.jsonl` 全量 **592** 条,`propagated:false` **71** 条(**12%**),涉及 **56** 个唯一 task;最近一次 2026-09-14T10:05:40Z ⇒ **前置条件很常见且仍在发生**。
- **但交叉表显示它几乎从不致命**:27 次 needs-human 翻转中,翻转前 60 分钟内该任务有过 `propagated:false` 的**只有 1 次(4%)**——就是本条。
- **负控制**:propagate 失败涉及的 **56 个任务里,最终被翻 needs-human 的只有 1 个**。
⇒ **机制为真、影响面实测 = 1 例。** 因此本任务**刻意取窄范围**:先把那条痕迹接进可观测/可判定,⛔ 不在这一轮改 body 读源。
⚠️ 上述交叉表只能抓到「同一 task 在翻转前 1 小时内有 propagate 失败记录」的形态;若陈旧来自别的路径(例如提交落在某个 worktree 而根本没产生 propagation 记录),它抓不到 ⇒ **1/27 是下界,不是真值**(硬规则 5 来源完备性)。

**第二个半边:`propagated:false` 有人写、没人读。** 落痕机制本身工作正常(由 `gap-doc-develop-sync-semantic-conflict-resolution` 修好),但**没有任何判据消费这条痕迹** ⇒ 一次失败的 propagate 可以静默地让闸连续几轮用旧 body 判定。

## Plan

1. **先做窄的一半(本轮范围)**:让 `propagated:false` 被消费——propagate 失败后须有一个**能取假**的后续动作。最低限度:让闸对该 task 报**「未评估」而非照旧用旧 body 判定**(三态可区分,硬规则 3b);或接一次重试/升级语义兜底。
2. **宽的一半只在证据到位后才做(⛔ 本轮不做)**:把 body 维度改到与 status 同一个权威读源。触发条件 = 上面那张交叉表的命中数**超过 1**(即出现第二个独立案例),或步骤 1 的「未评估」态在生产上被触发超过 N 次(N 由步骤 1 的读数定,⛔ 不预设数字)。
3. ⚠️ **步骤 2 有一个反向陷阱,动手前必须先取读数**:闸改读 develop ref 后,**「刚在主检出写下、尚未 propagate 的合法新任务」会不会被读成不存在**?(写面保留 author 是人 2026-08-31 的裁定 ⇒ 这种任务是常态,不是边角。)给不出这个反向案例的读数 ⇒ **不得改读源**。
4. 若步骤 2 最终要做,须覆盖 **四个维度而非一维**(`touchesResolve` / `fourArtifacts` / `touchesNarrow` / `selfTouch`)——硬规则 5b,这正是本缺陷的成因,⛔ 不要用同一个错误去修这个错误。

## Acceptance Criteria

- [ ] **能取假的复现**:构造一个 body 在主检出与 develop 不一致的对象,闸对它某个 body 维度的判定**随读源不同而不同**;**负控制**:两侧一致时两种读源给出**相同**判定。两次读数都贴进 `## Resolution`。
- [ ] **痕迹被消费(步骤 1)**:存在一条能取假的判据,证明 `propagated:false` 已接进某个动作,且输出词表里有**独立的「未评估」取值**(⛔ 不与「合格」同形——硬规则 3b)。判据:人为制造一次 propagate 失败后,闸对该 task 的输出与正常态**可区分**。
- [ ] **范围纪律写进产物**:`## Resolution` 里写明本轮**没有**改 body 读源、以及触发宽修法的条件(交叉表命中数 > 1),⛔ 不得顺手扩大到步骤 2。
- [ ] **反向陷阱已验(仅当本轮真要动读源时才需)**:若实现者判断必须提前做步骤 2,则 Plan 步骤 3 的反向案例读数必须先贴进 `## Resolution`;不做步骤 2 则本条记 N/A 并写明理由(⛔ 不静默跳过)。
- [ ] `bash scripts/test.sh --for-task gap-ready-pool-body-still-read-from-stale-main-checkout` 全绿,新增用例在该轮**被实际选中执行**(按测试名核对,不看总数)。

## Definition of Done

`propagated:false` 不再是一条无人消费的痕迹——闸在读源可能陈旧时给出**可区分的第三态**,而不是拿旧 body 照判;范围纪律(本轮不改读源、宽修法的触发条件)写在产物里。⛔「把 body 读源改了」不是本轮的达成条件,反而**超范围**;⛔「单测绿了」不算——AC1/AC2 的读数须来自真实可区分的对照。

## Touches

- `plugin/scripts/ready-pool-check.ts`
- `plugin/test/ready-pool-check.test.mjs`
- `tasks/gap-ready-pool-body-still-read-from-stale-main-checkout.md`
