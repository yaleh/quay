// @test-group product
// GOAL-017 / AC-251 (SPEC-unified-quay-server-2026-09-13 §7 stage A2) — `quay server status --json`
// must report the Web UI and the MCP control plane as two services under ONE pid.
//
// WHAT THIS FILE IS DEFENDING. Before stage A2, `quay serve` and `serveControlPlane` lived in two
// processes, so AC-251 was structurally false — not "unimplemented" but IMPOSSIBLE: no pid could be
// equal because there were two of them. The merge makes the reading possible; these tests make it
// TAKABLE-FALSE again in the two directions that matter:
//
//   ① the pids must be the LIVE host's (hard rule 4b: a carrier the process writes about itself is
//      not evidence on its own) — so the same pid is confirmed by TWO independent live faces
//      (HTTP GET /health, JSON-RPC initialize) AND, in the child-process test, by `ps -o args=`;
//   ② a stopped server must NOT keep reading green — both the graceful stop (carrier retired) and
//      the SIGKILL (carrier left behind, pid dead) are exercised, because "the file is still there"
//      is exactly how a dead server would masquerade as a running one.
//
// The three-way exit contract (0 running / 1 not-running / 3 not-evaluated) is asserted directly:
// AC-251's own criterion reads 3 as "unreadable" and 1 as "not achieved", so collapsing them would
// make "I could not read the carrier" indistinguishable from "no server is running".
//
// Run (scoped): node --test packages/quay/test/server-status-web-control-same-pid.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import { startServer, shutdownHost } from "../src/serve.ts";
import { readServerState, pidAlive, SERVER_STATE_REL, CONTROL_PLANE_NAME } from "../src/server-state.ts";
// The verb table is the SINGLE source of the usage line (cli/server.ts's SERVER_VERBS feeds both
// `handleServer`'s dispatch and its USAGE string), so the assertion below derives from it rather than
// re-typing the set — a pinned literal here is what makes a test defend last release's verb list.
// (AC-256 added `restart`; the previous literal `start|add|stop|status` then failed for the RIGHT
// reason but reported it as a documentation bug.)
import { SERVER_VERBS } from "../src/cli/server.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

const START_TIMEOUT_MS = 30000;

/** A minimal but REAL workspace: `.quay/config.yml` pointing at the native provider (a bare
 *  `tasks/` dir is not a valid workspace — the config is a provider map, not a flat path). */
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

/**
 * Run the Core CLI as a REAL child process against `cwd` and return { code, stdout, stderr, json }.
 *
 * Why a child process and NOT the import-callable `run()`: `run({capture:true})` replaces
 * `process.stdout.write` for the duration of the call, and under `node --test` the test runner's own
 * reporter writes its v8-serialized events to fd 1 — a flush that lands inside the capture window
 * interleaves foreign bytes into the captured stdout and makes `JSON.parse` throw. Measured on this
 * very file (2026-09-13): in-process capture swallowed a `test:complete` frame of the PREVIOUS test
 * and the reading came back unparseable while the CLI had in fact printed correct JSON. A child
 * process cannot race the reporter, and it is what the AC-251 criterion itself does.
 *
 * ASYNC `spawn`, never `spawnSync`: tests that host the server IN THIS PROCESS need the event loop
 * free to answer the child's probes — a blocking spawnSync would make the server unreachable for the
 * duration and turn a green reading into `degraded`.
 */
function cli(args, cwd, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", QUAY_CLI, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // `extraEnv` 存在时**叠在**继承环境之上（缺省 = 完全继承，既有调用点行为不变）。宿主加载版本
      // 读数要一个 hermetic 的「已安装版本」（fixture HOME），见本文件末尾那一节。
      ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
    });
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
        /* left null — a test that expects JSON asserts on it */
      }
      resolve({ code, stdout, stderr, json });
    });
  });
}

/** Run the criterion's OWN predicate over a `server status --json` reading — the shape AC-251
 *  checks: a `services[]` entry named web and one named control, both carrying an INTEGER pid, and
 *  the two equal. Returns null when satisfied, else the reason. */
function criterionViolation(json) {
  const svcs = {};
  for (const s of json?.services ?? []) if (s && typeof s === "object" && s.name) svcs[s.name] = s;
  const web = svcs.web;
  const ctl = svcs.control;
  if (!web || !ctl) return `status lists no web/control service (have: ${Object.keys(svcs).sort().join(",")})`;
  if (!Number.isInteger(web.pid) || !Number.isInteger(ctl.pid)) return "web/control carry no integer pid";
  if (web.pid !== ctl.pid) return `web pid ${web.pid} != control pid ${ctl.pid}`;
  return null;
}

/** Spawn a REAL `quay serve` process rooted at `ws` (detached, so the whole group can be killed). */
function spawnServe(ws) {
  const child = spawn(
    process.execPath,
    ["--no-warnings", QUAY_CLI, "serve", "--port", "0", "--host", "127.0.0.1"],
    { cwd: ws, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));
  return {
    child,
    out: () => ({ stdout, stderr }),
    kill() {
      try {
        process.kill(-child.pid, "SIGKILL"); // whole group: the serve process AND its provider child
      } catch {
        /* already gone */
      }
    },
  };
}

