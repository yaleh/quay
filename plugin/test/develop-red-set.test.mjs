// @test-group serial
// develop-red-set.test.mjs — gap-develop-red-set-writer
//
// WHAT IS UNDER TEST: `.quay/develop-red-set.json`, the **current develop red-signature set** — the
// mechanical "this red has DISAPPEARED" signal that the cockpit rescue path needs.
//
// THE DEFECT THE CARRIER EXISTS FOR: `.quay/baseline-red-rounds.jsonl` is append-only and per-task
// ("this task saw this red"), so it can never express "red X is gone from develop". A rescue candidate
// must not be re-dispatched on an LLM's guess that a blocker is fixed (measured AUC 0.557, no
// zero-false-positive threshold) — it needs a reading.
//
// THE MECHANISM (three parts, all here):
//   · observe  — `worker-fan-in.ts` projects the baseline A/B's parse onto `DevelopRedObservation`
//                (pure data, carried on the fan-in result);
//   · maintain — `maintainDevelopRedSet` (pure): red ⇒ upsert by `<file>::<test name>`; green-and-
//                actually-run-and-develop-advanced ⇒ remove; anything less ⇒ keep (hard rule 3b);
//   · write    — `worker-driver.ts`'s `--mechanical-fan-in` entry is the ONLY writer (AC4).
//
// FALSIFIABILITY: every "removal" claim below has a paired negative control that keeps the key —
// a file that was not re-run this round, and a develop that did not advance. If removal were a blanket
// "not observed ⇒ gone", those two arms would flip red.
//
// Run:
//   node --test plugin/test/develop-red-set.test.mjs
//   bash scripts/test.sh --for-task gap-develop-red-set-writer --allow-thin

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  runMechanicalFanIn,
  parseFailureSignatures,
  developRedPoints,
  developRedKey,
  maintainDevelopRedSet,
  readDevelopRedSet,
  DEVELOP_RED_SET_REL,
} from "../scripts/worker-fan-in.ts";
import { applyDevelopRedObservation } from "../scripts/worker-driver.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const FF_MERGE_MODULE = path.join(REPO, "packages", "quay", "src", "fan-in", "ff-merge.ts");
const SLOT_LIB = path.join(REPO, "plugin", "scripts", "suite-slot-lib.sh");
const SCRIPTS = path.join(REPO, "plugin", "scripts");

const CODE_FILE = "src/feature.js";

