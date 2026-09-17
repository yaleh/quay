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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 19/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { SUPERSEDED_MARKER_RE, __dirname, analyzeTasks, assert, buildTargetedPromotion, declaresPrereq, fourArtifactBody, fs, gapTask, makeWorkspace, parseTask, path, prosePrereqGap, prosePrereqRefs, withSelfTouch, writeTask } from "./helpers/ready-pool-check-harness.mjs";

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


test("AC46 marker fix: a candidate DISCUSSING superseded is promotable; a candidate CARRYING the marker is not (both directions)", (t) => {
  const root = makeWorkspace("superseded-marker-fix");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "a.ts"), "export const a = 1;\n");
  writeTask(root, "gap-discusses-superseded", gapTask("gap-discusses-superseded", {
    body: fourArtifactBody({
      touches: ["- code/a.ts", "- tasks/gap-discusses-superseded.md"],
      extra: "\nThe superseded-capability checker runs in the full-suite gate. This task is NOT superseded — it is live work.\n",
    }),
  }));
  writeTask(root, "gap-carries-marker", gapTask("gap-carries-marker", {
    body: fourArtifactBody({
      touches: ["- code/a.ts", "- tasks/gap-carries-marker.md"],
      extra: "\n> **SUPERSEDED / 作废** premise deleted by a human ruling.\n",
    }),
  }));
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 1, floorMult: 1 }); // floor 1, pool 0 → scan candidates
  const discusses = r.candidates.find((c) => c.id === "gap-discusses-superseded");
  const carries = r.candidates.find((c) => c.id === "gap-carries-marker");
  assert.ok(discusses, "discuss candidate is scanned");
  assert.equal(discusses.superseded, false, "discussing the word is NOT superseded (before the fix the bare word wrongly blocked it)");
  assert.equal(discusses.eligible, true, "discuss candidate is promotable");
  assert.ok(carries, "marker candidate is scanned");
  assert.equal(carries.superseded, true, "carrying the marker IS superseded");
  assert.equal(carries.eligible, false, "marker candidate is not promotable");
  // The marker candidate is recorded in `intercepted` with the superseded reason (traceable no-promotion).
  assert.ok(r.intercepted.some((i) => i.id === "gap-carries-marker" && i.reason === "superseded"), "superseded intercept recorded");
});


test("AC5 production negative control: the promotion gate rejects compound/self-touch samples and admits the clean three (real task bodies)", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tasksDir = path.join(repoRoot, "tasks");
  // reject self-touch sample = DIR-001: a REAL direction-recording task ("仅记录方向", no concrete
  // Touches) that structurally lacks its own tasks/DIR-001.md self-touch and is stable — the previous
  // sample (gap-worktree-node-modules-inconsistent-self-verify) was removed because A22's fix-
  // unqualified legitimately ADDED its self-touch (86dacd51); DIR-127 met the same fate (self-touch
  // added when prepared for dispatch, 2026-08-14) → both became false rejects. DIR-001 is a done
  // direction record (A22 never promotes done → can never gain a self-touch). Pick only tasks that
  // can never gain a self-touch (direction records, not execution candidates); verify with
  // buildTargetedPromotion before swapping.
  const rejectIds = ["gap-quay-has-never-self-hosted-its-own-cold-start", "DIR-001"];
  // gap-spec11 was previously an admit sample but the prose-prereq widen (this task) now sees its
  // "试点 `gap-spec-11-…-pilot` 已 done … 它是停全局轮的唯一前置" paragraph as a prose prereq
  // (pilot is a backtick-cited predecessor with no depends_on edge). Replaced with a genuinely-clean
  // execution candidate (gap-ac120: eligible, prosePrereqGap=[], self-touch present, not compound).
  const admitIds = ["gap-ac120-suite-bucket-attribution-mechanism", "gap-slot-refill-clique-ignores-landed-touches", "gap-landing-target-branch-consistency-check"];
  // Build allTasks from the REAL task files (REAL statuses — a dependency that is done stays done, so
  // the gate's deps check resolves; the negative-control SAMPLES are real, never fabricated).
  const allTasks = new Map();
  for (const f of fs.readdirSync(tasksDir).filter((x) => x.endsWith(".md"))) {
    const id = f.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(tasksDir, f), "utf8");
    const task = parseTask(raw);
    task.id = id;
    task.status = (raw.match(/^status:\s*(\S+)/m) || [])[1] || "";
    allTasks.set(id, task);
  }
  for (const id of rejectIds) {
    assert.ok(allTasks.has(id), `reject sample ${id} exists in the real store`);
    const task = { ...allTasks.get(id), status: "todo" }; // the promotion gate evaluates todo→ready
    const tp = buildTargetedPromotion(id, task, repoRoot, allTasks);
    assert.equal(tp.eligible, false, `${id} must be REJECTED by the gate`);
    if (id === "gap-quay-has-never-self-hosted-its-own-cold-start") {
      assert.equal(tp.checks.compound, true, `${id} is role:compound → rejected for compound`);
    } else {
      assert.equal(tp.checks.selfTouchOk, false, `${id} lacks its own self-touch → rejected for self-touch`);
    }
  }
  for (const id of admitIds) {
    assert.ok(allTasks.has(id), `admit sample ${id} exists in the real store`);
    const task = { ...allTasks.get(id), status: "todo" };
    const tp = buildTargetedPromotion(id, task, repoRoot, allTasks);
    assert.equal(tp.eligible, true, `${id} must be ADMITTED by the gate`);
    assert.equal(tp.checks.superseded, false, `${id} is not superseded (marker-fix direction: discussion ≠ marker)`);
    assert.equal(tp.checks.compound, false, `${id} is not compound`);
    assert.equal(tp.checks.selfTouchOk, true, `${id} has its self-touch`);
  }
});


