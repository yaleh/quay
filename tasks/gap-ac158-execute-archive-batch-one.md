---
id: gap-ac158-execute-archive-batch-one
title: AC158 判据仍红——执行批次一：扫描后死集 82 个脚本 git mv + INDEX 同一提交（名单已 2026-09-07 重算，112→82）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  needs_human_reason: "【2026-09-08 更新，第三轮同形；⛔ 不要因
    gap-dead-set-closure-misses-four-reference-kinds 落地就解锁】该任务已把死集 82→31 且其自身闸打印
    `PASS … none in dead set (after=31)`，但 31 名单仍混入至少 7 个活脚本，其中 4 个由
    scripts/test.sh 每轮亲自执行 —— 按此名单 git mv 会当场打断 suite（AC5 结构上不可能绿）：①
    overhead-instrument.sh ← scripts/test.sh:951 source；②
    run-namespace-sweep-kill.mjs ← scripts/test.sh:1126/1280/1646 node；③
    state-worded-clause-check.ts ← scripts/test.sh:313 run_checker +
    checker-mutation-cases fixture；④ refresh-worktree-quay.sh ←
    scripts/test.sh:209 bash；⑤ send-to-session.ts ← driver-runtime.ts:449
    path.join+spawn；⑥ tmux-session.ts ← plugin/test/helpers/hermetic-tmux.mjs:21
    真 import（6+ 活测试经此）；⑦ tmux-test-isolation-check.ts ← checker-mutation-cases
    fixture。已证实根因之一（带对照）：maskComments 把 scripts/test.sh:792 非注释代码行 `local
    glob=(packages/*/test/*.test.mjs …)` 的 `/*` 当块注释起点，吞掉其后全部内容（:222/:270/:465
    掩码后存活，:951 被抹白；同一正则对未掩码原文跑四条全中）；另外 5 个属独立缺口，不由它解释。归属仍是【名单面】，非本【执行】任务缺陷。人
    2026-09-08 裁定改判定范式：停止补正则，收集器改文本 fail-closed，并以『临时 worktree 全量 git mv + 跑真
    suite』的移除证明作为前移判据 —— 已立案
    gap-dead-set-judgment-fail-closed-text-and-removal-proof 并置为本任务 depends_on。⛔
    解锁前提（两条都要）：① 该任务 done；② 其产物 docs/analysis/dead-set-removal-proof.json 的
    suiteVerdict=green 且 candidates 与当轮 after.dead 逐名一致。⚠️
    解锁时本任务体须整体重写：Proposal/Plan/AC/DoD 通篇硬编码 82、且 ## Touches 逐条列了 82 脚本 + 46 测试
    —— 名单改变后不重写会因 Touches 过度声明拉起 repo ratchet。另：capability-catalog.sh
    声明了全部候选脚本，移动须 quay-init-closure-ratchet --reanchor 并把 baseline 计入
    Touches。未做任何 move、worktree 干净无提交。"
goal_ac: AC-158
depends_on:
  - gap-dead-set-judgment-fail-closed-text-and-removal-proof
---
## Proposal

**问题（立案当轮实测）**：`goals/AC-158-execute-archive-batch-one.md`（status=active、goal=GOAL-003）判据现为 fail——`archive/INDEX.tsv` 只有表头一行、0 条数据行；扫描后死集 82 个脚本一个都没 `git mv` 进 archive。AC-158 的 expect 是「INDEX 有数据行 ∧ 每条 original_path 已不存在、archive_path 存在 ∧ 行数 == SPEC 记录的扫描后死集数（当前 82）」。

**工作（执行批次一，SPEC §12 的落地动作，非机制改动）**：把 §12e/§12f 重算出的扫描后死集（权威名单 `docs/analysis/dead-set-recomputed.json` 的 `after.dead`，82 个裸文件名，全部在 `plugin/scripts/` 下，含 46 个自带测试）`git mv` 进 `archive/2026-09-07-zero-call-scripts/plugin/scripts/`，自带测试同批移到 `archive/2026-09-07-zero-call-scripts/plugin/test/`，并按 §12b 纪律把 `git mv` 与 `archive/INDEX.tsv` 七字段行写进**同一个提交**（硬规则 7）。

