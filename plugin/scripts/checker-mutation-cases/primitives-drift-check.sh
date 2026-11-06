#!/usr/bin/env bash
# Mutation case for primitives-drift-check (gap-ac253-session-primitives-shared-layer-adoption, AC2
# 取假控制; direction reversed by gap-primitives-decouple-from-quay-fleet).
#
# Fixture: a temp root carrying packages/quay/src/primitives/*.mjs plus a LOCAL baseline manifest
# recording their sha256 values. ⛔ No git repo, no external path — the checker under test reads
# only this baseline, so the fixture proving it must not need one either.
#
# Inject → RED (one byte appended to ONE local primitive); restore → GREEN.
# Then the NOT-EVALUATED directions must exit 3 and ⛔ must NOT read as 0:
#   (a) the baseline manifest does not exist;
#   (b) the manifest exists but one recorded value is not a sha256 (a baseline the checker cannot
#       interpret — the dangerous direction: a naive implementation would compare against it,
#       conclude "drift", and print a fabricated RED for a reading it never took).
# And the retired `--fleet` flag must be a usage error (exit 2), never silently ignored.
set -u
name="primitives-drift-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="${workdir}/root"
prims="${root}/packages/quay/src/primitives"
manifest="${root}/plugin/scripts/primitives-drift-manifest.json"

rm -rf "${root}"
mkdir -p "${prims}" "${root}/plugin/scripts"

# The four fixture primitives — small stand-ins for the real files; the checker is byte-oriented and
# never parses them, so the content only needs to be distinguishable per file.
for f in pty-frame delivery-audit session-liveness session-schema; do
  printf '// fixture primitive: %s\nexport const name = "%s";\n' "$f" "$f" > "${prims}/${f}.mjs"
done

write_manifest() {
  local override_file="${1:-}" override_sha="${2:-}"
  python3 - "$prims" "$manifest" "$override_file" "$override_sha" <<'PY'
import hashlib, json, os, sys
prims, out, override_file, override_sha = sys.argv[1:5]
files = {}
for f in ("pty-frame.mjs", "delivery-audit.mjs", "session-liveness.mjs", "session-schema.mjs"):
    with open(os.path.join(prims, f), "rb") as fh:
        files[f] = hashlib.sha256(fh.read()).hexdigest()
if override_file:
    files[override_file] = override_sha
json.dump({
    "localDir": "packages/quay/src/primitives",
    "files": files,
}, open(out, "w"), indent=2)
PY
}

checker_argv() {
  node --no-warnings --experimental-strip-types "${checker_dir}/primitives-drift-check.ts" \
    --root "${root}" "$@"
}

checker_cmd() { checker_argv "$@" >/dev/null 2>&1; }

checker_rc() {
  local rc=0
  checker_argv "$@" >/dev/null 2>&1 || rc=$?
  echo "$rc"
}

write_manifest

# GREEN baseline: every file matches its recorded baseline.
if checker_cmd; then :; else
  echo "baseline RED on a byte-identical fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT: ONE appended byte in ONE local primitive → MUST go RED (判据能取假).
cp "${prims}/session-schema.mjs" "${workdir}/session-schema.bak"
printf '// one byte of drift\n' >> "${prims}/session-schema.mjs"
if checker_cmd; then
  echo "STAYED-GREEN — a one-byte local edit did not redden the drift check (判据能取假 violated)" >&2
  exit 3
fi

# RESTORE: byte-identical again → GREEN again.
cp "${workdir}/session-schema.bak" "${prims}/session-schema.mjs"
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored (byte-identical) fixture still reddens the drift check" >&2
  exit 4
fi

# ── NOT-EVALUATED (a): the baseline manifest does not exist ──────────────────────────────────────
mv "${manifest}" "${workdir}/manifest.bak"
rc="$(checker_rc)"
mv "${workdir}/manifest.bak" "${manifest}"
if [ "$rc" != "3" ]; then
  echo "NOT-EVALUATED(a) WRONG — absent baseline manifest gave exit ${rc}, expected 3 (⛔ must not be 0 = 'no drift')" >&2
  exit 3
fi

# ── NOT-EVALUATED (b): the manifest exists but a recorded value is not a sha256 ───────────────────
#
# The dangerous direction: the baseline is right there, so an implementation that compares blindly
# would report a fabricated RED for a value it never understood. "I cannot interpret the baseline"
# is its own state (exit 3), not "the file drifted" (exit 1) and not "consistent" (exit 0).
write_manifest "session-liveness.mjs" "not-a-sha256"
rc="$(checker_rc)"
if [ "$rc" != "3" ]; then
  echo "NOT-EVALUATED(b) WRONG — an uninterpretable baseline value gave exit ${rc}, expected 3" >&2
  exit 3
fi

# ── the retired `--fleet` flag is a usage error, never silently ignored ──────────────────────────
write_manifest
rc="$(checker_rc --fleet "${workdir}/does-not-exist")"
if [ "$rc" != "2" ]; then
  echo "RETIRED-FLAG WRONG — \`--fleet\` gave exit ${rc}, expected 2 (a stale two-sided caller must be told the external side is gone)" >&2
  exit 3
fi

# RESTORE the good baseline → GREEN again (the negative controls did not leave the fixture red).
if checker_cmd; then :; else
  echo "ALWAYS-RED — good baseline restored but the drift check still exits non-zero" >&2
  exit 4
fi

echo "primitives-drift-check mutation case: PASS (green → one-byte drift RED → restored green; NOT-EVALUATED exit 3 for an absent baseline and for an uninterpretable baseline value; --fleet exit 2)"
