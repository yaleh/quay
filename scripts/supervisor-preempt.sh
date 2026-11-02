#!/usr/bin/env bash
# supervisor-preempt.sh — the supervisor base layer's PREEMPTION primitive
# (tasks/gap-supervisor-preemption + tasks/gap-supervisor-step-4-preemption, 落地次序 step ④;
#  SPEC-integration-architecture §4.4 #4).
#
# TWO preemption families live here, both driven by QUERYABLE FACTS only:
#   (A) halt preemption (gap-supervisor-preemption) — `.halt` takes effect at ANY execution point;
#   (B) timeout preemption (gap-supervisor-step-4-preemption) — a task over the 90-minute budget
#       with no real progress is deterministically listed and preempted. The criterion reads
#       process/duration/slot/status facts — NEVER task content (the off-limits criterion).
#
# `.halt` is currently checked at the TICK BOUNDARY (tick step 0). Tonight's incident 7:
# after `.halt` was placed, inner STILL dispatched 5 subagents and merged 4 times — the
# continuous flow has no step 0, so the tick-boundary-only rule was bypassed
# (SPEC-state-crystallization §2.1: ".halt 是『规则正确但缺机械挂载点』的实例").
#
# THIS SCRIPT IS THE MECHANICAL MOUNT POINT. It makes `.halt` PREEMPTIVE — it takes effect at
# ANY execution point, not just the next tick boundary. (The former `halt-check` .halt-read
# subcommand was retired 2026-08-29 with gap-retire-halt-file-driver-based — the .halt promotion/
# execution role moved to the driver control-state, so the sentinel read no longer lives here.)
#
#   preempt      — process-level stop signal against ONE target at ANY point. For the TUI form
#                  (pre `claude -p`) the signal is a tmux C-c to the target pane (interrupts the
#                  running agent wherever it is); for the `claude -p` form (AC4/AC5b) the signal
#                  is `kill <pid>` — the OS IS the preemption primitive. The invariant: it does
#                  NOT depend on the preemptee calling anything (不可被绕过 — same family as
#                  resource limits, SPEC-isolation-and-resource-governance §2).
#   preempt-all  — halt semantics: when `.halt` is present, signal EVERY in-flight layer
#                  (all targets), so a human `.halt` stops further dispatch immediately.
#   list-preemptible / --list-preemptible
#                — the TIMEOUT preemption criterion (step-4): list tasks that are deterministically
#                  preemptible right now, driven ONLY by queryable facts (telemetry duration >
#                  90 min + task status still in-progress + not landed). stdout's first line is the
#                  count (`preemptible: N`). PURE READ — the Contract `measure` surface.
#   preempt-task <taskId> [--root <root>] [--dry-run]
#                — the deterministic timeout preemption ACTION: kill the target task's subprocess
#                  tree (its own process group, never beyond) + close its telemetry bracket +
#                  append a ledger event. A task that is NOT preemptible (actively progressing,
#                  fresh, or landed) is REJECTED (exit 1, nothing killed) — AC3 positive control.
#
# BASE-LAYER BOUNDARY (inherited from supervisor base layer): this script makes NO judgment,
# reads NO task content, writes NO code. It only reads a sentinel file, reads queryable
# process/duration/slot/status facts (via supervisor-preempt-candidates.ts), and signals target
# processes/sessions. Any line that would need to "understand what a task is about" is overreach.
#
# Usage:
#   supervisor-preempt.sh preempt <target> [--method auto|tmux-c-c|kill] [--dry-run]
#       <target>  a numeric PID   → `kill <pid>`            (-p form; AC4)
#                 a tmux target   → `tmux send-keys C-c`    (TUI form)
#       exit 0 = signal sent · 1 = target missing/failed · 2 = usage
#   supervisor-preempt.sh preempt-all [--root <repo-root>]
#                 [--target <layer>[,<layer>...]] [--pid <pid>[,<pid>...]] [--dry-run]
#       when `.halt` present: signal all given targets (tmux C-c) and/or pids (kill).
#       when `.halt` absent:  no-op, exit 0 (nothing to preempt — report "no-halt").
#       if no target/pid given AND no ledger: exit 1 (cannot resolve in-flight layers) —
#       fail loud, never pretend we preempted.
#   supervisor-preempt.sh --list-preemptible [--root <repo-root>]
#       stdout: `preemptible: <count>` (+ one line per preemptible task). PURE READ, exit 0.
#   supervisor-preempt.sh preempt-task <taskId> [--root <repo-root>] [--dry-run]
#       exit 0 = preempted (tree killed + bracket closed + ledger recorded)
#       exit 1 = task NOT preemptible (AC3: actively-progressing task ignored)
#       exit 2 = usage
#
# Env seams (hermetic tests):
#   SUPERVISOR_PREEMPT_ROOT        override workspace root (default: script's own repo root)
#   SUPERVISOR_PREEMPT_TMUX        override tmux binary (default: tmux)
#   SUPERVISOR_PREEMPT_KILL_CMD    override kill binary (default: kill)
#   SUPERVISOR_PREEMPT_DRY_RUN=1   print the would-be signal instead of executing it
#   SUPERVISOR_PREEMPT_CANDIDATES  override the criterion module path (default: supervisor-preempt-candidates.ts)
#   SUPERVISOR_PREEMPT_LEDGER      override the preemption ledger path (default: <root>/.quay/supervisor-preempt-ledger.jsonl)
#
# Test: plugin/test/supervisor-preempt.test.mjs + plugin/test/supervisor-preempt-candidates.test.mjs

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" 2>/dev/null && pwd || true)"
ROOT="${SUPERVISOR_PREEMPT_ROOT:-$(cd "$SELF_DIR/../.." 2>/dev/null && pwd || echo "$SELF_DIR/../..")}"
TMUX_CMD="${SUPERVISOR_PREEMPT_TMUX:-tmux}"
KILL_CMD="${SUPERVISOR_PREEMPT_KILL_CMD:-kill}"
DRY_RUN="${SUPERVISOR_PREEMPT_DRY_RUN:-0}"
CANDIDATES_TS="${SUPERVISOR_PREEMPT_CANDIDATES:-$SELF_DIR/supervisor-preempt-candidates.ts}"
LEDGER_PATH="${SUPERVISOR_PREEMPT_LEDGER:-}"

