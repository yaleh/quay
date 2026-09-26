// @test-group product
// kernel-env-merge.test.mjs — the kernel leaf `packages/quay/src/kernel/env-merge.ts` and its two
// consumers across the plugin/product boundary.
// (gap-routine-semantic-dedup-scan-mergeenv-cross-layer-byte-identical-under-rename; routine
// semantic-dedup-scan finding `mergeenv-cross-layer-byte-identical-under-renamed-symbol`.)
//
// WHAT THIS FILE IS FOR — and why the obvious test would have been the wrong one.
//
// The finding was "an 8-line byte-identical body under TWO names". The tempting test is therefore
// "mergeEnv merges env vars" — but that test PASSED before the fix too, twice, in two files. It is
// the 硬规则 4 推论三 shape: a criterion satisfied by the OLD arrangement measures nothing about the
// change. A test of the FIX must fail if the duplication returns.
//
// So the assertions are structural first and behavioral second:
//
//   ① SINGLE-SOURCE — the production tree must carry the body ONCE, and the two former copies must
//      not carry it again. "One implementation" is checked as one BODY, not as one import statement:
//      a re-inlined copy leaves ①'s body count red no matter how the import is spelled.
//   ② WIRING — both consumers import the kernel leaf. `goal-store.ts` used to document the agreement
//      by comment ("复刻 profile-policy mergeEnv"); a comment cannot go red, this can.
//   ③ IDENTITY — the mechanism layer and the product layer reach the SAME function object. A
//      re-implementation in either layer is a different object, which is what ② alone would miss.
//   ④ BEHAVIOR — the `""`-cancels-inheritance rule (`"0"` is a VALID value and must survive) plus
//      the motivating case: the manager cancels the 917k env trio by overriding them with `""`.
//      The negative control (硬规则 2's zero-count half) asserts the naive spread WITHOUT the delete
//      rule does NOT cancel — otherwise ④'s cancellation assertions prove nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeEnv } from "../src/kernel/env-merge.ts";
import * as kernelNs from "../src/kernel/env-merge.ts";
import * as profilePolicyNs from "../../../plugin/scripts/profile-policy.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** The byte-identical body line the finding keyed on — the thing that must exist ONCE.
 *  Written as a plain single-quoted literal: it carries no backslash and no `${}`, so unlike the
 *  regex-escape sibling's needle there is no escaping layer that could silently change it. */
const BODY = 'if (v === "") delete out[k];';

/** Every production tree the finding's probe scans (archive/** and *test* are excluded by the probe's
 *  own surface rules, so they are excluded here too — this reads the same surface the finding did).
 *  `dist` is excluded for the same reason: plugin/vendor/**\/dist/*.js are BUILT bundles, and a
 *  bundled copy of the kernel leaf is an inlining artifact, not a second implementation. */
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

/** Files whose TEXT contains `needle`, as repo-relative POSIX paths. */
function filesContaining(needle) {
  const hits = [];
  for (const root of SCAN_ROOTS) {
    for (const abs of walkProductionSources(path.join(REPO_ROOT, root))) {
      const text = fs.readFileSync(abs, "utf8");
      if (text.includes(needle)) hits.push(path.relative(REPO_ROOT, abs).split(path.sep).join("/"));
    }
  }
  return hits.sort();
}

const readRepoFile = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

test("① the body exists exactly ONCE in the production tree, and NOT in the two former copies", () => {
  const hits = filesContaining(BODY);

  // The one home, stated as an EXACT set — not "at most N". The kernel file deliberately does NOT
  // quote the body in its header (unlike the regex-escape sibling), so one file is the whole truth:
  // a copy re-appearing ANYWHERE — one of the two the finding named, or a brand-new third site —
  // takes this red. The looser `<= 2` form would tolerate exactly one unrelated re-copy, which is
  // the 硬规则 4c 空转 shape (a criterion that stays true while measuring nothing).
  assert.deepEqual(
    hits,
    ["packages/quay/src/kernel/env-merge.ts"],
    `the body must live in EXACTLY one production file — the kernel leaf; got: ${JSON.stringify(hits)}`,
  );

  // The finding's own predicate, re-run as a NAMED list: `plugin/scripts/profile-policy.ts`'s
  // `mergeEnv` and `packages/quay/src/goal-store.ts`'s `mergeProfileEnv` were the two byte-identical
  // copies (one renamed, which is what hid the pair from name-based scans). Naming them keeps the
  // failure message diagnostic instead of a bare count.
  const FORMER_COPIES = [
    "plugin/scripts/profile-policy.ts",
    "packages/quay/src/goal-store.ts",
  ];
  const regressed = FORMER_COPIES.filter((f) => hits.includes(f));
  assert.deepEqual(regressed, [], `these files re-introduced a local body: ${JSON.stringify(regressed)}`);
});

