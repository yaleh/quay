---
id: gap-codex-plugin-ship-human-facing-skills
title: codex 插件 ship 人脸操作面
  skills（quay-init/quay-file-task/quay-directive/quay-task-operator），编排面不交付；⛔ 不经
  quay init 落盘复制
status: ready
labels:
  - gap
  - codex
parent: null
children: []
extra:
  schema: execution
---
## Proposal

对齐缺口（meta-cc 实测 2026-10-31）：codex 插件只 ship MCP（`codex mcp list` 有 quay、`task_list` 返回 128 条），但**不 ship skills**——meta-cc 的 `.agents/skills/` 只有它自己的 `prompt-*`，`$quay-task-operator`/`$quay-directive` 不可见。而 Claude Code 侧 `plugin/skills/` 13 个全 ship（`/skill`），Codex 侧 0 个。

修法（对齐 Claude Code，人 2026-10-31 裁定）：codex 插件包（`publish-dist-branch.sh` 组装面）ship **人脸操作面** skills——单源 `plugin/skills/`，组装时拷进 codex 插件包的 `skills/`（build-time packaging，⛔ 非 source copy）；codex 插件 manifest `.codex-plugin/plugin.json` 声明 `"skills": "./skills/"`（openai 插件惯例，circleci 已证）。

**人脸操作面（交付）**：`quay-init`（现 Claude Code 名为 `init`，Codex 侧改名避免 `/skills` 菜单裸 `init` 歧义）、`quay-file-task`、`quay-directive`、`quay-task-operator`。
**编排面（不交付）**：`loop-driver`、`manager`、`cold-start`、`drivers`、`routines`、`execute`、`quay-task-to-plan`、`extension-point-refactor`；参考类 `quay-native-methodology`、`quay-webui-bootstrap-methodology` 也暂不交付（非操作面）。

⛔ **约束（人 2026-10-31 裁定）**：**禁止 `quay init` 落盘时复制 quay 技能**——本项目曾这么做、证明是灾难（`gap-ac166-second-copy-retirement` 同族教训：second copy 会漂）。交付路径只在 codex 插件组装面，quay init 只建空 `.agents/skills/` 目录、⛔ 不写任何 quay 技能文件。merge-candidate：`peers: []`。

## Acceptance Criteria

- [x] AC1 分类（按位置，贴清单+判定依据）：人脸操作面 = `quay-init`/`quay-file-task`/`quay-directive`/`quay-task-operator`；编排面 = `loop-driver`/`manager`/`cold-start`/`drivers`/`routines`/`execute`/`quay-task-to-plan`/`extension-point-refactor` 不交付。
- [x] AC2 组装：`publish-dist-branch.sh` 组装出的 codex 插件包含 `skills/` 目录且**恰含**上述 4 个人脸 skills（`find <codex-pkg>/skills -mindepth 1 -maxdepth 1 -type d` 输出 == 这 4 个）；`.codex-plugin/plugin.json` 声明 `"skills": "./skills/"`（贴 manifest 片段 + `find` 结果）。
- [x] AC3 验证：从 assembled artifact 组 marketplace → `codex plugin add quay@<mkt>` → 在 meta-cc（或等价项目）codex 里 `$quay-task-operator` / `$quay-directive` 可见（贴 codex 技能发现/调用结果）。
- [x] AC4 反向（能取假）：编排面 skills 不在 codex 插件包内（`find <codex-pkg>/skills -name 'loop-driver'` 空、`-name 'manager'` 空）。
- [x] AC5 约束（quay init 不复制，能取假）：`quay init` 后目标项目 `.agents/skills/` **不含** quay 技能文件（`find <target>/.agents/skills -maxdepth 1 -name 'quay-*'` 空），且 `packages/quay/src/init.ts` 无「复制 skills 进 `.agents/skills/`」路径（grep 空）；反向：若有人加回复制路径 ⇒ AC5 grep 命中。
- [x] AC6 测试+范围门：`plugin/test/codex-plugin-surface.test.mjs` 断言 skills 交付面（4 个在、编排面不在）+ init 不复制；`bash scripts/test.sh --for-task gap-codex-plugin-ship-human-facing-skills --allow-thin` 绿。

## Definition of Done

codex 插件 ship 人脸操作面 skills（单源 `plugin/skills/` 组装拷贝）、编排面不 ship；meta-cc codex 里 `$quay-*` 技能可见；`quay init` 落盘不复制技能（只建空目录）；测试正反向 + 范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:codex 插件 skills 交付面组装 + manifest skills 字段,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- .codex-plugin/plugin.json
- plugin/scripts/publish-dist-branch.sh
- plugin/test/codex-plugin-surface.test.mjs
- tasks/gap-codex-plugin-ship-human-facing-skills.md
