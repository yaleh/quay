---
id: gap-arch-ac917-server-state-core-boundary
title: 按职责断环：server-state.ts 下沉 core/、根包不 import ./serve/、observation
  不回指根包（GOAL-910 AC-917）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-917
---
## Proposal

**事实（2026-10-22 立案当轮实测，HEAD `2d1edf094b0c4c52de031c823ff63fca179d9870`）**：AC-917 判据在真实树上为红。

```
$ node --experimental-strip-types packages/quay/bin/quay.ts goal get AC-917 --json | jq -r .criterion > .quay/ac917-criterion.sh
$ bash .quay/ac917-criterion.sh
CAUSE=server-state.ts must live in packages/quay/src/core/ (shared runtime carrier), not in serve/
exit=1
```

三个子谓词的实测读数：

- `packages/quay/src/serve/server-state.ts` 存在，`packages/quay/src/core/server-state.ts` 不存在；
- 根目录文件 import `./serve/`：**2 个**（`goal-preview.ts:47`、`loaded-version.ts:35`）；
- `packages/quay/src/observation/*.ts` 以 `../X.ts` 回指根目录模块：**4 处**（`model.ts:14`、`events.ts:13`、`blocking.ts:11`、`liveness.ts:20`）。

**为什么必须按职责做，而不是让环消失就行**：AC-917 的 expect 明确排除了「把 `goal-preview.ts` 也搬进 `serve/`」这类手法——环同样会消失，但 UI 层会反过来持有核心预览逻辑，职责更乱。正向修法是三个归位：

1. `server-state.ts` → `core/`：它是统一服务进程的运行时状态载体，被根包（`goal-preview.ts`、`loaded-version.ts`）、`cli/`、`serve/` 与 `plugin/scripts` 共用，自身只依赖 `kernel/write-json-atomic.ts` 与 node 内置模块，符合 core 的叶子约束。
2. `observation/*.ts` 直取真身 `../core/types.ts`：`abi.ts` 只是 `export * from "./core/types.ts"` 的对外 ABI 门面（GOAL-907 保留），内部模块不应经门面取 `TaskStatus` / `TASK_STATUS`。
3. `start-end-like.ts` → `kernel/`：它零 import、被根部门面 `observation.ts` 与 plugin 共用，属 kernel 的单一定义；`kernel/` 边界规则（`plugin/scripts/import-graph-check.ts` 第四条）要求它保持零 import。

**执行细则（避免按名字搬）**：

- `git mv packages/quay/src/serve/server-state.ts packages/quay/src/core/server-state.ts`，文件内容逐字不变（纯归位），同步更新全部 import 方：`goal-preview.ts`、`loaded-version.ts`、`cli/server.ts`、`serve/serve.ts`、`serve/index.ts`（barrel 改指 `../core/server-state.js`）、`plugin/scripts/driver-runtime.ts`、`packages/quay/test/server-status-web-control-same-pid.test.mjs`，以及 `plugin/scripts/serve-binding-literal-check.ts` 的 `ADVISORY_ALLOWLIST` 与 `plugin/scripts/checker-mutation-cases/serve-binding-literal-check.sh` 的 fixture 路径。
- `git mv packages/quay/src/start-end-like.ts packages/quay/src/kernel/start-end-like.ts`，同步更新 `packages/quay/src/observation.ts:54`、`observation/events.ts:13`、`plugin/scripts/fast-mode-telemetry.ts:147` 的动态 import（及其 1372 附近注释）、`plugin/test/start-end-like-ssot.test.mjs:46` 的 `LEAF_REL`。
- `observation/{model,blocking,liveness}.ts` 的 `../abi.ts` → `../core/types.ts`。
- `plugin/test/design-evolution-readings.test.mjs:692` 的 serve 子系统 modules glob 增加 `packages/quay/src/core/server-state*.ts`（不加则该读数会因模块集缩小而漂移）。
- `plugin/test/import-graph-check.test.mjs:543` 把 `packages/quay/src/serve/server-state.ts` 改为新路径（该行在 `reverseEdges` 非空时是 pin；当前读数可能为 0 而早退，但路径字面量不该指着一个已搬走的文件）。
- ⛔ 不改 `plugin/fixtures/ownership-*/**.arch.json` 里的历史路径——那是录制时的来源快照，改了会破坏 provenance。
- ⛔ 不回退 serve/、observation/ 两次拆分；不改 `abi.ts` 的对外门面地位；不顺手改 serve* 的其它文件位置。

**回归守卫**：新增 `packages/quay/test/architecture-boundaries.test.mjs`，按位置解析（行首 `import` / `export … from`，不匹配注释与字符串）编码 AC-917 的三个谓词，三个臂：①真实树三条全过；②合成 fixture 分别违反三条中的每一条 ⇒ 被报出（判据能取假）；③扫描面解析不出任何跨目录 import ⇒ 判为 instrument-failure，而不是「通过」（硬规则 3b）。

