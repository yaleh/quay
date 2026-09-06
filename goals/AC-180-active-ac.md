---
id: AC-180
title: 任何 active 的 AC 都必须有可运行判据——不存在「无判据」的活跃验收
status: draft
kind: criterion
goal: GOAL-001
criterion: >-
  test "$(node packages/quay/src/goal-store.ts list --status active |
    node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const n=JSON.parse(s).filter(r=>/^AC-/.test(String(r.id))&&(r.criterion==null||String(r.criterion).trim()==="")).length;process.stdout.write(String(n))})')" -eq 0
expect: goal 机制进入生产使用后，活跃 AC 无一无判据（当前 13 条 GOAL-002 AC 全无判据会被本判据挡下）
origin: readings.criteria 中 AC-143..AC-155 共 13 条 GOAL-002 活跃 AC 的 criterion 全为
  null（verdict 均 fail、reason 均「no criterion defined」），而同属活跃的 GOAL-001
  AC-170..176 全部有判据——说明无判据不是机制限制，而是 GOAL-002 的测量面整体未写
evidence:
  at: 2026-09-06T22:39:56.144Z
  verdict: pass
  reading: acceptance passed (exit 0)
---
