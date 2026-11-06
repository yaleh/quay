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
# FALSE-NEGATIVE HALF OF THAT AXIS (gap-process-budget-in-use-undercounts-real-test-load, 2026-11-06):
# the single-window CPU-delta test above was BINARY (consumed ticks ⇒ live, else ⇒ hung), so it read
# a genuinely-live worker as dead whenever the worker happened to burn 0 ticks inside that one
# second. Measured 2026-11-06 17:00 on this 128-vCPU / 246 GB shared host while `loadavg` was 158 and
# 45-66 `test-isolation=process` workers were alive: `--json` returned `in_use=12` — and its
# `excluded[]` listed LIVE workers with `reason:"no_cpu_delta"` (e.g. `node --test
# test/belief-loop-landing.test.mjs`). The consumer's `nproc − in_use` term therefore subtracted
# nothing, and suites took the full 64..128 lanes. That reading LOOKS healthy (12 < 128, verdict GO)
# — the 硬规则 4 推论三 / 3b shape: a wrong number wearing the shape of a correct one.
#
# The fix has TWO independent halves; either alone would still misclassify a real case:
#   1. TREE LIVENESS — a `node --test` RUNNER blocks on its children's output and therefore burns
#      ~0 CPU itself while its worker children burn CPU. Self-delta alone calls the runner dead.
#      So a candidate with 0 SELF delta is also counted when ANY of its DESCENDANTS consumed CPU in
#      the window (the whole /proc process tree is sampled, not just node processes — a test tree
#      whose child is `bash` still registers). Reported separately (`live_by_descendant_cpu`) so a
#      reader can tell a self-burning worker from a delegating runner.
#   2. STARTING ≠ HUNG — a process too YOUNG for the window to be evidence (`age < sample window`)
#      is not "did not run", it is "the instrument has not observed it long enough to say". It gets
#      its own state (`unknown[]`, `reason:"unknown_cpu_delta"`) and is COUNTED in `in_use`
#      (conservative direction: a live process must never be hidden). The hung verdict keeps its
#      own conditions — 0 CPU for the whole window AND an age the window cannot excuse — so the
#      exclusion axis is intact (AC3 negative control).
#   Both halves consume only kernel-reported quantities (硬规则 4b): /proc/<pid>/stat CPU ticks,
#   PPID, starttime, and /proc/uptime. No self-report, no host-spec literal (硬规则 4 推论二).
#
#   * `age_s` is derived from /proc/<pid>/stat field 22 (starttime) + /proc/uptime, never from
#     `ps -o etimes=`: MEASURED 2026-11-06 on this host, procps-ng 4.0.4 returns etimes=4123168608
#     (2^32-ish, ~130 years) for ordinary short-lived processes — a probe sign that "returns a
#     number" while being wrong. An unreadable age is `null`, never a plausible-looking number
#     (硬规则 3b: "cannot evaluate" must not share the shape of a value).
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
#   unknown_count=N  # live-but-unobservable (starting / unreadable age) — COUNTED in in_use, listed
#                    #   in `unknown[]` (never folded into `excluded[]`)
#   classified_test_candidates=N  # cmdline-classified test processes (the slice in_use comes from)
#   infra_node_procs=N            # node procs that are NOT throttle-able test concurrency
#   live_by_self_cpu=N / live_by_descendant_cpu=N / count_identity=ok|BROKEN|not-evaluated
#                                 # AC5 — the named decomposition of node_cmdline_procs − in_use
#
# `--json` emits { total_budget, in_use, available, verdict, node_comm_mainthread,
#   node_cmdline_procs, instrument_failure, instrument_failure_note, excluded, excluded_count,
#   unknown, unknown_count, classified_test_candidates, infra_node_procs, live_by_self_cpu,
#   live_by_descendant_cpu, count_accounting, liveness_source, sample_window_ms } as one JSON object.
# Report-mode text output is byte-identical when `--json` is absent (cap-from-gate.ts parses it);
# the fields above are APPENDED, so every pre-existing `key=value` line keeps its position.
#
# Knob (the same definition-point pattern as 旋钮②/③ — read from env, never a bare literal at a
# use site):
#   PROCESS_BUDGET_SAMPLE_WINDOW_MS — the liveness sampling window in ms (default 1000, clamped to
#                                     200..2000 so the read stays well inside the 5 s timeout its
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
# ⛔ The `etimes` column that used to ride along here is GONE: process AGE now comes from
# /proc/<pid>/stat starttime + /proc/uptime (see READ_AGE_AWK) because `ps -o etimes=` on this host
# (procps-ng 4.0.4) returns 4123168608 for ordinary short-lived processes (measured 2026-11-06) —
# a number that looks like a reading and is not one.
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


