---
id: gap-conflict-outline-half-only-in-prompt-prose
title: outline 文档冲突规则只在 prompts 散文里：isTickDoc 只匹配
  orchestration/*-tick-core.md，outline 落到 manual，机械消解半边缺失
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**atom W8**：outline/tick doc 冲突直接取 develop、不 hand-merge。

**carrier**：`code`（只有 tick 半边；outline 半边只在散文）。

**carrierRef 目标**：`plugin/scripts/conflict-resolution-rules.ts:71-74`。

**负臂读数（现在，已实测）**：`isTickDoc` 的正则是 `^orchestration/[^/]*-tick-core\.md$`，因此 `conflictAction('docs/proposals/quay-product-outline.md','UU')` 返回 `manual`；outline 规则只存在于 `plugin/scripts/worker-driver.ts:2971` 的 prompt 字符串（`(1) outline doc … take the develop version`）。⇒ 同一个「取 develop 版」语义有机械与散文两份，散文那份没有执行承接，而这正是上一轮 `gap-arbitrary-semantics-unenforced-carriers` AC2 所属的同一形态。

**D 收缩预期**：W8 fresh→stale（⛔ 不作验收）。

## Plan

1. **不要**把 outline 路径塞进 `isTickDoc`——函数名会覆盖它不表示的东西。改为注册表：`TAKE_DEVELOP_DOC_PATTERNS = [/^orchestration\/[^/]*-tick-core\.md$/, /^docs\/proposals\/quay-product-outline\.md$/]` + `export function isTakeDevelopDoc(rel: string): boolean`；`isTickDoc` 保留为其中的命名子集（既有读者/测试不动）。
2. `conflictAction` 的 `take-develop` 分支改调 `isTakeDevelopDoc`，reason 要能指出命中的是哪条规则。
3. **单一真源**：`worker-driver.ts:2971` 的 prompt 文案改为从同一注册表渲染（import 该模块），⛔ 不得再手写一份路径列表。
4. 机械半边确认：`resolveConflictMechanically` 的 `take-develop` 分支（`:144-148`）确实执行 `git checkout develop -- <rel>`；测试要断言真执行，不只是 `conflictAction` 的返回值。

## Acceptance Criteria

- [ ] AC1: 负臂→正臂翻转——改前 `conflictAction('docs/proposals/quay-product-outline.md','UU').kind === "manual"`（给出逐字读数）；改后为 `"take-develop"`，且 `isTickDoc` 对 tick-core 仍为 true、对 outline 仍为 **false**（名字不漂移，单独断言）。
- [ ] AC2: `resolveConflictMechanically` 对 outline 真跑 `git checkout develop -- docs/proposals/quay-product-outline.md`——测试用一个真 git 仓库夹具断言文件内容变回 develop 版（⛔ 不是断言返回字符串）。
- [ ] AC3: prompt 与机械规则同源——`grep -c 'quay-product-outline' plugin/scripts/worker-driver.ts` = **0**（prompt 从注册表渲染，worker-driver 不再持有字面量）；`grep -rn 'quay-product-outline' plugin/scripts/` = **1**（唯一命中的是 `conflict-resolution-rules.ts` 的注册表）；负臂：删除注册表中 outline 那一行后，`conflictAction('docs/proposals/quay-product-outline.md','UU')` 回到 `manual` **且**生成的 prompt 不再含 outline 规则（两侧同时变化）——给出两处逐字读数。

## Definition of Done

- 三条 AC 勾选并附逐字读数。
- `scripts/test.sh --for-task gap-conflict-outline-half-only-in-prompt-prose` 绿；全量 suite 不回归。
- 注册表是唯一来源：`grep -rn 'quay-product-outline' plugin/scripts/` 只命中注册表一处（给出计数）。
- ⛔ 完成证据中不得出现「|D| 下降」。

## Touches

- plugin/scripts/conflict-resolution-rules.ts
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver-resident-s07.test.mjs
- tasks/gap-conflict-outline-half-only-in-prompt-prose.md
