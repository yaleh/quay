// @test-group product
// LIVE-batch A (M75, DIR-044-LIVE proof) — offline unit test for the pure
// section-parsing logic in packages/quay-native/src/store.js.
//
// Function(s) under test: the `artifactSections()` / `extractSection()` heading
// resolution used by `store.check()`. These are pure string→structure parsers
// (a task's markdown body in, an {proposal, plan, ac, dod} presence map out) —
// no network, no GitHub. `extractSection` deliberately supports BOTH the short
// heading forms (`## AC`, `## DoD`) AND the canonical long forms
// (`## Acceptance Criteria`, `## Definition of Done`) via a heading-fallback
// list: `has("AC") || has("Acceptance Criteria")`, `has("DoD") || has(
// "Definition of Done")`.
//
// GAP THIS CLOSES: every existing gate test (gate-correctness, gate-checked-state,
// gate-gameability, compound-gate*) uses ONLY the short `## AC` / `## DoD`
// headings. The long-form aliases — the canonical section names documented in
// the repo's own CLAUDE.md — were never exercised through the gate. This test
// pins the alias-resolution behavior of that pure parser.
//
// Reached through the public createStore() API (a task written to a temp dir on
// local disk, then check()'d) — the same offline pattern the sibling
// gate-correctness / default-status tests use. No network, no GitHub.
//
// Run: node --test packages/quay-native/test/live-a-longform-headings.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { createStore } from "../src/store.ts";

// substantive prose long enough to exceed the parser's MIN_SECTION_CHARS
// (40 non-whitespace chars) so a section counts as "present" on content, not
// just heading — otherwise we'd be testing the threshold, not the alias.
const substantive = (label) =>
  `${label} — real, substantive prose describing the ${label.toLowerCase()} ` +
  `in enough detail to comfortably exceed the forty non-whitespace character ` +
  `minimum-content threshold this parser enforces per section.`;

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-live-a-longform-"));
  return { store: createStore(dir), dir };
}

test("check() author->ready recognizes the long-form '## Acceptance Criteria' and '## Definition of Done' headings", () => {
  const { store, dir } = freshStore();
  try {
    // A well-formed task using ONLY the canonical long-form section headings.
    store.write("LF-1", {
      title: "long-form headings",
      status: "todo",
      body:
        `## Proposal\n${substantive("Proposal")}\n\n` +
        `## Plan\n${substantive("Plan")}\n\n` +
        `## Acceptance Criteria\n- [x] a real, checkable acceptance criterion\n- [x] another checked one\n\n` +
        `## Definition of Done\n${substantive("Definition of Done")}\n`,
    });

    const r = store.check("LF-1");

    // Assertion 1: the gate PASSES — proving `artifactSections` resolved all
    // four sections via the long-form aliases (if the alias fallback were
    // broken, ac/dod would read absent and the reason would be "missing
    // artifacts", ok:false).
    assert.equal(r.gate, "author->ready", "gate should be the author->ready gate for a todo task");
    assert.equal(
      r.ok,
      true,
      `long-form headings should satisfy the gate; got ok=${r.ok}, reason="${r.reason}"`
    );

    // Assertion 2: the pass reason is the eligible-to-advance reason, NOT a
    // missing-artifact reason — a stronger check than ok alone that the AC and
    // DoD long-form sections were both recognized as present.
    assert.match(
      r.reason,
      /eligible to move to ready/,
      `reason should confirm eligibility (all artifacts present); got "${r.reason}"`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("check() still counts AC checkboxes correctly when AC uses the long-form '## Acceptance Criteria' heading", () => {
  const { store, dir } = freshStore();
  try {
    // Long-form AC heading, with one UNCHECKED box — the checkbox counting in
    // check() reads the AC section via extractSection's alias fallback, so it
    // must both find the section AND report the partial-checked count even
    // though checked-state is no longer required at author->ready
    // (gap-both-gates-read-one-signal-so-done-costs-nothing: ADR-001 restored;
    // acTotal/acChecked are surfaced for the contract's ac_checked_ratio
    // measure, but unchecked boxes do NOT block todo->ready).
    // NB: the AC section content must exceed MIN_SECTION_CHARS (40 non-ws
    // chars) or artifactSections() reports ac:false ("missing artifacts") and
    // short-circuits before the checkbox count is ever reached — a real
    // ordering property of this pure parser, hence the verbose criteria below.
    store.write("LF-2", {
      title: "long-form AC partially checked",
      status: "todo",
      body:
        `## Proposal\n${substantive("Proposal")}\n\n` +
        `## Plan\n${substantive("Plan")}\n\n` +
        `## Acceptance Criteria\n- [x] the first acceptance criterion, which is genuinely checked off\n- [ ] the second acceptance criterion, which is deliberately left NOT checked\n\n` +
        `## Definition of Done\n${substantive("Definition of Done")}\n`,
    });

    const r = store.check("LF-2");

    // Assertion 1: the gate PASSES author->ready (checked-state not required
    // at todo->ready) while still reporting the 1-of-2 count — proving both
    // that extractSection located the long-form AC section (else the reason
    // would be "missing artifacts", not an eligible-to-ready pass) and that
    // the checkbox count is surfaced even on the pass path.
    assert.equal(r.ok, true, "a task with an unchecked AC box passes author->ready (ADR-001 restored)");
    assert.match(
      r.reason,
      /eligible to move to ready/,
      `reason should be the eligible-to-ready reason from the long-form AC section; got "${r.reason}"`
    );

    // Assertion 2: the parser found exactly two checkboxes in the long-form
    // section (structured fields, not just prose) — a distinct, non-trivial fact.
    assert.equal(r.acTotal, 2, "extractSection should surface both AC checkboxes under the long-form heading");
    assert.equal(r.acChecked, 1, "exactly one of the two long-form AC checkboxes is checked");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
