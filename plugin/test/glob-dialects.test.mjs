// @test-group engine
// glob-dialects.test.mjs — the ONE wildcard-glob compiler and the FOUR dialects it serves.
//
// SOURCE FINDING: `.quay/routine-findings.jsonl` finding `glob-to-regexp-family` (routine
// `semantic-dedup-scan`, runId `semantic-dedup-scan-1794222946369`, verdict
// `divergent-implementation`, suggestedAction `extract`).
//
// THE DEFECT THIS CARRIER CLOSES: FOUR functions named `globToRegExp` lived under
// plugin/scripts, and three of them disagreed on `*`-crossing-`/`, on `?`, and on `**`
// (zero-directory vs one-or-more vs no globstar at all). None was a bug — they were four implicit
// DIALECTS. The cost of the implicit form is drift: nothing at a call site said which grammar it
// meant, so a "harmless" unification would silently change one caller's matching, and no test
// could tell the difference because each caller only tested its own half.
//
// WHAT IS PINNED HERE (the four-part shape used for `readJsonLines` / `normalizeRel`):
//   (a) SINGLE SOURCE — `compileGlobPattern` is defined exactly once under plugin/scripts
//       (code-position judgment via `codeOnlyText`, so a comment mentioning it cannot satisfy it).
//   (b) DELEGATION, NOT DELETION — each carrier imports the shared compiler, calls it with its
//       own declared dialect, and compiles no RegExp of its own. Deleting a private copy without
//       wiring the import would pass a "no duplicate" check while shipping nothing.
//   (c) THE DIVERGENT ROWS — every input on which the four dialects disagree is asserted in all
//       four, in BOTH directions. These are exactly the rows a naive one-grammar merge changes.
//   (d) END-TO-END WIRING — each carrier's own export is exercised, so "the right dialect is
//       declared at the right call site" is measured, not just the shared function in isolation.
//   (e) MECHANISM IS REAL — a consumer importing the shared export fails to link when it is
//       absent and links when present (the "删了不红 ⇒ 假" control).
//
// Run:
//   node --no-warnings --test --experimental-strip-types plugin/test/glob-dialects.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compileGlobPattern, GLOB_DIALECTS } from "../scripts/gate-script-base.ts";
import { codeOnlyText } from "../scripts/source-text-lib.ts";

const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts");
const scriptTsFiles = () => fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".ts"));
const sourceOf = (rel) => fs.readFileSync(path.join(SCRIPTS_DIR, rel), "utf8");
/** Comments blanked, offsets preserved — a code-position judgment (硬规则 2), not a keyword grep. */
const codeOf = (rel) => codeOnlyText(sourceOf(rel));

/** The four carriers and the dialect each must DECLARE. This table IS the disposition of the
 *  finding: the divergence is no longer implicit — it is written down and asserted per call site. */
const CARRIERS = [
  { file: "design-evolution-readings.ts", dialect: "path" },
  { file: "release-model-check.ts", dialect: "branch" },
  { file: "shipped-set-rules.ts", dialect: "rsync" },
  { file: "touches-orthogonality-check.ts", dialect: "touches" },
];

// ── (a) single source ───────────────────────────────────────────────────────────────────────────

test("compileGlobPattern: defined exactly ONCE under plugin/scripts (gate-script-base.ts)", () => {
  const defs = scriptTsFiles().filter((f) => /\bfunction compileGlobPattern\b/.test(codeOf(f)));
  assert.deepEqual(
    defs,
    ["gate-script-base.ts"],
    `compileGlobPattern must have a single definition; found: ${defs.length ? defs.join(", ") : "none"}`,
  );
});

// ── (b) delegation, not deletion ────────────────────────────────────────────────────────────────

