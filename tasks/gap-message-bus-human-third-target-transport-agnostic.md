---
id: gap-message-bus-human-third-target-transport-agnostic
title: "message bus for human-in-the-network — CORE constraint: transport-
  agnostic design (NOT web-feature design; the fork must be fixed before the
  first line of code — retro-fix cost is extreme, SaaS later is just a
  transport swap not a rewrite; human is the THIRD target of deliver()/observe()
  (same mechanism as inter-layer comms, not two systems); DIFFERENCE: humans
  can't be injected, they only come to read, so deliver(human,msg)='delivered'
  ≠ 'consciousness received' — model separately; ORDERING HARD CONSTRAINT: the
  first priority is NOT delivery but the consumer's MECHANICAL MOUNT POINT —
  .quay/manager-inbox/ currently fails as '3 messages on disk, nobody reads';
  AC12b measurability: every human message becomes a timestamped countable
  record; FAIL-SAFE DEFECT: humans bypassing the channel overestimates the
  unattended interval — the measurement protocol must explicitly constrain
  'humans only use the channel'; human directive: AFTER action-buttons delete
  (① then ②)"
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**消息总线（人作为 deliver()/observe() 的第三个 target）——人指示立案（先删 action buttons 再建）。**

**【核心约束（第一行代码前定死）】**：**按传输层无关设计，不按 web 特性设计**。这个分叉事后补救成本
极高——SaaS 将来只是**换 transport** 而非重写。

**【人 = 第三个 target，同一机制不做两套】**：人是 deliver()/observe() 的第三个 target，与层间通信同一
机制。**差别**：人不能被注入、只能等他自己来读——所以 `deliver(human, msg)='投递成功'` **≠** `'已送达
意识'`，两者**分开建模**。

**【次序硬约束】**:第一优先级**不是投递**，而是**消费者的机械挂载点**——`.quay/manager-inbox/` 现在的
失败形态就是「3 条消息在盘上、无人读」。没有挂载点的投递 = 没投递。

**【AC12b 可测量性 + fail-safe】**:每条人类消息成为带时间戳可计数记录；**fail-safe 缺陷**：人绕过信道会
**高估无干预区间**——测量协议须显式约束「人只走信道」。

### 选定机制

1. 传输层无关的 deliver()/observe()，人作为第三个 target
2. delivered ≠ consciousness-received 分开建模
3. 消费者机械挂载点优先（manager-inbox 的「无人读」形态消除）
4. AC12b 可测量记录 + 协议约束人只走信道

## Acceptance Criteria

- [x] AC1: deliver/observe 传输层无关（transport 抽象，SaaS 换 transport 不重写）
- [x] AC2: 人作为第三 target 接入同一机制（与层间通信一套，不做两套）
- [x] AC3: delivered ≠ consciousness-received 分开建模（人不能被注入）
- [x] AC4: 消费者机械挂载点（manager-inbox 的消息被读，非只落盘）——优先于投递
- [x] AC5: AC12b 可测量性——每条人类消息带时间戳可计数
- [x] AC6: fail-safe——测量协议显式约束「人只走信道」（绕过信道则无干预区间失真）

## Invoke evidence (inner, 2026-08-06, worktree task/gap-message-bus-human-third-target-transport-agnostic)

**Contract measure — delivered_vs_read = `bash <inbox-reader.sh> 2>&1 | grep -c 'read\|consumed'` (fixture inbox, 1 delivered message):**
```
$ bash plugin/scripts/inbox-reader.sh --inbox <tmp> 2>&1 | grep -c 'read\|consumed'
1
```
band `delivered_vs_read >= 1` satisfied — the consumer mechanical mount point turns `delivered`
into a `read`/`consumed` receipt. (Idempotent: re-run stays `1`, never double-writes. Empty inbox →
`0`, so the band is only passable by real consumption.)

**Contract invoke — `grep -n 'deliver\|observe\|transport' packages/quay/src/message-bus.ts` (non-empty):**
```
1:// message-bus.ts — the transport-agnostic message bus
5://   * deliver(target, msg) / observe(target) are the SAME two narrow interfaces across every
32:/** The three deliver()/observe() targets. Human is the THIRD target, same mechanism. */
75:  const delivered = records.length;
77:  const unread = delivered - consumed;
113:    deliver(message) {
116:      const deliveredAt = new Date().toISOString();
...
```

**Scoped verification — `bash scripts/test.sh --for-task gap-message-bus-human-third-target-transport-agnostic --allow-thin`:**
```
ℹ tests 30
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
exit 0
```
(15 × message-bus.test.mjs AC1–AC6 incl. a deliver→inbox-reader end-to-end test + 7 ×
inbox-reader.test.mjs AC4–AC6 + 8 × capability-catalog regression — catalog now 0 unclassified.)

**Contract control (AC6 fail-safe):** `observe(human).measurement.valid` is `false` while
`delivered > consumed` — the channel cannot confirm human reading, so any out-of-channel human
communication distorts the unattended-interval estimate. The reader's protocol line states the
constraint every run and contains neither `read` nor `consumed` (cannot inflate the measure).

## Touches
- tasks/gap-message-bus-human-third-target-transport-agnostic.md（自身文件：勾 AC + 贴 invoke 证据授权）
- packages/quay/src/message-bus.ts（deliver/observe 传输抽象 + 人 target）
- plugin/scripts/inbox-reader.sh（消费者挂载点 / manager-inbox 读者）
- plugin/scripts/capability-catalog.sh（声明 inbox-reader.sh；补声明 pre-existing 的 periodic-push-backup.sh）
- packages/quay/test/message-bus.test.mjs（AC1–AC6 测试）
- plugin/test/inbox-reader.test.mjs（挂载点测试）
- docs/proposals/quay-message-bus-human-in-the-network.md（提案引用）

## Contract

measure   delivered_vs_read = `bash <inbox-reader.sh> 2>&1 | grep -c 'read\|consumed'` stdout 数字段
band      delivered_vs_read >= 1（投递 ≠ 读取，读取有机械挂载点）
invoke    `grep -n 'deliver\|observe\|transport' packages/quay/src/message-bus.ts`
control   人绕过信道 ⇒ 测量失真（AC6 fail-safe）
resume    传输抽象与挂载点分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T00:3xZ
changed: 人指示立案（消息总线，① 删 action buttons 之后）。核心约束（传输层无关 + 人第三 target +
delivered≠意识 + 挂载点优先 + AC12b 可测量 + fail-safe 协议）。

## Dispatch review（追加 2026-08-06T03:5xZ，外层协调）

- **manager-proposal 路径冲突协调**：管理者的未跟踪中文提案（`/tmp/quay-message-bus-manager-proposal-untracked.md`，
  158 行，人接进网络的架构主张 + AC12b 可测性 + 防从缺席推断）已被内层实现（message-bus 30/30）。
  外层将其落盘为 `docs/proposals/quay-message-bus-proposal-manager-2026-08-06.md`（提案层），与实现
  文档 `quay-message-bus-human-in-the-network.md` 并列。提案明确「AC/DoD 由外层判断」——其核心主张
  （人是第三个 target）已由本任务承载，AC1-AC6 全勾。
