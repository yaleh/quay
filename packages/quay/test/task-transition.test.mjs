// @test-group product
// task-transition.test.mjs — the KERNEL task-status transition primitives
// (packages/quay/src/kernel/task-transition.ts, GOAL-030 ①; contract v1 by
// tasks/gap-task-status-events-contract-v1-all-driver-writers).
//
// What this file pins, in order of what can regress silently:
//   1. VOCABULARY — the kernel's own status set equals `abi.ts`'s `TASK_STATUSES`. The kernel cannot
//      import `abi.ts` (kernel leaf), so the two declarations are structurally separate copies; this
//      equality is what keeps them from drifting apart silently (hard rule 5b).
//   2. DECISION OVER THE FULL 5×5 — `decideTransition` returns `allow` for exactly the `current`
//      edges, and `refuse` for every other KNOWN pair (no edge, or a `legacy` edge). Enumerated, not
//      sampled: a verdict that is right for two pairs and wrong for the other twenty-three is the
//      failure this catches.
//   3. NOT-EVALUATED IS ITS OWN ANSWER — an unknown status word returns `not-evaluated`, NEVER
//      `refuse`. That is hard rule 3b: an unreadable input must not look like a judged-and-refused
//      one. A predicate that returns one boolean for both cannot pass this test.
//   4. EVENT WRITE (v1) — the AC(a)/(b)/(c)/(f) contract of
//      tasks/gap-task-status-events-contract-v1-all-driver-writers:
//        (a) the v1 record shape, with `eventId` STABLE across a retried append of the same
//            transition (and changing when the transition does);
//        (b) `seq` strictly increasing under two concurrent writer PROCESSES (real child processes),
//            with no interleaved and no corrupt lines;
//        (c) a failed append does NOT fail anything, is COUNTED, is logged, and never throws;
//        (f) a v0 line is READ as v0 — not rejected as corrupt, and not rewritten in place.
//
// Run: scripts/test.sh packages/quay/test/task-transition.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";

import { TASK_STATUSES as ABI_STATUSES } from "../src/abi.ts";
import {
  TASK_STATUSES,
  TASK_STATUS_EVENT_SCHEMA,
  LIFECYCLE_EDGES,
  decideTransition,
  edgeKindFor,
  patchStatusField,
  appendTaskStatusEvent,
  readTaskStatusEventCarrier,
  statusEventAppendFailureCount,
  resetStatusEventAppendFailureCount,
  gitBlobSha,
  taskStatusEventId,
  normalizeActor,
  taskStatusEventsPath,
  taskStatusEventsEpochPath,
  taskStatusEventsLockPath,
} from "../src/kernel/task-transition.ts";

/** The kernel module's own realpath — what `appendTaskStatusEvent` reports as `producer.writerModule`. */
const KERNEL_FILE = fs.realpathSync(fileURLToPath(new URL("../src/kernel/task-transition.ts", import.meta.url)));
/** The kernel module's own URL — what the child-process fixture imports (⛔ never a copied file). */
const KERNEL_URL = pathToFileURL(KERNEL_FILE).href;

// ── 1. vocabulary ────────────────────────────────────────────────────────────────────────────────

test("vocabulary: the kernel status set equals abi.TASK_STATUSES (the two declarations cannot drift)", () => {
  assert.deepEqual(
    [...TASK_STATUSES].sort(),
    [...ABI_STATUSES].sort(),
    "kernel TASK_STATUSES and abi.TASK_STATUSES must be the same five words",
  );
});

// ── 2. the decision over the full 5×5 cross-product ──────────────────────────────────────────────

