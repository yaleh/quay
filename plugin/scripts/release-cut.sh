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
#   2. the finish record then landed in THAT clone's `.quay/` — the main checkout's ledger末行
#      stayed at 2026-09-20 (AC-320 exists precisely because of this);
#   3. the next-version bump necessarily edits `docs/analysis/quay-init-closure-ratchet.baseline.json`
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
#   2. create a LINKED WORKTREE on `develop` (⛔ never an independent clone, ⛔ never a branch
#      switch in the main checkout) — `release-branch-finish.sh --cut` requires HEAD == base, and
#      the main checkout is normally NOT on `develop`;
#   3. cut the release branch there and land it in ONE invocation:
#      `release-branch-finish.sh release/v<version> --cut --tag v<version> --root <worktree>`
#      (merge back → tag the merge point → delete the branch — the SPEC's last three steps);
#   4. push the tag and `develop`;
#   5. dispatch `release.yml` on the tag and echo the run URL;
#   6. bump `VERSION` on `develop` to the NEXT version + `stamp-version.ts` + re-anchor the
#      closure-ratchet baseline, and commit;
#   7. remove the worktree it created.
#
# ⛔ The record's landing root is NOT a parameter of this script's own choice: the finish step is
# invoked with `--root <worktree>`, and `release-branch-finish.sh` resolves its ledger to the
# checkout that OWNS the shared git dir ⇒ the MAIN checkout's
# `.quay/release-branch-finish.jsonl`. The dry run prints that absolute path (asked of the carrier
# itself via `--trace-path`, so there is ONE derivation) — a reader can check the landing without
# running anything.
#
# Usage:
#   release-cut.sh <version> [--root <repo>] [--worktree <path>] [--remote <name>]
#                  [--base <ref>] [--no-push] [--no-dispatch] [--dry-run]
#   <version>    bare X.Y.Z (⛔ no leading `v`, no suffix) — tag = v<version>, branch = release/v<version>
#   --root       the checkout to cut from (default: the MAIN checkout of the repo this script
#                lives in — `git rev-parse --git-common-dir`'s parent, so running this from a
#                linked worktree still cuts from the main checkout)
#   --worktree   where the linked worktree is created (default:
#                <dirname root>/<basename root>-worktrees/release-v<version>)
#   --remote     the remote to push to (default: origin)
#   --base       the ref the cut merges back into (default: develop)
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
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
version=""
root=""
worktree=""
remote="origin"
base="develop"
do_push=1
do_dispatch=1
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) root="$2"; shift 2 ;;
    --worktree) worktree="$2"; shift 2 ;;
    --remote) remote="$2"; shift 2 ;;
    --base) base="$2"; shift 2 ;;
    --no-push) do_push=0; shift ;;
    --no-dispatch) do_dispatch=0; shift ;;
    --dry-run) dry_run=1; shift ;;
    -*) echo "release-cut: unknown option: $1" >&2; exit 2 ;;
    *) version="$1"; shift ;;
  esac
done

