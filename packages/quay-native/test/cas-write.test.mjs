// QN-015: prove store.js's `write({ expectedStatus })` CAS option actually
// closes the read-decide-write TOCTOU race described in QN-015's Proposal —
// a Skill (e.g. quay:execute's gate-check step) that reads a task's status
// via one call (e.g. `task check`), decides what to do, and only LATER
// issues a separate `write()` call to apply that decision, with no
// atomicity spanning the two calls. If another writer changes the task's
// status in between, an unconditional write() would silently clobber that
// change; a CAS write must instead throw ConflictError.
//
// Run: node test/cas-write.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createStore, ConflictError } from "../src/store.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.join(__dirname, ".tmp-cas-test");

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

// --- Case 1: positive — CAS write succeeds when expectedStatus matches ---
function testPositiveCase() {
  const store = resetStore();
  store.write("CAS-1", { title: "t", status: "ready" });
  const t = store.write("CAS-1", { status: "done", expectedStatus: "ready" });
  assert(t.status === "done", "positive case: CAS write succeeds when actual status matches expectedStatus");
}

// --- Case 2: negative — CAS write throws ConflictError, no disk write, when mismatched ---
function testNegativeCase() {
  const store = resetStore();
  store.write("CAS-2", { title: "t", status: "done" });
  let threw = null;
  try {
    store.write("CAS-2", { status: "needs-human", expectedStatus: "ready" });
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof ConflictError, "negative case: mismatched expectedStatus throws a real ConflictError instance (not a generic Error)");
  assert(threw && /expected status "ready"/.test(threw.message), "ConflictError names the expected status");
  assert(threw && /actual current status is "done"/.test(threw.message), "ConflictError names the actual status");
  const after = store.get("CAS-2");
  assert(after.status === "done", "negative case: nothing was written to disk -- status is unchanged, not silently clobbered");
}

// --- Case 3: regression — write() with no expectedStatus behaves exactly as before ---
function testNoExpectedStatusUnaffected() {
  const store = resetStore();
  store.write("CAS-3", { title: "t", status: "ready" });
  const t = store.write("CAS-3", { status: "done" }); // no expectedStatus at all
  assert(t.status === "done", "regression: write() with no expectedStatus is completely unaffected (existing callers keep working)");
}

// --- Case 4: THE GENUINE RACE PROOF ---
// This is the actual TOCTOU scenario QN-015's Proposal describes: a Skill
// reads a task's status via ONE call, decides, and only later applies that
// decision via a SEPARATE write() call -- with arbitrary real wall-clock
// time (and potentially another real process's action) between the two.
//
// Setup: CAS-4 starts at "ready". Two REAL child processes race:
//   - "cas-writer" (writer A) simulates the Skill: it read "ready" a moment
//     ago (asserted by the test itself, matching what a real gate-check step
//     would have observed), and NOW attempts write(status: "done",
//     expectedStatus: "ready") -- but only AFTER a real, independent process
//     (the interloper) has ALREADY changed the on-disk status away from
//     "ready" first. This proves the actual property that matters: a CAS
//     write correctly detects and refuses to apply a decision premised on
//     now-stale state, using REAL inter-process file state (not an in-memory
//     simulation) -- the interloper is a genuinely separate OS process that
//     completes its own real write() before the CAS writer's process runs.
async function testGenuineRace() {
  const store = resetStore();
  store.write("CAS-4", { title: "t", status: "ready" });

  const helper = path.join(__dirname, "cas-writer-helper.mjs");

  // Real, separate process #1: interloper changes CAS-4 away from "ready"
  // and fully completes (real fs write, real process exit) BEFORE the CAS
  // writer process is even spawned -- proving the race is closed for the
  // case that actually matters (a decision made against stale state that
  // has, in real wall-clock time, already changed by the time the write
  // lands), not merely a same-process, same-tick simulation.
  const interloperResult = await execFileAsync("node", [helper, tasksDir, "CAS-4", "interloper"]);
  const interloperOut = JSON.parse(interloperResult.stdout.trim());
  assert(interloperOut.outcome === "success" && interloperOut.status === "needs-human", "interloper (real separate process) genuinely changed CAS-4's on-disk status to needs-human");

  // Real, separate process #2: the CAS writer, still operating on its
  // (by now stale) premise that CAS-4 is "ready" -- exactly the situation a
  // gate-check Skill would be in if its own earlier read happened before the
  // interloper's write.
  let casResult;
  let casExitCode = 0;
  try {
    casResult = await execFileAsync("node", [helper, tasksDir, "CAS-4", "cas-writer"]);
  } catch (err) {
    // execFile rejects on non-zero exit; the helper still prints its JSON
    // line to stdout before exiting non-zero, so read it from the error object.
    casResult = err;
    casExitCode = err.code;
  }
  const casOut = JSON.parse(casResult.stdout.trim());
  assert(casExitCode === 2, `CAS writer process exited with code 2 (ConflictError sentinel), got ${casExitCode}`);
  assert(casOut.outcome === "conflict", "CAS writer (real separate process) genuinely observed a ConflictError, not a silent success");

  const finalTask = store.get("CAS-4");
  assert(finalTask.status === "needs-human", "final on-disk status is still the interloper's needs-human -- the CAS writer's stale-premised write did NOT silently clobber it");
}

// --- Case 5: no existing file + expectedStatus supplied -> conflict, fail closed ---
function testNoExistingFileFailsClosed() {
  const store = resetStore();
  let threw = null;
  try {
    store.write("CAS-5-NEW", { title: "t", status: "ready", expectedStatus: "todo" });
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof ConflictError, "supplying expectedStatus for a not-yet-existing task fails closed (ConflictError), not open");
  assert(!fs.existsSync(path.join(tasksDir, "CAS-5-NEW.md")), "no file was created on disk for the failed-closed case");
}

testPositiveCase();
testNegativeCase();
testNoExpectedStatusUnaffected();
await testGenuineRace();
testNoExistingFileFailsClosed();

fs.rmSync(tasksDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
} else {
  console.log("\nAll QN-015 CAS-write tests passed.");
}
