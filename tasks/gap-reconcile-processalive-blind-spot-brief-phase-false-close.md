---
id: gap-reconcile-processalive-blind-spot-brief-phase-false-close
title: "reconcile processAlive(runId) 盲区——impl subagent 未 fork worktree 的 brief 相被判「worktree-gone-and-no-process」误关 bracket"
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

`fast-mode-telemetry.ts` 的 `makeDefaultExecutorGone`（`--reconcile` 的在飞判定）四级判断 `processAlive → worktreeExists → isBranchMerged → close`，其中 `processAlive(runId)`（:186）把 runId 拆成末两段 needle（如 `1787057856463-sb04tg`）扫 `/proc/*/cmdline`。但 impl subagent 是 Agent 工具派发，其进程 cmdline 不含 runId（runId 是遥测标识，不是进程标识）。于是 brief 相（subagent 已起、worktree 尚未 fork）下：process 查不到 + worktree 不存在 → 落到「worktree-gone-and-no-process」→ **误关 bracket**。

实证（2026-08-18 13:1xZ）：inner 跑 `--reconcile` 误关 closure-skips-task-end + git-history-counts-stale 两条在飞 bracket（其 impl agent 13:14 mtime 仍活跃、worktree 随后 fork 于 87f767ad）。`detectClosedButLive`（reverse 方向，gap-closed-bracket-leaves-live-agent-consuming-slots）随后把两条 catch 成 closed-but-live → `occupied_slots` 仍正确（无过度派发）。**但残留**：end 时间戳写早（duration 测量被污染）+ `closed_brackets_reflect_processes=false` 持续报红直到 fan-in 移除 worktree。

## Acceptance Criteria

- [x] AC1: `--reconcile` 的 executor-gone 判定补上 subagent 活性信号（或修正 `processAlive` 的 runId 盲区），使 brief 相（agent 活、worktree 未 fork）的在飞 bracket 被判 KEEP 而非 close。
- [x] AC2: 负控制——一个 brief 相（有活 impl agent、无 worktree）的 bracket 跑 `--reconcile`，结果 kept（不 close）、无 closed-but-live 残留。
- [x] AC3: 该场景下 `closed_brackets_reflect_processes` 恢复 true（无误关导致的 false 信号）。

## Definition of Done

- [x] 构造 brief 相在飞 bracket（活 agent + 无 worktree）跑 `--reconcile`，bracket 保持 kept、`closed_brackets_reflect_processes=true`、无 closed-but-live 残留（真实输出，非 fixture）。

## Touches

- tasks/gap-reconcile-processalive-blind-spot-brief-phase-false-close.md（自身）
- plugin/scripts/fast-mode-telemetry.ts（makeDefaultExecutorGone / processAlive 修复）
- plugin/test/fast-mode-telemetry.test.mjs（brief 相负控制测试）

## Evidence

**修法**（`plugin/scripts/fast-mode-telemetry.ts`）：`makeDefaultExecutorGone` 由四级改为五级
`processAlive → subagentTranscriptAlive → worktreeExists → isBranchMerged → close`。
新增 `subagentTranscriptAlive(root, taskId)`——扫 `$HOME/.claude/projects/<slug>/*/subagents/agent-*.jsonl`
（slug = root 的 `/`→`-`，同 `fan-in-ff-merge.sh:170` 约定），凡近 `TRANSCRIPT_LIVENESS_WINDOW_MS`（30min，
同 inner tick 节奏、远低于 OVER90 90min）内写入、且前 64KiB 内容含 `tasks/<taskId>.md` 或
`quay-worktrees/<taskId>`（impl subagent 派发 prompt 逐字携带）⇒ KEEP（`subagent-transcript-alive`）。
fail-closed 向 false：任何 fs 错误/缺目录/过期 transcript ⇒ false，永不从不可得来源造阳性。
`processAlive(runId)` 保持不动（其 runId 盲区是结构性的——Agent 派发进程 cmdline 不含 runId 遥测标识）。

**AC1/AC2/AC3 负控制（真实 CLI 输出，非 fixture）**——新增测试
`SUBAGENT-LIVENESS CLI — brief-phase bracket (live transcript, no worktree) is KEPT by --reconcile`
构造「活 impl agent（临时 HOME 下真实 `agent-*.jsonl`，mtime=now）+ 无 worktree + 无 task 分支」的
brief 相 bracket，跑真实 `--reconcile --json`：

```
$ node --test --test-name-pattern="SUBAGENT-LIVENESS" plugin/test/fast-mode-telemetry.test.mjs
✔ SUBAGENT-LIVENESS — subagentTranscriptAlive finds a recent transcript naming the task (PURE, injected projectsDir)
✔ SUBAGENT-LIVENESS — claudeProjectsSlug maps a root path to Claude Code's project-dir slug
✔ SUBAGENT-LIVENESS CLI — brief-phase bracket (live transcript, no worktree) is KEPT by --reconcile; closed_brackets_reflect_processes stays true (AC1/AC2/AC3)
ℹ tests 3 · pass 3 · fail 0
```

CLI 断言：`--reconcile` 输出 `kept[].keepReason === "subagent-transcript-alive"`、`closed` 空；
`--slot-status` 输出 `real_in_flight=1`、`stale_brackets=0`、`closed_but_live_agents=[]`、
`closed_brackets_reflect_processes=true`。反向负控制：删除 transcript 后再 `--reconcile` ⇒
`closed[].reconcileReason === "worktree-gone-and-no-process"`（活性信号消失即关闭，无永久幽灵）。

**scoped 门（`scripts/test.sh --for-task gap-reconcile-processalive-blind-spot-brief-phase-false-close`）**：
exit 0。本文件 80 测试全绿（含既有 RECONCILE/SLOT-STATUS/byte-identity 回归）；
`concurrency-literal-check --gate` PASS（0 violations——窗口常量命名避开 `subagent` 并发关键字，
`SUBAGENT_TRANSCRIPT_WINDOW_MS` 改 `TRANSCRIPT_LIVENESS_WINDOW_MS`）；`cap-counts-subagents-check` OK；
其余 scoped 静态检查全 PASS。
