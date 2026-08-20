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
# then 旋钮② QUAY_MAX_CONCURRENT_SUITES, then the 2 default, with empty-string-as-unset (`:-`) on both.
# The two canons therefore agree under ANY env, including a test seam (they could only drift if one
# side's semantics changed independently — exactly what suite-slot-ssot-check I4 detects).
#
# Functions:
#   suite_slot_count     — echo S = RESOURCE_GATE_CONCURRENT_SUITES (test seam, same convention as
#                          test.sh's derivation functions) → QUAY_MAX_CONCURRENT_SUITES (旋钮②) → 2.
#   suite_slot_paths     — echo the S slot paths for a base (`${base}.0`..`${base}.S-1`), one per line.
#
# Both generate the digit via a loop variable — a `full-suite.lock.<digit>` literal never appears here
# (the SSoT checker greps for that shape and must find ZERO hits outside the generation loops).

# shellcheck disable=SC2317  # sourced functions are not "unused"
suite_slot_count() {
  local s="${RESOURCE_GATE_CONCURRENT_SUITES:-${QUAY_MAX_CONCURRENT_SUITES:-2}}"
  case "$s" in
    ''|*[!0-9]*) echo 2 ;;  # non-numeric / empty fails open to the single default (never 0 slots)
    *)
      if [ "$s" -lt 1 ]; then
        echo 2  # 0/negative fails open to the single default (the old 1-slot behavior)
      else
        echo "$s"
      fi
      ;;
  esac
}

# shellcheck disable=SC2317
suite_slot_paths() {
  local base="$1" count i
  count="$(suite_slot_count)"
  i=0
  while [ "$i" -lt "$count" ]; do
    printf '%s\n' "${base}.${i}"
    i=$((i + 1))
  done
}
