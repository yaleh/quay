#!/usr/bin/env bash
# fan-in-ff-merge.sh — AC62 持锁段: a merge lock that wraps ONLY the ff. DUAL-MODE
# (gap-fan-in-ff-ref-update-detach-develop):
#   merge mode (merge target still checked out)  → `git merge --ff-only task/<id>` (operates on the
#                                                   current branch ⇒ clean tree still required).
#   push mode  (merge target detached)           → `git push . refs/heads/task/<id>:refs/heads/<merge-
#                                                   target>` (a pure ref update — no working tree
#                                                   touched, dirty tree structurally irrelevant).
# The mode is auto-selected by which branch the main checkout sits on.
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
#   持锁段 (THIS script — the lock covers the ff; on an inert develop increment it also covers the
#            in-lock develop re-merge + immediate re-ff, gap-fan-in-ff-retry-reruns-suite-on-inert-increment):
#     5. acquire merge lock → ff (merge --ff-only OR git push . per ff_mode) → release
#
# The lock is a SEPARATE flock from the suite lock (full-suite.lock.0/.1): different file, different
# object, and — because this script REFUSES to run while a full suite is RUNNING (AC84 — probed via
# the single-flight suite-lock slots themselves, the DIRECT "a suite is running" signal; the old
# full-suite-state.json proxy is RETIRED: it has no writer after AC84, see the in-body note) — never
# held at the same time as a suite run (AC4: 两把锁覆盖范围不得交叉). Hold time is milliseconds
# (ff-only moves a ref; it cannot conflict), so stale-lock recovery is a branch that is almost never
# reached — a short lock that needs no elaborate recovery logic is the point (§2).
#
# On ff failure — the ONLY reason ff fails after step 1 is "develop advanced concurrently". Before
# writing a retry record, this script classifies the develop increment (gap-fan-in-ff-retry-reruns-
# suite-on-inert-increment, AC1/AC2): the increment = `git diff --name-only suite_head...develop_tip`
# (the commits develop gained since suite_head), judged INERT by the computed classifier
# (`--classify-delta`, reads scripts/test.sh @static-object; no hand-written path table, AC4). An
# INERT increment (tasks/*.md / doc / telemetry) does NOT invalidate the already-green suite ⇒ the
# script, while STILL HOLDING the lock, merges develop into the task branch (in the worktree) and
# immediately re-runs the ff — milliseconds, no phase-1 full-suite re-run, no retry record. A
# NON-inert increment (touches code) or an unjudgeable one (fail-closed) keeps the status quo: this
# script appends a RETRY RECORD (task id / attempt # / develop head / timestamp / runId) and exits 1:
# the caller returns to 无锁段 step 1 and re-runs. No needs-human path exists for ff failure (§4:
# ff 失败原因唯一、处置唯一). Anti-livelock (SPEC §7, gap-ff-livelock-trigger-no-action): the retry
# record IS the anti-livelock data — the trigger is "同一任务 ff 失败 ≥3 次". When THIS failure is
# the same task's attempt >= 3, the script does NOT return the plain retry (exit 1): it escalates —
# writes a DISTINCT escalation record, prints the anti-livelock action, and exits 3. The no-auto-
# retry guard is the attempt count itself: once a task reaches >= 3, every later invocation
# escalates (exit 3), never exit 1.
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
# AC78 (判据2(c)): --agent-id is now FAIL-CLOSED self-validated —
# if it resolves to a TOP-LEVEL session id (a `<project>/<id>.jsonl` or `<project>/<id>/` exists),
# the ff is being executed by the MAIN SESSION (AC72/AC73's defect) ⇒ exit 2 before any lock event /
# retry record is written. The fan-in must be executed by a subagent, whose own id resolves to
# `subagents/agent-<id>.jsonl` (AC67's correct form).
#
# Usage:
#   fan-in-ff-merge.sh --task <taskId> [--root <repo>] [--merge-target <branch>] [--run-id <runId>]
#                      [--agent-id <caller-agent-id>] [--suite-capture <file>] [--lock-events <file>]
#                      [--retry-record <file>] [--escalations <file>] [--lock-wait <secs>]
#                      [--worktree <path>] [--help]
#
# Exit codes:
#   0  ff performed (develop/merge-target fast-forwarded to task/<taskId>)
#   1  ff NOT possible (develop advanced — retry record written; return to 无锁段 step 1).
#      Only for attempts 1-2. This is the "develop advanced, retry" path.
#   2  usage / environment error (missing task branch, suite running, merge target still checked out,
#      lock timeout — NOT an ff failure, NO retry record)
#   3  ANTI-LIVELOCK (gap-ff-livelock-trigger-no-action): this ff failure is the SAME task's
#      attempt >= 3 (SPEC §7: "同一任务 ff 失败 ≥3 次 才谈防活锁"). Develop keeps advancing faster
#      than this task can catch up — a livelock. The script escalates (writes a DISTINCT escalation
#      record + requests a quiet window) and does NOT offer the plain retry (exit 1). DISTINCT from
#      exit 1 (retry) and exit 2 (usage/env) so a caller can mechanically tell "do not auto-retry".
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
suite_capture=""
lock_events=""
retry_record=""
escalations=""
lock_wait=30
worktree=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --task) task_id="$2"; shift 2 ;;
    --root) root="$2"; shift 2 ;;
    --merge-target) merge_target="$2"; shift 2 ;;
    --run-id) run_id="$2"; shift 2 ;;
    --agent-id) agent_id="$2"; shift 2 ;;
    --suite-state) suite_state="$2"; shift 2 ;;
    --suite-capture) suite_capture="$2"; shift 2 ;;
    --lock-events) lock_events="$2"; shift 2 ;;
    --retry-record) retry_record="$2"; shift 2 ;;
    --escalations) escalations="$2"; shift 2 ;;
    --lock-wait) lock_wait="$2"; shift 2 ;;
    --worktree) worktree="$2"; shift 2 ;;
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
# The task suite capture (AC1 收窄, gap-suite-concurrency-ff-gate-and-slot-ssot): the ff gate reads THIS
# task's suite certificate — `/tmp/fan-in-suite-<task>.env` — written by fan-in-execute.js's detached
# suite (the SAME path its poll/step-4.5 use). The capture carries suite_exit (=0 when green; folded by
# the poll from the .exit marker) and suite_head (= the worktree HEAD the suite ran on, which IS the
# commit to be ff'd). Overridable so hermetic tests can point at a fixture capture.
if [ -z "${suite_capture}" ]; then suite_capture="/tmp/fan-in-suite-${task_id}.env"; fi
if [ -z "${lock_events}" ]; then lock_events="${root}/.quay/fan-in-merge-lock-events.jsonl"; fi
if [ -z "${retry_record}" ]; then retry_record="${root}/.quay/fan-in-retries.jsonl"; fi
if [ -z "${escalations}" ]; then escalations="${root}/.quay/fan-in-ff-escalations.jsonl"; fi