/** Poll until the workspace's carrier exists (the server publishes it after BOTH binds). */
async function waitForCarrier(ws, timeoutMs = START_TIMEOUT_MS) {
  const p = path.join(ws, SERVER_STATE_REL);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// ── AC1 + AC3 + §6.10: one process, two services, both independently live ─────────────────────────

test("AC1/AC3 — the unified server reports web+control under ONE live pid, confirmed by two independent live faces", async (t) => {
  const ws = makeWorkspace("ac251-unified");
  const prevCwd = process.cwd();
  t.after(() => {
    process.chdir(prevCwd);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  process.chdir(ws);
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  // Retire BOTH hosted services AND the HTTP listener. Leaving the web listener open is not a
  // cosmetic leak: a listening socket keeps this `node --test` file's event loop alive forever, so
  // the file would finish its tests and then hang the whole run (the failure mode
  // serve-bind-failure-no-leak.test.mjs was written for).
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await server.control.close();
    await server.client.close();
  });

  // The carrier itself: both services carry THIS process's pid (that equality is stage A2).
  const carrier = readServerState(ws);
  assert.equal(carrier.kind, "present", "the carrier is published and readable");
  assert.deepEqual(
    carrier.state.services.map((s) => s.name).sort(),
    ["control", "web"],
    "exactly the two stage-A2 services are hosted",
  );
  for (const s of carrier.state.services) {
    assert.equal(s.pid, process.pid, `carrier service ${s.name} carries the host pid`);
    assert.ok(Number.isInteger(s.port) && s.port > 0, `carrier service ${s.name} carries the bound port`);
  }

  // The CLI reading (the criterion's exact input).
  const res = await cli(["server", "status", "--json"], ws);
  assert.equal(res.code, 0, `server status --json exits 0 (stderr: ${res.stderr})`);
  assert.equal(criterionViolation(res.json), null, "AC-251's criterion is satisfied by the reading");
  assert.equal(res.json.status, "running");
  assert.equal(res.json.pid, process.pid);

  // 硬规则 4b — the carrier is the process's OWN self-report, so it is NOT evidence by itself.
  // Two independent live faces must answer on the SAME pid's two ports:
  const web = res.json.services.find((s) => s.name === "web");
  const control = res.json.services.find((s) => s.name === "control");
  for (const s of [web, control]) {
    assert.equal(s.liveness.evaluated, true, `${s.name}: liveness was evaluated`);
    assert.equal(s.liveness.alive, true, `${s.name}: liveness is alive`);
  }

  // Independent face 1: HTTP /health on the web port.
  const health = await fetch(`http://127.0.0.1:${web.port}/health`);
  assert.equal(health.status, 200, "the web face answers /health");
  assert.equal((await health.json()).ok, true);

  // Independent face 2: a JSON-RPC `initialize` on the control port, answered by OUR control plane.
  const rpc = await fetch(`http://127.0.0.1:${control.port}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ac251-test", version: "1" } },
    }),
  });
  const raw = await rpc.text();
  const frame = JSON.parse(/^data:\s*(.+)$/m.exec(raw)?.[1] ?? raw);
  assert.equal(frame.jsonrpc, "2.0", "the control face answers JSON-RPC");
  assert.equal(frame.result.serverInfo.name, CONTROL_PLANE_NAME, "and it is OUR control plane, not a squatter");
});

// ── AC2: stopping the server must turn the reading red (graceful close AND SIGKILL) ───────────────

test("AC2 — graceful stop retires the carrier ⇒ exit 1 (≠0, ≠3); a SIGKILL leaves it stale ⇒ the dead pid is not reported as live", async (t) => {
  const ws = makeWorkspace("ac251-stop");
  const prevCwd = process.cwd();
  t.after(() => {
    process.chdir(prevCwd);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  process.chdir(ws);
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  assert.equal((await cli(["server", "status", "--json"], ws)).code, 0, "green while running");

  // (a) GRACEFUL stop: the carrier is retired, so the reading is "absent" — not "unreadable".
  //
  // ⚠️ AC-254 (SPEC §6.9) moved carrier retirement OFF `server.close()`. `server` IS the web face,
  // and closing the web face is now a NORMAL PARTIAL operation (`quay server stop --only web`) that
  // deliberately leaves the host running — so retiring the carrier on it would report a live host as
  // NOT-RUNNING. Retiring the carrier is the HOST's own end, i.e. `shutdownHost()`.
  await shutdownHost(server);

  const afterClose = await cli(["server", "status", "--json"], ws);
  assert.notEqual(afterClose.code, 0, "a stopped server must not read green");
  assert.notEqual(afterClose.code, 3, "「没有 server 在跑」落在未达成，不落在未评估 (AC2)");
  assert.equal(afterClose.code, 1);
  assert.equal(afterClose.json.carrier, "absent", "the graceful close retired the carrier");
  assert.equal(afterClose.json.status, "not-running");
  assert.equal(criterionViolation(afterClose.json) !== null, true, "AC-251's criterion now fails");

  // (b) SIGKILL: no graceful close ⇒ the carrier FILE survives. It must not be believed.
  const killed = spawnServe(ws);
  t.after(() => killed.kill());
  const carrier = await waitForCarrier(ws);
  assert.ok(carrier, `the spawned server published its carrier (stderr: ${killed.out().stderr})`);
  assert.equal((await cli(["server", "status", "--json"], ws)).code, 0, "the spawned server reads green");

  const deadPid = carrier.pid;
  killed.kill();
  const deadline = Date.now() + 10000;
  while (pidAlive(deadPid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.equal(pidAlive(deadPid), false, "the spawned server is really gone (else this proves nothing)");

  assert.equal(fs.existsSync(path.join(ws, SERVER_STATE_REL)), true, "SIGKILL leaves the carrier file behind");
  const afterKill = await cli(["server", "status", "--json"], ws);
  assert.equal(afterKill.code, 1, "a stale carrier naming a dead pid is NOT-RUNNING");
  assert.notEqual(afterKill.code, 3, "「没有 server 在跑」落在未达成，不落在未评估 (AC2)");
  assert.equal(afterKill.json.carrier, "present", "the file is still there — the pid check is what turned it red");
  assert.equal(afterKill.json.status, "not-running");
  for (const s of afterKill.json.services) {
    assert.equal(s.pid, null, `${s.name}: a dead host must not be reported under a live integer pid`);
    assert.equal(s.liveness.evaluated, false, `${s.name}: the probe was NOT run — the reading says so`);
    assert.equal(s.liveness.alive, null, `${s.name}: unevaluated ≠ "down" (硬规则 3b)`);
  }
});

// ── AC3: the reported pid IS the unified server entry (ps), not an in-process impostor ────────────

test("AC3 — `ps -p <status 报出的 pid> -o args=` is the unified server entry, and web.pid === control.pid === that pid", async (t) => {
  const ws = makeWorkspace("ac251-ps");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));

  const serve = spawnServe(ws);
  t.after(() => serve.kill());
  const carrier = await waitForCarrier(ws);
  assert.ok(carrier, `the serve process published its carrier (stderr: ${serve.out().stderr})`);

  const res = await cli(["server", "status", "--json"], ws);
  assert.equal(res.code, 0, `server status --json exits 0 (stderr: ${res.stderr})`);
  assert.equal(criterionViolation(res.json), null);
  assert.equal(res.json.pid, serve.child.pid, "the reported pid is the process we started");

  const ps = spawnSync("ps", ["-p", String(res.json.pid), "-o", "args="], { encoding: "utf8" });
  assert.equal(ps.status, 0, "the reported pid is a real process");
  const cmdline = ps.stdout.trim();
  assert.match(cmdline, /serve/, `ps args are the serve entry (got: ${JSON.stringify(cmdline)})`);
  assert.ok(cmdline.includes(QUAY_CLI), `ps args carry the CLI entry ${QUAY_CLI} (got: ${JSON.stringify(cmdline)})`);
});

// ── AC5: the carrier is WORKSPACE-relative — two workspaces never read each other's server ────────

test("AC5 — two workspaces each report their OWN server's pid (never a shared/global carrier), and the carrier is untracked", async (t) => {
  const wsA = makeWorkspace("ac251-wsA");
  const wsB = makeWorkspace("ac251-wsB");
  t.after(() => {
    fs.rmSync(wsA, { recursive: true, force: true });
    fs.rmSync(wsB, { recursive: true, force: true });
  });

  const a = spawnServe(wsA);
  const b = spawnServe(wsB);
  t.after(() => {
    a.kill();
    b.kill();
  });

  const carrierA = await waitForCarrier(wsA);
  const carrierB = await waitForCarrier(wsB);
  assert.ok(carrierA && carrierB, `both workspaces published their own carrier (a:${a.out().stderr} b:${b.out().stderr})`);
  assert.notEqual(carrierA.pid, carrierB.pid, "the two servers are genuinely different processes");

  const resA = await cli(["server", "status", "--json"], wsA);
  const resB = await cli(["server", "status", "--json"], wsB);
  assert.equal(resA.code, 0, `workspace A reads its own carrier (stderr: ${resA.stderr})`);
  assert.equal(resB.code, 0, `workspace B reads its own carrier (stderr: ${resB.stderr})`);
  assert.equal(resA.json.workspaceRoot, wsA);
  assert.equal(resB.json.workspaceRoot, wsB);
  assert.equal(resA.json.pid, a.child.pid, "A reads A's process");
  assert.equal(resB.json.pid, b.child.pid, "B reads B's process");
  assert.notEqual(resA.json.pid, resB.json.pid, "the two readings are different pids");

  // Runtime state, never tracked: `git ls-files` must not know the path in ANY workspace.
  for (const ws of [wsA, wsB]) {
    const ls = spawnSync("git", ["-C", ws, "ls-files", SERVER_STATE_REL], { encoding: "utf8" });
    assert.equal(ls.stdout.trim(), "", `\`git ls-files ${SERVER_STATE_REL}\` is empty (${ws})`);
  }
  // And not in the landed commit either — the repo's own checkout does not track it.
  const lsRepo = spawnSync("git", ["-C", REPO_ROOT, "ls-files", SERVER_STATE_REL], { encoding: "utf8" });
  assert.equal(lsRepo.stdout.trim(), "", `the task's landing does not commit ${SERVER_STATE_REL}`);
});

