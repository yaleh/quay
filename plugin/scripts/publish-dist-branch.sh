#!/usr/bin/env bash
# publish-dist-branch.sh — DIR-108/M172: builds the plugin (sync-vendor.sh)
# and publishes the fully-built `plugin/` subtree to the `dist-plugin` ORPHAN
# branch (the gh-pages pattern), force-updated each run.
#
# This is the single mechanism used by BOTH:
#   - .github/workflows/publish-plugin-dist.yml (CI, workflow_dispatch ONLY —
#     gap-github-actions-no-implicit-triggers, 2026-09-14: no longer auto-runs
#     on a push to develop or a tag push, so publishing is always an explicit
#     request, never a side effect of an ordinary commit or `git push --tags`)
#   - a human/agent running it by hand (e.g. to seed the branch before the CI
#     job exists, or to re-publish out of band)
#
# It never touches the calling branch (master) — it builds in the current
# worktree, then uses a throwaway git worktree checked out to an orphan
# commit to assemble + push the dist-plugin branch, and cleans that worktree
# up afterward. Safe to re-run.
#
# Usage: bash plugin/scripts/publish-dist-branch.sh [--remote <name>] [--branch <name>] [--push]
#   --remote <name>   git remote to push to (default: origin)
#   --branch <name>   orphan branch name (default: dist-plugin)
#   --push            actually push to the remote (default: build + commit locally only,
#                      no push — the caller decides whether to push)
#   --no-build        skip the sync-vendor.sh build step (assume plugin/ is already fresh;
#                      used by tests / repeat-invocation)

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PLUGIN_DIR}/.." && pwd)"

REMOTE="origin"
BRANCH="dist-plugin"
DO_PUSH=false
DO_BUILD=true

while [ $# -gt 0 ]; do
  case "$1" in
    --remote) REMOTE="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --push) DO_PUSH=true; shift ;;
    --no-build) DO_BUILD=false; shift ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$REPO_ROOT"

SRC_SHA="$(git rev-parse HEAD)"
SRC_SHORT="$(git rev-parse --short HEAD)"

if $DO_BUILD; then
  echo "[publish-dist-branch] building plugin via sync-vendor.sh ..."
  bash "${PLUGIN_DIR}/scripts/sync-vendor.sh"
fi

# Sanity: the thing this whole milestone exists to publish must be present and non-trivial.
DIST_JS="${PLUGIN_DIR}/vendor/quay/dist/quay.js"
if [ ! -s "$DIST_JS" ]; then
  echo "ERROR: ${DIST_JS} missing or empty after build — refusing to publish an empty bundle." >&2
  exit 1
fi
DIST_BYTES="$(wc -c < "$DIST_JS")"
echo "[publish-dist-branch] built bundle: ${DIST_JS} (${DIST_BYTES} bytes)"

# gap-dist-plugin-missing-node-modules-task-schema-yaml: WORK must live UNDER REPO_ROOT, not
# system /tmp — the build-plugin-dist.mjs step below runs esbuild against files inside WORK, and
# esbuild resolves each bundled file's npm imports (e.g. task-schema.ts's `from "yaml"`) by
# walking up the FILESYSTEM tree from that file's own location looking for node_modules. A /tmp
# path has no ancestor node_modules and the build fails outright; nesting WORK under REPO_ROOT
# (gitignored via the repo's existing `**/worktrees/` pattern — never committed, cleaned up below
# same as before) lets that walk-up reach REPO_ROOT/node_modules.
WORK="$(mktemp -d "${REPO_ROOT}/.tmp-dist-publish-worktrees/publish-XXXXXX" 2>/dev/null || { mkdir -p "${REPO_ROOT}/.tmp-dist-publish-worktrees" && mktemp -d "${REPO_ROOT}/.tmp-dist-publish-worktrees/publish-XXXXXX"; })"
cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$WORK" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "[publish-dist-branch] assembling orphan branch '${BRANCH}' content in ${WORK} ..."
# IMPORTANT: this is a `git worktree add` off REPO_ROOT (shares REPO_ROOT's .git dir/config),
# NOT a separate `git init` — that is what makes `git push` below reuse whatever remote
# credentials the calling environment already configured for REPO_ROOT (in CI,
# actions/checkout's http.extraheader token; locally, the gh/git credential helper). A
# freestanding `git init` + push would need its own credential setup and silently fail auth
# in CI.
# Drop any leftover LOCAL branch ref from a prior/aborted run before re-creating it as an
# orphan below — `git checkout --orphan` refuses to reuse a name that already resolves to a
# real branch. This never touches the REMOTE branch (only overwritten by the --push step).
git -C "$REPO_ROOT" branch -D "$BRANCH" >/dev/null 2>&1 || true

git -C "$REPO_ROOT" worktree add --quiet --detach "$WORK" HEAD
git -C "$WORK" checkout --quiet --orphan "$BRANCH"
git -C "$WORK" rm -rf --quiet . >/dev/null 2>&1 || true
find "$WORK" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

