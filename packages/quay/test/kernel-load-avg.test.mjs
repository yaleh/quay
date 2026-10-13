// @test-group product
// kernel-load-avg.test.mjs — the kernel leaf `packages/quay/src/kernel/load-avg.ts` and its three
// consumers across the plugin/product boundary.
// (gap-routine-semantic-dedup-scan-loadavg-readers; routine semantic-dedup-scan finding
// `loadavg-readers`, runId `semantic-dedup-scan-1791908616513`.)
//
// WHAT THIS FILE IS FOR — and why the obvious test would have been the wrong one.
//
// The finding was "the SAME /proc/loadavg field-0 reader, byte-identical, under two names" — and, once
// the two named copies were put side by side, a third copy differing only by a redundant `String(…)`
// wrapper around an already-`string` read. The tempting test is therefore "readLoadAvg1() returns the
// host load" — but that test PASSED before the fix too, three times, in three files. It is the 硬规则 4
// 推论三 shape: a criterion satisfied by the OLD arrangement measures nothing about the change. A test
// of the FIX must go red if the duplication returns.
//
// So the assertions are structural first and behavioral second:
//
//   ① SINGLE-SOURCE — the production tree must carry the body ONCE, and none of the three former
//      copies may carry it again. "One implementation" is checked as one BODY, not as one import
//      statement: a re-inlined copy leaves ①'s set non-singleton no matter how the import is spelled.
//      The needle is written WITH the `String(…)` wrapper, so the zero-count half is the wrapped-less
//      form engine.ts used — a near-copy that differs only by that wrapper is caught too (硬规则 2:
//      非零查「命中的是不是我要的」, 零查「谓词对已知为真的样本命不命中」— both halves are run below).
//   ② WIRING — all three consumers import the kernel leaf. `acceptance-runner.ts` used to document the
//      agreement by comment ("same reading as checker-cost.sh"); a comment cannot go red, this can.
//   ③ IDENTITY — the mechanism layer and the product layer reach the SAME function object. A
//      re-implementation in either layer is a different object, which is what ② alone would miss.
//   ④ BEHAVIOR — the reading equals the host's REAL /proc/loadavg field 0 (host-dependent: a constant,
//      a wrong field, or a wrong file all fail it), plus the guard pin below.
//
// ⛔ WHAT ④ DOES **NOT** MEASURE, stated rather than implied (硬规则 3b: 「没查成」must not be shaped
// like 「查过且合格」): the catch-to-0 branch is NOT exercised. `readLoadAvg1` reads the absolute path
// `/proc/loadavg` and carries no path seam, so unreadability cannot be induced from a test without
// first adding an injection seam to a telemetry reader — scope this finding did not ask for and which
// would itself be a second contract to keep. The branch is therefore pinned at SOURCE level (the last
// assertion) and the negative control below shows why the guard's exact form matters.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readLoadAvg1 } from "../src/kernel/load-avg.ts";
import * as kernelNs from "../src/kernel/load-avg.ts";
import * as fullSuiteNs from "../../../plugin/scripts/full-suite-runner.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** The byte-identical body the finding keyed on, written as a template literal with escaped `\s` so
 *  the regex source inside the needle survives verbatim. It is the EXACT text of the former
 *  `readLoadAvg` / `gateLoadAvg` bodies including the `String(…)` wrapper. */
const BODY = [
  "  try {",
  '    const v = Number(String(fs.readFileSync("/proc/loadavg", "utf8")).trim().split(/\\s+/)[0]);',
  "    return Number.isFinite(v) ? v : 0;",
  "  } catch {",
  "    return 0;",
  "  }",
].join("\n");

/** The same reader WITHOUT the redundant `String(…)` wrapper — the form `gate/engine.ts`'s private
 *  `load1` used. A near-copy is exactly what a byte-digest probe cannot see, so it gets its own
 *  (zero-count) half rather than being left to ①'s exact set. */