// ── 硬规则 3b: 读不懂 ≠ 未达成 (exit 3), and --json is ALWAYS parseable ───────────────────────────

test("硬规则 3b — a corrupt / wrong-schema carrier is NOT-EVALUATED (exit 3), never silently 'not-running'", async (t) => {
  const ws = makeWorkspace("ac251-corrupt");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const carrierPath = path.join(ws, SERVER_STATE_REL);

  // No carrier at all ⇒ NOT-RUNNING (a definitive reading).
  const none = await cli(["server", "status", "--json"], ws);
  assert.equal(none.code, 1, "no carrier ⇒ 1");
  assert.equal(none.json.status, "not-running");
  assert.equal(none.json.carrier, "absent");

  // Truncated JSON ⇒ NOT-EVALUATED, and the stdout is STILL parseable JSON (so the criterion's
  // `json.loads` never turns our exit 3 into its own "non-JSON output" 3 for a different reason).
  fs.writeFileSync(carrierPath, '{"schemaVersion":1,"pid":');
  const broken = await cli(["server", "status", "--json"], ws);
  assert.equal(broken.code, 3, "unparseable carrier ⇒ 3, not 1");
  assert.equal(broken.json.status, "not-evaluated");
  assert.equal(broken.json.carrier, "unreadable");
  assert.ok(broken.json.services.length === 0, "nothing is invented for a carrier that could not be read");

  // Well-formed JSON but not our schema (a future/foreign carrier) ⇒ still NOT-EVALUATED.
  fs.writeFileSync(carrierPath, JSON.stringify({ schemaVersion: 99, pid: process.pid, startedAt: "x", services: [] }));
  const wrongSchema = await cli(["server", "status", "--json"], ws);
  assert.equal(wrongSchema.code, 3, "an unknown schemaVersion is unreadable, not 'not-running'");
  assert.equal(wrongSchema.json.status, "not-evaluated");

  // A live pid in a wrong-shaped carrier must NOT be enough to read green — the shape check gates it.
  fs.writeFileSync(carrierPath, JSON.stringify({ schemaVersion: 1, pid: process.pid, startedAt: "x", services: [{ name: "web", pid: process.pid }] }));
  const missingPort = await cli(["server", "status", "--json"], ws);
  assert.equal(missingPort.code, 3, "a service entry without a port is not the carrier's shape");
});

