// @test-group serial
// @load-sensitive wall-clock
// @load-sensitive-entry 2026-08-08 wall-clock (spawns real monitor + tmux servers); GROUP=serial deliberately
// session-liveness-sweep.test.mjs — AC2/AC3/AC4 (+ candidate-D registry, AC5) for
// gap-sweeptmp-pkill-kills-live-observers-two-layer-blind.
//
// GROUP = serial, NOT lowconc — DELIBERATELY: the AC2/AC3/AC5 tests below spawn REAL
// session-liveness monitor processes + hermetic tmux servers to prove the cleanup cannot kill them.
// The lowconc family (events/heartbeat/signals) is KNOWN-LOAD-SENSITIVE (gap-load-sensitive-session-
// family-confounds-step-three) — a concurrent extra monitor's classifyPaneState timing can trip the
// busy/idle shape race in signals. The serial group runs at concurrency 1 in its own phase, so this
// file can never perturb the load-sensitive lowconc family in the full suite (or in the scoped gate,
// where the selected files already run serially).
//
// 2026-08-08 incident: a cleanup ran a process-name batch kill of the session-liveness monitor
// processes and killed every live one (outer + manager) — two-layer observation went blind
// simultaneously and the observers' own deaths had no observer. Root cause: residue-vs-in-use was
// decided by PROCESS-NAME/PATH matching, not OWNER-SESSION LIVENESS. This file pins the fix:
//   AC2 (no_pkill_by_name_on_live): the cleanup surface has no name-based batch kill.
//   AC3 (owner-liveness criterion): sweepTmp skips a /tmp dir whose owner (tmux server) is alive.
//   AC4 (negative control): a live probe SURVIVES sweepTmp; an owner-dead residue is cleaned.
//   AC5 (candidate D, observer_death_detectable): a registered monitor's death is detectable via
//       the .quay registry + observer-registry-check.sh, not only via a passive Monitor failed.
//
// Part of the session-liveness family (gap-session-liveness-tail-capped-split): owns the
// /tmp prefix "session-liveness-swp-" — the after() below sweeps ONLY it.
//
// Run: scripts/test.sh plugin/test/session-liveness-sweep.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  tmuxAvailable,
  setProbeTmpPrefix, sweepTmp, reapLiveOwners, dirHasLiveOwner, probeRoot,
  makeHermeticProbe, spawnMonitor, waitForRounds,
} from "./session-liveness-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

setProbeTmpPrefix("session-liveness-swp-");
after(() => { reapLiveOwners(); sweepTmp("session-liveness-swp-"); });

const noTmux = tmuxAvailable ? false : "tmux not installed";

