---
id: gap-fix-worker-timeout-budget-inherited-from-mechanical-round
title: fix-worker 的 180s 超时预算抄自机械脚本的 ROUND_TIMEOUT_MS——落在 agent 真实时长分布正中，落地后仍 66% 被截断
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-fix-worker-spawn-timeout-persists-post-fix
---
**type:** execution

## Proposal

**这是 `gap-fix-worker-spawn-timeout-persists-post-fix` 修复之后的【残差】,不是它的重复。** 那条任务于 `3278ac8af`(2026-09-07T23:51:20Z)给 `roles.fix-worker` 补上 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS="0"`,把 fix-worker 的干净返回率从 **0**(2026-08-23 起 88 次 spawn 无一干净)拉到 **34%**。本任务处理剩下的 66%。

**读生产载体(`.quay/promotion-round.jsonl`,非 fixture)**:带 `durationMs` 的记录共 **32** 条,全部落在上述修复之后(2026-09-08T22:51:03Z → 2026-09-14T08:03:14Z),且 **32/32 的 argv 里都带 `BG_WAIT_CEILING` 键**(⇒ 上一条修复确在生效,本任务的读数是它之后的干净窗口)。其中:

- 干净返回 **11** / 超时 **21**
- 干净返回的时长(秒):63.7 / 88.0 / 107.5 / 118.6 / 147.8 / 148.9 / 154.0 / 157.7 / 161.2 / 163.2 / **173.0**;中位 **149s**,**最大值距 180s 上限只差 7 秒**
- 超时的 21 条全部截断在 ~180.4s(min 180363ms / max 190667ms)

**成因(附区分性对照)**:`plugin/scripts/promotion-driver.ts:111` 的 `FIX_WORKER_TIMEOUT_MS = 180_000` 与 `:107` 的 `ROUND_TIMEOUT_MS` 同值,`:110` 注释写明这是刻意复用、理由记作「⛔ 不为 fix worker 另设阈值——硬规则 4 推论」。**但 `ROUND_TIMEOUT_MS` 约束的是 `ready-pool-check`——一个零 LLM 的机械脚本;fix-worker 是一次 `claude -p` agent 调用。** 硬规则 4 推论要求的是「先分解成本再谈指标」,此处被执行成了「复用一个为别的对象测过的数」。
同族直接量对照:真正的 ready→done worker(同为 claude agent)墙钟中位 **1687s**,仅 62/1937(**3.2%**)能在 180s 内跑完。
**若成因为假会看到什么(反向指标)**:若这些超时是另一种失败模式(挂死/卡在某一步),干净返回组应聚集在远低于上限处、并与上限之间留出空档;实测是 **63s → 173s 连续铺满并顶住上限**——这是阈值切过连续分布中部的形状,不是双峰。

**⚠️ 已被证否、本任务不再采信的成因**:`[claude-code:unrecognized_model]` 已由 `gap-fix-worker-spawn-timeout-persists-post-fix` 的负控制证否(换 SDK 已知模型名 6.1s 干净报错退出,不挂)。本轮补一条同向读数:**落地后 11 次干净返回中 11/11 都带这行警告** ⇒ 它在成功与失败记录里同样出现,不是判据(硬规则 2)。

**⚠️ 一条会误导实现者的既有读数，已复算证否**：`gap-goal-gap-filing-spawn-budget-too-small-ring-spins-empty`（done）的对照表（该任务体第 53 行）记 `| promotion-driver fix-worker | 180s | 最近 400 轮 266/266 零超时 |`，并据此论证「同一个数字对 fix-worker 100% 够、对 gap-filing 100% 不够」。**该读数在同一载体上不复现**：`.quay/promotion-round.jsonl` 最近 400 轮的 `fixes[]` 条目共 **684** 条，其中 **672 条是 `spawned:false`**（根本没起进程 ⇒ `timedOut` 结构上恒 false，与「跑完且没超时」同形），真正 `spawned==true` 的只有 **12** 条、其中 **10 条超时（83%）**。⇒ 那个「零超时」计数把**非事件**计成了成功——硬规则 4「一个结构上不可能取假的量，不是测量」，同时也是硬规则 3b「读不懂/没发生 不得与合格同形」。**⛔ 实现者不要据该表认为 fix-worker 的 180s 预算是够的。** 该表对 goal-driver 那一半（gap-filing agent 3/3 全超时、放宽到 900s 后单次 602.9s 成功）有独立的区分性对照支撑，**不受本条影响**，其「⛔ 不要换成另一个写死的数字、应接成配置项」的结论对本任务同样适用。

**旋钮缺失**:`spawnFixWorker(argv, root, timeoutMs = FIX_WORKER_TIMEOUT_MS)` 的第三参数**全仓库无一调用方传值**,也没有 env / CLI / profiles.yml 覆盖路径 ⇒ 换机器、换模型、换 prompt 规模后,这个数只能改代码(硬规则 4 推论二:依赖宿主/外生条件的字面值不应写死)。

**第二半:超时被杀之后【晚到的落地】——列为待查,⛔ 不作结论**

- **已确证的一半**:生产记录里存在 `"ok":true` + `exit=null (timed-out)` + `(fix landed — reverified eligible)` 的条目共 **12** 条 ⇒ 超时的 fix worker 确实可能已把活干完。**但这 12 条进的是 `nowEligibleIds`,没有烧重试——`advanceRetryCap` 只吃 `stillIneligibleIds`,这部分记账是正确的**(立案时曾误判为「白烧的重试」,在此更正)。
- **未确证的一半**:`gap-rework-multiplier-predictors` 实测——round185 的 fix worker 于 05:00:26Z 被杀、reverify 判 stillIneligible(烧掉第 1 次重试),而该任务文件补 `(new)` 标注的提交 `c6ebc6c5b` 落在 **05:05:16Z**(晚于 kill 约 290s);round188 起始闸(约 05:03)读到的仍是旧状态,又派了一次 fix。**但 round189 的起始闸(约 05:12,已晚于 05:05:16)仍报 `touchesResolve=false`,而同一版本文件现在直接跑 `touches-orthogonality-check.ts --resolve` 是通过的(0/2 non-tagged missing)** ⇒ 这一步对不上,归因未闭合。**⛔ 不得作为结论投递,见 Plan 步骤 3。**

## Plan

1. 把 `FIX_WORKER_TIMEOUT_MS` 与 `ROUND_TIMEOUT_MS` **解耦**(两个成本结构不同的对象不共用一个字面量),并给它一条可覆盖路径(env 或 `.quay/profiles.yml` 的 `roles.fix-worker`),⛔ 不再写死。
2. ⚠️ **不要拿现有的「中位 149s」去定新值**——该分布已被 180s **右截断**(66% 落在截断点上),这个中位是幸存者的中位,不是真分布的中位。先给一个明显宽松的值(如 600s)跑一段真实窗口,拿到**未截断**的分布之后再收敛(硬规则 4 推论:成本结构未知前不设数值阈值)。
3. 查清 Proposal 第二半的未闭合归因:round189 起始闸为何在 `c6ebc6c5b`(05:05:16Z)之后仍报 `touchesResolve=false`。**必须给出一个能区分的对照**(例如:取该时刻的文件版本 + 同一 `--root` 重放一次闸;或核对 promotion-driver 当时读的工作树/分支是否与该提交所在的一致——已知线索:`.quay/store-commit-propagation.jsonl` 记该次 task_write 为 `propagated:false` / `branchClass:"other"`)。给不出区分性对照 ⇒ **降为观察项,不阻塞步骤 1**(硬规则 12 / 推论四)。
4. 仅当步骤 3 证成「晚到的落地被记成失败」时,才改记账:让「超时但工作树/任务文件已变更」与「真的没修」**三态可区分**(⛔ 不与合格同形,硬规则 3b),落点在 `promotion-driver.ts` 的 reverify/`advanceRetryCap` 调用处(`:762` 附近),必要时及 `driver-filters.ts`。

## Acceptance Criteria

- [ ] **能取假**:`FIX_WORKER_TIMEOUT_MS` 不再等于/引用 `ROUND_TIMEOUT_MS`,且存在一条可覆盖路径——传/设一个显著不同的值(如 5000ms)能让一次真实 spawn 在该值附近超时;**负控制**:不传时仍走默认值(两次读数都贴进 `## Resolution`)。
- [ ] **生产载体取真,只计落地之后的窗口**:实现落地后 `.quay/promotion-round.jsonl` 新产生的 fix 记录中,`spawned==true && timedOut==false` 的比例 **> 34%**(落地前基线 = 11/32,时间窗 2026-09-08→2026-09-14)。⛔ fixture / 注入记录不算,N 只计实现落地之后(硬规则 4 推论三)。
- [ ] **未截断分布已取到**:放宽后的记录中出现 **≥3 条 `durationMs > 180000` 的干净返回** ⇒ 证明此前那批超时里确有一部分只是「没跑完」,而非挂死(这条同时是成因判断的事后对照)。
- [ ] **步骤 3 有交代**:归因要么闭合(区分性对照的实际输出贴进 `## Resolution`),要么显式写明降为观察项及理由。⛔ 不静默省略。
- [ ] `bash scripts/test.sh --for-task gap-fix-worker-timeout-budget-inherited-from-mechanical-round` 全绿,且新增/改动的用例在该轮**被实际选中执行**(按测试名核对,不看总数)。
- [ ] `node plugin/scripts/task-schema-check.ts tasks/gap-fix-worker-timeout-budget-inherited-from-mechanical-round.md` exit 0。

## Definition of Done

fix-worker 的超时预算由**它自己被测量过的成本结构**决定,而不是从一个机械脚本的预算继承;该值有可覆盖旋钮;生产载体上干净返回率相对 11/32 的基线有可读提升,且读数落在实现落地**之后**的真实运行窗口。⛔「把数字改大了」「单测绿了」不算达成——上一代同族任务(`gap-fix-worker-spawn-inherits-unrecognized-model-deepseek-v4-pro-anthropic`)正是这样达成然后被生产读数证否的。若 Plan 步骤 3 证成晚到落地,则记账三态可区分亦须落地。

## Touches

- `plugin/scripts/promotion-driver.ts`
- `plugin/scripts/driver-filters.ts`
- `plugin/test/promotion-driver.test.mjs`
- `plugin/test/driver-filters.test.mjs`
- `.quay/profiles.yml`
- `tasks/gap-fix-worker-timeout-budget-inherited-from-mechanical-round.md`
