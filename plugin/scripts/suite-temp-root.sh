#!/usr/bin/env bash
# suite-temp-root.sh — the SUITE's own temp root and its EXIT path (gap-test-harness-tmp-dir-leak).
#
# THE DEFECT. Every test file mkdtemp()'s its fixtures under <tmp>; nothing owned the EXIT path, so
# a few percent of them survived each run. Measured 2026-11-06 on this host:
#   $ find /tmp -maxdepth 1 -name 'quay-*' | wc -l
#   46218            # 15,278 of them older than 7 days
# It is the 硬规则 3b shape — no reading ever turns red because /tmp holds 46,218 dirs, so the leak
# is indistinguishable from "everything is fine". A one-off `rm -rf` (already done once) is not a
# fix: the producing mechanism is untouched and the next suite re-leaks.
#
# THE MECHANISM. This file gives ONE RUN ONE PRIVATE TEMP ROOT:
#   1. `mktemp -d <ambient>/quay-suite-<pid>-XXXXXX` — the root is unique per run and starts EMPTY,
#      so everything found in it at exit was created by this run (a concurrent suite, a concurrent
#      worktree's scoped gate, has its OWN root and can never be reaped by mistake — the reason this
#      is a temp root and not an age-based sweep of the shared /tmp).
#   2. `export TMPDIR/TMP/TEMP=<root>` — Node's os.tmpdir(), fs.mkdtempSync(os.tmpdir()), bash
#      `mktemp` and the suite's own tmux-leak-scan all resolve through these (the scan mirrors
#      Node's precedence exactly), so every fixture the suite creates lands UNDER the root without
#      any test file changing.
#   3. `trap 'suite_temp_root_cleanup' EXIT` — bash runs the EXIT trap on SIGTERM/SIGINT too
#      (verified: `trap … EXIT; kill -TERM $$` fires it, exit 143), so the cleanup covers the signal
#      path as well as the happy path; that is the AC2 half of the criterion (a cleanup that only
#      runs in afterAll is exactly what leaked).
#   3b. PLUS a detached JANITOR, because on the paths that matter the trap CANNOT fire: test.sh ends
#      in `exec node --test …` and `exec` replaces the shell. See the block above
#      suite_temp_root_guard for the measurement. The janitor polls the owning pid (unchanged by
#      exec) and reaps once it is gone — covering exec, SIGKILL and a crash.
#   4. On the way out, the reaper removes the root's entries — SPARING any entry a live process has
#      as its cwd (a leaked `quay serve` / a fixture a not-yet-dead child stands in) — and prints
#      ONE telemetry line with three counts:
#        tmp-root-telemetry: root=<dir> created=<n> reaped=<n> leaked=<n> evaluated=true
#      When the reaper could not evaluate, every field reads NOT-EVALUATED — a run whose reaper
#      never ran must not be readable as a run that reaped everything (硬规则 3b).
#
# ⛔ CROSS-RUN CACHES STAY OUTSIDE THE ROOT. `quay-real-install-build-cache` is deliberately shared
# across runs (it self-prunes at 48h); pointing it inside a per-run root would throw away a
# multi-minute shipped-build on EVERY run. QUAY_TEST_SHARED_BUILD_CACHE is therefore pinned to its
# historical ambient path, unchanged.
#
# OWNERSHIP. The runner (full-suite-runner.ts) may create the root itself and hand it down — then
# QUAY_SUITE_TMP_ROOT is already set and this file only adopts it (the RUNNER reaps; a child must
# never delete a parent's root). Direct invocations (`bash scripts/test.sh …`, the scoped gate, a
# worktree fan-in run) create and own their own.
#
# Seams (hermetic tests): QUAY_TEST_SKIP_SUITE_TMP_ROOT=1 — do not create a root (keep the ambient
# tmp); QUAY_SUITE_TMP_ROOT=<dir> — adopt an already-created root.
#
# ⛔ THIS FILE CONTAINS NO EMBEDDED INTERPRETER (no node/python3/jq at a command position): the
# reaper is invoked through plugin/scripts/temp-root-reaper.sh, the `*-check.sh wraps *-check.ts`
# thin-wrapper convention. Keep it that way — sh-census-check counts the WHOLE file's code lines for
# every .sh that carries one, and this file's logic is not worth a ratchet bump.

# Globals (⛔ no `local`: the EXIT trap runs OUTSIDE this frame and bash does not give a trap handler
# dynamic scoping into an interrupted frame — the same constraint test.sh's own partial-fallback trap
# documents). `suite_tmp_owner=1` means THIS process created the root and is therefore the one that
# reaps it; adopting a parent's root leaves it 0 so a nested run never deletes the parent's tree.
suite_tmp_root="${QUAY_SUITE_TMP_ROOT:-}"
suite_tmp_owner=0

