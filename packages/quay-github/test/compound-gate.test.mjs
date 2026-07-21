// QN-035 (iteration 25, DIR-006): compound/epic (children non-empty)
// gate-correctness tests for quay-github's `checkGate()`/`childrenStatus()`.
// Direct port of packages/quay-native/test/compound-gate.test.mjs +
// compound-gate-recursive.test.mjs's own case structure (QN-012/QN-016),
// adapted to inject a synthetic `getChildTask(id)` fetcher instead of a
// local file-store `get()` -- mirrors this package's own established
// injected-fixture convention (pageIssues/write.test.mjs), no live `gh api`
// call in this file.
//
// Run: node test/compound-gate.test.mjs
import { checkGate } from "../src/github-client.ts";

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

const FULL_BODY_ALL_CHECKED = (children = []) =>
  `## Proposal\n${substantive("Proposal")}\n` +
  `## Plan\n${substantive("Plan")}\n` +
  `## AC\n- [x] first acceptance criterion, already checked\n- [x] second, already checked\n` +
  `## DoD\n${substantive("DoD")}\n` +
  children.map((c) => `- [x] #${c}`).join("\n");

function mkFixture() {
  // A small graph of synthetic issues, keyed by "gh-<n>" id, mirroring the
  // shape client.get(id) would return (view-model fields only -- body is
  // irrelevant to childrenStatus, which only reads status/role/children).
  const fixtures = new Map();
  const add = (id, { status, role = "primitive", children = [] }) => {
    fixtures.set(id, { id, status, role, children, body: FULL_BODY_ALL_CHECKED() });
  };

  add("gh-101", { status: "done" }); // primitive, done
  add("gh-102", { status: "done" }); // primitive, done
  add("gh-103", { status: "todo" }); // primitive, still todo

  // EPIC-ALL-DONE analog: compound, all children done
  add("gh-200", { status: "done", role: "compound", children: ["gh-101", "gh-102"] });
  // EPIC-CHILD-TODO analog: compound, one child still todo
  add("gh-201", { status: "done", role: "compound", children: ["gh-101", "gh-103"] });
  // EPIC-MISSING-CHILD analog: compound, one child id does not resolve
  add("gh-202", { status: "done", role: "compound", children: ["gh-101", "gh-999"] });
  // Nested: grandchild epic (gh-300) whose own child (gh-103) is todo ->
  // gh-300 reports "stale-done" if its own status label says done but its
  // subtree is not fully done.
  add("gh-300", { status: "done", role: "compound", children: ["gh-103"] });
  add("gh-301", { status: "done", role: "compound", children: ["gh-300", "gh-101"] });
  // Cyclic reference: gh-400 lists gh-401 as a child, gh-401 lists gh-400
  // back -- must not crash/hang, must report "missing" for the cycle edge.
  add("gh-400", { status: "done", role: "compound", children: ["gh-401"] });
  add("gh-401", { status: "done", role: "compound", children: ["gh-400"] });

  return (id) => fixtures.get(id) ?? null;
}

