---
id: gap-arch-tsify-integration-batch-merge-sh
title: shell→TS（SPEC Phase 5.2）：integration-batch-merge.sh（697 行，内嵌
  node+python3）改写为 TS，先做 characterization
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**把 `plugin/scripts/integration-batch-merge.sh`（697 行，内嵌 node 与 python3）改写为 `plugin/scripts/integration-batch-merge.ts`；`.sh` 保留为一个发布周期的薄入口，行为不变。这是 SPEC-architecture-consolidation §5 Phase 5.2 的第一个脚本，也是 GOAL-B（shell 层收敛）的量的来源之一：`sh-census-check` 的 `embeddedInterpreterLines` 基线（当前 9503）将按本脚本行数下降。**

**先做 characterization，再改写（SPEC §5 Phase 5 取假点）**：旧 bash 与新 TS 对同一输入的退出码 / 关键输出 / 产物必须一致。实测 `plugin/test/` 下**没有**直接覆盖该脚本的测试文件，调用方是 `develop-deliver-tgz.sh`、`full-suite-runner.ts`、`orphan-session-check.ts`、`retired-clause-check.ts`、`runner-static-gate.ts`、`sync-lag-check.sh`——所以 characterization 测试要**新写**，且必须在改写**之前**对旧 bash 落盘（否则「等价」无从谈起）。

**⛔ 注意一个已知的相邻任务**：`gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling`（人对「真 merge」的裁定与该脚本 ff-only 语义的矛盾）——本任务**只搬运语义、不裁定它**；若实现者发现矛盾影响 characterization 的期望值，把冲突写进 notes 并以**当前行为**为准，不得顺手改语义。

## AC

- [ ] AC1（characterization 先于改写，取假）新测试 `plugin/test/integration-batch-merge-characterization.test.mjs` 在**未改动的旧 bash** 上先落盘并全绿；对旧 bash 注入一处行为改动（如改一个退出码）该测试必须红，撤销后绿。两次输出贴进 notes，且提交顺序里 characterization 提交早于 TS 改写提交。
- [ ] AC2（等价）同一组输入（正常合并 / 冲突 / 空批 / 参数缺失，至少 4 类）下，旧 bash 与新 TS 的退出码、stdout 关键行、对 git 仓库产生的 ref/提交结果逐项一致（贴对照表）。
- [ ] AC3（内嵌解释器清零）`sh-census-check.ts --json` 中本脚本的 `embedded` 为空或该脚本被薄入口取代（≤25 行且仅 exec TS）；`plugin/sh-census-baseline.json` 的 `embeddedInterpreterLines` 按实际下降同步下调（只降不升）。
- [ ] AC4（调用方不断）上述 6 个调用方（`develop-deliver-tgz.sh`、`full-suite-runner.ts`、`orphan-session-check.ts`、`retired-clause-check.ts`、`runner-static-gate.ts`、`sync-lag-check.sh`）各自的测试单独跑并贴结果，全绿。
- [ ] AC5（生产载体，硬规则 4 推论三）落地后时间窗内，一次**真实**的 `develop-deliver` 或 fan-in 批合并经新 TS 路径完成：贴对应运行记录（时间戳晚于落地提交）；关掉 fixture 后仍成立。
- [ ] AC6（catalog 与无新环）`capability-catalog.sh --summary` 声明数一致、`0 unclassified`；`import-graph-check.ts --json` `verdict.ok=true`。
- [ ] AC7（回归面）`scripts/test.sh --for-task gap-arch-tsify-integration-batch-merge-sh` 全绿。

## DoD

真实落地：真实批合并已走过新 TS 实现（AC5），旧 bash 对同一输入的行为已被 characterization 钉住并证明等价（AC1/AC2），`embeddedInterpreterLines` 读数真实下降。

## Touches

- plugin/scripts/integration-batch-merge.sh
- plugin/scripts/integration-batch-merge.ts (new)
- plugin/test/integration-batch-merge-characterization.test.mjs (new)
- plugin/scripts/capability-catalog-declarations.json
- plugin/sh-census-baseline.json
- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/sync-lag-check.sh
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/orphan-session-check.ts
- plugin/scripts/retired-clause-check.ts
- plugin/scripts/runner-static-gate.ts
- tasks/gap-arch-tsify-integration-batch-merge-sh.md