<!-- dedup-ref -->**与既有任务的关系**：`gap-arch-directory-cycle-src-observation-serve`（ready，`goal_ac: AC-916`）覆盖同一组文件的目录环判据，本条只承载 AC-917 的职责边界判据；两者 Touches 重叠，由调度器串行、不并发。若 peer 先落地，本条按「验证 + 守卫」收尾即可；若本条先落地，peer 的 AC-916 判据随之转绿。合并判断 = separate：两条 AC 各自需要独立 carrier（driver 的 goal-AC 核验读顶层 `goal_ac`），且验收面不同（目录级 SCC vs 职责归位）。

## AC

- [x] AC1 正向（AC-917 判据本体）：`node --experimental-strip-types packages/quay/bin/quay.ts goal get AC-917 --json | jq -r .criterion > .quay/ac917-criterion.sh && bash .quay/ac917-criterion.sh` ⇒ exit 0，stdout 为 `OK: server-state in core/, root imports no ./serve/, observation reaches no root module`；改动前同一命令 exit 1，stderr 为 `CAUSE=server-state.ts must live in packages/quay/src/core/ (shared runtime carrier), not in serve/`。贴出红/绿两份输出与 HEAD sha。
- [x] AC2 取假（判据点名的边正确）：`cp` 备份 `packages/quay/src/observation/model.ts` 后把 import 临时改回 `../abi.ts` ⇒ AC1 的判据 exit 1，stderr 为 `CAUSE=1 import(s) in packages/quay/src/observation/ still reach a root-level module via ../X.ts (want 0: import core/ or kernel/)`；`cp` 恢复后 ⇒ exit 0。⛔ 不用 `git checkout --`。贴红/绿输出。
- [x] AC3 新回归守卫三臂：`node --test packages/quay/test/architecture-boundaries.test.mjs` exit 0，且输出里三个臂都在：①真实树三谓词全过；②合成 fixture 对每条谓词分别取假；③零解析边 ⇒ instrument-failure 而非「0 违规」。贴出合成臂与 instrument-failure 臂的实际输出。
- [x] AC4 模块图棘轮与 kernel 边界：`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` ⇒ `evaluated:true` 且 `valueSccs` / `typeSccs` / `reverseEdges` / `kernelViolations` 全为 0；`node --test plugin/test/import-graph-check.test.mjs` exit 0。贴输出。
- [x] AC5 SSOT 与行为不变：`node --test plugin/test/start-end-like-ssot.test.mjs` exit 0（`isStartLike` / `isEndLike` 全仓仅一个声明站点，迁移后仍在 `packages/quay/src` 扫描面内）；`node_modules/.bin/tsc --noEmit -p packages/quay/tsconfig.json` exit 0；`node --test packages/quay/test/server-status-web-control-same-pid.test.mjs` exit 0（该测试从新路径 import 状态载体）。贴输出。
- [x] AC6 5b 邻近扫描：在 `packages/quay/src` 内 grep 其它「子目录 .ts 经 `../X.ts` 回指根目录模块」的边与其它「根目录文件 import `./serve/`」的边，把命中数与前 3 条贴进 Evidence；命中且同属本条断环机制的一并改，其余逐条写明为何不在本条范围。

## DoD

- [x] 真实仓库（非夹具）上 AC-917 判据逐字读绿，读数是判据原文实跑得到的；⛔ 不是靠「把 `goal-preview.ts` 搬进 serve/」这类让环消失但职责更乱的手法。
- [x] 落地 diff 是纯归位：`git show --stat` 可见 `packages/quay/src/serve/server-state.ts → packages/quay/src/core/server-state.ts` 与 `packages/quay/src/start-end-like.ts → packages/quay/src/kernel/start-end-like.ts` 两个 rename（前者内容逐字不变）；`abi.ts` 未改动，serve/ 与 observation/ 两次拆分未回退。
- [x] `packages/quay/test/architecture-boundaries.test.mjs` 进入全量 suite，并在 fan-in 的 scoped 门与全量跑中为绿；改动经 ff-merge 进入 develop。

## Evidence

**执行环境**：worktree `/home/yale/work/quay-worktrees/gap-arch-ac917-server-state-core-boundary`，实现提交 HEAD `163902b0b`，分叉点/merge-target `develop` = `f1919cdbc`（`git merge --no-edit develop` ⇒ Already up to date）。
**Peer 先落地**：`gap-arch-directory-cycle-src-observation-serve` 已由 driver 机械 fan-in 落地（develop `ddb48368a`），三个归位已在树上 ⇒ 本条按 Proposal 约定以「验证 + 守卫」收尾。

