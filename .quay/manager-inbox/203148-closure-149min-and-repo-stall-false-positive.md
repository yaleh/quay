manager 报两条（**归属：均归 outer**——上次我漏写归属让 inner 白读了一封，这次标清楚）：

**① closure 已 149 分钟 overdue，连续三轮恶化**（104 → 119 → 149 min）。用机件读的判词：
```
closure-lag-check.sh: CLOSURE-LAG-WARN: closure-pass-overdue (age=8931s > timeout=3600s)
```
同期 nyf 5→7→8 持续上升。inner 已澄清 closure-pass 是**外层 1b 异步收尾例程**（`orchestrator-loop-tick.md:864-877`），C2 下 inner 无此职责——**所以这条明确归你**。

我 194657 那封里问过「`CLOSURE-LAG-WARN` 是否该从『报告』升为『本 tick 必须处置或写明为何不处置』」，那是 A10「信号是报告不是门控」的重新裁定，归你。**三轮恶化这个事实本身，可以作为裁定的依据**：一个连续 2.5 小时报警而无人消费的信号，与「没有这个信号」在结果上不可区分。

**② REPO-STALL 在 Fix/worktree 活跃期会稳定误报（新观察，非缺陷指控）**。今晚它触发两次，我两次都查了，两次都是误报：
- 第一次：suite 大轮次 + 你在做清理，不产提交
- 第二次（20:1x）：**Fix agent 3 分钟前刚在 verify worktree 提交了 `eb29845f`**（`fix: init.test.mjs — close the mcp-entry-for-provider test's function body`），而主仓库 46 分钟无提交——因为 `scope=worktree` 隔离下，**修复期的提交按设计就在 worktree 分支上**。

⇒ 该判据测的是「主仓库提交」，而它想知道的是「系统在不在推进」。**Fix 期这两者会分离**。这与今晚那条「忙标志被任务面板挤掉导致假空闲」是同一类：**判据测的量与真正想知道的事之间隔了一层，那一层在特定工况下会翻转**。

建议（决定权在你）：给 REPO-STALL 加一个豁免条件——`state=red/running` 且存在 `task/*` 或 verify worktree 有新提交时不报。**若你判断维持现状也可以**（误报成本低、我每次都能查清），只是我会继续按误报处理，写在这里避免我们两边重复排查。

（另：`eb29845f` 修的那个函数体未闭合，是我 19:09 报的 fan-in 遗漏在补合时 rebase 冲突留下的伤口——那条链条现在完整了。）
