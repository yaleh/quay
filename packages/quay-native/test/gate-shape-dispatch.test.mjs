// @test-group product
// gap-the-dod-gate-encodes-a-retired-task-shape: shape-dispatch tests for the
// author->ready gate in packages/quay-native/src/store.ts check().
//
// The old gate required the classic Proposal/Plan/AC/DoD quartet
// unconditionally (`artifactSections` one-size-fits-all `every()`), which:
//   - failed quay's own fast-mode tasks (ADR-022 replaced `## Plan` with
//     `## Contract`), and
//   - blocked meta-cc's cold start (`## Finding` replaces `## Proposal` in the
//     DIR template → `proposal:false`, so Finding-template tasks could not pass
//     author->ready and the ready queue drained to 0).
//
// The gate now dispatches by task shape (SHAPE_REGISTRY is the single source
// of truth, AC1): contract shape requires `## Contract` with all six keys
// (AC4), finding shape maps `## Finding` to the proposal-slot (AC6), plan
// shape is unchanged (AC3), and an unknown shape FAILS CLOSED (AC5).
//
// AC8: node:test + `// @test-group product` (task check is a user-visible
// contract).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createStore,
  SHAPE_REGISTRY,
  detectShape,
  contractKeysPresent,
} from "../src/store.ts";
// Single-judge consistency check (gap-cjk-proposal-slot-word-boundary AC2): the
// author→ready shape judgment is "the single judge quay and meta-cc must share"
// (CLAUDE.md). ready-pool-check.ts is the meta-cc side — importing its
// `artifactsComplete` (side-effect-free; main() is guarded by isDirectEntry) lets
// this test assert both gates agree on the CJK proposal-slot body. Precedent:
// serve.test.mjs imports plugin/scripts/fast-mode-telemetry.ts the same way.
import { artifactsComplete } from "../../../plugin/scripts/ready-pool-check.ts";

const substantive = (label) =>
  `${label} — this is real, substantive prose describing the ${label.toLowerCase()} in enough detail to exceed the minimum content threshold for this section, well past forty characters.`;

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-gate-shape-"));
  return { store: createStore(dir), dir };
}

/** A compliant Contract-shape body: all four sections + all six keys + two
 *  checked AC boxes. */
const contractBody = () =>
  `## Proposal\n${substantive("Proposal")}\n` +
  `## Contract\n` +
  "```\n" +
  `measure gate_fail_by_shape = \`task check <id>\` failures per shape\n` +
  `band gate_fail_by_shape = 0 for every compliant registered shape\n` +
  `invariant dispatch is not a waiver; every shape has a complete contract\n` +
  `invoke \`task check <id>\`\n` +
  `control declared shape missing its own required section must be red\n` +
  `resume register the shape set and required sections before changing check\n` +
  "```\n" +
  `## Acceptance Criteria\n- [x] a real, checkable acceptance criterion\n- [x] another one\n` +
  `## Definition of Done\n${substantive("Definition of Done")}\n`;

test("AC1: SHAPE_REGISTRY is importable and registers contract/finding/plan with their section maps", () => {
  assert.ok(SHAPE_REGISTRY.contract);
  assert.ok(SHAPE_REGISTRY.finding);
  assert.ok(SHAPE_REGISTRY.plan);
  assert.deepEqual(SHAPE_REGISTRY.contract.planKeys, [
    "measure",
    "band",
    "invariant",
    "invoke",
    "control",
    "resume",
  ]);
  // quay fast mode: ## Contract fills the plan-slot.
  assert.deepEqual(SHAPE_REGISTRY.contract.sections.plan, ["Contract"]);
  // meta-cc DIR template: ## Finding fills the proposal-slot.
  assert.deepEqual(SHAPE_REGISTRY.finding.sections.proposal, ["Finding"]);
  // classic template unchanged.
  assert.deepEqual(SHAPE_REGISTRY.plan.sections, {
    proposal: ["Proposal"],
    plan: ["Plan"],
    ac: ["AC", "Acceptance Criteria"],
    dod: ["DoD", "Definition of Done"],
  });
});

