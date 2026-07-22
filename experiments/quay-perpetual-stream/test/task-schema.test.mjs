// Unit tests for task-schema.mjs — the canonical task/ADR authoring-schema validator.
// Backfilled (2026-07-19) to pay the coverage debt on this load-bearing gate and to dogfood the
// ADR-TDD policy (load-bearing method-infra gates must be fixture-first + covered). Run:
//   node --test experiments/quay-perpetual-stream/test/task-schema.test.mjs
//   node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/task-schema.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractSection, parseTask, hasSchemaMarker, classifyKind,
  checkProposal, checkPlan, checkAcceptanceChecklist, checkDodChecklist,
  checkResolution, checkNoScaffolding,
  checkTask,
} from "../scripts/task-schema.ts";

const fm = (labels, extra = 'extra:\n  schema: "v1"') =>
  `---\nid: T\ntitle: t\nstatus: todo\nlabels:\n${labels.map((l) => `  - ${l}`).join("\n")}\n${extra}\n---\n`;

// ── extractSection ────────────────────────────────────────────────────────────────────────────
test("extractSection: depth-aware, extends through nested subheadings", () => {
  const body = "## A\nalpha\n### sub\nbeta\n## B\ngamma\n";
  assert.match(extractSection(body, "A"), /alpha/);
  assert.match(extractSection(body, "A"), /beta/);   // nested ### stays inside
  assert.doesNotMatch(extractSection(body, "A"), /gamma/); // stops at next ##
});
test("extractSection: missing heading → null", () => {
  assert.equal(extractSection("## A\nx\n", "Nope"), null);
});

// ── parseTask ─────────────────────────────────────────────────────────────────────────────────
test("parseTask: block labels + extra scalar keys", () => {
  const t = parseTask(fm(["directive"]) + "body");
  assert.deepEqual(t.labels, ["directive"]);
  assert.equal(t.extra.schema, "v1");
  assert.match(t.body, /body/);
});
test("parseTask: flow labels + inline extra", () => {
  const t = parseTask(`---\nlabels: [adr, x]\nextra: { schema: "v1" }\n---\nb`);
  assert.deepEqual(t.labels, ["adr", "x"]);
  assert.equal(t.extra.schema, "v1");
});
test("parseTask: no frontmatter → empty labels/extra, whole text as body", () => {
  const t = parseTask("just body");
  assert.deepEqual(t.labels, []);
  assert.equal(t.body, "just body");
});

// ── marker + kind ─────────────────────────────────────────────────────────────────────────────
test("hasSchemaMarker: only true for extra.schema === v1", () => {
  assert.equal(hasSchemaMarker({ extra: { schema: "v1" } }), true);
  assert.equal(hasSchemaMarker({ extra: { schema: "v2" } }), false);
  assert.equal(hasSchemaMarker({ extra: {} }), false);
});
test("classifyKind: directive / milestone-candidate / other (ADRs are NOT a task kind)", () => {
  assert.equal(classifyKind({ labels: ["directive"] }), "directive");
  assert.equal(classifyKind({ labels: ["milestone-candidate"] }), "milestone-candidate");
  assert.equal(classifyKind({ labels: ["random"] }), "other");
  // ADRs are a first-class quay kind (adr-store.js), never validated here.
});

