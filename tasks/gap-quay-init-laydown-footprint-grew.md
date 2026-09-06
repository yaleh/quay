---
id: gap-quay-init-laydown-footprint-grew
title: quay-init laydown footprint 增长 +8640 bytes，shrink-only ratchet 红并挡全量 suite
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

`quay-init-closure-ratchet.ts` 的 shrink-only 基线（`BASELINE_BYTES = 3818315`，132 files）被打破：当前真实 laydown footprint = 3826955 bytes（+8640 bytes，文件数 0 增长），`--gate` exit 1。全量 suite 现红于该检查（`.quay/full-suite-state.json` failedCheckers 含 quay-init-closure-ratchet exit=1）。文件数未变（132）说明是既有某(些) laydown 文件字节增长，而非新增文件。

修法：定位增长来源（diff 当前 laydown copy set 与基线），若为污染则回缩；若为正当功能增长（如某 probe/脚本变长）则重新锚定基线并记录理由——同该 ratchet 头注释里既有的 re-anchor 先例（gap-goal-store-revoke +204 bytes、gap-goal-store-abi-encapsulation +1 file/+5155 bytes）。

跨任务死锁突破（fan-in 前追加）：本任务 re-anchor 与 `gap-meta-driver-concurrency-literal-cap-undeclared` 互为环形依赖——本任务 scoped 门红于 `concurrency-literal-check`（meta-driver.ts 两处 `cap:1`/`cap:2` 未声明，且该任务是 `@static-object plugin/scripts/` 目录级 ratchet，任何 plugin/scripts touch 都拉它进 scoped 门），而 meta-driver 的全量 suite 红于 `quay-init-closure-ratchet`（本 re-anchor 未落地）。两者各自都无法单独 fan-in。修法：本任务一并落地 meta-driver 两处 `concurrency-default-fallback` 标记（与 meta-driver 任务已提交的 4890df729 逐字一致，避免后续 merge 冲突），打破死锁；meta-driver 任务随后仅需落地其负控制测试与自身任务体。

## Acceptance Criteria

- [x] 定位出增长 +8640 bytes 的具体文件与原因（贴文件级字节对比或 diff）
- [x] `node plugin/scripts/quay-init-closure-ratchet.ts --gate --root .` 退出 0

## Definition of Done

增长来源已定位并处置（回缩或重新锚定基线），`quay-init-closure-ratchet --gate` 退出 0，全量 suite 的 failedCheckers 不再含 quay-init-closure-ratchet。

## Touches

- plugin/scripts/quay-init-closure-ratchet.ts
- plugin/scripts/meta-driver.ts
- plugin/test/quay-init-closure-ratchet.test.mjs
- tasks/gap-quay-init-laydown-footprint-grew.md
