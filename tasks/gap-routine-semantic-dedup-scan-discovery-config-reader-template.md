---
id: gap-routine-semantic-dedup-scan-discovery-config-reader-template
title: "semantic-dedup-scan: the three readers are one 1154-char template
  differing only in the loop key and parse callee, and each of the three
  routines carries about six more near-identi"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
the three readers are one 1154-char template differing only in the loop key and parse callee, and each of the three routines carries about six more near-identical scaffold functions while their run cores genuinely differ

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793943196283` · ts `2026-11-06T05:33:16.283Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readArchDiscoveryConfig`、`readDiscoveryMethodConfig`、`readOpenSemanticDiscoveryConfig`
- 涉及文件：
- `plugin/scripts/arch-discovery-routine.ts:320`
- `plugin/scripts/discovery-method-routine.ts:490`
- `plugin/scripts/open-semantic-discovery-routine.ts:851`
- kind：`other`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-06T05:33:16.283Z

## Plan
1. 复核范围（硬规则 5b：修之前先在同一载体里 grep 同一原则的其它适用点，不是只修被报出来的那三个）：
   `plugin/scripts/` 里同形信封（读 `.quay/config.yml` → `loop:` → 取段 → 交 parser → 返回
   `{present, config, error}`）共 **12 个** `read*Config(workspaceRoot)`，跨 8 个文件：
   `arch_discovery` / `discovery_method` / `open_semantic_discovery` / `resource_diagnostic` /
   `design_evolution_readings` / `touches_relax` / `cross_project_dogfood`，以及 `quality-gate-driver.ts`
   里的 `architecture_review` / `arch_coverage_report` / `arch_cycle_report` / `adr_enforcement_report` /
   `instrument_decay`。
2. 抽出 `plugin/scripts/loop-section-config.ts`：`readLoopSectionRaw`（I/O）→ `readLoopSectionConfig`
   （与一个 parser 的 join）。三态契约（缺席 / fail-closed / 已声明）只在那一处判定。
3. 12 个读取器改为委派，各自只保留**本调用点自己的**两件事：loop key 与 parser。
4. `plugin/test/loop-section-config.test.mjs`：信封契约 + **复发守卫**（全族在「配置文件存在但读不出来」
   这**同一臂**上必须给出同一读数）+ **位置判据**（信封指纹的文件集合被枚举，多一份拷贝即红）。
5. negative control：把信封复制回 `arch-discovery-routine.ts` ⇒ 三条守卫同时变红（已实测，已 revert）。

## Result（处置结论）
判定：**真重复，已修掉**（不是「已有机制在管、失败在某一步」，也不是「已注意到」）。

- 修前：`'loop:' must be a mapping` 这个信封指纹出现在 develop 的 **8 个文件**里；信封体共 **12 份**。
- 修后：信封只在 `plugin/scripts/loop-section-config.ts` **一处**。残留的 `probe-routine.ts`
  是**抛错契约**变体（fail-closed throw，不返回三态），契约不同故未迁，但它已被枚举进位置判据的
  期望集合里 —— 再加一份拷贝仍会红。
- 行为变化（只有一处，且是硬规则 3b 的方向）：配置文件**存在但读不出来**（EACCES / EISDIR …）
  原本在 6 份拷贝里读成 `present:false`（＝「没人声明这一段」），另 4 份直接抛未捕获 errno；
  现在统一为 `present:true` + `error`。ENOENT 仍然是 `present:false`（默认关闭是合法答案）。
- `loop-section-config.ts` 进了 quay-init 的显式 laydown 清单 —— 它是已铺开的
  `design-evolution-readings.ts` 的 ESM `./` 依赖（`${SCRIPT_DIR}/` 闭包看不见 ESM import）。
- 效果预测 `concept_recurs_after_merge: false` 的承载：复发会被本任务的测试当场判红
  （position：指纹文件集合；family：读不出来那一臂的同形读数），而不是靠下次扫描再发现。

## 黑暗轴（ADR-007）
- L_D identity-replication-check: judgmentRewrites=1 byteIdenticalPairs=0 pathConstants=0
- L_D envelope-copies: before=12 files after=1 file
- L_G 该轴仍暗,理由:archguard 索引未在本 worktree 建立（改动只新增 plugin/scripts 同目录 import，不新增跨包边）

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `discovery-config-reader-template`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793943196283`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/arch-discovery-routine.ts`
- `plugin/scripts/discovery-method-routine.ts`
- `plugin/scripts/open-semantic-discovery-routine.ts`
- `plugin/scripts/resource-anomaly-detector.ts`
- `plugin/scripts/design-evolution-readings.ts`
- `plugin/scripts/touches-relax-config.ts`
- `plugin/scripts/cross-project-dogfood-routine.ts`
- `plugin/scripts/quality-gate-driver.ts`
- `plugin/scripts/loop-section-config.ts`
- `plugin/test/loop-section-config.test.mjs`
- `packages/quay/src/init/provider-maintenance.ts`
- `tasks/gap-routine-semantic-dedup-scan-discovery-config-reader-template.md`

## Blocker

**2026-11-06T08:18:46.392Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (2) — recovery red set is NOT a subset of the develop baseline red set: added=plugin/test/archive-exclusion-wiring.test.mjs changed=- — needs a code fix
- run_id：wk-prod-anchor
- session_id：773208ce-65bb-4efb-83c0-f407058089c0
