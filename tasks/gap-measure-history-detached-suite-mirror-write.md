---
id: gap-measure-history-detached-suite-mirror-write
title: "measure-history.jsonl detached-suite 停摆——fan-in setsid 路径绕过 full-suite-runner.ts 唯一写入者，照抄 full-suite-state.json 的 mirror-write 模式补 mirror-write"
status: todo
labels:
  - gap
  - observability
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`measure-history.jsonl`（每轮每文件耗时追踪）停摆两天多（最后一条停在 2026-08-17T04:29:08Z，整个今晚几十轮 suite 均无写入）。根因：fan-in 的 detached-suite 路径（`fan-in-execute.js` 的 `setsid bash scripts/test.sh`）**不经过 `full-suite-runner.ts`**（唯一写入者），所以该路径产生的 suite 结果两个兄弟产物都不更新。

与 `full-suite-state.json` 是**同一写入者的兄弟产物**——`gap-full-suite-state-stale-no-writer`（8dc46a4c）修了 `full-suite-state.json`（新增 `mirror-full-suite-state.ts` 做 mirror-write），却漏了 `measure-history.jsonl`。**硬规则 5b 实例**：同一根因（detached-suite 绕过唯一写入者）的两个受害产物，修一个漏兄弟。

## Acceptance Criteria

- [ ] AC1: `measure-history.jsonl` 在 detached-suite 路径也被写入——照抄 `mirror-full-suite-state.ts` 的 mirror-write 模式，新增薄写入器并接线到 `fan-in-execute.js` step 4.5（双拷贝同步 `.claude/workflows/fan-in-execute.js`）。
- [ ] AC2: 负控制落在生产载体——一次真实 detached-suite fan-in 后，`measure-history.jsonl` 有本轮每文件耗时记录（读生产载体，非 fixture/standalone 注入）。
- [ ] AC3: `measure-trend-check.ts` 消费者不红（mirror-write 后数据格式与 full-suite-runner.ts 直写一致）。

## Definition of Done

- [ ] 真实 detached-suite fan-in 后 `measure-history.jsonl` 更新（不再停摆），scoped 绿 + 消费者不红（真实输出）。

## Touches

- tasks/gap-measure-history-detached-suite-mirror-write.md（自身）
- plugin/scripts/mirror-measure-history.ts（新增：fan-in detached-suite 的 measure-history.jsonl mirror-write 薄写入器，照抄 mirror-full-suite-state.ts）
- plugin/workflows/fan-in-execute.js（step 4.5 增 mirror-history-block；双拷贝同步 .claude/workflows/fan-in-execute.js）
- plugin/scripts/measure-trend-check.ts（消费者，确认 mirror-write 后仍正确读）
- plugin/scripts/select-static-checks-for-touches.ts（FAN_IN_ORCHESTRATION_FILES 增补 mirror-measure-history.ts）
- plugin/scripts/capability-catalog.sh（新脚本登记）
