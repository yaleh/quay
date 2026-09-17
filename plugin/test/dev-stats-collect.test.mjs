// dev-stats-collect.test.mjs — the guard for the README dev-stats producer
// (plugin/scripts/dev-stats-collect.ts, GOAL-021 / AC-277,
// tasks/gap-dev-stats-collect-from-production-carriers).
//
// WHAT IT PROVES (and what it deliberately does NOT):
//   ⛔ it does NOT assert `live carrier == README value`. The live carriers move every commit, so
//      such an assertion would be a **permanently red** check (and, worse, a check whose red says
//      nothing about the code). Everything here runs against a **hermetic git fixture** built in a
//      temp dir, with fixed commit dates ⇒ every expected value is exact and reproducible.
//   ✅ it asserts the MECHANISM, with a built-in **negative control** (a tampered block must be
//      judged FAIL), so the test can falsify itself without a human reading it:
//        1. collectStats(fixture, ref) yields the exact expected values, including a goal file whose
//           name is non-ASCII (the `core.quotepath` trap: quoted paths silently drop out of an
//           `.endsWith(".md")` filter — measured 157 goals counted as 70 before the fix);
//        2. **ref-pinning**: the same ref reads the SAME values after the repo has moved on (this is
//           what keeps AC-277 satisfiable instead of reddening on the next commit), while a NEW ref
//           reads the new values;
//        3. the omitted-key rule: 0 and single-digit counts are absent from `--json` (a `0`/`3` is a
//           substring of something else in the block ⇒ such a key could never be judged missing);
//        4. render → parse → compare round-trips, and a TAMPERED block is judged not-ok (缺失键被
//           列出) — the negative control;
//        5. a malformed block (marker without its partner) is a DISTINCT state from "no block"
//           (硬规则 3b: 读不懂 ≠ 没有) and `--check` exits 2, never 0;
//        6. `--write` is idempotent (two runs ⇒ byte-identical README) and `--check` then exits 0,
//           while a tampered value makes `--check` exit 1 with `CAUSE=stats-drift` on stderr.
//
// Run:
//   scripts/test.sh plugin/test/dev-stats-collect.test.mjs
//   node --no-warnings --experimental-strip-types --test plugin/test/dev-stats-collect.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  MARK_START,
  MARK_END,
  REF_LINE_PREFIX,
  INSERT_ANCHOR,
  collectStats,
  renderBlock,
  parseBlock,
  compareBlock,
  writeBlockInto,
} from "../scripts/dev-stats-collect.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "dev-stats-collect.ts");
const README = "README.md";
const TMP = [];

after(() => {
  for (const d of TMP) fs.rmSync(d, { recursive: true, force: true });
});

// ── fixture plumbing ────────────────────────────────────────────────────────────────
// Git identity goes in the CHILD ENV, never in repo config (an empty `user.email` in the ambient
// env silently punches through repo config). Dates are pinned so `history_days`/`snapshot_date`
// are exact instead of wall-clock derived.

function gitEnv(iso) {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "dev-stats-fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "dev-stats-fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  };
}

function run(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, env: env ?? process.env, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")} failed (status=${r.status}): ${r.stderr}`);
  return r.stdout;
}

function commitAll(dir, msg, iso) {
  run("git", ["add", "-A"], dir);
  run("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", msg], dir, gitEnv(iso));
  return run("git", ["rev-parse", "HEAD"], dir).trim();
}

/** `2026-01-<n>` as an ISO instant — commit i lands on day i. */
function day(n) {
  return `2026-01-${String(n).padStart(2, "0")}T00:00:00Z`;
}

