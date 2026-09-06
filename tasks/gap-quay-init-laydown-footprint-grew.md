---
id: gap-quay-init-laydown-footprint-grew
title: quay-init laydown footprint 增长 +8640 bytes，shrink-only ratchet 红并挡全量 suite
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`quay-init-closure-ratchet.ts` 的 shrink-only 基线（`BASELINE_BYTES = 3818315`，132 files）被打破：当前真实 laydown footprint = 3826955 bytes（+8640 bytes，文件数 0 增长），`--gate` exit 1。全量 suite 现红于该检查（`.quay/full-suite-state.json` failedCheckers 含 quay-init-closure-ratchet exit=1）。文件数未变（132）说明是既有某(些) laydown 文件字节增长，而非新增文件。

修法：定位增长来源（diff 当前 laydown copy set 与基线），若为污染则回缩；若为正当功能增长（如某 probe/脚本变长）则重新锚定基线并记录理由——同该 ratchet 头注释里既有的 re-anchor 先例（gap-goal-store-revoke +204 bytes、gap-goal-store-abi-encapsulation +1 file/+5155 bytes）。

## Acceptance Criteria

- [ ] 定位出增长 +8640 bytes 的具体文件与原因（贴文件级字节对比或 diff）
- [ ] `node plugin/scripts/quay-init-closure-ratchet.ts --gate --root .` 退出 0

## Definition of Done

增长来源已定位并处置（回缩或重新锚定基线），`quay-init-closure-ratchet --gate` 退出 0，全量 suite 的 failedCheckers 不再含 quay-init-closure-ratchet。

## Touches

- plugin/scripts/quay-init-closure-ratchet.ts
- plugin/test/quay-init-closure-ratchet.test.mjs
- tasks/gap-quay-init-laydown-footprint-grew.md
