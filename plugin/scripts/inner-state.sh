#!/usr/bin/env bash
# 外层对内层的事件式监测。每行 stdout 是一个事件。
# 只在「状态转变」时发声——不刷屏，不把常规推进当事件。
#
# 纯读契约（gap-telemetry-report-writes-and-deadlocks-readiness）：本脚本每 60 秒调一次
# `fast-mode-telemetry.ts --report --json`。若 `--report` 写文件，任何提交后 60 秒内工作树必
# 脏，restart-readiness-check.sh 的「工作树干净」硬检查永远不通过 → `.halt` 永不可解。
# 观测命令不得改变被观测对象。`--report` 已是纯读（写只走显式 `--snapshot`）；此处禁止加入
# 任何写路径。本脚本除 `git log`/`git show` 外不写任何文件。
# INNER_STATE_WORK_ROOT overrides the monitored checkout (test seam for inner-state.test.mjs's
# behavioral BLOCKED test, which must resolve plugin/scripts/inner-blocked-signal.ts pre-merge).
# Production callers never set it → default (the main checkout), behavior unchanged.
# 默认根自定位（gap-loop-mechanism-lives-outside-the-package-and-cannot-ship）：本文件已迁入
# plugin/scripts/（旧路径 orchestration/watch/ 已删，调用方全部改用本路径）。按 BASH_SOURCE
# 推导工作根，不再硬编码任何绝对仓库路径 —— 既经得起「quay 开发树改名」负控制，也随
# quay-init --loop 铺到目标项目后直接可用。
_INNER_STATE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_INNER_STATE_DEFAULT_ROOT="$(cd "${_INNER_STATE_SCRIPT_DIR}/../.." && pwd)"
cd "${INNER_STATE_WORK_ROOT:-$_INNER_STATE_DEFAULT_ROOT}" || exit 1
prev_tasks=""; prev_head=""; alerted=""; first=1

# ── 内层存在性阻塞信号（gap-no-explicit-blocked-signal-from-inner-layer, AC6）──────────────
# 内层停下等裁定时主动写 .quay/inner-blocked.json（只经 inner-blocked-signal.ts，不手写）；
# 外层监视该路径。文件出现 → BLOCKED（带 reason + question，外层不必读屏就能开始判断）；
# 文件消失 → UNBLOCKED（内层已恢复）。这是存在性信号，不是从缺席推断。
# 纯读契约：`--read` 只读不写，inotifywait 只消费内核事件，两者都不违反本脚本的「除 git log/git
# show 外不写任何文件」约束。prev_blocked 存的是完整记录 JSON——文件消失（空）即转变。
prev_blocked=""
check_blocked_state() {
  local root="${1:-$PWD}"
  if [ -f "$root/.quay/inner-blocked.json" ]; then
    b=$(node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --read --root "$root" 2>/dev/null || true)
    if [ -n "$b" ] && [ "$b" != "$prev_blocked" ]; then
      reason=$(printf '%s' "$b" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("reason","?"))' 2>/dev/null || echo "?")
      question=$(printf '%s' "$b" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("question","?"))' 2>/dev/null || echo "?")
      echo "BLOCKED reason=$reason question=$question"
      prev_blocked="$b"
    fi
  elif [ -n "$prev_blocked" ]; then
    echo "UNBLOCKED 内层恢复（存在性阻塞信号清除）"
    prev_blocked=""
  fi
}

# 测试接缝（inner-state.test.mjs）：对覆盖的 root 跑一次 check_blocked_state 然后退出，让 BLOCKED
# 事件输出可被行为性验证，不必跑无限循环。生产调用不设 INNER_STATE_BLOCK_ROOT，行为不变。
if [ -n "${INNER_STATE_BLOCK_ROOT:-}" ]; then
  check_blocked_state "$INNER_STATE_BLOCK_ROOT"
  exit 0
fi

last_snap=0
while true; do
  # 阻塞信号存在性检查每一轮都跑，且在任何 snap 守卫之前（REFUTE 轮 1 MINOR 3：`--report` 失败时
  # 不得顺带丢掉阻塞监测——那是本脚本唯一为本任务新增的机制）。
  check_blocked_state

  # 遥测派生检查保持 ~60s 节奏（REFUTE 轮 1 MINOR 4）：inotifywait 会对 .quay/ 的任何事件唤醒，
  # 若每唤醒都重跑 --report 聚合，闸门活动下会变成忙循环。用时间闸把 snap 限制为 ≤每 55s 一次；
  # 阻塞信号仍秒级（走下方 inotifywait 的独立路径，不经 snap）。blk- 事件是阻塞等待记录不是
  # orphaned 任务（AC7 的 blocked 段），从 ORPHAN 里滤掉——防御 master 侧旧聚合的误报（REFUTE 轮 1 MAJOR 2）。
  if [ $(( $(date +%s) - last_snap )) -ge 55 ]; then
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
    if str(t.get("runId","")).startswith("blk-"): continue
    print("ORPHAN %s"%(t.get("taskId","?")))
' 2>/dev/null) || true
    if [ -n "$snap" ]; then
      tasks=$(printf '%s\n' "$snap" | sed -n 's/^TASKS //p')
      if [ "$tasks" != "$prev_tasks" ] && [ -n "$prev_tasks$tasks" ]; then
        if [ -z "$tasks" ]; then
          # 只作「批次结束」用。停摆检测已移交 inner-stalled.sh —— 本信号实测只覆盖 46% 的空转
          # （2026-08-02，orchestration/throughput-decomposition.md），且漏掉最大的一次 25.7 分钟。
          echo "BATCH-END 在飞任务清空（上一批: ${prev_tasks:-none}）"
        elif [ "$first" = 1 ]; then
          # 重挂时的基线读数，不是状态转变。每次冷启动都会出现——标对而不是隐藏。
          # 带上解析出的工作根（$PWD，cd 已落到 INNER_STATE_WORK_ROOT 或 BASH_SOURCE 推导根）：
          # 「挂错目标」在挂载当时就看得见，而不是 18 小时后（gap-nothing-checks-whether-the-monitor-is-mounted-or-aimed-right, AC8）。
          echo "INIT 挂载时的在飞任务: $tasks | work_root=$PWD"
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
      first=0
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
      last_snap="$(date +%s)"
    fi
  fi

  # 阻塞信号的秒级延迟（AC6）：inotifywait 监视 .quay/（inner-blocked.json 的宿主）替代裸 sleep，
  # 内层写/删该文件的时刻事件立即返回，check_blocked_state 在 ~1s 内发出 BLOCKED/UNBLOCKED——
  # 从最多 20 分钟（tick）或 60s（轮询）降到秒级。inotifywait 无副作用（纯读内核事件），
  # 不违反纯读契约；目录不存在或 inotifywait 缺失时退化为轮询。
  if command -v inotifywait >/dev/null 2>&1 && [ -d .quay ]; then
    ev=$(inotifywait -q -e create,delete,close_write,moved_to,moved_from,delete_self \
      --format '%e %f' --timeout 55 .quay/ 2>/dev/null) || true
    if printf '%s' "$ev" | grep -q 'inner-blocked.json'; then
      check_blocked_state
    fi
  else
    sleep 55
  fi
done