test("carriers: none re-defines the compiler, each IMPORTS it and DELEGATES to its dialect", () => {
  for (const { file, dialect } of CARRIERS) {
    const code = codeOf(file);
    assert.doesNotMatch(code, /\bfunction compileGlobPattern\b/, `${file} must not re-implement the compiler`);
    assert.match(
      code,
      /import \{[^}]*\bcompileGlobPattern\b[^}]*\} from "\.\/gate-script-base\.ts"/,
      `${file} does not import compileGlobPattern from the base`,
    );
    // The deleted half alone proves nothing ("extracted" must mean both halves) — the carrier has to
    // CALL the shared compiler with the dialect its callers rely on.
    assert.match(
      code,
      new RegExp(`compileGlobPattern\\([^\\n]*GLOB_DIALECTS\\.${dialect}\\)`),
      `${file} does not delegate to the "${dialect}" dialect`,
    );
    // A private body would still fail this even if the import above were present.
    assert.doesNotMatch(code, /new RegExp\(/, `${file} still compiles its own RegExp`);
  }
});

// ── (c) the divergent rows, in both directions ──────────────────────────────────────────────────

test("`*` crosses `/` ONLY for branch names (a `/` is part of a ref, a separator in a path)", () => {
  for (const d of [GLOB_DIALECTS.path, GLOB_DIALECTS.rsync, GLOB_DIALECTS.touches]) {
    assert.equal(compileGlobPattern("a/*.js", d).test("a/b/c.js"), false, "a path wildcard must stop at `/`");
    assert.equal(compileGlobPattern("a/*.js", d).test("a/b.js"), true, "the same wildcard must still match one segment");
  }
  assert.equal(compileGlobPattern("rel/*", GLOB_DIALECTS.branch).test("rel/1.0"), true);
  assert.equal(compileGlobPattern("rel/*", GLOB_DIALECTS.branch).test("rel/a/b"), true, "a branch name may contain `/`");
});

test("`**` matches ZERO directories ONLY for the touches dialect (design needs its trailing `/`)", () => {
  assert.equal(compileGlobPattern("a/**/b.js", GLOB_DIALECTS.touches).test("a/b.js"), true, "`**` eats one following `/`");
  assert.equal(compileGlobPattern("a/**/b.js", GLOB_DIALECTS.path).test("a/b.js"), false, "design's `**` leaves the `/` in place");
  // Both still cross at least one directory — this is the half that makes the row above meaningful.
  assert.equal(compileGlobPattern("a/**/b.js", GLOB_DIALECTS.touches).test("a/x/b.js"), true);
  assert.equal(compileGlobPattern("a/**/b.js", GLOB_DIALECTS.path).test("a/x/b.js"), true);
});

test("without a globstar, `**` behaves exactly like one `*` (rsync/branch: two adjacent stars)", () => {
  assert.equal(compileGlobPattern("a/**", GLOB_DIALECTS.rsync).test("a/b/c"), false, "no globstar ⇒ no `/` crossing");
  assert.equal(compileGlobPattern("a/**", GLOB_DIALECTS.rsync).test("a/b"), true);
  assert.equal(compileGlobPattern("a/**", GLOB_DIALECTS.path).test("a/b/c"), true, "the path dialect's `**` DOES cross");
});

test("`?` is one non-`/` char / ANY char / a LITERAL `?`, per dialect", () => {
  assert.equal(compileGlobPattern("a?c", GLOB_DIALECTS.path).test("abc"), true);
  assert.equal(compileGlobPattern("a?c", GLOB_DIALECTS.path).test("a/c"), false);
  assert.equal(compileGlobPattern("a?c", GLOB_DIALECTS.branch).test("abc"), true);
  assert.equal(compileGlobPattern("a?c", GLOB_DIALECTS.branch).test("a/c"), true, "a ref's `?` may be `/`");
  assert.equal(compileGlobPattern("a?c", GLOB_DIALECTS.rsync).test("abc"), true);
  assert.equal(compileGlobPattern("a?c", GLOB_DIALECTS.rsync).test("a/c"), false);
  assert.equal(compileGlobPattern("a?c", GLOB_DIALECTS.touches).test("a?c"), true, "touches `?` is a literal character");
  assert.equal(compileGlobPattern("a?c", GLOB_DIALECTS.touches).test("abc"), false);
});

