---
id: gap-goal033-driver-control-and-vocab-to-core
title: GOAL-033 ①：driver 控制客户端与 driver 词表从 cli/ 下沉到 core-root（core-root 零 cli/
  import，fan-in 仪器附加留在 CLI）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-350
---
**type:** execution

## Proposal

GOAL-033 的第一块（实现）：把 **driver 控制客户端**与 **driver 控制面词表**从 `packages/quay/src/cli/` 下沉到 core-root，使 core-root 对 `cli/` 的 import 归零，`cli` 离开 ArchGuard 报出的 package SCC（6 → 5）。

**已完成的调查（不在本任务重复，详见 GOAL-033 body「背景」）**——core-root → cli 恰好 2 条值边：

1. `packages/quay/src/serve-sessions.ts:20` `import { runDriver } from "./cli/driver.ts"`（唯一调用点 `handleDriverLifecycle`，POST /sessions/driver 的 start/stop/restart）；
2. `packages/quay/src/serve.ts:50` `import { ALL_SERVICE_NAMES, HOSTED_SERVICE_NAMES } from "./cli/driver-vocab.ts"`（`ALL_SERVICE_NAMES` 只被 `parseServiceList` 用；`HOSTED_SERVICE_NAMES` 在 `serve.ts` 内零使用，是死 import）。

Ownership 判断：这两处不是「CLI 渗透 core」，而是**两层共用的原语被放进了 `cli/`**——`runDriver`/`runDriverAsync` 是不碰 process 全局量的 driver 控制客户端（web 与 CLI 共用），`driver-vocab.ts` 是 driver 控制面 + 服务名词表（宿主 `serve.ts` 是 core）。真正属于 CLI 的只有 `handleDriver`（argv/帮助/stdout/exit）、`runDriverLog`/`runDriverLive`，以及下面这一段**呈现逻辑**。

**⚠️ 必须避开的搬壳陷阱**：`runDriver` 现在对 `status --kind worker` 调 `fan-in/ff-merge.ts::probeInstruments` 往 stdout 附加仪器读数（`withWorkerInstrumentReadings`）。`fan-in/ff-merge.ts` 已经 import core-root（`plugin-root`/`config`/`runtime-artifacts`），所以若把这段一起搬进 core-root，就会**新造一对 root⇄fan-in 互指**。实测这份附加读数只有 `quay driver status --kind worker` 的 CLI 输出会被看到（`cli/server.ts` 只解析具名字段、从不读 `instruments`；`serve-sessions` 只做 start/stop/restart）⇒ 它是 CLI 呈现职责，**留在 `cli/driver.ts`**。

## Plan

1. **词表下沉**：`git mv packages/quay/src/cli/driver-vocab.ts packages/quay/src/driver-vocab.ts`。内容逐字保留（`VERBS`/`KINDS`/`HOSTED_SERVICE_NAMES`/`DRIVER_SERVICE_KINDS`/`ALL_SERVICE_NAMES` 与全部注释），只把首行文件名改成新路径，并在头注释补一句「住在 core-root：core（`driver-control.ts`、`serve.ts`）与 CLI（`help.ts`/`driver.ts`/`server.ts`）共同消费，放在 `cli/` 会制造 core→cli 边」。**⛔ 必须保持零 import**（`help.ts` 被 `bin/quay.ts` 静态加载，头注释里记着 0.25s→0.67s 的实测成本）。**⛔ 不在 `cli/` 留任何 shim / 再导出文件。**

2. **新建 `packages/quay/src/driver-control.ts`**，从 `cli/driver.ts` **逐字搬入**：`resolveRoot`（改为 `export`）、`isWorktreeRoot`、`DriverRunResult`、`DriverInvocation`、`refusedInvocation`、`resolveDriverInvocation`、`runDriver`、`runDriverAsync`（连同它们的注释）。改动只有两处：
   - `DriverRunResult` 新增两个字段 `root: string | null` 与 `kernelPath: string | null`（拒绝路径为 `null`；成功路径为 `resolveDriverInvocation` 已经算出的 `inv.root`/`inv.kernelPath`）——让 CLI 层做仪器附加时**复用同一次解析结果**，⛔ 不做第二次 root/kernel 解析（硬规则 5b：第二份解析就是两边漂移的起点）。
   - `runDriver`/`runDriverAsync` 返回**原始** stdout，不再调用 `withWorkerInstrumentReadings`。
   允许的 import：`node:path`、`node:child_process`、`./config.ts`（`findConfig`）、`./plugin-root.ts`（`resolvePluginScriptExec`）、`./driver-vocab.ts`（`KINDS`/`VERBS`）。**⛔ 不得 import `./cli/` 任何文件；⛔ 不得 import `./fan-in/` 任何文件。**

