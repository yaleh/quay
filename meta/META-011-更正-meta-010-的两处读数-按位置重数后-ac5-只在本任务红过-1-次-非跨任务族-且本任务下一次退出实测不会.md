---
id: META-011
title: 更正 META-010 的两处读数：按位置重数后 AC5 只在本任务红过 1
  次（非跨任务族），且本任务下一次退出实测不会被豁免（verdict=own-defect-counted，走重试上限）
status: proposed
handler: meta-driver
---
**只报告，不代裁** —— 这是对 META-010（本任务上一个 worker 轮次所写）两处读数的更正，其中第二条推翻了它给出的处置前提。

## 一、我先犯了一个错，先记账（硬规则 2 的实例）

META-010 与本轮我最初的诊断都用了**关键词 `grep`** 统计 flake 发生率：`grep -l "must beat the uncached baseline" .quay/fan-in-suite-*.log` ⇒ 我读成 **6 条日志命中**，并据此在中间过程里说「跨任务复发、应判 unrelated-flaky-exempt」。

**按位置重数（`^✖` 行首）：**

| 断言 | `^✖` 命中日志数 | 落在哪些任务 |
|---|---|---|
| AC5 `ready-pool-check-s22`（cached/uncached 比值） | **1 / 133** | 仅本任务 13:16 |
| MSP `git-graph-pagination-…-before-page`（非空判据） | **4 / 133** | dedup 任务 11:53、13:09 + 本任务 12:29、12:50 |

⇒ 我最初的 6 条里 **5 条是假阳性**：那些日志中同一文本出现在 **`✔`（通过的测试行）** 与 `t.diagnostic` 行上（该测试**通过时也会打印同一句**读数，只是 `✔` 而非 `✖`）。**只打印命中、不看命中是什么**——正是硬规则 2 禁止的形态，我当场又犯了一次。

## 二、AC5 的红是【宿主负载】，本任务 delta 已被负控制排除

- **同一 worktree、同一文件集、同一排程，三次读数**：12:29 s22 `passed=true`(31654ms)、12:50 `passed=true`(27443ms)、13:16 `passed=false`(30783ms)。
- **本任务新增的测试文件不是诱因**：逐条算 `__PERFILE__` 的 start/end，`serve-lang-switcher.test.mjs`（5186 / 8931 / 8771ms）在**三次运行中都未与 s22 时间重叠**（每次都约在 s22 结束后 100s 才起跑）。
- **隔离重跑（本 worktree 内、单文件）绿**：`cached=1857ms uncached=3713ms ratio=0.50`（判据 `< 0.75`；套件内红时 `ratio=0.77`）。
- ⇒ 变量是同机**其它套件**（dedup 任务的全量 suite 于 13:09 起跑）；AC5 是一个**在同进程内取比值、却对宿主负载敏感**的断言。

## 三、后果（**推翻 META-010 的处置前提**，这是我请求处置的那一点）

META-010 写：「`judgeRetryExemption` 判 `unrelated-flaky-exempt` ⇒ 不计重试上限、无限重派」。
**当前轮不再是这个形态**：AC5 的签名在 48h 窗口内**只在本任务出现过** ⇒ `recurringSignatureTasks` 返回 `[]`。我**直接调用 `judgeRetryExemption`**（非推断）对 13:18 那条 outcome 复核，返回：

```
{ "verdict": "own-defect-counted",
  "reason": "failing tests unrelated to this task's delta, but the assertion signature
             did not recur across ≥2 distinct tasks in the window (fail-closed count)",
  "recurredTasks": [] }
```

⇒ 按 `worker-driver.ts:2453` 走**重试上限**路径（⛔ 不是无限重派）。**一般形态**：一条 host-load 诱因、但在 48h 内未跨任务复发的罕见红，在归因规则上**只能**被记成任务自身缺陷——而失败测试文件与 delta 无关这一半（`classifyDeltaRelatedness`）是**读对了**的，分叉发生在第二步。

## 四、附带读数（供判断 MSP 那条是否真的解除）

`--all` 窗口**现在仍是 175/200 为 notes**（`refs/notes/quay-cmv-merge` 链长 242），但 MSP 的非空判据本轮直接量到 **6**（`mergesInWindow=12, inWindowSecondParents=6`）⇒ **MSP 当前通过**。⇒ notes 占窗仍在（META-008 的产品面缺陷未变），只是恰好越过了该判据的 0 边界，**仍可能翻回 0**。

## 五、我这一侧的可核事实

本任务 `gap-webui-lang-switcher-control`：3 文件 delta（`serve-render.ts` / `serve-i18n.ts` / 新增 `serve-lang-switcher.test.mjs`），AC 7/7 经 `task_check` 确认；scoped 门 `--for-task … --allow-thin` **EXIT=0（95/95, fail 0）**；scoped-gate cache 已写（developSha `dab1935db`）；本任务自己的测试文件 5/5 绿（含 AC4 的 15 路由逐条枚举、AC6 的 follow-link 实测 `Set-Cookie`+`<html lang=zh>`）。**本轮我未改任何非 Touches 文件**——AC5 的修法（提高阈值 / 标注 / 改成对负载不敏感的读法）不在其内。