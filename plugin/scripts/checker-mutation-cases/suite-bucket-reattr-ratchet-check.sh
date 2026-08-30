#!/usr/bin/env bash
# Mutation case for suite-bucket-reattr-ratchet-check (gap-suite-bucket-dynamic-truth-drift-detector, ③-AC6).
# Fixture: a minimal workspace where a statically PURE-S test IS re-attributed → GREEN (layer 1 = 0).
# Inject: drop the reattribution entry (the reattribution file stays present but no longer covers the
# test) → the pure-S test is un-attributed ⇒ the checker MUST go RED (layer 1, exit 1). Restore → GREEN.
set -u
name="suite-bucket-reattr-ratchet-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/test" "${workdir}/.quay"
cd "${workdir}"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/suite-bucket-reattr-ratchet-check.ts" --gate --root "$1" >/dev/null 2>&1
}

# A statically PURE-S test: its only subject signal is the scripts/test.sh spawn arg (no plugin/scripts
# or packages reference) ⇒ bucketSetOf = {S}.
write_pure_s_test() {
  cat > plugin/test/pure-s.test.mjs <<'EOF'
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
test('pure-s', () => { spawnSync('bash', ['scripts/test.sh', '--help'], { encoding: 'utf8' }); });
EOF
}

# GREEN: the pure-S test IS re-attributed (judgment M) → layer 1 = 0 → exit 0.
write_green() {
  write_pure_s_test
  cat > .quay/suite-bucket-reattribution.jsonl <<'EOF'
{"file":"plugin/test/pure-s.test.mjs","judgment":"M","mechanism":"S","signal":[]}
EOF
}

# INJECT: the reattribution file stays PRESENT but no longer covers the pure-S test (it covers a
# different file) → the pure-S test is un-attributed ⇒ layer 1 RED.
write_red() {
  write_pure_s_test
  cat > .quay/suite-bucket-reattribution.jsonl <<'EOF'
{"file":"plugin/test/other.test.mjs","judgment":"M","mechanism":"S","signal":[]}
EOF
}

# GREEN baseline → exit 0.
write_green
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a green fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT: pure-S un-attributed ⇒ layer 1 must go RED.
write_red
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a pure-S un-attributed test did not redden the ratchet checker" >&2
  exit 3
fi

# RESTORE → back to GREEN.
write_green
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored green fixture still reddens the checker" >&2
  exit 4
fi

exit 0
