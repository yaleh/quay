// @test-group engine
// develop-deliver-tgz-evidence-transport.test.mjs — gap-third-party-evidence-no-transport-to-
// driving-repo-carrier: the cross-host evidence produced by verify-deliver-coldstart.sh on B/C
// (records written to <remote cwd>/.quay/productization-verification.jsonl) had NO transport layer
// back to the driving repo's carrier — the only writer wrote wherever it ran, and the注释-点名的
// `develop-deliver-tgz.sh --verify-coldstart` did not exist. This test pins the transport/dedup
// function now added to develop-deliver-tgz.sh (AC5, two directions):
//
//   ① a fixture evidence file carrying GOAL-009-AC-* lines appends into the target carrier, and a
//     repeat append of the SAME file is idempotent (0 new lines — Plan step 3 dedup on
//     (ts,ac,host,project_root) so repeated transport must not inflate one record into many);
//   ② a missing / empty evidence file returns a DISTINGUISHABLE not-evaluated value (non-zero,
//     `NOT-EVALUATED`) rather than success, and the target carrier is left unchanged (硬规则 3b —
//     a silent exit 0 on "no evidence" is exactly the failure this task forbids).
//
// Both directions run through `--selfcheck-evidence` (hermetic: temp dir + python3 JSON parsing,
// no build/scp/ssh), mirroring the existing --selfcheck pattern in develop-deliver-tgz.test.mjs.
//
// Run:
//   node --test plugin/test/develop-deliver-tgz-evidence-transport.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "develop-deliver-tgz.sh");

function run(args) {
  return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
}

test("① evidence file with GOAL-009-AC-* lines → carrier gains the lines, repeat is idempotent", () => {
  const r = run(["--selfcheck-evidence", "positive"]);
  assert.equal(r.status, 0, `--selfcheck-evidence positive must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /positive PASS/, "the positive direction must report PASS");
  assert.match(r.stdout, /positive first-append → EVIDENCE-TRANSPORT appended=2/,
    "first append must add exactly the 2 fixture GOAL-009-AC-* lines");
  assert.match(r.stdout, /positive repeat-append → EVIDENCE-TRANSPORT appended=0/,
    "repeat append of the SAME evidence file must add 0 lines (dedup idempotent)");
});

test("② empty/missing evidence → distinguishable NOT-EVALUATED, not success (carrier unchanged)", () => {
  const r = run(["--selfcheck-evidence", "negative"]);
  assert.equal(r.status, 0, `--selfcheck-evidence negative must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /negative PASS/, "the negative direction must report PASS");
  assert.match(r.stdout, /NOT-EVALUATED evidence-file-missing-or-unreadable/,
    "a missing evidence file must yield NOT-EVALUATED (not silent success)");
  assert.match(r.stdout, /NOT-EVALUATED evidence-file-zero-lines/,
    "an empty evidence file must yield NOT-EVALUATED (not silent success)");
  assert.match(r.stdout, /negative carrier lines=0/,
    "the target carrier must be unchanged (0 lines) when evidence is absent/empty");
});

// ③④ (AC7/AC8, gap-cross-host-evidence-run-incomplete-…): the completeness check must make a PARTIAL
// run (2 of 6 expected records returned) distinguishable from a COMPLETE run (all 6) — a partial
// transport previously reported `evidence_lines=4` and exited 0 (与完全成功同形, 硬规则 3b 同族).
test("③ partial evidence (2/6 expected records) → PARTIAL exit + missing ac list (both directions)", () => {
  const r = run(["--selfcheck-evidence-completeness"]);
  assert.equal(r.status, 0, `--selfcheck-evidence-completeness must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /selfcheck-evidence-completeness: PASS/,
    "the completeness selfcheck must report PASS");
  assert.match(r.stdout, /partial → rc=2 .*PARTIAL present=2 missing=4/,
    "2/6 expected records ⇒ PARTIAL (exit 2) with present=2 missing=4");
  assert.match(r.stdout, /missing=4 list=GOAL-009-AC-203,GOAL-009-AC-205,GOAL-009-AC-232,GOAL-015-AC-234/,
    "the PARTIAL line must enumerate exactly the 4 missing ac kinds");
  assert.match(r.stdout, /complete → rc=0 .*COMPLETE present=6/,
    "all 6 expected records ⇒ COMPLETE (exit 0)");
  assert.match(r.stdout, /all-missing → rc=1/,
    "no expected record present ⇒ NOT-EVALUATED (exit 1, distinct from PARTIAL)");
});

// ⑤ (AC-240, gap-ac240-e2e-closure-same-run-pairing): record-KIND completeness is not closure. The
// `expected_acs` set-difference is satisfied by AC-203 and AC-207 arriving from two DISJOINT batches
// of witnesses — which is precisely the measured origin reading (AC-203 roots={63ee9681,b95bd6f1},
// AC-207 roots={a2a5aac0}, intersection empty). Under --ac207-e2e the transport must ALSO judge the
// (host, project_root) PAIRING and, when it is missing, report a value distinguishable from ok
// (E2E_PAIR_MISSING=1 ⇒ the host is PARTIAL) instead of silently exiting 0 (硬规则 3b). Both
// directions are driven through the real product function; the negative controls change the
// JUDGMENT INPUT file, never the production carrier under .quay/.
test("⑤ AC-240 — (host, project_root) pairing is judged, and a missing pair is not a silent ok", () => {
  const r = run(["--selfcheck-e2e-pairing"]);
  assert.equal(r.status, 0, `--selfcheck-e2e-pairing must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /selfcheck-e2e-pairing: PASS/, "the pairing selfcheck must report PASS");
  // positive — both records share ONE project_root on one host ⇒ exit 0, no PARTIAL marker
  assert.match(r.stdout, /positive → rc=0 .*E2E-PAIR OK host=hostB roots=\/home\/verify\/root-x/,
    "paired records ⇒ exit 0 with an explicitly printed OK (never a bare exit 0)");
  // negative ① — only AC-207 (the origin defect's shape) ⇒ exit 2 + E2E_PAIR_MISSING=1 + the root sets
  assert.match(r.stdout, /ac207-only → rc=2 .*E2E_PAIR_MISSING=1 .*AC203_roots=\[\] AC207_roots=\['\/home\/verify\/root-x'\]/,
    "AC-207 without AC-203 ⇒ exit 2 (PARTIAL) with E2E_PAIR_MISSING=1 and the per-host root sets printed");
  // negative ② — both present but for different roots ⇒ exit 2 (the pairing is on the SAME root)
  assert.match(r.stdout, /different-roots → rc=2 .*E2E_PAIR_MISSING=1 .*AC203_roots=\['\/home\/verify\/root-a'\] AC207_roots=\['\/home\/verify\/root-b'\]/,
    "two records with different project_roots ⇒ exit 2 — 'both present' is not 'paired'");
  // not-evaluated — unreadable/empty evidence is distinct from PAIR-MISSING (缺值 ≠ 合格)
  assert.match(r.stdout, /empty-evidence → rc=1 NOT-EVALUATED/,
    "empty evidence ⇒ exit 1 (NOT-EVALUATED), distinct from the exit-2 PAIR-MISSING verdict");
});
