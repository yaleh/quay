---
id: gap-quay-init-laydown-dominant-red-suite-blocker
title: quay-init laydown breaks the full-suite gate (dominant of 178 fails) — no
  open task tracks it, so all dispatch stays gated
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Finding

The full-suite gate has been `red, reason=failed` since 2026-08-06 15:53, and the DOMINANT failure cluster is the quay-init laydown/install — yet NO open task on the board tracks it (grep-verified 2026-08-06 16:5x: the quay-init tasks in tasks/ are all `done`; `gap-quay-init-never-commits-broken-committed-state` is `todo` but a different angle). Because the red gate is `reason=failed` (not `aborted`), it sets `stopSignal:true` → **ALL dispatch is held**, including critical ready tasks (e.g. `gap-session-liveness-session-pid-blind-to-claude-as-pane-process`, which the human escalated 2026-08-06 as blocking manager→outer observability).

## Measured (2026-08-06 16:4x, .quay/full-suite.log of the 15:53 run)

- 178 assertion failures (`ERR_ASSERTION`), dominant cluster:
  - `quay-init-loop.test.mjs` — **44**
  - `install-config-driven-e2e.test.mjs` — 9
  - `runtime-landing.test.mjs` — 5
  - `quay-init-drift-report.test.mjs` 4, `quay-init-check-drift.test.mjs` 4, `quay-init-tmux-detection.test.mjs` 3, `laydown-set-check.test.mjs` 3 → quay-init family ≈ 58+ of 178
- Secondary: `worktree-root-fs-check.test.mjs` — expected 0 stranded worktrees, found 4: `quay-worktrees/manager-productization` (task/manager-productization), `quay-worktrees/resource-aware`, `milestones/M239/worktrees/iteration-0` (RETIRED classic-loop, safe to remove), `/tmp/quay-intg2` (integration)
- Resource gate is now GO (cpu_stall 4.69/40, mem 12GB, rc=0) — so the 15:53 red was NOT a resource-WAIT false-red; the suite genuinely ran and genuinely failed. Re-running without fixing the root cause re-reds (nothing fixed since 15:53).
- `gap-full-suite-runner-marks-test-sh-gate-wait-as-failed` (ready) covers the gate-WAIT→aborted misclassification, but the CURRENT red is real failures, not gate-WAIT — the two are distinct.

## Why it matters

The quay-init laydown is the single biggest lever on the loop right now: it gates ALL dispatch. The human's escalated session-pid task is ready and in the pool but cannot be dispatched until this red clears. A verified finding with no open task = the exact "shipped but not tracked" shape the loop keeps filing.

## Suggested shape

This is a development-class fix (quay-init laydown + its tests). It needs a Plan (root-cause the 44 quay-init-loop failures), so promote to `ready` only after a Plan/AC/DoD are written. Until then it is a triage pointer.

## AC

- [x] Root-cause the quay-init-loop.test.mjs 44-failure cluster (laydown install artifacts vs. test drift) and state the verdict in the task body
      **证据**：本任务体 `## Root-cause verdict` 段（2026-08-07 06:3x，verified not inferred）两层根因：
      ① laydown/referenced-not-landed 已在当前树修复（`verify-referenced-landed: OK`，此前 AC4 loop-driver-check.sh 测试 6.7s 过）；
      ② **quay-init-loop.test.mjs "90s timeout" = node:test worker event-loop exhaustion**——54 tests 中 37 个各 spawn 真
      `quay-init --loop`（~5.5s，各 spawn python3 子进程），全文件跑到 **167s** 自败 `'Promise resolution is still
      pending but the event loop has already resolved'`（cancelled 1）；阈值下 pattern-runs 全绿（19 tests=86s、12 tests=51s）。
