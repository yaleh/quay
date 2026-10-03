---
id: AC-328
title: 并入前试用：live-probe 类 pre-merge AC 在预览实例上 pass 之后才并入
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

  E=.quay/gate-events.jsonl

  [ -s "$E" ] || { echo "NOT-EVALUATED: $E absent or empty" >&2; exit 3; }

  grep -q '"evaluationRoot"' "$E" || { echo "NOT-EVALUATED: goal gate events do
  not record evaluationRoot yet — preview evaluation is unreadable" >&2; exit 3;
  }

  bm=$(bm_goals); counted=0

  for G in $bm; do
    m=$(goal_merges "$G" | tail -1); [ -n "$m" ] || continue
    mct=$(echo "$m" | cut -d' ' -f2)
    lp=""; for ac in $(goal_acs "$G"); do f=$(ls goals/"$ac"-*.md); sed -n '2,/^---$/p' "$f" | grep -qx 'phase: post-merge' && continue; grep -q 'quay.ts serve' "$f" && lp="$lp $ac"; done
    [ -n "$lp" ] || continue
    n=$(node -e '(() => { const fs = require("fs"); const acs = new Set(process.argv[2].split(" ").filter(Boolean)); const lim = Number(process.argv[3]) * 1000; const main = process.argv[4]; let n = 0;
      for (const l of fs.readFileSync(process.argv[1], "utf8").split("\n")) { if (!l.includes("evaluationRoot")) continue; let e; try { e = JSON.parse(l); } catch { continue; }
        const r = e.payload && e.payload.evaluationRoot; if (acs.has(e.item_id) && e.verdict === "pass" && r && r !== main && Date.parse(e.timestamp) < lim) n++; } console.log(n); })()' "$E" "$lp" "$mct" "$root")
    if [ "$n" -lt 1 ]; then echo "CAUSE=live-probe-not-passed-on-preview — $G merged without any live-probe AC passing on its preview instance first" >&2; exit 1; fi
    counted=$((counted+1))
  done

  [ "$counted" -ge 1 ] || { echo "NOT-EVALUATED: no merged branch-mode goal with
  a pre-merge live-probe AC yet" >&2; exit 3; }

  echo "PASS: $counted merged goal(s) passed live-probe ACs on their preview
  instance before merging"
expect: exit 0 = 每个带 live-probe pre-merge AC 的已并入 goal，其合并提交之前至少有 1 次这类 AC 的
  pass，且该事件 payload.evaluationRoot 不是主检出；exit 1 = 有 goal 并入前没有在预览实例上的 live-probe
  pass；exit 3 = gate 事件尚不记录 evaluationRoot，或尚无合格的已并入 goal。
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」。
activatedAt: 2026-10-03T08:14:57.254Z
statusLog:
  - at: 2026-10-03T08:14:57.254Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-03T08:14:57.254Z
---
