#!/usr/bin/env bash
# Mutation case for checked-in-write-check (the "no test writes into the checked-in tree" judge).
#
# WHAT IS MUTATED: not the checker's source text but the OBJECT it claims to judge — the judged
# tree's exposure to a test that creates/deletes an entry under a checked-in path. Each arm is a
# real reading with a real exit code, because a judge that never goes red under the defect it
# claims to catch is indistinguishable from one that always prints PASS (checker-mutation-check.sh's
# own header) — and this judge spent its whole life UNWIRED, so its three readings were never
# exercised by any gate until gap-suite-glob-universe-fixture-write-toctou.
#
# ARMS (each prints its exit code; the case fails if any reading is wrong):
#   1 GREEN          — an input writing only under os.tmpdir()               ⇒ exit 0
#   2 RED            — the same input with the write moved INTO the judged tree ⇒ exit 1, path named
#   3 GREEN (restore) — arm 1's input again                                   ⇒ exit 0
#   4 NOT-EVALUATED  — an input whose module evaluation never completes       ⇒ exit 3
#   5 --changed      — a git repo whose delta carries a test file that writes in the tree ⇒ exit 1
#   6 --changed      — a delta with NO test file ⇒ NOT-EVALUATED line, exit 0 (scoped-safe;
#                      "nothing judged" must never print PASS)
#   7 --changed      — a delta whose only test file is clean ⇒ exit 0
#
# The judged tree is FABRICATED inside $workdir (guard + runner copied in) and every scratch dir the
# arms create lives under $workdir — a case for "no test writes into the checked-in tree" that itself
# wrote into the checked-in tree would be self-defeating (same discipline as
# plugin/test/checked-in-write-check.test.mjs).
#
# Contract (checker-mutation-check.sh): exit 0 = behaved · 3 = STAYED-GREEN · 4 = ALWAYS-RED ·
# 2 = infrastructure error.
set -u
name="checked-in-write-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

guard_src="${checker_dir}/checked-in-write-guard.cjs"
runner_src="${checker_dir}/checked-in-write-run.cjs"
checker_src="${checker_dir}/checked-in-write-check.ts"
for f in "$guard_src" "$runner_src" "$checker_src"; do
  if [ ! -f "$f" ]; then
    echo "case FAILED: missing infrastructure file ${f}" >&2
    exit 2
  fi
done

root="${workdir}/root"
mkdir -p "${root}/plugin/scripts" "${root}/plugin/test"
cp "$guard_src" "$runner_src" "${root}/plugin/scripts/"

# ── the inputs ──────────────────────────────────────────────────────────────────────────────────────
cat > "${workdir}/clean.test.mjs" <<'EOF'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const d = fs.mkdtempSync(path.join(os.tmpdir(), "mutation-clean-"));
fs.writeFileSync(path.join(d, "e.jsonl"), "{}\n");
fs.rmSync(d, { recursive: true, force: true });
EOF
cat > "${workdir}/broken.test.mjs" <<'EOF'
import { x } from "./no-such-module-mutation-xyz.mjs";
EOF
# The defect shape of the real second instance: create + unlink a fixture INSIDE plugin/test,
# spelled RELATIVE to cwd (the validator's cwd IS the judged root) — the same spelling the real
# fixture used, so the arm cannot pass merely because of how the path is written.
cat > "${workdir}/intree-rel.test.mjs" <<'EOF'
import fs from "node:fs";
fs.writeFileSync("plugin/test/__no-group-fixture__.test.mjs", "// fixture\n");
fs.rmSync("plugin/test/__no-group-fixture__.test.mjs", { force: true });
EOF

run_checker() { # <root> <args…>  → prints "exit=<code>"
  local r="$1"; shift
  node --no-warnings --experimental-strip-types "$checker_src" --root "$r" "$@" >"${workdir}/out.txt" 2>&1
  echo "$?"
}

fail() { # <arm> <why>
  echo "case FAILED: arm $1 — $2" >&2
  cat "${workdir}/out.txt" >&2 2>/dev/null || true
  exit "$3"
}

echo "== arm 1 GREEN (writes only under os.tmpdir) =="
code="$(run_checker "$root" --files "${workdir}/clean.test.mjs")"
echo "exit=${code}  $(head -1 "${workdir}/out.txt")"
[ "$code" -eq 0 ] || fail "1-GREEN" "expected exit 0, got ${code}" 2

