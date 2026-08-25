---
id: gap-readdepends-on-indented-extra-depends-on
title: "readDependsOn 认不到 extra: 缩进下的 depends_on——10 条任务依赖读不到 ⇒ 无效派发"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`plugin/scripts/task-schema.ts:211-223` 的 `readDependsOn`——flow 形态正则 `^depends_on:\s*\[...\]\s*$/m` 和 block 形态扫描 `lines.findIndex(l => /^depends_on:\s*$/.test(l))` **都是列 0 锚定**，读不到缩进在 `extra:` 下的 `depends_on:` 形态。当场核实：`tasks/*.md` 正好 **10 条**命中 `grep -lE '^\s+depends_on:\s*$'`，含已 done 的 `gap-fan-in-ff-livelock-quiet-window-no-consumer`（落地过程可能受过影响）+ 在飞的 `gap-webui-message-delivery-entry` 等。

**生产实例**：`gap-profile-policy-when-which-profile` 的 worker 会话（21:10Z，session 027cc6eb）被派发后 11 分钟内发现其依赖 `gap-ac154-claude-code-profile-extraction` 根本没合进 develop，正确停手退出——这条依赖正是缩进在 `extra:` 下、调度层读不到才把它派了出去。

## Plan

`readDependsOn` 认到缩进形态（`extra:` 下的 `depends_on:`），flow + block 两种形态都支持列 0 或缩进。

## Acceptance Criteria

- [ ] AC1（能取假，缩进形态可读）：`readDependsOn` 认到 `extra:` 缩进下的 `depends_on`（10 条命中任务都能被读到）；（⛔ 缩进形态仍读不到 ⇒ 假）。
- [ ] AC2（能取假，派发前依赖生效）：dep 未合入 develop 的任务不被派发（调度层读到依赖）；（⛔ dep 未合入仍被派发 ⇒ 假）。

## Definition of Done

`readDependsOn` 读缩进 `depends_on`；AC1-2 全勾；无效派发消除（范围清楚、无权衡）。

## Touches

- experiments/quay-perpetual-stream/scripts/task-schema.ts（readDependsOn flow + block 两形态，canonical 源）
- plugin/scripts/task-schema.ts（vendored mirror，sync-vendor 镜像同步）
- experiments/quay-perpetual-stream/test/task-schema.test.mjs（对应测试，含缩进形态样本）
- tasks/gap-readdepends-on-indented-extra-depends-on.md（自身）