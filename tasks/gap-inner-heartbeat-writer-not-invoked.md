---
id: gap-inner-heartbeat-writer-not-invoked
title: inner 心跳 writer 步骤没被调用——93 分钟 30+ 轮零调用，闸从未有机会拒/放（manager 14:1xZ 报，meta-cc 动作记录证实）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（inner 心跳 writer 未被调用——2026-08-14 14:1xZ manager 报 + outer meta-cc 动作记录证实；AC53-gate 已落地但心跳仍不长 = 根不是闸）**。

**实测（meta-cc 查 inner 会话 tool_use，contains=inner-wakeup-heartbeat，since 12:00Z，38 条全枚举）**：
```
真正【调用 writer】的 Bash（node … inner-wakeup-heartbeat.ts …）只有 4 次：
  12:25:43 · 12:26:05 · 12:26:54 · 12:30:39
12:30 之后 → 零次（后续命中全是 grep/stat/消息正文的字符串）
jsonl 末行 ts=1786711051 = 12:37:31Z（与最后一次真实调用差 ~7min）
```

**可证伪预测已兑现**：AC53-gate 落地（c2add65d 14:04Z）后心跳**仍然不长**（jsonl 仍 57，14:14Z 实测）⇒ **根不是「闸结构拒写」**（闸从未有机会拒/放，因为 writer 没被调）⇒ **根是「这一步没跑」**。

**与已落地任务的边界（防重复）**：
```
I1（读产物判据）       → 加【读】判据：心跳/ready-pool/slot-refill 新鲜度，陈旧即报   ← 已落地
AC53-gate（接 running） → 修【闸消费者】：闸传真观测在跑集 + 拒写留痕                 ← 已落地
本条（writer 未调）     → 修【写入步骤本身】：inner 的驱动路径要【调用】writer        ← 未落地
```
**三个都是「喂给闸的量」族，但本条是写入侧的根**——前两条修的是「判据/闸怎么读」，本条修的是「writer 本身有没有被调」。

**实施取证（2026-08-14 14:5xZ，实施 subagent 重放 inner 会话 transcript + 产物）**：
```
两条驱动文档【都已有】写入步骤——`plugin/loop/fast-mode-loop-tick.md` 步骤 6（:1168-1204「每次重排写心跳产物」+
写命令 + 禁吞退出码）与执行核 `orchestration/fast-mode-tick-core.md` B3（:52-54 同文）。**文档不缺步骤，是 inner 不调**：
① 07:41 切驱动模式（ScheduleWakeup 哨兵/noop 重臂路径）后写入停（jsonl 07:41:35 后 340min 空窗）；
② 12:37:31 一次恢复写入（真任务 id 修正后闸放行，jsonl 56→57）；
③ 12:43 起 inner 与 outer **共同采用误诊**：「jsonl 停在 57 = AC53 闸在拒 END 写入（5 在飞）」，据此停调 writer 93+ 分钟。
误诊可证伪：refusals 旁路文件 **全历史 0 行（文件从未创建）**——若 writer 被调且闸拒，AC53-gate 判据4 必写
`{written:false,...}` 到 `inner-wakeup-heartbeat-refusals.jsonl`；两个载体都不长 = **writer 没被调**
（C29：没留痕 = 没执行），不是「闸在拒」。且「在飞满 ⇒ 闸拒写」是错误推断：在飞=cap ⇒ slots_free=0 ⇒
should_refill=false ⇒ END 不变式不违例 ⇒ **写入成功**（实证：12:37:31 那条 slots_free:0 成功写入）。
```

**C17 落盘建议（outer 在 `plugin/loop/fast-mode-loop-tick.md` 步骤 6 落盘；`orchestration/fast-mode-tick-core.md` B3 同源同步——本任务 Touches 不含执行核，请落盘时一并覆盖，两条文档的写入步骤都要升级）**：

