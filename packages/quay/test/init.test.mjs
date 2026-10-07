// @test-group product
// DIR-098: quay init tests — RED->GREEN per ADR-001.
//
// Tests cover AC1-AC6 from the task's Acceptance Criteria.
// Run: node --test --experimental-test-coverage packages/quay/test/init.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import YAML from "yaml";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import {
  generateConfigContent,
  mcpEntryForProvider,
  generateProfilesContent,
  classifyConfig,
  reconcileConfigContent,
  buildInitReport,
  corruptBackupPathFor,
  LOOP_VERSION_DEFAULTS,
  migrateStaleMcpEntry,
  providerEntryFile,
} from "../src/init.ts";
import { SERVE_BINDING_FALLBACK } from "../src/serve-binding.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(tag) {
  const d = makeTmpDir(`quay-init-${tag}-`);
  // AC-331 (gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script):
  // the CLI's fresh install now RESOLVES the target's test command and FAILS CLOSED when it cannot —
  // the shipped shell entry's behaviour, ported. Seed the cheapest detectable shape (the ladder's
  // first rung, `scripts/test.sh`) so every fixture below is a real project. Tests that need the
  // fail-closed arm use `bareTmpDir()`.
  seedDetectable(d);
  return d;
}

/** Give `d` a detectable test command (the ladder's first rung). */
function seedDetectable(d) {
  fs.mkdirSync(path.join(d, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(d, "scripts", "test.sh"), "#!/bin/bash\necho test\n");
}

/** A tmp dir with NO detectable test command — the fail-closed arm's input. */
function bareTmpDir(tag) {
  return makeTmpDir(`quay-init-${tag}-`);
}

function runQuay(args, cwd) {
  return execFileSync("node", [quayBin, ...args], { encoding: "utf8", cwd });
}

function runNative(args, cwd) {
  return execFileSync("node", [nativeBin, ...args], { encoding: "utf8", cwd });
}

function runQuayAllowFail(args, cwd) {
  try {
    return { stdout: execFileSync("node", [quayBin, ...args], { encoding: "utf8", cwd }), exitCode: 0 };
  } catch (err) {
    if (err.code !== undefined) {
      return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
    }
    return { stdout: "", stderr: String(err), exitCode: 1 };
  }
}

function runNativeAllowFail(args, cwd) {
  try {
    return { stdout: execFileSync("node", [nativeBin, ...args], { encoding: "utf8", cwd }), exitCode: 0 };
  } catch (err) {
    if (err.code !== undefined) {
      return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
    }
    return { stdout: "", stderr: String(err), exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// RED tests — verify the feature does NOT exist before implementation.
// These assert the PRE-implementation state.
// ---------------------------------------------------------------------------

test("RED: quay init does not exist before implementation (usage error)", () => {
  // Before implementation, `quay init` should be an unknown command.
  // Since we ARE implementing it now, this test documents the baseline.
  const dir = tmpDir("red1");
  const out = runQuayAllowFail(["init"], dir);
  // After implementation, init should succeed (not be an unknown command).
  assert.ok(
    out.stdout.includes("Created") || out.stdout.includes("config.yml") || out.exitCode === 0,
    "quay init should exist and succeed"
  );
});

// ---------------------------------------------------------------------------
// GREEN tests — verify the implementation works correctly.
// ---------------------------------------------------------------------------

// AC1: quay init at a plain project root creates .quay/config.yml + tasks/ dir
test("AC1: quay init creates config and tasks dir", () => {
  const dir = tmpDir("ac1");
  const out = runQuay(["init"], dir);

  assert.ok(out.includes("Created"), "should print 'Created'");
  assert.ok(fs.existsSync(path.join(dir, ".quay", "config.yml")), ".quay/config.yml should exist");
  assert.ok(fs.statSync(path.join(dir, ".quay", "config.yml")).isFile(), "config should be a file");
  assert.ok(fs.existsSync(path.join(dir, "tasks")), "tasks/ dir should exist");
  assert.ok(fs.statSync(path.join(dir, "tasks")).isDirectory(), "tasks/ should be a directory");

  // Verify config content has all 3 sections
  const configContent = fs.readFileSync(path.join(dir, ".quay", "config.yml"), "utf8");
  assert.ok(configContent.includes("providers:"), "config must have providers section");
  assert.ok(configContent.includes("gates:"), "config must have gates section");
  assert.ok(configContent.includes("loop:"), "config must have loop section");
  assert.ok(configContent.includes("native:"), "config must declare native provider");
  assert.ok(configContent.includes("enabled: true"), "config must have enabled provider");
});

// AC1b: quay init at a Node.js project root suggests Node-appropriate gates
test("AC1b: quay init at Node.js project root suggests node-test gate", () => {
  const dir = tmpDir("ac1b");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "test" }));
  const out = runQuay(["init"], dir);

  const configContent = fs.readFileSync(path.join(dir, ".quay", "config.yml"), "utf8");
  assert.ok(configContent.includes("node-tests"), "Node project should suggest node-tests gate");
  assert.ok(configContent.includes("node --test test/*.mjs"), "Node project should suggest node --test");
});

// AC2: quay init at a Go project root suggests Go-appropriate gate
test("AC2: quay init at Go project root suggests go-test gate", () => {
  const dir = tmpDir("ac2");
  fs.writeFileSync(path.join(dir, "go.mod"), "module test\n\ngo 1.21\n");
  const out = runQuay(["init"], dir);

  const configContent = fs.readFileSync(path.join(dir, ".quay", "config.yml"), "utf8");
  assert.ok(configContent.includes("go-tests"), "Go project should suggest go-tests gate");
  assert.ok(configContent.includes("go test ./..."), "Go project should suggest go test ./...");
});

// AC3: plain `quay init` UPGRADES an existing config (GOAL-029 single engine) — it neither refuses
// nor clobbers. (Was: "quay init refuses to overwrite existing config". The refusal contract was
// replaced by the human ruling of 2026-10-07: an existing config is the normal input, and the
// upgrade must be reachable WITHOUT a flag, because the shipped entry is a plain re-run.)
test("AC3: plain quay init UPGRADES an existing config (no refusal, no clobber)", () => {
  const dir = tmpDir("ac3");
  // First init succeeds.
  runQuay(["init"], dir);
  const cfgPath = path.join(dir, ".quay", "config.yml");
  assert.ok(fs.existsSync(cfgPath), "config should exist after first init");

  // A user's own comment must survive the second run (comment-preserving upgrade).
  const before = fs.readFileSync(cfgPath, "utf8").replace(/^providers:/m, "# a user comment\nproviders:");
  fs.writeFileSync(cfgPath, before);

  const out = runQuayAllowFail(["init"], dir);
  assert.equal(out.exitCode, 0, `a second init must upgrade, not refuse:\n${out.stderr}`);
  const after = fs.readFileSync(cfgPath, "utf8");
  assert.ok(after.includes("# a user comment"), "the user's own comment must survive the upgrade");
  assert.ok(after.includes("providers:"), "the upgraded config still carries its sections");
});

// AC3b (AC-330, rewritten): the overwrite mode is GONE, and the retired selector is a hard error.
// The old shape ("--force rewrites the file, mtime moves") is exactly what the ruling removed: a
// second mode whose semantics had to be kept in step with the state-based one. What replaces it is
// the negative control — the flag is REJECTED, and the config on disk is left byte-identical.
test("AC3b: the retired overwrite selector is refused and does NOT touch the config", () => {
  const dir = tmpDir("ac3b");
  const cfgPath = path.join(dir, ".quay", "config.yml");
  runQuay(["init"], dir);
  const firstMtime = fs.statSync(cfgPath).mtimeMs;
  const firstBytes = fs.readFileSync(cfgPath, "utf8");

  const start = Date.now();
  while (Date.now() - start < 100) { /* busy-wait */ }

  const out = runQuayAllowFail(["init", "--force"], dir);
  assert.equal(out.exitCode, 1, "a retired option must fail closed, never run with other semantics");
  assert.match(out.stderr, /unrecognized option: --force/, "and it names the option it rejected");
  assert.equal(fs.readFileSync(cfgPath, "utf8"), firstBytes, "nothing on disk moved");
  assert.equal(fs.statSync(cfgPath).mtimeMs, firstMtime, "the file was not even rewritten identically");
});

// AC-330: the OTHER retired selector (`--reconcile`) is refused the same way. Kept as its own case
// because the two flags took different code paths before the removal (an overwrite vs. the upgrade
// engine), so one could survive while the other did not.
test("AC-330: the retired reconcile selector is refused with its own message", () => {
  const dir = tmpDir("ac330-reconcile");
  runQuay(["init"], dir);
  const cfgPath = path.join(dir, ".quay", "config.yml");
  const before = fs.readFileSync(cfgPath, "utf8");
  const out = runQuayAllowFail(["init", "--reconcile", "--root", dir], dir);
  assert.equal(out.exitCode, 1, "the retired selector is a usage error");
  assert.match(out.stderr, /unrecognized option: --reconcile/);
  assert.match(out.stderr, /already upgrades an existing config/, "the message says what to do instead");
  assert.equal(fs.readFileSync(cfgPath, "utf8"), before, "and changes nothing");
});

// AC4: quay init --dry-run prints config to stdout, does NOT touch disk
test("AC4: quay init --dry-run prints to stdout, does not write to disk", () => {
  const dir = tmpDir("ac4");
  const out = runQuay(["init", "--dry-run"], dir);

  assert.ok(out.includes("providers:"), "dry-run should print providers section");
  assert.ok(out.includes("gates:"), "dry-run should print gates section");
  assert.ok(out.includes("loop:"), "dry-run should print loop section");
  assert.ok(out.includes("Dry run"), "dry-run should mention it is a dry run");
  assert.ok(!fs.existsSync(path.join(dir, ".quay", "config.yml")), "dry-run must NOT write config");
  assert.ok(!fs.existsSync(path.join(dir, "tasks")), "dry-run must NOT create tasks dir");
});

// ── AC-330: the `--json` report contract ───────────────────────────────────────────────────────────
// The report exists so a consumer (a script, the MCP tool) can act on init WITHOUT scraping prose.
// The contract asserted here is the FIELD SET (an absent field is a silent read error downstream) and
// the stdout purity (one JSON document — a stray human line makes the whole thing unparseable).
test("AC-330: init --json prints ONE parseable report on stdout and the human lines move to stderr", () => {
  const dir = tmpDir("ac330-json-fresh");
  const r = spawnSync("node", [quayBin, "init", "--json"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, `--json init must succeed:\n${r.stderr}`);

  const report = JSON.parse(r.stdout); // ← the purity assertion: ANY extra stdout line throws here
  for (const field of [
    "outcome", "configState", "dryRun", "validated", "issues", "warnings",
    "configPath", "tasksDir", "added", "migrated", "removed", "pinned", "dropped",
    "unknownKeys", "pluginLink",
  ]) {
    assert.ok(field in report, `the report must carry \`${field}\` (got: ${Object.keys(report).join(", ")})`);
  }
  assert.equal(report.outcome, "written", "a fresh install reports `written`");
  assert.equal(report.configState, "absent", "and the pre-state it judged");
  assert.equal(report.validated, true, "the generated config was judged by the official validator and passed");
  assert.equal(report.dryRun, false, "nothing above was a dry run");
  assert.deepEqual(report.added, [], "a fresh install has nothing to fill");
  assert.equal(typeof report.pluginLink.state, "string", "the .quay/plugin link status is carried as its own state");
  // No `serve:` defaults were written, so the report can never claim to have filled one.
  assert.ok(!Object.keys(report).includes("addedServe"), "the retired serve-fill field is gone from the contract");
  assert.ok(!/^serve:/m.test(fs.readFileSync(report.configPath, "utf8")), "and no serve: section exists on disk");
  // The human-facing half really did move: stdout carried only the JSON.
  assert.equal(r.stdout.trim().split("\n")[0], "{", "stdout starts with the JSON document");
  assert.match(r.stderr, /Created .*config\.yml/, "the progress line went to stderr instead");
});

test("AC-330: init --json on an EXISTING config reports the upgrade diff (fill / migrate / warnings)", () => {
  const dir = tmpDir("ac330-json-upgrade");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".quay", "config.yml"),
    "serve:\n  host: \"10.1.2.3\"\n  port: 4001\nx_user_extra: 1\nloop:\n  board: native\n  merge_target: integration\n",
  );
  const r = spawnSync("node", [quayBin, "init", "--json", "--root", dir], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.outcome, "reconciled");
  assert.equal(report.configState, "valid");
  assert.ok(report.added.includes("gates"), `the fill must be reported (got: ${report.added.join(", ")})`);
  assert.ok(report.migrated.some((m) => m.startsWith("merge_target: integration -> develop")), `the migration must be reported (got: ${report.migrated.join(", ")})`);
  assert.ok(report.unknownKeys.includes("x_user_extra"), "an unrecognized key is reported as kept");
  assert.ok(report.warnings.some((w) => w.includes("x_user_extra")), "…and materialized as an operator-facing warning");
  assert.equal(report.validated, true, "the upgraded candidate passed the official validator");
  // The user's own serve binding survives the upgrade — the report is about loop/config keys, and
  // `serve:` is never touched by it.
  const after = fs.readFileSync(path.join(dir, ".quay", "config.yml"), "utf8");
  assert.match(after, /host: "10\.1\.2\.3"/, "the pinned host survives");
  assert.match(after, /port: 4001/, "the pinned port survives");
});