**前置已就绪**：AC156（裸文件名扫描 + 死集重算，`gap-dead-set-registry-bare-filename-scan` done；SPEC §12e 两个机读行已由 `gap-ac156-spec-12e-dead-set-lines-writeback` done 写回，`扫描后死集: 82`）；AC157（archive 机制 + 五面排除接线，`gap-archive-mechanism-and-exclusion-wiring` done，`scripts/test.sh:872` 已有 `archive/**` 排除；`gap-ac157-exclusion-wiring-criterion-divergence` ready 只补判据一致性/NUL 修复，不重做机制）。执行前仍按 §12e「执行前须重算」做一次负控制核验（见 Plan 步骤 1）。

**⚠️ 2026-09-07 名单已重算（本任务体据此从 112 改写为 82）**：首次执行时 Plan 步骤 1 的负控制查出 112 名死集混入 ≥14 个仍被生产执行的活 checker——根因是 `registry-bare-filename-scan.ts` 的注释剥离器把 `runner-static-gate.ts`（带 `.ts` 扩展的 bash 文件）里 `# @static-object … packages/*/test/ …` 注释中的 `/*` 当块注释起点、吞掉整段 `run_checker` 行。该根因已由 `gap-dead-set-closure-repo-root-call-form-false-positive`（done）修复，`docs/analysis/dead-set-recomputed.json` 的 `after.deadCount` 现为 **82**，`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md:459` 的机读行已同步为 `扫描后死集: 82`。**本次执行仍须重跑步骤 1 负控制，不得直接采信 82 这个数。**

**关联任务**：机制面 `gap-archive-mechanism-and-exclusion-wiring`（done）、名单面 `gap-dead-set-registry-bare-filename-scan`（done）。本任务只做「执行 move + INDEX」，不重做扫描、不重做机制、不新改排除面。

## Plan

1. **名单核验（负控制）**：读 `docs/analysis/dead-set-recomputed.json` 的 `after.dead`（82 名），逐条确认 `plugin/scripts/<name>` 仍存在、且 2026-09-07 重算后无新生产调用者（三天零执行 ∧ 无生产调用者仍成立）；若发现某个已重获调用者，摘出单独判，不硬删。
2. **批次目录**：`archive/2026-09-07-zero-call-scripts/`（§12a 格式 `<日期>-<slug>`；若实际执行日不同，slug 日期用执行日，但 Touches glob 保持指向该批次目录）。
3. **git mv**：对 82 个脚本逐一 `git mv plugin/scripts/<name> archive/2026-09-07-zero-call-scripts/plugin/scripts/<name>`；对其中 46 个自带测试的，同批 `git mv plugin/test/<stem>.test.mjs archive/2026-09-07-zero-call-scripts/plugin/test/`。
4. **写 INDEX**：`archive/INDEX.tsv` 追加 82 行，每行七字段 `original_path · archive_path · date · reason_code · evidence · restore_cmd · commit`；reason_code=`zero-call`，evidence 取可复核读数（如 `exec_3d=0 callers=0`），restore_cmd=`git mv <archive_path> <original_path>`。
5. **同一提交**：`git mv` 与 INDEX 行在同一个 commit 里（硬规则 7；不得出现「文件已移、INDEX 未写」的中间提交）。
6. **验证**：跑 AC-158 判据（下方 AC1 的 python3 heredoc）→ exit 0；跑全量 `scripts/test.sh` → 绿（证明 `archive/**` 排除生效、无悬空引用）。

## AC

- [ ] AC-158 判据 exit 0：逐字取自 `goals/AC-158-execute-archive-batch-one.md` criterion 的 python3 heredoc——`archive/INDEX.tsv` 有数据行 ∧ 每条 original_path 已不存在、archive_path 存在 ∧ 行数 == SPEC 的 `扫描后死集: 82`
- [ ] 行数与名单一致：`tail -n +2 archive/INDEX.tsv | wc -l` == 82 == `docs/analysis/dead-set-recomputed.json` 的 `after.deadCount`，且 INDEX 的 original_path 集合与 `after.dead`（`plugin/scripts/<name>`）逐名一致
- [ ] 同一提交：`git mv` 与 INDEX 写在同一 commit（`git log -1 --name-only` 该批次提交同时含被移文件与 `archive/INDEX.tsv`，无中间提交）
- [ ] 自带测试同批：46 个 `plugin/test/<stem>.test.mjs` 与对应脚本同批移走，`plugin/test/` 无孤儿测试残留
- [ ] 全量 suite 绿：`scripts/test.sh` exit 0（证明 `archive/**` 排除生效、无悬空引用）
- [ ] `node plugin/scripts/task-schema-check.ts tasks/gap-ac158-execute-archive-batch-one.md` exit 0

