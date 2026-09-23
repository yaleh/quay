// @test-group product
//
// ac296-criterion-address-derivation.test.mjs — the fixture for the RE-ANCHORED address-derivation
// step of `goals/AC-296-*.md`'s criterion (gap-ac296-criterion-cmdline-port-literal-stale).
//
// WHAT THIS FILE IS FOR. The AC-296 criterion probes a RUNNING `quay.ts serve` and asserts, over
// HTTP, that the /journal page's own chrome (its <nav> current-item label and its own <title>)
// changes under `Cookie: lang=zh`. Its address used to be parsed as the literal `--host H --port N`
// of the process cmdline — and `ce0f47518` (`gap-serve-same-root-admission-lock`) moved the web
// port's DEFAULT to kernel-assigned (`--port 0`), so on the launcher default that step derived
// `<host>:0`, a structurally-unfetchable address, and the criterion could not be true on any
// deployment that used the default. Measured on the live instance before the re-anchor:
// `CAUSE=en-fetch-failed -- GET http://127.0.0.1:0/journal returned nothing (addr=127.0.0.1:0)`,
// while the SAME criterion text with only `addr` swapped for the carrier's real web port returned
// `OK … exit 0`. The derivation step was re-anchored to two sources (the block is shared verbatim
// with the rest of the AC-179 probe family — AC-288/AC-299 landed it first):
//   ① the process's OWN argv, read POSITIONALLY (`serve … --host H --port N`, N >= 1);
//   ② otherwise this root's `.quay/server.json` carrier — the only place a kernel-assigned port is
//      knowable — accepted only when its pid IS this candidate, that pid is alive, and its `web`
//      service is up.
//
// THE UNIT UNDER TEST IS THE SHIPPED BLOCK, NOT A COPY OF IT. `addr-derivation` is extracted
// VERBATIM from the goal file's criterion — the same text `quay goal gate AC-296` runs — and
// executed under `sh` against fixture processes and fixture carriers. A reimplementation here would
// be an echo of the criterion rather than a measurement of it (hard rule 4): it would stay green
// while the criterion rotted, which is exactly the failure this task exists to repair.
//
// THE BLOCK IS ALSO ROUTE-AGNOSTIC. `ROUTE` / `LABEL_EN` are declared by the criterion OUTSIDE the
// markers, so the same block is reused verbatim by the whole AC-179-probe family (one criterion per
// page, one derivation). One case below pins that split, so a future edit cannot quietly pull the
// route into the block and strand the other pages.
//
// FIXTURES ARE REAL PROCESSES WITH REAL ARGV. A candidate is only a candidate because
// `pgrep -f 'quay.ts serve'` found it AND `/proc/<pid>/cwd` equals the fixture root, so each case
// spawns a real child whose own argv positionally reads `… quay.ts serve --host H --port N` with
// cwd = a fresh `git init`-ed temp root (a mkdtemp'd bare directory is not a root —
// `git rev-parse --show-toplevel` would resolve to the enclosing repo).
//
// BOTH DIRECTIONS ARE COVERED. A derivation that only ever reports success is not a measurement:
// the explicit-port and carrier positive controls are paired with no-carrier, carrier-pid-mismatch,
// no-`web`-entry, `web.up:false`, dead-carrier-pid and dead-port negatives, and every case also
// asserts the ATTRIBUTION contract (each candidate appears with `pid`, a derived address or `addr=-`,
// and a cause — hard rule 3/3b: "could not evaluate" must not wear the same shape as "evaluated").

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root of THIS checkout (a task worktree during dispatch). */
const REPO = path.resolve(HERE, "..", "..", "..");

const MARK_START = ">>> addr-derivation";
const MARK_END = "<<< addr-derivation";

/** The one goal file this fixture is pinned to. Resolved by id prefix, so a rename that keeps the
 *  id still resolves; a missing file fails loudly rather than skipping. */
