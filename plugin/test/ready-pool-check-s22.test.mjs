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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 22/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { analyzeTasks, assert, buildGitHistoryIndex, cacheFixtureBody, fs, loadLandingIndex, loadParsedTaskStoreAtRef, makeGitWorkspace, makeWorkspace, normIndex, normStore, path, readTaskStatusAtRef, refTaskIds, rpCachePath, withCacheOff, writeTask } from "./helpers/ready-pool-check-harness.mjs";
// The new judgment is imported DIRECTLY from the script under test (the shared harness above is out
// of this task's ## Touches, so it must not be edited to re-export it).
import { judgeUnsatisfiableUnannotatedAc, UNSATISFIABLE_AC_DECLARATION_PHRASES } from "../scripts/ready-pool-check.ts";

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

// ── executor-unsatisfiable AC, unannotated (gap-executor-unsatisfiable-ac-unannotated-burns-rounds) ──
// An AC whose OWN text declares that the executor structurally cannot satisfy it ("only a human
// writes this line", "after it is merged into develop", "measure again after landing") but which
// carries NO `（待外部）` annotation. The fail-closed default of the AC-completion gate (unannotated
// ⇒ 待本任务) is CORRECT and unchanged; the defect was on the authoring side, so such a task entered
// `ready`, a worker finished everything else, and every round ended「AC 未全勾」with the whole round
// discarded (生产读数 38 轮 / 其中 10 轮 6 个任务属于此族). The new todo→ready check intercepts it
// BEFORE a worker round is burned, naming the offending item.
//
// The five fixtures below are the production samples VERBATIM (three human-gate + two after-landing).

const VERBATIM_UNSAT_AC_SAMPLES = [
  // 人工关卡 / 只能由人写入 — the three verbatim samples from the production readings
  "AC9 人评审门：ADR 的评审裁定已由人给出…这条 AC 不得由执行者代写",
  "AC7 人工关卡——冒烟验收已由人确认：grep -q '^冒烟验收：通过' …该行只能由人 yale 写入，执行者不得代写",
  "人工关卡——忙时输入基准已由人确认…该行只能由人 yale 写入",
  // 落地后才能满足 — the two verbatim samples of the second family
  "AC6 真实落地（合入 develop 并推送 yaleh 之后）：触发 Desktop Release…",
  "落地后实测复查：sqlite3 … 里 agent 档不再增长",
];

/** A minimal contract-shape todo body whose `## Acceptance Criteria` items are supplied verbatim.
 *  `touched` injects the self-touch (`tasks/<id>.md` in `## Touches`) the promotion gate's C8 needs. */
function unsatAcBody(id, acItems, { proposalExtra = "", acExtra = [] } = {}) {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    ...(proposalExtra ? [proposalExtra] : []),
    "## Contract",
    "measure   ready_pool = `node plugin/scripts/ready-pool-check.ts` stdout 的 pool 字段",
    "band      ready_pool = ≥3",
    "invoke    `node plugin/scripts/ready-pool-check.ts`",
    "control   pool<3 有合格候选 ⇒ 推荐；否则不推荐",
    "resume    分两次提交",
    "## Touches",
    `- tasks/${id}.md`,
    "## Acceptance Criteria",
    ...acItems.map((it) => `- [ ] ${it}`),
    ...acExtra,
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned, definitely long enough content.",
  ].join("\n");
}

test("unsatisfiable-AC judge: the 5 verbatim production samples are HIT unannotated, CLEARED by （待外部） at the item's first-line end (AC1)", () => {
  // Pin the closed enum lives in ONE place and covers the four declared families.
  assert.ok(Array.isArray(UNSATISFIABLE_AC_DECLARATION_PHRASES) && UNSATISFIABLE_AC_DECLARATION_PHRASES.length > 0, "the declaration phrase enum is a non-empty array (single source)");

  const body = unsatAcBody("gap-unsat-ac", VERBATIM_UNSAT_AC_SAMPLES);
  const v = judgeUnsatisfiableUnannotatedAc(body);
  assert.equal(v.evaluated, true, "an AC section IS present ⇒ evaluated");
  assert.equal(v.status, "hit", "unannotated executor-unsatisfiable items ⇒ hit");
  assert.equal(v.hits.length, VERBATIM_UNSAT_AC_SAMPLES.length, `every verbatim sample must be named, got ${JSON.stringify(v.hits)}`);
  for (const s of VERBATIM_UNSAT_AC_SAMPLES) {
    assert.ok(v.hits.includes(s), `hits must name the offending item VERBATIM: ${s}`);
  }

  // The SAME items with `（待外部）` appended at the item's first-line end ⇒ no longer blocked.
  const annotated = unsatAcBody("gap-unsat-ac", VERBATIM_UNSAT_AC_SAMPLES.map((s) => `${s}（待外部）`));
  const va = judgeUnsatisfiableUnannotatedAc(annotated);
  assert.equal(va.evaluated, true);
  assert.equal(va.status, "clean", "the （待外部） annotation clears the item");
  assert.deepEqual(va.hits, [], "no item is named once annotated");
});

