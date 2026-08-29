---
id: gap-b0-retirement-precondition-checker-call-surface
title: B0·退役前置检查——枚举 outer 执行核引用的全部 checker，逐个确认留存调用面或显式退役（防孤儿静默产生，唯一有时限批次）
status: done
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

outer 将随 inner 退役、cron/loop 换外部触发的短会话 ⇒ 会从下面抽走一部分 checker 的调用面。SPEC（`orchestration/SPEC-methodology-layer-architecture-2026-08-25.md` §2.3b）实测归属：109 个 checker 里 static-gate 注册表 45、outer 执行核 12、manager 6、driver 4、workflows 6、其它载体 54、只剩 .md 提及 6 + 零引用 1（真死代码仅 7）。**outer 引用的 12 个逐个核实后：7 个同时在注册表（安全）、4 个有留存调用面（test-framework-policy/drive-contract/monitor-mount/drive-target）、只有 1 个真正绑死退役层——`outer-anchor-check.ts`（仅 outer-cron-registry.ts 引用，同属退役层）。**

⇒ 风险面比预期小（仅 1 个需处置），**但必须写成退役的【前置检查】而非事后清理**：没有这个前置，孤儿是静默产生的。判据形如「退役 outer 前，枚举其执行核引用的全部 checker，逐个确认存在留存调用面或显式退役」。

## Plan

写一个退役前置检查器（或脚本，放 `plugin/scripts/outer-retirement-precondition-check.ts` + 测试 `plugin/test/outer-retirement-precondition-check.test.mjs`）：读 `orchestration/orchestrator-tick-core.md` 的执行核，枚举其引用的全部 checker/脚本；对每个，判定其是否在 static-gate 注册表或有其它留存调用面；只被退役层引用的 ⇒ 报「缺留存调用面」。当前唯一命中 = `outer-anchor-check.ts`，处置它（随 outer-cron-registry 一起退役，或迁移调用面）。⛔ manager 侧 6 个 checker 的迁移不在本任务（manager 退役形态未定，§3.7）。新建文件按上述命名落地，不另取名。

## Acceptance Criteria

- [x] AC1（能取假，前置检查存在）：存在一个退役前置检查器，枚举 outer 执行核引用的全部 checker 并逐个判定留存调用面（grep 到该检查器的调用/注册）；（⛔ 无前置检查 ⇒ 假）。
- [x] AC2（能取假，负控制）：造一个只被退役层引用的 checker，前置检查必须红（fail-closed）；（⛔ 不红 ⇒ 假）。
- [x] AC3（能取假，留存调用面清零）：无留存调用面的 checker 数 N→0（当前 N=1：`outer-anchor-check.ts`）——该文件或随退役层显式退役、或迁移调用面；（⛔ 仍有 N>0 ⇒ 假）。

## Evidence

- **AC1（能取假，前置检查存在）**：`plugin/scripts/outer-retirement-precondition-check.ts` 落地，注册进
  `runner-static-gate.ts`（`run_checker "outer-retirement-precondition-check"`，`@static-tier full`）。
  实测（真仓）枚举出执行核引用的 37 个脚本、其中 12 个 `-check.{ts,sh}` checker，逐个判定留存调用面
  （static-gate 注册表 + 外部代码位置引用 + 传递闭包）。`grep -rn "outer-retirement-precondition-check"
  plugin/scripts/runner-static-gate.ts plugin/scripts/capability-catalog.sh` 可命中调用/注册。
- **AC2（能取假，负控制）**：`plugin/test/outer-retirement-precondition-check.test.mjs` 负控制
  「AC2 — a checker referenced ONLY by the retiring layer (no marker) ⇒ RED (exit 1)」钉住：造一个只被
  退役层引用的 `orphan-check.ts`（无注册表、无外部载体、无标记）⇒ 前置 exit 1（RED）。另有
  `plugin/scripts/checker-mutation-cases/outer-retirement-precondition-check.sh`（剥 RETIRED 标记 ⇒ 必红）。
  全 15 条单测绿（`node --test plugin/test/outer-retirement-precondition-check.test.mjs` pass 15/15）。
- **AC3（能取假，留存调用面清零）**：真仓实测 `undischarged=[]`（N=0）；`orphanCheckers=["outer-anchor-check.ts"]`
  带 `RETIRED-WITH-RETIRING-LAYER` 标记（`retiredWithMarker=["outer-anchor-check.ts"]`），`outer-cron-registry.ts`
  一并标同标记随退役层退役。处置前（剥标记）实测 `undischarged=["outer-anchor-check.ts"]`（N=1，RED）——
  判据能取假。命令：
  `node --no-warnings --experimental-strip-types plugin/scripts/outer-retirement-precondition-check.ts --json`
  → `{"ok":true,"evaluated":true,"executionCore":"orchestration/orchestrator-tick-core.md","referencedCount":37,"checkerCount":12,"surviving":[…32 项…],"orphanCheckers":["outer-anchor-check.ts"],"retiredWithMarker":["outer-anchor-check.ts"],"undischarged":[],"orphanNonCheckers":["a15-ruling5-counter.ts","outer-cron-registry.ts","red-window-triage.ts","suite-execution-form-counter.ts"]}`。

## Definition of Done

退役前置检查器落地 + 注册；AC1/AC2/AC3 全勾；`outer-anchor-check.ts` 处置（显式退役或迁移）；前置检查在 outer 退役时作为必须步骤。

## Touches

- plugin/scripts/outer-retirement-precondition-check.ts (new)（退役前置检查器，读 tick-core 枚举 + 判定留存调用面）
- plugin/test/outer-retirement-precondition-check.test.mjs (new)（负控制：只被退役层引用的 checker 必红）
- plugin/scripts/checker-mutation-cases/outer-retirement-precondition-check.sh (new)（mutation case：剥 RETIRED 标记必红）
- plugin/scripts/runner-static-gate.ts（注册 `run_checker "outer-retirement-precondition-check"` @static-tier full）
- plugin/scripts/capability-catalog.sh（六表声明：question/cadence/invalidation/last-reaffirmed/matching/consumer）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照 scripts +1；§9 变更记录）
- orchestration/orchestrator-tick-core.md（退役/迁出条款纪律 ⑤：退役外层本身前必跑前置）
- plugin/loop/orchestrator-tick-core.md（同上 ⑤——双副本字节一致，drift gate）
- orchestration/SPEC-methodology-layer-architecture-2026-08-25.md（§2.3b 处置记录 + 落地注记）
- plugin/scripts/outer-anchor-check.ts（RETIRED-WITH-RETIRING-LAYER 标记，显式退役）
- plugin/scripts/outer-cron-registry.ts（随 outer-anchor-check 一起处置）
- tasks/gap-b0-retirement-precondition-checker-call-surface.md（自身）

## Needs-Human

**执行 2026-08-28T16:31:55.640Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