test("AC4/AC3 — sweepTmp keeps a LIVE probe (owner session alive) and cleans owner-dead residue", { skip: noTmux }, async () => {
  const p = makeHermeticProbe("swp-ac4");
  const liveDir = p.tmp;
  // residue: the SAME prefix, but with NO live tmux owner (no server socket under it).
  // Created under probeRoot() (NOT os.tmpdir()) so sweepTmp — which scans probeRoot() — can
  // see it: under a namespaced round (QUAY_RUN_ID set) the two bases differ, and a residue in
  // os.tmpdir() would be invisible to the sweeper (round 126 AC4/AC3 wall-clock regression).
  const residue = fs.mkdtempSync(path.join(probeRoot(), "session-liveness-swp-"));
  fs.mkdirSync(path.join(residue, "sock"), { recursive: true });
  try {
    assert.ok(dirHasLiveOwner(liveDir),
      "the live probe's tmp dir must report a LIVE owner (tmux server socket under <dir>/sock)");
    assert.ok(!dirHasLiveOwner(residue),
      "the owner-dead residue dir must report NO live owner");
    sweepTmp("session-liveness-swp-");
    assert.ok(fs.existsSync(liveDir),
      "IN-USE instance must survive cleanup (owner session alive → not residue)");
    assert.ok(!fs.existsSync(residue),
      "owner-dead residue must be removed by cleanup");
  } finally {
    p.cleanup();
    try { fs.rmSync(residue, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("reapLiveOwners — kills THIS process's still-alive hermetic probe server and removes the dir (cancelled-test residue)", { skip: noTmux }, async () => {
  // The KNOWN-LOAD-SENSITIVE family can have a test CANCELLED mid-run, skipping its finally →
  // the probe's tmux server survives. sweepTmp skips live-owner dirs BY DESIGN, so it cannot
  // reclaim this class; reapLiveOwners (called from each file's after() before sweepTmp) is the
  // reaper for it. This test proves the reaper kills this process's OWN registered probe.
  const p = makeHermeticProbe("swp-reap");
  try {
    assert.ok(dirHasLiveOwner(p.tmp),
      "the probe dir must report a LIVE owner before the reaper");
    reapLiveOwners();
    assert.ok(!dirHasLiveOwner(p.tmp),
      "reapLiveOwners must kill the live owner server (socket no longer held by a live process)");
    assert.ok(!fs.existsSync(p.tmp),
      "reapLiveOwners must remove the reaped probe dir");
    // the reaper replaced the probe's own cleanup — cleanup() must stay safe/idempotent on a
    // reaped probe (a cancelled test's finally may still run if the node:test abort allows it).
    p.cleanup();
    assert.ok(true, "cleanup on a reaped probe must not throw");
  } finally {
    try { p.cleanup(); } catch { /* already reaped */ }
  }
});

test("AC2/AC3 — sweepTmp does NOT kill a live session-liveness monitor process", { skip: noTmux }, async () => {
  const p = makeHermeticProbe("swp-mon");
  const mon = spawnMonitor(p.env, `inner ${p.tmp} ${p.session}`);
  try {
    assert.ok(await waitForRounds(mon, 2), "monitor must establish ≥2 rounds before cleanup");
    sweepTmp("session-liveness-swp-");
    assert.ok(await waitForRounds(mon, 4),
      "monitor must STILL emit rounds after sweepTmp (cleanup must never kill an in-use observer)");
  } finally {
    mon.child.kill("SIGKILL");
    p.cleanup();
  }
});

test("AC2 — the cleanup surface has no name-based batch kill of session-liveness", () => {
  // invariant no_pkill_by_name_on_live = 1: the cleanup code has no process-name batch kill of
  // session-liveness monitors.
  // The doc comment in the helper mentions the forbidden command (as a prohibition note) — a naive
  // whole-file grep would self-trip, so we scan the EXECUTABLE function bodies (brace-matched),
  // which are the cleanup path proper. sweepTmp/dirHasLiveOwner must be fs-only (no spawn, no
  // pkill/killall); tmux-leak-scan.sh is a READ-ONLY assertion (scans pgrep/ls, never kills).
  // dirHasLiveOwner + the two runner sweepers moved to the PRODUCTION sweep module (plugin/scripts/
  // session-liveness-sweep.mjs, gap-leak-residue-per-run-namespace-isolation — a runtime import from
  // the test helper broke build-plugin-dist), so scan BOTH: the helper for sweepTmp, the production
  // module for dirHasLiveOwner/sweepRunNamespaces/sweepRunNamespace.
  const fnBodies = (src, names) => {
    const bodies = {};
    for (const name of names) {
      const start = src.indexOf(`export function ${name}`);
      assert.ok(start !== -1, `cleanup function ${name} must exist in scanned source`);
      let i = src.indexOf("{", start);
      let depth = 0;
      for (let j = i; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") { depth--; if (depth === 0) { bodies[name] = src.slice(i, j + 1); break; } }
      }
      assert.ok(bodies[name], `could not brace-match ${name}`);
    }
    return bodies;
  };
  const helper = fs.readFileSync(path.join(__dirname, "..", "test", "session-liveness-helpers.mjs"), "utf8");
  const sweepModule = fs.readFileSync(path.join(__dirname, "..", "scripts", "session-liveness-sweep.mjs"), "utf8");
  const helperBodies = fnBodies(helper, ["sweepTmp"]);
  const sweepBodies = fnBodies(sweepModule, ["dirHasLiveOwner", "sweepRunNamespaces", "sweepRunNamespace"]);
  for (const body of [...Object.values(helperBodies), ...Object.values(sweepBodies)]) {
    assert.ok(!/(?:pkill|killall|spawnSync|spawn)\s*\(/.test(body),
      `cleanup executable body must not contain a name-based kill or process spawn (fs-only cleanup): ${body}`);
  }
  const scan = fs.readFileSync(path.join(__dirname, "..", "scripts", "tmux-leak-scan.sh"), "utf8");
  const code = scan.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.ok(!/(?:pkill|killall)/.test(code),
    "tmux-leak-scan.sh executable lines must not contain pkill/killall (read-only assertion)");
});

test("AC5 (candidate D) — a registered observer's death is detectable, not only via a passive Monitor failed", { skip: noTmux }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-swp-"));
  const registryCheck = path.join(__dirname, "..", "scripts", "observer-registry-check.sh");
  try {
    const p = makeHermeticProbe("swp-reg");
    const mon = spawnMonitor({ ...p.env, SESSION_ROOT: root }, `inner ${p.tmp} ${p.session}`, { register: true });
    try {
      assert.ok(await waitForRounds(mon, 2), "registered monitor must establish rounds");
      // the registry file must appear under <root>/.quay
      const regDir = path.join(root, ".quay");
      assert.ok(fs.existsSync(regDir), ".quay must exist once the observer registers itself");
      const regs = fs.readdirSync(regDir).filter((f) => f.startsWith("session-liveness."));
      assert.equal(regs.length, 1, `expected one registry file, got ${regs.join(",")}`);
      const regFile = path.join(regDir, regs[0]);
      const reg = JSON.parse(fs.readFileSync(regFile, "utf8"));
      assert.equal(reg.pid, mon.child.pid, "registry must record the monitor's own pid");
      assert.equal(reg.root, root, "registry must record the observed root");

      // while the observer is alive: the registry check reports NO dead instance (exit 0).
      const alive = spawnSync("bash", [registryCheck, root, "--json"], { encoding: "utf8" });
      assert.equal(alive.status, 0, `registry check must exit 0 while the observer is alive:\n${alive.stdout}${alive.stderr}`);
      const aliveJson = JSON.parse(alive.stdout);
      assert.equal(aliveJson.ok, true, `no death expected while alive:\n${alive.stdout}`);
      assert.deepEqual(aliveJson.dead, [], `no death expected while alive:\n${alive.stdout}`);

      // kill the monitor WITHOUT letting it unregister (SIGKILL cannot be trapped) — the shape of
      // the incident (an observer killed by a name-based cleanup, no chance to clean up after
      // itself). Its death must now be DETECTABLE via the registry, not only via a Monitor failed.
      mon.child.kill("SIGKILL");
      await sleep(250);
      const dead = spawnSync("bash", [registryCheck, root], { encoding: "utf8" });
      assert.notEqual(dead.status, 0,
        `registry check must FAIL (non-zero) once the observer is dead:\n${dead.stdout}${dead.stderr}`);
      assert.ok(/session-liveness\.\d+\.json/.test(dead.stderr),
        `the dead instance must be named in the report:\n${dead.stderr}`);
    } finally {
      try { mon.child.kill("SIGKILL"); } catch { /* already dead */ }
      p.cleanup();
    }
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
