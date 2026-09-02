---
id: gap-test-file-snapshot-worktree-drops-realinstall
title: test-file-snapshot 在 worktree 报 sea-artifact-consumer-e2e.test.mjs
  REMOVED——文件在盘+tracked，worktree --list-files 却漏列
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

`gap-sea-artifact-consumer-e2e-ac4-assertion` fan-in 撞 `test-file-snapshot: FAIL — baseline test file(s) REMOVED`，被移除文件 = `packages/quay/test/sea-artifact-consumer-e2e.test.mjs`。

**逐行核实（纠正 peer 两个假设）**：
- 该文件**在 worktree 盘上存在**（11050 B）+ **git tracked**（`git -C <wt> ls-files` 返回它、`git status` 干净）⇒ **非「refresh-worktree 跳过 255 文件」**（那 255 个是 `.quay` heavy/wasteful carrier，非测试文件）；
- removals 列表**非空**（直接复现 `comm -23` 输出恰是这一行文件，`od -c` 见 `...sea-artifact-consumer-e2e.test.mjs\n`）⇒ **非「空行/不可见字符过滤 bug」**。

**真根因方向**：`test.sh --list-files` 主检出**含**该文件（`grep -c`=1），worktree **漏列**它——`--list-files` 是 `select_files` 分组结果（非 find/git ls-files），该文件标注 `@test-group product` + `@load-sensitive real-install` + `@load-sensitive-entry`，在 worktree 环境下被 `select_files` 分组漏掉（主检出不漏）。是 worktree-specific 的 `--list-files`/`select_files` 行为，非该任务删文件。

**实现核实（纠正上段「worktree-specific」假设，非 worktree 特例）**：实测该文件当前标注 `@test-group serial`（`gap-sea-artifact-consumer-e2e-ac4-assertion` 的 `b24cbe0d9` 把它从 product 迁到 serial），而 no-args `test.sh --list-files` 只输出 `product,engine` + `lowconc`（共 549），**漏掉 serial 群（16 个）**——主检出与 worktree **同样**漏列（`--list-groups total`=565）。真根因：no-args `--list-files` 不是完整 canonical 集合，它漏了 serial 群，于是任何 `@test-group` 从默认群迁入 serial 的 tracked 文件都会被 `test-file-snapshot` 读成 REMOVED（且 serial 文件从不受真删保护）。修法：no-args `--list-files` 补 serial 群，使 565 == `--list-groups total`；baseline 重快照到 565。

## Plan

1. 复现：worktree 与主检出各跑 `test.sh --list-files`，diff 出 sea-artifact 是否仅 worktree 漏列；追踪 `select_files` 对该文件的分组路径。
2. 定位 `select_files` 在 worktree 环境漏列该文件的判据（`@load-sensitive-entry` real-install tiering + worktree 状态差异）。
3. 修：`--list-files`/`select_files` 在 worktree 与主检出行为一致（或 baseline 快照机制对 real-install tier 的处理）。

## Acceptance Criteria

- [x] AC1（能取假）：worktree 与主检出 `test.sh --list-files` 对同一 tracked 测试文件集合一致（sea-artifact 不再仅 worktree 漏列）；（⛔ worktree 仍漏列 ⇒ 假）。
- [x] AC2（能取假，无回归）：真删测试文件仍报 REMOVED（baseline 计数回归保护不退化）；（⛔ 误放行真删 ⇒ 假）。

## Definition of Done

worktree 与主检出 `--list-files` 一致；AC1/AC2 勾；test-file-snapshot 不再误报 tracked 文件 REMOVED；真删文件仍 fail-closed；全量 suite 绿。

## Touches

- scripts/test.sh（no-args --list-files 补 serial 群，全群=--list-groups total）
- plugin/test/runner-grouping-list-groups.test.mjs（AC3/AC6 断言随全群语义更新）
- plugin/test/runner-grouping-serial-anti-stomp.test.mjs（默认 --list-files 由「排除 serial」改为「含 serial」断言）
- docs/analysis/test-file-baseline.txt（重快照 565 全群，含 serial）
- scripts/test-coverage-check.ts（AC5 注释随全群语义更新）
- plugin/test/test-coverage-check.test.mjs（AC5 注释随全群语义更新）
- tasks/gap-test-file-snapshot-worktree-drops-realinstall.md（自身）

## Needs-Human

**执行 2026-09-02T11:09:21.850Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red
- run_id：wk-prod-1788285192
- session_id：0f9a8a58-b1ae-47b0-84ad-a922546ba529
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-test-file-snapshot-worktree-drops-realinstall~wk-prod-1788285192~1788346205648-883f35.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-test-file-snapshot-worktree-drops-realinstall-wk-prod-1788285192.log

## Needs-Human

**执行 2026-09-02T15:31:35.806Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red
- run_id：wk-prod-1788285192
- session_id：0b268117-4ecc-4bc0-b936-600e4b06cdf2
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-test-file-snapshot-worktree-drops-realinstall~wk-prod-1788285192~1788362066230-cee6a3.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-test-file-snapshot-worktree-drops-realinstall-wk-prod-1788285192.log
