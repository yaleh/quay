// @test-group governance
// select-static-checks-for-touches.test.mjs —
// gap-capability-catalog-declarations-not-enforced-at-script-creation.
// The capability-catalog AC1c ENTRY-POINT gate (every shipped plugin/scripts check declares what
// QUESTION it makes askable; a NEW script without a declaration is unclassified and the catalog
// exits non-zero) was only enforced at the full-suite verification round — a task that CREATES a
// new plugin/scripts file shipped scoped-green and the catalog turned red only at fan-in (the
// 14-script regression this task closes). This file tests the fix: a task whose `## Touches`
// declare a NEW plugin/scripts file (`(new)` tag, or git-untracked at selection time) pulls the
// capability-catalog check into the SCOPED static tier, so an undeclared new script turns the
// scoped gate red at creation time.
//
// Coverage map (task ACs):
//   AC1 — a task Touches a new plugin/scripts file ⇒ capability-catalog is in the scoped selected set
//   AC2 — that task's new script is NOT in the catalog QUESTION table ⇒ the scoped gate goes RED
//   AC3 — an ALREADY-declared script (claim-task.sh) is touched ⇒ scoped gate stays GREEN (no false positive)
//   AC4 — negative control: ONLY new scripts trigger; existing tracked scripts are not rescanned
//   AC5 — this file is node:test + declares // @test-group governance
//
// Run:
//   scripts/test.sh plugin/test/select-static-checks-for-touches.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SEL_CLI = path.join(REPO_ROOT, "plugin", "scripts", "select-static-checks-for-touches.ts");
const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");
const CATALOG = path.join(REPO_ROOT, "plugin", "scripts", "capability-catalog.sh");

// Governance self-skip (ADR-019 decision #1, same pattern as scoped-static-checks.test.mjs): in a
// DEFAULT (product,engine) run this file reports `skipped`, not absent — QUAY_TEST_GROUPS is set to
// product,engine on the default path, so the real tests run only with `--group governance` or in the
// explicit-file form (QUAY_TEST_GROUPS unset).
const GOV_SKIP_REASON =
  process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")
    ? "set QUAY_TEST_GROUPS=governance to run"
    : false;
function t(name, fn) {
  test(name, GOV_SKIP_REASON ? { skip: GOV_SKIP_REASON } : {}, fn);
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

async function importMod() {
  return import(SEL_CLI);
}

function makeWorkspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sel-capcat-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function writeTask(root, id, body) {
  const f = path.join(root, "tasks", `${id}.md`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `---\nid: ${id}\nstatus: todo\nextra:\n  schema: v1\n---\n\n${body}\n`, "utf8");
}

function runSelCli(root, ...args) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", SEL_CLI, "--root", root, ...args], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

// A minimal annotated scripts/test.sh for hermetic CLI tests — the selector requires a parseable
// run_static_checks() body at <root>/scripts/test.sh.
const MINI_TEST_SH = `#!/usr/bin/env bash
set -euo pipefail
repo_root="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
run_static_checks() {
  echo "== test-framework-policy =="
  # @static-tier change
  # @static-object plugin/test/ packages/*/test/
  bash "\${repo_root}/plugin/scripts/test-framework-policy-check.sh" "\${repo_root}"
  echo "== contract =="
  # @static-tier always
  # @static-scoped-mode subset-touched
  node --no-warnings --experimental-strip-types "\${repo_root}/plugin/scripts/task-contract-check.ts" --root "\${repo_root}"
}
`;

function gitInit(root) {
  const r = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, `git init failed: ${r.stderr}`);
}

// Write the minimal test.sh fixture (with its scripts/ dir), so a hermetic CLI run has a parseable
// run_static_checks() body at <root>/scripts/test.sh.
function writeTestSh(root) {
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "test.sh"), MINI_TEST_SH);
}

// ── AC1: a new plugin/scripts touch selects capability-catalog ────────────────────────────────────────

t("AC1 — a NEW plugin/scripts file in the touches selects capability-catalog (pure function)", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  // A task declaring a NEW plugin/scripts file gets the capability-catalog AC1c gate.
  const { selected } = mod.selectStaticChecksForTouches(
    ["tasks/foo.md", "plugin/scripts/new-helper.sh"],
    registry,
    { newTouches: ["plugin/scripts/new-helper.sh"] },
  );
  assert.ok(selected.some((s) => s.name === "capability-catalog"),
    `capability-catalog must be selected for a new plugin/scripts touch: ${selected.map((s) => s.name)}`);
  const cc = selected.find((s) => s.name === "capability-catalog");
  assert.match(cc.commandLine, /capability-catalog\.sh/, "the selected checker runs the catalog script");
  assert.match(cc.commandLine, /--json/, "the catalog runs in its machine-readable AC1c mode");
  // The emitted command resolves ${repo_root} exactly like every registry command line.
  const cmd = mod.buildCommand(cc, "/tmp/root");
  assert.match(cmd, /^run_checker "capability-catalog" bash "\/tmp\/root\/plugin\/scripts\/capability-catalog\.sh" --json$/);
});

