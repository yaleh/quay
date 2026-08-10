---
id: gap-ready-pool-worklanded-traps-stuck-work
title: ready-pool 的 workLanded 排除把真实剩余工作堵死——gap-session-liveness（4/9，5 条 AC
  未勾是真实实现工作）被排除出可派发池，既不能派又不能翻 done；对比 gap-dispatch（11/12 仅验证窗）合法 done-flip
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

**ready-pool 的 `not-yet-flipped` 排除把真实剩余工作堵死——gap-session-liveness-busy-mask-idle-with-subagents（4/9 AC，5 条未勾：AC0 观测/AC2 同阶去抖/AC3 人裁定/AC7 D4 修复）被 `workLanded=true` 排除出可派发池，但它的 AC 没做完——既不能派发（workLanded）又不能翻 done（AC 未满），任务困死。与 gap-dispatch（11/12，唯一未勾=验证窗 AC3）不同——后者 work 真做完了只差外层验证，是合法 done-flip 候选；前者是真剩余工作被误排除。**

### 实证（outer 2026-08-09 15:2x 分诊）

- **gap-session-liveness-busy-mask-idle-with-subagents**：AC 4/9——AC0（先观测 15min）、AC2（同阶去抖）、AC3（人裁定落地）、AC7（D4 修复）、AC1-AC7 实跑贴体 全未勾。这些是**真实实现工作**（D3/D4 修复、pane 日志、人裁定），不是验证窗。
- **workLanded 误判**：`taskWorkLanded()` = `symbolResolved || touchLanded || gitHistory`。它的 Touches（plugin/scripts/session-liveness.sh 等）有已落地工作 ⇒ touchLanded=true ⇒ ready-pool 把它标 `not-yet-flipped` 排除出 dispatchable。
- **后果**：inner 看 `dispatchable_disjoint` 时它不在候选里（被排除），但它的 AC 没做完——任务既不能派发完成、也不能翻 done。**这是 17 条积压里的「真剩余工作被误堵」类**，与「work 真做完只差外层验证」的合法 done-flip 类混在一起。
- **对照 gap-dispatch**（11/12）：唯一未勾 AC3=「复测：槽位释放后 <5 分钟有新派发」——验证窗，work 真做完了（slot-refill 机制已建/已接线/负控制已过），round-171 实测即可确认。这是合法 done-flip，不是被困工作。

**为什么重要**：ready-pool 的排除判据把「workLanded」当「可翻 done」，但 workLanded 不代表 AC 全做完——它只代表「有些 work 落地了」。真实剩余工作被误排除 = 池子被污染（pool 计数虚低）+ 任务困死（既不能派也不能翻）+ inner 目测漏判（看候选时它不在列表里）。这是 manager 说的「17 条积压=上游堵塞」的**机制根**。

**修的方向（实现归内层）**：
- 候选 A：**排除判据加 AC 完成度**——`not-yet-flipped` 只在「AC 全勾（或仅剩验证窗 AC）」时排除；AC 未满 50% 的 workLanded 任务**不排除**（它是真实剩余工作，应可派发）。
- 候选 B：**区分两类积压**——not-yet-flipped 细分「done-flip-ready」（AC 全勾/仅验证窗）vs「stuck-work」（AC 大量未勾）——前者排除（等翻 done），后者不排除（可派发）。
- 候选 C：**workLanded 定义修正**——`taskWorkLanded` 只在「该任务声明的主要 work 全落地」时 true；AC 未满的任务不因 touchLanded 而 workLanded。

**验证锚**：修后，(a) gap-session-liveness（4/9）重新出现在 dispatchable 候选里；(b) gap-dispatch（11/12 仅验证窗）仍是 done-flip 候选不误派；(c) 池子计数恢复真实（无 workLanded 误排）。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录实证（gap-session-liveness 4/9 被 workLanded 排除 + work 未完成 + 对比 gap-dispatch 合法 done-flip）（本任务 Proposal 已含；内层补：ready-pool 直接跑复现）
      **实证（内层 2026-08-09 直跑复现）**：main 检出未修版 ready-pool-check 对 live store → pool 19 / not-yet-flipped 排除 19，gap-session-liveness **不在** ready 候选（被误排除），gap-dispatch 在 excluded。实测 gap-session-liveness 任务体 AC 8 框勾 4（AC1/AC4/AC5/AC6 已勾；AC0/AC2/AC3/AC7 未勾 = 真实实现工作）= 4/8 = 0.50，正是被 `workLanded=true`（touchLanded）误排除的 stuck-work 形态——work 没做完既不能派发又不能翻 done。
- [x] AC2: **stuck-work 不被排除**——AC 未满（如 <50% 勾选）的 workLanded 任务重新可派发（gap-session-liveness 回到候选）
      **实证（内层 2026-08-09）**：修后同一次 run → gap-session-liveness-busy-mask-idle-with-subagents 出现在 `ready`（dispatchable 候选）列表。判据：`notYetFlipped` 现在要求 workLanded **且**（AC 全勾 或 AC 完成率 **>0.5**）才排除；4/8 = 0.50 不满足 `>0.5` ⇒ 回到候选。
