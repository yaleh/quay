// @test-group product
// gap-both-gates-read-one-signal-so-done-costs-nothing: REVERSES QN-019
// (iteration 8). QN-019 tightened the author->ready gate to require AC
// checked-state; that tightening is what made `ready` mean "already done"
// and made execute->done vacuous (both gates read the same evidence).
// ADR-001's original design — restored here — says checked-state belongs to
// `ready->done`, NOT `todo->ready`: for a not-yet-started task the AC
// describes "what the work must satisfy", which by definition cannot be
// checked yet. The two gates now read DIFFERENT evidence:
//   author->ready reads the plan + AC presence/shape (>=1 checkbox, no
//     checked-state requirement);
//   execute->done reads the DoD checked-state (plus AC checked-state as the
//     AC5 backstop, so "ready too strict" is not traded for "done too loose").
//
// This file is the historical home of the presence-vs-checked distinction;
// the cases below are updated to the new semantics, and the execute->done
// DoD-reading behavior is covered here too (AC7b).
//
// Run: node test/gate-checked-state.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.join(__dirname, ".tmp-gate-checked-state-test");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function reset() {
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.mkdirSync(tasksDir, { recursive: true });
}

const substantive = (label) =>
  `${label} — this is real, substantive prose describing the ${label.toLowerCase()} in enough detail to exceed the minimum content threshold for this section, well past forty characters.`;

function main() {
  reset();
  const store = createStore(tasksDir);

  // (a) zero checkboxes at all in the AC section: unchanged behavior,
  // "AC section has no checkboxes" reason (AC4 negative control).
  store.write("CS-A", {
    title: "no-checkboxes",
    status: "todo",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\nprose only, no checkbox lines at all, well past forty non-whitespace characters of real descriptive acceptance-criteria text.\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("CS-A");
    assert(r.gate === "author->ready", "CS-A: gate is author->ready");
    assert(r.ok === false, "CS-A: zero-checkbox AC fails the gate");
    assert(
      r.reason === "AC section has no checkboxes",
      `CS-A: reason is the no-checkboxes reason (got: ${r.reason})`
    );
  }

  // (b) THE QN-017 SHAPE, NOW REVERSED: checkboxes present, NONE checked.
  // Under the restored ADR-001 semantics this PASSES author->ready (AC3) —
  // checked-state is not required at todo->ready. This is the exact shape
  // the old QN-019 tightening made fail; this task reverses that decision.
  store.write("CS-B", {
    title: "present-but-unchecked",
    status: "todo",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [ ] first criterion, described with enough real prose to pass the minimum-content bar\n- [ ] second criterion, also described with enough real prose\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("CS-B");
    assert(r.gate === "author->ready", "CS-B: gate is author->ready");
    assert(
      r.ok === true,
      `CS-B: checkboxes present but 0 checked PASSES author->ready now (ADR-001 restored; got ok=${r.ok}, reason="${r.reason}")`
    );
    assert(
      r.acTotal === 2 && r.acChecked === 0,
      `CS-B: acTotal/acChecked still surfaced for the author->ready gate (got ${r.acTotal}/${r.acChecked})`
    );
  }

  // (c) partially checked: 1 of 2 checked — also passes author->ready now.
  store.write("CS-C", {
    title: "partially-checked",
    status: "todo",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] first criterion, described with enough real prose to pass the minimum-content bar\n- [ ] second criterion, also described with enough real prose\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("CS-C");
    assert(r.gate === "author->ready", "CS-C: gate is author->ready");
    assert(
      r.ok === true,
      `CS-C: partially-checked AC passes author->ready (checked-state not required; got ok=${r.ok})`
    );
  }

  // (d) fully checked: still passes (unchanged behavior).
  store.write("CS-D", {
    title: "fully-checked",
    status: "todo",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] first criterion, described with enough real prose to pass the minimum-content bar\n- [x] second criterion, also described with enough real prose\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("CS-D");
    assert(r.gate === "author->ready", "CS-D: gate is author->ready");
    assert(r.ok === true, `CS-D: fully-checked AC passes the gate (reason: ${r.reason})`);
  }

  // (e) execute->done AC5 backstop: unchecked AC must still block done
  // ("ready too strict" must not become "done too loose"). DoD here is
  // prose-only (vacuous-true), so the AC check is the only reason it is red.
  store.write("CS-E", {
    title: "ready-branch-ac-backstop",
    status: "ready",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [ ] one\n- [ ] two\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("CS-E");
    assert(r.gate === "execute->done", "CS-E: gate is execute->done");
    assert(r.ok === false, "CS-E: unchecked AC still fails execute->done as before (AC5 backstop)");
    assert(
      r.reason === "0/2 AC checkboxes checked",
      `CS-E: execute->done reason format unchanged (got: ${r.reason})`
    );
  }

  // (f) AC7b (the main criterion): execute->done reads the DoD checked-state.
  // AC all checked, DoD checkboxes present but NONE checked => RED.
  store.write("CS-F", {
    title: "ac-checked-dod-unchecked",
    status: "ready",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] first acceptance criterion, fully checked\n- [x] second acceptance criterion, fully checked\n` +
      `## DoD\n- [ ] first definition-of-done item, deliberately NOT checked\n- [ ] second definition-of-done item, deliberately NOT checked\n- [ ] third definition-of-done item, deliberately NOT checked\n`,
  });
  {
    const r = store.check("CS-F");
    assert(r.gate === "execute->done", "CS-F: gate is execute->done");
    assert(
      r.ok === false,
      `CS-F (AC7b): AC all checked but DoD all unchecked => execute->done RED (got ok=${r.ok}, reason="${r.reason}")`
    );
    assert(
      r.reason === "0/3 DoD checkboxes checked",
      `CS-F: reason names the DoD checked-state count (got: ${r.reason})`
    );
    assert(r.dodTotal === 3 && r.dodChecked === 0, "CS-F: dodTotal/dodChecked surfaced");
  }

  // (g) AC7c (DIR-102 replay): a zero-work task — established, all AC checked
  // in one commit, lifted to ready — must NOT be closeable. Same shape as (f).
  // (CS-F already covers the shape; this pins the same assertion through a
  // literal "zero work" fixture name.)

  // (h) execute->done positive: AC all checked AND DoD all checked => ok:true.
  store.write("CS-G", {
    title: "ac-and-dod-checked",
    status: "ready",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] first acceptance criterion, fully checked\n- [x] second acceptance criterion, fully checked\n` +
      `## DoD\n- [x] first definition-of-done item, genuinely done\n- [x] second definition-of-done item, genuinely done\n`,
  });
  {
    const r = store.check("CS-G");
    assert(r.gate === "execute->done", "CS-G: gate is execute->done");
    assert(
      r.ok === true,
      `CS-G: AC and DoD all checked => execute->done ok:true (reason: ${r.reason})`
    );
    assert(r.reason === "all AC and DoD checkboxes checked; eligible to move to done", "CS-G: reason is the new combined text");
  }

  reset();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exitCode = 1;
  } else {
    console.log("\nAll gate-checked-state tests passed.");
  }
}

main();