# count_comm_node_mainthread — the OLD comm-literal count (`node-MainThread`), kept ONLY as the
# dual-read self-check cross-count. On hosts where Node's comm differs (boheidc comm=`MainThread`)
# this returns 0 while cmdline sees node procs — the instrument-failure signal. "Reading the
# relationship", not a hardcoded "correct" literal (CLAUDE.md hard rule 4 推论二).
count_comm_node_mainthread() {
  ps -e -o pid= -o comm= 2>/dev/null | awk '$2 == "node-MainThread" { c++ } END { print c+0 }'
}

# filter_test_candidates <node-proc-list> — the node processes that CLASSIFY as throttle-able tests,
# one "pid<TAB>cmdline" per line (the candidate set the liveness window then filters). Takes the ONE
# node enumeration as an ARGUMENT so `node_cmdline_procs` and the candidate set come from the SAME
# snapshot — AC5's identity (`node_cmdline_procs = infra_node_procs + classified_test_candidates`) is
# then true BY CONSTRUCTION. Two independent `ps` passes would make the identity false at random
# (processes spawn/die between them), i.e. it would read BROKEN on a perfectly healthy host — a
# false-alarm instrument is worse than no instrument (硬规则 3b).
filter_test_candidates() {
  local pid cmdline
  while IFS=$'\t' read -r pid cmdline; do
    [ -n "${pid:-}" ] || continue
    if is_test_cmdline "${cmdline}"; then printf '%s\t%s\n' "${pid}" "${cmdline}"; fi
  done <<< "${1:-}"
}

# count_nonblank <text> — count the non-empty lines of a captured list (no subprocess: this runs on
# the budget's hot path and its consumer allows 5 s for the whole read).
count_nonblank() {
  local n=0 line
  while IFS= read -r line; do
    [ -n "${line}" ] && n=$((n + 1))
  done <<< "${1:-}"
  printf '%s' "${n}"
}

# read_test_procs — CLASSIFICATION-ONLY count of the test candidates. This is the numeric-degradation
# fallback for a broken in_use reading (`if ! [[ in_use =~ ^[0-9]+$ ]]`) — it deliberately has NO
# liveness axis, i.e. it is the PRE-gap-process-budget-counts-hung-test-processes-as-in-use
# semantics: when the measured reading is unusable we fall back to the conservative (higher) count
# rather than silently under-reporting the budget.
read_test_procs() {
  local count=0 pid cmdline
  while IFS=$'\t' read -r pid cmdline; do
    [ -n "${pid:-}" ] || continue
    if is_test_cmdline "${cmdline}"; then count=$((count + 1)); fi
  done < <(list_node_cmdline)
  echo "${count}"
}