// ── §6.10 / §8-8: "进程活着" 与 "某个服务已停摆" must be DIFFERENT readings ─────────────────────────

test("SPEC §6.10/§8-8 — a live host whose services do not answer reads `degraded`, not `running` (and not `not-running`)", async (t) => {
  const ws = makeWorkspace("ac251-degraded");
  const empty = makeWorkspace("ac251-degraded-empty");
  t.after(() => {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  });

  // A port with nothing on it: bind then release, so the kernel-assigned port is genuinely free.
  const probeFree = await new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

  // A well-formed carrier naming a LIVE pid (this test process) whose two services answer nothing.
  fs.writeFileSync(
    path.join(ws, SERVER_STATE_REL),
    JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      services: [
        { name: "web", pid: process.pid, host: "127.0.0.1", port: probeFree },
        { name: "control", pid: process.pid, host: "127.0.0.1", port: probeFree },
      ],
    }),
  );

  const res = await cli(["server", "status", "--json"], ws);
  assert.equal(res.json.status, "degraded", "process alive + services not answering ⇒ degraded");
  assert.equal(res.code, 0, "degraded is a LIVENESS reading — the pid-identity contract still holds ⇒ exit 0");
  assert.equal(criterionViolation(res.json), null, "AC-251's pid contract is met, so its criterion passes");
  for (const s of res.json.services) {
    assert.equal(s.pid, process.pid, `${s.name}: the host pid is reported (the process IS there)`);
    assert.equal(s.liveness.evaluated, true, `${s.name}: the probe ran and got a reading`);
    assert.equal(s.liveness.alive, false, `${s.name}: …and the reading is "not answering"`);
  }

  // The three statuses must be pairwise distinct — a single boolean could not express this.
  const absent = await cli(["server", "status", "--json"], empty);
  assert.notEqual(absent.json.status, res.json.status, "降级 ≠ 未运行");
  assert.equal(absent.code, 1);
});

// ── The help surface stays in sync with the verb table (one line, machine-checkable) ─────────────

