// @test-group product
// gap-task-list-root-does-not-scope-config-lookup — `task list --root <path>`
// must resolve .quay/config.yml from <path>, NOT from the process cwd.
//
// Bug (manager clean repro, tmux v25.2.0): discoverWorkspaceRoot defaults to
// process.cwd(); `--root` was meant to scope the workspace but config
// resolution ignored it — cwd-aligned runs silently used quay's OWN dev-tree
// config, making test results flaky. This file's tests close the four ACs:
//
//   AC1  task list --root <path> resolves config from <path> (not CWD)
//   AC2  --root with no config => fail-closed clear error (no silent CWD fallback)
//   AC3  cwd has config but --root points elsewhere => uses --root's (negative control)
//   AC4  consistent with config validate --root (same resolution semantics)
//
// Every case drives the REAL Core CLI entrypoint (QUAY_CLI — the shipped
// dist/quay.js when fresh, else bin/quay.ts) against disposable native-provider
// workspaces, so the whole config-resolution path is exercised end-to-end.
//
// Run: scripts/test.sh packages/quay/test/task-list-root-scope.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

import { makeTmpDir, makeTmpWorkspace } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// A neutral cwd with NO .quay/config.yml anywhere up the tree. On this box
// os.tmpdir() (/tmp) is a tmpfs with no workspace config, so a command run
// from here with no --root MUST fail — proving any success is --root-driven.
const NEUTRAL_CWD = makeTmpDir(`quay-root-neutral-`);

const VALID_BODY =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n" +
  "## AC\n- [ ] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [ ] a sufficiently long definition-of-done line for the minimum-content check\n";

/** Create a native workspace with one seeded task. Returns { workspaceRoot, taskId }. */
function makeWorkspaceWithTask(tag, taskId) {
  const ws = makeTmpWorkspace(`quay-root-${tag}`, { nativeBin, nativeProviderDir });
  // Seed a task via the native CLI directly (bypasses Core, isolates the store).
  execFileSync("node", [nativeBin, "task", "create", taskId, "--title", `task ${taskId}`, "--status", "todo", "--body", VALID_BODY], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: ws.tasksDir },
  });
  return { workspaceRoot: ws.workspaceRoot, taskId };
}

/** Run the Core CLI, capturing status + stdout + stderr (no throw on non-zero). */
function runQuay(args, cwd) {
  try {
    const stdout = execFileSync("node", [quayBin, ...args], { encoding: "utf8", cwd });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      status: typeof err.status === "number" ? err.status : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err),
    };
  }
}

test("AC1: task list --root <path> resolves config from <path> (not the cwd)", () => {
  const { workspaceRoot, taskId } = makeWorkspaceWithTask("ac1", "AC1-TASK");
  // Run from a NEUTRAL cwd with no config — the only way this lists AC1-TASK is
  // if config resolution started at --root, not at process.cwd().
  const r = runQuay(["task", "list", "--root", workspaceRoot, "--json"], NEUTRAL_CWD);
  assert.equal(r.status, 0, `task list --root should exit 0, got status ${r.status} stderr=${r.stderr}`);
  const tasks = JSON.parse(r.stdout);
  const ids = tasks.map((t) => t.id);
  assert.ok(ids.includes(taskId), `expected ${taskId} in listed tasks, got ${ids.join(",")}`);
});

test("AC2: --root with no config fails closed with a clear error (no silent cwd fallback)", () => {
  // A bare dir with no .quay/config.yml anywhere up the tree.
  const bare = makeTmpDir(`quay-root-bare-`);

  // (a) from a neutral cwd — must fail, not fall back to nothing-silently.
  const rNeutral = runQuay(["task", "list", "--root", bare], NEUTRAL_CWD);
  assert.equal(rNeutral.status, 1, `--root bare dir should exit 1, got ${rNeutral.status}`);
  const all = rNeutral.stdout + " " + rNeutral.stderr;
  assert.match(all, /no \.quay\/config\.yml found under --root/, `error should name --root, got: ${all}`);
  assert.ok(!all.includes("No tasks found."), "must NOT silently list zero tasks");

  // (b) NEGATIVE CONTROL: the cwd HAS a config, but --root points at a bare dir
  //     => must still fail closed, never silently use the cwd's config.
  const { workspaceRoot: cwdWs } = makeWorkspaceWithTask("ac2b", "AC2-CWD");
  const rWithCwdConfig = runQuay(["task", "list", "--root", bare], cwdWs);
  assert.equal(rWithCwdConfig.status, 1, `--root bare dir (cwd has config) should exit 1, got ${rWithCwdConfig.status}`);
  assert.match(
    rWithCwdConfig.stdout + " " + rWithCwdConfig.stderr,
    /no \.quay\/config\.yml found under --root/,
    "cwd config must not be used when --root points at a bare dir"
  );
});

test("AC3: cwd has config but --root points elsewhere => uses --root's (negative control)", () => {
  const a = makeWorkspaceWithTask("ac3a", "AC3-CWD");
  const b = makeWorkspaceWithTask("ac3b", "AC3-ROOT");

  // cwd = workspace A (has config + AC3-CWD), --root = workspace B.
  const r = runQuay(["task", "list", "--root", b.workspaceRoot, "--json"], a.workspaceRoot);
  assert.equal(r.status, 0, `task list --root B from cwd A should exit 0, got ${r.status} stderr=${r.stderr}`);
  const ids = JSON.parse(r.stdout).map((t) => t.id);
  assert.ok(ids.includes(b.taskId), `expected B's ${b.taskId}, got ${ids.join(",")}`);
  assert.ok(!ids.includes(a.taskId), `must NOT use cwd A's config (would list ${a.taskId}), got ${ids.join(",")}`);
});

test("AC4: config validate --root uses the same semantics (no second resolution path)", () => {
  const b = makeWorkspaceWithTask("ac4b", "AC4-ROOT");
  const bare = makeTmpDir(`quay-root-bare4-`);

  // (a) config validate --root <valid ws> from a NEUTRAL cwd => exit 0 / valid.
  const rValid = runQuay(["config", "validate", "--root", b.workspaceRoot], NEUTRAL_CWD);
  assert.equal(rValid.status, 0, `config validate --root <ws> should exit 0, got ${rValid.status} stderr=${rValid.stderr}`);
  assert.match(rValid.stdout, /Config valid\./, `expected 'Config valid.', got: ${rValid.stdout}`);

  // (b) config validate --root <bare> => fail-closed, same message shape as task list.
  const rBare = runQuay(["config", "validate", "--root", bare], NEUTRAL_CWD);
  assert.equal(rBare.status, 1, `config validate --root <bare> should exit 1, got ${rBare.status}`);
  assert.match(
    rBare.stdout + " " + rBare.stderr,
    /no \.quay\/config\.yml found under --root/,
    "config validate --root must fail closed the same way task list does"
  );
});

test("bare --root (no value) is a usage error, not a silent config path", () => {
  const r = runQuay(["task", "list", "--root"], NEUTRAL_CWD);
  assert.equal(r.status, 1, "bare --root should exit 1");
  assert.match(r.stderr + " " + r.stdout, /--root requires a value/, "bare --root should name the missing value");
});
