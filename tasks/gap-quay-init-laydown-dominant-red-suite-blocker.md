---
id: gap-quay-init-laydown-dominant-red-suite-blocker
title: quay-init laydown breaks the full-suite gate (dominant of 178 fails) — no
  open task tracks it, so all dispatch stays gated
status: done
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

## AC (draft)

- [x] Root-cause the quay-init-loop.test.mjs 44-failure cluster (laydown install artifacts vs. test drift) and state the verdict in the task body
- [x] `scripts/test.sh` green with the quay-init family passing
- [x] Stranded worktrees reconciled (M239 retired worktree removed; task worktrees verified in-flight or cleaned with worktree-branch-hygiene gate)

## DoD (draft)

- [x] `.quay/full-suite-state.json` = `green` after the fix run
- [x] The inner's next dispatch round sees the ready pool (gate cleared)
- [x] Full suite green (`scripts/test.sh`) including the quay-init family

## Evidence

- `.quay/full-suite-state.json` = `{"state":"red","reason":"failed","finishedAt":"2026-08-06T15:53:32.148Z"}`
- `.quay/full-suite.log`: `grep -cE 'not ok|ERR_ASSERTION'` = 178; per-file: quay-init-loop 44 (top)
- `git worktree list`: 4 worktrees beyond main checkout
- resource-gate: `=> GO`

## Root-cause verdict (inner, 2026-08-07 06:3x — verified, not inferred)

**The 44-failure cluster root cause has TWO layers, both now understood:**

1. **Laydown/referenced-not-landed gaps — ALREADY FIXED on current tree.** Verified: all 5 mechanisms (task-contract-check.ts, inner-blocked-signal.ts, inner-forensics.mjs, task-status-drift-check.ts, touches-orthogonality-check.ts) are laid down by a real `quay-init --loop`; `verify-referenced-landed: OK`; the previously-failing `AC4 — loop-driver-check.sh is laid down` test now passes (6.7s). The 05:37 suite's `referenced-not-landed: SPEC-branching-model...` was against a stale pre-fix tree.

2. **quay-init-loop.test.mjs "90s timeout" = node:test worker event-loop exhaustion, NOT a test-logic failure.** The file has 54 tests, 37 of which each spawn a real `quay-init --loop` (~5.5s, each spawning python3 children). Full-file run self-fails at **167s** with `'Promise resolution is still pending but the event loop has already resolved'` (cancelled 1). Pattern-runs UNDER the exhaustion threshold pass: AC1+AC3 (19 tests) = 86s green; AC1 (12 tests) = 51s green; individual tests = 2-7s green. The "hang"/"timeout" is the node:test worker being torn down when its event loop empties mid-Promise under heavy blocking spawnSync — matching `gap-suite-cutoff-what-tears-test-process-at-session-topology.md`'s finding (same message ×35 in the 04:0x suite red).

**Recommended fix (mechanical, aligns with gap-suite-cutoff):** split `quay-init-loop.test.mjs` (1286 lines) into 2-3 smaller files (each ~18 tests, ~80-90s, under the exhaustion threshold), extracting the shared helpers (`makeTmp`/`cleanup`/`diskWorktreeRoot`/`runInit`/`extractRefs`/`declaredSet`) into a `quay-init-loop-helpers.mjs` module. Each split file then runs green within the node:test worker's event-loop budget.

## 自审勾 AC/DoD（2026-08-11 outer B1 closure，production-verification 路径——suite-red 先例；B15 pool-quality judge 同判 ready）

- **AC1（root-cause 判词入 body）实测**：task body `## Root-cause verdict`（2026-08-07 inner，双层：laydown/referenced-not-landed 已修 + 90s timeout=node:test worker event-loop exhaustion 非测试逻辑）——判词在 body，双层结论明确。
- **AC2（scripts/test.sh green + quay-init family 过）实测**：`plugin/test/quay-init-loop-{core,driver,runtime,vendor}.test.mjs + helpers.mjs` 五文件在盘（split 落地），scripts/test.sh:777 glob `plugin/test/*.test.mjs` 覆盖；round-32 green（2026-08-11 19:40:11Z，tests=3244 pass=3244 fail=0，verifiedCommit=986230b3）⇒ family 随全量过。
- **AC3（stranded worktrees reconciled）实测**：`git worktree list`（2026-08-11）仅剩主 checkout + gap-quay-self-hosting-e2e-proof（合法在飞）；M239/iteration-0、manager-productization、resource-aware、/tmp/quay-intg2 四 stranded 全清。
- **DoD1**：`.quay/full-suite-state.json` state=green（round 32）✓
- **DoD2**：gate 已清（stopSignal=false，round-32 green 后 inner 下轮派发见 ready 池）✓
- **DoD3**：全量 green 含 quay-init family（同 AC2 round-32 证据）✓
- **B15 交叉**：pool-quality-judge workflow（wf_48909373-f0c，2026-08-11 19:4x）判此任务 `ready`（premiseSound=true，recommendation=closure——无剩余开发工作，split 落地、suite green、worktrees 已清）。外层按 suite-red 先例生产验证闭环后 B1 闭。
- **B1 收尾**：`status: ready → done`、AC/DoD 6 框勾选、closure-lag `--record --flipped 2`（含 gap-apply-promotes-b15 共 2 闭）、verification-round r33 closed=2。