# fan-in lock（fan-in.lock）已收进 driver（ADR-034, gap-adr034-fan-in-lock-holder-
# supervised）：worker-driver.ts 的 acquireFanInLock 经非分离直接子进程持锁、随 driver 死自动
# 释放。本脚本的 --acquire/--release-fan-in-lock 分离 holder + flag 释放协议已废除——锁事件仍写
# .quay/fan-in-lock-events.jsonl（由 driver 的 holder 写），fan-in-ff-protocol-check 判据4 读它。

# ── inert-delta classifier (gap-fan-in-ff-retry-reruns-suite-on-inert-increment) ────────────────────
# The "惰性" (doc-only) judgment — used by BOTH the suite-certificate gate (AC3) and the in-lock
# ff-retry (AC1) — reuses the ONE computed classifier: select-static-checks-for-touches.ts
# --classify-delta (parses scripts/test.sh's `@static-object` annotations; no hand-written path table,
# AC4). Self-bootstrapping: fan-in-ff-merge.sh is dispatched as `${worktree}/plugin/scripts/
# fan-in-ff-merge.sh`, so the classifier NEXT TO this script is the worktree's own version and the
# registry root (scripts/test.sh) is the worktree — a task that modifies
# select-static-checks-for-touches.ts / scripts/test.sh annotations exercises its own fix.
classify_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/select-static-checks-for-touches.ts"
classify_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The Touches-intersection classifier (gap-fan-in-ff-merge-benign-runtime-dirty-no-fast-path) — used by
# the merge-mode benign-runtime-dirty pass-through. Same self-bootstrapping resolution as classify_script.
touches_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/touches-orthogonality-check.ts"

# ── AC78 判据2(c): --agent-id 自校验 (manager 2026-08-14 裁定并入实现侧, gap-ac78) ────────────────
# --agent-id is free text — anything passes. Fail-closed: if it resolves to a TOP-LEVEL session id
# (a `<project>/<id>.jsonl` file or `<project>/<id>/` dir exists, prefix-matched), the ff is being
# executed by the MAIN SESSION — the old main-thread-executor form (AC67/AC72/AC73) — NOT by a
# subagent. Exit 2 (usage/environment) BEFORE acquiring the lock or writing any lock event / retry
# record. A real subagent uuid (subagents/agent-<id>.jsonl) never has a top-level file of its own.
if [ -n "${agent_id}" ]; then
  _cc_proj_dir="${HOME}/.claude/projects/$(printf '%s' "${root}" | sed 's|/|-|g')"
  if [ -d "${_cc_proj_dir}" ]; then
    if compgen -G "${_cc_proj_dir}/${agent_id}*.jsonl" >/dev/null 2>&1 || compgen -d "${_cc_proj_dir}/${agent_id}*" >/dev/null 2>&1; then
      echo "fan-in-ff-merge: --agent-id '${agent_id}' resolves to a TOP-LEVEL session id (${_cc_proj_dir}/${agent_id}*.jsonl exists) — a fan-in must be executed by a subagent, not the main session; a top-level session id is the old main-thread-executor form (AC78 判据2(c))" >&2
      exit 2
    fi
  fi
