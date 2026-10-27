// @test-group product
// gap-goal-list-no-thin-projection-no-since — the incremental / thin goal read surfaces.
//
// THE COST + THE AMBIGUITY THIS CLOSES:
//   `quay goal list --json` returns the FULL Provider view-model (body / criterion / expect /
//   origin / statusLog). An external read-only consumer measured 786ms / 1.28MB for 397 rows, almost
//   all of it fields it never renders; and `--since` did not exist at all, so a poller had to
//   re-read everything to learn that nothing changed.
//
//   ⛔ The subtle half is what an EMPTY answer means. A missing `goals/` directory reads as `[]` —
//   indistinguishable from "read the carrier, nothing changed". The store's constructor mkdirs the
//   directory, so the provider cannot answer the question after the fact; the CLI probes the carrier
//   BEFORE it connects (AC4).
//
// AC1 — thin projection (allow-list; statusLog only on request), with the full record as CONTROL so
//       the absence assertions are not vacuous.
// AC2 — `--since` on carrier mtime, BOTH directions: a known instant before a record's mtime is
//       filtered out; after it, the record appears. ISO and epoch-ms forms agree.
// AC3 — `goal log` merges every record's own statusLog: count == the sum of the per-record lengths,
//       ascending by `at`, exact field set.
// AC4 — three-state: missing/unreadable carrier ⇒ {evaluated:false} + exit 3, vs an EMPTY carrier ⇒
//       `[]` + exit 0. The two readings must differ.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NATIVE_PROVIDER_DIR = path.resolve(__dirname, "../../quay-native");

const _created = [];
function tmpDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `goal-read-surface-${tag}-`));
  _created.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of _created) fs.rmSync(dir, { recursive: true, force: true });
});

// Fixed instants — the fixture's mtimes AND its statusLog `at` values both use these, so every
// assertion is a statement about the CLI's filter, not about when the test happened to run.
const OLD_MTIME = Date.parse("2026-10-01T00:00:00.000Z");
const CUT = Date.parse("2026-10-15T00:00:00.000Z");
const NEW_MTIME = Date.parse("2026-10-20T00:00:00.000Z");
const ISO = (ms) => new Date(ms).toISOString();

// Long fields on purpose: this is the payload the thin surface must NOT carry, and a short fixture
// would make the byte-ratio reading meaningless.
const LONG_BODY =
  "fixture goal body — background, scope, non-goals and exit conditions. " + "x".repeat(600);
const LONG_CRITERION = `node -e 'console.log(${JSON.stringify("criterion".repeat(40))})'`;
const LONG_EXPECT = "the expected outcome this criterion proves. " + "y".repeat(300);

/** One carrier file, written as the markdown+YAML the store reads. `statusLog` is the append-only
 *  history the store itself writes on a status flip — seeded literally so `at` is controlled. */
function writeRecord(goalsDir, rec, { mtimeMs }) {
  const lines = ["---", `id: ${rec.id}`, `title: ${JSON.stringify(rec.title)}`, `status: ${rec.status}`, `kind: ${rec.kind}`];
  if (rec.goal) lines.push(`goal: ${rec.goal}`);
  if (rec.criterion) lines.push(`criterion: ${JSON.stringify(rec.criterion)}`);
  if (rec.expect) lines.push(`expect: ${JSON.stringify(rec.expect)}`);
  lines.push(`origin: ${JSON.stringify("fixture")}`);
  if (rec.statusLog && rec.statusLog.length > 0) {
    lines.push("statusLog:");
    for (const e of rec.statusLog) {
      lines.push(`  - at: ${JSON.stringify(e.at)}`);
      lines.push(`    from: ${JSON.stringify(e.from)}`);
      lines.push(`    to: ${JSON.stringify(e.to)}`);
      lines.push(`    actor: ${JSON.stringify(e.actor)}`);
      lines.push(`    reason: ${JSON.stringify(e.reason)}`);
    }
  }
  lines.push("---", rec.body ?? LONG_BODY, "");
  const file = path.join(goalsDir, `${rec.id}-fixture.md`);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
}

/**
 * A REAL workspace: `.quay/config.yml` naming the native Provider (absolute paths), a `tasks/` dir,
 * and a `goals/` carrier holding one GOAL + two ACs with controlled mtimes and status histories.
 */
