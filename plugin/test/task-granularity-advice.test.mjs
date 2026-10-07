// @test-group engine
// task-granularity-advice.test.mjs — task gap-task-granularity-advice-script-merge-candidates-and-per-file-history.
// Tests for plugin/scripts/task-granularity-advice.ts (the filing-time granularity instrument).
//
// Coverage map (the task's own ACs):
//   AC1 — the literal CLI command exits 0 and emits `peers` + `perFile` with perFile[0].path intact.
//   AC2 — the negative control: an unknown path ⇒ peers [] and nLanded 0; the KNOWN-TRUE control:
//         a todo task's own substantive Touches file ⇒ peers contains that task (temp workspace).
//   AC3 — generic-registry overlap ⇒ no peer; substantive overlap ⇒ peer. Multi-line Touches is
//         covered here too (the `$`-with-`m`-flag parser trap the task calls out).
//   AC4 — unreadable input must not masquerade as "no peers / nLanded: 0": evaluated:false + reason,
//         per-file rows marked evaluated:false and carrying NO nLanded key (硬规则 3b).
//   AC5 — POSITIONAL: the classifier is imported from rework-predictors (never re-implemented), no
//         inline `final_state ==` comparison exists, and Touches parsing goes through touches-parser.
//   AC6 — --report: 10 size bins, insufficient under n<10 with no statistics, the six-key model with
//         intervals, and the production table.
//   The production arm reads the MAIN checkout's carrier (worktrees deliberately do not receive it)
//   and SKIPS LOUDLY when it is absent, so a clean checkout does not red.
//
// Run: scripts/test.sh --for-task gap-task-granularity-advice-script-merge-candidates-and-per-file-history

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  isSubstantiveTouchesPath,
  countsTowardSize,
  carrierStatus,
  readOpenTasks,
  computePeers,
  computeMentions,
  buildPerFile,
  landingTasksForRoot,
  summariseBin,
  SIZE_BINS,
  fitCostModel,
  buildReport,
} from "../scripts/task-granularity-advice.ts";
import { classifyFinalState } from "../scripts/rework-predictors.ts";
import { mainCheckoutRoot, repoRoot } from "../scripts/repo-root.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "task-granularity-advice.ts");
const SCRIPT_SRC = fs.readFileSync(SCRIPT, "utf8");

// ── tmp-dir carrier (the tmp-leak-pairing-check contract) ────────────────────────────────────────
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});
function tmpDir(tag) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), tag));
  _tmpDirs.push(dir);
  return dir;
}

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

/** A task file with a MULTI-LINE `## Touches` list (the `$`+`m`-flag trap lives here: a parser that
 *  treats a line-final `$` as the end of the section reads only the first bullet). */
function taskFile(id, { status = "todo", touches = [], body = "" } = {}) {
  return [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    `status: ${status}`,
    "labels:",
    "  - gap",
    "parent: null",
    "children: []",
    "---",
    "## Proposal",
    "",
    "fixture body text long enough to clear the artifact floor for a proposal shape.",
    "",
    "## AC",
    "",
    "- [ ] fixture",
    "",
    "## DoD",
    "",
    "fixture dod text long enough to clear the artifact floor for this section.",
    "",
    "## Touches",
    "",
    ...touches.map((t) => `- \`${t}\``),
    "",
    body,
  ].join("\n");
}

/** A throwaway git repo with a tasks/ dir (so the landing index is evaluable). */
function mkTmpRepo(tasksSpec, { carrier = true, git = true } = {}) {
  const dir = tmpDir("gta-");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  for (const [id, spec] of Object.entries(tasksSpec)) {
    fs.writeFileSync(path.join(dir, "tasks", `${id}.md`), taskFile(id, spec));
  }
  if (carrier) {
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    // ONE real record: an EMPTY carrier is itself NOT-EVALUATED (a zero-record stream and "nothing
    // ever reworks" must not share a reading), so the default fixture must carry data.
    fs.writeFileSync(
      path.join(dir, ".quay", "worker-outcome.jsonl"),
      JSON.stringify({ ts: "2026-09-20T00:00:00.000Z", task: Object.keys(tasksSpec)[0] ?? "t", final_state: "completed", wall_clock_ms: 60000 }) + "\n",
    );
  }
  if (git) {
    const g = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "ignore", "ignore"] });
    g("init", "-q", "-b", "develop");
    g("-c", "user.email=t@e", "-c", "user.name=t", "add", "-A");
    // --allow-empty: a fixture with no files still needs a commit for the landing index to be evaluable.
    g("-c", "user.email=t@e", "-c", "user.name=t", "commit", "--allow-empty", "-qm", "init");
  }
  return dir;
}

