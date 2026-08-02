# 升级项（外层攒给人的非常规决定）

外层不自行决定的三类：同一失败在消解后**再次出现**（循环不收敛）；需要改变**方向或范围**的决定；
外层自身停止条件触发。

每条写：现象 / 外层已尝试什么 / 为什么超出授权 / ≥2 个选项及建议。

---

## 1. ~~`DIR-124-A2` 标记为 done，但机制从未落地~~ —— **已决（2026-08-02，选项 A）**

**人的裁定**：先做 DIR-124 全链复核再决定排期。复核已完成 → `orchestration/dir-124-chain-audit.md`。

**结果**：真阳性有 **两个**，不是一个——`A5`（baseline metrics）与 `A2` 同一形态（done + AC 零勾选 + 代码零落地）。
两者状态已改回 `todo`；**不排期**，因为它们是 B/C/D/E 的前置而 B/C/D/E 全未开工——没有东西被错误证明过。
顺带拆掉一个陷阱：A1 一旦闭合，PARENT-DONE-IFF-CHILDREN 会让 DIR-124-A 在 A2/A5 仍假 done 时一起闭合。

<details><summary>原始升级内容</summary>


**发现时刻**：2026-08-02 ~15:15Z 外层 tick（`task-status-drift-check.ts` 的 `reverse-drift-suspect`）

**现象**

`tasks/DIR-124-A2.md` 的 `status: done`，但：

- `## Acceptance Criteria` 下 **AC 全部未勾**（`- [ ]`，无一个 `- [x]`）
- 全仓 `find -iname '*replay*'` 查不到任何 `*workflow*replay*` fixture / script / test
- 它声称的机制是 workflow 事件的**黄金重放**：八个 success/failure/composite/concurrent/cache 用例
  的 fixture、M192 两个 known-defect 形状的分类、以及 baseline invariance 的 replay diff
- `golden-replay-dir044.ts` **不是它** —— 那是 DIR-044 的产物

**外层已尝试什么**

1. 排除了检查器误报：另外查证了同批被报的 `DIR-124-B1`，确认那个是假阳性（代码确实落地，只缺
   milestone 簿记文件），并已为检查器的准确率单独建任务
   `gap-reverse-drift-check-buries-true-positives-in-noise`
2. 排除了「换名落地」：`grep -rl 'goldenReplay|golden-replay|replayWorkflow'` 的命中全部属于
   `composite-land` / `composite-preflight` / `milestone-worktree` / `golden-replay-dir044`，
   没有一个是 A2 声称的 workflow 事件重放

**为什么超出授权**

「这个机制现在还要不要」是**范围决定**，不是解阻塞。三条路的代价差一个数量级，且 A2 是
DIR-124 拆分链上的一环——单独复活它可能连带 A1/A3/A4/A5 的状态也要复核。

**选项**

| 选项 | 含义 | 代价 |
|---|---|---|
| **A（建议）** | `status: done → todo`，但**不立即排期**；连同 `DIR-124-A5`（同批未查证）一起做一次 DIR-124 全链状态复核，结果决定排期 | 复核约 1 个任务的量；避免只修一个而漏掉同类 |
| B | 判定 workflow 黄金重放在快速模式下已无必要（我们不再走 execute-milestone），**显式降范围**并把理由写进任务体，保持 done | 最便宜；但如果阶段 2 产品交付要回到 workflow 路径，等于埋一个洞 |
| C | 立刻重建该机制 | 最贵；且在 exp6 阶段 1 的 12 小时目标期内会挤掉测试提速与持续运行 |

**建议 A**：真正的问题不是 A2 一个任务，而是「有多少 done 是这样 done 的」还没有答案。先量出规模
再决定排期。

</details>

---


