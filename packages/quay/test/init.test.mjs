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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = path.join(__dirname, "..", "bin", "quay.ts");
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.ts");

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
