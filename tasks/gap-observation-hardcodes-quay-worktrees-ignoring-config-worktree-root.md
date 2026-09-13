---
id: gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root
title: 第三方项目 dashboard 的「在飞」显示的是别的项目的任务——observation 硬编码 quay-worktrees
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（实测）**：第三方项目 quay-fleet（tasks/ 为空，零任务派发）的 `/dashboard` 与 `/live`
显示 **「在飞 2 / 上限 5」**，两条都是 **quay 自己的任务**：
`gap-suite-wallclock-budgets-literals-depend-on-host-capacity · 实现中 · 25m12s`、
`gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak · 实现中 · 14m12s`。

**根因（定位到函数）**：`packages/quay/src/observation.ts` 的 `taskWorktreeOpen()`：

```ts
const namespace = path.join(path.dirname(path.resolve(root)), "quay-worktrees");
```

它**硬编码 `quay-worktrees` 这个目录名**，无视 `.quay/config.yml` 的 `loop.worktree_root`。

**实测三个读数**：
```
quay-fleet config    loop.worktree_root: /home/yale/work/quay-fleet/../quay-fleet-worktrees
observation 推导出                       /home/yale/work/quay-worktrees      ← quay 自己的
该目录实际内容                            14 个 worktree（全部是 quay 的任务）
quay-fleet 自己的 worktree 目录            不存在（尚无派发，符合预期）
```

**该函数的 fail-closed 设计本身是对的**——它的注释写明「namespace 不存在 ⇒ 返回 null，
never a positive 'released' signal from a source that could not be observed」。
**坏的是它的前提假设**：它假定 `<parent-of-root>/quay-worktrees` 要么属于本项目、要么不存在。
同一个父目录下并存多个项目时（`/home/yale/work/quay` 与 `/home/yale/work/quay-fleet`），
这个假设破裂——namespace 存在，于是它不 fail-closed，而是**用别的项目的目录回答本项目的问题**。

**「写用 config、读用硬编码」**：多处代码与注释引用 `loop.worktree_root` 作为 worktree 落点
（`inner-blocked-signal.ts:33,294`、`test-isolation-check.ts:415,432,1262`），
即**写侧读 config**；而本函数读侧硬编码。两侧不一致。
⇒ 后果：**派发本身是安全的**（建在 config 指定的目录），**但 dashboard/live 的在飞显示永远指向别的项目**。

**同族硬编码字面量还在别处**（本任务应一并收口，硬规则 5b：修一个不等于只有一个）：
`plugin/scripts/fast-mode-telemetry.ts`（:232 :258 :287 :320 :487 :506，6 处）、
`plugin/scripts/measure-trend-check.ts`（:100 :110，2 处）。

**查重（立案时，按机制）**：`taskWorktreeOpen` 命中 2 条，均 done、均非本机制——
`gap-live-ghost-superseded-task-workflow-events-start`（inFlight 缺 status 过滤）与
`gap-serve-board-test-workspace-couples-to-shared-tmp-quay-worktrees`（测试隔离；
它逐字裁定「`taskWorktreeOpen` 的 `dirname(root)` 语义是对的，⛔ 不要为了迁就测试去改生产判定」——
**那条裁定的语境是测试 fixture 建在裸 `/tmp` 下，不涉及第三方项目的 `loop.worktree_root`**，
故与本条不冲突，但改动时须保证它的两个取假控制仍绿）。

## Plan

1. `taskWorktreeOpen()` 改为读 `.quay/config.yml` 的 `loop.worktree_root`（解析 `..` 后规范化），
   仅在 config 缺该键时才回落到 `<parent-of-root>/quay-worktrees`，且回落时必须留一条可见痕迹
   （不得静默回落——静默回落正是本缺陷的形态）。
2. 同一份解析落成**单一入口**（如 `resolveWorktreeNamespace(root)`），
   `fast-mode-telemetry.ts` 与 `measure-trend-check.ts` 的 8 处字面量一并改为调用它。
3. 加静态检查：`packages/quay/src` 与 `plugin/scripts` 下不得再出现字面量 `"quay-worktrees"`
   （除该单一入口内部的回落分支）。

## Acceptance Criteria

- [ ] AC1（负控制，改前必须红）：构造两个相邻项目 A、B 共父目录，A 的 worktree 命名空间非空、
      B 的 config `loop.worktree_root` 指向自己的空目录；改前 `taskWorktreeOpen(B, <A的任务id>)`
      返回 `true`（用 A 的目录回答 B），改后返回 `false`。
- [ ] AC2：B 的 config 缺 `loop.worktree_root` 时回落，且回落这一事实可被观测（stderr 或返回的
      诊断字段），不得静默。
- [ ] AC3：`grep -rn '"quay-worktrees"' packages/quay/src plugin/scripts` 的命中数 ≤ 1
      （只剩单一入口内的回落分支）——静态检查器 + 双向控制（把一处改回字面量必须红）。
- [ ] AC4：全量 `scripts/test.sh` 绿。

## Definition of Done

在真实第三方项目 /home/yale/work/quay-fleet 上（非 fixture），`/dashboard` 与 `/live`
的「在飞」计数为 0（该项目确无派发），且页面上不出现任何 quay 自己的任务 id。
fixture 满足不算数（硬规则 4 推论三）。

## Touches

- packages/quay/src/observation.ts
- plugin/scripts/fast-mode-telemetry.ts
- plugin/scripts/measure-trend-check.ts
- packages/quay/test/observation-worktree-namespace.test.mjs
- tasks/gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root.md（自身）
