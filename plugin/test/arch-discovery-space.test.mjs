// @test-group engine
// Fixture tests for the architecture-discovery SPACE instrument's decision rules
// (docs/analysis/arch-discovery-space.mjs). Pure functions only — no git, no repo, no network.
//
// Fixture families (Plan step 4):
//   1. stale / legit / undetermined under the PRE-REGISTERED rule.
//   2. the E3 fix: a test counts only if it IMPORTS the literal's own module (specifier resolved),
//      not merely because it contains the symbol's bare name.
// Every emitted record kind/value is also validated against the PRODUCTION store, so the test fails
// if the store's vocabulary drifts away from what the tool writes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifySpace, e3Hits, importSpecifiers, resolveSpecifier, sameModuleResolved,
  RULE_TO_STORE_VERDICT, sourceEvidence, carrierEvidence, Sink,
  RULE_DRIFT, RULE_LEGIT, RULE_UNDETERMINED,
} from "../../docs/analysis/arch-discovery-space.mjs";
import { validateRecord } from "../../docs/analysis/architecture-evidence-store.mjs";

const E = (named) => ({ state: "evaluated", named });
const H = (hits) => ({ state: "evaluated", hits });
const NE = () => ({ state: "not-evaluated" });

// ── family 1: the pre-registered rule ───────────────────────────────────────────────────────────────
test("rule: E1=stale ∧ ¬E2 ∧ ¬E3 ⇒ drift-hypothesis", () => {
  assert.equal(classifySpace({ e1: "stale", e2: E([]), e3: H([]) }), RULE_DRIFT);
  assert.equal(classifySpace({ e1: "stale", e2: E([]), e3: NE() }), RULE_DRIFT);
});

test("rule: (E2 ∨ E3) ∧ E1≠stale ⇒ legit-difference", () => {
  assert.equal(classifySpace({ e1: "authored-after", e2: E(["needs-human"]), e3: H([]) }), RULE_LEGIT);
  assert.equal(classifySpace({ e1: "authored-after", e2: E([]), e3: H(["plugin/test/x.test.mjs"]) }), RULE_LEGIT);
});

test("rule: everything else ⇒ undetermined — including stale-with-a-named-comment", () => {
  // authored-after with no rationale at all: neither the drift branch (E1 not stale) nor the legit branch.
  assert.equal(classifySpace({ e1: "authored-after", e2: E([]), e3: H([]) }), RULE_UNDETERMINED);
  // a not-evaluated reading never resolves to a verdict — NOT-EVALUATED must not share a value with "legit".
  assert.equal(classifySpace({ e1: "not-evaluated", e2: E([]), e3: H([]) }), RULE_UNDETERMINED);
  assert.equal(classifySpace({ e1: "authored-after", e2: NE(), e3: H([]) }), RULE_UNDETERMINED);
  // stale AND a comment names a missing value: the drift branch is blocked by E2, the legit branch by stale.
  assert.equal(classifySpace({ e1: "stale", e2: E(["draft"]), e3: H([]) }), RULE_UNDETERMINED);
});

test("rule labels map onto the store's DISCOVERY verdict vocabulary (no domain word as a verdict)", () => {
  assert.deepEqual(RULE_TO_STORE_VERDICT, { [RULE_DRIFT]: "supported", [RULE_LEGIT]: "refuted", [RULE_UNDETERMINED]: "undetermined" });
  for (const v of Object.values(RULE_TO_STORE_VERDICT)) assert.ok(["supported", "refuted", "undetermined"].includes(v));
});

// ── family 2: the E3 import-resolution fix ──────────────────────────────────────────────────────────
const MOD = "plugin/scripts/dev-stats-collect.ts";
const SRC_TEST = { path: "plugin/test/dev-stats-collect.test.mjs", content: `import { collect } from "../scripts/dev-stats-collect.ts";\nconst named = ["done"];` };
const OTHER_TEST = { path: "plugin/test/elsewhere.test.mjs", content: `import { x } from "../scripts/other.ts";\nconst named = ["done"];` };
const BARE_TEST = { path: "plugin/test/mention-only.test.mjs", content: `const named = ["done"];` };

