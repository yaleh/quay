# runner-grouping.ts — the --group / __GROUP__ grouping mechanism, extracted from scripts/test.sh
# (gap-suite-hub-file-responsibility-strip).
#
# WHY A SEPARATE FILE: these functions decide WHICH test files run for a given --group — harness-critical,
# so this file IS a hub (suite-bucket-hub-list.ts HUB_FILES glob `plugin/scripts/runner-grouping*` matches
# it; a change here still forces the full suite). Extracting them out of scripts/test.sh shrinks that
# monolith WITHOUT weakening the hub rule. NOTE: this file is SOURCED by scripts/test.sh — bash does not
# care about the extension, and the `.ts` name is what makes the previously-dead `runner-grouping*` glob
# in HUB_FILES finally match a real file.
#
# Moved verbatim from scripts/test.sh lines 1292-1416: group_of / check_group_declarations /
# effective_groups / in_group / is_default_set / select_files / list_groups. build_deduped_files
# deliberately STAYS in scripts/test.sh (its `local glob=(...)` line is the ADR-004 single-source
# canonical test glob parsed by four checkers). check_group_declarations still invokes
# plugin/scripts/test-group-downgrade-check.ts.

# ── group resolution helpers (gap-test-suite-has-no-layer-grouping) ──────────────────────────────

# group_of <file> — echo the declared `// @test-group <name>` (default: engine, AC7).
# Valid groups: product|engine (the default-run body) + serial (the load-sensitive
# concurrency-1 phase — nested-suite-spawn + real-wall-clock-wait + the real-install
# install/quay-init family, gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests +
# gap-install-family-tests-rotate-flakes-under-full-suite) + lowconc (the hermetic-but-load-sensitive
# concurrency-3 phase, gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive). A MISSING
# declaration defaults to
# engine (AC7). An UNRECOGNIZED group name is FAIL-CLOSED, never silently degraded to engine:
# the r10 regression (four commits b209f4fd→174badc0→e92c54d8→c7176a37 each dropping one group
# from this case, so serial/lowconc silently folded into the concurrency-N body and the isolation
# guarantee was cancelled WITHOUT going red) must be a hard failure, not a silent pass.
# `governance` is RETIRED (gap-retire-governance-group-merge-into-bucket): it is no longer a
# recognized group — a file still declaring it now hits the FAIL-CLOSED branch.
group_of() {
  local f="$1" g=""
  # gap-suite-metadata-query-subprocess-spawn: prefer the in-process cache populated by
  # build_deduped_files (scripts/test.sh) — the metadata modes + full-suite path already warm it, so
  # this is a bash associative-array lookup instead of a per-file `grep|awk` spawn. The guard on
  # _RG_CACHE_READY keeps a STANDALONE sourcing (no cache — suite-bucket-load-sensitive-isolation
  # AC5 sources this file alone) on the grep fallback; the `-z` re-check also covers a cache miss
  # (a file outside the canonical glob, e.g. the --buckets path).
  if [ -n "${_RG_CACHE_READY:-}" ]; then
    g="${_RG_GROUP["$f"]:-}"
  fi
  if [ -z "${g:-}" ]; then
    g="$(grep -m1 -oE '@test-group[[:space:]]+[a-z]+' "$f" 2>/dev/null | awk '{print $2}' || true)"
  fi
  case "${g:-}" in
    product|engine|serial|lowconc) echo "$g" ;;
    "")
      # No declaration at all — intentional default to engine (AC7). The undeclared → engine path
      # is a real rule, distinct from an unknown-group typo.
      echo "engine" ;;
    *)
      echo "scripts/test.sh: group_of: FAIL-CLOSED: '$f' declares unknown @test-group '$g' — a group was dropped or mis-typed (recognized: product|engine|serial|lowconc); refusing to silently degrade it to engine" >&2
      exit 3
      ;;
  esac
}

