// @test-group product
// AC-289 (task/gap-ac289-criterion-cmdline-port-literal-stale) — the ADDRESS-DERIVATION step of the
// criterion stored in `goals/AC-289-*.md`, exercised END-TO-END through that criterion TEXT ITSELF.
//
// WHAT THIS FILE IS DEFENDING. The criterion used to derive the address it probes from the `--host H
// --port N` LITERAL in the live process's cmdline. The launcher's web-port default is now
// `--port 0` = kernel-assigned (`plugin/scripts/start-drivers.ts`), so the derived value became
// `host:0` and the criterion reported `CAUSE=en-fetch-failed` against a server that was up the whole
// time — the ledger shows the SAME `criterionHash` green at 04:51Z and red from 08:21Z, i.e. the
// CARRIER moved, not the criterion's subject. The amendment moves that ONE step to the live host's
// own carrier `.quay/server.json` (writer `packages/quay/src/serve.ts`; read contract
// `packages/quay/src/server-state.ts`), which is the only place a kernel-assigned port is knowable.
//
// WHY THE CRITERION TEXT IS LOADED FROM `goals/` INSTEAD OF RESTATED HERE. 硬规则 4 推论三: a fixture
// that re-implements the thing proves "can produce", not "did produce" — and a test asserting on a
// COPY of the criterion would keep passing after the stored text drifted back to the literal. So
// every case below extracts `criterion` from the goal record on disk and runs it under `/bin/sh`, the
// same way `runAcceptance` does (`cwd` = the git root the criterion resolves as `$root`).
//
// HOW THE TWO DEPLOYMENT SHAPES ARE REPRODUCED, and why each direction is real rather than simulated:
//   · shape 1 (explicit port)  — a live process whose cmdline carries `--host H --port N`, and NO
//     carrier at all: the run can only succeed by reading the LITERAL, so it stays green if someone
//     later deletes the carrier path;
//   · shape 2 (kernel-assigned) — the same process shape with `--port 0` (the launcher default) plus
//     a carrier naming the port that is actually listening: the run can only succeed by reading the
//     CARRIER, which is the whole point of the amendment.
// The fake candidate is a real process in the temp root (`spawn`'s `argv0` sets its cmdline; its
// `/proc/<pid>/cwd` is the temp root), so `pgrep`/`/proc`/`curl` are exercised for real — nothing
// here stubs the probe.
//
// Run (scoped): node --test packages/quay/test/ac289-criterion-address-derivation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { parseDocument } from "yaml";
import {
  writeCarrier,
  mkRoot,
  runSh,
  derive,
  installLiveWebAddressHelper,
} from "./helpers/live-web-address-fixture.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const GOALS_DIR = path.join(REPO_ROOT, "goals");
const SHELL = "/bin/sh";

/** The criterion as STORED — never a copy. `parseDocument` (⛔ not `parse`) because a goal file
 *  carries a `statusLog` document after the frontmatter, which makes `parse` throw
 *  "Source contains multiple documents". */
function storedCriterion() {
  const file = fs.readdirSync(GOALS_DIR).find((f) => f.startsWith("AC-289-"));
  assert.ok(file, `no AC-289-*.md in ${GOALS_DIR}`);
  const doc = parseDocument(fs.readFileSync(path.join(GOALS_DIR, file), "utf8"));
  const criterion = doc.get("criterion");
  assert.equal(typeof criterion, "string", "AC-289 record carries no criterion string");
  return criterion;
}

/** The three live-face tools the criterion needs. Absent ⇒ NOT-EVALUATED (hard rule 3b): a skip is
 *  a different outcome from a pass, and this suite must never render "could not run the probe" as
 *  "the probe agreed". */
function missingTool() {
  for (const t of ["pgrep", "curl", "git"]) {
    const r = spawnSync("/usr/bin/env", [t === "git" ? "git" : t, t === "git" ? "--version" : "--version"], { encoding: "utf8" });
    if (r.error) return t;
  }
  return null;
}

