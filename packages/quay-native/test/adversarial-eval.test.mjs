// M26-adversarial-eval (DIR-001 item 4): targeted fault-injection regression
// tests for the highest-risk real gaps this milestone's Phase A audit found
// in quay-native's store.js. Each test asserts SAFE degradation (clear
// error, no crash, no corrupted task-store state) per DIR-001's own framing
// and this charter's Done-when clause 5.
//
// Covers:
//   ADV-004 (highest severity): path-traversal arbitrary-file-write via a
//     malicious task id (`../../../etc/whatever`), fixed by assertSafeId()
//     in store.js's filePathFor()/lockPathFor().
//   Malformed-frontmatter category (DIR-001-named): a single corrupted task
//     file's YAML frontmatter previously had zero direct test coverage of
//     store.js's own parse()/get() error paths (only reachable indirectly
//     via serve.js's own regression test, added separately in
//     packages/quay/test/serve-adversarial-eval.test.mjs).
//
// Run: node test/adversarial-eval.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../src/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.join(__dirname, ".tmp-adversarial-eval-test");
const victimDir = path.join(__dirname, ".tmp-adversarial-eval-victim");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function freshStore() {
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.rmSync(victimDir, { recursive: true, force: true });
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(victimDir, { recursive: true });
  return createStore(tasksDir);
}

// --- ADV-004: path-traversal via write() (task create/edit) ---
function testPathTraversalWriteBlocked() {
  const store = freshStore();
  const relTraversalId = path.relative(tasksDir, path.join(victimDir, "pwned"));
  let threw = null;
  try {
    store.write(relTraversalId, { title: "pwned", status: "todo", body: "x" });
  } catch (err) {
    threw = err;
  }
  assert(threw !== null, "write() with a '../'-traversal id throws rather than writing outside tasksDir");
  assert(
    threw && /path-traversal guard|path separator/.test(threw.message),
    `write() traversal-id error names the path-traversal guard (got: ${threw && threw.message})`
  );
  assert(
    !fs.existsSync(path.join(victimDir, "pwned.md")),
    "no file was written outside tasksDir (victim dir stays empty)"
  );
  assert(
    fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md")).length === 0,
    "no file was written inside tasksDir either (the malicious id was fully rejected, not partially applied)"
  );
}

// --- ADV-004: path-traversal via get()/readRaw() (read path, not just write) ---
function testPathTraversalReadBlocked() {
  const store = freshStore();
  // Plant a real file outside tasksDir to confirm the guard blocks the READ
  // path too, not just write -- a read-side traversal could otherwise leak
  // arbitrary filesystem content back through task_get/task_list.
  fs.writeFileSync(path.join(victimDir, "secret.md"), "---\nid: secret\ntitle: leaked\nstatus: todo\n---\ntop secret\n");
  const relTraversalId = path.relative(tasksDir, path.join(victimDir, "secret"));
  let threw = null;
  try {
    store.get(relTraversalId);
  } catch (err) {
    threw = err;
  }
  assert(threw !== null, "get() with a '../'-traversal id throws rather than reading outside tasksDir");
}

// --- ADV-004: absolute-path id also blocked (not just relative '../') ---
function testAbsolutePathIdBlocked() {
  const store = freshStore();
  let threw = null;
  try {
    store.write("/etc/passwd-quay-test", { title: "x", status: "todo", body: "x" });
  } catch (err) {
    threw = err;
  }
  assert(threw !== null, "write() with an absolute-path-shaped id throws (path separator guard)");
}

// --- ADV-004: normal ids are completely unaffected (no false-positive regression) ---
function testNormalIdsStillWork() {
  const store = freshStore();
  const t = store.write("GOOD-1", { title: "Fine", status: "todo", body: "ok" });
  assert(t.id === "GOOD-1" && t.status === "todo", "write() with a normal id still succeeds as before");
  const read = store.get("GOOD-1");
  assert(read && read.title === "Fine", "get() with a normal id still reads back correctly");
  assert(
    fs.existsSync(path.join(tasksDir, "GOOD-1.md")),
    "the file was written in the correct location (inside tasksDir)"
  );
}

