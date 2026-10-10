---
id: AC-324
title: 并入前可见：pre-merge AC 在 goal 并入 develop 之前就被判为 pass
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

  E=.quay/gate-events.jsonl

  [ -s "$E" ] || { echo "NOT-EVALUATED: $E absent or empty" >&2; exit 3; }

  merged=0

  for G in $(live_goals); do
    m=$(goal_merges "$G" | tail -1); [ -n "$m" ] || continue
    mct=$(echo "$m" | cut -d' ' -f2)
    pre=""; for ac in $(goal_acs "$G"); do fm goals/"$ac"-*.md | grep -qx 'phase: post-merge' || pre="$pre $ac"; done
    n=$(node -e '(() => { const fs = require("fs"); const acs = new Set(process.argv[2].split(" ").filter(Boolean)); const lim = Number(process.argv[3]) * 1000; let n = 0;
      for (const l of fs.readFileSync(process.argv[1], "utf8").split("\n")) { if (!l.includes("\"gate\":\"goal\"")) continue; let e; try { e = JSON.parse(l); } catch { continue; }
        if (acs.has(e.item_id) && e.verdict === "pass" && Date.parse(e.timestamp) < lim) n++; } console.log(n); })()' "$E" "$pre" "$mct")
    if [ "$n" -lt 1 ]; then echo "CAUSE=no-pre-merge-pass-before-merge — $G merged at $mct with zero pre-merge AC passes recorded before it" >&2; exit 1; fi
    merged=$((merged+1))
  done

  [ "$merged" -ge 1 ] || { echo "NOT-EVALUATED: no live branch-mode goal has
  merged into develop yet" >&2; exit 3; }

  echo "PASS: $merged merged goal(s) each had pre-merge AC passes before the
  merge"
expect: "exit 0 = 每个已并入的 branch-mode goal，在其合并提交之前至少有 1 次 pre-merge AC（无 phase:
  post-merge）的 goal gate pass；exit 1 = 有已并入的 goal 并入前零 pass；exit 3 = 尚无
  branch-mode goal 并入。"
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」；2026-10-09 收紧 goal_merges()
  选择器（gap-ac321-goal-merge-selector-matches-task-catchup-merge）：原宽正则同时命中「任务分支追平
  goal 分支」的合并（subject 含 goal/<id>、目标为 task 分支），且 Mg 用 tail -1 取到最旧一条 ⇒
  把那次追平合并误当成 goal 并入；改为要求合并提交的目标必须是 develop。
activatedAt: 2026-10-03T08:07:04.654Z
statusLog:
  - at: 2026-10-03T08:07:04.654Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-10-03T20:21:11.960Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-03T08:07:04.654Z
---
