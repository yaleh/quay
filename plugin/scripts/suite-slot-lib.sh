#!/usr/bin/env bash
# suite-slot-lib.sh — bash 侧 suite 槽路径唯一实现 (单一定义点, gap-suite-concurrency-ff-gate-and-slot-ssot).
#
# THE DEFECT THIS CLOSES: scripts/test.sh 的 single-flight 锁曾【写死】两个槽文件 (FULL_SUITE_LOCK_0/_1,
# 注释断言「slot count IS the QUAY_MAX_CONCURRENT_SUITES knob」而实现没有 — 硬规则③b)。槽数由 S 生成
# (S=1 ⇒ 仅 `.0`, S=3 ⇒ `.0/.1/.2`), FD 动态分配, 不再写死两个。
#
# This file is the bash-side canonical for "the suite lock slots", sourced by scripts/test.sh ONLY
# (fan-in-ff-merge.sh NO LONGER reads any suite lock — it reads the task's own suite capture instead,
# AC1). The TS side has its own canonical (plugin/scripts/suite-lock-slots.ts, read by
# full-suite-runner.ts / worktree-process-reaper.ts); the behavioral invariant
# (plugin/scripts/suite-slot-ssot-check.ts + plugin/test) verifies the two agree.
#
# SEAM SYMMETRY (gap-suite-lock-slot-seam-asymmetry): the TS canonical suiteLockSlotCount() reads the
# SAME precedence as this file — RESOURCE_GATE_CONCURRENT_SUITES (the deterministic test seam) FIRST,
# then `<base>.concurrency` (the scalar file — gap-suite-concurrency-env-to-file-fresh-read: env is
# forked once per process, a file is re-read by the next detached suite process without a restart),
# then 旋钮② QUAY_MAX_CONCURRENT_SUITES, then the 1 default, with empty-string-as-unset (`:-`) on both.
# The two canons therefore agree under ANY env AND any `.concurrency` file, including a test seam (they
# could only drift if one side's semantics changed independently — exactly what suite-slot-ssot-check
# I4 detects). Both read the file RAW (bash `[ -f "$f" ] && cat "$f"`, TS `fs.existsSync &&
# fs.readFileSync(...).trim()`), so I4 stays an honest dual-implementation cross-check (故意双实现算同
# 一个数 — 不引入 YAML 依赖, 不让 bash 转调 node).
#
# Functions:
#   suite_slot_count     — echo S = RESOURCE_GATE_CONCURRENT_SUITES (test seam) → `<base>.concurrency`
#                          (scalar file next to the lock base, fresh-read) → QUAY_MAX_CONCURRENT_SUITES
#                          (旋钮②) → 1. Optional first arg = the lock base (used for the file read);
#                          when omitted the base is resolved like test.sh's full_suite_lock
#                          (FULL_SUITE_LOCK_FILE env → git-common-dir → .git/full-suite.lock).
#   suite_slot_paths     — echo the S slot paths for a base (`${base}.0`..`${base}.S-1`), one per line.
#
# Both generate the digit via a loop variable — a `full-suite.lock.<digit>` literal never appears here
# (the SSoT checker greps for that shape and must find ZERO hits outside the generation loops).

# shellcheck disable=SC2317  # sourced functions are not "unused"
suite_slot_count() {
  # `${1:-}` not `$1` — the no-arg call (default_concurrency_formula / serial_lowconc_host_default and
  # the I4 checker) runs under test.sh's `set -u`, where a bare `$1` is an unbound-variable error.
  local base="${1:-}" file="" s fv
  if [ -n "$base" ]; then
    file="${base}.concurrency"
  else
    # Resolve the base the same way test.sh's full_suite_lock does (FULL_SUITE_LOCK_FILE env override →
    # git-common-dir → .git/full-suite.lock) so a no-arg call (the I4 checker) reads the SAME file the
    # TS canonical resolves from process.cwd().
    local d="${FULL_SUITE_LOCK_FILE:-}"
    if [ -z "$d" ]; then
      d="$(git rev-parse --git-common-dir 2>/dev/null || true)"
      [ -z "$d" ] && d=".git"
      d="${d}/full-suite.lock"
    fi
    file="${d}.concurrency"
  fi

  # ① test seam env (deterministic tests; empty-string-as-unset, invalid falls through)
  s="${RESOURCE_GATE_CONCURRENT_SUITES:-}"
  if [ -n "$s" ]; then
    case "$s" in
      ''|*[!0-9]*) : ;;  # non-numeric / empty → fall through
      *)
        if [ "$s" -ge 1 ]; then echo "$s"; return; fi
        ;;
    esac
  fi

  # ② `.concurrency` scalar file next to the lock base — RAW read, fresh every call (no restart for the
  # next detached suite process to pick up a new S). Non-numeric / empty falls through.
  [ -f "$file" ] && fv="$(cat "$file")"
  if [ -n "${fv:-}" ]; then
    fv="${fv#"${fv%%[![:space:]]*}"}"   # strip leading whitespace (matches TS .trim())
    fv="${fv%"${fv##*[![:space:]]}"}"   # strip trailing whitespace
    case "$fv" in
      ''|*[!0-9]*) : ;;
      *)
        if [ "$fv" -ge 1 ]; then echo "$fv"; return; fi
        ;;
    esac
  fi

  # ③ env 旋钮② (transition period — the file now has priority over it)
  s="${QUAY_MAX_CONCURRENT_SUITES:-}"
  if [ -n "$s" ]; then
    case "$s" in
      ''|*[!0-9]*) : ;;
      *)
        if [ "$s" -ge 1 ]; then echo "$s"; return; fi
        ;;
    esac
  fi

  echo 1  # default: single-suite baseline (S=1, gap-fan-in-workflow-lock-and-S1 — 0/negative/non-numeric above all fail open here)
}

