---
id: gap-ac158-execute-archive-batch-one
title: AC158 判据仍红——执行批次一：扫描后死集 git mv 进 archive + INDEX 同一提交（名单执行中迭代收敛）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-158
depends_on: []
---
## Proposal

**问题**：`goals/AC-158-execute-archive-batch-one.md`（status=active、goal=GOAL-003）判据现为 fail —— `archive/INDEX.tsv` 只有表头一行、0 条数据行；扫描后死集一个都没 `git mv` 进 archive。

**工作（SPEC §12 的落地动作，非机制改动）**：把 §12e/§12f 重算出的扫描后死集 `git mv` 进 `archive/2026-09-07-zero-call-scripts/plugin/scripts/`，自带测试同批移到 `archive/2026-09-07-zero-call-scripts/plugin/test/`，并按 §12b 纪律把 `git mv` 与 `archive/INDEX.tsv` 七字段行写进**同一个提交**（硬规则 7）。

**名单在执行中迭代收敛（人 2026-09-08 裁定）**：不再等一个「事先算准」的名单，也不为此另建机制或另立任务。做法就是**移完跑 suite，红的移回，迭代至绿**——这本身就是移除证明，由本任务内联完成。**可以接受漏几个文件**：漏移只是少归档几个，不影响正确性；错移会被 suite 当场抓住并移回。最终 N = 实际移动数，SPEC 机读行同步为 N，不预设 N 等于某个历史数字（82 / 31 都不再是目标值）。

**已知为活、直接从候选集排除（实测证据，省掉逐个迭代的轮次）**：
- `overhead-instrument.sh`（`scripts/test.sh:951` source）、`run-namespace-sweep-kill.mjs`（`:1126/:1280/:1646` node）、`state-worded-clause-check.ts`（`:313` run_checker + `checker-mutation-cases/` fixture）、`refresh-worktree-quay.sh`（`:209` bash）、`send-to-session.ts`（`driver-runtime.ts:449` path.join+spawn）、`tmux-session.ts`（`plugin/test/helpers/hermetic-tmux.mjs:21` 真 import，6+ 活测试经此）、`tmux-test-isolation-check.ts`（`checker-mutation-cases/` fixture）
- `suite-slot-lib.sh`（`scripts/test.sh:465` source，bash 侧 suite 槽单一定义点）
- DIR-070 在 `plugin/test/plugin-packaging.test.mjs` 里钉存在性的十名：`anti-gaming-guard.{ts,sh}` / `loadbearing-test-gate.{ts,sh}` / `drivable-workspace-check.sh` / `audit-independence-check.{ts,sh}` / `vmeta-lag-check.{ts,sh}` / `it0-enforcement-with-design-check.sh`
- `.quay/config.yml` 注册为 gate 的 `build-evidence-gate.ts`

这些只是**已知**的活脚本，不是穷举——剩下的靠步骤 5 的 suite 迭代兜住。

## Plan

1. **候选集** = 现有 `## Touches` 里声明的 `plugin/scripts/*` **减去** 上面已知为活的名单。⛔ 不重跑扫描器、不重算 JSON、不改判定机制——这些都不在本任务范围。
2. **批次目录固定** `archive/2026-09-07-zero-call-scripts/`，**不随执行日改**（Touches 就指着它；原 Plan「slug 用执行日、但 Touches 保持指向该目录」自相矛盾，此处取消）。
3. `git mv plugin/scripts/<name> archive/2026-09-07-zero-call-scripts/plugin/scripts/<name>`；有自带测试的，同批 `git mv plugin/test/<stem>.test.mjs archive/2026-09-07-zero-call-scripts/plugin/test/`。
4. 摘掉 `plugin/scripts/capability-catalog.sh` 里被移脚本的六表条目，跑 `node --no-warnings --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --reanchor --root <worktree>`。
5. **迭代收敛**：跑 `scripts/test.sh`。红 ⇒ 从失败输出定位到是哪个脚本被移走导致的，`git mv` 移回、从候选集摘出、重跑。**重复直到绿**。漏移可接受，不必为了凑数把可疑的硬留在候选集里。
6. 写 `archive/INDEX.tsv`（每行七字段 `original_path · archive_path · date · reason_code · evidence · restore_cmd · commit`，reason_code=`zero-call`，restore_cmd=`git mv <archive_path> <original_path>`），与全部 `git mv` 在**同一个提交**。
7. 同步 `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §12e 机读行 `- 扫描后死集: N`（N = 实际移动数）。

## AC

- [ ] AC1 AC-158 判据 exit 0：逐字取自 `goals/AC-158-execute-archive-batch-one.md` criterion 的 python3 heredoc —— `archive/INDEX.tsv` 有数据行 ∧ 每条 original_path 已不存在、archive_path 存在 ∧ 行数 == SPEC 的 `- 扫描后死集: N`
- [ ] AC2 三处同数（打印三个数，不只打印通过）：`tail -n +2 archive/INDEX.tsv | wc -l` == SPEC 机读行的 N == 本批次实际 `git mv` 的脚本数（`git log -1 --name-only` 里 `archive/.../plugin/scripts/` 下的新增数）
- [ ] AC3 同一提交：`git log -1 --name-only` 该批次提交同时含被移文件与 `archive/INDEX.tsv`，无「文件已移、INDEX 未写」的中间提交
- [ ] AC4 自带测试同批、无孤儿：被移脚本若有 `plugin/test/<stem>.test.mjs` 则同批移走；`plugin/test/` 中不存在其 `plugin/scripts/` 对应体已被移走的测试文件
- [ ] AC5 全量 suite 绿：`scripts/test.sh` exit 0 —— **这就是移除证明**：绿即证明被移走的都不是活脚本，红即说明还有活的被移走，按 Plan 步骤 5 移回后重跑
- [ ] AC6 `node plugin/scripts/task-schema-check.ts tasks/gap-ac158-execute-archive-batch-one.md` exit 0

## DoD

`archive/INDEX.tsv` 有 N 条数据行（N = 实际移动数，**允许小于候选集**——漏移可接受，不是未达成），每条 original_path 在 `plugin/scripts/` 已不存在、archive_path 在 `archive/2026-09-07-zero-call-scripts/` 下存在；`git mv` 与 INDEX 写入同一提交；`scripts/test.sh` exit 0；SPEC `- 扫描后死集: N` 与 INDEX 行数同数；AC-158 判据在 goal-driver 下一轮由 fail 转 pass（读 `.quay/goal-round.jsonl` 中 AC-158 的 verdict）。

⛔ 只移文件不写 INDEX、或 move 与 INDEX 分两次提交、或留下孤儿测试、或 suite 红就交 ⇒ 不算达成。⛔ N 不必等于 82 或 31——拿实际移动数当 N，不要为了凑历史数字而把 suite 弄红。

## Touches

- archive/INDEX.tsv
- archive/2026-09-07-zero-call-scripts/plugin/scripts/*
- archive/2026-09-07-zero-call-scripts/plugin/test/*
- plugin/scripts/capability-catalog.sh
- docs/analysis/quay-init-closure-ratchet.baseline.json
- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
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
