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
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const START_TIMEOUT_MS = 30000;

/** A minimal but REAL workspace (a bare `tasks/` dir is not a valid workspace — the config is a
 *  provider map, not a flat path). */
function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${QUAY_NATIVE_CLI.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  return ws;
}

/** Run the Core CLI as a REAL child process against `cwd`; returns { code, stdout, stderr, json }.
 *  ASYNC (never spawnSync): tests that host a server must keep the event loop free to answer the
 *  child's probes — a blocking spawn would make the server unreachable and turn green into red. */
function cli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", QUAY_CLI, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("exit", (code) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        /* left null; a test that expects JSON asserts on it */
      }
      resolve({ code, stdout, stderr, json });
    });
  });
}

/** Spawn a REAL `quay serve` (the unified host) rooted at `ws`, detached so the group can be killed. */
function spawnServe(ws) {
  const child = spawn(process.execPath, ["--no-warnings", QUAY_CLI, "serve", "--port", "0", "--host", "127.0.0.1"], {
    cwd: ws,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));
  return {
    child,
    out: () => ({ stdout, stderr }),
    kill() {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    },
  };
}

async function waitForCarrier(ws, timeoutMs = START_TIMEOUT_MS) {
  const p = path.join(ws, ".quay", "server.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        /* half-written — retry */
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function health(host, port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(4000) });
    return res.status;
  } catch {
    return 0; // transport failure = nothing listening (the interesting case for a stopped face)
  }
}

async function controlAnswers(host, port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ac254-test", version: "1" } } }),
      signal: AbortSignal.timeout(4000),
    });
    const text = await res.text();
    const cands = [...text.split(/\r?\n/).map((l) => /^data:\s*(.+)$/.exec(l)?.[1]).filter(Boolean), text];
    return cands.some((c) => {
      try {
        return typeof JSON.parse(c)?.jsonrpc === "string";
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

const serviceOf = (json, name) => (json?.services ?? []).find((s) => s.name === name);

// ── the verb surface (SPEC §6.8/§6.9: 四个动词是同一能力的四个面) ─────────────────────────────────

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
  const exited = await Promise.race([
    new Promise((r) => owner.once("exit", (code) => r(code))),
    new Promise((r) => setTimeout(() => r("TIMEOUT"), 30000)),
  ]);
  assert.notEqual(exited, "TIMEOUT", `the owner exited after a plain server.close() (still alive; stdout tail: ${JSON.stringify(out.slice(-200))})`);
  assert.equal(exited, 0, "and it exited cleanly");
  assert.match(out, /CLOSED/, "it reached the end of its own teardown");
  assert.equal(await controlAnswers("127.0.0.1", control), false, "control's socket really was released with the host");
})
