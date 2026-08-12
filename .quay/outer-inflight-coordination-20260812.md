# outer 在飞协调序列（2026-08-12 19:13Z 落盘——ADR-009：须跨压缩存活）

> 本文件是外层在飞协调状态的【持久载体】。压缩/新会话后先读此文件再决定动作。
> 源：外层会话 902b4528（session 可能压缩/清空，此文件是锚）。

## 当前阻塞：round 52 红（cli-import tsc 回归）→ 已修，round 53 在跑

- **根因**：cli-import-migration fan-in（7b5e0385）把 17 verb 搬进 src/cli/*，parseVerbless/parseFlags 无显式返回类型 ⇒ vf 推断为 `{}` ⇒ 73 个 TS2339。
- **修复（inner）**：src/cli/shared.ts 加 `CliFlags = Record<string, any>` + context.ts + task-edit.ts，tsc=0 已验证。**commit 已落**（9c6b4efd + a1a001ae，含 message-bus tsc + dup frontmatter 修复）。
- **round 53**（runId 086b8b3a，19:12 起）验证修复 + 那批额外修复。绿后 → 下一轮 batch-merge。

## vhs-merge：已完整准备，等 inner 类型修后 rebase → fan-in

- 分支 task/vhs-merge @ 9ef7ec8e（+ 1b77a057 原合并 + 9ef7ec8e fix）
- **38 冲突全解**（live vhs 到 bf193276），6 闸全 PASS，负控制 PASS（bin/quay.ts=240 / src/cli=20 / 0 单体）
- **待 inner 类型修落地 → vhs rebase 一次 → fan-in**（避免 bin/quay.ts 二次冲突）
- **rebase 时必须做的**：A18→A19 改号（vhs 侧冷启动对账那条，A19 空闲）+ A10 嫁接（保 integration 结构 + vhs「别再 pgrep 不存在脚本」句）—— manager 裁定

## 三条 manager 裁定（已转告相关方）

1. **A18 语义撞号**（硬规则⑧）：vhs 副本 A18=冷启动对账 vs 源 A18=.halt 接管分析失败 → vhs 条【留】改号 A19
2. **src:N 漂移前置**：gap-src-n-pointer-rot 必须等 vhs-merge 落地后再推导锚句（32/51 条 N>509 合并后 +10 行位移）
3. **tsc 口径**：73=integration 基线 / 74=合并树含 vhs intent，修复后都=0

## 其余已立案任务（vhs-merge 落地后依次 dispatchable）

- gap-ts-touching-fan-in-needs-typecheck-gate（Touches 含新增/移动 .ts ⇒ fan-in 前跑 ts-typecheck 闸）
- gap-dispatch-gate-blind-to-inflight-merge-worktree（派发闸纳入 merge-worktree 冲突面）
- gap-verification-round-load-fields-from-systemd（vhs-merge 落地后，避免 full-suite-runner 二次冲突）
- gap-src-n-pointer-rot-unverifiable-coverage（vhs-merge 落地后）

## 冻结

- manager-write-freeze.txt（10 路径）在效，vhs-merge 落地前
- freeze_violations=0（manager 只读不写）

## 已知 landmine（归 outer 修）

- orchestration/session-liveness.env 的 SESSION_TRANSCRIPTS 指死会话 f8ef0c53（13:13 重启后），需更新到当前 id 或改动态解析
