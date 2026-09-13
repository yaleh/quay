// @test-group product
// QN-033 (iteration 23): regression test for `bin/quay.js` itself — the Core
// CLI's own dispatch layer (parseFlags(), the `cmd`/`sub` branch table,
// resolveProviderEnv(), withProvider(), and the top-level `main().catch(...)`
// handler). Prior to this task, `bin/quay.js` had ZERO automated test
// coverage anywhere in the repo: grepping every `*.test.mjs` file under
// packages/quay-native/test/, packages/quay/test/, and packages/quay-github/
// test/ for any reference to bin/quay.js or a spawn of it returned zero
// hits. Its sibling, packages/quay-native/bin/quay-native.ts, IS exercised
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
// bin/quay-github.ts's own resolveRepo() to throw before the MCP transport
// is ever established), NOT what happens when a live, correctly-configured
// Provider returns ordinary application-level data (the shape every prior
// cross-Provider test closed). Grepping every *.test.mjs file in the repo
// for "QUAY_GITHUB_REPO must be" confirmed this exact failure mode was
// previously tested only once, directly against packages/quay-github/
// bin/quay-github.ts's own CLI (packages/quay-github/test/cli.test.mjs) —
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
//
// DIR-112 (M222, 2026-08-01): refactored from synchronous execFileSync to
// async execFile + Promise.all for the 7 own-workspace blocks (13, 17, 18,
// 19, 20, 21, 22). Three-phase execution model: Phase 1 serial (blocks 1-12,
// shared workspace/config.yml/task store), Phase 2 concurrent (7 isolated
// blocks), Phase 3 serial (blocks 14-16, 23-25, shared workspace read-only).
// Output prefixing via makeAssert(tag) for concurrent blocks.
//
// gap-cli-import-refactor-run-shell-architecture (2026-08-12): command-behavior
// blocks now call run() IN-PROCESS (runImport — import of ../bin/quay.ts with
// ctx.capture) instead of spawning the CLI, per the run()/shell architecture
// (core: run(argv, ctx) → { code, stdout, stderr }; shell: thin argv→run→exit).
// The execve floor dropped 285 → 205 (-28%) and this file's wall clock dropped
// ~57.6s → ~28.3s (measured, not inferred). Blocks that stay SPAWNED are the
// shell-contract / boundary surface: live-GitHub (8, 10, 11), serve (9),
// broken-provider startup failure (12), and the 7 CONCURRENT own-workspace
// blocks (13, 17-22) — run() mutates process-level cwd/env/stdout during the
// call, so in-process calls must be serial, never Promise.all'd.
//
// ── SHELL-CONTRACT DERIVED-TEST MANIFEST (AC3) ─────────────────────────────
// Shell contracts are the things that CANNOT be import-tested — they are about
// the real process boundary. Each is either covered by a REAL spawn here or
// explicitly documented as "no distinct branch" (measured, not assumed):
//   D1 --version/-V argv passthrough + exit 0   → block 26 golden-replay spawn side
//   D2 shebang line                             → block 27 (read-only check of bin/quay.ts)
//   D3 stdin pipe (--body-file -)               → documented: exercising it via
//        runImport would read the TEST's stdin; it stays a spawn concern
//   D4 TTY detection                            → DOCUMENTED: bin/quay.ts and
//        src/*.ts contain zero isTTY branches, so there is no distinct TTY
//        behavior to derive; the contract is "no TTY special-casing"
//   D5 signal (SIGINT/SIGTERM)                  → DOCUMENTED: no custom handler;
//        process exits with Node's default signal disposition
//   D6 exit-code mapping (run() code → process.exitCode) → block 26 spawn side
//
// ── ZERO-COVERAGE PURE-HELPER TESTS (AC2) ─────────────────────────────────
// block 27 import-calls the six exported helpers from bin/quay.ts directly
// (parseVerbless / resolveJsonFlag / resolvePageSize / relativeTimeCli /
// parseFlags / stripHeadings) — zero derivation, closing the 4-name coverage
// gap the Proposal measured.

import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
// gap-cli-import-refactor-run-shell-architecture: command-behavior coverage calls
// run() IN-PROCESS (import from ../bin/quay.ts, ctx.capture=true) instead of
// spawning the CLI — the same args/opts shape as the spawn helper below, but
// zero process derivation for the coreBin layer. Shell-contract concerns
// (argv passthrough through the real process boundary, shebang, signal, stdin
// pipe, TTY detection, process exit semantics) REMAIN in the spawn path — the
// explicit shell-contract list is in this file's header + cli-run.test.mjs.
import {
  run as runCli,
  parseFlags,
  parseVerbless,
  resolveJsonFlag,
  resolvePageSize,
  relativeTimeCli,
  stripHeadings,
} from "../bin/quay.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
// gap-driver-cli-help-hides-four-of-six-kinds: 帮助文本的 kind/verb 单一真源（零依赖叶模块——⛔ 不要
// 从 ../src/cli/driver.ts 取，那条路径把 config.ts/plugin-root.ts 拖进来，正是本任务要避免的成本）。
import { KINDS as DRIVER_KINDS_VOCAB, VERBS as DRIVER_VERBS_VOCAB } from "../src/cli/driver-vocab.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// gap-tests-spawn-cli-from-ts-source: route CLI spawns through the prebuilt
// dist bundle (freshness-checked by cli-entry.mjs) instead of the .ts source —
// the bundle skips the ~2.1s/process TS module-graph load. coreBin is the 67
// run() call sites (the wall-clock lever); nativeBin seeds fixtures + the
// provider MCP server. nativeProviderDir stays pinned to the SOURCE bin dir:
// it is the provider's cwd (config.yml `path:`), independent of which entry
// binary the mcp_entry launches.
const coreBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const githubBin = path.join(__dirname, "..", "..", "quay-github", "bin", "quay-github.ts");
const githubProviderDir = path.dirname(githubBin);

// ADR-019 (M173/DIR-109) in-file skip declaration, extended to this file's live-GitHub blocks
// (tests 8, 10, 11). gap-release-postinstall-fallback-breaks-windows-sea-build (AC4): the release
// job's "Run tests" step set GH_TOKEN, which ENABLED these live blocks against the real
// yaleh/quay issue store — and their assertions drift with that store's current state (e.g. gh-3's
// status label), so v0.4.0's release run failed on live-store drift that is unrelated to whether
// the tagged commit's deterministic tests pass. Aligning with the three conformance files
// (serve-github / provider-abi-conformance / cli-edit-parity-conformance): these blocks now run
// ONLY with QUAY_TEST_LIVE_GITHUB=1. A release gate must verify the ARTIFACT, not re-verify the
// live GitHub store's mutable state — so the release job does NOT set this env (and no longer
// needs GH_TOKEN on its test step).
const LIVE_GITHUB_ENV = "QUAY_TEST_LIVE_GITHUB";
const liveGithubEnabled = process.env[LIVE_GITHUB_ENV] === "1";

