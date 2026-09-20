---
id: gap-arch-tsify-cross-machine-verify-sh
title: shell→TS（SPEC Phase 5.2）：cross-machine-verify.sh（489 行，内嵌 python3）改写为
  TS，先做 characterization
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**把 `plugin/scripts/cross-machine-verify.sh`（489 行，内嵌 python3）改写为 `plugin/scripts/cross-machine-verify.ts`，`.sh` 留作薄入口一个发布周期。SPEC-architecture-consolidation §5 Phase 5.2；GOAL-B 的量来源之一。**

**调用方（实测 `git grep`）**：`packages/quay/src/observation.ts`（产品层运行时引用）、`plugin/scripts/periodic-push-backup.sh`、`plugin/scripts/quay-init.sh`、以及测试 `packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs`。**⚠️ `observation.ts` 属产品层（packages/）**——它对该脚本是**运行时 spawn 引用而非 import 边**（同 `gap-arch-reverse-edges-zero` 对 `ff-merge.ts` spawn 的定性），本任务不得把它变成 import 边：⇒ 若改写后要让产品层调用新 TS，路径解析必须走既有的 sibling-script 解析机制（`siblingScriptArgv`），并遵守 dist 自包含（不得让 bundle 依赖只在开发检出里存在的 .ts）。

**⛔ 与 `quay-init.sh` 的冲突面**：`quay-init.sh` 正在被 `gap-quay-init-native-reconcile`（SPEC Phase 5.1）整体改写。本任务对 `quay-init.sh` **只允许改「调用 cross-machine-verify」的那一处调用点，或干脆不碰**（薄入口保留时调用点可零改动）——优先零改动，避免与 5.1 抢同一文件。

**跨机器语义**：该脚本的判据涉及另一台机器，characterization 不得依赖真实远端；用可注入的传输缝（本地假远端）钉住行为。相关背景见 `gap-no-post-merge-cross-machine-verification-detection-latency-is-luck`、`gap-cross-machine-readonly-observation-orchestration-not-a-tool`——本任务只搬运现有行为，不扩展跨机器能力。

## AC

- [ ] AC1（characterization 先于改写，取假）新测试 `plugin/test/cross-machine-verify-characterization.test.mjs` 在**未改动的旧 bash** 上先落盘并全绿（用本地假远端，不依赖真实机器）；对旧 bash 注入一处行为改动，测试必须红，撤销后绿。两次输出贴进 notes，且 characterization 提交早于 TS 改写提交。
- [ ] AC2（等价）至少 4 类输入（远端一致 / 远端落后 / 远端不可达 / 参数缺失）下，旧 bash 与新 TS 的退出码与 stdout 关键行逐项一致（贴对照表）；「远端不可达」必须给出**与「一致」不同形**的取值（硬规则 3b），两态输出贴出。
- [ ] AC3（内嵌解释器清零）`sh-census-check.ts --json` 显示本脚本不再含内嵌 python3（或被 ≤25 行薄入口取代）；`plugin/sh-census-baseline.json` 只降不升地下调。
- [ ] AC4（调用方不断）`observation.ts` 侧相关测试、`periodic-push-backup.sh` 的调用、`quay-init.sh` 的调用点各自验证并贴结果；`import-graph-check.ts --json` 的 `reverseEdges=[]` 且 `verdict.ok=true`（证明未引入 packages→plugin 边）。
- [ ] AC5（dist 自包含，生产载体）`bash packages/quay/scripts/package.sh` 产出的 bundle 中，产品层对该脚本的引用仍走 sibling 解析、不内联 `plugin/scripts/cross-machine-verify`；`grep -c` 读数贴出。
- [ ] AC6（生产载体，硬规则 4 推论三）落地后时间窗内，一次**真实**的跨机器验证运行经新 TS 路径产生读数（贴时间戳晚于落地提交的记录）；关掉本地假远端注入后仍成立。若当前环境无第二台机器，则把该条如实标 `NOT-EVALUATED` 并写明原因，不得用 fixture 顶替。
- [ ] AC7（回归面）`scripts/test.sh --for-task gap-arch-tsify-cross-machine-verify-sh` 全绿。

## DoD

真实落地：新 TS 实现经一次真实（非 fixture）运行产出读数，或 AC6 被如实标为未评估；characterization 钉住了旧行为并证明等价；产品层依赖方向未被破坏（AC4/AC5）。

## Touches

- plugin/scripts/cross-machine-verify.sh
- plugin/scripts/cross-machine-verify.ts (new)
- plugin/test/cross-machine-verify-characterization.test.mjs (new)
- plugin/scripts/capability-catalog-declarations.json
- plugin/sh-census-baseline.json
- plugin/scripts/periodic-push-backup.sh
- packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs
- tasks/gap-arch-tsify-cross-machine-verify-sh.md
