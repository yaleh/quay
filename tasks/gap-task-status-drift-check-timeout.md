---
id: gap-task-status-drift-check-timeout
title: task-status-drift-check.ts 超时 8s fail-open 排查
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
> **RESOLVED 2026-08-24：按 Finding 修法落地——内层循环补 visited 上限 + `.quay` 进排除名单，实测 `--json` 对主检出（`.quay/node-compile-cache` 38 万文件）3.3s（<8s），AC1-2 全勾。**

**type:** execution

## Proposal

**来源**：manager web 巡检投立案（代码级核实）。

**证据**：Board 页顶部自曝 `落地: task-status-drift-check.ts · 读取超时 — 超过 8000ms 未完成 (fail-open)`，导致全部 1387 行「落地」列恒 "—"。页面诚实报了故障（硬规则 3b 正确做法，没假装 "—" 是「未落地」），但故障本身没人跟进。

## Plan

1. 排查 `task-status-drift-check.ts` 为何稳定超 8s（数据量增长到 1387 条后线性扫描变慢？还是别的原因）。
2. 修复到 <8s（或优化算法/加缓存）。

## Acceptance Criteria

- [x] AC1：`task-status-drift-check.ts` 在 1387 条任务下执行 <8s（⛔ 稳定超时 fail-open ⇒ 假）。
- [x] AC2：Board 页「落地」列显示真实判断结果（⛔ 恒 "—" ⇒ 假）。

## Definition of Done

- [x] 超时根因定位 + 修复到 <8s + 落地列显示真实结果；AC1-2 全勾；land 到 develop。

## Retires

- 无（性能修复）

## Touches

- plugin/scripts/task-status-drift-check.ts（超时根因）
- experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts（byte-identical mirror，AC1 测试强制，同步改）
- plugin/test/task-status-drift-check.test.mjs（性能测试）
- tasks/gap-task-status-drift-check-timeout.md（自身）

## Finding（wiring 审计 2026-08-23，AC1 现场证伪）

**独立复现**：`time node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --json` = 76s（AC1 目标 <8s）；`find .quay/node-compile-cache -type f | wc -l` = 384,812（3.7G）。

**根因（manager 读 `listRepoFiles` :234-253 确认）**：`while (stack.length>0 && visited<20000)` 硬顶检查**只在外层弹栈时判断**；内层 `for (const ent of entries)` 处理单次 `readdirSync()` 返回的全部条目时**不再查 visited**——`.quay/node-compile-cache` 不在排除名单（node_modules/dist/vendor/milestones/.git/worktrees），一次 readdirSync 吐出 38 万条目、硬顶被整段跳过。`scripts/test.sh` 长期设 `NODE_COMPILE_CACHE` 落这个目录，是持久产物非环境噪音。Board 页 `/board` 现仍「读取超时」。

**修法**：内层循环也判 visited 上限 + 把 `.quay`（或至少 `node-compile-cache`）加进排除名单。

**落地（2026-08-24）**：`listRepoFiles` 排除名单加 `.quay`，内层 `for (const ent of entries)` 每项先判 `if (visited >= 20000) break`，并 `export` 供测试（双 mirror 同步，byte-identical 由测试 AC1 强制）。实测【主检出】跑 fix 后脚本 `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --json` = **3.3s**（exit 0，`scanned: 1425`，suspects 1 / reverse 7 / closedWithoutWork 62 / stranded 7）——主检出 `.quay/node-compile-cache` 仍是 38 万文件，排除后不再遍历 ⇒ AC1 <8s 达成；fix 前后 `--json` 报告逐字 diff 仅 stranded 段本任务 worktree 自身状态一项不同（uncommitted 编辑），其余判断零变化 ⇒ 判定保持。Board 页「落地」列不再超过 `LANDING_TIMEOUT_MS=8000ms` fail-open ⇒ 显示真实判断结果（AC2）。性能测试 `plugin/test/task-status-drift-check.test.mjs`：`.quay` 排除 + 内层 cap 两针。
