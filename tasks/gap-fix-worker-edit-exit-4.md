---
id: gap-fix-worker-edit-exit-4
title: fix-worker claude -p 编辑型任务 exit=4（根因待 stderr 定位，⛔ kimi 为待验证候选）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：AC142 fan-in `## Findings`（AC4 待外部）。`--bare` 修法已消解原 exit=1 认证失败，但 `claude -p` 在【编辑成功后】以 exit=4 退出、stdout/stderr 均空 ⇒ `spawnFixWorker.exitCode=4` ⇒ `result.ok = (exitCode===0) = false`。

**实测判别对照（已跑）**：benign prompt `reply with exactly: FIX-OK` → exit 0；编辑型任务 → exit 4。差异在「编辑型 vs 纯回话型」（工具调用/多轮/auto-memory 触发等），⛔ 非「是否触发 session-title」。

**根因待定（⛔ kimi 为待验证候选，已被简单-prompt 对照削弱）**：原候选「session-title 用 `~/.claude/settings.json` `model=kimi-k2.7-code` ⇒ FJDAC 400」**被自己的对照证否**——若 session-title 是成因，简单 prompt 也该失败，但它 exit 0。退出码在 `--bare` 边界上变了（去 bare 前 exit=1 认证失败，去 bare 后 exit=4），修法方向两可能：①「揭开」kimi 问题一直被认证失败挡住 ⇒ 修 kimi 配置；②「引入」非 bare 路径做了 bare 跳过的步骤（auto-memory/attribution）⇒ 改回 bare + `apiKeyHelper`。⛔ 不猜，读 stderr。

**影响**：不阻断晋升（AC133 重闸不信 worker 自述，被修好的任务照常晋升），但 `result.ok` 字段长期失真 ⇒ AC4 字面判据不可信、telemetry 污染。

## Plan

1. **读 stderr 定根因**：下一次真实 fix 触发会把 exit-4 的 stderr 写进 `promotion-outcome.jsonl` `result.detail`（AC142-1 刚造出的捕获面）——据此定根因，⛔ 不预设 kimi。
2. **修**：按 stderr 指向的根因修（kimi 配置 / bare+apiKeyHelper / 其它）。

## Acceptance Criteria

- [ ] AC1：读到一条真实 fix 触发的 exit-4 的 stderr，并据此定根因（⛔ 无 stderr 的推测结论 ⇒ 假）。
- [ ] AC2：修复落地后 `promotion-outcome.jsonl` `action="fix"` 且 `result.ok=true` ≥1（窗口只计修复落地后）。

## Definition of Done

- [ ] stderr 定根因 + 修复 + fix-worker `result.ok=true` 生产验证；AC1-2 全勾；land 到 develop。

## Retires

- 无

## Touches

- tasks/gap-fix-worker-edit-exit-4.md（自身）
- plugin/scripts/promotion-driver.ts（若修法=spawnFixWorker 处理 exit-4；test: plugin/test/promotion-driver.test.mjs）
- .claude/launch.settings.json（若修法=仓库侧 model/env 覆盖；test: plugin/test/launch-settings.test.mjs）
