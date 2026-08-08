// @test-group product
// real-target-verify.test.mjs — gap-install-upgrade-verification-targets-real-downstream-workspaces.
//
// THE GAP: install/upgrade/cold-start verification ran ONLY against mkdtemp synthetic fixtures
// (install-config-driven-e2e.test.mjs). Synthetic green was treated as evidence real downstreams
// are green — but archguard's REAL `quay init --loop` (2026-08-06 01:27) stopped at config-conflict
// with zero files laid down while the synthetic A3 fixture was green (same scenario, opposite
// outcomes). A synthetic fixture is a self-made clean sample; the conflict comes from organic
// divergence ("this project really used, really changed its config") that a mkdtemp cannot fabricate.
//
// THE MECHANISM (plugin/scripts/real-target-verify.sh): run the SAME upgrade surface a real
// downstream runs (`quay init --loop`) against a REAL consumer workspace in READ-ONLY --dry-run
// mode, and report a conclusion annotated `[real-target]` — a SEPARATE track from the synthetic
// fixture so synthetic green is never read as evidence real downstreams are green (AC3). Dry-run
// makes PERIODIC verification safe (AC2): it writes nothing, so a real downstream can be checked
// every verification round without being disturbed.
//
// These tests drive the MECHANISM against real-shaped consumers (a workspace that has genuinely
// been through quay-init). The REAL run against the actual archguard/meta-cc downstreams is live
// evidence in the task body, not a CI dependency (a CI image has no archguard checkout).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { laydownWorkspace, cleanup, pluginDir } from "./quay-init-loop-helpers.mjs";

const VERIFY_SH = path.join(pluginDir, "scripts", "real-target-verify.sh");

function runVerify(target, { json = false, quiet = true } = {}) {
  const args = [VERIFY_SH, "--target", target, "--plugin-root", pluginDir];
  if (json) args.push("--json");
  if (quiet) args.push("--quiet");
  return spawnSync("bash", args, { encoding: "utf8" });
}

// ── test-scoped temp dirs (R6 clean) ──────────────────────────────────────────────────────────────────
const _tmp = [];
function makeTmp(prefix = "rtv-") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmp.push(d);
  return d;
}
after(() => {
  for (const d of _tmp) fs.rmSync(d, { recursive: true, force: true });
});

test("AC1 — a real-shaped consumer with drift verifies: real_target_verified: verified (已验), exit 0", () => {
  const { ws } = laydownWorkspace("rtv-real-");
  // Simulate the REAL downstream organic state the synthetic fixtures cannot fabricate: a consumer
  // that FROZE at install time while the plugin's derived mechanism set grew — two laid-down
  // scripts are missing (archguard's real dry-run reports 42 missing on this exact axis).
  fs.rmSync(path.join(ws, "plugin", "scripts", "cap-from-gate.sh"), { force: true });
  fs.rmSync(path.join(ws, "plugin", "scripts", "claim-task.sh"), { force: true });
  assert.ok(!fs.existsSync(path.join(ws, "plugin", "scripts", "cap-from-gate.sh")), "precondition: drifted file removed");

  const r = runVerify(ws);
  assert.equal(r.status, 0, `verify must exit 0 for a drift-bearing real consumer:\n${r.stdout}\n${r.stderr}`);
  // Contract measure: stdout carries `verified` / `已验`.
  assert.match(r.stdout, /real_target_verified: verified \(已验\)/, `must report verified + 已验:\n${r.stdout}`);
  // The missing scripts are SEEN (would-copy > 0 — the mechanism actually observes the organic
  // drift instead of an empty-set pass).
  assert.match(r.stdout, /would-copy [1-9][0-9]*/, `must report a non-zero would-copy (drift observed):\n${r.stdout}`);
});

