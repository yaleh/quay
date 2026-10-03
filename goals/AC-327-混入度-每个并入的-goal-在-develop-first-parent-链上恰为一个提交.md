---
id: AC-327
title: 混入度：每个并入的 goal 在 develop first-parent 链上恰为一个提交
status: draft
kind: criterion
goal: GOAL-028
criterion: >-
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  bm_goals() { for f in goals/GOAL-*.md; do [ -f "$f" ] || continue; sed -n
  '2,/^---$/p' "$f" | grep -qx 'branch: true' && basename "$f" | cut -d- -f1-2;
  done; }

  goal_acs() { grep -lx "goal: $1" goals/AC-*.md 2>/dev/null | xargs -r -n1
  basename | cut -d- -f1-2; }

  ac_tasks() { grep -lE "^goal_ac: [\"']?$1[\"']?\$" tasks/*.md 2>/dev/null |
  xargs -r -n1 basename | sed 's/\.md$//'; }

  bm_start() { git log --format=%ct -S'branch: true' -- goals/"$1"-*.md | tail
  -1; }

  goal_refs() { r=develop; git rev-parse -q --verify "refs/heads/goal/$1"
  >/dev/null && r="$r goal/$1"; echo "$r"; }

  flip_of() { git log $2 --fixed-strings --grep="翻 $1 done（driver 机械 fan-in）"
  --format='%H %ct' | head -1; }

  on_fp() { git log develop --first-parent --format=%s | grep -qxF "tasks: 翻 $1
  done（driver 机械 fan-in）"; }

  goal_merges() { git log develop --first-parent --merges --format='%H %ct %s' |
  grep -E "goal/$1([^0-9]|\$)"; }

  landings() { s=$(bm_start "$1"); [ -n "$s" ] || return 0; refs=$(goal_refs
  "$1"); for ac in $(goal_acs "$1"); do for t in $(ac_tasks "$ac"); do
  l=$(flip_of "$t" "$refs"); [ -n "$l" ] || continue; [ "${l#* }" -ge "$s" ] ||
  continue; echo "$t $l"; done; done; }

  bm=$(bm_goals); merged=0

  for G in $bm; do
    k=$(goal_merges "$G" | grep -c .); [ "$k" -ge 1 ] || continue
    if [ "$k" -ne 1 ]; then echo "CAUSE=goal-merged-more-than-once — goal/$G appears in $k merge commits on develop's first-parent chain" >&2; exit 1; fi
    while read -r t c ct; do [ -n "$t" ] || continue; if on_fp "$t"; then echo "CAUSE=goal-task-outside-its-merge — $t of $G is on develop's first-parent chain instead of inside the merge" >&2; exit 1; fi; done <<EOT
  $(landings "$G")

  EOT
    merged=$((merged+1))
  done

  [ "$merged" -ge 1 ] || { echo "NOT-EVALUATED: no branch-mode goal has merged
  into develop yet" >&2; exit 3; }

  echo "PASS: $merged merged goal(s), each exactly one commit on develop's
  first-parent chain"
expect: exit 0 = 每个已并入的 branch-mode goal 在 develop first-parent 上恰有 1
  个合并提交，且其任务的翻 done 提交都不在 first-parent 上；exit 1 = 合并多于 1 次或有任务落在合并之外；exit 3 = 尚无
  branch-mode goal 并入。
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」。
---
