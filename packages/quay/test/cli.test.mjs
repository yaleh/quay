// QN-033 (iteration 23): regression test for `bin/quay.js` itself — the Core
// CLI's own dispatch layer (parseFlags(), the `cmd`/`sub` branch table,
// resolveProviderEnv(), withProvider(), and the top-level `main().catch(...)`
// handler). Prior to this task, `bin/quay.js` had ZERO automated test
// coverage anywhere in the repo: grepping every `*.test.mjs` file under
// packages/quay-native/test/, packages/quay/test/, and packages/quay-github/
// test/ for any reference to bin/quay.js or a spawn of it returned zero
// hits. Its sibling, packages/quay-native/bin/quay-native.js, IS exercised
// extensively via execFileSync/execFileAsync subprocess spawns (abi-
// symmetry.mjs, create-validation.test.mjs, serve.test.mjs,
// task-check.test.mjs) — but every one of those tests that touches Core's
// own logic imports Core's src/*.js modules directly (startServer,
// composePayload, connectProvider) and never spawns bin/quay.js itself as a
// child process. So the CLI dispatch layer itself was entirely untested.
//
// This test closes that gap by spawning the real `bin/quay.js` binary (not
// its src/*.js internals) against a fully isolated temporary workspace with
// its own real .quay/config.yml + tasks dir, mirroring serve.test.mjs's own
// isolation pattern (QN-031) adapted for Core's own CLI entrypoint instead
// of its HTTP server.
//
// resolveProviderEnv()'s `./`-relative-path resolution is exercised
// implicitly, not directly unit-tested: the fixture .quay/config.yml below
// uses a `./`-relative QUAY_NATIVE_TASKS_DIR value (resolved against
// workspaceRoot), matching the real repo's own .quay/config.yml shape. If
// resolveProviderEnv() resolved this wrong, the spawned `quay-native mcp`
// child process would read from the wrong/empty directory and `task list`
// would return 0 tasks instead of the seeded ones — so a correct non-empty
// `task list` result is itself live proof this function works, not an
// assumption.
//
// Out of scope, named honestly (not silently claimed as covered):
// - resolveProviderEnv()'s absolute-path passthrough branch (values that do
//   NOT start with "./" or "../") — the native Provider fixture used here
//   has no such env value.
// - `quay serve`'s own CLI branch (the `cmd === "serve"` branch and its
//   `process.argv.slice(3)` re-parse quirk) — serve.js's own HTTP behavior
//   is already covered by QN-031's serve.test.mjs, but that test imports
//   startServer directly and never spawns bin/quay.js serve itself. This
//   remains a small, separately-named residual gap.
//
// Run: node test/cli.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreBin = path.join(__dirname, "..", "bin", "quay.js");
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.js");
const nativeProviderDir = path.dirname(nativeBin);

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";
const AC_DOD_CHECKED =
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";
const AC_DOD_UNCHECKED =
  "## AC\n- [ ] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [ ] a sufficiently long definition-of-done line for the minimum-content check\n";

function run(args, opts = {}) {
  try {
    const out = execFileSync("node", [coreBin, ...args], {
      encoding: "utf8",
      ...opts,
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err),
    };
  }
}

