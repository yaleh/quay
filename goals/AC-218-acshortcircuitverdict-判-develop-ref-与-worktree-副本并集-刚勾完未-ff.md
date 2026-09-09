---
id: AC-218
title: acShortCircuitVerdict 判 develop ref 与 worktree 副本并集——刚勾完未 ff 的 AC 不被误判未全勾
status: achieved
kind: criterion
goal: GOAL-011
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/ac-shortcircuit-develop-worktree-union.test.mjs
expect: AC 勾选只落在 develop ref（或 worktree 任务分支提交）而工作树副本尚未同步时，acShortCircuitVerdict
  仍判全勾，不再误报 exited-not-landed 重派
origin: readings 中 GOAL-011 列 active 但 criteria 表 AC-201..217 无一 goal=GOAL-011（零
  AC），且 AC-217（每个活跃 GOAL 至少一条 AC）verdict=fail 佐证该缺口；GOAL-011 正文退出条件①点名
  acShortCircuitVerdict 改判并集，而 plugin/scripts/worker-driver.ts:2535 现只读 worktree
  副本（path.join(worktree,'tasks/<id>.md')），正是 2026-09-07 ABI 勾满 8 条 AC 后 worktree
  副本见 0/8、exited-not-landed 烧 45 分钟的根因
activatedAt: 2026-09-09T13:41:21.457Z
statusLog:
  - at: 2026-09-09T09:37:09.931Z
    from: draft
    to: needs-human
    actor: goal-driver
    reason: triage 判 retire：建议退役但 retired 归人——driver 置 needs-human 交人判断
  - at: 2026-09-09T13:41:21.457Z
    from: needs-human
    to: active
    actor: human
    reason: triage bug已修复,gap-meta-goal-triage-fresh-draft-not-retire
      done;实现与测试均已绿,gap-store-commit-propagation-field-aware done;同AC-217先例拨回
  - at: 2026-09-09T13:42:10.571Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
