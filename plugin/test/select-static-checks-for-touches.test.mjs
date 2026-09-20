// @test-group engine
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
//   AC5 — this file is node:test + declares // @test-group engine
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

function t(name, fn) {
  test(name, fn);
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
      "## Touches\n- plugin/scripts/ghost-check.sh (new)\n- plugin/scripts/capability-catalog-declarations.json\n- docs/proposals/quay-product-outline.md\n- tasks/t-new.md\n");
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
      "## Touches\n- plugin/scripts/ghost-check.sh\n- plugin/scripts/capability-catalog-declarations.json\n- docs/proposals/quay-product-outline.md\n- tasks/t-untracked.md\n");
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
  // Build the artifact exactly as the scoped tier would scan it: the REAL catalog (entry + renderer +
  // declaration data) + a NEW script that has NO declaration entry in the QUESTION table (the ghost).
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.copyFileSync(CATALOG, path.join(root, "plugin", "scripts", "capability-catalog.sh"));
  fs.copyFileSync(path.join(REPO_ROOT, "plugin", "scripts", "repo-root.sh"), path.join(root, "plugin", "scripts", "repo-root.sh"));
  fs.copyFileSync(path.join(REPO_ROOT, "plugin", "scripts", "repo-root.ts"), path.join(root, "plugin", "scripts", "repo-root.ts"));
  fs.copyFileSync(path.join(REPO_ROOT, "plugin", "scripts", "capability-catalog.ts"),
    path.join(root, "plugin", "scripts", "capability-catalog.ts"));
  fs.copyFileSync(path.join(REPO_ROOT, "plugin", "scripts", "capability-catalog-declarations.json"),
    path.join(root, "plugin", "scripts", "capability-catalog-declarations.json"));
  fs.writeFileSync(path.join(root, "plugin", "scripts", "ghost-check.sh"),
    "#!/usr/bin/env bash\n# a brand-new checker with no declared question\necho hi\n");
  try {
    writeTask(root, "t-ghost",
      "## Touches\n- plugin/scripts/ghost-check.sh (new)\n- plugin/scripts/capability-catalog-declarations.json\n- docs/proposals/quay-product-outline.md\n- tasks/t-ghost.md\n");
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
  // And claim-task.sh genuinely IS declared in the real catalog (the AC3 precondition) — in the
  // declaration DATA, which is where the QUESTION table lives since gap-arch-catalog-declarations-
  // leave-bash.
  const decls = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, "plugin", "scripts", "capability-catalog-declarations.json"), "utf8"));
  assert.ok(decls.QUESTION["claim-task.sh"], "claim-task.sh must have a QUESTION-table entry (AC3 precondition)");
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
// new-script Touches use) MUST ALSO authorize the registration file — which is the catalog's
// DECLARATION DATA file, not the .sh entry (gap-arch-catalog-declarations-leave-bash moved the
// tables into data). Missing ⇒
// the scoped static-check selection exits non-zero with `touches-missing-registration` (fail-closed:
// the task cannot pass its own scoped run until its Touches authorize the sync product — the
// 3-instance overstep/stop regression this task closes). The former SECOND registration file
// (docs/proposals/quay-product-outline.md §6 DELIVERY-INVENTORY snapshot) is RETIRED
// (gap-delivery-inventory-check-time-computation): the inventory is computed at check time.

const REG_CATALOG = "plugin/scripts/capability-catalog-declarations.json";

t("AC2 — a new plugin/scripts touch without the registration files ⇒ touches-missing-registration (pure)", async () => {
  const mod = await importMod();
  assert.deepEqual(mod.NEW_SCRIPT_REGISTRATION_REQUIRED, [REG_CATALOG], "AC3 file list");
  const r = mod.checkTouchesRegistration(
    ["tasks/foo.md", "plugin/scripts/new-check.ts"],
    ["plugin/scripts/new-check.ts"],
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "touches-missing-registration");
  assert.equal(r.newScript, "plugin/scripts/new-check.ts");
  assert.deepEqual(r.missing, [REG_CATALOG]);
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
    assert.deepEqual(out.registrationCheck.missing, [REG_CATALOG]);
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
    assert.deepEqual(out.registrationCheck.missing, [REG_CATALOG]);
  } finally {
    cleanup(root);
  }
});

