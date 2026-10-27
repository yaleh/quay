---
id: gap-suite-memory-host-fraction-0-25-to-0-5
title: suite 内存护栏 fraction 0.25→0.5：声明 32G 被钳到 15.44 GiB，提到 30.87 GiB 覆盖 lane 需求
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

生产 suite 的有效 MemoryMax = min(声明, SCOPE_ENVELOPE_HOST_FRACTION × effectiveTotalMemBytes)。实测：宿主 RAM ~247 GiB，suite 跑在 quay-anchor-quay scope（memory.max = 61.7 GiB）；fraction 0.25 把声明的 32G 钳到 15.44 GiB（bound=host-guard）。lane-scaled 需求 = perFileHighWater 164 MB × 128 lanes × 1.25 headroom = 24.48 GiB。24.48 > 15.44 ⇒ 每轮 full-suite OOM-kill（rounds 3110–3125，oomKill 1–2）。提 fraction 到 0.5 ⇒ 上限 min(32G, 0.5×61.7 GiB) = 30.87 GiB，覆盖需求 + 26% 余量，仍在声明 32G 之下。

<!-- dedup-ref --> 相关但不同机制，不合并、不作为前置：gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc（16G 字面量钉值）、gap-suite-declared-memory-max-swallowed-by-shared-host-split（shared-host-split 吞显式声明）。本任务只动 project-blind fraction。

## Plan

1. `packages/quay/src/systemd-scope.ts` 的 `SCOPE_ENVELOPE_HOST_FRACTION` 0.25 → 0.5。
2. 更新两测试文件依赖默认 fraction 的钉值（×2）：`full-suite-runner-declared-memory-guard.test.mjs`（AC_PROJECT_BLIND_BYTES 字面 0.25 处）与 `full-suite-runner-cgroup.test.mjs`（`floor(4G×0.25)=1G`、`8G⇒2 GiB` 等）。
3. `build-dist` + `sync-vendor --sync-dist` 重建 dist，核 vendored bundle 内 fraction=0.5。

## Acceptance Criteria

- [ ] `SCOPE_ENVELOPE_HOST_FRACTION = 0.5`：`grep -n "SCOPE_ENVELOPE_HOST_FRACTION = " packages/quay/src/systemd-scope.ts` 命中行显示 0.5
- [ ] 上限读数：注入 effectiveTotalMemBytes=66295676928 + declared {value:"32G",source:"env"}，`suiteMemoryMax` 返回 memoryMax=33147838464（30.87 GiB）、bound=host-guard（node 直调打印）
- [ ] 两测试文件默认-fraction 钉值 ×2 更新（1 GiB→2 GiB、2 GiB→4 GiB）；`grep -nE "0\.25"` 在两文件仅剩注释/常量名说明，无生效断言钉值
- [ ] `build-dist && sync-vendor --sync-dist` 后 vendored bundle 解析出 fraction=0.5（node 直调 dist 打印 project-blind guard）；记录 `md5sum packages/quay/dist/quay.js plugin/vendor/quay/dist/quay.js` 指纹到本任务 evidence

## Definition of Done

fraction=0.5 已落地源码并重建进 dist（两处 md5 指纹记录在案）；生产读取面 `resolveSuiteMemoryMax` 对 quay-anchor 载体解析出 30.87 GiB 上限（宿主相对，非字面）；两测试文件的纯函数用例绿（AC4 42s A/B 除外，走 suite）。

## Touches

- packages/quay/src/systemd-scope.ts
- plugin/test/full-suite-runner-cgroup.test.mjs
- plugin/test/full-suite-runner-declared-memory-guard.test.mjs
- tasks/gap-suite-memory-host-fraction-0-25-to-0-5.md
