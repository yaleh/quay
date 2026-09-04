#!/usr/bin/env bash
# supervisor-bus.sh — the supervisor base layer's IDENTITY-ATTRIBUTABLE message bus
# (tasks/gap-supervisor-step-5-message-bus-with-identity, supervisor step ⑤).
#
# Cross-session delivery WITH sender identity: every bus-delivered message carries a sender
# (layer + project), and the delivery event is recorded in a pure-append ledger as
# "who → who → when → delivered?" — attributable, never anonymous. The bus's ONE consumer-facing
# surface is this script; a consumer that wants text to reach a session calls THIS and learns
# delivered|failed WITH attribution.
#
# THE ONE HARDENED DELIVERY PATH (AC2): this script contains NO send-keys sequence of its own.
# It delegates the actual delivery to supervisor-deliver.sh (step ③), which itself delegates to
# send-keys-reliable.sh (the five-step reliable procedure) and verifies via
# transcript-delivery-check.ts (the only trusted signal). There is no second hand-written
# send-keys sequence anywhere in the bus — the "3 consumers each hand-write" counterexample is
# structurally dead because the narrow interface exists AND a test intercepts a broken delivery.
#
# SENDER IDENTITY (AC1): the message carries `from` (the layer) + `project`. For the --send (TUI
# agent channel) path the claimable layers are the AGENT identities {inner, outer, manager} —
# `--from human` is REJECTED fail-closed, mirroring message-bus.ts's agent-channel spoof gate
# (an agent message claiming from:human is the exact incident this identity family kills).
# The ledger records every delivery event with the full sender identity + target + timestamp +
# delivered verdict, so "谁 → 谁 → 何时 → 是否送达" is attributable.
#
# BOUNDARY (AC4): the bus only delivers, verifies, and records — it does NOT read message
# semantics and does NOT write code. No line in this script needs to understand what a task says;
# the payload is opaque text passed straight through.
#
# Usage:
#   bash supervisor-bus.sh --send --from <layer> --to <target> --payload <msg> \
#       [--project <name>] [--transcript <path>|--root <path>] [--ledger <path>] [--verify-s <s>]
#   bash supervisor-bus.sh ledger [--ledger <path>]   # print the delivery ledger (attribution)
#   bash supervisor-bus.sh --help
#
# --send flags:
#   --from <layer>    the sender identity LAYER ∈ {inner, outer, manager} (agent identities —
#                     the human cannot claim the TUI agent channel; AC2 spoof gate)
#   --project <name>  the sender identity PROJECT (default: repo-root basename, e.g. "quay")
#   --to <target>     the tmux target session to deliver to (e.g. quay-outer)
#   --payload <msg>   the message text (opaque — the bus never parses it)
#   --transcript <path>  the target session transcript jsonl (a known, existing session)
#   --root <path>     auto-discover the target transcript under ~/.claude/projects/<slug>/
#   --ledger <path>   delivery ledger path (default <repo-root>/.quay/supervisor-bus-ledger.jsonl)
#   --verify-s <s>    overall delivery bound (forwarded to supervisor-deliver.sh)
#
# Exit: 0 = delivered (verified via the target transcript, sender identity recorded)
#       1 = failed (undelivered after bounded retries — needs human)
#       2 = usage / identity error (fail loud)
#       3 = unknown (no evidence either way — check first, do NOT resend blindly)

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" 2>/dev/null && pwd || true)"
DELIVER="$SELF_DIR/supervisor-deliver.sh"

# Resolve the repo root (the ledger lives under <root>/.quay/).
repo_root=""
d="$SELF_DIR"
while [ -n "$d" ] && [ "$d" != "/" ]; do
  if [ -e "$d/.git" ]; then
    repo_root="$d"
    break
  fi
  d="$(dirname "$d")"
done
[ -z "$repo_root" ] && repo_root="$SELF_DIR"

