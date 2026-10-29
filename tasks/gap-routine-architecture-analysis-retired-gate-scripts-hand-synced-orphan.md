---
id: gap-routine-architecture-analysis-retired-gate-scripts-hand-synced-orphan
title: "architecture-analysis: plugin/README.md:77-84 declares
  plugin/gate-scripts RETIRED and 'no longer synced by sync.sh', yet both files
  are md5-identical to the live experiments copie"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
plugin/README.md:77-84 declares plugin/gate-scripts RETIRED and 'no longer synced by sync.sh', yet both files are md5-identical to the live experiments copies (12c73e9c…, 1651758…) and commit 21f292911 added 124 lines to BOTH by hand; the only drift checker (workflows-dual-copy-drift-check) was archived 2026-09-07 and sync-vendor.sh has zero gate-scripts references, so a one-sided edit can no longer be caught.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793162787359` · ts `2026-10-28T04:46:27.359Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`main`、`dueDirectives`、`parseDisposition`、`classifyDirective`、`checkBodyIntegrity`、`countRealNewlines`
- 涉及文件：
- `plugin/gate-scripts/drain-scheduler.ts:1`
- `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts:1`
- `plugin/gate-scripts/drain-dispose-corruption-check.ts:1`
- `experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts:1`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Delete plugin/gate-scripts/ (retired and undistributed) or, if retention is required, add it to a sync script and ship a live byte-identity check across all four copies.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-28T04:46:27.359Z

## Disposition（复核 + 处置，2026-10-28）

**复核（每条都在盘上实测，不是复述 finding）：**
- 两个被点名的文件与 live 副本 md5 相同：`cmp` 对 `plugin/gate-scripts/{drain-scheduler.ts,drain-dispose-corruption-check.ts}` vs `experiments/quay-perpetual-stream/scripts/` 同名文件 exit 0（12c73e9c… / 1651758…）。
- **不是两个文件，是整个目录**：14 个文件里 13 个在 experiments 侧有同名对应物；当时字节相同的是 **6** 个（除上面两个 .ts，还有 `it0-ceiling-check.sh`、`it0-ceiling-line-budget-check.sh`、`it0-dashboard-line-budget-check.sh`、`it0-gate-hash-check.sh`），另外 7 个是 2026-08-11 之后 live 副本继续演化留下的「冻结旧副本」，`it0-backlog-projection-check.sh` 无对应物。⇒ 这个目录是 live 代码的一份**无守护影子副本**，不是 README 所称的「历史工件」。
- 运行时零引用：`quay-init.sh` / `sync.sh` 对该目录零引用（retirement test 早已钉死），`git grep 'plugin/gate-scripts/'` 无命令位置引用；shipped artifact 早在 2026-10-07 就把其中 12 个 .sh 判为 no-executing-reference 并排除（`plugin/shipped-set-baseline.json`）。
- `21f292911` 确实是「同 124 行手工加到两侧」的那次提交（提交信息自称 byte-identical plugin/gate-scripts/ mirror）。

**处置：取 finding 的第一条（删除退役目录），但按本仓 `archive/` 约定归档而不是 `rm`。**
`git mv plugin/gate-scripts → archive/2026-10-28-retired-gate-scripts-orphan/plugin/gate-scripts`，14 行走廊写进 `archive/INDEX.tsv`（含 `restore_cmd`）。于是 live 树里每个脚本只剩**一份**，两副本漂移在结构上不再可能存在。
- ⛔ 不选第二条（加进 sync + 字节一致检查）：对这个目录它是**错的不变量**——7/13 的 live 副本已经演化，强制字节一致等于让「退役工件」跟着每次 live 代码改动一起动，把一个想要消失的负担变成常驻税。
- 不 `rm` 只归档：archive/ 被 architecture-analysis 例行当作 non-actionable 排除（不会以 archive 副本身份让同一 duplication 复活），同时保留可恢复性与可审计性（INDEX 的 restore_cmd + `commit` 列）。

**同步更新的消费者**（目录消失后它们必然红，逐个改到绿）：`plugin/README.md`；
`plugin/scripts/verify-delivery-surface.ts` 的 `DELIVERY_INVENTORY` + 其测试（8→7 目录）；
`plugin/scripts/release-freshness-check.sh` 的 `DELIVERY_DIRS` + 其镜像自检测试；
`packages/quay/scripts/package.sh` 与 `plugin/scripts/publish-dist-branch.sh` 的 strip-step `find` 路径；
`packages/quay/test/npm-pack-e2e.test.mjs` 的必需子目录表；`plugin/test/shipped-shell-reachability.test.mjs`
的 unreachable 断言；以及两个 retirement 测试——由「文件留在树里」翻成「目录必须不在 ∧ 文件在 archive ∧
INDEX 有 14 行」，并把反向控制写进去（同名副本一旦放回 `plugin/gate-scripts/` 即红）。

**判据可跑（实跑读数）：**
- `node --test plugin/test/gate-scripts-retirement.test.mjs` → 5/5 pass（`AC2 (archival)` 断言目录不存在、14 文件在 archive、INDEX 14 行）。
- `plugin/test/plugin-packaging.test.mjs` 36/37（唯一红是 M136 `sync-vendor.sh --check`：worktree 的 `packages/quay/dist` 未构建，`scripts/test.sh` 会先 build，与本改动无关，主检出上该检查 exit 0）；`plugin/test/verify-delivery-surface.test.mjs` + `release-freshness-check.test.mjs` + `publish-dist-branch-closure-gate.test.mjs` 46/46；`plugin/test/shipped-shell-reachability.test.mjs` 8/8（真产物装配）；`shipped-set` + `shipped-entry-runnable` 13/13；`packages/quay/test/npm-pack-e2e.test.mjs` 11/11；`packages/quay/test/build-plugin-dist.test.mjs` 45/45。
- 反向控制（能取假）：把任一归档文件复制回 `plugin/gate-scripts/` ⇒ `AC2 (archival)` 红。

