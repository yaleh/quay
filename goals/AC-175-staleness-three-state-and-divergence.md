---
id: AC-175
title: G4 I3 陈旧判定必须三态（含 NOT-EVALUATED），并报 status 与推导的分歧
status: achieved
kind: criterion
goal: GOAL-001
criterion: |
  out="$(node packages/quay/src/goal-store.ts check --staleness)" \
    && printf '%s' "$out" | grep -q '"fresh"' \
    && printf '%s' "$out" | grep -q '"stale"' \
    && printf '%s' "$out" | grep -q '"notEvaluated"'
expect: exit 0（三个桶作为结构性键恒存在，允许为空数组）
origin: |
  人 2026-09-06 裁定「接受硬上限 + 强制关闭机制」，stale=7 天。
  三态要求来自硬规则 3b：判定机件在读不懂输入时不得返回与"合格"同形的值。
  同形先例（同一天三个互不相关的机件）：task-status-drift-check.ts:126、
  slot-refill.ts:373、outer-tick-log-check.sh:107/112/205/262 —— 全部退出码 0、
  结构完整、数字合理，而它们什么都没查。
evidence:
  at: 2026-09-06T22:10:52.948Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假）**：`check --staleness` 输出把 active GOAL 分进**三个具名桶**：
`fresh` / `stale` / `notEvaluated`，三个键**结构性恒存在**（可为空数组）。

**取假**：今天必假——无 `--staleness` 子命令。
仅实现二分（fresh/stale）而无 `notEvaluated` 桶，亦判假。

**⊢ 为什么零 AC 必须判 `NOT-EVALUATED` 而不是 stale 或 fresh**：
一条刚建、尚未挂 AC 的 GOAL，`lastProgressAt` 无从计算。
判 stale ⇒ 新建即报红；判 fresh ⇒ **一个从未被评估的对象被记成健康**。
**一个判定的输出词表里若没有"未评估"这一态，它就无法区分"查过且合格"与"没查成"。**

**⊢ 时钟量必须是 `lastProgressAt`（= 其 AC 的 `evidence.at` 最大值），不是 GOAL 自己的 `updatedAt`**
（硬规则 4b）：后者是被测对象自己产生的量，goal 停摆时它恰好也停止更新，**与"一切正常"同形**。

**I4（同一子命令报出）**：`status` 与 I2 推导不一致时报分歧——
`status: active` 而 `isGoalAchieved()` 为真，意味着"已达成但没人关"。

**⊢ 硬上限与陈旧不是独立旋钮**：单独的陈旧报红没有牙齿（报了可以不理）；
是 `cap` 让"该关"变成"不得不关"——三条占满时想开新目标就必须先关掉一条。
