// @test-group product
//
// ac298-criterion-address-derivation.test.mjs — the fixture for the RE-ANCHORED address-derivation
// step of `goals/AC-298-*.md`'s criterion (gap-ac298-criterion-cmdline-port-literal-stale).
//
// WHAT THIS FILE IS FOR. The AC-298 criterion probes a RUNNING `quay.ts serve` (cwd = repo root) and
// asserts, over HTTP, that /tests's chrome switches under `Cookie: lang=zh`: the `<nav>` current-item
// label is the literal `Tests` in the default locale and gone under the zh cookie, and this page's
// OWN `<title>` moves relative to its default-locale title. Its address used to be parsed as the
// literal `--host H --port N` of the process cmdline — and `ce0f47518`
// (`gap-serve-same-root-admission-lock`) moved the web port's DEFAULT to kernel-assigned
// (`--port 0`), so on the launcher default that step derived `<host>:0`, a structurally-unfetchable
// address, and the criterion could not be true on any deployment that used the default. The ledger
// shows the CARRIER moved, not the criterion's subject: the SAME criterionHash c643b2c54407eb69 is
// green at 2026-09-23T05:21:02.047Z and red at 2026-09-23T08:42:34.402Z — gen-1 had been started
// before ce0f47518 with an explicit port and outlived the change; gen-2 took the new default. The
// derivation step was re-anchored to two sources:
//   ① the process's OWN argv, read POSITIONALLY (`serve … --host H --port N`, N >= 1);
//   ② otherwise this root's `.quay/server.json` carrier — the only place a kernel-assigned port is
//      knowable — accepted only when its `pid` IS this candidate, that pid is alive, and its `web`
//      service is up.
// The re-anchor is the family's landed block (the same text AC-288/AC-299/AC-303 carry, byte for
// byte), placed in this criterion by `quay goal write AC-298 --criterion …`.
//
// THE UNIT UNDER TEST IS THE SHIPPED BLOCK, NOT A COPY OF IT. `addr-derivation` is extracted
// VERBATIM from the goal file's criterion — the same text `quay goal gate AC-298` runs — and
// executed under /bin/sh against fixture processes and fixture carriers. A reimplementation here
// would be an echo of the criterion rather than a measurement of it (hard rule 4): it would stay
// green while the criterion rotted, which is exactly the failure this task exists to repair.
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
// no-`web`-entry, `web.up:false`, dead-carrier-pid, unusable-argv and no-serve-process negatives,
// and every case also asserts the ATTRIBUTION contract (each candidate appears with `pid`, a derived
// address or `addr=-`, and a cause — hard rule 3/3b: "could not evaluate" must not wear the same
// shape as "evaluated"). The two negative controls the task names are here as their own cases: ① no
// serve instance at all, and ② a well-formed address nothing answers — and they refuse with
// DIFFERENT tokens (`no-running-serve-instance` vs `en-fetch-failed`), so the two readings stay
// distinguishable.

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
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-298-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-298-*.md under ${dir}`);
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
  // The block must actually BE the derivation — a marker left over an emptied block would otherwise
  // make every case below vacuously "pass" on an empty script.
  for (const needle of ["argv_addr()", "carrier_addr()", "pgrep -f 'quay.ts serve'", "server.json"]) {
    assert.ok(block.includes(needle), `extracted block does not contain ${needle}`);
  }
  return block;
}

/** A fresh temp root that IS a git root (`git rev-parse --show-toplevel` == itself). */
function mkRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac298-derive-"));
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
function spawnServeShaped(root, { host = "127.0.0.1", port, extraArgs = [] }) {
  return spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 300000)", "quay.ts", "serve", "--host", host, "--port", String(port), ...extraArgs],
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

/** Run `script` in `root` under /bin/sh. This is the shape `runAcceptance` uses (`sh -c <criterion>`),
 *  so — deliberately — the running shell carries the criterion text in its argv and IS itself a
 *  pgrep candidate. Cases that need the "no candidate at all" branch use `runShFile` instead. */
function runSh(script, root) {
  const r = spawnSync("/bin/sh", ["-c", script], { cwd: root, encoding: "utf8", timeout: 30000 });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", pid: r.pid };
}

/**
 * The same, but the script is handed to the shell as a FILE, so the shell's argv is
 * `/bin/sh <file>` and contains no `quay.ts serve` phrase. This is the only way to reach a genuinely
 * EMPTY candidate set — under `sh -c` the runner is always a candidate (see `runSh`).
 */
function runShFile(script, root) {
  const p = path.join(os.tmpdir(), `ac298-crit-${process.pid}-${Math.random().toString(36).slice(2)}.sh`);
  fs.writeFileSync(p, script);
  try {
    const r = spawnSync("/bin/sh", [p], { cwd: root, encoding: "utf8", timeout: 30000 });
    return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", pid: r.pid };
  } finally {
    fs.rmSync(p, { force: true });
  }
}

/** Run the shipped block and report what it derived, or why it refused. */
function derive(root) {
  const script = `${derivationBlock()}\necho "DERIVED_ADDR=$addr"\necho "DERIVED_SRC=$src"\necho "REPORT=$rep"\nexit 0\n`;
  return runSh(script, root);
}

/** The candidate row the block emits for one pid, or undefined when that pid is absent. */
function candidateRow(text, pid) {
  return text
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

/** A port the kernel just handed out and we released: nothing is listening on it. */
function deadPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// ── the split that keeps the family shared: the block carries no route, the criterion does ───────

test("the block is route-agnostic: ROUTE/LABEL_EN live OUTSIDE the markers", () => {
  const block = derivationBlock();
  assert.doesNotMatch(block, /^\s*ROUTE=/m, "the shared derivation block must not hard-code a route");
  assert.doesNotMatch(block, /^\s*LABEL_EN=/m, "the shared derivation block must not hard-code a nav label");
  const c = criterionText().split("\n");
  assert.ok(c.some((l) => l === 'ROUTE="/tests"'), 'criterion must declare ROUTE="/tests" outside the block');
  assert.ok(c.some((l) => l === 'LABEL_EN="Tests"'), 'criterion must declare LABEL_EN="Tests" outside the block');
});

// ── the amendment re-anchored ONE step: the chrome scope and the refusal tokens survived ─────────

test("the re-anchor kept the chrome scope and the fetch half byte-identical", () => {
  const text = criterionText();
  // The scoping the whole family asserts on: the nav label is matched ONLY inside the `<nav>…</nav>`
  // region, and the page title ONLY against the page's own `<title>`. ⛔ Matched as EXACT lines —
  // a substring check would pass on a comment that merely mentions them.
  assert.ok(text.includes(`grep -o '<nav.*</nav>'`), "the nav-region scoping was reworded");
  assert.ok(text.includes(`grep -oE '<title>[^<]*</title>'`), "the <title> scoping was reworded");
  // The verdict still rides on an external HTTP GET at the DERIVED address, not on the derivation.
  assert.ok(text.includes(`curl -sf --max-time 10 "http://$addr$ROUTE"`), "the en fetch changed");
  assert.ok(text.includes(`'Cookie: lang=zh'`), "the zh fetch changed");
  // The comparison that makes the page's own chrome — not just the shared nav — the subject.
  assert.ok(text.includes('if [ "$t_zh" = "$t_en" ]'), "the own-title comparison changed");
});

test("the eleven pre-amendment refusal tokens are all present", () => {
  const text = criterionText();
  const tokens = [
    "no-running-serve-instance",
    "en-fetch-failed",
    "zh-fetch-failed",
    "no-nav-region --",
    "no-nav-region-zh",
    "english-baseline-missing",
    "no-title-tag --",
    "html-lang-not-zh",
    "nav-label-untranslated",
    "no-title-tag-zh",
    "title-unchanged",
  ];
  for (const t of tokens) {
    assert.ok(text.includes(t), `the re-anchor dropped the pre-existing refusal branch ${t}`);
  }
  // Hard rule 2, second half: the predicate above must be able to FIRE. A token that is not in the
  // criterion must be reported absent by the same test — otherwise "all present" proves nothing.
  assert.equal(tokens.filter((t) => text.includes(t)).length, 11);
  assert.ok(!text.includes("no-such-refusal-token"), "the presence predicate cannot fire");
});

// ── ① explicit `--port N` (N >= 1) on the process's own argv ────────────────────────────────────

test("explicit --port N >= 1 on the process argv derives host:port (no carrier needed)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "127.0.0.1", port: 46121 });
  try {
    const r = derive(root);
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:46121\b/);
    assert.match(r.stdout, /DERIVED_SRC=argv\b/);
    assert.match(r.stdout, new RegExp(`pid=${child.pid} addr=127\\.0\\.0\\.1:46121 cause=derived-from-argv`));
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the `--host=H --port=N` equals-form is read too (not only the space-separated form)", () => {
  const root = mkRoot();
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 300000)", "quay.ts", "serve", "--host=127.0.0.1", "--port=46122"],
    { cwd: root, stdio: "ignore" },
  );
  try {
    const r = derive(root);
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:46122\b/);
    assert.match(r.stdout, new RegExp(`pid=${child.pid} addr=127\\.0\\.0\\.1:46122 cause=derived-from-argv`));
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("wildcard bind host is normalised to loopback (0.0.0.0 -> 127.0.0.1)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "0.0.0.0", port: 46123 });
  try {
    const r = derive(root);
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:46123\b/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a serve process whose argv omits --host is refused as argv-host-absent (not silently guessed)", () => {
  const root = mkRoot();
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)", "quay.ts", "serve", "--port", "46124"], {
    cwd: root,
    stdio: "ignore",
  });
  try {
    const r = derive(root);
    assert.equal(r.code, 1);
    assert.match(candidateRow(r.stderr, child.pid) ?? "", /addr=- cause=argv-host-absent,carrier-absent/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a serve process whose argv omits --port is refused as argv-port-absent (not defaulted)", () => {
  const root = mkRoot();
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)", "quay.ts", "serve", "--host", "127.0.0.1"], {
    cwd: root,
    stdio: "ignore",
  });
  try {
    const r = derive(root);
    assert.equal(r.code, 1);
    assert.match(candidateRow(r.stderr, child.pid) ?? "", /addr=- cause=argv-port-absent,carrier-absent/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── ② kernel-assigned port (`--port 0`): the carrier is the only place it is knowable ────────────

test("--port 0 derives the carrier's web port for THIS pid (the launcher default deployment)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    writeCarrier(root, {
      pid: child.pid,
      services: [
        { name: "web", pid: child.pid, host: "172.28.0.1", port: 34681, up: true },
        { name: "control", pid: child.pid, host: "127.0.0.1", port: 34682, up: true },
      ],
    });
    const r = derive(root);
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=172\.28\.0\.1:34681\b/);
    assert.match(r.stdout, /DERIVED_SRC=carrier\b/);
    // The control-plane port must NOT be picked: two services share a pid, and only `web` answers
    // `/tests` — taking `control` would dial a JSON-RPC listener.
    assert.doesNotMatch(r.stdout, /DERIVED_ADDR=[^\n]*34682/);
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
      services: [{ name: "web", pid: child.pid, host: "0.0.0.0", port: 34683, up: true }],
    });
    const r = derive(root);
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:34683\b/);
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
      services: [{ name: "web", pid: child.pid + 1000000, host: "172.28.0.1", port: 34684, up: true }],
    });
    const r = derive(root);
    assert.equal(r.code, 1);
    assert.match(candidateRow(r.stderr, child.pid) ?? "", /cause=argv-port-kernel-assigned,carrier-pid-mismatch/);
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
      services: [{ name: "control", pid: child.pid, host: "127.0.0.1", port: 34685, up: true }],
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
      services: [{ name: "web", pid: child.pid, host: "172.28.0.1", port: 34686, up: false }],
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
  // A live candidate with an EXPLICIT port: it keeps the block's own selection from reaching its
  // refuse-and-exit branch, so the appended direct call below is actually reached (the block, run to
  // the end, is what the gate runs — a shorter extraction here would test a different text).
  const live = spawnServeShaped(root, { host: "127.0.0.1", port: 46125 });
  try {
    writeCarrier(root, {
      pid: deadPid,
      services: [{ name: "web", pid: deadPid, host: "172.28.0.1", port: 34687, up: true }],
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

// ── a non-serve candidate must be attributed and must never blank a real address ─────────────────

test("a candidate with no positional `serve` argv (the runner's own sh) is reported with a cause", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "127.0.0.1", port: 46126 });
  try {
    const r = derive(root);
    const self = r.stdout.match(/REPORT=([^\n]*)/)?.[1] ?? "";
    // The block's own text contains `quay.ts serve`, so the `sh -c` running it matches pgrep and
    // its cwd IS this root. It must appear with a cause — not vanish, and not clear the address.
    assert.match(self, /pid=\d+ addr=- cause=argv-no-serve/);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:46126\b/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative control ①: no serve instance at all (its own token, its own shape) ─────────────────

test("no serve process at all refuses as no-running-serve-instance, with CANDIDATES: none", () => {
  const root = mkRoot();
  try {
    // Run from a FILE: under `sh -c` the runner's own argv carries `quay.ts serve` and would make
    // the candidate set non-empty, so the empty set is only observable this way.
    const r = runShFile(`${derivationBlock()}\necho "REACHED=1"\n`, root);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "", "the refusal must exit before the appended echo");
    assert.match(r.stderr, /CAUSE=no-running-serve-instance -- no quay\.ts serve process with cwd=/);
    assert.match(r.stderr, /CANDIDATES: none -- pgrep -f 'quay\.ts serve' x cwd=.* matched no process/);
    // "no serve instance" must not be conflated with "candidates existed but none derived".
    assert.doesNotMatch(r.stderr, /no-derivable-address/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("candidates that exist but derive nothing refuse as no-derivable-address, NOT no-running-serve-instance", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    const r = derive(root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /CAUSE=no-derivable-address/);
    // The two negatives are different tokens — "there was no serve process" and "there was one and
    // its address was unknowable" never wear the same shape (hard rule 3b).
    assert.doesNotMatch(r.stderr, /no-running-serve-instance/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative control ② + AC4: a derived address nothing answers, per-candidate attributed ───────

test("full criterion: a derived address with nothing listening fails as en-fetch-failed, attributed", async () => {
  const root = mkRoot();
  const port = await deadPort();
  const child = spawnServeShaped(root, { host: "127.0.0.1", port });
  try {
    const r = runSh(criterionText(), root);
    assert.equal(r.code, 1, "the criterion must not pass on an address nobody answers");
    // "取不到" — the fetch half of AC2(b): the address derived fine, nothing is there to answer it.
    assert.match(r.stderr, /CAUSE=en-fetch-failed\b/);
    assert.match(r.stderr, new RegExp(`GET http://127\\.0\\.0\\.1:${port}/tests returned nothing`));
    // …and it is a DIFFERENT token from negative control ①, so "derived but unreachable" and "no
    // serve instance at all" stay two readings rather than one.
    assert.doesNotMatch(r.stderr, /no-running-serve-instance/);
    // AC4: the refusal carries the per-candidate attribution, with the derived address on it — every
    // candidate has pid + (an address or `addr=-`) + a cause, and none is a bare `addr=`.
    const row = candidateRow(r.stderr, child.pid);
    assert.ok(row, `the derived candidate must be attributed: ${r.stderr}`);
    assert.match(row, new RegExp(`addr=127\\.0\\.0\\.1:${port}\\b`));
    assert.match(row, /cause=derived-from-argv\b/);
    assert.doesNotMatch(r.stderr, /addr= cause=/, "no candidate may be reported without a cause");
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
