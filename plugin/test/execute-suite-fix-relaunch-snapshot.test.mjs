// @test-group engine
// execute-suite-fix-relaunch-snapshot.test.mjs — RED/GREEN tests for the suite-fix relaunch
// before-run tmux-leak snapshot fix (gap-suite-fix-relaunch-stale-tmux-snapshot).
//
// Defect: the suite-fix relaunch path (execute-suite-fix.js launchCmd → full-suite-runner.ts
// --root <worktree>) generated its before-run snapshot only IMPLICITLY, deep inside scripts/test.sh's
// FULL_SUITE_DEFAULT branch. A stale .quay/tmux-leak-scan.snapshot (copied into the worktree by
// refresh-worktree-quay.sh, or left by a killed round) then made the suite-tail --check fail closed
// with "no before-run snapshot" RED. The fix makes the relaunch EXPLICITLY generate a fresh snapshot
// before launching the suite, and pins the tmux-leak-scan standalone --snapshot surface.
//
// Covered here:
//   - AC1 (structural): execute-suite-fix.js launchCmd carries an explicit `tmux-leak-scan.sh
//     --snapshot ${worktree}` step BEFORE the detached full-suite launch (both dual copies).
//   - AC3 (dual-copy): plugin/workflows and .claude/workflows copies stay byte-identical.
//   - AC2 (functional regression): tmux-leak-scan.sh --snapshot OVERWRITES a stale snapshot with a
//     fresh one (the stale-snapshot class that caused the RED).
//
// Run:
//   scripts/test.sh plugin/test/execute-suite-fix-relaunch-snapshot.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCAN_SH = path.join(REPO_ROOT, "plugin", "scripts", "tmux-leak-scan.sh");

const COPIES = [
  path.join(REPO_ROOT, "plugin", "workflows", "execute-suite-fix.js"),
  path.join(REPO_ROOT, ".claude", "workflows", "execute-suite-fix.js"),
];

// AC1 — the relaunch launchCmd must explicitly generate a fresh before-run snapshot before launch.
test("AC1 — execute-suite-fix.js relaunch launchCmd explicitly snapshots tmux-leak before launching", () => {
  for (const file of COPIES) {
    const src = fs.readFileSync(file, "utf8");
    assert.match(
      src,
      /tmux-leak-scan\.sh --snapshot \$\{worktree\}/,
      `${file} launchCmd must call tmux-leak-scan.sh --snapshot \${worktree}`,
    );
    // Ordering: the explicit snapshot step must run BEFORE the detached full-suite launch.
    const snapIdx = src.indexOf("tmux-leak-scan.sh --snapshot");
    const launchIdx = src.indexOf("setsid node --no-warnings");
    assert.ok(
      snapIdx !== -1 && launchIdx !== -1 && snapIdx < launchIdx,
      `${file}: --snapshot must run BEFORE the detached full-suite launch`,
    );
  }
});

// AC3 (dual-copy) — the shipped mirror must stay byte-identical to the checked-in source.
test("AC3 — both execute-suite-fix.js copies are byte-identical", () => {
  const a = fs.readFileSync(COPIES[0], "utf8");
  const b = fs.readFileSync(COPIES[1], "utf8");
  assert.equal(a, b, "plugin/workflows and .claude/workflows copies must be byte-identical");
});

// AC2 — the suite-tail --check must use a FRESH snapshot (not a stale one), and must not
// fail closed with "no before-run snapshot". This reproduces the relaunch mechanism end-to-end:
// stale snapshot (killed round / refresh-worktree-quay copy) → explicit --snapshot (the relaunch
// launchCmd step) → --check (suite tail) → clean.
test("AC2 — a stale snapshot is overwritten by --snapshot, then --check is clean (no 'no snapshot' RED)", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-leak-relaunch-"));
  const scope = fs.mkdtempSync(path.join(os.tmpdir(), "leakscan-fixture-"));
  try {
    // Simulate the stale snapshot left by a killed round / copied by refresh-worktree-quay.sh.
    const snap = path.join(scratch, ".quay", "tmux-leak-scan.snapshot");
    fs.mkdirSync(path.dirname(snap), { recursive: true });
    fs.writeFileSync(snap, "STALE-SENTINEL\n", "utf8");

    // The relaunch's explicit before-run step regenerates the snapshot.
    let res = spawnSync("bash", [SCAN_SH, "--scope", scope, "--snapshot", scratch], {
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(res.status, 0, `snapshot failed:\n${res.stdout}\n${res.stderr}`);
    const after = fs.readFileSync(snap, "utf8");
    assert.doesNotMatch(after, /STALE-SENTINEL/, "a fresh --snapshot must overwrite the stale snapshot content");

    // The suite-tail --check uses the FRESH snapshot → clean, NOT "no before-run snapshot" RED.
    res = spawnSync("bash", [SCAN_SH, "--scope", scope, "--check", scratch], {
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(res.status, 0, `--check after a fresh snapshot must be clean:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /no NEW residual test tmux servers\/dirs/, "--check must report clean, not 'no before-run snapshot'");
    assert.doesNotMatch(res.stderr, /no before-run snapshot/, "the fail-closed 'no snapshot' RED must not fire");
  } finally {
    fs.rmSync(scope, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
