// @test-group product
// goal-criterion-import-specifiers-resolve — a goal criterion must not name a module that no
// longer exists at the path it spells.
//
// WHY THIS EXISTS (task gap-ac237-criterion-stale-acceptance-runner-moved). AC-237 and AC-243 both
// pinned `./packages/quay/src/gate/acceptance-runner.ts` as a STRING inside their `criterion`. A
// legitimate refactor (commit e676d097b) moved that module to `gate/shared/acceptance-runner.ts`
// and both criteria went false — through `ERR_MODULE_NOT_FOUND`, i.e. the guarantee they assert was
// still true on the new path while the RECORD named a carrier that had left. Two earlier tasks
// (`gap-ac152-filter-carrier-renamed-criterion-stale`, `gap-ac157-catalog-carrier-moved-criterion-stale`)
// are the same shape: a criterion bound to a file path re-breaks on the next move.
//
// The two criteria are re-anchored on the PRODUCTION consumption surface (`quay goal gate`
// end-to-end) in the same landing. This test is the RECURRENCE half: it is the thing that goes red
// in `scripts/test.sh` when someone moves/archives a module a criterion still imports — in the same
// landing, instead of a goal-driver red days later that no one can attribute.
//
// WHAT IT CHECKS (enumerated, not "does the goal look fine"):
//   · reads `goals/*.md` frontmatter and inspects ONLY the `criterion` field — ⛔ origin/expect prose
//     is narrative and may legitimately mention paths that do not exist;
//   · extracts `import("<spec>")` / `require("<spec>")` whose specifier starts with `./` or `../`;
//   · skips records whose `status` is `superseded` or `retired` — those are explicitly out of scope
//     (a criterion that was retired does not get re-verified; pointing it at an archived file is not
//     a defect);
//   · asserts every remaining specifier resolves with `fs.existsSync(path.resolve(specifier))`
//     against the repository root, and on failure names every `file → specifier` pair;
//   · SECOND CLASS (task gap-ac353-criterion-pins-moved-acceptance-runner-path): extracts whole-token
//     `.ts` paths written as QUOTED string literals inside a criterion (e.g. an entry in a `need`
//     table or a `test -f "<path>"` argument) and asserts each resolves against the repository root
//     OR `packages/quay/src`. This is the class the first extractor structurally cannot see: AC-353 /
//     AC-355 pinned `"gate/acceptance-runner.ts"` inside `fs.readFileSync`/`path.join` data, and the
//     same commit e676d097b that the first extractor was built for moved that module into
//     `gate/shared/` — the sibling failure survived because only `import(...)` was covered.
//
// COVERAGE BOUNDARY (hard rule 3b — state what this is NOT):
//   · the first class covers ONLY `import(...)` / `require(...)` LITERALS in a criterion that start
//     with `./` or `../`. It does NOT cover paths written for `grep`/`-e`/`test -e`, shell
//     redirections, or Python `open(...)`; it does NOT cover dynamically assembled specifiers
//     (`"./a/" + name`), package specifiers (`node:fs`, `yaml`), or `import x from "..."` / static
//     `import` declarations;
//   · the second class covers ONLY a path that is the ENTIRE content of an UNESCAPED quoted literal
//     and has at least one `/` (a bare `foo.ts` filename is not a repo-relative claim, and a path
//     inside an escaped string — `\"…\"`, a line being assembled by code — is not a claim about a
//     file). It does NOT cover unquoted path words, `$var/…` interpolations, regex sources
//     (`gate-run-options\.ts`), or glob/`--name-only` arguments;
//   · the second class also SKIPS any line that asserts ABSENCE (`! -e` / `! -f` / "must be deleted"
//     / "must be removed" / "reappeared" / "still exists") — `[ ! -e gate/factories/loader.ts ]` is
//     a must-NOT-exist claim, so a missing file is the desired reading, not a defect;
//   · therefore an `[ ! -e ./gone.ts ]` assertion (which REQUIRES absence) is never flagged — that is
//     intentional: this test only knows the "must exist" reading of a path;
//   · a criterion that stops naming anything at all (like AC-237's re-anchored text) is trivially
//     in-scope and has nothing to resolve. This test cannot tell whether such a criterion still
//     asserts the right guarantee — that is the goal gate's job, not this test's.
//
// SECOND CHECK — timezone-blind timestamp comparison (task
// gap-ac262-criterion-tz-blind-timestamp-comparison). AC-262's criterion derived `land` from
// `git log -1 --format=%cI` (a committer date WITH the local offset, e.g.
// `2026-10-18T22:01:56+08:00`) and compared it to the carrier's `ts` (UTC, `2026-10-18T14:07:37Z`)
// as STRINGS. Lexicographically `'14' < '22'`, so every genuine post-landing round was read as
// pre-landing: the criterion said "0 rounds" — the exact shape of "the ring never ran", which is
// the reading hard rule 3b forbids (an input the judge cannot parse must not look like a passing
// or a cleanly-failing judgement). The fix parses both sides to an instant (`fromisoformat` →
// `.timestamp()`); this test is the recurrence half: the next criterion that compares two ISO-8601
// dialects lexicographically goes red in the same landing.
//
// WHAT IT CHECKS (enumerated):
//   · scans `goals/*.md` frontmatter `criterion` only (origin/expect prose may legitimately show
//     example timestamps);
//   · skips `superseded` / `retired` records — AC-266/267/268 carry this same code shape but are
//     explicitly out of scope, so they are NOT a miss;
//   · a record is in scope when its criterion both DERIVES a timestamp from git (`%cI` /
//     `git log --format`) and COMPARES `ts` with `land`/`since` using a comparison operator;
//   · within that scope it is a violation when the criterion carries NO timezone normalization
//     (`fromisoformat` / `Date.parse` / `getTime()` / `.timestamp()`);
//   · violations are reported as `file:line` so the fix lands at the comparison, not at the file.
//
// COVERAGE BOUNDARY: the comparison regex is word-bounded, so the normalized form
// (`ts_epoch <= land_epoch`) never matches; but a criterion that renames the operands (`a`/`b`)
// or normalizes with some other API is outside what this test can see. That limitation is why the
// production criterion itself is also re-anchored, not just guarded.
//
// `QUAY_GOALS_ROOT` overrides the scanned directory so the negative controls below can run against
// temp fixtures (and so a future caller can scan another workspace) without touching production
// `goals/`.
//
// Run (scoped): node --test packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** The scanned goals directory. `QUAY_GOALS_ROOT` exists for the negative control and for other
 *  workspaces; it is resolved against the CWD so a relative override is not silently read as
 *  repo-relative. */
