---
id: gap-ac158-execute-archive-batch-one
title: AC158 执行批次一：零调用死集 git mv 进 archive + INDEX 同一提交（条数不设闸，人 2026-09-08 裁定）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-158
depends_on:
  - gap-plugin-root-resolution-remaining-callsites
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
7. ⛔ **不再改 SPEC §12e 的「扫描后死集: N」行**——那行是**死集种群规模**，与**本批次归档件数**是两个不同的量；把它们等同起来正是原判据不可满足的根因（人 2026-09-08 裁定简化）。本任务不碰 SPEC。

## AC

- [ ] AC1 AC-158 判据 exit 0：逐字取自 `goals/AC-158-execute-archive-batch-one.md` 的 criterion —— `archive/INDEX.tsv` 中至少 1 条 `reason_code=zero-call` ∧ `original_path` 在 `plugin/scripts/` 下的行；每条这样的行 original_path 已不存在、archive_path 存在、evidence/restore_cmd/commit 三字段非空
- [ ] AC2 打印本批次归档条数（不比对任何数字）：`awk -F'\t' 'NR>1 && $4=="zero-call" && $1 ~ /^plugin\/scripts\//' archive/INDEX.tsv | wc -l` 输出 N ≥ 1，并把 N 与前 3 条 original_path 打印进任务记录。⛔ 不与 SPEC 的死集数、82、31 或任何历史数字比对——人 2026-09-08 裁定条数不是闸
- [ ] AC3 同一提交：`git log -1 --name-only` 该批次提交同时含被移文件与 `archive/INDEX.tsv`，无「文件已移、INDEX 未写」的中间提交
- [ ] AC4 自带测试同批、无孤儿：被移脚本若有 `plugin/test/<stem>.test.mjs` 则同批移走；`plugin/test/` 中不存在其 `plugin/scripts/` 对应体已被移走的测试文件
- [ ] AC5 全量 suite 绿：`scripts/test.sh` exit 0 —— **这就是移除证明**：绿即证明被移走的都不是活脚本，红即说明还有活的被移走，按 Plan 步骤 5 移回后重跑
- [ ] AC6 `node plugin/scripts/task-schema-check.ts tasks/gap-ac158-execute-archive-batch-one.md` exit 0

## DoD

`archive/INDEX.tsv` 至少 1 条 `reason_code=zero-call` ∧ `original_path` 在 `plugin/scripts/` 下的数据行；每条这样的行 original_path 在 `plugin/scripts/` 已不存在、archive_path 在 `archive/` 下存在、evidence/restore_cmd/commit 三字段非空；`git mv` 与 INDEX 写入同一提交；无孤儿测试；`scripts/test.sh` exit 0；AC-158 判据在 goal-driver 下一轮由 fail 转 pass（读 `.quay/goal-round.jsonl` 中 AC-158 的 verdict）。

**⛔ 条数不是达成条件**（人 2026-09-08 裁定「多处理几个文件少处理几个文件不应阻碍 goal 落地」）：移 5 个和移 80 个同样算达成。可疑的一律留在原地、不要为了凑数把 suite 弄红。⛔ 只移文件不写 INDEX、move 与 INDEX 分两次提交、留下孤儿测试、或 suite 红就交 ⇒ 不算达成。

## Touches

- archive/INDEX.tsv
- archive/2026-09-07-zero-call-scripts/plugin/scripts/*
- archive/2026-09-07-zero-call-scripts/plugin/test/*
- plugin/scripts/capability-catalog.sh
- docs/analysis/quay-init-closure-ratchet.baseline.json
- docs/analysis/test-file-baseline.txt
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

## 派发顺序（manager 2026-09-08 钉死）

**为什么加 `depends_on`**：本任务与 `gap-plugin-root-resolution-remaining-callsites`（AC-168 的硬前置）
Touches 实测重叠 2 个文件 —— `plugin/scripts/os-anchor-watchdog.sh` 与
`docs/analysis/quay-init-closure-ratchet.baseline.json`。**重叠即串行，但顺序原本是随机的**，
而这两个任务对同一个文件的意图**相反**：

- 本任务把 `os-anchor-watchdog.sh`（及其 `plugin/test/os-anchor-watchdog.test.mjs`）列为**归档候选**；
- `gap-plugin-root-resolution-remaining-callsites` 的 **AC3 正在迁移这个文件**（已勾 `[x]`：把 `:254/:295-296`
  的 workspace-root 拼接改到 SPEC §6b 解析器）。

⇒ **归档方若先跑，就会把编辑方正在改的活文件移走**。通则：**编辑方必须先于归档方**，且顺序要用
顶层 `depends_on` 钉死，不能交给 selector 的随机顺序。

**并且这正是人 2026-09-08 裁定的落点**：「优先保障 AC-168 落地，简化 AC-158。AC-158 多处理几个文件
少处理几个文件不应阻碍 goal 落地。」实测本任务在飞时**占着锁挡住了 AC-168 的硬前置**
（worker-driver round 51 `filtered-empty — all dispatchable candidates filtered by predicates`）。
⇒ 本任务让路：等前置落地后再派。

**⊢ 连带**：前置落地后，`os-anchor-watchdog.sh` 已被证明为**活脚本**（有人在改它），
按 Plan「已知为活、直接从候选集排除」的同一条纪律，**把它和 `plugin/test/os-anchor-watchdog.test.mjs`
从归档候选集里摘掉**，不要移。少归档一个不影响达成（条数不是闸）。