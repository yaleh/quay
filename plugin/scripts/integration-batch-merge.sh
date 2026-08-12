#!/usr/bin/env bash
# integration-batch-merge.sh — the integration→develop batch-merge helper of the two-line branch
# model (gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point, AC3; real-merge
# mode per gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling).
#
# Under the two-line model the outer verification-round batch-merges `integration` → `develop`.
# The ORIGINAL design assumed this is ALWAYS a fast-forward (integration is always a descendant of
# develop, SPEC §4). That assumption was EMPIRICALLY NEGATED on 2026-08-06 23:48 (a 60-second
# disproof: develop advances via direct inner/outer/manager commits within a minute of an alignment
# merge), and the direction ruling (2026-08-06 23:4x) changed integration→develop from FF-only to
# real-merge on divergence.
#
# Modes:
#   default (no --merge) — fast-forward when integration is a descendant of develop; on TRUE
#     divergence (develop has commits integration lacks) report the divergence surface
#     (develop-only / integration-only counts + would-conflict file list) and FAIL CLOSED (needs a
#     human, nothing moved) — never a blind --ours/--theirs.
#   --merge — on TRUE divergence, perform a REAL merge of `integration` into `develop` (a merge
#     commit, built in a throwaway temp git worktree; the primary checkout is never touched).
#     Conflicts on KNOWN SHARED files (defaults: *tick-log.md, tasks/*.md, *queue-state* — files
#     written directly to develop by the inner/outer/manager, whose authoritative version lives on
#     develop) are auto-resolved develop-authoritative; conflicts on REVERSE-EDGE files
#     (--integration-authoritative — RUNTIME CONFIG files that tasks edit on INTEGRATION, where
#     develop's copy can be the STALE/DEFECTIVE one; see the reverse-edge section below) are
#     auto-resolved integration-authoritative, gated on a content criterion when one is supplied;
#     any REAL code conflict FAILS CLOSED (needs a human, nothing moved, conflict file list
#     reported) — never blind --ours/--theirs on code. Fast-forward when possible (no gratuitous
#     merge commits).
#
# REVERSE EDGE (gap-batch-merge-authoritative-direction-hardcoded-develop, 2026-08-08):
#   The conflict resolution direction is NOT a fixed "develop always wins". Empirical anchor
#   (2026-08-08 14:1xZ, integration→develop real merge): orchestration/session-liveness.env was a
#   genuine code conflict (not shared). The two sides:
#     develop     SESSION_TRANSCRIPTS="inner /path"   DEFECTIVE — name NOT in SESSION_TARGETS table
#                                                      (transcript silently ignored, monitor blind)
#     integration SESSION_TRANSCRIPTS="quay /path"    FIXED — name IN the SESSION_TARGETS table
#   The CORRECT resolution is integration-authoritative, decided by a CONTENT criterion ("the
#   SESSION_TRANSCRIPTS name must be in the SESSION_TARGETS table"), not a fixed direction. The
#   tool had no way to express that (only develop-authoritative resolve_as_ours existed), so the
#   outer manual-bypassed the tool. This task adds the reverse edge so the tool CAN express it.
#   Direction semantics: a REVERSE-EDGE candidate resolves to the integration side ONLY IF the
#   integration side satisfies the content criterion (--reverse-edge-criterion); a candidate whose
#   integration side FAILS the criterion (or no criterion was supplied AND the caller chose the
#   fixed-direction form) is resolved by whatever was declared. Without any reverse-edge
#   declaration a non-shared conflict stays fail-closed (AC4 preserved).
#   --reconcile — after a successful batch merge (ff or real), reconcile the PRIMARY checkout (the
#     checkout the outer loop lives in; the advanced <develop> branch may be checked out there). The
#     ref-level update-ref moves <develop> UNDER the checkout, leaving its HEAD/index STALE (git status
#     shows the old-vs-new tree as staged changes). The reconcile is provided HERE so callers don't
#     invent it: (1) BEFORE any ref moves, a porcelain-empty guard on the primary checkout FAILS CLOSED
#     if there is uncommitted/untracked work — a caller-invented `git reset --hard HEAD` destroyed an
#     uncommitted manager edit on 2026-08-08 08:08:24 (real data loss); (2) after the merge, the index
#     is refreshed with `git reset --mixed <new develop tip>` — index ONLY, never --hard, working tree
#     untouched.
#
# Contract (task body):
#   measure   integration_ff_merges = `git merge-base --is-ancestor <integration> <develop>` exit code
#             (0 = integration's tip is reachable from develop = its commits are absorbed)
#   band      integration_ff_merges = 0 (POST-state: after a successful batch merge integration is an
#             ancestor of develop; the PRE-state ff-ability check is `--is-ancestor <develop> <integration>`)
#   invoke    `git log --oneline develop..integration` (only pending-verification task merges, never empty
#             during a red window)
#   control   a task merged into integration during a red window does NOT block; a touch-declaration
#             imprecision shows up as a task→integration merge conflict, never a silent overwrite.
#
#   measure   unmerged_develop_files = `git diff --name-only <merge-base(integration,develop)> <develop>`
#             | grep -cE '\.(ts|js|mjs|sh)$' stdout 数字段 (three-dot semantics: develop-side code files
#             that never entered the tested tree; the raw two-dot also counts integration's OWN tested files)
#   band      unmerged_develop_files = 0 (POST-state: a batch merge may only proceed when the develop-side
#             code files have been verified together with the integration content; pure .md/tasks pass)
#   invoke    `git diff --name-only <merge-base> <develop>` (the develop-only surface the suite never saw)
#   control   negative: develop-side pure .md/tasks files (the 5 files in the 2026-08-08 report) PASS;
#             develop-side code files (.ts/.js/.mjs/.sh) BLOCK before any ref moves.
#
# The helper performs a REF-LEVEL fast-forward (`git update-ref` with a CAS on the old develop tip)
# or a REF-LEVEL real merge (temp worktree → merge → CAS update-ref), so it never touches the primary
# working tree and never needs `integration`/`develop` checked out. It exits non-zero — WITHOUT
# moving any ref — when integration is NOT a descendant of develop AND (no --merge, or a real code
# conflict).
#
# Usage:
#   integration-batch-merge.sh [--root <repo>] [--develop <ref>] [--integration <ref>]
#                              [--dry-run] [--merge] [--shared-file <glob>] [--sync]
#   --root        repo root (default: auto-derived from this script's location)
#   --develop     develop ref (default: develop)
#   --integration integration ref (default: integration)
#   --dry-run     check ff-ability + report the measure WITHOUT moving any ref; on divergence, also
#                 report the divergence surface (develop-only / integration-only counts + would-
#                 conflict file list)
#   --merge       on TRUE divergence, perform a REAL merge (a merge commit) instead of failing
#                 closed: conflicts on known shared files (defaults: *tick-log.md, tasks/*.md,
#                 *queue-state*) auto-resolve develop-authoritative; real code conflicts FAIL CLOSED
#                 (never blind --ours/--theirs). Fast-forward when possible.
#   --shared-file <glob>  add a path glob treated as a KNOWN SHARED file (develop-authoritative on
#                 conflict). Repeatable; defaults: *tick-log.md, tasks/*.md, *queue-state*.
#   --integration-authoritative <glob>
#                 add a path glob treated as a REVERSE-EDGE file: on conflict the path resolves to the
#                 INTEGRATION side (`checkout --theirs`). Repeatable. This is the escape hatch for
#                 RUNTIME CONFIG files (env/config) that tasks edit on INTEGRATION, where develop's copy
#                 can be the STALE/DEFECTIVE one (2026-08-08 session-liveness.env: develop "inner"
#                 name-not-in-table vs integration "quay" name-in-table). The direction SHOULD be backed
#                 by a content criterion (--reverse-edge-criterion): the integration side is then taken
#                 only when IT satisfies the criterion; otherwise the file fails closed (never
#                 blind-choose).
#   --reverse-edge-criterion <script>
#                 a content-criterion script gating reverse-edge resolution. Interface: `bash <script>
#                 <path>` with the INTEGRATION-side version of the conflicted file on stdin; exit 0 =
#                 criterion satisfied (integration authoritative → take theirs); any non-zero = NOT
#                 satisfied → the reverse-edge candidate becomes a genuine conflict (fail-closed, needs
#                 a human). When omitted, --integration-authoritative files resolve integration-side
#                 unconditionally (the fixed-direction form).
#   --deliver     (DIR-123 人裁定 2026-08-11) after a successful land closure (ff or real), launch
#                 develop-deliver-tgz.sh DETACHED (best-effort, non-blocking — a remote being down
#                 never fails the merge): builds a fresh hardware-independent quay .tgz at the merged
#                 develop tip, scp's it to the verification machines B/C, installs with their existing
#                 Node >=20, and proves `quay serve` returns 200. Freshness is recorded in
#                 .quay/develop-deliver-state.json; the outer tick retries when stale.
#   --sync        (gap-cross-machine-sync-has-no-mechanism-only-manual-pushes) after a successful
#                 merge (ff or real), IMMEDIATELY push the advanced <develop> ref to origin via
#                 sync-lag-check.sh (the event-driven trigger of the cross-machine sync mechanism —
#                 the push happens in the SAME round as the land closure, not at the next tick).
#                 The merge is the primary outcome; a push failure (non-fast-forward = a real
#                 cross-machine divergence) is REPORTED and does not roll the ref back — the
#                 every-tick heartbeat retries it.
#   --reconcile  after a successful batch merge, reconcile the primary checkout's stale index: run a
#                porcelain-empty guard first (fail-closed on uncommitted/untracked work, owners
#                reported), then `git reset --mixed <new develop tip>` — index only, never --hard.
#   --fan-in <taskId>  FAN-IN MODE (gap-task-telemetry-6-percent-join): per-task fan-in merge of
#                `task/<taskId>` into the CURRENT CHECKOUT's branch (fast-mode's $MERGE_TARGET),
#                with the telemetry runId embedded in the commit subject — "merge: fan-in task/<id>
#                (runId: fm-...)" — the position-parseable bridge that makes git landing records and
#                telemetry records joinable (the 6% join-rate defect). Requires --run-id. Skips the
#                batch-merge gates entirely (it exits before them); the batch-merge flow is unchanged
#                and remains the default when --fan-in is absent.
#   --run-id <id>  the telemetry runId (from fast-mode-telemetry.ts --task-start). REQUIRED by
#                --fan-in <taskId> (embedded in the fan-in commit subject, position-parseable). In the
#                batch-merge path (--merge on divergence) it is embedded in the REAL merge commit's
#                message (`(runId: <id>)`) — the telemetry taskId → git traceability link
#                fan-in-runid-check.ts reads. Must be filename-safe. No-op on the fast-forward path
#                (creates no commit).
#
#   OBJECT GATE (gap-batch-merge-gate-validates-tip-not-merge-result): before ANY merge (ff or real),
#                the helper validates the MERGE RESULT, not just the integration tip. The suite tested
#                the INTEGRATION TIP; the batch merge produces integration ⊕ develop. develop-only
#                changes since the divergence point never entered the tested tree — if any are code
#                files (.ts/.js/.mjs/.sh), the merge result would ship untested code and the helper
#                FAILS CLOSED (nothing moved, the offending files reported). Pure .md/tasks files on
#                the develop side PASS (e.g. the 5 files in the 2026-08-08 report). The gate uses
#                three-dot semantics (`git diff --name-only <merge-base> <develop>`), NOT the raw
#                two-dot `git diff integration develop` — the two-dot also lists integration's OWN
#                tested files, a false positive the gate must avoid.
#
#   FRESHNESS GATE (gap-batch-merge-gate-reads-stale-green; gap-batch-merge-freshness-gate-ignores-scope;
#                   gap-batch-merge-freshness-gate-doc-only-exemption):
#                before ANY merge (ff or real), the helper requires a FRESH suite green — the batch-merge
#                gate previously read ONLY `state == green` and treated a 3-hour-old green (measuring a
#                DIFFERENT batch of commits) as a pass for THIS tree (7b1ac3a1, 2026-08-08). The gate
#                also previously IGNORED the state's `scope` field, so a green from ANY linked worktree
#                (even one testing a completely unrelated tree) satisfied the gate. Three dimensions,
#                all required:
#                  state == green (not running/red; a missing state file FAILS CLOSED — no valid green)
#                  scope == main (a WORKTREE-sourced green is DEFERRABLE — the runner tags every state
#                    `scope: main|worktree`, gap-worktree-scoped-runs-consume-resources-but-produce-no-
#                    signal AC1; only a main-repo green is the authoritative signal the batch merge may
#                    trust — the SCOPE axis). scope absent (legacy state) = treat as main (fail-open)
#                  finishedAt within --freshness-window (default 3600s) of now  — the AGE axis
#                  suite startedAt >= most-recent integration fan-in commit time — the COVERAGE axis
#                DOC-ONLY EXEMPTION (gap-batch-merge-freshness-gate-doc-only-exemption): the COVERAGE
#                axis is EXEMPT when every file the fan-in(s) changed after the suite started is doc-only
#                (.md/.jsonl — `git diff --name-only <integration-tip-as-of-suite-start> <integration>`)
#                — doc-only commits (phase-goal/SPEC/task edits) cannot change the test surface, so
#                blocking forces a needless 17-min full-suite re-run (rounds 153/157/158). A pending
#                change touching ANY other file type (a code file) is NOT exempt — fail-closed as before.
#                FAILS CLOSED (nothing moved) on any violation. `--skip-freshness-gate` is the explicit
#                opt-out for callers exercising OTHER gates in isolation; the real orchestrator
#                invocation never passes it (the gate is ON by default — mechanical, not self-judged).
#
#   WORKTREE-GREEN GATE (gap-suite-fix-scope-worktree-green-merge-gate): before ANY merge (ff or real),
#                the helper requires at least one suite-fix self-test round on record — a
#                `verification-round.jsonl` line with `scope=worktree` AND `state=green`
#                (`<repo_root>/.quay/verification-round.jsonl`). The suite-fix subagent's fan-in is the
#                step that must be gated: without this record there is NO mechanical evidence the
#                subagent ever self-tested green in its OWN worktree (rounds 230/231 scope=main were the
#                second subagent waiting on the shared checkout — the A15 ④ 三保障 all silently failed
#                while each 条文 "没被违反"). Data already exists (full-suite-runner.ts writes
#                scope/state); this is a CONSUMER-SIDE pre-assertion, NO new mechanism. Fail-closed:
#                record absent OR present-but-no-worktree+green (scope missing on a legacy line ⇒ not
#                counted) ⇒ reject the merge with an actionable message (先在自己 worktree 自测绿).
#                `--skip-worktree-green-gate` is the explicit opt-out for callers exercising OTHER gates
#                in isolation; the real orchestrator/suite-fix invocation never passes it (ON by default).
#
# Exit codes:
#   0  merge performed (ff or real) OR nothing pending (integration already absorbed into develop);
#      with --dry-run, the ff-ability / divergence surface was reported without moving any ref
#   1  NOT a fast-forward and no --merge (needs a human), OR a real code conflict in --merge mode
#      (fail-closed, nothing moved), OR the object gate blocked (develop-side code files outside the
#      tested tree — fail-closed, nothing moved), OR the freshness gate blocked (no valid fresh green —
#      stale/missing/running/non-main-scope suite state — fail-closed, nothing moved), OR the
#      worktree-green gate blocked (no scope=worktree+state=green round on record — the suite-fix
#      subagent never self-tested green in its own worktree — fail-closed, nothing moved)
#   2  usage / missing ref
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
develop_ref="develop"
integration_ref="integration"
dry_run=0
sync=0
deliver=0
merge_mode=0
reconcile=0
# ── FAN-IN MODE (gap-task-telemetry-6-percent-join) ─────────────────────────────────────────────
# Per-task fan-in (task/<id> → the current checkout's branch — fast-mode's $MERGE_TARGET) with the
# telemetry runId embedded in the commit subject. Empty by default (the batch-merge flow is the
# default); set by --fan-in <taskId> / --run-id <runId>.
fan_in_task=""

