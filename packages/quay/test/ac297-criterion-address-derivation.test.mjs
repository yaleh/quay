// @test-group product
//
// ac297-criterion-address-derivation.test.mjs — the fixture for the RE-ANCHORED address-derivation
// step of `goals/AC-297-*.md`'s criterion (gap-ac297-criterion-cmdline-port-literal-stale).
//
// WHAT THIS FILE IS FOR. The AC-297 criterion probes a RUNNING `quay.ts serve` and asserts that
// /git-history switches locale over HTTP. Its address used to be parsed as the literal
// `--host H --port N` of the process cmdline — and `ce0f47518` (`gap-serve-same-root-admission-lock`)
// moved the web port's DEFAULT to kernel-assigned (`--port 0`), so on the launcher default that step
// derived `<host>:0`, a structurally-unfetchable address, and the criterion could not be true on any
// deployment that used the default. The criterion's derivation step was re-anchored to two sources:
//   ① the process's OWN argv, read POSITIONALLY (`serve … --host H --port N`, N >= 1);
//   ② otherwise this root's `.quay/server.json` carrier — the only place a kernel-assigned port is
//      knowable — accepted only when its pid IS this candidate, that pid is alive, and its `web`
//      service is up.
// The block is the SAME text AC-288 ships (one block, not a second variant); only the fetch/chrome
// half after it is AC-297's own, and that half is byte-identical to the pre-amendment criterion.
//
// THE UNIT UNDER TEST IS THE SHIPPED BLOCK, NOT A COPY OF IT. `addr-derivation` is extracted
// VERBATIM from the goal file's criterion — the same text `quay goal gate AC-297` runs — and
// executed under `sh` against fixture processes and fixture carriers. A reimplementation here would
// be an echo of the criterion rather than a measurement of it (hard rule 4): it would stay green
// while the criterion rotted, which is exactly the failure this task exists to repair.
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
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-297-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-297-*.md under ${dir}`);
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
  return block;
}

/** A fresh temp root that IS a git root (`git rev-parse --show-toplevel` == itself). */
function mkRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac297-derive-"));
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

// ── ② kernel-assigned port (`--port 0`): the carrier is the only place it is knowable ────────────

test("--port 0 derives the carrier's web port for THIS pid (the launcher default deployment)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "0.0.0.0", port: 0 });
  try {
    writeCarrier(root, {
      pid: child.pid,
      services: [
        { name: "web", pid: child.pid, host: "0.0.0.0", port: 34567, up: true },
        { name: "control", pid: child.pid, host: "127.0.0.1", port: 34568, up: true },
      ],
    });
    const r = derive(root);
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:34567\b/);
    assert.match(r.stdout, /DERIVED_SRC=carrier\b/);
    // The control-plane port must NOT be picked: two services share a pid, and only `web` answers
    // `/git-history` — taking `control` would dial a JSON-RPC listener.
    assert.doesNotMatch(r.stdout, /DERIVED_ADDR=[^\n]*34568/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a non-wildcard carrier host is used verbatim (no normalisation needed)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    writeCarrier(root, {
      pid: child.pid,
      services: [{ name: "web", pid: child.pid, host: "172.28.0.1", port: 34569, up: true }],
    });
    const r = derive(root);
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=172\.28\.0\.1:34569\b/);
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

// ── the AC-297 half after the block: route pinning + chrome scope (AC1's "逐字不变" claim) ────────

test("the criterion after the block still pins /git-history and asserts ONLY on chrome scopes", () => {
  const lines = criterionText().split("\n");
  const end = lines.findIndex((l) => l.includes(MARK_END));
  assert.ok(end > 0, `criterion is missing the ${MARK_END} marker`);
  const half = lines.slice(end).join("\n");
  // The route and its English baseline label are the ones this AC is about (GOAL-024's
  // /git-history page) — not inherited from a sibling AC's copy of the same block.
  assert.match(half, /^ROUTE="\/git-history"$/m);
  assert.match(half, /^LABEL_EN="Git History"$/m);
  // Chrome scope: the nav label is asserted against the extracted <nav>...</nav> region and the
  // title against <title>. A whole-body substring match is what makes this class of criterion
  // unsatisfiable (origin: /board's CSS comment, /dashboard's rendered task titles) — so the
  // English label must never be cased against the raw response bodies.
  assert.match(half, /case "\$nav_en" in \*"\$LABEL_EN"\*\)/);
  assert.match(half, /case "\$nav_zh" in \*"\$LABEL_EN"\*\)/);
  assert.doesNotMatch(half, /case "\$en" in/, "the English label must not be matched against the whole body");
  assert.doesNotMatch(half, /case "\$zh" in \*"\$LABEL_EN"/, "the English label must not be matched against the whole body");
  assert.match(half, /grep -o '<nav\.\*<\/nav>'/);
  assert.match(half, /grep -oE '<title>\[\^<\]\*<\/title>'/);
});

// ── the fetch half of the criterion, on a derived address that is genuinely dead ─────────────────

test("full criterion: a derived address with nothing listening fails as en-fetch-failed (not a derivation refusal)", async () => {
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
    // The cause is the FETCH half's, not the derivation's: the address DERIVED fine, the connection
    // did not answer. That is a different shape from the no-derivable-address refusal above — the
    // two negative directions must not be carrier-identical (hard rule 3b). This is the assertion
    // the AC-297 amendment rests on: re-anchoring the derivation must not have turned a genuinely
    // unreachable server into a "could not derive" refusal (which would make the two directions
    // indistinguishable) nor into a pass.
    assert.match(r.stderr, /CAUSE=en-fetch-failed\b/);
    assert.doesNotMatch(r.stderr, /CAUSE=no-derivable-address/);
    // The failure names the address it actually dialled, so the reading is attributable to the
    // deployment it was taken on.
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${deadPort}\\b`));
    // …and that address is the one the candidate itself derived from its own argv. (The fetch half
    // is inherited unchanged from the pre-amendment criterion, so unlike AC-288's it does NOT print
    // the per-candidate `CANDIDATES:` report — that report belongs to the derivation block's own
    // refusal path, which the negatives above assert. Asserting AC-288's fetch-time attribution here
    // would be asserting a different AC's contract.)
    const derived = runSh(`${derivationBlock()}\necho "DERIVED_ADDR=$addr"\necho "DERIVED_SRC=$src"\n`, root);
    assert.equal(derived.code, 0, `the dead-port candidate must still DERIVE: ${derived.stderr}`);
    assert.match(derived.stdout, new RegExp(`DERIVED_ADDR=127\\.0\\.0\\.1:${deadPort}\\b`));
    assert.match(derived.stdout, /DERIVED_SRC=argv\b/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