test("AC-330: a dry run reports `dryRun: true` and carries the candidate text; nothing is written", () => {
  const dir = tmpDir("ac330-json-dryrun");
  const r = spawnSync("node", [quayBin, "init", "--json", "--dry-run"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.dryRun, true);
  assert.equal(report.outcome, "dry-run");
  assert.ok(typeof report.content === "string" && report.content.includes("loop:"), "the candidate text rides in `content`");
  assert.ok(!fs.existsSync(path.join(dir, ".quay")), "and nothing was written");
});

// AC5: quay init --root scaffolds at specified path
test("AC5: quay init --root scaffolds at specified path", () => {
  const dir = tmpDir("ac5");
  const targetDir = path.join(dir, "subdir");
  fs.mkdirSync(targetDir, { recursive: true });
  seedDetectable(targetDir);

  const out = runQuay(["init", "--root", targetDir], dir); // cwd is parent, --root is subdir
  assert.ok(out.includes("Created"), "init --root should succeed");
  assert.ok(fs.existsSync(path.join(targetDir, ".quay", "config.yml")), "config should be at --root path");
  assert.ok(fs.existsSync(path.join(targetDir, "tasks")), "tasks/ should be at --root path");

  // The parent dir (CWD) should NOT have config
  assert.ok(!fs.existsSync(path.join(dir, ".quay", "config.yml")), "config must NOT be at CWD when --root is used");
});

// AC6: Generated config is valid YAML and quay task list succeeds
test("AC6: generated config is valid and quay task list works", () => {
  const dir = tmpDir("ac6");
  runQuay(["init"], dir);

  // Run quay task list against the new workspace
  const out = runQuay(["task", "list"], dir);
  assert.ok(
    out.includes("No tasks found") || out.includes("quay-native mcp"),
    "quay task list should work against the new workspace"
  );
});

// AC7: Generated config contains inline comments documenting every supported field
test("AC7: generated config contains inline comments for all sections", () => {
  const dir = tmpDir("ac7");
  runQuay(["init"], dir);

  const configContent = fs.readFileSync(path.join(dir, ".quay", "config.yml"), "utf8");

  // Providers section docs
  assert.ok(configContent.includes("enabled: true/false"), "should document enabled field");
  assert.ok(configContent.includes("mcp_entry:"), "should document mcp_entry field");
  assert.ok(configContent.includes("GitHub provider"), "should document GitHub provider");
  assert.ok(configContent.includes("default_task_status"), "should document default_task_status");

  // Gates section docs
  assert.ok(configContent.includes("it0 gates"), "should document it0 gate type");
  assert.ok(configContent.includes("ADR gates"), "should document adr gate type");
  assert.ok(configContent.includes("Fixed-script gates"), "should document fixed gate type");
  assert.ok(configContent.includes("Coverage-floor gate"), "should document coverageFloor gate type");
  assert.ok(configContent.includes("Red-green gate"), "should document redGreen gate type");
  assert.ok(configContent.includes("cwd"), "should document cwd option");
  assert.ok(configContent.includes("timeoutMs"), "should document timeoutMs option");

  // Loop section docs
  assert.ok(configContent.includes("stop:"), "should document stop field");
  assert.ok(configContent.includes("policy:"), "should document policy field");
  assert.ok(configContent.includes("execution:"), "should document execution field");
  assert.ok(configContent.includes("audit:"), "should document audit field");
  assert.ok(configContent.includes("concurrency:"), "should document concurrency field");
  assert.ok(configContent.includes("routines:"), "should document routines field");
});

// AC8 (AC-330, rewritten): the help must document the CURRENT flags and must NOT advertise the two
// retired modes. `--reconcile` is checked on the SOURCE too (not just the rendered help): a flag kept
// in the source but hidden from help is the "visible ≠ executed" shape this AC exists to close.
test("AC8: quay init --help documents the current flags and advertises no retired mode", () => {
  const dir = tmpDir("ac8");
  const out = runQuay(["init", "--help"], dir);

  assert.ok(out.includes("--dry-run"), "help should document --dry-run");
  assert.ok(out.includes("--root"), "help should document --root");
  assert.ok(out.includes("--json"), "help should document the --json report");
  assert.ok(out.includes("--project"), "help should document --project");
  assert.ok(out.includes("quay init"), "help should mention quay init");
  assert.ok(!out.includes("--force"), `help must not advertise an overwrite mode:\n${out}`);
  assert.ok(!out.includes("--reconcile"), `help must not advertise a reconcile selector:\n${out}`);

  // The source half — `--reconcile` must be gone from the CLI surface entirely.
  const cliSrc = fs.readFileSync(path.join(__dirname, "..", "src", "cli", "init.ts"), "utf8");
  assert.ok(!cliSrc.includes("--reconcile"), "the CLI source must not carry a reconcile mode");
  const helpSrc = fs.readFileSync(path.join(__dirname, "..", "src", "cli", "help.ts"), "utf8");
  assert.ok(!helpSrc.includes("--reconcile"), "the shared help source must not carry one either");
});

// AC10: quay-native init works identically
test("AC10: quay-native init creates config and tasks dir", () => {
  const dir = tmpDir("ac10");
  const out = runNative(["init"], dir);

  assert.ok(out.includes("Created"), "quay-native init should print 'Created'");
  assert.ok(fs.existsSync(path.join(dir, ".quay", "config.yml")), ".quay/config.yml should exist");
  assert.ok(fs.existsSync(path.join(dir, "tasks")), "tasks/ dir should exist");

  // Verify config content
  const configContent = fs.readFileSync(path.join(dir, ".quay", "config.yml"), "utf8");
  assert.ok(configContent.includes("providers:"), "config must have providers section");
  assert.ok(configContent.includes("gates:"), "config must have gates section");
  assert.ok(configContent.includes("loop:"), "config must have loop section");
});

// AC10b: quay-native init --dry-run works
test("AC10b: quay-native init --dry-run prints to stdout", () => {
  const dir = tmpDir("ac10b");
  const out = runNative(["init", "--dry-run"], dir);

  assert.ok(out.includes("providers:"), "native dry-run should print providers");
  assert.ok(!fs.existsSync(path.join(dir, ".quay")), "native dry-run must NOT write .quay/ dir");
});

// AC10c: a second `quay-native init` must never CLOBBER an existing config.
//
// ⛔ WHY THIS IS NOT A BARE "exitCode === 1": the native CLI acquires the Core ENGINE through the
// `quay/init` bare specifier, which — inside a git worktree, where `node_modules` is a link to the
// main checkout — resolves to the MAIN checkout's Core, not this worktree's. So this assertion must
// hold under BOTH the retired "refuse with exit 1" contract and the new single-engine "upgrade in
// place" contract (GOAL-029): whichever arm fires, the user's own content is never replaced
// wholesale. The PRECISE upgrade contract is pinned by the GOAL-029 tests below, which drive the
// Core CLI by relative path and therefore observe THIS worktree's engine.
test("AC10c: quay-native init never clobbers an existing config", () => {
  const dir = tmpDir("ac10c");
  runNative(["init"], dir);
  const cfgPath = path.join(dir, ".quay", "config.yml");
  const withUserNote = fs.readFileSync(cfgPath, "utf8").replace(/^providers:/m, "# keep-my-note\nproviders:");
  fs.writeFileSync(cfgPath, withUserNote);

  const out = runNativeAllowFail(["init"], dir);
  assert.ok(out.exitCode === 0 || out.exitCode === 1, `a second native init must be handled, got exit ${out.exitCode}`);
  const after = fs.readFileSync(cfgPath, "utf8");
  // The single-engine contract is the ONLY arm left (AC-330 removed the "refuse an existing config"
  // mode): it UPGRADED in place, so the user's own content survives. The refusal arm that used to
  // live here asserted a `--force`-shaped message — a mode that no longer exists.
  assert.equal(out.exitCode, 0, `an existing config is upgraded, never refused:\n${out.stderr}`);
  assert.ok(after.includes("# keep-my-note"), "an upgrade preserves the user's own content (not a clobber)");
});

// AC10d (AC-330, rewritten): the native CLI carries the SAME retired-option guard as Core. The old
// shape ("native --force overwrites") is gone with the flag; what must hold now is that native
// REJECTS it — otherwise the two CLIs would disagree about what init accepts.
test("AC10d: quay-native refuses the retired overwrite selector too", () => {
  const dir = tmpDir("ac10d");
  runNative(["init"], dir);
  const out = runNativeAllowFail(["init", "--force"], dir);
  assert.equal(out.exitCode, 1, "native init must fail closed on the retired option");
  assert.match(out.stderr, /unrecognized option: --force/, "and name it");
});

// AC10e: quay-native init --root scaffolds at specified path
test("AC10e: quay-native init --root scaffolds at specified path", () => {
  const dir = tmpDir("ac10e");
  const targetDir = path.join(dir, "subdir");
  fs.mkdirSync(targetDir, { recursive: true });
  seedDetectable(targetDir);

  runNative(["init", "--root", targetDir], dir);
  assert.ok(fs.existsSync(path.join(targetDir, ".quay", "config.yml")), "config at --root path");
  assert.ok(!fs.existsSync(path.join(dir, ".quay", "config.yml")), "no config at CWD");
});

// Edge: no project type detection defaults to generic suggestions
test("edge: no project type yields generic test suggestions", () => {
  const dir = tmpDir("edge-generic");
  runQuay(["init"], dir);
  const configContent = fs.readFileSync(path.join(dir, ".quay", "config.yml"), "utf8");
  assert.ok(
    configContent.includes("no project-type detected") || configContent.includes("your-test-command-here"),
    "no-package.json project should have generic test command"
  );
});

// ---------------------------------------------------------------------------
// gap-cli-quay-init-collides-with-the-canonical-slash-quay-init (2026-08-07).
// CLI `quay init` (DIR-098, empty task-store scaffold) collides in name with
// the /quay:init skill (the canonical loop-laydown path). `quay init --loop`
// used to silently swallow the flag and exit 0 reporting success while laying
// down nothing but the empty store (reproduced live on B). The fix: fail closed
// on --loop and point at /quay:init; disambiguate both help surfaces.
// ---------------------------------------------------------------------------

// AC1: quay init --loop must NOT silently succeed — fail closed, point at /quay:init.
test("AC1-collision: quay init --loop fails closed and points at /quay:init", () => {
  const dir = tmpDir("collision-ac1");
  const out = runQuayAllowFail(["init", "--loop"], dir);
  assert.notEqual(out.exitCode, 0, "quay init --loop must exit non-zero");
  assert.ok(
    out.stderr.includes("--loop") && out.stderr.includes("/quay:init"),
    "error must mention the --loop flag and the /quay:init skill"
  );
  assert.ok(
    !fs.existsSync(path.join(dir, ".quay", "config.yml")),
    "quay init --loop must NOT write the empty-store scaffold (still the wrong action)"
  );
});

// Contract measure: `quay init --loop --dry-run` must exit non-zero (baseline was 0).
test("AC1-collision: quay init --loop --dry-run exits non-zero and writes nothing", () => {
  const dir = tmpDir("collision-measure");
  const out = runQuayAllowFail(["init", "--loop", "--dry-run"], dir);
  assert.notEqual(out.exitCode, 0, "quay init --loop --dry-run must exit non-zero");
  assert.ok(out.stderr.includes("/quay:init"), "error must point at /quay:init");
  assert.ok(!fs.existsSync(path.join(dir, ".quay")), "no .quay/ written");
  assert.ok(!fs.existsSync(path.join(dir, "tasks")), "no tasks/ written");
});

// AC2: both help surfaces disambiguate init from the /quay:init skill.
test("AC2-collision: quay init --help disambiguates from /quay:init", () => {
  const dir = tmpDir("collision-ac2");
  const out = runQuay(["init", "--help"], dir);
  assert.ok(out.includes("/quay:init"), "init --help must point at /quay:init");
  assert.ok(out.includes("--loop"), "init --help must state --loop is not a CLI init flag");
  assert.ok(out.includes("EMPTY task store"), "init --help must say it scaffolds an EMPTY task store");
});

test("AC2-collision: top-level quay --help disambiguates init from /quay:init", () => {
  const dir = tmpDir("collision-ac2b");
  const out = runQuay(["--help"], dir);
  assert.ok(out.includes("/quay:init"), "top-level --help must mention /quay:init");
  assert.ok(out.includes("EMPTY task store"), "top-level --help must say init scaffolds an EMPTY task store");
});

// AC3 negative control (AC-330, rewritten): the legit empty-store flags still behave unchanged —
// plain init exits 0, AND a second plain init on the same workspace still exits 0 (it upgrades).
// The `--force` arm that used to be the control here is now a REFUSAL, asserted above.
test("AC3-collision negative control: plain init still succeeds, twice", () => {
  const dir = tmpDir("collision-ac3");
  const first = runQuayAllowFail(["init"], dir);
  assert.equal(first.exitCode, 0, "plain quay init still exits 0");
  assert.ok(fs.existsSync(path.join(dir, ".quay", "config.yml")));
  const second = runQuayAllowFail(["init"], dir);
  assert.equal(second.exitCode, 0, "a second plain init still exits 0 (it upgrades in place)");
});

// quay-native shares the same silent-swallow defect — reject --loop there too.
test("AC1-collision: quay-native init --loop fails closed and points at /quay:init", () => {
  const dir = tmpDir("collision-native");
  const out = runNativeAllowFail(["init", "--loop"], dir);
  assert.notEqual(out.exitCode, 0, "quay-native init --loop must exit non-zero");
  assert.ok(out.stderr.includes("/quay:init"), "native error must point at /quay:init");
  assert.ok(!fs.existsSync(path.join(dir, ".quay")), "no .quay/ written");
});

// ---------------------------------------------------------------------------
// gap-init-scaffolds-mcp-entry-to-raw-ts-fails-on-installed-copy (2026-08-11).
// `quay init`'s generated config MUST select the provider MCP server launch
// entry by the RESOLVED provider-path form:
//   - INSTALLED form (provider path under node_modules, e.g. `./node_modules/quay-native`)
//     launches the bundled `./dist/quay-native.js` — raw `.ts` under node_modules is
//     refused by Node >=23.7 (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so the
//     bundled JS is the only runnable form there.
//   - DEV form (provider path inside the repo tree, e.g. `./packages/quay-native`)
//     keeps the raw `./bin/quay-native.ts` entry.
// ---------------------------------------------------------------------------

test("gap-installed-form: node_modules provider path -> bundled dist mcp_entry", () => {
  const content = generateConfigContent({
    providerId: "native",
    providerPath: "./node_modules/quay-native",
    isNode: false,
    isGo: false,
  });
  assert.ok(
    content.includes('mcp_entry: ["node", "./dist/quay-native.js", "mcp"]'),
    "installed form must launch the bundled dist JS (no type-stripping under node_modules)"
  );
  assert.ok(
    !content.includes('"./bin/quay-native.ts"'),
    "installed form must NOT reference the raw .ts entry (it would hit ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING)"
  );
});

test("gap-dev-form: repo-tree provider path keeps the raw .ts mcp_entry", () => {
  const content = generateConfigContent({
    providerId: "native",
    providerPath: "./packages/quay-native",
    isNode: false,
    isGo: false,
  });
  assert.ok(
    content.includes('mcp_entry: ["node", "./bin/quay-native.ts", "mcp"]'),
    "dev form must keep the raw TypeScript entry"
  );
});

test("gap-mcp-entry-for-provider unit: node_modules vs repo-tree discrimination", () => {
  assert.equal(
    mcpEntryForProvider("./node_modules/quay-native"),
    '["node", "./dist/quay-native.js", "mcp"]',
    "node_modules path -> dist bundle"
  );
  assert.equal(
    mcpEntryForProvider("./packages/quay-native"),
    '["node", "./bin/quay-native.ts", "mcp"]',
    "repo-tree path -> raw .ts"
  );
  assert.equal(
    mcpEntryForProvider("../packages/quay-native"),
    '["node", "./bin/quay-native.ts", "mcp"]',
    "relative repo-tree path -> raw .ts"
  );
  assert.equal(
    mcpEntryForProvider("C:\\npm\\node_modules\\quay-native"),
    '["node", "./dist/quay-native.js", "mcp"]',
    "windows-style node_modules path -> dist bundle"
  );
});

// gap-quay-init-launch-settings-template-missing-permissions-and-exclude-dynamic
// (2026-08-11). `quay init` must lay down `.claude/launch.settings.json` with
// `permissions.defaultMode: "bypassPermissions"` so a cold-start inner does NOT hit a
// permission prompt on its own loop scripts (measured F1/F2 on ad-arm1 archguard:
// monitor-mount-check.sh approval box). AC154 (profile 抽层): the flag-only params
// (excludeDynamicSystemPromptSections / promptSuggestions) + profiles/roles now live in the
// SIBLING `.quay/profiles.yml` scaffold — launch.settings.json carries ONLY Claude Code keys.
// ---------------------------------------------------------------------------

test("gap-launch-settings: quay init lays down .claude/launch.settings.json (bypassPermissions, no _launchSpec) + .quay/profiles.yml", () => {
  const dir = tmpDir("launchsettings");
  const out = runQuay(["init"], dir);

  assert.ok(out.includes("launch.settings.json"), "quay init should report the launch.settings.json scaffold");
  assert.ok(out.includes("profiles.yml"), "quay init should report the .quay/profiles.yml scaffold (AC154)");
  const settingsPath = path.join(dir, ".claude", "launch.settings.json");
  assert.ok(fs.existsSync(settingsPath), ".claude/launch.settings.json should be laid down by quay init");
  const s = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(
    s.permissions?.defaultMode,
    "bypassPermissions",
    "permissions.defaultMode must be bypassPermissions (F1 — inner must not hit permission prompt)"
  );
  assert.ok(!("_launchSpec" in s), "_launchSpec must be gone from launch.settings.json (AC154 profile 抽层)");

  // AC154: the profile carrier is a SIBLING scaffold laid down beside launch.settings.json.
  const profilesPath = path.join(dir, ".quay", "profiles.yml");
  assert.ok(fs.existsSync(profilesPath), ".quay/profiles.yml should be laid down by quay init (AC154)");
  const rawP = fs.readFileSync(profilesPath, "utf8");
  assert.match(rawP, /excludeDynamicSystemPromptSections: true/, "profiles.yml must carry excludeDynamicSystemPromptSections: true");
  assert.match(rawP, /promptSuggestions: false/, "profiles.yml must carry promptSuggestions: false");
  // AC4 (gap-quay-init-profiles-template-omits-every-role-the-drivers-request): the role session
  // names are DERIVED from the project, never quay's literal `quay-` prefix — a third-party project
  // that copied quay's names collided with quay's OWN sessions, and cross-session delivery addresses
  // peers by name ⇒ misrouting. The temp dir is `<...>/quay-init-launchsettings-XXXX`, so the
  // derived manager name is that basename + `-manager`.
  const derived = path.basename(dir);
  assert.match(rawP, new RegExp(`name: ${derived}-manager`), `profiles.yml must derive the manager session name from the project (${derived}-manager)`);
  // ⛔ Not `!startsWith("quay-")`: the temp dir itself is named `quay-init-…`, so a correct derived
  // name may legitimately begin with `quay-`. The defect is the LITERAL shipped name, so assert on
  // that exact shape — the shipped template's own `quay-<role>` values, which must not survive.
  for (const role of ["manager", "outer", "task-worker", "selector", "fix-worker", "pool-judge", "meta-driver"]) {
    assert.ok(!new RegExp(`^\\s*name: quay-${role}\\s*$`, "m").test(rawP), `role "${role}" must not keep the shipped literal session name quay-${role}`);
  }
  assert.ok(!/^\s*inner:\s*$/m.test(rawP), "the retired `inner` role must not be laid down (SPEC-tmux-retirement-2026-09-03)");
  for (const role of ["task-worker", "selector", "fix-worker", "pool-judge", "meta-driver"]) {
    assert.match(rawP, new RegExp(`^\\s+${role}:\\s*$`, "m"), `profiles.yml must define the ${role} role the drivers request`);
  }
});

// gap-quay-init-profiles-template-omits-every-role-the-drivers-request, Plan item 1: the inline
// template in src/init.ts and the checked-in plugin/.quay/profiles.yml (what quay-init.sh copies
// into a project, and what quay-launch.sh falls back to on a bare machine) used to be two
// hand-maintained copies that silently diverged — the shipped 7-role carrier was "fixed" once while
// the init path kept laying down the 3-role inline one. They are bound here by an executable
// invariant instead of by discipline: ONE byte-for-byte assertion, so a one-sided edit cannot land.
test("profiles carrier: the inline template IS the shipped carrier byte-for-byte (single source + invariant)", () => {
  const shipped = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "plugin", ".quay", "profiles.yml"), "utf8");
  assert.equal(
    generateProfilesContent("quay"),
    shipped,
    "src/init.ts's template must reproduce plugin/.quay/profiles.yml byte-for-byte for project `quay` — edit BOTH or neither"
  );
  assert.notEqual(
    generateProfilesContent("some-other-project"),
    shipped,
    "the template must be parameterised: a different project may not reuse quay's session names"
  );
});