function goalFilePath() {
  const dir = path.join(REPO, "goals");
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-296-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-296-*.md under ${dir}`);
  return path.join(dir, name);
}

/** The criterion text AS STORED (frontmatter folded scalar parsed back to a string). */
function criterionText() {
  const raw = fs.readFileSync(goalFilePath(), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  assert.ok(fm, "goal file has no YAML frontmatter");
  const doc = YAML.parse(fm[1]);
  assert.equal(typeof doc.criterion, "string", "goal record has no criterion string");
  return doc.criterion;
}

/** The shipped derivation block, delimited by its own markers inside the criterion. */
function derivationBlock() {
  const lines = criterionText().split("\n");
  const start = lines.findIndex((l) => l.includes(MARK_START));
  const end = lines.findIndex((l) => l.includes(MARK_END));
  assert.ok(start >= 0, `criterion is missing the ${MARK_START} marker`);
  assert.ok(end > start, `criterion is missing a ${MARK_END} marker after ${MARK_START}`);
  const block = lines.slice(start + 1, end).join("\n");
  // The block must actually be the derivation (a marker left over an emptied block would otherwise
  // make every case below vacuously "pass" on an empty script).
  for (const needle of ["argv_addr()", "carrier_addr()", "pgrep -f 'quay.ts serve'", "server.json"]) {
    assert.ok(block.includes(needle), `extracted block does not contain ${needle}`);
  }
  // The whole point of the re-anchor: the literal `--port N` cmdline parse must be GONE from the
  // shipped derivation. Asserted as a whole-criterion property too, below the split case.
  assert.doesNotMatch(block, /--port \[0-9\]\+/, "the block must not parse the --port literal");
  return block;
}

/** A fresh temp root that IS a git root (`git rev-parse --show-toplevel` == itself). */
function mkRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac296-derive-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

/** The carrier this root's OWN server would publish (`.quay/server.json`, schemaVersion 1). */
function writeCarrier(root, state) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "server.json"),
    JSON.stringify({ schemaVersion: 1, startedAt: new Date().toISOString(), ...state }, null, 2),
  );
}

/**
 * A real child process whose OWN argv positionally reads `… quay.ts serve --host <host> --port <n>`,
 * with cwd = `root` — the exact shape both `pgrep -f 'quay.ts serve'` and the derivation step are
 * defined over. It never listens; whether the address answers is the HTTP half's business, not the
 * derivation's.
 */
function spawnServeShaped(root, { host = "127.0.0.1", port }) {
  return spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 300000)", "quay.ts", "serve", "--host", host, "--port", String(port)],
    { cwd: root, stdio: "ignore" },
  );
}

/**
 * SIGKILL and WAIT FOR THE REAP. An un-reaped child stays in the process table as a zombie, and
 * `kill(pid, 0)` — the liveness probe both this fixture and the product's `pidAlive` use — reports a
 * zombie as ALIVE. Waiting for the `exit` event lets node reap it, so "dead" means dead here.
 */
function killAndReap(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    try {
      child.kill("SIGKILL");
    } catch {
      resolve();
    }
  });
}

/** Run `script` in `root` under /bin/sh (the same shell the acceptance runner uses). */
function runSh(script, root) {
  const r = spawnSync("/bin/sh", ["-c", script], { cwd: root, encoding: "utf8", timeout: 30000 });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Run the shipped block and report what it derived, or why it refused. */
function derive(root) {
  const script = `${derivationBlock()}\necho "DERIVED_ADDR=$addr"\necho "DERIVED_SRC=$src"\necho "REPORT=$rep"\nexit 0\n`;
  return runSh(script, root);
}

/** The candidate row the block emits for one pid, or undefined when that pid is absent. */
function candidateRow(stderr, pid) {
  return stderr
    .split("\n")
    .flatMap((l) => l.replace(/^CANDIDATES:/, "").split(" | "))
    .map((s) => s.trim())
    .find((s) => s.startsWith(`pid=${pid} `));
}

function killQuietly(child) {
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

// ── the split that keeps the family shared: the block carries no route, the criterion does ───────

test("the block is route-agnostic: ROUTE/LABEL_EN live OUTSIDE the markers", () => {
  const block = derivationBlock();
  assert.doesNotMatch(block, /^\s*ROUTE=/m, "the shared derivation block must not hard-code a route");
  assert.doesNotMatch(block, /^\s*LABEL_EN=/m, "the shared derivation block must not hard-code a nav label");
  const c = criterionText().split("\n");
  assert.ok(c.some((l) => l === 'ROUTE="/journal"'), 'criterion must declare ROUTE="/journal" outside the block');
  assert.ok(c.some((l) => l === 'LABEL_EN="Journal"'), 'criterion must declare LABEL_EN="Journal" outside the block');
});

test("the criterion no longer derives its address from the `--port` literal", () => {
  const text = criterionText();
  assert.doesNotMatch(text, /--port \[0-9\]\+/, "the literal cmdline port parse must be gone from the shipped criterion");
  // …and the chrome-scope assertions the task forbids relaxing are still scoped: the nav label is
  // matched only against the `<nav>…</nav>` region and the title only against `<title>`.
  assert.ok(text.includes("grep -o '<nav.*</nav>'"), "nav assertions must stay scoped to <nav>…</nav>");
  assert.ok(text.includes("grep -oE '<title>[^<]*</title>'"), "title assertions must stay scoped to <title>");
  assert.ok(text.includes('case "$nav_zh" in *"$LABEL_EN"*'), "the zh nav check must compare the nav region only");
});

// ── ① explicit `--port N` (N >= 1) on the process's own argv ────────────────────────────────────

test("explicit --port N >= 1 on the process argv derives host:port (no carrier needed)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "127.0.0.1", port: 46011 });
  try {
    const r = derive(root);
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:46011\b/);
    assert.match(r.stdout, /DERIVED_SRC=argv\b/);
    assert.match(r.stdout, new RegExp(`pid=${child.pid} addr=127\\.0\\.0\\.1:46011 cause=derived-from-argv`));
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("wildcard bind host is normalised to loopback (0.0.0.0 -> 127.0.0.1)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "0.0.0.0", port: 46012 });
  try {
    const r = derive(root);
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:46012\b/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── ② kernel-assigned port (`--port 0` / no --port): the carrier is the only place it is knowable ─

test("--port 0 derives the carrier's web port for THIS pid (the launcher default deployment)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    writeCarrier(root, {
      pid: child.pid,
      services: [
        { name: "web", pid: child.pid, host: "172.28.0.1", port: 34567, up: true },
        { name: "control", pid: child.pid, host: "127.0.0.1", port: 34568, up: true },
      ],
    });
    const r = derive(root);
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=172\.28\.0\.1:34567\b/);
    assert.match(r.stdout, /DERIVED_SRC=carrier\b/);
    // The control-plane port must NOT be picked: two services share a pid, and only `web` answers
    // `/journal` — taking `control` would dial a JSON-RPC listener.
    assert.doesNotMatch(r.stdout, /DERIVED_ADDR=[^\n]*34568/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the derived port FOLLOWS the carrier across a restart (kernel re-assignment, AC4)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    // Restart is modelled the way the live deployment exposes it: same pid, another kernel-assigned
    // port published into the carrier. A criterion that had pinned a port literal would report the
    // old one here — that is precisely the defect this task repairs.
    writeCarrier(root, {
      pid: child.pid,
      services: [{ name: "web", pid: child.pid, host: "172.28.0.1", port: 34574, up: true }],
    });
    const before = derive(root);
    assert.equal(before.code, 0, `derivation must succeed: ${before.stderr}`);
    assert.match(before.stdout, /DERIVED_ADDR=172\.28\.0\.1:34574\b/);

    writeCarrier(root, {
      pid: child.pid,
      services: [{ name: "web", pid: child.pid, host: "172.28.0.1", port: 34579, up: true }],
    });
    const after = derive(root);
    assert.equal(after.code, 0, `derivation must succeed: ${after.stderr}`);
    assert.match(after.stdout, /DERIVED_ADDR=172\.28\.0\.1:34579\b/);
    // No file on disk carries either port — both are read from the live carrier at run time.
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a wildcard web host in the carrier is normalised to loopback too", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "0.0.0.0", port: 0 });
  try {
    writeCarrier(root, {
      pid: child.pid,
      services: [{ name: "web", pid: child.pid, host: "0.0.0.0", port: 34569, up: true }],
    });
    const r = derive(root);
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:34569\b/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negatives: refusal must be distinguishable, attributed, and never a bare `addr=` ─────────────

test("no carrier: refuses with no-derivable-address and names carrier-absent for the candidate", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    const r = derive(root);
    assert.equal(r.code, 1, "a root whose only serve candidate has no carrier must not derive an address");
    assert.match(r.stderr, /CAUSE=no-derivable-address/);
    const row = candidateRow(r.stderr, child.pid);
    assert.ok(row, `candidate ${child.pid} must be attributed: ${r.stderr}`);
    assert.match(row, /addr=-/);
    assert.match(row, /cause=argv-port-kernel-assigned,carrier-absent/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("carrier naming another pid is refused (pid is the positional link, not the port alone)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    writeCarrier(root, {
      pid: child.pid + 1000000,
      services: [{ name: "web", pid: child.pid + 1000000, host: "172.28.0.1", port: 34570, up: true }],
    });
    const r = derive(root);
    assert.equal(r.code, 1);
    const row = candidateRow(r.stderr, child.pid);
    assert.ok(row, `candidate ${child.pid} must be attributed: ${r.stderr}`);
    assert.match(row, /cause=argv-port-kernel-assigned,carrier-pid-mismatch/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("carrier with no `web` entry is refused (a control-only carrier names no web address)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    writeCarrier(root, {
      pid: child.pid,
      services: [{ name: "control", pid: child.pid, host: "127.0.0.1", port: 34571, up: true }],
    });
    const r = derive(root);
    assert.equal(r.code, 1);
    assert.match(candidateRow(r.stderr, child.pid) ?? "", /cause=argv-port-kernel-assigned,carrier-no-web-service/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("carrier whose web service is down (up:false) is refused", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    writeCarrier(root, {
      pid: child.pid,
      services: [{ name: "web", pid: child.pid, host: "172.28.0.1", port: 34572, up: false }],
    });
    const r = derive(root);
    assert.equal(r.code, 1);
    assert.match(candidateRow(r.stderr, child.pid) ?? "", /cause=argv-port-kernel-assigned,carrier-web-down/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a carrier naming a DEAD pid is refused by the liveness check (pidAlive half)", async () => {
  const root = mkRoot();
  // A pid that was alive and is not any more — the carrier keeps naming it, which is exactly how a
  // killed server masquerades as a running one.
  const dead = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  const deadPid = dead.pid;
  await killAndReap(dead);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(deadPid, 0);
    } catch {
      break;
    }
  }
  // A live candidate with an EXPLICIT port: it keeps the block's own selection from reaching its
  // refuse-and-exit branch, so the appended direct call below is actually reached (the block, run to
  // the end, is what the gate runs — a shorter extraction here would test a different text).
  const live = spawnServeShaped(root, { host: "127.0.0.1", port: 46014 });
  try {
    writeCarrier(root, {
      pid: deadPid,
      services: [{ name: "web", pid: deadPid, host: "172.28.0.1", port: 34573, up: true }],
    });
    // Called directly on the dead pid: the deriver must refuse on liveness, before trusting any
    // port the carrier names for it (the carrier is a claim, not a reading — hard rule 4b).
    const r = runSh(`${derivationBlock()}\ncarrier_addr ${deadPid}\n`, root);
    assert.equal(r.stdout.trim().split("\n").pop(), "candidate-pid-dead");
  } finally {
    killQuietly(live);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── the runner's own shell is a candidate and must be attributed, never silently dropped ─────────

test("a candidate with no positional `serve` argv (the runner's own sh) is reported with a cause", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "127.0.0.1", port: 46013 });
  try {
    const r = derive(root);
    const self = r.stdout.match(/REPORT=([^\n]*)/)?.[1] ?? "";
    // The block's own text contains `quay.ts serve`, so the `sh -c` running it matches pgrep and
    // its cwd IS this root. It must appear with a cause — not vanish, and not clear the address.
    assert.match(self, /pid=\d+ addr=- cause=argv-no-serve/);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:46013\b/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── ③ the fetch half of the criterion, on a derived address that is genuinely dead ───────────────

test("full criterion: a derived address with nothing listening fails as en-fetch-failed, attributed", async () => {
  const root = mkRoot();
  // A port the kernel just handed out and we released: nothing is listening on it.
  const deadPort = await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
  const child = spawnServeShaped(root, { host: "127.0.0.1", port: deadPort });
  try {
    const r = runSh(criterionText(), root);
    assert.equal(r.code, 1, "the criterion must not pass on an address nobody answers");
    // "取不到" — the fetch half of AC2(b): the address derived fine, nothing is there to answer it.
    assert.match(r.stderr, /CAUSE=en-fetch-failed\b/);
    assert.match(r.stderr, new RegExp(`GET http://127\\.0\\.0\\.1:${deadPort}/journal returned nothing`));
    // The derived address is still the one that was dialled — the failure is attributed to it, not
    // to a `:0` left over from the old literal parse (compare the pre-re-anchor reading on the live
    // instance: `CAUSE=en-fetch-failed … (addr=127.0.0.1:0)`).
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${deadPort}`));
    assert.doesNotMatch(r.stderr, /addr=[^ ]*:0\b/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("full criterion: a root with no live web instance refuses with a named, distinct cause", () => {
  const root = mkRoot();
  try {
    const r = runSh(criterionText(), root);
    assert.equal(r.code, 1, "an empty root must not pass");
    // AC2(a). Note WHAT the candidate set is here: the criterion's own `sh -c` matches
    // `pgrep -f 'quay.ts serve'` (its script text contains the pattern) and its cwd IS this root, so
    // the block always has at least that one candidate and lands on `no-derivable-address`, with the
    // refusal ATTRIBUTED to it (`argv-no-serve`). `no-running-serve-instance` is the narrower case
    // where pgrep matches nothing at all. Both are named causes; the assertion is that this run does
    // not silently exist 0 and does not wear the fetch half's cause.
    assert.match(r.stderr, /CAUSE=no-derivable-address\b/);
    assert.match(r.stderr, /CANDIDATES:.*cause=argv-no-serve/);
    assert.doesNotMatch(r.stderr, /CAUSE=en-fetch-failed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
