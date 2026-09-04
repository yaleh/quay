#!/usr/bin/env bash
# observer-registry.sh — 观测者注册表：被观测目标的登记状态（单一来源）
# (tasks/gap-observer-registry-target-decommission-and-criterion-invalidation).
#
# THE CLASS (2026-08-06, one night, FOUR independent consumers hit the same shape):
#   each consumer kept its OWN target list + own criterion, and none had a mechanism to
#   learn a target had been decommissioned:
#     1. os-anchor-watchdog (systemd timer) revived a deliberately-decommissioned archguard
#     2. a manager git-staleness Monitor kept reporting growing REPO-STALL for that archguard
#     3. (a retired session-coverage Monitor once reported NOT-WATCHED for a decommissioned B machine)
#     4. a session-topology Monitor reported a stale cached value after B's tmux server terminated
#   The pre-existing diagnosis (gap-os-anchor-watchdog-lease-model-instead-of-absence-inference)
#   covers only consumer #1. THIS FILE is the class-level mechanism.
#
# MECHANISM:
#   * ONE registry, not four configs — a decommissioned target is written ONCE here;
#     every consumer reads the same registry instead of maintaining its own target list.
#   * PROACTIVE invalidation, not passive caching — a decommission is an explicit
#     registration; every registry-reading consumer reflects it on its next read.
#     (Case 4 proved shortening the sample period doesn't cure stale caches.)
#   * Registration is a READ-type operation — a human/manager explicitly declares a target
#     decommissioned (--register-offline). Observers NEVER self-guess a decommission.
#   * NO new system crontab — consumers keep their existing triggers (the watchdog's own
#     timer / the monitors' own sampling); they just consult this registry at each read.
#     Same dual-trigger style as sync-lag-check.sh (per-tick heartbeat + event-driven).
#
# Registry file: <workspaceRoot>/orchestration/observer-registry.conf
# (override with OBSERVER_REGISTRY_FILE). Pipe-delimited, one target per line:
#   name|status|root|tmux-session|note
#     name          target name — consumers match their targets by this (e.g. quay, meta-cc,
#                   archguard, quay-b)
#     status        active | offline  (offline = decommissioned; every consumer MUST report
#                   "offline", never stale live state)
#     root          project root for project-class targets ('' or '.' = this workspace root);
#                   used by --audit to rebuild consumer read-surfaces
#     tmux-session  the tmux session this target's topology resolves to; '' if none
#     note          free text: who/when/why (no literal '|')
#   Lines starting with '#' and blank lines are skipped.
#
# Usage:
#   observer-registry.sh --list                 human-readable target list
#   observer-registry.sh --list --json         machine-readable array (## Contract measure)
#   observer-registry.sh --status <name>        active | offline | unknown
#   observer-registry.sh --is-offline <name>    exit 0 iff <name> is registered offline
#   observer-registry.sh --is-offline-session <sess>  exit 0 iff a registry target with this
#                                               tmux-session (or name) is offline
#   observer-registry.sh --register-offline <name> [--root <r>] [--session <s>] [--note <n>]
#                                               EXPLICIT human/manager decommission record
#   observer-registry.sh --register-active <name>  reverse (re-commission)
#   observer-registry.sh --audit --json        run every consumer's read-surface against each
#                                               offline target; report per-consumer stale
#   observer-registry.sh --help
#
# Exit: 0 success / not-offline · 1 offline (for --is-offline/--is-offline-session) · 2 usage/config
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REGISTRY="$(cd "$SELF_DIR/../.." && pwd)/orchestration/observer-registry.conf"
REGISTRY_FILE="${OBSERVER_REGISTRY_FILE:-$DEFAULT_REGISTRY}"

log() { echo "observer-registry: $*"; }
die() { echo "observer-registry: ERROR: $*" >&2; exit 2; }

# workspace_root — the workspace (repo) root, derived from this script's location.
workspace_root() { cd "$SELF_DIR/../.." && pwd; }

