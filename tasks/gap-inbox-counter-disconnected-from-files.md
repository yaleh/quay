---
id: gap-inbox-counter-disconnected-from-files
title: supervisor-bus inbox-summary 计数器与实际投递文件脱节——目录 6 封 archguard 报告但 counter 说
  delivered=0 unread=0；「看不到+沉默失败」叠加，A5 判据须改列目录本身不依赖 counter
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`supervisor-bus-identity.sh inbox-summary` 的 delivered/consumed/unread 计数器与实际投递文件脱节——`.quay/manager-inbox/` 有 6 个 archguard 报告（最新 2026-08-06），但 `inbox-summary` 输出 `delivered=0 consumed=0 unread=0`。这是「看不到 + 沉默失败」叠加的最坏情况：计数器说 0，只有 `ls` 目录才看得见 6。manager 2026-08-09 实测——它自己 3 天没读过收件箱（执行核 inbox 命中 0），且即使照抄 A5 也会被计数器骗「无未读」。**

### 实证（manager 2026-08-09 实测 + outer 复核）

- **目录有 6 个文件**：`.quay/manager-inbox/archguard-20260805-*.md` ×3、`archguard-20260806-*.md` ×3（最新 2026-08-06 13:26）。
- **计数器说 0**：`bash plugin/scripts/supervisor-bus-identity.sh inbox-summary` → `delivered=0 consumed=0 unread=0`。
- **脱节**：delivered/consumed/unread 计数与实际投递文件无关——有文件但计数 0。
- **manager 的教训**：执行核 inbox 命中 0 条（没读过收件箱 3 天）；即使照抄 outer 的 A5 判据「unread 逐条进决策」也会被 0 计数器骗。

**为什么重要**：这是「看不到 + 沉默失败」两种最坏情况叠加——计数器说 0 让上层以为无未读（沉默失败），实际有 6 封 3 天没人处理（看不到）。「语义必须、机械仅辅助」的最强证据：计数器说 0，只有 `ls` 目录才看得见 6。**A5 的判据必须改成【列目录本身】，不得依赖任何 unread 计数器。**

**修的方向（实现归内层）**：
- 候选 A：**修 counter**——delivered/consumed/unread 从实际投递文件推导（数 .quay/manager-inbox/ 文件数），不脱离文件。
- 候选 B：**A5 改列目录**——`ls .quay/manager-inbox/` 直接看文件（不依赖 counter）；判据「目录非空 ⇒ 逐条处理」。
- 候选 C：**delivered≠consumed 语义**——delivered=写进目录，consumed=上层读过并回执；无回执机制则 delivered>0 即报（不吞）。

**验证锚**：修后，(a) `inbox-summary` 报 delivered=6（或目录非空可见）；(b) 上层能「看到」6 封未处理报告（不再被 0 骗）；(c) 处理后有 consumed 痕迹（回执）。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录实证（目录 6 文件 + counter 0 + manager 3 天没读 + 即使照抄也被骗）（本任务 Proposal 已含；内层补：ls 目录 + inbox-summary 复现）
- [x] AC2: **counter 与实际文件一致**——`inbox-summary` 报 delivered=6（数文件，不脱离）（候选 A）
- [x] AC3: **上层可看到未读**——A5/执行核判据改列目录本身（`ls .quay/manager-inbox/`），不依赖 unread 计数器（候选 B）
- [x] AC4: **处理留痕**——处理后有 consumed/回执痕迹（delivered≠consumed 语义明确）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 supervisor-bus 契约检查）

## Definition of Done

- [x] AC1–AC4 全部勾上（AC5 scoped 门见下）
- [x] 修后实跑：ls 目录 6 文件 + inbox-summary 报 6；上层看到未读（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

**根因**：`supervisor-bus-identity.sh inbox_summary()` 用 `.endsWith(".json")` 过滤 + 非 JSON 文件 `continue` 跳过——archguard 报告是 `.md`（`.quay/manager-inbox/archguard-*.md` ×6），双重排除 ⇒ delivered=0。修复前 `bash plugin/scripts/supervisor-bus-identity.sh inbox-summary` → `delivered=0 consumed=0 unread=0`，而 `ls .quay/manager-inbox/ | wc -l` = 6。

