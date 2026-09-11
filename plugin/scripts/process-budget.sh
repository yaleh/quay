#!/usr/bin/env bash
# ⛔ RETIRED（并发裁决用途）— SPEC-worker-driven-inner-2026-08-16 §5 阶段 2（gap-ac116-spec-phase2-
#   concurrency-stash）：本脚本作为【派发并发裁决】输入（cap-from-gate 的 B 面 effective_cap 读
#   total_budget/available 来裁决派发槽位）的用途已退役——新驱动 worker-driver.ts 数自己的子进程
#   （直接量，硬规则 4b），不再读 process-budget 裁决派发并发。
#   保留面（不退役）：C 面（scripts/test.sh default_concurrency_formula）+ A 面（resource-gate.sh
#   suite 调度）。⛔ 新驱动路径不消费本脚本做并发裁决。
# plugin/scripts/process-budget.sh — the cross-layer TOTAL PROCESS BUDGET authority
# (gap-test-concurrency-cap-does-not-scope-nested-spawns, AC1).
#
# The single authority for "how many node --test (node) processes the WHOLE repo may run
# at once, across ALL worktrees". Every layer that would otherwise derive its own concurrency reads
# THIS instead of each deriving its own:
#   - scripts/test.sh default_concurrency_formula  (C face — top-level worker count)
#   - cap-from-gate.ts effective_cap slot cap      (B face — dispatch slots)
#   - resource-gate.sh --for full-suite            (A face — worktree scheduling)
#
# The budget is nproc-derived: on a 4-core box the whole repo may run 4 node --test processes at
# once.
#
# COUNTING SCOPE (gap-process-budget-counts-infra-as-test-concurrency-cap-pinned-1, AC2/AC5):
# `in_use` counts ONLY the THROTTLE-ABLE TEST processes — node processes whose cmdline marks them
# as a `node --test` worker (or a direct test-file run). Resident infrastructure — MCP servers
# (one per claude session: `quay.js mcp` / `quay.ts mcp` / `quay-native mcp`), web serve
# (`quay serve --host --port`), and the suite-state monitor (`suite-state-trigger.ts --monitor`)
# — is a CONSTANT, not throttle-able concurrency, and MUST NOT count against the test budget.
#
# WHY (the defect this fixes, measured 2026-08-08 19:1xZ): the old `in_use = pgrep -xc
# node-MainThread` counted EVERY node main process as a test worker. On this box that was 17
# processes — 14 MCP + 2 serve + 1 monitor + 0 test workers — so on a 4-core box
# (total_budget=4) `available` hit 0 and `effective_cap` was structurally pinned at 1 even when
# the cpu-pressure band said GO. Counting infra as throttle-able test concurrency is the same
# defect family as cap-avg300: a signal that folds infrastructure load into the throttle-able
# quantity structurally under-reports dispatch headroom.
#
# OVERLOAD PROTECTION RETAINED (AC4): `in_use` still counts REAL test workers. Injecting a real
# `node --test` run adds `--test`-flagged processes; available drops and the cap falls with it —
# the budget still prevents nested spawns from multiplying beyond nproc.
#
# LIVENESS SCOPE (gap-process-budget-counts-hung-test-processes-as-in-use, AC2/AC3/AC6):
# CLASSIFICATION ALONE IS NOT ENOUGH. A cmdline-classified test process may be a HUNG suite tree —
# a reparented orphan (PPID=1), alive for days, burning ~0 CPU — and the pre-fix `in_use` counted
# it forever. Measured 2026-09-11 on this host: `in_use=12` of which 10 were hung (6 dead suite
# trees, oldest 85 h, aggregate 2 CPU-seconds over a 30 s window vs 17,666 s of historical CPU);
# the consumer (`full-suite-runner.ts defaultLaneCount` = max(1, floor((nproc − in_use) × oversub
# / S))) was thereby pinned to its floor of 1 lane for the whole run (`--test-concurrency` is
# spliced at spawn and never recomputed), turning a ~20 min suite into ~3 h.
# `in_use` therefore counts a candidate ONLY IF it CONSUMED CPU during a sampling window:
#   * the discriminant is the process's /proc/<pid>/stat CPU-time delta (utime+stime, fields 14+15)
#     over `PROCESS_BUDGET_SAMPLE_WINDOW_MS` — a DIRECT host-observable quantity (硬规则 4b), never
#     a self-report, never an age threshold, never a process-count literal (硬规则 4 推论二: a
#     literal whose plausibility depends on this host's specs silently becomes a wrong limit on
#     another host). Measured separation 2026-09-11: a blocked (hung) node --test-shaped process
#     = 0 ticks/s; a running one = 104 ticks/s.
#   * excluded candidates are NOT silent (硬规则 3b): `--json` carries an enumerable `excluded`
#     array (pid, age_s, cpu_delta_ticks, reason, cmdline) and report mode carries `excluded_count`
#     — "excluded N" and "excluded none" are distinguishable in the output.
#   * ⛔ This does NOT reap hung processes — auto-reaping is a separate decision. The budget reading
#     simply stops counting them as in-use.
#   * Fast path: with NO candidates the window is skipped entirely (no sleep) — an idle host pays
#     nothing for this.
#
# `available` = max(0, total_budget − in_use).
#
# Usage:
#   plugin/scripts/process-budget.sh          # report mode: print numbers, exit 0
#   plugin/scripts/process-budget.sh --json   # same readings, ONE JSON document on stdout (AC99:
#                                             #   the System view's machine-readable interface)
#
# Output (stdout, one per line, report mode):
#   total_budget=N   # the nproc-derived upper limit (single authority)
#   in_use=N         # TEST (throttle-able) node --test processes currently running (all worktrees)
#   available=N      # max(0, total_budget − in_use)
#   verdict=GO|WAIT  # GO iff available ≥ 1
#   excluded_count=N # cmdline-matching candidates dropped by the LIVENESS window (AC6; 0 is a value)
#
# `--json` emits { total_budget, in_use, available, verdict, node_comm_mainthread,
#   node_cmdline_procs, instrument_failure, instrument_failure_note, excluded, excluded_count,
#   liveness_source, sample_window_ms } as one JSON object.
# Report-mode text output is byte-identical when `--json` is absent (cap-from-gate.ts parses it).
#
# Knob (the same definition-point pattern as 旋钮②/③ — read from env, never a bare literal at a
# use site):
#   PROCESS_BUDGET_SAMPLE_WINDOW_MS — the liveness sampling window in ms (default 1000, clamped to
#                                     200..3000 so the read stays well inside the 5 s timeout its
#                                     consumer `testProcessesInUse()` allows).
#
# Test seams (env overrides; for the unit test in plugin/test/resource-gate.test.mjs):
#   RESOURCE_GATE_TEST_NPROC         — override nproc (integer)
#   RESOURCE_GATE_TEST_NODE_PROCS    — override the FINAL in_use count (integer; the legacy seam —
#                                      pins in_use directly, exactly as the old pgrep-count seam did)
#   RESOURCE_GATE_TEST_PROC_CMDLINES — override the /proc cmdline LIST the classifier reads (one
#                                      cmdline per line, or semicolon-separated). Lets the unit test
#                                      pin the CLASSIFICATION deterministically. ⚠️ This seam has NO
#                                      pid, so the LIVENESS axis CANNOT be sampled from it: it pins
#                                      the CLASSIFICATION axis only and defaults every entry to
#                                      "live". The output carries `liveness_source` so a reader can
#                                      always tell which axis a reading actually exercised
#                                      (硬规则 3b — "无法评估" must not share the shape of "合格");
#                                      pair it with RESOURCE_GATE_TEST_PROC_LIVENESS to pin both.
#   RESOURCE_GATE_TEST_PROC_LIVENESS — semicolon-separated `live|hung` tokens aligned with the
#                                      RESOURCE_GATE_TEST_PROC_CMDLINES entries (default all
#                                      `live`). Lets the unit test pin the LIVENESS axis
#                                      deterministically without spawning real processes.
#   RESOURCE_GATE_TEST_SAMPLE_WINDOW_MS — alias for PROCESS_BUDGET_SAMPLE_WINDOW_MS (the same
#                                      single-definition-point value; tests use this name).

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

