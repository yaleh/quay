// @test-group product
// @load-sensitive child-spawn
// task-log.test.mjs — the READ surface over the task-status transition carrier
// (packages/quay/src/cli/task-log.ts + the writer-class registry in packages/quay/src/kernel/
// task-transition.ts), task gap-quay-task-log-trace-read-surface.
//
// WHAT THIS FILE PINS, and why each one is its own test:
//   (a) PAGING — `--limit` returns every event across pages, and a RESUMED cursor is AT-LEAST-ONCE
//       (the boundary event comes again). Both halves matter: a paging scheme that loses an event at
//       a page boundary is the failure a consumer cannot see, and a scheme that claims exactly-once
//       while the consumer may crash mid-page is a promise this design cannot keep. The dedup key
//       (`eventId`) is what makes the trade honest, so the union is asserted BOTH raw (with the
//       expected overlap) and deduped (exactly once).
//   (b) EPOCH REBASE — a cursor taken under another epoch is REPORTED (`rebase:true` + a reason) and
//       the read replays from the beginning of the current epoch. The wrong implementation returns
//       an empty page, which is indistinguishable from "nothing happened" (硬规则 3b). Exercised on
//       BOTH rotations this repo can produce: a legacy v0-only carrier whose epoch is PRE_EPOCH and
//       is rotated by the first v1 append, and a full carrier replaced under a new epoch.
//   (c) COVERAGE IS ENUMERATED — `complete:false` names WHY. Three arms: a declared in-scope writer
//       class that is not wired — driven through the injectable `writerClasses` seam rather than the
//       real registry, so the arm does not evaporate the moment the last in-scope gap closes (it
//       did: gap-task-status-events-abi-writes-and-creation wired cli + mcp, leaving the real
//       registry's `unwiredInScope` empty — see the real-registry arm below), a lagging reconcile
//       watermark, and — the falsifiability control — an all-wired registry over a current carrier,
//       where `complete` DOES become true. Without that arm `complete:false` would be a constant.
//   (d) TRACE over a MIXED carrier — v0 + v1 + inferred for one task, ordered by carrier position
//       (which equals `seq` order for v1 records) with `source` labelled per record.
//   (e) UNKNOWN TASK — a DISTINCT not-found exit (3), never an empty success. Driven through the real
//       CLI against a real native-provider workspace, so it is the verb's own exit code under test.
//   (f) VERB SURFACE — `quay --help`'s Usage synopsis carries both new subcommands (the four-registry
//       parity checks themselves are cli.test.mjs's block14/block28, run separately).
//   (g) NEGATIVE CONTROL — the epoch check made a NO-OP in a scratch COPY of the CLI module graph
//       makes (b) red. ⛔ The mutation never touches the checked-in file: this file runs concurrently
//       with others that import it.
//
// ⛔ NO in-tree writes: every fixture lives under the shared writable-tmp helper, so this file cannot
// enroll itself in checked-in-write-check.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { makeTmpDir, makeTmpWorkspace } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { stripComments } from "../../../plugin/scripts/source-text-lib.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import {
  PRE_EPOCH,
  TASK_STATUS_EVENT_WRITER_CLASSES,
  appendTaskStatusEvent,
  readCarrierEpoch,
  taskStatusEventsEpochPath,
  taskStatusEventsPath,
} from "../src/kernel/task-transition.ts";
import { readTaskLog, readTaskTrace, TRACE_NOT_FOUND_EXIT } from "../src/cli/task-log.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pkgDir, "..", "..");

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

/** A disposable workspace root carrying `.quay/config.yml` (the resolution marker `--root` uses). */
function makeCarrierRoot(tag) {
  const root = makeTmpDir(`quay-tasklog-${tag}-`);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "providers: {}\n");
  return root;
}

