// @test-group serial
//
// goal-preview-trial-surface.test.mjs — gap-goal-branch-preview-trial-surface-declarable: the
// DECLARABLE trial surface (SPEC-goal-branch-2026-10-03 §4.10). A consumer workspace may declare
// its own preview product in `.quay/config.yml` `preview:` (command + health URL); `goal preview`
// then starts THAT instead of the hard-coded `quay.ts serve`, and a live-probe AC locates the
// product through the same carrier the preview mechanism writes.
//
// WHAT EACH CASE MEASURES (all against a REAL git repo + a REAL child process, ⛔ no injected seam
// that fakes a reading):
//   · AC1 — the declaration is validated by the SAME judge the runtime uses (`parsePreviewConfig`):
//     a legal section passes `config validate`, an illegal one (missing command) fails naming
//     `preview.command`.
//   · AC2 — `goal preview start` runs the DECLARED command: the spawned pid's /proc cmdline matches
//     the declared argv, `status` reports running, and the declared health URL answers HTTP 200.
//   · AC3 — NO declaration ⇒ the historical fallback: `start` still spawns `quay.ts serve` (the
//     spawned argv carries `quay.ts … serve`).
//   · AC4 — a live-probe AC written per the declared health convention reads exit 0 (achieved) when
//     the preview is up, and exit 3 (not-evaluated) when it is not (ruling ㉒).
//   · AC5 — fail-closed: a declaration naming a non-existent command makes `start` return `failed`
//     (⛔ never `started`) and the live-probe AC read not-evaluated (no carrier was written).
//
// Run: node --test packages/quay/test/goal-preview-trial-surface.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  startPreviewServe,
  readPreviewStatus,
  stopPreviewServe,
  readDeclaredPreviewCarrier,
  previewWorktreeDir,
} from "../src/goal-preview.ts";
import { parsePreviewConfig } from "../src/config.ts";
import { readProcCmdline, isQuayServe } from "../src/kernel/proc-identity.ts";
import { syncGoalCriterionWorktrees } from "../../../plugin/scripts/goal-driver.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root of THIS checkout (a task worktree during dispatch). */
const REPO = path.resolve(HERE, "..", "..", "..");
const QUAY_TS = path.join(REPO, "packages", "quay", "bin", "quay.ts");

const GOAL = "GOAL-902";
const BRANCH = "goal/GOAL-902";

/** A minimal HTTP server shaped like a consumer product: answers 200 on ANY path, stays alive, dies
 *  on SIGTERM/SIGINT. Its argv is `node preview-server.mjs --port N`. */
const PREVIEW_SERVER = `import http from "node:http";
const argv = process.argv.slice(2);
const k = argv.indexOf("--port");
const port = k >= 0 ? Number(argv[k + 1]) : 0;
if (!Number.isInteger(port) || port < 1) process.exit(2);
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("preview-ok");
});
server.listen(port, "127.0.0.1");
function bye() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
setInterval(() => {}, 1000);
`;

/** A serve-shaped child for AC3's fallback path: its argv carries `quay.ts … serve`, publishes the
 *  REAL `.quay/server.json` carrier (schemaVersion 1 + a live `web` entry) so the quay-serve reader
 *  sees a genuine instance — the same stub shape `goal-preview.test.mjs` uses. */
const SERVE_STUB = `import fs from "node:fs";
import path from "node:path";
const argv = process.argv.slice(2);
if (!argv.includes("serve")) process.exit(2);
function flag(n) { const k = argv.indexOf(n); return k >= 0 ? argv[k + 1] : undefined; }
const port = Number(flag("--port"));
const host = flag("--host") ?? "127.0.0.1";
const root = process.cwd();
const carrier = path.join(root, ".quay", "server.json");
fs.mkdirSync(path.dirname(carrier), { recursive: true });
function publish() {
  fs.writeFileSync(carrier, JSON.stringify({
    schemaVersion: 1,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    services: [
      { name: "web", pid: process.pid, host, port, up: true },
      { name: "control", pid: process.pid, host: "127.0.0.1", port: 1, up: true },
    ],
  }, null, 2));
}
publish();
function bye() { try { fs.rmSync(carrier, { force: true }); } catch {} process.exit(0); }
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
setInterval(() => {}, 1000);
`;

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

/** Every mkdtemp'd dir is pushed into this carrier and removed in ONE `after()` hook — the
 *  documented `tmp-leak-pairing-check` carrier pattern. */
const _created = [];
after(() => {
  for (const d of _created) fs.rmSync(d, { recursive: true, force: true });
});
function mkTmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _created.push(dir);
  return dir;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** GET a URL and resolve the status code (or -1 when unreachable). */