# AC99 — machine-readable interface: `--json` switches report mode to emit ONE JSON document on
# stdout (the System view consumes it). Report-mode TEXT output is unchanged when absent.
JSON=0
if [ "${1:-}" = "--json" ]; then
  JSON=1
elif [ -n "${1:-}" ]; then
  echo "usage: plugin/scripts/process-budget.sh [--json]" >&2
  exit 2
fi

# ── classification ──────────────────────────────────────────────────────────────────────────────────
# is_test_cmdline <cmdline> — classify one node-MainThread cmdline as a throttle-able TEST process.
# Whitelist, not blacklist:
#   * `--test` in the cmdline — covers node --test (the top-level runner) AND its child workers,
#     whose flags carry --test-concurrency / --test-coverage-* / --test-name-pattern /
#     --test-isolation / --test-timeout. Measured 2026-08-08: a `node --test --test-concurrency=1
#     <file>` run shows the runner `node --test --test-concurrency=1 <file>` and a child worker
#     `<node-binary> --test-coverage-functions=0 --test-concurrency=1 ... <file>`.
#   * a test-file path argument (…test.mjs / …test.js / …test.ts / …_test.mjs / …_test.js) — a
#     direct run of a test file without --test.
# Everything else is infrastructure — `… mcp`, `… serve --host --port`, `… suite-state-trigger.ts
# --monitor`, `… session-liveness.sh` — and returns 1 (NOT counted against the test budget).
is_test_cmdline() {
  local cmdline="${1:-}"
  [ -n "${cmdline}" ] || return 1
  case "${cmdline}" in
    *--test*)  return 0 ;;
  esac
  case "${cmdline}" in
    *.test.mjs|*.test.js|*.test.ts|*.test.mts|*.test.cts|*_test.mjs|*_test.js) return 0 ;;
  esac
  return 1
}

