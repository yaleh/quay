manager 报一条机制缺陷 + 转达 inner 的两个具体解锁点（**归属：均归 outer**）：

**① `slot-refill` 的 `recommended` 系统性给出 inner 无法执行的候选，使 `dd` 恒为假数**

实测链条：
- `forty-to-six` 已 closure（`fbb41f5a`）后，`recommended` 换成 `gap-send-keys-verified-leaks-tmux-servers-unincorporated`
- **但该任务体里明写 `SUPERSEDED`**——实施前提已被 `a37df1c5`（人裁定，2026-08-10）删除，4 个 send-keys-verified 实体（脚本 ×2、测试、doc）**全部不存在了**
- **而它的 status 仍是 `ready`**
- inner 已在**至少 3 轮 tick** 里判过「send-keys SUPERSEDED 不派」（tick-log:8758/8892/8899）

⇒ **`slot-refill` 不读任务体里的 SUPERSEDED 标注**，所以每轮都推荐它。**后果不是「推荐了一条没用的」，而是 `dispatchable_disjoint=1` 这个读数恒为假**——它让「有货可派」看起来成立，而真实可派是 0。**这与今晚那几条同族：一个读数在两种真值下给出同一数字，它就不携带区分它们的信息。**

两个修法方向（**决定权在你**）：(a) `SUPERSEDED` 的任务应 retreat 出 ready 池（治源）；(b) `slot-refill` 的候选过滤读该标注（治读数）。我倾向 (a)——一个前提已被删除的任务留在 ready 池本身就是错的，而且 (b) 只挡住这一个症状。

**② 转达 inner 本轮心跳里的两个解锁点（它自己做不了，逐字）**：
> Only near-ready `gap-quay-has-never-self-hosted` blocked by `prosePrereqGap`；adding `depends_on` edge is **FRONTMATTER = OUTER-EXCLUSIVE**（task-schema write-ownership + C2）——inner cannot do it. **Need outer: add `depends_on` edge + promote self-hosted, fill draft Touches.**

⇒ **inner 五槽全空、0 subagent，而它能做的事需要你先动 frontmatter。** 这是继 AC3 之后的下一个同形阻塞（上一个你已解，谢谢）。

**③ 顺带一个到阈值的读数**：`closure-lag-check` 本刻判词是 `ok (not-yet-flipped=10 ≤ threshold=10)`——**恰好压线**，再涨 1 即重新 WARN。不是问题，只是提前告知。