function httpStatus(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? -1);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(-1));
  });
}

function previewYaml(decl) {
  const lines = ["preview:"];
  if (decl.command) {
    lines.push("  command:");
    for (const tok of decl.command) lines.push(`    - ${JSON.stringify(tok)}`);
  }
  if (decl.healthUrl) {
    lines.push("  health:");
    lines.push(`    url: ${JSON.stringify(decl.healthUrl)}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * A real consumer-shaped workspace: a git repo whose `.quay/config.yml` carries the `preview:`
 * declaration (gitignored, so it travels by snapshot) and whose tracked tree carries
 * `preview-server.mjs` (the declared product). `goal/GOAL-902` branches off with a branch-only file
 * so the criterion worktree has its own tip, exactly like a real branch-mode goal.
 */
function mkConsumerFixture(decl) {
  const root = mkTmpDir("goal-preview-trial-");
  const ns = mkTmpDir("goal-preview-trial-ns-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), ".quay/\n", "utf8");
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    decl.command || decl.healthUrl ? `loop:\n  worktree_root: ${ns}\n${previewYaml(decl)}` : `loop:\n  worktree_root: ${ns}\n`,
    "utf8",
  );
  fs.writeFileSync(path.join(root, "preview-server.mjs"), PREVIEW_SERVER, "utf8");

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.invalid"]);
  git(root, ["config", "user.name", "t"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  git(root, ["branch", "-M", "main"]);
  git(root, ["checkout", "-q", "-b", BRANCH]);
  fs.writeFileSync(path.join(root, "only-on-goal-branch.txt"), "goal branch only\n", "utf8");
  git(root, ["add", "only-on-goal-branch.txt"]);
  git(root, ["commit", "-q", "-m", "goal-branch-only file"]);
  git(root, ["checkout", "-q", "main"]);
  return { root, ns, wtPath: previewWorktreeDir(root, GOAL) };
}

/** A fixture whose tracked tree carries a `quay.ts serve`-shaped entry (the NO-declaration default
 *  is "run the worktree's own quay code"), for AC3's fallback case. */
function mkServeFixture() {
  const root = mkTmpDir("goal-preview-fallback-");
  const ns = mkTmpDir("goal-preview-fallback-ns-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "quay", "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), ".quay/\n", "utf8");
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), `loop:\n  worktree_root: ${ns}\n`, "utf8");
  fs.writeFileSync(path.join(root, "packages", "quay", "bin", "quay.ts"), SERVE_STUB, "utf8");

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.invalid"]);
  git(root, ["config", "user.name", "t"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  git(root, ["branch", "-M", "main"]);
  git(root, ["checkout", "-q", "-b", BRANCH]);
  fs.writeFileSync(path.join(root, "only-on-goal-branch.txt"), "goal branch only\n", "utf8");
  git(root, ["add", "only-on-goal-branch.txt"]);
  git(root, ["commit", "-q", "-m", "goal-branch-only file"]);
  git(root, ["checkout", "-q", "main"]);
  return { root, ns, wtPath: previewWorktreeDir(root, GOAL) };
}

/** The live-probe AC body, written per the DECLARED health convention: read the preview carrier the
 *  mechanism wrote, curl its healthUrl. exit 0 = achieved; exit 3 = not-evaluated (no carrier, or the
 *  health endpoint does not answer — the goal mechanism's word list). */
const LIVE_PROBE_AC = `set -u
root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
carrier="$root/.quay/preview.json"
[ -f "$carrier" ] || { echo "NOT-EVALUATED: no preview carrier at $carrier (the preview is not up)" >&2; exit 3; }
url=$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(c.healthUrl)' "$carrier" 2>/dev/null) || { echo "NOT-EVALUATED: preview carrier unreadable" >&2; exit 3; }
curl -sf --max-time 10 "$url" >/dev/null || { echo "NOT-EVALUATED: preview health endpoint $url did not answer HTTP 200" >&2; exit 3; }
echo "PASS: declared preview healthy at $url"
exit 0
`;

function runLiveProbeAc(cwd) {
  const script = path.join(cwd, ".quay", "live-probe-ac.sh");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, LIVE_PROBE_AC, "utf8");
  const r = spawnSync("bash", [script], { encoding: "utf8", cwd, timeout: 30000 });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function teardown(fx) {
  if (fx?.wtPath) {
    try {
      stopPreviewServe(fx.wtPath, { graceMs: 2000 });
    } catch {
      /* best-effort */
    }
  }
  for (const d of [fx?.root, fx?.ns]) {
    if (d) fs.rmSync(d, { recursive: true, force: true });
  }
}

const PORT_A = 46001;
const PORT_B = 46002;
const PORT_C = 46003;
const PORT_D = 46004;

test("AC1: a declared preview validates; a malformed one fails naming the field", () => {
  // The single judge is shared with the runtime — a unit check first, then the CLI surface.
  const legal = { command: ["node", "preview-server.mjs", "--port", "{port}"], health: { url: "http://127.0.0.1:{port}/healthz" } };
  assert.equal(parsePreviewConfig(legal).ok, true, "a legal declaration must parse");
  assert.equal(parsePreviewConfig(undefined).ok, false, "absence is not a declaration");
  assert.equal(parsePreviewConfig({ health: { url: "http://127.0.0.1:{port}/ok" } }).ok, false, "missing command is a shape error");
  assert.equal(parsePreviewConfig({ command: ["node", "x.mjs"] }).ok, false, "missing health.url is a shape error");
  assert.match(parsePreviewConfig({ command: ["node", "x.mjs"] }).reason, /preview\.health\.url/, "the reason must name the field");
  assert.match(parsePreviewConfig({ health: { url: "http://x/" } }).reason, /preview\.command/, "the reason must name the missing command field");

  const ws = mkTmpDir("preview-config-");
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  const cliArgs = ["--no-warnings", "--experimental-strip-types", QUAY_TS, "config", "validate", "--root", ws];
  const cliOut = (r) => `${r.stdout ?? ""}${r.stderr ?? ""}`;

  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), previewYaml({ command: legal.command, healthUrl: legal.health.url }), "utf8");
  const ok = spawnSync(process.execPath, cliArgs, { encoding: "utf8" });
  assert.equal(ok.status, 0, `legal declaration must validate (exit 0): ${cliOut(ok)}`);

  // ⛔ Missing `preview.command` — an ERROR, exit non-0, and the message names the field.
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), previewYaml({ healthUrl: "http://127.0.0.1:{port}/healthz" }), "utf8");
  const bad = spawnSync(process.execPath, cliArgs, { encoding: "utf8" });
  assert.notEqual(bad.status, 0, `missing command must fail validation: ${cliOut(bad)}`);
  assert.match(cliOut(bad), /preview\.command/, `the error must name preview.command: ${cliOut(bad)}`);
});

test("AC2: goal preview start runs the DECLARED command; status reports running; health answers 200", async () => {
  const fx = mkConsumerFixture({
    command: ["node", "preview-server.mjs", "--port", "{port}"],
    healthUrl: "http://127.0.0.1:{port}/healthz",
  });
  try {
    const sync = syncGoalCriterionWorktrees(fx.root, [{ id: GOAL, branch: true }]);
    assert.equal(sync[0]?.state, "created", `criterion worktree must be created: ${JSON.stringify(sync)}`);
    assert.ok(fs.existsSync(fx.wtPath), "preview worktree must exist");

    // Drive the REAL CLI verb, not the function — `goal preview <GOAL> start` is the surface under test.
    const start = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", QUAY_TS, "goal", "preview", GOAL, "start", "--port", String(PORT_A), "--root", fx.root, "--json"],
      { encoding: "utf8", cwd: fx.root, timeout: 60000 },
    );
    assert.equal(start.status, 0, `start must exit 0: ${start.stdout} ${start.stderr}`);
    const started = JSON.parse(start.stdout.trim());
    assert.equal(started.state, "started", `start must report started: ${start.stdout}`);

    // The carrier the mechanism wrote names the declared command + resolved health URL.
    const carrier = readDeclaredPreviewCarrier(fx.wtPath);
    assert.equal(carrier.state, "present", `start must write a preview carrier: ${JSON.stringify(carrier)}`);
    assert.deepEqual(carrier.carrier.command, ["node", "preview-server.mjs", "--port", String(PORT_A)], "carrier must record the resolved declared command");
    assert.equal(carrier.carrier.healthUrl, `http://127.0.0.1:${PORT_A}/healthz`, "carrier must record the resolved health URL");
    assert.ok(alive(carrier.carrier.pid), "the spawned pid must be alive");

    // The process's REAL /proc cmdline matches the declared command.
    const cmd = readProcCmdline(carrier.carrier.pid);
    assert.ok(
      cmd.includes("preview-server.mjs") && cmd.includes("--port") && cmd.includes(String(PORT_A)),
      `spawned argv must match the declared command (argv=${JSON.stringify(cmd)})`,
    );

    // The declared health endpoint is reachable and answers HTTP 200.
    assert.equal(await httpStatus(carrier.carrier.healthUrl), 200, "health endpoint must answer 200");

    // `status` reports running through the CLI.
    const status = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", QUAY_TS, "goal", "preview", GOAL, "status", "--root", fx.root, "--json"],
      { encoding: "utf8", cwd: fx.root, timeout: 30000 },
    );
    assert.equal(status.status, 0, `status must exit 0: ${status.stdout} ${status.stderr}`);
    const st = JSON.parse(status.stdout.trim());
    assert.equal(st.state, "running", `status must report running: ${status.stdout}`);
    assert.equal(st.pid, carrier.carrier.pid, "status must name the same pid");
  } finally {
    teardown(fx);
  }
});

