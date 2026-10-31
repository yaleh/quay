#!/usr/bin/env bash
# dead-loop-check.sh — L2 持续健康判据：循环【在转】，不只是【装了】
# (tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed, AC1-AC4).
#
# 判据（Contract band）——loop_alive = alive：
#   最近 N 分钟内，目标项目 outer/inner transcript 有【新的 user 消息】 或 项目 git 有【提交】
#   ——任一存在 ⇒ alive；都无 ⇒ dead（dead-loop）。
#   transcript user 消息 = ~/.claude/projects/<项目slug>/*.jsonl 的顶层 type=user 记录
#     （取全部会话的最大时刻）。type=user 不仅含【外部输入】（send-keys / cron 注入 / 人打字），
#     也含【工具回执】（tool_result 以 user 消息写回）——所以一个在干活的循环（频繁工具调用）
#     会持续写 type=user，与「卡死在纯思考」（无工具调用、无提交）自然分开。
#   git 提交 = 循环产出过工作（inner 落地 / outer 提交 / 处置提交）。
#   已知盲区（诚实写明，任何点状判据都有）：一个会话若【纯思考且无任何工具调用】超过 N 分钟且
#     无提交，会与 dead-loop 同形——这是 L2 判据的固有分辨率极限；窗口 N 可调（默认 30 分钟 ≥
#     周期锚点 20 分钟，健康循环必然落一次驱动或提交）。
#   invariant liveness_independent_of_backlog = 1 —— 判据【不碰 backlog】：
#     队列空（queue-empty）与没人驱动（dead-loop）从此可区分：
#       队列空 + 有驱动/提交 = 健康空闲（alive）
#       队列满 + 无驱动/提交 = 没人驱动（dead）
#
# 出处：SPEC-complete-delivery-surface-2026-08-05.md 第 5 节 层次二（持续健康检查——动态、
#   运转期间周期性跑）。L1（交付完整性）判据检查「仪器铺没铺」；本判据补「循环转没转」——
#   一个从未运行过的循环与一个健康运行的循环在所有 L1 判据下【完全一样】（meta-cc/archguard
#   实测 29 小时零进展，quay-init + verify-* 却全绿 + 自报健康），只有 L2 的 transcript-user-
#   消息 + git-提交时间窗能把两者分开。
#
# 用法：
#   bash plugin/scripts/dead-loop-check.sh [--root <dir>] [--window <N 分钟>] [--json]
#     --root            目标项目根（git 仓库；默认 = 本仓库）
#     --window          时间窗分钟数（默认 30；与 session-liveness.sh OVERDUE_MIN 同量级；
#                       周期锚点 20 分钟 ⇒ 30 分钟窗内健康循环必然至少落一次驱动或提交）
#     --transcript-dir  显式 transcript 目录（测试接缝；默认 $HOME/.claude/projects/<slug>）
#     --json            输出 JSON（逐字段归因，供机械消费）
# 输出（stdout 可解析字段）：
#   loop_alive=alive|dead
#   has_transcript_user_msg=0|1
#   has_git_commit=0|1
#   window_minutes=N
#   liveness_independent_of_backlog=1
#
# Contract measure: `bash plugin/scripts/dead-loop-check.sh` -> stdout's loop_alive 字段
#   （alive 或 dead）。Contract invoke: `grep -rn 'transcript\|提交\|N 分钟' <dead-loop check>`
#   ——transcript / 提交 / N 分钟 三词都在本文件头里（判据的构成信号）。
#
# 测试：plugin/test/dead-loop-check.test.mjs（AC1 dead 正控 + AC2 负向 + AC6 node:test）。

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

# ── 参数 ──────────────────────────────────────────────────────────────────────────────────────────
_dlc_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
root="${DEAD_LOOP_ROOT:-}"
window_min="${DEAD_LOOP_WINDOW_MIN:-30}"
json=0
check_running=0
transcript_dir="${DEAD_LOOP_TRANSCRIPT_DIR:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --root) root="$2"; shift 2 ;;
    --root=*) root="${1#--root=}"; shift ;;
    --window) window_min="$2"; shift 2 ;;
    --window=*) window_min="${1#--window=}"; shift ;;
    --transcript-dir) transcript_dir="$2"; shift 2 ;;
    --transcript-dir=*) transcript_dir="${1#--transcript-dir=}"; shift ;;
    --json) json=1; shift ;;
    --check-running) check_running=1; shift ;;
    -h|--help)
      sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) shift ;;
  esac
