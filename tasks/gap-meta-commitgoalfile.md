---
id: gap-meta-commitgoalfile
title: goal 写盘即提交泄漏——未跟踪 goals/*.md 阻塞 develop→doc ff-only 同步
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
goal-store write 只 writeFileSync 不 commit，commitGoalFile 只覆盖 meta-driver 提案/决策两条写路径；AC-182 记录文件仍未跟踪（其判据 fail），syncDevelopToDoc ff-only 报错 40 次

本轮读数（syncHealth.ffError）= `40`，采于 2026-09-06T21:17:37Z，由 meta-driver 机械采集。
涉及机制关键词：`commitGoalFile`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `id="AC-PROBE-$(date +%s)"; node packages/quay/src/goal-store.ts write "$id" --title commit-probe --origin autoDrive-criterion >/dev/null 2>&1; rc=$?; n=$(git status --porcelain goals/ 2>/dev/null | grep '^??' | grep -c "$id"); git status --porcelain goals/ 2>/dev/null | grep '^??' | grep "$id" | awk '{print $2}' | xargs -r rm -f; test "$rc" -eq 0 -a "$n" -eq 0` ⇒ goal-store write 写盘即提交——写一个 probe goal 后 goals/ 无该 id 的未跟踪文件，ff-only 同步不再被 goal 文件阻塞

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `packages/quay/src/goal-store.ts`
- `tasks/gap-meta-commitgoalfile.md`