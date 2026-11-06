---
id: AC-935
title: 下一步投影：每个 active GOAL 一行 owner/action，并有 goal next 读面
status: draft
kind: criterion
goal: GOAL-914
criterion: node --experimental-strip-types packages/quay/bin/quay.ts goal next
  --root . --json
expect: exit 0；stdout 为 JSON 数组；每个 active GOAL 恰好一行；每行 ac 非空、gapState 在枚举内、owner
  ∈ {driver,worker,human,world}、action.kind 非空；同一轮 .quay/goal-round.jsonl 的
  goal-next fact 含等价行。
origin: 人 2026-11-06 授权；证据：消费者 round 记录里 101/102
  条缺口是非安静态，但没有一条投影成下一步由谁做什么（消费者侧读数，仅作证据，不作依赖）。
---
本 AC 由 gap-goal-next-projection 与 gap-goal-driver-blocked-taxonomy 两个任务实现。