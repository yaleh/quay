#!/usr/bin/env bash
# package.sh — build a distributable quay release artifact via npm pack.
#
# QX-033 (experiment 4, iteration 9): closes CB-008 (no packaging/distribution).
# Approach: Option B (npm pack) — produces a self-contained .tgz that users can
# install globally via `npm install -g quay-<version>.tgz` without cloning the repo.
#
# Node SEA was evaluated and deferred: it requires bundling all dependencies
# (yaml, @modelcontextprotocol/sdk) into a single file. Without a bundler like
# esbuild present, the bundling step would require a separate toolchain installation.
# npm pack is simpler, universally available with Node.js, and produces a package
# that respects the existing ESM entry points and bin field in package.json.
#
# Usage:
#   bash packages/quay/scripts/package.sh
#   # or from packages/quay/:
#   bash scripts/package.sh
#
# Output: quay-<version>.tgz in the current directory (wherever npm pack is run from).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "Building quay release artifact from ${PACKAGE_DIR}..."

# npm pack must be run from the package root (where package.json lives).
cd "${PACKAGE_DIR}"

# M120 (DIR-060): build the bundled ESM dist/quay.js BEFORE npm pack. The `bin`
# field points at ./dist/quay.js (Node-20-runnable) — native .ts needs Node
# >=23, so the raw bin/quay.ts entrypoint fails on the declared floor. dist/ is
# gitignored (generated, like dist-sea/), so it MUST be built here every pack.
echo "Building the ESM dist bundle (dist/quay.js) before packing..."
bash "${SCRIPT_DIR}/build-dist.sh"

# gap-release-excludes-plugin-bundle-agent-surface (AC16): the release tarball MUST
# carry the ENTIRE plugin bundle — the agent surface that IS the self-evolving loop
# (plugin/scripts + gate-scripts + skills + probes + loop tick docs + vendor
# self-contained runtime + agents + workflows). `npm pack`'s `files` entries are
# relative to the package root and `../` escapes are not allowed, so the repo-root
# plugin/ (a sibling of packages/quay/) cannot be referenced directly. Materialize a
# SNAPSHOT under packages/quay/plugin/ (gitignored, generated at pack time — the same
# pattern as dist/) so the tarball carries it. `plugin` is listed in the `files`
# array, and the files field takes precedence over .gitignore (so the gitignored
# vendored runtime bundles under plugin/vendor/*/dist/ are included too).
PLUGIN_SRC="${PACKAGE_DIR}/../../plugin"
PLUGIN_DEST="${PACKAGE_DIR}/plugin"

# The plugin's vendored self-contained runtime (plugin/vendor/quay/dist/quay.js +
# plugin/vendor/quay-native/dist/quay-native.js) is gitignored (bare `dist/` rule) —
# a fresh checkout has none, but the released tarball MUST carry it: the installed
# copy's quay-init --loop lays that runtime into a target project's provider config,
# and an installed tarball has no packages/ source tree to auto-build from. The root
# `npm install` postinstall (sync-vendor.sh) builds it; make that a hard precondition
# here (auto-build when missing, FAIL CLOSED when it still cannot be produced).
if [ ! -f "${PLUGIN_SRC}/vendor/quay/dist/quay.js" ] || \
   [ ! -f "${PLUGIN_SRC}/vendor/quay-native/dist/quay-native.js" ]; then
  echo "Vendored runtime bundles missing from ${PLUGIN_SRC}/vendor/ — running sync-vendor.sh to build them..."
  bash "${PLUGIN_SRC}/scripts/sync-vendor.sh"
fi
if [ ! -f "${PLUGIN_SRC}/vendor/quay/dist/quay.js" ] || \
   [ ! -f "${PLUGIN_SRC}/vendor/quay-native/dist/quay-native.js" ]; then
  echo "ERROR: could not produce the plugin's vendored runtime bundles (plugin/vendor/quay/dist/quay.js + plugin/vendor/quay-native/dist/quay-native.js)." >&2
  echo "       The release tarball must carry them (quay-init --loop lays them into a target project)." >&2
  echo "       Fix: run 'npm install' at the repo root (postinstall runs sync-vendor.sh), or 'bash plugin/scripts/sync-vendor.sh'." >&2
  exit 1
fi

if [ ! -d "${PLUGIN_SRC}" ]; then
  echo "ERROR: plugin bundle source not found: ${PLUGIN_SRC}" >&2
  exit 1
fi

