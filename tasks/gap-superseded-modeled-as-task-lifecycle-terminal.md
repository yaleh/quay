---
id: gap-superseded-modeled-as-task-lifecycle-terminal
title: superseded 建模为 task lifecycle 终态（人裁定 B）+ 迁移 18 条 + 修 VALID_STATUSES 破损
status: todo
labels:
  - gap
  - defect
  - delivery-critical
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**人 2026-08-12 02:4xZ 裁定 B（023435 + 023647）**：todo 任务不应有 SUPERSEDED。把 `superseded` 做成 **task lifecycle 里被建模的终态**，12 条 `todo`+SUPERSEDED 迁过去，顺带把已在用它的 6 条收进模型。

**先存破损（B 要修的既有问题）**：`packages/quay-native/src/store.ts:843-845` 拒绝白名单外的 status（`VALID_STATUSES = ["todo","ready","done","needs-human"]` :14）。而磁盘上已有 **6 条 `status: superseded`**（exp5-M-QENG-DOD-DEMO-ONLY、五条 gap-os-anchor-watchdog-*，07-19~08-07）——**API 写不出、但磁盘上存在**，任何对它们的 `task_write` 抛错。这不是 B 引入的风险，是 B 要修的既有破损。

**实现半径（manager 实测）**：
| 位置 | 内容 |
|---|---|
| `packages/quay-native/src/store.ts:14` | `VALID_STATUSES` 加 `superseded`（:843 与 :174 两处用它） |
| `packages/quay/src/gate/lifecycle.ts` | `TRANSITIONS` 加终态 `superseded: { forward: null, back: null }` |
| `packages/quay/src/abi.ts:9` | TS 联合类型加 `'superseded'` |
| `packages/quay/src/serve-handlers.ts:650` | web 过滤导航 `const statuses = [...]` 加 superseded |
| `packages/quay/src/mcp-handlers.ts:105` | MCP `task_list` status 描述文本 |
| `packages/quay-backlog/src/backlog-client.ts:47` | 注释/文档 |
| **测试** | ~15 测试文件引用 lifecycle；27 断言 needs-human——主要工作量 |

**命名先例**：`packages/quay/src/adr-store.ts:33` 的 `VALID_ADR_STATUSES` **已含 `"superseded"`**——同词在另一类对象已被建模，命名一致性有先例。

**outer 裁定两决策点**：
1. **back 边 = null（硬终态）**：前提被删不应复活；复活需人重新立案。12 条里 DIR-119 族是人 08-09 裁定关闭、gap-suite-floor-two-longest-files-bound 今晚刚 fan-in 过——两者都是「前提没了」的终态，不是「等人裁」。
2. **迁移顺序 = 先改 `VALID_STATUSES` 再迁 18 条**（12 todo+superseded + 6 既有）——否则 store 写不进去。

**验证锚**：修后 (a) `status: superseded` 可经 store API 写读；(b) 12 条 todo+SUPERSEDED 迁为 superseded；(c) 6 条既有 superseded 不再抛错；(d) web 上 todo 27→15、superseded 独立成桶；(e) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录先存破损（store.ts:843 拒绝 superseded + 6 条磁盘 superseded 写不进）（本任务 Proposal 已含）
- [ ] AC2: **lifecycle 建模**——`superseded` 加入 VALID_STATUSES + TRANSITIONS 终态（forward:null, back:null）+ abi TS 联合类型
- [ ] AC3: **web/MCP 呈现**——serve-handlers web 过滤 + mcp-handlers 描述含 superseded（独立成桶）
- [ ] AC4: **迁移 18 条**——12 条 todo+superseded 迁 superseded + 6 条既有 superseded 可写读（先改校验器再迁）
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿；15 测试文件更新后全绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：superseded 可经 API 写读 + web 独立成桶读数贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay-native/src/store.ts（VALID_STATUSES 加 superseded）
- packages/quay/src/gate/lifecycle.ts（TRANSITIONS 终态）
- packages/quay/src/abi.ts（TS 联合类型）
- packages/quay/src/serve-handlers.ts（web 过滤）
- packages/quay/src/mcp-handlers.ts（MCP 描述）
- packages/quay-backlog/src/backlog-client.ts（注释/文档）
- 18 条任务文件（迁移 status 到 superseded）
- plugin/test/ + packages/quay/test/（15 测试文件更新）
- tasks/gap-superseded-modeled-as-task-lifecycle-terminal.md（自身：勾 AC + 贴证据）

## Contract

measure   superseded_writable = `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task_write <id> --status superseded` 的退出码
band      superseded_writable = 0（superseded 可经 API 写读）
invariant superseded_terminal = 1（TRANSITIONS 含 superseded: forward null back null）
invariant migration_done = 1（18 条迁 superseded，不再有 todo+SUPERSEDED 并存）
invoke    `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task_list --status superseded`（贴迁移后列表）
control   superseded 建模终态；迁移完成；web 独立成桶；既有不回归
resume    校验器 / lifecycle / 迁移 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: 人裁定 B（023435+023647）。superseded 建模终态 + 迁移 18 + 修 VALID_STATUSES 破损。outer 裁定 back=null 硬终态 + 先改校验器再迁。实现归 inner，交付 critical。
