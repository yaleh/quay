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

- [ ] AC1: 四处版本号一致（marketplace.json / plugin.json / VERSION / package.json，一条命令可查）。
- [ ] AC2: `/plugin install` 链要么在 develop 流程上有真实可触发的路径且真跑过一次（新于本次切换），
      要么显式退役并从 marketplace.json 移除误导性 source 声明——二选一达成。
- [ ] AC3: 不留「从不触发的链」（硬规则③布尔化反例）。

## Definition of Done

- [ ] 两条分发链版本一致；/plugin install 链可触发或已显式退役，无误导性声明残留。

## Touches

- .claude-plugin/marketplace.json
- plugin/.claude-plugin/plugin.json / plugin/VERSION / packages/quay/package.json（版本统一）
- .github/workflows/publish-plugin-dist.yml（触发路径或退役）
- tasks/gap-ac93-dist-chains-version-consistency.md（自身）
