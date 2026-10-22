// @test-group engine
// arch-cycle-reading.test.mjs — gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts.
//
// The standing `arch-cycle-report` routine had TWO independent defects, and this file pins both:
//
//   A. THE AGGREGATE WAS ALL-OR-NOTHING. Six scopes, and two of them
//      (`packages/quay-github/src`, `packages/quay-backlog/src`) never produced an archguard module
//      graph — which says "no package-level diagram was requested", NOT "no cycles". Because the
//      record-level `totalCycleCount` was null unless EVERY scope evaluated, those two permanently
//      voided the other four: 25/25 rounds read `evaluated:false`.
//      ⇒ AC1 (partial aggregate keeps the readable scopes) and AC2 (a scope whose tracked non-test
//        .ts files all live in ONE directory is structurally cycle-free — derived from the FILE LIST,
//        never from the absence of a graph; a multi-directory scope without a graph stays unevaluated).
//
//   B. NOTHING EVER REFRESHED THE ARTIFACTS. The routine reads what the last `analyze` persisted; a
//      cycle introduced 9 minutes after that artifact stayed invisible for ~7 hours.
//      ⇒ AC3-ish (`commitsSinceArtifact`/`behindSources` makes "the tree moved past this artifact"
//        visible, three-valued) and the refresh arm (at most ONE analyze per scheduling interval, the
//        package-level diagram requested so a module graph is actually produced, `instrument-absent`
//        spelling out every probed location).
//
// Run:
//   scripts/test.sh plugin/test/arch-cycle-reading.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  readDirectoryCycleReading,
  singleDirectoryBasis,
  commitsSince,
  resolveArchguardCliWithSource,
  scopeNeedsRefresh,
  selectRefreshTargets,
  refreshBehindScopes,
  downgradeStaleScopes,
} from "../scripts/archguard-runner.ts";
import { runArchCycleRound, readLastRefreshAt, readLastRefreshAtByScope } from "../scripts/quality-gate-driver.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The six sources the routine analyzes (kept in sync by MEANING: a missing scope is REPORTED, so
 *  the fixture has to know the same set the production reader walks). */
const SOURCES = [
  "packages/quay/src",
  "plugin/scripts",
  "packages/quay-native/src",
  "packages/quay-github/src",
  "packages/quay-backlog/src",
  "experiments/quay-perpetual-stream/scripts",
];

const LABELS = ["src", "scripts", "quay-native-src", "quay-github-src", "quay-backlog-src", "experiments-scripts"];

/** A real git repo (the single-directory judgment and the commit count both read `git`, so a fake
 *  directory tree would only prove the fixture to itself).
 *  `date` pins the initial commit's committer date — `commitsSince` runs `git rev-list --since`, which
 *  reads the COMMITTER date, so a fixture that needs commits BEFORE and AFTER an artifact timestamp
 *  must control it explicitly. */
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

function gitInit(dir, files, date) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf8");
  }
  const env = { ...process.env, ...GIT_IDENTITY, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) };
  const run = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  };
  run(["init", "-q"]);
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "fixture"]);
  return { run, env };
}

/** Add a commit dated `date` (committer date), touching `files`. Used to place a commit AFTER an
 *  artifact timestamp — the only way `commitsSince` can report "the tree moved past the artifact". */
function commitAt(dir, date, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf8");
  }
  const env = { ...process.env, ...GIT_IDENTITY, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  for (const args of [["add", "-A"], ["commit", "-q", "--allow-empty", "-m", `fixture ${date}`]]) {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  }
}

/** The query-artifact layout `archguard analyze` persists: `<workDir>/query/manifest.json` plus one
 *  `arch.json` per scope. `moduleGraphBySource` entries of `undefined` mean "this artifact carries NO
 *  extensions.tsAnalysis.moduleGraph" — the exact shape that voided production. */
function writeQueryFixture(workDir, root, { timestampBySource = {}, moduleGraphBySource = {} } = {}) {
  const queryDir = path.join(workDir, "query");
  fs.mkdirSync(queryDir, { recursive: true });
  const scopes = SOURCES.map((source, i) => {
    const key = `scope-${i}`;
    return { key, label: LABELS[i], sources: [path.resolve(root, source)], generatedAt: timestampBySource[source] ?? "2026-10-18T00:00:00Z" };
  });
  scopes.push({ key: "global-scope", label: "quay (typescript)", sources: [path.resolve(root)], generatedAt: "2026-10-18T00:00:00Z" });
  fs.writeFileSync(path.join(queryDir, "manifest.json"), JSON.stringify({ scopes, globalScopeKey: "global-scope" }), "utf8");
  SOURCES.forEach((source, i) => {
    const dir = path.join(queryDir, scopes[i].key);
    fs.mkdirSync(dir, { recursive: true });
    const graph = moduleGraphBySource[source];
    const artifact = { language: "typescript", timestamp: timestampBySource[source] ?? "2026-10-18T00:00:00Z" };
    if (graph !== undefined) artifact.extensions = { tsAnalysis: { moduleGraph: { cycles: graph.map((modules) => ({ modules })) } } };
    fs.writeFileSync(path.join(dir, "arch.json"), JSON.stringify(artifact), "utf8");
  });
  const globalDir = path.join(queryDir, "global-scope");
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(
    path.join(globalDir, "arch.json"),
    JSON.stringify({ language: "typescript", timestamp: "2026-10-18T00:00:00Z", entities: [], relations: [] }),
    "utf8",
  );
}

/** A scope tree where every source dir exists; `multiDir` lists the sources that get a second
 *  directory (so their single-directory judgment is FALSE — the negative control). `date` pins the
 *  fixture commit's committer date (see `gitInit`). */
function makeRepoFixture(root, { multiDir = [], testsInSubdir = false, date } = {}) {
  const files = {};
  SOURCES.forEach((source, i) => {
    files[`${source}/mod-${i}.ts`] = `export const v${i} = ${i};\n`;
    files[`${source}/other-${i}.ts`] = `export const w${i} = ${i};\n`;
    if (multiDir.includes(source)) files[`${source}/nested/deep-${i}.ts`] = `export const d${i} = ${i};\n`;
    if (testsInSubdir) files[`${source}/__tests__/x-${i}.test.ts`] = `export const t${i} = ${i};\n`;
    files[`${source}/y-${i}.test.ts`] = `export const u${i} = ${i};\n`;
  });
  return gitInit(root, files, date);
}

