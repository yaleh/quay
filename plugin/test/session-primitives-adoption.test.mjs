// @test-group engine
// session-primitives-adoption.test.mjs — did the four shared session primitives actually get ADOPTED
// by this repo, or were they merely copied in? (tasks/gap-ac253-session-primitives-shared-layer-adoption.)
//
// WHY THIS TEST IS STRONGER THAN THE AC-253 CRITERION: the criterion's consumer half is
// `git grep -l -E "(pty-frame|delivery-audit|session-liveness|session-schema)" -- packages/quay/src
// plugin/scripts` and then only requires the result to be NON-EMPTY. So one name appearing once in
// one non-test file satisfies it — copy four modules in, import one, and the machine criterion is
// green while the other three are vendored dead code. SPEC §3.3's intent (GOAL risk 3: 「「有消费者」
// 这一半是防伪」) is that EACH module is really used. This test asks it per module, and rejects the
// two fake shapes AC3 names: the module's own header comment mentioning itself, and a SIBLING
// primitive importing it (delivery-audit.mjs → pty-frame.mjs proves nothing about this repo).
//
// Run: node --test plugin/test/session-primitives-adoption.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PRIMITIVES_REL = "packages/quay/src/primitives";
const PRIMITIVES_ABS = path.join(REPO_ROOT, PRIMITIVES_REL);
const MANIFEST_ABS = path.join(REPO_ROOT, "plugin", "scripts", "primitives-drift-manifest.json");

const MODULES = ["pty-frame.mjs", "delivery-audit.mjs", "session-liveness.mjs", "session-schema.mjs"];

/**
 * The pinned expectations, per module. Enumerated on purpose: a discovered-only check would silently
 * shrink to nothing if a consumer were deleted, and this test must FAIL when a module loses its last
 * real consumer (that is the "vendored dead code" state the criterion is meant to catch).
 */
const EXPECTED_CONSUMERS = {
  "delivery-audit.mjs": ["packages/quay/src/serve-send.ts"],
  "session-liveness.mjs": [
    "packages/quay/src/observation.ts",
    "plugin/scripts/orphan-session-check.ts",
    "plugin/scripts/peer-identity-probe.ts",
    "plugin/scripts/inner-blocked-signal.ts",
  ],
  "session-schema.mjs": ["packages/quay/src/observation.ts"],
};

/**
 * The modules that must have ≥1 DIRECT non-test importer under the search dirs.
 *
 * ⚠️ AMENDED, not silently dropped: `pty-frame.mjs` is deliberately absent. AC-253's criterion was
 * strengthened on 2026-09-13T15:35Z (goals/AC-253-….md) to require that the hand-written socket in
 * `serve-send.ts` be RETIRED (「全仓只有一份」, SPEC §8-1) — and `serve-send.ts`'s L2 lane was exactly
 * the direct importer this map used to pin. Once the lane delegates to the shared, byte-identical
 * `deliverKeys()`, NO repo file imports the codec directly any more; the two requirements cannot both
 * hold. The replacement is the dedicated `AC3 — pty-frame` test below, which pins the PRODUCTION CALL
 * CHAIN (`send-to-session.ts --keys` → `serve-send.ts sendKeysToSession` → `deliverKeys`) AND the
 * byte-identity of the module that calls the codec — it fails if the chain is broken, so pty-frame
 * cannot rot into vendored dead code unnoticed. What is NOT claimed any more: a direct repo-side
 * import of `pty-frame.mjs`.
 */
const DIRECT_IMPORT_MODULES = ["delivery-audit.mjs", "session-liveness.mjs", "session-schema.mjs"];

const SEARCH_DIRS = ["packages/quay/src", "plugin/scripts"];

