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
// QN-039 (iteration 29) closed the two residual gaps this file used to name
// here as "out of scope": resolveProviderEnv()'s absolute-path passthrough
// branch (test 8 below, via a real --provider github spawn using the
// exact QUAY_GITHUB_REPO: "yaleh/quay" shape this repo's own
// .quay/config.yml uses) and `quay serve`'s own CLI dispatch branch
// (test 9 below, spawning `bin/quay.js serve --port <n>` for real). Neither
// is silently claimed as covered elsewhere any more — see tests 8 and 9.
//
// Iteration 54 (post-hoc correction from iteration 53's audit) added test
// 10: iteration 53 had falsely claimed test 8 already end-to-end tested
// `action run --provider github` against a real GitHub-backed task — it
// does not; test 8 only exercises `task list`. A repo-wide search at that
// time confirmed no test anywhere combined `action run`/`composePayload`
// with `--provider github`. Test 10 closes that real, audit-discovered gap
// for real, spawning `action run gh-3 advance --json --provider github`
// against `yaleh/quay` issue #3 (a real, non-fixture, currently-OPEN issue),
// using QUAY_ACTION_MOCK_LOG (QN-042/DIR-009) for deterministic,
// side-effect-free delivery verification.
//
// Iteration 55 added test 11: a systematic sweep of bin/quay.js's own
// branch table (task list/view/edit/check, action list/run) found that
// ONLY `task list` (test 8) and `action run` (test 10) had ever been
// exercised end-to-end with `--provider github`. Test 11 closes the
// read-only remainder — `task view`, `action list`, and `task check` — all
// against real GitHub-backed task gh-3. `task edit --provider github` is
// deliberately excluded: it is the one Provider-parameterized command with
// a real `gh api` write path, and packages/quay-github/test/write.test.mjs's
// own header comment already documents the standing project convention
// that this repo's real issue count is too small/precious to safely target
// with destructive live writes in an automated test — that reasoning
// applies identically here, so the exclusion is a correctly-precedented
// boundary, not an oversight.
//
// Iteration 58 added test 12: a genuinely new angle from the three
// consecutive read-path cross-Provider sweeps (54/55 at the CLI layer, 56
// at the Core MCP layer, 57 at the Web-UI layer) — Provider-subprocess
// STARTUP-FAILURE propagation through Core's CLI, i.e. what happens when an
// enabled Provider's own mcp_entry process crashes immediately on launch
// (e.g. a malformed QUAY_GITHUB_REPO env value causing
// bin/quay-github.js's own resolveRepo() to throw before the MCP transport
// is ever established), NOT what happens when a live, correctly-configured
// Provider returns ordinary application-level data (the shape every prior
// cross-Provider test closed). Grepping every *.test.mjs file in the repo
// for "QUAY_GITHUB_REPO must be" confirmed this exact failure mode was
// previously tested only once, directly against packages/quay-github/
// bin/quay-github.js's own CLI (packages/quay-github/test/cli.test.mjs) —
// never through any Core-level binding (CLI, MCP, or Web UI), where the
// error must additionally survive an MCP stdio-transport connection
// attempt before reaching the caller. This test requires no live GitHub
// network access at all (the failure is local/synchronous, before any `gh
// api` call would even be attempted), so it needs no `gh auth status`
// precondition, unlike tests 8/10/11.
//
// Run: node test/cli.test.mjs
// Precondition for tests 8, 10, and 11 only: `gh auth status` must show an
// authenticated session with read access to yaleh/quay (a standing stage-2+
// precondition of this experiment, re-confirmed at the start of every
// iteration) — both spawn a real (read-only) `quay-github mcp` child
// process via `--provider github`.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreBin = path.join(__dirname, "..", "bin", "quay.js");
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.js");
const nativeProviderDir = path.dirname(nativeBin);
const githubBin = path.join(__dirname, "..", "..", "quay-github", "bin", "quay-github.js");
const githubProviderDir = path.dirname(githubBin);

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

  // 6b. QN-066 (iteration 62): unknown actionId — composePayload() throws
  //     ("no such action button: ...") BEFORE deliverTrigger() is ever
  //     reached, inside withProvider()'s async callback, uncaught all the
  //     way out to main().catch(...) at the bottom of this file. This exact
  //     failure shape is already tested at the MCP layer
  //     (mcp-server.test.mjs's action_run-with-unknown-actionId case) and at
  //     the direct src/action.js unit level (serve.test.mjs), but a
  //     repo-wide grep for "no such action button" confirmed this direct
  //     CLI-subprocess path (bin/quay.js's own dispatch + top-level
  //     main().catch handler) had never itself been spawned with a bogus
  //     actionId — a genuinely distinct, previously-untested failure point
  //     from either of those two (a real child-process exit-code/stderr
  //     shape, not a caught-and-returned MCP tool result or a direct
  //     in-process function-throw assertion). No live GitHub/network access
  //     is required (the throw happens before deliverTrigger(), entirely
  //     local, against the same fixture used throughout this file).
  {
    const r = run(["action", "run", "CLI-1", "bogus-action-id", "--json"], spawnOpts);
    assert(r.status === 1, "quay action run <id> <unknown actionId> exits 1 (not a hang, not a silent success)");
    assert(
      r.stderr.includes("no such action button"),
      `quay action run <id> <unknown actionId> propagates composePayload()'s own error text via main().catch (stderr: ${JSON.stringify(r.stderr)})`
    );
    assert(!r.stdout.includes('"delivered"'), "quay action run <id> <unknown actionId> never reaches deliverTrigger() (no 'delivered' field ever printed)");
  }

  // 7. Unknown top-level command — usage fallback + exit 1.
  {
    const r = run(["bogus"], spawnOpts);
    assert(r.status === 1, "quay <unknown command> exits 1");
    assert(r.stderr.includes("usage:"), "quay <unknown command> prints the usage fallback to stderr");
  }

  // 8. QN-039 (iteration 29): resolveProviderEnv()'s absolute-path
  //    passthrough branch (the `else` of the `./`/`../`-prefix check) —
  //    exercised via a second provider entry, `github`, whose `env` uses
  //    QUAY_GITHUB_REPO: "yaleh/quay" verbatim, the EXACT shape the real
  //    repo's own .quay/config.yml uses (not a synthetic value). If
  //    resolveProviderEnv() ever mis-resolved this (e.g. tried to
  //    path.resolve() it, corrupting "yaleh/quay" into an absolute
  //    filesystem path), the spawned `quay-github mcp` child process would
  //    receive a broken QUAY_GITHUB_REPO and bin/quay-github.js's own
  //    resolveRepo() would throw ("QUAY_GITHUB_REPO must be owner/repo") —
  //    so a genuinely successful, non-empty `task list` result is itself
  //    live proof the passthrough branch works, not an assumption. This
  //    makes a real (read-only) `gh api` call against yaleh/quay.
  {
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
        "  github:",
        "    enabled: false",
        `    path: "${githubProviderDir.replaceAll("\\", "\\\\")}"`,
        `    mcp_entry: ["node", "${githubBin.replaceAll("\\", "\\\\")}", "mcp"]`,
        "    env:",
        "      QUAY_GITHUB_REPO: \"yaleh/quay\"",
        "",
      ].join("\n")
    );
    const r = run(["task", "list", "--provider", "github", "--json"], spawnOpts);
    assert(r.status === 0, "quay --provider github task list --json exits 0 (proves resolveProviderEnv()'s absolute-path passthrough reached the spawned quay-github mcp child intact)");
    let tasks;
    try {
      tasks = JSON.parse(r.stdout);
    } catch {
      tasks = null;
    }
    assert(Array.isArray(tasks) && tasks.length > 0, "quay --provider github task list --json returns real, non-empty task data from the live yaleh/quay repo");
    // Restore the native-only config for any subsequent step in this file.
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
  }

  // 9. QN-039 (iteration 29): `quay serve`'s own CLI dispatch branch
  //    (`cmd === "serve"` and its `process.argv.slice(3)` re-parse quirk),
  //    exercised by spawning bin/quay.js itself as a real child process
  //    (not importing startServer() directly, which is what serve.test.mjs
  //    already covers). Confirms both that the dispatch branch's dynamic
  //    import + startServer() call actually runs, AND that --port is read
  //    correctly by the argv.slice(3) re-parse (not swallowed as a `sub`
  //    token by the normal parseFlags(rest) call, which would otherwise see
  //    "--port" as `sub` since `serve` has no subcommand token).
  //
  //    Note (updated, QN-045): serve.js's startServer() now builds the
  //    spawned quay-native mcp child's env via the SAME shared
  //    resolveProviderEnv() (reading `provider.env`) that withProvider()
  //    already used — previously it read `provider.tasks_dir` directly as a
  //    distinct, narrower code path (DESIGN.md §4.4's asymmetry, closed this
  //    iteration). So this block's config now sets BOTH `tasks_dir` (kept,
  //    harmless, no longer load-bearing for this test) AND `env.
  //    QUAY_NATIVE_TASKS_DIR` pointed straight at `envTasksDir` (the
  //    directory CLI-1 was actually seeded into, above — NOT the top-level
  //    `tasksDir` mkdtemp, which (per the comment on that variable further
  //    up) is never itself seeded with tasks), matching serve.test.mjs's own
  //    (already-passing, similarly updated) fixture convention, rather than
  //    reusing the env-relative fixture used by tests 1-8 above.
  {
    const http = await import("node:http");
    const serveWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-serve-workspace-"));
    fs.mkdirSync(path.join(serveWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(serveWorkspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
        `    tasks_dir: "${envTasksDir.replaceAll("\\", "\\\\")}"`,
        `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${envTasksDir.replaceAll("\\", "\\\\")}"`,
        "",
      ].join("\n")
    );
    const port = 41800 + (process.pid % 500);
    const child = (await import("node:child_process")).spawn(
      "node", [coreBin, "serve", "--port", String(port)],
      { cwd: serveWorkspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    try {
      // Poll for the server to come up (real subprocess start-up latency).
      let up = false;
      for (let i = 0; i < 50 && !up; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          const res = await new Promise((resolve, reject) => {
            http.get({ host: "127.0.0.1", port, path: "/" }, resolve).on("error", reject);
          });
          if (res.statusCode === 200) up = true;
        } catch {
          // not up yet
        }
      }
      assert(up, "quay serve --port <n>, spawned as a real subprocess, becomes reachable on the exact port passed on the command line (proves the argv.slice(3) re-parse works, not the 4173 default)");
      if (up) {
        const body = await new Promise((resolve, reject) => {
          http.get({ host: "127.0.0.1", port, path: "/" }, (res) => {
            let b = "";
            res.on("data", (c) => (b += c));
            res.on("end", () => resolve(b));
          }).on("error", reject);
        });
        assert(body.includes("CLI-1"), "quay serve (spawned as a subprocess) renders the seeded task in its GET / body, proving the cmd === 'serve' dispatch branch genuinely ran startServer()");
      }
    } finally {
      child.kill();
      fs.rmSync(serveWorkspaceRoot, { recursive: true, force: true });
    }
  }

  // 10. Iteration 54 (post-hoc correction from iteration 53's audit):
  //     end-to-end `quay action run --json --provider github` against a
  //     REAL GitHub-backed task. Iteration 53 falsely claimed test 8 above
  //     already covered this (it does not — test 8 only exercises `task
  //     list --provider github`, never `action run`). A repo-wide grep at
  //     that time confirmed no test anywhere combined `action run`/
  //     `composePayload` with `--provider github`. This block closes that
  //     gap for real: it spawns the actual `bin/quay.js` binary with
  //     `--provider github` against `gh-3` (`yaleh/quay` issue #3, a real,
  //     currently-OPEN, non-fixture issue carrying the `status:ready`
  //     label), exercising the FULL real chain — `resolveProviderEnv()` ->
  //     spawned `quay-github mcp` child -> a real (read-only) `gh api` call
  //     -> `task_get` -> `composePayload()` reading quay-github's own
  //     `provider.yml` action_buttons/status_skill_map -> `deliverTrigger()`.
  //     `QUAY_ACTION_MOCK_LOG` (QN-042/DIR-009) is used to select the
  //     deterministic, network-independent-for-delivery mock mode, so the
  //     assertions below do not depend on a live manda daemon and make zero
  //     writes back to the real repo (setStatus()/gh api PATCH is never
  //     called by `action run` -- only `action.js`'s own composePayload +
  //     deliverTrigger, confirmed by reading action.js in full, iteration 53).
  //     `gh-3`'s live status was independently confirmed via
  //     `quay-github task get gh-3 --json` this same iteration session to
  //     carry `"status": "ready"` before this test was added, so the
  //     `skill === "quay:execute"` assertion below is a genuine, currently-
  //     true fact about live external state, not a guess -- if issue #3's
  //     status label ever changes, this assertion (not the harness) would
  //     need to be revisited, exactly as test 8's own live-repo dependency
  //     already requires.
  {
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
        "  github:",
        "    enabled: false",
        `    path: "${githubProviderDir.replaceAll("\\", "\\\\")}"`,
        `    mcp_entry: ["node", "${githubBin.replaceAll("\\", "\\\\")}", "mcp"]`,
        "    env:",
        "      QUAY_GITHUB_REPO: \"yaleh/quay\"",
        "",
      ].join("\n")
    );
    const mockLogPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-test-action-github-log-")),
      "delivery-log.jsonl"
    );
    const r = run(
      ["action", "run", "gh-3", "advance", "--json", "--provider", "github"],
      { ...spawnOpts, env: { ...process.env, QUAY_ACTION_MOCK_LOG: mockLogPath } }
    );
    assert(r.status === 0, "quay action run gh-3 advance --json --provider github exits 0 (real GitHub-backed task, end-to-end)");
    const jsonStart = r.stdout.lastIndexOf("\n{\n");
    let result;
    try {
      result = JSON.parse(r.stdout.slice(jsonStart + 1));
    } catch {
      result = null;
    }
    assert(!!result, "quay action run --json --provider github emits parseable JSON output");
    if (result) {
      assert(result.taskId === "gh-3", "quay action run --json --provider github output includes the real GitHub taskId (gh-3)");
      assert(
        result.status === "ready" && result.skill === "quay:execute",
        `quay action run --json --provider github resolves the correct status_skill_map skill for gh-3's real live status (got status=${result.status}, skill=${result.skill})`
      );
      assert(result.channel === "task-gh-3", "quay action run --json --provider github output includes the composed channel name for the real GitHub task id");
      assert(result.delivered === "mock", "quay action run --json --provider github used the deterministic QUAY_ACTION_MOCK_LOG delivery mode, not a live manda/print path");
    }
    // Independently confirm the delivery record itself was actually
    // written to disk with the expected fields -- not just trusting the
    // CLI's own --json echo of the result.
    assert(fs.existsSync(mockLogPath), "the mock delivery log file was actually created on disk for the real GitHub-backed action run");
    if (fs.existsSync(mockLogPath)) {
      const lines = fs.readFileSync(mockLogPath, "utf8").trim().split("\n").filter(Boolean);
      assert(lines.length === 1, `mock delivery log contains exactly one record (got ${lines.length})`);
      if (lines.length === 1) {
        const record = JSON.parse(lines[0]);
        assert(record.taskId === "gh-3" && record.skill === "quay:execute" && record.channel === "task-gh-3",
          "the on-disk mock delivery record for the real GitHub task carries the correct taskId/skill/channel");
      }
    }
    // Restore the native-only config for cleanliness (matches test 8's own convention).
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
    fs.rmSync(path.dirname(mockLogPath), { recursive: true, force: true });
  }

  // 11. Iteration 55: a systematic sweep of every Provider-parameterized
  //     `quay` subcommand (per bin/quay.js's own branch table: task
  //     list/view/edit/check, action list/run) found that ONLY `task list`
  //     (test 8) and `action run` (test 10) had ever been exercised with
  //     `--provider github` end-to-end. `task view` and `action list` are
  //     pure data.read paths (no gh api write call anywhere in their
  //     control flow -- confirmed by reading bin/quay.js's `task view` and
  //     `action list` branches in full: both call only client.taskGet() /
  //     client.manifest(), never client.taskWrite()) and `task check` is a
  //     pure gate/read path (calls only client.taskCheck(), which reads the
  //     issue body via github-client.js's checkGate(); confirmed by reading
  //     that file in full -- no gh api PATCH/POST call exists in checkGate's
  //     call graph). All three were manually exercised live against real
  //     `yaleh/quay` issue gh-3 this session, before writing this test, to
  //     confirm exact expected behavior:
  //       $ QUAY_GITHUB_REPO=yaleh/quay node packages/quay/bin/quay.js \
  //           task view gh-3 --json --provider github
  //         -> {"id":"gh-3", ..., "status":"ready", ...}
  //       $ QUAY_GITHUB_REPO=yaleh/quay node packages/quay/bin/quay.js \
  //           action list gh-3 --json --provider github
  //         -> [{"id":"advance","label":"Advance",...,"whenStatus":["todo","ready"]}]
  //       $ QUAY_GITHUB_REPO=yaleh/quay node packages/quay/bin/quay.js \
  //           task check gh-3 --json --provider github
  //         -> exit 1, {"gate":"execute->done","ok":false,"acTotal":4,"acChecked":0,...}
  //     (gh-3 has zero AC checkboxes checked in its live body, so the gate
  //     correctly fails -- this is itself useful, different-shaped coverage
  //     from test 10's action-run path, which only ever exercises the
  //     ready-status/advance-button branch.) `task edit --provider github`
  //     is deliberately NOT added here: it is the one Provider-parameterized
  //     command that performs a real `gh api` write (label add/remove or
  //     issue close, per github-client.js's computeStatusWrite()), and
  //     packages/quay-github/test/write.test.mjs's own header comment
  //     already documents the standing project convention that this repo's
  //     real issue count is "too small/precious to safely target with
  //     destructive live writes in an automated, repeatable test file" --
  //     that reasoning applies identically at the Core CLI dispatch layer,
  //     so `task edit --provider github` remains a correctly-excluded,
  //     already-precedented gap, not an oversight.
  {
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
        "  github:",
        "    enabled: false",
        `    path: "${githubProviderDir.replaceAll("\\", "\\\\")}"`,
        `    mcp_entry: ["node", "${githubBin.replaceAll("\\", "\\\\")}", "mcp"]`,
        "    env:",
        "      QUAY_GITHUB_REPO: \"yaleh/quay\"",
        "",
      ].join("\n")
    );

    // 11a. `quay task view <id> --json --provider github`.
    {
      const r = run(["task", "view", "gh-3", "--json", "--provider", "github"], spawnOpts);
      assert(r.status === 0, "quay task view gh-3 --json --provider github exits 0 (real GitHub-backed task, end-to-end)");
      let t;
      try {
        t = JSON.parse(r.stdout);
      } catch {
        t = null;
      }
      assert(!!t, "quay task view --json --provider github emits parseable JSON output");
      if (t) {
        assert(t.id === "gh-3", "quay task view --json --provider github output includes the real GitHub taskId (gh-3)");
        assert(typeof t.title === "string" && t.title.length > 0, "quay task view --json --provider github output includes a non-empty title read live from the real issue");
        assert(t.status === "ready", `quay task view --json --provider github reflects gh-3's real live status (got ${t.status})`);
      }
    }

    // 11b. `quay action list <id> --json --provider github`.
    {
      const r = run(["action", "list", "gh-3", "--json", "--provider", "github"], spawnOpts);
      assert(r.status === 0, "quay action list gh-3 --json --provider github exits 0 (real GitHub-backed task, end-to-end)");
      let buttons;
      try {
        buttons = JSON.parse(r.stdout);
      } catch {
        buttons = null;
      }
      assert(Array.isArray(buttons), "quay action list --json --provider github emits a JSON array");
      assert(
        Array.isArray(buttons) && buttons.some((b) => b.id === "advance"),
        "quay action list --json --provider github includes the 'advance' button for gh-3 (whenStatus includes its real live status 'ready')"
      );
    }

    // 11c. `quay task check <id> --json --provider github` — exit code
    //      mirrors result.ok, exactly like the native task-check test
    //      (test 4) above, but against a real GitHub-backed gate read.
    //      gh-3's live body currently has zero AC checkboxes checked, so
    //      this exercises the FAIL branch (a different, previously-
    //      untested shape from test 10's action-run path).
    {
      const r = run(["task", "check", "gh-3", "--json", "--provider", "github"], spawnOpts);
      assert(r.status === 1, "quay task check gh-3 --json --provider github exits 1 (mirrors result.ok for gh-3's real, currently-unchecked AC state)");
      let result;
      try {
        result = JSON.parse(r.stdout);
      } catch {
        result = null;
      }
      assert(!!result, "quay task check --json --provider github emits parseable JSON output");
      if (result) {
        assert(result.id === "gh-3", "quay task check --json --provider github output includes the real GitHub taskId (gh-3)");
        assert(result.ok === false, "quay task check --json --provider github reports ok:false for gh-3's real, currently-unchecked AC state");
        assert(typeof result.acTotal === "number" && typeof result.acChecked === "number", "quay task check --json --provider github reports real acTotal/acChecked counts read live from the issue body");
      }
    }

    // Restore the native-only config for cleanliness (matches tests 8/10's own convention).
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
  }

  // 12. QN-062 (iteration 58): Provider-subprocess STARTUP-FAILURE
  //     propagation through Core's CLI, local-only (no live network) — a
  //     malformed QUAY_GITHUB_REPO env value causes bin/quay-github.js's
  //     own resolveRepo() to throw synchronously, before the MCP stdio
  //     transport handshake ever completes, so `withProvider()`'s
  //     `connectProvider()` call rejects. This test proves Core's own
  //     `main().catch(...)` handler (bin/quay.js) still correctly reports
  //     failure (a real, if verbose, diagnostic on stderr, and exit code 1)
  //     rather than hanging, silently swallowing the error, or exiting 0.
  {
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
        "  broken-github:",
        "    enabled: false",
        `    path: "${githubProviderDir.replaceAll("\\", "\\\\")}"`,
        `    mcp_entry: ["node", "${githubBin.replaceAll("\\", "\\\\")}", "mcp"]`,
        "    env:",
        "      QUAY_GITHUB_REPO: \"this-is-not-owner-slash-repo\"",
        "",
      ].join("\n")
    );

    const r = run(["task", "list", "--provider", "broken-github", "--json"], spawnOpts);
    assert(r.status === 1, `quay task list --provider <a Provider whose mcp_entry crashes on launch> exits 1 (got ${r.status})`);
    assert(
      r.stdout.trim() === "",
      "quay task list against a crashing Provider subprocess writes nothing to stdout (the diagnostic goes to stderr only, not mixed into what a --json caller would try to parse)"
    );
    assert(
      r.stderr.includes("QUAY_GITHUB_REPO must be") || r.stderr.includes("Connection closed"),
      `quay task list against a crashing Provider subprocess reports a diagnostic on stderr naming the failure (got: ${r.stderr.slice(0, 300)})`
    );

    // Restore the native-only config for the next block (matches tests
    // 8/10/11's own convention).
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
