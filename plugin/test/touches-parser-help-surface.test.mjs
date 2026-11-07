// @test-group engine
// touches-parser-help-surface.test.mjs — task gap-touches-parser-a-self-describing (AC1).
//
// THE GAP THIS TEST CLOSES: an agent learned the three `## Touches` rules (s3-7 annotation strip,
// sa5b-3 section selection, sa5b-4 label recognition) only by reading source or by hitting a
// rejection — `quay task create --help` carried NO Touches grammar at all, and `diagnoseTouches`
// codes were unnameable from the product surface.
//
// AC1 (CROSS-LAYER): run the REAL CLI (`node packages/quay/bin/quay.js task create --help`) and
// parse its STDOUT for `touches-<name> [problem|reading]`. The 7 codes read back must equal, item
// by item, the union of the two kernel tables — code AND kind AND rule AND meaning.
//
// ⛔ WHAT THIS TEST MUST NOT DO (the AC says so in words): import the tables and compare them to
// themselves. The assertion below only ever compares the TABLE (the authority) against PARSED
// STDOUT (a product surface produced by a separate process) — a help block that stops rendering a
// code, renders it under the wrong kind, or drifts from the table's wording reddens here, and no
// amount of internal consistency can hide it.
//
// Run:
//   node --test plugin/test/touches-parser-help-surface.test.mjs
//   scripts/test.sh plugin/test/touches-parser-help-surface.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { TOUCHES_PROBLEM_CODES, TOUCHES_READING_CODES } from "../../packages/quay/src/kernel/touches-annotation.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI_SHIM = path.join(REPO_ROOT, "packages", "quay", "bin", "quay.js");

/** Run the real CLI's create help once; every assertion below reads THIS stdout. */
function realCreateHelp() {
  const r = spawnSync(process.execPath, [CLI_SHIM, "task", "create", "--help"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(r.error, undefined, `spawning the real CLI failed: ${r.error}`);
  assert.equal(r.status, 0, `quay task create --help must exit 0 (stderr: ${r.stderr})`);
  assert.ok(r.stdout.length > 0, "quay task create --help must print to stdout");
  return r.stdout;
}

/** Parse `code [problem|reading]` pairs out of raw help stdout — no knowledge of the tables. */
function parseCodesFromHelp(stdout) {
  const out = [];
  const re = /\b(touches-[a-z-]+)\s+\[(problem|reading)\]/g;
  let m;
  while ((m = re.exec(stdout)) !== null) out.push({ code: m[1], kind: m[2] });
  return out;
}

const stdout = realCreateHelp();
const parsed = parseCodesFromHelp(stdout);

test("AC1: the real `task create --help` stdout carries exactly the 7 codes of the two tables, item by item", () => {
  const expected = [
    ...TOUCHES_PROBLEM_CODES.map((r) => ({ code: r.code, kind: "problem" })),
    ...TOUCHES_READING_CODES.map((r) => ({ code: r.code, kind: "reading" })),
  ];

  // (a) EXACT SET EQUALITY, item by item — not "all expected are present" (an extra code that no
  //     table declares is a second, drifted naming point, and a subset check would wave it through).
  const expectedCodes = expected.map((e) => e.code).sort();
  const parsedCodes = parsed.map((p) => p.code).sort();
  assert.deepEqual(parsedCodes, expectedCodes, `help stdout codes ${JSON.stringify(parsedCodes)} != table union ${JSON.stringify(expectedCodes)}`);

  // (b) each code appears ONCE and under the kind its table declares.
  const seen = new Set();
  for (const p of parsed) {
    assert.ok(!seen.has(p.code), `${p.code} rendered more than once in the help surface`);
    seen.add(p.code);
    const want = expected.find((e) => e.code === p.code);
    assert.equal(p.kind, want.kind, `${p.code} rendered as [${p.kind}], table declares [${want.kind}]`);
  }
  assert.equal(parsed.length, 7, "AC1 names 7 codes");
});

test("AC1: each rendered line also carries its rule id and the table's meaning verbatim", () => {
  const lines = stdout.split("\n");
  for (const row of [...TOUCHES_PROBLEM_CODES, ...TOUCHES_READING_CODES]) {
    const line = lines.find((l) => l.includes(row.code));
    assert.ok(line, `${row.code} has no rendered line`);
    assert.ok(line.includes(`rule ${row.rule}`), `${row.code}'s line must name rule ${row.rule}: ${line}`);
    assert.ok(line.includes(row.meaning), `${row.code}'s line must carry the table meaning (the help is DERIVED; a hand-written second copy drifts): ${line}`);
  }
});

test("AC1 negative control: the parser would NOTICE a help surface that lost a code", () => {
  // The extractor above is the measuring instrument; prove it can read a FAILING surface, otherwise
  // "7 codes found" is indistinguishable from "the regex matches everything" (硬规则 4).
  const crippled = stdout.replace(/touches-label-delete\s+\[reading\]/, "label delete (rendered without its code)");
  const codes = parseCodesFromHelp(crippled).map((c) => c.code);
  assert.ok(!codes.includes("touches-label-delete"), "the extractor must not find a code that the surface does not render");
  assert.equal(codes.length, 6);
});