/** Every .ts/.mjs/.js file under the search dirs, excluding tests and the primitives dir itself. */
function candidateFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        walk(abs);
        continue;
      }
      if (!/\.(ts|mjs|js)$/.test(e.name)) continue;
      if (/\.test\.mjs$/.test(e.name)) continue;
      const rel = path.relative(REPO_ROOT, abs);
      if (rel.startsWith(PRIMITIVES_REL)) continue; // sibling modules never count (AC3)
      out.push(rel);
    }
  };
  for (const d of SEARCH_DIRS) walk(path.join(REPO_ROOT, d));
  return out;
}

/** Files that import `name` via a real module SPECIFIER (position-based, not a keyword hit). */
function importersOf(name) {
  const spec = new RegExp(`(?:from\\s*|import\\s*\\(\\s*)["'\`][^"'\`]*${name.replace(".", "\\.")}["'\`]`);
  return candidateFiles().filter((rel) => spec.test(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")));
}

test("AC2 — all four primitives are present at packages/quay/src/primitives/<name>.mjs", () => {
  for (const m of MODULES) {
    assert.ok(fs.existsSync(path.join(PRIMITIVES_ABS, m)), `${m} is present in the primitives dir`);
  }
});

test("AC3 — EACH module has ≥1 non-test consumer under packages/quay/src or plugin/scripts (4/4, not 'any non-empty')", () => {
  const report = {};
  for (const m of DIRECT_IMPORT_MODULES) {
    const found = importersOf(m);
    report[m] = found;
    assert.ok(found.length > 0, `${m} has NO non-test importer — it is vendored dead code, not adopted`);
    for (const expected of EXPECTED_CONSUMERS[m]) {
      assert.ok(
        found.includes(expected),
        `${m} must be imported by ${expected}; found: ${found.join(", ")}`,
      );
    }
  }
  // The negative control for the sibling exclusion: delivery-audit.mjs DOES import pty-frame.mjs, and
  // that must not be what satisfies pty-frame's requirement — a product/script file must be in there.
  for (const m of DIRECT_IMPORT_MODULES) {
    assert.ok(
      report[m].some((f) => f.startsWith("packages/quay/src/") || f.startsWith("plugin/scripts/")),
      `${m}: only sibling/primitive importers were found`,
    );
    assert.ok(
      !report[m].every((f) => f.startsWith(PRIMITIVES_REL)),
      `${m}: the primitives dir cannot be its own consumer`,
    );
  }
});

test("AC3 — pty-frame's production consumer after the amendment: the L2 keys lane, through the PINNED shared module", () => {
  // Replaces the direct-import arm for pty-frame.mjs (see DIRECT_IMPORT_MODULES above for why the two
  // AC-253 requirements are mutually exclusive). Every clause below CAN fail:
  //   1. the L2 lane still exists and IS the shared primitive (deleting the delegation ⇒ red),
  //   2. serve-send.ts opens no socket of its own (re-adding one ⇒ red — the duplicate AC-253 retired),
  //   3. the module that calls the codec is byte-identical to the pin (a fork ⇒ red),
  //   4. the codec really lives in that module (an encoder moved elsewhere ⇒ red).
  const serveSend = fs.readFileSync(path.join(REPO_ROOT, "packages/quay/src/serve-send.ts"), "utf8");
  assert.match(serveSend, /export function sendKeysToSession/, "the L2 keys lane is exported");
  assert.match(
    serveSend,
    /import \{[^}]*\bdeliverKeys\b[^}]*\} from "\.\/primitives\/delivery-audit\.mjs"/,
    "serve-send.ts imports the shared L2 delivery primitive",
  );
  assert.match(serveSend, /return deliverKeys\(\{/, "the lane IS deliverKeys — no second implementation");
  assert.doesNotMatch(serveSend, /createConnection/, "serve-send.ts opens no socket of its own");
  assert.doesNotMatch(serveSend, /from "node:net"/, "…and does not even import node:net");

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_ABS, "utf8"));
  const auditPath = path.join(PRIMITIVES_ABS, "delivery-audit.mjs");
  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync(auditPath)).digest("hex"),
    manifest.files["delivery-audit.mjs"],
    "the module that calls the frame codec is byte-identical to the pinned fleet blob",
  );
  const audit = fs.readFileSync(auditPath, "utf8");
  assert.match(audit, /encodeCtrl/, "the pinned module is the frame encoder (deliverKeys' auth + DATA)");
  assert.match(audit, /decodeFrames/, "…and the rejection decoder");
});