```markdown
## 6. 重新排程（写心跳产物是每轮必跑第一步，不随驱动模式消失）

`ScheduleWakeup` 间隔 1200–1800 秒（tick 是兜底心跳，不是派发节奏；CronCreate/`/loop`/noop 重臂均同此）。

**每轮结束必写心跳产物** `.quay/inner-wakeup-heartbeat.jsonl`（追加式 jsonl；镜像末条到 `.json` 快照）——
写入是 **B3 无条件第一步**，不随驱动模式（ScheduleWakeup 自驱 / `noop:true` 重臂 / CronCreate 唤醒 / task-notification 回填）变化而消失。
`noop:true` 重臂**也是重排**：本轮若做了 tick 动作（评估/派发/fan-in/写队列），结束前必须先跑写心跳命令。

**纠正误诊（2026-08-14 实证）**：**jsonl 不增 且 refusals 不增 = writer 没被调**（C29：没留痕 = 没执行），
第一嫌疑是「写入步骤没跑」，不是「闸误拒」。闸拒绝（exit 非 0）必留痕到 `inner-wakeup-heartbeat-refusals.jsonl`；
**在飞=cap ⇒ slots_free=0 ⇒ should_refill=false ⇒ 闸放行、写入成功**——「在飞满所以闸拒写」是错误推断。
写命令（重排前先跑，用写入方脚本，不手搓 python；`--in-flight` 必填，缺失 ⇒ fail-closed 拒绝）：…（原命令不变）

**每轮 inner-tick-log 记录写入结果**（`heartbeat_written=true|false` + 非 0 时 refuse_reason）：
写心跳的【尝试】本身是机械痕迹（C29），使「调了但被拒」与「没调」在每轮记录上可区分——I1 读产物判据与
AC53-gate 价值判据（心跳恢复增长）都依赖这条。
```

**判据1**：inner 驱动路径（ScheduleWakeup 哨兵路径 / fast-mode tick）**恢复对 `inner-wakeup-heartbeat.ts` 的调用**——每轮 reschedule 追加心跳行（AC53 AC3：每次 reschedule append 一行）。
**判据2（能取假·真样本不构造）**：**12:30–14:1x 这段 93 分钟就是现成缺席样本**——回放它（30+ 轮无 writer 调用），判据1 必须红；修复后下一轮 reschedule 出现新行。
**判据3**：与 AC53-gate 的「闸不再误拒」价值判据对齐——**闸不再误拒的前提是 writer 被调**；若 writer 永不调，AC53-gate 的价值判据（心跳恢复增长）也永不满足 ⇒ 本条是 AC53-gate 价值判据的前置。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不改闸逻辑（AC53-gate 已修）；不改 I1 读产物判据（已落地）；不新建第二个心跳载体（沿用 jsonl，拒写才写旁路 REFUSAL_FILE）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 inner 的 ScheduleWakeup 哨兵路径 / fast-mode tick 里心跳写入步骤（现在在哪、为什么没被调）——**已做**：两条驱动文档都已有写入步骤，是 inner 不调；根因 = 驱动模式切换未带过步骤 + inner/outer 共同误诊「闸在拒写」。
2. 判据1：驱动路径恢复 writer 调用（每轮 reschedule append）——**C17 路由**：写入步骤升级 + 误诊纠正 + tick-log 留痕，作为落盘建议交 outer 落 `plugin/loop/fast-mode-loop-tick.md` 步骤 6（执行核 B3 同步）。
3. 判据2 能取假：93 分钟缺席样本回放红（refusals 文件 0 行 + jsonl 停 57 双证据）+ 修复后新行。
4. 判据3：与 AC53-gate 价值判据对齐（writer 被调 = 闸价值判据前置）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：inner 驱动路径恢复 writer 调用（每轮 reschedule append 心跳行）。
- [ ] AC2 判据2 能取假：12:30–14:1x 缺席样本回放红；修复后新行。
- [ ] AC3 判据3：与 AC53-gate 价值判据对齐（writer 被调是闸价值判据前置）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] inner 心跳 writer 步骤恢复调用（每轮 reschedule append）+ 93 分钟缺席样本回放红 + 心跳恢复增长（AC53-gate 价值判据满足）。

## Touches

- plugin/loop/fast-mode-loop-tick.md（inner 驱动路径补心跳写入步骤——outer 侧 C17：loop 文档 outer 独占，但 inner 执行；写入步骤实现属 inner 侧）——**C17 建议已入 Proposal，未直接改**
- plugin/scripts/inner-wakeup-heartbeat.ts（若调用侧需要调整）——**取证后判定 writer 本身无需改：它工作正常（57 行成功写入），根因在调用侧（驱动路径没调它）**
- tasks/gap-inner-heartbeat-writer-not-invoked.md（自身）——已回填 Evidence + C17 建议

## Test-Files

