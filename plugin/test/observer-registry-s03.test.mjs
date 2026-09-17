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
// SPLIT from observer-registry.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/3 (1 test). Shared fixtures: ./helpers/observer-registry-harness.mjs (single source).

import { test } from "node:test";
import { assert, chmodSync, cleanup, cpSync, join, makeTmp, registry, repoRoot, run, writeRegistry } from "./helpers/observer-registry-harness.mjs";

test("audit exit 1 + stale flags when a consumer cannot reach the registry (stale detection path)", () => {
  // Simulate a consumer whose registry lookup is broken (non-executable helper → the consumer
  // skips the check and reports live state) — the audit must mark that consumer stale and exit 1.
  const dir = makeTmp("audit");
  try {
    // Copy the scripts tree, strip the executable bit off the registry helper so the consumers'
    // `[ -x ... ]` guard skips the registry check, then run the audit from the copy.
    const scriptsDir = join(dir, "scripts");
    cpSync(join(repoRoot, "plugin", "scripts"), scriptsDir, { recursive: true });
    chmodSync(join(scriptsDir, "observer-registry.sh"), 0o644);
    const reg = writeRegistry(dir, "registry.conf",
      "test-target|offline|/tmp/observer-test-root|test-sess|decommissioned\n");
    const a = run(join(scriptsDir, "observer-registry.sh"), ["--audit", "--json"], {
      env: {
        ...process.env,
        OBSERVER_REGISTRY_FILE: reg,
        // The audit spawns the real os-anchor-watchdog.sh, which — on this stale path — decides to
        // RELAUNCH and then sits in its prompt-wait window. That window is 30s by default and has
        // nothing to do with what this test asserts (the audit's stale VERDICT, which is derived
        // from the watchdog's output text, not from how long it waited). Left at 30 the file's wall
        // clock is 31.4s — over the 30s per-file ceiling this task (AC3) enforces. 1s keeps the
        // verdict identical: the fixture has no real TUI, so BOTH values end in "did not show a
        // prompt", just with a different number in the message.
        QUAY_WATCHDOG_PROMPT_WAIT_S: "1",
      },
    });
    assert.equal(a.status, 1, "audit exits 1 when a consumer is stale");
    const audit = JSON.parse(a.stdout);
    assert.equal(audit.all_fresh, false);
    for (const c of audit.consumers) {
      assert.equal(c.stale, true, `consumer ${c.name} must be stale when the registry helper is unreachable`);
    }
  } finally {
    cleanup(dir);
  }
});
