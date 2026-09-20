---
id: gap-arch-tsify-checker-mutation-check-sh
title: shell→TS（SPEC Phase 5.2）：checker-mutation-check.sh（490 行）改写为 TS，先做
  characterization；mutation-cases 目录的 sh 用例不在本任务范围
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**把 `plugin/scripts/checker-mutation-check.sh`（490 行）改写为 `plugin/scripts/checker-mutation-check.ts`，`.sh` 留作薄入口一个发布周期。SPEC-architecture-consolidation §5 Phase 5.2；GOAL-B 的量来源之一。**

**这个脚本的特殊性（为什么 characterization 尤其要紧）**：它本身是「让检查器能取假」的**突变仪器**（AC-224 一族依赖它证明检查器不是恒绿）。改写时若悄悄改变它的突变判据，等于让整个「能取假」保证静默失效，而且**与「一切正常」同形**（硬规则 3b）。⇒ characterization 必须对**每个既有 mutation case**钉住「注入后检查器变红」的结果。

**范围界定（不要越界）**：`plugin/scripts/checker-mutation-cases/*.sh`（用例文件，按 basename 与被测检查器同名）是**数据/用例**，不是本脚本；本任务**不改写它们**。已知相邻任务 `gap-checker-mutation-parallel-case-loop`、`gap-checker-mutation-cases-4-checkers`、`gap-checker-mutation-check-has-no-change-tier-companion` 各管一块——实现前先读它们的状态，避免与在飞任务抢文件；有冲突写进 notes。

## AC

- [ ] AC1（characterization 先于改写，取假）新测试 `plugin/test/checker-mutation-check-characterization.test.mjs` 在**未改动的旧 bash** 上先落盘并全绿；对旧 bash 注入一处判据改动（例如让「突变后仍绿」被判为通过），该测试必须红，撤销后绿。两次输出贴进 notes，且 characterization 提交早于 TS 改写提交。
- [ ] AC2（逐用例等价，枚举非布尔）对 `checker-mutation-cases/` 下**每个**用例，旧 bash 与新 TS 对「突变前绿 / 突变后红」的判定与退出码一致；贴逐用例对照表，用例数与目录里的用例文件数相同（缺一即不合格）。
- [ ] AC3（不许把「读不懂」伪装成合格，硬规则 3b）对一个格式错误的用例文件，新 TS 必须给出**独立的「未评估」取值**（非 0 退出或显式 `evaluated:false`），不得与「全部通过」同形；贴该输出，并对旧 bash 同输入的行为做对照。
- [ ] AC4（内嵌解释器/行数读数）`sh-census-check.ts --json` 显示本脚本不再含内嵌解释器（或被 ≤25 行薄入口取代）；`plugin/sh-census-baseline.json` 只降不升地下调。
- [ ] AC5（生产载体，硬规则 4 推论三）落地后时间窗内，一次**真实**运行该突变仪器对真实检查器给出读数（贴时间戳晚于落地提交的运行记录）；关掉 fixture 仍成立。
- [ ] AC6（调用方与无新环）`axis-generator.ts`、`checked-in-write-check.ts` 及 `checker-mutation-cases/*.sh` 对它的引用不断，各自测试单独跑并贴结果；`capability-catalog.sh --summary` 声明数一致；`import-graph-check.ts --json` `verdict.ok=true`。
- [ ] AC7（回归面）`scripts/test.sh --for-task gap-arch-tsify-checker-mutation-check-sh` 全绿。

## DoD

真实落地：突变仪器新实现对真实检查器跑出过读数（AC5），且每个既有用例的突变判定与旧实现逐项一致（AC2）。「读不懂输入」有独立取值（AC3）。

## Touches

- plugin/scripts/checker-mutation-check.sh
- plugin/scripts/checker-mutation-check.ts (new)
- plugin/test/checker-mutation-check-characterization.test.mjs (new)
- plugin/scripts/capability-catalog-declarations.json
- plugin/sh-census-baseline.json
- plugin/scripts/axis-generator.ts
- plugin/scripts/checked-in-write-check.ts
- tasks/gap-arch-tsify-checker-mutation-check-sh.md
