// @test-group engine
// design-evolution-readings.test.mjs — RM1/RM2 readings for the design-evolution meta-mechanism
// (task gap-design-evolution-readings-report-only-routine; DIR-133 ruling 3, 2026-10-22)
//
// WHAT THIS PINS, in decreasing order of how easy it is to lose:
//   ① THE ONE FORMULA — `share = centralΔ / (centralΔ + nonCentralΔ)`, with nonCentralΔ including
//      the growth of files that ALREADY EXISTED at baseline (the口径 bug the finding corrected
//      88% → 82%: the old command's denominator dropped them, so re-running it reproduced the wrong
//      number). Asserted on a synthetic history whose numbers are known by construction.
//   ①b THE SECOND CALIBER (task gap-design-evolution-share-caliber-net-vs-additions): `additionsShare`
//      = Σ `git diff --numstat` additions over the SAME window. The net caliber can exceed 1 (a
//      shrinking non-central file shrinks the denominator), the additions caliber cannot — both are
//      recorded on the same subsystem, and `shareBasis` names which one `share` is.
//   ② THE THREE-VALUED RULES (硬规则 3b) — an unresolvable baseline, a central path absent at either
//      end, and a non-positive denominator must ALL yield `evaluated:false` with `share: null` and a
//      reason naming the exact path/condition. ⛔ Never 0, never a share. This is the failure class
//      the task exists for: after serve's central file moved, the old command read 0 lines and
//      computed a plausible-looking share.
//   ③ RM2'S PREDICATE SELF-CHECK (硬规则 4 推论二 的检测半边) — a broken predicate must turn the
//      reading into `evaluated:false`, not into 「零争用」.
//   ④ THE REAL READINGS (AC2/AC4) — guarded: they run only when the real refs / carrier exist, and
//      assert the finding's numbers as LOWER BOUNDS (the carrier grows).
//
// Run:
//   node --experimental-strip-types --test plugin/test/design-evolution-readings.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONTENTION_TOKENS,
  DEFAULT_CONTENTION_PREDICATES,
  DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT,
  PREDICATE_SELFCHECK_PATH,
  PREDICATE_SELFCHECK_SAMPLE,
  buildReadings,
  createPathIdentityResolver,
  evolutionFindingKey,
  evolutionFindingRecord,
  evolutionFindings,
  globToRegExp,
  judgeEvolutionRegression,
  lineCountAt,
  measureSubsystem,
  oppositeSignCommits,
  parseDesignEvolutionSection,
  parseNumstatPath,
  priorDarkRoundsFor,
  readDesignEvolutionHistory,
  readStandaloneSection,
  readWindowAdditions,
  resolveCommit,
  scanContention,
  stripWorktreePrefix,
  trailingDarkRounds,
  trailingRm2DarkRounds,
} from "../scripts/design-evolution-readings.ts";
import { mainCheckoutRoot } from "../scripts/repo-root.ts";
// The dedup identity is the EXISTING gate's, not a second parser: AC2 runs the real `findingKey` /
// `gateFinding` over the rendered candidate text (⛔ no re-implementation in the test either).
import { findingKey, gateFinding, routineFindingCandidateText } from "../scripts/routine-file-gate.ts";

// ── fixture repo ────────────────────────────────────────────────────────────────────────────────────

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

/** A tmp dir with a deterministic history. Returns { dir, write, commit, commits }. */
function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "der-rm1-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q", "-b", "main");
  const commits = [];
  // `tag` lets a test REWRITE a file in place (same line count, different content) — the only way to
  // give the additions caliber a non-zero numerator while the NET delta is zero or negative.
  const write = (rel, lines, tag = "line") => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, lines === 0 ? "" : Array.from({ length: lines }, (_, i) => `${tag} ${i}`).join("\n") + "\n");
  };
  const remove = (rel) => fs.rmSync(path.join(dir, rel), { force: true });
  const commit = (msg) => {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", msg);
    const sha = git(dir, "rev-parse", "HEAD");
    commits.push(sha);
    return sha;
  };
  return { dir, write, remove, commit, commits, git: (...a) => git(dir, ...a) };
}

// ── ① the one formula ──────────────────────────────────────────────────────────────────────────────

test("measureSubsystem — the ONE formula: nonCentralΔ includes the growth of files that already existed", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 100);
  repo.write("mod/existing.ts", 50);
  const base = repo.commit("baseline");
  repo.write("mod/central.ts", 110); // +10 central
  repo.write("mod/existing.ts", 60); // +10 non-central, ALREADY EXISTING at baseline
  repo.write("mod/new.ts", 20); // +20 non-central, created in the window
  repo.commit("grow");

  const r = measureSubsystem(repo.dir, {
    name: "m",
    baseline: base,
    central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }],
    modules: ["mod/*.ts"],
  });

  assert.equal(r.evaluated, true, r.reason ?? "");
  assert.equal(r.centralDelta, 10);
  // 10 (existing) + 20 (new) — the denominator the corrected finding uses. If the existing file's
  // growth were dropped, nonCentralΔ would be 20 and the share would read 33% instead of 25%.
  assert.equal(r.nonCentralDelta, 30);
  assert.equal(r.denominator, 40);
  assert.equal(r.share, 0.25);
  assert.equal(r.sharePercent, 25);
  assert.equal(r.sharePercentRounded, 25);
  assert.equal(r.moduleFileCount, 3);
  assert.deepEqual(r.newModuleFiles, ["mod/new.ts"]);
});

// ── ①b the SECOND caliber (additions-only, claudecodeui-comparable) ────────────────────────────────
// task gap-design-evolution-share-caliber-net-vs-additions: the net caliber and the additions caliber
// are DIFFERENT numbers over the SAME window, so the record carries both and never substitutes one.

test("measureSubsystem — BOTH calibers on one reading: net and additions-only diverge on a REWRITE", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 100);
  repo.write("mod/other.ts", 100);
  const base = repo.commit("baseline");
  repo.write("mod/central.ts", 110); // +10 net, +10 additions
  repo.write("mod/other.ts", 100, "rewritten"); // +0 net, +100 additions (every line replaced)
  repo.commit("grow");
  const r = measureSubsystem(repo.dir, {
    name: "m",
    baseline: base,
    central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }],
    modules: ["mod/*.ts"],
  });

  assert.equal(r.evaluated, true, r.reason ?? "");
  // NET: 10 / (10 + 0) = 100% — the rewrite is invisible to a line-count diff.
  assert.deepEqual([r.centralDelta, r.nonCentralDelta, r.denominator, r.share, r.sharePercent], [10, 0, 10, 1, 100]);
  assert.equal(r.shareBasis, "net", "`share` is the NET caliber and says so on the record");
  // ADDITIONS: 10 / (10 + 100) = 9.09% — the rewrite IS the new code landing outside the centre.
  assert.deepEqual([r.additionsNumerator, r.additionsDenominator], [10, 110]);
  assert.ok(Math.abs(r.additionsShare - 10 / 110) < 1e-12);
  assert.equal(r.additionsSharePercent, 9.09);
  assert.equal(r.additionsReason, null);
  // The two calibers disagree by an order of magnitude — which is exactly why a finding must name one.
  assert.notEqual(r.sharePercent, r.additionsSharePercent);

  // And the additions are an ENDPOINT aggregation, not a per-commit sum: a line added and then
  // removed inside the window is NOT counted (it is not growth).
  repo.write("mod/other.ts", 100, "rewritten-again");
  repo.commit("churn");
  const later = measureSubsystem(repo.dir, {
    name: "m",
    baseline: base,
    central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }],
    modules: ["mod/*.ts"],
  });
  assert.equal(later.additionsDenominator, 110, "a re-write inside the window is not a second addition");
});

test("measureSubsystem — AC2: a NEGATIVE non-central NET delta pushes `share` above 1 while `additionsShare` stays <= 1", (t) => {
  // This is the worker-post-909 shape (net 102.13%, additions 93.81%) reduced to its mechanism: the
  // non-central files SHRANK, so the net denominator is smaller than the numerator.
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 100);
  repo.write("mod/other.ts", 100);
  const base = repo.commit("baseline");
  repo.write("mod/central.ts", 110); // +10 central
  repo.write("mod/other.ts", 94); // −6 non-central (pure deletion ⇒ ZERO additions)
  repo.commit("grow + shrink");
  const r = measureSubsystem(repo.dir, {
    name: "m",
    baseline: base,
    central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }],
    modules: ["mod/*.ts"],
  });

  assert.equal(r.evaluated, true, r.reason ?? "");
  assert.equal(r.nonCentralDelta, -6, "the net non-central term really is negative");
  assert.equal(r.share, 10 / 4, "the net share is 250% — a legal value, and the reason it must be labelled");
  assert.ok(r.share > 1, "the net caliber is ALLOWED to exceed 1 (⛔ not clamped)");
  assert.equal(r.shareBasis, "net", "a >1 share is only readable because the record names its caliber");
  // The additions caliber over the same window: 10 central / 10 total.
  assert.deepEqual([r.additionsNumerator, r.additionsDenominator, r.additionsShare], [10, 10, 1]);
  assert.ok(r.additionsShare <= 1, "additionsShare can never exceed 1 — both terms are non-negative counts");
});