/** The context a case is handed, plus the temp-root lifecycle.
 *
 *  ⚠️ The `mkdtempSync` binding and its `rmSync` live in THIS function on purpose — same scope, the
 *  removal inside a `finally`. That is the shape `tmp-leak-pairing-check` / `test-isolation-check`'s
 *  `detectMkdtempNoCleanup` accepts (its header: "covered when the variable is rmSync'd inside a
 *  cleanup region"); the earlier draft created the dir in a `makeTmpContext()` helper and cleaned
 *  `ctx.root` (a `realpathSync` of it), which the gate read as an UNPAIRED mkdtemp and blocked on.
 *  A /tmp leak gate that cannot see the pairing is not a false alarm here — the detector asks for the
 *  binding itself to be removed, so it is removed. */
async function withContext(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac289-crit-"));
  // The criterion resolves $root with `git rev-parse --show-toplevel`, so the temp root must BE a
  // repo; realpath because /proc/<pid>/cwd is a real path and `rev-parse` prints one too.
  const ctx = { root: fs.realpathSync(dir), servers: [], children: [] };
  try {
    execFileSync("git", ["init", "-q"], { cwd: ctx.root });
    installLiveWebAddressHelper(ctx.root);
    fs.mkdirSync(path.join(ctx.root, ".quay"), { recursive: true });
    await fn(ctx);
  } finally {
    for (const pid of ctx.children) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    for (const s of ctx.servers) await new Promise((r) => s.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A live process whose cmdline is `argv0` and whose cwd is the temp root — the shape the criterion
 *  is looking for. Blocks until the kernel has published the new argv0 (⛔ not a fixed sleep: the
 *  assertion is "the probe can see it", and a sleep would make that a race). */
async function fakeServe(ctx, argv0) {
  const child = spawn("/bin/sleep", ["120"], { argv0, cwd: ctx.root, detached: true, stdio: "ignore" });
  child.unref();
  ctx.children.push(child.pid);
  const deadline = Date.now() + 5000;
  for (;;) {
    let cmdline = "";
    try {
      cmdline = fs.readFileSync(`/proc/${child.pid}/cmdline`, "utf8");
    } catch {
      /* not yet visible */
    }
    if (cmdline.includes(argv0.split(" ")[0]) && cmdline.includes("serve")) return child.pid;
    if (Date.now() > deadline) assert.fail(`fake candidate pid ${child.pid} never published argv0 ${JSON.stringify(argv0)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const EN_PAGE = `<!doctype html><html lang="en"><head><title>ac289-fixture — Dashboard</title></head><body><nav><a href="/dashboard">Dashboard</a><a href="/tasks">Tasks</a></nav><h1>Dashboard</h1></body></html>`;
const ZH_PAGE = `<!doctype html><html lang="zh"><head><title>ac289-fixture — 仪表盘</title></head><body><nav><a href="/dashboard">仪表盘</a><a href="/tasks">任务</a></nav><h1>仪表盘</h1></body></html>`;
/** The MUTANT of AC2(a): zh response, but the nav still renders the English label. */
const ZH_PAGE_NAV_NOT_WIRED = ZH_PAGE.replace("仪表盘</a><a href=\"/tasks\"", "Dashboard</a><a href=\"/tasks\"");

/** A real HTTP face for /dashboard. `zhPage` is what `Cookie: lang=zh` gets. */
async function startPage(ctx, zhPage = ZH_PAGE) {
  const server = http.createServer((req, res) => {
    const zh = /(?:^|;\s*)lang=zh(?:;|$)/.test(String(req.headers.cookie ?? ""));
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(zh ? zhPage : EN_PAGE);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  ctx.servers.push(server);
  return server.address().port;
}

/** A port nothing is listening on: bind an ephemeral one, learn it, release it. */
async function deadPort() {
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Run the stored criterion with `cwd` = the temp root (the same anchor `runAcceptance` uses).
 *
 *  ⚠️ ASYNC ON PURPOSE — `spawnSync` here would deadlock the probe it is measuring: the HTTP face of
 *  each case lives in THIS process, and a synchronous child blocks the event loop, so `curl` connects
 *  (the kernel accepts into the listen backlog) and then receives ZERO bytes until its 10s
 *  `--max-time` fires. Measured while writing this file: every "should pass" case failed as
 *  `cause=fetch-failed(timeout) ... 0 bytes received` — a fixture bug that would have read as a
 *  criterion defect. */
function runCriterion(ctx) {
  return new Promise((resolve) => {
    const child = spawn(SHELL, ["-c", storedCriterion()], { cwd: ctx.root });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const killer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({ code, stdout, stderr });
    });
  });
}

const GATE = missingTool() === null ? test : test.skip;

GATE("AC-289 criterion: shape 1 — an explicit `--port N` in the cmdline is used, with NO carrier present", async () => {
  await withContext(async (ctx) => {
    const port = await startPage(ctx);
    await fakeServe(ctx, `quay.ts serve --host 127.0.0.1 --port ${port}`);
    const r = await runCriterion(ctx);
    assert.equal(r.code, 0, `criterion should pass, got ${r.code}; stderr=${r.stderr}`);
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${port} cause=fetch-answered`), r.stderr);
    assert.ok(!fs.existsSync(path.join(ctx.root, ".quay", "server.json")), "this case must have no carrier to fall back on");
    assert.match(r.stdout, /OK -- \/dashboard/, r.stdout);
  });
});

