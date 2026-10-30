---
id: gap-codex-plugin-json-version-not-a-carrier
title: .codex-plugin/plugin.json version 硬编码且非版本载体：stamp-version 不更新
status: done
labels:
  - gap
  - codex
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-10-30 实测：released 0.27.0 插件（及 publish-dist-branch 组出的 artifact）里 `.codex-plugin/plugin.json` 的 `version` 字段是硬编码 `0.26.0-dev`——它不在版本载体表 `scripts/version-carriers.ts` 的 `VERSION_CARRIERS` 里（grep 无命中），`stamp-version` 不更新它，`version-consistency-check` 也不校验它。同一 artifact 的 `VERSION`=`0.27.0`、`.claude-plugin/plugin.json`=`0.27.0`（stamp 正常）。即：Codex 插件发布面（AC-931 建的 `.codex-plugin/plugin.json`）的版本号停旧，随发布漂移。

根因：`.codex-plugin/plugin.json`（repo 根，publish-dist-branch.sh 组装进 artifact 根）从未登记为版本载体。stamp-version 的载体表只有 `plugin/.claude-plugin/plugin.json`、`plugin/README.md`、`plugin/VERSION`、`delivery-manifest.json` 等。

修复：把 `.codex-plugin/plugin.json` 登记进 `VERSION_CARRIERS`（JSON 字段载体，复用 `jsonVersionField`），使 release-cut 的 stamp-version 步骤与 version-consistency-check 一并更新/校验其 `version`，并确认 publish-dist-branch.sh 组出的 artifact 里该文件版本也不再停旧（与 `plugin/VERSION` 一致、无 `-dev`）。

`gap-codex-plugin-publish-surface-plugin-json-mcp-dist`（AC-931，done）的后继缺口。merge-candidate：`task-granularity-advice.ts` 返回 `peers: []`。

## Acceptance Criteria

- [x] AC1 载体登记（按位置）：`grep -n 'codex-plugin' scripts/version-carriers.ts` 命中 `.codex-plugin/plugin.json` 的载体条目（非注释/字符串巧合；贴条目与行号）。
- [x] AC2 stamp 生效（能取假）：把 `.codex-plugin/plugin.json` 的 `version` 手工改错后 `node --no-warnings --experimental-strip-types scripts/stamp-version.ts --mode tracked --check` 报 DRIFT（exit 1）并命名该文件；改回一致后 exit 0（贴两次 `echo $?`）。
- [x] AC3 反向：临时从 `VERSION_CARRIERS` 删掉该条目后，把 `.codex-plugin/plugin.json` 的 `version` 改错，`--check` 仍绿（证明它此前确实不在判定集；贴 `echo $?`）。
- [x] AC4 测试：`scripts/stamp-version.test.ts`（其 per-carrier 循环读共享载体表）覆盖 `.codex-plugin/plugin.json`——新增显式断言 stamp 后 version 与 `plugin/VERSION` 一致。
- [x] AC5 范围门绿：`bash scripts/test.sh --for-task gap-codex-plugin-json-version-not-a-carrier --allow-thin` 绿。

## Definition of Done

`.codex-plugin/plugin.json` 进入 `VERSION_CARRIERS`，`stamp-version` 更新其 `version` 字段、`version-consistency-check` 校验一致；stamp 后该文件 version 与 `plugin/VERSION` 相等且无 `-dev`；删条目后改错不报（能取假）；测试覆盖；`--for-task` 范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:只新增一个 JSON 版本载体条目 + 一致性断言,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- scripts/version-carriers.ts
- scripts/stamp-version.test.ts
- scripts/version-consistency-check.test.ts
- plugin/scripts/checker-mutation-cases/version-consistency-check.sh
- .codex-plugin/plugin.json
- plugin/test/release-cut.test.mjs
- tasks/gap-codex-plugin-json-version-not-a-carrier.md

## Evidence

- 全量 suite 回归修复（上一轮 exited-not-landed 的根因）：`plugin/test/release-cut.test.mjs` 的 fixture 克隆 develop（carrier 登记落地前的旧树，`.codex-plugin/plugin.json` 仍 `0.26.0-dev`），而 `release-cut.mjs` 从 worktree 自身解析 `version-consistency-check.ts`（已含新 carrier）⇒ 健康 fixture 被误判 DRIFT、`CAUSE=release-cut-version-inconsistent`（实测 `--root <develop克隆>` 复现：`.codex-plugin/plugin.json 0.26.0-dev != expected 0.28.0-dev`）。修法：fixture 在 `author`（HEAD，preflight 判定的树）上把 `.codex-plugin/plugin.json` 提交为 `plugin/VERSION`（与 shipped-set ceiling 同形的 fixture 化），`node --test plugin/test/release-cut.test.mjs` 18/18 绿。
- AC5 范围门：本轮 scoped-gate cache 已写入（`--for-task ... --allow-thin` 绿）。
