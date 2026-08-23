---
id: gap-fix-worker-exit-4-kimi-model-fjdac
title: fix-worker claude -p 编辑成功后 exit=4（~/.claude/settings.json kimi-k2.7-code 在 FJDAC 400）——result.ok 失真
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

**实测判别对照（已跑）**：同链 benign prompt `reply with exactly: FIX-OK` → exit 0 + 输出正确；编辑型任务（真实 DoD<40 任务）→ exit 4。差别在「是否触发编辑 + 事后 session-title 生成」。

**疑似根因**：`~/.claude/settings.json` 默认 `model: kimi-k2.7-code`（已核：该文件 `model` 键 = `kimi-k2.7-code`），`claude -p` 内部某步（session-title）用该模型在 FJDAC 代理上 400 `Invalid model name`——`--model deepseek-v4-pro`（launch.settings.json）只管主模型，session-title 走 settings.json 默认模型。

**影响**：不阻断晋升（AC133 重闸不信 worker 自述，被修好的任务照常晋升），但 `result.ok` 字段长期失真（实际编辑成功却报 ok=false）⇒ AC4 字面判据不可信、telemetry 长期污染。

## Plan

1. **确认根因**（判别对照）：改 `~/.claude/settings.json` 的 model（或加 env 覆盖）后，同一编辑型 prompt 的 exit 是否 4→0。
2. **修**：让 claude 内部所有步骤用 FJDAC 接受的模型（deepseek-v4-pro），且不破坏用户正常 claude 用法。

## Acceptance Criteria

- [ ] AC1：exit-4 根因确认（附「若假设为假则结果不同」的判别对照）。
- [ ] AC2：修复落地后 `promotion-outcome.jsonl` `action="fix"` 且 `result.ok=true` ≥1（窗口只计修复落地后）。

## Definition of Done

- [ ] exit-4 根因确认 + 修复 + fix-worker `result.ok=true` 生产验证；AC1-2 全勾；land 到 develop。

## Retires

- 无

## Touches

- tasks/gap-fix-worker-exit-4-kimi-model-fjdac.md（自身）
- plugin/scripts/promotion-driver.ts（若修法=spawnFixWorker 处理 exit-4；test: plugin/test/promotion-driver.test.mjs）
- .claude/launch.settings.json（若修法=仓库侧 model/env 覆盖；test: plugin/test/launch-settings.test.mjs）