test("measureSubsystem — only BOTH calibers missing is `evaluated:false`; a null net share keeps the reading", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 100);
  repo.write("mod/other.ts", 100);
  const base = repo.commit("baseline");
  repo.write("mod/central.ts", 90); // −10 net, 0 additions
  repo.write("mod/other.ts", 100, "rewritten"); // 0 net, +100 additions
  repo.commit("shrink + rewrite");
  const r = measureSubsystem(repo.dir, {
    name: "m",
    baseline: base,
    central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }],
    modules: ["mod/*.ts"],
  });

  // NET is not a reading (denominator −10), but the additions caliber IS ⇒ the subsystem is EVALUATED
  // and the missing net number NAMES ITSELF instead of pretending to be 0.
  assert.equal(r.evaluated, true, r.reason ?? "");
  assert.equal(r.share, null);
  assert.equal(r.shareBasis, null, "⛔ no caliber label on a number that does not exist");
  assert.match(r.shareReason, /non-positive-denominator/);
  assert.equal(r.additionsShare, 0);
  assert.equal(r.additionsSharePercent, 0);
});

test("parseNumstatPath — the plain, braced and `=>`-only rename spellings round-trip", () => {
  assert.deepEqual(parseNumstatPath("packages/quay/src/serve.ts"), { from: "packages/quay/src/serve.ts", to: "packages/quay/src/serve.ts" });
  assert.deepEqual(parseNumstatPath("packages/quay/src/{ => serve}/serve-task.ts"), {
    from: "packages/quay/src/serve-task.ts",
    to: "packages/quay/src/serve/serve-task.ts",
  });
  assert.deepEqual(parseNumstatPath("packages/quay/src/{serve-a.ts => serve/serve-b.ts}"), {
    from: "packages/quay/src/serve-a.ts",
    to: "packages/quay/src/serve/serve-b.ts",
  });
  assert.deepEqual(parseNumstatPath("old/dir/a.ts => new/dir/a.ts"), { from: "old/dir/a.ts", to: "new/dir/a.ts" });
});

test("readWindowAdditions — a pure MOVE adds 0 (rename detection is what keeps a move out of the count)", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 50);
  repo.write("mod/moved.ts", 40);
  const base = repo.commit("baseline");
  repo.remove("mod/moved.ts");
  repo.write("mod/newhome/moved.ts", 40);
  repo.commit("pure move");
  const r = readWindowAdditions(
    repo.dir,
    base,
    repo.commits.at(-1),
    new Set(["mod/central.ts"]),
    (p) => globToRegExp("mod/**/*.ts").test(p) || globToRegExp("mod/*.ts").test(p),
  );
  assert.equal(r.ok, true, r.error ?? "");
  assert.deepEqual([r.central, r.nonCentral], [0, 0], "a move is reorganisation, not growth");
});

test("readWindowAdditions — a FAILED git read is `ok:false`, never zeros (「读不懂」 ≠ 「没有新增」)", () => {
  const r = readWindowAdditions("/definitely/not/a/repo/der-missing", "deadbeef", "deadbeef", new Set(), () => true);
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, "string");
  assert.ok(r.error.length > 0);
});

test("buildReadings — AC1: EVERY subsystem in the round record carries both calibers", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 100);
  repo.write("mod/other.ts", 100);
  const base = repo.commit("baseline");
  repo.write("mod/central.ts", 110);
  repo.write("mod/other.ts", 190);
  repo.commit("grow");
  const rec = buildReadings(repo.dir, {
    ts: "T0",
    subsystems: [{ name: "m", baseline: base, central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }], modules: ["mod/*.ts"] }],
  });
  const sub = rec.rm1.subsystems[0];
  for (const k of ["share", "shareBasis", "additionsShare", "additionsNumerator", "additionsDenominator"]) {
    assert.ok(k in sub, `AC1: the record must carry \`${k}\` (missing keys are indistinguishable from a zero)`);
  }
  assert.equal(sub.shareBasis, "net");
  assert.deepEqual([sub.centralDelta, sub.nonCentralDelta, sub.sharePercent], [10, 90, 10]);
  assert.deepEqual([sub.additionsNumerator, sub.additionsDenominator, sub.additionsSharePercent], [10, 100, 10]);
  // Every subsystem row of the JUDGMENT carries both numbers too (the AC3 table surface).
  assert.equal(rec.evolution, undefined, "the judgment is added by the round entry point, not by buildReadings");
});

test("measureSubsystem — a MOVED central file is declared at both ends and still measures", (t) => {
  const repo = makeRepo(t);
  repo.write("central.ts", 100);
  repo.write("other.ts", 10);
  const base = repo.commit("baseline");
  repo.remove("central.ts");
  repo.write("sub/central.ts", 130);
  repo.write("other.ts", 20);
  repo.commit("move + grow");

  const r = measureSubsystem(repo.dir, {
    name: "moved",
    baseline: base,
    central: [{ atBaseline: "central.ts", atHead: "sub/central.ts" }],
    modules: ["central.ts", "sub/*.ts", "other.ts"],
  });
  assert.equal(r.evaluated, true, r.reason ?? "");
  assert.equal(r.centralDelta, 30);
  assert.equal(r.nonCentralDelta, 10);
  assert.equal(r.centralFiles[0].baselineLines, 100);
  assert.equal(r.centralFiles[0].headLines, 130);
});

test("measureSubsystem — `head` pins the window's right end (a historical reading is reproducible)", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 100);
  const base = repo.commit("baseline");
  repo.write("mod/central.ts", 150);
  const mid = repo.commit("mid");
  repo.write("mod/central.ts", 200);
  repo.write("mod/new.ts", 100);
  repo.commit("later");

  const spec = { name: "m", baseline: base, central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }], modules: ["mod/*.ts"] };
  const atMid = measureSubsystem(repo.dir, spec, { head: mid });
  assert.equal(atMid.centralDelta, 50);
  assert.equal(atMid.nonCentralDelta, 0);
  assert.equal(atMid.share, 1);
  const atHead = measureSubsystem(repo.dir, spec);
  assert.equal(atHead.centralDelta, 100);
  assert.equal(atHead.nonCentralDelta, 100);
  assert.equal(atHead.share, 0.5);
});

test("measureSubsystem — the window's single largest central change is NAMED (a move is visible, not classified)", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 100);
  repo.write("mod/other.ts", 100);
  const base = repo.commit("baseline");
  repo.write("mod/central.ts", 105); // +5
  repo.commit("small");
  // A MOVE: 60 lines out of the central file into a module file.
  repo.write("mod/central.ts", 45); // -60
  repo.write("mod/other.ts", 160); // +60
  const moveSha = repo.commit("move");
  const r = measureSubsystem(repo.dir, {
    name: "m",
    baseline: base,
    central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }],
    modules: ["mod/*.ts"],
  });
  assert.equal(r.evaluated, true, r.reason ?? "");
  assert.notEqual(r.maxCentralChangeCommit, null);
  assert.equal(r.maxCentralChangeCommit.sha, moveSha, "the largest |centralΔ| commit must be the move");
  assert.equal(r.maxCentralChangeCommit.centralDelta, -60);
  assert.equal(r.maxCentralChangeCommit.nonCentralDelta, 60);
  // ⛔ No classifier decided "this is a move" — the raw commit is put in front of the reader
  // (硬规则 4 推论). The share across the whole window still counts the move as growth elsewhere.
  assert.equal(r.centralDelta, -55);
  assert.equal(r.nonCentralDelta, 60);
  assert.equal(r.denominator, 5);
});

test("measureSubsystem — a move SPLIT ACROSS commits is listed in full by oppositeSignCommits (缺陷 3)", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 400);
  repo.write("mod/pool.ts", 0);
  const base = repo.commit("baseline");
  // A genuine GROWTH commit: the largest |centralΔ| in the window (+300, nothing leaves).
  repo.write("mod/central.ts", 700);
  const growthSha = repo.commit("real growth");
  // The move, split in two: neither half is the largest single change.
  repo.write("mod/central.ts", 500); // -200
  repo.write("mod/pool.ts", 200); // +200
  const moveA = repo.commit("move part 1");
  repo.write("mod/central.ts", 440); // -60
  repo.write("mod/pool.ts", 260); // +60
  const moveB = repo.commit("move part 2");

  const r = measureSubsystem(repo.dir, {
    name: "m",
    baseline: base,
    central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }],
    modules: ["mod/*.ts"],
  });
  assert.equal(r.evaluated, true, r.reason ?? "");
  // The single-largest field still names the growth — that is exactly why it could not reveal the move.
  assert.equal(r.maxCentralChangeCommit.sha, growthSha);
  assert.equal(r.maxCentralChangeCommit.centralDelta, 300);
  // The raw sign pair catches BOTH halves, with no threshold, and does not misreport the growth.
  const shas = r.oppositeSignCommits.map((c) => c.sha);
  assert.deepEqual(shas, [moveB, moveA], "newest first, every central-shrinking / module-growing commit");
  assert.deepEqual(
    r.oppositeSignCommits.map((c) => [c.centralDelta, c.nonCentralDelta]),
    [
      [-60, 60],
      [-200, 200],
    ],
  );
  assert.equal(shas.includes(growthSha), false, "a real growth has nonCentralΔ 0 ⇒ not a move");
  assert.equal(r.oppositeSignCommits[0].subject, "move part 2", "the commit title comes along");
});