let failures = 0;
let _lastAssertMs = 0; // AC1b assertion-gap timing (gap-suite-cost-model-is-wrong-optimizations-buy-nothing)
function assert(cond, msg) {
  if (process.env.QUAY_TEST_ASSERT_TIMING) {
    const now = Date.now();
    if (_lastAssertMs) {
      const gap = now - _lastAssertMs;
      if (gap >= 1000) console.error(`[timing] +${Math.round(gap)}ms: ${String(msg).slice(0, 80)}`);
    }
    _lastAssertMs = now;
  }
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function makeAssert(tag) {
  return (cond, msg) => {
    if (process.env.QUAY_TEST_ASSERT_TIMING) {
      const now = Date.now();
      if (_lastAssertMs) {
        const gap = now - _lastAssertMs;
        if (gap >= 1000) console.error(`[timing][${tag}] +${Math.round(gap)}ms: ${String(msg).slice(0, 80)}`);
      }
      _lastAssertMs = now;
    }
    if (!cond) {
      failures++;
      console.error(`[${tag}] FAIL: ${msg}`);
    } else {
      console.log(`[${tag}] PASS: ${msg}`);
    }
  };
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
// gap-both-gates-read-one-signal-so-done-costs-nothing: an UNCHECKED AC box no
// longer fails author->ready (checked-state belongs to ready->done), so
// AC_DOD_UNCHECKED is no longer a gate-FAILING fixture. A genuine author->ready
// failure is an AC section with NO machine-checkable checkboxes at all.
const AC_NO_CHECKBOX =
  "## AC\nThis acceptance criteria section is written in prose only, with no machine-checkable checkbox lines at all, comfortably past forty non-whitespace characters.\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

function run(args, opts = {}) {
  return new Promise((resolve) => {
    const child = execFile("node", [coreBin, ...args], { encoding: "utf8", ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code, signal) => {
      resolve({ status: signal ? (code ?? 1) : (code ?? 0), stdout, stderr });
    });
    child.on("error", (err) => {
      resolve({ status: err.status ?? 1, stdout: "", stderr: String(err) });
    });
  });
}

// gap-cli-import-refactor-run-shell-architecture (AC2/AC4): the import-call
// sibling of the spawn `run()` above. Same (args, opts) contract — opts.cwd
// and opts.env map onto run()'s ctx, capture:true returns { status, stdout,
// stderr } identical in shape to the spawn helper. Used by the serial
// command-behavior blocks; the shell-contract blocks (9 serve, live-github 8/
// 10/11, broken-provider 12, and the concurrent 13/17-22) keep the spawn path.
function runImport(args, opts = {}) {
  return runCli(args, {
    capture: true,
    cwd: opts.cwd,
    env: opts.env,
  }).then((r) => ({ status: r.code, stdout: r.stdout, stderr: r.stderr }));
}

function runNative(args, opts = {}) {
  return new Promise((resolve) => {
    const child = execFile("node", [nativeBin, ...args], { encoding: "utf8", ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code, signal) => {
      resolve({ status: signal ? (code ?? 1) : (code ?? 0), stdout, stderr });
    });
    child.on("error", (err) => {
      resolve({ status: err.status ?? 1, stdout: "", stderr: String(err) });
    });
  });
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
    "--status", "todo", "--body", VALID_SECTIONS + AC_NO_CHECKBOX], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: envTasksDir },
  });

  const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

  // === Phase 1 — serial (shared workspace, config.yml, task store) ===

  // 1. `quay task list --json` — confirms both the JSON shape AND
  //    (implicitly) that resolveProviderEnv()'s ./-relative resolution
  //    correctly pointed the spawned quay-native mcp child at
  //    envTasksDir, not an empty/wrong directory.
  {
    const r = await runImport(["task", "list", "--json"], spawnOpts);
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
    const r = await runImport(["task", "list"], spawnOpts);
    assert(r.status === 0, "quay task list (no --json) exits 0");
    assert(r.stdout.includes("CLI-1") && r.stdout.includes("\t"), "quay task list (no --json) emits tab-separated lines");
  }

  // 2. `quay task view <id> --json` — happy path.
  {
    const r = await runImport(["task", "view", "CLI-1", "--json"], spawnOpts);
    assert(r.status === 0, "quay task view CLI-1 --json exits 0");
    const t = JSON.parse(r.stdout);
    assert(t.id === "CLI-1" && t.title === "CLI test task one", "quay task view --json returns the correct task");
  }

  // 2b. "no such task" error path.
  {
    const r = await runImport(["task", "view", "NOPE-999", "--json"], spawnOpts);
    assert(r.status === 1, "quay task view <unknown id> exits 1");
    assert(r.stderr.includes("no such task"), "quay task view <unknown id> prints 'no such task' to stderr");
  }

  // 3. `quay task edit <id> --status ready --json` — happy path.
  {
    const r = await runImport(["task", "edit", "CLI-1", "--status", "ready", "--json"], spawnOpts);
    assert(r.status === 0, "quay task edit --status ready --json exits 0");
    const t = JSON.parse(r.stdout);
    assert(t.status === "ready", "quay task edit --status ready actually persists the new status");
  }

  // 3b. Missing any patch field error path. M16-cli-edit-parity-impl
  //     relaxed `task edit` to full-field parity — `--status` is no longer
  //     solely required; the guard now fires when NO patch-producing flag
  //     (nor --append-notes) is given at all.
  {
    const r = await runImport(["task", "edit", "CLI-1", "--json"], spawnOpts);
    assert(r.status === 1, "quay task edit with no patch flags exits 1");
    assert(
      r.stderr.includes("at least one of") && r.stderr.includes("--status"),
      "quay task edit with no patch flags prints the 'at least one field required' error"
    );
  }

  // 4. `quay task check <id> --json` — exit code mirrors result.ok, both
  //    directions. This is main()'s own `process.exitCode = result.ok ? 0 : 1`
  //    line — distinct from task-check.test.mjs, which calls
  //    provider-client.js's taskCheck() directly and never exercises this
  //    CLI-level exit-code-setting branch.
  {
    const rOk = await runImport(["task", "check", "CLI-1", "--json"], spawnOpts);
    assert(rOk.status === 0, "quay task check <passing task> --json exits 0");
    const ok = JSON.parse(rOk.stdout);
    assert(ok.ok === true, "quay task check <passing task> reports ok:true");

    const rFail = await runImport(["task", "check", "CLI-2", "--json"], spawnOpts);
    assert(rFail.status === 1, "quay task check <failing task> --json exits 1 (mirrors result.ok)");
    const fail = JSON.parse(rFail.stdout);
    assert(fail.ok === false, "quay task check <failing task> reports ok:false");
  }

  // 4b. M31-cli-gate-enforcement: `task edit <id> --status <x> --enforce-gate`.
  //     CLI-2 (status todo, AC section with NO checkboxes) is a real
  //     gate-failing fixture against the native provider's own author->ready
  //     gate (store.js#check()) — `task check CLI-2` already asserts
  //     ok:false above (test 4), so `--enforce-gate` must refuse the SAME
  //     write for the SAME reason, by calling that exact same check.
  //     (gap-both-gates-read-one-signal-so-done-costs-nothing: an unchecked
  //     AC box no longer fails author->ready, so CLI-2 now fails via "AC
  //     section has no checkboxes" instead.)
  //
  //     Decision (charter M31-cli-gate-enforcement, "Decision" section):
  //     default `task edit --status` remains UNGUARDED (git commit
  //     --no-verify analogy) — `--enforce-gate` is opt-in only. This block
  //     verifies both directions: refuse-on-fail (4b-i), the default-
  //     unguarded write still succeeds against the SAME fixture without the
  //     flag (4b-ii, zero regression / Done-when clause 3), and succeed-on-
  //     pass with the flag present (4b-iii, Done-when clause 2).
  {
    // 4b-i. --enforce-gate refuses a gate-failing status transition: exit 1,
    //       no write performed, result.reason surfaced in the error message.
    const rRefuse = await runImport(["task", "edit", "CLI-2", "--status", "ready", "--enforce-gate", "--json"], spawnOpts);
    assert(rRefuse.status === 1, "quay task edit CLI-2 --status ready --enforce-gate exits 1 (gate fails)");
    assert(
      rRefuse.stderr.includes("checkboxes"),
      `quay task edit --enforce-gate refusal surfaces the gate's result.reason in the error message (got stderr: ${rRefuse.stderr.slice(0, 300)})`
    );
    const viewAfterRefuse = await runImport(["task", "view", "CLI-2", "--json"], spawnOpts);
    const afterRefuse = JSON.parse(viewAfterRefuse.stdout);
    assert(afterRefuse.status === "todo", "quay task edit --enforce-gate refusal performs NO write — CLI-2 status unchanged (still todo)");

    // 4b-ii. WITHOUT --enforce-gate, the identical status transition against
    //        the SAME gate-failing fixture succeeds — current unguarded
    //        default behavior is unchanged (Done-when clause 3, zero regression).
    const rUnguarded = await runImport(["task", "edit", "CLI-2", "--status", "ready", "--json"], spawnOpts);
    assert(rUnguarded.status === 0, "quay task edit CLI-2 --status ready (no --enforce-gate) still succeeds unguarded against the same gate-failing fixture (Done-when clause 3)");
    const unguarded = JSON.parse(rUnguarded.stdout);
    assert(unguarded.status === "ready", "quay task edit CLI-2 --status ready (no --enforce-gate) actually persists the new status");

    // Reset CLI-2 back to todo (still gate-failing) for the remaining checks.
    await runImport(["task", "edit", "CLI-2", "--status", "todo"], spawnOpts);

    // 4b-iii. --enforce-gate succeeds identically to an unguarded write when
    //         the gate PASSES (Done-when clause 2) — use CLI-1, a passing
    //         fixture (AC fully checked), same exit code / output shape.
    const rPass = await runImport(["task", "edit", "CLI-1", "--status", "todo", "--enforce-gate", "--json"], spawnOpts);
    assert(rPass.status === 0, "quay task edit CLI-1 --status todo --enforce-gate exits 0 when the gate passes");
    const passResult = JSON.parse(rPass.stdout);
    assert(passResult.status === "todo", "quay task edit --enforce-gate (gate passes) actually persists the new status, same output shape as unguarded");

    // 4b-iv. Done-when clause 4: --enforce-gate combined with a non-status
    //        patch (e.g. --labels only, no --status) is a documented no-op
    //        guard-check — this milestone chooses option (b): explicit no-op
    //        without a status field present (see report for full reasoning).
    //        Verify it does NOT refuse even though CLI-2 (currently todo,
    //        gate-failing) is the target — because no status change is
    //        requested, the gate is never invoked.
    const rLabelsOnly = await runImport(["task", "edit", "CLI-2", "--labels", "a,b", "--enforce-gate", "--json"], spawnOpts);
    assert(rLabelsOnly.status === 0, "quay task edit CLI-2 --labels a,b --enforce-gate (no --status field) succeeds as a no-op guard-check — Done-when clause 4, option (b)");
  }

  // 5. `quay action list <id> --json` — action_buttons filtered by
  //    whenStatus against the task's live status.
  {
    const r = await runImport(["action", "list", "CLI-1", "--json"], spawnOpts);
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
    const r = await runImport(["action", "list", "CLI-1", "--json"], spawnOpts);
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
    const r = await runImport(["action", "run", "CLI-1", "advance", "--json"], spawnOpts);
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
    const r = await runImport(["action", "run", "CLI-1", "bogus-action-id", "--json"], spawnOpts);
    assert(r.status === 1, "quay action run <id> <unknown actionId> exits 1 (not a hang, not a silent success)");
    assert(
      r.stderr.includes("no such action button"),
      `quay action run <id> <unknown actionId> propagates composePayload()'s own error text via main().catch (stderr: ${JSON.stringify(r.stderr)})`
    );
    assert(!r.stdout.includes('"delivered"'), "quay action run <id> <unknown actionId> never reaches deliverTrigger() (no 'delivered' field ever printed)");
  }

  // 7. Unknown top-level command — usage fallback + exit 1.
  {
    const r = await runImport(["bogus"], spawnOpts);
    assert(r.status === 1, "quay <unknown command> exits 1");
    assert(r.stderr.includes("usage:"), "quay <unknown command> prints the usage fallback to stderr");
    // gap-quay-driver-missing-from-usage-line: `driver` is a real subcommand
    // (AC139) but was missing from the fallback usage line — discoverable via
    // `quay --help` yet invisible when a user runs `quay` bare or mistypes.
    assert(r.stderr.includes("driver"), "quay <unknown command> usage fallback includes 'driver' (gap-quay-driver-missing-from-usage-line)");
  }

  // 8. QN-039 (iteration 29): resolveProviderEnv()'s absolute-path
  //    passthrough branch (the `else` of the `./`/`../`-prefix check) —
  //    exercised via a second provider entry, `github`, whose `env` uses
  //    QUAY_GITHUB_REPO: "yaleh/quay" verbatim, the EXACT shape the real
  //    repo's own .quay/config.yml uses (not a synthetic value). If
  //    resolveProviderEnv() ever mis-resolved this (e.g. tried to
  //    path.resolve() it, corrupting "yaleh/quay" into an absolute
  //    filesystem path), the spawned `quay-github mcp` child process would
  //    receive a broken QUAY_GITHUB_REPO and bin/quay-github.ts's own
  //    resolveRepo() would throw ("QUAY_GITHUB_REPO must be owner/repo") —
  //    so a genuinely successful, non-empty `task list` result is itself
  //    live proof the passthrough branch works, not an assumption. This
  //    makes a real (read-only) `gh api` call against yaleh/quay.
  if (liveGithubEnabled) {
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
    const r = await run(["task", "list", "--provider", "github", "--json"], spawnOpts);
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
  } else {
    console.log("SKIP: test 8 (live-GitHub `task list --provider github`) — opt in with QUAY_TEST_LIVE_GITHUB=1");
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
    // Port-collision fix (gap-serve-family-port-collision): the previous
    // pid-derived port (base 41800 plus pid-modulo-a-range) overlapped other
    // serve-family tests' ranges (e.g. serve-adversarial-eval [41720,42239])
    // and collided deterministically under load. This test's PURPOSE is to
    // verify an explicit --port is honored, so it must keep passing a real
    // port number to the CLI (port 0 would forfeit the "exact port passed on
    // the command line" contract). We obtain a genuinely-free number by
    // probing with an ephemeral bind (bind 0 → read → close) instead of a
    // pid-derived guess. The close→child-bind window is a tiny
    // non-deterministic residual (TOCTOU) — vastly safer than the old
    // deterministic overlap.
    const port = await new Promise((resolve, reject) => {
      const probe = http.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const p = probe.address().port;
        probe.close(() => resolve(p));
      });
    });
    const child = (await import("node:child_process")).spawn(
      "node", [coreBin, "serve", "--port", String(port)],
      { cwd: serveWorkspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    try {
      // Poll for the server to come up (real subprocess start-up latency).
      // 30s budget (300 * 100ms): a real `quay serve` cold start via the
      // prebuilt bundle (spawned through QUAY_CLI; provider MCP handshake) can
      // exceed the previous 5s budget under CPU contention from concurrently
      // -scheduled test files (this repo's default `scripts/test.sh` run
      // uses --test-concurrency=8) or a slower CI runner -- a fixed 5s
      // window made this assertion flaky (CI run 30204233175, 2026-07-26)
      // even though the server does come up, just not within 5s. This is a
      // "does it eventually become reachable" check, not a startup-speed
      // benchmark, so widening the budget doesn't weaken what the test
      // proves.
      let up = false;
      for (let i = 0; i < 300 && !up; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          const res = await new Promise((resolve, reject) => {
            http.get({ host: "127.0.0.1", port, path: "/tasks" }, resolve).on("error", reject);
          });
          if (res.statusCode === 200) up = true;
        } catch {
          // not up yet
        }
      }
      assert(up, `quay serve --port <n>, spawned as a real subprocess, becomes reachable on the exact port passed on the command line (proves the argv.slice(3) re-parse works, not the 4173 default)${up ? "" : ` -- stdout: ${JSON.stringify(stdout.slice(0, 500))}, stderr: ${JSON.stringify(stderr.slice(0, 500))}, exitCode: ${child.exitCode}`}`);
      if (up) {
        const body = await new Promise((resolve, reject) => {
          http.get({ host: "127.0.0.1", port, path: "/tasks" }, (res) => {
            let b = "";
            res.on("data", (c) => (b += c));
            res.on("end", () => resolve(b));
          }).on("error", reject);
        });
        assert(body.includes("CLI-1"), "quay serve (spawned as a subprocess) renders the seeded task in its GET /tasks body, proving the cmd === 'serve' dispatch branch genuinely ran startServer()");
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
  if (liveGithubEnabled) {
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
    const r = await run(
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
  } else {
    console.log("SKIP: test 10 (live-GitHub `action run gh-3 --provider github`) — opt in with QUAY_TEST_LIVE_GITHUB=1");
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
  if (liveGithubEnabled) {
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
      const r = await run(["task", "view", "gh-3", "--json", "--provider", "github"], spawnOpts);
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
      const r = await run(["action", "list", "gh-3", "--json", "--provider", "github"], spawnOpts);
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
      const r = await run(["task", "check", "gh-3", "--json", "--provider", "github"], spawnOpts);
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
  } else {
    console.log("SKIP: test 11 (live-GitHub `task view/action list/task check` against gh-3) — opt in with QUAY_TEST_LIVE_GITHUB=1");
  }

  // 12. QN-062 (iteration 58): Provider-subprocess STARTUP-FAILURE
  //     propagation through Core's CLI, local-only (no live network) — a
  //     malformed QUAY_GITHUB_REPO env value causes bin/quay-github.ts's
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

    const r = await run(["task", "list", "--provider", "broken-github", "--json"], spawnOpts);
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

  // === Phase 2 — concurrent (own-workspace blocks only) ===

  await Promise.all([
    block13(),
    block17(),
    block18(),
    block19(),
    block20(),
    block21(),
    block22(),
  ]);

  // === Phase 3 — serial (shared-workspace read-only blocks) ===

  await block14(workspaceRoot);
  await block15(spawnOpts);
  await block16(spawnOpts);
  await block23();
  await block24(spawnOpts);
  await block25(spawnOpts);
  await block26(spawnOpts);
  await block27();
  await block28();
  await block29();

  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });

  console.log(failures === 0 ? "\nAll QN-033 bin/quay.js CLI dispatch tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});

// === Extracted block functions ===

// 13. QX-002 (experiment 4, iteration 1): --prefix filter for task list.
//     Closes CB-001: `quay task list --prefix <P>` returns only tasks whose
//     id starts with P. Uses a fresh isolated workspace with two distinct
//     task-id prefixes to confirm filtering and no-regression.
async function block13() {
  const assert = makeAssert("prefix");
  const prefixTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-test-prefix-tasks-"));
  const prefixWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-test-prefix-workspace-"));

  fs.mkdirSync(path.join(prefixWorkspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(prefixWorkspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${prefixTasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );

  // Seed tasks with two distinct prefixes
  await runNative(["task", "create", "PRFA-001", "--title", "Prefix A task one",
    "--status", "todo", "--body", VALID_SECTIONS + AC_DOD_CHECKED], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: prefixTasksDir },
  });
  await runNative(["task", "create", "PRFA-002", "--title", "Prefix A task two",
    "--status", "todo", "--body", VALID_SECTIONS + AC_DOD_CHECKED], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: prefixTasksDir },
  });
  await runNative(["task", "create", "PRFB-001", "--title", "Prefix B task one",
    "--status", "done", "--body", VALID_SECTIONS + AC_DOD_CHECKED], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: prefixTasksDir },
  });

  const prefixOpts = { cwd: prefixWorkspaceRoot, encoding: "utf8" };

  // --prefix PRFA (non-JSON): should include PRFA tasks, exclude PRFB
  {
    const r = await run(["task", "list", "--prefix", "PRFA"], prefixOpts);
    assert(r.status === 0, "quay task list --prefix PRFA exits 0");
    assert(r.stdout.includes("PRFA-001") && r.stdout.includes("PRFA-002"),
      "quay task list --prefix PRFA includes both PRFA-* tasks");
    assert(!r.stdout.includes("PRFB-001"),
      "quay task list --prefix PRFA excludes PRFB-001");
    assert(r.stdout.includes("filtered"),
      "quay task list --prefix PRFA shows a filter indicator in non-JSON output");
  }

  // --prefix PRFA --json: should return a filtered JSON array
  {
    const r = await run(["task", "list", "--prefix", "PRFA", "--json"], prefixOpts);
    assert(r.status === 0, "quay task list --prefix PRFA --json exits 0");
    let tasks;
    try {
      tasks = JSON.parse(r.stdout);
    } catch {
      tasks = null;
    }
    assert(Array.isArray(tasks), "quay task list --prefix PRFA --json emits a JSON array");
    assert(
      Array.isArray(tasks) && tasks.every((t) => t.id.toUpperCase().startsWith("PRFA")),
      "quay task list --prefix PRFA --json returns only PRFA-* tasks"
    );
    assert(
      Array.isArray(tasks) && !tasks.some((t) => t.id === "PRFB-001"),
      "quay task list --prefix PRFA --json excludes PRFB-001"
    );
    assert(
      Array.isArray(tasks) && tasks.length === 2,
      `quay task list --prefix PRFA --json returns exactly 2 tasks (got ${Array.isArray(tasks) ? tasks.length : "null"})`
    );
  }

  // --prefix prfa (lowercase): case-insensitive match
  {
    const r = await run(["task", "list", "--prefix", "prfa", "--json"], prefixOpts);
    assert(r.status === 0, "quay task list --prefix prfa (lowercase) exits 0");
    let tasks;
    try {
      tasks = JSON.parse(r.stdout);
    } catch {
      tasks = null;
    }
    assert(
      Array.isArray(tasks) && tasks.some((t) => t.id === "PRFA-001"),
      "quay task list --prefix prfa (lowercase) matches PRFA-001 (case-insensitive)"
    );
  }

  // No --prefix: all 3 tasks returned (no regression)
  {
    const r = await run(["task", "list", "--json"], prefixOpts);
    assert(r.status === 0, "quay task list --json (no prefix) exits 0 after adding prefix-test tasks");
    let tasks;
    try {
      tasks = JSON.parse(r.stdout);
    } catch {
      tasks = null;
    }
    assert(
      Array.isArray(tasks) && tasks.length === 3,
      `quay task list --json (no prefix) returns all 3 seeded tasks (got ${Array.isArray(tasks) ? tasks.length : "null"}) — no regression`
    );
  }

  fs.rmSync(prefixTasksDir, { recursive: true, force: true });
  fs.rmSync(prefixWorkspaceRoot, { recursive: true, force: true });
}

// 14. QX-005 (experiment 4, iteration 1): --help and -h output.
//     Closes UQ-001 (was one-line fallback) and UQ-002 (subcommand help was missing).
//     Tests that --help / -h exit 0 and include expected content.
async function block14(workspaceRoot) {
  const helpOpts = { cwd: workspaceRoot, encoding: "utf8" };

  // quay --help: exits 0, includes "Usage:" and key subcommands
  {
    const r = await runImport(["--help"], helpOpts);
    assert(r.status === 0, "quay --help exits 0 (not an error)");
    assert(r.stdout.includes("Usage:"), "quay --help output includes 'Usage:'");
    assert(r.stdout.includes("task list"), "quay --help output includes 'task list'");
    assert(r.stdout.includes("task view"), "quay --help output includes 'task view'");
    assert(r.stdout.includes("--prefix"), "quay --help output mentions --prefix flag (QX-002 cross-link)");
    assert(r.stdout.includes("quay"), "quay --help output includes the tool name");
    // M31-cli-gate-enforcement Done-when clause 5: --help documents BOTH
    // the default-unguarded behavior and --enforce-gate.
    assert(r.stdout.includes("--enforce-gate"), "quay --help output mentions --enforce-gate flag (M31-cli-gate-enforcement)");
    assert(
      r.stdout.includes("UNGUARDED") || r.stdout.includes("unguarded"),
      "quay --help output documents that status transitions are unguarded by default (M31-cli-gate-enforcement)"
    );
    // exp5-M-GATE-HELP-SYNOPSIS-GAP (M51): the top-level Usage synopsis block must list
    // `quay gate <id>` / `quay gate --list` / `quay gate-log <id>` explicitly, matching the
    // existing complete/adjudicate/promote/retreat/run lines — not just be mentioned in passing
    // inside another command's option text. Assert against the SYNOPSIS block specifically (lines
    // starting with two-space indent, "quay gate"/"quay gate-log"), not just substring presence
    // anywhere in the help text (which would trivially pass from the Options-section prose alone).
    const synopsisBlock = r.stdout.slice(r.stdout.indexOf("Usage:"), r.stdout.indexOf("\n\nOptions for task list:"));
    const gateSynopsisLines = synopsisBlock.split("\n").filter((l) => /^\s*quay gate\b/.test(l));
    assert(
      gateSynopsisLines.some((l) => /^\s*quay gate <task-id>/.test(l)),
      "quay --help Usage synopsis includes a 'quay gate <task-id>' line"
    );
    assert(
      gateSynopsisLines.some((l) => /^\s*quay gate --list/.test(l)),
      "quay --help Usage synopsis includes a 'quay gate --list' line"
    );
    assert(
      gateSynopsisLines.some((l) => /^\s*quay gate-log <task-id>/.test(l)),
      "quay --help Usage synopsis includes a 'quay gate-log <task-id>' line"
    );
    // Dedicated options section for gate/gate-log (documenting --gate/--list/--json/--file),
    // mirroring the existing "Lifecycle commands (QENG-3)" / "Driver command (QENG-4)" sections.
    assert(
      /gate/i.test(r.stdout) && /--gate <name>/.test(r.stdout),
      "quay --help documents the --gate <name> flag in a dedicated gate/gate-log options section"
    );
    assert(r.stdout.includes("--list"), "quay --help documents the --list flag for 'gate'");
    // gap-docs-t5-help-missing-commands: the Usage synopsis must list EVERY dispatchable verb
    // (adr / config validate / manager were missing — users could not discover them). AC1: the
    // three previously-missing commands appear in the synopsis block. AC2: the synopsis verb set
    // equals the quay.ts dispatch table's `cmd === "…"` set (mechanical, fails-closed).
    const synopsisVerbs = synopsisBlock
      .split("\n")
      .map((l) => l.match(/^\s*quay ([a-z][a-z-]*)(?:\s|$)/))
      .filter(Boolean)
      .map((m) => m[1])
      .filter((v) => v !== "--version" && v !== "--help" && v !== "-h");
    for (const verb of ["adr", "config", "manager"]) {
      assert(
        synopsisVerbs.includes(verb),
        `quay --help Usage synopsis includes the dispatchable verb '${verb}' (gap-docs-t5-help-missing-commands)`
      );
    }
    assert(
      r.stdout.includes("quay config validate"),
      "quay --help Usage synopsis includes the 'quay config validate' line"
    );
    // The dispatch command set from packages/quay/bin/quay.ts (every `if (cmd === "…")` route).
    const dispatchVerbs = [
      "adr", "goal", "meta", "task", "action", "serve", "server", "mcp", "init", "config", "gate",
      "gate-log", "complete", "adjudicate", "promote", "retreat", "run", "migrate", "manager", "driver",
    ];
    const missing = dispatchVerbs.filter((v) => !synopsisVerbs.includes(v));
    const extra = synopsisVerbs.filter((v) => !dispatchVerbs.includes(v));
    assert(
      missing.length === 0 && extra.length === 0,
      `quay --help Usage synopsis verb set == dispatch table set (diff=0; missing: ${missing.join(",")}, extra: ${extra.join(",")})`
    );
  }

  // quay -h: alias, also exits 0
  {
    const r = await runImport(["-h"], helpOpts);
    assert(r.status === 0, "quay -h exits 0 (alias for --help)");
    assert(r.stdout.includes("Usage:"), "quay -h output includes 'Usage:'");
  }

  // quay task list --help: exits 0, includes task-list-specific flag docs
  {
    const r = await runImport(["task", "list", "--help"], helpOpts);
    assert(r.status === 0, "quay task list --help exits 0");
    assert(r.stdout.includes("--prefix"), "quay task list --help output mentions --prefix");
    assert(r.stdout.includes("--status"), "quay task list --help output mentions --status");
  }

  // The existing "unknown command" test must still work (--help is not passed).
  {
    const r = await runImport(["bogus-command-that-is-not-help"], helpOpts);
    assert(r.status === 1, "quay <unknown-non-help command> still exits 1 (--help does not break fallback)");
    assert(r.stderr.includes("usage:"), "quay <unknown-non-help command> still prints usage to stderr");
  }
}

// 15. QX-006 (experiment 4, iteration 1): `--prefix` with no value must
//     exit 1 with a clear usage error, not crash with a TypeError.
//     Regression from QX-002 (SH-001). Uses the same fixture workspace as
//     tests 1-12 (envTasksDir has CLI-1 seeded, which is enough to reach
//     the prefix-guard code path).
async function block15(spawnOpts) {
  const r = await runImport(["task", "list", "--prefix"], spawnOpts);
  assert(r.status === 1, "quay task list --prefix (no value) exits 1 (not a TypeError crash)");
  assert(
    r.stderr.includes("--prefix requires a value"),
    `quay task list --prefix (no value) prints a clear usage error to stderr (got: ${JSON.stringify(r.stderr.slice(0, 200))})`
  );
  assert(
    !r.stderr.includes("TypeError"),
    "quay task list --prefix (no value) does NOT produce a TypeError stack trace"
  );
}

// 16. QX-007 (experiment 4, iteration 1): `quay serve --help` and
//     `quay action --help` must exit 0 and produce at least a stub line
//     of output. Previously they exited 0 with no output (UQ-010).
async function block16(spawnOpts) {
  const r1 = await runImport(["serve", "--help"], spawnOpts);
  assert(r1.status === 0, "quay serve --help exits 0");
  assert(
    r1.stdout.trim().length > 0,
    "quay serve --help prints at least some output (not silent)"
  );
  assert(
    r1.stdout.includes("quay --help") || r1.stdout.includes("serve"),
    "quay serve --help output references serve or points to --help"
  );

  const r2 = await runImport(["action", "--help"], spawnOpts);
  assert(r2.status === 0, "quay action --help exits 0");
  assert(
    r2.stdout.trim().length > 0,
    "quay action --help prints at least some output (not silent)"
  );
}

// 17. QX-008 (experiment 4, iteration 2): --sort updated.
//     Closes CB-004 (no sort-by-time on CLI) and CB-012 (--sort updated
//     silently ignored). Uses a fresh isolated workspace with tasks created
//     in a specific time-ordered sequence so sort-by-updated is verifiable.
async function block17() {
  const assert = makeAssert("sort");
  const sortTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-test-sort-tasks-"));
  const sortWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-test-sort-workspace-"));
  fs.mkdirSync(path.join(sortWorkspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(sortWorkspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${sortTasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );

  const sortOpts = { cwd: sortWorkspaceRoot, encoding: "utf8" };
  const SORT_BODY = VALID_SECTIONS + AC_DOD_CHECKED;

  // Create tasks in order: SORT-A, then SORT-B, then SORT-C.
  // Touch each file 100ms apart to ensure distinct mtimes.
  await runNative(["task", "create", "SORT-A", "--title", "Sort A (oldest)",
    "--status", "todo", "--body", SORT_BODY], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: sortTasksDir },
  });
  // Small sleep between creates to ensure distinct mtime.
  const t0 = Date.now(); while (Date.now() - t0 < 50) { /* spin */ }
  await runNative(["task", "create", "SORT-B", "--title", "Sort B (middle)",
    "--status", "todo", "--body", SORT_BODY], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: sortTasksDir },
  });
  const t1 = Date.now(); while (Date.now() - t1 < 50) { /* spin */ }
  await runNative(["task", "create", "SORT-C", "--title", "Sort C (most recent)",
    "--status", "todo", "--body", SORT_BODY], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: sortTasksDir },
  });

  // --sort updated --json: tasks should be sorted by mtime descending (SORT-C first, SORT-A last).
  {
    const r = await run(["task", "list", "--sort", "updated", "--json"], sortOpts);
    assert(r.status === 0, "quay task list --sort updated --json exits 0");
    let tasks;
    try { tasks = JSON.parse(r.stdout); } catch { tasks = null; }
    assert(Array.isArray(tasks), "quay task list --sort updated --json emits a JSON array");
    if (Array.isArray(tasks) && tasks.length === 3) {
      assert(
        tasks[0].id === "SORT-C",
        `quay task list --sort updated: first task is most-recently-created SORT-C (got ${tasks[0]?.id})`
      );
      assert(
        tasks[tasks.length - 1].id === "SORT-A",
        `quay task list --sort updated: last task is oldest SORT-A (got ${tasks[tasks.length - 1]?.id})`
      );
      // Confirm updatedAt field is present and numeric.
      assert(
        tasks.every((t) => typeof t.updatedAt === "number" && t.updatedAt > 0),
        "quay task list --sort updated: all tasks include updatedAt as a positive number (ms)"
      );
    }
  }

  // --sort updated (non-JSON): exits 0, produces tabbed output (not default insertion order).
  {
    const r = await run(["task", "list", "--sort", "updated"], sortOpts);
    assert(r.status === 0, "quay task list --sort updated (non-JSON) exits 0");
    // Tasks are listed in default alphabetical (insertion) order without --sort:
    // SORT-A, SORT-B, SORT-C. With --sort updated, SORT-C should be first.
    const lines = r.stdout.trim().split("\n").filter((l) => !l.startsWith("#") && l.trim());
    assert(
      lines.length === 3 && lines[0].startsWith("SORT-C"),
      `quay task list --sort updated (non-JSON): first line starts with SORT-C (got: ${lines[0]})`
    );
  }

  // CB-012 verification: --sort updated does NOT silently return default
  // (insertion alphabetical) order. Default order would be SORT-A first.
  // Sort-by-updated order has SORT-C first. These differ, so the
  // non-default-equals-updated check above is the live proof.

  fs.rmSync(sortTasksDir, { recursive: true, force: true });
  fs.rmSync(sortWorkspaceRoot, { recursive: true, force: true });
}