const BODY_UNWRAPPED = BODY.replace('Number(String(fs.readFileSync("/proc/loadavg", "utf8"))', 'Number(fs.readFileSync("/proc/loadavg", "utf8")');

/** Every production tree the finding's probe scans. `archive/**` and `*test*` are excluded by the
 *  probe's own surface rules, so they are excluded here too — this reads the same surface the finding
 *  did. `dist` is excluded for the same reason: `packages/<pkg>/dist` and `plugin/vendor/<pkg>/dist` are
 *  BUILT bundles, and a bundled copy of the kernel leaf is an inlining artifact, not a second
 *  implementation. */
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

/** The three copies the finding found — named so a regression's failure message is diagnostic rather
 *  than a bare count. Two were byte-identical under a rename (`readLoadAvg` / `gateLoadAvg`), which is
 *  precisely what hid the pair from name-based scans; the third is the same reading under a redundant
 *  `String(…)` wrapper. */
const FORMER_COPIES = [
  "plugin/scripts/full-suite-runner.ts",
  "packages/quay/src/gate/acceptance-runner.ts",
  "packages/quay/src/gate/engine.ts",
];

test("① the body exists exactly ONCE in the production tree, and in NONE of the three former copies", () => {
  const hits = filesContaining(BODY);

  // Stated as an EXACT set — not "at most N". The kernel leaf deliberately does NOT quote the body in
  // its header, so one file is the whole truth: a copy re-appearing ANYWHERE — one of the three the
  // finding named, or a brand-new fourth site — takes this red. The looser `<= 3` form would tolerate
  // exactly the re-copies that matter, which is the 硬规则 4c 空转 shape (a criterion that stays true
  // while measuring nothing).
  assert.deepEqual(
    hits,
    ["packages/quay/src/kernel/load-avg.ts"],
    `the body must live in EXACTLY one production file — the kernel leaf; got: ${JSON.stringify(hits)}`,
  );

  // The finding's own predicate, re-run as a NAMED list.
  const regressed = FORMER_COPIES.filter((f) => hits.includes(f));
  assert.deepEqual(regressed, [], `these files re-introduced a local body: ${JSON.stringify(regressed)}`);
});

test("① (zero-count half) the wrapped-less near-copy has ZERO hits — the needle is not blind to it", () => {
  // 硬规则 2's other half. The predicate above is a non-zero count, so it must be shown to be keyed on
  // the right text; this predicate is a zero count, so it must be shown to HIT a known-true sample —
  // which it did before the fix (`packages/quay/src/gate/engine.ts`'s `load1` carried exactly this
  // text) and must not now. A `String(…)` wrapper around `readFileSync(p, "utf8")`'s already-`string`
  // result is a no-op, so a "fix" that merely re-spelled the wrapper would still be the same copy.
  const hits = filesContaining(BODY_UNWRAPPED);
  assert.deepEqual(
    hits,
    [],
    `no production file may carry the wrapped-less form — it is the same reading under a different spelling; got: ${JSON.stringify(hits)}`,
  );

  // Negative control for THIS predicate (硬规则 2's zero-count half: a zero count is only evidence if
  // the predicate is shown to fire on a known-true sample). The kernel leaf's own body IS that sample,
  // re-spelled by exactly the wrapper — so the pair of assertions below proves the two needles
  // discriminate on the wrapper and on nothing else, rather than one of them being malformed text.
  const leafSrc = readRepoFile("packages/quay/src/kernel/load-avg.ts");
  assert.ok(leafSrc.includes(BODY), "the live needle must match the kernel leaf — otherwise ①'s exact set is vacuous too");
  assert.ok(!leafSrc.includes(BODY_UNWRAPPED), "the wrapped-less needle must NOT match the wrapped leaf body");
});

