---
id: gap-goal-batch-dry-run-noop
title: goal-store batch --dry-run 静默失效——从未被实现，全量写入+提交照常发生
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`goal batch --dry-run` 不能阻止写入——不是接线错误，是 `--dry-run` 从未在 `batch` 路径上被实现过，只是共享的文档注释造成了它"三个动词一致支持"的假象。

**实测触发**（2026-09-18，quay-fleet 工作区）：对 AC-049 跑 `goal batch --dry-run --json '[...]'`，未被 dry-run 拦住——`author` 分支上真实出现新提交 `c3453a2 goals: AC-049 batch by cli:4076743`，criterion 字段被真实改写并落盘、提交。

**根因链（本仓库 `packages/quay/src/goal-store.ts` 实测确认，行号为本次读取时基线）**：

1. `case "batch"`（`goal-store.ts:2874-2910`）的参数解析只读 `--json`（`:2878`），从未检查 `rest` 里的 `--dry-run`——对照兄弟分支 `case "gate"`（`:2914` `const dryRun = rest.includes("--dry-run")`）与 `case "write"`（`:2763` `let dryRun = false` + `:2771` 解析）。`batch` 完全没有这一行。
2. `writeBatch()`（`:2465-2505`）的参数类型（`:2465-2479`）里根本没有 `dryRun` 字段——即便第 1 步修好，也没有下游接口能接住它。它对每条记录调用 `write(r.id, {..., commit: false})`（`:2484-2489`），未传 `dryRun`，于是 `write()` 内部的 `dryRun` 形参回落到默认 `false`（`:1902`），其 dry-run 短路分支（`:2386-2389` `if (dryRun) return ...`）在 batch 路径上永远不可达。
3. `writeBatch()` 末尾对 `commitStoreBatch(...)` 的调用（`:2494-2500`）是无条件的——没有任何 `if (!dryRun)` 包裹，对照 `gate` 分支的 `if (!dryRun) appendGateEvent(...)`（`:2944`）。

**文档与代码不一致**：`batch` case 正上方的注释（`:2519-2522`）写着"`--dry-run` validates without persisting"——这是从 `write` 分支复制过来的，从未在 `batch` 上成立过。

**历史**：`--dry-run` 由 `6143411ca6`（2026-09-09 08:19，"goal-store: 写入面六缺陷修复"）加入，提交信息明确写"CLI 暴露 --dry-run（write 与 gate）"——不含 batch。`writeBatch` 由约 37 分钟后的另一个不相关提交 `9164419fe7`（"store-commit: 提交信息带动作+写入者+批量... gap-store-commit-action-and-actor"）加入，该提交把 `write` 的记录字段形状复制过去，但没有带上 `dryRun`；共享/相邻的文档注释块被原样留下，造成了它继承了对等能力的错觉。测试侧唯一的 batch 专项测试（`packages/quay/test/store-commit.test.mjs:196`，AC3）只断言"一次提交"，从未测过 dry-run 语义——`grep` 全仓库找不到任何测试跑过 `writeBatch(..., dryRun)` 或 `goal batch --dry-run`，这正是该缺陷从未被抓到的原因。

**修法**：
1. 在 `case "batch"` 里解析 `--dry-run`（照搬 `gate` 的 `rest.includes("--dry-run")` 或 `write` 的逐项解析）。
2. 给 `writeBatch()` 的参数类型加 `dryRun?: boolean`，串进每条记录的 `write(r.id, {..., dryRun})` 调用。
3. 用 `if (!dryRun) { ...commitStoreBatch... }` 包裹提交调用，`dryRun` 为真时返回"若执行将得到的" view models，不落盘不提交。
4. 补一个回归测试（`write`/`gate` 已有 dry-run 测试的 batch 对应版），断言 `writeBatch([...], { dryRun: true })` 产生零新提交、零文件变化。

## AC

- [ ] `case "batch"`（`goal-store.ts`）从 `rest` 解析 `--dry-run`，可用 `grep -n "dry-run" packages/quay/src/goal-store.ts` 核对该 case 块内出现该字符串
- [ ] `writeBatch()` 参数类型含 `dryRun` 字段，且该值被传入每条记录的 `write(...)` 调用（`grep -n "dryRun" packages/quay/src/goal-store.ts` 在 `writeBatch` 函数体内命中 ≥2 处：解构/透传 + 提交守卫）
- [ ] `commitStoreBatch(...)` 调用被 `if (!dryRun)`（或等价条件）包裹——`dryRun: true` 时不产生新提交
- [ ] 新增/扩展的回归测试：对一个已存在的 goal 记录跑 `writeBatch([{id, criterion: "<新值>"}], { dryRun: true })`，测试内用 `git log -1 --format=%H` 前后对比 + 目标文件内容前后对比，均断言"不变"；同一测试反向验证 `dryRun: false`（或省略）时确实提交且文件确实改变（正负对照缺一不可）
- [ ] `node --experimental-strip-types packages/quay/bin/quay.ts goal batch --dry-run --json '[{"id":"<既有goal id>","criterion":"<test-only 不落地>"}]'` 手工验证：命令退出后 `git status`/`git log -1` 均无新变化，且目标 goal 文件内容与执行前逐字相同
- [ ] `scripts/test.sh --for-task gap-goal-batch-dry-run-noop` 绿（含新增测试）

## DoD

不是"写了一个测试文件"就算完成——DoD 是：`goal batch --dry-run` 在真实 CLI 路径上（`node packages/quay/bin/quay.ts goal batch --dry-run --json '[...]'`，非直接调用内部函数）对一个真实存在的 goal 记录跑一次，跑之前拍一次目标文件的 md5 + `git log -1` HEAD，跑之后重新拍一次，两者逐字/逐位相同；且同一条命令去掉 `--dry-run` 后重跑，文件与 HEAD 确实发生变化——用同一份负控制同时证明"dry-run 生效"与"非 dry-run 时该发生的变化确实会发生"（否则不能排除是把整个写路径关掉了）。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/test/store-commit.test.mjs
- tasks/gap-goal-batch-dry-run-noop.md