# list_node_cmdline — enumerate node pids WITH their cmdline ("pid<TAB>cmdline" per line), from ONE
# `ps -ww -e -o pid= -o args=` pass. A node process's argv[0] (the first args field) is the node
# binary (`node` or a path ending in `/node`) — stable across hosts/Node versions.
# (gap-node-mainthread-comm-literal-host-dependent) The `node-MainThread` comm literal is
# HOST-DEPENDENT: boheidc (Node v24.19.0) reports comm=`MainThread`, so any enumeration keyed on it
# silently returns 0 there (measured: comm `node-MainThread`=0 while cmdline node candidates=64, the
# real node count). The comm literal survives ONLY as the dual-read self-check cross-count
# (count_comm_node_mainthread). NEVER `ps | grep node`: grepping for "node" matches npm / node-*/
# other node-named comms, and on this box grep is a ugrep function so a `grep -v grep` exclusion
# silently fails — the grep process itself gets counted (gap-fixed-cap-5-dynamic-cap-retired AC4: the
# "报 5 实 1" overcount was exactly an infra-counted-as-test miscount). Fail-open: a pid that exited
# between the ps snapshot and classification is simply not in the snapshot — never wedges the budget.
list_node_cmdline() {
  ps -ww -e -o pid= -o etimes= -o args= 2>/dev/null | awk '
    {
      exe = $3
      if (exe == "node" || exe ~ /\/node$/) {
        cmdline = substr($0, index($0, exe))
        print $1 "\t" $2 "\t" cmdline
      }
    }
  '
}

# list_node_cmdline_pids — just the pids (the dual-read cmdline candidate count + callers that only
# need the pid set).
list_node_cmdline_pids() {
  list_node_cmdline | cut -f1
}

# count_comm_node_mainthread — the OLD comm-literal count (`node-MainThread`), kept ONLY as the
# dual-read self-check cross-count. On hosts where Node's comm differs (boheidc comm=`MainThread`)
# this returns 0 while cmdline sees node procs — the instrument-failure signal. "Reading the
# relationship", not a hardcoded "correct" literal (CLAUDE.md hard rule 4 推论二).
count_comm_node_mainthread() {
  ps -e -o pid= -o comm= 2>/dev/null | awk '$2 == "node-MainThread" { c++ } END { print c+0 }'
}

# test_candidates — enumerate the node processes that CLASSIFY as throttle-able tests, one
# "pid<TAB>etimes<TAB>cmdline" per line (the candidate set the liveness window then filters).
test_candidates() {
  local pid etimes cmdline
  while IFS=$'\t' read -r pid etimes cmdline; do
    [ -n "${pid:-}" ] || continue
    if is_test_cmdline "${cmdline}"; then printf '%s\t%s\t%s\n' "${pid}" "${etimes}" "${cmdline}"; fi
  done < <(list_node_cmdline)
}

