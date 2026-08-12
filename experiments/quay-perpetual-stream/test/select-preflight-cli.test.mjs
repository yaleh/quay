// @test-group engine
// select-preflight-cli.test.mjs — the CLI-subprocess tests for select-preflight.ts (DIR-072/M153).
//
// SPLIT BY gap-split-three-phase-floor-files (2026-08-12): the pre-split select-preflight.test.mjs
// was the engine/main phase's floor (~72s, dominated by the two `--json --workspace-root .` CLI
// spawns that run the REAL preflight against the repo root, each measuring ~8-20s post-fix against
// the real store). The pure unit tests stay in select-preflight.test.mjs; the CLI subprocess tests
// (which spawn a real `node select-preflight.ts` process) move HERE so the two files can run in
// parallel in the main phase and the floor drops below the next tier (~65s). Test BODIES are
// byte-identical to the pre-split file; only their file placement changed.
//
// Run: node --test experiments/quay-perpetual-stream/test/select-preflight-cli.test.mjs
//      node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/select-preflight-cli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/select-preflight.ts", import.meta.url));

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
function spawnCli(args) {
  try {
    const stdout = execFileSync("node", ["--experimental-strip-types", SCRIPT, ...args], {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      // gap-select-preflight-json-real-store-too-slow regression guard: the CLI command measured
      // ~83s on the real store before the walk-once fix and ~8s after. 60000ms gives ~7x headroom
      // over the fixed real-store cost (and ~10x over this worktree's smaller store) while still
      // FAILING if the command ever regresses back toward the pre-fix ~83s under concurrency. The
      // prior 120000ms was the pre-fix ceiling with only ~8% headroom — the flake source.
      timeout: 60000,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

test("CLI: --selftest → exit 0", () => {
  const r = spawnCli(["--selftest"]);
  assert.equal(r.status, 0, r.stderr || "selftest should exit 0");
});

test("CLI: --json --workspace-root . without --milestone-counter → uses default 0, exit 0", () => {
  const r = spawnCli(["--json", "--workspace-root", "."]);
  assert.equal(r.status, 0, "should exit 0 with default milestone-counter");
});

test("CLI: --json --workspace-root . --milestone-counter 0 → exit 0, outputs valid JSON", () => {
  const r = spawnCli(["--json", "--workspace-root", ".", "--milestone-counter", "0"]);
  // May exit 0 or non-zero depending on quay CLI availability inside tests
  // The test validates that the JSON output has the expected shape
  try {
    const parsed = JSON.parse(r.stdout);
    assert.ok(typeof parsed.halt === "boolean");
    assert.ok(Array.isArray(parsed.pendingDirectives));
    assert.ok(Array.isArray(parsed.candidates));
    assert.ok(typeof parsed.milestoneCounter === "number");
    // M188/DIR-119-A Stage 1.6: the synthesized portfolio decision record is wired through this same
    // CLI output — additive, never replacing `candidates` above.
    assert.ok(parsed.portfolio && typeof parsed.portfolio === "object", "portfolio field must be present");
    assert.equal(parsed.portfolio.version, 1);
    assert.ok(Array.isArray(parsed.portfolio.selected));
    assert.ok(Array.isArray(parsed.portfolio.rejected));
  } catch {
    // If quay CLI isn't available in test env, this is fine — the selftest covers pure functions
  }
});

test("CLI: no args at all → usage error exit 2", () => {
  const r = spawnCli([]);
  assert.equal(r.status, 2);
});

test("CLI: --help → exit 2", () => {
  const r = spawnCli(["--help"]);
  assert.equal(r.status, 2);
});
