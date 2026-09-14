// @test-group engine
// rework-predictors.test.mjs — task gap-rework-multiplier-predictors.
// Tests for plugin/scripts/rework-predictors.ts (the rework-predictor instrument).
//
// Coverage map (task ACs):
//   AC1 — per-task table carries the AC's own field set, and the REAL corpus reaches ≥600 analysable
//         tasks. The real-corpus arm reads the PRODUCTION carrier (`.quay/worker-outcome.jsonl` in
//         the main checkout — the carrier is a gitignored runtime artifact that worktrees do not
//         get), and SKIPS LOUDLY when the carrier is absent so a clean checkout does not red.
//   AC2 — a bin with n < minBinN has EVERY statistic null and renders 样本不足; a recommendation can
//         never cite one (structural, not promised).
//   AC3 — the falsifiable control is real: a synthetic strong association beats its permutation null
//         while an independent pairing does not (both directions asserted, so the control is shown
//         to be able to come out BOTH ways).
//   AC4 — the confounder section exists and the stratification/window readings are present.
//   AC5 — the recommendation either has real support (all-support bins sufficient) or refuses.
//
// Plus the dead-value regression (`final_state == "landed"`) — the trap
// `tasks/gap-worker-outcome-final-state-landed-is-a-dead-value.md` documents — asserted BOTH
// behaviourally (fixture) and POSITIONALLY (the script's own source: the literal may appear only in
// the alias table, never in a comparison).
//
// Run:
//   scripts/test.sh --for-task gap-rework-multiplier-predictors
//   scripts/test.sh plugin/test/rework-predictors.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUCCESS_STATES,
  LEGACY_SUCCESS_ALIASES,
  NON_LANDED_STATES,
  classifyFinalState,
  mean,
  median,
  quantile,
  rank,
  spearman,
  partialSpearman,
  permutationTest,
  mulberry32,
  summariseGroup,
  numericBins,
  categoricalBins,
  parseOutcomeLine,
  loadOutcomes,
  buildTaskRow,
  buildDataset,
  analyseDataset,
  buildRecommendation,
  renderFactorTable,
  renderMarkdown,
} from "../scripts/rework-predictors.ts";
import { repoRoot, mainCheckoutRoot } from "../scripts/repo-root.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

/** A synthetic worker-outcome stream for fixtures (NEVER used to satisfy a production reading). */
function writeOutcomes(dir, rows) {
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".quay", "worker-outcome.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}

function mkRecord(task, final_state, ts = "2026-09-01T00:00:00.000Z") {
  return { ts, task, final_state, exit_code: 0, wall_clock_ms: 1000 };
}

/** A minimal task file with the sections the parser needs. */
function taskText(id, { touches = ["a/b.ts"], extra = "", labels = ["gap"], heading = "## Finding" } = {}) {
  const labelLines = labels.map((l) => `  - ${l}`).join("\n");
  return [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    "status: done",
    "labels:",
    labelLines,
    "parent: null",
    "children: []",
    extra,
    "---",
    heading,
    "",
    "fixture body text",
    "",
    "## Touches",
    "",
    ...touches.map((t) => `- \`${t}\``),
    "",
    "## Acceptance Criteria",
    "",
    "- [x] done",
    "",
  ].join("\n");
}

/** Build a throwaway repo-shaped dir: tasks/<id>.md + .quay/worker-outcome.jsonl. */
function mkFixtureRepo(tasksSpec, outcomeRows) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "rework-predictors-"));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  for (const [id, spec] of Object.entries(tasksSpec)) {
    fs.writeFileSync(path.join(dir, "tasks", `${id}.md`), taskText(id, spec));
  }
  writeOutcomes(dir, outcomeRows);
  return dir;
}

const SCRIPT_SRC = fs.readFileSync(path.join(HERE, "..", "scripts", "rework-predictors.ts"), "utf8");

// ── AC1 (part 1) — the field set ─────────────────────────────────────────────────────────────────