// 18. QX-016 (experiment 4, iteration 4): multi-label AND-filter on CLI.
//     --label A --label B should return only tasks that have BOTH labels.
//     Closes CB-013 (CLI last-wins bug: parseFlags() now collects repeated
//     --label flags as an array; filter applies AND-logic).
async function block18() {
  const assert = makeAssert("multilabel");
  const mlTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-multilabel-tasks-"));
  const mlWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-multilabel-workspace-"));
  fs.mkdirSync(path.join(mlWorkspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(mlWorkspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${mlTasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );

  const ML_BODY = VALID_SECTIONS + AC_DOD_CHECKED;
  // MBOTH-1: has both labels "bug" and "cli"
  await runNative(["task", "create", "MBOTH-1", "--title", "Has both labels",
    "--status", "todo", "--body", ML_BODY, "--labels", "bug,cli"], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: mlTasksDir },
  });
  // MBUG-1: has only "bug"
  await runNative(["task", "create", "MBUG-1", "--title", "Has only bug",
    "--status", "todo", "--body", ML_BODY, "--labels", "bug"], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: mlTasksDir },
  });
  // MNONE-1: no labels
  await runNative(["task", "create", "MNONE-1", "--title", "Has no labels",
    "--status", "todo", "--body", ML_BODY], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: mlTasksDir },
  });

  const mlOpts = { cwd: mlWorkspaceRoot, encoding: "utf8" };

  // --label bug --label cli (AND-logic): should return only MBOTH-1
  {
    const r = await run(["task", "list", "--label", "bug", "--label", "cli", "--json"], mlOpts);
    assert(r.status === 0, "quay task list --label bug --label cli exits 0 (multi-label AND-filter, QX-016, CB-013)");
    let tasks;
    try { tasks = JSON.parse(r.stdout); } catch { tasks = null; }
    assert(Array.isArray(tasks) && tasks.some((t) => t.id === "MBOTH-1"),
      "quay task list --label bug --label cli includes MBOTH-1 (has both labels) (QX-016)");
    assert(Array.isArray(tasks) && !tasks.some((t) => t.id === "MBUG-1"),
      "quay task list --label bug --label cli excludes MBUG-1 (has only bug, not cli) (QX-016, CB-013)");
    assert(Array.isArray(tasks) && !tasks.some((t) => t.id === "MNONE-1"),
      "quay task list --label bug --label cli excludes MNONE-1 (no labels) (QX-016)");
  }

  // --label bug (single): should return MBOTH-1 and MBUG-1 (no regression)
  {
    const r = await run(["task", "list", "--label", "bug", "--json"], mlOpts);
    assert(r.status === 0, "quay task list --label bug exits 0 (single-label, no regression, QX-016)");
    let tasks;
    try { tasks = JSON.parse(r.stdout); } catch { tasks = null; }
    assert(Array.isArray(tasks) && tasks.some((t) => t.id === "MBOTH-1"),
      "quay task list --label bug includes MBOTH-1 (QX-016 single-label no regression)");
    assert(Array.isArray(tasks) && tasks.some((t) => t.id === "MBUG-1"),
      "quay task list --label bug includes MBUG-1 (QX-016 single-label no regression)");
  }

  fs.rmSync(mlTasksDir, { recursive: true, force: true });
  fs.rmSync(mlWorkspaceRoot, { recursive: true, force: true });
}

