---
id: AC-321
title: 隔离：branch-mode goal 的任务落地不出现在 develop 的 first-parent 链上
status: active
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

  bm=$(bm_goals); [ -n "$bm" ] || { echo "NOT-EVALUATED: no goal record carries
  branch: true yet" >&2; exit 3; }

  seen=0

  for G in $bm; do
    while read -r t c ct; do
      [ -n "$t" ] || continue
      if on_fp "$t"; then echo "CAUSE=task-fanned-into-develop-directly — $t of $G landed on develop's first-parent chain, bypassing goal/$G" >&2; exit 1; fi
      seen=$((seen+1))
    done <<EOT
  $(landings "$G")

  EOT

  done

  [ "$seen" -ge 1 ] || { echo "NOT-EVALUATED: branch-mode goals exist but none
  has a task landed since opting in" >&2; exit 3; }

  echo "PASS: $seen landing(s) of branch-mode goals are off develop's
  first-parent chain"
expect: exit 0 = 至少 1 个 branch-mode goal 在 opt-in 之后有任务落地，且所有这类落地的翻 done 提交都不在
  develop 的 first-parent 链上（只经 goal 分支或其合并提交的第二父可达）；exit 1 = 有一条在 first-parent
  上（直落 develop，绕过 goal 分支）；exit 3 = 尚无 branch-mode goal 或尚无落地。
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」。
activatedAt: 2026-10-03T08:21:38.011Z
statusLog:
  - at: 2026-10-03T08:21:38.011Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-03T08:21:38.011Z
---
