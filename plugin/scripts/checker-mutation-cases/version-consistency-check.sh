#!/usr/bin/env bash
# Mutation case for version-consistency-check.
#
# ── THE JUDGMENT (tasks/gap-version-single-source-root-file-and-resolver, 2026-09-20) ───────────
# Was: every version-bearing artifact must carry the identical version (internal consistency).
# Is:  every artifact must equal `resolveVersion(VERSION,'tracked')` — the SINGLE SOURCE at the repo
#      root. So the fixture carries a `VERSION` file (bare `1.0.0`) AND all 13 carrier entries (10 files
#      — `package-lock.json` contributes four workspace members) stamped with the derived tracked form
#      (`1.0.0-dev`).
#      ⛔ 2026-09-20 (gap-version-marketplace-omit-and-spec-amendment): the two `marketplace.json`
#      `plugins[].version` entries left the carrier table with the field itself, so this fixture no
#      longer builds those two files — a fixture file that is not a carrier is exactly the "green
#      baseline that proves nothing" shape INVARIANT (a) below exists to forbid.
#
# ⚠️ INVARIANT (two halves, both required — the second half is new):
#   (a) the file set built below MUST cover the checker's VERSION_ENTRIES exactly — one artifact per
#       entry, every one parseable. Adding an entry to `scripts/version-consistency-check.ts` WITHOUT
#       adding its file here does not read as "a new dimension"; it makes the GREEN baseline fail (the
#       new entry lands in mode:'error'), and this whole case reports `always-red` — i.e. the gate that
#       exists to prove the checker is live instead reports the checker as broken, and every fan-in in
#       the repo reds at the static phase. That is exactly what `ee49cb056` (2026-09-15) did by adding
#       the delivery-manifest.json entry alone; the missing file here is Inject 4's subject.
#   (b) a `VERSION` file must be present too. It is now the SOURCE the judgment is made against: absent,
#       the checker reports mode:'error' and the baseline reddens in exactly the always-red shape above.
#       Inject 5 covers the judgment reading it; Inject 6 covers the half the OLD all-equal judgment was
#       structurally blind to.
#
# Inject 1: bump ONE machine field (packages/quay) to 1.0.1-dev → drift → the checker MUST exit 1 (RED).
# Restore: pin it back to 1.0.0-dev → the checker MUST exit 0 (GREEN).
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
# Inject 7 (gap-version-stamp-generator-and-build-wiring): bump ONLY ONE of `package-lock.json`'s four
#   workspace entries → drift → MUST exit 1 (RED). The lockfile was outside this union entirely until
#   that task, so "the four entries were added" and "the four entries actually judge" is not a
#   hypothetical distinction here. Same doctrine as Injects 2/3/4. Restore → MUST exit 0 (GREEN).
# Inject 5 (AC5 counter-criterion, hard rule 4 推论三): DELETE `VERSION` — the checker must exit
#   non-zero. This is the case that separates "the checker reads the production carrier" from "the
#   checker echoes its own fixture": with the source gone there is nothing to agree with, and a
#   checker that still exits 0 is proving only that it can read its own fixture. Restore → exit 0.
# Inject 6 (THE NEW JUDGMENT'S BLIND SPOT — the reason this case exists after the change): bump ALL
#   carrier entries to 1.0.1-dev while `VERSION` stays 1.0.0 — a UNIFORMLY stale tree. Under the OLD
#   "carriers agree with each other" rule this was GREEN (all equal!) and that is precisely the defect
#   the single-source judgment was introduced to remove. MUST exit 1 (RED). Restore → exit 0 (GREEN).
set -u
name="version-consistency-check"
workdir="${1:?usage: $name.sh <workdir>}"
scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/scripts"

mkdir -p "${workdir}/packages/quay" "${workdir}/packages/quay-native" \
  "${workdir}/packages/quay-github" "${workdir}/packages/quay-backlog" \
  "${workdir}/plugin/.claude-plugin" "${workdir}/plugin/vendor/quay"

# The derived tracked form the carriers must carry, and the bare base the source must hold.
carrier_ver="1.0.0-dev"
base_ver="1.0.0"

