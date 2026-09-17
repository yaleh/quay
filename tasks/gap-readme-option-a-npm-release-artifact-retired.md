---
id: gap-readme-option-a-npm-release-artifact-retired
title: README 把已被人裁定取消的 npm release 产物标为"推荐给大多数用户"的 Option A——直接违反"以 Claude Code
  plugin 为主"的明确裁定
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
**type:** execution

## Finding

用 meta-cc 查会话历史，确认存在两条互相印证的人的明确裁定，都要求以 Claude Code plugin 分发为主：

1. **GOAL-019 origin（2026-09-15，逐字）**：「②优先遵循 Claude Code plugin 分发和部署实践，在这一目标实现前不考虑 npm（除非 plugin 分发本身依赖 npm 机制）。」GOAL-019 本身（交付自足的 Claude Code plugin 渠道）status 已 `achieved`。

2. **`.github/workflows/release.yml:6-8`（2026-09-16 裁定，逐字，代码注释里原样留存）**：
   > 「取消 sea 和 npm release。这些是我们最近没有精力去保障的。」
   > 「按照 claude code plugin 发布和安装。CI 应当按此设计。」

   （meta-cc 会话记录里同一天还有一句更早的表述：「我们说过，优先保障 claude code plugin 的 ci 和发布」，2026-09-16T08:48:59Z，在一次 SEA release 出错时说的。）

**实现侧已经落实了这条裁定**：`release.yml` 现在不再构建 npm-pack tarball 或 Node-SEA 可执行文件（该文件头注释自己写明"这五个job已经删掉"），gate `master` 的唯一渠道是 Claude Code plugin 渠道。**实测验证**：`gh release view v0.9.0`（最新发布）**零 assets**——没有 `.tgz`，没有 SEA 二进制，只是一个纯标记性 GitHub Release。

**但 README.md 完全没有跟上这条裁定**：

- README:68 `### Option A — global install from a release artifact (recommended for most users)`——**仍然把这条已被人明确取消的渠道标注为"推荐给大多数用户"，且排在三个安装选项的第一位**。
- 该节的指令（`npm install -g quay-<version>.tgz`）引用的"release artifact"**已经不存在**——GitHub Release 不再附带任何 `.tgz`。按 README 现在的说法，一个新用户读了 Option A 会去 GitHub Releases 找一个根本不会出现的文件。
- README 全文没有任何地方提到 2026-09-16 的这条裁定或 SEA/npm release 渠道被取消这件事。
- 相比之下，Option C（Claude Code plugin，`/plugin marketplace add yaleh/quay` + `/plugin install quay`）才是裁定要求的主渠道，却排在README第三位、且没有任何"推荐"标注。

## 与既有 GOAL 的关系

**不完全属于 GOAL-021**（README 定位叙事 + 自举统计 + 截图，AC-276/277/278——那是"quay是不是software engineering agent"这层叙事，不是"哪个安装渠道该标注为推荐"）。这是一个更具体、更功能性的缺陷：**文档描述了一个已经不存在的分发产物，且推荐顺序与人的明确裁定相反**。与 `gap-readme-cli-surface-stale-driver-goal-verbs`（CLI用法行漂移）也是不同问题——那条是命令行字面输出漂移，这条是分发渠道优先级与产物存在性问题。建议独立成任务。

## Acceptance Criteria

- [x] AC1: README 的三个安装选项重新排序/标注，使 Claude Code plugin（现 Option C）成为标注为"推荐"的首选项，与两条裁定（GOAL-019 origin ②、release.yml:6-8）一致。
- [x] AC2: Option A（npm 全局安装）的描述改为如实反映现状——要么明确说明"release 不再附带预构建 tarball，需自行 `npm install` + `packages/quay/scripts/package.sh` 本地打包"，要么把它降级为"面向开发者的备选路径"而非"推荐给大多数用户"；⛔ 不得继续暗示 GitHub Release 上有现成 `.tgz` 可下载。取假判据：`gh release view <最新tag> --json assets --jq '.assets | length'` 为 0 时，README 不得出现"download the release artifact"这类暗示存在下载产物的措辞。
- [x] AC3: README 补一句简短说明 npm/SEA release 渠道已于 2026-09-16 被人裁定取消、CI/发布现在以 Claude Code plugin 渠道为唯一 gate（可引用 release.yml 头注释或直接引用裁定原文），避免下次有人重新问"为什么还是有 npm 安装的说明"。
- [x] AC4: 检查 `plugin/README.md`、`docs/` 下是否有同款"npm release artifact"过时引用（硬规则 5b）。

## Definition of Done

- [x] README.md（及 AC4 排查出的其它文件）里不再有"npm release artifact 是推荐安装方式"或"GitHub Release 上有现成 tarball"这类与当前实现矛盾的表述。

## Touches

- README.md
- packages/quay/README.md
- tasks/gap-readme-option-a-npm-release-artifact-retired.md（自身）
