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
// SPLIT from observer-registry.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/3 (2 tests). Shared fixtures: ./helpers/observer-registry-harness.mjs (single source).

import { test } from "node:test";
import { assert, cleanup, join, makeTmp, readFileSync, registry, run, writeRegistry } from "./helpers/observer-registry-harness.mjs";

test("AC2: an ACTIVE target is NOT reported decommissioned by any consumer (no false positives)", () => {
  const dir = makeTmp("ac2");
  try {
    const reg = writeRegistry(dir, "registry.conf", "quay|active|.|quay-0|本仓库\n");
    const env = { ...process.env, OBSERVER_REGISTRY_FILE: reg };

    // --is-offline exits 1 for an active/unknown target (the consumer's if-condition is false).
    const io = run(registry, ["--is-offline", "quay"], { env });
    assert.equal(io.status, 1, "active target is not offline");
  } finally {
    cleanup(dir);
  }
});

// ── AC5: registration is an explicit write; no system crontab is introduced ─────────────────────


test("AC5: --register-offline / --register-active are explicit human/manager writes (read-type registration)", () => {
  const dir = makeTmp("ac5");
  try {
    const reg = writeRegistry(dir, "registry.conf",
      "quay|active|.|quay-0|本仓库\nmeta-cc|active|$HOME/work/meta-cc|meta-cc|sibling\n");
    const env = { ...process.env, OBSERVER_REGISTRY_FILE: reg };

    // Before: meta-cc active.
    let st = run(registry, ["--status", "meta-cc"], { env });
    assert.equal(st.stdout.trim(), "active");

    // Explicit decommission write.
    const off = run(registry, ["--register-offline", "meta-cc", "--note", "decommissioned 2026-08-07"], { env });
    assert.equal(off.status, 0, off.stderr);
    assert.match(off.stdout, /registered 'meta-cc' as offline/);
    st = run(registry, ["--status", "meta-cc"], { env });
    assert.equal(st.stdout.trim(), "offline");

    // Re-commission.
    const on = run(registry, ["--register-active", "meta-cc"], { env });
    assert.equal(on.status, 0, on.stderr);
    st = run(registry, ["--status", "meta-cc"], { env });
    assert.equal(st.stdout.trim(), "active");

    // Decommissioning an unknown target fails closed (a target nobody registered can't be
    // meaningfully decommissioned — observers never self-register).
    const ghost = run(registry, ["--register-offline", "ghost"], { env });
    assert.equal(ghost.status, 2);
    assert.match(ghost.stderr, /not in the registry/);

    // The registry script itself declares and ships NO system crontab / systemd unit (AC5) —
    // the mechanism only reads/writes the registry config; consumers keep their own triggers.
    // Assert on the executable body (comment lines stripped): the header may *mention* "no system
    // crontab" as context, but the script must never actually invoke crontab/systemctl/systemd.
    const src = readFileSync(registry, "utf8");
    const body = src.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    assert.doesNotMatch(body, /crontab|systemctl|systemd/, "registry mechanism introduces no system cron/systemd wiring");
  } finally {
    cleanup(dir);
  }
});
