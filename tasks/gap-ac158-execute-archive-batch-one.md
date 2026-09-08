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
  needs_human_reason: '负控制（Plan 步骤1）FAILED——after.dead 的 82 名混入仍在生产使用的活脚本，直接执行会打破
    scripts/test.sh 本身与全量 suite（AC5 结构上不可能绿）。① suite-slot-lib.sh（在 82 内）是 bash 侧
    suite 槽路径单一定义点，scripts/test.sh:465 每轮 source
    "${repo_root}/plugin/scripts/suite-slot-lib.sh"，并被 suite-driver.ts /
    worker-driver.ts / full-suite-runner.ts / suite-slot-ssot-check.ts /
    suite-lock-slots.ts 及 8+ 活测试（suite-slot-ssot-check.test.mjs /
    suite-driver.test.mjs / worker-driver.test.mjs / resource-gate.test.mjs
    …）直接引用；§12e 闭包只认 node|bash|sh|tsx 调用形式、漏认 bash source/.
    内建形式——正是它被误判死的根因，移走它下一次 suite 直接 source 失败。②
    plugin/test/plugin-packaging.test.mjs（@test-group product，默认 suite 必跑）钉住 10
    个脚本存在性：DIR-070-B asserts
    anti-gaming-guard.ts/sh、loadbearing-test-gate.ts/sh、drivable-workspace-check.sh，DIR-070-C
    asserts
    audit-independence-check.ts/sh、vmeta-lag-check.ts/sh、it0-enforcement-with-design-check.sh——这
    10 个全在 82 内，移走即红。③ .quay/config.yml 把 6 个死集脚本注册为 gate（anti-gaming-guard.sh /
    audit-independence-check.sh / drivable-workspace-check.sh /
    loadbearing-test-gate.sh / vmeta-lag-check.sh /
    build-evidence-gate.ts），移走留悬空 script: 路径。④ 不对称信号：drivable-workspace-check.sh
    与 it0-enforcement-with-design-check.sh 在 82、其委托的 .ts 模块不在 82——wrapper
    没了模块入口也断。归属：这是【名单面】死集重算缺陷（§12e 闭包漏认 source/. 内建 + 未把活测试钉存在性/config gate
    注册计入连带面），非本【执行】任务缺陷。建议：闭包补 source/. 识别后重算，至少摘出 suite-slot-lib.sh + DIR-070
    gate 脚本族，并先决 plugin-packaging.test.mjs / .quay/config.yml /
    capability-catalog.sh 的连带清理，再重新派发本批次。未做任何 move、worktree 干净无提交。'
goal_ac: AC-158
depends_on:
  - gap-ac166-second-copy-retirement
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