# ── LIVENESS WINDOW (gap-process-budget-counts-hung-test-processes-as-in-use +
#    gap-process-budget-in-use-undercounts-real-test-load) ────────────────────────────────────────
# PROC_STAT_AWK — print "pid<TAB>ppid<TAB>utime+stime<TAB>starttime" for each pid named on stdin (one
# per line), reading /proc/<pid>/stat directly. A DIRECT kernel-reported quantity — the process is
# never asked about itself (硬规则 4b: a quantity produced by the observed object cannot judge the
# observed object). ONE awk for the WHOLE process table (not one spawn per pid, and not only the
# candidates): the descendant half of the liveness axis needs every pid's PPID + CPU delta.
# The comm field (stat field 2) is parenthesised and MAY CONTAIN SPACES AND PARENTHESES (a Node
# process that sets process.title does), so the field-split is anchored on the LAST ')' — a naive
# `$14 + $15` split mis-reads the CPU fields for such a process (and the naive split is exactly the
# 硬规则 4 「读数看似合理但是错的」 shape: it still returns a number). After the comm is dropped the
# first token is stat field 3, so fd 4 (ppid) is token 2, fd 14+15 (utime+stime) are tokens 12+13, and
# fd 22 (starttime, in clock ticks since boot) is token 20.
# A pid whose /proc entry is gone is simply absent from the output (fail-open — never wedges).
readonly PROC_STAT_AWK='
  {
    pid = $1
    if (pid == "") next
    path = "/proc/" pid "/stat"
    line = ""
    if ((getline line < path) <= 0) { close(path); next }
    close(path)
    sub(/^.*\)[ \t]*/, "", line)
    n = split(line, f, /[ \t]+/)
    if (n < 20) next
    print pid "\t" f[2] "\t" (f[12] + f[13]) "\t" f[20]
  }
'

# LIVENESS_CLASSIFY_AWK — ONE pass over (sample A) + (sample B) + (candidates), printing one
# classification record per candidate:
#   live_self   <TAB> pid <TAB> delta                       — consumed CPU itself
#   live_desc   <TAB> pid <TAB> delta <TAB> descendant_delta — 0 ticks itself, its TREE consumed CPU
#   starting    <TAB> pid <TAB> age_s                       — 0 ticks, but younger than the window ⇒
#                                                             NOT evidence of hang (counted in_use)
#   unknown_age <TAB> pid                                   — 0 ticks, age unreadable ⇒ counted
#   hung        <TAB> pid <TAB> age_s <TAB> delta           — 0 ticks for a full window AND old
#   exited      <TAB> pid                                   — gone before sample B
# The two conditions that make `hung` a verdict rather than a guess (AC3): zero CPU across the whole
# window AND an age the window cannot excuse. Age ALONE never decides anything — it only supplies the
# "the instrument has not observed this long enough to say" state (硬规则 3b: "cannot evaluate" gets
# its own value instead of sharing the shape of "hung" or of "live").
readonly LIVENESS_CLASSIFY_AWK='
  FILENAME == a_file {
    pp[$1] = $2; t0[$1] = $3; st[$1] = $4
    if ($2 != "" && $2 != $1) { nchild[$2]++; child[$2, nchild[$2]] = $1 }
    next
  }
  FILENAME == b_file {
    ppb[$1] = $2; t1[$1] = $3
    if ($2 != "" && $2 != $1) { nchild[$2]++; child[$2, nchild[$2]] = $1 }
    next
  }
  {
    pid = $1
    if (pid == "") next
    if (!(pid in t1)) { print "exited\t" pid; next }
    d = (pid in t0) ? (t1[pid] - t0[pid]) : t1[pid]
    if (d > 0) { print "live_self\t" pid "\t" d; next }
    sd = subtree_delta(pid)
    if (sd > 0) { print "live_desc\t" pid "\t" d "\t" sd; next }
    if (hertz <= 0 || !(pid in st)) { print "unknown_age\t" pid; next }
    age = uptime_s - (st[pid] / hertz)
    if (age < 0) age = 0
    if (age < window_s) { print "starting\t" pid "\t" int(age); next }
    print "hung\t" pid "\t" int(age) "\t" d
  }
  # subtree_delta(root) — sum of CPU-tick deltas over every DESCENDANT of root (strict; root itself is
  # excluded because its own delta already failed). This is the "the runner delegates" half: a
  # `node --test` runner blocked on its children burns ~0 ticks itself while the tree works.
  function subtree_delta(root,   stack, top, cur, i, k, sum, dd) {
    sum = 0; top = 0
    delete seenv
    seenv[root] = 1
    stack[top++] = root
    while (top > 0) {
      cur = stack[--top]
      for (i = 1; i <= nchild[cur]; i++) {
        k = child[cur, i]
        if (k in seenv) continue
        seenv[k] = 1
        if ((k in t0) && (k in t1)) dd = t1[k] - t0[k]
        else if (k in t1) dd = t1[k]
        else dd = 0
        if (dd > 0) sum += dd
        stack[top++] = k
      }
    }
    return sum
  }