test("`quay server status` is reachable and documented — top-level usage, help block, and the bare verb", async () => {
  // Bare `quay server` is a usage error, not a silent no-op.
  const bare = await cli(["server"], REPO_ROOT);
  assert.equal(bare.code, 1);
  // The usage line enumerates the verb set — DERIVED from the module that owns it (no pinned
  // literal: the set legitimately grew at AC-256, and a hard-coded copy would report that growth as
  // a documentation defect instead of as a verb-set change).
  assert.ok(
    bare.stderr.includes(`usage: quay server <${SERVER_VERBS.join("|")}>`),
    `the usage line enumerates EXACTLY the verb table (expected <${SERVER_VERBS.join("|")}>; got: ${JSON.stringify(bare.stderr)})`,
  );

  // `quay server --help` documents the three exit codes (the contract of the command).
  const help = await cli(["server", "--help"], REPO_ROOT);
  assert.match(help.stdout, /quay server status \[--json\]/);
  assert.match(help.stdout, /not-evaluated/);

  // `quay --help` lists the new verb next to `serve`.
  const top = await cli(["--help"], REPO_ROOT);
  assert.match(top.stdout, /quay server status \[--json\] \[--root <path>\]/);

  // The fallback usage line names it too (the verb table lives in bin/quay.ts).
  const unknown = await cli(["definitely-not-a-verb"], REPO_ROOT);
  assert.match(unknown.stderr, /server status/);
});

// ── §8 criterion 9 / §6.9 stage B: the verb set, and stage A's own boundary ───────────────────────
//
// ⚠️ This test REPLACES the stage-A-era "start/add/stop are NOT reachable" gate. That assertion was
// correct while stage B was unlanded (SPEC §8 criterion 9: stage A must not add a capability), and
// it is now FALSE BY DESIGN — stage B (`gap-ac254-partial-stop-web-driver-round-record`) lands the
// three verbs. Keeping the old assertion would make the test defend the ABSENCE of the feature this
// repo just built. What survives from it is the part that was never about stage B:
// `quay serve`'s own flag surface must not grow (the control-plane port is an env override).

test("SPEC §6.9/§8-9 — the stage-B verbs are reachable AND the stage-A `serve` flag surface did not grow", async () => {
  // Every verb of the SPEC §6.9 CLI form reaches a REAL handler: a usage error is exit 1 with the
  // four-verb usage line; a stage-B verb that is merely *recognised* but not implemented would exit
  // 1 too — so the discriminator is that the handler's own error is about the ACTION, not the verb.
  const startNoSvc = await cli(["server", "stop"], REPO_ROOT);
  assert.equal(startNoSvc.code, 1);
  assert.match(startNoSvc.stderr, /requires --only/, "`stop` reaches the stage-B handler (its own precondition error)");
  assert.doesNotMatch(startNoSvc.stderr, /unknown subcommand|not implemented/);

  const help = await cli(["server", "--help"], REPO_ROOT);
  for (const verb of ["start", "add", "stop"]) {
    assert.match(help.stdout, new RegExp(`quay server ${verb}`), `\`quay server --help\` documents \`${verb}\``);
  }
  // The service inventory is user-visible and complete (web + control + the six driver kinds).
  for (const svc of ["web", "control", "driver:promotion", "driver:worker", "driver:outer", "driver:goal", "driver:quality", "driver:meta"]) {
    assert.match(help.stdout, new RegExp(svc.replace(":", ":")), `the help lists the ${svc} service`);
  }
  // Top-level help lists the four verbs in the usage block.
  const top = await cli(["--help"], REPO_ROOT);
  for (const verb of ["start", "add", "stop"]) {
    assert.match(top.stdout, new RegExp(`quay server ${verb}`), `\`quay --help\` lists \`server ${verb}\``);
  }
  // And the Web UI's own flag surface did not grow a control-plane knob (env-only override).
  const serveHelp = await cli(["serve", "--help"], REPO_ROOT);
  assert.doesNotMatch(serveHelp.stdout, /--control-port/, "no new user-visible serve flag (SPEC §8 criterion 9)");
});

// ── AC4 (partial, in-repo): the dist bundle carries the same behaviour as the source tree ─────────

test("AC4 — the built dist bundle is a working unified server too (the shipped entry, not just the source)", async (t) => {
  // cli-entry.mjs falls back to bin/quay.ts with a loud warning when dist is stale/missing; assert
  // the bundle path is the one under test so this test cannot silently pass over a stale build.
  assert.ok(QUAY_CLI.endsWith(".js"), `the CLI entry under test is the prebuilt bundle (got ${QUAY_CLI})`);
  const stat = fs.statSync(QUAY_CLI);
  assert.ok(stat.isFile(), "the bundle exists");

  const ws = makeWorkspace("ac251-dist");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const serve = spawnServe(ws); // spawnServe runs QUAY_CLI, i.e. the bundle
  t.after(() => serve.kill());

  const carrier = await waitForCarrier(ws);
  assert.ok(carrier, `the bundled server publishes a carrier (stderr: ${serve.out().stderr})`);
  const res = await cli(["server", "status", "--json"], ws);
  assert.equal(res.code, 0, "the bundled unified server reports both services under one pid");
  assert.equal(criterionViolation(res.json), null);

  // It is genuinely the bundle on disk that served, not a source-tree fallback: the process's own
  // argv (read from /proc) must name the bundle path.
  const cmdline = execFileSync("bash", ["-c", `tr '\\0' ' ' < /proc/${carrier.pid}/cmdline`], { encoding: "utf8" });
  assert.ok(cmdline.includes(QUAY_CLI), `the live process runs the bundle (got: ${JSON.stringify(cmdline)})`);
});

