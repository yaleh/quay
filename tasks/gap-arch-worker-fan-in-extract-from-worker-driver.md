---
id: gap-arch-worker-fan-in-extract-from-worker-driver
title: 架构：从 worker-driver.ts 抽出机械 fan-in 区域为 worker-fan-in.ts（调查方案第一期；文件已 6063
  行，越过调查设的 3300 行重评线）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**执行 `docs/analysis/worker-driver-decomposition-investigation.md` §AC4 第一期：把 R15 机械 fan-in 区域抽成 `plugin/scripts/worker-fan-in.ts`，`worker-driver.ts` 对其全部导出改 `export { … } from "./worker-fan-in.ts"`，保持既有测试的 import 面不变。**

**为什么现在做**：调查（`gap-worker-driver-god-file-decomposition-investigation`，done）的结论是「值得局部拆，只拆到 R15 为止」，并设了一条可查的重评线：文件超过约 3300 行即需重评。实测 `wc -l plugin/scripts/worker-driver.ts` = 6063（调查时 4445）——重评线已被突破，且期间 fan-in 区域又长了（`runMechanicalFanIn` 现在在 `:4841` 一带，`mirrorMechanicalFanInSuiteState` 在 `:5094`）。

**⚠️ 实现者先重做的一件事**：调查里的行号（2581–3741 等）已作废。**先重新定位 fan-in 区域边界并重测它对文件其余部分的真实调用数**（调查时只有 `scopedGateCommandFor` 一处，现 `:1580` 定义、`:4841` 调用），把新读数写进 notes；若发现已出现第 3 个模块级可变状态或对外回引显著增多，按调查 AC5 反例判据**停下并写明是否仍值得拆**，不得硬拆。

**不做**：不拆第二期候选（R7/R13/R10/R9）；不改任何导出的语义；不动 Provider ABI。`scopedGateCommandFor` 随 scoped 门语义一并迁入 `worker-fan-in.ts`，或保留并注入，二选一并写明理由。

## AC

- [ ] AC1（重测在先）notes 里贴出重新定位后的 fan-in 区域起止行、导出个数，以及该区域对区域外的真实调用清单（按 import/调用位置判定，非关键词），与调查的「1 处」逐条对账。
- [ ] AC2（导出面不变）迁移前后 `worker-driver.ts` 的导出名集合逐字相同：迁前迁后各跑一次导出枚举命令，两份输出 diff 为空（贴 diff 命令与结果）。
- [ ] AC3（判据取假）临时从 `worker-driver.ts` 的 re-export 里删掉一个导出，`plugin/test/worker-driver-fan-in-s*.test.mjs` 必须红；撤销后绿。两次结果贴进 notes。
- [ ] AC4（无新环）`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` ⇒ `valueSccs=[]`、`typeSccs=[]`、`reverseEdges=[]`、`verdict.ok=true`；`worker-fan-in.ts` 不得 import `worker-driver.ts`（否则即值环）。
- [ ] AC5（回归面）`plugin/test/worker-driver-fan-in-s01..s12.test.mjs` 与 `worker-driver*.test.mjs` 全绿，且 `scripts/test.sh --for-task gap-arch-worker-fan-in-extract-from-worker-driver` 全绿。
- [ ] AC6（生产载体，硬规则 4 推论三）拆分落地后 driver 的一次真实机械 fan-in 走通新模块：`.workflow-events/` 或 dispatch 记录里出现落地后时间窗内、由 `worker-fan-in` 路径完成的 fan-in 记录 ≥1 条（贴该记录）；关掉测试注入缝后仍成立。
- [ ] AC7（行数只作旁证）notes 里记 `wc -l` 前后读数；⛔ 不得以行数作通过判据。

## DoD

真实落地：新模块在生产 driver 上被一次真实机械 fan-in 走过（AC6），而不是只有测试绿。导出面 diff 为空（AC2）、无新环（AC4）。若重测结论是「不该再拆」，则以 AC1 的证据关闭本任务并注明，不算失败。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/worker-fan-in.ts (new)
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/worker-driver-fan-in-s01.test.mjs
- plugin/test/worker-driver-fan-in-s02.test.mjs
- plugin/test/worker-driver-fan-in-s03.test.mjs
- plugin/test/worker-driver-fan-in-s04.test.mjs
- plugin/test/worker-driver-fan-in-s05.test.mjs
- plugin/test/worker-driver-fan-in-s06.test.mjs
- plugin/test/worker-driver-fan-in-s07.test.mjs
- plugin/test/worker-driver-fan-in-s08.test.mjs
- plugin/test/worker-driver-fan-in-s09.test.mjs
- plugin/test/worker-driver-fan-in-s10.test.mjs
- plugin/test/worker-driver-fan-in-s11.test.mjs
- plugin/test/worker-driver-fan-in-s12.test.mjs
- tasks/gap-arch-worker-fan-in-extract-from-worker-driver.md