test("AC1: compound and self-touch-missing todo candidates are rejected at the bulk promotion gate (not deferred after ready)", (t) => {
  const root = makeWorkspace("ac1-gate");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "foo.ts"), "export const foo = 1;\n");
  writeTask(root, "gap-compound-candidate", gapTask("gap-compound-candidate", { role: "compound" }));
  // Bypass gapTask's self-touch injection on purpose: this fixture declares a resolving touch but
  // deliberately OMITS tasks/<id>.md — the C8 self-touch-missing case the gate must reject.
  writeTask(root, "gap-self-touch-missing", {
    status: "todo",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/foo.ts"] }),
  });
  writeTask(root, "gap-clean-candidate", gapTask("gap-clean-candidate", {
    body: fourArtifactBody({ touches: ["- code/foo.ts", "- tasks/gap-clean-candidate.md"] }),
  }));
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 1, floorMult: 1 }); // floor 1, pool 0 → scan
  const compound = r.candidates.find((c) => c.id === "gap-compound-candidate");
  const selfTouch = r.candidates.find((c) => c.id === "gap-self-touch-missing");
  const clean = r.candidates.find((c) => c.id === "gap-clean-candidate");
  assert.ok(compound && selfTouch && clean, "all three candidates scanned");
  assert.equal(compound.eligible, false, "compound candidate is not promotable");
  assert.equal(compound.compound, true, "compound candidate carries the compound flag (blocking reason)");
  assert.equal(selfTouch.eligible, false, "self-touch-missing candidate is not promotable");
  assert.equal(selfTouch.selfTouchOk, false, "self-touch-missing candidate carries the selfTouchOk flag (blocking reason)");
  assert.equal(clean.eligible, true, "clean candidate stays promotable");
  // The blocking reasons are recorded in `intercepted` (traceable no-promotion, same discipline as retired).
  assert.ok(r.intercepted.some((i) => i.id === "gap-compound-candidate" && i.reason === "compound-not-dispatchable"), "compound intercept recorded");
  assert.ok(r.intercepted.some((i) => i.id === "gap-self-touch-missing" && i.reason === "self-touch-missing-c8"), "self-touch intercept recorded");
  assert.ok(!r.promotions.some((p) => p.id === "gap-compound-candidate"), "compound candidate never promoted");
  assert.ok(!r.promotions.some((p) => p.id === "gap-self-touch-missing"), "self-touch candidate never promoted");
  assert.ok(r.promotions.some((p) => p.id === "gap-clean-candidate"), "clean candidate is promoted");
});
