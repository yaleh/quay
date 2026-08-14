#!/usr/bin/env bash
# Mutation case for fan-in-workflow-check (AC78 判据2: every fan-in after the workflow landed MUST
# have gone through the fan-in-execute workflow — a Workflow tool_use call record).
# Fixture: a temp repo with ONE fan-in acquire event whose agentId resolves to a REAL subagent
# (subagents/agent-<id>.jsonl) AND a Workflow(fan-in-execute) call transcript → GREEN ((a) coverage
# + (c) agentId both green). Inject: DELETE the Workflow call transcript → the fan-in is now a
# post-boundary fan-in with NO Workflow call → (a) MUST go RED. Restore → back to GREEN.
set -u
name="fan-in-workflow-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/subagents" "${workdir}/.workflow-events"

agent_id="aab2d14d10a762ff4"
task_id="gap-mutation-task"
boundary_ts="2026-08-14T00:00:00Z"

# A real subagent transcript so 判据2(c) classifies the agentId as subagent (GREEN).
touch "${workdir}/subagents/agent-${agent_id}.jsonl"

# The one post-boundary fan-in acquire event (epoch far in the future ⇒ after the boundary).
printf '%s\n' "{\"event\":\"acquire\",\"taskId\":\"${task_id}\",\"epoch\":2000000000,\"runId\":\"fm-${task_id}-2000000000-r1\",\"agentId\":\"${agent_id}\"}" > "${workdir}/lock.jsonl"

write_workflow_call() {
  printf '%s\n' "{\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Workflow\",\"input\":{\"scriptPath\":\"/q/.claude/workflows/fan-in-execute.js\",\"args\":\"{\\\"task\\\":\\\"${task_id}\\\"}\"}}]}}" > "${workdir}/session-top.jsonl"
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/fan-in-workflow-check.ts" \
    --root "$1" \
    --lock-events "${workdir}/lock.jsonl" \
    --project-dir "${workdir}" \
    --workflow-events-dir "${workdir}/.workflow-events" \
    --dispatch-record "${workdir}/dispatch-record.jsonl" \
    --workflow-landed-ts "${boundary_ts}" \
    >/dev/null 2>&1
}

# GREEN baseline: Workflow call present → 判据2(a) coverage satisfied; agentId is a real subagent →
# 判据2(c) satisfied → exit 0.
write_workflow_call
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a fan-in WITH a Workflow call (checker always-red?)" >&2
  exit 4
fi

# INJECT: delete the Workflow call transcript → the post-boundary fan-in has NO Workflow call → 判据2(a)
# MUST go RED (the exact AC78 disease: a fan-in that did NOT go through the workflow).
rm -f "${workdir}/session-top.jsonl"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — removed Workflow call did not redden the checker (fan-in without workflow slips through)" >&2
  exit 3
fi

# RESTORE: re-create the Workflow call transcript → back to GREEN.
write_workflow_call
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored Workflow call still reddens the checker" >&2
  exit 4
fi

exit 0
