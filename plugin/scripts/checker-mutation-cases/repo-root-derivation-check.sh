#!/usr/bin/env bash
# Mutation case for repo-root-derivation-check (the ratchet against hand-rolled "two levels up" roots).
#
# WHAT IS MUTATED: the OBJECT the ratchet claims to judge — a plugin/scripts file that re-derives the
# repo root from its own directory constant instead of calling repo-root.ts's repoRoot(). Each arm is a
# real reading with a real exit code, because a ratchet that never goes red under the defect it claims
# to catch is indistinguishable from one that always prints PASS (checker-mutation-check.sh's header).
#
# ARMS (each prints its exit code; the case fails if any reading is wrong):
#   1 GREEN          — a file whose root comes from repoRoot(), carrying a COMMENT and a copy-list
#                      STRING that both spell the defect shape ⇒ exit 0 (the position predicate is
#                      live: merely spelling it is not doing it)
#   2 RED            — the same file with the defect line present ⇒ exit 1, file:line named
#   3 GREEN (restore)— arm 1's file again ⇒ exit 0 (not always-red)
#   4 NOT-EVALUATED  — a root with an empty plugin/scripts ⇒ exit 3 + an explicit NOT-EVALUATED line
#                      ("nothing judged" must never print PASS — 硬规则 3b)
#
# ⛔ SELF-REFERENCE TRAP: this case lives under plugin/scripts/checker-mutation-cases/, and the ratchet
# deliberately EXCLUDES that directory from its scan surface — but the fixture it writes must still not
# carry the literal in the case's own SOURCE. The shape is therefore ASSEMBLED from shell fragments
# (`path.res''olve`, a `$Q` holding the up-one token): the case's source text never contains the
# pattern, so it cannot be read as an instance of the defect it injects.
#
# Contract (checker-mutation-check.sh): exit 0 = behaved · 3 = STAYED-GREEN · 4 = ALWAYS-RED ·
# 2 = infrastructure error.
set -u
name="repo-root-derivation-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
checker_src="${checker_dir}/repo-root-derivation-check.ts"
if [ ! -f "$checker_src" ]; then
  echo "case FAILED: missing checker ${checker_src}" >&2
  exit 2
fi

root="${workdir}/root"
empty="${workdir}/empty"
mkdir -p "${root}/plugin/scripts" "${empty}/plugin/scripts"

# The defect shape, assembled so THIS file's source does not spell it (see the trap note above).
P='path.res''olve'
Q='".."'

write_clean() { # <path> — a root that comes from the accessor, plus two legitimate MENTIONS
  cat > "$1" <<EOF
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./repo-root.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// pre-migration this file carried ${P}(__dirname, ${Q}, ${Q}) — that shape is the defect
const REPO_ROOT = repoRoot();
const COPY_LIST = ["repo-root.ts", "gate-script-base.ts"];
EOF
}

write_defect() { # <path> — the same file with the defect line present
  cat > "$1" <<EOF
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = ${P}(__dirname, ${Q}, ${Q});
const COPY_LIST = ["repo-root.ts", "gate-script-base.ts"];
EOF
}

run_checker() { # <root> → prints "exit=<code>"
  local r="$1"
  node --no-warnings --experimental-strip-types "$checker_src" --root "$r" >"${workdir}/out.txt" 2>&1
  echo "$?"
}

fail() { # <arm> <why> <code>
  echo "case FAILED: arm $1 — $2" >&2
  cat "${workdir}/out.txt" >&2 2>/dev/null || true
  exit "$3"
}

echo "== arm 1 GREEN (root from repoRoot(); comment + copy-list string merely SPELL the shape) =="
write_clean "${root}/plugin/scripts/sample.ts"
code="$(run_checker "$root")"
echo "exit=${code}  $(head -1 "${workdir}/out.txt")"
[ "$code" -eq 0 ] || fail "1-GREEN" "expected exit 0 (a mere mention must not redden a clean file), got ${code}" 3

echo "== arm 2 RED (the defect line is present) =="
write_defect "${root}/plugin/scripts/sample.ts"
code="$(run_checker "$root")"
echo "exit=${code}  $(head -1 "${workdir}/out.txt")"
[ "$code" -eq 1 ] || fail "2-RED" "expected exit 1 (stayed green ⇒ the ratchet cannot see the defect it claims to catch), got ${code}" 3
grep -q 'plugin/scripts/sample.ts:5' "${workdir}/out.txt" || fail "2-RED" "the offending file:line is not named (must be line 5, not the comment line)" 2
grep -q 'COPY_LIST' "${workdir}/out.txt" && fail "2-RED" "a non-defect line was reported" 2

echo "== arm 3 GREEN (unmutated object restored) =="
write_clean "${root}/plugin/scripts/sample.ts"
code="$(run_checker "$root")"
echo "exit=${code}"
[ "$code" -eq 0 ] || fail "3-RESTORE" "expected exit 0 after restore, got ${code} (always-red)" 4

echo "== arm 4 NOT-EVALUATED (empty scan surface ⇒ 3, never 0) =="
code="$(run_checker "$empty")"
echo "exit=${code}  $(head -1 "${workdir}/out.txt")"
[ "$code" -eq 3 ] || fail "4-NOT-EVALUATED" "expected exit 3 (an empty surface must not read as clean), got ${code}" 2
grep -q '^NOT-EVALUATED' "${workdir}/out.txt" || fail "4-NOT-EVALUATED" "the NOT-EVALUATED line is absent (3 must not be同形于 pass)" 2

rm -f "${root}/plugin/scripts/sample.ts"
echo "case OK: repo-root-derivation-check took all three values (0/1/3), and a mere mention stayed green"
exit 0
