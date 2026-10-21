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
#   0b. fork-point self-check (AC-284 / GOAL-023) — the branch must have been CUT FROM `develop`,
#      not from the release/default line (master). The branch-name check above cannot see this:
#      `git worktree add -b task/<id> <path>` with no start point silently forks from whatever the
#      invoking HEAD is, and the guard used to wave that through. Three-valued, never boolean:
#      PASS / REFUSED(exit 2) / NOT-EVALUATED(independent value, does not block). See the block
#      comment at the check itself for the empirical readings that fix its shape.
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
# worktree-include re-copies overwriting; step 0b re-reads the SAME creation record, so a
# re-provision is judged exactly as the first run was). Exit 0 = provisioned / already-provisioned;
# 2 = usage/env error (missing worktree arg, missing install product, non-repo worktree),
#     OR incomplete provisioning (a declared file is absent — step 2 is verified, not assumed),
#     OR step 0b REFUSED (the branch was cut from the release/default line, not from the base).
# ⛔ "step 1 succeeded" is never reported as success: exit 0 requires the declared files to be
#    on disk in the worktree, checked by worktree-include.sh --verify.
#
# Usage:
#   bash plugin/scripts/dispatch-worktree-setup.sh <worktree-path> [--root <main-repo>]
#                                                    [--base <ref>] [--dry-run]
#
#   <worktree-path>  the task worktree to provision (REQUIRED, positional first arg)
#   --root <main>    the main checkout (default: order-independent `git rev-parse
#                    --git-common-dir` via repo-root.sh mainCheckoutRoot, or this script's own
#                    repo root)
#   --base <ref>     the ref a task worktree must have forked from (default: develop, the
#                    authoritative baseline). Only consumed by step 0b; other workspaces whose
#                    baseline is not `develop` can name theirs.
#   --dry-run        print what would be done, change nothing
#   --help           usage, exit 0
#
# Exit codes: 0 = provisioned (or already-provisioned); 2 = usage/env error (incl. non-task branch
#             or a refused fork point).
#
# Tests: plugin/test/dispatch-worktree-setup.test.mjs (@test-group engine).

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "dispatch-worktree-setup.sh — make a freshly-created task worktree self-verifying (node_modules symlink-or-install + config.yml via worktree-include.sh)"
  echo "usage: bash plugin/scripts/dispatch-worktree-setup.sh <worktree-path> [--root <main-repo>] [--base <ref>] [--dry-run]"
  exit 0
fi

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

