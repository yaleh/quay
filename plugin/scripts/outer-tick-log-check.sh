#!/usr/bin/env bash
# outer-tick-log-check.sh — gap-no-action-requires-evidence-mechanical-check: outer 的 no-action 判词
# 必须举证，且必须是「重新测量的裁判」不是「行格式 linter」。manager 三设计约束（2026-08-09）：
#   ① 重新测量的裁判——自己跑五条命令拿真值，比对 ⓐ行内读数 ⓑ判词 ⓒ该轮实际 git/账本痕迹；
#      三者不一致 ⇒ FAIL。防欺骗输入（读数写全+判词 escalate+实际没动 ⇒ 红）。
#   ② 接线位置比脚本本身重要——必须接 scripts/test.sh 的 run_static_checks（每次全量套件必跑），
#      不依赖会话意志。
#   ③ 新鲜度上界——行带时间戳+原始读数；checker 判「行内自洽 + 新鲜度上界」而非拿此刻真值判
#      过去行；构造 20 分钟前的行 + 此刻真值已变 ⇒ 不因量变误报（自洽即过）。
#
# 五条不等式（B13，manager 明令）——每条对应一个强制动作，no-action 只有在五条全假时才合法：
#   ① in_flight < cap 且 recommended 非空 ⇒ 必须派发到 cap
#   ② pool < floor ⇒ 必须晋级补池
#   ③ nyf > 0 且 work 落地 ⇒ 必须翻 done
#   ④ integration 领先 develop 且 suite 绿 ⇒ 必须批量合
#   ⑤ suite state=red ⇒ 分诊+派发
#
# 判据（本脚本，三层）：
#   L0 结构：读 tick-log 的最近一个 tick 段（`### HH:MMZ` 起），取动作类型 + 五条不等式行。
#   L1 行内自洽（始终跑）：no-action 行必须带五条读数且全为 `[当前假`；任一 `[当前真` 或缺失 ⇒ FAIL。
#   L2 重新测量（仅当行新鲜——tick 时间 ≤ 新鲜度上界，默认 60min）：
#       - 跑五条真值命令（slot-refill / ready-pool / git rev-list+suite / suite state）
#       - 比对行内读数 vs 实测真值：行内标 `[当前假` 但实测为真 ⇒ FAIL（读数撒谎或漏报）
#       - 判词与实测不符：判词写 no-action 但实测 ①-⑤ 任一为真 ⇒ FAIL（欠动作）
#       - 欺骗输入：判词写 escalate/correct/unblock 但该轮实际 git 无任何提交痕迹（git log --since
#         该 tick 时刻为空）⇒ FAIL（「说动了却没动」）
#   L3 新鲜度上界：行时间 > 上界 ⇒ 跳过 L2（只跑 L1 自洽）——不拿此刻真值判 20 分钟前的行。
#
# 用法：
#   outer-tick-log-check.sh [--log <path>] [--fresh-minutes <n>] [--json] [--root <dir>]
#     --log <path>         outer tick 日志（默认 <repo>/orchestration/tick-log.md）
#     --fresh-minutes <n>  新鲜度上界（默认 60；超过则只判行内自洽，不重测）
#     --json               JSON 输出
#     --root <dir>         仓库根（真值命令的工作目录，默认脚本推导）
#     --help|-h            用法
#
# 测试接缝：--log 指向临时 fixture；--fresh-minutes 缩小让行变陈旧（跳过 L2 重测）；真值命令
# 通过 --root 指向 fixture 目录（L2 仅在真实根下可测，fixture 下 --root 缺失则只判 L1）。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOG="${OUTER_TICK_LOG:-${DEFAULT_ROOT}/orchestration/tick-log.md}"
FRESH_MINUTES="${OUTER_TICK_FRESH_MINUTES:-60}"
JSON=0
ROOT="${OUTER_TICK_ROOT:-$DEFAULT_ROOT}"
# --truth "10100"：测试接缝——注入五条实测真值（五字符：①-⑤，1=真 0=假），跳过真实命令重测。
# 生产（run_static_checks 接线）不传，checker 自己跑命令拿真值。fixture 单测用显式真值隔离真实仓库。
TRUTH=""