test("gap-launch-settings: quay-native init lays down the same launch.settings.json + profiles.yml", () => {
  const dir = tmpDir("launchsettings-native");
  const out = runNative(["init"], dir);
  assert.ok(out.includes("launch.settings.json"), "quay-native init should report the launch.settings.json scaffold");
  assert.ok(out.includes("profiles.yml"), "quay-native init should report the .quay/profiles.yml scaffold");

  const settingsPath = path.join(dir, ".claude", "launch.settings.json");
  assert.ok(fs.existsSync(settingsPath), "quay-native init should lay down .claude/launch.settings.json");
  const s = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(s.permissions?.defaultMode, "bypassPermissions");
  assert.ok(!("_launchSpec" in s), "_launchSpec must be gone from launch.settings.json (AC154)");

  const profilesPath = path.join(dir, ".quay", "profiles.yml");
  assert.ok(fs.existsSync(profilesPath), "quay-native init should lay down .quay/profiles.yml");
  assert.match(fs.readFileSync(profilesPath, "utf8"), /excludeDynamicSystemPromptSections: true/);
});

test("gap-launch-settings: quay init --dry-run does NOT write launch.settings.json", () => {
  const dir = tmpDir("launchsettings-dryrun");
  const out = runQuay(["init", "--dry-run"], dir);
  assert.ok(out.includes("launch.settings.json"), "dry-run should preview the launch.settings.json path");
  assert.ok(out.includes("profiles.yml"), "dry-run should preview the profiles.yml path");
  assert.ok(!fs.existsSync(path.join(dir, ".claude")), "dry-run must NOT write .claude/ dir");
  assert.ok(!fs.existsSync(path.join(dir, ".quay", "config.yml")), "dry-run must NOT write config");
  assert.ok(!fs.existsSync(path.join(dir, ".quay", "profiles.yml")), "dry-run must NOT write profiles.yml");
});

// AC-330 (rewritten): `--force` used to overwrite a stale `.claude/launch.settings.json`. With the
// overwrite mode gone, the lay-down is CREATE-IF-ABSENT — an existing file is the user's and init
// leaves it alone, exactly as it leaves every other key it does not own. The negative control is the
// half that survives: a FRESH init still lays down a correct file.
test("gap-launch-settings: init lays down a correct launch.settings.json and never clobbers an existing one", () => {
  const dir = tmpDir("launchsettings-force");
  runQuay(["init"], dir);
  const settingsPath = path.join(dir, ".claude", "launch.settings.json");

  const fresh = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(fresh.permissions?.defaultMode, "bypassPermissions", "a fresh init lays down bypassPermissions");
  assert.ok(!("_launchSpec" in fresh), "and carries no pre-AC154 _launchSpec");

  // A user's own (even stale-shaped) copy is NOT init's to overwrite.
  const staleRaw = JSON.stringify(
    { $schema: "https://json.schemastore.org/claude-code-settings.json", _launchSpec: { excludeDynamicSystemPromptSections: false } },
    null,
    2,
  );
  fs.writeFileSync(settingsPath, staleRaw, "utf8");

  runQuay(["init"], dir);
  assert.equal(fs.readFileSync(settingsPath, "utf8"), staleRaw, "an existing launch.settings.json is left byte-identical");
});

// ---------------------------------------------------------------------------
// gap-ac168-quay-init-contract-closed-set (2026-09-07).
// The CLI `quay init` laydown must be a SUBSET of the SPEC §6 closed set (the
// QUAY-INIT-CLOSED-SET:BEGIN/END marker block in
// orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md). This is the
// machine-readable contract the AC-168 goal criterion reads: produced ⊆ allowed,
// else fail. The negative control proves the check can take false (delete one
// allowed line ⇒ red), so this is a measurement, not a恒真回显 (硬规则 4).
// ---------------------------------------------------------------------------

