---
id: gap-task-write-labels-replace-not-append-no-safe-add-action
title: task_write.labels
  是整体替换非追加，且内部已有的安全追加逻辑（ensureDeliveryCriticalLabel）未暴露为可调用动作——临时打
  delivery-critical 等标签易误删既有标签
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

**背景（本次对话已查证，非猜测）**：`DIR-130`（2026-09-02, done）授权 manager 不逐次请示直接给任务加/删 `delivery-critical` 类标签（`plugin/skills/quay-task-operator/SKILL.md:29-30`），这是人类对 Claude Code 下达临时优先派发指令的现成合法通道。但落地这个通道时存在一个未被文档化提醒的操作风险：

- `packages/quay/src/mcp-handlers.ts:205` 逐字：「`labels` is an array of strings (replaces the full label set).」
- `packages/quay/src/mcp-handlers.ts:213`：`labels: z.array(z.string()).optional().describe("Replacement label array (replaces all existing labels). Omit to leave unchanged.")`

**结论**：直接调 `mcp__plugin_quay_quay__task_write` 给已有任务追加 `delivery-critical`，如果调用方不先 `task_get` 读出当前 `labels` 再把完整数组回传，会**把原有的 `gap`/`defect`/`directive` 等标签全部覆盖删除**——这是一个真实的操作风险点。

**内部其实已经有正确实现**：`plugin/scripts/task-ops.ts:72-113`（`ensureDeliveryCriticalLabel`）实现了"读现有 labels、追加不重复、写回"的安全逻辑，但它只是内部库函数，**没有作为一个可直接调用的 MCP 动作/CLI 命令暴露给"追加单个标签"这个场景**——`quay-task-operator/SKILL.md:29-30` 把 `labels` add/remove 列为 manager 可自主执行的动作，但没有指向这个安全实现，也没有提醒 `task_write.labels` 是整体替换语义。调用方（不论是 human 授意的 manager，还是别的 agent）必须自己记得先读后写，没有任何机制兜底。

**⛔ 明确排除**：不是要改变 `task_write.labels` 本身"整体替换"的语义（那可能是有意设计，用于批量重设标签的场景）；只是要给"追加单个标签、保留其它"这个更常见的场景提供一个不会误删的安全路径。

## AC

- [x] 有一个可直接调用的"追加单个标签，不影响其它标签"动作（MCP verb，或对现有 `task_write` 的一层薄封装/CLI 子命令），复用/暴露 `ensureDeliveryCriticalLabel`（`plugin/scripts/task-ops.ts:72-113`）或等价逻辑，调用方不需要自己先 `task_get` 再拼数组。
- [x] `plugin/skills/quay-task-operator/SKILL.md`（或等价面向调用方的文档）对 `task_write.labels` 的整体替换语义有一条明确的操作提醒，紧邻 delivery-critical 相关段落（`:29-30` 附近）。
- [x] 一条测试：对一个已有 `[gap, defect]` 标签的任务调用新的追加动作加 `delivery-critical`，结果 `labels` = `[gap, defect, delivery-critical]`（顺序不敏感），原标签未丢失。
- [x] 负控制：对同一任务重复追加 `delivery-critical` 两次，`labels` 不出现重复项。

## DoD

- [x] 上述判据本轮实跑并贴出输出，不是转述。
- [x] `git log` 可见一次真实调用该追加动作、对一个真实任务加标签、且验证其它标签未被冲掉的记录。

## Touches

- `packages/quay/src/mcp-handlers.ts`
- `plugin/scripts/task-ops.ts`
- `plugin/skills/quay-task-operator/SKILL.md`
- `packages/quay/test/mcp-handlers.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-task-write-labels-replace-not-append-no-safe-add-action.md`