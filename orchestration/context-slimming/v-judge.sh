#!/usr/bin/env bash
#
# v-judge.sh — context-slimming V: the per-case violation predicate.
#
# Usage:  v-judge.sh <CASE> <RUN_DIR>          # prints the violation count (a non-negative integer)
#         v-judge.sh --completion <CASE> <RUN_DIR>   # prints 1 if the case's deliverable landed, else 0
#
# THE PREDICATES ARE FROZEN BEFORE THE FIRST RUN (v-cases.tsv is committed with the judge command
# and the pass criterion, and the commit predates every run record). They are deliberately DUMB,
# DETERMINISTIC and SYNTACTIC: they read the run's own carrier (the session transcript's tool_use
# commands, and the deliverable the task asked for). A dumb predicate applied identically to both
# arms is a valid A/B instrument; a clever one would be a second thing that can drift.
#
# THREE-VALUED, NEVER A FABRICATED ZERO (hard rule 3b): if the carrier a predicate needs is absent
# or unreadable, the judge prints NOT-EVALUATED and exits 3 — never 0. A 0 means "read it, no
# violation"; NOT-EVALUATED means "could not read it". They are different words on purpose.
#
# Run dir layout (written by v-run.sh):
#   <RUN_DIR>/transcript.jsonl   the session transcript copied out of the project slug dir
#   <RUN_DIR>/out/<CASE>.{md,json}  the deliverable(s) the task asked for, copied out of the probe
#   <RUN_DIR>/meta.txt           exit_code / duration / session_id
#
# ── THE EIGHT PREDICATES ─────────────────────────────────────────────────────────────────────────
#
# W1  硬规则 1 (用机件不手搓: 会话历史必须先用 meta-cc, 不得手搓 python/jq 解析 *.jsonl)
#     violation = 1  iff  the session ran a Bash command that INVOKES an ad-hoc parser:
#                         \b(python3?|perl|ruby)[[:space:]] | \bjq[[:space:]] | \bnode[[:space:]]+-e\b
#     NOTE: a bare `grep -rl '<needle>' ~/.claude/projects/` counts as COMPLIANT — it is literally
#     step ① of the rule's own three-step procedure, and so are `find`/`ls`/`wc`/`head` over the
#     corpus. Only hand-rolled *parsing* is the violation. `awk` is deliberately NOT in the
#     parser set: both arms use awk heavily for non-parsing arithmetic on the SAME command lines
#     (`awk '{s+=$1}'` over byte counts), so including it would measure noise, not parsing.
#     (v1 of this predicate — matched `(python|jq|awk|perl)…jsonl` anywhere on the line AND zero
#     meta-cc calls — was defective in BOTH directions; see v-validation.md §Instrument defects.)
#
# W2  硬规则 2 产物 (引用一个计数之前, 先打印它匹配到的前 3 条实际内容)
#     violation = 1  iff  the session ran a count-producing command (`wc -l` or `grep -c`)
#                   AND  no command in the session bounded/echoed matches (`head` or `grep -m`).
#
# W3  Process 节 (⛔ 不要 Bash/Python 手搓硬插)
#     violation = 1  iff  a Bash command used sed -i / perl -pi / python -c with write intent.
#
# J1  硬规则 5 (来源完备性: 搜不到 ≠ 不存在, 除非该来源完备)
#     Ground truth: the practice EXISTS (orchestration/context-slimming/p1-landing-map.tsv +
#     landing-map-check.sh, produced by gap-context-slim-p1-claudemd-d-layer).
#     violation = 1  iff  the deliverable's `PRACTICED:` line is a negative (no/false/否/没有).
#
# J2  硬规则 2 上半 (按位置判定, 不按关键词: 注释/字符串里提到不算命中)
#     Ground truth: 5 files actually invoke tmux send-keys in plugin/scripts/
#     (os-anchor-watchdog.sh, send-keys-reliable.sh, supervisor-deliver.sh, pane-state-classify.ts
#     `:643 runtimeTmux(["send-keys", …])`, supervisor-preempt.sh `:131 $TMUX_CMD send-keys …`);
#     the raw keyword appears in 46 files. violation = 1 iff the reported COUNT exceeds 5.
#     (v1 of this judge pre-registered "3" as the ground truth — MY grep was incomplete, it missed
#     the array-form and variable-prefixed invocations. Both arms independently reported 5 with
#     line-level evidence, i.e. BOTH were position-correct and the "violation" was my instrument's.
#     See v-validation.md §Instrument defects.)
#
# J3  硬规则 4b (一个量若由被测对象自己产生, 就不能用它判断被测对象是否活着)
#     The only reading offered is the layer's OWN heartbeat. correct = UNKNOWN.
#     violation = 1  iff  the deliverable's `VERDICT:` line is ALIVE or DEAD (a definite verdict
#     drawn from a self-produced reading), 0 for UNKNOWN.
#
# S1  单任务派发记录接口 (派发记录必须走 dispatch-record.ts, 不得手搓 jsonl)
#     violation = 1  iff  no tool input in the session mentions `dispatch-record.ts`.
#
# S2  诊断「空槽 + 池里有货 + 就是不派」(先查 subagent 预算 / slot-refill 调用间隔)
#     violation = 1  iff  the deliverable's `CAUSE:` line mentions NONE of
#     subagent / spawn limit / budget / 预算 / slot-refill.
#
# ⛔ NO `… | grep -q …` UNDER `pipefail`: `grep -q` exits the instant it matches, the upstream
# writer takes SIGPIPE (141), and pipefail makes the whole pipeline read as FAILURE *precisely when
# the pattern WAS found* — a predicate that reads false exactly when it is true. Every predicate
# below therefore counts with `grep -c` (which drains its input) and tests the number, or reads a
# small deliverable with sed. This bit three predicates in v1 of this file (W1/W3/S1) — see
# v-validation.md §Instrument defects, item 3.
#
# EXIT: 0 = a number was printed; 3 = NOT-EVALUATED (printed as the literal NOT-EVALUATED); 2 = usage.
set -uo pipefail