# read_test_procs — CLASSIFICATION-ONLY count of the test candidates. This is the numeric-degradation
# fallback for a broken in_use reading (`if ! [[ in_use =~ ^[0-9]+$ ]]`) — it deliberately has NO
# liveness axis, i.e. it is the PRE-gap-process-budget-counts-hung-test-processes-as-in-use
# semantics: when the measured reading is unusable we fall back to the conservative (higher) count
# rather than silently under-reporting the budget.
read_test_procs() {
  local count=0 pid etimes cmdline
  while IFS=$'\t' read -r pid etimes cmdline; do
    [ -n "${pid:-}" ] || continue
    if is_test_cmdline "${cmdline}"; then count=$((count + 1)); fi
  done < <(list_node_cmdline)
  echo "${count}"
}

# ── LIVENESS WINDOW (gap-process-budget-counts-hung-test-processes-as-in-use) ───────────────────────
# proc_cpu_ticks <pid> — total CPU ticks (utime+stime = /proc/<pid>/stat fields 14+15) of a pid, or
# the EMPTY STRING when the pid is gone/unreadable. A DIRECT kernel-reported quantity — the process
# is never asked about itself (硬规则 4b: a quantity produced by the observed object cannot judge
# the observed object). Fail-open: an unreadable pid simply yields no reading (the caller treats it
# as "not consuming"), which is exactly the "process has exited" case.
proc_cpu_ticks() {
  awk '{print $14 + $15}' "/proc/${1}/stat" 2>/dev/null || true
}

# ts_field <text> — render one TAB-separated record field. A cmdline can contain TAB / newline (both
# would corrupt the record layout) and a node --test child cmdline runs ~1.5 KB (a dozen of them would
# bloat the --json document for no reader benefit), so squash whitespace and cap the length. Purely a
# transport concern — never an input to classification.
ts_field() {
  local s="${1//$'\t'/ }"
  s="${s//$'\n'/ }"
  printf '%s' "${s:0:160}"
}

# sample_cpu_ticks — stdin = one pid per line; stdout = "pid<TAB>ticks" for every pid that is still
# readable at sample time. Pids that vanished between the ps snapshot and the sample are simply
# absent from the output (never wedges the budget).
sample_cpu_ticks() {
  local pid ticks
  while IFS= read -r pid; do
    [ -n "${pid}" ] || continue
    ticks="$(proc_cpu_ticks "${pid}")"
    [ -n "${ticks}" ] && printf '%s\t%s\n' "${pid}" "${ticks}"
  done
  return 0
}

total_budget="${RESOURCE_GATE_TEST_NPROC:-$(nproc 2>/dev/null || echo 1)}"

# in_use = the throttle-able TEST process count — candidates that CONSUMED CPU during the sampling
# window (the LIVENESS axis, gap-process-budget-counts-hung-test-processes-as-in-use).
# Seams (highest precedence last):
#   RESOURCE_GATE_TEST_PROC_CMDLINES + RESOURCE_GATE_TEST_PROC_LIVENESS — classify this provided
#                                      cmdline list instead of /proc, with the liveness axis pinned
#                                      by the aligned `live|hung` tokens (no real pids ⇒ the window
#                                      cannot be sampled, so the seam must supply the axis);
#   RESOURCE_GATE_TEST_NODE_PROCS    — pin the final in_use number directly (legacy seam).
EXCLUDED_TSV="$(mktemp 2>/dev/null || echo /dev/null)"
trap 'rm -f "${EXCLUDED_TSV}"' EXIT
excluded_count=0
liveness_source="sampled"

# The window knob — the same single-definition-point pattern as 旋钮②/③ (read from env, never a
# bare literal at a use site). Clamped so the worst case (200..3000 ms) plus the two ps passes and
# the /proc reads stays well inside the 5 s timeout testProcessesInUse() allows its child.
sample_window_ms="${RESOURCE_GATE_TEST_SAMPLE_WINDOW_MS:-${PROCESS_BUDGET_SAMPLE_WINDOW_MS:-1000}}"
if ! [[ "${sample_window_ms}" =~ ^[0-9]+$ ]]; then sample_window_ms=1000; fi
if [ "${sample_window_ms}" -lt 200 ]; then sample_window_ms=200; fi
if [ "${sample_window_ms}" -gt 3000 ]; then sample_window_ms=3000; fi
sample_window_s="$(awk -v ms="${sample_window_ms}" 'BEGIN{printf "%.3f", ms/1000}')"

