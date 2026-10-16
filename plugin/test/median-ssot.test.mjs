// @test-group engine
// median-ssot.test.mjs — pins the SINGLE definition of the even-average median and its EMPTY
// POLICY (routine `semantic-dedup-scan`, finding `median-empty-policy-diverged`, runId
// `semantic-dedup-scan-1792168649663`).
//
// THE DEFECT THIS FILE EXISTS TO STOP FROM COMING BACK: six `median` functions were declared over
// the same even-average core, and an EMPTY sample was answered differently by each —
// `0` (fast-mode-telemetry.ts, workflow-baseline-metrics.ts), `NaN` (rework-predictors.ts,
// psi-failure-correlation-check.ts) and `null` (resource-anomaly-detector.ts,
// crystallization-half-life.ts) — with crystallization-half-life.ts additionally rounding the
// even-average to 1 decimal. A reader could not tell a MEASURED median of 0 from a sample that was
// never taken (硬规则 6). The routine's probe saw the duplication; nothing saw the DIVERGENCE.
//
// ⛔ WHY A PURE `median === leaf.median` IDENTITY CHECK WOULD BE A TAUTOLOGY (硬规则 4): once the
// consumers re-export the leaf, that equality is true by construction for any state of the world in
// which the re-export exists. The load-bearing assertions are therefore ② (exactly ONE declaration
// site) and ③ (each consumer IMPORTS instead of declaring) — those go red the moment a local copy is
// pasted back, which is the exact mutation that produced this finding. ④ (runtime identity) and ⑤
// (behavioral oracle) are corroboration, not the measure.
//
// Run:
//   scripts/test.sh plugin/test/median-ssot.test.mjs
//   node --test plugin/test/median-ssot.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// REPO_ROOT must resolve to the same directory regardless of where this test lives.
function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}
const REPO_ROOT = _findRepoRoot(__dirname);

const LEAF_REL = "plugin/scripts/median.ts";

/** The two shipped surfaces: the plugin execution path and Core. */
const SCAN_DIRS = ["plugin/scripts", "packages/quay/src"];

/** Every consumer that had a local `median` copy, and must now import the leaf. */
const CONSUMERS = [
  "plugin/scripts/crystallization-half-life.ts",
  "plugin/scripts/fast-mode-telemetry.ts",
  "plugin/scripts/resource-anomaly-detector.ts",
  "plugin/scripts/rework-predictors.ts",
  "plugin/scripts/workflow-baseline-metrics.ts",
  "plugin/scripts/psi-failure-correlation-check.ts",
];

/** The two consumers that also RE-EXPORT the leaf (they carried it on their public surface). */
const RE_EXPORTERS = [
  "plugin/scripts/resource-anomaly-detector.ts",
  "plugin/scripts/rework-predictors.ts",
];