t("AC3 — a new plugin/scripts touch WITH the registration file in Touches ⇒ ok (the fix for the gap)", async () => {
  const mod = await importMod();
  const r = mod.checkTouchesRegistration(
    ["plugin/scripts/new-check.ts", REG_CATALOG],
    ["plugin/scripts/new-check.ts"],
  );
  assert.deepEqual(r, { ok: true });
  // CLI end-to-end: a compliant task passes --check-registration AND still emits the scoped commands.
  const root = makeWorkspace({});
  writeTestSh(root);
  try {
    writeTask(root, "ok-reg",
      `## Touches\n- plugin/scripts/new-check.ts (new)\n- ${REG_CATALOG}\n- tasks/ok-reg.md\n`);
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
  // A NEW script authorized with only an UNRELATED file ⇒ the registration file is still reported
  // missing (no silent pass).
  const partial = mod.checkTouchesRegistration(
    ["plugin/scripts/new-check.ts", "docs/proposals/exp5-x.md"],
    ["plugin/scripts/new-check.ts"],
  );
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.missing, [REG_CATALOG]);
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

// ── AC1 (gap-classify-delta-registry-path-layout-aware): the registry lookup is LAYOUT-AWARE ─────────
// `package.sh` stages the source `plugin/` INTO `packages/quay/plugin/` and `npm pack` ships that dir as
// the package's `plugin/`, so the INSTALLED plugin root carries `scripts/` DIRECTLY — there is no nested
// `plugin/` layer under it. The lookup used to join the single rel literal
// `plugin/scripts/runner-static-gate.ts`, so `<pluginroot>/plugin/scripts/…` never existed in any
// install ⇒ exit 2 ⇒ `--classify-delta` could not judge a non-empty delta in ANY third-party project ⇒
// the fan-in suite-certificate gate refused every non-flip delta and burned full suites. The fix is a
// candidate LIST (`REGISTRY_REL_CANDIDATES`): the dev layout FIRST (so the source tree's own registry
// still wins and existing behavior is unchanged), the packaged layout as the fallback.
//
// Single variable across the three cases: WHICH layout carries the registry. Case ③ is the negative
// control — without it, "exit 0" could be produced by a fabricated verdict rather than by a registry
// file, and case ② proves PROVENANCE (the registry actually READ is the one at `<root>/scripts/`) by
// matching a marker only that copy carries, not merely by exit code.

/** The dev fixture registry with a MARKER checker name (`task-contract-check` → `shipped-fallback-probe`)
 *  so `--list` output identifies WHICH copy was read, not merely that a registry was. */
const FALLBACK_REGISTRY = MINI_TEST_SH.replace(/task-contract-check/g, "shipped-fallback-probe");

/** Write a registry at `<root>/scripts/runner-static-gate.ts` — the PACKAGED layout (no `plugin/` layer). */
function writePackagedRegistry(root, content) {
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "runner-static-gate.ts"), content);
}

