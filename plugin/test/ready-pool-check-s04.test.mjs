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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { CONCURRENCY_CAP_DEFAULT, POOL_FLOOR, POOL_FLOOR_MULT_DEFAULT, analyzeTasks, artifactsComplete, assert, computePoolFloor, fourArtifactBody, fs, makeWorkspace, maxMutuallyDisjointSubset, notYetFlipped, path, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("all remaining unchecked boxes annotated （待外部） ⇒ awaiting-verification (excluded, not dispatchable)", (t) => {
  const root = makeWorkspace("remaining-ext");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // work landed AND 3/4 checked — the ONE remaining unchecked box is annotated （待外部） (only the full
  // suite green remains, e.g. gap-mcp-server) ⇒ the task enters awaiting-verification (a legal
  // done-flip — excluded from the dispatchable pool).
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const task = {
    status: "ready",
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/landed.ts (new)"] }),
  };
  assert.equal(notYetFlipped(task, root), true, "all-remaining-external workLanded task enters awaiting-verification (excluded)");
});


test("AC all checked but DoD has unchecked IMPLEMENTATION boxes ⇒ NOT landed (cli-import shape, human ruling)", (t) => {
  const root = makeWorkspace("ac-full-dod-open");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The gap-cli-import-refactor shape: AC 5/5 fully checked, but the DoD still carries this task's
  // OWN implementation/evidence as UNCHECKED boxes annotated `（待本任务）` (the run()/shell golden-replay
  // EVIDENCE + scoped test green), plus one `（待外部）` full-suite item. Work LANDED (the code IS merged)
  // + AC all checked was the old "landed" judgment — but the author DECLARED the implementation items
  // 待本任务, so the task is NOT landed ⇒ stays in the dispatchable pool.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const task = {
    status: "ready",
    body: [
      "**type:** execution",
      "## Proposal",
      "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
      "## Contract",
      "measure x\nband y\ninvoke z\ncontrol ok\nresume r",
      "## Acceptance Criteria",
      "- [x] AC1: done long enough to be a real box",
      "- [x] AC2: done long enough to be a real box",
      "- [x] AC3: done long enough to be a real box",
      "- [x] AC4: done long enough to be a real box",
      "- [x] AC5: done long enough to be a real box",
      "## Definition of Done",
      "- [ ] run()/shell 架构 + 逐命令搬迁的 golden-replay 证据 + 实际耗时贴出（见 Evidence）（待本任务）",
      "- [ ] 既有测试 + 新增测试全绿（--for-task scoped）（待本任务）",
      "- [ ] 全量套件绿（外层 verification-round 验证）（待外部）",
      "## Touches",
      "- code/landed.ts (new)",
    ].join("\n"),
  };
  assert.equal(notYetFlipped(task, root), false, "AC all-checked but DoD has open 待本任务 boxes ⇒ NOT landed (stays in pool)");
});


test("artifactsComplete is shape-aware and content-gated", () => {
  const contract = fourArtifactBody();
  assert.deepEqual(artifactsComplete(contract).missing, []);
  assert.equal(artifactsComplete(contract).complete, true);

  // Missing DoD → incomplete, names the missing artifact.
  const noDod = fourArtifactBody().replace("## Definition of Done", "## Resolution");
  const r = artifactsComplete(noDod);
  assert.equal(r.complete, false);
  assert.ok(r.missing.includes("dod"), `missing should include dod, got ${r.missing}`);

  // Unknown shape fails closed.
  assert.equal(artifactsComplete("## Some unknown heading\ncontent").complete, false);
});


test("artifactsComplete recognizes finding-shape draft AC/DoD headings (gap-todo-shape-mismatch-author-gate)", () => {
  // The 9 finding-shape gap-* tasks use `## AC（draft）` / `## DoD（draft）` (full-width parens) or
  // `## AC (draft)` (half-width parens) for their AC/DoD sections. The `（draft）` suffix is a
  // heading-label convention, not an absent section — the four-artifacts gate must count these
  // sections or those todo tasks are wrongly ineligible for author→ready promotion.
  const finding = "## Finding\nA real finding paragraph that is definitely more than forty non-whitespace characters long.";
  const acDraft = "## AC（draft）\n- [ ] the first draft acceptance item whose text is definitely longer than forty characters";
  const dodDraft = "## DoD（draft）\n- [ ] the first draft done item whose text is definitely longer than forty characters";
  const fullWidth = finding + "\n" + acDraft + "\n" + dodDraft;
  const rFull = artifactsComplete(fullWidth);
  assert.equal(rFull.complete, true, `full-width draft headings should complete, got ${JSON.stringify(rFull.missing)}`);
  assert.deepEqual(rFull.missing, []);

  // Half-width parens need literal (regex-escaped) heading matching — `AC (draft)` must not be
  // interpreted as a regex capture group.
  const halfWidth = finding + "\n" + acDraft.replace("（draft）", " (draft)") + "\n" + dodDraft.replace("（draft）", " (draft)");
  const rHalf = artifactsComplete(halfWidth);
  assert.equal(rHalf.complete, true, `half-width draft headings should complete, got ${JSON.stringify(rHalf.missing)}`);
  assert.deepEqual(rHalf.missing, []);

  // A finding-shape task WITHOUT any AC section still fails closed (missing ac+dod).
  const noAc = finding + "\n## Proposal\nA proposal paragraph that is more than forty non-whitespace chars.";
  const rNoAc = artifactsComplete(noAc);
  assert.equal(rNoAc.complete, false);
  assert.ok(rNoAc.missing.includes("ac"), `missing should include ac, got ${rNoAc.missing}`);
});

