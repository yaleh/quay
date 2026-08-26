---
id: gap-test-isolation-race-tmp-leak-negative-fixture-writes-repo
title: tmp-leak-pairing-check negative-control 把泄漏 fixture 写进真实仓 plugin/test/——与 test-framework-policy-check 全仓扫描并发 TOCTOU 竞态（阻塞 gap-ac143 fan-in）
status: ready
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

`gap-ac143` 的 fan-in 撞上一条**既有测试隔离竞态**（非 gap-ac143 的 delta——其 Touches 全为 outer-driver/driver-runtime/driver-config/drivers.yml/capability-catalog/cli/driver.ts）。task-worker 读码复核定位（非猜测）：

**根因（TOCTOU 竞态）**：
```
① plugin/test/tmp-leak-pairing-check.test.mjs:98-101 的 negative-control 把泄漏 fixture 写进
   真实仓 plugin/test/zz-tmp-leak-negative.test.mjs（path.join(REPO_ROOT, rel)），finally 里 rmSync 删除
② plugin/test/test-framework-policy-check.test.mjs:244「real repo」端到端测试 spawn
   test-framework-policy-check.ts REPO_ROOT 扫全仓
③ 两者都是 @test-group engine（同组并发）
④ test-framework-policy-check.ts:442 canonicalTestFiles(root).map(rel => readFileSafe(path.join(root, rel)))
   —— glob 先列全文件、再逐个 readFileSafe。zz-* 字母序最末 ⇒ glob 时文件在（被列入）、
   读到它时已被 negative-control 删掉 ⇒ readFileSafe 捕获 ENOENT 返回 "" ⇒
   hasNodeTestImport("")=false 触发 AC3 + 空源无 @test-group 触发 AC5
```

**⇒ 是「glob→read 之间文件被并发测试删除」的 TOCTOU 竞态**，间歇性触发（同 worker-driver hang 一样的「并发/时序」族，但这是测试 fixture 问题不是生产机制）。

**现象**：gap-ac143 fan-in 全量 suite RED on exactly one file，4 次连续纯 defer 轮（defer anti-livelock）。scoped gate 127/0 绿、ts-typecheck 绿、doc checks 绿——只有全量轮的这一个文件偶发红。

**修法方向（task-worker 建议，⛔ 不代拍）**：negative-control 应把泄漏 fixture 写进它自己已经 `mkdtempSync` 的 scratch 目录（`os.tmpdir()`），不写 `REPO_ROOT` 的 `plugin/test/`——同 `test-framework-policy-check.test.mjs` 自己 AC4 rehearsal 用 scratch dir 的既有模式。

**⊢ gap-ac143 状态**：实现已完成且正确（7 commits，AC3 已勾，AC1/AC2 待外部）。flake 修掉后重跑 fan-in 即可落地；现 status 仍 ready、worktree 干净（分支 head 50b236f61）。

## Plan

1. `tmp-leak-pairing-check.test.mjs` 的 negative-control 把泄漏 fixture 写进 scratch 目录（`os.tmpdir()`），⛔ 不写 `REPO_ROOT` 的 `plugin/test/`。

## Acceptance Criteria

- [x] AC1（能取假，不写真实仓）：negative-control 的泄漏 fixture 写进 scratch 目录（os.tmpdir()），不再写 REPO_ROOT 的 plugin/test/；（⛔ 仍写真实仓 ⇒ 假）。
- [x] AC2（能取假，竞态消除）：tmp-leak-pairing-check.test.mjs 与 test-framework-policy-check.test.mjs 并发跑（同组 engine）不再触发 TOCTOU 红（glob→read 之间无文件被并发删）；（⛔ 仍偶发红 ⇒ 假）。

## Definition of Done

negative-control fixture 写进 scratch 目录；AC1-AC2 全勾；TOCTOU 竞态消除，gap-ac143 重跑 fan-in 不再被此 flake 挡。

## Touches

- plugin/test/tmp-leak-pairing-check.test.mjs（negative-control fixture 改写 scratch dir）
- tasks/gap-test-isolation-race-tmp-leak-negative-fixture-writes-repo.md（自身）