t("AC1 — the registry lookup accepts the PACKAGED layout (<root>/scripts/…) as well as the dev layout", () => {
  // ① BOTH layouts carry a registry ⇒ the `<root>/plugin/scripts/…` copy WINS (priority order ⇒ the
  //    dev/source tree's own registry is never shadowed by the shipped fallback).
  const both = makeWorkspace({});
  writeTestSh(both);
  writePackagedRegistry(both, FALLBACK_REGISTRY);
  const rBoth = runSelCli(both, "--list");
  assert.equal(rBoth.status, 0, `the dev layout must still resolve: ${rBoth.stderr}`);
  assert.match(rBoth.stdout, /test-framework-policy-check/, "① the dev registry was read");
  assert.ok(!/shipped-fallback-probe/.test(rBoth.stdout),
    `⛔ priority: <root>/plugin/scripts/… must win when both layouts carry a registry:\n${rBoth.stdout}`);

  // ② ONLY `<root>/scripts/runner-static-gate.ts` — the shipped layout this defect is about.
  const pkg = makeWorkspace({});
  writePackagedRegistry(pkg, FALLBACK_REGISTRY);
  assert.ok(!fs.existsSync(path.join(pkg, "plugin")), "fixture premise: the packaged layout has NO `plugin/` layer");
  const rPkg = runSelCli(pkg, "--list");
  assert.equal(rPkg.status, 0, `the packaged layout must resolve (pre-fix this was exit 2): ${rPkg.stderr}`);
  assert.match(rPkg.stdout, /shipped-fallback-probe/,
    `⛔ provenance: the registry READ must be the one at <root>/scripts/ (exit 0 alone could be faked):\n${rPkg.stdout}`);

  // ③ NEITHER layout carries a registry ⇒ exit 2, the ORIGINAL wording, and NO registry-derived output
  //    (hard rule 3b: a lookup that cannot read its input must not return a verdict-shaped value).
  const none = makeWorkspace({});
  const rNone = runSelCli(none, "--list");
  assert.equal(rNone.status, 2, "no registry under any layout must stay fail-closed (exit 2), never 0");
  assert.equal(rNone.stdout.trim(), "", "⛔ an unresolvable registry must not emit a registry-derived listing");
  // The wording is a CONTRACT: the fan-in gate's own assertions match this exact substring.
  assert.match(rNone.stderr, /registry file \(runner-static-gate\.ts\) not found/,
    `the pre-existing wording must survive (ff-merge's classifyDeltaVerdict assertions match on it): ${rNone.stderr}`);
});

// ── gap-checker-mutation-check-has-no-change-tier-companion ────────────────────────────────────────
// The full-tier `checker-mutation-check` (the whole-store meta-check on the checkers THEMSELVES) is
// DEFERRED out of scoped runs, so a task that edits a checker and breaks its mutation case shipped
// scoped-green while an UNRELATED task's fan-in went red — 8 measured fan-in static-gate failures
// (`.quay/verification-round.jsonl`, `STATIC_CHECK_FAILED: checker-mutation-check`), the last at
// 2026-09-13T04:41:32Z. The fix registers a CHANGE-TIER companion — the SAME script in
// `--check-changed` mode — whose judgment domain is THIS delta's checker carriers. These tests pin
// the SELECTION half against the REAL registry, and every assertion has an injected inconsistency
// that flips it red (the DoD's "注入不一致即红" control). The RUNNER half (does a broken mutation case
// actually go red?) is pinned by checker-mutation-cases/checker-mutation-check.sh and by the live
// readings recorded in the task body's readings section.

const COMPANION_NAME = "checker-mutation-check";
const COMPANION_FLAG = "--check-changed";
// The manifest sources whose change can add a NEW registered checker (⇒ the companion re-verifies
// manifest-wide coverage there too).
const COMPANION_CARRIERS = [
  "plugin/scripts/checker-mutation-check.sh",
  "plugin/scripts/checker-mutation-cases/provider-binding-resolvability-check.sh",
  "plugin/scripts/runner-static-gate.ts",
  "scripts/test.sh",
];
const COMPANION_NON_CARRIERS = [
  "plugin/scripts/repo-root.ts",
  "docs/proposals/x.md",
  "packages/quay/src/serve.ts",
];

/**
 * The selection invariant the companion must satisfy, as a re-runnable predicate over ANY parsed
 * registry — so the same function that asserts the real registry can be fed an injected-inconsistency
 * variant and must report NOT ok (a criterion that cannot be fed a failing input is not a test).
 * @returns {{ok:boolean, reasons:string[]}}
 */