// ── AC2 (unit): the single-directory judgment comes from the FILE LIST ───────────────────────────

test("singleDirectoryBasis — files in ONE directory ⇒ single; a nested file ⇒ not; test files do not count (AC2)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-singledir-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeRepoFixture(tmp, { multiDir: ["packages/quay-github/src"], testsInSubdir: true });

  const flat = singleDirectoryBasis(tmp, "packages/quay-backlog/src");
  assert.equal(flat.single, true, flat.reason ?? "");
  assert.equal(flat.files, 2, "two tracked non-test .ts, both directly in the scope directory");
  assert.deepEqual(flat.dirs, ["packages/quay-backlog/src"]);

  const nested = singleDirectoryBasis(tmp, "packages/quay-github/src");
  assert.equal(nested.single, false, "a file in a subdirectory makes the scope multi-directory");
  assert.equal(nested.dirs.length, 2);
  assert.equal(nested.reason, null);

  // ⛔ the negative-control direction that matters: a NON-git directory cannot answer at all. "Could
  // not read the file list" must not be reported as "single-directory" (硬规则 3b).
  const noGit = fs.mkdtempSync(path.join(os.tmpdir(), "acr-nogit-"));
  t.after(() => fs.rmSync(noGit, { recursive: true, force: true }));
  fs.mkdirSync(path.join(noGit, "packages/quay-backlog/src"), { recursive: true });
  fs.writeFileSync(path.join(noGit, "packages/quay-backlog/src/a.ts"), "export const a = 1;\n");
  const unknown = singleDirectoryBasis(noGit, "packages/quay-backlog/src");
  assert.equal(unknown.single, false);
  assert.match(unknown.reason, /git ls-files .* failed/);
});

test("readDirectoryCycleReading — a graph-less SINGLE-DIRECTORY scope is evaluated (basis single-directory); a graph-less MULTI-DIRECTORY scope stays unevaluated (AC2)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-basis-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeRepoFixture(tmp, { multiDir: ["packages/quay-github/src"] });
  const workDir = path.join(tmp, ".archguard");
  writeQueryFixture(workDir, tmp, {
    moduleGraphBySource: {
      "packages/quay/src": [["src/a", "src/b"]],
      "plugin/scripts": [],
      "packages/quay-native/src": [],
      "packages/quay-github/src": undefined, // ← no moduleGraph, MULTI-directory
      "packages/quay-backlog/src": undefined, // ← no moduleGraph, SINGLE-directory
      "experiments/quay-perpetual-stream/scripts": [],
    },
  });

  const reading = readDirectoryCycleReading(tmp, workDir);
  const github = reading.scopes.find((s) => s.scope === "quay-github-src");
  const backlog = reading.scopes.find((s) => s.scope === "quay-backlog-src");

  assert.equal(backlog.evaluated, true);
  assert.equal(backlog.basis, "single-directory");
  assert.equal(backlog.cycleCount, 0, "a single-directory scope cannot have a directory cycle");
  assert.deepEqual(backlog.cycles, []);

  assert.equal(github.evaluated, false, "multi-directory + no moduleGraph ⇒ NOT evaluated (⛔ never '0 cycles')");
  assert.equal(github.basis, null);
  assert.equal(github.cycleCount, null);
  assert.match(github.reason, /moduleGraph not produced \(package-level diagram not requested\)/);
  assert.match(github.reason, /NOT single-directory/);

  // The two values must never collapse into each other (硬规则 3b).
  assert.notEqual(github.evaluated, backlog.evaluated);
  assert.notEqual(github.cycleCount, backlog.cycleCount);
});

// ── AC1: the aggregate is PARTIAL, not void ────────────────────────────────────────────────────────

test("readDirectoryCycleReading — one graph-less scope does NOT void the others: status partial, total counts the readable cycle (AC1)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-partial-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeRepoFixture(tmp, { multiDir: ["packages/quay-github/src"] });
  const workDir = path.join(tmp, ".archguard");
  writeQueryFixture(workDir, tmp, {
    moduleGraphBySource: {
      "packages/quay/src": [["src/a", "src/b"]], // ← the one real cycle
      "plugin/scripts": [],
      "packages/quay-native/src": [],
      "packages/quay-github/src": undefined, // ← the unreadable one
      "packages/quay-backlog/src": [],
      "experiments/quay-perpetual-stream/scripts": [],
    },
  });

  const reading = readDirectoryCycleReading(tmp, workDir);
  assert.equal(reading.status, "partial");
  assert.equal(reading.evaluated, true, "a reading WAS produced (partial is not 'none')");
  assert.equal(reading.totalCycleCount, 1, "the readable scope's cycle is counted, not discarded");
  assert.deepEqual(reading.notEvaluatedScopes, ["quay-github-src"]);
  assert.match(reading.reason, /^partial \(1 of 6 scopes not evaluated\)/);
  assert.match(reading.reason, /quay-github-src: .*moduleGraph not produced/);

  // The negative control for the OLD all-or-nothing behaviour: if `totalCycleCount` were still null
  // here, the two permanently graph-less production scopes would void the reading as they did for
  // 25/25 rounds. Nothing readable at all is the OTHER state (null), and the two must differ.
  const empty = path.join(tmp, "empty-work-dir");
  const none = readDirectoryCycleReading(tmp, empty);
  assert.equal(none.status, "none");
  assert.equal(none.evaluated, false);
  assert.equal(none.totalCycleCount, null);
  assert.notEqual(reading.totalCycleCount, none.totalCycleCount);
});

test("runArchCycleRound — a partial reading is VERIFIED and its reason NAMES the unread scope (AC1)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-partial-round-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeRepoFixture(tmp, { multiDir: ["packages/quay-github/src"] });
  writeQueryFixture(path.join(tmp, ".archguard"), tmp, {
    moduleGraphBySource: {
      "packages/quay/src": [["src/a", "src/b"]],
      "plugin/scripts": [],
      "packages/quay-native/src": [],
      "packages/quay-github/src": undefined,
      "packages/quay-backlog/src": [],
      "experiments/quay-perpetual-stream/scripts": [],
    },
  });
  const history = path.join(tmp, "history.jsonl");
  const fact = runArchCycleRound(tmp, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: history, now: "2026-10-20T00:00:00Z", refresh: false,
  });
  assert.equal(fact.state, "verified", `a partial report is still a report; got ${fact.state}: ${fact.reason}`);
  assert.equal(fact.value.status, "partial");
  assert.equal(fact.value.totalCycleCount, 1);
  assert.deepEqual(fact.value.notEvaluatedScopes, ["quay-github-src"]);
  assert.match(fact.reason ?? "", /partial — .*quay-github-src/);

  const rec = JSON.parse(fs.readFileSync(history, "utf8").trim());
  assert.equal(rec.status, "partial", "the carrier line carries the record-level status");
  assert.equal(rec.totalCycleCount, 1);
  assert.deepEqual(rec.notEvaluatedScopes, ["quay-github-src"]);
  assert.equal(rec.refresh.skipped, "disabled", "a read-only round says so instead of staying silent");
});

