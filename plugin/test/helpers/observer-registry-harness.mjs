// Shared harness for the observer-registry shards (split of observer-registry.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../observer-registry.test.mjs", import.meta.url).href;

// @test-group engine
// observer-registry.test.mjs — tasks/gap-observer-registry-target-decommission-and-criterion-invalidation.
//
// THE CLASS (2026-08-06, four independent consumers hit the same shape in one night):
//   os-anchor-watchdog revived a decommissioned archguard; a git-staleness Monitor kept reporting
//   REPO-STALL for it; a retired session-coverage Monitor reported NOT-WATCHED for a decommissioned
//   B machine; a session-topology Monitor reported a stale cached value after B's tmux server
//   terminated. Each consumer kept its own target list and had no way to learn a target had been
//   decommissioned. This test covers the class-level mechanism: ONE registry
//   (plugin/scripts/observer-registry.sh + orchestration/observer-registry.conf), written once,
//   read by every consumer.
//
// Coverage map (task ACs):
//   AC1 — registry exists and is readable: --list / --list --json report registered targets + status.
//   AC2 — the known consumer reads the registry instead of its own hardcoded list:
//         os-anchor-watchdog. (The session-topology consumer was retired with the outer tmux
//         session — gap-retire-outer-tmux-window-logic.)
//   AC3 (load-bearing negative control) — register a target offline, then run the consumer once:
//         it must report "offline", none stale; --audit --json reports stale_observer_reports=0.
//   AC5 — registration is an explicit write (--register-offline / --register-active), and the
//         mechanism creates NO system crontab (the audit rides the existing dual-trigger style).
//
// All fixtures are hermetic temp registries; nothing in the real checkout is mutated (R3
// test-isolation). The consumers' registry lookup is env-driven (OBSERVER_REGISTRY_FILE).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, cpSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";







// ── AC1: the registry exists and is readable ────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(SRC_URL));

const repoRoot = join(__dirname, "..", "..");

const registry = join(repoRoot, "plugin", "scripts", "observer-registry.sh");

const watchdog = join(repoRoot, "plugin", "scripts", "os-anchor-watchdog.sh");

function run(script, args, opts = {}) {
  const res = spawnSync("bash", [script, ...args], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeTmp(prefix) {
  return mkdtempSync(join(tmpdir(), `observer-registry-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// writeRegistry — write a temp registry file and return its path.
function writeRegistry(dir, name, content) {
  const p = join(dir, name);
  writeFileSync(p, content, "utf8");
  return p;
}

// A registry with two targets: one active, one offline.
function fixtureRegistry(dir) {
  return writeRegistry(dir, "registry.conf", [
    "quay|active|.|quay-0|本仓库",
    "test-target|offline|/tmp/observer-test-root|test-sess|decommissioned fixture",
    "",
  ].join("\n"));
}

export { __dirname, assert, chmodSync, cleanup, cpSync, dirname, fileURLToPath, fixtureRegistry, join, makeTmp, mkdtempSync, readFileSync, registry, repoRoot, rmSync, run, spawnSync, test, tmpdir, watchdog, writeFileSync, writeRegistry };