# gap-suite-leaks-live-claude-sessions — stop every claude session whose --settings workspace is under
# the given worktree path, BEFORE the worktree is removed (注销 worktree 前停其会话). A teardown that
# only `git worktree remove`s the dir leaks any live claude session launched inside it (the
# manager-productization2 119h orphan pair). Best-effort: a missing orphan-session-check.ts or a
# transient process race never fails the removal.
stop_sessions_under_worktree() {
  local wt="${1:-}"
  [ -n "${wt}" ] || return 0
  if [ ! -f "${SCRIPT_DIR}/orphan-session-check.ts" ]; then
    echo "integration-batch-merge: WARNING orphan-session-check.ts not found at ${SCRIPT_DIR}/orphan-session-check.ts — sessions under ${wt} not stopped (leak risk)" >&2
    return 0
  fi
  node --no-warnings --experimental-strip-types "${SCRIPT_DIR}/orphan-session-check.ts" --kill-workspace "${wt}" >/dev/null 2>&1 \
    || true
  return 0
}
# ── runId (gap-task-telemetry-6-percent-join) ───────────────────────────────────────────────────────
# The telemetry runId (from fast-mode-telemetry.ts --task-start). REQUIRED by --fan-in <taskId>
# (embedded in the fan-in commit subject); when a REAL merge commit is created (--merge on
# divergence), it is embedded in the commit message (`(runId: <id>)`) — the telemetry taskId → git
# branch traceability link fan-in-runid-check.ts reads. The fast-forward path creates NO commit
# (ref-level update-ref), so it has no message to annotate.
run_id=""
# ── FRESHNESS GATE (gap-batch-merge-gate-reads-stale-green) ───────────────────────────────────────
# The batch merge may only proceed when the suite green is a FRESH green that actually verified the
# CURRENT integration tip. Defaults: gate ON (mechanical — the outer's suiteGreen rule and the script's
# own check are the SAME gate, no "document says mechanical, actual is self-judged" gap), window 3600s,
# state file at <repo_root>/.quay/full-suite-state.json. `--skip-freshness-gate` is the explicit
# opt-out for callers exercising OTHER gates (object / reconcile / real-merge conflict) in isolation.
skip_freshness_gate=0
freshness_window=3600
suite_state_file=""
# ── WORKTREE-GREEN GATE (gap-suite-fix-scope-worktree-green-merge-gate) ──────────────────────────────
# suite-fix subagent fan-in 前置断言：fan-in 前必须存在 ≥1 条 `scope=worktree` 且 `state=green` 的轮次
# 记录（verification-round.jsonl），否则拒绝 merge。`--skip-worktree-green-gate` 是显式 opt-out（测试
# 隔离其他门用）；真实 orchestrator/suite-fix 调用不传（门默认 ON，机械而非自判）。
skip_worktree_green_gate=0
# Global for the real-merge temp worktree path (must outlive real_merge() so the EXIT trap can
# clean it up even under `set -u`).
tmp_wt=""
# Known-shared files: written directly to develop by the inner/outer/manager; integration's copies
# are stale — on conflict, develop is authoritative. Matched against conflicted paths via bash case.
shared_patterns=('*tick-log.md' 'tasks/*.md' '*queue-state*')
# REVERSE-EDGE (integration-authoritative) files: RUNTIME CONFIG files (env/config) that tasks edit
# on INTEGRATION — develop's copy lags and can be the DEFECTIVE one (2026-08-08 session-liveness.env:
# develop "inner" name-not-in-table vs integration "quay" name-in-table). On conflict these resolve to
# the INTEGRATION side (`checkout --theirs`) instead of develop. Checked BEFORE shared_patterns (an
# explicit reverse-edge declaration overrides the develop-authoritative default for that path).
# Direction is CONTENT-criterion-driven when reverse_edge_criterion is set: integration is taken ONLY
# IF its side satisfies the criterion; otherwise the candidate fails closed (never blind-choose).
int_authoritative_patterns=()
reverse_edge_criterion=""