# Version-sync gate (gap-npm-install-does-not-register-the-plugin-with-claude-code): the
# Claude Code plugin manifest's version MUST track package.json's version. Claude Code
# presents marketplace.json's `plugins[].version` to the user in `/plugin` listings — a
# drift makes a freshly installed 0.4.0 package advertise itself as 0.3.13. Fail closed
# instead of shipping a lying manifest. When bumping the package version, bump
# plugin/.claude-plugin/marketplace.json AND plugin/.claude-plugin/plugin.json in the
# same change.
PKG_VERSION="$(node -p 'require(process.argv[1]).version' "${PACKAGE_DIR}/package.json")"
MKT_VERSION="$(node -p 'require(process.argv[1]).plugins[0].version' "${PLUGIN_SRC}/.claude-plugin/marketplace.json")"
PLUGIN_VERSION="$(node -p 'require(process.argv[1]).version' "${PLUGIN_SRC}/.claude-plugin/plugin.json")"
if [ "${PKG_VERSION}" != "${MKT_VERSION}" ] || [ "${PKG_VERSION}" != "${PLUGIN_VERSION}" ]; then
  echo "ERROR: plugin manifest version drift — package.json=${PKG_VERSION}, marketplace.json=${MKT_VERSION}, plugin.json=${PLUGIN_VERSION}" >&2
  echo "       The Claude Code plugin lists marketplace.json's plugins[].version; a drift shows the wrong version to users." >&2
  echo "       Fix: bump plugin/.claude-plugin/marketplace.json and plugin/.claude-plugin/plugin.json to ${PKG_VERSION} in the same change." >&2
  exit 1
fi
echo "Plugin manifest version sync OK (marketplace.json + plugin.json = ${PKG_VERSION})"
echo "Staging the plugin bundle (packages/quay/plugin/) from repo-root plugin/ before packing..."
rm -rf "${PLUGIN_DEST}"
mkdir -p "${PLUGIN_DEST}"
cp -R "${PLUGIN_SRC}/." "${PLUGIN_DEST}/"

# EXCLUDE quay's OWN tests from the shipped artifact (human ruling 2026-08-06: 剔除测试).
# Measured before the ruling: plugin/test/ was 151 of 406 plugin entries (37%) and 1.9MB of
# 7.2MB (27%) — a user installs quay to run its loop, not to run quay's own test suite.
#
# SAFE TO REMOVE — verified, not assumed:
#   * laydown-set-check.sh:110 resolves "$ROOT"/plugin/test/<basename>.test.mjs, BUT only under
#     the opt-in `--run-tests` deep gate (RUN_TESTS=0 by default, that script's line 38). The
#     cold-start skill invokes it WITHOUT --run-tests (plugin/skills/cold-start/SKILL.md:108,164),
#     so the default cold-start gate path is unaffected.
#   * every other shipped reference to plugin/test/ is a comment or a documented test seam
#     (dead-loop-check.sh:45, resource-gate.sh:39, l1-delivery-surface-check.ts:23, ...).
#
# CONSEQUENCE, stated plainly rather than hidden: an installed copy can no longer run
# `laydown-set-check.sh --run-tests` (the deep gate that caught 4+3 real defects on ad-arm1 that
# A's own suite had missed). That capability now requires the source repo. If a downstream
# acceptor machine needs it back, the fix is a SEPARATE optional test package — not re-inflating
# the main artifact.
rm -rf "${PLUGIN_DEST}/test"
echo "Excluded: plugin/test/ (quay's own suite — not a user-facing deliverable)"

# ── gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form ──────────
# The delivered artifact's delivery FORM for the plugin's bash tools was 86 loose .sh files —
# every one an independently-invocable surface, with NO argued decision about the entry count
# (Core ships as ONE bundled dist/quay.js; the plugin shipped as 86 loose scripts). Human ruling
# 2026-08-06: the user should get a SMALL number of executable files. bash cannot be bundled into a
# single executable (unlike .ts via esbuild — gap-shipped-ts-files-are-not-bundled-* owns that axis),
# so the .sh reachable form is "few entry points + internal parts not exposed": the consumer-facing
# entry set is DECLARED (capability-catalog.sh's PUBLIC_ENTRYPOINTS) and mechanically cross-checked
# against the shipped consumer docs HERE at pack time. This is the AC3 negative control: an internal
# .sh that appears in consumer-facing docs (plugin/loop/*.md + plugin/skills/*/SKILL.md) is an
# UNARGUED consumer-facing surface → the pack FAILS CLOSED rather than shipping a delivery form whose
# entry count is an accident (the 2026-08-06→08-08 drift 86→94 with no argued decision is the failure
# this gate exists to stop).
echo "Checking the .sh delivery form on the staged copy (declared entry surface vs consumer docs)..."
if ! bash "${PLUGIN_DEST}/scripts/capability-catalog.sh" --entry-surface; then
  echo "ERROR: the staged plugin's .sh delivery form is not an argued decision — see above." >&2
  echo "       An internal .sh appears in consumer-facing docs (plugin/loop/*.md or plugin/skills/*/SKILL.md)." >&2
  echo "       Either declare it in PUBLIC_ENTRYPOINTS (plugin/scripts/capability-catalog.sh) or remove the doc reference." >&2
  exit 1