// ── behindSources: the artifact no longer covers the sources ──────────────────────────────────────

test("readDirectoryCycleReading — behindSources is TRUE when the source moved after the artifact, FALSE when it did not, NULL when uncomputable (AC3)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-behind-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repo = makeRepoFixture(tmp);

  // An artifact produced BEFORE the fixture commit ⇒ every scope is behind it.
  const oldTs = "2020-01-01T00:00:00Z";
  const workDir = path.join(tmp, ".archguard");
  writeQueryFixture(workDir, tmp, {
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, oldTs])),
    moduleGraphBySource: Object.fromEntries(SOURCES.map((s) => [s, []])),
  });
  const behind = readDirectoryCycleReading(tmp, workDir).scopes.find((s) => s.scope === "src");
  assert.ok(behind.commitsSinceArtifact > 0, `expected commits since ${oldTs}, got ${behind.commitsSinceArtifact}`);
  assert.equal(behind.behindSources, true);
  assert.notEqual(Date.parse(readDirectoryCycleReading(tmp, workDir).artifactTimestamp), NaN);

  // An artifact produced in the FUTURE of every commit ⇒ nothing is behind it. Without this arm,
  // `behindSources:true` above could be a constant.
  const futureTs = "2999-01-01T00:00:00Z";
  const futureDir = path.join(tmp, ".archguard-future");
  writeQueryFixture(futureDir, tmp, {
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, futureTs])),
    moduleGraphBySource: Object.fromEntries(SOURCES.map((s) => [s, []])),
  });
  const fresh = readDirectoryCycleReading(tmp, futureDir).scopes.find((s) => s.scope === "src");
  assert.equal(fresh.commitsSinceArtifact, 0);
  assert.equal(fresh.behindSources, false);

  // Not computable (no parseable timestamp / not a git repo) ⇒ null, ⛔ never false.
  assert.equal(commitsSince(tmp, "packages/quay/src", null), null);
  assert.equal(commitsSince(tmp, "packages/quay/src", "not-a-date"), null);
  const noGit = fs.mkdtempSync(path.join(os.tmpdir(), "acr-behind-nogit-"));
  t.after(() => fs.rmSync(noGit, { recursive: true, force: true }));
  assert.equal(commitsSince(noGit, "packages/quay/src", oldTs), null);
  assert.equal(repo.run(["rev-parse", "HEAD"]).trim().length, 40);

  // A SINGLE-DIRECTORY reading is taken from the live file list, so it is never behind its sources —
  // even with a decade-old artifact. (Otherwise those scopes would be re-analyzed every interval for
  // no possible gain.)
  const single = readDirectoryCycleReading(tmp, workDir).scopes.find((s) => s.scope === "quay-github-src");
  assert.equal(single.basis, "module-graph", "this fixture gave it a graph; the single-directory arm is below");
  const noGraphDir = path.join(tmp, ".archguard-nograph");
  writeQueryFixture(noGraphDir, tmp, {
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, oldTs])),
    moduleGraphBySource: {
      ...Object.fromEntries(SOURCES.map((s) => [s, []])),
      "packages/quay-github/src": undefined,
      "packages/quay-backlog/src": undefined,
    },
  });
  const backlog = readDirectoryCycleReading(tmp, noGraphDir).scopes.find((s) => s.scope === "quay-backlog-src");
  assert.equal(backlog.basis, "single-directory");
  assert.equal(backlog.commitsSinceArtifact, 0);
  assert.equal(backlog.behindSources, false);
});

// ── refresh: EVERY due scope per round (per-scope budget), stalest first, honest skips ────────────
// ⛔ THE OLD RULE THIS SECTION USED TO PIN — "at most ONE scope per call", "exactly one analyze per
// refresh", "the other scopes were NOT swept" — is the starvation mechanism
// gap-arch-cycle-refresh-first-stale-wins-starves-later-scopes removes: `plugin/scripts` is touched by
// nearly every merge, so with a global single-analyze budget + declaration-order selection it was the
// first stale scope at every interval and the tail scopes were never refreshed at all (measured
// 2026-10-22: the experiments-scripts artifact was 18 days older than its newest source commit).
// The assertions below are the INVERSE on purpose (AC5: a rule reversal must be written, not bypassed).

/** A fake archguard CLI: records its argv, then rewrites the target scope's artifact WITH a module
 *  graph and a NOW timestamp — i.e. exactly what `analyze --diagrams package` would persist.
 *  `failFor` lists sources for which the run exits 3 WITHOUT touching the artifact — the AC3
 *  negative control ("the analyze failed, so the artifact is still behind the tree"). */
