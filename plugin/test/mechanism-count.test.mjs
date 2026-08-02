// @test-group engine
// mechanism-count.test.mjs — calibration of the mechanism-count confirmation
// (tasks/gap-extract-mechanism-claims-calibration). `countMechanisms` turns the raw claim count
// (which over-counts coverage items as mechanisms and under-counts verb-invisible CLAIM markers)
// into a mechanism count that feeds the `> 2 → split` decision.
//
// Measured before calibration (raw extractMechanismClaims over the full Proposal):
//   DIR-124-A1b 24 → countMechanisms 2   (stage-event instrumentation = 1 mechanism; 2 because the
//                                         event-field/timing claims are separately named)
//   DIR-124-A4  18 → 1                   (single conformance script)
//   DIR-126-D   21 → 7                   (single telemetry mechanism; residual — see task body)
//   DIR-124-A   22 → 4                   (5 mechanism dimensions; split still triggered at >2)
//   DIR-124-B    2 → 4                   (CLAIM-B1..B14 markers recognized → 4 script families)
//
// Run: scripts/test.sh plugin/test/mechanism-count.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { countMechanisms, extractMechanismSubsections } from "../../experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts";
import { extractSection } from "../../experiments/quay-perpetual-stream/scripts/task-schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function proposalOf(taskId) {
  const raw = fs.readFileSync(path.join(REPO_ROOT, "tasks", taskId + ".md"), "utf8");
  const prop = extractSection(raw, "Proposal");
  const narrowed = extractMechanismSubsections(prop);
  return narrowed.trim() !== "" ? narrowed : prop;
}

// AC1: DIR-124-A1b — the headline overcount. 24 raw claims were falsely counted as 24 mechanisms
// (a false split-multi-mechanism trigger). countMechanisms must collapse the stage-event
// instrumentation to ≤2 so the `> 2 → split` decision no longer fires for a 1-mechanism task.
test("AC1: DIR-124-A1b's 24 raw claims collapse to ≤2 mechanisms (no false split)", () => {
  const r = countMechanisms(proposalOf("DIR-124-A1b"));
  assert.ok(r.mechanismCount <= 2, `A1b is 1 mechanism; got ${r.mechanismCount}`);
});

// AC2: DIR-124-A4 — 18 raw claims were 16 findings of ONE conformance script. Must be exactly 1.
test("AC2: DIR-124-A4's 18 raw findings collapse to 1 mechanism (no false split)", () => {
  const r = countMechanisms(proposalOf("DIR-124-A4"));
  assert.equal(r.mechanismCount, 1, `A4 is 1 mechanism; got ${r.mechanismCount}`);
});

// AC3: DIR-124-B — 2 raw claims under-counted 4 genuinely independent script families. Marker
// recognition must surface them without false-merging. Must be exactly 4.
test("AC3: DIR-124-B's 4 independent script families stay 4 (no false merge, no undercount)", () => {
  const r = countMechanisms(proposalOf("DIR-124-B"));
  assert.equal(r.mechanismCount, 4, `B is 4 mechanisms; got ${r.mechanismCount}`);
});

// AC4: DIR-124-A — 22 raw claims over-counted 5 mechanism dimensions; must remain >2 (the split is
// CORRECT for A) and must not collapse to 1. Achieved: 4.
test("AC4: DIR-124-A stays >2 (correct split preserved) and below the raw 22", () => {
  const r = countMechanisms(proposalOf("DIR-124-A"));
  assert.ok(r.mechanismCount > 2, `A is a genuine multi-mechanism task; got ${r.mechanismCount} (must split)`);
  assert.ok(r.mechanismCount < 22, `A's raw 22 overcount must fall; got ${r.mechanismCount}`);
  assert.ok(r.claims < 22, "A's claim count must fall below the raw extraction");
});

// AC5: DIR-126-D — single telemetry-record mechanism; the raw 21 must fall substantially even though
// the residual clustering still over-segments it (documented residual in the task body).
test("AC5: DIR-126-D's 21 raw claims fall substantially (single-mechanism residual)", () => {
  const r = countMechanisms(proposalOf("DIR-126-D"));
  assert.ok(r.mechanismCount < 21, `126-D raw 21 must fall; got ${r.mechanismCount}`);
  assert.ok(r.claims < 21, "claim count must fall below the raw extraction");
});

// AC6: merge rule — claims differing only in enumeration / mirror labels are one mechanism.
test("AC6: enumeration and mirror-label variants merge to one mechanism", () => {
  const text =
    "- **CLAIM-E1:** `alpha.ts` wires `beta.ts` at the `Prepared` boundary.\n" +
    "- **CLAIM-E2:** `alpha.ts` wires `beta.ts` at the `Build` boundary.\n" +
    "- **CLAIM-E3:** `alpha.ts` wires `beta.ts` at the `Audit` boundary.\n";
  const r = countMechanisms(text);
  assert.equal(r.mechanismCount, 1, "E1/E2/E3 differ only in stage enumeration → one mechanism");

  const mirrorText =
    "`execute-milestone.js` dispatches `run-identity.ts --create`.\n" +
    "`prepare-milestone.js` dispatches `run-identity.ts --create`.\n";
  const r2 = countMechanisms(mirrorText);
  assert.equal(r2.mechanismCount, 1, "the same operation in both mirrors → one mechanism");
});

// AC7: determinism — same input always produces the same mechanism count.
test("AC7: deterministic — same input → identical mechanism count across runs", () => {
  const prop = proposalOf("DIR-124-B");
  const a = countMechanisms(prop);
  const b = countMechanisms(prop);
  assert.equal(a.mechanismCount, b.mechanismCount);
  assert.equal(a.claims, b.claims);
  assert.deepEqual(a.mechanisms, b.mechanisms);
});
