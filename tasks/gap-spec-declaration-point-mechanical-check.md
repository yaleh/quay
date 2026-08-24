---
id: gap-spec-declaration-point-mechanical-check
title: SPEC 声明点无机械保证（每个 orchestration/SPEC-*.md 须在全部已知声明点出现，声明点集合 grep 派生非硬编码）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-23 硬规则 5b 穷举自查（今天三连红同形）。

**现象（今天一天同形三次）**：
```
① manager bdf8b13d 立 SPEC-unified-driver-architecture 漏 manager/SKILL.md 索引 ⇒ AC6 红
② outer 01d4f4e8 补 manager 索引但漏 init/SKILL.md reference-doc 声明 ⇒ referenced-not-landed 红
③ 若有第三个声明点消费者，同样的红会再来一次
```

**根因**：SPEC 声明点当前【恰好两处】——`plugin/skills/manager/SKILL.md`（索引）+ `plugin/skills/init/SKILL.md`（reference-doc）。但这个「两处」是**手数的**（`grep -rln "orchestration/SPEC-"`），**不是机件保证的**——下次谁新增第三个消费者，同样的漏声明红会重演，且漏的人可能像我一样补一处漏一处（硬规则 5b）。

**影响**：每次立 SPEC 都靠「想起来去同步两处」的意志，漏了就是全库红 + 烧 worker 墙钟（今天三条红烧了 ~100min）。

## Plan

1. 造一个 checker：每个 `orchestration/SPEC-*.md` 必须在【全部已知声明点】出现。
2. **声明点集合由 grep 派生**（⛔ 非硬编码——硬编码「两处」会随消费者增删漂移，正是本条要防的形态）。

## Acceptance Criteria

- [x] AC1：新增 `orchestration/SPEC-*.md` 而漏任一声明点 ⇒ checker 红（⛔ 三连红同形再现 ⇒ 假）。
- [x] AC2：声明点集合是 grep 派生的（⛔ 硬编码「两处」⇒ 假）。

## Definition of Done

- [x] SPEC 声明点机械检查落地 + 新增 SPEC 漏声明可被红；AC1-2 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/spec-declaration-point-check.ts
- plugin/test/spec-declaration-point-check.test.mjs
- plugin/scripts/runner-static-gate.ts（注册进 run_static_checks）
- plugin/scripts/checker-mutation-cases/spec-declaration-point-check.sh（mutation case，checker-mutation-check AC1b 强制）
- plugin/scripts/capability-catalog.sh（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER 六字段，AC1b 入口闸强制）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照 scripts 282→283，delivery-inventory-drift-gate 强制）
- tasks/gap-spec-declaration-point-mechanical-check.md（自身）
