---
id: gap-ac158-execute-archive-batch-one
title: AC158 判据仍红——执行批次一：扫描后死集 112 个脚本 git mv + INDEX 同一提交（尚未执行）
status: todo
labels:
  - gap
parent: "null"
children: []
extra:
  schema: execution
goal_ac: AC-158
---
## Proposal

**问题（立案当轮实测）**：`goals/AC-158-execute-archive-batch-one.md`（status=active、goal=GOAL-003）判据现为 fail——`archive/INDEX.tsv` 只有表头一行、0 条数据行；扫描后死集 112 个脚本一个都没 `git mv` 进 archive。AC-158 的 expect 是「INDEX 有数据行 ∧ 每条 original_path 已不存在、archive_path 存在 ∧ 行数 == SPEC 记录的扫描后死集数（112）」。

**工作（执行批次一，SPEC §12 的落地动作，非机制改动）**：把 §12e/§12f 重算出的扫描后死集（权威名单 `docs/analysis/dead-set-recomputed.json` 的 `after.dead`，112 个裸文件名，全部在 `plugin/scripts/` 下，含 65 个自带测试）`git mv` 进 `archive/2026-09-07-zero-call-scripts/plugin/scripts/`，自带测试同批移到 `archive/2026-09-07-zero-call-scripts/plugin/test/`，并按 §12b 纪律把 `git mv` 与 `archive/INDEX.tsv` 七字段行写进**同一个提交**（硬规则 7）。

**前置已就绪**：AC156（裸文件名扫描 + 死集重算，`gap-dead-set-registry-bare-filename-scan` done；SPEC §12e 两个机读行已由 `gap-ac156-spec-12e-dead-set-lines-writeback` done 写回，`扫描后死集: 112`）；AC157（archive 机制 + 五面排除接线，`gap-archive-mechanism-and-exclusion-wiring` done，`scripts/test.sh:872` 已有 `archive/**` 排除；`gap-ac157-exclusion-wiring-criterion-divergence` ready 只补判据一致性/NUL 修复，不重做机制）。执行前仍按 §12e「执行前须重算」做一次负控制核验（见 Plan 步骤 1）。

**关联任务**：机制面 `gap-archive-mechanism-and-exclusion-wiring`（done）、名单面 `gap-dead-set-registry-bare-filename-scan`（done）。本任务只做「执行 move + INDEX」，不重做扫描、不重做机制、不新改排除面。

## Plan

1. **名单核验（负控制）**：读 `docs/analysis/dead-set-recomputed.json` 的 `after.dead`（112 名），逐条确认 `plugin/scripts/<name>` 仍存在、且 2026-09-05 重算后无新生产调用者（三天零执行 ∧ 无生产调用者仍成立）；若发现某个已重获调用者，摘出单独判，不硬删。
2. **批次目录**：`archive/2026-09-07-zero-call-scripts/`（§12a 格式 `<日期>-<slug>`；若实际执行日不同，slug 日期用执行日，但 Touches glob 保持指向该批次目录）。
3. **git mv**：对 112 个脚本逐一 `git mv plugin/scripts/<name> archive/2026-09-07-zero-call-scripts/plugin/scripts/<name>`；对其中 65 个自带测试的，同批 `git mv plugin/test/<stem>.test.mjs archive/2026-09-07-zero-call-scripts/plugin/test/`。
4. **写 INDEX**：`archive/INDEX.tsv` 追加 112 行，每行七字段 `original_path · archive_path · date · reason_code · evidence · restore_cmd · commit`；reason_code=`zero-call`，evidence 取可复核读数（如 `exec_3d=0 callers=0`），restore_cmd=`git mv <archive_path> <original_path>`。
5. **同一提交**：`git mv` 与 INDEX 行在同一个 commit 里（硬规则 7；不得出现「文件已移、INDEX 未写」的中间提交）。
6. **验证**：跑 AC-158 判据（下方 AC1 的 python3 heredoc）→ exit 0；跑全量 `scripts/test.sh` → 绿（证明 `archive/**` 排除生效、无悬空引用）。