test("regex metacharacters in a glob are matched LITERALLY in every dialect", () => {
  for (const d of Object.values(GLOB_DIALECTS)) {
    assert.equal(compileGlobPattern("a/b+c(d).js", d).test("a/b+c(d).js"), true);
    assert.equal(compileGlobPattern("a/b+c(d).js", d).test("a/bXc(d).js"), false, "`+` is literal, not one-or-more");
  }
});

// ── (d) end-to-end wiring: each carrier serves ITS dialect ──────────────────────────────────────

test("carriers: each historical `globToRegExp` keeps its own grammar (measured through the carrier)", async () => {
  const design = await import("../scripts/design-evolution-readings.ts");
  assert.equal(design.globToRegExp("dir/**/*.ts").test("dir/sub/a.ts"), true);
  assert.equal(design.globToRegExp("dir/**/*.ts").test("dir/a.ts"), false, "design's `**` needs its `/`");
  assert.equal(design.globToRegExp("dir/*.ts").test("dir/sub/a.ts"), false);

  const release = await import("../scripts/release-model-check.ts");
  assert.equal(release.globToRegExp("rel/*").test("rel/1.0"), true, "a branch `*` crosses `/`");
  assert.equal(release.globToRegExp("rel/*").test("rel/a/b"), true);
  assert.equal(release.globToRegExp("a?c").test("ac"), false);

  const shipped = await import("../scripts/shipped-set-rules.ts");
  // `ruleMatches` (not the raw compiler) is what applies rsync's basename rule for unanchored
  // patterns; the compiler itself sees the path it is handed and `*` must not cross `/`.
  assert.equal(shipped.globToRegExp("*.test.mjs").test("a.test.mjs"), true);
  assert.equal(shipped.globToRegExp("*.test.mjs").test("deep/a.test.mjs"), false, "rsync's `*` must not cross `/`");
  assert.equal(shipped.ruleMatches({ glob: "*.test.mjs", raw: "*.test.mjs", dirOnly: false, anchored: false }, "deep/a.test.mjs", false), true);
  assert.equal(shipped.globToRegExp("a?c").test("a/c"), false);

  const touches = await import("../scripts/touches-orthogonality-check.ts");
  assert.equal(touches.matchGlob("a/**/b.js", "a/b.js"), true, "touches `**` matches zero directories");
  assert.equal(touches.matchGlob("a/*.js", "a/b/c.js"), false);
  assert.equal(touches.matchGlob("a?c", "a?c"), true, "touches `?` is literal");
});

// ── (e) the mechanism is real: deleting the export must break a consumer ───────────────────────

test("compileGlobPattern: deleting the shared export makes a consumer import fail (the mechanism is real)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "globdialects-negctl-"));
  try {
    fs.writeFileSync(path.join(dir, "gate-script-base.ts"), "export const OTHER = 1;\n");
    fs.writeFileSync(
      path.join(dir, "consumer.ts"),
      'import { compileGlobPattern } from "./gate-script-base.ts";\nconsole.log(compileGlobPattern);\n',
    );
    const missing = spawnSync("node", ["--experimental-strip-types", "consumer.ts"], { cwd: dir, encoding: "utf8" });
    assert.notEqual(missing.status, 0, "a consumer importing an absent export must fail to link");

    fs.writeFileSync(
      path.join(dir, "gate-script-base.ts"),
      "export function compileGlobPattern() { return null; }\n",
    );
    const present = spawnSync("node", ["--experimental-strip-types", "consumer.ts"], { cwd: dir, encoding: "utf8" });
    assert.equal(present.status, 0, "the same consumer links once the export is present");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
