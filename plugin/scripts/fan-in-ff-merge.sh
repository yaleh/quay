#!/usr/bin/env bash
# fan-in-ff-merge.sh — AC62 持锁段: a merge lock that wraps ONLY `git merge --ff-only task/<id>`.
# (tasks/gap-ac62-fan-in-ff-merge-lock-protocol, SPEC-fan-in-ff-merge-lock-2026-08-14)
#
# The fan-in protocol is split into a 无锁段 and a 持锁段:
#   无锁段 (the CALLER, all inside its own task worktree — NOT this script, no lock):
#     1. git merge develop            ← 【必须 merge，不得 rebase】(人 2026-08-14 07:0xZ 裁定, AC75).
#                                        conflicts can ONLY appear here; resolve slowly, blocks nobody
#     2. delta 断言面判定 (AC75)      ← merge 进来的 develop delta 触及代码/测试/脚本断言面 ⇒ 重跑全量;
#                                        delta 全落 doc/任务体/telemetry 面 ⇒ 不重跑（只跑 doc 检查）;
#                                        判不出 ⇒ fail-closed 重跑（硬规则 3b: 判不出≠不需要）
#     3. run the full suite           ← continue only when green (按第 2 步判定)
#     4. run the doc check            ← the ff-only gap: ff triggers no pre-merge hook (AC63)
#   持锁段 (THIS script — the ONLY action allowed while holding the lock):
#     5. acquire merge lock → git merge --ff-only task/<id> → release (success or failure)
#
# The lock is a SEPARATE flock from the suite lock (full-suite.lock.0/.1): different file, different
# object, and — because this script REFUSES to run while the suite state says `running` — never held
# at the same time as a suite run (AC4: 两把锁覆盖范围不得交叉). Hold time is milliseconds (ff-only
# moves a ref; it cannot conflict), so stale-lock recovery is a branch that is almost never reached —
# a short lock that needs no elaborate recovery logic is the point (§2).
#
# On ff failure — the ONLY reason ff fails after step 1 is "develop advanced concurrently" — this
# script appends a RETRY RECORD (task id / attempt # / develop head / timestamp / runId) and exits 1:
# the caller returns to 无锁段 step 1 and re-runs. No needs-human path exists for ff failure (§4:
# ff 失败原因唯一、处置唯一). Anti-livelock is NOT pre-built; the trigger is written as "同一任务
# ff 失败 ≥3 次" and only then is anti-livelock discussed (§7) — the retry record is the data for it.
#
# Lock events (acquire/release) are appended to .quay/fan-in-merge-lock-events.jsonl so the protocol
# checker (fan-in-ff-protocol-check.ts) can verify AC4 (the lock covers ONLY ff, never overlaps a
# suite run) and 判据2b (a suite call inside the locked section ⇒ red).
#
# AC67 (gap-ac67-fan-in-executor-to-task-subagent): the caller's AGENT IDENTITY is recorded in BOTH
# the lock events and the retry record — `--agent-id <id>` (the calling subagent's own identifier).
# The executor check (fan-in-ff-executor-check.ts) judges 判据2 = agentId ≠ inner 主会话: a record
# with a missing/`null` agentId (the script called without --agent-id, i.e. the inner MAIN THREAD
# doing the fan-in) or agentId == the main-session id is the old main-thread-executor form ⇒ red.
# --agent-id is OPTIONAL for backward compat with pre-AC67 callers; when absent the fields are null
# (which is exactly the absence the checker flags — the field is only "real" when the subagent sets it).
#
# Usage:
#   fan-in-ff-merge.sh --task <taskId> [--root <repo>] [--merge-target <branch>] [--run-id <runId>]
#                      [--agent-id <caller-agent-id>] [--suite-state <file>] [--lock-events <file>]
#                      [--retry-record <file>] [--lock-wait <secs>] [--help]
#
# Exit codes:
#   0  ff performed (develop/merge-target fast-forwarded to task/<taskId>)
#   1  ff NOT possible (develop advanced — retry record written; return to 无锁段 step 1)
#   2  usage / environment error (missing task branch, suite running, dirty tree, wrong branch,
#      lock timeout — NOT an ff failure, NO retry record)
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

# ── arg parse ─────────────────────────────────────────────────────────────────────────────────────────
task_id=""
root=""
merge_target=""
run_id=""
agent_id=""
suite_state=""
lock_events=""
retry_record=""
lock_wait=30

while [ "$#" -gt 0 ]; do
  case "$1" in
    --task) task_id="$2"; shift 2 ;;
    --root) root="$2"; shift 2 ;;
    --merge-target) merge_target="$2"; shift 2 ;;
    --run-id) run_id="$2"; shift 2 ;;
    --agent-id) agent_id="$2"; shift 2 ;;
    --suite-state) suite_state="$2"; shift 2 ;;
    --lock-events) lock_events="$2"; shift 2 ;;
    --retry-record) retry_record="$2"; shift 2 ;;
    --lock-wait) lock_wait="$2"; shift 2 ;;
    *) echo "fan-in-ff-merge: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "${task_id}" ] || { echo "fan-in-ff-merge: --task <taskId> is required" >&2; exit 2; }