ADR-007 暗轴记录：
- L_G archguard: cycles=0（scan-round 2026-10-28T04:46:27Z，6 scopes，runId architecture-analysis-1793162787359；本改动只移出一个零执行引用的退役目录，不新增/删除任何 TS 模块依赖边 ⇒ 该读数不受影响）

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `retired-gate-scripts-hand-synced-orphan`（routine `architecture-analysis`，runId `architecture-analysis-1793162787359`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/gate-scripts/*`
- `archive/2026-10-28-retired-gate-scripts-orphan/plugin/gate-scripts/*`
- `archive/INDEX.tsv`
- `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts`
- `experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts`
- `packages/quay/scripts/package.sh`
- `packages/quay/test/npm-pack-e2e.test.mjs`
- `plugin/README.md`
- `plugin/sh-census-baseline.json`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/scripts/publish-dist-branch.sh`
- `plugin/scripts/release-freshness-check.sh`
- `plugin/scripts/verify-delivery-surface.ts`
- `plugin/test/gate-scripts-retirement.test.mjs`
- `plugin/test/plugin-packaging.test.mjs`
- `plugin/test/release-freshness-check.test.mjs`
- `plugin/test/shipped-shell-reachability.test.mjs`
- `plugin/test/verify-delivery-surface.test.mjs`
- `tasks/gap-routine-architecture-analysis-retired-gate-scripts-hand-synced-orphan.md`

## Needs-Human

**执行 2026-10-28T06:22:03.329Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：LOOP DEADLOCK: task gap-routine-architecture-analysis-retired-gate-scripts-hand-synced-orphan has been blocked by the SAME pre-existing red set for 3 consecutive fan-in rounds (signature unchanged across rounds). Blocked red points: plugin/test/sh-census-check.test.mjs. No other task in the carrier shares this signature yet — if more arrive, they are mutually landing gates. Suggested resolution: land ANY ONE of them first (each one's own fix is outside the blocked set, so the red set does not grow); the others' blocked sets then shrink by that red point and they land in turn. If a landing still makes it worse, a human must decide the order. ⛔ The gates were NOT relaxed: every new/changed red point still hard-fails this task (baseline-equivalence exemption never covers a red the task introduced). — 停止自动重派（电路断路器：同一既存红签名连续 3 轮未变）。⛔ 判据未放宽：本次新增 / 断言文本变化的红点仍然硬红（既存红等价豁免只覆盖「不变差」的方向）。
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal: [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/sh-census-check.test.mjs changed=-]
- run_id：wk-prod-anchor
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-routine-architecture-analysis-retired-gate-scripts-hand-synced-orphan~wk-prod-anchor~1793164830932-9e4662.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-routine-architecture-analysis-retired-gate-scripts-hand-synced-orphan-wk-prod-anchor.log

## 后续处置（2026-10-29，人工复位 ready）

**红点定性**：`plugin/test/sh-census-check.test.mjs` 的 AC6 是**本任务自己引入**的红，不是既存红。本任务把 `plugin/gate-scripts/`（14 个文件）移入 `archive/2026-10-28-retired-gate-scripts-orphan/`，而普查的声明范围排除顶层 `archive/`（`sh-census-check.ts` 的 `ARCHIVE_PREFIX`，与 AC2 的独立 `grep -v '^archive/'` 同集合），12 个 `.sh` 因此离开普查人口（146 → 134），其中 4 个在 embedded-interpreter 棘轮轴上各计 11 行 ⇒ 实测读数 6504 → 6460。AC6 要求基线**等于**实测值（不是上界），而基线仍停在 6504 ⇒ 只要任务分支在，该测试恒红。⇒ 这不是「等别人先落地」的互锁死锁，是本任务自己欠的一次 re-anchor；电路断路器的通用建议在此不适用。

**已做的修复（任务分支，提交 063d28e81）**：`plugin/sh-census-baseline.json` 的 `embeddedInterpreterLines` 6504 → 6460，并在 `_reanchorLog` 追加一条带逐文件归属的记录——`plugin/gate-scripts/audit-independence-check.sh`、`it0-backlog-projection-check.sh`、`it0-dod-check.sh`、`vmeta-lag-check.sh` 各 11 行（11×4 = 44，全部是 embedded:[node]）；其余 8 个被移动的 `.sh` 的 embedded 为空，只影响 `totals.scripts` / `totals.codeLines`（报告项，不进棘轮）。方向是**下调**，属基线本来就允许的方向；`duplicateCopies` 保持 0（该轴只数 `experiments/**/scripts` ↔ `plugin/scripts`，`plugin/gate-scripts/` 从不在其人口里）。所有数值取自检查器自己的读数，未手填。

**验证读数（本轮实跑）**：`node --test plugin/test/sh-census-check.test.mjs` → 22/22 pass；`anti-drift-touches-check --task <本任务> --worktree <本任务 worktree> --merge-target develop` → OK（28 个实际改动文件全部落在 19 条 Touches 内）；`gate-scripts-retirement` 5/5、`verify-delivery-surface` 22/22、`release-freshness-check` 21/21。worktree 已 merge develop（behind=0，ahead=9）。

**下一步**：复位后由 driver 重派 ⇒ 机械 fan-in（merge develop → delta → typecheck → scoped → 全量 suite → ff develop）。上一轮全量 suite 的唯一红点就是本条，预期绿；若出现**新**红点，签名变化会把电路断路器的连续计数归 1，不会被旧死锁记录卡住。
