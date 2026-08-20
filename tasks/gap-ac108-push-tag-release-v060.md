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

- [x] AC1: `git rev-list --left-right --count origin/develop...develop` → 0 0（推送完成）。
- [x] AC2: `git rev-parse v0.6.0` == `git rev-parse develop`（tag 与 develop 同提交）。
- [x] AC3: `gh release view v0.6.0 --json tagName,createdAt` → 存在且 createdAt 新于 2026-08-20（发布完成）。
- [x] AC4: release note 真实反映变更主题（674+ 条，非「若干修复」）。

## Definition of Done

- [x] 推送 + 打标 + 发布三者指向同一 commit（AC1-3）；release note 真实（AC4）。

## Evidence

- **tag sha**: `c5af42632326d79c082f38254189f7df8d5278ea`（v0.6.0 == develop == origin/develop，三指同一 commit）
- **release**: https://github.com/yaleh/quay/releases/tag/v0.6.0 — createdAt `2026-08-20T23:46:20Z`，publishedAt `2026-08-20T23:52:32Z`
- **AC1 实测**: `git rev-list --left-right --count origin/develop...develop` → `0 0`（push develop bab28666..c5af4263 后）
- **AC2 实测**: `git rev-parse v0.6.0` = `git rev-parse develop` = `c5af4263`
- **AC3 实测**: `gh release view v0.6.0 --json tagName,createdAt` → `{"createdAt":"2026-08-20T23:46:20Z","tagName":"v0.6.0"}`，新于切换时刻
- **AC4**: release note 77 行 / 7444 字符，真实反映 836 条变更（基线 674+）的主题：产品化链 AC104-109 + AC118/119、WebUI 15 视图 + Modernist token、fan-in-execute workflow（AC78 + pre-verified-suite）、suite 并发 SSOT + phase-overlap 默认开、checker/instrumentation 正确性、方法论硬规则（5b / C23 / A13 / inbox teardown）；非「若干修复」

## Touches

- .quay/productization-verification.jsonl（AC109 记录，本任务不含）
- tasks/gap-ac108-push-tag-release-v060.md（自身）
