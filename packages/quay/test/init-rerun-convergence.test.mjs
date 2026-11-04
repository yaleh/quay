// @test-group product
// gap-quay-init-rerun-skips-delivery-surface-convergence — a VALID config's re-run used to stop after
// the config reconcile and never reach the create-if-absent delivery surface, so the Codex trio and
// the `.gitignore` orphan-lock rules added by a later version never reached an existing project.
//
// Run: node --test packages/quay/test/init-rerun-convergence.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { QUAY_CLI } from "./helpers/cli-entry.mjs";
import { CLOSED_SET_ITEMS } from "../src/init.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
// The plugin root of THIS checkout (main checkout or task worktree) — passed explicitly so the
// runtime-artifact manifest is found and the Codex trio names the vendored dist bundle.
const pluginRoot = path.resolve(__dirname, "..", "..", "..", "plugin");
const skillPath = path.resolve(__dirname, "..", "..", "..", "plugin", "skills", "init", "SKILL.md");

/** A project-shaped tmp dir: the cheapest detectable test command (scripts/test.sh). */
function tmpDir(tag) {
  const d = makeTmpDir(`quay-init-rerun-${tag}-`);
  fs.mkdirSync(path.join(d, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(d, "scripts", "test.sh"), "#!/bin/bash\necho test\n");
  return d;
}

/** Run `quay init --root <dir>` (human output on stdout), expecting exit 0. */
function runInit(dir, extra = []) {
  return execFileSync("node", [quayBin, "init", "--root", dir, "--plugin-root", pluginRoot, ...extra], {
    encoding: "utf8",
  });
}

/** Run `quay init --root <dir> --json` and return the parsed ONE-document report. */
function runInitJson(dir, extra = []) {
  const stdout = execFileSync(
    "node",
    [quayBin, "init", "--root", dir, "--plugin-root", pluginRoot, "--json", ...extra],
    { encoding: "utf8" },
  );
  return JSON.parse(stdout);
}

const TRIO = [".codex/config.toml", ".agents/skills", "AGENTS.md"];
const LOCK_RULES = ["goals/*.lock", "adr/*.lock", "docs-managed/*.lock", "meta/*.lock"];

// ── AC1: a valid config + a missing Codex trio is restored on re-run ────────────────────────────────
test("rerun: valid config + missing Codex trio restores all three (AC1)", () => {
  const dir = tmpDir("ac1");
  runInit(dir);

  // Simulate "an older project that predates the Codex trio laydown": remove all three.
  fs.rmSync(path.join(dir, ".codex", "config.toml"), { force: true });
  fs.rmSync(path.join(dir, ".agents", "skills"), { recursive: true, force: true });
  fs.rmSync(path.join(dir, "AGENTS.md"), { force: true });

  const report = runInitJson(dir);
  assert.ok(["unchanged", "reconciled"].includes(report.outcome), `unexpected outcome ${report.outcome}`);
  assert.deepEqual([...report.deliverySurfaceAdded].sort(), [...TRIO].sort());

  assert.ok(fs.statSync(path.join(dir, ".codex", "config.toml")).isFile(), ".codex/config.toml must be a file");
  assert.ok(fs.statSync(path.join(dir, ".agents", "skills")).isDirectory(), ".agents/skills must be a directory");
  assert.ok(fs.statSync(path.join(dir, "AGENTS.md")).isFile(), "AGENTS.md must be a file");
});

// ── AC2: a valid config + a `.gitignore` missing the orphan-lock entries gains each exactly once ────
test("rerun: missing .gitignore orphan-lock rules are each added exactly once (AC2)", () => {
  const dir = tmpDir("ac2");
  runInit(dir);

  const gi = path.join(dir, ".gitignore");
  // Remove ONLY the four orphan-lock patterns, leaving the runtime-artifact header in place — the
  // shape a project initialised by an older manifest has (header present, newer patterns absent).
  const lines = fs.readFileSync(gi, "utf8").split("\n");
  const kept = lines.filter((l) => !LOCK_RULES.includes(l.trim()));
  fs.writeFileSync(gi, kept.join("\n"), "utf8");

  runInit(dir);

  const after = fs.readFileSync(gi, "utf8");
  for (const rule of LOCK_RULES) {
    const n = after.split("\n").filter((l) => l.trim() === rule).length;
    assert.equal(n, 1, `${rule} must appear exactly once, got ${n}`);
  }
});

// ── AC3: an already-current project re-runs to a no-op (added empty, config byte-identical, no git delta) ──
test("idempotent: already-current project re-run adds nothing and leaves config byte-identical (AC3)", () => {
  const dir = tmpDir("ac3");
  const g = (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.name", "init-test"]);
  g(["config", "user.email", "init@example.com"]);

  runInit(dir, ["--auto-commit-confirm"]);
  // Commit the seed script (outside the closed set) so the tree is clean before the re-run.
  g(["add", "-A"]);
  g(["commit", "-q", "-m", "initial"]);

  const configPath = path.join(dir, ".quay", "config.yml");
  const before = fs.readFileSync(configPath, "utf8");
  const statusBefore = g(["status", "--porcelain"]);

  const report = runInitJson(dir, ["--auto-commit-skip"]);
  assert.equal(report.deliverySurfaceAdded.length, 0, `expected no additions, got ${JSON.stringify(report.deliverySurfaceAdded)}`);
  assert.equal(fs.readFileSync(configPath, "utf8"), before, "config must be byte-identical on an already-current re-run");
  assert.equal(g(["status", "--porcelain"]), statusBefore, "git status must not gain any file on re-run");
});

// ── AC4: a pre-existing custom AGENTS.md / .codex/config.toml is never overwritten ───────────────────
test("no-overwrite: pre-existing custom AGENTS.md and .codex/config.toml stay byte-identical (AC4)", () => {
  const dir = tmpDir("ac4");
  runInit(dir);

  const agents = path.join(dir, "AGENTS.md");
  const codex = path.join(dir, ".codex", "config.toml");
  const customAgents = "# AGENTS.md\n\ncustom consumer content\n";
  const customCodex = "# consumer-owned config.toml\n[custom]\nkey = \"value\"\n";
  fs.writeFileSync(agents, customAgents, "utf8");
  fs.writeFileSync(codex, customCodex, "utf8");

  runInit(dir);

  assert.equal(fs.readFileSync(agents, "utf8"), customAgents, "AGENTS.md must not be overwritten");
  assert.equal(fs.readFileSync(codex, "utf8"), customCodex, ".codex/config.toml must not be overwritten");
});

// ── AC5: single-source guard — the SKILL.md write-surface list stays exactly CLOSED_SET_ITEMS ────────
function skillWriteSurfaceItems() {
  const text = fs.readFileSync(skillPath, "utf8");
  const heading = "## Write surface";
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, "SKILL.md must carry a '## Write surface' section");
  const fence = text.indexOf("```", start);
  assert.notEqual(fence, -1, "the write-surface list must be a fenced code block");
  const end = text.indexOf("```", fence + 3);
  assert.notEqual(end, -1, "the write-surface fence must close");
  return text
    .slice(fence + 3, end)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => l.split(/\s+/)[0].replace(/\/+$/, ""));
}

test("single-source guard: SKILL.md write surface lists exactly CLOSED_SET_ITEMS (AC5)", () => {
  const listed = skillWriteSurfaceItems();
  const expected = [...CLOSED_SET_ITEMS].map((p) => p.replace(/\/+$/, "")).sort();
  assert.deepEqual([...listed].sort(), expected);
});