test("AC1: buildTaskRow emits the AC's own field set with the declared semantics", () => {
  const row = buildTaskRow(
    "t1",
    // `buildTaskRow` takes RECORDS (with a computed `stateClass`), i.e. the output of the loader —
    // so drive it the way the loader does rather than hand-building objects that skip classification.
    [parseOutcomeLine(JSON.stringify(mkRecord("t1", "completed"))), parseOutcomeLine(JSON.stringify(mkRecord("t1", "exited-not-landed")))],
    taskText("t1", { touches: ["a.ts", "b.ts", "plugin/scripts/"], extra: "depends_on:\n  - x\n  - y\ngoal_ac: GOAL-1\n", labels: ["gap", "defect"] }),
    null,
    0,
  );
  assert.equal(row.executions, 2, "executions = worker-outcome record count");
  assert.equal(row.touchesFileCount, 3, "touchesFileCount = declared Touches entries");
  assert.equal(row.touchesWildcardCount, 1, "a trailing-slash directory entry counts as broad");
  assert.equal(row.hasGoalAc, true);
  assert.equal(row.shape, "finding", "shape comes from the shared detectShape judge");
  assert.deepEqual(row.labels, ["gap", "defect"]);
  assert.ok(row.bodyLen > 0, "bodyLen is the body length (frontmatter excluded)");
  assert.equal(row.dependsOnCount, 2, "depends_on is read (top-level)");
  assert.equal(row.successExecutions, 1);
  assert.equal(row.nonLandedExecutions, 1);
  assert.equal(row.legacyAliasExecutions, 0);
  // Every AC1-required field is a key of the emitted table row (the AC's own contract).
  const ds = buildDataset({ root: mkFixtureRepo({ t1: {} }, [mkRecord("t1", "completed")]) });
  for (const k of ["taskId", "executions", "touchesFileCount", "hasGoalAc", "shape", "labels", "bodyLen", "dependsOnCount"]) {
    assert.ok(k in ds.table[0], `the per-task output must carry the field \`${k}\` (AC1)`);
  }
});

test("AC1: hasGoalAc / shape are read the same way as the author→ready gate", () => {
  const withGoal = buildTaskRow("g", [], taskText("g", { extra: "goal_ac: GOAL-9\n" }), null, 0);
  const without = buildTaskRow("g", [], taskText("g"), null, 0);
  assert.equal(withGoal.hasGoalAc, true);
  assert.equal(without.hasGoalAc, false, "absent goal_ac is false, not a crash");
  const contract = buildTaskRow("c", [], taskText("c").replace("## Finding", "## Contract"), null, 0);
  assert.equal(contract.shape, "contract", "a `## Contract` section ⇒ contract shape");
});

// ── The dead-value trap (Finding + DoD) ───────────────────────────────────────────────────────────

test("DEAD VALUE: `landed` is classified legacy-alias, never success (behavioural control)", () => {
  assert.deepEqual([...SUCCESS_STATES], ["completed"]);
  assert.deepEqual([...LEGACY_SUCCESS_ALIASES], ["landed"]);
  assert.ok(NON_LANDED_STATES.includes("exited-not-landed"));
  assert.equal(classifyFinalState("completed"), "success");
  assert.equal(classifyFinalState("landed"), "legacy-alias");
  assert.equal(classifyFinalState("exited-not-landed"), "non-landed");
  assert.equal(classifyFinalState("failed"), "non-landed");
  assert.equal(classifyFinalState("killed"), "non-landed");
  // An unreadable value gets its OWN state — it is neither success nor failure (硬规则 3b).
  assert.equal(classifyFinalState("some-future-state"), "unrecognized");
  assert.equal(classifyFinalState(null), "unrecognized");
  assert.equal(classifyFinalState(42), "unrecognized");

  // The NEGATIVE CONTROL for the trap: a consumer that reads `final_state == "landed"` sees 0
  // successes on a stream whose real successes are all `completed`; this script sees them all.
  const recs = [
    mkRecord("t", "completed"),
    mkRecord("t", "completed"),
    mkRecord("t", "completed"),
    mkRecord("t", "exited-not-landed"),
  ];
  const naive = recs.filter((r) => r.final_state === "landed").length;
  assert.equal(naive, 0, "the naive predicate reads ZERO successes — the failure shape this task guards");
  const row = buildTaskRow("t", recs.map((r) => ({ ...parseOutcomeLine(JSON.stringify(r)) })), taskText("t"), null, 0);
  assert.equal(row.successExecutions, 3, "this script reads the three real successes");
  assert.equal(row.nonLandedExecutions, 1);
});

