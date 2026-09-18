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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 18/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { PRE_EDGE_AC207_SNIPPET, SAMPLE_1_DENYING_PARA, SAMPLE_1_GENUINE_PARA, SAMPLE_2_PARA, SAMPLE_IDS, assert, declaresPrereq, fourArtifactBody, fs, makeWorkspace, path, prosePrereqGap, prosePrereqRefs, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("prosePrereqRefs finds backtick-cited ids inside 阻塞 paragraphs (AC2)", (t) => {
  const root = makeWorkspace("prereq-backtick");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = [
    "gap-driver-resource-gate-path-anchored-at-root-third-party",
    "gap-shipped-profiles-missing-worker-roles",
    "gap-promotion-driver-ready-pool-check-path-third-party",
  ];
  // ⚠️ status `ready`, not `done`: this test is about the CITATION FORM (backtick spans inside 阻塞
  // paragraphs), and a `done` ref is now dropped by the status filter before the citation form is
  // reached (gap-prose-prereq-refs-should-exclude-done-referenced-tasks) — which would make the
  // assertion below vacuous. The snippet's own prose ("已 done 落 develop") is the verbatim
  // production text and is not what this test measures.
  for (const id of ids) writeTask(root, id, { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  const refs = prosePrereqRefs(PRE_EDGE_AC207_SNIPPET, path.join(root, "tasks"));
  assert.ok(refs.length >= 1, `must find ≥1 backtick-cited id (got ${refs.length})`);
  assert.deepEqual(refs.slice().sort(), ids.slice().sort(), "all three backtick-cited ids are recovered");
  for (const r of refs) assert.ok(fs.existsSync(path.join(root, "tasks", `${r}.md`)), `${r} must resolve to a real task file`);
});


test("non-prereq backtick mentions are NOT refs — 同族于 / 参见 (AC3)", (t) => {
  const root = makeWorkspace("prereq-negative");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-ac207-e2e-target-driver-driven-real-commit-task-done", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  assert.deepEqual(prosePrereqRefs("同族于 `gap-ac207-e2e-target-driver-driven-real-commit-task-done` 的缺陷形态。", path.join(root, "tasks")), [], "同族于 is not a prereq declaration");
  assert.deepEqual(prosePrereqRefs("参见 `gap-ac207-e2e-target-driver-driven-real-commit-task-done` 的判据。", path.join(root, "tasks")), [], "参见 is not a prereq declaration");
});


test("sibling / heritage / example mentions inside a keyword paragraph are NOT prereq refs (precision)", (t) => {
  const root = makeWorkspace("prereq-sibling");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ⚠️ all three `ready`, NOT `done`: a done ref is dropped by the STATUS filter, so a `done` fixture
  // would make every assertion below pass without the sibling guard doing anything (the guard is what
  // this test measures — see gap-prose-prereq-refs-should-exclude-done-referenced-tasks).
  writeTask(root, "gap-x", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-y", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-z", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // Each paragraph carries a prereq keyword (so it passes the gate) but the refs are sibling/heritage
  // mentions, not the object of the blocking — they must be dropped.
  const body = [
    "第四个阻塞仍未解除——同期另立两任务 `gap-x`（ready）与 `gap-y`（ready），均未 done。",
    "第三个阻塞已解除——已另立 `gap-x` 续做剩余锚点。",
    "此外 `gap-z` 亦已 done 并落 develop。",
  ].join("\n\n");
  assert.deepEqual(prosePrereqRefs(body, path.join(root, "tasks")), [], "sibling/heritage mentions are not prereq refs");
  // The genuine blocking form IS still a ref: 阻塞 names the blocker directly.
  const genuine = "第四阻塞 `gap-x` 仍未解除。";
  assert.deepEqual(prosePrereqRefs(genuine, path.join(root, "tasks")), ["gap-x"], "阻塞 X is a prereq ref");
});


test("backtick-cited prose prereqs fully covered by depends_on ⇒ prosePrereqGap == [] (AC4)", (t) => {
  const root = makeWorkspace("prereq-ac4");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ⚠️ `ready`, not `done`: the claim under test is "the EDGES cover the prose prereqs", so the refs
  // must survive the status filter for the edge set to be what produces the empty gap.
  writeTask(root, "gap-prereq-a", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-prereq-b", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-edged", {
    status: "ready",
    labels: ["gap"],
    parent: null,
    children: [],
    body: [
      "## Proposal",
      "A proposal paragraph that is definitely more than forty non-whitespace chars in total length.",
      "**Do not dispatch until**: `gap-prereq-a` and `gap-prereq-b` both land.",
      "## Acceptance Criteria",
      "- [ ] an AC item that is long enough",
    ].join("\n"),
  });
  const file = path.join(root, "tasks", "gap-edged.md");
  const raw = fs.readFileSync(file, "utf8").replace("parent: null", "depends_on:\n  - gap-prereq-a\n  - gap-prereq-b\nparent: null");
  fs.writeFileSync(file, raw);
  const fm = raw.match(/^---\n([\s\S]*?)\n---/)[1];
  const bodyOnly = raw.slice(raw.indexOf("\n\n") + 2);
  assert.deepEqual(prosePrereqGap(bodyOnly, fm, path.join(root, "tasks")), [], "edges cover the prose prereqs ⇒ no gap");
});

// ── prose-prereq SCOPE + POLARITY (gap-prose-prereq-negation-blind-and-paragraph-scoped) ──────────
// The detector above scoped the keyword→id association to the whole PARAGRAPH and tested the keyword
// with a bare `test()` — so one keyword occurrence claimed every id in the paragraph, and an
// explicitly DENYING sentence was read as a declaring one. Two production tasks stalled at todo on
// exactly this (one of them the only fix for a deterministic full-suite red), because `quay-file-task`
// ORDERS a dedup backlink to the related-but-distinct ids and such a paragraph routinely says
// "⛔ 不另立 depends_on 边" / "⛔ 不作为本任务的阻塞". AC1 reproduces both verbatim.

/** The two production trigger paragraphs, verbatim (git: gap-outer-retirement-… line 55 at
 *  3d5dd27967c61e9ab6d36568d1b38c2f49a008eb; gap-ac240-… line 43 at ee8b99648). The ids they cite
 *  must exist as fixture tasks for the resolution filter to keep them. */


test("AC1 — the two production deny-paragraphs no longer harvest ids; the genuine 前置 paragraph still does", (t) => {
  const root = makeWorkspace("prereq-samples");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ⚠️ `ready`, not `done`: the samples' own prose labels some ids "done" (verbatim production text),
  // but the scope/polarity claims below are only tested if the refs survive the status filter — a
  // `done` fixture is dropped for a reason unrelated to what this test asserts
  // (gap-prose-prereq-refs-should-exclude-done-referenced-tasks).
  for (const id of SAMPLE_IDS) writeTask(root, id, { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  const tasksDir = path.join(root, "tasks");
  // Sample 1 paragraph alone: pre-fix 2 ids (⛔ 不作为本任务的阻塞 harvested both). The paragraph is
  // one sentence carrying the DENIAL and both ids, so only polarity — not scope — can drop them.
  assert.deepEqual(prosePrereqRefs(SAMPLE_1_DENYING_PARA, tasksDir), [], "⛔ 不作为本任务的阻塞 denies — neither id is a prereq");
  // Sample 2 paragraph alone: pre-fix 5 ids, and NOT ONE line in it carries both a keyword and an id
  // (the only keyword hit is `depends_on` inside ⛔ 不另立 depends_on 边; the 3 ids of the first
  // sentence come from a sentence with no keyword at all — scope drops those, polarity the last two).
  assert.deepEqual(prosePrereqRefs(SAMPLE_2_PARA, tasksDir), [], "dedup backlink + ⛔ 不另立 depends_on 边 ⇒ no prereq refs");
  // The genuine 前置 sentence in the same production task is NOT collateral damage:
  assert.deepEqual(
    prosePrereqRefs(SAMPLE_1_GENUINE_PARA, tasksDir),
    ["gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable"],
    "「它是 `X` 的前置」 is still a prereq declaration",
  );
});


test("AC2 — keyword→id association is SENTENCE-scoped, both directions (能取假)", (t) => {
  const root = makeWorkspace("prereq-scope");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ⚠️ `ready`, not `done` — the SCOPE claim needs refs that survive the status filter.
  writeTask(root, "gap-para-same-sentence", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-para-other-sentence", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // ① keyword and id in the SAME sentence ⇒ still a prereq. ② keyword and id in the same PARAGRAPH
  // (single newlines, no blank line) but DIFFERENT sentences ⇒ NOT a prereq.
  const body = [
    "**Do not dispatch until** `gap-para-same-sentence` lands.",
    "**Do not dispatch until** the full suite is green.",
    "`gap-para-other-sentence` 只是同段的举例引用，与本条不相干。",
  ].join("\n");
  const refs = prosePrereqRefs(body, path.join(root, "tasks"));
  assert.equal(refs.includes("gap-para-same-sentence"), true, "① same-sentence id is a prereq ref");
  assert.equal(refs.includes("gap-para-other-sentence"), false, "② same-paragraph different-sentence id is NOT");
  // ② 取假：the same paragraph with the id moved INTO the keyword sentence flips it back.
  const flipped = "**Do not dispatch until** `gap-para-other-sentence` lands.";
  assert.deepEqual(prosePrereqRefs(flipped, path.join(root, "tasks")), ["gap-para-other-sentence"], "② flipping the scope back re-arms the ref");
});


test("AC3 — an explicitly NEGATED keyword declares nothing; removing the negation re-arms it (能取假)", (t) => {
  const root = makeWorkspace("prereq-negation");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ⚠️ `ready`, not `done` — the POLARITY claim needs refs that survive the status filter.
  writeTask(root, "gap-neg-a", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-neg-b", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  const tasksDir = path.join(root, "tasks");
  // ① the denial ⇒ not a prereq (⛔ 不作为本任务的阻塞 is sample 1's real wording; ⛔ 不另立 depends_on 边
  //    is sample 2's). The second is asserted at the polarity layer directly, because `另立` alone would
  //    also be caught by the sibling guard — declaresPrereq must say NO on its own.
  assert.deepEqual(prosePrereqRefs("⛔ 不作为本任务的阻塞：`gap-neg-a`。", tasksDir), [], "① denial ⇒ not a prereq");
  assert.equal(declaresPrereq("⛔ 不另立 depends_on 边：`gap-neg-b`"), false, "① ⛔ 不另立 depends_on 边 denies at the polarity layer");
  // ② 取假：drop the negation word ⇒ the same sentence declares again.
  assert.deepEqual(prosePrereqRefs("依赖 `gap-neg-a` 先落地。", tasksDir), ["gap-neg-a"], "② 「依赖 `gap-neg-a` 先落地」 re-arms it");
  assert.equal(declaresPrereq("阻塞复核：`gap-neg-a` 仍未落 develop。"), true, "② 阻塞 without a negation marker declares");
});


test("AC3b — the negation guard is LOCAL: unrelated 不 does not disarm a genuine declaration", () => {
  // Negation is judged on the window IMMEDIATELY before the keyword occurrence, so:
  assert.equal(declaresPrereq("不得派发"), true, "the negation inside the keyword 不得派发 is NOT a negation OF it");
  assert.equal(declaresPrereq("⛔ 不要跳过：前置任务 `gap-x`"), true, "a marker in an earlier clause does not disarm the keyword");
  assert.equal(declaresPrereq("不得不先完成 `gap-x`"), true, "the idiom 不得不 is an affirmative obligation, not a negation");
  assert.equal(declaresPrereq("do not dispatch until `gap-x` lands"), true, "the English keyword keeps its own `not`");
  // …and the denials it must catch:
  assert.equal(declaresPrereq("非前置声明"), false, "非 + 前置 is a denial");
  assert.equal(declaresPrereq("无需前置"), false, "无需 + 前置 is a denial");
  assert.equal(declaresPrereq("不作为本任务的阻塞"), false, "不作为…的 + 阻塞 is a denial");
});