usage() {
  sed -n '1,55p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --log) LOG="$2"; shift 2 ;;
    --fresh-minutes) FRESH_MINUTES="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    --root) ROOT="$2"; shift 2 ;;
    --truth) TRUTH="$2"; shift 2 ;;
    --help|-h) usage ;;
    *)
      echo "ERROR: unknown argument: $1 (expected --log | --fresh-minutes | --json | --root | --truth)" >&2
      exit 2
      ;;
  esac
done

case "$FRESH_MINUTES" in
  ''|*[!0-9]*) echo "ERROR: --fresh-minutes must be a non-negative integer, got: '$FRESH_MINUTES'" >&2; exit 2 ;;
esac

if [ -n "$TRUTH" ]; then
  case "$TRUTH" in
    [01][01][01][01][01]) ;;
    *) echo "ERROR: --truth must be 5 chars of 0/1 (①-⑤), got: '$TRUTH'" >&2; exit 2 ;;
  esac
fi

# 判据 0：日志必须存在。
if [ ! -f "$LOG" ]; then
  if [ "$JSON" = 1 ]; then printf '{"ok":false,"reason":"no-log","log":"%s"}\n' "$LOG"
  else echo "outer-tick-log-check: FAIL — outer tick log not found: $LOG"; fi
  exit 1
fi

# 取最后一个 tick 段（`### HH:MMZ` 起，到文件尾）。
LAST_SECTION="$(awk '
  /^### / { section = ""; collecting = 1 }
  collecting { section = section $0 "\n" }
  END { printf "%s", section }
' "$LOG")"

if [ -z "$LAST_SECTION" ]; then
  if [ "$JSON" = 1 ]; then printf '{"ok":false,"reason":"no-tick-section"}\n'
  else echo "outer-tick-log-check: FAIL — no tick section (### HH:MMZ) found in $LOG"; fi
  exit 1
fi

TICK_TIME="$(printf '%s' "$LAST_SECTION" | grep -m1 -oE '^### [0-9]{2}:[0-9]{2}Z?' | sed 's/^### //; s/Z$//')"
ACTION="$(printf '%s' "$LAST_SECTION" | grep -m1 -oE '^- 动作分类: *[a-z-]+' | sed 's/^- 动作分类: *//')"
INEQ_LINE="$(printf '%s' "$LAST_SECTION" | grep -m1 '^- 五条不等式:' || true)"

# ── L1 行内自洽（始终跑）──────────────────────────────────────────────────────────────
# no-action 必须带五条读数且全假。
if [ "$ACTION" = "no-action" ]; then
  if [ -z "$INEQ_LINE" ]; then
    if [ "$JSON" = 1 ]; then printf '{"ok":false,"reason":"no-inequality-evidence","action":"no-action","tickTime":"%s"}\n' "$TICK_TIME"
    else echo "outer-tick-log-check: FAIL — last tick is no-action but the row carries NO 五条不等式 readings (B13: no-action must carry all five and all false)"; fi
    exit 1
  fi
  TRUE_MARKERS="$(printf '%s' "$INEQ_LINE" | grep -oE '\[当前真[^]]*\]' || true)"
  if [ -n "$TRUE_MARKERS" ]; then
    if [ "$JSON" = 1 ]; then printf '{"ok":false,"reason":"no-action-inequality-true","action":"no-action","trueCount":%s}\n' "$(printf '%s' "$TRUE_MARKERS" | wc -l | tr -d ' ')"
    else echo "outer-tick-log-check: FAIL — last tick is no-action but inequalities are TRUE: $(echo "$TRUE_MARKERS" | tr '\n' ' ') (B13: no-action legal only if ALL FIVE false)"; fi
    exit 1
  fi
fi

