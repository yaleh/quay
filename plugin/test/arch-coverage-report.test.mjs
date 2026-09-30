// @test-group engine
// arch-coverage-report.test.mjs — analyzer-coverage self-report
// (task gap-arch-coverage-self-report; SPEC-architecture-consolidation-ts-and-shell-2026-09-19 §2 P6)
//
// Pins THREE things, in decreasing order of how easy they are to lose:
//   ① the "cannot judge" states never collapse into the "judged clean" one (CLAUDE.md 硬规则 3b).
//      The whole reason this report exists is that archguard's output vocabulary has no
//      NOT-EVALUATED state, so a manifest that is MISSING and a manifest that is UNREADABLE must
//      produce different values from a manifest that was read and found clean — and different from
//      each other. A regression here would be silent, which is exactly the class of defect the
//      report is about, so it is the first thing asserted.
//   ② the count caliber (AC2/AC4): the `.sh` and `.ts` rows must equal an INDEPENDENT shell count
//      taken with the same exclusion rules. This is the zero-count companion discipline: a number
//      that only agrees with itself proves nothing.
//   ③ the real readings on the real repo (AC2/AC3/AC6): as of 2026-09-19, `sh`/`mjs`/`js`/`py` are
//      all NOT-EVALUATED with trackedFiles > 0, the global scope covers only PART of the tracked
//      `.ts`, and at least one tracked `.ts` directory is covered by no scope at all. These are
//      asserted as INEQUALITIES/BOUNDS on the real repo rather than as frozen literals, so the test
//      keeps its meaning as the tree grows — but the "not evaluated set must not be empty" assertion
//      is deliberately NOT relaxed, because an empty unevaluated set IS the checker-failure signature
//      the task names.
//      ⚠️ ONE literal WAS removed (gap-arch-coverage-primary-scope-usurped-by-root-analyze): the
//      global scope's sources are no longer pinned to `["packages/quay/src"]`. That is a property of
//      the HOST's generated manifest, and any `archguard_analyze` omitting `sources` re-points
//      `globalScopeKey` at the repo root permanently. The report now CLASSIFIES the declared global
//      scope (`globalScopeKind`) and refuses to credit a whole-repo one as coverage; the assertions
//      moved onto that classification, which is what actually has to stay true.
//
// Run:
//   node --experimental-strip-types --test plugin/test/arch-coverage-report.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES, EXCLUSION_RULES, isExcluded, dirInsideSource, canonicalPath } from "../scripts/arch-coverage-report.ts";
import { mainCheckoutRoot } from "../scripts/repo-root.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "arch-coverage-report.ts");

/** `.archguard/` is a GENERATED, gitignored artifact: present in the main checkout, usually absent
 *  from a task worktree. Both the production run and AC3 are expressed in terms of the manifest that
 *  actually exists somewhere — never of "the manifest next to this worktree". */
const MAIN_ROOT = mainCheckoutRoot(REPO_ROOT) || REPO_ROOT;
const REAL_MANIFEST = path.join(MAIN_ROOT, ".archguard", "query", "manifest.json");

/** Is there a manifest to read AT ALL? `.archguard/` is generated and gitignored, so on a fresh
 *  clone / the CI runner (whose checkout IS the main checkout, and which has never run the analyzer)
 *  it is absent — structurally, not accidentally. The tests below assert the report's own
 *  NOT-EVALUATED state there instead of a reading the environment cannot produce (硬规则 3b: a
 *  "cannot judge" state must never be spelled like a "judged clean" one — which is precisely the
 *  property this file's ① block exists to pin, so asserting it is the same test, not a weaker one).
 *  Measured 2026-09-26 on a fresh clone: manifest absent ⇒ 3 of this file's assertions threw
 *  `no manifest at …`; the report itself returned `manifestFound:false, globalScopeResolved:false,
 *  globalScopeCoversTsFraction:null, scopes:[], uncoveredTsDirsEvaluated:false`. */