suite_temp_root_cleanup() {
  local status=0 line=""
  [ "${suite_tmp_owner:-0}" = "1" ] || return 0
  # Disarm FIRST: re-entry (a signal arriving while reaping) must not run the pass twice.
  suite_tmp_owner=0
  [ -n "${suite_tmp_root:-}" ] && [ -d "${suite_tmp_root}" ] || return 0
  local reaper
  reaper="$(dirname "${BASH_SOURCE[0]}")/temp-root-reaper.sh"
  # `cmd || status=$?` keeps `set -e` from aborting the exit path on a non-zero reaper verdict.
  # --prefix "" = EVERY entry in the root (the root is private to this run, so "quay-*" would leave
  # the non-quay fixture families — fsr-*, rec-*, the tmux sockets — behind and the rmdir would fail).
  line="$(bash "${reaper}" --root "${suite_tmp_root}" --prefix "" --max-age 0 --no-default-excludes --telemetry 2>/dev/null)" || status=$?
  case "${status}" in
    0|3)
      # 0 = evaluated (reaped or spared-and-counted), 3 = NOT-EVALUATED — both carry a real
      # telemetry line whose leaked= field distinguishes them. Never synthesise a 0 here.
      [ -n "${line}" ] && printf '%s\n' "${line}" >&2
      ;;
    *)
      printf 'tmp-root-telemetry: root=%s created=NOT-EVALUATED reaped=NOT-EVALUATED leaked=NOT-EVALUATED evaluated=false reason=reaper-failed\n' \
        "${suite_tmp_root}" >&2
      ;;
  esac
  # Only an EMPTY root can be removed; a non-empty one means entries survived (leaked= counts them
  # and the line above says so). ⛔ never `rm -rf` the root here: that would delete exactly the
  # live-cwd-held entries the reaper just refused to touch.
  rmdir "${suite_tmp_root}" 2>/dev/null || true
  return 0
}

# ── WHY A TRAP IS NOT ENOUGH (measured, not assumed) ─────────────────────────────────────────────
# scripts/test.sh does NOT fall off the end of the file on the paths that matter: run_selected ends in
# `exec node --test …` (six exec sites), and `exec` REPLACES the shell — the bash process that owns
# the EXIT trap is gone the instant node starts. Measured 2026-11-06: `bash scripts/test.sh --help`
# SIGTERM'd at 120s left an EMPTY /tmp/quay-suite-<pid>-<rand> behind with no telemetry line — the
# trap never ran because bash was no longer there. So the exit path needs an owner that is not the
# shell: a DETACHED JANITOR started at init that polls the owning pid (`$$` survives `exec`, which
# keeps the pid) and reaps the root once that pid is gone.
#
#   trap      → catches the non-exec exits immediately (static-only / metadata / arg-error paths),
#               and everything that kills bash while it still IS bash.
#   janitor   → catches the exec'd node path, a SIGKILL, and a crash — i.e. exactly the residue class
#               a one-off `rm -rf` used to be the only answer for.
# Only ONE of them prints the telemetry line: both first check that the root still exists, and the
# trap disarms the owner flag, so the loser of the race exits quietly (`root-missing` ⇒ no line).
suite_temp_root_guard() {
  local owner="$1" root="$2" reaper="$3" script
  [ -n "${owner}" ] && [ -n "${root}" ] && [ -n "${reaper}" ] || return 0
  # setsid keeps the janitor OUT of the suite's process group, so a group-wide kill of a hung suite
  # (the runner's teardown) does not take the janitor with it — which would resurrect the leak.
  script='owner="$1"; root="$2"; reaper="$3"
while kill -0 "$owner" 2>/dev/null; do sleep 5; done
[ -d "$root" ] || exit 0
bash "$reaper" --root "$root" --prefix "" --max-age 0 --no-default-excludes --telemetry >&2
rmdir "$root" 2>/dev/null || true'
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -c "${script}" _ "${owner}" "${root}" "${reaper}" </dev/null >/dev/null &
  else
    bash -c "${script}" _ "${owner}" "${root}" "${reaper}" </dev/null >/dev/null &
  fi
  return 0
}

suite_temp_root_init() {
  [ "${suite_tmp_owner:-0}" = "1" ] && return 0
  local ambient
  if [ -n "${suite_tmp_root:-}" ] && [ -d "${suite_tmp_root}" ]; then
    # Runner-owned: adopt the path, ⛔ do not reap it (see OWNERSHIP above).
    export TMPDIR="${suite_tmp_root}" TMP="${suite_tmp_root}" TEMP="${suite_tmp_root}"
    return 0
  fi
  [ "${QUAY_TEST_SKIP_SUITE_TMP_ROOT:-0}" = "1" ] && return 0
  ambient="${TMPDIR:-${TMP:-${TEMP:-/tmp}}}"
  while [ "${ambient}" != "/" ] && [ "${ambient%/}" != "${ambient}" ]; do ambient="${ambient%/}"; done
  suite_tmp_root="$(mktemp -d "${ambient}/quay-suite-$$-XXXXXX" 2>/dev/null)" || { suite_tmp_root=""; return 0; }
  export QUAY_SUITE_TMP_ROOT="${suite_tmp_root}"
  export TMPDIR="${suite_tmp_root}" TMP="${suite_tmp_root}" TEMP="${suite_tmp_root}"
  export QUAY_TEST_SHARED_BUILD_CACHE="${ambient}/quay-real-install-build-cache"
  suite_tmp_owner=1
  trap 'suite_temp_root_cleanup' EXIT
  suite_temp_root_guard "$$" "${suite_tmp_root}" "$(dirname "${BASH_SOURCE[0]}")/temp-root-reaper.sh"
  return 0
}

# Sourcing IS the init for the suite entry point (scripts/test.sh, once, at the top). A hermetic test
# that wants only the functions sets QUAY_TEST_SKIP_SUITE_TMP_ROOT=1 before sourcing.
if [ "${BASH_SOURCE[0]}" != "${0}" ]; then suite_temp_root_init; fi