/** Declaration predicate — a top-level `function median(`, optionally `export function`. */
function declarationRe(name) {
  return new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(`, "m");
}

/**
 * Every `.ts` file under the scanned surfaces whose source DECLARES `name` (by position: a real
 * top-level `function` declaration line), as repo-relative paths sorted for a stable message.
 */
function declarationSites(name) {
  const hits = [];
  for (const rel of SCAN_DIRS) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ts")) continue;
      const file = path.join(entry.parentPath ?? entry.path, entry.name);
      if (file.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(file, "utf8");
      if (declarationRe(name).test(src)) hits.push(path.relative(REPO_ROOT, file));
    }
  }
  return hits.sort();
}

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

// ── ① The predicate can fire at all (硬规则 2's zero-count half) ─────────────────────────────────
// A scan that reports "0 declarations elsewhere" is worthless if the predicate could not have
// matched ANYTHING. Dry-run it against a sample known to be true — and against samples known to be
// false — BEFORE trusting any count below.
test("① the declaration predicate matches a real declaration and rejects non-declarations", () => {
  assert.equal(declarationRe("median").test("function median(xs) {\n"), true);
  assert.equal(declarationRe("median").test("export function median(xs: number[]): number {\n"), true);
  assert.equal(declarationRe("median").test("export function median(xs: readonly number[]): number | null {\n"), true);
  // Known-false samples: a CALL site, a re-export, a comment mention, an arrow-function const, and
  // a differently-named function.
  assert.equal(declarationRe("median").test("  const m = median(xs);\n"), false);
  assert.equal(declarationRe("median").test('export { median };\n'), false);
  assert.equal(declarationRe("median").test('export { median } from "./median.ts";\n'), false);
  assert.equal(declarationRe("median").test("import { median } from \"./median.ts\";\n"), false);
  assert.equal(declarationRe("median").test("// the shared median lives elsewhere\n"), false);
  assert.equal(declarationRe("median").test("function medianMinutes(values) {\n"), false);
  assert.equal(declarationRe("median").test("const median = (xs) => xs[0];\n"), false);
  // The zero-count half: the scan must actually SEE a file in the scanned surface, or ② below is
  // vacuous. `median.ts` is the one site ② expects; if THIS is missing, the surface is unreadable.
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, LEAF_REL)),
    `sanity: the leaf ${LEAF_REL} must exist, or a "0 extra declarations" scan proves nothing`,
  );
});

// ── ②/③ The measure: exactly ONE declaration site, and the consumers import it ──────────────────
test(`② SSOT — median is DECLARED in exactly one place (${LEAF_REL})`, () => {
  const sites = declarationSites("median");
  assert.deepEqual(
    sites,
    [LEAF_REL],
    `median must have exactly ONE declaration point — actual declarations: ` +
      `${JSON.stringify(sites)}. A second entry means a local copy was pasted back into a ` +
      `consumer instead of importing the leaf (that is the exact regression this task fixed: six ` +
      `copies disagreeing about what an EMPTY sample means).`,
  );
});

test("③ every consumer IMPORTS median from the leaf rather than declaring it", () => {
  for (const rel of CONSUMERS) {
    const src = read(rel);
    assert.equal(
      declarationRe("median").test(src),
      false,
      `${rel} must not DECLARE median — import it from ${LEAF_REL}`,
    );
    assert.match(
      src,
      /from "\.\/median\.ts"/,
      `${rel} must IMPORT the shared median (from "./median.ts"), not merely mention the name`,
    );
  }
});

test("③b the leaf is not a re-export of a consumer (no cycle back into the consumers)", () => {
  const leafSrc = read(LEAF_REL);
  assert.equal(
    /^\s*import\s/m.test(leafSrc),
    false,
    `${LEAF_REL} must not import anything — it is the leaf; an import here re-creates the ` +
      `Question of which copy is authoritative (and a re-export chain would make ② vacuous)`,
  );
  assert.equal(
    /^\s*export\s+\{[^}]*\}\s+from/m.test(leafSrc),
    false,
    `${LEAF_REL} must DECLARE the function, not re-export it from elsewhere`,
  );
});

// ── ④ Runtime identity across every surface that exposes the symbol (corroboration) ─────────────
test("④ the re-exporting consumers resolve to the SAME function object as the leaf", async () => {
  const leaf = await import(path.join(REPO_ROOT, LEAF_REL));
  assert.equal(typeof leaf.median, "function", `leaf must export median`);
  for (const rel of RE_EXPORTERS) {
    const mod = await import(path.join(REPO_ROOT, rel));
    assert.equal(mod.median, leaf.median, `${rel}'s median must be the leaf's own function`);
  }
});

// ── ⑤ Behavioral oracle — an independently stated table, asserted through every entry point ─────
// The contract, stated as the code behaves:
//   median(xs) = the middle value of the FINITE values of xs, ascending
//                (even count ⇒ the exact average of the two middle values, NO rounding)
//              = null when there are no finite values at all
const ORACLE = [
  // [label, input, expected]
  ["empty", [], null],
  ["single", [7], 7],
  ["odd count (sorted)", [1, 2, 3], 2],
  ["odd count (unsorted input)", [3, 1, 2], 2],
  ["even count ⇒ exact average, NOT rounded", [4, 1, 2, 3], 2.5],
  // 2 and 3 average to 2.5; 1 and 4 to 2.5 — the same core the six copies shared.
  ["even count, one decimal is a NO-OP on this value", [1, 4], 2.5],
  // ⛔ THE EMPTY POLICY. `0` here would be the old fast-mode-telemetry / workflow-baseline-metrics
  // answer (a measured zero and a never-taken reading rendered identically); `NaN` would be the old
  // rework-predictors / psi answer. Both are rejected explicitly.
  ["empty is NULL, never 0", [], null],
  ["all values non-finite ⇒ NULL too (nothing was measured)", [NaN, Infinity, -Infinity], null],
  // Non-finite values are DROPPED, not folded in: the finite subset is the sample.
  ["non-finite mixed in are dropped, not averaged in", [1, NaN, 3], 2],
  ["a single finite value beside non-finite ones", [NaN, 5], 5],
  // -0 and 0 are the same reading; negative values sort normally.
  ["negatives", [-5, -1, -3], -3],
  ["the median of a measured zero IS zero (≠ the empty case above)", [0, 0, 0], 0],
];

test("⑤ the leaf satisfies the full oracle table", async () => {
  const leaf = await import(path.join(REPO_ROOT, LEAF_REL));
  for (const [label, input, want] of ORACLE) {
    const got = leaf.median(input);
    if (want === null) {
      assert.equal(got, null, `median(${JSON.stringify(input)}) must be null — ${label}`);
    } else {
      assert.equal(got, want, `median(${JSON.stringify(input)}) must be ${want} — ${label}`);
    }
  }
  // The oracle's two "same answer, opposite meaning" rows must be DISTINGUISHABLE — that is the
  // whole point of the merged policy. If a future edit made `[]` answer 0, this pair would still
  // "pass" each row; asserting the DISCRIMINATION is what pins the empty policy itself.
  assert.notEqual(leaf.median([]), leaf.median([0, 0, 0]), "an unmeasured sample and a measured 0 must differ");
});

test("⑤b the leaf does not mutate its argument (the sort is internal)", async () => {
  const leaf = await import(path.join(REPO_ROOT, LEAF_REL));
  const input = [4, 1, 3, 2];
  const before = [...input];
  leaf.median(input);
  assert.deepEqual(input, before, "median() must not reorder the caller's array");
});

// ── ⑥ The routine's own finding is not re-filed: no consumer carries a copy of the leaf's body ──
test("⑥ no consumer carries the leaf's even-average body lines", () => {
  const leafSrc = read(LEAF_REL);
  // The two body lines a copy of this statistic necessarily carries verbatim: the sort with the
  // non-finite drop, and the even-average pairing.
  const needles = [
    "xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)",
    "return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;",
  ];
  for (const needle of needles) {
    assert.ok(leafSrc.includes(needle), `sanity: the leaf must itself contain "${needle}"`);
    for (const rel of CONSUMERS) {
      assert.equal(
        read(rel).includes(needle),
        false,
        `${rel} must not re-introduce the statistic's body line "${needle}" — it was moved to ${LEAF_REL}`,
      );
    }
  }
});