GATE("AC-289 criterion: shape 2 — `--port 0` (the launcher default) falls back to the carrier's real port", async () => {
  await withContext(async (ctx) => {
    const port = await startPage(ctx);
    const pid = await fakeServe(ctx, "quay.ts serve --host 127.0.0.1 --port 0");
    writeCarrier(ctx.root, { pid, host: "127.0.0.1", port });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 0, `criterion should pass, got ${r.code}; stderr=${r.stderr}`);
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${port} cause=fetch-answered`), r.stderr);
    assert.doesNotMatch(r.stderr, /addr=127\.0\.0\.1:0\b/, "the literal `:0` must never be probed");
  });
});

GATE("AC-289 criterion: a `0.0.0.0` bind host from the carrier is normalized to 127.0.0.1", async () => {
  await withContext(async (ctx) => {
    const port = await startPage(ctx);
    const pid = await fakeServe(ctx, "quay.ts serve --host 0.0.0.0 --port 0");
    writeCarrier(ctx.root, { pid, host: "0.0.0.0", port });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 0, `criterion should pass, got ${r.code}; stderr=${r.stderr}`);
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${port}`), r.stderr);
  });
});

GATE("AC-289 criterion: NOT a literal — a restart binding a different port resolves to that new port", async () => {
  await withContext(async (ctx) => {
    const first = await startPage(ctx);
    const pid = await fakeServe(ctx, "quay.ts serve --host 127.0.0.1 --port 0");
    writeCarrier(ctx.root, { pid, host: "127.0.0.1", port: first });
    const a = await runCriterion(ctx);
    const second = await startPage(ctx);
    writeCarrier(ctx.root, { pid, host: "127.0.0.1", port: second });
    const b = await runCriterion(ctx);
    assert.notEqual(first, second, "the two HTTP faces must be on different ports for this to be a control");
    assert.equal(a.code, 0, `run A failed: ${a.stderr}`);
    assert.equal(b.code, 0, `run B failed: ${b.stderr}`);
    assert.match(a.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${first}`), a.stderr);
    assert.match(b.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${second}`), b.stderr);
  });
});