t("AC1 — a task with NO new plugin/scripts touch does NOT select capability-catalog", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const { selected } = mod.selectStaticChecksForTouches(
    ["tasks/foo.md", "plugin/test/foo.test.mjs"],
    registry,
    {},
  );
  assert.ok(!selected.some((s) => s.name === "capability-catalog"),
    `capability-catalog must NOT be selected when nothing is a new plugin/scripts file: ${selected.map((s) => s.name)}`);
});

t("AC1 — a `(new)`-tagged plugin/scripts touch selects capability-catalog (CLI end-to-end)", async () => {
  const root = makeWorkspace({});
  writeTestSh(root);
  try {
    writeTask(root, "t-new", "## Touches\n- plugin/scripts/ghost-check.sh (new)\n- tasks/t-new.md\n");
    const r = runSelCli(root, "--task", "t-new", "--json");
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(out.selected.includes("capability-catalog"),
      `selected must include capability-catalog: ${out.selected}`);
    assert.ok(out.commands.some((c) => /capability-catalog\.sh/.test(c)),
      `commands must include the catalog invocation: ${out.commands}`);
  } finally {
    cleanup(root);
  }
});

t("AC1 — a git-untracked plugin/scripts touch selects capability-catalog even without the (new) tag", async () => {
  const root = makeWorkspace({});
  writeTestSh(root);
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  // The ghost exists on disk but git does not track it (a fresh init, nothing committed).
  fs.writeFileSync(path.join(root, "plugin", "scripts", "ghost-check.sh"), "#!/usr/bin/env bash\necho hi\n");
  gitInit(root);
  try {
    writeTask(root, "t-untracked", "## Touches\n- plugin/scripts/ghost-check.sh\n- tasks/t-untracked.md\n");
    const r = runSelCli(root, "--task", "t-untracked", "--names");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^capability-catalog$/m,
      `an untracked plugin/scripts file is NEW and must select capability-catalog: got ${JSON.stringify(r.stdout)}`);
    // Once committed (tracked), the same touch is an existing script — NOT new, NOT selected.
    spawnSync("git", ["add", "plugin/scripts/ghost-check.sh"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: root, encoding: "utf8" });
    const r2 = runSelCli(root, "--task", "t-untracked", "--names");
    assert.equal(r2.status, 0, r2.stderr);
    assert.ok(!/capability-catalog/.test(r2.stdout),
      `a tracked (existing) script must NOT select capability-catalog: got ${JSON.stringify(r2.stdout)}`);
  } finally {
    cleanup(root);
  }
});

// ── AC2: an undeclared new script ⇒ scoped gate RED ──────────────────────────────────────────────────

t("AC2 — a task declaring a new script NOT in the catalog QUESTION table makes the scoped gate red", async () => {
  const root = makeWorkspace({});
  writeTestSh(root);
  // Build the artifact exactly as the scoped tier would scan it: the REAL catalog + a NEW script
  // that has NO declaration line in the QUESTION table (the ghost).
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.copyFileSync(CATALOG, path.join(root, "plugin", "scripts", "capability-catalog.sh"));
  fs.writeFileSync(path.join(root, "plugin", "scripts", "ghost-check.sh"),
    "#!/usr/bin/env bash\n# a brand-new checker with no declared question\necho hi\n");
  try {
    writeTask(root, "t-ghost", "## Touches\n- plugin/scripts/ghost-check.sh (new)\n- tasks/t-ghost.md\n");
    // The scoped tier emits the catalog command for this task…
    const r = runSelCli(root, "--task", "t-ghost", "--commands");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /capability-catalog\.sh.*--json/,
      `the scoped tier must emit the capability-catalog AC1c gate: ${r.stdout}`);
    // …and the catalog exits NON-ZERO against the undeclared ghost — under `set -e` (test.sh line 137)
    // that aborts the scoped run, so the scoped gate goes RED at creation time (AC2).
    const gate = spawnSync("bash", [path.join(root, "plugin", "scripts", "capability-catalog.sh"), "--json"], {
      encoding: "utf8",
    });
    assert.notEqual(gate.status, 0, "an undeclared new script must make the catalog exit non-zero (AC1c gate red)");
    const rows = JSON.parse(gate.stdout);
    const ghost = rows.find((x) => x.file === "ghost-check.sh");
    assert.ok(ghost, "the undeclared script is enumerated");
    assert.equal(ghost.question, null, "the undeclared script has question: null");
  } finally {
    cleanup(root);
  }
});

