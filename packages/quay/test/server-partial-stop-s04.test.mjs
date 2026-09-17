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
// SPLIT from server-partial-stop.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/4 (1 test). Shared fixtures: ./helpers/server-partial-stop-harness.mjs (single source).

import { test } from "node:test";
import { START_TIMEOUT_MS, __dirname, assert, controlAnswers, fs, makeWorkspace, path, spawn } from "./helpers/server-partial-stop-harness.mjs";

test("§6.9-1 mirror — a plain `server.close()` ends the host (the process exits; control is retired)", async (t) => {
  const ws = makeWorkspace("ac254-plain-close");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));

  // An in-process owner script: start the real unified host, print its carrier, then close it the
  // way every pre-existing caller does and STOP holding the loop open. It runs as its own process so
  // "the event loop drained" is observable as `exit` rather than inferred.
  const script = [
    `const { once } = await import("node:events");`,
    `const { startServer } = await import(${JSON.stringify(path.join(__dirname, "..", "..", "quay", "src", "serve.ts"))});`,
    `const src = await startServer({ port: 0, host: "127.0.0.1" });`,
    `const st = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(".quay/server.json", "utf8")));`,
    `console.log("READY " + JSON.stringify({ pid: st.pid, control: st.services.find((s) => s.name === "control").port }));`,
    // Handshake: close only when the PARENT says so. Without it the owner races ahead and has
    // already retired the host by the time the parent's first probe lands — the probe then reads
    // "refused" and the failure looks like a broken control face instead of a test that never
    // observed the up state (measured 2026-09-13: stdout showed READY and CLOSED already both out).
    `process.stdin.resume();`, // a paused stdin never emits 'end'; resume() is what lets the handshake land
    `await once(process.stdin, "end");`,
    // The pre-AC-254 teardown, verbatim: close the server, close the provider client, hold nothing.
    `await new Promise((r) => src.close(r));`,
    `if (src.client) await src.client.close();`,
    `console.log("CLOSED");`,
  ].join("\n");
  const owner = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", "-e", script], {
    cwd: ws,
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => owner.kill("SIGKILL"));
  let out = "";
  let err = "";
  owner.stdout.on("data", (c) => (out += c));
  owner.stderr.on("data", (c) => (err += c));
  let ready = null;
  for (const deadline = Date.now() + START_TIMEOUT_MS; Date.now() < deadline && ready === null; ) {
    ready = /READY (\{.*\})/.exec(out);
    if (ready === null) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, `the in-process host started and published its carrier (stderr: ${err})`);
  const { pid, control } = JSON.parse(ready[1]);
  assert.equal(pid, owner.pid, "the carrier names the owner process");
  assert.equal(await controlAnswers("127.0.0.1", control), true, `control answers while the host is up (port ${control}; stdout: ${JSON.stringify(out.slice(-300))}; stderr: ${JSON.stringify(err.slice(-300))})`);

  // Tell the owner to run its teardown, then read the outcome: the owner EXITS on its own — i.e. the
  // event loop drained, so nothing (control's listening socket above all) was left holding it. A
  // timeout here is the regression, and it is a failure rather than a hang because the assertion
  // owns the deadline.
  owner.stdin.end();
  let exitTimer;
  const exited = await Promise.race([
    new Promise((r) => owner.once("exit", (code) => r(code))),
    new Promise((r) => { exitTimer = setTimeout(() => r("TIMEOUT"), 30000); }),
  ]);
  // ⛔ clearTimeout is load-bearing, not tidiness: an UNCLEARED race timer keeps the whole test-file
  // process alive for the full 30 s after the test has already passed (measured 2026-09-17:
  // test 3124 ms, file duration_ms 32225 ms). AC-279/AC3 are FILE-level readings.
  clearTimeout(exitTimer);
  assert.notEqual(exited, "TIMEOUT", `the owner exited after a plain server.close() (still alive; stdout tail: ${JSON.stringify(out.slice(-200))})`);
  assert.equal(exited, 0, "and it exited cleanly");
  assert.match(out, /CLOSED/, "it reached the end of its own teardown");
  assert.equal(await controlAnswers("127.0.0.1", control), false, "control's socket really was released with the host");
})