function seedWorkspace(tag, { withGoals = true } = {}) {
  const root = tmpDir(tag);
  const tasksDir = path.join(root, "tasks");
  const goalsDir = path.join(root, "goals");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  if (withGoals) fs.mkdirSync(goalsDir, { recursive: true });

  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: ${JSON.stringify(NATIVE_PROVIDER_DIR)}`,
      `    tasks_dir: ${JSON.stringify(tasksDir)}`,
      `    mcp_entry: ["node", ${JSON.stringify(QUAY_NATIVE_CLI)}, "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: ${JSON.stringify(tasksDir)}`,
      "",
    ].join("\n"),
    "utf8"
  );

  if (!withGoals) return { root, goalsDir };

  // AC-first (a GOAL cannot be born into {draft, active} with zero ACs) — then the GOAL, then the
  // one record whose mtime is AFTER the cut point so AC2 has both directions in one fixture.
  writeRecord(goalsDir, {
    id: "GOAL-001", title: "seeded goal", status: "active", kind: "goal", body: LONG_BODY,
    statusLog: [
      { at: "2026-09-01T00:00:00.000Z", from: "draft", to: "active", actor: "fixture", reason: "seed activation" },
    ],
  }, { mtimeMs: OLD_MTIME });
  writeRecord(goalsDir, {
    id: "AC-001", title: "old criterion", status: "achieved", kind: "criterion", goal: "GOAL-001",
    criterion: LONG_CRITERION, expect: LONG_EXPECT,
    statusLog: [
      { at: "2026-09-01T00:00:00.000Z", from: "draft", to: "active", actor: "goal-driver", reason: "activate" },
      { at: "2026-09-10T00:00:00.000Z", from: "active", to: "achieved", actor: "goal-driver", reason: "I2: criterion pass" },
    ],
  }, { mtimeMs: OLD_MTIME });
  writeRecord(goalsDir, {
    id: "AC-002", title: "new criterion", status: "draft", kind: "criterion", goal: "GOAL-001",
    criterion: "true", expect: LONG_EXPECT,
    statusLog: [
      { at: "2026-10-20T00:00:00.000Z", from: "draft", to: "active", actor: "fixture", reason: "late change" },
    ],
  }, { mtimeMs: NEW_MTIME });

  return { root, goalsDir };
}

