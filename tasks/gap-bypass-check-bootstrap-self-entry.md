---
id: gap-bypass-check-bootstrap-self-entry
title: "bypass-check 登记豁免的机件自身触发红——ruled 表每加一条必改 checker 代码面（发生率 4/4=100% 按构造）"
status: superseded
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

**来源**：manager 2026-08-16 19:1xZ（发生率给数 + 结构证明）。

**结构事实（读 checker 实现核实）**：
- 每往 `RULED_HISTORICAL_COMMITS` 表加一条，都必须改 `plugin/scripts/direct-to-develop-bypass-check.ts`
- 该文件在 checker 自己的分类里属【代码/断言面】（`:33` 明写含 `plugin/scripts/*`）
- ⇒ 登记动作本身永远触发红。**发生率不是"2 次"，是 100%，按构造**。
- 已发生 4 次（表里 4 条：cddc55e2 / f9577da1 / 08e8ec55 / f70507b6），第 5 条会一样。

**已被解过一次（同一文件 `:31-32` 注释）**：作者当时为 `plugin/scripts/fan-in-*` 开了「引导问题（bootstrap）」排除
（机制坏了无法 self-fan-in），但**没意识到【记录豁免的机件自己】是同一类**——同一份文件、同一个理由、
覆盖面漏了一个。与我今天两次自纠同形：一个想明白的原则只落实到它被发现的那一处。

## Acceptance Criteria

- [ ] AC1: `direct-to-develop-bypass-check.ts` 自身纳入「引导问题」排除——**判据必须窄**：
      只豁免「该提交的唯一改动是给 `RULED_HISTORICAL_COMMITS` **追加**条目」。
      **取假**：构造一条改该文件【判定逻辑】的直提 ⇒ 必须仍红。
- [ ] AC2: ⛔ 不豁免对该文件的任意改动（否则等于给 checker 开后门——「改 checker 的人自己给自己发通行证」）。
      **若做不到那么窄的判据，宁可保留现状**（每次登记红一次、走 fan-in），⛔ 不开宽豁免。
- [ ] AC3: 豁免落成可 `git log` 追溯的提交 + 测试（负控制 = 判定逻辑改动仍红）。

## Definition of Done

- [ ] 引导问题排除覆盖 checker 自身（窄判据：仅追加条目），判定逻辑改动仍红，登记不再自触发红。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（引导问题排除 + 窄判据）
- plugin/test/direct-to-develop-bypass-check.test.mjs（负控制：判定逻辑改动仍红）
- tasks/gap-bypass-check-bootstrap-self-entry.md（自身）

**superseded（2026-08-16 19:5xZ，inner 判定 + manager 自纠）**：前提「ruled 登记按构造必然触发红」被 fan-in 对照证否——gap-bypass-ruled-table-self-entry 的 8d773bbb 证明登记可经 fan-in 正规 land（worktree 含登记 ⇒ suite 过 ⇒ land，checker 只查直提不查 fan-in 落地）。登记走 fan-in 已是足够解法，窄豁免是 gameability 风险（改 checker 的人自给通行证）且无结构需要。manager 19:1xZ 承认结构论证错（4/4 是相关不是必然，未做「能否走 fan-in」的对照）。
