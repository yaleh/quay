---
id: gap-cli-write-surface-lacks-toplevel-fields
title: CLI 写字段面缺顶层字段（goal_ac / depends_on）—— 补 flag 并给字段面对齐造产物
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-178
---
## Proposal

**现象（立案当轮实测）**：`goal_ac`（G7 落地）只有 MCP 写入面，没有 CLI 面。实证代价：本会话的长驻 MCP server 启动于 `2026-09-06T03:44:46Z`、早于 G7 落地（`3e909bdd0`，`2026-09-06T20:39:04Z`）**16h54m**，`task_write` 收到 `goal_ac` 参数即**静默丢弃**，连续两次写入无效；最后只能起新进程直调 native store 的 `write()` 绕过去。CLI 不受长驻进程影响，本该是这条退路。

**⊢ 这不是 G7 漏做，是模式本身的缺口**：`depends_on`（G7 照抄的那个先例）**同样没有 CLI 面**。逐处实测——
- `packages/quay/src/cli/task-edit.ts` 的 flag 面 = `--title/--body/--body-file/--labels/--extra/--parent/--children/--expect-status/--append-notes`；
- CLI 的硬错误地板逐字写着 `Supported fields: id, status, title, body, labels, parent, children`（由 `packages/quay/test/cli-edit-parity-conformance.test.mjs:260` 断言）；
- `packages/quay-native/bin/quay-native.ts` 亦无 `--depends-on` / `--goal-ac`。

**⇒ 同形已发生两次**（`depends_on`、`goal_ac`），且**没有任何检查器在管 CLI 与 MCP 写字段面的对齐**——`grep` 全仓无此类 parity 检查器；唯一沾边的 `cli-edit-parity-conformance.test.mjs` 按 ADR-019 **默认整文件 skip**（GitHub 腿对 live repo 做真写），所以它结构上挡不住漏项。**发生率 2 + 无产物 ⇒ 该造产物，不是补一个 flag 了事**（硬规则 9：只靠意志的规则要给它产物）。

**机读正本**：写字段面的单一真相源是 **native MCP server 里 `task_write` 的 zod `inputSchema`**（`packages/quay-native/src/mcp-server.ts:142` 起，运行时可枚举）。`plugin/scripts/task-schema.ts` 只在注释里描述字段（`:109`/`:110`），**不可机读**，⛔ 不要在别处再手维护一份字段清单——那只会多一个漂移面。

**做法（三件，都照现成形态）**：
1. 给 core CLI `task edit`（及 `task create` 同面）补 `--goal-ac <AC-NNN>` 与 `--depends-on <id[,id...]>`，并把硬错误地板的 Supported fields 列表同步扩；
2. native CLI 同面覆盖；
3. **新增一个真的会跑的 parity 测试**：从上述 zod `inputSchema` 机读可写字段集，逐个断言存在对应 CLI flag。⛔ 不放进 `cli-edit-parity-conformance.test.mjs`——那文件默认 skip，放进去等于不存在（与「一个恒绿的检查是假的保证」同族）。

**⛔ 不越界**：不改 MCP/ABI 语义、不动 `extra` 仍不可 CLI 写这一既有裁定、不重构字段清单的存放位置。

## AC

- [x] `quay task edit <id> --goal-ac AC-NNN` 写入后，目标 `tasks/*.md` 的 frontmatter **顶层**出现该键，且 `parseFrontmatterCompletely` 读出同值、`extra` 下无同名键
- [x] `quay task edit <id> --depends-on a,b` 同样写入顶层数组，读回等值
- [x] 幂等负控制：不传这两个 flag 的一次 `task edit` **不清空、不改写**已有的 `goal_ac` / `depends_on`
- [x] CLI 硬错误地板的 `Supported fields:` 列表含新字段，且 `cli-edit-parity-conformance.test.mjs:260` 的断言串同步更新（否则该文件一旦被启用即红）
- [x] **新 parity 测试能取假**：从 `task_write` 的 zod `inputSchema` 机读字段集逐个查 CLI flag；把实现里任一新 flag 摘掉 ⇒ 该测试**必红**。干跑实测（临时摘掉 core `task-edit.ts` 的 `flags["depends-on"]` 处理行 ⇒ `node packages/quay/test/cli-write-surface-parity.test.mjs` fail 1）：
  ```
  ✖ cli-write-surface-parity: every native task_write zod field is CLI-flag-wired in core + native
    AssertionError: CLI↔MCP write-field-surface parity gaps (zod fields: title, status, labels, parent, children, depends_on, goal_ac, body, extra, expectedStatus):
      access flags["depends-on"] (zod field "depends_on") missing from core task-edit.ts
  ```
- [x] 新 parity 测试在**默认 suite 里真的执行**（带 `@test-group` 标注、不落进 ADR-019 的 in-file skip）——以一次 `scripts/test.sh` 的输出中出现该文件名为证
- [x] native CLI `quay-native task edit` 同面覆盖，读回等值
- [x] scoped 门 `bash scripts/test.sh --for-task gap-cli-write-surface-lacks-toplevel-fields --allow-thin` 退出码 0

## DoD

**真的用 CLI 写过一次并落到 develop**：`quay task edit` 设一条真实任务的 `goal_ac`，`git show develop:tasks/<id>.md` 可见该顶层键——而不是只有单测绿。反例判据（硬规则 4 推论三）：把新 flag 从 CLI 实现里摘掉后，parity 测试转红且 CLI 写入失败，两者同时成立才算测量；仅由 fixture 构造的断言不算数。`docs/references/task-schema-canonical.md` 记入「这些顶层字段的 CLI 写入面」，使下一个人不必从代码反推——今天正是因为文档没写、MCP 又陈旧，才绕了一圈。

## Touches

- packages/quay/src/cli/task-edit.ts
- packages/quay/src/cli/task-create.ts
- packages/quay/src/cli/help.ts
- packages/quay-native/bin/quay-native.ts
- packages/quay-github/src/mcp-server.ts
- packages/quay-github/src/github-client.ts
- packages/quay/test/cli-edit-parity-conformance.test.mjs
- packages/quay/test/cli-write-surface-parity.test.mjs（new）
- docs/references/task-schema-canonical.md
- tasks/gap-cli-write-surface-lacks-toplevel-fields.md
