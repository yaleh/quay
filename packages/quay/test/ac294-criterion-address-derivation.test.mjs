// @test-group product
//
// ac294-criterion-address-derivation.test.mjs — the fixture for the RE-ANCHORED address-derivation
// step of `goals/AC-294-*.md`'s criterion (gap-ac294-criterion-cmdline-port-literal-stale).
//
// It is the SIBLING of packages/quay/test/ac288-criterion-address-derivation.test.mjs (the family's
// landed re-anchor) and of ac290's fixture: the derivation step is one shared line across the family,
// so the block is adopted VERBATIM (per its own "copy it, do not re-derive") with only ROUTE /
// LABEL_EN retargeted to this AC (/manager, "Manager").
//
// WHAT THIS FILE IS FOR. The AC-294 criterion probes a RUNNING `quay.ts serve` (cwd = repo root) and
// asserts, over HTTP, that /manager's chrome switches under `Cookie: lang=zh`. Its address used to be
// parsed as the literal `--host H --port N` of the process cmdline — and `ce0f47518`
// (`gap-serve-same-root-admission-lock`) moved the web port's DEFAULT to kernel-assigned
// (`--port 0`), so on the launcher default that step derived `<host>:0`, a structurally
// unfetchable address. The ledger shows the failure is a CARRIER move, not a subject regression: the
// SAME criterionHash 597695d4730a8e33 was green at 2026-09-23T05:08:45.174Z and red at
// 2026-09-23T08:36:03.310Z. The derivation step was re-anchored to two sources:
//   ① the process's OWN argv, read POSITIONALLY (`serve … --host H --port N`, N >= 1);
//   ② otherwise this root's `.quay/server.json` carrier — the only place a kernel-assigned port is
//      knowable — accepted only when its schemaVersion is 1, its `pid` IS this candidate, that pid
//      is alive, and its `web` service is up at a usable host:port.
// The derived address is then PROBED with the same `GET /manager` the criterion's verdict rides on,
// so "derived an address" and "derived a REACHABLE address" do not collapse into one reading.
//
// THE UNIT UNDER TEST IS THE SHIPPED BLOCK, NOT A COPY OF IT. `addr-derivation` is extracted
// VERBATIM from the goal file's criterion — the same text `quay goal gate AC-294` runs — and
// executed under /bin/sh against fixture processes and fixture carriers. A reimplementation here
// would be an echo of the criterion rather than a measurement of it (hard rule 4): it would stay
// green while the criterion rotted, which is exactly the failure this task exists to repair.
//
// FIXTURES ARE REAL PROCESSES WITH REAL ARGV. A candidate is only a candidate because
// `pgrep -f 'quay.ts serve'` found it AND `/proc/<pid>/cwd` equals the fixture root, so each case
// spawns a real child whose own argv positionally reads `… quay.ts serve --host H --port N` with
// cwd = a fresh `git init`-ed temp root (a mkdtemp'd bare directory is not a root —
// `git rev-parse --show-toplevel` would resolve to the enclosing repo). Positive cases also run a
// REAL listener on the derived port, because the block probes it before accepting the address.
//
// THE RUNNING /bin/sh IS ITSELF A CANDIDATE — DELIBERATELY. The criterion text contains the literal
// `quay.ts serve`, so the `sh -c "<criterion>"` the acceptance runner spawns matches its own
// `pgrep` (acceptance-runner.ts runs the command with cwd = workspace root). That candidate must be
// reported with `addr=-` and a cause and must NOT erase an address another candidate derived; the
// `spawnSync` pid of that shell is asserted directly, so this stays a measurement of the shipped
// block rather than a statement about pgrep.
//
// BOTH DIRECTIONS ARE COVERED. A derivation that only ever reports success is not a measurement:
// the explicit-port and carrier positive controls are paired with no-carrier, carrier-pid-mismatch,
// no-`web`-entry, `web.up:false`, unreachable-port and not-a-serve-process negatives, and every case
// also asserts the ATTRIBUTION contract (each candidate carries `pid`, a derived address or
// `addr=-`, and a cause — hard rule 3/3b: "could not evaluate" must not wear the same shape as
// "evaluated"). One test additionally pins the ELEVEN `CAUSE=` refusal branches of the pre-amendment
// criterion, because the amendment re-anchored the address derivation only and must not have
// dropped or reworded them.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-294-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-294-*.md under ${dir}`);
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
  for (const needle of [
    "argv_addr()",
    "carrier_addr()",
    "pgrep -f 'quay.ts serve'",
    "live-web-address.ts",
    "FAIL=no-derivable-serve-address",
    "FAIL=no-reachable-serve-address",
  ]) {
    assert.ok(block.includes(needle), `extracted block does not contain ${needle}`);
  }
  return block;
}

