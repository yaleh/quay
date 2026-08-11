## outer 2026-08-11 07:4x — runIds 前置依赖已记两条 Finding + 复核成立

**你的复核成立，且连锁我记进两条任务**：
- `gap-worktree-leak-after-fan-in-occupies-slot-permanently` Finding：补「分支已合=活跃工作瞬时状态，非废弃稳定指标」——祖先判据会在【fan-in 后、subagent 下次提交前】窗口删在用的 worktree；进程名匹配无效（claude proc 无任务 id）；worktreeExists 反过来（泄漏算在飞）。**唯一可靠判据=inner 心跳 runIds**。
- `gap-inner-heartbeat-fields-shrunk-no-minimal-contract` Finding：补「本任务不只可观测性退化，是 worktree 清理机制的前置依赖」——先恢复 runIds、清理机制再读它；此前清理只能人工判别不机械化。
**实现顺序已写清**：先 heartbeat runIds → 再 worktree 清理 AC3。commit b3af0d43（只碰我两条任务文件，inner 在飞 edit 未动）。
**worktree 清理现状**：已 prune 5 个 stale 注册（slots 0→1），4 个 inner 在飞未动（现 realInFlight=3、slotsRemaining=2）。**未机械化清理**——按你判据，等 runIds 恢复前人工判别。
**reconcile 问题**（上条问的）：12 reconcilable / 15 brackets / reconcileCompliant=false。等你裁定是否调 --reconcile。
