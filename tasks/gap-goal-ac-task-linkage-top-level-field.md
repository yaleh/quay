---
id: gap-goal-ac-task-linkage-top-level-field
title: goal_ac 顶层字段落地 —— goal ↔ task 关联使缺口计算成为机械量
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

正本：`orchestration/SPEC-goal-mechanism-2026-09-06.md` §7 的 G7 期 + `goals/AC-178-task-goal-linkage.md`（判据正本）。以下字段定义与缺口判据逐字取自 AC-178，未改写。

**字段定义**：`goal_ac: AC-170`，**可选**、**单向**（任务侧写）、**顶层**。

- **可选**：`gap-*` 缺陷任务不属于任何 goal，不填。⇒ goal 的进度**不能**靠 children 数量算，只能靠它自己的 AC——这反而是对的：**AC 是一等公民，任务只是达成手段**。
- **单向**：只在任务侧写，goal 侧不列 children ⇒ **无双向同步 ⇒ 无漂移面**（本仓反复强调的 single source of truth）。
- **顶层**：依据 `depends_on` 的既有教训——嵌在 `extra` 里的 `depends_on` 曾被 `parseTask` 失读（返回空字符串），故 `goal_ac` 必须是一等顶层字段，**不得嵌进 `extra`**。

**缺口判据（driver 的机械量）**：对每条未达成 AC，`count(task where goal_ac == AC and status ∈ {todo, ready, in-flight}) == 0` ⇒ 缺口。没有这个关联，「哪条 AC 没有任何任务在推进」只能靠 LLM 语义匹配；有了它就是纯机械计数，`goal-driver.ts` 的缺口环才可能是机械的。

**实现路线（照 `depends_on` 的现成穿透面依样落地，不发明新形态）**：`depends_on` 已穿透 `plugin/scripts/task-schema.ts`（schema 声明）→ `packages/quay/src/task-parsing.ts`（顶层读取）→ `packages/quay-native/src/store.ts`（native provider 读写）→ `packages/quay/src/mcp-handlers.ts` 与 `packages/quay-native/src/mcp-server.ts`（`task_write` 参数面）→ `docs/references/task-schema-canonical.md`（正本文档）。`goal_ac` 逐点照做。

**回填对象**：GOAL-001 自身的六条实现任务（G1–G6，均已 done，无在飞争用），各标其主 AC：`gap-goal-store-goal-id-vocabulary-and-draft-status`→AC-170、`gap-goal-store-migrate-prose-phase-acs-to-records`→AC-171、`gap-goal-store-revoke-prose-authority-repoint-pointers`→AC-173、`gap-goal-store-hard-cap-staleness-three-state`→AC-174、`gap-goal-store-abi-encapsulation-provider-backed`→AC-176、`gap-goal-driver-mechanical-ring`→AC-177。

## AC

- [ ] `goal_ac` 经 `parseTask` 从**顶层**读出（非 `extra` 嵌套）：对一条已回填的任务读取该字段，值等于其声明的 AC id，退出码 0
- [ ] 负控制（证明上一条能取假）：对一条**未设** `goal_ac` 的任务跑同一读取，退出码非 0 / 值为空——两条一起才排除「恒真」
- [ ] **AC-178 正本判据**：`test "$(grep -l '^goal_ac:' tasks/*.md | wc -l)" -ge 3` 退出码 0
- [ ] 缺口计算是一条命令的机械量：对每条未达成 AC 给出关联任务计数，且输出区分「有任务在推进 / 缺口 / 未评估」**三态**（硬规则 3b：读不懂输入时不得返回与合格同形的值）
- [ ] `task_write` 经 ABI 接受顶层 `goal_ac` 参数：实际写入一次再读回，写入值与读回值一致
- [ ] scoped 门 `bash scripts/test.sh --for-task gap-goal-ac-task-linkage-top-level-field --allow-thin` 退出码 0

## DoD

真实通过 ABI 操作过对象，而非仅有 fixture：用 `task_write` 给至少一条真实任务写入 `goal_ac`，并从 `tasks/*.md` 的 frontmatter **顶层**读回同值；六条 GOAL-001 实现任务的 `goal_ac` 已回填，可被 `grep -l '^goal_ac:'` 机械枚举。反例判据（硬规则 4 推论三）：若把 fixture / 注入 seam 关掉后上述 AC 仍能通过，它才是测量；仅靠测试内构造的假任务满足的判据不算数。`docs/references/task-schema-canonical.md` 记入该字段，使下一个读文档的人不必从代码反推。

## Touches

- plugin/scripts/task-schema.ts
- packages/quay/src/task-parsing.ts
- packages/quay/src/mcp-handlers.ts
- packages/quay-native/src/store.ts
- packages/quay-native/src/mcp-server.ts
- plugin/scripts/goal-driver.ts
- docs/references/task-schema-canonical.md
- plugin/test/task-parsing-parity.test.mjs
- packages/quay/test/provider-abi-conformance.test.mjs
- plugin/test/goal-driver.test.mjs
- tasks/gap-goal-store-goal-id-vocabulary-and-draft-status.md
- tasks/gap-goal-store-migrate-prose-phase-acs-to-records.md
- tasks/gap-goal-store-revoke-prose-authority-repoint-pointers.md
- tasks/gap-goal-store-hard-cap-staleness-three-state.md
- tasks/gap-goal-store-abi-encapsulation-provider-backed.md
- tasks/gap-goal-driver-mechanical-ring.md
- tasks/gap-goal-ac-task-linkage-top-level-field.md