/** A fresh temp root that IS a git root (`git rev-parse --show-toplevel` == itself). */
/** The carrier this root's OWN server would publish (`.quay/server.json`, schemaVersion 1). */
/**
 * A real child process whose OWN argv positionally reads `… quay.ts serve --host <host> --port <n>`,
 * with cwd = `root` — the exact shape both `pgrep -f 'quay.ts serve'` and the derivation step are
 * defined over. Whether that address answers is arranged separately, by `listen()`.
 */
function spawnServeShaped(root, { host = "127.0.0.1", port }) {
  return spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 300000)", "quay.ts", "serve", "--host", host, "--port", String(port)],
    { cwd: root, stdio: "ignore" },
  );
}

/**
 * A real child that `pgrep -f 'quay.ts serve'` MATCHES (the phrase is in its argv) but whose argv
 * carries no `serve` element — the shape of the acceptance runner's own `sh -c "<criterion>"`. It
 * must be reported as a candidate that derived nothing, and must never blank another candidate's
 * address.
 */
function spawnNotAServe(root, phrase = "quay.ts serve") {
  return spawn("/bin/sh", ["-c", `echo ${phrase} >/dev/null; sleep 300`], { cwd: root, stdio: "ignore" });
}

/**
 * A real HTTP listener on 127.0.0.1:0, IN ITS OWN PROCESS, announcing the port it got.
 *
 * ⛔ It must not live in this process: the block under test is driven through `spawnSync`, which
 * blocks this process's event loop for the whole probe — an in-process listener could never answer
 * and every positive case would read as `connection-refused`/`timeout`. A separate process also
 * makes the probe a REAL cross-process HTTP GET rather than a function call wearing one's shape.
 */
