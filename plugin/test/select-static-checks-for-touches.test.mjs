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
const TEST_SH = path.join(REPO_ROOT, "plugin", "scripts", "runner-static-gate.ts");
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

// A minimal annotated runner-static-gate.ts for hermetic CLI tests — the selector requires a parseable
// run_static_checks() body at <root>/plugin/scripts/runner-static-gate.ts (the registry moved out of
// scripts/test.sh, gap-ac128-hub-split-harness-concerns).
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

// Write the minimal runner-static-gate.ts fixture (with its plugin/scripts/ dir), so a hermetic CLI run
// has a parseable run_static_checks() body at <root>/plugin/scripts/runner-static-gate.ts
// (gap-ac128-hub-split-harness-concerns moved the registry out of scripts/test.sh).
function writeTestSh(root) {
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "scripts", "runner-static-gate.ts"), MINI_TEST_SH);
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
  // NOTE: `capability-catalog` is ALSO a real tier=always registry entry since a37df1c5
  // (superseded-capability-check runs capability-catalog.sh --superseded-check), so it is present
  // in EVERY scoped set. The VIRTUAL AC1c gate (the `--json` mode, gap-capability-catalog-
  // declarations-not-enforced-at-script-creation) is the checker under test here — select by the
  // `--json` command-line marker, not the bare name, to distinguish it from the always-tier entry.
  assert.ok(selected.some((s) => s.name === "capability-catalog" && s.commandLine.includes("--json")),
    `the capability-catalog AC1c --json gate must be selected for a new plugin/scripts touch: ${selected.map((s) => s.name)}`);
  const cc = selected.find((s) => s.name === "capability-catalog" && s.commandLine.includes("--json"));
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
  // Since a37df1c5, capability-catalog is a real tier=always registry entry (superseded-capability-
  // check) and IS selected for every task — the virtual AC1c --json gate is the NEW-file-only
  // checker, so the negative assertion targets the --json gate, not the always-tier entry.
  assert.ok(!selected.some((s) => s.name === "capability-catalog" && s.commandLine.includes("--json")),
    `the capability-catalog AC1c --json gate must NOT be selected when nothing is a new plugin/scripts file: ${selected.map((s) => s.name)}`);
});

