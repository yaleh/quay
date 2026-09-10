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
