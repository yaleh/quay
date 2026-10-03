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

  dev_at() { git reflog show --date=unix --format='%H %gd' refs/heads/develop |
  sed -E 's/ [^ ]*@\{([0-9]+)\}$/ \1/' | awk -v t="$1" '$2<=t {print $1; exit}';
  }

  checked=0

  for G in $bm; do
    s=$(bm_start "$G"); L=$(landings "$G")
    while read -r t c ct; do
      [ -n "$t" ] || continue
      base=""
      while read -r t2 c2 ct2; do [ -n "$t2" ] && [ "$c2" != "$c" ] && git merge-base --is-ancestor "$c2" "$c" && { [ -z "$base" ] || git merge-base --is-ancestor "$base" "$c2"; } && base=$c2; done <<EOT
  $L

  EOT
      [ -n "$base" ] || base=$(dev_at "$s")
      [ -n "$base" ] || { echo "NOT-EVALUATED: develop reflog has no entry at or before $G opted in" >&2; exit 3; }
      tx=""
      for x in $(git rev-list --merges "$base..$c"); do for p in $(git rev-list --parents -n1 "$x" | cut -d' ' -f2-); do git merge-base --is-ancestor "$p" develop && ! git merge-base --is-ancestor "$p" "$base" && { tx=$(git log -1 --format=%ct "$x"); break 2; }; done; done
      [ -n "$tx" ] || tx=$(git log --reverse --format=%ct "$base..$c" | head -1)
      d=$(dev_at "$tx")
      [ -n "$d" ] || continue
      if ! git merge-base --is-ancestor "$d" "$c"; then echo "CAUSE=landing-missed-develop-catch-up — $t on goal/$G lacks develop tip $d that was current at its catch-up point" >&2; exit 1; fi
      checked=$((checked+1))
    done <<EOT
  $L

  EOT

  done

  [ "$checked" -ge 1 ] || { echo "NOT-EVALUATED: no goal-branch landing could be
  checked against the develop reflog" >&2; exit 3; }

  echo "PASS: $checked goal-branch landing(s) each contained develop as of their
  catch-up point"
expect: exit 0 = 每次 goal 分支落地的提交都以 develop 在其追平时刻（该次落地内合入 develop 的 merge 提交时间；无
  merge 时取该次落地最早提交时间）的 tip 为祖先，tip 取自 develop reflog；exit 1 = 有落地缺了当时的 develop
  tip；exit 3 = 无可核对的落地或 reflog 不覆盖。
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」。
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
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-03T08:34:23.927Z
---