// ══ 宿主的 loaded_version：serve 宿主**实际加载的产物** vs **已安装**版本 ══════════════════════════
// gap-serve-host-has-no-loaded-version-reading-driver-status-covers-anchor-only
//
// 缺陷（2026-10-06，cantus 实测）：插件 pin 从 0.15.0 升到 0.16.0 后，anchor 侧 `driver status` 正确
// 报出 `loaded-version-behind: loaded=0.15.0 installed=0.16.0`，而**同一个 workspace 的 `quay serve`
// 宿主没有任何等价读数**——`/health` 的 `latestCodeCommitAt` 对**装好的产物**恒为 null（workspace 里
// 没有 quay 源码提交可比），于是「宿主跑的是旧版本」与「一切正常」在该宿主上完全同形。
//
// 本节钉住新读数：`loaded_version` / `loaded` / `installed` / `source`（+ `loaded_script` /
// `loaded_version_relation` / `loaded_version_reason`）。
// ⛔ 它读的是**运行中进程自己**的 `/proc/<pid>/cmdline`（外部可核的直接量，硬规则 4b）⇒ 夹具必须是
// 一个**真的在跑**、且 cmdline 里**真的**带着版本目录路径的宿主进程。一个「只看查询者自己目录」或
// 「总是 current」的实现在这些夹具上取不到假。
// ⛔ 版本从该版本目录的 `VERSION` 文件读，⛔ 不 exec 该产物自己的 `--version`（bundle 内嵌版本是另一个
// 量，gap-release-bundle-embeds-dev-version-after-stamp）——AC4 用「`--version` 打印一个与 VERSION
// 不同的值」的夹具钉死这一点。
// ⛔ 三种「读不到」一律 `not-evaluated` + 非空 reason，⛔ 不与 `current` 同形（硬规则 3b）。

/** 一个 fixture 版本目录（布局照抄真实 cache）：`…/cache/quay/quay/<ver>/vendor/quay/dist/quay.js`
 *  + `…/cache/quay/quay/<ver>/VERSION`。脚本 `--version` 时打印 `cliVersion`（缺省 = VERSION）——
 *  AC4 要它**与 VERSION 不同**。返回脚本绝对路径（= cmdline 里那一段）。 */
function writeServeVersionDir(cacheRoot, version, cliVersion) {
  const versionDir = path.join(cacheRoot, "cache", "quay", "quay", version);
  const dist = path.join(versionDir, "vendor", "quay", "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(versionDir, "VERSION"), `${version}\n`, "utf8");
  const script = path.join(dist, "quay.js");
  fs.writeFileSync(
    script,
    `if (process.argv.includes("--version")) { console.log(${JSON.stringify(cliVersion ?? version)}); process.exit(0); }\n` +
      "setTimeout(() => {}, 600000);\n",
    "utf8",
  );
  return script;
}

/** 起一个**真的在跑**的「serve 宿主」（`node <script> serve`，常驻），等它的 cmdline 可读。
 *  ⛔ 必须真跑：读数取的是那个进程自己的 `/proc/<pid>/cmdline`，写死一个 pid 结构上取不到假。 */
function spawnFakeServeHost(t, script) {
  const p = spawn(process.execPath, [script, "serve"], { stdio: "ignore" });
  t.after(() => {
    try {
      p.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  });
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      if (fs.readFileSync(`/proc/${p.pid}/cmdline`, "utf8").includes(script)) return p.pid;
    } catch {
      /* not yet */
    }
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},50)"]);
  }
  throw new Error(`fake serve host pid ${p.pid} never became readable via /proc`);
}

/** fixture HOME（管**已安装**版本）：注册表是「已安装版本」的唯一权威来源；放进 fixture HOME 而不是
 *  读真 HOME，本节才 hermetic（真 HOME 上的 quay@quay 版本随发布漂移 ⇒ 判据会随环境红绿）。 */
function writeInstalledRegistry(home, version) {
  fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "quay@quay": [
          {
            scope: "local",
            installPath: `/nowhere/cache/quay/quay/${version}`,
            version,
            installedAt: "2026-09-20T02:20:39.600Z",
            lastUpdated: "2026-09-23T06:43:08.658Z",
          },
        ],
      },
    }),
    "utf8",
  );
}