# Copy the built plugin/ subtree to the WORKTREE ROOT (not nested under plugin/) so that
# a plugin-source `{"source":"github","repo":"...","ref":"dist-plugin"}` (no `path`) finds
# .claude-plugin/plugin.json at the branch root — plugin-level marketplace sources do not
# currently support a `path` subdirectory parameter (only `ref`), so the orphan branch's
# root IS the plugin, mirroring what `./plugin` means for the local-directory marketplace
# source used by master.
rsync -a --exclude='.git' "${PLUGIN_DIR}/" "${WORK}/"

# gap-dist-plugin-missing-node-modules-task-schema-yaml: this branch used to ship the copied
# plugin/scripts (and gate-scripts) as RAW .ts alongside whatever dist/*.js happened to already
# exist on disk in ${PLUGIN_DIR} (build artifacts are gitignored and NOT reproducibly present —
# a prior ad hoc `build-plugin-dist.mjs` run elsewhere could leave some behind, rsynced in by
# accident, while most scripts had none). `resolvePluginScriptExec` (packages/quay/src/
# plugin-root.ts) is RAW-priority — it assumes, per its own docstring, that "the npm-pack
# artifact carries consumer-referenced plugin .ts ONLY as bundled dist/*.js (no raw .ts)". That
# invariant was upheld for the npm-pack channel (scripts/package.sh's own find -delete step
# below) but never enforced here, so a raw .ts with an npm dependency (e.g. task-schema.ts's
# `import ... from "yaml"`) reached a plugin-cache install with no node_modules to satisfy it —
# ERR_MODULE_NOT_FOUND at driver start. Fix: build + strip, mirroring package.sh's own proven
# sequence exactly (same script, same exclusion, same fail-closed check), so this branch upholds
# the same invariant the resolver already assumes.
echo "[publish-dist-branch] building bundled plugin script entrypoints (scripts/dist/*.js + gate-scripts/dist/*.js) ..."
rm -rf "${WORK}/scripts/dist" "${WORK}/gate-scripts/dist"
node --experimental-strip-types "${REPO_ROOT}/packages/quay/scripts/build-plugin-dist.mjs" "${WORK}"
echo "[publish-dist-branch] removing raw plugin .ts (bundled/inlined into dist/*.js) ..."
# ⛔ Same exclusion as package.sh, same reason: runner-static-gate.ts is the static-check
# REGISTRY — a bash library scripts/test.sh sources in the dev tree, named .ts only so the
# annotation parsers see it, not a bundle entry. It ships verbatim (data/library file, not a
# module) — see package.sh's own comment for the full incident this exclusion fixes.
find "${WORK}/scripts" "${WORK}/gate-scripts" -name '*.ts' ! -name 'runner-static-gate.ts' -delete
if [ ! -f "${WORK}/scripts/runner-static-gate.ts" ]; then
  echo "ERROR: the static-check registry (scripts/runner-static-gate.ts) is missing after the strip step." >&2
  exit 1
fi
echo "[publish-dist-branch] rewriting staged invokers (docs/.sh/quay-init) to reference the dist bundles ..."
node --experimental-strip-types "${REPO_ROOT}/packages/quay/scripts/build-plugin-dist.mjs" --rewrite "${WORK}"

# ── Build-mode version stamp (gap-version-stamp-generator-and-build-wiring) ──────────────────────
# The assembled tree IS the published artifact, so its version is decided HERE, by the build:
# `resolveVersion(VERSION,'build')` ⇒ `X.Y.Z` on a `release/*` branch (or at tag `vX.Y.Z`),
# `X.Y.Z-dev` otherwise (human ruling 2026-09-20: 「可以在 build 过程中，监测分支并加后缀，如 -dev」).
# The committed carriers stay `X.Y.Z-dev` on every branch — the tag commit no longer self-describes,
# which is exactly why a release no longer needs a de-suffixing bump commit.
# Stamping ${WORK} (and NOT ${PLUGIN_DIR}) is the point: this tree is generated, throwaway, and never
# committed, so the release form reaches the published branch without dirtying the calling checkout.
# ⛔ Node-20-safe entry (`stamp-version.mjs`): CI's publish workflow need not run the `.ts` runtime, and
# the artifact should not depend on which Node happened to invoke the publisher.
echo "[publish-dist-branch] stamping the assembled tree with the build-version (branch-aware) ..."
STAMP_ENTRY="${REPO_ROOT}/scripts/stamp-version.mjs"
if [ ! -f "${STAMP_ENTRY}" ]; then
  echo "ERROR: the build-mode version stamper is missing: ${STAMP_ENTRY}" >&2
  echo "       Refusing to publish without it: the published branch would carry a development version." >&2
  exit 1
