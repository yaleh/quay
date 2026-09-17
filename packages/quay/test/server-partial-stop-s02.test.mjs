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
// SPLIT from server-partial-stop.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/4 (1 test). Shared fixtures: ./helpers/server-partial-stop-harness.mjs (single source).

import { test } from "node:test";
import { assert, cli, controlAnswers, fs, health, makeWorkspace, path, serviceOf, spawnServe, waitForCarrier } from "./helpers/server-partial-stop-harness.mjs";

test("§6.9-2 — `stop --only web` releases the web listener while the HOST and its `control` face stay up", async (t) => {
  const ws = makeWorkspace("ac254-partial");
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
  assert.ok(web && control, "the unified host hosts both faces");

  // ① BEFORE: the web face really answers. ⛔ Without this, ② is vacuous (空转).
  assert.equal(await health(web.host, web.port), 200, "web is reachable BEFORE the partial stop");
  assert.equal(await controlAnswers(control.host, control.port), true, "control answers BEFORE the partial stop");

  const stopped = await cli(["server", "stop", "--only", "web", "--json", "--root", ws], ws);
  assert.equal(stopped.code, 0, `stderr: ${stopped.stderr}`);
  assert.equal(serviceOf(stopped.json, "web").outcome, "stopped");

  // ② AFTER: the web listener is gone …
  assert.equal(await health(web.host, web.port), 0, "web is unreachable AFTER — the listener really closed");
  // ③ … the host process is UNCHANGED and ALIVE (this is what makes it a partial stop) …
  const afterCarrier = JSON.parse(fs.readFileSync(path.join(ws, ".quay", "server.json"), "utf8"));
  assert.equal(afterCarrier.pid, pid, "the host pid is UNCHANGED by a partial stop");
  assert.doesNotThrow(() => process.kill(pid, 0), "the host process is still alive");
  // ④ … and the SAME process's `control` face still answers, on the same port.
  assert.equal(await controlAnswers(control.host, control.port), true, "control of the SAME host still answers — nothing else was波及");

  // The carrier still reports the host (status is about the PROCESS), and now reports web as down.
  const status = await cli(["server", "status", "--json", "--root", ws], ws);
  assert.equal(status.code, 0, `degraded is a liveness reading, not a pid-identity failure (stderr: ${status.stderr})`);
  assert.equal(status.json.pid, pid);
  assert.equal(serviceOf(status.json, "web").liveness.alive, false, "web is reported DOWN");
  assert.equal(serviceOf(status.json, "control").liveness.alive, true, "control is reported ALIVE");
});

// ── §6.9: 追加启动 (add) 不影响已在跑的 ──────────────────────────────────────────────────────────
