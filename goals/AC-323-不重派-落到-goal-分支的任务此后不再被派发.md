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

  W=.quay/worker-round.jsonl

  [ -s "$W" ] || { echo "NOT-EVALUATED: $W absent or empty — dispatch carrier
  unreadable" >&2; exit 3; }

  bm=$(bm_goals); [ -n "$bm" ] || { echo "NOT-EVALUATED: no goal record carries
  branch: true yet" >&2; exit 3; }

  pairs=""

  for G in $bm; do pairs="$pairs$(landings "$G" | awk '{print $1" "$3}')

  "; done

  [ -n "$(printf '%s' "$pairs" | tr -d '[:space:]')" ] || { echo "NOT-EVALUATED:
  branch-mode goals have no landed task yet" >&2; exit 3; }

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
    if (!ok) { console.error("NOT-EVALUATED: no landed task has its own dispatch start in the carrier (zero would be vacuous)"); process.exit(3); }
    console.log("PASS: " + ok + " goal-branch landing(s) never re-dispatched");
  })()' "$W"
expect: exit 0 = 每个落到 goal 分支、且在 worker-round 载体里能找到自身派发起点的任务，其落地时刻之后的派发起点数为
  0；exit 1 = 有任务在落地后再次被派发；exit 3 = 尚无落地，或落地任务在载体中没有自身的派发记录（此时零是空转）。
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」。
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
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-03T08:35:52.782Z
---