3. **`packages/quay/src/cli/driver.ts` 收窄为 CLI facade**：删除第 2 步搬走的全部定义（⛔ 不留第二份实现、⛔ 不留 `runDriver`/`runDriverAsync` 的再导出）；`import { runDriver, resolveRoot } from "../driver-control.ts"`；把原 `import { KINDS, VERBS } from "./driver-vocab.ts"; export { KINDS, VERBS };` 改为从 `"../driver-vocab.ts"` 取并保留再导出（`plugin/test/helpers/goal-driver-harness.mjs:103` 经 `cli/driver.ts` 取 `KINDS`，这是 cli→core 的正常方向，纯再导出）。`withInstrumentReadings`、`withWorkerInstrumentReadings`、`probeInstruments` 的 import **留在本文件**；`handleDriver` 在拿到 `runDriver` 结果后，若 `r.ok && r.root !== null && r.kernelPath !== null`，对 stdout 调 `withWorkerInstrumentReadings(sub, flags.kind, r.stdout, r.root, r.kernelPath)`——与搬迁前 `quay driver status --kind worker` 的输出逐字一致。

4. **消费者改口（每个都要真实改 import，不靠再导出兜底）**：
   - `packages/quay/src/serve-sessions.ts`：`import { runDriver } from "./driver-control.ts"`；
   - `packages/quay/src/serve.ts`：`import { ALL_SERVICE_NAMES } from "./driver-vocab.ts"`（顺带去掉未使用的 `HOSTED_SERVICE_NAMES`——这一行本来就要改路径）；
   - `packages/quay/src/cli/server.ts`：`import { runDriver, runDriverAsync } from "../driver-control.ts"` 与 `import { ALL_SERVICE_NAMES, DRIVER_SERVICE_KINDS, HOSTED_SERVICE_NAMES } from "../driver-vocab.ts"`。注意：`cli/server.ts` 以前拿到的 worker status stdout 带仪器附加，搬迁后不带——它只解析具名字段、从不读 `instruments`，故不可观测；在 Evidence 里写明这一点并用 `packages/quay/test/server.test.mjs` 全绿作证；
   - `packages/quay/src/cli/help.ts`：`from "../driver-vocab.ts"`；
   - 测试：`packages/quay/test/server.test.mjs` 改从 `../src/driver-control.ts` 取 `runDriver`/`runDriverAsync`；`packages/quay/test/cli.test.mjs:156` 改从 `../src/driver-vocab.ts` 取 `KINDS`/`VERBS`。

5. **机械检查器的路径同步（只改路径，不改语义）**：`plugin/scripts/enum-surface-parity-check.ts` 里 6 处 `packages/quay/src/cli/driver-vocab.ts`（`driver-verb`、`cli-driver-kinds` 两个面的 `file:`，以及 `cli-driver-help-kind`/`cli-help-kind`/`cli-help-driver-usage-verbs`/`cli-driver-usage-verbs` 四个面的 `derivesFrom.file`）改为 `packages/quay/src/driver-vocab.ts`；**⛔ 面 id 一律不改**（硬规则 8）。已实测：路径不改时该检查器给 `ok:false, status:"not-evaluated", exit 3`，不会静默通过。再读 `plugin/scripts/runner-static-gate.ts:841` 那行 `@static-object` 清单的语义，若它枚举的是该检查器读取的源文件，则把 `packages/quay/src/driver-vocab.ts` 补进去（`cli/driver.ts` 仍在其中，因为帮助文本仍在那里）。

6. **新增 `packages/quay/test/driver-control.test.mjs`**：(a) 拒绝路径（未知 verb / 未知 kind / 无 config 的 root）返回 `ok:false` 且 `root:null, kernelPath:null`；(b) 源码按位置判定（剥注释后）：`driver-control.ts` 与 `driver-vocab.ts` 都不含 `./cli/` 或 `./fan-in/` 的 import，`driver-vocab.ts` 零 import 行；(c) **CLI 呈现契约**（迁移前没有任何测试钉住它）：在 bare workspace 上跑 `quay driver status --kind worker --json` ⇒ JSON 帧含 `instruments` 键；`--kind promotion` ⇒ 不含。

