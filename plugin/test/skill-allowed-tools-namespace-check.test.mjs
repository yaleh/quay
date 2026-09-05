// @test-group engine
// skill-allowed-tools-namespace-check.test.mjs — plugin/skills allowed-tools 命名空间机械检查测试
// (tasks/gap-skill-allowed-tools-plugin-namespace, SPEC §3c/§7-2/AC2).
//
// AC2 (SPEC §8 不变式): every `mcp__` tool name in plugin/skills/*/SKILL.md must be
// `mcp__plugin_quay_quay__*`. POSITIONAL (hard rule 2): only the `allowed-tools` frontmatter field value
// is judged — a bare `mcp__quay__*` in prose/body does NOT count.
// AC3 (falsifiable, three readings): before the fix the checker goes RED naming the two files; after the
// fix it goes GREEN; writing a bare name back goes RED again. Hard rule 3b/4: no skills dir / no SKILL.md
// ⇒ NOT-EVALUATED (exit 3), never conflated with green.
//
// This file pins:
//   (a) the pure logic (listSkillFiles / extractMcpTools / checkSkillAllowedToolsNamespaces);
//   (b) the REAL repo is GREEN (both loop-driver and routines allowed-tools are plugin-prefixed);
//   (c) the NEGATIVE CONTROL — write a bare `mcp__quay__*` name back ⇒ exit 1, names the file;
//   (d) POSITIONAL — a bare name in prose/body does NOT count (quay-task-to-plan prose is green);
//   (e) NOT-EVALUATED — no skills dir ⇒ exit 3.
//
// Run:
//   scripts/test.sh plugin/test/skill-allowed-tools-namespace-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  SKILLS_DIR_REL,
  REQUIRED_PREFIX,
  listSkillFiles,
  extractMcpTools,
  checkSkillAllowedToolsNamespaces,
} from "../scripts/skill-allowed-tools-namespace-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "skill-allowed-tools-namespace-check.ts");

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

test("extractMcpTools — splits comma-separated allowed-tools, keeps only mcp__ names", () => {
  assert.deepEqual(
    extractMcpTools("Bash, Read, mcp__quay__task_list, mcp__quay__task_get, TaskCreate"),
    ["mcp__quay__task_list", "mcp__quay__task_get"],
  );
  // bracket-list form (readFrontmatter defensive path) also works
  assert.deepEqual(extractMcpTools(["Bash", "mcp__plugin_quay_quay__task_list"]), ["mcp__plugin_quay_quay__task_list"]);
  // no mcp__ names → empty (Bash/Read/TaskCreate are not MCP namespaces)
  assert.deepEqual(extractMcpTools("Bash, Read, Write, TaskCreate, SendMessage"), []);
  // empty / null → empty
  assert.deepEqual(extractMcpTools(""), []);
  assert.deepEqual(extractMcpTools(null), []);
});

test("listSkillFiles — returns */SKILL.md files only, empty when dir absent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sat-list-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "a"), { recursive: true });
  fs.mkdirSync(path.join(dir, "b"), { recursive: true });
  fs.mkdirSync(path.join(dir, "c"), { recursive: true });
  fs.writeFileSync(path.join(dir, "a", "SKILL.md"), "---\nallowed-tools: mcp__quay__x\n---\n");
  fs.writeFileSync(path.join(dir, "b", "SKILL.md"), "---\n---\n");
  // c has no SKILL.md — must be skipped
  assert.deepEqual(
    listSkillFiles(dir).map((p) => path.relative(dir, p)),
    [path.join("a", "SKILL.md"), path.join("b", "SKILL.md")],
  );
  assert.deepEqual(listSkillFiles(path.join(dir, "no-such-dir")), []);
});

// ── real repo ───────────────────────────────────────────────────────────────────────────────────────

test("real repo is GREEN — loop-driver and routines allowed-tools are plugin-prefixed", () => {
  const res = checkSkillAllowedToolsNamespaces(repoRoot);
  assert.equal(res.evaluated, true, "the real repo must be evaluable (skills dir + SKILL.md present)");
  assert.ok(res.skills.length >= 12, `expected ≥12 shipped SKILL.md, got ${res.skills.length}`);
  // loop-driver + routines declare allowed-tools (the two §3c offenders, now fixed)
  for (const rel of [path.join("plugin", "skills", "loop-driver", "SKILL.md"), path.join("plugin", "skills", "routines", "SKILL.md")]) {
    assert.ok(res.withAllowedTools.includes(rel), `expected ${rel} to declare allowed-tools`);
  }
  assert.deepEqual(res.violations, [], `real repo must be green, got violations: ${JSON.stringify(res.violations)}`);
  assert.equal(res.ok, true, "the real repo must be green");
});

