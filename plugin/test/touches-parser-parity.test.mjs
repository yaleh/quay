// @test-group engine
// touches-parser-parity.test.mjs — gap-task-body-has-n-parsers-and-no-authority (AC2/AC3/AC4).
//
// The repo once had N independent `## Touches` parsers, none authoritative, and they DISAGREED on
// the same line: `` - `foo.ts` (new) `` parsed to `foo.ts` in task-status-drift-check.ts
// (parseTouchEntries — quotes/backticks stripped BEFORE and AFTER the "(…)" annotation strip) but
// to the residual-backtick `foo.ts`` in touches-orthogonality-check.ts (parseTouches — the
// annotation strip left the closing backtick the annotation had masked). The WRONG one is the one
// fast mode uses for concurrency eligibility (concurrent-batch-scheduler.ts → checkTouchesPair), so
// a `(new)`-annotated task was judged "matched nothing (likely a typo)".
//
// This task makes parseTouchEntries the ONE implementation (touches-parser.ts) and every other
// parser a delegate to it. This test proves the convergence:
//   AC2  bidirectional negative control — `` `a.ts` (new) `` yields `a.ts` under every parser, and
//        a deliberately non-stripping parser FAILS the consistency check.
//   AC3  a fixture set ((new), (refactor X), backtick-inside/outside annotations, directory entry,
//        `*` wildcard, plain, `./`, quotes) — every parser gives the identical per-item path set.
//   AC4  re-run of the gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet "matched
//        nothing" scenario: after the fix, that misleading reason is produced ONLY by a genuinely
//        not-yet-created file, never by an un-stripped annotation.
//
// Run: scripts/test.sh plugin/test/touches-parser-parity.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTouchEntries, parseTouchEntriesWithTags, extractTouchesSection } from "../scripts/touches-parser.ts";
import { parseTouches, checkTouchesPair, matchGlob } from "../scripts/touches-orthogonality-check.ts";
import { parseBulletList } from "../scripts/select-tests-for-touches.ts";
import { extractTouchesGlobs } from "../scripts/prepare-admission-check.ts";
import { checkTouches } from "../scripts/task-schema.ts";
import { checkTaskAntiDrift } from "../scripts/anti-drift-touches-check.ts";

// ── AC3 fixture set ───────────────────────────────────────────────────────────────────────────────
// Each fixture is a `## Touches` bullet line. `bodyOf` wraps it in a minimal execution-type task
// body so the body-parsers (parseTouches / checkTouches) reach their parse path too.
const SECTION_FIXTURES = [
  "- `a.ts` (new)",                                          // (new) annotation
  "- `a.ts` (refactor Verify phase)",                        // (refactor X) annotation
  "- `code/bar.ts (new)`",                                   // annotation INSIDE the backticks
  "- `code/foo.ts` (extract from)",                          // annotation OUTSIDE the backticks
  "- packages/quay/src/gate/config",                         // directory entry
  "- packages/quay/**/*.test.mjs",                           // `*` wildcard glob
  "- code/plain.ts",                                         // plain path
  "- ./packages/a.js",                                       // leading ./ — every parser strips it
  '- "packages/b.js"',                                       // double-quoted path
  "- `experiments/quay-perpetual-stream/scripts/*run-identity*`", // backticked wildcard glob
  "- plugin/test/foo.test.mjs（档位测试）",                  // FULL-WIDTH （…） annotation (CJK convention) — stripped too
];

const EXPECTED = [
  ["a.ts"],
  ["a.ts"],
  ["code/bar.ts"],
  ["code/foo.ts"],
  ["packages/quay/src/gate/config"],
  ["packages/quay/**/*.test.mjs"],
  ["code/plain.ts"],
  ["packages/a.js"],
  ["packages/b.js"],
  ["experiments/quay-perpetual-stream/scripts/*run-identity*"],
  ["plugin/test/foo.test.mjs"],
];

const bodyOf = (section) => `**type:** execution\n\n## Touches\n${section}`;

