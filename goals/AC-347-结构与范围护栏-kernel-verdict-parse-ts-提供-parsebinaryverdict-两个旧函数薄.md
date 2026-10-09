---
id: AC-347
title: 结构与范围护栏：kernel/verdict-parse.ts 提供
  parseBinaryVerdict，两个旧函数薄包装、调用方零改动，routine-quota 文件未被触碰
status: active
kind: criterion
goal: GOAL-032
criterion: >-
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  f="packages/quay/src/kernel/verdict-parse.ts"

  [ -f "$f" ] || { echo "NOT-EVALUATED: $f not found" >&2; exit 3; }

  grep -q "export function parseBinaryVerdict" "$f" || { echo
  "CAUSE=no-canonical-function — kernel verdict-parse.ts missing
  parseBinaryVerdict export" >&2; exit 1; }

  grep -nE "^import" "$f" | grep -vE 'from ["'"'"']\./|from ["'"'"']node:' && {
  echo "CAUSE=kernel-boundary-violation — verdict-parse.ts imports outside
  kernel/bare specifiers" >&2; exit 1; }

  fid="packages/quay/src/criterion-fidelity.ts"

  gd="plugin/scripts/goal-driver.ts"

  grep -q "parseBinaryVerdict" "$fid" || { echo "CAUSE=fidelity-not-delegated —
  criterion-fidelity.ts does not call parseBinaryVerdict" >&2; exit 1; }

  grep -q "parseBinaryVerdict" "$gd" || { echo "CAUSE=sufficiency-not-delegated
  — goal-driver.ts does not call parseBinaryVerdict" >&2; exit 1; }

  grep -q "export function parseFidelityVerdict" "$fid" || { echo
  "CAUSE=fidelity-signature-removed — parseFidelityVerdict must still exist as a
  thin wrapper, not be deleted" >&2; exit 1; }

  grep -q "export function parseSemanticSufficiencyVerdict" "$gd" || { echo
  "CAUSE=sufficiency-signature-removed — parseSemanticSufficiencyVerdict must
  still exist" >&2; exit 1; }

  grep -q "parseFidelityVerdict(res.stdout, res.exitCode)" "$fid" || { echo
  "CAUSE=fidelity-caller-changed — criterionFidelityVerdict's call site must be
  unchanged" >&2; exit 1; }

  grep -q "parseSemanticSufficiencyVerdict(r.stdout, r.status)" "$gd" || { echo
  "CAUSE=sufficiency-caller-changed — sampleSemanticSufficiency's call site must
  be unchanged" >&2; exit 1; }

  for bad in plugin/scripts/drivers.yml plugin/scripts/driver-config.ts
  plugin/scripts/routine-file-gate.ts plugin/scripts/probe-routine.ts; do
    [ -n "$(git diff develop -- "$bad" 2>/dev/null)" ] && { echo "CAUSE=touched-routine-quota-file — $bad is out of scope for this goal" >&2; exit 1; }
  done

  echo "PASS: kernel/verdict-parse.ts exports parseBinaryVerdict; both old
  functions delegate to it, keep their own signatures and call sites unchanged;
  routine-quota files untouched"
expect: exit 0 = kernel 正本落地且两处均真正委托、调用方签名/调用点不变、无越界；exit 1 = CAUSE=
  指明具体哪一条；exit 3 = 文件缺失
origin: GOAL-032 结构护栏，见 goal body「范围与非目标」
activatedAt: 2026-10-09T01:55:06.628Z
statusLog:
  - at: 2026-10-09T01:55:06.628Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-09T01:55:06.628Z
---
