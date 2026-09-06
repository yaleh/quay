---
id: gap-meta-goalstoreargv
title: goal 记录写入后必须提交——未提交 goals/*.md 阻塞 develop→doc ff-only 同步
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
meta-driver 经 goalStoreArgv 写 goals/*.md（writeDraftProposal 与决议落盘两处）后从不 commit（goal-store.ts write() 只 writeFileSync，meta-driver.ts 全文零 git 提交），未跟踪的 goals/*.md 使 git merge --ff-only develop 失败：窗口 44 次 ff-error，stderr 已捕获『untracked working tree files would be overwritten by merge: goals/AC-181-meta-driver.md / goals/GOAL-006-…』，develop→doc 同步随之停摆。

本轮读数（syncHealth.ffError）= `44`，采于 2026-09-06T19:36:25Z，由 meta-driver 机械采集。
涉及机制关键词：`goalStoreArgv`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `test "$(git status --porcelain goals/ | wc -l)" -eq 0` ⇒ goal 写盘路径在写盘后立即提交（复用 commitTaskFile 族），goals/ 无任何未提交记录，ff-only 同步不再被 goal 文件阻塞

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-goalstoreargv.md`