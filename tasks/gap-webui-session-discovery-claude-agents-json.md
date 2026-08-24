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

- [ ] AC1（能取假，-p 同等注册）：`/sessions` 列表含 `-p` 会话与交互式会话（⛔ `-p` 会话仍缺失 ⇒ 假）。
- [ ] AC2（能取假，已结束可见）：已结束会话仍出现在 `/sessions`（--json 覆盖运行中+已结束；⛔ 已结束不在列表 ⇒ 假）。
- [ ] AC3（能取假，不再硬编码）：移除 `buildManagerSessionTargets` 的三角色硬编码（⛔ 仍只注册 manager/outer/inner 3 个名字 ⇒ 假）。

## Definition of Done

`claude agents --json` 成为 `/sessions` 唯一发现源；AC1-3 全勾；`-p` + 交互式 + 已结束三类都覆盖。

## Touches

- packages/quay/src/observation.ts（buildManagerSessionTargets）
- packages/quay/src/serve-sessions.ts（/sessions handler）
- packages/quay/test/observation.test.mjs（对应测试）
- tasks/gap-webui-session-discovery-claude-agents-json.md（自身）