#!/usr/bin/env bash
# @instrument "After a quay tgz install on a target machine, do the TOP-N real-use mechanisms (capability-catalog.sh + the offline-runnable subset of the three-layer-core-named scripts) each REALLY run — assert exit code + non-empty output — and does the negative control (deleting any verified script) make verification fail (AC92)?"
# deliver-verify-usage.sh — AC92 (tasks/gap-ac92-delivery-verify-usage-intersection):
# the delivery verification surface must INTERSECT the actual usage surface.
#
# PROBLEM (manager measurement, reading ② of manager-phase-goal.md AC92): develop-deliver-tgz.sh
# verified an installed tgz ONLY by `quay --help` + `quay serve` + `curl http_code==200` — i.e.
# "the port is alive". But the dev process actually leans on plugin/scripts/* mechanisms via Bash
# (16428 calls): the three-layer execution cores name ~60 scripts, the catalog is the directory's
# self-inventory. "验证的是「端口活着」，使用的是「几百个脚本能不能跑」——两者几乎不相交."
# ⇒ this script is the OTHER half of the deliver verification: after install, run the real-use
# mechanisms and assert they actually execute (exit 0 + non-empty output).
#
# ── WHAT IS THE TOP-N SET (and why N) ────────────────────────────────────────────
# N is DERIVED from the measured distribution (reading ②), NOT picked:
#   1. The three-layer execution cores (orchestration/{orchestrator,fast-mode,manager}-tick-core.md)
#      name the plugin/scripts mechanisms the loop actually calls every tick (~23 unique in the
#      current tree; reading ② counts ≈60 across all orchestration docs).
#   2. The OFFLINE-RUNNABLE subset = those that execute on a FRESH installed target (installed
#      package's plugin/scripts, a fresh workspace, no network/live-session/repo dependency) with a
#      documented invocation and return exit 0 + non-empty output.
#   3. The verified set = capability-catalog.sh (the directory's self-inventory, AC2-mandated)
#      + that offline-runnable subset. N = 10 verified rows over 9 distinct mechanisms
#      (capability-catalog's --json and --entry-surface gates are two rows of the one mechanism).
# If the cores name different mechanisms in the future, the set (and N) changes with them — this is
# not a hardcoded number, it is the intersection of "named by the cores" with "offline-runnable".
#
# ── THE SET (each row: <id>|<kind>|<relpath under plugin-scripts>|<arg template, @WS@ = workspace>) ──
#   kind sh = plugin/scripts/<relpath> · kind js = plugin/scripts/dist/<relpath>
#   All verified empirically against a package.sh-equivalent layout (build-plugin-dist + .ts deleted
#   + invokers rewritten) — exit 0 + non-empty output in a fresh workspace.
VERIFY_SET=(
  "capability-catalog-json|sh|capability-catalog.sh|--json"
  "capability-catalog-entry-surface|sh|capability-catalog.sh|--entry-surface"
  "monitor-mount-check|sh|monitor-mount-check.sh|"
  "closure-lag-check|sh|closure-lag-check.sh|--root @WS@"
  "ready-pool-check|js|dist/ready-pool-check.js|--root @WS@ --cap 5"
  "slot-refill|js|dist/slot-refill.js|--root @WS@ --cap 5"
  "pool-quality-judge|js|dist/pool-quality-judge.js|--root @WS@"
  "suite-execution-form-counter|js|dist/suite-execution-form-counter.js|--root @WS@"
  "inner-exec-mode-report|js|dist/inner-exec-mode-report.js|--root @WS@"
  "fast-mode-telemetry|js|dist/fast-mode-telemetry.js|--root @WS@"
)

