// @test-group engine
// task-parsing-parity.test.mjs — the drift guard for the three parsing primitives PROMOTED to the
// product layer (gap-abi-promote-section-parsing-flip-store-reverse-import).
//
// The product layer (packages/quay/src/task-parsing.ts, next to abi.ts) is now the AUTHORITATIVE home
// of extractSection / parseFrontmatterCompletely / countAcCheckboxes. The native store
// (packages/quay-native/src/store.ts) consumes them from there — the ONE reverse import is gone.
//
// WHY this test exists: the mechanism layer (plugin/scripts/task-schema.ts + task-status-drift-check.ts)
// still needs these three functions for ITS OWN readers (parseTask / readDependsOn / the status-drift
// detector). It CANNOT statically import packages/quay/src/task-parsing.ts — build-plugin-dist stages
// plugin/ → packages/quay/plugin/ and bundles each entry WITHOUT the packages/ tree (the same reason
// loop-complete-task.ts / config-wiring-check.ts use DYNAMIC pathToFileURL imports; a static
// `../../packages/...` import fails esbuild's resolve). So the plugin keeps its own mechanism-layer
// copies, and THIS test pins them BEHAVIORALLY identical to the product source — a divergence here is
// the two frontmatter/section readers silently disagreeing (the exact drift class the promotion exists
// to end). "No private implementation" is enforced here as "no behaviorally-divergent implementation".
//
// Run: scripts/test.sh plugin/test/task-parsing-parity.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractSection, extractSectionFenceAware, parseFrontmatterCompletely, parseTask, frontmatterGoalAc, readGoalAc } from "../scripts/task-schema.ts";
import { countAcCheckboxes } from "../scripts/task-status-drift-check.ts";
import {
  extractSection as productExtractSection,
  parseFrontmatterCompletely as productParseFrontmatterCompletely,
  countAcCheckboxes as productCountAcCheckboxes,
} from "../../packages/quay/src/task-parsing.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TASKS_DIR = path.join(REPO_ROOT, "tasks");

// A representative task body exercising depth-aware section slicing (## vs ### nesting) and the
// absent-heading null return.
const TASK_BODY = `## Proposal

Do the thing.

## Plan

### Step 1
detail

### Step 2
more detail

## Acceptance Criteria

- [ ] first
- [x] second
`;

const FRONTMATTER = `id: gap-x
title: "example: with colon"
labels: [a, b]
goal_ac: AC-170
extra:
  schema: execution
  depends_on:
    - gap-a
    - gap-b
`;

test("extractSection — plugin copy matches product source (depth-aware slicing)", () => {
  for (const heading of ["Proposal", "Plan", "Acceptance Criteria", "Absent"]) {
    assert.deepEqual(
      extractSection(TASK_BODY, heading),
      productExtractSection(TASK_BODY, heading),
      `extractSection("${heading}") diverged`,
    );
  }
});

test("parseFrontmatterCompletely — plugin copy matches product source (full YAML round-trip)", () => {
  assert.deepEqual(
    parseFrontmatterCompletely(FRONTMATTER),
    productParseFrontmatterCompletely(FRONTMATTER),
  );
});

test("countAcCheckboxes — plugin copy matches product source (incl. fail-closed absent-section)", () => {
  const ac = extractSection(TASK_BODY, "Acceptance Criteria");
  assert.deepEqual(countAcCheckboxes(ac), productCountAcCheckboxes(ac));
  // fail-closed absent section: both must return the NaN total shape, not a silent {unchecked:0}.
  const absent = countAcCheckboxes(null);
  assert.deepEqual(absent, productCountAcCheckboxes(null));
  assert.equal(absent.sectionFound, false);
  assert.ok(Number.isNaN(absent.total), "absent section must be NaN, not 0");
});

// ── goal_ac top-level read (gap-goal-ac-task-linkage-top-level-field) ──
// AC1: parseTask reads goal_ac from TOP-LEVEL (not extra-nested). AC2: negative control — an
// unset goal_ac reads back null (≠ a concrete AC id; 缺值 = 未查), never a fabricated value.
test("goal_ac — parseTask reads it top-level; unset ⇒ null (AC1 + AC2 negative control)", () => {
  const withGoal = parseTask("---\nid: x\ngoal_ac: AC-170\n---\nbody");
  assert.equal(withGoal.goal_ac, "AC-170", "top-level goal_ac reads back via parseTask");
  const withoutGoal = parseTask("---\nid: x\n---\nbody");
  assert.equal(withoutGoal.goal_ac, null, "unset goal_ac ⇒ null, not a fabricated AC id");
  // extra-nested is NOT the home: it must not leak into the top-level projection.
  const nestedOnly = parseTask("---\nid: x\nextra:\n  goal_ac: AC-170\n---\nbody");
  assert.equal(nestedOnly.goal_ac, null, "goal_ac nested under extra is NOT read (top-level only)");
});

test("goal_ac — frontmatterGoalAc/readGoalAc single projection (delegates to the one parser)", () => {
  assert.equal(frontmatterGoalAc(parseFrontmatterCompletely("goal_ac: AC-177")), "AC-177");
  assert.equal(readGoalAc("goal_ac: AC-178"), "AC-178");
  assert.equal(readGoalAc("id: x"), null, "absent goal_ac ⇒ null");
  assert.equal(readGoalAc("goal_ac: ''"), null, "empty goal_ac ⇒ null");
});