test("AC2 — every copy is byte-identical to the pinned quay-fleet blob (skipped, never faked, when the fleet repo is unreachable)", (t) => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_ABS, "utf8"));
  if (!fs.existsSync(manifest.fleetRepo)) {
    // Honest NOT-EVALUATED: the fleet checkout is not on this machine. ⛔ Do NOT pass — a green here
    // would assert byte-identity for a comparison that never happened (硬规则 3b / 4 推论三).
    t.skip(`fleet repo absent (${manifest.fleetRepo}) — byte-identity NOT-EVALUATED, not proven`);
    return;
  }
  const recorded = manifest.files;
  assert.deepEqual(Object.keys(recorded).sort(), [...MODULES].sort(), "the manifest pins exactly the four modules");
  for (const m of MODULES) {
    const localSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(PRIMITIVES_ABS, m))).digest("hex");
    assert.equal(localSha, recorded[m], `${m}: local copy matches the manifest pin`);
    let blob;
    try {
      blob = execFileSync("git", ["-C", manifest.fleetRepo, "show", `${manifest.fleetSha}:${manifest.fleetSourceDir}/${m}`], { maxBuffer: 16 * 1024 * 1024 });
    } catch (err) {
      t.skip(`pinned SHA ${manifest.fleetSha} unreadable in ${manifest.fleetRepo} — NOT-EVALUATED`);
      return;
    }
    const fleetSha = crypto.createHash("sha256").update(blob).digest("hex");
    assert.equal(fleetSha, recorded[m], `${m}: fleet blob at the pinned SHA matches the pin (no fork)`);
  }
});

test("AC3 — the replaced hand-written copies are GONE (0 hits each; the residual is named, not hidden)", () => {
  const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

  // 1. orphan-session-check.ts: the local field-22 parse (`tail[19]` after the LAST ')') is replaced.
  const orphan = read("plugin/scripts/orphan-session-check.ts");
  assert.equal((orphan.match(/tail\[19\]/g) ?? []).length, 0, "orphan-session-check: local field-22 parse removed");
  assert.match(orphan, /readProcStat/, "orphan-session-check: reads through the shared primitive");

  // 2. inner-blocked-signal.ts: the local `fs.statSync(<transcript>).mtimeMs` read is replaced.
  const inner = read("plugin/scripts/inner-blocked-signal.ts");
  assert.equal(
    (inner.match(/fs\.statSync\(transcriptPath\)\.mtimeMs/g) ?? []).length, 0,
    "inner-blocked-signal: local transcript-mtime read removed",
  );
  assert.match(inner, /readTranscriptMtime/, "inner-blocked-signal: reads the mtime through the shared primitive");

  // 3. peer-identity-probe.ts: the PRODUCTION path routes through the shared reader. The pure
  //    `parseProcStart(content)` helper deliberately REMAINS as the injectable test seam (the shared
  //    reader is pinned to the real /proc and offers no content-injection seam) — this assertion
  //    pins that it is no longer the production read.
  const probe = read("plugin/scripts/peer-identity-probe.ts");
  assert.match(probe, /io === \(fs as unknown as FactIo\)/, "peer-identity-probe: production path branches to the shared reader");
  assert.match(probe, /readProcStat/, "peer-identity-probe: imports the shared primitive");
});

