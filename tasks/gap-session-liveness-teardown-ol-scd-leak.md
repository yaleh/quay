---
id: gap-session-liveness-teardown-ol-scd-leak
title: session-liveness 探针 teardown 泄漏——kill-server 无出口 + 漏杀 pane 子进程孤儿
  claude-probe 误判活 owner（ol-scd 家族）
status: ready
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

`session-liveness` 探针 teardown 有泄漏缺陷（ol-scd 家族），此前被 poll-bounded 的 suite-fix **越界修**了 4 连 commit（`a76959c8 → 338f9a71 → b5351a99 → cc034d90`），内容合法但越界（不在 poll-bounded Touches），inner 已 revert（→ `fbf7669b`）独立立案重做。

核心缺陷（4 连 commit 内容，现已在 develop 上还原为未修态）：

- **kill-server 无出口（ol-scd-c）**：teardown 重试 kill-server 直至 owner 死亡才注销，否则泄漏无出口——`serverPidOf` 定位 tmux server 失败时无回退。
- **漏杀 pane 子进程（ol-scd-e）**：teardown 漏杀 pane 子进程，孤儿 `claude-probe` 被误判为活 owner，挡目录清理。
- **mkdtemp 静态配对 rmSync**：`teardownProbe` 移入 helper 后，restart 测试的 mkdtemp 临时目录静态配对 rmSync 在文件内不可见。

## Acceptance Criteria

- [x] AC1: teardown kill-server 有出口——owner 死亡才注销，`serverPidOf` 定位失败时有回退（SIGKILL），无泄漏（ol-scd-c）。
- [x] AC2: 漏杀 pane 子进程消除——teardown 后无孤儿 `claude-probe` 进程被误判为活 owner、不挡目录清理（ol-scd-e）。
- [x] AC3: scoped 绿 + session-liveness 相关测试不红（真实输出，非 fixture）。

## Definition of Done

- [x] 真实 teardown 后：kill-server 退出（owner 死亡）+ 无孤儿 pane 进程挡目录清理（进程级实测），scoped 绿。

## Evidence

**scoped gate（`bash scripts/test.sh --for-task gap-session-liveness-teardown-ol-scd-leak`）——EXIT=0：**

```
✔ R1 — a session restart in the same window makes the observer resolve the NEW transcript on the next poll (self-heal, no re-mount) (18339.747746ms)
✔ R2 — ambiguous dynamic resolution ... falls back to the configured SESSION_TRANSCRIPTS (3375.69483ms)
✔ R3 — seam: a confident dynamic resolution ... overrides the configured SESSION_TRANSCRIPTS (3138.967785ms)
✔ R4 — seam: a claude process for a DIFFERENT project ... is NOT trusted (3301.579682ms)
✔ R5 — seam: a claude process with NO CLAUDE_* env vars but a ~/.claude/sessions/<pid>.json mapping resolves confident (2948.736155ms)
✔ R6 — a no-env-var claude process ... makes the observer resolve the NEW transcript on every poll (10769.381604ms)
✔ AC4/AC3 — sweepTmp keeps a LIVE probe ... and cleans owner-dead residue (575.990985ms)
✔ reapLiveOwners — kills THIS process's still-alive hermetic probe server and removes the dir (559.795301ms)
✔ serverPidOf — resolves the tmux SERVER daemon's PID via its socket inode, null once killed (534.716313ms)
✔ AC2/AC3 — sweepTmp does NOT kill a live session-liveness monitor process (8249.819143ms)
✔ AC2 — the cleanup surface has no name-based batch kill of session-liveness (9.628603ms)
✔ AC5 (candidate D) — a registered observer's death is detectable (4234.204852ms)
ℹ tests 12  ℹ pass 12  ℹ fail 0  ℹ skipped 0  ℹ duration_ms 43759.946449
```

静态检查全 PASS：`test-framework-policy-check`（421 files / 33 exemptions）、`test-isolation-check`（26 violations 全基线、无新增）、`tmp-leak-pairing-check`（421 files / **0 unpaired mkdtemp**）、`test-impl-census`（421 clean）、`task-contract-check`（no violations）、`touches-one-entry-one-path-check`、`malformed-task-check` 等。

**进程级实测（受控负控制，`serverPidOf` + `panePidsOf` + `teardownProbe` 直测）：**

```
tmpDir: /tmp/session-liveness-ngctl-2EPR39
serverPid (serverPidOf): 2028011
panePids (panePidsOf): [ 2028102 ]
dirHasLiveOwner before teardown: true
dirHasLiveOwner after teardown: false      ← owner 死亡才注销
serverPidOf after teardown: null           ← kill-server 退出
panePidsOf after teardown: []              ← 无孤儿 pane 子进程
tmpDir exists after teardown: false        ← 目录已清理
server pid alive after teardown: false     ← 进程级：server 真死
pane child 2028102 alive after teardown: false  ← 进程级：claude-probe 真死，不挡目录清理
```

teardown 后 `/proc/net/unix` 无 session-liveness socket 残留、无 `/tmp/session-liveness-swp-*` / `restart-*` 残留目录。基线孤儿 `claude-probe 10000` 由本实验**零新增**（受控负控制中的唯一 transient 命中原为 `pgrep -f` 自匹配竞态，复测 `/proc/<pid>` 已退出）。历史遗留的数百孤儿 `claude-probe 10000` 是修复落地**之前**累积（本任务 AC2 修的是 teardown 不再产生新孤儿），非本实现产物。

## Touches

- tasks/gap-session-liveness-teardown-ol-scd-leak.md（自身）
- plugin/scripts/session-liveness-sweep.mjs（teardown kill-server 泄漏 + pane 子进程漏杀修复）
- plugin/test/session-liveness-sweep.test.mjs（kill-server 出口 + 孤儿 pane 负控制）
- plugin/test/session-liveness-restart.test.mjs（mkdtemp 静态配对负控制）
- plugin/test/session-liveness-helpers.mjs（teardownProbe helper 可见性）
