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
//     against the repository root, and on failure names every `file → specifier` pair.
//
// COVERAGE BOUNDARY (hard rule 3b — state what this is NOT):
//   · it covers ONLY `import(...)` / `require(...)` LITERALS in a criterion that start with `./`
//     or `../`. It does NOT cover paths written for `grep`/`-e`/`test -e`, shell redirections, or
//     Python `open(...)`; it does NOT cover dynamically assembled specifiers (`"./a/" + name`),
//     package specifiers (`node:fs`, `yaml`), or `import x from "..."` / static `import`
//     declarations;
//   · therefore an `[ ! -e ./gone.ts ]` assertion (which REQUIRES absence) is never flagged — that is
//     intentional: this test only knows the "must exist" reading of a relative path;
//   · a criterion that stops importing anything at all (like AC-237's re-anchored text) is trivially
//     in-scope and has nothing to resolve. This test cannot tell whether such a criterion still
//     asserts the right guarantee — that is the goal gate's job, not this test's.
//
// `QUAY_GOALS_ROOT` overrides the scanned directory so the negative control below can run against a
// temp fixture (and so a future caller can scan another workspace) without touching production
// `goals/`.
//
// Run (scoped): node --test packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
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
 * Scan a goals directory and return the criterion specifiers that do not resolve.
 *
 * `resolveBase` is where relative specifiers are resolved — the REPOSITORY ROOT, not the goals
 * dir: criteria are written relative to the tree the gate runs in (`runAcceptance`'s cwd is the
 * workspace root).
 */
export function findUnresolvedCriterionImports(goalsDir, { resolveBase = REPO_ROOT } = {}) {
  const result = { scanned: 0, checked: 0, skipped: [], unresolved: [], parseErrors: [] };
  let entries;
  try {
    entries = fs.readdirSync(goalsDir, { withFileTypes: true });
  } catch (err) {
    // An absent/unreadable goals dir is NOT "no unresolved imports" — return a distinguishable
    // value so a caller cannot read "I could not look" as "looked, fine" (hard rule 3b).
    result.parseErrors.push({ file: "<goals-dir>", error: String(err && err.message ? err.message : err) });
    return result;
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
    for (const specifier of relativeSpecifiersInCriterion(criterion)) {
      result.checked += 1;
      const resolved = path.resolve(resolveBase, specifier);
      if (!fs.existsSync(resolved)) result.unresolved.push({ file, specifier, resolved });
    }
  }
  return result;
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

// ── negative control: the check can actually go red, and names the pair ─────────────────────────

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