test("DEAD VALUE, positional: the classifier compares against the alias TABLE, never the raw literal", () => {
  // 硬规则 2 — 按位置判定，不按关键词: prose and the rendered report legitimately QUOTE the dead value,
  // so a whole-file substring scan would be noise. The judged position is the CLASSIFIER BODY: if a
  // future edit writes `state === "landed" → success` there, this reddens.
  const body = SCRIPT_SRC.match(/export function classifyFinalState\([\s\S]*?\n\}/)?.[0];
  assert.ok(body, "the classifier source must be locatable (otherwise this check is vacuous)");
  assert.ok(!/"landed"/.test(body), `the classifier must not compare against the raw literal:\n${body}`);
  assert.ok(/LEGACY_SUCCESS_ALIASES/.test(body), "…it must go through the named alias table instead");
  assert.ok(/SUCCESS_STATES/.test(body), "…and through the named success table");
  // Every EXECUTABLE (non-comment) line quoting the literal must be the alias declaration itself.
  const execLines = SCRIPT_SRC.split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /"landed"/.test(line) && !line.startsWith("//") && !line.startsWith("*"));
  assert.ok(execLines.length >= 1, "the alias table must be locatable");
  for (const { n, line } of execLines) {
    assert.ok(
      /LEGACY_SUCCESS_ALIASES\s*=\s*\["landed"\]/.test(line),
      `executable line ${n} quotes the dead value outside the alias table: ${line}`,
    );
  }
});

test("DEAD VALUE: unrecognized states are surfaced, never folded into success or failure", () => {
  const dir = mkFixtureRepo(
    { t: {} },
    [mkRecord("t", "completed"), mkRecord("t", "brand-new-state"), mkRecord("t", "exited-not-landed")],
  );
  const ds = buildDataset({ root: dir });
  assert.equal(ds.outcomes.classCounts.unrecognized, 1);
  assert.deepEqual(ds.outcomes.unrecognizedValues, ["brand-new-state"]);
  const row = ds.rows[0];
  assert.equal(row.successExecutions + row.nonLandedExecutions + row.legacyAliasExecutions + row.unrecognizedExecutions, row.executions);
  assert.equal(row.unrecognizedExecutions, 1);
});

// ── AC2 — under-sampled bins ─────────────────────────────────────────────────────────────────────

test("AC2: a bin with n < minBinN has EVERY statistic null and renders 样本不足", () => {
  const g = summariseGroup([1, 2, 3], "small", 0, 3, 10);
  assert.equal(g.sufficient, false);
  assert.equal(g.n, 3);
  assert.equal(g.median, null, "an under-sampled bin must not render a median");
  assert.equal(g.mean, null);
  assert.equal(g.p90, null);
  assert.equal(g.shareAtLeast3, null);
  assert.equal(g.shareAtLeast5, null);
  assert.equal(g.shareExactly1, null);

  const g2 = summariseGroup(Array.from({ length: 10 }, (_, i) => i + 1), "ok", 1, 10, 10);
  assert.equal(g2.sufficient, true);
  assert.equal(g2.median, 5.5);

  const rendered = renderFactorTable({
    factor: "fx", kind: "numeric", spearman: null, permutation: null, minBinN: 10,
    note: "", groups: [g, g2],
  }).join("\n");
  assert.match(rendered, /样本不足（n<10，不参与结论）/, "the under-sampled row is labelled");
  const smallRow = rendered.split("\n").find((l) => l.startsWith("| small |"));
  assert.ok(smallRow, "the small bin is rendered");
  assert.ok(!/NaN/.test(smallRow), "no NaN leaks into an under-sampled row");
  assert.ok(!/\| 2 \|/.test(smallRow), "the under-sampled row must not print a median");
});