// ── task-kind assertions (existing behavior — regression lock) ───────────────────────────────
test("checkProposal: present vs missing vs placeholder", () => {
  assert.equal(checkProposal({ body: "## Proposal\n" + "x".repeat(50) }).ok, true);
  assert.equal(checkProposal({ body: "## Other\nx" }).ok, false);
  assert.equal(checkProposal({ body: "## Proposal\nTBD" }).ok, false);
});
test("checkPlan: directive may omit; milestone must have; N/A or docs/plans ok", () => {
  assert.equal(checkPlan({ body: "" }, "directive").ok, true);
  assert.equal(checkPlan({ body: "" }, "milestone-candidate").ok, false);
  assert.equal(checkPlan({ body: "## Plan\nN/A — reason" }, "milestone-candidate").ok, true);
  assert.equal(checkPlan({ body: "## Plan\ndocs/plans/x.md" }, "milestone-candidate").ok, true);
  assert.equal(checkPlan({ body: "## Plan\nsomething else" }, "milestone-candidate").ok, false);
});
test("checkAcceptanceChecklist / checkDodChecklist: checklist vs prose", () => {
  assert.equal(checkAcceptanceChecklist({ body: "## Acceptance Criteria\n- [ ] a" }).ok, true);
  assert.equal(checkAcceptanceChecklist({ body: "## Acceptance Criteria\nprose" }).ok, false);
  assert.equal(checkDodChecklist({ body: "## Definition of Done\n- [ ] inherited-core clause" }).ok, true);
  assert.equal(checkDodChecklist({ body: "## Definition of Done\n- [ ] no ref word" }).ok, false); // needs standard ref
  assert.equal(checkDodChecklist({ body: "## Definition of Done\nprose" }).ok, false);
});
test("checkResolution: absent ok; empty stub fails; dup fails; real evidence ok; bare mirror fails", () => {
  assert.equal(checkResolution({ body: "no resolution here" }).ok, true);
  assert.equal(checkResolution({ body: "## Resolution\n<!-- filled at close -->" }).ok, false);
  assert.equal(checkResolution({ body: "## Resolution\na\n## Resolution\nb" }).ok, false);
  assert.equal(checkResolution({ body: "## Resolution\n- outcome: applied — verified, diffstat, evidence pasted, net -20 lines round-trip" }).ok, true);
  assert.equal(checkResolution({ body: "## Resolution\n- outcome: applied" }).ok, false);
});
test("checkNoScaffolding: clean vs source-line vs dirFile vs status-mirror; false-positive-safe", () => {
  assert.equal(checkNoScaffolding({ body: "clean", extra: {} }).ok, true);
  assert.equal(checkNoScaffolding({ body: "Source: `experiments/x`", extra: {} }).ok, false);
  assert.equal(checkNoScaffolding({ body: "clean", extra: { dirFile: "x" } }).ok, false);
  assert.equal(checkNoScaffolding({ body: "Status mirror: applied", extra: {} }).ok, false);
  // prose mention (line does NOT end in a lone status word) must NOT fire:
  assert.equal(checkNoScaffolding({ body: "Status mirror: ` is stuck at pending while the file...", extra: {} }).ok, true);
});

// ── checkTask verdicts (the single entry point) ─────────────────────────────────────────────
test("checkTask: unmarked → N/A-legacy (never silently skipped)", () => {
  const r = checkTask(fm(["directive"], "extra: {}") + "## Proposal\nx");
  assert.equal(r.verdict, "N/A-legacy");
  assert.equal(r.applicable, false);
});
test("checkTask: conformant directive → PASS", () => {
  // A conformant directive carries the A7-required sections too: `## Finding` and `## Requested
  // action` (mandated by the /quay-directive template; added at M69/B6). Fixture updated to match —
  // it was stale (Proposal/AC/DoD only) after A7 landed, making this test red.
  const body =
    "## Proposal\n" + "real approach text ".repeat(4) +
    "\n## Finding\nthe concrete gap this directive addresses" +
    "\n## Requested action\nwhat the loop should do about it" +
    "\n## Acceptance Criteria\n- [ ] a\n## Definition of Done\n- [ ] inherited-core clause";
  assert.equal(checkTask(fm(["directive"]) + body).verdict, "PASS");
});
test("checkTask: directive MISSING ## Finding / ## Requested action → FAIL (A7)", () => {
  // The negative half of A7, absent from this file when A7 landed at M69/B6. A directive with the
  // schema marker but no Finding/Requested-action must FAIL, with the A7 code among its failures.
  const body = "## Proposal\n" + "real approach text ".repeat(4) + "\n## Acceptance Criteria\n- [ ] a\n## Definition of Done\n- [ ] inherited-core clause";
  const r = checkTask(fm(["directive"]) + body);
  assert.equal(r.verdict, "FAIL");
  assert.ok(r.failures.some((f) => f.code === "directive-sections-missing"), "expected the A7 directive-sections-missing failure");
});
test("checkTask: A7 does NOT apply to a milestone-candidate (directive-only rule)", () => {
  // A7 is directive-kind only; a milestone-candidate without Finding/Requested-action still PASSes.
  const body = "## Proposal\n" + "real approach text ".repeat(4) + "\n## Plan\nN/A — leaf\n## Acceptance Criteria\n- [ ] a\n## Definition of Done\n- [ ] inherited-core clause";
  assert.equal(checkTask(fm(["milestone-candidate"]) + body).verdict, "PASS");
});
