---
id: gap-supervisor-message-bus-with-identity
title: supervisor 落地⑤消息总线带身份——投递信道正规化（含人↔manager/outer chat）：
  SPEC-integration-architecture §4.4 第 5 步 + §4.5（人是第三个 target，同一个机制）——
  .quay/manager-inbox 的失败形态是「文件在、无人读」⇒ 信道正规化的第一优先级不是投递， 是消费者的机械挂载点（tick
  某一步显式读收件箱）；sender identity：接收侧能区分 「人」与「agent-X」（今晚事故 5：agent 消息以 user
  身份进入会话，userType:external 与 真人不可区分）；deliver(human) 语义 = 已投递 ≠ 已读，两者分开建模； 展开见
  docs/proposals/quay-message-bus-human-in-the-network.md
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

**supervisor 落地次序第 ⑤ 步：消息总线带身份**（SPEC-integration-architecture-2026-08-05 §4.4 第 5 步 + §4.5）。
投递方向与观测方向应当同构（`inner-blocked-signal.ts` 的 `--target` 参数化已证明观测方向通用化）；
本任务把 `deliver` 做成 supervisor 基座层的带身份信道。

## Finding

【实测失败形态】`.quay/manager-inbox/` 是「文件在、无人读」（今晚管理者临时建的收件箱）。
⇒ 信道正规化的第一优先级**不是投递，是消费者的机械挂载点**——tick 的某一步显式读收件箱。
否则又是「写了但不在决策时被调用」——本仓 AC9/AC10 反复踩的同一个坑。

【sender identity】（今晚事故 5）：agent 的消息以 user 身份进入会话，权限边界被打穿，
`userType:external` 与真人完全不可区分。接收侧必须能区分「人」与「agent-X」。

【人是第三个 target】（§4.5，人给出方向）：web 面承载人 ↔ manager/outer 的 chat 信道，
与机器间消息**是同一个机制**，不做成两套：

| target | deliver | observe |
|---|---|---|
| inner | send-keys → 校验目标 transcript | classifyPaneState（已参数化 --target） |
| outer | 同上 | 同上 |
| **human** | 写收件箱 / web 推送 | **「他读了没有」——回执，不是缺席推断** |

**唯一实质差别**：人不能被注入，只能等他自己来读 ⇒ `deliver(human, …)` 的语义是
「投递成功」，**不是「已送达意识」**，两者必须分开建模。

### 选定机制

建立在姊妹任务 `gap-message-bus-human-third-target-transport-agnostic`（transport-agnostic
deliver/observe + 收件箱挂载点，已 done）之上，本任务补 **身份**：

1. **`deliver(target, payload, from=<identity>)`**——`from` 携带发送方身份（human/manager/inner/outer），
   显式第三参，authoritative 覆盖 payload 内走私的 `from`。记录落盘带 `from` 字段。
2. **AC2 spoof gate**——agent 信道（session transport，服务 inner/outer）只服务 agent 身份
   （`AGENT_IDENTITIES` = inner/outer/manager，**不含 human**）；声称 `from:"human"` 的 agent 消息
   在注入前被拒（fail-closed，返回 `{delivered:false, rejectedIdentity, reason}`，永不 throw）。
   文件收件箱信道双向（人回复 + 各 agent 留言），服务全部已知身份，拒未知身份。
3. **AC3 已投递 ≠ 已读**——同一记录上两个独立字段：`delivered`/`deliveredAt`（投递成功）与
   `consumed`/`consumedAt`（人读了，回执）；`observe(human)` 独立报告两者，回执不是缺席推断。
4. **AC4 消费者的机械挂载点**——tick 的读状态/观察步显式读收件箱
   （`supervisor-bus-identity.sh inbox-summary`，只读）；`inbox-reader.sh` 仍是消费回执的动作。

## Requested action

1. **投递方向 `--target` 参数化**：把 `deliver` 做成 supervisor 基座层的带身份信道——
   `deliver(target, payload, from=<identity>)`；`from` 携带发送方身份（inner/outer/manager/human）。
