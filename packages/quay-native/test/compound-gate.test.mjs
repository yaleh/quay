// @test-group product
// QN-012 (iteration 6): compound-aware check() re-verification.
//
// Before this fix, store.js's check() had no role-aware branch at all — a
// `done` compound (epic) task unconditionally returned
// { gate: "none", ok: true, reason: "terminal" }, with zero cross-check
// against its children's live state (iteration 5's independent audit,
// Claim 5). This test file proves the fix: a done/ready compound task now
// genuinely re-verifies its children, while primitive (leaf) task behavior
// is provably unchanged.
//
// Run: node test/compound-gate.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.join(__dirname, ".tmp-compound-gate-test");

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

const FULL_BODY = (extraAc = "") => `
## Proposal
This is a real proposal with enough substantive content to clear the
MIN_SECTION_CHARS floor used by artifactSections, describing a genuine gap.

## Plan
1. Phase one does something concrete and specific to this fixture task.
2. Phase two follows on from phase one with more concrete detail here.

## AC
- [x] first acceptance criterion, already checked
- [x] second acceptance criterion, already checked${extraAc}

## DoD
- [x] independently re-verified against real command output, not assumed
`;

function main() {
  reset();
  const store = createStore(tasksDir);

  // --- Fixtures: primitive (leaf) children ---
  store.write("CHILD-DONE-1", { title: "child done 1", status: "done", body: FULL_BODY() });
  store.write("CHILD-DONE-2", { title: "child done 2", status: "done", body: FULL_BODY() });
  store.write("CHILD-TODO", { title: "child still todo", status: "todo", body: FULL_BODY() });

  // === Case 1: done compound task, all children done -> ok:true ===
  store.write("EPIC-ALL-DONE", {
    title: "epic all children done",
    status: "done",
    children: ["CHILD-DONE-1", "CHILD-DONE-2"],
    body: FULL_BODY(),
  });
  {
    const r = store.check("EPIC-ALL-DONE");
    assert(r.ok === true, "done compound task with all children done -> ok:true (no regression)");
    assert(Array.isArray(r.childrenStatus) && r.childrenStatus.length === 2, "childrenStatus present with 2 entries for done compound task");
  }

  // === Case 2: done compound task, one child still todo -> ok:false, names it ===
  store.write("EPIC-CHILD-TODO", {
    title: "epic with one child still todo",
    status: "done",
    children: ["CHILD-DONE-1", "CHILD-TODO"],
    body: FULL_BODY(),
  });
  {
    const r = store.check("EPIC-CHILD-TODO");
    assert(r.ok === false, "done compound task with a non-done child -> ok:false");
    assert(r.reason.includes("CHILD-TODO"), "reason names the specific offending child (CHILD-TODO)");
    assert(r.reason.includes("todo"), "reason includes the offending child's actual status");
  }

  // === Case 3: done compound task, a child id that does not resolve -> ok:false, "missing" ===
  store.write("EPIC-MISSING-CHILD", {
    title: "epic referencing a nonexistent child",
    status: "done",
    children: ["CHILD-DONE-1", "CHILD-DOES-NOT-EXIST"],
    body: FULL_BODY(),
  });
  {
    const r = store.check("EPIC-MISSING-CHILD");
    assert(r.ok === false, "done compound task with a missing child id -> ok:false");
    assert(r.reason.includes("CHILD-DOES-NOT-EXIST"), "reason names the missing child id");
    assert(r.reason.includes("missing"), "reason distinguishes 'missing' from 'not done'");
  }

  // === Case 4: ready compound task, AC fully checked but a child still todo -> ok:false ===
  store.write("EPIC-READY-CHILD-TODO", {
    title: "ready epic blocked on a child",
    status: "ready",
    children: ["CHILD-DONE-1", "CHILD-TODO"],
    body: FULL_BODY(),
  });
  {
    const r = store.check("EPIC-READY-CHILD-TODO");
    assert(r.gate === "execute->done", "ready compound task reports execute->done gate");
    assert(r.ok === false, "ready compound task with AC complete but a child still todo -> ok:false (blocked on children, not just AC)");
    assert(r.reason.includes("CHILD-TODO"), "reason for blocked ready compound task names the offending child");
  }

  // === Case 5: ready compound task, AC fully checked and all children done -> ok:true (positive case) ===
  store.write("EPIC-READY-ALL-DONE", {
    title: "ready epic with all children done",
    status: "ready",
    children: ["CHILD-DONE-1", "CHILD-DONE-2"],
    body: FULL_BODY(),
  });
  {
    const r = store.check("EPIC-READY-ALL-DONE");
    assert(r.ok === true, "ready compound task with AC complete and all children done -> ok:true (new branch does not over-block)");
  }

  // === Case 6: primitive (leaf) tasks — done and ready — unchanged behavior ===
  store.write("LEAF-DONE", { title: "leaf done", status: "done", body: FULL_BODY() });
  {
    const r = store.check("LEAF-DONE");
    assert(r.ok === true, "primitive done task -> ok:true (unchanged)");
    assert(r.reason === "terminal", "primitive done task reason is still exactly 'terminal' (no compound framing leaks in)");
    assert(r.childrenStatus === undefined, "primitive done task result has no childrenStatus field (role-gated, not always present)");
  }
  store.write("LEAF-READY", { title: "leaf ready, AC complete", status: "ready", body: FULL_BODY() });
  {
    const r = store.check("LEAF-READY");
    assert(r.ok === true, "primitive ready task with AC complete -> ok:true (unchanged)");
    assert(r.childrenStatus === undefined, "primitive ready task result has no childrenStatus field");
  }
  store.write("LEAF-READY-INCOMPLETE-AC", {
    title: "leaf ready, AC incomplete",
    status: "ready",
    body: `
## Proposal
Real proposal content, long enough to clear the minimum section length bar.

## Plan
1. One phase, described with enough real detail to pass the content check.

## AC
- [ ] unchecked acceptance criterion

## DoD
- [x] independently re-verified
`,
  });
  {
    const r = store.check("LEAF-READY-INCOMPLETE-AC");
    assert(r.ok === false, "primitive ready task with incomplete AC -> ok:false (AC5 backstop: AC checked-state still required at execute->done)");
  }

  console.log(failures === 0 ? "All QN-012 compound-gate tests passed" : `${failures} FAILURE(S)`);
  fs.rmSync(tasksDir, { recursive: true, force: true }); // matches lock.test.mjs's own cleanup discipline
  process.exit(failures === 0 ? 0 : 1);
}

main();
