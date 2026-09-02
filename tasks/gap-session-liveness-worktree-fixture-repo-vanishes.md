---
id: gap-session-liveness-worktree-fixture-repo-vanishes
title: session-liveness worktree fixture repo 目录在测试运行中被清理——makeRepoWithDevelop 后
  repo 消失，git worktree add 报 No such file or directory
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`plugin/test/session-liveness-helpers.mjs` 的 worktree fixture（`makeRepoWithDevelop` + `addWorktree`）在并发 suite 下反复失败：`addWorktree(repo, wt2, "wt-2")` 报 `worktree add wt-2 failed: fatal: cannot change to '/tmp/quay-run-<runId>/session-liveness-scd-c-XXX/repo': No such file or directory`。这是「probe 饿死」之外的**第二类独立失败**——`makeRepoWithDevelop(repo)`（`fs.mkdirSync` + `git init` + `commit` + `branch develop`）在测试内 `:34` 已成功创建 repo，`:35` `addWorktree(repo, wt1)` 也成功，但到 `:44` `addWorktree(repo, wt2)` 时 repo 目录已消失。

**失败路径证据**（fan-in suite 多轮实测）：`session-liveness-scd-inflight-changing.test.mjs`、`session-liveness-scd-busy.test.mjs` 等都撞同一 assertion，失败文件每轮轮换。probe 饿死（`probe must be alive` 超时）经 bclass 移 serial 已解决，但这类 `repo 不存在` 仍在——证明它是独立根因，不是「移 serial」能覆盖的。

**根因候选（需 worker 定位具体清理者）**：`probeRoot()` = `/tmp/quay-run-<runId>/`（per-run namespace，`runNamespaceRoot()` 派生）。repo 消失发生在测试运行期间（`makeRepoWithDevelop` 之后、`addWorktree` 之前），可能的清理者：
1. `sweepTmp(...prefixes)`（session-liveness-helpers.mjs:113，各测试 `after()` 调）——OWNER-LIVENESS 保护（`dirHasLiveOwner`）可能误判活跃 repo 为 owner-dead；
2. `sweepRunNamespaces()`（runner 在 suite 前调）——误判当前 run 的 namespace 为残留；
3. 并发测试的清理路径冲突（前缀重叠 / 共享 p.tmp）。

## Plan

1. 定位「谁删了 repo」：grep `sweepTmp` / `sweepRunNamespaces` / `rmSync` / `rm -rf` 在 session-liveness 测试执行路径的调用点，核对 OWNER-LIVENESS 判定对「带 tmux socket 的活跃 probe 目录」是否真的跳过；重点查 `dirHasLiveOwner` 对「repo 目录（无 tmux socket，但属活跃测试）」是否误判 owner-dead。
2. 修：让清理逻辑不删「仍活跃测试的 repo 目录」——repo 目录与 probe 目录（tmux socket）的 liveness 判定要一致，或给 repo 目录加同等 liveness 标记。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：定位并修「repo 目录在测试运行中被清理」的确切清理者——grep 命中具体清理函数 + 其误删活跃 repo 的路径，静态读代码可见修复（非事后描述）
- [ ] AC2（能取假，生产载体）：并发 suite 下 `session-liveness-scd-*` 系列不再报 `worktree add ... No such file or directory`；落地后轮次该 assertion 出现次数 = 0（只计落地后时间窗，硬规则 4 推论三）
- [ ] AC3（能取假，无回归）：`session-liveness-sweep.test.mjs` 的 OWNER-LIVENESS 负控制仍绿（活跃 owner 目录仍不被清、owner-dead 残留仍被清）

## Definition of Done

清理逻辑不再误删活跃测试的 repo 目录；并发 suite 下 worktree fixture 稳定；sweep 负控制不退化。

## Touches

- plugin/test/session-liveness-helpers.mjs（makeRepoWithDevelop / addWorktree / sweepTmp 的 liveness 判定）
- plugin/scripts/session-liveness-sweep.mjs（sweepRunNamespaces / dirHasLiveOwner，若根因在此）
- plugin/test/session-liveness-sweep.test.mjs（负控制保持）
- tasks/gap-session-liveness-worktree-fixture-repo-vanishes.md（自身）