function companionInvariant(mod, registry) {
  const reasons = [];
  const comp = registry.filter((c) => c.name === COMPANION_NAME && c.commandLine.includes(COMPANION_FLAG));
  const full = registry.filter((c) => c.name === COMPANION_NAME && !c.commandLine.includes(COMPANION_FLAG));
  if (comp.length !== 1) reasons.push(`expected exactly 1 ${COMPANION_FLAG} entry for ${COMPANION_NAME}, got ${comp.length}`);
  if (full.length !== 1) reasons.push(`expected exactly 1 whole-store entry for ${COMPANION_NAME}, got ${full.length}`);
  if (comp.length === 1) {
    if (comp[0].tier !== "change") reasons.push(`companion tier must be "change" (else it is deferred again), got "${comp[0].tier}"`);
    for (const p of COMPANION_CARRIERS) {
      if (!comp[0].objects.some((o) => mod.matchesObject(o, p))) reasons.push(`companion @static-object must cover the carrier ${p}`);
    }
    for (const p of COMPANION_NON_CARRIERS) {
      if (comp[0].objects.some((o) => mod.matchesObject(o, p))) reasons.push(`companion @static-object must NOT cover the non-carrier ${p} (it would become an always-tier check)`);
    }
  }
  if (full.length === 1 && full[0].tier !== "full") {
    reasons.push(`the whole-store entry must stay tier "full" (deferred ≠ dropped), got "${full[0].tier}"`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Apply one injected inconsistency to the REAL registry source (anchored, so the mutant is the
 *  intended one and not a mis-aimed replace). Returns the mutated source. */
function injectCompanionInconsistency(src, kind) {
  const objLine = "  # @static-object plugin/scripts/runner-static-gate.ts scripts/test.sh plugin/scripts/checker-mutation-check.sh plugin/scripts/checker-mutation-cases/ .github/workflows/";
  const tierLine = "  # @static-tier change\n" + objLine;
  assert.ok(src.includes(tierLine), "the companion's annotation block must be found verbatim (the injection anchor)");
  if (kind === "tier-full") {
    // The 8th-recurrence defect restored: the companion is deferred again, so the changer's own gate
    // never runs it.
    return src.replace(tierLine, "  # @static-tier full\n" + objLine);
  }
  if (kind === "object-widened") {
    // The other failure mode: the object widened until the companion fires for every task — it would
    // silently become an always-tier check and put the 55.6s whole-store pass on every task.
    return src.replace(objLine, "  # @static-object plugin/scripts/");
  }
  if (kind === "full-tier-removed") {
    // SACRIFICE the whole-store兜底 — the deferred-not-dropped design forbids it.
    return src.replace(
      '  run_checker "checker-mutation-check" bash "${repo_root}/plugin/scripts/checker-mutation-check.sh" --check\n',
      "",
    );
  }
  throw new Error(`unknown injection kind ${kind}`);
}

t("companion — the real registry satisfies the change-tier companion invariant", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const inv = companionInvariant(mod, registry);
  assert.ok(inv.ok, `companion invariant violated: ${inv.reasons.join("; ")}`);
});

t("companion — the FULL-tier registration and its @static-tier full comment are byte-unchanged (AC4)", async () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // The full-tier block is deferred, never dropped: its tier comment AND its command line must be
  // present verbatim and contiguous. Deleting or downgrading either one reds this test.
  const block = "  # @static-tier full  (the ~13s meta-check on the checkers THEMSELVES — deferred to the full-suite gate)\n"
    + '  run_checker "checker-mutation-check" bash "${repo_root}/plugin/scripts/checker-mutation-check.sh" --check\n';
  assert.ok(src.includes(block), "the full-tier checker-mutation-check block (tier comment + runner line) must be byte-unchanged");
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(src);
  const full = registry.filter((c) => c.name === COMPANION_NAME && !c.commandLine.includes(COMPANION_FLAG));
  assert.equal(full.length, 1, "exactly one whole-store entry must remain registered");
  assert.equal(full[0].tier, "full", "the whole-store entry must stay tier=full");
  assert.equal(
    full[0].commandLine,
    'run_checker "checker-mutation-check" bash "${repo_root}/plugin/scripts/checker-mutation-check.sh" --check',
    "the whole-store entry's command line must be byte-unchanged",
  );
});

t("companion — injected inconsistencies each red the invariant (falsifiability control)", async () => {
  const mod = await importMod();
  const src = fs.readFileSync(TEST_SH, "utf8");
  for (const kind of ["tier-full", "object-widened", "full-tier-removed"]) {
    const mutated = injectCompanionInconsistency(src, kind);
    assert.notEqual(mutated, src, `injection ${kind} must actually change the source`);
    const inv = companionInvariant(mod, mod.parseStaticCheckRegistry(mutated));
    assert.equal(inv.ok, false, `injection ${kind} must red the invariant, but it stayed green`);
  }
});

t("companion — scoped selection: fires on a checker carrier, silent on a non-carrier", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const hasCompanion = (r) => r.selected.some((s) => s.name === COMPANION_NAME && s.commandLine.includes(COMPANION_FLAG));
  const compOf = (r) => r.selected.find((s) => s.name === COMPANION_NAME && s.commandLine.includes(COMPANION_FLAG));

  // POSITIVE: a delta that edits a checker (or its mutation case, or the registry) selects it.
  for (const touch of COMPANION_CARRIERS) {
    const r = mod.selectStaticChecksForTouches(["tasks/x.md", touch], registry);
    assert.ok(hasCompanion(r), `a delta touching ${touch} must select the companion: ${r.selected.map((s) => s.name)}`);
    assert.match(compOf(r).commandLine, /--check-changed/, "the selected command must be the narrowed mode");
  }
  // NEGATIVE (AC2): a delta that carries no checker carrier selects NOTHING of the sort — the
  // companion must not become an always-tier check paying the whole-store cost on every task.
  for (const touch of COMPANION_NON_CARRIERS) {
    const r = mod.selectStaticChecksForTouches(["tasks/x.md", touch], registry);
    assert.ok(!hasCompanion(r), `a delta touching ${touch} must NOT select the companion: ${r.selected.map((s) => s.name)}`);
  }
  // The whole-store entry is DEFERRED in every scoped set (it never appears as a selected command).
  const r = mod.selectStaticChecksForTouches(["tasks/x.md", COMPANION_CARRIERS[0]], registry);
  assert.ok(!r.selected.some((s) => s.commandLine.includes("--check-changed") && !s.commandLine.includes("--repo-root")), "no accidentally-renamed entry");
  assert.ok(r.deferred.includes(COMPANION_NAME), `the whole-store entry must be deferred in scoped mode: ${r.deferred}`);
});

