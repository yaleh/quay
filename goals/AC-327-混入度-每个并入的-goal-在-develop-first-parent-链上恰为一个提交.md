---
id: AC-327
title: 混入度：每个并入的 goal 在 develop first-parent 链上恰为一个提交
status: achieved
kind: criterion
goal: GOAL-028
criterion: >-
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  fm() { sed -n '2,/^---$/p' "$1"; }

  live_goals() { for f in goals/GOAL-*.md; do [ -f "$f" ] || continue; m=$(fm
  "$f"); echo "$m" | grep -qx 'branch: true' || continue; st=$(echo "$m" | sed
  -n 's/^status: //p' | head -1); case "$st" in retired|superseded) continue ;;
  esac; echo "$m" | grep -q '^activatedAt: ' || continue; basename "$f" | cut
  -d- -f1-2; done; }

  act_epoch() { a=$(fm goals/"$1"-*.md | sed -n 's/^activatedAt: //p' | head -1
  | tr -d '"'); date -d "$a" +%s 2>/dev/null; }

  goal_acs() { grep -lx "goal: $1" goals/AC-*.md 2>/dev/null | xargs -r -n1
  basename | cut -d- -f1-2; }

  ac_tasks() { grep -lE "^goal_ac: [\"']?$1[\"']?\$" tasks/*.md 2>/dev/null |
  xargs -r -n1 basename | sed 's/\.md$//'; }

  goal_refs() { r=develop; git rev-parse -q --verify "refs/heads/goal/$1"
  >/dev/null && r="$r goal/$1"; echo "$r"; }

  flip_of() { git log $2 --fixed-strings --grep="翻 $1 done（driver 机械 fan-in）"
  --format='%H %ct' | head -1; }

  goal_merges() { git log develop --merges --format='%H %ct %s' | grep -E
  "goal/$1([^0-9]|\$)"; }

  classify() { F=$1; Mg=$2; if [ -n "$Mg" ]; then if git merge-base
  --is-ancestor "$F" "$Mg"; then if git merge-base --is-ancestor "$F" "$Mg^1";
  then echo direct; else echo via; fi; else echo post; fi; else if git
  merge-base --is-ancestor "$F" develop; then echo direct; else echo via; fi;
  fi; }

  tasks_classified() { G=$1; a=$(act_epoch "$G"); [ -n "$a" ] || return 0;
  refs=$(goal_refs "$G"); Mg=$(goal_merges "$G" | tail -1 | cut -d' ' -f1); for
  ac in $(goal_acs "$G"); do for t in $(ac_tasks "$ac"); do l=$(flip_of "$t"
  "$refs"); [ -n "$l" ] || continue; F=${l% *}; ct=${l#* }; [ "$ct" -ge "$a" ]
  || continue; echo "$t $F $ct $(classify "$F" "$Mg")"; done; done; }

  via_landings() { tasks_classified "$1" | awk '$4=="via"{print $1" "$2" "$3}';
  }

  merged=0

  for G in $(live_goals); do
    k=$(goal_merges "$G" | grep -c .); [ "$k" -ge 1 ] || continue
    if [ "$k" -ne 1 ]; then echo "CAUSE=goal-merged-more-than-once — goal/$G appears in $k merge commits on develop" >&2; exit 1; fi
    via=0
    while read -r t F ct cls; do
      [ -n "$t" ] || continue
      if [ "$cls" = direct ]; then echo "CAUSE=goal-task-entered-develop-outside-its-merge — $t of $G (flip $F) reached develop without going through the single goal merge commit" >&2; exit 1; fi
      [ "$cls" = via ] && via=$((via+1))
    done <<EOT1
  $(tasks_classified "$G")

  EOT1
    [ "$via" -ge 1 ] || { echo "NOT-EVALUATED: $G merged but no task landing is attributable to its merge (zero would be vacuous)" >&2; exit 3; }
    merged=$((merged+1))
  done

  [ "$merged" -ge 1 ] || { echo "NOT-EVALUATED: no live branch-mode goal has
  merged into develop yet" >&2; exit 3; }

  echo "PASS: $merged merged goal(s), each entered develop through exactly one
  merge commit"
expect: exit 0 = 每个已并入的 live branch-mode goal 恰有 1 个合并提交，其任务在并入前的落地都经该合并提交进入
  develop（不经合并提交的第一父可达），且至少有 1 个这样的落地；exit 1 = 合并多于 1 次，或有任务绕过合并直接进入
  develop；exit 3 = 尚无 goal 并入，或已并入但无可归属的任务落地（零是空转）。⛔ 不依赖 first-parent。
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」。
activatedAt: 2026-10-03T08:30:27.718Z
statusLog:
  - at: 2026-10-03T08:30:27.718Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-10-03T20:21:18.873Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-03T08:30:27.718Z
---