test("② all three consumers import the kernel leaf (the wiring, not just the body count)", () => {
  // Product side: the two `gate/` consumers import it in-package.
  for (const rel of ["packages/quay/src/gate/acceptance-runner.ts", "packages/quay/src/gate/engine.ts"]) {
    assert.ok(
      readRepoFile(rel).includes('from "../kernel/load-avg.ts"'),
      `${rel} must import the kernel leaf (\`../kernel/load-avg.ts\`)`,
    );
  }
  // Mechanism side: the cross-tree import. Its direction is the load-bearing part — the product side
  // may not import `plugin/**` (import-graph-check's reverseEdges ratchet, baselined at 0).
  assert.ok(
    readRepoFile("plugin/scripts/full-suite-runner.ts").includes('from "../../packages/quay/src/kernel/load-avg.ts"'),
    "plugin/scripts/full-suite-runner.ts must import the kernel leaf across the tree (plugin → kernel)",
  );
});

test("③ the mechanism layer and the product layer reach the SAME function object", () => {
  assert.equal(
    typeof fullSuiteNs.readLoadAvg,
    "function",
    "plugin/scripts/full-suite-runner.ts must still export readLoadAvg (its public surface is unchanged)",
  );
  assert.equal(
    fullSuiteNs.readLoadAvg,
    kernelNs.readLoadAvg1,
    "the two layers must expose the very same function object — a re-implementation would be a different object",
  );
});

test("④ behavior: the reading equals the host's REAL /proc/loadavg field 0", () => {
  // Read the SAME production carrier the implementation reads, independently. This is a real
  // measurement rather than a fixture echo (硬规则 4 推论三): the expected value is host- and
  // moment-dependent, so a constant, a hard-coded field index, or a wrong path all fail it.
  //
  // ⛔ SANDWICHED on purpose (硬规则 4c — name every layer between the value's PRODUCER and this
  // read): the value is produced by the KERNEL and re-derived on its own tick (~2.5–5 s, measured on
  // this host: 1 change in a 4 s window), so the kernel itself is a layer that can rewrite the
  // reading between the call and the comparison. A bare `assert.equal(readLoadAvg1(), expected)`
  // would therefore be a genuine (if rare) flake under the suite's parallel load, where this process
  // can be descheduled across a tick. Bounding the expected value by the readings taken immediately
  // BEFORE and AFTER keeps the assertion falsifiable — a constant, a wrong field (`"16/16562"` →
  // NaN), or a wrong path all still fail it — while removing the only race in it.
  const parse = () => Number(fs.readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/)[0]);
  const before = parse();
  const got = readLoadAvg1();
  const after = parse();
  assert.ok(Number.isFinite(before) && Number.isFinite(after), "this host's /proc/loadavg field 0 must be numeric for this test to mean anything");
  assert.ok(
    got === before || got === after,
    `readLoadAvg1() must answer /proc/loadavg field 0 verbatim — got ${got}, bracketed by ${before} and ${after}`,
  );

  // Contract: a NUMBER, finite and non-negative. `0` is a VALID reading (an idle box) — which is
  // exactly why the guard below is `Number.isFinite` and not a truthiness test.
  const v = readLoadAvg1();
  assert.equal(typeof v, "number");
  assert.ok(Number.isFinite(v), "the reading must be finite");
  assert.ok(v >= 0, "a load average is never negative");

  // The guard, pinned at SOURCE level (see the header: the unreadable branch has no seam, so it is not
  // claimed to be behaviorally exercised). The form matters: `Number("1e999")` is `Infinity`, which
  // `Number.isFinite` rejects and a `!Number.isNaN(v)` guard would let through — and `Infinity` then
  // reaches the ledger as `null` through `JSON.stringify`, i.e. as "no reading at all" rather than as
  // the not-evaluated it would be. Pinning the guard keeps that distinction from being re-spelled away.
  const src = readRepoFile("packages/quay/src/kernel/load-avg.ts");
  assert.ok(
    src.includes("return Number.isFinite(v) ? v : 0;"),
    "the guard must stay `Number.isFinite(v) ? v : 0` — a truthiness/NaN-only guard changes which readings survive",
  );
});
