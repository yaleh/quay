---
id: AC-323
title: 不重派：落到 goal 分支的任务此后不再被派发
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

  W=.quay/worker-round.jsonl

  [ -s "$W" ] || { echo "NOT-EVALUATED: $W absent or empty — dispatch carrier
  unreadable" >&2; exit 3; }

  pairs=""

  for G in $(live_goals); do pairs="$pairs$(via_landings "$G" | awk '{print $1"
  "$3}')

  "; done

  [ -n "$(printf '%s' "$pairs" | tr -d '[:space:]')" ] || { echo "NOT-EVALUATED:
  no task has landed via a goal branch yet" >&2; exit 3; }

  printf '%s' "$pairs" | node -e '(() => {
    const fs = require("fs");
    const want = new Map(fs.readFileSync(0, "utf8").split("\n").filter(Boolean).map((l) => { const [t, ct] = l.split(" "); return [t, Number(ct) * 1000]; }));
    const starts = new Map();
    for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n")) {
      if (!line.includes("in_flight_task_starts")) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      for (const [t, s] of Object.entries(r.in_flight_task_starts || {})) { if (want.has(t)) { if (!starts.has(t)) starts.set(t, new Set()); starts.get(t).add(s); } }
    }
    let ok = 0;
    for (const [t, landedMs] of want) {
      const ss = [...(starts.get(t) || [])].map((s) => Date.parse(s));
      if (!ss.some((s) => s <= landedMs)) continue;
      const after = ss.filter((s) => s > landedMs);
      if (after.length) { console.error("CAUSE=redispatched-after-goal-branch-landing — " + t + " dispatched " + after.length + " time(s) after it landed on its goal branch"); process.exit(1); }
      ok++;
    }
    if (!ok) { console.error("NOT-EVALUATED: no goal-branch landing has its own dispatch start in the carrier (zero would be vacuous)"); process.exit(3); }
    console.log("PASS: " + ok + " goal-branch landing(s) never re-dispatched");
  })()' "$W"
expect: exit 0 = 每个经 goal 分支落地、且在 worker-round 载体里能找到自身派发起点的任务，其落地时刻之后的派发起点数为
  0；落地只计经 goal 分支的（与 AC-321 同一分类）；exit 1 = 有任务在落地后再次被派发；exit 3 = 尚无经 goal
  分支的落地，或落地任务在载体中没有自身的派发记录（此时零是空转）。
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」；2026-10-09 收紧 goal_merges()
  选择器（gap-ac321-goal-merge-selector-matches-task-catchup-merge）：原宽正则同时命中「任务分支追平
  goal 分支」的合并（subject 含 goal/<id>、目标为 task 分支），且 Mg 用 tail -1 取到最旧一条 ⇒
  把那次追平合并误当成 goal 并入；改为要求合并提交的目标必须是 develop。
activatedAt: 2026-10-03T08:35:52.783Z
statusLog:
  - at: 2026-10-03T08:35:52.783Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-03 裁定激活 GOAL-028；goal-driver 分诊已判 activate，但其激活写入两轮均被 120s
      spawn 超时 SIGKILL（round 633/634），改由 CLI 执行同一激活（保真性闸照常运行）
  - at: 2026-10-03T12:52:45.313Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
  - at: 2026-10-03T15:37:35.440Z
    from: achieved
    to: active
    actor: cli
    reason: 人 2026-10-03 裁定「改判据并重开 321–323」：旧判据依赖 develop first-parent 链，真实 fan-in
      会把多数提交挤出该链（实测 32 条里 22 条），导致 AC-321 对直落 develop 的演练任务误判通过、AC-322/323 读到的并非
      goal 分支落地。改为基于祖先关系，只计经 goal 分支的落地，并排除 retired/superseded 的 goal
  - at: 2026-10-03T17:24:12.447Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-03T15:37:35.440Z
---
