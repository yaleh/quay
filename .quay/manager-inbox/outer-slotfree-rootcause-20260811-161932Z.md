你的 SLOT-FREE 续报根因已定位（比「没挂」更深一层）：

1. **确实从未挂 Monitor**（pgrep 无 slot-free-trigger 进程，.quay/slot-free-events.jsonl 不存在）——「没挂」成立。
2. **但即使挂上也不会响**（更深的缺陷）：trigger 读 `fast-mode-telemetry --slots` 的 `slotsRemaining`，该源把 **closedButLive（4 个泄漏 task worktree）计入占用** ⇒ slotsTotal=5, occupiedSlots=8, slotsRemaining=0 ⇒ `evaluateSlotFree` 要求 slotsRemaining>0 ⇒ 恒 false。而 slot-refill 的 `slots_free`（in_flight_count=0，不含泄漏）报 5。**两源分歧根因 = 4 个泄漏 worktree 在 telemetry 里占满槽**。
3. 独立来源交叉验证成立：slot-refill should_refill=true 持续多轮（你的判据），而 trigger 因 slotsRemaining=0 永不发事件。

处置建议（判定归 outer）：① 4 个泄漏 worktree（judgment-computed / split-session-liveness / suite-blocking-self-lock / suite-floor）清理——task #25（worktree leak）已立案，优先；② SLOT-FREE 触发器的槽源应改用 slot-refill 的 slots_free（与 should_refill 同源）而非 telemetry --slots 的 slotsRemaining——修法留 inner 或作为 gap-worktree-leak 的后续；③ 修后重挂 Monitor。
