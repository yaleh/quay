#!/usr/bin/env bash
# Mutation case for gate-event-coverage-check
# (tasks/gap-complete-gateevent-coverage-has-a-residual-gap, AC4).
#
# The defect shape the checker exists to catch: a landing that left NO `complete` GateEvent in
# `.quay/gate-events.jsonl` — the completion denominator silently under-counts and looks exactly
# like "fewer tasks finished that day".
#   baseline  a landing WITH its complete event   → GREEN (exit 0)
#   INJECT    remove that event from the carrier  → the checker MUST go RED and name the task
#   restore   put it back                         → GREEN again
# The fixture is a REAL temp git repo (the checker reads `git log` + the carrier — ⛔ nothing mocked;
# a case that fed it synthetic data would prove "can produce a reading", not "reads production").
set -u
name="gate-event-coverage-check"
workdir="${1:?usage: $name.sh <workdir>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # plugin/scripts
fixture="${workdir}/${name}-repo"

rm -rf "${fixture}"
mkdir -p "${fixture}/tasks" "${fixture}/.quay"
git -C "${fixture}" init -q -b develop
git -C "${fixture}" config user.email "mutation@example.com"
git -C "${fixture}" config user.name "mutation"

# Commits dated 2 days ago: inside the checker's default window (last N complete days, excluding today)
# regardless of when this case runs.
stamp="$(date -u -d '2 days ago' +%Y-%m-%d)T10:00:00Z"
EVENT_TS="$(date -u -d '2 days ago' +%Y-%m-%d)T10:05:00Z"

mk_task() { printf -- '---\nid: %s\nstatus: %s\n---\n\n## AC\n\n- [x] done\n' "$1" "$2" > "${fixture}/tasks/$1.md"; }
ct() { git -C "${fixture}" add -A; GIT_AUTHOR_DATE="${2:-$stamp}" GIT_COMMITTER_DATE="${2:-$stamp}" git -C "${fixture}" commit -q -m "$1"; }
# t-mut2 的落地必须**晚于** cutoff（EVENT_TS）—— 否则它落进 bootstrap 豁免，这条负控制就变成恒绿
# （实测踩到过：全部提交共用同一时刻 ⇒ 第二向报 STAYED-GREEN）。
late="$(date -u -d '2 days ago' +%Y-%m-%d)T10:30:00Z"
mk_event() { printf '{"id":"e-%s","item_id":"%s","pipeline_id":"%s","gate":"complete","actor":"quay-driver","verdict":"pass","timestamp":"%s","payload":{"from":"ready","to":"done"}}\n' "$1" "$1" "$1" "${EVENT_TS}" >> "${fixture}/.quay/gate-events.jsonl"; }

checker() { node --no-warnings --experimental-strip-types "${script_dir}/gate-event-coverage-check.ts" --root "${fixture}" --merge-target develop --gate >/dev/null 2>&1; }

mk_task t-mut ready; ct seed
mk_task t-mut done;  ct "tasks: 翻 t-mut done（driver 机械 fan-in）"
mk_event t-mut

# BASELINE: 落地 + 事件都在 ⇒ GREEN。一个恒红的检查器过不了这一关。
if checker; then :; else
  echo "baseline RED — landing with its complete event did not pass (checker always-red?)" >&2
  exit 4
fi

# INJECT: 抹掉载体里的 complete 事件（这正是「落地漏写事件」的缺陷形态）⇒ MUST go RED。
: > "${fixture}/.quay/gate-events.jsonl"
if checker; then
  echo "STAYED-GREEN — a landing with no complete GateEvent did not redden the checker" >&2
  exit 3
fi

# RESTORE: 事件写回 ⇒ 回到 GREEN（排除「一旦红就永远红」的假阳性）。
mk_event t-mut
if checker; then :; else
  echo "ALWAYS-RED — restored carrier still reddens the checker" >&2
  exit 4
fi

# 第二向（bootstrap 豁免不得吞掉真缺口）：cutoff 已由上面那条 quay-driver 事件建立；再加一个
# **晚于** cutoff 且无事件的落地 ⇒ 仍必须 RED（证明豁免是窄的，不是「无事件一律放过」）。
mk_task t-mut2 ready; ct seed2 "${late}"
mk_task t-mut2 done;  ct "tasks: 翻 t-mut2 done（AC78 fan-in-execute workflow）" "${late}"
if checker; then
  echo "STAYED-GREEN — a post-cutoff uncovered landing was swallowed by the bootstrap exemption" >&2
  exit 3
fi

exit 0
