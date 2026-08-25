---
id: gap-ac154-claude-code-profile-extraction
title: AC154 Claude Code profile 抽层（profiles/roles 分离 + bare 单层 + unset 显式）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-worker-driver-no-record-on-abnormal-death
  - gap-ac141-execution-face-inner-manual-retirement
  - gap-direct-to-develop-check-reflog-to-revlist
  - gap-git-history-branch-summary-wrong-numbers
  - gap-launch-script-worker-cap-broken
---

**type:** execution

## Proposal

**来源**：manager 2026-08-23 架构裁定（判据正本 `orchestration/manager-phase-goal.md` `### AC154`，⛔ 不在此复制；设计正本 `orchestration/SPEC-unified-driver-architecture-2026-08-23.md` §2.5）。

**缺口（三个，⛔ 缺口①已流过血）**：
```
① bare 两级且优先级无文档   ← AC142 记录 13/13 全败成因（fix-worker/selector bare:true 让 spawn 链 100% 失败）
② 无组合无继承              ← 三个 worker role 各自重复 launcher/model，「换模型」= 改三处
③ 寄生在 _launchSpec 下划线扩展键里  ← Claude Code 若校验未知键，整个启动面一起挂；且**归属就错了**（SPEC 第四轮 §12）——那是 quay 的配置，不该住在 Claude Code 的文件里（类比：Provider 声明在 `.quay/config.yml` 而非寄生别处）
```
⇒ 目标形态：`profiles`（可复用）与 `roles`（引用 profile）分离；`bare` 只在 profile 一层；`env` 取消继承显式表达为 `unset:[...]`（⛔ 非空字符串约定）；profile 有自己的承载文件，`launch.settings.json` 只留 Claude Code 认识的键。

**⊢ 排期注记**：本任务属下一阶段（架构地基），⛔ 现在只立案不派发——`depends_on` 即 SPEC §0 的排期锁（AC142 系列收口），不是输出依赖。

## Plan

1. `profiles`/`roles` 分离，`bare` 单层，`unset:[...]` 显式化。
2. profile 落到自己的承载文件（`.quay/profiles.yml` 或并入 `.quay/config.yml`，落笔方定）；`launch.settings.json` 移除 `_launchSpec`。
3. `quay-launch.sh` / `worker-driver.ts:launchArgv` 改消费 profile。

## Acceptance Criteria

判据正本在 `orchestration/manager-phase-goal.md` `### AC154`（⛔ 取假形态不在此复制）。

- [x] AC1：`profiles`/`roles` 分离 + `bare` 单层 + `unset:[...]` 显式；取假见正本 AC154（bare 仍两级、换模型仍改三处以上、profile 仍寄生 `_launchSpec` ⇒ 假）。

## Definition of Done

- [x] profile 抽层落地 + `_launchSpec` 移出 launch.settings.json；AC1 全勾；land 到 develop。

## Retires

- 无（`_launchSpec.roles` 雏形升级为独立 profile 承载）

## Touches

- .claude/launch.settings.json（移除 `_launchSpec`，只留 Claude Code 认识的键）
- .quay/profiles.yml（profiles + roles + flag-only 参数承载，加 excludeDynamicSystemPromptSections/promptSuggestions）
- plugin/.claude/launch.settings.json（出厂 fallback，移除 `_launchSpec`）
- plugin/.quay/profiles.yml（新：出厂 fallback profile 承载）
- plugin/scripts/quay-launch.sh（经 python3+yaml 消费 profile 而非 `_launchSpec`）
- plugin/scripts/manager-start.sh（会话名读 profiles.yml roles.manager.name）
- plugin/scripts/worker-driver.ts（注释：`_launchSpec` → profiles.yml）
- plugin/scripts/promotion-driver.ts（注释：`_launchSpec` → profiles.yml）
- plugin/scripts/quay-init.sh（铺 `.quay/profiles.yml` + state/commit 清单）
- plugin/scripts/verify-delivery-surface.ts（launch-config 交付物 + criterion）
- packages/quay/src/init.ts（模板去 `_launchSpec` + generateProfilesContent + 铺 profiles.yml）
- packages/quay/src/cli/init.ts（dry-run/written 输出 profiles.yml）
- packages/quay-native/bin/quay-native.ts（dry-run/written 输出 profiles.yml）
- orchestration/SPEC-complete-delivery-surface-2026-08-05.md（launch-config 交付物 + marker）
- plugin/test/launch-settings.test.mjs（test：改读 profiles.yml）
- plugin/test/worker-driver.test.mjs（test：AC140-2 改读 profiles.yml）
- plugin/test/manager-layer-skill.test.mjs（test：AC4 改读 profiles.yml）
- plugin/test/manager-layer-shipping.test.mjs（test：AC4 改读 profiles.yml）
- plugin/test/manager-install-vector.test.mjs（test：stagePack 铺 .quay）
- plugin/test/quay-init.test.mjs（test：AC2-launch 改读 profiles.yml）
- plugin/test/l1-delivery-surface-check.test.mjs（test：fixture 铺 profiles.yml）
- packages/quay/test/init.test.mjs（test：改断言 profiles.yml）
- tasks/gap-ac154-claude-code-profile-extraction.md（自身）