test("AC1/AC3 — the verification is READ-ONLY (dry-run): the real consumer's config + laid files are byte-identical after the check", () => {
  const { ws } = laydownWorkspace("rtv-ro-");
  const cfg = path.join(ws, ".quay", "config.yml");
  const beforeCfg = fs.readFileSync(cfg);
  const doc = path.join(ws, "orchestration", "orchestrator-loop-tick.md");
  const beforeDoc = fs.readFileSync(doc);

  const r = runVerify(ws);
  assert.equal(r.status, 0, `verify must exit 0:\n${r.stdout}\n${r.stderr}`);

  assert.ok(fs.readFileSync(cfg).equals(beforeCfg),
    "AC1/AC3: the real target's .quay/config.yml must be byte-identical after the read-only verify");
  assert.ok(fs.readFileSync(doc).equals(beforeDoc),
    "AC1/AC3: the real target's laid-down tick docs must be byte-identical after the read-only verify");
  assert.ok(!fs.existsSync(path.join(ws, ".quay", "quay-init-backups")),
    "AC1/AC3: the read-only verify must not create a config backup (nothing was written)");
});

test("AC3 — a user-edit conflict on a real consumer is DETECTED and named, exit 1 (the archguard failure class, not a synthetic pass)", () => {
  const { ws } = laydownWorkspace("rtv-conflict-");
  // A real consumer's organic divergence: a manual patch to its laid-down loop doc. The managed
  // mode must report would-conflict (target differs from BOTH the product and the recorded
  // laid-hash → a genuine user edit, not stale install content).
  const doc = path.join(ws, "orchestration", "orchestrator-loop-tick.md");
  fs.appendFileSync(doc, `\n<!-- USER-EDIT-${Date.now()}: a real consumer's manual patch -->\n`);

  const r = runVerify(ws);
  assert.equal(r.status, 1, `a user-edit conflict must exit 1:\n${r.stdout}`);
  assert.match(r.stdout, /real_target_verified: conflict/, `must report conflict:\n${r.stdout}`);
  assert.match(r.stdout, /would-conflict/, `must name the conflicting file:\n${r.stdout}`);
});

test("AC1 — a non-consumer (no .quay/config.yml) FAILS CLOSED: real_target_verified: fail, exit 1", () => {
  const bare = makeTmp("rtv-bare-");
  const r = runVerify(bare);
  assert.equal(r.status, 1, `a non-consumer must fail closed (exit 1):\n${r.stdout}`);
  assert.match(r.stdout, /real_target_verified: fail — not a quay consumer/,
    `must name the precondition:\n${r.stdout}`);
});

test("AC3 — the conclusion is machine-readable in --json mode and stays on the real track", () => {
  const { ws } = laydownWorkspace("rtv-json-");
  fs.rmSync(path.join(ws, "plugin", "scripts", "cap-from-gate.sh"), { force: true });
  const r = runVerify(ws, { json: true });
  assert.equal(r.status, 0, `json verify must exit 0:\n${r.stdout}\n${r.stderr}`);
  const parsed = JSON.parse(r.stdout.trim());
  assert.equal(parsed.real_target_verified, "verified", `json conclusion must be verified:\n${r.stdout}`);
  assert.ok(parsed.would_copy >= 1, `json must carry the observed would-copy count:\n${r.stdout}`);
  // The track annotation: the human mode is `[real-target]` — separated from the synthetic fixture
  // track (install-config-driven-e2e.test.mjs is the synthetic side, AC3).
  const human = runVerify(ws);
  assert.match(human.stdout, /^\[real-target\] /, `the human conclusion must be annotated [real-target]:\n${human.stdout}`);
});

test("AC2 — the mechanism supports a per-workspace real-target LIST (QUAY_REAL_TARGETS), the wiring point for periodic verification", () => {
  const { ws } = laydownWorkspace("rtv-list-");
  const list = runVerify(ws, { quiet: false }); // unused; ensures the script runs
  assert.equal(list.status, 0);
  const withEnv = spawnSync("bash", [VERIFY_SH, "--list-targets", "--plugin-root", pluginDir], {
    encoding: "utf8",
    env: { ...process.env, QUAY_REAL_TARGETS: `/some/real/a /some/real/b` },
  });
  assert.equal(withEnv.status, 0, `--list-targets must exit 0:\n${withEnv.stderr}`);
  assert.equal(withEnv.stdout.trim(), "/some/real/a\n/some/real/b",
    "AC2: --list-targets must print the per-workspace real-target list (the verification round's wiring point)");
});
