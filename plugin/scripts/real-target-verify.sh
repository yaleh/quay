#!/usr/bin/env bash
# real-target-verify.sh — install/upgrade/cold-start verification against REAL downstream workspaces
# (gap-install-upgrade-verification-targets-real-downstream-workspaces).
#
# THE GAP IT CLOSES: install/upgrade/cold-start verification ran ONLY against mkdtemp synthetic
# fixtures (packages/quay/test/install-config-driven-e2e.test.mjs). Synthetic green was treated as
# evidence real downstreams are green — but archguard's REAL `quay init --loop` (2026-08-06 01:27,
# tick #114) stopped at config-conflict with ZERO files laid down while the synthetic A3 fixture was
# green (6/6, 29s). Same scenario, opposite outcomes. The root cause was RANGE, not frequency: a
# synthetic fixture is a self-made clean sample ("config == template"); the conflict comes from "this
# project really used, really changed its config" — an ORGANIC divergence a mkdtemp fixture cannot
# fabricate. 只提高频率不改验证对象 = 跑一万次 mkdtemp 也撞不到那个状态。
#
# THE MECHANISM: run the SAME upgrade surface a real downstream runs (`quay init --loop`) against a
# REAL consumer workspace in READ-ONLY --dry-run mode, and report a conclusion annotated `real:`
# — a SEPARATE track from the synthetic fixture (`synthetic:`) so synthetic green is never read as
# evidence real downstreams are green (AC3). Dry-run is the safety that makes PERIODIC verification
# (each verification round — AC2) possible: it writes nothing (config / backups / copies all
# `would-*`), so a real downstream can be checked every round without being disturbed.
#
# A real target is any existing quay consumer: a workspace whose `.quay/config.yml` carries a
# `loop:` section (a project that has actually run quay-init and runs the loop). The organic
# divergence the synthetic fixtures cannot produce — the consumer's own loop values ≠ template,
# its drifted/missing laid-down mechanism files, its real usage history — is exactly what this
# check observes.
#
# Usage:
#   bash real-target-verify.sh --target <dir> [--plugin-root <dir>] [--json] [--quiet]
#   bash real-target-verify.sh --list-targets
#
#   --target <dir>     a REAL downstream workspace (archguard / meta-cc / any existing quay
#                      consumer). Must have .quay/config.yml with a loop: section.
#   --plugin-root      quay plugin root (default: this script's ../../plugin — the plugin bundle).
#   --json             machine-readable conclusion (one JSON object on stdout).
#   --quiet            suppress the underlying quay-init --dry-run output; print only the
#                      [real-target] conclusion line.
#   --list-targets     print the configured real-target list (space-separated, from the
#                      QUAY_REAL_TARGETS env var) and exit. The mechanism is generic — each
#                      workspace decides its own real-target list (quay's own: archguard/meta-cc).
#
# stdout (Contract measure):
#   real_target_verified = `bash <real-target-verify.sh> --target <真实工作区> 2>&1 | grep -c 'verified\|已验'`
# The conclusion line is `real_target_verified: verified|conflict|fail` (with `已验` on verified)
# and is prefixed `[real-target]` — the ANNOTATION that separates it from the synthetic fixture
# track (AC3). exit 0 = verified, 1 = conflict/fail (verification RAN and found a problem),
# 2 = usage error.
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -u

TARGET=""
PLUGIN_ROOT=""
JSON=0
QUIET=0
LIST=0

SELF="$0"
if [ -z "$PLUGIN_ROOT" ] && [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  PLUGIN_ROOT="$CLAUDE_PLUGIN_ROOT"
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --plugin-root) PLUGIN_ROOT="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    --quiet) QUIET=1; shift ;;
    --list-targets) LIST=1; shift ;;
    --help|-h)
      grep '^#' "$SELF" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

# Resolve the plugin root (needed for the quay-init invocation).
if [ -z "$PLUGIN_ROOT" ]; then
  PLUGIN_ROOT="$(cd "$(dirname "$(dirname "$SELF")")" 2>/dev/null && pwd || true)"