// ── gap-extract-section-heading-interpolated-unescaped-into-regexp ────────────────────────────────
// extractSection used to interpolate its `heading` argument straight into `new RegExp(\`^(##+)\\s*
// ${heading}\\s*$\`)`, so a heading carrying a regex metacharacter was read as a PATTERN: `Plan (draft)`
// became the capture group `Plan draft` and never matched the literal `## Plan (draft)` line, and an
// unbalanced `(` threw at construction. Both copies now escape the heading through the kernel's
// `escapeRegExp` (Core: ./kernel/regex-escape.ts; plugin: ./regex-escape.ts shim) — the same escaper
// `SHAPE_REGISTRY` headings already relied on in store.ts. Escaping is a no-op for the plain section
// names every literal caller passes, so their behavior is unchanged; the case below pins the
// metacharacter behavior, and the differential below pins the two copies together on REAL task files.

const METACHAR_HEADINGS = [
  "Plan (draft)",
  "A+B",
  "Gap 4: `|batch| = 0`",
  "Bad (unbalanced",
  "a.b*c?d^e$f",
];

test("extractSection — metacharacter headings match literally on BOTH copies and never throw (case a)", () => {
  for (const heading of METACHAR_HEADINGS) {
    const body = `## ${heading}\n\nbody line one\nbody line two\n\n## Next\n\nafter\n`;
    let pluginResult;
    let productResult;
    assert.doesNotThrow(() => { pluginResult = extractSection(body, heading); }, `plugin copy must not throw on ${JSON.stringify(heading)}`);
    assert.doesNotThrow(() => { productResult = productExtractSection(body, heading); }, `product copy must not throw on ${JSON.stringify(heading)}`);
    assert.notEqual(pluginResult, null, `plugin copy must match the literal heading ${JSON.stringify(heading)}`);
    assert.ok(pluginResult.includes("body line one"), `plugin copy must slice the intended section for ${JSON.stringify(heading)}`);
    assert.equal(pluginResult, productResult, `both copies must agree for ${JSON.stringify(heading)}`);
  }

  // Negative control (硬规则 2's zero half): the RAW interpolation really IS broken for a
  // metacharacter heading, so the literal-match assertions above cannot be passing vacuously.
  assert.equal(
    new RegExp("^(##+)\\s*Plan (draft)\\s*$", "im").test("## Plan (draft)"),
    false,
    "the UNESCAPED pattern must NOT match the literal `## Plan (draft)` line — otherwise the case is vacuous",
  );
});

test("extractSectionFenceAware — same literal-heading rule (5b sibling) — metacharacter heading outside a fence matches, fenced one does not", () => {
  const heading = "Contract (v2)";
  const body = `## ${heading}\n\nreal section body\n\n## Other\n`;
  assert.notEqual(extractSectionFenceAware(body, heading), null, "fence-aware sibling must match its heading literally");
  const fencedOnly = "```\n## " + heading + "\n```\n";
  assert.equal(extractSectionFenceAware(fencedOnly, heading), null, "a heading inside a fence must never be read as a real section");
});

// ── (b) differential over ALL real task files (not a fixture) ─────────────────────────────────────
// The strongest parity evidence available: every task file in the repo, and for each one the 9
// standard section names PLUS every `##`/`###` heading actually present, run through BOTH copies. A
// copy that drifts back to unescaped interpolation shows up immediately (a `AC (draft)` / `(runnable)`
// heading matches on one side and is null on the other). The file-count assertion is deliberate: the
// case must FAIL, not silently skip, when the real corpus is not there.
const STANDARD_SECTIONS = ["Proposal", "Plan", "Acceptance Criteria", "Definition of Done", "Finding", "Requested action", "Touches", "Resolution", "Test-Files"];

test("extractSection — 0 divergence across every real task file's headings (≥2000 files, case b)", () => {
  assert.ok(fs.existsSync(TASKS_DIR), `tasks dir must exist at ${TASKS_DIR}`);
  const files = fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith(".md")).sort();
  assert.ok(files.length >= 2000, `expected >=2000 real task files under tasks/, found ${files.length} — this case must not silently skip`);

  let headingsChecked = 0;
  const divergences = [];
  for (const file of files) {
    const body = fs.readFileSync(path.join(TASKS_DIR, file), "utf8");
    const headings = new Set(STANDARD_SECTIONS);
    for (const m of body.matchAll(/^#{2,6}\s+(.+?)\s*$/gm)) headings.add(m[1]);
    for (const heading of headings) {
      headingsChecked += 1;
      const pluginResult = extractSection(body, heading);
      const productResult = productExtractSection(body, heading);
      if (pluginResult !== productResult && divergences.length < 5) {
        divergences.push(`${file} :: ${JSON.stringify(heading)}`);
      }
    }
  }
  assert.equal(divergences.length, 0, `plugin and product extractSection diverged on ${divergences.length} heading(s):\n  ${divergences.join("\n  ")}`);
  assert.ok(headingsChecked >= files.length, `headings checked (${headingsChecked}) should be at least the file count (${files.length})`);
});
