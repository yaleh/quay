---
id: META-017
title: 请裁定 AC-920 判据 2>&1|tail -6 恒 pass 的处置：改判据 / 退役 / 保持现状（AC-922 已 supersedes
  但 AC-920 仍 active）
status: answered
handler: meta-driver
reply: 建议 (b) 退役 AC-920，并更正 (b) 的「不可逆点」判断：§② 已证 AC-924-1/2/3 恰是 AC-920 expect
  的三条断言，AC-924 已 achieved 且在 GOAL-911 退出条件④ 内 ⇒ 承接面并未随 AC-920 退出而消失；相形之下 (a)
  只会留下一条与 AC-922 重复、零新信息的判据，(b) 还额外止住每轮 gap sweep 把 AC-920 当无人承接 AC 重复立案。(c)
  的持续成本最高（每轮记一次假达成 + 重复立案）。改判据/退役仍是人的动作——我无权改 AC-920 的 status 或
  criterion，本回复只给取舍依据。
---
# 请裁定：AC-920 判据恒 pass 的处置（改判据 / 退役 / 保持现状）

本记录是一份**人的裁定请求**，不是机器已完成的处置。AC-922 的 origin 逐字把 AC-920 的退役/改写保留为人的决定。
生成方式：本 body 由脚本 `ac920-gen-meta.mjs` 从三个 goal JSON 与两次沙箱实测直接产出（读数逐字嵌入，非手抄）。

## 一、待裁定的事实

AC-920 的 criterion 逐字是：

```
node --test plugin/test/unencapsulated-state-admission.test.mjs 2>&1 | tail -6
```

acceptance runner 用 `/bin/sh -c`（无 `pipefail`），命令的退出码 = `tail` 的退出码 ⇒ **该判据结构上不可能取假**
（硬规则 4：一个结构上不可能取假的量不是测量）。其当前 `evidence: pass (exit 0)` 携带零信息。

## 二、机械读数（逐字）

### ① 判据恒 pass 的对照实验（空沙箱，cwd=$(mktemp -d)）

AC-920 criterion 逐字执行（经 /bin/sh -c，与 acceptance runner 同形）：

```
$ cd $(mktemp -d) && /bin/sh -c 'node --test plugin/test/unencapsulated-state-admission.test.mjs 2>&1 | tail -6'
Could not find 'plugin/test/unencapsulated-state-admission.test.mjs'
PIPE_EXIT=0
# 整条管线的 stderr 读数：(whole-pipeline stderr empty — `2>&1` sent it into the pipe; tail printed it on stdout)
```

同一条测试路径**不经 pipe**，同一个空沙箱：

```
$ cd $(mktemp -d) && /bin/sh -c 'node --test plugin/test/unencapsulated-state-admission.test.mjs'
Could not find 'plugin/test/unencapsulated-state-admission.test.mjs'
DIRECT_EXIT=1
```

同一沙箱、同一条路径：不经 pipe ⇒ 1，经 AC-920 的 pipe ⇒ 0。

### ② 实质断言已有载体且已绿（对照，不是本任务的实现对象）

```
$ cd <worktree> && node --test plugin/test/unencapsulated-state-admission.test.mjs
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 407.755359
REAL_DIRECT_EXIT=0
```

AC924-1/2 覆盖「线索层只产 candidate、从不 confirmed」；AC924-3 覆盖「判断器对 memoized 误报 refuted、对真状态簇 confirmed 且带 counterfactual」；AC924-4 覆盖「confirmed 候选走 Planner 的 semantic-judged 路由且 mechanical delta 零读取」。这三件事就是 AC-920 expect 的三条断言。

### ③ goal 记录内部不一致（枚举读数，不是布尔）

- `quay goal show AC-920 --json` ⇒ `"status": "active"`、`"supersededBy": []`、`"criterion": "node --test plugin/test/unencapsulated-state-admission.test.mjs 2>&1 | tail -6"`
- `quay goal show AC-922 --json` ⇒ `"status": "achieved"`、`"supersedes": ["AC-920"]`
- `quay goal show GOAL-911 --json` 的退出条件 ④ 逐字：`④ AC-919、AC-924、AC-925 均 achieved（①②③ 全部由这三条 AC 的 criterion 与 expect 覆盖）。` ⇒ **不含 AC-920**

## 三、三个选项（各自成本与不可逆点）

### (a) 改判据

- **动作**：把 AC-920 的 criterion 改成 `node --test plugin/test/unencapsulated-state-admission.test.mjs`（与 AC-922 的判据同形）。成本 = 一次 `goal write`。
- **收益**：AC-920 变成可取假并自然读绿。
- **不可逆点**：AC-920 的判据与 AC-922 重复，且这是一次「改写」（AC-922 origin 明说属人的决定）。改写后原判据文本只存在于 git 历史与 AC-922 的 origin 中，goal 记录本身不再显示它曾经恒 pass。

### (b) 退役

- **动作**：把 AC-920 标 `superseded`、`supersededBy: [AC-922]`（镜像 AC-922 已声明的 `supersedes: [AC-920]`）。成本 = 一次 `goal write`。
- **收益**：消除重复验收面，并止住每轮 gap sweep 把它当成「无人承接的 AC」重新立案。
- **不可逆点**：「线索器从不对 memoized 误报输出 confirmed / 每条 confirmed 带 counterfactual」这组**负对照断言会随 AC 退出在域集合**——AC-922 只断言判据取 `node --test` 自己的退出码，不等于保留 AC-920 这条验收面。若承接写漏，此后没有读数显示它丢了。

### (c) 保持现状

- **动作**：无。成本 = 零。
- **风险（不是不可逆点，是持续成本）**：criterion 恒 pass ⇒ 下一轮 goal-driver 会把它记成 pass（一次新的「假达成」），且每轮 gap sweep 继续把它当成「无人承接的 AC」重新立案。

## 四、为什么机器不能自决

AC-922 的 origin 逐字：

> Retirement/rewording of AC-920 remains a human decision; this item only declares the replacement relation.

机械侧不替人做这个取舍（同 `gap-meta-call-ac-918-goal-911` 的形态）。本轮任务只产证据与裁定请求，**未改动 AC-920 的任何 status/criterion**。

## 五、请回复

`quay meta reply META-017 --reply "(a) | (b) | (c)"`，或在 manager 会话中直接裁定。
