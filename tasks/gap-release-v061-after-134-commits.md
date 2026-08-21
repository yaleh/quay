---
id: gap-release-v061-after-134-commits
title: 发布 v0.6.1（build tgz + tag + gh release，release 真正包含 develop 领先 v0.6.0 的 134+ 提交：文档 T1-T5 + AC107 重验 + 跨项目截图）
status: todo
labels:
  - gap
---

## Proposal

**来源**：人 2026-08-21 14:1xZ 原话（manager 转达执行，不要解释）：「develop 当前领先已发布 v0.6.0（tag c5af4263）129+ 个提交，①落地后 build + tag + 发布一个新版本，让 release 真正包含最近这批更新（文档 T1-T5 + AC107 重验 + 本次①）」。

**背景**：`git rev-list --count v0.6.0..develop` = **134**（人令说 129+，实际 134，随跨项目截图 land 会更多）。当前 v0.6.0 release 标在 c5af4263（2026-08-20 23:46Z），其后的所有文档更新（T1-T5）、AC107 修复版判据重验、anti-drift Touches 修复等**完全不在 release 中**。本次发布 v0.6.1 让 release 真正包含这批更新。

**判据**（能取假，同 AC108 三相等 + 版本一致性）：

1. 推送 + 打标 + 发布三者指向同一提交：`git rev-list --left-right --count origin/develop...develop` → `0  0`（先同步）。
2. `git rev-parse v0.6.1` == `git rev-parse develop`（tag 指向发布提交）。
3. `gh release view v0.6.1 --json tagName,createdAt` → 存在且 createdAt 新于本任务立案。
4. 版本 bump 一致：`node --experimental-strip-types scripts/version-consistency-check.ts` 输出 `All 8 files carry version 0.6.1`，且 `plugin/VERSION` 同步 bump（AC104 已修检查器缺口，bump 必须含 plugin/VERSION）。
5. release note 真实反映 134+ 条变更主题（⛔ 不得只写「若干修复」——AC108 基线提醒）。

**⛔ 前置依赖**：`gap-ac118-ac119-cross-project-pixel-screenshots` land（①跨项目截图完成后 release 才包含它）。

**为什么 inner 执行**：git push + tag + gh release 操作产品发布 + 版本 bump 是 inner 域（AC104/AC108 同构）。

## Plan

1. 前置确认：跨项目截图任务 land 后，`git rev-list --count v0.6.0..develop` 复核（应 >134）。
2. 版本 bump：8 处版本字段 0.6.0 → 0.6.1 + `plugin/VERSION`；跑 `version-consistency-check.ts` 确认 `All 8 files carry version 0.6.1`。
3. 确认 origin/develop 与 develop 同步（`0 0`）。
4. `git tag v0.6.1` + push tag。
5. `gh release create v0.6.1`，release note 真实反映 134+ 条变更主题。
6. 写记录进 `.quay/productization-verification.jsonl`（ac="AC108" 追加行，含 tag/commit/createdAt）。

## AC

- [ ] AC1: `version-consistency-check.ts` 输出 `All 8 files carry version 0.6.1` + `plugin/VERSION` 同步（非手动逐个改而不跑检查器）。
- [ ] AC2: `git rev-list --left-right --count origin/develop...develop` → `0  0`；`git rev-parse v0.6.1` == `git rev-parse develop`。
- [ ] AC3: `gh release view v0.6.1 --json tagName,createdAt` 存在且 createdAt 新于本任务立案。
- [ ] AC4: release note 真实反映 134+ 条变更主题（T1-T5 文档 + AC107 重验 + 跨项目截图 + anti-drift 修复等，非「若干修复」）。
- [ ] AC5: 记录写入 `.quay/productization-verification.jsonl`（ac=AC108 追加行，含 tag v0.6.1/commit sha/createdAt，ok=true）。

## DoD

- [ ] v0.6.1 release 存在且 tag 指向 develop，release note 覆盖 134+ 提交主题，jsonl 有对应记录；AC1-5 全勾。

## Touches

- packages/quay/package.json（版本）
- packages/quay-native/package.json（版本）
- packages/quay-github/package.json（版本）
- packages/quay-backlog/package.json（版本）
- plugin/VERSION（版本——sync.sh 明定须随版本 bump）
- scripts/version-consistency-check.ts（若检查器需要同步——AC104 缺口已修，仅当发现新缺口）
- .quay/productization-verification.jsonl（记录）
- tasks/gap-release-v061-after-134-commits.md（自身）