test("AC2: numerical/categorical binning applies the sufficiency rule at the edges", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ executions: i % 5, v: i < 2 ? 1 : i < 11 ? 5 : 20 }));
  const bins = numericBins(rows, (r) => r.v, (r) => r.executions, [[1, 2], [3, 9], [10, null]], 10);
  assert.equal(bins[0].n, 2);
  assert.equal(bins[0].sufficient, false, "the 1–2 bin has only 2 rows ⇒ under-sampled");
  assert.equal(bins[1].n, 9);
  assert.equal(bins[1].sufficient, false);
  assert.equal(bins[2].n, 1);
  assert.equal(bins[2].sufficient, false);
  const cat = categoricalBins([{ k: "a", executions: 1 }, { k: "b", executions: 3 }], (r) => r.k, 1);
  assert.equal(cat.length, 2);
  assert.equal(cat[0].median, 1);
});

test("AC2: the recommendation can NEVER cite an under-sampled bin (structural, not promised)", () => {
  // A corpus whose top Touches bin is tiny ⇒ the bin is insufficient ⇒ no support ⇒ REFUSAL.
  const tasks = {};
  const rows = [];
  for (let i = 0; i < 40; i++) {
    tasks[`t${i}`] = { touches: ["a.ts", "b.ts"] };
    rows.push(mkRecord(`t${i}`, "completed"));
  }
  // One task with 30 Touches, executed 9 times — the extreme group is deliberately under-sampled.
  tasks.big = { touches: Array.from({ length: 30 }, (_, i) => `f${i}.ts`) };
  for (let i = 0; i < 9; i++) rows.push(mkRecord("big", "exited-not-landed"));
  const dir = mkFixtureRepo(tasks, rows);
  const ds = buildDataset({ root: dir });
  const an = analyseDataset(ds, { minBinN: 10, permutations: 50 });
  const touches = an.factors.find((f) => f.factor === "touchesFileCount");
  const top = touches.groups.filter((g) => g.hi === null).at(-1);
  assert.equal(top.sufficient, false, "the 15+ bin holds 1 task ⇒ under-sampled");
  assert.equal(top.median, null);
  // Either the recommendation refuses, or every support entry is a SUFFICIENT bin.
  if (an.recommendation) {
    for (const s of an.recommendation.support) {
      const g = touches.groups.find((x) => x.label === s.label);
      assert.equal(g.sufficient, true, `support bin ${s.label} must be sufficient`);
      assert.ok(Number.isFinite(s.median), "a support bin must carry a real median");
    }
  } else {
    assert.match(an.recommendationRefusal, /数据不支持/, "a refusal says 数据不支持 (never invents one)");
  }
});

// ── AC3 — the falsifiable control is able to come out BOTH ways ───────────────────────────────────

test("AC3: the permutation null separates a real association from an independent pairing", () => {
  // Strong association: y is a monotone function of x ⇒ observed |rho| ≈ 1, far above the null.
  const n = 200;
  const xs = Array.from({ length: n }, (_, i) => i);
  const strong = xs.map((v) => v * 2 + (v % 3));
  const rStrong = permutationTest(xs, strong, 400, 1);
  assert.ok(rStrong.observed > 0.9, `expected a near-perfect rank correlation, got ${rStrong.observed}`);
  assert.ok(rStrong.nullMax < rStrong.observed, "a real association must CLEAR its null's maximum");
  assert.ok(rStrong.pValue < 0.01, "…and its empirical p is small");

  // Independent pairing: y is an unrelated sawtooth ⇒ observed sits inside the null.
  const rnd = mulberry32(7);
  const indep = xs.map(() => Math.floor(rnd() * 1000));
  const rIndep = permutationTest(xs, indep, 400, 1);
  assert.ok(rIndep.observed < rIndep.nullP95, "an independent pairing must NOT clear its own 95th percentile");
  assert.ok(rIndep.pValue > 0.05, "…and its p is not small");

  // Determinism: the same seed reproduces the same null (so a reported p is re-derivable).
  const again = permutationTest(xs, strong, 400, 1);
  assert.deepEqual(again, rStrong, "the permutation test is seed-deterministic");
  const other = permutationTest(xs, strong, 400, 2);
  assert.notDeepEqual(other, rStrong, "a different seed gives a different null draw");
});

