#!/usr/bin/env bash
# Mutation case for mirror-pair-drift-check (gap-mirror-pair-drift-policy-plugin-scripts-experiments,
# AC4 判据能取假). Fixture: a temp root with mirror dirs plugin/scripts/ and
# experiments/quay-perpetual-stream/scripts/ carrying a byte-identical pair → GREEN. Inject: a
# ONE-SIDED edit of ONE copy → the checker MUST go RED (判据2 能取假). Restore → GREEN. Then the
# allow-list direction: record the drifted pair's signature → ALLOWED (exit 0); edit ONE side further
# so the signature changes → DRIFT EXPANDED → RED (the exemption did not become a blind pass).
set -u
name="mirror-pair-drift-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="${workdir}/root"
left="${root}/plugin/scripts"
right="${root}/experiments/quay-perpetual-stream/scripts"
allowlist="${left}/mirror-pair-drift-allowlist.json"

mkdir -p "${left}" "${right}"

write_baseline() {
  printf '// a — fixture mirror baseline\n' > "${left}/a.ts"
  cp "${left}/a.ts" "${right}/a.ts"
  printf '// b — fixture mirror baseline\n' > "${left}/b.ts"
  cp "${left}/b.ts" "${right}/b.ts"
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/mirror-pair-drift-check.ts" --root "${root}" >/dev/null 2>&1
}

# GREEN baseline: byte-identical pair → exit 0.
write_baseline
if checker_cmd; then :; else
  echo "baseline RED on byte-identical mirror pair (checker always-red?)" >&2
  exit 4
fi

# INJECT: a one-sided edit of ONE copy → MUST go RED (判据2 能取假).
printf '%s\n' '// one-sided edit' >> "${left}/a.ts"
if checker_cmd; then
  echo "STAYED-GREEN — a one-sided edit did not redden the drift check (判据2 能取假 violated)" >&2
  exit 3
fi

# RESTORE: back to byte-identical → GREEN again.
cp "${left}/a.ts" "${right}/a.ts"
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored (byte-identical) pair still reddens the drift check" >&2
  exit 4
fi

# ALLOW-LIST direction: drift a pair, record its signature → ALLOWED (exit 0).
printf '%s\n' '// allowed drift — left' > "${left}/a.ts"
printf '%s\n' '// allowed drift — right' > "${right}/a.ts"
python3 - "$left" "$right" "$allowlist" <<'PY'
import hashlib, json, sys
def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()
left, right, out = sys.argv[1], sys.argv[2], sys.argv[3]
json.dump({"pairs": {"a.ts": {
    "reason": "mutation fixture drift",
    "pluginSha256": sha(left + "/a.ts"),
    "experimentsSha256": sha(right + "/a.ts"),
}}}, open(out, "w"), indent=2)
PY
if checker_cmd; then :; else
  echo "ALWAYS-RED — a matching-signature allow-listed drift reddened the check" >&2
  exit 4
fi

# DRIFT EXPANDED: edit ONE side further so the recorded signature no longer matches → MUST go RED.
printf '%s\n' '// expanded' >> "${left}/a.ts"
if checker_cmd; then
  echo "STAYED-GREEN — an expanded allow-listed drift did not redden the check (allow-list became a blind pass)" >&2
  exit 3
fi

echo "mirror-pair-drift-check mutation case: PASS (one-sided edit caught, allow-list expansion caught)" >&2
exit 0