'

# ts_field <text> — render one TAB-separated record field. A cmdline can contain TAB / newline (both
# would corrupt the record layout) and a node --test child cmdline runs ~1.5 KB (a dozen of them would
# bloat the --json document for no reader benefit), so squash whitespace and cap the length. Purely a
# transport concern — never an input to classification.
ts_field() {
  local s="${1//$'\t'/ }"
  s="${s//$'\n'/ }"
  printf '%s' "${s:0:160}"
}

# sample_proc_stats — stdin = one pid per line; stdout = a PROC_STAT_AWK record per pid still readable
# at sample time. Pids that vanished between the ps snapshot and the sample are simply absent from the
# output (never wedges the budget). One awk for the whole table.
sample_proc_stats() {
  awk "${PROC_STAT_AWK}"
}

# all_pids — every numeric /proc entry (the sampling universe for the process-tree axis). A shell glob,
# not a spawn-per-fork walk: no offsetting arithmetic, no host literal.
all_pids() {
  printf '%s\n' /proc/[0-9]* 2>/dev/null | sed 's#.*/##'
}

total_budget="${RESOURCE_GATE_TEST_NPROC:-$(nproc 2>/dev/null || echo 1)}"

# in_use = the throttle-able TEST process count — candidates that CONSUMED CPU during the sampling
# window (the LIVENESS axis, gap-process-budget-counts-hung-test-processes-as-in-use) — PLUS the
# candidates whose liveness the window could not evaluate (`starting` / `unknown_age`), which are
# COUNTED, because hiding a live process is the failure this script exists to prevent
# (gap-process-budget-in-use-undercounts-real-test-load).
# Seams (highest precedence last):
#   RESOURCE_GATE_TEST_PROC_CMDLINES + RESOURCE_GATE_TEST_PROC_LIVENESS — classify this provided
#                                      cmdline list instead of /proc, with the liveness axis pinned
#                                      by the aligned `live|hung|starting` tokens (no real pids ⇒ the
#                                      window cannot be sampled, so the seam must supply the axis);
#   RESOURCE_GATE_TEST_NODE_PROCS    — pin the final in_use number directly (legacy seam).
EXCLUDED_TSV="$(mktemp 2>/dev/null || echo /dev/null)"
UNKNOWN_TSV="$(mktemp 2>/dev/null || echo /dev/null)"
SAMPLE_A=""
SAMPLE_B=""
trap 'rm -f "${EXCLUDED_TSV}" "${UNKNOWN_TSV}" ${SAMPLE_A:+"${SAMPLE_A}"} ${SAMPLE_B:+"${SAMPLE_B}"}' EXIT
excluded_count=0
unknown_count=0
live_by_self_cpu=0
live_by_descendant_cpu=0
classified_test_candidates=0
liveness_source="sampled"