test("AC3: partialSpearman collapses a spurious carrier and keeps a real one", () => {
  const n = 300;
  const rnd = mulberry32(11);
  const z = Array.from({ length: n }, (_, i) => i); // the "size" driver
  const x = z.map((v) => v + rnd() * 5);            // x is a noisy copy of z
  const y = z.map((v) => v * 3 + rnd() * 5);        // y is driven by z, not by x
  // Spurious carrier: x looks correlated with y, but controlling z should collapse it.
  const raw = spearman(x, y);
  const partial = partialSpearman(x, y, z);
  assert.ok(raw > 0.9, `expected a raw correlation, got ${raw}`);
  assert.ok(Math.abs(partial) < 0.2, `controlling the common driver must collapse it, got ${partial}`);
  // Reverse direction: a real carrier survives controlling the same z (y also depends on x directly).
  const y2 = z.map((v, i) => v * 3 + x[i] * 40 + rnd());
  assert.ok(partialSpearman(x, y2, z) > 0.5, "a genuine carrier survives the control");
});

test("AC3: the rendered report carries an explicit counter-reading for its conclusion", () => {
  const tasks = {};
  const rows = [];
  for (let i = 0; i < 220; i++) {
    const broad = i % 3 === 0;
    tasks[`t${i}`] = { touches: broad ? Array.from({ length: 18 }, (_, j) => `f${j}.ts`) : ["a.ts"] };
    const rounds = broad ? 6 : 1;
    for (let k = 0; k < rounds; k++) rows.push(mkRecord(`t${i}`, k === 0 && !broad ? "completed" : "exited-not-landed"));
  }
  const dir = mkFixtureRepo(tasks, rows);
  const ds = buildDataset({ root: dir });
  const an = analyseDataset(ds, { minBinN: 10, permutations: 200 });
  const md = renderMarkdown(ds, an);
  assert.match(md, /反向指标 1（置换零分布）/, "the permutation control is rendered");
  assert.match(md, /若结论 A 为假，应观察到/, "the counterfactual is stated in the 'if false, expect' form");
  assert.match(md, /置换零分布/, "the null's own numbers are printed, not just a p-value");
  assert.match(md, /样本不足/, "the under-sampled marker reaches the document (AC2)");
  assert.match(md, /难度不可观测/, "the unobservable confounder is stated (AC4)");
});

// ── AC4 — confounder handling is present and structural ───────────────────────────────────────────

test("AC4: shape stratification and the observation-window control are computed", () => {
  const tasks = {};
  const rows = [];
  for (let i = 0; i < 120; i++) {
    // BOTH variables must have rank variance inside every stratum: a constant predictor (or a
    // constant outcome) makes Spearman NaN, and the assertion below would then be vacuous.
    tasks[`p${i}`] = { heading: "## Plan", touches: Array.from({ length: 2 + (i % 6) }, (_, j) => `p${j}.ts`) };
    for (let k = 0; k < 1 + (i % 5); k++) rows.push(mkRecord(`p${i}`, "exited-not-landed"));
    tasks[`f${i}`] = { touches: Array.from({ length: 1 + (i % 4) }, (_, j) => `f${i}_${j}.ts`) };
    for (let k = 0; k < 1 + ((i * 3) % 7); k++) rows.push(mkRecord(`f${i}`, "exited-not-landed"));
  }
  // `p*` are plan-shape (an explicit `## Plan` heading), `f*` are finding-shape (the default).
  const dir = mkFixtureRepo(tasks, rows);
  const ds = buildDataset({ root: dir });
  const an = analyseDataset(ds, { minBinN: 10, permutations: 60 });
  assert.ok(an.byShape.length >= 1, "stratification produced strata");
  const finding = an.byShape.find((s) => s.shape === "finding");
  assert.ok(finding, "the finding stratum exists");
  assert.equal(finding.sufficient, true, "120 finding tasks ⇒ a sufficient stratum");
  assert.ok(Number.isFinite(finding.spearman), "a sufficient stratum carries its own correlation");
  // Every stratum reports its OWN n (so an insufficient stratum is visible as such, not averaged in).
  for (const s of an.byShape) assert.equal(s.sufficient, s.n >= 10);
  assert.ok("windowControl" in an && "cutoff" in an.windowControl, "the observation-window control exists");
  assert.ok("ageConfound" in an.windowControl, "the age confound is measured, not assumed");
});

