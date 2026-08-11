#!/usr/bin/env bash
# plugin/scripts/resource-gate.sh — the shared resource gate for heavy operations
# (gap-loop-mechanism-lives-outside-the-package-and-cannot-ship: moved here from scripts/; all
#  callers now use this canonical path — no old-path shim left behind)
# (gap-no-resource-awareness-heavy-ops-run-blind).
#
# Both layers (inner loop's test.sh, outer loop's orchestrator-loop-tick) call this BEFORE a heavy
# operation (a full test suite) instead of each layer eyeballing `load` and guessing. It reads
# structural signals — `/proc/pressure/cpu`, `free -m` available, `pgrep -xc node-MainThread` —
# prints numbers AND verdicts, and exits 0=GO / non-0=WAIT.
#
# Why PSI stays the PRIMARY signal (AC2): `/proc/pressure/cpu` `some avg10` measures "the fraction
# of time some task was stalled waiting for CPU" directly — the structural CPU-contention quantity.
# But PSI ALONE missed the load-flake driver (gap-resource-gate-psi-does-not-capture-load-flake-driver):
# round-230/231/232 loop-shipping passed=false at load 6.4/6.04/11.76 with PSI some avg10 8-10 < 60
# and the gate returned GO — the red rounds tracked LOAD (the /proc/loadavg 1-min runnable +
# uninterruptible queue depth, which includes the loop's own claude sessions), not PSI. Load average
# is therefore a SUPPLEMENTARY overload-window criterion (load >= nproc × LOAD_OVER_FACTOR ⇒ WAIT),
# NOT a replacement — PSI stays primary. Same proxy→structural arc as orchestrator-loop-tick.md
# step 0b's table.
#
# Usage:
#   plugin/scripts/resource-gate.sh                    # report mode: print numbers + verdict, exit 0
#   plugin/scripts/resource-gate.sh --for full-suite     # gate mode:   WAIT → exit non-0 (fail-closed)
#
# Contract (from the task's ## Contract block):
#   measure   cpu_stall   = /proc/pressure/cpu 的 some avg10 字段
#   measure   mem_avail   = free -m 的 available 列 (MB)
#   measure   heavy_procs = pgrep -xc node-MainThread 的计数
#   measure   loadavg     = /proc/loadavg 的 1-min 字段（过载窗口补充判据, gap-resource-gate-psi-does-not-capture-load-flake-driver）
#   band      cpu_ok      = some avg10 < 60
#   band      load_ok     = load < nproc × LOAD_OVER_FACTOR（默认 2）——过载窗口 WAIT
#   invariant nproc 在判定前后一致
#   invariant psi_still_waits = PSI 高位仍 WAIT（load 判据不削弱 PSI 主判据）
#   invoke    `plugin/scripts/resource-gate.sh --for full-suite`
#   control   人为把 cpu some avg10 压高（起 N 个 busy loop）⇒ gate 必须返回 WAIT
#   control   注入 load ≥ nproc×2（RESOURCE_GATE_TEST_LOAD_OVERRIDE）⇒ gate 必须返回 WAIT
#
# AC4 — the node-process count uses `pgrep -xc node-MainThread` (exact `comm` match). NOT `pgrep -f`
# (matches any cmdline containing "node", including the caller) and NOT `grep -x node` (Node's comm
# is `node-MainThread`, so that spelling always returns 0 — this repo has stepped on both twice).
#
# AC10 — orphaned node processes (ppid=1 AND cwd ends with " (deleted)") are printed as a separate
# line. They do NOT participate in the GO/WAIT verdict — but if they are never listed, they are
# never discovered (measured 2026-08-03: two, alive 17.4h, ~200MB — the same shape as stranded
# worktrees: finished work nobody reclaimed, with no alarm channel).
#
# Test seams (env overrides; for the unit test in plugin/test/resource-gate.test.mjs):
#   RESOURCE_GATE_TEST_CPU_AVG10    — override the cpu some avg10 reading (float)
#   RESOURCE_GATE_TEST_MEM_AVAIL_MB — override the mem_avail reading (MB, integer)
#   RESOURCE_GATE_TEST_NODE_PROCS   — override the pgrep count (integer)
#   RESOURCE_GATE_TEST_ORPHANS      — override the orphan list ("pid:cwd" semicolon-separated)
#   RESOURCE_GATE_TEST_NPROC        — override nproc (integer; also used for the invariant check)
#
# CROSS-LAYER TOTAL BUDGET (gap-test-concurrency-cap-does-not-scope-nested-spawns AC1, the A face):
# the gate REPORTS the same shared total-process-budget authority
# (plugin/scripts/process-budget.sh — total_budget = nproc, in_use = node-MainThread procs across
# ALL worktrees) that scripts/test.sh's default_concurrency_formula and cap-from-gate.ts consume.
# A worktree's full-suite caller and the outer runner therefore see the shared budget numbers, not a
# per-layer read. Fail-open: an unreadable authority prints `unreadable` rather than wedging the gate.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="report"        # report | full-suite
# CPU_LIMIT — the binary full-suite gate's WAIT threshold on cpu `some avg10`. UNIFIED with
# cap-from-gate.ts's WAIT_THRESHOLD (60, the mechanism constant; see
# gap-resource-gate-two-thresholds-test-sh-vs-cap-from-gate): the full-suite gate refuses a suite
# EXACTLY when the dispatch cap would leave the GO band — a load in the 40-60 region used to make
# the suite WAIT (old limit 40) while dispatch kept GO (cap go<60), the "suite refuses + dispatch
# continues" imbalance that can form a red-window loop. The drift invariant is pinned mechanically
# in plugin/test/resource-gate.test.mjs (CPU_LIMIT default == cap-from-gate WAIT_THRESHOLD).
CPU_LIMIT="${RESOURCE_GATE_CPU_LIMIT:-60}"
MEM_LIMIT_MB="${RESOURCE_GATE_MEM_LIMIT_MB:-2048}"
# ── AC3 (gap-resource-gate-psi-does-not-capture-load-flake-driver) ────────────────────────────────────
# LOAD_OVER_FACTOR — the OVERLOAD-WINDOW supplementary criterion. PSI `some avg10` measures CPU
# contention directly but MISSED the load-flake driver: a machine at load 11.76 / nproc=4 (~3×
# oversubscription) with PSI only 8.27 (< 60) returned GO and the round started into an overload
# window (loop-shipping flake at load 6.4/6.04/11.76, round-230/231/232). Load average (the
# /proc/loadavg 1-min field — runnable + uninterruptible queue depth, including the loop's own
# claude sessions) is what actually tracked the red rounds. It is a SUPPLEMENT to PSI, NOT a
# replacement: load >= nproc × LOAD_OVER_FACTOR ⇒ WAIT only refuses the overload window; the PSI
# band below stays the primary/structural CPU-contention gate.
LOAD_OVER_FACTOR="${RESOURCE_GATE_LOAD_OVER_FACTOR:-2}"
# ── AC2 (gap-worktree-scoped-runs-consume-resources-but-produce-no-signal) ───────────────────────────
# main-repo vs worktree priority: the main repo's full-suite caller passes --main-repo-priority; the
# gate then RELAXES the CPU verdict when the blocking load is worktree-sourced (deferrable). A
# worktree's own full-suite caller does NOT pass the flag — worktree runs are deferrable and must
# yield to the machine like any other heavy op.
PRIORITY=0                     # 1 = caller passed --main-repo-priority (AC2)
WORKTREE_LOAD_MIN="${RESOURCE_GATE_WORKTREE_LOAD_MIN:-4}"              # min worktree node --test procs to consider worktree load "dominant"
WORKTREE_PRIORITY_CEILING="${RESOURCE_GATE_WORKTREE_PRIORITY_CEILING:-85}"  # cpu avg10 above which even priority refuses (machine too loaded)