test("measureSubsystem — oppositeSignCommits is [] (not null) when the window has no move", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 10);
  repo.write("mod/other.ts", 10);
  const base = repo.commit("baseline");
  repo.write("mod/central.ts", 20);
  repo.write("mod/other.ts", 20);
  repo.commit("both grow");
  const r = measureSubsystem(repo.dir, {
    name: "m",
    baseline: base,
    central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }],
    modules: ["mod/*.ts"],
  });
  assert.deepEqual(r.oppositeSignCommits, []);
});

// ── ② three-valued rules ──────────────────────────────────────────────────────────────────────────

test("measureSubsystem — an unresolvable baseline is NOT-EVALUATED, share null", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 10);
  const base = repo.commit("baseline");
  const r = measureSubsystem(repo.dir, {
    name: "m",
    baseline: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }],
    modules: ["mod/*.ts"],
  });
  assert.equal(r.evaluated, false);
  assert.match(r.reason, /baseline-unresolvable/);
  assert.equal(r.share, null);
  assert.equal(r.centralDelta, null);
  assert.equal(r.sharePercent, null);
  assert.equal(r.baselineSha, null);
  assert.notEqual(base, "");
});

test("measureSubsystem — a central path absent at HEAD is NOT-EVALUATED and NAMES the path (AC3)", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/serve-handlers.ts", 100);
  repo.write("mod/other.ts", 10);
  const base = repo.commit("baseline");
  repo.remove("mod/serve-handlers.ts");
  repo.write("mod/sub/serve-handlers.ts", 120);
  repo.commit("moved");

  const r = measureSubsystem(repo.dir, {
    name: "serve",
    baseline: base,
    // Only the BASELINE spelling is declared — the head path no longer exists (the real regression).
    central: [{ atBaseline: "mod/serve-handlers.ts", atHead: "mod/serve-handlers.ts" }],
    modules: ["mod/**/*.ts"],
  });
  assert.equal(r.evaluated, false);
  assert.match(r.reason, /central-absent-at-head: mod\/serve-handlers\.ts/);
  assert.equal(r.share, null);
  assert.equal(r.centralDelta, null);
});

test("measureSubsystem — a central path absent at BASELINE is NOT-EVALUATED (the mirror half)", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/other.ts", 10);
  const base = repo.commit("baseline");
  repo.write("mod/central.ts", 50);
  repo.commit("created later");
  const r = measureSubsystem(repo.dir, {
    name: "m",
    baseline: base,
    central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }],
    modules: ["mod/*.ts"],
  });
  assert.equal(r.evaluated, false);
  assert.match(r.reason, /central-absent-at-baseline: mod\/central\.ts/);
  assert.equal(r.share, null);
});

test("measureSubsystem — a non-positive denominator is NOT-EVALUATED (a share of nothing is not a reading)", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 100);
  repo.write("mod/other.ts", 100);
  const base = repo.commit("baseline");
  repo.write("mod/central.ts", 90);
  repo.write("mod/other.ts", 90);
  repo.commit("shrink");
  const r = measureSubsystem(repo.dir, {
    name: "m",
    baseline: base,
    central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }],
    modules: ["mod/*.ts"],
  });
  assert.equal(r.evaluated, false);
  assert.match(r.reason, /non-positive-denominator: centralΔ=-10 nonCentralΔ=-10/);
  assert.equal(r.share, null);
});

test("measureSubsystem — a window with NO change is also NOT-EVALUATED (denominator 0)", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 10);
  const base = repo.commit("baseline");
  repo.write("readme.md", 1);
  repo.commit("unrelated");
  const r = measureSubsystem(repo.dir, {
    name: "m",
    baseline: base,
    central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }],
    modules: ["mod/*.ts"],
  });
  assert.equal(r.evaluated, false);
  assert.match(r.reason, /non-positive-denominator/);
  assert.equal(r.sharePercentRounded, null);
});

test("globToRegExp — `*` never crosses a directory, `**` does", () => {
  assert.equal(globToRegExp("dir/*.ts").test("dir/a.ts"), true);
  assert.equal(globToRegExp("dir/*.ts").test("dir/sub/a.ts"), false);
  assert.equal(globToRegExp("dir/**/*.ts").test("dir/sub/a.ts"), true);
  assert.equal(globToRegExp("plugin/scripts/*worker*.ts").test("plugin/scripts/worker-driver.ts"), true);
  assert.equal(globToRegExp("plugin/scripts/*worker*.ts").test("plugin/scripts/sub/worker.ts"), false);
});

test("lineCountAt — absence is null, and an absent path is distinguishable from an empty file", (t) => {
  const repo = makeRepo(t);
  repo.write("a.ts", 0);
  const sha = repo.commit("empty");
  const paths = new Set(["a.ts"]);
  assert.deepEqual(lineCountAt(repo.dir, sha, "a.ts", paths), { lines: 0, error: null });
  assert.deepEqual(lineCountAt(repo.dir, sha, "missing.ts", paths), { lines: null, error: null });
  assert.equal(resolveCommit(repo.dir, "nope-nope").sha, null);
});

// ── ③ RM2 ─────────────────────────────────────────────────────────────────────────────────────────

function writeCarrier(t, records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "der-rm2-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const file = path.join(dir, ".quay", "worker-outcome.jsonl");
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { dir, file };
}

test("scanContention — both shapes count once per RECORD (a conflict quoted twice is one conflict)", (t) => {
  const { dir, file } = writeCarrier(t, [
    // Form 1 names the file by BARE basename; form 2 quotes the full path. The tracked-file index is
    // what ties them together — one file must not become two keys (and two files must not merge).
    { task: "t1", ts: "T1", selector_reason: "避开 worker-driver.ts 的争用" },
    {
      task: "t2",
      ts: "T2",
      selector_reason: "两者都 touch goal-driver.ts（互斥只能选一）",
      mechanical_fan_in: { reason: "Merge conflict in plugin/scripts/worker-driver.ts" },
      extra: { log: "Merge conflict in plugin/scripts/worker-driver.ts" },
    },
    { task: "t3", ts: "T3", selector_reason: "unrelated wording about worker-driver.ts" },
  ]);
  const r = scanContention(dir, {
    carrierPath: file,
    repoPaths: ["plugin/scripts/worker-driver.ts", "plugin/scripts/goal-driver.ts"],
  });
  assert.equal(r.evaluated, true, r.reason ?? "");
  assert.equal(r.carrierRecords, 3);
  assert.deepEqual(r.predicateSelfCheck, { ok: true, form1: true, form2: true });
  assert.deepEqual(r.pathIndex, { available: true, files: 2 });
  const wd = r.files.find((f) => f.file === "plugin/scripts/worker-driver.ts");
  assert.ok(wd, "the bare basename and the full path must be ONE key");
  assert.equal(wd.basename, "worker-driver.ts");
  assert.equal(wd.form1, 1, "t3 has no contention token ⇒ not form 1");
  assert.equal(wd.form2, 1, "the same conflict text appears twice in ONE record ⇒ still 1");
  assert.equal(wd.total, 2);
  assert.deepEqual(wd.observedPaths, ["plugin/scripts/worker-driver.ts"], "provenance is repo-relative");
  const gd = r.files.find((f) => f.file === "plugin/scripts/goal-driver.ts");
  assert.equal(gd.form1, 1);
  assert.deepEqual(gd.samples.form1.map((s) => s.task), ["t2"]);
  // Samples carry the task id AND the time (AC4's required sample shape).
  assert.deepEqual(wd.samples.form2.map((s) => [s.task, s.ts]), [["t2", "T2"]]);
});

test("scanContention — the window starts where the previous record's watermark ended", (t) => {
  const { dir, file } = writeCarrier(t, [
    { task: "old", ts: "T1", selector_reason: "避开 a.ts 的争用" },
    { task: "new", ts: "T2", selector_reason: "避开 a.ts 的争用" },
  ]);
  const all = scanContention(dir, { carrierPath: file });
  assert.equal(all.files[0].form1, 2);
  assert.equal(all.files[0].windowForm1, 2);
  const windowed = scanContention(dir, { carrierPath: file, windowStartIndex: 1, windowSource: "previous-record" });
  assert.equal(windowed.files[0].form1, 2, "cumulative counts are unaffected by the window");
  assert.equal(windowed.files[0].windowForm1, 1);
  assert.equal(windowed.windowSource, "previous-record");
});

test("scanContention — top_n bounds the list; a larger top_n reaches a low-count file", (t) => {
  const records = [];
  for (let i = 0; i < 12; i++) records.push({ task: `hot${i}`, ts: "T", mechanical_fan_in: { reason: `Merge conflict in hot${i}.ts` } });
  records.push({ task: "goal", ts: "T", selector_reason: "都 touch goal-driver.ts" });
  const { dir, file } = writeCarrier(t, records);
  assert.equal(scanContention(dir, { carrierPath: file }).files.length, 10);
  const wide = scanContention(dir, { carrierPath: file, topN: 100 });
  assert.equal(wide.files.length, 13);
  assert.equal(wide.files.find((f) => f.file === "goal-driver.ts").form1, 1);
});

test("scanContention — a MISSING carrier is NOT-EVALUATED, not 「零争用」", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "der-rm2-missing-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = scanContention(dir);
  assert.equal(r.evaluated, false);
  assert.match(r.reason, /carrier-missing/);
  assert.equal(r.carrierRecords, null);
  assert.deepEqual(r.files, []);
});

