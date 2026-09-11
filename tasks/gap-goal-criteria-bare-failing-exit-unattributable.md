---
id: gap-goal-criteria-bare-failing-exit-unattributable
title: 30/92 条在域判据的失败出口是裸 exit(1) 不写成因 ⇒ 它们一旦转红就在生产台账留下不可归因的 fail（AC-239 此刻正在这样）
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-241
---
## Proposal

**现状（实测，2026-09-11 05:5xZ）**：生产台账里逐字

```
AC-239 | verdict=fail | reason="acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"
```

⇒ 失败**不可归因**：看不出是「没有可锚定的升级现场」还是「该现场上没有匹配记录」——两者处置不同。

**范围（机械枚举，非抽样）**：扫 `goals/AC-*.md` 中 status ∈ {active, achieved} 且有 criterion 的记录：

```
在域且有 criterion 的 AC:      92
含【裸失败退出】的:            30   (32.6%)
```

判别方式：判据文本中出现 `sys.exit(1)` / `exit 1` 而**同行没有任何 stderr 写入或打印**。样例：AC-157(3 处)、AC-158(3)、AC-161(3)、AC-164(4)、AC-167(4)、AC-239(2)…

**为什么这不是「以后再说」**：其中多数当前为 achieved，所以现在不写 fail reason——但 AC-216 已确立「achieved 的 AC 仍在 I5 复验域」，任何一条转红都会立刻在台账留下一条无成因记录。AC-239 只是第一个显形的。

**与既有已达成条目的关系（此段刻意不含前置类措辞，仅作追溯）**：runner 侧的义务已由 AC-237 落实——失败 reason 现在会带上判据自己写到 stderr 的文本，且三种失败形态互不同形、有截断。但那条判据只跑一个**必然写输出的 fixture**（`echo CAUSE-TOKEN >&2; exit 1`），结构上观察不到「真判据什么都没写」。⇒ 本条补的是**判据自身**这一侧，与 runner 侧是互补面，不是重复（硬规则 4 推论三：fixture 只证明能产出，不证明已产出）。

## Plan

1. **止血**：先修当前唯一在红的那条——`goals/AC-239-*.md` 的 criterion，`:31`（`if not upgraded: sys.exit(1)`）与 `:42`（末尾 `sys.exit(1)`）各补一句写 stderr 的成因，两句必须**互不相同**（一句说「无可锚定的升级现场」，一句说「该现场上无匹配记录」）。⛔ 只改诊断输出，**不得改变 pass/fail 语义**——改前改后对同一载体的退出码必须一致。
2. **造检测器而非逐条手改**（30 条一次改完既贵又会与在飞任务抢文件）：新增一个机械检查，枚举 `goals/AC-*.md` 的 criterion，报出「失败出口不写成因」的条数与清单；接进套件。
3. **只许降不许升的棘轮**：基线锚定当前实测值（30），此后**任何新增或修改的判据不得增加该计数**。⛔ 不要求一次归零——那会让本条不可达（硬规则 12 同源：别用未测量的残差挡住可达目标）。
4. **三态保留**：检查器读不到 `goals/` 或解析不了 criterion ⇒ `NOT-EVALUATED` 并退出码与「合格」不同形（硬规则 3b）。

## Acceptance Criteria

- [ ] AC1 缺陷存证（改前读数）：贴上述台账那条 AC-239 的 `reason` 原文，与枚举脚本输出的 `92 / 30` 两个计数及前 5 条清单。
- [ ] AC2 止血且语义不变（能取假）：改后 AC-239 的 criterion 在两条失败路径上各写出**不同**的成因文本；同时贴改前改后对**同一份载体**的退出码，二者必须相同（⛔ 诊断改动不得改判定）。
- [ ] AC3 台账上真的可归因（⛔ 夹具不算，硬规则 4 推论三）：改动落地后从 `.quay/goal-round.jsonl` 取**落地之后**的轮次，AC-239 若仍 fail，其 `reason` 含新写的成因文本之一；贴该记录。若此时 AC-239 已转 pass，则改用任一其它 fail 记录，并说明。
- [ ] AC4 检测器存在且能取假：新检查器对当前仓库报出的条数 = 实测值；**注入**一条带裸失败退出的夹具判据 ⇒ 计数 +1；移除 ⇒ 复原。贴三次计数。
- [ ] AC5 棘轮生效（能取假）：基线写入后，人为让计数 +1 ⇒ 检查器**报红**；恢复 ⇒ 转绿。贴两次退出码。
- [ ] AC6 三态可区分：令 `goals/` 不可读 ⇒ 输出 `NOT-EVALUATED` 且退出码与合格、与报红三者互不相同；贴三种退出码。
- [ ] AC7 AC-241 判据翻转：`goals/AC-241-*.md` 的 criterion 干跑从 exit 1 → exit 0（贴干跑输出）。
- [ ] AC8 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

当前在红的判据不再产出无成因的 fail；「判据失败出口不写成因」的条数由机械枚举给出、有只许降不许升的棘轮守着、且检查器本身能取假并保留未评估态。⛔ 把 30 条全部批量塞一句同样的成因文本 ⇒ 不算达成（那只是把空因模板换成另一个恒定模板，仍不可归因）；⛔ 放宽检测器使计数归零 ⇒ 不算达成。

## Touches

- goals/AC-239-升级后闭环-driver-在已升级的旧痕迹项目上继续驱动出新任务到-done-不只是装得上-还能接着干.md
- plugin/scripts/criterion-failure-attribution-check.ts
- plugin/scripts/capability-catalog.sh
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/checker-mutation-cases/criterion-failure-attribution-check.sh
- packages/quay/plugin/scripts/criterion-failure-attribution-check.ts
- plugin/test/criterion-failure-attribution-check.test.mjs
- docs/analysis/criterion-failure-attribution.baseline.json
- tasks/gap-goal-criteria-bare-failing-exit-unattributable.md
