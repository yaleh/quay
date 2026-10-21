// @test-group product
// kernel-canonical-buckets.test.mjs — the kernel leaf `packages/quay/src/kernel/canonical-buckets.ts`
// and its two layers' consumers: the dispatch-side judges (`plugin/scripts/suite-bucket-attribution.ts`
// + `plugin/scripts/suite-bucket-select.ts`) and the product-side page renderer
// (`packages/quay/src/serve/serve-tests.ts`).
// (routine `semantic-dedup-scan` finding `canonical-buckets`, task
// gap-routine-semantic-dedup-scan-canonical-buckets.)
//
// WHAT THIS FILE IS FOR — and why the obvious test would have been the wrong one.
//
// The finding was "identical three-line bodies plus an identical private BUCKET_ORDER array in each
// file". The tempting test is therefore "canonicalBuckets returns the right string" — but that test
// PASSED before the fix too, twice, in two files. It is the 硬规则 4 推论三 shape: a criterion
// satisfied by the OLD arrangement measures nothing about the change. A test of the FIX must fail if
// the duplication returns.
//
// So the assertions are structural first and behavioral second:
//
//   ① SINGLE DECLARATION — the production tree must carry exactly ONE `canonicalBuckets` declaration
//      and exactly ONE bucket-order array declaration, both in the kernel leaf. A re-introduced local
//      copy leaves ① red no matter how its body is spelled — the NAME is what a rewrite cannot hide.
//   ② IDENTITY — the plugin entry and the kernel leaf expose the SAME function object and the SAME
//      order array. A re-implementation (even byte-identical) is a different object, which ① alone
//      could miss if the copy were renamed.
//   ③ BEHAVIOR — the canonical order (insertion order must NOT leak), the UNRESOLVED empty-set rule,
//      and the negative control (a non-empty set can never read UNRESOLVED).
//   ④ THE FINDING'S OWN PREDICATE, re-run — the former body/array spellings are gone from the
//      production tree, and the dry-run controls prove the predicates fire on known-true samples
//      (硬规则 2's zero half: a zero count means "looked and found none", never "matches nothing").
//
// ⛔ SCOPE, stated so "not covered" cannot read as "covered": the scan surface is the probe's own —
// `plugin/**` + `packages/*/src/**`, minus node_modules/dist/archive/test/fixtures. Test trees and
// `experiments/**` are outside it and are not judged here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUCKET_ORDER, canonicalBuckets } from "../src/kernel/canonical-buckets.ts";
import * as kernelNs from "../src/kernel/canonical-buckets.ts";
import * as pluginAttributionNs from "../../../plugin/scripts/suite-bucket-attribution.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

const KERNEL_REL = "packages/quay/src/kernel/canonical-buckets.ts";
/** The three former homes the finding named (plus the third array spelling, converged under 5b). */
const FORMER_HOMES = [
  "plugin/scripts/suite-bucket-attribution.ts",
  "plugin/scripts/suite-bucket-select.ts",
  "packages/quay/src/serve/serve-tests.ts",
];

const SCAN_ROOTS = ["plugin", "packages"];
const SCAN_EXTS = new Set([".ts", ".mjs", ".js"]);
const PROBE_EXCLUDED_SEGMENTS = new Set(["node_modules", "dist", "archive", "test", "__tests__", "fixtures"]);

function walkProductionSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (PROBE_EXCLUDED_SEGMENTS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkProductionSources(abs, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!SCAN_EXTS.has(ext)) continue;
      if (/\.(test|spec)\.[cm]?[jt]s$/.test(entry.name)) continue;
      out.push(abs);
    }
  }
  return out;
}

const rel = (abs) => path.relative(REPO_ROOT, abs).split(path.sep).join("/");

/** Files on the probe's surface whose TEXT satisfies `predicate`. */
function filesMatching(predicate) {
  const hits = [];
  for (const root of SCAN_ROOTS) {
    for (const abs of walkProductionSources(path.join(REPO_ROOT, root))) {
      if (predicate(fs.readFileSync(abs, "utf8"))) hits.push(rel(abs));
    }
  }
  return hits.sort();
}

