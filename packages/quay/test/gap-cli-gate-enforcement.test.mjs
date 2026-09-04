// @test-group product
// M31-cli-gate-enforcement, iteration-0.
//
// `quay task edit <id> --status <x>` writes a status transition
// unconditionally today — no call anywhere in the edit handler to
// `client.taskCheck(id)` / the native provider's `task_check` gate logic
// (confirmed live at packages/quay/bin/quay.js, the `task edit` handler,
// per this milestone's charter). This file demonstrates the gap (RED),
// then closes it (GREEN) with an additive, opt-in `--enforce-gate` flag —
// per the charter's Decision section (option (b) + opt-in (c)-flavored
// escape hatch, NOT hard-block-by-default). See charter:
// experiments/quay-perpetual-stream/charters/M31-cli-gate-enforcement.md.
//
// Scratch-store discipline: every probe here uses its own disposable
// mkdtemp() workspace + QUAY_NATIVE_TASKS_DIR-pointed tasks dir. The real
// repo-root tasks/ directory is never touched by this file.
//
// Run: node --test packages/quay/test/gap-cli-gate-enforcement.test.mjs

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

// Every workspace pair is removed once at the end of this file — the carrier-array + after()
// pattern — so `quay-m31-*` never accumulates a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// Same fixture-workspace convention as gap002-create-ergonomics.test.mjs.
function makeWorkspace(tag) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m31-${tag}-tasks-`));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m31-${tag}-ws-`));
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
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );
  return { workspaceRoot, tasksDir };
}

