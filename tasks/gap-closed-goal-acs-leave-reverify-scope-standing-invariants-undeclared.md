---
id: gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared
title: 两目标关闭后 21 条判据离开 I5 复验域——哪些属常设不变式须逐条裁定并声明 long-term
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

GOAL-009 与 GOAL-015 于 2026-09-11 相继 achieved 后，本仓库**没有任何 active goal**，I5 复验域（`goal-store.ts` `checkAchievedFailing` 的 `inScope`）由 **18 条降到 4 条**——只剩 4 条显式声明 `long-term: true` 的 AC（AC-161/188/189/190）。GOAL-009 的 17 条与 GOAL-015 的 4 条判据**全部离开复验域**，此后不再被任何机制重跑。

这本身是设计（`goal-store.ts` 注释：「an undeclared one leaves with its GOAL — 成本边界，⛔ 不做无差别放宽」），逃生口也已存在（`long-term: true`，AC-216 投影）。要决定的是：**这批判据里哪些属于「常设保证」，应当在其 goal 关闭后继续被复验。**

需要显式决定的理由是它们中有一类会**随时间自行失效**：新鲜度类判据按「证据 sha 到 develop 的提交距离 ≤ K」判定，K 默认 200。距离只增不减 ⇒ 不重跑就不会有人知道它已经红了。而检测「冻结的 achieved 却失败」的那条判据自己也在同一批里，一并出域。

⛔ 本任务不主张无差别把 21 条全标 long-term（那正是注释禁止的无差别放宽）；要的是按「该判据是一次性验收、还是常设不变式」逐条裁定，并把裁定落到记录字段上。

## Evidence

2026-09-11T17:23 实测（末轮 goal-round 的 `goal-ring` fact）：

- `scopeSize = 4`，`evaluated = true`；`inScope` 中属 GOAL-009 的 AC **0 条**
- 活跃 goal 清单：**空**
- 两目标判据此刻独立干跑：GOAL-009 17/17 exit 0、GOAL-015 4/4 exit 0（即出域时它们是绿的，问题不在当下而在此后无人复验）

新鲜度余量实测（K=200，距离 = `git rev-list --count <证据 sha>..develop -- <paths>`）：

| AC | 证据 sha | 距离 | 余量 |
|---|---|---|---|
| GOAL-009-AC-201 / AC-238 / AC-239 | 3b0932db3 | 0 | 200 |
| GOAL-009-AC-203 / AC-205 / AC-207 / AC-232 | 4a9654a1e | 69 | 131 |

⇒ 四条判据的证据已消耗掉 K 的三分之一，且距离单调增。

## AC

- [ ] AC1（现状读数，可取假）：跑一条命令打印当前 I5 复验域的 `scopeSize` 与 `inScope` 全量清单，并逐条标注每个 id 的 goal 与 goal 的 status；断言清单中不含任何 goal 已 achieved 且未声明 long-term 的 AC——改前此断言应为**假**（当前 GOAL-009 的 17 条正是这种情形的反面：它们已不在清单里）。
- [ ] AC2（逐条裁定，枚举非布尔）：对 GOAL-009 的 17 条与 GOAL-015 的 4 条**逐条**给出「一次性验收 / 常设不变式」的裁定与一句理由，落在本任务体的表格里；⛔ 不得整批同判。
- [ ] AC3（裁定落地）：被判为常设不变式的 AC 全部写入 `long-term: true`；被判为一次性验收的保持原样。改动只碰该字段，其余字段与正文逐字节不变（改前改后 diff 为证）。
- [ ] AC4（复验域读数变化）：改后重跑 AC1 的同一条命令，`scopeSize` 增加的条数 == AC3 中被标记的条数，且新增的 id 集合与被标记集合逐字相等。
- [ ] AC5（取假控制）：对任取一条被标 long-term 的 AC，临时把其判据改成必然失败的形态并跑一次 I5，`achievedButFailing` 必须包含它；恢复后不再包含。证明它真的在被复跑，而不只是名字进了清单。
- [ ] AC6（新鲜度余量可见）：给新鲜度类判据的失败输出补上「当前距离/K」的数字（⛔ 不是布尔），使「还剩多少余量」在红之前就能被读到。
- [ ] AC7（全量绿）：`scripts/test.sh` 全量绿。

## DoD

生产读数可验证：I5 复验域在两目标关闭后仍覆盖被裁定为常设不变式的那些判据，且其中至少一条被实际重跑过（goal-round 记录中出现其 id 的复验痕迹）。⛔ 「字段已写上」不算——必须是复验域读数与重跑痕迹。fixture 与单测是必要不充分条件（DIR-026 Reading A）。

## Touches

- goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md
- packages/quay/src/goal-store.ts
- packages/quay/test/goal-store.test.mjs
- tasks/gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared.md