test("E3 (old, by bare name) counts a generic local in ANY test — the known weakness", () => {
  const r = e3Hits({ testFiles: [SRC_TEST, OTHER_TEST, BARE_TEST], moduleFile: MOD, symbol: "named", mode: "name" });
  assert.equal(r.state, "evaluated");
  assert.deepEqual(r.hits.sort(), ["plugin/test/dev-stats-collect.test.mjs", "plugin/test/elsewhere.test.mjs", "plugin/test/mention-only.test.mjs"]);
});

test("E3 (fixed) counts ONLY a test that imports the literal's own module — a 197→1 collapse", () => {
  const r = e3Hits({ testFiles: [SRC_TEST, OTHER_TEST, BARE_TEST], moduleFile: MOD, symbol: "named", mode: "import" });
  assert.deepEqual(r.hits, ["plugin/test/dev-stats-collect.test.mjs"]);
  const byName = e3Hits({ testFiles: [SRC_TEST, OTHER_TEST, BARE_TEST], moduleFile: MOD, symbol: "named", mode: "name" });
  assert.equal(byName.hits.length, 3);
});

test("E3 is not-evaluated (never a silent zero) when the literal declares no symbol", () => {
  const r = e3Hits({ testFiles: [SRC_TEST], moduleFile: MOD, symbol: null, mode: "import" });
  assert.equal(r.state, "not-evaluated");
  assert.deepEqual(r.hits, []);
});

test("import specifiers: static, bare, and dynamic forms are all collected; packages are not repo files", () => {
  const src = `import a from "./a.ts";\nexport { b } from "../b.ts";\nimport "./side-effect.ts";\nconst c = await import("./dyn.ts");\nimport node from "node:fs";\nimport pkg from "@scope/pkg";`;
  assert.deepEqual(importSpecifiers(src).sort(), ["../b.ts", "./a.ts", "./dyn.ts", "./side-effect.ts", "@scope/pkg", "node:fs"]);
  assert.equal(resolveSpecifier("../scripts/foo.ts", "plugin/test/x.test.mjs"), "plugin/scripts/foo.ts");
  assert.equal(resolveSpecifier("node:fs", "plugin/test/x.test.mjs"), null);
  assert.equal(resolveSpecifier("@scope/pkg", "plugin/test/x.test.mjs"), null);
});

test("extension-swap equivalence: an import written .js resolves to the .ts literal's module", () => {
  assert.equal(sameModuleResolved("plugin/scripts/foo.js", "plugin/scripts/foo.ts"), true);
  assert.equal(sameModuleResolved("plugin/scripts/foo.mjs", "plugin/scripts/foo.ts"), true);
  assert.equal(sameModuleResolved("plugin/scripts/foobar.ts", "plugin/scripts/foo.ts"), false);
  assert.equal(sameModuleResolved(null, "plugin/scripts/foo.ts"), false);
});

// ── records go through the PRODUCTION validator ─────────────────────────────────────────────────────
test("evidence records the tool emits validate against the store (source form and carrier form)", () => {
  const src = sourceEvidence("enum-surface-parity-check", "packages/quay/src/serve-goal.ts", 225, "  const GOAL_STATUS_ORDER = [", "c010f023a78b3634ed204d9bb23a0a90417a267e", { subject_key: "enum-surface:goal-status|packages/quay/src/serve-goal.ts#225" });
  assert.deepEqual(validateRecord("evidence", src), { ok: true, reasons: [] });
  const car = carrierEvidence("dependency-task-carrier", "tasks/x.md", 7, "## Acceptance Criteria", { provenance_task: "x" });
  assert.deepEqual(validateRecord("evidence", car), { ok: true, reasons: [] });
});

test("a Sink tally separates accepted from refused (a malformed record is REPORTED, never hidden)", () => {
  const s = new Sink();
  s.add("evidence", sourceEvidence("t", "a/b.ts", 1, "x", "0123456789"));
  s.add("evidence", { tool: "t" });                       // deliberately missing required fields
  assert.equal(s.validator.accepted, 1);
  assert.equal(s.validator.refused, 1);
  assert.ok(Object.keys(s.validator.reasons).some((r) => r.startsWith("SCHEMA_MISSING:")));
});
