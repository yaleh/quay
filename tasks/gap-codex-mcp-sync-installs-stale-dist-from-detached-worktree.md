---
id: gap-codex-mcp-sync-installs-stale-dist-from-detached-worktree
title: publish 自 detached worktree 运行时 codex-mcp-sync 装 stale dist（0.31.0-dev 而非
  tag 版）
status: ready
labels:
  - gap
  - codex
  - release
parent: null
children: []
extra:
  schema: execution
---
## Proposal

0.30.1 发布实测：从 v0.30.1 的 detached worktree 跑 publish-dist-branch.sh --push，发布的 dist-plugin bundle 是 0.30.1（正确），但脚本末尾的 `codex-mcp-sync.sh --install-only --dist-root $WORK` 自动装到 ~/.local/share/quay/quay.js 的是 0.31.0-dev（stale，主检出的版本）。这是 gap-codex-mcp-sync-installs-stale-main-checkout-dist 的复发形态：--dist-root 已钉死 $WORK，但 $WORK 里的 vendor/quay/dist/quay.js 在 detached worktree 下似乎没被 sync-vendor 重建成当前树的版本（或 bundle 版本内联/重戳没生效），导致 install 拷贝了 stale 内容。已知事实：published dist-plugin 的 bundle 是 0.30.1（git show origin/dist-plugin:vendor/quay/dist/quay.js grep 0.30.1），而自动 install 的 quay.js 是 0.31.0-dev——二者应来自同一 $WORK，需定位分歧点。

## Plan

复现：detached worktree 于某 tag 跑 publish --push，观测 --install-only 装的 dist 版本。定位 sync-vendor / stamp-bundle-tree 在 detached worktree 下的版本来源。修复后 install 的 dist 版本 == tag 版本。

## Acceptance Criteria

- [x] AC1 复现（能取假）：detached@v0.30.1 worktree 跑 build 步后，`codex-mcp-sync.sh --install-only --dist-root <worktree>/plugin` 装的 `~/.local/share/quay/quay.js` 内嵌 `"0.30.1-dev"`（`grep -aoE '"0\.[0-9]+\.[0-9]+(-dev)?"'` 读数）≠ tag `v0.30.1`；对照 `git show origin/dist-plugin:vendor/quay/dist/quay.js` 内嵌 `0.30.1` == tag。build 步日志：`STAMP-VERSION: ERROR — 1 carrier(s) could not be judged; nothing was written.`（bundle 未重戳）。
- [x] AC2 根因定位：`plugin/scripts/sync-vendor.sh:559` 的 build-mode stamp 链跑 `stamp-version.mjs --mode build --root "${PLUGIN_DIR}"`，但 `scripts/version-carriers.ts` 的 `.codex-plugin/plugin.json` carrier 带 `buildPath`（在 REPO ROOT，不在 `plugin/` 下）⇒ 读 `plugin/.codex-plugin/plugin.json` ENOENT ⇒ `stamp-version` exit 1；该链是 `&&` 连接、`set -e` 对非末尾 `&&` 失败不触发 ⇒ `--stamp-bundle-tree`/`--bundle-tree` 被静默跳过 ⇒ bundle 停在 build-time `-dev`。
- [x] AC3 修复：`scripts/stamp-version.ts` 新增 `--repo-layout`（`repoLayoutBuildCarriers` 还原 repo 路径）；`sync-vendor.sh` 改 `--repo-layout --root "${REPO_ROOT}"` 且 `|| { …; exit 1; }` fail-closed；`publish-dist-branch.sh:251` stamp 链加 `|| exit 1`。修复后重跑：`BUNDLE-EMBEDDED-STAMP: OK — re-derived 1 bundle(s) to 0.30.1`，`codex-mcp-sync.sh --install-only --dist-root <worktree>/plugin` 装的 `~/.local/share/quay/quay.js` 内嵌 `"0.30.1"` == tag（grep 读数）。
- [x] AC4 测试：`bash scripts/test.sh --for-task gap-codex-mcp-sync-installs-stale-dist-from-detached-worktree --allow-thin` 绿（11 tests pass，含 `plugin/test/codex-mcp-sync-detached-stale-dist.test.mjs` 两条：--repo-layout 戳 repo 树含 repo-root codex carrier + 反向 `--bundle-tree` 打红；sync-vendor/publish stamp 链 fail-closed 位置断言）。

## Definition of Done

从任意 detached/tag worktree 发布时，codex-mcp-sync 自动安装的 dist 与发布 tag 版本一致，不再装主检出的 stale dist。

## ADR-007 dark-axis record

该轴仍暗,理由:版本戳记脚本修复（stamp-version --repo-layout + sync-vendor/publish stamp 链 fail-closed），无包/依赖结构变化，L_D/L_G 无可测结构量。

## Touches

- plugin/scripts/codex-mcp-sync.sh
- plugin/scripts/publish-dist-branch.sh
- plugin/scripts/sync-vendor.sh
- scripts/stamp-version.ts
- plugin/test/codex-mcp-sync-detached-stale-dist.test.mjs
- tasks/gap-codex-mcp-sync-installs-stale-dist-from-detached-worktree.md

## Blocker

**2026-11-01T03:54:09.145Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: baseline publish must succeed: [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/publish-dist-branch-closure-gate.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：03323a1c-d02c-4836-9a5d-57306de6aa61
