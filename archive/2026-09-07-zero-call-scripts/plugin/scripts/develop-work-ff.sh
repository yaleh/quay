#!/usr/bin/env bash
# develop-work-ff.sh — doc-only 工作分支 → develop 的纯 ref 更新（gap-fan-in-ff-ref-update-detach-develop）。
#
# The main checkout sits on a doc-only work branch (manager/outer's .md edits), and develop is
# DETACHED from any checkout. This script lands the work branch back onto develop with a pure ref
# update (git push . — no working tree touched), gated by a MECHANICAL doc-only enforcement (AC2):
# the work branch's own delta (three-dot `develop...<branch>`) is classified by the computed
# `--classify-delta` classifier (parses scripts/test.sh's @static-object annotations, ⛔ no hand-written
# path table); a non-empty (code) delta ⇒ REFUSE (exit 2). This is the 承重墙 (人明确附加): the doc-only
# work branch may never carry code — if it did, its own landing onto develop would need a full suite,
# relocating every problem unchanged. Reusing --classify-delta makes that a mechanism, not a habit.
#
# Exit codes:
#   0  ref update performed (develop fast-forwarded to the work branch)
#   1  non-fast-forward (develop advanced since the work branch forked — merge develop in and retry)
#   2  usage / environment error (missing branch, merge target still checked out, code delta, classifier
#      failure — NOT a retryable condition)
#
# Usage:
#   develop-work-ff.sh --branch <work-branch> [--merge-target <branch>] [--root <repo>] [--help]
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

# ── arg parse ─────────────────────────────────────────────────────────────────────────────────────────
branch=""
merge_target="develop"
root=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch) branch="$2"; shift 2 ;;
    --merge-target) merge_target="$2"; shift 2 ;;
    --root) root="$2"; shift 2 ;;
    *) echo "develop-work-ff: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "${branch}" ] || { echo "develop-work-ff: --branch <work-branch> is required" >&2; exit 2; }

# ── repo resolution ────────────────────────────────────────────────────────────────────────────────────
if [ -z "${root}" ]; then
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi
if [ ! -d "${root}/.git" ] && [ ! -f "${root}/.git" ]; then
  echo "develop-work-ff: not a git repo: ${root}" >&2
  exit 2
fi

# Both refs must exist (⛔ the ref update would otherwise CREATE the merge target — a push to a missing
# ref is a branch creation, not a fast-forward).
if ! git -C "${root}" rev-parse --verify --quiet "refs/heads/${branch}" >/dev/null 2>&1; then
  echo "develop-work-ff: work branch '${branch}' not found in ${root}" >&2
  exit 2
fi
if ! git -C "${root}" rev-parse --verify --quiet "refs/heads/${merge_target}" >/dev/null 2>&1; then
  echo "develop-work-ff: merge target '${merge_target}' not found in ${root}" >&2
  exit 2
fi

# The merge target must be DETACHED from the main checkout (receive.denyCurrentBranch refuses a push to
# the current branch) — the main checkout sits on the work branch instead.
current="$(git -C "${root}" branch --show-current 2>/dev/null || true)"
if [ "${current}" = "${merge_target}" ]; then
  echo "develop-work-ff: merge target '${merge_target}' is still checked out in ${root} — the ref update (git push .) requires it to be detached (the doc-only work branch occupies the main checkout)" >&2
  exit 2
fi

# ── doc-only enforcement (AC2 承重墙): the work branch's OWN delta must classify as doc-only ───────────
# The delta is the THREE-DOT `develop...<branch>` = the work branch's own commits since it forked from
# develop (⛔ not develop's own advances — those are code landed by task fan-ins and must NOT be judged
# here). The classifier is the ONE computed classifier (select-static-checks-for-touches.ts
# --classify-delta, parses scripts/test.sh @static-object annotations; no hand-written path table).
classify_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/select-static-checks-for-touches.ts"
classify_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
delta="$(git -C "${root}" diff --name-only "${merge_target}...${branch}" 2>/dev/null || true)"
if [ -n "${delta}" ]; then
  # shellcheck disable=SC2086
  code_delta="$(node --experimental-strip-types "${classify_script}" --classify-delta --root "${classify_root}" ${delta} 2>/dev/null)" || code_delta="__CLASSIFY_FAILED__"
  if [ "${code_delta}" = "__CLASSIFY_FAILED__" ]; then
    echo "develop-work-ff: --classify-delta failed (fail-closed) — 判不出 ≠ 不需要 (硬规则 3b); refusing to land the work branch" >&2
    exit 2
  fi
  if [ -n "${code_delta}" ]; then
    echo "develop-work-ff: work branch '${branch}' carries CODE changes — doc-only 机械强制拒绝 (AC2):" >&2
    printf '%s\n' "${code_delta}" | sed 's/^/develop-work-ff:   /' >&2
    exit 2
  fi
fi

# ── the ref update (no working tree touched) ──────────────────────────────────────────────────────────
develop_head_before="$(git -C "${root}" rev-parse "${merge_target}" 2>/dev/null || echo "unresolvable")"
if ! merge_out="$(git -C "${root}" push . "refs/heads/${branch}:refs/heads/${merge_target}" 2>&1)"; then
  echo "develop-work-ff: non-fast-forward — ${merge_target} advanced since '${branch}' forked; merge ${merge_target} into ${branch} and retry" >&2
  echo "develop-work-ff: $(printf '%s\n' "${merge_out}" | head -n1)" >&2
  exit 1
fi

post_head="$(git -C "${root}" rev-parse "${merge_target}" 2>/dev/null || echo "unresolvable")"
branch_tip="$(git -C "${root}" rev-parse "refs/heads/${branch}" 2>/dev/null || echo "unresolvable")"
if [ "${post_head}" != "${branch_tip}" ]; then
  echo "develop-work-ff: post-check FAILED — ${merge_target} is at ${post_head}, expected ${branch} tip ${branch_tip}; needs human" >&2
  exit 1
fi
echo "develop-work-ff: OK — ${merge_target} fast-forwarded to ${branch} (${post_head}) [before ${develop_head_before}]"
exit 0
