---
id: gap-spec-p2-quad-tuple-unified-emitter
title: "SPEC P2-9: 四元组的统一发射器（三层共用一个实现）——当前三层各自的账本行手工拼、无共用发射器（SPEC-three-layer-unified-architecture §2.5）"
status: ready
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**三层统一架构 SPEC（`orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md`）P2-9：「四元组的统一发射器（三层共用一个实现）。」§2.5 定义的账本四元组——①声称机制最近真实执行时刻 ②占用率(in-flight/cap) ③本轮写入落到哪条线 ④本轮账本行——当前三层各自手工拼，无共用发射器。**

### 现状（outer 2026-08-09 核实）

- **§2.5 统一点**：四元组每层每轮吐出，同一格式。**硬判据**：每层每轮账本行含四元组、无缺值（AC3）；每层至少一条「最近真实执行时刻」A 项且已触发过判定（AC4）。
- **现有零散机制**：`manager-tick-log-check.sh`（tick 留行 + mtime 新鲜度）、`closure-lag-check.sh --record --flipped N`（零收尾写 0）、`verification-round.jsonl`（轮次记录）、`meta-cc query_session_content role=tool tool_name=<X>`（工具最近调用时刻）——**都是单独机制，没有统一发射器把它们合成四元组。**
- **三层现状**：outer / inner / manager 各自的 tick-log 行手工拼（manager-tick-core B2 四元组、orchestrator-tick-core B14、fast-mode-tick-core B2 必报），**格式不一致、无共用实现**。

**为什么重要**：四元组是 SPEC 的**核心交付物**（§2.5「本规格的核心,今天最缺的一项」）。若三层各自拼，格式漂移（同上次 manager/outer/inner 词汇不一），且「缺值 = 未执行」无法机械对账。统一发射器 = 三层同一格式、机械可核。

**修的方向（产品代码，归内层）**：
- 候选 A：**统一发射器脚本**——`plugin/scripts/accounting-emit.ts`（或 .sh）：输入四元组各字段（或自动采集：meta-cc 取执行时刻、cap-from-gate 取 cap、本层写入线、本行账本），输出统一格式行；三层 tick 各自调用，格式一致。
- 候选 B：**复用现有记账脚本**——`closure-lag-check.sh --record` 是「时间戳 + 翻转数」形状；扩为四元组发射器（加占用率/写入线/账本行），三层共用。
- 候选 C：**格式契约 + 校验**——先定四元组 JSON schema（`CONTRACT_SCHEMA_VERSION` 同族），三层发射器输出同 schema，`accounting-validate.ts` 机械核「无缺值」。

**验证锚**：修后，(a) 三层各自的 tick-log 行/账本行是同一格式（同一发射器产出）；(b) 任一四元组字段缺值 ⇒ 机械报出（无缺值硬判据）；(c) 每层「最近真实执行时刻」A 项可读（AC4）。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录现状（三层各自拼、零散机制清单、§2.5 四元组定义）（本任务 Proposal 已含）
- [x] AC2: **统一发射器**——三层共用一个实现产出四元组账本行，格式一致（三层各贴一次发射器输出对照）——`plugin/scripts/accounting-emit.ts` 落地，三层 tick 必报各接 `--layer`；字段集合三层逐一相同（对照见 Evidence）
- [x] AC3: **无缺值机械核**——任一字段缺值 ⇒ 机械报出（不靠自述）——`missing` 点名 + `complete:false` + 退出 1（构造缺值实测见 Evidence）
- [x] AC4: **每层执行时刻 A 项可读**——三层各有一条「最近真实执行时刻」且已触发判定（已停用/已替代/是缺陷 三选一）——meta-cc 取时刻后 `--mechanism <name>:<epoch>[:判定]` 注入；超过声称周期无判定 ⇒ 计入 `missing`（实测见 Evidence）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 closure-lag / verification-round / tick 文档契约检查）——`bash scripts/test.sh --for-task gap-spec-p2-quad-tuple-unified-emitter --allow-thin` 绿；closure-lag-check.test.mjs 原样通过；新增 accounting-emit.test.mjs 全绿

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：三层各跑一次发射器，输出格式对照贴任务体；构造缺值 ⇒ 机械报出
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证（本任务 scoped 只跑 `--for-task` 选中集，全量由外层跑）

## Evidence