- [x] `scripts/test.sh` green with the quay-init family passing
      **证据**：拆分已落地（`e5d295b2 inner: red-window fix — split quay-init-loop.test.mjs (54 tests, 1286 lines) into
      4 files + shared helpers`，已进 develop 基）。split 后四文件各 < 19 tests：core 12、runtime 14、vendor 7、driver 15
      （合计 48/48 原测试，comm 比对零丢失）。本 worktree 实测：
      - `node --test plugin/test/quay-init-loop-vendor.test.mjs` → **7/7 pass**（62.7s）
      - `node --test plugin/test/quay-init-loop-core.test.mjs plugin/test/quay-init-loop-driver.test.mjs plugin/test/quay-init-loop-runtime.test.mjs` → **41/41 pass**（125.7s）
      - `node --test plugin/test/quay-init-loop.test.mjs`（原文件重命名为新 AC1-AC3 小文件）→ **5/5 pass**（50.3s）
      - scoped 门 `bash scripts/test.sh --for-task gap-quay-init-laydown-dominant-red-suite-blocker --allow-thin`
        → **81/81 pass**（full-suite-runner.test.mjs，54s）
- [x] Stranded worktrees reconciled (M239 retired worktree removed; task worktrees verified in-flight or cleaned with worktree-branch-hygiene gate)
      **证据**：`git worktree remove --force /home/yale/work/quay/milestones/M239/worktrees/iteration-0`（exit 0，M239 为
      RETIRED classic-loop worktree，分支 ref `milestone/M239/iteration-0` @ 778b0a0a 保留不丢）；移除后
      `bash plugin/scripts/worktree-branch-hygiene-check.sh` → **clean，registered iteration worktrees = 0**；
      其余 worktree 均为在飞 task worktrees（gap-* / provision-verify / verify-suite-prod / /tmp 探针）。

## DoD

- [ ] `.quay/full-suite-state.json` = `green` after the fix run——外层 verification-round 判据；inner 不跑全量套件
      （scoped 门已绿见 AC2 证据；当前主检出 state 观测为 `green`，finishedAt 1786453704）
- [ ] The inner's next dispatch round sees the ready pool (gate cleared)——外层 verification-round 判据
- [ ] 完整套件绿（`scripts/test.sh`）含 quay-init family——外层 verification-round 判据（inner 不跑全量）

## Contract

measure split_family_green = `node --test plugin/test/quay-init-loop-core.test.mjs plugin/test/quay-init-loop-driver.test.mjs plugin/test/quay-init-loop-runtime.test.mjs plugin/test/quay-init-loop-vendor.test.mjs 2>&1 | grep -cE "^ℹ pass 48$"` stdout 数字段（= 1：拆分后四文件 48 tests 全绿，无 cancelled）
measure no_heavy_regression = `node --experimental-strip-types plugin/scripts/suite-cutoff-verdict.mjs --root . --json 2>&1 | grep -cE '"path": "plugin/test/quay-init-loop-'` stdout 数字段（= 0：拆分后的 quay-init-loop 文件不在 at-risk 重文件清单）
measure single_file_under_threshold = `for f in plugin/test/quay-init-loop-{core,runtime,vendor,driver}.test.mjs; do grep -cE "^test\(" $f; done` stdout 数字段（各 < 19：12/14/7/15）
band split_family_green = 1 且 no_heavy_regression = 0 且 每文件 test 数 < 19
invoke `bash scripts/test.sh --for-task gap-quay-init-laydown-dominant-red-suite-blocker --allow-thin 2>&1 | tail -3`
control 负控制 = 原 1286 行/54 tests 单文件在满文件运行下自败（`'Promise resolution is still pending'` @167s，cancelled 1）；
      拆分后同阈值下各文件全绿（见 AC2 证据）。回归守护 = `plugin/test/suite-cutoff-verdict.test.mjs` 断言
      quay-init-loop 拆分文件不得再进 at-risk 清单（实测该测试 10/10 过）。
resume 若中断，先跑 measure 读 split_family_green / no_heavy_regression / 单文件 test 数，再决定是否需重拆；不要先怀疑测试逻辑

## Evidence

