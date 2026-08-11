// @test-group engine
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
  isOverbroadDeclaration,
  main,
  touchExists,
  checkTouchesResolve,
  checkTaskTouchesResolve,
} from "../scripts/touches-orthogonality-check.ts";
import { parseTouchEntriesWithTags } from "../scripts/touches-parser.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Canonical home is plugin/test (the experiments path is a symlink back here); the fixtures live in
// the experiment's fixture tree (shared with touches-orthogonality-selfcheck.sh, which runs from the
// experiment root).
const FIX = path.join(__dirname, "..", "..", "experiments", "quay-perpetual-stream", "fixtures", "touches");
const REPO_ROOT = path.resolve(__dirname, "..", ".."); // plugin/test → repo root
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
  const A = parseTouches("## Touches\n- g/sub/reg.js");
  const B = parseTouches("## Touches\n- g/sub/**"); // depth-2 glob: a legitimate narrow scope, not overbroad
  const r = checkTouchesPair(A, B, fakeExpand({ "g/sub/reg.js": ["g/sub/reg.js"], "g/sub/**": ["g/sub/reg.js", "g/sub/x.js"] }));
  assert.equal(r.disjoint, false);
  assert.deepEqual(r.overlaps, ["g/sub/reg.js"]);
});

test("checkTouchesPair: a single-top-segment /** declaration is overbroad → conservative serialize", () => {
  const A = parseTouches("## Touches\n- packages/**"); // one top segment + /** → too broad to batch
  const B = parseTouches("## Touches\n- y/b.js");
  const r = checkTouchesPair(A, B, fakeExpand({ "packages/**": ["packages/x.js"], "y/b.js": ["y/b.js"] }));
  assert.equal(r.disjoint, false);
  assert.match(r.reason, /overbroad/i);
});