## AC

- [ ] AC-158 判据 exit 0：逐字取自 `goals/AC-158-execute-archive-batch-one.md` criterion 的 python3 heredoc——`archive/INDEX.tsv` 有数据行 ∧ 每条 original_path 已不存在、archive_path 存在 ∧ 行数 == SPEC 的 `扫描后死集: 112`
- [ ] 行数与名单一致：`tail -n +2 archive/INDEX.tsv | wc -l` == 112 == `docs/analysis/dead-set-recomputed.json` 的 `after.deadCount`，且 INDEX 的 original_path 集合与 `after.dead`（`plugin/scripts/<name>`）逐名一致
- [ ] 同一提交：`git mv` 与 INDEX 写在同一 commit（`git log -1 --name-only` 该批次提交同时含被移文件与 `archive/INDEX.tsv`，无中间提交）
- [ ] 自带测试同批：65 个 `plugin/test/<stem>.test.mjs` 与对应脚本同批移走，`plugin/test/` 无孤儿测试残留
- [ ] 全量 suite 绿：`scripts/test.sh` exit 0（证明 `archive/**` 排除生效、无悬空引用）
- [ ] `node plugin/scripts/task-schema-check.ts tasks/gap-ac158-execute-archive-batch-one.md` exit 0

## DoD

`archive/INDEX.tsv` 有 112 条数据行，每条 original_path 在 `plugin/scripts/` 已不存在、archive_path 在 `archive/2026-09-07-zero-call-scripts/` 下存在，`git mv` 与 INDEX 写入同一提交；AC-158 判据在 goal-driver 下一轮由 fail 转 pass（读 `.quay/goal-round.jsonl` 中 AC-158 的 verdict）。⛔ 只移文件不写 INDEX、或 INDEX 行数 ≠ 112、或 move 与 INDEX 分两次提交、或留下孤儿测试 ⇒ 不算达成。

## Touches