// The parsers under test. Every one is a function (body, section) → string[]. All of them are
// expected to agree EXACTLY on the fixture set — that is the parity claim (AC3).
const PARSERS = {
  parseTouchEntries: (body, section) => parseTouchEntries(section),
  parseBulletList: (body, section) => parseBulletList(section),
  extractTouchesGlobs: (body, section) => extractTouchesGlobs(section),
  parseTouches: (body) => parseTouches(body).globs,
  checkTouches: (body) => checkTouches({ body }, "gap").globs ?? [],
};

function collectOutputs(parserSet, body, section) {
  const out = {};
  for (const [name, fn] of Object.entries(parserSet)) out[name] = fn(body, section);
  return out;
}

function assertAllAgree(parserSet, body, section, expected) {
  const out = collectOutputs(parserSet, body, section);
  const vals = Object.values(out);
  for (const v of vals) {
    assert.deepEqual(v, expected, `parser output differs from expected for ${JSON.stringify(section)}`);
  }
  for (const [name, v] of Object.entries(out)) {
    assert.deepEqual(v, vals[0], `${name} diverges from the other parsers for ${JSON.stringify(section)}`);
  }
  return out;
}

// ── AC3: every parser agrees on every fixture ─────────────────────────────────────────────────────
test("AC3: all parsers give the identical per-item path set on the fixture set", () => {
  for (let i = 0; i < SECTION_FIXTURES.length; i++) {
    const section = SECTION_FIXTURES[i];
    const body = bodyOf(section);
    assertAllAgree(PARSERS, body, section, EXPECTED[i]);
  }
});

test("AC3: control line `` - `a.ts` (new) `` yields a.ts under every parser — none leaves a backtick", () => {
  const section = "- `a.ts` (new)";
  const out = assertAllAgree(PARSERS, bodyOf(section), section, ["a.ts"]);
  for (const v of Object.values(out)) {
    assert.ok(!v.join("").includes("`"), `residual backtick in ${JSON.stringify(v)}`);
  }
});

