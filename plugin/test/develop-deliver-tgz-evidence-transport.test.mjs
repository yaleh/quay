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
import { readFileSync } from "node:fs";
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
  // AC3 also requires the host to be marked PARTIAL — a function returning 2 that nobody reads is not a
  // verdict. Positional wiring control: verify_coldstart_mode calls check_e2e_pairing, turns its exit 2
  // into `partial=1`, and does so under the --ac207-e2e gate (an unconditional pairing check would
  // report PARTIAL forever, since non-e2e evidence has no AC-207 to pair with).
  assert.match(r.stdout, /wiring\(in-verify_coldstart_mode\) call=1 partial=1_on_exit2=1 gated_by_ac207_e2e=1/,
    "the pairing verdict must be WIRED into verify_coldstart_mode (exit 2 ⇒ that host is PARTIAL), gated by --ac207-e2e");
});

test("⑥ shipped-set closure — the ENUMERATION is proven complete, not asserted (AC1..AC4)", () => {
  const r = run(["--selfcheck-transport-closure"]);
  assert.equal(r.status, 0, `--selfcheck-transport-closure must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /selfcheck-transport-closure: PASS/, "the closure selfcheck must report PASS");
  // the real set is clean, and the two halves of the 2026-09-11 defect are BOTH visible
  assert.match(r.stdout, /shipped set = 9 flat file\(s\) \+ 1 node_modules dep dir\(s\)/,
    "the shipped set must be the 9 flat files + the 1 node_modules dep (yaml)");
  assert.match(r.stdout, /positive → violations=0/,
    "the REAL shipped set must have zero closure violations");
  assert.match(r.stdout, /drop-checker → violations=1 \(expect ≥1, REF-UNSHIPPED\)/,
    "removing the checker from the set must be caught (AC1's 本来形态: verify-deliver-coldstart.sh invokes it)");
  assert.match(r.stdout, /REF-UNSHIPPED: provider-binding-resolvability-check\.ts/,
    "the violation must NAME the missing sibling, not just count it");
  // the second half — "只加一行 scp 不够" made mechanical rather than asserted
  assert.match(r.stdout, /drop-yaml → violations=1 \(expect ≥1, BARE-UNSHIPPED\)/,
    "keeping the checker but dropping node_modules/yaml must ALSO be caught — a bare specifier does not resolve remotely");
  assert.match(r.stdout, /BARE-UNSHIPPED: provider-binding-resolvability-check\.ts imports bare "yaml"/,
    "the bare-specifier violation must name the package (NODE_PATH does not apply to ESM)");
  // the general relative-import form, and the guard's inability to be fooled by an unreadable list
  assert.match(r.stdout, /drop-gate-script-base → violations=2 \(expect ≥1, IMPORT-UNSHIPPED\)/,
    "dropping a ./ relative-import target must be caught (the general form of the same defect)");
  assert.match(r.stdout, /synthetic-type-erasure → violations=1 \(expect exactly 1: the VALUE relative import\)/,
    "the type-erasure boundary: a VALUE ./ import is flagged, an `import type` one is NOT (false positives get guards switched off)");
  assert.match(r.stdout, /IMPORT-UNSHIPPED: x\.ts imports \.\/not-shipped\.ts/,
    "…and the flagged one must be the value import, by name");
  assert.ok(!/also-not-shipped/.test(r.stdout),
    "the type-only ./also-not-shipped.ts import must never be reported (--experimental-strip-types erases it)");
  assert.match(r.stdout, /empty-list → violations=5 \(expect ≥1/,
    "an unreadable (empty) list must not read as 合格 — the reference half is driven by the CONSUMER");
  // AC4 产物: the per-file import face must be printed (which sibling is not self-sufficient, and why)
  assert.match(r.stdout, /import-face provider-binding-resolvability-check\.ts -> \[\.\/gate-script-base\.ts \.\/repo-root\.ts node:fs node:path yaml\]/,
    "the import face of every shipped .ts must be printed — this is the artifact 硬规则 5b asks for");
  assert.match(r.stdout, /import-face runner-state-write\.ts -> \[\.\/write-json-atomic\.ts node:fs node:path\]/,
    "runner-state-write.ts's TYPE-ONLY ./full-suite-runner.ts import must NOT be flagged (erased by --experimental-strip-types)");
  // wiring: the enumeration must have ONE home. Both scp sites go through ship_verify_closure and the
  // sibling list appears exactly once — a second inline copy is precisely how the defect hid.
  const src = readFileSync(SCRIPT, "utf8");
  assert.equal((src.match(/^transport_flat_files\(\) \{/gm) || []).length, 1,
    "transport_flat_files must be defined exactly once (single source for BOTH modes)");
  assert.equal((src.match(/\$\{SCRIPT_DIR\}\/pane-state-classify\.ts/g) || []).length, 1,
    "a shipped sibling must be listed exactly once — a second inline copy defeats the closure check");
  assert.equal((src.match(/\$\{SCRIPT_DIR\}\/provider-binding-resolvability-check\.ts/g) || []).length, 1,
    "the checker must be listed exactly once — inline copies are how 2026-09-11 stayed invisible in BOTH modes");
  assert.equal((src.match(/^\s*if ! ship_verify_closure /gm) || []).length, 2,
    "BOTH scp sites (verify_coldstart_mode / verify_upgrade_mode) must ship through ship_verify_closure");
  // the SECOND, independent gap on the same transport surface (measured 2026-09-11): neither verify
  // mode put the host's Node ≥20 floor on PATH, so on C the run inherits /usr/bin/node v18.19.1 and
  // `node --experimental-strip-types` dies with "bad option" ⇒ binding_state() reads "unreadable" for
  // EVERY project there too. Same syndrome, different cause — so it needs its own wiring control.
  assert.equal((src.match(/^verify_node_export_for\(\) \{/gm) || []).length, 1,
    "verify_node_export_for must be defined exactly once (single source for BOTH modes)");
  assert.equal((src.match(/\$\(verify_node_export_for "\$\{hk\}"\)/g) || []).length, 2,
    "BOTH verify modes' remote scripts must prepend the host's Node floor — the deliver mode always did");
});
