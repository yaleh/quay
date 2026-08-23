---
id: gap-fix-worker-spawn-zero-diagnostic-info
title: fix-worker spawn 零诊断信息（stdio 全 ignore）+ 无 timeout——先能看见报错
status: todo
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

**来源**：manager 投立案（高优先级，机制核心能力）。生产至今 fix-worker **4/4 = 100% exitCode=1**（wrapper 修复前后都失败），且**完全无法诊断为什么**——根因是 `promotion-driver.ts:210` `spawnFixWorker()`：
```ts
spawnSync(argv[0], argv.slice(1), { cwd: root, encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
```
stdout/stderr **全部 `ignore`**——fix-worker（claude CLI）真实报错（认证失败？超时？prompt 格式？`--bare` 副作用？）从未被捕获过一次。且无 timeout（同文件 `runPromotionRound` 有 `timeout: ROUND_TIMEOUT_MS`，这里没有）。

**影响**：AC132/133（fix-worker 诊断修复路径）是 AC130-140 核心一半；AC138-3（worker-driver 侧 fix-worker）依赖同一套 spawn。不查根因，AC138-3 大概率重蹈 100% 失败。⛔ 别猜根因——先加日志、看一次真实报错，再谈修法（硬规则④推论四）。

## Plan

1. `spawnFixWorker` 的 stdio 从 `["ignore","ignore","ignore"]` 改成捕获（如 `["ignore","pipe","pipe"]`），把 stdout/stderr 写进 outcome 记录新字段（或至少 `.quay/promotion-driver.log`）。
2. 加 timeout（对齐 `runPromotionRound` 的 `ROUND_TIMEOUT_MS`）。

## Acceptance Criteria

- [ ] AC1：fix-worker 的 stdout/stderr 被捕获落盘（⛔ 仍 ignore ⇒ 假）。
- [ ] AC2：跑一次真实 fix-worker 失败后，outcome 记录/log 里有其真实报错（⛔ 零诊断信息 ⇒ 假）。
- [ ] AC3：spawnFixWorker 有 timeout（对齐 runPromotionRound）。

## Definition of Done

- [ ] stdio 捕获 + timeout 落地；AC1-3 全勾；land 到 develop。

## Retires

- 无（补诊断面）

## Touches

- plugin/scripts/promotion-driver.ts（spawnFixWorker stdio 捕获 + timeout）
- plugin/test/promotion-driver.test.mjs（stdio 捕获 + timeout 测试）
- tasks/gap-fix-worker-spawn-zero-diagnostic-info.md（自身）
