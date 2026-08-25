---
id: gap-webui-session-discovery-claude-agents-json
title: web /sessions 会话发现统一为 claude agents --json（取代三角色 tmux 猜测）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`/sessions` 现有发现是 `buildManagerSessionTargets`（`packages/quay/src/observation.ts:1936`）只注册 manager/outer/inner 三个硬编码名字的 tmux 猜测式发现，覆盖不了 `-p`/headless 会话，也发现不了已结束会话。改以 `claude agents --json` 为单一发现源：覆盖运行中+已结束、交互式+`-p`（已实测两者同等注册，SPEC §2.2 更正段）。

## Plan

`buildManagerSessionTargets` 改为读 `claude agents --json`（或其落盘产物），枚举全部会话（含 `-p`/headless），移除三角色硬编码；`/sessions` 列表消费该枚举。

## Acceptance Criteria

- [x] AC1（能取假，-p 同等注册）：`/sessions` 列表含 `-p` 会话与交互式会话。实测 `readSessions(/home/yale/work/quay)` 返回 7 个运行中会话——`quay-outer`（交互式）+ 5 个 `quay-task-worker`（`-p` worker）+ `quay-91`；`-p` 与交互式同等注册（`claude agents --json` 都列、都带 transcript）。
- [x] AC2（能取假，已结束可见）：已结束会话仍出现在 `/sessions`。实测 20 个已结束会话（GONE 卡片、UUID 名、newest-first）出现。**更正（SPEC §2.4）**：已结束会话【不】来自 `--json`——registry 只列运行中；来自 transcript 目录扫描（`~/.claude/projects/<slug>/*.jsonl` 减去运行中 sessionId）。原「--json 覆盖运行中+已结束」前提有误，见下实现笔记。
- [x] AC3（能取假，不再硬编码）：`readSessions` 不再调用 `buildManagerSessionTargets`，三角色硬编码从 `/sessions` 发现路径移除——改由 `claude agents --json` 枚举全部会话（`-p` worker、任意名）。`buildManagerSessionTargets` 保留给 `/manager` 页的 outer+inner liveness 探针（另一功能，非本任务范围）。

## Definition of Done

`claude agents --json` 成为 `/sessions` 的**运行中**会话发现源（取代三角色 tmux 猜测）；已结束会话经 transcript 目录扫描补入（SPEC §3.1「不可能统一成一条路径」——registry 不含已结束）；AC1-3 全勾；`-p` + 交互式 + 已结束三类都覆盖。

## Implementation notes

**「唯一发现源」的更正（原 DoD 措辞不精确）**：`claude agents --json` 只覆盖运行中会话（实测 + SPEC §2.4「已结束会话——无登记表，只能扫 transcript 目录」），故「唯一发现源」只能指**运行中**会话发现；已结束会话必须来自 transcript 目录扫描。两条路径都被实现，各司其职：registry 供运行中（含 `-p`/交互式），目录扫描供已结束。

## Touches

- packages/quay/src/observation.ts（buildManagerSessionTargets）
- packages/quay/src/serve-sessions.ts（/sessions handler）
- packages/quay/test/observation.test.mjs（对应测试）
- tasks/gap-webui-session-discovery-claude-agents-json.md（自身）