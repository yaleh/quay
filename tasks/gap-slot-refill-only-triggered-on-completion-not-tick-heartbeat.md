---
id: gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat
title: "slot-refill is ONLY evaluated on <task-notification> completion events, never on the tick heartbeat — a long task (session-liveness-hashes 49m+) holds the only subagent, 2 slots idle 34+ min, mechanism keeps saying should_refill=true, nothing asks it (manager mechanism-self-evidence 2026-08-06 02:0xZ: ran slot-refill.ts itself, in_flight=1/slots_free=2/should_refill=true/recommended=[...], 34min zero dispatch; outer independently re-ran: same answer; doc self-contradicts — line 83 'no completion event = no dispatch evaluation (负控制)' vs line 231 'tick heartbeat goes through step 4 full flow', but step 4 execution has NO mechanical guarantee, depends on inner volition per tick); leftover branch of gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release (its AC3 covers 'after release <5min refill' = completion branch REAL, AC4 'no completion event = zero dispatch' is the OTHER side of today's defect); fix: tick heartbeat MUST unconditionally run slot-refill and act on the result, not only on completion events"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**slot-refill 只在完成事件时被评估，tick 心跳从不问它——长任务霸占期间空槽对机制不可见。**

**【机制自证（管理者 2026-08-06 02:0xZ，非推断）】**：管理者直接跑 `slot-refill.ts`：
`in_flight=1, slots_free=2, dispatchable_disjoint=5, criterion_met=true, should_refill=TRUE,
no_refill_reason=null, recommended=[gap-full-suite-runner-red-pattern..., gap-productize-the-manager-layer]`。
机制明说该回填、给了推荐，而**距上次 merge 34 分钟零派发**（三条件全中：距 merge 34min、disjoint=5、
套件非 running/真红）。资源非瓶颈（PSI avg300=5.3，GO）。

**【根因（读 fast-mode-loop-tick.md 确认）】**：回填触发源 = `<task-notification>` 完成事件。唯一在飞
任务已跑 47 分钟未完成 ⇒ 无完成事件 ⇒ **回填从不被评估**。文档把这条写成负控制「没有完成事件就没有
派发评估」，tick 心跳本该兜底，但 inner 02:05 tick 报 light (no fan-in/dispatch)——心跳里没跑这个判断。

**【外层独立核实（比管理者报告更精确一处）——文档自相矛盾】**：
- 行 83（template）：「**没有完成事件就没有派发评估**（负控制）」——宣布完成事件是唯一有效触发源，
  tick 心跳只是兜底。
- 行 231：「否则（/loop 心跳、重锚、人工）⇒ 按 Tick 步骤全流程」——tick 心跳应该走步骤 4 派发闸。
- **但实际**：tick 步骤 4 的执行**没有机械保证**——补晋判据是 `dispatchable_disjoint < cap` 才补晋，
  派发时机依赖内层每 tick 自觉走到步骤 4。dispatchable_disjoint=5 ≥ cap=3 时机制该派发，但内层
  02:05/02:2x tick 都报 light no dispatch，无任何机械检查发现「该派未派」。

**三层实测一致**：①管理者跑 slot-refill（in_flight=1 因为传了 --in-flight）②外层独立重跑
（should_refill=true, dispatchable_disjoint=5）③当前实测（内层 pane 确在等 1 background agent
49m30s，套件 green 无停止条件）——**机制说该派，实际没派，没有任何东西去问它**。

**【归属裁定（外层）】：dispatch-tick-boundary 的遗留分支，不重开、另立一条。**
- dispatch-evaluated（done）正确交付「完成事件即回填」——管理者实测 40 秒是真的。它的 AC3 是
  「槽位释放后 <5 分钟」，**长任务期间的空槽不是它声称覆盖的形态**（它解决「完成后等下一 tick」，
  不是「进行中空槽不可见」）。
- 但它 AC4「无完成事件时零派发」把今天的场景写成了**正确行为**——负控制的反面正是缺陷。归因记它头上
  （cross-reference），机制缺口另立本任务。

### 选定机制

1. **tick 心跳无条件跑 slot-refill**：内层每 tick（含轻触）都跑
   `node --experimental-strip-types plugin/scripts/slot-refill.ts --root "$(pwd)" --cap "${effective_cap:-3}" --in-flight <本会话在飞集合>`，
   `should_refill=true` 且 `recommended` 非空 ⇒ **按 recommended 派发**（仍走步骤 4 逐候选检查），
   不等完成事件。这样长任务霸占期间的空槽每 tick 至少被问一次。
2. **修文档矛盾**：fast-mode-loop-tick.md 行 83 的「没有完成事件就没有派发评估」改为「完成事件是
   **加速**触发源，tick 心跳是**兜底且必跑 slot-refill**」——两个触发源都机械接线，不是只有完成事件。
3. **AC4 负控制语义修正**：负控制从「无完成事件零派发」改为「无完成事件**且 tick 心跳没到**才零派发」
   ——心跳每 20min 必问一次，完成事件只是把评估提前到释放瞬间。

## Acceptance Criteria

- [ ] AC1: tick 心跳（内层每 tick）**无条件跑 slot-refill** 并按结果行动——`should_refill=true` +
       recommended 非空 ⇒ 派发（实测：长任务在飞 1/3、slots_free=2、recommended 非空时，tick 心跳
       触发新派发，不等完成事件）
- [ ] AC2: 文档矛盾消除——fast-mode-loop-tick.md 行 83 的负控制措辞修正（完成事件=加速源，tick
       心跳=必跑兜底），模板与部署副本一致
- [ ] AC3: 与 gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release（done）交叉标注——
       本任务是它 AC4 负控制的反面形态（归因记它头上），不重开
- [ ] AC4: 负控制语义修正——「无完成事件且心跳未到」才零派发；心跳必问（无 `recommended` 或
       `should_refill=false` 才不派）
- [ ] AC5: 测试用 `node:test` 且带 `// @test-group governance`（若改 slot-refill.ts 或新增判定逻辑）

## Touches
- tasks/gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat.md（自身文件：勾 AC + 贴 invoke 证据授权）


- plugin/loop/fast-mode-loop-tick.md（行 83 措辞修正 + 心跳必跑 slot-refill）
- docs/analysis/fast-mode-loop-tick.md（部署副本同步）
- plugin/scripts/slot-refill.ts（若需加心跳模式/默认参数）
- plugin/test/（AC1/AC4 测试）
- tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md（AC3 交叉标注）

## Contract

measure   heartbeat_refill = `grep -n 'slot-refill' docs/analysis/fast-mode-loop-tick.md` stdout 的命中行数（心跳路径必含 slot-refill 调用）
band      heartbeat_refill >= 1（tick 心跳节含 slot-refill 无条件调用）
invoke    `grep -n '没有完成事件\|没有完成事件就没有派发评估\|slot-refill' plugin/loop/fast-mode-loop-tick.md`
control   长任务在飞 + slots_free>0 + recommended 非空 ⇒ tick 心跳触发派发（AC1）；should_refill=false 不派（AC4）
resume    文档修正与心跳接线分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T02:2xZ
changed: 管理者机制自证（跑 slot-refill 本体）+ 外层独立重跑 + 当前实测三层一致，根因坐实：回填只在
完成事件触发，长任务霸占期间空槽不可见；文档自相矛盾（行 83 负控制 vs 行 231 心跳走全流程，但步骤 4
无机械保证）。裁定：dispatch-tick-boundary 遗留分支，另立（不重开）。dispatch-evaluated 的 AC3
（完成即回填，40s 实测真）保留，本任务补「心跳必跑」另一支。
