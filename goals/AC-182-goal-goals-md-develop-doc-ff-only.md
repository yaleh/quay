---
id: AC-182
title: goal 记录文件写入后必须提交——未跟踪的 goals/*.md 会阻塞 develop→doc 的 ff-only 同步
status: retired
kind: criterion
goal: GOAL-001
criterion: test "$(git status --porcelain goals/ 2>/dev/null | grep -c '^??')" -eq 0
expect: goals/ 下无未跟踪记录文件，develop→doc 同步不再被未跟踪文件阻塞
origin: 职能移交到套件（gap-standing-invariants-not-reevaluated-move-to-suite）：goals/
  无未跟踪记录文件 已作为常驻断言 plugin/test/goal-invariants-standing.test.mjs 每轮真跑；goal
  层全绿即关闭不再复验，故 retired（不删记录不改号，硬规则 8）
---
