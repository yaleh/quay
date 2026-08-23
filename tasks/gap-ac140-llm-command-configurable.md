---
id: gap-ac140-llm-command-configurable
title: AC140 可配 wrapper + model + 按 role（单一真相源 + 覆盖语义统一）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac140-llm-invocation-set-judgment
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC140`，提交 `38dd3294`，⛔ 不在此复制，读那一段）。

**缺口（四处硬编码，无单一真相源）**：`worker-driver.ts:247/708`、`promotion-driver.ts:187/190` 四处独立 `["claude","-p",prompt]`；全仓 model/wrapper 配置项零命中。

**两个覆盖旋钮语义相反（真正的阻塞点）**：promotion-driver `--fix-worker-cmd` =【前缀】（wrapper 可用 ✅）；worker-driver `--worker-cmd` =【整体替换】（wrapper 不可用 ❌，`:847` 证实任务 id 不出现在 argv 任何位置）。

## Plan

1. **单一真相源**：一个构造函数（role 作参数：worker 长任务链 / selector 短决策 / fix-worker 短编辑），消除四处硬编码。
2. **可配**：落 `.quay/config.yml` 第四段（沿用 DIR-050），wrapper + model + **按 role 分别可覆盖**。
3. **覆盖语义统一**：统一为「前缀 + prompt」（promotion 现行语义）；worker-driver 整体替换改名 `--worker-cmd-exact`（测试专用），⛔ 两种语义不共用一个 flag 名。

## Acceptance Criteria

- [ ] AC1（单一真相源）：`plugin/scripts/` 下不再有 ≥2 处独立 `["claude","-p",…]`（一个构造函数，role 参数）。
- [ ] AC2（可配）：wrapper + model + 按 role 分别可覆盖，落 `.quay/config.yml`；取假：配置了 wrapper 但驱动仍 spawn 裸 `claude` ⇒ 假。
- [ ] AC3（覆盖语义统一）：统一「前缀 + prompt」；整体替换语义改名 `--worker-cmd-exact`，⛔ 不与前缀语义共用一个 flag。

## Definition of Done

- [ ] 单一构造 + 可配 + 覆盖语义统一；AC1-3 全勾；land 到 develop。

## Retires

- `--worker-cmd` 的整体替换语义（改名 `--worker-cmd-exact`，测试专用）

## Touches

- plugin/scripts/worker-driver.ts（defaultWorkerArgv / defaultSelectorArgv 单一构造）
- plugin/scripts/promotion-driver.ts（buildFixWorkerArgv 单一构造）
- .quay/config.yml（第四段：driver.llm 配置，按 role）
- plugin/test/worker-driver.test.mjs（覆盖语义取假）
- tasks/gap-ac140-llm-command-configurable.md（自身）

> **注意**：与 AC139（承载/入口）Touches 零重叠，可并行派；配置面读同一份 `.quay/config.yml`。⛔ 不裁定具体 model——那是配置值由人/项目定，本条只要求可配且被真实使用。
