// @test-group engine
// observer-registry.test.mjs — tasks/gap-observer-registry-target-decommission-and-criterion-invalidation.
//
// THE CLASS (2026-08-06, four independent consumers hit the same shape in one night):
//   os-anchor-watchdog revived a decommissioned archguard; a git-staleness Monitor kept reporting
//   REPO-STALL for it; a session-liveness-coverage Monitor reported NOT-WATCHED for a decommissioned
//   B machine; a session-topology Monitor reported a stale cached value after B's tmux server
//   terminated. Each consumer kept its own target list and had no way to learn a target had been
//   decommissioned. This test covers the class-level mechanism: ONE registry
//   (plugin/scripts/observer-registry.sh + orchestration/observer-registry.conf), written once,
//   read by every consumer.
//
// Coverage map (task ACs):
//   AC1 — registry exists and is readable: --list / --list --json report registered targets + status.
//   AC2 — the 4 known consumers each read the registry instead of their own hardcoded list:
//         os-anchor-watchdog / git-staleness (session-liveness REPO-STALL surface) /
//         session-liveness-coverage (session-liveness SESSION-STATUS surface) /
//         session-topology (topology-check).
//   AC3 (load-bearing negative control) — register a target offline, then run all 4 consumers once:
//         ALL must report "offline", none stale; --audit --json reports stale_observer_reports=0.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const registry = join(repoRoot, "plugin", "scripts", "observer-registry.sh");
const watchdog = join(repoRoot, "plugin", "scripts", "os-anchor-watchdog.sh");
const sessionLiveness = join(repoRoot, "plugin", "scripts", "session-liveness.sh");
const topologyCheck = join(repoRoot, "plugin", "scripts", "topology-check.sh");

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

// ── AC1: the registry exists and is readable ────────────────────────────────────────────────────

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

test("AC3 (load-bearing): register a target offline → run all 4 consumers once → ALL report decommissioned, none stale", () => {
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

    // Consumers 2 & 3 — the session-liveness surface (git-staleness reads REPO-STALL; the
    // session-liveness-coverage Monitor reads the SESSION-STATUS watch verdict from the same run).
    // SL_NO_REGISTER=1 keeps this hermetic: --once must not self-register an observer into the
    // shared <repo>/.quay/ dir (the transient .quay/session-liveness.<pid>.json write that raced
    // the real resident monitor's file under the concurrent suite — the AC3 flake source).
    const sl = run(sessionLiveness, ["--once"], {
      env: { ...env, SL_NO_REGISTER: "1", SESSION_TARGETS: "test-target /tmp/observer-test-root test-sess:outer" },
    });
    assert.equal(sl.status, 0, sl.stderr);
    assert.match(sl.stdout, /SESSION-STATUS test-target decommissioned \(offline per observer-registry\)/);
    assert.doesNotMatch(sl.stdout, /REPO-STALL test-target/, "git-staleness must NOT report REPO-STALL for a decommissioned target");
    assert.doesNotMatch(sl.stdout, /SESSION-GONE test-target/, "no GONE event for an intentionally-decommissioned target");

    // Consumer 4 — session-topology: topology-check must say decommissioned, not stale live state.
    const tp = run(topologyCheck, ["--session", "test-sess"], { env });
    assert.equal(tp.status, 0, tp.stderr);
    assert.match(tp.stdout, /test-sess decommissioned \(offline per observer-registry/);

    // The audit codifies the SAME negative control: stale_observer_reports must be 0.
    const a = run(registry, ["--audit", "--json"], { env });
    assert.equal(a.status, 0, "audit exit 0 when every consumer is fresh");
    const audit = JSON.parse(a.stdout);
    assert.deepEqual(audit.offline_targets, ["test-target"]);
    assert.equal(audit.all_fresh, true);
    for (const c of audit.consumers) {
      assert.equal(c.stale, false, `consumer ${c.name} must not be stale for an offline target`);
    }
    assert.equal(audit.consumers.length, 4, "the 4 known consumers are audited");
  } finally {
    cleanup(dir);
  }
});

test("AC2: an ACTIVE target is NOT reported decommissioned by any consumer (no false positives)", () => {
  const dir = makeTmp("ac2");
  try {
    const reg = writeRegistry(dir, "registry.conf", "quay|active|.|quay-0|本仓库\n");
    const env = { ...process.env, OBSERVER_REGISTRY_FILE: reg };

    // --is-offline exits 1 for an active/unknown target (the consumers' if-condition is false).
    const io = run(registry, ["--is-offline", "quay"], { env });
    assert.equal(io.status, 1, "active target is not offline");

    // session-liveness must NOT report decommissioned for an active target (it proceeds to the
    // normal liveness probe; here the fake target has no session, so it reports alive=0 — but it
    // must not say "decommissioned").
    const sl = run(sessionLiveness, ["--once"], {
      env: { ...env, SL_NO_REGISTER: "1", SESSION_TARGETS: "quay /tmp/observer-active-root quay-0:outer" },
    });
    assert.equal(sl.status, 0, sl.stderr);
    assert.doesNotMatch(sl.stdout, /decommissioned/, "active target must not be reported decommissioned");

    // topology-check must NOT report decommissioned for an active session.
    const tp = run(topologyCheck, ["--session", "quay-0"], { env });
    assert.doesNotMatch(tp.stdout + tp.stderr, /decommissioned/, "active session must not be reported decommissioned");
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
      env: { ...process.env, OBSERVER_REGISTRY_FILE: reg },
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
