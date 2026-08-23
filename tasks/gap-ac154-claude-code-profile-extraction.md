---
id: gap-ac154-claude-code-profile-extraction
title: AC154 Claude Code profile 抽层（profiles/roles 分离 + bare 单层 + unset 显式）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-worker-driver-no-record-on-abnormal-death
---

**type:** execution

## Proposal

**来源**：manager 2026-08-23 架构裁定（判据正本 `orchestration/manager-phase-goal.md` `### AC154`，⛔ 不在此复制；设计正本 `orchestration/SPEC-unified-driver-architecture-2026-08-23.md` §2.5）。

**缺口（三个，⛔ 缺口①已流过血）**：
```
① bare 两级且优先级无文档   ← AC142 记录 13/13 全败成因（fix-worker/selector bare:true 让 spawn 链 100% 失败）
② 无组合无继承              ← 三个 worker role 各自重复 launcher/model，「换模型」= 改三处
③ 寄生在 _launchSpec 下划线扩展键里  ← Claude Code 若校验未知键，整个启动面一起挂
```
⇒ 目标形态：`profiles`（可复用）与 `roles`（引用 profile）分离；`bare` 只在 profile 一层；`env` 取消继承显式表达为 `unset:[...]`（⛔ 非空字符串约定）；profile 有自己的承载文件，`launch.settings.json` 只留 Claude Code 认识的键。

**⊢ 排期注记**：本任务属下一阶段（架构地基），⛔ 现在只立案不派发——`depends_on` 即 SPEC §0 的排期锁（AC142 系列收口），不是输出依赖。

## Plan

1. `profiles`/`roles` 分离，`bare` 单层，`unset:[...]` 显式化。
2. profile 落到自己的承载文件（`.quay/profiles.yml` 或并入 `.quay/config.yml`，落笔方定）；`launch.settings.json` 移除 `_launchSpec`。
3. `quay-launch.sh` / `worker-driver.ts:launchArgv` 改消费 profile。

## Acceptance Criteria

判据正本在 `orchestration/manager-phase-goal.md` `### AC154`（⛔ 取假形态不在此复制）。

- [ ] AC1：`profiles`/`roles` 分离 + `bare` 单层 + `unset:[...]` 显式；取假见正本 AC154（bare 仍两级、换模型仍改三处以上、profile 仍寄生 `_launchSpec` ⇒ 假）。

## Definition of Done

- [ ] profile 抽层落地 + `_launchSpec` 移出 launch.settings.json；AC1 全勾；land 到 develop。

## Retires

- 无（`_launchSpec.roles` 雏形升级为独立 profile 承载）

## Touches

- .claude/launch.settings.json（移除 `_launchSpec`，只留 Claude Code 认识的键）
- .quay/profiles.yml（新：profiles + roles 承载；落笔方可并 .quay/config.yml）
- plugin/scripts/quay-launch.sh（经 jq 消费 profile 而非 `_launchSpec`）
- plugin/scripts/worker-driver.ts（launchArgv 消费 profile）
- plugin/test/launch-settings.test.mjs（test）
- plugin/test/worker-driver.test.mjs（test）
- tasks/gap-ac154-claude-code-profile-extraction.md（自身）