test("POSITIONAL — a bare mcp__quay__ name in PROSE does not count (hard rule 2)", () => {
  // quay-task-to-plan/SKILL.md carries a prose "Use `mcp__quay__task_get`/`task_list`/`task_write`" in its
  // body — it must NOT be a violation (the checker reads only the allowed-tools field).
  const res = checkSkillAllowedToolsNamespaces(repoRoot);
  const proseRel = path.join("plugin", "skills", "quay-task-to-plan", "SKILL.md");
  const v = res.violations.find((x) => x.path === proseRel);
  assert.equal(v, undefined, `prose mcp__quay__ mention must not be a violation: ${JSON.stringify(v)}`);
});

// ── fixture helper ───────────────────────────────────────────────────────────────────────────────────

/** Build a temp root with the given skill → allowed-tools map; every skill gets a body with an optional prose mention. */
function buildFixture(tag, skills) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sat-${tag}-`));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, spec] of Object.entries(skills)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const allowed = spec.allowedTools == null ? "" : `allowed-tools: ${spec.allowedTools}\n`;
    const prose = spec.prose ? `\n# body\nUse \`mcp__quay__task_get\` in prose.\n` : "\n# body\n";
    fs.writeFileSync(full, `---\n${allowed}---\n${prose}`);
  }
  return dir;
}

function runCli(root) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", root, "--json"], {
    encoding: "utf8",
  });
}

// ── negative control (AC3) ───────────────────────────────────────────────────────────────────────────

test("AC3 — a bare mcp__quay__ name in allowed-tools ⇒ RED (exit 1, names the file)", () => {
  const dir = buildFixture("neg", {
    "plugin/skills/good/SKILL.md": { allowedTools: "Bash, mcp__plugin_quay_quay__task_list" },
    "plugin/skills/bad/SKILL.md": { allowedTools: "Bash, mcp__quay__task_get, mcp__quay__task_write" },
  });
  const r = runCli(dir);
  assert.equal(r.status, 1, `checker must exit 1 on a bare name:\n${r.stdout}\n${r.stderr}`);
  const res = JSON.parse(r.stdout);
  assert.equal(res.ok, false);
  const bad = res.violations.find((v) => v.path.endsWith(path.join("plugin", "skills", "bad", "SKILL.md")));
  assert.ok(bad, "result must carry the offending skill");
  assert.deepEqual(bad.tools, ["mcp__quay__task_get", "mcp__quay__task_write"], "must name the exact bare tool names");
});

test("AC3 — all plugin-prefixed ⇒ GREEN (exit 0)", () => {
  const dir = buildFixture("pos", {
    "plugin/skills/a/SKILL.md": { allowedTools: "Bash, Read, mcp__plugin_quay_quay__task_list, mcp__plugin_quay_quay__task_write" },
    "plugin/skills/b/SKILL.md": { allowedTools: "Bash, mcp__plugin_quay_quay__gate_run" },
  });
  const r = runCli(dir);
  assert.equal(r.status, 0, `fully plugin-prefixed fixture must be green:\n${r.stdout}\n${r.stderr}`);
});

test("AC3 — prose bare name with clean allowed-tools ⇒ GREEN (positional)", () => {
  const dir = buildFixture("prose", {
    "plugin/skills/a/SKILL.md": { allowedTools: "Bash, mcp__plugin_quay_quay__task_get", prose: true },
  });
  const r = runCli(dir);
  assert.equal(r.status, 0, `prose mention must not redden the checker:\n${r.stdout}\n${r.stderr}`);
});

// ── NOT-EVALUATED (hard rule 3b/4) ───────────────────────────────────────────────────────────────────

test("no skills dir ⇒ NOT-EVALUATED (exit 3), never conflated with green", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sat-ne-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = runCli(dir);
  assert.equal(r.status, 3, `no skills dir must be NOT-EVALUATED, not green:\n${r.stdout}\n${r.stderr}`);
  const res = JSON.parse(r.stdout);
  assert.equal(res.evaluated, false);
  assert.ok(res.notEvaluatedReason, "NOT-EVALUATED must carry a reason");
});

test("skills dir with no SKILL.md ⇒ NOT-EVALUATED (exit 3)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sat-ne2-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, SKILLS_DIR_REL), { recursive: true });
  const r = runCli(dir);
  assert.equal(r.status, 3, `no SKILL.md must be NOT-EVALUATED, not green:\n${r.stdout}\n${r.stderr}`);
});