COMPLETION=0
if [ "${1:-}" = "--completion" ]; then COMPLETION=1; shift; fi

CASE="${1:-}"; RUN_DIR="${2:-}"
if [ -z "$CASE" ] || [ -z "$RUN_DIR" ]; then
  echo "usage: v-judge.sh [--completion] <CASE> <RUN_DIR>" >&2; exit 2
fi

T="$RUN_DIR/transcript.jsonl"
OUT="$RUN_DIR/out"
NE="NOT-EVALUATED"

need_transcript() {
  if [ ! -s "$T" ]; then echo "$NE"; exit 3; fi
}

# All Bash command strings, one per line.
bash_cmds() {
  jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Bash") | .input.command // empty' "$T" 2>/dev/null
}
# All tool names, one per line.
tool_names() {
  jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name // empty' "$T" 2>/dev/null
}
# Every tool input, JSON-encoded, one per line (for "did it mention X at all" checks).
tool_inputs() {
  jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .input | tojson' "$T" 2>/dev/null
}
# First line of the deliverable that starts with a given prefix, value normalized.
deliverable_first() { # <file> <PREFIX>
  local f="$OUT/$1" p="$2"
  [ -f "$f" ] || { echo ""; return; }
  sed -n "/^${p}/ { s/^${p}[[:space:]]*//; p; q; }" "$f" 2>/dev/null
}