# expand_root — expand '' / '.' / '~' / '$HOME' in a root field to an absolute path.
expand_root() {
  local r="$1"
  [ -n "$r" ] || { workspace_root; return 0; }
  [ "$r" = "." ] && { workspace_root; return 0; }
  case "$r" in
    '~/'*) r="$HOME/${r#\~/}" ;;
    '~') r="$HOME" ;;
    '$HOME/'*) r="$HOME/${r#\$HOME/}" ;;
    '$HOME') r="$HOME" ;;
  esac
  echo "$r"
}

# print_entries — parse the registry into normalized `name|status|root|session|note` lines
# (root expanded; comments/blanks skipped). Emits nothing if the file is absent.
print_entries() {
  [ -f "$REGISTRY_FILE" ] || return 0
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    local name status root sess note
    IFS='|' read -r name status root sess note <<< "$line"
    [ -n "${name:-}" ] || continue
    [ -n "${status:-}" ] || continue
    printf '%s|%s|%s|%s|%s\n' "$name" "$status" "$(expand_root "${root:-}")" "${sess:-}" "${note:-}"
  done < "$REGISTRY_FILE"
}

# target_status <name> — print active | offline | unknown.
target_status() {
  local want="$1" line name status
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    IFS='|' read -r name status _ _ _ <<< "$line"
    if [ "$name" = "$want" ]; then printf '%s\n' "$status"; return 0; fi
  done < <(print_entries)
  printf 'unknown\n'
  return 1
}

# is_offline <name> — exit 0 iff the named target is registered offline.
is_offline() {
  local want="$1" st
  st="$(target_status "$want")"
  [ "$st" = "offline" ]
}

# is_offline_session <sess> — exit 0 iff a registry target whose tmux-session OR name is <sess>
# is registered offline (used by the session-topology consumer).
is_offline_session() {
  local sess="$1" line name status ts
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    IFS='|' read -r name status _ ts _ <<< "$line"
    if [ "$ts" = "$sess" ] || [ "$name" = "$sess" ]; then
      [ "$status" = "offline" ] && return 0
      return 1
    fi
  done < <(print_entries)
  return 1
}

do_list() {
  local entries
  entries="$(print_entries)"
  if [ "${JSON:-0}" = "1" ]; then
    # bare JSON array of target objects — `len(json.load(sys.stdin))` is the target count.
    printf '%s\n' "$entries" | python3 -c '
import json, sys
rows = []
for line in sys.stdin:
    line = line.rstrip("\n")
    if not line:
        continue
    name, status, root, sess, note = line.split("|", 4)
    rows.append({"name": name, "status": status, "root": root,
                 "tmux_session": sess, "note": note})
print(json.dumps(rows, ensure_ascii=False))
'
    return 0
  fi
  if [ -z "$entries" ]; then
    echo "observer-registry: no registered targets in $REGISTRY_FILE"
    return 0
  fi
  printf '%-16s %-8s %-44s %-16s %s\n' "NAME" "STATUS" "ROOT" "TMUX-SESSION" "NOTE"
  local line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    local name status root sess note
    IFS='|' read -r name status root sess note <<< "$line"
    printf '%-16s %-8s %-44s %-16s %s\n' "$name" "$status" "$root" "${sess:-}" "${note:-}"
  done <<< "$entries"
}