function fakeArchguard(tmp, { failFor = [] } = {}) {
  const record = path.join(tmp, "argv.log");
  const script = path.join(tmp, "fake-archguard.mjs");
  fs.writeFileSync(
    script,
    `import fs from "node:fs";\n` +
      `import path from "node:path";\n` +
      `const argv = process.argv.slice(2);\n` +
      `fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(argv) + "\\n");\n` +
      `const s = argv[argv.indexOf("-s") + 1];\n` +
      `if (${JSON.stringify(failFor)}.includes(s)) { process.stderr.write("fixture: forced failure for " + s + "\\n"); process.exit(3); }\n` +
      `const i = argv.indexOf("--work-dir");\n` +
      `const wd = argv[i + 1];\n` +
      `const manifestFile = path.join(wd, "query", "manifest.json");\n` +
      `const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));\n` +
      `const wanted = fs.realpathSync(path.resolve(process.cwd(), s));\n` +
      `for (const scope of manifest.scopes) {\n` +
      `  if (!Array.isArray(scope.sources) || !scope.sources.some((x) => { try { return fs.realpathSync(x) === wanted; } catch { return false; } })) continue;\n` +
      `  const file = path.join(wd, "query", scope.key, "arch.json");\n` +
      `  const arch = JSON.parse(fs.readFileSync(file, "utf8"));\n` +
      `  arch.timestamp = new Date().toISOString();\n` +
      `  arch.extensions = { tsAnalysis: { moduleGraph: { cycles: [] } } };\n` +
      `  fs.writeFileSync(file, JSON.stringify(arch));\n` +
      `}\n`,
    "utf8",
  );
  const wrapper = path.join(tmp, "fake-archguard");
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec node ${JSON.stringify(script)} "$@"\n`, { mode: 0o755 });
  return { wrapper, record, script };
}

/** Every `-s <source>` the fake CLI was invoked with, in order (⛔ a proxy the test can COUNT — the
 *  budget ACs are about how many analyzes each scope costs, not about the code path that chose it). */
function analyzedSources(record) {
  if (!fs.existsSync(record)) return [];
  return fs
    .readFileSync(record, "utf8")
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .map((argv) => argv[argv.indexOf("-s") + 1]);
}

function withEnv(t, patch) {
  const prev = {};
  for (const [k, v] of Object.entries(patch)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

// ── AC1/Plan 1-2: stalest-first selection + EVERY due scope refreshed in one round ───────────────

test("selectRefreshTargets — STALEST FIRST (commits desc, then oldest artifact), NOT declaration order (Plan 1-2 / AC1)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-order-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // Base commit EARLY, artifact AFTER it, then commits dated after the artifact — so `commitsSince`
  // (which reads committer dates via `git rev-list --since`) can differentiate the scopes.
  makeRepoFixture(tmp, { date: "2025-12-01T00:00:00Z" });
  const workDir = path.join(tmp, ".archguard");
  writeQueryFixture(workDir, tmp, {
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, "2026-01-01T00:00:00Z"])),
    moduleGraphBySource: Object.fromEntries(SOURCES.map((s) => [s, []])),
  });
  const scripts = "plugin/scripts";
  const native = "packages/quay-native/src";
  const experiments = "experiments/quay-perpetual-stream/scripts";
  commitAt(tmp, "2026-01-02T00:00:00Z", { [`${scripts}/a.ts`]: "export const a = 1;\n" });
  commitAt(tmp, "2026-01-03T00:00:00Z", { [`${native}/a.ts`]: "export const a = 1;\n" });
  commitAt(tmp, "2026-01-04T00:00:00Z", { [`${native}/b.ts`]: "export const b = 1;\n" });
  commitAt(tmp, "2026-01-05T00:00:00Z", { [`${experiments}/a.ts`]: "export const a = 1;\n" });
  commitAt(tmp, "2026-01-06T00:00:00Z", { [`${experiments}/b.ts`]: "export const b = 1;\n" });
  commitAt(tmp, "2026-01-07T00:00:00Z", { [`${experiments}/c.ts`]: "export const c = 1;\n" });

  const reading = readDirectoryCycleReading(tmp, workDir);
  const byScope = Object.fromEntries(reading.scopes.map((s) => [s.scope, s]));
  assert.equal(byScope["experiments-scripts"].commitsSinceArtifact, 3);
  assert.equal(byScope["quay-native-src"].commitsSinceArtifact, 2);
  assert.equal(byScope.scripts.commitsSinceArtifact, 1);
  assert.equal(byScope.src.commitsSinceArtifact, 0, "untouched since the artifact ⇒ not due");

  const order = selectRefreshTargets(reading).map((s) => s.scope);
  assert.deepEqual(order, ["experiments-scripts", "quay-native-src", "scripts"], "stalest first");
  // ⛔ THE NEGATIVE CONTROL (AC5 — same assertion, old implementation would be red): the previous
  // selection was `reading.scopes.find(scopeNeedsRefresh)`, i.e. SCOPES declaration order:
  assert.notDeepEqual(order, ["scripts", "quay-native-src", "experiments-scripts"], "declaration order is what starved the tail");
  assert.equal(selectRefreshTargets(reading)[0].scope, "experiments-scripts", "the scope starved for 18 days must go first");
});

test("refreshBehindScopes — refreshes EVERY due scope once (package-level diagram, --no-cache), then reports nothing-to-do (AC1/AC2)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-refresh-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeRepoFixture(tmp);
  const { wrapper, record } = fakeArchguard(tmp);
  withEnv(t, { ARCHGUARD_RUNNER_CLI: wrapper });

  const workDir = path.join(tmp, ".archguard");
  const oldTs = "2020-01-01T00:00:00Z";
  writeQueryFixture(workDir, tmp, {
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, oldTs])),
    moduleGraphBySource: Object.fromEntries(SOURCES.map((s) => [s, []])),
  });

  const before = readDirectoryCycleReading(tmp, workDir);
  assert.equal(before.scopes.every((s) => s.behindSources === true), true);
  assert.equal(before.scopes.every((s) => scopeNeedsRefresh(s)), true);

  const res = refreshBehindScopes(tmp, workDir, before, { now: "2026-10-22T00:00:00Z" });
  assert.equal(res.attempted, true);
  assert.equal(res.skipped, null, "every attempt succeeded ⇒ no skip value (⛔ not \"partial\")");
  assert.equal(res.exitCode, 0);
  assert.deepEqual(res.refreshedScopes.map((s) => s.scope).sort(), [...LABELS].sort(), "⛔ ALL due scopes, not just the first");
  assert.equal(res.refreshedScopes.every((s) => s.ok === true), true);
  assert.deepEqual(res.deferredScopes, []);
  assert.equal(res.instrumentSource, "env");
  assert.match(res.instrument, /fake-archguard$/);

  // AC2 BUDGET, measured on the spawns themselves: each due scope exactly ONCE.
  const sources = analyzedSources(record);
  assert.equal(sources.length, SOURCES.length, "six due scopes ⇒ six analyzes (one each), never a re-run of one");
  assert.deepEqual([...sources].sort(), [...SOURCES].sort());
  for (const source of SOURCES) {
    assert.equal(sources.filter((s) => s === source).length, 1, `${source} analyzed exactly once`);
  }
  const calls = fs.readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const argv of calls) {
    assert.equal(argv[0], "analyze");
    const dIdx = argv.indexOf("--diagrams");
    assert.ok(dIdx >= 0, "the request must ask for a package-level diagram");
    assert.equal(argv[dIdx + 1], "package", "`--diagrams package` is what makes archguard emit moduleGraph");
    // ⛔ BYPASS the cache: a cache hit rewrites the query artifact with the PREVIOUS run's timestamp
    // (measured: 2.1s, `arch.json` restored verbatim), leaving the scope exactly as behind as it was.
    assert.ok(argv.includes("--no-cache"), "the refresh must force a real re-analysis");
  }

  const after = readDirectoryCycleReading(tmp, workDir);
  assert.equal(after.scopes.every((s) => s.behindSources === false), true, "every refreshed artifact now covers its tree");
  assert.deepEqual(selectRefreshTargets(after), [], "nothing is due after the sweep");

  const again = refreshBehindScopes(tmp, workDir, after);
  assert.equal(again.attempted, false);
  assert.equal(again.skipped, "no-scope-needs-refresh");
  assert.deepEqual(again.refreshedScopes, []);
  assert.equal(analyzedSources(record).length, SOURCES.length, "no new analyze once everything is current");
});

test("runArchCycleRound — scripts / quay-native-src / experiments-scripts ALL refreshed in ONE round, record.behindScopes empty (AC1)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-ac1-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeRepoFixture(tmp);
  const { wrapper, record } = fakeArchguard(tmp);
  withEnv(t, { ARCHGUARD_RUNNER_CLI: wrapper });

  const stale = ["plugin/scripts", "packages/quay-native/src", "experiments/quay-perpetual-stream/scripts"];
  const freshTs = "2999-01-01T00:00:00Z"; // future ⇒ commitsSince() is 0 by construction
  const workDir = path.join(tmp, ".archguard");
  writeQueryFixture(workDir, tmp, {
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, stale.includes(s) ? "2020-01-01T00:00:00Z" : freshTs])),
    moduleGraphBySource: Object.fromEntries(SOURCES.map((s) => [s, []])),
  });
  const history = path.join(tmp, "history.jsonl");
  const fact = runArchCycleRound(tmp, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: history, workDir, now: new Date().toISOString(),
  });
  assert.equal(fact.state, "verified", fact.reason ?? "");

  const refreshed = fact.value.refresh.refreshedScopes.map((s) => s.scope).sort();
  assert.deepEqual(refreshed, ["experiments-scripts", "quay-native-src", "scripts"], "all three stale scopes in one round");
  assert.deepEqual(fact.value.behindScopes, [], "⛔ the old reading would still list the two starved scopes here");
  assert.equal(fact.value.scopes.every((s) => s.evaluated === true), true);
  assert.equal(fact.value.status, "complete");

  // AC2: the already-fresh scopes cost ZERO analyzes.
  const sources = analyzedSources(record);
  for (const source of ["packages/quay/src", "packages/quay-github/src", "packages/quay-backlog/src"]) {
    assert.equal(sources.filter((s) => s === source).length, 0, `${source} was fresh ⇒ not analyzed`);
  }
  for (const source of stale) assert.equal(sources.filter((s) => s === source).length, 1, `${source} analyzed once`);

  const rec = JSON.parse(fs.readFileSync(history, "utf8").trim());
  assert.deepEqual(rec.behindScopes, []);
  assert.equal(rec.scopes.every((s) => s.evaluated && s.behindSources === false), true);
});

test("runArchCycleRound — PER-SCOPE interval budget: a refreshed scope is not re-run, another stale scope still refreshes (AC2/DoD)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-interval-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeRepoFixture(tmp, { date: "2025-12-01T00:00:00Z" });
  const { wrapper, record } = fakeArchguard(tmp);
  withEnv(t, { ARCHGUARD_RUNNER_CLI: wrapper });

  const src = "packages/quay/src";
  const scripts = "plugin/scripts";
  const workDir = path.join(tmp, ".archguard");
  writeQueryFixture(workDir, tmp, {
    // ONLY src is behind at round 1 (its artifact predates the base commit); everything else is fresh.
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, s === src ? "2025-06-01T00:00:00Z" : "2026-01-01T00:00:00Z"])),
    moduleGraphBySource: Object.fromEntries(SOURCES.map((s) => [s, []])),
  });
  const history = path.join(tmp, "history.jsonl");
  const t0 = Date.now();
  const base = {
    config: { enabled: true, intervalMinutes: 60 }, configPresent: true, configError: null,
    historyPath: history, workDir,
  };

  const first = runArchCycleRound(tmp, { ...base, now: new Date(t0).toISOString() });
  assert.equal(first.state, "verified", first.reason ?? "");
  assert.deepEqual(first.value.refresh.refreshedScopes.map((s) => s.scope), ["src"]);
  assert.equal(first.value.refresh.appliedBeforeReading, true);
  assert.deepEqual(analyzedSources(record), [src]);
  assert.equal(readLastRefreshAtByScope(history).src, new Date(t0).toISOString());

  // A NEW commit makes `plugin/scripts` stale AFTER src's refresh. 60s later is INSIDE the 60m
  // interval — the OLD global clock answered `within-interval` here and starved scripts for a whole
  // interval (the defect). The per-scope clock has no entry for scripts, so it MUST refresh.
  commitAt(tmp, "2026-02-01T00:00:00Z", { [`${scripts}/new-after-refresh.ts`]: "export const n = 1;\n" });
  const second = runArchCycleRound(tmp, { ...base, now: new Date(t0 + 60_000).toISOString() });
  assert.notEqual(second.value.refresh.skipped, "within-interval", "one scope's refresh must not block another scope");
  assert.deepEqual(second.value.refresh.refreshedScopes.map((s) => s.scope), ["scripts"]);
  assert.equal(second.value.refresh.attempted, true);
  // ⛔ src was NOT re-analyzed: its own budget is spent for this interval.
  assert.deepEqual(analyzedSources(record), [src, scripts], "same scope ≤1 analyze per interval; other scopes still refresh");

  // Round 3, still inside the interval, nothing due ⇒ explicit no-op (and still zero spawns).
  const third = runArchCycleRound(tmp, { ...base, now: new Date(t0 + 120_000).toISOString() });
  assert.equal(third.value.refresh.attempted, false);
  assert.equal(third.value.refresh.skipped, "no-scope-needs-refresh");
  assert.equal(analyzedSources(record).length, 2);

  // `readLastRefreshAt` (round-level) and `readLastRefreshAtByScope` (the budget clock) agree on
  // rounds that ran, and a reporting-only round resets neither.
  assert.equal(readLastRefreshAt(history) !== null, true);
  const byScope = readLastRefreshAtByScope(history);
  assert.deepEqual(Object.keys(byScope).sort(), ["scripts", "src"]);
});

// ── DUE-BUT-DEFERRED === NOT CURRENT (gap-arch-cycle-within-interval-branch-skips-downgrade) ──────
// The `pending.length === 0` path — EVERY due scope deferred by the per-scope interval budget and
// therefore NO analyze run — used to return WITHOUT filling `downgradeCauses`, so
// `downgradeStaleScopes` was a no-op on exactly the rounds that carry a stale reading. Measured in
// production 2026-10-22: `plugin/scripts` 19 commits behind was reported as `evaluated:true`,
// `cycleCount:0`, record `status:"complete"` — byte-identical to a healthy reading (硬规则 3b).
// The regression below is the same fixture that produced that shape; on the pre-fix implementation
// (`git show develop:plugin/scripts/quality-gate-driver.ts` at 6a4ffe950) it reports
// `evaluated:true` + `cycleCount:0` + `status:"complete"` (AC1 "判据能取假").
test("runArchCycleRound — a DUE scope deferred by the interval budget is DOWNGRADED, not reported as a current reading (AC1/AC3)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-within-interval-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // Base commit BEFORE the artifact timestamps ⇒ only the explicit commit below can make a scope owed.
  makeRepoFixture(tmp, { date: "2025-12-01T00:00:00Z" });
  const { wrapper, record } = fakeArchguard(tmp);
  withEnv(t, { ARCHGUARD_RUNNER_CLI: wrapper });

  const scripts = "plugin/scripts";
  const workDir = path.join(tmp, ".archguard");
  writeQueryFixture(workDir, tmp, {
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, "2026-01-01T00:00:00Z"])),
    moduleGraphBySource: Object.fromEntries(SOURCES.map((s) => [s, []])),
  });
  commitAt(tmp, "2026-02-01T00:00:00Z", { [`${scripts}/after-artifact.ts`]: "export const after = 1;\n" });

  // The carrier's own per-scope clock: scripts was refreshed 60s ago, i.e. INSIDE the 360m interval.
  const now = "2026-10-22T05:16:43.221Z";
  const lastRefresh = "2026-10-22T05:15:43.221Z";
  const history = path.join(tmp, "history.jsonl");
  fs.writeFileSync(
    history,
    JSON.stringify({ ts: lastRefresh, refresh: { attempted: true, at: lastRefresh, refreshedScopes: [{ scope: "scripts", ok: true }] } }) + "\n",
    "utf8",
  );

  const fact = runArchCycleRound(tmp, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: history, workDir, now,
  });
  assert.equal(fact.state, "verified", "a partial round is still a reading");

  const rec = JSON.parse(fs.readFileSync(history, "utf8").trim().split("\n").pop());
  // "No analyze ran" and "the reading is stale" must BOTH be readable — they are not alternatives.
  assert.equal(rec.refresh.attempted, false, "within-interval still spawns nothing");
  assert.equal(rec.refresh.skipped, "within-interval");
  assert.deepEqual(rec.refresh.deferredScopes.map((d) => d.scope), ["scripts"]);
  assert.equal(rec.refresh.refreshedScopes.length, 0);

  const scriptsRow = rec.scopes.find((s) => s.scope === "scripts");
  assert.equal(scriptsRow.evaluated, false, "⛔ never presented as a current reading");
  assert.equal(scriptsRow.cycleCount, null, "⛔ never cycleCount:0 — that is the healthy-clean value");
  assert.equal(scriptsRow.cycles, null);
  assert.equal(scriptsRow.basis, null);
  assert.match(scriptsRow.reason, /artifact-behind-sources/);
  assert.match(scriptsRow.reason, /within-interval/);
  assert.equal(scriptsRow.commitsSinceArtifact, 1);
  assert.equal(scriptsRow.behindSources, true, "the staleness itself is still recorded");

  assert.equal(rec.status, "partial", "⛔ not \"complete\" while a scope is unevaluated");
  assert.deepEqual(rec.notEvaluatedScopes, ["scripts"]);

  // AC2 negative control, part 1: the five fresh scopes keep their numbers (downgrade is not blanket).
  const fresh = rec.scopes.filter((s) => s.scope !== "scripts");
  assert.equal(fresh.length, 5);
  assert.equal(fresh.every((s) => s.evaluated === true && s.cycleCount === 0), true);

  // AC3: the within-interval round spawned ZERO analyzers.
  assert.deepEqual(analyzedSources(record), [], "⛔ within-interval must not analyze");

  // AC2 negative control, part 2: NO due scope ⇒ explicit no-op, complete, zero downgrade.
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "acr-within-interval-none-"));
  t.after(() => fs.rmSync(tmp2, { recursive: true, force: true }));
  makeRepoFixture(tmp2, { date: "2025-12-01T00:00:00Z" });
  const { wrapper: wrapper2, record: record2 } = fakeArchguard(tmp2);
  withEnv(t, { ARCHGUARD_RUNNER_CLI: wrapper2 });
  const workDir2 = path.join(tmp2, ".archguard");
  writeQueryFixture(workDir2, tmp2, {
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, "2026-01-01T00:00:00Z"])),
    moduleGraphBySource: Object.fromEntries(SOURCES.map((s) => [s, []])),
  });
  const history2 = path.join(tmp2, "history.jsonl");
  const none = runArchCycleRound(tmp2, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: history2, workDir: workDir2, now,
  });
  assert.equal(none.value.refresh.skipped, "no-scope-needs-refresh");
  assert.equal(none.value.refresh.attempted, false);
  assert.equal(none.value.status, "complete");
  assert.deepEqual(none.value.notEvaluatedScopes, []);
  assert.equal(none.value.scopes.every((s) => s.evaluated === true), true, "no scope due ⇒ nothing downgraded");
  assert.deepEqual(analyzedSources(record2), []);
});

test("runArchCycleRound — a stale scope whose analyze FAILS is downgraded to not-evaluated + artifact-behind-sources (AC3)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-ac3-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeRepoFixture(tmp);
  const experiments = "experiments/quay-perpetual-stream/scripts";
  const { wrapper, record } = fakeArchguard(tmp, { failFor: [experiments] });
  withEnv(t, { ARCHGUARD_RUNNER_CLI: wrapper });

  const stale = ["plugin/scripts", "packages/quay-native/src", experiments];
  const workDir = path.join(tmp, ".archguard");
  writeQueryFixture(workDir, tmp, {
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, stale.includes(s) ? "2020-01-01T00:00:00Z" : "2999-01-01T00:00:00Z"])),
    moduleGraphBySource: Object.fromEntries(SOURCES.map((s) => [s, []])),
  });
  const history = path.join(tmp, "history.jsonl");
  const fact = runArchCycleRound(tmp, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: history, workDir, now: new Date().toISOString(),
  });
  assert.equal(fact.state, "verified", "a partial round is still a reading");
  assert.match(fact.reason ?? "", /partial — .*experiments-scripts/);

  const rec = JSON.parse(fs.readFileSync(history, "utf8").trim());
  assert.equal(rec.refresh.skipped, "partial", "⛔ NOT null (would read as a clean sweep) and NOT analyze-failed (others ran)");
  const failed = rec.refresh.refreshedScopes.find((s) => s.scope === "experiments-scripts");
  assert.equal(failed.ok, false);
  assert.equal(failed.exitCode, 3);
  assert.equal(rec.refresh.refreshedScopes.filter((s) => s.ok).length, 2, "the other two were refreshed");

  const bad = rec.scopes.find((s) => s.scope === "experiments-scripts");
  assert.equal(bad.evaluated, false, "⛔ never presented as a current reading");
  assert.equal(bad.cycleCount, null, "⛔ never cycleCount:0 — that is the healthy-clean value");
  assert.equal(bad.cycles, null);
  assert.equal(bad.basis, null);
  assert.match(bad.reason, /artifact-behind-sources/);
  assert.match(bad.reason, /analyze exited 3/);
  assert.match(bad.reason, /2020-01-01T00:00:00Z/);
  assert.equal(bad.behindSources, true, "the staleness itself is still recorded");

  const good = rec.scopes.find((s) => s.scope === "scripts");
  assert.equal(good.evaluated, true, "a scope refreshed in the SAME round keeps its reading");
  assert.equal(good.cycleCount, 0);
  assert.equal(good.behindSources, false);

  assert.equal(rec.status, "partial", "the record-level status names the unrefreshable scope");
  assert.deepEqual(rec.notEvaluatedScopes, ["experiments-scripts"]);
  assert.match(rec.reason, /experiments-scripts: artifact-behind-sources/);
});

test("runArchCycleRound — the SAME failure injected on a FRESH scope does not downgrade it (AC3 negative control)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-ac3-neg-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeRepoFixture(tmp);
  const src = "packages/quay/src";
  // The instrument would fail for src IF it were analyzed — it must never be analyzed, because a
  // fresh scope is not due. This is the control that stops "downgrade" from being "downgrade everything".
  const { wrapper, record } = fakeArchguard(tmp, { failFor: [src] });
  withEnv(t, { ARCHGUARD_RUNNER_CLI: wrapper });
  const workDir = path.join(tmp, ".archguard");
  writeQueryFixture(workDir, tmp, {
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, s === src ? "2999-01-01T00:00:00Z" : "2020-01-01T00:00:00Z"])),
    moduleGraphBySource: Object.fromEntries(SOURCES.map((s) => [s, []])),
  });
  const history = path.join(tmp, "history.jsonl");
  const fact = runArchCycleRound(tmp, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: history, workDir, now: new Date().toISOString(),
  });
  assert.equal(analyzedSources(record).includes(src), false, "a fresh scope is never analyzed");
  const srcRow = fact.value.scopes.find((s) => s.scope === "src");
  assert.equal(srcRow.evaluated, true);
  assert.equal(srcRow.cycleCount, 0);
  assert.equal(srcRow.behindSources, false);
  assert.equal(fact.value.refresh.refreshedScopes.some((s) => s.scope === "src"), false);
  assert.equal(fact.value.status, "complete", "no scope was downgraded");
});

test("downgradeStaleScopes — only the scopes named in `causes` are touched (unit, 硬规则 3b)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-downgrade-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeRepoFixture(tmp);
  const workDir = path.join(tmp, ".archguard");
  writeQueryFixture(workDir, tmp, {
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, "2020-01-01T00:00:00Z"])),
    moduleGraphBySource: Object.fromEntries(SOURCES.map((s) => [s, []])),
  });
  const reading = readDirectoryCycleReading(tmp, workDir);
  const out = downgradeStaleScopes(reading, new Map([["scripts", "analyze exited 7"]]));
  const scripts = out.scopes.find((s) => s.scope === "scripts");
  const other = out.scopes.find((s) => s.scope === "quay-native-src");
  assert.equal(scripts.evaluated, false);
  assert.equal(scripts.cycleCount, null);
  assert.match(scripts.reason, /artifact-behind-sources: artifact 2020-01-01T00:00:00Z is behind .* commit\(s\) touching plugin\/scripts — analyze exited 7/);
  assert.equal(other.evaluated, true, "a scope with no cause keeps its reading");
  assert.equal(other.cycleCount, 0);
  assert.equal(out.status, "partial");
  assert.deepEqual(out.notEvaluatedScopes, ["scripts"]);
  assert.deepEqual(out.behindScopes, reading.behindScopes, "behindScopes still records the staleness");
  assert.equal(downgradeStaleScopes(reading, new Map()), reading, "empty causes ⇒ the same reading (no copy)");
});


test("readLastRefreshAt / readLastRefreshAtByScope — only rounds that RAN an analyze set a clock; the legacy singular shape is honoured (Plan 4)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-clock-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const history = path.join(tmp, "history.jsonl");
  const lines = [
    // legacy record (before this task): ONE scope, singular field
    { ts: "2026-10-20T00:00:00Z", refresh: { attempted: true, refreshedScope: "scripts", at: "2026-10-20T00:00:00Z" } },
    // a reporting-only round must reset NOTHING
    { ts: "2026-10-21T00:00:00Z", refresh: { attempted: false, skipped: "instrument-absent", at: "2026-10-21T00:00:00Z" } },
    // current shape: a list
    {
      ts: "2026-10-22T00:00:00Z",
      refresh: {
        attempted: true,
        refreshedScopes: [
          { scope: "scripts", exitCode: 0, ok: true },
          { scope: "quay-native-src", exitCode: 0, ok: true },
        ],
        at: "2026-10-22T00:00:00Z",
      },
    },
    "{ not json",
  ];
  fs.writeFileSync(history, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n", "utf8");

  assert.equal(readLastRefreshAt(history), "2026-10-22T00:00:00Z", "round-level: the newest round that ran");
  assert.deepEqual(readLastRefreshAtByScope(history), {
    scripts: "2026-10-22T00:00:00Z", // newest wins
    "quay-native-src": "2026-10-22T00:00:00Z",
  });
  const onlySkipped = path.join(tmp, "skipped-only.jsonl");
  fs.writeFileSync(
    onlySkipped,
    JSON.stringify({ ts: "T", refresh: { attempted: false, skipped: "instrument-absent", at: "2026-10-22T00:00:00Z" } }) + "\n",
    "utf8",
  );
  assert.equal(readLastRefreshAt(onlySkipped), null);
  assert.deepEqual(readLastRefreshAtByScope(onlySkipped), {}, "a round that analyzed nothing clocks nothing");
  assert.deepEqual(readLastRefreshAtByScope(path.join(tmp, "does-not-exist.jsonl")), {});
});

test("refreshBehindScopes — an absent instrument is `instrument-absent` and NAMES every probed location (Plan 步骤 4)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-instrument-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeRepoFixture(tmp);
  const missing = path.join(tmp, "no-such-archguard");
  withEnv(t, { ARCHGUARD_RUNNER_CLI: missing });

  const resolution = resolveArchguardCliWithSource();
  assert.equal(resolution.cli, null);
  assert.equal(resolution.source, null);
  assert.ok(resolution.searched.length >= 1);
  assert.match(resolution.searched[0], /ARCHGUARD_RUNNER_CLI=.*no-such-archguard/);
  assert.equal(resolution.searched.length, 1, "the env override WINS — no silent fallthrough to PATH/plugin");

  const workDir = path.join(tmp, ".archguard");
  writeQueryFixture(workDir, tmp, {
    timestampBySource: Object.fromEntries(SOURCES.map((s) => [s, "2020-01-01T00:00:00Z"])),
    moduleGraphBySource: Object.fromEntries(SOURCES.map((s) => [s, []])),
  });
  const res = refreshBehindScopes(tmp, workDir, readDirectoryCycleReading(tmp, workDir));
  assert.equal(res.attempted, false);
  assert.equal(res.skipped, "instrument-absent");
  assert.deepEqual(res.refreshedScopes, []);
  assert.match(res.detail, /probed: .*ARCHGUARD_RUNNER_CLI/);
  assert.ok(res.searched.length > 0, "the searched list is the evidence that a search happened");

  // ROUND LEVEL: a stale scope that could NOT be refreshed must not keep presenting its old cycle
  // count as the current tree (Plan item 3). All six are behind here ⇒ status "none".
  const history = path.join(tmp, "history-absent.jsonl");
  const fact = runArchCycleRound(tmp, {
    config: { enabled: true, intervalMinutes: 60 }, configPresent: true, configError: null,
    historyPath: history, workDir, now: new Date().toISOString(),
  });
  const rec = JSON.parse(fs.readFileSync(history, "utf8").trim());
  assert.equal(rec.refresh.skipped, "instrument-absent");
  assert.equal(rec.scopes.every((s) => s.evaluated === false && s.cycleCount === null), true);
  assert.ok(rec.scopes.every((s) => /artifact-behind-sources/.test(s.reason)));
  assert.equal(rec.status, "none");
  assert.equal(fact.state, "not-evaluated", "the honest verdict when nothing could be made current");
});

test("resolveArchguardCliWithSource — the installed plugin runtime is a real resolution source, discovered from install metadata (Plan 步骤 4)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-plugin-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // A fixture CLAUDE_CONFIG_DIR: install record + the npm-cache sibling layout Claude Code creates.
  const plugins = path.join(tmp, ".claude", "plugins");
  const pluginRoot = path.join(plugins, "cache", "archguard", "archguard", "9.9.9");
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "package.json"), JSON.stringify({ name: "@yalehwang/archguard-claude-plugin", version: "9.9.9" }));
  const cli = path.join(plugins, "npm-cache", "node_modules", "@yalehwang", "archguard", "dist", "cli", "index.js");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "#!/usr/bin/env node\n", { mode: 0o755 });
  fs.writeFileSync(
    path.join(plugins, "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "archguard@archguard": [{ scope: "user", installPath: pluginRoot, version: "9.9.9" }] } }),
  );
  withEnv(t, { CLAUDE_CONFIG_DIR: path.join(tmp, ".claude"), ARCHGUARD_RUNNER_CLI: undefined });
  // ⛔ the PATH lookup would find nothing in a hermetic env only by luck — the point is that the
  // plugin source is reached when PATH does not answer, which is this host's real situation.
  const resolution = resolveArchguardCliWithSource();
  if (resolution.source === "path") {
    t.skip("a real archguard is on PATH here; the plugin fallback is unreachable by construction");
    return;
  }
  assert.equal(resolution.source, "plugin", resolution.searched.join(" ; "));
  assert.equal(resolution.cli, cli);
  assert.equal(resolution.viaNode, false);
});

// ── the real repository: the two provider packages ARE single-directory ──────────────────────────

test("real repo — packages/quay-github/src and packages/quay-backlog/src read as single-directory (AC2)", () => {
  for (const source of ["packages/quay-github/src", "packages/quay-backlog/src"]) {
    const sd = singleDirectoryBasis(REPO_ROOT, source);
    assert.equal(sd.single, true, `${source}: ${sd.reason ?? ""} dirs=${JSON.stringify(sd.dirs)}`);
    assert.deepEqual(sd.dirs, [source]);
    assert.ok(sd.files > 0);
  }
  // The negative control on the SAME real repo: a scope that genuinely spans directories must NOT be
  // reported single-directory (otherwise the predicate would be "true for everything").
  const multi = singleDirectoryBasis(REPO_ROOT, "packages/quay/src");
  assert.equal(multi.single, false);
  assert.ok(multi.dirs.length > 1, `expected several directories, got ${JSON.stringify(multi.dirs)}`);
});
