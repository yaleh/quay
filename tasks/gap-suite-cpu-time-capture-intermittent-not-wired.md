---
id: gap-suite-cpu-time-capture-intermittent-not-wired
title: suite 入账 cpu_time_s 捕获间歇有洞——fullSuiteRan=true 8 条缺 cpu_time_s（not-wired×5+None×3，今日 1 条），判据「==0」被违反
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

**来源**：manager 2026-08-21 报（已独立核实，见证据）+ `orchestration/manager-tick-criteria.md:508` 阶段判据「套件入账」：`fullSuiteRan == true` 的记录里 `cpu_time_s 缺失 / null / ≤ 0` 的条数 **== 0**。

**证据（能取假，manager 报后我重验一致）**：`.quay/per-task-suite-records.jsonl` 中 `fullSuiteRan=true` 共 204 条，`cpu_time_s` 缺失/null/≤0 = **8 条**：
- `cpu_source=not-wired` × 5：gap-ac76-tick-core-retirement-cleanup（08-16）、gap-touches-multipath-delimiter-coverage-gap（08-16）、gap-select-preflight-retirement-decision（08-16）、gap-ac95-webui-15-views（08-17）、**gap-suite-wait-bash-stale-pid-poll（2026-08-21T11:08:17Z，今日）**
- `cpu_source=None` × 3：gap-release-timeout-10min-cancels-npm-tgz（08-16）、gap-fan-in-delta-scope-doc-only-skip（08-17）、gap-ac95-webui-15-views（08-17）

**⊢ 捕获链今天仍有洞（非纯历史）**：`gap-suite-wait-bash-stale-pid-poll` 同一 runId 三条记录——10:18Z `cpu_source=gnu-time`（cpu_time_s=9124.21 真数）、**11:08Z `not-wired`（null）**、11:27Z `gnu-time`（8316.5 真数）。⇒ GNU time 捕获**间歇未接线**，同一任务三次跑两次有、一次无。

**两种形状疑两个断点**：①`not-wired`（writer 显式写「捕获未接线」——fan-in step 4 捕获块的 GNU time 包装间歇没生效）；②`None`（cpu_source 字段整体缺失——旧记录或另一条写路径）。修 ① 为主（今日仍有洞），② 追因后一并清。

**为什么 inner 执行**：writer `plugin/scripts/per-task-suite-record.ts` + fan-in step 4 捕获块（GNU time `%U %S`）属产品代码/fan-in 协议 → inner 域。

## Plan

1. 追因 `not-wired`：fan-in step 4 捕获块为何间歇不接 GNU time 包装（同一任务三跑两绿一空），定位断点。
2. 追因 `None`：cpu_source 字段缺失的写路径（旧 writer 版本 or 另一路径），定位断点。
3. 修两处，使 `fullSuiteRan=true` 必带真数 `cpu_time_s`（GNU time 捕获，fail-closed 记录原因而非静默 null）。
4. 用同一谓词重扫 `.quay/per-task-suite-records.jsonl`，确认「fullSuiteRan=true 且 cpu_time_s 缺失/null/≤0」== 0。
5. fan-in（AC78 workflow）land。

**实现（2026-08-21，追因+修，落 `plugin/scripts/per-task-suite-record.ts`）**：
- **`not-wired` 断点**：SUITE_LAUNCH 的 GNU time `-o "$time_file"` 在 suite【开始】时把 time 文件 truncate 成 0 字节、只在 suite【结束】时（wait4 之后）写 `%U %S` 报告。任何中断——kill-on-red 把整个 session/进程组 SIGKILL（`gap-ac76` 等 RED 记录的 0 字节 `.time` 实测）、或 relaunch 的 `rm -f "$suite_time_file"` 落在 end-write 之前——都留下 0 字节/缺失的 time 文件；parse 块把它静默降级成 `cpu_s=null + cpu_source=not-wired`，writer 原样落盘。⇒「跑了全量却记 null」与「仪器未接线」同形（硬规则 3b/4），判据「==0」被违反。
- **`None` 断点**：3 条 `cpu_source` 字段整体缺失的记录是 **08-14 18:39（`57825d11`）之前 / 旧 writer 路径**——fan-in 调用 writer 时未传 `--cpu-time-s`/`--cpu-source`，writer 按「pre-wiring legacy shape」合法省略该字段。
- **修**：writer `buildRecord` 新增镜像 fail-closed——`fullSuiteRan===true` 必须带真数 `cpu_time_s`（GNU time User+System）；null/缺失/≤0 ⇒ exit 2 拒写（错误信息记录原因，绝不静默 null）。**一条规则同时拒掉 `not-wired`（null）与 `None`（字段缺失）两形状**。skip 路径（`fullSuiteRan===false`）的 `0→null + not-wired` 正确形态不受影响。

## Acceptance Criteria

- [x] AC1: 追因并修 `not-wired` 断点（fan-in 捕获块间歇未接 GNU time），今日 11:08Z 这类记录不再出现。
- [x] AC2: 追因并修 `None` 断点（cpu_source 字段缺失的写路径）。
- [ ] AC3: 用同一谓词重扫，「fullSuiteRan=true 且 cpu_time_s 缺失/null/≤0」条数 == 0（含两类形状）。

## Definition of Done

- [ ] 两断点追因并修复、判据「==0」重扫通过；AC1-3 全勾；fan-in land 到 develop。

## Touches

- plugin/scripts/per-task-suite-record.ts（writer——fullSuiteRan=true 必带真数 cpu_time_s 的 fail-closed 规则）
- plugin/test/per-task-suite-record-check.test.mjs（writer buildRecord 的 fail-closed 测试——not-wired/None 两形状拒写）
- tasks/gap-suite-cpu-time-capture-intermittent-not-wired.md（自身）