// ── log fixtures (same shapes the real parser sees) ─────────────────────────────────────────────────
/** `__PERFILE__` marker + AssertionError (file-level red, assertion BODY carries the numbers). */
function redLog(file, assertion) {
  return `__PERFILE__ duration_ms=1 ${file} passed=false end_ms=1\n  AssertionError [ERR_ASSERTION]: ${assertion}\n`;
}
/** node spec reporter: `test at <file>:N:C` + `✖ <test name> (<ms>)`. */
function specLog(file, names) {
  return names.map((n) => `test at ${file}:10:1\n✖ ${n} (12.5ms)\n`).join("");
}
function emit(log, code) {
  const args = log.split("\n").map((l) => `'${l.replace(/'/g, `'\\''`)}'`).join(" ");
  return ["bash", "-c", `printf '%s\\n' ${args}; exit ${code}`];
}
function tmpRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `devredset-${tag}-`));
}
function obs({ develop, evaluatedAt, task = "gap-fixture-task", points = [], evaluatedFiles = [] }) {
  return { develop, evaluatedAt, task, points, evaluatedFiles };
}
function pt(file, name, signature = name) {
  return { key: `${file}::${name}`, file, signature };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC1 — the carrier has the contracted shape (develop / evaluatedAt / reds[] with every field)
// ════════════════════════════════════════════════════════════════════════════════════════════════════
test("AC1 — the written carrier carries develop / evaluatedAt / reds[] with every contracted field", () => {
  const root = tmpRoot("shape");
  const set = maintainDevelopRedSet(null, obs({
    develop: "a".repeat(40), evaluatedAt: "2026-10-27T00:00:00.000Z",
    points: [pt("plugin/test/a.test.mjs", "AC1 — first")],
    evaluatedFiles: ["plugin/test/a.test.mjs"],
  }), { developAdvanced: true });
  assert.deepEqual(set.reds[0], {
    key: "plugin/test/a.test.mjs::AC1 — first",
    files: ["plugin/test/a.test.mjs"],
    firstSeenAt: "2026-10-27T00:00:00.000Z",
    lastSeenAt: "2026-10-27T00:00:00.000Z",
    blockedTasks: ["gap-fixture-task"],
    lastSignature: "AC1 — first",
  });
  // …and it survives a real disk round-trip at the contracted path.
  const res = applyDevelopRedObservation({ root, observation: obs({
    develop: "a".repeat(40), evaluatedAt: "2026-10-27T00:00:00.000Z",
    points: [pt("plugin/test/a.test.mjs", "AC1 — first")],
    evaluatedFiles: ["plugin/test/a.test.mjs"],
  }) });
  assert.equal(res.written, true, `write failed: ${res.reason}`);
  const file = path.join(root, DEVELOP_RED_SET_REL);
  assert.ok(fs.existsSync(file), `carrier must exist at ${DEVELOP_RED_SET_REL}`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(typeof raw.develop, "string");
  assert.equal(typeof raw.evaluatedAt, "string");
  assert.ok(Array.isArray(raw.reds) && raw.reds.length === 1);
  for (const k of ["key", "files", "firstSeenAt", "lastSeenAt", "blockedTasks", "lastSignature"]) {
    assert.ok(k in raw.reds[0], `reds[] entry is missing ${k}`);
  }
  // The reader agrees (three-valued: present-and-valid ⇒ evaluated:true).
  const read = readDevelopRedSet(root);
  assert.equal(read.evaluated, true);
  assert.deepEqual(read.set, set);
  fs.rmSync(root, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC2 — the key is `<test file>::<test name>`; the assertion body only goes into lastSignature
// ════════════════════════════════════════════════════════════════════════════════════════════════════
test("AC2 — key = file::test name; the assertion body (ratchet numbers) never enters the key, only lastSignature", () => {
  // (a) spec reporter: the test name IS the identity — the duration must not survive into the key.
  const spec = parseFailureSignatures(specLog("plugin/test/x.test.mjs", ["AC3 — gate is closed"]), "/wt");
  assert.equal(spec.evaluated, true);
  const specPoints = developRedPoints(spec.signatures);
  assert.deepEqual(specPoints.map((p) => p.key), ["plugin/test/x.test.mjs::AC3 — gate is closed"]);
  assert.doesNotMatch(specPoints[0].key, /12\.5ms/, "the duration must never reach the identity");

  // (b) file-level marker: the assertion body ("1642→1688") is a NUMBER that moves between rounds, so it
  // must live in lastSignature only. Were it part of the key, a still-red ratchet would look like
  // "old key gone + new key arrived" ⇒ a false re-dispatch (the exact failure this AC protects).
  const marker = parseFailureSignatures(
    redLog("plugin/test/ratchet.test.mjs", "expected 1642 to equal 1688"), "/wt",
  );
  assert.equal(marker.evaluated, true);
  const mPoints = developRedPoints(marker.signatures);
  assert.deepEqual(mPoints.map((p) => p.key), ["plugin/test/ratchet.test.mjs::"]);
  assert.match(mPoints[0].signature, /1642 to equal 1688/, "the body must be preserved as the reference field");
  assert.doesNotMatch(mPoints[0].key, /1642|1688/, "the assertion body must NOT be part of the key");

  // (c) the same test name with a DIFFERENT error code keeps ONE key (code is reference, not identity).
  const withCode = parseFailureSignatures(
    "test at plugin/test/y.test.mjs:1:1\n✖ AC5 — boom (3ms)\n  code: 'ERR_STRING_TOO_LONG'\n", "/wt",
  );
  assert.equal(withCode.evaluated, true);
  assert.deepEqual(developRedPoints(withCode.signatures).map((p) => p.key), ["plugin/test/y.test.mjs::AC5 — boom"]);
  assert.match(developRedPoints(withCode.signatures)[0].signature, /code: ERR_STRING_TOO_LONG/);
  assert.equal(
    developRedKey({ file: "f.mjs", text: "AC5 — boom [code: ERR_OTHER]", name: "AC5 — boom" }),
    developRedKey({ file: "f.mjs", text: "AC5 — boom", name: "AC5 — boom" }),
  );
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC3 — red ⇒ upsert; green (actually re-run on develop, develop advanced) ⇒ remove; no stale keys
//        …with BOTH negative controls (file not re-run / develop not advanced ⇒ keep)
// ════════════════════════════════════════════════════════════════════════════════════════════════════
test("AC3 — red upserts the key; a real green removes it (and the file stops carrying it)", () => {
  const root = tmpRoot("maint");
  const D1 = "1".repeat(40);
  const D2 = "2".repeat(40);
  const k1 = pt("plugin/test/a.test.mjs", "AC1 — a");
  const k2 = pt("plugin/test/b.test.mjs", "AC2 — b");

  // round 1 — develop has two reds.
  let res = applyDevelopRedObservation({ root, observation: obs({
    develop: D1, evaluatedAt: "2026-10-27T00:00:00.000Z", points: [k1, k2],
    evaluatedFiles: ["plugin/test/a.test.mjs", "plugin/test/b.test.mjs"],
  }) });
  assert.equal(res.written, true);
  assert.equal(res.reds, 2);

  // round 2 — same develop, both still red: still two, lastSeenAt moves, firstSeenAt does not.
  res = applyDevelopRedObservation({ root, observation: obs({
    develop: D1, evaluatedAt: "2026-10-27T01:00:00.000Z", points: [k1, k2],
    evaluatedFiles: ["plugin/test/a.test.mjs", "plugin/test/b.test.mjs"],
  }) });
  let cur = readDevelopRedSet(root).set;
  assert.equal(cur.reds.length, 2);
  assert.equal(cur.reds[0].firstSeenAt, "2026-10-27T00:00:00.000Z");
  assert.equal(cur.reds[0].lastSeenAt, "2026-10-27T01:00:00.000Z");

  // round 3 — develop advanced, a.test.mjs was re-run and is green there ⇒ its key is REMOVED.
  res = applyDevelopRedObservation({
    root,
    observation: obs({
      develop: D2, evaluatedAt: "2026-10-27T02:00:00.000Z", points: [k2],
      evaluatedFiles: ["plugin/test/a.test.mjs", "plugin/test/b.test.mjs"],
    }),
    isAncestor: (a, b) => a === D1 && b === D2,
  });
  assert.equal(res.written, true);
  cur = readDevelopRedSet(root).set;
  assert.deepEqual(cur.reds.map((e) => e.key), [k2.key], "the disappeared key must be gone from the file");
  assert.equal(cur.develop, D2);
  fs.rmSync(root, { recursive: true, force: true });
});

test("AC3 negative control (file not re-run) — a key whose file was NOT evaluated this round is KEPT", () => {
  const D1 = "1".repeat(40);
  const D2 = "2".repeat(40);
  const k1 = pt("plugin/test/a.test.mjs", "AC1 — a");
  const k2 = pt("plugin/test/b.test.mjs", "AC2 — b");
  const prev = maintainDevelopRedSet(null, obs({
    develop: D1, evaluatedAt: "2026-10-27T00:00:00.000Z", points: [k1, k2],
    evaluatedFiles: ["plugin/test/a.test.mjs", "plugin/test/b.test.mjs"],
  }), { developAdvanced: true });

  // develop advanced and only b.test.mjs was re-run ⇒ a.test.mjs was never observed as green.
  const next = maintainDevelopRedSet(prev, obs({
    develop: D2, evaluatedAt: "2026-10-27T02:00:00.000Z", points: [k2],
    evaluatedFiles: ["plugin/test/b.test.mjs"],
  }), { developAdvanced: true });
  assert.deepEqual(next.reds.map((e) => e.key).sort(), [k1.key, k2.key].sort());
  // …and b, which WAS re-run and is still red, keeps its identity and refreshes lastSeenAt.
  assert.equal(next.reds.find((e) => e.key === k2.key).lastSeenAt, "2026-10-27T02:00:00.000Z");
});

test("AC3 negative control (develop did not advance) — nothing is removed when develop is not a descendant", () => {
  const D1 = "1".repeat(40);
  const D2 = "2".repeat(40);
  const k1 = pt("plugin/test/a.test.mjs", "AC1 — a");
  const prev = maintainDevelopRedSet(null, obs({
    develop: D2, evaluatedAt: "2026-10-27T00:00:00.000Z", points: [k1],
    evaluatedFiles: ["plugin/test/a.test.mjs"],
  }), { developAdvanced: true });

  // The baseline this round is an OLDER develop (rolled back / different base): "it passed here" says
  // nothing about the red disappearing on the recorded develop ⇒ the key must stay.
  const next = maintainDevelopRedSet(prev, obs({
    develop: D1, evaluatedAt: "2026-10-27T02:00:00.000Z", points: [],
    evaluatedFiles: ["plugin/test/a.test.mjs"],
  }), { developAdvanced: false });
  assert.deepEqual(next.reds.map((e) => e.key), [k1.key]);
});

test("AC3 — unreadable carrier is NOT treated as an empty red set (the write is refused, nothing is lost)", () => {
  const root = tmpRoot("corrupt");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const file = path.join(root, DEVELOP_RED_SET_REL);
  fs.writeFileSync(file, "{ this is not json", "utf8");
  const res = applyDevelopRedObservation({ root, observation: obs({
    develop: "1".repeat(40), evaluatedAt: "2026-10-27T00:00:00.000Z", points: [],
    evaluatedFiles: ["plugin/test/a.test.mjs"],
  }) });
  assert.equal(res.written, false);
  assert.match(String(res.reason), /carrier-unreadable/);
  assert.equal(fs.readFileSync(file, "utf8"), "{ this is not json", "a carrier we cannot read must not be overwritten");
  // ⛔ missing file is a legitimate first round (distinct from unreadable).
  const fresh = tmpRoot("fresh");
  assert.deepEqual(readDevelopRedSet(fresh), { evaluated: false, reason: "missing-file" });
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(fresh, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC4 — the writer is the driver process only; the read path writes nothing
// ════════════════════════════════════════════════════════════════════════════════════════════════════
test("AC4 — `writeDevelopRedSet` has exactly ONE production call site, and it is worker-driver.ts", () => {
  const callSites = [];
  for (const name of fs.readdirSync(SCRIPTS).filter((f) => f.endsWith(".ts"))) {
    const body = fs.readFileSync(path.join(SCRIPTS, name), "utf8");
    body.split("\n").forEach((line, i) => {
      if (!line.includes("writeDevelopRedSet(")) return;
      if (/^\s*(export\s+)?function\s+writeDevelopRedSet\s*\(/.test(line)) return; // the definition
      callSites.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.equal(callSites.length, 1, `expected exactly one write call site, got:\n${callSites.join("\n")}`);
  assert.match(callSites[0], /^worker-driver\.ts:/, `the sole writer must be worker-driver.ts, got ${callSites[0]}`);
});

test("AC4 (read side) — reading the carrier writes nothing: bytes, mtime and directory listing are unchanged", () => {
  const root = tmpRoot("readonly");
  const D1 = "1".repeat(40);
  applyDevelopRedObservation({ root, observation: obs({
    develop: D1, evaluatedAt: "2026-10-27T00:00:00.000Z", points: [pt("plugin/test/a.test.mjs", "AC1 — a")],
    evaluatedFiles: ["plugin/test/a.test.mjs"],
  }) });
  const file = path.join(root, DEVELOP_RED_SET_REL);
  const before = {
    bytes: fs.readFileSync(file, "utf8"),
    mtime: fs.statSync(file).mtimeMs,
    entries: fs.readdirSync(path.join(root, ".quay")).sort(),
  };
  const read = readDevelopRedSet(root);
  assert.equal(read.evaluated, true);
  // The pure maintainer is also disk-free: calling it directly must not touch the carrier either.
  maintainDevelopRedSet(read.set, obs({
    develop: D1, evaluatedAt: "2026-10-27T03:00:00.000Z", points: [],
    evaluatedFiles: ["plugin/test/a.test.mjs"],
  }), { developAdvanced: true });
  assert.equal(fs.readFileSync(file, "utf8"), before.bytes, "the read path must not rewrite the carrier");
  assert.equal(fs.statSync(file).mtimeMs, before.mtime);
  assert.deepEqual(fs.readdirSync(path.join(root, ".quay")).sort(), before.entries, "the read path must not create files");
  fs.rmSync(root, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC4/AC3 (e2e) — the REAL fan-in produces the observation but does NOT write the carrier;
//                 the driver-side entry point is what persists it.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function write(cwd, rel, body) {
  const p = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf8");
}

function taskBody(task) {
  return [
    "---", `id: ${task}`, "title: develop-red-set fixture", "status: ready", "labels: []", "extra: {}", "---",
    "## Proposal", "fixture", "## Plan", "fixture", "## Touches", `- ${CODE_FILE}`, `- tasks/${task}.md`,
    "## Acceptance Criteria", "- [x] AC1 fixture", "## Definition of Done", "- [x] landed", "",
  ].join("\n");
}

function makeFixture(tag, task) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `devredset-e2e-${tag}-`));
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "wt");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "develop-red-set-test"]);
  git(repo, ["config", "user.email", "devredset@example.com"]);
  git(repo, ["branch", "-M", "develop"]);
  write(repo, "scripts/test.sh", "#!/usr/bin/env bash\nexit 0\n");
  write(repo, "plugin/scripts/runner-static-gate.ts", "// hermetic registry stub — empty registry\n");
  write(repo, `tasks/${task}.md`, taskBody(task));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  git(repo, ["checkout", "-q", "-b", "author"]);
  git(repo, ["worktree", "add", "-q", worktree, "-b", `task/${task}`, "develop"]);
  write(worktree, CODE_FILE, "export const feature = 1;\n");
  git(worktree, ["add", "-A"]);
  git(worktree, ["commit", "-q", "-m", "implement feature"]);
  return { base, repo, worktree, task, slotBase: path.join(base, "full-suite.lock"), capture: path.join(base, "suite.env") };
}

test("AC3/AC4 (e2e) — a REAL fan-in observes develop's red set, and only the driver-side writer persists it", async (t) => {
  const task = "gap-devredset-fixture";
  const fx = makeFixture("red", task);
  t.after(() => { try { fs.rmSync(fx.base, { recursive: true, force: true }); } catch { /* best-effort */ } });
  const RED_FILE = "plugin/test/preexisting.test.mjs";
  const MINE_FILE = "src/feature.test.mjs";
  const baseRed = redLog(RED_FILE, "still broken on develop");
  const mineRed = redLog(MINE_FILE, "my new test fails");
  const r = await runMechanicalFanIn({
    task,
    worktree: fx.worktree,
    root: fx.repo,
    runId: "devredset-e2e",
    mergeTarget: "develop",
    forceSuite: true,
    scriptsDir: path.join(REPO, "plugin", "scripts"),
    slotBase: fx.slotBase,
    slotLib: SLOT_LIB,
    silenceMs: 500,
    ffMergeModule: FF_MERGE_MODULE,
    suiteCapture: fx.capture,
    suiteLogFile: path.join(fx.base, "suite.log"),
    // The merged tree shows a pre-existing develop red AND one the task itself introduced; rerunning
    // those files on develop reproduces ONLY the pre-existing one.
    suiteCommand: emit(baseRed + mineRed, 1),
    rerunCommand: emit(baseRed, 1),
    baselineProvisionCommand: null,
    scopedGateCommand: ["true"],
    docCheckCommand: ["true"],
  });
  assert.equal(r.outcome, "red", `the task-introduced red must stay red (step=${r.step})`);
  const observation = r.baselineEquivalence?.developRedObservation;
  assert.ok(observation, `fan-in must carry the develop red-set observation, got ${JSON.stringify(r.baselineEquivalence)}`);
  assert.match(observation.develop, /^[0-9a-f]{40}$/, "the observation must name the develop SHA the rerun ran against");
  // ⛔ the carrier records what is red **on develop** — never the task's own new red.
  assert.deepEqual(observation.points.map((p) => p.key), [`${RED_FILE}::`],
    `only develop's own reds belong in the set, got ${JSON.stringify(observation.points)}`);
  assert.deepEqual([...observation.evaluatedFiles].sort(), [MINE_FILE, RED_FILE].sort());
  assert.equal(observation.task, task);
  // ⛔ observing is not writing: the fan-in itself must NOT have created the carrier (AC4).
  assert.equal(fs.existsSync(path.join(fx.repo, DEVELOP_RED_SET_REL)), false,
    "fan-in must only observe — the driver entry is the sole writer");

  // …and the driver-side entry point turns exactly that observation into the carrier.
  const applied = applyDevelopRedObservation({ root: fx.repo, worktree: fx.worktree, observation });
  assert.equal(applied.written, true, `driver-side write failed: ${applied.reason}`);
  const read = readDevelopRedSet(fx.repo);
  assert.equal(read.evaluated, true);
  assert.deepEqual(read.set.reds.map((e) => e.key), [`${RED_FILE}::`]);
  assert.deepEqual(read.set.reds[0].blockedTasks, [task], "the blocked task must be recorded on the red entry");
  assert.equal(read.set.develop, observation.develop);
});