function runCli(args, { cwd = HERE, allowFail = false } = {}) {
  try {
    const stdout = execFileSync(process.execPath, ["--experimental-strip-types", SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1 << 28,
    });
    return { code: 0, stdout };
  } catch (e) {
    if (!allowFail) throw e;
    return { code: e.status ?? -1, stdout: String(e.stdout ?? "") };
  }
}

const MAIN = mainCheckoutRoot(HERE) || repoRoot(HERE);
const MAIN_CARRIER = path.join(MAIN, ".quay", "worker-outcome.jsonl");

// ── AC1: the literal CLI command ─────────────────────────────────────────────────────────────────

test("AC1: `--touches <path> --json` exits 0 and emits peers + perFile with the path intact", () => {
  const r = runCli(["--touches", "plugin/scripts/worker-driver.ts", "--json"]);
  assert.equal(r.code, 0);
  const d = JSON.parse(r.stdout);
  assert.ok(Array.isArray(d.peers), "peers must be an array");
  assert.ok(Array.isArray(d.perFile), "perFile must be an array");
  assert.equal(d.perFile[0].path, "plugin/scripts/worker-driver.ts", "perFile[0].path is the input path");
  assert.equal(typeof d.evaluated, "boolean");
});

// ── AC2: the negative control AND the known-true control ─────────────────────────────────────────

test("AC2 (negative control): an unknown path ⇒ peers [] and nLanded 0, exit 0", () => {
  const r = runCli(["--touches", "plugin/scripts/__no_such_file_anywhere__.ts", "--json"]);
  assert.equal(r.code, 0);
  const d = JSON.parse(r.stdout);
  assert.deepEqual(d.peers, [], "no open task declares an unknown path ⇒ no peer");
  assert.equal(d.perFile[0].nLanded, 0);
});

test("AC2 (known-true control): a todo task's own substantive Touches file puts it in peers", () => {
  const dir = mkTmpRepo({
    "t-self": { status: "todo", touches: ["src/a.ts", "src/b.ts", "docs/x.md"] },
  });
  const open = readOpenTasks([dir]);
  assert.equal(open.evaluated, true);
  const peers = computePeers(["src/a.ts"], open.tasks);
  assert.deepEqual(peers.map((p) => p.id), ["t-self"], "the declaring task is found");
  assert.deepEqual(peers[0].sharedFiles, ["src/a.ts"]);
  // A path nobody declares (but which exists in no Touches) ⇒ still no peer.
  assert.deepEqual(computePeers(["src/nope.ts"], open.tasks), []);
});

// ── AC3: generic-registry filtering + multi-line Touches ─────────────────────────────────────────

test("AC3: overlap ONLY on a generic registry yields no peer; overlap on a source file yields one", () => {
  const registry = "plugin/scripts/capability-catalog-declarations.json";
  const dir = mkTmpRepo({
    "t-a": { status: "todo", touches: [registry, "plugin/scripts/alpha.ts", "plugin/sh-census-baseline.json"] },
    "t-b": { status: "ready", touches: [registry, "plugin/scripts/beta.ts", "plugin/import-graph-baseline.json"] },
  });
  const open = readOpenTasks([dir]);
  assert.equal(open.tasks.length, 2);
  // TWO multi-line Touches lists were read in full (the `$`+`m` trap would see only the first line).
  assert.equal(open.tasks.find((t) => t.id === "t-a").touches.length, 3);
  assert.equal(open.tasks.find((t) => t.id === "t-b").touches.length, 3);

  assert.deepEqual(computePeers([registry], open.tasks), [], "a generic registry is not a merge signal");
  assert.deepEqual(computePeers(["plugin/sh-census-baseline.json"], open.tasks), [], "baselines are not either");
  assert.deepEqual(
    computePeers(["plugin/scripts/alpha.ts"], open.tasks).map((p) => p.id),
    ["t-a"],
    "overlap on a substantive source file DOES produce the peer",
  );
  // A done task is not an open peer.
  const dir2 = mkTmpRepo({ "t-done": { status: "done", touches: ["src/a.ts"] } });
  assert.deepEqual(computePeers(["src/a.ts"], readOpenTasks([dir2]).tasks), []);
});

