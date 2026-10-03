---
id: AC-326
title: 废弃：被放弃的 branch-mode goal 分支已删除，丢弃的 tip SHA 留在 statusLog
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

  cnt=0

  for f in goals/GOAL-*.md; do
    fm=$(sed -n '2,/^---$/p' "$f"); echo "$fm" | grep -qx 'branch: true' || continue
    st=$(echo "$fm" | sed -n 's/^status: //p'); case "$st" in retired|superseded) ;; *) continue ;; esac
    G=$(basename "$f" | cut -d- -f1-2)
    if git rev-parse -q --verify "refs/heads/goal/$G" >/dev/null; then echo "CAUSE=abandoned-goal-branch-still-exists — $G is $st but goal/$G still exists" >&2; exit 1; fi
    blk=$(echo "$fm" | awk -v s="$st" '/^  - at:/{b=""} {b=b"\n"$0} $0=="    to: "s{p=1} p&&/^  - at:/&&NR>1{exit} END{print b}')
    echo "$blk" | grep -qE '[0-9a-f]{7,40}' || { echo "CAUSE=discarded-tip-not-recorded — $G statusLog entry into $st carries no commit SHA for rescue" >&2; exit 1; }
    cnt=$((cnt+1))
  done

  [ "$cnt" -ge 1 ] || { echo "NOT-EVALUATED: no branch-mode goal has been
  retired or superseded yet" >&2; exit 3; }

  echo "PASS: $cnt abandoned branch-mode goal(s): branch gone, discarded tip
  recorded"
expect: "exit 0 = 每个 status 为 retired/superseded 且 branch: true 的 goal，goal/<id>
  分支不存在，且 statusLog 中进入该状态的条目带一个提交 SHA；exit 1 = 分支仍在或未记 SHA；exit 3 = 尚无被放弃的
  branch-mode goal。"
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」。
activatedAt: 2026-10-03T08:28:39.483Z
statusLog:
  - at: 2026-10-03T08:28:39.483Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-03T08:28:39.483Z
---
