// @test-group engine
// serve-binding-literal-check.test.mjs — AC1 / AC7 / AC8 of
// gap-serve-binding-defaults-three-copies-to-one-definition-point, WITH its two-way control.
//
// AC1's predicate is the task's own grep: the double-quoted bind default appears ≤1 time across
// packages/quay/src + plugin/scripts, and that one hit rides on the SERVE_BINDING_FALLBACK
// declaration. A check that can only ever print PASS is not a check (硬规则 3b) — so every fixture
// below is a REAL tree on disk, and the RED fixtures prove the checker BITES: put the literal back
// in a second file and it must FAIL.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkServeBindingLiteral,
  SCAN_ROOTS,
  HOLDER_REL,
  DECLARATION_MARKER,
  DOC_SURFACE_REL,
  ADVISORY_ALLOWLIST,
} from "../scripts/serve-binding-literal-check.ts";
import { SERVE_BINDING_FALLBACK } from "../../packages/quay/src/serve-binding.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOST = SERVE_BINDING_FALLBACK.host;
const QUOTED_HOST = JSON.stringify(HOST);
const DECLARATION = `export const ${DECLARATION_MARKER} = { host: ${QUOTED_HOST}, port: 0 };\n`;
const DOC = `# drivers\n\n\`quay serve --host <ip>\` (default host ${HOST})\n`;

/** Materialize a fixture tree: { relPath: content }. The doc surface is always present unless the
 *  case is specifically about it — a missing one is its own FAIL arm, not a silent pass. */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serve-binding-literal-"));
  const all = { [DOC_SURFACE_REL]: DOC, ...files };
  for (const [rel, content] of Object.entries(all)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

test("GREEN: the real repo holds exactly ONE quoted bind default, and it is the SERVE_BINDING_FALLBACK declaration", () => {
  const report = checkServeBindingLiteral(REPO_ROOT);
  assert.equal(report.ok, true, report.reason);
  assert.equal(report.hits.length, 1, `AC1: exactly 1 quoted bind default, got ${report.hits.length}`);
  assert.equal(report.hits[0].file, HOLDER_REL);
  assert.match(report.hits[0].text, new RegExp(DECLARATION_MARKER),
    "the single hit is the fallback declaration — not some other reader spelling the binding");
  // The sibling set is REPORTED (硬规则 5b), never silently dropped, and every advisory entry is an
  // explicitly allowlisted file with a documented reason.
  assert.ok(Array.isArray(report.advisory));
  const allow = new Set(ADVISORY_ALLOWLIST.map((a) => a.rel));
  for (const a of report.advisory) {
    assert.ok(allow.has(a.file), `advisory entry ${a.file}:${a.line} is not allowlisted`);
  }
  assert.equal(report.docSurface.ok, true, report.docSurface.detail);
  assert.deepEqual(SCAN_ROOTS, ["packages/quay/src", "plugin/scripts"]);
});

test("RED (control 1): a second quoted default in an ENTRY file FAILS", () => {
  const root = fixture({
    [HOLDER_REL]: DECLARATION,
    "packages/quay/src/serve.ts": `const host = opts.host ?? ${QUOTED_HOST};\n`,
  });
  try {
    const report = checkServeBindingLiteral(root);
    assert.equal(report.ok, false, "a re-grown bind default must be caught");
    assert.equal(report.hits.length, 2);
    assert.ok(report.hits.some((h) => h.file === "packages/quay/src/serve.ts"), "the offending site is named");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RED (control 2): the loopback literal in a plugin script FAILS too (both scan roots are covered)", () => {
  const root = fixture({
    [HOLDER_REL]: DECLARATION,
    "plugin/scripts/some-spawner.ts": `spawn(cli, ["serve", "--host", "127.0.0.1"]);\n`,
  });
  try {
    assert.equal(checkServeBindingLiteral(root).ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RED (control 3): the ONLY hit outside the declaration FAILS (the value must live on the single entry)", () => {
  const root = fixture({
    "packages/quay/src/elsewhere.ts": `export const H = ${QUOTED_HOST};\n`,
  });
  try {
    const report = checkServeBindingLiteral(root);
    assert.equal(report.ok, false, "a lone literal in a non-holder file is exactly the drift the invariant forbids");
    assert.match(report.reason, /NOT the SERVE_BINDING_FALLBACK declaration/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("GREEN: an ALLOWLISTED file's quoted address is advisory, never a hard hit", () => {
  const allowed = ADVISORY_ALLOWLIST[0].rel;
  const root = fixture({
    [HOLDER_REL]: DECLARATION,
    [allowed]: `if (host === ${QUOTED_HOST}) return "127.0.0.1";\n`,
  });
  try {
    const report = checkServeBindingLiteral(root);
    assert.equal(report.ok, true, report.reason);
    assert.equal(report.hits.length, 1, "the allowlisted occurrence is not a hard hit");
    assert.ok(report.advisory.some((h) => h.file === allowed), "…but it IS reported as advisory");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RED (AC8): a doc surface that has drifted from the fallback FAILS, and an unreadable one is NOT a pass", () => {
  // (a) present but stale.
  const stale = fixture({ [HOLDER_REL]: DECLARATION, [DOC_SURFACE_REL]: "# drivers\n\n--host default host 10.1.2.3\n" });
  try {
    const report = checkServeBindingLiteral(stale);
    assert.equal(report.ok, false);
    assert.match(report.reason, /has drifted/);
  } finally {
    fs.rmSync(stale, { recursive: true, force: true });
  }
  // (b) absent ⇒ its OWN state (硬规则 3b), never folded into "ok".
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serve-binding-literal-nodoc-"));
  try {
    fs.mkdirSync(path.join(root, path.dirname(HOLDER_REL)), { recursive: true });
    fs.writeFileSync(path.join(root, HOLDER_REL), DECLARATION, "utf8");
    const report = checkServeBindingLiteral(root);
    assert.equal(report.ok, false);
    assert.equal(report.docSurface.ok, false);
    assert.match(report.docSurface.detail, /could not be read/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
