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

- [ ] AC1 复现（能取假）：detached worktree@tag 发布后，~/.local/share/quay/quay.js 内嵌版本 != tag（贴 grep 读数），而 dist-plugin bundle == tag（对照）。
- [ ] AC2 根因定位：找出 $WORK 里 bundle 版本为 stale 的机制（sync-vendor 版本来源 / stamp-bundle-tree 未生效，贴代码位置）。
- [ ] AC3 修复：修复后重跑，--install-only 装的 quay.js 内嵌版本 == tag（贴 grep 读数）。
- [ ] AC4 测试：`scripts/test.sh --for-task gap-codex-mcp-sync-installs-stale-dist-from-detached-worktree` 绿（含反向控制）。

## Definition of Done

从任意 detached/tag worktree 发布时，codex-mcp-sync 自动安装的 dist 与发布 tag 版本一致，不再装主检出的 stale dist。

## Touches

- plugin/scripts/codex-mcp-sync.sh
- plugin/scripts/publish-dist-branch.sh
- plugin/scripts/sync-vendor.sh
- scripts/stamp-version.ts
- plugin/test/codex-mcp-sync-detached-stale-dist.test.mjs
- tasks/gap-codex-mcp-sync-installs-stale-dist-from-detached-worktree.md