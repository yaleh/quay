/**
 * derive-touches-heuristic.test — sibling test for derive-touches-heuristic.ts (DIR-113 item 1).
 * Run: node --experimental-strip-types --test experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.test.ts
 * Coverage: node --experimental-strip-types --experimental-test-coverage --test <this file>
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  looksLikePath,
  extractPathTokens,
  walkRepo,
  resolveBareFilenames,
  deriveTouches,
  renderTouchesSection,
} from "./derive-touches-heuristic.ts";
import { repoRoot } from "./repo-root.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = repoRoot(__dirname);
const scriptPath = path.join(__dirname, "derive-touches-heuristic.ts");

// ── looksLikePath ────────────────────────────────────────────────────────────────────────────────

test("looksLikePath: accepts a slashed path", () => {
  assert.equal(looksLikePath("packages/quay/src/gate/engine.ts"), true);
});

test("looksLikePath: accepts a bare filename with a recognized extension", () => {
  assert.equal(looksLikePath("CLAUDE.md"), true);
  assert.equal(looksLikePath("scripts/test.sh"), true);
});

test("looksLikePath: rejects a bare word with no extension", () => {
  assert.equal(looksLikePath("execution"), false);
});

test("looksLikePath: rejects empty / whitespace-containing tokens", () => {
  assert.equal(looksLikePath(""), false);
  assert.equal(looksLikePath("   "), false);
  assert.equal(looksLikePath("two words"), false);
});

test("looksLikePath: rejects shell/HTML-ish tokens", () => {
  assert.equal(looksLikePath("$HOME/foo.ts"), false);
  assert.equal(looksLikePath("<div>"), false);
  assert.equal(looksLikePath("a|b"), false);
});

// ── extractPathTokens ────────────────────────────────────────────────────────────────────────────

test("extractPathTokens: pulls backtick-quoted paths out of prose", () => {
  const text = "Update `CLAUDE.md`'s Commands section and `.github/workflows/ci.yml`'s test step.";
  const tokens = extractPathTokens(text);
  assert.ok(tokens.includes("CLAUDE.md"), JSON.stringify(tokens));
  assert.ok(tokens.includes(".github/workflows/ci.yml"), JSON.stringify(tokens));
});

test("extractPathTokens: splits a multi-path code span on whitespace", () => {
  const text = "It owns the test-file glob (`packages/*/test/*.test.mjs plugin/test/*.test.mjs`).";
  const tokens = extractPathTokens(text);
  // "packages/*/test/*.test.mjs" has only 1 concrete segment before its first wildcard ->
  // overbroad (isOverbroadDeclaration) -> dropped. "plugin/test/*.test.mjs" has 2 concrete
  // segments before its wildcard -> precise enough -> kept, and split out as its own token.
  assert.equal(tokens.includes("packages/*/test/*.test.mjs"), false);
  assert.ok(tokens.includes("plugin/test/*.test.mjs"), JSON.stringify(tokens));
});

test("extractPathTokens: drops non-path backtick spans (commands, prose)", () => {
  const text = "Run `npm test` then check `status`.";
  const tokens = extractPathTokens(text);
  assert.deepEqual(tokens, []);
});

test("extractPathTokens: dedupes repeated mentions", () => {
  const text = "See `scripts/test.sh`. Also `scripts/test.sh` again.";
  const tokens = extractPathTokens(text);
  assert.deepEqual(tokens, ["scripts/test.sh"]);
});

test("extractPathTokens: strips a leading './' and trailing punctuation", () => {
  const text = "Look at `./scripts/test.sh`, and `CLAUDE.md`.";
  const tokens = extractPathTokens(text);
  assert.ok(tokens.includes("scripts/test.sh"), JSON.stringify(tokens));
  assert.ok(tokens.includes("CLAUDE.md"), JSON.stringify(tokens));
});

// ── walkRepo ─────────────────────────────────────────────────────────────────────────────────────

test("walkRepo: finds real files under a scratch tree, skips SKIP_DIR_NAMES", () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "walkrepo-"));
  try {
    fs.mkdirSync(path.join(tmp, "a", "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "a", "worktrees"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "a", "keep.ts"), "x");
    fs.writeFileSync(path.join(tmp, "a", "node_modules", "skip.ts"), "x");
    fs.writeFileSync(path.join(tmp, "a", "worktrees", "skip.ts"), "x");
    const files = walkRepo(tmp);
    assert.ok(files.includes("a/keep.ts"), JSON.stringify(files));
    assert.equal(files.some((f) => f.includes("node_modules")), false);
    assert.equal(files.some((f) => f.includes("worktrees")), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("walkRepo: tolerates an unreadable root (returns empty, does not throw)", () => {
  const files = walkRepo(path.join("/nonexistent-derive-touches-root", String(Date.now())));
  assert.deepEqual(files, []);
});

// ── resolveBareFilenames ─────────────────────────────────────────────────────────────────────────

test("resolveBareFilenames: passes through already-slashed tokens unchanged", () => {
  const r = resolveBareFilenames(["a/b/c.ts"], ["a/b/c.ts", "x/c.ts"]);
  assert.deepEqual(r.resolved, ["a/b/c.ts"]);
  assert.deepEqual(r.unresolved, []);
});

test("resolveBareFilenames: resolves a bare filename with exactly one match", () => {
  const r = resolveBareFilenames(["CLAUDE.md"], ["CLAUDE.md", "packages/quay/src/x.ts"]);
  assert.deepEqual(r.resolved, ["CLAUDE.md"]);
});

test("resolveBareFilenames: drops a bare filename with zero matches", () => {
  const r = resolveBareFilenames(["missing.md"], ["CLAUDE.md"]);
  assert.deepEqual(r.resolved, []);
  assert.deepEqual(r.unresolved, ["missing.md"]);
});

test("resolveBareFilenames: drops a bare filename with >1 (ambiguous) matches, does not guess", () => {
  const r = resolveBareFilenames(["dup.md"], ["a/dup.md", "b/dup.md"]);
  assert.deepEqual(r.resolved, []);
  assert.deepEqual(r.unresolved, ["dup.md"]);
});

// ── renderTouchesSection ─────────────────────────────────────────────────────────────────────────

test("renderTouchesSection: renders a heading + auto-derived annotation + bullet list", () => {
  const out = renderTouchesSection(["a/b.ts", "c/d.md"]);
  assert.match(out, /^## Touches/);
  assert.match(out, /auto-derived, unverified/);
  assert.match(out, /- `a\/b\.ts`/);
  assert.match(out, /- `c\/d\.md`/);
});

test("renderTouchesSection: empty glob list still renders a valid (empty) section", () => {
  const out = renderTouchesSection([]);
  assert.match(out, /^## Touches/);
});

// ── deriveTouches: fixture-level pipeline test ──────────────────────────────────────────────────

test("deriveTouches: end-to-end against a scratch repo + fixture body", () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "derive-touches-"));
  try {
    fs.mkdirSync(path.join(tmp, "packages", "quay", "test"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "packages", "quay", "test", "foo.test.mjs"), "x");
    fs.writeFileSync(path.join(tmp, "CLAUDE.md"), "x");
    const body = [
      "## Requested action",
      "1. Update `foo.test.mjs` to add a skip.",
      "2. Update `CLAUDE.md`'s Commands section.",
      "3. Create `scripts/new-thing.sh` (new).",
    ].join("\n");
    const { globs, unresolved } = deriveTouches(body, tmp);
    assert.ok(globs.includes("packages/quay/test/foo.test.mjs"), JSON.stringify(globs));
    assert.ok(globs.includes("CLAUDE.md"), JSON.stringify(globs));
    assert.ok(globs.includes("scripts/new-thing.sh"), JSON.stringify(globs));
    assert.deepEqual(unresolved, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("deriveTouches: an ambiguous bare filename is reported unresolved, not guessed", () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "derive-touches-ambig-"));
  try {
    fs.mkdirSync(path.join(tmp, "a"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "b"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "a", "dup.md"), "x");
    fs.writeFileSync(path.join(tmp, "b", "dup.md"), "x");
    const body = "See `dup.md` for details.";
    const { globs, unresolved } = deriveTouches(body, tmp);
    assert.deepEqual(globs, []);
    assert.deepEqual(unresolved, ["dup.md"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── The DIR-113 AC1 concrete demonstration ──────────────────────────────────────────────────────
// DIR-109's pre-charter-authoring task body (commit 15d58e9, before the M173 charter existed) fed
// through deriveTouches() against the REAL repo tree must be a SUPERSET of the Touches list the
// M173 charter actually landed with (charters/M173-dir109-canonical-test-runner.md):
//   scripts/test.sh, packages/quay/test/serve-github.test.mjs,
//   packages/quay/test/provider-abi-conformance.test.mjs,
//   packages/quay/test/cli-edit-parity-conformance.test.mjs, CLAUDE.md, .github/workflows/ci.yml

const DIR_109_PRE_CHARTER_BODY = `
## Finding

ADR-019 (\`adr/ADR-019-test-taxonomy-is-structural-in-file-skip-one-canonical-runne.md\`) records
that this repo's test taxonomy lives only in duplicated, hand-written prose: the 3 live/conformance
test files (\`serve-github.test.mjs\`, \`provider-abi-conformance.test.mjs\`,
\`cli-edit-parity-conformance.test.mjs\`) are excluded from offline runs by a
\`grep -vE 'serve-github|provider-abi-conformance|cli-edit-parity-conformance'\` pattern written out
independently in BOTH \`CLAUDE.md\` and \`.github/workflows/ci.yml\` — nothing keeps the two copies in
sync.

## Requested action

1. Give each of the 3 live/conformance test files an in-file skip declaration —
   \`test(name, {skip: <condition>}, fn)\` (or an equivalent file-level early guard) — gated on a
   concrete, checkable condition (env var presence and/or a cheap reachability probe), so the file
   is safe to include in a default, credential-less glob run.
2. Create \`scripts/test.sh\`: the single canonical invocation script. It owns the test-file glob
   (\`packages/*/test/*.test.mjs plugin/test/*.test.mjs\`) and defaults to \`--test-concurrency=8\`.
3. Update \`CLAUDE.md\`'s Commands section to document \`scripts/test.sh\` as the canonical entrypoint,
   removing the hand-written glob/grep prose.
4. Update \`.github/workflows/ci.yml\`'s test step to invoke \`scripts/test.sh\` instead of its own
   copy of the glob/grep command.
`;

const M173_CHARTER_LANDED_TOUCHES = [
  "scripts/test.sh",
  "packages/quay/test/serve-github.test.mjs",
  "packages/quay/test/provider-abi-conformance.test.mjs",
  "packages/quay/test/cli-edit-parity-conformance.test.mjs",
  "CLAUDE.md",
  ".github/workflows/ci.yml",
];

test("DIR-113 AC1: DIR-109 pre-charter body extraction is a superset of the M173-landed Touches", () => {
  const { globs, unresolved } = deriveTouches(DIR_109_PRE_CHARTER_BODY, rootDir);
  const missing = M173_CHARTER_LANDED_TOUCHES.filter((t) => !globs.includes(t));
  assert.deepEqual(missing, [], `derived globs=${JSON.stringify(globs)} unresolved=${JSON.stringify(unresolved)} missing=${JSON.stringify(missing)}`);
});

// ── CLI end-to-end (exercises main()/usage() paths for coverage) ───────────────────────────────

test("CLI: derive-touches-heuristic.ts on a real fixture file prints a ## Touches block", () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "derive-touches-cli-"));
  try {
    const taskFile = path.join(tmp, "FAKE-TASK.md");
    fs.writeFileSync(
      taskFile,
      "## Requested action\n\n1. Update `CLAUDE.md` and `scripts/test.sh`.\n",
      "utf8",
    );
    const out = execFileSync(
      "node",
      ["--experimental-strip-types", scriptPath, taskFile, "--root", rootDir],
      { encoding: "utf8" },
    );
    assert.match(out, /^## Touches/);
    assert.match(out, /`CLAUDE\.md`/);
    assert.match(out, /`scripts\/test\.sh`/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI: usage error (no file arg) exits 2", () => {
  assert.throws(() => {
    execFileSync("node", ["--experimental-strip-types", scriptPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }, (err: any) => err.status === 2);
});

test("CLI: unreadable file exits 2 with an ERROR message", () => {
  let threw = false;
  try {
    execFileSync("node", ["--experimental-strip-types", scriptPath, "/nonexistent-derive-touches-file.md"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e: any) {
    threw = true;
    assert.equal(e.status, 2);
    assert.match(String(e.stderr), /ERROR: cannot read/);
  }
  assert.equal(threw, true);
});
