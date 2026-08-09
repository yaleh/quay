#!/usr/bin/env bash
# test-file-snapshot.sh — baseline-snapshot helper for the RELATIVE-BASELINE test criterion
# (gap-global-count-assertions-fragile-relative-baseline).
#
# Replaces fragile ABSOLUTE global-count assertions (`EXPECTED_ENGINE = 58` — stale the moment any
# test file is added, which is exactly why B3-2 went red on fan-in when B3-1 merged a new engine
# test 13 min after B3-2's worktree snapshot) with a RELATIVE baseline: record the test-file set at
# worktree creation (the fork baseline), then assert the CURRENT set against it:
#   * ADDITIONS are ALLOWED — a concurrent merge adding a test file is the B3-2 scenario and must
#     not go red (the tick rule "测试不得硬编码全局计数");
#   * a REMOVAL is a REAL regression (a test file disappeared from the set) and is always red.
# This is the "当前树 = 基线 + 新增" comparison — relative to a snapshot, never an absolute count.
#
# The canonical file list is read from `scripts/test.sh --list-files` — the SINGLE SOURCE OF TRUTH
# for the test glob (ADR-004). This script never hand-writes the glob. Fixtures may pass explicit
# file lists to simulate alternate trees (a temp copy, a B3-2-style concurrent-merge scenario)
# without touching the real checkout.
#
# Usage:
#   test-file-snapshot.sh snapshot <baseline-file> [files...]
#       Record the current test-file set into <baseline-file> (one path per line, sorted, deduped).
#       With no [files...], the canonical set is read from `scripts/test.sh --list-files`.
#
#   test-file-snapshot.sh check <baseline-file> [--expect-added <additions-file>] [files...]
#       Compare the current set against the baseline.
#         default (relative / fan-in): every baseline file must still be present; additions since
#           the baseline are reported and ALLOWED. Exit 0 on pass; exit 1 on any removal.
#         with --expect-added <additions-file> (a file, one path per line): the exact worktree
#           check — current must equal baseline ∪ expected additions; an UNEXPECTED addition is red
#           too (catches a stray file leaked into the worktree before rebase).
#
# Exit codes: 0 = relative-baseline satisfied; 1 = regression (removal, or unexpected addition
# under --expect-added); 2 = usage error.
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_sh="${repo_root}/scripts/test.sh"

usage() {
  sed -n '2,38p' "${BASH_SOURCE[0]}" | sed -n 's/^# \{0,1\}//p' >&2
  exit 2
}

# current_files — the live set as sorted, deduped lines. Non-empty "$@" → explicit paths (fixture
# mode); empty → the canonical `scripts/test.sh --list-files` output (single source of truth).
#
# D-class runtime-fixture exclusion (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-
# tests, AC2): a test that creates a THROWAWAY `zz-*` fixture in the shared plugin/test dir (e.g.
# runner-grouping AC7's zz-runner-grouping-undeclared.test.mjs, created then deleted in a finally)
# must not poison the snapshot baseline. A snapshot taken while such a fixture exists records it as
# a baseline file; the fixture's later deletion then reads as "baseline test file REMOVED" — a FALSE
# regression. The `zz-` prefix is the repo's throwaway-fixture convention (git ls-files '*.test.mjs'
# contains no real zz-* file), so canonical-mode snapshots skip them. Explicit fixture paths are the
# caller's business and pass through verbatim.
current_files() {
  if [ "$#" -gt 0 ]; then
    printf '%s\n' "$@"
  else
    bash "${test_sh}" --list-files | grep -vE '/zz-[^/]*$' || true
  fi
}

cmd="${1:-}"
shift 2>/dev/null || true

case "${cmd}" in
  snapshot)
    [ "$#" -ge 1 ] || usage
    baseline="${1}"
    shift
    current_files "$@" | sort -u > "${baseline}"
    n="$(wc -l < "${baseline}" | tr -d ' ')"
    echo "test-file-snapshot: recorded ${n} test files → ${baseline}"
    ;;
  check)
    [ "$#" -ge 1 ] || usage
    baseline="${1}"
    shift
    [ -f "${baseline}" ] || { echo "test-file-snapshot: baseline not found: ${baseline}" >&2; exit 1; }

    expect_added=""
    if [ "${1:-}" = "--expect-added" ]; then
      shift
      [ "$#" -ge 1 ] || usage
      expect_added="${1}"
      shift
      [ -f "${expect_added}" ] || { echo "test-file-snapshot: --expect-added file not found: ${expect_added}" >&2; exit 1; }
    fi

    baseline_sorted="$(mktemp)"
    current_sorted="$(mktemp)"
    trap 'rm -f "${baseline_sorted}" "${current_sorted}"' EXIT
    sort -u "${baseline}" > "${baseline_sorted}"
    current_files "$@" | sort -u > "${current_sorted}"

    # removals = baseline lines absent from the current set (real regression).
    removals="$(comm -23 "${baseline_sorted}" "${current_sorted}")"
    # additions = current lines absent from the baseline (allowed growth).
    additions="$(comm -13 "${baseline_sorted}" "${current_sorted}")"

    if [ -n "${removals}" ]; then
      echo "test-file-snapshot: FAIL — baseline test file(s) REMOVED (real count regression):" >&2
      while IFS= read -r f; do [ -n "${f}" ] && echo "  - ${f}" >&2; done <<< "${removals}"
      exit 1
    fi

    if [ -n "${expect_added}" ]; then
      # Exact worktree check: current == baseline ∪ expected additions.
      expected_sorted="$(mktemp)"
      trap 'rm -f "${baseline_sorted}" "${current_sorted}" "${expected_sorted}"' EXIT
      sort -u "${expect_added}" > "${expected_sorted}"
      # expected_union = baseline ∪ expected (sorted, deduped)
      expected_union="$(mktemp)"
      trap 'rm -f "${baseline_sorted}" "${current_sorted}" "${expected_sorted}" "${expected_union}"' EXIT
      cat "${baseline_sorted}" "${expected_sorted}" | sort -u > "${expected_union}"
      unexpected="$(comm -23 "${current_sorted}" "${expected_union}")"
      if [ -n "${unexpected}" ]; then
        echo "test-file-snapshot: FAIL — unexpected test file(s), not in baseline nor --expect-added:" >&2
        while IFS= read -r f; do [ -n "${f}" ] && echo "  + ${f}" >&2; done <<< "${unexpected}"
        exit 1
      fi
    fi

    add_count="$(printf '%s' "${additions}" | grep -c '^' || true)"
    echo "test-file-snapshot: OK — baseline intact; ${add_count} addition(s) since baseline"
    if [ -n "${additions}" ]; then
      echo "test-file-snapshot: additions:"
      while IFS= read -r f; do [ -n "${f}" ] && echo "  + ${f}"; done <<< "${additions}"
    fi
    ;;
  *)
    usage
    ;;
esac
