# overhead-instrument.sh — the _oh_* fixed-overhead timing family, extracted from scripts/test.sh
# (gap-suite-hub-file-responsibility-strip).
#
# WHY A SEPARATE FILE: overhead timing is PURE TELEMETRY — changing it never flips pass/fail — yet it
# lived in scripts/test.sh (a HUB file), so each timing tweak forced a ~13-min full suite. This file is a
# NON-hub (suite-bucket-hub-list.ts deliberately does NOT list it): an overhead-only change now takes the
# bucket path. SOURCED by scripts/test.sh; the `__OVERHEAD__` output stays byte-identical.
#
# Moved verbatim from scripts/test.sh lines 1507-1572: _oh_mark / _oh_emit / _oh_emit_p / _oh_emit_partial /
# _oh_install_partial_trap + the `_oh_done` suppress-double-emit flag. The phase marks (oh_t0..oh_t7,
# oh_full) are GLOBALS set by run_selected() in scripts/test.sh — these functions read them at call time
# (dynamic scope), so the extraction changes nothing at runtime.

# ── Fixed-overhead instrumentation (gap-suite-fixed-overhead-decomposition, AC1/AC2) ───────────────
# The ~152s fixed overhead (build_dist_once / run_static_checks / resource-gate / inter-phase gaps)
# was never decomposed. These segments are DETERMINISTIC SERIAL — no concurrency jitter — so direct
# per-segment timestamps give a decidable number (unlike wall-clock diffs, which sit inside the
# 17–63s noise band per gap-suite-cost-model-is-wrong-optimizations-buy-nothing). We record epoch-ms
# at each serial boundary and emit a per-segment breakdown to stderr on the FULL-SUITE default path.
# Only the default (product,engine) full-suite path emits it — scoped --group runs skip (their fixed
# overhead is not the object of measurement). Output lines: `__OVERHEAD__ <segment>_ms=<N>`.
_oh_mark() { date +%s%N | cut -c1-13; }
_oh_emit() { # _oh_emit <label> <start_ms> <end_ms>  → __OVERHEAD__ label_ms=N
  # uutils date doesn't truncate %3N (returns epoch+full-9-digit-ns), so we slice epoch-ms
  # from +%s%N. Guard: an empty/absent mark emits 0 rather than garbage (a mark capture that
  # raced a subshell must not corrupt the whole breakdown).
  local label="$1" s="$2" e="$3"
  if [ -z "$s" ] || [ -z "$e" ] || ! [[ "$s" =~ ^[0-9]+$ ]] || ! [[ "$e" =~ ^[0-9]+$ ]]; then
    echo "__OVERHEAD__ ${label}_ms=ERR-UNSET" >&2
    return
  fi
  echo "__OVERHEAD__ ${label}_ms=$((e - s))" >&2
}

# ── Partial-overhead fallback (gap-red-round-loses-overhead-phase-decomposition AC2/AC3) ──────────
# The full 9-segment emit below runs ONLY after the main phase completes — a kill-on-red truncation
# (runner red-grace / max-runtime SIGTERM to the whole process tree) therefore historically left a
# red round's archived log with ZERO __OVERHEAD__ lines even though serial/lowconc HAD completed.
# Two fixes make the red round measurable: (1) the runner tees stderr to the archive too (the
# __OVERHEAD__ lines ARE captured — locked by a regression test in full-suite-runner.test.mjs), and
# (2) THIS fallback: a SIGTERM/EXIT trap emits the COMPLETED segments (partial=1) on the truncation
# path, so serial/lowconc reach the log before the kill completes; un-run phases stay absent (缺省).
_oh_done=0  # 1 once the full emit OR the partial fallback ran — suppresses SIGTERM→EXIT double-emit

_oh_emit_p() { # _oh_emit_p <label> <start_ms> <end_ms> → __OVERHEAD__ label_ms=N partial=1 (skip if unset)
  local label="$1" s="$2" e="$3"
  # An un-run segment (e.g. main truncated) has an empty bound → 缺省: ABSENT, not ERR-UNSET, so a
  # truncated round is distinguishable from a genuinely broken one.
  if [ -z "$s" ] || [ -z "$e" ] || ! [[ "$s" =~ ^[0-9]+$ ]] || ! [[ "$e" =~ ^[0-9]+$ ]]; then
    return 0
  fi
  echo "__OVERHEAD__ ${label}_ms=$((e - s)) partial=1" >&2
}

_oh_emit_partial() {
  # Truncation-path fallback: emit the COMPLETED segments with partial=1. No-op on a scoped run
  # (oh_full=0) or once the full emit already ran (_oh_done=1). Missing bounds are skipped (缺省).
  [ "${oh_full:-0}" -eq 1 ] || return 0
  [ "${_oh_done:-0}" -eq 0 ] || return 0
  _oh_done=1
  _oh_emit_p "lock_overhead"             "$oh_t0" "$oh_t1"
  _oh_emit_p "resource_gate"             "$oh_t1" "$oh_t2"
  _oh_emit_p "build_dist"                "$oh_t2" "$oh_t3"
  _oh_emit_p "run_static_checks"         "$oh_t3" "$oh_t4"
  _oh_emit_p "gap_ms_pre_to_serial"      "$oh_t4" "$oh_t5"
  _oh_emit_p "serial_phase"              "$oh_t5" "$oh_t5b"
  _oh_emit_p "gap_ms_serial_to_lowconc"  "$oh_t5b" "$oh_t6"
  _oh_emit_p "lowconc_phase"             "$oh_t6" "$oh_t6b"
  # main_phase is emitted ONLY by the full path (needs oh_t7 set) — a truncated main stays absent.
}

_oh_install_partial_trap() {
  # SIGTERM → emit + re-raise 128+15 (the shell's signal-convention exit code, which the runner
  # already classifies as a signal-kill/abort — never a false green); EXIT is the backstop for a
  # set -e / any other non-SIGTERM truncation. _oh_done guards both paths so the emit runs exactly
  # once whether the exit is SIGTERM→EXIT or a plain EXIT.
  trap '_oh_emit_partial; exit 143' SIGTERM
  trap '_oh_emit_partial' EXIT
}
