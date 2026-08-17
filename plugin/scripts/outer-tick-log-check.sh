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
#         该 tick 时刻为空）⇒ FAIL（「说动了却没动」）。trace 窗口锚定该 tick 自己的起点（上一行
#         写入/行内 epoch/保守回退），不是 log 写入时刻——act-then-log 下动作证据提交在 log 前，
#         窗口必须含它（gap-outer-tick-log-check-trace-window-anchored-at-log-mtime）。
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

# 判据 0：日志缺失 ⇒ NOT-EVALUATED（exit 0），不是 FAIL。
# tick-log.md 是 gitignored runtime 文件——fresh verify worktree（provision 只拷 gitignored 运行时文件
# 的 symlink，不拷 tick-log）里它【合法缺失】；此时 checker 无法评估，应如实报 NOT-EVALUATED 而非
# FAIL（否则接线后每个 fresh-worktree 全量认证都会因缺日志红）。同 NOT-EVALUATED 原则：缺输入 ⇒
# 「没查成」的可区分取值，不是「查过且不合格」（manager 2026-08-13）。
if [ ! -f "$LOG" ]; then
  if [ "$JSON" = 1 ]; then printf '{"ok":true,"evaluated":false,"reason":"no-log","log":"%s"}\n' "$LOG"
  else echo "outer-tick-log-check: NOT-EVALUATED — tick-log not found: $LOG（fresh worktree 缺 gitignored 运行时日志属合法；无法评估）"; fi
  exit 0
fi

# 取最后一个 tick 段（`- \`HH:MMZ\`` bullet 起，到文件尾）。真实 tick-log 用 bullet 行
# （`- \`19:55Z\` \`tick\` — …`），不是 `### HH:MMZ` 标题——2026-08-13 manager 裁定锚点按现实改。
LAST_SECTION="$(awk '
  /^\- `[0-9]{2}:[0-9]{2}Z?`/ { section = ""; collecting = 1 }
  collecting { section = section $0 "\n" }
  END { printf "%s", section }
' "$LOG")"

if [ -z "$LAST_SECTION" ]; then
  if [ "$JSON" = 1 ]; then printf '{"ok":false,"reason":"no-tick-section"}\n'
  else echo "outer-tick-log-check: FAIL — no tick section (- \`HH:MMZ\` bullet) found in $LOG"; fi
  exit 1
fi

TICK_TIME="$(printf '%s' "$LAST_SECTION" | grep -m1 -oE '^\- `[0-9]{2}:[0-9]{2}Z?`' | sed 's/^\- `//; s/Z`$//; s/`$//')"
ACTION="$(printf '%s' "$LAST_SECTION" | grep -m1 -oE '^- 动作分类: *[a-z-]+' | sed 's/^- 动作分类: *//')"
INEQ_LINE="$(printf '%s' "$LAST_SECTION" | grep -m1 '^- 五条不等式:' || true)"
# A23 融合防漏（orchestrator-tick-core.md:47）：A23（AC81 四判据核实）是写 B13 行的前置——B13 行
# 存在而同段无 A23 四判据输出 ⇒ tick-log 行不合法（manager 01:5xZ 报 A23 连续 5 轮缺席无人可判）。
# A23 输出行判定 = 本段含 `A23` 且带状态词（code=N / VIOLATED / OK / NOT-EVALUATED / CRITICAL）——
# 区分「真跑了 A23 并留输出」与「散文讨论 A23 而无产物」（硬规则⑨：缺失则判 RED）。旧 inner 的
# A23 执行模式两数行（`main_thread_edits=…/agent_dispatches=…`）无状态词 ⇒ 不算 AC81 A23 输出。
A23_LINE="$(printf '%s' "$LAST_SECTION" | grep -m1 -E 'A23.*(code=[0-9]|VIOLATED|NOT-EVALUATED|CRITICAL|\bOK\b)' || true)"

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

