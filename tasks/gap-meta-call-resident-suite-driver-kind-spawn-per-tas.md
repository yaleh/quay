---
id: gap-meta-call-resident-suite-driver-kind-spawn-per-tas
title: resident `suite` driver kind 从未启动却仍注册——两个正本对「谁 spawn per-task suite」互相矛盾
status: done
labels:
  - meta-human-call
  - meta-driver
parent: null
children: []
extra: {}
depends_on:
  - gap-retire-resident-suite-driver-kind
---
## Finding
per-task suite 的 spawn 架构以哪个正本为准：SPEC-suite-lifecycle-2026-08-26 §3 的常驻 `suite` driver kind（request/result 模式，实测 carrierRecords=0、request/result 目录无写入者无读取者、start-drivers.ts 未收录它），还是 SPEC-fan-in-2026-08-27 机械 fan-in 的 worker-driver 进程内直接 spawn（复用 spawnSuiteAndWait）？

**要人裁决的是什么**：resident `suite` driver kind 从未启动却仍注册——两个正本对「谁 spawn per-task suite」互相矛盾
**选项与代价**：A 退役常驻 suite kind（从 DRIVER_KINDS 移除 + 删 request/result 死循环，保留 spawnSuiteAndWait 共享函数，并修正 SPEC §3『唯一 spawn』表述）——成本=一次性清理，若未来有路径想用 request/result 模式需从 SPEC §3 重建；B 接线常驻 kind（start-drivers.ts 加 suite + 迁移机械 fan-in 改写 suite-requests）——成本=重做 fan-in suite 步、与 08-27 已落地代码反向。
**为什么机器不能自决**：readings.drivers.suite: running=false、carrierRecords=0、无 carrier 文件、无 supervisor；start-drivers.ts DRIVER_KINDS 仅 promotion/worker/goal 不含 suite；worker-driver.ts:199 进程内 import spawnSuiteAndWait 直接 spawn；而 SPEC-suite-lifecycle-2026-08-26.md:131 称 suite kind 是【唯一】spawn 处——常驻形态从未在生产启动过，两个正本互相矛盾。
**若机器自行选错，什么难以撤销**：机器若自行选错方向会静默作废两份正本之一：选退役则 SPEC §3『唯一 spawn 处』架构被推翻、未来读者被误导；选接线则与 08-27 已落地代码反向且需重做 fan-in suite 步。哪份正本权威是人的裁定，机器不能擅自改写。
**实测依据**：`drivers.suite.running` = false（meta-driver 机械采集于 2026-09-07T18:50:50Z）

**互相矛盾的既有立场（逐字引用，已机械核对确实存在于对应文件）**：
- `orchestration/SPEC-suite-lifecycle-and-failure-semantics-2026-08-26.md`：「职责：它是【唯一】spawn per-task suite 的地方」
- `plugin/scripts/worker-driver.ts`：「suite 不再 detach（setsid+&+disown 孤儿）——改由 driver 直接 spawn 并 wait」

## AC（draft）
- [x] 人在上述选项中作出选择，并把选择写进本任务体（或以 DIR 记录该裁定）
- [x] 依该选择产生的后续工作已立案或已落地（⛔ 不以「已回答」本身充当完成）

## DoD（draft）
- [x] 裁定已记录在可被后续读到的正本里，⛔ 不只存在于本任务的对话中
- [x] 上面两条互相矛盾的立场中，落败的一方已被就地更正或标注，⛔ 不留着继续制造同一次冲突

## Touches
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/start-drivers.ts`
- `plugin/scripts/suite-driver.ts`
- `plugin/scripts/worker-driver.ts`
- `tasks/gap-meta-call-resident-suite-driver-kind-spawn-per-tas.md`

## Resolution

**人 2026-09-07 裁定（逐字）**：

> A 退役常驻 suite kind（从 DRIVER_KINDS 移除 + 删 request/result 死循环，保留 spawnSuiteAndWait 共享函数，并修正 SPEC §3『唯一 spawn』表述）

**落败的一方**：`orchestration/SPEC-suite-lifecycle-and-failure-semantics-2026-08-26.md` §3「它是【唯一】spawn per-task suite 的地方」——该表述与生产实际不符（常驻形态从未启动过），须**就地更正并标注退役**，⛔ 不静默删除。

**后续工作已立案**：`gap-retire-resident-suite-driver-kind`（本任务 `depends_on` 它）——执行 A 的四件事：注册表移除 / 删常驻循环 / 保留 spawnSuiteAndWait / 订正 SPEC §3 + capability-catalog 六表条目。

**裁定前 manager 的现场复核（直接量，2026-09-07）**：`start-drivers.ts:33` 的 `DRIVER_KINDS` 只有 promotion/worker/goal；`.quay/suite-requests` 与 `.quay/suite-results` 目录不存在（无 writer 无 reader）；`worker-driver.ts:202` 进程内 import `spawnSuiteAndWait`。三项一致支持 A。