---
id: gap-manager-layer-launch-config-test-pin-fjdac
title: manager-layer 测试 launcher pin 同步到 claude-fjdac（b4572bb8 5b 欠账）——当前阻塞所有 fan-in
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

**来源**：b4572bb8（人 2026-08-20 裁定「outer/inner wrapper换回claude-fjdac，模型保持deepseek-v4-flash」）把 `.claude/launch.settings.json` 的 outer/inner launcher 改回 `claude-fjdac`，**但未同步 2 个 manager-layer 测试文件的 launcher pin**（同一 5b 形态的既有实例 14b8d4a7：换 wrapper 时漏同步测试，第 9 处同类漂移）。

**证据（能取假）**：
- 当前 config（正本）：`_launchSpec.roles.outer.launcher = claude-fjdac`（b4572bb8，人裁定，authoritative）
- 当前测试 pin（stale）：
  - `plugin/test/manager-layer-skill.test.mjs:87`：`assert.equal(outer?.launcher, 'claude-deepseek', …)`
  - `plugin/test/manager-layer-shipping.test.mjs:87`：`assert.match(src, /claude-deepseek/, …)`
- 全量 suite 红于这两条（2026-08-20 17:25Z，bootstrap-stale fan-in suite exit=1），**阻塞所有 fan-in**（bootstrap-stale / satisfy / ac105 串行链全卡）。

**为什么现在**：全量 suite 的红是结构性的——任何 fan-in 的全量 suite 都会撞上这两条 stale pin。不修则三条串行 fan-in 无法 land。这是当前管线的唯一阻塞点。

**为什么 inner 执行**：文件属 `plugin/test/`（产品测试代码）→ inner 域（D 边界：outer 不改产品代码）。

## Plan

1. 改 `plugin/test/manager-layer-skill.test.mjs:87`：`claude-deepseek` → `claude-fjdac`。
2. 改 `plugin/test/manager-layer-shipping.test.mjs:87`：`/claude-deepseek/` → `/claude-fjdac/`。
3. 同步两文件头注释（:12 / :17 / :84 提到 claude-deepseek 的文案）→ claude-fjdac，保持文档与断言一致。
4. 跑 scoped 测试（两文件 + 依赖），确认绿。
5. fan-in（AC78 workflow）：scoped + 全量 + doc 检查，全绿后 land。

## Acceptance Criteria

- [x] AC1: `plugin/test/manager-layer-skill.test.mjs` 与 `plugin/test/manager-layer-shipping.test.mjs` 中所有 `claude-deepseek` launcher pin 已改为 `claude-fjdac`（`grep -n 'claude-deepseek'` 两文件 0 命中）。
- [x] AC2: 两测试文件单独跑绿（`node --test plugin/test/manager-layer-skill.test.mjs plugin/test/manager-layer-shipping.test.mjs`）。
- [ ] AC3: 全量 suite 不再因这两条 pin 红（fan-in 阶段全量绿）。
- [x] AC4: 记录 commit sha（本任务自身）。commit sha=`29ba65c0`

## Definition of Done

- [ ] launcher pin 同步完成且验证绿；fan-in 全量 suite 绿；land 到 develop。

## Touches

- plugin/test/manager-layer-skill.test.mjs
- plugin/test/manager-layer-shipping.test.mjs
- tasks/gap-manager-layer-launch-config-test-pin-fjdac.md（自身）