mkver() { printf '{\n  "name": "%s",\n  "version": "%s"\n}\n' "$1" "$2" > "$3"; }
mkver "quay"        "${carrier_ver}" "${workdir}/packages/quay/package.json"
mkver "quay-native" "${carrier_ver}" "${workdir}/packages/quay-native/package.json"
mkver "quay-github" "${carrier_ver}" "${workdir}/packages/quay-github/package.json"
mkver "quay-backlog" "${carrier_ver}" "${workdir}/packages/quay-backlog/package.json"
mkver "quay"        "${carrier_ver}" "${workdir}/plugin/vendor/quay/package.json"
printf '{\n  "name": "quay",\n  "version": "%s",\n  "main": "dist/entry.js"\n}\n' "${carrier_ver}" > "${workdir}/plugin/.claude-plugin/plugin.json"
# Prose carrier — must be present and parseable, else the baseline reads mode:'error' (NOT exit 0).
printf '# quay plugin\n\nquay plugin v%s - fixture.\n' "${carrier_ver}" > "${workdir}/plugin/README.md"
# Plain-text stamp — MUST be present, else the entry reads mode:'error' and the whole case reports a
# false "checker always-red" (exit 4) instead of exercising the drift path (hard rule 3b).
printf '%s\n' "${carrier_ver}" > "${workdir}/plugin/VERSION"
# Machine-field manifest (the 8th carrier FILE) — the checker reads `.version` via JSON.parse and THROWS
# when it is absent or not a semver. Absent here ⇒ mode:'error' ⇒ false "checker always-red".
mkmanifest() { printf '{\n  "version": "%s"\n}\n' "$1" > "${workdir}/delivery-manifest.json"; }
mkmanifest "${carrier_ver}"
# npm's lockfile carries FOUR version-bearing entries (the `packages/<dir>` workspace members) — added
# by gap-version-stamp-generator-and-build-wiring. ⛔ Same INVARIANT (a) as every other artifact here:
# without them the GREEN baseline lands in mode:'error' for those four entries, this whole case reports
# `always-red` (exit 4), and every fan-in in the repo reds at the static phase — the failure mode the
# header's (a) note describes for the delivery-manifest.json addition.
mkpackageslock() { printf '{\n  "name": "quay-workspace",\n  "version": "0.1.0",\n  "packages": {\n    "packages/quay": {\n      "version": "%s"\n    },\n    "packages/quay-native": {\n      "version": "%s"\n    },\n    "packages/quay-github": {\n      "version": "%s"\n    },\n    "packages/quay-backlog": {\n      "version": "%s"\n    }\n  }\n}\n' "$1" "$1" "$1" "$1" > "${workdir}/package-lock.json"; }
mkpackageslock "${carrier_ver}"
# THE SINGLE SOURCE. Bare semver, no suffix (a suffixed VERSION is mode:'error' by construction).
printf '%s\n' "${base_ver}" > "${workdir}/VERSION"

