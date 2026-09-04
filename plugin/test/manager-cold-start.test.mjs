// @test-group engine
// manager-cold-start.test.mjs — gap-manager-cold-start-no-falsifiable-checklist (manager 冷启动无证伪判据).
//
// Pins the four defects' fixes:
//
//   AC2 — manager cold start has a falsifiable checklist (5 keys; the idle-watch observation seam
//         was retired 2026-09-03 — IDLE-WATCH-MOUNTED / MONITORS-DELIVERING dropped). The checklist
//         lives in plugin/skills/manager/SKILL.md §6.5.
//   AC4 — the loop-registry ↔ real cron is externally verifiable: manager-arm-loop.sh gains
//         `--record-cron <id>` (agent writes the CronCreate receipt after CronList confirms) and
//         `--verify` (registry-verified exit 0 / registry-only exit 1). A bare sentinel line is no
//         longer "armed"; it is registry-only until the receipt is recorded.
//   AC5 — no regression: the existing arm idempotence (criterion ①/②) and --validate still pass.
//
// Run:
//   scripts/test.sh plugin/test/manager-cold-start.test.mjs
//   node --test plugin/test/manager-cold-start.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");

const MANAGER_START = path.join(pluginDir, "scripts", "manager-start.sh");
const MANAGER_ARM = path.join(pluginDir, "scripts", "manager-arm-loop.sh");
const MANAGER_SKILL = path.join(pluginDir, "skills", "manager", "SKILL.md");
// The live execution core is the 正本 orchestration/manager-tick-core.md — the shipped
// plugin/loop/manager-tick-core.md is now a one-line pointer to it (gap-plugin-loop-manager-
// drifted-copies-pointerize). TICK_DOC stays the shipped plugin/loop pointer (it carries the
// arm-contract markers the --validate path reads).
const TICK_CORE = path.join(repoRoot, "orchestration", "manager-tick-core.md");
const TICK_DOC = path.join(pluginDir, "loop", "manager-loop-tick.md");