usage() {
  local last_comment
  # Print the header comment block (line 2 .. the last `#` comment line) as the usage text. The end is
  # derived, not hardcoded, so header edits (e.g. the reverse-edge section) don't truncate usage.
  last_comment="$(awk '/^[^#]/{print NR-1; exit}' "${BASH_SOURCE[0]}")"
  sed -n "2,${last_comment}p" "${BASH_SOURCE[0]}" | sed -n 's/^# \{0,1\}//p' >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) repo_root="$2"; shift 2 ;;
    --develop) develop_ref="$2"; shift 2 ;;
    --integration) integration_ref="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --merge) merge_mode=1; shift ;;
    --shared-file) shared_patterns+=("$2"); shift 2 ;;
    --integration-authoritative) int_authoritative_patterns+=("$2"); shift 2 ;;
    --reverse-edge-criterion) reverse_edge_criterion="$2"; shift 2 ;;
    --sync) sync=1; shift ;;
    --deliver) deliver=1; shift ;;
    --reconcile) reconcile=1; shift ;;
    --run-id) run_id="$2"; shift 2 ;;
    --skip-freshness-gate) skip_freshness_gate=1; shift ;;
    --skip-worktree-green-gate) skip_worktree_green_gate=1; shift ;;
    --freshness-window) freshness_window="$2"; shift 2 ;;
    --suite-state-file) suite_state_file="$2"; shift 2 ;;
    --fan-in) fan_in_task="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[ -d "${repo_root}/.git" ] || [ -f "${repo_root}/.git" ] || { echo "integration-batch-merge: not a git repo: ${repo_root}" >&2; exit 2; }

# ── FAN-IN MODE (gap-task-telemetry-6-percent-join) ─────────────────────────────────────────────
# Per-task fan-in merge: `task/<taskId>` → the CURRENT CHECKOUT's branch (fast-mode's $MERGE_TARGET;
# the inner's shared checkout sits on it), with the telemetry runId embedded in the commit subject:
#   merge: fan-in task/<id> (runId: fm-...)
# The runId sits at a FIXED, position-parseable location (the trailing `(runId: …)` group) so the
# two record sets — task landing records (git fan-in commits) and telemetry records (runIds) — become
# joinable on the runId (the 6% join rate was the defect: git 139 fan-in names vs telemetry 152
# taskIds, intersection 9). This mode is the MECHANICAL way to produce a runId-carrying fan-in; the
# batch-merge flow (develop/integration gates below) is untouched and remains the default.
if [ -n "${fan_in_task}" ]; then
  if [ -z "${run_id}" ]; then
    echo "integration-batch-merge: --fan-in requires --run-id <runId> (the runId from fast-mode-telemetry.ts --task-start)" >&2
    exit 2
  fi
  case "${run_id}" in
    *[!A-Za-z0-9._-]*) echo "integration-batch-merge: --run-id \"${run_id}\" is not filename-safe (must match [A-Za-z0-9._-]+, the telemetry runId shape)" >&2; exit 2 ;;
  esac
  if ! git -C "${repo_root}" rev-parse --verify --quiet "refs/heads/task/${fan_in_task}" >/dev/null; then
    echo "integration-batch-merge: fan-in failed — task branch task/${fan_in_task} not found" >&2
    exit 1
  fi
  # Merge into the checked-out branch (the merge target). --no-ff always creates a merge commit.
  if ! git -C "${repo_root}" merge --no-ff "task/${fan_in_task}" -m "merge: fan-in task/${fan_in_task} (runId: ${run_id})"; then
    git -C "${repo_root}" merge --abort >/dev/null 2>&1 || true
    echo "integration-batch-merge: fan-in FAILED — merge of task/${fan_in_task} aborted (conflict or error); nothing merged" >&2
    exit 1
  fi
  fan_in_sha="$(git -C "${repo_root}" rev-parse HEAD)"
  fan_in_target="$(git -C "${repo_root}" branch --show-current 2>/dev/null || echo "<detached>")"
  echo "integration-batch-merge: fan-in OK — task/${fan_in_task} merged into ${fan_in_target} (commit ${fan_in_sha}) with runId ${run_id}"
  echo "integration-batch-merge: measure fanin_runid_present=true"
  exit 0
fi

if ! git -C "${repo_root}" rev-parse --verify --quiet "refs/heads/${develop_ref}" >/dev/null; then
  echo "integration-batch-merge: develop ref not found: ${develop_ref}" >&2
  exit 2
fi
if ! git -C "${repo_root}" rev-parse --verify --quiet "refs/heads/${integration_ref}" >/dev/null; then
  echo "integration-batch-merge: integration ref not found: ${integration_ref}" >&2
  exit 2
fi

develop_tip="$(git -C "${repo_root}" rev-parse "refs/heads/${develop_ref}")"
integration_tip="$(git -C "${repo_root}" rev-parse "refs/heads/${integration_ref}")"

# ── MERGE-TO-VERIFIED-COMMIT (gap-merge-green-snapshot-verified-commit-livelock) ─────────────────────
# The full suite takes ~1847s (~31 min) while integration lands ~12 commits/round (median 147s/commit)
# — a green that only records `state == green` can NEVER catch integration HEAD (the COVERAGE axis
# fails closed forever = structural livelock). The fix: the green snapshot records the commit it
# VERIFIED (`verifiedCommit` — the integration tip at suite START, written by full-suite-runner.ts),
# and this script merges THAT commit instead of the moving integration HEAD. The merged point WAS
# tested → COVERAGE is satisfied by construction (AC4: no criterion loosened — the merged point is
# exactly the tested point). Backward compatible: a snapshot WITHOUT verifiedCommit falls back to the
# current behavior (merge integration HEAD). The `--integration <ref>` branch-name entry stays intact.
state_file="${suite_state_file:-${repo_root}/.quay/full-suite-state.json}"
verified_commit=""
merge_target=""
merge_uses_verified=0
if [ -f "${state_file}" ]; then
  verified_commit="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('verifiedCommit',''))" "${state_file}" 2>/dev/null || true)"
fi
if [ -n "${verified_commit}" ]; then
  # The verified commit must be a real commit AND lie on the integration line (an ancestor of
  # integration HEAD) — an orphaned/force-pushed-away commit is not a valid merge point.
  if git -C "${repo_root}" rev-parse --verify --quiet "${verified_commit}^{commit}" >/dev/null 2>&1 \
     && git -C "${repo_root}" merge-base --is-ancestor "${verified_commit}^{commit}" "refs/heads/${integration_ref}" >/dev/null 2>&1; then
    merge_target="$(git -C "${repo_root}" rev-parse "${verified_commit}^{commit}")"
    merge_uses_verified=1
  else
    echo "integration-batch-merge: verifiedCommit ${verified_commit} (from ${state_file}) is not a resolvable commit on ${integration_ref} — falling back to integration HEAD (COVERAGE will fail closed if that tip is untested)" >&2
  fi
fi
if [ -z "${merge_target}" ]; then
  merge_target="${integration_tip}"
fi
if [ "${merge_uses_verified}" -eq 1 ]; then
  echo "integration-batch-merge: MERGE-TO-VERIFIED-COMMIT — merging the verified commit ${merge_target} (the point the green suite tested) instead of integration HEAD ${integration_tip}"
fi

# ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

# Is a conflicted path a KNOWN SHARED file (develop-authoritative on conflict)?
is_shared_file() {
  local path="$1" p
  for p in "${shared_patterns[@]}"; do
    case "${path}" in
      ${p}) return 0 ;;
    esac
  done
  return 1
}

# Is a conflicted path a REVERSE-EDGE (integration-authoritative) file? Checked BEFORE shared_patterns —
# an explicit --integration-authoritative declaration overrides the develop-authoritative default.
is_integration_authoritative_file() {
  local path="$1" p
  for p in "${int_authoritative_patterns[@]}"; do
    case "${path}" in
      ${p}) return 0 ;;
    esac
  done
  return 1
}

# Run the content-criterion script against the INTEGRATION (theirs) side of a conflicted path.
# Interface: `bash <script> <path>` with the integration-side file content on stdin. Exit 0 = criterion
# satisfied (integration is authoritative → take theirs). Any non-zero = NOT satisfied — the reverse-edge
# candidate has NO mechanical basis to take integration, so it becomes a genuine conflict (fail-closed;
# never blind-choose either side).
criterion_satisfied() {
  local wt="$1" path="$2" content
  content="$(git -C "${wt}" show ":3:${path}" 2>/dev/null || true)"
  printf '%s\n' "${content}" | bash "${reverse_edge_criterion}" "${path}"
}

# Resolve one conflicted path to the develop side ("ours" — we merge integration INTO develop).
# Covers modify/modify, add/add, theirs-deleted (checkout --ours) and ours-deleted (git rm).
resolve_as_ours() {
  local wt="$1" path="$2"
  if git -C "${wt}" checkout --ours -- "${path}" >/dev/null 2>&1; then
    git -C "${wt}" add -- "${path}" >/dev/null 2>&1 || true
  else
    # ours (develop) DELETED the path — develop-authoritative = keep it deleted.
    git -C "${wt}" rm -q -- "${path}" >/dev/null 2>&1 || true
  fi
}