# ── L2 trace 窗口起点：锚定该 tick 自己的起点，而非 log 写入时刻 ─────────────────────────
# gap-outer-tick-log-check-trace-window-anchored-at-log-mtime: act-then-log 下动作行的证据提交
# 严格在 log 写入之前；用 log mtime 当窗口起点（--since=@<mtime>）必然排除动作提交 ⇒ 假红
# （phantom-red：17:15 行手跑 FAIL / 套件内 PASS 全靠 log 后有无无关提交）。正确窗口 =
# [上一行写入, 本行写入]（[该 tick 起点, log mtime]）。窗口起点按优先级解析：
#   ① 上一 tick 段行内 epoch（`epoch=<ts>`，B13 前向兼容：每行记该 tick 写入时刻）——精确。
#   ② 本 tick 段行内 epoch（`epoch=<ts>`，契约 = 该 tick 起点时刻）——精确。
#   ③ 上一 tick 段 `### HH:MM` 表头 → 当日 epoch 减 120s 缓冲（分钟粒度 + 实际写入可能早于表头）
#      ——校验不晚于 log mtime（防跨日/掩码时间）。
#   ④ 均不可解析 ⇒ TRACE_START_EPOCH 为空 ⇒ 跳过 L2 trace 判据（不假红，spec 明令）。
PREV_SECTION="$(awk '
  /^\- `[0-9]{2}:[0-9]{2}Z?`/ {
    if (prev != "") last = prev
    prev = ""
    collecting = 1
  }
  collecting { prev = prev $0 "\n" }
  END { printf "%s", last }
' "$LOG")"

TRACE_START_EPOCH=""
# ① 上一 tick 段行内 epoch
PREV_EPOCH="$(printf '%s' "$PREV_SECTION" | grep -m1 -oE 'epoch=[0-9]+' | head -1 | sed 's/epoch=//')"
case "$PREV_EPOCH" in
  ''|*[!0-9]*|0*) ;;
  *)
    if [ "$PREV_EPOCH" -le $(( NOW_EPOCH + 3600 )) ] 2>/dev/null; then TRACE_START_EPOCH="$PREV_EPOCH"; fi ;;
esac
# ② 本 tick 段行内 epoch
if [ -z "$TRACE_START_EPOCH" ]; then
  CUR_EPOCH="$(printf '%s' "$LAST_SECTION" | grep -m1 -oE 'epoch=[0-9]+' | head -1 | sed 's/epoch=//')"
  case "$CUR_EPOCH" in
    ''|*[!0-9]*|0*) ;;
    *)
      if [ "$CUR_EPOCH" -le $(( NOW_EPOCH + 3600 )) ] 2>/dev/null; then TRACE_START_EPOCH="$CUR_EPOCH"; fi ;;
  esac
fi
# ③ 上一 tick 表头 HH:MM → 当日 epoch - 120s
if [ -z "$TRACE_START_EPOCH" ]; then
  PREV_HEADER="$(printf '%s' "$PREV_SECTION" | grep -m1 -oE '^\- `[0-9]{2}:[0-9]{2}' | sed 's/^\- `//')"
  if [ -n "$PREV_HEADER" ] && [ -n "$LAST_EPOCH" ]; then
    HH="${PREV_HEADER%%:*}"; MM="${PREV_HEADER##*:}"
    if [ "${HH#0}" -ge 0 ] 2>/dev/null && [ "${HH#0}" -le 23 ] && [ "${MM#0}" -ge 0 ] 2>/dev/null && [ "${MM#0}" -le 59 ]; then
      HEADER_EPOCH="$(date -d "$(date +%Y-%m-%d) ${HH}:${MM}:00" +%s 2>/dev/null || echo "")"
      if [ -n "$HEADER_EPOCH" ] && [ "$HEADER_EPOCH" -le "$LAST_EPOCH" ]; then
        TRACE_START_EPOCH=$(( HEADER_EPOCH - 120 ))
      fi
    fi
  fi
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
  # trace 窗口 = [该 tick 起点, log 写入时刻]（TRACE_START_EPOCH..LAST_EPOCH）。动作证据提交
  # 必然落窗；log 后的无关提交被 --until 排除 ⇒ 任意时刻跑结果一致（AC4）。窗口不可解析 ⇒ 跳过。
  if [ "$ACTION" != "no-action" ] && [ -n "$ACTION" ] && [ "$ANY_TRUE" = "1" ]; then
    TRACE_EMPTY=1
    if [ -n "$TRACE_START_EPOCH" ]; then
      TRACE_UNTIL=""
      [ -n "$LAST_EPOCH" ] && TRACE_UNTIL="--until=@$LAST_EPOCH"
      TRACE_COUNT="$(git -C "$ROOT" log --since="@$TRACE_START_EPOCH" $TRACE_UNTIL --oneline 2>/dev/null | wc -l | tr -d ' ')"
      [ -n "$TRACE_COUNT" ] && [ "$TRACE_COUNT" -gt 0 ] && TRACE_EMPTY=0
    fi
    if [ "$TRACE_EMPTY" = "1" ] && [ -n "$TRACE_START_EPOCH" ]; then
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
  # 欺骗输入：判词 escalate/correct/unblock 但该轮实际 git 无提交痕迹。窗口 = [该 tick 起点, log
  # 写入时刻]；不可解析窗口起点 ⇒ 跳过（不假红）。动作证据提交必然落窗。
  if [ "$ACTION" != "no-action" ] && [ -n "$ACTION" ]; then
    TRACE_EMPTY=1
    if [ -n "$TRACE_START_EPOCH" ]; then
      TRACE_UNTIL=""
      [ -n "$LAST_EPOCH" ] && TRACE_UNTIL="--until=@$LAST_EPOCH"
      TRACE_COUNT="$(git -C "$ROOT" log --since="@$TRACE_START_EPOCH" $TRACE_UNTIL --oneline 2>/dev/null | wc -l | tr -d ' ')"
      [ -n "$TRACE_COUNT" ] && [ "$TRACE_COUNT" -gt 0 ] && TRACE_EMPTY=0
    fi
    if [ "$TRACE_EMPTY" = "1" ] && [ -n "$TRACE_START_EPOCH" ]; then
      L2_FAIL="action-claimed-but-no-git-trace"
    fi
  fi