test("decideTransition: the full 5×5 returns allow IFF the pair is a declared `current` edge", () => {
  const current = new Set(LIFECYCLE_EDGES.filter((e) => e.status === "current").map((e) => `${e.from}→${e.to}`));

  let allowed = 0;
  for (const from of TASK_STATUSES) {
    for (const to of TASK_STATUSES) {
      const d = decideTransition(from, to);
      const key = `${from}→${to}`;
      if (current.has(key)) {
        assert.equal(d.verdict, "allow", `${key} is a current edge but decideTransition said "${d.verdict}"`);
        assert.equal(d.edge.from, from);
        assert.equal(d.edge.to, to);
        assert.equal(d.edge.status, "current");
        allowed++;
      } else {
        assert.equal(d.verdict, "refuse", `${key} is not a current edge but decideTransition said "${d.verdict}"`);
        assert.ok(typeof d.reason === "string" && d.reason.length > 0, `${key}: refuse must carry a reason`);
      }
    }
  }

  // Non-vacuity: the corpus genuinely contains current edges (a decision that never allows anything
  // would pass the loop above while proving nothing — the zero-count control).
  assert.ok(allowed > 0, "LIFECYCLE_EDGES declares no `current` edge — the predicate would be vacuous");
  assert.equal(allowed, current.size, "every current edge must have been allowed exactly once");
});

test("decideTransition: a declared `legacy` edge is REFUSED by default, allowed only on explicit opt-in", () => {
  const legacy = LIFECYCLE_EDGES.filter((e) => e.status === "legacy");
  assert.ok(legacy.length > 0, "LIFECYCLE_EDGES declares no `legacy` edge — this test would be vacuous");
  for (const e of legacy) {
    assert.equal(decideTransition(e.from, e.to).verdict, "refuse", `${e.from}→${e.to} (legacy) must refuse by default`);
    assert.equal(
      decideTransition(e.from, e.to, { allowLegacy: true }).verdict,
      "allow",
      `${e.from}→${e.to} (legacy) must be allowed when allowLegacy is set`,
    );
  }
});

test("edgeKindFor: the declared edge's kind, or null when no edge is walkable (never a guessed role)", () => {
  assert.equal(edgeKindFor("todo", "ready"), "promote");
  assert.equal(edgeKindFor("ready", "done"), "promote");
  assert.equal(edgeKindFor("done", "ready"), "retreat");
  assert.equal(edgeKindFor("todo", "needs-human"), "escalate");
  assert.equal(edgeKindFor("todo", "superseded"), null, "a legacy edge is not walkable by default");
  assert.equal(edgeKindFor("todo", "superseded", { allowLegacy: true }), "supersede");
  assert.equal(edgeKindFor("bogus", "ready"), null, "an unknown status has no edge kind");
});

// ── 3. not-evaluated is a distinct answer (hard rule 3b) ─────────────────────────────────────────

test("decideTransition: an unknown status is `not-evaluated`, NEVER conflated with `refuse`", () => {
  const cases = [
    ["bogus", "ready"],
    ["todo", "bogus"],
    ["bogus", "bogus"],
    ["", "done"],
    ["TODO", "ready"], // case matters: the vocabulary is lower-case
  ];
  for (const [from, to] of cases) {
    const d = decideTransition(from, to);
    assert.equal(d.verdict, "not-evaluated", `${JSON.stringify(from)}→${JSON.stringify(to)} must be not-evaluated`);
    assert.notEqual(d.verdict, "refuse", "not-evaluated must not be reported as refuse (hard rule 3b)");
    assert.ok(typeof d.reason === "string" && d.reason.length > 0, "not-evaluated must carry a reason");
  }
});

// ── 4a. the v1 record shape + the deterministic eventId ──────────────────────────────────────────

const V1_TOP_LEVEL = ["schema", "eventId", "seq", "carrierEpoch", "taskId", "from", "to", "kind", "at", "recordedAt", "actor", "producer"];

