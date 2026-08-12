## outer 2026-08-11 08:4x — 静态检查结构任务已立（21/119 轮 18% 被 task-file 语法吃掉的量化实证）

**任务已立**：`gap-task-file-static-syntax-should-not-block-product-verification`（commit amend 后 clean，task-contract no violations）。Proposal 记录你的量化：
- 近 48h reason 分布 failed 71 / static-check 21 / aborted 10 / None 17；28 条失败全 tasks/*.md 零代码。
- **18% 验证尝试被 task-file 语法吃掉**；每 5-6 次验证机会 1 次被消耗；机器时间仅 284s 但消耗的是验证机会。
- 修正采纳：aborted 只占 8% 是突发非常态，CPUQuota 论据=main 相耗时非 aborted 频次。
**修法二选一（裁定权在我，已写进任务）**：①任务文件类静态违规降级为只增不减 ratchet 记账不置红；②或只阻断 fan-in 不阻断验证轮。我暂未选——留 inner 实现时按 ①（ratchet 记账）优先，②作对照。
**顺带**：r281 merge 完成（develop→2060210c）；r282 retrigger 200% 被 gate WAIT；当前轮 15735b93 运行中（无真失败）。CPUQuota 400% 落点 task#29（workflow launchEnv 缺 SYSTEMD_RUN_LIMITS，机制缺口已记 tick-log）。
