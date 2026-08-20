---
id: gap-measure-history-detached-suite-mirror-write
title: "measure-history.jsonl detached-suite 停摆——fan-in setsid 路径绕过 full-suite-runner.ts 唯一写入者，照抄 full-suite-state.json 的 mirror-write 模式补 mirror-write"
status: ready
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

- [x] AC1: `measure-history.jsonl` 在 detached-suite 路径也被写入——照抄 `mirror-full-suite-state.ts` 的 mirror-write 模式，新增薄写入器并接线到 `fan-in-execute.js` step 4.5（双拷贝同步 `.claude/workflows/fan-in-execute.js`）。
- [ ] AC2: 负控制落在生产载体——一次真实 detached-suite fan-in 后，`measure-history.jsonl` 有本轮每文件耗时记录（读生产载体，非 fixture/standalone 注入）。（待外部——本 impl 只交付 writer+wiring+scoped 绿；真实 detached-suite fan-in 由 AC78 fan-in 步骤自身执行并在 step 4.5 经 mirror-history-block 落账后确认）
- [x] AC3: `measure-trend-check.ts` 消费者不红（mirror-write 后数据格式与 full-suite-runner.ts 直写一致）。

## Definition of Done

- [ ] 真实 detached-suite fan-in 后 `measure-history.jsonl` 更新（不再停摆），scoped 绿 + 消费者不红（真实输出）。（待外部——scoped 绿 + 消费者不红已由本 impl 验证；真实 detached-suite fan-in 落账由 AC78 fan-in 步骤执行后确认）

## Touches

- tasks/gap-measure-history-detached-suite-mirror-write.md（自身）
- plugin/scripts/mirror-measure-history.ts（新增：fan-in detached-suite 的 measure-history.jsonl mirror-write 薄写入器，照抄 mirror-full-suite-state.ts；reuse landMeasureHistory = full-suite-runner 同一写入函数，格式一致）
- plugin/workflows/fan-in-execute.js（step 4.5 增 mirror-history-block；双拷贝同步 .claude/workflows/fan-in-execute.js）
- .claude/workflows/fan-in-execute.js（双拷贝，byte-identical）
- plugin/scripts/measure-trend-check.ts（消费者：landMeasureHistory 现为 mirror-measure-history.ts 的共享 writer，数据格式与 runner 直写一致——加 shared-writer 契约注释，消费侧零改动）
- plugin/scripts/select-static-checks-for-touches.ts（FAN_IN_ORCHESTRATION_FILES 增补 mirror-measure-history.ts）
- plugin/scripts/capability-catalog.sh（新脚本六表登记）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY snapshot --write-inventory 再生成）
- plugin/test/mirror-measure-history.test.mjs（新增：writer 形状 + 共享 checkout 解析 + fail-closed + benign no-op）
- plugin/test/fan-in-execute-paths.test.mjs（⑦c mirror-history-block wiring + REAL 写 + REAL no-op）

## Evidence

- scoped：`bash scripts/test.sh --for-task gap-measure-history-detached-suite-mirror-write --allow-thin`（待跑）。
- 单元测试：`node --test plugin/test/mirror-measure-history.test.mjs` → 7/7 pass（AC1/AC3 writer 形状、monotonic round、duplicate-log no-op、no-perfile-lines no-op、fail-closed 3 例、共享 checkout 解析、非 git root fail-closed）。
- 消费者（AC3）：`node --test plugin/test/measure-trend-check.test.mjs` → 14/14 pass（mirror-write 走 landMeasureHistory = runner 同一函数，格式一致）。
- fan-in wiring + REAL：`node --test plugin/test/fan-in-execute-paths.test.mjs` → 77/77 pass（⑦c wiring 断言 block 在 full_suite_ran=true 闸内 + 传 $suite_log_file；⑦c REAL mirror 用真实 capture+真实 suite log 写出 measure-history.jsonl 一轮 3 条、key 归一化 repo-root-relative；⑦c REAL no-op 无 __PERFILE__ 行不伪造；pre-verified 无 suite_log_file ⇒ WARN+skip 不挡）。
- capability-catalog：`bash plugin/scripts/capability-catalog.sh --json` → exit 0（unclassified==0，六表登记）。
- delivery-inventory：`verify-delivery-surface.ts --inventory --write-inventory` → inventory_drift=0。
