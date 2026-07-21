// Unit tests for touches-orthogonality-check.mjs — the single-source milestone-`touches`
// disjointness check (DIR-044 increment 1, the concurrent-scheduler pre-flight). Written RED-first
// (ADR-001 / DIR-019 discipline): the fix for any failing case belongs in the MODULE, never in the
// fixtures. The check is CONSERVATIVE — it declares disjoint ONLY when it can prove two milestones'
// declared `touches` file-sets do not intersect; anything ambiguous → overlap (serialize).
// Run:
//   node --test experiments/quay-perpetual-stream/test/touches-orthogonality-check.test.mjs
//   node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/touches-orthogonality-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTouches,
  matchGlob,
  walkFiles,
  expandGlobs,
  filesDisjoint,
  checkTouchesPair,
  findRepoRoot,
  main,
} from "../scripts/touches-orthogonality-check.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "..", "fixtures", "touches");
const REPO_ROOT = path.resolve(__dirname, "..", "..", ".."); // experiments/quay-perpetual-stream/test → repo root
const read = (f) => fs.readFileSync(path.join(FIX, f), "utf8");
const fx = (f) => path.join(FIX, f);

// ── parseTouches ─────────────────────────────────────────────────────────────────────────────────
test("parseTouches: bullet-list section → globs, hasSection true", () => {
  const t = parseTouches("## Touches\n- packages/quay/src/a.js\n- packages/quay-native/src/**\n\n## Next\nx");
  assert.equal(t.hasSection, true);
  assert.deepEqual(t.globs, ["packages/quay/src/a.js", "packages/quay-native/src/**"]);
});

test("parseTouches: no section → hasSection false, empty globs", () => {
  const t = parseTouches("## Proposal\nnothing here\n## Plan\nN/A");
  assert.equal(t.hasSection, false);
  assert.deepEqual(t.globs, []);
});

test("parseTouches: section present but empty → hasSection true, empty globs", () => {
  const t = parseTouches("## Touches\n\n## Next\nx");
  assert.equal(t.hasSection, true);
  assert.deepEqual(t.globs, []);
});

test("parseTouches: tolerates `* ` bullets and leading ./", () => {
  const t = parseTouches("## Touches\n* ./packages/a.js\n- packages/b.js");
  assert.deepEqual(t.globs, ["packages/a.js", "packages/b.js"]);
});

// ── matchGlob ────────────────────────────────────────────────────────────────────────────────────
test("matchGlob: exact match", () => {
  assert.equal(matchGlob("a/b/c.js", "a/b/c.js"), true);
  assert.equal(matchGlob("a/b/c.js", "a/b/d.js"), false);
});

test("matchGlob: * does not cross a path separator", () => {
  assert.equal(matchGlob("a/*.js", "a/c.js"), true);
  assert.equal(matchGlob("a/*.js", "a/b/c.js"), false);
});

test("matchGlob: ** crosses separators", () => {
  assert.equal(matchGlob("a/**", "a/b/c.js"), true);
  assert.equal(matchGlob("a/**/*.js", "a/b/c.js"), true);
  assert.equal(matchGlob("a/**", "z/b/c.js"), false);
});

test("matchGlob: regex-special chars in a path are matched literally, not as regex", () => {
  // a path with regex metacharacters must be escaped (globToRegExp escape branch)
  assert.equal(matchGlob("a/b+c(d).js", "a/b+c(d).js"), true);
  assert.equal(matchGlob("a/b+c(d).js", "a/bXc(d).js"), false); // '+' is literal, not "one-or-more"
});

// ── filesDisjoint ────────────────────────────────────────────────────────────────────────────────
test("filesDisjoint: no intersection → disjoint", () => {
  const r = filesDisjoint(new Set(["a.js", "b.js"]), new Set(["c.js"]));
  assert.equal(r.disjoint, true);
  assert.deepEqual(r.overlaps, []);
});

test("filesDisjoint: shared file → not disjoint, overlap listed", () => {
  const r = filesDisjoint(new Set(["a.js", "shared.js"]), new Set(["shared.js", "z.js"]));
  assert.equal(r.disjoint, false);
  assert.deepEqual(r.overlaps, ["shared.js"]);
});

// ── expandGlobs over a real temp tree ────────────────────────────────────────────────────────────
test("walkFiles + expandGlobs: real temp tree", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "touches-"));
  fs.mkdirSync(path.join(root, "alpha"), { recursive: true });
  fs.mkdirSync(path.join(root, "beta"), { recursive: true });
  fs.writeFileSync(path.join(root, "alpha", "a1.js"), "");
  fs.writeFileSync(path.join(root, "alpha", "a2.js"), "");
  fs.writeFileSync(path.join(root, "beta", "b1.js"), "");
  const all = walkFiles(root);
  assert.ok(all.includes("alpha/a1.js") && all.includes("beta/b1.js"));
  const set = expandGlobs(["alpha/*.js"], root);
  assert.deepEqual([...set].sort(), ["alpha/a1.js", "alpha/a2.js"]);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── checkTouchesPair (the orchestrator + conservative defaults) ───────────────────────────────────
