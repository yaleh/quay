---
id: gap-ac158-execute-archive-batch-one
title: AC158 执行批次一：零调用死集 git mv 进 archive + INDEX 同一提交（条数不设闸，人 2026-09-08 裁定）
status: done
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  deliveryCriticalSource: adhoc
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
7. **SPEC §12e 的「扫描后死集: N」行不再是判据**——它是**死集种群规模**，与**本批次归档件数**是两个量，把二者等同正是原判据不可满足的根因（人 2026-09-08 裁定简化）。⛔ 不得再用它与 INDEX 行数做等式。已落在任务分支上的写入（当前写成 `53` = INDEX 总行数，语义是错的）可以保留、也可以改回种群语义，**两者都不影响达成**；该文件仍留在 Touches 里，只是为了让已有改动通过 anti-drift。

## AC

- [x] AC1 AC-158 判据 exit 0：逐字取自 `goals/AC-158-execute-archive-batch-one.md` 的 criterion —— `archive/INDEX.tsv` 中至少 1 条 `reason_code=zero-call` ∧ `original_path` 在 `plugin/scripts/` 下的行；每条这样的行 original_path 已不存在、archive_path 存在、evidence/restore_cmd/commit 三字段非空
- [x] AC2 打印本批次归档条数（不比对任何数字）：`awk -F'\t' 'NR>1 && $4=="zero-call" && $1 ~ /^plugin\/scripts\//' archive/INDEX.tsv | wc -l` 输出 N ≥ 1，并把 N 与前 3 条 original_path 打印进任务记录。⛔ 不与 SPEC 的死集数、82、31 或任何历史数字比对——人 2026-09-08 裁定条数不是闸
- [x] AC3 同一提交：`git log -1 --name-only` 该批次提交同时含被移文件与 `archive/INDEX.tsv`，无「文件已移、INDEX 未写」的中间提交
- [x] AC4 自带测试同批、无孤儿：被移脚本若有 `plugin/test/<stem>.test.mjs` 则同批移走；`plugin/test/` 中不存在其 `plugin/scripts/` 对应体已被移走的测试文件
- [x] AC5 全量 suite 绿：`scripts/test.sh` exit 0 —— **这就是移除证明**：绿即证明被移走的都不是活脚本，红即说明还有活的被移走，按 Plan 步骤 5 移回后重跑
- [x] AC6 `node plugin/scripts/task-schema-check.ts tasks/gap-ac158-execute-archive-batch-one.md` exit 0

## DoD

`archive/INDEX.tsv` 至少 1 条 `reason_code=zero-call` ∧ `original_path` 在 `plugin/scripts/` 下的数据行；每条这样的行 original_path 在 `plugin/scripts/` 已不存在、archive_path 在 `archive/` 下存在、evidence/restore_cmd/commit 三字段非空；`git mv` 与 INDEX 写入同一提交；无孤儿测试；`scripts/test.sh` exit 0；AC-158 判据在 goal-driver 下一轮由 fail 转 pass（读 `.quay/goal-round.jsonl` 中 AC-158 的 verdict）。

**⛔ 条数不是达成条件**（人 2026-09-08 裁定「多处理几个文件少处理几个文件不应阻碍 goal 落地」）：移 5 个和移 80 个同样算达成。可疑的一律留在原地、不要为了凑数把 suite 弄红。⛔ 只移文件不写 INDEX、move 与 INDEX 分两次提交、留下孤儿测试、或 suite 红就交 ⇒ 不算达成。

## Touches