# check_group_declarations — pre-flight fail-closed guard (gap-verify-round-9-failures-from-recent-
# changes-fix-batch, AC0b): every test file's declared `// @test-group` must be one of the five
# recognized groups. A file declaring an UNKNOWN group is a dropped/mis-typed group — the r10
# regression (b209f4fd→174badc0→e92c54d8→c7176a37 each dropping one group from group_of's case)
# silently folded serial/lowconc into the concurrency-N engine body and cancelled the isolation
# guarantee WITHOUT going red. That must be a HARD failure, not a silent pass. group_of's own
# `*)` branch is defense-in-depth (it runs inside a command substitution, so its exit cannot abort
# the parent); this check runs directly in the dispatch path and exits the script.
check_group_declarations() {
  # gap-suite-metadata-query-subprocess-spawn: warm the in-process cache ONCE in the PARENT shell
  # (build_deduped_files runs the single node pass that realpath-dedups AND validates every file's
  # @test-group, fail-closing on an unknown group). The loop below then reads the cached group per
  # file instead of re-spawning `grep|awk` — and because the helper already fail-closed, the `*)`
  # branch here is defense-in-depth, mirroring group_of's own.
  build_deduped_files > /dev/null
  local f g
  while IFS= read -r f; do
    g="${_RG_GROUP["$f"]:-}"
    case "${g:-}" in
      ""|product|engine|serial|lowconc) ;;
      *)
        echo "scripts/test.sh: FAIL-CLOSED: '$f' declares unknown @test-group '$g' — a group was dropped or mis-typed (recognized: product|engine|serial|lowconc); refusing to silently degrade it to engine" >&2
        exit 3
        ;;
    esac
  done < <(build_deduped_files)
  # gap-test-group-downgrade-no-guard (AC1): a LEGAL-but-degrading re-tag
  # (product/engine → serial/lowconc) silently removes a test from the default set —
  # check_group_declarations now ALSO runs the downgrade detector
  # (plugin/scripts/test-group-downgrade-check.ts), which requires a commit-message reason marker
  # ("@test-group-downgrade") for any default-set escape after the enforcement baseline.
  # stdout is redirected to stderr: this function also runs in the metadata modes
  # (--list-groups/--list-files) whose stdout IS the data (file list / group counts) — a checker
  # line leaking into it would be miscounted as a test file (test-coverage-check AC5 423 vs 421).
  # Exit-code split (2026-08-28, list-files=0 CI root cause): the guard's 1 = downgrade found →
  # HARD block; 2 = NOT-EVALUATED (enforcement baseline missing in a shallow/partial checkout) →
  # warn-but-continue. Conflating the two (the old bare `|| exit`) made a shallow clone kill
  # --list-files/--list-groups with EMPTY output, which broke test-coverage-check --selftest AC5
  # (canonical=540 list-files=0) — and more importantly hid the guard's own can't-evaluate state
  # behind a generic non-zero exit instead of the visible NOT-EVALUATED message (硬规则 3b).
  # ⛔ errexit-safe: test.sh runs `set -euo pipefail`, so the guard call MUST capture its exit
  # code without letting a non-zero result abort the script (a bare call would exit the script on
  # the guard's exit 2 before the rc check runs). ⛔ NOT the pipe-ampersand rc-capture spelling
  # (instrument-failure-check FAMILY-3 fires on it); the if/else form below is both errexit-safe
  # and FAMILY-3-clean.
  local dg_rc=0
  if node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/test-group-downgrade-check.ts" --root "${repo_root}" >&2; then
    :
  else
    dg_rc=$?
  fi
  if [ "$dg_rc" -eq 1 ]; then exit 1; fi
}

# build_deduped_files — deliberately STAYS in scripts/test.sh (NOT moved here): its `local glob=(...)`
# line is the SINGLE-SOURCE (ADR-004) canonical test glob that FOUR checkers mechanically parse from
# scripts/test.sh (test-framework-policy-check.ts / test-coverage-check.ts / test-impl-census-check.ts /
# test-group-downgrade-check.ts). Moving it here would break those checkers' glob derivation (0 files).
# The functions below (check_group_declarations / select_files / list_groups) call build_deduped_files
# by NAME — bash resolves it at CALL time, so it is available even though it is defined in test.sh.

# effective_groups — echo the groups a given run should include (default product,engine, AC4).
effective_groups() {
  echo "product,engine"
}

# in_group <group> <csv> — return 0 iff group is in the comma-separated list.
in_group() {
  local g="$1" csv="$2"
  [[ ",${csv}," == *",${g},"* ]]
}

# is_default_set <csv> — return 0 iff csv is exactly the default set {product,engine} (AC6).
is_default_set() {
  [ "${1:-}" = "product,engine" ]
}

# select_files <groups-csv> — echo the files to run for the given groups (AC4/AC6).
# `governance` passthrough removed (gap-retire-governance-group-merge-into-bucket): governance is no
# longer a select/skip group, so the only selection semantics here are exact group membership.
select_files() {
  # gap-suite-metadata-query-subprocess-spawn: warm the in-process cache in the PARENT shell (a
  # no-op when already warm) so the loop reads the cached group directly instead of forking a
  # `$(group_of ...)` command substitution per file (~550 forks/call). check_group_declarations
  # already warms it on every real path; this defensive warm keeps a direct standalone call correct.
  build_deduped_files > /dev/null
  local groups="$1" f g
  while IFS= read -r f; do
    g="${_RG_GROUP["$f"]:-}"
    if in_group "$g" "$groups"; then
      printf '%s\n' "$f"
    fi
  done < <(build_deduped_files)
}

# list_groups — per-group counts over the full deduped glob (AC10). `serial` and `lowconc` are real
# groups (the load-sensitive families routed to their own phases), so the default-set partition
# product+engine no longer equals total — serial and lowconc are the 3rd and 4th parts.
list_groups() {
  # gap-suite-metadata-query-subprocess-spawn: warm the in-process cache in the PARENT shell (no-op
  # when already warm) so the loop reads the cached group directly, not via a per-file
  # `$(group_of ...)` fork. check_group_declarations already warms it on every real path.
  build_deduped_files > /dev/null
  declare -A counts=([product]=0 [engine]=0 [serial]=0 [lowconc]=0)
  local f g
  while IFS= read -r f; do
    g="${_RG_GROUP["$f"]:-}"
    counts[$g]=$(( ${counts[$g]:-0} + 1 ))
  done < <(build_deduped_files)
  printf 'product:    %d\n' "${counts[product]:-0}"
  printf 'engine:     %d\n' "${counts[engine]:-0}"
  printf 'serial:     %d\n' "${counts[serial]:-0}"
  printf 'lowconc:    %d\n' "${counts[lowconc]:-0}"
  local total=$(( ${counts[product]:-0} + ${counts[engine]:-0} + ${counts[serial]:-0} + ${counts[lowconc]:-0} ))
  printf 'total:      %d (deduped by realpath)\n' "$total"
}