function runQuay(args, cwd) {
  try {
    const out = execFileSync("node", [quayBin, ...args], { encoding: "utf8", cwd });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

function runNative(args, tasksDir) {
  return execFileSync("node", [nativeBin, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
}

// artifactSections requires each of Proposal/Plan/AC/DoD headings present
// with >= 40 non-whitespace chars of content (store.js MIN_SECTION_CHARS).
const validSections =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";
const acDodChecked =
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";
const acDodUnchecked =
  "## AC\n- [ ] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [ ] a sufficiently long definition-of-done line for the minimum-content check\n";

// ---------------------------------------------------------------------
// Clause 1: a gate-failing transition with --enforce-gate must refuse
// (exit 1, no write), surfacing result.reason.
//
// Fixture: a task in status `ready` with an UNCHECKED AC checkbox. Per
// store.js#check()'s `status === "ready"` branch (execute->done gate),
// this fails with ok:false, reason "0/1 AC checkboxes checked". Editing
// this same task to --status done should be REFUSED under --enforce-gate.
// ---------------------------------------------------------------------
test("RED->GREEN: task edit <id> --status done --enforce-gate refuses when the execute->done gate fails, surfacing result.reason", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("gate-fail");
  runNative(["task", "create", "GATE-FAIL-1", "--title", "Gate-failing fixture",
    "--status", "ready", "--body", validSections + acDodUnchecked], tasksDir);

  // Sanity: `task check` itself reports ok:false for this fixture (confirms
  // the fixture is genuinely gate-failing, not a fixture-construction bug).
  const check = runQuay(["task", "check", "GATE-FAIL-1", "--json"], workspaceRoot);
  const checkResult = JSON.parse(check.stdout);
  assert.equal(checkResult.ok, false, `fixture must genuinely fail task_check; got ${check.stdout}`);

  const r = runQuay(["task", "edit", "GATE-FAIL-1", "--status", "done", "--enforce-gate", "--json"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected refusal (exit!=0) under --enforce-gate; got exit=${r.status}, stdout=${r.stdout}`);
  assert.ok(
    r.stderr.includes(checkResult.reason),
    `expected result.reason ("${checkResult.reason}") surfaced in stderr; got: ${r.stderr}`
  );

  // No write performed: status must still be `ready`, not `done`.
  const after = runQuay(["task", "view", "GATE-FAIL-1", "--json"], workspaceRoot);
  const t = JSON.parse(after.stdout);
  assert.equal(t.status, "ready", `expected no write to have occurred (status still 'ready'); got status=${t.status}`);
});

// ---------------------------------------------------------------------
// Clause 2: a gate-passing transition with --enforce-gate succeeds
// identically to today's unguarded write.
// ---------------------------------------------------------------------
test("task edit <id> --status done --enforce-gate succeeds when the gate passes (identical to unguarded write)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("gate-pass");
  runNative(["task", "create", "GATE-PASS-1", "--title", "Gate-passing fixture",
    "--status", "ready", "--body", validSections + acDodChecked], tasksDir);

  const check = runQuay(["task", "check", "GATE-PASS-1", "--json"], workspaceRoot);
  const checkResult = JSON.parse(check.stdout);
  assert.equal(checkResult.ok, true, `fixture must genuinely pass task_check; got ${check.stdout}`);

  const r = runQuay(["task", "edit", "GATE-PASS-1", "--status", "done", "--enforce-gate", "--json"], workspaceRoot);
  assert.equal(r.status, 0, `expected success under --enforce-gate when gate passes; got exit=${r.status}, stderr=${r.stderr}`);
  const t = JSON.parse(r.stdout);
  assert.equal(t.status, "done", `expected status written to 'done'; got ${JSON.stringify(t)}`);
});

// ---------------------------------------------------------------------
// Clause 3: WITHOUT --enforce-gate, behavior is unchanged from today
// (unguarded) — zero regression to default behavior, against the SAME
// gate-failing fixture from clause 1.
// ---------------------------------------------------------------------
test("task edit <id> --status done WITHOUT --enforce-gate still writes unconditionally (zero regression to default/unguarded behavior)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("gate-fail-default");
  runNative(["task", "create", "GATE-FAIL-2", "--title", "Gate-failing fixture (default path)",
    "--status", "ready", "--body", validSections + acDodUnchecked], tasksDir);

  const check = runQuay(["task", "check", "GATE-FAIL-2", "--json"], workspaceRoot);
  assert.equal(JSON.parse(check.stdout).ok, false, "fixture must genuinely fail task_check");

  const r = runQuay(["task", "edit", "GATE-FAIL-2", "--status", "done", "--json"], workspaceRoot);
  assert.equal(r.status, 0, `expected default (unguarded) behavior to still succeed; got exit=${r.status}, stderr=${r.stderr}`);
  const t = JSON.parse(r.stdout);
  assert.equal(t.status, "done", `expected the unguarded write to have gone through; got ${JSON.stringify(t)}`);
});

// ---------------------------------------------------------------------
// Clause 4: --enforce-gate combined with a non-status patch (e.g.
// --labels only) is a documented no-op guard (no status field in the
// patch => no check performed, write proceeds) — this test locks in
// whichever of the charter's two options (a)/(b) is actually implemented;
// see report for which was chosen and why. This asserts option (b):
// explicit no-op-without-status (check only fires when `status` is in
// the patch).
// ---------------------------------------------------------------------
test("--enforce-gate with a non-status patch (--labels only) is a no-op guard: write proceeds even though the gate would fail", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("gate-nostatus");
  runNative(["task", "create", "GATE-FAIL-3", "--title", "Gate-failing fixture (labels-only edit)",
    "--status", "ready", "--body", validSections + acDodUnchecked], tasksDir);

  const check = runQuay(["task", "check", "GATE-FAIL-3", "--json"], workspaceRoot);
  assert.equal(JSON.parse(check.stdout).ok, false, "fixture must genuinely fail task_check");

  const r = runQuay(["task", "edit", "GATE-FAIL-3", "--labels", "a,b", "--enforce-gate", "--json"], workspaceRoot);
  assert.equal(r.status, 0, `expected --enforce-gate to no-op (no check performed) when no status field is in the patch; got exit=${r.status}, stderr=${r.stderr}`);
  const t = JSON.parse(r.stdout);
  assert.deepEqual(t.labels, ["a", "b"], `expected labels write to have gone through; got ${JSON.stringify(t)}`);
});

// ---------------------------------------------------------------------
// Clause 5: --help text documents both the default-unguarded behavior
// and --enforce-gate.
// ---------------------------------------------------------------------
test("--help documents both default-unguarded task edit status behavior and --enforce-gate", () => {
  const out = execFileSync("node", [quayBin, "--help"], { encoding: "utf8" });
  assert.ok(out.includes("--enforce-gate"), `--help output missing --enforce-gate flag\n---\n${out}`);
  assert.ok(
    /unguard/i.test(out),
    `--help output should document the default-unguarded behavior explicitly (no "unguard..." substring found)\n---\n${out}`
  );
});
