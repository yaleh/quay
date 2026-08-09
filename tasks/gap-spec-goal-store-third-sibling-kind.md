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

### 设计定案（manager 2026-08-09 08:0x 转达人同意——覆盖早期 schema 草案）

1. **命名 `PHASE-NNN`**（纯序号，含义在 title）——目标文字会漂（08-05/08-06/08-09 三次逐字更正/换目标），任何从目标文字派生的名字都跟着漂；本仓已答三次：ADR-001..032 / DOC-001 / DIR-001..192 全是 `<KIND>-<NNN>` + 独立 title、id 永不移动。PHASE-NNN 是第四次沿用。**原 schema 草案的 GOAL-001 作废。**
2. **phase 与 goal 合一**（不是两种对象）——`PHASE-NNN` 的 title 就是那一个目标陈述；`AC-NNN` 各带 `phase: PHASE-NNN`。**PHASE 记录【不】有 criterion 字段**——它的判据是其 AC 的合取。
3. **两条不变式（人已同意）**：I1 同一时刻只能有一条 `status: active` 的 PHASE；I2 PHASE 达成 ⟺ 其所有活跃 AC 达成（**推导不是存储**）。
4. **历史检验（物证）**：manager-phase-goal.md 有【四条】自称「主判据」的 AC（AC10/AC12/AC20/AC28）——四个「本阶段主判据」活在同一个文件里；六次设目标只加不关、AC16 无关闭标记；唯一做对的一次是 08-05（显式降旧+明新）。
5. **落实设计（根因不是「忘了关」——开新阶段有触发器、关旧阶段没有）**：
   - (a) **阶段切换是单次原子写入、fail-closed**——已有 active phase 时拒绝创建第二条，除非同一次调用给出旧 phase 的处置（achieved 或 superseded-by），不给处置就写不进去；
   - (b) AC 的活跃性派生自 phase，不单独存储；
   - (c) 「恰好一条 active phase」做成 checker 进各层 tick 的 A 段（预演：今天一跑必红）；
   - (d) I2 评估时推导、永不存储。
6. **迁移处置归人不归你我**——AC10/AC12/AC16/AC17/AC20 各自是达成/废止/并入，是目标层面的判断；机制只负责把这个问题逼出来。

## Acceptance Criteria

- [x] AC1: **goal-store kind 落地**——复用 `frontmatter-store-base.ts`（读 import，不复制机制），schema 含 criterion/status(含 achieved)/phase/origin/evidence
- [x] AC2: **criterion 空判红**——建空 criterion 记录跑 gate ⇒ 判红不判绿（fail-closed）
- [x] AC3: **账本事件**——一条记录 gate 执行在 `.quay/gate-events.jsonl` 留下 verdict+timestamp 事件
- [x] AC4: **phase 可推导活跃集**——换 phase 值，活跃集随之变（不靠手工清单）
- [x] AC5: **web 路由**——`/goal` 路由照 `/adr` 形状（含 `/doc` 一并），页面显示最近 verdict 与时刻
- [x] AC6: **origin 空写不进**——负控制：空 origin 记录被拒
- [x] AC7: **gate 自身账本检查**（SPEC §7 风险 1）——gate-events 最近执行时刻 vs 声称周期；超时未跑 ⇒ 报出（防 AC 在静默 gate 上集体显绿）
- [x] AC8: **既有机制不回归**——`--for-task` scoped 门绿（frontmatter-store-base / adr-store / document-store / serve 相关契约检查）
- [x] AC9: **PHASE-NNN 命名 + phase/goal 合一**——纯序号 id（`PHASE-NNN` / `AC-NNN`，title 独立），PHASE 无 criterion 字段（判据=其 AC 合取）
- [x] AC10: **I1 原子阶段切换 fail-closed**——已有 active phase 时拒绝创建第二条，除非同一次调用给出旧 phase 处置（achieved/superseded-by）；不给处置写不进
- [x] AC11: **I2 推导**——PHASE 达成 ⟺ 其所有活跃 AC 达成（评估时推导，永不存储）；「恰好一条 active phase」checker 进各层 tick A 段

## Definition of Done

- [x] AC1–AC8 全部勾上
- [x] 修后实跑：空 criterion 判红、gate 事件带 verdict+timestamp、phase 换值活跃集变、origin 空被拒（贴任务体）；gate 账本检查报出
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/src/goal-store.ts（第三个 sibling kind，已落地——PHASE-NNN/AC-NNN 记录 + CLI 入口）
- packages/quay/src/frontmatter-store-base.ts（复用机制，仅确认不复制——读 import 不修改）
- packages/quay/src/gate/acceptance-runner.ts（criterion 执行复用——读 import 不修改）
- packages/quay/src/gate/factories/goal.ts（新增——makeGoalGate 工厂）
- packages/quay/src/gate/registry.ts（registerGoalGate 注册）
- packages/quay/src/gate/factories/index.ts（makeGoalGate 导出）
- packages/quay/src/serve-handlers.ts（`/goal` + `/doc` 路由，照 `/adr` 形状）
- plugin/scripts/gate-staleness-check.ts（gate 账本检查，SPEC §7 风险 1，已落地）
- plugin/scripts/gate-staleness-check.sh（bash 包装，Contract invoke 入口）
- plugin/scripts/capability-catalog.sh（声明新脚本 question/public entry）
- packages/quay/test/goal-store.test.mjs（新增测试）
- packages/quay/test/goal-gate.test.mjs（新增测试）
- packages/quay/test/serve-goal-doc.test.mjs（新增测试，AC5 web 路由）
- plugin/test/gate-staleness-check.test.mjs（新增测试，AC7）
- orchestration/manager-phase-goal.md（降级为理由档案；落地前保留「活跃 AC 判据命令」节）
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