// ── isOverbroadDeclaration (single-source predicate, shared with anti-drift) ───────────────────────
test("isOverbroadDeclaration: SEMANTIC anchoring-depth rule (<2 concrete segments before a wildcard)", () => {
  // overbroad — fewer than 2 concrete leading segments before the first wildcard
  assert.equal(isOverbroadDeclaration("**"), true);
  assert.equal(isOverbroadDeclaration("*"), true);
  assert.equal(isOverbroadDeclaration("packages/**"), true);
  assert.equal(isOverbroadDeclaration("./tasks/**"), true);       // leading ./ stripped
  // the increment-5 audit's evasions of the old syntactic rule — all must now be caught:
  assert.equal(isOverbroadDeclaration("packages/**/*"), true);
  assert.equal(isOverbroadDeclaration("**/*.js"), true);
  assert.equal(isOverbroadDeclaration("packages//**"), true);     // // collapsed
  assert.equal(isOverbroadDeclaration("packages/*/**"), true);    // first wildcard at depth 1
  // precise — ≥2 concrete leading segments, or an exact path at any depth
  assert.equal(isOverbroadDeclaration("packages/quay/**"), false);
  assert.equal(isOverbroadDeclaration("packages/quay/src/gate/registry.js"), false);
  assert.equal(isOverbroadDeclaration("packages/quay/src/gate/*.js"), false);
  assert.equal(isOverbroadDeclaration("a/b/**/*.js"), false);
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

// ── outer-inflight occupancy (AC4 of gap-write-ownership-extend-beyond-tasks-to-outer-core-and-hot-files) ──
// A task whose declared expansion intersects an outer in-flight edit must serialize — inner and outer
// editing the same hot file (e.g. full-suite-runner.ts) in the same window is an add/add at fan-in.
import { checkOuterInflight, checkDispatchEligibility } from "../scripts/touches-orthogonality-check.ts";

test("checkOuterInflight: no outer-inflight files → ok, nothing blocked", () => {
  const A = parseTouches("## Touches\n- x/a.js");
  const r = checkOuterInflight(A, [], fakeExpand({ "x/a.js": ["x/a.js"] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.blocked, []);
});

test("checkOuterInflight: task expansion intersects an outer-inflight path → blocked", () => {
  const A = parseTouches("## Touches\n- plugin/scripts/full-suite-runner.ts");
  const expand = fakeExpand({ "plugin/scripts/full-suite-runner.ts": ["plugin/scripts/full-suite-runner.ts"] });
  const r = checkOuterInflight(A, ["plugin/scripts/full-suite-runner.ts"], expand);
  assert.equal(r.ok, false);
  assert.deepEqual(r.blocked, ["plugin/scripts/full-suite-runner.ts"]);
});

test("checkOuterInflight: task expansion disjoint from outer-inflight paths → ok", () => {
  const A = parseTouches("## Touches\n- plugin/scripts/a.ts");
  const expand = fakeExpand({ "plugin/scripts/a.ts": ["plugin/scripts/a.ts"] });
  const r = checkOuterInflight(A, ["plugin/scripts/full-suite-runner.ts"], expand);
  assert.equal(r.ok, true);
  assert.deepEqual(r.blocked, []);
});

test("checkOuterInflight: a task glob expansion overlapping the outer path → blocked", () => {
  const A = parseTouches("## Touches\n- plugin/scripts/full-suite-*");
  const expand = fakeExpand({ "plugin/scripts/full-suite-*": ["plugin/scripts/full-suite-runner.ts"] });
  const r = checkOuterInflight(A, ["plugin/scripts/full-suite-runner.ts"], expand);
  assert.equal(r.ok, false);
  assert.deepEqual(r.blocked, ["plugin/scripts/full-suite-runner.ts"]);
});

test("checkOuterInflight: normalizePath collapses ./ on the OUTER path so the occupancy match is not spoofable", () => {
  const A = parseTouches("## Touches\n- plugin/scripts/full-suite-runner.ts");
  const expand = fakeExpand({ "plugin/scripts/full-suite-runner.ts": ["plugin/scripts/full-suite-runner.ts"] });
  // outer reports its in-flight path with a leading ./ — normalizePath must collapse it so the match hits
  const r = checkOuterInflight(A, ["./plugin/scripts/full-suite-runner.ts"], expand);
  assert.equal(r.ok, false);
  assert.deepEqual(r.blocked, ["plugin/scripts/full-suite-runner.ts"]);
});

test("checkDispatchEligibility: mutually disjoint pair with NO outer-inflight → disjoint", () => {
  const A = parseTouches("## Touches\n- x/a.js");
  const B = parseTouches("## Touches\n- y/b.js");
  const r = checkDispatchEligibility(A, B, [], fakeExpand({ "x/a.js": ["x/a.js"], "y/b.js": ["y/b.js"] }));
  assert.equal(r.disjoint, true);
});

test("checkDispatchEligibility: pair disjoint but side A collides with outer-inflight → serialize", () => {
  const A = parseTouches("## Touches\n- plugin/scripts/full-suite-runner.ts");
  const B = parseTouches("## Touches\n- y/b.js");
  const expand = fakeExpand({
    "plugin/scripts/full-suite-runner.ts": ["plugin/scripts/full-suite-runner.ts"],
    "y/b.js": ["y/b.js"],
  });
  const r = checkDispatchEligibility(A, B, ["plugin/scripts/full-suite-runner.ts"], expand);
  assert.equal(r.disjoint, false);
  assert.match(r.reason, /outer-inflight/);
  assert.deepEqual(r.overlaps, ["plugin/scripts/full-suite-runner.ts"]);
});

test("checkDispatchEligibility: pair itself overlaps → serialize (outer-inflight not even consulted)", () => {
  const A = parseTouches("## Touches\n- x/a.js");
  const B = parseTouches("## Touches\n- x/a.js");
  const r = checkDispatchEligibility(A, B, [], fakeExpand({ "x/a.js": ["x/a.js"] }));
  assert.equal(r.disjoint, false);
});

test("main --check-pair: disjoint pair with non-intersecting outer-inflight → exit 0", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "touches-outer-"));
  try {
    fs.mkdirSync(path.join(root, "x"), { recursive: true });
    fs.writeFileSync(path.join(root, "a.md"), "## Touches\n- x/a.js\n");
    fs.writeFileSync(path.join(root, "b.md"), "## Touches\n- y/b.js\n");
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "full-suite-runner.ts"), "");
    fs.writeFileSync(path.join(root, "x", "a.js"), "");
    fs.mkdirSync(path.join(root, "y"), { recursive: true });
    fs.writeFileSync(path.join(root, "y", "b.js"), "");
    const code = await main(["node", "s", "--check-pair", "--root", root, path.join(root, "a.md"), path.join(root, "b.md"), "--outer-inflight", "plugin/scripts/full-suite-runner.ts"]);
    assert.equal(code, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("main --check-pair: side collides with an outer-inflight path → exit 1 (outer 占用拒绝)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "touches-outer-"));
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "full-suite-runner.ts"), "");
    fs.writeFileSync(path.join(root, "a.md"), "## Touches\n- plugin/scripts/full-suite-runner.ts\n");
    fs.writeFileSync(path.join(root, "b.md"), "## Touches\n- y/b.js\n");
    fs.mkdirSync(path.join(root, "y"), { recursive: true });
    fs.writeFileSync(path.join(root, "y", "b.js"), "");
    const code = await main(["node", "s", "--check-pair", "--root", root, path.join(root, "a.md"), path.join(root, "b.md"), "--outer-inflight", "plugin/scripts/full-suite-runner.ts"]);
    assert.equal(code, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

// ── touchExists / checkTouchesResolve (gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files) ──
// A dispatch-eligibility resolve check COMPLEMENTING checkTouchesPair: a `status:ready` task whose
// `## Touches` majority-resolve to nonexistent files (ADR-022 deleted them) must be flagged, not
// silently dispatched. `(new)` touches are exempt (the task will create them).
function makeTempTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "touches-resolve-"));
  for (const f of files) {
    const abs = path.join(root, f);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "");
  }
  return root;
}

