---
id: gap-webui-session-lifecycle
title: web 会话生命周期（headless driver 暴露 + -p 新建 + --resume 重启；交互式先不暴露）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  depends_on:
    - gap-ac154-claude-code-profile-extraction
---
**type:** execution

## Proposal

会话生命周期管理：headless 两个 kind 直接暴露既有 `quay driver <verb>`（start/stop/restart，低风险）；新建会话 = `-p --input-format stream-json` + `--session-id <uuid>` + profile + 权限模式；重启 = `--resume`（已实测可用且上下文保留，SPEC 结论 3）。⛔ 交互式 manager/outer/inner 的 web 停/重启先不做（无鉴权前提下任何人可杀掉正在工作的 manager，风险不对等）。

**⛔ blocker（人裁定 ②，未决）**：profile 路线 (a) 按名字引用 wrapper vs (b) 自足 profile + 独立凭据层——profile 面依赖 AC154，本条的 profile 部分用 AC154 沉淀的结论（⛔ 不新立 profile 任务）。

**⛔ blocker（人裁定 ③，未决）**：权限默认值——实测 `-p` 会话权限模式【没有"逐次批准"档】：`--permission-mode manual` 下需授权工具直接失败（无 `control_request` 可答）⇒ 能干活的 web 启动会话必然 bypassPermissions 或预声明 allowedTools。这是安全取舍，默认值待裁定 ③，⛔ 不默认一个值。

## Plan

headless 两 kind 接 `quay driver`；新建会话走 `-p` + `--session-id`；重启走 `--resume`；交互式三层的停/重启暂不暴露。

## Acceptance Criteria

- [ ] AC1（能取假，driver 暴露）：headless 两 kind 经 web 可 start/stop/restart（复用 `quay driver`；⛔ 手工重造 driver 逻辑 ⇒ 假）。
- [ ] AC2（能取假，真重启）：`--resume` 重启已结束会话且上下文保留（答出原会话首条回复原文可作证；⛔ resume 后上下文丢 ⇒ 假）。
- [ ] AC3（能取假，交互式不暴露）：交互式 manager/outer/inner 的 web 停/重启未暴露（⛔ 暴露了交互式 kill 入口 ⇒ 假）。

## Definition of Done

headless 生命周期（driver + 新建 + --resume 重启）落地；AC1-3 全勾；profile 面复用 AC154、权限默认值待裁定 ③；交互式停/重启留待后续鉴权。

## Touches

- packages/quay/src/serve-handlers.ts（生命周期 handler）
- packages/quay/src/cli/driver.ts（quay driver 暴露，如需）
- packages/quay/test/serve-handlers.test.mjs（对应测试）
- tasks/gap-webui-session-lifecycle.md（自身）