# ── argument parsing ───────────────────────────────────────────────────────────────────────────────
case "${1:-}" in
  --for)
    if [ "${2:-}" = "full-suite" ]; then
      MODE="full-suite"
      # AC2 (gap-worktree-scoped-runs-consume-resources-but-produce-no-signal): the main repo's
      # full-suite caller MAY pass --main-repo-priority. Unknown extra args fail-closed (usage).
      shift 2
      for extra in "$@"; do
        if [ "${extra}" = "--main-repo-priority" ]; then
          PRIORITY=1
        else
          echo "usage: plugin/scripts/resource-gate.sh [--for full-suite [--main-repo-priority]]" >&2
          exit 2
        fi
      done
    else
      echo "usage: plugin/scripts/resource-gate.sh [--for full-suite [--main-repo-priority]]" >&2
      exit 2
    fi
    ;;
  ""|-h|--help)
    # No args = report mode (print numbers + verdict, always exit 0). -h/--help prints the header.
    if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
    fi
    ;;
  *)
    echo "usage: plugin/scripts/resource-gate.sh [--for full-suite [--main-repo-priority]]" >&2
    exit 2
    ;;
esac

# ── readings (structural signals) ──────────────────────────────────────────────────────────────────

# cpu some avg10 from /proc/pressure/cpu (line 1: some avg10=.. avg60=.. avg300=.. total=..)
read_cpu_avg10() {
  awk 'NR==1{for(i=1;i<=NF;i++){if($i ~ /^avg10=/){sub(/^avg10=/,"",$i); print $i; exit}}}' \
    /proc/pressure/cpu
}

