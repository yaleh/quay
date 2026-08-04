// @test-group governance
// heavy-op-token-events.test.mjs — gap-token-wait-times-are-printed-once-and-never-landed. Pins the
// events landing added to plugin/scripts/heavy-op-token.sh: every acquire appends one JSONL record to
// the workspace's `.quay/heavy-op-token-events.jsonl` (same family as gate-events.jsonl), on the
// success AND timeout paths, without ever becoming a new single point of failure for the token.
//
//   AC1 — every acquire lands exactly one record with waited_ms + acquired (3 acquires -> 3 lines)
//   AC2 — a REAL queue (token held) lands a waited_ms that matches the actual wait (value, not field
//         existence — a waited_ms pinned at zero satisfies an existence-only assertion)
//   AC3 — the timeout/failure path also lands (acquired=no)
//   AC4 — negative control: an unwritable events target must NOT fail the acquire (observation is
//         never a new single point of failure for the global single-flight token)
//   AC5 — .gitignore ignores the events file in the same form as gate-events.jsonl
//   AC6 — the --report command shows count/median/p90/max on real data; below the sample threshold it
//         says 「样本 N 不足」 instead of printing a pretty zero
//   AC7 — node:test + `// @test-group governance` (governance = the metering/measurement layer; the
//         existing engine-tagged heavy-op-token.test.mjs keeps its engine group and AC10 pin)
//
// Governance-tagged files self-skip in the default product+engine full suite by design (see
// scripts/test.sh); run this file explicitly or with `--group governance`. The landing code path is
// STILL exercised in the default suite because the engine-tagged heavy-op-token.test.mjs now routes
// every acquire through --events-file.
//
// Run: node --test plugin/test/heavy-op-token-events.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TOKEN = path.join(REPO_ROOT, "plugin", "scripts", "heavy-op-token.sh");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const makeTmp = (prefix = "heavy-op-token-events-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Run the REAL token script with an isolated state root + events file (never the real defaults). */
function runToken(args, { root, eventsFile, env = {} } = {}) {
  const fullArgs = [
    ...(root ? ["--root", root] : []),
    ...(eventsFile ? ["--events-file", eventsFile] : []),
    ...args,
  ];
  const res = spawnSync("bash", [TOKEN, ...fullArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, all: `${res.stdout}\n${res.stderr}` };
}

const readRecords = (events) =>
  fs.readFileSync(events, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

// ── AC1: every acquire lands one record ────────────────────────────────────────────────────────────────
test("AC1 — every acquire lands one JSONL record with waited_ms + acquired (3 acquires -> 3 lines)", () => {
  const root = makeTmp();
  const events = path.join(root, "events.jsonl");
  try {
    for (let i = 0; i < 3; i++) {
      const r = runToken(["--acquire", "probe", "--timeout", "0"], { root, eventsFile: events });
      assert.equal(r.status, 0, `acquire ${i} failed:\n${r.all}`);
      runToken(["--release", "probe"], { root, eventsFile: events });
    }
    const records = readRecords(events);
    assert.equal(records.length, 3, `expected 3 landed records, got ${records.length}: ${JSON.stringify(records)}`);
    for (const rec of records) {
      assert.equal(typeof rec.waited_ms, "number");
      assert.equal(rec.acquired, "yes");
      assert.equal(rec.project, "probe");
      assert.equal(rec.outcome, "acquired");
      assert.equal(rec.holder, "probe");
      assert.ok(rec.ts > 0, "ts must be a real epoch-ms timestamp");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC2: a real queue lands a waited_ms that matches the actual wait ───────────────────────────────────
test("AC2 — a REAL queue lands a waited_ms matching the actual wait (value, not field existence)", async () => {
  const root = makeTmp();
  const events = path.join(root, "events.jsonl");
  let holder;
  try {
    // Holder acquires the token, then sleeps ~2s and EXITS without releasing — the token's recorded
    // pid (the bash -c's own pid) dies naturally: a crash, not a clean release. (A setTimeout-based
    // kill would never fire: runToken uses spawnSync, which blocks the event loop.)
    holder = spawn("bash", ["-c", `"${TOKEN}" --root "${root}" --events-file "${events}" --acquire block --timeout 0 && sleep 2`]);
    const tokenPath = path.join(root, "heavy-op", "token");
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(tokenPath) && Date.now() < deadline) await sleep(20);
    assert.ok(fs.existsSync(tokenPath), "holder must hold the token before the waiter starts");

    // Waiter polls with a bounded wait. At ~2s the holder dies; with STALE_TIMEOUT_S=1 the next poll
    // (dead pid + stale mtime) reclaims and the waiter acquires. The landed waited_ms must reflect the
    // real seconds the waiter spent, not a pinned 0.
    const t0 = Date.now();
    const r = runToken(["--acquire", "waiter", "--timeout", "6"], {
      root,
      eventsFile: events,
      env: { HEAVY_OP_STALE_TIMEOUT_S: "1" },
    });
    const wallMs = Date.now() - t0;

    assert.equal(r.status, 0, `waiter must acquire after the holder dies + reclaim:\n${r.all}`);
    const rec = readRecords(events).find((l) => l.project === "waiter" && l.acquired === "yes");
    assert.ok(rec, "the waiter's landed record must exist");
    assert.ok(rec.waited_ms >= 900, `waited_ms ${rec.waited_ms} must reflect the ~2s real wait, not 0`);
    assert.ok(Math.abs(rec.waited_ms - wallMs) < 1500, `waited_ms ${rec.waited_ms} must roughly match wall ${wallMs}`);
    assert.equal(rec.outcome, "acquired");
  } finally {
    if (holder) holder.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC3: the timeout/failure path also lands ───────────────────────────────────────────────────────────
test("AC3 — the timeout/failure path also lands (acquired=no)", () => {
  const root = makeTmp();
  const events = path.join(root, "events.jsonl");
  try {
    const a = runToken(["--acquire", "quay", "--timeout", "0"], { root, eventsFile: events });
    assert.equal(a.status, 0, `A acquire failed:\n${a.all}`);
    const b = runToken(["--acquire", "meta-cc", "--timeout", "0"], { root, eventsFile: events });
    assert.equal(b.status, 1, `B must fail while A holds:\n${b.all}`);

    const rec = readRecords(events).find((l) => l.acquired === "no");
    assert.ok(rec, "the failed acquire must land a record");
    assert.equal(rec.acquired, "no");
    assert.equal(rec.outcome, "timeout");
    assert.equal(rec.project, "meta-cc");
    assert.equal(rec.waited_ms, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC4: negative control — unwritable landing target never fails the acquire ─────────────────────────
test("AC4 — an unwritable events target must NOT fail the acquire (observation is never a single point of failure)", () => {
  const root = makeTmp();
  try {
    // A regular FILE where the events directory should be makes `mkdir -p` fail deterministically.
    const blocker = path.join(root, ".quay");
    fs.mkdirSync(path.dirname(blocker), { recursive: true });
    fs.writeFileSync(blocker, "i am a file, not a directory");
    const events = path.join(blocker, "heavy-op-token-events.jsonl");

    const r = runToken(["--acquire", "quay", "--timeout", "0"], { root, eventsFile: events });
    assert.equal(r.status, 0, `acquire must succeed even when landing is impossible:\n${r.all}`);
    assert.match(r.stdout, /acquired=yes/);
    assert.equal(fs.existsSync(events), false, "nothing may be written to the blocked path");
    runToken(["--release", "quay"], { root, eventsFile: events });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC5: .gitignore in the same form as gate-events.jsonl ─────────────────────────────────────────────
test("AC5 — .gitignore ignores the events file in the same form as gate-events.jsonl", () => {
  const gi = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  const gateIdx = gi.indexOf("**/.quay/gate-events.jsonl");
  const eventsIdx = gi.indexOf("**/.quay/heavy-op-token-events.jsonl");
  assert.ok(gateIdx !== -1, "the gate-events.jsonl ignore line must still exist");
  assert.ok(eventsIdx !== -1, "the heavy-op-token-events.jsonl ignore line must exist");
  // Same form: both are top-level `**/.quay/<name>` globs (not anchored differently).
  assert.match(gi, /^\*\*\/\.quay\/heavy-op-token-events\.jsonl$/m);
});

// ── AC6: --report gives a real distribution; below threshold it says 样本不足 ──────────────────────────
test("AC6 — --report: below the threshold says 样本 N 不足 (refuses a pretty zero); at/above it prints count/median/p90/max", () => {
  const root = makeTmp();
  const events = path.join(root, "events.jsonl");
  try {
    for (let i = 0; i < 3; i++) {
      const r = runToken(["--acquire", "probe", "--timeout", "0"], { root, eventsFile: events });
      assert.equal(r.status, 0);
      runToken(["--release", "probe"], { root, eventsFile: events });
    }
    const small = runToken(["--report"], { root, eventsFile: events });
    assert.equal(small.status, 0, `--report must exit 0:\n${small.all}`);
    assert.match(small.stdout, /样本 3 不足/);
    assert.doesNotMatch(small.stdout, /median_ms=/, "no distribution may be printed below the threshold");

    for (let i = 0; i < 7; i++) {
      const r = runToken(["--acquire", "probe", "--timeout", "0"], { root, eventsFile: events });
      assert.equal(r.status, 0);
      runToken(["--release", "probe"], { root, eventsFile: events });
    }
    const big = runToken(["--report"], { root, eventsFile: events });
    assert.equal(big.status, 0, `--report must exit 0:\n${big.all}`);
    assert.match(big.stdout, /count=10/);
    assert.match(big.stdout, /median_ms=\d+ p90_ms=\d+ max_ms=\d+/, "the distribution must compute real numbers");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