test("(a) appendTaskStatusEvent: the v1 record shape, and `eventId` is STABLE across a retried append", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-status-events-v1-"));
  try {
    const base = {
      taskId: "T-1",
      from: "todo",
      to: "ready",
      kind: "promote",
      actor: { kind: "promotion-driver", id: "ready-pool-check --apply" },
      at: "2026-10-12T00:00:00.000Z",
      evidence: { commit: "a".repeat(40), statusBlobSha: gitBlobSha("body") },
      cause: { runId: "wk-prod-1" },
      reason: "unit test",
    };
    const first = appendTaskStatusEvent(root, base);
    assert.equal(first.ok, true, `write failed: ${first.ok === false ? first.reason : ""}`);
    // The RETRY: the same transition, same `at`, same writer — this is what "at-least-once,
    // idempotent" means, and the consumer's dedup key is `eventId`.
    const retry = appendTaskStatusEvent(root, base);
    assert.equal(retry.ok, true);

    const carrier = readTaskStatusEventCarrier(root);
    assert.equal(carrier.exists, true, "the carrier must exist after two appends");
    assert.equal(carrier.lines.length, 2, "two appends ⇒ two lines (append-only, never an overwrite)");
    assert.deepEqual(carrier.lines.map((l) => l.klass), ["v1", "v1"]);

    const rec = carrier.lines[0].record;
    for (const key of V1_TOP_LEVEL) assert.ok(key in rec, `v1 record is missing "${key}": ${JSON.stringify(rec)}`);
    assert.equal(rec.schema, TASK_STATUS_EVENT_SCHEMA);
    assert.equal(rec.taskId, "T-1");
    assert.equal(rec.from, "todo");
    assert.equal(rec.to, "ready");
    assert.equal(rec.kind, "promote");
    assert.equal(rec.at, "2026-10-12T00:00:00.000Z", "`at` is the caller's status-write time, not the append time");
    assert.ok(!Number.isNaN(Date.parse(rec.recordedAt)), `recordedAt is not parseable: ${rec.recordedAt}`);
    assert.deepEqual(rec.actor, { kind: "promotion-driver", id: "ready-pool-check --apply" });
    assert.deepEqual(rec.cause, { runId: "wk-prod-1" });
    assert.equal(rec.evidence.commit, "a".repeat(40));
    assert.equal(rec.evidence.statusBlobSha, gitBlobSha("body"));
    assert.equal(rec.reason, "unit test");
    assert.equal(rec.seq, 0, "the first event on a fresh carrier takes seq 0");
    assert.equal(typeof rec.carrierEpoch, "string");
    assert.ok(rec.carrierEpoch.length > 0);

    // producer: the DIRECT reading of which code ran (GOAL-030 AC-337's two fields), plus host/pid
    // and the pure-filesystem HEAD reading.
    assert.equal(fs.realpathSync(rec.producer.writerModule), KERNEL_FILE, "producer.writerModule is the kernel realpath");
    assert.equal(typeof rec.producer.pid, "number");
    assert.equal(typeof rec.producer.host, "string");
    assert.ok(rec.producer.host.length > 0);
    // codeRev is read from `.git` next to the writer module; in this worktree that resolves to a sha.
    // ⛔ null is a legal value (not a repo / unborn HEAD) — assert only the SHAPE when non-null.
    if (rec.producer.codeRev !== null) assert.match(rec.producer.codeRev, /^[0-9a-f]{40,64}$/);

    const retryRec = carrier.lines[1].record;
    assert.equal(retryRec.eventId, rec.eventId, "(a) a retried append of the SAME transition must compute the SAME eventId");
    assert.notEqual(retryRec.seq, rec.seq, "…while still taking its own position (seq) on the carrier");
    assert.equal(retryRec.carrierEpoch, rec.carrierEpoch, "both events belong to the same carrier epoch");

    // The id is a function of the TRANSITION — a different `to` must not collide.
    const other = appendTaskStatusEvent(root, { ...base, to: "done" });
    assert.equal(other.ok, true);
    assert.notEqual(other.record.eventId, rec.eventId, "a different transition must not reuse an eventId");

    // An omitted `reason` / `cause` / `evidence` stays ABSENT (缺值 = 未查), never an empty stand-in.
    const bare = appendTaskStatusEvent(root, { taskId: "T-2", from: "todo", to: "ready", kind: "promote", actor: "some-entry-point" });
    assert.equal(bare.ok, true);
    assert.ok(!("reason" in bare.record), "an omitted reason must be ABSENT, not empty-string");
    assert.ok(!("cause" in bare.record), "an omitted cause must be ABSENT");
    assert.ok(!("evidence" in bare.record), "omitted evidence must be ABSENT");
    assert.deepEqual(bare.record.actor, { kind: "unknown", id: "some-entry-point" }, "a bare string actor is normalised to kind unknown, retaining the entry point as id");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("normalizeActor: a bare string names an entry point, so the class is recorded as `unknown` (never guessed)", () => {
  assert.deepEqual(normalizeActor("ready-pool-check --apply"), { kind: "unknown", id: "ready-pool-check --apply" });
  assert.deepEqual(normalizeActor({ kind: "fan-in", id: "x" }), { kind: "fan-in", id: "x" });
});

// ── 3b. a CREATION is a transition with no `from` ────────────────────────────────────────────────
// gap-task-status-events-abi-writes-and-creation: the ABI write surface creates tasks
// (`quay task create`), and a creation IS a status transition — but it has no prior status. The
// record must say `from:null`, and the distinction that matters is null vs ABSENT: JSON.stringify
// DROPS an `undefined` value, so a create path that left `from` unset would emit a record whose
// `from` key is missing entirely — and every consumer would read that as "not recorded" (缺值 = 未查)
// rather than "this task did not exist". Same carrier, same reader, two different facts.
test("(a-create) a creation appends a v1 record with `from:null` — null, NOT an absent key", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-status-events-create-"));
  try {
    const written = appendTaskStatusEvent(root, {
      taskId: "NEW-1",
      from: null,
      to: "todo",
      kind: "create",
      actor: { kind: "cli", id: "cli:1234" },
      evidence: { commit: null, commitAbsentReason: "the store's tasks dir is not inside a git work tree" },
    });
    assert.equal(written.ok, true, `write failed: ${written.ok === false ? written.reason : ""}`);

    const line = readTaskStatusEventCarrier(root).lines[0];
    assert.equal(line.klass, "v1", "a create record is a v1 record like any other — not a v0 line, not corrupt");
    const rec = line.record;
    assert.ok("from" in rec, "`from` must be PRESENT on a create record — an absent key would mean 'not recorded'");
    assert.equal(rec.from, null, "…and its value must be null: the task had no prior status");
    assert.equal(rec.to, "todo");
    assert.equal(rec.kind, "create");
    // A null commit is likewise present-with-null and carries WHY (the Plan's "commit:null plus a
    // reason") — "no commit because this path never commits" must not look like "the commit failed".
    assert.ok("commit" in rec.evidence);
    assert.equal(rec.evidence.commit, null);
    assert.equal(rec.evidence.commitAbsentReason, "the store's tasks dir is not inside a git work tree");

    // The dedup id is computed over the transition, and a null `from` must not collapse it into some
    // other pair (the id falls back to `at` when there is no commit — a create has neither).
    const sameId = taskStatusEventId({ taskId: "NEW-1", from: null, to: "todo", commit: null, at: rec.at, writer: rec.producer.writerModule });
    assert.equal(sameId, rec.eventId, "a retried create append must compute the SAME eventId");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 4b. seq under two concurrent writer PROCESSES ────────────────────────────────────────────────

test("(b) seq is strictly increasing under two concurrent writer PROCESSES, with no corrupt line", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-status-events-conc-"));
  const childDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-status-events-child-"));
  try {
    // A REAL child process, not a worker thread: the lock's job is to serialise separate writer
    // PROCESSES (the promotion driver, the fan-in and the worker driver are separate OS processes).
    const child = path.join(childDir, "writer.mjs");
    fs.writeFileSync(
      child,
      [
        `import { appendTaskStatusEvent } from ${JSON.stringify(KERNEL_URL)};`,
        "const [root, n, tag] = process.argv.slice(2);",
        "for (let i = 0; i < Number(n); i++) {",
        "  const r = appendTaskStatusEvent(root, {",
        "    taskId: `T-${tag}-${i}`, from: 'todo', to: 'ready', kind: 'promote',",
        "    actor: { kind: 'fan-in', id: `child-${tag}` }, at: new Date().toISOString(),",
        "  });",
        "  if (!r.ok) { console.error(`child ${tag} append ${i} failed: ${r.reason}`); process.exit(1); }",
        "}",
      ].join("\n") + "\n",
      "utf8",
    );
    const N = 25;
    // TWO CHILDREN STARTED TOGETHER (spawn, not spawnSync): with spawnSync the two runs would be
    // strictly sequential and this test could pass with NO lock at all — a vacuous control. `Promise.all`
    // keeps both processes appending into the same carrier window.
    const runChild = (tag) =>
      new Promise((resolve, reject) => {
        const p = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", child, root, String(N), tag], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let err = "";
        p.stderr.on("data", (d) => {
          err += String(d);
        });
        p.on("error", reject);
        p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`child ${tag} exited ${code}: ${err}`))));
      });
    await Promise.all([runChild("a"), runChild("b")]);

    const carrier = readTaskStatusEventCarrier(root);
    assert.equal(carrier.lines.filter((l) => l.klass === "corrupt").length, 0, "(b) no corrupt/interleaved line");
    assert.equal(carrier.lines.length, 2 * N, "(b) every append landed exactly once");
    const seqs = carrier.lines.map((l) => l.record.seq);
    assert.deepEqual(
      seqs,
      [...Array(2 * N).keys()],
      "(b) seq must be 0..N-1 with NO duplicate and NO gap — a duplicate means two writers read the same cursor",
    );
    assert.equal(new Set(carrier.lines.map((l) => l.record.eventId)).size, 2 * N, "each writer's events are distinct");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(childDir, { recursive: true, force: true });
  }
});