# shellcheck disable=SC2317
suite_slot_paths() {
  local base="$1" count i
  count="$(suite_slot_count "$base")"   # pass the base so the `.concurrency` file read uses it
  i=0
  while [ "$i" -lt "$count" ]; do
    printf '%s\n' "${base}.${i}"
    i=$((i + 1))
  done
}

# spawn_suite_lock_hold_watchdog — spawn the hold-cap watchdog (gap-suite-lock-starvation-long-
# validation-hold AC1). Args: <held-fd> <flag-file> <main-pid> <hold-max-s> [timer-cut]. The watchdog
# runs as a child of the lock-HOLDING process (⛔ not an outside worker-driver kill): it polls the flag
# file each 1s and (a) exits promptly when the holder releases normally (flag removed), (b) releases the
# slot immediately if the holder died without releasing (crash-autorelease, ≤1s delay — the inherited FD
# shares the same open-file-description lock), or (c) after <hold-max-s> seconds of the holder STILL
# holding, releases the slot + emits a fail-loud `lock_hold_exceeded=1` marker (never silent). Path (c)
# is the long-validation YIELD and fires ONLY when `timer-cut` is "1" (the default, used by the SUITE
# lock — its cap is the 5.2h validation run). Pass `timer-cut=0` for the fan-in lock
# (gap-full-suite-lock-hold-watchdog-threshold-shorter-than-fan-in): its hold = merge→suite→ff, which
# legitimately exceeds any fixed timer, so path (c) must never cut it — dead-holder release (b) is the
# only guard (a crash closes the flock fd; a hung suite is SIGKILL'd by the runner's silence watchdog,
# which ends the fan-in ⇒ the lock is released). The cap only yields the SLOT — the long suite keeps
# running; it accepts the contention risk of a (S+1)-th suite joining rather than serializing the whole
# repo behind its re-check.
# shellcheck disable=SC2317
spawn_suite_lock_hold_watchdog() {
  local _fd="$1" _flag="$2" _main_pid="$3" _max_s="$4" _timer_cut="${5:-1}"
  (
    if [ "${_timer_cut}" != "1" ]; then
      # Dead-holder-only mode (fan-in lock): poll for (a) normal release or (b) crash, but
      # NEVER time a live holder out — path (c) is disabled (the fan-in hold = merge→suite→ff outlives
      # any fixed timer; cutting it mid-suite makes the ff run lock-less, re-exposing ff-race).
      while :; do
        sleep 1
        [ -e "${_flag}" ] || exit 0
        kill -0 "${_main_pid}" 2>/dev/null || { flock -u "${_fd}" 2>/dev/null || true; rm -f "${_flag}"; exit 0; }
      done
    fi
    _w_remaining="${_max_s}"
    while [ "${_w_remaining}" -gt 0 ]; do
      sleep 1
      [ -e "${_flag}" ] || exit 0
      kill -0 "${_main_pid}" 2>/dev/null || { flock -u "${_fd}" 2>/dev/null || true; rm -f "${_flag}"; exit 0; }
      _w_remaining=$((_w_remaining - 1))
    done
    if [ -e "${_flag}" ]; then
      flock -u "${_fd}" 2>/dev/null || true
      rm -f "${_flag}"
      echo "__OVERHEAD__ lock_hold_exceeded=1" >&2
      echo "suite-lock-hold-watchdog: LOCK-HOLD-EXCEEDED — released full-suite slot after ${_max_s}s (long-validation yield, fail-loud)" >&2
    fi
  ) >/dev/null &  # ⛔ stdout→/dev/null: the watchdog's inherited stdout would otherwise hold the caller's
                  # command-substitution pipe open and block `$(spawn_suite_lock_hold_watchdog …)` for the
                  # FULL T seconds (实测 T=3 ⇒ 3.02s block) — the fail-loud markers are on STDERR, unaffected.
  echo "$!"
}