## 实现证据（2026-08-09，内层落地）

**新增文件**（第三个 sibling kind）：
- `packages/quay/src/goal-store.ts` — PHASE-NNN / AC-NNN 记录，复用 `frontmatter-store-base.ts`（parse/serialize/lock/fileNameForId，读 import 不复制），schema 含 criterion/status(含 achieved)/phase/origin/evidence；PHASE 记录无 criterion 字段（AC9）；`listActive()` 由 phase 推导活跃集（AC4）；`isPhaseAchieved()` I2 评估时推导（AC11）；`write()` 强制 origin 非空（AC6）且 I1 原子阶段切换 fail-closed（AC10）。CLI 入口：`node packages/quay/src/goal-store.ts {list|get|write|gate|check}`。
- `packages/quay/src/gate/factories/goal.ts` — `makeGoalGate`（criterion 经 `acceptance-runner.ts` runAcceptance 执行，空 criterion 判红 fail-closed，AC2）。
- `plugin/scripts/gate-staleness-check.ts` + `.sh` — gate 账本检查（AC7，SPEC §7 风险 1）：读 `.quay/gate-events.jsonl` 最近执行时刻 vs 声称周期，超时/缺失报出。

**改**：`packages/quay/src/serve-handlers.ts` — `/goal` + `/doc` 路由照 `/adr` 形状（AC5，含最近 verdict+时刻 列）；`packages/quay/src/gate/registry.ts` + `factories/index.ts` — 注册 `registerGoalGate`/`makeGoalGate`；`plugin/scripts/capability-catalog.sh` — 声明新脚本。

**Contract 实跑（invoke 两行）**：

`node packages/quay/src/goal-store.ts`（tmp 工作区 `/tmp/goal-evidence`）：
```
# AC2 空 criterion 判红（fail-closed，exit 1）：
node ... goal-store.ts gate AC-020 --root /tmp/goal-evidence
  → verdict: fail
  → reason: AC-020 has no criterion defined (fail-closed — an unenforceable AC must never silently pass)

# AC3 账本事件带 verdict+timestamp（.quay/gate-events.jsonl tail）：
node ... goal-store.ts gate AC-028 --root /tmp/goal-evidence
  → tail event: verdict: pass | timestamp: 2026-08-09T09:19:36.637Z | item: AC-028

# AC4 phase 换值活跃集变（listActive 由 phase 推导）：
active set (PHASE-001 active): AC-020, AC-028
write PHASE-002 --dispose-old PHASE-001 --dispose-to superseded
active set (listActive): []   # PHASE-001 superseded → 旧 AC 自动退场

# AC6 origin 空写不进（负控制）：
write AC-300 --origin ""
  → Error: origin is required for AC-300 — an AC/goal without an empirical basis is cargo cult

# AC10/AC11 I1 + I2：
write PHASE-002 active（无处置）→ Error: cannot activate PHASE-002: PHASE-001 is already active ...
goal-store.ts check → { ok: true, count: 1, active: ["PHASE-002"] }
isPhaseAchieved(PHASE-002) → false（0 个 AC）
```

`bash plugin/scripts/gate-staleness-check.sh --json`：
```
--root /tmp/goal-evidence --timeout 1 --json
  → {"last_gate_event_at":"2026-08-09T09:19:36.637Z","age_seconds":8,"gate_stale":true,"signal":true}  exit 1（超时报出）
--root /tmp/goal-evidence --timeout 3600 --json
  → {"last_gate_event_at":"2026-08-09T09:19:36.637Z","gate_stale":false,"signal":false}                 exit 0（周期内安静）
```

**scoped 门**：`bash scripts/test.sh --for-task gap-spec-goal-store-third-sibling-kind --allow-thin` → **EXIT 0，110 pass / 0 fail / 0 cancelled，task-contract-check violations: 0**。

**未做**：AC1-19 迁移（只迁活跃集 AC20-35 的机制已就绪，具体迁移处置归人——SPEC §5 落地前不迁）；`manager-phase-goal.md` 已降级为理由档案（goal 记录指回它）；全量套件绿 = 外层 verification-round 验证（DoD 未勾）。