test("AC3 (e2e, the REACHABILITY case) — the recorded red files are re-asked on develop; a green baseline removes them", async (t) => {
  const task = "gap-devredset-fixture-green";
  const fx = makeFixture("green", task);
  t.after(() => { try { fs.rmSync(fx.base, { recursive: true, force: true }); } catch { /* best-effort */ } });
  // A file that exists on develop and is recorded in the carrier as a current develop red.
  const OLD_FILE = "plugin/test/old.test.mjs";
  // ⛔ commit it on DEVELOP (the fixture's main checkout sits on `author` — committing there would make
  // the file invisible to the baseline worktree, and the union below would silently skip it).
  git(fx.repo, ["checkout", "-q", "develop"]);
  write(fx.repo, OLD_FILE, "// pre-existing red, recorded in the carrier\n");
  git(fx.repo, ["add", "-A"]);
  git(fx.repo, ["commit", "-q", "-m", "add the pre-existing red file"]);
  git(fx.repo, ["checkout", "-q", "author"]);
  git(fx.worktree, ["merge", "--no-edit", "develop"]);
  const before = git(fx.repo, ["rev-parse", "develop"]).trim();
  fs.mkdirSync(path.join(fx.repo, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(fx.repo, DEVELOP_RED_SET_REL), JSON.stringify({
    develop: before,
    evaluatedAt: "2026-10-27T00:00:00.000Z",
    reds: [{
      key: `${OLD_FILE}::`, files: [OLD_FILE],
      firstSeenAt: "2026-10-20T00:00:00.000Z", lastSeenAt: "2026-10-27T00:00:00.000Z",
      blockedTasks: ["gap-some-earlier-task"], lastSignature: "still broken on develop",
    }],
  }, null, 2), "utf8");

  const MINE_FILE = "plugin/test/mine.test.mjs";
  const r = await runMechanicalFanIn({
    task,
    worktree: fx.worktree,
    root: fx.repo,
    runId: "devredset-e2e-green",
    mergeTarget: "develop",
    forceSuite: true,
    scriptsDir: path.join(REPO, "plugin", "scripts"),
    slotBase: fx.slotBase,
    slotLib: SLOT_LIB,
    silenceMs: 500,
    ffMergeModule: FF_MERGE_MODULE,
    suiteCapture: fx.capture,
    suiteLogFile: path.join(fx.base, "suite.log"),
    suiteCommand: emit(redLog(MINE_FILE, "my new test fails"), 1),
    // The in-round rerun (on the TASK tree) still fails ⇒ the A/B is reached…
    rerunCommand: emit(redLog(MINE_FILE, "my new test fails"), 1),
    // …and on develop BOTH files are green: exit 0 with per-file pass markers (the real shape of a
    // green per-file rerun — no failure lines at all).
    baselineRerunCommand: emit(
      `__PERFILE__ duration_ms=1 ${MINE_FILE} passed=true end_ms=1\n__PERFILE__ duration_ms=1 ${OLD_FILE} passed=true end_ms=1\n`,
      0,
    ),
    baselineProvisionCommand: null,
    scopedGateCommand: ["true"],
    docCheckCommand: ["true"],
  });
  assert.equal(r.outcome, "red", "the task-introduced red must stay red");
  assert.equal(r.baselineEquivalence?.verdict?.kind, "hard-red");
  const observation = r.baselineEquivalence?.developRedObservation;
  assert.ok(observation, "a GREEN baseline rerun is an evaluated, zero-red observation — not 'could not read'");
  assert.deepEqual(observation.points, [], "nothing is red on develop any more");
  // ⛔ the reachability half: the carrier's own file was re-run alongside the task's failed file.
  assert.deepEqual([...observation.evaluatedFiles].sort(), [MINE_FILE, OLD_FILE].sort(),
    `the recorded red file must be re-asked on develop, got ${JSON.stringify(observation.evaluatedFiles)}`);

  // …and the driver-side writer turns that into a REMOVAL (the "red disappeared" signal).
  const applied = applyDevelopRedObservation({ root: fx.repo, worktree: fx.worktree, observation });
  assert.equal(applied.written, true, `driver-side write failed: ${applied.reason}`);
  const after = readDevelopRedSet(fx.repo);
  assert.equal(after.evaluated, true);
  assert.deepEqual(after.set.reds, [], "the disappeared key must be gone from the carrier");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC5 — a changed lastSignature (numbers move) does NOT change key identity
// ════════════════════════════════════════════════════════════════════════════════════════════════════
test("AC5 — a moved number in the assertion body keeps ONE key (no new key, firstSeenAt preserved)", () => {
  const D1 = "1".repeat(40);
  const D2 = "2".repeat(40);
  const first = parseFailureSignatures(redLog("plugin/test/ratchet.test.mjs", "expected 1642 to equal 1688"), "/wt");
  const second = parseFailureSignatures(redLog("plugin/test/ratchet.test.mjs", "expected 1642 to equal 1690"), "/wt");
  const s1 = maintainDevelopRedSet(null, obs({
    develop: D1, evaluatedAt: "2026-10-27T00:00:00.000Z",
    points: developRedPoints(first.signatures), evaluatedFiles: ["plugin/test/ratchet.test.mjs"],
  }), { developAdvanced: true });
  const s2 = maintainDevelopRedSet(s1, obs({
    develop: D2, evaluatedAt: "2026-10-27T01:00:00.000Z",
    points: developRedPoints(second.signatures), evaluatedFiles: ["plugin/test/ratchet.test.mjs"],
  }), { developAdvanced: true });
  assert.equal(s2.reds.length, 1, "a moved number must not manufacture a second key");
  assert.equal(s2.reds[0].key, "plugin/test/ratchet.test.mjs::");
  assert.equal(s2.reds[0].firstSeenAt, "2026-10-27T00:00:00.000Z", "firstSeenAt must survive a signature change");
  assert.equal(s2.reds[0].lastSeenAt, "2026-10-27T01:00:00.000Z");
  assert.match(s2.reds[0].lastSignature, /1690/, "the raw signature is refreshed as the reference field");
});
