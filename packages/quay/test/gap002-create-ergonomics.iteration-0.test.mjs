// @test-group product
// M29-cli-create-ergonomics (iteration-0): GAP-002 + GAP-001 combined
// RED->GREEN coverage, plus G-02 --help-text coverage.
//
// GAP-002 (data-integrity bug): `quay task edit <new-id> --status todo`
// (no --title) against a fresh native-provider store, over the Core CLI
// (packages/quay/bin/quay.js), previously silently upserted a titleless
// task record (store.js#write()'s title-omission-on-create path, traced in
// the charter's "Current-state notes"). This file reproduces GAP-002's
// EXACT mechanism (task edit on a brand-new id, --status only, no --title)
// against a throwaway scratch native-provider store (NEVER the real
// tasks/ at repo root), confirms it (pre-fix) either omits the title key
// or serializes it as literal "undefined", then (post-fix) confirms the
// Core CLI now refuses with a clear usage error instead.
//
// GAP-001 (structural gap): no dedicated `quay task create` verb existed at
// the Core CLI layer. This file also covers the new `task create <id>
// --title <title> [...]` verb's --title-mandatory enforcement (hard usage
// error, no provider call, if --title missing/empty).
//
// G-02: covers the corrected --help text listing task edit's full flag
// surface and the new task create verb.
//
// Run: node packages/quay/test/gap002-create-ergonomics.test.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// Every scratch workspace pair is removed when the run ends (the carrier-array + after() pattern —
// node:test's after() runs even in this hand-rolled harness once the module ends naturally; the
// explicit cleanupTmp() below covers the process.exit(1) failure path, which bypasses hooks) — a
// mkdtemp fixture without cleanup leaks a /tmp dir per run.
import { after } from "node:test";
const _tmpDirs = [];
function cleanupTmp() {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  _tmpDirs.length = 0;
}
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  _tmpDirs.length = 0;
});

function run(args, opts) {
  try {
    const out = execFileSync("node", [quayBin, ...args], { encoding: "utf8", ...opts });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err),
    };
  }
}

function makeScratchWorkspace(prefix) {
  // Mirrors create-validation.test.mjs's / cli-edit-parity-conformance.test.mjs's
  // own scratch-fixture convention: a throwaway /tmp/... native-provider
  // store, never the real tasks/ at repo root.
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-tasks-`));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-ws-`));
  _tmpDirs.push(tasksDir);
  _tmpDirs.push(workspaceRoot);
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      "      QUAY_NATIVE_TASKS_DIR: \"./tasks-env-relative\"",
      "",
    ].join("\n")
  );
  const envTasksDir = path.join(workspaceRoot, "tasks-env-relative");
  fs.mkdirSync(envTasksDir, { recursive: true });
  return { workspaceRoot, envTasksDir, tasksDir };
}

