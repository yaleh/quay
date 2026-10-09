---
id: AC-322
title: 追平：每次 goal 分支落地都包含其追平时刻的 develop
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
  "goal/$1[^ ]* into develop([^0-9]|\$)"; }

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

  dev_at() { git reflog show --date=unix --format='%H %gd' refs/heads/develop |
  sed -E 's/ [^ ]*@\{([0-9]+)\}$/ \1/' | awk -v t="$1" '$2<=t {print $1; exit}';
  }

  checked=0

  for G in $(live_goals); do
    a=$(act_epoch "$G"); L=$(via_landings "$G")
    while read -r t c ct; do
      [ -n "$t" ] || continue
      base=""
      while read -r t2 c2 ct2; do [ -n "$t2" ] && [ "$c2" != "$c" ] && git merge-base --is-ancestor "$c2" "$c" && { [ -z "$base" ] || git merge-base --is-ancestor "$base" "$c2"; } && base=$c2; done <<EOT1
  $L

  EOT1
      [ -n "$base" ] || base=$(dev_at "$a")
      [ -n "$base" ] || { echo "NOT-EVALUATED: develop reflog has no entry at or before $G was activated" >&2; exit 3; }
      tx=""
      for x in $(git rev-list --merges "$base..$c"); do for p in $(git rev-list --parents -n1 "$x" | cut -d' ' -f2-); do git merge-base --is-ancestor "$p" develop && ! git merge-base --is-ancestor "$p" "$base" && { tx=$(git log -1 --format=%ct "$x"); break 2; }; done; done
      [ -n "$tx" ] || tx=$(git log --reverse --format=%ct "$base..$c" | head -1)
      d=$(dev_at "$tx")
      [ -n "$d" ] || continue
      if ! git merge-base --is-ancestor "$d" "$c"; then echo "CAUSE=landing-missed-develop-catch-up — $t on goal/$G lacks develop tip $d that was current at its catch-up point" >&2; exit 1; fi
      checked=$((checked+1))
    done <<EOT2
  $L

  EOT2

  done

  [ "$checked" -ge 1 ] || { echo "NOT-EVALUATED: no goal-branch landing could be
  checked against the develop reflog" >&2; exit 3; }

  echo "PASS: $checked goal-branch landing(s) each contained develop as of their
  catch-up point"
expect: exit 0 = 每次经 goal 分支的落地，其提交都以 develop 在该次追平时刻（该次落地内合入 develop 的 merge
  提交时间；无 merge 时取该次落地最早提交时间）的 tip 为祖先，tip 取自 develop reflog；落地只计经 goal 分支的（与
  AC-321 同一分类，⛔ 直落 develop 的演练任务不计）；exit 1 = 有落地缺了当时的 develop tip；exit 3 =
  无可核对的落地或 reflog 不覆盖。
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」；2026-10-09 收紧 goal_merges()
  选择器（gap-ac321-goal-merge-selector-matches-task-catchup-merge）：原宽正则同时命中「任务分支追平
  goal 分支」的合并（subject 含 goal/<id>、目标为 task 分支），且 Mg 用 tail -1 取到最旧一条 ⇒
  把那次追平合并误当成 goal 并入；改为要求合并提交的目标必须是 develop。
activatedAt: 2026-10-03T08:34:23.928Z
statusLog:
  - at: 2026-10-03T08:34:23.928Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-03 裁定激活 GOAL-028；goal-driver 分诊已判 activate，但其激活写入两轮均被 120s
      spawn 超时 SIGKILL（round 633/634），改由 CLI 执行同一激活（保真性闸照常运行）
  - at: 2026-10-03T12:15:17.828Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
  - at: 2026-10-03T15:42:44.126Z
    from: achieved
    to: active
    actor: cli
    reason: 人 2026-10-03 裁定「改判据并重开 321–323」：旧判据依赖 develop first-parent 链，真实 fan-in
      会把多数提交挤出该链（实测 32 条里 22 条），导致 AC-321 对直落 develop 的演练任务误判通过、AC-322/323 读到的并非
      goal 分支落地。改为基于祖先关系，只计经 goal 分支的落地，并排除 retired/superseded 的 goal
  - at: 2026-10-03T17:24:09.277Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-03T15:42:44.126Z
---