/** 一个**空闲**端口（绑定后立刻释放）——载体里的两个服务都指向它，探针会拿到 ECONNREFUSED。 */
async function freePort() {
  return await new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** 写一个指向 `hostPid` 的 `server.json` 载体（形状同 server-state.ts 的 SERVER_STATE_SCHEMA_VERSION 1）。 */
async function writeCarrier(ws, hostPid) {
  const port = await freePort();
  fs.writeFileSync(
    path.join(ws, SERVER_STATE_REL),
    JSON.stringify({
      schemaVersion: 1,
      pid: hostPid,
      startedAt: new Date().toISOString(),
      services: [
        { name: "web", pid: hostPid, host: "127.0.0.1", port },
        { name: "control", pid: hostPid, host: "127.0.0.1", port },
      ],
    }),
  );
}

/** 一个 fixture 世界：一个真在跑的 serve 宿主（加载 `<cacheRoot>/…/<loadedVersion>/vendor/quay/dist/
 *  quay.js`）+ 一个说「已安装 `<installed>`」的 fixture HOME + 一个指向它的 workspace。 */
async function serveHostWorld(t, tag, { installed, loadedVersion, cliVersion } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `srvlv-home-${tag}-`));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), `srvlv-cache-${tag}-`));
  const ws = makeWorkspace(`srvlv-${tag}`);
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  });
  writeInstalledRegistry(home, installed);
  const script = writeServeVersionDir(cacheRoot, loadedVersion, cliVersion);
  const pid = spawnFakeServeHost(t, script);
  await writeCarrier(ws, pid);
  return { home, cacheRoot, ws, script, pid };
}

test("loaded_version — the serve host loaded 0.15.0 while 0.16.0 is installed ⇒ behind (+ both versions, source=proc-cmdline)", async (t) => {
  const { home, ws, script, pid } = await serveHostWorld(t, "behind", { installed: "0.16.0", loadedVersion: "0.15.0" });

  const res = await cli(["server", "status", "--json"], ws, { HOME: home });
  assert.ok(res.json, `status --json is parseable (stderr: ${res.stderr})`);
  assert.equal(res.json.loaded_version, "behind", `落后必须报 behind: ${JSON.stringify(res.json.loaded_version)}`);
  assert.equal(res.json.loaded, "0.15.0", `loaded = 运行中宿主实际加载的那份: ${res.json.loaded}`);
  assert.equal(res.json.installed, "0.16.0", `installed = 注册表里已安装的版本: ${res.json.installed}`);
  assert.equal(res.json.source, "proc-cmdline", `来源是外部可核的直接量: ${res.json.source}`);
  assert.equal(res.json.loaded_version_relation, "loaded-older", `方向单列: ${res.json.loaded_version_relation}`);
  assert.equal(res.json.loaded_version_reason, null, `有结论 ⇒ reason 为空: ${res.json.loaded_version_reason}`);
  // 直接量：读的是**那个进程**加载的脚本路径（/proc/<pid>/cmdline 的 exec 实参）。
  assert.equal(res.json.loaded_script, script, `loaded_script = 宿主进程自己的 cmdline 实参: ${res.json.loaded_script}`);
  assert.ok(fs.existsSync(res.json.loaded_script), `被点名的脚本真的在盘上: ${res.json.loaded_script}`);
  assert.equal(res.json.pid, pid, `宿主 = fixture 里真跑着的那个进程: ${res.json.pid}`);
  assert.notEqual(res.json.loaded_version, "current", "⛔ behind 不得与 current 同形");
});