// ── AC3: an already-declared script ⇒ scoped gate GREEN (no false positive) ──────────────────────────

t("AC3 — a task touching an ALREADY-declared script (claim-task.sh) does NOT select capability-catalog", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  // claim-task.sh is a tracked, declared script — a task editing it must not be gated by the catalog.
  const { selected } = mod.selectStaticChecksForTouches(
    ["tasks/foo.md", "plugin/scripts/claim-task.sh"],
    registry,
    {}, // no newTouches — nothing in this change is a NEW script
  );
  assert.ok(!selected.some((s) => s.name === "capability-catalog"),
    `claim-task.sh is already declared — no false positive: ${selected.map((s) => s.name)}`);
  // And claim-task.sh genuinely IS declared in the real catalog (the AC3 precondition).
  const src = fs.readFileSync(CATALOG, "utf8");
  assert.match(src, /\[claim-task\.sh\]=/, "claim-task.sh must have a QUESTION-table entry (AC3 precondition)");
});

t("AC3 — a task touching the catalog's own script file does NOT select capability-catalog (self is existing)", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const { selected } = mod.selectStaticChecksForTouches(
    ["tasks/foo.md", "plugin/scripts/capability-catalog.sh"],
    registry,
    {},
  );
  assert.ok(!selected.some((s) => s.name === "capability-catalog"),
    `capability-catalog.sh itself is an existing tracked script — editing it must not re-trigger the scan: ${selected.map((s) => s.name)}`);
});

// ── AC4: negative control — only NEW plugin/scripts files trigger; zero impact on existing artifact ──

t("AC4 — a `(new)` touch OUTSIDE plugin/scripts does NOT select capability-catalog", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const { selected } = mod.selectStaticChecksForTouches(
    ["tasks/foo.md", "docs/proposals/exp5-x.md"],
    registry,
    { newTouches: ["docs/proposals/exp5-x.md"] },
  );
  assert.ok(!selected.some((s) => s.name === "capability-catalog"),
    `a new non-plugin/scripts file must not trigger the catalog: ${selected.map((s) => s.name)}`);
});

t("AC4 — a glob touch (not a concrete new file) does NOT select capability-catalog", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const { selected } = mod.selectStaticChecksForTouches(
    ["tasks/foo.md", "plugin/scripts/*.sh"],
    registry,
    { newTouches: [] },
  );
  assert.ok(!selected.some((s) => s.name === "capability-catalog"),
    `a bare glob is not a concrete new file: ${selected.map((s) => s.name)}`);
});

t("AC4 — isGitUntracked unit: false for non-git, false for tracked, true for an on-disk untracked file", async () => {
  const mod = await importMod();
  const root = makeWorkspace({});
  try {
    // Non-git workspace → false (the (new) tag is the signal there).
    assert.equal(mod.isGitUntracked(root, "plugin/scripts/foo.sh"), false);
    // A non-existent path → false.
    assert.equal(mod.isGitUntracked(root, "plugin/scripts/nope.sh"), false);
    // In a real git repo: an on-disk untracked file → true; a committed file → false.
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "untracked-ghost.sh"), "x\n");
    fs.writeFileSync(path.join(root, "plugin", "scripts", "tracked-existing.sh"), "x\n");
    gitInit(root);
    spawnSync("git", ["add", "plugin/scripts/tracked-existing.sh"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: root, encoding: "utf8" });
    assert.equal(mod.isGitUntracked(root, "plugin/scripts/untracked-ghost.sh"), true);
    assert.equal(mod.isGitUntracked(root, "plugin/scripts/tracked-existing.sh"), false);
  } finally {
    cleanup(root);
  }
});

// ── AC5: this file is node:test + @test-group governance (self-evident) ──────────────────────────────

t("AC5 — this test file is node:test with a governance @test-group", () => {
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /from "node:test"/, "imports node:test");
  assert.match(src, /^\/\/ @test-group governance/m, "declares @test-group governance");
});
