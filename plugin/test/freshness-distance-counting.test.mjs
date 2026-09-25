// @test-group engine
// freshness-distance-counting.test.mjs — the AC-214 freshness CLOCK's counting-rule pin
// (tasks/gap-ac214-ninth-crossing-freshness-clock-counts-fan-in-merges, goals/AC-214-*.md).
//
// THE DEFECT THIS PINS. The AC-214 criterion measured "how old is this evidence" as
//   git rev-list --count <build_sha>..develop -- <delivery-face paths>
// With a pathspec that counts MERGE commits too, and this repo's fan-in topology makes
// `Merge branch 'develop' into task/<X>` (plus the `--no-ff` merge back into develop) a routine step
// of every landing. Those merges re-import content the parents' OWN non-merge commits already
// contributed, so the same change was counted up to three times. Measured on the production repo
// 2026-09-25 over `c80040ad..develop`: 203 total, 84 of them merges, 71 of those 84 byte-identical to
// the clean auto-merge of their two parents (zero independent content), 82/84 titled `Merge branch
// 'develop'`. The criterion's clock ran ~1.7x fast and the object under test could push it itself
// (硬规则 4) — the gap crossed for the ninth time because of it.
//
// THE RULE BEING PINNED. A commit counts iff it CHANGED DELIVERY-FACE CONTENT: every non-merge commit
// touching a delivery-face path, PLUS every merge whose own tree is NOT byte-identical to the clean
// auto-merge of its parents (`git merge-tree --write-tree`). ⛔ It is NOT "merges never count" — that
// assertion is not what makes the rule right, and this file's arm ① exists to make the difference
// takeable-false: a merge that genuinely carries independent content (both sides touched the same
// file ⇒ a human resolved a conflict) MUST still be counted.
//
// THE ARMS (each one is individually takeable-false; ⛔ a one-directional test is not a test):
//   ① a CONFLICT-resolved merge ⇒ counted            (fixture A: distance 4, not 3 — the
//                                                      "merges are never counted" fix would give 3)
//   ② a pure bookkeeping `merge develop` ⇒ NOT counted (fixture B: distance 2, naive 3)
//   ③ MUTATION: the implementation patched back to "every merge counts" ⇒ fixture B reads 3, so the
//      very assertion arm ② makes goes red (the mutation is asserted to have APPLIED, ⛔ not assumed)
//   ④ three states pairwise distinguishable: a computed 0 is NOT a null distance
//   ⑤ the DECLARATION is live: the criterion reads `delivery_face.command` out of
//      plugin/freshness-producers.json, so mutating that declaration changes its VERDICT (green ⇒ red
//      with the old rule) — mechanical proof that the rule is single-sourced rather than copied into
//      the goal text (and that a probe/criterion drift has a red somewhere)
//   ⑥ the probe's shown command line is rendered from the SAME declaration (drift ⇒ red)
//
// HERMETIC: every fixture is a throwaway git repo under os.tmpdir(); the production checkout, its
// carrier and its `develop` are never written. The only production reads are committed files
// (goals/AC-214-*.md, plugin/freshness-producers.json, plugin/probes/freshness-refresh.md) and the
// implementation itself, which arm ⑤ runs through a temp copy so it can mutate it.
//
// Run: scripts/test.sh plugin/test/freshness-distance-counting.test.mjs
//      node --test plugin/test/freshness-distance-counting.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import {
  classifyMergeContribution,
  deliveryFaceDistance,
  measureDeliveryFaceDistance,
} from "../scripts/freshness-producer-coverage-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const IMPL_REL = "plugin/scripts/freshness-producer-coverage-check.ts";
const MAPPING_REL = "plugin/freshness-producers.json";
const PROBE_REL = "plugin/probes/freshness-refresh.md";

const GIT_ID = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false"];
/** The delivery-face fragment every fixture commit touches (the tarball `files` entry). */
const DF = "packages/quay/src";

const TMP = [];
after(() => {
  for (const d of TMP) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});
function mkTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TMP.push(d);
  return d;
}