test("unsatisfiable-AC gate: an unannotated sample blocks todo→ready and NAMES the item; its annotated twin is promoted-eligible (AC1)", (t) => {
  const root = makeWorkspace("unsat-ac");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-unsat-ac", { status: "todo", labels: ["gap"], body: unsatAcBody("gap-unsat-ac", [VERBATIM_UNSAT_AC_SAMPLES[1]]) });
  writeTask(root, "gap-unsat-ac-ok", { status: "todo", labels: ["gap"], body: unsatAcBody("gap-unsat-ac-ok", [`${VERBATIM_UNSAT_AC_SAMPLES[1]}（待外部）`]) });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const blocked = r.candidates.find((c) => c.id === "gap-unsat-ac");
  const ok = r.candidates.find((c) => c.id === "gap-unsat-ac-ok");

  assert.equal(blocked.eligible, false, "an unannotated executor-unsatisfiable AC must NOT be promotion-eligible");
  assert.equal(blocked.unsatisfiableUnannotatedAc.status, "hit");
  assert.ok(blocked.unsatisfiableUnannotatedAc.hits.includes(VERBATIM_UNSAT_AC_SAMPLES[1]), "the --json candidate NAMES the offending item verbatim");
  const intercepted = r.intercepted.find((i) => i.id === "gap-unsat-ac");
  assert.ok(intercepted && intercepted.reason === "unsatisfiable-ac-unannotated", "the blocked promotion is a TRACEABLE decision (intercepted), not a silent skip");
  assert.ok(intercepted.hits.includes(VERBATIM_UNSAT_AC_SAMPLES[1]), "the intercepted entry carries the item text too");

  assert.equal(ok.eligible, true, "the SAME item annotated （待外部） is promotion-eligible (the check is not a blanket block)");
  assert.equal(ok.unsatisfiableUnannotatedAc.status, "clean");
});

test("unsatisfiable-AC negative control: a plain executable AC is NOT hit — the check must not block every unchecked item (AC2)", (t) => {
  const PLAIN = "node scripts/asr-second-adapter-check.mjs 退出 0";
  const v = judgeUnsatisfiableUnannotatedAc(unsatAcBody("gap-plain-ac", [PLAIN]));
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.hits, [], "an ordinary executable AC carries no declaration ⇒ no hit");

  const root = makeWorkspace("unsat-ac-plain");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-plain-ac", { status: "todo", labels: ["gap"], body: unsatAcBody("gap-plain-ac", [PLAIN]) });
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const c = r.candidates.find((x) => x.id === "gap-plain-ac");
  assert.equal(c.eligible, true, "the plain-AC task stays promotion-eligible (negative control)");
  assert.equal(r.intercepted.some((i) => i.id === "gap-plain-ac" && i.reason === "unsatisfiable-ac-unannotated"), false);
});

test("unsatisfiable-AC position judgment: a declaration in ## Proposal prose or inside a code fence is NOT an AC item hit (AC3)", () => {
  // (a) the phrase in the Proposal paragraph only; the AC item itself is plain.
  const inProposal = judgeUnsatisfiableUnannotatedAc(
    unsatAcBody("gap-pos", ["node scripts/asr-second-adapter-check.mjs 退出 0"], {
      proposalExtra: "Note: the line 该行只能由人 yale 写入 is a QUOTE of another task's AC, not this one's.",
    }),
  );
  assert.deepEqual(inProposal.hits, [], "a declaration in ## Proposal prose must not be read as an AC item hit");

  // (b) the phrase inside a FENCED code block that lives INSIDE the AC section, with a plain item
  //     outside it — a quoted sample is not the AC's own text.
  const fenced = judgeUnsatisfiableUnannotatedAc(
    unsatAcBody("gap-fence", ["node scripts/asr-second-adapter-check.mjs 退出 0"], {
      acExtra: ["", "```text", "AC7 人工关卡——该行只能由人 yale 写入，执行者不得代写", "```"],
    }),
  );
  assert.deepEqual(fenced.hits, [], "a declaration inside a fenced block must not be read as an AC item hit");

  // control: the SAME phrase as an actual (unfenced) AC item IS a hit — so (a)/(b) prove position,
  // not a broken matcher.
  const real = judgeUnsatisfiableUnannotatedAc(unsatAcBody("gap-real", ["AC7 人工关卡——该行只能由人 yale 写入，执行者不得代写"]));
  assert.equal(real.hits.length, 1, "the same phrase as a real AC item is a hit (the position tests above are not vacuous)");
});

test("unsatisfiable-AC third state: a body with no recognizable AC/DoD section is NOT-EVALUATED, never 'clean' (AC4)", () => {
  const noSections = [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   ready_pool = `node plugin/scripts/ready-pool-check.ts` stdout 的 pool 字段",
    "band      ready_pool = ≥3",
    "invoke    `node plugin/scripts/ready-pool-check.ts`",
    "control   pool<3 有合格候选 ⇒ 推荐；否则不推荐",
    "resume    分两次提交",
  ].join("\n");
  const v = judgeUnsatisfiableUnannotatedAc(noSections);
  assert.equal(v.evaluated, false, "no AC/DoD section ⇒ not evaluated");
  assert.equal(v.status, "not-evaluated");
  assert.notEqual(v.status, "clean", "未评估 must NOT share the '合格' value (硬规则③b)");
  assert.notEqual(v.status, "hit");
  assert.equal(v.reason, "no-ac-or-dod-section");

  // The contrast: a body WITH a clean AC section reports the distinct 'clean' value.
  const clean = judgeUnsatisfiableUnannotatedAc(unsatAcBody("gap-clean", ["node scripts/asr-second-adapter-check.mjs 退出 0"]));
  assert.equal(clean.evaluated, true);
  assert.equal(clean.status, "clean");
  assert.notEqual(clean.status, v.status, "the two states are distinguishable");
});
