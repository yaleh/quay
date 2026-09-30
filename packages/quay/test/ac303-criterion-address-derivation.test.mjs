// @test-group product
//
// ac303-criterion-address-derivation.test.mjs — the fixture for the RE-ANCHORED address-derivation
// step of `goals/AC-303-*.md`'s criterion (gap-ac303-criterion-cmdline-port-literal-stale).
//
// WHAT THIS FILE IS FOR. The AC-303 criterion probes a RUNNING `quay.ts serve` and asserts, over
// HTTP, that /architecture's own chrome switches with the locale. Its address used to be parsed as
// the literal `--host H --port N` of the process cmdline — and `ce0f47518`
// (`gap-serve-same-root-admission-lock`, 2026-09-18, body: "Default port 4173 -> 0.") moved the web
// port's DEFAULT to kernel-assigned, so on the launcher default that step derived `<host>:0`, a
// structurally-unfetchable address, and the criterion could not be true on any deployment that used
// the default. Nothing was wrong with the page: the criterion was red on the same
// `payload.criterionHash f452c81b20f3ae15` on both sides of its pass→fail flip, i.e. the CARRIER
// moved, not the criterion's subject. The derivation step was re-anchored to two sources:
//   ① the process's OWN argv, read POSITIONALLY (`serve … --host H --port N`, N >= 1);
//   ② otherwise this root's `.quay/server.json` carrier — the only place a kernel-assigned port is
//      knowable — accepted only when its pid IS this candidate, that pid is alive, and its `web`
//      service is up (the carrier holds TWO services; `control` shares the pid and dials a
//      different listener, so only `name == "web"` counts).
//
// THE UNIT UNDER TEST IS THE SHIPPED BLOCK, NOT A COPY OF IT. `addr-derivation` is extracted
// VERBATIM from the goal file's criterion — the same text `quay goal gate AC-303` runs — and
// executed under `/bin/sh` against fixture processes and fixture carriers. A reimplementation here
// would be an echo of the criterion rather than a measurement of it (hard rule 4): it would stay
// green while the criterion rotted, which is exactly the failure this task exists to repair.
//
// FIXTURES ARE REAL PROCESSES WITH REAL ARGV. A candidate is only a candidate because
// `pgrep -f 'quay.ts serve'` found it AND `/proc/<pid>/cwd` equals the fixture root, so each case
// spawns a real child whose own argv positionally reads `… quay.ts serve --host H --port N` with
// cwd = a fresh `git init`-ed temp root (a mkdtemp'd bare directory is not a root —
// `git rev-parse --show-toplevel` would resolve to the enclosing repo, and the cwd filter would
// then match the whole host).
//
// BOTH DIRECTIONS ARE COVERED. A derivation that only ever reports success is not a measurement:
// the explicit-port and carrier positive controls are paired with no-carrier, carrier-pid-mismatch,
// no-`web`-entry, `web.up:false`, dead-carrier-pid and dead-address negatives, and every case also
// asserts the ATTRIBUTION contract (each candidate appears with `pid`, a derived address or
// `addr=-`, and a cause) plus the DISTINCTNESS of the two refusal modes (hard rules 3/3b: "could
// not evaluate" must not wear the same shape as "evaluated", and the two ways of failing to get an
// address must not wear each other's shape).
//
// The two fetch-half cases run the WHOLE criterion text — derivation AND the /architecture
// assertions after it — because the property "an address that nothing answers must not pass" lives
// in the tail, not in the derivation.
//
// REVISED 2026-09-29 (gap-ac303-criterion-carrier-absence-not-evaluated) — THREE-VALUED, NOT
// BOOLEAN. The criterion's two EVALUABILITY branches (no-running-serve-instance,
// no-derivable-address) left through `fail()`, i.e. status 1, so "there is no live carrier HERE and
// I cannot evaluate this" was recorded as "this is false" — the goal driver's pre-filing recheck
// files a `fail` as confirmed-failing and files nothing for `not-evaluated`, so a dead server
// re-filed the AC every round (the ledger's two `no-derivable-address` fails on 2026-09-29). The
// repo already fixes that value one layer down: `goal-store.ts:311-318` names `exit 3` as the
// not-evaluated convention and `gate/acceptance-runner.ts` `verdictFromAcceptance` maps code 3 to
// verdict `not-evaluated` / cause `declared`. So `fail()` now exits 3 and the EIGHT evaluability
// negatives below assert `code === 3`. ⛔ The ten post-derivation ASSERTION branches still exit 1
// and the two fetch-half cases still assert `code === 1`: a reachable-but-wrong page is a hard
// fail, and this file pins that separation from both sides — the third section below pairs a live
// untranslated `/architecture` (status 1, nav-label-untranslated) with a live translated one
// (status 0), so a "not-evaluated" that had swallowed the assertion half could not stay green.
// The last test parses the WHOLE criterion with `/bin/sh -n`: the criterion lives in a YAML `>-`
// folded scalar, and a comment written with a hard newline comes back as non-comment shell code
// (the AC-295 landing died of exactly that while every block-scoped case stayed green).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  writeCarrier,
  mkRoot,
  runSh,
  derive,
  installLiveWebAddressHelper,
} from "./helpers/live-web-address-fixture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root of THIS checkout (a task worktree during dispatch). */
const REPO = path.resolve(HERE, "..", "..", "..");