# Resolve one conflicted path to the integration side ("theirs" — the reverse edge). Reverse of
# resolve_as_ours: modify/modify and add/add take the integration version (checkout --theirs); a
# theirs-deleted case (ours modified, integration deleted) keeps it deleted (git rm).
resolve_as_theirs() {
  local wt="$1" path="$2"
  if git -C "${wt}" checkout --theirs -- "${path}" >/dev/null 2>&1; then
    git -C "${wt}" add -- "${path}" >/dev/null 2>&1 || true
  else
    # theirs (integration) DELETED the path — integration-authoritative = keep it deleted.
    git -C "${wt}" rm -q -- "${path}" >/dev/null 2>&1 || true
  fi
}

# Report the divergence surface (AC1): develop-only / integration-only counts + would-conflict files.
# Used by BOTH the dry-run report and the pre-merge report of the real path. Populates the global
# would_conflicts=() array with the would-conflict file list (empty = none / disjoint).
report_divergence() {
  local dev_only int_only mt_out mt_rc
  would_conflicts=()
  dev_only="$(git -C "${repo_root}" rev-list --count "refs/heads/${integration_ref}..refs/heads/${develop_ref}" 2>/dev/null || echo 0)"
  int_only="$(git -C "${repo_root}" rev-list --count "refs/heads/${develop_ref}..refs/heads/${integration_ref}" 2>/dev/null || echo 0)"
  echo "integration-batch-merge: DIVERGENCE — develop and integration have diverged (NOT a fast-forward)"
  echo "integration-batch-merge:   develop-only commits:     ${dev_only}"
  echo "integration-batch-merge:   integration-only commits: ${int_only}"
  # Would-conflict file list, computed WITHOUT touching refs via `git merge-tree` (exit 1 = conflicts).
  mt_out="$(git -C "${repo_root}" merge-tree --write-tree --name-only "refs/heads/${develop_ref}" "refs/heads/${integration_ref}" 2>/dev/null)"
  mt_rc=$?
  if [ "${mt_rc}" -eq 1 ]; then
    while IFS= read -r p; do
      [ -n "${p}" ] && would_conflicts+=("${p}")
    done < <(printf '%s\n' "${mt_out}" | tail -n +2 | sed '/^$/,$d')
  fi
  if [ "${#would_conflicts[@]}" -gt 0 ]; then
    echo "integration-batch-merge:   would-conflict files:"
    local p
    for p in "${would_conflicts[@]}"; do
      echo "integration-batch-merge:     ${p}"
    done
  else
    echo "integration-batch-merge:   would-conflict files: (none — changes are file-disjoint)"
  fi
}

# Report the conflict classification (shared / integration-authoritative / code) for the GIVEN path
# list (args). Shared = auto-resolve develop-authoritative; integration-authoritative = reverse-edge,
# auto-resolve to the INTEGRATION side (criterion-gated in --merge); code = fail-closed, needs human.
report_conflict_classification() {
  local -a shared int_auth code
  shared=()
  int_auth=()
  code=()
  local p
  for p in "$@"; do
    if is_integration_authoritative_file "${p}"; then int_auth+=("${p}")
    elif is_shared_file "${p}"; then shared+=("${p}")
    else code+=("${p}"); fi
  done
  echo "integration-batch-merge:   conflict classification:"
  echo "integration-batch-merge:     shared (auto-resolve develop-authoritative): ${#shared[@]}"
  for p in "${shared[@]}"; do
    echo "integration-batch-merge:       ${p}"
  done
  echo "integration-batch-merge:     integration-authoritative (reverse-edge, integration side): ${#int_auth[@]}"
  for p in "${int_auth[@]}"; do
    echo "integration-batch-merge:       ${p}"
  done
  echo "integration-batch-merge:     code (fail-closed, needs human):             ${#code[@]}"
  for p in "${code[@]}"; do
    echo "integration-batch-merge:       ${p}"
  done
}

# --sync: event-driven cross-machine push (gap-cross-machine-sync-has-no-mechanism-only-manual-pushes).
# The land closure just advanced <develop>; push it to origin IMMEDIATELY (same round, not next tick).
do_sync() {
  if [ "${sync}" -ne 1 ]; then
    return 0
  fi
  if [ -f "${SCRIPT_DIR}/sync-lag-check.sh" ]; then
    local sync_out sync_rc
    sync_out="$(bash "${SCRIPT_DIR}/sync-lag-check.sh" --root "${repo_root}" --branch "${develop_ref}" --remote origin --push 2>&1)"
    sync_rc=$?
    printf '%s\n' "${sync_out}"
    if [ "${sync_rc}" -ne 0 ]; then
      echo "integration-batch-merge: SYNC-PUSH FAILED (exit ${sync_rc}) — develop advanced locally but origin/${develop_ref} NOT updated; the every-tick heartbeat will retry (divergence = human resolution)" >&2
    else
      echo "integration-batch-merge: sync-push ok (develop → origin, same round as the land closure)"
    fi
  else
    echo "integration-batch-merge: --sync requested but sync-lag-check.sh not found at ${SCRIPT_DIR}/sync-lag-check.sh; skipping event-driven push (heartbeat will cover it)" >&2
  fi
  return 0
}

# --deliver: DIR-123 (人裁定 2026-08-11) — after the land closure advanced <develop>, deliver a FRESH
# hardware-independent quay .tgz to the verification machines B/C and prove it runs (quay serve → 200).
# This is the "auto-build after every merge to develop" mechanism: develop advances ONLY via this
# script, so the hook here is airtight. BEST-EFFORT BY DESIGN: a remote being down must never fail the
# merge — the deliver failure is logged + recorded in develop-deliver-state.json, and the outer tick
# retries when the state looks stale. Zero new secrets (local ~/.ssh/id_ed25519 reaches B/C already).
# The deliver is launched DETACHED (setsid) so it does NOT block the merge round — the build alone
# (package.sh: dist + sync-vendor + plugin-dist + npm pack) takes minutes.
do_deliver() {
  if [ "${deliver}" -ne 1 ]; then
    return 0
  fi
  if [ ! -f "${SCRIPT_DIR}/develop-deliver-tgz.sh" ]; then
    echo "integration-batch-merge: --deliver requested but develop-deliver-tgz.sh not found at ${SCRIPT_DIR}/develop-deliver-tgz.sh; skipping" >&2
    return 0
  fi
  local deliver_log="${repo_root}/.quay/deliver-run.log"
  echo "integration-batch-merge: launching detached develop-deliver-tgz.sh (log: ${deliver_log}) — does NOT block this merge"
  setsid bash "${SCRIPT_DIR}/develop-deliver-tgz.sh" --root "${repo_root}" >"${deliver_log}" 2>&1 < /dev/null &
  disown 2>/dev/null || true
  return 0
}

# ── --reconcile: primary-checkout guard + index refresh (gap-batch-merge-reconcile-destroys- ────────
# ── uncommitted-work) ────────────────────────────────────────────────────────────────────────────────
#
# The batch merge is REF-LEVEL (`git update-ref` with a CAS on the develop tip) and never touches the
# primary checkout's working tree. But when the primary checkout has <develop> checked out, moving the
# ref UNDER it leaves HEAD/index STALE: git status then shows the old-vs-new tree as staged changes.
# Callers historically invented a reconcile — the inner used `git reset --hard HEAD`, which OVERWROTE
# the working tree and DESTROYED an uncommitted manager edit (2026-08-08 08:08:24, real data loss).
# This script now provides the reconcile itself so callers don't invent it:
#
#   reconcile_guard()   porcelain-empty guard — runs BEFORE any ref moves. After the ref moves the
#                       stale index ITSELF shows up as porcelain entries, so it can no longer be told
#                       apart from real uncommitted work; the guard must therefore run while the index
#                       still matches the old HEAD. Non-empty porcelain ⇒ FAIL CLOSED (nothing moved,
#                       owners reported). No-op when the primary checkout is not on the advanced branch.
#   reconcile_index()   post-merge `git reset --mixed <new develop tip>` — refreshes the index to the
#                       new tip WITHOUT touching working-tree files. NEVER --hard (the one harmful
#                       extra action). Land lock serializes mutation ORDER; it does not prevent
#                       destruction — "I hold the lock" ≠ "safe to clobber the working tree".

# Is the primary checkout on the branch this run will advance (develop_ref)? Only then does a ref-level
# merge leave its HEAD/index stale and does the reconcile apply.
reconcile_applies() {
  local branch
  branch="$(git -C "${repo_root}" branch --show-current 2>/dev/null || true)"
  [ "${branch}" = "${develop_ref}" ]
}

# Fail-closed porcelain guard (run BEFORE the ref moves). Returns 1 on uncommitted/untracked work.
reconcile_guard() {
  local branch porcelain
  if ! reconcile_applies; then
    branch="$(git -C "${repo_root}" branch --show-current 2>/dev/null || echo "<detached>")"
    echo "integration-batch-merge: reconcile: primary checkout on '${branch}' (not '${develop_ref}') — index refresh not needed"
    return 0
  fi
  porcelain="$(git -C "${repo_root}" status --porcelain 2>/dev/null || true)"
  if [ -n "${porcelain}" ]; then
    echo "integration-batch-merge: reconcile FAIL-CLOSED — primary checkout has uncommitted/untracked changes; NOT moving any ref" >&2
    echo "integration-batch-merge:   primary checkout: ${repo_root}" >&2
    echo "integration-batch-merge:   branch: ${develop_ref}" >&2
    echo "integration-batch-merge:   porcelain (resolve these file owners before re-running --reconcile):" >&2
    printf '%s\n' "${porcelain}" | sed 's/^/integration-batch-merge:     /' >&2
    return 1
  fi
  echo "integration-batch-merge: reconcile: primary checkout clean (porcelain empty) — safe to proceed"
  return 0
}

