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
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
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
  // the general relative-import form, and the guard's inability to be fooled by an unreadable list.
  // ⛔ The count is DERIVED from the consumer, not pinned — same discipline (and the same reason) as
  // consumerRefs below, applied one control earlier. It is |shipped .ts siblings that VALUE-import
  // ./gate-script-base.ts|, and the literal `2` went stale the moment a third sibling adopted the
  // shared harness (2026-09-18, extract createSelftest: pane-state-classify.ts gained
  // `import { createSelftest } from "./gate-script-base.ts"`) — i.e. it failed in exactly the shape
  // of a real violation, the one distinction this whole test exists to keep. Mirroring
  // transport_flat_files / transport_imports_of in JS is deliberate: two independent readings of the
  // same consumer is what makes this number a measurement (硬规则 4) instead of an echo.
  const gateScriptImporters = (() => {
    const src = readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "develop-deliver-tgz.sh"), "utf8");
    const flat = src.match(/^transport_flat_files\(\) \{([\s\S]*?)^\}$/m);
    assert.ok(flat, "transport_flat_files() must be discoverable — it is the shipped set's single source");
    // ⛔ The capture is the entry's path RELATIVE TO plugin/scripts, not just its basename: a shipped
    // entry may legitimately live outside $SCRIPT_DIR (the SPEC .md always has; the kernel
    // write-json-atomic leaf does since gap-arch-reverse-edges-zero — the transport is flat, so what
    // lands remotely is the BASENAME wherever it came from). A basename-only capture would silently
    // DROP that entry from this mirror, i.e. this "second reading" would stop covering the very file
    // the first reading was just corrected for — the two readings would then agree by omission.
    const shippedTs = [...flat[1].matchAll(/"\$\{SCRIPT_DIR\}\/([^"]+\.ts)"/g)].map((m) => m[1]);
    assert.ok(shippedTs.length >= 5, `the shipped .ts set must be discoverable (found ${shippedTs.length})`);
    return shippedTs.filter((name) => {
      if (name === "gate-script-base.ts") return false; // the dropped target cannot import itself
      // mirror of transport_imports_of: comment lines and `import type`/`export type` are erased by
      // --experimental-strip-types, so neither counts as a remote dependency.
      return readFileSync(path.join(REPO_ROOT, "plugin", "scripts", name), "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|#|\*|\/\*)/.test(l))
        .filter((l) => !/^\s*(import|export)\s+type\s+/.test(l))
        .some((l) => /(from|import)\s*"\.\/gate-script-base\.ts"/.test(l));
    });
  })();
  assert.ok(gateScriptImporters.length >= 1,
    "the drop control must be non-vacuous — with zero importers a `violations=0` reading would be the pass");
  assert.match(r.stdout, new RegExp(`drop-gate-script-base → violations=${gateScriptImporters.length} \\(expect ≥1, IMPORT-UNSHIPPED\\)`),
    `dropping a ./ relative-import target must be caught (the general form of the same defect), and the count must equal the CONSUMER's own value-importers of it (${gateScriptImporters.length}: ${gateScriptImporters.join(", ")}) — a pinned literal goes stale the moment a sibling adopts the harness`);
  assert.match(r.stdout, /synthetic-type-erasure → violations=1 \(expect exactly 1: the VALUE relative import\)/,
    "the type-erasure boundary: a VALUE ./ import is flagged, an `import type` one is NOT (false positives get guards switched off)");
  assert.match(r.stdout, /IMPORT-UNSHIPPED: x\.ts imports \.\/not-shipped\.ts/,
    "…and the flagged one must be the value import, by name");
  assert.ok(!/also-not-shipped/.test(r.stdout),
    "the type-only ./also-not-shipped.ts import must never be reported (--experimental-strip-types erases it)");
  // The count must be DERIVED from the consumer, ⛔ not pinned. It is |$SCRIPT_DIR siblings the verify
  // script references OUTSIDE its own selfcheck()|, and the literal `5` went stale the moment a sixth
  // reference appeared (gap-ac161-4th-regression… made verify-deliver-coldstart.sh read its own path
  // for the positional --scope scan). A stale literal fails in exactly the shape of a real violation —
  // the one distinction this whole test exists to keep. Mirroring the sed/grep in JS is deliberate:
  // two independent readings of the same consumer is what makes the expected number a measurement
  // (硬规则 4) instead of an echo, and it takes false only when the two readings DISAGREE.
  const consumerRefs = (() => {
    const lines = readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "verify-deliver-coldstart.sh"), "utf8").split("\n");
    const outside = []; // mirror of `sed '/^selfcheck() {/,/^}$/d'` — selfcheck() runs LOCALLY
    let inSelf = false;
    for (const line of lines) {
      if (inSelf) { if (/^\}$/.test(line)) inSelf = false; continue; }
      if (/^selfcheck\(\) \{$/.test(line)) { inSelf = true; continue; }
      outside.push(line);
    }
    const hits = outside.join("\n").match(/\$\{?SCRIPT_DIR\}?\/[A-Za-z0-9._-]+\.(ts|mjs|js|sh)/g) || [];
    return [...new Set(hits.map((h) => h.replace(/^\$\{?SCRIPT_DIR\}?\//, "")))].sort();
  })();
  const emptyList = r.stdout.match(/empty-list → violations=(\d+) \(expect ≥1/);
  assert.ok(emptyList && Number(emptyList[1]) >= 1,
    "an unreadable (empty) list must not read as 合格 — the reference half is driven by the CONSUMER");
  assert.equal(Number(emptyList[1]), consumerRefs.length,
    `the empty-list violation count must equal the CONSUMER's own sibling references (${consumerRefs.length}: ${consumerRefs.join(", ")}) — a pinned literal goes stale the moment a sibling reference is added, and a stale literal is indistinguishable from a real violation`);
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
  // EVERY verify mode must go through the ONE enumeration — a direct scp in any of them is exactly how
  // the 2026-09-11 defect stayed invisible. The expected number is DERIVED from the mode definitions,
  // ⛔ not hardcoded: the literal was 5 and went stale the moment a sixth mode appeared
  // (gap-ac257-ad-arm1-… added --verify-ac257) — and a stale literal fails in exactly the same shape
  // as a real violation, which is the one shape this whole test exists to keep distinguishable.
  // Per-mode slicing is also strictly stronger than a total count: it catches a mode with ZERO sites
  // and a mode with TWO (a total can be fooled by one of each).
  const modeDefs = [...src.matchAll(/^(verify_[a-z0-9_]+_mode)\(\) \{/gm)];
  assert.ok(modeDefs.length >= 5, `the verify modes must be discoverable (found ${modeDefs.length})`);
  for (let i = 0; i < modeDefs.length; i++) {
    const from = modeDefs[i].index;
    const to = i + 1 < modeDefs.length ? modeDefs[i + 1].index : src.length;
    assert.equal((src.slice(from, to).match(/^\s*if ! ship_verify_closure /gm) || []).length, 1,
      `${modeDefs[i][1]} must ship through ship_verify_closure — exactly one site; a direct scp here is how the 2026-09-11 defect stayed invisible`);
  }
  // the SECOND, independent gap on the same transport surface (measured 2026-09-11): neither verify
  // mode put the host's Node ≥20 floor on PATH, so on C the run inherits /usr/bin/node v18.19.1 and
  // `node --experimental-strip-types` dies with "bad option" ⇒ binding_state() reads "unreadable" for
  // EVERY project there too. Same syndrome, different cause — so it needs its own wiring control.
  assert.equal((src.match(/^verify_node_export_for\(\) \{/gm) || []).length, 1,
    "verify_node_export_for must be defined exactly once (single source for ALL verify modes)");
  assert.equal((src.match(/\$\(verify_node_export_for "\$\{hk\}"\)/g) || []).length, modeDefs.length,
    "EVERY verify mode's remote script must prepend the host's Node floor — the deliver mode always did (count DERIVED from the mode definitions, ⛔ not a literal that goes stale per new mode)");
});

// ── AC-247 (GOAL-016) — the SAME transport, for a ≥14-day-stalled legacy project ─────────────────
// gap-ac247-stalled-project-clean-takeover-record: `--verify-takeover --takeover-root <abs>` switches the
// remote script to `--ac247-takeover` and transports ONLY the ac=GOAL-016-AC-247 record. The property this
// pins is the one that decides whether the AC is real: **transport success ≠ production success** — a run
// that shipped back a field-complete but WRONG-ac record must be NOT-EVALUATED, never a silent ok
// (硬规则 3b 同族; the same shape as AC-240's "kinds complete but not paired").
test("AC-247 — --selfcheck-takeover-transport: AC-247 evidence is transported+COMPLETE, a different ac is NOT", () => {
  const r = run(["--selfcheck-takeover-transport"]);
  assert.equal(r.status, 0, `--selfcheck-takeover-transport must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /selfcheck-takeover-transport: PASS/);
  // ① positive: the record lands in the carrier and the declared ac set is judged COMPLETE
  assert.match(r.stdout, /positive append → EVIDENCE-TRANSPORT appended=1/,
    "an AC-247 evidence line must be transported (appended=1)");
  assert.match(r.stdout, /positive completeness → COMPLETE \(exit 0\)/,
    "the declared ac set [GOAL-016-AC-247] must be judged COMPLETE when present");
  // ② negative: transport succeeding on a DIFFERENT ac must not read as production success
  assert.match(r.stdout, /negative\(other-ac\) → NOT-EVALUATED/,
    "a run that produced the WRONG record must be NOT-EVALUATED (transport success ≠ production success)");
  // ③ negative: absent / zero-line evidence is NOT-EVALUATED, never a silent exit 0
  assert.match(r.stdout, /negative\(missing\/zero-lines\) → NOT-EVALUATED/,
    "missing or zero-line evidence must be NOT-EVALUATED (硬规则 3b)");
  // wiring: the transport AND the completeness check must both sit inside verify_takeover_mode's body
  assert.match(r.stdout, /write-points\(in-verify_takeover_mode\) hits=2/,
    "both the transport and the completeness call must be positionally inside verify_takeover_mode");
});

test("AC-247 — --verify-takeover requires an ABSOLUTE --takeover-root (a relative path is a usage error)", () => {
  // ⛔ The root is resolved ON the remote host, so a relative path silently resolves against the remote
  // ssh home — i.e. it would take over some other project than the one the criterion will name.
  const missing = run(["--verify-takeover"]);
  assert.equal(missing.status, 2, `--verify-takeover without --takeover-root must exit 2 (usage), got ${missing.status}`);
  assert.match(missing.stdout + missing.stderr, /requires --takeover-root/);
  const relative = run(["--verify-takeover", "--takeover-root", "archguard"]);
  assert.equal(relative.status, 2, `a relative --takeover-root must exit 2 (usage), got ${relative.status}`);
  assert.match(relative.stdout + relative.stderr, /must be an ABSOLUTE path on the remote host/);
});

test("AC-247 — the declared ac set is exactly GOAL-016-AC-247 (no second, silently-satisfying ac)", () => {
  const src = readFileSync(SCRIPT, "utf8");
  // positional: the declaration lives inside verify_takeover_mode's own body — moving it out (or
  // inheriting another mode's set) would let the mode pass on records it never asked for.
  const body = src.slice(src.indexOf("verify_takeover_mode() {"));
  const decl = body.slice(0, body.indexOf("\n}"));
  assert.match(decl, /local expected_acs="GOAL-016-AC-247"/,
    "verify_takeover_mode must declare its own expected ac set (GOAL-016-AC-247) inside its body");
  assert.match(decl, /check_evidence_completeness "\$\{evidence_local\}" "\$\{expected_acs\}"/,
    "the completeness check must be fed THAT declaration, not a literal elsewhere");
});

// ── AC-248 (GOAL-016) — the SAME transport, for a project quay itself drove ──────────────────────
// gap-ac248-adr-check-differential-record-producer: `--verify-adr-flip --target-root <abs> --task-id <id>`
// switches the remote script to `--ac248-adr-flip` and transports ONLY the ac=GOAL-016-AC-248 record.
// The property this pins is the one that decides whether the AC is real: **transport success ≠ production
// success** — a run that shipped back a field-complete but WRONG-ac record must be NOT-EVALUATED, never a
// silent ok (硬规则 3b 同族). This file also pins the JSON-BOOL SHAPE of the two flip readings, because
// the criterion reads them with `is False` / `is True`: `0`/`1` and `"false"`/`"true"` must BOTH fail, or
// the whole "flip" could be asserted with a number instead of a run.
test("AC-248 — --selfcheck-adrflip-transport: AC-248 evidence is transported+COMPLETE, a different ac is NOT", () => {
  const r = run(["--selfcheck-adrflip-transport"]);
  assert.equal(r.status, 0, `--selfcheck-adrflip-transport must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /positive append → EVIDENCE-TRANSPORT appended=1/,
    "an AC-248 evidence line must be transported (appended=1)");
  assert.match(r.stdout, /positive completeness → COMPLETE \(exit 0\)/,
    "the declared ac set [GOAL-016-AC-248] must be judged COMPLETE when present");
  // negative: transport succeeding on a DIFFERENT ac must not read as production success
  assert.match(r.stdout, /negative\(other-ac\) → NOT-EVALUATED/,
    "a run that produced the WRONG record must be NOT-EVALUATED (transport success ≠ production success)");
  // negative: absent / zero-line evidence is NOT-EVALUATED, never a silent exit 0
  assert.match(r.stdout, /negative\(missing\/zero-lines\) → NOT-EVALUATED/,
    "missing or zero-line evidence must be NOT-EVALUATED (硬规则 3b)");
  // the AC-248-specific shape control: both impostor forms must fail the criterion's own predicate
  assert.match(r.stdout, /json-bool-shape\(is-False\/is-True\) positive=1 impostors-refused=1/,
    "`0`/`1` and `\"false\"`/`\"true\"` must BOTH be refused by an `is False`/`is True` predicate");
  // wiring: the transport AND the completeness check must both sit inside verify_adr_flip_mode's body
  assert.match(r.stdout, /write-points\(in-verify_adr_flip_mode\) hits=2/,
    "both the transport and the completeness call must be positionally inside verify_adr_flip_mode");
});

test("AC-248 — --verify-adr-flip requires an ABSOLUTE --target-root AND an explicit --task-id", () => {
  // ⛔ The root is resolved ON the remote host, so a relative path silently resolves against the remote
  // ssh home — i.e. it would evidence a DIFFERENT project than the one the criterion will name.
  const missingRoot = run(["--verify-adr-flip"]);
  assert.equal(missingRoot.status, 2, `--verify-adr-flip without --target-root must exit 2 (usage), got ${missingRoot.status}`);
  assert.match(missingRoot.stdout + missingRoot.stderr, /requires --target-root/);
  const relative = run(["--verify-adr-flip", "--target-root", "archguard", "--task-id", "T-1"]);
  assert.equal(relative.status, 2, `a relative --target-root must exit 2 (usage), got ${relative.status}`);
  assert.match(relative.stdout + relative.stderr, /must be an ABSOLUTE path on the remote host/);
  // ⛔ --task-id is required: "guess the newest task" is exactly the AC-207 defect (the newest commit is
  // the bookkeeping flip), so the mode refuses to run without being told which task's product to read.
  const missingTask = run(["--verify-adr-flip", "--target-root", "/home/other/archguard"]);
  assert.equal(missingTask.status, 2, `--verify-adr-flip without --task-id must exit 2 (usage), got ${missingTask.status}`);
  assert.match(missingTask.stdout + missingTask.stderr, /requires --task-id/);
});

test("AC-248 — the declared ac set is exactly GOAL-016-AC-248 (no second, silently-satisfying ac)", () => {
  const src = readFileSync(SCRIPT, "utf8");
  // positional: the declaration lives inside verify_adr_flip_mode's own body — moving it out (or
  // inheriting another mode's set) would let the mode pass on records it never asked for.
  const body = src.slice(src.indexOf("verify_adr_flip_mode() {"));
  const decl = body.slice(0, body.indexOf("\n}"));
  assert.match(decl, /local expected_acs="GOAL-016-AC-248"/,
    "verify_adr_flip_mode must declare its own expected ac set (GOAL-016-AC-248) inside its body");
  assert.match(decl, /check_evidence_completeness "\$\{evidence_local\}" "\$\{expected_acs\}"/,
    "the completeness check must be fed THAT declaration, not a literal elsewhere");
  // ⛔ this mode READS a product; it must never drive one — no driver/worktree machinery in its body.
  assert.ok(!/driver\s+start|worktree\s+add/.test(decl.replace(/#.*/g, "")),
    "verify_adr_flip_mode must never DRIVE anything: the evidenced fix was driven out by the project's own drivers");
});

test("AC-248 — a non-qualifying evidence file yields a DISTINGUISHABLE verdict, never a silent `set -e` abort", () => {
  // Measured 2026-09-12: the first `--verify-adr-flip` dry run (a run that produced NO AC-248 record)
  // printed only up to the transport line and stopped — `check_evidence_completeness`'s python exits
  // non-zero ON PURPOSE for PARTIAL/ALL-MISSING, and a bare `result="$(…)"` under `set -e` kills the
  // script before the verdict line and before the final FAILED summary. That collapses "judged absent"
  // and "the script blew up" into the same shape — exactly what 硬规则 3b forbids for a NOT-EVALUATED.
  // This drives the REAL product function from a `set -e` shell and asserts both the verdict AND that
  // execution continued past it.
  const src = readFileSync(SCRIPT, "utf8");
  const start = src.indexOf("check_evidence_completeness() {");
  assert.ok(start >= 0, "check_evidence_completeness must exist");
  const fn = src.slice(start, src.indexOf("\n}", start) + 2);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ac248-nev-"));
  try {
    const evidence = path.join(tmp, "evidence.jsonl");
    writeFileSync(evidence, '{"ts":"2026-09-12T00:00:00Z","ac":"AC88","ok":true}\n');
    const driver = `set -euo pipefail\n${fn}\nif check_evidence_completeness "$EV" "GOAL-016-AC-248"; then echo "VERDICT=0"; else echo "VERDICT=$?"; fi\necho AFTER-VERDICT\n`;
    const r = spawnSync("bash", ["-c", driver], { encoding: "utf8", env: { ...process.env, EV: evidence } });
    assert.match(r.stdout, /ALL-MISSING/, "the verdict line must name the distinguishable reason");
    assert.match(r.stdout, /VERDICT=1/, "a run that produced no expected record must be NOT-EVALUATED (exit 1)");
    assert.match(r.stdout, /AFTER-VERDICT/, "execution must CONTINUE past the verdict (no silent set -e abort)");

    // positional: every call site must use the if-form (a bare call + `ck_rc=$?` is the abort shape).
    const bare = (src.match(/^\s*check_evidence_completeness "\$\{evidence_local\}"/gm) || []).length;
    assert.equal(bare, 0, "no call site may invoke check_evidence_completeness bare under set -e — use the if-form");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC-249 (GOAL-016) — the complete-change transport ─────────────────────────────────────────────
// gap-ac249-complete-change-code-doc-same-task-record: the SAME transport as AC-248, but the record it
// carries must satisfy a field-level predicate the AC owns — `commit_files` is the UNION of every
// commit filed under that one task_id and must carry BOTH a code path (`src/`|`scripts/`) and an
// ADR-007 doc path. One side alone does not count, so the impostor controls below are the load-bearing
// half: a "transport works" assertion would be satisfied by a producer that writes a one-sided record.
test("AC-249 — --selfcheck-complete-change-transport: AC-249 evidence is transported+COMPLETE, a different ac is NOT", () => {
  const r = run(["--selfcheck-complete-change-transport"]);
  assert.equal(r.status, 0, `--selfcheck-complete-change-transport must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /positive append → EVIDENCE-TRANSPORT appended=1/,
    "an AC-249 evidence line must be transported (appended=1)");
  assert.match(r.stdout, /positive completeness → COMPLETE \(exit 0\)/,
    "the declared ac set [GOAL-016-AC-249] must be judged COMPLETE when present");
  // negative: transport succeeding on a DIFFERENT ac must not read as production success
  assert.match(r.stdout, /negative\(other-ac\) → NOT-EVALUATED/,
    "a run that produced the WRONG record must be NOT-EVALUATED (transport success ≠ production success)");
  // negative: absent / zero-line evidence is NOT-EVALUATED, never a silent exit 0
  assert.match(r.stdout, /negative\(missing\/zero-lines\) → NOT-EVALUATED/,
    "missing or zero-line evidence must be NOT-EVALUATED (硬规则 3b)");
  // the AC-249-specific field predicate: read with the SAME two `any(...)` branches as the goal's
  // criterion, so a one-sided list (either side) and a `./`-prefixed path must ALL fail
  assert.match(r.stdout, /commit-files-predicate positive=1 impostors-refused\(code=1,doc=1,dot-slash=1\)/,
    "a code-only list, a doc-only list and a `./`-prefixed path must each be refused by the criterion's own predicates");
  // wiring: the transport AND the completeness check must both sit inside verify_complete_change_mode
  assert.match(r.stdout, /write-points\(in-verify_complete_change_mode\) hits=2/,
    "both the transport and the completeness call must be positionally inside verify_complete_change_mode");
});

test("AC-249 — --verify-complete-change requires an ABSOLUTE --target-root AND an explicit --task-id", () => {
  // ⛔ Same two rules as --verify-adr-flip, for the same two reasons: the root resolves ON the remote
  // host (a relative path would evidence a DIFFERENT project than the criterion names), and guessing
  // "the newest task" is exactly the AC-207 defect.
  const missingRoot = run(["--verify-complete-change"]);
  assert.equal(missingRoot.status, 2, `--verify-complete-change without --target-root must exit 2 (usage), got ${missingRoot.status}`);
  assert.match(missingRoot.stdout + missingRoot.stderr, /requires --target-root/);
  const relative = run(["--verify-complete-change", "--target-root", "archguard", "--task-id", "T-1"]);
  assert.equal(relative.status, 2, `a relative --target-root must exit 2 (usage), got ${relative.status}`);
  assert.match(relative.stdout + relative.stderr, /must be an ABSOLUTE path on the remote host/);
  const missingTask = run(["--verify-complete-change", "--target-root", "/home/other/archguard"]);
  assert.equal(missingTask.status, 2, `--verify-complete-change without --task-id must exit 2 (usage), got ${missingTask.status}`);
  assert.match(missingTask.stdout + missingTask.stderr, /requires --task-id/);
});

test("AC-249 — the declared ac set is exactly GOAL-016-AC-249, and the remote run passes the AC-249 step", () => {
  const src = readFileSync(SCRIPT, "utf8");
  // positional: the declaration lives inside verify_complete_change_mode's own body — moving it out (or
  // inheriting another mode's set) would let this mode pass on records it never asked for.
  const start = src.indexOf("verify_complete_change_mode() {");
  assert.ok(start >= 0, "verify_complete_change_mode must exist");
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.match(body, /local expected_acs="GOAL-016-AC-249"/,
    "the declared ac set must be exactly this AC's, inside its own mode body");
  // the remote invocation must actually ask for the AC-249 step — a flag-less remote run would produce
  // no record at all, and the completeness check would then (correctly) report NOT-EVALUATED forever.
  assert.match(body, /--ac249-complete-change/, "the remote script must be invoked with the AC-249 step");
  assert.ok(!/--ac248-adr-flip/.test(body),
    "this mode must NOT also declare AC-248 — the two ACs are separate readings with separate transports (a combined run would fail whenever either one fails)");
});

// ⑥ (gap-ac203-two-distinct-kinds-no-production-run AC1): 记录身份必须包含判据用来区分记录的每一个维度。
// 实测反例（2026-09-13，B 机）：同一次远端运行写出的两条 AC-203 记录 ts/ac/host/project_root 逐字相同、
// 【仅 kind 不同】，而 transport 的 sig 只取那四个键 ⇒ 第二条被静默丢弃 ⇒ 驱动方载体里永远只有一种 kind
// ⇒ AC-203「合格记录覆盖 ≥2 个不同 kind」在【运输层】被抵消（与产出侧、与判据都无关）。
// 取假条件：把 sig 换回四键元组 ⇒ 本测试 RED（appended=1）。
test("⑥ AC-203 kind dimension survives transport: same (ts,ac,host,project_root), differing only in kind → both land", () => {
  const r = run(["--selfcheck-evidence", "positive"]);
  assert.equal(r.status, 0, `--selfcheck-evidence positive must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /kind-dimension \(same ts\/ac\/host\/project_root, differing only in kind\) → EVIDENCE-TRANSPORT appended=2/,
    "two AC-203 records differing ONLY in kind must BOTH be appended (the old 4-key signature collapsed them)");
  assert.match(r.stdout, /kind-dimension carrier lines=2/,
    "both kinds must actually reach the carrier (a collapsed transport leaves 1)");
  assert.match(r.stdout, /kind-dimension repeat-append → EVIDENCE-TRANSPORT appended=0/,
    "record identity must stay tight enough that re-transporting the same file is still idempotent");
  assert.match(r.stdout, /kind dimension preserved/,
    "the positive PASS line must name the kind dimension (so a silent regression cannot hide behind a bare PASS)");
});

// ── gap-ac258-pipeline-destructive-steps-before-worker-preflight ────────────────────────────────
// AC1 的【位置判定】半边（硬规则 2：按位置判定，不按关键词——注释里提到不算命中）。
// AC1 的【行为】半边（探测失败 ⇒ 零破坏 / 探测通过 ⇒ 进入 ①②③）是 hermetic 夹具，住在
// verify-deliver-coldstart.sh 的 `--selfcheck` 里（那台检查器跑一次 ~57s，本仓库为它只付一次：
// verify-deliver-coldstart.test.mjs 的 "AC2+AC5 — --selfcheck exits 0 …" 断言它的退出码）。
// ⇒ 本文件【不】再 spawn 第二次；这里只钉住「调用点确实排在那两步之前」这条排序不变量。
test("AC-258 preflight — the probe call site precedes the delete-key step and the quay-init rerun (position, not keyword)", () => {
  const src = readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "verify-deliver-coldstart.sh"), "utf8");
  const bodyStart = src.indexOf("step_ac258_user_scope() {");
  assert.ok(bodyStart >= 0, "step_ac258_user_scope must exist");
  const bodyEnd = src.indexOf("\n}", bodyStart);
  assert.ok(bodyEnd > bodyStart, "step_ac258_user_scope body must be delimited");
  const body = src.slice(bodyStart, bodyEnd);
  const bodyLine = (needle) => {
    const i = body.indexOf(needle);
    assert.ok(i >= 0, `expected to find ${needle} inside step_ac258_user_scope`);
    return src.slice(0, bodyStart + i).split("\n").length;
  };
  const lPre = bodyLine('preflight_out="$(ac258_worker_preflight 2>&1)"');
  const lDel = bodyLine('del_json="$(ac258_delete_registrations "$home"');
  const lInit = bodyLine('bash "$plugin_root/scripts/quay-init.sh" --root "$root" --plugin-root "$plugin_root" --force --auto-commit-confirm)');
  assert.ok(lPre < lDel,
    `the worker preflight must run BEFORE the three-place delete-key step (preflight line ${lPre}, delete line ${lDel})`);
  assert.ok(lPre < lInit,
    `the worker preflight must run BEFORE the quay-init rerun (preflight line ${lPre}, quay-init line ${lInit})`);
  // 兄弟实例（硬规则 5b）：AC-257 共用同一段步骤序（破坏性的 quay-init 重跑 + 安装排在真实
  // todo→done 之前）⇒ 它也要这一道。只在 AC-258 里修会让 AC-257 成为无人守的那个空白。
  const b257s = src.indexOf("step_ac257_project_scope() {");
  const b257 = src.slice(b257s, src.indexOf("\n}", b257s));
  const i257pre = b257.indexOf("ac258_worker_preflight 2>&1");
  const i257init = b257.indexOf('bash "$plugin_root/scripts/quay-init.sh"');
  assert.ok(i257pre >= 0, "step_ac257_project_scope must also carry the worker preflight (DoD: 同族的 --verify-ac257，若共用同一段步骤序)");
  assert.ok(i257pre < i257init,
    "the AC-257 preflight must run BEFORE its quay-init rerun (the sibling instance of the same defect)");
});

test("AC-258 preflight — both --verify-ac257 and --verify-ac258 probe the target BEFORE building the deliverable", () => {
  const src = readFileSync(SCRIPT, "utf8");
  for (const [flag, mode] of [["--verify-ac257", "verify_ac257_mode"], ["--verify-ac258", "verify_ac258_mode"]]) {
    const start = src.indexOf(`if [ "\${${mode === "verify_ac257_mode" ? "verify_ac257" : "verify_ac258"}}" -eq 1 ]; then`);
    assert.ok(start >= 0, `the ${flag} dispatch block must exist`);
    const block = src.slice(start, src.indexOf("\nfi", start));
    const iPre = block.indexOf("worker_preflight_every_host");
    const iBuild = block.indexOf("build_develop_tgz");
    assert.ok(iPre >= 0, `${flag} must probe the target's worker usability before doing anything irreversible`);
    assert.ok(iBuild >= 0, `${flag} must still build the deliverable`);
    assert.ok(iPre < iBuild,
      `${flag} must probe BEFORE build_develop_tgz — a host that cannot run a worker must not cost a develop-tip build, let alone the three destructive remote steps (preflight offset ${iPre}, build offset ${iBuild})`);
    assert.match(block, /if ! worker_preflight_every_host; then[\s\S]*?exit 1/,
      `${flag} must ABORT on a failed preflight (a probe whose failure does not stop the run is decoration)`);
  }
});

test("AC-258 preflight — five DISTINCT verdicts, both timeout stages, and every host judged (⛔ no short-circuit)", () => {
  const r = run(["--selfcheck-worker-preflight"]);
  assert.equal(r.status, 0, `--selfcheck-worker-preflight must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /worker-preflight\(unreachable\) rc=4 verdict='unreachable'/,
    "ssh unreachable must be its own verdict (a different remedy from a dead login)");
  assert.match(r.stdout, /worker-preflight\(credentials\) rc=1 verdict='credentials'/,
    "a probe that ran and failed must be named credentials");
  assert.match(r.stdout, /worker-preflight\(absent\) rc=2 verdict='absent'/,
    "`claude` missing must NOT be conflated with credentials (硬规则 3b)");
  assert.match(r.stdout, /worker-preflight\(usable\) rc=0 verdict='usable'/);
  assert.match(r.stdout, /worker-preflight\(timeout, transport stage\) rc=3[^\n]*ssh connect exceeded/,
    "an ssh that hangs must be timeout, named at the transport stage");
  assert.match(r.stdout, /worker-preflight\(timeout, probe stage\) rc=3[^\n]*remote probe exceeded/,
    "a probe that hangs must be timeout too, but named at the probe stage (two distinct code paths — hard rule 5b)");
  assert.match(r.stdout, /verdict vocabulary\) distinct=5 of 6 samples/,
    "all five verdicts must be distinct — a verdict with no independent value cannot distinguish 'checked and qualified' from 'could not check'");
  assert.match(r.stdout, /every-host, all pass\) rc=0 hosts-reported=2/);
  assert.match(r.stdout, /every-host, one fails\) rc=1 hosts-reported=2/,
    "a failing host must abort the run AND still judge every host (enumeration, not a boolean — hard rule 3)");
  assert.match(r.stdout, /predicate single-spelling\) here='claude -p "say ok"' there='claude -p "say ok"'/,
    "the probe predicate must be spelled identically in both scripts — drift would read as an environment difference");
});

// ── gap-ac257-verify-leg-misses-declared-worker-env ──────────────────────────────────────────────
// The sibling half of the SAME defect the block above pins (硬规则 5b). Both legs share ONE step
// sequence — `step_ac257_project_scope`'s first action IS `ac258_worker_preflight`, same source as
// `step_ac258_user_scope` — so both need the caller-declared worker login face delivered into the
// remote process env. Only the AC-258 leg got it ⇒ on a target whose own OAuth is dead and which can
// only run a worker through a side-channel Anthropic-compatible endpoint (ad-arm1/orangevps: empty
// accessToken/refreshToken, expiresAt=0), the AC-257 remote preflight fell back to `credentials` and
// returned 1 BEFORE any destructive step ⇒ AC257-NOT-EVALUATED. The failure shape is "no record was
// written", which is the same shape as "the mechanism is broken" (硬规则 3b).
//
// Judged by POSITION, per mode (硬规则 2): the object is the LEADING command-substitution lines of
// that mode's own remote heredoc (⛔ not a whole-file keyword grep — a hit in another mode, in a
// comment, or in the selfcheck fixture must NOT satisfy this). Removing either call site reds this
// test, and the in-process negative control below proves the predicate is able to red at all
// (硬规则 4: a check that cannot fail is not a measurement).
test("AC-257/AC-258 — BOTH legs' remote preamble carries the caller-declared worker env (position, per-mode slice)", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const modeDefs = [...src.matchAll(/^(verify_[a-z0-9_]+_mode)\(\) \{/gm)];
  const bodyOf = (name) => {
    const i = modeDefs.findIndex((m) => m[1] === name);
    assert.ok(i >= 0, `${name} must exist`);
    const to = i + 1 < modeDefs.length ? modeDefs[i + 1].index : src.length;
    return src.slice(modeDefs[i].index, to);
  };
  // the preamble = the contiguous run of `$(...)` lines at the TOP of that mode's remote heredoc.
  // Contiguity matters: it is what makes this a real ordering assertion (the export must be part of
  // the prologue, before the step sequence), ⛔ not "somewhere in the heredoc".
  const preambleOf = (body, mode) => {
    const hStart = body.indexOf("remote_script=$(cat <<REMOTE");
    assert.ok(hStart >= 0, `${mode} must generate a remote script heredoc`);
    const hEnd = body.indexOf("\nREMOTE\n", hStart);
    assert.ok(hEnd > hStart, `${mode}'s remote heredoc must be terminated`);
    const heredoc = body.slice(hStart, hEnd);
    const pre = [];
    for (const l of heredoc.split("\n").slice(1)) {
      if (/^\$\(.*\)$/.test(l)) pre.push(l);
      else break;
    }
    return { pre, heredoc };
  };
  const carriesWorkerEnv = (pre) => pre.includes("$(ac258_worker_env_export)");

  for (const mode of ["verify_ac257_mode", "verify_ac258_mode"]) {
    const { pre, heredoc } = preambleOf(bodyOf(mode), mode);
    assert.deepEqual(pre, ['$(verify_node_export_for "${hk}")', "$(ac258_worker_env_export)"],
      `${mode}: the remote preamble must be [Node floor, declared worker env] — the declared login face must reach the remote PROCESS env, because that is what the preflight AND the driver/worker it later spawns both inherit (两个不同的下发点 = 探测量与实际 spawn 对象不是一回事)`);
    const iEnv = heredoc.indexOf("$(ac258_worker_env_export)");
    const iSteps = heredoc.indexOf('bash "\\${HOME}/verify-deliver-coldstart.sh"');
    assert.ok(iSteps > iEnv,
      `${mode}: the declared-env export must precede the remote step sequence (export at ${iEnv}, first step at ${iSteps})`);
  }

  // ── in-process negative control ─────────────────────────────────────────────────────────────
  // Run the SAME predicate against a copy with the call site removed. If this does not flip, the
  // positive assertion above is vacuous (and per 硬规则 3b a vacuous green is more expensive than an
  // absent check, because it reads as a guarantee).
  for (const mode of ["verify_ac257_mode", "verify_ac258_mode"]) {
    const { pre } = preambleOf(bodyOf(mode), mode);
    assert.ok(carriesWorkerEnv(pre), `${mode}: precondition for the negative control`);
    const mutated = pre.filter((l) => l !== "$(ac258_worker_env_export)");
    assert.equal(mutated.length, pre.length - 1,
      `${mode}: the negative control must actually remove the call site`);
    assert.ok(!carriesWorkerEnv(mutated),
      `${mode}: removing the call site MUST make the predicate false — otherwise this check cannot red for the defect it pins`);
  }
});
