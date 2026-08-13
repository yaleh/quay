---
id: gap-src-n-pointer-rot-unverifiable-coverage
title: AC30(a) (src:N) 覆盖率是结构上不可能取假的量——行号指针腐烂而闸门每轮报 100%
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-12 抽验 + outer 复核）**：tick-core 的 `(src:N)` 覆盖率 measure（AC30(a)，
「每条带源行号回指理由档案，目标 100%」）只检查**括号在不在**（`tick-core-static-check` AC3 逐字：
「an item without (src:N) reddens」），**不检查指针指对没有**。

**抽验 3 条，3/3 指错**：
- A15（收件箱）引 `(src:1203)` → 1203 行是 nyf/pool deficit 干预阶梯（A14 题目）
- A2（固定 cap）引 `(src:882)` → 882 行是「把 AC 已判完的事推给人」（C8 题目）
- A16 引 `(src:694)` → 694 行是**空行**

**粗测**：manager 核 51 条 `(src:N)` 中 11 条（22%）指向空行；outer 复核 45 条中 8 条指向空行
（分母不同，同类）。**22% 只是下界**——指向非空行也可能指错内容（3/3 已证）。

**为什么必然烂掉**：`(src:N)` 是**行号**，档案每天被改（manager 核 1 小时内 1651→1650→1651）。
**行号是指针，档案是被指对象，两者无约束。** 判准 ②i row I「指向死对象的指针」——不是 1 个死指针，
是 51 个持续腐烂的指针，而闸门每轮报 100%。

**⇒ AC30(a) 当前量测不出任何东西，三层（manager 54/54、orchestrator 44/44、fast-mode 54/54）都在用它自查。**

## Plan

**⚠️ 前置顺序（manager 2026-08-12 判定，写死）**：**本任务必须等 vhs-merge 落地之后再做锚句推导**——
manager-loop-tick.md 的合并改动落在 @@509/517/532/950，净 +10 行（1650→1660），
**51 条 (src:N) 中 32 条 N>509 ⇒ 合并后整体下移最多 +10 行**。
若在合并前推导锚句，inner 会对着一份即将整体位移的档案算锚点，算完即过期（bin/quay.ts 同形）。
**优先级：vhs-merge 落地 → 本任务再启动。**

1. 把纯行号换成**行号 + 一小段锚句**：`(src:1203 "干预阶梯:K=1 报外层")`。
2. 检查器断言锚句出现在第 N 行 ±K 行内（K 可配，默认 5）。
3. 锚句在 N±5 行内命中 ⇒ 绿；否则报「指针腐烂」并给出锚句真实所在行（可一键修正）。
4. 这样 measure 从「括号在不在」变成「指针指对没有」，且自动给出修正值。

## AC

- [x] AC1: `(src:N "锚句")` 双元素引用格式落地（行号 + 锚句）
- [x] AC2: 检查器断言锚句在 N±5 行内命中；否则报「指针腐烂」+ 锚句真实行
- [x] AC2b: **锚句必须是档案第 N 行（或 N±5 内某行）的【子串】**——检查器做 `substring` 断言。
      不许引用者自拟概括（否则「见档案关于 A15 的讨论」在 N±5 内几乎总能命中，measure 又退化成
      不可能取假的量）。作弊需真把那句写进档案 = 正是想要的行为。
- [x] AC3: 负控制——指向空行的旧 `(src:N)` 变红（现 8-11 条应被检出）
- [x] AC3b: 口径写死——逗号形 `(src:1570,1623)` 按引用【个数】算，不按括号个数算（manager 51/11 与 outer 45/8 口径对齐）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修复前 8-11 条空行指针 + 修复后全绿的对照贴出（见 Evidence）
- [ ] 全量套件绿

## Touches

- plugin/scripts/tick-core-static-check.ts（锚句断言逻辑）
- orchestration/{manager,orchestrator}-tick-core.md（(src:N) → (src:N "锚句") 迁移）
- plugin/loop/{manager,orchestrator}-tick-core.md（随包副本同步）
- tasks/gap-src-n-pointer-rot-unverifiable-coverage.md（自身）

## Evidence

**修复前（锚句检查落地前，同一检查器跑在当前档案上）**：AC3 检出 **21 条空行指针**——
`orchestration/manager-tick-core.md` 7 条（`(src:490)`×2、`1598`、`1519`、`160`、`1525`、`1531`）+
`orchestration/orchestrator-tick-core.md` 14 条（`583`、`1057`、`1238`、`1028`、`283`、`395`、`402`、
`378`、`968`、`1038`、`302`、`252`、`517`、`524`）。另有 3/3 抽验指错的指针（A15→1203 为归档小节标题、
A2→882 为「已存在文件走 CONFLICT」、A16→694 现指「工具使用自查」）——迁移中逐一重定位到正确小节。

**锚句检查设计（AC1/AC2/AC2b/AC3/AC3b）**：
- 新引用格式 `(src:N "锚句")`；检查器对每个 `(src:N …)` 解析出引用（逗号形按引用个数展开，AC3b），
  对带锚句的引用做 `substring` 断言——锚句必须是档案第 N 行 **或 N±5 内某行**的**子串**（AC2b），
  命中即绿；N±5 内未命中 ⇒ 报「指针腐烂」并给出锚句真实所在行（AC2）。
- 旧格式 `(src:N)` 在参与锚句检查的核（manager/orchestrator，`ANCHOR_PARTICIPATING`）里指向空行 ⇒ 红
  （AC3 负控制）。`fast-mode-tick-core.md` 豁免（其 `(src:N)` 自文档即标注「按内容核对不按行号」，
  迁移不在本任务 Touches 内）——但其中出现的锚句形式仍会被验证。
- 档案缺失 ⇒ 该核锚句验证跳过（fail-open，测试 fixture 不带档案）；真实仓库档案恒在。
- 迁移量：manager 核 51→46 引用、orchestrator 核 72→29 引用（空行/指错的 N 已重定位），
  plugin/loop 两副本同步迁移。

**修复后**：
```
tick-core-static-check: AC3 src:N coverage manager-tick-core.md=42/42 / orchestrator-tick-core.md=54/54 / fast-mode-tick-core.md=44/44 (target 100%)
tick-core-static-check: AC4 pointer targets OK
tick-core-static-check: AC5 B3 numbering OK
tick-core-static-check: AC6 prohibition consistent
tick-core-static-check: PASS — execution cores are statically covered.
```

**负控制 fixture**（临时根，manager 核 + 档案）：
```
| A2 | 空行指针 | 应红 (src:6) → FAIL … — blank
| A3 | 错误锚句 | 应红 (src:3 "K=99 不存在") → FAIL … — anchor-miss actualLines=
```
空行指针变红、锚句不在 N±5 变红且带真实行——measure 从「括号在不在」变成「指针指对没有」。

**scoped 门**：`scripts/test.sh --for-task gap-src-n-pointer-rot-unverifiable-coverage --allow-thin`
→ tick-core-static-check PASS + delivery-inventory drift gate PASS + `plugin/test/tick-core-static-check.test.mjs`
**12/12 绿**（含「the real repo passes all four criteria」）。全量套件未在本轮跑（scoped-only 纪律），
按 DoD 由全量门兜底。