- plugin/test/inner-wakeup-heartbeat.test.mjs（22 项，writer 现有测试——本次未改 writer，测试仍应全绿）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（98 项，checker 现有测试——I1 读产物判据已在另任务落地）

## Evidence

**证1 · 动作记录（meta-cc 重放 inner 会话 `bc1a438b` tool_use，contains=inner-wakeup-heartbeat，12:00Z 后全枚举）**：
```
真正【调用 writer】的 Bash（node … inner-wakeup-heartbeat.ts --blocked …）只有 4 次真实调用：
  12:25:43 · 12:26:05 · 12:26:54 · 12:30:39（另一次 jsonl 56→57 的写入在 12:37:31）
12:37 之后 → 零次（后续命中全是 grep/stat/消息正文的字符串，59 条命中里非 writer 调用）
```

**证2 · 双载体都不长（能取假的核心证据）**：
```
$ wc -l .quay/inner-wakeup-heartbeat.jsonl        → 57（07:41:35 停写，340min 空窗；12:37:31 一次恢复 → 56→57）
$ ls .quay/inner-wakeup-heartbeat-refusals.jsonl  → NO REFUSALS FILE（全历史 0 次拒绝，文件从未创建）
⇒ 两个载体都不增 = writer 没被调（C29：没留痕 = 没执行），不是「闸在拒」——
  若 writer 被调且闸拒，AC53-gate 判据4 必写 {written:false,…} 到 refusals 旁路。
```

**证3 · inner/outer 共同误诊（transcript 原文，12:43:04Z inner 转述 outer）**：
```
"Outer confirms the full loop closure and correctly notes the heartbeat jsonl at 57 is expected
 (AC53 gate blocks END writes while 5 tasks are in-flight — the recovery readout comes after the retry chain settles)."
```
**误诊可证伪**：`在飞=cap ⇒ slots_free=0 ⇒ should_refill=false ⇒ END 不变式不违例 ⇒ 写入成功`——实证 jsonl 第 57 行（12:37:31）正是 `slots_free:0, should_refill:false, no_refill_reason:"no free slots (in-flight 5 … >= cap 5)"`，**成功写入**。「在飞满所以闸拒写」是错误推断。

**证4 · jsonl 时间线（停写点与驱动模式切换吻合）**：
```
07:41:35  tick 290（fan-in AC64/AC74/B15 + 派发 AC68）——写入停（340min 空窗）＝ 07:41:46 切驱动模式
12:37:31  自驱恢复：真任务 id 修正后闸放行（jsonl 56→57）——唯一一次恢复
12:37:31 之后 → 93+ 分钟 30+ 轮（inner-tick-log tick 356→384 在跑）零写入
```

**证5 · 驱动文档现状（两条都【已有】写入步骤，缺的不是步骤是执行）**：
```
$ grep -n "每次重排写心跳产物" plugin/loop/fast-mode-loop-tick.md  → :1168（步骤 6，含写命令 + 禁吞退出码）
$ grep -n "B3 重新排程" orchestration/fast-mode-tick-core.md        → :52（执行核 B3，同文）
⇒ 文档不缺步骤；C17 落盘建议（Proposal 内）把「每次重排」升级为「每轮结束必写（无条件）」
  + 纠正「jsonl 不长 = 闸拒写」误诊 + tick-log 留痕 heartbeat_written —— 让「没调」与「调了被拒」在每轮记录上可区分。
```

**Scoped gate**（`bash scripts/test.sh --for-task gap-inner-heartbeat-writer-not-invoked --allow-thin`）：**exit 0，98/98 pass**。静态检查 tier 全 PASS（AC4 wiring 源 tick 文档步骤 6 声明每轮重排写心跳 / AC2 wiring 执行核 B3 指名 writer 脚本 / AC2-AC3 字段最小契约等），writer+checker 测试（`AC53-gate 判据4 拒写留痕`、`AC53 EXIT:0 捕获`、`legitimately-ending tick WRITES exit 0` 等）全绿。

**ts-typecheck gate**（`fan-in-ts-typecheck-gate.ts`）：**exit 0，ADMITTED** —— `Touches do not cover any new/moved .ts in diff: 0`；本任务未改 writer（`inner-wakeup-heartbeat.ts` 无需改——它工作正常，根因在调用侧），无新增 `.ts`，无需 typecheck。
