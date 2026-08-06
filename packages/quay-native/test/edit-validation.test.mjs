// @test-group product
// QN-055 (iteration 44): `quay-native task edit` must reject a
// missing/empty `id` positional argument rather than silently writing
// tasks/undefined.md — the same class of bug `task create` was hardened
// against at QN-025 (iteration 11), but `task edit` was never guarded.
// Discovered incidentally (and disclosed, not hidden) during iteration
// 43's own tool exploration; fixed here with the same guard-clause shape
// as QN-025.
//
// Run: node test/edit-validation.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { QUAY_NATIVE_CLI } from "../../quay/test/helpers/cli-entry.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = QUAY_NATIVE_CLI;
const tasksDir = path.join(__dirname, ".tmp-edit-validation-test");

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

  // Case 1: missing id entirely — must exit non-zero, write NO file
  // (specifically no tasks/undefined.md, the reproduced bug shape).
  {
    let threw = false;
    let stderr = "";
    try {
      await execFileAsync("node", [binPath, "task", "edit", "--title", "oops", "--json"], { env });
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
      await execFileAsync("node", [binPath, "task", "edit", "", "--title", "oops", "--json"], { env });
    } catch (err) {
      threw = true;
    }
    assert(threw, "empty-string id: CLI process exits non-zero");
    const filesAfter = fs.readdirSync(tasksDir);
    assert(filesAfter.length === 0, "empty-string id: no file written");
  }

  // Case 3: happy path — editing an existing, valid-id task still works,
  // unchanged behavior (no regression from the validation added above).
  {
    await execFileAsync("node", [binPath, "task", "create", "SMOKE-002", "--title", "smoke", "--json"], { env });
    await execFileAsync("node", [binPath, "task", "edit", "SMOKE-002", "--title", "smoke-edited", "--json"], { env });
    const out = await execFileAsync("node", [binPath, "task", "get", "SMOKE-002", "--json"], { env });
    const parsed = JSON.parse(out.stdout);
    assert(parsed.title === "smoke-edited", "valid id: task edit still updates the task as before");
  }

  fs.rmSync(tasksDir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  } else {
    console.log("\nAll QN-055 edit-validation tests passed.");
  }
}

run();
