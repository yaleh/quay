---
id: AC-901
status: retired
kind: criterion
goal: GOAL-901
criterion: >-
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  f=$(ls goals/GOAL-901-*.md 2>/dev/null | head -1)

  if [ -z "$f" ]; then echo "NOT-EVALUATED: GOAL-901 record is absent" >&2; exit
  3; fi

  fm=$(sed -n '2,/^---$/p' "$f")

  st=$(printf '%s\n' "$fm" | sed -n 's/^status: //p')

  if [ "$st" != "retired" ]; then echo "NOT-EVALUATED: GOAL-901 status reads
  '$st', not retired" >&2; exit 3; fi

  if git rev-parse -q --verify refs/heads/goal/GOAL-901 >/dev/null; then echo
  "CAUSE=goal-branch-still-exists — goal/GOAL-901 was not discarded" >&2; exit
  1; fi

  if ! printf '%s\n' "$fm" | grep -qE '[0-9a-f]{40}'; then echo
  "CAUSE=discarded-tip-not-recorded — no 40-hex tip SHA in GOAL-901 frontmatter"
  >&2; exit 1; fi

  echo "PASS: GOAL-901 retired, goal/GOAL-901 gone, discarded tip SHA recorded"
expect: exit 0 = GOAL-901 已 retired 且 goal/GOAL-901 分支不存在、frontmatter 含 40 位 tip
  SHA；exit 1 = 分支仍在或未记 SHA；exit 3 = 尚未废弃或记录缺失。
origin: GOAL-028 退出条件② 废弃演练（AC-326 生产读数）——一次性演练记录，非真实开发方向。
statusLog:
  - at: 2026-10-03T10:37:17.279Z
    from: draft
    to: retired
    actor: ac326-drill
    reason: AC-326 废弃演练：随其 goal 一并 retired
---
