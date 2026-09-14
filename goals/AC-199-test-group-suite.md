---
id: AC-199
title: 双向负控制单测存在、带 @test-group 标注（进默认 suite）、且跑绿
status: achieved
kind: criterion
goal: GOAL-008
criterion: >-
  f=packages/quay/test/store-commit.test.mjs

  test -f "$f" || { echo "AC-199 fail - 负控制单测不存在 $f" >&2; exit 1; }

  head -3 "$f" | grep -q '@test-group' || { echo "AC-199 fail - $f 缺 @test-group
  标注（ADR-019 in-file skip，不进默认 suite）" >&2; exit 1; }

  node --no-warnings --experimental-strip-types --test "$f"
expect: 今天：文件不存在 ⇒ 红。落地后四组负控制全绿且该文件出现在默认 suite 选择里。
origin: SPEC §7。四组负控制缺一不可，否则是回声不是测量（硬规则 4 推论三）：① propagate:"develop" 关掉 ⇒
  develop 拿不到该写；② propagate:"none" 打开 ⇒ develop 不拿到该写；③ 目标不在 git 工作树 ⇒ 返回
  not-in-git 而不是 failed；④ 内容字节相同 ⇒ 返回 unchanged 且工作树干净（脏 goals/*.md 会挡
  develop→doc ff-only，即 gap-meta-commitgoalfile 修过的 bug）。@test-group
  那一半用结构检查而非跑全量 suite，是为了让判据在 goal gate 的 60s 预算内可跑。
---
