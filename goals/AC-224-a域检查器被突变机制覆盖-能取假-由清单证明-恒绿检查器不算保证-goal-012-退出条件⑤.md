---
id: AC-224
title: A域检查器被突变机制覆盖——「能取假」由清单证明，⛔ 恒绿检查器不算保证（GOAL-012 退出条件⑤）
status: draft
kind: criterion
goal: GOAL-012
criterion: bash plugin/scripts/checker-mutation-check.sh --list --json | python3
  -c 'import json,sys; m=json.load(sys.stdin); names=json.dumps(m);
  ok="kernel-sibling-resolution-check" in names; print("covered:",ok);
  sys.exit(0 if ok else 1)'
expect: "`checker-mutation-check.sh --list --json` 的清单里出现
  `kernel-sibling-resolution-check`
  且被标为已覆盖——即该检查器**有突变用例证明它会红**。这是「能取假」的机械证据：一个从不变红的检查器与「永远 pass」不可区分（本仓库
  gap-checkers-have-never-been-shown-to-fail 的既定纪律）。⛔
  只断言「检查器文件存在」不算——那正是恒绿检查器能混过去的形态。反向由该机制自身的 `--check` fail-closed
  闸保证：新检查器若无突变用例，闸会红，不可能静默入册。立条时实测 `covered: False`（检查器尚不存在）⇒ 红。"
origin: >-
  GOAL-012 的机器判据之一。立条依据见 GOAL-012 的 origin（人 2026-09-10 三条裁定后授权设立；8 个缺陷同属
  kernel↔target 边界三域归属缺口；§6b 已有契约但只覆盖一域且无强制力，人工枚举 3 次 3 漏）。


  本条判据在立条当轮已干跑取真实读数：exit 1（可评估、非 spawn 失败），符合「判据落笔当轮必须取一次真实读数」（硬规则
  4c）。判据只引用不会自行回退的量——代码状态与套件绿红，⛔ 不含进程存活/远程主机可达性/真实第三方项目当前跑通状态（后者归 GOAL-009
  AC-207 与例行监控）。
---