t("AC1 — a `(new)`-tagged plugin/scripts touch selects capability-catalog (CLI end-to-end)", async () => {
  const root = makeWorkspace({});
  writeTestSh(root);
  try {
    // A compliant new-script task ALSO authorizes the registration files
    // (gap-new-script-touches-missing-inventory-catalog-registration AC3) — so the CLI selection
    // (which fail-closes on a missing registration) exits 0 and this test exercises the SELECTION.
    writeTask(root, "t-new",
      "## Touches\n- plugin/scripts/ghost-check.sh (new)\n- plugin/scripts/capability-catalog.sh\n- docs/proposals/quay-product-outline.md\n- tasks/t-new.md\n");
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
    writeTask(root, "t-untracked",
      "## Touches\n- plugin/scripts/ghost-check.sh\n- plugin/scripts/capability-catalog.sh\n- docs/proposals/quay-product-outline.md\n- tasks/t-untracked.md\n");
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
  fs.copyFileSync(path.join(REPO_ROOT, "plugin", "scripts", "repo-root.sh"), path.join(root, "plugin", "scripts", "repo-root.sh"));
  fs.writeFileSync(path.join(root, "plugin", "scripts", "ghost-check.sh"),
    "#!/usr/bin/env bash\n# a brand-new checker with no declared question\necho hi\n");
  try {
    writeTask(root, "t-ghost",
      "## Touches\n- plugin/scripts/ghost-check.sh (new)\n- plugin/scripts/capability-catalog.sh\n- docs/proposals/quay-product-outline.md\n- tasks/t-ghost.md\n");
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
  // The real capability-catalog tier=always entry (superseded-capability-check) is always present
  // since a37df1c5; the VIRTUAL AC1c --json gate must NOT be selected for an already-declared script.
  assert.ok(!selected.some((s) => s.name === "capability-catalog" && s.commandLine.includes("--json")),
    `claim-task.sh is already declared — no false positive (no --json gate): ${selected.map((s) => s.name)}`);
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
  assert.ok(!selected.some((s) => s.name === "capability-catalog" && s.commandLine.includes("--json")),
    `capability-catalog.sh itself is an existing tracked script — editing it must not re-trigger the --json gate: ${selected.map((s) => s.name)}`);
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
  assert.ok(!selected.some((s) => s.name === "capability-catalog" && s.commandLine.includes("--json")),
    `a new non-plugin/scripts file must not trigger the catalog --json gate: ${selected.map((s) => s.name)}`);
});

t("AC4 — a glob touch (not a concrete new file) does NOT select capability-catalog", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const { selected } = mod.selectStaticChecksForTouches(
    ["tasks/foo.md", "plugin/scripts/*.sh"],
    registry,
    { newTouches: [] },
  );
  assert.ok(!selected.some((s) => s.name === "capability-catalog" && s.commandLine.includes("--json")),
    `a bare glob is not a concrete new file (no --json gate): ${selected.map((s) => s.name)}`);
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

// ── gap-new-script-touches-missing-inventory-catalog-registration ─────────────────────────────────────
// AC2/AC3/AC4 — dispatch-preflight registration check: a task whose ## Touches declare a NEW
// plugin/scripts file ((new) tag, git-untracked, or the full-width （新：…） marker the repo's real
// new-script Touches use) MUST ALSO authorize the registration files (capability-catalog.sh +
// quay-product-outline.md). Missing ⇒ the scoped static-check selection exits non-zero with
// `touches-missing-registration` (fail-closed: the task cannot pass its own scoped run until its
// Touches authorize the sync products — the 3-instance overstep/stop regression this task closes).

const REG_CATALOG = "plugin/scripts/capability-catalog.sh";
const REG_OUTLINE = "docs/proposals/quay-product-outline.md";

t("AC2 — a new plugin/scripts touch without the registration files ⇒ touches-missing-registration (pure)", async () => {
  const mod = await importMod();
  assert.deepEqual(mod.NEW_SCRIPT_REGISTRATION_REQUIRED, [REG_CATALOG, REG_OUTLINE], "AC3 file list");
  const r = mod.checkTouchesRegistration(
    ["tasks/foo.md", "plugin/scripts/new-check.ts"],
    ["plugin/scripts/new-check.ts"],
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "touches-missing-registration");
  assert.equal(r.newScript, "plugin/scripts/new-check.ts");
  assert.deepEqual(r.missing, [REG_CATALOG, REG_OUTLINE]);
});

t("AC2 — missing registration fails the scoped selection CLI end-to-end (--check-registration / --json / --commands)", async () => {
  const root = makeWorkspace({});
  writeTestSh(root);
  try {
    writeTask(root, "bad-reg", "## Touches\n- plugin/scripts/ghost-check.ts (new)\n- tasks/bad-reg.md\n");
    // --check-registration: the dedicated dispatch-preflight mode, exit 1 + machine JSON.
    const r = runSelCli(root, "--task", "bad-reg", "--check-registration");
    assert.equal(r.status, 1, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.registrationCheck.reason, "touches-missing-registration");
    assert.deepEqual(out.registrationCheck.missing, [REG_CATALOG, REG_OUTLINE]);
    // --json: also exits 1 (fail-closed) and carries registrationCheck for machine consumers.
    const rj = runSelCli(root, "--task", "bad-reg", "--json");
    assert.equal(rj.status, 1, rj.stderr);
    assert.equal(JSON.parse(rj.stdout).registrationCheck.ok, false);
    // --commands: the mode scripts/test.sh's run_scoped_static_checks_sel consumes — a non-zero
    // selector exit is a FATAL gate there, so the scoped run turns red (fail-closed, not silent).
    const rc = runSelCli(root, "--task", "bad-reg", "--commands");
    assert.equal(rc.status, 1);
    assert.match(rc.stderr, /touches-missing-registration/);
    assert.match(rc.stderr, /ghost-check\.ts/);
  } finally {
    cleanup(root);
  }
});

t("AC2 — the full-width （新：…） marker (the repo's REAL annotation form) is a new-script trigger", async () => {
  const root = makeWorkspace({});
  writeTestSh(root);
  try {
    // Instance-2 shape (gap-task-telemetry-6-percent-join): `plugin/scripts/fan-in-runid-check.ts（新：…）`.
    writeTask(root, "fw-reg",
      "## Touches\n- plugin/scripts/fan-in-runid-check.ts（新：runId 存在性检查器）\n- tasks/fw-reg.md\n");
    const r = runSelCli(root, "--task", "fw-reg", "--check-registration");
    assert.equal(r.status, 1, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.registrationCheck.reason, "touches-missing-registration");
    assert.equal(out.registrationCheck.newScript, "plugin/scripts/fan-in-runid-check.ts");
    assert.deepEqual(out.registrationCheck.missing, [REG_CATALOG, REG_OUTLINE]);
  } finally {
    cleanup(root);
  }
});

t("AC3 — a new plugin/scripts touch WITH the registration files in Touches ⇒ ok (the fix for the gap)", async () => {
  const mod = await importMod();
  const r = mod.checkTouchesRegistration(
    ["plugin/scripts/new-check.ts", REG_CATALOG, REG_OUTLINE],
    ["plugin/scripts/new-check.ts"],
  );
  assert.deepEqual(r, { ok: true });
  // CLI end-to-end: a compliant task passes --check-registration AND still emits the scoped commands.
  const root = makeWorkspace({});
  writeTestSh(root);
  try {
    writeTask(root, "ok-reg",
      `## Touches\n- plugin/scripts/new-check.ts (new)\n- ${REG_CATALOG}\n- ${REG_OUTLINE}\n- tasks/ok-reg.md\n`);
    const r0 = runSelCli(root, "--task", "ok-reg", "--check-registration");
    assert.equal(r0.status, 0, r0.stderr);
    assert.equal(JSON.parse(r0.stdout).registrationCheck.ok, true);
    const rc = runSelCli(root, "--task", "ok-reg", "--commands");
    assert.equal(rc.status, 0, rc.stderr);
    assert.match(rc.stdout, /capability-catalog\.sh/, "scoped commands still emitted for a compliant task");
  } finally {
    cleanup(root);
  }
});

t("AC4 — negative controls: no new script, non-bundle new file, and partial registration are judged correctly", async () => {
  const mod = await importMod();
  // No new plugin/scripts file ⇒ ok regardless of whether the registration files are in Touches.
  assert.deepEqual(mod.checkTouchesRegistration(["tasks/foo.md", "plugin/scripts/claim-task.sh"], []), { ok: true });
  // A new file OUTSIDE the plugin bundle is not a registration trigger.
  assert.deepEqual(
    mod.checkTouchesRegistration(["tasks/foo.md", "docs/proposals/exp5-x.md"], ["docs/proposals/exp5-x.md"]),
    { ok: true },
  );
  // Only ONE registration file present ⇒ the OTHER is reported missing (no silent pass).
  const partial = mod.checkTouchesRegistration(
    ["plugin/scripts/new-check.ts", REG_CATALOG],
    ["plugin/scripts/new-check.ts"],
  );
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.missing, [REG_OUTLINE]);
  // An existing (tracked) script edit — no (new) tag, nothing untracked — is not gated (zero impact
  // on non-new-script tasks, AC4).
  const root = makeWorkspace({});
  writeTestSh(root);
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "existing-check.ts"), "export const x = 1;\n");
    gitInit(root);
    spawnSync("git", ["add", "plugin/scripts/existing-check.ts"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: root, encoding: "utf8" });
    writeTask(root, "existing", "## Touches\n- plugin/scripts/existing-check.ts\n- tasks/existing.md\n");
    const r = runSelCli(root, "--task", "existing", "--check-registration");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).registrationCheck.ok, true);
  } finally {
    cleanup(root);
  }
});

