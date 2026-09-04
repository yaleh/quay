---
id: gap-loop-shipping-ac1b-ac58-archive-exclusion
title: loop-shipping AC1b 仍红——AC58-retired-clauses.md 历史档案含旧路径引用但未入排除表（owner 任务已 done 但红 persists）
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（inner 2026-08-15 13:3xZ 立案——owner 任务 `gap-loop-shipping-ac1b-still-red-live-old-path-ref` status=done 但 AC1b 红在 develop 上仍 persists，能产出≠已产出类）**。

**现象**：`plugin/test/loop-shipping.test.mjs` AC1b「after the move, no live reference to the 5 old paths remains」在 develop 上仍红。实测：`orchestration/archive/AC58-retired-clauses.md` 含 7 处 `orchestration/orchestrator-loop-tick.md` 旧路径引用（lines 492/514 等），`loop-shipping-exclusion-data.mjs` 排除其它 AC58 格式档案（`manager-phase-goal-archive.md` 等）但**未排除 `AC58-retired-clauses.md`**。

**这是【历史档案引用】非【活引用】**：AC58-retired-clauses.md 是退役条款档案，记录被退役内容（含旧路径）——同 `manager-phase-goal-archive.md` / `tick-log.md` 等已排除档案同一类（文档化 DEPLOYED target layout 的活引用，或历史存档的旧路径记录）。parser fan-in（gap-touches-parser-strip-annotation-nested-parens）被此红阻断（全量 suite 恒红）。

**修法**：`loop-shipping-exclusion-data.mjs` 加排除条目 `orchestration/archive/AC58-retired-clauses.md`（历史档案，旧路径引用是文档化记录，非活引用到已移动机制）。⛔ 不改 AC1b 扫描本身（仍必须抓真活引用）。

**判据1**：AC1b 对 AC58-retired-clauses.md 的旧路径引用不再报红（隔离 + 全量 suite）。
**判据2（能取假·真样本）**：修后 `node --test plugin/test/loop-shipping.test.mjs` AC1b 绿；真活引用（如某处真引用了已移动路径的活跃文件）仍红。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 跑 `node --test plugin/test/loop-shipping.test.mjs` 确认 AC1b 红 + actual hits 对象（AC58-retired-clauses.md）。
2. `loop-shipping-exclusion-data.mjs` 加 AC58-retired-clauses.md 排除条目（同 AC58 格式档案先例）。
3. 判据2 能取假：AC1b 绿 + 真活引用仍红。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：AC1b 对 AC58-retired-clauses.md 旧路径引用不再报红（隔离 + 全量）。
- [x] AC2 判据2 能取假：AC1b 绿；真活引用（活跃文件引用已移动路径）仍红。
- [x] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] AC58-retired-clauses.md 入排除表（历史档案）+ AC1b 绿 + 真活引用仍红 + 测试绿——parser fan-in 解除阻断。

## Evidence

**修前（develop a058deaa，主检出）** — `node --test plugin/test/loop-shipping.test.mjs`：
```
✖ AC1b — after the move, no live reference to the 5 old paths remains (comments/history excluded)
  AssertionError [ERR_ASSERTION]: no live reference to the moved files' old paths may remain ...
  + actual - expected
  + [
  +   'orchestration/archive/AC58-retired-clauses.md: contains "/orchestration\\/orchestrator-loop-tick\\.md/"'
  + ]
  - []
ℹ tests 15  ℹ pass 14  ℹ fail 1
```
（AC58-retired-clauses.md 实际含 2 处 `orchestration/orchestrator-loop-tick.md`，lines 492/514——退役条款的「来源」记录，历史档案非活引用；AC1b 扫描每文件每 pattern 报 1 hit。）

**修法**：`plugin/scripts/loop-shipping-exclusion-data.mjs` 加排除条目 `orchestration/archive/AC58-retired-clauses.md`（同 `manager-phase-goal-archive.md` 先例：只读历史档案，旧路径引用是退役记录非活引用）。⛔ 未改 AC1b 扫描本身。

**修后（worktree task/ 分支）** — `node --test plugin/test/loop-shipping.test.mjs`：
```
✔ AC1b — after the move, no live reference to the 5 old paths remains (comments/history excluded)
ℹ tests 15  ℹ pass 15  ℹ fail 0
```
`node --test plugin/test/loop-shipping-necessity-check.test.mjs`：pass 3 / fail 0（新条目非惰性——抑制 2 处命中，无需 retainedNote）。

**判据2 能取假（真样本）** — 在主仓库（worktree 根）写探针 `.loop-shipping-falsify-probe.md`（含活引用 `orchestration/orchestrator-loop-tick.md`），AC1b 立即变红：`✖ AC1b ...  ℹ pass 14  ℹ fail 1`，删探针后恢复全绿。⇒ 扫描保留解析力，排除仅覆盖该档案文件，真活引用仍被捕获（loop-shipping.test.mjs 自带 AC3 负控制同证）。

**scoped 门** — `scripts/test.sh --for-task gap-loop-shipping-ac1b-ac58-archive-exclusion --allow-thin`：EXIT=0。全部静态检查绿：test-framework-policy PASS、test-isolation PASS（26 已基线化无新增）、tmp-leak-pairing PASS、test-impl-census clean 404、task-contract-check no violations、delivery-inventory drift gate PASS；并跑全 loop-shipping 15 用例全绿。

> 注：worktree 首次无 `node_modules`（gitignored 不随 checkout），按既有约定 `ln -s /home/yale/work/quay/node_modules node_modules` 后 scoped 门绿。

## Touches

- plugin/scripts/loop-shipping-exclusion-data.mjs（AC58-retired-clauses.md 排除条目）
- plugin/test/loop-shipping.test.mjs（如需要，确认排除生效）
- tasks/gap-loop-shipping-ac1b-ac58-archive-exclusion.md（自身）
