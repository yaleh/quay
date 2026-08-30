#!/usr/bin/env bash
# Mutation case for suite-bucket-drift-check (gap-suite-bucket-dynamic-truth-drift-detector, ③-AC1/③-AC2).
# Fixture: a minimal workspace where a test's STATIC attribution covers its DYNAMIC truth → GREEN.
# Inject: rewrite the test so its static attribution is S (a scripts/test.sh mention) while its
# dynamic truth (the trace cache) still reaches an M file (plugin/scripts/foo.ts) → the checker MUST
# go RED (static-vs-truth-drift). Restore → back to GREEN.
set -u
name="suite-bucket-drift-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/test" "${workdir}/plugin/scripts" "${workdir}/.quay"
cd "${workdir}"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/suite-bucket-drift-check.ts" --gate --root "$1" >/dev/null 2>&1
}

# GREEN: static M (imports ../scripts/suite-bucket-attribution.ts) + dynamic M (plugin/scripts/foo.ts).
# dynamic ⊆ static ⇒ no drift. The fixture test is only READ (static attribution) — never executed.
write_green() {
  cat > plugin/test/a.test.mjs <<'EOF'
import { test } from 'node:test';
import { classifyPath } from '../scripts/suite-bucket-attribution.ts';
test('a', () => { classifyPath('plugin/scripts/x'); });
EOF
  cat > .quay/suite-fs-trace.jsonl <<'EOF'
{"file":"plugin/test/a.test.mjs","hash":"abc","reads":["plugin/scripts/foo.ts"],"writes":[]}
EOF
}

# INJECT: static S (a scripts/test.sh spawn arg) while the trace cache still reaches an M file.
write_red() {
  cat > plugin/test/a.test.mjs <<'EOF'
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
test('a', () => { spawnSync('bash', ['--test-command', 'scripts/test.sh'], { encoding: 'utf8' }); });
EOF
  cat > .quay/suite-fs-trace.jsonl <<'EOF'
{"file":"plugin/test/a.test.mjs","hash":"abc","reads":["plugin/scripts/foo.ts"],"writes":[]}
EOF
}

# GREEN baseline → exit 0.
write_green
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a green fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT: static S + dynamic M ⇒ static-vs-truth-drift must go RED.
write_red
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a static-S/dynamic-M mismatch did not redden the drift checker" >&2
  exit 3
fi

# RESTORE → back to GREEN.
write_green
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored green fixture still reddens the checker" >&2
  exit 4
fi

exit 0