# The window knob — the same single-definition-point pattern as 旋钮②/③ (read from env, never a
# bare literal at a use site). The clamp bounds come from TWO EXTERNAL CONTRACTS, not from this host's
# specs (硬规则 4 推论二): the lower bound from /proc tick resolution (a 1 ms window cannot see a
# tick), the upper bound from `testProcessesInUse()`'s 5 s CHILD TIMEOUT — a timeout there degrades
# fail-open to in_use=0, i.e. the budget would silently stop throttling. MEASURED 2026-09-11 on a
# ~300-node-process host: the whole read costs ~0.34 s on top of the window (one ps pass per
# enumeration + ONE awk for all /proc reads), so window=2000 ms ran 2.34 s — 2.6 s of margin.
# The window is ALSO the "starting" boundary: a process younger than the window has not been observed
# long enough for one zero-window to mean "did not run" — the boundary is the INSTRUMENT's own
# resolution, not a host-spec literal.
sample_window_ms="${RESOURCE_GATE_TEST_SAMPLE_WINDOW_MS:-${PROCESS_BUDGET_SAMPLE_WINDOW_MS:-1000}}"
if ! [[ "${sample_window_ms}" =~ ^[0-9]+$ ]]; then sample_window_ms=1000; fi
if [ "${sample_window_ms}" -lt 200 ]; then sample_window_ms=200; fi
if [ "${sample_window_ms}" -gt 2000 ]; then sample_window_ms=2000; fi
sample_window_s="$(awk -v ms="${sample_window_ms}" 'BEGIN{printf "%.3f", ms/1000}')"

declare -A cmd_of=()
# ONE node-process enumeration snapshot: `node_cmdline_procs` and the candidate set are both derived
# from it (AC5 identity by construction — see filter_test_candidates).
node_procs="$(list_node_cmdline)"
node_proc_count="$(count_nonblank "${node_procs}")"
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
    classified_test_candidates=$((classified_test_candidates + 1))
    token="$(printf '%s' "${seam_liveness}" | cut -d';' -f "${idx}")"
    if [ -z "${seam_liveness}" ] || [ "${token}" = "live" ]; then
      in_use=$((in_use + 1))
      live_by_self_cpu=$((live_by_self_cpu + 1))
    elif [ "${token}" = "starting" ]; then
      # The third seam state: live-but-unobservable. COUNTED (conservative) and enumerated in
      # `unknown[]` — never in `excluded[]`, which is the hung verdict's home.
      in_use=$((in_use + 1))
      unknown_count=$((unknown_count + 1))
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "-" "-" "0" "0" "seam:starting" "$(ts_field "${line}")" >> "${UNKNOWN_TSV}"
    else
      excluded_count=$((excluded_count + 1))
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "-" "-" "0" "0" "seam:${token:-hung}" "$(ts_field "${line}")" >> "${EXCLUDED_TSV}"
    fi
  done <<< "${RESOURCE_GATE_TEST_PROC_CMDLINES//;/$'\n'}"
