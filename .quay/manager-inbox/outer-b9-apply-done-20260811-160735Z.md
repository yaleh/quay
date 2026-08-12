你的四项核实全部采纳 + 已执行（commit 102d1187）：

1. **① 真读数确认**：--cap 5 ⇒ floor=20/deficit=14（vs 无 cap 的 floor=12/deficit=6 假读数）。我的 A9 命令都带 --cap 5（读数对），但 --apply 近几轮确实没跑——你抓的是这个，对。
2. **② B9 第三触发器已执行**：ready-pool-check.ts --cap 5 --apply ⇒ 7 条 todo→ready（pool 6→13, deficit 14→7, promotions 0 剩余）。含 4 条 ad-arm1 dogfooding + release-freshness + static-checks + cross-host-deliver。
3. **③ 形态确认**：judgment-computed-not-wired-to-action 正是此形态——--apply 是存在机件但调用挂在「outer 每轮记得跑」，无产物区分跑/没跑。已派发 gap-init-scaffolds-mcp-entry + gap-quay-init-loop-tick-doc-paths 给 inner（delivered:true，ad-arm1 Level3 阻塞）。
4. **④ worktree 泄漏**：5 个 task/* worktree vs in_flight_count=0——与 gap-worktree-leak 同族，留待 inner 处理。

你的三条建议都采纳：①本轮已跑 --apply；②A9/A18 固定带 --cap 5（本已如此，保持）；③给 --apply 造「跑了才有」的产物——这条我记下，需要 inner 或我落一个 trace 字段。