// A fake expander maps a glob → file set, so the orchestrator logic is tested hermetically.
const fakeExpand = (mapping) => (globs) => {
  const out = new Set();
  for (const g of globs) for (const f of (mapping[g] || [])) out.add(f);
  return out;
};

test("checkTouchesPair: disjoint declared file-sets → disjoint", () => {
  const A = parseTouches("## Touches\n- x/a.js");
  const B = parseTouches("## Touches\n- y/b.js");
  const r = checkTouchesPair(A, B, fakeExpand({ "x/a.js": ["x/a.js"], "y/b.js": ["y/b.js"] }));
  assert.equal(r.disjoint, true);
});

test("checkTouchesPair: overlapping expansion → not disjoint, overlap reported", () => {
  const A = parseTouches("## Touches\n- g/reg.js");
  const B = parseTouches("## Touches\n- g/**");
  const r = checkTouchesPair(A, B, fakeExpand({ "g/reg.js": ["g/reg.js"], "g/**": ["g/reg.js", "g/x.js"] }));
  assert.equal(r.disjoint, false);
  assert.deepEqual(r.overlaps, ["g/reg.js"]);
});

test("checkTouchesPair: absent touches on either side → CONSERVATIVE not-disjoint", () => {
  const A = parseTouches("## Touches\n- x/a.js");
  const none = parseTouches("## Proposal\nno touches section");
  const r = checkTouchesPair(A, none, fakeExpand({ "x/a.js": ["x/a.js"] }));
  assert.equal(r.disjoint, false);
  assert.match(r.reason, /conservative/i);
});

test("checkTouchesPair: overbroad glob (**) → CONSERVATIVE not-disjoint", () => {
  const A = parseTouches("## Touches\n- **");
  const B = parseTouches("## Touches\n- y/b.js");
  const r = checkTouchesPair(A, B, fakeExpand({ "**": [], "y/b.js": ["y/b.js"] }));
  assert.equal(r.disjoint, false);
  assert.match(r.reason, /overbroad/i);
});

test("checkTouchesPair: a glob matching NOTHING → CONSERVATIVE not-disjoint (likely typo)", () => {
  const A = parseTouches("## Touches\n- x/typo.js");
  const B = parseTouches("## Touches\n- y/b.js");
  const r = checkTouchesPair(A, B, fakeExpand({ "x/typo.js": [], "y/b.js": ["y/b.js"] }));
  assert.equal(r.disjoint, false);
  assert.match(r.reason, /matched nothing|empty/i);
});

// ── fixture charters (the selfcheck's objects) parse as expected ──────────────────────────────────
test("fixture charters carry the touches sections the selfcheck relies on", () => {
  assert.equal(parseTouches(read("disjoint-a.md")).globs.length >= 1, true);
  assert.equal(parseTouches(read("overlap-a.md")).globs.length >= 1, true);
  assert.equal(parseTouches(read("no-touches.md")).hasSection, false);
});

// ── findRepoRoot ─────────────────────────────────────────────────────────────────────────────────
test("findRepoRoot: walks up to the dir containing .git", () => {
  assert.equal(findRepoRoot(__dirname), REPO_ROOT);
});

// ── main() end-to-end, in-process (covers the CLI orchestration) ──────────────────────────────────
test("main: disjoint pair → exit 0", async () => {
  assert.equal(await main(["node", "s", "--root", REPO_ROOT, fx("disjoint-a.md"), fx("disjoint-b.md")]), 0);
});

test("main: overlapping pair → exit 1", async () => {
  assert.equal(await main(["node", "s", "--root", REPO_ROOT, fx("overlap-a.md"), fx("overlap-b.md")]), 1);
});

test("main: absent-touches pair → conservative exit 1", async () => {
  assert.equal(await main(["node", "s", "--root", REPO_ROOT, fx("disjoint-a.md"), fx("no-touches.md")]), 1);
});

test("main: wrong arg count → usage, exit 2", async () => {
  assert.equal(await main(["node", "s", fx("disjoint-a.md")]), 2);
});

test("main: missing charter file → exit 2", async () => {
  assert.equal(await main(["node", "s", "--root", REPO_ROOT, fx("disjoint-a.md"), fx("does-not-exist.md")]), 2);
});

test("main: no --root falls back to findRepoRoot (real repo expansion)", async () => {
  assert.equal(await main(["node", "s", fx("disjoint-a.md"), fx("disjoint-b.md")]), 0);
});
