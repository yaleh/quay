---
id: gap-codex-mcp-sync-installs-stale-main-checkout-dist
title: codex-mcp-sync 装主检出陈旧 dist：publish 发布后 sync 应装 built artifact 的
  dist（--dist-root）
status: ready
labels:
  - gap
  - codex
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

回归（2026-10-31 实测）：`publish-dist-branch.sh:313` 发布后跑 `bash "${PLUGIN_DIR}/scripts/codex-mcp-sync.sh" --install-only`，而 `PLUGIN_DIR` 解析到**主检出** `plugin/`；`codex-mcp-sync.sh` 的 DIST_ROOT 向上走就找到主检出的 `plugin/vendor/quay/dist/quay.js`——它停在 **0.25.0-dev**（陈旧，见 `gap-main-checkout-vendored-dist-stale`）——于是把陈旧 dist 装进 `~/.local/share/quay/`，覆盖了正确的 0.29.0。meta-cc 的 quay MCP 因此报 0.25.0-dev（peer 反馈）。

正解：发布后的 sync 必须装 **built artifact 的 dist**（`$WORK/vendor/quay/dist/quay.js`，组装产物根），⛔ 不是主检出的 `PLUGIN_DIR`（可陈旧）。即 `codex-mcp-sync.sh` 接受一个显式 `--dist-root`（或 publish 从 `$WORK` 跑 sync），安装源 = 刚发布的产物，而非主检出工作树。

本任务先修这条（杜绝再覆盖稳定位置）；主检出 vendored bundle 的陈旧本身另立 `gap-main-checkout-vendored-dist-stale` 排期。merge-candidate：`peers: []`。

## Acceptance Criteria

- [x] AC1 显式源：`codex-mcp-sync.sh` 新增 `--dist-root <dir>`（`DIST_ROOT_OVERRIDE` 覆盖 walk-up，非目录 ⇒ exit 2）；`publish-dist-branch.sh` 发布后调用行改为 `bash "${PLUGIN_DIR}/scripts/codex-mcp-sync.sh" --install-only --dist-root "$WORK"`（built artifact），⛔ 不再依赖从 `PLUGIN_DIR` 向上找。
- [x] AC2 修复验证（能取假）：worktree vendored dist = 0.25.0-dev（VERSION 0.30.0）条件下跑 `publish-dist-branch.sh --no-build --push`（bare remote + temp HOME），publish 后 `node ~/.local/share/quay/quay.js --version` == `0.30.0-dev`（built artifact 版本，非 0.25.0-dev）。
- [x] AC3 反向：旧行为 `codex-mcp-sync.sh --install-only`（无 `--dist-root`）⇒ 装主检出陈旧 dist，`--version` == `0.25.0-dev`；加回 `--dist-root "$WORK"` ⇒ `0.30.0-dev` 复绿。
- [x] AC4 测试+范围门：`plugin/test/publish-dist-branch-closure-gate.test.mjs` 新增两条——①位置断言 publish 后 sync 调用带 `--dist-root "$WORK"`；②行为断言（能取假，含反向）`--dist-root` 装 built tree、walk-up 默认装 stale tree；`bash scripts/test.sh --for-task gap-codex-mcp-sync-installs-stale-main-checkout-dist --allow-thin` 绿（5 tests pass）。

## Definition of Done

`publish-dist-branch.sh` 发布后 sync 装 built artifact 的 dist（`--dist-root "$WORK"`），不再装主检出陈旧 dist；publish 后 `~/.local/share/quay/quay.js --version` == 产物版本；反向打红；范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:sync 加 --dist-root 参数 + publish 调用行改传 built dist,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- plugin/scripts/codex-mcp-sync.sh
- plugin/scripts/publish-dist-branch.sh
- plugin/test/publish-dist-branch-closure-gate.test.mjs
- tasks/gap-codex-mcp-sync-installs-stale-main-checkout-dist.md