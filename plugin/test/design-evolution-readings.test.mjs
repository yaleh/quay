// @test-group engine
// design-evolution-readings.test.mjs — RM1/RM2 readings for the design-evolution meta-mechanism
// (task gap-design-evolution-readings-report-only-routine; DIR-133 ruling 3, 2026-10-22)
//
// WHAT THIS PINS, in decreasing order of how easy it is to lose:
//   ① THE ONE FORMULA — `share = centralΔ / (centralΔ + nonCentralΔ)`, with nonCentralΔ including
//      the growth of files that ALREADY EXISTED at baseline (the口径 bug the finding corrected
//      88% → 82%: the old command's denominator dropped them, so re-running it reproduced the wrong
//      number). Asserted on a synthetic history whose numbers are known by construction.
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
  PREDICATE_SELFCHECK_PATH,
  PREDICATE_SELFCHECK_SAMPLE,
  buildReadings,
  globToRegExp,
  lineCountAt,
  measureSubsystem,
  parseDesignEvolutionSection,
  readStandaloneSection,
  resolveCommit,
  scanContention,
} from "../scripts/design-evolution-readings.ts";

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
  const write = (rel, lines) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, lines === 0 ? "" : Array.from({ length: lines }, (_, i) => `line ${i}`).join("\n") + "\n");
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
  const r = scanContention(dir, { carrierPath: file });
  assert.equal(r.evaluated, true, r.reason ?? "");
  assert.equal(r.carrierRecords, 3);
  assert.deepEqual(r.predicateSelfCheck, { ok: true, form1: true, form2: true });
  const wd = r.files.find((f) => f.file === "worker-driver.ts");
  assert.equal(wd.form1, 1, "t3 has no contention token ⇒ not form 1");
  assert.equal(wd.form2, 1, "the same conflict text appears twice in ONE record ⇒ still 1");
  assert.equal(wd.total, 2);
  const gd = r.files.find((f) => f.file === "goal-driver.ts");
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
  assert.equal(CONTENTION_TOKENS.includes("contention"), true);
  assert.equal(CONTENTION_TOKENS.includes("避开"), true);
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
  assert.equal(rec.rm2.files[0].file, "central.ts");
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
  });
  // enabled without interval/subsystems ⇒ documented defaults, not an unset schedule.
  assert.deepEqual(parseDesignEvolutionSection({ enabled: true }).config, {
    enabled: true,
    intervalMinutes: 360,
    subsystems: [],
    topN: 10,
  });
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
    modules: ["packages/quay/src/serve*.ts", "packages/quay/src/server-state*.ts", "packages/quay/src/serve/*.ts"],
  });
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

test("AC4 (real carrier) — the finding's contention counts are reproduced (carrier growth ⇒ ≥)", (t) => {
  const carrier = path.join(REPO_ROOT, ".quay", "worker-outcome.jsonl");
  if (!fs.existsSync(carrier)) {
    t.skip(".quay/worker-outcome.jsonl is absent (gitignored runtime ledger)");
    return;
  }
  const r = scanContention(REPO_ROOT, { topN: 100_000 });
  assert.equal(r.evaluated, true, r.reason ?? "");
  assert.equal(r.predicateSelfCheck.ok, true, "the built-in known-true sample must pass on the real run");
  const at = (f) => r.files.find((x) => x.file === f);
  const wd = at("worker-driver.ts");
  assert.ok(wd.form1 >= 5, `worker-driver.ts form1 ${wd.form1} < 5`);
  assert.ok(wd.form2 >= 6, `worker-driver.ts form2 ${wd.form2} < 6`);
  assert.ok(wd.samples.form1.length === Math.min(3, wd.form1));
  assert.ok(wd.samples.form1.every((s) => s.task !== null && s.ts !== null));
  const wf = at("worker-fan-in.ts");
  assert.ok(wf.form1 >= 1, `worker-fan-in.ts form1 ${wf.form1} < 1`);
  assert.equal(wf.form2, 0);
  const gd = at("goal-driver.ts");
  assert.ok(gd.form1 >= 2, `goal-driver.ts form1 ${gd.form1} < 2`);
  assert.equal(gd.form2, 0);
});