# Post-merge index refresh: `git reset --mixed <new_tip>` — index only, never --hard.
reconcile_index() {
  local new_tip="$1" branch rc
  if ! reconcile_applies; then
    branch="$(git -C "${repo_root}" branch --show-current 2>/dev/null || echo "<detached>")"
    echo "integration-batch-merge: reconcile: primary checkout on '${branch}' (not '${develop_ref}') — index refresh not needed"
    return 0
  fi
  echo "integration-batch-merge: reconcile: git reset --mixed ${new_tip} (refresh index only; NEVER --hard; working-tree files untouched)"
  git -C "${repo_root}" reset --mixed "${new_tip}" >/dev/null 2>&1
  rc=$?
  if [ "${rc}" -ne 0 ]; then
    echo "integration-batch-merge: reconcile: git reset --mixed FAILED (exit ${rc}); index NOT refreshed — needs human" >&2
    return 1
  fi
  echo "integration-batch-merge: reconcile: index refreshed to develop tip ${new_tip}; working-tree files untouched"
  return 0
}

# ── OBJECT GATE (gap-batch-merge-gate-validates-tip-not-merge-result) ───────────────────────────────
# The suite tested the INTEGRATION TIP; the batch merge produces integration ⊕ develop (the MERGE
# RESULT). develop-only changes since the divergence point never entered the tested tree — if any are
# code files, the merge result would ship code that was never verified together with the integration
# content. This gate FAILS CLOSED (nothing moved) unless unmerged_develop_files = 0.
#
# The measure uses THREE-DOT semantics: `git diff --name-only <merge-base(integration,develop)> <develop>`
# isolates the develop-only surface. The raw two-dot `git diff integration develop` ALSO lists
# integration's OWN tested files (a file the suite verified would appear as differing) — a false
# positive this gate must avoid: the defect is develop-side untested code, not integration's tested code.
check_object_gate() {
  local mb code_files count
  # gap-merge-green-snapshot-verified-commit-livelock AC3 — the object gate validates the ACTUAL merge
  # result: `merge_target` (the VERIFIED commit when the green snapshot records one, else the
  # integration tip) ⊕ develop. The tested tree is merge_target — develop-only code files since it
  # diverged from merge_target are the ones that never entered the tested tree.
  mb="$(git -C "${repo_root}" merge-base "${merge_target}" "refs/heads/${develop_ref}" 2>/dev/null || true)"
  if [ -z "${mb}" ]; then
    echo "integration-batch-merge: object-gate: no merge-base between ${merge_target} and ${develop_ref} — unrelated histories, skipping gate (downstream will fail closed)" >&2
    echo "integration-batch-merge: measure unmerged_develop_files=0"
    return 0
  fi
  # develop-only changes since the divergence point (the surface the suite never saw).
  code_files="$(git -C "${repo_root}" diff --name-only "${mb}" "refs/heads/${develop_ref}" 2>/dev/null | grep -E '\.(ts|js|mjs|sh)$' || true)"
  if [ -z "${code_files}" ]; then
    echo "integration-batch-merge: measure unmerged_develop_files=0"
    return 0
  fi
  count="$(printf '%s\n' "${code_files}" | grep -c . || true)"
  echo "integration-batch-merge: measure unmerged_develop_files=${count}"
  echo "integration-batch-merge:   develop-side code files that never entered the tested tree (${merge_target}):"
  printf '%s\n' "${code_files}" | sed 's/^/integration-batch-merge:     /'
  if [ "${dry_run}" -eq 1 ]; then
    echo "integration-batch-merge: DRY-RUN — object gate WOULD fail closed (no ref moved in dry-run)"
    return 0
  fi
  echo "integration-batch-merge: OBJECT-GATE FAIL-CLOSED — the MERGE RESULT (${merge_target} ⊕ ${develop_ref}) would ship untested code; nothing moved" >&2
  if [ "${merge_uses_verified}" -eq 1 ]; then
    echo "integration-batch-merge:   tested tree = verified commit ${merge_target} (the point the green suite tested)" >&2
  else
    echo "integration-batch-merge:   tested tree = integration tip (${merge_target})" >&2
  fi
  echo "integration-batch-merge:   fix: fan-in the ${develop_ref}-side commit into ${integration_ref} (re-test the merged tree), then re-run" >&2
  return 1
}

# ── FRESHNESS GATE (gap-batch-merge-gate-reads-stale-green; gap-batch-merge-freshness-gate-ignores-scope) ──
# The batch merge may only proceed when the suite green is a FRESH green that actually verified the
# CURRENT integration tip. Root cause (7b1ac3a1, 2026-08-08): the gate read ONLY `state == green` and
# treated a 3-hour-old green — measuring a COMPLETELY DIFFERENT batch of commits — as a pass for THIS
# tree. Freshness has three dimensions:
#   1. SCOPE — the green must be MAIN-sourced (`scope == "main"`). The runner tags every state with
#      `scope: main|worktree` (gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1):
#      main = the authoritative signal subagents wait for; worktree = DEFERRABLE (its completion
#      "updates nothing anyone waits on"). A worktree green may have tested a completely different
#      tree (ANY linked worktree — another task's checkout); the OLD gate ignored scope entirely, so
#      an unverified tree could be merged into develop (gap-batch-merge-freshness-gate-ignores-scope).
#      scope ABSENT (legacy pre-scope state) ⇒ treat as main (fail-open, the runner's documented
#      legacy semantics). scope present but != main ⇒ fail-closed.
#   2. AGE — `finishedAt` within `--freshness-window` of now (default 3600s). An old green with NO new
#      fan-in is still stale: a 3-hour-old green did not test today's tree.
#   3. COVERAGE — the suite STARTED at/after the most recent integration fan-in (`git log -1 --format=%ct
#      <integration>`). A fan-in that landed after the suite ran means the green did NOT test the pending
#      content. (Started-at, not finished-at, is the coverage basis — a suite cannot have tested a fan-in
#      that landed after it started; startedAt is the runner's ISO marker, finishedAt is epoch.)
# Fail-closed conditions (all mean "no valid green" ⇒ nothing moved): state != green, scope present but
# != main, finishedAt missing/unparseable, age > window, suite started before the most recent fan-in,
# OR the state file is absent. This is the TIME/SOURCE-AXIS gate, complementary to the OBJECT gate's
# MERGE-RESULT axis (gap-batch-merge-gate-validates-tip-not-merge-result); both run before any ref moves.
# In --dry-run this reports the would-block measure without failing (mirrors check_object_gate).

# ── DOC-ONLY EXEMPTION (gap-batch-merge-freshness-gate-doc-only-exemption) ───────────────────────────
# The COVERAGE axis fails closed when a fan-in landed on integration after the suite started — the
# green did not test the pending tip. That cost is only justified when the pending content can CHANGE
# THE TEST SURFACE. Doc-only commits (.md/.jsonl — phase-goal/SPEC/task edits) cannot: they touch no
# code the suite exercises. The gate observed 3 consecutive doc-only blocks (rounds 153/157/158 —
# manager AC35 phase-goal → orchestration/manager-phase-goal.md; MILESTONE-NNN adjudication →
# orchestration/SPEC-goal-store.md; ongoing manager SPEC edits → orchestration/*.md), each a needless
# 17-min full-suite re-run. pending_is_doc_only() EXEMPTS the coverage axis when every file changed
# between the integration tip AS OF the suite start and the CURRENT integration tip is a .md/.jsonl;
# a pending change touching ANY other file type is NOT exempt — the coverage axis fails closed exactly
# as before (negative control, AC3).
#
# Returns 0 (exempt — the pending content is doc-only) or 1 (not exempt — a non-doc-only file is
# pending; the coverage axis must fail closed).
pending_is_doc_only() {
  local started_epoch="$1"
  local suite_tip="" changed non_doc
  # The integration tip AS OF the suite start — the tree the green actually measured.
  suite_tip="$(git -C "${repo_root}" rev-list -1 --before="${started_epoch}" "refs/heads/${integration_ref}" 2>/dev/null || true)"
  if [ -z "${suite_tip}" ]; then
    # No integration commit existed when the suite started — the WHOLE integration tip is pending.
    # Diff against the git empty tree (well-known all-zeros hash) so the exemption covers this
    # degenerate case instead of erroring.
    suite_tip="$(git -C "${repo_root}" hash-object -t tree /dev/null 2>/dev/null || true)"
  fi
  changed="$(git -C "${repo_root}" diff --name-only "${suite_tip}" "refs/heads/${integration_ref}" 2>/dev/null || true)"
  # No changed files — nothing pending, trivially doc-only (shouldn't reach here; the caller only
  # invokes the exemption when a fan-in landed after the suite start).
  [ -z "${changed}" ] && return 0
  # Any changed file that is NOT a .md/.jsonl ⇒ NOT doc-only ⇒ no exemption.
  non_doc="$(printf '%s\n' "${changed}" | grep -vE '\.(md|jsonl)$' || true)"
  [ -z "${non_doc}" ]
}