echo "== arm 2 RED (a fixture created+deleted under the judged tree, relative spelling) =="
code="$(run_checker "$root" --files "${workdir}/intree-rel.test.mjs")"
echo "exit=${code}  $(grep -c 'plugin/test/__no-group-fixture__.test.mjs' "${workdir}/out.txt") mention(s) of the landing path"
[ "$code" -eq 1 ] || fail "2-RED" "expected exit 1 (stayed green ⇒ the judge cannot see the defect it claims to catch), got ${code}" 3
grep -q "plugin/test/__no-group-fixture__.test.mjs" "${workdir}/out.txt" || fail "2-RED" "the landing path is not named" 2
grep -q "writeFileSync" "${workdir}/out.txt" || fail "2-RED" "the offending verb is not named" 2

echo "== arm 3 GREEN (unmutated object restored) =="
code="$(run_checker "$root" --files "${workdir}/clean.test.mjs")"
echo "exit=${code}"
[ "$code" -eq 0 ] || fail "3-RESTORE" "expected exit 0 after restore, got ${code} (always-red)" 4

echo "== arm 4 NOT-EVALUATED (input whose module evaluation never completes) =="
code="$(run_checker "$root" --files "${workdir}/broken.test.mjs")"
echo "exit=${code}  $(head -1 "${workdir}/out.txt")"
[ "$code" -eq 3 ] || fail "4-NOT-EVALUATED" "expected exit 3 (unread must not read as clean), got ${code}" 2
grep -q "^NOT-EVALUATED" "${workdir}/out.txt" || fail "4-NOT-EVALUATED" "the NOT-EVALUATED line is absent (3 must not be同形于 pass)" 2

# ── --changed arms: a tiny git repo with a resolvable base ─────────────────────────────────────────
grepo="${workdir}/grepo"
mkdir -p "${grepo}/plugin/scripts" "${grepo}/plugin/test"
cp "$guard_src" "$runner_src" "${grepo}/plugin/scripts/"
git -C "$grepo" init -q -b master
git -C "$grepo" -c user.email=case@local -c user.name=case add -A
git -C "$grepo" -c user.email=case@local -c user.name=case commit -q -m "base"

echo "== arm 5 --changed RED (the delta carries an in-tree writer, untracked) =="
cp "${workdir}/intree-rel.test.mjs" "${grepo}/plugin/test/delta-writer.test.mjs"
code="$(run_checker "$grepo" --changed)"
echo "exit=${code}  $(head -1 "${workdir}/out.txt")"
[ "$code" -eq 1 ] || fail "5-CHANGED-RED" "expected exit 1 (--changed must judge the delta's test files), got ${code}" 3
grep -q "delta-writer.test.mjs" "${workdir}/out.txt" || fail "5-CHANGED-RED" "the delta input is not named" 2

echo "== arm 6 --changed NOT-EVALUATED (delta with no test file) ⇒ line + exit 0 =="
rm -f "${grepo}/plugin/test/delta-writer.test.mjs"
echo "x" > "${grepo}/README.md"
code="$(run_checker "$grepo" --changed)"
echo "exit=${code}  $(head -1 "${workdir}/out.txt")"
[ "$code" -eq 0 ] || fail "6-CHANGED-EMPTY" "expected exit 0 (scoped-safe), got ${code}" 2
grep -q "^NOT-EVALUATED" "${workdir}/out.txt" || fail "6-CHANGED-EMPTY" "an empty delta printed PASS — 'nothing judged' read as 'judged clean'" 3

echo "== arm 7 --changed GREEN (the delta's only test file is clean) =="
cp "${workdir}/clean.test.mjs" "${grepo}/plugin/test/delta-clean.test.mjs"
code="$(run_checker "$grepo" --changed)"
echo "exit=${code}  $(head -1 "${workdir}/out.txt")"
[ "$code" -eq 0 ] || fail "7-CHANGED-GREEN" "expected exit 0 for a clean delta, got ${code}" 4
grep -q "^PASS" "${workdir}/out.txt" || fail "7-CHANGED-GREEN" "a clean delta did not print PASS" 2

if [ -e "${root}/plugin/test/__no-group-fixture__.test.mjs" ]; then
  echo "case FAILED: the RED arm leaked its fixture into the judged tree" >&2
  exit 2
fi
echo "case OK: checked-in-write-check took all three values (0/1/3) on a real object, and --changed is delta-scoped + scoped-safe"
exit 0
