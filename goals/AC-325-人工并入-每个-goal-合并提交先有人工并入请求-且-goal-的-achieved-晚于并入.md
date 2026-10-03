---
id: AC-325
title: 人工并入：每个 goal 合并提交先有人工并入请求，且 goal 的 achieved 晚于并入
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

  E=.quay/gate-events.jsonl

  ms=$(git log develop --merges --format='%H %ct %s' | grep -E 'merge:
  goal/GOAL-[0-9]+ into develop')

  [ -n "$ms" ] || { echo "NOT-EVALUATED: develop has no goal-branch merge commit
  yet" >&2; exit 3; }

  [ -s "$E" ] || { echo "NOT-EVALUATED: $E absent or empty" >&2; exit 3; }

  n=0

  while read -r h ct rest; do
    G=$(echo "$rest" | grep -oE 'goal/GOAL-[0-9]+' | head -1 | cut -d/ -f2)
    req=$(node -e '(() => { const fs = require("fs"); const lim = Number(process.argv[3]) * 1000; let n = 0;
      for (const l of fs.readFileSync(process.argv[1], "utf8").split("\n")) { if (!l.includes("goal-merge-request")) continue; let e; try { e = JSON.parse(l); } catch { continue; }
        if (e.gate === "goal-merge-request" && e.item_id === process.argv[2] && Date.parse(e.timestamp) < lim) n++; } console.log(n); })()' "$E" "$G" "$ct")
    if [ "$req" -lt 1 ]; then echo "CAUSE=goal-merge-without-request — $h merges goal/$G with no goal-merge-request event before it" >&2; exit 1; fi
    ach=$(fm goals/"$G"-*.md | awk '/^  - at:/{a=$3} /^    to: achieved$/{print a}' | tail -1 | tr -d '"')
    if [ -n "$ach" ] && [ "$(date -d "$ach" +%s)" -le "$ct" ]; then echo "CAUSE=achieved-before-merge — $G reached achieved at $ach, not after its merge commit $h" >&2; exit 1; fi
    n=$((n+1))
  done <<EOT1

  $ms

  EOT1

  echo "PASS: $n goal-branch merge(s), each preceded by a human merge request
  and not preceded by achieved"
expect: "exit 0 = develop 上（含不在 first-parent 链上的）每个 subject 形如「merge:
  goal/GOAL-NNN into develop」的合并提交，之前都有该 GOAL 的 goal-merge-request 事件，且该 GOAL 若已
  achieved 其时刻晚于合并提交；exit 1 = 有无请求的合并或 achieved 早于合并；exit 3 = 尚无 goal 合并提交。⛔ 不依赖
  first-parent：后续落地会把合并提交挤出该链。"
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」。
activatedAt: 2026-10-03T08:26:42.755Z
statusLog:
  - at: 2026-10-03T08:26:42.755Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-03T08:26:42.754Z
---