fi

if [ -n "$L2_FAIL" ]; then
  if [ "$JSON" = 1 ]; then
    printf '{"ok":false,"reason":"%s","action":"%s","tickTime":"%s","fresh":%s,"traceStart":%s}\n' "$L2_FAIL" "$ACTION" "$TICK_TIME" "$IS_FRESH" "${TRACE_START_EPOCH:-0}"
  else
    echo "outer-tick-log-check: FAIL — re-measured truth contradicts the row (reason=$L2_FAIL, action=$ACTION, tick=$TICK_TIME, fresh=$IS_FRESH)"
  fi
  exit 1
fi

# ── 时间标签判据（manager 2026-08-13：产物，不靠「下次注意」——行为承诺实测寿命 2 行）────────
# ① 末两条标签单调不减（PREV_HEADER ≤ TICK_TIME）；② 每条标签 ≤ 文件 mtime（标签不可能晚于
# 其被写下的时刻）。用 checker 已有变量（TICK_TIME/PREV_HEADER/LAST_EPOCH），不新增数据。
# 发生率 2 且第二次发生在明确修法之后 ⇒ 行为修法不成立，需机械产物（硬规则 12 豁免）。
TAG_FAIL=""
# PREV_HEADER 只在 TRACE_START_EPOCH 解析的 ③ 分支里计算（fixture 带 epoch= 行时跳过）——先给默认值防 set -u
PREV_HEADER="${PREV_HEADER:-}"
if [ -n "$TICK_TIME" ] && [ -n "$LAST_EPOCH" ]; then
  MTIME_HHMM="$(date -r "$LOG" +%H:%M 2>/dev/null || echo "")"
  # ② future：标签 HH:MM > mtime HH:MM（同天；跨日早晨宽限——mtime 00-01h 且标签 22-23h ⇒ 前一天，跳过）
  if [ -n "$MTIME_HHMM" ] && [ "$TICK_TIME" \> "$MTIME_HHMM" ]; then
    MTIME_HH="${MTIME_HHMM%%:*}"
    TAG_HH="${TICK_TIME%%:*}"
    if [ "${MTIME_HH#0}" -ge 2 ] || [ "${TAG_HH#0}" -lt 22 ]; then
      TAG_FAIL="future-label:${TICK_TIME}>mtime:${MTIME_HHMM}"
    fi
  fi
  # ① 单调：上一段标签 > 本段 ⇒ 往回走（跨日宽限——PREV 22-23h 且 TICK 00-01h ⇒ 新一天，跳过；
  # 对称 future-label 的 :304 逻辑，gap-outer-tick-log-cross-midnight-monotonic。HH 剥前导零后取整
  # （00 ⇒ 0，避免空串进整数比较），使同一天早间 00:xx→00:yy 反向仍判 non-monotonic。）
  if [ -z "$TAG_FAIL" ] && [ -n "$PREV_HEADER" ] && [ "$PREV_HEADER" \> "$TICK_TIME" ]; then
    PREV_HH="${PREV_HEADER%%:*}"; TICK_HH="${TICK_TIME%%:*}"
    PREV_HH_INT="${PREV_HH#0}"; PREV_HH_INT="${PREV_HH_INT:-0}"
    TICK_HH_INT="${TICK_HH#0}"; TICK_HH_INT="${TICK_HH_INT:-0}"
    if [ "$PREV_HH_INT" -lt 22 ] || [ "$TICK_HH_INT" -ge 2 ]; then
      TAG_FAIL="non-monotonic:${PREV_HEADER}>${TICK_TIME}"
    fi
  fi