async function main() {
  // ===================================================================
  // GAP-002 exact shape: `task edit <new-id> --status todo` (no --title)
  // on a currently-non-existent id, against a scratch native-provider
  // store, via the Core CLI (quay.js), not quay-native's own binary.
  // ===================================================================
  {
    const { workspaceRoot, envTasksDir } = makeScratchWorkspace("quay-gap002-edit");
    const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

    const editResult = run(["task", "edit", "GAP002-NEW-1", "--status", "todo", "--json"], spawnOpts);

    // Post-fix expected behavior: hard refusal, non-zero exit, no file
    // written for the titleless-create path. (Pre-fix: this assertion is
    // the RED — it FAILS because the pre-fix code exits 0 and silently
    // upserts a titleless record instead of refusing.)
    assert(editResult.status !== 0,
      `task edit <new-id> --status todo (no --title): CLI exits non-zero (got status=${editResult.status})`);
    assert(/does not exist|--title|task create/i.test(editResult.stderr),
      `task edit <new-id> --status todo (no --title): stderr gives a clear usage-error hint (got: ${JSON.stringify(editResult.stderr)})`);

    const filesAfter = fs.readdirSync(envTasksDir);
    assert(filesAfter.length === 0,
      `task edit <new-id> --status todo (no --title): no file written (found: ${JSON.stringify(filesAfter)})`);
    assert(!filesAfter.some((f) => f.includes("GAP002-NEW-1")),
      "task edit <new-id> --status todo (no --title): specifically no GAP002-NEW-1 task file created");
  }

  // ===================================================================
  // Sibling variant: --body-only (not --status-only) on a non-existent id,
  // no --title — iteration-1 skepticism-instruction shape, included here
  // too so iteration-0's own fix is checked against more than the single
  // M27-reproduction flag combination.
  // ===================================================================
  {
    const { workspaceRoot, envTasksDir } = makeScratchWorkspace("quay-gap002-edit-body");
    const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

    const editResult = run(["task", "edit", "GAP002-NEW-2", "--body", "some body text", "--json"], spawnOpts);

    assert(editResult.status !== 0,
      `task edit <new-id> --body "..." (no --title): CLI exits non-zero (got status=${editResult.status})`);
    const filesAfter = fs.readdirSync(envTasksDir);
    assert(filesAfter.length === 0,
      `task edit <new-id> --body "..." (no --title): no file written (found: ${JSON.stringify(filesAfter)})`);
  }

  // ===================================================================
  // Existing-id edit path is NOT affected: editing a task that already
  // exists, with no --title supplied, must continue to work exactly as
  // before (this is the normal/majority `task edit` use case — regression
  // guard for the new existence-check guard).
  // ===================================================================
  {
    const { workspaceRoot, envTasksDir, tasksDir } = makeScratchWorkspace("quay-gap002-edit-existing");
    const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };
    // Seed an existing task directly via quay-native (out-of-band, not
    // exercising the Core CLI fix path under test here).
    execFileSync("node", [nativeBin, "task", "create", "GAP002-EXIST-1", "--title", "pre-existing title", "--json"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: envTasksDir },
    });

    const editResult = run(["task", "edit", "GAP002-EXIST-1", "--status", "todo", "--json"], spawnOpts);
    assert(editResult.status === 0,
      `task edit <existing-id> --status todo (no --title): still succeeds (got status=${editResult.status}, stderr=${editResult.stderr})`);
    if (editResult.status === 0) {
      const t = JSON.parse(editResult.stdout);
      assert(t.title === "pre-existing title",
        `task edit <existing-id> --status todo (no --title): title unchanged (got ${JSON.stringify(t.title)})`);
      assert(t.status === "todo",
        `task edit <existing-id> --status todo (no --title): status patch applied (got ${JSON.stringify(t.status)})`);
    }
  }

  // ===================================================================
  // GAP-001: new `task create` verb, --title mandatory, hard usage error
  // (no provider call, no file written) if missing/empty.
  // ===================================================================
  {
    const { workspaceRoot, envTasksDir } = makeScratchWorkspace("quay-gap001-create-missing-title");
    const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

    const r = run(["task", "create", "GAP001-NEW-1", "--json"], spawnOpts);
    assert(r.status !== 0,
      `task create <id> (no --title): CLI exits non-zero (got status=${r.status})`);
    assert(/--title/.test(r.stderr),
      `task create <id> (no --title): stderr mentions --title (got: ${JSON.stringify(r.stderr)})`);
    const filesAfter = fs.readdirSync(envTasksDir);
    assert(filesAfter.length === 0,
      `task create <id> (no --title): no file written (found: ${JSON.stringify(filesAfter)})`);
  }

  {
    const { workspaceRoot, envTasksDir } = makeScratchWorkspace("quay-gap001-create-empty-title");
    const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

    const r = run(["task", "create", "GAP001-NEW-2", "--title", "", "--json"], spawnOpts);
    assert(r.status !== 0,
      `task create <id> --title "" (empty): CLI exits non-zero (got status=${r.status})`);
    const filesAfter = fs.readdirSync(envTasksDir);
    assert(filesAfter.length === 0,
      `task create <id> --title "" (empty): no file written (found: ${JSON.stringify(filesAfter)})`);
  }

  {
    const { workspaceRoot, envTasksDir } = makeScratchWorkspace("quay-gap001-create-happy");
    const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

    const r = run(["task", "create", "GAP001-NEW-3", "--title", "a real title", "--status", "todo",
      "--labels", "a,b", "--json"], spawnOpts);
    assert(r.status === 0,
      `task create <id> --title "..." : succeeds (got status=${r.status}, stderr=${r.stderr})`);
    if (r.status === 0) {
      const t = JSON.parse(r.stdout);
      assert(t.title === "a real title", `task create: title round-trips (got ${JSON.stringify(t.title)})`);
      assert(t.status === "todo", `task create: status round-trips (got ${JSON.stringify(t.status)})`);
      assert(Array.isArray(t.labels) && t.labels.includes("a") && t.labels.includes("b"),
        `task create: labels round-trip (got ${JSON.stringify(t.labels)})`);
    }
    const filesAfter = fs.readdirSync(envTasksDir);
    assert(filesAfter.some((f) => f.includes("GAP001-NEW-3")),
      `task create <id> --title "...": file is written (found: ${JSON.stringify(filesAfter)})`);
  }

  {
    // task create with a --parent flag (part of item 1's declared verb surface).
    const { workspaceRoot, envTasksDir } = makeScratchWorkspace("quay-gap001-create-parent");
    const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };
    execFileSync("node", [nativeBin, "task", "create", "GAP001-PARENT", "--title", "parent task", "--json"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: envTasksDir },
    });
    const r = run(["task", "create", "GAP001-CHILD", "--title", "child task", "--parent", "GAP001-PARENT", "--json"], spawnOpts);
    assert(r.status === 0, `task create <id> --title ... --parent ...: succeeds (got status=${r.status}, stderr=${r.stderr})`);
    if (r.status === 0) {
      const t = JSON.parse(r.stdout);
      assert(t.parent === "GAP001-PARENT", `task create: parent round-trips (got ${JSON.stringify(t.parent)})`);
    }
  }

  // ===================================================================
  // G-02: --help text lists task edit's full flag surface and the new
  // task create verb.
  // ===================================================================
  {
    const r = run(["--help"], {});
    const helpText = r.stdout;
    const requiredFlagTokens = [
      "--title", "--body", "--body-file", "--labels", "--extra",
      "--parent", "--children", "--expect-status", "--append-notes",
    ];
    for (const tok of requiredFlagTokens) {
      assert(helpText.includes(tok), `--help text mentions ${tok} (task edit flag surface)`);
    }
    assert(/task create/.test(helpText), "--help text documents the new `task create` verb");
  }

  cleanupTmp();
  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  } else {
    console.log("\nAll GAP-002/GAP-001/G-02 tests passed.");
  }
}

main();