const GOALS_DIR = process.env.QUAY_GOALS_ROOT
  ? path.resolve(process.env.QUAY_GOALS_ROOT)
  : path.join(REPO_ROOT, "goals");

/** Statuses whose criteria are explicitly out of scope: a superseded/retired record is no longer
 *  re-verified, so a stale path inside it is not a defect. Enumerated (⛔ not "status !== active"). */
const OUT_OF_SCOPE_STATUSES = new Set(["superseded", "retired"]);

/** `import("./x")` / `require('./x')`, with an OPTIONAL backslash before the quotes: a criterion
 *  stored through a single-quoted YAML scalar keeps `\"` in its text, and the same record read back
 *  through the store has plain quotes. Both are the same reference. */
function relativeSpecifiersInCriterion(criterion) {
  const re = /(?:import|require)\s*\(\s*\\?(["'])((?:\.{1,2}\/)[^"'\n]*?)\\?\1\s*\)/g;
  const out = [];
  for (const m of String(criterion ?? "").matchAll(re)) out.push(m[2]);
  return out;
}

/**
 * A line that claims a path must NOT exist. Such a line is out of scope for a "does it resolve"
 * check: the whole point is that the file is gone. Enumerated — ⛔ not "the line mentions the word
 * `deleted` somewhere in the criterion".
 */
const ABSENCE_CLAIM = /!\s*-[ef]\b|must be deleted|must be removed|reappeared|still exists/;

/**
 * Whole-token `.ts` paths written as QUOTED string literals (⛔ unescaped quotes only: a path inside
 * `\"…\"` is a fragment of a line being assembled by code, not a claim about a file), with at least
 * one `/` (a bare `foo.ts` basename does not say WHERE the file should be). Lines that assert
 * absence are skipped — see `ABSENCE_CLAIM`.
 */
function quotedPathLiteralsInCriterion(criterion) {
  const re = /(["'])((?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.ts)\1/g;
  const out = [];
  for (const line of String(criterion ?? "").split("\n")) {
    if (ABSENCE_CLAIM.test(line)) continue;
    for (const m of line.matchAll(re)) {
      if (m[2].startsWith("/")) continue; // absolute / concatenation fragment, not a relative path
      out.push(m[2]);
    }
  }
  return out;
}

/**
 * Walk the goal records once, handing each live criterion to `visit`, which returns a list of
 * `{...}` claim objects. The common readings (which records were scanned/skipped, which could not be
 * parsed) are collected here so both extractors share one traversal.
 */
function collectCriterionClaims(goalsDir, visit) {
  const acc = { scanned: 0, skipped: [], parseErrors: [], hits: [] };
  let entries;
  try {
    entries = fs.readdirSync(goalsDir, { withFileTypes: true });
  } catch (err) {
    // An absent/unreadable goals dir is NOT "no claims" — return a distinguishable value so a caller
    // cannot read "I could not look" as "looked, fine" (hard rule 3b).
    acc.parseErrors.push({ file: "<goals-dir>", error: String(err && err.message ? err.message : err) });
    return acc;
  }
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
    const file = ent.name;
    const raw = fs.readFileSync(path.join(goalsDir, file), "utf8");
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue; // not a goal record
    let fm;
    try {
      fm = parseYaml(fmMatch[1]);
    } catch (err) {
      acc.parseErrors.push({ file, error: String(err && err.message ? err.message : err) });
      continue;
    }
    if (!fm || typeof fm !== "object") continue;
    if (OUT_OF_SCOPE_STATUSES.has(String(fm.status ?? ""))) {
      acc.skipped.push({ file, status: fm.status });
      continue;
    }
    const criterion = typeof fm.criterion === "string" ? fm.criterion : "";
    if (!criterion) continue;
    acc.scanned += 1;
    for (const claim of visit(criterion)) acc.hits.push({ file, ...claim });
  }
  return acc;
}

/**
 * Scan a goals directory and return the criterion specifiers that do not resolve.
 *
 * `resolveBase` is where relative specifiers are resolved — the REPOSITORY ROOT, not the goals
 * dir: criteria are written relative to the tree the gate runs in (`runAcceptance`'s cwd is the
 * workspace root).
 */
export function findUnresolvedCriterionImports(goalsDir, { resolveBase = REPO_ROOT } = {}) {
  const acc = collectCriterionClaims(goalsDir, (criterion) =>
    relativeSpecifiersInCriterion(criterion).map((specifier) => ({
      specifier,
      resolved: path.resolve(resolveBase, specifier),
    })),
  );
  return {
    scanned: acc.scanned,
    checked: acc.hits.length,
    skipped: acc.skipped,
    parseErrors: acc.parseErrors,
    unresolved: acc.hits.filter((h) => !fs.existsSync(h.resolved)),
  };
}

/**
 * The second class: quoted whole-token `.ts` path literals that do not resolve anywhere the gate
 * could plausibly mean. A criterion may name a module the way a criterion author thinks about the
 * tree (repo-relative, `packages/quay/src/...`) or the way the consumer code names its sibling
 * (`gate/acceptance-runner.ts` under `src`), so BOTH bases are accepted.
 */
export function findUnresolvedCriterionPathLiterals(
  goalsDir,
  { resolveBases = [REPO_ROOT, path.join(REPO_ROOT, "packages/quay/src")] } = {},
) {
  const acc = collectCriterionClaims(goalsDir, (criterion) =>
    quotedPathLiteralsInCriterion(criterion).map((literal) => {
      const candidates = resolveBases.map((base) => path.resolve(base, literal));
      return { literal, candidates, resolved: candidates.find((c) => fs.existsSync(c)) ?? null };
    }),
  );
  return {
    scanned: acc.scanned,
    checked: acc.hits.length,
    skipped: acc.skipped,
    parseErrors: acc.parseErrors,
    unresolved: acc.hits.filter((h) => h.resolved === null),
  };
}

function describeUnresolved(unresolved) {
  return unresolved.map((u) => `${u.file} → ${u.specifier}`).join("\n");
}

// ── the production reading ───────────────────────────────────────────────────────────────────────

test("every relative import/require specifier in a live goal criterion resolves on disk", () => {
  const r = findUnresolvedCriterionImports(GOALS_DIR);
  assert.deepEqual(
    r.parseErrors,
    [],
    `could not read goal record(s) under ${GOALS_DIR} (NOT-EVALUATED, not "clean"):\n${r.parseErrors
      .map((e) => `${e.file}: ${e.error}`)
      .join("\n")}`,
  );
  assert.deepEqual(
    r.unresolved.map((u) => `${u.file} → ${u.specifier}`),
    [],
    `goal criterion(s) import a module path that no longer exists — re-anchor the criterion on the ` +
      `module's new carrier (or on the production surface), do not re-pin the old string:\n${describeUnresolved(r.unresolved)}`,
  );
});

// ── second class: quoted whole-token `.ts` path literals ────────────────────────────────────────

const THIS_TEST_FILE = fileURLToPath(import.meta.url);

test("every quoted whole-token .ts path literal in a live goal criterion resolves on disk", () => {
  const r = findUnresolvedCriterionPathLiterals(GOALS_DIR);
  assert.deepEqual(
    r.parseErrors,
    [],
    `could not read goal record(s) under ${GOALS_DIR} (NOT-EVALUATED, not "clean"):\n${r.parseErrors
      .map((e) => `${e.file}: ${e.error}`)
      .join("\n")}`,
  );
  assert.deepEqual(
    r.unresolved.map((u) => `${u.file} → ${u.literal}`),
    [],
    `goal criterion(s) name a .ts path that no longer exists — locate the carrier by what it EXPORTS ` +
      `(or by the production surface), do not re-pin the old directory:\n` +
      r.unresolved.map((u) => `${u.file} → ${u.literal}`).join("\n"),
  );
});

// ── negative control: the check can actually go red, and names the literal ─────────────────────

/** Write a criterion as a YAML block scalar, so a multi-line shell criterion survives `parseYaml`
 *  exactly as the real goal records are stored. */
function writeCriterionRecord(dir, id, criterion) {
  const body = String(criterion)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  writeRecord(
    dir,
    id,
    `---\nid: ${id}\ntitle: fixture\nstatus: active\nkind: criterion\ngoal: GOAL-fixture\n` +
      `criterion: |\n${body}\nexpect: fixture\norigin: probe\n---\n`,
  );
}

test("negative control: a criterion naming a moved module is reported as file → literal", () => {
  const dir = mkGoalsDir();
  try {
    writeCriterionRecord(
      dir,
      "AC-fixture",
      'set -u\nnode -e \'const need=[["gate/acceptance-runner.ts"]]\' || exit 1',
    );
    const r = findUnresolvedCriterionPathLiterals(dir);
    assert.equal(r.checked, 1, "the one quoted .ts literal in the fixture criterion must be checked");
    assert.deepEqual(
      r.unresolved.map((u) => `${u.file} → ${u.literal}`),
      ["AC-fixture.md → gate/acceptance-runner.ts"],
      "the failure must NAME the record and the dead literal",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a must-NOT-exist assertion is not a path claim (its file is supposed to be gone)", () => {
  const dir = mkGoalsDir();
  try {
    writeCriterionRecord(dir, "AC-absence", '[ ! -e "gate/__retired__.ts" ] || exit 1');
    const r = findUnresolvedCriterionPathLiterals(dir);
    assert.equal(r.checked, 0, "an absence assertion must not be read as a must-exist claim");
    assert.deepEqual(r.unresolved, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a bare filename is not a repo-relative claim and is ignored", () => {
  const dir = mkGoalsDir();
  try {
    writeCriterionRecord(dir, "AC-bare", 'grep -q "goal-store.ts" packages/quay/src/goal-store.ts');
    const r = findUnresolvedCriterionPathLiterals(dir);
    assert.equal(r.checked, 0, "a bare quoted filename and an unquoted path word are not claims");
    assert.deepEqual(r.unresolved, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The AC's negative control runs through THIS file's production reading with `QUAY_GOALS_ROOT`
// pointed at a fixture — i.e. the same env override a future workspace would use, not a private
// code path. `QUAY_GOALS_ROOT` present ⇒ this is the child itself; skip, or the spawn would recurse.
test(
  "negative control (QUAY_GOALS_ROOT): the production reading reds on a fixture and names the literal",
  { skip: process.env.QUAY_GOALS_ROOT ? "child run: QUAY_GOALS_ROOT is set" : false },
  () => {
    const dir = mkGoalsDir();
    try {
      writeCriterionRecord(
        dir,
        "AC-fixture",
        'set -u\nnode -e \'const need=[["gate/acceptance-runner.ts"]]\' || exit 1',
      );
      const env = { ...process.env, QUAY_GOALS_ROOT: dir };
      // A nested `node --test` inherits this from the parent test run; leaving it set makes the
      // child attach to the parent's reporter instead of running.
      delete env.NODE_TEST_CONTEXT;
      const r = spawnSync(process.execPath, ["--test", THIS_TEST_FILE], { env, encoding: "utf8" });
      const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      assert.notEqual(r.status, 0, `the production reading must go red on the fixture, output:\n${output}`);
      assert.match(output, /AC-fixture\.md → gate\/acceptance-runner\.ts/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);


function mkGoalsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-criterion-import-specifiers-"));
  return dir;
}

function writeRecord(dir, id, body) {
  fs.writeFileSync(path.join(dir, `${id}.md`), body);
}

test("negative control: a criterion naming a removed module is reported as file → specifier", () => {
  const dir = mkGoalsDir();
  try {
    writeRecord(
      dir,
      "AC-fixture",
      '---\nid: AC-fixture\ntitle: fixture\nstatus: active\nkind: criterion\ngoal: GOAL-fixture\n' +
        'criterion: "node -e \'import(\'./packages/quay/src/__nope__.ts\')\'"\nexpect: fixture\norigin: probe\n---\n',
    );
    // ⛔ The origin/expect prose deliberately names a dead path too: only `criterion` is in scope.
    writeRecord(
      dir,
      "GOAL-fixture",
      "---\nid: GOAL-fixture\ntitle: fixture\nstatus: active\nkind: goal\norigin: ./packages/quay/src/__also_gone__.ts\nbody: |\n  fixture\n---\n",
    );
    const r = findUnresolvedCriterionImports(dir);
    assert.equal(r.checked, 1, "the one relative specifier in the fixture criterion must be checked");
    assert.deepEqual(
      r.unresolved.map((u) => `${u.file} → ${u.specifier}`),
      ["AC-fixture.md → ./packages/quay/src/__nope__.ts"],
      "the failure must NAME the record and the dead specifier",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("superseded / retired records are skipped (their criteria are no longer re-verified)", () => {
  const dir = mkGoalsDir();
  try {
    for (const [id, status] of [["AC-old", "superseded"], ["AC-gone", "retired"]]) {
      writeRecord(
        dir,
        id,
        `---\nid: ${id}\ntitle: fixture\nstatus: ${status}\nkind: criterion\ngoal: GOAL-fixture\n` +
          `criterion: "node -e 'import(\\"./packages/quay/src/__archived__.ts\\")'"\nexpect: fixture\norigin: probe\n---\n`,
      );
    }
    const r = findUnresolvedCriterionImports(dir);
    assert.deepEqual(r.unresolved, []);
    assert.deepEqual(r.skipped.map((s) => s.status).sort(), ["retired", "superseded"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("non-relative specifiers (node:fs, package names) are not file-path claims and are ignored", () => {
  const dir = mkGoalsDir();
  try {
    writeRecord(
      dir,
      "AC-builtin",
      '---\nid: AC-builtin\ntitle: fixture\nstatus: active\nkind: criterion\ngoal: GOAL-fixture\n' +
        'criterion: "node -e \'import(\\"node:fs\\").then(()=>import(\\"yaml\\"))\'"\nexpect: fixture\norigin: probe\n---\n',
    );
    const r = findUnresolvedCriterionImports(dir);
    assert.equal(r.checked, 0);
    assert.deepEqual(r.unresolved, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── second check: timezone-blind timestamp comparison ───────────────────────────────────────────

/** `ts` compared with `land`/`since` by an operator. Word-bounded on BOTH operands so the
 *  normalized form (`ts_epoch <= land_epoch`) does not match: `_` is a word character, so
 *  `\bts\b` cannot match inside `ts_epoch`. */
const LEXICOGRAPHIC_TS_COMPARISON =
  /\bts\b\s*(?:<=|>=|<|>)\s*\b(?:land|since)\b|\b(?:land|since)\b\s*(?:<=|>=|<|>)\s*\bts\b/;

/** Any of the four normalization spellings AC5 names. Presence anywhere in the criterion is
 *  enough: a criterion that normalizes at all is not the pure string-compare shape. */
const TIMEZONE_NORMALIZATION = /fromisoformat|Date\.parse|getTime\(\)|\.timestamp\(\)/;

/** A timestamp derived from git in a criterion is a COMPARISON WINDOW, not a display string — it
 *  will be pitted against carrier timestamps, which are written in a different dialect. */
const GIT_TIMESTAMP_DERIVATION = /%cI|git log --format/;

/**
 * 1-based line numbers of the frontmatter `criterion:` block in the raw file. Used only to name the
 * offending line; `null` when the block cannot be located (the record is still reported with
 * `line: null`, never dropped).
 */
function criterionLineRange(raw) {
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => /^criterion:/.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^[A-Za-z_][\w-]*:\s*/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start: start + 1, end }; // 1-based inclusive start, exclusive end (0-based)
}

function firstLineMatching(raw, re) {
  const range = criterionLineRange(raw);
  if (!range) return null;
  const lines = raw.split("\n");
  for (let i = range.start - 1; i < Math.min(range.end, lines.length); i += 1) {
    if (re.test(lines[i])) return i + 1; // 1-based
  }
  return null;
}

/**
 * Scan a goals directory for criteria that compare a git-derived timestamp with a carrier `ts` as
 * raw strings. Returns `blind: [{file, line, excerpt}]`; `line` is `null` when the comparison was
 * found in the parsed criterion but not locatable in the raw text.
 */
export function findTimezoneBlindTimestampComparisons(goalsDir) {
  const result = {
    scanned: 0,
    candidates: 0,
    skipped: [],
    blind: [],
    unlocatable: [],
    parseErrors: [],
  };
  let entries;
  try {
    entries = fs.readdirSync(goalsDir, { withFileTypes: true });
  } catch (err) {
    result.parseErrors.push({ file: "<goals-dir>", error: String(err && err.message ? err.message : err) });
    return result;
  }
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
    const file = ent.name;
    const raw = fs.readFileSync(path.join(goalsDir, file), "utf8");
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;
    let fm;
    try {
      fm = parseYaml(fmMatch[1]);
    } catch (err) {
      result.parseErrors.push({ file, error: String(err && err.message ? err.message : err) });
      continue;
    }
    if (!fm || typeof fm !== "object") continue;
    if (OUT_OF_SCOPE_STATUSES.has(String(fm.status ?? ""))) {
      result.skipped.push({ file, status: fm.status });
      continue;
    }
    const criterion = typeof fm.criterion === "string" ? fm.criterion : "";
    if (!criterion) continue;
    result.scanned += 1;
    if (!GIT_TIMESTAMP_DERIVATION.test(criterion)) continue;
    result.candidates += 1;
    if (!LEXICOGRAPHIC_TS_COMPARISON.test(criterion)) continue;
    if (TIMEZONE_NORMALIZATION.test(criterion)) continue;
    const line = firstLineMatching(raw, LEXICOGRAPHIC_TS_COMPARISON);
    if (line === null) {
      result.unlocatable.push({ file });
      result.blind.push({ file, line: null, excerpt: null });
    } else {
      result.blind.push({ file, line, excerpt: raw.split("\n")[line - 1].trim().slice(0, 120) });
    }
  }
  return result;
}

function describeBlind(blind) {
  return blind
    .map((b) => `${b.file}:${b.line ?? "?"}${b.excerpt ? ` → ${b.excerpt}` : ""}`)
    .join("\n");
}

test("no live goal criterion compares a git %cI timestamp with a carrier ts lexicographically", () => {
  const r = findTimezoneBlindTimestampComparisons(GOALS_DIR);
  assert.deepEqual(
    r.parseErrors,
    [],
    `could not read goal record(s) under ${GOALS_DIR} (NOT-EVALUATED, not "clean"):\n${r.parseErrors
      .map((e) => `${e.file}: ${e.error}`)
      .join("\n")}`,
  );
  // A scanner that never reached a criterion cannot find a blind comparison — say so instead of
  // letting "checked nothing" look like "checked, clean" (hard rule 3b).
  assert.ok(
    r.candidates > 0,
    `no non-superseded criterion under ${GOALS_DIR} derives a timestamp from git — this check has ` +
      `nothing to judge, so its green is NOT evidence (hard rule 3b). Re-scope the scanner if the ` +
      `git-derived-window shape moved.`,
  );
  assert.deepEqual(
    r.blind.map((b) => b.file),
    [],
    `goal criterion(s) compare two ISO-8601 dialects as strings — parse both sides to an instant ` +
      `(e.g. datetime.fromisoformat(...replace("Z","+00:00")).timestamp()) before comparing, or a ` +
      `carrier timestamp in UTC (…Z) is read as earlier than a …+08:00 landing time:\n${describeBlind(r.blind)}`,
  );
});

// ── negative controls for the timestamp check ───────────────────────────────────────────────────

const NORMALIZED_CRITERION = [
  "python3 - <<'P'",
  "  import json, subprocess",
  "  from datetime import datetime",
  '  land = subprocess.run(["git","log","-1","--format=%cI","--","x"],capture_output=True,text=True).stdout.strip()',
  '  land_epoch = datetime.fromisoformat(land).timestamp()',
  '  for ln in open(".quay/goal-round.jsonl"):',
  "      r = json.loads(ln)",
  '      ts_epoch = datetime.fromisoformat(str(r["ts"]).replace("Z", "+00:00")).timestamp()',
  "      if ts_epoch <= land_epoch: continue",
  "P",
].join("\n");

const BLIND_CRITERION = [
  "python3 - <<'P'",
  "  import json, subprocess",
  '  land = subprocess.run(["git","log","-1","--format=%cI","--","x"],capture_output=True,text=True).stdout.strip()',
  '  for ln in open(".quay/goal-round.jsonl"):',
  "      r = json.loads(ln)",
  '      ts = str(r.get("ts") or "")',
  "      if not ts or ts <= land: continue",
  "P",
].join("\n");

test("negative control: the pre-fix AC-262 criterion (ts <= land as strings) is reported as file:line", () => {
  const dir = mkGoalsDir();
  try {
    writeRecord(
      dir,
      "AC-262-prefix",
      "---\nid: AC-262-prefix\ntitle: fixture\nstatus: achieved\nkind: criterion\ngoal: GOAL-fixture\n" +
        "criterion: |-\n" +
        BLIND_CRITERION.split("\n")
          .map((l) => `  ${l}`)
          .join("\n") +
        "\nexpect: fixture\norigin: probe\n---\n",
    );
    const r = findTimezoneBlindTimestampComparisons(dir);
    assert.equal(r.blind.length, 1, "the pre-fix comparison must be reported");
    assert.equal(r.blind[0].file, "AC-262-prefix.md");
    assert.ok(r.blind[0].line !== null, "the failure must name a line inside the criterion block");
    // The named line must actually be the comparison — not the `criterion:` header or `origin:`.
    const named = fs.readFileSync(path.join(dir, "AC-262-prefix.md"), "utf8").split("\n")[
      r.blind[0].line - 1
    ];
    assert.match(named, /ts\s*<=\s*land/, `named line is not the comparison: ${JSON.stringify(named)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the normalized spelling (ts_epoch <= land_epoch after fromisoformat) is NOT reported", () => {
  const dir = mkGoalsDir();
  try {
    writeRecord(
      dir,
      "AC-normalized",
      "---\nid: AC-normalized\ntitle: fixture\nstatus: active\nkind: criterion\ngoal: GOAL-fixture\n" +
        "criterion: |-\n" +
        NORMALIZED_CRITERION.split("\n")
          .map((l) => `  ${l}`)
          .join("\n") +
        "\nexpect: fixture\norigin: probe\n---\n",
    );
    const r = findTimezoneBlindTimestampComparisons(dir);
    assert.deepEqual(r.blind, []);
    assert.equal(r.candidates, 1, "the fixture criterion does derive a timestamp from git, so it must be a candidate");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("superseded / retired criteria are skipped by the timestamp check too", () => {
  const dir = mkGoalsDir();
  try {
    for (const [id, status] of [["AC-266-old", "superseded"], ["AC-268-old", "retired"]]) {
      writeRecord(
        dir,
        id,
        `---\nid: ${id}\ntitle: fixture\nstatus: ${status}\nkind: criterion\ngoal: GOAL-fixture\n` +
          "criterion: |-\n" +
          BLIND_CRITERION.split("\n")
            .map((l) => `  ${l}`)
            .join("\n") +
          "\nexpect: fixture\norigin: probe\n---\n",
      );
    }
    const r = findTimezoneBlindTimestampComparisons(dir);
    assert.deepEqual(r.blind, []);
    assert.deepEqual(r.skipped.map((s) => s.status).sort(), ["retired", "superseded"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a criterion that never derives a git timestamp is out of scope", () => {
  const dir = mkGoalsDir();
  try {
    writeRecord(
      dir,
      "AC-no-git",
      "---\nid: AC-no-git\ntitle: fixture\nstatus: active\nkind: criterion\ngoal: GOAL-fixture\n" +
        "criterion: |-\n  const since = readSince();\n  if (ts <= since) continue\n" +
        "expect: fixture\norigin: probe\n---\n",
    );
    const r = findTimezoneBlindTimestampComparisons(dir);
    assert.deepEqual(r.blind, []);
    assert.equal(r.candidates, 0, "no git-derived window ⇒ not a candidate");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
