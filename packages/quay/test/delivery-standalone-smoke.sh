#!/usr/bin/env bash
# delivery-standalone-smoke.sh — the executable conformance gate for ADR-013 (delivery boundary).
#
# Simulates DELIVERY of the product as npm would ship it (each package's `files` whitelist honored,
# only DECLARED deps installed — NOT sibling workspace packages) into a fresh workspace that has NO
# `experiments/` dir, then reports every point where the delivered product still reaches into the
# experiment or a sibling package by file path. Each such point is a delivery blocker (RED).
#
# This gate is RED BY DESIGN until the ADR-013 separation lands; its job is to turn every coupling
# point into a failing line (an executable backlog), then go GREEN when the product truly stands
# alone. On-demand diagnostic — deliberately NOT in the default `node --test test/*.mjs` glob (a `.sh`,
# and `test/` is outside the `files` whitelist so it never ships), so it does not break the loop's
# green test baseline while it is red.
#
# Usage:  bash packages/quay/test/delivery-standalone-smoke.sh
# Exit:   number of RED delivery blockers (0 = product stands alone).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"     # packages/quay/test -> repo root
S="$(mktemp -d)"; trap 'rm -rf "$S"' EXIT
RED=0
red(){ echo "  ❌ RED: $*"; RED=$((RED+1)); }
grn(){ echo "  ✅ $*"; }

echo "=== pack the product as npm would deliver it (files whitelist honored) ==="
( cd "$ROOT" && npm pack -w packages/quay --pack-destination "$S" >/dev/null 2>&1 ) && grn "quay packed" || { red "npm pack quay failed"; echo "SMOKE VERDICT: $RED RED"; exit $RED; }
mkdir -p "$S/deliver/quay"
tar -xzf "$S"/quay-*.tgz -C "$S/deliver/quay" --strip-components=1 2>/dev/null
( cd "$S/deliver/quay" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 ) && grn "declared deps installed" || echo "  (dep install noise ignored)"

echo
echo "=== 1) STATIC: delivered files must not reference the experiment ==="
if grep -rnE 'experiments/quay-perpetual-stream|exp5|quay-perpetual-stream' "$S/deliver/quay/src" "$S/deliver/quay/bin" >"$S/exp.txt" 2>/dev/null; then
  red "$(wc -l <"$S/exp.txt") delivered line(s) reference the exp5 experiment:"; sed 's/^/       /' "$S/exp.txt" | head -8
else grn "no experiment references in delivered files"; fi

echo
echo "=== 2) STATIC: delivered files must not import sibling packages by relative path ==="
if grep -rnE '\.\./\.\./\.\./quay-(native|github)|\.\./\.\./quay-(native|github)' "$S/deliver/quay/src" "$S/deliver/quay/bin" >"$S/xp.txt" 2>/dev/null; then
  red "$(wc -l <"$S/xp.txt") cross-package relative import(s) that won't resolve when delivered (use the Provider ABI, not a file path):"; sed 's/^/       /' "$S/xp.txt"
else grn "no cross-package relative imports"; fi

echo
echo "=== 3) RUNTIME: the CLI must load standalone (fresh workspace, no experiments/, no sibling pkgs) ==="
WS="$S/ws"; mkdir -p "$WS/.quay" "$WS/tasks"
Q="node $S/deliver/quay/bin/quay.js"
if ( cd "$WS" && timeout 25 $Q --help ) >"$S/help.txt" 2>&1; then grn "CLI --help loads standalone"; else
  red "CLI fails to load standalone:"; sed 's/^/       /' "$S/help.txt" | grep -iE 'error|cannot find|ERR_' | head -3; fi

echo
echo "=== 4) RUNTIME: the gate engine must load standalone ==="
if ( cd "$WS" && timeout 25 $Q gate --list ) >"$S/gate.txt" 2>&1; then grn "gate --list ran standalone"; else
  red "gate --list fails standalone:"; sed 's/^/       /' "$S/gate.txt" | grep -iE 'error|cannot find|ERR_' | head -3; fi

echo
echo "=== 5) DELIVERY: built-in gate enforcement scripts must be in the delivered artifact ==="
miss=0
for p in it0-impl-row-check it0-ceiling-line-budget-check vmeta-lag-check audit-independence-check it0-dogfood-evidence-gate; do
  grep -q "$p" "$S/deliver/quay/src/gate/registry.js" 2>/dev/null && \
    ! find "$S/deliver/quay" -name "$p.sh" | grep -q . && miss=$((miss+1))
done
[ "$miss" -gt 0 ] && red "$miss/5 built-in gate enforcement script(s) referenced by registry.js are NOT delivered (they live in experiments/ — gate set must be data-driven, not hardcoded experiment paths)" || grn "no undelivered gate scripts"

echo
echo "=================== SMOKE VERDICT: $RED RED (delivery blocker$([ "$RED" -ne 1 ] && echo s)) ==================="
exit "$RED"