# register_target <name> <status> — the EXPLICIT registration write (AC5: a read-type operation —
# a human/manager explicitly declares the decommission/re-commission; observers NEVER self-guess).
#   * The registry file is declared self-create in plugin/skills/init/SKILL.md (per-project local
#     state, like orchestration/tick-log.md). If it is entirely ABSENT (a fresh install), the FIRST
#     explicit registration bootstraps it (creates a header + the entry) — the --register-* command
#     itself IS the explicit registration.
#   * For an EXISTING registry, a target not already registered fails closed (exit 2): observers
#     never self-register, and a target nobody knows about can't be meaningfully decommissioned.
register_target() {
  local name="$1" status="$2"
  [ -n "$name" ] || die "--register-* needs a target name"
  if [ ! -f "$REGISTRY_FILE" ]; then
    mkdir -p "$(dirname "$REGISTRY_FILE")"
    printf '# observer-registry.conf — 观测者注册表（自创建：首个显式登记时生成）\n# 格式：name|status|root|tmux-session|note\n' > "$REGISTRY_FILE"
  fi
  local tmp="${REGISTRY_FILE}.new" exists=0 fresh=1 line n root sess
  : > "$tmp"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*)
      printf '%s\n' "$line" >> "$tmp"
      continue ;;
    esac
    fresh=0
    IFS='|' read -r n _ _ _ _ <<< "$line"
    if [ "$n" = "$name" ]; then
      exists=1
      root="${REG_ROOT:-$(printf '%s\n' "$line" | cut -d'|' -f3)}"
      sess="${REG_SESSION:-$(printf '%s\n' "$line" | cut -d'|' -f4)}"
      printf '%s|%s|%s|%s|%s\n' "$name" "$status" "$root" "$sess" "${NOTE:-}" >> "$tmp"
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$REGISTRY_FILE"
  if [ "$exists" -ne 1 ]; then
    if [ "$fresh" -eq 1 ]; then
      # freshly-created file: the first explicit registration creates its own entry.
      printf '%s|%s|%s|%s|%s\n' "$name" "$status" "${REG_ROOT:-}" "${REG_SESSION:-}" "${NOTE:-}" >> "$tmp"
    else
      rm -f "$tmp"
      die "target '$name' is not in the registry — a decommission record needs an existing registration"
    fi
  fi
  mv "$tmp" "$REGISTRY_FILE"
  log "registered '$name' as $status"
}

# ── --audit: the AC3 negative control, as a command ──────────────────────────────────────────────
# For EVERY target registered offline, rebuild each of the 2 known consumers' read-surface and
# verify it reports "decommissioned" (not stale live state). A consumer is `stale` if any offline
# target still yields an old-state report. Emits JSON:
#   {"consumers":[{"name","stale","detail"},...], "offline_targets":[...], "all_fresh":bool}
# Exit 1 iff any consumer is stale (the ## Contract band stale_observer_reports = 0 is violated).
do_audit() {
  local -a offline=()
  local line name status
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    IFS='|' read -r name status _ _ _ <<< "$line"
    [ "$status" = "offline" ] && offline+=("$name")
  done < <(print_entries)

  local aw_ok=1 tp_ok=1
  local aw_det="" tp_det=""
  if [ "${#offline[@]}" -eq 0 ]; then
    aw_det="no offline targets"; tp_det="no offline targets"
  fi

  local name entry root sess cfg out
  for name in "${offline[@]}"; do
    root=""; sess=""
    entry="$(printf '%s\n' "$(print_entries)" | grep -E "^${name}\|" | head -1)"
    if [ -n "$entry" ]; then
      IFS='|' read -r _ _ root sess _ <<< "$entry"
    fi
    [ -n "$root" ] || root="$(workspace_root)"
    [ -n "$sess" ] || sess="$name"

    # consumer 1 — os-anchor-watchdog: --check must say "decommissioned", never re-spawn.
    # The watchdog is a dev-stage tool (NOT a shipped deliverable — human ruling 2026-08-06); a
    # fresh install may not carry it. Absent ⇒ the consumer isn't present in this workspace, so it
    # cannot be stale (skipped, not failed).
    if [ -f "$SELF_DIR/os-anchor-watchdog.sh" ]; then
      cfg="$(mktemp)"
      printf '%s|%s|%s|outer|true|true|\n' "$name" "$root" "$sess" > "$cfg"
      out="$(bash "$SELF_DIR/os-anchor-watchdog.sh" --check "$name" --config "$cfg" 2>&1)" || true
      rm -f "$cfg"
      if printf '%s\n' "$out" | grep -q "decommissioned"; then
        aw_det+="${name}->decommissioned; "
      else
        aw_ok=0; aw_det+="${name}->STALE($(printf '%s\n' "$out" | head -1 | tr -d '\n')); "
      fi
    else
      aw_det+="${name}->watchdog-not-installed(skipped); "
    fi

    # consumer 2 — session-topology: topology-check --session must say "decommissioned".
    if [ -f "$SELF_DIR/topology-check.sh" ]; then
      out="$(bash "$SELF_DIR/topology-check.sh" --session "$sess" 2>&1)" || true
      if printf '%s\n' "$out" | grep -q "decommissioned"; then
        tp_det+="${name}->decommissioned; "
      else
        tp_ok=0; tp_det+="${name}->STALE($(printf '%s\n' "$out" | head -1 | tr -d '\n')); "
      fi
    else
      tp_det+="${name}->topology-check-not-installed(skipped); "
    fi
  done

  local offline_json
  if [ "${#offline[@]}" -gt 0 ]; then
    offline_json="$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1:]))' "${offline[@]}")"
  else
    offline_json="[]"
  fi
  AW_OK="$aw_ok" AW_DET="$aw_det" TP_OK="$tp_ok" TP_DET="$tp_det" \
  OFFLINE_JSON="$offline_json" python3 - <<'PYEOF'
import json, os
def c(name, ok, det):
    return {"name": name, "stale": (ok != "1"), "detail": det.strip()}
consumers = [
    c("os-anchor-watchdog", os.environ["AW_OK"], os.environ["AW_DET"]),
    c("session-topology", os.environ["TP_OK"], os.environ["TP_DET"]),
]
out = {
    "consumers": consumers,
    "offline_targets": json.loads(os.environ["OFFLINE_JSON"]),
    "all_fresh": all(not c["stale"] for c in consumers),
}
print(json.dumps(out, ensure_ascii=False))
PYEOF
  [ "${aw_ok}" = "1" ] && [ "${tp_ok}" = "1" ]
}

# ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
ACTION=""
TARGET=""
JSON=0
REG_ROOT=""
REG_SESSION=""
NOTE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list) ACTION=list; shift ;;
    --json) JSON=1; shift ;;
    --status)
      ACTION=status; TARGET="${2:-}"; [ -n "$TARGET" ] || die "--status needs a name"; shift 2 ;;
    --is-offline)
      ACTION=is_offline; TARGET="${2:-}"; [ -n "$TARGET" ] || die "--is-offline needs a name"; shift 2 ;;
    --is-offline-session)
      ACTION=is_offline_session; TARGET="${2:-}"; [ -n "$TARGET" ] || die "--is-offline-session needs a session"; shift 2 ;;
    --register-offline)
      ACTION=register_offline; TARGET="${2:-}"; [ -n "$TARGET" ] || die "--register-offline needs a name"; shift 2 ;;
    --register-active)
      ACTION=register_active; TARGET="${2:-}"; [ -n "$TARGET" ] || die "--register-active needs a name"; shift 2 ;;
    --root) REG_ROOT="${2:-}"; shift 2 ;;
    --session) REG_SESSION="${2:-}"; shift 2 ;;
    --note) shift; NOTE="$*"; break ;;
    --audit) ACTION=audit; shift ;;
    --help|-h) ACTION=help; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

case "$ACTION" in
  help|"")
    sed -n '1,70p' "$0" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  list) do_list ;;
  status) target_status "$TARGET"; exit $? ;;
  is_offline) is_offline "$TARGET"; exit $? ;;
  is_offline_session) is_offline_session "$TARGET"; exit $? ;;
  register_offline) register_target "$TARGET" offline ;;
  register_active) register_target "$TARGET" active ;;
  audit) do_audit; exit $? ;;
  *) die "no action given (try --list / --is-offline <name> / --audit --json)" ;;
esac
exit 0
