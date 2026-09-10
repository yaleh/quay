---
id: gap-goal-driver-no-retire-write-surface
title: goal-driver 写面不越权放弃：writeGoalStatus 只写 achieved/active/needs-human，分诊
  retire 只产 needs-human 建议（非空理由）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-211
---
## Proposal

正本：`goals/AC-211-driver-不越权放弃-期望退役的-ac-只能置-needs-human-并说明理由-retired-归人.md`。SPEC 正本：`orchestration/SPEC-goal-mechanism-2026-09-06.md` §6.1（放弃是判断不是计算，driver 只报红不翻状态）。

**裁定（人 2026-09-09 裁定 1）**：放弃（retire）不交给 goal-driver；若它期望退役某条 AC，应置为 needs-human 并说明理由，交人判断。理由不可逆：`goal-driver.ts:183-187` 自陈全仓无反向翻转——`retired` 一旦写入即永久锁定，故最不可逆的一态必须挡在人这一侧（2026-09-09 04:24–04:48 退役 AC-180/184/186 即此方向）。

**现状（实测，非主张）**：
- `writeGoalStatus`（`plugin/scripts/goal-driver.ts:188`）当前恰好 2 个调用点（`:652`/`:663`），都写 `"achieved"` ⇒ 状态集合 ⊆ {achieved, active, needs-human} 此刻成立，但**无任何守卫**：将来任一调用点改成 `retired`/`superseded` 都不会有测试报红。
- draft AC 分诊（五态判决，`retire` 是其一）由姊妹任务 `gap-goal-driver-draft-ac-triage`（AC-210，ready）实现；本任务**不实现分诊函数本体**，只补「retire 判决 → 写面」这条边界：分诊判「应退役」时，driver 只能产一条 status=needs-human 的 AC 且带非空理由，⛔ status 不得为 retired。

**修法（一个测试文件 + 一个写面落点）**：
1. 新建 `plugin/test/goal-triage-no-driver-retire.test.mjs`，断言两条不变式：
   - ① 写面守卫：枚举 `writeGoalStatus` 全部调用点，逐点核 status 实参 ∈ {achieved, active, needs-human}，⛔ 不含 retired/superseded。
   - ② retire → 建议：分诊判「应退役」时，driver 产物是一条 status=needs-human 的 AC、reason 非空、status ≠ retired。
2. 补「retire 判决 → 写 needs-human」的落点（新增 `writeGoalStatus` 写 `"needs-human"` 的调用点，reason 非空）——目前 driver 对 needs-human 只如实报 stalled（`goal-driver.ts:20-24`），从不写 needs-human，该落点不存在、需本任务补，否则不变式②无可测对象。

⛔ 边界（各自另有 AC，本任务不碰）：五态分诊函数本体归 AC-210（`gap-goal-driver-draft-ac-triage`）；needs-human 进词表/计入在域/阻塞 GOAL 归 AC-209（`gap-goal-needs-human-blocking`，done）；GOAL 层 posture（measure-only 不 activate）归 AC-215。

## AC

- [x] AC1（正本判据）：`node --no-warnings --experimental-strip-types --test plugin/test/goal-triage-no-driver-retire.test.mjs` 退出码 0。
- [x] AC2（不变式①负控制）：把 `plugin/scripts/goal-driver.ts` 任一 `writeGoalStatus` 调用点的 status 实参临时改成 `"retired"` 再跑 AC1 ⇒ 退出码非 0；恢复后 ⇒ 0（证明写面守卫枚举到的调用点非空且逐点真核，⛔ 恒真）。
- [x] AC3（不变式②负控制）：构造「分诊判 retire」输入断言产物 status=needs-human ∧ reason 非空 ∧ ≠ retired；把产物 status 改写成 `"retired"` ⇒ 测试失败。
- [x] AC4（scoped 门）：`bash scripts/test.sh --for-task gap-goal-driver-no-retire-write-surface --allow-thin` 退出码 0。

## DoD

- 测试文件存在且 AC1 通过；两条不变式各带一条负控制（AC2/AC3 改坏 ⇒ 测试红，证明判据非恒真，硬规则 4 推论三），实跑输出贴本任务体供 fan-in 复核。
- 写面守卫是**源形状断言**而非运行时假量：它枚举 `writeGoalStatus` 调用点并逐点核 status 实参——把任一处改成 `retired`/`superseded` 都会让它红。
- 若本任务新增「retire → needs-human」写面落点，它经 `writeGoalStatus`（provider 写路径）写 `"needs-human"`，⛔ 不直改 `goals/*.md`，且 reason 非空可 grep。
- 全量 `scripts/test.sh` 绿。

## Evidence（负控制实跑输出，供 fan-in 复核）

**AC1（正）**：`node --no-warnings --experimental-strip-types --test plugin/test/goal-triage-no-driver-retire.test.mjs` → 3/3 pass（退出码 0）。三条：不变式① 写面守卫、不变式② 行为级（retire ⇒ needs-human + reason 非空）、分诊纯函数前提。

**AC2（不变式①负控制）**：把 `plugin/scripts/goal-driver.ts` 的 `writeGoalStatus(scriptRoot, id, "achieved", …)` 临时改成 `"retired"` ⇒ 测试红，报 `AssertionError [ERR_ASSERTION]: status 实参不得为 "retired"（放弃/取代归人，AC-211）`，退出码 1；恢复后 ⇒ 3/3 pass（退出码 0）。

**AC3（不变式②负控制）**：把 retire 写面落点 `writeGoalStatus(scriptRoot, entry.ac, "needs-human", …)` 临时改成 `"retired"` ⇒ 两条红：不变式① 报 `status 实参不得为 "retired"`、不变式② 报 `AssertionError [ERR_ASSERTION]: retire 建议 ⇒ 产物 status=needs-human（⛔ 不翻 retired）`，退出码 1；恢复后 ⇒ 3/3 pass。

**连带修正（Touches 扩充）**：新增 retire→needs-human 写面使既有 `plugin/test/goal-driver.test.mjs` 的「draft AC under active GOAL 不被翻」断言失效（其 fixture 的 AC-002 draft、无牵引 ⇒ 分诊判 retire ⇒ 现应置 needs-human）。该测试已更新为断言 draft AC 不被翻成 achieved/active/retired、但 retire 死信 ⇒ 置 needs-human。三文件联跑（goal-triage-no-driver-retire + goal-driver + goal-triage）→ 40/40 pass。

## Touches

- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-triage-no-driver-retire.test.mjs`
- `plugin/test/goal-driver.test.mjs`
- `tasks/gap-goal-driver-no-retire-write-surface.md`
