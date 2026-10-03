---
id: gap-transitions-table-lacks-needs-human-and-superseded-edges
title: TRANSITIONS 补全：把生产上真实出现的 needs-human / superseded 边声明进转移表（只加声明，不改
  promote/retreat 行为）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

背景（读数见任务 gap-status-flip-history-and-parser-diff-readings）：对 git 历史 5183 次 tasks/*.md 状态翻转回放，对照 packages/quay/src/gate/lifecycle.ts 的 `TRANSITIONS`，表外 918 次（17.7%）。2026-09-20 以后 22 次表外翻转**全部**涉及 needs-human 或 superseded——不是生产在违反表，而是表缺这两个状态的边：ready→needs-human 215 次、needs-human→ready 111 次、needs-human→done 56 次、todo→needs-human 48 次、todo/ready/needs-human→superseded 76 次。另外 `TRANSITIONS`/`assertTransition` 目前只被 CLI/MCP 的 promote/retreat 路径使用；生产上的三种翻转（promotion-driver 晋升、worker-fan-in flip done、markNeedsHuman）走 plugin/scripts/task-ops.ts 的 patchStatusField，不查表。所以今天「状态机」没有一份完整的、可机读的声明。

<!-- dedup-ref -->
相关：gap-superseded-modeled-as-task-lifecycle-terminal（已 done，把 superseded 定为硬终态：无 forward、无 back；本任务不改这一点，只声明「进入 superseded」的边）。

做法（**只加声明，不改既有行为**）：在 lifecycle.ts 里新增导出的数据表（名字由实现定，建议 `LIFECYCLE_EDGES`），把全部状态对声明成 `{from, to, kind, actors, status: "current"|"legacy"}`，kind ∈ promote | retreat | escalate（→needs-human）| resolve（needs-human→其它）| supersede（→superseded）。`legacy` 标给读数里只在 2026-08 中旬以前出现的边（todo→done、in-progress 旧状态等）；`current` 给 2026-09-20 之后仍出现的边。`actors` 只写已核实的写者类（driver 晋升 / fan-in / needs-human 写入 / task_write），核不清的写 `["unaudited"]`，不得猜。**⛔ `legalForward` / `legalBack` / `assertTransition` 对全部 5×5 个状态对的返回值必须与改动前逐项相同**（先在改动前把 25 个状态对的输出存成金样，改动后比对）。本任务不接线任何写者，不要求 patchStatusField 查表——那是后续任务，且要等本表有了才能做。

## AC

- [x] 既有 promote/retreat 行为不变：新增的金样测试 `scripts/test.sh packages/quay/test/lifecycle-edge-table.test.mjs` exit 0，其中一条断言对全部 5×5=25 个状态对比较 legalForward/legalBack/assertTransition 的结果与改动前金样逐项相同
- [x] 边表覆盖 TASK_STATUSES 的全部状态对：同一测试枚举 TASK_STATUSES×TASK_STATUSES（abi.ts），断言每一对要么在边表里有声明、要么被显式列入「声明为非法」集合——不允许有「既没声明也没标非法」的第三种（硬规则 3b）
- [x] 2026-09-20 之后的 current 边全部在表里：测试断言 {ready→needs-human, needs-human→ready, ready→superseded, needs-human→done} 四条边都存在且 status 为 current
- [x] 能取假（负对照）：cp 备份 lifecycle.ts，临时删掉 ready→needs-human 一条声明，重跑上面的测试必须 exit 非 0；还原后 exit 0；两次 exit 码进 Evidence（⛔ 不用 git checkout 还原）
- [x] 既有转移测试仍绿：`scripts/test.sh packages/quay/test/lifecycle-a1-transitions.test.mjs packages/quay/test/lifecycle-a1-legal.test.mjs packages/quay/test/lifecycle-a1-assert-transition.test.mjs` exit 0

## DoD

真实落地 = 边表进入 develop，且「状态对全覆盖」测试进入 scripts/test.sh 常规套件：此后新增任何状态或边而不声明，suite 变红。Evidence 贴出金样比对结果与负对照的两次 exit 码。本任务不改变任何运行时转移行为；把 patchStatusField 等写者接到该表是另一个后续任务，不在此范围。

## Evidence

**产物**：`packages/quay/src/gate/lifecycle.ts` 新增导出 `LIFECYCLE_EDGES`（17 条声明边）、`LIFECYCLE_ILLEGAL_PAIRS`（8 条显式非法对，合计 25=5×5 全覆盖）、`lifecycleEdge()` / `isDeclaredIllegalPair()` / `lifecyclePairUniverse()` 与 `LifecycleEdgeKind` / `LifecycleActor` 类型；测试 `packages/quay/test/lifecycle-edge-table.test.mjs`（4 个 node:test 用例）。`TRANSITIONS` / `legalForward` / `legalBack` / `assertTransition` **零改动**（只是新增导入与新增块）。

**金样（AC1）**：改表前用 `node --experimental-strip-types` 导出现有实现的结果存成 25 对快照（todo/ready/done/needs-human/superseded × legalForward·legalBack·assertForward·assertBack），硬编码进测试常量 `GOLDEN`；`scripts/test.sh packages/quay/test/lifecycle-edge-table.test.mjs` → `✔ behaviour golden …` PASS，`ℹ pass 4 / fail 0`，exit **0**。

**覆盖分区（AC2）**：同一文件 `✔ coverage partition …` PASS——枚举 `lifecyclePairUniverse()`（= TASK_STATUSES×TASK_STATUSES，25 键），断言每对 `declared XOR illegal`、两集合各自无重复且并集恰好等于全集；另断言任何不在全集的键（未知状态词）会被报出。

**current 边（AC3）**：`✔ current edges …` PASS，四条必需边均存在且 `status:"current"`。补充：我按读数复跑了一遍 `git log --no-merges -p -U0 --no-renames --format='@@C %H %ct %s' -- 'tasks/*.md'`（10348 提交），按 hunk 行号 ≤40 配对 -status/+status，得 2026-09-20 之后的边：todo→ready 196、ready→done 174、needs-human→todo 14、ready→needs-human 13、needs-human→ready 5、ready→superseded 3、ready→todo 3、needs-human→done 1——四条必需边全部在窗口内。

**负对照（AC4，能取假）**：`cp` 备份到 `/tmp/lifecycle.ts.nc-backup`（md5 `c0c413c88f92b744fe3ac086cb34f8a9`）→ `sed -i '/from: TASK_STATUS.READY, to: TASK_STATUS.NEEDS_HUMAN/d'` 删掉那一条声明（grep 计数 1→0）→ 重跑同一测试 **exit 1**（红的是且仅是 `coverage partition` 与 `current edges` 两条）→ `cp` 还原（md5 与被删前逐字节相同 `c0c413…`，grep 计数回到 1）→ 重跑 **exit 0**。⛔ 未用 `git checkout`。

**既有转移测试（AC5）**：`scripts/test.sh packages/quay/test/lifecycle-a1-transitions.test.mjs packages/quay/test/lifecycle-a1-legal.test.mjs packages/quay/test/lifecycle-a1-assert-transition.test.mjs` → `ℹ pass 3 / fail 0`，exit **0**。

**scoped 门**：`scripts/test.sh --for-task gap-transitions-table-lacks-needs-human-and-superseded-edges --allow-thin` → `ℹ pass 95 / fail 0`，exit 0（含新测试 4 条用例；日志可见 `+ packages/quay/test/lifecycle-edge-table.test.mjs` 被选中）。

**判据（classification rule，写进表头注释）**：`status:"current"` ⟺ (wired into `TRANSITIONS` ∨ 有树内 live dedicated writer ∨ 生产读数 ≥2026-09-20)；否则 `legacy`。据此 todo→needs-human 记为 current（`markNeedsHuman` 的 dedicated writer 明确接受 todo，见 driver-filters.ts:908）而 todo/needs-human/done→superseded 记为 legacy（无 dedicated writer、且不在 ≥09-20 窗口内）。`actors` 词表 `driver-promotion|fan-in|retreat|needs-human-writer|out-of-band-complete|task_write|unaudited`，核不清的历史边写 `["unaudited"]`（todo→done、done→todo、done→needs-human、superseded→ready）。

**typecheck**：`npx tsc --noEmit -p tsconfig.json` exit 0（另有 `-p packages/quay/tsconfig.json` exit 0）。

**仍暗的轴**：本任务只加声明，不改任何运行时路径，`L_T` 未被触及（无新增产品行为）；`L_D` 上补了一条此前不可机读的状态机声明（dependency/cycle 无变化）。

## Touches

- tasks/gap-transitions-table-lacks-needs-human-and-superseded-edges.md
- packages/quay/src/gate/lifecycle.ts
- packages/quay/test/lifecycle-edge-table.test.mjs
- packages/quay/test/lifecycle-a1-transitions.test.mjs