else
  candidates="$(filter_test_candidates "${node_procs}")"
  if [ -z "${candidates}" ]; then
    # Fast path: with no candidates the window is skipped entirely — an idle host pays no sleep.
    in_use=0
  else
    classified_test_candidates="$(count_nonblank "${candidates}")"
    while IFS=$'\t' read -r pid cmd; do
      [ -n "${pid:-}" ] || continue
      cmd_of["${pid}"]="${cmd}"
    done <<< "${candidates}"

    SAMPLE_A="$(mktemp 2>/dev/null || echo /dev/null)"
    SAMPLE_B="$(mktemp 2>/dev/null || echo /dev/null)"
    uptime_s="$(awk 'NR==1 { print $1; exit }' /proc/uptime 2>/dev/null || true)"
    if ! [[ "${uptime_s}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then uptime_s="-1"; fi
    # The kernel clock-tick rate — READ FROM THE HOST (getconf), never a literal 100 (硬规则 4 推论二:
    # a literal that happens to equal this host's HZ silently mis-scales every age on another host).
    # Unreadable ⇒ hertz=0 ⇒ ages are `null`, never a plausible-looking guess.
    hertz="$(getconf CLK_TCK 2>/dev/null || true)"
    if ! [[ "${hertz}" =~ ^[0-9]+$ ]]; then hertz=0; fi

    all_pids | sample_proc_stats > "${SAMPLE_A}"
    sleep "${sample_window_s}"
    all_pids | sample_proc_stats > "${SAMPLE_B}"

    in_use=0
    while IFS=$'\t' read -r kind pid f2 f3; do
      [ -n "${kind:-}" ] || continue
      cmd="${cmd_of[${pid}]:-}"
      case "${kind}" in
        live_self)
          in_use=$((in_use + 1)); live_by_self_cpu=$((live_by_self_cpu + 1)) ;;
        live_desc)
          in_use=$((in_use + 1)); live_by_descendant_cpu=$((live_by_descendant_cpu + 1)) ;;
        starting)
          # 0 CPU ticks but younger than the observation window ⇒ the window is not evidence of hang.
          in_use=$((in_use + 1)); unknown_count=$((unknown_count + 1))
          printf '%s\t%s\t%s\t%s\t%s\t%s\n' "${pid}" "${f2}" "0" "0" "unknown_cpu_delta" "$(ts_field "${cmd}")" >> "${UNKNOWN_TSV}" ;;
        unknown_age)
          in_use=$((in_use + 1)); unknown_count=$((unknown_count + 1))
          printf '%s\t%s\t%s\t%s\t%s\t%s\n' "${pid}" "-" "0" "0" "unknown_age" "$(ts_field "${cmd}")" >> "${UNKNOWN_TSV}" ;;
        hung)
          excluded_count=$((excluded_count + 1))
          printf '%s\t%s\t%s\t%s\t%s\t%s\n' "${pid}" "${f2}" "${f3:-0}" "0" "no_cpu_delta" "$(ts_field "${cmd}")" >> "${EXCLUDED_TSV}" ;;
        exited)
          excluded_count=$((excluded_count + 1))
          printf '%s\t%s\t%s\t%s\t%s\t%s\n' "${pid}" "-" "0" "0" "exited_during_window" "$(ts_field "${cmd}")" >> "${EXCLUDED_TSV}" ;;
      esac
    done < <(awk -v a_file="${SAMPLE_A}" -v b_file="${SAMPLE_B}" \
                 -v uptime_s="${uptime_s}" -v hertz="${hertz}" -v window_s="${sample_window_s}" \
                 "${LIVENESS_CLASSIFY_AWK}" "${SAMPLE_A}" "${SAMPLE_B}" <(printf '%s\n' "${candidates}"))
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
cmdline_count="${RESOURCE_GATE_TEST_CMDLINE_COUNT:-${node_proc_count}}"
instrument_failure=0
if [ "${comm_count}" -eq 0 ] && [ "${cmdline_count}" -gt 0 ]; then
  instrument_failure=1
fi

available=$(( total_budget - in_use ))
if [ "${available}" -lt 0 ]; then available=0; fi

verdict="WAIT"
if [ "${available}" -ge 1 ]; then verdict="GO"; fi

