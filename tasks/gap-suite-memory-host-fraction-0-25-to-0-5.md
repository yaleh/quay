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
4. （实施中发现的第三处钉值）`driver-anchor-memory-envelope.test.mjs` 的 shared-host crossover 写死了 0.25 时代的 `N ≤ 3`；`ANCHOR_ENVELOPE_HOST_FRACTION = SCOPE_ENVELOPE_HOST_FRACTION` ⇒ anchor 包络共用同一比例，crossover 随比例移动。改为从常量派生 `N ≤ 1/fraction − 1`（=1），不写字面量。

## Acceptance Criteria

- [x] `SCOPE_ENVELOPE_HOST_FRACTION = 0.5`：`grep -n "SCOPE_ENVELOPE_HOST_FRACTION = " packages/quay/src/systemd-scope.ts` 命中行显示 0.5
- [x] 上限读数：注入 effectiveTotalMemBytes=66295676928 + declared {value:"32G",source:"env"}，`suiteMemoryMax` 返回 memoryMax=33147838464（30.87 GiB）、bound=host-guard（node 直调打印）
- [x] 两测试文件默认-fraction 钉值 ×2 更新（1 GiB→2 GiB、2 GiB→4 GiB）；`grep -nE "0\.25"` 在两文件仅剩注释/常量名说明，无生效断言钉值
- [x] `build-dist && sync-vendor --sync-dist` 后 vendored bundle 解析出 fraction=0.5（node 直调 dist 打印 project-blind guard）；记录 `md5sum packages/quay/dist/quay.js plugin/vendor/quay/dist/quay.js` 指纹到本任务 evidence

## Definition of Done

fraction=0.5 已落地源码并重建进 dist（两处 md5 指纹记录在案）；生产读取面 `resolveSuiteMemoryMax` 对 quay-anchor 载体解析出 30.87 GiB 上限（宿主相对，非字面）；两测试文件的纯函数用例绿（AC4 42s A/B 除外，走 suite）。

## Evidence

**AC1** — `grep -n "SCOPE_ENVELOPE_HOST_FRACTION = " packages/quay/src/systemd-scope.ts` →
`74:export const SCOPE_ENVELOPE_HOST_FRACTION = 0.5;`

**AC2** — node 直调 `plugin/scripts/full-suite-runner.ts` 的 `suiteMemoryMax`：
```
{ "memoryMax": "33147838464", "bound": "host-guard",
  "hostGuardBytes": 33147838464, "hostFraction": 0.5 }
```
（33147838464 = 30.87 GiB = 0.5 × 66295676928，且 < 声明的 32G=34359738368）

**AC2 补充（DoD 的生产读取面，真 cgroup 载体）** — `systemd-run --user --scope -p MemoryMax=66295676928` 内跑
`QUAY_SUITE_MEMORY_MAX=32G` + `resolveSuiteMemoryMax(stateDir)`：
```
{ "effective": 66295169024, "declared": "32G", "declaredSource": "env",
  "hostGuardBytes": 33147584512, "memoryMax": "33147584512", "bound": "host-guard" }
reason: "...exceeds the host-relative guardrail (33147584512 B = 0.5 × the effective host total)
         — guard rule: project-blind ..."
```
（effective 是 MB 截断的 61.74 GiB 载体；上限 30.87 GiB，宿主相对而非字面）

**AC3** — `grep -nE "0\.25"` 在两文件仅剩说明性注释（历史读数与「本比例不在此复述」的注记），无生效断言钉值。
钉值改动：`AC_PROJECT_BLIND_BYTES` 66 295 676 928 → 132 591 357 952；AC3 clamp 夹具 80G → 200G（否则 80G 落在新上界之下，
用例会退化成空转）；cgroup 文件 8 GiB⇒2 GiB→4 GiB、4 GiB⇒1 GiB→2 GiB、real-cgroup 4G 载体⇒1 GiB→2 GiB、
`laneScaledScopeMemoryMax(8 GiB).hostGuardBytes` 2 GiB→4 GiB。三文件 node --test 全绿：
declared-memory-guard 5/5、cgroup 71 pass/0 fail/1 skip（systemd-run 不可用时的具名 skip）、anchor-envelope 14/14。

**AC4** — `build-dist`（packages/quay + packages/quay-native）→ `sync-vendor.sh --sync-dist`：
```
8f61aaa59ba1e500de4f7e52b6609266  packages/quay/dist/quay.js
8f61aaa59ba1e500de4f7e52b6609266  plugin/vendor/quay/dist/quay.js
```
vendored bundle 被执行（node 加载 dist → `init_systemd_scope()` → 读该 bundle 自己的常量）：
```
{ "SCOPE_ENVELOPE_HOST_FRACTION_read_from_bundle": 0.5, "SCOPE_ENVELOPE_PAGE_BYTES": 4096,
  "effectiveTotalMemBytes": 66295676928, "projectBlindGuardBytes": 33147838464,
  "projectBlindGuardGiB": "30.87" }
```
⚠️ 如实写出能力边界（硬规则 3b）：dist bundle 只导出 7 个 CLI 符号，`defaultScopeMemoryMax` 在 esbuild 的
`__esm` 闭包内**不可从外部直接调用** ⇒ 「直调」是执行 bundle 取它自己的 fraction/page 常量再套同一条页对齐公式，
⛔ 不是调用那个函数。函数级直调的证据在 AC2（生产模块 `suiteMemoryMax`）与 DoD（真 cgroup 上的
`resolveSuiteMemoryMax`）。

## ADR-007 dark-axis record

- L_D 该轴仍暗,理由:只改一个常量的取值与测试钉值，packages/quay 与 plugin 的 import 边 0 增减（无新增/删除依赖）
- L_G 该轴仍暗,理由:无包/模块结构变化（未增删文件），god-package 与 shape-smell 读数不随单常量取值移动

## Touches

- packages/quay/src/systemd-scope.ts
- plugin/test/full-suite-runner-cgroup.test.mjs
- plugin/test/full-suite-runner-declared-memory-guard.test.mjs
- plugin/test/driver-anchor-memory-envelope.test.mjs
- tasks/gap-suite-memory-host-fraction-0-25-to-0-5.md
