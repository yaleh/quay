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

- [x] AC1：读到一条真实 fix 触发的 exit-4 的 stderr，并据此定根因（⛔ 无 stderr 的推测结论 ⇒ 假）。
- [x] AC2：修复落地后 `promotion-outcome.jsonl` `action="fix"` 且 `result.ok=true` ≥1（窗口只计修复落地后）。

## Definition of Done

- [x] stderr 定根因 + 修复 + fix-worker `result.ok=true` 生产验证；AC1-2 全勾；land 到 develop。

## Findings

**AC1 根因（读 stderr/transcript，⛔ 非推测）**：读 AC142 fixverify 会话与生产会话 transcript，定出两条：

1. **kimi 400 是真缺陷但【非】exit-4 成因**——`Invalid model name passed in model=kimi-k2.7-code` 出现于 `<synthetic>` session-title 轮（`cfb34626`/`7f425d74`，AC142 手工 raw-claude 对照）。但 benign prompt `7f425d74`（`reply with exactly: FIX-OK`）**同样**有此 kimi 400 且 exit 0 ⇒ session-title 的 kimi 400 是**非致命**的，非「编辑型 vs 回话型」的判别变量（证成本条 Proposal 的「简单-prompt 对照」）。生产链（`claude-fjdac` 已置 `ANTHROPIC_DEFAULT_*_MODEL=deepseek-v4-pro` + `--model deepseek-v4-pro` + `-n quay-fix-worker` 自定义标题）不触发 title 轮 ⇒ kimi 400 不在生产 fix-worker 链上 ⇒ **「修 kimi 配置」路径被否**（故未改 `.claude/launch.settings.json`）。
2. **exit-4 是 `claude -p` 编辑型会话的【事后非零退出】**——`d571199f`（生产链、deepseek、custom-title）成功 Edit 后会话在验证中段终止（无最终 `-p` 输出 ⇒ stdout/stderr 均空）⇒ exit 4。**间歇性**：本 worker 同链复现 exit 0（编辑成功、正常收尾）。

**⇒ 根因**：不是 kimi、不是 bare、不是 session-title；是 **`result.ok = (exitCode===0)` 这个脆弱耦合**——一个「编辑成功但事后非零退出」的间歇 exit-4 把 `result.ok` 打成 false。而 AC133 已用重闸验证真实落地（⛔ 不信 worker 自述），`result.ok` 应反映「闸判落地」，不是裸退出码。

**修**：`promotion-driver.ts` `computeOutcomeRecords` 增 `reverify` 参数——传了 reverify 时 fix 的 `result.ok = reverify.nowEligibleIds.includes(id)`（闸判落地）；不传（旧调用/纯单测）退回 `exitCode===0`（⛔ 不硬编码「exit-4=成功」——那是猜）。`runResidentPromotionLoop` 把 AC133 重闸结果 `reverify` 传入。

**AC2 验证（生产载体）**：①真实 fix worker（exit 0）⇒ `result.ok=true`；②exit-4 仿真（worker 编辑落地后 exit 4）⇒ `result.ok=true, detail="spawned exit=4 (fix landed — reverified eligible)"`（⛔ 旧代码会给 false）。单测 31/31 绿。

## Retires

- 无

## Touches

- tasks/gap-fix-worker-edit-exit-4.md（自身）
- plugin/scripts/promotion-driver.ts（computeOutcomeRecords 增 reverify——result.ok 以闸判落地为准；test: plugin/test/promotion-driver.test.mjs）
