// @test-group governance
// concurrent-batch-scheduler.test.mjs — parseCandidate label exposure
// (gap-ac36-delivery-critical-priority-axis AC2): parseCandidate must read the candidate's
// frontmatter `labels` — via task-schema.ts's parseTask, the ONE lenient frontmatter parse
// (ADR-004 single-source — no second labels parser) — and expose a derived `deliveryCritical`
// boolean. slot-refill.ts's candidates.sort then ranks delivery-critical tasks as a SECOND axis
// (below blocking_suite, above id order). A candidate with no frontmatter / no such label must
// default conservative (labels=[], deliveryCritical=false) so legacy charters are unchanged.
//
// Run: scripts/test.sh plugin/test/concurrent-batch-scheduler.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCandidate } from "../scripts/concurrent-batch-scheduler.ts";

// A quay-task-shaped charter with frontmatter `labels:` (block-list form) plus a body.
function taskText({ labels = [], body = "" }) {
  const fm = [
    "---",
    "id: t",
    "title: fixture",
    "status: ready",
    "labels:",
    ...labels.map((l) => `  - ${l}`),
    "---",
  ].join("\n");
  return `${fm}\n\n${body}`;
}

test("parseCandidate: legacy charter fragment (no frontmatter) ⇒ labels=[], deliveryCritical=false", () => {
  const c = parseCandidate("cand", "**type:** execution\n## Touches\n- x/a.js");
  assert.deepEqual(c.labels, []);
  assert.equal(c.deliveryCritical, false);
});

test("parseCandidate: block-list labels with delivery-critical ⇒ labels read + deliveryCritical=true", () => {
  const c = parseCandidate(
    "cand",
    taskText({ labels: ["gap", "delivery-critical"], body: "**type:** execution\n## Touches\n- x/a.js" }),
  );
  assert.deepEqual(c.labels, ["gap", "delivery-critical"]);
  assert.equal(c.deliveryCritical, true);
});

test("parseCandidate: block-list labels WITHOUT delivery-critical ⇒ deliveryCritical=false", () => {
  const c = parseCandidate("cand", taskText({ labels: ["gap"], body: "**type:** execution\n## Touches\n- x/a.js" }));
  assert.deepEqual(c.labels, ["gap"]);
  assert.equal(c.deliveryCritical, false);
});

test("parseCandidate: flow-list labels (labels: [gap, delivery-critical]) ⇒ deliveryCritical=true", () => {
  const text = [
    "---",
    "id: t",
    "title: fixture",
    "status: ready",
    "labels: [gap, delivery-critical]",
    "---",
    "",
    "**type:** execution",
    "## Touches",
    "- x/a.js",
  ].join("\n");
  const c = parseCandidate("cand", text);
  assert.deepEqual(c.labels, ["gap", "delivery-critical"]);
  assert.equal(c.deliveryCritical, true);
});

test("parseCandidate: existing fields unchanged when labels are added (id/touches/type/valueType)", () => {
  const c = parseCandidate(
    "cand",
    taskText({ labels: ["delivery-critical"], body: "**type:** learning\n## Touches\n- x/a.js\n- y/b.js" }),
  );
  assert.equal(c.id, "cand");
  assert.deepEqual(c.touches.globs, ["x/a.js", "y/b.js"]);
  assert.equal(c.type, "learning");
  assert.equal(c.valueType, "capability-growth");
  assert.equal(c.deliveryCritical, true);
});
