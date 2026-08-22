---
id: gap-release-v061-readme-changelog-drift
title: v0.6.1 发布后 README/CHANGELOG 文档漂移（交付面不一致，安装示例仍 0.6.0、CHANGELOG 无 v0.6.1 条目）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：人 2026-08-22 明令投 outer 立案 + manager 实测核实（非推理）。

**证据（能取假）**：release bump `a388ca38`（08-21 14:49Z，人令②发布 v0.6.1）只动了 9 个机器版本文件，`version-consistency-check: All 8 files carry 0.6.1` 是那 8 个机器字段，**不含散文文档**：
- **README.md 仍 0.6.0**：`grep -c '0.6.1'` = 0；安装示例 :76/:128/:613 仍 `quay-0.6.0.tgz` / `quay-sea-0.6.0-linux-x64.tar.gz`。
- **CHANGELOG.md 无 v0.6.1 条目**：`grep -c '0.6.1'` = 0；最新条目 `## v0.6.0 (2026-08-20)`。`docs-t1-changelog-backfill` 补的是 v0.6.0，v0.6.1 从未写。

**正确落盘（对照组，非全漏）**：19 张 `docs/images/webui-*.png` + `docs/webui-guide.md`（204 行）+ 3 张跨项目 `docs/evidence/ac118-screenshots/meta-cc-*.png` 已落地。

**为什么 inner 执行**：改 README/CHANGELOG 文档（交付面）属产品文档 → inner 域。

## Plan

1. README.md 安装示例版本 0.6.0 → 0.6.1（或改 `<version>` 占位，防下轮同漂移）。
2. CHANGELOG.md 补 `## v0.6.1 (2026-08-21)` 条目（内容 = 人令② release 所包：T1–T5 文档、AC107 修复判据重验、AC118 跨项目截图、134+ 提交）。
3. 机械核：README/CHANGELOG 出现 0.6.1 且 `version-consistency-check` 仍绿（不引入新的 8 处漂移）。
4. fan-in（AC78 workflow）land。

## Acceptance Criteria

- [x] AC1: README.md 安装示例版本更新（0.6.0→0.6.1 或 `<version>` 占位），`grep '0.6.0'` 安装示例处不再出现旧版本号。
- [x] AC2: CHANGELOG.md 有 `## v0.6.1` 条目，内容覆盖人令② release 范围（T1–T5 / AC107 重验 / AC118 截图 / 134+ 提交）。
- [x] AC3: `version-consistency-check` 仍 `All 8 files carry 0.6.1`（不引入新的 8 处漂移）。

## Definition of Done

- [ ] README/CHANGELOG 版本同步 0.6.1 + version-consistency 仍绿；AC1-3 全勾；land 到 develop。

## Touches

- README.md（安装示例版本）
- CHANGELOG.md（补 v0.6.1 条目）
- tasks/gap-release-v061-readme-changelog-drift.md（自身）
