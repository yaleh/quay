---
id: gap-bypass-ruled-cbbbb766
title: "bypass-ruled 表加 cbbbb766——closure fix 应急直提豁免（四条在飞任务被同一缺陷挡，止损优先）；教训原样入条目"
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

**来源**：manager closure fix（cbbbb766，init/SKILL.md 补 manager-visual-check.py 声明）是**直接提交**（代码面、无 AC65 声明、不在 ruled 表）⇒ `direct-to-develop-bypass-check` 判 confirmedBypass ⇒ 四条在飞任务（AC95/delta-scope/a13/cross-midnight）的 fan-in 全被静态闸挡。

**裁定（manager，path 1）**：把 cbbbb766 加进 RULED_HISTORICAL_COMMITS，落地走正规 fan-in（⛔ 不直提——本次就是 bypass 教训的现场）。改 checker 的提交自身按 8dfd2967 模式 lock-window 豁免。

**ruled 条目措辞（manager 原话，两句话都要有）**：
- **理由**：四条在飞任务被同一个 closure 缺陷挡住，修复本身很小（一行标记），走完整 fan-in 要再等一轮全量 suite（500-700s）才能解锁，止损优先于流程完整性。
- **教训（⛔ 必须原样进条目，不能只写理由）**：manager 直提 develop 同样是不对的行为模式，应当走 fan-in——这次是应急例外，不该成为常态。

**⛔ AC65 那条死路不再花时间**（marker 无法追溯补，manager 已确认）。

## Acceptance Criteria

- [x] AC1: `RULED_HISTORICAL_COMMITS` 含 cbbbb766，reason 含【理由 + 教训】两句（manager 原话）。
- [x] AC2: bypass-check（--baseline 当前 develop）对 cbbbb766 PASS（ruled 生效）。
- [x] AC3: 经 fan-in 正规 land（lock-window 豁免本任务提交），非直提。

## Definition of Done

- [ ] develop 的 bypass-check 过（cbbbb766 ruled）；delta-scope runner suite 可重跑落 fullSuiteRan=true。（待外部）

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（RULED_HISTORICAL_COMMITS 加 cbbbb766）
- tasks/gap-bypass-ruled-cbbbb766.md（自身）

## Test-Files

- plugin/test/direct-to-develop-bypass-check.test.mjs（既有测试全绿）
