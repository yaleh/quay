---
id: gap-arch-directory-cycle-src-observation-serve
title: 断开 e7e84366a/d21a018aa 引入的目录环 {., observation, serve}：server-state 下沉
  core/、observation 直取 core/types、start-end-like 下沉 kernel/（GOAL-910 AC-916）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-916
---
## Proposal

**事实（2026-10-22 立案当轮实测）**：`packages/quay/src` 的目录级依赖图有一个成员数 3 的强连通分量 `{".", "observation", "serve"}`，内部跨目录边共 45 条，四个方向都有桥：

- `. → serve`（2 条）：`goal-preview.ts:47`、`loaded-version.ts:35` 经 `./serve/server-state.ts`。`server-state.ts` 自身只依赖 node 内置与 `../kernel/write-json-atomic.ts`，却被根包、`cli/`、`serve/`、`plugin/scripts` 共用——它是统一服务进程的运行时状态载体，按文件名被搬进 UI 层是错的。
- `serve → .`（31 条）：serve/* 经 `../provider-client.ts`、`../observation.ts`、`../abi.ts` 等回指根包（这个方向本身是正常的）。
- `. → observation`（8 条）：根部门面 `observation.ts` 转出 `./observation/*.ts`（这个方向本身也是正常的）。
- `observation → .`（4 条）：`model.ts:14`、`blocking.ts:11`、`liveness.ts:20` 经 `../abi.ts` 取 `TaskStatus`/`TASK_STATUS`，`events.ts:13` 经 `../start-end-like.ts` 取两个谓词。这两者都是「内部模块依赖对外门面 / 根目录实现」，不是职责需要。

**成因是两次搬家提交**：e7e84366a 把 serve* 族按文件名搬进 `src/serve/`（server-state.ts 被一并搬入）；d21a018aa 把 observation.ts 拆成根部门面 + `observation/` 子目录（子模块回指根包门面）。所以修法是按职责归位，不是回退这两次拆分：

1. `server-state.ts` → `core/`：它被多层共用、自身只依赖 kernel 与 node 内置，属于下层而非 UI 层。
2. observation 子模块直取真身 `../core/types.ts`：`abi.ts` 只是 `export * from "./core/types.ts"` 的对外 ABI 门面（GOAL-907 保留），内部模块不应经门面取符号。
3. `start-end-like.ts` → `kernel/`：它零 import、被 plugin 与 Core 共用，属 kernel 的单一定义。

**与 AC-917 的关系**：AC-917 的判据（server-state 位于 `core/`、根目录不再 import `./serve/`、observation 不再用 `../X.ts` 引根目录模块）由同一组改动满足；本条以 AC-916 的目录级环判据为终态，两条判据都要实跑贴出。

<!-- dedup-ref -->合并判断 = separate：`task-granularity-advice` 实测 peer 只有 `gap-instrument-decay-check-unwired-and-blind-to-content-dark`（同为 `plugin/scripts/driver-runtime.ts`），机制不同（那条修仪器暗态检测），由调度器按 Touches 串行。相关任务 `gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts`（needs-human）修的是「本该发现这个环的常驻例程」，不在本条范围。

## Plan

1. `git mv packages/quay/src/serve/server-state.ts packages/quay/src/core/server-state.ts`，更新全部 import 方：`goal-preview.ts`、`loaded-version.ts`、`cli/server.ts`、`serve/serve.ts`、`serve/index.ts`（barrel 改指新路径）、`plugin/scripts/driver-runtime.ts`、`packages/quay/test/server-status-web-control-same-pid.test.mjs`；同步修正文件头注释里对旧路径的引用。⛔ 不改 `plugin/fixtures/ownership-*/**.arch.json` 里的历史路径——那是录制时的来源快照，改了会破坏 provenance。
2. observation 子模块直取真身：`blocking.ts`、`liveness.ts`、`model.ts` 的 `../abi.ts` → `../core/types.ts`；同步更新 `model.ts` 头部「唯一 import 是 ABI 的 TaskStatus」的说明。
3. `git mv packages/quay/src/start-end-like.ts packages/quay/src/kernel/start-end-like.ts`，更新 import 方：根部门面 `observation.ts:54`、`observation/events.ts:13`、`plugin/scripts/fast-mode-telemetry.ts:147` 的动态 import（以及该文件 1372 附近的注释）、`plugin/test/start-end-like-ssot.test.mjs:46` 的 `LEAF_REL`。`kernel/` 边界规则（`plugin/scripts/import-graph-check.ts` 第四条：kernel 文件不得 import kernel/ 之外的模块）要求它保持零 import。
4. 新增回归守卫 `packages/quay/test/directory-cycle.test.mjs`：实现与 AC-916 criterion 相同的解析（行首 `import`/`export…from` + 仓库内相对路径 → 目录级 SCC），三个臂：①真实仓库 0 个 SCC；②临时 fixture 里造一个两目录互相 import 的环 ⇒ 被报出；③一条跨目录边都解析不出来 ⇒ 判为 instrument-failure，而不是「0 个环」。
5. 范围外（不要扩大）：不动 `abi.ts` 的对外门面地位；不回退 serve/、observation/ 的拆分；不修 archguard 环检测例程（那是 `gap-arch-cycle-report-…` 的事）；不顺手改 serve* 的其它文件位置。

## AC

- [ ] AC1 正向（AC-916 判据本体）：`node --experimental-strip-types packages/quay/bin/quay.ts goal get AC-916 --json | jq -r .criterion > .quay/ac916-criterion.sh && bash .quay/ac916-criterion.sh` ⇒ exit 0，stdout 为 `OK: 0 directory cycles under packages/quay/src ...`；改动前同一命令 exit 1，stderr 为 `CAUSE=directory cycle(s) under packages/quay/src: [[".","observation","serve"]]`。贴出红/绿两份输出与 HEAD sha。
- [ ] AC2 职责断环（AC-917 判据本体）：同一 HEAD 上 `node --experimental-strip-types packages/quay/bin/quay.ts goal get AC-917 --json | jq -r .criterion > .quay/ac917-criterion.sh && bash .quay/ac917-criterion.sh` ⇒ exit 0（`OK: server-state in core/, root imports no ./serve/, observation reaches no root module`）。贴输出与 HEAD sha。
- [ ] AC3 取假（判据能取假、且点名的边正确）：`cp` 备份 `packages/quay/src/goal-preview.ts` 后把 import 临时改回 `./serve/server-state.ts` ⇒ AC1 的判据 exit 1，stderr 的 SCC 恰为 `[[".","serve"]]`；`cp` 恢复后 ⇒ exit 0。⛔ 不用 `git checkout --`。贴红/绿输出。
- [ ] AC4 模块图棘轮与 kernel 边界：`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` ⇒ `evaluated:true` 且 `valueSccs`/`typeSccs`/`reverseEdges`/`kernelViolations` 仍全为 0；`node --test plugin/test/import-graph-check.test.mjs` exit 0。贴输出。
- [ ] AC5 SSOT 棘轮：`node --test plugin/test/start-end-like-ssot.test.mjs` exit 0（测试②断言 `isStartLike`/`isEndLike` 全仓只有一个声明站点，迁移后仍在 `packages/quay/src` 扫描面内）。贴输出。
- [ ] AC6 行为不变：`node_modules/.bin/tsc --noEmit -p packages/quay/tsconfig.json` exit 0；`node --test packages/quay/test/server-status-web-control-same-pid.test.mjs` exit 0（后者从新路径 import 状态载体）。贴输出。
- [ ] AC7 回归守卫：`node --test packages/quay/test/directory-cycle.test.mjs` exit 0，且三个臂都在（真实树 0 SCC / 合成两目录环被报出 / 零跨目录边 ⇒ instrument-failure 而非 0 环）；贴出合成臂与 instrument-failure 臂的实际输出。
- [ ] AC8 5b 邻近扫描：在 `packages/quay/src` 内 grep 其它「子目录 .ts 经 `../X.ts` 回指根目录模块」的边与其它「根目录文件 import `./serve/`」的边，把命中数与前 3 条贴进 Evidence；命中且同属本条断环机制的一并改，其余逐条写明为何不在本条范围。

## DoD

- [ ] 真实仓库（非夹具）上 AC-916 与 AC-917 两条判据同时为绿，且读数是判据原文实跑得到的，不是靠「把 goal-preview.ts 也搬进 serve/」这类让环消失但职责更乱的手法。
- [ ] `abi.ts` 仍是唯一的对外 ABI 门面（外部 provider 的 import 面不变），serve/ 与 observation/ 的两次拆分未被回退；迁移是纯归位，无行为变化。
- [ ] 新回归测试进入全量 suite，并在 fan-in 的 scoped 门与全量跑中为绿；改动经 ff-merge 进入 develop。

## Touches

- tasks/gap-arch-directory-cycle-src-observation-serve.md
- packages/quay/src/core/server-state.ts
- packages/quay/src/serve/server-state.ts
- packages/quay/src/goal-preview.ts
- packages/quay/src/loaded-version.ts
- packages/quay/src/cli/server.ts
- packages/quay/src/serve/serve.ts
- packages/quay/src/serve/index.ts
- packages/quay/src/kernel/start-end-like.ts
- packages/quay/src/start-end-like.ts
- packages/quay/src/observation.ts
- packages/quay/src/observation/events.ts
- packages/quay/src/observation/blocking.ts
- packages/quay/src/observation/liveness.ts
- packages/quay/src/observation/model.ts
- plugin/scripts/driver-runtime.ts
- plugin/scripts/fast-mode-telemetry.ts
- plugin/test/start-end-like-ssot.test.mjs
- packages/quay/test/server-status-web-control-same-pid.test.mjs
- packages/quay/test/directory-cycle.test.mjs
