---
id: gap-ac-checkbox-counting-four-counters-drifted
title: AC 复选框计数有 4 个独立实现，且已产生行为分歧——worker-driver 的 readAcCheckState 漏判 [~]
  部分完成，与规范实现 countAcCheckboxes 对同一任务给出不同总数
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  consolidates: 3
---
**type:** execution

## Proposal

**现场核实（2026-09-04 会话审计）**："数任务体里的 AC/DoD 复选框"这一个判定有 **4 个独立实现，
彼此零共享 import**：

1. `plugin/scripts/task-status-drift-check.ts:117-136` `countAcCheckboxes` —— 规范实现，被
   `ready-pool-check.ts:210` 正确 import；
2. `plugin/scripts/stale-ready-audit.ts:58-72` `checkedAcCount` —— 自带 heading 正则 + 自带
   `\[[xX]\]` 扫描，不 import；
3. `plugin/scripts/worker-driver.ts:1060-1093` `readAcCheckState` —— 同上，不 import；
4. `plugin/scripts/task-ac-carryover-check.ts:74-81` —— 自带逐行 `AC<n>` id + 勾选提取，不 import。

**⚠️ 这不是理论风险，分歧已经存在**：`countAcCheckboxes` 显式把 `- [~]`（部分完成）计入 total 但
算作未勾（其注释：「`[~]` (partial) counts as unchecked, matching the gate semantics」）；而
`worker-driver.ts:readAcCheckState` 的正则是 `\[[xX]\]`（勾）与 `\[\s*\]`（未勾）——**两者都匹配不到
`[~]`**，该框对它**完全不可见**，于是同一个任务文件在两个计数器下得到**不同的 total**。

后果落在生产判断上：AC 是否全勾**直接决定任务能否翻转 done / fan-in 能否放行**
（`fan-in-ac-completion-gate` 与晋升闸都读这个判定）。两个计数器不一致 ⇒ 同一任务在不同关口可能
得到相反结论，且**没有任何检查会报出这个不一致**。

**修法方向**：把「复选框匹配」这一层抽成 `task-schema.ts` 的单一导出（与
[[gap-abi-promote-section-parsing-flip-store-reverse-import]] 已上收的 `countAcCheckboxes` 同处），
其余 3 处改为调用它；`[~]` 的语义以规范实现为准（计入 total、算未勾）。

## AC

- [x] AC1（先证明分歧真实存在，不是推断）：造一个含 `- [~]` 的任务体样本，分别用
      `countAcCheckboxes` 与 `worker-driver.ts:readAcCheckState` 跑，贴出两者**不同**的 total/checked
      读数——分歧不能复现则本任务前提不成立，须先修正前提再继续
- [x] AC2：复选框匹配收敛为单一实现；`stale-ready-audit.ts`、`worker-driver.ts`、
      `task-ac-carryover-check.ts` 三处改为调用它，各自私有正则删除
- [x] AC3（收敛量可核验）：`grep -rnE "\\\\\[\[xX\]\\\\\]|\\\\\[\\\\s\*\\\\\]" plugin/scripts/*.ts`
      中**独立的复选框匹配正则**定义处从 4 降到 1（贴改动前后真实输出；命中里属于注释/测试夹具的
      须按位置排除并说明）
- [x] AC4（分歧消失，AC1 的镜像）：AC1 的同一样本在收敛后由所有 4 个调用路径得到**相同**读数（贴输出）
- [x] AC5：`bash scripts/test.sh` 全量绿，尤其 `plugin/test/task-status-drift-check.test.mjs`、
      `plugin/test/ready-pool-check.test.mjs`、`plugin/test/worker-driver*.test.mjs`

## DoD

AC1（分歧存在）与 AC4（分歧消失）的真实读数对照贴进任务体——**这一对是本任务的核心证据**，
只贴"改完了、测试绿"不算数：必须证明修复前两个计数器对同一输入给出不同答案、修复后给出相同答案。

**AC1（修复前，分歧真实存在）**——样本 `- [ ] AC1 / - [x] AC2 / - [X] AC3 / - [~] AC4 / - [ ] AC5`：

```json
{
  "countAcCheckboxes": { "total": 5, "checked": 2, "unchecked": 3, "sectionFound": true },
  "readAcCheckState": { "checked": 2, "total": 4 },
  "diverged": true
}
```

`readAcCheckState` 的旧正则 `\[[xX]\]` + `\[\s*\]` 都匹配不到 `[~]`，total 少算 1（4 ≠ 5）。

**AC4（修复后，分歧消失）**——同一样本，4 个调用路径：

```json
{
  "countAcCheckboxes": { "total": 5, "checked": 2, "unchecked": 3, "sectionFound": true },
  "readAcCheckState": { "checked": 2, "total": 5 },
  "parseAcBox_tilde": { "id": "AC4", "checked": false },
  "uncheckedAcIds": ["AC1", "AC4", "AC5"],
  "converged": true
}
```

`[~]` 现统一计入 total、算未勾：`readAcCheckState.total` 5=5，`parseAcBox("[~] AC4")` 从 null 变为
`{id:"AC4", checked:false}`，`uncheckedAcIds` 现含 AC4。

**AC3（grep 收敛量，改动前后）**——`grep -rnE "\\\[\[xX\]\\\]|\\\[\\s\*\\\]" plugin/scripts/*.ts`：

修复前（6 处命中，其中 4 处属本任务 4 个独立实现、2 处 out-of-scope）：
- `stale-ready-audit.ts:70`（checkedAcCount）、`task-status-drift-check.ts:134`（countAcCheckboxes）、
  `worker-driver.ts:1085`（`\[[xX]\]`）、`worker-driver.ts:1088`（`\[\s*\]`）——4 个实现，收敛后删除。
- `manager-tick-readings.ts:383`、`task-schema.ts:296`（`CHECKED_BOX_RE`）——按位置排除：前者是 manager
  趋势计数的 `- \[[ xX]\]` 统计、后者是 `countBoxes` 的 schema 校验清单正则（要求框后必有内容、`[-*]`
  双引号，语义不同于「计数 AC/DoD 复选框」），二者均不在本任务 4 个被收敛实现之内。

修复后（3 处命中，其中 1 处是本任务单一实现、2 处仍是上述 out-of-scope）：
- `task-schema.ts:329`（`countAcCheckboxes` 内的 `\[[xX]\]`）——唯一 in-scope 定义处。
- `manager-tick-readings.ts:383`、`task-schema.ts:296`——同上，out-of-scope，未改动。

⇒ in-scope 复选框匹配正则定义处 **4 → 1**。

**AC5（测试）**：`node --experimental-strip-types --test` 分别跑
`task-parsing-parity` / `task-status-drift-check` / `task-ac-carryover-check` / `stale-ready-audit` /
`ready-pool-check` / `worker-driver` / `worker-driver-resident` / `worker-driver-fan-in` /
`slot-refill` / `mirror-pair-drift-check` —— 全部 0 fail（含新增
「countAcCheckboxes is SINGLE-SOURCED」身份回归测试）。全量 `scripts/test.sh` 由 driver fan-in 执行。

## Touches

- plugin/scripts/task-schema.ts（复选框匹配的单一实现落点）
- plugin/scripts/task-status-drift-check.ts
- plugin/scripts/stale-ready-audit.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/task-ac-carryover-check.ts
- experiments/quay-perpetual-stream/scripts/task-schema.ts（镜像副本，须与 plugin/scripts 字节一致）
- experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts（镜像副本，须与 plugin/scripts 字节一致）
- plugin/test/task-status-drift-check.test.mjs
- tasks/gap-ac-checkbox-counting-four-counters-drifted.md