let seqClock = 0;
/** Append one v1 event through the REAL writer (never a hand-built record), pinned to a fixed time. */
function writeV1(root, { taskId, from = "todo", to = "ready", at, inferred = false, commit = null }) {
  const res = appendTaskStatusEvent(root, {
    taskId,
    from,
    to,
    kind: "promote",
    actor: { kind: "promotion-driver", id: "task-log.test" },
    at: at ?? `2026-10-01T00:00:${String(seqClock++ % 60).padStart(2, "0")}.000Z`,
    recordedAt: at ?? `2026-10-01T00:00:${String(seqClock % 60).padStart(2, "0")}.000Z`,
    ...(inferred ? { source: "git", inferred: true } : {}),
    ...(commit !== null ? { evidence: { commit } } : {}),
  });
  assert.equal(res.ok, true, `fixture append failed: ${res.ok ? "" : res.reason}`);
  return res.record;
}

/** Append a legacy v0 line exactly as the pre-v1 writer wrote it (no `schema` key). */
function writeV0(root, { taskId, from = "todo", to = "ready", at }) {
  fs.appendFileSync(
    path.join(root, ".quay", "task-status-events.jsonl"),
    JSON.stringify({ ts: at, taskId, from, to, kind: "promote", actor: "ready-pool-check --apply" }) + "\n",
  );
}

/** The full registry with every in-scope class wired — the falsifiability control for `complete`. */
const ALL_WIRED = TASK_STATUS_EVENT_WRITER_CLASSES.map((c) =>
  c.inScope ? { ...c, wired: true, callSites: ["fixture"] } : c,
);

function readOk(root, opts) {
  const r = readTaskLog(root, opts);
  assert.equal(r.ok, true, `readTaskLog must succeed: ${r.ok ? "" : r.reason}`);
  return r.document;
}

// ── (a) paging: exactly-once across pages, at-least-once on a resumed cursor ─────────────────────

test("(a) paging by --limit covers every event; a resumed cursor is AT-LEAST-ONCE (dedup by eventId)", () => {
  const root = makeCarrierRoot("a");
  const written = [];
  for (let i = 0; i < 7; i++) {
    written.push(writeV1(root, { taskId: `T-${i}`, at: `2026-10-01T00:00:0${i}.000Z` }));
  }
  const allIds = written.map((r) => r.eventId);

  // Walk the feed the way a consumer does: pass `nextCursor` back verbatim.
  const pages = [];
  const delivered = [];
  let since = null;
  for (let guard = 0; guard < 10; guard++) {
    const doc = readOk(root, { since, limit: 3 });
    pages.push(doc.transitions.map((t) => t.order));
    for (const t of doc.transitions) delivered.push(t.eventId);
    assert.equal(doc.rebase, false, "no rotation happened — the cursor must be honoured throughout");
    since = doc.nextCursor === null ? null : JSON.stringify(doc.nextCursor);
    if (doc.transitions.length < 3) break;
  }

  // Raw delivery has exactly ONE duplicated event per resume (the previous page's last), which is
  // the at-least-once trade — asserted, not assumed.
  assert.deepEqual(pages, [[0, 1, 2], [2, 3, 4], [4, 5, 6], [6]], `page boundaries: ${JSON.stringify(pages)}`);
  assert.equal(delivered.length, 10, "3+3+3+1 raw deliveries");
  assert.equal(new Set(delivered).size, 7, "raw delivery overlaps by exactly the boundary events");

  // Every page after the first re-delivers the previous page's LAST event — at-least-once, proven.
  for (let p = 1; p < pages.length; p++) {
    assert.equal(pages[p][0], pages[p - 1][pages[p - 1].length - 1], `page ${p} must resume INCLUSIVE of the previous page's last event`);
  }

  // Deduped by `eventId` (the documented, and only, dedup key): every event exactly once.
  assert.deepEqual([...new Set(delivered)].sort(), [...allIds].sort(), "the deduped union is EXACTLY the written set — no loss, no invention");
  const lastPage = readOk(root, { since: JSON.stringify({ v: 1, carrierEpoch: readCarrierEpoch(root), seq: 6 }), limit: 3 });
  assert.deepEqual(lastPage.transitions.map((t) => t.order), [6], "resuming at the final position re-delivers it (at-least-once)");
  assert.equal(lastPage.transitions[0].eventId, allIds[6], "…and it is the SAME eventId, so the consumer can dedupe it");
});

