// @test-group serial
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-10 child-spawn kill under suite load (round-209 silent passed=false @1932ms)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this harness
// spawns 2 REAL node child processes (reparent-writer.mjs) for the file-lock cross-reparent proof.
// Under full-suite concurrency those child spawns can be killed/fail (EMFILE / TasksMax /
// suite-caused kill), and round-209 (2026-08-10) showed the exact signature: a silent passed=false
// at 1932ms — FASTER than the 2197ms solo run — with ZERO harness output lines (an assertion
// failure would always write FAIL: to fd 2; zero lines = the process died before the harness could
// report). Solo and 4x busy-loop CPU-load runs stay 19/19 green. Same child-spawn family as
// create-mcp / proposal-convergence / install-family (all routed to the concurrency-1 serial
// phase); this file was left in the default concurrent body and is now also routed to serial
// (gap-relation-sync-load-flake-child-spawn-under-suite).
// M35-native-relation-sync: proves store.js's `write()` now performs
// bidirectional parent/children relation sync (matching the github
// provider's `writeRelations()` contract, github-client.js ~L771-830) --
// closing the M28-discovered asymmetry where editing a task's `parent`
// field updated only that task's own frontmatter, leaving BOTH the old and
// new parent's `children` arrays stale.
//
// Run: node test/relation-sync.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createStore } from "../src/store.ts";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// AC6 (gap-relation-sync-suite-red-isolation-green): per-run-unique temp dir,
// NOT a fixed `.tmp-relation-sync-test` under the shared test directory. A
// fixed path in a shared checkout is the "isolated green / suite red"
// interference class M136's round 3 removed (tests rebuilding a shared dist
// bundle). No OTHER test references this path today, so this is hardening
// against the class, not a confirmed collision -- but a fixed path leaves the
// test exposed to stale state from a prior crashed/killed run and to any
// future traversal of the shared test dir, and costs nothing to avoid.
const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "relation-sync-test-"));

let failures = 0;
function writeErr(line) {
  // Synchronous stderr: node --test captures a test file's stderr through an
  // async pipe, and process.exit(1) can drop still-buffered async writes --
  // this hand-rolled harness's FAIL lines could vanish wholesale, leaving the
  // runner with ONLY the file-level "✖ ... (Nms)" line and no idea which
  // assertion failed (the exact diagnostic blocker this file hit in the
  // suite). fs.writeSync(2, ...) bypasses the async stream, so a failure can
  // never be silently dropped again.
  try {
    fs.writeSync(2, line + "\n");
  } catch {
    console.error(line);
  }
}
function assert(cond, msg, expected, actual) {
  if (cond) {
    console.log(`PASS: ${msg}`);
    return;
  }
  failures++;
  const caller = (new Error().stack.split("\n")[2] || "").trim() || "(unknown caller)";
  let detail = `FAIL: ${msg}\n  ${caller}`;
  if (arguments.length > 2) {
    detail += `\n  expected: ${JSON.stringify(expected)}`;
    detail += `\n  actual:   ${JSON.stringify(actual)}`;
  }
  writeErr(detail);
}

function resetStore() {
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.mkdirSync(tasksDir, { recursive: true });
  return createStore(tasksDir);
}

// --- Case 1: reparenting updates BOTH old and new parent's children ---
// This is the exact M28 repro scenario: a child moves from ParentA to
// ParentB via `write(childId, { parent: newParentId })`.
function testReparentUpdatesBothParents() {
  const store = resetStore();
  store.write("RS-PARENT-A", { title: "Parent A", status: "todo" });
  store.write("RS-PARENT-B", { title: "Parent B", status: "todo" });
  store.write("RS-CHILD-1", { title: "Child 1", status: "todo", parent: "RS-PARENT-A" });
  // Simulate ParentA's children array as it would be after a normal
  // create/edit flow that also declared the child from the parent side
  // (github's writeRelations() keeps both directions in sync from the
  // start; native's write() must too, going forward).
  store.write("RS-PARENT-A", { children: ["RS-CHILD-1"] });

  const before = store.get("RS-PARENT-A");
  assert(before.children.includes("RS-CHILD-1"), "setup: ParentA lists CHILD-1 as a child before reparenting", true, before.children);

  // The actual M28 action: edit the child's parent field.
  store.write("RS-CHILD-1", { parent: "RS-PARENT-B" });

  const childAfter = store.get("RS-CHILD-1");
  const parentAAfter = store.get("RS-PARENT-A");
  const parentBAfter = store.get("RS-PARENT-B");

  assert(childAfter.parent === "RS-PARENT-B", "child's own parent field updated to the new parent", "RS-PARENT-B", childAfter.parent);
  assert(!parentAAfter.children.includes("RS-CHILD-1"), "OLD parent (A) no longer lists CHILD-1 in its children array", false, parentAAfter.children);
  assert(parentBAfter.children.includes("RS-CHILD-1"), "NEW parent (B) now lists CHILD-1 in its children array", true, parentBAfter.children);
}

