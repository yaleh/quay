---
id: gap-main-checkout-vendored-dist-stale
title: 主检出 vendored dist 陈旧 0.25.0-dev（VERSION 0.30.0-dev）：sync-vendor 重建 + 版本一致性检测
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

主检出的 vendored bundle `plugin/vendor/quay/dist/quay.js` 停在 **0.25.0-dev**，而 `plugin/VERSION` 已是 **0.30.0-dev**——bundle 自 0.25.0-dev 后从未 `sync-vendor --sync-dist` 重建。后果（2026-10-31 实测）：`publish-dist-branch.sh` 的 sync 从主检出装了这个陈旧 dist 进 `~/.local/share/quay/`，codex 稳定位置被覆盖成 0.25.0-dev（meta-cc quay MCP 报 0.25.0-dev，peer 反馈）。

根因：vendored bundle 是 gitignored 本地构建产物，VERSION bump 后没有任何机制检测/重建它——陈旧是**静默**的（`--version` 与 `VERSION` 不一致但无检查）。同款教训：[[plugin-test-spawns-vendored-bundle-needs-sync-vendor]]。

修法：① 立即 `sync-vendor --sync-dist` 重建到 0.30.0-dev；② 加一个**陈旧检测**（vendored dist `--version` == `VERSION`，不一致即报红，能取假），堵住再静默陈旧。

与 `gap-codex-mcp-sync-installs-stale-main-checkout-dist` 分工：那条修「sync 装错源」，本条修「主检出 bundle 本身的陈旧 + 检测」。merge-candidate：`peers: []`。

## Acceptance Criteria

- [x] AC1 重建：`node plugin/vendor/quay/dist/quay.js --version` == `cat plugin/VERSION`（两值均 0.30.0-dev）。
- [x] AC2 陈旧检测（能取假）：新增检测（脚本或测试）断言 vendored dist `--version` == `plugin/VERSION`；反向——把 dist 临时换成一个旧版本 ⇒ 检测 exit 非 0 并报版本不一致（负控制两次运行：打补丁副本 --version=0.0.0-stale-fixture ⇒ 检测 exit 1）。
- [x] AC3 检测接入：该检测接入现有静态检查面（或 `plugin/test/` 单测），使 VERSION bump 后未重建能红。
- [x] AC4 测试+范围门：`bash scripts/test.sh --for-task gap-main-checkout-vendored-dist-stale --allow-thin` 绿。

## Definition of Done

主检出 vendored dist 重建到 `plugin/VERSION` 一致；新增陈旧检测（dist --version != VERSION ⇒ 红，能取假）；检测接入检查面；范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:vendored dist 重建 + 一个版本一致性检测,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- plugin/vendor/quay/dist/quay.js
- plugin/test/plugin-test-spawns-vendored-bundle.test.mjs
- .quay/suite-bucket-reattribution.jsonl
- tasks/gap-main-checkout-vendored-dist-stale.md