test("touchExists: exact existing path → true, missing → false", () => {
  const root = makeTempTree(["a/b.js", "c.ts"]);
  try {
    assert.equal(touchExists("a/b.js", root), true);
    assert.equal(touchExists("a/missing.js", root), false);
    assert.equal(touchExists("c.ts", root), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("touchExists: glob matches → true; glob matches nothing → false", () => {
  const root = makeTempTree(["packages/quay/src/gate/registry.js", "packages/quay/src/gate/utils.js"]);
  try {
    assert.equal(touchExists("packages/quay/src/gate/*.js", root), true);
    assert.equal(touchExists("packages/quay/src/gate/**", root), true);
    assert.equal(touchExists("packages/quay/src/**/missing.js", root), false);
    // trailing-slash directory glob → `**` appended (DIR-106 Fix 3 semantics)
    assert.equal(touchExists("packages/quay/", root), true);
    assert.equal(touchExists("packages/other/", root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkTouchesResolve: majority-missing flag only when > half of must-exist entries are gone", () => {
  const root = makeTempTree(["live/a.js", "live/b.js"]);
  try {
    const entries = (paths) => paths.map((p) => ({ path: p, tag: null }));
    // 2 live of 3 → not majority → resolves
    assert.equal(checkTouchesResolve(entries(["live/a.js", "live/b.js", "gone/x.js"]), root).majorityMissing, false);
    // 1 live of 3 → majority missing → flagged
    const r = checkTouchesResolve(entries(["live/a.js", "gone/x.js", "gone/y.js"]), root);
    assert.equal(r.majorityMissing, true);
    assert.equal(r.missing, 2);
    assert.equal(r.mustExist, 3);
    // tie (2 of 4) → not majority
    assert.equal(checkTouchesResolve(entries(["live/a.js", "live/b.js", "gone/x.js", "gone/y.js"]), root).majorityMissing, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkTouchesResolve: (new) and (delete) touches are exempt — never counted as missing, never flagged", () => {
  const root = makeTempTree(["real/existing.ts"]);
  try {
    const entries = [
      { path: "brand/new.ts", tag: "new" },
      { path: "brand/other.ts", tag: "delete" }, // target need not exist to be deleted
      { path: "real/existing.ts", tag: null }, // must-exist, present
    ];
    const r = checkTouchesResolve(entries, root);
    assert.equal(r.mustExist, 1); // the (new) and (delete) entries do NOT count
    assert.equal(r.missing, 0);
    assert.equal(r.majorityMissing, false);
    assert.equal(r.results[0].exists, null); // (new) → skipped
    assert.equal(r.results[1].exists, null); // (delete) → skipped
    // Same shape but the ONE must-exist entry missing → 1/1 = majority (tags still exempt)
    const r2 = checkTouchesResolve(
      [{ path: "brand/new.ts", tag: "new" }, { path: "real/gone.ts", tag: null }],
      root,
    );
    assert.equal(r2.majorityMissing, true);
    assert.equal(r2.missing, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkTouchesResolve: a (delete) touch on an already-deleted file does not count as missing", () => {
  const root = makeTempTree([]); // empty tree
  try {
    const entries = [
      { path: "retired/a.js", tag: "delete" }, // file already gone; delete is a no-op → exempt
      { path: "real/live.js", tag: null },     // must-exist, missing → 1/1 = majority
    ];
    const r = checkTouchesResolve(entries, root);
    assert.equal(r.mustExist, 1);
    assert.equal(r.missing, 1);
    assert.equal(r.majorityMissing, true);
    assert.equal(r.results[0].exists, null); // (delete) → skipped, NOT counted missing
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkTaskTouchesResolve: no ## Touches section → hasSection false, nothing to verify, not flagged", () => {
  const body = "## Proposal\nnothing\n## Plan\nn/a";
  const r = checkTaskTouchesResolve(body, ".");
  assert.equal(r.hasSection, false);
  assert.equal(r.mustExist, 0);
  assert.equal(r.majorityMissing, false);
});

test("checkTaskTouchesResolve: full task body with (new) tag honored", () => {
  const root = makeTempTree(["existing.ts"]);
  try {
    const body = "**type:** execution\n\n## Touches\n- existing.ts\n- brand-new.ts (new)\n- .claude/workflows/dead.js\n";
    const r = checkTaskTouchesResolve(body, root);
    assert.equal(r.mustExist, 2); // existing.ts + dead.js (brand-new.ts is (new))
    assert.equal(r.missing, 1);   // only dead.js
    assert.equal(r.majorityMissing, false); // 1 of 2 is not > 1/2
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── main --resolve (the dispatch-eligibility CLI hook) ────────────────────────────────────────────
test("main --resolve: majority-missing task → exit 1; resolving task → exit 0", async () => {
  const root = makeTempTree(["tasks/live.md", "live/a.js"]);
  try {
    fs.writeFileSync(
      path.join(root, "tasks", "live.md"),
      "---\nstatus: ready\n---\n## Touches\n- live/a.js\n- live/b.js (new)\n",
    );
    fs.writeFileSync(
      path.join(root, "tasks", "dead.md"),
      "---\nstatus: ready\n---\n## Touches\n- live/a.js\n- retired/a.js\n- retired/b.js\n",
    );
    assert.equal(await main(["node", "s", "--resolve", "--root", root, path.join(root, "tasks", "live.md")]), 0);
    assert.equal(await main(["node", "s", "--resolve", "--root", root, path.join(root, "tasks", "dead.md")]), 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("main --resolve: missing task file → exit 2; no-arg → usage exit 2", async () => {
  assert.equal(await main(["node", "s", "--resolve", "--root", ".", "does-not-exist.md"]), 2);
  assert.equal(await main(["node", "s", "--resolve", "--root", "."]), 2);
});
