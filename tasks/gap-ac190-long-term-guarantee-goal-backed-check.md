---
id: gap-ac190-long-term-guarantee-goal-backed-check
title: 实现反例检测器 long-term-guarantee-goal-backed-check.ts：长期保证只有 task AC 背书 ⇒
  报红（真仓库绿 + 注入未背书条目红，双向负控制）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-190
---
## Proposal

正本：`goals/AC-190-task-ac.md`（判据）+ `goals/GOAL-007-done-fixture.md`（丁 的层级不对称段）。

AC-190 判据当前取假（2026-09-07 干跑：`plugin/scripts/long-term-guarantee-goal-backed-check.ts` 不存在，exit 1）。人已裁定方向【丁：不修，上移 goal 层】（AC-190 origin 逐字）：承认 task 层判据是一次性的，把需长期维持的保证显式上移为 goal 层 AC（goal-driver 每轮约 42s 已对其跑 gateCriterion）。但丁 若只有 AC-188 的一次性迁移与 AC-189 的散文纪律，第四条、第五条长期保证仍会默认停在 task 层而没有任何红——AC-190 origin 点名这是「丁 的真正难点」：「没有它，丁 与『什么都不做』在记录上同形」（硬规则⑨：守与不守在记录上无法区分 ⇒ 造产物）。

本任务交付这个反例检测器：把「声称长期保证却只有 task AC 背书」变成可机械提问、能取假、带双向负控制的量——真仓库绿、注入未背书条目红。

范围边界（AC-190 origin 已划清）：本任务只交付检测器脚本 + 其测试缝 + 注册三闸。不创建 AC-192/193/194（那是 AC-188 已立任务 gap-ac188-three-long-term-guarantee-goal-acs）、不查迁移 AC 是否跑过（AC-191）。

## Plan

1. 读 `goals/AC-190-task-ac.md` 判据与 `goals/GOAL-007-done-fixture.md` 三例原文，确定「长期保证」的登记形态与「背书」的判定：背书 = goal-store list 里存在 kind=criterion、status ∈ {active, achieved}、criterion 非空、origin 点名来源 task id 的记录（与 AC-188 判据同一读法）。
2. 新建 `plugin/scripts/long-term-guarantee-goal-backed-check.ts`：默认运行枚举已登记的长期保证，逐条核其在 goal 层有无 criterion AC 背书；存在未背书条目 ⇒ 枚举打印其 id 并 exit 1；全部背书 ⇒ exit 0。实现 `--inject-unbacked-fixture` 测试缝：注入一条「只有 task AC 背书的长期保证」后必须 exit 非零（负控制）。
3. 可证伪性（硬规则④）：背书记录读真实生产载体（goal-store list 真实输出、tasks/*.md 真实 AC），⛔ 不用 fixture 注入当正判断据；注入缝只用于负控制。登记形态须能区分「查过且合格」与「没查成」（硬规则③b），不得恒绿。
4. 注册：新 `plugin/scripts/*.ts` 触发 capability-catalog AC1c 闸（未声明 ⇒ exit 非零）——在 `plugin/scripts/capability-catalog.sh` 六表登记 question/cadence/invalidation/last_reaffirmed/matching/consumer；改 laydown 源后跑 `quay-init-closure-ratchet.ts --reanchor` 同步 baseline。（outline §6 快照已 2026-08-29 退役，不 bump。）
5. 写 `plugin/test/long-term-guarantee-goal-backed-check.test.mjs`：正控制（全背书 ⇒ exit 0）与负控制（注入未背书 ⇒ exit 非零）各至少一条断言。
6. 干跑 AC-190 判据确认 exit 0（脚本存在 + 真仓库绿 + 注入负控制红）；负控制：改动前已实测 exit 1（脚本不存在）。

## AC

- [x] AC-190 判据 exit 0：脚本存在、真仓库绿、`--inject-unbacked-fixture` 负控制红（同一条命令链全过）
- [x] 双向负控制（硬规则③b/④）：改动前干跑 exit 1（脚本不存在）已记录，完成前后读数相反 ⇒ 排除恒真/恒绿
- [x] 背书记录读真实生产载体（goal-store list 真实输出、tasks/*.md），⛔ 不用 fixture 注入当正判断据（注入缝只用于负控制）
- [x] `--inject-unbacked-fixture` 存在且注入后 exit 非零（⛔ 不接受只有单向断言的实现，AC-190 origin 逐字）
- [x] capability-catalog 六表登记：`bash plugin/scripts/capability-catalog.sh --summary` 未分类计数为 0
- [x] 测试覆盖正/负两向：`plugin/test/long-term-guarantee-goal-backed-check.test.mjs` 断言 exit 0 与 exit 非零各至少一条
- [x] `node packages/quay/bin/quay.ts task check gap-ac190-long-term-guarantee-goal-backed-check --json` 的 `missing` 为 `[]`

## DoD

`plugin/scripts/long-term-guarantee-goal-backed-check.ts` 真实存在于生产工作树，AC-190 判据在生产工作树上 exit 0（脚本存在 + 真仓库绿 + 注入未背书条目红）——不是靠 fixture 注入，而是脚本默认运行对真实 goal-store list / tasks/*.md 读出的真值判绿，`--inject-unbacked-fixture` 注入后判红。仅单向断言（只绿不红、或只红不绿）、或脚本只被 fixture 满足而生产上跑不出真值 ⇒ 不算完成。

## Touches

- plugin/scripts/long-term-guarantee-goal-backed-check.ts (new)
- plugin/test/long-term-guarantee-goal-backed-check.test.mjs (new)
- plugin/scripts/capability-catalog.sh
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-ac190-long-term-guarantee-goal-backed-check.md