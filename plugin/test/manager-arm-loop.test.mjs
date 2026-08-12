// @test-group engine
// manager-arm-loop.test.mjs — gap-manager-cold-start-no-falsifiable-checklist (AC4).
//
// Pins manager-arm-loop.sh --verify — the registry↔real-cron consistency check (merged 2026-08-12:
// the integration side's --verify-cron + cron-evidence.jsonl was superseded by the vhs-side
// --record-cron <id> / --verify receipt-sentinel approach, which embeds the CronCreate receipt
// INLINE in the registry sentinel line — `|cron:<id>|verified:<ISO>`):
//   「注册表说武装了」≠「真的有 cron」(defect 3): a bare loop-registry MUST fail --verify
//   (registry-only). Recording the cron receipt via --record-cron makes it registry-verified;
//   stale / multiple / missing receipts MUST fail. Sentinel-arm idempotence + --validate pinned.
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
function arm(home) {
  const r = spawnSync("bash", [MANAGER_ARM, "--home", home], { encoding: "utf8" });
  assert.equal(r.status, 0, `arm must exit 0:\n${r.stdout}\n${r.stderr}`);
}

// ── AC4 — --verify failure semantics (registry ≠ real cron without a receipt) ───────────────────────

test("AC4 — --verify fails when the registry is missing (registry-missing)", () => {
  const tmp = makeTmp();
  try {
    const r = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify"], { encoding: "utf8" });
    assert.equal(r.status, 1, "verify without a registry must fail");
    assert.match(r.stdout, /registry-missing/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("AC4 — --verify fails when armed but NO cron receipt exists (registry-only ≠ real cron)", () => {
  const tmp = makeTmp();
  try {
    arm(tmp);
    const r = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify"], { encoding: "utf8" });
    assert.equal(r.status, 1, "verify without a cron receipt must fail (defect 3: registry-only)");
    assert.match(r.stdout, /registry-only/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("AC4 — --verify fails on a STALE receipt (receipt-stale)", () => {
  const tmp = makeTmp();
  try {
    // A stale receipt (2020) must NOT count as verified — beyond the freshness window.
    fs.writeFileSync(
      path.join(tmp, "loop-registry.txt"),
      "[manager-tick] Run the manager tick per <repo>/orchestration/manager-loop-tick.md |cron:c_old|verified:2020-01-01T00:00:00Z\n",
      "utf8"
    );
    const r = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify"], { encoding: "utf8" });
    assert.equal(r.status, 1, "a stale receipt must fail");
    assert.match(r.stdout, /receipt-stale/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("AC4 — --verify fails on multiple sentinel entries (registry-multiple)", () => {
  const tmp = makeTmp();
  try {
    fs.writeFileSync(path.join(tmp, "loop-registry.txt"), "[manager-tick] a\n[manager-tick] b\n", "utf8");
    const r = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify"], { encoding: "utf8" });
    assert.equal(r.status, 1, "multiple sentinel entries must fail");
    assert.match(r.stdout, /registry-multiple/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ── AC4 — --verify pass semantics (bare arm → record-cron → registry-verified) ─────────────────────

test("AC4 — --verify passes after --record-cron writes the CronCreate receipt (registry-verified)", () => {
  const tmp = makeTmp();
  try {
    arm(tmp);
    // Before any receipt: registry-only — "注册表说武装了" is NOT "真有 cron".
    const pre = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify"], { encoding: "utf8" });
    assert.equal(pre.status, 1, "verify before record-cron must exit 1 (registry-only)");
    assert.match(pre.stdout, /registry-only/);

    // Record the real cron id (what CronList returns after CronCreate), then verify.
    const rec = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--record-cron", "cron_abc123"], { encoding: "utf8" });
    assert.equal(rec.status, 0, `record-cron must exit 0:\n${rec.stderr}`);
    const post = spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--verify"], { encoding: "utf8" });
    assert.equal(post.status, 0, `verify after record-cron must exit 0:\n${post.stdout}\n${post.stderr}`);
    assert.match(post.stdout, /registry-verified/);

    const line = fs.readFileSync(path.join(tmp, "loop-registry.txt"), "utf8");
    assert.match(line, /\|cron:cron_abc123\|/, "the registry sentinel line must carry the cron id receipt");
    assert.match(line, /\|verified:\d{4}-\d{2}-\d{2}T/, "the registry sentinel line must carry an ISO verified timestamp");

    // Re-record within one arm cycle replaces, not accumulates, the receipt.
    spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--record-cron", "c2"], { encoding: "utf8" });
    spawnSync("bash", [MANAGER_ARM, "--home", tmp, "--record-cron", "c3"], { encoding: "utf8" });
    const receiptCount = (fs.readFileSync(path.join(tmp, "loop-registry.txt"), "utf8").match(/\|cron:/g) || []).length;
    assert.equal(receiptCount, 1, "re-record within one arm cycle must replace, not accumulate, the receipt");
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