// ── (b) an epoch-mismatched cursor rebases, and says so ──────────────────────────────────────────

test("(b) an epoch-mismatched cursor ⇒ rebase:true + a reason + a REPLAY, never an empty page", () => {
  const root = makeCarrierRoot("b1");
  for (let i = 0; i < 3; i++) writeV1(root, { taskId: `OLD-${i}`, at: `2026-10-01T00:00:0${i}.000Z` });
  const epoch1 = readCarrierEpoch(root);
  const staleCursor = JSON.stringify({ v: 1, carrierEpoch: epoch1, seq: 1 });

  // A rotation: the carrier is replaced and a NEW epoch is minted by the next append.
  fs.rmSync(taskStatusEventsPath(root), { force: true });
  fs.rmSync(taskStatusEventsEpochPath(root), { force: true });
  for (let i = 0; i < 3; i++) writeV1(root, { taskId: `NEW-${i}`, at: `2026-10-02T00:00:0${i}.000Z` });
  const epoch2 = readCarrierEpoch(root);
  assert.notEqual(epoch1, epoch2, "fixture must actually have rotated the epoch");

  const doc = readOk(root, { since: staleCursor, limit: 3 });
  assert.equal(doc.rebase, true, "a cursor from another epoch MUST be reported, not silently honoured");
  assert.ok(doc.rebaseReason && doc.rebaseReason.length > 0, "the rebase must carry a reason");
  assert.equal(doc.transitions.length, 3, "the read REPLAYS the current epoch — an empty page is the forbidden answer");
  assert.deepEqual(doc.transitions.map((t) => t.taskId), ["NEW-0", "NEW-1", "NEW-2"]);
  assert.equal(doc.nextCursor.carrierEpoch, epoch2, "the next cursor is minted under the CURRENT epoch");
});

test("(b) a legacy v0-only carrier's PRE_EPOCH cursor rebases once the first v1 append rotates it", () => {
  const root = makeCarrierRoot("b2");
  writeV0(root, { taskId: "V0-1", at: "2026-10-01T00:00:00.000Z" });
  assert.equal(readCarrierEpoch(root), PRE_EPOCH, "a carrier with no sidecar and no v1 record is PRE_EPOCH");
  const legacyCursor = JSON.stringify({ v: 1, carrierEpoch: PRE_EPOCH, seq: 0 });
  assert.equal(readOk(root, { since: legacyCursor }).rebase, false, "a PRE_EPOCH cursor on a PRE_EPOCH carrier is honourable");

  writeV1(root, { taskId: "V1-1", at: "2026-10-01T00:00:01.000Z" }); // mints the sidecar ⇒ rotation
  const doc = readOk(root, { since: legacyCursor });
  assert.equal(doc.rebase, true, "the first v1 append rotates the effective epoch — the legacy cursor must rebase");
  assert.deepEqual(doc.transitions.map((t) => t.taskId), ["V0-1", "V1-1"], "the replay covers the CURRENT epoch from its first line");
});

// ── (c) completeness is enumerated, and falsifiable in BOTH directions ───────────────────────────

