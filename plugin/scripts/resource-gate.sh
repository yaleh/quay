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
# Why PSI over load average (AC2): load is a PROXY — it counts uninterruptible I/O and is a 1-minute
# smoothed EWMA, lagging real contention. `/proc/pressure/cpu` `some avg10` measures "the fraction
# of time some task was stalled waiting for CPU" directly — exactly the quantity we care about.
# Same proxy→structural arc as orchestrator-loop-tick.md step 0b's table.
#
# Usage:
#   plugin/scripts/resource-gate.sh                    # report mode: print numbers + verdict, exit 0
#   plugin/scripts/resource-gate.sh --for full-suite     # gate mode:   WAIT → exit non-0 (fail-closed)
#
# Contract (from the task's ## Contract block):
#   measure   cpu_stall   = /proc/pressure/cpu 的 some avg10 字段
#   measure   mem_avail   = free -m 的 available 列 (MB)
#   measure   heavy_procs = pgrep -xc node-MainThread 的计数
#   band      cpu_ok      = some avg10 < 40
#   invariant nproc 在判定前后一致
#   invoke    `plugin/scripts/resource-gate.sh --for full-suite`
#   control   人为把 cpu some avg10 压高（起 N 个 busy loop）⇒ gate 必须返回 WAIT
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

set -euo pipefail

MODE="report"        # report | full-suite
CPU_LIMIT="${RESOURCE_GATE_CPU_LIMIT:-40}"
MEM_LIMIT_MB="${RESOURCE_GATE_MEM_LIMIT_MB:-2048}"

# ── argument parsing ───────────────────────────────────────────────────────────────────────────────
case "${1:-}" in
  --for)
    if [ "${2:-}" = "full-suite" ]; then
      MODE="full-suite"
    else
      echo "usage: plugin/scripts/resource-gate.sh [--for full-suite]" >&2
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
    echo "usage: plugin/scripts/resource-gate.sh [--for full-suite]" >&2
    exit 2
    ;;
esac

# ── readings (structural signals) ──────────────────────────────────────────────────────────────────

# cpu some avg10 from /proc/pressure/cpu (line 1: some avg10=.. avg60=.. avg300=.. total=..)
read_cpu_avg10() {
  awk 'NR==1{for(i=1;i<=NF;i++){if($i ~ /^avg10=/){sub(/^avg10=/,"",$i); print $i; exit}}}' \
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

# ── apply readings (test-seam overrides honored) ───────────────────────────────────────────────────
cpu_stall="${RESOURCE_GATE_TEST_CPU_AVG10:-$(read_cpu_avg10)}"
mem_avail_mb="${RESOURCE_GATE_TEST_MEM_AVAIL_MB:-$(read_mem_avail_mb)}"
# Test seam: the literal value "unmeasurable" forces the fail-closed path deterministically
# (simulates a missing /proc/pressure/cpu — kernel without PSI).
if [ "${RESOURCE_GATE_TEST_CPU_AVG10:-}" = "unmeasurable" ]; then
  cpu_stall=""
fi
if [ "${RESOURCE_GATE_TEST_MEM_AVAIL_MB:-}" = "unmeasurable" ]; then
  mem_avail_mb=""
fi
swap_kb="${RESOURCE_GATE_TEST_SWAP_KB:-$(read_swap_kb)}"
node_procs="${RESOURCE_GATE_TEST_NODE_PROCS:-$(read_node_procs)}"
nproc_before="${RESOURCE_GATE_TEST_NPROC:-$(nproc 2>/dev/null || echo 1)}"
if [ -n "${RESOURCE_GATE_TEST_ORPHANS:-}" ]; then
  orphan_list="${RESOURCE_GATE_TEST_ORPHANS}"
else
  orphan_list="$(read_orphans)"
fi

# ── invariant: nproc must not change between the before-read and the after-read ─────────────────────
nproc_after="$(nproc 2>/dev/null || echo 1)"
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
printf 'mem_avail=%sMB             [limit %s] %s\n' \
  "$mem_avail_mb" "$MEM_LIMIT_MB" "$([ "$mem_wait" = 1 ] && echo WAIT || echo ok)"
printf 'nproc=%s  node_procs=%s  %s  [nproc-invariant %s]\n' \
  "$nproc_before" "$node_procs" "$swap_label" "$nproc_invariant"

if [ -n "${orphan_list}" ]; then
  # Accept both newline-separated (real read_orphans) and semicolon-separated (test seam).
  printf '%s\n' "${orphan_list//;/$'\n'}" | while IFS= read -r o; do
    [ -n "$o" ] || continue
    printf 'orphan_node: %s\n' "$o"
  done
fi

# ── verdict line ───────────────────────────────────────────────────────────────────────────────────
if [ "$cpu_wait" = 1 ] && [ "$mem_wait" = 1 ]; then
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
  [ "$cpu_wait" = 0 ] && [ "$mem_wait" = 0 ]
  exit $?
fi
exit 0
