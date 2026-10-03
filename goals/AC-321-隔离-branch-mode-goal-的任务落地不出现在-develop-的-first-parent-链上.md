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

  via=0

  for G in $(live_goals); do
    while read -r t F ct cls; do
      [ -n "$t" ] || continue
      if [ "$cls" = direct ]; then echo "CAUSE=goal-task-landed-on-develop-bypassing-goal-branch — $t of $G (flip $F) is on develop without having gone through goal/$G or its merge commit" >&2; exit 1; fi
      [ "$cls" = via ] && via=$((via+1))
    done <<EOT1
  $(tasks_classified "$G")

  EOT1

  done

  [ "$via" -ge 1 ] || { echo "NOT-EVALUATED: no task of a live branch-mode goal
  has landed via its goal branch yet" >&2; exit 3; }

  echo "PASS: $via landing(s) via goal branch, none landed on develop directly"
expect: exit 0 = 至少 1 个未放弃（非 retired/superseded）的 branch-mode goal 的任务经由其 goal
  分支落地（未并入：翻 done 提交是 goal 分支的祖先而不是 develop 的祖先；已并入：经合并提交的第二父可达、不经第一父可达），且这类
  goal 激活后的所有落地都满足这一点（并入之后的落地不计）；exit 1 = 有任务在 goal 并入前直接进了 develop；exit 3 = 尚无
  live 的 branch-mode goal，或尚无经 goal 分支的落地。判定基于祖先关系，⛔ 不依赖 develop 的 first-parent
  链（真实 fan-in 会把多数提交挤出 first-parent，实测 32 条里 22 条）。
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
  - at: 2026-10-03T12:15:14.110Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
  - at: 2026-10-03T15:40:04.986Z
    from: achieved
    to: active
    actor: cli
    reason: 人 2026-10-03 裁定「改判据并重开 321–323」：旧判据依赖 develop first-parent 链，真实 fan-in
      会把多数提交挤出该链（实测 32 条里 22 条），导致 AC-321 对直落 develop 的演练任务误判通过、AC-322/323 读到的并非
      goal 分支落地。改为基于祖先关系，只计经 goal 分支的落地，并排除 retired/superseded 的 goal
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-03T15:40:04.986Z
---
