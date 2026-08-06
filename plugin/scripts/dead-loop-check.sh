#!/usr/bin/env bash
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
  _dl_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$_dl_script_dir/../.." && pwd)"
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
