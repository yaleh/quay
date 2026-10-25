// @test-group engine
// writestate-single-implementation.test.mjs — pins the "ONE atomic JSON state write" invariant
// (tasks/gap-routine-semantic-dedup-scan-write-state-atomic-split; finding `write-state-atomic-split`
// in `.quay/routine-findings.jsonl`, routine `semantic-dedup-scan`, runId
// `semantic-dedup-scan-1792940684375`).
//
// ── WHAT WAS WRONG, AND WHY A STATIC PIN ─────────────────────────────────────────────────────────────
// Five `writeState` helpers implemented one behaviour with THREE implementations:
//   · kernel  `packages/quay/src/kernel/write-json-atomic.ts` — the single implementation (tmp + rename);
//   · inline  `ci-runs-collect.ts` / `driver-anchor.ts` — the SAME tmp+rename idiom copied out;
//   · plain   `meta-driver.ts` — a bare `writeFileSync` (O_TRUNC): a concurrent reader can see a
//             zero-length/half-written `.quay/meta-driver-state.json` and read it as "never judged".
// `red-window-triage.ts` / `runner-state-write.ts` already delegated, which is what made the split
// visible as a split. The merge (2026-10-25) made all five delegate. There is no mechanical checker
// for "the atomic idiom was copied again" — that is what this file is.
//
// ── THE PREDICATE, AND ITS TWO CONTROLS (hard rule 2: a mention is not a hit, and a zero needs a
//    positive control) ─────────────────────────────────────────────────────────────────────────────
// Judgment is POSITIONAL, not keyword-based: the shipped `codeOnlyText` (source-text-lib.ts — the
// shared comment-mask primitive, imported here and never re-implemented) blanks every COMMENT position
// while leaving string/template literals intact, so the prose in these files that discusses
// "tmp + rename" cannot make the check fire. ⛔ Not reusing `unencapsulated-state-clue.ts`'s
// `stripCommentsAndLiterals` here: that scanner is lossy by design (`//` comments are DELETED, and it
// keeps going when it loses track of a quote) — used as a measuring instrument on these files it
// blanked ~370 lines of meta-driver, which would have made the reading under-count for a reason that
// has nothing to do with the invariant (hard rule 4c: the quantity must survive every intermediate layer).
//   · positive control — the kernel's own source MUST still contain `renameSync(`: if the predicate
//     stopped seeing the real token, every sibling's zero would be zero for the wrong reason
//     (hard rule 4: an always-zero reading is indistinguishable from "nothing wrong").
//   · negative control — the SAME predicate run against a synthetic pre-fix source MUST report both
//     violations, and against a comment that merely MENTIONS the idiom it must report none. It proves
//     the assertions below can take the false value, and that they are not keyword hits.
//
// ⛔ The per-file allowance table is a LITERAL, deliberately not derived from the sources (deriving it
// would let one edit move both the code and the expectation green together). The single non-zero
// `renameAllowance` (ci-runs-collect) is its JSONL *text* carrier re-write — read text → patch lines →
// tmp + rename — which is not a JSON state write and which `writeJsonAtomic` (it serializes a VALUE)
// cannot express. It is named here so a future reader can tell an allowance from an oversight.
//
// Run: node --test plugin/test/writestate-single-implementation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnlyText } from "../scripts/source-text-lib.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const KERNEL_REL = "packages/quay/src/kernel/write-json-atomic.ts";

/** The five `writeState` helpers named by the finding. Each must funnel through the kernel. */
const WRITERS = Object.freeze([
  {
    rel: "plugin/scripts/ci-runs-collect.ts",
    renameAllowance: 1,
    allowWhy: "its JSONL text-carrier ENRICHMENT rewrite (read text → patch lines → tmp + rename) — a line-oriented TEXT carrier, not a JSON state write, so writeJsonAtomic cannot express it",
  },
  { rel: "plugin/scripts/driver-anchor.ts", renameAllowance: 0 },
  { rel: "plugin/scripts/meta-driver.ts", renameAllowance: 0 },
  { rel: "plugin/scripts/red-window-triage.ts", renameAllowance: 0 },
  { rel: "plugin/scripts/runner-state-write.ts", renameAllowance: 0 },
]);

