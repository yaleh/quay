#!/usr/bin/env bash
# Mutation case for suite-bucket-reattr-ratchet-check (gap-suite-bucket-dynamic-truth-drift-detector,
# ③-AC6 layer 1 and ③-AC8 layer 3).
# Fixture: a minimal workspace where a statically PURE-S test IS re-attributed and every entry names a
# live suite file → GREEN (layer 1 = 0, layer 3 = 0).
# Cycle A (③-AC6 / layer 1): drop the reattribution entry for the pure-S test → un-attributed ⇒ RED.
# Cycle B (③-AC8 / layer 3): keep the test attributed, but DELETE a suite test file the record still
#   names → zombie entry ⇒ RED. Restore → GREEN.
# Both directions are exercised because either one alone can pass while the other is a恒绿 check.
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

# GREEN: the pure-S test IS re-attributed (judgment M), and the other entry names a LIVE suite file
# (so layer 3 sees no zombie) → layer 1 = 0, layer 3 = 0 → exit 0.
write_green() {
  write_pure_s_test
  write_other_test
  cat > .quay/suite-bucket-reattribution.jsonl <<'EOF'
{"file":"plugin/test/pure-s.test.mjs","judgment":"M","mechanism":"S","signal":[]}
{"file":"plugin/test/other.test.mjs","judgment":"M","mechanism":"S","signal":[]}
EOF
}

# A second live suite test, so an entry naming it is NOT a zombie.
write_other_test() {
  cat > plugin/test/other.test.mjs <<'EOF'
import { test } from 'node:test';
test('other', () => {});
EOF
}

# INJECT A (layer 1): the pure-S test keeps NO entry of its own → un-attributed ⇒ layer 1 RED.
# The other entry still names a live file, so layer 1 is the ONLY reddening cause.
write_red_layer1() {
  write_pure_s_test
  write_other_test
  cat > .quay/suite-bucket-reattribution.jsonl <<'EOF'
{"file":"plugin/test/other.test.mjs","judgment":"M","mechanism":"S","signal":[]}
EOF
}

# INJECT B (layer 3): the pure-S test IS attributed (layer 1 clean) but the record still names a file
# that has been DELETED → the entry is a zombie ⇒ layer 3 RED, and layer 1 must stay clean.
write_red_layer3() {
  write_pure_s_test
  cat > .quay/suite-bucket-reattribution.jsonl <<'EOF'
{"file":"plugin/test/pure-s.test.mjs","judgment":"M","mechanism":"S","signal":[]}
{"file":"plugin/test/other.test.mjs","judgment":"M","mechanism":"S","signal":[]}
EOF
  rm -f plugin/test/other.test.mjs
}

# GREEN baseline → exit 0.
write_green
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a green fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT A: pure-S un-attributed ⇒ layer 1 must go RED.
write_red_layer1
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a pure-S un-attributed test did not redden the ratchet checker (layer 1)" >&2
  exit 3
fi

# INJECT B: an entry whose file was deleted ⇒ layer 3 must go RED. The pure-S test stays attributed,
# so a checker that returns red here has genuinely judged the zombie, not layer 1.
write_red_layer3
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a zombie reattribution entry (file deleted, entry kept) did not redden the checker (layer 3)" >&2
  exit 3
fi

# RESTORE → back to GREEN.
write_green
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored green fixture still reddens the checker" >&2
  exit 4
fi

exit 0