async function main() {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-test-tasks-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-test-workspace-"));

  // Real .quay/config.yml, same shape as the repo's own (relative
  // QUAY_NATIVE_TASKS_DIR path, resolved by resolveProviderEnv() against
  // workspaceRoot) — this is the fixture that makes the "task list returns
  // the real seeded tasks" assertion below double as live proof
  // resolveProviderEnv()'s ./-relative resolution branch works correctly.
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
  // Also create the ./tasks-env-relative dir the env value points at, and
  // seed it — this is the directory resolveProviderEnv() must resolve to
  // (workspaceRoot/tasks-env-relative), NOT the top-level `tasksDir` mkdtemp
  // (which is only used for `path`'s own tasks_dir field, unrelated to the
  // env override). This makes the two paths genuinely distinguishable so a
  // wrong resolution is actually detectable, not accidentally masked.
  const envTasksDir = path.join(workspaceRoot, "tasks-env-relative");
  fs.mkdirSync(envTasksDir, { recursive: true });

  execFileSync("node", [nativeBin, "task", "create", "CLI-1", "--title", "CLI test task one",
    "--status", "todo", "--body", VALID_SECTIONS + AC_DOD_CHECKED], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: envTasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "CLI-2", "--title", "CLI test task two (fails gate)",
    "--status", "todo", "--body", VALID_SECTIONS + AC_DOD_UNCHECKED], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: envTasksDir },
  });

  const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

  // 1. `quay task list --json` — confirms both the JSON shape AND
  //    (implicitly) that resolveProviderEnv()'s ./-relative resolution
  //    correctly pointed the spawned quay-native mcp child at
  //    envTasksDir, not an empty/wrong directory.
  {
    const r = run(["task", "list", "--json"], spawnOpts);
    assert(r.status === 0, "quay task list --json exits 0");
    let tasks;
    try {
      tasks = JSON.parse(r.stdout);
    } catch {
      tasks = null;
    }
    assert(Array.isArray(tasks), "quay task list --json emits a JSON array");
    assert(
      Array.isArray(tasks) && tasks.some((t) => t.id === "CLI-1") && tasks.some((t) => t.id === "CLI-2"),
      "quay task list --json includes both seeded tasks (proves resolveProviderEnv()'s relative-path resolution reached the right directory)"
    );
  }

  // 1b. Non-JSON fallback format (tab-separated id/status/role/title).
  {
    const r = run(["task", "list"], spawnOpts);
    assert(r.status === 0, "quay task list (no --json) exits 0");
    assert(r.stdout.includes("CLI-1") && r.stdout.includes("\t"), "quay task list (no --json) emits tab-separated lines");
  }

  // 2. `quay task view <id> --json` — happy path.
  {
    const r = run(["task", "view", "CLI-1", "--json"], spawnOpts);
    assert(r.status === 0, "quay task view CLI-1 --json exits 0");
    const t = JSON.parse(r.stdout);
    assert(t.id === "CLI-1" && t.title === "CLI test task one", "quay task view --json returns the correct task");
  }

  // 2b. "no such task" error path.
  {
    const r = run(["task", "view", "NOPE-999", "--json"], spawnOpts);
    assert(r.status === 1, "quay task view <unknown id> exits 1");
    assert(r.stderr.includes("no such task"), "quay task view <unknown id> prints 'no such task' to stderr");
  }

  // 3. `quay task edit <id> --status ready --json` — happy path.
  {
    const r = run(["task", "edit", "CLI-1", "--status", "ready", "--json"], spawnOpts);
    assert(r.status === 0, "quay task edit --status ready --json exits 0");
    const t = JSON.parse(r.stdout);
    assert(t.status === "ready", "quay task edit --status ready actually persists the new status");
  }

  // 3b. Missing required --status error path.
  {
    const r = run(["task", "edit", "CLI-1", "--json"], spawnOpts);
    assert(r.status === 1, "quay task edit without --status exits 1");
    assert(
      r.stderr.includes("--status") && r.stderr.includes("required"),
      "quay task edit without --status prints the required-flag error"
    );
  }

  // 4. `quay task check <id> --json` — exit code mirrors result.ok, both
  //    directions. This is main()'s own `process.exitCode = result.ok ? 0 : 1`
  //    line — distinct from task-check.test.mjs, which calls
  //    provider-client.js's taskCheck() directly and never exercises this
  //    CLI-level exit-code-setting branch.
  {
    const rOk = run(["task", "check", "CLI-1", "--json"], spawnOpts);
    assert(rOk.status === 0, "quay task check <passing task> --json exits 0");
    const ok = JSON.parse(rOk.stdout);
    assert(ok.ok === true, "quay task check <passing task> reports ok:true");

    const rFail = run(["task", "check", "CLI-2", "--json"], spawnOpts);
    assert(rFail.status === 1, "quay task check <failing task> --json exits 1 (mirrors result.ok)");
    const fail = JSON.parse(rFail.stdout);
    assert(fail.ok === false, "quay task check <failing task> reports ok:false");
  }

  // 5. `quay action list <id> --json` — action_buttons filtered by
  //    whenStatus against the task's live status.
  {
    const r = run(["action", "list", "CLI-1", "--json"], spawnOpts);
    assert(r.status === 0, "quay action list CLI-1 --json exits 0");
    const buttons = JSON.parse(r.stdout);
    assert(
      Array.isArray(buttons) && buttons.some((b) => b.id === "advance"),
      "quay action list --json includes the 'advance' button for a task whose status matches whenStatus"
    );
  }

  // 5b. Negative control: a done task should get no action buttons (native
  //     provider.yml's advance button declares whenStatus: ["todo","ready"]).
  {
    execFileSync("node", [nativeBin, "task", "edit", "CLI-1", "--status", "done"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: envTasksDir },
    });
    const r = run(["action", "list", "CLI-1", "--json"], spawnOpts);
    assert(r.status === 0, "quay action list <done task> --json exits 0");
    const buttons = JSON.parse(r.stdout);
    assert(
      Array.isArray(buttons) && buttons.length === 0,
      "quay action list --json returns no buttons for a task whose status is outside whenStatus (negative control)"
    );
    // Restore for the next step.
    execFileSync("node", [nativeBin, "task", "edit", "CLI-1", "--status", "ready"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: envTasksDir },
    });
  }

  // 6. `quay action run <id> advance --json` — composePayload() +
  //    deliverTrigger() reached without throwing; JSON output carries the
  //    expected fields.
  {
    const r = run(["action", "run", "CLI-1", "advance", "--json"], spawnOpts);
    assert(r.status === 0, "quay action run CLI-1 advance --json exits 0");
    // printJson() is the last thing `action run` writes, but composePayload()'s
    // own console.log lines precede it on stdout — find the start of the
    // final (pretty-printed, multi-line) JSON object rather than assuming a
    // single line contains it whole.
    const jsonStart = r.stdout.lastIndexOf("\n{\n");
    const result = JSON.parse(r.stdout.slice(jsonStart + 1));
    assert(result.taskId === "CLI-1", "quay action run --json output includes taskId");
    assert(result.skill === "quay:execute", "quay action run --json output includes the correct status_skill_map skill (task is status:ready)");
    assert(typeof result.channel === "string" && result.channel === "task-CLI-1", "quay action run --json output includes the composed channel name");
    assert(result.delivered === "manda" || result.delivered === "print", "quay action run --json output reports a delivered mode (manda or degraded print)");
  }

  // 7. Unknown top-level command — usage fallback + exit 1.
  {
    const r = run(["bogus"], spawnOpts);
    assert(r.status === 1, "quay <unknown command> exits 1");
    assert(r.stderr.includes("usage:"), "quay <unknown command> prints the usage fallback to stderr");
  }

  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });

  console.log(failures === 0 ? "\nAll QN-033 bin/quay.js CLI dispatch tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