const SPEC_CLOSED_SET_PATH = path.join(__dirname, "../../..", "orchestration", "SPEC-plugin-lifecycle-single-bundle-2026-09-02.md");

function listFilesRecursive(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

function readClosedSet(specPath) {
  const raw = fs.readFileSync(specPath, "utf8");
  const lines = raw.split("\n");
  let inBlock = false;
  const allowed = [];
  for (const line of lines) {
    if (line === "QUAY-INIT-CLOSED-SET:BEGIN") { inBlock = true; continue; }
    if (line === "QUAY-INIT-CLOSED-SET:END") { inBlock = false; continue; }
    if (inBlock && line.startsWith("- ")) allowed.push(line.slice(2));
  }
  return allowed;
}

function computeOutsideClosedSet(produced, allowed) {
  return produced.filter((p) => !allowed.includes(p));
}

test("AC168-closed-set: CLI quay init laydown ⊆ SPEC §6 closed set", () => {
  const dir = tmpDir("ac168-closedset");
  runQuay(["init", "--root", dir], dir);

  // ⛔ `scripts/test.sh` is the FIXTURE the test itself seeded (see tmpDir) — the target's own file,
  // not something init laid down. Exclude it, and assert it is really there so the exclusion cannot
  // quietly become a no-op (硬规则 2: the predicate must be run against a known-true sample).
  const FIXTURE = "scripts/test.sh";
  assert.ok(fs.existsSync(path.join(dir, FIXTURE)), "fixture precondition: the seeded test command must exist");
  const produced = listFilesRecursive(dir).filter((p) => p !== FIXTURE);
  const allowed = readClosedSet(SPEC_CLOSED_SET_PATH);

  assert.ok(allowed.length > 0, "SPEC §6 closed-set block must be non-empty");
  const outside = computeOutsideClosedSet(produced, allowed);
  assert.deepEqual(outside, [], `quay init produced files outside the closed set: ${outside.join(", ")}`);
});

test("AC168-closed-set negative control: removing .quay/config.yml from the block makes the check fail", () => {
  // The check must be able to take false — feed it a closed set missing one
  // load-bearing member and assert the produced file is flagged. (Equiv. of the
  // manual "delete .quay/config.yml from the block ⇒ red" negative control.)
  const allowed = readClosedSet(SPEC_CLOSED_SET_PATH).filter((p) => p !== ".quay/config.yml");
  const outside = computeOutsideClosedSet([".quay/config.yml"], allowed);
  assert.deepEqual(outside, [".quay/config.yml"], "a produced file missing from the block must be flagged");
});

// ---------------------------------------------------------------------------
// Branch model provisioning (gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing)
// `quay init` now ESTABLISHES the landing baseline `develop` the fan-in/anti-drift path reads,
// instead of assuming it. These three tests pin the REGRESSION arm: init on a directory that is
// not a git repo, and on a repo that already carries quay's own topology, must behave exactly as
// before. (The positive/adoption arm lives in branch-model.test.mjs.)
// ---------------------------------------------------------------------------

test("branch model: a NON-git directory still initializes (provisioning is skipped, never fatal)", () => {
  const dir = tmpDir("bm-nogit");
  const r = runQuayAllowFail(["init", "--root", dir], dir);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, ".quay", "config.yml")), true, "a plain dir is a first-class target");
});

test("branch model: a repo whose `develop` continues its default branch is untouched (逐字不变)", () => {
  const dir = tmpDir("bm-quay-shape");
  const g = (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.name", "init-test"]);
  g(["config", "user.email", "init@example.com"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "1\n");
  g(["add", "-A"]);
  g(["commit", "-q", "-m", "base"]);
  g(["branch", "develop"]);
  g(["branch", "author"]);
  const before = { develop: g(["rev-parse", "develop"]), author: g(["rev-parse", "author"]), main: g(["rev-parse", "main"]) };

  const r = runQuayAllowFail(["init", "--root", dir], dir);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /\[REUSED\] landing-baseline -> develop/);
  assert.equal(g(["rev-parse", "develop"]), before.develop);
  assert.equal(g(["rev-parse", "author"]), before.author);
  assert.equal(g(["rev-parse", "main"]), before.main);
});

test("branch model: --dry-run reports the plan and mutates no ref", () => {
  const dir = tmpDir("bm-dryrun");
  const r = runQuayAllowFail(["init", "--dry-run", "--root", dir], dir);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /branch model/);
  assert.equal(fs.existsSync(path.join(dir, ".quay", "config.yml")), false, "dry run writes nothing");
});

// ---------------------------------------------------------------------------
// gap-quay-init-native-reconcile / AC1 — the THREE-STATE classification.
//
// `configExists` was `fs.existsSync`: "there is a file here" answering a
// different question ("is there a config I must not clobber"). A file that
// exists but cannot be PARSED fell into the same branch as a valid one, so the
// operator was told "already exists, use --force" — a true statement about a
// name conflict, and a false one about their actual problem (硬规则 3b).
// ---------------------------------------------------------------------------

const BROKEN_YAML = "providers: [unclosed\n  bad: : :\n";

test("AC1 classifyConfig unit: absent / valid / corrupt (malformed YAML) are three distinct states", () => {
  const dir = tmpDir("ac1-classify");

  const absent = classifyConfig(path.join(dir, ".quay", "config.yml"));
  assert.equal(absent.state, "absent", "no file ⇒ absent");

  const cfgPath = path.join(dir, ".quay", "config.yml");
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, "providers:\n  native:\n    enabled: true\nloop:\n  board: native\n");
  const valid = classifyConfig(cfgPath);
  assert.equal(valid.state, "valid", "a parseable mapping ⇒ valid");
  assert.equal(valid.config?.providers?.native?.enabled, true, "valid carries the parsed document");

  fs.writeFileSync(cfgPath, BROKEN_YAML);
  const corrupt = classifyConfig(cfgPath);
  assert.equal(corrupt.state, "corrupt", "an unparseable file is its OWN state, not 'absent' and not 'valid'");
  assert.ok((corrupt.reason ?? "").length > 0, "the corrupt state must carry the real cause, not a generic message");

  // A top-level scalar/list parses fine as YAML but no consumer can read it as a config map.
  fs.writeFileSync(cfgPath, "- just\n- a list\n");
  assert.equal(classifyConfig(cfgPath).state, "corrupt", "a list-valued document is corrupt, not valid");
});

// AC-330 (unified with the sibling rebuild semantics): a malformed config used to be a flat REFUSAL
// that named `--reconcile` as the only way out. With the selectors gone that would be a dead end —
// no flag could ask for the repair — so the STATE now decides: an unreadable config is rebuilt from
// this version's defaults. What the old test actually protected survives verbatim: the operator is
// told the parser's REAL reason, never a name conflict, and the broken bytes are preserved rather
// than discarded.
test("AC1 corrupt: an unparseable .quay/config.yml is BACKED UP and REBUILT — exit 0, never a name conflict", () => {
  const dir = tmpDir("ac1-corrupt");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  fs.writeFileSync(cfgPath, BROKEN_YAML);

  // spawnSync (not runQuayAllowFail) so BOTH streams are captured — the lost-project-values warning
  // goes to stderr, and execFileSync only carries stderr on a NON-zero exit.
  const out = spawnSync("node", [quayBin, "init", "--root", dir], { encoding: "utf8", cwd: dir });
  const both = out.stdout + out.stderr;
  // GOAL-029 / 人 2026-10-07: the file's STATE decides. Corrupt ⇒ salvage-by-rebuild, not refusal.
  assert.equal(out.status, 0, `an unparseable config is salvaged, not refused:\n${both}`);
  assert.ok(
    !/already exists/.test(both),
    `must NOT claim a name conflict — that sends the operator after a problem that does not exist:\n${both}`
  );
  // …while the REAL cause is still voiced (硬规则 3b): the parser's own message, not "already exists".
  assert.match(both, /could not be read as a config/, "the message names what actually happened");
  assert.match(both, /YAML parse failed/, "the parser's own reason is relayed verbatim");

  // The unreadable bytes are preserved byte-identical beside the new file — "unparseable" is not
  // "worthless" (the backup is what makes the rebuild non-destructive).
  const backups = fs.readdirSync(path.join(dir, ".quay")).filter((f) => f.startsWith("config.yml.corrupt-"));
  assert.equal(backups.length, 1, `exactly one backup of the unreadable file (got: [${backups.join(", ")}])`);
  assert.equal(
    fs.readFileSync(path.join(dir, ".quay", backups[0]), "utf8"),
    BROKEN_YAML,
    "the backup is byte-identical"
  );
  assert.ok(out.stdout.includes(backups[0]), `the report names the backup path it wrote:\n${out.stdout}`);

  // The rebuild's REAL COST is voiced, never silent: the new config does not carry the old project's
  // values, so the operator must be told to re-apply them from the backup.
  assert.match(out.stderr, /project values/, `the lost-project-values warning must be printed:\n${out.stderr}`);

  // The rebuilt config is a VALID config for this version (same template as a fresh install).
  const rebuilt = YAML.parse(fs.readFileSync(cfgPath, "utf8"));
  assert.equal(rebuilt?.loop?.fork_baseline, "develop", "the rebuilt config carries this version's defaults");
  const v = runQuay(["config", "validate", "--root", dir], dir);
  assert.ok(!v.includes("error:"), `the rebuilt config passes the official validator:\n${v}`);
});

// ── The corrupt state's REBUILD contract (GOAL-029; AC-329's corrected corrupt step) ───────────────
// Plain `quay init` on an unparseable config: back the bytes up, regenerate from this version's
// defaults, validate the rebuilt body, write atomically, exit 0. The remaining fine points the
// sibling task (gap-init-surface-unified…) explicitly left here: the `rebuilt` outcome token, the
// lost-project-values warning, no-overwrite within one second, and non-zero when the rebuilt body
// itself fails validation.

