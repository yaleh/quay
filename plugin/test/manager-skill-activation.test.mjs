// @test-group engine
// manager-skill-activation.test.mjs — gap-manager-skill-session-embodiment-activation.
//
// Pins the "session embodiment" activation route for the manager skill: the current Claude Code
// session transforms into the manager in place (default), with `quay manager start` / manager-start.sh
// demoted to the bare-metal cold-start fallback:
//   AC1 — plugin/skills/manager/SKILL.md §1/introduction describes "当前会话变身为 manager" (session
//         embodiment) as the default, no longer "start a new session".
//   AC2 — the manager-home initialization code exists (mkdir -p ~/.quay-global/manager/ + identity
//         only-if-missing).
//   AC3 — the methodology docs are loaded/linked (orchestration/REVIEW-cadence.md +
//         orchestration/manager-loop-tick.md).
//   AC4 — the CronCreate anchor-arming code exists (manager-arm-loop.sh sentinel sweep → CronCreate
//         → --record-cron receipt).
//   AC5 — manager-start.sh is documented as the 备选路径 (bare-metal cold start); the default route
//         points at plugin/skills/manager/SKILL.md.
//   AC6 — idempotency is documented: re-invoking the skill leaves exactly one manager loop
//         (mkdir -p + only-if-missing identity + sentinel sweep), no duplicate init/overwrite.
//
// Run:
//   scripts/test.sh plugin/test/manager-skill-activation.test.mjs
//   node --test plugin/test/manager-skill-activation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const SKILL = path.join(pluginDir, "skills", "manager", "SKILL.md");
const MANAGER_START = path.join(pluginDir, "scripts", "manager-start.sh");

const skill = fs.readFileSync(SKILL, "utf8");
const startScript = fs.readFileSync(MANAGER_START, "utf8");

// ── AC1 — the introduction describes session embodiment as the default activation route ──────────
test("AC1 — the SKILL introduction describes session embodiment (当前会话变身为 manager), not a new session", () => {
  assert.match(skill, /变身为 manager|session embodiment/, "the introduction must name the session-embodiment route");
  assert.match(skill, /当前会话即变身为 manager/, "the current session transforms into the manager in place");
  assert.ok(!skill.includes("How the manager itself starts"), "the old 'start a new session' heading must be gone");
  // `quay manager start` survives only as the fallback, not the primary route.
  assert.match(skill, /quay manager start/, "the fallback CLI is still named");
  assert.match(skill, /备选|fallback/, "the start route is demoted to fallback/备选");
});

// ── AC2 — the manager-home initialization code exists ────────────────────────────────────────────
test("AC2 — the manager-home initialization code exists (mkdir -p ~/.quay-global/manager/, identity only-if-missing)", () => {
  assert.match(skill, /mkdir -p ~\/\.quay-global\/manager\//, "the home-dir init must mkdir -p ~/.quay-global/manager/");
  assert.match(skill, /identity/, "the home init must write the identity file");
  assert.match(skill, /只在缺失时|only if missing/, "identity must be written only-if-missing (idempotent)");
});

// ── AC3 — the methodology docs are loaded/linked ─────────────────────────────────────────────────
test("AC3 — the methodology docs are loaded/linked (REVIEW-cadence.md + manager-loop-tick.md)", () => {
  assert.match(skill, /REVIEW-cadence\.md/, "the daily-review cadence doc must be linked");
  assert.match(skill, /manager-loop-tick\.md/, "the operational tick doc must be linked");
  assert.match(skill, /加载方法论文档|Load the methodology docs/, "the activation steps must name the doc-loading step");
});

// ── AC4 — the CronCreate/anchor-arming code exists ───────────────────────────────────────────────
test("AC4 — the CronCreate anchor-arming code exists (manager-arm-loop.sh → CronCreate → --record-cron)", () => {
  assert.match(skill, /manager-arm-loop\.sh/, "the arm script must be named");
  assert.match(skill, /CronCreate/, "the in-session CronCreate step must be named");
  assert.match(skill, /--record-cron/, "the receipt write-back step must be named");
  assert.match(skill, /manager-tick-prompt\.txt/, "the anchor prompt (cat manager-tick-prompt.txt) must be named");
});

// ── AC5 — manager-start.sh is documented as the fallback, default route points at the SKILL ───────
test("AC5 — manager-start.sh marks itself as the 备选路径, default route = plugin/skills/manager/SKILL.md", () => {
  assert.match(startScript, /备选路径|备选路线/, "manager-start.sh must mark itself 备选路径");
  assert.match(startScript, /plugin\/skills\/manager\/SKILL\.md/, "manager-start.sh must point the default route at the SKILL");
});

// ── AC6 — idempotency is documented ──────────────────────────────────────────────────────────────
test("AC6 — the activation steps document idempotency (re-invoking leaves exactly one manager loop)", () => {
  assert.match(skill, /幂等/, "the activation must state idempotency");
  assert.match(skill, /重复调用|重复初始化|恰好一个/, "re-invoking must not duplicate init/overwrite");
});
