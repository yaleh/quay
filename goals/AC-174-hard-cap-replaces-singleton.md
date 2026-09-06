---
id: AC-174
title: G4 I1′ 硬上限取代单例 active，且拒绝时枚举当前 active 集合
status: achieved
kind: criterion
goal: GOAL-001
criterion: |
  node packages/quay/src/goal-store.ts check | grep -q '"withinCap": true'
expect: exit 0
origin: |
  人 2026-09-06 裁定「接受硬上限 + 强制关闭机制」，cap=3。
  推翻的是 SPEC-0809 §2b 人已同意的 I1「同一时刻只能有一条 active PHASE」——
  I1 的动机是实测的目标通胀（manager-phase-goal.md 里曾有四条自称"本阶段主判据"的
  AC 同时存在：AC10/AC12/AC20/AC28；设目标的裁定六次，只加不关）。
  ⇒ 推翻它必须补等效守卫，硬上限即其一（另一半是 AC-175 的陈旧判定）。
evidence:
  at: 2026-09-06T22:59:07.242Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假）**：`check` 输出含 `"withinCap": true`。

**取假**：今天必假——`checkExactlyOneActivePhase()`（`goal-store.ts:203-206`）
返回 `{ok, count, active}`，**无 `withinCap` 字段**；且 `activePhases()` 为 0 时 `ok:false`、exit 1。

**I1′ 定义**：`status: active` 的 GOAL 数 ≤ `cap`（默认 3，可配），**写时 fail-closed 拒绝**。

**⊢ 拒绝信息必须枚举当前 active 集合**（硬规则 3：枚举不布尔）——
布尔化的"超上限了"会把"哪三条占着"这个唯一可行动的信息丢掉。

**⊢ `check` 的输出必须把两件事分开报**：`withinCap`（不变式是否成立）与
`hasDirection`（active 数是否 ≥1）。合成一个 `ok` 会让"超上限"与"一条都没有"同形。

**负控制（在实现任务的 AC 里跑，不在本条）**：cap 设为 2 时激活第 3 条被拒，
且错误信息含现有 2 条的 id。

**⚠️ cap=3 是人给的初始策略值，无成本结构支撑**（硬规则 4 推论：成本结构未知前不设数值阈值）。
必须可配（`plugin/scripts/drivers.yml`），**不得写死字面量**；
复核点：goal-driver 跑满 30 个自然日后用 `.quay/goal-round.jsonl` 的真实分布重估。