test("detectShape classifies contract / finding / plan / proposal / unknown", () => {
  assert.equal(detectShape(`## Contract\nbody`), "contract");
  assert.equal(detectShape(`## Plan\nbody`), "plan");
  assert.equal(detectShape(`## Finding\nbody`), "finding");
  // A DIR task carries BOTH ## Finding and ## Plan; Finding must win (its
  // proposal-slot is Finding, so classifying as plan would demand Proposal).
  assert.equal(detectShape(`## Finding\n...\n## Plan\n...`), "finding");
  // A literal `## Proposal` section with no contract/finding/plan heading is the
  // proposal shape (DIR-028 recording directives + execution tasks carrying their
  // approach inside ## Proposal). Subheadings like "## Finding (measured
  // 2026-08-02)" still do NOT trigger finding detection (exact-heading match) —
  // the body resolves to proposal, not finding, and never to plan.
  assert.equal(
    detectShape(
      `## Proposal\n${substantive("Proposal")}\n## Finding (measured 2026-08-02)\n...\n## Acceptance Criteria\n- [x] a\n## Definition of Done\n${substantive("DoD")}\n`
    ),
    "proposal"
  );
  assert.equal(detectShape("no registered headings at all"), "unknown");
});

test("AC2: a compliant Contract-shape task passes author->ready", () => {
  const { store, dir } = freshStore();
  try {
    store.write("AC2-C", { title: "contract-compliant", status: "todo", body: contractBody() });
    const r = store.check("AC2-C");
    assert.equal(r.shape, "contract");
    assert.equal(r.ok, true, `contract task should pass; got ${JSON.stringify(r)}`);
    assert.match(r.reason, /eligible to move to ready/);
    assert.equal(r.contractKeys.measure, true);
    assert.equal(r.contractKeys.resume, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3: a compliant classic Plan-shape task still passes author->ready", () => {
  const { store, dir } = freshStore();
  try {
    const body =
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] a real, checkable acceptance criterion\n- [x] another one\n` +
      `## DoD\n${substantive("DoD")}\n`;
    store.write("AC3-P", { title: "plan-compliant", status: "todo", body });
    const r = store.check("AC3-P");
    assert.equal(r.shape, "plan");
    assert.equal(r.ok, true, `plan task should pass; got ${JSON.stringify(r)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6: a DIR-template (Finding) task passes author->ready — Finding satisfies the proposal-slot", () => {
  const { store, dir } = freshStore();
  try {
    const body =
      `## Finding\n${substantive("Finding")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## Acceptance Criteria\n- [x] a real, checkable acceptance criterion\n- [x] another one\n` +
      `## Definition of Done\n${substantive("Definition of Done")}\n`;
    store.write("AC6-F", { title: "finding-dir-template", status: "todo", body });
    const r = store.check("AC6-F");
    assert.equal(r.shape, "finding");
    // The exact meta-cc blocking criterion: task_check(DIR-082) proposal:true.
    assert.equal(
      r.artifacts.proposal,
      true,
      `Finding must satisfy the proposal slot; got ${JSON.stringify(r.artifacts)}`
    );
    assert.equal(r.ok, true, `finding task should pass; got ${JSON.stringify(r)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CJK proposal-slot alias (gap-cjk-proposal-slot-word-boundary): `## 人的裁定` satisfies the contract shape's proposal artifact and agrees with ready-pool-check", () => {
  const { store, dir } = freshStore();
  try {
    // contract shape where the proposal-slot is the directive-variant `## 人的裁定`
    // (registered in SHAPE_REGISTRY.contract.sections.proposal). Before the fix a
    // `\b`-based heading match made this alias DEAD: 定 (CJK) and the following
    // newline are both non-`\w`, so `\b` had no boundary and proposal read false —
    // store.check() returned ok:false "missing artifacts: proposal" while
    // ready-pool-check.artifactsComplete() returned proposal:true (the divergence
    // this task records).
    const body =
      `## 人的裁定\n${substantive("人的裁定")}\n` +
      `## Contract\n` +
      "```\n" +
      `measure gate_fail_by_shape = \`task check <id>\` failures per shape\n` +
      `band gate_fail_by_shape = 0 for every compliant registered shape\n` +
      `invariant dispatch is not a waiver; every shape has a complete contract\n` +
      `invoke \`task check <id>\`\n` +
      `control declared shape missing its own required section must be red\n` +
      `resume register the shape set and required sections before changing check\n` +
      "```\n" +
      `## AC\n- [x] a real, checkable acceptance criterion\n- [x] another one\n` +
      `## DoD\n${substantive("DoD")}\n`;
    store.write("CJK-PROP", { title: "cjk-proposal-slot", status: "todo", body });
    const r = store.check("CJK-PROP");
    assert.equal(r.shape, "contract");
    assert.equal(
      r.artifacts.proposal,
      true,
      `人的裁定 must satisfy the proposal slot; got ${JSON.stringify(r.artifacts)}`
    );
    assert.equal(r.ok, true, `CJK proposal-slot contract task should pass; got ${JSON.stringify(r)}`);
    // Single-judge consistency (AC2): the same body must read proposal:true in
    // ready-pool-check.artifactsComplete too — both gates now use the same
    // whole-line-exact (`\b`-free) heading semantics.
    const pc = artifactsComplete(body);
    assert.equal(
      pc.artifacts.proposal,
      true,
      `ready-pool-check must agree with store.check on the CJK alias; got ${JSON.stringify(pc.artifacts)}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC (gap-the-finding-shape-still-requires-a-plan-section): a ## Finding task WITHOUT ## Plan passes author->ready — plan is not a required artifact for the finding shape", () => {
  const { store, dir } = freshStore();
  try {
    // The exact class ADR-001 says to allow: a Finding task with NO ## Plan.
    // This was the last red assertion in the reinstall-threshold e2e
    // (shape=finding ok=false artifacts={"proposal":true,"plan":false,...}).
    const body =
      `## Finding\n${substantive("Finding")}\n` +
      `## Acceptance Criteria\n- [x] a real, checkable acceptance criterion\n- [x] another one\n` +
      `## Definition of Done\n${substantive("Definition of Done")}\n`;
    store.write("F-NOPLAN", { title: "finding-no-plan", status: "todo", body });
    const r = store.check("F-NOPLAN");
    assert.equal(r.shape, "finding");
    assert.equal(
      "plan" in r.artifacts,
      false,
      `the finding shape's artifact map must NOT carry a plan key (dispatch is not a waiver); got ${JSON.stringify(r.artifacts)}`
    );
    assert.equal(
      r.ok,
      true,
      `a ## Finding task WITHOUT ## Plan must pass author->ready; got ${JSON.stringify(r)}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 reverse negative (gap-the-finding-shape-still-requires-a-plan-section): a ## Plan shape task with an EMPTY ## Plan section stays red — fixing finding-too-strict must not waive the plan check", () => {
  const { store, dir } = freshStore();
  try {
    // Plan-shape task where ONLY the ## Plan section is content-empty. The
    // shape is detected as `plan` (the heading is present), but the plan
    // artifact reads absent (< MIN_SECTION_CHARS) → the gate MUST stay red.
    // If the finding fix had been "skip the plan check for ALL shapes", this
    // would pass — it is the negative control that says that trade is worse.
    const body =
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n` + // heading present, but no substantive content below it
      `## Acceptance Criteria\n- [x] a real, checkable acceptance criterion\n- [x] another one\n` +
      `## Definition of Done\n${substantive("Definition of Done")}\n`;
    store.write("P-NOPLAN", { title: "plan-missing-plan", status: "todo", body });
    const r = store.check("P-NOPLAN");
    assert.equal(r.shape, "plan");
    assert.equal(
      r.artifacts.plan,
      false,
      `the plan shape must still report plan:false when its Plan section is empty; got ${JSON.stringify(r.artifacts)}`
    );
    assert.equal(
      r.ok,
      false,
      `a ## Plan shape task missing ## Plan must stay red; got ${JSON.stringify(r)}`
    );
    assert.match(r.reason, /missing artifacts/);
    assert.match(r.reason, /plan/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3-per-shape: a compliant task with UNCHECKED AC boxes passes author->ready for every registered shape (gap-both-gates...)", () => {
  // gap-both-gates-read-one-signal-so-done-costs-nothing: checked-state is
  // NOT required at todo->ready (ADR-001 restored) — only AC presence/shape
  // (>=1 checkbox). This must hold for EVERY registered shape, so shape
  // dispatch is unaffected by the checked-state reversal.
  const { store, dir } = freshStore();
  try {
    const uncheckedAc = (heading) =>
      `## ${heading}\n- [ ] a real, checkable criterion that is deliberately NOT checked yet\n- [ ] another real, checkable criterion that is also NOT checked yet\n`;
    // Contract shape: all six keys + unchecked AC.
    const contractBodyUnchecked =
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Contract\n` +
      "```\n" +
      `measure gate_fail_by_shape = \`task check <id>\` failures per shape\n` +
      `band gate_fail_by_shape = 0 for every compliant registered shape\n` +
      `invariant dispatch is not a waiver; every shape has a complete contract\n` +
      `invoke \`task check <id>\`\n` +
      `control declared shape missing its own required section must be red\n` +
      `resume register the shape set and required sections before changing check\n` +
      "```\n" +
      `## Acceptance Criteria\n- [ ] a real, checkable criterion, not checked yet\n- [ ] another real, checkable criterion, not checked yet\n` +
      `## Definition of Done\n${substantive("Definition of Done")}\n`;
    store.write("AC3-UNK-C", { title: "contract-unchecked-ac", status: "todo", body: contractBodyUnchecked });
    const c = store.check("AC3-UNK-C");
    assert.equal(c.shape, "contract");
    assert.equal(c.ok, true, `contract shape with unchecked AC passes; got ${JSON.stringify(c)}`);

    store.write("AC3-UNK-P", {
      title: "plan-unchecked-ac", status: "todo",
      body:
        `## Proposal\n${substantive("Proposal")}\n` +
        `## Plan\n${substantive("Plan")}\n` +
        uncheckedAc("AC") +
        `## DoD\n${substantive("DoD")}\n`,
    });
    const p = store.check("AC3-UNK-P");
    assert.equal(p.shape, "plan");
    assert.equal(p.ok, true, `plan shape with unchecked AC passes; got ${JSON.stringify(p)}`);

    store.write("AC3-UNK-F", {
      title: "finding-unchecked-ac", status: "todo",
      body:
        `## Finding\n${substantive("Finding")}\n` +
        `## Plan\n${substantive("Plan")}\n` +
        uncheckedAc("Acceptance Criteria") +
        `## Definition of Done\n${substantive("Definition of Done")}\n`,
    });
    const f = store.check("AC3-UNK-F");
    assert.equal(f.shape, "finding");
    assert.equal(f.ok, true, `finding shape with unchecked AC passes; got ${JSON.stringify(f)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4: Contract shape missing a required key fails closed, naming the key", () => {
  const { store, dir } = freshStore();
  try {
    const body = contractBody().replace(/^resume .*$/m, "");
    store.write("AC4-MISS", { title: "contract-missing-key", status: "todo", body });
    const r = store.check("AC4-MISS");
    assert.equal(r.shape, "contract");
    assert.equal(r.ok, false);
    assert.equal(r.contractKeys.resume, false);
    assert.match(r.reason, /resume/);
    // The other five keys are present — only the removed one is named.
    assert.doesNotMatch(r.reason, /measure/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5: unknown shape fails closed — never falls into a lenient branch", () => {
  const { store, dir } = freshStore();
  try {
    // Body with Proposal/AC/DoD but NO Contract/Finding/Plan heading is now the
    // proposal shape (2026-08-11): complete on its own dimension (Proposal/AC/DoD).
    const proposalBody =
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Acceptance Criteria\n- [x] a real, checkable acceptance criterion with enough words to clear the forty-character minimum content threshold comfortably\n` +
      `## Definition of Done\n${substantive("Definition of Done")}\n`;
    store.write("AC5-PROP", { title: "proposal-shape", status: "todo", body: proposalBody });
    const r = store.check("AC5-PROP");
    assert.equal(r.shape, "proposal");
    assert.equal(r.ok, true);
    assert.match(r.reason, /eligible to move to ready/);
    // A body with NO registered heading at all still fails closed as unknown.
    store.write("AC5-UNK", { title: "unknown-shape", status: "todo", body: "no registered headings at all" });
    const u = store.check("AC5-UNK");
    assert.equal(u.shape, "unknown");
    assert.equal(u.ok, false);
    assert.match(u.reason, /unrecognized task shape/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("contractKeysPresent reports per-key presence from the ## Contract section", () => {
  const body = contractBody();
  const keys = contractKeysPresent(body);
  for (const k of ["measure", "band", "invariant", "invoke", "control", "resume"]) {
    assert.equal(keys[k], true, `${k} should be present`);
  }
  const missing = contractKeysPresent(body.replace(/^resume .*$/m, ""));
  assert.equal(missing.resume, false);
  assert.equal(missing.measure, true);
});