done

# 非负整数校验（防御：传给窗口算术的值必须是数字）。
case "$window_min" in
  ''|*[!0-9]*) echo "dead-loop-check: --window 必须是分钟数（非负整数），收到 '${window_min}'" >&2; exit 2 ;;
esac

if [ -z "$root" ]; then
  root="$(cd "${_dlc_script_dir}/../.." && pwd -P)"
fi
# 默认 transcript 目录 = $HOME/.claude/projects/<slug>（slug = 根路径 / -> -，同 session-liveness.sh）。
if [ -z "$transcript_dir" ]; then
  transcript_dir="${HOME}/.claude/projects/$(printf '%s' "$root" | tr '/' '-')"
fi

# ── 纯函数 ────────────────────────────────────────────────────────────────────────────────────────

# dl_latest_user_msg_epoch <transcript> —— 该 transcript 最近一条顶层 type=user 记录的时间戳转
# epoch；输出空 = 取不到（无记录/解析失败）。模式 `"type":"user"` 只命中顶层：content 块的类型是
# text/thinking/tool_use/tool_result，message 对象的类型是 message——与 session-liveness.sh 同源。
# 性能：先只扫文件尾 500 行（最近一条 user 消息在活跃会话里必然近文件尾；tail 界 500 与
# session-liveness.sh 的 transcript_last_message_type 同约定），无匹配再全扫兜底。
dl_latest_user_msg_epoch() {
  local t=$1 line ts
  line=$(tail -n 500 "$t" 2>/dev/null | grep '"type":"user"' | tail -1)
  [ -n "$line" ] || line=$(grep '"type":"user"' "$t" 2>/dev/null | tail -1)
  [ -n "$line" ] || return 1
  ts=$(printf '%s' "$line" | grep -o '"timestamp":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$ts" ] || return 1
  date -d "$ts" +%s 2>/dev/null || return 1
}

# dl_latest_user_msg_across <dir> <now> <window_secs> —— 项目 transcript 目录下全部 *.jsonl
# （主会话 + subagents）的最近 user 消息 epoch 的最大值（= 该项目任一循环会话最近收到驱动的时刻）。
# 输出 0 = 目录不存在或没有任何可取到的 user 消息记录。
# 性能（实测 quay 项目 transcript 目录 1.4G / 6956 文件——全扫不可用）：
#   * `find -newermt "@<now-window>"` 只列 mtime 落在窗口内的文件——transcript 是追加写、写即更新
#     mtime，所以 mtime 早于窗口的文件不可能含窗口内的 user 消息，直接跳过；
#   * `-type f` 排除同名目录。窗口内活跃文件通常只有个位数，逐个 tail-grep 便宜。
dl_latest_user_msg_across() {
  local dir=$1 now=$2 window_secs=$3 max=0 ts f cutoff
  [ -d "$dir" ] || { echo 0; return 0; }
  cutoff=$(( now - window_secs ))
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if ts=$(dl_latest_user_msg_epoch "$f") && [ -n "$ts" ] && [ "$ts" -gt "$max" ] 2>/dev/null; then
      max=$ts
    fi
  done < <(find "$dir" -type f -name '*.jsonl' -newermt "@${cutoff}" 2>/dev/null)
  echo "$max"
}

# dl_latest_commit_epoch <root> —— 项目 git HEAD 提交时刻（epoch）。0 = 非 git 仓库/无提交。
dl_latest_commit_epoch() {
  local r=$1
  git -C "$r" log -1 --format=%ct 2>/dev/null || echo 0
}

# dl_has_start <root> —— 这个循环「启动过」吗（输出 1/0）。证据 = cold-start step 5 写的 driver 注册
# （.quay/loop-driver.jsonl）+ inner 派发写的 task-start 遥测（.workflow-events/*.jsonl）。
# 为什么需要它：transcript 活动（loop_alive=alive）只说明「有会话在写 transcript」，无法区分
# 「冷启动 driver 会话在跑 step 1-9」vs「真 loop 在跑」——fresh cold-start 时冷启动外层会话自己
# 的 transcript 正被写入，会被误判成 loop 在跑（gap-dead-loop-check-fresh-coldstart-false-running）。
# 只有 driver 注册 / task-start 遥测能证明 loop 已真正起过（或正在派发）。--check-running 的 alive
# 与 stopped 分支共用同一佐证，避免两处各写一份漂移。
dl_has_start() {
  local r=$1
  if [ -f "$r/.quay/loop-driver.jsonl" ]; then echo 1; return 0; fi
  if ls "$r"/.workflow-events/*.jsonl >/dev/null 2>&1; then
    if grep -l 'task-start\|"task-start"' "$r"/.workflow-events/*.jsonl >/dev/null 2>&1; then
      echo 1; return 0
    fi
  fi
  echo 0
}

# ── 判定 ──────────────────────────────────────────────────────────────────────────────────────────
now=$(date +%s)
window_secs=$(( window_min * 60 ))

# 1. transcript user 消息在窗内？
latest_user=$(dl_latest_user_msg_across "$transcript_dir" "$now" "$window_secs")
has_transcript=0
if [ -n "$latest_user" ] && [ "$latest_user" != "0" ]; then
  user_age=$(( now - latest_user ))
  [ "$user_age" -le "$window_secs" ] && has_transcript=1
fi

# 2. git 提交在窗内？
latest_commit=$(dl_latest_commit_epoch "$root")
has_commit=0
if [ -n "$latest_commit" ] && [ "$latest_commit" != "0" ]; then
  commit_age=$(( now - latest_commit ))
  [ "$commit_age" -le "$window_secs" ] && has_commit=1
fi

# 3. 融合（Contract band）：任一存在 ⇒ alive；都无 ⇒ dead。与 backlog 空无关（invariant）。
if [ "$has_transcript" = "1" ] || [ "$has_commit" = "1" ]; then
  loop_alive=alive
else
  loop_alive=dead
fi

# ── --check-running 模式（cold-start 已停转分支，AC1-AC4）─────────────────────────────────────
# 回答「循环现在在不在转」，不是「装没装好」——L1（六键/可观测后果）测铺没铺，本分支补 L2（在不在转）。
# 停转时给【可执行下一步】（restart / human-needed / backlog-empty），绝不报「已完成」。
# 输出字段（Contract measure：cold_start_state / stopped_reason / next_step 可解析）：
#   cold_start_state=running|stopped
#   stopped_reason=never-started|queue-empty|waiting-human|unknown   （仅 stopped 时）
#   next_step=none|restart|human-needed|backlog-empty
# 复用本脚本的 L2 判据（transcript user 消息 + git 提交时间窗）——不新造 liveness 信号。
# 交叉标注：tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md（AC4）。
# 收紧（gap-dead-loop-check-fresh-coldstart-false-running）：loop_alive=alive 不能直接判 running——
# fresh cold-start 时冷启动外层会话自己的 transcript 正被写入（step 1-9），会被误判成 loop 在跑。
# alive 需 driver/telemetry 佐证（dl_has_start）区分「真 loop 在跑」vs「冷启动会话活动」：
#   alive + has_start ⇒ running；alive + 无 has_start ⇒ stopped/never-started。
if [ "$check_running" = "1" ]; then
  if [ "$loop_alive" = "alive" ]; then
    # transcript/提交有活动——但可能只是 fresh cold-start 的冷启动 driver 会话自己在写 transcript
    # （step 1-9），不是真 loop。必须用 driver/telemetry 佐证区分：
    #   alive + has_start ⇒ 真 loop 在跑（running）
    #   alive + 无 has_start ⇒ fresh cold-start（never-started）——冷启动会话活动 ≠ loop 在跑。
    if [ "$(dl_has_start "$root")" = "1" ]; then
      # running 不输出 stopped_reason —— 保证 Contract measure `grep -c 'stopped\|dead-loop\|已停'`
      # 只在 stopped 时 >= 1（running 时 0），band「已停转被识别」不因字段名被平凡满足。
      echo "cold_start_state=running"
      echo "next_step=none"
    else
      # 从未启动：装好了但从没真正起过——下一步是【起起来】（对 cold-start 而言是首次启动，非 resume）。
      # （此处 loop_alive=alive 只因冷启动会话自己的 transcript 活动，不是真 loop。）
      echo "cold_start_state=stopped"
      echo "stopped_reason=never-started"
      echo "next_step=restart"
    fi
  else
    # 已停转——区分「从未启动」vs「启动过但停了」，并给可执行下一步。
    # has_start：这个循环启动过吗？证据 = cold-start step 5 写的 driver 注册 + inner 派发写的
    # task-start 遥测（与 alive 分支共用 dl_has_start，同一佐证，避免两处各写一份漂移）。
    has_start=$(dl_has_start "$root")
    if [ "$has_start" = "0" ]; then
      # 从未启动：装好了但从没真正起过——下一步是【起起来】（对 cold-start 而言是首次启动，非 resume）。
      echo "cold_start_state=stopped"
      echo "stopped_reason=never-started"
      echo "next_step=restart"
    else
      # 启动过但停了——按 backlog 状态分类为什么停。
      needs_human=$(grep -lE '^status:[[:space:]]*needs-human' "$root"/tasks/*.md 2>/dev/null | wc -l | tr -d ' ')
      has_work=$(grep -lE '^status:[[:space:]]*(ready|todo)' "$root"/tasks/*.md 2>/dev/null | wc -l | tr -d ' ')
      if [ "$needs_human" -gt 0 ]; then
        # 等人：卡在 needs-human / 等人给方向（archguard backlog 见底 + TASK-49 凭据/方向，真需要人）。
        echo "cold_start_state=stopped"
        echo "stopped_reason=waiting-human"
        echo "next_step=human-needed"
      elif [ "$has_work" -eq 0 ]; then
        # 队列空：backlog 见底，没活可干——不是「已完成」，要人给新方向/新任务。
        echo "cold_start_state=stopped"
        echo "stopped_reason=queue-empty"
        echo "next_step=backlog-empty"
      else
        # 有活但没人驱动：driver（cron/session）死了——重启循环。
        echo "cold_start_state=stopped"
        echo "stopped_reason=unknown"
        echo "next_step=restart"
      fi
    fi
  fi
  # 供 Contract measure 识别「已停转」的信号词：cold_start_state=stopped 与 stopped_reason 已含 stopped。
  # 不再落到下方旧输出（第二个实现体），避免字段串扰。
  exit 0
fi

# ── 输出（Contract measure：loop_alive 字段可解析）──────────────────────────────────────────────
echo "loop_alive=${loop_alive}"
echo "has_transcript_user_msg=${has_transcript}"
echo "has_git_commit=${has_commit}"
echo "window_minutes=${window_min}"
echo "liveness_independent_of_backlog=1"
if [ "$json" = "1" ]; then
  printf '{"loop_alive":"%s","has_transcript_user_msg":%s,"has_git_commit":%s,"window_minutes":%s,"liveness_independent_of_backlog":1,"transcript_dir":"%s","root":"%s"}\n' \
    "$loop_alive" "$has_transcript" "$has_commit" "$window_min" \
    "$(printf '%s' "$transcript_dir" | sed 's/"/\\"/g')" \
    "$(printf '%s' "$root" | sed 's/"/\\"/g')"
fi
# dead-loop-check.sh — L2 continuous-health DEAD-LOOP criterion
# (tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed).
#
# PROBLEM IT FIXES: every standing criterion answers "was the instrument laid down" (L1). None
# answers "is the loop ACTUALLY RUNNING" (L2 continuous health, SPEC-complete-delivery-surface
# §5 level 2). A NEVER-RUN loop and a HEALTHY-RUNNING loop look COMPLETELY IDENTICAL under all
# existing criteria — measured: meta-cc/archguard outer/inner got ZERO drives since setup (last
# commits 08-04 02:06/01:57 = 29h zero progress) yet quay-init complete + verify-installed-
# executables + verify-referenced-landed ALL green. This script is the minimal viable
# dead-loop criterion:
#
#   DEAD-LOOP  iff  (no NEW user message in any target transcript in the last N 分钟)
#               AND (no git commit in the last N 分钟)
#   — INDEPENDENT of backlog emptiness: queue-empty (healthy idle) vs nobody-driving (dead-loop)
#   are TWO STATES that every existing criterion confounds. This check keeps them separate.
#
# The two signals are the SAME family the session-liveness monitor / /live observation already
# use (transcript user-message timestamps + git commit time), but THIS criterion combines them
# into a standing L2 check that ships with the loop.
#
# ── Verdict (the ## Contract `measure` loop_alive) ───────────────────────────────────────────
#   loop_alive = alive  iff  最近 N 分钟 transcript 有新的 user 消息 或 git 有提交（任一存在）
#   loop_alive = dead   iff  最近 N 分钟 transcript 无 user 消息 且 git 无提交（都无）
#
# ── Invariant ────────────────────────────────────────────────────────────────────────────────
#   liveness_independent_of_backlog = 1 — this check NEVER reads the task store / backlog /
#   ready pool. Queue emptiness is deliberately NOT an input: a healthy idle loop (queue empty)
#   still keeps driving its own ticks (commits), so it stays alive; a dead loop (nobody driving)
#   has neither commits nor transcript user messages no matter how full the backlog is.
#
# Usage:
#   bash plugin/scripts/dead-loop-check.sh \
#       --root <repo-root> \
#       [--transcript <name> <path> ...] \
#       [--window-min <N>] \
#       [--selfcheck] [--help]
#
# stdout (machine-readable — `loop_alive` is the Contract measure field):
#   loop_alive: alive|dead
#   git_last_commit_min: <minutes|->      (age of HEAD commit; "-" when no git / no commits)
#   transcript_last_user_min: <minutes|-> (one line per --transcript, named)
#   window_min: <N>
#   alive_signals: <git-commit|transcript-user|none>
#
# Exit: 0 ALWAYS (a verdict is data, not an error — the caller decides what to do with dead).
#
# Env/test seams:
#   DEAD_LOOP_ROOT          override repo-root self-location (hermetic tests)
#   DEAD_LOOP_WINDOW_MIN    default window (same as --window-min)
#   --selfcheck             hermetic positive+negative controls (AC1 dead / AC2 alive), exits 0/1

set -uo pipefail

# ── Self-locate (same BASH_SOURCE convention as session-liveness.sh / inner-state.sh) ─────────
REPO_ROOT="${DEAD_LOOP_ROOT:-}"
if [ -z "$REPO_ROOT" ]; then
  _dl_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  REPO_ROOT="$(cd "$_dl_script_dir/../.." && pwd -P)"
fi

WINDOW_MIN="${DEAD_LOOP_WINDOW_MIN:-30}"

# ── transcript_last_user_epoch — 目标 transcript 里最近一条 type=user 记录的时间戳转 epoch ───
# 「最近的 user 消息」= 最近一条顶层 `"type":"user"` 记录的 timestamp。与 session-liveness.sh 的
# last_user_input_epoch 同源（Claude Code 的工具回执也是 type=user 记录，活跃循环在推进）。
# 输出空 = 取不到（transcript 不存在 / 无 user 记录 / 解析失败）——该 transcript 不算 alive 信号。
transcript_last_user_epoch() {
  local t=$1 line ts
  [ -e "$t" ] || { return 1; }
  line=$(grep '"type":"user"' "$t" 2>/dev/null | tail -1)
  [ -n "$line" ] || { return 1; }
  ts=$(printf '%s' "$line" | grep -o '"timestamp":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$ts" ] || { return 1; }
  date -d "$ts" +%s 2>/dev/null || return 1
}

# ── git_last_commit_epoch — 项目 git 最近一次提交的 committer 时间戳（epoch）───
# 用 `git log -1 --format=%ct`（committer 时间），不解析散文格式。无 git / 无提交 → 空。
git_last_commit_epoch() {
  local root=$1 ts
  ts=$(git -C "$root" log -1 --format=%ct 2>/dev/null || echo "")
  [ -n "$ts" ] && printf '%s\n' "$ts" || return 1
}

# ── epoch_to_age_min — epoch → 距今分钟数（<0 钳为 0；空输入 → "-"）──────────────────────────
epoch_to_age_min() {
  local ep=$1 now age
  [ -n "$ep" ] || { printf '%s\n' "-"; return; }
  now=$(date +%s)
  age=$(( (now - ep) / 60 ))
  [ "$age" -lt 0 ] && age=0
  printf '%s\n' "$age"
}

# ── selfcheck — hermetic AC1/AC2 controls（Contract 的 control 逐字照搬）─────────────────────
#   control 1（AC1 dead）：构造无驱动（transcript 无新 user 消息）+ 无提交项目 ⇒ 判 dead
#   control 2（AC2 负向）：队列空（无任务）但有驱动/提交 ⇒ 判 alive
# 自包含：全部在临时目录，不碰真实仓库/会话/任务。
selfcheck() {
  local tmp rc=1
  tmp=$(mktemp -d 2>/dev/null) || { echo "dead-loop-check selfcheck: FAIL 无法创建临时目录" >&2; return 1; }

  # control 1（AC1）—— 无驱动 + 无提交 ⇒ dead
  local dead_ws="$tmp/dead"
  mkdir -p "$dead_ws"
  git -C "$dead_ws" init -q -b master >/dev/null 2>&1
  git -C "$dead_ws" config user.email t@t >/dev/null 2>&1
  git -C "$dead_ws" config user.name t >/dev/null 2>&1
  echo x > "$dead_ws/a.txt"
  git -C "$dead_ws" add -A >/dev/null 2>&1
  GIT_AUTHOR_DATE="2000-01-01T00:00:00Z" GIT_COMMITTER_DATE="2000-01-01T00:00:00Z" \
    git -C "$dead_ws" commit -qm "old" >/dev/null 2>&1   # 提交在 26 年前 ⇒ 远超 N 分钟
  local dead_t="$tmp/dead-transcript.jsonl"
  printf '%s\n' '{"type":"user","message":{"role":"user","content":"old"},"timestamp":"2000-01-01T00:00:00Z"}' > "$dead_t"
  local dout
  dout=$(DEAD_LOOP_ROOT="$dead_ws" bash "${BASH_SOURCE[0]}" --root "$dead_ws" \
    --transcript outer "$dead_t" --window-min 30)
  local dverdict; dverdict=$(printf '%s\n' "$dout" | grep '^loop_alive:' | awk '{print $2}')

  # control 2（AC2 负向）—— 队列空（tasks/ 目录存在但无 ready 任务）但有驱动/提交 ⇒ alive
  local alive_ws="$tmp/alive"
  mkdir -p "$alive_ws/tasks"
  printf '%s\n' '---' 'id: only' 'status: todo' '---' > "$alive_ws/tasks/only.md"   # backlog 非空但全是 todo
  git -C "$alive_ws" init -q -b master >/dev/null 2>&1
  git -C "$alive_ws" config user.email t@t >/dev/null 2>&1
  git -C "$alive_ws" config user.name t >/dev/null 2>&1
  echo y > "$alive_ws/b.txt"
  git -C "$alive_ws" add -A >/dev/null 2>&1
  git -C "$alive_ws" commit -qm "recent drive" >/dev/null 2>&1   # 提交在刚才 ⇒ alive
  local aout
  aout=$(DEAD_LOOP_ROOT="$alive_ws" bash "${BASH_SOURCE[0]}" --root "$alive_ws" --window-min 30)
  local averdict; averdict=$(printf '%s\n' "$aout" | grep '^loop_alive:' | awk '{print $2}')

  echo "dead-loop-check selfcheck: no-drive-no-commit=${dverdict} (expect dead) queue-empty-with-drive=${averdict} (expect alive) WINDOW_MIN=${WINDOW_MIN}"
  if [ "$dverdict" = "dead" ] && [ "$averdict" = "alive" ]; then
    echo "dead-loop-check selfcheck: PASS — AC1 dead 与 AC2 负向（队列空但有驱动 ⇒ alive）双向可控"
    rc=0
  else
    echo "dead-loop-check selfcheck: FAIL — dverdict=${dverdict} averdict=${averdict}" >&2
    rc=1
  fi
  rm -rf "$tmp"
  return $rc
}

# ── CLI arg parsing ────────────────────────────────────────────────────────────────────────────
# 用关联数组存 transcript（name → path）+ 有序数组保序（输出按传入顺序）。
declare -A TR_NAMES=() TR_PATHS=()
_TR_ORDER=()
DEFAULT_ROOT="$REPO_ROOT"

_parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --root) DEFAULT_ROOT="${2:-}"; shift 2 ;;
      --transcript)
        [ $# -ge 3 ] || { echo "dead-loop-check: --transcript 需要 <名字> <路径>" >&2; return 2; }
        TR_NAMES["$2"]="$2"; TR_PATHS["$2"]="$3"; _TR_ORDER+=("$2"); shift 3 ;;
      --window-min) WINDOW_MIN="${2:-30}"; shift 2 ;;
      --selfcheck) selfcheck; exit $? ;;
      -h|--help)
        echo "用法: $0 [--root <repo-root>] [--transcript <名字> <路径>]... [--window-min N] [--selfcheck]"
        echo "  loop_alive = alive 当 最近 N 分钟 transcript 有 user 消息 或 git 有提交；都无 = dead"
        exit 0 ;;
      *) echo "dead-loop-check: 未知参数 $1" >&2; return 2 ;;
    esac
  done
  return 0
}

_parse_args "$@" || exit $?

# ── signal collection ──────────────────────────────────────────────────────────────────────────
git_age="-"
git_epoch=""
if [ -d "$DEFAULT_ROOT/.git" ] || git -C "$DEFAULT_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  if git_epoch=$(git_last_commit_epoch "$DEFAULT_ROOT"); then
    git_age=$(epoch_to_age_min "$git_epoch")
  fi
fi

# 逐 transcript 收集最近 user 消息年龄
declare -A TR_AGE=()
for name in ${_TR_ORDER[@]+"${_TR_ORDER[@]}"}; do
  p="${TR_PATHS[$name]:-}"
  if ep=$(transcript_last_user_epoch "$p"); then
    TR_AGE[$name]=$(epoch_to_age_min "$ep")
  else
    TR_AGE[$name]="-"
  fi
done

# ── verdict（band：任一信号在窗口内 ⇒ alive；都无 ⇒ dead）────────────────────────────────────
git_recent=0
[ "$git_age" != "-" ] && [ "$git_age" -le "$WINDOW_MIN" ] 2>/dev/null && git_recent=1
tr_recent=0
for name in ${_TR_ORDER[@]+"${_TR_ORDER[@]}"}; do
  a="${TR_AGE[$name]:-}"
  [ "$a" != "-" ] && [ "$a" -le "$WINDOW_MIN" ] 2>/dev/null && tr_recent=1
done

alive_signals="none"
if [ "$git_recent" = "1" ]; then alive_signals="git-commit"; fi
if [ "$tr_recent" = "1" ]; then
  [ "$alive_signals" = "none" ] && alive_signals="transcript-user" || alive_signals="git-commit transcript-user"
fi
if [ "$git_recent" = "1" ] || [ "$tr_recent" = "1" ]; then
  loop_alive="alive"
else
  loop_alive="dead"
fi

# ── stdout（Contract measure loop_alive + 诊断）────────────────────────────────────────────────
printf 'loop_alive: %s\n' "$loop_alive"
printf 'git_last_commit_min: %s\n' "$git_age"
for name in ${_TR_ORDER[@]+"${_TR_ORDER[@]}"}; do
  printf 'transcript_last_user_min: %s %s\n' "$name" "${TR_AGE[$name]:-}"
done
printf 'window_min: %s\n' "$WINDOW_MIN"
printf 'alive_signals: %s\n' "$alive_signals"
exit 0