# ── --help (gap-scripts-sprawl: 用法在前、退出 0、无业务副作用) ─────────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'HELP'
usage:
  bash deliver-verify-usage.sh --plugin-scripts <dir> --ws <dir> [--timeout <secs>]
        [--list] [--negative-control <file>] [--help]

  --plugin-scripts <dir>   the INSTALLED plugin/scripts dir (e.g. "$(npm root -g)/quay/plugin/scripts")
  --ws <dir>               a FRESH workspace with tasks/ (the deliver flow's temp ws)
  --timeout <secs>         per-mechanism kill timeout (default 20)
  --list                   print the verified set + N and exit 0 (no execution)
  --negative-control <f>   copy plugin-scripts to a temp dir, delete <f> (a verified file),
                           re-run the verification against the copy, and ASSERT it fails (exit 1).
                           exit 0 = negative control holds; exit 1 = verification did NOT fail ⇒
                           the check is not able to take false.
  --help                   this help (no side effects)

Exit: 0 = every mechanism ran with exit 0 + non-empty output; 1 = any mechanism failed;
      2 = usage/environment error. In --negative-control mode exit 0 = control HOLDS (verification
      failed as expected), 1 = control BROKEN (verification still passed).
HELP
  exit 0
fi

set -euo pipefail

PLUGIN_SCRIPTS=""
WS=""
TIMEOUT=20
LIST=0
NEGATIVE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --plugin-scripts) PLUGIN_SCRIPTS="$2"; shift 2 ;;
    --ws) WS="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --list) LIST=1; shift ;;
    --negative-control) NEGATIVE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ── --list: print the derived set + N (AC1's "N 由实测分布决定，非拍数" — reproducible) ──
if [ "${LIST}" -eq 1 ]; then
  echo "deliver-verify-usage: verified set (N=$((${#VERIFY_SET[@]})), derived = core-named ∩ offline-runnable ∪ capability-catalog.sh):"
  for entry in "${VERIFY_SET[@]}"; do
    IFS='|' read -r id kind rel args <<< "${entry}"
    printf '  %-30s %-3s %s %s\n' "${id}" "${kind}" "${rel}" "${args}"
  done
  exit 0
fi

# ── validation ────────────────────────────────────────────────────────────────────
if [ -z "${PLUGIN_SCRIPTS}" ] || [ -z "${WS}" ]; then
  echo "deliver-verify-usage: --plugin-scripts and --ws are required" >&2
  exit 2
fi
if [ ! -d "${PLUGIN_SCRIPTS}" ]; then
  echo "deliver-verify-usage: plugin-scripts dir not found: ${PLUGIN_SCRIPTS}" >&2
  exit 2
fi
if [ ! -d "${WS}/tasks" ]; then
  echo "deliver-verify-usage: workspace has no tasks/ dir: ${WS}" >&2
  exit 2
fi
# Bounded runner: prefer coreutils `timeout`; fall back to a background+kill loop so the script does
# not hard-depend on a particular coreutils version being present on the target (B/C VPS).
run_bounded() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "${secs}" "$@"
  else
    "$@" &
    local pid=$!
    ( sleep "${secs}"; kill -9 "${pid}" 2>/dev/null ) &
    local killer=$!
    local rc=0
    if ! wait "${pid}" 2>/dev/null; then
      rc=$?
    fi
    kill "${killer}" 2>/dev/null || true
    wait "${killer}" 2>/dev/null || true
    return "${rc}"
  fi
}

# ── negative control mode ─────────────────────────────────────────────────────────
# Prove the verification can take false: copy plugin-scripts, delete one verified file, and
# assert the verification FAILS against the copy. Operates on a COPY so the real install is intact.
if [ -n "${NEGATIVE}" ]; then
  if [ ! -e "${PLUGIN_SCRIPTS}/${NEGATIVE}" ]; then
    echo "deliver-verify-usage: negative-control file not in plugin-scripts: ${NEGATIVE}" >&2
    exit 2
  fi
  nc_dir="$(mktemp -d)"
  trap 'rm -rf "${nc_dir}"' EXIT
  cp -R "${PLUGIN_SCRIPTS}/." "${nc_dir}/"
  rm -f "${nc_dir}/${NEGATIVE}"
  if bash "$0" --plugin-scripts "${nc_dir}" --ws "${WS}" --timeout "${TIMEOUT}" >/tmp/deliver-verify-nc.out 2>&1; then
    echo "deliver-verify-usage: NEGATIVE CONTROL BROKEN — verification PASSED after deleting ${NEGATIVE}" >&2
    echo "  (the check is not able to take false — 硬规则③/④ shape)" >&2
    sed 's/^/  /' /tmp/deliver-verify-nc.out >&2
    exit 1
  fi
  echo "deliver-verify-usage: NEGATIVE CONTROL HOLDS — deleting ${NEGATIVE} made verification fail"
  exit 0
fi

# ── run the verification ──────────────────────────────────────────────────────────
failures=0
checked=0
for entry in "${VERIFY_SET[@]}"; do
  IFS='|' read -r id kind rel args <<< "${entry}"
  path="${PLUGIN_SCRIPTS}/${rel}"
  if [ ! -f "${path}" ]; then
    echo "FAIL  ${id}: missing ${rel}" >&2
    failures=$((failures + 1))
    continue
  fi
  args="${args//@WS@/${WS}}"
  out=""
  code=0
  if [ "${kind}" = "sh" ]; then
    if ! out="$(run_bounded "${TIMEOUT}" bash "${path}" ${args} 2>&1)"; then
      code=$?
    fi
  elif [ "${kind}" = "js" ]; then
    if ! out="$(run_bounded "${TIMEOUT}" node "${path}" ${args} 2>&1)"; then
      code=$?
    fi
  else
    echo "FAIL  ${id}: unknown kind ${kind}" >&2
    failures=$((failures + 1))
    continue
  fi
  # non-empty output (filter Node's harmless ESM typeless warnings — they are not output)
  nbytes="$(printf '%s\n' "${out}" | grep -vcE 'MODULE_TYPELESS|Reparsing as ES module|trace-warnings|To eliminate this warning' || true)"
  if [ "${code}" -ne 0 ] || [ "${nbytes}" -eq 0 ]; then
    echo "FAIL  ${id} (exit=${code} lines=${nbytes})" >&2
    printf '%s\n' "${out}" | grep -vE 'MODULE_TYPELESS|Reparsing as ES module|trace-warnings|To eliminate this warning' | head -4 | sed 's/^/    /' >&2
    failures=$((failures + 1))
  else
    echo "PASS  ${id} (exit=${code} lines=${nbytes})"
  fi
  checked=$((checked + 1))
done

echo "deliver-verify-usage: ${checked} mechanisms checked, ${failures} failed (N=${#VERIFY_SET[@]})"
[ "${failures}" -eq 0 ]
