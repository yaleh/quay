---
id: gap-serve-board-test-workspace-couples-to-shared-tmp-quay-worktrees
title: serve-board.test.mjs 的 workspace 直建在 os.tmpdir() 下 ⇒ 与共享
  /tmp/quay-worktrees 耦合，孤儿断言随机红
status: ready
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

- [ ] `makeWorkspace` 改为多嵌一层私有父目录（照 `observation.test.mjs:228` `ghostWorkspace`），使 `path.dirname(ws)` 是本次 mkdtemp 出来的私有目录而非裸 `os.tmpdir()`；贴改后 `sed -n '81,86p' packages/quay/test/serve-board.test.mjs` 的实际行内容
- [ ] 取假控制（正）：在 `mkdir -p /tmp/quay-worktrees` **存在**的前提下跑 `node --test --experimental-strip-types packages/quay/test/serve-board.test.mjs`，断言 `ℹ fail 0`；改动**前**同一前提下同一命令必须红在 `AC2: the task is flagged orphan` —— 贴前后两次读数（⛔ 非转述）
- [ ] 取假控制（反）：`rmdir /tmp/quay-worktrees` 后同一命令仍 `ℹ fail 0`，排除「只对某一态成立」
- [ ] 兄弟实例扫描（硬规则 5b）：对 `packages/quay/test/*.mjs` 与 `plugin/test/*.mjs` 全量找出「workspace 直接建在 `os.tmpdir()` 下、且该 root 被喂给读 `dirname(root)/quay-worktrees` 的生产函数（`taskWorktreeOpen` / `isQuayWorktreePath` / `readLive` / `readBoardExecution`）」的测试；贴命中数与前 3 条实际内容，命中者一并修或逐条写明为何不受影响（⛔ 零命中时须把谓词对 `serve-board.test.mjs` 这个已知为真的样本干跑一次并贴输出）
- [ ] `node --test --experimental-strip-types packages/quay/test/serve-board.test.mjs` 全绿，贴 `ℹ tests/pass/fail` 三个计数

## DoD

生产载体读数：改动落地后，**在一次真实的全量 suite 日志**（`.quay/fan-in-suite-*.log`）里
确认 `serve-board.test.mjs` 的用例全部通过、且不再出现
`AssertionError [ERR_ASSERTION]: AC2: /board renders LV-1 as 孤儿`；
贴该日志路径与命中/未命中读数。
⛔ 单测绿是必要非充分（硬规则④推论三）：AC2 的「人为造出 `/tmp/quay-worktrees` 仍绿」
才是真正把这条耦合关掉的证据，**不得只跑一次干净环境的绿就算完**。

## Touches

- packages/quay/test/serve-board.test.mjs（`makeWorkspace` 多嵌一层私有父目录，解除与共享 /tmp/quay-worktrees 的耦合）
- tasks/gap-serve-board-test-workspace-couples-to-shared-tmp-quay-worktrees.md（自身）

## Verification

对照（硬规则④推论四）：`mkdir /tmp/quay-worktrees` 与 `rmdir /tmp/quay-worktrees` 两态下
跑同一条测试命令，结论必须**都绿**；改动前同样两态必须**一红一绿**——
一个参数翻转结论就翻，排除恒真/恒假。
