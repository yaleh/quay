---
id: gap-ac93-dist-chains-version-consistency
title: "AC93: 两条分发链版本一致（3:1 不一致），且 /plugin install 链在 develop 流程上可触发或显式退役"
status: ready
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

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` 「🆕 AC90–AC93」区块 → `### AC93`。

**实测（manager 已跑过，一条命令可复算）**：
```
.claude-plugin/marketplace.json   version = 0.3.13   ← /plugin install 实际拉的版本号
plugin/.claude-plugin/plugin.json version = 0.4.0
plugin/VERSION                            0.4.0
packages/quay/package.json        version = 0.4.0
publish-plugin-dist.yml 唯一触发 = `v*` tag 推送；最后一个 v* tag = v0.4.0，打于 2026-08-06
release_ahead_commits = **3828**（2026-08-16 outer 实测 `git rev-list --count v0.4.0..develop`，
manager 原报 3824 已更新为实测值）
```
**⇒ 与 AC86 同形的结构性缺口**：dist-plugin 链的触发条件（`v*` tag）在当前 develop 三层流程里
**从不发生**，所以 `/plugin install` 拿到的树落后 develop **3828 个提交**，而 marketplace 还声明着
一个更老的版本号。

## Plan

> **排期建议（非前置，depends_on 已拆，manager 2026-08-16 裁定）**：建议在 AC91 land 之后做
> （派发顺序，人手执行）；无真前置——版本号一致是独立的一命令级修，不需要先有漂移闸或引用解析。

1. 核对四处版本号（一条命令可查，现状 3:1 不一致）。
2. `/plugin install` 链**二选一**：
   - ① 在 develop 流程上有真实可触发的路径且真跑过一次（时间新于本次切换）；或
   - ② 显式记为退役，并从 `.claude-plugin/marketplace.json` 移除误导性的 source 声明。
3. ⛔ 二选一，不接受「保留一个从不触发的链」（那是硬规则③的布尔化：留着看起来有，实际没有）。

## Acceptance Criteria

- [x] AC1: 四处版本号一致（marketplace.json / plugin.json / VERSION / package.json，一条命令可查）。
- [x] AC2: `/plugin install` 链要么在 develop 流程上有真实可触发的路径且真跑过一次（新于本次切换），
      要么显式退役并从 marketplace.json 移除误导性 source 声明——二选一达成。
- [x] AC3: 不留「从不触发的链」（硬规则③布尔化反例）。

## Definition of Done

- [x] 两条分发链版本一致；/plugin install 链可触发或已显式退役，无误导性声明残留。

## Evidence

**选①：让 `/plugin install` 链在 develop 流程上真实可触发并真跑过一次**（不退役——`/plugin install quay`
是 README 文档化的安装通道 Option C，退役会破坏真实功能；且与 AC86/90/91/92「让交付链变真」同向）。

- **AC1（四处版本号一致，一条命令可查）**：`.claude-plugin/marketplace.json`（0.3.13→0.4.0）、
  `plugin/.claude-plugin/plugin.json`（0.4.0）、`plugin/VERSION`（0.4.0）、`packages/quay/package.json`
  （0.4.0）四处统一到 **0.4.0**。复算：
  `node --experimental-strip-types scripts/version-consistency-check.ts` → `VERSION-CONSISTENCY: OK`，
  `All 8 files carry version 0.4.0`（exit 0）。该 check 覆盖 8 个版本文件（含 quay-native/github/backlog、
  plugin/.claude-plugin/marketplace.json、plugin/vendor/quay/package.json），故 CI 的 version-consistency
  闸一并从红转绿——v0.4.0 发布时漏 bump 的 quay-native|github|backlog 也统一到 0.4.0。
  `scripts/version-consistency-check.test.ts` 9/9 绿（含「real tree post-unification GREEN」两条真仓断言）。
- **AC2（develop 流程有真实可触发的路径，且真跑过一次——新于 2026-08-06 切换）**：
  ① 路径：`.github/workflows/publish-plugin-dist.yml` 新增 `push: branches: [develop]`（path 过滤到
  `plugin/**` `packages/**` `.claude-plugin/**` `package.json` `package-lock.json`，telemetry/task/
  orchestration 推送不重建；保留 `v*` tag + `workflow_dispatch`）。develop 三层流程的推送即触发，
  不再依赖从不发生的 `v*` tag。
  ② 真跑过一次：`gh workflow run "Publish plugin dist" --ref task/gap-ac93-dist-chains-version-consistency`
  → run **31938108719**（workflow_dispatch，head 9d32f51a，conclusion **success**，2026-08-16 09:05Z）。
  产物：`origin/dist-plugin` 由 `686a68b7`（2026-08-06，10 天前）force-update 到
  **`15918262`（2026-08-16 09:05:27Z, "dist-plugin: build from 9d32f51"）**。该分支的
  `.claude-plugin/marketplace.json` 与 `.claude-plugin/plugin.json` 现在都声明 **0.4.0**
  （此前 marketplace.json 是误导性的 0.3.13）。复算：`gh run view 31938108719 --json status,conclusion`。
  任务 fan-in 到 develop 后（touch `.claude-plugin/` + `packages/` + `plugin/`，均命中 paths 过滤），
  `push: branches: [develop]` 触发会再跑一次，把 dist-plugin 从 develop HEAD 重建。
- **AC3（不留「从不触发的链」）**：原链触发条件 = 仅 `v*` tag（三层流程从不打 tag ⇒ 从不触发，
  `/plugin install` 拿到落后 develop 3828 commits 的树）。现链触发条件 = `v*` tag ∨ develop 代码推送
  ∨ workflow_dispatch，且已实测跑过一次（run 31938108719 success）。硬规则③布尔化反例被消除——
  链留着、有真实触发路径、且被证明会执行并产出新 dist-plugin。

## Touches

- .claude-plugin/marketplace.json
- plugin/.claude-plugin/plugin.json / plugin/VERSION / packages/quay/package.json（版本统一）
- .github/workflows/publish-plugin-dist.yml（触发路径或退役）
- tasks/gap-ac93-dist-chains-version-consistency.md（自身）