7. **负对照（取假）**：在 scratch 副本里把 `serve-sessions.ts` 的 import 改回 `"./cli/driver.ts"`（取一个仍存在的导出，如 `handleDriver`），对该副本跑 AC-350 判据的扫描部分 ⇒ 必须 `CAUSE=core-root-still-imports-cli`；再把 `import { probeInstruments } from "./fan-in/ff-merge.ts"` 加进副本的 `driver-control.ts` ⇒ 必须 `CAUSE=new-root-to-fan-in-edge`。命令与两次输出进 `## Evidence`。

8. **构建产物派生**：`deriveEntries` 是扫描 Core 对 `scripts/driver-runtime.ts` 的引用来派生 dist 入口的——引用从 `cli/driver.ts` 移到 `driver-control.ts` 后必须仍被派生（`packages/quay/test/build-plugin-dist.test.mjs` 的 AC1/AC6 一字不改全绿）。若不再派生，修的是派生扫描范围，⛔ 不是往测试里加白名单。

## Acceptance Criteria

- [ ] AC-350 判据在本任务 worktree 内 exit 0：`bash -c "$(node --experimental-strip-types packages/quay/bin/quay.ts goal show AC-350 --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).criterion))')"`，输出原文进 `## Evidence`
- [ ] `packages/quay/src/cli/driver-vocab.ts` 不存在，`packages/quay/src/driver-vocab.ts` 零 import 行；`runDriver`/`runDriverAsync`/`resolveDriverInvocation` 在 `packages/quay/src/**` 下各只有 `driver-control.ts` 一处定义
- [ ] `driver-control.ts` 不 import `./cli/` 也不 import `./fan-in/`；`probeInstruments` 的调用只出现在 `cli/driver.ts`
- [ ] 回归一字不改全绿：`packages/quay/test/server.test.mjs`、`packages/quay/test/serve-handlers.test.mjs`（POST /sessions/driver 那组）、`packages/quay/test/cli.test.mjs`、`packages/quay/test/cli-live.test.mjs`、`packages/quay/test/serve-sessions-body-i18n.test.mjs`、`packages/quay/test/build-plugin-dist.test.mjs`、`plugin/test/enum-surface-parity-check.test.mjs`、`plugin/test/goal-driver-s01.test.mjs`（经 harness 从 `cli/driver.ts` 取 `KINDS`）——import 路径的必要改动除外，断言不改
- [ ] 新增 `packages/quay/test/driver-control.test.mjs` 三组用例全绿，其中 CLI 呈现契约用例在 worker / promotion 两个方向各有断言
- [ ] `node --experimental-strip-types plugin/scripts/enum-surface-parity-check.ts --root . --json` 为 `ok:true, status:"pass", notEvaluated:[]`；`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` 的 `verdict.ok === true`
- [ ] 负对照（Plan 第 7 步）两种注入各自得到对应的 `CAUSE=`，恢复后扫描通过——命令与输出进 `## Evidence`
- [ ] 范围护栏：`git diff --name-only develop...HEAD -- packages/quay/src/gate packages/quay/src/fan-in packages/quay/src/kernel` 为空

## Definition of Done

core-root 对 `cli/` 的 import 归零且没有新增 core-root → `fan-in/` 边；driver 控制客户端与 driver 词表在 core-root 各有唯一定义，`cli/driver-vocab.ts` 消失，五个消费者真实改口；CLI / web / `quay server` 表层行为不变（既有测试一字不改全绿 + 新增 CLI 呈现契约测试）；两个机械检查器 pass；负对照证明判据可证伪。

## Touches

- packages/quay/src/driver-control.ts
- packages/quay/src/driver-vocab.ts
- packages/quay/src/cli/driver-vocab.ts
- packages/quay/src/cli/driver.ts
- packages/quay/src/cli/server.ts
- packages/quay/src/cli/help.ts
- packages/quay/src/serve-sessions.ts
- packages/quay/src/serve.ts
- packages/quay/test/driver-control.test.mjs
- packages/quay/test/server.test.mjs
- packages/quay/test/cli.test.mjs
- plugin/scripts/enum-surface-parity-check.ts
- plugin/scripts/runner-static-gate.ts
- tasks/gap-goal033-driver-control-and-vocab-to-core.md
