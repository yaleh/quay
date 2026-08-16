---
id: gap-ac97-webui-zero-cost-gaps
title: "AC97: 三条零成本 Web UI 缺口先修（/board 导航链接 + /git-history 重启可见 + white-space 内联覆盖）"
status: todo
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

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` AC97。

**三条缺口（审计 P0，共同点=不需要写新功能）**：
```
① /board 没有任何页面链接到它（grep 实测：全文件只有路由自身，0 个 <a href="/board">）⇒ 加进导航
② /git-history 源码已完整实现，只是当前 demo 进程启动早于该功能落地 ⇒ 重启 quay serve 即可见
③ serve-handlers.ts:860 内联 style="white-space:normal" 覆盖 .label-nav-wrap 的 white-space:nowrap（设计意图和实现矛盾）
```

## Acceptance Criteria

- [ ] AC1: `curl` demo 实例 `/git-history` 返回 200（现为 404）——重启 serve 进程后。
- [ ] AC2: 任务列表页 HTML 中 `href="/board"` 命中 ≥1（现为 0）。
- [ ] AC3: serve-handlers.ts:860 的 white-space 内联覆盖移除/修正，`.label-nav-wrap` nowrap 意图生效。

## Definition of Done

- [ ] 三条零成本缺口修复落地，AC1-AC3 各自可机械核对。

## Touches

- packages/quay/src/serve-handlers.ts（white-space 覆盖 + 导航链接）
- packages/quay/test/（13 个既有 web 测试保持全绿）
- tasks/gap-ac97-webui-zero-cost-gaps.md（自身）
