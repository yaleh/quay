---
id: AC-182
title: goal 记录文件写入后必须提交——未跟踪的 goals/*.md 会阻塞 develop→doc 的 ff-only 同步
status: draft
kind: criterion
goal: GOAL-001
criterion: test "$(git status --porcelain goals/ 2>/dev/null | grep -c '^??')" -eq 0
expect: goals/ 下无未跟踪记录文件，develop→doc 同步不再被未跟踪文件阻塞
origin: 'syncHealth.ffError=46（窗口内 develop→doc ff-only 合并失败 46 次）；载体内 detail
  字段实锤根因："untracked working tree files would be overwritten by merge:
  goals/AC-181-meta-driver.md, goals/GOAL-006-..."；goal-store.ts 仅
  fs.writeFileSync（:345/:448，write 函数）无 git add/commit，与 task-ops.ts
  commitTaskFile 的提交后写模式相反。'
evidence:
  at: 2026-09-06T22:29:23.833Z
  verdict: pass
  reading: acceptance passed (exit 0)
---
