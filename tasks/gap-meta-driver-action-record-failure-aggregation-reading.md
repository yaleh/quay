---
id: gap-meta-driver-action-record-failure-aggregation-reading
title: meta-driver 增设第七类读数：动作记录中的跨会话重复失败聚合（GOAL-014 选项①的实现）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-246
---
## Proposal

人 2026-09-12 裁定 GOAL-014 选 **① 纳入：建通用聚合读数**（留痕见该 GOAL statusLog 末条 `draft→active` 的 reason）。本任务是该裁定产生的实现工作。

**要建的东西**：给 meta-driver 增加**第七类读数**——读**动作记录**（会话语料），把「同一错误 × 跨会话重复次数」聚合成清单，**只有越过阈值的项才进 digest**。

**为什么现有六类读不到它**：meta-driver 现有读数（goals/criteria、6 种 driver 的 running/staleSecs、syncHealth、metaRecords、inertCheckers、focus）**全部读状态载体**（`.quay/*.jsonl`、goal store、git），没有一类读动作记录。`inertCheckers` 管的是方向相反的东西（从不报红的惰性守卫），不覆盖「反复报红但无人汇总」。实证：6 个互不相同的会话各自撞 `Unknown skill` 合计 12+ 次、各自现场回退，无任何机件把这 12 次汇总成一个信号。

**成本约束（裁定内已定，⛔ 不得放宽）**：
- 机械形态须**能取假**、**fail-closed**、**未评估取独立值**（不与合格同形）。
- ⛔ **原始计数不得进 digest**。原始计数每轮都可能变 ⇒ digest 恒变 ⇒ 变化检测闸每轮唤醒语义半 ⇒ 烧 LLM。本仓库已有同形先例可循：`plugin/scripts/meta-driver.ts` 里已有一个「每轮都可能 +1」的量被显式挡在 `readingsDigest` 之外，按同一手法处理。
- ⛔ **本任务内不定阈值数值**——成本结构实测前不设数值阈值（硬规则 4 推论一）；阈值须读配置/宿主，不得写字面量（硬规则 4 推论二）。实测出的扫描耗时与命中率写进本任务体后，阈值才有依据。

**新 shipped script 的登记**：新增 `plugin/scripts/*.ts` 会触发登记闸，按 `plugin/scripts/capability-catalog.sh` 头注释逐项补齐（⛔ 该头注释是唯一正本，不在此处复制清单）。

## AC

- [ ] AC1（缺口读数，枚举非布尔）：跑一条命令枚举 meta-driver 当前全部读数类型名，逐条标注其数据源（状态载体 / 动作记录）；断言「数据源 = 动作记录」的类型数**改前为 0**。
- [ ] AC2（新机件）：新增读动作记录的聚合器，输入为 meta-cc 查询结果，输出为按「同错误 × 跨会话重复次数」聚合的**清单**（含错误签名、命中会话数、总次数）；⛔ 不是布尔。
- [ ] AC3（三态可区分，硬规则 3b）：聚合器在「有越阈项 / 无越阈项 / 语料读不到」三种情况下的输出**互不同形**，且「读不到」不与「无越阈项」共用取值。三种取值各给一条实跑读数。
- [ ] AC4（取假控制，双向）：注入一组含 N 次跨会话重复失败的语料 ⇒ 聚合器报出该项；把重复次数降到阈值以下 ⇒ 不报。两次结果必须不同——⛔ 只跑一次「报出来了」不算取假。
- [ ] AC5（digest 稳定性，本条是成本闸的直接量）：同一份语料下连续两轮的 `readingsDigest` **逐字节相同**；新增一条越阈项后 digest **改变**。⛔ 若原始计数进了 digest，第一条必然失败——这正是它要挡的。
- [ ] AC6（阈值不写死）：阈值取值路径读配置或宿主，`grep` 证明实现里无该阈值的数值字面量；并把实测的扫描耗时与命中率写进本任务体（阈值定值的依据）。
- [ ] AC7（生产读数非空）：接进 meta-driver 后，`.quay/meta-driver-round.jsonl` 的**实现落地之后**的轮次里出现该类读数字段，且至少一轮的值来自真实语料扫描（⛔ 非 fixture 注入——硬规则 4 推论三）。
- [ ] AC8（登记齐全）：新增 script 的登记按 `capability-catalog.sh` 头注释补齐，相关闸全绿。
- [ ] AC9（全量绿）：`scripts/test.sh` 全量绿。

## DoD

生产载体可验证：meta-driver 的轮记录里存在动作记录类读数，且该轮读数由真实语料扫描产生；同时「无越阈项」与「语料读不到」在记录上可区分。⛔ 「聚合器能跑」不算——必须是接进 meta-driver 后的生产轮次留痕。fixture 与单测是必要不充分条件（DIR-026 Reading A）。

## Touches

- plugin/scripts/meta-driver.ts
- plugin/test/meta-driver.test.mjs
- plugin/scripts/capability-catalog.sh
- tasks/gap-meta-driver-action-record-failure-aggregation-reading.md
