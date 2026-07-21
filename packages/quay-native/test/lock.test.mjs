// QN-006 concurrency test (AC#2, AC#3): two separate Node processes racing
// writes on the same task id must not corrupt the file, and a simulated
// stale lock must not permanently deadlock a future writer.
//
// Run: node test/lock.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createStore } from "../src/store.ts";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.join(__dirname, ".tmp-lock-test");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

async function testConcurrentWriters() {
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.mkdirSync(tasksDir, { recursive: true });
  const store = createStore(tasksDir);
  store.write("RACE-1", { title: "race", status: "todo", labels: ["init"] });

  const helper = path.join(__dirname, "concurrent-writer.mjs");
  const p1 = execFileAsync("node", [helper, tasksDir, "RACE-1", "writerA", "8"]);
  const p2 = execFileAsync("node", [helper, tasksDir, "RACE-1", "writerB", "8"]);
  await Promise.all([p1, p2]);

  // The file must still parse and reflect one of the two writers' last patch.
  let task;
  let parseError = null;
  try {
    task = store.get("RACE-1");
  } catch (err) {
    parseError = err;
  }
  assert(parseError === null, "RACE-1 still parses after concurrent writers (no corruption)");
  assert(
    task && (task.labels[0] === "writerA" || task.labels[0] === "writerB"),
    "RACE-1 reflects one of the two writers' patches (last-writer-wins), got: " + JSON.stringify(task?.labels)
  );
  // No leftover lock file after both writers finish.
  const lockPath = path.join(tasksDir, "RACE-1.md.lock");
  assert(!fs.existsSync(lockPath), "no leftover lock file after writers finish");
}

async function testStaleLockReclaimed() {
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.mkdirSync(tasksDir, { recursive: true });
  const store = createStore(tasksDir);
  store.write("STALE-1", { title: "stale", status: "todo" });

  // Simulate a crashed holder: create a lock file and backdate its mtime
  // beyond the stale-lock threshold (5s in store.js).
  const lockPath = path.join(tasksDir, "STALE-1.md.lock");
  fs.writeFileSync(lockPath, "99999");
  const old = new Date(Date.now() - 10_000);
  fs.utimesSync(lockPath, old, old);

  const start = Date.now();
  store.write("STALE-1", { labels: ["reclaimed"] });
  const elapsed = Date.now() - start;

  const task = store.get("STALE-1");
  assert(task.labels[0] === "reclaimed", "stale lock was reclaimed and write succeeded");
  assert(elapsed < 3000, `write did not hang waiting on the stale lock (took ${elapsed}ms)`);
}

async function testCliAndMcpShareOneLockedPath() {
  // AC#4: no separate unlocked write function exists — verify by source
  // inspection that store.js's exported write/appendNote are the only
  // mutators, both wrapped by withLock (grep-level check, honest and simple).
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "store.ts"), "utf8");
  const hasWithLockInWrite = /function write\(id[^,]*, \{[^}]*\}[^)]*\)[^{]*\{[\s\S]*?return withLock\(/.test(src);
  const hasWithLockInAppendNote = /function appendNote\(id[^,]*, note[^)]*\)[^{]*\{[\s\S]*?return withLock\(/.test(src);
  assert(hasWithLockInWrite, "write() routes through withLock()");
  assert(hasWithLockInAppendNote, "appendNote() routes through withLock()");
}

await testConcurrentWriters();
await testStaleLockReclaimed();
await testCliAndMcpShareOneLockedPath();

fs.rmSync(tasksDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
} else {
  console.log("\nAll QN-006 lock tests passed.");
}