test("AC4: with no filing dates observable, the window control reports an empty subpopulation", () => {
  const dir = mkFixtureRepo({ t: {} }, [mkRecord("t", "completed")]);
  const ds = buildDataset({ root: dir }); // fixture dir is not a git repo ⇒ filers are unobservable
  assert.equal(ds.rows[0].filedAt, null, "no git history ⇒ filedAt is null (缺值=未查, never faked)");
  assert.equal(ds.rows[0].ageDays, null);
  const an = analyseDataset(ds, { minBinN: 10, permutations: 20 });
  assert.equal(an.windowControl.n, 0, "an empty window subpopulation is reported as 0, not as a reading");
});

// ── AC5 — the recommendation refuses when unsupported ─────────────────────────────────────────────

test("AC5: an unsupported corpus yields an explicit 数据不支持 refusal, never an invented rule", () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ executions: 1, touchesFileCount: 2, labels: [], shape: "plan", bodyLen: 1, dependsOnCount: 0, hasGoalAc: false, taskId: `t${i}`, author: null, filedAt: null, ageDays: null, successExecutions: 1, legacyAliasExecutions: 0, nonLandedExecutions: 0, unrecognizedExecutions: 0, touchesWildcardCount: 0 }));
  const factors = [{
    factor: "touchesFileCount", kind: "numeric", spearman: 0, permutation: null, minBinN: 10, note: "",
    groups: [
      { label: "1–2", lo: 1, hi: 2, n: 300, median: 1, mean: 1, p90: 1, shareAtLeast3: 0, shareAtLeast5: 0, shareExactly1: 1, sufficient: true },
      { label: "15+", lo: 15, hi: null, n: 300, median: 1, mean: 1, p90: 1, shareAtLeast3: 0, shareAtLeast5: 0.01, shareExactly1: 1, sufficient: true },
    ],
  }];
  const { recommendation, recommendationRefusal } = buildRecommendation(rows, factors, 10);
  assert.equal(recommendation, null, "a flat tail must not produce a rule");
  assert.match(recommendationRefusal, /数据不支持任何立案期建议/, "…it must say so explicitly");
});

test("AC5: too small a corpus refuses on population size alone", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ executions: 1 + (i % 3), touchesFileCount: i }));
  const { recommendation, recommendationRefusal } = buildRecommendation(rows, [], 10);
  assert.equal(recommendation, null);
  assert.match(recommendationRefusal, /数据不支持/);
});

test("AC5: a supported corpus's recommendation carries support + boundary + counter-reading", () => {
  const tasks = {};
  const rows = [];
  for (let i = 0; i < 260; i++) {
    const broad = i % 4 === 0;
    tasks[`t${i}`] = { touches: broad ? Array.from({ length: 20 }, (_, j) => `g${j}.ts`) : ["a.ts"] };
    const rounds = broad ? 8 : 1;
    for (let k = 0; k < rounds; k++) rows.push(mkRecord(`t${i}`, k === 0 ? "completed" : "exited-not-landed"));
  }
  const dir = mkFixtureRepo(tasks, rows);
  const ds = buildDataset({ root: dir });
  const an = analyseDataset(ds, { minBinN: 10, permutations: 150 });
  assert.ok(an.recommendation, "a strongly-tailed corpus yields a recommendation");
  assert.ok(an.recommendation.support.length > 0);
  for (const s of an.recommendation.support) {
    assert.ok(s.n >= 10, `support bin ${s.label} must clear the sample floor`);
    assert.ok(Number.isFinite(s.median) && Number.isFinite(s.mean));
  }
  assert.ok(an.recommendation.boundary.length >= 3, "the boundary is stated, not implied");
  assert.match(an.recommendation.counterReading, /若本建议为假，应观察到/, "the counter-reading is present");
  assert.match(an.recommendation.boundary.join("\n"), /非因果/, "the non-causal caveat is explicit");
});