test("(c) complete:false names the UNWIRED in-scope writer classes and the carrier census", () => {
  const root = makeCarrierRoot("c1");
  writeV1(root, { taskId: "C-1", at: "2026-10-01T00:00:00.000Z" });

  // Arm 1 — an in-scope class left unwired is NAMED: its id in `unwiredInScope` AND its id + reason
  // in `reasons`, never collapsed into a bare `complete:false`. Driven through the injectable seam
  // (the registry is DATA — `readTaskLog({ writerClasses })`), so this arm tests the READER rather
  // than whichever gaps happen to be open in the tree today. It must be the seam and not the real
  // registry: the real registry's last in-scope gap CLOSED (cli + mcp, wired by
  // gap-task-status-events-abi-writes-and-creation), and an arm pinned to it would have gone silent
  // at exactly the moment it stopped being true — the failure mode it exists to prevent.
  const withUnwired = TASK_STATUS_EVENT_WRITER_CLASSES.map((c) =>
    c.id === "cli"
      ? { ...c, wired: false, callSites: [], reason: "fixture: the cli door is left unwired for the naming arm" }
      : c,
  );
  const doc = readOk(root, { writerClasses: withUnwired });
  assert.equal(doc.complete, false, "an unwired in-scope class makes the page incomplete");
  assert.deepEqual(doc.coverage.unwiredInScope, ["cli"], "the unwired in-scope set is ENUMERATED, not a boolean");
  assert.ok(
    doc.coverage.reasons.some((r) => r.includes('"cli"') && r.includes("IN SCOPE but not wired")),
    `the reason must NAME the class: ${JSON.stringify(doc.coverage.reasons)}`,
  );
  assert.equal(doc.coverage.carrier.v1, 1);
  assert.equal(doc.coverage.carrier.corrupt, 0);

  // Arm 2 — the REAL registry over the same fixture. Every in-scope class is wired today, so
  // `unwiredInScope` is [] as a READING of the declaration (not an omission — the declaration being
  // honest about the tree is (h)'s check), and `complete:false` is driven by reconcile alone.
  const real = readOk(root, {});
  assert.deepEqual(real.coverage.unwiredInScope, [], "no in-scope writer class is unwired today");
  assert.equal(real.complete, false, "still false — no reconcile pass has run against this fixture");
  assert.ok(
    real.coverage.reasons.some((r) => r.includes("reconcile is not current (not-run)")),
    JSON.stringify(real.coverage.reasons),
  );
});

test("(c) complete:false when reconcile LAGS, complete:true when every in-scope class is wired AND reconcile is current", () => {
  // Arm 1 — a live write landed AFTER the newest reconcile-inferred event ⇒ lagging.
  const lagging = makeCarrierRoot("c2-lag");
  writeV1(lagging, { taskId: "L-1", at: "2026-10-01T00:00:00.000Z", inferred: true, commit: "a".repeat(40) });
  writeV1(lagging, { taskId: "L-2", at: "2026-10-02T00:00:00.000Z" });
  const lag = readOk(lagging, { writerClasses: ALL_WIRED });
  assert.equal(lag.coverage.reconcile.state, "lagging", "a write newer than the watermark is the lagging reading");
  assert.equal(lag.complete, false, "an in-scope-all-wired page with a lagging reconcile is still incomplete");
  assert.ok(lag.coverage.reasons.some((r) => r.includes("reconcile is not current (lagging)")), JSON.stringify(lag.coverage.reasons));

  // Arm 2 — the falsifiability control: all in-scope classes wired + the watermark newest + the page
  // reached the end ⇒ complete:true. If this arm could not be reached, `complete` would be a constant.
  const current = makeCarrierRoot("c2-current");
  writeV1(current, { taskId: "N-1", at: "2026-10-01T00:00:00.000Z" });
  writeV1(current, { taskId: "N-2", at: "2026-10-02T00:00:00.000Z", inferred: true, commit: "b".repeat(40) });
  const ok = readOk(current, { writerClasses: ALL_WIRED });
  assert.equal(ok.coverage.reconcile.state, "current", JSON.stringify(ok.coverage.reconcile));
  assert.equal(ok.complete, true, `expected complete:true; reasons: ${JSON.stringify(ok.coverage.reasons)}`);
  assert.deepEqual(ok.coverage.reasons, [], "a complete reading has no unmet conditions");
});

// ── (d) trace over a mixed carrier ───────────────────────────────────────────────────────────────

