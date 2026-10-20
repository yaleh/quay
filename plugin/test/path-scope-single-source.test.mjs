// @test-group engine
// path-scope-single-source.test.mjs — `pathCandidates` has exactly ONE definition
// (path-scope.ts's), imported and re-exported by BOTH static checkers that resolve path-like tokens
// (threshold-scope-check.ts and tick-core-static-check.ts). That makes "which token counts as a repo
// path" the same judgment in both gates BY CONSTRUCTION.
//
// Regression guard for gap-routine-architecture-analysis-dup-path-candidates: the two checkers each
// carried a byte-identical 28-line copy of the function plus identical TOP_LEVELS / PATH_EXT_RE
// (`.quay/routine-findings.jsonl`, routine architecture-analysis, runId
// architecture-analysis-1792481915389, archguard dup hash 4cf914f3bbd40659, 316 tokens). Two copies
// of a scope-resolution predicate are two answers waiting to drift — a token one gate treats as a
// path and the other does not is how a stale-path check silently stops covering its surface.
//
// Run:
//   scripts/test.sh plugin/test/path-scope-single-source.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pathCandidates } from "../scripts/path-scope.ts";
import { pathCandidates as viaThreshold } from "../scripts/threshold-scope-check.ts";
import { pathCandidates as viaTickCore } from "../scripts/tick-core-static-check.ts";
import { codeOnlyText } from "../scripts/source-text-lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const SCRIPTS_DIR = path.join(repoRoot, "plugin", "scripts");

// ── ① One definition ────────────────────────────────────────────────────────────────────────────────

test("one definition: both checkers' pathCandidates IS path-scope.ts's (a second copy is the drift seam)", () => {
  assert.equal(
    viaThreshold,
    pathCandidates,
    "threshold-scope-check.ts must RE-EXPORT path-scope.ts's pathCandidates, not carry its own copy",
  );
  assert.equal(
    viaTickCore,
    pathCandidates,
    "tick-core-static-check.ts must RE-EXPORT path-scope.ts's pathCandidates, not carry its own copy",
  );
  assert.equal(viaThreshold, viaTickCore, "the two checkers must resolve path tokens with the SAME function");
});

// ── ② No second definition, by POSITION (a comment mentioning the name is not a copy) ───────────────

test("no second definition: exactly one plugin/scripts file DEFINES pathCandidates", () => {
  const DEFINITION_RE = /(?:export\s+)?function\s+pathCandidates\s*\(/;

  // 硬规则 2, both halves: the predicate must FIRE on a known-true definition, and must NOT fire when
  // the same text sits in a comment — otherwise "exactly one definition site" below would be
  // indistinguishable from a regex that matches nothing (or matches comments).
  const sample = "export function pathCandidates(token: string): string[] { return []; }";
  assert.ok(DEFINITION_RE.test(codeOnlyText(sample)), "the predicate must fire on a real definition");
  assert.ok(!DEFINITION_RE.test(codeOnlyText(`// ${sample}`)), "…and be blind to it inside a line comment");
  assert.ok(!DEFINITION_RE.test(codeOnlyText(`/* ${sample} */`)), "…and inside a block comment");

  const defining = [];
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (!name.endsWith(".ts")) continue;
    // 硬规则 2: judge by POSITION — the name inside a comment is not a definition.
    if (DEFINITION_RE.test(codeOnlyText(fs.readFileSync(path.join(SCRIPTS_DIR, name), "utf8")))) {
      defining.push(name);
    }
  }
  assert.deepEqual(
    defining,
    ["path-scope.ts"],
    `pathCandidates must have exactly one definition site (got ${defining.join(", ") || "∅"}) — ` +
      `a second copy is exactly how the two checkers' scope-resolution semantics drift apart`,
  );
});

// ── ③ The shared predicate keeps the behavior both copies had ──────────────────────────────────────

test("behavior: line-number citations resolve to their base path; bare basenames only when filename-shaped", () => {
  // NB: callers pass the BACKTICK-STRIPPED token (the regex captures the inner text), so the inputs
  // below are raw tokens, not "`…`" literals.
  assert.deepEqual(
    pathCandidates("quay-init.sh:1011"),
    ["quay-init.sh"],
    "a trailing `:NNN` is a citation, not part of the path",
  );
  assert.deepEqual(
    pathCandidates("orchestration/orchestrator-loop-tick.md:302"),
    ["orchestration/orchestrator-loop-tick.md"],
  );
  assert.deepEqual(pathCandidates("lifecycle.ts"), ["lifecycle.ts"], "bare filename-shaped basename");
  assert.deepEqual(pathCandidates("plugin/scripts/path-scope.ts"), ["plugin/scripts/path-scope.ts"]);
  assert.deepEqual(pathCandidates("packages/quay"), ["packages/quay"], "known top-level, no extension");
});

// ── ④ It is a real filter: the same call also comes back empty ─────────────────────────────────────

test("behavior: absolute/home/numeric/shell-word/extension-only tokens are NOT paths", () => {
  // Negative control: without this arm the assertions in ③ could be satisfied by "split every word".
  assert.deepEqual(pathCandidates(""), [], "empty token ⇒ no candidates");
  assert.deepEqual(pathCandidates("/tmp/x.ts"), [], "absolute paths are not repo-relative");
  assert.deepEqual(pathCandidates("~/.claude/settings.json"), [], "home paths are not repo-relative");
  assert.deepEqual(pathCandidates("nproc / 1.0"), [], "a math expression is not a path");
  assert.deepEqual(pathCandidates(".mjs"), [], "a pure extension mention is not a filename");
  assert.deepEqual(pathCandidates("pgrep --json"), [], "shell words / flags are not paths");
  assert.deepEqual(pathCandidates("0.5"), [], "a numeric fragment is not a path");
});
