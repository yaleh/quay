// @test-group engine
// ready-pool-check.test.mjs — the ready-pool maintenance mechanism
// (tasks/gap-promotion-cadence-is-role-volition-not-product-mechanism). Promotion cadence used to
// live in an outer's VOLUNTARY AC-queue (role volition, lost on session/model change); this test
// pins the PRODUCT mechanism: computing the REAL ready pool (excluding not-yet-flipped / fixture /
// PARKED), reporting dispatchable_disjoint (the largest mutually-disjoint pool subset via
// checkTouchesPair) as the CRITERION, and recommending todo→ready promotions in a DEFINED order
// (touch-disjointness FIRST vs the pool + in-flight, then gap-* > DIR-*, then touches-resolve
// first) when pool < floor (= cap × 4, default 20 — dispatch single source).
//
// AC1 floor = cap × 4 (20 at cap 5, configurable) · AC2 dispatchable_disjoint via checkTouchesPair
// AC3 pool-big-but-all-colliding self-report + no-false-report-on-criterion-met · AC4 disjointness
//   ranks before kind, incl. in-flight · AC5 touchesResolve guard kept · AC6 cost asymmetry doc
// AC7 real use · AC8 node:test + @test-group engine
//
// Run: scripts/test.sh plugin/test/ready-pool-check.test.mjs

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 13/13 (13 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { analyzeTasks, appendPropagationRecord, assert, bodyAnnotatedNewFiles, bodyUnannotatedNewFiles, buildGitHistoryIndex, cacheFixtureBody, commitsAheadOfRefForTask, execFileSync, fs, isWriteFacePropagationFailure, judgeBodyFreshness, loadLandingIndex, loadParsedTaskStoreAtRef, makeGitWorkspace, normIndex, normStore, os, parseTask, path, readLastPropagationRecords, readTaskFilesAtRefBatch, readTaskStatusAtRef, refTaskIds, rpCachePath, withCacheOff, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("body-freshness: the free functions — ledger read, the narrow failure predicate, the ahead measure (AC2)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-freshfn-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "develop", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeTask(root, "gap-f", { status: "todo", labels: ["gap"], body: bodyUnannotatedNewFiles("gap-f") });
  git("add", ".");
  git("commit", "-q", "-m", "seed");

  // ── No ledger ⇒ no records ⇒ NOT "clean", just "nothing recorded" (缺值 = 未查, 硬规则 6) ──
  assert.equal(readLastPropagationRecords(root).size, 0, "absent ledger ⇒ empty map, never a positive");
  assert.equal(judgeBodyFreshness({ root, id: "gap-f", ref: "develop", lastRecords: readLastPropagationRecords(root) }).status, "fresh");
  assert.equal(
    judgeBodyFreshness({ root, id: "gap-f", ref: "develop", lastRecords: readLastPropagationRecords(root) }).reason,
    "no-propagation-record",
  );

  // ── The predicate is NARROW: two ledger shapes say propagated:false BY DESIGN and are not staleness ──
  assert.equal(isWriteFacePropagationFailure({ propagated: false, changeKind: "must-propagate", branchClass: "other" }), true, "the write-face failure shape");
  assert.equal(isWriteFacePropagationFailure({ propagated: false, changeKind: "must-propagate", branchClass: "task-branch" }), false, "a worktree write: fan-in carries it — NOT a failure");
  assert.equal(isWriteFacePropagationFailure({ propagated: false, changeKind: "self-only", branchClass: "other" }), false, "an AC-tick self-only write: carried by the task's own fan-in");
  assert.equal(isWriteFacePropagationFailure({ propagated: true, changeKind: "must-propagate", branchClass: "other" }), false, "a SUCCESSFUL propagate is not a failure");
  assert.equal(isWriteFacePropagationFailure(null), false, "no record ⇒ not a failure");

  // ── The ahead measure: 0 when the write face holds nothing the ref lacks; >0 after a write face commit ──
  assert.equal(commitsAheadOfRefForTask(root, "develop", "gap-f"), 0, "HEAD == develop ⇒ nothing ahead");
  git("checkout", "-q", "-b", "author");
  writeTask(root, "gap-f", { status: "todo", labels: ["gap"], body: bodyAnnotatedNewFiles("gap-f") });
  git("add", ".");
  git("commit", "-q", "-m", "fix (not propagated)");
  assert.equal(commitsAheadOfRefForTask(root, "develop", "gap-f"), 1, "one commit on the write face the ref lacks");
  assert.equal(commitsAheadOfRefForTask(root, "no-such-ref", "gap-f"), null, "an unresolvable ref ⇒ null (unmeasurable, never a positive)");
  // Direction is native to this measure: a task file the REF has and the write face does not measures 0,
  // so the normal "disk lags develop" case can never be flagged as write-face staleness.
  assert.equal(commitsAheadOfRefForTask(root, "author", "gap-f"), 0, "ref == write face ⇒ 0 (both directions)");
});


test("body-freshness: AC1 — a body dimension's verdict FLIPS with the read source, and the gate's third state fires on the production read source", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-fresh-ac1-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "develop", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  const tasksDir = path.join(root, "tasks");

  // develop: the PRE-FIX body (3 unannotated new files ⇒ touchesResolve=false). This is what the
  // 05:05 filing committed and successfully propagated.
  writeTask(root, "gap-body-stale", { status: "todo", labels: ["gap"], body: bodyUnannotatedNewFiles("gap-body-stale") });
  git("add", ".");
  git("commit", "-q", "-m", "gap-body-stale: filing (propagated)");

  // The WRITE FACE: the FIX body (annotated `(new)` ⇒ touchesResolve=true), committed but NOT
  // propagated — exactly the 05:05:16/17 pair.
  git("checkout", "-q", "-b", "author");
  writeTask(root, "gap-body-stale", { status: "todo", labels: ["gap"], body: bodyAnnotatedNewFiles("gap-body-stale") });
  git("add", ".");
  git("commit", "-q", "-m", "gap-body-stale: fix the (new) annotations (propagation FAILED)");
  appendPropagationRecord(root, {
    ts: "2026-09-14T05:05:17.097Z", id: "gap-body-stale", verb: "task_write",
    changeKind: "must-propagate", branchClass: "other", propagated: false,
  });

  // AC1 first reading — the gate's production read source (the develop ref) judges the PRE-FIX body.
  const rRef = analyzeTasks({ tasksDir, root, cap: 3, floorMult: 1, taskReadRef: "develop" });
  const cRef = rRef.candidates.find((c) => c.id === "gap-body-stale");
  assert.ok(cRef, "the todo is a candidate");
  assert.equal(cRef.touchesResolve, false, "ref read ⇒ the pre-fix body ⇒ touchesResolve=false (the 05:09/05:12 reading, reproduced)");
  // AC2 — and the read source is measurably behind the write face ⇒ THIRD STATE, not that verdict.
  assert.equal(cRef.bodyFreshness, "stale-suspected", "the failed propagate + a write face ahead of the ref ⇒ stale-suspected");
  assert.equal(cRef.bodyEvaluated, false, "not evaluated — the verdict above is not vouched for");
  assert.equal(cRef.bodyFreshnessReason, "write-face-ahead-of-ref");
  assert.equal(cRef.eligible, false, "a body the mechanism cannot vouch for is never promoted on that judgment");
  assert.deepEqual(rRef.promotions.map((p) => p.id), [], "zero promotions from a stale body — this is the fix-worker retry burn's root");
  assert.deepEqual(
    rRef.not_evaluated.map((n) => [n.id, n.freshness, n.reason]),
    [["gap-body-stale", "stale-suspected", "write-face-ahead-of-ref"]],
    "AC2: the output's own word list carries the independent not-evaluated value + its cause",
  );
  assert.equal(rRef.not_evaluated[0].evidence.commitsAhead, 1, "the evidence carries the measured gap");
  assert.equal(rRef.not_evaluated[0].evidence.ts, "2026-09-14T05:05:17.097Z", "…and the ledger record it came from");
  // The withheld promotion is traceable (a no-promotion is never a silent skip).
  assert.ok(rRef.intercepted.some((i) => i.id === "gap-body-stale" && /^body-not-evaluated \(stale-suspected/.test(i.reason)), "the withheld promotion is in `intercepted` with its reason");

  // AC1 second reading — the DISK read source judges the SAME task from the FIX body.
  const rDisk = analyzeTasks({ tasksDir, root, cap: 3, floorMult: 1 });
  const cDisk = rDisk.candidates.find((c) => c.id === "gap-body-stale");
  assert.equal(cDisk.touchesResolve, true, "disk read ⇒ the fix body ⇒ touchesResolve=true — THE SAME DIMENSION, OPPOSITE VERDICT");
  assert.equal(cDisk.bodyFreshness, "fresh", "no ref read ⇒ the disk IS the write face ⇒ nothing can be stale relative to it");
  assert.equal(cDisk.bodyEvaluated, true);
  assert.equal(cDisk.eligible, true, "the fix body is promotion-eligible — it passes the gate by construction (the replay's other half)");
  assert.deepEqual(rDisk.promotions.map((p) => p.id), ["gap-body-stale"], "…and it IS promoted from that read source");

  // AC1 NEGATIVE CONTROL — when the two sides AGREE, both read sources give the SAME verdict.
  // Bring HEAD onto develop (the fix never landed there; it is still the pre-fix body) ⇒ ahead = 0.
  git("checkout", "-q", "develop");
  assert.equal(commitsAheadOfRefForTask(root, "develop", "gap-body-stale"), 0, "control: the write face holds nothing the ref lacks");
  const nRef = analyzeTasks({ tasksDir, root, cap: 3, floorMult: 1, taskReadRef: "develop" });
  const nDisk = analyzeTasks({ tasksDir, root, cap: 3, floorMult: 1 });
  const nCRef = nRef.candidates.find((c) => c.id === "gap-body-stale");
  const nCDisk = nDisk.candidates.find((c) => c.id === "gap-body-stale");
  assert.equal(nCRef.bodyFreshness, "fresh", "control: ref and write face agree ⇒ fresh");
  assert.equal(nCRef.bodyEvaluated, true, "control: evaluated");
  assert.equal(nCRef.touchesResolve, nCDisk.touchesResolve, "control: identical bodies ⇒ identical verdict from either read source");
  assert.equal(nCRef.touchesResolve, false, "control: both read the pre-fix body ⇒ both say false");
  assert.deepEqual(nRef.not_evaluated, [], "control: nothing withheld for staleness");
  assert.deepEqual(nDisk.not_evaluated, [], "control: the disk read never withholds");
});


test("body-freshness: AC2 negative controls — a HEALED propagate and the two by-design `propagated:false` shapes never withhold a promotion", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-fresh-heal-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "develop", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  const tasksDir = path.join(root, "tasks");
  writeTask(root, "gap-healed", { status: "todo", labels: ["gap"], body: bodyAnnotatedNewFiles("gap-healed") });
  git("add", ".");
  git("commit", "-q", "-m", "seed (the fixed body IS on the ref)");

  // The ledger still carries a FAILED write for this task — but the write face holds nothing the ref
  // lacks (the sync healed it). A ledger-only trigger would withhold this promotion forever; the
  // measured gap says there is nothing to withhold. This is the control that makes the trigger
  // takeable-false in the useful direction.
  appendPropagationRecord(root, { ts: "2026-09-14T05:05:17.097Z", id: "gap-healed", verb: "task_write", changeKind: "must-propagate", branchClass: "other", propagated: false });
  const healed = analyzeTasks({ tasksDir, root, cap: 3, floorMult: 1, taskReadRef: "develop" });
  const hc = healed.candidates.find((c) => c.id === "gap-healed");
  assert.equal(hc.bodyFreshness, "fresh", "a healed propagate ⇒ fresh (the ledger record alone is NOT staleness)");
  assert.equal(hc.bodyFreshnessReason, "ref-not-behind-write-face");
  assert.deepEqual(healed.not_evaluated, [], "nothing withheld");
  assert.deepEqual(healed.promotions.map((p) => p.id), ["gap-healed"], "the healthy candidate still promotes");

  // The two by-design `propagated:false` shapes (a worktree write and a self-only AC tick) must not
  // withhold either — they are the majority of the ledger's false values.
  for (const [tag, rec] of [
    ["task-branch", { ts: "2026-09-14T06:00:00.000Z", id: "gap-wt", verb: "task_write", changeKind: "must-propagate", branchClass: "task-branch", propagated: false }],
    ["self-only", { ts: "2026-09-14T06:00:01.000Z", id: "gap-so", verb: "task_write", changeKind: "self-only", branchClass: "other", propagated: false }],
  ]) {
    writeTask(root, rec.id, { status: "todo", labels: ["gap"], body: bodyAnnotatedNewFiles(rec.id) });
    git("add", ".");
    git("commit", "-q", "-m", `${rec.id}: seed`);
    appendPropagationRecord(root, rec);
    const r = analyzeTasks({ tasksDir, root, cap: 3, floorMult: 1, taskReadRef: "develop" });
    const c = r.candidates.find((x) => x.id === rec.id);
    assert.equal(c.bodyFreshness, "fresh", `${tag}: by-design propagated:false ⇒ fresh`);
    assert.equal(c.eligible, true, `${tag}: still eligible (no withholding)`);
  }
});