t("companion — the CLI's --list tier/object parse agrees with the pure parse (DoD control)", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const comp = registry.find((c) => c.name === COMPANION_NAME && c.commandLine.includes(COMPANION_FLAG));
  const rows = runSelCli(REPO_ROOT, "--list").stdout.split("\n")
    .filter((l) => l.startsWith("change\t") || l.startsWith("full\t"))
    .map((l) => l.split("\t"))
    .map(([tier, rest]) => [tier, (rest ?? "").replace(/\s*\[.*$/, "").replace(/\s*\(.*\)$/, ""), rest ?? ""])
    .filter(([, n]) => n === COMPANION_NAME);
  assert.equal(rows.length, 2, `the CLI --list must show BOTH registrations of ${COMPANION_NAME}: ${JSON.stringify(rows)}`);
  const changeRow = rows.find((r) => r[0] === "change");
  assert.ok(changeRow, `one --list row must be change-tier: ${JSON.stringify(rows)}`);
  // Same objects, same order, as the pure parse (the CLI and the library read ONE source).
  const listedObjects = (changeRow[2].match(/\[(.*)\]\s*$/) ?? [, ""])[1].split(", ").filter(Boolean);
  assert.deepEqual(listedObjects, comp.objects, "the --list object list must agree with the parsed registry");
  // Parity with the emitted command, not just the name.
  const cmd = runSelCli(REPO_ROOT, "--touches", "plugin/scripts/checker-mutation-check.sh", "--commands");
  assert.equal(cmd.status, 0, cmd.stderr);
  assert.equal((cmd.stdout.match(/--check-changed/g) ?? []).length, 1, `exactly one --check-changed command must be emitted: ${cmd.stdout}`);
});

// ── AC5: this file is node:test + @test-group engine (self-evident) ──────────────────────────────

t("AC5 — this test file is node:test with an engine @test-group", () => {
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /from "node:test"/, "imports node:test");
  assert.match(src, /^\/\/ @test-group engine/m, "declares @test-group engine");
});