// 19. QX-021 (experiment 4, iteration 5): --search title filter on CLI.
//     --search "foo" returns only tasks with "foo" in title (case-insensitive).
//     --search "" (empty string) or no flag returns all tasks (no filter).
//     Also covers QX-022: non-JSON output includes a timestamp ("ago") column.
//     Closes CB-007 (CLI full-text search) and UQ-004 (CLI timestamp).
async function block19() {
  const assert = makeAssert("search");
  const srchTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-search-tasks-"));
  const srchWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-search-workspace-"));
  fs.mkdirSync(path.join(srchWorkspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(srchWorkspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${srchTasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );

  const ML_BODY = VALID_SECTIONS + AC_DOD_CHECKED;
  // SRCH-1: title contains "bootstrap" (should match --search bootstrap)
  await runNative(["task", "create", "SRCH-1", "--title", "Quay bootstrap task",
    "--status", "todo", "--body", ML_BODY], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: srchTasksDir },
  });
  // SRCH-2: title contains "dashboard" (should NOT match --search bootstrap)
  await runNative(["task", "create", "SRCH-2", "--title", "Dashboard setup",
    "--status", "todo", "--body", ML_BODY], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: srchTasksDir },
  });
  // SRCH-3: title contains "Bootstrap" (case-insensitive should also match --search bootstrap)
  await runNative(["task", "create", "SRCH-3", "--title", "Bootstrap configuration",
    "--status", "done", "--body", ML_BODY], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: srchTasksDir },
  });

  const srchOpts = { cwd: srchWorkspaceRoot, encoding: "utf8" };

  // --search bootstrap: should match SRCH-1 and SRCH-3, not SRCH-2
  {
    const r = await run(["task", "list", "--search", "bootstrap", "--json"], srchOpts);
    assert(r.status === 0, "quay task list --search bootstrap exits 0 (QX-021, CB-007)");
    let tasks;
    try { tasks = JSON.parse(r.stdout); } catch { tasks = null; }
    assert(Array.isArray(tasks) && tasks.some((t) => t.id === "SRCH-1"),
      "quay task list --search bootstrap includes SRCH-1 (title: Quay bootstrap task) (QX-021)");
    assert(Array.isArray(tasks) && tasks.some((t) => t.id === "SRCH-3"),
      "quay task list --search bootstrap includes SRCH-3 (title: Bootstrap configuration, case-insensitive) (QX-021)");
    assert(Array.isArray(tasks) && !tasks.some((t) => t.id === "SRCH-2"),
      "quay task list --search bootstrap excludes SRCH-2 (title: Dashboard setup) (QX-021, CB-007)");
  }

  // --search dashboard: should match only SRCH-2
  {
    const r = await run(["task", "list", "--search", "dashboard", "--json"], srchOpts);
    assert(r.status === 0, "quay task list --search dashboard exits 0 (QX-021)");
    let tasks;
    try { tasks = JSON.parse(r.stdout); } catch { tasks = null; }
    assert(Array.isArray(tasks) && tasks.some((t) => t.id === "SRCH-2"),
      "quay task list --search dashboard includes SRCH-2 (QX-021)");
    assert(Array.isArray(tasks) && !tasks.some((t) => t.id === "SRCH-1"),
      "quay task list --search dashboard excludes SRCH-1 (QX-021)");
  }

  // No --search flag: should return all 3 tasks (no filter applied)
  {
    const r = await run(["task", "list", "--json"], srchOpts);
    assert(r.status === 0, "quay task list (no --search) exits 0 (QX-021 no-filter baseline)");
    let tasks;
    try { tasks = JSON.parse(r.stdout); } catch { tasks = null; }
    assert(Array.isArray(tasks) && tasks.length === 3,
      "quay task list (no --search) returns all 3 tasks (QX-021 no-filter baseline)");
  }

  // QX-022: non-JSON output includes timestamp ("ago") column for tasks with updatedAt.
  // quay-native's store.js sets updatedAt = file mtime, so any created task has it.
  {
    const r = await run(["task", "list"], srchOpts);
    assert(r.status === 0, "quay task list (non-JSON) exits 0 (QX-022, UQ-004)");
    const lines = r.stdout.trim().split("\n").filter((l) => !l.startsWith("#") && l.trim());
    assert(lines.length === 3, `quay task list (non-JSON) returns 3 lines (got ${lines.length}) (QX-022)`);
    // Each task row should have 5 tab-separated fields: id, status, role, title, updated
    const firstLine = lines[0];
    const fields = firstLine.split("\t");
    assert(fields.length === 5, `quay task list (non-JSON) row has 5 tab-separated fields (got ${fields.length}): "${firstLine}" (QX-022, UQ-004)`);
    // The 5th field (timestamp) should contain "ago" or be "—" (null-safe)
    const tsField = fields[4];
    assert(tsField.includes("ago") || tsField === "—",
      `quay task list (non-JSON) 5th field is a relative timestamp or "—" (got: "${tsField}") (QX-022, UQ-004)`);
  }

  // QX-021: --help now documents --search flag
  {
    const r = await run(["--help"], srchOpts);
    assert(r.status === 0, "quay --help exits 0 (QX-021 --help check)");
    assert(r.stdout.includes("--search"), "quay --help output mentions --search flag (QX-021, CB-007)");
  }

  // QX-023 (experiment 4, iteration 6): body search — term in body but NOT in title.
  // SRCH-4: title is "Unrelated title" but body contains "xyzzy-unique-term".
  // --search xyzzy-unique-term must match SRCH-4 (body match) and exclude SRCH-1/2/3.
  {
    const srch4TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-bodysearch-tasks-"));
    const srch4WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-bodysearch-workspace-"));
    fs.mkdirSync(path.join(srch4WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(srch4WorkspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
        `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${srch4TasksDir.replaceAll("\\", "\\\\")}"`,
        "",
      ].join("\n")
    );
    const srch4Opts = { cwd: srch4WorkspaceRoot, encoding: "utf8" };
    // BSRCH-1: unique term ONLY in body, not in title
    const bodyWithUniqueToken = VALID_SECTIONS + "\nxyzzy-unique-term appears here in the body\n" + AC_DOD_CHECKED;
    await runNative(["task", "create", "BSRCH-1", "--title", "Unrelated title",
      "--status", "todo", "--body", bodyWithUniqueToken], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: srch4TasksDir },
    });
    // BSRCH-2: control — term NOT in title or body; must be excluded
    await runNative(["task", "create", "BSRCH-2", "--title", "Other task",
      "--status", "todo", "--body", ML_BODY], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: srch4TasksDir },
    });
    {
      const r = await run(["task", "list", "--search", "xyzzy-unique-term", "--json"], srch4Opts);
      assert(r.status === 0, "quay task list --search body-term exits 0 (QX-023, CB-016)");
      let tasks;
      try { tasks = JSON.parse(r.stdout); } catch { tasks = null; }
      assert(Array.isArray(tasks) && tasks.some((t) => t.id === "BSRCH-1"),
        "quay task list --search body-term includes BSRCH-1 (body match, not title) (QX-023, CB-016)");
      assert(Array.isArray(tasks) && !tasks.some((t) => t.id === "BSRCH-2"),
        "quay task list --search body-term excludes BSRCH-2 (no match) (QX-023, CB-016)");
    }
    // QX-025: zero-result hint (UQ-024) — --search for a term that matches nothing
    // should print a Hint line in non-JSON output.
    {
      const r = await run(["task", "list", "--search", "no-such-term-ever-42z"], srch4Opts);
      assert(r.status === 0, "quay task list --search no-match exits 0 (QX-025, UQ-024)");
      assert(r.stdout.includes("Hint:"),
        "quay task list --search no-match outputs Hint line (QX-025, UQ-024)");
      assert(r.stdout.includes("--label"),
        "quay task list --search no-match Hint mentions --label (QX-025, UQ-024)");
    }
    fs.rmSync(srch4TasksDir, { recursive: true, force: true });
    fs.rmSync(srch4WorkspaceRoot, { recursive: true, force: true });
  }

  fs.rmSync(srchTasksDir, { recursive: true, force: true });
  fs.rmSync(srchWorkspaceRoot, { recursive: true, force: true });
}

