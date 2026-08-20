---
id: gap-ac108-push-tag-release-v060
title: AC108 推送+打标+发布 v0.6.0：三者指向同一提交（release note 真实反映 674+ 变更）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：当前阶段管线第 6 步。AC104（版本 bump）→ AC105（build tgz）→ AC106（dist-verify）→ AC107（跨主机）→ AC108（推送发布）→ AC109（记录）→ AC118/119（第三方验证）。AC104-107 + AC118/119 已 land。人裁定「AC104-109 落笔归属 outer（立案/驱动）」。

**判据正本**：`orchestration/manager-phase-goal.md` AC108（:70-79）。

**核心要求**：推送 + 打标 + 发布三者指向同一提交：
```
① git rev-list --left-right --count origin/develop...develop  →  0  0
② git rev-parse v0.6.0  ==  git rev-parse develop
③ gh release view v0.6.0 --json tagName,createdAt  →  存在且 createdAt 新于本次切换
```
**基线提醒**：切换时 `origin/develop..develop` = 103 未推；`v0.5.0..develop` = 674 ⇒ release note 必须真实反映这 674 条的主题，⛔ 不得只写「若干修复」。

**为什么 inner 执行**：git push + tag + gh release 操作产品发布 → inner 域。

## Plan

1. 确认 origin/develop 与 develop 同步（`git rev-list --left-right --count origin/develop...develop` → 0 0）。
2. `git tag v0.6.0` + push tag。
3. `gh release create v0.6.0`，release note 真实反映 674+ 条变更主题。

## Acceptance Criteria

- [ ] AC1: `git rev-list --left-right --count origin/develop...develop` → 0 0（推送完成）。
- [ ] AC2: `git rev-parse v0.6.0` == `git rev-parse develop`（tag 与 develop 同提交）。
- [ ] AC3: `gh release view v0.6.0 --json tagName,createdAt` → 存在且 createdAt 新于 2026-08-20（发布完成）。
- [ ] AC4: release note 真实反映变更主题（674+ 条，非「若干修复」）。

## Definition of Done

- [ ] 推送 + 打标 + 发布三者指向同一 commit（AC1-3）；release note 真实（AC4）。

## Touches

- .quay/productization-verification.jsonl（AC109 记录，本任务不含）
- tasks/gap-ac108-push-tag-release-v060.md（自身）
