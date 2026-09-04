// @test-group product
// DIR-039 (A): end-to-end CLI test for `quay migrate --from <p> --to <p>`,
// spawning the REAL bin/quay.js binary (mirrors cli.test.mjs's own
// isolation pattern) against two isolated native provider task stores
// declared in one .quay/config.yml — proves the ABI round-trip through a
// real MCP transport (two simultaneous provider subprocess connections),
// not just the in-process fake-client unit pins in migrate.test.mjs.
//
// The real live `--from github --to native` run against yaleh/archguard
// (DIR-039 AC1) is captured separately in the milestone's ABSORB record
// (a live network + `gh` CLI precondition unsuitable for an unconditional
// automated suite run) — this test pins the MECHANISM (the CLI dispatch,
// the dual-provider-connection plumbing, the migrateTasks() call) using
// two fast, offline, fully isolated native stores instead.
//
// Run: node --test test/cli-migrate.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

// Every workspace triple (source + target + root) is removed once at the end of this file — the
// carrier-array + after() pattern — so `quay-migrate-*` never accumulates a /tmp dir per run.
const _workspaces = [];
after(() => {
  for (const ws of _workspaces) {
    fs.rmSync(ws.sourceTasksDir, { recursive: true, force: true });
    fs.rmSync(ws.targetTasksDir, { recursive: true, force: true });
    fs.rmSync(ws.workspaceRoot, { recursive: true, force: true });
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n" +
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

function run(args, opts = {}) {
  try {
    const out = execFileSync("node", [coreBin, ...args], { encoding: "utf8", ...opts });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

function makeWorkspace() {
  const sourceTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-migrate-source-"));
  const targetTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-migrate-target-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-migrate-workspace-"));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  source-native:",
      "    enabled: true",
      `    path: "${nativeProviderDir}"`,
      `    tasks_dir: "${sourceTasksDir}"`,
      `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${sourceTasksDir}"`,
      "  target-native:",
      "    enabled: false",
      `    path: "${nativeProviderDir}"`,
      `    tasks_dir: "${targetTasksDir}"`,
      `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${targetTasksDir}"`,
      "",
    ].join("\n")
  );
  const ws = { workspaceRoot, sourceTasksDir, targetTasksDir };
  _workspaces.push(ws);
  return ws;
}

test("quay migrate --from --to copies every task from source to target with fidelity", () => {
  const { workspaceRoot, sourceTasksDir } = makeWorkspace();

  execFileSync("node", [
    nativeBin, "task", "create", "SRC-1", "--title", "Source task one",
    "--status", "todo", "--labels", "alpha,beta", "--body", VALID_SECTIONS,
  ], { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: sourceTasksDir } });
  execFileSync("node", [
    nativeBin, "task", "create", "SRC-2", "--title", "Source task two",
    "--status", "done", "--body", "## Proposal\nSecond task body.\n",
  ], { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: sourceTasksDir } });

  const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

  const r = run(["migrate", "--from", "source-native", "--to", "target-native", "--json"], spawnOpts);
  assert.equal(r.status, 0, `quay migrate exits 0 (stderr: ${r.stderr})`);
  const result = JSON.parse(r.stdout);
  assert.equal(result.total, 2, "reports the correct source task count");
  assert.equal(result.migrated.length, 2, "migrated both tasks");
  assert.equal(result.errors.length, 0, "no migration errors");

  // Spot-check: id/title/status/body identical source -> target for SRC-1.
  const viewSource = run(["task", "view", "SRC-1", "--json", "--provider", "source-native"], spawnOpts);
  const viewTarget = run(["task", "view", "SRC-1", "--json", "--provider", "target-native"], spawnOpts);
  assert.equal(viewTarget.status, 0, "SRC-1 exists in the target store after migration");
  const sourceTask = JSON.parse(viewSource.stdout);
  const targetTask = JSON.parse(viewTarget.stdout);
  assert.equal(targetTask.id, sourceTask.id);
  assert.equal(targetTask.title, sourceTask.title);
  assert.equal(targetTask.status, sourceTask.status);
  assert.equal(targetTask.body, sourceTask.body);

  // Target task count matches source's.
  const listTarget = run(["task", "list", "--json", "--provider", "target-native"], spawnOpts);
  const targetTasks = JSON.parse(listTarget.stdout);
  assert.equal(targetTasks.length, 2, "target task count equals source's");
});

test("quay migrate requires both --from and --to", () => {
  const { workspaceRoot } = makeWorkspace();
  const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

  const noFrom = run(["migrate", "--to", "target-native"], spawnOpts);
  assert.equal(noFrom.status, 1);
  assert.match(noFrom.stderr, /--from <providerId> is required/);

  const noTo = run(["migrate", "--from", "source-native"], spawnOpts);
  assert.equal(noTo.status, 1);
  assert.match(noTo.stderr, /--to <providerId> is required/);

  const same = run(["migrate", "--from", "source-native", "--to", "source-native"], spawnOpts);
  assert.equal(same.status, 1);
  assert.match(same.stderr, /must name different providers/);
});

test("quay migrate --from an unknown provider id fails clearly", () => {
  const { workspaceRoot } = makeWorkspace();
  const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };
  const r = run(["migrate", "--from", "nope", "--to", "target-native"], spawnOpts);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no such provider "nope"/);
});