test("AC3: no declaration falls back to the worktree's own quay.ts serve", async () => {
  const fx = mkServeFixture();
  try {
    const sync = syncGoalCriterionWorktrees(fx.root, [{ id: GOAL, branch: true }]);
    assert.equal(sync[0]?.state, "created", `criterion worktree must be created: ${JSON.stringify(sync)}`);

    const start = await startPreviewServe({ previewRoot: fx.wtPath, port: PORT_B, host: "127.0.0.1" });
    assert.equal(start.state, "started", `fallback serve must start: ${start.detail}`);
    assert.ok(Number.isInteger(start.pid) && start.pid > 0, "start must report a live pid");

    const cmd = readProcCmdline(start.pid);
    assert.ok(isQuayServe(cmd), `the fallback must still be a quay serve (argv=${JSON.stringify(cmd)})`);
    assert.equal(readPreviewStatus(fx.wtPath).state, "running", "status must read running");
  } finally {
    teardown(fx);
  }
});

test("AC4: a live-probe AC reads 0 when the declared preview is up, 3 when it is not", async () => {
  const fx = mkConsumerFixture({
    command: ["node", "preview-server.mjs", "--port", "{port}"],
    healthUrl: "http://127.0.0.1:{port}/healthz",
  });
  try {
    const sync = syncGoalCriterionWorktrees(fx.root, [{ id: GOAL, branch: true }]);
    assert.equal(sync[0]?.state, "created", `criterion worktree must be created: ${JSON.stringify(sync)}`);

    // Not up yet ⇒ not-evaluated (exit 3), NOT a false achieved.
    const before = runLiveProbeAc(fx.wtPath);
    assert.equal(before.code, 3, `live-probe AC must read not-evaluated before start: ${before.stdout} ${before.stderr}`);

    const start = await startPreviewServe({ previewRoot: fx.wtPath, port: PORT_C });
    assert.equal(start.state, "started", `declared preview must start: ${start.detail}`);

    const up = runLiveProbeAc(fx.wtPath);
    assert.equal(up.code, 0, `live-probe AC must read achieved once up: ${up.stdout} ${up.stderr}`);

    const stop = stopPreviewServe(fx.wtPath);
    assert.equal(stop.state, "stopped", `stop must stop the declared preview: ${stop.detail}`);

    const afterStop = runLiveProbeAc(fx.wtPath);
    assert.equal(afterStop.code, 3, `live-probe AC must read not-evaluated after stop: ${afterStop.stdout} ${afterStop.stderr}`);
  } finally {
    teardown(fx);
  }
});

