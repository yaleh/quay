// @test-group product
// Stage 3 — Core CLI `quay adr` verbs, exercised end-to-end against a native
// provider whose QUAY_NATIVE_ADR_DIR points at a throwaway dir. ADRs are a
// SEPARATE kind: they must never appear in `quay task list`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
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

// Every workspace triple (tasks + adr + root) is removed once at the end of this file — the
// carrier-array + after() pattern — so `adr-cli-*` never accumulates a /tmp dir per run.
const _workspaces = [];
after(() => {
  for (const ws of _workspaces) {
    fs.rmSync(ws.tasksDir, { recursive: true, force: true });
    fs.rmSync(ws.adrDir, { recursive: true, force: true });
    fs.rmSync(ws.workspaceRoot, { recursive: true, force: true });
  }
});

function makeWorkspace(tag) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `adr-cli-${tag}-tasks-`));
  const adrDir = fs.mkdtempSync(path.join(os.tmpdir(), `adr-cli-${tag}-adr-`));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `adr-cli-${tag}-ws-`));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      `      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );
  const ws = { workspaceRoot, tasksDir, adrDir };
  _workspaces.push(ws);
  return ws;
}

function runQuay(args, cwd) {
  try {
    const out = execFileSync("node", [quayBin, ...args], { encoding: "utf8", cwd });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

test("adr new requires a valid id and a --title", () => {
  const { workspaceRoot } = makeWorkspace("req");
  assert.equal(runQuay(["adr", "new", "ADR-001"], workspaceRoot).status, 1, "missing --title → exit 1");
  const badId = runQuay(["adr", "new", "DEC-1", "--title", "x"], workspaceRoot);
  assert.equal(badId.status, 1, "bad id → provider rejects → exit 1");
});

test("adr new → show → list; accept flips status; supersede links both", () => {
  const { workspaceRoot } = makeWorkspace("flow");
  assert.equal(runQuay(["adr", "new", "ADR-001", "--title", "TDD scope", "--body", "## Decision\nd"], workspaceRoot).status, 0);
  const show = runQuay(["adr", "show", "ADR-001", "--json"], workspaceRoot);
  assert.equal(JSON.parse(show.stdout).status, "proposed");
  // accept
  assert.equal(runQuay(["adr", "accept", "ADR-001"], workspaceRoot).status, 0);
  const accepted = runQuay(["adr", "list", "--status", "accepted", "--json"], workspaceRoot);
  assert.deepEqual(JSON.parse(accepted.stdout).map((a) => a.id), ["ADR-001"]);
  // supersede
  assert.equal(runQuay(["adr", "new", "ADR-002", "--title", "TDD v2", "--body", "## Decision\nd"], workspaceRoot).status, 0);
  assert.equal(runQuay(["adr", "supersede", "ADR-001", "--by", "ADR-002"], workspaceRoot).status, 0);
  assert.equal(JSON.parse(runQuay(["adr", "show", "ADR-001", "--json"], workspaceRoot).stdout).status, "superseded");
  assert.deepEqual(JSON.parse(runQuay(["adr", "show", "ADR-001", "--json"], workspaceRoot).stdout).supersededBy, ["ADR-002"]);
  assert.deepEqual(JSON.parse(runQuay(["adr", "show", "ADR-002", "--json"], workspaceRoot).stdout).supersedes, ["ADR-001"]);
});

test("ADRs never pollute `quay task list` (board separation)", () => {
  const { workspaceRoot } = makeWorkspace("sep");
  runQuay(["adr", "new", "ADR-001", "--title", "a decision", "--body", "## Decision\nd"], workspaceRoot);
  const tasks = runQuay(["task", "list", "--json"], workspaceRoot);
  const ids = JSON.parse(tasks.stdout).map((t) => t.id);
  assert.ok(!ids.includes("ADR-001"), "ADR must not appear in task list");
});