- [x] AC3: **done-flip 仍正确排除**——AC 全勾/仅验证窗的任务仍是 not-yet-flipped（不误派已落地工作）
      **实证（内层 2026-08-09）**：gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release（AC 6 框勾 5 = 0.833 > 0.5，仅验证窗 AC3 未勾）修后仍在 `excluded`（reason: not-yet-flipped）——合法 done-flip 不被误派。阈值边界钉在 ready-pool-check.test.mjs：4/8=0.50 可派发、5/6=0.833 排除、2/2 排除、0/2 可派发。
- [x] AC4: **池子计数恢复**——无 workLanded 误排后 pool 反映真实可派发量（不再虚低）
      **实证（内层 2026-08-09，同一 live store 同一时刻对照）**：修前 pool 19 / not-yet-flipped 排除 19；修后 pool 28 / not-yet-flipped 排除 10——9 个 AC 未满的 workLanded 任务回到池子。修后剩余 10 个 not-yet-flipped 排除中 **0 个** AC 完成率 ≤50%（无 workLanded 误排残留）。
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 ready-pool / task-status-drift 契约检查）
      **实证（内层 2026-08-09）**：`bash scripts/test.sh --for-task gap-ready-pool-worklanded-traps-stuck-work --allow-thin` → EXIT=0；ℹ tests 106 · pass 105 · fail 0 · cancelled 0 · skipped 1（QUAY_TEST_REAL_STORE=1 opt-in）；scoped static checks 全过：test-framework-policy / test-isolation / test-impl-census / task-contract-check（--strict-subset）→ "no violations"；violations: 0 unique。

## Evidence（内层实现 2026-08-09）

**实现**：`plugin/scripts/ready-pool-check.ts` 的 `notYetFlipped()`——workLanded 分支加 AC 完成度闸：
`doneFlipReady = workLanded && (allAcsChecked || acRatio > 0.5)`，返回 `doneFlipReady || allAcsChecked`。
阈值**严格 >0.5**：AC 全勾（done-flip）或 >50%（仅剩验证窗）才排除；AC ≤50% 的 workLanded 任务
（stuck-work = 真实剩余实现工作）回到可派发池。三条 landing 证据（symbolResolved / touchLanded /
gitHistory）全部过同一 AC 闸。测试：`plugin/test/ready-pool-check.test.mjs` 重写覆盖三条 landing
路径的 stuck-work vs done-flip 对照 + 阈值边界（4/8 可派发 / 5/6 排除 / 2/2 排除 / 0/2 可派发）。

**修后实跑**（`node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root /home/yale/work/quay --json`，2026-08-09 对 live store 同一时刻）：

| 锚 | 修前（main 未修版） | 修后（本任务） |
|---|---|---|
| pool | 19 | 28 |
| not-yet-flipped 排除 | 19 | 10 |
| gap-session-liveness 在 ready 候选 | 否（被误排除） | **是** |
| gap-dispatch 在 excluded(not-yet-flipped) | 是 | 是（合法 done-flip 不误派） |
| 剩余排除中 AC≤50% 的 workLanded 误排 | — | 0（无残留） |

**验证锚对照**：(a) gap-session-liveness（4/8=0.50）回到 dispatchable——AC2 达成；(b) gap-dispatch
（5/6=0.833 仅验证窗）仍 not-yet-flipped——AC3 达成；(c) pool 19→28 反映真实可派发量——AC4 达成。

**scoped gate**：`bash scripts/test.sh --for-task gap-ready-pool-worklanded-traps-stuck-work --allow-thin`
→ EXIT=0 · ℹ tests 106 · pass 105 · fail 0 · cancelled 0 · skipped 1（opt-in real-store）· scoped static
checks 全绿（test-framework-policy / test-isolation / test-impl-census / task-contract-check
--strict-subset "no violations"）· violations: 0 unique。

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：gap-session-liveness 回到 dispatchable；gap-dispatch 仍 done-flip；pool 计数（贴任务体）——见「Evidence（内层实现 2026-08-09）」
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）——105 pass / 0 fail / 0 cancelled
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/ready-pool-check.ts（not-yet-flipped 排除判据加 AC 完成度 / 细分两类）
- plugin/scripts/task-status-drift-check.ts（候选 C：taskWorkLanded 定义）
- plugin/test/（新增 ready-pool 排除判据测试）
- tasks/gap-session-liveness-busy-mask-idle-with-subagents.md（交叉标注——本任务的被困根因）
- tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md（交叉标注——合法 done-flip 对照）
- tasks/gap-ready-pool-worklanded-traps-stuck-work.md（自身：勾 AC + 贴证据）

## Contract

measure   session_liveness_dispatchable = `node plugin/scripts/ready-pool-check.ts --json` 里 gap-session-liveness 是否在 dispatchable 候选
band      session_liveness_dispatchable = true（AC 未满的 workLanded 任务回到候选）
invariant gap_dispatch_still_done_flip = 1（AC 全勾/仅验证窗任务仍 not-yet-flipped）
invariant pool_count_restored = 1（无 workLanded 误排）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root /home/yale/work/quay --json`（贴回）
control   gap-session-liveness 回候选；gap-dispatch 仍 done-flip；pool 计数真实
resume    排除判据细分 / workLanded 修正分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（ready-pool workLanded 排除把真实剩余工作堵死——gap-session-liveness 4/9 被排除但 work 未完成，既不能派也不能翻；与 gap-dispatch 11/12 合法 done-flip 对照。机制根：workLanded 不代表 AC 全做完。实现归内层）
