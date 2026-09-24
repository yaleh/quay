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
// Plan 4's exemption constants + the sentence splitter are imported STRAIGHT from the module (the
// dominant convention here — 543 test files do this) rather than threaded through the shared fixture
// harness: they are the unit under test, not shared fixtures, and the harness is a mirror of this
// module's public surface, not its home.
import { DEDUP_REF_INLINE_MARKER, DEDUP_REF_MARKER, SENTENCE_SPLIT_RE } from "../scripts/ready-pool-check.ts";
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


// ── Plan 4 — the EXEMPTION follows the judgment down to the SENTENCE ──────────────────────────────
// (tasks/gap-prose-prereq-exemption-paragraph-scoped-not-sentence). Plan 1 narrowed the keyword→id
// association from the paragraph to the SENTENCE, but the only exemption (DEDUP_REF_MARKER) stayed
// PARAGRAPH-scoped. The two halves were therefore asymmetric, and the position where citations are
// densest is exactly where the asymmetry bites: `## AC` is ONE paragraph (paragraphs split on blank
// lines; the `- [ ]` items are hard-wrapped, single-spaced lines), so exempting the paragraph would
// exempt the whole AC list — including the genuine prereq declarations AC is the most common home of.


test("Plan 4 scope — the inline marker exempts THAT sentence inside a one-paragraph ## AC block, not the block (能取假, 双向对照)", (t) => {
  const root = makeWorkspace("prereq-inline-scope");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ⚠️ `ready`, not `done`: the exemption claim is only tested if the refs survive the status filter
  // (a `done` ref is dropped for a reason unrelated to what this test asserts).
  writeTask(root, "gap-inline-cited", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-inline-real", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  const tasksDir = path.join(root, "tasks");
  // The PRODUCTION SHAPE, reduced to its bones: one AC paragraph, a CITATION sentence naming the
  // other task's `depends_on` FIELD (traceability), and a GENUINE declaration sentence — each naming
  // a DIFFERENT id, so which sentence contributed is readable from the output.
  const CITATION = "- [ ] AC2 且 `gap-inline-cited` 的生产 `depends_on` 里现在还有第二条活边";
  const GENUINE = "- [ ] AC3 前序任务 `gap-inline-real` 先落地。";
  const acBlock = ["- [ ] AC1 读数见 ## Evidence E1", CITATION, GENUINE].join("\n");
  // ① UNMARKED: both keyword-bearing sentences declare (so the fixture is not vacuously empty).
  assert.deepEqual(
    prosePrereqRefs(acBlock, tasksDir).slice().sort(),
    ["gap-inline-cited", "gap-inline-real"],
    "① unmarked, the citation sentence declares (the defect) AND so does the genuine one",
  );
  // ② MARK ONLY THE CITATION SENTENCE. Sentence-scoped exemption ⇒ the genuine declaration in the
  // SAME paragraph survives. A paragraph-scoped exemption would have emptied the list here, and a
  // whole-block AC exemption (the "AC 块内引用一律不判" shape the DoD forbids) would too.
  const marked = acBlock.replace(CITATION, `${CITATION} ${DEDUP_REF_INLINE_MARKER}`);
  assert.notEqual(marked, acBlock, "the fixture edit must actually land");
  assert.deepEqual(
    prosePrereqRefs(marked, tasksDir),
    ["gap-inline-real"],
    "② the marked sentence is exempt, the UNMARKED genuine sentence in the same paragraph is not",
  );
  // ③ 取假 in the other direction: mark the GENUINE sentence instead (marker INSIDE it, before its
  // `。`) ⇒ the exemption tracks the MARKER, not the wording, and the citation declares again. Stated
  // explicitly because it is the honest property of an author-applied opt-out (the paragraph marker
  // behaves the same way): a mislabelled genuine declaration is the AUTHOR's claim, and this
  // mechanism does not pretend to out-guess it.
  assert.deepEqual(
    prosePrereqRefs(acBlock.replace(GENUINE, `- [ ] AC3 前序任务 \`gap-inline-real\` ${DEDUP_REF_INLINE_MARKER} 先落地。`), tasksDir),
    ["gap-inline-cited"],
    "③ the exemption follows the marker, so mislabelling a genuine declaration is an explicit act",
  );
  // ④ …and the geometry is "IN the sentence", not "on the line": the SAME marker appended AFTER the
  // sentence terminator is its own sentence piece, so it exempts nothing. This is what keeps the
  // scope a SENTENCE rather than drifting to line- or blank-line-scope, and it is the assertion that
  // would go red if the exemption were ever loosened to "the marker appears somewhere nearby".
  assert.deepEqual(
    prosePrereqRefs(`${acBlock}\n${DEDUP_REF_INLINE_MARKER}`, tasksDir).slice().sort(),
    ["gap-inline-cited", "gap-inline-real"],
    "④ a marker on its own line exempts nothing — it must sit IN the sentence it annotates",
  );
});


test("Plan 4 splitter — the inline marker survives SENTENCE_SPLIT_RE (its own `!` is a terminator)", (t) => {
  const root = makeWorkspace("prereq-inline-splitter");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-split-cited", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  const tasksDir = path.join(root, "tasks");
  const sentence = "**此刻尚未落地**；且 `gap-split-cited` 的生产 `depends_on` 里现在还有第二条活边";
  // The hazard, asserted rather than assumed: an HTML comment's `<!` opens with a SENTENCE terminator,
  // so a marker checked on the SPLIT pieces would be reduced to the fragment `-- dedup-ref:inline -->`
  // and would never match — silently inert, which is 硬规则③b's failure shape (indistinguishable from
  // "nothing to exempt"). `prosePrereqScan` neutralises the marker before splitting for exactly this
  // reason; these two assertions are what would go red if that step were dropped.
  assert.ok(SENTENCE_SPLIT_RE.test("!"), "`!` is a sentence terminator in this repo's splitter");
  assert.ok(DEDUP_REF_INLINE_MARKER.includes("!"), "…and the author-facing marker literal contains one");
  assert.deepEqual(
    prosePrereqRefs(`${sentence} ${DEDUP_REF_INLINE_MARKER}`, tasksDir),
    [],
    "…yet the marked sentence is still exempt ⇒ the marker reached the check whole",
  );
});


test("Plan 4 quoting — the marker family is quotation-safe at BOTH scopes, and the two tokens are distinct", (t) => {
  const root = makeWorkspace("prereq-inline-quote");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-quote-cited", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  const tasksDir = path.join(root, "tasks");
  const sentence = "且 `gap-quote-cited` 的生产 `depends_on` 里还有第二条活边";
  // Both markers are read off an inline-code-stripped copy, and quoting a marker in this repo's prose
  // means wrapping it in backticks (every dedup-ref test does) ⇒ a QUOTED mention never exempts.
  assert.deepEqual(
    prosePrereqRefs(`${sentence} 见 \`${DEDUP_REF_INLINE_MARKER}\` 约定。`, tasksDir),
    ["gap-quote-cited"],
    "a backtick-wrapped mention of the inline marker does not exempt the sentence it is quoted in",
  );
  assert.deepEqual(
    prosePrereqRefs(`见 \`${DEDUP_REF_MARKER}\` ${sentence}`, tasksDir),
    ["gap-quote-cited"],
    "…and the paragraph marker's existing quotation guard is unchanged",
  );
  // The two tokens must stay mutually exclusive: if the inline marker STARTED WITH the paragraph
  // marker, a paragraph opened with the inline one would silently become paragraph-exempt, i.e. the
  // sentence scope would widen to the very scope this task exists to escape.
  assert.equal(
    DEDUP_REF_INLINE_MARKER.startsWith(DEDUP_REF_MARKER),
    false,
    "the sentence marker must not be readable as the paragraph marker",
  );
});
