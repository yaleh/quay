---
id: gap-goal030-kernel-task-transition-and-status-event
title: GOAL-030 ①：kernel 层任务状态转移决策（LIFECYCLE_EDGES 与 patchStatusField 下沉为唯一定义）+
  结构化转移事件
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-338
---
**type:** execution

## Proposal

GOAL-030（goal 分支首个真实试点）的第一块：在 kernel 层建立任务状态转移的唯一决策点与事件写入，供晋升路径使用。**本任务只建能力，不改任何写入调用方。**

背景读数：任务状态写入目前没有单一所有者——`plugin/scripts/task-ops.ts` 的 `patchStatusField` 被 4 个文件直接调用（`ready-pool-check.ts` 2 处、`worker-fan-in.ts` 4 处、`driver-filters.ts` 2 处、`worker-driver.ts`），不查 `packages/quay/src/gate/lifecycle.ts` 的 `LIFECYCLE_EDGES`；而 `gate/lifecycle.ts` 的 `runPromote`/`runRetreat`（CLI 路径）只查 `TRANSITIONS`。若在 kernel 再写一套判定，会成为第三套实现。`plugin/scripts/import-graph-check.ts` 强制 kernel 为叶子（kernel 内文件只能 import kernel 内文件，`kernelViolations` 必须为空），所以 kernel 不能 import `gate/lifecycle.ts` 或 `abi.ts`。

做法（沿用仓库已有的「下沉到 kernel + 原位置薄 re-export」先例，`kernel/regex-escape.ts`、`kernel/shape-sections.ts` 即此形状）：

1. 新建 `packages/quay/src/kernel/task-transition.ts`，只 import Node 内置模块：
   - **`LIFECYCLE_EDGES` 的唯一定义**：从 `gate/lifecycle.ts` 原样搬入（状态名用字符串字面量，类型在本文件内声明）。`gate/lifecycle.ts` 删除本地定义、改为从 kernel re-export（若其内部也使用该表，需同时 import——`export { x } from` 只绑定导出表，不进入模块作用域）。`TRANSITIONS`、`legalForward`、`legalBack`、`assertTransition`、`runPromote`、`runRetreat` 的行为一律不变。
   - **`decideTransition(from, to, opts?)`**：三态返回——`{verdict: "allow", edge}`（`LIFECYCLE_EDGES` 中存在 `from→to` 且 `status: "current"` 的边）、`{verdict: "refuse", reason}`（表中无此边，或该边为 `legacy`）、`{verdict: "not-evaluated", reason}`（`from` 或 `to` 不是已知状态）。⛔ 不允许用布尔返回值把「未评估」与「拒绝」合并（硬规则 3/3b）。
   - **`patchStatusField` 的唯一定义**：从 `plugin/scripts/task-ops.ts` 原样搬入（它是纯函数，无任何 import）。`task-ops.ts` 改为从 kernel re-export（同上，若内部使用需同时 import）。现有 4 个调用方 ⛔ 一行都不改。
   - **事件写入 `appendTaskStatusEvent(root, event)`**：向 `<root>/.quay/task-status-events.jsonl` 追加一行 JSON：`{ts, taskId, from, to, kind, actor, reason?, writerModule, entry, pid}`。其中 `writerModule` = 本模块文件的 realpath（`fs.realpathSync(fileURLToPath(import.meta.url))`），`entry` = 当前进程入口 `process.argv[1]` 的 realpath，二者是「这次写入由哪份代码执行」的直接量，供 GOAL-030 的 AC-337 判定分支自举是否真的跑了分支代码。写入失败返回 `{ok: false, reason}`，⛔ 不抛、⛔ 不静默吞掉。
2. 在 `docs/carrier-registry.json` 登记 `task-status-events.jsonl`，`owner` 为 `packages/quay/src/kernel/task-transition.ts`（⛔ 不是 `unowned-yet`）。注册表完整性测试会因新出现的载体字面量而要求登记。
3. 测试 `packages/quay/test/task-transition.test.mjs`：枚举全部 5×5 状态对，断言 `decideTransition` 对表中 current 边返回 allow、其余返回 refuse、未知状态返回 not-evaluated；kernel 内状态集与 `abi.ts` 的 `TASK_STATUSES` 集合相等（防止两份状态集漂移）；事件写入的字段齐全且 `writerModule` 等于 kernel 模块文件的 realpath；写入失败（目标目录不可写）返回 `ok:false`。

## AC

- [ ] kernel 模块导出四项：`node --no-warnings --experimental-strip-types -e 'import("./packages/quay/src/kernel/task-transition.ts").then(m=>{for(const k of ["LIFECYCLE_EDGES","decideTransition","patchStatusField","appendTaskStatusEvent"])if(!(k in m))throw new Error(k)})'` exit 0
- [ ] `LIFECYCLE_EDGES` 与 `patchStatusField` 各只有一处 `export const`/`export function` 定义，且都在 `packages/quay/src/kernel/`：`grep -rnE '^export (const LIFECYCLE_EDGES|function patchStatusField)\b' packages/*/src plugin/scripts --include='*.ts' | grep -v '\.test\.'` 恰好输出 2 行，均位于 `packages/quay/src/kernel/task-transition.ts`
- [ ] 调用方未改：非注释行的 `patchStatusField(` 调用数 `driver-filters.ts` = 2、`worker-fan-in.ts` = 4、`ready-pool-check.ts` = 2（命令：`grep -vE '^[[:space:]]*(//|\*|/\*)' <file> | grep -cE 'patchStatusField\('`）
- [ ] kernel 边界：`node --no-warnings --experimental-strip-types plugin/scripts/import-graph-check.ts --json` exit 0，输出 `kernelChecked: true` 且 `kernelViolations: []`
- [ ] 新测试与既有行为测试全绿：`scripts/test.sh packages/quay/test/task-transition.test.mjs packages/quay/test/lifecycle-edge-table.test.mjs plugin/test/task-ops.test.mjs plugin/test/carrier-registry-completeness.test.mjs` exit 0
- [ ] 负对照：cp 备份 `task-transition.ts` 后临时把 `decideTransition` 对 unknown 状态的返回改成 refuse，重跑 `scripts/test.sh packages/quay/test/task-transition.test.mjs` 必须 exit 非 0；还原后 exit 0；两次 exit 码进 Evidence（⛔ 不用 git checkout 还原）

## DoD

本任务经 goal/GOAL-030 分支落地（worktree 从该分支开出、fan-in 回该分支），⛔ 不落 develop：落地后 `git show goal/GOAL-030:packages/quay/src/kernel/task-transition.ts` 可见，且在 GOAL-030 并入之前 `git show develop:packages/quay/src/kernel/task-transition.ts` 不存在。Evidence 贴出上述命令输出与负对照的两次 exit 码，以及本任务派发记录里的 mergeTarget。不改变任何运行时写入行为（调用方未改）。

## Touches

- tasks/gap-goal030-kernel-task-transition-and-status-event.md
- packages/quay/src/kernel/task-transition.ts
- packages/quay/src/gate/lifecycle.ts
- plugin/scripts/task-ops.ts
- docs/carrier-registry.json
- packages/quay/test/task-transition.test.mjs
- packages/quay/test/lifecycle-edge-table.test.mjs
- plugin/test/task-ops.test.mjs

## 停放说明

本任务以 needs-human 状态立案，用于停放：在 GOAL-030 激活且 `goal/GOAL-030` 分支存在之前，⛔ 不得被派发（否则 mergeTarget 会解析为 develop）。由立案会话在核验分支存在后改回 todo。