test("scanContention — a BROKEN predicate turns the reading into evaluated:false (AC4's negative control)", (t) => {
  const { dir, file } = writeCarrier(t, [{ task: "t", ts: "T", selector_reason: "争用 a.ts" }]);
  // Only form 1 is broken: the self-check must fail and name it.
  const broken = {
    form1Files: () => [],
    form2Files: DEFAULT_CONTENTION_PREDICATES.form2Files,
  };
  const r = scanContention(dir, { carrierPath: file, predicates: broken });
  assert.equal(r.evaluated, false, "a predicate that cannot read its input must not report zero contention");
  assert.match(r.reason, /predicate-selfcheck-failed: form1/);
  assert.deepEqual(r.predicateSelfCheck, { ok: false, form1: false, form2: true });
  assert.deepEqual(r.files, []);

  // And the both-broken case names both.
  const bothBroken = { form1Files: () => [], form2Files: () => [] };
  const r2 = scanContention(dir, { carrierPath: file, predicates: bothBroken });
  assert.match(r2.reason, /predicate-selfcheck-failed: form1\+form2/);
});

test("the built-in self-check sample really carries both shapes (the predicate's known-true oracle)", () => {
  assert.deepEqual(DEFAULT_CONTENTION_PREDICATES.form1Files(PREDICATE_SELFCHECK_SAMPLE), [PREDICATE_SELFCHECK_PATH]);
  assert.deepEqual(DEFAULT_CONTENTION_PREDICATES.form2Files(PREDICATE_SELFCHECK_SAMPLE), [PREDICATE_SELFCHECK_PATH]);
  assert.equal(PREDICATE_SELFCHECK_PATH.includes("/"), true, "the sample is spelled repo-relative in BOTH shapes");
  assert.equal(CONTENTION_TOKENS.includes("contention"), true);
  assert.equal(CONTENTION_TOKENS.includes("避开"), true);
});

// ── path identity (缺陷 1 / AC1 / AC2) ───────────────────────────────────────────────────────────

test("stripWorktreePrefix — a worktree root is not part of a file's identity", () => {
  assert.equal(stripWorktreePrefix("/home/yale/work/quay-worktrees/gap-x/plugin/scripts/a.ts"), "plugin/scripts/a.ts");
  assert.equal(stripWorktreePrefix("///home/yale/work/quay-worktrees/gap-x/plugin/scripts/a.ts"), "plugin/scripts/a.ts");
  assert.equal(stripWorktreePrefix("quay-worktrees/gap-x/plugin/scripts/a.ts"), "plugin/scripts/a.ts");
  assert.equal(stripWorktreePrefix("plugin/scripts/a.ts"), null);
});

test("createPathIdentityResolver — checkout root, worktree root, redundant slashes and a bare name are ONE identity", () => {
  const resolver = createPathIdentityResolver("/repo", { repoPaths: ["plugin/scripts/worker-driver.ts"] });
  const want = "plugin/scripts/worker-driver.ts";
  for (const spelling of [
    "plugin/scripts/worker-driver.ts",
    "./plugin/scripts/worker-driver.ts",
    "/repo/plugin/scripts/worker-driver.ts",
    "///repo/plugin/scripts/worker-driver.ts",
    "/home/yale/work/quay-worktrees/gap-x/plugin/scripts/worker-driver.ts",
    "///home/yale/work/quay-worktrees/gap-x/plugin/scripts/worker-driver.ts",
    "quay-worktrees/gap-x/plugin/scripts/worker-driver.ts",
    "worker-driver.ts", // bare: the index says which file this is
  ]) {
    assert.deepEqual(resolver.resolve(spelling), { rel: want, reason: null }, spelling);
  }
});

test("createPathIdentityResolver — unresolvable/ambiguous tokens are REFUSED by name, never mapped to some key", () => {
  const resolver = createPathIdentityResolver("/repo", {
    repoPaths: ["plugin/scripts/index.ts", "packages/quay/src/index.ts", "plugin/scripts/only.ts"],
  });
  // An absolute path outside every known root cannot be made repo-relative.
  const outside = resolver.resolve("/tmp/somewhere/index.ts");
  assert.equal(outside.rel, null);
  assert.match(outside.reason, /absolute-path-outside-repo/);
  // A bare name matching TWO repo paths has no identity it could honestly pick.
  const ambiguous = resolver.resolve("index.ts");
  assert.equal(ambiguous.rel, null);
  assert.match(ambiguous.reason, /ambiguous-bare-name: index\.ts matches 2 repo paths/);
  // A bare name matching exactly one path resolves.
  assert.deepEqual(resolver.resolve("only.ts"), { rel: "plugin/scripts/only.ts", reason: null });
});

test("AC2 (fixture negative control) — two same-named files in DIFFERENT directories are TWO keys, one each", (t) => {
  const { dir, file } = writeCarrier(t, [
    { task: "a", ts: "T1", mechanical_fan_in: { reason: "Merge conflict in a/index.ts" } },
    { task: "b", ts: "T2", mechanical_fan_in: { reason: "Merge conflict in b/index.ts" } },
  ]);
  const r = scanContention(dir, { carrierPath: file });
  assert.equal(r.evaluated, true, r.reason ?? "");
  // ⛔ A basename-keyed implementation reports ONE key with form2=2 here and fails this assertion.
  assert.deepEqual(
    r.files.map((f) => [f.file, f.basename, f.form2]).sort(),
    [
      ["a/index.ts", "index.ts", 1],
      ["b/index.ts", "index.ts", 1],
    ],
  );
  // Provenance is present for form 2 too (缺陷 2).
  assert.deepEqual(r.files.find((f) => f.file === "a/index.ts").observedPaths, ["a/index.ts"]);
  assert.deepEqual(r.files.find((f) => f.file === "b/index.ts").observedPaths, ["b/index.ts"]);
});

test("scanContention — a hit that cannot be mapped lands in unresolvedPaths and does NOT merge into another key", (t) => {
  const { dir, file } = writeCarrier(t, [
    { task: "a", ts: "T1", mechanical_fan_in: { reason: "Merge conflict in plugin/scripts/log.ts" } },
    { task: "b", ts: "T2", mechanical_fan_in: { reason: "Merge conflict in /tmp/elsewhere/log.ts" } },
  ]);
  const r = scanContention(dir, { carrierPath: file });
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].file, "plugin/scripts/log.ts");
  assert.equal(r.files[0].form2, 1, "the /tmp path must not be counted under this key");
  assert.equal(r.unresolvedPaths.length, 1);
  assert.equal(r.unresolvedPaths[0].raw, "/tmp/elsewhere/log.ts");
  assert.match(r.unresolvedPaths[0].reason, /absolute-path-outside-repo/);
});

// ── the round record ─────────────────────────────────────────────────────────────────────────────

test("buildReadings — both RMs land in ONE record; evaluated is the AND of the two", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 100);
  repo.write("mod/other.ts", 100);
  const base = repo.commit("baseline");
  repo.write("mod/central.ts", 110);
  repo.write("mod/other.ts", 150);
  repo.commit("grow");
  fs.mkdirSync(path.join(repo.dir, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(repo.dir, ".quay", "worker-outcome.jsonl"),
    JSON.stringify({ task: "x", ts: "T", selector_reason: "避开 mod/central.ts 的争用" }) + "\n",
  );

  const rec = buildReadings(repo.dir, {
    ts: "T0",
    subsystems: [{ name: "m", baseline: base, central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }], modules: ["mod/*.ts"] }],
  });
  assert.equal(rec.mode, "design-evolution-readings-round");
  assert.equal(rec.ts, "T0");
  assert.equal(rec.reportOnly, true);
  assert.equal(rec.evaluated, true);
  assert.equal(rec.rm1.subsystems[0].centralDelta, 10);
  assert.equal(rec.rm2.evaluated, true);
  assert.equal(rec.rm2.files[0].file, "mod/central.ts", "the key is the repo-relative path, not the basename");
  assert.notEqual(rec.rm1.subsystems[0].maxCentralChangeCommit, null, "AC5: the largest central commit must be present");
  assert.equal(rec.carrierRecords, 1, "the watermark the NEXT round starts from");

  // One reading that cannot be taken makes the RECORD not-evaluated, and the reason names which.
  const rec2 = buildReadings(repo.dir, {
    ts: "T1",
    subsystems: [{ name: "bad", baseline: "does-not-exist", central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }], modules: ["mod/*.ts"] }],
  });
  assert.equal(rec2.evaluated, false);
  assert.match(rec2.reason, /rm1: bad: baseline-unresolvable/);
});