/** DECLARATION predicate for `canonicalBuckets` — a re-export (`export { canonicalBuckets };`) is
 *  deliberately NOT a declaration, or every migrated consumer path would red. */
function declaresCanonicalBuckets(text) {
  return /(?:export\s+)?(?:function|const|let|var)\s+canonicalBuckets\s*[(=]/.test(text);
}

/** DECLARATION predicate for a bucket-order array: an ALL-CAPS `…ORDER…` name assigned an array
 *  literal that contains all three bucket tokens. Catches `BUCKET_ORDER` AND the derived names a
 *  copy could hide behind (`BUCKET_ARTIFACT_ORDER` was the third spelling this task converged). */
function declaredBucketOrderNames(text) {
  const names = [];
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Z][A-Z0-9_]*ORDER[A-Z0-9_]*)\s*(?::[^=]*)?=\s*\[([^\]]*)\]/g)) {
    const body = m[2];
    if (/"P"/.test(body) && /"S"/.test(body) && /"M"/.test(body)) names.push(m[1]);
  }
  return names;
}

test("① one declaration site: canonicalBuckets and the bucket-order array live ONLY in the kernel leaf", () => {
  // (i) controls FIRST — the predicates must fire on the known-true forms (硬规则 2's zero half).
  assert.ok(
    declaresCanonicalBuckets('export function canonicalBuckets(buckets: ReadonlySet<Bucket>): string { return ""; }'),
    "the declaration predicate must fire on the kernel's function form",
  );
  assert.ok(
    declaresCanonicalBuckets('const canonicalBuckets = (b) => "";'),
    "the declaration predicate must fire on a const-arrow rewrite (the evasion a copy could use)",
  );
  assert.equal(
    declaresCanonicalBuckets('export { canonicalBuckets };'),
    false,
    "a re-export is not a declaration — else every migrated consumer path would red",
  );
  assert.equal(
    declaresCanonicalBuckets('import { canonicalBuckets } from "./x.ts";'),
    false,
    "an import is not a declaration",
  );
  assert.deepEqual(
    declaredBucketOrderNames('const BUCKET_ORDER: readonly Bucket[] = ["P", "S", "M"];'),
    ["BUCKET_ORDER"],
    "the array predicate must fire on the kernel's declaration",
  );
  assert.deepEqual(
    declaredBucketOrderNames('const BUCKET_ARTIFACT_ORDER: readonly Bucket[] = ["P", "S", "M"];'),
    ["BUCKET_ARTIFACT_ORDER"],
    "the array predicate must fire on the renamed third copy (the 5b sweep target)",
  );
  assert.deepEqual(
    declaredBucketOrderNames('const SORTED = ["P", "S", "M"];'),
    [],
    "a lowercase / non-ORDER name is out of this family's declaration surface",
  );

  // (ii) the real judgment — over the production tree, not over the controls.
  const declaringFn = filesMatching(declaresCanonicalBuckets);
  assert.deepEqual(
    declaringFn,
    [KERNEL_REL],
    `exactly one file may DECLARE canonicalBuckets; found ${JSON.stringify(declaringFn)}`,
  );

  const declaringOrder = filesMatching((t) => declaredBucketOrderNames(t).length > 0);
  assert.deepEqual(
    declaringOrder,
    [KERNEL_REL],
    `exactly one file may DECLARE a bucket-order array; found ${JSON.stringify(declaringOrder)}`,
  );

  // The former homes are named explicitly so a re-introduced copy is diagnosed by file, not by count.
  for (const former of FORMER_HOMES) {
    const text = fs.readFileSync(path.join(REPO_ROOT, former), "utf8");
    assert.equal(declaresCanonicalBuckets(text), false, `${former} re-introduced a canonicalBuckets declaration`);
    assert.deepEqual(declaredBucketOrderNames(text), [], `${former} re-introduced a bucket-order array`);
  }
});

