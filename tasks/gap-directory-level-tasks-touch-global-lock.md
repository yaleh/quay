---
id: gap-directory-level-tasks-touch-global-lock
title: "目录级 `tasks/*.md` Touches = 全局派发锁：self-touch C8 强制 ⇒ 与任何任务相交，在飞期间队列全锁（发生率 45，doc-lint 持锁 3h40m 实证）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-16 22:1xZ（负控制 + 机制分析）+ 我核实（45 个历史声明）。

**问题**：任务声明**目录级** `tasks/*.md` 在 `## Touches` 时，目录级条目是「展开 + 不对称自锁」语义（self-block against ANY task touching a file under it）。而 C8 强制每个任务 self-touch 自己的 `tasks/<id>.md` ⇒ **目录级 `tasks/*.md` 展开后与任何任务的自身文件相交** ⇒ 持有者在飞期间，**队列里没有任何任务可能被派发**。

**实证（doc-lint，gap-done-task-doc-lint-cleanup-2026-08-16）**：
```
Touches 全文：- tasks/*.md（15 个 done 任务的文件）+ 自身
负控制①（doc-lint 单独在飞）：recommended=[]，12 个 deferred 全 peer gap-done-task…
负控制②（doc-lint 拿掉）：recommended=[gap-a13, gap-ac100, gap-ac101, gap-fan-in-turn-budget]
⇒ 唯一变量是它，结论翻转（对照非解释）
worktree 创建 18:37:51Z，分支末次提交 18:39:07Z，之后 3h38m 零提交
impl 已完（68faf3ab 收口）但 fan-in 没跑 ⇒ 卡住持锁
```

**发生率**：历史声明目录级 `tasks/*.md` 的任务 = **45 个**（含 done 与在飞）。这把锁被「握住」过 45 次；doc-lint 是当前持锁者且已卡 3h40m。

**改写今日结论**：delta-scope/ac100/a13 派不出去**非它们 Touches 的问题**——是 doc-lint 的锁（把它们也一起挡了）。「优先级裁定未生效」也非 priority 轴问题——本轮任何裁定都不可能生效。

**⛔ 不改持锁者的 Touches 绕过**——doc-lint 确实要改 15 个任务文件，声明诚实。**解锁 = 让持锁者落地或中止。**

## Acceptance Criteria

- [ ] AC1: **机制修复**——派发侧对目录级 `tasks/*.md` 的处理不构成全局锁：要么目录级条目展开为**具体文件清单**（task 撰写时枚举），要么派发计算对「目录级 vs self-touch」的相交给出不阻塞的语义（实现方选，⛔ 不指定）。取假：构造一个声明 `tasks/*.md` 的在飞任务 + 任意其它 ready 任务 ⇒ 必须仍可派发（不被全局锁）。
- [ ] AC2: **存量检查**——45 个声明过目录级 `tasks/*.md` 的任务逐一核：凡是当前 `status: ready` 或 in-flight 的，确认其目录级声明是否构成活跃全局锁；已 done 的不再构成锁（无后续派发被它挡）。
- [ ] AC3: **防复发**——任务撰写/闸门侧检测「目录级 `tasks/*.md` Touches」并提示：若作者确需改多个任务文件，应枚举具体文件（⛔ 不禁止目录级，但要么枚举要么明确「我知道这是全局锁」）。
- [ ] AC4: **当前锁解除**——doc-lint 落地或中止（它是唯一解锁点），解锁后队列恢复派发。

## Definition of Done

- [ ] 目录级 `tasks/*.md` 不再构成隐式全局派发锁；存量已核；doc-lint 锁已解除。

## Touches

- plugin/scripts/slot-refill.ts（目录级 Touches 展开/相交语义）
- plugin/scripts/touches-one-entry-one-path-check.ts（撰写面检测）
- tasks/gap-directory-level-tasks-touch-global-lock.md（自身）

**Touches 收窄说明（2026-08-17 23:3xZ）**：原 `tasks/*.md` 目录级声明已移除——
①AC2 是**读核**（逐一核 45 个任务，确认其声明是否构成活跃全局锁），核读的**结论写在本任务 Evidence**，不是写那 45 个文件 ⇒ 不构成写面，声明目录级即 overbroad；
②`tasks/gap-done-task-doc-lint-cleanup-2026-08-16.md` 已 done（AC4 锁已解除），无需再触碰；
③本任务自身就是「目录级 `tasks/*.md` = 全局派发锁」的修复者，自己声明目录级 glob 会被**自身要修的缺陷**自锁（slot-refill step-4 self-touch 相交），且 land 前 anti-drift（gap-fan-in-fix-commit-delta-escapes-touches-coverage）会对 overbroad 声明 HARD FAIL ⇒ 收窄到具体文件既是诚实声明也是可派/可 land 的前提。