test("buildReadings — the ADR-008 phase staleness rides along as ATTACHED info and never changes evaluated", (t) => {
  const repo = makeRepo(t);
  repo.write("mod/central.ts", 100);
  const base = repo.commit("baseline");
  repo.write("mod/central.ts", 110);
  repo.commit("grow");
  fs.mkdirSync(path.join(repo.dir, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, ".quay", "worker-outcome.jsonl"), "");
  const subsystems = [{ name: "m", baseline: base, central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }], modules: ["mod/*.ts"] }];

  // (a) No phase carrier: the ATTACHED reading is NOT-EVALUATED (null, ⛔ not 0) while the ROUND is
  // still evaluated — a missing declaration must never look like a failed design-evolution round.
  const noCarrier = buildReadings(repo.dir, { ts: "2026-01-10T00:00:00.000Z", subsystems });
  assert.equal(noCarrier.evaluated, true);
  assert.equal(noCarrier.phaseStaleness.evaluated, false);
  assert.match(noCarrier.phaseStaleness.reason, /carrier-missing/);
  assert.equal(noCarrier.phaseStaleness.commitsSince, null);

  // (b) With a carrier: the reading is EMBEDDED verbatim, and a stale declaration is still content —
  // the round's own verdict is byte-for-byte the one it had before the field existed.
  fs.writeFileSync(
    path.join(repo.dir, ".quay", "two-phase-state.json"),
    JSON.stringify({
      phase: "convergence",
      declaredAt: "2026-01-01T00:00:00.000Z",
      reason: "fixture",
      history: [{ phase: "convergence", declaredAt: "2026-01-01T00:00:00.000Z", reason: "fixture" }],
    }),
  );
  const withCarrier = buildReadings(repo.dir, { ts: "2026-01-10T00:00:00.000Z", subsystems });
  assert.equal(withCarrier.evaluated, true, "a stale declaration is content, ⛔ not a failed round");
  assert.equal(withCarrier.reason, null);
  assert.equal(withCarrier.phaseStaleness.evaluated, true);
  assert.equal(withCarrier.phaseStaleness.phase, "convergence");
  assert.equal(withCarrier.phaseStaleness.declarations, 1);
  assert.equal(withCarrier.phaseStaleness.daysSince, 9, "`ts` is the deterministic clock for the distance");
  assert.equal(typeof withCarrier.phaseStaleness.commitsSince, "number");
});

test("buildReadings — declaring NO subsystem is a named not-evaluated RM1, never a silent pass", (t) => {
  const repo = makeRepo(t);
  repo.write("x.ts", 1);
  repo.commit("one");
  fs.mkdirSync(path.join(repo.dir, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, ".quay", "worker-outcome.jsonl"), "");
  const rec = buildReadings(repo.dir, { ts: "T", subsystems: [] });
  assert.equal(rec.rm1.evaluated, false);
  assert.match(rec.rm1.reason, /rm1-no-subsystems-declared/);
  assert.equal(rec.evaluated, false);
});

// ── config parsing ────────────────────────────────────────────────────────────────────────────────

test("parseDesignEvolutionSection — kill switch, defaults, floors, and malformed entries", () => {
  assert.equal(parseDesignEvolutionSection(null).config, null);
  assert.match(parseDesignEvolutionSection({ interval: "interval:360m" }).error, /boolean 'enabled'/);
  assert.deepEqual(parseDesignEvolutionSection({ enabled: false }).config, {
    enabled: false,
    intervalMinutes: null,
    subsystems: [],
    topN: 10,
    // The dark-streak POLICY default (⛔ not a measurement) comes from its single definition point.
    darkStreakRounds: DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT,
  });
  // enabled without interval/subsystems ⇒ documented defaults, not an unset schedule.
  assert.deepEqual(parseDesignEvolutionSection({ enabled: true }).config, {
    enabled: true,
    intervalMinutes: 360,
    subsystems: [],
    topN: 10,
    darkStreakRounds: DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT,
  });
  // The one policy knob: an explicit value overrides the default, a malformed one is REFUSED (⛔ a
  // silent round-trip to 2 would hide the operator's intent — the same rule `interval` follows).
  assert.equal(parseDesignEvolutionSection({ enabled: true, dark_streak_rounds: 3 }).config.darkStreakRounds, 3);
  assert.match(parseDesignEvolutionSection({ enabled: true, dark_streak_rounds: 0 }).error, /dark_streak_rounds/);
  assert.match(parseDesignEvolutionSection({ enabled: true, dark_streak_rounds: "2" }).error, /dark_streak_rounds/);
  assert.match(parseDesignEvolutionSection({ enabled: true, interval: `interval:59m` }).error, /60m floor/);
  assert.match(parseDesignEvolutionSection({ enabled: true, interval: "every(5)" }).error, /interval:<N>m/);
  assert.match(parseDesignEvolutionSection({ enabled: true, top_n: 0 }).error, /top_n/);
  // A misspelled key is REFUSED: a silently ignored `module:` would read as "no module files".
  assert.match(parseDesignEvolutionSection({ enabled: true, modul: ["a.ts"] }).error, /unknown key/);
  assert.match(
    parseDesignEvolutionSection({ enabled: true, subsystems: [{ name: "x", baseline: "abc", central: ["a.ts"], modules: [] }] }).error,
    /modules must be a non-empty list/,
  );
  assert.match(
    parseDesignEvolutionSection({ enabled: true, subsystems: [{ name: "x", baseline: "abc", central: [], modules: ["a.ts"] }] }).error,
    /central must be a non-empty list/,
  );
  // Duplicate subsystem names would put two rows under one carrier key.
  const dup = parseDesignEvolutionSection({
    enabled: true,
    subsystems: [
      { name: "x", baseline: "a", central: ["a.ts"], modules: ["a.ts"] },
      { name: "x", baseline: "b", central: ["b.ts"], modules: ["b.ts"] },
    ],
  });
  assert.match(dup.error, /duplicate subsystem name/);

  const ok = parseDesignEvolutionSection({
    enabled: true,
    interval: "interval:120m",
    top_n: 5,
    subsystems: [
      {
        name: "serve",
        baseline: "295e771b0",
        central: [{ at_baseline: "packages/quay/src/serve-handlers.ts", at_head: "packages/quay/src/serve/serve-handlers.ts" }],
        modules: ["packages/quay/src/serve/*.ts"],
      },
    ],
  });
  assert.equal(ok.error, null);
  assert.equal(ok.config.intervalMinutes, 120);
  assert.equal(ok.config.topN, 5);
  assert.deepEqual(ok.config.subsystems[0].central, [
    { atBaseline: "packages/quay/src/serve-handlers.ts", atHead: "packages/quay/src/serve/serve-handlers.ts" },
  ]);
});

test("readStandaloneSection — the --config seam parses the same section body", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "der-cfg-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "section.yml");
  fs.writeFileSync(file, "enabled: true\nsubsystems:\n  - name: w\n    baseline: abc\n    central: [a.ts]\n    modules: ['*.ts']\n");
  const read = readStandaloneSection(file);
  assert.equal(read.present, true);
  assert.equal(read.error, null);
  assert.equal(read.config.subsystems[0].name, "w");
  assert.equal(read.config.subsystems[0].central[0].atHead, "a.ts");
  const bad = readStandaloneSection(path.join(dir, "nope.yml"));
  assert.match(bad.error, /unreadable/);
});

// ── ④ the real readings (guarded: only when the real refs/carrier are present) ────────────────────

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

function hasCommit(rev) {
  const r = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() !== "";
}

test("AC2 (real history) — the unified formula reproduces the finding's corrected table: serve 1%, worker 82%", (t) => {
  if (!hasCommit("295e771b0") || !hasCommit("2440b52d0") || !hasCommit("ff32d031d")) {
    t.skip("real baseline refs are not in this clone (shallow?)");
    return;
  }
  const serve = measureSubsystem(REPO_ROOT, {
    name: "serve",
    baseline: "295e771b0",
    central: [{ atBaseline: "packages/quay/src/serve-handlers.ts", atHead: "packages/quay/src/serve/serve-handlers.ts" }],
    // server-state.ts moved serve/ -> core/ (gap-arch-directory-cycle-src-observation-serve): it is
    // still this subsystem's runtime state carrier, so the glob follows the file. Without the core/
    // arm the module set would silently shrink by the file and the reading would drift (11644 -> 11306).
    modules: [
      "packages/quay/src/serve*.ts",
      "packages/quay/src/server-state*.ts",
      "packages/quay/src/serve/*.ts",
      "packages/quay/src/core/server-state*.ts",
    ],
  // The window's right end is PINNED to the ref the finding's table was taken at — the SAME ref the
  // worker arm below pins. Both rows of that table are one historical reading, so they share one head;
  // with the default `HEAD` the serve row silently re-measured against a moving tree and any
  // legitimate refactor of these modules broke it with a plausible-looking number (e.g. the pidAlive
  // extraction moved 5 net lines out of core/server-state.ts ⇒ 11639). This is the reproducible
  // historical reading `head` exists for, not a live-HEAD drift detector.
  }, { head: "ff32d031d" });
  assert.equal(serve.evaluated, true, serve.reason ?? "");
  assert.equal(serve.centralDelta, 153);
  assert.equal(serve.nonCentralDelta, 11644);
  assert.equal(serve.sharePercentRounded, 1);

  const worker = measureSubsystem(REPO_ROOT, {
    name: "worker",
    baseline: "2440b52d0",
    central: [
      { atBaseline: "plugin/scripts/worker-driver.ts", atHead: "plugin/scripts/worker-driver.ts" },
      { atBaseline: "plugin/scripts/worker-fan-in.ts", atHead: "plugin/scripts/worker-fan-in.ts" },
    ],
    modules: ["plugin/scripts/*worker*.ts", "plugin/scripts/*pool*.ts", "plugin/scripts/*dispatch*.ts", "plugin/scripts/*fan-in*.ts"],
  }, { head: "ff32d031d" });
  assert.equal(worker.evaluated, true, worker.reason ?? "");
  assert.equal(worker.centralDelta, 4820);
  assert.equal(worker.nonCentralDelta, 1025);
  assert.equal(worker.sharePercentRounded, 82);
});

