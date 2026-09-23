// @test-group product
// AC-291 (task/gap-ac291-criterion-cmdline-port-literal-stale) — the ADDRESS-DERIVATION step of the
// criterion stored in `goals/AC-291-*.md`, exercised END-TO-END through that criterion TEXT ITSELF.
//
// WHAT THIS FILE IS DEFENDING. The criterion used to derive the address it probes from the `--host H
// --port N` LITERAL in the live process's cmdline. The launcher's web-port default is now
// `--port 0` = kernel-assigned (`plugin/scripts/start-drivers.ts`, changed by ce0f47518
// gap-serve-same-root-admission-lock), so the derived value became `host:0` and the criterion
// reported `CAUSE=en-fetch-failed` against a server that was up the whole time — the ledger shows
// the SAME `criterionHash` 848bfb6418f2a892 green at 2026-09-23T05:08:40.467Z and red from
// 08:36:03.044Z, i.e. the CARRIER moved, not the criterion's subject. The amendment moves that ONE
// step to the live host's own carrier `.quay/server.json` (writer `packages/quay/src/serve.ts`; read
// contract `packages/quay/src/server-state.ts`), which is the only place a kernel-assigned port is
// knowable.
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
// The fake candidate is a real process in the temp root with production's argv shape (`node … quay.ts
// serve <flags>`; its `/proc/<pid>/cwd` is the temp root), so `pgrep`/`/proc`/`curl` are exercised
// for real — nothing here stubs the probe.
//
// THE RUNNER IS A CANDIDATE TOO, and that is not an accident of the fixture: the gate runs the
// criterion as `sh -c ". <env> && <criterion>"`, so that shell's cwd is $root and its cmdline
// contains the criterion text (which contains `quay.ts serve`) ⇒ `pgrep -f` matches it. The last
// case in this file pins the reading that keeps the two refusal modes apart: the runner is reported
// with a pid + address + cause, but it is NOT counted as a serve (its argv carries no standalone
// `serve` element), so "no instance here" stays distinguishable from "an instance I could not reach".
//
// Run (scoped): node --test packages/quay/test/ac291-criterion-address-derivation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { parseDocument } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const GOALS_DIR = path.join(REPO_ROOT, "goals");
const SHELL = "/bin/sh";

/** The criterion as STORED — never a copy. `parseDocument` (⛔ not `parse`) because a goal file
 *  carries a `statusLog` document after the frontmatter, which makes `parse` throw
 *  "Source contains multiple documents". */
function storedCriterion() {
  const file = fs.readdirSync(GOALS_DIR).find((f) => f.startsWith("AC-291-"));
  assert.ok(file, `no AC-291-*.md in ${GOALS_DIR}`);
  const doc = parseDocument(fs.readFileSync(path.join(GOALS_DIR, file), "utf8"));
  const criterion = doc.get("criterion");
  assert.equal(typeof criterion, "string", "AC-291 record carries no criterion string");
  return criterion;
}

/** The three live-face tools the criterion needs. Absent ⇒ NOT-EVALUATED (hard rule 3b): a skip is
 *  a different outcome from a pass, and this suite must never render "could not run the probe" as
 *  "the probe agreed". */
function missingTool() {
  for (const t of ["pgrep", "curl", "git"]) {
    const r = spawnSync("/usr/bin/env", [t, "--version"], { encoding: "utf8" });
    if (r.error) return t;
  }
  return null;
}

/** The context a case is handed, plus the temp-root lifecycle.
 *
 *  ⚠️ The `mkdtempSync` binding and its `rmSync` live in THIS function on purpose — same scope, the
 *  removal inside a `finally`. That is the shape `tmp-leak-pairing-check` / `test-isolation-check`'s
 *  `detectMkdtempNoCleanup` accepts (its header: "covered when the variable is rmSync'd inside a
 *  cleanup region"); a version that created the dir in a helper and cleaned `ctx.root` (a
 *  `realpathSync` of it) reads as an UNPAIRED mkdtemp and is blocked on. A /tmp leak gate that cannot
 *  see the pairing is not a false alarm here — the detector asks for the binding itself to be
 *  removed, so it is removed. */
