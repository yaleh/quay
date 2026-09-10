---
id: gap-retire-resident-suite-driver-kind
title: 按人 2026-09-07 A 裁定退役常驻 suite driver kind：DRIVER_KINDS 移除 + 删
  request/result 循环 + 保留 spawnSuiteAndWait + 订正 SPEC §3
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**人 2026-09-07 裁定（逐字）**：「A 退役常驻 suite kind（从 DRIVER_KINDS 移除 + 删 request/result 死循环，保留 spawnSuiteAndWait 共享函数，并修正 SPEC §3『唯一 spawn』表述）」。裁定来源任务 `gap-meta-call-resident-suite-driver-kind-spawn-per-tas`（meta-human-call）。

**问题**：两个正本对「谁 spawn per-task suite」互相矛盾——`orchestration/SPEC-suite-lifecycle-and-failure-semantics-2026-08-26.md` 称常驻 `suite` driver kind 是【唯一】spawn 处，而 08-27 落地的机械 fan-in 由 `worker-driver.ts:202` 进程内 `import { spawnSuiteAndWait } from "./suite-driver.ts"` 直接 spawn。

**实测（manager 2026-09-07 复核，直接量非自述）**：`plugin/scripts/start-drivers.ts:33` 的 `DRIVER_KINDS = ["promotion","worker","goal"]` **不含 suite**；`.quay/suite-requests` / `.quay/suite-results` 目录**根本不存在**（无 writer 无 reader）；`drivers.suite.running=false`、carrierRecords=0、无 supervisor。⇒ 常驻形态**从未在生产启动过**，而与它矛盾的那条路径是生产每轮都在跑的。

**边界**：本任务**只做退役与表述订正**，⛔ 不改 `spawnSuiteAndWait` 的行为（它是机械 fan-in 每轮依赖的共享函数，改它等于改在飞 suite 语义）。

## Plan

1. 从 `plugin/scripts/driver-runtime.ts:58-68` 的 `DRIVER_KINDS` 注册表移除 `suite` 条目（含 `controlFile: "suite-control.json"` / `carriers: ["suite-round.jsonl"]` 声明），并核 `KNOWN_KINDS` 派生值随之收敛。
2. 删 `plugin/scripts/suite-driver.ts` 的 request/result 常驻循环面：`runResidentSuiteLoop`（`:390`）、`parseSuiteRequest`（`:281`）、`writeSuiteResult`（`:303`）、`isSuiteRequestPending`（`:353`）、`listPendingSuiteRequests`（`:360`）及 `main`（`:477`）里进入常驻模式的 argv 分支。**保留** `spawnSuiteAndWait`（`:149`）、`slotHolderArgv`、`logMtimeMs`、`killTree`、`appendSuiteRound`、`computeSuiteRound` —— 逐个核实保留项的现有 import 者后再删，⛔ 不按名字猜。
3. `plugin/test/suite-driver.test.mjs` 删对应常驻循环的用例；`worker-driver*.test.mjs` / `fan-in-driver-mechanical-orchestration.test.mjs` 若引用被删导出则同步改。
4. 订正 SPEC §3「它是【唯一】spawn per-task suite 的地方」——改为如实记述：**per-task suite 由 worker-driver 在机械 fan-in 中进程内 `spawnSuiteAndWait` 直接 spawn 并 wait**，并在该处标注常驻 kind 已按人 2026-09-07 裁定退役（⛔ 不静默删掉旧句，落败的一方要就地更正/标注）。
5. `capability-catalog.sh` 的 `suite-driver.ts` 六表条目（`:158` QUESTION / `:693` / `:1019` / `:1345` / `:1671` / `:1825`）改写为「共享 spawn+wait 函数库」而非「常驻 driver kind」；因改了 laydown 源，须 `quay-init-closure-ratchet.ts --reanchor`。
6. 关掉来源任务：`gap-meta-call-resident-suite-driver-kind-spawn-per-tas` 的 DoD（裁定记录在正本 + 落败一方已更正）由本任务落地满足。

## AC

- [x] `suite` kind 已不在注册表：`grep -c '^\s*suite:' plugin/scripts/driver-runtime.ts` == 0，且 `node --experimental-strip-types -e 'import("./plugin/scripts/driver-runtime.ts").then(m=>{if(m.KNOWN_KINDS.includes("suite"))process.exit(1)})'` exit 0
- [x] 常驻循环已删：`grep -c 'runResidentSuiteLoop\|listPendingSuiteRequests\|parseSuiteRequest' plugin/scripts/suite-driver.ts` == 0
- [x] 共享函数仍在且仍被生产消费：`grep -c 'export async function spawnSuiteAndWait' plugin/scripts/suite-driver.ts` == 1 且 `grep -c 'spawnSuiteAndWait' plugin/scripts/worker-driver.ts` ≥ 1
- [x] SPEC 已订正：`orchestration/SPEC-suite-lifecycle-and-failure-semantics-2026-08-26.md` 中不再有「【唯一】spawn per-task suite 的地方」指向常驻 kind 的表述，且该处**显式标注**了 2026-09-07 退役裁定（⛔ 不是删掉了事）
- [x] `bash plugin/scripts/capability-catalog.sh --summary` unclassified == 0，且 suite-driver.ts 的 QUESTION 不再自称唯一 spawn 处
- [x] 全量 `scripts/test.sh` exit 0
- [x] `node plugin/scripts/task-schema-check.ts tasks/gap-retire-resident-suite-driver-kind.md` exit 0

## DoD

人 2026-09-07 的 A 裁定在代码与正本上同时落地：注册表无 suite kind、request/result 循环已删、`spawnSuiteAndWait` 未被改动且仍被 worker-driver 消费、SPEC §3 表述与生产实际一致。⛔ 只改 SPEC 不删代码、或删了 `spawnSuiteAndWait` 导致机械 fan-in 断、或删旧句而不标注退役 ⇒ 不算达成。

## Touches

- plugin/scripts/driver-runtime.ts（DRIVER_KINDS 移除 suite 条目）
- plugin/scripts/suite-driver.ts（删 request/result 常驻循环，保留 spawnSuiteAndWait）
- plugin/test/suite-driver.test.mjs（删常驻循环用例）
- plugin/test/driver-runtime.test.mjs（KNOWN_KINDS 断言移除 suite）
- plugin/test/goal-driver.test.mjs（KINDS 断言移除 suite）
- packages/quay/src/cli/driver.ts（KINDS 白名单移除 suite）
- plugin/test/plugin-packaging.test.mjs（M179 .claude/skills 空目录断言改 hermetic——unblock 既有 suite 红）
- orchestration/SPEC-suite-lifecycle-and-failure-semantics-2026-08-26.md（§3 唯一 spawn 表述订正 + 退役标注）
- plugin/scripts/capability-catalog.sh（suite-driver.ts 六表条目改写）
- docs/analysis/quay-init-closure-ratchet.baseline.json（laydown 源变更后 --reanchor）
- tasks/gap-retire-resident-suite-driver-kind.md（自身）