// ── 4c. a failed append is counted, logged, and harmless ─────────────────────────────────────────

test("(c) a failed append does not throw, is COUNTED, and never looks like a success", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "task-status-events-fail-"));
  try {
    // A regular FILE where a directory is required ⇒ mkdir/append must fail (deterministic: ENOTDIR,
    // independent of the user's uid, unlike a chmod-based approach).
    const notADir = path.join(tmp, "not-a-dir");
    fs.writeFileSync(notADir, "x");

    resetStatusEventAppendFailureCount();
    assert.equal(statusEventAppendFailureCount(), 0, "the counter starts at zero");
    let result;
    assert.doesNotThrow(() => {
      result = appendTaskStatusEvent(notADir, { taskId: "T", from: "todo", to: "ready", kind: "promote", actor: "t" });
    });
    assert.equal(result.ok, false, "a failed write must return ok:false");
    assert.ok(typeof result.reason === "string" && result.reason.length > 0, "ok:false must carry a reason (never silent)");
    assert.equal(statusEventAppendFailureCount(), 1, "(c) the failure is COUNTED (the Plan's 'stderr plus a counter')");
    appendTaskStatusEvent(notADir, { taskId: "T", from: "todo", to: "ready", kind: "promote", actor: "t" });
    assert.equal(statusEventAppendFailureCount(), 2, "the counter accumulates");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 4f. a v0 line is read as v0 ──────────────────────────────────────────────────────────────────

const V0_LINE =
  '{"ts":"2026-10-08T23:30:00.000Z","taskId":"OLD-1","from":"todo","to":"ready","kind":"promote",' +
  '"actor":"ready-pool-check --apply","writerModule":"/x/y.ts","entry":null,"pid":1}';

test("(f) a v0 line is read as v0 — not rejected, not upgraded, and the v1 lines beside it still classify", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-status-events-v0-"));
  try {
    const file = taskStatusEventsPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // A carrier with a v0 line, a corrupt line, and (after the append) a v1 line — all three classes
    // must be told apart (硬规则 3b: "unreadable" is its own answer).
    fs.writeFileSync(file, `${V0_LINE}\n{"taskId": broken json\n`, "utf8");

    const r = appendTaskStatusEvent(root, { taskId: "NEW-1", from: "ready", to: "done", kind: "promote", actor: { kind: "fan-in", id: "x" } });
    assert.equal(r.ok, true, "a v0 line on the carrier must not block a v1 append");
    assert.equal(r.record.seq, 0, "a v0 line carries no seq ⇒ the first v1 seq is 0, not 1 (no phantom cursor)");

    const carrier = readTaskStatusEventCarrier(root);
    assert.deepEqual(carrier.lines.map((l) => l.klass), ["v0", "corrupt", "v1"]);
    const v0 = carrier.lines[0].legacy;
    assert.equal(v0.taskId, "OLD-1");
    assert.equal(v0.actor, "ready-pool-check --apply", "a v0 record's actor stays the bare string it was written as");
    assert.ok(!("seq" in v0), "v0 is READ as v0 — it is not upgraded in place");

    // The file on disk is byte-identical for the two pre-existing lines (append-only).
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
    assert.equal(lines[0], V0_LINE, "the v0 line is untouched on disk");

    // An ABSENT carrier is its own answer, distinct from an empty one that was read.
    const clean = fs.mkdtempSync(path.join(os.tmpdir(), "task-status-events-none-"));
    try {
      const empty = readTaskStatusEventCarrier(clean);
      assert.equal(empty.exists, false);
      assert.deepEqual(empty.lines, []);
    } finally {
      fs.rmSync(clean, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("carrier paths: the three sibling paths are derived from ONE definition point", () => {
  const root = "/tmp/some-root";
  assert.equal(taskStatusEventsPath(root), path.join(root, ".quay", "task-status-events.jsonl"));
  assert.equal(taskStatusEventsEpochPath(root), path.join(root, ".quay", "task-status-events-state.json"));
  assert.equal(taskStatusEventsLockPath(root), path.join(root, ".quay", "task-status-events.lock"));
});

// ── the moved patchStatusField (pinned here too; task-ops.test.mjs covers it via the re-export) ───

test("patchStatusField: replaces the status value byte-for-byte and honours the fromStatus guard", () => {
  const fm = "id: a\ntitle: b\nstatus: todo\nlabels:\n  - gap\n";
  const applied = patchStatusField(fm, "ready");
  assert.equal(applied.ok, true);
  assert.equal(applied.replaced, true);
  assert.equal(applied.fm, "id: a\ntitle: b\nstatus: ready\nlabels:\n  - gap\n");

  const noop = patchStatusField(fm, "ready", "done"); // current is todo, not done ⇒ no-op
  assert.equal(noop.ok, true);
  assert.equal(noop.replaced, false);
  assert.equal(noop.fm, fm);

  const failClosed = patchStatusField("id: a\ntitle: b\n", "ready");
  assert.equal(failClosed.ok, false);
  assert.equal(failClosed.reason, "no-status-line");
});

test("gitBlobSha: the pure-computed blob hash equals what git itself reports for the same content", () => {
  const content = "---\nid: x\nstatus: ready\n---\nbody\n";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-status-events-blob-"));
  try {
    const repo = path.join(root, "r");
    fs.mkdirSync(repo, { recursive: true });
    // `git hash-object --literally` needs only a repo for the object format; `--stdin` avoids a file.
    execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
    const viaGit = execFileSync("git", ["hash-object", "--stdin"], { cwd: repo, input: content, encoding: "utf8" }).trim();
    assert.equal(gitBlobSha(content), viaGit, "the hand-computed blob hash must equal `git hash-object`'s");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