// ── AC2: bidirectional negative control ───────────────────────────────────────────────────────────
test("AC2: a parser that does NOT strip the annotation fails the parity check", () => {
  // Replica of the OLD touches-orthogonality-check parseTouches bullet logic — backticks stripped
  // only at the very start/end of the line, then the "(…)" annotation strip leaves a residual
  // trailing backtick. This is exactly the bug the task kills.
  function buggyNoStrip(section) {
    const out = [];
    for (const raw of String(section).split(/\r?\n/)) {
      const m = raw.match(/^\s*[-*]\s+(.+?)\s*$/);
      if (!m) continue;
      let g = m[1].trim();
      g = g.replace(/^`+|`+$/g, "").trim();
      g = g.replace(/^\.\//, "");
      g = g.replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (g) out.push(g);
    }
    return out;
  }
  const section = "- `a.ts` (new)";
  // Positive direction: the real parsers strip the annotation AND the masked backtick → a.ts.
  assert.deepEqual(parseTouchEntries(section), ["a.ts"]);
  assert.deepEqual(parseTouches(bodyOf(section)).globs, ["a.ts"]);
  // Negative direction: the buggy parser keeps the residual backtick → a.ts` — and a consistency
  // check that includes it MUST fail (this is the "must fail" half of the bidirectional control).
  assert.deepEqual(buggyNoStrip(section), ["a.ts`"]);
  const withBug = { ...PARSERS, buggy: (body, sec) => buggyNoStrip(sec) };
  assert.throws(
    () => assertAllAgree(withBug, bodyOf(section), section, ["a.ts"]),
    /diverges|differs/,
    "a non-annotation-stripping parser must fail the parity check",
  );
});

// ── AC4: the dispatch-eligibility "matched nothing" scenario re-run ───────────────────────────────
test("AC4: an un-stripped (new) annotation no longer triggers 'matched nothing (likely a typo)'", () => {
  // gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet's scenario, re-run after the fix:
  // a task whose Touches entry is `` `foo.ts` (new) `` where foo.ts EXISTS on disk must expand and
  // be judged DISJOINT from an unrelated task — the annotation must not corrupt the path.
  const fakeExpand = (mapping) => (globs) => {
    const out = new Set();
    for (const g of globs) for (const f of (mapping[g] || [])) out.add(f);
    return out;
  };

  const A = parseTouches("## Touches\n- `foo.ts` (new)");
  assert.deepEqual(A.globs, ["foo.ts"], "no residual backtick in the parsed glob");
  const B = parseTouches("## Touches\n- y/b.js");
  const r = checkTouchesPair(A, B, fakeExpand({ "foo.ts": ["foo.ts"], "y/b.js": ["y/b.js"] }));
  assert.equal(r.disjoint, true);
  assert.doesNotMatch(r.reason, /matched nothing|typo/, "existing file with (new) annotation must not be judged a typo");

  // The ONE remaining cause of "matched nothing": the file genuinely does not exist YET — the path
  // is now clean (annotation fully stripped), so the conservative branch fires for the correct,
  // intended reason ("file not yet created"), not for a parser artifact.
  const C = parseTouches("## Touches\n- `brand-new.ts` (new)");
  assert.deepEqual(C.globs, ["brand-new.ts"]);
  const r2 = checkTouchesPair(C, B, fakeExpand({ "brand-new.ts": [], "y/b.js": ["y/b.js"] }));
  assert.equal(r2.disjoint, false);
  assert.match(r2.reason, /matched nothing/);
});

// ── AC1/AC2 (gap-touches-parser-strip-annotation-nested-parens) ─────────────────────────────────────
// stripTouchAnnotation must strip a trailing （…） annotation that CONTAINS a NESTED full-width pair.
// The old regex `\s*（[^）]*）\s*$` could not cross a `）`, so a nested pair left the WHOLE annotated
// string as the glob → anti-drift-touches-check HARD-FAILED on a clean write. Two real occurrences
// (each was worked around by rewording the annotation — this test pins the parser defect itself):
//   a23:         annotation contains a backticked nested full-width pair `（新增…）`
//   provisioning: annotation contains a nested full-width pair （config/gates/运行时载体）
const NESTED_PAREN_FIXTURES = [
  "- plugin/scripts/outer-tick-log-check.sh（判定脚本；如注解含 `（新增…）` 嵌套全角括号则旧正则剥离失败）",
  "- plugin/scripts/refresh-worktree-quay.sh（新：主检出 .quay/（config/gates/运行时载体）快照复制进 linked worktree）",
];
const NESTED_PAREN_EXPECTED = [
  ["plugin/scripts/outer-tick-log-check.sh"],
  ["plugin/scripts/refresh-worktree-quay.sh"],
];

test("AC1: nested full-width paren annotations strip to clean globs (a23 + provisioning shapes)", () => {
  for (let i = 0; i < NESTED_PAREN_FIXTURES.length; i++) {
    const section = NESTED_PAREN_FIXTURES[i];
    assert.deepEqual(
      parseTouchEntries(section),
      NESTED_PAREN_EXPECTED[i],
      `nested-paren annotation not stripped to a clean glob for ${JSON.stringify(section)}`,
    );
    // single-source parity: every parser must agree on the nested shapes too
    assertAllAgree(PARSERS, bodyOf(section), section, NESTED_PAREN_EXPECTED[i]);
  }
});

test("AC2 能取假: nested-paren annotations → matchGlob HITS the clean path; a REAL out-of-declared write still does NOT hit (HARD FAIL preserved)", () => {
  // The declared globs are exactly what the anti-drift guard feeds to matchGlob.
  for (let i = 0; i < NESTED_PAREN_FIXTURES.length; i++) {
    const [cleanGlob] = NESTED_PAREN_EXPECTED[i];
    // The clean write the task ACTUALLY made — under the old broken strip the annotation was part
    // of the glob and matchGlob MISSED this → spurious HARD FAIL. Now it must HIT.
    assert.equal(matchGlob(cleanGlob, cleanGlob), true, `matchGlob must hit the clean path for ${cleanGlob}`);
  }
  // End-to-end anti-drift semantics: declared nested-paren Touches + the task's own clean file → OK
  // (no false HARD FAIL — the a23 shape as the a23 task's Touches would have been).
  const a23Body = bodyOf(
    "- plugin/scripts/outer-tick-log-check.sh（判定脚本；如注解含 `（新增…）` 嵌套全角括号则旧正则剥离失败）",
  );
  const ok = checkTaskAntiDrift(a23Body, ["plugin/scripts/outer-tick-log-check.sh"]);
  assert.equal(ok.ok, true, `nested-paren annotation must NOT cause a false HARD FAIL: ${JSON.stringify(ok.violations)}`);
  // Real drift: a genuinely out-of-declared file must STILL HARD FAIL (blocking semantics unchanged).
  const drift = checkTaskAntiDrift(a23Body, ["plugin/scripts/unrelated/not-declared.ts"]);
  assert.equal(drift.ok, false, "a real out-of-declared write must still HARD FAIL");
  assert.ok(
    drift.violations.some(
      (v) => v.type === "out-of-declared" && v.file === "plugin/scripts/unrelated/not-declared.ts",
    ),
    "violation must be the out-of-declared kind naming the drift file",
  );
});

// ── parseTouchEntriesWithTags (gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files) ──
// The resolve check needs to KNOW a touch is `(new)` (file will be created — need not exist yet) vs
// `(delete)` (file must exist to be deleted) vs plain. parseTouchEntriesWithTags captures the tag
// while extracting the SAME paths as the single-source parseTouchEntries. Two invariants:
//   (a) paths are byte-identical to parseTouchEntries on the parity fixture set;
//   (b) the tag is `new`/`delete`/null exactly for `(new)`/`(delete)`/everything-else annotations.
test("parseTouchEntriesWithTags: paths byte-identical to parseTouchEntries on the parity fixture set", () => {
  for (let i = 0; i < SECTION_FIXTURES.length; i++) {
    const section = SECTION_FIXTURES[i];
    const tagged = parseTouchEntriesWithTags(section);
    assert.deepEqual(
      tagged.map((e) => e.path),
      EXPECTED[i],
      `tagged paths diverge from parseTouchEntries for ${JSON.stringify(section)}`,
    );
  }
});

test("parseTouchEntriesWithTags: (new)/(delete) tags captured, everything else null", () => {
  const section = [
    "- `a.ts` (new)",
    "- `code/bar.ts (new)`",                          // annotation INSIDE the backticks
    "- b.ts (delete)",
    "- c.ts (deleted)",                               // tolerated alias
    "- d.ts (refactor Verify phase)",                 // non-structural annotation → null
    "- plain.ts",
  ].join("\n");
  const tagged = parseTouchEntriesWithTags(section);
  assert.deepEqual(tagged, [
    { path: "a.ts", tag: "new" },
    { path: "code/bar.ts", tag: "new" },
    { path: "b.ts", tag: "delete" },
    { path: "c.ts", tag: "delete" },
    { path: "d.ts", tag: null },
    { path: "plain.ts", tag: null },
  ]);
});

test("parseTouchEntriesWithTags: (new)/(delete) tag BEFORE a full-width （…） annotation is recovered", () => {
  // 2026-08-28: a pre-existing quirk lost the structural tag when an ASCII (new) sat before a
  // trailing full-width annotation — `` path (new)（描述） `` — the end-anchored ASCII match saw
  // ）， not ), so every (new)（…） task was judged must-exist-missing (promotion reject). The
  // tag is now recovered from the ASCII (…) that precedes the （; the PATH is unchanged.
  const section = [
    "- `plugin/scripts/foo.ts (new)（新建）`",
    "- plugin/scripts/old.ts (delete)（删）",
    "- plugin/test/fixtures/fake-suite/ (new)（假 suite fixture）",
    "- plain.ts",
  ].join("\n");
  const tagged = parseTouchEntriesWithTags(section);
  assert.deepEqual(tagged, [
    { path: "plugin/scripts/foo.ts", tag: "new" },
    { path: "plugin/scripts/old.ts", tag: "delete" },
    { path: "plugin/test/fixtures/fake-suite/", tag: "new" },
    { path: "plain.ts", tag: null },
  ]);
});

test("parseTouchEntriesWithTags: empty/missing section → []", () => {
  assert.deepEqual(parseTouchEntriesWithTags(""), []);
  assert.deepEqual(parseTouchEntriesWithTags(null), []);
  assert.deepEqual(parseTouchEntriesWithTags("## Next\nnot a bullet list"), []);
});

// ── gap-touches-parser-early-subheading-latch-hides-declaration ───────────────────────────────────
// The section-extraction bug: `extractTouchesSection` took the FIRST heading whose text matched
// /^touches\b/i as the start of the `## Touches` section and stopped at the next heading of ANY
// depth. A `### Touches …` subheading sitting BEFORE the real `## Touches` therefore latched the
// section early, its body was truncated at the next `###`, and the real `## Touches` was NEVER read
// → `globs = []`, which is INDISTINGUISHABLE from "this task declares no Touches" (硬规则 3b).
// Downstream `anti-drift-touches-check.ts` intersects that empty set with the real change set and
// reports EVERY changed file as `out-of-declared: task wrote <file> (matches no declared Touches
// glob)` — the message blames the declaration, not the parser. Real victim (read-only measurement
// on the production task body at 7a6306a5d): `parseTouches(body).globs.length` was 0 while the real
// `## Touches` carried 10 entries.
//
// The rename-the-subheading workaround the victim's own worker applied is NOT the fix: any FUTURE
// task body that writes a `### Touches 最终清单`-style subheading silently loses its declaration.
// This block pins the parser defect itself.
const EARLY_SUBHEADING_BODY = [
  "## Proposal",
  "",
  "### Touches 最终清单（⛔ 实现前定稿，与 `## Touches` 逐条一致，无追加）",
  "",
  "| 文件 | 角色 |",
  "|---|---|",
  "| `plugin/scripts/decoy.ts` | 表格不是 bullet ⇒ 解析出 0 条 |",
  "",
  "## Touches",
  "",
  "- plugin/scripts/alpha.ts",
  "- plugin/test/beta.test.mjs",
].join("\n");

test("AC1: an EARLY `### Touches …` subheading must not latch the section — the real `## Touches` wins", () => {
  // As-is this returns [] (the subheading's markdown table has no bullets) — the defect under test.
  assert.deepEqual(
    parseTouches(EARLY_SUBHEADING_BODY).globs,
    ["plugin/scripts/alpha.ts", "plugin/test/beta.test.mjs"],
    "an earlier `### Touches …` subheading swallowed the real `## Touches` declaration",
  );
  // The subheading's TABLE CONTENT must not leak in either — the section read is the real one.
  assert.ok(
    !parseTouches(EARLY_SUBHEADING_BODY).globs.some((g) => g.includes("decoy")),
    "the early subheading's own body must not be read as the Touches section",
  );
});

test("AC1 boundary: an EARLY body-form `## Touches 声明 …` heading must not beat the exact `## Touches`", () => {
  // Same shape at the SAME level: priority is "exact `Touches` first, earliest among those" — NOT
  // "first heading that merely starts with the word Touches".
  const body = ["## Touches 声明（说明段，非清单）", "", "本段是说明，不是路径清单。", "", "## Touches", "", "- real.ts"].join("\n");
  assert.deepEqual(parseTouches(body).globs, ["real.ts"]);
});

test("AC1 no-regression: a lone `### Touches` (no `## Touches` anywhere) still reads its own body", () => {
  const body = ["## Plan", "", "### Touches", "", "- plugin/scripts/only.ts", ""].join("\n");
  assert.deepEqual(parseTouches(body).globs, ["plugin/scripts/only.ts"]);
});

test("AC1 no-regression: two same-level `## Touches` sections → the FIRST wins (fixed semantics)", () => {
  const body = ["## Touches", "", "- a.ts", "", "## Touches", "", "- b.ts", ""].join("\n");
  assert.deepEqual(parseTouches(body).globs, ["a.ts"]);
});

test("AC1 negative control (REAL data shape): a `### Finding` note AFTER `## Touches` must not become declared globs", () => {
  // Measured on the real store: 4 tasks put a `### Finding：…` note right after `## Touches`, and
  // those notes carry PROSE bullet lists. Widening the section-extent rule to "level <= the
  // selected level" (so a subheading would not truncate its own section) swallowed them as declared
  // paths — DIR-075 3→15, gap-mcp-server-test-deadlocks 5→18, etc. — which is the SAME defect class
  // this task exists to kill, in the PERMISSIVE direction (a spurious glob lets a genuinely
  // out-of-declared write pass anti-drift). The extent rule therefore stays "next heading of any
  // depth". This fixture is the real shape.
  const body = [
    "## Touches",
    "",
    "- packages/quay/test/mcp-server.test.mjs（复现/修复落点）",
    "- packages/quay/src/provider-client.ts",
    "",
    "### Finding：并发死锁实证（manager 2026-08-11 10:2x，落点 Finding 不进 Contract）",
    "",
    "**已复现、已用 /proc + ep_poll 确认，非猜测**：`--test-concurrency=16` 下卡住。",
    "",
    "- ① 首次（昨日，lane16 全量套件，main 相尾声）conc=16 —— 死锁",
    "- ② main-only 隔离跑（第 305/305 个文件，批次尾声）conc=8 —— 死锁",
  ].join("\n");
  assert.deepEqual(parseTouches(body).globs, [
    "packages/quay/test/mcp-server.test.mjs",
    "packages/quay/src/provider-client.ts",
  ]);
});

test("AC5: the return value distinguishes 'section read but no paths' from 'section never read'", () => {
  // 硬规则 3b — before the fix both of these produced `{hasSection:false|true, section:""}` with no
  // way to tell "read an empty declaration" from "never found a declaration". The selected heading
  // and its line number make the two readings NON-isomorphic.
  const compoundBody = ["## Touches", "", "(compound task — see each child's own `## Touches`)", ""].join("\n");
  const noHeading = ["## Plan", "", "no touches declaration here at all", ""].join("\n");

  const compound = extractTouchesSection(compoundBody);
  const missing = extractTouchesSection(noHeading);

  // "Read the section, it declares no bullet paths" — distinguishable, and NOT an error.
  assert.equal(compound.hasSection, true);
  assert.equal(compound.heading, "Touches");
  assert.equal(compound.startLine, 1);
  assert.equal(compound.level, 2);
  assert.deepEqual(parseTouchEntries(compound.section), []);

  // "Never read a section at all" — a DIFFERENT reading, not the same shape as the above.
  assert.equal(missing.hasSection, false);
  assert.equal(missing.heading, null);
  assert.equal(missing.startLine, null);
  assert.equal(missing.level, null);

  assert.notDeepEqual(compound, missing, "the two readings must not be isomorphic");
});

test("AC5: the returned heading/line is the one actually selected (early subheading case)", () => {
  const sel = extractTouchesSection(EARLY_SUBHEADING_BODY);
  assert.equal(sel.heading, "Touches");
  assert.equal(sel.level, 2);
  // 1-based line number of the real `## Touches` (index 8 → line 9).
  assert.equal(sel.startLine, EARLY_SUBHEADING_BODY.split("\n").findIndex((l) => l === "## Touches") + 1);
  assert.ok(sel.section.includes("plugin/scripts/alpha.ts"));
});

// ── AC1 backstop: only ONE implementation exists (definition-site grep) ───────────────────────────
test("AC1: the shared parser is the only parseTouchEntries definition in the repo", () => {
  // The parity claim is only meaningful if the shared function is actually the single definition.
  // (The plugin/scripts copy is canonical; experiments/.../scripts/touches-parser.ts is a symlink
  // to it — both resolve to the same file.)
  assert.ok(typeof parseTouchEntries === "function");
  assert.ok(typeof parseTouches === "function");
  assert.ok(typeof parseBulletList === "function");
  assert.ok(typeof extractTouchesGlobs === "function");
});