// --- Case 2: reparenting is idempotent / no-duplicate on the new parent ---
function testReparentNoDuplicateOnNewParent() {
  const store = resetStore();
  store.write("RS-PARENT-C", { title: "Parent C", status: "todo" });
  store.write("RS-CHILD-2", { title: "Child 2", status: "todo" });
  store.write("RS-PARENT-C", { children: ["RS-CHILD-2", "RS-OTHER"] });

  // Child 2 is already (independently) declared under Parent C's children
  // even though CHILD-2's own `parent` field was never set -- write()
  // "reparenting" it to the SAME parent it's already listed under must not
  // create a duplicate entry.
  store.write("RS-CHILD-2", { parent: "RS-PARENT-C" });

  const parentC = store.get("RS-PARENT-C");
  const count = parentC.children.filter((c) => c === "RS-CHILD-2").length;
  assert(count === 1, `no duplicate child entry created when reparenting to an already-listing parent (count=${count})`, 1, count);
  assert(parentC.children.includes("RS-OTHER"), "unrelated sibling child entry (RS-OTHER) is left untouched", true, parentC.children);
}

// --- Case 3: unsetting parent (parent: null) removes from old parent, adds nowhere ---
function testUnsetParentRemovesWithoutAddingElsewhere() {
  const store = resetStore();
  store.write("RS-PARENT-D", { title: "Parent D", status: "todo" });
  store.write("RS-CHILD-3", { title: "Child 3", status: "todo", parent: "RS-PARENT-D" });
  store.write("RS-PARENT-D", { children: ["RS-CHILD-3"] });

  store.write("RS-CHILD-3", { parent: null });

  const child = store.get("RS-CHILD-3");
  const parentD = store.get("RS-PARENT-D");
  assert(child.parent === null, "child's own parent field is now null", null, child.parent);
  assert(!parentD.children.includes("RS-CHILD-3"), "former parent no longer lists CHILD-3 as a child", false, parentD.children);
  // "adds it nowhere": no other task in the store should have gained
  // CHILD-3 as a child as a side effect of unsetting.
  const all = store.list();
  const anyoneElseHasIt = all.some((t) => t.id !== "RS-PARENT-D" && (t.children || []).includes("RS-CHILD-3"));
  assert(!anyoneElseHasIt, "unsetting parent does not add the child to any other task's children array", false, anyoneElseHasIt);
}

// --- Case 4: writing an unrelated field (no `parent` key at all) does not
// scan for / touch any other task's children -- the sync logic must only
// run when `parent` is explicitly part of the write() call.
function testUnrelatedWriteDoesNotTriggerSync() {
  const store = resetStore();
  store.write("RS-PARENT-E", { title: "Parent E", status: "todo" });
  store.write("RS-CHILD-4", { title: "Child 4", status: "todo", parent: "RS-PARENT-E" });
  store.write("RS-PARENT-E", { children: ["RS-CHILD-4"] });

  store.write("RS-CHILD-4", { title: "Child 4 renamed" }); // no `parent` key

  const parentE = store.get("RS-PARENT-E");
  assert(parentE.children.includes("RS-CHILD-4"), "editing an unrelated field (title) leaves the parent's children array untouched", true, parentE.children);
}

