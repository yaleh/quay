---
id: gap-quay-init-codex-host-trio-laydown
title: quay init 落 Codex 三件套 + CLOSED_SET_ITEMS 声明（.codex/config.toml cwd 项目相对）
status: ready
labels:
  - gap
  - codex
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-932
---
## Proposal

AC-932 判据逐字（`goals/AC-932-*.md` 的 criterion）只查一件事：`packages/quay/src/init/delivery-surface.ts` 的 `CLOSED_SET_ITEMS` 是否含 `".codex/config.toml"`、`".agents/skills"`、`"AGENTS.md"` 三个字面声明——删掉任一声明，对应 grep 就非 0 且 stderr 带成因。正向臂 = 三件套进 `CLOSED_SET_ITEMS`；反向臂由 criterion 自身承担。完整行为——`quay init` 真落盘 + `.codex/config.toml` 的 `cwd` 项目相对——由本任务测试承担。

现状：`CLOSED_SET_ITEMS`（delivery-surface.ts:214）只有 Claude 面七件套（`.quay/config.yml` / `.quay/profiles.yml` / `tasks` / `goals` / `.gitignore` / `.claude/launch.settings.json` / `.claude/settings.json`），Codex 三件套不 ship；`quay init` 写段（init.ts:2204 起）不落任何 Codex 宿主面。仓库根现有的 `.codex/config.toml` 是 dev-tree 自己的宿主配置——`cwd = "/data/home/yale/work/quay"` 硬编码 + `args = ["packages/quay/bin/quay.ts","mcp"]` 指向 source——不能当消费者模板。

交付：`quay init` 在消费者项目根（cwd 项目相对）真落盘三件套并纳入封闭集：

- `.codex/config.toml`：注册 quay MCP server，`cwd` = init 目标根（运行时算出，非硬编码宿主路径），`args` 与 AC-931 发布面（安装后 dist）一致；
- `.agents/skills/`：Codex 技能宿主面（目录），技能与 `plugin/skills/` 单一来源、⛔ 不复制生命周期策略正文；
- `AGENTS.md`：Codex 面向的常驻指引（简短，重复性工作流留在 Skills）。

三者进 `CLOSED_SET_ITEMS` 与 `autoCommitClosedSet` 的 staged-paths（最好从 `CLOSED_SET_ITEMS` 派生后者，消除既有七件套复制漂移，硬规则 5b）。

与已立案任务 `gap-codex-plugin-publish-surface-plugin-json-mcp-dist`（AC-931）是不同机制、独立验收：它建 `.codex-plugin/plugin.json` 发布清单，本任务把三件套落进 init 的消费者项目。config.toml 的 `args` 落点应与其发布面（安装后 dist）一致，实现者交叉核对；本任务不建 `.codex-plugin/`。

## Acceptance Criteria

- [x] AC-932 判据逐字复跑 exit 0（三条 grep，逐字来自 `goal show AC-932` 的 `.criterion` 字段，⛔ 不在测试里重写一份判据），贴 exit 码与 stderr（应为空）。
- [x] 落盘测试：`quay init` 在临时空目录真落盘三件套——`<root>/.codex/config.toml` 是文件、`<root>/.agents/skills` 是目录、`<root>/AGENTS.md` 是文件（`packages/quay/test/init.test.mjs` 里按 `path.join(dir, ...)` 断言存在+类型）。
- [x] cwd 项目相对测试：生成的 `.codex/config.toml` 含 `cwd = "<init 目标根>"`（或等价的绝对化项目根语义），且全文不含硬编码宿主路径（如 `"/data/home/yale/work/quay"`）。
- [x] auto-commit 封闭集含三件套：`autoCommitClosedSet` 的 staged-paths 与 `CLOSED_SET_ITEMS` 一致（三件套在两者中；`--auto-commit-config` 下三件套被 commit），测试或 grep paths 数组含三个字面。
- [x] 单源守卫：`node --experimental-strip-types scripts/agents-claude-drift-check.ts` 仍 exit 0；若从模板落 `AGENTS.md`/`.agents/skills`，模板与 `plugin/skills/` 的 canonical 契约同源（byte-identity 测试，同 launch.settings.json 既有先例），⛔ 不在 init.ts 里再复制一份会漂移的正文。
- [x] 范围门绿：`bash scripts/test.sh --for-task gap-quay-init-codex-host-trio-laydown --allow-thin`；全量 suite 留给 fan-in 机械阶段。

## Definition of Done

在全新临时项目目录真实跑过一次 `quay init`（非单测替身），贴：init 真实 stdout；`ls -la` 显示 `.codex/config.toml`、`.agents/skills/`、`AGENTS.md` 已落盘；`cat .codex/config.toml` 全文，其中 `cwd` 等于该临时项目根而非任何硬编码宿主路径。`--for-task` 范围门绿；AC-932 判据复跑 exit 0。

## Touches

- packages/quay/src/init/delivery-surface.ts
- packages/quay/src/init.ts
- packages/quay/src/cli/init.ts
- packages/quay/test/init.test.mjs
- packages/quay/test/install-config-driven-e2e.test.mjs
- plugin/scripts/quay-init-closure-assertion.ts
- plugin/test/quay-init.test.mjs
- plugin/.codex/AGENTS.md (new)
- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
- tasks/gap-quay-init-codex-host-trio-laydown.md

## ADR-007 暗轴记录

- 该轴仍暗,理由:本任务仅在 packages/quay 既有模块内新增生成函数与写入步骤、并在既有封闭集常量上追加条目，无跨包新依赖边，未取 L_D/L_G archguard 读数。