test("(d) trace orders a mixed v0/v1/inferred carrier by position and labels every source", () => {
  const root = makeCarrierRoot("d");
  writeV0(root, { taskId: "MIX", at: "2026-10-01T00:00:00.000Z" }); // order 0
  writeV1(root, { taskId: "MIX", from: "ready", to: "done", at: "2026-10-02T00:00:00.000Z" }); // order 1
  writeV1(root, { taskId: "MIX", from: "todo", to: "ready", at: "2026-10-03T00:00:00.000Z", inferred: true, commit: "c".repeat(40) }); // order 2
  writeV1(root, { taskId: "OTHER", at: "2026-10-04T00:00:00.000Z" }); // order 3 — a different task

  const doc = readTaskTrace(root, "MIX", "done", { nowMs: Date.parse("2026-10-05T00:00:00.000Z") });
  assert.equal(doc.taskId, "MIX");
  assert.equal(doc.status, "done");
  assert.deepEqual(doc.transitions.map((t) => t.order), [0, 1, 2], "carrier position is the order key");
  assert.deepEqual(doc.transitions.map((t) => t.schema), ["v0", "v1", "v1"]);
  assert.deepEqual(doc.transitions.map((t) => t.source), ["task-status-events", "task-status-events", "git"]);
  assert.deepEqual(doc.transitions.map((t) => t.inferred), [false, false, true]);
  assert.deepEqual(doc.transitions.map((t) => t.seq), [null, 0, 1], "a v0 record has no seq (⛔ never a fabricated one)");
  assert.equal(doc.transitions[2].commit, "c".repeat(40), "an inferred event exposes the commit that evidences it");
  assert.equal(doc.generatedAt, "2026-10-05T00:00:00.000Z", "generatedAt is the caller's instant, not a second clock read");

  // The v1 subset is in ASCENDING seq order — carrier position and seq agree on an append-only carrier.
  const v1Seqs = doc.transitions.filter((t) => t.schema === "v1").map((t) => t.seq);
  assert.deepEqual(v1Seqs, [...v1Seqs].sort((a, b) => a - b), "v1 records must come out in seq order");
});

// ── (e) unknown task ⇒ a DISTINCT not-found exit ─────────────────────────────────────────────────

test("(e) trace on an unknown task exits 3 (distinct from 0), never an empty success", () => {
  const { workspaceRoot, tasksDir } = makeTmpWorkspace("quay-tasklog-e", {
    nativeBin: QUAY_NATIVE_CLI,
    nativeProviderDir: path.join(pkgDir, "..", "quay-native", "bin"),
  });
  fs.writeFileSync(
    path.join(tasksDir, "KNOWN-1.md"),
    "---\nid: KNOWN-1\ntitle: \"known\"\nstatus: done\n---\n## Proposal\nx\n",
  );
  const run = (id) =>
    spawnSync(process.execPath, ["--experimental-strip-types", QUAY_CLI, "task", "trace", id, "--json", "--root", workspaceRoot], {
      encoding: "utf8",
      timeout: 180_000,
    });

  const known = run("KNOWN-1");
  assert.equal(known.status, 0, `a known task reads (exit 0); stderr: ${known.stderr}`);
  const knownDoc = JSON.parse(known.stdout);
  assert.equal(knownDoc.status, "done", "the status comes from the provider, i.e. the authority");

  const unknown = run("NO-SUCH-TASK-ZZZ");
  assert.equal(unknown.status, TRACE_NOT_FOUND_EXIT, `an unknown task must exit ${TRACE_NOT_FOUND_EXIT}; got ${unknown.status} stdout=${unknown.stdout}`);
  assert.notEqual(unknown.status, 0, "⛔ never exit 0 — an empty success would be indistinguishable from a task with no transitions");
  assert.match(unknown.stderr, /no such task/, "the not-found cause is named on stderr");
  assert.equal(unknown.stdout.trim(), "", "no document is printed for a task that does not exist");
});

// ── (e2) the `task log` verb end-to-end ──────────────────────────────────────────────────────────