test("AC3: prose mentions are reported separately from declarations (never confused)", () => {
  const dir = mkTmpRepo({
    "t-declares": { status: "todo", touches: ["src/a.ts"] },
    "t-mentions": { status: "todo", touches: ["src/z.ts"], body: "we will NOT touch `src/a.ts` in this task" },
  });
  const open = readOpenTasks([dir]);
  const peers = computePeers(["src/a.ts"], open.tasks);
  const mentions = computeMentions(["src/a.ts"], open.tasks);
  assert.deepEqual(peers.map((p) => p.id), ["t-declares"], "only the DECLARATION is a peer");
  assert.deepEqual(mentions.map((m) => m.id), ["t-mentions"], "the prose hit is surfaced separately");
  // …and the two halves partition the grep-shaped hit set.
  const union = new Set([...peers.map((p) => p.id), ...mentions.map((m) => m.id)]);
  assert.deepEqual([...union].sort(), ["t-declares", "t-mentions"]);
});

// ── AC4: unreadable input must not look like a healthy empty answer ──────────────────────────────

test("AC4: a missing carrier ⇒ evaluated:false + reason, per-file rows carry NO nLanded", () => {
  const dir = mkTmpRepo({ "t-a": { status: "todo", touches: ["src/a.ts"] } }, { carrier: false });
  const r = runCli(["--touches", "src/a.ts", "--root", dir, "--json"]);
  assert.equal(r.code, 0, "advice mode still exits 0 — the JSON carries the distinction");
  const d = JSON.parse(r.stdout);
  assert.equal(d.evaluated, false, "an unreadable carrier is NOT-EVALUATED");
  assert.ok(d.reasons.some((x) => /carrier/.test(x)), `a reason names the carrier: ${JSON.stringify(d.reasons)}`);
  for (const f of d.perFile) {
    assert.equal(f.evaluated, false, "each per-file row is marked unevaluated");
    assert.ok(!("nLanded" in f), "an unevaluated row must NOT print nLanded (0 would read as 'no history')");
  }
  // peers are still computed (a different dimension), and that is stated separately.
  assert.equal(d.peersEvaluated, true);
  assert.deepEqual(d.peers.map((p) => p.id), ["t-a"]);
});

test("AC4: a missing tasks dir ⇒ peersEvaluated:false, never an empty peers list read as 'no peers'", () => {
  const dir = tmpDir("gta-notasks-");
  const r = runCli(["--touches", "src/a.ts", "--root", dir, "--json"]);
  assert.equal(r.code, 0);
  const d = JSON.parse(r.stdout);
  assert.equal(d.peersEvaluated, false);
  assert.equal(d.evaluated, false);
  assert.ok(d.reasons.some((x) => /tasks-dir-unreadable/.test(x)));
});

test("AC4: carrierStatus distinguishes missing / readable, and never returns a record count for a missing file", () => {
  const withCarrier = mkTmpRepo({}, { carrier: true });
  const without = mkTmpRepo({}, { carrier: false });
  assert.equal(carrierStatus(withCarrier).evaluated, true);
  assert.equal(carrierStatus(without).evaluated, false);
  assert.equal(carrierStatus(without).reason, "carrier-missing");
});

// ── AC5: positional source assertions (硬规则 2 — 按位置判定) ──────────────────────────────────────

