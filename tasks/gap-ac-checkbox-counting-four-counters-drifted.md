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

- [ ] AC1（先证明分歧真实存在，不是推断）：造一个含 `- [~]` 的任务体样本，分别用
      `countAcCheckboxes` 与 `worker-driver.ts:readAcCheckState` 跑，贴出两者**不同**的 total/checked
      读数——分歧不能复现则本任务前提不成立，须先修正前提再继续
- [ ] AC2：复选框匹配收敛为单一实现；`stale-ready-audit.ts`、`worker-driver.ts`、
      `task-ac-carryover-check.ts` 三处改为调用它，各自私有正则删除
- [ ] AC3（收敛量可核验）：`grep -rnE "\\\\\[\[xX\]\\\\\]|\\\\\[\\\\s\*\\\\\]" plugin/scripts/*.ts`
      中**独立的复选框匹配正则**定义处从 4 降到 1（贴改动前后真实输出；命中里属于注释/测试夹具的
      须按位置排除并说明）
- [ ] AC4（分歧消失，AC1 的镜像）：AC1 的同一样本在收敛后由所有 4 个调用路径得到**相同**读数（贴输出）
- [ ] AC5：`bash scripts/test.sh` 全量绿，尤其 `plugin/test/task-status-drift-check.test.mjs`、
      `plugin/test/ready-pool-check.test.mjs`、`plugin/test/worker-driver*.test.mjs`

## DoD

AC1（分歧存在）与 AC4（分歧消失）的真实读数对照贴进任务体——**这一对是本任务的核心证据**，
只贴"改完了、测试绿"不算数：必须证明修复前两个计数器对同一输入给出不同答案、修复后给出相同答案。

## Touches

- plugin/scripts/task-schema.ts（复选框匹配的单一实现落点）
- plugin/scripts/task-status-drift-check.ts
- plugin/scripts/stale-ready-audit.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/task-ac-carryover-check.ts
- plugin/test/task-status-drift-check.test.mjs
- tasks/gap-ac-checkbox-counting-four-counters-drifted.md
