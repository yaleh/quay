#!/usr/bin/env bash
# Mutation case for version-consistency-check (fail-closed gate: every version-bearing
# artifact must carry the identical version). Fixture: a temp root with all 11 version
# artifacts pinned to 1.0.0.
#
# ⚠️ INVARIANT: the file set built below MUST cover the checker's VERSION_ENTRIES exactly — one
# artifact per entry, every one parseable. Adding an entry to `scripts/version-consistency-check.ts`
# WITHOUT adding its file here does not read as "a new dimension"; it makes the GREEN baseline fail
# (the new entry lands in mode:'error'), and this whole case reports `always-red` — i.e. the gate
# that exists to prove the checker is live instead reports the checker as broken, and every fan-in
# in the repo reds at the static phase. That is exactly what `ee49cb056` (2026-09-15) did by adding
# the delivery-manifest.json entry alone; the missing file here is Inject 4's subject.
# Inject 1: bump ONE machine field (packages/quay) to 1.0.1 → drift → the checker MUST exit 1 (RED).
# Restore: pin it back to 1.0.0 → the checker MUST exit 0 (GREEN).
# Inject 2 (gap-ac169-readme-version-not-in-version-consistency-set): bump ONLY the prose carrier
#   plugin/README.md → drift → MUST exit 1 (RED). Without this path, "the README entry was added to
#   VERSION_ENTRIES" and "the README entry actually participates in the judgment" are
#   indistinguishable (hard rule 4). Restore → MUST exit 0 (GREEN).
# Inject 3 (gap-ac259-version-union-lockstep-and-host-install-readings): bump ONLY the plain-text stamp
#   plugin/VERSION → drift → MUST exit 1 (RED). This is the member that 6bf000622 left at 0.5.0 while
#   the checker read GREEN — the class of gap this fixture exists to make unrepeatable.
#   Restore → MUST exit 0 (GREEN).
# Inject 4 (gap-release-cut-via-workflow-dispatch): bump ONLY delivery-manifest.json → drift → MUST
#   exit 1 (RED). Same doctrine as Inject 2/3 (hard rule 4): without this path, "the manifest entry
#   was added to VERSION_ENTRIES" and "the manifest entry actually participates in the judgment" are
#   indistinguishable. The prose carrier and the plain-text stamp each got such a path when they were
#   added; the machine-field manifest was added without one, and the un-updated fixture is what
#   surfaced as a whole-repo `always-red` instead. Restore → MUST exit 0 (GREEN).
set -u
name="version-consistency-check"
workdir="${1:?usage: $name.sh <workdir>}"
scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/scripts"

mkdir -p "${workdir}/packages/quay" "${workdir}/packages/quay-native" \
  "${workdir}/packages/quay-github" "${workdir}/packages/quay-backlog" \
  "${workdir}/plugin/.claude-plugin" "${workdir}/plugin/vendor/quay" "${workdir}/.claude-plugin"

mkver() { printf '{\n  "name": "%s",\n  "version": "1.0.0"\n}\n' "$1" > "$2"; }
mkver "quay"        "${workdir}/packages/quay/package.json"
mkver "quay-native" "${workdir}/packages/quay-native/package.json"
mkver "quay-github" "${workdir}/packages/quay-github/package.json"
mkver "quay-backlog" "${workdir}/packages/quay-backlog/package.json"
mkver "quay"        "${workdir}/plugin/vendor/quay/package.json"
printf '{\n  "name": "quay",\n  "version": "1.0.0",\n  "main": "dist/entry.js"\n}\n' > "${workdir}/plugin/.claude-plugin/plugin.json"
printf '[{"name":"quay","version":"1.0.0","source":"github"}]\n' > "${workdir}/plugin/.claude-plugin/marketplace.json"
printf '[{"name":"quay","version":"1.0.0","source":"github"}]\n' > "${workdir}/.claude-plugin/marketplace.json"
# Prose carrier — must be present and parseable, else the baseline reads mode:'error' (NOT exit 0).
printf '# quay plugin\n\nquay plugin v1.0.0 - fixture.\n' > "${workdir}/plugin/README.md"
# Plain-text stamp — MUST be present, else the new entry reads mode:'error' and the whole case reports
# a false "checker always-red" (exit 4) instead of exercising the drift path (hard rule 3b).
printf '1.0.0\n' > "${workdir}/plugin/VERSION"
# Machine-field manifest (the 11th artifact) — the checker reads `.version` via JSON.parse and THROWS
# when it is absent or not a semver. Absent here ⇒ mode:'error' ⇒ false "checker always-red".
mkmanifest() { printf '{\n  "version": "%s"\n}\n' "$1" > "${workdir}/delivery-manifest.json"; }
mkmanifest "1.0.0"

checker_cmd() {
  node --experimental-strip-types "${scripts_dir}/version-consistency-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: all 11 artifacts at 1.0.0 → all-equal → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a consistent store (checker always-red?)" >&2
  exit 4
fi

# INJECT: bump packages/quay to 1.0.1 → drift → exit 1.
printf '{\n  "name": "quay",\n  "version": "1.0.1"\n}\n' > "${workdir}/packages/quay/package.json"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — version drift did not redden the checker" >&2
  exit 3
fi

# RESTORE: pin back to 1.0.0 → all-equal → exit 0.
mkver "quay" "${workdir}/packages/quay/package.json"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored consistency still reddens the checker" >&2
  exit 4
fi

# INJECT 2 (README-only): bump ONLY the prose carrier → drift → exit 1.
printf '# quay plugin\n\nquay plugin v1.0.1 - fixture.\n' > "${workdir}/plugin/README.md"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — README-only version drift did not redden the checker (entry not judging)" >&2
  exit 3
fi

# RESTORE: pin back to 1.0.0 → all-equal → exit 0.
printf '# quay plugin\n\nquay plugin v1.0.0 - fixture.\n' > "${workdir}/plugin/README.md"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored README consistency still reddens the checker" >&2
  exit 4
fi

# INJECT 3 (plugin/VERSION-only): bump ONLY the plain-text stamp → drift → exit 1.
printf '1.0.1\n' > "${workdir}/plugin/VERSION"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — plugin/VERSION-only version drift did not redden the checker (entry not judging)" >&2
  exit 3
fi

# RESTORE: pin back to 1.0.0 → all-equal → exit 0.
printf '1.0.0\n' > "${workdir}/plugin/VERSION"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored plugin/VERSION consistency still reddens the checker" >&2
  exit 4
fi

# INJECT 4 (delivery-manifest.json-only): bump ONLY the machine-field manifest → drift → exit 1.
mkmanifest "1.0.1"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — delivery-manifest.json-only version drift did not redden the checker (entry not judging)" >&2
  exit 3
fi

# RESTORE: pin back to 1.0.0 → all-equal → exit 0.
mkmanifest "1.0.0"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored delivery-manifest.json consistency still reddens the checker" >&2
  exit 4
fi

exit 0
