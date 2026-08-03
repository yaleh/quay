---
id: gap-live-cannot-tell-a-dead-loop-from-an-unwired-one
title: "/live says no data whether the loop is dead or merely not wired to telemetry — two states, one page"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

**现场（管理者 2026-08-03，人让它检查 archguard 的 `/live` 时查出）**：
`http://…:4174/live` 返回 **200** 并明说「无数据 — 未找到遥测记录（`.workflow-events/` 不存在）」。
**降级路径完全正确**，而且把「无数据」与「读失败」分开了——那正是 `gap-web-cannot-show-what-the-loop-is-doing-now` 的 AC5 要求的。

**但同一时刻它的循环确实在跑。** 外层实测三条独立信号：

```
archguard 30 分钟内提交数        3
archguard orchestration/tick-log.md mtime   17:17:12（数分钟前）
archguard 内层 pane 的 esc to interrupt      1（在忙）
archguard .workflow-events/                  ABSENT
quay      .workflow-events/*.jsonl           49 条（同一时刻的对照）
```

⇒ **页面技术上正确，作为观察面是错的。**
使用者看到「无数据」时**无法区分**：

| 状态 | 页面显示 |
|---|---|
| 循环根本没跑 | 无数据 |
| **循环在跑，但没接遥测** | **无数据** |

**两种状态在页面上同形**——这是本仓数到第 11 次的「存在≠生效」，
而这一次的形态是新的：前几次是「装了没跑」「写了没人读」，**这次是「跑了，但没往它该写的地方写」**。

### 判别法已经现成，不需要新信号

上表左列的三条信号就是判别式：

- **有活动信号（提交 / tick 日志 mtime / 会话在忙）但遥测记录为 0 ⇒ 循环在跑、没接遥测**
- **全部活动信号都没有 ⇒ 循环没跑**

**这条判据的价值在于它区分的两种状态需要完全不同的动作**：前者要去接遥测，后者要去查循环为什么停。

## Contract

```
measure live_state = `curl -s http://127.0.0.1:<port>/live` 输出中标明的循环状态字段（running-unwired / not-running / running）
measure telemetry_records = `ls <root>/.workflow-events/*.jsonl 2>/dev/null | wc -l` 的计数字段
measure activity_signals = `git -C <root> log --since='30 minutes ago' --oneline | wc -l` 的提交计数字段（活动信号之一）
band live_state = 不得为「无数据」这一种笼统态
invariant 「循环没跑」与「循环跑了但没接遥测」在页面上必须可区分；降级仍不得 500
invoke `curl -s http://127.0.0.1:4173/live`
control 有活动信号 + 遥测为空 ⇒ 页面必须说「在跑但未接遥测」；无活动信号 + 遥测为空 ⇒ 必须说「未在运行」
resume 先定判别式与文案，再改页面
```

## Chosen mechanism

1. **`/live` 在遥测为空时再看活动信号**（提交时间、tick 日志 mtime），据此输出**两种不同的文案**，
   并**说明它是怎么判的**（哪条信号有、哪条没有）——**可解释是硬要求**，
   否则只是把一种笼统态换成另一种。
2. **文案要给出下一步动作**：「在跑但未接遥测」⇒ 提示目标项目的循环未调用 `--task-start/--task-end`；
   「未在运行」⇒ 提示去查会话/cron。
3. **不改降级契约**：仍然永不 500、仍然区分「无数据」与「读失败」（那条已达成，不要回退）。

**不做**：不靠在 tick 文档里写一句「记得调用 `--task-start`」来解决——**那是散文，会漂**
（管理者明确排除了这条路）；不把活动信号做成新的遥测写入（观察面不得改变被观察对象）。

## Acceptance Criteria

- [ ] AC1: `/live` 在遥测为空时区分两种状态并各有文案，**且说明判据**（哪条活动信号有/无）
- [ ] AC2: **负控制（在跑但未接）**——构造「有提交/有 tick 日志活动 + 遥测目录不存在」⇒ 页面说「在跑但未接遥测」（实跑输出贴任务体）
- [ ] AC3: **负控制（没跑）**——构造「无任何活动信号 + 遥测为空」⇒ 页面说「未在运行」（实跑输出贴任务体）
- [ ] AC4: **不回退**——读失败仍与无数据分开、仍不 500（负控制：制造一个不可读的遥测目录）
- [ ] AC5: 用 **archguard 当前状态**作为真实样本验证 AC2（它此刻正是那一类）
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group product`（web 路由是用户可见契约）

## Definition of Done

- [ ] AC2 与 AC3 两个方向的实跑输出都贴进任务体——
      **只证明能显示一种状态，与原来那个笼统的「无数据」同形**
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）
- [ ] 任务体记录：这是第 11 次「存在≠生效」，**形态是新的一种——「跑了，但没往它该写的地方写」**

## Touches

- packages/quay/src/observation.ts
- packages/quay/src/serve-handlers.ts
- packages/quay/test/serve.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T17:20:00Z
changed: 管理者报现场并把「是否并进冷启动任务」交给外层。**外层判：拆两处，各归其位。**
**交付那一半并进冷启动任务**（已发指令给在飞的它）：冷启动「循环已起来」的证明，
判据必须是目标项目里出现一条真实遥测记录，**不能用「有提交」或「tick 日志被写过」代替**——
archguard 此刻两样都有而遥测为空。
**观察面这一半单开本任务**：它改的是 `observation.ts`/`serve-handlers.ts`，与冷启动不同文件、可并发、
且它是**真实采用者装完之后每天看到的东西**。
**判别式不需要新信号**（外层实测）：archguard 三条活动信号全为真、遥测为 0；quay 同刻 49 条 ⇒
**有活动 + 遥测空 = 没接上；无活动 + 遥测空 = 没在跑**。
**管理者的两条约束都写进机制**：不靠 tick 文档写一句散文（会漂）、判据必须能区分两种状态。
