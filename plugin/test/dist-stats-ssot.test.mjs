// @test-group engine
// dist-stats-ssot.test.mjs — pins the SINGLE definition of the NOT-EVALUATED-string percentile
// summary `dist` (and its `percentile` helper), and the ONE place its EMPTY POLICY is stated.
//
// THE DEFECT THIS FILE EXISTS TO STOP FROM COMING BACK: `duration-report.ts` and
// `fan-in-queueing-model.ts` each declared a BYTE-IDENTICAL `dist(xs:number[]):Dist` percentile
// summary (n/min/median/p90/max/mean), plus `percentile`, `Dist`, `MaybeNum`, `NOT_EVALUATED`,
// with no shared import between the two (routine `semantic-dedup-scan`, finding `dist-stats`,
// runId `semantic-dedup-scan-1793780123988`; earlier recurrences `dist-stat-byte-identical` and
// `E1` had been rate-gated out). One statistic, two hand-maintained copies.
//
// SCOPE (why this is NOT "exactly one `dist` declaration in the whole repo"): `defect-latency-pair.ts`
// legitimately carries a DIFFERENT statistic with the SAME shape but a DIFFERENT empty policy
// (`null` instead of the string `NOT-EVALUATED`). That divergence is the separate rate-gated finding
// `percentile-duplicate` / `percentile-conventions-diverged` and is deliberately NOT folded in here.
// The load-bearing assertions are therefore scoped to the TWO consumers this finding names: each
// must IMPORT the leaf and must not DECLARE the cluster — those go red the moment a local copy is
// pasted back into either file, which is the exact mutation that produced this finding.
//
// ⛔ WHY A PURE `consumer.dist === leaf.dist` IDENTITY CHECK WOULD BE A TAUTOLOGY (硬规则 4): once
// the consumers re-export the leaf, that equality is true by construction for any state of the
// world in which the re-export exists. The load-bearing assertions are ②/③ (declaration-site and
// import-not-declare); ④ (runtime identity) and ⑤ (behavioral oracle) are corroboration.
//
// Run:
//   scripts/test.sh plugin/test/dist-stats-ssot.test.mjs
//   node --no-warnings --experimental-strip-types --test plugin/test/dist-stats-ssot.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const LEAF_REL = "plugin/scripts/dist-stats.ts";

/** The two consumers named by the finding, which must now import the leaf. */
const CONSUMERS = [
  "plugin/scripts/duration-report.ts",
  "plugin/scripts/fan-in-queueing-model.ts",
];

/** Both consumers also RE-EXPORT the cluster (they carried it on their public surface). */
const RE_EXPORTERS = CONSUMERS;