worktree=""
root=""
base="develop"
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) root="${2:-}"; shift 2 ;;
    --base) base="${2:-}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) echo "usage: bash plugin/scripts/dispatch-worktree-setup.sh <worktree-path> [--root <main-repo>] [--base <ref>] [--dry-run]"; exit 0 ;;
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
[ -n "${root}" ] || root="$(cd "${SCRIPT_DIR}/../.." && pwd -P)"
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

  # ── 0b. fork-point self-check (AC-284 / GOAL-023) ───────────────────────────────────────────
  # 靶子：worker 从 **master**（发布/默认线）而不是 develop 分叉出的 worktree。派发 prompt 的第 1 步
  # 逐字只说「create an isolated git worktree for ${task}」——**不指名任何 base**；不指名时
  # `git worktree add -b task/<id> <path>` 从**调用方当时的 HEAD**（或 EnterWorktree fresh 模式下的
  # GitHub 默认分支）分叉。默认分支一旦由 develop 改成 master，worktree 就静默从更旧的 master 分叉，
  # 而步骤 0 只查分支名 ⇒ 放行，直到 fan-in 才以冲突/回归的形式暴露。本步骤堵这个面。
  #
  # ⛔ 为什么弱谓词不成立（本仓库 2026-09-17 实测）：master 是 develop 的**祖先**
  #   （`git rev-parse master`=ae28758aa, `develop`=e27f111ed, `merge-base master develop`=master tip,
  #    `--is-ancestor master develop` exit 0，`rev-list --count develop..master`=0）⇒ 一个从 master 分叉
  #   的 worktree 其 HEAD **本身就是 develop 历史里的节点** ⇒ `merge-base HEAD develop` 非空 /
  #   `--is-ancestor HEAD develop` / `rev-list --count develop..HEAD == 0` **全部放行**。能鉴别的是
  #   反方向的强谓词 `--is-ancestor <base> HEAD`（HEAD 必须包含 base tip）。
  #
  # ⛔ 为什么强谓词也不能裸用作拒绝条件（同轮实测 5 条存活 worktree，5/5 全部不满足它）：
  #   ac207fix-build 3182/0、gap-ac214-sixth-crossing 5/0、gap-readme-drivers 4/11、
  #   gap-release-cut 565/7、gap-suite-split 67/7 —— 合法 worktree 一旦 develop 前进或自己有了提交，
  #   `--is-ancestor develop HEAD` 即为假。本脚本 `worker-driver.ts:2522` 的**续做 prompt 会对已有
  #   worktree 再跑一次本脚本**（re-provision）⇒ 拿强谓词当拒绝条件会把每一次复用判死，把 worker 逼回
  #   共享检出（正是本脚本存在的理由）。⇒ 强谓词只作 **PASS 的充分条件**。
  #
  # 判据来源：分叉点在事后唯一可靠的记录是**分支的创建记录**——reflog 首条 `branch: Created from <起点>`
  #   （实测：`git worktree add -b X path develop|master|<sha>` 分别记录起点为 develop / master / 该 sha）。
  #   同轮实测 4 条存活 task worktree 的创建记录**全部**为 `Created from develop`。
  #   ⚠️ 这条实测同时否掉了「分叉点落在 master 历史上 ⇒ 用了错 base」这个看似合理的判据：
  #   gap-release-cut 的 `merge-base HEAD develop`=ae15f864 是 master 的祖先，而它是一条**合法的**
  #   develop 分叉（只是分叉得早）。⇒ 只有「起点**具名**一条严格落后于 base 的线」或「分叉点**恰是**
  #   那条线的 tip」才是错误分叉的正证据；「落在它的历史上」不是。
  #
  # ⛔ 对默认分支值的依赖（Proposal 要求正面交代）：本步骤**不硬编码**默认分支的值。承载拒绝的是
  #   **仓库自己的 ref**（创建记录具名的那条分支、以及 master/main/origin-HEAD 这几个候选），且只有当该
  #   ref **严格落后于 base** 时才拒。base 自身的推定为 PASS 完全不经过默认分支——默认分支换成 master 或
  #   换回 develop，本步骤的 PASS 面一字不变；默认分支只在**拒绝面**作为反例鉴别器出现。
  #
  # 三分，⛔ 三个取值互不同形（硬规则 3b：读不懂不得伪装成合格）：
  #   fork-point PASS          HEAD 已包含 base tip（结构性正确），或创建记录具名 base 本身。
  #   fork-point REFUSED exit 2 创建记录具名一条**严格落后于 base** 的线，或分叉点**恰是**该线 tip。
  #   fork-point NOT-EVALUATED base ref 不存在 / 无创建记录 / 起点既非 base 也无拒绝证据 ⇒ **独立取值，
  #                            不阻塞**（第三方 quay-init workspace 里根本没有 develop ref；既有 plain-dir
  #                            与无-develop 的夹具用例依赖此 lenient 行为）。
  base_tip="$(git -C "${worktree}" rev-parse --verify --quiet "${base}^{commit}" 2>/dev/null || true)"
  if [ -z "${base_tip}" ]; then
    echo "dispatch-worktree-setup: fork-point NOT-EVALUATED — base ref '${base}' does not resolve in ${worktree}, so no structural fork-point judgement is possible (not blocking; this worktree cannot be checked for a wrong base)"
  else
    # (i) 拒绝面 A —— 创建记录**具名**一条严格落后于 base 的线（如 master）。
    creation_log="$(git -C "${worktree}" reflog show --format='%gs' "${branch}" 2>/dev/null || true)"
    creation="$(printf '%s\n' "${creation_log}" | sed -n '$p')"
    created_from=""
    case "${creation}" in
      "branch: Created from "*) created_from="${creation#branch: Created from }" ;;
    esac
    ctok="${created_from}"
    ctok="${ctok#refs/heads/}"; ctok="${ctok#refs/remotes/}"; ctok="${ctok#origin/}"

    refuse_cause=""
    if [ -n "${ctok}" ] && [ "${ctok}" != "${base}" ]; then
      named_tip="$(git -C "${worktree}" rev-parse --verify --quiet "refs/heads/${ctok}^{commit}" 2>/dev/null || true)"
      [ -n "${named_tip}" ] || named_tip="$(git -C "${worktree}" rev-parse --verify --quiet "refs/remotes/origin/${ctok}^{commit}" 2>/dev/null || true)"
      if [ -n "${named_tip}" ] && [ "${named_tip}" != "${base_tip}" ] \
         && git -C "${worktree}" merge-base --is-ancestor "${named_tip}" "${base}" 2>/dev/null; then
        refuse_cause="the branch was created from '${ctok}' (${named_tip}), which is strictly behind ${base} (${base_tip})"
      fi
    fi

    # (ii) 拒绝面 B —— 起点无法具名（HEAD / 裸 sha / 无 reflog），但结构性分叉点**恰是**某条落后线的 tip。
    # 候选线由仓库自己的 ref 给出（master / main / origin HEAD 指向者），⛔ base 本身不作为候选。
    if [ -z "${refuse_cause}" ]; then
      fork_point="$(git -C "${worktree}" merge-base HEAD "${base}" 2>/dev/null || true)"
      origin_head="$(git -C "${worktree}" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"
      origin_head="${origin_head#origin/}"
      if [ -n "${fork_point}" ]; then
        for cand in master main "${origin_head}"; do
          [ -n "${cand}" ] || continue
          [ "${cand}" = "${base}" ] && continue
          cand_tip="$(git -C "${worktree}" rev-parse --verify --quiet "refs/heads/${cand}^{commit}" 2>/dev/null || true)"
          [ -n "${cand_tip}" ] || continue
          [ "${cand_tip}" = "${base_tip}" ] && continue
          if [ "${fork_point}" = "${cand_tip}" ] \
             && git -C "${worktree}" merge-base --is-ancestor "${cand_tip}" "${base}" 2>/dev/null; then
            refuse_cause="its fork point ${fork_point} is exactly the tip of '${cand}', which is strictly behind ${base} (${base_tip})"
          fi
        done
      fi
    fi

    if [ -n "${refuse_cause}" ]; then
      echo "dispatch-worktree-setup: fork-point REFUSED — ${refuse_cause}; refusing to provision (a task worktree must fork from ${base}, not from the release/default line)" >&2
      exit 2
    elif git -C "${worktree}" merge-base --is-ancestor "${base}" HEAD 2>/dev/null; then
      echo "dispatch-worktree-setup: fork-point PASS — HEAD contains ${base} (${base_tip})"
    elif [ "${ctok}" = "${base}" ]; then
      echo "dispatch-worktree-setup: fork-point PASS — ${branch} was created from '${ctok}' (= the base ${base}); ${base} having advanced since the fork is not a wrong base"
    else
      echo "dispatch-worktree-setup: fork-point NOT-EVALUATED — ${branch} carries no positive evidence of a ${base} base (creation record: '${created_from:-<none>}') and no evidence of a wrong one (not blocking)"
    fi
  fi
fi

# ── 1. node_modules (present / package-manager install / symlink / npm fallback) ──────────────
# The package-manager-aware judgment AND the provisioning live ONCE in
# packages/quay/src/worktree-deps.ts, shared with the goal path's ensureWorktreeNodeModules
# (gap-dispatch-worktree-setup-links-node-modules-for-pnpm-projects): a pnpm project refuses a
# symlinked node_modules, so its worktrees were dying in the suite step in milliseconds. Reached here
# through the thin entry worktree-deps-provision.sh, NOT a direct `node …` line: this script is a
# pure-bash orchestrator and the sh-census ratchet is at zero slack (a `node` word here would charge
# this whole body to embeddedInterpreterLines). The helper's exit code is AUTHORITATIVE — a non-zero
# exit is fail-closed (⛔ never degrade to a symlink that lets the suite die in milliseconds).
if [ "${dry_run}" -eq 1 ]; then
  bash "${SCRIPT_DIR}/worktree-deps-provision.sh" "${worktree}" --root "${root}" --dry-run
  rc=$?
else
  bash "${SCRIPT_DIR}/worktree-deps-provision.sh" "${worktree}" --root "${root}"
  rc=$?
fi
[ "${rc}" -eq 0 ] || exit "${rc}"

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
