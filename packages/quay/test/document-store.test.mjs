// @test-group product
// Stage 2 (exp5-M-CRYST-D1) — native document-management store. A "document"
// is a SEPARATE kind from both tasks and ADRs: a managed method-artifact
// (skill/methodology-doc/etc.), NOT a decision (no accept/reject lifecycle)
// and NOT a task (no todo/done lifecycle) — its own draft/active/retired
// lifecycle. RED-first per ADR-001 (TDD).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDocumentStore, VALID_DOCUMENT_STATUSES } from "../src/document-store.ts";

// gap-tests-never-clean-up-their-tmpdirs: every tmpDir() created a per-run-unique dir that was never
// removed — /tmp (tmpfs) accumulated 2,868 `document-store-*` dirs. The node:test file-level after()
// hook removes every created dir after the file's tests complete (runs even on failure; unlike a
// process.on('exit') hook which does not run on process.exit(1) in hand-rolled harnesses).
const _createdDirs = [];
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "document-store-"));
  _createdDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("VALID_DOCUMENT_STATUSES is the managed-artifact lifecycle (no decision or todo/done)", () => {
  assert.deepEqual(VALID_DOCUMENT_STATUSES, ["draft", "active", "retired"]);
  assert.ok(!VALID_DOCUMENT_STATUSES.includes("done"));
  assert.ok(!VALID_DOCUMENT_STATUSES.includes("accepted"));
});

test("write rejects an id not matching ^DOC-NNN", () => {
  const s = createDocumentStore(tmpDir());
  assert.throws(() => s.write("DOC-1", { title: "x", status: "draft" }), /invalid document id/);
  assert.throws(() => s.write("ADR-001", { title: "x", status: "draft" }), /invalid document id/);
  assert.throws(() => s.write("../../etc/x", { title: "x", status: "draft" }), /invalid document id/);
});

test("write rejects an invalid status", () => {
  const s = createDocumentStore(tmpDir());
  assert.throws(() => s.write("DOC-001", { title: "x", status: "done" }), /invalid document status/);
  assert.throws(() => s.write("DOC-001", { title: "x", status: "accepted" }), /invalid document status/);
});

test("write accepts each valid status and round-trips", () => {
  const dir = tmpDir();
  const s = createDocumentStore(dir);
  for (const [i, status] of VALID_DOCUMENT_STATUSES.entries()) {
    const id = `DOC-0${10 + i}`;
    const doc = s.write(id, { title: `t ${status}`, status, kind: "skill", body: "## X\nbody" });
    assert.equal(doc.status, status);
    assert.equal(doc.id, id);
    assert.equal(doc.kind, "skill");
  }
});

test("get returns a document view-model with NO parent/children/role and a body", () => {
  const s = createDocumentStore(tmpDir());
  s.write("DOC-001", { title: "quay-directive skill", status: "active", kind: "skill", body: "## Rule\nnever overwrite" });
  const doc = s.get("DOC-001");
  assert.equal(doc.id, "DOC-001");
  assert.equal(doc.title, "quay-directive skill");
  assert.equal(doc.status, "active");
  assert.equal(doc.kind, "skill");
  assert.equal(doc.body, "## Rule\nnever overwrite");
  assert.equal(doc.parent, undefined);
  assert.equal(doc.children, undefined);
  assert.equal(doc.role, undefined);
});

test("get returns null for a missing id", () => {
  const s = createDocumentStore(tmpDir());
  assert.equal(s.get("DOC-999"), null);
});

test("contracts round-trip verbatim (grep/not-grep/target:self shape)", () => {
  const s = createDocumentStore(tmpDir());
  const contracts = [
    { target: "self", type: "grep", pattern: "never overwrite", description: "d1" },
    { target: "self", type: "not-grep", pattern: "TODO", description: "d2" },
  ];
  const doc = s.write("DOC-001", { title: "t", status: "active", kind: "skill", body: "b", contracts });
  assert.deepEqual(doc.contracts, contracts);
  const reread = s.get("DOC-001");
  assert.deepEqual(reread.contracts, contracts);
});

test("contracts default to an empty array when absent", () => {
  const s = createDocumentStore(tmpDir());
  const doc = s.write("DOC-001", { title: "t", status: "active", kind: "skill", body: "b" });
  assert.deepEqual(doc.contracts, []);
});

test("list filters by status and by kind; empty dir -> []", () => {
  const dir = tmpDir();
  const s = createDocumentStore(dir);
  assert.deepEqual(s.list(), []);
  s.write("DOC-001", { title: "a", status: "active", kind: "skill", body: "" });
  s.write("DOC-002", { title: "b", status: "draft", kind: "skill", body: "" });
  s.write("DOC-003", { title: "c", status: "active", kind: "methodology", body: "" });
  assert.equal(s.list({ status: "active" }).length, 2);
  assert.equal(s.list({ kind: "skill" }).length, 2);
  assert.equal(s.list({ status: "active", kind: "skill" }).length, 1);
});

test("a title/slug change keeps the same id file (no orphan)", () => {
  const dir = tmpDir();
  const s = createDocumentStore(dir);
  s.write("DOC-001", { title: "Original Title", status: "draft", kind: "skill", body: "b" });
  const filesBefore = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.equal(filesBefore.length, 1);
  s.write("DOC-001", { title: "Renamed Title", status: "active" });
  const filesAfter = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.equal(filesAfter.length, 1);
  assert.equal(filesAfter[0], filesBefore[0]);
  const doc = s.get("DOC-001");
  assert.equal(doc.title, "Renamed Title");
  assert.equal(doc.status, "active");
});

test("DOC-001 does not collide with DOC-0011 (dash-delimited id-prefix match, shared helper)", () => {
  const dir = tmpDir();
  const s = createDocumentStore(dir);
  s.write("DOC-001", { title: "one", status: "active", kind: "skill", body: "" });
  s.write("DOC-0011", { title: "eleven", status: "active", kind: "skill", body: "" });
  assert.equal(s.get("DOC-001").title, "one");
  assert.equal(s.get("DOC-0011").title, "eleven");
});