function listen() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        'const h=require("http");const s=h.createServer((q,r)=>{r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});r.end(\'<html lang="en"><nav>Manager</nav><title>t</title></html>\')});s.listen(0,"127.0.0.1",()=>console.log(s.address().port))',
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    child.stdout.setEncoding("utf8");
    let buf = "";
    const t = setTimeout(() => reject(new Error("listener child never announced its port")), 10000);
    child.stdout.on("data", (d) => {
      buf += d;
      const m = /(\d+)\s*\n/.exec(buf);
      if (m) {
        clearTimeout(t);
        resolve({ child, port: Number(m[1]) });
      }
    });
    child.once("exit", () => clearTimeout(t));
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
/** Run the shipped block and report what it derived, or why it refused. */
/** The candidate row the block emits for one pid, or undefined when that pid is absent. */
function candidateRow(text, pid) {
  return text
    .split("\n")
    .flatMap((l) => l.replace(/^.*REPORT:/, "").split("; "))
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

/** Run `body` with a fresh root and guaranteed teardown of every child/server/temp dir. */
async function withFixture(children, servers, body) {
  const root = mkRoot();
  try {
    return await body(root);
  } finally {
    for (const c of children) await killAndReap(c);
    for (const s of servers) await killAndReap(s);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ── ① explicit `--port N` (N >= 1) on the process's own argv ────────────────────────────────────

test("explicit --port N >= 1 on the process argv derives host:port and is probed, not assumed", async () => {
  const { child: srv, port } = await listen();
  const children = [];
  await withFixture(
    children,
    [srv],
    async (root) => {
      children.push(spawnServeShaped(root, { host: "127.0.0.1", port }));
      const r = derive(root, derivationBlock());
      assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
      assert.match(r.stdout, new RegExp(`DERIVED_ADDR=127\\.0\\.0\\.1:${port}\\b`));
      assert.match(r.stdout, /DERIVED_SRC=argv\b/);
      assert.match(r.stdout, new RegExp(`pid=${children[0].pid} addr=127\\.0\\.0\\.1:${port} cause=derived-from-argv-fetch-answered`));
    },
  );
});

test("wildcard bind host is normalised to loopback (0.0.0.0 -> 127.0.0.1)", async () => {
  const { child: srv, port } = await listen();
  const children = [];
  await withFixture(
    children,
    [srv],
    async (root) => {
      children.push(spawnServeShaped(root, { host: "0.0.0.0", port }));
      const r = derive(root, derivationBlock());
      assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
      assert.match(r.stdout, new RegExp(`DERIVED_ADDR=127\\.0\\.0\\.1:${port}\\b`));
    },
  );
});

// ── ② kernel-assigned port (`--port 0`): the carrier is the only place it is knowable ────────────

test("--port 0 derives the carrier's web port for THIS pid (the launcher default deployment)", async () => {
  const { child: srv, port } = await listen();
  const children = [];
  await withFixture(
    children,
    [srv],
    async (root) => {
      const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
      children.push(child);
      writeCarrier(root, {
        pid: child.pid,
        services: [
          { name: "web", pid: child.pid, host: "127.0.0.1", port, up: true },
          { name: "control", pid: child.pid, host: "127.0.0.1", port: port + 1, up: true },
        ],
      });
      const r = derive(root, derivationBlock());
      assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
      assert.match(r.stdout, new RegExp(`DERIVED_ADDR=127\\.0\\.0\\.1:${port}\\b`));
      assert.match(r.stdout, /DERIVED_SRC=carrier\b/);
      // The control-plane port must NOT be picked: two services share a pid, and only `web` answers
      // /manager — taking `control` would dial a JSON-RPC listener.
      assert.doesNotMatch(r.stdout, new RegExp(`DERIVED_ADDR=[^\\n]*:${port + 1}\\b`));
    },
  );
});

test("a wildcard web host in the carrier is normalised to loopback too", async () => {
  const { child: srv, port } = await listen();
  const children = [];
  await withFixture(
    children,
    [srv],
    async (root) => {
      const child = spawnServeShaped(root, { host: "0.0.0.0", port: 0 });
      children.push(child);
      writeCarrier(root, {
        pid: child.pid,
        services: [{ name: "web", pid: child.pid, host: "0.0.0.0", port, up: true }],
      });
      const r = derive(root, derivationBlock());
      assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
      assert.match(r.stdout, new RegExp(`DERIVED_ADDR=127\\.0\\.0\\.1:${port}\\b`));
    },
  );
});

// ── ③ the candidate contract: every candidate attributed, none erased (hard rule 3/3b) ──────────

test("the runner's OWN shell is a candidate, is attributed addr=-, and does not erase a real one", async () => {
  const { child: srv, port } = await listen();
  const children = [];
  await withFixture(
    children,
    [srv],
    async (root) => {
      // A LOW-pid non-serve candidate first (so it is visited BEFORE the real one: pgrep orders by
      // pid), then the real serve-shaped child. The blocked/derived order is what a regression in
      // "any candidate must not blank the derived address" would flip.
      children.push(spawnNotAServe(root));
      const serveChild = spawnServeShaped(root, { host: "127.0.0.1", port });
      children.push(serveChild);
      const r = derive(root, derivationBlock());
      assert.equal(r.code, 0, `derivation must succeed: ${r.stderr}`);
      const notServe = candidateRow(r.stdout, children[0].pid);
      assert.ok(notServe, `non-serve candidate must be attributed: ${r.stdout}`);
      assert.match(notServe, /addr=-/);
      assert.match(notServe, /cause=argv-no-serve-subcommand/);
      assert.match(r.stdout, new RegExp(`DERIVED_ADDR=127\\.0\\.0\\.1:${port}\\b`));
      // The `sh` that RAN the block carries the criterion text in argv, so it is a candidate too.
      const runner = candidateRow(r.stdout, r.pid);
      assert.ok(runner, `the runner's own shell (pid ${r.pid}) must appear as a candidate: ${r.stdout}`);
      assert.match(runner, /addr=-/);
      assert.match(runner, /cause=argv-no-serve-subcommand/);
      assert.equal(
        (r.stdout.match(/NSERVE=/g) || []).length,
        1,
        "nserve must be reported exactly once",
      );
      // nserve counts only real serve processes — the two non-serve shells are not one.
      assert.match(r.stdout, /NSERVE=1\b/);
    },
  );
});

// ── ④ negatives: refusal must be distinguishable, attributed, and never a bare `addr=` ───────────

test("no carrier: refuses with FAIL=no-derivable-serve-address and names both causes for the candidate", async () => {
  const children = [];
  await withFixture(
    children,
    [],
    async (root) => {
      const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
      children.push(child);
      const r = derive(root, derivationBlock());
      assert.equal(r.code, 1, "a root whose only serve candidate has no carrier must not derive an address");
      assert.match(r.stderr, /FAIL=no-derivable-serve-address/);
      const row = candidateRow(r.stderr, child.pid);
      assert.ok(row, `candidate ${child.pid} must be attributed: ${r.stderr}`);
      assert.match(row, /addr=-/);
      assert.match(row, /cause=argv-port-kernel-assigned,carrier-absent/);
      // The new refusal is NOT the verbatim pre-existing branch: a serve process existed here.
      assert.doesNotMatch(r.stderr, /CAUSE=no-running-serve-instance/);
    },
  );
});

test("carrier naming another pid is refused (pid is the positional link, not the port alone)", async () => {
  const children = [];
  await withFixture(
    children,
    [],
    async (root) => {
      const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
      children.push(child);
      writeCarrier(root, {
        pid: child.pid + 1000000,
        services: [{ name: "web", pid: child.pid + 1000000, host: "172.28.0.1", port: 34570, up: true }],
      });
      const r = derive(root, derivationBlock());
      assert.equal(r.code, 1);
      assert.match(candidateRow(r.stderr, child.pid) ?? "", /cause=argv-port-kernel-assigned,carrier-pid-mismatch/);
    },
  );
});

test("carrier with no `web` entry is refused (a control-only carrier names no web address)", async () => {
  const children = [];
  await withFixture(
    children,
    [],
    async (root) => {
      const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
      children.push(child);
      writeCarrier(root, {
        pid: child.pid,
        services: [{ name: "control", pid: child.pid, host: "127.0.0.1", port: 34571, up: true }],
      });
      const r = derive(root, derivationBlock());
      assert.equal(r.code, 1);
      assert.match(candidateRow(r.stderr, child.pid) ?? "", /cause=argv-port-kernel-assigned,carrier-no-web-service/);
    },
  );
});

test("carrier whose web service is down is refused (a down service is not an address)", async () => {
  const children = [];
  await withFixture(
    children,
    [],
    async (root) => {
      const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
      children.push(child);
      writeCarrier(root, {
        pid: child.pid,
        services: [{ name: "web", pid: child.pid, host: "172.28.0.1", port: 34572, up: false }],
      });
      const r = derive(root, derivationBlock());
      assert.equal(r.code, 1);
      assert.match(candidateRow(r.stderr, child.pid) ?? "", /cause=argv-port-kernel-assigned,carrier-web-down/);
    },
  );
});

test("a carrier that is not a schemaVersion-1 record is unreadable, not silently absent", async () => {
  const children = [];
  await withFixture(
    children,
    [],
    async (root) => {
      const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
      children.push(child);
      writeCarrier(root, {
        schemaVersion: 99,
        pid: child.pid,
        services: [{ name: "web", pid: child.pid, host: "172.28.0.1", port: 34573, up: true }],
      });
      const r = derive(root, derivationBlock());
      assert.equal(r.code, 1);
      assert.match(candidateRow(r.stderr, child.pid) ?? "", /cause=argv-port-kernel-assigned,carrier-unreadable/);
    },
  );
});

test("a derivable but UNREACHABLE address refuses with no-reachable-serve-address + connection-refused", async () => {
  const children = [];
  await withFixture(
    children,
    [],
    async (root) => {
      // Bind a port, learn it, release it: the derived address is well-formed and nothing listens.
      const { child: listener, port } = await listen();
      await killAndReap(listener);
      const child = spawnServeShaped(root, { host: "172.28.0.1", port: 0 });
      children.push(child);
      writeCarrier(root, {
        pid: child.pid,
        services: [{ name: "web", pid: child.pid, host: "127.0.0.1", port, up: true }],
      });
      const r = derive(root, derivationBlock());
      assert.equal(r.code, 1, "a derived-but-refused address must not read as a derivation");
      assert.match(r.stderr, /FAIL=no-reachable-serve-address/);
      const row = candidateRow(r.stderr, child.pid);
      assert.ok(row, `candidate ${child.pid} must be attributed: ${r.stderr}`);
      assert.match(row, new RegExp(`addr=127\\.0\\.0\\.1:${port}\\b`));
      assert.match(row, /cause=derived-from-carrier-fetch-failed\(connection-refused\)/);
      assert.doesNotMatch(r.stderr, /FAIL=no-derivable-serve-address/);
    },
  );
});

test("no serve process at all: the verbatim no-running-serve-instance branch, with the report", async () => {
  const children = [];
  await withFixture(
    children,
    [],
    async (root) => {
      children.push(spawnNotAServe(root));
      const r = derive(root, derivationBlock());
      assert.equal(r.code, 1);
      assert.equal(r.stdout, "", "the refusal must exit before the post-block echoes");
      assert.match(r.stderr, /CAUSE=no-running-serve-instance -- no quay\.ts serve process with cwd=/);
      // The report is printed on this branch too: a candidate that derived nothing still carries its
      // own cause, so "no serve instance" is a reading rather than an assertion (hard rule 4).
      assert.match(r.stderr, /AC-294 candidate readings \(cwd=[^\n]*, nserve=0, ncand=[1-9][0-9]*, nderived=0\)/);
      assert.match(
        r.stderr,
        new RegExp(`pid=${children[0].pid} addr=- cause=argv-no-serve-subcommand,carrier-absent`),
      );
      // "no serve instance" must not be conflated with "the address could not be derived".
      assert.doesNotMatch(r.stderr, /FAIL=/);
    },
  );
});

// ── ⑤ the amendment re-anchored ONE step: the eleven CAUSE branches survived ─────────────────────

test("the eleven pre-amendment CAUSE branches are present and the count is unchanged", () => {
  const text = criterionText();
  const lines = text.split("\n").filter((l) => l.includes("CAUSE="));
  assert.equal(lines.length, 11, `expected exactly 11 CAUSE= lines, got ${lines.length}:\n${lines.join("\n")}`);
  const tokens = [
    "CAUSE=no-running-serve-instance",
    "CAUSE=en-fetch-failed",
    "CAUSE=zh-fetch-failed",
    "CAUSE=no-nav-region ",
    "CAUSE=no-nav-region-zh",
    "CAUSE=english-baseline-missing",
    "CAUSE=no-title-tag ",
    "CAUSE=html-lang-not-zh",
    "CAUSE=nav-label-untranslated",
    "CAUSE=no-title-tag-zh",
    "CAUSE=title-unchanged",
  ];
  for (const t of tokens) {
    assert.ok(
      lines.some((l) => l.includes(t)),
      `the re-anchor dropped the pre-existing refusal branch ${t}`,
    );
  }
});