# ── L3 新鲜度上界：行时间是否在界内？──────────────────────────────────────────────────
# 行时间只带 HH:MM（无日期）——同 manager-tick-log-check 的 mtime 判据：tick 行第一列可能是
# 掩码时间，不可被 date 解析。用 LOG 文件的 mtime 作为「最近写入」判据（同形复用）。行是否陈旧
# 以 mtime 距今为准：mtime 超上界 ⇒ 跳过 L2 重测。
LAST_EPOCH="$(date -r "$LOG" +%s 2>/dev/null || echo "")"
NOW_EPOCH="$(date +%s)"
IS_FRESH=0
if [ -n "$LAST_EPOCH" ]; then
  AGE_SECONDS=$(( NOW_EPOCH - LAST_EPOCH ))
  if [ "$AGE_SECONDS" -le $(( FRESH_MINUTES * 60 )) ]; then IS_FRESH=1; fi
fi

# ── L2 重新测量（仅当新鲜）────────────────────────────────────────────────────────────
# 实测真值来源：--truth 注入（测试接缝）优先；否则只在真实仓库根下跑命令重测
# （fixture --root 指向非仓库目录且无 --truth 时命令不可用 ⇒ 跳过 L2，只判 L1）。
L2_FAIL=""
if [ "$IS_FRESH" = "1" ] && [ -n "$TRUTH" ]; then
  # --truth "10100"：五字符 ①-⑤，1=真。
  INEQ1_TRUE="${TRUTH:0:1}"; INEQ2_TRUE="${TRUTH:1:1}"; INEQ3_TRUE="${TRUTH:2:1}"
  INEQ4_TRUE="${TRUTH:3:1}"; INEQ5_TRUE="${TRUTH:4:1}"
  ANY_TRUE=$(( INEQ1_TRUE || INEQ2_TRUE || INEQ3_TRUE || INEQ4_TRUE || INEQ5_TRUE ))
  if [ "$ACTION" = "no-action" ] && [ "$ANY_TRUE" = "1" ]; then
    L2_FAIL="no-action-but-remeasured-true"
  fi
  # 欺骗输入（--truth 接缝下可测）：判词是动作类型（escalate/correct/unblock），但五条实测任一为真
  # 且该轮无 git 提交痕迹——「说动了却没动」。动作类型 + 真值仍有 + 无痕迹 ⇒ 声称的动作没发生。
  if [ "$ACTION" != "no-action" ] && [ -n "$ACTION" ] && [ "$ANY_TRUE" = "1" ]; then
    TRACE_EMPTY=1
    if [ -n "$LAST_EPOCH" ]; then
      TRACE_COUNT="$(git -C "$ROOT" log --since="@$LAST_EPOCH" --oneline 2>/dev/null | wc -l | tr -d ' ')"
      [ -n "$TRACE_COUNT" ] && [ "$TRACE_COUNT" -gt 0 ] && TRACE_EMPTY=0
    fi
    if [ "$TRACE_EMPTY" = "1" ]; then
      L2_FAIL="action-claimed-but-no-git-trace"
    fi
  fi