### AC1 — 正向（真实树，判据原文实跑）

```
$ node --experimental-strip-types packages/quay/bin/quay.ts goal get AC-917 --json | ... > .quay/ac917-criterion.sh
$ git rev-parse HEAD
f1919cdbc7bf0e40f7f04fdb4521b4460bbdfe16
$ bash .quay/ac917-criterion.sh
OK: server-state in core/, root imports no ./serve/, observation reaches no root module
exit=0
```

红侧（判据能取假，`cp`/临时文件注入，⛔ 未用 `git checkout --`；注入物均在读数后删除，工作树归零）：

```
# P1 注入：cp packages/quay/src/core/server-state.ts packages/quay/src/serve/server-state.ts
CAUSE=server-state.ts must live in packages/quay/src/core/ (shared runtime carrier), not in serve/
exit=1
# P2 注入：根目录临时文件 import "./serve/serve-adr.ts"
CAUSE=1 root-level file(s) under packages/quay/src still import ./serve/ (want 0)
exit=1
# 删除注入物后
OK: server-state in core/, root imports no ./serve/, observation reaches no root module
exit=0
```

立案当轮（Proposal 记录，HEAD `2d1edf094b0c4c52de031c823ff63fca179d9870`）的红侧输出即上列 P1 `CAUSE=...` / exit=1。

### AC2 — 取假（点名的边正确）

```
$ cp packages/quay/src/observation/model.ts /tmp/ac917-model.ts.bak    # md5 ad4789ac32c612c1adb42475ce63c134
$ sed -i 's|from "../core/types.ts"|from "../abi.ts"|' packages/quay/src/observation/model.ts
$ bash .quay/ac917-criterion.sh
CAUSE=1 import(s) in packages/quay/src/observation/ still reach a root-level module via ../X.ts (want 0: import core/ or kernel/)
exit=1
$ cp /tmp/ac917-model.ts.bak packages/quay/src/observation/model.ts     # md5 仍为 ad4789ac32c612c1adb42475ce63c134
$ bash .quay/ac917-criterion.sh
OK: server-state in core/, root imports no ./serve/, observation reaches no root module
exit=0
```

### AC3 — 新回归守卫三臂（`node --test packages/quay/test/architecture-boundaries.test.mjs`，exit 0）

```
[arm1] scanned=32 importEdges=85 crossDirEdges=50 violations=0
[arm2-baseline] evaluated=true crossDirEdges=1 violations=0
[arm2-P1] server-state.ts must live in core/server-state.ts (core=MISSING), not serve/server-state.ts (serve=PRESENT)
[arm2-P2] goal-preview.ts:1 imports "./serve/serve-adr.ts" — root-level modules must not depend on serve/ (the UI layer imports core, never the reverse)
[arm2-P3] observation/model.ts:1 imports "../abi.ts" — observation/ must reach core/ or kernel/ directly, not a root-level module
[arm2-position] evaluated=true violations=0 importEdges=1
[arm3] evaluated=false reason=no cross-directory import was parsed from 2 scanned file(s) — the reader is blind, so this is NOT a clean result violations=0
ℹ tests 8  ℹ pass 8  ℹ fail 0
```

- 臂①真实树：P1/P2/P3 全过（violations=0），且 `crossDirEdges=50>0`（否则臂③的守卫没有意义）。
- 臂②合成 fixture：基线 fixture 干净；分别注入 P1/P2/P3 违反后各自被点名（`predicate` 恰为 P1/P2/P3）；另有一条 position-based 断言：注释/字符串里出现 `./serve/`、`../abi.ts` 不算边（importEdges=1，violations=0）。
- 臂③零解析边：`evaluated:false` + 非空 reason，⛔ 不与「0 违规」同形（硬规则 3b）。
- 解析器不是新造的：复用 `plugin/scripts/import-graph-check.ts` 的 `extractImports`（底层 `buildNonCodeMask`），按位置判定。

### AC4 — 模块图棘轮与 kernel 边界

```
$ node --experimental-strip-types plugin/scripts/import-graph-check.ts --json
{"evaluated":true,"valueSccs":0,"typeSccs":0,"reverseEdges":0,"kernelViolations":0,"kernelChecked":true}
exit=0
$ node --test plugin/test/import-graph-check.test.mjs
ℹ tests 31  ℹ pass 31  ℹ fail 0
```

该测试的 reverse-edge pin（`import-graph-check.test.mjs:543`）已从已搬走的 `packages/quay/src/serve/server-state.ts` 改为 `packages/quay/src/core/server-state.ts`。

### AC5 — SSOT 与行为不变