// ── ⑦ The six REMOVED bodies are gone — the divergence, not just the declaration line ────────────
// ② catches a re-declared `median`. This catches the same regression one level down: a copy pasted
// back under a DIFFERENT name (or inlined at a call site) would not trip ②'s declaration predicate
// but would carry the body. The needle is per consumer and is drawn from the declaration that file
// actually carried, so it cannot collide with an unrelated function that shares one line — e.g.
// rework-predictors.ts's `quantile` legitimately keeps `if (xs.length === 0) return NaN;` (the
// separate, rate-gated `percentile-conventions-diverged` finding), so the empty-policy LINE alone is
// not a usable needle there; `s.length >> 1` is (that bit-shift was that median's own).
const REMOVED_BODIES = [
  ["plugin/scripts/crystallization-half-life.ts", "Math.round(((sortedAsc[mid - 1] + sortedAsc[mid]) / 2) * 10) / 10"],
  ["plugin/scripts/fast-mode-telemetry.ts", "if (sorted.length % 2 === 1) return sorted[mid];"],
  ["plugin/scripts/resource-anomaly-detector.ts", "const m = Math.floor(s.length / 2);"],
  ["plugin/scripts/rework-predictors.ts", "const mid = s.length >> 1;"],
  ["plugin/scripts/workflow-baseline-metrics.ts", "return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;"],
  ["plugin/scripts/psi-failure-correlation-check.ts", "return pct(sorted, 0.5);"],
];

test("⑦ every removed local median body is gone from its file", () => {
  for (const [rel, needle] of REMOVED_BODIES) {
    assert.equal(
      read(rel).includes(needle),
      false,
      `${rel} re-introduced the local median body line "${needle}" — its statistic belongs in ${LEAF_REL}`,
    );
  }
});

test("⑦b the seven needles are LIVE (each one matched its file before the merge)", () => {
  // 硬规则 2's zero-count half: "0 hits" above is evidence only if the needle could have hit. This
  // replays each needle against the pre-change line it was taken from — a verbatim excerpt of the
  // declaration each consumer used to carry — so a needle that went stale (e.g. a whitespace change
  // that made it match nothing, anywhere) fails HERE instead of passing ⑦ vacuously.
  const BEFORE = [
    "  return sortedAsc.length % 2 ? sortedAsc[mid] : Math.round(((sortedAsc[mid - 1] + sortedAsc[mid]) / 2) * 10) / 10;",
    "  if (sorted.length % 2 === 1) return sorted[mid];",
    "  const m = Math.floor(s.length / 2);",
    "  const mid = s.length >> 1;",
    "  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;",
    "  return pct(sorted, 0.5);",
  ];
  for (const [rel, needle] of REMOVED_BODIES) {
    // psi's needle appears in `BEFORE` as well; the point is that each needle matches SOME recorded
    // pre-change line, which is what makes the absence check above meaningful.
    assert.ok(
      BEFORE.some((line) => line.includes(needle)),
      `sanity: the needle recorded for ${rel} does not match any pre-change body line — ` +
        `it is stale, so ⑦'s "not found" result proves nothing`,
    );
  }
});