test("AC3 — pty-frame's lane: the repo really has no pre-existing binary-frame consumer (the lane was built, not swapped)", () => {
  // The Plan's step-4 measurement, re-run as a test so the claim cannot silently rot. If a pty.sock
  // consumer ever appears in the repo this assertion flips, which is the signal that the lane below
  // should be re-pointed at it instead.
  // Measured against the tree BEFORE this task, not the working tree: the lane we added is itself a
  // pty.sock consumer, so searching today's files would report our own work as a pre-existing hit and
  // the assertion would be self-defeating. The base = the parent of the commit that ADDED
  // primitives/pty-frame.mjs; before that commit lands (i.e. while this test runs in the task
  // worktree) the tree at HEAD is still the base, which is the same measurement.
  const addCommit = execFileSync(
    "git", ["log", "--diff-filter=A", "--format=%H", "-1", "--", `${PRIMITIVES_REL}/pty-frame.mjs`],
    { cwd: REPO_ROOT, encoding: "utf8" },
  ).trim();
  const base = addCommit ? `${addCommit}^` : "HEAD";
  // `git grep` exits 1 on "no match" — which is the expected outcome here, so it must not be thrown
  // away as an error (nor silently read as "the grep failed": the two are distinguishable by status).
  let grep = "";
  try {
    grep = execFileSync("git", ["grep", "-l", "-E", "pty\\.sock|bg-pty-host", base, "--", "packages", "plugin"], { cwd: REPO_ROOT, encoding: "utf8" });
  } catch (err) {
    assert.equal(err.status, 1, `git grep failed for a reason other than 'no match': ${err.message}`);
  }
  const hits = grep.split("\n").filter((l) => l.trim());
  assert.equal(
    hits.length, 0,
    `no pre-existing pty.sock/bg-pty-host consumer expected in the base tree (${base}); found: ${hits.join(", ")}`,
  );
  // …and the lane that DOES exercise the frame codec is serve-send.ts's sendKeysToSession, which now
  // reaches it through the shared `deliverKeys` (the dedicated AC3 — pty-frame test below pins that
  // call chain and the pin). What must NOT be true any more is a second codec call site here.
  const serveSend = fs.readFileSync(path.join(REPO_ROOT, "packages/quay/src/serve-send.ts"), "utf8");
  assert.match(serveSend, /export function sendKeysToSession/, "the L2 keys lane is exported");
  assert.doesNotMatch(
    serveSend,
    /encodeCtrl|encodeData|decodeFrames/,
    "the frame codec lives in the shared primitive, not duplicated at this call site",
  );
});