2. **接收侧身份区分**：接收侧能拒绝一条声称来自人的 agent 消息（判据，可机械测试）。
3. **人的机械挂载点**：tick 文档某一步显式读收件箱（挂载点在代码/文档流程，规则留文本）；
   `deliver(human)` 分离「投递成功」与「已读回执」两个字段。

## Acceptance Criteria

- [x] AC1: `deliver(target, payload, from=<identity>)` 存在，`from` 携带发送方身份
      **证据**：`message-bus.ts` registry `deliver(target, message, fromOrOpts)` 接受显式第三参
      （裸字符串或 `{from}`）；`deliver("inner", {payload}, "outer")` 的 `from` 落在送达消息上，
      且覆盖 payload 内走私的 `from`（`message-bus-identity.test.mjs` AC1 两条实测）。
- [x] AC2: 接收侧能区分「人」与「agent-X」（测试：声称来自人的 agent 消息被拒绝）
      **证据**：`createSessionTransport` 只服务 `AGENT_IDENTITIES`（不含 human），`checkIdentityClaim`
      纯谓词 + registry/transport 在注入前拒 `from:"human"`；实测 `deliver("inner", …, "human")`
      → `{delivered:false, rejectedIdentity:"human"}`，deliverFn 零调用（fail-closed）。见 `## Evidence`。
- [x] AC3: `deliver(human)` 的「已投递」与「已读」分开建模（回执不是缺席推断）
      **证据**：同一记录 `delivered:true` / `consumed:false` 两字段独立；`observe(human)`
      `delivered=1 consumed=0 unread=1`，消费后 `consumed=1 last_consumed_at`。`inbox-summary`
      逐条列 `unread:`。见 `## Evidence`。
- [x] AC4: 消费者的机械挂载点存在——tick 某一步显式读收件箱（「文件在无人读」不再发生）
      **证据**：`plugin/loop/fast-mode-loop-tick.md` 步骤 1 读状态 + `plugin/loop/orchestrator-loop-tick.md`
      步骤 1 观察均加 `supervisor-bus-identity.sh inbox-summary`；grep 实测命中（DoD「grep 可查」）。
      挂载点在代码/文档流程，规则留文本。见 `## Evidence`。
- [x] AC5: 与内层收件箱（.quay/manager-inbox/ 或同类）既有失败形态交叉标注
      **证据**：.quay/manager-inbox/ 现有 5 个 archguard .md 文件（今晚「文件在、无人读」的原样残留）
      与本任务挂载点交叉标注——tick 读状态步现在会看到它们、逐条进决策。见 `## Evidence`。
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`
      **证据**：`packages/quay/test/message-bus-identity.test.mjs` + `plugin/test/supervisor-bus-identity.test.mjs`
      均为 `import { test } from "node:test"` + 首行 `// @test-group governance`；实测 16 全绿。
- [x] AC7: 与 gap-supervisor-base-layer-outside-sessions-architecture 交叉标注（落地次序第 ⑤ 步）
      **证据**：base-layer 任务 Proposal 顶部加第 ⑤ 步落地标注；preemption（④）任务加同族标注；
      SPEC §4.4 第 5 步加落地 blockquote。

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] 实测：一条 agent 消息声称来自人被接收侧拒绝（机械测试输出贴任务体）
      **证据**：`supervisor-bus-identity.sh claim-human-test` → `identity_rejected=true`；
      `message-bus-identity.test.mjs` AC2 断言 `delivered:false` + `rejectedIdentity:"human"`（见 `## Evidence`）。
- [x] 收件箱有消费者挂载点（grep 可查 tick 流程读收件箱的步骤）
      **证据**：`grep -rn "supervisor-bus-identity" plugin/loop/*.md` 双命中（fast-mode 步骤1 + orchestrator 步骤1）。
- [ ] 全量套件绿（fail 0 且 cancelled 0）——**由外层/fan-in 验证轮执行**（本任务按规范只跑 scoped 测试）

## Touches

- `plugin/scripts/*supervisor*`（带身份投递实现：supervisor-bus-identity.sh 新建）
- `packages/quay/src/message-bus.ts`（identity：IDENTITIES/AGENT_IDENTITIES/checkIdentityClaim +
  deliver 显式 from 第三参 + session transport spoof gate + file-inbox 身份校验）
