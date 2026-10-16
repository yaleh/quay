#!/usr/bin/env bash
# release-cut.sh — CUT A RELEASE, as one command instead of a remembered sequence.
#
# SPEC: orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md §4 (release-branch protocol)
# and §12 (VERSION single source + build-mode suffix resolution). ADR-004: the protocol was prose,
# and prose gets paraphrased away — measured cost 2026-09-24: the v0.12.0 cut was performed as ~12
# hand-remembered steps, two of which bit:
#   1. `release-branch-finish.sh` needs HEAD == base (`develop`), so it could not be run from the
#      main checkout (HEAD=author) ⇒ the cut moved into an INDEPENDENT CLONE at
#      /data/scratch/yale/quay-release-cut-v0120;
#   2. the finish record then landed in THAT clone's `.quay/` — the main checkout's ledger last line
#      stayed at 2026-09-20 (AC-320 exists precisely because of this);
#   3. the next-version bump necessarily edited `docs/analysis/quay-init-closure-ratchet.baseline.json` (retired since — gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch)
#      (the bump changes `plugin/.claude-plugin/plugin.json`, a laydown source), which the prose
#      never mentioned — the cutter discovered it on the spot.
#
# What this command does, IN ORDER (each step's failure carries its OWN `CAUSE=` and exit code):
#   1. preflight, all read-only —
#        tag `v<version>` must not exist            CAUSE=release-cut-tag-exists
#        `--root` must be version-consistent        CAUSE=release-cut-version-inconsistent
#        `--root` must have no tracked edits        CAUSE=release-cut-dirty-tree
#        `develop` must resolve and not be BEHIND `origin/develop`
#                                                   CAUSE=release-cut-base-unresolvable /
#                                                   release-cut-develop-behind-remote /
#                                                   release-cut-develop-sync-unreadable
#        the release.yml that WILL GOVERN the run must be readable and, unless
#        `--allow-workflow-drift`, identical to the one in the tree the tag names
#                                                   CAUSE=release-cut-dispatch-ref-unresolvable /
#                                                   release-cut-workflow-definition-unreadable /
#                                                   release-cut-workflow-definition-drift
#   2. create a LINKED WORKTREE on `develop` (⛔ never an independent clone, ⛔ never a branch
#      switch in the main checkout);
#   3. cut the release branch there and land it in ONE invocation:
#      `release-branch-finish.sh release/v<version> --cut --tag v<version> --root <worktree>`;
#   4. push the tag and `develop`;
#   5. dispatch `release.yml` — WITH an explicit `--ref` (see `--dispatch-ref` below) — and echo the
#      run URL. 🚫 Without `--ref`, `gh` runs the workflow file on the repository's DEFAULT BRANCH,
#      i.e. the PREVIOUS release's definition (measured 2026-10-10: v0.17.0's run executed v0.16.0's
#      release.yml, and v0.18.0's was the first to run the new step — where it failed);
#   6. bump `VERSION` on `develop` to the NEXT version + `stamp-version.ts` + re-anchor the
#      closure-ratchet baseline, and commit;
#   7. remove the worktree it created.
#
# The record's landing root is NOT a parameter of this script's own choice: the finish step is
# invoked with `--root <worktree>`, and `release-branch-finish.sh` resolves its ledger to the
# checkout that OWNS the shared git dir ⇒ the MAIN checkout's `.quay/release-branch-finish.jsonl`.
# The dry run prints that absolute path (asked of the carrier itself via `--trace-path`, so there is
# ONE derivation) — a reader can check the landing without running anything.
#
# Usage:
#   release-cut.sh <version> [--root <repo>] [--worktree <path>] [--remote <name>]
#                  [--base <ref>] [--dispatch-ref <ref>] [--allow-workflow-drift]
#                  [--no-push] [--no-dispatch] [--dry-run]
#   <version>    bare X.Y.Z (⛔ no leading `v`, no suffix) — tag = v<version>, branch = release/v<version>
#   --root       the checkout to cut from (default: the MAIN checkout of the repo this script
#                lives in — `git rev-parse --git-common-dir`'s parent, so running this from a
#                linked worktree still cuts from the main checkout)
#   --worktree   where the linked worktree is created (default:
#                <dirname root>/<basename root>-worktrees/release-v<version>)
#   --remote     the remote to push to (default: origin)
#   --base       the ref the cut merges back into (default: develop)
#   --dispatch-ref <ref>
#                the ref `gh workflow run release.yml` is dispatched AGAINST (default: the release
#                tag itself, i.e. `--ref v<version>`). This decides WHICH copy of release.yml
#                governs the run. `--dispatch-ref develop` gates on current mainline instead of on
#                the tagged tree; either way the preflight prints which definition will govern and
#                how it differs from the tree the tag names.
#   --allow-workflow-drift
#                proceed even when the governing release.yml differs from the tree the tag names;
#                without it that difference is a REFUSED preflight (see --dispatch-ref)
#   --no-push    do not push (steps 4 and 6's push) — used by tests and by offline cuts
#   --no-dispatch do not run `gh workflow run release.yml`
#   --dry-run    run every READ-ONLY preflight, print the whole plan (worktree path, the
#                `--root` the finish step gets, the ledger's absolute path, the bump and the
#                ratchet re-anchor), mutate NOTHING, exit 0 when the preflight passes
#
# Exit codes:
#   0  the cut completed (or the dry run's preflight passed)
#   1  a step AFTER the preflight failed (merge/tag/push/dispatch/bump) — CAUSE= names which; the
#      cut may be partially landed, and each such CAUSE= says what is already true
#   2  usage error, or a preflight failed — nothing was created
#
# ⛔ This command does NOT decide the version: `<version>` is required and is never parsed out of
# a branch name or guessed from VERSION (the same rule release-branch-finish.sh follows).
#
# ── THIN ENTRY (⛔ the body belongs in the renderer, not here) ────────────────────────────────
# Every mode, flag, exit code and output shape is
#     plugin/scripts/release-cut.mjs
# and this wrapper does three things and nothing else:
#   1. resolve its own REAL path (`readlink -f`: the `experiments/quay-perpetual-stream/scripts/`
#      twin is a symlink, and an entry that looked for its renderer beside whichever spelling it was
#      invoked by would not find it);
#   2. fail closed with a CAUSE when the renderer is not beside it — an entry whose body is absent
#      must NOT print a plan that reads as "nothing to do";
#   3. exec the renderer with the caller's argv, unchanged.
# ⛔ Do not move the logic back into this file: `plugin/sh-census-baseline.json` is a SHRINK-ONLY
# ratchet whose axis charges a tracked `.sh` its WHOLE code-line count as soon as it carries one
# counted interpreter invocation (`node --experimental-strip-types` / `-e` / a `.ts` argument), and
# it is doubled here by the symlinked experiments twin. The committed baseline is exactly the current
# reading (zero slack), and the two escape hatches — self-exempting the human-curated
# `plugin/sh-census-exceptions.txt`, or raising a shrink-only baseline — are gate-gaming, so neither
# is taken. The census asks whether each `.sh` is a PROGRAM or GLUE; keeping this file glue is the
# honest answer, and the renderer's own header records why it is plain ESM rather than `--strip-types`.
set -euo pipefail

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "${BASH_SOURCE[0]}"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd -P)"
RENDERER="${SCRIPT_DIR}/release-cut.mjs"

if [ ! -f "$RENDERER" ]; then
  echo "CAUSE=release-cut-renderer-missing — ${RENDERER} not found, so the cut cannot run (plugin root: ${SCRIPT_DIR}). This entry is a thin wrapper: all modes, flags and output shapes live in the renderer, and an entry whose body is absent must not print a plan that reads as 'nothing to do' (hard rule 3b)." >&2
  exit 3
fi

exec node "$RENDERER" "$@"
