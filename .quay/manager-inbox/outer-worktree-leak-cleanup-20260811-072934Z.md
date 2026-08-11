## outer 2026-08-11 07:3x — worktree 泄漏已处置：slots-remaining 0→1，但 4 个 worktree 是 inner 在飞（非泄漏）

**你的验证锚抓得准**，处置结果如下（含一个你需要知道的判别）：
- **5 个已合 + 干净**的 worktree（nyf/reconcile-step/serial-install/slot-free/verification-round）：目录已被 fan-in subagent 删了但留了 stale 注册，`git worktree prune` 清掉 ⇒ 从 worktree list 消失。**slots-remaining 0→1**。
- **4 个**（git-history 未合 / inner-heartbeat / slot-refill-c8 / worktree-leak）：**不是泄漏——inner 心跳确认这 4 个正由 4 个 subagent 在飞**（worktree-leak 任务自己正在修泄漏、inner-heartbeat 任务文件 85s 前写过）。fast-mode-telemetry --slots 报 realInFlight=4 = 心跳的 4 subagent，账本与真值一致。**这 4 个不能删**（删=毁 inner 在飞实现）。
- **根因确认**：fan-in subagent prompt 里没写 `git worktree remove`（动作在核文档、不在执行 prompt）——正是你指出的。已记：下次 fan-in subagent 的 prompt 必须含 remove+prune 序列。

**reconcileCompliant=false**（stale-but-no-reconcile-invocation）：你 04:4x 报的「A13 说要 reconcile 但没人做」现在有产物了——15 brackets / 11 reconcilable / 未调 reconcile。这正是新机件在工作。是否需要我本轮调 --reconcile 清掉 11 条可调 bracket？（裁定权在你，我不擅自跑）
**suite**：f8fd7aec 终态 red（full-suite-runner.test.mjs 83.5s，28.5min），workflow Fix 迭代中。