# ── the MAIN checkout of a checkout: the parent of its shared git dir ─────────────────────────
# Same order-independent derivation as plugin/scripts/repo-root.ts `mainCheckoutRoot` (⛔ never
# `git worktree list`'s first entry — that order is not guaranteed). Used for TWO things here:
# the default `--root` (so running this from a linked worktree still cuts from the main checkout)
# and the display of where the finish record lands.
main_root_of() { # <dir> → absolute checkout path, or "" when it cannot be derived
  local d="$1" gd=""
  gd="$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || gd=""
  if [ -z "$gd" ]; then
    gd="$(git -C "$d" rev-parse --git-common-dir 2>/dev/null)" || gd=""
    [ -n "$gd" ] || return 1
    case "$gd" in /*) : ;; *) gd="$d/$gd" ;; esac
  fi
  [ -n "$gd" ] || return 1
  ( cd "$(dirname "$gd")" 2>/dev/null && pwd -P ) || return 1
}

if [ -z "$root" ]; then
  root="$(main_root_of "$SCRIPT_DIR")" || root=""
  if [ -z "$root" ]; then
    echo "CAUSE=release-cut-root-unresolvable — could not derive the main checkout of '$SCRIPT_DIR' (git rev-parse --git-common-dir failed); pass --root <repo> explicitly" >&2
    exit 2
  fi
fi

usage() {
  echo "用法: bash $(basename "$0") <X.Y.Z> [--root <repo>] [--worktree <path>] [--remote <name>] [--base <ref>] [--no-push] [--no-dispatch] [--dry-run]" >&2
}

# ── the version and the two names derived from it (⛔ the version is never guessed) ────────────
case "$version" in
  ''|[!0-9]*|*[!0-9.]*|*..*|*.) echo "CAUSE=release-cut-bad-version — '<version>' is not a bare X.Y.Z version (leading 'v', a suffix like '-dev', or a non-numeric part is refused: this command does not guess what you meant)" >&2; usage; exit 2 ;;
esac
case "$version" in
  *.*.*) : ;;
  *) echo "CAUSE=release-cut-bad-version — '<version>' must have three numeric parts (X.Y.Z), got $(printf '%s' "$version" | awk -F. '{print NF}')" >&2; usage; exit 2 ;;
esac
case "$version" in
  *[!0-9.]*|'') echo "CAUSE=release-cut-bad-version — '<version>' must contain only digits and dots" >&2; usage; exit 2 ;;
esac
v_major="${version%%.*}"
v_rest="${version#*.}"
v_minor="${v_rest%%.*}"
v_patch="${v_rest#*.}"
case "$v_major$v_minor$v_patch" in
  *[!0-9]*|'') echo "CAUSE=release-cut-bad-version — '<version>' parts must all be numeric: '$version'" >&2; usage; exit 2 ;;
esac
tag="v$version"
branch="release/v$version"
next_version="$v_major.$((v_minor + 1)).0"

if [ ! -d "$root/.git" ] && ! git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
  echo "CAUSE=release-cut-not-a-repo — '--root $root' is not a git checkout; refusing to cut" >&2
  exit 2
fi
root="$(cd "$root" && pwd -P)"

# ── WHICH TOOLCHAIN: the checkout THIS SCRIPT ships in, never `--root` ────────────────────────
# In production the two are the same object (`--root` defaults to this script's own main
# checkout). They differ only when `--root` names another tree (a fixture, or a deliberate
# cross-checkout cut), and there the pair that ships together must be the pair that runs: a newer
# release-cut.sh driving an older `release-branch-finish.sh` would pass flags the carrier does not
# understand (`--trace-path`), and the failure would look like a broken carrier rather than a
# version skew. What IS judged from `--root` is the TREE: the checker takes `--root`, so the tree
# under test supplies its own VERSION and its own carrier files — only the table that reads them
# comes from here.
# ── preflight (read-only; ⛔ nothing below this block runs if any check fails) ─────────────────
# ① the tag must not exist: re-pointing a version tag is the one thing a cut must never do.
if git -C "$root" rev-parse --verify --quiet "refs/tags/$tag" >/dev/null; then
  echo "CAUSE=release-cut-tag-exists — tag '$tag' already exists in $root; pick the next version (⛔ this command never re-points an existing version tag)" >&2
  exit 2
fi

# ② the tree's version carriers must agree with `VERSION` — the tag is about to name exactly this
# tree, and `version-consistency-check.ts` is the EXTERNAL single-source judgment over it.
checker="$SCRIPT_ROOT/scripts/version-consistency-check.ts"
if [ ! -f "$checker" ]; then
  echo "CAUSE=release-cut-version-checker-missing — '$checker' does not exist, so 'is this tree version-consistent?' cannot be asked; refusing to cut a tree this command cannot judge (hard rule 3b)" >&2
  exit 2
fi
vc_out="$(node --experimental-strip-types "$checker" --root "$root" 2>&1)"
vc_rc=$?
if [ "$vc_rc" -ne 0 ]; then
  echo "CAUSE=release-cut-version-inconsistent — $checker --root $root exited $vc_rc: the version carriers do not agree with VERSION, so the tag would name a tree whose version is already wrong; run scripts/stamp-version.ts (and fix VERSION) first. Output:" >&2
  printf '%s\n' "$vc_out" >&2
  exit 2
fi

# ③ no tracked edits: the merge stage needs a clean tree, and "the tree I validated" must be the
# tree that gets tagged. Untracked files do not block a merge, so they are not judged here.
if [ -n "$(git -C "$root" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  echo "CAUSE=release-cut-dirty-tree — tracked files are modified in $root; commit or stash them first (the cut tags the tree it validated, so a dirty tree makes that validation meaningless)" >&2
  exit 2
fi

# ④ `develop` must resolve, must be FREE to check out, and must not be BEHIND the remote.
if ! git -C "$root" rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "CAUSE=release-cut-base-unresolvable — '--base $base' does not resolve to a commit in $root" >&2
  exit 2
fi
# The landing face merges INTO `$base` and therefore requires HEAD == `$base`, so the worktree this
# command creates must have `$base` checked out — and git refuses to check out one branch in two
# worktrees at once. So an occupied `$base` is a real precondition, not a nuisance: in this repo
# the main checkout normally sits on `author` and this never fires.
if git -C "$root" rev-parse --verify --quiet "refs/heads/$base" >/dev/null; then
  holders="$(git -C "$root" worktree list --porcelain 2>/dev/null | awk -v b="refs/heads/$base" '/^worktree /{ w=$2 } $1=="branch" && $2==b { print w }')"
  if [ -n "$holders" ]; then
    echo "CAUSE=release-cut-base-checked-out — '$base' is already checked out at [$(printf '%s' "$holders" | tr '\n' ' ')]; the cut must check '$base' out in its own linked worktree (the landing face merges INTO '$base' and requires HEAD == '$base'), and git allows a branch in only ONE worktree. Check another branch out there first (in this repo the main checkout normally carries 'author')" >&2
    exit 2
  fi
fi
# ... and it must not be BEHIND the remote: a tag cut from a develop the remote has already moved
# past would ship a release missing commits that are already published. ⚠️ This reads the
# LAST-FETCHED `origin/develop` and never fetches (a cut must not need the network).
if [ "$base" = "develop" ] && [ "$remote" != "" ] && [ "$do_push" -eq 1 ]; then
  remote_base_ref="refs/remotes/$remote/develop"
  if ! git -C "$root" rev-parse --verify --quiet "$remote_base_ref" >/dev/null; then
    echo "CAUSE=release-cut-develop-sync-unreadable — '$remote_base_ref' does not resolve in $root, so 'is develop behind the remote?' cannot be answered; refusing to cut (an unanswerable check must not read as 'in sync'). Fetch first, or pass --no-push for a deliberately local cut" >&2
    exit 2
  fi
  behind="$(git -C "$root" rev-list --count "develop..$remote_base_ref" 2>/dev/null)"
  if [ -z "$behind" ]; then
    echo "CAUSE=release-cut-develop-sync-unreadable — could not count develop..$remote_base_ref in $root" >&2
    exit 2
  fi
  if [ "$behind" -ne 0 ]; then
    echo "CAUSE=release-cut-develop-behind-remote — '$remote_base_ref' carries $behind commit(s) that local '$base' does not; the cut would tag a tree missing already-published commits (fetch + merge, or pass --no-push for a deliberately local cut)" >&2
    exit 2
  fi
fi

# ── the two paths, and the ledger's landing root (asked of the carrier, so there is ONE derivation)
if [ -z "$worktree" ]; then
  root_parent="$(dirname "$root")"
  worktree="$root_parent/$(basename "$root")-worktrees/release-$tag"
fi
finish_carrier="$SCRIPT_ROOT/plugin/scripts/release-branch-finish.sh"
if [ ! -f "$finish_carrier" ]; then
  echo "CAUSE=release-cut-finish-carrier-missing — '$finish_carrier' does not exist, so the cut's landing face (merge → tag → delete) has no carrier in the checkout this command ships in" >&2
  exit 2
fi
# The landing root is asked of the carrier ITSELF (`--trace-path`), so this script does not carry a
# second copy of the derivation. It is asked with `--root $root`, not `--root $worktree`, because
# the worktree does not exist yet and — by construction — a linked worktree resolves to the SAME
# ledger as the main checkout it was cut from (`--git-common-dir` is one object).
ledger_path="$(bash "$finish_carrier" --trace-path --root "$root" 2>/dev/null)" || ledger_path=""
if [ -z "$ledger_path" ]; then
  ledger_path="NOT-EVALUATED (release-branch-finish.sh --trace-path failed — the landing root could not be derived)"
fi

plan_out() { printf '%s\n' "$@"; }

if [ "$dry_run" -eq 1 ]; then
  if [ "$do_push" -eq 1 ]; then step4="git -C $root push $remote $base refs/tags/$tag"; else step4="(skipped: --no-push)"; fi
  if [ "$do_dispatch" -eq 1 ]; then step5="gh workflow run release.yml -f tag=$tag"; else step5="(skipped: --no-dispatch)"; fi
  if [ "$do_push" -eq 1 ]; then step7="git -C $root push $remote $base   (the bump commit)"; else step7="(skipped: --no-push)"; fi
  plan_out "dry-run: preflight PASSED — nothing was created and no ref was touched"
  plan_out "  1. create linked worktree '$worktree' off '$base' in $root"
  plan_out "     (⛔ a LINKED WORKTREE off $base — not an independent clone, not a branch switch in the main checkout)"
  plan_out "  1b. link node_modules into it (the bump stage's closure-ratchet re-anchor runs a real quay-init laydown)"
  plan_out "  2. create '$branch' at '$base'"
  plan_out "  3. bash $finish_carrier $branch --cut --tag $tag --root $worktree"
  plan_out "     → merge '$branch' back into '$base', tag $tag at the merge point, delete '$branch'"
  plan_out "     → the finish record lands at: $ledger_path"
  plan_out "  4. $step4"
  plan_out "  5. $step5"
  plan_out "  6. bump VERSION $version -> $next_version on '$base' in $worktree + stamp-version.ts"
  plan_out "     + re-anchor docs/analysis/quay-init-closure-ratchet.baseline.json (the bump changes plugin/.claude-plugin/plugin.json, a laydown source)"
  plan_out "  7. $step7"
  plan_out "  8. git -C $root worktree remove $worktree"
  exit 0
fi

# ── step 1: the linked worktree ON `develop` (the landing face requires HEAD == base) ─────────
if [ -e "$worktree" ]; then
  echo "CAUSE=release-cut-worktree-exists — '$worktree' already exists; refusing to reuse it (a stale worktree is not a fresh base for a cut)" >&2
  exit 2
fi
git -C "$root" branch "$branch" "$base" >/dev/null 2>&1 || {
  echo "CAUSE=release-cut-branch-create-failed — could not create '$branch' at '$base' in $root (does it already exist?)" >&2
  exit 1
}
if ! git -C "$root" worktree add "$worktree" "$base" >/dev/null 2>&1; then
  git -C "$root" branch -D "$branch" >/dev/null 2>&1 || true
  echo "CAUSE=release-cut-worktree-create-failed — could not create the linked worktree at '$worktree' on '$base' (is '$base' checked out in another worktree?); the branch '$branch' was removed again, nothing was tagged" >&2
  exit 1
fi

# ── step 1b: PROVISION it (⛔ a bare `git worktree add` is not enough — measured) ──────────────
# `git worktree add` places only TRACKED files, and step 5's closure-ratchet re-anchor runs a REAL
# `quay-init --all --loop --manager` laydown, which needs esbuild/node from node_modules. Measured
# on a bare worktree off `develop` (2026-09-24): without node_modules the laydown exits non-zero and
# the ratchet reports NOT-EVALUATED ("unwritten: tasks goals .gitignore .claude/…", i.e. "cannot
# re-anchor without a measurement"); with a node_modules link — and nothing else — it PASSES and
# re-measures exactly the committed 3 files / 1022 bytes. So the gitignored carriers that
# `scripts/worktree-include.sh` copies (.quay/config.yml, the plugin/vendor dist bundles) are NOT
# needed for this stage, and calling it here would make the cut depend on the source checkout having
# built artifacts it does not need. ⛔ Never `npm install` per release worktree: the main checkout's
# installed deps are shared by symlink, exactly as plugin/scripts/dispatch-worktree-setup.sh step 1
# does (that script is the canonical provisioner but is TASK-branch-specific by design — it refuses
# a worktree whose branch is not `task/*`, and this one carries `$base`).
if [ -d "$root/node_modules" ] && [ ! -e "$worktree/node_modules" ]; then
  ln -s "$root/node_modules" "$worktree/node_modules" 2>/dev/null || true
fi

# ── step 2: the cut's landing face, in ONE invocation (merge → tag → delete) ──────────────────
if ! bash "$finish_carrier" "$branch" --cut --tag "$tag" --root "$worktree"; then
  echo "CAUSE=release-cut-finish-step-failed — the landing face (merge '$branch' into '$base' → tag $tag → delete) failed; the linked worktree at '$worktree' is LEFT IN PLACE for inspection (⛔ it is not removed for you), and the branch/tag state is whatever the step reported above" >&2
  exit 1
fi

# ── step 3: push the tag and develop ──────────────────────────────────────────────────────────
if [ "$do_push" -eq 1 ]; then
  if ! git -C "$root" push "$remote" "$base" "refs/tags/$tag"; then
    echo "CAUSE=release-cut-push-failed — the cut landed locally (tag $tag exists, '$branch' is deleted) but pushing '$base' + $tag to '$remote' failed; re-run the push by hand — ⛔ do NOT re-run this command, it would refuse on the existing tag" >&2
    exit 1
  fi
fi

# ── step 4: dispatch release.yml on the tag, and echo the run URL ─────────────────────────────
if [ "$do_dispatch" -eq 1 ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "CAUSE=release-cut-dispatch-unavailable — 'gh' is not on PATH, so release.yml was NOT dispatched; the cut itself is complete (tag $tag pushed). Dispatch by hand: gh workflow run release.yml -f tag=$tag" >&2
    exit 1
  fi
  if ! gh workflow run release.yml -f "tag=$tag" >/dev/null 2>&1; then
    echo "CAUSE=release-cut-dispatch-failed — 'gh workflow run release.yml -f tag=$tag' failed; the cut itself is complete. Dispatch by hand and record the run id" >&2
    exit 1
  fi
  # The run URL is an OUT-OF-BAND result (runner / billing problems are not this command's to
  # judge — see the task's DoD): echo it, and never turn a missing URL into a failed cut.
  sleep 2
  run_url="$(gh run list --workflow release.yml --limit 1 --json url --jq '.[0].url' 2>/dev/null)" || run_url=""
  if [ -n "$run_url" ]; then
    echo "dispatched: $run_url"
  else
    echo "dispatched: release.yml on $tag (run URL not readable yet — gh run list returned nothing; check 'gh run list --workflow release.yml')"
  fi
fi

# ── step 5: bump VERSION on develop to the NEXT version (+ stamp + ratchet re-anchor) ─────────
# The bump is a commit ON `develop` with the next version, so the rolling channels advertise a
# version that does not exist yet rather than one that does (§4.3 选项 ii / §12). The ratchet
# re-anchor is NOT optional: the bump changes plugin/.claude-plugin/plugin.json, which is a
# closure-ratchet laydown source ⇒ the committed baseline goes stale and the pre-commit guard
# rejects every later commit (measured: the v0.12.0 bump commit touched 12 files).
stamper="$SCRIPT_ROOT/scripts/stamp-version.ts"
ratchet="$SCRIPT_ROOT/plugin/scripts/quay-init-closure-ratchet.ts"
if [ ! -f "$stamper" ] || [ ! -f "$ratchet" ]; then
  echo "CAUSE=release-cut-bump-tooling-missing — '$stamper' and/or '$ratchet' is missing from $root, so the next-version bump cannot be performed; the cut itself is complete (tag $tag). Bump by hand: write VERSION=$next_version, run scripts/stamp-version.ts, then re-anchor the closure ratchet, and commit on $base" >&2
  exit 1
fi
printf '%s\n' "$next_version" > "$worktree/VERSION" || {
  echo "CAUSE=release-cut-bump-write-failed — could not write VERSION=$next_version in '$worktree'" >&2
  exit 1
}
if ! node --experimental-strip-types "$stamper" --root "$worktree" >/dev/null 2>&1; then
  echo "CAUSE=release-cut-bump-stamp-failed — scripts/stamp-version.ts failed against '$worktree'; the cut itself is complete (tag $tag), but the next-version bump did NOT land — 'develop' still advertises $version" >&2
  exit 1
fi
if ! node --experimental-strip-types "$ratchet" --reanchor --root "$worktree" >/dev/null 2>&1; then
  echo "CAUSE=release-cut-bump-ratchet-failed — the closure-ratchet baseline could not be re-anchored in '$worktree'; committing now would leave the pre-commit guard rejecting later commits, so the bump is NOT committed" >&2
  exit 1
fi
if ! git -C "$worktree" add -A >/dev/null 2>&1 || ! git -C "$worktree" commit -q -m "release: bump version to $next_version after $tag (SPEC §12: VERSION + stamp + closure-ratchet re-anchor)" >/dev/null 2>&1; then
  echo "CAUSE=release-cut-bump-commit-failed — could not commit the next-version bump in '$worktree' (tree left dirty there; the cut itself is complete: tag $tag)" >&2
  exit 1
fi
if [ "$do_push" -eq 1 ]; then
  if ! git -C "$root" push "$remote" "$base"; then
    echo "CAUSE=release-cut-bump-push-failed — the next-version bump is committed locally on '$base' but pushing it to '$remote' failed; push by hand (the tag $tag is already pushed)" >&2
    exit 1
  fi
fi

# ── step 6: remove the worktree this command created (⛔ only its own) ────────────────────────
if ! git -C "$root" worktree remove "$worktree" >/dev/null 2>&1; then
  echo "CAUSE=release-cut-worktree-remove-failed — the cut is COMPLETE, but the worktree at '$worktree' could not be removed (is something still dirty there?); remove it by hand with 'git -C $root worktree remove $worktree'" >&2
  exit 1
fi

echo "cut: $tag landed on '$base' (merge point tagged, '$branch' deleted), released via release.yml, and '$base' now carries $next_version"
exit 0
