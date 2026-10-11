---
id: gap-entry-bar-c3-passes-on-absent-or-unreadable-decision-memory
title: 'limited-proposal entry bar fails OPEN on condition 3: an absent
  decision_memory or one with unreadable_input:true is read as "not-known" and
  passes; malformed carrier lines are silently dropped from the streak input'
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

联合回归后续(2026-10-11),按「Quay refactor architecture liaison」建议对"读不到 ⇒ 返回空/默认值、调用方读成实质结论"这一形状做同载体排查(硬规则 5b),在**受限提案准入闸本身**发现一个 **fail-open** 实例(按位置核实):

1. `docs/analysis/ownership-active-limited-proposal.mjs` 的 `decisionMemoryStatus(rec)`(约第 70-75 行):`decision_memory` **缺席** ⇒ 返回 `"not-known"`(注释:"absent ⇒ not-known, the loop's default");有 `decision_memory` 时**只读 `status`**,忽略 `unreadable_input`。
2. `docs/analysis/architecture-decision-memory.mjs` 的 `isKnownExemption` 对不可读输入返回 `{ status: "not-known", …, unreadable_input: true }`(约第 117-119 行)——注释写"unreadable input must NOT be shaped like 'nothing matched'",但 `status` 与"什么都没命中"同值,区别只在旁路标志;该保证**没有穿过调用边界**(硬规则 4c/3b)。
3. 于是 `evaluateEntryBar` 的条件 3(约第 164-166 行)把"决策记忆根本没跑"和"决策记忆读不懂输入"都当作"已查过、非已知豁免"**放行**——违反硬规则 6(缺值 = 未查,不是"为假")。条件 3 本已有 `CONDITION_3_UNDETERMINED` 分支(对未识别 status 失败关闭),只是这两种情形到不了它。
4. 同文件 CLI(约第 360 行)读 carrier 时 `try { JSON.parse } catch { return null }` 后 `.filter(Boolean)`——**静默丢弃**不可解析行,不计数、不报告(对照 `architecture-evidence-store.mjs` 约第 140 行的读者会报 `malformed_lines`)。若打断连续合格的那条生产记录恰好是坏行,它被丢掉后 streak 看起来未被打断——条件 4 的输入失真,方向同样是 fail-open。

**发生率(硬规则 12,查历史)**:生产 carrier `.quay/ownership-shadow-proposals.jsonl` 91 条中 **89 条没有 `decision_memory` 字段**,今天全部被读成 `not-known`(未经任何决策记忆检查即"通过"条件 3);`unreadable_input:true` 0 条;坏行 0 条。今天被掩盖只是因为这些记录都卡在条件 2(delta 未算出)。**而 `@yalehwang/archguard@0.1.40` 已发布(2026-10-11),默认路径已能对 gate 四环候选算出可证伪 delta,条件 2 不再必然挡住**——条件 3 的 fail-open 从此可达。

<!-- dedup-ref -->
去重:open 任务对 `decisionMemoryStatus`/`unreadable_input`/`entry bar`/`limited-proposal` 零命中;`task-granularity-advice` 对本 Touches 无 peer。与 `gap-ownership-active-repair-unreadable-source-is-not-unknown-symbol`(修复环侧同形状、fail-closed 方向)文件不重叠。

## AC

- [x] AC1 `decisionMemoryStatus`:`decision_memory` 缺席 ⇒ 返回一个非 `not-known` 的独立值(如 `"not-evaluated"`);`decision_memory.unreadable_input === true` ⇒ 同样返回 `"not-evaluated"`;二者都经条件 3 既有的 `CONDITION_3_UNDETERMINED` 分支失败关闭,`reason` 点名是"缺席"还是"不可读"。
- [x] AC2 负对照:一条其余条件全满足、仅 `decision_memory` 缺席的合成生产记录 ⇒ `eligible:false` 且 `reason` 以 `CONDITION_3_UNDETERMINED` 开头;同一条记录把 `decision_memory` 改为 `{status:"not-known", unreadable_input:true}` ⇒ 同样不合格;改为 `{status:"not-known", unreadable_input:false}` ⇒ 条件 3 通过(正对照,证明不是一律拒绝)。
- [x] AC3 CLI 读 carrier 时统计并输出 `malformed_lines`;`malformed_lines > 0` 时,所有候选的 `eligible` 一律为 `false`,`reason` 点名坏行数(无法把坏行归属到候选,streak 输入不可信 ⇒ 失败关闭);`--write` 在此情形下不写任何 Goal。负对照:在临时 carrier 副本末尾追加一行非 JSON,原本合格的合成候选变为不合格。
- [x] AC4 生产读数(记录,不设门槛):对生产 carrier 跑一次 dry-run,报告中写明修复前后各候选 `reason` 的变化(预期:原先只因条件 2 失败的记录,修复后条件 3 读数变为 UNDETERMINED/缺席——但首个失败条件仍按既有顺序报告,不改条件求值顺序)、`malformed_lines` 读数。
- [x] AC5 门限只收紧不放宽:streak=3、条件 1/2/4 判据、只写 `draft`、绝不激活均不改;既有 `plugin/test/ownership-active-limited-proposal.test.mjs` 全绿(若某既有测试依赖"缺席 ⇒ not-known"的旧读法,显式更新并在提交说明里列出);`bash scripts/test.sh --for-task gap-entry-bar-c3-passes-on-absent-or-unreadable-decision-memory` exit 0。

## DoD

条件 3 对"决策记忆未运行/读不懂输入"失败关闭,条件 4 的输入在出现坏行时失败关闭;两处都有针对性负对照与正对照,生产 carrier 读数记录在 `docs/analysis/architecture-evidence-store-limited-proposal-report.md` 新节。⛔ 不放宽任何门限,不改决策记忆种子(不从 GOAL-034 取材——它是 Holdout B),不创建/激活任何 Goal。

## Touches

- docs/analysis/ownership-active-limited-proposal.mjs
- docs/analysis/architecture-evidence-store-limited-proposal-report.md
- plugin/test/ownership-active-limited-proposal.test.mjs
- tasks/gap-entry-bar-c3-passes-on-absent-or-unreadable-decision-memory.md