test("REBUILD ④: re-running init on the rebuilt config is idempotent (byte-identical, no new backup)", () => {
  const dir = tmpDir("rebuild-idempotent");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  fs.writeFileSync(cfgPath, BROKEN_YAML);

  const r1 = runQuayAllowFail(["init", "--root", dir], dir);
  assert.equal(r1.exitCode, 0, r1.stdout + r1.stderr);
  const after1 = fs.readFileSync(cfgPath, "utf8");

  const r2 = runQuayAllowFail(["init", "--root", dir], dir);
  assert.equal(r2.exitCode, 0, r2.stdout + r2.stderr);
  assert.equal(fs.readFileSync(cfgPath, "utf8"), after1, "a second run must not rewrite the rebuilt config");
  assert.doesNotMatch(r2.stdout, /rebuilt from this version's defaults/, "…and it is an UPGRADE now, not a rebuild");

  const backups = fs.readdirSync(path.join(dir, ".quay")).filter((f) => f.startsWith("config.yml.corrupt-"));
  assert.equal(backups.length, 1, "the second run adds no backup (nothing was corrupt this time)");
});

test("REBUILD ②: --dry-run over a corrupt config reports the backup+rebuild plan and writes NOTHING", () => {
  const dir = tmpDir("rebuild-dryrun");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  fs.writeFileSync(cfgPath, BROKEN_YAML);

  const out = runQuayAllowFail(["init", "--root", dir, "--dry-run"], dir);
  assert.equal(out.exitCode, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Would back up the unreadable \.quay\/config\.yml to: .*config\.yml\.corrupt-/, `a dry run must report the backup it would write:\n${out.stdout}`);
  assert.match(out.stdout, /Would rebuild it from this version's defaults/, "…and the rebuild, with its cost stated");
  assert.match(out.stdout, /Dry run — nothing written/, "and it says nothing was written");

  assert.equal(fs.readFileSync(cfgPath, "utf8"), BROKEN_YAML, "the corrupt file is untouched");
  const backups = fs.readdirSync(path.join(dir, ".quay")).filter((f) => f.startsWith("config.yml.corrupt-"));
  assert.equal(backups.length, 0, `a dry run must not write a backup (got: [${backups.join(", ")}])`);
  // "writes NOTHING" is about every file the real run would lay down, not just the config.
  assert.equal(fs.existsSync(path.join(dir, "tasks")), false, "a dry run must not create tasks/");
  assert.equal(fs.existsSync(path.join(dir, ".quay", "profiles.yml")), false, "a dry run must not create profiles.yml");
  assert.equal(fs.existsSync(path.join(dir, ".claude", "launch.settings.json")), false, "a dry run must not create launch.settings.json");
});

// AC③① — BOTH unparseable shapes the criterion uses (a duplicated map key and an unclosed flow
// bracket) must take the same salvage path: exit 0, a byte-identical backup, a config that passes the
// official validator, and a report naming the backup plus the rebuild's cost.
for (const [kind, corrupt] of [
  ["unclosed-bracket", "providers: [unclosed\n  bad: : :\n"],
  ["duplicate-key", 'loop:\n  gates:\n    - acceptance\n  gates: duplicate-makes-this-unparseable\nproviders: [unclosed\n'],
]) {
  test(`REBUILD ① (${kind}): exit 0, byte-identical backup, rebuilt config validates, report names the backup + the cost`, () => {
    const dir = tmpDir(`rebuild-kind-${kind}`);
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    const cfgPath = path.join(dir, ".quay", "config.yml");
    fs.writeFileSync(cfgPath, corrupt);

    const out = spawnSync("node", [quayBin, "init", "--root", dir], { encoding: "utf8", cwd: dir });
    assert.equal(out.status, 0, `${kind}: an unparseable config is rebuilt:\n${out.stdout}${out.stderr}`);

    const backups = fs.readdirSync(path.join(dir, ".quay")).filter((f) => f.startsWith("config.yml.corrupt-"));
    assert.equal(backups.length, 1, `${kind}: exactly one backup (got: [${backups.join(", ")}])`);
    assert.equal(fs.readFileSync(path.join(dir, ".quay", backups[0]), "utf8"), corrupt, `${kind}: backup is byte-identical`);
    assert.ok(out.stdout.includes(backups[0]), `${kind}: the report names the backup path`);

    const v = runQuay(["config", "validate", "--root", dir], dir);
    assert.ok(!v.includes("error:"), `${kind}: the rebuilt config passes the official validator:\n${v}`);
  });
}

test("REBUILD ③ (unit): corruptBackupPathFor never hands back a taken name — same-second rebuilds do not overwrite", () => {
  const dir = tmpDir("rebuild-backuppath");
  const cfg = path.join(dir, ".quay", "config.yml");
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, "x");

  const stamp = 1_700_000_000; // a FIXED stamp: the collision arm is otherwise unreachable by construction
  const first = corruptBackupPathFor(cfg, stamp);
  assert.equal(first, `${cfg}.corrupt-${stamp}`, "the first backup uses the plain stamp");
  fs.writeFileSync(first, "first");

  const second = corruptBackupPathFor(cfg, stamp);
  assert.notEqual(second, first, "the second call must not return the name already on disk");
  fs.writeFileSync(second, "second");
  const third = corruptBackupPathFor(cfg, stamp);
  assert.notEqual(third, first);
  assert.notEqual(third, second);

  assert.equal(fs.readFileSync(first, "utf8"), "first", "the FIRST backup is untouched (the whole point)");
  assert.equal(fs.readFileSync(second, "utf8"), "second");
});

test("REBUILD ③ (integration): two rebuilds back-to-back keep BOTH backups", () => {
  const dir = tmpDir("rebuild-twice");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  const corrupt1 = "providers: [unclosed\n  bad: : :\n";
  const corrupt2 = "loop:\n  gates:\n    - acceptance\n  gates: duplicate-makes-this-unparseable\n";

  fs.writeFileSync(cfgPath, corrupt1);
  const r1 = runQuayAllowFail(["init", "--root", dir], dir);
  assert.equal(r1.exitCode, 0, r1.stdout + r1.stderr);
  fs.writeFileSync(cfgPath, corrupt2);
  const r2 = runQuayAllowFail(["init", "--root", dir], dir);
  assert.equal(r2.exitCode, 0, r2.stdout + r2.stderr);

  const backups = fs.readdirSync(path.join(dir, ".quay")).filter((f) => f.startsWith("config.yml.corrupt-")).sort();
  assert.equal(backups.length, 2, `both rebuilds left their own backup (got: [${backups.join(", ")}])`);
  const texts = backups.map((b) => fs.readFileSync(path.join(dir, ".quay", b), "utf8"));
  assert.ok(texts.includes(corrupt1), "the FIRST unreadable file's bytes survive (it was not overwritten)");
  assert.ok(texts.includes(corrupt2), "and the second one's do too");
});

test("REBUILD ⑤ (regression): a PARSEABLE config whose loop.gates names an unknown gate still FAILS — non-zero, byte-identical, names the value", () => {
  const dir = tmpDir("rebuild-badgate");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  const bad = [
    "providers:",
    "  native:",
    "    enabled: true",
    '    path: "/nonexistent/cache/quay/quay/0.10.0/vendor/quay-native"',
    '    tasks_dir: "./tasks"',
    '    mcp_entry: ["node", "/nonexistent/x.js", "mcp"]',
    "loop:",
    `  repo_root: ${dir}`,
    "  test_command: node --test",
    `  worktree_root: ${dir}-wt`,
    "  gates: no-such-gate-zz",
    "",
  ].join("\n");
  fs.writeFileSync(cfgPath, bad);

  const out = runQuayAllowFail(["init", "--root", dir], dir);
  assert.equal(out.exitCode, 1, `an unresolvable loop.gates must fail the upgrade:\n${out.stdout}${out.stderr}`);
  assert.match(out.stderr, /no-such-gate-zz/, "the refusal must NAME the incompatible user value");
  assert.equal(fs.readFileSync(cfgPath, "utf8"), bad, "a failed upgrade leaves the config byte-identical");
  const backups = fs.readdirSync(path.join(dir, ".quay")).filter((f) => f.startsWith("config.yml.corrupt-"));
  assert.equal(backups.length, 0, "a parseable-but-incompatible config is NOT corrupt — no backup is made");
});

test("REBUILD: a rebuilt body that ITSELF fails validation writes nothing and keeps the corrupt original + backup", async () => {
  // Reach the `rebuild-invalid` arm through the state it exists for: the rebuilt config omits the
  // native binding (the upgrade engine drops the retired path/mcp_entry), so if NO plugin root can be
  // resolved the validator reports NATIVE_PROVIDER_UNRESOLVABLE. `pluginRoot: ""` is the falsy seam
  // for exactly that state — the CLI maps an unset CLAUDE_PLUGIN_ROOT to `null`, which Core then
  // self-resolves, so this branch is otherwise only reachable where the plugin root is genuinely
  // missing (a bare checkout). A direct runInit call is the honest way to pin it.
  const { runInit } = await import("../src/init.ts");
  const dir = tmpDir("rebuild-invalid");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  fs.writeFileSync(cfgPath, BROKEN_YAML);

  // ⛔ No `force`: AC-330 removed the selector from `InitOptions` — the state of the target is what
  // decides, and an unparseable config is rebuilt either way.
  const res = runInit({ root: dir, dryRun: false, pluginRoot: "" });
  assert.equal(res.outcome, "rebuild-invalid", "an invalid rebuilt body gets its own outcome, not 'rebuilt'/'written'");
  assert.ok((res.rebuildIssues ?? []).length > 0, "the failure names the offending field(s)");
  assert.ok(
    (res.rebuildIssues ?? []).some((i) => i.field.startsWith("providers")),
    `the unresolvable native provider is the named cause:\n${JSON.stringify(res.rebuildIssues)}`
  );
  assert.equal(fs.readFileSync(cfgPath, "utf8"), BROKEN_YAML, "the corrupt original is left in place");
  assert.ok(res.corruptBackupPath, "the backup path is still reported");
  assert.equal(
    fs.existsSync(res.corruptBackupPath),
    false,
    "nothing was written at all — not even the backup (the corrupt file itself is still there)"
  );
});

// AC-330: `--dry-run` on an unreadable config must PREVIEW the rebuild without touching anything —
// no rewrite, and no backup file either (a dry run writes nothing at all).
test("AC-330: --dry-run on an unreadable config previews the rebuild and writes nothing", () => {
  const dir = tmpDir("ac330-corrupt-dryrun");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".quay", "config.yml"), BROKEN_YAML);

  const out = runQuay(["init", "--dry-run", "--root", dir], dir);
  assert.match(out, /Dry run — nothing written to disk/, "the preview says so");
  assert.match(out, /loop:/, "and prints the config it would write");
  assert.equal(fs.readFileSync(path.join(dir, ".quay", "config.yml"), "utf8"), BROKEN_YAML, "the broken file is untouched");
  assert.deepEqual(
    fs.readdirSync(path.join(dir, ".quay")).filter((f) => f.startsWith("config.yml.corrupt-")),
    [],
    "a dry run creates no backup either",
  );
});

// ⛔ The quay-native arm of this test CANNOT assert the NEW behaviour in a git worktree, and that is
// a property of the worktree layout rather than of the change: `packages/quay-native/bin/quay-native.ts`
// reaches the shared logic through the bare specifier `quay/init`, which resolves through
// `node_modules/quay` → `../packages/quay`. A task worktree's `node_modules` is a symlink to the MAIN
// checkout's, so that specifier lands on the main checkout's `src/init.ts` — i.e. on whatever the main
// checkout has, not on the file under test here (verified: `require.resolve("quay/init")` from this
// worktree returns `/home/yale/work/quay/packages/quay/src/init.ts`). A test asserting the NEW native
// behavior would therefore be red for the whole life of any task branch and green only after the
// change is already on the main checkout — a check that cannot fail when it matters.
// What IS asserted here instead is the half that is a fact on this branch: quay-native's own handler
// carries the same outcome vocabulary as Core, because both call the SAME `runInit` — and, since
// AC-330, the same retired-option guard, so the two CLIs cannot disagree about what init accepts.
test("AC1 corrupt: quay-native's init handler shares Core's outcome vocabulary and retired-option guard", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.ts"), "utf8");
  assert.match(src, /result\.outcome === "reconciled"/, "…handles the upgrade outcomes");
  assert.match(src, /KNOWN_INIT_FLAGS/, "…and checks argv against the same retired-option allowlist");
  assert.ok(!src.includes("initFlags.force"), "the overwrite mode is gone from its flag reading");
  assert.ok(!src.includes("initFlags.reconcile"), "so is the reconcile selector");
});

// ---------------------------------------------------------------------------
// gap-quay-init-native-reconcile / AC2 — reconcile to the current version's
// defaults, replacing "skip or clobber".
//
// Regression fixture: the exact historical defect (quay-fleet, 2026-09-18) —
// a config initialized BEFORE `fork_baseline`/`merge_target` entered the
// fresh-install template. Re-running /quay:init left the file's mtime
// unchanged, forever.
// ---------------------------------------------------------------------------

const LEGACY_CONFIG = [
  "# a user's own comment that a YAML re-dump would destroy",
  "providers:",
  "  native:",
  "    enabled: true",
  "    path: \"./node_modules/quay-native\"",
  "    tasks_dir: \"./tasks\"",
  "loop:",
  "  board: \"native\"",
  "  gates: []",
  "  # the project's own tuning, which must survive verbatim",
  "  concurrency_bands: [1, 3]",
  "  my_project_key: keep-me",
  "",
].join("\n");

