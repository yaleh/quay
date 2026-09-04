#!/usr/bin/env bash
# Mutation case for manager-observation-runtime-check (gap-c3-has-no-runtime-constraint AC2/AC3 —
# C3 RUNTIME constraint: the outer must never observe/check the manager; the doc-layer check only
# covers the tick DOCS, this checker scans the outer session TRANSCRIPT). The checker's ## Contract
# control: "负控制：指向 inner 的 capture-pane 不计数；manager→outer 的发布不计数" and the AC2
# positive (capture-pane of the manager window MUST be detected). Fixture: a clean outer transcript
# (inner observation + manager→outer publish only) → GREEN. Inject: a capture-pane of the manager
# window → the checker MUST go RED. Restore: revert → back to GREEN.
set -u
name="manager-observation-runtime-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
transcript="${workdir}/outer.jsonl"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/manager-observation-runtime-check.ts" --transcript "${transcript}" --json >/dev/null 2>&1
}

# A minimal Claude Code JSONL tool_use record helper.
rec() { # $1 = tool name, $2 = json input
  printf '{"type":"assistant","timestamp":"2026-08-08T06:00:00.000Z","session_id":"outer-1111","message":{"role":"assistant","content":[{"type":"tool_use","id":"c1","name":"%s","input":%s}]}}\n' "$1" "$2"
}

# GREEN baseline: inner observation + manager→outer publish only → exit 0.
{
  rec "Bash" '{"command":"tmux capture-pane -p -t quay-0:inner > .quay/last-pane.txt"}'
  rec "Bash" '{"command":"bash plugin/scripts/supervisor-bus-identity.sh inbox-summary"}'
} > "${transcript}"
if checker_cmd; then :; else
  echo "baseline RED on a clean transcript (inner observation + manager→outer publish only — checker always-red?)" >&2
  exit 4
fi

# INJECT the incident shape: a capture-pane of the manager window → MUST go RED.
rec "Bash" '{"command":"tmux capture-pane -p -t quay-0:manager > /tmp/mgr.txt"}' >> "${transcript}"
if checker_cmd; then
  echo "STAYED-GREEN — a capture-pane of the manager window did not redden the runtime checker" >&2
  exit 3
fi

# RESTORE: revert to the clean baseline → back to GREEN (the violation → 0 direction).
{
  rec "Bash" '{"command":"tmux capture-pane -p -t quay-0:inner > .quay/last-pane.txt"}'
  rec "Bash" '{"command":"bash plugin/scripts/supervisor-bus-identity.sh inbox-summary"}'
} > "${transcript}"
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored clean transcript still reddens the runtime checker" >&2
  exit 4
fi

exit 0