fi
if [ -z "$PLUGIN_ROOT" ] || [ ! -f "$PLUGIN_ROOT/.claude-plugin/plugin.json" ]; then
  echo "ERROR: cannot resolve the quay plugin root (pass --plugin-root or set CLAUDE_PLUGIN_ROOT)." >&2
  exit 2
fi

emit_json() {
  # $1 = conclusion, $2 = reason (short), $3 = JSON details object (optional)
  python3 - "$1" "$2" "$3" <<'PYEOF'
import json, sys
concl, reason, details = sys.argv[1], sys.argv[2], (json.loads(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else {})
print(json.dumps({"real_target_verified": concl, "reason": reason, **details}, ensure_ascii=False))
PYEOF
}

# ── --list-targets ─────────────────────────────────────────────────────────────────────────────────────
if [ "$LIST" = 1 ]; then
  # The real-target list is per-workspace policy (the mechanism is generic). A workspace declares
  # its real downstreams via QUAY_REAL_TARGETS (space-separated absolute dirs). quay's own list is
  # archguard + meta-cc (see plugin/loop/orchestrator-loop-tick.md, the verification-round step).
  for t in ${QUAY_REAL_TARGETS:-}; do
    printf '%s\n' "$t"
  done
  exit 0
fi

# ── argument validation ─────────────────────────────────────────────────────────────────────────────────
if [ -z "$TARGET" ]; then
  echo "ERROR: --target <dir> is required (a real downstream workspace with .quay/config.yml)." >&2
  exit 2
fi
if [ ! -d "$TARGET" ]; then
  echo "[real-target] ERROR: target is not a directory: $TARGET" >&2
  exit 2
fi
TARGET="$(cd "$TARGET" && pwd -P)"

# ── real-consumer precondition (AC1) ────────────────────────────────────────────────────────────────────
# A REAL downstream = a workspace that has actually been through quay-init and runs the loop: it
# carries .quay/config.yml with a loop: section. This is the organic-state precondition synthetic
# fixtures satisfy only by construction — a real target's config is the record of real usage.
CONFIG="$TARGET/.quay/config.yml"
if [ ! -f "$CONFIG" ]; then
  if [ "$JSON" = 1 ]; then emit_json fail "not-a-quay-consumer" ""; else echo "[real-target] $TARGET: real_target_verified: fail — not a quay consumer (no .quay/config.yml)"; fi
  exit 1
fi
if ! grep -q '^loop:' "$CONFIG"; then
  if [ "$JSON" = 1 ]; then emit_json fail "not-a-quay-consumer" ""; else echo "[real-target] $TARGET: real_target_verified: fail — not a quay consumer (.quay/config.yml has no loop: section)"; fi
  exit 1
fi

# ── read-only upgrade check (the same surface a real downstream runs) ─────────────────────────────────
# `quay-init.sh --loop --dry-run` is the READ-ONLY upgrade check: it runs the full --loop upgrade
# path (config-preserving read of existing loop values, drift report, mechanism lay-down, tick docs,
# runtime) but writes NOTHING (every write is `would-*`, config backup is skipped, auto-commit is
# skipped). Exit 0 = the upgrade check ran; the conclusion below reads the report.
OUT="$(cd "$TARGET" && bash "$PLUGIN_ROOT/scripts/quay-init.sh" --loop --dry-run \
  --root "$TARGET" --project "$(basename "$TARGET")" --plugin-root "$PLUGIN_ROOT" 2>&1)"
RC=$?

if [ "$QUIET" != 1 ]; then
  printf '%s\n' "$OUT"
fi

# ── conclusion ─────────────────────────────────────────────────────────────────────────────────────────
# Signals read from the dry-run report:
#   conflict      — a `CONFLICT:` / `would-conflict:` line (a same-name target differs from the
#                   product). On .quay/config.yml or a managed tick doc this is EXACTLY the
#                   archguard failure class (config-conflict / stale user-edit conflict) the real
#                   target exists to catch — synthetic fixtures cannot fabricate it.
#   would-copy    — mechanism files the upgrade WOULD lay down (drift/missing caught on a real
#                   target; a frozen-at-install-time consumer reports missing that a fresh fixture
#                   never shows). > 0 is the anti-pass-through half: a real consumer the check
#                   cannot upgrade is not "verified".
#   config-preserving — `using existing config loop.*` lines: the upgrade kept the consumer's own
#                   loop values (gap-quay-init-config-preserving-incremental-upgrade AC1).
# NOTE: the dry-run conflict signal is `would-conflict` WITHOUT a colon (the line is
# `would-conflict (content differs, skip unless --force): <path>`), while the REAL mode emits
# `CONFLICT: <path>`. Match both spellings so a future mode change cannot silently blind the check.
conflict_lines="$(printf '%s\n' "$OUT" | grep -E 'CONFLICT:|would-conflict' | sed 's/^/  /')"
conflict_count="$(printf '%s\n' "$OUT" | grep -cE 'CONFLICT:|would-conflict' || true)"
would_copy_count="$(printf '%s\n' "$OUT" | grep -c 'would-copy:' || true)"
would_skip_count="$(printf '%s\n' "$OUT" | grep -c 'would-skip' || true)"
config_preserved="$(printf '%s\n' "$OUT" | grep -c 'using existing config loop\.' || true)"

details="{\"would_copy\": ${would_copy_count}, \"would_skip\": ${would_skip_count}, \"config_preserved\": ${config_preserved}, \"exit\": ${RC}}"

if [ "$RC" -ne 0 ]; then
  # The upgrade check itself could not run (a fail-closed detection / validation on the real
  # target) — a real finding, not an empty-set pass.
  if [ "$JSON" = 1 ]; then emit_json fail "upgrade-check-failed" "$details"; else echo "[real-target] $TARGET: real_target_verified: fail (upgrade check could not run — exit ${RC})"; fi
  exit 1
fi

if [ "$conflict_count" -gt 0 ]; then
  # A same-name target differs from the product — the config-conflict / user-edit-conflict class.
  # NOT silent: the real target's organic divergence is REPORTED, not read as green (AC3).
  if [ "$JSON" = 1 ]; then
    emit_json conflict "conflicts-detected" "$details"
  else
    echo "[real-target] $TARGET: real_target_verified: conflict — ${conflict_count} would-conflict line(s) (a real downstream's organic divergence, NOT a synthetic pass):"
    printf '%s\n' "$conflict_lines"
  fi
  exit 1
fi

if [ "$would_copy_count" -eq 0 ] && [ "$would_skip_count" -eq 0 ]; then
  # The dry-run produced NO laydown signal at all — not even an identical-skip. This is a VACUOUS
  # check (the laydown path never ran / saw nothing), indistinguishable from "both empty so
  # identical" — the anti-pass-through negative control. A real target that is FULLY current with
  # the plugin legitimately reports would-copy 0 but would-skip > 0 (every file identical → no
  # conflict, nothing to update) — that is verified, NOT vacuous.
  if [ "$JSON" = 1 ]; then emit_json fail "empty-laydown" "$details"; else echo "[real-target] $TARGET: real_target_verified: fail — the upgrade check produced no laydown signal (vacuous; anti-pass-through)"; fi
  exit 1
fi

# verified — the real downstream's upgrade check ran, found no conflict, and would lay down the
# mechanism. The conclusion is annotated `已验` (Contract measure surface).
if [ "$JSON" = 1 ]; then
  emit_json verified "upgrade-check-ok" "$details"
else
  echo "[real-target] $TARGET: real_target_verified: verified (已验) — would-copy ${would_copy_count}, no conflict, config-preserving ${config_preserved}"
fi
exit 0