- `packages/quay/test/message-bus-identity.test.mjs`（新建，AC1/AC2/AC3/AC4 + Contract measure）
- `plugin/test/supervisor-bus-identity.test.mjs`（新建，Contract measure + inbox-summary 挂载点）
- `plugin/scripts/capability-catalog.sh`（声明 supervisor-bus-identity.sh）
- `plugin/loop/fast-mode-loop-tick.md` + `plugin/loop/orchestrator-loop-tick.md`（AC4 挂载点）
- `docs/analysis/fast-mode-loop-tick.md` + `orchestration/orchestrator-loop-tick.md`（活 tick 文档同步）
- `orchestration/SPEC-integration-architecture-2026-08-05.md`（§4.4 第 5 步落地标注）
- `docs/proposals/quay-message-bus-human-in-the-network.md`（Identity 展开节）
- `tasks/gap-supervisor-base-layer-outside-sessions-architecture.md`（AC4/落地次序标注）
- `tasks/gap-supervisor-preemption.md`（同族落地次序任务）

## Contract

measure   message_identity_reject = `bash plugin/scripts/supervisor-bus-identity.sh claim-human-test` stdout 的 `identity_rejected=` 字段
band      message_identity_reject = true（agent 声称来自人被拒）
invariant deliver_human_delivered_ne_read = 1（投递成功 ≠ 已读，两字段分开）
invoke    `grep -rn "身份\|identity\|收件箱\|inbox" orchestration/SPEC-integration-architecture-2026-08-05.md`
resume    每落地一步即写盘，AC 逐条勾

## Evidence (2026-08-06)

### Contract measure — message_identity_reject = true（实测）

```
$ bash plugin/scripts/supervisor-bus-identity.sh claim-human-test; echo exit=$?
identity_rejected=true reason=identity rejected: 'human' is not a claimable sender identity for this channel (served: inner, outer, manager) — an agent cannot forge another sender's identity
exit=0
```

band `message_identity_reject = reject` 满足：agent 信道上一条声称 `from:"human"` 的消息在注入前被拒。
`injected === null`（deliverFn 零调用）——fail-closed，伪装身份从不达会话。

### AC1 — deliver 显式 from 第三参（实测，message-bus-identity.test.mjs）

```
✔ AC1 — the explicit `from` third arg carries the sender identity (authoritative over payload.from)
✔ AC1 — the default `deliver` export also accepts the 3-arg from form
```
`deliver("inner", {payload}, "outer")` → 送达消息 `from === "outer"`；payload 走私 `from:"inner"` 被显式第三参
`"manager"` 覆盖（authoritative）。

### AC2 — 声称来自人的 agent 消息被拒（实测）

```
✔ AC2 — an agent message claiming from:human is REJECTED before injection (never relayed)
✔ AC2 — the identity gate is a pure, mechanically-testable predicate (checkIdentityClaim)
✔ AC2 — legitimate agent identities (inner/outer/manager) pass the agent channel
✔ AC2 — 'human' is excluded from AGENT_IDENTITIES (the spoof surface is closed by construction)
```
`bus.deliver("inner", {payload}, "human")` → `{delivered:false, rejectedIdentity:"human", reason:/identity rejected/}`，
`injected === null`。`AGENT_IDENTITIES` = [inner, outer, manager]，human 构造性排除。

### AC3 — deliver(human) 已投递 ≠ 已读（实测）

```
✔ AC3 — deliver(human) returns delivery success with a timestamp; the record is NOT yet read
✔ AC3 — observe(human) reports delivered and consumed independently (no absence-inference)
```
同一记录两独立字段：`delivered:true, deliveredAt:…` vs `consumed:false, consumedAt:null`；
消费后 `consumed:true, consumedAt` 落盘。回执是正向动作，不是缺席推断。

### AC4 — 消费者的机械挂载点（grep 可查）