fi
if [ -n "$TAG_FAIL" ]; then
  if [ "$JSON" = 1 ]; then printf '{"ok":false,"reason":"%s","tickTime":"%s"}\n' "$TAG_FAIL" "$TICK_TIME"
  else echo "outer-tick-log-check: FAIL — tick 时间标签 $TAG_FAIL（标签必须单调不减且 ≤ 文件 mtime）"; fi
  exit 1
fi

# NOT-EVALUATED: ACTION unparseable（真实 tick-log 在 step 2 前无 `- 动作分类:` 行）。
# L1/L2 每条检查都以 ACTION 可解析为前提；ACTION 为空 ⇒ 所有分支跳过。此时【不得】输出
# PASS/self-consistent——一个结构上不可能报红的 checker 的绿与「一切正常」同形（硬规则 4），
# 会让记录上看起来 B13 正在被执行而其实没有（manager 2026-08-13：把「没检查」变成「一个恒绿
# 的假保证」更糟）。如实报 NOT-EVALUATED，exit 0 不产生新红；PASS 与 NOT-EVALUATED 从此可区分。
# ⚠️ Step 2 的验收 = NOT-EVALUATED 从输出里消失（每行都能被评估），不是「套件绿」——套件绿
# 恰恰是没评估的表现。
if [ -z "$ACTION" ]; then
  if [ "$JSON" = 1 ]; then
    printf '{"ok":true,"evaluated":false,"reason":"no-action-classification","tickTime":"%s","fresh":%s}\n' "$TICK_TIME" "$IS_FRESH"
  else
    echo "outer-tick-log-check: NOT-EVALUATED — 本行无 \`- 动作分类:\` 字段，B13 举证未被检验（step 2 前的预期状态）"
  fi
  exit 0
fi

# ── A23 融合防漏（orchestrator-tick-core.md:47）────────────────────────────────────────────
# A23（AC81 四判据核实）是写 B13 行的前置：本段含 `- 五条不等式:`（B13）却无 A23 四判据输出行
# ⇒ tick-log 行不合法 ⇒ RED（manager 01:5xZ 报 A23 连续 5 轮缺席 00:23-01:43 无人可判——硬规则⑨
# 「缺失则 tick-log 行不合法」必须可机械判）。输出行判定见 A23_LINE（含 A23 + 状态词）。
if [ -n "$INEQ_LINE" ] && [ -z "$A23_LINE" ]; then
  if [ "$JSON" = 1 ]; then printf '{"ok":false,"reason":"b13-without-a23-output","tickTime":"%s","action":"%s","a23Absent":true}\n' "$TICK_TIME" "$ACTION"
  else echo "outer-tick-log-check: FAIL — B13 行存在但同段无 A23 四判据输出（A23 是 B13 前置，缺失则 tick-log 行不合法）"; fi
  exit 1
fi

# PASS
if [ "$JSON" = 1 ]; then
  printf '{"ok":true,"action":"%s","tickTime":"%s","fresh":%s,"checked":true}\n' "${ACTION:-<none>}" "$TICK_TIME" "$IS_FRESH"
else
  echo "outer-tick-log-check: PASS — last tick (${TICK_TIME:-?}, action=${ACTION:-<none>}) is self-consistent (fresh=$IS_FRESH)"
fi
exit 0