**统一发射器**：`plugin/scripts/accounting-emit.ts`（候选 A；候选 B 的 `closure-lag-check.sh` 交叉标注，不扩为发射器）。schema = `quad-tuple/v1`，顶层键 / `occupancy` 键 / `mechanisms` 条目键三层逐一相同。

**AC2 三层输出对照（字段集合相同）**——对三层各跑
`node --experimental-strip-types plugin/scripts/accounting-emit.ts --layer <outer|inner|manager> --json`：

```
outer   top=[at_epoch,at_iso,complete,layer,ledger_line,ledger_line_source,mechanisms,missing,occupancy,schema_version,warnings,write_target,write_target_source]  occ=[effective_cap,in_flight,ratio,source]  mech-entry=[claimed_period_hours,judgement,last_run_age_hours,last_run_epoch,name,overdue,source,status]  complete=True
inner   top=[at_epoch,at_iso,complete,layer,ledger_line,ledger_line_source,mechanisms,missing,occupancy,schema_version,warnings,write_target,write_target_source]  occ=[effective_cap,in_flight,ratio,source]  mech-entry=[claimed_period_hours,judgement,last_run_age_hours,last_run_epoch,name,overdue,source,status]  complete=True
manager top=[at_epoch,at_iso,complete,layer,ledger_line,ledger_line_source,mechanisms,missing,occupancy,schema_version,warnings,write_target,write_target_source]  occ=[effective_cap,in_flight,ratio,source]  mech-entry=[claimed_period_hours,judgement,last_run_age_hours,last_run_epoch,name,overdue,source,status]  complete=True
```

**AC3 构造缺值 ⇒ 机械报出**（`--mechanism x:never` 无判定 + 占用率缺值）：

```
complete: False
missing: ['mechanism:x.last_run_epoch', 'mechanisms.exec_time_unreadable', 'occupancy.in_flight', 'occupancy.effective_cap']
exit would be 1
```

**AC4 每层执行时刻 A 项可读**（meta-cc 取时刻注入，超周期者已判三选一）：

```
manager:
  Workflow:       last_run_age_hours=0.02 status=fresh   judgement=None
  cap-from-gate:  last_run_age_hours=0.25 status=judged  judgement=已停用
  slot-refill:    last_run_age_hours=0.01 status=fresh   judgement=None
  complete: True
```

**fresh worktree 空跑（缺值 = 未执行 的诚实报出）**：本 worktree 无 `.quay/` 运行时迹（closure-pass / verification-round / full-suite 都未跑过），`--layer outer --json` 裸跑 `missing` 点名五个字段、`complete:false`、退出 1——正是 AC3「缺值 = 未执行，机械报出，不靠自述」的活实例。

## Touches

- plugin/scripts/accounting-emit.ts（候选 A 路径——统一四元组发射器，实现时落地，具体文件名以实现为准）
- plugin/test/accounting-emit.test.mjs（新增测试：三层字段集合对照 / 缺值机械报出 / AC4 判定 / 迹文件自动读）
- plugin/scripts/capability-catalog.sh（新脚本入 artifacts 必须声明问题——AC1c 门绿）
- plugin/loop/fast-mode-loop-tick.md + orchestration/orchestrator-loop-tick.md + orchestration/manager-loop-tick.md（三层 tick 必报改调发射器）
- plugin/scripts/closure-lag-check.sh（候选 B 时：扩为四元组发射器，或交叉标注——本任务选候选 A，交叉标注）
- orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md（P2-9 验收：三层发射器输出对照贴回）
- tasks/gap-spec-p2-quad-tuple-unified-emitter.md（自身：勾 AC + 贴证据）

## Contract

measure   unified_emitter_format = `node plugin/scripts/accounting-emit.ts --layer <layer> --json` 的 stdout 字段集合
band      unified_emitter_format = 三层字段集合相同（同一 schema）
invariant quad_tuple_no_missing = 1（任一字段缺值 ⇒ 机械报出）
invariant layer_exec_time_readable = 1（每层「最近真实执行时刻」A 项可读）
invoke    `node plugin/scripts/accounting-emit.ts --layer <outer|inner|manager>`（三层实跑贴回）
control   构造缺值 ⇒ 机械报出；三层输出字段集合比对相同
resume    分步提交：schema 契约 + 发射器 + 三层接线，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 建议 (b) 产品代码类排池 + 任务体引用 SPEC 名 ⇒ `strategic=true` 自动生效；P2-9 四元组统一发射器——现状核实：三层各自拼、零散机制无共用实现。实现归内层）
