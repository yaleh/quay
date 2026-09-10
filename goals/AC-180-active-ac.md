---
id: AC-180
title: 任何 active 的 AC 都必须有可运行判据——不存在「无判据」的活跃验收
status: retired
kind: criterion
goal: GOAL-001
criterion: >-
  test "$(node packages/quay/src/goal-store.ts list |
    node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const n=JSON.parse(s).filter(r=>/^AC-/.test(String(r.id))&&!["draft","retired","superseded"].includes(String(r.status))&&(r.criterion==null||String(r.criterion).trim()==="")).length;process.stdout.write(String(n))})')" -eq 0
expect: goal 机制进入生产使用后，活跃 AC 无一无判据（当前 13 条 GOAL-002 AC 全无判据会被本判据挡下）
origin: |-
  原判据作用域 --status active 恒空（0 条 active AC）⇒ 空过；改写为「非 draft/retired/superseded 的全量 AC」后
  下沉套件 plugin/test/active-ac-must-have-criterion.test.mjs（gap-ac180-scope-empty-so-criterion-passes-vacuously）。
  本记录 retired —— 常设不变式移交套件（goal 层随 achieved 关闭不再复验，同 gap-standing-invariants-not-reevaluated）
---