checker_cmd() {
  node --experimental-strip-types "${scripts_dir}/version-consistency-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: VERSION=1.0.0 and all 9 carrier files at 1.0.0-dev → all-equal with the source → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a consistent store (checker always-red?)" >&2
  exit 4
fi

# INJECT 1: bump packages/quay to 1.0.1-dev → drift → exit 1.
mkver "quay" "1.0.1-dev" "${workdir}/packages/quay/package.json"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — version drift did not redden the checker" >&2
  exit 3
fi

# RESTORE: pin back to 1.0.0-dev → all-equal → exit 0.
mkver "quay" "${carrier_ver}" "${workdir}/packages/quay/package.json"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored consistency still reddens the checker" >&2
  exit 4
fi

# INJECT 2 (README-only): bump ONLY the prose carrier → drift → exit 1.
printf '# quay plugin\n\nquay plugin v1.0.1-dev - fixture.\n' > "${workdir}/plugin/README.md"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — README-only version drift did not redden the checker (entry not judging)" >&2
  exit 3
fi

# RESTORE: pin back to 1.0.0-dev → all-equal → exit 0.
printf '# quay plugin\n\nquay plugin v%s - fixture.\n' "${carrier_ver}" > "${workdir}/plugin/README.md"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored README consistency still reddens the checker" >&2
  exit 4
fi

# INJECT 3 (plugin/VERSION-only): bump ONLY the plain-text stamp → drift → exit 1.
printf '1.0.1-dev\n' > "${workdir}/plugin/VERSION"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — plugin/VERSION-only version drift did not redden the checker (entry not judging)" >&2
  exit 3
fi

# RESTORE: pin back to 1.0.0-dev → all-equal → exit 0.
printf '%s\n' "${carrier_ver}" > "${workdir}/plugin/VERSION"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored plugin/VERSION consistency still reddens the checker" >&2
  exit 4
fi

# INJECT 4 (delivery-manifest.json-only): bump ONLY the machine-field manifest → drift → exit 1.
mkmanifest "1.0.1-dev"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — delivery-manifest.json-only version drift did not redden the checker (entry not judging)" >&2
  exit 3
fi

# RESTORE: pin back to 1.0.0-dev → all-equal → exit 0.
mkmanifest "${carrier_ver}"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored delivery-manifest.json consistency still reddens the checker" >&2
  exit 4
fi

# INJECT 5: DELETE the single source → the checker has nothing to judge against → exit non-zero.
rm -f "${workdir}/VERSION"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — deleting VERSION did not redden the checker (it is not reading the source carrier)" >&2
  exit 3
fi

# RESTORE: the bare source back → exit 0.
printf '%s\n' "${base_ver}" > "${workdir}/VERSION"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored VERSION still reddens the checker" >&2
  exit 4
fi

# INJECT 6: bump ALL carriers to 1.0.1-dev, leave VERSION at 1.0.0 — a UNIFORMLY STALE tree.
# Under the OLD all-equal rule this fixture was GREEN; the single-source judgment is what reddens it.
mkver "quay"         "1.0.1-dev" "${workdir}/packages/quay/package.json"
mkver "quay-native"  "1.0.1-dev" "${workdir}/packages/quay-native/package.json"
mkver "quay-github"  "1.0.1-dev" "${workdir}/packages/quay-github/package.json"
mkver "quay-backlog" "1.0.1-dev" "${workdir}/packages/quay-backlog/package.json"
mkver "quay"         "1.0.1-dev" "${workdir}/plugin/vendor/quay/package.json"
printf '{\n  "name": "quay",\n  "version": "1.0.1-dev",\n  "main": "dist/entry.js"\n}\n' > "${workdir}/plugin/.claude-plugin/plugin.json"
printf '# quay plugin\n\nquay plugin v1.0.1-dev - fixture.\n' > "${workdir}/plugin/README.md"
printf '1.0.1-dev\n' > "${workdir}/plugin/VERSION"
mkmanifest "1.0.1-dev"
mkpackageslock "1.0.1-dev"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a uniformly stale carrier set (all equal, none equal to VERSION) did not redden the checker" >&2
  exit 3
fi

# RESTORE: every carrier back to 1.0.0-dev → all-equal with the source → exit 0.
mkver "quay"         "${carrier_ver}" "${workdir}/packages/quay/package.json"
mkver "quay-native"  "${carrier_ver}" "${workdir}/packages/quay-native/package.json"
mkver "quay-github"  "${carrier_ver}" "${workdir}/packages/quay-github/package.json"
mkver "quay-backlog" "${carrier_ver}" "${workdir}/packages/quay-backlog/package.json"
mkver "quay"         "${carrier_ver}" "${workdir}/plugin/vendor/quay/package.json"
printf '{\n  "name": "quay",\n  "version": "%s",\n  "main": "dist/entry.js"\n}\n' "${carrier_ver}" > "${workdir}/plugin/.claude-plugin/plugin.json"
printf '# quay plugin\n\nquay plugin v%s - fixture.\n' "${carrier_ver}" > "${workdir}/plugin/README.md"
printf '%s\n' "${carrier_ver}" > "${workdir}/plugin/VERSION"
mkmanifest "${carrier_ver}"
mkpackageslock "${carrier_ver}"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored uniformly-consistent store still reddens the checker" >&2
  exit 4
fi

# INJECT 7 (package-lock only): bump ONLY one of the lockfile's four workspace entries → drift → exit 1.
# Same doctrine as Injects 2/3/4 (hard rule 4): without this path, "the four lock entries were added to
# the carrier table" and "the four lock entries actually participate in the judgment" are
# indistinguishable — and this file was outside the union entirely until
# gap-version-stamp-generator-and-build-wiring, so the "added but not judging" reading is not
# hypothetical here. The sibling entries are left at carrier_ver, which also pins that the four are read
# PER MEMBER: a whole-file rewrite would drag them along and the drift count below would not be 1.
# Bump EXACTLY ONE member (quay-backlog); its three siblings stay at carrier_ver.
printf '{\n  "name": "quay-workspace",\n  "version": "0.1.0",\n  "packages": {\n    "packages/quay": {\n      "version": "%s"\n    },\n    "packages/quay-native": {\n      "version": "%s"\n    },\n    "packages/quay-github": {\n      "version": "%s"\n    },\n    "packages/quay-backlog": {\n      "version": "1.0.1-dev"\n    }\n  }\n}\n' "${carrier_ver}" "${carrier_ver}" "${carrier_ver}" > "${workdir}/package-lock.json"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — package-lock-only version drift did not redden the checker (lock entries not judging)" >&2
  exit 3
fi

# RESTORE: the lockfile back to carrier_ver everywhere → exit 0.
mkpackageslock "${carrier_ver}"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored package-lock consistency still reddens the checker" >&2
  exit 4
fi

exit 0