async function withContext(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac291-crit-"));
  // The criterion resolves $root with `git rev-parse --show-toplevel`, so the temp root must BE a
  // repo; realpath because /proc/<pid>/cwd is a real path and `rev-parse` prints one too.
  const ctx = { root: fs.realpathSync(dir), servers: [], children: [] };
  try {
    execFileSync("git", ["init", "-q"], { cwd: ctx.root });
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

/** A live process whose cmdline has the SAME ARGV SHAPE as a real instance — `node … quay.ts serve
 *  <flags>` — and whose cwd is the temp root. A real interpreter is used (⛔ not an argv0 relabel on
 *  `/bin/sleep`) because the criterion reads TWO different things out of the cmdline: `pgrep -f
 *  'quay.ts serve'` (a substring) and the `serve` SUBCOMMAND as its own argv element (`grep -qx`).
 *  A single relabelled argv[0] carries the substring but not the element, so it would silently
 *  exercise a different path than production does.
 *
 *  `flags` is the launcher's flag list — `["--host", h, "--port", String(p)]` for shape 1, and
 *  `["--host", h, "--port", "0"]` / `["--host", h]` for the kernel-assigned shapes. Blocks until
 *  the kernel has published the cmdline (⛔ not a fixed sleep: the assertion is "the probe can see
 *  it", and a sleep would make that a race). */
async function fakeServe(ctx, flags = []) {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)", "quay.ts", "serve", ...flags], {
    cwd: ctx.root,
    detached: true,
    stdio: "ignore",
    argv0: "node",
  });
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
    const argv = cmdline.split("\0");
    if (argv.includes("serve") && argv.some((a) => a.includes("quay.ts"))) return child.pid;
    if (Date.now() > deadline) assert.fail(`fake candidate pid ${child.pid} never published the serve argv (cmdline=${JSON.stringify(cmdline)})`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

// The two faces of /live, byte-shaped like the real page's chrome (the criterion only reads <nav>
// and <title>): EN carries the literal nav label "Live", ZH is <html lang="zh"> with the label
// translated and its OWN <title> changed.
const EN_PAGE = `<!doctype html><html lang="en"><head><title>quay — Live — loop activity</title></head><body><nav><a href="/dashboard">Dashboard</a><a href="/live">Live</a></nav><h1>Live</h1></body></html>`;
const ZH_PAGE = `<!doctype html><html lang="zh"><head><title>quay — 实时 — 循环活动</title></head><body><nav><a href="/dashboard">仪表盘</a><a href="/live">实时</a></nav><h1>实时</h1></body></html>`;
/** The MUTANT of the zh arm: a zh response whose <title> did change but whose nav still renders the
 *  English label — the case the amendment must NOT have softened away. */
const ZH_PAGE_NAV_NOT_WIRED = ZH_PAGE.replace("实时</a></nav>", "Live</a></nav>");

/** A real HTTP face for /live. `zhPage` is what `Cookie: lang=zh` gets. */
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

function writeCarrier(ctx, { pid, host, port, up = true, dropWeb = false }) {
  const services = [];
  if (!dropWeb) services.push({ name: "web", pid, host, port, up });
  services.push({ name: "control", pid, host: "127.0.0.1", port: 1, up: true });
  fs.writeFileSync(
    path.join(ctx.root, ".quay", "server.json"),
    JSON.stringify({ schemaVersion: 1, pid, startedAt: new Date().toISOString(), services }, null, 2),
  );
}

/** Run the stored criterion with `cwd` = the temp root (the same anchor `runAcceptance` uses).
 *
 *  ⚠️ ASYNC ON PURPOSE — `spawnSync` here would deadlock the probe it is measuring: the HTTP face of
 *  each case lives in THIS process, and a synchronous child blocks the event loop, so `curl` connects
 *  (the kernel accepts into the listen backlog) and then receives ZERO bytes until its 10s
 *  `--max-time` fires. */
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

/** The per-candidate rows the criterion writes to stderr (see its own report line). */
function candidateRows(r) {
  return r.stderr.split("; ").filter((s) => s.startsWith("pid="));
}

const GATE = missingTool() === null ? test : test.skip;

GATE("AC-291 criterion: shape 1 — an explicit `--port N` in the cmdline is used, with NO carrier present", async () => {
  await withContext(async (ctx) => {
    const port = await startPage(ctx);
    await fakeServe(ctx, ["--host", "127.0.0.1", "--port", String(port)]);
    const r = await runCriterion(ctx);
    assert.equal(r.code, 0, `criterion should pass, got ${r.code}; stderr=${r.stderr}`);
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${port} argv=argv-explicit-port cause=fetch-answered`), r.stderr);
    assert.ok(!fs.existsSync(path.join(ctx.root, ".quay", "server.json")), "this case must have no carrier to fall back on");
    assert.match(r.stdout, /OK -- \/live/, r.stdout);
  });
});

GATE("AC-291 criterion: shape 2 — `--port 0` (the launcher default) falls back to the carrier's real port", async () => {
  await withContext(async (ctx) => {
    const port = await startPage(ctx);
    const pid = await fakeServe(ctx, ["--host", "127.0.0.1", "--port", "0"]);
    writeCarrier(ctx, { pid, host: "127.0.0.1", port });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 0, `criterion should pass, got ${r.code}; stderr=${r.stderr}`);
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${port} argv=\\S+ cause=fetch-answered`), r.stderr);
    assert.doesNotMatch(r.stderr, /addr=127\.0\.0\.1:0\b/, "the literal `:0` must never be probed");
  });
});