/**
 * Build the hermetic fixture: 11 commits (day 1..11), commit 1 carrying every carrier.
 * Counts are chosen to exercise BOTH sides of the omitted-key rule:
 *   kept (>= 2 digits): tasks_total 12, tasks_done 11, scripts_total 10, goals_total 10
 *   omitted:            tasks_todo 1 (< 10), contributors_total 1 (< 10), history_days 0 at ref1
 */
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-stats-fixture-"));
  TMP.push(dir);
  run("git", ["init", "-q", "-b", "main"], dir);
  for (const d of ["tasks", "goals", "plugin/scripts", "notes"]) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  }
  fs.writeFileSync(
    path.join(dir, README),
    `# fixture repo\n\nintro\n\n${INSERT_ANCHOR}\n\n\nbody\n`,
  );
  for (let i = 0; i < 11; i++) {
    fs.writeFileSync(path.join(dir, "tasks", `task-${String(i).padStart(2, "0")}.md`), `---\nstatus: done\n---\n\nbody\n`);
  }
  fs.writeFileSync(path.join(dir, "tasks", "task-11.md"), "---\nstatus: todo\n---\n\nbody\n");
  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(path.join(dir, "plugin", "scripts", `s${String(i).padStart(2, "0")}.ts`), `// s${i}\n`);
  }
  for (let i = 0; i < 9; i++) {
    fs.writeFileSync(path.join(dir, "goals", `AC-${i}-ascii.md`), `# goal ${i}\n`);
  }
  // ⚠️ the non-ASCII name: `git ls-tree` quotes it unless core.quotepath=false.
  fs.writeFileSync(path.join(dir, "goals", "AC-9-中文名-机械判定.md"), "# goal 9\n");
  const refs = [commitAll(dir, "day 1", day(1))];
  for (let i = 2; i <= 11; i++) {
    fs.writeFileSync(path.join(dir, "notes", `n${i}.txt`), `${i}\n`);
    refs.push(commitAll(dir, `day ${i}`, day(i)));
  }
  return { dir, refs };
}

const FIX = makeFixture();
const REF1 = FIX.refs[0]; // day 1 — carriers exist, 1 commit, history_days 0
const REF11 = FIX.refs[10]; // day 11 — 11 commits, history_days 10

const EXPECTED_REF11 = {
  snapshot_date: "2026-01-11",
  history_days: 10,
  tasks_total: 12,
  tasks_done: 11,
  commits_total: 11,
  scripts_total: 10,
  goals_total: 10,
};

// ── 1. exact readings on a pinned commit ────────────────────────────────────────────

test("collectStats reads the tracked carriers at the named commit", () => {
  assert.deepEqual(collectStats(FIX.dir, REF11), EXPECTED_REF11);
});

test("collectStats counts non-ASCII goal filenames (core.quotepath trap)", () => {
  // 10 goal files exist, ONE of them non-ASCII. Counting 9 would mean the quoted form of
  // `AC-9-中文名-机械判定.md` was silently dropped by the `.endsWith(".md")` filter.
  assert.equal(collectStats(FIX.dir, REF11).goals_total, 10);
});

test("zero and single-digit counts are omitted (a 1-char value can never be judged missing)", () => {
  const at1 = collectStats(FIX.dir, REF1);
  assert.equal(at1.tasks_todo, undefined, "tasks_todo=1 must be omitted");
  assert.equal(at1.contributors_total, undefined, "contributors_total=1 must be omitted");
  assert.equal(at1.history_days, undefined, "history_days=0 must be omitted");
  assert.equal(at1.snapshot_date, "2026-01-01");
  assert.equal(at1.commits_total, undefined, "commits_total=1 must be omitted");
  assert.equal(at1.tasks_done, 11, "11 IS reported (two digits) — the rule is not a blanket drop");
  for (const [k, v] of Object.entries(at1)) {
    if (typeof v === "number") assert.ok(Math.abs(v) >= 10, `${k}=${v} should not have been reported`);
  }
});

// ── 2. ref-pinning: the property that keeps AC-277 satisfiable ──────────────────────

