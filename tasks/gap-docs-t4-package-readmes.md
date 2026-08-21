---
id: gap-docs-t4-package-readmes
title: T4 补 quay-native/quay-github 两包 README（npm 页面空白）+ 修 quay README serve 节
status: ready
labels:
  - gap
  - docs
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：manager 2026-08-21 01:0xZ 产品化交付文档审计（人明令检查 + 立案）。缺口 T4：补两个包的 README。

**缺口**：`ls packages/*/README.md` 只有 1 个。根 README `:20-21` 表格把三个包（quay/quay-native/quay-github）并列并链到目录，点进去没 README——**两个包的 npm 页面将是空白**。同任务顺带修 `packages/quay/README.md:327` 的 serve 节（漏 `--host`、只描述 2/15 视图）。

**为什么 inner 执行**：README 属产品文档（仓库交付面）→ inner 域。

## Plan

1. 新建 `packages/quay-native/README.md`（描述 native provider：markdown+YAML 任务存储、tasks/*.md 即数据、provider ABI 角色）。
2. 新建 `packages/quay-github/README.md`（描述 github provider：GitHub Issues 映射到 task view-model，证明 ABI 可迁移）。
3. 修 `packages/quay/README.md:327` serve 节（补 `--host`、描述全部 15 视图而非 2）。
4. 验证：`ls packages/*/README.md` = 3。

## Acceptance Criteria

- [ ] AC1: `ls packages/quay-native/README.md packages/quay-github/README.md` 均存在（npm 页面不再空白）。
- [ ] AC2: 两包 README 描述各自 provider 的角色与数据形态（quay-native = tasks/*.md 存储；quay-github = Issues 映射）。
- [ ] AC3: `packages/quay/README.md:327` serve 节已补 `--host` + 全视图描述。
- [ ] AC4: 全量 suite 绿。

## Definition of Done

- [ ] 三个包各有 README（真实文件存在）；quay-native/quay-github 描述各自 provider；serve 节已修。

## Touches

- packages/quay-native/README.md（新建）
- packages/quay-github/README.md（新建）
- packages/quay/README.md（serve 节修）
- tasks/gap-docs-t4-package-readmes.md（自身）