test("AC3/AC6 — the shipped keys CLI really runs: --keys delivers /clear over a REAL unix socket", async () => {
  // This test exists because the production-carrier reading caught a bug no other test did: the
  // `--keys` block had been inserted ABOVE `const args = process.argv.slice(2)`, so the script died
  // with `ReferenceError: args is not defined` before reaching any of its own logic. A static
  // "the file mentions --keys" assertion would have passed. Only RUNNING it can tell.
  const net = await import("node:net");
  const { spawn, execFileSync } = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac253-keys-"));
  const sockPath = path.join(dir, "pty.sock");
  const frames = path.join(dir, "frames.jsonl");
  const audit = path.join(dir, "audit.jsonl");

  const received = [];
  const server = net.createServer((c) => {
    c.on("data", (b) => {
      const tag = b.readUInt8(4);
      received.push({ tag, payload: b.subarray(5).toString("utf8") });
      fs.appendFileSync(frames, JSON.stringify(received[received.length - 1]) + "\n");
      if (tag === 0) { c.end(); server.close(); }
    });
  });
  await new Promise((r) => server.listen(sockPath, r));

  const cli = path.join(REPO_ROOT, "plugin", "scripts", "send-to-session.ts");
  const rc = await new Promise((resolve) => {
    const p = spawn("node", ["--no-warnings", "--experimental-strip-types", cli, "--keys",
      "--sock", sockPath, "--token", "tok-test", "--audit", audit, "/clear"], { stdio: "ignore" });
    p.on("exit", (code) => resolve(code));
  });
  assert.equal(rc, 0, "the keys CLI exits 0 when the DATA frame is flushed with no rejection");
  assert.deepEqual(
    received.map((f) => f.tag), [1, 0],
    "a CTRL auth frame goes out first, then the DATA frame",
  );
  assert.equal(JSON.parse(received[0].payload).t, "auth", "the CTRL frame is the auth handshake");
  assert.equal(received[1].payload, "/clear", "the DATA frame carries the bytes UNMODIFIED");
  const record = JSON.parse(fs.readFileSync(audit, "utf8").trim());
  assert.equal(record.delivered, true, "the shared ledger records the successful delivery");
  assert.deepEqual(record.payloadSummary, { length: 6, sha256_12: record.payloadSummary.sha256_12, firstLine: "/clear" },
    "the ledger stores a payload SUMMARY (length + hash + first line), never the raw payload as the audit");

  // …and the failure path leaves a record too: an unreachable socket must NOT silently skip the ledger.
  const rc2 = await new Promise((resolve) => {
    const p = spawn("node", ["--no-warnings", "--experimental-strip-types", cli, "--keys",
      "--sock", path.join(dir, "no-such.sock"), "--audit", audit, "x"], { stdio: "ignore" });
    p.on("exit", (code) => resolve(code));
  });
  assert.equal(rc2, 4, "an unreachable socket is a delivery failure (exit 4), not a silent success");
  const lines = fs.readFileSync(audit, "utf8").trim().split("\n");
  assert.equal(lines.length, 2, "the FAILURE attempt also appended a ledger record — same write path");
  assert.equal(JSON.parse(lines[1]).delivered, false, "and it is truthfully recorded as not delivered");

  // The arg block is reachable and honest about its missing required input (the TDZ bug's own shape).
  const noSock = spawn("node", ["--no-warnings", "--experimental-strip-types", cli, "--keys"], { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  noSock.stderr.on("data", (d) => { err += d.toString(); });
  const rc3 = await new Promise((resolve) => noSock.on("exit", (code) => resolve(code)));
  assert.equal(rc3, 2, "--keys without --sock is a usage error (exit 2)");
  assert.match(err, /--sock/, "and it says which argument is missing");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("AC5 负控制 — a FOLDED session record is rejected; the two-dimension record is accepted", async () => {
  const { validateSessionRecord } = await import(
    path.join(PRIMITIVES_ABS, "session-schema.mjs")
  );

  // The AC-001 counter-example, in THIS repo's vocabulary: one top-level `status` standing in for
  // both dimensions. This is the exact fold `claude agents --json` performs (registry `shell` folded
  // into `busy`) and the exact fold this repo's session surface used to render (`alive: boolean`).
  const folded = {
    status: "busy",
    sessionKeyScope: "local-only",
    lifecycle: { value: "working", source: "registry row", observedAt: 1 },
    activity: { value: "busy", source: "registry row", ageSec: 0 },
  };
  const bad = validateSessionRecord(folded);
  assert.equal(bad.valid, false, "a folded top-level `status` must be invalid");
  assert.ok(bad.errors.some((e) => /folded top-level `status`/.test(e)), `the refusal names the fold: ${bad.errors.join(" | ")}`);

  // Drop the fold and supply both dimensions with their own source + timestamp ⇒ valid.
  const { status, ...unfolded } = folded;
  assert.equal(status, "busy", "fixture sanity: the field really was removed");
  const good = validateSessionRecord(unfolded);
  assert.equal(good.valid, true, `the two-dimension record must be valid; errors: ${good.errors.join(" | ")}`);

  // A third reading, so the validator cannot be a constant: dropping ONE dimension's source is
  // invalid too — the value set alone is not what it checks.
  const noSource = { ...unfolded, lifecycle: { ...unfolded.lifecycle, source: "" } };
  assert.equal(validateSessionRecord(noSource).valid, false, "a dimension without a source is invalid");
});

test("AC3-adjacent — an UNUSABLE ledger never crashes a lane: L1 falls back, L2 refuses with a reason", async () => {
  // The shared lanes append a ledger record on EVERY exit path (their contract) and that append is
  // NOT best-effort — it throws from inside a socket callback, i.e. an UNCAUGHT exception. Since the
  // L1/L2 lanes delegate to them, an unusable ledger could otherwise kill `quay serve` (or a CLI) with
  // a stack and no verdict. These two assertions pin the pre-flight check that prevents it: this is a
  // regression guard for the delegation THIS task introduced, and both halves can fail.
  const net = await import("node:net");
  const { spawn } = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac253-ledger-"));
  const blocker = path.join(dir, "not-a-dir");
  fs.writeFileSync(blocker, "x"); // ENOTDIR parent ⇒ the ledger file cannot be created or written
  const badLedger = path.join(blocker, "audit.jsonl");

  // ── L1: real socket + unusable caller ledger ⇒ the DELIVERY still happens (job #1 wins over
  //        bookkeeping; the record degrades to the documented default). ──────────────────────────
  const { sendSessionFrames } = await import(path.join(REPO_ROOT, "packages/quay/src/serve-send.ts"));
  const sockPath = path.join(dir, "messaging.sock");
  const got = [];
  const srv = net.createServer((c) => c.on("data", (b) => got.push(b)));
  await new Promise((r) => srv.listen(sockPath, r));
  const res = await sendSessionFrames({
    sockPath, token: "t", text: "hi", fromName: "probe", auditLogPath: badLedger,
  });
  await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => srv.close(r));
  assert.equal(res.ok, true, "an unusable ledger must not block the delivery (L1 falls back)");
  assert.ok(
    Buffer.concat(got).toString("utf8").includes('"type":"auth"'),
    "and the frames really went out over the socket",
  );

  // ── L2: the shipped CLI with an unusable --audit ⇒ an ordinary failure exit that SAYS WHY,
  //        never exit 1 with a Node stack. ───────────────────────────────────────────────────────
  const cli = path.join(REPO_ROOT, "plugin", "scripts", "send-to-session.ts");
  const run = await new Promise((resolve) => {
    const p = spawn("node", ["--no-warnings", "--experimental-strip-types", cli, "--keys",
      "--sock", sockPath, "--audit", badLedger, "/clear"], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.on("exit", (code) => resolve({ code, err }));
  });
  assert.equal(run.code, 4, `an unusable ledger is an ordinary delivery failure (exit 4), got ${run.code}`);
  assert.match(run.err, /audit ledger not writable/, "and it names the reason");
  assert.doesNotMatch(run.err, /Uncaught|Node\.js v/, "⛔ no uncaught-exception crash");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("AC5 — observation.ts runs the validator at its output boundary and refuses to render a folded record", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "packages/quay/src/observation.ts"), "utf8");
  // The consumer is a real gate, not an import kept for show: the validator's verdict decides
  // whether `session` is attached, and the refusal carries the validator's own reasons.
  assert.match(src, /validateSessionRecord\(/, "observation.ts calls the shared validator");
  assert.match(src, /sessionRefusal: verdict\.errors/, "a refused record carries the validator's reasons");
  const sessions = fs.readFileSync(path.join(REPO_ROOT, "packages/quay/src/serve-sessions.ts"), "utf8");
  // gap-webui-sessions-body-copy-en-zh: the refusal FRAME's copy left this file for serve-i18n.ts
  // ROW 15 (`refusedStateRecord`, zh column byte-equal to the literal pinned here before). The
  // assertion FOLLOWS THE COPY — two reads, both in code position (`refusedStateRecord` occurs
  // exactly once in serve-sessions.ts, in the render expression) — instead of pinning the
  // pre-localization source form, which is precisely what this localization removed.
  assert.match(sessions, /refusedStateRecord/, "the render surface resolves the refusal frame row");
  const i18n = fs.readFileSync(path.join(REPO_ROOT, "packages/quay/src/serve-i18n.ts"), "utf8");
  assert.match(i18n, /状态记录不可用/, "and that row's zh column still carries the refusal wording");
});