test("AC2 reconcile: a legacy config missing the version defaults gets them — everything else untouched", () => {
  const dir = tmpDir("ac2-reconcile");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  fs.writeFileSync(cfgPath, LEGACY_CONFIG);

  const out = runQuay(["init", "--root", dir], dir);
  assert.match(out, /upgraded to this version's defaults/, `the run reports an upgrade:\n${out}`);
  assert.match(out, /filled loop\.fork_baseline/, "the report names the key it filled");

  const after = fs.readFileSync(cfgPath, "utf8");
  const doc = YAML.parse(after);
  // The regression itself: the key that entered the template three days after this project's init.
  assert.equal(doc.loop.fork_baseline, "develop", "fork_baseline is filled from the version default");
  // ⛔ merge_target is NOT filled, and that is the designed behavior — not an omission. The version
  // does not require it: `plugin/test/quay-init.test.mjs` has an executable invariant that the loop
  // writer must NOT emit it (the audited zero-consumer key, deleted from the writer face), and
  // serve-render.ts falls back to `fork_baseline` for the dashboard. This task's AC2 named both keys
  // because the quay-fleet SYMPTOM involved both; the constraint wins (see the DoD evidence section).
  assert.equal(doc.loop.merge_target, undefined, "merge_target is deliberately NOT written (zero-consumer key)");
  // Preservation — the whole reason this is a diff and not a re-dump.
  assert.equal(doc.loop.my_project_key, "keep-me", "an unknown user key survives");
  assert.deepEqual(doc.loop.concurrency_bands, [1, 3], "a user-tuned list survives with its order intact");
  assert.equal(doc.loop.board, "native", "a pre-existing key keeps its user value");
  assert.match(after, /^# a user's own comment that a YAML re-dump would destroy$/m, "comments survive (a YAML round-trip would drop them)");
  assert.match(after, /^  # the project's own tuning, which must survive verbatim$/m, "inline comments inside the edited block survive too");

  // GOAL-029 (人 2026-10-07) INVERTS the serve reading this block used to pin. The old contract was
  // "reconcile fills serve.host/port from SERVE_VERSION_DEFAULTS"; the ruling is 「serve 默认值（等于
  // 回退值）不写进配置」 — a version-level default whose value EQUALS the code fallback says nothing,
  // so the upgrade must NOT write it. The fixture predates the key: the strong reading is now that
  // `serve:` stays ABSENT (nothing to say) and no `host:`/`port:` line appears.
  assert.doesNotMatch(out, /filled serve\./, `the upgrade must NOT write a fallback-equal serve default:\n${out}`);
  assert.equal(doc.serve, undefined, "serve: is not created when every default equals the code fallback");
  assert.doesNotMatch(after, /^\s*(host|port):/m, "no serve.host/serve.port line is written");
  // …and the fallback constant is still the ONE definition of what an absent serve means.
  assert.equal(typeof SERVE_BINDING_FALLBACK.host, "string", "the resolver's fallback stays the single definition");
});

test("AC2 reconcile: a config already current is NOT rewritten (no gratuitous rewrite)", () => {
  const dir = tmpDir("ac2-idempotent");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");

  // ⛔ TWO runs before the byte pin (GOAL-029 single engine): run 1 is the fresh write, which the
  // CLI template still births with the retired native `path`/`mcp_entry` (a follow-up task folds the
  // fresh install onto the same pipeline), so the FIRST upgrade is what reaches the fixpoint. The
  // "already current" contract is about the second upgrade onward.
  runQuay(["init", "--root", dir], dir); // fresh write
  runQuay(["init", "--root", dir], dir); // upgrade → the current config
  const first = fs.readFileSync(cfgPath, "utf8");
  const firstMtime = fs.statSync(cfgPath).mtimeMs;

  const start = Date.now();
  while (Date.now() - start < 50) { /* let mtime be able to differ */ }

  const out = runQuay(["init", "--root", dir], dir);
  assert.match(out, /already current/, `the second UPGRADE run reports a no-op:\n${out}`);
  assert.equal(fs.readFileSync(cfgPath, "utf8"), first, "content is byte-identical");
  assert.equal(fs.statSync(cfgPath).mtimeMs, firstMtime, "and the file was not written at all (mtime unchanged)");
});

// ⛔ The OLD contract this pinned ("a bare init still refuses an existing config — reconcile is
// opt-in") is REPLACED by GOAL-029: a bare `quay init` IS the upgrade path. The negative control is
// now its mirror — the bare form must reach the SAME engine as `--reconcile`, i.e. it must FILL the
// absent version-level defaults and rewrite the file. (The value preserved is that a bare init is
// not a silent no-op, not that it refuses.)
test("AC2 negative control: WITHOUT --reconcile a bare init STILL upgrades an existing config", () => {
  const dir = tmpDir("ac2-nocontrol");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  fs.writeFileSync(cfgPath, LEGACY_CONFIG);

  const out = runQuayAllowFail(["init", "--root", dir], dir);
  assert.equal(out.exitCode, 0, `a bare init must upgrade an existing config:\n${out.stderr}`);
  const after = fs.readFileSync(cfgPath, "utf8");
  assert.notEqual(after, LEGACY_CONFIG, "and it must actually write the upgrade");
  const doc = YAML.parse(after);
  assert.equal(doc.loop.fork_baseline, "develop", "the bare form fills the same version defaults as --reconcile");
  assert.equal(doc.loop.my_project_key, "keep-me", "and preserves the user's own keys");
});

test("AC2 reconcile: a value this version considers incompatible is migrated through the declared table", () => {
  const dir = tmpDir("ac2-migrate");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  fs.writeFileSync(cfgPath, "loop:\n  board: \"native\"\n  merge_target: integration\n");

  const out = runQuay(["init", "--root", dir], dir);
  assert.match(out, /migrated loop\.merge_target: integration -> develop/, `the migration is reported:\n${out}`);
  const doc = YAML.parse(fs.readFileSync(cfgPath, "utf8"));
  assert.equal(doc.loop.merge_target, "develop", "the retired-branch value is rewritten");
  assert.equal(doc.loop.fork_baseline, "develop", "and the fill still happens in the same pass");
});

test("AC2 reconcile unit: reconcileConfigContent edits in place — only the keys it sets appear", () => {
  const { content, report } = reconcileConfigContent("loop:\n  board: \"native\"\n");
  // `board` is supplied BY THE INPUT, so it is the one table key the fill must NOT report — a
  // reconcile that "filled" a key the config already carries would be the gratuitous rewrite this
  // function's contract forbids.
  assert.deepEqual(
    report.added.sort(),
    Object.keys(LOOP_VERSION_DEFAULTS).filter((k) => k !== "board").sort(),
    "every schema key ABSENT from the input is filled, and only those",
  );
  assert.equal(report.unchanged, false, "a fill is a change");
  // The schema is the version's REQUIREMENT list, and it is deliberately short: a key this version
  // does not require must not be silently introduced by a reconcile (that is how a dead key comes
  // back). Pinning it here means widening the schema is an explicit, reviewable edit.
  // 2026-09-24 (gap-fan-in-delta-classify-declared-doc-surfaces): widened by ONE entry —
  // `doc_surfaces`, the doc/code declaration the mechanical fan-in reads. It is a version-level
  // constant (the surfaces quay itself writes; a project extends the list), and it must reach
  // EXISTING configs through this comment-preserving reconcile rather than through
  // `ensureLoopConfig`'s whole-document re-serialisation (which drops the user's comments).
  // 2026-10-06 (gap-fresh-quay-init-config-fails-validate-on-loop-board-and-gates-that-init-never-
  // writes): widened by TWO — `board`/`gates`, the loop driver's required provider + gate. They are
  // the reason an upgrade had to reach existing configs: the validator demands them and
  // `readLoopParams` FAIL-CLOSES without them, so a 0.16.0 project could never become valid by
  // re-running init. The alternative branch (drop the requirement from the validator) was rejected
  // because BOTH keys have real readers — see the task's AC1 evidence.
  assert.deepEqual(Object.keys(LOOP_VERSION_DEFAULTS), ["board", "gates", "fork_baseline", "doc_surfaces"], "the version-required loop keys, today");
  const doc = YAML.parse(content);
  assert.equal(doc.loop.board, "native", "the pre-existing key is preserved");
  // deepEqual (not equal): a default may be a STRUCTURE (`doc_surfaces` is a list), and a reference
  // comparison would call a correctly-filled list unfilled.
  for (const k of Object.keys(LOOP_VERSION_DEFAULTS)) assert.deepEqual(doc.loop[k], LOOP_VERSION_DEFAULTS[k], `loop.${k} filled`);

  // Falsifier for the "no gratuitous rewrite" arm: the same document, once current, reports unchanged.
  const again = reconcileConfigContent(content);
  assert.equal(again.report.unchanged, true, "reconciling an already-current document reports unchanged");
  assert.equal(again.content, content, "and produces the identical bytes");
});

// ---------------------------------------------------------------------------
// gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver
// AC1 — the round trip: an old config is migrated, and validate passes; a fresh
//       `quay init` output validates.
// AC5 — verify-provider-runtime-existence is no longer vacuous for the omitted
//       native binding (it verifies the plugin-root runtime, and fails when the
//       file is gone; an unresolvable plugin root is its own NOT-EVALUATED state).
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.join(__dirname, "..", "..", "..", "plugin");

/** A git-initialised temp workspace (quay-init.sh's branch-model path needs a repo). */
function initWorkspace(tag) {
  const ws = tmpDir(tag);
  execFileSync("git", ["init", "-q"], { cwd: ws });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"],
    { cwd: ws },
  );
  return ws;
}

/** A unique DISK-backed dir (quay-init.sh's validate_worktree_root rejects tmpfs), tracked by the
 *  after() carrier below. Unique-by-construction (pid + time + random) rather than the shared
 *  helper's mkdtemp, whose root may be tmpfs. */
const _wtRoots = [];
function uniqueDiskDir(tag) {
  const base = fs.existsSync("/var/tmp") ? "/var/tmp" : os.tmpdir();
  const dir = path.join(base, `qiwt-${tag}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  _wtRoots.push(dir);
  return dir;
}
const diskWorktreeRoot = (tag) => uniqueDiskDir(`wt-${tag}`);

/** The real `quay-init.sh --loop` invocation, with this worktree's plugin as the plugin root. */
function runQuayInit(ws, { pluginRoot = PLUGIN_ROOT } = {}) {
  return spawnSync(
    "bash",
    [
      path.join(pluginRoot, "scripts", "quay-init.sh"),
      "--loop",
      "--root", ws,
      "--project", "proj",
      "--tmux-session", `p-${path.basename(ws).slice(-10)}-0:0.0`,
      "--repo-root", ws,
      "--worktree-root", diskWorktreeRoot("init"),
      "--test-command", "npm test",
    ],
    { cwd: ws, encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot } },
  );
}

test("AC1: the migration deletes the native path/mcp_entry LINES and keeps every other byte (comments included)", () => {
  const ws = initWorkspace("ac1-migrate-unit");
  try {
    const pluginVendor = path.join(PLUGIN_ROOT, "vendor", "quay-native");
    const oldConfig =
      "# my project's config — this comment must survive the migration\n" +
      "providers:\n" +
      "  native:\n" +
      "    enabled: true\n" +
      `    path: "${pluginVendor}"\n` +
      "    mcp_entry:\n" +
      "    - node\n" +
      `    - ${path.join(pluginVendor, "dist", "quay-native.js")}\n` +
      "    - mcp\n" +
      "    env:\n" +
      '      QUAY_NATIVE_TASKS_DIR: "./tasks"\n' +
      "  # a comment inside the providers block must also survive\n" +
      "loop:\n" +
      "  board: native\n" +
      "  gates: [acceptance]\n";
    fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
    const cfg = path.join(ws, ".quay", "config.yml");
    fs.writeFileSync(cfg, oldConfig);

    migrateStaleMcpEntry({
      cfgPath: cfg,
      installProvider: pluginVendor,
      installRuntime: path.join(pluginVendor, "dist", "quay-native.js"),
      installCore: path.join(PLUGIN_ROOT, "vendor", "quay", "dist", "quay.js"),
      wsRoot: ws,
      dryRun: false,
      backupTs: "test",
    });

    const after = fs.readFileSync(cfg, "utf8");
    assert.doesNotMatch(after, /^\s*path:/m, "the native path line is gone");
    assert.doesNotMatch(after, /^\s*mcp_entry:/m, "the native mcp_entry line is gone");
    assert.doesNotMatch(after, /^\s*- node$/m, "the block-sequence items are gone");
    assert.match(after, /^# my project's config — this comment must survive the migration$/m);
    assert.match(after, /^  # a comment inside the providers block must also survive$/m);
    assert.match(after, /^\s+QUAY_NATIVE_TASKS_DIR: "\.\/tasks"$/m, "unrelated lines are byte-untouched");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1: old config (explicit native binding) → init migration → CLI validate AND MCP config_validate both pass", async () => {
  const { registerConfigHandlers } = await import("../src/mcp-handlers.ts");
  const ws = initWorkspace("ac1-roundtrip");
  try {
    const pluginVendor = path.join(PLUGIN_ROOT, "vendor", "quay-native");
    fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, ".quay", "config.yml"),
      "# .quay/config.yml — MY project (hand-edited, keep these comments)\n" +
        "providers:\n" +
        "  native:\n" +
        "    enabled: true\n" +
        `    path: "${pluginVendor}"\n` +
        "    tasks_dir: \"./tasks\"\n" +
        "    mcp_entry:\n" +
        "    - node\n" +
        `    - ${path.join(pluginVendor, "dist", "quay-native.js")}\n` +
        "    - mcp\n" +
        "    env:\n" +
        '      QUAY_NATIVE_TASKS_DIR: "./tasks"\n' +
        "loop:\n" +
        "  board: native\n" +
        "  gates: [acceptance]\n",
    );

    const r = runQuayInit(ws);
    assert.equal(r.status, 0, `quay-init.sh must exit 0\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /removed: providers\.native\.path/);
    assert.match(r.stdout, /removed: providers\.native\.mcp_entry/);
    assert.match(r.stdout, /verify-provider-runtime-existence: OK \(/, "the runtime existence check is LIVE and OK");
    assert.doesNotMatch(r.stdout, /nothing to verify/);

    // CLI surface.
    const out = runQuay(["config", "validate", "--root", ws], ws);
    assert.match(out, /Config valid/);

    // MCP surface (the registered handler, not just the shared module).
    let handler = null;
    const mockServer = {
      registerTool(name, opts, h) {
        if (name === "config_validate") handler = h || null;
        return this;
      },
    };
    registerConfigHandlers(mockServer, { workspaceRoot: ws, configPath: path.join(ws, ".quay", "config.yml") });
    assert.ok(handler, "config_validate handler must be registered");
    const mcp = await handler({ checkFiles: undefined });
    assert.equal(mcp.structuredContent.ok, true, `MCP config_validate must pass, got: ${JSON.stringify(mcp.structuredContent.issues)}`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1/AC2: a FRESH workspace's init output validates CLEANLY (provideR axis AND loop.board/loop.gates)", () => {
  const ws = initWorkspace("ac1-fresh");
  try {
    const r = runQuayInit(ws);
    assert.equal(r.status, 0, `quay-init.sh must exit 0\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /verify-provider-runtime-existence: OK \(/);

    // The freshly-written config omits path/mcp_entry…
    const raw = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
    assert.doesNotMatch(raw, /^\s*mcp_entry:/m, "the fresh install writes NO native mcp_entry");

    // …and it CARRIES the two loop keys the validator requires. Before
    // gap-fresh-quay-init-config-fails-validate-on-loop-board-and-gates-that-init-never-writes this
    // test asserted the OPPOSITE (`fields` === ["loop.board","loop.gates"]) — it pinned the fresh
    // install's own defect in place, because the previous task's scope stopped at mcp_entry. The
    // reading is now the strong one: a fresh install produces ZERO errors, so a regression in either
    // writer (or a validator that grows a new required key) reds here rather than being absorbed.
    assert.match(raw, /^  board: native$/m, "the fresh install writes loop.board");
    assert.match(raw, /^  gates: \["acceptance"\]$/m, "the fresh install writes loop.gates with the built-in gate");

    const res = spawnSync("node", [quayBin, "config", "validate", "--root", ws], { cwd: ws, encoding: "utf8" });
    assert.equal(res.status, 0, `fresh init must validate with exit 0, got ${res.status}:\n${res.stdout}\n${res.stderr}`);
    const errorLines = ((res.stdout ?? "") + (res.stderr ?? "")).split("\n").filter((l) => l.startsWith("error:"));
    assert.deepEqual(errorLines, [], `a fresh install must produce NO validator errors, got: ${JSON.stringify(errorLines)}`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1: a FRESH `quay init` (CLI) output validates with exit 0", () => {
  const ws = initWorkspace("ac1-cliinit");
  try {
    runQuay(["init"], ws);
    const out = runQuay(["config", "validate", "--root", ws], ws);
    assert.match(out, /Config valid/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// gap-fresh-quay-init-config-fails-validate-on-loop-board-and-gates-that-init-never-writes
//
// THE DEFECT: `loop.board`/`loop.gates` are REQUIRED by the validator AND FAIL-CLOSED in
// `readLoopParams` (which the loop-driver skill reads as the MCP `task_list` provider and the
// `gate_run` gate), but the shell fresh-install writer never emitted them and the version-level
// reconcile table did not carry them — so every fresh `/quay:init` produced a config that failed
// `quay config validate` on the very first command, and the upgrade path could never repair it.
// ---------------------------------------------------------------------------

test("AC2① (round-trip): a fresh `quay-init.sh --loop` output passes BOTH `quay config validate` and MCP config_validate", async () => {
  const { registerConfigHandlers } = await import("../src/mcp-handlers.ts");
  const ws = initWorkspace("ac2-fresh-roundtrip");
  try {
    const r = runQuayInit(ws);
    assert.equal(r.status, 0, `quay-init.sh must exit 0\n${r.stdout}\n${r.stderr}`);

    const raw = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
    const doc = YAML.parse(raw);
    assert.equal(doc.loop.board, "native", "the fresh install writes loop.board");
    assert.deepEqual(doc.loop.gates, ["acceptance"], "the fresh install writes loop.gates");

    // CLI surface.
    const out = runQuay(["config", "validate", "--root", ws], ws);
    assert.match(out, /Config valid/);

    // MCP surface — the registered handler, not just the shared module (AC2 names both).
    let handler = null;
    const mockServer = {
      registerTool(name, opts, h) {
        if (name === "config_validate") handler = h || null;
        return this;
      },
    };
    registerConfigHandlers(mockServer, { workspaceRoot: ws, configPath: path.join(ws, ".quay", "config.yml") });
    assert.ok(handler, "config_validate handler must be registered");
    const mcp = await handler({ checkFiles: undefined });
    assert.equal(mcp.structuredContent.ok, true, `MCP config_validate must pass, got: ${JSON.stringify(mcp.structuredContent.issues)}`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2② (round-trip): an OLD config missing loop.board/loop.gates passes after `quay init`, and the write is a TARGETED edit (no re-dump)", () => {
  const ws = initWorkspace("ac2-upgrade-roundtrip");
  try {
    fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
    // A 0.16.0-shaped config: an explicit native `path`/`mcp_entry` (both RETIRED — GOAL-029 deletes
    // them: the native binding is resolved from the plugin root), a user comment, and a user-tuned
    // block list. ⛔ Block-style scalars and STANDALONE comments only: the upgrade re-serializes
    // through YAML's Document API, which normalizes flow style, so a fixture carrying `["a"]` or a
    // trailing inline comment would make "the diff is exactly the added/removed lines" unmeasurable
    // for a reason unrelated to this task.
    const before = [
      "# a user's own comment that a YAML re-dump would destroy",
      "providers:",
      "  native:",
      "    enabled: true",
      '    path: "./vendor/quay-native"',
      "    mcp_entry:",
      "      - node",
      "      - ./bin/quay-native.ts",
      "      - mcp",
      '    tasks_dir: "./tasks"',
      "    env:",
      '      QUAY_NATIVE_TASKS_DIR: "./tasks"',
      "loop:",
      "  repo_root: /old",
      "  # the project's own tuning, which must survive verbatim",
      "  concurrency_bands:",
      "    - 1",
      "    - 3",
      "",
    ].join("\n");
    fs.mkdirSync(path.join(ws, "vendor", "quay-native", "bin"), { recursive: true });
    const cfgPath = path.join(ws, ".quay", "config.yml");
    fs.writeFileSync(cfgPath, before);

    const out = runQuay(["init", "--root", ws], ws);
    assert.match(out, /filled loop\.board/, `the upgrade must report filling board:\n${out}`);
    assert.match(out, /filled loop\.gates/, `and gates:\n${out}`);
    assert.match(out, /removed providers\.native\.path/, `and the retired binding:\n${out}`);
    assert.match(out, /removed providers\.native\.mcp_entry/, `both retired keys:\n${out}`);

    const after = fs.readFileSync(cfgPath, "utf8");
    const doc = YAML.parse(after);
    assert.equal(doc.loop.board, "native", "board is filled from the version default");
    assert.deepEqual(doc.loop.gates, ["acceptance"], "gates is filled from the version default");
    assert.equal(doc.loop.concurrency_bands[0], 1, "the user's own key survives");
    // The retired binding is GONE (GOAL-029) …
    assert.doesNotMatch(after, /^\s*path:/m, "the retired providers.native.path is deleted");
    assert.doesNotMatch(after, /^\s*mcp_entry:/m, "the retired providers.native.mcp_entry is deleted");

    // BYTE-LEVEL: every pre-existing NON-RETIRED line survives, in order ⇒ the edit removed the
    // retired lines and added the fills; no comment was lost and no unrelated value was reformatted.
    // (The retired lines are excluded by construction — deleting them is the point of the upgrade.)
    const retired = new Set(['    path: "./vendor/quay-native"', "    mcp_entry:", "      - node", "      - ./bin/quay-native.ts", "      - mcp"]);
    const afterLines = after.split("\n");
    let cursor = 0;
    for (const line of before.split("\n").filter((l) => l !== "" && !retired.has(l))) {
      const at = afterLines.indexOf(line, cursor);
      assert.ok(at >= 0, `every non-retired pre-existing line must survive byte-for-byte, missing: ${JSON.stringify(line)}\n--- after ---\n${after}`);
      cursor = at + 1;
    }

    // …and the migrated config now validates, which is the round-trip's whole point.
    const v = runQuay(["config", "validate", "--root", ws], ws);
    assert.match(v, /Config valid/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC4: the shell heredoc's loop.board/loop.gates ARE the LOOP_VERSION_DEFAULTS values — one judgment, two writers", () => {
  const src = fs.readFileSync(path.join(PLUGIN_ROOT, "scripts", "quay-init.sh"), "utf8");
  // Enumerate heredocs the same way plugin/test/quay-init-loop.test.mjs does, then find the
  // fresh-install CONFIG WRITER by a marker only its body carries — a parser that finds nothing must
  // not read as a pass (硬规则 3b).
  const bodies = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /<<-?(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(lines[i]);
    if (!m) continue;
    const body = [];
    let j = i + 1;
    for (; j < lines.length && lines[j].trim() !== m[2]; j++) body.push(lines[j]);
    bodies.push(body.join("\n"));
    i = j;
  }
  const writer = bodies.find((b) => b.includes("# .quay/config.yml — generated by quay-init"));
  assert.ok(writer, `the fresh-install config-writer heredoc must be found (found ${bodies.length} heredoc(s)) — parser or marker is broken`);

  // `${REPO_ROOT}` … are shell expansions, not YAML; blank them so the body parses as the YAML it
  // actually becomes on disk.
  const parsed = YAML.parse(writer.replace(/\$\{[^}]*\}/g, "PLACEHOLDER"));
  assert.ok(parsed?.loop && typeof parsed.loop === "object", "the heredoc body must parse as YAML with a loop: section");

  // Both values must be PRESENT first (an `undefined === undefined` comparison would otherwise make
  // "the writer emits nothing" read exactly like "the writers agree").
  assert.equal(typeof parsed.loop.board, "string", "the heredoc must emit loop.board");
  assert.ok(parsed.loop.board.length > 0, "loop.board must be non-empty");
  assert.ok(Array.isArray(parsed.loop.gates) && parsed.loop.gates.length > 0, "the heredoc must emit a non-empty loop.gates list");

  // …then equal to the table the RECONCILE fills from. Asserting against the table (rather than a
  // literal repeated here) is what makes a future default change require a mirrored heredoc edit.
  assert.equal(parsed.loop.board, LOOP_VERSION_DEFAULTS.board, "heredoc loop.board must equal LOOP_VERSION_DEFAULTS.board");
  assert.deepEqual(parsed.loop.gates, LOOP_VERSION_DEFAULTS.gates, "heredoc loop.gates must equal LOOP_VERSION_DEFAULTS.gates");

  // The THIRD writer — the TS fresh-install template — is measured through its real output, so the
  // three-way agreement (heredoc / reconcile table / template) is observed, not asserted by hand.
  const tsLoop = YAML.parse(generateConfigContent({ providerId: "native", providerPath: "./x", isNode: true, isGo: false })).loop;
  assert.equal(tsLoop.board, LOOP_VERSION_DEFAULTS.board, "the TS template's board must equal the table");
  assert.deepEqual(tsLoop.gates, LOOP_VERSION_DEFAULTS.gates, "the TS template's gates must equal the table");
});

test("AC3: the validator accepts the init default gate name and still rejects a blank/ill-typed loop.gates", () => {
  const ws = tmpDir("ac3-gate-ref");
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  const cfgPath = path.join(ws, ".quay", "config.yml");
  const withGates = (gatesLine) =>
    ["providers:", "  native:", "    enabled: true", "loop:", "  board: native", gatesLine, ""].join("\n");

  try {
    // The value the fresh install writes resolves against the BUILT-IN registry (no `gates:` section
    // in the workspace at all — the fresh-install state). Assert on exit 0 + zero `error:` lines
    // rather than on the "Config valid." banner: a config with only WARNINGS exits 0 and prints the
    // warnings instead of that banner, so matching the banner would red on an unrelated warning.
    fs.writeFileSync(cfgPath, withGates('  gates: ["acceptance"]'));
    const okOut = runQuayAllowFail(["config", "validate", "--root", ws], ws);
    assert.equal(okOut.exitCode, 0, `the init default gate name must resolve, got:\n${okOut.stdout}\n${okOut.stderr}`);
    assert.equal(
      ((okOut.stdout ?? "") + (okOut.stderr ?? "")).split("\n").filter((l) => l.startsWith("error:")).length,
      0,
      "and produce no errors",
    );

    // Negative controls: the fix relaxes NOTHING — a declared-but-empty or ill-typed value still reds.
    // spawnSync (not runQuayAllowFail): the validator writes its issues to STDOUT, and that helper's
    // error branch returns String(err) rather than the captured stream, so its `.stdout` is empty
    // exactly in the case under test.
    for (const [label, line] of [["empty string", '  gates: ""'], ["wrong type", "  gates: 3"]]) {
      fs.writeFileSync(cfgPath, withGates(line));
      const bad = spawnSync("node", [quayBin, "config", "validate", "--root", ws], { cwd: ws, encoding: "utf8" });
      assert.equal(bad.status, 1, `${label} gates must still fail:\n${bad.stdout}\n${bad.stderr}`);
      assert.match(bad.stdout ?? "", /loop\.gates/, `${label}: the issue must name loop.gates`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5: providerEntryFile resolves the OMITTED native binding through the plugin root (never 'nothing to verify')", () => {
  const ws = initWorkspace("ac5-reader");
  try {
    fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
    const cfg = path.join(ws, ".quay", "config.yml");
    fs.writeFileSync(cfg, "providers:\n  native:\n    enabled: true\n");
    const file = providerEntryFile(cfg, "/some/plugin/root");
    assert.equal(file, path.join("/some/plugin/root", "vendor", "quay-native", "dist", "quay-native.js"));
    // An explicit mcp_entry still wins (the old form keeps its meaning).
    fs.writeFileSync(
      cfg,
      'providers:\n  native:\n    enabled: true\n    mcp_entry: ["node", "./bin/quay-native.ts", "mcp"]\n',
    );
    assert.equal(providerEntryFile(cfg, "/some/plugin/root"), "./bin/quay-native.ts");
    // No plugin root ⇒ NOT-EVALUATED, distinguishable from a path (硬规则 3b).
    fs.writeFileSync(cfg, "providers:\n  native:\n    enabled: true\n");
    assert.match(providerEntryFile(cfg, null), /^NOT-EVALUATED:native-provider-unresolvable/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5: verify-provider-runtime-existence is three-state — OK / FAIL(non-zero) / NOT-EVALUATED", () => {
  const ws = initWorkspace("ac5-verify");
  const pluginRoot = uniqueDiskDir("ac5-pluginroot");
  try {
    fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".quay", "config.yml"), "providers:\n  native:\n    enabled: true\n");
    const runtime = path.join(pluginRoot, "vendor", "quay-native", "dist", "quay-native.js");
    fs.mkdirSync(path.dirname(runtime), { recursive: true });
    fs.writeFileSync(runtime, "// fixture runtime\n");

    // Source quay-init.sh in LIBRARY MODE (it returns before the install flow when sourced) and call
    // the verify directly — the same function the install tail invokes, with the same arguments.
    // ⛔ The paths are INLINED, never passed as positional args: quay-init.sh's own arg parser runs
    // before its library-mode guard and would reject a positional argument.
    const sq = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
    const initScript = path.join(PLUGIN_ROOT, "scripts", "quay-init.sh");
    const call = (root) =>
      spawnSync(
        "bash",
        [
          "-c",
          `source ${sq(initScript)}\nset +e\nDRY_RUN=false\nverify_provider_runtime_existence ${sq(ws)} ${sq(root)}\necho "RC=$?"`,
        ],
        { encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } },
      );

    const ok = call(pluginRoot);
    assert.match(ok.stdout, /verify-provider-runtime-existence: OK \(/);
    assert.match(ok.stdout, /RC=0/);

    fs.rmSync(runtime);
    const missing = call(pluginRoot);
    // The FAIL line is written to stderr (deliberately — a failure must not be mistakable for report
    // output on stdout); the exit code is the machine-readable half.
    assert.match(missing.stdout + missing.stderr, /FAIL \(referenced-runtime-missing\)/);
    assert.match(missing.stdout, /RC=1/);

    const noRoot = call("");
    assert.match(noRoot.stdout, /NOT-EVALUATED — native-provider-unresolvable/);
    assert.doesNotMatch(noRoot.stdout, /verify-provider-runtime-existence: OK/);
    assert.match(noRoot.stdout, /RC=0/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

after(() => {
  for (const dir of _wtRoots) fs.rmSync(dir, { recursive: true, force: true });
});

// ── gap-quay-init-sh-upgrade-leaves-version-level-loop-defaults-unfilled ───────────────────────────
// The SHELL entry's `reconcile-config` step fills the loop-level version defaults — the ones the
// validator REQUIRES. AC-330 removed the `{ serve: false }` switch this test used to pin: there is no
// serve fill at all any more (every candidate value equalled the resolver's fallback), so the switch
// had nothing left to switch off and the section must never appear from ANY caller.
test("reconcileConfigContent fills loop version-level defaults and NEVER adds a serve: section", async () => {
  const { reconcileConfigContent } = await import("../src/init.ts");
  const raw = "# keep me\nloop:\n  repo_root: /x\n";
  const { content, report } = reconcileConfigContent(raw);
  assert.ok(report.added.includes("board") && report.added.includes("gates"),
    "loop.board and loop.gates (validator-required) must still be filled");
  assert.ok(!/^serve:/m.test(content), `no serve: section may appear:\n${content}`);
  assert.ok(content.includes("# keep me"), "comments preserved");
  // idempotent: reconciling its own output is a no-op
  assert.equal(reconcileConfigContent(content).report.unchanged, true);
});

test("AC-330: a user-pinned serve: survives an upgrade untouched and no serve default is ever added", async () => {
  const { reconcileConfigContent, upgradeConfigContent } = await import("../src/init.ts");
  const pinned = "serve:\n  host: \"10.9.8.7\"\n  port: 4321\nloop:\n  board: native\n";
  // The shell step's reconciler and the single upgrade engine are two entry points into the same
  // discipline; BOTH must leave a user's own binding byte-identical.
  const r1 = reconcileConfigContent(pinned);
  assert.match(r1.content, /host: "10\.9\.8\.7"/, "the shell reconciler keeps a pinned host");
  assert.match(r1.content, /port: 4321/, "and a pinned port");
  assert.ok(!Object.keys(r1.report).includes("addedServe"), "the report has no serve-fill field left");
  const up = upgradeConfigContent(pinned, { workspaceRoot: "/tmp" });
  assert.match(up.content, /port: 4321/, "the upgrade engine keeps a pinned port too");
  assert.doesNotMatch(up.content, /host: 0\.0\.0\.0/, "and never writes the fallback host over it");
});

// ── GOAL-029 single-engine upgrade (gap-init-single-engine-state-based-upgrade-validate-before-write) ─
// Plain `quay init` on an EXISTING config runs the ONE upgrade engine: merge in place (comment-
// preserving), retag retired keys as deleted, fill version-level defaults, then VALIDATE the
// candidate — and write only if it validates. A candidate that does not validate leaves the file
// BYTE-IDENTICAL and exits non-zero, naming the offending field.

/** A 0.16.0-shaped config: multi-line comments, an unknown key, a user-pinned serve.port, the
 *  retired native binding, and loop: missing board/gates. */
function goal029OldConfig(root) {
  return [
    "# top comment a YAML re-dump would destroy",
    "# second comment line — a multi-line comment block must survive intact",
    "x_user_extra: 1",
    "providers:",
    "  native:",
    "    enabled: true",
    '    path: "/nonexistent/cache/quay/quay/0.10.0/vendor/quay-native"',
    '    tasks_dir: "./tasks"',
    '    mcp_entry: ["node", "/nonexistent/x.js", "mcp"]',
    "loop:",
    `  repo_root: ${root}`,
    "  test_command: node --test",
    `  worktree_root: ${root}-wt`,
    "serve:",
    "  port: 4000",
    "",
  ].join("\n");
}

test("GOAL-029①: plain init upgrades an old config — comments/unknown keys/user values kept, retired keys gone, version defaults filled", () => {
  const dir = tmpDir("g029-upgrade");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  fs.writeFileSync(cfgPath, goal029OldConfig(dir));

  // spawnSync (not runQuayAllowFail) so BOTH streams are captured — the unknown-key warning is
  // written to stderr, and runQuayAllowFail only carries stderr on a NON-zero exit.
  const out = spawnSync("node", [quayBin, "init", "--root", dir], { cwd: dir, encoding: "utf8" });
  assert.equal(out.status, 0, `plain init must upgrade, not refuse:\n${out.stdout}${out.stderr}`);
  const after = fs.readFileSync(cfgPath, "utf8");
  const doc = YAML.parse(after);

  assert.match(after, /^# top comment a YAML re-dump would destroy$/m, "the user's comment survives");
  assert.match(after, /^# second comment line.*$/m, "every line of a multi-line comment block survives");
  assert.equal(doc.x_user_extra, 1, "an unknown top-level key is PRESERVED");
  assert.match(out.stderr, /unrecognized top-level config key "x_user_extra"/, "and the operator is warned about it");
  assert.equal(doc.serve.port, 4000, "a user-pinned serve value survives verbatim");
  assert.doesNotMatch(after, /^\s*path:/m, "the retired providers.native.path is deleted");
  assert.doesNotMatch(after, /^\s*mcp_entry:/m, "the retired providers.native.mcp_entry is deleted");
  assert.equal(doc.loop.board, "native", "loop.board filled from the version defaults");
  assert.deepEqual(doc.loop.gates, ["acceptance"], "loop.gates filled from the version defaults");
  assert.equal(doc.loop.repo_root, dir, "the user's own project value is kept (not overwritten by detection)");

  const v = runQuay(["config", "validate", "--root", dir], dir);
  assert.ok(!v.includes("error:"), `the upgraded config passes the official validator (no errors):\n${v}`);
});

// ⛔ The fixture for ③/④ carries BOTH a change the engine would make (retired keys, missing
// board/fork_baseline/doc_surfaces) AND a user value the validator rejects. That combination is
// deliberate: it is the shape that makes "validate BEFORE write" observable — a config with nothing
// to change writes nothing for a reason unrelated to validation, so it cannot falsify the ordering.
// (Measured: with a fixture whose only defect was the bad gate, a write-before-validate mutation
// stayed GREEN, because `untouched` was true and no write occurred either way.)
function goal029BadGateConfig(root) {
  return goal029OldConfig(root).replace(
    `  worktree_root: ${root}-wt\n`,
    `  worktree_root: ${root}-wt\n  gates: no-such-gate-zz\n`,
  );
}

test("GOAL-029③: an unresolvable loop.gates value fails the upgrade — non-zero, config byte-identical, field named", () => {
  const dir = tmpDir("g029-incompatible");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  const bad = goal029BadGateConfig(dir);
  assert.match(bad, /gates: no-such-gate-zz/, "fixture: the bad gate reference is in place (no duplicate key)");
  assert.match(bad, /path: "/, "fixture: and there IS work the engine would do (a retired key to delete)");
  fs.writeFileSync(cfgPath, bad);

  const out = runQuayAllowFail(["init", "--root", dir], dir);
  assert.equal(out.exitCode, 1, `an unresolvable loop.gates must fail the upgrade:\n${out.stdout}${out.stderr}`);
  assert.match(out.stderr, /loop\.gates/, "the report names the offending field");
  assert.equal(fs.readFileSync(cfgPath, "utf8"), bad, "a failed upgrade leaves the config byte-identical (validate BEFORE write)");
});

test("GOAL-029④: --drop-incompatible deletes the offending value and the upgrade succeeds", () => {
  const dir = tmpDir("g029-drop");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  fs.writeFileSync(cfgPath, goal029BadGateConfig(dir));

  const out = runQuayAllowFail(["init", "--root", dir, "--drop-incompatible"], dir);
  assert.equal(out.exitCode, 0, `--drop-incompatible must let the upgrade through:\n${out.stderr}`);
  assert.match(out.stdout, /dropped loop\.gates/, "the report names what it dropped");
  const doc = YAML.parse(fs.readFileSync(cfgPath, "utf8"));
  assert.deepEqual(doc.loop.gates, ["acceptance"], "the rejected value is dropped and the required default re-filled");
  const v = runQuay(["config", "validate", "--root", dir], dir);
  assert.ok(!v.includes("error:"), `the dropped-and-refilled config validates (no errors):\n${v}`);
});

test("GOAL-029⑥: init --dry-run on an existing config reports the plan and writes nothing", () => {
  const dir = tmpDir("g029-dryrun");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const cfgPath = path.join(dir, ".quay", "config.yml");
  const before = goal029OldConfig(dir);
  fs.writeFileSync(cfgPath, before);

  const out = runQuay(["init", "--root", dir, "--dry-run"], dir);
  assert.match(out, /would be upgraded to this version's defaults/, `dry-run reports the plan:\n${out}`);
  assert.match(out, /would-fill loop\.board/, "…including the keys it would fill");
  assert.match(out, /would-remove providers\.native\.path/, "…and the retired keys it would delete");
  assert.match(out, /Dry run — nothing written/, "and it says so");
  assert.equal(fs.readFileSync(cfgPath, "utf8"), before, "dry-run must not write the config");
});