# ── sender identity ────────────────────────────────────────────────────────────────────────────────
# Agent identities only for the TUI send channel (mirrors message-bus.ts AGENT_IDENTITIES). "human"
# is deliberately absent — an agent message claiming from:human is the spoof the identity family
# exists to reject. The single source of the identity set is message-bus.ts; this bash list is the
# CLI's own validation surface (the bus records what it validated, never a mystery sender).
AGENT_LAYERS=(inner outer manager)

is_agent_layer() {
  local layer="$1" l
  for l in "${AGENT_LAYERS[@]}"; do
    [ "$l" = "$layer" ] && return 0
  done
  return 1
}

usage() {
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//' >&2
}

# ── ledger helpers ─────────────────────────────────────────────────────────────────────────────────
ledger_default="$repo_root/.quay/supervisor-bus-ledger.jsonl"

ledger_append() {
  local ledger="$1" rec="$2"
  mkdir -p "$(dirname "$ledger")" 2>/dev/null || true
  printf '%s\n' "$rec" >> "$ledger" 2>/dev/null \
    || echo "supervisor-bus: warning — could not append delivery event to ledger $ledger" >&2
}

ledger_print() {
  local ledger="$1"
  if [ ! -f "$ledger" ]; then
    echo "delivery-ledger: 0 events ($ledger)"
    return 0
  fi
  local n=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    n=$((n + 1))
    # Pure-append ledger records are {sentAt, sender:{layer,project}, target, delivered}.
    # Render as "who → who → when → delivered?" — the AC1 attribution shape.
    local sentAt sender target delivered
    sentAt=$(printf '%s' "$line" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);process.stdout.write(o.sentAt||"")}catch{}})')
    sender=$(printf '%s' "$line" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const l=o.sender&&o.sender.layer||"";const p=o.sender&&o.sender.project||"";process.stdout.write((l?l+"@":"")+(p?p:"?"))}catch{}})')
    target=$(printf '%s' "$line" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);process.stdout.write(o.target||"")}catch{}})')
    delivered=$(printf '%s' "$line" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);process.stdout.write(o.delivered===true?"true":o.delivered===false?"false":"?")}catch{}})')
    printf '  #%d  %s → %s  at %s  delivered=%s\n' "$n" "$sender" "$target" "$sentAt" "$delivered"
  done < "$ledger"
  echo "delivery-ledger: ${n} event(s) ($ledger)"
}