fi

# ── pre-flight (unlocked; none of these is an ff failure, none writes a retry record) ─────────────────
if ! git -C "${root}" rev-parse --verify --quiet "refs/heads/task/${task_id}" >/dev/null 2>&1; then
  echo "fan-in-ff-merge: task branch task/${task_id} not found in ${root}" >&2
  exit 2
fi

# The merge target: the branch the task fast-forwards into. Defaults to the BRANCH NAME (develop), not
# `branch --show-current` — the old merge --ff-only operated on the current branch (which therefore had
# to be the merge target); the ref-update ff (git push .) moves the ref without touching any working
# tree, so the main checkout no longer needs to sit ON the merge target.
if [ -z "${merge_target}" ]; then
  merge_target="develop"
fi
# DUAL-MODE (gap-fan-in-ff-ref-update-detach-develop): the ff degenerates to a PURE REF UPDATE (git
# push .) only AFTER the merge target is detached from the main checkout (the doc-only work branch
# occupies it). Until then (develop still checked out), the ff stays the old `git merge --ff-only`,
# which operates on the current branch and therefore still requires a clean tree. The ref update is
# REFUSED by git when the target is the current branch (receive.denyCurrentBranch), so the two modes
# are mutually exclusive and auto-selected by which branch the main checkout sits on. This keeps the
# mechanism landed WITHOUT breaking fan-in during the transition — the detach + consumer-freshness fix
# (二阶效应①) is a follow-up activation, not a precondition of this task's own landing.
current="$(git -C "${root}" branch --show-current 2>/dev/null || true)"
if [ "${current}" = "${merge_target}" ]; then
  ff_mode="merge"
else
  ff_mode="push"
fi

