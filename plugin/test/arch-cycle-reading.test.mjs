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
  refreshBehindScopes,
} from "../scripts/archguard-runner.ts";
import { runArchCycleRound, readLastRefreshAt } from "../scripts/quality-gate-driver.ts";

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
 *  directory tree would only prove the fixture to itself). */
function gitInit(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf8");
  }
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
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
 *  directory (so their single-directory judgment is FALSE — the negative control). */
function makeRepoFixture(root, { multiDir = [], testsInSubdir = false } = {}) {
  const files = {};
  SOURCES.forEach((source, i) => {
    files[`${source}/mod-${i}.ts`] = `export const v${i} = ${i};\n`;
    files[`${source}/other-${i}.ts`] = `export const w${i} = ${i};\n`;
    if (multiDir.includes(source)) files[`${source}/nested/deep-${i}.ts`] = `export const d${i} = ${i};\n`;
    if (testsInSubdir) files[`${source}/__tests__/x-${i}.test.ts`] = `export const t${i} = ${i};\n`;
    files[`${source}/y-${i}.test.ts`] = `export const u${i} = ${i};\n`;
  });
  return gitInit(root, files);
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

// ── refresh: at most one analyze per interval, package-level diagram, honest skips ───────────────

/** A fake archguard CLI: records its argv, then rewrites the target scope's artifact WITH a module
 *  graph and a NOW timestamp — i.e. exactly what `analyze --diagrams package` would persist. */
function fakeArchguard(tmp) {
  const record = path.join(tmp, "argv.log");
  const script = path.join(tmp, "fake-archguard.mjs");
  fs.writeFileSync(
    script,
    `import fs from "node:fs";\n` +
      `import path from "node:path";\n` +
      `const argv = process.argv.slice(2);\n` +
      `fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(argv) + "\\n");\n` +
      `const i = argv.indexOf("--work-dir");\n` +
      `const wd = argv[i + 1];\n` +
      `const s = argv[argv.indexOf("-s") + 1];\n` +
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

test("refreshBehindScopes — ONE analyze, requesting the package-level diagram, then a re-read that clears behindSources (AC4 mechanism)", (t) => {
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
  assert.equal(res.skipped, null);
  assert.equal(res.refreshedScope, "src", "at most ONE scope per call — the first that needs it");
  assert.equal(res.instrumentSource, "env");
  assert.match(res.instrument, /fake-archguard$/);

  const calls = fs.readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(calls.length, 1, "⛔ exactly one analyze per refresh — never a 6×27s sweep inside a report tick");
  assert.deepEqual(calls[0].slice(0, 1), ["analyze"]);
  const dIdx = calls[0].indexOf("--diagrams");
  assert.ok(dIdx >= 0, "the request must ask for a package-level diagram");
  assert.equal(calls[0][dIdx + 1], "package", "`--diagrams package` is what makes archguard emit moduleGraph");
  // ⛔ and it must BYPASS the cache: a cache hit rewrites the query artifact with the PREVIOUS run's
  // timestamp (measured: 2.1s, `arch.json` restored verbatim), leaving the scope exactly as behind as
  // it was — a refresh that cannot change the reading is not a refresh.
  assert.ok(calls[0].includes("--no-cache"), "the refresh must force a real re-analysis");
  assert.equal(calls[0][calls[0].indexOf("-s") + 1], "packages/quay/src");

  const after = readDirectoryCycleReading(tmp, workDir);
  const src = after.scopes.find((s) => s.scope === "src");
  assert.equal(src.evaluated, true);
  assert.equal(src.behindSources, false, "the refreshed artifact now covers the tree");
  assert.equal(after.scopes.filter((s) => s.behindSources === true).length, 5, "the other scopes were NOT swept");
});

test("runArchCycleRound — refresh is applied BEFORE the reported reading, and AT MOST ONCE per interval (AC4/DoD)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-interval-"));
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
  const history = path.join(tmp, "history.jsonl");
  const base = {
    config: { enabled: true, intervalMinutes: 60 }, configPresent: true, configError: null,
    historyPath: history, workDir,
  };

  const first = runArchCycleRound(tmp, { ...base, now: new Date().toISOString() });
  assert.equal(first.state, "verified", first.reason ?? "");
  assert.equal(first.value.refresh.attempted, true);
  assert.equal(first.value.refresh.refreshedScope, "src");
  assert.equal(first.value.refresh.appliedBeforeReading, true);
  assert.equal(first.value.scopes.find((s) => s.scope === "src").behindSources, false, "the record reports the POST-refresh reading");

  // A restart minutes later must NOT refresh again (the interval guard reads the carrier itself).
  const second = runArchCycleRound(tmp, { ...base, now: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(second.value.refresh.attempted, false);
  assert.equal(second.value.refresh.skipped, "within-interval");
  assert.match(second.value.refresh.detail, /at most one analyze per interval/);

  const calls = fs.readFileSync(record, "utf8").trim().split("\n").filter((l) => l.trim());
  assert.equal(calls.length, 1, "two rounds inside one interval ⇒ exactly one analyze");

  // `readLastRefreshAt` only counts rounds that RAN an analyze — a reporting-only round does not
  // reset the clock (otherwise a permanently absent instrument would never retry).
  assert.equal(readLastRefreshAt(history) !== null, true);
  const onlySkipped = path.join(tmp, "skipped-only.jsonl");
  fs.writeFileSync(
    onlySkipped,
    JSON.stringify({ ts: "T", refresh: { attempted: false, skipped: "instrument-absent", at: "2026-10-22T00:00:00Z" } }) + "\n",
    "utf8",
  );
  assert.equal(readLastRefreshAt(onlySkipped), null);
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
  assert.match(res.detail, /probed: .*ARCHGUARD_RUNNER_CLI/);
  assert.ok(res.searched.length > 0, "the searched list is the evidence that a search happened");
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
