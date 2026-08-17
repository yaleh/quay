#!/usr/bin/env bash
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
#
# `--json` emits { total_budget, in_use, available, verdict, node_comm_mainthread,
#   node_cmdline_procs, instrument_failure, instrument_failure_note } as one JSON object.
# Report-mode text output is byte-identical when `--json` is absent (cap-from-gate.ts parses it).
#
# Test seams (env overrides; for the unit test in plugin/test/resource-gate.test.mjs):
#   RESOURCE_GATE_TEST_NPROC         — override nproc (integer)
#   RESOURCE_GATE_TEST_NODE_PROCS    — override the FINAL in_use count (integer; the legacy seam —
#                                      pins in_use directly, exactly as the old pgrep-count seam did)
#   RESOURCE_GATE_TEST_PROC_CMDLINES — override the /proc cmdline LIST the classifier reads (one
#                                      cmdline per line, or semicolon-separated). Lets the unit test
#                                      pin the CLASSIFICATION deterministically.

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
  ps -ww -e -o pid= -o args= 2>/dev/null | awk '
    {
      exe = $2
      if (exe == "node" || exe ~ /\/node$/) {
        cmdline = substr($0, index($0, exe))
        print $1 "\t" cmdline
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

# read_test_procs — count node processes currently running that classify as TEST
# (throttle-able). One ps pass (list_node_cmdline) enumerates node candidates with their cmdline;
# each is classified by is_test_cmdline. No per-pid /proc read.
read_test_procs() {
  local count=0 pid cmdline
  while IFS=$'\t' read -r pid cmdline; do
    [ -n "${pid:-}" ] || continue
    if is_test_cmdline "${cmdline}"; then count=$((count + 1)); fi
  done < <(list_node_cmdline)
  echo "${count}"
}

# classify_cmdlines <text> — test-seam classifier over a PROVIDED cmdline list (newline- or
# semicolon-separated) instead of reading /proc. Lets the unit test pin the classification
# (RESOURCE_GATE_TEST_PROC_CMDLINES) without needing real node --test processes.
classify_cmdlines() {
  local text="${1:-}" count=0 line
  while IFS= read -r line; do
    [ -n "${line}" ] || continue
    if is_test_cmdline "${line}"; then count=$((count + 1)); fi
  done <<< "${text//;/$'\n'}"
  echo "${count}"
}

total_budget="${RESOURCE_GATE_TEST_NPROC:-$(nproc 2>/dev/null || echo 1)}"

# in_use = the throttle-able TEST process count. Seams (highest precedence last):
#   RESOURCE_GATE_TEST_PROC_CMDLINES — classify this provided cmdline list instead of /proc;
#   RESOURCE_GATE_TEST_NODE_PROCS   — pin the final in_use number directly (legacy seam).
if [ -n "${RESOURCE_GATE_TEST_PROC_CMDLINES:-}" ]; then
  in_use="$(classify_cmdlines "${RESOURCE_GATE_TEST_PROC_CMDLINES}")"
else
  in_use="$(read_test_procs)"
fi
if [ -n "${RESOURCE_GATE_TEST_NODE_PROCS:-}" ]; then
  in_use="${RESOURCE_GATE_TEST_NODE_PROCS}"
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
  python3 - "${total_budget}" "${in_use}" "${available}" "${verdict}" "${comm_count}" "${cmdline_count}" "${instrument_failure}" <<'PYEOF'
import json, sys
total, in_use, avail, verdict, comm, cmdline, instr = (sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6], sys.argv[7])
note = None
if instr == "1":
    note = f"comm 字面量 node-MainThread 恒 0 但 cmdline 见 {cmdline} 个 node 进程 —— comm 是宿主/Node 版本相关的（本机 comm 为 MainThread）; 读数以 cmdline 为准，勿按 comm 判空"
print(json.dumps({
    "total_budget": int(total),
    "in_use": int(in_use),
    "available": int(avail),
    "verdict": verdict,
    "node_comm_mainthread": int(comm),
    "node_cmdline_procs": int(cmdline),
    "instrument_failure": int(instr),
    "instrument_failure_note": note,
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
if [ "${instrument_failure}" = "1" ]; then
  printf 'instrument_failure_note=comm 字面量 node-MainThread 恒 0 但 cmdline 见 %s 个 node 进程 —— comm 是宿主/Node 版本相关的（本机 comm=MainThread）; 读数以 cmdline 为准，勿按 comm 判空\n' "${cmdline_count}"
fi
exit 0
