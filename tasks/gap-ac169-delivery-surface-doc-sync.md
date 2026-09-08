---
id: gap-ac169-delivery-surface-doc-sync
title: AC169 判据仍红——plugin/README.md:3 仍写陈旧 v0.4.0，应同步 plugin.json 当前版本 v0.6.1
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-169
---
## Proposal

**问题（立案当轮实测）**：`goals/AC-169-delivery-surface-doc-sync.md`（status=active、goal=GOAL-003）判据现为 fail（`evidence.verdict=fail`、exit 1）。根因：`plugin/README.md:3` 散文仍写 `quay plugin v0.4.0 — …`，而 `plugin/.claude-plugin/plugin.json` 的 `version` 已是 `0.6.1`（实测 `python3 -c "import json;print(json.load(open('plugin/.claude-plugin/plugin.json'))['version'])"` = `0.6.1`）。AC-169 criterion 两半都不满足：`grep -q "v0.6.1" plugin/README.md` 落空（当前版本号缺失）∧ `grep -qE 'v0\.4\.0' plugin/README.md` 为真（陈旧版本号残留）。

**同形先例（非重复，不同文件）**：`gap-release-v061-readme-changelog-drift`（done）修的是**根 README.md + CHANGELOG.md** 的 v0.6.1 发布漂移，**未覆盖 `plugin/README.md`**；`gap-ac93-dist-chains-version-consistency`（done）对齐的是 marketplace.json / plugin.json / VERSION / package.json 四个机器字段，也不含 `plugin/README.md` 散文。本任务补上这最后一块散文版本漂移。

**修法**：把 `plugin/README.md:3` 的 `v0.4.0` 逐字改为 `v0.6.1`。⛔ 不能用 `<version>` 占位——criterion 是逐字 `grep "v$v"`（`$v` 来自 plugin.json），占位会让它永远落空。

## AC

- [x] AC1（AC-169 criterion 逐字 exit 0）：`v=$(python3 -c "import json;print(json.load(open('plugin/.claude-plugin/plugin.json'))['version'])") && grep -q "v$v" plugin/README.md && ! grep -qE 'v0\.4\.0' plugin/README.md && echo PASS`
- [x] AC2（陈旧版本号清零）：`grep -cE 'v0\.4\.0' plugin/README.md` 输出为 `0`
- [x] AC3（schema）：`node plugin/scripts/task-schema-check.ts tasks/gap-ac169-delivery-surface-doc-sync.md` exit 0

## DoD

`goals/AC-169-delivery-surface-doc-sync.md` criterion exit 0（`plugin/README.md` 含当前版本号 `v0.6.1` ∧ 不含陈旧 `v0.4.0`），goal-driver 下一轮 verdict 由 fail 转 pass（读 `.quay/goal-round.jsonl` 中 AC-169 的 verdict）。⛔ 只删 v0.4.0 不写当前版本号（`grep "v$v"` 落空）/ 用 `<version>` 占位替代逐字版本号 ⇒ 不算达成。

## Touches

- plugin/README.md
- tasks/gap-ac169-delivery-surface-doc-sync.md