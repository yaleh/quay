// @test-group product
// GOAL-017 / AC-254 — SPEC §6.9 stage B: the services are INDEPENDENTLY startable and stoppable
// units and the process is only their host.
//
// WHAT THIS FILE DEFENDS. The failure this repo has already paid for more than once is a *folded
// reading*: two different facts reported as one value, so an operator cannot tell them apart.
// Stage B has three of them, and each is asserted in BOTH directions here:
//
//   §6.9 不变式 1  IDEMPOTENT       `start` on a running service is a NO-OP, **not** a silent
//                                   restart. The discriminator is the host pid: restarting would
//                                   change it, and restarting a driver kills its in-flight worker
//                                   children. So: same pid in, same pid out.
//   §6.9 不变式 2  PARTIAL          `stop --only web` must release the WEB listener WITHOUT taking
//                                   the host down. Four readings, all required: web was reachable
//                                   before, is unreachable after, the host pid is UNCHANGED, and the
//                                   SAME process's `control` face still answers. Drop the "before"
//                                   and "unreachable after" is vacuous; drop the control face and a
//                                   whole-process kill would pass.
//   §6.9 不变式 3  ⛔ 非整体重启     `driver:<kind>` delegates to the existing `quay driver stop
//                                   --kind X` — this file does NOT re-test that (its own suite
//                                   owns it) and does NOT run it against any live driver.
//
// 硬规则 3b: `stopped` and `already-stopped` are DIFFERENT values, and `not-evaluated` is a third.
// "I stopped it" and "it was already stopped" must not be the same reading — otherwise `stop`'s
// exit 0 is not a reading of anything.
// SPLIT from server-partial-stop.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/4 (2 tests). Shared fixtures: ./helpers/server-partial-stop-harness.mjs (single source).

import { test } from "node:test";
import { __dirname, assert, cli, fs, makeWorkspace, path, serviceOf, spawnServe, waitForCarrier } from "./helpers/server-partial-stop-harness.mjs";

test("SPEC §6.9 — the four verbs are in the verb table and the help, and the service inventory is complete", async () => {
  const help = await cli(["server", "--help"], __dirname);
  for (const verb of ["start", "add", "stop", "status"]) {
    assert.match(help.stdout, new RegExp(`quay server ${verb}`), `\`server ${verb}\` is documented`);
  }
  for (const svc of ["web", "control", "driver:promotion", "driver:worker", "driver:outer", "driver:goal", "driver:quality", "driver:meta"]) {
    assert.ok(help.stdout.includes(svc), `the service inventory names ${svc}`);
  }
  // The verb table itself (bin/quay.ts's fallback usage line) carries the new verbs.
  const unknown = await cli(["definitely-not-a-verb"], __dirname);
  assert.match(unknown.stderr, /server start/);
  assert.match(unknown.stderr, /server stop/);
  // An unknown service name is fail-closed, NOT silently ignored (a typo must not read as "done").
  const bogus = await cli(["server", "stop", "--only", "web,tpyo"], __dirname);
  assert.equal(bogus.code, 1);
  assert.match(bogus.stderr, /unknown service name/);
});

// ── §6.9 不变式 1: idempotence, and the 3b distinction between "did it" and "was already so" ─────


test("§6.9-1 — `start` on a running service is a NO-OP (same host pid), and `stop` on a stopped one is `already-stopped`", async (t) => {
  const ws = makeWorkspace("ac254-idem");
  const host = spawnServe(ws);
  t.after(() => {
    host.kill();
    fs.rmSync(ws, { recursive: true, force: true });
  });
  const carrier = await waitForCarrier(ws);
  assert.ok(carrier, `the host published its carrier (stderr: ${host.out().stderr})`);
  const pid = carrier.pid;

  // `start` a service that is ALREADY running: exit 0, OUTCOME already-running, and — the part that
  // matters — the host pid is UNCHANGED. A silent restart would show a different pid here.
  const again = await cli(["server", "start", "--only", "web,control", "--json", "--root", ws], ws);
  assert.equal(again.code, 0, `stderr: ${again.stderr}`);
  assert.equal(again.json.changed, false, "nothing changed ⇒ changed=false (not a restart)");
  for (const s of again.json.services) {
    assert.equal(s.outcome, "already-running", `${s.name}: idempotent start reports already-running`);
    assert.equal(s.pid, pid, `${s.name}: the host pid is UNCHANGED — no silent restart`);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(ws, ".quay", "server.json"), "utf8")).pid, pid, "carrier pid unchanged");

  // `stop` a service that is NOT running ⇒ a value DISTINCT from "just stopped it".
  const already = await cli(["server", "stop", "--only", "web", "--json", "--root", ws], ws);
  assert.equal(already.code, 0, `stderr: ${already.stderr}`);
  assert.equal(serviceOf(already.json, "web").outcome, "stopped", "the FIRST stop really stopped it");
  assert.equal(already.json.changed, true);

  const second = await cli(["server", "stop", "--only", "web", "--json", "--root", ws], ws);
  assert.equal(second.code, 0, `stderr: ${second.stderr}`);
  assert.equal(serviceOf(second.json, "web").outcome, "already-stopped", "the SECOND stop is not the same value");
  assert.notEqual(second.json.changed, true, "changed=false — nothing was stopped this time");
  assert.notEqual(serviceOf(second.json, "web").outcome, serviceOf(already.json, "web").outcome, "硬规则 3b: the two stops must not share a value");
});

// ── §6.9 不变式 2: the partial stop, on FOUR readings ────────────────────────────────────────────