fi
LOOSE_SH_COUNT="$(find "${PLUGIN_DEST}" -name '*.sh' | wc -l | tr -d ' ')"
echo "Delivery form measured: ${LOOSE_SH_COUNT} loose .sh staged | consumer-facing surface declared + gated (AC3)"
# ── gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact ─────────────────────────
# The plugin's consumer-referenced .ts used to ship RAW (80 files), so every invocation on a
# consumer machine paid `node --experimental-strip-types` and the consumer's Node had to support
# the flag — while Core (`package/dist/quay.js`) and the vendored runtimes
# (`package/plugin/vendor/*/dist/*.js`) were already bundled. Human ruling 2026-08-06: the user
# should get "a small number of executable files", aligned with Core. So, on the STAGED copy:
#   1. build per-entry ESM bundles (plugin/scripts/dist/*.js + plugin/gate-scripts/dist/*.js)
#      with the SAME esbuild config as Core's build-dist.mjs (bundle/node/esm + createRequire
#      banner for yaml's CJS shim) — the entry set is DERIVED from the shipped surface's own
#      references, never hand-maintained;
#   2. DELETE the raw .ts from the staged artifact (each is either an entrypoint bundle or
#      inlined into one; internals no longer ship standalone);
#   3. rewrite the staged invokers (tick docs, skills, probes, .sh wrappers, quay-init's
#      mechanism derivation) to reference plugin/scripts/dist/*.js instead of the raw .ts.
# The SOURCE tree keeps its .ts (readable/editable dev form); the shipped artifact is the
# crystallized executable form. The bundles run on a bare Node >=20, no --experimental-strip-types.
echo "Building the plugin's bundled dist entrypoints (scripts/dist/*.js + gate-scripts/dist/*.js)..."
node "${SCRIPT_DIR}/build-plugin-dist.mjs" "${PLUGIN_DEST}"
echo "Removing raw plugin .ts from the staged artifact (bundled/inlined into dist/*.js)..."
find "${PLUGIN_DEST}/scripts" "${PLUGIN_DEST}/gate-scripts" -name '*.ts' -delete
echo "Rewriting staged invokers (docs/.sh/quay-init) to reference the dist bundles..."
node "${SCRIPT_DIR}/build-plugin-dist.mjs" --rewrite "${PLUGIN_DEST}"
echo "Staged: ${PLUGIN_DEST} ($(find "${PLUGIN_DEST}" -type f | wc -l) files)"

# Pack the package. This produces quay-<version>.tgz in the current directory.
# The --pack-destination flag (npm >=7) puts the .tgz in the caller's original
# directory instead; omitting it puts it in PACKAGE_DIR, which is fine for CI.
npm pack

ARTIFACT="$(ls -1t quay-*.tgz 2>/dev/null | head -1)"
if [ -z "${ARTIFACT}" ]; then
  echo "ERROR: npm pack did not produce a quay-*.tgz artifact." >&2
  exit 1
fi

# ── gap-plugin-dist-entry-derivation-blind-to-core-and-table-refs (reference closure) ───────────
# A referenced `dist/<name>.js` must actually be INSIDE the tarball. The entry set is derived from
# the shipped surface's references (Core source .ts refs + shipped-text dist/*.js refs), but that
# derivation can silently miss a reference (a Core-only consumer like driver-runtime.ts, or a
# table/list row like deliver-verify-usage.sh's VERIFY_SET) — and the missing bundle only manifests
# as "quay driver kernel not found" in a DIFFERENT project, structurally invisible to this repo's
# own self-test. This gate re-scans the staged text + Core source and asserts each referenced bundle
# is present in the actual `npm pack` listing — crossing both the staging copy and the pack, so it
# takes false when a bundle is dropped. Negative control: removing an entry makes it exit 1.
echo "Verifying dist reference closure against the tarball (every referenced dist/*.js is packed)..."
# ⛔ Derive the required set from the SOURCE plugin root (PLUGIN_SRC, raw .ts still present), NOT
# the staged copy (PLUGIN_DEST, whose raw .ts were deleted above) — deriveEntries needs the .ts to
# intersect references against. The assertion itself lands on the tarball listing.
node "${SCRIPT_DIR}/build-plugin-dist.mjs" --verify-closure "${PLUGIN_SRC}" "${ARTIFACT}"

echo "Artifact: ${PACKAGE_DIR}/${ARTIFACT}"
echo ""
echo "Install globally:  npm install -g ${ARTIFACT}"
echo "Then run:          quay --help"