if [ "${ff_mode}" = "merge" ]; then
# ── clean-tree check (merge mode only) ────────────────────────────────────────────────────────────
# `git merge --ff-only` operates on the current branch and overwrites the working tree ⇒ a clean tree
# is still required while the merge target remains checked out. Two benign dirty shapes are handled
# before the refusal (the ref-update mode below needs NONE of this — it never touches the tree):
#
# ── auto-converge (gap-fan-in-clean-tree-auto-converge-promotion-status, 方案③ 防御纵深) ─────────
# ONE benign dirty shape is auto-converged before the refusal: promotion-driver's status-only flip
# (todo→ready) writes tasks/<id>.md without committing, leaving a status-only dirty tree that is NOT a
# real protocol violation. Criterion is CONTENT-level (⛔ not path-level): porcelain must be ALL
# `tasks/*.md`, AND each file's `git diff HEAD` must hit ONLY the frontmatter `status:` line (every
# +/- line matches `status:`; any body edit or other-field edit fails). When satisfied, stage + commit
# those files (--no-verify — a mechanical status flip is content-neutral; pathspec-limited ⛔ never a
# bare commit sweeping the shared index), then fall through to the ORIGINAL clean-tree check (now clean).
porcelain="$(git -C "${root}" status --porcelain 2>/dev/null || true)"
if [ -n "${porcelain}" ]; then
  converge_ok=1
  converge_paths=""
  while IFS= read -r _pline; do
    [ -n "${_pline}" ] || continue
    _pstatus="${_pline:0:2}"
    _ppath="${_pline:3}"
    # porcelain XY: only a pure modification (" M"/"M "/"MM") is a status flip; ?? / A / D / R / T ⇒ no.
    case "${_pstatus}" in
      " M"|"M "|"MM") : ;;
      *) converge_ok=0; break ;;
    esac
    # every dirty path must be a task file (single segment under tasks/, ⛔ not tasks/sub/…)
    case "${_ppath}" in
      tasks/*.md) : ;;
      *) converge_ok=0; break ;;
    esac
    # content-level: the file's full uncommitted diff (HEAD→worktree) must hit ONLY the status: line
    _pdiff="$(git -C "${root}" diff HEAD -- "${_ppath}" 2>/dev/null | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' || true)"
    if [ -z "${_pdiff}" ]; then
      converge_ok=0; break
    fi
    _nonstatus="$(printf '%s\n' "${_pdiff}" | grep -vE '^[+-]status:' || true)"
    if [ -n "${_nonstatus}" ]; then
      converge_ok=0; break
    fi
    converge_paths="${converge_paths}${converge_paths:+ }${_ppath}"
  done <<EOF
${porcelain}
EOF

  if [ "${converge_ok}" = "1" ] && [ -n "${converge_paths}" ]; then
    # shellcheck disable=SC2086
    if git -C "${root}" add -- ${converge_paths} 2>/dev/null \
       && git -C "${root}" commit --no-verify -q -m "tasks: promotion-driver 翻转（fan-in 自动收敛）" -- ${converge_paths} 2>/dev/null; then
      echo "fan-in-ff-merge: converged a status-only dirty tree (promotion-driver flip) — committed ${converge_paths}" >&2
    fi
  fi
  # re-read porcelain after the (possible) converge commit
  porcelain="$(git -C "${root}" status --porcelain 2>/dev/null || true)"
fi

# ── benign runtime dirty (gap-fan-in-ff-merge-benign-runtime-dirty-no-fast-path) ───────────────
# A SECOND benign dirty shape is auto-passed (仅放行不处置 — NOT committed, NOT gitignored) before the
# refusal: an UNTRACKED runtime file under .quay/ that is OUTSIDE this task's ## Touches (the
# gitignore-missed runtime-state family — serve-send message-receipts.jsonl). The ff proceeds; the file
# stays untracked. Criterion is CONTENT-level (⛔ fail-closed): porcelain must be ALL `?? .quay/…`
# entries AND none may match the task's ## Touches (reuse parseTouches + matchGlob). Any tracked
# modification, a non-.quay untracked file, or a dirty file within the task's ## Touches ⇒ NOT benign.
if [ -n "${porcelain}" ]; then
  benign_ok=1
  benign_paths=""
  while IFS= read -r _bline; do
    [ -n "${_bline}" ] || continue
    _bstatus="${_bline:0:2}"
    _bpath="${_bline:3}"
    case "${_bstatus}" in
      "??") : ;;
      *) benign_ok=0; break ;;
    esac
    case "${_bpath}" in
      .quay|.quay/|.quay/*) : ;;
      *) benign_ok=0; break ;;
    esac
    benign_paths="${benign_paths}${benign_paths:+ }${_bpath}"
  done <<EOF
${porcelain}
EOF

  if [ "${benign_ok}" = "1" ] && [ -n "${benign_paths}" ]; then
    # shellcheck disable=SC2086
    touches_verdict="$(node --experimental-strip-types "${touches_script}" --runtime-dirty --task "${task_id}" --root "${root}" ${benign_paths} 2>/dev/null)" || touches_verdict="NOT-BENIGN (classifier failed)"
    case "${touches_verdict}" in
      BENIGN*) : ;;
      *) benign_ok=0 ;;
    esac
    if [ "${benign_ok}" = "1" ]; then
      echo "fan-in-ff-merge: passed through a benign runtime-dirty tree (untracked .quay/ runtime files outside the task's ## Touches) — ${benign_paths}" >&2
      porcelain=""
    fi
  fi
fi

if [ -n "${porcelain}" ]; then
  echo "fan-in-ff-merge: working tree not clean in ${root} — the merge-mode ff must run on a clean checkout (found uncommitted changes):" >&2
  printf '%s\n' "${porcelain}" | sed 's/^/fan-in-ff-merge:   /' >&2
  exit 2
fi
# ── end clean-tree check (merge mode) ────────────────────────────────────────────────────────────
fi
# (push mode needs NO clean tree — git push . moves the ref without touching the working tree, so the
#  main checkout's dirty state is STRUCTURALLY irrelevant; that is the whole point of the ref update.)

# AC1 判据收窄 (gap-suite-concurrency-ff-gate-and-slot-ssot, 人 2026-08-18「把 ff 的判据从『任何 suite
# 在跑』收窄到『本任务自己的 suite 在跑』」): the ff gate reads THIS TASK's suite certificate, NOT any
# cross-task suite lock. The old 判据 (AC84) probed the GLOBAL single-flight lock slots
# (<git-common-dir>/full-suite.lock.0/.1) and refused when ANY slot was held — two fan-ins running
# suites in PARALLEL each saw the other's slot ⇒ mutual REFUSE (livelock, 2026-08-18 实证). That was a
# category error: the suite lock is a RESOURCE lock (限流, naturally global); the ff's real requirement
# is a CORRECTNESS lock (互斥) — "ff must be mutually exclusive with the ONE suite that produced THIS
# task's green certificate". The correct object already exists: the task's own suite capture
# (`/tmp/fan-in-suite-<task>.env`, written by fan-in-execute.js's detached suite), carrying suite_exit
# (=0 when green; folded by the poll from the .exit marker) and suite_head (= the worktree HEAD the
# suite ran on — which IS the commit to be ff'd). The gate asks "本任务的 suite 是否已终结、且 suite_head
# == 待 ff 的 HEAD" — a per-task DIRECT quantity, no global lock needed.
#
# `--suite-state` (full-suite-state.json) 现在是 capture 缺失/不可读时的【回退权威源】
# （gap-write-suite-capture-non-blocking AC2）：mirrorMechanicalFanInSuiteState 在 suite 绿后写
# state=green + commit=suite_head + taskId（与 capture 同源，同一 suiteHead）⇒ capture 写失败
# （观测写 fail-open）时 ff 闸仍能从权威源判 suite 真实绿，⛔ 不误拒一个真实绿 suite。⛔ 不伪造
# full-green：只认 taskId 匹配本任务的 state=green；full-run 的 green（无 taskId）或别的任务的
# bucket green（taskId 别异）都不得冒充本任务的证书。
#
# FAIL-CLOSED: 无证书（capture 缺失且权威源也不可用/不匹配）/ 非绿 / suite_head ≠ 待 ff tip（或惰性祖先）⇒
# environment error (exit 2, NO retry record — this is not an ff failure). A doc-only fan-in
# (full_suite_ran=false) still writes a capture with suite_exit=0 + suite_head, so it passes the gate —
# the certificate pins the HEAD, not the phase.
suite_cert_ok=0
suite_tip="$(git -C "${root}" rev-parse "refs/heads/task/${task_id}" 2>/dev/null || true)"
suite_exit=""
suite_head=""
if [ -f "${suite_capture}" ]; then
  # shellcheck disable=SC1090
  . "${suite_capture}"
else
  # 回退（gap-write-suite-capture-non-blocking AC2）：capture 缺失/不可读 ⇒ 读权威源 full-suite-state.json
  # 的 suite 终态（mirrorMechanicalFanInSuiteState 在 suite 绿后写 state=green + commit=suite_head +
  # taskId，与 capture 同源）。⛔ 不伪造 full-green：taskId 必须匹配本任务 + state=green + commit 40-hex
  # ——full-run 的 green（scope=main 无 taskId）与别的任务的 bucket green（taskId 别异）不得冒充。
  _state_commit="$(node -e 'const fs=require("node:fs");try{const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(s&&s.state==="green"&&s.taskId===process.argv[2]&&typeof s.commit==="string"&&/^[0-9a-f]{40}$/i.test(s.commit))process.stdout.write(s.commit)}catch(e){}' "${suite_state}" "${task_id}")" || _state_commit=""
  if [ -n "${_state_commit}" ]; then
    suite_exit="0"
    suite_head="${_state_commit}"
  fi
fi
# Certificate semantics (fixed 2026-08-18, gap-suite-concurrency-ff-gate-and-slot-ssot self-test):
# the suite runs on the branch tip at suite time (suite_head); the fan-in's 持锁段 flip step THEN
# commits the task-file status flip (ready→done) on top, pushing the tip past suite_head. So the
# gate must accept suite_head as an ANCESTOR of the tip. AC3 (gap-fan-in-ff-retry-reruns-suite-on-
# inert-increment) 精确弱化 the "tip diff" restriction: `suite_head == tip` OR (`suite_head` is a
# `tip` ancestor AND delta(suite_head, tip) is classified inert) — the suite_head..tip diff is
# normally just the flip (tasks/<id>.md, inert); an in-lock develop merge adds further INERT commits.
# A `@static-object`-covered path in the diff ⇒ code ⇒ refuse (falsifiable, fail-closed). The diff
# restriction is the COMPUTED classifier (--classify-delta), never a hand-written path grep.
if [ "${suite_exit:-}" = "0" ] && [ -n "${suite_head:-}" ] && [ -n "${suite_tip}" ] \
   && git -C "${root}" merge-base --is-ancestor "${suite_head}" "${suite_tip}" 2>/dev/null; then
  gate_delta="$(git -C "${root}" diff --name-only "${suite_head}" "${suite_tip}" 2>/dev/null || true)"
  gate_code="$(node --experimental-strip-types "${classify_script}" --classify-delta --root "${classify_root}" ${gate_delta} 2>/dev/null)" || gate_code="__CLASSIFY_FAILED__"
  if [ "${gate_code}" = "__CLASSIFY_FAILED__" ]; then
    suite_cert_ok=0
  elif [ -z "${gate_code}" ]; then
    suite_cert_ok=1
  fi
fi
if [ "${suite_cert_ok}" != "1" ]; then
  # gap-wiring-D-worktree-remove-orphans-reclaim-restore (硬规则 5b): restore the stale-lock reclaim
  # seam that 9645a4ff dropped when it replaced the global suite-lock probe with this per-task
  # certificate. The certificate narrow-gate is the CORRECT architecture (the per-task capture fixed
  # the 2026-08-18 mutual-refuse livelock) — but the reaper was a SEPARATE concern (gap-worktree-
  # remove-orphans-probes: reclaim stale suite-lock HOLDERS so a hung holder never blocks a suite from
  # starting) that must not silently disappear with it. On the BLOCKED path (certificate unsatisfied —
  # the analog of "a slot is held" under the old gate), run the reaper best-effort BEFORE refusing:
  #   (a) --worktree <path> reclaims THIS task worktree's own leftovers (a hung suite/runner from a
  #       prior fan-in attempt whose worktree still exists — excludes the caller's own process tree);
  #   (b) --orphans --stale-lock-holders-only reclaims stale suite-lock holders whose cwd points at a
  #       DELETED worktree (the orphan family: a suite whose worktree was removed without first
  #       stopping it — the flock auto-releases when the process dies, so reclaiming unblocks the
  #       caller's next suite start).
  # NEVER a name-based batch kill of live processes (the 2026-08-08 two-layer-blind invariant);
  # --stale-lock-holders-only skips the global claude-probe orphan sweep (cross-test race, 2026-08-17).
  # The normal fast path (certificate green) is untouched — the reaper only runs on the blocked path.
  _reaper="${BASH_SOURCE[0]%/*}/worktree-process-reaper.ts"
  if [ -f "${_reaper}" ]; then
    if [ -n "${worktree}" ]; then
      node --no-warnings --experimental-strip-types "${_reaper}" --worktree "${worktree}" --root "${root}" --json >/dev/null 2>&1 || true
    fi
    node --no-warnings --experimental-strip-types "${_reaper}" --orphans --stale-lock-holders-only --root "${root}" --json >/dev/null 2>&1 || true
  fi
  echo "fan-in-ff-merge: 本任务 ${task_id} 的 suite 证书未满足 — capture=${suite_capture} exists=$([ -f "${suite_capture}" ] && echo yes || echo no) suite_exit=${suite_exit:-<unset>} suite_head=${suite_head:-<unset>} 待 ff tip=${suite_tip:-<unresolvable>}; 证书要求 suite_head 是待 ff tip 的祖先、且 suite_head..tip 的 delta 经 --classify-delta 判惰性（无 change/full 检查器 @static-object 覆盖 + 落 doc 面）；塞入 @static-object 覆盖路径 ⇒ 拒（可取假）。NOT acquiring the merge lock" >&2
  exit 2
fi

# JSON-string-or-null encoding for runId/agentId. The `:+\"...\"${x:-null}` compound is WRONG (it fires
# BOTH branches when the value is non-empty ⇒ the value is emitted twice, corrupting the JSON — a real
# bug caught while wiring --agent-id). Precompute with an explicit if/else so a SET value is ONE quoted
# string and an ABSENT value is `null` (the absence the executor check flags as the main-thread form).
# Computed BEFORE the attempt counting below — the count keys on runId (gap-fan-in-ff-retry-counter-
# scope), so run_id_json must already be resolved here.
if [ -n "${run_id}" ]; then run_id_json="\"${run_id}\""; else run_id_json="null"; fi
if [ -n "${agent_id}" ]; then agent_id_json="\"${agent_id}\""; else agent_id_json="null"; fi

# ── attempt counting (判据3: 第几次) ──────────────────────────────────────────────────────────────────
# The retry record is the anti-livelock data (§7): the attempt number is "how many times THIS task's
# ff has failed already" + 1 (the current failure is the next try). A missing/empty retry file counts
# zero prior failures ⇒ the first failure is attempt 1.
# gap-fan-in-ff-retry-counter-scope (AC1/AC2): the retry record is APPEND-ONLY — no code prunes it
# (grep -rn 'fan-in-retries.jsonl' plugin/ confirms it is never trimmed on success/re-dispatch), so a
# taskId-only count accumulates across ALL dispatches. `maxFfRetries=3` in fan-in-execute.js is a
# PER-DISPATCH budget (each fresh dispatch = a fresh runId, starting at 0) — the two counters' scopes
# were mismatched: a task that failed twice historically was read as attempt 3 on a LATER dispatch's
# first real try and escalated before spending its own budget. Fix: count only failures carrying the
# CURRENT dispatch's runId, so a fresh dispatch's failures start from 0. (runId null/empty ⇒ the
# pre-AC67 / main-thread form with no per-dispatch identity — those still group together as before.)
prior_failures="$( { grep -c "\"taskId\":\"${task_id}\".*\"runId\":${run_id_json}" "${retry_record}" 2>/dev/null || true; } | tail -n1 )"
[ -n "${prior_failures}" ] || prior_failures=0
attempt=$(( prior_failures + 1 ))

# ── the 持锁段: acquire → ff-only → release ───────────────────────────────────────────────────────────
# flock on an open fd: the lock is released automatically when the fd closes (process exit), so a
# crash mid-ff cannot leak it — no stale-lock recovery design needed (§2). --lock-wait bounds the
# wait (default 30s; the hold is milliseconds so a waiter never actually waits this long).
# ⚠️ lock wait 语义（gap-single-flight-lock-timeout-double-value）：本锁是【正确性锁】——只包
# git merge --ff-only（毫秒级 hold），wait 30s 绰绰有余。它【不是】suite 的 single-flight【资源锁】
# （<git-common-dir>/full-suite.lock.0/.1，hold 是整套 suite）。后者现在是【无界排队等待】（test.sh
# full_suite_lock_acquire：flock crash-autorelease 保证死持有者不泄漏槽；无双值、无 fail-closed
# 「not starting」）。fan-in 流程显式传 --lock-wait（mergeLockWaitSecs，默认 30s，fan-in-execute.js
# args）——两个锁的 wait 语义互不混淆。
mkdir -p "$(dirname "${lock_events}")" "$(dirname "${retry_record}")" "$(dirname "${escalations}")" 2>/dev/null || true
lock_fd=9
exec {lock_fd}>"${lock_file}"
if ! flock -x -w "${lock_wait}" "${lock_fd}"; then
  echo "fan-in-ff-merge: could not acquire merge lock ${lock_file} within ${lock_wait}s (another fan-in holds it?)" >&2
  exit 2
fi

now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
now_epoch="$(date +%s)"
# (run_id_json / agent_id_json are resolved above, before attempt counting — see the encoding note there.)
# Lock-hold event (acquire) — the checker reads these to verify the lock covers ONLY the ff.
printf '%s\n' "{\"event\":\"acquire\",\"ts\":\"${now_iso}\",\"epoch\":${now_epoch},\"taskId\":\"${task_id}\",\"pid\":$$,\"runId\":${run_id_json},\"agentId\":${agent_id_json}}" >> "${lock_events}"

merge_rc=0
merge_err=""
develop_head_before="$(git -C "${root}" rev-parse "${merge_target}" 2>/dev/null || echo "unresolvable")"
# The ff inside the lock (DUAL-MODE, gap-fan-in-ff-ref-update-detach-develop):
#   push mode  (merge target detached)    → `git push .` — a pure ref update, no working tree touched
#                                           (the main checkout's dirty state is structurally irrelevant).
#   merge mode (merge target checked out) → `git merge --ff-only` — operates on the current branch.
# Both fast-forward and refuse a non-ff the same way ("develop advanced since step 1's merge develop").
if [ "${ff_mode}" = "push" ]; then
  ff_cmd=(git -C "${root}" push . "refs/heads/task/${task_id}:refs/heads/${merge_target}")
else
  ff_cmd=(git -C "${root}" merge --ff-only "task/${task_id}")
fi
if ! merge_out="$("${ff_cmd[@]}" 2>&1)"; then
  merge_rc=1
  merge_err="$(printf '%s\n' "${merge_out}" | head -n1)"
  # gap-fan-in-ff-retry-reruns-suite-on-inert-increment: ff 失败唯一原因 = develop 前进。当场判 develop
  # 新 tip 相对 suite_head 的【增量】是否惰性（复用 --classify-delta，三点 diff = develop 自 suite 以来
  # 新获得的提交）。惰性（tasks/*.md / doc / telemetry）⇒ 锁内 merge develop 进任务分支（worktree）+
  # 立即重试 ff——毫秒级、零竞争窗口，不回阶段 1 重跑全量。非惰性（含代码）或判不出（fail-closed）⇒
  # 保留 merge_rc=1，照旧写 retry record 并 exit 1 回阶段 1（AC2 负控制）。
  develop_tip="$(git -C "${root}" rev-parse "${merge_target}" 2>/dev/null || true)"
  wt_branch="$( [ -n "${worktree}" ] && git -C "${worktree}" branch --show-current 2>/dev/null || true )"
  if [ -n "${worktree}" ] && [ "${wt_branch}" = "task/${task_id}" ] && [ -n "${suite_head:-}" ] && [ -n "${develop_tip}" ]; then
    inc_files="$(git -C "${root}" diff --name-only "${suite_head}...${develop_tip}" 2>/dev/null || true)"
    if [ -n "${inc_files}" ]; then
      code_delta="$(node --experimental-strip-types "${classify_script}" --classify-delta --root "${classify_root}" ${inc_files} 2>/dev/null)" || code_delta="__CLASSIFY_FAILED__"
      if [ "${code_delta}" != "__CLASSIFY_FAILED__" ] && [ -z "${code_delta}" ]; then
        # inert increment ⇒ merge develop into the task branch (in the worktree), then retry the ff.
        if git -C "${worktree}" merge --no-edit "${merge_target}" >/dev/null 2>&1; then
          if merge_out2="$("${ff_cmd[@]}" 2>&1)"; then
            merge_rc=0
            merge_err=""
          else
            merge_rc=1
            merge_err="$(printf '%s\n' "${merge_out2}" | head -n1)"
          fi
        fi
      fi
    fi
  fi
fi

now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
now_epoch="$(date +%s)"
# gap-direct-to-develop-check-reflog-to-revlist AC1: the release event carries `landedSha` — on a
# SUCCESSFUL ff it is the landed commit sha (the merge target, now at the task tip); on an ff failure
# (merge_rc != 0) it is null. This is the persistent fan-in-landing ledger (same file, same append —
# ⛔ no new jsonl): direct-to-develop-bypass-check.ts reads it as the ground truth that survives reflog
# gc, instead of the pruneable reflog `merge task/<id>: Fast-forward` entries.
if [ "${merge_rc}" = "0" ]; then
  landed_sha="$(git -C "${root}" rev-parse "${merge_target}" 2>/dev/null || echo "")"
  if [ -n "${landed_sha}" ]; then landed_json="\"${landed_sha}\""; else landed_json="null"; fi
else
  landed_json="null"
fi
printf '%s\n' "{\"event\":\"release\",\"ts\":\"${now_iso}\",\"epoch\":${now_epoch},\"taskId\":\"${task_id}\",\"pid\":$$,\"runId\":${run_id_json},\"agentId\":${agent_id_json},\"landedSha\":${landed_json}}" >> "${lock_events}"

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
  # ── SPEC §7 anti-livelock trigger (gap-ff-livelock-trigger-no-action) ───────────────────────────
  # The retry record IS the anti-livelock data (§7): "同一任务 ff 失败 ≥3 次 才谈防活锁". When THIS
  # failure is the same task's attempt >= 3 (develop keeps advancing faster than the fan-in can
  # catch up — a livelock), the plain "exit 1 → return to step 1" retry is NO LONGER offered:
  #   1. ESCALATE — write a DISTINCT escalation record (.quay/fan-in-ff-escalations.jsonl) carrying
  #      task / attempt / develop head / caller identity; exit code 3 is distinct from 1 (retry) and
  #      2 (usage/env), so a caller can mechanically tell "anti-livelock, do not auto-retry" apart
  #      from "develop advanced, retry".
  #   2. STOP AUTOMATIC RETRY — the guard is the attempt count itself: once attempt >= 3, THIS and
  #      every later invocation escalates (exit 3), never returns the plain retry exit 1.
  #   (gap-quiet-window-holder-scope-wider-than-consumer: the SPEC §7 quiet-window REQUEST that used
  #    to be item 2 here is RETIRED — it held a non-bottleneck. The escalation record is now a pure
  #    stop-retry signal + traceability carrier; the real bottleneck, single-flight lock queueing,
  #    is handled by gap-suite-lock-starvation-long-validation-hold.)
  if [ "${attempt}" -ge 3 ]; then
    printf '%s\n' "{\"event\":\"ff-escalation\",\"taskId\":\"${task_id}\",\"attempt\":${attempt},\"developHead\":\"${develop_head_now}\",\"ts\":\"${now_iso}\",\"epoch\":${now_epoch},\"runId\":${run_id_json},\"agentId\":${agent_id_json},\"mergeTarget\":\"${merge_target}\",\"action\":\"stop-retry\"}" >> "${escalations}"
    echo "fan-in-ff-merge: FF FAILED (attempt ${attempt} >= 3) — ANTI-LIVELOCK (SPEC §7, gap-ff-livelock-trigger-no-action): develop keeps advancing; escalating + STOPPING automatic retry. Escalation record written to ${escalations}. Do NOT auto-retry: re-merge develop and re-run the fan-in once develop settles." >&2
    echo "fan-in-ff-merge: measure ff_only_locked=false" >&2
    exit 3
  fi
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
# ── escalation resolution（gap-fan-in-ff-livelock-quiet-window-no-consumer 的兑现半边；quiet-window
#    请求已随 gap-quiet-window-holder-scope-wider-than-consumer 退役，本记录保留为 escalation 的
#    【已落地】兑现信号，供 slot-refill 的 ff-starvation relief 读「该任务 escalation 已解除」）─────
# On ff SUCCESS the escalated task has landed — append a resolution record (event
# "ff-escalation-resolved") to the SAME escalation file so the escalation ledger marks the task's
# escalation as cleared (slot-refill's computeUnresolvedEscalationTaskIds reads the LATEST event: a
# non-ff-escalation latest event = resolved). Written unconditionally: a resolution with no prior
# request is a no-op for that consumer. Same file, same append — ⛔ no new jsonl.
printf '%s\n' "{\"event\":\"ff-escalation-resolved\",\"taskId\":\"${task_id}\",\"ts\":\"${now_iso}\",\"epoch\":${now_epoch},\"runId\":${run_id_json},\"agentId\":${agent_id_json},\"mergeTarget\":\"${merge_target}\"}" >> "${escalations}"
echo "fan-in-ff-merge: OK — ${merge_target} fast-forwarded to task/${task_id} (${post_head}) [before ${develop_head_before}]${run_id:+ (runId: ${run_id})}"
echo "fan-in-ff-merge: measure ff_only_locked=true"
exit 0