// --- Case 5: THE MULTI-FILE CONCURRENT WRITE PROOF ---
// Two REAL, separate OS processes each reparent a DIFFERENT child, but the
// two operations reference an OVERLAPPING pair of parent ids in OPPOSITE
// roles (writer 1: child X moves A -> B; writer 2: child Y moves B -> A) --
// exactly the shape that would deadlock a naive "lock in caller-supplied
// order" implementation (writer 1 wants A-then-B, writer 2 wants B-then-A).
// withLocks()'s fixed global sort order (see store.js) must prevent this:
// both processes must complete without hanging, and neither store's
// on-disk state may end up corrupted (unparseable) or losing an update.
async function testConcurrentCrossReparentNoDeadlockNoCorruption() {
  const store = resetStore();
  store.write("RS-PARENT-X", { title: "Parent X", status: "todo" });
  store.write("RS-PARENT-Y", { title: "Parent Y", status: "todo" });
  store.write("RS-CHILD-X1", { title: "Child X1", status: "todo", parent: "RS-PARENT-X" });
  store.write("RS-PARENT-X", { children: ["RS-CHILD-X1"] });
  store.write("RS-CHILD-Y1", { title: "Child Y1", status: "todo", parent: "RS-PARENT-Y" });
  store.write("RS-PARENT-Y", { children: ["RS-CHILD-Y1"] });

  const helper = path.join(__dirname, "reparent-writer.mjs");

  // Writer 1: CHILD-X1 moves from PARENT-X to PARENT-Y (locks needed: X1, X, Y)
  // Writer 2: CHILD-Y1 moves from PARENT-Y to PARENT-X (locks needed: Y1, Y, X)
  // Both need locks on {X, Y} -- in opposite "natural" order -- concurrently.
  const p1 = execFileAsync("node", [helper, tasksDir, "RS-CHILD-X1", "RS-PARENT-Y"], { timeout: 15000 });
  const p2 = execFileAsync("node", [helper, tasksDir, "RS-CHILD-Y1", "RS-PARENT-X"], { timeout: 15000 });

  const results = await Promise.allSettled([p1, p2]);
  const bothSucceeded = results.every((r) => r.status === "fulfilled");
  assert(bothSucceeded, `both concurrent cross-reparent processes completed without hanging/erroring (no deadlock) -- ${JSON.stringify(results.map((r) => r.status))}`, true, results.map((r) => r.status));

  // No corruption: every file in the store must still parse.
  let parseError = null;
  let all;
  try {
    all = store.list();
  } catch (err) {
    parseError = err;
  }
  assert(parseError === null, "store.list() still parses every file after the concurrent cross-reparent (no corruption)", null, parseError);

  const childX1 = store.get("RS-CHILD-X1");
  const childY1 = store.get("RS-CHILD-Y1");
  const parentX = store.get("RS-PARENT-X");
  const parentY = store.get("RS-PARENT-Y");

  assert(childX1.parent === "RS-PARENT-Y", "CHILD-X1's own parent field reflects its move to PARENT-Y", "RS-PARENT-Y", childX1.parent);
  assert(childY1.parent === "RS-PARENT-X", "CHILD-Y1's own parent field reflects its move to PARENT-X", "RS-PARENT-X", childY1.parent);
  assert(!parentX.children.includes("RS-CHILD-X1"), "PARENT-X no longer lists CHILD-X1 (it moved away)", false, parentX.children);
  assert(parentX.children.includes("RS-CHILD-Y1"), "PARENT-X now lists CHILD-Y1 (it moved in)", true, parentX.children);
  assert(!parentY.children.includes("RS-CHILD-Y1"), "PARENT-Y no longer lists CHILD-Y1 (it moved away)", false, parentY.children);
  assert(parentY.children.includes("RS-CHILD-X1"), "PARENT-Y now lists CHILD-X1 (it moved in)", true, parentY.children);

  // No leftover lock files after both writers finish.
  for (const id of ["RS-CHILD-X1", "RS-CHILD-Y1", "RS-PARENT-X", "RS-PARENT-Y"]) {
    const lockPath = path.join(tasksDir, `${id}.md.lock`);
    assert(!fs.existsSync(lockPath), `no leftover lock file for ${id} after concurrent writers finish`, false, fs.existsSync(lockPath));
  }
}

// AC3 (gap-relation-sync-load-flake-child-spawn-under-suite): top-level failure diagnostic. This
// harness spawns 2 REAL node child processes (reparent-writer.mjs) for the file-lock cross-reparent
// proof; under full-suite concurrency a child spawn can fail (EMFILE / TasksMax / suite-caused kill)
// and the rejection at the top-level await previously surfaced as a SILENT passed=false with zero
// harness output (round-209). A spawn failure or any top-level exception must now be LOUD — a
// synchronous fd-2 `FAIL:` (same contract as writeErr, so node --test's async stderr pipe cannot
// drop it) and a non-zero exit. Assertions are NOT weakened — this only converts an unhandled
// top-level exception into a diagnosable failure instead of a silent file-level fail.
try {
  testReparentUpdatesBothParents();
  testReparentNoDuplicateOnNewParent();
  testUnsetParentRemovesWithoutAddingElsewhere();
  testUnrelatedWriteDoesNotTriggerSync();
  await testConcurrentCrossReparentNoDeadlockNoCorruption();
} catch (err) {
  writeErr(`FAIL: ${err && err.stack ? err.stack : err}`);
  process.exitCode = 1;
}

fs.rmSync(tasksDir, { recursive: true, force: true });

if (failures > 0) {
  writeErr(`\n${failures} failure(s).`);
  // process.exitCode (NOT process.exit(1)): the harness must let the event
  // loop drain before exiting. process.exit(1) terminates immediately and can
  // drop still-buffered async stderr writes when stderr is a pipe (as node
  // --test captures it) -- the exact "one file-level line, no assertion
  // detail" failure this file hit in the suite. Every other hand-rolled
  // harness in this repo (test-shape-analysis.md: 34 files) uses the
  // process.exitCode pattern; this one used process.exit(1) and paid for it.
  process.exitCode = 1;
} else if (process.exitCode === undefined) {
  console.log("\nAll M35-native-relation-sync tests passed.");
}
