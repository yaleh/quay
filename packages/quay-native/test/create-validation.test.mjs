// @test-group product
// QN-025 (iteration 11): `quay-native task create` must reject a
// missing/empty `id` positional argument rather than silently writing
// tasks/undefined.md (the bug iteration 10 found and flagged, not fixed).
//
// Run: node test/create-validation.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { QUAY_NATIVE_CLI } from "../../quay/test/helpers/cli-entry.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = QUAY_NATIVE_CLI;
const tasksDir = path.join(__dirname, ".tmp-create-validation-test");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

async function run() {
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.mkdirSync(tasksDir, { recursive: true });
  const env = { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir };

  // Case 1: missing id entirely — must exit non-zero, write NO file.
  {
    let threw = false;
    let stderr = "";
    try {
      await execFileAsync("node", [binPath, "task", "create", "--json"], { env });
    } catch (err) {
      threw = true;
      stderr = err.stderr || "";
    }
    assert(threw, "missing id: CLI process exits non-zero");
    assert(/missing required <id>/.test(stderr), "missing id: stderr names the missing <id> argument");
    const filesAfter = fs.readdirSync(tasksDir);
    assert(filesAfter.length === 0, `missing id: no file written (found: ${JSON.stringify(filesAfter)})`);
    assert(!filesAfter.includes("undefined.md"), "missing id: specifically no tasks/undefined.md is created");
  }

  // Case 2: empty-string id — same rejection, same no-file guarantee.
  {
    let threw = false;
    try {
      await execFileAsync("node", [binPath, "task", "create", "", "--json"], { env });
    } catch (err) {
      threw = true;
    }
    assert(threw, "empty-string id: CLI process exits non-zero");
    const filesAfter = fs.readdirSync(tasksDir);
    assert(filesAfter.length === 0, "empty-string id: no file written");
  }

  // Case 3: happy path — a valid id still creates the task file, unchanged
  // behavior (no regression from the validation added above).
  {
    await execFileAsync("node", [binPath, "task", "create", "SMOKE-001", "--title", "smoke", "--json"], { env });
    const filesAfter = fs.readdirSync(tasksDir);
    assert(filesAfter.includes("SMOKE-001.md"), "valid id: task file is created as before");
  }

  fs.rmSync(tasksDir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  } else {
    console.log("\nAll QN-025 create-validation tests passed.");
  }
}

run();