// --- Malformed frontmatter: a single corrupted task file's get()/parse()
// error is a real, nameable failure -- not silently swallowed into a wrong
// result, and importantly does NOT corrupt neighboring good task files.
function testMalformedFrontmatterInIsolationThrowsCleanly() {
  const store = freshStore();
  store.write("GOOD-1", { title: "Good", status: "todo", body: "ok" });
  // Directly plant a malformed file (bypassing write()'s own validation, the
  // same way a hand-edited or externally-corrupted file would arise).
  fs.writeFileSync(path.join(tasksDir, "BAD-1.md"), "---\nid: BAD-1\n  bad: [unterminated\n---\nbody\n");

  let threw = null;
  try {
    store.get("BAD-1");
  } catch (err) {
    threw = err;
  }
  assert(threw !== null, "get() on a task file with malformed YAML frontmatter throws (not silently wrong data)");

  // The neighboring good file must remain fully readable -- one corrupted
  // file must not corrupt or block access to any other task's own data.
  const good = store.get("GOOD-1");
  assert(good && good.title === "Good", "a malformed neighbor file does not affect get() of a good task file");
}

// --- Malformed frontmatter: list() with one bad file among many good ones.
// This is the store.list()-level manifestation of the same finding: prior
// to this milestone, list() had no isolation at all -- ONE malformed file
// made list() throw for ALL tasks (confirmed during Phase A audit). This
// test documents that CURRENT behavior explicitly (list() still throws
// today; the isolation fix that would make list() skip just the bad file
// and return the rest was assessed as OUT of this milestone's minimal-fix
// scope -- see audit-report.md ADV-005 for the explicit disposition:
// serve.js's own crash was the actually-reachable, user-facing failure mode
// (fixed, ADV-002), and store.list()'s all-or-nothing behavior, while worth
// noting, does not itself crash the process or corrupt state -- it throws a
// clear error, which is safe degradation by DIR-001's own bar, just a
// coarser granularity than ideal).
function testListThrowsOnOneMalformedFileAmongGoodOnes() {
  const store = freshStore();
  store.write("GOOD-1", { title: "Good one", status: "todo", body: "ok" });
  store.write("GOOD-2", { title: "Good two", status: "todo", body: "ok" });
  fs.writeFileSync(path.join(tasksDir, "BAD-1.md"), "---\nid: BAD-1\n  bad: [unterminated\n---\nbody\n");

  let threw = null;
  try {
    store.list();
  } catch (err) {
    threw = err;
  }
  assert(
    threw !== null,
    "list() with one malformed file among good ones throws a clear error (documented current behavior, ADV-005)"
  );
  assert(
    threw && /Nested mappings|YAMLParseError|malformed/i.test(threw.message || threw.name || String(threw)),
    "the thrown error is a real, nameable YAML-parse error, not a generic/opaque failure"
  );

  // Confirm no corruption: removing the bad file lets list() succeed again
  // immediately, with both good tasks intact (safe degradation, self-heals).
  fs.rmSync(path.join(tasksDir, "BAD-1.md"));
  const tasks = store.list();
  assert(
    tasks.length === 2 && tasks.some((t) => t.id === "GOOD-1") && tasks.some((t) => t.id === "GOOD-2"),
    "after removing the bad file, list() succeeds and both good tasks are intact (no corruption occurred)"
  );
}

testPathTraversalWriteBlocked();
testPathTraversalReadBlocked();
testAbsolutePathIdBlocked();
testNormalIdsStillWork();
testMalformedFrontmatterInIsolationThrowsCleanly();
testListThrowsOnOneMalformedFileAmongGoodOnes();

fs.rmSync(tasksDir, { recursive: true, force: true });
fs.rmSync(victimDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
} else {
  console.log("\nAll M26-adversarial-eval quay-native store.js fault-injection tests passed.");
}