test("a pinned commit keeps reading the same values after the repo moves on", () => {
  // Snapshot BEFORE the new commit, then re-read AFTER it: identical. This is what makes the
  // README block stable (and therefore the criterion satisfiable) instead of reddening on the
  // next commit — while a NEW ref still reads the new values, so the readings do track reality.
  const before = collectStats(FIX.dir, REF11);
  fs.writeFileSync(path.join(FIX.dir, "notes", "after.txt"), "after\n");
  const ref12 = commitAll(FIX.dir, "day 12", day(12));
  assert.deepEqual(collectStats(FIX.dir, REF11), before, "pinned ref must not drift");
  assert.deepEqual(collectStats(FIX.dir, ref12), {
    ...EXPECTED_REF11,
    snapshot_date: "2026-01-12",
    history_days: 11,
    commits_total: 12,
  });
});

// ── 3. render / parse / compare + the negative control ──────────────────────────────

test("renderBlock round-trips through parseBlock and compareBlock", () => {
  const stats = collectStats(FIX.dir, REF11);
  const block = renderBlock(stats, REF11);
  const parsed = parseBlock(`before\n${block}\nafter\n`);
  assert.equal(parsed.found, true);
  assert.equal(parsed.commit, REF11);
  assert.deepEqual(parsed.entries.tasks_total, "12");
  assert.deepEqual(compareBlock(stats, parsed.text), { ok: true, missing: [], extra: [] });
});

test("NEGATIVE CONTROL — a tampered block is judged not-ok, with the key named", () => {
  const stats = { tasks_total: 987654, goals_total: 12345678, snapshot_date: "2026-01-11" };
  const good = renderBlock(stats, REF11);
  assert.equal(compareBlock(stats, parseBlock(`x\n${good}\n`).text).ok, true);

  const tampered = good.replace("- tasks_total: 987654", "- tasks_total: 100000");
  const cmp = compareBlock(stats, parseBlock(`x\n${tampered}\n`).text);
  assert.equal(cmp.ok, false, "a tampered value must be judged red");
  assert.deepEqual(cmp.missing, ["tasks_total"]);
});

test("NEGATIVE CONTROL — a dropped line is drift too (missing), a renamed key is drift (extra)", () => {
  const stats = { tasks_total: 987654, goals_total: 12345678 };
  const lines = renderBlock(stats, REF11).split("\n");

  const dropped = lines.filter((l) => l !== "- tasks_total: 987654").join("\n");
  assert.deepEqual(compareBlock(stats, parseBlock(`x\n${dropped}\n`).text).missing, ["tasks_total"]);

  const renamed = lines.map((l) => l.replace("- tasks_total:", "- tasks_total_x:")).join("\n");
  const cmp = compareBlock(stats, parseBlock(`x\n${renamed}\n`).text);
  assert.equal(cmp.ok, false);
  assert.deepEqual(cmp.extra, ["tasks_total_x"]);
});

test("a malformed block is a DISTINCT state from 'no block' (读不懂 ≠ 没有)", () => {
  const stats = { tasks_total: 987654 };
  const full = renderBlock(stats, REF11);
  // no markers at all
  const absent = parseBlock("# readme\n\nno block here\n");
  assert.deepEqual([absent.found, absent.reason], [false, "absent"]);
  // start marker without its partner
  const unterminated = parseBlock(`${full.split(MARK_END)[0]}\n`);
  assert.deepEqual([unterminated.found, unterminated.reason], [false, "unterminated"]);
  // reversed pair
  const reversed = parseBlock(`${MARK_END}\n- tasks_total: 1\n${MARK_START}\n`);
  assert.deepEqual([reversed.found, reversed.reason], [false, "reversed"]);
  // an existing block is replaced in place, never duplicated
  const once = writeBlockInto(`head\n\n${INSERT_ANCHOR}\n\ntail\n`, full);
  const twice = writeBlockInto(once, full);
  assert.equal(twice, once, "writeBlockInto must be idempotent");
  assert.equal(once.split(MARK_START).length - 1, 1, "exactly one start marker");
});