# cpu some avg300 from /proc/pressure/cpu (5-minute window — the ADAPTIVE-CONCURRENCY signal;
# gap-adaptive-concurrency-cap-tied-to-resource-gate AC2: avg300 matches the dispatch rhythm
# (25-min tick / 15-90-min subagents), avg10 (10s) is 1-2 orders of magnitude faster than the
# actuator and would react to jitter that dispatch cannot track). Same parse as avg10, different field.
read_cpu_avg300() {
  awk 'NR==1{for(i=1;i<=NF;i++){if($i ~ /^avg300=/){sub(/^avg300=/,"",$i); print $i; exit}}}' \
    /proc/pressure/cpu
}

# mem available in MB (the `available` column of `free -m`, NOT the `free` column — AC contract).
read_mem_avail_mb() {
  free -m | awk 'NR==2{print $7}'
}

# swap total in kB (0 ⇒ no degradation ramp; OOM is a cliff).
read_swap_kb() {
  awk '/^SwapTotal:/{print $2}' /proc/meminfo
}

# 1-minute load average from /proc/loadavg (field 1) — the OVERLOAD-WINDOW supplementary signal
# (gap-resource-gate-psi-does-not-capture-load-flake-driver AC3). Unlike PSI (CPU contention only),
# load average counts runnable + uninterruptible tasks — it includes I/O wait and the loop's own
# claude sessions, the quantities that tracked the red rounds (load 6.4/6.04/11.76 while PSI 8-10).
read_loadavg() {
  awk '{print $1}' /proc/loadavg
}

# real node process count — exact `comm` match (AC4).
read_node_procs() {
  pgrep -xc node-MainThread 2>/dev/null || echo 0
}

# orphaned node processes: ppid=1 AND cwd ends with " (deleted)". Informational only (AC10).
read_orphans() {
  local pid ppid cwd
  while IFS= read -r pid; do
    [ -n "${pid:-}" ] || continue
    ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
    [ "${ppid:-}" = "1" ] || continue
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    case "$cwd" in
      *" (deleted)"*) printf 'pid=%s ppid=1 cwd=%s\n' "$pid" "$cwd" ;;
    esac
  done < <(pgrep -x node-MainThread 2>/dev/null || true)
}