check_freshness_gate() {
  if [ "${skip_freshness_gate}" -eq 1 ]; then
    echo "integration-batch-merge: freshness-gate SKIPPED (--skip-freshness-gate)"
    return 0
  fi
  local state=""
  local parsed=""
  local finished_epoch="" started_epoch="" age=""
  local last_fanin="" verdict=""

  # Absent state file ⇒ no valid green ⇒ fail-closed (a missing file is NOT a pass — the 7b1ac3a1
  # "缺 state 同路径：不批量合" rule).
  if [ ! -f "${state_file}" ]; then
    verdict="suite-state file not found at ${state_file} (no valid green)"
    echo "integration-batch-merge: measure suite_freshness=unknown"
    if [ "${dry_run}" -eq 1 ]; then
      echo "integration-batch-merge: DRY-RUN — freshness gate WOULD fail closed: ${verdict} (no ref moved in dry-run)"
      return 0
    fi
    echo "integration-batch-merge: FRESHNESS-GATE FAIL-CLOSED — ${verdict}; nothing moved" >&2
    return 1
  fi

  state="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('state',''))" "${state_file}" 2>/dev/null || true)"
  if [ "${state}" != "green" ]; then
    verdict="suite-state state='${state:-<missing>}' (batch merge requires state==green)"
    echo "integration-batch-merge: measure suite_freshness=unknown"
    if [ "${dry_run}" -eq 1 ]; then
      echo "integration-batch-merge: DRY-RUN — freshness gate WOULD fail closed: ${verdict} (no ref moved in dry-run)"
      return 0
    fi
    echo "integration-batch-merge: FRESHNESS-GATE FAIL-CLOSED — ${verdict}; nothing moved" >&2
    return 1
  fi

  # SCOPE dimension (gap-batch-merge-freshness-gate-ignores-scope) — the green must be MAIN-sourced.
  # The runner tags every state `scope: main|worktree` (gap-worktree-scoped-runs-consume-resources-but-
  # produce-no-signal AC1): main = the authoritative signal the batch merge may trust; worktree =
  # DEFERRABLE — it may have tested a COMPLETELY DIFFERENT tree (ANY linked worktree), and the old gate
  # (state==green + time freshness only) would have accepted it, shipping unverified content into
  # develop. scope ABSENT (legacy pre-scope state) ⇒ treat as main (fail-open — the runner's documented
  # legacy semantics); scope present but != "main" (incl. unknown values) ⇒ fail-closed.
  local scope=""
  scope="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('scope',''))" "${state_file}" 2>/dev/null || true)"
  if [ -n "${scope}" ] && [ "${scope}" != "main" ]; then
    verdict="suite-state scope='${scope}' (batch merge requires a MAIN-sourced green — a worktree green is deferrable and may not have tested the merge target)"
    echo "integration-batch-merge: measure suite_freshness=unknown"
    if [ "${dry_run}" -eq 1 ]; then
      echo "integration-batch-merge: DRY-RUN — freshness gate WOULD fail closed: ${verdict} (no ref moved in dry-run)"
      return 0
    fi
    echo "integration-batch-merge: FRESHNESS-GATE FAIL-CLOSED — ${verdict}; nothing moved" >&2
    return 1
  fi

  # Parse finishedAt (epoch since the 2026-08-08 normalization; ISO for legacy states) and startedAt
  # (ISO) into epoch seconds; stdout = "<finished_epoch> <started_epoch> <age>".
  parsed="$(python3 -c "
import json,sys,time,datetime
try:
    d=json.load(open(sys.argv[1]))
except Exception:
    print('unparseable unparseable unparseable'); sys.exit(4)
f=d.get('finishedAt')
if f is None:
    print('missing missing missing'); sys.exit(2)
if isinstance(f,(int,float)):
    ts=float(f)
else:
    try:
        ts=datetime.datetime.fromisoformat(str(f).replace('Z','+00:00')).timestamp()
    except Exception:
        print('unparseable unparseable unparseable'); sys.exit(3)
s=d.get('startedAt')
if isinstance(s,(int,float)):
    st=float(s)
else:
    try:
        st=datetime.datetime.fromisoformat(str(s).replace('Z','+00:00')).timestamp() if s else ts
    except Exception:
        st=ts
print(int(ts), int(st), int(time.time()-ts))
" "${state_file}" 2>/dev/null || true)"
  # shellcheck disable=SC2086
  read -r finished_epoch started_epoch age <<<"${parsed}"

  if [ -z "${age}" ] || [ "${age}" = "missing" ] || [ "${age}" = "unparseable" ]; then
    verdict="suite-state finishedAt missing/unparseable (no valid green)"
    echo "integration-batch-merge: measure suite_freshness=unknown"
    if [ "${dry_run}" -eq 1 ]; then
      echo "integration-batch-merge: DRY-RUN — freshness gate WOULD fail closed: ${verdict} (no ref moved in dry-run)"
      return 0
    fi
    echo "integration-batch-merge: FRESHNESS-GATE FAIL-CLOSED — ${verdict}; nothing moved" >&2
    return 1
  fi

  # AGE dimension — the Contract measure (suite_freshness) is exactly this age in seconds.
  if [ "${age}" -gt "${freshness_window}" ]; then
    verdict="suite green finished ${age}s ago (> window ${freshness_window}s) — STALE"
    echo "integration-batch-merge: measure suite_freshness=${age}"
    if [ "${dry_run}" -eq 1 ]; then
      echo "integration-batch-merge: DRY-RUN — freshness gate WOULD fail closed: ${verdict} (no ref moved in dry-run)"
      return 0
    fi
    echo "integration-batch-merge: FRESHNESS-GATE FAIL-CLOSED — ${verdict}; nothing moved" >&2
    return 1
  fi

  # COVERAGE dimension — the suite must have STARTED at/after the commit this batch merge will
  # actually land. gap-merge-green-snapshot-verified-commit-livelock AC3/AC4: when the green snapshot
  # records a verifiedCommit, `merge_target` IS that commit (the point the suite VERIFIED) → COVERAGE
  # is satisfied by construction (the merged point WAS tested). Without verifiedCommit (legacy), the
  # coverage basis is the integration tip exactly as before — no criterion loosened.
  last_fanin="$(git -C "${repo_root}" log -1 --format=%ct "${merge_target}" 2>/dev/null || true)"
  if [ -n "${last_fanin}" ] && [ "${started_epoch}" -lt "${last_fanin}" ]; then
    # DOC-ONLY EXEMPTION (gap-batch-merge-freshness-gate-doc-only-exemption): a fan-in that landed
    # after the suite started means the green did not test the pending tip — UNLESS the pending
    # content is doc-only (.md/.jsonl). Doc-only commits (phase-goal/SPEC/task edits) cannot change
    # the test surface, so exempting them avoids a needless 17-min full-suite re-run on every SPEC
    # edit (rounds 153/157/158 — the observed doc-only blocks). A pending code file is NOT exempt.
    if pending_is_doc_only "${started_epoch}"; then
      echo "integration-batch-merge: freshness-gate DOC-ONLY EXEMPT — the fan-in(s) after the suite started touch only .md/.jsonl (doc-only); the green still covers the test surface — no re-run needed"
      echo "integration-batch-merge: measure suite_freshness=${age}"
      return 0
    fi
    verdict="a fan-in landed on ${integration_ref} after the suite started (last fan-in ${last_fanin}s epoch > suite start ${started_epoch}s) — the green did NOT test the pending merge point ${merge_target}"
    echo "integration-batch-merge: measure suite_freshness=${age}"
    if [ "${dry_run}" -eq 1 ]; then
      echo "integration-batch-merge: DRY-RUN — freshness gate WOULD fail closed: ${verdict} (no ref moved in dry-run)"
      return 0
    fi
    echo "integration-batch-merge: FRESHNESS-GATE FAIL-CLOSED — ${verdict}; nothing moved" >&2
    return 1
  fi

  echo "integration-batch-merge: freshness-gate OK — fresh green (finished ${age}s ago, window ${freshness_window}s; suite start ${started_epoch}s ≥ last fan-in ${last_fanin:-<none>} at merge point ${merge_target})"
  echo "integration-batch-merge: measure suite_freshness=${age}"
  return 0
}

# ── WORKTREE-GREEN GATE (gap-suite-fix-scope-worktree-green-merge-gate) ───────────────────────────────
# suite-fix subagent fan-in 前置断言：fan-in（批量合）前，`.quay/verification-round.jsonl` 必须存在
# ≥1 条 `scope=worktree` 且 `state=green` 的轮次记录，否则拒绝 merge——「不自测绿不许合」。
#
# 为什么需要这条门（manager 2026-08-10 09:4x 决定性读数 + outer 复核）：
#   第二个 suite-fix subagent（08:50 起）rounds 230/231 全部 `scope=main` —— 它没跑自己的轮次，它在等
#   共享检出的轮次。其 worktree HEAD = round-231 的 verifiedCommit，修复未提交。A15 ④ 三条保障同时失效
#   而条文每条「没被违反」：①修到绿才 merge 失效（它等的轮次测的是不含它修复的树）；②未绿退出⇒.halt 失效
#   （它不会未绿退出，.halt 触发条件结构上永不成立）；③不得修一个等 30min 失效（它正是这么做，只把顺序倒了）。
#   只有把 `scope` 字段读出来才看得见 —— 本门把该判据机械化。
#
# 不新建机件：数据已在 verification-round.jsonl（full-suite-runner.ts 已写 scope/state），只在消费者侧
# （本 fan-in 路径）加一个前置断言。scope 字段缺失（legacy 行）⇒ 无法判 ⇒ 拒。
# `--skip-worktree-green-gate` 是显式 opt-out（测试隔离其他门用）；真实 orchestrator/suite-fix 调用不传。
check_worktree_green_gate() {
  if [ "${skip_worktree_green_gate}" -eq 1 ]; then
    echo "integration-batch-merge: worktree-green-gate SKIPPED (--skip-worktree-green-gate)"
    return 0
  fi
  local round_file="${repo_root}/.quay/verification-round.jsonl"
  local has=""
  # measure: has_worktree_green_round — Contract measure exactly:
  #   python3 -c "import json;rs=[json.loads(l) for l in open('.quay/verification-round.jsonl') if l.strip()];
  #               print(any(r.get('scope')=='worktree' and r.get('state')=='green' for r in rs))"
  # stdout is Python True/False. Absent file = [] ⇒ False (fail-closed: no record ⇒ reject).
  has="$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        rs=[json.loads(l) for l in f if l.strip()]
except FileNotFoundError:
    rs=[]
print(any(r.get('scope')=='worktree' and r.get('state')=='green' for r in rs))
" "${round_file}" 2>/dev/null || echo "False")"
  if [ "${has}" = "True" ]; then
    echo "integration-batch-merge: worktree-green-gate OK — ≥1 scope=worktree+state=green round on record"
    echo "integration-batch-merge: measure has_worktree_green_round=True"
    return 0
  fi
  echo "integration-batch-merge: measure has_worktree_green_round=False"
  if [ "${dry_run}" -eq 1 ]; then
    echo "integration-batch-merge: DRY-RUN — worktree-green gate WOULD fail closed: no scope=worktree+state=green round in ${round_file} (no ref moved in dry-run)"
    return 0
  fi
  echo "integration-batch-merge: WORKTREE-GREEN-GATE FAIL-CLOSED — no scope=worktree+state=green round in ${round_file}; the suite-fix subagent never self-tested green in its OWN worktree ⇒ 不许 merge（不自测绿不许合）; nothing moved" >&2
  echo "integration-batch-merge:   fix: 先在自己 worktree 自测绿：node --test <文件> 或 scoped test.sh（bash scripts/test.sh --for-task <task-id> --allow-thin），得到 scope=worktree+state=green 记录后再 fan-in" >&2
  return 1
}