if [ -n "${RESOURCE_GATE_TEST_PROC_CMDLINES:-}" ]; then
  # CLASSIFICATION-ONLY seam: a provided cmdline list carries no pid, so the LIVENESS axis CANNOT be
  # sampled from it — entries default to `live` and `liveness_source` says so. Pair with
  # RESOURCE_GATE_TEST_PROC_LIVENESS to pin both axes (硬规则 3b: never let "not evaluated" share
  # the shape of "passed").
  liveness_source="classification-only-seam"
  seam_liveness="${RESOURCE_GATE_TEST_PROC_LIVENESS:-}"
  if [ -n "${seam_liveness}" ]; then liveness_source="seam"; fi
  in_use=0
  idx=0
  while IFS= read -r line; do
    [ -n "${line}" ] || continue
    idx=$((idx + 1))
    if ! is_test_cmdline "${line}"; then continue; fi
    token="$(printf '%s' "${seam_liveness}" | cut -d';' -f "${idx}")"
    if [ -z "${seam_liveness}" ] || [ "${token}" = "live" ]; then
      in_use=$((in_use + 1))
    else
      excluded_count=$((excluded_count + 1))
      printf '%s\t%s\t%s\t%s\t%s\n' "-" "0" "0" "seam:${token:-hung}" "$(ts_field "${line}")" >> "${EXCLUDED_TSV}"
    fi
  done <<< "${RESOURCE_GATE_TEST_PROC_CMDLINES//;/$'\n'}"
else
  candidates="$(test_candidates)"
  if [ -z "${candidates}" ]; then
    # Fast path: with no candidates the window is skipped entirely — an idle host pays no sleep.
    in_use=0
  else
    declare -A ticks_a=() ticks_b=()
    while IFS=$'\t' read -r pid ticks; do
      if [ -n "${pid}" ]; then ticks_a["${pid}"]="${ticks}"; fi
    done < <(printf '%s\n' "${candidates}" | cut -f1 | sample_cpu_ticks)
    sleep "${sample_window_s}"
    while IFS=$'\t' read -r pid ticks; do
      if [ -n "${pid}" ]; then ticks_b["${pid}"]="${ticks}"; fi
    done < <(printf '%s\n' "${candidates}" | cut -f1 | sample_cpu_ticks)
    in_use=0
    while IFS=$'\t' read -r pid etimes cmdline; do
      [ -n "${pid:-}" ] || continue
      before="${ticks_a[${pid}]:-}"
      after="${ticks_b[${pid}]:-}"
      if [ -z "${after}" ]; then
        # Gone before the second sample ⇒ not consuming; listed, never silently dropped.
        excluded_count=$((excluded_count + 1))
        printf '%s\t%s\t%s\t%s\t%s\n' "${pid}" "${etimes}" "0" "exited_during_window" "$(ts_field "${cmdline}")" >> "${EXCLUDED_TSV}"
      elif [ "$(( after - before ))" -gt 0 ]; then
        in_use=$((in_use + 1))
      else
        excluded_count=$((excluded_count + 1))
        printf '%s\t%s\t%s\t%s\t%s\n' "${pid}" "${etimes}" "$(( after - before ))" "no_cpu_delta" "$(ts_field "${cmdline}")" >> "${EXCLUDED_TSV}"
      fi
    done <<< "${candidates}"
  fi
fi
if [ -n "${RESOURCE_GATE_TEST_NODE_PROCS:-}" ]; then
  in_use="${RESOURCE_GATE_TEST_NODE_PROCS}"
  liveness_source="pinned"
fi

# Guard: a non-numeric seam degrades to the real read (a broken seam must never wedge the budget).
if ! [[ "${total_budget}" =~ ^[0-9]+$ ]]; then total_budget="$(nproc 2>/dev/null || echo 1)"; fi
if ! [[ "${in_use}" =~ ^[0-9]+$ ]]; then in_use="$(read_test_procs)"; fi

