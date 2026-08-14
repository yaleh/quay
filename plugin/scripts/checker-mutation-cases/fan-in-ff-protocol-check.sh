#!/usr/bin/env bash
# Mutation case for fan-in-ff-protocol-check (AC62 判据1/判据2/判据3 — the AC66 判据1 hold-duration
# product). Fixture: a lock-events file whose holds are millisecond-scale (ff-only) → GREEN.
# Inject: a lock-hold interval LONGER than the ff bound (300s — something OTHER than the ff
# happened inside the lock) → the checker MUST go RED (AC62 判据1: 持锁期间唯一动作=ff).
# Restore: back to ms-scale holds → GREEN. The --lock-events / --suite-state seams keep the
# fixture hermetic (no real repo needed for the hold-duration verdict).
set -u
name="fan-in-ff-protocol-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/fan-in-ff-protocol-check.ts" \
    --lock-events "${workdir}/lock-events.jsonl" --max-hold-seconds 60 >/dev/null 2>&1
}

# GREEN baseline: ms-scale holds (ff-only) → exit 0.
printf '%s\n' \
  '{"event":"acquire","ts":"2026-08-14T03:10:00Z","epoch":100,"taskId":"t1","pid":1}' \
  '{"event":"release","ts":"2026-08-14T03:10:00Z","epoch":100,"taskId":"t1","pid":1}' \
  > "${workdir}/lock-events.jsonl"
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on ms-scale lock holds (checker always-red?)" >&2
  exit 4
fi

# INJECT: a 300s hold — the lock covered something OTHER than the ff → MUST go RED.
printf '%s\n' \
  '{"event":"acquire","ts":"2026-08-14T03:10:00Z","epoch":100,"taskId":"t1","pid":1}' \
  '{"event":"release","ts":"2026-08-14T03:15:00Z","epoch":400,"taskId":"t1","pid":1}' \
  > "${workdir}/lock-events.jsonl"
if checker_cmd "${workdir}"; then
  echo "mutation NOT caught: a 300s lock-hold stayed GREEN (AC62 判据1 '唯一动作=ff' not enforced)" >&2
  exit 1
fi

# RESTORE: back to ms-scale holds → GREEN again.
printf '%s\n' \
  '{"event":"acquire","ts":"2026-08-14T03:10:00Z","epoch":100,"taskId":"t1","pid":1}' \
  '{"event":"release","ts":"2026-08-14T03:10:00Z","epoch":100,"taskId":"t1","pid":1}' \
  > "${workdir}/lock-events.jsonl"
if checker_cmd "${workdir}"; then
  echo "fan-in-ff-protocol-check mutation case: PASS (long lock-hold caught, ms-scale restored)" >&2
else
  echo "RESTORE still RED after removing the mutation (checker stuck red?)" >&2
  exit 4
fi
exit 0
