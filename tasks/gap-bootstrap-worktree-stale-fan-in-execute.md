---
id: gap-bootstrap-worktree-stale-fan-in-execute
title: "bootstrap worktree scriptPath 用陈旧 fan-in-execute.js——poll-bounded fix 对 bootstrap-HIT 任务不生效"
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

bootstrap 机制（任务 touches fan-in 编排文件 ⇒ fan-in 用 worktree scriptPath）会让 fan-in 用【worktree 的陈旧 fan-in-execute.js】，而 worktree fork 早于某些 fan-in 编排修复的 land ⇒ 修复对 bootstrap-HIT 任务【不生效】。

实证（2026-08-19）：full-suite-state-stale 是 bootstrap-HIT（touches fan-in 编排），其 worktree 在 e29e5de9 fork（早于 poll-bounded 23a75eba land），所以 worktree 的 fan-in-execute.js 是【旧版】——poll 命令还是旧的立即返回（非 `timeout 540` 阻塞），poll-bounded 的「有界阻塞等待」对 bootstrap-HIT 任务【不生效】。功能正确性不受影响（非阻塞 poll 多 ~21 次往返），但 DoD「~3 次」在生产没实现。

## Acceptance Criteria

- [x] AC1: bootstrap 机制的 worktree scriptPath 在 merge develop 前【先同步 fan-in-execute.js 到 worktree】（或改为 main scriptPath + 显式 worktree 参数），确保 worktree 用最新编排文件。
      落地：新增 `--bootstrap-sync` 模式（select-static-checks-for-touches.ts），`git merge <mergeTarget>` 把 develop 最新编排修复合入 worktree（保留本分支修改——自举 self-validation）。两处调用：① A6 派发规则（fast-mode-tick-core.md）——hit ⇒ 派发前先同步，使 dispatch-time scriptPath 即为合入后的最新文件；② workflow step 0——merge develop（step 1）前再同步兜底（命中时跑，幂等）。
- [ ] AC2: 负控制落在生产载体——一个 bootstrap-HIT 任务的 fan-in，poll 命令确为最新版（含 timeout 540 阻塞），轮询次数 ~3 次（读生产 journal，非 fixture）。（待外部）
- [x] AC3: scoped 绿 + bootstrap 相关测试不红。
      实测：fan-in-execute-paths.test.mjs 87/87 绿（含新增 ⑦b 同步 5 测试）、select-static-checks-for-touches.test.mjs 17/17 绿、tick-core-static-check + workflows-dual-copy-drift-check + fan-in-workflow-check + fan-in-ff-executor-check 143/143 绿。

## Definition of Done

- [ ] bootstrap-HIT 任务的 fan-in 用最新编排文件，poll-bounded 的「~3 次」生效（真实输出）。（待外部）

## Touches

- tasks/gap-bootstrap-worktree-stale-fan-in-execute.md（自身）
- plugin/scripts/（bootstrap 机制：`--bootstrap-sync` 模式落 select-static-checks-for-touches.ts）
- plugin/test/（bootstrap-HIT 负控制 + 同步机制测试，fan-in-execute-paths.test.mjs ⑦b 组）
- .claude/workflows/fan-in-execute.js（step 0 自举同步 + WARN 修正——原 Touches 只列 plugin/scripts/，正确修复需 workflow 侧在 merge develop 前同步，依任务指引 option (b) 明示纳入）
- plugin/workflows/fan-in-execute.js（上述的双拷贝镜像，workflows-dual-copy-drift-check 要求同步）
- orchestration/fast-mode-tick-core.md（A6 派发规则：hit ⇒ 派发前先 `--bootstrap-sync`）
- plugin/loop/fast-mode-tick-core.md（上述 A6 规则的落地副本，tick-core-static-check 归一比对要求同步）