# ── dual-read self-check (gap-node-mainthread-comm-literal-host-dependent, AC1b) ─────────────────────
# The comm literal is host-dependent, so the budget NEVER trusts it as the enumeration source — but it
# IS cross-read against the cmdline candidate count to DETECT a host whose comm differs (the boheidc
# shape): comm_count==0 && cmdline_count>0 ⇒ the old literal silently reads 0 ⇒ report INSTRUMENT
# FAILURE (a reader must never misread "0" as "machine idle"). "Reading the relationship", not the
# literal — the check needs NO knowledge of the correct comm, so it works across machines/Node
# versions. Seams override both sides for deterministic tests:
#   RESOURCE_GATE_TEST_COMM_COUNT    — override the comm exact-match count (integer)
#   RESOURCE_GATE_TEST_CMDLINE_COUNT — override the cmdline node-candidate count (integer)
comm_count="${RESOURCE_GATE_TEST_COMM_COUNT:-$(count_comm_node_mainthread)}"
cmdline_count="${RESOURCE_GATE_TEST_CMDLINE_COUNT:-$(list_node_cmdline_pids | wc -l)}"
instrument_failure=0
if [ "${comm_count}" -eq 0 ] && [ "${cmdline_count}" -gt 0 ]; then
  instrument_failure=1
fi

available=$(( total_budget - in_use ))
if [ "${available}" -lt 0 ]; then available=0; fi

verdict="WAIT"
if [ "${available}" -ge 1 ]; then verdict="GO"; fi

if [ "${JSON}" = "1" ]; then
  # AC99 — ONE JSON document (the System view's machine-readable source). Values are the SAME
  # measurements as report mode; only the transport changes. instrument_failure_note is null when
  # no instrument failure was detected (硬规则③b: "未检测到" is a distinct value, never a blank).
  python3 - "${total_budget}" "${in_use}" "${available}" "${verdict}" "${comm_count}" "${cmdline_count}" "${instrument_failure}" "${EXCLUDED_TSV}" "${excluded_count}" "${liveness_source}" "${sample_window_ms}" <<'PYEOF'
import json, sys
total, in_use, avail, verdict, comm, cmdline, instr, exc_path, exc_count, liveness_source, window_ms = (
    sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6], sys.argv[7],
    sys.argv[8], sys.argv[9], sys.argv[10], sys.argv[11])
note = None
if instr == "1":
    note = f"comm 字面量 node-MainThread 恒 0 但 cmdline 见 {cmdline} 个 node 进程 —— comm 是宿主/Node 版本相关的（本机 comm 为 MainThread）; 读数以 cmdline 为准，勿按 comm 判空"
# AC6 — the EXCLUDED processes, enumerable (硬规则 3b: "excluded N" and "excluded none" must be
# distinguishable in the output; "not evaluated" must not share the shape of "passed").
excluded = []
try:
    with open(exc_path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 5:
                continue
            pid, age_s, delta, reason, cmd = parts[0], parts[1], parts[2], parts[3], parts[4]
            excluded.append({
                "pid": int(pid) if pid.isdigit() else pid,
                "age_s": int(age_s) if age_s.isdigit() else None,
                "cpu_delta_ticks": int(delta) if delta.lstrip("-").isdigit() else None,
                "reason": reason,
                "cmdline": cmd,
            })
except OSError:
    excluded = []
print(json.dumps({
    "total_budget": int(total),
    "in_use": int(in_use),
    "available": int(avail),
    "verdict": verdict,
    "node_comm_mainthread": int(comm),
    "node_cmdline_procs": int(cmdline),
    "instrument_failure": int(instr),
    "instrument_failure_note": note,
    "excluded": excluded,
    "excluded_count": int(exc_count),
    "liveness_source": liveness_source,
    "sample_window_ms": int(window_ms),
}, ensure_ascii=False))
PYEOF
  exit 0
fi

printf 'total_budget=%s\n' "${total_budget}"
printf 'in_use=%s\n' "${in_use}"
printf 'available=%s\n' "${available}"
printf 'verdict=%s\n' "${verdict}"
printf 'node_comm_mainthread=%s\n' "${comm_count}"
printf 'node_cmdline_procs=%s\n' "${cmdline_count}"
printf 'instrument_failure=%s\n' "${instrument_failure}"
printf 'excluded_count=%s\n' "${excluded_count}"
printf 'liveness_source=%s\n' "${liveness_source}"
if [ "${instrument_failure}" = "1" ]; then
  printf 'instrument_failure_note=comm 字面量 node-MainThread 恒 0 但 cmdline 见 %s 个 node 进程 —— comm 是宿主/Node 版本相关的（本机 comm=MainThread）; 读数以 cmdline 为准，勿按 comm 判空\n' "${cmdline_count}"
fi
exit 0
