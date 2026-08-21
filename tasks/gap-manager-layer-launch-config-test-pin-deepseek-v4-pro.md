---
id: gap-manager-layer-launch-config-test-pin-deepseek-v4-pro
title: manager-layer 测试 model pin 同步到 deepseek-v4-pro（e21e843d 欠账）——当前阻塞所有 fan-in
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：e21e843d（人 2026-08-21 16:5xZ 裁定「outer/inner model 从 deepseek-v4-flash 改为 deepseek-v4-pro」，wrapper 保持 claude-fjdac）把 `.claude/launch.settings.json` 的 outer/inner `model` 改为 `deepseek-v4-pro`，**但未同步 2 个 manager-layer 测试文件的 model pin**（同一 5b 形态的既有实例：gap-manager-layer-launch-config-test-pin-fjdac 是第 9 处同类漂移——换 wrapper 时漏同步测试；本任务是其镜像半边，换 model 时漏同步，第 10 处同类漂移）。

**证据（能取假）**：
- 当前 config（正本，authoritative）：`_launchSpec.roles.outer.model = deepseek-v4-pro`、`inner.model = deepseek-v4-pro`（e21e843d）。
- 当前测试 pin（stale）：
  - `plugin/test/manager-layer-skill.test.mjs:88`：`assert.equal(outer?.model, 'deepseek-v4-flash', …)`
  - `plugin/test/manager-layer-shipping.test.mjs:88`：`assert.match(src, /deepseek-v4-flash/, …)`
- 另 4 处文案（注释/测试名，不直接使断言失败但需同步）：
  - `manager-layer-skill.test.mjs:12`（头注释）、`:81`（测试名）
  - `manager-layer-shipping.test.mjs:17`（头注释）、`:84`（测试名）
- 全量 suite 红于这两条 pin（结构性：任何 fan-in 的全量 suite 都撞），**阻塞所有 fan-in**。

**为什么现在**：全量 suite 的红是结构性的——任何 fan-in 的全量 suite 都会撞上这两条 stale model pin。不修则本阶段 AC120–AC125 的任何 fan-in 都无法 land。

**为什么 inner 执行**：文件属 `plugin/test/`（产品测试代码）→ inner 域（D 边界：outer 不改产品代码）。

## Plan

1. 改 `plugin/test/manager-layer-skill.test.mjs:88`：`'deepseek-v4-flash'` → `'deepseek-v4-pro'`。
2. 改 `plugin/test/manager-layer-shipping.test.mjs:88`：`/deepseek-v4-flash/` → `/deepseek-v4-pro/`。
3. 同步两文件头注释/测试名里提到 deepseek-v4-flash 的文案（:12 / :81 / :17 / :84）→ deepseek-v4-pro。
4. 跑 scoped 测试（两文件 + 依赖），确认绿。
5. fan-in（AC78 workflow）：scoped + 全量 + doc 检查，全绿后 land。

## Acceptance Criteria

- [ ] AC1: `plugin/test/manager-layer-skill.test.mjs` 与 `plugin/test/manager-layer-shipping.test.mjs` 中所有 `deepseek-v4-flash` model pin 已改为 `deepseek-v4-pro`（`grep -n 'deepseek-v4-flash'` 两文件 0 命中）。
- [ ] AC2: 两测试文件单独跑绿（`node --test plugin/test/manager-layer-skill.test.mjs plugin/test/manager-layer-shipping.test.mjs`）。
- [ ] AC3: 全量 suite 不再因这两条 pin 红（fan-in 阶段全量绿）。
- [ ] AC4: 记录 commit sha（本任务自身）。

## Definition of Done

- [ ] model pin 同步完成且验证绿；fan-in 全量 suite 绿；land 到 develop。

## Touches

- plugin/test/manager-layer-skill.test.mjs
- plugin/test/manager-layer-shipping.test.mjs
- tasks/gap-manager-layer-launch-config-test-pin-deepseek-v4-pro.md（自身）
