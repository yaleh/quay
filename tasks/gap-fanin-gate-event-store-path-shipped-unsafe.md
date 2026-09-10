---
id: gap-fanin-gate-event-store-path-shipped-unsafe
title: fan-in 的 appendCompleteGateEvent 硬编码
  packages/quay/src/gate/gate-event-store.ts —— shipped 上下文 MODULE_NOT_FOUND ⇒
  gate-events.jsonl 永不写，AC-207 判据 gate_events>0 恒不满足
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
goal_ac: AC-207
---
## Proposal

AC-207 端到端第 10 轮实测暴露第五个 shipped-unsafe 锚点（同族于已 done 的 `gap-plugin-root-resolution-remaining-callsites-round2` 与 `gap-driver-fanin-hardcoded-test-sh-third-party`）：orangevps 第三方项目 `/home/yale/work/ac207-third-party` 的 e2e-verify-207 已由其自身 worker-driver 机械 fan-in landed（`worker-outcome.jsonl` `final_state:"completed"`、`mechanical_fan_in.outcome:"landed"`、`landedSha:a319990759...`），但 fan-in step-trace 的 `append-complete-gate-event` 步骤 exit 1：

```
{"step":"append-complete-gate-event","exit":1,"ok":false,"reason":"Cannot find module '/home/yale/work/ac207-third-party/packages/quay/src/gate/gate-event-store.ts' imported from /tmp/ac207-prefix/lib/node_modules/quay/plugin/scripts/dist/worker-driver.js"}
```

根因（位置判定，非关键词）：`plugin/scripts/worker-driver.ts` `appendCompleteGateEvent`（gap-mechanical-fan-in-writes-no-complete-gateevent）动态 import `path.join(repoRoot(), "packages", "quay", "src", "gate", "gate-event-store.ts")`——quay 仓库布局路径。shipped npm 包把 `packages/quay/` 内容打平到包根（实测 `/tmp/ac207-prefix/lib/node_modules/quay/src/gate/gate-event-store.ts` 存在、`.../quay/packages/` 不存在），故该 import 在 shipped 上下文 MODULE_NOT_FOUND、被 best-effort catch 静默吞 ⇒ 机械 fan-in 翻 done 后 `.quay/gate-events.jsonl` 永不写 ⇒ AC-207 criterion `gate_events>0` 恒不满足。同族 `ffMergeModule`→`packages/quay/src/fan-in/ff-merge.ts`（本轮 ff 恰 landed 未爆，同为 shipped-unsafe 锚点）。round2 只清了 `plugin", "scripts"` 锚点，漏了 `packages/quay/src` 布局锚点。

## Plan

1. `appendCompleteGateEvent` 的 `appendGateEvent` 动态 import 改为 dist/shipped 感知解析（复用 `resolveKernelPluginRoot`/`resolveKernelSibling` 或等价 repo-root 解析器：shipped 上下文解析到包根 `src/gate/gate-event-store.ts`，源树上下文解析到 `packages/quay/src/gate/gate-event-store.ts`），⛔ 不硬编码 `packages/quay/src`。
2. `ffMergeModule`（`packages/quay/src/fan-in/ff-merge.ts`）同法修。
3. 双向负控制：源树场景两 import 行为逐字不变；shipped 场景（包根打平、无 packages/）两 import 成功解析。
4. 生产复跑：orangevps 第三方项目重装后，e2e fan-in 的 `append-complete-gate-event` exit 0 且 `.quay/gate-events.jsonl` 非空。

## Acceptance Criteria

- [x] AC1 位置判定：`appendCompleteGateEvent` 与 `ffMergeModule` 两处 `packages/quay/src` 锚点改为 dist/shipped 感知解析（grep 旧锚点归零，贴前 3 条命中，硬规则②）。
- [x] AC2 shipped 负控制：包根打平布局（无 packages/quay/src）下动态 import `gate-event-store.ts` 成功并可写 gate-events.jsonl。
- [x] AC3 双向不变：源树场景两 import 行为逐字不变，existing tests 绿。

## Definition of Done

AC1–AC3 全绿；`scripts/test.sh` 全量绿。orangevps 第三方项目重装后 e2e fan-in `append-complete-gate-event` exit 0 且 `.quay/gate-events.jsonl` 非空（AC-207 criterion 的 gate_events 可被满足）。

## Touches

- `plugin/scripts/worker-driver.ts`
- `plugin/test/worker-driver.test.mjs`
- `tasks/gap-fanin-gate-event-store-path-shipped-unsafe.md`