test("AC3 (real history) — serve's OLD central path alone reads NOT-EVALUATED and names the path", (t) => {
  if (!hasCommit("295e771b0")) {
    t.skip("real baseline ref is not in this clone");
    return;
  }
  const r = measureSubsystem(REPO_ROOT, {
    name: "serve",
    baseline: "295e771b0",
    central: [{ atBaseline: "packages/quay/src/serve-handlers.ts", atHead: "packages/quay/src/serve-handlers.ts" }],
    modules: ["packages/quay/src/serve*.ts", "packages/quay/src/serve/*.ts"],
  });
  assert.equal(r.evaluated, false);
  assert.match(r.reason, /central-absent-at-head: packages\/quay\/src\/serve-handlers\.ts/);
  assert.equal(r.share, null);
});

test("AC1/AC3 (real carrier) — repo-relative identity, non-empty provenance, no worktree/absolute spellings", (t) => {
  const carrier = path.join(REPO_ROOT, ".quay", "worker-outcome.jsonl");
  if (!fs.existsSync(carrier)) {
    t.skip(".quay/worker-outcome.jsonl is absent (gitignored runtime ledger)");
    return;
  }
  const r = scanContention(REPO_ROOT, { topN: 100_000 });
  assert.equal(r.evaluated, true, r.reason ?? "");
  assert.equal(r.predicateSelfCheck.ok, true, "the built-in known-true sample must pass on the real run");
  const at = (f) => r.files.find((x) => x.file === f);

  // AC1: the item's KEY is the repo-relative path, and its provenance never carries a worktree root
  // or a leading slash (the first production record's observedPaths were ALL worktree absolute paths).
  const wd = at("plugin/scripts/worker-driver.ts");
  assert.ok(wd, "worker-driver.ts must be keyed by its repo-relative path");
  assert.equal(wd.basename, "worker-driver.ts");
  assert.ok(wd.observedPaths.length > 0, "observedPaths must not be empty");
  for (const p of wd.observedPaths) {
    assert.equal(p.startsWith("/"), false, `observedPaths carries an absolute path: ${p}`);
    assert.equal(p.includes("quay-worktrees/"), false, `observedPaths carries a worktree path: ${p}`);
    assert.equal(p, "plugin/scripts/worker-driver.ts");
  }
  assert.equal(r.files.some((f) => f.file === "worker-driver.ts"), false, "the basename must not survive as its own key");
  // 4 (not the basename era's 5): one selector_reason wrote `fan-in-ff-merge.sh/worker-driver.ts`,
  // which is prose joining two file names, not a path. Under basename keying it counted; under path
  // identity it names a file that does not exist, so it is not a hit on `plugin/scripts/worker-driver.ts`.
  assert.ok(wd.form1 >= 4, `worker-driver.ts form1 ${wd.form1} < 4`);
  assert.ok(wd.form2 >= 6, `worker-driver.ts form2 ${wd.form2} < 6`);
  assert.ok(wd.samples.form1.length === Math.min(3, wd.form1));
  assert.ok(wd.samples.form1.every((s) => s.task !== null && s.ts !== null));

  // AC3: form 2 has provenance too — the path a reader can re-check against the tree.
  const ratchet = at("docs/analysis/quay-init-closure-ratchet.baseline.json");
  assert.ok(ratchet, "the ratchet baseline must be keyed by its repo-relative path");
  assert.ok(ratchet.form2 >= 4, `form2 ${ratchet.form2} < 4`);
  assert.deepEqual(ratchet.observedPaths, ["docs/analysis/quay-init-closure-ratchet.baseline.json"]);

  const wf = at("plugin/scripts/worker-fan-in.ts");
  assert.ok(wf.form1 >= 1, `worker-fan-in.ts form1 ${wf.form1} < 1`);
  assert.equal(wf.form2, 0);
  const gd = at("plugin/scripts/goal-driver.ts");
  assert.ok(gd.form1 >= 2, `goal-driver.ts form1 ${gd.form1} < 2`);
  assert.equal(gd.form2, 0);
});

test("AC4 (real history) — a move split across commits is visible; the real growth is not misreported", (t) => {
  if (!hasCommit("2440b52d0") || !hasCommit("f19a95371") || !hasCommit("024f9d7f2") || !hasCommit("3ad17ac26")) {
    t.skip("the real worker-history refs are not in this clone");
    return;
  }
  const r = measureSubsystem(REPO_ROOT, {
    name: "worker",
    baseline: "2440b52d0",
    head: "HEAD",
    central: [
      { atBaseline: "plugin/scripts/worker-driver.ts", atHead: "plugin/scripts/worker-driver.ts" },
      { atBaseline: "plugin/scripts/worker-fan-in.ts", atHead: "plugin/scripts/worker-fan-in.ts" },
    ],
    modules: ["plugin/scripts/*worker*.ts", "plugin/scripts/*pool*.ts", "plugin/scripts/*dispatch*.ts", "plugin/scripts/*fan-in*.ts"],
  });
  assert.equal(r.evaluated, true, r.reason ?? "");
  const shas = r.oppositeSignCommits.map((c) => c.sha.replace(/^(.{9}).*/, "$1"));
  assert.ok(shas.includes("f19a95371"), `f19a95371 missing from ${JSON.stringify(shas)}`);
  assert.ok(shas.includes("024f9d7f2"), `024f9d7f2 missing from ${JSON.stringify(shas)}`);
  assert.equal(shas.includes("3ad17ac26"), false, "a real growth (centralΔ>0, nonCentralΔ=0) must not be listed");
  const move = r.oppositeSignCommits.find((c) => c.sha.startsWith("f19a95371"));
  assert.equal(move.centralDelta, -356);
  assert.equal(move.nonCentralDelta, 505);
  assert.deepEqual([move.subject.length > 0], [true]);
});

