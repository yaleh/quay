---
id: gap-workflows-dual-copy-drift-unchecked
title: .claude/workflows/ 与 plugin/workflows/ 双副本漂移未检——三文件两处存在无 drift check（manager 11:0xZ 报）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（workflows 双副本漂移未检——manager 2026-08-14 11:0xZ 报）**。

**现状（实测）**：`.claude/workflows/` 与 `plugin/workflows/` 有 **3 个文件两处存在**：
```
drain-directives.js · fan-in-execute.js · run-routines.js   （两个目录都有）
execute-suite-fix.js · manager-tick-core.js · pool-quality-judge.js · select-preflight.js（仅 .claude/，单处）
```
**无 drift check**（对比：执行核双副本有 `tick-core-drift-check`；本仓库对「同一文件两处」的默认纪律是双副本同改 + drift 检查——AC73 判据4 的执行核版）。**三文件若单边改（只改 .claude/ 或只改 plugin/），无任何机制报**——与 tick-core 双副本漂移同族，且对象是刚落地的 fan-in-execute.js（工作流协议正身）——**改了正本而落地副本不跟，A6 检查的 workflow 脚本是旧的**。

**判据1**：三个双副本文件的 drift 检查落地（.claude/ vs plugin/ 逐文件 diff，漂移 ⇒ 红）——产物复用 tick-core-drift-check 的形态，不是新增打卡。
**判据2（能取假）**：单边改其中一个副本（如只改 .claude/workflows/fan-in-execute.js）⇒ 检查必须红；双改 ⇒ 绿。真样本=现状两份逐字同（回放绿）+ 单边改（构造红，D2 或真实单边样本）。
**判据3**：与 tick-core-drift-check 一致——执行核双副本的判据4 覆盖是否延伸到 workflows 双副本（AC73 判据4 的边界）。

**不覆盖**：不规定哪些文件该双副本（是产品的落在 plugin/，实例在 .claude/ 还是反之——由现结构推定）；不改 workflow 本体。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 实测三个双副本文件的现状（diff，应逐字同）。
2. 判据1：drift check（复用 tick-core-drift-check 形态或并入）。
3. 判据2 能取假：单边改回放红 + 现状回放绿。
4. 判据3：与 AC73 判据4 的边界对齐（workflows 是否纳入双副本可见性）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：三双副本文件（drain-directives / fan-in-execute / run-routines）的 drift 检查落地（漂移 ⇒ 红）。
- [ ] AC2 判据2 能取假：单边改回放红；现状（逐字同）回放绿。
- [ ] AC3 判据3：与执行核双副本（AC73 判据4）边界对齐说明。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] workflows 三双副本文件 drift 检查落地 + 能取假 + 与 AC73 判据4 对齐。

## Touches

- plugin/scripts/workflows-dual-copy-drift-check.ts (new)
- plugin/test/workflows-dual-copy-drift-check.test.mjs (new)
- plugin/scripts/checker-mutation-cases/workflows-dual-copy-drift-check.sh (new)
- plugin/scripts/capability-catalog.sh（新脚本声明）
- scripts/test.sh（接入 run_static_checks）
- plugin/workflows/fan-in-execute.js（落地副本对账——现存漂移的修复方向，AC2 现状回放绿所需）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照随新脚本再生成）
- tasks/gap-workflows-dual-copy-drift-unchecked.md（自身）

## Test-Files

- plugin/test/workflows-dual-copy-drift-check.test.mjs

## Evidence

**判据1/AC1（drift 检查落地，漂移 ⇒ 红）**：新增 `plugin/scripts/workflows-dual-copy-drift-check.ts`（.claude/workflows/ vs plugin/workflows/ 逐文件 byte-diff，三对 pinned 文件：drain-directives / fan-in-execute / run-routines；任一文件缺失或两份不同 ⇒ exit 1；复用 tick-core-static-check --check-drift 的形态——两侧行数 + diff 摘要，非布尔）。已接进 `scripts/test.sh` run_static_checks（code-class 每轮 gate，`@static-tier change` + `@static-object .claude/workflows/* plugin/workflows/* plugin/scripts/workflows-dual-copy-drift-check.ts plugin/test/workflows-dual-copy-drift-check.test.mjs`），checker-mutation-check manifest 自动收录并已覆盖：

```
checker_mutation_check: workflows-dual-copy-drift-check  yes  run_static_checks
```

