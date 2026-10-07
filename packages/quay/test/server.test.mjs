// @test-group product
// server.test.mjs — the `quay server status` aggregation (`src/cli/server.ts`) and the two spawn arms
// it can delegate through (`src/cli/driver.ts`: `runDriver` sync / `runDriverAsync` concurrent).
//
// WHY THIS FILE EXISTS AS ITS OWN PAIR: per `plugin/scripts/select-tests-for-touches.ts` rule 2 (the
// repo's dominant `<dir>/foo.ts` → `*/test/foo.test.mjs` convention), `packages/quay/src/cli/server.ts`
// had NO paired test — the selector reported it verbatim ("no */test/server.test.mjs found"), which is
// what made `scripts/test.sh --for-task …` report `test-selection-thin` for any task touching it. Its
// behaviour was only reachable indirectly, through `server-status-web-control-same-pid.test.mjs`
// (which exercises the HOST side and the pid-identity contract). This file is the direct one.
//
// gap-server-status-six-serial-driver-runtime-cold-spawns moved the six per-kind reads from a
// synchronous `spawnSync` chain to a concurrent one. Two invariants make that safe, and neither is
// observable from the aggregate output alone:
//
//   ① The two arms are the SAME delegation. `runDriver` and `runDriverAsync` must return the same
//      verdict for the same input — including the refusals, which are decided BEFORE any spawn by the
//      shared `resolveDriverInvocation`. A concurrent arm that quietly re-derived the root/kind rules
//      would surface here as a disagreement (硬规则 5b: two copies = drift).
//   ② Concurrency never drops or reorders a row. All six driver rows are emitted in the vocabulary's
//      own order even when there is no host at all — the branch where 「哪个 kind 不转了」 matters most.
//
// Run (scoped): node --experimental-strip-types --test packages/quay/test/server.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runDriver, runDriverAsync } from "../src/cli/driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SOURCE_CLI = path.join(REPO_ROOT, "packages", "quay", "bin", "quay.ts");
// Pin the kernel to THIS checkout. Without it the resolver (correctly) relocates a worktree-loaded
// Core to the main checkout's `plugin/`, and a test run from a task worktree would read a different
// tree than the one under test.
process.env.QUAY_PLUGIN_ROOT = path.join(REPO_ROOT, "plugin");

const DRIVER_SERVICE_KINDS = ["promotion", "worker", "outer", "quality", "meta", "goal"];

/** A bare workspace: `.quay/config.yml` and nothing else — no server-state carrier, no anchor. */
function makeBareWorkspace(t, tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `servercli-${tag}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    "providers:\n  native:\n    enabled: true\n    tasks_dir: \"./tasks\"\n",
    "utf8",
  );
  return root;
}

test("AC1 — the sync and the concurrent spawn arms return the SAME verdict (one resolver, two spawns)", async (t) => {
  const root = makeBareWorkspace(t, "arms");
  const args = ["status", "promotion", ["--kind", "promotion", "--json"], root];

  const sync = runDriver(...args);
  const conc = await runDriverAsync(...args);
  assert.equal(sync.ok, true, `sync arm delegated: ${JSON.stringify(sync)}`);
  assert.equal(conc.ok, true, `concurrent arm delegated: ${JSON.stringify(conc)}`);
  assert.equal(conc.exitCode, sync.exitCode, `same exit code: ${JSON.stringify([sync.exitCode, conc.exitCode])}`);

  // Non-vacuous: the kernel really answered, and both arms got the SAME answer. A concurrent arm that
  // dropped the stdout (or a sync arm that stopped capturing it) would make this fail, not pass.
  const pick = (r) => {
    const line = r.stdout.split("\n").find((l) => l.trim().startsWith("{"));
    assert.ok(line, `a JSON frame must be present: ${JSON.stringify(r.stdout)}`);
    const j = JSON.parse(line);
    return {
      driver_pid: j.driver_pid,
      driver_alive: j.driver_alive,
      alive: j.alive,
      running: j.running,
      declaration: j.declaration,
      carrier_path: j.carrier_path,
      last_record_carrier: j.last_record_carrier,
      last_record_ts: j.last_record_ts,
    };
  };
  assert.deepEqual(pick(conc), pick(sync), "both arms must report the same reading");
});

test("AC2 — the arms agree on REFUSALS too (the shared prologue decides before either spawns)", async (t) => {
  const root = makeBareWorkspace(t, "refusals");
  // A directory with no `.quay/config.yml` ANYWHERE above it — the root resolution walks up, so a
  // nested path under `root` would (correctly) find `root`'s config and NOT refuse.
  const noConfig = fs.mkdtempSync(path.join(os.tmpdir(), "servercli-noconfig-"));
  t.after(() => fs.rmSync(noConfig, { recursive: true, force: true }));
  for (const bad of [
    ["frobnicate", "promotion", [], root], // unknown verb
    ["status", "not-a-kind", ["--kind", "not-a-kind"], root], // unknown kind
    ["status", "promotion", ["--kind", "promotion"], noConfig], // no config above the root
  ]) {
    const sync = runDriver(...bad);
    const conc = await runDriverAsync(...bad);
    assert.equal(sync.ok, false, `refused by the sync arm: ${JSON.stringify(bad)}`);
    assert.equal(conc.ok, false, `refused by the concurrent arm: ${JSON.stringify(bad)}`);
    // ⛔ Not a bare truthiness check: the two must refuse for the SAME stated reason and exit code —
    // "both said no" would also hold if they had drifted into refusing different things.
    assert.equal(conc.reason, sync.reason, `same refusal reason for ${JSON.stringify(bad)}`);
    assert.equal(conc.exitCode, sync.exitCode, `same refusal exit code for ${JSON.stringify(bad)}`);
    assert.equal(conc.stdout, "", `a refusal carries no stdout for ${JSON.stringify(bad)}`);
  }
});

test("AC3 — all six driver rows are emitted, in vocabulary order, with no host at all", (t) => {
  const root = makeBareWorkspace(t, "norows");
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", SOURCE_CLI, "server", "status", "--json", "--root", root],
    { encoding: "utf8", timeout: 180000, env: { ...process.env, QUAY_PLUGIN_ROOT: path.join(REPO_ROOT, "plugin") } },
  );
  // No server-state carrier ⇒ the documented NOT-RUNNING outcome. The driver rows are computed on
  // THIS branch too (a dead host is exactly when you want to see which kind stopped turning), so the
  // exit code is asserted rather than tolerated.
  assert.equal(r.status, 1, `no carrier ⇒ NOT-RUNNING: ${r.stdout}\n${r.stderr}`);
  const st = JSON.parse(r.stdout);
  assert.equal(st.status, "not-running");
  assert.equal(st.drivers.length, DRIVER_SERVICE_KINDS.length, `one row per kind: ${JSON.stringify(st.drivers)}`);
  assert.deepEqual(
    st.drivers.map((d) => d.kind),
    DRIVER_SERVICE_KINDS,
    "row order must be the vocabulary's own order, not whatever finished first",
  );
  for (const d of st.drivers) {
    assert.equal(d.name, `driver:${d.kind}`);
    // No anchor ⇒ no live carrying process ⇒ a definite 「not turning」, never a silent blank row.
    assert.equal(d.liveness.evaluated, true, `${d.kind}: the read was attempted: ${JSON.stringify(d.liveness)}`);
    assert.equal(d.liveness.alive, false, `${d.kind}: no live carrying process: ${JSON.stringify(d.liveness)}`);
  }
});