test("② identity: the plugin entry and the kernel leaf expose the SAME function and the SAME order array", () => {
  assert.equal(
    typeof pluginAttributionNs.canonicalBuckets,
    "function",
    "plugin/scripts/suite-bucket-attribution.ts must re-export the kernel's canonicalBuckets",
  );
  assert.equal(
    pluginAttributionNs.canonicalBuckets,
    kernelNs.canonicalBuckets,
    "the plugin entry must expose the very same function object — a re-implementation would be a different object",
  );
  assert.equal(
    pluginAttributionNs.BUCKET_ORDER,
    kernelNs.BUCKET_ORDER,
    "the plugin entry must re-export the very same BUCKET_ORDER array — a re-typed copy would be a different object",
  );
});

test("③ behavior: canonical order, UNRESOLVED on empty, and the negative control", () => {
  // The order is the CONTRACT, so it is enumerated, not sampled.
  assert.deepEqual([...BUCKET_ORDER], ["P", "S", "M"], "BUCKET_ORDER is P,S,M");

  assert.equal(canonicalBuckets(new Set()), "UNRESOLVED", "an empty set is UNRESOLVED (unreadable ≠ a bucket)");
  assert.equal(canonicalBuckets(new Set(["P"])), "P");
  assert.equal(canonicalBuckets(new Set(["S"])), "S");
  assert.equal(canonicalBuckets(new Set(["M"])), "M");
  assert.equal(canonicalBuckets(new Set(["P", "M"])), "P+M");
  assert.equal(canonicalBuckets(new Set(["M", "S"])), "S+M");
  assert.equal(canonicalBuckets(new Set(["P", "S", "M"])), "P+S+M");

  // The motivating property: INSERTION ORDER must never leak into the string form. A `for…of`
  // rewrite over the input set (the plausible re-implementation) fails exactly here.
  assert.equal(canonicalBuckets(new Set(["M", "P", "S"])), "P+S+M", "insertion order must not leak");
  assert.equal(canonicalBuckets(new Set(["S", "P"])), "P+S", "insertion order must not leak");

  // Negative control: a non-empty set can never be reported as UNRESOLVED.
  for (const b of ["P", "S", "M"]) {
    assert.notEqual(canonicalBuckets(new Set([b])), "UNRESOLVED", `a non-empty set ({${b}}) must not read UNRESOLVED`);
  }
});

test("④ the finding's own predicate, re-run: the former spellings are gone from the production tree", () => {
  // The exact three-line body the finding keyed on. Assembled from segments so the needle is not
  // silently changed by a quoting layer; it is the assertion's own input.
  const BODY = 'return BUCKET_ORDER.filter((b) => buckets.has(b)).join("+");';
  const GUARD = 'if (buckets.size === 0) return "UNRESOLVED";';

  const bodyHits = filesMatching((t) => t.includes(BODY));
  assert.ok(bodyHits.includes(KERNEL_REL), `the kernel leaf must carry the body; found it in: ${JSON.stringify(bodyHits)}`);
  assert.deepEqual(
    bodyHits.filter((f) => f !== KERNEL_REL),
    [],
    `no file but the kernel leaf may spell the canonical-bucket body; found ${JSON.stringify(bodyHits)}`,
  );

  const guardHits = filesMatching((t) => t.includes(GUARD));
  assert.deepEqual(guardHits, [KERNEL_REL], `exactly one file may spell the empty-set guard; found ${JSON.stringify(guardHits)}`);

  // And the named former homes may not carry either spelling (the failing-if-reverted list).
  for (const former of FORMER_HOMES) {
    const text = fs.readFileSync(path.join(REPO_ROOT, former), "utf8");
    assert.equal(text.includes(BODY), false, `${former} re-introduced the canonical-bucket body`);
    assert.equal(text.includes(GUARD), false, `${former} re-introduced the empty-set guard`);
  }
});