# ── worktree-awareness (gap-worktree-scoped-runs-consume-resources-but-produce-no-signal) ────────────
# The gate's job is "don't start a heavy op into a busy machine". But when the machine is busy BECAUSE
# of worktree scoped runs (node --test processes spawned inside linked worktrees), that load is
# DEFERRABLE — a worktree scoped run's completion updates nothing anyone waits on — while the MAIN
# repo's full-suite is the signal subagents actually wait for. The gate distinguishes the two so the
# main-repo suite is not PERMANENTLY blocked by worktree load (the resource-sink-with-no-signal
# deadlock: machine full, nobody producing the waited-for signal).
#
# caller_scope — is the CALLER the main repo, a linked worktree, or unknown (non-git)?
#   main:     git-dir == git-common-dir (the primary checkout)
#   worktree: git-dir != git-common-dir (a linked worktree)
#   unknown:  git unavailable (non-git copy) — fail-closed: no priority override
detect_caller_scope() {
  local git_dir common_dir gd cd
  git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
  common_dir="$(git rev-parse --git-common-dir 2>/dev/null || true)"
  if [ -z "${git_dir}" ] || [ -z "${common_dir}" ]; then echo "unknown"; return; fi
  case "${git_dir}" in /*) gd="${git_dir}" ;; *) gd="$(pwd)/${git_dir}" ;; esac
  case "${common_dir}" in /*) cd="${common_dir}" ;; *) cd="$(pwd)/${common_dir}" ;; esac
  if [ "${gd}" = "${cd}" ]; then echo "main"; else echo "worktree"; fi
}

# Linked-worktree paths (git worktree list --porcelain EXCLUDING the primary checkout). The primary is
# always the first entry; the main repo's OWN node --test processes are NOT worktree-sourced.
read_linked_worktree_paths() {
  git worktree list --porcelain 2>/dev/null | awk '
    /^worktree /{ if(!first){first=$2} else {print $2} }
  ' || true
}

# Count node --test (node-MainThread) processes whose cwd is inside a linked worktree — the deferrable
# worktree-scoped load. The ## Contract measure (`ps ... | grep /quay-worktrees/`) is the path-derived
# equivalent: any node --test running from a linked worktree is worktree-scoped. cwd-based, not
# args-based, so a worktree node --test is detected even when its args do not spell the worktree path.
read_worktree_node_tests() {
  local count=0 pid cwd
  local -a paths
  mapfile -t paths < <(read_linked_worktree_paths)
  if [ "${#paths[@]}" -eq 0 ]; then echo 0; return; fi
  for pid in $(pgrep -x node-MainThread 2>/dev/null || true); do
    cwd="$(readlink "/proc/${pid}/cwd" 2>/dev/null || true)"
    [ -n "${cwd}" ] || continue
    local p
    for p in "${paths[@]}"; do
      [ -n "${p}" ] || continue
      case "${cwd}" in
        "${p}"|"${p}"/*) count=$((count+1)); break ;;
      esac
    done
  done
  echo "${count}"
}

# ── apply readings (test-seam overrides honored) ───────────────────────────────────────────────────
cpu_stall="${RESOURCE_GATE_TEST_CPU_AVG10:-$(read_cpu_avg10)}"
# avg300 — the adaptive-concurrency signal (AC2). Its own test seam so cap-from-gate can be
# driven deterministically WITHOUT disturbing the avg10 verdict the gate's own GO/WAIT uses.
cpu_stall_avg300="${RESOURCE_GATE_TEST_CPU_AVG300:-$(read_cpu_avg300)}"
mem_avail_mb="${RESOURCE_GATE_TEST_MEM_AVAIL_MB:-$(read_mem_avail_mb)}"
# Test seam: the literal value "unmeasurable" forces the fail-closed path deterministically
# (simulates a missing /proc/pressure/cpu — kernel without PSI).
if [ "${RESOURCE_GATE_TEST_CPU_AVG10:-}" = "unmeasurable" ]; then
  cpu_stall=""
fi
if [ "${RESOURCE_GATE_TEST_CPU_AVG300:-}" = "unmeasurable" ]; then
  cpu_stall_avg300=""
fi
if [ "${RESOURCE_GATE_TEST_MEM_AVAIL_MB:-}" = "unmeasurable" ]; then
  mem_avail_mb=""
fi
swap_kb="${RESOURCE_GATE_TEST_SWAP_KB:-$(read_swap_kb)}"
load_avg="${RESOURCE_GATE_TEST_LOAD_OVERRIDE:-$(read_loadavg)}"
# Test seam: the literal value "unmeasurable" forces the fail-closed path deterministically
# (simulates a missing /proc/loadavg — the overload-window signal is required for a GO verdict,
# same reasoning as the CPU signal: a gate that silently opens when a signal is missing is a
# quietly-lying instrument).
if [ "${RESOURCE_GATE_TEST_LOAD_OVERRIDE:-}" = "unmeasurable" ]; then
  load_avg=""
fi
node_procs="${RESOURCE_GATE_TEST_NODE_PROCS:-$(read_node_procs)}"
# gap-systemd-run-cpuquota-scope-distorts-nproc — the OVERLOAD-WINDOW criterion compares the HOST-WIDE
# loadavg against a processor count, so it must use the HOST online CPU count, not the cgroup-scoped
# nproc. full-suite-runner.ts wraps the suite in `systemd-run --user --scope -p CPUQuota=200%`, inside
# which `nproc` reads 2 on a 4-core host — a scoped nproc undercounts host capacity and turns a mild
# 1.25× host load (5.0/4) into a permanent false WAIT (5.0 ≥ 2×2=4), aborting the suite at 0 tests
# (verified: the runner's own gate consultation, run OUTSIDE the scope, GOes at nproc=4 while test.sh's
# internal fail-closed gate INSIDE the scope WAITs at nproc=2; the load-over calibration in the
# LOAD_OVER_FACTOR comment is host nproc). `nproc --all` reports the host online CPU count regardless
# of the caller's affinity/cgroup; RESOURCE_GATE_TEST_NPROC remains the deterministic test seam.
nproc_before="${RESOURCE_GATE_TEST_NPROC:-$(nproc --all 2>/dev/null || nproc 2>/dev/null || echo 1)}"
if [ -n "${RESOURCE_GATE_TEST_ORPHANS:-}" ]; then
  orphan_list="${RESOURCE_GATE_TEST_ORPHANS}"
else
  orphan_list="$(read_orphans)"
fi
# worktree-awareness (gap-worktree-scoped-runs-consume-resources-but-produce-no-signal) readings.
# Both have deterministic test seams (the unit test drives the AC2 priority rule without needing real
# worktrees or real node --test processes).
caller_scope="${RESOURCE_GATE_TEST_CALLER_SCOPE:-$(detect_caller_scope)}"
worktree_node_tests="${RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS:-$(read_worktree_node_tests)}"

# ── invariant: nproc must not change between the before-read and the after-read ─────────────────────
# The host-CPU read (nproc --all, see the comment at nproc_before) must be stable within one gate
# invocation — the same before/after identity check as the scoped read it replaced.
nproc_after="$(nproc --all 2>/dev/null || nproc 2>/dev/null || echo 1)"
nproc_invariant="ok"
if [ "${nproc_after}" != "${nproc_before}" ]; then
  nproc_invariant="CHANGED (${nproc_before} → ${nproc_after})"
fi

# ── verdicts ───────────────────────────────────────────────────────────────────────────────────────
cpu_wait=0
mem_wait=0
if [ -z "${cpu_stall}" ] || ! awk -v v="$cpu_stall" 'BEGIN{exit !(v ~ /^[0-9]+(\.[0-9]+)?$/)}'; then
  # /proc/pressure/cpu unreadable (kernel < 4.20, no PSI) — FAIL CLOSED. A gate that silently opens
  # when its signal is unmeasurable is a quietly-lying instrument (the exact class this task exists
  # to kill). The operator must resolve why the structural signal is missing before running heavy ops.
  cpu_stall="UNMEASURABLE"
  cpu_wait=1
elif awk -v v="$cpu_stall" -v l="$CPU_LIMIT" 'BEGIN{exit !(v >= l)}'; then
  cpu_wait=1
fi
if [ -z "${mem_avail_mb}" ] || ! awk -v v="$mem_avail_mb" 'BEGIN{exit !(v ~ /^[0-9]+$/)}'; then
  # free -m unreadable — fail closed (same reasoning as the CPU guard above).
  mem_avail_mb="UNMEASURABLE"
  mem_wait=1
elif awk -v v="$mem_avail_mb" -v l="$MEM_LIMIT_MB" 'BEGIN{exit !(v < l)}'; then
  mem_wait=1
fi

# ── load-average verdict (the OVERLOAD-WINDOW supplementary criterion, AC3) ───────────────────────────
# load_wait=1 when load >= nproc × LOAD_OVER_FACTOR — the machine is in an overload window even if
# PSI some avg10 is still below the CPU limit (round-232: load 11.76 / nproc 4, PSI 8.27 < 60, old
# gate GO). Unmeasurable load fails closed (same reasoning as the CPU guard).
load_wait=0
if [ -z "${load_avg}" ] || ! awk -v v="$load_avg" 'BEGIN{exit !(v ~ /^[0-9]+(\.[0-9]+)?$/)}'; then
  load_avg="UNMEASURABLE"
  load_wait=1
elif awk -v v="$load_avg" -v n="$nproc_before" -v f="$LOAD_OVER_FACTOR" 'BEGIN{exit !(v >= n*f)}'; then
  load_wait=1
fi

swap_label="swap=0"
if [ "${swap_kb:-0}" != "0" ]; then
  swap_label="swap=$((swap_kb / 1024))MB"
fi

# ── output: numbers + limits, then the verdict line ────────────────────────────────────────────────
if [ "$cpu_stall" = "UNMEASURABLE" ]; then
  printf 'cpu_stall(some avg10)=%s  [limit %s]   %s\n' "$cpu_stall" "$CPU_LIMIT" "WAIT"
else
  printf 'cpu_stall(some avg10)=%.2f  [limit %s]   %s\n' \
    "$cpu_stall" "$CPU_LIMIT" "$([ "$cpu_wait" = 1 ] && echo WAIT || echo ok)"
fi
# avg300 line — consumed by cap-from-gate (adaptive concurrency). Stable field name for the parser.
if [ -z "${cpu_stall_avg300}" ]; then
  printf 'cpu_stall(some avg300)=UNMEASURABLE\n'
else
  printf 'cpu_stall(some avg300)=%.2f\n' "$cpu_stall_avg300"
fi
printf 'mem_avail=%sMB             [limit %s] %s\n' \
  "$mem_avail_mb" "$MEM_LIMIT_MB" "$([ "$mem_wait" = 1 ] && echo WAIT || echo ok)"
# loadavg line — the OVERLOAD-WINDOW supplementary reading (AC3). Stable field name for parsers
# (cap-from-gate reads it via report mode so the cap's observation stays in sync with the gate).
load_threshold="$(awk -v n="$nproc_before" -v f="$LOAD_OVER_FACTOR" 'BEGIN{printf "%.0f", n*f}')"
if [ "$load_avg" = "UNMEASURABLE" ]; then
  printf 'loadavg=%s             [limit nproc×%s≈%s] %s\n' "$load_avg" "$LOAD_OVER_FACTOR" "$load_threshold" "WAIT"
else
  printf 'loadavg=%.2f             [limit nproc×%s≈%s] %s\n' \
    "$load_avg" "$LOAD_OVER_FACTOR" "$load_threshold" "$([ "$load_wait" = 1 ] && echo WAIT || echo ok)"
fi
printf 'nproc=%s  node_procs=%s  %s  [nproc-invariant %s]\n' \
  "$nproc_before" "$node_procs" "$swap_label" "$nproc_invariant"
# AC1 (gap-test-concurrency-cap-does-not-scope-nested-spawns) — the CROSS-LAYER total budget line
# from the shared authority (process-budget.sh, same script test.sh/cap-from-gate read). A worktree
# caller sees total_budget / budget_in_use / budget_available — the numbers that bound EVERY layer's
# concurrency — instead of this gate's single-machine node_procs read alone.
budget_report="$(bash "${SCRIPT_DIR}/process-budget.sh" 2>/dev/null || true)"
budget_total="$(printf '%s\n' "${budget_report}" | sed -n 's/^total_budget=//p')"
budget_in_use="$(printf '%s\n' "${budget_report}" | sed -n 's/^in_use=//p')"
budget_available="$(printf '%s\n' "${budget_report}" | sed -n 's/^available=//p')"
printf 'total_budget=%s  budget_in_use=%s  budget_available=%s  [cross-layer budget authority: process-budget.sh]\n' \
  "${budget_total:-unreadable}" "${budget_in_use:-unreadable}" "${budget_available:-unreadable}"
# AC1 (gap-worktree-scoped-runs-consume-resources-but-produce-no-signal) — the observable worktree
# signal: how many node --test processes are running from linked worktrees right now + who is asking.
# Report mode always prints this; waiters read it instead of guessing why the machine is loaded.
printf 'worktree_node_tests=%s  caller_scope=%s\n' "$worktree_node_tests" "$caller_scope"

if [ -n "${orphan_list}" ]; then
  # Accept both newline-separated (real read_orphans) and semicolon-separated (test seam).
  printf '%s\n' "${orphan_list//;/$'\n'}" | while IFS= read -r o; do
    [ -n "$o" ] || continue
    printf 'orphan_node: %s\n' "$o"
  done
fi

# ── AC2 priority override (main-repo full suite vs worktree scoped load) ────────────────────────────
# When the MAIN repo's full suite asks the gate (--main-repo-priority) and the machine's load is
# dominated by WORKTREE-sourced node --test processes (deferrable — a worktree scoped run whose
# completion updates nothing anyone waits on), the main-repo suite is ALLOWED to proceed despite a
# CPU-WAIT (and a load-WAIT — worktree-sourced load is exactly what pushes load average high):
# blocking it re-creates the deadlock this task exists to kill (machine full, no signal). Three
# guards keep the override safe:
#   1. PRIORITY=1 — the caller must OPT IN (the full-suite-runner passes it for the main repo only);
#   2. caller_scope = main — a worktree full-suite caller is itself deferrable (no override);
#   3. cpu_stall < WORKTREE_PRIORITY_CEILING — above it the machine is too loaded to run ANY heavy
#      op regardless of provenance (the main suite would tear itself apart / hit cancelled).
# mem_wait is NEVER overridden — running out of RAM is an OOM cliff, not a deferrable load.
# NB the flake-driver scenario (load high from the loop's OWN claude sessions, round-230/231/232)
# is NOT overridden: there worktree_node_tests is typically < WORKTREE_LOAD_MIN, so the override
# does not fire and the overload-window WAIT stands.
priority_override=0
if [ "${PRIORITY}" = "1" ] && [ "${caller_scope}" = "main" ] && [ "${MODE}" = "full-suite" ] && \
   [ "${mem_wait}" = "0" ] && \
   awk -v v="${worktree_node_tests}" -v m="${WORKTREE_LOAD_MIN}" 'BEGIN{exit !(v ~ /^[0-9]+$/ && v >= m)}' && \
   awk -v v="${cpu_stall}" -v c="${WORKTREE_PRIORITY_CEILING}" 'BEGIN{exit !(v ~ /^[0-9]+(\.[0-9]+)?$/ && v < c)}'; then
  priority_override=1
  printf 'worktree_priority: ON (main-repo full suite — worktree scoped load %s node --test deferrable; CPU ceiling %s)\n' \
    "$worktree_node_tests" "$WORKTREE_PRIORITY_CEILING"
fi

# ── verdict line ───────────────────────────────────────────────────────────────────────────────────
if [ "$priority_override" = "1" ]; then
  printf '=> GO: 主仓 full-suite 优先——阻塞负载来自 worktree scoped（可延后，%s node --test），主仓套件是等在等的信号；CPU 未超 ceiling %s（AC2）\n' \
    "$worktree_node_tests" "$WORKTREE_PRIORITY_CEILING"
elif [ "$cpu_wait" = 1 ] && [ "$mem_wait" = 1 ]; then
  if [ "$cpu_stall" = "UNMEASURABLE" ]; then
    printf '=> WAIT: 无法读取 /proc/pressure/cpu（内核无 PSI?）且内存不足——结构信号缺失时 fail-closed\n'
  else
    printf '=> WAIT: CPU 饥饿 且 内存不足。重型测试在此负载下会超时（实测 48.8s vs 隔离 2.0s），OOM 无降级段\n'
  fi
elif [ "$cpu_wait" = 1 ]; then
  if [ "$cpu_stall" = "UNMEASURABLE" ]; then
    printf '=> WAIT: 无法读取 /proc/pressure/cpu（内核无 PSI?）——结构信号缺失时必须 fail-closed\n'
  else
    printf '=> WAIT: CPU 饥饿（some avg10 >= %s）。重型测试在此负载下会超时（实测 48.8s vs 隔离 2.0s）\n' "$CPU_LIMIT"
  fi
elif [ "$mem_wait" = 1 ]; then
  if [ "${swap_kb:-0}" = "0" ]; then
    printf '=> WAIT: 内存不足（mem_avail < %sMB）。swap=0，OOM 是悬崖不是斜坡；RSS 最大的进程正是 claude 会话本身\n' "$MEM_LIMIT_MB"
  else
    printf '=> WAIT: 内存不足（mem_avail < %sMB，swap 有限）。OOM 时最先被杀的仍是 RSS 最大的 claude 会话\n' "$MEM_LIMIT_MB"
  fi
elif [ "$load_wait" = 1 ]; then
  if [ "$load_avg" = "UNMEASURABLE" ]; then
    printf '=> WAIT: 无法读取 /proc/loadavg（load 信号缺失）——过载窗口判据 fail-closed\n'
  else
    printf '=> WAIT: 过载窗口（load %.2f >= nproc×%s≈%s）。实测 load 11.76/nproc=4 时 PSI 仅 8.27<60 ⇒ 红轮在过载窗口起跑（loop-shipping flake 反复）\n' \
      "$load_avg" "$LOAD_OVER_FACTOR" "$load_threshold"
  fi
else
  printf '=> GO: 资源充足，可以跑\n'
fi

if [ "$mem_wait" = 1 ] && [ "$MODE" = "full-suite" ]; then
  # AC6: when memory is short, refuse the full suite AND print the current top-5 RSS processes —
  # the OOM killer picks the biggest, which is usually the inner/outer session itself.
  echo "== RSS top-5 (AC6: OOM killer 的目标 — claude 会话 RSS 424-793MB) =="
  ps -eo pid,ppid,rss,comm --sort=-rss 2>/dev/null | head -6
fi

# ── exit code: report mode always 0; gate mode 0=GO / 1=WAIT ───────────────────────────────────────
if [ "$MODE" = "full-suite" ]; then
  if [ "$priority_override" = "1" ]; then
    # AC2 — the main-repo full suite proceeds despite CPU-WAIT / load-WAIT (worktree-sourced load is
    # deferrable); memory is still a hard blocker (OOM cliff).
    [ "$mem_wait" = 0 ]
  else
    [ "$cpu_wait" = 0 ] && [ "$mem_wait" = 0 ] && [ "$load_wait" = 0 ]
  fi
  exit $?
fi
exit 0