## DoD

`archive/INDEX.tsv` 有 82 条数据行，每条 original_path 在 `plugin/scripts/` 已不存在、archive_path 在 `archive/2026-09-07-zero-call-scripts/` 下存在，`git mv` 与 INDEX 写入同一提交；AC-158 判据在 goal-driver 下一轮由 fail 转 pass（读 `.quay/goal-round.jsonl` 中 AC-158 的 verdict）。⛔ 只移文件不写 INDEX、或 INDEX 行数 ≠ 82、或 move 与 INDEX 分两次提交、或留下孤儿测试 ⇒ 不算达成。

## Touches

- archive/INDEX.tsv
- archive/2026-09-07-zero-call-scripts/plugin/scripts/*
- archive/2026-09-07-zero-call-scripts/plugin/test/*
- plugin/scripts/anti-gaming-guard.sh
- plugin/scripts/anti-gaming-guard.ts
- plugin/scripts/audit-independence-check.sh
- plugin/scripts/audit-independence-check.ts
- plugin/scripts/axis-generator.ts
- plugin/scripts/build-evidence-collector.ts
- plugin/scripts/build-evidence-gate.ts
- plugin/scripts/build-evidence-manifest.ts
- plugin/scripts/candidate-synthesis.ts
- plugin/scripts/checker-cost.sh
- plugin/scripts/checker-driver-result-ratchet-check.ts
- plugin/scripts/codex-stage1-live-proof-check.ts
- plugin/scripts/config-wiring-check.ts
- plugin/scripts/coupling-graph.ts
- plugin/scripts/deliver-verify-usage.sh
- plugin/scripts/develop-work-ff.sh
- plugin/scripts/drivable-workspace-check.sh
- plugin/scripts/execution-policy.ts
- plugin/scripts/fan-in-runid-check.ts
- plugin/scripts/finding-backpropagate.ts
- plugin/scripts/gate-dispatch-coverage.ts
- plugin/scripts/gate-staleness-check.sh
- plugin/scripts/gate-staleness-check.ts
- plugin/scripts/git-lens-l-d-code-doc-ratio.ts
- plugin/scripts/git-lens-l-g-structural-drift.ts
- plugin/scripts/git-lens-l-s-behavior-variance.ts
- plugin/scripts/inner-idle-log.ts
- plugin/scripts/it0-enforcement-with-design-check.sh
- plugin/scripts/land-capacity-monitor.ts
- plugin/scripts/live-repo-literal-assert-check.ts
- plugin/scripts/load-sensitive-release-check.ts
- plugin/scripts/loadbearing-test-gate.sh
- plugin/scripts/loadbearing-test-gate.ts
- plugin/scripts/manager-liveness-independent-check.ts
- plugin/scripts/md-deletion-token-evaporation-check.sh
- plugin/scripts/measure-suite.mjs
- plugin/scripts/mechanism-vitality-check.ts
- plugin/scripts/needs-human-recheck.ts
- plugin/scripts/observer-registry-check.sh
- plugin/scripts/os-anchor-watchdog.sh
- plugin/scripts/overhead-instrument.sh
- plugin/scripts/pipe-exit-code-check.sh
- plugin/scripts/preparation-feedback.ts
- plugin/scripts/prepare-admission-check.ts
- plugin/scripts/productization-verification-record-check.ts
- plugin/scripts/productization-verification-record.ts
- plugin/scripts/proposal-convergence.ts
- plugin/scripts/quay-branch.ts
- plugin/scripts/quay-check.ts
- plugin/scripts/quay-dispatch.ts
- plugin/scripts/quay-suite.ts
- plugin/scripts/red-window-triage.ts
- plugin/scripts/refresh-worktree-quay.sh
- plugin/scripts/release-freshness-check.sh
- plugin/scripts/run-namespace-sweep-kill.mjs
- plugin/scripts/send-to-session.ts
- plugin/scripts/serial-fanin-absorb.ts
- plugin/scripts/session-retirement-check.ts
- plugin/scripts/stale-ready-audit.ts
- plugin/scripts/state-worded-clause-check.ts
- plugin/scripts/suite-cutoff-verdict.mjs
- plugin/scripts/suite-slot-lib.sh
- plugin/scripts/supervisor-bus.sh
- plugin/scripts/supervisor-health.sh
- plugin/scripts/supervisor-observe.sh
- plugin/scripts/supervisor-preempt-candidates.ts
- plugin/scripts/task-schema-check.sh
- plugin/scripts/test-file-baseline.ts
- plugin/scripts/test-framework-policy-check.ts
- plugin/scripts/test-isolation-check.ts
- plugin/scripts/threshold-scope-check.ts
- plugin/scripts/tmp-leak-pairing-check.ts
- plugin/scripts/tmux-isolated.sh
- plugin/scripts/tmux-session.ts
- plugin/scripts/tmux-test-isolation-check.ts
- plugin/scripts/trend-check.ts
- plugin/scripts/vmeta-lag-check.sh
- plugin/scripts/vmeta-lag-check.ts
- plugin/scripts/workflow-baseline-metrics.ts
- plugin/scripts/workflow-invariant-ownership.mjs
- plugin/scripts/workflow-metadata-conformance.mjs
- plugin/scripts/workflow-replay.ts
- plugin/test/axis-generator.test.mjs
- plugin/test/build-evidence-manifest.test.mjs
- plugin/test/checker-cost.test.mjs
- plugin/test/checker-driver-result-ratchet-check.test.mjs
- plugin/test/develop-work-ff.test.mjs
- plugin/test/execution-policy.test.mjs
- plugin/test/fan-in-runid-check.test.mjs
- plugin/test/finding-backpropagate.test.mjs
- plugin/test/gate-dispatch-coverage.test.mjs
- plugin/test/gate-staleness-check.test.mjs
- plugin/test/inner-idle-log.test.mjs
- plugin/test/land-capacity-monitor.test.mjs
- plugin/test/live-repo-literal-assert-check.test.mjs
- plugin/test/load-sensitive-release-check.test.mjs
- plugin/test/manager-liveness-independent-check.test.mjs
- plugin/test/md-deletion-token-evaporation-check.test.mjs
- plugin/test/measure-suite.test.mjs
- plugin/test/mechanism-vitality-check.test.mjs
- plugin/test/needs-human-recheck.test.mjs
- plugin/test/os-anchor-watchdog.test.mjs
- plugin/test/pipe-exit-code-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs
- plugin/test/productization-verification-record-check.test.mjs
- plugin/test/red-window-triage.test.mjs
- plugin/test/refresh-worktree-quay.test.mjs
- plugin/test/release-freshness-check.test.mjs
- plugin/test/session-retirement-check.test.mjs
- plugin/test/stale-ready-audit.test.mjs
- plugin/test/state-worded-clause-check.test.mjs
- plugin/test/suite-cutoff-verdict.test.mjs
- plugin/test/supervisor-bus.test.mjs
- plugin/test/supervisor-health.test.mjs
- plugin/test/supervisor-observe.test.mjs
- plugin/test/supervisor-preempt-candidates.test.mjs
- plugin/test/test-framework-policy-check.test.mjs
- plugin/test/test-isolation-check.test.mjs
- plugin/test/threshold-scope-check.test.mjs
- plugin/test/tmp-leak-pairing-check.test.mjs
- plugin/test/tmux-isolated.test.mjs
- plugin/test/tmux-session.test.mjs
- plugin/test/tmux-test-isolation-check.test.mjs
- plugin/test/trend-check.test.mjs
- plugin/test/workflow-baseline-metrics.test.mjs
- plugin/test/workflow-invariant-ownership.test.mjs
- plugin/test/workflow-metadata-conformance.test.mjs
- plugin/test/workflow-replay.test.mjs
- tasks/gap-ac158-execute-archive-batch-one.md
