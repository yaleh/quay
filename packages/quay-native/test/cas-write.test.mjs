// @test-group product
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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createStore, ConflictError } from "../src/store.ts";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// PROCESS-PRIVATE TEMP DIR, never a path inside the checked-in tree
// (plugin/scripts/checked-in-write-check.ts's invariant: 测试不得在已签入路径下创建或删除条目).
// This used to be `<test dir>/.tmp-cas-test` — inside the repo — and the store's status-event
// carrier resolved the REPO's git root from it, so every run appended to the live
// `.quay/task-status-events.jsonl` and left a write entry under `packages/quay-native/test/`.
// Judged (and reported) the moment this file entered a delta; fixed here rather than grandfathered.
let tasksDir = null;

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
  if (tasksDir !== null) fs.rmSync(tasksDir, { recursive: true, force: true });
  tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-native-cas-write-"));
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

// ─── QN-015 sibling: PARK DURABILITY (gap-needs-human-park-overwritten-by-inflight-worker) ────────
// Same family as the CAS cases above (a write whose premise is stale must not clobber state another
// writer set), one step further: the stale writer does not even pass `expectedStatus` — the measured
// incident was a worker's whole-task `task_write` replaying the status it had read before the park.
//
// Read the task from disk the way the worker held it in memory: body + frontmatter snapshot.
function seedParkedTask(store, id) {
  store.write(id, { title: "t", status: "ready", labels: ["gap"], body: "## AC\n- [ ] a\n" });
  // The human/manager park — a status-only CAS write, exactly `task edit <id> --status needs-human
  // --expect-status ready`.
  const parked = store.write(id, { status: "needs-human", expectedStatus: "ready" });
  assert(parked.status === "needs-human", `${id}: the park itself landed`);
}

// AC1 — the measured defect. The in-flight worker writes back the WHOLE task it read earlier
// (body + status "ready"). After the fix the status is PRESERVED; before it, this asserted `ready`
// and the promotion driver promoted it back into the pool within one round.
function testParkSurvivesStaleWholeBodyWrite() {
  const store = resetStore();
  seedParkedTask(store, "PARK-1");
  const t = store.write("PARK-1", { title: "t", status: "ready", labels: ["gap"], body: "## AC\n- [x] a\n" });
  assert(t.status === "needs-human", "AC1: a stale whole-body write (body + pre-park status 'ready') does NOT revert the park — status is needs-human");
  const onDisk = store.get("PARK-1");
  assert(onDisk.status === "needs-human", "AC1: the on-disk status is needs-human after the stale write");
  assert(onDisk.body.includes("- [x] a"), "AC1: the CONTENT half of the stale write still landed (the worker's AC tick is not lost)");
  // The incident's exact status literal, too: the revert commit was needs-human → todo.
  store.write("PARK-2", { title: "t2", status: "ready", labels: [], body: "## AC\n- [ ] b\n" });
  store.write("PARK-2", { status: "needs-human", expectedStatus: "ready" });
  const t2 = store.write("PARK-2", { title: "t2", status: "todo", labels: [], body: "## AC\n- [x] b\n" });
  assert(t2.status === "needs-human", "AC1: the incident's literal shape (status 'todo' + body) does not revert the park either");
}

// AC2 negative control — the human-authorized unpark MUST still work. Status-only = a decision, not
// a stale replay; it is the `quay task edit <id> --status ready` surface.
function testStatusOnlyUnparkStillWorks() {
  const store = resetStore();
  seedParkedTask(store, "PARK-3");
  const t = store.write("PARK-3", { status: "ready" });
  assert(t.status === "ready", "AC2 negative control: a status-only write still unparks (needs-human → ready)");
  assert(store.get("PARK-3").status === "ready", "AC2 negative control: the unpark reached disk");
}

// AC2 negative control (second deliberate exit) — an unpark that also edits content is allowed when
// the caller CAS-asserts the park it is leaving.
function testCasUnparkWithContentStillWorks() {
  const store = resetStore();
  seedParkedTask(store, "PARK-4");
  const t = store.write("PARK-4", { status: "ready", expectedStatus: "needs-human", body: "## AC\n- [x] a\n" });
  assert(t.status === "ready", "AC2 negative control: expectedStatus='needs-human' + content still unparks (explicit CAS decision)");
}

// Negative control for the guard's SCOPE — it must not freeze ordinary status writes. A whole-body
// write on a NON-parked task still changes the status exactly as before.
function testGuardDoesNotFreezeOrdinaryWrites() {
  const store = resetStore();
  store.write("PARK-5", { title: "t", status: "ready", labels: [], body: "## AC\n- [ ] a\n" });
  const t = store.write("PARK-5", { title: "t", status: "done", body: "## AC\n- [x] a\n" });
  assert(t.status === "done", "scope control: a whole-body write on a non-parked task still applies its status (ready → done)");
}

testPositiveCase();
testNegativeCase();
testNoExpectedStatusUnaffected();
await testGenuineRace();
testNoExistingFileFailsClosed();
testParkSurvivesStaleWholeBodyWrite();
testStatusOnlyUnparkStillWorks();
testCasUnparkWithContentStillWorks();
testGuardDoesNotFreezeOrdinaryWrites();

if (tasksDir !== null) fs.rmSync(tasksDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
} else {
  console.log("\nAll QN-015 CAS-write tests passed.");
}