**AC1 复现**：上两行对照（counter 0 vs 目录 6 文件）。

**AC2 修**：`inbox_summary()` 改为数**所有**投递文件（`.consumed` sidecar 除外——那是消费痕迹不是消息），JSON 记录用 `consumed` 字段、非 JSON（`.md`）文件用 `<f>.consumed` sidecar 判消费（无则 delivered-but-unread，不吞）。修复后实跑：
```text
$ bash plugin/scripts/supervisor-bus-identity.sh inbox-summary
delivered=6 consumed=0 unread=6
unread: file=archguard-20260805-163300Z.md
unread: file=archguard-20260805-174700Z.md
unread: file=archguard-20260805-211100Z.md
unread: file=archguard-20260806-011545Z.md
unread: file=archguard-20260806-033256Z.md
unread: file=archguard-20260806-101500Z.md
```

**AC3**：外层/manager 已在 `orchestration/orchestrator-tick-core.md` A5 行改列目录判据（`ls .quay/manager-inbox/`，不依赖 unread 计数器）——manager 未提交编辑，已在主检出工作树；与 supervisor-bus 修共同构成「上层可看到未读」。

**AC4**：`<f>.consumed` sidecar = 消费痕迹（`unread: file=<f>` 消失、consumed 计数 +1）。新增测试覆盖：`.md` 计 delivered、sidecar 计 consumed、混合 json+md 各一行 unread。

**新增测试**：`plugin/test/supervisor-bus-identity.test.mjs` +3（AC2 md 计 delivered / AC4 sidecar consumed / 混合两标识），全文件 9/9 pass。

**AC5 invoke（2026-08-10 inner 复核）**：`./scripts/test.sh --for-task gap-inbox-counter-disconnected-from-files --allow-thin` → exit 0。supervisor-bus-identity 测试 9/9 pass（fail 0, cancelled 0）：Contract claim-human-test ×2、AC4 inbox-summary ×3、AC2 `.md` 计 delivered、AC4 sidecar consumed、AC2 混合 json+md、usage fail-loud。scoped 静态检查全 PASS：task-contract-check（strict-subset 本任务文件无 violation）、adr016-screen-use-check、superseded-capability-check、dead-code-after-return-check、strategic-doc-staleness-check、state-worded-clause-check、instrument-failure-check。复跑 invoke 证据：`ls .quay/manager-inbox/` = 6 文件，`bash plugin/scripts/supervisor-bus-identity.sh inbox-summary` → `delivered=6 consumed=0 unread=6`。

## Touches

- plugin/scripts/supervisor-bus-identity.sh（候选 A：delivered/consumed 从实际文件推导）
- orchestration/orchestrator-tick-core.md（候选 B：A5 判据改列目录——外层已改）
- orchestration/manager-loop-tick.md（候选 B：manager A15 同改）
- tasks/gap-inbox-counter-disconnected-from-files.md（自身：勾 AC + 贴证据）

## Contract

measure   inbox_delivered_count = `bash plugin/scripts/supervisor-bus-identity.sh inbox-summary` 的 delivered 值
band      inbox_delivered_count = ≥ 实际文件数（.quay/manager-inbox/ 的 ls 数——有文件即报）
invariant inbox_visible_to_upper = 1（列目录判据——上层能看到未读，不被 counter 骗）
invariant consumed_leaves_trace = 1（处理后有回执）
invoke    `bash plugin/scripts/supervisor-bus-identity.sh inbox-summary` + `ls .quay/manager-inbox/`（贴回）
control   6 文件 ⇒ delivered 6；上层可见；处理留痕
resume    counter 修 + A5 列目录分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 实测：inbox counter 说 0 但目录 6 文件——delivered/consumed 与实际脱节，「看不到+沉默失败」叠加；A5 判据须改列目录本身不依赖 counter。实现归内层）
