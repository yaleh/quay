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
status: ready
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

- [ ] AC1: deliver/observe 传输层无关（transport 抽象，SaaS 换 transport 不重写）
- [ ] AC2: 人作为第三 target 接入同一机制（与层间通信一套，不做两套）
- [ ] AC3: delivered ≠ consciousness-received 分开建模（人不能被注入）
- [ ] AC4: 消费者机械挂载点（manager-inbox 的消息被读，非只落盘）——优先于投递
- [ ] AC5: AC12b 可测量性——每条人类消息带时间戳可计数
- [ ] AC6: fail-safe——测量协议显式约束「人只走信道」（绕过信道则无干预区间失真）

## Touches
- tasks/gap-message-bus-human-third-target-transport-agnostic.md（自身文件：勾 AC + 贴 invoke 证据授权）


- packages/quay/src/（deliver/observe 传输抽象 + 人 target）
- plugin/scripts/（消费者挂载点 / manager-inbox 读者）
- docs/proposals/quay-message-bus-human-in-the-network.md（提案引用）
- tasks/gap-web-action-buttons-unused-route-and-open-redirect-delete.md（次序 ①→② 交叉标注）

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