test("log: the real CLI publishes the contract document, and an unparseable --since is a usage error", () => {
  const root = makeCarrierRoot("cli");
  writeV1(root, { taskId: "CLI-1", at: "2026-10-01T00:00:00.000Z" });
  const run = (args) =>
    spawnSync(process.execPath, ["--experimental-strip-types", QUAY_CLI, "task", "log", ...args, "--root", root], {
      encoding: "utf8",
      timeout: 180_000,
    });

  const ok = run(["--json"]);
  assert.equal(ok.status, 0, `stderr: ${ok.stderr}`);
  const doc = JSON.parse(ok.stdout);
  assert.deepEqual(Object.keys(doc).sort(), ["complete", "coverage", "generatedAt", "nextCursor", "rebase", "rebaseReason", "transitions"].sort());
  assert.equal(doc.transitions.length, 1);
  assert.equal(doc.coverage.carrier.exists, true);

  const bad = run(["--since", "not-a-time"]);
  assert.equal(bad.status, 1, "an unparseable --since is a usage error, not a silent fallback");
  assert.match(bad.stderr, /neither a parseable ISO-8601 instant nor a cursor/);

  const capped = run(["--limit", "501"]);
  assert.equal(capped.status, 1, "--limit above the published ceiling is refused");
  assert.match(capped.stderr, /≤ 500/);
});

// ── (f) the help surface carries both subcommands ────────────────────────────────────────────────

test("(f) `quay --help` Usage synopsis lists `quay task log` and `quay task trace`", () => {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", QUAY_CLI, "--help"], { encoding: "utf8", timeout: 180_000 });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const synopsis = r.stdout.slice(r.stdout.indexOf("Usage:"), r.stdout.indexOf("\n\nOptions for task list:"));
  assert.match(synopsis, /quay task log \[--since <ISO8601\|cursor>\]/, "the synopsis carries the log line");
  assert.match(synopsis, /quay task trace <task-id>/, "the synopsis carries the trace line");
  // The contract excerpt a cross-project consumer pins, and the at-least-once dedup rule.
  assert.match(r.stdout, /"nextCursor": \{ "v": 1, "carrierEpoch": "<epoch>", "seq": 3 \}/);
  assert.match(r.stdout, /DEDUPE BY \\?`?eventId\\?`?/, "the dedup key is documented in --help");
  assert.match(r.stdout, /RETENTION: the carrier is APPEND-ONLY/, "the retention rule is documented in --help");
});

// ── (h) the declared writer-class registry vs the REAL call sites ─────────────────────────────────

test("(h) the declared writer-class registry is IN SYNC with every real appendTaskStatusEvent call site", () => {
  // The registry is a DECLARATION (see the kernel's own block comment), so this is the check that
  // keeps it honest: a fifth writer added to the tree without a registry entry turns this RED, and a
  // `wired: true` entry whose call site stopped calling turns it RED the other way.
  const DEFINITION = path.join(repoRoot, "packages", "quay", "src", "kernel", "task-transition.ts");
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // absent dir — nothing to scan
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist" || e.name === "vendor" || e.name === "archive") continue;
        walk(full);
      } else if (/\.(ts|mts|cts)$/.test(e.name) && !/\.test\./.test(e.name) && full !== DEFINITION) {
        files.push(full);
      }
    }
  };
  walk(path.join(repoRoot, "plugin"));
  walk(path.join(repoRoot, "packages"));

  // ⛔ Comments are stripped first: a PROSE mention of the symbol is not a call site (硬规则 2 —
  // judge by position, not by keyword). `stripComments` is the repo's shared primitive, not a
  // hand-rolled regex.
  const callers = files
    .filter((f) => /appendTaskStatusEvent\s*\(/.test(stripComments(fs.readFileSync(f, "utf8"))))
    .map((f) => path.relative(repoRoot, f))
    .sort();

  const declared = new Set(TASK_STATUS_EVENT_WRITER_CLASSES.flatMap((c) => c.callSites));
  const undeclared = callers.filter((f) => !declared.has(f));
  assert.deepEqual(
    undeclared,
    [],
    `a file calls appendTaskStatusEvent but no declared writer class owns it — declare it in TASK_STATUS_EVENT_WRITER_CLASSES: ${undeclared.join(", ")}`,
  );

  for (const c of TASK_STATUS_EVENT_WRITER_CLASSES) {
    if (c.wired) {
      assert.ok(c.callSites.length > 0, `wired class "${c.id}" must name the file(s) that append its events`);
      for (const rel of c.callSites) {
        const full = path.join(repoRoot, rel);
        assert.ok(fs.existsSync(full), `class "${c.id}" names a file that does not exist: ${rel}`);
        assert.match(
          stripComments(fs.readFileSync(full, "utf8")),
          /appendTaskStatusEvent\s*\(/,
          `class "${c.id}" is declared wired, but ${rel} no longer appends an event`,
        );
      }
    } else {
      assert.deepEqual([...c.callSites], [], `unwired class "${c.id}" must not claim a call site`);
      assert.ok(
        typeof c.reason === "string" && c.reason.length > 20,
        `unwired class "${c.id}" must declare WHY — a bare wired:false is a defect, not an answer`,
      );
    }
  }
  assert.equal(
    new Set(TASK_STATUS_EVENT_WRITER_CLASSES.map((c) => c.id)).size,
    TASK_STATUS_EVENT_WRITER_CLASSES.length,
    "class ids must be unique (硬规则 8: a reused id makes an absence look like a presence)",
  );
});