**现存漂移（对账，AC2 现状回放绿所需）**：判据2 的「真样本=现状逐字同」前提不成立——落地前实测 `fan-in-execute.js` 两处**已漂移**（163 vs 124 行）：`5e54bb37`（meta fix）与 `3159cf32`（三条承重点）只改了 `.claude/workflows/`（本工作区实际执行的副本），`plugin/workflows/`（quay-init --workflows 铺到安装目标的副本）未跟随——**正是本任务要抓的漂移类，且已经发生过一次**。落地前检查对该漂移报红：

```
workflows-dual-copy-drift-check: drift check — 3 pairs, 2 consistent / 1 drifted
  DRIFT: .claude/workflows/fan-in-execute.js (163 lines) vs plugin/workflows/fan-in-execute.js (124 lines)
workflows-dual-copy-drift-check: RED — workflows dual-copy drift gate violated
```

修复方向 = 把 `.claude/workflows/fan-in-execute.js`（含承重点的已修复副本）同步到 `plugin/workflows/fan-in-execute.js`（落地副本），两者重新逐字同（163 == 163）。对账后检查 PASS：

```
workflows-dual-copy-drift-check: drift check — 3 pairs, 3 consistent / 0 drifted
  ok: .claude/workflows/drain-directives.js (185 lines) == plugin/workflows/drain-directives.js (185 lines)
  ok: .claude/workflows/fan-in-execute.js (163 lines) == plugin/workflows/fan-in-execute.js (163 lines)
  ok: .claude/workflows/run-routines.js (52 lines) == plugin/workflows/run-routines.js (52 lines)
workflows-dual-copy-drift-check: PASS — every dual-copy workflow matches its other copy.
```

**判据2/AC2（能取假）**：单测 5 条全绿（`plugin/test/workflows-dual-copy-drift-check.test.mjs`）——byte-identical fixture 基线 GREEN、单边改（只改 .claude/ 一份）RED、一侧文件缺失 RED（硬规则 3a 枚举）、`--no-block` 只报不阻（判据3 对齐面）、live repo 对账后 GREEN：

```
✔ AC1/判据1: a byte-identical fixture baseline is GREEN (exit 0)
✔ AC2/判据2 能取假: a one-sided edit of ONE copy goes RED (exit 1)
✔ AC2/硬规则 3a: a file MISSING from one side is a drift state ⇒ RED (exit 1)
✔ AC3/判据3: --no-block is report-only — a drifted pair prints RED but exits 0
✔ AC2 现状回放绿: the live repo's three real dual-copy pairs are byte-identical ⇒ GREEN
ℹ tests 5 · pass 5 · fail 0
```

mutation case（`plugin/scripts/checker-mutation-cases/workflows-dual-copy-drift-check.sh`）单跑 PASS（基线绿 → 单边改红 → 恢复绿 → 删侧红 → 恢复绿）：

```
workflows-dual-copy-drift-check mutation case: PASS (one-sided edit caught, byte-identical restored)
```

**判据3/AC3（与 AC73 判据4 边界对齐）**：执行核双副本（orchestration/*-tick-core.md vs plugin/loop/*-tick-core.md）的 drift 门（`tick-core-static-check --check-drift`）把「双副本可见性」覆盖到 workflows 双副本——同为「同一文件两处、单边改无门」缺陷族，检查形态逐字复用（两侧行数 + diff 摘要 + `--no-block` 报告模式）。**边界对齐（AC73 判据4）**：执行核双副本靠【Touches 双副本声明纪律】（AC73 判据4，rhythm-consumer-check 的 report 项——task Touches 只写一份 ⇒ 判据4 报红）**叠加** drift 检查才闭合；workflows 双副本现在直接落 drift 检查（比 Touches 纪律更强的机械保证——本任务的 Touches 对 `fan-in-execute.js` 只写被改的 `plugin/workflows/` 落地副本，未改的 `.claude/workflows/` 正本不虚报为 touched，漂移由检查而非 git 读者可见）。边界：本检查只覆盖**当前已双副本的 3 个 workflow 文件**（pinned 集合），不规定哪些文件该双副本（单副本的 execute-suite-fix / manager-tick-core / pool-quality-judge / select-preflight 合法排除），不改 workflow 本体。

**capability-catalog 五方向 entry-gate**：新脚本已声明 QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING，catalog 门通过：

```
capability-catalog: 243 scripts | 243 declared | 0 unclassified | 238 ship
```

**DELIVERY-INVENTORY**：新脚本触发 plugin/scripts A/D 门，快照已再生成（`verify-delivery-surface.ts --write-inventory`，`inventory_drift=0`）：

```
scripts=246 · gate-scripts=14 · skills=13 · probes=5 · loop=6 · workflows=3 · agents=1 · vendor=2
```