# ── preempt one target ─────────────────────────────────────────────────────────────────────────────
# <target> is a PID (numeric → kill) or a tmux target (anything else → tmux send-keys C-c).
preempt_one() {
  local target="$1" method="${2:-auto}"
  if [ -z "$target" ]; then
    echo "preempt: empty target" >&2
    return 2
  fi
  # Numeric ⇒ PID ⇒ process-level kill (the `claude -p` form — the OS is the preemption primitive).
  if [[ "$method" == "auto" || "$method" == "kill" ]] && [[ "$target" =~ ^[0-9]+$ ]]; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "preempt: [dry-run] $KILL_CMD $target"
      return 0
    fi
    if ! kill -0 "$target" 2>/dev/null; then
      echo "preempt: target pid $target not alive" >&2
      return 1
    fi
    # SIGINT first (graceful interrupt — lets the agent tee up state), the process's own exit
    # then does the rest. For a stopped/hung agent, SIGINT is the documented stop at ANY point.
    if ! $KILL_CMD -INT "$target" 2>/dev/null; then
      echo "preempt: failed to signal pid $target" >&2
      return 1
    fi
    echo "preempt: pid $target signaled (SIGINT)"
    return 0
  fi
  # tmux target (a session/window/pane name) ⇒ TUI form: send C-c to interrupt the running agent.
  if [[ "$method" == "auto" || "$method" == "tmux-c-c" ]]; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "preempt: [dry-run] $TMUX_CMD send-keys -t $target C-c"
      return 0
    fi
    if ! $TMUX_CMD has-session -t "$target" 2>/dev/null; then
      # A window/pane target may not be a session; fall back to list-panes to confirm existence.
      if ! $TMUX_CMD list-panes -t "$target" -F '#{pane_id}' >/dev/null 2>&1; then
        echo "preempt: tmux target $target not found" >&2
        return 1
      fi
    fi
    if ! $TMUX_CMD send-keys -t "$target" C-c 2>/dev/null; then
      echo "preempt: failed to send C-c to tmux target $target" >&2
      return 1
    fi
    echo "preempt: tmux target $target signaled (C-c)"
    return 0
  fi
  echo "preempt: unknown method $method" >&2
  return 2
}

# ── dispatch ───────────────────────────────────────────────────────────────────────────────────────
cmd_preempt() {
  [ "$#" -ge 1 ] || { echo "用法: $0 preempt <target> [--method auto|tmux-c-c|kill] [--dry-run]" >&2; return 2; }
  local target="$1" method="auto" i=2 a
  while [ "$i" -le "$#" ]; do
    a="${!i}"
    case "$a" in
      --method) i=$(( i + 1 )); method="${!i:-auto}" ;;
      --dry-run) DRY_RUN=1 ;;
      --root) i=$(( i + 1 )); ROOT="${!i:-$ROOT}" ;;
      *) echo "preempt: unknown arg $a" >&2; return 2 ;;
    esac
    i=$(( i + 1 ))
  done
  preempt_one "$target" "$method"
}

