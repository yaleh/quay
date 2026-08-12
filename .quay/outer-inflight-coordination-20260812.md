# outer 在飞协调状态（2026-08-12 19:37Z 刷新——ADR-009：须跨压缩存活）

> **本文件有效期 = 到下一次终态轮次为止，过期即重写。** 压缩/新会话后先读此文件再决定动作。
> 源：外层会话 902b4528（session 可能饱和/压缩，此文件是锚）。
> 上次写于 19:13Z，本次因 round 55 红 + SATURATED 于 19:37Z 刷新。

## 当前唯一阻塞：round 55 红 = cold-start recovery-branch 回归（inner 在修）

- **现象**：round 55（27f46d47，vhs fan-in 验证轮）红在 `cold-start-skill.test.mjs`，隔离重跑 5 个 recovery 断言全红。
- **根因（manager 结构判定，已验证）**：vhs merge 把 cold-start SKILL.md 的整节 **`### 0a. Mid-flight state check`**（路由判定）丢了。
  round 54 有 / 现在无；`### 0b` 还在；keyword `recovery` 计数反增（3→5）——按关键词"更好"、按结构"没了"。
- **修法（已回 inner）**：补回 `### 0a` 节（从 `git show 94a56054:plugin/skills/cold-start/SKILL.md` 取），**不是改测试**。
- **等 inner 修完 → round 56 重验 → batch-merge**。

## 已完成的弧线（不要再等/再做）

- ✅ **vhs-merge 全链闭环**：fan-in 27f46d47 落地（integration 94a56054→27f46d47，FF）、worktree 移除、分支删除、**冻结已解除**（freeze_violations 全程 0）。
- ✅ **cli-import tsc 修复**：round 54 绿（4036/0，verifiedCommit=94a56054 含 c19e70a1）= 首个全量证据。
- ✅ **并发写 FP 判决实验**：round 53 红（并发写 tick 文档）vs round 54 干净窗口绿——同一测试，证实 FP。

## 当前量

- integration = 27f46d47，develop = 94a56054，**diverge 101 未动**（round 55 红阻塞 batch-merge）。
- round 56 待 inner 修复后起跑（verifiedCommit 须含修复）。
- **干净窗口纪律在效**：验证轮跑完前不向共享树提交。

## 已立案任务（round 56 绿后依次派发）

- gap-ts-touching-fan-in-needs-typecheck-gate（Touches 含 .ts ⇒ fan-in 前跑 ts-typecheck 闸）
- gap-dispatch-gate-blind-to-inflight-merge-worktree（派发闸纳入 merge-worktree 冲突面）
- gap-verification-round-load-fields-from-systemd（vhs-merge 已落地，可派发）
- gap-src-n-pointer-rot-unverifiable-coverage（vhs-merge 已落地，可派发）
- gap-suite-start-verifies-target-commit（verifiedCommit 起跑/读历史判据）
- gap-concurrent-write-mutable-tree-false-positive-red（并发写 FP）
- 覆盖缺口：合并验收 = diff --name-only ∩ 同名测试 ⇒ 必须跑（manager 建议，并入）

## 已知事项

- 对表工作：manager 源 orchestration/manager-tick-core.md vs 副本 plugin/loop/manager-tick-core.md = 17 差异块/72 行（A0/A3/A4/A7/A8/A10/A12/A14/A15/A16/A17，副本缺 A0b），round 55 后按完整 diff 做。
- 冻结已解除，无在效冻结。
- manager A4 同步（写 tick 文档）推迟到 round 56 后（干净窗口纪律）。