test("oppositeSignCommits — a git read failure is null, not 「没有搬家」", () => {
  assert.equal(
    oppositeSignCommits(REPO_ROOT, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "HEAD", new Set(), () => false),
    null,
  );
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⑤ THE JUDGMENT + THE FINDING (tasks/gap-design-evolution-readings-emit-findings)
//
// WHAT THIS PINS, in decreasing order of how easy to lose:
//   ⓐ THE FOUR STATES ARE PAIRWISE DISTINGUISHABLE (硬规则 3b) — `no-prior` and `stable` must not
//     look alike, and `not-evaluated` must not borrow `triggers: []` from 「没有触发」.
//   ⓑ THE DEDUP KEY IS MECHANICAL — the same subsystem+trigger keys identically across rounds even
//     when the rationale is re-worded; nothing else may collapse. This is the measured lesson from
//     `semantic-dedup-scan` (76 recurring clusters, 0 cross-round prose keys).
//   ⓒ THE INCREMENT IS THE TRIGGER — a share-up is 「denominator grew AND central grew」, NOT 「the
//     cumulative share is high」: the real carrier's serve row (1.31% ×8) never triggers.
//   ⓓ THE DARK INSTRUMENT FILES ITSELF — one dark round is `not-evaluated`, two is a finding.
//   ⓔ REAL CARRIER (guarded) — the replay lands the share-up on the record the task names, with the
//     numbers the task names, and does NOT file anything for the `worker` → `worker-history` rename.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A subsystem reading with every numeric field valid; override what a case is about. */
function subReading(over = {}) {
  return {
    name: "s", evaluated: true, reason: null,
    baseline: "base", head: "HEAD", baselineSha: "b0", headSha: "h0",
    central: [{ atBaseline: "c.ts", atHead: "c.ts" }], modules: ["*.ts"],
    centralDelta: 10, nonCentralDelta: 90, denominator: 100, share: 0.1, sharePercent: 10, sharePercentRounded: 10,
    shareBasis: "net", shareReason: null,
    additionsNumerator: 10, additionsDenominator: 100, additionsShare: 0.1, additionsSharePercent: 10, additionsReason: null,
    centralFiles: [{ atBaseline: "c.ts", atHead: "c.ts", baselineLines: 0, headLines: 10, delta: 10 }],
    moduleFileCount: 2, newModuleFiles: [], maxCentralChangeCommit: null, oppositeSignCommits: [],
    ...over,
  };
}

/** A round record with a taken RM1 and a taken RM2. */
function round(over = {}, subs = [subReading()]) {
  return {
    ts: "T0", mode: "design-evolution-readings-round", evaluated: true, reason: null, head: "h0",
    rm1: { evaluated: subs.every((s) => s.evaluated), reason: null, subsystems: subs },
    rm2: {
      evaluated: true, reason: null, carrierPath: "ledger.jsonl", carrierRecords: 0, windowStartIndex: 0,
      windowSource: "no-previous-record", topN: 10, pathIndex: [], predicateSelfCheck: { ok: true },
      unresolvedPaths: [], files: [],
    },
    carrierRecords: 0, phaseStaleness: {}, reportOnly: true,
    ...over,
  };
}

const dark = (name, reason = "baseline-unresolvable: nope") =>
  subReading({ name, evaluated: false, reason, centralDelta: null, nonCentralDelta: null, denominator: null, share: null, sharePercent: null, sharePercentRounded: null, centralFiles: [] });

test("AC1 — the four judgment states are PAIRWISE DISTINGUISHABLE (硬规则 3b)", () => {
  const first = round({ ts: "T0" });
  const settled = round({ ts: "T1" });
  const noPrior = judgeEvolutionRegression(null, first, { prevState: "no-prior-record" });
  const stable = judgeEvolutionRegression(first, settled, { priorDarkRounds: {} });
  const regression = judgeEvolutionRegression(
    round({ ts: "T0" }, [subReading({ centralDelta: 10, nonCentralDelta: 90, denominator: 100 })]),
    round({ ts: "T1" }, [subReading({ centralDelta: 40, nonCentralDelta: 90, denominator: 130 })]),
    { priorDarkRounds: {} },
  );
  const notEvaluated = judgeEvolutionRegression(round({ ts: "T0" }), round({ ts: "T1" }, [dark("s")]), { priorDarkRounds: {} });

  // ⓐ state is the discriminant, and no two states share it.
  assert.deepEqual(
    [noPrior.state, stable.state, regression.state, notEvaluated.state].sort(),
    ["no-prior", "not-evaluated", "regression", "stable"],
    "the four states must be four distinct values",
  );

  // ⓑ `no-prior` ≠ `stable`: BOTH `state` and `priorTs` differ (a reader keyed on either can tell).
  assert.equal(noPrior.priorTs, null);
  assert.equal(stable.priorTs, "T0");
  assert.notEqual(noPrior.state, stable.state);

  // ⓒ `not-evaluated` carries a NON-EMPTY reason and NO `triggers` field spelled `[]`.
  assert.equal(typeof notEvaluated.reason, "string");
  assert.ok(notEvaluated.reason.length > 0, "NOT-EVALUATED must name why");
  assert.equal(notEvaluated.triggers, null, "⛔ `triggers: []` would make 「判不了」 and 「无触发」 the same shape");
  assert.equal(stable.triggers, null);
  assert.equal(noPrior.triggers, null);

  // ⓓ `regression` carries a NON-EMPTY trigger list — and only regression does.
  assert.ok(Array.isArray(regression.triggers) && regression.triggers.length >= 1);
  assert.equal(regression.triggers[0].trigger, "share-up");
  assert.equal(regression.triggers[0].target, "s");
  assert.equal(regression.triggers[0].deltaCentral, 30); // 40 − 10
  assert.equal(regression.triggers[0].deltaDenominator, 30); // 130 − 100
  assert.equal(regression.reason, null);

  // ⓔ every state carries a non-null summary, so `stable` is still an assessment on the carrier.
  for (const v of [noPrior, stable, regression, notEvaluated]) assert.ok(v.summary.length > 0);

  // 8 assertions above are the AC1 surface (state set, priorTs ×2, state ×2, reason, triggers ×3,
  // trigger fields ×3, summary ×4).
});

test("AC1b — a share-up needs BOTH the denominator and the central delta to grow (⛔ not a high share)", () => {
  const prev = (c, n) => round({ ts: "T0" }, [subReading({ centralDelta: c, nonCentralDelta: n, denominator: c + n })]);
  const curr = (c, n) => round({ ts: "T1" }, [subReading({ centralDelta: c, nonCentralDelta: n, denominator: c + n })]);
  const judge = (p, c) => judgeEvolutionRegression(p, c, { priorDarkRounds: {} });

  // The real carrier's serve row: 1.31% and NO growth ⇒ stable, even though the share is tiny and
  // `worker-history` sits at 82.46% forever. A threshold-shaped rule would have filed both.
  assert.equal(judge(prev(153, 11687), curr(153, 11687)).state, "stable");
  assert.equal(judge(prev(4820, 1025), curr(4820, 1025)).state, "stable");
  // Non-central growth only (the decomposition is HOLDING) ⇒ stable.
  assert.equal(judge(prev(10, 90), curr(10, 290)).state, "stable");
  // Central growth with a SHRINKING denominator ⇒ NOT a share-up (the declared boundary).
  assert.equal(judge(prev(10, 290), curr(50, 50)).state, "stable");
  // Both grew ⇒ share-up.
  const up = judge(prev(172, 0), curr(288, 0));
  assert.equal(up.state, "regression");
  assert.deepEqual([up.triggers[0].deltaCentral, up.triggers[0].deltaDenominator, up.triggers[0].deltaNonCentral], [116, 116, 0]);
  // A different baseline ⇒ incomparable, ⛔ not a share-up.
  const rebased = judge(round({ ts: "T0" }, [subReading({ baselineSha: "aaa", centralDelta: 10, nonCentralDelta: 90 })]), curr(288, 0));
  assert.equal(rebased.state, "stable");
});

test("AC2 — the dedup key is MECHANICAL: same subsystem+trigger ⇒ same key, whatever the prose", () => {
  const a = {
    key: evolutionFindingKey("worker-post-909", "share-up"), target: "worker-post-909", trigger: "share-up",
    readingTs: "T1", priorReadingTs: "T0", deltaCentral: 116, deltaNonCentral: 0, deltaDenominator: 116,
    sharePercent: 100, darkRounds: null,
    rationale: "子系统 `worker-post-909` 本轮相对上一条读数分母增加 `116`、中心增量 `116`。", files: ["plugin/scripts/worker-driver.ts"],
    suggestedAction: "复核新行是否应落在模块文件", 
  };
  // The SAME finding, re-worded ("even the rationale is completely different") — as a fresh-context
  // round would emit it.
  const b = { ...a, rationale: "Worker post 909 keeps landing in the central files again this round; 116/116.", suggestedAction: "see the reading" };
  const c = { ...a, trigger: "dark-streak", key: evolutionFindingKey("worker-post-909", "dark-streak") };
  const d = { ...a, target: "serve", key: evolutionFindingKey("serve", "share-up") };

  const asFileable = (f) => {
    const r = evolutionFindingRecord(f, "T1");
    return { id: r.findingId, kind: r.dupKind, symbols: r.symbols, files: r.files, verdict: r.verdict, rationale: r.rationale, suggestedAction: r.suggestedAction };
  };
  const ka = findingKey(routineFindingCandidateText(asFileable(a)));
  const kb = findingKey(routineFindingCandidateText(asFileable(b)));
  const kc = findingKey(routineFindingCandidateText(asFileable(c)));
  const kd = findingKey(routineFindingCandidateText(asFileable(d)));

  assert.equal(ka, kb, "a re-worded rationale must NOT change the key");
  assert.equal(ka, "symbols:evolution:worker-post-909:share-up", "the key is the existing gate's subject form");
  assert.notEqual(ka, kc, "a different trigger is a different finding");
  assert.notEqual(ka, kd, "a different subsystem is a different finding");

  // The gate's DEDUP branch really fires on the second (re-worded) finding.
  const second = gateFinding(routineFindingCandidateText(asFileable(b)), { existingKeys: [ka], recentCount: 0, K: 3 });
  assert.equal(second.accept, false);
  assert.match(second.reason, /^dedup:/, "the rejection must name the dedup arm, not quality or rate");
  // …and the FIRST one passes the same gate (so the rejection is dedup, not a quality bar we invented).
  const firstPass = gateFinding(routineFindingCandidateText(asFileable(a)), { existingKeys: [], recentCount: 0, K: 3 });
  assert.equal(firstPass.accept, true, firstPass.reason);
});

test("AC6 — the share-up finding's TEXT names its caliber (⛔ never a bare 「占比 X%」)", () => {
  // The trigger is keyed on the NET increments (unchanged), but the filed text must say WHICH share it
  // quotes — the same window has two legitimate ones (task gap-design-evolution-share-caliber-… Plan 2).
  const prev = round({ ts: "T0" }, [subReading({ centralDelta: 172, nonCentralDelta: 0, denominator: 172 })]);
  const curr = round(
    { ts: "T1" },
    [
      subReading({
        centralDelta: 288, nonCentralDelta: 0, denominator: 288, share: 1, sharePercent: 100,
        additionsNumerator: 288, additionsDenominator: 307, additionsShare: 288 / 307, additionsSharePercent: 93.81,
      }),
    ],
  );
  const v = judgeEvolutionRegression(prev, curr, { priorDarkRounds: {} });
  assert.equal(v.state, "regression");
  assert.equal(v.triggers[0].trigger, "share-up");
  // The verdict row carries both numbers (the renderHuman/AC3 table surface).
  assert.deepEqual([v.subsystems[0].sharePercent, v.subsystems[0].additionsSharePercent], [100, 93.81]);
  const [f] = evolutionFindings(curr, v);
  assert.match(f.rationale, /netShare/, "the finding must NAME the net caliber");
  assert.match(f.rationale, /additionsShare/, "…and the additions-only caliber over the same window");
  assert.match(f.rationale, /netShare` `100%/, "the net value is quoted next to its name");
  assert.match(f.rationale, /additionsShare` `93\.81%/);
  // The carrier record carries the caliber beside the number, so a reader needs no prose.
  const rec = evolutionFindingRecord(f, "T1");
  assert.equal(rec.shareBasis, "net");
  assert.equal(rec.sharePercent, 100);
  assert.equal(rec.additionsSharePercent, 93.81);
  // The summary line is the same vocabulary (⛔ a second spelling would drift from the field names).
  assert.match(v.summary, /netShare=100%/);
  assert.match(v.summary, /additionsShare=93\.81%/);
});

test("AC2b — the same key is ONE recurrence subject across rounds (the gate's own reading)", async () => {
  const { recurrenceByKey } = await import("../scripts/routine-file-gate.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "der-key-"));
  const file = path.join(dir, "routine-findings.jsonl");
  const f = {
    key: evolutionFindingKey("rm2", "dark-streak"), target: "rm2", trigger: "dark-streak",
    readingTs: "T1", priorReadingTs: "T0", deltaCentral: null, deltaNonCentral: null, deltaDenominator: null,
    sharePercent: null, darkRounds: 2, rationale: "连续 `2` 轮 `evaluated:false`", suggestedAction: "修仪器", files: [".quay/worker-outcome.jsonl"],
  };
  fs.writeFileSync(file, JSON.stringify(evolutionFindingRecord(f, "2026-10-22T00:00:00.000Z")) + "\n", "utf8");
  fs.appendFileSync(file, JSON.stringify(evolutionFindingRecord({ ...f, rationale: "totally different words" }, "2026-10-22T06:00:00.000Z")) + "\n", "utf8");
  // ⚠️ `recurrenceByKey` counts DISTINCT runIds, and two different ts produce two runs ⇒ 2 rounds.
  const rec = recurrenceByKey(file);
  assert.ok(rec instanceof Map, "a readable carrier is a Map, ⛔ not null");
  assert.equal(rec.get("symbols:evolution:rm2:dark-streak"), 2, "both rounds are ONE subject");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("AC4 — one dark round is NOT-EVALUATED, two consecutive are a `dark-streak` FINDING", () => {
  const first = round({ ts: "T0" }, [subReading({ name: "w" })]);
  const oneDark = round({ ts: "T1", evaluated: false, reason: "rm1: w: non-positive-denominator" }, [dark("w", "non-positive-denominator: centralΔ=0 nonCentralΔ=0")]);

  // —— the sequence shortened to ONE round: the verdict cannot be taken, and NOTHING is filed.
  const single = judgeEvolutionRegression(first, oneDark, { priorDarkRounds: priorDarkRoundsFor([first], ["w", "rm2"]) });
  assert.equal(single.state, "not-evaluated");
  assert.equal(single.triggers, null);
  assert.ok(single.reason.length > 0);
  assert.deepEqual(evolutionFindings(oneDark, single), [], "one dark round must NOT file anything");

  // —— two consecutive dark rounds: `dark-streak`, and it DOES produce a finding.
  const twoDark = judgeEvolutionRegression(oneDark, oneDark, { priorDarkRounds: priorDarkRoundsFor([first, oneDark], ["w", "rm2"]) });
  assert.equal(twoDark.state, "regression");
  assert.deepEqual(twoDark.triggers.map((t) => `${t.trigger}:${t.target}:${t.darkRounds}`), ["dark-streak:w:2"]);
  const filed = evolutionFindings(oneDark, twoDark);
  assert.equal(filed.length, 1);
  assert.equal(filed[0].key, "evolution:w:dark-streak");
  assert.match(filed[0].rationale, /连续 `2` 轮/);

  // The threshold is a POLICY knob, and it really moves the answer (⛔ not a constant in disguise).
  const atThree = judgeEvolutionRegression(oneDark, oneDark, { darkStreakRounds: 3, priorDarkRounds: priorDarkRoundsFor([first, oneDark], ["w", "rm2"]) });
  assert.equal(atThree.state, "not-evaluated", "with the policy at 3 rounds, two is not yet a regression");
  assert.equal(DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT, 2);

  // A missing subsystem is reported as `source-missing`, and a RENAME is not a disappearance.
  const gone = judgeEvolutionRegression(round({ ts: "T0" }, [subReading({ name: "w" })]), round({ ts: "T1" }, [subReading({ name: "other", baselineSha: "zzz" })]), { priorDarkRounds: {} });
  assert.equal(gone.state, "regression");
  assert.deepEqual(gone.triggers.map((t) => `${t.trigger}:${t.target}`), ["source-missing:w"]);
  const renamed = judgeEvolutionRegression(round({ ts: "T0" }, [subReading({ name: "w" })]), round({ ts: "T1" }, [subReading({ name: "w-history" })]), { priorDarkRounds: {} });
  assert.equal(renamed.state, "stable", "same baseline + same central files ⇒ the SAME reading under a new label");
});

test("AC4b — the carrier read is THREE-VALUED (missing ≠ empty ≠ unreadable)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "der-hist-"));
  const file = path.join(dir, "h.jsonl");
  assert.equal(readDesignEvolutionHistory(dir, { historyPath: file }).state, "carrier-missing");
  fs.writeFileSync(file, "", "utf8");
  const empty = readDesignEvolutionHistory(dir, { historyPath: file });
  assert.equal(empty.state, "ok", "an empty carrier is a readable carrier with no records");
  assert.deepEqual(empty.records, []);
  fs.writeFileSync(file, "not json\n{\"mode\":\"other\"}\n", "utf8");
  const bad = readDesignEvolutionHistory(dir, { historyPath: file });
  assert.equal(bad.state, "unreadable", "⛔ must not read as 「没有历史」");
  assert.match(bad.reason, /none is a round record/);
  fs.writeFileSync(file, JSON.stringify(round({ ts: "T0" })) + "\nbroken\n", "utf8");
  const mixed = readDesignEvolutionHistory(dir, { historyPath: file });
  assert.equal(mixed.state, "ok");
  assert.equal(mixed.records.length, 1);
  assert.equal(mixed.malformed, 1, "the unparseable line is REPORTED, ⛔ not silently dropped");
  // An unreadable previous record is `not-evaluated`, ⛔ never `no-prior` (they are different facts).
  const v = judgeEvolutionRegression(null, round({ ts: "T1" }), { prevState: "previous-record-unusable" });
  assert.equal(v.state, "not-evaluated");
  assert.equal(v.priorState, "previous-record-unusable");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("AC3 (real carrier) — the replay lands ONE share-up on the record the task names, with its numbers", (t) => {
  // The carrier is RUNTIME state (gitignored, so a fresh worktree does not have it). A task worktree
  // must still exercise this pin, so fall back to the MAIN checkout's copy — read-only, ⛔ no write.
  const candidates = [path.join(REPO_ROOT, ".quay", "design-evolution-history.jsonl")];
  try {
    candidates.push(path.join(mainCheckoutRoot(), ".quay", "design-evolution-history.jsonl"));
  } catch {
    /* no main checkout reachable ⇒ the local candidate decides below */
  }
  const carrier = candidates.find((p) => fs.existsSync(p));
  if (!carrier) {
    t.skip(".quay/design-evolution-history.jsonl is absent from both this worktree and the main checkout");
    return;
  }
  const read = readDesignEvolutionHistory(path.dirname(path.dirname(carrier)), { historyPath: carrier });
  assert.equal(read.state, "ok", read.reason ?? "");
  assert.ok(read.records.length >= 7, `expected ≥7 real records, found ${read.records.length}`);

  const verdicts = [];
  for (let i = 0; i < read.records.length; i++) {
    const before = read.records.slice(0, i);
    const names = read.records[i].rm1.subsystems.map((s) => s.name);
    verdicts.push(
      judgeEvolutionRegression(i === 0 ? null : read.records[i - 1], read.records[i], {
        priorDarkRounds: priorDarkRoundsFor(before, names),
        prevState: i === 0 ? "no-prior-record" : "ok",
      }),
    );
  }
  const regressions = verdicts.filter((v) => v.state === "regression");
  assert.ok(regressions.length >= 1, "AC3: the real carrier must contain ≥1 share-up — 0 means the increment metric is wrong");

  const hit = verdicts
    .map((v, i) => ({ v, rec: read.records[i] }))
    .find(({ v }) => (v.triggers ?? []).some((x) => x.trigger === "share-up" && x.target === "worker-post-909"));
  assert.ok(hit, "the share-up must name worker-post-909");
  assert.equal(hit.rec.ts, "2026-10-22T04:24:51.164Z");
  const trig = hit.v.triggers.find((x) => x.trigger === "share-up" && x.target === "worker-post-909");
  assert.deepEqual([trig.deltaCentral, trig.deltaDenominator, trig.deltaNonCentral], [116, 116, 0]);
  // The findable identity is the mechanical key (no prose involved).
  assert.deepEqual(evolutionFindings(hit.rec, hit.v).map((f) => f.key), ["evolution:worker-post-909:share-up"]);

  // The `worker` → `worker-history` RENAME at record #1 must NOT read as a vanished subsystem
  // (identity = baseline + central files). A label-keyed rule would file a task for a config edit.
  for (const v of verdicts) {
    for (const tg of v.triggers ?? []) {
      assert.notEqual(tg.target, "worker", `a rename must not read as source-missing (${tg.trigger})`);
    }
  }
  // And a `stable` round files NOTHING (⛔ no heartbeat spam) while still carrying its assessment.
  // Pinned to the HISTORICAL record (the carrier is append-only, so this fact cannot drift), ⛔ not
  // to "the last record", which would make the test fail the first time a real round regresses.
  const stableIdx = read.records.findIndex((r) => r.ts === "2026-10-22T04:06:32.742Z");
  assert.ok(stableIdx > 0, "the 04:06:32.742Z record must be in the carrier");
  assert.equal(verdicts[stableIdx].state, "stable");
  assert.deepEqual(evolutionFindings(read.records[stableIdx], verdicts[stableIdx]), []);
});
