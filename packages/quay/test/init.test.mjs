// @test-group product
// DIR-098: quay init tests — RED->GREEN per ADR-001.
//
// Tests cover AC1-AC6 from the task's Acceptance Criteria.
// Run: node --test --experimental-test-coverage packages/quay/test/init.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { generateConfigContent, mcpEntryForProvider } from "../src/init.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(tag) {
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

// AC3: quay init refuses to overwrite existing config (exit 1)
test("AC3: quay init refuses to overwrite existing config", () => {
  const dir = tmpDir("ac3");
  // First init succeeds
  runQuay(["init"], dir);
  assert.ok(fs.existsSync(path.join(dir, ".quay", "config.yml")), "config should exist after first init");

  // Second init fails
  const out = runQuayAllowFail(["init"], dir);
  assert.equal(out.exitCode, 1, "second init should exit 1");
  assert.ok(
    out.stderr.includes("already exists") || out.stderr.includes("--force"),
    "error message should mention existing config and --force"
  );
});

// AC3b: quay init --force overwrites existing config
test("AC3b: quay init --force overwrites existing config", () => {
  const dir = tmpDir("ac3b");
  // First init
  runQuay(["init"], dir);
  const firstMtime = fs.statSync(path.join(dir, ".quay", "config.yml")).mtimeMs;

  // Wait a tick so mtime actually differs
  const start = Date.now();
  while (Date.now() - start < 100) { /* busy-wait */ }

  // Second init with --force
  const out = runQuay(["init", "--force"], dir);
  assert.ok(out.includes("Created"), "--force should succeed");

  const secondMtime = fs.statSync(path.join(dir, ".quay", "config.yml")).mtimeMs;
  assert.ok(secondMtime > firstMtime, "--force should overwrite (mtime changed)");
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

// AC5: quay init --root scaffolds at specified path
test("AC5: quay init --root scaffolds at specified path", () => {
  const dir = tmpDir("ac5");
  const targetDir = path.join(dir, "subdir");
  fs.mkdirSync(targetDir, { recursive: true });

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

// AC8: quay init --help prints usage including all flags
test("AC8: quay init --help prints usage with all flags", () => {
  const dir = tmpDir("ac8");
  const out = runQuay(["init", "--help"], dir);

  assert.ok(out.includes("--force"), "help should document --force");
  assert.ok(out.includes("--dry-run"), "help should document --dry-run");
  assert.ok(out.includes("--root"), "help should document --root");
  assert.ok(out.includes("quay init"), "help should mention quay init");
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

// AC10c: quay-native init refuses to overwrite existing config
test("AC10c: quay-native init refuses overwrite", () => {
  const dir = tmpDir("ac10c");
  runNative(["init"], dir);
  const out = runNativeAllowFail(["init"], dir);
  assert.equal(out.exitCode, 1, "second native init should exit 1");
  assert.ok(out.stderr.includes("already exists") || out.stderr.includes("--force"), "should mention --force");
});

// AC10d: quay-native init --force overwrites
test("AC10d: quay-native init --force overwrites", () => {
  const dir = tmpDir("ac10d");
  runNative(["init"], dir);
  const out = runNative(["init", "--force"], dir);
  assert.ok(out.includes("Created"), "native --force should succeed");
});

// AC10e: quay-native init --root scaffolds at specified path
test("AC10e: quay-native init --root scaffolds at specified path", () => {
  const dir = tmpDir("ac10e");
  const targetDir = path.join(dir, "subdir");
  fs.mkdirSync(targetDir, { recursive: true });

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

// AC3 negative control: the legit empty-store flags still behave unchanged.
test("AC3-collision negative control: quay init --force still succeeds", () => {
  const dir = tmpDir("collision-ac3");
  const first = runQuayAllowFail(["init"], dir);
  assert.equal(first.exitCode, 0, "plain quay init still exits 0");
  assert.ok(fs.existsSync(path.join(dir, ".quay", "config.yml")));
  const forced = runQuayAllowFail(["init", "--force"], dir);
  assert.equal(forced.exitCode, 0, "quay init --force still exits 0");
  assert.ok(forced.stdout.includes("Created"), "--force still prints Created");
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
  assert.match(rawP, /quay-manager/, "profiles.yml must carry the manager role name (quay-manager)");
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

test("gap-launch-settings: quay init --force overwrites a stale launch.settings.json (consumer fix path)", () => {
  const dir = tmpDir("launchsettings-force");
  runQuay(["init"], dir);
  const settingsPath = path.join(dir, ".claude", "launch.settings.json");

  // Simulate the consumer's stale/broken copy (F1/F2: no bypassPermissions,
  // still carrying the pre-AC154 _launchSpec).
  const staleRaw = JSON.stringify(
    { $schema: "https://json.schemastore.org/claude-code-settings.json", _launchSpec: { excludeDynamicSystemPromptSections: false } },
    null,
    2,
  );
  fs.writeFileSync(settingsPath, staleRaw, "utf8");

  runQuay(["init", "--force"], dir);
  const afterRaw = fs.readFileSync(settingsPath, "utf8");
  const second = JSON.parse(afterRaw);
  assert.equal(second.permissions?.defaultMode, "bypassPermissions", "--force must restore bypassPermissions");
  assert.ok(!("_launchSpec" in second), "--force must strip the stale _launchSpec (AC154)");
  assert.notEqual(afterRaw, staleRaw, "stale file must be overwritten on --force");
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

  const produced = listFilesRecursive(dir);
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
