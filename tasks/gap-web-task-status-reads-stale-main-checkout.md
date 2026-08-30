---
id: gap-web-task-status-reads-stale-main-checkout
title: web 显示（/tasks、/board、/live done 过滤）读主检出 disk task status（落后 develop）→
  落地任务显示失真；读源应改 develop git ref
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

Web 显示层的 task status 读面是**主检出 disk 的 `tasks/*.md`**（`main/manager-doc` 工作分支），而任务落地在 develop。主检出落后 develop 直到被 sync merge 追上 ⇒ 显示失真：

1. **/tasks 与 /board**：`serve-task.ts:53` 与 `serve-board.ts:200` 都走 `client.taskList()` → native provider 读 `workspaceRoot`（=主检出）disk。实证 2026-08-30：02:21 主检出 `Merge branch 'develop' into main/manager-doc`（c48ebc0d3）一次性触碰 14 个任务文件 mtime ⇒ 账本把 20:28→01:30 的 14 个真实落地全部显示成「5m ago」——真实落地时刻被压缩到一个同步点。
2. **/live 的「已落地→移出在飞」过滤**：`observation.ts` `readTaskStatusOnDisk(root, id)`（:978/:1154）读主检出 disk。任务在 develop 翻 done 但主检出未同步 ⇒ 仍显示在飞。

**与 dispatch 同根**：`gap-dispatch-reads-stale-main-checkout-task-status`（done 2026-08-29）已把 dispatch 读面（ready-pool-check/slot-refill）改读 develop git ref（`readTaskStatusAtRef(root,"develop",id)`）；web 显示是同一缺陷的另一半——dispatch 修了、显示没修。

## Plan

web 显示的任务 status 读面从「主检出 disk」改「develop git ref」——复用 worker-driver.ts:2043 的 `readTaskStatusAtRef` / `readTaskFileAtRef`（`git show develop:tasks/<id>.md`，**对象库只读，不 checkout develop、不挡 fan-in**——同 dispatch 已生产验证的读法）：

- **/tasks 与 /board**：任务列表改从 develop 读。1500+ 任务逐条 `git show` 太慢 ⇒ 一次 `git show develop:tasks`（整树 ~几 MB）+ 短 TTL 缓存，或 diff overlay（disk 为基础 + `git diff develop -- tasks/` 覆盖 status）。⛔ 不做主检出 ff 同步（band-aid，读 develop ref 一次性根除，同 dispatch 案的裁定）。
- **/live done 过滤**：`readTaskStatusOnDisk` 的显示路径改读 develop ref。
- ⛔ 主检出保持 `main/manager-doc`，**不得** `git checkout develop` / `git worktree add` 到 develop（会挡 fan-in 推 develop）。

## Acceptance Criteria

- [x] AC1（能取假）：构造「主检出 status=ready、develop status=done」的 case → /tasks 与 /live 按 develop 判 done（落地任务不再显示成 ready/在飞）；（⛔ 仍按主检出 ready ⇒ 假）。
- [x] AC2（能取假，回归）：主检出与 develop 同 status 时显示不变（fresh 任务不受读源改影响）。
- [x] AC3（能取假）：改动代码无任何 `git checkout develop` / `git worktree add` 指向 develop（grep 变更集确认）；主检出分支保持 main/manager-doc。
- [x] AC4（能取假）：1500+ 任务场景下 /tasks 渲染延迟可接受（批量读/缓存生效，不逐任务 git show）。

## Definition of Done

web 显示（/tasks、/board、/live done 过滤）的 task status 读面改读 develop git ref；AC1-AC4 全勾；全量 suite 绿；落地任务不再因主检出陈旧 status 显示失真。

## Touches

- packages/quay/src/serve-task.ts（任务列表读面改 develop ref）
- packages/quay/src/serve-board.ts（board 读面改 develop ref）
- packages/quay/src/observation.ts（readTaskStatusOnDisk 显示路径改 develop ref，或新增 develop-ref 版）
- packages/quay/src/serve-handlers.ts（/tasks 路由把 cfg 传给 handleTaskList）
- packages/quay/test/serve-task.test.mjs（AC1-AC3 单测）
- packages/quay/test/serve-board.test.mjs（AC1-AC3 单测）
- packages/quay/test/observation.test.mjs（live done 过滤 AC1 单测）
- tasks/gap-web-task-status-reads-stale-main-checkout.md（自身）
