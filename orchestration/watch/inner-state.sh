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

  # 结构判据，不匹配提交消息的散文。2026-08-02 第一次发声即误报：
  # 外层自己一条讨论 revert 的提交被 *[Rr]evert* 命中。会叫狼来了的检测器最后没人理。
  head=$(git log -1 --format='%h' 2>/dev/null)
  if [ "$head" != "$prev_head" ] && [ -n "$prev_head" ]; then
    # (a) 真正的 revert：git 自己在 body 里生成 "This reverts commit <sha>"
    if git show "$head" --format=%B -s 2>/dev/null | grep -qi '^This reverts commit'; then
      echo "REVERT master: $(git log -1 --format='%h %s' "$head") | $(git show "$head" --shortstat --format= | tr -d '\n')"
    else
      # (b) 大规模净删除：结构上可测，且能捕获「大批工作消失」而不依赖措辞
      del=$(git show "$head" --shortstat --format= 2>/dev/null | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+')
      ins=$(git show "$head" --shortstat --format= 2>/dev/null | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+')
      if [ -n "$del" ] && [ "$del" -gt 1000 ] && [ "$del" -gt $(( ${ins:-0} * 3 )) ]; then
        echo "MASSDELETE master: $(git log -1 --format='%h %s' "$head") | -${del} +${ins:-0}"
      fi
    fi
  fi
  prev_head="$head"
  sleep 60
done
