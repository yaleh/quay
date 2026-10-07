---
id: gap-stripheadings-quadruple-duplication-cli-task-list-client-filter
title: 搜索归一化逻辑 stripHeadings 被独立实现 4 次；CLI quay task list 自行重做过滤而非转发服务端参数
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
## Finding

`grep -rln "^export function stripHeadings\|^function stripHeadings"` 在全库范围内（先前审计）返回 4 个独立命中：`packages/quay-native/src/store.ts`（`stripHeadingsForSearch`，是支撑 MCP `task_list` 服务端 `search` 过滤的权威搜索实现）、`packages/quay/src/cli/flags.ts`、`packages/quay/src/mcp-handlers.ts`、`packages/quay/src/serve-render.ts`——四份各自独立编写的同一文本归一化逻辑拷贝。

另外，`packages/quay/src/cli/task-list.ts`（`quay task list` CLI 命令）目前只把 `status` 参数转发给 provider（经由 MCP `task_list` 工具）；它强制 `includeBody: true` 取回全部任务，然后在客户端 TypeScript 里重新实现 prefix 匹配、label（AND）匹配、全文搜索过滤——而不是像 MCP `task_list` 本身已原生支持的那样把 `prefix`/`label`/`search` 下推给 provider 做服务端过滤。

## Acceptance Criteria

- [ ] 选定一份权威 `stripHeadingsForSearch` 实现（建议 `packages/quay-native/src/store.ts` 里的那份，因为它是权威搜索后端），其余三个文件改为 import 它而不是各自重新定义
- [ ] 三份重复定义（`packages/quay/src/cli/flags.ts`、`packages/quay/src/mcp-handlers.ts`、`packages/quay/src/serve-render.ts`）已删除，改为从单一正本 import
- [ ] `quay task list` CLI 改为把 `label`/`prefix`/`search` 转发给 provider 调用，而不是取回全部 body 后客户端重新过滤
- [ ] `grep -rln "^export function stripHeadings\|^function stripHeadings"` 修复后只命中 1 个文件
- [ ] 既有测试（`cli.test.mjs`、`mcp-handlers.test.mjs`、`serve-render*.test.mjs`、`task-list.test.mjs` 等相关文件）全绿，无行为回归（search/prefix/label 过滤结果与修复前一致）

## Definition of Done

全部 AC 勾选；`stripHeadings`/`stripHeadingsForSearch` 单一正本 + 三处 import；`quay task list` CLI 服务端过滤下推生效；既有测试全绿。

## Touches

- packages/quay-native/src/store.ts
- packages/quay/src/cli/flags.ts
- packages/quay/src/mcp-handlers.ts
- packages/quay/src/serve-render.ts
- packages/quay/src/cli/task-list.ts
- packages/quay/test/cli.test.mjs
- tasks/gap-stripheadings-quadruple-duplication-cli-task-list-client-filter.md
