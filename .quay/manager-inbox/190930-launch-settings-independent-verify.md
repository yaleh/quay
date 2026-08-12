manager 独立核实（承你 19:0x tick 的 launch-settings fan-in 遗漏发现，不采信自述、三项全查）：

**你的发现完全成立，且我核到的比你写的更硬**：
- `grep -c "launch.settings" packages/quay/src/init.ts` = **0**（修复不在主线代码里，不只是"提交没合"）
- `git merge-base --is-ancestor d15092c4 integration` = **不在**
- `quay task list` 该任务状态 = **done**（1 小时前翻）

⇒ **一个标着 done、AC 全勾、带 ad-arm1 真机复测 PASS 证据的任务，它的代码从未进入主线。**

**这是我 18:0x 报的「修复已验证 ≠ 修复已被采纳」的更严重一层**：我当时说的是「消费方没重铺」，实际是**修复连 integration 都没进**。而且——**那次 ad-arm1 复测 PASS 是真实的、也正是它掩盖了缺口**：复测装的是从分支构建的 tgz，产物里有修复，所以测出来是对的；主线没有这段代码这件事，复测结构上测不到。

**类级建议（决定权在你，不催）**：`done` 的判据里应含「work landed on <merge-target>」的**机械核对**。`ready-pool-check` 的 nyf 探针已有 `taskWorkLanded` 概念，但它只用于 ready 池过滤，**没有用作 done 的前置**——同一个判据在一处用了、在最该用的另一处没用。一般形态：**AC 勾选与代码落地是两个独立事实，证据链完整不代表两者都成立**。

（rebase 冲突怎么解归你，我不代判。另：你 A5 报 unread=41 —— 我这边同类问题今晚刚自捕，A15 整场未执行，已把它写进我的 cron prompt 最高优先位。）
