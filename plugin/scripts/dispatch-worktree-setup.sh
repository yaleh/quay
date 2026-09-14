#!/usr/bin/env bash
# dispatch-worktree-setup.sh — make a freshly-created TASK worktree self-verifying.
# (tasks/gap-worktree-node-modules-inconsistent-self-verify: whether a dispatched worktree can
#  self-verify was AGENT-REMEMBERING, not mechanism — the tasklist agent created the node_modules
#  symlink and could self-verify, the tokenwait agent didn't and fell back to the shared checkout,
#  where mutations land. This script is the MECHANISM: every dispatched worktree gets node_modules
#  + config.yml, so `scripts/test.sh` in the worktree never depends on the agent remembering.)
#
# WHAT IT DOES (the enumerated set):
#   0. branch self-check — the worktree's branch must be task/<id> (gap-task-branch-prefix-
#      assumption-scattered-read-sites-orphan-enumeration-blind). A non-task branch (the
#      2026-09-08 `develop` reuse that landed commits on develop bypassing fan-in) is refused
#      (exit 2). Plain-dir / non-git / detached-HEAD worktrees have no determinable branch ⇒ skip.
#   1. node_modules — the build phase of scripts/test.sh FAILS CLOSED without esbuild
#      ("Cannot find package esbuild", refusing to test a possibly-stale bundle — that
#      fail-closed is CORRECT and deliberately left untouched). Make node_modules present:
#        a. symlink <main>/node_modules → <worktree>/node_modules when the main checkout has
#           node_modules (zero-copy, shared installed deps — the tasklist precedent);
#        b. FALL BACK to `npm install` INSIDE the worktree when the main checkout has NO
#           node_modules (bare clone).  (AC1: both paths are tested.)
#   2. config.yml — delegates to the EXISTING scripts/worktree-include.sh (declarative
#      .worktreeinclude copy: .quay/config.yml + plugin/vendor dist), the same step
#      provision-verify-worktree.sh composes. A worktree without .quay/config.yml cannot resolve
#      the workspace root (round-5's "Cannot find repo root" crash family). The copy POST-CONDITIONS
#      ITSELF FROM DISK (worktree-include.sh reads back that every declared file is present before
#      it exits 0), so this script's exit 0 is a claim about ${worktree}'s contents; on failure it
#      runs `worktree-include.sh --verify` to NAME the absent files instead of printing a bare
#      "failed" that is indistinguishable from half-success
#      (gap-worktree-include-pipefail-sigpipe-141-blocks-fresh-worktree-provisioning).
#
# DELIBERATELY NOT DONE:
#   - No independent `npm install` per worktree when the main has node_modules (copying the
#     shared node_modules is waste — the task body's explicit "不做").
#   - No dist build / --teardown: provision-verify-worktree.sh owns the verify-worktree lifecycle
#     (incl. --teardown process reclaim). This script is the DISPATCH step only; scripts/test.sh's
#     build_dist_once builds dist when node_modules is present.
#
# Idempotent: re-running on a provisioned worktree is a no-op (existing node_modules kept;
# worktree-include re-copies overwriting). Exit 0 = provisioned / already-provisioned;
# 2 = usage/env error (missing worktree arg, missing install product, non-repo worktree),
#     OR incomplete provisioning (a declared file is absent — step 2 is verified, not assumed).
# ⛔ "step 1 succeeded" is never reported as success: exit 0 requires the declared files to be
#    on disk in the worktree, checked by worktree-include.sh --verify.
#
# Usage:
#   bash plugin/scripts/dispatch-worktree-setup.sh <worktree-path> [--root <main-repo>] [--dry-run]
#
#   <worktree-path>  the task worktree to provision (REQUIRED, positional first arg)
#   --root <main>    the main checkout (default: order-independent `git rev-parse
#                    --git-common-dir` via repo-root.sh mainCheckoutRoot, or this script's own
#                    repo root)
#   --dry-run        print what would be done, change nothing
#   --help           usage, exit 0
#
# Exit codes: 0 = provisioned (or already-provisioned); 2 = usage/env error (incl. non-task branch).
#
# Tests: plugin/test/dispatch-worktree-setup.test.mjs (@test-group engine).

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "dispatch-worktree-setup.sh — make a freshly-created task worktree self-verifying (node_modules symlink-or-install + config.yml via worktree-include.sh)"
  echo "usage: bash plugin/scripts/dispatch-worktree-setup.sh <worktree-path> [--root <main-repo>] [--dry-run]"
  exit 0
