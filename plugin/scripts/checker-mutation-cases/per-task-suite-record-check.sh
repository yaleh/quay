#!/usr/bin/env bash
# Mutation case for per-task-suite-record-check (AC72 判据2 — every per-task suite record must carry
# the full required shape; a malformed/partial record ⇒ RED, the 硬规则 3b form where 读不懂 input
# must never return the same value as 合格).
# Fixture: a temp record file with ONE well-formed per-task suite record → GREEN.
# Inject: DELETE a required field (runId) from the record (still valid JSON, but a partial record —
# the exact "a partial record would look like 'the mechanism recorded this run' while hiding what
# actually happened" shape) → the checker MUST go RED. Restore → back to GREEN.
set -u
name="per-task-suite-record-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}"

write_record() { # <json...>
  printf '%s\n' "$1" > "${workdir}/records.jsonl"
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/per-task-suite-record-check.ts" \
    --root "$1" --record-file "${workdir}/records.jsonl" >/dev/null 2>&1
}

# GREEN baseline: one well-formed record (all REQUIRED_FIELDS present and typed) → exit 0.
write_record '{"taskId":"gap-mutation","runId":"r1","state":"green","laneCount":1,"durationMs":100,"startedAt":"2026-08-14T00:00:00Z","finishedAt":"2026-08-14T00:01:00Z"}'
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a well-formed per-task suite record (checker always-red?)" >&2
  exit 4
fi

# INJECT: drop the required runId field — still parseable JSON, but a partial record → 判据2 RED.
write_record '{"taskId":"gap-mutation","state":"green","laneCount":1,"durationMs":100,"startedAt":"2026-08-14T00:00:00Z","finishedAt":"2026-08-14T00:01:00Z"}'
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a partial record (missing runId) did not redden the checker" >&2
  exit 3
fi

# RESTORE: rewrite the well-formed record → back to GREEN.
write_record '{"taskId":"gap-mutation","runId":"r1","state":"green","laneCount":1,"durationMs":100,"startedAt":"2026-08-14T00:00:00Z","finishedAt":"2026-08-14T00:01:00Z"}'
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored well-formed record still reddens the checker" >&2
  exit 4
fi

exit 0