function git(root, args, opts = {}) {
  const r = spawnSync("git", [...GIT_ID, ...args], { cwd: root, encoding: "utf8", ...opts });
  return { code: r.status ?? 127, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

/** A commit touching `rel` with `body`. */
function commit(root, msg, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
  const add = git(root, ["add", "-A"]);
  assert.equal(add.code, 0, `git add failed: ${add.err}`);
  const c = git(root, ["commit", "-q", "-m", msg]);
  assert.equal(c.code, 0, `git commit failed (${msg}): ${c.err}`);
  return git(root, ["rev-parse", "HEAD"]).out;
}

/** A git repo whose delivery face is `packages/quay/src` (derived from package.json `files`). */
function newRepo() {
  const root = mkTmp("ac214-9th-");
  fs.mkdirSync(path.join(root, "packages", "quay", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "packages", "quay", "package.json"),
    JSON.stringify({ name: "quay", files: ["src"] }),
    "utf8",
  );
  assert.equal(git(root, ["init", "-q", "."]).code, 0);
  return root;
}

/**
 * Fixture A — a merge that GENUINELY carries independent content: both sides edit the same file, the
 * merge conflicts, a human resolves it. Its tree therefore has no clean auto-merge to equal.
 * `naive` = 4, `--no-merges` = 3 ⇒ the content merge is worth exactly 1 (arm ①).
 */
function fixtureContentMerge() {
  const root = newRepo();
  const a = commit(root, "A", `${DF}/x.txt`, "0\n");
  git(root, ["branch", "-M", "develop"]);
  git(root, ["checkout", "-q", "-b", "task-c"]);
  commit(root, "C1", `${DF}/x.txt`, "c\n");
  git(root, ["checkout", "-q", "develop"]);
  commit(root, "D1", `${DF}/x.txt`, "d\n");
  const conflicted = git(root, ["merge", "--no-edit", "task-c", "-m", "Merge branch 'task-c'"]);
  assert.notEqual(conflicted.code, 0, "fixture A must produce a real conflict (else the arm tests nothing)");
  commit(root, "resolve", `${DF}/x.txt`, "resolved\n"); // `git commit` finishes the merge
  commit(root, "D2", `${DF}/z.txt`, "2\n");
  return { root, base: a };
}

/**
 * Fixture B — the SHAPE OF THE DEFECT: a task branch that is itself a delivery-face change, merges
 * develop INTO itself (a bookkeeping merge, clean auto-merge == its own tree), then is merged back.
 * `naive` = 3, `--no-merges` = 2 ⇒ counting merges adds exactly 1 phantom (arm ②).
 */
function fixtureBookkeepingMerge() {
  const root = newRepo();
  const a = commit(root, "A", `${DF}/x.txt`, "0\n");
  git(root, ["branch", "-M", "develop"]);
  git(root, ["checkout", "-q", "-b", "task-b"]);
  commit(root, "B1", `${DF}/x.txt`, "b\n");
  git(root, ["checkout", "-q", "develop"]);
  commit(root, "D1", `${DF}/y.txt`, "1\n");
  git(root, ["checkout", "-q", "task-b"]);
  const m1 = git(root, ["merge", "--no-edit", "develop", "-m", "Merge branch 'develop' into task-b"]);
  assert.equal(m1.code, 0, `bookkeeping merge must apply cleanly: ${m1.err}`);
  git(root, ["checkout", "-q", "develop"]);
  const m2 = git(root, ["merge", "--no-edit", "--no-ff", "task-b", "-m", "Merge branch 'task-b'"]);
  assert.equal(m2.code, 0, `merge-back must apply cleanly: ${m2.err}`);
  return { root, base: a };
}

/** The `naive` count — the pre-2026-09-25 rule (merges included). The control every arm compares to. */
function naiveCount(root, base) {
  return Number(git(root, ["rev-list", "--count", `${base}..develop`, "--", DF]).out);
}

function runCli(root, extraArgs) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(REPO_ROOT, IMPL_REL), "--delivery-face-distance", "--root", root, ...extraArgs],
    { encoding: "utf8" },
  );
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  return { status: r.status, json, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ── the pure classification (the rule's whole decision surface) ─────────────────────────────────

test("pure: a merge whose tree equals the parents' clean auto-merge is bookkeeping; a conflict or an evil merge is content", () => {
  assert.equal(classifyMergeContribution({ cleanAutoMergeTree: "a".repeat(40), recordedTree: "a".repeat(40) }), "bookkeeping");
  assert.equal(
    classifyMergeContribution({ cleanAutoMergeTree: "a".repeat(40), recordedTree: "b".repeat(40) }),
    "content",
    "a clean auto-merge that differs from the recorded tree is an 'evil merge' — it carries content",
  );
  assert.equal(
    classifyMergeContribution({ cleanAutoMergeTree: null, recordedTree: "b".repeat(40) }),
    "content",
    "no clean auto-merge (conflict / non-two-parent merge) ⇒ counted, the conservative direction",
  );
});

test("pure: deliveryFaceDistance = content commits + merges carrying independent content", () => {
  const r = deliveryFaceDistance({
    contentCommits: 5,
    merges: [
      { cleanAutoMergeTree: "a".repeat(40), recordedTree: "a".repeat(40) }, // bookkeeping
      { cleanAutoMergeTree: null, recordedTree: "b".repeat(40) }, // conflict
      { cleanAutoMergeTree: "c".repeat(40), recordedTree: "d".repeat(40) }, // evil merge
    ],
  });
  assert.deepEqual(r, { distance: 7, contentMerges: 2, bookkeepingMerges: 1 });
});

// ── ① a real conflict-resolved merge MUST still be counted ──────────────────────────────────────

test("① a conflict-resolved merge (independent content) IS counted — distance 4, not 3", () => {
  const { root, base } = fixtureContentMerge();
  const rep = measureDeliveryFaceDistance({ root, from: base });
  assert.equal(rep.state, "computed", rep.reason);
  assert.equal(rep.contentMerges, 1, "the conflicted merge must be classified as carrying content");
  assert.equal(rep.bookkeepingMerges, 0);
  // The falsifiable half: a "merges never count" fix — the wrong way to close the ninth crossing —
  // reads 3 here. This line is what makes that wrongness takeable-false.
  assert.equal(rep.distance, rep.contentCommits + 1);
  assert.equal(rep.distance, 4, `expected 4 (3 non-merge + 1 content merge), got ${rep.distance}`);
  assert.notEqual(rep.distance, naiveCount(root, base) - 1, "distance must NOT be the naive count minus the merge");
});

// ── ② a pure bookkeeping merge MUST NOT be counted ──────────────────────────────────────────────

test("② a bookkeeping `merge develop` into a task branch is NOT counted — distance 2, naive 3", () => {
  const { root, base } = fixtureBookkeepingMerge();
  const naive = naiveCount(root, base);
  assert.equal(naive, 3, `fixture must exhibit the phantom (naive 3, got ${naive})`);
  const rep = measureDeliveryFaceDistance({ root, from: base });
  assert.equal(rep.state, "computed", rep.reason);
  assert.equal(rep.contentMerges, 0, "the bookkeeping merge must NOT be counted");
  assert.equal(rep.bookkeepingMerges, 1);
  assert.equal(rep.distance, 2, `expected 2 (the two non-merge delivery commits), got ${rep.distance}`);
  assert.notEqual(rep.distance, naive, "the new rule must differ from the naive one on THIS shape");
});

// ── ③ mutation: patch the implementation back to "every merge counts" ⇒ arm ② goes red ─────────

test("③ MUTATION (the old rule restored) ⇒ the same fixture reads the phantom again", () => {
  const { root, base } = fixtureBookkeepingMerge();
  const src = fs.readFileSync(path.join(REPO_ROOT, IMPL_REL), "utf8");
  const mutated = src.replace(
    /[ \t]*if \(input\.cleanAutoMergeTree === null\) return "content";\n[ \t]*return input\.cleanAutoMergeTree === input\.recordedTree \? "bookkeeping" : "content";\n/,
    '  return "content"; // MUTANT: the pre-2026-09-25 rule — every merge counted\n',
  );
  // ⛔ Assert the mutation APPLIED. A mutation that silently stops matching turns the control into a
  // no-op that reports green forever (硬规则 3b's mirror).
  assert.notEqual(mutated, src, "the mutation anchor no longer matches — the control would be vacuous");
  assert.ok(mutated.includes("MUTANT"), "the mutation must leave its marker in the source");

  const dir = mkTmp("ac214-9th-mutant-");
  fs.writeFileSync(path.join(dir, "freshness-producer-coverage-check.ts"), mutated, "utf8");
  // Its only relative import — copied beside it so the mutant is runnable without touching the tree.
  fs.copyFileSync(
    path.join(REPO_ROOT, "plugin", "scripts", "gate-script-base.ts"),
    path.join(dir, "gate-script-base.ts"),
  );

  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(dir, "freshness-producer-coverage-check.ts"),
      "--delivery-face-distance", "--from", base, "--root", root, "--json"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, `mutant CLI failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert.equal(j.distance, 3, `the mutated rule must read the naive 3 (phantom restored), got ${j.distance}`);
  assert.equal(j.contentMerges, 1, "under the mutation the bookkeeping merge is miscounted as content");
  // ⇒ arm ②'s `distance === 2` assertion goes RED under this mutation. That is the whole point.
  assert.notEqual(j.distance, 2);
});

// ── ④ three states, pairwise distinguishable (硬规则 3b) ────────────────────────────────────────

test("④ a computed 0 is distinct from a null distance: computed / empty-path-set / not-evaluated", () => {
  const { root, base } = fixtureContentMerge();
  const tip = git(root, ["rev-parse", "develop"]).out;

  // computed, and 0 is a LEGAL reading (the evidence IS the tip).
  const zero = runCli(root, ["--from", tip, "--json"]);
  assert.equal(zero.status, 0);
  assert.equal(zero.json.state, "computed");
  assert.equal(zero.json.distance, 0, "0 must be reachable — anything else conflates 'fresh' with 'unmeasured'");

  // not-evaluated: an unreadable rev. distance is null, ⛔ never 0, and the exit code is 3.
  const bad = runCli(root, ["--from", "0".repeat(40), "--json"]);
  assert.equal(bad.status, 3, `an unreadable rev must exit 3, got ${bad.status} (stderr=${bad.stderr})`);
  assert.equal(bad.json.state, "not-evaluated");
  assert.equal(bad.json.distance, null);

  // empty-path-set: a distance over an empty derived path set would be structurally 0 ⇒ its own state.
  const emptyRoot = mkTmp("ac214-9th-empty-");
  assert.equal(git(emptyRoot, ["init", "-q", "."]).code, 0);
  const empty = runCli(emptyRoot, ["--from", base, "--json"]);
  assert.equal(empty.status, 3, `an empty path set must exit 3, got ${empty.status}`);
  assert.equal(empty.json.state, "empty-path-set");
  assert.equal(empty.json.distance, null);

  // The three are pairwise distinct in BOTH dimensions a reader might use.
  const states = [zero.json.state, bad.json.state, empty.json.state];
  assert.equal(new Set(states).size, 3, `states must be pairwise distinct: ${states.join(", ")}`);
  assert.notEqual(bad.json.distance, zero.json.distance);
  assert.notEqual(empty.json.distance, zero.json.distance);
});

// ── ⑤ the DECLARATION is live: mutating it changes the criterion's VERDICT ──────────────────────

/** AC-214's criterion, read out of the goal store — ⛔ never re-typed here (that is the drift class). */
function realAc214Criterion() {
  const files = fs.readdirSync(path.join(REPO_ROOT, "goals")).filter((f) => f.startsWith("AC-214-") && f.endsWith(".md"));
  assert.equal(files.length, 1, `AC-214 must be uniquely locatable (found ${files.length})`);
  const raw = fs.readFileSync(path.join(REPO_ROOT, "goals", files[0]), "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  assert.ok(m, `${files[0]} has no YAML frontmatter`);
  const fm = YAML.parse(m[1]);
  assert.ok(typeof fm.criterion === "string" && fm.criterion.trim() !== "", "criterion must be a non-empty string");
  return fm.criterion;
}

/** The subject set, taken from the criterion's own `NEED` line (⛔ never a hand-written copy). */
function needIds(criterion) {
  const line = criterion.split("\n").find((l) => l.trim().startsWith("NEED = ["));
  assert.ok(line, "the criterion must carry a `NEED = [...]` line");
  const ids = [...line.matchAll(/"GOAL-009-AC-(\d+)"/g)].map((m) => `GOAL-009-AC-${m[1]}`);
  assert.ok(ids.length > 0, "NEED must not be empty");
  return ids;
}

const CRITERION = realAc214Criterion();
const NEED_IDS = needIds(CRITERION);

/**
 * A runnable workspace for the real criterion: a git repo whose delivery face is `packages/quay/src`,
 * a carrier holding one record per NEED subject, the REAL `goals/` and `plugin/scripts/` (symlinked, so
 * the criterion and the implementation under test are the shipped ones), and a `plugin/freshness-producers.json`
 * copy whose `delivery_face.command` the caller controls.
 */
function criterionWorkspace(mappingOverride) {
  const { root, base } = fixtureBookkeepingMerge();
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "productization-verification.jsonl"),
    NEED_IDS.map((id) => JSON.stringify({ ac: id, ts: "2026-09-25T00:00:00Z", build_sha: base })).join("\n") + "\n",
    "utf8",
  );
  fs.symlinkSync(path.join(REPO_ROOT, "goals"), path.join(root, "goals"));
  fs.mkdirSync(path.join(root, "plugin"), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, "plugin", "scripts"), path.join(root, "plugin", "scripts"));
  const mapping = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, MAPPING_REL), "utf8"));
  if (mappingOverride) mappingOverride(mapping);
  fs.writeFileSync(path.join(root, "plugin", MAPPING_REL.split("/").pop()), JSON.stringify(mapping, null, 2), "utf8");
  return { root, base };
}

function runCriterion(root, k) {
  const r = spawnSync("bash", ["-c", CRITERION], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, QUAY_GOAL009_FRESHNESS_K: String(k) },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

test("⑤ the criterion DERIVES its rule from `delivery_face.command` — mutate the declaration, move the verdict", () => {
  // (a) the criterion carries no second implementation: only a DELEGATION to the declared argv.
  assert.ok(CRITERION.includes("delivery_face"), "the criterion must read the declaration");
  assert.ok(/subprocess\.run\(DCMD/.test(CRITERION), "the criterion must exec the declared argv");
  assert.ok(!CRITERION.includes('"rev-list"'), "⛔ the criterion must not run git itself — that is the copied rule");

  // (b) GREEN with the shipped declaration. Fixture B's distance is 2 (arm ②), so K=2 keeps it inside
  //     the window while the naive rule (3) would not — the separation is what the next arm exploits.
  const green = criterionWorkspace(null);
  const okRun = runCriterion(green.root, 2);
  assert.equal(okRun.status, 0, `real declaration must give exit 0 (stderr=${okRun.stderr}, stdout=${okRun.stdout})`);
  assert.equal(okRun.stdout.trim().split("\n").length, NEED_IDS.length, "one freshness line per NEED subject");

  // (c) RED under a MUTATED declaration naming the pre-2026-09-25 rule (every merge counted ⇒ d=3 > K=2).
  //     The ONLY difference between (b) and (c) is the declaration ⇒ the criterion's verdict is driven
  //     by it, i.e. the rule really is single-sourced. (This is also the DoD's "put the old rule back
  //     ⇒ the same command exits 1" mutation, run through the criterion itself rather than around it.)
  const src = fs.readFileSync(path.join(REPO_ROOT, IMPL_REL), "utf8");
  const mutated = src.replace(
    /[ \t]*if \(input\.cleanAutoMergeTree === null\) return "content";\n[ \t]*return input\.cleanAutoMergeTree === input\.recordedTree \? "bookkeeping" : "content";\n/,
    '  return "content"; // MUTANT\n',
  );
  assert.notEqual(mutated, src, "mutation anchor drifted");
  const dir = mkTmp("ac214-9th-mutant5-");
  fs.writeFileSync(path.join(dir, "freshness-producer-coverage-check.ts"), mutated, "utf8");
  fs.copyFileSync(path.join(REPO_ROOT, "plugin", "scripts", "gate-script-base.ts"), path.join(dir, "gate-script-base.ts"));
  const red = criterionWorkspace((m) => {
    m.delivery_face.command = [
      process.execPath,
      "--experimental-strip-types",
      path.join(dir, "freshness-producer-coverage-check.ts"),
      "--delivery-face-distance",
    ];
  });
  const badRun = runCriterion(red.root, 2);
  assert.equal(badRun.status, 1, `the old rule must go RED (stderr=${badRun.stderr}, stdout=${badRun.stdout})`);
  assert.match(badRun.stderr, /stale evidence:/, "a red must say WHY (attributable failure exit)");
  assert.match(badRun.stderr, /:3\/2 \(margin -1\)/, `the red must name the phantom distance: ${badRun.stderr}`);
});

// ── ⑥ the probe's command line comes from the SAME declaration ──────────────────────────────────

test("⑥ the probe's shown command is rendered from `delivery_face.command` (drift ⇒ red)", () => {
  const mapping = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, MAPPING_REL), "utf8"));
  const argv = mapping.delivery_face.command;
  assert.ok(Array.isArray(argv) && argv.length > 0, "delivery_face.command must be a non-empty argv array");
  const rendered = argv.join(" ");
  const probe = fs.readFileSync(path.join(REPO_ROOT, PROBE_REL), "utf8");
  assert.ok(
    probe.includes(rendered),
    `the probe must show the declared command verbatim; it does not contain:\n  ${rendered}`,
  );
  // ⛔ and must not still teach the OLD rule (merge-inclusive rev-list) — that is the drift direction
  // that matters here: a probe computing R on a different clock than the criterion measures it with.
  assert.ok(!probe.includes("rev-list --count"), "the probe must not hand-roll the pre-2026-09-25 count");
  // The declaration's own materialised form must be runnable as written: the script it names exists.
  assert.ok(fs.existsSync(path.join(REPO_ROOT, argv[argv.indexOf("--delivery-face-distance") - 1])), "declared script must exist");
});