fi

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

worktree=""
root=""
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) root="${2:-}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) echo "usage: bash plugin/scripts/dispatch-worktree-setup.sh <worktree-path> [--root <main-repo>] [--dry-run]"; exit 0 ;;
    --*) echo "dispatch-worktree-setup: unknown arg: $1" >&2; exit 2 ;;
    *) [ -z "${worktree}" ] && worktree="$1" || { echo "dispatch-worktree-setup: unexpected extra arg: $1" >&2; exit 2; }; shift ;;
  esac
done

[ -n "${worktree}" ] || { echo "dispatch-worktree-setup: worktree path is required" >&2; exit 2; }
[ -d "${worktree}" ] || { echo "dispatch-worktree-setup: worktree dir not found: ${worktree}" >&2; exit 2; }

# ── resolve the main checkout ────────────────────────────────────────────────────────────────
# --root override wins (hermetic tests pass a throwaway main). Otherwise derive ORDER-INDEPENDENTLY
# via repo-root.sh's mainCheckoutRoot: the main checkout is the parent of the repo's shared `.git`
# dir (`git rev-parse --git-common-dir`), NOT the first `git worktree list --porcelain` entry — that
# list's order does NOT guarantee the main working tree first. Fall back to this script's own repo
# root (SCRIPT_DIR/../..) when the worktree is not a registered git worktree (plain-dir fixtures).
. "${SCRIPT_DIR}/repo-root.sh"
if [ -z "${root}" ]; then
  root="$(mainCheckoutRoot "${worktree}")"
fi
[ -n "${root}" ] || root="$(cd "${SCRIPT_DIR}/../.." && pwd)"
[ -d "${root}" ] || { echo "dispatch-worktree-setup: main repo dir not found: ${root}" >&2; exit 2; }

