// @test-group engine
// manager-cold-start.test.mjs — gap-manager-cold-start-no-falsifiable-checklist (AC1/AC2/AC4/AC5).
//
// Task-level contract tests:
//   AC1 — the task body records all four measured defects (idle-watch not mounted / criterion
//         pointing at a non-existent script / registry ≠ real cron / no falsifiable checklist).
//   AC2 — plugin/skills/manager/SKILL.md carries the 7-key falsifiable cold-start checklist
//         (the task's Contract: band manager_checklist_count = grep -c 'observable\|证伪\|判据' >= 7,
//         invoke grep -c 'observable' >= 1), and plugin/skills/cold-start/SKILL.md references the
//         manager cold-start's 7-key alignment with the outer's seven.
//   AC4 — the cold-start is externally verifiable: the manager SKILL names --verify-cron as the
//         registry↔real-cron consistency check (defect-3 fix).
//
// Run:
//   node --test plugin/test/manager-cold-start.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");

const MANAGER_SKILL = path.join(pluginDir, "skills", "manager", "SKILL.md");
const COLD_START_SKILL = path.join(pluginDir, "skills", "cold-start", "SKILL.md");
const TASK = path.join(repoRoot, "tasks", "gap-manager-cold-start-no-falsifiable-checklist.md");

const managerSkill = fs.readFileSync(MANAGER_SKILL, "utf8");
const SEVEN_KEYS = [
  "SESSION-CREATED",
  "HOME-CREATED",
  "LOOP-ARMED",
  "CRON-EVIDENCED",
  "IDLE-WATCH-MOUNTED",
  "MONITORS-DELIVERING",
  "CHECKLIST-REPORTED",
];

// ── AC2 — the manager cold start carries a falsifiable checklist (Contract band/invoke) ─────────────

test("AC2 (Contract band) — plugin/skills/manager/SKILL.md has >= 7 lines matching 'observable|证伪|判据'", () => {
  // grep -c semantics: count LINES with at least one match (not total occurrences).
  const n = managerSkill.split("\n").filter((l) => /observable|证伪|判据/.test(l)).length;
  assert.ok(n >= 7, `manager_checklist_count (grep -c) must be >= 7, got ${n}`);
});

test("AC2 (Contract invoke) — plugin/skills/manager/SKILL.md has >= 1 line matching 'observable'", () => {
  const n = (managerSkill.match(/observable/g) || []).length;
  assert.ok(n >= 1, `grep -c 'observable' must be >= 1, got ${n}`);
});

test("AC2 — plugin/skills/manager/SKILL.md carries all 7 falsifiable cold-start keys", () => {
  for (const key of SEVEN_KEYS) {
    assert.match(managerSkill, new RegExp(key), `manager SKILL must carry the ${key} cold-start key`);
  }
});

test("AC2 — plugin/skills/cold-start/SKILL.md references the manager cold-start 7-key alignment", () => {
  const coldStart = fs.readFileSync(COLD_START_SKILL, "utf8");
  assert.match(coldStart, /Manager cold start/, "cold-start skill must have a manager cold-start section");
  assert.match(coldStart, /plugin\/skills\/manager\/SKILL\.md/, "it must point at the manager SKILL as the source of the 7 keys");
  assert.match(coldStart, /CRON-EVIDENCED/, "it must carry the registry↔real-cron key");
});

// ── AC4 — the checklist is externally verifiable (registry ↔ real cron) ────────────────────────────

test("AC4 — the manager cold-start names --verify-cron as the registry↔real-cron consistency check", () => {
  assert.match(managerSkill, /--verify-cron/, "manager SKILL must name the external cron verifier");
  assert.match(managerSkill, /cron-evidence\.jsonl/, "the evidence file must be named");
});

// ── AC1 — the task body records the four measured defects (reproduction fixed) ─────────────────────

test("AC1 — the task body records all four measured defects", () => {
  const task = fs.readFileSync(TASK, "utf8");
  assert.match(task, /idle-watch 不挂/, "defect 1 (idle-watch not mounted) must be recorded");
  assert.match(task, /判据指向不存在脚本/, "defect 2 (criterion → non-existent script) must be recorded");
  assert.match(task, /注册表≠真 cron/, "defect 3 (registry ≠ real cron) must be recorded");
  assert.match(task, /无证伪判据/, "defect 4 (no falsifiable checklist) must be recorded");
});

// ── AC5 — the four existing manager-scoped tests remain (regression surface is the scoped gate) ─────

test("AC5 — the manager cold-start test surface is wired: the four manager test files exist", () => {
  for (const rel of [
    "plugin/test/manager-start.test.mjs",
    "plugin/test/manager-arm-loop.test.mjs",
    "plugin/test/manager-tick-core.test.mjs",
    "plugin/test/manager-cold-start.test.mjs",
  ]) {
    assert.ok(fs.existsSync(path.join(repoRoot, rel)), `scoped surface must ship ${rel}`);
  }
});