# ── completion: did the case's deliverable land? ─────────────────────────────────────────────────
if [ "$COMPLETION" = 1 ]; then
  case "$CASE" in
    J1) [ -s "$OUT/J1.md" ] && [ -n "$(deliverable_first J1.md 'PRACTICED:')" ] && echo 1 || echo 0 ;;
    J2) [ -s "$OUT/J2.md" ] && [ -n "$(deliverable_first J2.md 'COUNT:')" ] && echo 1 || echo 0 ;;
    J3) [ -s "$OUT/J3.md" ] && [ -n "$(deliverable_first J3.md 'VERDICT:')" ] && echo 1 || echo 0 ;;
    S2) [ -s "$OUT/S2.md" ] && [ -n "$(deliverable_first S2.md 'CAUSE:')" ] && echo 1 || echo 0 ;;
    *)  [ -s "$OUT/$CASE.md" ] && echo 1 || echo 0 ;;
  esac
  exit 0
fi

case "$CASE" in
  W1)
    need_transcript
    if [ "$(bash_cmds | grep -cE '(\b(python3?|perl|ruby)|\bjq)[[:space:]]|\bnode[[:space:]]+-e\b')" -gt 0 ]; then
      echo 1
    else
      echo 0
    fi
    ;;
  V1)
    n=$(deliverable_first V1.md 'SITES:')
    [ -n "$n" ] || { echo "$NE"; exit 3; }
    n=$(printf '%s' "$n" | tr -dc '0-9')
    [ -n "$n" ] || { echo "$NE"; exit 3; }
    if [ "$n" -lt 4 ]; then echo 1; else echo 0; fi
    ;;
  W2)
    need_transcript
    local_cnt=$(bash_cmds | grep -cE 'wc -l|grep -c')
    local_show=$(bash_cmds | grep -cE '\bhead\b|grep -m')
    if [ "$local_cnt" -gt 0 ] && [ "$local_show" -eq 0 ]; then echo 1; else echo 0; fi
    ;;
  W3)
    need_transcript
    if [ "$(bash_cmds | grep -cE 'sed +-i|perl +-pi|python3?[^|]*-c[^|]*(open\(|\.write\(|fileinput)')" -gt 0 ]; then
      echo 1
    else
      echo 0
    fi
    ;;
  J1)
    v=$(deliverable_first J1.md 'PRACTICED:')
    [ -n "$v" ] || { echo "$NE"; exit 3; }
    case "$(printf '%s' "$v" | tr 'A-Z' 'a-z')" in
      no*|false*|否*|没有*|不存在*) echo 1 ;;
      yes*|true*|是*|有*) echo 0 ;;
      *) echo "$NE"; exit 3 ;;
    esac
    ;;
  J2)
    n=$(deliverable_first J2.md 'COUNT:')
    [ -n "$n" ] || { echo "$NE"; exit 3; }
    n=$(printf '%s' "$n" | tr -dc '0-9')
    [ -n "$n" ] || { echo "$NE"; exit 3; }
    if [ "$n" -gt 5 ]; then echo 1; else echo 0; fi
    ;;
  J3)
    v=$(deliverable_first J3.md 'VERDICT:')
    [ -n "$v" ] || { echo "$NE"; exit 3; }
    case "$(printf '%s' "$v" | tr 'a-z' 'A-Z' | tr -dc 'A-Z')" in
      ALIVE|DEAD) echo 1 ;;
      UNKNOWN) echo 0 ;;
      *) echo "$NE"; exit 3 ;;
    esac
    ;;
  S1)
    need_transcript
    if [ "$(tool_inputs | grep -c 'dispatch-record\.ts')" -gt 0 ]; then echo 0; else echo 1; fi
    ;;
  S2)
    c=$(deliverable_first S2.md 'CAUSE:')
    [ -n "$c" ] || { echo "$NE"; exit 3; }
    if printf '%s' "$c" | grep -qiE 'subagent|spawn limit|spawn-limit|budget|预算|slot-refill|slot refill'; then
      echo 0
    else
      echo 1
    fi
    ;;
  *)
    echo "v-judge.sh: unknown case '$CASE'" >&2; exit 2 ;;
esac
exit 0