// 20. QX-028 (experiment 4, iteration 7): heading-excluded body search (CB-017).
//     --search "Proposal" must NOT match a task whose body is only heading lines.
//     --search "Proposal" MUST match a task with "proposal" in prose (non-heading) content.
//     --search <help-text-check>: --help now says "title/body content" not "title substring".
async function block20() {
  const assert = makeAssert("heading");
  const hdngTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-hdng-tasks-"));
  const hdngWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-hdng-workspace-"));
  fs.mkdirSync(path.join(hdngWorkspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(hdngWorkspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${hdngTasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );
  const hdngOpts = { cwd: hdngWorkspaceRoot, encoding: "utf8" };
  // HDNG-1: body is ONLY heading lines — searching "Proposal" must NOT return this task
  await runNative(["task", "create", "HDNG-1", "--title", "Headings only",
    "--status", "todo", "--body", "## Proposal\n## Plan\n## AC\n## DoD\n"], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: hdngTasksDir },
  });
  // HDNG-2: body has "proposal" in actual prose — must MATCH
  await runNative(["task", "create", "HDNG-2", "--title", "Prose body",
    "--status", "todo", "--body", VALID_SECTIONS + "\nThis task is a proposal for improvement.\n" + AC_DOD_CHECKED], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: hdngTasksDir },
  });
  {
    const r = await run(["task", "list", "--search", "Proposal", "--json"], hdngOpts);
    assert(r.status === 0, "quay task list --search Proposal exits 0 (QX-028, CB-017)");
    let tasks;
    try { tasks = JSON.parse(r.stdout); } catch { tasks = null; }
    assert(Array.isArray(tasks) && !tasks.some((t) => t.id === "HDNG-1"),
      "quay task list --search Proposal excludes HDNG-1 (heading-only body) (QX-028, CB-017)");
    assert(Array.isArray(tasks) && tasks.some((t) => t.id === "HDNG-2"),
      "quay task list --search Proposal includes HDNG-2 (prose contains 'proposal') (QX-028, CB-017)");
  }
  {
    // Verify help text updated (QX-027, UQ-029): "title/body content" not "title substring"
    const rHelp = await run(["--help"], hdngOpts);
    assert(rHelp.status === 0, "quay --help exits 0 (QX-027 doc-staleness check)");
    assert(rHelp.stdout.includes("title/body content"),
      "quay --help mentions 'title/body content' (QX-027, UQ-029)");
    assert(!rHelp.stdout.includes("title substring"),
      "quay --help no longer says 'title substring' (QX-027, UQ-029)");
    assert(rHelp.stdout.includes("in title or body"),
      "quay --help example says 'in title or body' not 'in title' (QX-027, UQ-029)");
  }
  fs.rmSync(hdngTasksDir, { recursive: true, force: true });
  fs.rmSync(hdngWorkspaceRoot, { recursive: true, force: true });
}

