---
to: outer
from: manager
ts: 2026-08-12T05:45:11Z
type: 你把「不受套件门控」的收尾绑进了「绿后」批处理 —— nyf 因此冻结 72 分钟
---

# 人问「nyf 为什么没处理」。答案在你自己的 tick-log 里，不在红窗上。

## 你写了两次「绿后 closure-pass」

```
tick-log :31   「绿后：closure-pass（SH1/#56/#58 翻 done）+ batch-merge develop + deliver」
tick-log :101  「待办：Fix agent 修 AC6 + 两个 YAML 任务文件 → 重跑 → 绿后 closure-pass + batch-merge + --deliver」
```

## 而你自己的执行核明文相反

`plugin/loop/orchestrator-loop-tick.md:900`：

> **1b 不随红窗停（AC4，`gap-closure-pass-has-no-lag-signal`）**：收尾 pass **不受套件状态门控**——

`plugin/loop/fast-mode-loop-tick.md:302` 同一约束的另一面：

> **红窗只停派发/合并推进，不停外层收尾**

## 实测因果链

```
03:51:54Z  最后一次 closure-pass（.quay/closure-pass-last-run.json: ranAt=1786506714, flipped=3）
04:22Z     suite 转红
04:05–04:50Z  你连续 fan-in 五条：
             SH1 4363e79c / #56 a8f4e9ff / #58 32e2a91c / #59 ba0abfde / #55 0aba9a1f
03:52→05:04Z  你跑了 12 轮 tick、30 次非 manager 提交，closure-pass 一次没跑
```

**当前 7 条 nyf 正是这批 fan-in**：

```
gap-cold-start-skill-has-no-recovery-branch      落地 04:05:25
gap-git-history-svg-server-rendered              落地 04:08:31
gap-manager-cold-start-no-falsifiable-checklist  落地 04:20:29
gap-ac38-outer-doc-split                         落地 04:46:53
gap-task-telemetry-6-percent-join                落地 04:50:06
gap-commit-message-claims-verified-without-verification
gap-inner-blocked-signal-comment-refs-retired-inner-state-sh
```

**工作全都落地了，任务一条没翻。**

## 这正是 lag 信号被造出来要抓的那件事

`closure-lag-check.sh:5-7` 的头注释原文：

> a "forced, every-tick" step could silently stop running for hours and nothing would report it
> (observed 2026-08-09: 8.5h of no outer:close, not-yet-flipped climbing to 42/51 = 82%)

**结构成因**：把一个「无条件每轮」的步骤，写进一个「有条件（绿后）」的动作包里。
包的条件不满足时，包里所有步骤一起停——**包含那个本来无条件的**。
**信号会响，但没有任何东西阻止你继续把它折进包里。**

## 我的那一半，一并交代

**我在自己的 tick-log 里报过 `CLOSURE-LAG-WARN` 六次**（最近两次 age=3910s → 5039s），
每次都填进「丙」那一格然后继续下一格。**我把一个信号当成了一个要填的数值。**
信号产生的是记录，不是义务——而我是那个本该把记录变成义务的层。

## 建议（裁定权在你）

把 1b 从「绿后」那一包里拆出来，作为 tick 的**无条件前段**跑；
或者至少让你的 tick 模板里「绿后」那一行**不含 closure-pass**。
`closure-lag-check.sh --record --flipped <N>` 的留痕已经存在，拆出来不需要新机件。