/** Read a repo-relative file as CODE positions (comments blanked by the shared primitive). */
function codeOf(rel) {
  return codeOnlyText(fs.readFileSync(path.join(REPO, rel), "utf8"));
}

/** The three positional readings the assertions use. Pure — both controls reuse it verbatim. */
function inspect(code) {
  return {
    delegates: /writeJsonAtomic\s*\(/.test(code),
    inlineAtomic: (code.match(/renameSync\s*\(/g) ?? []).length,
    // A `writeFileSync` whose argument list mentions `JSON.stringify` — the pre-fix `meta-driver`
    // shape. A pid-file write (`writeFileSync(f, \`${pid}\n\`)`) does not land here.
    plainJsonWrite: (code.match(/writeFileSync\s*\([^)]*JSON\.stringify/g) ?? []).length,
  };
}

test("every writeState helper delegates to the kernel's single atomic writer", () => {
  for (const w of WRITERS) {
    const readings = inspect(codeOf(w.rel));
    assert.equal(
      readings.delegates,
      true,
      `${w.rel}: its writeState must call writeJsonAtomic (the kernel's single atomic JSON write) — ` +
        `a re-implemented tmp+rename or a plain writeFileSync is exactly the split this task merged`,
    );
    assert.equal(
      readings.inlineAtomic,
      w.renameAllowance,
      `${w.rel}: renameSync count ${readings.inlineAtomic} ≠ allowance ${w.renameAllowance}` +
        (w.allowWhy ? ` (allowance = ${w.allowWhy})` : "") +
        ` — an inline tmp+rename appearing here is a SECOND implementation of writeJsonAtomic`,
    );
    assert.equal(
      readings.plainJsonWrite,
      0,
      `${w.rel}: a plain writeFileSync of JSON.stringify (re)appeared — that is the non-atomic shape ` +
        `(O_TRUNC ⇒ a concurrent reader observes zero-length/half-written state); route it through writeJsonAtomic`,
    );
  }
});

test("positive control: the predicate SEES the real atomic idiom in the kernel source", () => {
  // If the token count ever reads 0, the sibling zeros above are vacuous (hard rule 4): the predicate
  // would be looking for a token that no longer exists, not finding a clean tree.
  const readings = inspect(codeOf(KERNEL_REL));
  assert.ok(
    readings.inlineAtomic >= 1,
    `the kernel (${KERNEL_REL}) must still contain the tmp+rename idiom this predicate counts`,
  );
  assert.equal(
    readings.plainJsonWrite,
    readings.inlineAtomic,
    "the kernel's own JSON write must be PAIRED with a rename (tmp write + renameSync); " +
      "an unpaired one is an in-place write wearing the atomic file's name",
  );
});

test("negative control: the same predicate DOES report the pre-fix shapes, and stays silent on prose", () => {
  const preFixInline = `
    function writeState(p, state) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const tmp = \`\${p}.tmp-\${process.pid}\`;
      fs.writeFileSync(tmp, JSON.stringify(state) + "\\n");
      fs.renameSync(tmp, p);
    }`;
  const preFixPlain = `
    function writeState(root, s) {
      const f = path.join(root, STATE_REL);
      fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\\n", "utf8");
    }`;
  assert.deepEqual(inspect(codeOnlyText(preFixInline)), { delegates: false, inlineAtomic: 1, plainJsonWrite: 1 }, "inline pre-fix shape");
  assert.deepEqual(inspect(codeOnlyText(preFixPlain)), { delegates: false, inlineAtomic: 0, plainJsonWrite: 1 }, "plain pre-fix shape");
  // …and a comment merely MENTIONING the idiom must not fire (hard rule 2's other half).
  const prose = `// we used to call fs.renameSync(tmp, p) and fs.writeFileSync(p, JSON.stringify(x)) here\nconst keep = 1;`;
  assert.deepEqual(inspect(codeOnlyText(prose)), { delegates: false, inlineAtomic: 0, plainJsonWrite: 0 }, "a comment mention must not fire");
});
