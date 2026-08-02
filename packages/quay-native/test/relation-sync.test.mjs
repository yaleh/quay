// @test-group product
// M35-native-relation-sync: proves store.js's `write()` now performs
// bidirectional parent/children relation sync (matching the github
// provider's `writeRelations()` contract, github-client.js ~L771-830) --
// closing the M28-discovered asymmetry where editing a task's `parent`
// field updated only that task's own frontmatter, leaving BOTH the old and
// new parent's `children` arrays stale.
//
// Run: node test/relation-sync.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createStore } from "../src/store.ts";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.join(__dirname, ".tmp-relation-sync-test");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
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
  assert(before.children.includes("RS-CHILD-1"), "setup: ParentA lists CHILD-1 as a child before reparenting");

  // The actual M28 action: edit the child's parent field.
  store.write("RS-CHILD-1", { parent: "RS-PARENT-B" });

  const childAfter = store.get("RS-CHILD-1");
  const parentAAfter = store.get("RS-PARENT-A");
  const parentBAfter = store.get("RS-PARENT-B");

  assert(childAfter.parent === "RS-PARENT-B", "child's own parent field updated to the new parent");
  assert(!parentAAfter.children.includes("RS-CHILD-1"), "OLD parent (A) no longer lists CHILD-1 in its children array");
  assert(parentBAfter.children.includes("RS-CHILD-1"), "NEW parent (B) now lists CHILD-1 in its children array");
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
  assert(count === 1, `no duplicate child entry created when reparenting to an already-listing parent (count=${count})`);
  assert(parentC.children.includes("RS-OTHER"), "unrelated sibling child entry (RS-OTHER) is left untouched");
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
  assert(child.parent === null, "child's own parent field is now null");
  assert(!parentD.children.includes("RS-CHILD-3"), "former parent no longer lists CHILD-3 as a child");
  // "adds it nowhere": no other task in the store should have gained
  // CHILD-3 as a child as a side effect of unsetting.
  const all = store.list();
  const anyoneElseHasIt = all.some((t) => t.id !== "RS-PARENT-D" && (t.children || []).includes("RS-CHILD-3"));
  assert(!anyoneElseHasIt, "unsetting parent does not add the child to any other task's children array");
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
  assert(parentE.children.includes("RS-CHILD-4"), "editing an unrelated field (title) leaves the parent's children array untouched");
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
  assert(bothSucceeded, `both concurrent cross-reparent processes completed without hanging/erroring (no deadlock) -- ${JSON.stringify(results.map((r) => r.status))}`);

  // No corruption: every file in the store must still parse.
  let parseError = null;
  let all;
  try {
    all = store.list();
  } catch (err) {
    parseError = err;
  }
  assert(parseError === null, "store.list() still parses every file after the concurrent cross-reparent (no corruption)");

  const childX1 = store.get("RS-CHILD-X1");
  const childY1 = store.get("RS-CHILD-Y1");
  const parentX = store.get("RS-PARENT-X");
  const parentY = store.get("RS-PARENT-Y");

  assert(childX1.parent === "RS-PARENT-Y", "CHILD-X1's own parent field reflects its move to PARENT-Y");
  assert(childY1.parent === "RS-PARENT-X", "CHILD-Y1's own parent field reflects its move to PARENT-X");
  assert(!parentX.children.includes("RS-CHILD-X1"), "PARENT-X no longer lists CHILD-X1 (it moved away)");
  assert(parentX.children.includes("RS-CHILD-Y1"), "PARENT-X now lists CHILD-Y1 (it moved in)");
  assert(!parentY.children.includes("RS-CHILD-Y1"), "PARENT-Y no longer lists CHILD-Y1 (it moved away)");
  assert(parentY.children.includes("RS-CHILD-X1"), "PARENT-Y now lists CHILD-X1 (it moved in)");

  // No leftover lock files after both writers finish.
  for (const id of ["RS-CHILD-X1", "RS-CHILD-Y1", "RS-PARENT-X", "RS-PARENT-Y"]) {
    const lockPath = path.join(tasksDir, `${id}.md.lock`);
    assert(!fs.existsSync(lockPath), `no leftover lock file for ${id} after concurrent writers finish`);
  }
}

testReparentUpdatesBothParents();
testReparentNoDuplicateOnNewParent();
testUnsetParentRemovesWithoutAddingElsewhere();
testUnrelatedWriteDoesNotTriggerSync();
await testConcurrentCrossReparentNoDeadlockNoCorruption();

fs.rmSync(tasksDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
} else {
  console.log("\nAll M35-native-relation-sync tests passed.");
}