- archive/INDEX.tsv
- archive/2026-09-07-zero-call-scripts/plugin/scripts/*
- archive/2026-09-07-zero-call-scripts/plugin/test/*
- plugin/scripts/ac36-sortkey-criterion-check.ts
- plugin/test/ac36-sortkey-criterion-check.test.mjs
- plugin/scripts/ac56-recommended-deordered-check.ts
- plugin/test/ac56-recommended-deordered-check.test.mjs
- plugin/scripts/ac69-slot-queue-gap-check.ts
- plugin/test/ac69-slot-queue-gap-check.test.mjs
- plugin/scripts/anti-gaming-guard.sh
- plugin/scripts/anti-gaming-guard.ts
- plugin/scripts/archguard-runner.ts
- plugin/scripts/assert-clean-tree.sh
- plugin/scripts/audit-independence-check.sh
- plugin/scripts/audit-independence-check.ts
- plugin/scripts/axis-generator.ts
- plugin/test/axis-generator.test.mjs
- plugin/scripts/blocked-signal-check.sh
- plugin/scripts/build-evidence-collector.ts
- plugin/scripts/build-evidence-gate.ts
- plugin/scripts/build-evidence-manifest.ts
- plugin/test/build-evidence-manifest.test.mjs
- plugin/scripts/candidate-synthesis.ts
- plugin/scripts/check-set-after-change-check.ts
- plugin/scripts/checker-cost.sh
- plugin/test/checker-cost.test.mjs
- plugin/scripts/checker-driver-result-ratchet-check.ts
- plugin/test/checker-driver-result-ratchet-check.test.mjs
- plugin/scripts/codex-stage1-live-proof-check.ts
- plugin/scripts/codex-stage1-selfcheck.sh
- plugin/scripts/config-wiring-check.ts
- plugin/scripts/coupling-graph.ts
- plugin/scripts/cross-machine-verify.sh
- plugin/scripts/defect-shape-aggregate.ts
- plugin/test/defect-shape-aggregate.test.mjs
- plugin/scripts/deliver-verify-usage.sh
- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/develop-work-ff.sh
- plugin/test/develop-work-ff.test.mjs
- plugin/scripts/dispatch-record-fingerprint-reason-check.ts
- plugin/test/dispatch-record-fingerprint-reason-check.test.mjs
- plugin/scripts/drivable-workspace-check.sh
- plugin/scripts/drive-target-check.sh
- plugin/test/drive-target-check.test.mjs
- plugin/scripts/execution-policy.ts
- plugin/test/execution-policy.test.mjs
- plugin/scripts/fan-in-materialize-check.ts
- plugin/test/fan-in-materialize-check.test.mjs
- plugin/scripts/fan-in-runid-check.ts
- plugin/test/fan-in-runid-check.test.mjs
- plugin/scripts/fan-in-workflow-retirement-check.ts
- plugin/test/fan-in-workflow-retirement-check.test.mjs
- plugin/scripts/finding-backpropagate.ts
- plugin/test/finding-backpropagate.test.mjs
- plugin/scripts/fork-baseline.ts
- plugin/scripts/gate-dispatch-coverage.ts
- plugin/test/gate-dispatch-coverage.test.mjs
- plugin/scripts/gate-staleness-check.sh
- plugin/test/gate-staleness-check.test.mjs
- plugin/scripts/gate-staleness-check.ts
- plugin/scripts/git-lens-l-d-code-doc-ratio.ts
- plugin/scripts/git-lens-l-g-structural-drift.ts
- plugin/scripts/git-lens-l-s-behavior-variance.ts
- plugin/scripts/inner-idle-log.ts
- plugin/test/inner-idle-log.test.mjs
- plugin/scripts/it0-enforcement-with-design-check.sh
- plugin/scripts/land-capacity-monitor.ts
- plugin/test/land-capacity-monitor.test.mjs
- plugin/scripts/live-repo-literal-assert-check.ts
- plugin/test/live-repo-literal-assert-check.test.mjs
- plugin/scripts/load-sensitive-release-check.ts
- plugin/test/load-sensitive-release-check.test.mjs
- plugin/scripts/loadbearing-test-gate.sh
- plugin/scripts/loadbearing-test-gate.ts
- plugin/scripts/loop-shipping-exclusion-data.mjs
- plugin/scripts/manager-liveness-independent-check.ts
- plugin/test/manager-liveness-independent-check.test.mjs
- plugin/scripts/md-deletion-token-evaporation-check.sh
- plugin/test/md-deletion-token-evaporation-check.test.mjs
- plugin/scripts/measure-suite.mjs
- plugin/test/measure-suite.test.mjs
- plugin/scripts/mechanism-vitality-check.ts
- plugin/test/mechanism-vitality-check.test.mjs
- plugin/scripts/needs-human-recheck.ts
- plugin/test/needs-human-recheck.test.mjs
- plugin/scripts/no-manager-tick-doc-check.ts
- plugin/test/no-manager-tick-doc-check.test.mjs
- plugin/scripts/orphan-session-check.ts
- plugin/test/orphan-session-check.test.mjs
- plugin/scripts/os-anchor-install.sh
- plugin/scripts/os-anchor-watchdog.sh
- plugin/test/os-anchor-watchdog.test.mjs
- plugin/scripts/outer-tick-log-check.sh
- plugin/test/outer-tick-log-check.test.mjs
- plugin/scripts/overhead-instrument.sh
- plugin/scripts/per-task-suite-record-check.ts
- plugin/test/per-task-suite-record-check.test.mjs
- plugin/scripts/periodic-push-backup.sh
- plugin/test/periodic-push-backup.test.mjs
- plugin/scripts/pipe-exit-code-check.sh
- plugin/test/pipe-exit-code-check.test.mjs
- plugin/scripts/preference-notification-check.ts
- plugin/test/preference-notification-check.test.mjs
- plugin/scripts/prefriction-count.sh
- plugin/scripts/preparation-feedback.ts
- plugin/scripts/prepare-admission-check.ts
- plugin/test/prepare-admission-check.test.mjs
- plugin/scripts/prod-data-audit.ts
- plugin/test/prod-data-audit.test.mjs
- plugin/scripts/productization-verification-record-check.ts
- plugin/test/productization-verification-record-check.test.mjs
- plugin/scripts/productization-verification-record.ts
- plugin/scripts/proposal-convergence.ts
- plugin/scripts/provision-verify-worktree.sh
- plugin/test/provision-verify-worktree.test.mjs
- plugin/scripts/quay-branch.ts
- plugin/scripts/quay-check.ts
- plugin/scripts/quay-dispatch.ts
- plugin/scripts/quay-suite.ts
- plugin/scripts/red-window-triage.ts
- plugin/test/red-window-triage.test.mjs
- plugin/scripts/refresh-worktree-quay.sh
- plugin/test/refresh-worktree-quay.test.mjs
- plugin/scripts/release-freshness-check.sh
- plugin/test/release-freshness-check.test.mjs
- plugin/scripts/run-identity.ts
- plugin/test/run-identity.test.mjs
- plugin/scripts/runner-grouping-metadata.mjs
- plugin/test/runner-grouping-metadata.test.mjs
- plugin/scripts/send-to-session.ts
- plugin/scripts/serial-fanin-absorb.ts
- plugin/scripts/session-retirement-check.ts
- plugin/test/session-retirement-check.test.mjs
- plugin/scripts/stage-receipt.ts
- plugin/test/stage-receipt.test.mjs
- plugin/scripts/stale-ready-audit.ts
- plugin/test/stale-ready-audit.test.mjs
- plugin/scripts/state-worded-clause-check.ts
- plugin/test/state-worded-clause-check.test.mjs
- plugin/scripts/suite-bucket-drift-check.ts
- plugin/test/suite-bucket-drift-check.test.mjs
- plugin/scripts/suite-cutoff-verdict.mjs
- plugin/test/suite-cutoff-verdict.test.mjs
- plugin/scripts/suite-fs-trace.ts
- plugin/scripts/supervisor-bus.sh
- plugin/test/supervisor-bus.test.mjs
- plugin/scripts/supervisor-health.sh
- plugin/test/supervisor-health.test.mjs
- plugin/scripts/supervisor-observe.sh
- plugin/test/supervisor-observe.test.mjs
- plugin/scripts/supervisor-preempt-candidates.ts
- plugin/test/supervisor-preempt-candidates.test.mjs
- plugin/scripts/task-ac-carryover-check.ts
- plugin/test/task-ac-carryover-check.test.mjs
- plugin/scripts/task-schema-check.sh
- plugin/scripts/test-file-baseline.ts
- plugin/scripts/test-framework-policy-check.sh
- plugin/test/test-framework-policy-check.test.mjs
- plugin/scripts/tmp-leak-pairing-check.sh
- plugin/test/tmp-leak-pairing-check.test.mjs
- plugin/scripts/tmp-leak-pairing-check.ts
- plugin/scripts/tmux-isolated.sh
- plugin/test/tmux-isolated.test.mjs
- plugin/scripts/tmux-session.ts
- plugin/test/tmux-session.test.mjs
- plugin/scripts/tmux-test-isolation-check.ts
- plugin/test/tmux-test-isolation-check.test.mjs
- plugin/scripts/trend-check.ts
- plugin/test/trend-check.test.mjs
- plugin/scripts/vmeta-lag-check.sh
- plugin/scripts/vmeta-lag-check.ts
- plugin/scripts/workflow-baseline-metrics.ts
- plugin/test/workflow-baseline-metrics.test.mjs
- plugin/scripts/workflow-invariant-ownership.mjs
- plugin/test/workflow-invariant-ownership.test.mjs
- plugin/scripts/workflow-journal.ts
- plugin/test/workflow-journal.test.mjs
- plugin/scripts/workflow-replay.ts
- plugin/test/workflow-replay.test.mjs
- plugin/scripts/worktree-node-modules-check.sh
- tasks/gap-ac158-execute-archive-batch-one.md
