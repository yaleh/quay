#!/usr/bin/env bash
# 外层对内层的事件式监测。每行 stdout 是一个事件。
# 只在「状态转变」时发声——不刷屏，不把常规推进当事件。
cd /home/yale/work/quay || exit 1
prev_tasks=""; prev_head=""; alerted=""
while true; do
  snap=$(node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json 2>/dev/null \
    | python3 -c '
import sys,json,time
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
ip=d.get("inProgress",[])
print("TASKS "+"|".join(sorted(t["taskId"] for t in ip)))
for t in ip:
    m=(time.time()*1000-t["startedAtMs"])/60000
    if m>90: print("OVER90 %s %.0fm"%(t["taskId"],m))
for t in d.get("orphaned",[]):
    print("ORPHAN %s"%(t.get("taskId","?")))
' 2>/dev/null) || true
  [ -z "$snap" ] && { sleep 60; continue; }

  tasks=$(printf '%s\n' "$snap" | sed -n 's/^TASKS //p')
  if [ "$tasks" != "$prev_tasks" ] && [ -n "$prev_tasks$tasks" ]; then
    if [ -z "$tasks" ]; then
      echo "IDLE 内层无在飞任务（上一批: ${prev_tasks:-none}）—— 可能在等裁定"
    else
      echo "START 在飞任务变为: $tasks"
    fi
    prev_tasks="$tasks"
  fi

  printf '%s\n' "$snap" | grep -E '^(OVER90|ORPHAN)' | while read -r line; do
    key=$(echo "$line" | cut -d' ' -f1-2)
    case "$alerted" in *"$key"*) ;; *) echo "$line"; esac
  done
  alerted="$alerted $(printf '%s\n' "$snap" | grep -E '^(OVER90|ORPHAN)' | cut -d' ' -f1-2 | tr '\n' ' ')"

  head=$(git log -1 --format='%h %s' 2>/dev/null)
  if [ "$head" != "$prev_head" ] && [ -n "$prev_head" ]; then
    case "$head" in
      *[Rr]evert*|*--ours*|*--theirs*|*force*) echo "RISKY master 新提交: $head" ;;
    esac
  fi
  prev_head="$head"
  sleep 60
done