// ── AC1 (part 2) — the REAL corpus, from the PRODUCTION carrier ───────────────────────────────────

test("AC1: the real corpus yields ≥600 analysable tasks with the full field set", (t) => {
  // The carrier is a gitignored RUNTIME artifact: it lives in the MAIN checkout, and a task
  // worktree does not receive it (.worktreeinclude deliberately copies only config.yml + vendor
  // dist). Resolve the main checkout, exactly as the script itself does.
  const main = repoRoot(HERE) === "" ? "" : (mainCheckoutRoot(HERE) || repoRoot(HERE));
  const carrier = path.join(main, ".quay", "worker-outcome.jsonl");
  if (!fs.existsSync(carrier)) {
    // LOUD skip: an absent carrier is NOT-EVALUATED, and the code below still asserts the ≥600
    // floor whenever it IS present (every production host has it — the loop writes it every round).
    t.diagnostic(`NOT-EVALUATED: production carrier absent at ${carrier} — the ≥600-task reading is unverified on this host`);
    return;
  }
  const ds = buildDataset({ root: main });
  assert.ok(
    ds.population.analysable >= 600,
    `AC1 requires ≥600 analysable tasks on the REAL corpus; got ${ds.population.analysable} (of ${ds.population.taskFiles} task files, ${ds.outcomes.totalRecords} outcome records)`,
  );
  assert.equal(ds.outcomes.malformedLines, 0, "every line of the production carrier parses");
  assert.ok(ds.outcomes.classCounts.success > 0, "the success state is observable (a dead-value regression would zero it)");
  // The population accounting must close (硬规则 5: a leftover would be an unexamined source).
  assert.equal(
    ds.population.analysable + ds.population.taskFilesWithoutOutcomes,
    ds.population.taskFiles,
    "task files = analysable + never-in-pool (no task file silently dropped)",
  );
  // Every row carries the AC1 field set, and the summary agrees with the rows.
  for (const r of ds.rows.slice(0, 50)) {
    for (const k of ["taskId", "executions", "touchesFileCount", "hasGoalAc", "shape", "labels", "bodyLen", "dependsOnCount"]) {
      assert.ok(k in r, `row ${r.taskId} is missing AC1 field ${k}`);
    }
    assert.equal(
      r.successExecutions + r.nonLandedExecutions + r.legacyAliasExecutions + r.unrecognizedExecutions,
      r.executions,
      `row ${r.taskId}: the per-state breakdown must partition executions`,
    );
  }
  assert.equal(ds.summary.tasks, ds.rows.length);
  assert.equal(ds.summary.max, Math.max(...ds.rows.map((r) => r.executions)));
});

test("AC2: on the real corpus, EVERY under-sampled bin has null statistics", () => {
  const main = mainCheckoutRoot(HERE) || repoRoot(HERE);
  if (!fs.existsSync(path.join(main, ".quay", "worker-outcome.jsonl"))) return; // NOT-EVALUATED
  const ds = buildDataset({ root: main });
  const an = analyseDataset(ds, { minBinN: 10, permutations: 100 });
  let checked = 0;
  for (const f of an.factors) {
    for (const g of f.groups) {
      if (g.sufficient) continue;
      checked++;
      assert.equal(g.median, null, `${f.factor} bin ${g.label} (n=${g.n}) is under-sampled but carries a median`);
      assert.equal(g.mean, null);
      assert.equal(g.shareAtLeast5, null);
    }
  }
  assert.ok(checked > 0, "the real corpus must actually contain an under-sampled bin (otherwise this check is vacuous)");
  // …and at least one bin IS sufficient, so the rule is not vacuously satisfied either.
  assert.ok(an.factors.some((f) => f.groups.some((g) => g.sufficient)), "some bin must be sufficient");
});

