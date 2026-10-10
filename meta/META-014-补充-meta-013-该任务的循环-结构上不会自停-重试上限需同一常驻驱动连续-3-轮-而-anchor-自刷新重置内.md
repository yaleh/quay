---
id: META-014
title: 补充 META-013：该任务的循环【结构上不会自停】——重试上限需同一常驻驱动连续 3 轮，而 anchor 自刷新重置内存计数；仍需作者一行改词
status: proposed
handler: meta-driver
---
**只报告、不代裁。** 这是 META-013 的补充（只记增量）。执行者侧未勾选、未改词、未自标 `（待外部）`、未动 `status:`。

## 一、META-013 本身也卡住了（~12 分钟无答复）

`meta/META-013-*.md` 仍 `status: proposed`。`plugin/scripts/meta-driver.ts:1685-1687`：判定 `not-evaluated` ⇒ `reply=null` ⇒ **留 proposed、不答复**。即：一条需要【作者裁决】的 META 在这个通道里结构上不会得到答复 —— 所以「等 meta-driver 回话」不是出路。

## 二、决定性新事实：这个循环【不会自停】（META-013 没有这一条）

`plugin/scripts/worker-driver.ts:3524` 把 `ac-not-checked` 判为 `count-and-retry`（→ `advanceRetryCap`），本应由「3 轮 → 标 needs-human」兜底。但计数载体 `retryState.counts` 是**进程内存**（同文件 `:5084`，注释逐字「⛔ 不落盘——与进程同寿命」）⇒ 要攒满 3 连续，必须**同一个常驻 anchor 连续跑完 3 轮**。

实测：anchor `pid=3680162`（`quay driver status --kind worker` → `anchor_pid=3680162 alive=1`）于 **19:23:18 local** 重启（`ps -o lstart -p 3680162`），而本轮次间隔 ~7–13 分钟 ⇒ 计数被反复清零，3 连续**永远攒不满**。

⇒ 结论：**不动作就永远重派**，这不是「再等几轮会自愈」。META-013 请求的裁决仍然需要。

## 三、本轮增量读数（不重复 META-013）

- 字面谓词（repo 根，逐字 `grep -rn <token> . | grep -v node_modules | grep -v '^./goals/'`）命中：**10** 条（META-013 时 8 条），**全部是散文引用**；可执行载体（plugin/packages/scripts/orchestration/experiments）⇒ **0**。命中数每轮增长，正是因为每轮 Evidence/META 都要引用该 token。
- `AC-356`：`status: achieved`；criterion 修复在 `develop` 上完好（`grep -c '<token>' goals/AC-356-*.md` ⇒ 0；`efNeedsHuman` ⇒ 2）。
- 本任务 DoD（「AC-356 由 FALSE 变 TRUE」）**已满足**；任务落不落地**不再有任何功能损失**，剩下纯是这条 AC 的记账。

## 四、请求的裁定（一行即可，作者/人）

- **(A) 改词**（最小）：AC7 谓词换成可满足的仪器 —— `grep -rn '<token>' plugin packages scripts orchestration experiments` ⇒ `0`（已实测 0）。
- **(B) 认账**：按「可执行载体为空」这一读数判 AC7 已满足，直接勾（任务随即落地）。
- **(C) 关闭**：AC-356 已 `achieved`、goal 已合并，作为 `superseded` 关掉。

⛔ 执行者侧均不做：改词/勾选是作者面，标 `（待外部）` 会把「仪器坏」伪装成「等外部绿轮」。⛔ 请勿重复立案（同一条任务本身，无第二个缺陷）。