test("body-freshness: AC2 — an unmeasurable direction is `unknown`, its own value, never `fresh` (硬规则 3b)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-fresh-unknown-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main", "-q", "."); // ⛔ no `develop` branch: the direction cannot be measured
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeTask(root, "gap-unk", { status: "todo", labels: ["gap"], body: bodyAnnotatedNewFiles("gap-unk") });
  git("add", ".");
  git("commit", "-q", "-m", "seed");
  appendPropagationRecord(root, { ts: "2026-09-14T05:05:17.097Z", id: "gap-unk", verb: "task_write", changeKind: "must-propagate", branchClass: "other", propagated: false });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, taskReadRef: "develop" });
  const c = r.candidates.find((x) => x.id === "gap-unk");
  assert.equal(c.bodyFreshness, "unknown", "the trace exists but the direction is unmeasurable ⇒ `unknown`");
  assert.equal(c.bodyFreshnessReason, "ahead-unmeasurable");
  assert.equal(c.bodyEvaluated, false, "unknown is NOT evaluated — it must never share a value with a clean measurement");
  assert.notEqual(c.bodyFreshness, "fresh", "⛔ never folded into `fresh`");
  assert.deepEqual(r.not_evaluated.map((n) => [n.id, n.freshness]), [["gap-unk", "unknown"]], "the word list distinguishes the two not-evaluated causes");
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// PERSISTENT CONTENT-KEYED CACHES
// (tasks/gap-ready-pool-check-is-o-pool-size-and-costs-as-much-as-the-whole-suite)
//
// The checker cost 212.7 h over 33 days — 97.8% of ALL checker cost, the same order as the entire
// test suite. The two dominant terms were both pure functions of git CONTENT recomputed from
// scratch on every poll: the whole-store blob read + YAML parse, and a full-history `git log
// --name-only` dump over the whole repo history. These tests pin the replacement mechanism, and —
// the half that matters — that a cache keyed by git object identity cannot serve content that is
// not that object's content:
//   · equivalence with the uncached read (cold, warm, and after a ref advance)
//   · CONTENT-KEYED, no staleness window (a changed blob is re-read on the very next call)
//   · the ref stays the single source (a stale working tree never wins, 硬规则 4b)
//   · fail-soft (absent / corrupt / version-drifted / kill-switched ⇒ byte-identical result)
//   · the incremental history merge (A..B) == a full rebuild
//   · the AC5 scale regression: on an N≥2000 store the cached call must beat the uncached baseline
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/** A REAL git-backed task store (the caches key on git objects, so a bare directory will not do):
 *  `git init` + one commit carrying `n` tasks. `statusFor(i)` picks each task's status — the
 *  production store is overwhelmingly `done`, and a fixture that is mostly `todo` would measure the
 *  todo-candidate scan instead of the store read. Default branch is forced to `main` so that the
 *  landing-ref resolution (`integration → develop → master`) deterministically finds nothing and the
 *  history index stays out of the way unless a test asks for it. */