GATE("AC-291 criterion: an absent `--port` is also resolved from the carrier", async () => {
  await withContext(async (ctx) => {
    const port = await startPage(ctx);
    const pid = await fakeServe(ctx, ["--host", "127.0.0.1"]);
    writeCarrier(ctx, { pid, host: "127.0.0.1", port });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 0, `criterion should pass, got ${r.code}; stderr=${r.stderr}`);
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${port} argv=\\S+ cause=fetch-answered`), r.stderr);
  });
});

GATE("AC-291 criterion: a `0.0.0.0` bind host from the carrier is normalized to 127.0.0.1", async () => {
  await withContext(async (ctx) => {
    const port = await startPage(ctx);
    const pid = await fakeServe(ctx, ["--host", "0.0.0.0", "--port", "0"]);
    writeCarrier(ctx, { pid, host: "0.0.0.0", port });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 0, `criterion should pass, got ${r.code}; stderr=${r.stderr}`);
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${port}`), r.stderr);
  });
});

GATE("AC-291 criterion: NOT a literal — a restart binding a different port resolves to that new port", async () => {
  await withContext(async (ctx) => {
    const first = await startPage(ctx);
    const pid = await fakeServe(ctx, ["--host", "127.0.0.1", "--port", "0"]);
    writeCarrier(ctx, { pid, host: "127.0.0.1", port: first });
    const a = await runCriterion(ctx);
    const second = await startPage(ctx);
    writeCarrier(ctx, { pid, host: "127.0.0.1", port: second });
    const b = await runCriterion(ctx);
    assert.notEqual(first, second, "the two HTTP faces must be on different ports for this to be a control");
    assert.equal(a.code, 0, `run A failed: ${a.stderr}`);
    assert.equal(b.code, 0, `run B failed: ${b.stderr}`);
    assert.match(a.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${first}`), a.stderr);
    assert.match(b.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${second}`), b.stderr);
  });
});

GATE("AC-291 criterion: no serve instance ⇒ `CAUSE=no-running-serve-instance`, fails closed", async () => {
  await withContext(async (ctx) => {
    // ⛔ No fake serve process: the only pgrep hit is the RUNNER itself (see the header), which is a
    // candidate but not a serve — so the criterion must reach its no-instance refusal, not the
    // underivable-address one. That distinction is what makes this a control rather than a variant
    // of the next case.
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1, `expected a non-zero verdict, got ${r.code}`);
    assert.match(r.stderr, /CAUSE=no-running-serve-instance/, r.stderr);
    assert.match(r.stderr, /nserve=0/, r.stderr);
    assert.match(r.stderr, /ncand=[1-9]/, `the runner itself is a candidate: ${r.stderr}`);
    for (const row of candidateRows(r)) {
      assert.match(row, /argv=\S+/, "row has no derivation source: " + row);
      assert.match(row, /cause=\S+/, "row has no cause: " + row);
    }
    assert.doesNotMatch(r.stderr, /CAUSE=en-fetch-failed/, "no instance is NOT a fetch failure");
  });
});