// ── 4. the CLI: --write / --check / --json, and the drift exit code ─────────────────

test("CLI — --write is idempotent, --check is green, a tampered value exits 1 with CAUSE=stats-drift", () => {
  const { dir } = makeFixture();
  const readmePath = path.join(dir, README);
  const cli = (args) =>
    spawnSync("node", ["--no-warnings", "--experimental-strip-types", SCRIPT, ...args, "--root", dir], {
      encoding: "utf8",
    });

  // ① --json is a flat scalar object
  const json = cli(["--json"]);
  assert.equal(json.status, 0, json.stderr);
  const parsedJson = JSON.parse(json.stdout);
  assert.deepEqual(
    Object.entries(parsedJson).filter(([, v]) => typeof v === "object" && v !== null),
    [],
    "every top-level value must be a scalar",
  );

  // ② --write inserts the block, is idempotent, and --check accepts it
  const w1 = cli(["--write"]);
  assert.equal(w1.status, 0, w1.stderr);
  const after1 = fs.readFileSync(readmePath, "utf8");
  assert.ok(after1.includes(MARK_START) && after1.includes(MARK_END), "block must be written");
  assert.equal(after1.split(MARK_START).length - 1, 1, "the section must not be duplicated");
  assert.equal(cli(["--write"]).status, 0);
  assert.equal(fs.readFileSync(readmePath, "utf8"), after1, "--write must be byte-idempotent");
  const ok = cli(["--check"]);
  assert.equal(ok.status, 0, `--check must accept a freshly written block: ${ok.stderr}`);

  // ③ NEGATIVE CONTROL on the real read path: tamper ONE value ⇒ exit 1 + CAUSE=stats-drift.
  //    (snapshot_date is chosen because the block's other content — counts and a hex commit id —
  //    cannot contain a `YYYY-MM-DD` literal, so the tamper is deterministically detectable.)
  const pinned = parseBlock(after1).commit;
  const freshDate = collectStats(dir, pinned).snapshot_date;
  const tamperedText = after1.replace(`- snapshot_date: ${freshDate}`, "- snapshot_date: 1999-12-31");
  assert.notEqual(tamperedText, after1, "the tamper must actually change the block");
  fs.writeFileSync(readmePath, tamperedText, "utf8");
  const red = cli(["--check"]);
  assert.equal(red.status, 1, `tampered block must exit 1 (stdout=${red.stdout} stderr=${red.stderr})`);
  assert.match(red.stderr, /CAUSE=stats-drift/);
  assert.match(red.stderr, /missing=\[snapshot_date\]/);

  // ④ restore ⇒ green again (the judgment really takes two values)
  fs.writeFileSync(readmePath, after1, "utf8");
  assert.equal(cli(["--check"]).status, 0);
});

test("CLI — a missing or malformed block exits 2, never conflated with 'consistent'", () => {
  const { dir } = makeFixture();
  const readmePath = path.join(dir, README);
  const cli = (args) =>
    spawnSync("node", ["--no-warnings", "--experimental-strip-types", SCRIPT, ...args, "--root", dir], {
      encoding: "utf8",
    });

  const noBlock = cli(["--check"]);
  assert.equal(noBlock.status, 2);
  assert.match(noBlock.stderr, /CAUSE=readme-marker-absent/);

  const before = fs.readFileSync(readmePath, "utf8");
  fs.writeFileSync(readmePath, `${before}\n${MARK_START}\n- tasks_total: 12\n`, "utf8");
  const unterminated = cli(["--check"]);
  assert.equal(unterminated.status, 2, "an unparseable block must not read as drift OR as consistent");
  assert.match(unterminated.stderr, /CAUSE=readme-marker-absent/);

  // a --json run must still produce output (the criterion checks the marker FIRST, so a silent
  // script would report the wrong CAUSE)
  const json = cli(["--json"]);
  assert.equal(json.status, 0);
  assert.ok(json.stdout.trim().length > 0);
});
