---
id: gap-loop-driver-check-ac3-layer2-cron-observability
title: "loop-driver-check AC3 LAYER 2: 'registry has a row but the driver is
  dead' must not report LIVE — layer-1 (self-declared registry) structurally
  cannot distinguish real drivers from stale rows (registry is self-declared,
  cron is session-internal, bash checker can't see session cron list); layer-2 =
  swap to an OBSERVABLE source (CronList output / session-internal task list)
  whose precondition is UNANSWERED: 'can a bash checker see session-internal
  cron?' — not guessed before answered; carried from gap-the-loop-driver-check
  (done, AC3 explicitly recorded unsolved per its own DoD)"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**loop-driver-check AC3 第二层：把「注册表一行、驱动已死」的判据换成可观测来源。**

**【来自亲代（gap-the-loop-driver-check，done，AC3 显式未解决）】**：第一层（文档补注册 + gitignore +
STALLED 措辞）**在结构上分辨不了「注册表有一行、但那个驱动早已不存在」**：

1. **注册表是自述的**——`loop-driver-check.sh` 只数 `.quay/loop-driver.jsonl` 的行，不观测任何
   真实驱动；
2. **cron 是会话内的**（tick 文档自己写着「会话一结束就没了」），bash 检查器**看不到**会话内的
   cron 列表；
3. 已实证的观测路径（dead-loop-check 的 transcript 时间窗）属于 L2 持续健康判据，接进来是**换判据**，
   正是第二层要做、第一层不许顺手猜的事。

**第二层范围**：判据换成**可观测来源**（CronList 输出 / 会话内任务列表），让「一行注册但驱动已死」
能被机械判定。**前置问题未答——不猜实现**：bash 检查器能否看到会话内的 cron？

### 选定机制

1. **回答前置问题**：bash/脚本能否观测到会话内 cron（CronList 的会话可见性）——实测确定
2. 若能：把判据换成 CronList/会话任务列表的可观测来源，陈旧注册不再报 LIVE
3. 更新 `plugin/test/loop-driver-check.test.mjs` 的层 1 pin 测试（亲代明示：未来第二层改动须同步更新）

## Acceptance Criteria

- [ ] AC1: 前置问题回答——bash 检查器能否看到会话内 cron（实测，贴证据）
- [ ] AC2: 判据换成可观测来源——「注册表一行、驱动已死」不再报 LIVE（实测构造）
- [ ] AC3: 与 gap-the-loop-driver-check（done）交叉标注——本任务承载其 AC3（## Carries）
- [ ] AC4: loop-driver-check.test.mjs 层 1 pin 测试同步更新（亲代要求）

## Touches

- plugin/scripts/loop-driver-check.sh（判据换成可观测来源）
- plugin/test/loop-driver-check.test.mjs（层 1 pin 测试更新）
- tasks/gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes.md（AC3 交叉标注）

## Contract

measure   stale_registry_exit = `bash plugin/scripts/loop-driver-check.sh --check 2>&1 | grep -c 'LIVE\|STALLED'` stdout 数字段（构造「注册表一行、驱动已死」形态）
band      stale_registry_exit = 0（陈旧注册不再报 LIVE；判据基于可观测来源）
invoke    `grep -n 'CronList\|会话内\|可观测\|cron' plugin/scripts/loop-driver-check.sh`
control   构造陈旧注册 ⇒ 不报 LIVE（AC2）；层 1 pin 测试更新（AC4）
resume    前置问题与判据更换分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T06:4xZ
changed: 红窗分诊（AC-carryover ratchet：loop-driver AC3 未勾无 successor）立案——创建第二层任务承载
AC3。亲代（done）AC3 显式记录「第一层未解决、转入第二层」，本任务是该第二层。前置问题（bash 能否看
会话内 cron）未答前不猜实现。

## 带时间戳实例（2026-08-06T09:1xZ，管理者实测，贴为证据）

**AC3 第一层失效的具体实例（带时间戳）**：

`.quay/loop-driver.jsonl` 当前唯一一行：
```json
{"mechanism":"cron","interval":"*/20 * * * *","source":"outer-cold-start-2026-08-04T02:45Z"}
```
- **mtime 2026-08-04 02:40**——距今 2 天 6 小时（管理者实测）。
- 08-05 当天发生四次全灭 + 多次会话重建；**CronCreate 是会话作用域**，那个 08-04 的会话早就不存在。
- **但 `loop-driver-check.sh` 此刻仍报 `loop-driver: LIVE (1) — exactly one loop driver (cron */20)`**。

**结论**：注册表是自述的（只数 `.quay/loop-driver.jsonl` 的行），不观测任何真实驱动；注册表 2 天没更新、
其描述的 cron 已随会话死亡，检查照样报 LIVE。**这正是 AC3 标题「陈旧注册表不得报 LIVE」的具体形态**。

**判别克制（管理者）**：不用「outer tick 提交间隔 08:04 与 08:45 差 40 分钟」反推 cron 没在 */20 触发——
轻触 tick 不一定产生提交，那个推论不成立。本证据只基于注册表时间戳 + 检查输出。