# Real merge of `integration` into `develop` (merge commit) in a throwaway temp worktree, then advance
# develop with a CAS on the old tip. Shared-file conflicts auto-resolve develop-authoritative; a real
# code conflict fails closed (nothing moved). Returns 0 on success, 1 on fail-closed.
real_merge() {
  local merge_commit
  tmp_wt="$(mktemp -d "${TMPDIR:-/tmp}/integration-batch-merge.XXXXXX")" || { echo "integration-batch-merge: mktemp failed" >&2; return 1; }

  cleanup() {
    # gap-suite-leaks-live-claude-sessions: 注销 worktree 前先停其会话 — a teardown that only removes
    # the dir leaks live claude sessions launched inside the worktree. Stop them first.
    stop_sessions_under_worktree "${tmp_wt}"
    git -C "${repo_root}" worktree remove --force "${tmp_wt}" >/dev/null 2>&1 || true
    rm -rf "${tmp_wt}" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  if ! git -C "${repo_root}" worktree add -q --detach "${tmp_wt}" "${develop_tip}" >/dev/null 2>&1; then
    echo "integration-batch-merge: real-merge failed — could not create temp worktree at ${tmp_wt}" >&2
    return 1
  fi

  # Merge the MERGE TARGET into develop (detached HEAD at develop_tip). --no-commit: we decide when
  # to commit, after classifying and (if safe) auto-resolving shared-file conflicts. gap-merge-green-
  # snapshot-verified-commit-livelock AC3: `merge_target` is the VERIFIED commit (the tested point)
  # when the green snapshot records one, else the integration tip (backward compatible).
  if ! git -C "${tmp_wt}" merge --no-ff --no-commit "${merge_target}" >/dev/null 2>&1; then
    local -a conflicts
    conflicts=()
    while IFS= read -r p; do
      [ -n "${p}" ] && conflicts+=("${p}")
    done < <(git -C "${tmp_wt}" diff --name-only --diff-filter=U)

    if [ "${#conflicts[@]}" -eq 0 ]; then
      echo "integration-batch-merge: real-merge aborted for a non-conflict reason (nothing moved)" >&2
      git -C "${tmp_wt}" merge --abort >/dev/null 2>&1 || true
      return 1
    fi

    # Classify the ACTUAL conflicts into three buckets: shared (develop-authoritative default),
    # reverse-edge (integration-authoritative — resolves to the INTEGRATION side), or code (fail-closed).
    shared_conflicts=()
    int_auth_conflicts=()
    code_conflicts=()
    local p
    for p in "${conflicts[@]}"; do
      if is_integration_authoritative_file "${p}"; then int_auth_conflicts+=("${p}")
      elif is_shared_file "${p}"; then shared_conflicts+=("${p}")
      else code_conflicts+=("${p}"); fi
    done

    # Gate reverse-edge candidates on the content criterion (when supplied): the integration side is
    # authoritative ONLY IF it satisfies the criterion. A candidate whose integration side FAILS the
    # criterion has no mechanical basis to be trusted → it becomes a genuine conflict (fail-closed,
    # never blind-choose either side — AC4 preserved even for declared reverse-edge files).
    if [ "${#int_auth_conflicts[@]}" -gt 0 ] && [ -n "${reverse_edge_criterion}" ]; then
      local -a still_int_auth
      still_int_auth=()
      for p in "${int_auth_conflicts[@]}"; do
        if criterion_satisfied "${tmp_wt}" "${p}"; then
          echo "integration-batch-merge:   content criterion satisfied for ${p} → integration-authoritative"
          still_int_auth+=("${p}")
        else
          echo "integration-batch-merge:   content criterion NOT satisfied for ${p} → genuine conflict (FAIL-CLOSED, needs a human)" >&2
          code_conflicts+=("${p}")
        fi
      done
      int_auth_conflicts=("${still_int_auth[@]}")
    fi

    if [ "${#code_conflicts[@]}" -gt 0 ]; then
      # AC3/AC4 load-bearing: a REAL (or criterion-rejected) conflict fails closed — never blind
      # --ours/--theirs, no ref moved.
      echo "integration-batch-merge: REAL-MERGE FAIL-CLOSED — code conflicts need a human; nothing moved" >&2
      echo "integration-batch-merge:   code conflict files:" >&2
      for p in "${code_conflicts[@]}"; do
        echo "integration-batch-merge:     ${p}" >&2
      done
      if [ "${#shared_conflicts[@]}" -gt 0 ]; then
        echo "integration-batch-merge:   (shared files would auto-resolve develop-authoritative, but code conflicts block):" >&2
        for p in "${shared_conflicts[@]}"; do
          echo "integration-batch-merge:     ${p}" >&2
        done
      fi
      if [ "${#int_auth_conflicts[@]}" -gt 0 ]; then
        echo "integration-batch-merge:   (reverse-edge files would resolve to the integration side, but code conflicts block):" >&2
        for p in "${int_auth_conflicts[@]}"; do
          echo "integration-batch-merge:     ${p}" >&2
        done
      fi
      git -C "${tmp_wt}" merge --abort >/dev/null 2>&1 || true
      return 1
    fi

    # Reverse-edge conflicts → auto-resolve integration-authoritative (integration side).
    if [ "${#int_auth_conflicts[@]}" -gt 0 ]; then
      echo "integration-batch-merge: resolving integration-authoritative conflicts (integration side, ${#int_auth_conflicts[@]}):"
      for p in "${int_auth_conflicts[@]}"; do
        echo "integration-batch-merge:   ${p}"
        resolve_as_theirs "${tmp_wt}" "${p}"
      done
    fi

    # Shared-file conflicts → auto-resolve develop-authoritative (AC2).
    if [ "${#shared_conflicts[@]}" -gt 0 ]; then
      echo "integration-batch-merge: auto-resolving shared-file conflicts develop-authoritative (${#shared_conflicts[@]}):"
      for p in "${shared_conflicts[@]}"; do
        echo "integration-batch-merge:   ${p}"
        resolve_as_ours "${tmp_wt}" "${p}"
      done
    fi
  fi

  # Commit the merge. Default: git's prepared MERGE_MSG from the --no-commit merge. With --run-id
  # (gap-task-telemetry-6-percent-join), embed the runId in the message so the fan-in merge's subject
  # carries it — the telemetry taskId → git branch traceability link fan-in-runid-check.ts reads.
  if [ -n "${run_id:-}" ]; then
    echo "integration-batch-merge: real-merge commit carries runId ${run_id}"
    if ! git -C "${tmp_wt}" commit -q -m "merge: fan-in ${integration_ref}→${develop_ref} (runId: ${run_id})"; then
      echo "integration-batch-merge: real-merge commit failed (nothing moved)" >&2
      git -C "${tmp_wt}" merge --abort >/dev/null 2>&1 || true
      return 1
    fi
    echo "integration-batch-merge: measure fanin_runid_present=true"
  else
    if ! git -C "${tmp_wt}" commit -q --no-edit; then
      echo "integration-batch-merge: real-merge commit failed (nothing moved)" >&2
      git -C "${tmp_wt}" merge --abort >/dev/null 2>&1 || true
      return 1
    fi
  fi
  merge_commit="$(git -C "${tmp_wt}" rev-parse HEAD)"

  # Advance develop with a CAS on the old tip (atomic; refuses if develop moved concurrently).
  if ! git -C "${repo_root}" update-ref "refs/heads/${develop_ref}" "${merge_commit}" "${develop_tip}"; then
    echo "integration-batch-merge: update-ref CAS failed — develop moved concurrently? Nothing changed." >&2
    return 1
  fi

  # POST-state measure: the MERGE TARGET (the verified commit / integration tip this merge actually
  # landed) must now be reachable from develop. When merging the VERIFIED commit while integration
  # HEAD has advanced beyond it, integration is intentionally NOT fully absorbed — the newer commits
  # were not tested and await the next green (reported, not a failure).
  if git -C "${repo_root}" merge-base --is-ancestor "${merge_target}" "refs/heads/${develop_ref}"; then
    echo "integration-batch-merge: OK — develop real-merged to ${merge_target} (merge commit ${merge_commit})"
    if [ "${merge_uses_verified}" -eq 1 ] && [ "${merge_target}" != "${integration_tip}" ]; then
      echo "integration-batch-merge:   integration HEAD ${integration_tip} still has newer untested commits — they await the next green (nothing silently dropped)"
      echo "integration-batch-merge: measure integration_ff_merges=1"
    else
      echo "integration-batch-merge: measure integration_ff_merges=0"
    fi
    do_sync
    do_deliver
    if [ "${reconcile}" -eq 1 ] && [ "${dry_run}" -eq 0 ]; then
      reconcile_index "${merge_commit}" || return 1
    fi
    return 0
  else
    echo "integration-batch-merge: post-measure FAILED — merge target ${merge_target} not ancestor of develop after real merge; needs human" >&2
    return 1
  fi
}

# ── main flow ───────────────────────────────────────────────────────────────────────────────────────

# Nothing pending? The MERGE TARGET (the verified commit when the green snapshot records one, else the
# integration tip) is already absorbed into develop ⇒ measure=0, no-op.
if git -C "${repo_root}" merge-base --is-ancestor "${merge_target}" "refs/heads/${develop_ref}"; then
  if [ "${dry_run}" -eq 1 ]; then
    echo "integration-batch-merge: DRY-RUN (no ref moved)"
    echo "integration-batch-merge: develop=${develop_tip} integration=${integration_tip}"
  fi
  if [ "${merge_uses_verified}" -eq 1 ] && [ "${merge_target}" != "${integration_tip}" ]; then
    echo "integration-batch-merge: OK — verified commit ${merge_target} is already an ancestor of develop (the tested point is merged; integration HEAD ${integration_tip} has newer untested commits that await the next green)"
  else
    echo "integration-batch-merge: OK — integration is already an ancestor of develop (nothing pending)"
  fi
  echo "integration-batch-merge: measure integration_ff_merges=0"
  exit 0
fi

# ── OBJECT GATE (gap-batch-merge-gate-validates-tip-not-merge-result) ────────────────────────────────
# Validate the MERGE RESULT, not just the integration tip, BEFORE any ref moves. The suite tested the
# merge target; the merge produces merge_target ⊕ develop. develop-side code files that never entered
# the tested tree ⇒ the merge result would ship untested code ⇒ fail closed (nothing moved). In
# --dry-run this reports the would-block measure without failing.
check_object_gate || exit 1

# ── FRESHNESS GATE (gap-batch-merge-gate-reads-stale-green) ─────────────────────────────────────────
# The batch merge may only proceed when the suite green is a FRESH green (finishedAt within the window
# AND the suite started at/after the commit this merge will land — the MERGE TARGET). gap-merge-green-
# snapshot-verified-commit-livelock AC3/AC4: with a recorded verifiedCommit the merge target IS the
# tested point, so COVERAGE passes by construction; without it the target is the integration tip exactly
# as before (no criterion loosened). This is the TIME-AXIS gate, run before any ref moves. In --dry-run
# this reports the would-block measure without failing.
check_freshness_gate || exit 1

# ── WORKTREE-GREEN GATE (gap-suite-fix-scope-worktree-green-merge-gate) ───────────────────────────────
# suite-fix subagent fan-in 前置断言：fan-in（批量合）前，verification-round.jsonl 必须存在 ≥1 条
# `scope=worktree` 且 `state=green` 的轮次记录（不自测绿不许合）。这是消费者侧（本 fan-in 路径）的门，
# 数据已由 full-suite-runner.ts 写入，不新建机件。--dry-run 报 would-block 不失败（与其他门一致）。
check_worktree_green_gate || exit 1

# ── --reconcile: porcelain-empty guard BEFORE any ref moves ──────────────────────────────────────────
# The guard must run while the index still matches the old HEAD — after the ref moves, the stale index
# shows up as porcelain entries and can no longer be told apart from real uncommitted work.
if [ "${reconcile}" -eq 1 ]; then
  if [ "${dry_run}" -eq 1 ]; then
    if reconcile_applies; then
      porcelain="$(git -C "${repo_root}" status --porcelain 2>/dev/null || true)"
      echo "integration-batch-merge: DRY-RUN --reconcile: primary checkout (on ${develop_ref}) porcelain would-be-empty: $([ -z "${porcelain}" ] && echo yes || echo NO)"
      [ -z "${porcelain}" ] && echo "integration-batch-merge: DRY-RUN --reconcile: guard would PASS; post-merge reconcile = git reset --mixed <new develop tip> (index only)"
    else
      echo "integration-batch-merge: DRY-RUN --reconcile: primary checkout not on ${develop_ref} — reconcile not needed"
    fi
  else
    reconcile_guard || exit 1
  fi
fi

# PRE-state: is develop an ancestor of the MERGE TARGET (the verified commit / integration tip)?
if git -C "${repo_root}" merge-base --is-ancestor "refs/heads/${develop_ref}" "${merge_target}"; then
  ff_possible=1
else
  ff_possible=0
fi

# What this batch merge would land: develop..merge_target (the invoke surface). When merging the
# VERIFIED commit while integration HEAD has advanced beyond it, the newer untested commits stay on
# integration — reported (deferred), never silently dropped.
pending="$(git -C "${repo_root}" log --oneline "refs/heads/${develop_ref}..${merge_target}" 2>/dev/null || true)"
deferred="$(git -C "${repo_root}" log --oneline "${merge_target}..refs/heads/${integration_ref}" 2>/dev/null || true)"

if [ "${dry_run}" -eq 1 ]; then
  echo "integration-batch-merge: DRY-RUN (no ref moved)"
  echo "integration-batch-merge: develop=${develop_tip} integration=${integration_tip}"
  if [ "${ff_possible}" -eq 1 ]; then
    echo "integration-batch-merge: FF-OK — ${develop_ref} is an ancestor of the merge target ${merge_target}"
    echo "integration-batch-merge: pending on integration:"
    echo "integration-batch-merge:   (merge surface ${develop_ref}..${merge_target})"
    printf '%s\n' "${pending}" | sed 's/^/    /'
    if [ "${merge_uses_verified}" -eq 1 ] && [ -n "${deferred}" ]; then
      deferred_count="$(printf '%s\n' "${deferred}" | grep -c . || true)"
      echo "integration-batch-merge:   (${deferred_count} newer untested commit(s) on integration HEAD ${integration_tip} deferred to the next green — the verified commit is what the suite tested)"
    fi
  else
    report_divergence
    if [ "${merge_mode}" -eq 1 ]; then
      report_conflict_classification "${would_conflicts[@]}"
    fi
    echo "integration-batch-merge: NOT-FAST-FORWARD — the merge target ${merge_target} is not a descendant of develop; needs a human (pass --merge to real-merge auto-resolving shared files develop-authoritative and reverse-edge files integration-authoritative)" >&2
    exit 1
  fi
  # Post-state measure (would-be): `git merge-base --is-ancestor <merge_target> <develop>`.
  if git -C "${repo_root}" merge-base --is-ancestor "${merge_target}" "refs/heads/${develop_ref}"; then
    echo "integration-batch-merge: measure integration_ff_merges=0 (post: merge target ${merge_target} is ancestor of develop)"
  else
    echo "integration-batch-merge: measure integration_ff_merges=1 (post: merge target NOT yet ancestor — merge pending)"
  fi
  exit 0
fi

if [ "${ff_possible}" -eq 1 ]; then
  # Perform the ref-level fast-forward with a CAS on the old develop tip (atomic; refuses if develop
  # moved concurrently — never a blind force-overwrite). gap-merge-green-snapshot-verified-commit-
  # livelock AC3: develop advances to the MERGE TARGET (the verified commit), not the moving HEAD.
  if ! git -C "${repo_root}" update-ref "refs/heads/${develop_ref}" "${merge_target}" "${develop_tip}"; then
    echo "integration-batch-merge: update-ref CAS failed — develop moved concurrently? Nothing changed." >&2
    exit 1
  fi

  # POST-state measure: the merge target must now be reachable from develop.
  if git -C "${repo_root}" merge-base --is-ancestor "${merge_target}" "refs/heads/${develop_ref}"; then
    if [ "${merge_uses_verified}" -eq 1 ] && [ "${merge_target}" != "${integration_tip}" ]; then
      echo "integration-batch-merge: OK — develop fast-forwarded to the VERIFIED commit ${merge_target} (the point the green suite tested)"
      echo "integration-batch-merge:   integration HEAD ${integration_tip} still has newer untested commits — they await the next green (nothing silently dropped)"
      echo "integration-batch-merge: measure integration_ff_merges=1"
    else
      echo "integration-batch-merge: OK — develop fast-forwarded to integration"
      echo "integration-batch-merge: measure integration_ff_merges=0"
    fi
    echo "integration-batch-merge: develop=${merge_target}"
    do_sync
    do_deliver
    if [ "${reconcile}" -eq 1 ] && [ "${dry_run}" -eq 0 ]; then
      reconcile_index "${merge_target}" || exit 1
    fi
  else
    echo "integration-batch-merge: post-measure FAILED — merge target ${merge_target} not ancestor of develop after ff; needs human" >&2
    exit 1
  fi
  exit 0
fi

# NOT a fast-forward (true divergence) — the pre-merge report, then either fail closed (default) or
# real-merge (--merge).
report_divergence
if [ "${merge_mode}" -eq 0 ]; then
  echo "integration-batch-merge: NOT-FAST-FORWARD — integration is not a descendant of develop; needs a human (pass --merge to real-merge auto-resolving shared files develop-authoritative and reverse-edge files integration-authoritative)" >&2
  exit 1
fi

real_merge
exit $?