/** Declaration predicates — a top-level declaration line, optionally `export`. */
function functionRe(name) {
  return new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(`, "m");
}
function constRe(name) {
  return new RegExp(`^(?:export\\s+)?const\\s+${name}\\b`, "m");
}
function typeRe(name) {
  return new RegExp(`^(?:export\\s+)?type\\s+${name}\\b`, "m");
}
function interfaceRe(name) {
  return new RegExp(`^(?:export\\s+)?interface\\s+${name}\\b`, "m");
}

function declFor(name) {
  if (name === "NOT_EVALUATED") return constRe(name);
  if (name === "MaybeNum") return typeRe(name);
  if (name === "Dist") return interfaceRe(name);
  return functionRe(name);
}

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

/** ① The predicates can fire at all (硬规则 2's zero-count half) — dry-run against known-true and
 *  known-false samples BEFORE trusting any "not declared" count below. */
test("① the declaration predicates match a real declaration and reject non-declarations", () => {
  assert.equal(functionRe("dist").test("function dist(xs) {\n"), true);
  assert.equal(functionRe("dist").test("export function dist(xs: number[]): Dist {\n"), true);
  assert.equal(functionRe("percentile").test("export function percentile(sorted, p) {\n"), true);
  assert.equal(constRe("NOT_EVALUATED").test('export const NOT_EVALUATED = "NOT-EVALUATED" as const;\n'), true);
  assert.equal(typeRe("MaybeNum").test("export type MaybeNum = number | typeof NOT_EVALUATED;\n"), true);
  assert.equal(interfaceRe("Dist").test("export interface Dist {\n"), true);
  // Known-false samples: a CALL site, a re-export, an import, a comment mention.
  assert.equal(functionRe("dist").test("  const d = dist(xs);\n"), false);
  assert.equal(functionRe("dist").test('export { dist } from "./dist-stats.ts";\n'), false);
  assert.equal(functionRe("dist").test('import { dist } from "./dist-stats.ts";\n'), false);
  assert.equal(functionRe("dist").test("// the shared dist lives in dist-stats.ts\n"), false);
  // The zero-count half: the leaf must actually exist or a "not declared" scan proves nothing.
  assert.ok(fs.existsSync(path.join(REPO_ROOT, LEAF_REL)), `sanity: the leaf ${LEAF_REL} must exist`);
});

/** ② The leaf is the single declaration of THIS cluster. */
test(`② the leaf ${LEAF_REL} declares dist/percentile/NOT_EVALUATED/MaybeNum/Dist`, () => {
  const src = read(LEAF_REL);
  for (const name of ["dist", "percentile", "NOT_EVALUATED", "MaybeNum", "Dist"]) {
    assert.equal(declFor(name).test(src), true, `${LEAF_REL} must DECLARE ${name}`);
  }
});

test("②b the leaf does not import or re-export the cluster from elsewhere (it is the leaf)", () => {
  const src = read(LEAF_REL);
  assert.equal(/^\s*import\s/m.test(src), false, `${LEAF_REL} must not import anything — it is the leaf`);
  assert.equal(/^\s*export\s+\{[^}]*\}\s+from/m.test(src), false, `${LEAF_REL} must DECLARE, not re-export`);
});

/** ③ Each consumer imports the leaf and does NOT declare the cluster. */
test("③ every consumer IMPORTS dist-stats rather than declaring the cluster", () => {
  for (const rel of CONSUMERS) {
    const src = read(rel);
    for (const name of ["dist", "percentile", "NOT_EVALUATED", "MaybeNum", "Dist"]) {
      assert.equal(
        declFor(name).test(src),
        false,
        `${rel} must not DECLARE ${name} — import it from ${LEAF_REL}`,
      );
    }
    assert.match(src, /from "\.\/dist-stats\.ts"/, `${rel} must IMPORT the shared cluster from "./dist-stats.ts"`);
  }
});

/** ④ Runtime identity across every surface that exposes the cluster (corroboration). */
test("④ the re-exporting consumers resolve to the SAME values as the leaf", async () => {
  const leaf = await import(path.join(REPO_ROOT, LEAF_REL));
  assert.equal(typeof leaf.dist, "function", "leaf must export dist");
  assert.equal(typeof leaf.percentile, "function", "leaf must export percentile");
  for (const rel of RE_EXPORTERS) {
    const mod = await import(path.join(REPO_ROOT, rel));
    assert.equal(mod.dist, leaf.dist, `${rel}'s dist must be the leaf's own function`);
    assert.equal(mod.percentile, leaf.percentile, `${rel}'s percentile must be the leaf's own function`);
    assert.equal(mod.NOT_EVALUATED, leaf.NOT_EVALUATED, `${rel}'s NOT_EVALUATED must be the leaf's own const`);
  }
});

/** ⑤ Behavioral oracle — the empty policy, stated independently and asserted through the leaf. */
const ORACLE = [
  ["empty ⇒ n=0, every statistic NOT-EVALUATED", [], { n: 0, min: "NOT-EVALUATED", median: "NOT-EVALUATED", p90: "NOT-EVALUATED", max: "NOT-EVALUATED", mean: "NOT-EVALUATED" }],
  ["single ⇒ min=median=p90=max=mean", [7], { n: 1, min: 7, median: 7, p90: 7, max: 7, mean: 7 }],
  ["odd count", [1, 2, 3], { n: 3, min: 1, median: 2, p90: 2, max: 3, mean: 2 }],
  ["unsorted input is sorted internally", [3, 1, 2], { n: 3, min: 1, median: 2, p90: 2, max: 3, mean: 2 }],
  ["even count, p90 = nearest-rank upper", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { n: 10, min: 1, median: 5, p90: 9, max: 10, mean: 5.5 }],
];

test("⑤ the leaf satisfies the full oracle table", async () => {
  const leaf = await import(path.join(REPO_ROOT, LEAF_REL));
  for (const [label, input, want] of ORACLE) {
    assert.deepEqual(leaf.dist(input), want, `dist(${JSON.stringify(input)}) — ${label}`);
  }
  // The empty case and a measured 0 must be DISTINGUISHABLE — that is the whole point of the
  // NOT-EVALUATED sentinel. If a future edit made `[]` answer 0, this pair would still pass each
  // row; asserting the discrimination is what pins the empty policy itself.
  assert.notEqual(leaf.dist([]).median, leaf.dist([0, 0, 0]).median, "an unmeasured sample and a measured 0 must differ");
});

test("⑤b the leaf does not mutate its argument (the sort is internal)", async () => {
  const leaf = await import(path.join(REPO_ROOT, LEAF_REL));
  const input = [4, 1, 3, 2];
  const before = [...input];
  leaf.dist(input);
  assert.deepEqual(input, before, "dist() must not reorder the caller's array");
});

/** ⑥ The two consumers no longer carry the leaf's body lines. */
test("⑥ no consumer carries the leaf's byte-identical dist body lines", () => {
  const leafSrc = read(LEAF_REL);
  const needles = [
    "return { n: 0, min: NOT_EVALUATED, median: NOT_EVALUATED, p90: NOT_EVALUATED, max: NOT_EVALUATED, mean: NOT_EVALUATED };",
    "const s = [...xs].sort((a, b) => a - b);",
    "p90: percentile(s, 0.9),",
    "mean: s.reduce((a, b) => a + b, 0) / s.length,",
  ];
  for (const needle of needles) {
    assert.ok(leafSrc.includes(needle), `sanity: the leaf must itself contain "${needle}"`);
    for (const rel of CONSUMERS) {
      assert.equal(
        read(rel).includes(needle),
        false,
        `${rel} must not re-introduce the dist body line "${needle}" — it was moved to ${LEAF_REL}`,
      );
    }
  }
});
