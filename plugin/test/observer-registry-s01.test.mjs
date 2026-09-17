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
// SPLIT from observer-registry.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/3 (2 tests). Shared fixtures: ./helpers/observer-registry-harness.mjs (single source).

import { test } from "node:test";
import { assert, cleanup, fixtureRegistry, makeTmp, registry, run, watchdog, writeRegistry } from "./helpers/observer-registry-harness.mjs";

test("AC1: --list / --list --json report registered targets + status (machine + human readable)", () => {
  const dir = makeTmp("ac1");
  try {
    const reg = fixtureRegistry(dir);
    const j = run(registry, ["--list", "--json"], { env: { ...process.env, OBSERVER_REGISTRY_FILE: reg } });
    assert.equal(j.status, 0, j.stderr);
    const rows = JSON.parse(j.stdout);
    assert.ok(Array.isArray(rows), "--list --json emits a JSON array (the ## Contract measure surface)");
    assert.equal(rows.length, 2, "two registered targets");
    const offline = rows.find((r) => r.name === "test-target");
    assert.equal(offline.status, "offline");
    assert.equal(offline.tmux_session, "test-sess");
    const active = rows.find((r) => r.name === "quay");
    assert.equal(active.status, "active");

    // human-readable list shows NAME + STATUS columns and the same rows.
    const h = run(registry, ["--list"], { env: { ...process.env, OBSERVER_REGISTRY_FILE: reg } });
    assert.equal(h.status, 0);
    assert.match(h.stdout, /NAME\s+STATUS/);
    assert.match(h.stdout, /test-target\s+offline/);
    assert.match(h.stdout, /quay\s+active/);
  } finally {
    cleanup(dir);
  }
});

// ── AC2 + AC3: each consumer reads the registry; the negative control is load-bearing ─────────────


test("AC3 (load-bearing): register a target offline → run the consumer once → report decommissioned, not stale", () => {
  const dir = makeTmp("ac3");
  try {
    const reg = fixtureRegistry(dir);
    const env = { ...process.env, OBSERVER_REGISTRY_FILE: reg };
    const wdCfg = writeRegistry(dir, "watchdog.conf",
      "test-target|/tmp/observer-test-root|test-sess|outer|true|true|\n");

    // Consumer 1 — os-anchor-watchdog: --check must say decommissioned, never re-spawn.
    const wd = run(watchdog, ["--check", "test-target", "--config", wdCfg], { env });
    assert.equal(wd.status, 0, wd.stderr);
    assert.match(wd.stdout, /test-target decommissioned \(offline per observer-registry/);
    assert.doesNotMatch(wd.stdout, /recreate-session|relaunch-outer/, "a decommissioned target is never re-spawned");

    // The audit codifies the SAME negative control: stale_observer_reports must be 0.
    const a = run(registry, ["--audit", "--json"], { env });
    assert.equal(a.status, 0, "audit exit 0 when every consumer is fresh");
    const audit = JSON.parse(a.stdout);
    assert.deepEqual(audit.offline_targets, ["test-target"]);
    assert.equal(audit.all_fresh, true);
    for (const c of audit.consumers) {
      assert.equal(c.stale, false, `consumer ${c.name} must not be stale for an offline target`);
    }
    assert.equal(audit.consumers.length, 1, "the known consumer is audited");
  } finally {
    cleanup(dir);
  }
});
