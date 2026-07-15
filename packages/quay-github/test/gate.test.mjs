// QN-028 (iteration 17): gate-correctness tests for quay-github's checkGate
// -- the task_check equivalent for GitHub-backed tasks. Mirrors the exact
// case structure of packages/quay-native/test/gate-correctness.test.mjs
// (same four-heading / AC-checkbox semantics, ported to operate on an
// issue's raw body text instead of a native task file's body), plus the
// injectable-fixture, no-live-gh-api-call convention already established by
// write.test.mjs / pagination.test.mjs for this package.
//
// Run: node test/gate.test.mjs
import { checkGate } from "../src/github-client.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

const substantive = (label) =>
  `${label} — this is real, substantive prose describing the ${label.toLowerCase()} in enough detail to exceed the minimum content threshold for this section, well past forty characters.`;

function main() {
  // (a) all four sections present, AC fully checked -> todo gates ok:true
  {
    const body =
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] a real, checkable acceptance criterion\n- [x] another one\n` +
      `## DoD\n${substantive("DoD")}\n`;
    const r = checkGate({ id: "gh-1", status: "todo", body });
    assert(r.gate === "author->ready", "case a: gate is author->ready");
    assert(r.ok === true, `case a: fully-checked AC passes the todo gate (reason: ${r.reason})`);
  }

  // (b) AC checkboxes present but not all checked -> todo gate fails with
  // the correct N/M reason. AC section content itself must also clear
  // MIN_SECTION_CHARS (40 non-whitespace chars) to count as "present" --
  // short checkbox lines alone are not enough, matching native's own
  // gate-correctness.test.mjs fixture discipline.
  {
    const body =
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n- [ ] another sufficiently long unchecked acceptance criterion line\n` +
      `## DoD\n${substantive("DoD")}\n`;
    const r = checkGate({ id: "gh-2", status: "todo", body });
    assert(r.gate === "author->ready", "case b: gate is author->ready");
    assert(r.ok === false, "case b: partially-checked AC fails the todo gate");
    assert(
      r.reason === "1/2 AC checkboxes checked",
      `case b: reason names the N/M count (got: ${r.reason})`
    );
  }

  // (c) missing/short sections -> fails with "missing artifacts" reason
  {
    const body = "## Proposal\nx\n## Plan\nx\n## AC\nx\n## DoD\nx\n";
    const r = checkGate({ id: "gh-3", status: "todo", body });
    assert(r.gate === "author->ready", "case c: gate is author->ready");
    assert(r.ok === false, "case c: heading-only-no-content fails the todo gate");
    assert(
      /missing artifacts/.test(r.reason),
      `case c: reason names missing artifacts (got: ${r.reason})`
    );
  }

  // (d) ready status, fully-checked AC -> ok:true (execute->done)
  {
    const body =
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] a\n- [x] b\n- [x] c\n` +
      `## DoD\n${substantive("DoD")}\n`;
    const r = checkGate({ id: "gh-4", status: "ready", body });
    assert(r.gate === "execute->done", "case d: gate is execute->done");
    assert(r.ok === true, `case d: fully-checked AC passes the ready gate (reason: ${r.reason})`);
    assert(r.acTotal === 3 && r.acChecked === 3, "case d: acTotal/acChecked reported correctly");
  }

  // (e) ready status, partially-checked AC -> ok:false with correct N/M reason
  {
    const body =
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] a\n- [ ] b\n- [ ] c\n` +
      `## DoD\n${substantive("DoD")}\n`;
    const r = checkGate({ id: "gh-5", status: "ready", body });
    assert(r.gate === "execute->done", "case e: gate is execute->done");
    assert(r.ok === false, "case e: partially-checked AC fails the ready gate");
    assert(
      r.reason === "1/3 AC checkboxes checked",
      `case e: reason names the N/M count (got: ${r.reason})`
    );
  }

  // (f) done status -> terminal unconditional pass (primitive scope, no
  // children-recursion, matching native's own done-branch degrade-to-leaf
  // behavior for a task with no children)
  {
    const r = checkGate({ id: "gh-6", status: "done", body: "anything, irrelevant" });
    assert(r.gate === "none", "case f: done task reports gate 'none'");
    assert(r.ok === true, "case f: done task gates ok:true (terminal)");
    assert(r.reason === "terminal", "case f: done task reason is 'terminal'");
  }

  // Bonus regression: the \Z-is-not-a-JS-anchor class of bug (native's own
  // QN-005 fix) must not be reintroduced in this second implementation --
  // AC prose containing a bare "z"/"Z" must not truncate the section early.
  {
    const body =
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\nWhen the count is zero this used to truncate.\n- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four\n` +
      `## DoD\n${substantive("DoD")}\n`;
    const r = checkGate({ id: "gh-7", status: "ready", body });
    assert(r.gate === "execute->done", "case g: gate is execute->done");
    assert(
      r.acTotal === 4,
      `case g: AC section is not truncated at the word "zero" (acTotal should be 4, got ${r.acTotal})`
    );
  }

  // not-found case, matching the client.check(id) wrapper's shape (not
  // checkGate itself, which always assumes a resolved task -- documented
  // here to make the wrapper's contract explicit alongside the pure
  // function's own tests).
  {
    // checkGate itself has no "not found" branch (that's client.check()'s
    // job, mirroring store.js's own check()/get()-null split) -- this test
    // exists to document that boundary, not to re-test client.check()
    // itself (which requires a live/mocked gh api call, out of scope for
    // this pure-function test file per the package's existing convention).
    assert(true, "not-found handling lives in client.check(), not checkGate() -- documented boundary, no live-API test here");
  }

  if (failures > 0) {
    console.error(`\n${failures} QN-028 gate test failure(s).`);
    process.exitCode = 1;
  } else {
    console.log("\nAll QN-028 gate tests passed.");
  }
}

main();
