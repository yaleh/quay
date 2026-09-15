// @test-group engine
// freshness-producer-coverage-check.test.mjs — AC7 of
// tasks/gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger, WITH its two-way control.
//
// The AC demands a completeness judge over the subject -> producer mapping that "能取假" and whose
// negative control is BIDIRECTIONAL (fixture carrier + an unregistered subject => RED, naming it;
// removing it => GREEN). A check that can only print PASS is more expensive than no check
// (硬规则 3b), so every fixture below is a real tree on disk and the RED fixtures prove the
// judgement BITES.
//
// The last test reads the PRODUCTION carrier (.quay/productization-verification.jsonl, gitignored)
// and the PRODUCTION mapping. 硬规则 4 推论三: a criterion only a fixture can satisfy is an echo, not
// a measurement — so the production read is asserted here, and it asserts `evaluated` explicitly so
// "nothing to judge" can never be read as a pass.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseMapping,
  observedSubjects,
  judgeCoverage,
  runCoverageCheck,
  CoverageMappingError,
  DEFAULT_MAPPING_REL,
} from "../scripts/freshness-producer-coverage-check.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

// Every mkdtemp result is registered here and swept by the `after()` hook below — the carrier
// pattern tmp-leak-pairing-check.ts accepts. Without it this file is a NEW /tmp leak: measured by
// that gate as `mkdtemp-no-cleanup`, and by test-isolation-check as an unbaselined AC5 violation
// (the baseline can only shrink, so a new violation is a hard red, not a list entry).
const _createdDirs = [];
after(() => {
  for (const d of _createdDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** Materialize a fixture workspace: { relPath: content }. Cleanup is owned by `_createdDirs`. */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freshness-coverage-"));
  _createdDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
  }
  return root;
}

const MAPPING = {
  carrier: ".quay/productization-verification.jsonl",
  margin_snapshot: ".quay/goal-freshness-margin.json",
  subject_id_pattern: "^GOAL-009-AC-\\d+$",
  subject_requires_build_sha: true,
  producers: [
    {
      id: "coldstart-face",
      command: "bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --root <main>",
      wallclock_hours: 0.4,
      subjects: ["GOAL-009-AC-201", "GOAL-009-AC-203"],
    },
    {
      id: "upgrade-face",
      command: "bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --root <main>",
      wallclock_hours: 2,
      subjects: ["GOAL-009-AC-238", "GOAL-009-AC-239"],
    },
  ],
};

const carrierLine = (ac, sha) => JSON.stringify({ ac, [sha ? "build_sha" : "x"]: sha || true, ts: "2026-09-14T00:00:00Z" });
const carrierText = (subjects, shas = {}) =>
  subjects.map((s) => carrierLine(s, shas[s] ?? SHA_A)).join("\n") + "\n";
const marginText = (subjects) =>
  JSON.stringify({ at: "2026-09-14T00:00:00Z", k: 200, subjects: Object.fromEntries(subjects.map((s) => [s, { K: 200, d: 10, margin: 190 }])) });

const ALL4 = ["GOAL-009-AC-201", "GOAL-009-AC-203", "GOAL-009-AC-238", "GOAL-009-AC-239"];
const greenFixture = (extra = {}) =>
  fixture({
    [DEFAULT_MAPPING_REL]: MAPPING,
    ".quay/productization-verification.jsonl": carrierText(ALL4),
    ".quay/goal-freshness-margin.json": marginText(ALL4),
    ...extra,
  });

// ── pure judgement ───────────────────────────────────────────────────────────────────────────────

test("judgeCoverage: a registered set that equals the observed set has no findings", () => {
  const findings = judgeCoverage({ observedSubjects: ALL4, registeredSubjects: ALL4, marginSubjects: ALL4 });
  assert.deepEqual(findings, []);
});

test("SCALE-INVARIANT: a carrier record whose ac does not match the declared pattern is NOT a subject", () => {
  // The carrier holds 25 distinct ac kinds (AC88, GOAL-016-*, GOAL-018-*) written by other faces.
  // Treating them as refreshable subjects would be a false red — the scope rule is declared once and
  // applied mechanically, so this asserts the RULE, not a hardcoded exclusion list.
  const records = [
    { ac: "GOAL-009-AC-201", build_sha: SHA_A },
    { ac: "GOAL-018-AC-257", build_sha: SHA_B }, // right shape, wrong goal
    { ac: "AC88" }, // no goal prefix
    { ac: "GOAL-009-AC-204" }, // right goal, NO build_sha ⇒ not a carrier-type subject
  ];
  const obs = observedSubjects(records, /^GOAL-009-AC-\d+$/, true);
  assert.deepEqual(obs, ["GOAL-009-AC-201"]);
});

// ── hole 1: an unregistered subject appears in the carrier (the AC's own wording) ────────────────

test("RED (control 1) + GREEN (control 2): a carrier subject with no producer is named; removing it clears", () => {
  const root = greenFixture({ ".quay/productization-verification.jsonl": carrierText([...ALL4, "GOAL-009-AC-999"]) });
  const report = runCoverageCheck({ root });
  assert.equal(report.ok, false, "an unregistered carrier subject MUST redden the judgement");
  const unreg = report.findings.filter((f) => f.kind === "unregistered");
  assert.deepEqual(unreg.map((f) => f.subject), ["GOAL-009-AC-999"], "the finding must NAME the subject");
  assert.match(unreg[0].detail, /no producer in the mapping declares it/);

  // control 2: remove it ⇒ GREEN again (the direction that proves the red was caused by it).
  fs.writeFileSync(path.join(root, ".quay/productization-verification.jsonl"), carrierText(ALL4), "utf8");
  const after = runCoverageCheck({ root });
  assert.equal(after.ok, true, after.reason);
  assert.deepEqual(after.findings, []);
});

// ── hole 2: the criterion tracks a subject nobody produces (the 2026-09-13 crossing) ────────────

test("RED: a subject the AC-214 criterion tracks but no producer declares (margin_unregistered)", () => {
  const root = greenFixture({ ".quay/goal-freshness-margin.json": marginText([...ALL4, "GOAL-009-AC-232"]) });
  const report = runCoverageCheck({ root });
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.kind === "margin_unregistered");
  assert.ok(f, "the margin direction must fire — this is the hole carrier-inspection alone cannot see");
  assert.equal(f.subject, "GOAL-009-AC-232");
});