cmd_preempt_all() {
  local targets="" pids="" i=1 a
  while [ "$i" -le "$#" ]; do
    a="${!i}"
    case "$a" in
      --root) i=$(( i + 1 )); ROOT="${!i:-$ROOT}" ;;
      --target) i=$(( i + 1 )); targets="${!i:-}" ;;
      --pid) i=$(( i + 1 )); pids="${!i:-}" ;;
      --dry-run) DRY_RUN=1 ;;
      *) echo "preempt-all: unknown arg $a" >&2; return 2 ;;
    esac
    i=$(( i + 1 ))
  done

  local halt_path="$ROOT/.halt"
  if [ ! -e "$halt_path" ]; then
    echo "preempt-all: no-halt (nothing to preempt)"
    return 0
  fi
  [ -f "$halt_path" ] || {
    echo "preempt-all: FAIL-CLOSED .halt sentinel present but not a readable file" >&2
    return 1
  }

  local -a signaled=() t p
  local rc=0
  for t in ${targets//,/ }; do
    [ -n "$t" ] || continue
    if preempt_one "$t" "tmux-c-c"; then signaled+=("$t"); else rc=1; fi
  done
  for p in ${pids//,/ }; do
    [ -n "$p" ] || continue
    if preempt_one "$p" "kill"; then signaled+=("$p"); else rc=1; fi
  done

  if [ "${#signaled[@]}" -eq 0 ]; then
    echo "preempt-all: no targets/pids resolved to signal (fail loud — did not preempt)" >&2
    return 1
  fi
  echo "preempt-all: halted — signaled ${#signaled[@]} in-flight layer(s): ${signaled[*]}"
  return "$rc"
}

# ── timeout preemption (gap-supervisor-step-4-preemption) ─────────────────────────────────────────
# The criterion + action live in supervisor-preempt-candidates.ts (pure, injected-probe testable):
# this wrapper only parses args and delegates — no duplicated criterion/kill logic here.
node_preempt_candidates() {
  node --no-warnings "$CANDIDATES_TS" "$@"
}

cmd_list_preemptible() {
  local i=1 a
  while [ "$i" -le "$#" ]; do
    a="${!i}"
    case "$a" in
      --root) i=$(( i + 1 )); ROOT="${!i:-$ROOT}" ;;
      *) echo "list-preemptible: unknown arg $a" >&2; return 2 ;;
    esac
    i=$(( i + 1 ))
  done
  node_preempt_candidates --list --root "$ROOT"
  return $?
}

cmd_preempt_task() {
  [ "$#" -ge 1 ] || { echo "用法: $0 preempt-task <taskId> [--root <根>] [--dry-run]" >&2; return 2; }
  local taskId="$1" i=2 a dry=""
  while [ "$i" -le "$#" ]; do
    a="${!i}"
    case "$a" in
      --root) i=$(( i + 1 )); ROOT="${!i:-$ROOT}" ;;
      --dry-run) dry="--dry-run" ;;
      *) echo "preempt-task: unknown arg $a" >&2; return 2 ;;
    esac
    i=$(( i + 1 ))
  done
  local ledger_args=()
  if [ -n "$LEDGER_PATH" ]; then ledger_args=(--ledger "$LEDGER_PATH"); fi
  node_preempt_candidates --preempt --taskId "$taskId" --root "$ROOT" --grace-ms 150 $dry "${ledger_args[@]}"
  return $?
}

CMD="${1:-}"
case "$CMD" in
  preempt)
    shift
    cmd_preempt "$@"
    exit $?
    ;;
  preempt-all)
    shift
    cmd_preempt_all "$@"
    exit $?
    ;;
  --list-preemptible|list-preemptible)
    shift
    cmd_list_preemptible "$@"
    exit $?
    ;;
  preempt-task)
    shift
    cmd_preempt_task "$@"
    exit $?
    ;;
  *)
    echo "用法: $0 {preempt <target> [--method …] | preempt-all [--root <根>] [--target <层>…] [--pid <pid>…] | --list-preemptible [--root <根>] | preempt-task <taskId> [--root <根>] [--dry-run]}" >&2
    exit 2
    ;;
esac
