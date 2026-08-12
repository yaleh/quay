// @test-group engine
// manager-arm-loop.test.mjs — gap-manager-cold-start-no-falsifiable-checklist (AC4).
//
// Pins manager-arm-loop.sh --verify-cron — the registry↔real-cron consistency check:
//   「注册表说武装了」≠「真的有 cron」(defect 3): a loop-registry alone MUST fail verify-cron.
//   A cron-evidence.jsonl line written AFTER the arm (simulating the in-session CronCreate+CronList
//   recording — manager-tick-core.md B4) makes it pass; stale / sentinel-mismatched / low-count
//   evidence MUST fail. Existing sentinel-arm idempotence + --validate are pinned as regression.
//
// Run:
//   node --test plugin/test/manager-arm-loop.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const MANAGER_ARM = path.join(pluginDir, "scripts", "manager-arm-loop.sh");

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "quay-mgr-arm-"));
}
function evLine(atEpoch, { mechanism = "cron", sentinel = "[manager-tick]", cronListCount = 1 } = {}) {
  return JSON.stringify({ at: "2026-08-12T00:00:00Z", atEpoch, mechanism, sentinel, cronListCount });
}
function arm(home) {
  const r = spawnSync("bash", [MANAGER_ARM, "--home", home], { encoding: "utf8" });
  assert.equal(r.status, 0, `arm must exit 0:\n${r.stdout}\n${r.stderr}`);
}

// ── AC4 — verify-cron failure semantics (registry ≠ real cron without evidence) ─────────────────────

test("AC4 — --verify-cron fails when the registry is missing (not armed)", () => {
  const tmp = makeTmp();
  try {
    const r = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify-cron"], { encoding: "utf8" });
    assert.equal(r.status, 1, "verify-cron without a registry must fail");
    assert.match(r.stderr, /VERIFY-CRON-FAIL: not-armed/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("AC4 — --verify-cron fails when armed but NO cron evidence exists (registry ≠ real cron)", () => {
  const tmp = makeTmp();
  try {
    arm(tmp);
    const r = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify-cron"], { encoding: "utf8" });
    assert.equal(r.status, 1, "verify-cron without cron evidence must fail (defect 3)");
    assert.match(r.stderr, /VERIFY-CRON-FAIL: no-cron-evidence/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("AC4 — --verify-cron fails on STALE evidence (written before the arm)", () => {
  const tmp = makeTmp();
  try {
    arm(tmp);
    const regMtime = Math.floor(fs.statSync(path.join(tmp, "loop-registry.txt")).mtimeMs / 1000);
    fs.appendFileSync(path.join(tmp, "cron-evidence.jsonl"), evLine(regMtime - 1000) + "\n", "utf8");
    const r = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify-cron"], { encoding: "utf8" });
    assert.equal(r.status, 1, "stale evidence must fail");
    assert.match(r.stderr, /VERIFY-CRON-FAIL: stale-evidence/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("AC4 — --verify-cron fails on sentinel mismatch and on cronListCount 0", () => {
  const tmp = makeTmp();
  try {
    arm(tmp);
    const now = Math.floor(Date.now() / 1000);
    fs.appendFileSync(path.join(tmp, "cron-evidence.jsonl"), evLine(now, { sentinel: "[other]" }) + "\n", "utf8");
    const badSent = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify-cron"], { encoding: "utf8" });
    assert.equal(badSent.status, 1, "sentinel mismatch must fail");
    assert.match(badSent.stderr, /VERIFY-CRON-FAIL: sentinel/);

    fs.writeFileSync(path.join(tmp, "cron-evidence.jsonl"), evLine(now, { cronListCount: 0 }) + "\n", "utf8");
    const zero = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify-cron"], { encoding: "utf8" });
    assert.equal(zero.status, 1, "cronListCount 0 must fail (no listed cron)");
    assert.match(zero.stderr, /VERIFY-CRON-FAIL: cronListCount/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ── AC4 — verify-cron pass semantics (registry + fresh matching evidence) ───────────────────────────

test("AC4 — --verify-cron passes with a fresh, matching cron-evidence line", () => {
  const tmp = makeTmp();
  try {
    arm(tmp);
    const now = Math.floor(Date.now() / 1000);
    fs.appendFileSync(path.join(tmp, "cron-evidence.jsonl"), evLine(now) + "\n", "utf8");
    const r = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify-cron"], { encoding: "utf8" });
    assert.equal(r.status, 0, `verify-cron must pass with evidence:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /VERIFY-CRON-OK/);
    const j = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify-cron", "--json"], { encoding: "utf8" });
    assert.equal(j.status, 0, `verify-cron --json must pass:\n${j.stdout}\n${j.stderr}`);
    assert.match(j.stdout, /"verify":"ok"/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ── AC5 — existing arm behavior unregressed ─────────────────────────────────────────────────────────

test("AC5 — sentinel arm idempotence + --validate unregressed", () => {
  const tmp = makeTmp();
  try {
    const store = path.join(tmp, "loop-registry.txt");
    spawnSync("bash", [MANAGER_ARM, "--store", store], { encoding: "utf8" });
    spawnSync("bash", [MANAGER_ARM, "--store", store], { encoding: "utf8" });
    const count = (fs.readFileSync(store, "utf8").match(/\[manager-tick\]/g) || []).length;
    assert.equal(count, 1, "arm twice must leave exactly one [manager-tick] entry");
    const v = spawnSync("bash", [MANAGER_ARM, "--validate"], { encoding: "utf8" });
    assert.equal(v.status, 0, `--validate must still pass:\n${v.stdout}\n${v.stderr}`);
    assert.match(v.stdout, /VALIDATE-OK/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