# ── --send ────────────────────────────────────────────────────────────────────────────────────────
send_bus() {
  local layer="" project="" target="" payload="" transcript="" root="" ledger="$ledger_default" verify_s=""

  local i=1
  while [ "$i" -le "$#" ]; do
    case "${!i}" in
      --from) i=$((i+1)); [ "$i" -le "$#" ] || { usage; exit 2; }; layer="${!i}" ;;
      --project) i=$((i+1)); [ "$i" -le "$#" ] || { usage; exit 2; }; project="${!i}" ;;
      --to) i=$((i+1)); [ "$i" -le "$#" ] || { usage; exit 2; }; target="${!i}" ;;
      --payload) i=$((i+1)); [ "$i" -le "$#" ] || { usage; exit 2; }; payload="${!i}" ;;
      --transcript) i=$((i+1)); [ "$i" -le "$#" ] || { usage; exit 2; }; transcript="${!i}" ;;
      --root) i=$((i+1)); [ "$i" -le "$#" ] || { usage; exit 2; }; root="${!i}" ;;
      --ledger) i=$((i+1)); [ "$i" -le "$#" ] || { usage; exit 2; }; ledger="${!i}" ;;
      --verify-s) i=$((i+1)); [ "$i" -le "$#" ] || { usage; exit 2; }; verify_s="${!i}" ;;
      *) echo "supervisor-bus: unknown --send argument: ${!i}" >&2; usage; exit 2 ;;
    esac
    i=$((i+1))
  done

  # required args (fail loud, never a silent 0)
  [ -n "$layer" ] || { echo "supervisor-bus: --from <layer> required (one of ${AGENT_LAYERS[*]})" >&2; exit 2; }
  [ -n "$target" ] || { echo "supervisor-bus: --to <target> required" >&2; exit 2; }
  [ -n "$payload" ] || { echo "supervisor-bus: --payload <msg> required" >&2; exit 2; }

  # identity gate (AC2 spoof gate on the TUI agent channel — fail-closed)
  if ! is_agent_layer "$layer"; then
    echo "supervisor-bus: identity rejected: '$layer' is not a claimable sender layer on the TUI agent channel (served: ${AGENT_LAYERS[*]}) — an agent cannot forge another sender's identity" >&2
    exit 2
  fi

  # project default = repo-root basename (the workspace/project the sender is in)
  if [ -z "$project" ]; then
    project="$(basename "$repo_root")"
  fi

  # transcript resolution: --transcript wins; --root auto-discovers; default --root <repo_root>
  # (the config-not-inferred exception supervisor-deliver.sh documents).
  local deliver_args=("$target" "$payload")
  if [ -n "$transcript" ]; then
    deliver_args+=(--transcript "$transcript")
  else
    deliver_args+=(--root "${root:-$repo_root}")
  fi
  if [ -n "$verify_s" ]; then
    deliver_args+=(--verify-s "$verify_s")
  fi

  # fail-loud precondition: the ONE hardened delivery path must exist (AC2 — the bus never
  # falls back to a hand-written send-keys sequence).
  if [ ! -f "$DELIVER" ] || [ ! -x "$DELIVER" ]; then
    echo "supervisor-bus: 缺少投递实现 $DELIVER——fail loud（总线不提供第二份手写 send-keys 序列）" >&2
    exit 1
  fi

  # deliver (delegation to the single hardened path) — capture stdout for the ledger/message.
  local out
  out=$(bash "$DELIVER" "${deliver_args[@]}" 2>&1)
  local rc=$?

  # sentAt — epoch-ms (the uutils %3N quirk: slice c1-13; fall back to seconds).
  local sentAt
  sentAt=$(date +%s%N | cut -c1-13 2>/dev/null || date +%s)

  # delivered = exit 0 (verified via the target transcript). The ledger records the raw truth
  # (pure append, zero judgment).
  local delivered_flag="false"
  if [ "$rc" -eq 0 ]; then
    delivered_flag="true"
  fi

  # AC1 attribution record: {sentAt, sender:{layer,project}, target, delivered}
  local rec
  rec=$(printf '{"sentAt":"%s","sender":{"layer":"%s","project":"%s"},"target":"%s","delivered":%s}' \
    "$sentAt" "$layer" "$project" "$target" "$delivered_flag")
  ledger_append "$ledger" "$rec"

  # Contract measure field on stdout: delivered=<true|false>
  printf 'delivered=%s sender_layer=%s sender_project=%s target=%s\n' \
    "$delivered_flag" "$layer" "$project" "$target"
  # human-readable delegate output (the verified transcript evidence) follows.
  printf '%s\n' "$out" | sed 's/^/    /'

  exit "$rc"
}

# ── arg dispatch ──────────────────────────────────────────────────────────────────────────────────
sub="${1:-}"
case "$sub" in
  --send)
    shift
    send_bus "$@"
    ;;
  ledger)
    shift
    L="$ledger_default"
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --ledger) shift; L="${1:-}" ;;
        *) echo "supervisor-bus: unknown ledger argument: $1" >&2; exit 2 ;;
      esac
      shift
    done
    ledger_print "$L"
    ;;
  --help|-h|help)
    usage
    exit 0
    ;;
  "")
    usage
    exit 2
    ;;
  *)
    echo "supervisor-bus: unknown subcommand: $sub" >&2
    usage
    exit 2
    ;;
esac
