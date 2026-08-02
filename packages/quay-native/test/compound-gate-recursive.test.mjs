// @test-group product
// QN-016 (iteration 7): recursive childrenStatus() re-verification.
//
// Iteration 6's independent, out-of-band audit
// (experiments/quay-native-bootstrap/audits/iteration-6-independent-adjudicate.md, Finding 1) found
// that childrenStatus() only checks one level deep (child.status), not
// recursively into a child's own children/grandchildren. A `done` epic whose
// grandchild reverted would not be caught by the compound gate check. This
// test file proves the fix: childrenStatus() now recurses, rolling up a
// "stale-done" status for a child whose own stored status says "done" but
// whose subtree is not actually fully done, and check() (unchanged since
// QN-012) correctly treats "stale-done" as not-done via its existing
// `.every(c => c.status === "done")` check.
//
// Run: node test/compound-gate-recursive.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.join(__dirname, ".tmp-compound-gate-recursive-test");

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

const FULL_BODY = () => `
## Proposal
This is a real proposal with enough substantive content to clear the
MIN_SECTION_CHARS floor used by artifactSections, describing a genuine gap.

## Plan
1. Phase one does something concrete and specific to this fixture task.
2. Phase two follows on from phase one with more concrete detail here.

## AC
- [x] first acceptance criterion, already checked
- [x] second acceptance criterion, already checked

## DoD
- [x] independently re-verified against real command output, not assumed
`;

function main() {
  reset();
  const store = createStore(tasksDir);

  // --- Case 1: 3-level tree, all done -> ok:true at the top epic ---
  store.write("GRANDCHILD-DONE", { title: "grandchild done", status: "done", body: FULL_BODY() });
  store.write("MIDDLE-ALL-DONE", {
    title: "middle compound, its own child done",
    status: "done",
    children: ["GRANDCHILD-DONE"],
    body: FULL_BODY(),
  });
  store.write("TOP-ALL-DONE", {
    title: "top epic, all descendants done",
    status: "done",
    children: ["MIDDLE-ALL-DONE"],
    body: FULL_BODY(),
  });
  {
    const r = store.check("TOP-ALL-DONE");
    assert(r.ok === true, "3-level tree, all done -> top epic check() ok:true");
  }

  // --- Case 2: grandchild reverted to todo; middle's own stored status is
  //     stale at "done" (nothing cascades this automatically) ---
  store.write("GRANDCHILD-REVERTED", { title: "grandchild reverted", status: "done", body: FULL_BODY() });
  store.write("MIDDLE-STALE", {
    title: "middle compound, stale done despite reverted grandchild",
    status: "done",
    children: ["GRANDCHILD-REVERTED"],
    body: FULL_BODY(),
  });
  store.write("TOP-STALE", {
    title: "top epic over a stale middle",
    status: "done",
    children: ["MIDDLE-STALE"],
    body: FULL_BODY(),
  });
  // Now revert the grandchild without touching MIDDLE-STALE's or
  // TOP-STALE's own stored status frontmatter — this is the exact scenario
  // the independent audit named: nothing cascades a parent's stored status
  // when a grandchild changes.
  store.write("GRANDCHILD-REVERTED", { status: "todo" });
  {
    const r = store.check("TOP-STALE");
    assert(
      r.ok === false,
      "3-level tree with reverted grandchild -> top epic check() ok:false (recursion catches it, not silently done)"
    );
    assert(
      JSON.stringify(r).includes("GRANDCHILD-REVERTED"),
      "top epic's check() result names the actual offending grandchild, not just the stale middle"
    );
  }

  // --- Case 3: same case, but checking the MIDDLE task directly (not only
  //     reachable from the very top) ---
  {
    const r = store.check("MIDDLE-STALE");
    assert(
      r.ok === false,
      "checking the middle compound task directly also catches its own reverted child"
    );
  }

  // --- Case 4: childrenStatus() itself reports "stale-done" for the middle
  //     task when viewed from the top, distinguishable from real "done" ---
  {
    const kids = store.childrenStatus(store.get("TOP-STALE"));
    const middleEntry = kids.find((c) => c.id === "MIDDLE-STALE");
    assert(
      middleEntry !== undefined && middleEntry.status === "stale-done",
      `top-level childrenStatus() reports MIDDLE-STALE as "stale-done", not "done" (got: ${middleEntry && middleEntry.status})`
    );
  }

  // --- Case 5: cyclic children reference does not crash / infinite-loop ---
  store.write("CYCLE-A", { title: "cycle A", status: "done", children: ["CYCLE-B"], body: FULL_BODY() });
  store.write("CYCLE-B", { title: "cycle B", status: "done", children: ["CYCLE-A"], body: FULL_BODY() });
  {
    let result;
    let threw = false;
    try {
      result = store.check("CYCLE-A");
    } catch (e) {
      threw = true;
    }
    assert(!threw, "a cyclic children reference does not crash check() (self-referential A<->B)");
    assert(
      result !== undefined && result.ok === false,
      "a cyclic children reference resolves to ok:false rather than hanging or silently passing"
    );
  }
  // Direct self-reference (a task listing itself as its own child).
  store.write("CYCLE-SELF", { title: "self cycle", status: "done", children: ["CYCLE-SELF"], body: FULL_BODY() });
  {
    let result;
    let threw = false;
    try {
      result = store.check("CYCLE-SELF");
    } catch (e) {
      threw = true;
    }
    assert(!threw, "a direct self-referential child does not crash check()");
    assert(result !== undefined && result.ok === false, "a direct self-referential child resolves to ok:false");
  }

  // --- Case 6: regression — leaf task with no children unaffected ---
  store.write("LEAF-UNCHANGED", { title: "plain leaf", status: "done", body: FULL_BODY() });
  {
    const r = store.check("LEAF-UNCHANGED");
    assert(r.ok === true, "plain leaf task (no children) unaffected by recursive childrenStatus change");
    assert(r.childrenStatus === undefined, "plain leaf task result still has no childrenStatus field");
  }

  // --- Case 7: regression — single-level compound (QN-012's original case)
  //     still behaves exactly as before ---
  store.write("SINGLE-LEVEL-CHILD-TODO", { title: "single-level child still todo", status: "todo", body: FULL_BODY() });
  store.write("SINGLE-LEVEL-EPIC", {
    title: "single-level epic, one child still todo",
    status: "done",
    children: ["SINGLE-LEVEL-CHILD-TODO"],
    body: FULL_BODY(),
  });
  {
    const r = store.check("SINGLE-LEVEL-EPIC");
    assert(r.ok === false, "single-level compound regression: done epic with a todo child -> ok:false (unchanged from QN-012)");
    assert(r.reason.includes("SINGLE-LEVEL-CHILD-TODO"), "single-level regression: reason still names the offending child directly");
  }

  console.log(failures === 0 ? "All QN-016 recursive compound-gate tests passed" : `${failures} FAILURE(S)`);
  fs.rmSync(tasksDir, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main();
