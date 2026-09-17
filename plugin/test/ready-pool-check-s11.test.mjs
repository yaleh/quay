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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 11/13 (13 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { PRE_EDGE_AC207_SNIPPET, SAMPLE_1_DENYING_PARA, SAMPLE_1_GENUINE_PARA, SAMPLE_2_PARA, SAMPLE_IDS, SUPERSEDED_MARKER_RE, analyzeTasks, assert, declaresPrereq, fourArtifactBody, fs, makeWorkspace, path, prosePrereqGap, prosePrereqRefs, withSelfTouch, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("prosePrereqRefs finds backtick-cited ids inside 阻塞 paragraphs (AC2)", (t) => {
  const root = makeWorkspace("prereq-backtick");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = [
    "gap-driver-resource-gate-path-anchored-at-root-third-party",
    "gap-shipped-profiles-missing-worker-roles",
    "gap-promotion-driver-ready-pool-check-path-third-party",
  ];
  for (const id of ids) writeTask(root, id, { status: "done", labels: ["gap"], body: fourArtifactBody() });
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
  writeTask(root, "gap-x", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-y", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-z", { status: "done", labels: ["gap"], body: fourArtifactBody() });
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
  writeTask(root, "gap-prereq-a", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-prereq-b", { status: "done", labels: ["gap"], body: fourArtifactBody() });
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
  for (const id of SAMPLE_IDS) writeTask(root, id, { status: "done", labels: ["gap"], body: fourArtifactBody() });
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
  writeTask(root, "gap-para-same-sentence", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-para-other-sentence", { status: "done", labels: ["gap"], body: fourArtifactBody() });
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
  writeTask(root, "gap-neg-a", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-neg-b", { status: "done", labels: ["gap"], body: fourArtifactBody() });
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


test("AC4 — a paragraph OPENED with <!-- dedup-ref --> is traceability, not a prereq claim (能取假)", (t) => {
  const root = makeWorkspace("prereq-dedupref");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-dd-a", "gap-dd-b", "gap-dd-c"]) writeTask(root, id, { status: "done", labels: ["gap"], body: fourArtifactBody() });
  const tasksDir = path.join(root, "tasks");
  const backlink = "前置追溯：`gap-dd-a`、`gap-dd-b`、`gap-dd-c`（与本条机制不同，仅作查重追溯）。";
  // ② without the marker the paragraph still declares (so the fixture is not vacuously empty):
  assert.deepEqual(
    prosePrereqRefs(backlink, tasksDir).slice().sort(),
    ["gap-dd-a", "gap-dd-b", "gap-dd-c"],
    "without the marker all three ids are harvested",
  );
  // ① with the marker the whole paragraph is exempt:
  assert.deepEqual(prosePrereqRefs(`<!-- dedup-ref --> ${backlink}`, tasksDir), [], "the marker exempts the paragraph wholesale");
  // and the exemption is anchored at the paragraph START — a task merely quoting the marker mid-sentence
  // (e.g. this task's own AC4) does not accidentally exempt the paragraph it quotes it in:
  assert.deepEqual(
    prosePrereqRefs(`${backlink} 见 \`<!-- dedup-ref -->\` 约定。`, tasksDir).slice().sort(),
    ["gap-dd-a", "gap-dd-b", "gap-dd-c"],
    "a mid-sentence QUOTE of the marker does not exempt",
  );
});


test("AC3c — the negation guard's MIRROR arm: a denial AFTER the keyword disarms it (能取假, 双向对照)", () => {
  // Blind spot ① of gap-prose-prereq-negation-window-is-before-keyword-only-and-sibling-markers-are-
  // chinese-only: NEGATION_MARKER_RE only ever looked BEFORE the keyword, so the English order
  // ("Depends_on: none …") was structurally unseeable — `Depends_on` opens the sentence, the
  // before-window has nothing to match, and the sentence reads as a DECLARATION.
  // ① the verbatim production sentence (tasks/gap-driver-restart-unreliable-legacy-to-anchor-
  //    migration.md:48). Pre-fix this returned TRUE and refused that task promotion for rounds
  //    378-382+ on `prosePrereqGap=[gap-driver-status-…]`, naming an already-`done` task.
  assert.equal(
    declaresPrereq(
      "Depends_on: none (independent finding; related-but-not-duplicate of `gap-driver-status-misreports-anchor-hosted-kind-as-down`, filed moments earlier this same session — that one is a read-side status-reporting defect, this one is a write-side restart-execution-reliability defect; do not merge the two).",
    ),
    false,
    "① the production 'Depends_on: none (…)' sentence is a DENIAL, not a declaration",
  );
  assert.equal(declaresPrereq("Depends on nothing; DIR-110 follows"), false, "① 'Depends on nothing' denies");
  assert.equal(declaresPrereq("depends_on: none"), false, "① 'depends_on: none' denies");
  // ② 取假 (the other direction) — the SAME shapes with the denial removed re-arm:
  assert.equal(declaresPrereq("Depends_on: `gap-x`"), true, "② 'Depends_on: `gap-x`' declares");
  assert.equal(declaresPrereq("Depends on nothing else in this split"), false, "① 'nothing else' still denies");
  // ③ NEGATIVE CONTROLS — a qualifier after the keyword is NOT a denial of it. The first is a REAL
  //    corpus line (tasks/gap-unified-frontmatter-parser.md:30); `(` is not a field separator, so the
  //    parenthetical is not read as disarming `depends_on`.
  assert.equal(
    declaresPrereq("- [x] task_write MCP schema explicitly lists depends_on (not just via extra escape hatch)"),
    true,
    "③ a parenthetical qualifier after the keyword does not disarm it (real corpus line)",
  );
  assert.equal(declaresPrereq("先完成 `gap-x` not optional。"), true, "③ a genuine prereq + trailing 'not' is not disarmed");
  assert.equal(declaresPrereq("先完成 `gap-x`；none of the other tasks matter。"), true, "③ a denial in a LATER clause cannot reach back");
  // ④ word boundaries: `no`/`not` must not be read out of these
  assert.equal(declaresPrereq("depends on `gap-x` nonetheless we proceed."), true, "④ 'nonetheless' is not 'no'");
  assert.equal(declaresPrereq("阻塞 not-yet-landed 的 `gap-x`。"), true, "④ 'not-yet-landed' is not 'not'");
  assert.equal(declaresPrereq("阻塞 note 里的 `gap-x`。"), true, "④ 'note' is not 'no'");
});


test("AC3d — sibling markers are not English-blind: `related-but-not-duplicate of` etc. (能取假, 双向对照)", (t) => {
  // Blind spot ② of the same task: SIBLING_MENTION_RE's vocabulary was Chinese-only, so an English
  // traceability phrase ("related-but-not-duplicate of `gap-x`") — semantically identical to
  // "同族于 `gap-x`" — was read as a genuine prereq.
  const root = makeWorkspace("prereq-sibling-en");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-real-prereq", "gap-sib-en", "gap-cross-binds-next"]) {
    writeTask(root, id, { status: "done", labels: ["gap"], body: fourArtifactBody() });
  }
  const tasksDir = path.join(root, "tasks");
  // Each body is ONE sentence (`；` does not split) carrying a NON-negated 阻塞 keyword, so the REF-
  // level sibling guard is the only thing that can drop the sibling id: `gap-real-prereq` is the
  // always-kept control, `gap-sib-en` the id the marker introduces.
  const cases = [
    ["related-but-not-duplicate of", "阻塞 `gap-real-prereq`；related-but-not-duplicate of `gap-sib-en`。"],
    ["not a duplicate of", "阻塞 `gap-real-prereq`；not a duplicate of `gap-sib-en`。"],
    ["sibling of", "阻塞 `gap-real-prereq`；sibling of `gap-sib-en`。"],
    ["counterpart", "阻塞 `gap-real-prereq`；the INTERNAL counterpart to `gap-sib-en`。"],
    ["see also", "阻塞 `gap-real-prereq`；see also `gap-sib-en`。"],
    ["unrelated to", "阻塞 `gap-real-prereq`；unrelated to `gap-sib-en`。"],
  ];
  for (const [marker, body] of cases) {
    assert.deepEqual(
      prosePrereqRefs(body, tasksDir),
      ["gap-real-prereq"],
      `① the English marker \`${marker}\` filters the id it introduces, keeping the genuine prereq`,
    );
  }
  // ② 取假: drop the marker ⇒ the same sentence harvests BOTH ids again (the fixture is not
  //    vacuously empty, and the filter is what does the work).
  assert.deepEqual(
    prosePrereqRefs("阻塞 `gap-real-prereq`；`gap-sib-en` 与本条同期立案。", tasksDir),
    ["gap-real-prereq", "gap-sib-en"],
    "② without the marker both ids are harvested",
  );
  // ③ CROSS-BIND SAFETY — the English arm looks BEFORE the span only. A marker sitting AFTER one id
  //    must not drop a DIFFERENT id: here `unrelated to` follows `gap-sib-en`, and the id after it
  //    (`gap-cross-binds-next`) must survive. Under a symmetric ±window it would be a false negative.
  assert.deepEqual(
    prosePrereqRefs("阻塞 `gap-real-prereq`；unrelated to `gap-sib-en`, then 阻塞 `gap-cross-binds-next`。", tasksDir),
    ["gap-real-prereq", "gap-cross-binds-next"],
    "③ a marker after id A must not drop id B (before-only arm — no false negative)",
  );
  // ④ REGRESSION — the Chinese arm keeps its pre-existing behaviour (the ±16 window and word list are
  //    untouched by this task; the pre-existing `同族于 / 参见` and `sibling / heritage` tests above
  //    cover the rest). Concrete discriminable value: the 同族于 marker drops exactly the id it
  //    introduces and the genuine prereq survives.
  assert.deepEqual(
    prosePrereqRefs("同族于 `gap-sib-en`，阻塞 `gap-real-prereq`。", tasksDir),
    ["gap-real-prereq"],
    "④ the Chinese 同族于 marker is unchanged: drops its own id, keeps the genuine prereq",
  );
});


test("AC6 negative control — a GENUINE prose prereq with no edge is STILL caught and still blocks promotion", (t) => {
  const root = makeWorkspace("prereq-ac6");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-real-prereq", { status: "todo", labels: ["gap"], body: fourArtifactBody() });
  const genuineBody = [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "前序任务 `gap-real-prereq` 先落地，之后本任务才可派发。",
    "## Contract",
    "measure   ready_pool = `node plugin/scripts/ready-pool-check.ts` stdout 的 pool 字段",
    "band      ready_pool = true",
    "invoke    `node plugin/scripts/ready-pool-check.ts`",
    "control   ok",
    "resume    前置 done 后再 dispatch",
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough to count as a real acceptance criterion box",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned, definitely long enough content.",
  ].join("\n");
  writeTask(root, "gap-ac6-cand", { status: "todo", labels: ["gap"], parent: null, children: [], body: withSelfTouch(genuineBody, "gap-ac6-cand") });
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, targetedId: "gap-ac6-cand" });
  assert.deepEqual(r.targeted_promotion.checks.prosePrereqGap, ["gap-real-prereq"], "a real same-sentence 前序 prereq is still detected");
  assert.equal(r.targeted_promotion.eligible, false, "…and the task is still not eligible (no widening into 恒绿)");
  const cand = r.candidates.find((c) => c.id === "gap-ac6-cand");
  assert.equal(cand.eligible, false, "bulk promotion rejects it too");
  assert.deepEqual(cand.prosePrereqGap, ["gap-real-prereq"]);
});

// ── AC46 — pool-layer static criteria into the todo→ready gate + ready↔todo revaluation executor ──
// (tasks/gap-ac46-pool-criteria-in-gate-plus-revaluation-executor)
//   AC1  compound / self-touch / deps / touches-resolve / artifacts gate the todo→ready promotion
//        ITSELF (rejected at the gate with a reason, not deferred after entering the pool).
//   AC2  bidirectional revaluation executor: re-runs the static conditions on the ready pool; decay ⇒
//        ready.back="todo" auto-executes with a grep-able 阻碍原因 + 去向 record.
//   AC3  negative control: a clean pool revaluates to zero; a decayed task is reported explicitly
//        (never a silent stay).
//   AC5  production negative-control samples (real task bodies, 2026-08-13 定向晋升 operation):
//        compound + self-touch must be REJECTED, the three clean tasks ADMITTED.


test("SUPERSEDED_MARKER_RE: bold marker matches; bare word does not (position-based, hard-rule ②)", () => {
  assert.equal(SUPERSEDED_MARKER_RE.test("> **SUPERSEDED / 作废** premise deleted by a human ruling."), true, "bold marker matches");
  assert.equal(SUPERSEDED_MARKER_RE.test("**SUPERSEDED**"), true, "bare bold marker matches");
  assert.equal(SUPERSEDED_MARKER_RE.test("SUPERSEDED"), false, "bare word is NOT a marker");
  assert.equal(SUPERSEDED_MARKER_RE.test("the superseded-capability checker runs in CI"), false, "discussing the category is NOT a marker");
  assert.equal(SUPERSEDED_MARKER_RE.test("some superseded mechanism"), false, "lowercase word in prose is NOT a marker");
});