test("AC5: fail-closed — a non-existent declared command makes start return failed, never started", async () => {
  const fx = mkConsumerFixture({
    command: ["definitely-not-a-real-preview-command-xyz", "--port", "{port}"],
    healthUrl: "http://127.0.0.1:{port}/healthz",
  });
  try {
    const sync = syncGoalCriterionWorktrees(fx.root, [{ id: GOAL, branch: true }]);
    assert.equal(sync[0]?.state, "created", `criterion worktree must be created: ${JSON.stringify(sync)}`);

    const start = await startPreviewServe({ previewRoot: fx.wtPath, port: PORT_D });
    assert.equal(start.state, "failed", `a non-existent command must fail: ${start.detail}`);
    // ⛔ No carrier written ⇒ the live-probe AC cannot mistake this for a live preview.
    assert.equal(readDeclaredPreviewCarrier(fx.wtPath).state, "absent", "a failed start must not write a carrier");
    assert.equal(readPreviewStatus(fx.wtPath).state, "not-running", "status must read not-running, not a false running");

    const probe = runLiveProbeAc(fx.wtPath);
    assert.equal(probe.code, 3, `live-probe AC must read not-evaluated on a failed start: ${probe.stdout} ${probe.stderr}`);
  } finally {
    teardown(fx);
  }
});