GATE("AC-291 criterion: a candidate with no derivable address ⇒ `CAUSE=no-derivable-serve-address`, named cause", async () => {
  await withContext(async (ctx) => {
    await fakeServe(ctx, ["--host", "127.0.0.1", "--port", "0"]);
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1, `expected a non-zero verdict, got ${r.code}`);
    assert.match(r.stderr, /cause=carrier-unreadable/, r.stderr);
    assert.match(r.stderr, /CAUSE=no-derivable-serve-address/, r.stderr);
    assert.match(r.stderr, /nserve=1/, `the fixture IS a serve, so this is the underivable case: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /CAUSE=no-running-serve-instance/, "a serve IS running; this is not the no-instance mode");
    assert.doesNotMatch(r.stderr, /CAUSE=en-fetch-failed/, "an underivable address is NOT a fetch failure");
    for (const row of candidateRows(r)) {
      assert.match(row, /cause=\S+/, "every candidate row must carry a cause: " + row);
    }
  });
});

GATE("AC-291 criterion: carrier without a `web` service ⇒ carrier-no-web-entry (control is never used)", async () => {
  await withContext(async (ctx) => {
    const pid = await fakeServe(ctx, ["--host", "127.0.0.1", "--port", "0"]);
    writeCarrier(ctx, { pid, host: "127.0.0.1", port: 1, dropWeb: true });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cause=carrier-no-web-entry/, r.stderr);
  });
});

GATE("AC-291 criterion: carrier naming a DIFFERENT pid is refused (a stale carrier must not be trusted)", async () => {
  await withContext(async (ctx) => {
    const pid = await fakeServe(ctx, ["--host", "127.0.0.1", "--port", "0"]);
    writeCarrier(ctx, { pid: pid + 100000, host: "127.0.0.1", port: 1 });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cause=carrier-pid-mismatch/, r.stderr);
  });
});

GATE("AC-291 criterion: a `web` entry marked down ⇒ carrier-web-marked-down", async () => {
  await withContext(async (ctx) => {
    const pid = await fakeServe(ctx, ["--host", "127.0.0.1", "--port", "0"]);
    writeCarrier(ctx, { pid, host: "127.0.0.1", port: 1, up: false });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cause=carrier-web-marked-down/, r.stderr);
  });
});

GATE("AC-291 criterion: a carrier port nobody listens on ⇒ connection-refused is NAMED, not left as 'no message'", async () => {
  await withContext(async (ctx) => {
    const port = await deadPort();
    const pid = await fakeServe(ctx, ["--host", "127.0.0.1", "--port", "0"]);
    writeCarrier(ctx, { pid, host: "127.0.0.1", port });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /CAUSE=no-reachable-serve-address/, r.stderr);
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${port} argv=\\S+ cause=fetch-failed\\(connection-refused\\)`), r.stderr);
  });
});

GATE("AC-291 criterion: candidates accumulate — every candidate gets a pid + address + cause, and none wipes a derived one", async () => {
  await withContext(async (ctx) => {
    const port = await startPage(ctx);
    const pid = await fakeServe(ctx, ["--host", "127.0.0.1", "--port", String(port)]);
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

GATE("AC-291 criterion: the ASSERTION block is still live — a zh page whose nav was never wired fails, and says which arm", async () => {
  await withContext(async (ctx) => {
    const port = await startPage(ctx, ZH_PAGE_NAV_NOT_WIRED);
    const pid = await fakeServe(ctx, ["--host", "127.0.0.1", "--port", "0"]);
    writeCarrier(ctx, { pid, host: "127.0.0.1", port });
    const r = await runCriterion(ctx);
    assert.equal(r.code, 1, "the amended derivation must not have softened the assertion it feeds");
    assert.match(r.stderr, /CAUSE=nav-label-untranslated/, r.stderr);
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${port}`), "the address was derived — the failure is the assertion, not the probe");
  });
});