test("AC3+AC4: the real-corpus analysis is internally consistent", () => {
  const main = mainCheckoutRoot(HERE) || repoRoot(HERE);
  if (!fs.existsSync(path.join(main, ".quay", "worker-outcome.jsonl"))) return; // NOT-EVALUATED
  const ds = buildDataset({ root: main });
  const an = analyseDataset(ds, { minBinN: 10, permutations: 100 });
  const p = an.factors.find((f) => f.factor === "touchesFileCount").permutation;
  assert.ok(p, "the headline factor carries its permutation null");
  assert.ok(p.nullP50 <= p.nullP95 && p.nullP95 <= p.nullP99 && p.nullP99 <= p.nullMax, "the null quantiles are ordered");
  assert.ok(p.pValue > 0 && p.pValue <= 1);
  assert.ok(p.permutations === 100);
  // The rendered document is regenerable from the same inputs (no hidden state between the two).
  const md = renderMarkdown(ds, an);
  assert.equal(md, renderMarkdown(ds, an), "rendering is deterministic");
  assert.match(md, /## 0\. 口径/, "the metric definition section is present");
  assert.match(md, /landed/, "the dead-value trap is documented in the report");
  assert.match(md, /复跑锚点/, "the re-run anchor is present (DoD)");
});

// ── statistical primitives ───────────────────────────────────────────────────────────────────────

test("primitives: median/quantile/mean/rank/spearman behave on known inputs", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(mean([1, 2, 3]), 2);
  assert.ok(Number.isNaN(median([])));
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.9), 5);
  // Ties share the mean rank — the standard correction, so a tied pair cannot inflate rho.
  assert.deepEqual(rank([10, 10, 20]), [1.5, 1.5, 3]);
  assert.equal(spearman([1, 2, 3, 4], [1, 2, 3, 4]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.ok(Number.isNaN(spearman([1, 1, 1], [1, 2, 3])), "a constant vector has no rank variance ⇒ NaN, not 0");
  assert.ok(Number.isNaN(spearman([], [])));
});

test("primitives: parseOutcomeLine rejects malformed input instead of inventing a record", () => {
  assert.equal(parseOutcomeLine("{not json"), null);
  assert.equal(parseOutcomeLine('{"ts":"x"}'), null, "a record with no task id is not a record");
  assert.equal(parseOutcomeLine('{"task":""}'), null);
  assert.equal(parseOutcomeLine('{"task":"t"}').stateClass, "unrecognized", "a missing final_state is unrecognized");
  const ok = parseOutcomeLine(JSON.stringify(mkRecord("t", "completed")));
  assert.equal(ok.task, "t");
  assert.equal(ok.stateClass, "success");
});

test("primitives: loadOutcomes counts malformed lines instead of silently dropping them", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "rework-load-"));
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".quay", "worker-outcome.jsonl"),
    ['{"task":"a","final_state":"completed"}', "garbage", '{"task":"a","final_state":"landed"}', ""].join("\n"),
  );
  const load = loadOutcomes(path.join(dir, ".quay", "worker-outcome.jsonl"));
  assert.equal(load.malformedLines, 1);
  assert.equal(load.totalLines, 3);
  assert.equal(load.records.length, 2);
  assert.equal(load.classCounts.success, 1);
  assert.equal(load.classCounts["legacy-alias"], 1, "the dead value is visible in the load, not folded away");
  assert.deepEqual(load.stateCounts, { completed: 1, landed: 1 });
});

test("primitives: an absent carrier loads as EMPTY, not as an error or a fake zero-task report", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "rework-absent-"));
  const load = loadOutcomes(path.join(dir, ".quay", "worker-outcome.jsonl"));
  assert.equal(load.records.length, 0);
  assert.equal(load.totalLines, 0);
  const ds = buildDataset({ root: dir });
  assert.equal(ds.outcomes.totalRecords, 0, "the caller (main) turns this into exit 3 NOT-EVALUATED");
  assert.equal(ds.rows.length, 0);
});

test("primitives: buildDataset reports outcome ids whose task file is gone, instead of dropping them", () => {
  const dir = mkFixtureRepo({ a: {} }, [mkRecord("a", "completed"), mkRecord("ghost", "completed")]);
  const ds = buildDataset({ root: dir });
  assert.deepEqual(ds.population.outcomeTasksMissingFile, ["ghost"]);
  assert.equal(ds.population.analysable, 1);
  assert.equal(ds.rows.length, 1);
});