GATE("AC-289 criterion: no carrier at all ⇒ address not derivable, fails closed with a NAMED cause", async () => {
  await withContext(async (ctx) => {
    await fakeServe(ctx, "quay.ts serve --host 127.0.0.1 --port 0");
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1, `expected a non-zero verdict, got ${r.code}`);
    assert.match(r.stderr, /cause=carrier-absent/, r.stderr);
    assert.match(r.stderr, /CAUSE=no-derivable-serve-address/, r.stderr);
    assert.doesNotMatch(r.stderr, /CAUSE=en-fetch-failed/, "an underivable address is NOT a fetch failure");
  });
});

GATE("AC-289 criterion: carrier without a `web` service ⇒ carrier-no-web-service", async () => {
  await withContext(async (ctx) => {
    const pid = await fakeServe(ctx, "quay.ts serve --host 127.0.0.1 --port 0");
    writeCarrier(ctx.root, { pid, host: "127.0.0.1", port: 1, dropWeb: true });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cause=carrier-no-web-service/, r.stderr);
  });
});

GATE("AC-289 criterion: carrier naming a DIFFERENT pid is refused (a stale carrier must not be trusted)", async () => {
  await withContext(async (ctx) => {
    const pid = await fakeServe(ctx, "quay.ts serve --host 127.0.0.1 --port 0");
    writeCarrier(ctx.root, { pid: pid + 100000, host: "127.0.0.1", port: 1 });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cause=carrier-pid-mismatch/, r.stderr);
  });
});

GATE("AC-289 criterion: a `web` entry marked down ⇒ carrier-web-down", async () => {
  await withContext(async (ctx) => {
    const pid = await fakeServe(ctx, "quay.ts serve --host 127.0.0.1 --port 0");
    writeCarrier(ctx.root, { pid, host: "127.0.0.1", port: 1, up: false });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cause=carrier-web-down/, r.stderr);
  });
});

GATE("AC-289 criterion: a carrier port nobody listens on ⇒ connection-refused is NAMED, not left as 'no message'", async () => {
  await withContext(async (ctx) => {
    const port = await deadPort();
    const pid = await fakeServe(ctx, "quay.ts serve --host 127.0.0.1 --port 0");
    writeCarrier(ctx.root, { pid, host: "127.0.0.1", port });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /CAUSE=no-reachable-serve-address/, r.stderr);
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${port} cause=fetch-failed\\(connection-refused\\)`), r.stderr);
  });
});

GATE("AC-289 criterion: candidates accumulate — every candidate gets a pid + address + cause, and none wipes a derived one", async () => {
  await withContext(async (ctx) => {
    const port = await startPage(ctx);
    const pid = await fakeServe(ctx, `quay.ts serve --host 127.0.0.1 --port ${port}`);
    const r = await runCriterion(ctx);
    assert.equal(r.code, 0, r.stderr);
    const rows = r.stderr.split("; ").filter((s) => s.startsWith("pid="));
    assert.ok(rows.length >= 2, `expected the runner's OWN shell to be reported as a candidate too, got: ${r.stderr}`);
    const mine = rows.find((s) => s.startsWith(`pid=${pid} `));
    assert.ok(mine, `the live candidate pid ${pid} must appear: ${r.stderr}`);
    assert.match(mine, /cause=fetch-answered/);
    for (const row of rows) {
      assert.match(row, /addr=(<none>|\d+\.\d+\.\d+\.\d+:\d+)/, `row has no address: ${row}`);
      assert.match(row, /cause=\S+/, `row has no cause: ${row}`);
    }
  });
});

GATE("AC-289 criterion: the ASSERTION block is still live — a zh page whose nav was never wired fails, and says which arm", async () => {
  await withContext(async (ctx) => {
    const port = await startPage(ctx, ZH_PAGE_NAV_NOT_WIRED);
    const pid = await fakeServe(ctx, "quay.ts serve --host 127.0.0.1 --port 0");
    writeCarrier(ctx.root, { pid, host: "127.0.0.1", port });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1, "the amended derivation must not have softened the assertion it feeds");
    assert.match(r.stderr, /CAUSE=nav-label-untranslated/, r.stderr);
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${port}`), "the address was derived — the failure is the assertion, not the probe");
  });
});
