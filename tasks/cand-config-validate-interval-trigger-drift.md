---
id: cand-config-validate-interval-trigger-drift
title: config validate 不识别 `interval:<N>m` routine trigger，而运行时与调度器都支持
status: ready
labels:
  - gap
  - config
---

## Finding

**结论**：`packages/quay/src/config-validate.ts:528` 的 routine trigger 校验正则只接受
`every(N)` / `on(<event>)`：

```js
if (!/^(every\(\s*\d+\s*\)|on\(\s*[\w-]+\s*\))$/.test(triggerStr)) {
```

而运行时 `readLoopParams`(packages/quay/src/loop-params.ts:202) 与调度器
`routine-scheduler.ts:44-48`（`/^interval:\s*(\d+)\s*m$/`）都支持 `interval:<N>m`
（两层的按时间触发，DIR-056 后的标准形态）。`checkRoutines` 且把该情况报为 **error**。

**实测**：对一个含
`routines: [{ name: nightly-report, trigger: "interval:30m", probe: nightly-report }]`
的 `.quay/config.yml`（无 `gates:` 节）跑 `quay config validate`：

```
error: loop.routines[0].trigger — Routine "nightly-report" trigger "interval:30m" is invalid
  suggestion: Must be "every(N)" (N>=1) or "on(<event>)"
```

`validateConfig` 的 `ok = !issues.some(i => i.severity === "error")` → `ok:false`。
同一配置 `readLoopParams` 与 `routine-scheduler.parseTrigger` 均接受。

**为什么重要**：验证器与运行时对同一份合法配置给出相反结论——`quay config validate` 会对一个
运行正常的两层 routine 工作区报 `ok:false`（且 MCP `config_validate` 工具同样误报）。这是
DIR-100 结构校验层与运行时之间真实漂移：`interval:` 是被设计文档与调度器双支撑的特性，
校验器漏掉了它。

## Acceptance Criteria

- [x] 复现：`config-validate.ts` 的 `checkRoutines` 对 `trigger: "interval:5m"` 的 routine 报 error。
- [x] 修复后：`interval:<N>m`（N≥1）通过校验；`interval:0m` / `interval:1x` 仍报 error
  （与 `readLoopParams`/`routine-scheduler` 语义一致）。
- [x] 修复不改变 `every(N)` / `on(<event>)` 的既有校验；`config-validate.test.mjs` 保持绿。

## Touches

- packages/quay/src/config-validate.ts（`checkRoutines` 的 trigger 正则）
- packages/quay/test/config-validate.test.mjs
- tasks/cand-config-validate-interval-trigger-drift.md（自身：勾 AC + 贴证据）

## Evidence

修复：`config-validate.ts` 的 `checkRoutines` trigger 正则从
`/^(every\(\s*\d+\s*\)|on\(\s*[\w-]+\s*\))$/` 对齐到运行时 `readLoopParams`
（loop-params.ts:202）接受的 `/^(every\(\s*\d+\s*\)|interval:\s*\d+\s*m|on\(\s*[\w-]+\s*\))$/`，
并新增与运行时一致的 `interval:<N>m` 的 N>=1 检查（`interval:0m` 报 error）。
`every(N)` / `on(<event>)` 既有校验不变。`config-validate.test.mjs` 新增 4 个用例：
`interval:30m` 通过（含 finding 的"无 gates 节"精确复现）、`interval:0m` 报
"N must be >= 1"、`interval:1x` 报 invalid。

Scoped gate（`scripts/test.sh --for-task cand-config-validate-interval-trigger-drift`）：
8 个 Touches 关联测试文件，129 tests pass / 0 fail。config-validate.test.mjs 单独跑：51 pass / 0 fail。