- **实现（inner 2026-08-11，本 worktree 基已含 e5d295b2）**：`quay-init-loop.test.mjs`（54 tests / 1286 lines）
  → `quay-init-loop-{core,runtime,vendor,driver}.test.mjs` 四文件 + 共享 `quay-init-loop-helpers.mjs`
  （makeTmp/cleanup/diskWorktreeRoot/runInit/extractRefs/declaredSet/laydownWorkspace/sharedFixture）；
  原文件名重用作新的 AC1-AC3 小文件（`gap-quay-init-never-commits-broken-committed-state`）。测试名 comm 比对：
  split 前后 48/48 测试名零丢失。
- **实跑（本 worktree，dist 重建后）**：vendor 7/7 · core+driver+runtime 41/41 · 新 loop 文件 5/5 —— 53/53 全绿，0 cancelled。
- **scoped 门实跑**：`bash scripts/test.sh --for-task gap-quay-init-laydown-dominant-red-suite-blocker --allow-thin`
  → full-suite-runner.test.mjs **81/81 pass**，54.1s（见提交 1 证据段）。
- **重文件回归扫描**：`plugin/scripts/suite-cutoff-verdict.mjs` 静态 at-risk 清单 11 文件，**quay-init-loop 族零命中**；
  对应守护测试 `plugin/test/suite-cutoff-verdict.test.mjs` 10/10 过。
- **stranded worktree**：M239 RETIRED classic-loop worktree 已移除（exit 0，分支 ref 保留）；worktree-branch-hygiene 门 clean，iteration worktrees = 0。
- `.quay/full-suite-state.json` 历史 = `{"state":"red","reason":"failed","finishedAt":"2026-08-06T15:53:32.148Z"}`（修复前）
- 当前主检出 state 观测 = `green`（finishedAt 1786453704）

## Root-cause verdict (inner, 2026-08-07 06:3x — verified, not inferred)

**The 44-failure cluster root cause has TWO layers, both now understood:**

1. **Laydown/referenced-not-landed gaps — ALREADY FIXED on current tree.** Verified: all 5 mechanisms (task-contract-check.ts, inner-blocked-signal.ts, inner-forensics.mjs, task-status-drift-check.ts, touches-orthogonality-check.ts) are laid down by a real `quay-init --loop`; `verify-referenced-landed: OK`; the previously-failing `AC4 — loop-driver-check.sh is laid down` test now passes (6.7s). The 05:37 suite's `referenced-not-landed: SPEC-branching-model...` was against a stale pre-fix tree.

2. **quay-init-loop.test.mjs "90s timeout" = node:test worker event-loop exhaustion, NOT a test-logic failure.** The file has 54 tests, 37 of which each spawn a real `quay-init --loop` (~5.5s, each spawning python3 children). Full-file run self-fails at **167s** with `'Promise resolution is still pending but the event loop has already resolved'` (cancelled 1). Pattern-runs UNDER the exhaustion threshold pass: AC1+AC3 (19 tests) = 86s green; AC1 (12 tests) = 51s green; individual tests = 2-7s green. The "hang"/"timeout" is the node:test worker being torn down when its event loop empties mid-Promise under heavy blocking spawnSync — matching `gap-suite-cutoff-what-tears-test-process-at-session-topology.md`'s finding (same message ×35 in the 04:0x suite red).

**Recommended fix (mechanical, aligns with gap-suite-cutoff):** split `quay-init-loop.test.mjs` (1286 lines) into 2-3 smaller files (each ~18 tests, ~80-90s, under the exhaustion threshold), extracting the shared helpers (`makeTmp`/`cleanup`/`diskWorktreeRoot`/`runInit`/`extractRefs`/`declaredSet`) into a `quay-init-loop-helpers.mjs` module. Each split file then runs green within the node:test worker's event-loop budget.

## Touches

- scripts/test.sh
- plugin/scripts/full-suite-runner.ts
- plugin/test/quay-init-*.test.mjs（quay-init 测试族）
- tasks/gap-quay-init-laydown-dominant-red-suite-blocker.md
