// @test-group product
// Stage 5 (exp5-M-CRYST-D1) — `quay-native doc` CLI verb: the consult surface
// for the document-management capability (list/get/write mirror `adr`'s own
// shape; `validate` is the NEW verb printing contract-validator.js's
// validateContracts() results as a pass/fail table, exit 0/1). RED-first per
// ADR-001 (TDD).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { QUAY_NATIVE_CLI } from "../../quay/test/helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;

// Every docs dir is removed once at the end of this file (the carrier-array + after() pattern) —
// a mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDocsDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-doc-cli-${tag}-`));
  _tmpDirs.push(dir);
  return dir;
}

function runNative(args, docsDir) {
  try {
    const out = execFileSync("node", [nativeBin, ...args], {
      encoding: "utf8",
      env: { ...process.env, QUAY_NATIVE_DOCS_DIR: docsDir },
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

test("doc write + get round-trip via the CLI", () => {
  const dir = tmpDocsDir("roundtrip");
  const w = runNative(
    ["doc", "write", "DOC-001", "--title", "a doc", "--status", "active", "--kind", "skill", "--body", "## X\nbody", "--json"],
    dir
  );
  assert.equal(w.status, 0, w.stderr);
  const g = runNative(["doc", "get", "DOC-001", "--json"], dir);
  assert.equal(g.status, 0);
  const doc = JSON.parse(g.stdout);
  assert.equal(doc.id, "DOC-001");
  assert.equal(doc.status, "active");
  assert.equal(doc.kind, "skill");
});

test("doc list lists written documents", () => {
  const dir = tmpDocsDir("list");
  runNative(["doc", "write", "DOC-001", "--title", "a", "--status", "active", "--kind", "skill", "--body", "b"], dir);
  runNative(["doc", "write", "DOC-002", "--title", "b", "--status", "draft", "--kind", "skill", "--body", "b"], dir);
  const l = runNative(["doc", "list", "--json"], dir);
  assert.equal(l.status, 0);
  const docs = JSON.parse(l.stdout);
  assert.equal(docs.length, 2);
});

test("doc validate PASSes (exit 0) for a conforming document", () => {
  const dir = tmpDocsDir("validate-pass");
  runNative(
    ["doc", "write", "DOC-001", "--title", "t", "--status", "active", "--kind", "skill",
     "--body", "## Rule\nnever overwrite human work",
     "--contracts", JSON.stringify([{ target: "self", type: "grep", pattern: "never overwrite", description: "d1" }])],
    dir
  );
  const v = runNative(["doc", "validate", "DOC-001"], dir);
  assert.equal(v.status, 0, `expected PASS; stdout=${v.stdout} stderr=${v.stderr}`);
  assert.match(v.stdout, /PASS/);
});

test("doc validate FAILs (exit 1) for a violating document, printing per-assertion table", () => {
  const dir = tmpDocsDir("validate-fail");
  runNative(
    ["doc", "write", "DOC-001", "--title", "t", "--status", "active", "--kind", "skill",
     "--body", "## Rule\nsomething else",
     "--contracts", JSON.stringify([{ target: "self", type: "grep", pattern: "never overwrite", description: "d1" }])],
    dir
  );
  const v = runNative(["doc", "validate", "DOC-001"], dir);
  assert.equal(v.status, 1);
  assert.match(v.stdout, /FAIL/);
});

test("doc validate fails-closed (exit 1) for a missing document id", () => {
  const dir = tmpDocsDir("validate-missing");
  const v = runNative(["doc", "validate", "DOC-999"], dir);
  assert.equal(v.status, 1);
});

test("doc validate --json emits the raw {ok, results} shape", () => {
  const dir = tmpDocsDir("validate-json");
  runNative(
    ["doc", "write", "DOC-001", "--title", "t", "--status", "active", "--kind", "skill",
     "--body", "## Rule\nnever overwrite human work",
     "--contracts", JSON.stringify([{ target: "self", type: "grep", pattern: "never overwrite", description: "d1" }])],
    dir
  );
  const v = runNative(["doc", "validate", "DOC-001", "--json"], dir);
  assert.equal(v.status, 0);
  const parsed = JSON.parse(v.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.results.length, 1);
});
