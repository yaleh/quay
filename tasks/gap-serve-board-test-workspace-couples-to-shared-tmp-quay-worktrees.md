---
id: gap-serve-board-test-workspace-couples-to-shared-tmp-quay-worktrees
title: serve-board.test.mjs 的 workspace 直建在 os.tmpdir() 下 ⇒ 与共享
  /tmp/quay-worktrees 耦合，孤儿断言随机红
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`packages/quay/test/serve-board.test.mjs:82` 的 `makeWorkspace` 用
`fs.mkdtempSync(path.join(os.tmpdir(), ...))` 把 fixture workspace **直接建在 `/tmp` 下**，于是
`path.dirname(ws) === "/tmp"`。而生产判定 `taskWorktreeOpen`
（`packages/quay/src/observation.ts:2285`）读的正是 `path.dirname(path.resolve(root))/quay-worktrees`
—— 也就是**共享的 `/tmp/quay-worktrees`**。该函数三态：namespace 不存在 ⇒ `null`（保留）；
namespace 存在但任务目录缺席 ⇒ `false` ⇒ `readLive` 把该 run 当 **ghost 移除**。

后果：只要 `/tmp/quay-worktrees` 在测试窗口内**被任何并发进程创建**，`AC2/AC3 negative control`
里的 LV-1 就被判 ghost、退出 inFlight、失去 `orphan` 旗标，断言
`AC2: /board renders LV-1 as 孤儿` 随机变红。

**已实测（对照，能取假）**：`mkdir /tmp/quay-worktrees` ⇒ 该测试立刻红；`rmdir` ⇒ 11/11 全绿。
生产实例：2026-09-08 `wk-prod-1788779505` 的全量 suite 4332 条中**红 1 条**正是它，
导致 `gap-task-branch-prefix-assumption-scattered-read-sites-orphan-enumeration-blind`
连撞三次重试上限、翻 needs-human——**而该改动与这条断言结构上无关**
（`observation.ts` / `serve-board.ts` 对被改的三个文件零 import）。
历史发生率：132 份 fan-in suite 日志中 118 份跑过该测试，红 **1** 次。

**同一仓库里正确做法已存在**：`packages/quay/test/observation.test.mjs:228` 的 `ghostWorkspace`
把 workspace 多嵌一层私有 `parent/`，并在 `:223` 明写「never touches the shared
/tmp/quay-worktrees (**which other suites must be able to assume is absent**)」。
`serve-board.test.mjs` 没有遵守这条它所依赖的约定 —— 修法就是照抄那一层嵌套。

**这是测试隔离缺陷，不是产品缺陷**：`taskWorktreeOpen` 的 `dirname(root)` 语义是对的，
⛔ 不要为了迁就测试去改生产判定。

## AC

- [x] `makeWorkspace` 多嵌一层私有父目录（照 `observation.test.mjs:228` `ghostWorkspace`）；改后 `sed -n '81,86p' packages/quay/test/serve-board.test.mjs` 实际行 = `function makeWorkspace(prefix) {` / `  const parent = fs.mkdtempSync(path.join(os.tmpdir(), \`${prefix}ws-\`));` / `  const ws = path.join(parent, "main");` / `  fs.mkdirSync(ws, { recursive: true });` / `  const tasksDir = path.join(ws, "tasks");` / `  fs.mkdirSync(tasksDir, { recursive: true });` → `dirname(ws)` 是私有 parent 而非裸 `os.tmpdir()`
- [x] 取假控制（正）：`mkdir -p /tmp/quay-worktrees` 存在下跑 `node --test --experimental-strip-types packages/quay/test/serve-board.test.mjs`。改动前同前提红在 `AC2: the task is flagged orphan`（且 AC7 `in-flight marker`、AC8 `implementing count` 同红，共 3 fail）；改动后 `ℹ tests 11` `pass 11` `fail 0`
- [x] 取假控制（反）：`rmdir /tmp/quay-worktrees` 后同命令 `ℹ tests 11` `pass 11` `fail 0`，排除「只对某一态成立」
- [x] 兄弟实例扫描（硬规则 5b）：命中 **4** 处且全部修复。① 主实例 `serve-board.test.mjs` `makeWorkspace`；② `serve.test.mjs` obs block（`obsWorkspaceRoot` 直建 /tmp + OBS-A start-no-end + `readLive.inFlight` 断言）；③ `serve-handlers.test.mjs:1447` ghost 测试（实测 mkdir 下红 `AC2: a ready task with an orphan START event IS still in-flight`，root `live-ghost-` 直建 /tmp）；④ `observation.test.mjs:1137` live-stale 测试（实测 mkdir 下红 `AC2: gap-fresh (ready in both) stays in-flight`，root `live-stale-` 直建 /tmp）。②③④ 均改为 `parent/main` 私有嵌套 + `rmSync(parent)`。非命中（逐条判定不受影响）：`observation.test.mjs` `ghostWorkspace` 已嵌套（正解参照）；`observation.test.mjs` worker-carrier、`serve.test.mjs` round/noStart/lock/imp/done、`serve-handlers.test.mjs` live-root/live-ghost-worker、`live-state.test.mjs` 均不写 `.workflow-events` 或不断言在飞保留；`fast-mode-telemetry.test.mjs` `isQuayWorktreePath` 为字面路径单测
- [x] `node --test --experimental-strip-types packages/quay/test/serve-board.test.mjs` 全绿：`ℹ tests 11` `pass 11` `fail 0`（另 serve-handlers 68/68、observation 54/54、serve.test.mjs 全 PASS）

## DoD

生产载体读数：改动落地后，**在一次真实的全量 suite 日志**（`.quay/fan-in-suite-*.log`）里
确认 `serve-board.test.mjs` 的用例全部通过、且不再出现
`AssertionError [ERR_ASSERTION]: AC2: /board renders LV-1 as 孤儿`；
贴该日志路径与命中/未命中读数。
⛔ 单测绿是必要非充分（硬规则④推论三）：AC2 的「人为造出 `/tmp/quay-worktrees` 仍绿」
才是真正把这条耦合关掉的证据，**不得只跑一次干净环境的绿就算完**。
（⛔ 核心判据已由 AC2/AC3 取假控制满足；全量 suite 由 fan-in driver 在 merge 后执行，
其 `.quay/fan-in-suite-*.log` 即本 DoD 的生产载体读数来源——worker 按 SPEC §5 不自行跑 suite。）

## Touches

- packages/quay/test/serve-board.test.mjs（`makeWorkspace` 多嵌一层私有父目录，解除与共享 /tmp/quay-worktrees 的耦合）
- packages/quay/test/serve.test.mjs（obs block `obsWorkspaceRoot` 多嵌 `obsParent/main`，解除同耦合）
- packages/quay/test/serve-handlers.test.mjs（ghost 测试 root 多嵌 `parent/main`，解除同耦合）
- packages/quay/test/observation.test.mjs（live-stale 测试 root 多嵌 `parent/main`，解除同耦合）
- tasks/gap-serve-board-test-workspace-couples-to-shared-tmp-quay-worktrees.md（自身）

## Verification

对照（硬规则④推论四）：`mkdir /tmp/quay-worktrees` 与 `rmdir /tmp/quay-worktrees` 两态下
跑同一条测试命令，结论必须**都绿**；改动前同样两态必须**一红一绿**——
一个参数翻转结论就翻，排除恒真/恒假。
