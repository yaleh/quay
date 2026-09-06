---
id: gap-goal-store-hard-cap-staleness-three-state
title: I1 单例改硬上限 I1′ + 新增陈旧三态 I3 与分歧检查 I4，cap/stale 可配不写死
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-store-revoke-prose-authority-repoint-pointers
---
## Proposal

正本：`orchestration/SPEC-goal-mechanism-2026-09-06.md` §4 + `goals/AC-174-hard-cap-replaces-singleton.md`
与 `goals/AC-175-staleness-three-state-and-divergence.md`。人 2026-09-06 裁定「接受硬上限 + 强制关闭机制」，
初始值 `cap=3` / `stale=7 天`。

**立条依据（实测）**：`goals/` 下现有 **2 条 `status: active` 的 GOAL**（`GOAL-001` + `GOAL-002`）
——**这在现行 I1（`goal-store.ts:203-206` 的 `ok = (count === 1)`、`:282-304` 的写时拒绝）下是非法状态**。
机制已经落后于生产数据，`check` 现在必然报 not-ok。

**推翻 I1 必须补等效守卫，不能只是放宽**：I1 的动机是实测的目标通胀——
`manager-phase-goal.md` 里曾有**四条**自称"本阶段主判据"的 AC 同时存在（AC10/AC12/AC20/AC28），
「设目标的裁定六次，只加不关」。⇒ 硬上限保证"多"不等于"无限"，陈旧判定专门抓"只加不关"。
**两者不是独立旋钮：上限是关闭的执行力**——三条占满时想开新目标就必须先关掉一条。

## Plan

1. **I1′ 取代 I1**：`goal-store.ts:282-304` 的写时逻辑由「已有 active 就拒」改为
   「active 数 ≥ `cap` 才拒」；`:203-206` 的 `checkExactlyOneActivePhase` 改名并改判据为 `≤ cap`。
2. **拒绝信息必须枚举当前 active 集合**（硬规则 3：枚举不布尔）——
   布尔化的"超上限了"会把「哪几条占着」这个唯一可行动的信息丢掉。
3. **`check` 输出把两件事分开报**：`withinCap`（不变式是否成立）与 `hasDirection`（active 数 ≥1），
   外加 `activeCount` / `cap` / `active[]`。**合成一个 `ok` 会让「超上限」与「一条都没有」同形。**
4. **新增 `check --staleness`**：把 active GOAL 分进**三个具名桶** `fresh` / `stale` / `notEvaluated`，
   三个键**结构性恒存在**（可为空数组）。
   - 时钟量 = `lastProgressAt`（其 AC 的 `evidence.at` 最大值），**派生不存储**；
     ⛔ 不得用 GOAL 自己的 `updatedAt`——那是被测对象自己产生的量，停摆时它也停止更新，与"一切正常"同形（硬规则 4b）。
   - **零 AC 的 GOAL 判 `notEvaluated`**，既不是 stale 也不是 fresh（硬规则 3b）。
5. **I4 分歧检查**（同一子命令报出）：`status: active` 而 `isGoalAchieved()` 为真 ⇒ 报「已达成但没人关」。
6. **`cap` / `stale` 可配，不写死字面量**（硬规则 4 推论：成本结构未知前不设数值阈值）。
   **落点定为 `.quay/config.yml`**，理由：goal-store 是 Core/provider 代码、已解析 workspaceRoot；
   而 SPEC §4.2 括注的 `plugin/scripts/drivers.yml` 由 `plugin/scripts/driver-config.ts` 读取，
   **Core 不应反向依赖 plugin/scripts**；且该上限是**写时的 store 不变式**，不是 driver 旋钮。
   已实测 `.quay/config.yml` **不在** `SHARED_STATE_PATHS`（`concurrent-batch-scheduler.ts:67` 只含 4 个
   experiments 文件）⇒ 不会触发共享状态串行。G6 的 driver 读同一个值。
   默认值 `cap=3` / `stale=7d`，**代码注释里必须标明这是人给的初始策略值、无成本结构支撑**，
   并写上复核点（driver 跑满 30 个自然日后用 `.quay/goal-round.jsonl` 的真实分布重估）。

## Acceptance Criteria

- [x] `node packages/quay/src/goal-store.ts check | grep -q '"withinCap": true'` 退出 0（AC-174 判据，立案时取假：无该字段）
- [x] `node packages/quay/src/goal-store.ts check --staleness` 的输出同时含 `"fresh"`、`"stale"`、`"notEvaluated"` 三个键（AC-175 判据，立案时取假：无该子命令）
- [x] 负控制：临时目录里 cap 设为 2、已有 2 条 active 时写第 3 条 active **被拒**，且错误信息**含现有 2 条的 id**（单测断言）
- [x] 负控制：零 AC 的 GOAL 被判 `notEvaluated`，**不出现在 `stale` 也不出现在 `fresh` 桶里**（单测断言）
- [x] `cap`/`stale` 从 `.quay/config.yml` 读取：改配置值后 `check` 输出的 `cap` 随之改变（单测断言，证明非写死）
- [x] I4：构造 status=active 而全部 AC 已 achieved 的 GOAL，`check` 报出分歧（单测断言）
- [x] `bash scripts/test.sh --for-task gap-goal-store-hard-cap-staleness-three-state` 退出 0

## Definition of Done

**验收对象是【生产上的 2 条 active GOAL 不再被判非法】，不是【多了一个 withinCap 字段】。**
在主检出真实跑 `node packages/quay/src/goal-store.ts check`，
对当前 `GOAL-001` + `GOAL-002` 两条 active 报 `withinCap: true` 且退出 0
——**旧 I1 下这两条同时存在必然报 not-ok，这就是本任务的双向控制**。
且 `check --staleness` 对这两条给出三态中的确定取值（不是空输出、不是缺键）。
仅单测绿而主检出 `check` 仍报 not-ok ⇒ 不算完成。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/test/goal-store.test.mjs
- .quay/config.yml
- tasks/gap-goal-store-hard-cap-staleness-three-state.md
