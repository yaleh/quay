# outer → manager 2026-08-11 09:15Z — r284 红为错树伪红 + A15 ④ 执行形态修复

## 1. r284/ef0382db（08:44 起跑, tests=0）红 — 判为非验证轮、错树伪红

- **runId** ef0382db, **scope=main**, **runner=outer**, tests=0（early-red 截断）, verifiedCommit=12505b20。
- 失败：quay-init-drift-report.test.mjs `idempotence` ×2（18.1s 断言 + __PERFILE__ 88s passed=false）。
- **判定依据**（三重）：
  1. 失败测试在当前树 **concurrency 1 与 4 均单测通过**（6 pass/0 fail），inventory_drift=0。
  2. verify-suite-prod worktree **已消失** ⇒ 红轮全跑在 live main checkout（round 57-88 同一签名）；
     上一绿（round 56）跑在**冻结 worktree** 且 drift-report **通过**。真实安装族测试对「源树中途被 fan-in 改动」敏感。
  3. **retrigger monitor 与 workflow 抢跑**：monitor（suite-state-trigger --monitor, 06:20 起）用
     `--root main + CPUQuota=200%` 起跑 c7f8e97b；workflow Fix 阶段按 step 5 收养了 running 轮。
- ⇒ r284 不构成任何 commit 的证据。**不派 Fix 修 drift-report 本身**（无真实回归）。

## 2. A19 执行形态回落（consecutive_outer_rounds=187, band=rollback）→ 已处置

- 处置=驱动切回 workflow：新建+provision verify worktree（branch verify-suite-prod, HEAD=8393faa1），
  dispatch execute-suite-fix（wf_3c32a529）。kill 抢跑的 main-checkout 轮 + TaskStop retrigger monitor（bsbvbbka9）。

## 3. execute-suite-fix.js 磁盘损坏（M176 name: 缓存掩盖）

- :210 嵌套反引号 `git -C ${root} worktree remove ...` 终止外层模板串 ⇒ scriptPath 派发 **parse error**。
  此前靠 name: 派发物化的旧缓存体运行（M176）。已转义修复（8393faa1）。
  ⇒ **请改用 scriptPath 派发本 workflow，勿用 name:**（内存有 CLAUDE.md M176 规则）。

## 4. 当前态

- workflow wf_3c32a529 独占驱动：Fix 阶段已等到 resource-gate WAIT（cpu_stall 71 / loadavg 9.7，inner 并发测在跑），
  正确重试中；门放行后将在**冻结 worktree + CPUQuota=400%**（人 06:4x 裁定）起跑。
- inner 在飞：suite-floor cap-from-gate 拆分（09:07）+ static-syntax --no-block（09:10-14, option ① 已实现）。
- 池：pool 12, deficit 8。
