---
id: gap-spec-goal-store-third-sibling-kind
title: "SPEC-goal-store: 阶段目标/AC 是第三个 sibling kind（frontmatter-store-base 复用 + criterion 可跑判据 + phase 可推导 + origin 强制）——AC20-35 从 manager-phase-goal.md 散文迁移到 goal store"
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

**`orchestration/SPEC-goal-store-2026-08-09.md`（4d8950f6）要求阶段目标/AC 成为第三个 sibling kind（goal-store）——复用 `frontmatter-store-base.ts` 的共享机制（解析/序列化/锁/文件名解析），但 schema 独立。现有三种载体（task/ADR/document）都要说谎才装得下（task 的 `## AC` 词冲突 / ADR 不会「达成」/ document 是 METHOD ARTIFACT 且 contracts 不 shell-out）。**

### 四个独有字段（kind 的存在理由，少一个退化成前三种）

1. **`criterion`**：可跑的 shell 命令（复用 task 的 acceptance-runner 形态，不是 document 的 in-process contracts）。实测：AC28-35 的 12 条子判据里 7 条已有可跑命令（`wc -l` / `git rev-list` / `closure-lag-check.sh --json` / `grep -c`），但**活在我每轮敲的 bash 里**——判据在跑、载体是上下文。
2. **`status` 含 `achieved`**：决策/制品不会达成，AC 会。
3. **`phase`**：活跃集必须可推导（AC1-19 历史 / AC20-35 活跃只存在于散文和记忆里）。
4. **`origin`**：没有立条依据的 AC 是 cargo cult；schema 强制（空 origin 写不进）。

### 机制复用（不新建）

- 读写/锁/文件名：`frontmatter-store-base.ts`（与 adr-store / document-store 同源）
- 判据执行：`criterion` shell 命令 ⇒ 复用 `gate/acceptance-runner` 形态
- 账本：GateEvent → `.quay/gate-events.jsonl`（与现有 370 条同格式）⇒ AC 状态第一次有时刻 + verdict 历史
- fail-closed：`criterion` 未设 ⇒ 判红（照 `makeDocumentContractGate` 原则——unenforceable 永不静默 PASS）

### web 可见（人明确要求）

`serve-handlers.ts` 现有 `/`、`/board`、`/journal`、`/live`、`/adr`；`grep -c document` = 0（**DOC 无路由**）。新 kind 路由与 `/doc` 一并做，照 `/adr` 形状；展示 target/criterion/status/最近 verdict 与时刻/origin。「最近 verdict 与时刻」是 web 上最有价值的一列。

### 风险（SPEC §7，最重要）

**gate 引擎最后事件 2026-08-08T08:22，已空闲 ~24h**（outer 核实：`.quay/gate-events.jsonl` 370 行，tail = `2026-08-08T08:22:41Z retreat pass`）。它是能用的，但**把 AC 状态挂在不跑的机制上 = 「机制存在 ≠ 机制在跑」**。⇒ 必须同时给 gate 自身加账本检查（最近执行时刻 vs 声称周期），否则 16 条 AC 在静默 gate 上集体显绿。

### 迁移范围

- 只迁活跃集（AC20-35，16 条）；AC1-19 留 manager-phase-goal.md 作历史
- manager-phase-goal.md 降级为理由档案（goal 记录指回它）——与三份执行核同形状
- **落地前不迁**：新 kind + `/goal` 路由可用前，AC 留在 manager-phase-goal.md 的「活跃 AC 判据命令」节（f69046ae 已落）

**验证锚**（SPEC §6 AC1-AC6）：复用 base 不复制 / criterion 空判红 / gate 事件带 verdict+timestamp / phase 可推导 / web 路由显示 verdict+时刻 / origin 空写不进。

## Acceptance Criteria

- [ ] AC1: **goal-store kind 落地**——复用 `frontmatter-store-base.ts`（读 import，不复制机制），schema 含 criterion/status(含 achieved)/phase/origin/evidence
- [ ] AC2: **criterion 空判红**——建空 criterion 记录跑 gate ⇒ 判红不判绿（fail-closed）
- [ ] AC3: **账本事件**——一条记录 gate 执行在 `.quay/gate-events.jsonl` 留下 verdict+timestamp 事件
- [ ] AC4: **phase 可推导活跃集**——换 phase 值，活跃集随之变（不靠手工清单）
- [ ] AC5: **web 路由**——`/goal` 路由照 `/adr` 形状（含 `/doc` 一并），页面显示最近 verdict 与时刻
- [ ] AC6: **origin 空写不进**——负控制：空 origin 记录被拒
- [ ] AC7: **gate 自身账本检查**（SPEC §7 风险 1）——gate-events 最近执行时刻 vs 声称周期；超时未跑 ⇒ 报出（防 AC 在静默 gate 上集体显绿）
- [ ] AC8: **既有机制不回归**——`--for-task` scoped 门绿（frontmatter-store-base / adr-store / document-store / serve 相关契约检查）

## Definition of Done

- [ ] AC1–AC8 全部勾上
- [ ] 修后实跑：空 criterion 判红、gate 事件带 verdict+timestamp、phase 换值活跃集变、origin 空被拒（贴任务体）；gate 账本检查报出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/src/goal-store.ts（候选路径——第三个 sibling kind，实现时落地，具体文件名以实现为准）
- packages/quay/src/frontmatter-store-base.ts（复用机制，仅确认不复制）
- packages/quay/src/gate/acceptance-runner.ts（criterion 执行复用）
- packages/quay/src/serve-handlers.ts（`/goal` + `/doc` 路由，照 `/adr` 形状）
- plugin/scripts/gate-staleness-check.ts（候选路径——gate 账本检查，SPEC §7 风险 1，实现时落地）
- orchestration/manager-phase-goal.md（AC20-35 迁移后降级为理由档案；落地前保留「活跃 AC 判据命令」节）
- orchestration/SPEC-goal-store-2026-08-09.md（验收贴回）
- tasks/gap-spec-goal-store-third-sibling-kind.md（自身：勾 AC + 贴证据）

## Contract

measure   goal_store_ac3_gate_event = 跑一条 goal 记录 gate 后 `.quay/gate-events.jsonl` 尾部事件的 `verdict`+`timestamp` 字段
band      goal_store_ac3_gate_event = 两者均非空
invariant goal_store_criterion_fail_closed = 1（criterion 空 ⇒ 判红不判绿）
invariant goal_store_origin_required = 1（origin 空 ⇒ 写不进去）
invariant gate_staleness_reported = 1（gate 超时未跑 ⇒ 报出，防静默显绿）
invoke    `node packages/quay/src/goal-store.ts`（或落地后的等价入口）+ `bash plugin/scripts/gate-staleness-check.sh --json`（实跑贴回）
control   空 criterion ⇒ 判红；空 origin ⇒ 拒写；gate 停跑 ⇒ 账本检查报出；phase 换值 ⇒ 活跃集变
resume    分步提交：goal-store kind + criterion runner + gate 账本 + web 路由 + gate 自检，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 定义 SPEC-goal-store 第三个 sibling kind——三种现有载体都要说谎；四独有字段 criterion/status(achieved)/phase/origin；机制复用 frontmatter-store-base + acceptance-runner + gate-events；web `/goal`+`/doc`；风险 1 = gate 引擎空闲 ~24h 需自检（outer 核实 370 行 tail 08-08T08:22）；落地前不迁。实现归内层）