```
$ node --test plugin/test/start-end-like-ssot.test.mjs
✔ ② SSOT — isStartLike is DECLARED in exactly one place (packages/quay/src/kernel/start-end-like.ts)
✔ ② SSOT — isEndLike is DECLARED in exactly one place (packages/quay/src/kernel/start-end-like.ts)
ℹ tests 8  ℹ pass 8  ℹ fail 0
$ node_modules/.bin/tsc --noEmit -p packages/quay/tsconfig.json
exit=0
$ node --test packages/quay/test/server-status-web-control-same-pid.test.mjs
✔ AC4 — the built dist bundle is a working unified server too (the shipped entry, not just the source)
ℹ tests 14  ℹ pass 14  ℹ fail 0
```

环境前置说明：worktree 初始没有 `packages/quay/dist`，`helpers/cli-entry.mjs` 按设计回退 `.ts` 入口并让 dist 臂报红（memory: `dispatch-worktree-has-no-packages-dist-so-isolated-runs-fall-back-to-ts`）。先 `node packages/quay/scripts/build-dist.mjs` 建包（dist/ gitignored）后 14/14 绿；该测试已从 `../src/core/server-state.ts` import 状态载体。

### AC6 — 5b 邻近扫描

A) 子目录 `.ts` 经 `../X.ts` 回指**根目录模块**的边：**65 处**（按子目录：serve 33 / cli 28 / fan-in 4）。前 3 条：

```
packages/quay/src/cli/action.ts:6:import { composePayload, deliverTrigger } from "../action.ts";
packages/quay/src/cli/lanes.ts:27:import { readLive, readWorkerOutcomeRecords } from "../observation.ts";
packages/quay/src/cli/lanes.ts:28:import { FIXED_GANTT_LANES, mergeLiveAndHistoryIntervals, packLanes, ... } from "../dashboard-kernel.ts";
```

为何不在本条范围：AC-917 的 P3 只约束 `observation/`，因为该环的另一半是根部门面 `observation.ts` → `observation/*`；`cli/`、`serve/`、`fan-in/` 的目标根模块不反向 import 这些子目录 —— `import-graph-check` 实测 `valueSccs=0` / `typeSccs=0`，这 65 条边不构成环。改它们属于另一套分层判据，会让本条的「纯归位」落地 diff 失真。

B) 根目录文件 import `./serve/`：**0 处**（AC-917 的 P2 读数；`grep -lE "from ['\"]\./serve/" packages/quay/src/*.ts | wc -l`）。

C) 路径已搬走但仍被**注释**引用的字面量（不是 import 边，无行为影响，且不在本条 Touches ⇒ 不在本条改，避免扩大落地 diff）：

```
plugin/scripts/live-web-address.ts:23,57        # 注释：读契约 = packages/quay/src/serve/server-state.ts
plugin/scripts/start-drivers.ts:427             # 注释：同上
packages/quay/test/ac289-...:12 / ac291-...:13 / ac301-...:225   # 注释
plugin/vendor/quay/dist/quay.js                 # gitignored 构建产物，重建即刷新（B 类计数不含它）
```

D) 历史任务体（`tasks/gap-arch-directory-cycle-*`、`tasks/gap-routine-semantic-dedup-*`）保留旧路径——记录快照，按 Proposal ⛔ 不改。

### DoD 对应读数

- AC-917 在**真实树**逐字读绿（见 AC1），不是靠「把 `goal-preview.ts` 搬进 serve/」。
- rename 证据（peer 落地的 develop 提交 `ddb48368a`，`git show --stat --summary`）：

```
packages/quay/src/{serve => core}/server-state.ts  | 0
packages/quay/src/{ => kernel}/start-end-like.ts   | 6 +
```

  `packages/quay/src/abi.ts` 未出现在该提交（门面地位未变）；serve/ 与 observation/ 两次拆分未回退。本条自己的落地 diff 只新增守卫 + 一处 pin 路径。
- scoped 门实跑：`bash scripts/test.sh --for-task gap-arch-ac917-server-state-core-boundary --allow-thin` ⇒ exit 0，`tests 356 / pass 356 / fail 0`，输出含 `+ packages/quay/test/architecture-boundaries.test.mjs`（守卫已被 scoped 门选中并执行）。全量 suite 与 ff-merge 由 driver fan-in 机械执行。

## Touches

- tasks/gap-arch-ac917-server-state-core-boundary.md
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
- plugin/scripts/serve-binding-literal-check.ts
- plugin/scripts/checker-mutation-cases/serve-binding-literal-check.sh
- plugin/test/start-end-like-ssot.test.mjs
- plugin/test/design-evolution-readings.test.mjs
- plugin/test/import-graph-check.test.mjs
- packages/quay/test/server-status-web-control-same-pid.test.mjs
- packages/quay/test/architecture-boundaries.test.mjs
