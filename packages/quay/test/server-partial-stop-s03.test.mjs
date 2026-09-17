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
// SPLIT from server-partial-stop.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/4 (2 tests). Shared fixtures: ./helpers/server-partial-stop-harness.mjs (single source).

import { test } from "node:test";
import { assert, cli, controlAnswers, fs, health, makeWorkspace, path, serviceOf, spawnServe, waitForCarrier } from "./helpers/server-partial-stop-harness.mjs";

test("§6.9 — `add` re-opens only what it names, leaving the already-running faces and the host pid untouched", async (t) => {
  const ws = makeWorkspace("ac254-add");
  const host = spawnServe(ws);
  t.after(() => {
    host.kill();
    fs.rmSync(ws, { recursive: true, force: true });
  });
  const carrier = await waitForCarrier(ws);
  assert.ok(carrier, `the host published its carrier (stderr: ${host.out().stderr})`);
  const pid = carrier.pid;
  const web = carrier.services.find((s) => s.name === "web");
  const control = carrier.services.find((s) => s.name === "control");

  assert.equal((await cli(["server", "stop", "--only", "web", "--json", "--root", ws], ws)).code, 0);
  assert.equal(await health(web.host, web.port), 0, "web is down before the add");

  const added = await cli(["server", "add", "web", "--json", "--root", ws], ws);
  assert.equal(added.code, 0, `stderr: ${added.stderr}`);
  assert.equal(serviceOf(added.json, "web").outcome, "started");
  assert.equal(await health(web.host, web.port), 200, "web is back");
  assert.equal(await controlAnswers(control.host, control.port), true, "control was never touched");
  assert.equal(JSON.parse(fs.readFileSync(path.join(ws, ".quay", "server.json"), "utf8")).pid, pid, "the host pid never changed");

  // `add` of a service that is ALREADY running is still a no-op, not a restart.
  const again = await cli(["server", "add", "control", "--json", "--root", ws], ws);
  assert.equal(again.code, 0, `stderr: ${again.stderr}`);
  assert.equal(serviceOf(again.json, "control").outcome, "already-running");
  assert.equal(serviceOf(again.json, "control").pid, pid);
});

// ── the driver-kind face: delegation + the fail-closed reading of "not running" ──────────────────


test("§6.9-3 — `driver:<kind>` services are recognised and delegate; a stopped kind reads `already-stopped` (no live driver is touched)", async (t) => {
  const ws = makeWorkspace("ac254-driver");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));

  // No driver is running in a fresh workspace, so this is the safe direction to exercise: the verb
  // must DELEGATE-AND-READ, not start anything. ⛔ Nothing here stops a live driver.
  const r = await cli(["server", "stop", "--only", "driver:meta", "--json", "--root", ws], ws);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.equal(serviceOf(r.json, "driver:meta").outcome, "already-stopped", "no meta driver is running ⇒ already-stopped, a value distinct from `stopped`");
  assert.equal(r.json.changed, false);

  // The driver-kind name is part of the inventory, and a bogus kind is rejected by name.
  const bogus = await cli(["server", "stop", "--only", "driver:nope", "--root", ws], ws);
  assert.equal(bogus.code, 1);
  assert.match(bogus.stderr, /unknown service name/);
});

// ── the OTHER direction: a plain `server.close()` still ends the whole host ───────────────────────
//
// §6.9-2 above pins「部分停止不波及其余」. The mirror half is just as load-bearing and is what the
// pre-AC-254 contract (packages/quay/test/serve.test.mjs, 12 call sites; the `--watch`/SIGINT path)
// depends on: an IN-PROCESS caller that closes the server `startServer` returned is ending the HOST,
// so the carrier is retired and the control face is closed with it.
//
// ⛔ These two directions close the SAME `http.Server`, so an implementation that satisfies one by
// construction breaks the other — measured 2026-09-13, both ways:
//   · retire on every close  ⇒ a partial stop kills control (that is §6.9-2 going red);
//   · retire on no close     ⇒ the control socket is never released and `serve.test.mjs` prints
//                              "All QN-031 serve/action regression tests passed." and then hangs
//                              forever (measured 4 286 177 ms before the suite's watchdog fired).
// `serve.test.mjs` can only see the second shape as a HANG, which is why this test asserts the
// positive reading directly: the child process must actually EXIT.
