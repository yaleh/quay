// @test-group product
// QN-025 (iteration 11): `quay-native task create` must reject a
// missing/empty `id` positional argument rather than silently writing
// tasks/undefined.md (the bug iteration 10 found and flagged, not fixed).
//
// gap-quay-native-task-create-duplicate-id-prepends-frontmatter: the same verb
// must also reject an id that ALREADY EXISTS. Before that fix, `task create`
// on a taken id fell through to write()'s ordinary read-modify-write: exit 0,
// no stderr, and the existing task silently re-statused to whatever `--status`
// said (a settled `done` became `todo`) — and on the native CLI path, with a
// body supplied, the original document survived only as duplicated text below
// a second `---` block. Both front doors are covered below: the native CLI
// (cases 3-5) and Core's `quay task create`, which reaches the store through
// the Provider ABI instead of in-process (cases 6-7).
//
// Run: node test/create-validation.test.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "../../quay/test/helpers/cli-entry.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = QUAY_NATIVE_CLI;
const nativePkgDir = path.resolve(__dirname, "..");
// Fixtures live in a process-private temp dir, NOT under the checked-in tree
// (checked-in-write-check judges the resolved path — hard rule 2 — and a test
// that creates/deletes entries inside the repo races every concurrent
// whole-tree copier; gap-fixture-dir-write-races-whole-tree-copy).
// This file's fixtures previously sat at <here>/.tmp-create-validation-test,
// i.e. inside the repo. That was a REAL violation that stayed invisible only
// because the judge runs `--changed` and this file was never in a delta until
// now: "no check ran" and "the check passed" are not the same reading.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-create-validation-"));
const tasksDir = path.join(tmpRoot, "tasks");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

/** md5 of a file's bytes — the AC1 assertion is byte-identity, so hash bytes. */
function md5(file) {
  return createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

/** A complete task file: frontmatter WITH a body, so a "did this write preserve
 *  the file?" check is about the whole document, not just the frontmatter. */
function taskFileText(id, status) {
  return `---
id: ${id}
title: An already-settled task
status: ${status}
labels:
  - gap
parent: null
children: []
---

## Proposal

Body text of the existing task.
`;
}

/** A real workspace for the Core CLI: `.quay/config.yml` is REQUIRED — a bare
 *  tasks dir is not a valid workspace (the config is a provider map, not a
 *  flat path), so `quay task create` cannot be driven without one. */
function makeCoreWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "quay-dup-id-"));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n` +
      `  native:\n` +
      `    enabled: true\n` +
      `    path: ${JSON.stringify(nativePkgDir)}\n` +
      `    tasks_dir: "./tasks"\n` +
      `    mcp_entry: ["node", ${JSON.stringify(binPath)}, "mcp"]\n` +
      `    env:\n` +
      `      QUAY_NATIVE_TASKS_DIR: "./tasks"\n` +
      `      QUAY_NATIVE_ADR_DIR: "./adr"\n`,
    "utf8"
  );
  return ws;
}

async function run() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
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

  // Case 4: re-creating an EXISTING id must fail closed. Asserted on the file's
  // md5, not just the exit code — a guard that wrote first and rolled back
  // would satisfy an exit-code check while still having disturbed the file.
  {
    const target = path.join(tasksDir, "SMOKE-001.md");
    // Give the file a body + a settled status, so a clobber is visible in bytes.
    fs.writeFileSync(target, taskFileText("SMOKE-001", "done"), "utf8");
    const before = md5(target);
    let threw = false;
    let stderr = "";
    try {
      await execFileAsync(
        "node",
        [binPath, "task", "create", "SMOKE-001", "--title", "clobbered", "--status", "todo", "--json"],
        { env }
      );
    } catch (err) {
      threw = true;
      stderr = err.stderr || "";
    }
    assert(threw, "existing id: CLI process exits non-zero");
    assert(
      /already exists/.test(stderr) && stderr.includes("SMOKE-001"),
      "existing id: stderr says it already exists and names the id"
    );
    assert(md5(target) === before, "existing id: file is byte-identical (md5 unchanged)");
    assert(
      !/clobbered/.test(fs.readFileSync(target, "utf8")),
      "existing id: the caller's --title did not reach the file"
    );
  }

  // Case 5: the positive path is still live — a genuinely NEW id creates, and
  // the created task reads back through the store.
  {
    const target = path.join(tasksDir, "SMOKE-002.md");
    assert(!fs.existsSync(target), "new id: precondition — file does not exist yet");
    await execFileAsync(
      "node",
      [binPath, "task", "create", "SMOKE-002", "--title", "second smoke", "--json"],
      { env }
    );
    assert(fs.existsSync(target), "new id: task file is created");
    const { stdout } = await execFileAsync("node", [binPath, "task", "get", "SMOKE-002", "--json"], { env });
    assert(JSON.parse(stdout).title === "second smoke", "new id: task reads back as created");
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  // Cases 6-7: the SAME duplicate-id guarantee through Core's front door
  // (`quay task create`), which reaches the task store over the Provider ABI
  // (spawned MCP server) rather than in-process — a separate code path with
  // its own guard, so it needs its own check. Leaving this out would be the
  // "looks covered" failure mode: the native CLI green proves nothing about it.
  {
    const ws = makeCoreWorkspace();
    try {
      const existing = path.join(ws, "tasks", "CORE-EXIST-001.md");
      fs.writeFileSync(existing, taskFileText("CORE-EXIST-001", "done"), "utf8");
      const runCore = (args) => execFileAsync("node", [QUAY_CLI, ...args], { env: process.env, cwd: ws });

      const before = md5(existing);
      let threw = false;
      let stderr = "";
      try {
        await runCore(["task", "create", "CORE-EXIST-001", "--title", "clobbered", "--status", "todo"]);
      } catch (err) {
        threw = true;
        stderr = err.stderr || "";
      }
      assert(threw, "core CLI / existing id: exits non-zero");
      assert(
        /already exists/.test(stderr) && stderr.includes("CORE-EXIST-001"),
        "core CLI / existing id: stderr says it already exists and names the id"
      );
      assert(md5(existing) === before, "core CLI / existing id: file is byte-identical (md5 unchanged)");

      await runCore(["task", "create", "CORE-NEW-001", "--title", "core new"]);
      assert(
        fs.existsSync(path.join(ws, "tasks", "CORE-NEW-001.md")),
        "core CLI / new id: task file is created"
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    // R4 of the test-isolation contract: process.exitCode, never process.exit(1) —
    // exit() can drop async stderr writes under a POSIX pipe, which is how
    // relation-sync's suite-red went silent. The process still exits non-zero.
    process.exitCode = 1;
  } else {
    console.log("\nAll create-validation tests passed (QN-025 + duplicate-id fail-closed, both front doors).");
  }
}

run();