# ── AC5 — the NAMED decomposition of node_cmdline_procs vs in_use (硬规则 3b) ───────────────────────
# `node_cmdline_procs` counts EVERY node process on the box (1142 measured 2026-11-06, of which ~1100
# are resident claude/MCP/serve infrastructure) while `in_use` counts only the throttle-able test
# processes that are demonstrably alive. Reporting both WITHOUT the intervening terms is exactly how
# "in_use is two orders of magnitude low" stays invisible: the two numbers sit next to each other and
# nothing says why. So the gap is written out as an additive identity over three named buckets:
#   node_cmdline_procs = infra_node_procs + classified_test_candidates
#   classified_test_candidates = live_by_self_cpu + live_by_descendant_cpu + unknown_count + excluded_count
# (in the SAMPLED path; in_use == the first three of the second line).
# `evaluated` is false whenever a seam pinned one of the terms — then the identity is NOT evaluated
# and each identity reads `null`, never `false`/pass-shaped (硬规则 3b: "cannot evaluate" must not
# share the shape of a result).
infra_node_procs=$(( cmdline_count - classified_test_candidates ))
if [ "${infra_node_procs}" -lt 0 ]; then infra_node_procs=0; fi
count_identity="not-evaluated"
identity_cmdline=null
identity_candidates=null
identity_evaluated="false"
if [ -z "${RESOURCE_GATE_TEST_NODE_PROCS:-}" ] \
   && [ -z "${RESOURCE_GATE_TEST_CMDLINE_COUNT:-}" ] \
   && [ -z "${RESOURCE_GATE_TEST_PROC_CMDLINES:-}" ]; then
  identity_evaluated="true"
  identity_cmdline=false
  if [ "$(( infra_node_procs + classified_test_candidates ))" -eq "${cmdline_count}" ]; then identity_cmdline=true; fi
  identity_candidates=false
  if [ "$(( live_by_self_cpu + live_by_descendant_cpu + unknown_count + excluded_count ))" -eq "${classified_test_candidates}" ]; then identity_candidates=true; fi
  count_identity="ok"
  if [ "${identity_cmdline}" = "false" ] || [ "${identity_candidates}" = "false" ]; then count_identity="BROKEN"; fi
fi

if [ "${JSON}" = "1" ]; then
  # AC99 — ONE JSON document (the System view's machine-readable source). Values are the SAME
  # measurements as report mode; only the transport changes. instrument_failure_note is null when
  # no instrument failure was detected (硬规则③b: "未检测到" is a distinct value, never a blank).
  PB_TOTAL_BUDGET="${total_budget}" PB_IN_USE="${in_use}" PB_AVAILABLE="${available}" \
  PB_VERDICT="${verdict}" PB_COMM_COUNT="${comm_count}" PB_CMDLINE_COUNT="${cmdline_count}" \
  PB_INSTRUMENT_FAILURE="${instrument_failure}" PB_EXCLUDED_PATH="${EXCLUDED_TSV}" \
  PB_UNKNOWN_PATH="${UNKNOWN_TSV}" PB_LIVENESS_SOURCE="${liveness_source}" \
  PB_SAMPLE_WINDOW_MS="${sample_window_ms}" PB_UNKNOWN_COUNT="${unknown_count}" \
  PB_CLASSIFIED_CANDIDATES="${classified_test_candidates}" PB_INFRA_NODE_PROCS="${infra_node_procs}" \
  PB_LIVE_SELF="${live_by_self_cpu}" PB_LIVE_DESC="${live_by_descendant_cpu}" \
  PB_IDENTITY_EVALUATED="${identity_evaluated}" PB_IDENTITY_CMDLINE="${identity_cmdline}" \
  PB_IDENTITY_CANDIDATES="${identity_candidates}" PB_COUNT_IDENTITY="${count_identity}" \
  python3 - <<'PYEOF'
import json, os


def envnum(name, cast=int):
    raw = os.environ.get(name, "")
    return cast(raw)


note = None
if os.environ["PB_INSTRUMENT_FAILURE"] == "1":
    note = f"comm 字面量 node-MainThread 恒 0 但 cmdline 见 {os.environ['PB_CMDLINE_COUNT']} 个 node 进程 —— comm 是宿主/Node 版本相关的（本机 comm 为 MainThread）; 读数以 cmdline 为准，勿按 comm 判空"