test("② both consumers import the kernel leaf (the wiring, not just the body count)", () => {
  // Product side: goal-store.ts imports it in-package.
  assert.ok(
    readRepoFile("packages/quay/src/goal-store.ts").includes('from "./kernel/env-merge.ts"'),
    "packages/quay/src/goal-store.ts must import the kernel leaf (`./kernel/env-merge.ts`)",
  );
  // Mechanism side: the cross-tree import. Its direction is the load-bearing part — the product side
  // may not import `plugin/**` (import-graph-check's reverseEdges ratchet, baselined at 0).
  assert.ok(
    readRepoFile("plugin/scripts/profile-policy.ts").includes('from "../../packages/quay/src/kernel/env-merge.ts"'),
    "plugin/scripts/profile-policy.ts must import the kernel leaf across the tree (plugin → kernel)",
  );
});

test("③ the mechanism layer and the product layer reach the SAME function object", () => {
  assert.equal(
    typeof profilePolicyNs.mergeEnv,
    "function",
    "plugin/scripts/profile-policy.ts must still export mergeEnv (its public surface is unchanged)",
  );
  assert.equal(
    profilePolicyNs.mergeEnv,
    kernelNs.mergeEnv,
    "the two layers must expose the very same function object — a re-implementation would be a different object",
  );
});

test("④ behavior: `\"\"` cancels inheritance (deletes the key), `\"0\"` is a valid value that survives", () => {
  // The motivating case: the manager cancels the 917k env trio by overriding it with `""`
  // (the mechanism layer's retained form; see the kernel leaf's note on why its old
  // `quay-launch.sh:98` anchor is dead now that the shell layer uses an explicit `unset` list).
  const base = { ANTHROPIC_API_KEY: "917k", ANTHROPIC_BASE_URL: "917k", OTHER: "keep-me" };
  const cancelled = mergeEnv(base, { ANTHROPIC_API_KEY: "", ANTHROPIC_BASE_URL: "" });
  assert.equal("ANTHROPIC_API_KEY" in cancelled, false, "`\"\"` must DELETE the key, not set it to the empty string");
  assert.equal("ANTHROPIC_BASE_URL" in cancelled, false, "`\"\"` must DELETE the key, not set it to the empty string");
  assert.equal(cancelled.OTHER, "keep-me");

  // `"0"` is falsy but VALID — a truthiness test would silently drop it (硬规则 3: an enumerated
  // contract, not a sampled one). Same for other falsy-looking-but-real values.
  const zeros = mergeEnv({ A: "1" }, { A: "0", B: "0", C: "false", D: "" });
  assert.equal(zeros.A, "0", "`\"0\"` must override, not be treated as absent");
  assert.equal(zeros.B, "0", "`\"0\"` must be retained");
  assert.equal(zeros.C, "false", "a non-empty string is a value regardless of how it reads");
  assert.equal("D" in zeros, false, "`\"\"` still deletes when mixed with real values");

  // Override wins; base is not mutated; unset keys are inherited untouched.
  const merged = mergeEnv({ A: "1", B: "2" }, { B: "3", C: "4" });
  assert.deepEqual(merged, { A: "1", B: "3", C: "4" });
  assert.deepEqual(base, { ANTHROPIC_API_KEY: "917k", ANTHROPIC_BASE_URL: "917k", OTHER: "keep-me" }, "base must not be mutated");

  // Degenerate shapes are enumerated, not inferred.
  assert.deepEqual(mergeEnv({}, {}), {});
  assert.deepEqual(mergeEnv({ A: "1" }, {}), { A: "1" });
  assert.deepEqual(mergeEnv({}, { A: "1" }), { A: "1" });
});

test("④ (negative control) the naive spread does NOT cancel — otherwise the assertions above are vacuous", () => {
  const base = { ANTHROPIC_API_KEY: "917k" };
  const override = { ANTHROPIC_API_KEY: "" };

  // The rule this module exists for is the DELETE. A plain spread leaves the key present-with-`""`,
  // which is exactly the failure mode the caller (env inheritance) must not have: the child would
  // receive an empty ANTHROPIC_API_KEY, which is NOT the same as not receiving it.
  const naive = { ...base, ...override };
  assert.ok("ANTHROPIC_API_KEY" in naive, "the naive spread must keep the key — if it did not, the delete rule would be untestable here");
  assert.equal(naive.ANTHROPIC_API_KEY, "");

  // And the real implementation differs from that naive form on exactly this input.
  const real = mergeEnv(base, override);
  assert.notDeepEqual(real, naive, "mergeEnv must differ from the naive spread on a `\"\"` override");
  assert.equal("ANTHROPIC_API_KEY" in real, false);
});