/** A realistic task body (~700 B) — big enough that the store read is a measurable share of a call,
 *  and carrying the four artifacts so the analysis exercises its real code paths. */

/** Order-insensitive structural snapshot of a task store / history index, for equality asserts. */

/** Run `fn` with the cache disabled, then restore the previous env value — the kill-switch is the
 *  comparison baseline every fail-soft and regression assert below is measured against. */

/** The cache lives in the repo's GIT DIR (see the loadParsedTaskStoreAtRef doc comment) — never in
 *  the working tree, so it cannot dirty `git status`. Resolved through git, not assumed, because the
 *  fixtures are real repos created by `makeGitWorkspace`. */


test("store cache: the parse-cached ref read equals the uncached batched read, cold and warm", (t) => {
  const { root } = makeGitWorkspace("store-eq", { n: 40 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = refTaskIds(root);

  const expected = new Map();
  for (const [id, raw] of readTaskFilesAtRefBatch(root, "HEAD", ids)) expected.set(id, parseTask(raw));

  const cacheFile = rpCachePath(root, "ready-pool-store-cache.json");
  fs.rmSync(cacheFile, { force: true });
  const cold = loadParsedTaskStoreAtRef(root, "HEAD", ids);
  assert.ok(fs.existsSync(cacheFile), "the first call must WRITE the cache (otherwise there is nothing to be warm)");
  const warm = loadParsedTaskStoreAtRef(root, "HEAD", ids);

  assert.equal(normStore(cold), normStore(expected), "cold cache must reproduce the uncached parse exactly");
  assert.equal(normStore(warm), normStore(expected), "warm cache must reproduce the uncached parse exactly");
  assert.equal(cold.size, expected.size);
});


test("store cache is CONTENT-KEYED: a task whose blob changed is re-read on the very next call", (t) => {
  const { root, git } = makeGitWorkspace("store-ck", { n: 3 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = refTaskIds(root);

  const before = loadParsedTaskStoreAtRef(root, "HEAD", ids);
  assert.match(before.get("gap-cache-fixture-00000").body, /Fixture gap-cache-fixture-00000/, "fixture precondition");

  // Change ONE task's content and commit it — a new blob object, so a content-keyed cache misses on
  // that entry only. This is the property that makes the cache safe: it cannot serve content for an
  // object it has not seen (there is no mtime/TTL window in which a stale answer is possible).
  writeTask(root, "gap-cache-fixture-00000", { status: "todo", labels: ["gap"], body: "## Proposal\nCHANGED-CONTENT-MARKER a paragraph long enough to clear forty non-whitespace chars.\n" });
  git("add", "-A");
  git("commit", "-qm", "change one task");

  const after = loadParsedTaskStoreAtRef(root, "HEAD", ids);
  assert.match(after.get("gap-cache-fixture-00000").body, /CHANGED-CONTENT-MARKER/, "the changed blob must be re-read, not served stale");
  assert.deepEqual(after.get("gap-cache-fixture-00001").body, before.get("gap-cache-fixture-00001").body, "unchanged blobs stay identical");
});


test("store cache serves the REF, never the working tree (硬规则 4b single-source dispatch read)", (t) => {
  const { root } = makeGitWorkspace("store-ref", { n: 2 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = refTaskIds(root);

  const warm = loadParsedTaskStoreAtRef(root, "HEAD", ids); // prime the cache against the committed ref
  assert.equal(readTaskStatusAtRef(root, "HEAD", "gap-cache-fixture-00000"), "done");

  // Dirty the working tree to a DIFFERENT status WITHOUT committing — the ref is unchanged, the disk
  // now disagrees. A cache that had memoized by anything other than object identity could leak the
  // disk value here; the ref must win on both the cached and the uncached path.
  writeTask(root, "gap-cache-fixture-00000", { status: "ready", labels: ["gap"], body: cacheFixtureBody("gap-cache-fixture-00000", 0) });
  assert.match(fs.readFileSync(path.join(root, "tasks", "gap-cache-fixture-00000.md"), "utf8"), /^status:\s*ready/m, "disk now disagrees with the ref");

  assert.match(loadParsedTaskStoreAtRef(root, "HEAD", ids).get("gap-cache-fixture-00000").frontmatterRaw, /^status:\s*done$/m, "cached read must serve the REF");
  assert.match(withCacheOff(() => loadParsedTaskStoreAtRef(root, "HEAD", ids)).get("gap-cache-fixture-00000").frontmatterRaw, /^status:\s*done$/m, "uncached read must serve the REF too");
  assert.equal(loadParsedTaskStoreAtRef(root, "HEAD", ids).size, warm.size);
});


test("store cache fail-soft: absent, corrupt, version-drifted and kill-switched caches all agree", (t) => {
  const { root } = makeGitWorkspace("store-soft", { n: 12 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = refTaskIds(root);
  const cacheFile = rpCachePath(root, "ready-pool-store-cache.json");
  const baseline = normStore(withCacheOff(() => loadParsedTaskStoreAtRef(root, "HEAD", ids)));

  fs.rmSync(cacheFile, { force: true });
  assert.equal(normStore(loadParsedTaskStoreAtRef(root, "HEAD", ids)), baseline, "absent cache ⇒ identical result");
  fs.writeFileSync(cacheFile, "{ this is not json");
  assert.equal(normStore(loadParsedTaskStoreAtRef(root, "HEAD", ids)), baseline, "corrupt cache ⇒ identical result");
  fs.writeFileSync(cacheFile, JSON.stringify({ v: 999, entries: {} }));
  assert.equal(normStore(loadParsedTaskStoreAtRef(root, "HEAD", ids)), baseline, "version drift ⇒ identical result");
  fs.writeFileSync(cacheFile, JSON.stringify({ v: 1, entries: {} }));
  assert.equal(normStore(loadParsedTaskStoreAtRef(root, "HEAD", ids)), baseline, "empty entry set ⇒ identical result (refetch, never a silent gap)");
  assert.equal(normStore(withCacheOff(() => loadParsedTaskStoreAtRef(root, "HEAD", ids))), baseline, "kill-switch ⇒ identical result");
});


test("store cache KEEPS THE UNION: a subset poll must not evict entries a later full poll needs", (t) => {
  // Pruning the cache to the ids the CURRENT call named is only safe when every caller names the whole
  // store. A scoped caller (a subset analysis, an experiment) would otherwise evict everything else and
  // make the next full poll re-read the entire store — the cache would be a net loss for exactly the
  // mixed-workload case it should serve. Pin the union policy by byte-difference, not by timing.
  const { root } = makeGitWorkspace("store-union", { n: 30 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = refTaskIds(root);
  const cacheFile = rpCachePath(root, "ready-pool-store-cache.json");

  loadParsedTaskStoreAtRef(root, "HEAD", ids);                       // full poll — caches all 30
  const afterFull = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  assert.equal(Object.keys(afterFull.entries).length, 30, "full poll caches every task");

  loadParsedTaskStoreAtRef(root, "HEAD", ids.slice(0, 3));          // subset poll — must not evict
  const afterSubset = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  assert.equal(Object.keys(afterSubset.entries).length, 30, "a 3-id poll must not evict the other 27 entries");

  // Interleave the two shapes and assert the entry set is STABLE across it — a re-fetch is not
  // observable as a result change, so the entry set is the only honest reading here.
  loadParsedTaskStoreAtRef(root, "HEAD", ids.slice(0, 3));
  loadParsedTaskStoreAtRef(root, "HEAD", ids);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(cacheFile, "utf8")).entries).length, 30, "interleaving subset and full polls must not shrink the cache");
  assert.equal(normStore(loadParsedTaskStoreAtRef(root, "HEAD", ids)), normStore(withCacheOff(() => loadParsedTaskStoreAtRef(root, "HEAD", ids))), "union-policy cache still agrees with the uncached read");
});


test("store cache SIZE CAP: churn is bounded, but never at the cost of the poll's own entries", (t) => {
  // The union policy bounds growth by BYTES, not by entry set — so the eviction path has to be
  // exercised, not assumed.
  const { root } = makeGitWorkspace("store-cap", { n: 30 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = refTaskIds(root);
  const cacheFile = rpCachePath(root, "ready-pool-store-cache.json");
  const entryCount = () => Object.keys(JSON.parse(fs.readFileSync(cacheFile, "utf8")).entries).length;
  const prevCap = process.env.QUAY_READY_POOL_CACHE_MAX_BYTES;
  t.after(() => { if (prevCap === undefined) delete process.env.QUAY_READY_POOL_CACHE_MAX_BYTES; else process.env.QUAY_READY_POOL_CACHE_MAX_BYTES = prevCap; });

  loadParsedTaskStoreAtRef(root, "HEAD", ids);                       // fill uncapped
  const full = entryCount();
  assert.equal(full, 30, "fixture precondition: 30 entries cached");

  // A SUBSET poll makes the other entries evictable. With a cap that fits only a few, the cache must
  // shed them — and must still answer correctly for the ids it was actually asked about.
  process.env.QUAY_READY_POOL_CACHE_MAX_BYTES = "3000";
  const few = ids.slice(0, 3);
  const sub = loadParsedTaskStoreAtRef(root, "HEAD", few);
  assert.equal(sub.size, 3);
  assert.equal(normStore(sub), normStore(withCacheOff(() => loadParsedTaskStoreAtRef(root, "HEAD", few))), "capped cache still agrees with the uncached read for the polled ids");
  const capped = entryCount();
  assert.ok(capped < full, `the cap must actually bound the entry set: ${full} -> ${capped}`);
  for (const id of few) assert.ok(sub.has(id), `the poll's own id ${id} must survive the cap`);

  // The cap is read PER CALL (a module-level const would freeze at import and be untestable).
  delete process.env.QUAY_READY_POOL_CACHE_MAX_BYTES;
  assert.equal(loadParsedTaskStoreAtRef(root, "HEAD", ids).size, 30, "uncapped again: the full poll is served");
});


test("landing history index: the incremental (A..B) merge equals a full rebuild, and the cache round-trips", (t) => {
  const { root, git } = makeGitWorkspace("land", { n: 0 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  git("commit", "-q", "--allow-empty", "-m", "gap-land-fixture: base");
  for (const [i, subject] of [["a", "gap-land-a: first"], ["b", "gap-land-b: second"], ["c", "gap-land-c: third"]].entries()) {
    fs.writeFileSync(path.join(root, "code", `f${i}.ts`), `// ${subject}\n`);
    git("add", "-A");
    git("commit", "-qm", subject);
  }

  // Prime the cache at an ANCESTOR, then advance — the second load must take the incremental path.
  const atBase = loadLandingIndex(root, "HEAD~3");
  const full = buildGitHistoryIndex(root, { ref: "HEAD" });
  const incremental = loadLandingIndex(root, "HEAD");
  assert.ok(incremental.commits.size > 0, "fixture must produce commits");
  assert.equal(normIndex(incremental), normIndex(full), "incremental (HEAD~3..HEAD) merge must equal a full rebuild");
  assert.notEqual(normIndex(atBase), "", "the ancestor index must be non-empty (otherwise the delta proves nothing)");

  // Warm read: rehydrating the cache must reproduce the same index (paths are rebuilt from byPath —
  // a consumer reading `commits[h].paths` must not silently get an empty set, 硬规则 3b).
  assert.equal(normIndex(loadLandingIndex(root, "HEAD")), normIndex(full), "cache rehydrate must equal the built index");
  for (const [, rec] of incremental.commits) assert.ok(rec.paths instanceof Set, "commits carry a real paths Set");
});


test("landing history index fail-soft: absent / corrupt cache and a rewritten ref all rebuild correctly", (t) => {
  const { root, git } = makeGitWorkspace("land-soft", { n: 0 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  git("commit", "-q", "--allow-empty", "-m", "gap-land-soft: base");
  fs.writeFileSync(path.join(root, "code", "x.ts"), "// x\n");
  git("add", "-A");
  git("commit", "-qm", "gap-land-soft: x");

  const expected = normIndex(buildGitHistoryIndex(root, { ref: "HEAD" }));
  const cacheFile = rpCachePath(root, "ready-pool-history-cache.json");
  fs.rmSync(cacheFile, { force: true });
  assert.equal(normIndex(loadLandingIndex(root, "HEAD")), expected, "absent cache ⇒ full rebuild");
  fs.writeFileSync(cacheFile, "@@@ not json");
  assert.equal(normIndex(loadLandingIndex(root, "HEAD")), expected, "corrupt cache ⇒ full rebuild");

  // A cache whose recorded tip is NOT an ancestor of the ref (rewrite / unrelated history) must
  // rebuild rather than union a bogus range.
  const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  fs.writeFileSync(cacheFile, JSON.stringify({ ...cached, refOid: "0".repeat(40) }));
  assert.equal(normIndex(loadLandingIndex(root, "HEAD")), expected, "non-ancestor tip ⇒ full rebuild");
});


test("AC5 regression: on an N=2000 store the cached call must beat the uncached baseline (red pre-fix)", (t) => {
  // N ≥ 2,000 — the AC's floor. Mostly `done` (the production store's shape: 2,141 tasks, ~20 ready),
  // so the measurement is the STORE read, not the todo-candidate scan.
  const { root } = makeGitWorkspace("scale", {
    n: 2000,
    statusFor: (i) => (i % 200 === 0 ? "ready" : i % 50 === 0 ? "todo" : "done"),
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  const run = () => { const t0 = Date.now(); const r = analyzeTasks({ tasksDir, root, taskReadRef: "HEAD" }); return { ms: Date.now() - t0, r }; };

  // The first call is COLD and both asserts the fixture and populates the cache — it is deliberately
  // not one of the measured runs (a cold call is the thing the cache exists to avoid paying for).
  assert.equal(run().r.scanned, 2000, "fixture precondition: 2000 tasks scanned");

  // min-of-2 per arm: a shared host's load spikes are one-sided (they only ever make a run slower),
  // so the minimum is the robust estimator — and the two arms are INTERLEAVED in ONE process, so
  // load, JIT state and page cache are the same for both. The comparison is therefore "the same work
  // with the cache vs without", not "this commit vs that commit".
  const cachedRuns = [];
  const uncachedRuns = [];
  for (let i = 0; i < 2; i++) {
    cachedRuns.push(run().ms);
    uncachedRuns.push(withCacheOff(() => run().ms));
  }
  const tCached = Math.min(...cachedRuns);
  const tUncached = Math.min(...uncachedRuns);
  const ratio = tCached / tUncached;

  // Report the reading on the PASSING path too — a green run whose numbers nobody can see is the
  // "structure without a reading" shape this repo keeps re-learning (硬规则 3b).
  t.diagnostic(`AC5 N=2000: cached=${tCached}ms uncached=${tUncached}ms ratio=${ratio.toFixed(2)} (pre-fix ratio ≈ 1.0)`);

  // Fail loudly with the numbers if the cached arm did not actually bypass the store read. Pre-fix
  // this test is RED: the kill-switch is a no-op there, so both arms do the identical full-store
  // read + parse and the ratio sits at ~1.0.
  assert.ok(
    tCached < tUncached * 0.75,
    `cached analyzeTasks must beat the uncached baseline on an N=2000 store: cached=${tCached}ms uncached=${tUncached}ms ratio=${ratio.toFixed(2)} (pre-fix ratio ≈ 1.0)`,
  );
});
