// @test-group engine
// manager-tick-core.test.mjs — gap-manager-cold-start-no-falsifiable-checklist (AC3/AC4).
//
// Pins the execution core against a retired observation mechanism:
//   no_false_instrument = 1 — the LIVE execution core orchestration/manager-tick-core.md never
//       targets a non-existent script as a check instrument (defect 2). The session-liveness
//       mechanism (session-liveness.sh / monitor-mount-check.sh / idle-watch) was retired 2026-09-03,
//       so the core must no longer reference any of those deleted scripts. The shipped
//       plugin/loop/manager-tick-core.md is a one-line POINTER to this 正本
//       (gap-plugin-loop-manager-drifted-copies-pointerize), so content assertions target the 正本.
//   AC4 — the anchor A19 records cron receipts so registry↔real cron is externally verifiable
//       (defect 3, via manager-arm-loop.sh --verify / --record-cron).
//
// Run:
//   node --test plugin/test/manager-tick-core.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");
const CORE = path.join(repoRoot, "orchestration", "manager-tick-core.md");
const src = fs.readFileSync(CORE, "utf8");

// ── AC3 — no_false_instrument: the core no longer references the retired observer scripts ───────────

test("AC3 no_false_instrument — the execution core no longer targets idle-watch.sh as a check instrument", () => {
  assert.ok(!src.includes("idle-watch.sh"),
    "manager-tick-core.md must not reference idle-watch.sh (the non-existent script, defect 2)");
});

test("AC3 — the core no longer references the retired observer scripts (session-liveness / monitor-mount-check)", () => {
  assert.ok(!/session-liveness\.sh/.test(src), "manager-tick-core.md must not reference session-liveness.sh (retired 2026-09-03)");
  assert.ok(!/session-liveness-mount\.sh/.test(src), "manager-tick-core.md must not reference session-liveness-mount.sh (retired)");
  assert.ok(!/monitor-mount-check\.sh/.test(src), "manager-tick-core.md must not reference monitor-mount-check.sh (retired)");
});

// ── AC4 — the anchor A19 records cron receipts so registry↔real cron is externally verifiable ──────

test("AC4 — the anchor A19 records cron receipts so the registry↔real-cron link is externally verifiable", () => {
  assert.match(src, /--record-cron/, "A19 must carry the record-cron write-back step (the receipt after CronList)");
  assert.match(src, /registry-verified/, "A19 must distinguish registry-verified from registry-only");
  assert.match(src, /manager-arm-loop\.sh --verify/, "A19 must reference the external verifier");
});

// ── AC3 — the live reason archive no longer references the retired observer scripts ───────────────

test("AC3 — the live manager-loop-tick.md no longer references the retired observer scripts", () => {
  const archive = path.resolve(repoRoot, "orchestration", "manager-loop-tick.md");
  assert.ok(fs.existsSync(archive), "orchestration/manager-loop-tick.md must exist");
  const text = fs.readFileSync(archive, "utf8");
  assert.ok(!/monitor-mount-check\.sh/.test(text), "the archive must not reference monitor-mount-check.sh (retired)");
  assert.ok(!/session-liveness\.sh/.test(text), "the archive must not reference session-liveness.sh (retired)");
});

// ── AC3 — touched sibling files do not re-introduce the retired scripts as a live instrument ───────

test("AC3 — the touched sibling files never pgrep idle-watch (defect-2 pattern)", () => {
  for (const rel of ["scripts/manager-start.sh", "scripts/manager-arm-loop.sh"]) {
    const text = fs.readFileSync(path.join(pluginDir, rel), "utf8");
    assert.ok(!/pgrep[^\n]*idle-watch/.test(text),
      `${rel} must not pgrep idle-watch as a live instrument (defect 2)`);
  }
});