def read_records(path):
    """Parse one TAB-separated record file: pid, age_s, cpu_delta, descendant_delta, reason, cmdline.
    A field spelled `-` is NOT a value — it becomes null (硬规则 3b: an unavailable age must never be
    rendered as a plausible number; the 4123168608 class of value is exactly what this prevents)."""
    out = []
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 6:
                    continue
                pid, age_s, delta, desc, reason, cmd = parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]
                out.append({
                    "pid": int(pid) if pid.isdigit() else pid,
                    "age_s": int(age_s) if age_s.isdigit() else None,
                    "cpu_delta_ticks": int(delta) if delta.lstrip("-").isdigit() else None,
                    "descendant_cpu_delta_ticks": int(desc) if desc.lstrip("-").isdigit() else None,
                    "reason": reason,
                    "cmdline": cmd,
                })
    except OSError:
        return []
    return out


# AC6 — the EXCLUDED processes, enumerable (硬规则 3b: "excluded N" and "excluded none" must be
# distinguishable in the output; "not evaluated" must not share the shape of "passed").
excluded = read_records(os.environ["PB_EXCLUDED_PATH"])
# AC2 — the live-but-unobservable processes. A SEPARATE array, never folded into `excluded`: their
# state ("starting" / age unreadable) is distinct from the hung verdict, and they ARE counted in
# `in_use`.
unknown = read_records(os.environ["PB_UNKNOWN_PATH"])

evaluated = os.environ["PB_IDENTITY_EVALUATED"] == "true"


def jsonbool(name):
    if not evaluated:
        return None
    return os.environ[name] == "true"


print(json.dumps({
    "total_budget": envnum("PB_TOTAL_BUDGET"),
    "in_use": envnum("PB_IN_USE"),
    "available": envnum("PB_AVAILABLE"),
    "verdict": os.environ["PB_VERDICT"],
    "node_comm_mainthread": envnum("PB_COMM_COUNT"),
    "node_cmdline_procs": envnum("PB_CMDLINE_COUNT"),
    "instrument_failure": envnum("PB_INSTRUMENT_FAILURE"),
    "instrument_failure_note": note,
    "excluded": excluded,
    "excluded_count": len(excluded),
    "unknown": unknown,
    "unknown_count": len(unknown),
    "classified_test_candidates": envnum("PB_CLASSIFIED_CANDIDATES"),
    "infra_node_procs": envnum("PB_INFRA_NODE_PROCS"),
    "live_by_self_cpu": envnum("PB_LIVE_SELF"),
    "live_by_descendant_cpu": envnum("PB_LIVE_DESC"),
    "count_accounting": {
        "evaluated": evaluated,
        "node_cmdline_procs_equals_infra_plus_candidates": jsonbool("PB_IDENTITY_CMDLINE"),
        "candidates_equal_live_plus_unknown_plus_excluded": jsonbool("PB_IDENTITY_CANDIDATES"),
        "identity": "node_cmdline_procs = infra_node_procs + classified_test_candidates; "
                    "classified_test_candidates = live_by_self_cpu + live_by_descendant_cpu + "
                    "unknown_count + excluded_count",
    },
    "liveness_source": os.environ["PB_LIVENESS_SOURCE"],
    "sample_window_ms": envnum("PB_SAMPLE_WINDOW_MS"),
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
# AC5 — the decomposition that explains node_cmdline_procs vs in_use (appended AFTER every
# pre-existing line so cap-from-gate.ts's anchored regexes keep matching byte-identically).
printf 'unknown_count=%s\n' "${unknown_count}"
printf 'classified_test_candidates=%s\n' "${classified_test_candidates}"
printf 'infra_node_procs=%s\n' "${infra_node_procs}"
printf 'live_by_self_cpu=%s\n' "${live_by_self_cpu}"
printf 'live_by_descendant_cpu=%s\n' "${live_by_descendant_cpu}"
printf 'count_identity=%s\n' "${count_identity}"
if [ "${instrument_failure}" = "1" ]; then
  printf 'instrument_failure_note=comm 字面量 node-MainThread 恒 0 但 cmdline 见 %s 个 node 进程 —— comm 是宿主/Node 版本相关的（本机 comm=MainThread）; 读数以 cmdline 为准，勿按 comm 判空\n' "${cmdline_count}"
fi
exit 0