- archive/INDEX.tsv
- .quay/suite-bucket-reattribution.jsonl
- archive/2026-09-07-zero-call-scripts/plugin/scripts/*
- archive/2026-09-07-zero-call-scripts/plugin/test/*
- plugin/scripts/capability-catalog.sh
- docs/analysis/quay-init-closure-ratchet.baseline.json
- docs/analysis/test-file-baseline.txt
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
- plugin/test/suite-bucket-attribution.test.mjs

## 派发顺序（manager 2026-09-08；depends_on 已撤，理由如下）

**曾加过 `depends_on: gap-plugin-root-resolution-remaining-callsites`，2026-09-08 又撤掉。撤的理由是两条实测，不是改主意**：

1. **我当时给的理由没有成立**。加它是因为担心「归档方把编辑方正在改的文件移走」——具体指 `plugin/scripts/os-anchor-watchdog.sh`（本任务列为归档候选，而那个任务的 AC3 正在迁移它）。**实测该批次并没有归档它**（任务分支 `9547d48eb` 的 24 个脚本里没有 os-anchor-watchdog.sh，`grep` INDEX 得 0）⇒ 撞车没有发生。
2. **本任务的实现已经做完，只差一次 fan-in**（见下方「实现状态」段：新判据对其 worktree 实测 exit 0）。**让一个「一次 fan-in 就能永久离场」的任务，去等一个「还没解决」的任务，反而延长了它占锁的总时间。**落地即永久释放锁，对 AC-168 更有利。

**⊢ AC-168 的优先由标签承担，不由本任务的阻塞承担**：`gap-plugin-root-resolution-remaining-callsites` 与 `gap-quay-init-closure-shrink-body` 均已打 `delivery-critical`（`extra.deliveryCriticalSource: adhoc`，DIR-130 授权），而 `orchestration/dispatch-preference.md` 覆盖段的谓词——「候选中凡 `labels` 含 `delivery-critical` 者一律优先」——正是 worker-driver 缺省 selector prompt 逐字要求它读的那一段。⇒ **优先级有活的机制承载，不需要用 depends_on 去饿死本任务。**

**⚠️ 仍然成立的约束（与 depends_on 无关）**：本任务与 `gap-plugin-root-resolution-remaining-callsites` 的 Touches 实测重叠 3 个文件（`docs/analysis/quay-init-closure-ratchet.baseline.json`、`plugin/scripts/os-anchor-watchdog.sh`、`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md`）⇒ **两者不会并发派发**（派发过滤器按 Touches 串行化），只是先后由 selector 定。**后落地的那个必须在【合并后的树上】重跑 `quay-init-closure-ratchet.ts --reanchor`，⛔ 不要手工并 JSON。**

**⊢ 归档候选集的连带纪律（保留）**：若某文件正被另一个未落地任务修改，它就**不是**零调用死物 ⇒ 从候选集摘掉，不要移。`os-anchor-watchdog.sh` 与 `plugin/test/os-anchor-watchdog.test.mjs` 属此类。少归档一个不影响达成（条数不是闸）。

## 实现状态：已完成但搁浅在任务分支（manager 2026-09-08 核实）

⛔ **下一个 worker 不要从零重做**——工作已经做完，只是没落地。

- 分支 `task/gap-ac158-execute-archive-batch-one` 提交 `9547d48eb`：**24 个死脚本 + 15 个自带测试**已 `git mv` 进 `archive/2026-09-07-zero-call-scripts/`，`archive/INDEX.tsv` 增 24 条 `reason_code=zero-call` 行（七字段齐全），与 move 同一提交。
- **新判据对该 worktree 实测 exit 0** —— 即 AC-158 的达成条件在这份搁浅实现上已经成立。
- **搁浅原因不是 suite 红，是 `anti-drift` HARD FAIL 1 条**：`docs/analysis/test-file-baseline.txt` 当时不在 Touches 里（移/删测试文件会改这个基线）。该行**已于 10:53 补进 Touches**，但 **worktree 里的任务文件是旧快照**（当时落后 develop 12 提交），而 anti-drift 读的是 **worktree 那一份** ⇒ 补了也没被看见。
- ⇒ **下一轮该做的**：在 worktree 里 `git merge --no-edit develop`（把补好的 Touches 拉进来）→ 重跑 anti-drift → 走完 scoped 门 + 全量 suite → ff。**不要重新 git mv、不要重算名单。**
- 逐条核对 AC1–AC6 是否已由 `9547d48eb` 满足，满足就勾（AC 复选框在 Edit 时被换成新文本，故当前全部未勾——那是判据文本变更导致的重置，不是实现退回）。

**优先级（manager 2026-09-08，人在场询问后打标）**：GOAL-003 现 13/14，本任务是最后一条。人问「现在在飞只有 4，可以派发 AC-158 吗？可以单任务派发它吗？」——容量与池子都允许，但手动 `worker-driver.ts --task` 与常驻 driver 并发存在真实碰撞风险（两者对已存在的 `task/gap-ac158-execute-archive-batch-one` worktree 都会生成 CONTINUE-复用 prompt，且两条路径间无跨进程去重锁）。改用打标——只改常驻 driver 自己读的偏好文件（`dispatch-preference.md` 覆盖段），无并发冲突可能，且已被 AC-168 链验证有效。`delivery-critical`（`extra.deliveryCriticalSource: adhoc`，DIR-130 授权）。