# ── repo resolution ────────────────────────────────────────────────────────────────────────────────────
if [ -z "${root}" ]; then
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi
if [ ! -d "${root}/.git" ] && [ ! -f "${root}/.git" ]; then
  echo "fan-in-ff-merge: not a git repo: ${root}" >&2
  exit 2
fi

git_common_dir="$(git -C "${root}" rev-parse --git-common-dir 2>/dev/null)" || { echo "fan-in-ff-merge: git rev-parse --git-common-dir failed in ${root}" >&2; exit 2; }
# `git rev-parse --git-common-dir` is RELATIVE to the repo root; normalize to absolute so the lock
# file resolves regardless of the caller's cwd (the script must not depend on where bash started).
case "${git_common_dir}" in
  /*) : ;;
  *) git_common_dir="${root}/${git_common_dir}" ;;
esac
lock_file="${git_common_dir}/fan-in-merge.lock"

# Default artifact paths live under the repo's .quay/ (the same workspace state surface the suite
# lock and full-suite-state use). Overridable so hermetic tests can point at fixture files.
if [ -z "${suite_state}" ]; then suite_state="${root}/.quay/full-suite-state.json"; fi
if [ -z "${lock_events}" ]; then lock_events="${root}/.quay/fan-in-merge-lock-events.jsonl"; fi
if [ -z "${retry_record}" ]; then retry_record="${root}/.quay/fan-in-retries.jsonl"; fi

# ── pre-flight (unlocked; none of these is an ff failure, none writes a retry record) ─────────────────
if ! git -C "${root}" rev-parse --verify --quiet "refs/heads/task/${task_id}" >/dev/null 2>&1; then
  echo "fan-in-ff-merge: task branch task/${task_id} not found in ${root}" >&2
  exit 2
fi

# The merge target: the branch the current checkout sits on (the inner shared checkout on
# $MERGE_TARGET), or the explicit --merge-target. `git merge --ff-only` operates on the current branch,
# so it MUST be the merge target — a mismatch is an environment error, not an ff failure.
if [ -z "${merge_target}" ]; then
  merge_target="$(git -C "${root}" branch --show-current 2>/dev/null || true)"
  if [ -z "${merge_target}" ]; then
    echo "fan-in-ff-merge: cannot determine the current branch (detached HEAD?) in ${root}; pass --merge-target" >&2
    exit 2
  fi
else
  current="$(git -C "${root}" branch --show-current 2>/dev/null || true)"
  if [ "${current}" != "${merge_target}" ]; then
    echo "fan-in-ff-merge: current checkout is on '${current}', not the merge target '${merge_target}' — the ff must run in the checkout that owns the target branch" >&2
    exit 2
  fi
fi

# Clean tree required: an ff that would overwrite uncommitted work is an environment error, not a
# "develop advanced" retry. (The shared checkout is clean at fan-in time; a dirty tree means the
# caller broke the protocol's assumption.)
porcelain="$(git -C "${root}" status --porcelain 2>/dev/null || true)"
if [ -n "${porcelain}" ]; then
  echo "fan-in-ff-merge: working tree not clean in ${root} — the ff must run on a clean checkout (found uncommitted changes):" >&2
  printf '%s\n' "${porcelain}" | sed 's/^/fan-in-ff-merge:   /' >&2
  exit 2
fi

# AC4 / A9 guard (still unlocked): the merge lock must never overlap a suite run. If the suite is
# running, refuse to acquire the lock — the caller waits for the round to end (A9: 轮在跑 ⇒ 不可以
# fan-in), it does NOT hold the merge lock while waiting (that would make the lock cover the wait —
# exactly the lock-order deadlock the SPEC forbids).
if [ -f "${suite_state}" ]; then
  suite_state_val="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('state',''))" "${suite_state}" 2>/dev/null || true)"
  if [ "${suite_state_val}" = "running" ]; then
    echo "fan-in-ff-merge: suite state is 'running' (${suite_state}) — fan-in must wait for the round to end; NOT acquiring the merge lock (AC4: lock must not overlap a suite run)" >&2
    exit 2
  fi
fi

# ── attempt counting (判据3: 第几次) ──────────────────────────────────────────────────────────────────
# The retry record is the anti-livelock data (§7): the attempt number is "how many times THIS task's
# ff has failed already" + 1 (the current failure is the next try). A missing/empty retry file counts
# zero prior failures ⇒ the first failure is attempt 1.
prior_failures="$( { grep -c "\"taskId\":\"${task_id}\"" "${retry_record}" 2>/dev/null || true; } | tail -n1 )"
[ -n "${prior_failures}" ] || prior_failures=0
attempt=$(( prior_failures + 1 ))

# ── the 持锁段: acquire → ff-only → release ───────────────────────────────────────────────────────────
# flock on an open fd: the lock is released automatically when the fd closes (process exit), so a
# crash mid-ff cannot leak it — no stale-lock recovery design needed (§2). --lock-wait bounds the
# wait (default 30s; the hold is milliseconds so a waiter never actually waits this long).
mkdir -p "$(dirname "${lock_events}")" "$(dirname "${retry_record}")" 2>/dev/null || true
lock_fd=9
exec {lock_fd}>"${lock_file}"
if ! flock -x -w "${lock_wait}" "${lock_fd}"; then
  echo "fan-in-ff-merge: could not acquire merge lock ${lock_file} within ${lock_wait}s (another fan-in holds it?)" >&2
  exit 2
fi

now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
now_epoch="$(date +%s)"
# JSON-string-or-null encoding for runId/agentId. The `:+\"...\"${x:-null}` compound is WRONG (it fires
# BOTH branches when the value is non-empty ⇒ the value is emitted twice, corrupting the JSON — a real
# bug caught while wiring --agent-id). Precompute with an explicit if/else so a SET value is ONE quoted
# string and an ABSENT value is `null` (the absence the executor check flags as the main-thread form).
if [ -n "${run_id}" ]; then run_id_json="\"${run_id}\""; else run_id_json="null"; fi
if [ -n "${agent_id}" ]; then agent_id_json="\"${agent_id}\""; else agent_id_json="null"; fi
# Lock-hold event (acquire) — the checker reads these to verify the lock covers ONLY the ff.
printf '%s\n' "{\"event\":\"acquire\",\"ts\":\"${now_iso}\",\"epoch\":${now_epoch},\"taskId\":\"${task_id}\",\"pid\":$$,\"runId\":${run_id_json},\"agentId\":${agent_id_json}}" >> "${lock_events}"

merge_rc=0
merge_err=""
develop_head_before="$(git -C "${root}" rev-parse "${merge_target}" 2>/dev/null || echo "unresolvable")"
# The ONLY action allowed inside the lock. `--ff-only` can never create a merge commit or a conflict:
# it either fast-forwards the ref or refuses (develop advanced since step 1's merge develop).
if ! merge_out="$(git -C "${root}" merge --ff-only "task/${task_id}" 2>&1)"; then
  merge_rc=1
  merge_err="$(printf '%s\n' "${merge_out}" | head -n1)"
fi

now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
now_epoch="$(date +%s)"
printf '%s\n' "{\"event\":\"release\",\"ts\":\"${now_iso}\",\"epoch\":${now_epoch},\"taskId\":\"${task_id}\",\"pid\":$$,\"runId\":${run_id_json},\"agentId\":${agent_id_json}}" >> "${lock_events}"

# Release the lock explicitly. NOTE: do NOT `exec {lock_fd}>&-` here — bash mis-handles `{var}>&-`
# (an fd-ALLOCATING close) after a prior `$(...)` command substitution re-used fd numbers and would
# exit the script; the lock is released by flock -u and the fd auto-closes on process exit anyway
# (the auto-release on exit is the "stale-lock recovery is almost never reached" property, §2).
flock -u "${lock_fd}" 2>/dev/null || true

if [ "${merge_rc}" -ne 0 ]; then
  # 判据3: ff failure writes the retry record. develop_head = the head at failure time (the caller's
  # step-1 re-run merges THIS develop). attempt = prior failures for this task + 1.
  develop_head_now="$(git -C "${root}" rev-parse "${merge_target}" 2>/dev/null || echo "unresolvable")"
  printf '%s\n' "{\"taskId\":\"${task_id}\",\"attempt\":${attempt},\"developHead\":\"${develop_head_now}\",\"ts\":\"${now_iso}\",\"epoch\":${now_epoch},\"runId\":${run_id_json},\"agentId\":${agent_id_json},\"mergeTarget\":\"${merge_target}\",\"error\":\"$(printf '%s' "${merge_err}" | sed 's/"/\\"/g')\"}" >> "${retry_record}"
  echo "fan-in-ff-merge: FF FAILED — ${merge_err:-develop advanced}; not a fast-forward. Retry record written (attempt ${attempt}). Return to 无锁段 step 1 (merge develop again — 必须 merge 不得 rebase, AC75), re-judge the delta (step 2) and re-run." >&2
  echo "fan-in-ff-merge: measure ff_only_locked=false" >&2
  exit 1
fi

# POST-state: the merge target must now be at the task tip (ff is idempotent — a concurrent ff of the
# same task would land the same tip; the lock serializes writers, so this is a sanity check).
post_head="$(git -C "${root}" rev-parse "${merge_target}" 2>/dev/null || echo "unresolvable")"
task_tip="$(git -C "${root}" rev-parse "refs/heads/task/${task_id}" 2>/dev/null || echo "unresolvable")"
if [ "${post_head}" != "${task_tip}" ]; then
  echo "fan-in-ff-merge: post-check FAILED — ${merge_target} is at ${post_head}, expected task tip ${task_tip}; needs human" >&2
  exit 1
fi
echo "fan-in-ff-merge: OK — ${merge_target} fast-forwarded to task/${task_id} (${post_head}) [before ${develop_head_before}]${run_id:+ (runId: ${run_id})}"
echo "fan-in-ff-merge: measure ff_only_locked=true"
exit 0