// 21. QX-037 (experiment 4, iteration 10): UQ-020 (empty filter result message)
//     and UQ-021 (--label with no value guard).
async function block21() {
  const assert = makeAssert("qx37");
  const qx37TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-qx37-tasks-"));
  const qx37WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-qx37-workspace-"));
  fs.mkdirSync(path.join(qx37WorkspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(qx37WorkspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    tasks_dir: "${qx37TasksDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${qx37TasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );
  const spawnOpts37 = { cwd: qx37WorkspaceRoot, encoding: "utf8" };
  const env37 = { ...process.env, QUAY_NATIVE_TASKS_DIR: qx37TasksDir };

  // Create one ready task (status != done, so filtering by done returns empty)
  await runNative(["task", "create", "QRDY-1",
    "--title", "A ready task",
    "--status", "ready",
    "--labels", "some-label"],
    { env: env37, cwd: qx37WorkspaceRoot });

  // UQ-020: filter by --status done on a workspace with no done tasks → "No tasks found." to stdout
  {
    const r = await run(["task", "list", "--status", "done"], spawnOpts37);
    assert(r.status === 0, "quay task list --status done (no matches) exits 0 (QX-037, UQ-020)");
    assert(r.stdout.includes("No tasks found"), "quay task list --status done prints 'No tasks found' to stdout (QX-037, UQ-020)");
  }

  // UQ-021: --label with no value should exit 1 with usage error
  {
    const r = await run(["task", "list", "--label"], spawnOpts37);
    assert(r.status !== 0, "quay task list --label (no value) exits non-zero (QX-037, UQ-021)");
    assert(r.stderr.includes("--label requires a value"), "quay task list --label (no value) prints usage error to stderr (QX-037, UQ-021)");
  }

  fs.rmSync(qx37TasksDir, { recursive: true, force: true });
  fs.rmSync(qx37WorkspaceRoot, { recursive: true, force: true });
}

// 22. QX-045 (experiment 4, iteration 12): CB-020 — `--prefix X --json` must emit
//     valid JSON (no `# filtered:` comment before the array).
//
//     CB-020 was filed (simulated-user, iteration 11) because the `# filtered: QX-* (N tasks)`
//     comment in non-JSON mode confused automated consumers who may have expected JSON.
//     The `--json` path already routes through printJson() (no comment emitted), but this
//     test regression-locks that invariant so it cannot regress if the branching logic changes.
//
//     Assertions:
//       (a) `--prefix X --json`: stdout is valid JSON with JSON.parse() (no comment line)
//       (b) `--json` without prefix: stdout is valid JSON (baseline)
//       (c) `--prefix X` WITHOUT --json: stdout contains `# filtered:` (human-readable comment preserved)
async function block22() {
  const assert = makeAssert("qx45");
  const qx45TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-qx45-tasks-"));
  const qx45WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-qx45-workspace-"));
  fs.mkdirSync(path.join(qx45WorkspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(qx45WorkspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${qx45TasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );
  const spawnOpts45 = { cwd: qx45WorkspaceRoot, encoding: "utf8" };
  const env45 = { ...process.env, QUAY_NATIVE_TASKS_DIR: qx45TasksDir };

  // Seed two tasks: one with prefix QX, one without
  await runNative(["task", "create", "QX-T1", "--title", "QX prefix task", "--status", "todo"],
    { env: env45 });
  await runNative(["task", "create", "OTHER-1", "--title", "Other prefix task", "--status", "todo"],
    { env: env45 });

  // (a) --prefix QX --json must produce valid JSON (no # filtered: comment)
  {
    const r = await run(["task", "list", "--prefix", "QX", "--json"], spawnOpts45);
    assert(r.status === 0, "quay task list --prefix QX --json exits 0 (QX-045, CB-020)");
    let tasks = null;
    try { tasks = JSON.parse(r.stdout); } catch { tasks = null; }
    assert(
      Array.isArray(tasks),
      `quay task list --prefix QX --json stdout is valid JSON array (no # comment prefix) (QX-045, CB-020). stdout: ${r.stdout.slice(0, 200)}`
    );
    assert(
      tasks !== null && tasks.some((t) => t.id === "QX-T1"),
      "quay task list --prefix QX --json includes QX-T1 (QX-045, CB-020)"
    );
  }

  // (b) --json without prefix: stdout is valid JSON
  {
    const r = await run(["task", "list", "--json"], spawnOpts45);
    assert(r.status === 0, "quay task list --json exits 0 (QX-045 baseline)");
    let tasks = null;
    try { tasks = JSON.parse(r.stdout); } catch { tasks = null; }
    assert(
      Array.isArray(tasks) && tasks.length === 2,
      `quay task list --json (no prefix) is valid JSON with 2 tasks (QX-045, CB-020). got: ${r.stdout.slice(0, 200)}`
    );
  }

  // (c) --prefix QX WITHOUT --json: stdout includes # filtered: comment for human use
  {
    const r = await run(["task", "list", "--prefix", "QX"], spawnOpts45);
    assert(r.status === 0, "quay task list --prefix QX (non-JSON) exits 0 (QX-045 non-json path)");
    assert(
      r.stdout.includes("# filtered:"),
      `quay task list --prefix QX (non-JSON) includes '# filtered:' header for human use (QX-045, CB-020). stdout: ${r.stdout.slice(0, 200)}`
    );
  }

  fs.rmSync(qx45TasksDir, { recursive: true, force: true });
  fs.rmSync(qx45WorkspaceRoot, { recursive: true, force: true });
}

// 23. M08-merge-recover: --version / -V (UQ-047). Real package.json version,
//     exit 0. No provider/workspace needed — this must work from any cwd.
async function block23() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const r1 = await runImport(["--version"]);
  assert(r1.status === 0, "quay --version exits 0");
  assert(r1.stdout.trim() === pkg.version, `quay --version prints the real package.json version (got ${JSON.stringify(r1.stdout.trim())}, expected ${JSON.stringify(pkg.version)})`);

  const r2 = await runImport(["-V"]);
  assert(r2.status === 0, "quay -V exits 0");
  assert(r2.stdout.trim() === pkg.version, `quay -V prints the real package.json version (got ${JSON.stringify(r2.stdout.trim())}, expected ${JSON.stringify(pkg.version)})`);
}

// 24. M08-merge-recover: --format json (CB-021) behaves identically to --json,
//     across content, for both task list (array) and task view (object).
async function block24(spawnOpts) {
  const rJson = await runImport(["task", "list", "--json"], spawnOpts);
  const rFormat = await runImport(["task", "list", "--format", "json"], spawnOpts);
  assert(rFormat.status === 0, "quay task list --format json exits 0");
  assert(rJson.status === 0 && rFormat.status === 0, "both --json and --format json exit 0");
  let jTasks, fTasks;
  try { jTasks = JSON.parse(rJson.stdout); } catch { jTasks = null; }
  try { fTasks = JSON.parse(rFormat.stdout); } catch { fTasks = null; }
  assert(Array.isArray(fTasks), "quay task list --format json emits a JSON array");
  assert(
    JSON.stringify(jTasks) === JSON.stringify(fTasks),
    "quay task list --format json output is identical in content to --json"
  );

  const rViewJson = await runImport(["task", "view", "CLI-1", "--json"], spawnOpts);
  const rViewFormat = await runImport(["task", "view", "CLI-1", "--format", "json"], spawnOpts);
  assert(rViewFormat.status === 0, "quay task view --format json exits 0");
  assert(
    rViewJson.stdout === rViewFormat.stdout,
    "quay task view --format json output is byte-identical to --json"
  );

  // Invalid --format value is a hard usage error, not a silent human-readable fallback.
  const rBadFormat = await runImport(["task", "list", "--format", "yaml"], spawnOpts);
  assert(rBadFormat.status === 1, "quay task list --format yaml (unsupported value) exits 1");
  assert(
    rBadFormat.stderr.includes("--format"),
    "quay task list --format yaml prints a --format usage error to stderr, not a silent human-readable fallback"
  );
}

// 25. M08-merge-recover: --page-size N (CB-006/CB-022) in both CLI table
//     mode and --json/--format json mode — the printJson(sorted) bug fix.
//     Also UQ-048: invalid values (0, -1, abc) are a hard error.
async function block25(spawnOpts) {
  // Baseline: workspace has exactly 2 tasks (CLI-1, CLI-2) at this point.
  const rAllJson = await runImport(["task", "list", "--json"], spawnOpts);
  const allTasks = JSON.parse(rAllJson.stdout);
  assert(allTasks.length === 2, `sanity: workspace has 2 tasks before --page-size test (got ${allTasks.length})`);

  const rPage1 = await runImport(["task", "list", "--json", "--page-size", "1"], spawnOpts);
  assert(rPage1.status === 0, "quay task list --json --page-size 1 exits 0");
  const page1 = JSON.parse(rPage1.stdout);
  assert(
    Array.isArray(page1) && page1.length === 1,
    `quay task list --json --page-size 1 returns exactly 1 task, not the full array (CB-022 printJson bug fix) (got ${page1.length})`
  );
  assert(page1[0].id === allTasks[0].id, "quay task list --json --page-size 1 returns the first task by current sort order");

  const rTablePage1 = await runImport(["task", "list", "--page-size", "1"], spawnOpts);
  assert(rTablePage1.status === 0, "quay task list --page-size 1 (table mode) exits 0");
  const tableLines = rTablePage1.stdout.split("\n").filter((l) => l.includes("\t"));
  assert(tableLines.length === 1, `quay task list --page-size 1 (table mode) prints exactly 1 task row (got ${tableLines.length})`);

  // --page-size larger than the result set: returns everything, no error.
  const rPageBig = await runImport(["task", "list", "--json", "--page-size", "1000"], spawnOpts);
  assert(rPageBig.status === 0, "quay task list --json --page-size 1000 (larger than result set) exits 0");
  assert(JSON.parse(rPageBig.stdout).length === 2, "quay task list --json --page-size 1000 returns all tasks when page-size exceeds total count");

  // UQ-048: invalid --page-size values are a hard error, not a silent "show everything".
  for (const bad of ["0", "-1", "abc"]) {
    const r = await runImport(["task", "list", "--page-size", bad], spawnOpts);
    assert(r.status === 1, `quay task list --page-size ${bad} exits 1 (UQ-048 hard error, not silent fallback)`);
    assert(
      r.stderr.includes("--page-size"),
      `quay task list --page-size ${bad} prints a --page-size usage error to stderr (got: ${r.stderr.slice(0, 200)})`
    );
  }
}

// 26. gap-cli-import-refactor-run-shell-architecture (AC4): GOLDEN-REPLAY
// equivalence. Every command that the run()/shell refactor claims to cover
// must behave byte-identically whether reached through a REAL spawned process
// (`node <QUAY_CLI> ...` — the shell side) or through an import-call of run()
// with ctx.capture (the core side). The spawn side of each pair is ALSO the
// shell-contract derived coverage (D1/D6 --version argv passthrough + exit-code
// mapping — see the shell-contract manifest in cli-run.test.mjs Part D).
async function block26(spawnOpts) {
  const pairs = [
    ["--version", ["--version"]],
    ["--help", ["--help"]],
    ["unknown-command-xyz", ["unknown-command-xyz"]],
    ["task list --json", ["task", "list", "--json"]],
    ["task list --json --page-size 1", ["task", "list", "--json", "--page-size", "1"]],
    ["config validate", ["config", "validate"]],
    // gap-cli-import-command-migration-into-src (AC3): golden-replay for the
    // command handlers migrated from bin/quay.ts's dispatch body into
    // src/cli/<command>.ts. Read-only commands only — a mutating command
    // (task create/edit, complete/promote/retreat, run, migrate, init) would
    // make the second side of the spawn-vs-import pair see mutated state and
    // falsely diverge; those handlers are covered by the serial command-
    // behavior blocks (which exercise the SAME migrated handlers via
    // runImport) plus the verbatim-move guarantee.
    ["task view CLI-1", ["task", "view", "CLI-1"]],
    ["task view CLI-1 --json", ["task", "view", "CLI-1", "--json"]],
    ["task check CLI-1", ["task", "check", "CLI-1"]],
    ["task check CLI-1 --json", ["task", "check", "CLI-1", "--json"]],
    ["action list CLI-1 --json", ["action", "list", "CLI-1", "--json"]],
    ["adr list", ["adr", "list"]],
    ["gate --list", ["gate", "--list"]],
    ["config validate --json", ["config", "validate", "--json"]],
    ["gate-log CLI-1", ["gate-log", "CLI-1"]],
    ["gate-log CLI-1 --json", ["gate-log", "CLI-1", "--json"]],
  ];
  for (const [name, args] of pairs) {
    const [spawned, imported] = await Promise.all([
      run(args, spawnOpts),
      runImport(args, spawnOpts),
    ]);
    const ok =
      spawned.status === imported.status &&
      spawned.stdout === imported.stdout &&
      spawned.stderr === imported.stderr;
    assert(ok, `golden-replay "${name}": spawn vs run() byte-identical (status ${spawned.status}/${imported.status}, stdout ${spawned.stdout.length}/${imported.stdout.length}B, stderr ${spawned.stderr.length}/${imported.stderr.length}B)`);
  }
}

// 27. gap-cli-import-refactor-run-shell-architecture (AC2/AC3): the six
// exported pure helpers from bin/quay.ts, import-called directly (zero
// derivation), closing the Proposal's measured zero-coverage gap
// (parseVerbless / resolveJsonFlag / resolvePageSize / relativeTimeCli).
// Also the D2 shebang-line shell-contract check.
function block27() {
  // parseVerbless — verb-less CLI arg ordering: a LEADING flag must not be
  // misread as the task id (the bug this helper was written to close).
  {
    const { flags, id } = parseVerbless("--gate", ["dod", "ID-1"]);
    assert(flags.gate === "dod", "parseVerbless recovers a leading --gate flag value");
    assert(id === "ID-1", "parseVerbless recovers the positional task id after a leading flag");
  }
  {
    const { flags, id } = parseVerbless("--gate", []);
    assert(flags.gate === true, "parseVerbless: a bare leading boolean flag parses to true");
    assert(id === undefined, "parseVerbless: no positional → id undefined (caller emits usage error)");
  }
  {
    const { id } = parseVerbless(undefined, ["ID-9"]);
    assert(id === "ID-9", "parseVerbless: id-first (no leading flag) still recovers the id");
  }

  // resolveJsonFlag — --format json alias + invalid --format rejection.
  assert(JSON.stringify(resolveJsonFlag({ json: true })) === '{"json":true}', "resolveJsonFlag: --json → { json: true }");
  assert(JSON.stringify(resolveJsonFlag({ format: "json" })) === '{"json":true}', "resolveJsonFlag: --format json → { json: true }");
  assert(JSON.stringify(resolveJsonFlag({ format: "JSON" })) === '{"json":true}', "resolveJsonFlag: --format JSON (case-insensitive) → { json: true }");
  assert(resolveJsonFlag({ format: "yaml" }) === null, "resolveJsonFlag: --format yaml → null (invalid value, caller exits 1)");
  assert(JSON.stringify(resolveJsonFlag({})) === '{"json":false}', "resolveJsonFlag: no flags → { json: false }");

  // resolvePageSize — shared --page-size parser.
  assert(resolvePageSize({}).pageSize === null && resolvePageSize({}).error === null, "resolvePageSize: absent → no limit");
  assert(resolvePageSize({ "page-size": "5" }).pageSize === 5, "resolvePageSize: valid positive integer");
  for (const bad of ["0", "-1", "abc", "1.5"]) {
    const r = resolvePageSize({ "page-size": bad });
    assert(r.pageSize === null && r.error.includes("--page-size"), `resolvePageSize: invalid ${JSON.stringify(bad)} → hard error`);
  }

  // relativeTimeCli — CLI timestamp column.
  const nowStr = relativeTimeCli(Date.now());
  assert(nowStr === "just now" || /^\d+s ago$/.test(nowStr), "relativeTimeCli: now → just now / seconds");
  assert(relativeTimeCli(Date.now() - 30_000) === "30s ago", "relativeTimeCli: 30s ago");
  assert(relativeTimeCli(Date.now() - 3_000_000) === "50m ago", "relativeTimeCli: 50m ago");
  assert(relativeTimeCli(Date.now() - 3_600_000) === "1h ago", "relativeTimeCli: exactly 1h → hours bucket");
  assert(relativeTimeCli(Date.now() - 86_400_000) === "1d ago", "relativeTimeCli: 1d ago");
  assert(relativeTimeCli(Date.now() + 5_000) === "just now", "relativeTimeCli: future → just now (clamped)");

  // parseFlags / stripHeadings — the shared helpers run()'s dispatch relies on.
  {
    const { flags, positional } = parseFlags(["--label", "a", "--label", "b", "pos"]);
    assert(JSON.stringify(flags.label) === '["a","b"]', "parseFlags: repeated --label collects to array (CB-013 fix)");
    assert(positional[0] === "pos", "parseFlags: positional preserved");
  }
  assert(stripHeadings("## Proposal\nhello") === "hello", "stripHeadings: heading lines stripped for search index");

  // D2 shebang-line shell-contract check (AC3).
  const src = fs.readFileSync(path.join(__dirname, "..", "bin", "quay.ts"), "utf8");
  assert(src.startsWith("#!/usr/bin/env node"), "D2: bin/quay.ts shebang line is #!/usr/bin/env node");
}

// 28. gap-quay-usage-line-fallback-drift (AC2): the short fallback usage line in
//     bin/quay.ts (`usage: quay <…>`) had no mechanical guard against drifting from
//     the dispatch table — gap-quay-driver-missing-from-usage-line only patched
//     `driver`, and four real commands/subcommands were still absent (adr / manager
//     arm / action run / config check). This mirrors block14's --help set-equality
//     test but for the fallback line: the EXPECTED command set is derived FROM the
//     dispatch table itself (every `if (cmd === "…")` route + every `cmd && sub`
//     route, parsed out of bin/quay.ts source), plus the two handlers whose
//     subcommands live OUTSIDE the dispatch chain (config validate|check →
//     src/cli/config.ts; manager start|adopt|arm → src/cli/manager.ts). A new
//     command/subcommand added to the dispatch — or one removed but left in the
//     line — without a matching usage-line update turns this RED, so the drift
//     class is closed by construction rather than patched one string at a time.
function block28() {
  const src = fs.readFileSync(path.join(__dirname, "..", "bin", "quay.ts"), "utf8");

  // Expected command set, derived mechanically from the dispatch table.
  const dispatchTopLevel = [...src.matchAll(/if \(cmd === "([a-z][a-z-]*)"/g)].map((m) => m[1]);
  const dispatchSubs = [...src.matchAll(/if \(cmd === "([a-z][a-z-]*)" && sub === "([a-z][a-z-]*)"/g)].map((m) => `${m[1]} ${m[2]}`);
  // config/manager route their subcommands inside their handlers (src/cli/config.ts
  // / src/cli/manager.ts), not via `cmd && sub` routes in quay.ts — so enumerate
  // them here, the same list the fallback line is expected to carry.
  // `server <verb>` joins them: its subcommands live inside src/cli/server.ts (the handler dispatches
  // on `sub` and reports the usage line Served's verb set for anything else), exactly like
  // config/manager — not via `cmd && sub` routes in quay.ts.
  // ⚠️ AC-254 added the three stage-B verbs. They MUST be listed here or this gate reports them as
  // `extra` (present in the usage line, absent from the expected set) — which is the correct
  // behaviour: a verb nobody declared is drift, whether it was added by accident or on purpose.
  const handlerSubs = [
    "config validate",
    "config check",
    "manager start",
    "manager arm",
    "server start",
    "server add",
    "server stop",
    "server status",
  ];
  const expected = new Set([...new Set(dispatchTopLevel), ...dispatchSubs, ...handlerSubs]);

  // Actual command set, parsed out of the fallback usage line's <…> payload.
  const usageMatch = src.match(/usage: quay <([^>]*)>/);
  assert(usageMatch, "bin/quay.ts fallback usage line present (gap-quay-usage-line-fallback-drift)");
  const tokens = usageMatch[1].split("|").map((t) => t.trim());
  const actual = new Set();
  // `task list|view|create|edit|check` carries bare subcommand tokens after the
  // first (`task list`); every other enumerated subcommand is prefixed
  // (`config validate`, `manager arm`, …). Track the bare-parent (only `task`)
  // so a bare token is read as a sub of the right command, not a new top-level.
  const taskSubs = dispatchSubs.filter((s) => s.startsWith("task ")).map((s) => s.slice(5));
  let bareParent = null;
  for (const tok of tokens) {
    const parts = tok.split(/\s+/);
    if (parts.length === 2) {
      actual.add(tok);
      actual.add(parts[0]);
      bareParent = parts[0] === "task" ? parts[0] : null;
    } else if (parts.length === 1) {
      if (bareParent === "task" && taskSubs.includes(parts[0])) {
        actual.add(`task ${parts[0]}`);
      } else {
        actual.add(parts[0]);
        bareParent = parts[0];
      }
    }
  }

  const missing = [...expected].filter((v) => !actual.has(v));
  const extra = [...actual].filter((v) => !expected.has(v));
  assert(
    missing.length === 0 && extra.length === 0,
    `usage fallback command set == dispatch-table command set (missing: ${missing.join(",")}, extra: ${extra.join(",")}) (gap-quay-usage-line-fallback-drift)`
  );

  // AC1: the four gaps this task closes are literally present in the line.
  for (const needle of ["adr", "manager arm", "action run", "config check"]) {
    assert(usageMatch[1].includes(needle), `usage fallback line includes '${needle}' (gap-quay-usage-line-fallback-drift AC1)`);
  }
}

// ── 29. gap-driver-cli-help-hides-four-of-six-kinds: driver 帮助文本的 verb/kind 词表 ─────────────
//   AC3 的机械形态：`quay --help` / `quay driver --help` / `quay driver -h` 实际打印出来的
//   `--kind <…>` 槽位与 `quay driver <…>` verb 槽位，必须【逐值、按序】等于单一真源
//   cli/driver-vocab.ts 的 KINDS/VERBS。⛔ 只断言"包含 6 个 kind"不够——两份手抄副本恰好都同步
//   也能满足它，而那正是本任务要禁的形态（修前 5 处副本取值 2/4/5/6 四种，用户唯一看得到的那份
//   只列 2 个 ⇒ outer/quality/meta/goal 四个已实现的 kind 在产品表层等于不存在）。
//   AC2 的机械形态：driver.ts / help.ts 里不得再出现任何手抄的 kind/verb 联合字面量。
//   ⛔ 不在此处复刻 AC1 的"临时往 KINDS 塞假 kind"负控制：那要就地改产品源码，已作为一次性
//   两态实验留档在任务记录里；这里守的是"派生链没断 + 字面量副本没回来"这两条长期不变式。
async function block29() {
  const assert = makeAssert("driver-help-vocab");

  for (const args of [["--help"], ["driver", "--help"], ["driver", "-h"]]) {
    const label = `quay ${args.join(" ")}`;
    const r = await runImport(args, {});
    assert(r.status === 0, `${label} exits 0 (got ${r.status})`);

    // ⛔ 必须锚在 **driver 那一行**上：顶层帮助里还有 `quay goal list … [--kind <kind>]`，
    // 裸匹配第一个 `--kind <…>` 会拿到 goal 的槽位（实测：got "kind"）。
    const usage = r.stdout.match(/quay driver <([^>]+)> --kind <([^>]+)>/);
    assert(usage !== null, `${label} prints the driver usage line`);
    assert(
      JSON.stringify(usage[1].split("|")) === JSON.stringify([...DRIVER_VERBS_VOCAB]),
      `${label} verb slot == driver-vocab VERBS (got ${usage[1]} / want ${DRIVER_VERBS_VOCAB.join("|")})`
    );
    assert(
      JSON.stringify(usage[2].split("|")) === JSON.stringify([...DRIVER_KINDS_VOCAB]),
      `${label} --kind slot == driver-vocab KINDS (got ${usage[2]} / want ${DRIVER_KINDS_VOCAB.join("|")})`
    );

    // driver 块自己的帮助里每一处 `--kind <…>`（用法行 + 旗标说明）都必须等于 KINDS。
    if (args[0] === "driver") {
      for (const m of r.stdout.matchAll(/--kind <([^>]+)>/g)) {
        assert(
          JSON.stringify(m[1].split("|")) === JSON.stringify([...DRIVER_KINDS_VOCAB]),
          `${label} every --kind slot == driver-vocab KINDS (got ${m[1]})`
        );
      }
    }
  }

  for (const f of ["../src/cli/driver.ts", "../src/cli/help.ts"]) {
    const src = fs.readFileSync(path.join(__dirname, f), "utf8");
    const hits = [...(src.match(/--kind <[a-z-]+\|[a-z|-]+>/g) ?? []), ...(src.match(/quay driver <[a-z|]+>/g) ?? [])];
    assert(hits.length === 0, `${f} carries no hand-copied driver kind/verb union (found: ${hits.join(" ; ") || "none"})`);
  }
}