const MARK_START = ">>> addr-derivation";
const MARK_END = "<<< addr-derivation";

/** The one goal file this fixture is pinned to. Resolved by id prefix, so a rename that keeps the
 *  id still resolves; a missing file fails loudly rather than skipping. */
function goalFilePath() {
  const dir = path.join(REPO, "goals");
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-303-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-303-*.md under ${dir}`);
  return path.join(dir, name);
}

/** The criterion text AS STORED (frontmatter folded scalar parsed back to a string) — the same
 *  string `quay goal gate AC-303` hands to the acceptance runner. Reassembling it from the raw
 *  file text instead would be a different script: `>-` folds the source line breaks. */
function criterionText() {
  const raw = fs.readFileSync(goalFilePath(), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  assert.ok(fm, "goal file has no YAML frontmatter");
  const doc = YAML.parse(fm[1]);
  assert.equal(typeof doc.criterion, "string", "goal record has no criterion string");
  return doc.criterion;
}

/** The criterion lines before the derivation marker — the amendment's "why", which must not be
 *  inside the block (the block stays byte-comparable across the re-anchored ACs). */
function preambleText() {
  const lines = criterionText().split("\n");
  return lines.slice(0, lines.findIndex((l) => l.includes(MARK_START))).join("\n");
}

/** The criterion lines after the derivation marker — ROUTE/LABEL_EN and the /architecture fetch
 *  assertions. These are what AC5 pins: they must survive the amendment byte-for-byte. */
function tailText() {
  const lines = criterionText().split("\n");
  const end = lines.findIndex((l) => l.includes(MARK_END));
  return lines.slice(end + 1).join("\n");
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
  for (const needle of ["argv_addr()", "carrier_addr()", "pgrep -f 'quay.ts serve'", "live-web-address.ts"]) {
    assert.ok(block.includes(needle), `extracted block does not contain ${needle}`);
  }
  return block;
}

/** A fresh temp root that IS a git root (`git rev-parse --show-toplevel` == itself). */
/** The carrier this root's OWN server would publish (`.quay/server.json`, schemaVersion 1). */
/**
 * A real child process whose OWN argv positionally reads `… quay.ts serve --host <host> --port <n>`,
 * with cwd = `root` — the exact shape both `pgrep -f 'quay.ts serve'` and the derivation step are
 * defined over. It never listens; whether the address answers is the HTTP half's business, not the
 * derivation's.
 */
function spawnServeShaped(root, { host = "127.0.0.1", port, eqForm = false }) {
  const argv = eqForm
    ? ["quay.ts", "serve", `--host=${host}`, `--port=${port}`]
    : ["quay.ts", "serve", "--host", host, "--port", String(port)];
  return spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)", ...argv], {
    cwd: root,
    stdio: "ignore",
  });
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
/**
 * Run `script` from a FILE under /bin/sh. This is how the "no candidate at all" case is reachable:
 * a `sh -c '<criterion>'` runner carries the criterion text — and therefore the literal
 * `quay.ts serve` — on its OWN argv, so it matches `pgrep -f` too. From a file the runner's argv is
 * just `sh <path>` and only real serve-shaped processes remain.
 */
function runShFile(script, root) {
  const f = path.join(root, ".probe-block.sh");
  fs.writeFileSync(f, script, "utf8");
  try {
    const r = spawnSync("/bin/sh", [f], { cwd: root, encoding: "utf8", timeout: 30000 });
    return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  } finally {
    fs.rmSync(f, { force: true });
  }
}

/** Run the shipped block and report what it derived, or why it refused. */
/** The block run from a file, so the invoking shell is not itself a candidate. */
function deriveFromFile(root) {
  return runShFile(
    `${derivationBlock()}\necho "DERIVED_ADDR=$addr"\necho "DERIVED_SRC=$src"\necho "REPORT=$rep"\n`,
    root,
  );
}

/** The candidate row the block emits for one pid, or undefined when that pid is absent. */
function candidateRow(stderr, pid) {
  return stderr
    .split("\n")
    .flatMap((l) => l.replace(/^CANDIDATES:/, "").split(" | "))
    .map((s) => s.trim())
    .find((s) => s.startsWith(`pid=${pid} `));
}

/** Every `pid=… addr=… cause=…` row the block emitted, on stdout (success) or stderr (refusal). */
function candidateRows(stream) {
  return stream
    .split("\n")
    .flatMap((l) => l.replace(/^CANDIDATES:/, "").replace(/^REPORT[:=]/, "").split(" | "))
    .map((s) => s.trim())
    .filter((s) => s.startsWith("pid="));
}

function killQuietly(child) {
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

/** A port the kernel just handed out and we released — nothing is listening on it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// ── the extraction itself: the unit under test must be the shipped text ─────────────────────────

test("the extracted block is the shipped derivation, and the amendment's why/route/label stay outside it", () => {
  const block = derivationBlock();
  const all = criterionText();
  // Non-vacuous: the block really is the derivation, not an emptied region between two markers.
  assert.match(block, /^root=\$\(git rev-parse --show-toplevel\)$/m);
  assert.match(block, /case "\$a" in 0\.0\.0\.0:\*\)/);
  // AC5: ROUTE/LABEL_EN live OUTSIDE the block, so the block stays byte-comparable across the
  // re-anchored family (AC-288/290/292/…/297 all carry the same text).
  assert.doesNotMatch(block, /\bROUTE=/);
  assert.doesNotMatch(block, /\bLABEL_EN=/);
  assert.match(tailText(), /^ROUTE="\/architecture"$/m);
  assert.match(tailText(), /^LABEL_EN="Architecture"$/m);
  // AC5: the amendment says WHY, and the reason is on the criterion itself, not only in a commit.
  assert.match(preambleText(), /WHY THIS STEP WAS RE-ANCHORED/);
  assert.match(preambleText(), /--port 0|kernel-assigned/);
  // AC5: the chrome scope is unchanged — the label is asserted against the NAV REGION and the page
  // title against <title>, never against the whole response (an en response carries "Architecture"
  // four times, ~three of them outside <nav>, so a whole-body match would misfire).
  assert.match(tailText(), /case "\$nav_en" in \*"\$LABEL_EN"\*/);
  assert.match(tailText(), /case "\$nav_zh" in \*"\$LABEL_EN"\*/);
  assert.doesNotMatch(tailText(), /case "\$en" in \*"\$LABEL_EN"\*/);
  assert.match(tailText(), /grep -o '<nav\.\*<\/nav>'/);
  assert.match(tailText(), /grep -oE '<title>\[\^<\]\*<\/title>'/);
  // Nothing about this host is written down: the address is re-derived on every run (hard rule 4
  // corollary ② — a literal would be a host-dependent constant that goes stale silently).
  assert.doesNotMatch(all, /127\.0\.0\.1:1[0-9]{4}\b/);
  assert.doesNotMatch(all, /\b172\.28\.\d+\.\d+:/);
});

// ── ① explicit `--port N` (N >= 1) on the process's own argv ────────────────────────────────────

test("explicit --port N >= 1 on the process argv derives host:port (no carrier needed)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "127.0.0.1", port: 46011 });
  try {
    const r = derive(root, derivationBlock());
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:46011\b/);
    assert.match(r.stdout, /DERIVED_SRC=argv\b/);
    assert.match(r.stdout, new RegExp(`pid=${child.pid} addr=127\\.0\\.0\\.1:46011 cause=derived-from-argv`));
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the --host=/--port= equals-form argv is read too (the space form is not the only launcher shape)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "127.0.0.1", port: 46015, eqForm: true });
  try {
    const r = derive(root, derivationBlock());
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:46015\b/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("wildcard bind host is normalised to loopback (0.0.0.0 -> 127.0.0.1)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "0.0.0.0", port: 46012 });
  try {
    const r = derive(root, derivationBlock());
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
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    writeCarrier(root, {
      pid: child.pid,
      services: [
        { name: "web", pid: child.pid, host: "172.28.0.1", port: 34567, up: true },
        { name: "control", pid: child.pid, host: "127.0.0.1", port: 34568, up: true },
      ],
    });
    const r = derive(root, derivationBlock());
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=172\.28\.0\.1:34567\b/);
    assert.match(r.stdout, /DERIVED_SRC=carrier\b/);
    // The control-plane port must NOT be picked: two services share a pid, and only `web` answers
    // /architecture — taking `control` would dial a JSON-RPC listener.
    assert.doesNotMatch(r.stdout, /DERIVED_ADDR=[^\n]*34568/);
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
    const r = derive(root, derivationBlock());
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:34569\b/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("argv wins over the carrier when both are usable (an explicit port is a direct reading)", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "127.0.0.1", port: 46016 });
  try {
    writeCarrier(root, {
      pid: child.pid,
      services: [{ name: "web", pid: child.pid, host: "127.0.0.1", port: 34574, up: true }],
    });
    const r = derive(root, derivationBlock());
    assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:46016\b/);
    assert.match(r.stdout, /DERIVED_SRC=argv\b/);
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
    const r = derive(root, derivationBlock());
    assert.equal(r.code, 3, "a root whose only serve candidate has no carrier must not derive an address");
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
    const r = derive(root, derivationBlock());
    assert.equal(r.code, 3);
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
    const r = derive(root, derivationBlock());
    assert.equal(r.code, 3);
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
    const r = derive(root, derivationBlock());
    assert.equal(r.code, 3);
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
  // A live candidate with an EXPLICIT port so the appended direct call below is actually reached
  // (the block, run to the end, is what the gate runs — a shorter extraction tests a different text).
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

test("an unreadable carrier is a NAMED cause, not a silent empty address", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", "server.json"), "{ this is not json");
    const r = derive(root, derivationBlock());
    assert.equal(r.code, 3, "a malformed carrier must not yield an address");
    // hard rule 3b: the "could not read it" outcome is a distinct value, never the shape of a
    // successful derivation and never a bare `addr=`.
    const row = candidateRow(r.stderr, child.pid) ?? "";
    assert.match(row, /addr=-/);
    assert.match(row, /cause=.*carrier-unreadable/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── the two refusal MODES must be distinguishable (hard rules 3 / 3b) ────────────────────────────

test("no live candidate: a distinct named CAUSE, different in shape from the derivation refusal", () => {
  const root = mkRoot();
  try {
    // No serve-shaped process at all for this root, and the block runs from a FILE so the invoking
    // shell's own argv does not masquerade as one.
    const r = deriveFromFile(root);
    assert.equal(r.code, 3, "no candidate must not pass");
    assert.match(r.stderr, /CAUSE=no-running-serve-instance/);
    assert.match(r.stderr, /CANDIDATES: none -- /);
    // ...and it is NOT the same token as "candidates existed but none yielded a live address".
    assert.doesNotMatch(r.stderr, /CAUSE=no-derivable-address/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("candidates exist but none is live: no-derivable-address, NOT no-running-serve-instance", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    const r = derive(root, derivationBlock());
    assert.equal(r.code, 3);
    assert.match(r.stderr, /CAUSE=no-derivable-address/);
    assert.doesNotMatch(r.stderr, /CAUSE=no-running-serve-instance/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── the runner's own shell is a candidate and must be attributed, never silently dropped ─────────

test("a candidate with no positional `serve` argv (the runner's own sh) is reported with a cause", () => {
  const root = mkRoot();
  const child = spawnServeShaped(root, { host: "127.0.0.1", port: 46013 });
  try {
    const r = derive(root, derivationBlock());
    const self = r.stdout.match(/REPORT[:=]([^\n]*)/)?.[1] ?? "";
    // The block's own text contains `quay.ts serve`, so the `sh -c` running it matches pgrep and
    // its cwd IS this root. It must appear with a cause — not vanish, and not clear the address.
    assert.match(self, /pid=\d+ addr=- cause=argv-no-serve/);
    assert.match(r.stdout, /DERIVED_ADDR=127\.0\.0\.1:46013\b/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC4: every candidate carries pid + address (or `addr=-`) + cause ─────────────────────────────

test("attribution on a refusal: every candidate row carries pid, addr=-, and a cause", () => {
  const root = mkRoot();
  const bare1 = spawnServeShaped(root, { host: "172.28.0.1", port: 0 }); // carrier-less: no port anywhere
  const bare2 = spawnServeShaped(root, { host: "10.0.0.5", port: 0 });
  try {
    const r = deriveFromFile(root);
    assert.equal(r.code, 3, "with no derivable candidate the block must refuse");
    const rows = candidateRows(r.stderr);
    assert.ok(rows.length >= 2, `both candidates must be attributed: ${r.stderr}`);
    for (const row of rows) {
      assert.match(row, /^pid=\d+ /, `row must name its pid: ${row}`);
      assert.match(row, /addr=(\S+|-) /, `row must carry an address or addr=-: ${row}`);
      assert.match(row, /cause=\S/, `row must carry a cause: ${row}`);
      assert.doesNotMatch(row, /addr=\s/, `addr must never be the empty string: ${row}`);
    }
    for (const c of [bare1, bare2]) {
      assert.ok(
        rows.some((x) => x.startsWith(`pid=${c.pid} `) && /addr=- cause=/.test(x)),
        `candidate ${c.pid} must appear with addr=- and a cause: ${r.stderr}`,
      );
    }
  } finally {
    killQuietly(bare1);
    killQuietly(bare2);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("attribution on a SUCCESSFUL run still lists the non-derivable candidate (no silent drop)", () => {
  const root = mkRoot();
  const good = spawnServeShaped(root, { host: "127.0.0.1", port: 46017 });
  const bare = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    const r = deriveFromFile(root);
    assert.equal(r.code, 0, `one derivable candidate is enough: ${r.stderr}`);
    const rows = candidateRows(r.stdout);
    assert.ok(
      rows.some((x) => x.startsWith(`pid=${good.pid} `) && /addr=127\.0\.0\.1:46017 cause=derived-from-argv/.test(x)),
      `the derivable candidate must be attributed: ${r.stdout}`,
    );
    assert.ok(
      rows.some((x) => x.startsWith(`pid=${bare.pid} `) && /addr=- cause=/.test(x)),
      `the non-derivable candidate must still be attributed, not dropped: ${r.stdout}`,
    );
  } finally {
    killQuietly(good);
    killQuietly(bare);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── ③ the fetch half of the criterion, on a derived address that is genuinely dead ───────────────

test("full criterion: a derived dead ARGV port fails on the fetch, with the address on the cause", async () => {
  const root = mkRoot();
  const deadPort = await freePort();
  const child = spawnServeShaped(root, { host: "127.0.0.1", port: deadPort });
  try {
    const r = runSh(criterionText(), root);
    assert.equal(r.code, 1, "the criterion must not pass on an address nobody answers");
    assert.match(r.stderr, /CAUSE=en-fetch-failed\b/);
    assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${deadPort}\\b`));
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("full criterion: a dead CARRIER port fails too — the carrier derives, it does not vouch", async () => {
  const root = mkRoot();
  const deadPort = await freePort();
  const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
  try {
    writeCarrier(root, {
      pid: child.pid,
      services: [{ name: "web", pid: child.pid, host: "172.28.0.1", port: deadPort, up: true }],
    });
    const r = runSh(criterionText(), root);
    assert.equal(r.code, 1, "a carrier claim is not a reading: the fetch must still be the verdict");
    assert.match(r.stderr, /CAUSE=en-fetch-failed\b/);
    assert.match(r.stderr, new RegExp(`addr=172\\.28\\.0\\.1:${deadPort}\\b`));
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── ④ the assertion half keeps its teeth: a LIVE, WRONG /architecture is still a hard fail ───────
//
// Moving the two evaluability branches to status 3 creates a risk worth measuring, not asserting
// away: a criterion that answers "I could not evaluate this HERE" in a case that is genuinely false
// is a guard that can never say no (hard rule 3b's vacuous half — indistinguishable from "checked
// and fine"). These two cases close it from BOTH sides on a page that really ANSWERS. Same criterion
// text, same serve-shaped candidate and carrier; the ONLY difference is whether the zh response
// localises the nav label. exit 1 + the nav-label-untranslated token versus exit 0 — so a status-3
// branch that had swallowed the assertion half would turn one of them red.

/** The fixture pages. `translated` decides whether the zh nav region still carries the English nav
 *  label (the criterion's nav-label-untranslated branch); the zh <title> differs in both variants,
 *  so the nav label is the single discriminator between the pass and the fail below. */
function archPages(translated) {
  const en =
    '<!doctype html><html lang="en"><head><title>Architecture</title></head><body><nav><a href="/architecture">Architecture</a></nav></body></html>';
  const zh = translated
    ? '<!doctype html><html lang="zh"><head><title>架构</title></head><body><nav><a href="/architecture">架构</a></nav></body></html>'
    : '<!doctype html><html lang="zh"><head><title>架构</title></head><body><nav><a href="/architecture">Architecture</a></nav></body></html>';
  return { en, zh };
}

/**
 * A REAL listening server that ALSO carries the serve-shaped argv the derivation step reads:
 * `node -e <script> quay.ts serve --host H --port 0`, cwd = `root`. That is the launcher-default
 * gen-2 shape the criterion was re-anchored for — the port is kernel-assigned, so the address is
 * knowable ONLY from the carrier, which this fixture writes with the port the child reports back.
 *
 * The answer half lives in a SEPARATE PROCESS on purpose: the criterion is run through `runSh`
 * (`spawnSync`), which blocks THIS process's event loop, so an in-process listener could never
 * answer a request the blocked loop was holding open.
 */
function spawnServeListening(root, { translated, host = "127.0.0.1" }) {
  const script = [
    'const http = require("http");',
    "const pages = JSON.parse(process.env.AC303_PAGES);",
    "const srv = http.createServer((req, res) => {",
    '  const zh = /(?:^|;\\s*)lang=zh/.test(req.headers.cookie || "");',
    '  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });',
    "  res.end(zh ? pages.zh : pages.en);",
    "});",
    'srv.listen(0, "127.0.0.1", () => process.stdout.write(String(srv.address().port)));',
  ].join("\n");
  const child = spawn(
    process.execPath,
    ["-e", script, "quay.ts", "serve", "--host", host, "--port", "0"],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, AC303_PAGES: JSON.stringify(archPages(translated)) },
    },
  );
  return new Promise((resolve, reject) => {
    let buf = "";
    let settled = false;
    child.stdout.on("data", (d) => {
      buf += d;
      const m = /^(\d+)/.exec(buf);
      if (m && !settled) {
        settled = true;
        resolve({ child, port: Number(m[1]) });
      }
    });
    child.on("error", (e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
    child.on("exit", (c) => {
      if (!settled) {
        settled = true;
        reject(new Error(`listening fixture exited before reporting a port (code ${c})`));
      }
    });
  });
}

test("full criterion on a LIVE but untranslated /architecture: hard fail at 1, not not-evaluated", async () => {
  const root = mkRoot();
  const { child, port } = await spawnServeListening(root, { translated: false });
  try {
    writeCarrier(root, {
      pid: child.pid,
      services: [{ name: "web", pid: child.pid, host: "127.0.0.1", port, up: true }],
    });
    const r = runSh(criterionText(), root);
    assert.equal(r.code, 1, "a reachable page whose zh nav is untranslated is FALSE, not not-evaluated");
    assert.match(r.stderr, /CAUSE=nav-label-untranslated\b/);
    // ...and it is NOT one of the evaluability refusals: the status-3 branches must not be reachable
    // while an answer was actually obtained.
    assert.doesNotMatch(r.stderr, /CAUSE=no-derivable-address|CAUSE=no-running-serve-instance/);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("full criterion on a LIVE translated /architecture: passes at 0 (the same text can say both)", async () => {
  const root = mkRoot();
  const { child, port } = await spawnServeListening(root, { translated: true });
  try {
    writeCarrier(root, {
      pid: child.pid,
      services: [{ name: "web", pid: child.pid, host: "127.0.0.1", port, up: true }],
    });
    const r = runSh(criterionText(), root);
    assert.equal(r.code, 0, `a correctly localised live page must pass: ${r.stderr}`);
    assert.match(r.stdout, /^OK -- \/architecture:/m);
  } finally {
    killQuietly(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── ⑤ the amendment's own shape: ONE exit path moved, and the criterion is still valid sh ────────

test("exactly one exit path moved to 3; the ten assertion branches and the refusal tokens are untouched", () => {
  const lines = criterionText().split("\n");
  const code = lines.filter((l) => !l.trimStart().startsWith("#"));
  assert.equal(
    code.filter((l) => /\bexit 1\b/.test(l)).length,
    10,
    "the ten post-derivation assertion branches must all still exit 1",
  );
  assert.equal(
    code.filter((l) => /\bexit 3\b/.test(l)).length,
    1,
    "exactly ONE exit path — the evaluability helper — may exit 3",
  );
  const failLine = code.find((l) => /^fail\(\) \{/.test(l));
  assert.ok(failLine, "both evaluability branches must still leave through fail()");
  assert.match(failLine, /exit 3; \}$/);
  assert.equal(
    code.filter((l) => /fail "/.test(l)).length,
    2,
    "fail() must still have exactly its two evaluability callers",
  );
  // The refusal TOKENS are byte-untouched: a new comment that spelled one would move this count
  // (that is exactly how the AC-292 sibling's first landing went red).
  assert.equal(lines.filter((l) => l.includes("CAUSE=")).length, 12);
  assert.equal(lines.filter((l) => l.includes("FAIL=")).length, 0);
});

test("the WHOLE criterion is valid sh (a folded-scalar comment hazard would die here)", () => {
  // The criterion is persisted as a YAML `>-` folded scalar, so a `#` comment that came back as two
  // logical lines is shell code, not a comment — the AC-295 landing died of `Syntax error: ")"` while
  // every block-scoped case stayed green. `-n` parses without executing (no serve, no cwd needed).
  const r = spawnSync("/bin/sh", ["-n"], { input: criterionText(), encoding: "utf8" });
  assert.equal(r.status, 0, `criterion is not parseable by /bin/sh: ${r.stderr}`);
});