function main() {
  const getChildTask = mkFixture();

  // === Case 1: done compound task, all children done -> ok:true, childrenStatus present ===
  {
    const task = { id: "gh-200", status: "done", role: "compound", children: ["gh-101", "gh-102"], body: "" };
    const r = checkGate(task, getChildTask);
    assert(r.ok === true, "done compound task with all children done -> ok:true");
    assert(Array.isArray(r.childrenStatus) && r.childrenStatus.length === 2, "childrenStatus present with 2 entries for done compound task");
  }

  // === Case 2: done compound task, one child still todo -> ok:false, names it ===
  {
    const task = { id: "gh-201", status: "done", role: "compound", children: ["gh-101", "gh-103"], body: "" };
    const r = checkGate(task, getChildTask);
    assert(r.ok === false, "done compound task with a non-done child -> ok:false");
    assert(r.reason.includes("gh-103"), "reason names the specific offending child (gh-103)");
    assert(r.reason.includes("todo"), "reason includes the offending child's actual status");
  }

  // === Case 3: done compound task, a child id that does not resolve -> ok:false, "missing" ===
  {
    const task = { id: "gh-202", status: "done", role: "compound", children: ["gh-101", "gh-999"], body: "" };
    const r = checkGate(task, getChildTask);
    assert(r.ok === false, "done compound task referencing a nonexistent child -> ok:false");
    assert(r.reason.includes("gh-999"), "reason names the dangling child id (gh-999)");
    assert(r.reason.includes("missing"), "reason reports the dangling child's status as 'missing'");
  }

  // === Case 4: nested compound -- grandchild not done rolls up as "stale-done", not "done" ===
  {
    const task = { id: "gh-301", status: "done", role: "compound", children: ["gh-300", "gh-101"], body: "" };
    const r = checkGate(task, getChildTask);
    assert(r.ok === false, "top-level epic with a stale-done middle child -> ok:false");
    const middleEntry = r.childrenStatus.find((c) => c.id === "gh-300");
    assert(
      middleEntry && middleEntry.status === "stale-done",
      `top-level childrenStatus() reports gh-300 as "stale-done", not "done" (got: ${middleEntry && middleEntry.status})`
    );
    assert(
      Array.isArray(middleEntry.childrenStatus) && middleEntry.childrenStatus.length === 1,
      "gh-300's own childrenStatus (grandchildren) is present and recursed into"
    );
  }

  // === Case 5: cyclic parent/child reference -> reported "missing" for the cycle edge, no crash/hang ===
  {
    const task = { id: "gh-400", status: "done", role: "compound", children: ["gh-401"], body: "" };
    const r = checkGate(task, getChildTask);
    assert(r !== undefined, "cyclic compound graph does not crash or hang checkGate()");
    const child = r.childrenStatus.find((c) => c.id === "gh-401");
    assert(child && Array.isArray(child.childrenStatus), "gh-401 is itself compound, recursed into once");
    const cycleEdge = child.childrenStatus.find((c) => c.id === "gh-400");
    assert(
      cycleEdge && cycleEdge.status === "missing",
      `cyclic self-reference (gh-400 -> gh-401 -> gh-400) reported as "missing", not infinitely recursed (got: ${cycleEdge && cycleEdge.status})`
    );
  }

  // === Case 6: ready compound task, AC fully checked but a child still todo -> ok:false ===
  {
    const body = FULL_BODY_ALL_CHECKED();
    const task = { id: "gh-201", status: "ready", role: "compound", children: ["gh-101", "gh-103"], body };
    const r = checkGate(task, getChildTask);
    assert(r.gate === "execute->done", "ready compound task: gate is execute->done");
    assert(r.ok === false, "ready compound task, AC complete but a child is not done -> ok:false");
    assert(r.reason.includes("AC checkboxes complete"), "reason distinguishes AC-complete-but-children-incomplete case");
    assert(r.reason.includes("gh-103"), "reason names the offending child gh-103");
  }

  // === Case 7: ready compound task, AC fully checked AND all children done -> ok:true ===
  {
    const body = FULL_BODY_ALL_CHECKED();
    const task = { id: "gh-200", status: "ready", role: "compound", children: ["gh-101", "gh-102"], body };
    const r = checkGate(task, getChildTask);
    assert(r.gate === "execute->done", "ready compound task, all satisfied: gate is execute->done");
    assert(r.ok === true, `ready compound task, AC complete and all children done -> ok:true (reason: ${r.reason})`);
    assert(Array.isArray(r.childrenStatus) && r.childrenStatus.length === 2, "childrenStatus present for a satisfied ready compound task");
  }

  // === Case 8: primitive task (role/children absent or empty) -> unaffected, no childrenStatus field at all ===
  {
    const body = FULL_BODY_ALL_CHECKED();
    const task = { id: "gh-101", status: "done", body: "anything" };
    const r = checkGate(task); // no getChildTask supplied at all -- must not throw
    assert(r.ok === true, "primitive done task (no role/children args) unaffected by compound support -- still ok:true");
    assert(r.childrenStatus === undefined, "primitive done task result has no childrenStatus field (role-gated, not always present)");
  }
  {
    const body = FULL_BODY_ALL_CHECKED();
    const task = { id: "gh-999", status: "ready", role: "primitive", children: [], body };
    const r = checkGate(task, getChildTask);
    assert(r.ok === true, "primitive ready task (role explicitly primitive, children empty) unaffected by compound support");
    assert(r.childrenStatus === undefined, "primitive ready task result has no childrenStatus field");
  }

  if (failures > 0) {
    console.error(`\n${failures} QN-035 compound-gate test failure(s).`);
    process.exitCode = 1;
  } else {
    console.log("\nAll QN-035 compound-gate tests passed.");
  }
}

main();