test("loaded_version — the SAME fixture with the installed version equal to the loaded one ⇒ current (behind is not a constant)", async (t) => {
  const { home, ws } = await serveHostWorld(t, "current", { installed: "0.16.0", loadedVersion: "0.16.0" });

  const res = await cli(["server", "status", "--json"], ws, { HOME: home });
  assert.equal(res.json.loaded_version, "current", `同版本 ⇒ current: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.loaded, "0.16.0");
  assert.equal(res.json.installed, "0.16.0");
  assert.equal(res.json.loaded_version_reason, null);
});

test("loaded_version — host pid dead / cmdline carries no quay serve script / no version dir ⇒ not-evaluated with a NON-EMPTY reason (⛔ never current)", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "srvlv-home-neg-"));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "srvlv-bare-"));
  const ws = makeWorkspace("srvlv-neg");
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  });
  writeInstalledRegistry(home, "0.16.0");

  // (a) 宿主 pid 已死（载体还在盘上——SIGKILL 的形态）：没有运行中的进程 ≠ 跑的是最新版。
  const corpse = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const corpsePid = corpse.pid;
  while (pidAlive(corpsePid)) await new Promise((r) => setTimeout(r, 20));
  await writeCarrier(ws, corpsePid);
  const dead = await cli(["server", "status", "--json"], ws, { HOME: home });
  assert.equal(dead.json.loaded_version, "not-evaluated", `宿主已死 ⇒ not-evaluated: ${JSON.stringify(dead.json.loaded_version)}`);
  assert.notEqual(dead.json.loaded_version, "current", "⛔ not-evaluated 不得与 current 同形");
  assert.equal(dead.json.loaded, null, "没有读数就不编一个版本出来");
  assert.ok(
    typeof dead.json.loaded_version_reason === "string" && dead.json.loaded_version_reason.length > 0,
    `读不出必须给原因: ${JSON.stringify(dead.json.loaded_version_reason)}`,
  );

  // (b) 活着的 pid，但 cmdline 里根本没有 `quay … serve` 实参（pid 复用 / 不是 serve 宿主）。
  const notServe = spawn(process.execPath, ["-e", "setTimeout(()=>{},600000)"], { stdio: "ignore" });
  t.after(() => {
    try {
      notServe.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  });
  await writeCarrier(ws, notServe.pid);
  const wrongProc = await cli(["server", "status", "--json"], ws, { HOME: home });
  assert.equal(wrongProc.json.loaded_version, "not-evaluated", `不是 serve 宿主 ⇒ not-evaluated: ${JSON.stringify(wrongProc.json.loaded_version)}`);
  assert.equal(wrongProc.json.source, null, "没有直接量就没有来源");
  assert.ok(
    typeof wrongProc.json.loaded_version_reason === "string" && wrongProc.json.loaded_version_reason.length > 0,
    `认不出脚本必须给原因: ${JSON.stringify(wrongProc.json.loaded_version_reason)}`,
  );

  // (c) 活着的 serve 宿主，但它的脚本路径**推不出**版本目录（无版本段的源检出形态 / 被裁掉 VERSION
  //     的产物）：⛔ 不得退回「随便挑一个数字」，也不得伪装成 current。
  const noVerDir = path.join(bare, "no-version-segment");
  fs.mkdirSync(noVerDir, { recursive: true });
  const bareScript = path.join(noVerDir, "quay.js");
  fs.writeFileSync(bareScript, "setTimeout(() => {}, 600000);\n", "utf8");
  const barePid = spawnFakeServeHost(t, bareScript);
  await writeCarrier(ws, barePid);
  const noVersion = await cli(["server", "status", "--json"], ws, { HOME: home });
  assert.equal(noVersion.json.loaded_version, "not-evaluated", `推不出版本 ⇒ not-evaluated: ${JSON.stringify(noVersion.json.loaded_version)}`);
  assert.equal(noVersion.json.loaded, null);
  assert.equal(noVersion.json.loaded_script, bareScript, "脚本本身读到了（缺口在「推不出版本」，不在「认不出脚本」）");
  assert.ok(
    typeof noVersion.json.loaded_version_reason === "string" && noVersion.json.loaded_version_reason.length > 0,
    `推不出版本必须给原因: ${JSON.stringify(noVersion.json.loaded_version_reason)}`,
  );
});

test("loaded_version — the version comes from the version dir's VERSION file, NOT from `quay.js --version` (its output differs on purpose)", async (t) => {
  // 夹具的产物在 `--version` 时打印 9.9.9，而它的 VERSION 文件写 0.15.0 ⇒ 若实现 exec 了产物，
  // loaded 会是 "9.9.9"（且方向变成 ahead：9.9.9 > 0.16.0），两条断言都会红。
  const { home, ws, script } = await serveHostWorld(t, "noversionexec", {
    installed: "0.16.0",
    loadedVersion: "0.15.0",
    cliVersion: "9.9.9",
  });

  // 先证明夹具**会**用 9.9.9 回答 `--version`（否则这条判据是空转的）。
  const v = spawnSync(process.execPath, [script, "--version"], { encoding: "utf8" });
  assert.equal(v.stdout.trim(), "9.9.9", "the fixture's own --version really does print a DIFFERENT value");

  const res = await cli(["server", "status", "--json"], ws, { HOME: home });
  assert.equal(res.json.loaded, "0.15.0", `读数取自版本目录的 VERSION 文件: ${res.json.loaded}`);
  assert.notEqual(res.json.loaded, "9.9.9", "⛔ 不得取 `--version` 的输出（那是 bundle 内嵌版本，另一个量）");
  assert.equal(res.json.loaded_version, "behind", `方向必须按 VERSION 判（9.9.9 会读成 ahead）: ${res.json.loaded_version}`);
});

test("loaded_version — the TEXT form leads with loaded-version-<state> and, on behind, names `quay server restart` (⛔ never silent)", async (t) => {
  const { home, ws } = await serveHostWorld(t, "text", { installed: "0.16.0", loadedVersion: "0.15.0" });

  const behind = await cli(["server", "status"], ws, { HOME: home });
  assert.match(behind.stdout, /loaded-version-behind: loaded=0\.15\.0 installed=0\.16\.0/, `显式报 behind: ${behind.stdout}`);
  assert.match(behind.stdout, /quay server restart/, "behind 给出动作提示（⛔ 只提示，不自动重启）");

  const { home: home2, ws: ws2 } = await serveHostWorld(t, "textneg", { installed: "0.16.0", loadedVersion: "0.16.0" });
  const current = await cli(["server", "status"], ws2, { HOME: home2 });
  assert.match(current.stdout, /loaded-version-current: /, "同版本走另一个取值（不同形）");
  assert.doesNotMatch(current.stdout, /quay server restart/, "current 不给重启提示");
});
