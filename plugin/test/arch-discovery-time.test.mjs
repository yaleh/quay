// @test-group engine
// Fixture tests for the architecture-discovery TIME instrument's grouping and association rules
// (docs/analysis/arch-discovery-time.mjs). Pure functions only — no git, no journalctl, no repo.
//
// Fixture families (Plan step 4):
//   1. signature split vs file-only merge (identity/grouping).
//   2. a green-suite control that REFUTES an association (B4).
//   3. the B1 prediction refuted when one post-change red is injected.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  groupKey, groupsOf, recurrentWindows, recurrentGroups, b1Verdict, b2Verdict, b4Verdict, b5Verdict,
  enrichment, W48, GROUP_KEY_BY,
} from "../../docs/analysis/arch-discovery-time.mjs";
import { carrierEvidence } from "../../docs/analysis/arch-discovery-space.mjs";
import { validateRecord } from "../../docs/analysis/architecture-evidence-store.mjs";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const ev = (file, sigKey, ts, task) => ({ file, sigKey, ts, task, sigs: sigKey === "nosig" ? [] : [sigKey], line: 1 });

// ── family 1: identity — signature split vs file-only merge ─────────────────────────────────────────
test("grouping key: file+signature keeps two signatures on ONE file apart; file-only merges them", () => {
  const events = [ev("plugin/test/a.test.mjs", "sig1", T0, "t1"), ev("plugin/test/a.test.mjs", "sig2", T0 + 3600e3, "t2")];
  assert.equal(groupsOf(events, { keyBy: "file+signature" }).length, 2);
  assert.equal(groupsOf(events, { keyBy: "file-only" }).length, 1);
  assert.notEqual(groupKey(events[0], "file+signature"), groupKey(events[1], "file+signature"));
  assert.equal(groupKey(events[0], "file-only"), groupKey(events[1], "file-only"));
});

test("B2: a real split reports `split`; the file-only mutation reports `merged(refuted)`", () => {
  const events = [ev("plugin/test/task-granularity-advice.test.mjs", "nosig", T0, "t1"), ev("plugin/test/task-granularity-advice.test.mjs", "311a83b0ca46", T0 + 3 * 86400e3, "t2")];
  assert.equal(b2Verdict(groupsOf(events, { keyBy: "file+signature" })), "split");
  assert.equal(b2Verdict(groupsOf(events, { keyBy: "file-only" })), "merged(refuted)");
  assert.equal(GROUP_KEY_BY, "file+signature", "the shipped default key is file+signature");
});

test("recurrence: distinct tasks inside one 48h window; a signature-less event never merges with a signed one", () => {
  const three = [ev("f", "s", T0, "a"), ev("f", "s", T0 + 3600e3, "b"), ev("f", "s", T0 + 2 * 3600e3, "c")];
  assert.equal(recurrentWindows(three), 3);
  assert.equal(recurrentWindows([ev("f", "s", T0, "a"), ev("f", "s", T0 + 2 * W48, "b")]), 1);   // outside the window
  assert.equal(recurrentGroups(groupsOf([ev("f", "nosig", T0, "a"), ev("f", "sig", T0 + 1000, "b")])).length, 0);
});

// ── family 3: B1 — the prediction is refuted by a single injected post-change red ───────────────────
test("B1: recurrent-before + a located change predicts 0 reds after it", () => {
  assert.equal(b1Verdict({ recurrentPre: true, change: { commit: "6cc0ee3919" }, observedAfter: 0 }), "prediction-held");
});

test("B1: ONE post-change red refutes the prediction", () => {
  assert.equal(b1Verdict({ recurrentPre: true, change: { commit: "6cc0ee3919" }, observedAfter: 1 }), "refuted");
});

test("B1: no located change (or no pre-cut recurrence) is not-evaluated — never a silent 'held'", () => {
  assert.equal(b1Verdict({ recurrentPre: true, change: null, observedAfter: null }), "not-evaluated");
  assert.equal(b1Verdict({ recurrentPre: false, change: { commit: "x" }, observedAfter: 0 }), "not-evaluated");
});

// ── family 2: the green control refutes the OOM↔red association ─────────────────────────────────────
const WIN = 30 * 60e3;
const loom = (shiftH) => T0 + shiftH * 3600e3 + 10 * 60e3;   // a target that lands in the +shiftH window only

test("enrichment: a trigger-window target counts; the ±6h/±12h shifts are the control", () => {
  const enr = enrichment({ targets: [{ ts: T0 + 60e3 }, { ts: loom(6) }], triggers: [{ ts: T0 }], winMs: WIN, lo: 0 });
  assert.equal(enr.real, 1);
  assert.deepEqual(enr.shifted_controls, [0, 0, 1, 0]);
  assert.equal(enr.control_mean, 0.25);
  assert.equal(enr.enrichment, 4);
});

test("B4: reds enriched 4× AND greens enriched the same ⇒ the red-specific association is REFUTED", () => {
  const redEnr = enrichment({ targets: [{ ts: T0 + 60e3 }, { ts: loom(6) }], triggers: [{ ts: T0 }], winMs: WIN, lo: 0 });
  const greenEnr = enrichment({ targets: [{ ts: T0 + 60e3 }, { ts: loom(6) }], triggers: [{ ts: T0 }], winMs: WIN, lo: 0 });
  const v = b4Verdict({ enrichment: redEnr, greenControl: greenEnr });
  assert.equal(v.enrichment_verdict, "OOM-associated");                       // the naive reading alone would say this
  assert.equal(v.red_over_green, 1);
  assert.equal(v.verdict, "not-red-specific (suite-running confound)");       // the control refutes it
});

test("B5: orphan finalisations enriched ≥2× after a worker-loop start ⇒ restart-induced burst", () => {
  const enr = enrichment({ targets: [{ ts: T0 + 60e3 }, { ts: loom(6) }], triggers: [{ ts: T0 }], winMs: 15 * 60e3, lo: 0 });
  assert.equal(b5Verdict(enr), "restart-induced-burst");
  assert.equal(b5Verdict(enrichment({ targets: [{ ts: T0 + 60e3 }], triggers: [{ ts: T0 }], winMs: 15 * 60e3, lo: 0 })), "restart-induced-burst");
});

// ── records validate against the PRODUCTION store ───────────────────────────────────────────────────
test("the time instrument's carrier-form evidence validates against the store", () => {
  const lineText = `{"ts":"2026-10-03T11:42:12.901Z","task":"gap-x","mechanical_fan_in":{"step":"suite","outcome":"red"}}`;
  const rec = carrierEvidence("worker-outcome suite-red grouping", ".quay/worker-outcome.jsonl", 2677, lineText, { scope: "plugin/test/a.test.mjs", flags: ["47c794ad30a1"] });
  assert.deepEqual(validateRecord("evidence", rec), { ok: true, reasons: [] });
});