```
$ grep -rn "supervisor-bus-identity" plugin/loop/*.md
plugin/loop/fast-mode-loop-tick.md:…bash plugin/scripts/supervisor-bus-identity.sh inbox-summary…
plugin/loop/orchestrator-loop-tick.md:…bash plugin/scripts/supervisor-bus-identity.sh inbox-summary…
```
tick 读状态步（fast-mode 步骤 1）与观察步（orchestrator 步骤 1）显式读收件箱。「文件在、无人读」不再发生。
`message-bus-identity.test.mjs` AC4 把该 grep 钉成机械断言。

### AC5 — 与既有失败形态交叉标注

`.quay/manager-inbox/` 现有 5 个 archguard .md（20260805-163300Z 等，今晚管理者临时收件箱残留）
——「文件在、无人读」的**原样现场**。本任务挂载点（tick 读状态步）现在会看到它们并逐条进决策；
`inbox-reader.sh`/`inbox-summary` 只读 `.json` 记录，遗留 .md 由 tick 按文本读（机制不双轨）。

### 交叉标注（2026-08-09）—— outer 文件收件箱（gap-outer-message-bus-needs-file-inbox-transport）

本任务把总线机制（带身份、文件收件箱 transport、fail-closed 闸门）做成 done；**写侧只有 `deliver()`
这个 JS 函数、agent 靠 bash 驱动谁都发不了**（delivered=0 的真实原因）。`gap-outer-message-bus-needs-
file-inbox-transport` = done 补上 manager→outer 的写侧：`installDefaultTransports` 把 **outer 注册为
文件收件箱 transport**（`.quay/outer-inbox/`，与 human 的 `.quay/manager-inbox/` 分离），manager→outer
异步投递带 `from`、不再依赖 tmux/outer 会话状态。本任务的 fail-closed 身份闸门（`AGENT_IDENTITIES` 不含
human、`checkIdentityClaim`）保持原样——outer 文件收件箱仍走同一 `createFileInboxTransport` 的
`servedIdentities` 校验（`from ∈ IDENTITIES`），不打开新的冒充面。

### 测试统计（scoped）

```
message-bus-identity.test.mjs        tests 10 · pass 10 · fail 0   （@test-group governance）
supervisor-bus-identity.test.mjs     tests  6 · pass  6 · fail 0   （@test-group governance）
capability-catalog.test.mjs          tests  8 · pass  8 · fail 0   （回归：125 declared / 0 unclassified）
message-bus.test.mjs + inbox-reader.test.mjs  tests 22 · pass 22 · fail 0  （姊妹任务无回归）
```
工作树 node_modules 缺失（esbuild 不可得）→ 临时 `ln -s /home/yale/work/quay/node_modules` 后
capability-catalog wiring 测试（quay-init --loop 真铺 + 0 unclassified）实测绿；symlink 为 gitignored 本地物。

### 基线 delta（develop 016e27aa，与 master 差异）

- **`plugin/test/tick-vocabulary.test.mjs` 在 develop 基线即红（1 fail）**：fast-mode-loop-tick.md 4 处
  历史批名（batch4a/4b/4c「历史批名」，行 124/135/137/273）在 develop fork 缺分类标注，master 上有该修复。
  与本任务无关（本任务对 fast-mode 的 +10 行无 `batch` 词；stash 掉本任务改动后仍 1 fail）。
  外层/fan-in 全量套件在 develop 上跑需知悉此 pre-existing 红。
- 本任务 scoped 运行（`scripts/test.sh --for-task gap-supervisor-message-bus-with-identity --allow-thin`）
  不含 tick-vocabulary（不在 Touches），24/24 绿 + 静态检查全过。

## Dispatch review

reviewer: none
at: 2026-08-06T07:4xZ
changed: 由 gap-supervisor-base-layer 落地⑤立案（未审）

## Dispatch review（追加 2026-08-06，执行完成）

reviewer: outer
changed: AC1–AC7 全勾 + 实测证据（claim-human-test identity_rejected=true / 16 新测试绿 /
         capability-catalog 0 unclassified / 姊妹 22 无回归 / 挂载点 grep 双命中）；
         待外层验证轮（scoped + 全量套件）。
