// @test-group engine
// manager-tick-core.test.mjs — gap-manager-cold-start-no-falsifiable-checklist (AC3/AC4).
//
// Pins the execution-core idle-watch criterion to the REAL mechanism:
//   no_false_instrument = 1 — plugin/loop/manager-tick-core.md never targets the non-existent
//       idle-watch.sh as a check instrument (defect 2: a repo-wide find for it returns zero).
//   A10 — the idle-watch check uses monitor-mount-check.sh --json (mounted+targetOk) and
//       session-liveness.sh --once (SESSION-STATUS) + Monitor event stream, i.e. the real
//       session-liveness-mount.sh + Monitor-tool mechanism.
//   B4 — the sentinel sweep records cron evidence (cron-evidence.jsonl) so the registry↔real-cron
//       link is externally verifiable (defect 3 / AC4, via manager-arm-loop.sh --verify-cron).
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
const CORE = path.join(pluginDir, "loop", "manager-tick-core.md");
const src = fs.readFileSync(CORE, "utf8");

// ── AC3 — no_false_instrument: the core never points at the non-existent idle-watch.sh ──────────────

test("AC3 no_false_instrument — the execution core never targets idle-watch.sh as a check instrument", () => {
  assert.ok(!src.includes("idle-watch.sh"),
    "manager-tick-core.md must not reference idle-watch.sh (the non-existent script, defect 2)");
});

test("AC3 — the idle-watch criterion (A10) points at the real mechanism", () => {
  assert.match(src, /monitor-mount-check\.sh --json/, "A10 must use monitor-mount-check.sh --json");
  assert.match(src, /session-liveness\.sh --once/, "A10 must use the --once delivery seam");
  assert.match(src, /SESSION-STATUS/, "A10 must require at least one SESSION-STATUS line");
  assert.match(src, /session-liveness-mount\.sh/, "A10 must name the real mount entry");
  assert.match(src, /Monitor 工具任务/, "A10 must describe the Monitor-tool-task mechanism");
});

// ── AC4 — B4 records cron evidence so registry↔real cron is externally verifiable ──────────────────

test("AC4 — B4 records cron evidence so the registry↔real-cron link is externally verifiable", () => {
  assert.match(src, /cron-evidence\.jsonl/, "B4 must append the cron-evidence record");
  assert.match(src, /cronListCount/, "the evidence line must carry cronListCount");
  assert.match(src, /manager-arm-loop\.sh --verify-cron/, "B4 must reference the external verifier");
});

// ── AC3 — the live reason archive's idle-watch criterion points at the real mechanism ───────────────

test("AC3 — the live manager-loop-tick.md no longer pgrep's a non-existent idle-watch script", () => {
  const archive = path.resolve(repoRoot, "orchestration", "manager-loop-tick.md");
  assert.ok(fs.existsSync(archive), "orchestration/manager-loop-tick.md must exist");
  const text = fs.readFileSync(archive, "utf8");
  assert.ok(!/pgrep[^\n]*idle-watch/.test(text),
    "the live archive must not pgrep a non-existent idle-watch script (defect 2)");
  assert.match(text, /monitor-mount-check\.sh --json/, "the archive's idle-watch check must use monitor-mount-check.sh --json");
  assert.match(text, /session-liveness\.sh --once/, "the archive's idle-watch check must use the --once seam");
});

// ── AC3 — touched sibling files do not re-introduce idle-watch.sh as a live instrument ─────────────

test("AC3 — the touched sibling files never pgrep idle-watch (defect-2 pattern)", () => {
  for (const rel of ["scripts/manager-start.sh", "scripts/manager-arm-loop.sh"]) {
    const text = fs.readFileSync(path.join(pluginDir, rel), "utf8");
    assert.ok(!/pgrep[^\n]*idle-watch/.test(text),
      `${rel} must not pgrep idle-watch as a live instrument (defect 2)`);
  }
});