function runGoal(root, args) {
  const r = spawnSync("node", [QUAY_CLI, "goal", ...args, "--root", root], {
    cwd: root,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const ids = (rows) => rows.map((g) => String(g.id)).sort();
const hasKey = (row, key) => Object.prototype.hasOwnProperty.call(row, key);

// ── AC1 — the thin projection is an ALLOW-LIST, and statusLog is opt-in ─────────────────────────
test("AC1: `goal list --json --no-body` keeps ONLY id/title/status/kind/goal/updatedAt", () => {
  const { root } = seedWorkspace("ac1");

  const full = runGoal(root, ["list", "--json", "--no-evidence"]);
  assert.equal(full.status, 0, `control run exits 0 (stderr: ${full.stderr.slice(0, 500)})`);
  const fullRows = JSON.parse(full.stdout);

  const thin = runGoal(root, ["list", "--json", "--no-evidence", "--no-body"]);
  assert.equal(thin.status, 0, `--no-body exits 0 (stderr: ${thin.stderr.slice(0, 500)})`);
  const thinRows = JSON.parse(thin.stdout);

  // Same record set — the flag changes the projection, never WHICH records are read.
  assert.deepEqual(ids(thinRows), ids(fullRows), "the thin id set equals the full id set");
  assert.ok(thinRows.length >= 3, `fixture yields all records (got ${JSON.stringify(ids(thinRows))})`);

  const ALLOWED = new Set(["id", "title", "status", "kind", "goal", "updatedAt"]);
  for (const row of thinRows) {
    for (const key of Object.keys(row)) {
      assert.ok(ALLOWED.has(key), `${row.id} carries ONLY allow-listed keys (unexpected: ${key})`);
    }
    for (const key of ["body", "criterion", "expect", "origin", "statusLog"]) {
      assert.ok(!hasKey(row, key), `${row.id} carries no \`${key}\` under --no-body`);
    }
  }
  assert.ok(!thin.stdout.includes("non-goals and exit conditions"), "the body text is absent from the thin stdout");
  assert.ok(!/"criterion"\s*:/.test(thin.stdout), "no serialised criterion key");

  // CONTROL (hard rule 4): the SAME fixture produces every one of those fields without the flag.
  // Without this half the absences above would also pass on an empty/degenerate fixture.
  const fullById = Object.fromEntries(fullRows.map((g) => [String(g.id), g]));
  assert.ok(hasKey(fullById["AC-001"], "criterion"), "control: AC-001 carries `criterion` without --no-body");
  assert.ok(hasKey(fullById["AC-001"], "expect"), "control: AC-001 carries `expect` without --no-body");
  assert.ok(hasKey(fullById["AC-001"], "origin"), "control: AC-001 carries `origin` without --no-body");
  assert.ok(hasKey(fullById["AC-001"], "body"), "control: AC-001 carries `body` without --no-body");
  assert.ok(hasKey(fullById["AC-001"], "statusLog"), "control: AC-001 carries `statusLog` without --no-body");

  // --with-status-log opts the ONE long field back in, and nothing else.
  const withLog = runGoal(root, ["list", "--json", "--no-evidence", "--no-body", "--with-status-log"]);
  assert.equal(withLog.status, 0, `--with-status-log exits 0 (stderr: ${withLog.stderr.slice(0, 500)})`);
  const withLogRows = JSON.parse(withLog.stdout);
  const logById = Object.fromEntries(withLogRows.map((g) => [String(g.id), g]));
  assert.ok(Array.isArray(logById["AC-001"].statusLog), "--with-status-log restores AC-001's statusLog");
  assert.equal(logById["AC-001"].statusLog.length, 2, "the restored history is the record's own two entries");
  for (const key of ["body", "criterion", "expect", "origin"]) {
    assert.ok(!hasKey(logById["AC-001"], key), `--with-status-log still omits \`${key}\` (it is not a history field)`);
  }

  // The byte claim the task quotes: the thin projection is a small fraction of the full read.
  const thinBytes = Buffer.byteLength(thin.stdout, "utf8");
  const fullBytes = Buffer.byteLength(full.stdout, "utf8");
  assert.ok(
    thinBytes <= fullBytes * 0.4,
    `thin output is ≤40% of the full read (thin=${thinBytes}B full=${fullBytes}B ratio=${(thinBytes / fullBytes).toFixed(3)})`,
  );
});

// ── AC2 — --since on the carrier mtime, read in BOTH directions ─────────────────────────────────
test("AC2: `goal list --since` keeps records at/after the instant and drops those before it", () => {
  const { root } = seedWorkspace("ac2");

  // Direction B (before the cut): AC-002's mtime is 2026-10-20, AC-001/GOAL-001 are 2026-10-01.
  const after = runGoal(root, ["list", "--json", "--no-evidence", "--no-body", "--since", ISO(CUT)]);
  assert.equal(after.status, 0, `--since exits 0 (stderr: ${after.stderr.slice(0, 500)})`);
  assert.deepEqual(ids(JSON.parse(after.stdout)), ["AC-002"], "only the record modified AFTER the cut appears");

  // Direction A (before every record): a past instant must still show them all — the filter cannot
  // silently under-report, which is the direction that loses work.
  const all = runGoal(root, ["list", "--json", "--no-evidence", "--no-body", "--since", ISO(Date.parse("2026-09-01T00:00:00.000Z"))]);
  assert.equal(all.status, 0, `past --since exits 0 (stderr: ${all.stderr.slice(0, 500)})`);
  assert.deepEqual(ids(JSON.parse(all.stdout)), ["AC-001", "AC-002", "GOAL-001"], "a past instant keeps every record");

  // After every record: the honest "nothing changed" reading is a real empty array from a READ
  // carrier (AC4 makes the unreadable case a different value).
  const none = runGoal(root, ["list", "--json", "--no-evidence", "--no-body", "--since", ISO(Date.parse("2026-11-01T00:00:00.000Z"))]);
  assert.equal(none.status, 0, `future --since exits 0 (stderr: ${none.stderr.slice(0, 500)})`);
  assert.deepEqual(JSON.parse(none.stdout), [], "an instant after every mtime yields an empty list");

  // epoch-ms is the SAME reading the list itself prints — feeding it back must agree with the ISO
  // form (no timezone round-trip in between).
  const epoch = runGoal(root, ["list", "--json", "--no-evidence", "--no-body", "--since", String(CUT)]);
  assert.equal(epoch.status, 0, `epoch-ms --since exits 0 (stderr: ${epoch.stderr.slice(0, 500)})`);
  assert.deepEqual(JSON.parse(epoch.stdout), JSON.parse(after.stdout), "epoch-ms and ISO forms select the same records");

  // An unparseable value is a USAGE error (2), never a silent "no filter" — which would return the
  // whole board and look like a successful read.
  const bad = runGoal(root, ["list", "--json", "--no-body", "--since", "not-a-time"]);
  assert.equal(bad.status, 2, `a malformed --since is a usage error (got ${bad.status})`);
  assert.match(bad.stderr, /--since/);
});

// ── AC3 — the merged cross-record status history ────────────────────────────────────────────────
test("AC3: `goal log --json` returns every statusLog entry, ascending, count == sum of the per-record logs", () => {
  const { root, goalsDir } = seedWorkspace("ac3");

  const r = runGoal(root, ["log", "--json"]);
  assert.equal(r.status, 0, `goal log exits 0 (stderr: ${r.stderr.slice(0, 500)})`);
  const entries = JSON.parse(r.stdout);

  // The count claim, computed from the CARRIER (not from the command): GOAL-001 has 1, AC-001 has 2,
  // AC-002 has 1 ⇒ 4. Reading the fixture files keeps this assertion independent of the merge code.
  const summed = fs
    .readdirSync(goalsDir)
    .filter((f) => f.endsWith(".md"))
    .reduce((n, f) => n + (fs.readFileSync(path.join(goalsDir, f), "utf8").match(/^\s*- at:/gm) ?? []).length, 0);
  assert.equal(summed, 4, `fixture carries 4 statusLog entries (got ${summed})`);
  assert.equal(entries.length, summed, "returned rows == sum of every record's statusLog length");

  // Ascending by `at` — the whole point of a merged stream.
  for (let i = 1; i < entries.length; i++) {
    assert.ok(Date.parse(entries[i - 1].at) <= Date.parse(entries[i].at), `row ${i} is not before row ${i - 1}`);
  }

  // Exact field set (AC3 names it) + the record each transition belongs to.
  assert.deepEqual(
    Object.keys(entries[0]).sort(),
    ["actor", "at", "from", "goal", "id", "kind", "reason", "to"],
    "every row carries exactly {id,goal,kind,at,from,to,actor,reason}",
  );
  // GOAL-001's activation and AC-001's activation share one instant (2026-09-01T00:00:00.000Z), so
  // the documented id tie-break orders them AC-001 first — same-instant transitions stay grouped and
  // the order is deterministic rather than dependent on the carrier walk.
  assert.deepEqual(entries.map((e) => e.id), ["AC-001", "GOAL-001", "AC-001", "AC-002"], "rows keep their record ids");
  const acRow = entries.find((e) => e.id === "AC-001" && e.to === "achieved");
  assert.equal(acRow.goal, "GOAL-001", "an AC row carries its owning GOAL");
  assert.equal(acRow.actor, "goal-driver");
  assert.equal(acRow.reason, "I2: criterion pass");
  assert.equal(entries.find((e) => e.id === "GOAL-001").goal, null, "a GOAL row has no owning goal (null, not a self-reference)");

  // --since filters the merged stream on each entry's own `at` (NOT on record mtimes).
  const windowed = runGoal(root, ["log", "--json", "--since", ISO(CUT)]);
  assert.equal(windowed.status, 0, `goal log --since exits 0 (stderr: ${windowed.stderr.slice(0, 500)})`);
  assert.deepEqual(JSON.parse(windowed.stdout).map((e) => e.at), ["2026-10-20T00:00:00.000Z"], "only the late transition survives");
});

// ── AC4 — three-state: unreadable carrier ≠ empty carrier ───────────────────────────────────────
test("AC4: a missing goal carrier answers {evaluated:false} + exit 3, an EMPTY one answers [] + exit 0", () => {
  const missing = seedWorkspace("ac4-missing", { withGoals: false });

  for (const args of [
    ["list", "--json", "--no-body"],
    ["list", "--json", "--since", ISO(CUT)],
    ["log", "--json"],
  ]) {
    const r = runGoal(missing.root, args);
    assert.equal(r.status, 3, `\`goal ${args.join(" ")}\` exits 3 on a missing carrier (got ${r.status}: ${r.stderr.slice(0, 300)})`);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.evaluated, false, `\`goal ${args.join(" ")}\` says evaluated:false, never an empty array`);
    assert.equal(typeof payload.reason, "string");
    assert.match(payload.reason, /does not exist/, "the reason names the missing carrier");
  }

  // CONTROL (hard rule 4): the SAME workspace with an EMPTY goals/ directory is a genuine read —
  // `[]` + exit 0. If this half matched the missing case, the three-state above would prove nothing.
  const empty = seedWorkspace("ac4-empty");
  fs.rmSync(empty.goalsDir, { recursive: true, force: true });
  fs.mkdirSync(empty.goalsDir);
  for (const args of [["list", "--json", "--no-body"], ["log", "--json"]]) {
    const r = runGoal(empty.root, args);
    assert.equal(r.status, 0, `\`goal ${args.join(" ")}\` exits 0 on an EMPTY carrier (got ${r.status}: ${r.stderr.slice(0, 300)})`);
    assert.deepEqual(JSON.parse(r.stdout), [], "an empty carrier is a genuine empty reading");
  }

  // The DEFAULT read surface is untouched (AC5's "byte-identical default"): no probe, its historical
  // []/exit-0 behaviour on a missing carrier is preserved.
  const dflt = runGoal(missing.root, ["list", "--json"]);
  assert.equal(dflt.status, 0, "default `goal list --json` behaviour is unchanged");
  assert.deepEqual(JSON.parse(dflt.stdout), [], "default read still returns the plain array");
});
