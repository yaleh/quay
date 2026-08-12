---
to: outer
from: manager
ts: 2026-08-12T10:04:46Z
type: 真空缺口——被排除的任务没有自动升级/退场机制（已核实无既有任务覆盖）
---

# 发现：`excluded[]` 里的任务可以无限期停留，没有自动升级路径

来源：人追问「跑不了的任务什么时候退出 ready/todo」，我查源码后确认这是个真实缺口。

## 已核实的事实（不是推断）

```
排除理由词表（ready-pool-check.ts:1305-1315）：
  fixture / parked / ac-record / not-yet-flipped / prose-prereq-no-edge
```

搜了 `consecutive`/`excluded count`/`reject count`——**没有任何"连续 N 轮被排除→升级"的计数或触发机制**。
唯一的"连续"概念是套件红轮计数，与任务池排除无关。

`needs-human` 是真正的终态（`lifecycle.ts:40`：`forward: null`），但**进入它本身也没有自动触发路径**——
一个任务停在 `excluded[]` 里（不管是 touches-overlap、compound-not-dispatchable 还是别的理由），
会无限期停留，除非人或 outer 手动介入。

## 已核实两条相邻但不覆盖这个缺口的既有任务（均 `status: done`）

- `gap-ready-pool-worklanded-traps-stuck-work`——修的是**分类错误**：`workLanded` 误判导致真实剩余工作被
  错误排除。它解决的是"不该被排除的任务被排除了"，不是"该被排除的任务排除后没有退场"。
- `gap-needs-human-black-hole-human-dependency-unmeasurable`——修的是 needs-human **内部**没有超时/复审，
  是"进去之后"的问题，不是"怎么进去"的问题。

两条都不覆盖：**从 `excluded[]` 自动升级进 `needs-human`（或其它退场路径）这个入口机制本身缺失。**

## 历史依据

本仓早前的 `AC24(b)` 判据就是这条——"退回必须改变该任务的状态或其在可派发集中的成员资格，
且该改变不依赖上层记得去做"——当时判定**未满足**，现归属已暂停的"三层统一架构"旧阶段，
不是当前阶段目标，没人在推进。

## 我不做的事

我不写任务体、不判断修法优先级、不实现。这条是否值得现在重新激活、归到当前阶段哪个 AC 下、
用什么具体机制（计数器+阈值？还是别的），裁定权都在你。如果你判断不值得现在做，
也请明确记一句"已知、暂不做"，不要让它无声地继续是个空白。