test("AC5: the classifier is REUSED from rework-predictors and never re-implemented inline", () => {
  const importHits = SCRIPT_SRC.split("\n").filter((l) => /from ['"]\.\/rework-predictors/.test(l));
  assert.ok(importHits.length >= 1, "the module imports the shared classifier/loader");

  const inlineComparisons = SCRIPT_SRC.split("\n").filter((l) => /final_state\s*[=!]==/.test(l));
  assert.deepEqual(inlineComparisons, [], "no second copy of the dead-value comparison may exist here");

  const touchesHits = SCRIPT_SRC.split("\n").filter((l) => /touches-parser/.test(l));
  assert.ok(touchesHits.length >= 1, "Touches parsing goes through the ONE parser (touches-parser.ts)");

  // Behavioural half: the REUSED classifier still has the four-state contract this script relies on
  // (the dead value stays visible, an unknown state is neither success nor failure).
  assert.equal(classifyFinalState("completed"), "success");
  assert.equal(classifyFinalState("landed"), "legacy-alias");
  assert.equal(classifyFinalState("exited-not-landed"), "non-landed");
  assert.equal(classifyFinalState("brand-new-state"), "unrecognized");
});

// ── AC6: the throughput report ───────────────────────────────────────────────────────────────────

test("AC6: there are exactly 10 size bins and an under-sampled bin renders no statistics", () => {
  assert.equal(SIZE_BINS.length, 10);
  assert.deepEqual(
    SIZE_BINS.map((b) => b.label),
    ["<100", "100–150", "150–250", "250–400", "400–600", "600–1000", "1000–1500", "1500–2000", "2000–3000", "3000+"],
  );
  const mk = (size) => ({
    id: `t${size}`, root: "/r", size, firstDispatched: "2026-09-20T00:00:00Z", executions: 1,
    successExecutions: 1, failedExecutions: 0, unrecognizedExecutions: 0, firstTrySuccess: true,
    landingRoundWallMin: 10, failedWallMin: 0, totalWallMin: 10,
  });
  const small = [mk(10), mk(20), mk(30)];
  const b = summariseBin(SIZE_BINS[0], small, 10);
  assert.equal(b.insufficient, true);
  assert.equal(b.n, 3);
  for (const k of ["firstTryRate", "failedRoundsPerTask", "meanTotalWallMin", "workerHoursPer1000Lines"]) {
    assert.ok(!(k in b), `an under-sampled bin must not render ${k}`);
  }
  const big = Array.from({ length: 10 }, (_, i) => mk(10 + i));
  const b2 = summariseBin(SIZE_BINS[0], big, 10);
  assert.equal(b2.insufficient, false);
  assert.equal(typeof b2.firstTryRate, "number");
  assert.equal(typeof b2.failedRoundsPerTask, "number");
  assert.equal(typeof b2.meanTotalWallMin, "number");
  assert.equal(typeof b2.workerHoursPer1000Lines, "number");
  assert.ok(b2.workerHoursPer1000LinesCI && b2.workerHoursPer1000LinesCI.lo <= b2.workerHoursPer1000Lines);
});

test("AC6: the cost model exposes a/b/c/d/f0/f1, each with an interval, and recovers an exact fit", () => {
  // A synthetic population generated EXACTLY from the model ⇒ the fit must recover the parameters
  // (a positive control: a model that cannot recover its own generator is not measuring).
  const A = 17, B = 0.35, C = 19, D = 0.0, F0 = 0.94, F1 = 0.0;
  const tasks = [];
  for (let i = 1; i <= 400; i++) {
    const size = 20 + i * 8;
    const x = size / 100;
    const f = F0 + F1 * Math.log10(size / 300);
    const landing = A + B * x;
    // Deliberately FRACTIONAL: this is a positive control of the FITTER (does it recover its own
    // generator?), so quantizing `f` would test rounding, not the regression. Real counts are
    // integers; here the exact model must come back exactly.
    const failed = f;
    tasks.push({
      id: `t${i}`, root: "/r", size, firstDispatched: "2026-09-20T00:00:00Z",
      executions: 1 + failed, successExecutions: 1, failedExecutions: failed, unrecognizedExecutions: 0,
      firstTrySuccess: failed === 0,
      landingRoundWallMin: landing,
      failedWallMin: failed * (C + D * x),
      totalWallMin: landing + failed * (C + D * x),
    });
  }
  const m = fitCostModel(tasks, 200, 7);
  for (const k of ["a", "b", "c", "d", "f0", "f1"]) {
    assert.ok(k in m, `model must have key ${k}`);
    assert.ok("value" in m[k] && "ci" in m[k], `${k} carries value + interval`);
  }
  assert.ok(Math.abs(m.a.value - A) < 0.5, `a recovered (${m.a.value} vs ${A})`);
  assert.ok(Math.abs(m.b.value - B) < 0.05, `b recovered (${m.b.value} vs ${B})`);
  assert.ok(Math.abs(m.c.value - C) < 1.5, `c recovered (${m.c.value} vs ${C})`);
  assert.ok(Math.abs(m.f0.value - F0) < 0.05, `f0 recovered (${m.f0.value} vs ${F0})`);
  // Determinism: the same seed reproduces the same interval endpoints.
  assert.deepEqual(fitCostModel(tasks, 200, 7), m);
});

test("AC6: --report --json emits 10 bins, the model, and the windowed population", () => {
  const dir = tmpDir("gta-report-");
  // A git repo with no merge commits is still a valid (empty) report — it must not crash.
  execFileSync("git", ["-C", dir, "init", "-q", "-b", "develop"]);
  const r = runCli(["--report", "--json", "--root", dir]);
  assert.equal(r.code, 0);
  const d = JSON.parse(r.stdout);
  assert.equal(d.bins.length, 10, "ten size bins");
  for (const k of ["a", "b", "c", "d", "f0", "f1"]) assert.ok(k in d.model, `model.${k}`);
  assert.equal(d.mode, "report");
});

test("AC6 (production): the quay carrier yields a full 10-bin table with at least one sufficient bin", (t) => {
  if (!fs.existsSync(MAIN_CARRIER)) {
    t.diagnostic(`NOT-EVALUATED: production carrier absent at ${MAIN_CARRIER}`);
    return;
  }
  const r = buildReport({ roots: [MAIN], since: "2026-09-16", bootstrap: 100, seed: 1 });
  assert.equal(r.bins.length, 10);
  assert.ok(r.population.measured > 100, `expected a real sample, got ${r.population.measured}`);
  assert.ok(r.bins.some((b) => b.sufficient), "at least one bin has enough tasks to report");
  assert.ok(r.bins.some((b) => b.insufficient), "at least one bin is under-sampled (otherwise the rule is vacuous)");
  for (const b of r.bins) {
    if (b.insufficient) assert.ok(!("firstTryRate" in b));
    else {
      assert.ok(b.firstTryRate >= 0 && b.firstTryRate <= 1);
      assert.ok(b.workerHoursPer1000Lines === null || b.workerHoursPer1000Lines > 0);
    }
  }
});

// ── landing index / per-file history (the production reading) ────────────────────────────────────

test("landing index: a landed task's size comes from its merge's develop-side diff", () => {
  const dir = tmpDir("gta-land-");
  const g = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "ignore", "ignore"], encoding: "utf8" });
  const gOut = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  const commit = (msg) => {
    execFileSync("git", ["-C", dir, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", msg]);
  };
  g("init", "-q", "-b", "develop");
  fs.writeFileSync(path.join(dir, "base.txt"), "x\n");
  g("add", "-A");
  commit("base");
  // task branch off develop, then develop advances (so the merge is a REAL two-parent merge).
  g("checkout", "-q", "-b", "task/gap-fixture");
  fs.writeFileSync(path.join(dir, "impl.ts"), "a\nb\nc\n");
  fs.writeFileSync(path.join(dir, "impl.test.ts"), "t\n");
  g("add", "-A");
  commit("impl");
  g("checkout", "-q", "develop");
  fs.writeFileSync(path.join(dir, "other.txt"), "y\n");
  g("add", "-A");
  commit("develop advances");
  g("checkout", "-q", "task/gap-fixture");
  execFileSync("git", ["-C", dir, "-c", "user.email=t@e", "-c", "user.name=t", "merge", "--no-edit", "develop"], { stdio: ["ignore", "ignore", "ignore"] });
  g("checkout", "-q", "develop");
  execFileSync("git", ["-C", dir, "-c", "user.email=t@e", "-c", "user.name=t", "merge", "--ff-only", "task/gap-fixture"], { stdio: ["ignore", "ignore", "ignore"] });

  const idx = landingTasksForRoot(dir);
  assert.equal(idx.evaluated, true, idx.reason ?? "");
  const t = idx.byId.get("gap-fixture");
  assert.ok(t, "the task branch's landing merge is found");
  assert.equal(t.files.get("impl.ts"), 3, "the task's own 3 added lines (NOT develop's changes)");
  assert.equal(t.files.get("impl.test.ts"), 1);
  assert.equal(t.size, 4, "code + tests count toward size");
  assert.ok(!t.files.has("other.txt"), "develop's own changes are NOT attributed to the task");

  // Per-file: the 3 added lines land under the file path, and the task's executions come from the
  // carrier (absent here ⇒ 0 records, which is a REAL 0 for an empty carrier file, not a missing one).
  const o = new Map([[dir, new Map()]]);
  const rows = buildPerFile(["impl.ts"], { roots: [dir], landing: new Map([[dir, idx]]), outcomes: o });
  assert.equal(rows[0].evaluated, true);
  assert.equal(rows[0].nLanded, 1);
  assert.equal(rows[0].medianFileChangedLines, 3);
  assert.equal(rows[0].medianChangedLines, 4);
  assert.equal(rows[0].medianExecutions, 0);
});

// ── production reading of peers (硬规则 4 推论三: read the production carrier) ────────────────────

test("production: for real declared paths, peers ∪ mentions equals the step-2b grep oracle", (t) => {
  if (!fs.existsSync(path.join(MAIN, "tasks"))) {
    t.diagnostic("NOT-EVALUATED: no tasks/ in the main checkout");
    return;
  }
  const open = readOpenTasks([MAIN]);
  assert.equal(open.evaluated, true);
  const samplePaths = [
    "plugin/scripts/worker-driver.ts",
    "plugin/scripts/rework-predictors.ts",
    "packages/quay/bin/quay.ts",
    "packages/quay/src/init.ts",
  ];
  for (const p of samplePaths) {
    // The partition is PER PATH: a task declaring `p` is a peer, one merely naming it is a mention.
    const peers = computePeers([p], open.tasks);
    const mentions = computeMentions([p], open.tasks);
    const both = peers.map((x) => x.id).filter((id) => mentions.some((m) => m.id === id));
    assert.deepEqual(both, [], "no task may be both a declarer and a pure-prose mention for the SAME path");
    const union = [...new Set([...peers.map((x) => x.id), ...mentions.map((x) => x.id)])].sort();
    // The oracle: the literal grep of step 2b, restricted to open statuses.
    const grepOut = execFileSync(
      "bash",
      ["-c", `grep -lF -- "${p}" tasks/*.md | xargs -r grep -lE '^status: (todo|ready)$'`],
      { cwd: MAIN, encoding: "utf8" },
    );
    const oracle = grepOut.split("\n").map((x) => path.basename(x.trim()).replace(/\.md$/, "")).filter(Boolean).sort();
    assert.deepEqual(union, oracle, `peers ∪ mentions must equal the grep oracle for ${p}`);
  }
});

// ── file-class predicates ────────────────────────────────────────────────────────────────────────

test("predicates: what counts as a substantive source file (and toward size)", () => {
  for (const p of ["plugin/scripts/alpha.ts", "packages/quay/src/init.ts", "docs/analysis/x.md"]) {
    assert.equal(isSubstantiveTouchesPath(p), true, p);
  }
  for (const p of [
    "tasks/gap-x.md",
    "plugin/scripts/capability-catalog-declarations.json",
    "plugin/freshness-producers.json",
    "plugin/sh-census-baseline.json",
    "plugin/import-graph-baseline.json",
    "plugin/test/foo.test.mjs",
    "packages/quay/test/init.spec.mjs",
    "package-lock.json",
  ]) {
    assert.equal(isSubstantiveTouchesPath(p), false, p);
  }
  assert.equal(countsTowardSize("plugin/scripts/alpha.ts"), true);
  assert.equal(countsTowardSize("tasks/gap-x.md"), false);
  assert.equal(countsTowardSize("goals/AC-1.md"), false);
  assert.equal(countsTowardSize(".quay/x.json"), false);
  assert.equal(countsTowardSize("package-lock.json"), false);
});