// ── hole 3: a producer registered for a subject that has never produced ─────────────────────────

test("RED: a registered subject with no carrier record at all (no_carrier_evidence)", () => {
  const root = greenFixture({ ".quay/productization-verification.jsonl": carrierText(["GOAL-009-AC-201"]) });
  const report = runCoverageCheck({ root });
  assert.equal(report.ok, false);
  const names = report.findings.filter((f) => f.kind === "no_carrier_evidence").map((f) => f.subject).sort();
  assert.deepEqual(names, ["GOAL-009-AC-203", "GOAL-009-AC-238", "GOAL-009-AC-239"]);
});

test("RED: a registered subject the criterion does not track (margin_orphan)", () => {
  const root = greenFixture({ ".quay/goal-freshness-margin.json": marginText(["GOAL-009-AC-201", "GOAL-009-AC-203"]) });
  const report = runCoverageCheck({ root });
  assert.equal(report.ok, false);
  const names = report.findings.filter((f) => f.kind === "margin_orphan").map((f) => f.subject).sort();
  assert.deepEqual(names, ["GOAL-009-AC-238", "GOAL-009-AC-239"]);
});

// ── the third state: absent carrier must NOT read as PASS ────────────────────────────────────────

test("NOT-EVALUATED: an absent carrier yields evaluated:false at exit 0 — never conflated with PASS", () => {
  const root = fixture({ [DEFAULT_MAPPING_REL]: MAPPING });
  const report = runCoverageCheck({ root });
  assert.equal(report.ok, true);
  assert.equal(report.evaluated, false, "evaluated must be false so the pass cannot be mistaken for a judgement");
  assert.match(report.reason, /NOT-EVALUATED: carrier absent/);
});

test("NOT-EVALUATED is distinguishable from PASS in the JSON envelope", () => {
  const root = fixture({ [DEFAULT_MAPPING_REL]: MAPPING });
  const notEvaluated = runCoverageCheck({ root });
  const passing = runCoverageCheck({ root: greenFixture() });
  assert.equal(notEvaluated.ok, passing.ok, "same exit-0 outcome…");
  assert.notEqual(notEvaluated.evaluated, passing.evaluated, "…but a DIFFERENT evaluated state");
  assert.notEqual(notEvaluated.reason.trim(), passing.reason.trim());
});

// ── the mapping's own surface is fail-closed ─────────────────────────────────────────────────────

test("FAIL-CLOSED: a missing or corrupt mapping is a usage/env error, never 'nothing to check'", () => {
  const missing = fixture({});
  assert.throws(() => runCoverageCheck({ root: missing }), CoverageMappingError);

  const corrupt = fixture({ [DEFAULT_MAPPING_REL]: "{ not json" });
  assert.throws(() => runCoverageCheck({ root: corrupt }), CoverageMappingError);

  // A mapping that parses but declares no producers is also refused — an empty registry would make
  // every observed subject report as unregistered, i.e. red for the WRONG reason (硬规则 3b).
  const empty = fixture({ [DEFAULT_MAPPING_REL]: { ...MAPPING, producers: [] } });
  assert.throws(() => runCoverageCheck({ root: empty }), CoverageMappingError);

  const badWallclock = fixture({
    [DEFAULT_MAPPING_REL]: { ...MAPPING, producers: [{ ...MAPPING.producers[0], wallclock_hours: 0 }] },
  });
  assert.throws(() => runCoverageCheck({ root: badWallclock }), CoverageMappingError);

  assert.throws(() => parseMapping("[]"), CoverageMappingError);
});

// ── the PRODUCTION read (硬规则 4 推论三) ──────────────────────────────────────────────────────────

test("PRODUCTION: the real carrier + real mapping are consistent, and the read is JUDGED (not skipped)", () => {
  const mappingAbs = path.join(REPO_ROOT, DEFAULT_MAPPING_REL);
  assert.ok(fs.existsSync(mappingAbs), `${DEFAULT_MAPPING_REL} must ship in the artifact`);
  const report = runCoverageCheck({ root: REPO_ROOT });
  // The carrier is gitignored runtime state: on a bare checkout this is the NOT-EVALUATED branch,
  // which is asserted DISTINCTLY rather than skipped, so this test can never pass by doing nothing.
  if (!report.evaluated) {
    assert.match(report.reason, /NOT-EVALUATED: carrier absent/);
    return;
  }
  assert.equal(report.ok, true, `production judgement must be clean: ${report.reason}`);
  assert.ok(report.observedSubjects.length > 0, "a judged production read must have observed subjects");
  assert.ok(report.marginSubjects !== null, "the production margin snapshot must be readable here");
  // Every observed subject is registered — the property the AC is about, asserted directly.
  for (const s of report.observedSubjects) {
    assert.ok(report.registeredSubjects.includes(s), `${s} observed in the carrier but unregistered`);
  }
});