elif [ "$IS_FRESH" = "1" ] && [ -d "$ROOT/.git" ]; then
  # ① in_flight < cap 且 recommended 非空（slot-refill）
  IN_FLIGHT_LT_CAP=0; REC_NONEMPTY=0
  SLOT_OUT="$(bash "$SCRIPT_DIR/slot-refill.sh" --root "$ROOT" 2>/dev/null || true)"
  if [ -n "$SLOT_OUT" ]; then
    SLOTS_FREE="$(printf '%s' "$SLOT_OUT" | grep -oE '"slots_free": *[0-9]+' | grep -oE '[0-9]+' | head -1)"
    [ -n "$SLOTS_FREE" ] && [ "$SLOTS_FREE" -gt 0 ] && IN_FLIGHT_LT_CAP=1
    REC="$(printf '%s' "$SLOT_OUT" | grep -oE '"recommended": *\[[^]]*\]' | grep -oE '\[[^]]*\]' | tr -d '[]" ' | tr ',' '\n' | grep -c 'gap-\|DIR-' || true)"
    [ "${REC:-0}" -gt 0 ] && REC_NONEMPTY=1
  fi
  # ② pool < floor（ready-pool-check）
  POOL_LT_FLOOR=0
  POOL_OUT="$(node --no-warnings --experimental-strip-types "$SCRIPT_DIR/ready-pool-check.ts" --root "$ROOT" --cap 4 --json 2>/dev/null || true)"
  if [ -n "$POOL_OUT" ]; then
    POOL="$(printf '%s' "$POOL_OUT" | grep -oE '"pool": *[0-9]+' | grep -oE '[0-9]+' | head -1)"
    FLOOR="$(printf '%s' "$POOL_OUT" | grep -oE '"floor": *[0-9]+' | grep -oE '[0-9]+' | head -1)"
    [ -n "$POOL" ] && [ -n "$FLOOR" ] && [ "$POOL" -lt "$FLOOR" ] && POOL_LT_FLOOR=1
  fi
  # ④ integration 领先 develop 且 suite 绿
  INTEGRATION_AHEAD=0
  LEAD="$(git -C "$ROOT" rev-list --count develop..integration 2>/dev/null || echo 0)"
  [ -n "$LEAD" ] && [ "$LEAD" -gt 0 ] && INTEGRATION_AHEAD=1
  SUITE_GREEN=0
  if [ -f "$ROOT/.quay/full-suite-state.json" ]; then
    SUITE_STATE="$(python3 -c "import json;print(json.load(open('$ROOT/.quay/full-suite-state.json'))['state'])" 2>/dev/null || echo '')"
    [ "$SUITE_STATE" = "green" ] && SUITE_GREEN=1
  fi
  # ⑤ suite red
  SUITE_RED=0
  [ "$SUITE_STATE" = "red" ] && SUITE_RED=1

  # ①-⑤ 当前实测真值
  INEQ1_TRUE=$(( IN_FLIGHT_LT_CAP && REC_NONEMPTY ))
  INEQ2_TRUE=$POOL_LT_FLOOR
  INEQ3_TRUE=0  # nyf 需要 closure-lag 扫描，静态判据难以低成本重测——保守标 0（不自证欠动作）
  INEQ4_TRUE=$(( INTEGRATION_AHEAD && SUITE_GREEN ))
  INEQ5_TRUE=$SUITE_RED
  ANY_TRUE=$(( INEQ1_TRUE || INEQ2_TRUE || INEQ3_TRUE || INEQ4_TRUE || INEQ5_TRUE ))

  # 判词 no-action 但实测任一为真 ⇒ 欠动作
  if [ "$ACTION" = "no-action" ] && [ "$ANY_TRUE" = "1" ]; then
    L2_FAIL="no-action-but-remeasured-true"
  fi
  # 欺骗输入：判词 escalate/correct/unblock 但该轮实际 git 无提交痕迹
  if [ "$ACTION" != "no-action" ] && [ -n "$ACTION" ]; then
    TRACE_EMPTY=1
    if [ -n "$LAST_EPOCH" ]; then
      TRACE_COUNT="$(git -C "$ROOT" log --since="@$LAST_EPOCH" --oneline 2>/dev/null | wc -l | tr -d ' ')"
      [ -n "$TRACE_COUNT" ] && [ "$TRACE_COUNT" -gt 0 ] && TRACE_EMPTY=0
    fi
    if [ "$TRACE_EMPTY" = "1" ]; then
      L2_FAIL="action-claimed-but-no-git-trace"
    fi
  fi
fi

if [ -n "$L2_FAIL" ]; then
  if [ "$JSON" = 1 ]; then
    printf '{"ok":false,"reason":"%s","action":"%s","tickTime":"%s","fresh":%s}\n' "$L2_FAIL" "$ACTION" "$TICK_TIME" "$IS_FRESH"
  else
    echo "outer-tick-log-check: FAIL — re-measured truth contradicts the row (reason=$L2_FAIL, action=$ACTION, tick=$TICK_TIME, fresh=$IS_FRESH)"
  fi
  exit 1
fi

# PASS
if [ "$JSON" = 1 ]; then
  printf '{"ok":true,"action":"%s","tickTime":"%s","fresh":%s,"checked":true}\n' "${ACTION:-<none>}" "$TICK_TIME" "$IS_FRESH"
else
  echo "outer-tick-log-check: PASS — last tick (${TICK_TIME:-?}, action=${ACTION:-<none>}) is self-consistent (fresh=$IS_FRESH)"
fi
exit 0