const HAS_REAL_MANIFEST = fs.existsSync(REAL_MANIFEST);

function run(args = []) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", SCRIPT, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function jsonRun(args) {
  const r = run([...args, "--json"]);
  assert.ok(r.stdout, `report must produce stdout (stderr=${r.stderr})`);
  return { parsed: JSON.parse(r.stdout), status: r.status, stderr: r.stderr };
}

const rowOf = (report, lang) => report.languages.find((l) => l.language === lang);

// ── ① the three states stay distinguishable ──────────────────────────────────────────────────────────

test("selftest — every injected case passes (the harness is the script's own, so this asserts it is wired)", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, `--selftest must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /SELFTEST: all fixture cases PASS/);
  // "逐行枚举 ≥6 个具名注入用例" — a summary-only run would not satisfy that; count the named lines.
  const named = r.stdout.split("\n").filter((l) => l.startsWith("SELFTEST PASS: "));
  assert.ok(named.length >= 6, `expected >=6 named fixture cases, got ${named.length}:\n${r.stdout}`);
  // The two AC-pinned reason codes must each be visible in a named case, not merely implied.
  assert.ok(named.some((l) => l.includes("manifest-missing")), "a case must name manifest-missing");
  assert.ok(named.some((l) => l.includes("not-evaluated-with-exit-2")), "a case must name the exit-2 path");
});

test("manifest missing ⇒ ts NOT-EVALUATED/manifest-missing, exit 0, and it is NOT the unreadable state", () => {
  // A worktree with no manifest at all: `--archguard-manifest` names a path that does not exist.
  const absent = path.join(REPO_ROOT, ".archguard", "query", "does-not-exist.json");
  const { parsed, status } = jsonRun([REPO_ROOT, "--archguard-manifest", absent]);
  const ts = rowOf(parsed, "ts");
  assert.equal(status, 0, "a missing manifest is a REPORTABLE FACT, not an unreadable input");
  assert.equal(parsed.evaluated, true);
  assert.equal(ts.status, "NOT-EVALUATED");
  assert.equal(ts.reason, "manifest-missing");
  assert.equal(ts.analyzedBy, null, "a missing manifest must never yield an analyzer attribution");
  assert.equal(parsed.archguard.manifestFound, false);
  assert.equal(parsed.archguard.globalScopeCoversTsFraction, null, "must be null, ⛔ never 0 — 0 would read as 'covers nothing'");
  assert.equal(parsed.uncoveredTsDirsEvaluated, false, "uncovered must be flagged not-evaluated, not read as 'nothing uncovered'");
  assert.deepEqual(parsed.uncoveredTsDirs, []);
});

test("manifest unreadable (bad JSON) ⇒ evaluated:false, exit 2 — distinct from missing AND from clean", () => {
  // Written OUTSIDE the repo tree so the test never leaves residue for the suite's dirty-tree assertion.
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "arch-coverage-badmanifest-"));
  const bad = path.join(tmp, "manifest.json");
  fs.writeFileSync(bad, "{ not json at all");
  try {
    const { parsed, status } = jsonRun([REPO_ROOT, "--archguard-manifest", bad]);
    assert.equal(status, 2, "unreadable input is exit 2 — ⛔ NOT 0 (which would read as a clean report)");
    assert.equal(parsed.evaluated, false);
    assert.equal(parsed.reason, "manifest-unreadable");
    assert.equal(parsed.archguard.manifestFound, true, "the file IS there — that is what makes it unreadable rather than missing");
    assert.equal(parsed.archguard.manifestParsed, false);
    const ts = rowOf(parsed, "ts");
    assert.equal(ts.status, "NOT-EVALUATED");
    assert.equal(ts.reason, "manifest-unreadable");
    // The three states must be three DIFFERENT reason strings, or the distinction is cosmetic.
    assert.notEqual(ts.reason, "manifest-missing");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("non-git directory ⇒ exit 2 and every row is null-counted, never zero-counted", () => {
  // `.quay/` is inside a git repo, so it cannot be the non-git fixture; use a bare temp dir.
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "arch-coverage-nongit-"));
  try {
    const { parsed, status } = jsonRun([tmp]);
    assert.equal(status, 2);
    assert.equal(parsed.evaluated, false);
    assert.equal(parsed.reason, "not-a-git-worktree");
    assert.equal(parsed.languages.length, LANGUAGES.length, "the language set is still reported");
    for (const l of parsed.languages) {
      assert.equal(l.trackedFiles, null, `${l.language}: an uncountable row must be null, ⛔ 0 reads as 'no files exist'`);
      assert.equal(l.status, "NOT-EVALUATED");
      assert.equal(l.reason, "git-unavailable");
    }
    assert.equal(parsed.totals.countedFiles, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ② the caliber is the AC's, and it is not the script's private opinion ────────────────────────────

function independentCount(glob) {
  // The AC's own caliber, expressed as the shell pipeline a skeptic would write. `git ls-files` only —
  // never `find` (a `find` once walked `.claude/worktrees/*` and inflated `.sh` to 5213).
  const git = spawnSync("git", ["-C", REPO_ROOT, "ls-files", glob], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(git.status, 0, `git ls-files ${glob} failed: ${git.stderr}`);
  return git.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .filter((f) => !isExcluded(f));
}

test("caliber — the .sh row equals an independent count taken with the same exclusion rules (AC2)", () => {
  const { parsed } = jsonRun([REPO_ROOT, "--archguard-manifest", REAL_MANIFEST]);
  const sh = rowOf(parsed, "sh");
  const independent = independentCount("*.sh");
  assert.equal(
    sh.trackedFiles,
    independent.length,
    `.sh row (${sh.trackedFiles}) must equal the independent count (${independent.length})`,
  );
  // And the AC2 command verbatim, as a second independent reading: this is the one that pins the
  // caliber (it RETAINS test/ dirs — see EXCLUSION_RULES.noteTestDirs).
  const raw = spawnSync(
    "bash",
    ["-c", "git ls-files '*.sh' | grep -v 'checker-mutation-cases/' | grep -v '^archive/' | wc -l"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  assert.equal(Number(raw.stdout.trim()), sh.trackedFiles, "the AC2 command's own output must agree");
});

test("caliber — the .ts row equals an independent count (AC4), and no .claude/worktrees file is counted", () => {
  const { parsed } = jsonRun([REPO_ROOT, "--archguard-manifest", REAL_MANIFEST]);
  const ts = rowOf(parsed, "ts");
  assert.equal(ts.trackedFiles, independentCount("*.ts").length, ".ts row must equal the independent count");
  const wt = spawnSync("bash", ["-c", "git ls-files | grep -c '^\\.claude/worktrees/' || true"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(Number(wt.stdout.trim()), 0, "the tree must not track .claude/worktrees files (AC4 premise)");
  assert.ok(ts.trackedFiles > 0, "the .ts row must be a real count");
});

test("caliber — segment-equality exclusion, not substring (sync-vendor.sh survives a `vendor` rule)", () => {
  assert.equal(isExcluded("plugin/scripts/sync-vendor.sh"), false, "a substring `vendor` rule wrongly drops this real script");
  assert.equal(isExcluded("plugin/scripts/checker-mutation-cases/x.sh"), true);
  assert.equal(isExcluded("packages/quay/src/a.test.ts"), true);
  assert.equal(isExcluded("archive/old/plugin/scripts/y.sh"), true);
  // `archive/` is root-anchored ONLY, mirroring the AC's `grep -v '^archive/'`.
  assert.equal(isExcluded("orchestration/archive/y.sh"), false);
  // `/test/` is deliberately RETAINED — the AC2 caliber keeps those files (declared, not accidental).
  assert.equal(isExcluded("plugin/test/delivery.sh"), false);
  assert.equal(isExcluded("test/e2e.sh"), false);
  assert.match(EXCLUSION_RULES.noteTestDirs, /not excluded/);
});

// ── ③ the real readings (AC2/AC3/AC6) ────────────────────────────────────────────────────────────────

test("real repo — the unevaluated set is NOT empty (an empty one is the checker-failure signature)", () => {
  const { parsed, status } = jsonRun([REPO_ROOT, "--archguard-manifest", REAL_MANIFEST]);
  assert.equal(status, 0);
  assert.equal(parsed.evaluated, true);
  for (const lang of ["sh", "mjs", "js", "py"]) {
    const row = rowOf(parsed, lang);
    assert.ok(row, `${lang} row must exist — a missing row and a zero row look the same to a counting reader`);
    assert.equal(row.status, "NOT-EVALUATED", `${lang} has no analyzer today`);
    assert.equal(row.reason, "no-analyzer");
    assert.equal(row.analyzedBy, null);
    assert.ok(row.trackedFiles > 0, `${lang} must be a NON-EMPTY unevaluated set — 0 here means the census broke`);
  }
});

test("real repo — the declared global scope is CLASSIFIED, never read as 'covers everything' (AC3)", () => {
  const { parsed } = jsonRun([REPO_ROOT, "--archguard-manifest", REAL_MANIFEST]);
  const a = parsed.archguard;
  if (!HAS_REAL_MANIFEST) {
    // The third state, asserted rather than skipped: an unresolved scope must read as UNRESOLVED —
    // never as "covers everything" (fraction 1) or "covers nothing" (fraction 0).
    assert.equal(a.manifestFound, false, `no manifest at ${REAL_MANIFEST} ⇒ manifestFound must be false`);
    assert.equal(a.manifestParsed, false);
    assert.equal(a.globalScopeResolved, false);
    assert.equal(a.globalScopeKind, "unresolved", "no manifest ⇒ its own state, ⛔ not silently 'narrow'/'whole-repo'");
    assert.equal(a.globalScopeCoversTsFraction, null, "a fraction over an unresolved scope must be null, ⛔ not 0/1");
    assert.equal(a.globalScopeNote, null, "there is nothing to note about a scope that was never read");
    assert.deepEqual(a.globalScopeSources, []);
    assert.deepEqual(a.scopes, []);
    return;
  }
  assert.equal(a.manifestFound, true, `no manifest at ${REAL_MANIFEST}`);
  assert.equal(a.manifestParsed, true);
  assert.equal(a.globalScopeResolved, true);
  // AC3's ORIGINAL expectation here was the frozen literal `["packages/quay/src"]` — i.e. that the
  // host's generated manifest names a NARROW project scope as global. That is a property of the
  // manifest, not of the report, and it is not stable: a single `archguard_analyze` with no `sources`
  // plans a project-root scope and takes `role:"primary"`, and a later sources-given analyze can NEVER
  // take it back (this task's AC2; measured 2026-09-30 on the main checkout AND on a worktree copy).
  // Freezing the literal made this test red on a manifest that is a perfectly ordinary product of the
  // instrument — it was asserting a machine-state spelling, not the report's contract.
  // The assertion is therefore the invariant that has to hold in BOTH real states, and that still goes
  // red if the report misrepresents which state it is in:
  //   • the declared global scope is CLASSIFIED, and a degenerate (root-anchored) one is reported
  //     LOUDLY — never silently presented as a healthy narrow global (硬规则 3b);
  //   • the COVERAGE reading (which never credits a whole-repo scope) is still partial.
  assert.ok(["narrow", "whole-repo"].includes(a.globalScopeKind), `unexpected globalScopeKind: ${a.globalScopeKind}`);
  if (a.globalScopeKind === "whole-repo") {
    // A root-anchored scope contains every tracked file by construction: that is exactly why it cannot
    // be the measurement AC3's finding is taken against, and why the report must say so in words.
    assert.deepEqual(a.globalScopeSources, [""], "a whole-repo scope relativizes to the repo root");
    assert.equal(a.globalScopeCoversTsFraction, 1, "…and therefore covers every .ts by construction");
    assert.ok(
      a.globalScopeNote !== null && /REPOSITORY ROOT/.test(a.globalScopeNote),
      `a whole-repo global scope must be reported LOUDLY; got note=${JSON.stringify(a.globalScopeNote)}`,
    );
  } else {
    assert.ok(
      a.globalScopeCoversTsFraction !== null && a.globalScopeCoversTsFraction > 0 && a.globalScopeCoversTsFraction < 1,
      `a narrow global scope must cover SOME but NOT ALL .ts; got ${a.globalScopeCoversTsFraction}`,
    );
    assert.equal(a.globalScopeNote, null, "a narrow global scope needs no degeneracy note");
  }
  // The COVERAGE reading, however the declared global scope happens to be spelled: it is taken from the
  // non-whole-repo scopes, so it must still be a real partial reading rather than a vacuous 1.
  const ts = rowOf(parsed, "ts");
  assert.ok(
    ts.coverageFraction !== null && ts.coverageFraction > 0 && ts.coverageFraction < 1,
    `the non-whole-repo coverage of .ts must be SOME but NOT ALL; got ${ts.coverageFraction}`,
  );
  // The scopes that DO exist are reported with their sources — that is what makes "not in the global
  // scope" resolvable to "…but covered by this other scope". A whole-repo scope is still LISTED.
  assert.ok(a.scopes.length >= 2, "the manifest must expose more than the global scope");
  for (const s of a.scopes) {
    assert.equal(typeof s.wholeRepo, "boolean", `scope ${s.key} must carry an explicit wholeRepo classification`);
    if (s.wholeRepo) assert.equal(s.tsFiles, 0, `${s.key} is a whole-repo scope: it must not be credited with coverage`);
  }
  const total = a.scopes.reduce((n, s) => n + s.tsFiles, 0);
  assert.ok(total > 0 && total <= ts.trackedFiles, `per-scope ts attribution out of range: ${total}`);
});

test("real repo — at least one tracked .ts directory is covered by NO scope (AC3's companion)", () => {
  const { parsed } = jsonRun([REPO_ROOT, "--archguard-manifest", REAL_MANIFEST]);
  if (!HAS_REAL_MANIFEST) {
    // ⛔ An EMPTY `uncoveredTsDirs` must not be read as "every directory is covered": without a
    // manifest nothing was evaluated, and that is its own value (`uncoveredTsDirsEvaluated:false`).
    assert.equal(parsed.uncoveredTsDirsEvaluated, false, "no manifest ⇒ the uncovered-dir question was NOT evaluated");
    assert.deepEqual(parsed.uncoveredTsDirs, [], "…and the list stays empty, carrying no verdict");
    return;
  }
  assert.equal(parsed.uncoveredTsDirsEvaluated, true);
  assert.ok(
    parsed.uncoveredTsDirs.length > 0,
    "the report exists because part of the tree is analyzed by nothing; an empty list here is a broken reading, not good news",
  );
  for (const d of parsed.uncoveredTsDirs) {
    assert.equal(d.startsWith("/"), false, `uncoveredTsDirs must be repo-relative: ${d}`);
    // Independently confirm the "uncovered" verdict: a tracked non-test .ts really does live there, and
    // it really is inside no scope source. A dir reported uncovered with no .ts in it would mean the
    // list is derived from something other than the ts census.
    const files = spawnSync("bash", ["-c", `git ls-files '${d}/*.ts'`], { cwd: REPO_ROOT, encoding: "utf8" });
    const here = files.stdout.split("\n").filter((f) => f !== "" && !isExcluded(f));
    assert.ok(here.length > 0, `reported uncovered dir ${d} has no tracked non-test .ts`);
    // ⛔ Whole-repo scopes are deliberately NOT credited (task gap-arch-coverage-primary-scope-usurped-
    // by-root-analyze): a scope rooted at the repo root contains every path by construction, so letting
    // it count would make this list structurally unable to be non-empty. The independent re-derivation
    // therefore excludes them too — otherwise the assertion would contradict the production rule it is
    // supposed to be checking.
    const insideSomeCreditedScope = parsed.archguard.scopes
      .filter((s) => !s.wholeRepo)
      .some((s) => s.sources.some((src) => dirInsideSource(d, src)));
    assert.equal(
      insideSomeCreditedScope,
      false,
      `${d} is reported uncovered but a CREDITED scope source does contain it (whole-repo scopes are not credited)`,
    );
  }
});

test("injected fixtures — a whole-repo global scope and a narrow one give two DISTINGUISHABLE readings (AC3 negative control)", () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "arch-coverage-global-"));
  try {
    // The injection seam the report itself exposes (`--archguard-manifest`): two manifests differing
    // ONLY in which scope `globalScopeKey` names. ⛔ These are FIXTURES — the live
    // `.archguard/query/manifest.json` is not edited or regenerated by this test (this task's AC4).
    const scope = (key, sources, entityCount) => ({ key, label: key, sources, entityCount });
    const wholeRepoPath = path.join(tmp, "manifest-whole-repo.json");
    fs.writeFileSync(
      wholeRepoPath,
      JSON.stringify({ version: "1.0", globalScopeKey: "ROOT", scopes: [scope("ROOT", [MAIN_ROOT], 9999)] }),
    );
    const narrowPath = path.join(tmp, "manifest-narrow.json");
    fs.writeFileSync(
      narrowPath,
      JSON.stringify({
        version: "1.0",
        globalScopeKey: "NARROW",
        scopes: [scope("NARROW", [path.join(MAIN_ROOT, "packages", "quay", "src")], 446)],
      }),
    );

    const whole = jsonRun([REPO_ROOT, "--archguard-manifest", wholeRepoPath]).parsed;
    const narrow = jsonRun([REPO_ROOT, "--archguard-manifest", narrowPath]).parsed;

    // ① The whole-repo state — the state a stray no-sources `archguard_analyze` produces, and the state
    //    this task was filed about. The root scope covers every tracked path BY CONSTRUCTION, so it is
    //    classified and noted LOUDLY, and — the load-bearing half — it is NOT credited. If the
    //    exclusion in `buildReport` is ever reverted, every assertion below goes red simultaneously
    //    (that is this control's purpose: it is a criterion that can still fail).
    assert.equal(whole.archguard.globalScopeKind, "whole-repo", "a root-anchored global scope is its own state");
    assert.deepEqual(whole.archguard.globalScopeSources, [""], "…which relativizes to the repo root");
    assert.equal(whole.archguard.globalScopeCoversTsFraction, 1, "…and covers every .ts by construction");
    assert.ok(whole.archguard.globalScopeNote !== null, "…and must SAY SO, ⛔ never silently");
    assert.equal(rowOf(whole, "ts").coverageFraction, 0, "a whole-repo scope must not be credited as coverage");
    assert.ok(
      whole.uncoveredTsDirs.length > 0,
      "…so directories stay uncovered instead of reading 'all covered' — an empty list here is the silent-clean this report exists to prevent",
    );

    // ② The narrow state — the ordinary, meaningful global scope (what the manifest named before the
    //    usurpation), read as a real partial-coverage measurement.
    assert.equal(narrow.archguard.globalScopeKind, "narrow");
    assert.equal(narrow.archguard.globalScopeNote, null, "a narrow global scope needs no degeneracy note");
    assert.deepEqual(narrow.archguard.globalScopeSources, ["packages/quay/src"]);
    assert.ok(
      narrow.archguard.globalScopeCoversTsFraction > 0 && narrow.archguard.globalScopeCoversTsFraction < 1,
      `a narrow global scope is a partial reading; got ${narrow.archguard.globalScopeCoversTsFraction}`,
    );

    // ③ …and the two states are DISTINGUISHABLE — which is the entire point of adding the classification
    //    rather than substituting one scope's numbers for the other's (硬规则 3b).
    assert.notEqual(whole.archguard.globalScopeKind, narrow.archguard.globalScopeKind);
    assert.notDeepEqual(whole.archguard.globalScopeSources, narrow.archguard.globalScopeSources);
    assert.notDeepEqual(whole.uncoveredTsDirs, narrow.uncoveredTsDirs);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("real repo — a scope source that is a foreign absolute path is relativized, not string-compared", () => {
  // The worktree case: the manifest lives at the MAIN checkout and its sources are absolute paths
  // under it. Without relativization every .ts would be reported uncovered purely because the
  // strings differ — the report would be confidently wrong.
  //
  // SYMLINK SPELLING (gap-suite-ambient-reds-block-all-code-landings, class 3): the SAME directory
  // is reachable as /data/home/yale/work/quay (realpath) and /home/yale/work/quay (a symlink created
  // 2026-09-19), and the generated manifest records whichever spelling the analyzer was invoked
  // through — on this host, the symlink one. `MAIN_ROOT` resolves to the realpath, so a bare
  // `path.relative(MAIN_ROOT, r)` re-derivation answers `../../../../../home/yale/...` and the
  // assertion fails while BOTH sides are in fact naming one directory. The re-derivation therefore
  // canonicalizes both sides exactly as the production `relativizeSource` now does: the assertion
  // keeps testing "does the report relativize by rule", which is its whole point, instead of
  // accidentally testing which spelling the host happened to use.
  const { parsed } = jsonRun([REPO_ROOT, "--archguard-manifest", REAL_MANIFEST]);
  for (const s of parsed.archguard.scopes) {
    for (const src of s.sources) {
      assert.equal(src.startsWith("/"), false, `scope ${s.key} source was not relativized: ${src}`);
    }
    assert.deepEqual(
      s.sources,
      s.rawSources.map((r) => path.relative(canonicalPath(MAIN_ROOT), canonicalPath(r)).split(path.sep).join("/")),
    );
  }
  assert.equal(dirInsideSource("packages/quay/src/cli", "packages/quay/src"), true);
  assert.equal(dirInsideSource("packages/quay/srcfoo", "packages/quay/src"), false, "prefix match must be segment-aware");
});

// ── the report is a report: exit 0 even when large parts are unevaluated ─────────────────────────────

test("report-only — exit 0 with unevaluated languages is the DESIGN, not a failure", () => {
  const { parsed, status } = jsonRun([REPO_ROOT, "--archguard-manifest", REAL_MANIFEST]);
  const notEvaluated = parsed.languages.filter((l) => l.status === "NOT-EVALUATED");
  assert.ok(notEvaluated.length > 0, "this test is vacuous unless something is unevaluated");
  assert.equal(status, 0, "exit 0 means 'a report was produced' — ⛔ NOT 'everything is evaluated'");
  assert.equal(parsed.totals.analyzedFiles + parsed.totals.notEvaluatedFiles, parsed.totals.countedFiles);
  assert.ok(parsed.totals.notEvaluatedFiles > 0, "the unevaluated side must be non-empty on the real repo");
  // The analyzed side is non-empty only where an analyzer manifest exists; without one every counted
  // file is legitimately NOT-EVALUATED and `analyzedFiles === 0` is the honest reading, not a defect.
  if (HAS_REAL_MANIFEST) assert.ok(parsed.totals.analyzedFiles > 0, "with a manifest, the analyzed side must be non-empty too");
});

test("--help exits 0 and prints usage before doing any work", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /usage: arch-coverage-report\.ts/);
});