t("AC4b — a NEW file under plugin/scripts/checker-mutation-cases/ is a FIXTURE, not a shipped check — no registration required (gap-checker-mutation-cases-4-checkers)", async () => {
  const mod = await importMod();
  // A mutation-case-only task (adds mutation fixtures for ALREADY-registered checkers) must NOT be
  // gated on the catalog/inventory registration files: the capability-catalog derives its check-set
  // from the TOP-LEVEL `ls plugin/scripts/*.{sh,ts,mjs}` glob, so subdir fixtures are never scanned
  // and can never redden the full-suite gate — the registration preflight is a false positive here.
  const fixture = "plugin/scripts/checker-mutation-cases/cap-counts-subagents-check.sh";
  assert.deepEqual(
    mod.checkTouchesRegistration(
      ["tasks/foo.md", fixture],
      [fixture],
    ),
    { ok: true },
    "a mutation-case fixture must not trigger registration",
  );
  // The carve-out is NARROW: a genuinely new TOP-LEVEL shipped script still requires registration.
  const shipped = "plugin/scripts/ghost-check.ts";
  const r = mod.checkTouchesRegistration(["tasks/foo.md", shipped], [shipped]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "touches-missing-registration");
  // End-to-end: a mutation-case-only task passes --check-registration AND --commands.
  const root = makeWorkspace({});
  writeTestSh(root);
  try {
    writeTask(root, "mut-only",
      `## Touches\n- ${fixture} (new)\n- tasks/mut-only.md\n`);
    const rc = runSelCli(root, "--task", "mut-only", "--check-registration");
    assert.equal(rc.status, 0, rc.stderr);
    assert.equal(JSON.parse(rc.stdout).registrationCheck.ok, true);
    const cmd = runSelCli(root, "--task", "mut-only", "--commands");
    assert.equal(cmd.status, 0, cmd.stderr);
    // A mutation-case-only change pulls NO capability-catalog/delivery-inventory scoped gate
    // (those fire on new SHIPPED scripts only) — the fixture itself is not a shipped check.
    assert.doesNotMatch(cmd.stdout, /capability-catalog\.sh --json/, "no AC1c catalog gate for a fixture-only task");
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
