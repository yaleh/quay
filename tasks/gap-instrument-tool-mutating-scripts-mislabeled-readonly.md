---
id: gap-instrument-tool-mutating-scripts-mislabeled-readonly
title: instrument MCP 工具被定位为诊断/只读，但准入脚本集合可执行破坏性操作（进程终止、交付派发）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: finding
---
## Finding

`packages/quay/src/mcp-server.ts:409` 注册的 `instrument` 工具，其描述/周边文字（约 409-454 行）将其定位为诊断/问答型接口。它的准入机制（`admitted` 计数在约 115 行附近追踪，错误消息在约 185 行附近：`no such instrument: "<name>" (the admitted directory has ${manifest.admitted}; ...)`）只要求 `plugin/scripts/*` 下的脚本携带 `@instrument "<question>"` 头部标签即可——**并不检查该脚本是否真的只读**。先前的审计确认准入集合里包含有真实副作用的脚本：`worktree-process-reaper.ts`（终止活进程/移除锁持有者）与 `quay-deliver.ts`（派发/抢占交付动作）。

另外，一次用量实证（grep 本仓库自身 Claude Code 会话历史——主会话+subagent+workflow jsonl，过滤为真实 `tool_use` 调用而非 schema 文本噪音）发现 **`instrument` 从未被真实调用过一次**——这意味着当前是零回归风险的修复窗口（没有既有调用方会被打破），但同时也意味着这个「可执行有副作用脚本」的风险目前只是结构性/潜在的,未经真实事故证实。

Proposed action（具体设计留给实现者）：方案 (a) 拆分成一个严格只读准入的工具，加一个独立命名的工具给有副作用的脚本，描述文字明确警示副作用风险；或方案 (b) 保留单一工具但改写其暴露的描述文字，明确声明它可能执行包括进程终止和交付派发等副作用的脚本，并/或要求对标记为 mutating 的脚本在运行前提供一个显式的额外确认参数。

## Acceptance Criteria

- [ ] 复现：列出 `plugin/scripts/*` 中携带 `@instrument` 标签但具有真实副作用的脚本清单（至少含 `worktree-process-reaper.ts`、`quay-deliver.ts`），确认其准入机制未区分只读/有副作用
- [ ] 选定并实现方案 (a) 或 (b)：若 (a)，新工具/旧工具的准入集合清晰分离，只读工具的准入校验拒绝有副作用的脚本；若 (b)，`instrument` 工具的 description 文本显式警示副作用风险，且/或新增 mutating 脚本运行前的显式确认参数
- [ ] 新增/更新测试覆盖：对已知有副作用的脚本（如 `worktree-process-reaper.ts`）调用 `instrument` 工具时，按选定方案的行为（拒绝/警示文案出现/需要确认参数）有断言覆盖
- [ ] `node --test packages/quay/test/mcp-server*.test.mjs` 全绿，无回归

## Definition of Done

全部 AC 勾选；`instrument` 工具的只读定位与其实际准入脚本集合的真实副作用能力之间不再存在未声明的落差；测试绿。

## Touches

- packages/quay/src/mcp-server.ts
- packages/quay/test/mcp-server.test.mjs
- tasks/gap-instrument-tool-mutating-scripts-mislabeled-readonly.md