# ── 0. branch self-check (gap-task-branch-prefix-assumption-scattered-read-sites-orphan-enumeration-blind) ──
# 写方唯一化并强制：任务 worktree 的分支必须是 task/<id>。worker 派发 prompt 里的自由 `git worktree add`
# （无 -b / 复用既有分支）会造出非 task/ 前缀分支——2026-09-08 实测一个 worker 把 worktree 建在 develop
# 分支上，其提交会直接落 develop 绕过 fan-in。这里 fail-closed：能读出分支但不是 task/* ⇒ 拒（exit 2），
# ⛔ 不得静默接受。读不出分支（plain-dir 测试夹具 / 非 git worktree / detached HEAD）⇒ 跳过——没有分支
# 可误判（node_modules 自验证语义对 plain dir 仍成立，现有测试依赖此 lenient 行为）。
branch="$(git -C "${worktree}" symbolic-ref --short HEAD 2>/dev/null || true)"
if [ -n "${branch}" ]; then
  case "${branch}" in
    task/*) ;;
    *)
      echo "dispatch-worktree-setup: worktree branch '${branch}' is not task/<id> — refusing to provision (a non-task branch would land commits on ${branch} bypassing fan-in)" >&2
      exit 2
      ;;
  esac
fi

# ── 1. node_modules (AC1: symlink path AND install path) ─────────────────────────────────────
if [ -e "${worktree}/node_modules" ] || [ -L "${worktree}/node_modules" ]; then
  echo "dispatch-worktree-setup: node_modules already present, keeping: ${worktree}/node_modules"
elif [ -d "${root}/node_modules" ]; then
  # Symlink path: main has node_modules → zero-copy shared-deps link (the tasklist precedent).
  if [ "${dry_run}" -eq 1 ]; then
    echo "dispatch-worktree-setup: [dry-run] would link ${root}/node_modules -> ${worktree}/node_modules"
  else
    ln -s "${root}/node_modules" "${worktree}/node_modules"
    echo "dispatch-worktree-setup: linked ${root}/node_modules -> ${worktree}/node_modules"
  fi
else
  # Install path: main has NO node_modules (bare clone) → npm install INSIDE the worktree.
  if [ "${dry_run}" -eq 1 ]; then
    echo "dispatch-worktree-setup: [dry-run] would npm install in ${worktree} (main has no node_modules)"
  else
    echo "dispatch-worktree-setup: main ${root} has no node_modules — npm install in ${worktree}..."
    (cd "${worktree}" && npm install) || { echo "dispatch-worktree-setup: npm install failed" >&2; exit 2; }
    [ -d "${worktree}/node_modules" ] \
      || { echo "dispatch-worktree-setup: npm install did not produce ${worktree}/node_modules" >&2; exit 2; }
    echo "dispatch-worktree-setup: npm install done — ${worktree}/node_modules"
  fi
fi

# ── 2. config.yml (delegated to the EXISTING declarative worktree-include.sh) ─────────────────
# The failure face is deliberately NOT a bare one-line "failed": a bare message is indistinguishable
# from HALF success — step 1 (node_modules) has already been linked, so a worktree reported as
# "failed" while missing every declared file looks exactly like one reported as "failed" for a
# harmless reason (hard rule 3b). Two mechanical properties instead:
#   (a) a copy step that exits 0 without landing the files is caught by the verifier post-condition;
#   (b) every failure path names the declared files that are actually ABSENT.
# "Absent" is judged by the verifier reading the declaration (worktree-include.sh --verify), never
# by trusting the copy step's own exit code or message.
WI="${root}/scripts/worktree-include.sh"
verify_output=""
verify_rc=0
if [ ! -f "${WI}" ]; then
  # No include script. Harmless ONLY when nothing is declared — a repo whose .worktreeinclude names
  # files has no way to place them, and pretending otherwise is the same half-success shape.
  if [ -f "${worktree}/.worktreeinclude" ] || [ -f "${root}/.worktreeinclude" ]; then
    echo "dispatch-worktree-setup: ${WI} not found, but .worktreeinclude declares gitignored files — cannot provision ${worktree} (it will lack .quay/config.yml / vendor dist)" >&2
    exit 2
  fi
  echo "dispatch-worktree-setup: WARNING no worktree-include.sh at ${WI} and no .worktreeinclude — nothing declared, nothing copied" >&2
elif [ "${dry_run}" -eq 1 ]; then
  echo "dispatch-worktree-setup: [dry-run] would run worktree-include.sh ${worktree} (config.yml + vendor dist)"
else
  # `cmd` then `rc=$?` on its OWN line (no `||`): this script runs under `set -uo pipefail` without
  # `-e`, so a failing command simply continues — and it keeps the `$?` read clean of any `|`
  # (instrument-failure-check FAMILY-3 reads a `$?` that follows a `|` as a pipeline-status read).
  bash "${WI}" "${worktree}"
  copy_rc=$?
  if [ "${copy_rc}" -ne 0 ]; then
    # Enumerate what is actually absent. Exit 1 = the verifier evaluated the declaration and lists
    # the absent files; exit 2 = it could not evaluate at all (unresolvable primary, unsupported
    # --verify). The two are reported differently — "could not check" must never print the same
    # shape as a file list, and never the same shape as "checked, all fine" (hard rule 3b).
    verify_output=""
    verify_output="$(bash "${WI}" --verify "${worktree}" 2>&1)"
    verify_rc=$?
    echo "dispatch-worktree-setup: provisioning INCOMPLETE for ${worktree} — copy exited ${copy_rc}, verify exited ${verify_rc}" >&2
    if [ "${verify_rc}" -eq 1 ]; then
      echo "dispatch-worktree-setup: declared files ABSENT from ${worktree}:" >&2
    else
      echo "dispatch-worktree-setup: the verifier could not evaluate the declaration (this is not a file list):" >&2
    fi
    printf '%s\n' "${verify_output}" >&2
    exit 2
  fi
  # copy_rc = 0 already means the declared files are ON DISK: worktree-include.sh reads its own
  # result back from the worktree before exiting 0 (see its header). No second matcher pass here —
  # a post-condition that re-derives the whole declaration would double the cost of every dispatch.
fi

exit 0