fi
node "${STAMP_ENTRY}" --mode build --root "${WORK}" --git-root "${REPO_ROOT}"

# ── AC-263: the dist reference-closure gate for THIS channel — and it must ABORT, not warn ────────
# The npm-tarball channel has had an equivalent assertion since gap-plugin-dist-entry-derivation-
# blind-to-core-and-table-refs (package.sh → build-plugin-dist.mjs --verify-closure, landing on the
# `npm pack` listing). This marketplace/dist-plugin channel — declared the PRIMARY publish channel by
# orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md:139 — assembled the same kind of
# tree with NO equivalent check (this script had 0 `closure` hits), so a bundle the shipped carriers
# reference could be absent from the published branch and the only symptom would be a failure in a
# CONSUMING project: structurally invisible to this repo's own tests, which is exactly the class the
# tarball gate was built to close.
# ⛔ The reading is the DIRECTORY (the tarball verifier eats pack-listing text): the present-set is a
# walk of the assembled tree, and the required-set is the tarball gate's own derivation (against
# ${PLUGIN_DIR}, whose raw .ts are still present — ${WORK}'s were stripped above) UNION every
# `{scripts,gate-scripts}/dist/<name>.js` the artifact's own carriers reference.
# ⛔ It must ABORT: a WARN-and-continue gate cannot take the value false, and a check that cannot be
# red is a false assurance, not a measurement (硬规则 3b — 「没有检查」是已知的空白，「一个恒绿的检
# 查」是一个假的保证，后者更贵). The guard below is explicit rather than relying on `set -e`, so the
# abort survives a future caller that sources this file or disables errexit. Nothing has been
# committed or pushed at this point, so an abort publishes nothing.
echo "[publish-dist-branch] verifying dist reference closure in the assembled publish tree ..."
if ! node --experimental-strip-types "${REPO_ROOT}/packages/quay/scripts/build-plugin-dist.mjs" \
     --verify-closure-dir "${WORK}" "${PLUGIN_DIR}"; then
  echo "ERROR: dist reference-closure gate FAILED — refusing to publish the orphan branch." >&2
  echo "       No commit, no push: the assembled tree is discarded on exit, ${REMOTE}/${BRANCH} untouched." >&2
  exit 1
fi

git -C "$WORK" add -A
# ⛔ `--no-verify` is REQUIRED here, and it is not a bypass of a gate that applies.
# This commit is assembled in a throwaway orphan worktree whose content is a GENERATED
# artifact, and the raw plugin .ts were deliberately deleted from it a few lines above
# (they are inlined into dist/*.js). The repo's pre-commit hook
# (.git/hooks/pre-commit, installed by `precommit-guard.ts --install-hook`) is a
# SOURCE-TREE guard: it does `git rev-parse --show-toplevel` and execs
# "$ROOT/plugin/scripts/precommit-guard.ts" — which in $WORK no longer exists. Without
# this flag the publish dies with MODULE_NOT_FOUND at the commit step, but ONLY on a
# machine where someone installed the hook (hooks are not cloned, so CI — the other
# caller of this script — never saw it; measured 2026-09-15, pre-existing, unrelated to
# the shim this branch is being published for). The hook's two real subjects (doc-class
# checks, and the Touches one-entry-per-path detector over staged `tasks/*.md`) have no
# subject here: the orphan branch carries no `tasks/` at all, and its only consumer is
# Claude Code's plugin installer. Publishing is a generated-artifact push, not a source
# commit, so source-tree commit policy does not gate it.
git -C "$WORK" -c user.name="quay-dist-publish" -c user.email="dist-publish@quay.invalid" \
  commit -q --no-verify -m "dist-plugin: build from ${SRC_SHORT}

Built by plugin/scripts/publish-dist-branch.sh (DIR-108/M172) via
plugin/scripts/sync-vendor.sh from packages/quay/{bin,src} at ${SRC_SHA}.
This branch is force-updated on every publish — it is NOT meant to be
merged, diffed against master for review, or built on top of. It exists
solely so the marketplace plugin source can install a pre-built,
Node-20-runnable, self-contained plugin without shipping the build
artifact on master."

NEW_SHA="$(git -C "$WORK" rev-parse HEAD)"
echo "[publish-dist-branch] orphan commit ready: ${NEW_SHA}"

if $DO_PUSH; then
  echo "[publish-dist-branch] force-pushing ${BRANCH} -> ${REMOTE} ..."
  git -C "$WORK" push --force "$REMOTE" "HEAD:refs/heads/${BRANCH}"
  echo "[publish-dist-branch] pushed. ${REMOTE}/${BRANCH} now at ${NEW_SHA}"
else
  echo "[publish-dist-branch] --push not given; built+committed locally only (in a throwaway worktree, now discarded on exit)."
  echo "[publish-dist-branch] re-run with --push to actually update ${REMOTE}/${BRANCH}."
fi