// ── (g) negative control: the epoch check made a no-op in a scratch copy ⇒ (b) red ───────────────

test("(g) NEGATIVE CONTROL: with the epoch check no-op'd in a scratch copy, (b)'s rebase is NOT reported", () => {
  const root = makeCarrierRoot("g");
  for (let i = 0; i < 2; i++) writeV1(root, { taskId: `G-${i}`, at: `2026-10-01T00:00:0${i}.000Z` });
  const staleCursor = JSON.stringify({ v: 1, carrierEpoch: readCarrierEpoch(root), seq: 0 });
  fs.rmSync(taskStatusEventsPath(root), { force: true });
  fs.rmSync(taskStatusEventsEpochPath(root), { force: true });
  for (let i = 0; i < 2; i++) writeV1(root, { taskId: `H-${i}`, at: `2026-10-02T00:00:0${i}.000Z` });

  // The REAL module reports the rebase — (b)'s assertion holds here.
  assert.equal(readOk(root, { since: staleCursor }).rebase, true, "the unmutated module must report the rebase");

  // A scratch COPY of the CLI's module graph, with the epoch comparison replaced by a constant false.
  const mutant = makeTmpDir("quay-tasklog-mutant-");
  fs.cpSync(path.join(pkgDir, "src"), path.join(mutant, "packages/quay/src"), { recursive: true });
  fs.cpSync(path.join(pkgDir, "bin"), path.join(mutant, "packages/quay/bin"), { recursive: true });
  fs.copyFileSync(path.join(pkgDir, "package.json"), path.join(mutant, "packages/quay/package.json"));
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(mutant, "node_modules"), "dir");

  const mutantFile = path.join(mutant, "packages/quay/src/cli/task-log.ts");
  const src = fs.readFileSync(mutantFile, "utf8");
  const ANCHOR = "if (since.cursor.carrierEpoch !== epoch) {";
  assert.ok(src.includes(ANCHOR), "the control's anchor line has moved — re-derive the mutation instead of letting this control go silently vacuous");
  fs.writeFileSync(mutantFile, src.replace(ANCHOR, "if (false) {"), "utf8");

  const res = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(mutant, "packages/quay/bin/quay.ts"), "task", "log", "--since", staleCursor, "--json", "--root", root],
    { encoding: "utf8", timeout: 180_000 },
  );
  assert.equal(res.status, 0, `the mutant must still run: ${res.stderr}`);
  const mutantDoc = JSON.parse(res.stdout);
  assert.equal(mutantDoc.rebase, false, "the mutant does NOT rebase — this is exactly the red (g) must be able to produce");
  assert.equal(mutantDoc.rebaseReason, null);
  process.stderr.write(
    `\n[negative-control] real module  : rebase=${true} transitions=${2}\n` +
      `[negative-control] mutant module: rebase=${mutantDoc.rebase} transitions=${mutantDoc.transitions.length} (epoch check no-op'd) → (b) would be RED\n`,
  );
});
