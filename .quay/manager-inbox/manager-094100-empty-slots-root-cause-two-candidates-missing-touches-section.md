---
to: outer
from: manager
ts: 2026-08-12T09:42:17Z
type: 人报告空槽——根因是两个池候选缺 ## Touches 小节，被保守 fail-closed
---

# 人报告：inner 没有 subagent 在跑，web 显示大量 todo/ready

实测：`slots_free=4`（`cap=5`，真实在飞只有 1 条 `gap-quay-self-hosting-e2e-proof`），
但 `recommended=[]`。**池候选总共只有 3 条**（不是 web 上看到的 36 条 todo+ready——那是原始计数，
`ready-pool-check` 的六项资格合取过滤后只剩这 3 条）：

```
gap-quay-self-hosting-e2e-proof                       ← 已在飞
gap-dead-loop-check-fresh-coldstart-false-running     → touches-overlap-in-flight
gap-stranded-check-compares-against-master-not-landing-ref → touches-overlap-in-flight
gap-quay-has-never-self-hosted-its-own-cold-start     → compound-not-dispatchable（是父任务本身）
```

## 根因：后两条压根没有 `## Touches` 小节

```
$ grep -n '^## ' tasks/gap-dead-loop-check-fresh-coldstart-false-running.md
15:## Finding  25:## 根因  33:## 影响  38:## 修法方向  47:## AC  54:## DoD  59:## Dispatch review

$ grep -n '^## ' tasks/gap-stranded-check-compares-against-master-not-landing-ref.md
15:## Finding  19:## 实测...  39:## 修复方向...  43:## AC（draft）  50:## DoD（draft）
```

**两个文件都没有 `## Touches` 标题**（不是空小节，是标题本身不存在）。`touches-orthogonality-check`
对缺失 Touches 的任务保守 fail-closed——当有任务在飞时一律挡住，防止真实文件冲突，而不是判断出真的有内容重叠。

## 建议（裁定权在你）

如果这两个任务的真实改动范围确实不与 `gap-quay-self-hosting-e2e-proof`（`plugin/skills/cold-start/SKILL.md` /
`docs/analysis/quay-self-cold-start-proof.md`）重叠，补上各自的 `## Touches` 小节即可立刻解锁 2 个空槽。
我不写任务体，只报根因和读数。

**不是此前反复出现的「判断算出来没执行」那类缺陷**——本轮 `promotions=[]`，没有被计算出该晋级却没 `--apply` 的候选。
这次是不同的根因：池子候选本身就薄（1022 条任务里只有 3 条通过资格过滤），且其中 2 条因缺 Touches 被保守挡住。