// ── AC1: floor = cap × 4 (20 at cap 5) — single source, no hardcoded literal ──────────────────────


test("POOL_FLOOR = cap × 4 (20 at cap 5) — single source from defaultDriverConfig().worker.cap (AC1)", () => {
  assert.equal(CONCURRENCY_CAP_DEFAULT, 5);
  assert.equal(POOL_FLOOR_MULT_DEFAULT, 4);
  assert.equal(POOL_FLOOR, 20, "default floor = 5 × 4 (dispatch single source)");
  assert.equal(computePoolFloor(3, 4), 12);
  assert.equal(computePoolFloor(3), 12, "floorMult defaults to 4");
  assert.equal(computePoolFloor(2, 4), 8);
  assert.equal(computePoolFloor(4, 4), 16);
  assert.equal(computePoolFloor(1, 1), 1, "small floors are legal for tests/experiments");
});

// ── AC2: dispatchable_disjoint = largest mutually-disjoint pool subset via checkTouchesPair ────────


test("dispatchable_disjoint = largest mutually-disjoint pool subset via checkTouchesPair (AC2)", (t) => {
  const root = makeWorkspace("disjoint");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // a,b,c mutually disjoint; d,e collide (code/shared.ts); a,f collide (code/a.ts).
  // Conflicts = the matching {(d,e),(a,f)} ⇒ MIS = 6 − 2 = 4.
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/b.ts"] }) });
  writeTask(root, "gap-c", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/c.ts"] }) });
  writeTask(root, "gap-d", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/shared.ts"] }) });
  writeTask(root, "gap-e", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/shared.ts"] }) });
  writeTask(root, "gap-f", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.equal(r.pool, 6);
  assert.equal(r.dispatchable_disjoint, 4, "largest mutually-disjoint subset is 4 ({a,b,c,d} or {a,b,c,e})");
  assert.equal(r.criterion_met, true, "4 ≥ cap 3 ⇒ criterion met");
  assert.equal(r.pool_big_all_colliding, false);
});


test("maxMutuallyDisjointSubset handles empty, singleton, disjoint, and colliding sets", () => {
  const expand = (globs) => new Set(globs);
  const a = { hasSection: true, globs: ["code/a.ts"] };
  const b = { hasSection: true, globs: ["code/b.ts"] };
  const shared = { hasSection: true, globs: ["code/shared.ts"] };
  assert.equal(maxMutuallyDisjointSubset([], expand), 0);
  assert.equal(maxMutuallyDisjointSubset([a], expand), 1);
  assert.equal(maxMutuallyDisjointSubset([a, b], expand), 2);
  assert.equal(maxMutuallyDisjointSubset([a, shared, { hasSection: true, globs: ["code/shared.ts"] }], expand), 2);
});

// ── AC3: pool-big-but-all-colliding self-report; no false report when criterion already met ────────


test("pool ≥ floor but all colliding ⇒ mechanism self-reports (AC3)", (t) => {
  const root = makeWorkspace("all-collide");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-r1", "gap-r2", "gap-r3", "gap-r4"]) {
    writeTask(root, id, { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/shared.ts"] }) });
  }
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }); // floor 3
  assert.equal(r.pool, 4);
  assert.ok(r.pool >= r.floor, "pool is at/above the floor");
  assert.equal(r.dispatchable_disjoint, 1, "all four collide on code/shared.ts");
  assert.equal(r.criterion_met, false, "1 < cap 3");
  assert.equal(r.pool_big_all_colliding, true, "pool big but all colliding must self-report");
  assert.match(r.report, /POOL BIG BUT ALL COLLIDING/);
});