function makeTmp(prefix = "quay-mgr-cold-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── AC2 — the manager SKILL carries a falsifiable cold-start checklist ───────────────────────────

test("AC2 — plugin/skills/manager/SKILL.md carries >= 7 falsifiable-checklist lines (## Contract measure)", () => {
  const src = fs.readFileSync(MANAGER_SKILL, "utf8");
  const count = (src.match(/observable|证伪|判据/g) || []).length;
  assert.ok(count >= 7, `manager SKILL.md must carry >= 7 falsifiable/observable-criteria lines (got ${count})`);
  // The checklist is a real section with mechanically-checkable keys.
  for (const key of [
    "HOME-IN-PLACE",
    "CRON-CREATED",
    "REGISTRY-MATCHES",
    "FIRST-TICK-LANDED",
    "NOT-STARTED-BY-PROJECT",
  ]) {
    assert.match(src, new RegExp(key), `manager SKILL.md must carry the ${key} cold-start key`);
  }
});

// ── AC4 — registry ↔ real cron externally verifiable ─────────────────────────────────────────────

test("AC4 — a bare arm is registry-only (--verify exit 1); recording the cron receipt makes it registry-verified (exit 0)", () => {
  const tmp = makeTmp();
  try {
    const store = path.join(tmp, "loop-registry.txt");
    const arm = spawnSync("bash", [MANAGER_ARM, "--store", store], { encoding: "utf8" });
    assert.equal(arm.status, 0, `arm must exit 0:\n${arm.stderr}`);

    // Before any receipt: registry-only — "注册表说武装了" is NOT "真有 cron".
    const pre = spawnSync("bash", [MANAGER_ARM, "--store", store, "--verify"], { encoding: "utf8" });
    assert.equal(pre.status, 1, `verify before record-cron must exit 1 (registry-only):\n${pre.stdout}`);
    assert.match(pre.stdout, /registry-only/, "a bare sentinel without a receipt is registry-only");

    // Record the real cron id (what CronList returns after CronCreate), then verify.
    const rec = spawnSync("bash", [MANAGER_ARM, "--store", store, "--record-cron", "cron_abc123"], { encoding: "utf8" });
    assert.equal(rec.status, 0, `record-cron must exit 0:\n${rec.stderr}`);
    const post = spawnSync("bash", [MANAGER_ARM, "--store", store, "--verify"], { encoding: "utf8" });
    assert.equal(post.status, 0, `verify after record-cron must exit 0:\n${post.stdout}\n${post.stderr}`);
    assert.match(post.stdout, /registry-verified/, "after recording the receipt the registry is registry-verified");

    const line = fs.readFileSync(store, "utf8");
    assert.match(line, /\|cron:cron_abc123\|/, "the registry sentinel line must carry the cron id receipt");
    assert.match(line, /\|verified:\d{4}-\d{2}-\d{2}T/, "the registry sentinel line must carry an ISO verified timestamp");
  } finally { cleanup(tmp); }
});

test("AC4 — verify states: registry-missing, registry-multiple, receipt-stale (falsifiable, not a self-asserted green)", () => {
  const tmp = makeTmp();
  try {
    const store = path.join(tmp, "loop-registry.txt");
    // missing
    let r = spawnSync("bash", [MANAGER_ARM, "--store", store, "--verify"], { encoding: "utf8" });
    assert.equal(r.status, 1); assert.match(r.stdout, /registry-missing/);
    // multiple
    fs.writeFileSync(store, "[manager-tick] a\n[manager-tick] b\n", "utf8");
    r = spawnSync("bash", [MANAGER_ARM, "--store", store, "--verify"], { encoding: "utf8" });
    assert.equal(r.status, 1); assert.match(r.stdout, /registry-multiple/);
    // stale receipt (2020)
    fs.writeFileSync(store, "[manager-tick] Run the manager tick per <repo>/orchestration/manager-loop-tick.md |cron:c_old|verified:2020-01-01T00:00:00Z\n", "utf8");
    r = spawnSync("bash", [MANAGER_ARM, "--store", store, "--verify"], { encoding: "utf8" });
    assert.equal(r.status, 1); assert.match(r.stdout, /receipt-stale/);
    // re-record does not double the receipt (idempotent within one arm cycle)
    fs.writeFileSync(store, "[manager-tick] Run the manager tick per <repo>/orchestration/manager-loop-tick.md\n", "utf8");
    spawnSync("bash", [MANAGER_ARM, "--store", store, "--record-cron", "c1"], { encoding: "utf8" });
    spawnSync("bash", [MANAGER_ARM, "--store", store, "--record-cron", "c2"], { encoding: "utf8" });
    const receiptCount = (fs.readFileSync(store, "utf8").match(/\|cron:/g) || []).length;
    assert.equal(receiptCount, 1, "re-record within one arm cycle must replace, not accumulate, the receipt");
  } finally { cleanup(tmp); }
});

test("AC4 — --validate requires the tick doc to carry the sentinel + pointer-only + cron-receipt arm contract", () => {
  const r = spawnSync("bash", [MANAGER_ARM, "--validate"], { encoding: "utf8" });
  assert.equal(r.status, 0, `--validate must pass:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /VALIDATE-OK/);
  assert.match(r.stdout, /cron-receipt/, "--validate must confirm the cron-receipt rule is documented");
  const tickSrc = fs.readFileSync(TICK_DOC, "utf8");
  assert.match(tickSrc, /record-cron/, "the tick doc §7.1 must carry the record-cron step (the receipt writes back after CronList)");
  assert.match(tickSrc, /--verify/, "the tick doc §7.1 must carry the external --verify command");
});

// ── AC5 — existing arm idempotence (criterion ①/②) does not regress ──────────────────────────────

test("AC5 — arm twice still converges to exactly ONE [manager-tick] entry (criterion ①)", () => {
  const tmp = makeTmp();
  try {
    const store = path.join(tmp, "loop-registry.txt");
    spawnSync("bash", [MANAGER_ARM, "--store", store], { encoding: "utf8" });
    spawnSync("bash", [MANAGER_ARM, "--store", store], { encoding: "utf8" });
    const count = (fs.readFileSync(store, "utf8").match(/\[manager-tick\]/g) || []).length;
    assert.equal(count, 1, `arm twice must leave exactly ONE manager loop (got ${count})`);
  } finally { cleanup(tmp); }
});

test("AC5 — negative control: two duplicates converge to exactly ONE (criterion ②)", () => {
  const tmp = makeTmp();
  try {
    const store = path.join(tmp, "loop-registry.txt");
    fs.writeFileSync(store, "[manager-tick] dup1\n[manager-tick] dup2\n", "utf8");
    const r = spawnSync("bash", [MANAGER_ARM, "--store", store], { encoding: "utf8" });
    assert.equal(r.status, 0, `arm must exit 0 even with duplicates:\n${r.stderr}`);
    const count = (fs.readFileSync(store, "utf8").match(/\[manager-tick\]/g) || []).length;
    assert.equal(count, 1, `arm must converge duplicates to exactly ONE (got ${count})`);
  } finally { cleanup(tmp); }
});

// ── integration-side unique coverage (merged 2026-08-12; adapted to the vhs --record-cron/--verify
//    approach for AC4 and the vhs 7-key set for the cold-start reference) ───────────────────────────

const COLD_START_SKILL = path.join(pluginDir, "skills", "cold-start", "SKILL.md");
const TASK = path.join(repoRoot, "tasks", "gap-manager-cold-start-no-falsifiable-checklist.md");

test("AC2 (Contract band) — plugin/skills/manager/SKILL.md has >= 7 lines matching 'observable|证伪|判据'", () => {
  const src = fs.readFileSync(MANAGER_SKILL, "utf8");
  const n = src.split("\n").filter((l) => /observable|证伪|判据/.test(l)).length;
  assert.ok(n >= 7, `manager_checklist_count (grep -c) must be >= 7, got ${n}`);
});

test("AC2 (Contract invoke) — plugin/skills/manager/SKILL.md has >= 1 line matching 'observable'", () => {
  const src = fs.readFileSync(MANAGER_SKILL, "utf8");
  const n = (src.match(/observable/g) || []).length;
  assert.ok(n >= 1, `grep -c 'observable' must be >= 1, got ${n}`);
});

test("AC2 — plugin/skills/cold-start/SKILL.md references the manager cold-start 7-key alignment", () => {
  const coldStart = fs.readFileSync(COLD_START_SKILL, "utf8");
  assert.match(coldStart, /Manager cold start/, "cold-start skill must have a manager cold-start section");
  assert.match(coldStart, /plugin\/skills\/manager\/SKILL\.md/, "it must point at the manager SKILL as the source of the 7 keys");
  assert.match(coldStart, /REGISTRY-MATCHES|CRON-CREATED/, "it must carry the registry↔real-cron key");
});

test("AC4 — the manager cold-start names --record-cron/--verify as the registry↔real-cron consistency check", () => {
  const skill = fs.readFileSync(MANAGER_SKILL, "utf8");
  assert.match(skill, /--record-cron|--verify/, "manager SKILL must name the external cron verifier (--record-cron/--verify)");
  assert.match(skill, /registry-verified|REGISTRY-MATCHES/, "the SKILL must name the registry↔real-cron verified state");
});

test("AC1 — the task body records all four measured defects", () => {
  const task = fs.readFileSync(TASK, "utf8");
  assert.match(task, /idle-watch 不挂/, "defect 1 (idle-watch not mounted) must be recorded");
  assert.match(task, /判据指向不存在脚本/, "defect 2 (criterion → non-existent script) must be recorded");
  assert.match(task, /注册表≠真 cron/, "defect 3 (registry ≠ real cron) must be recorded");
  assert.match(task, /无证伪判据/, "defect 4 (no falsifiable checklist) must be recorded");
});

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
