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

// ── gap-store-list-all-or-nothing-unparseable-file-kills-whole-listing ──────────────────────────
// Same mechanism as the ADR sibling: a `DOC-*.md` file with no frontmatter block used to take
// down the ENTIRE document listing (readdirSync().map(裸调 parseFrontmatter)).
function writeRawDoc(dir, fileName, status = "active") {
  const id = fileName.slice(0, 7);
  fs.writeFileSync(path.join(dir, fileName), `---\nid: ${id}\ntitle: t-${id}\nstatus: ${status}\nkind: skill\n---\nbody\n`);
}

test("AC1: list() returns the remaining documents when one matched file has no frontmatter", () => {
  const dir = tmpDir();
  const s = createDocumentStore(dir);
  writeRawDoc(dir, "DOC-001-a.md");
  writeRawDoc(dir, "DOC-002-b.md", "draft");
  fs.writeFileSync(path.join(dir, "DOC-003-notes.md"), "# notes\n\nprose, no frontmatter.\n");
  const listed = s.list();
  assert.deepEqual(listed.map((d) => d.id), ["DOC-001", "DOC-002"]);
  assert.deepEqual(listed.map((d) => d.status), ["active", "draft"]);
});

test("AC2: listWithMalformed() enumerates the bad file with the parser's own error", () => {
  const dir = tmpDir();
  const s = createDocumentStore(dir);
  writeRawDoc(dir, "DOC-001-a.md");
  fs.writeFileSync(path.join(dir, "DOC-002-notes.md"), "# notes\n\nprose, no frontmatter.\n");
  const { items, malformed } = s.listWithMalformed();
  assert.equal(items.length, 1);
  assert.deepEqual(malformed, [
    { file: "DOC-002-notes.md", error: "malformed file: missing YAML frontmatter block" },
  ]);
});

test("AC3: bidirectional negative control — inject ⇒ N-1 good + 1 malformed; remove ⇒ N-1 good + 0", () => {
  const dir = tmpDir();
  const s = createDocumentStore(dir);
  writeRawDoc(dir, "DOC-001-a.md");
  writeRawDoc(dir, "DOC-002-b.md");
  writeRawDoc(dir, "DOC-003-c.md");
  const badPath = path.join(dir, "DOC-004-notes.md");
  fs.writeFileSync(badPath, "no frontmatter\n");

  const injected = s.listWithMalformed();
  assert.equal(injected.items.length, 3);
  assert.equal(injected.malformed.length, 1);
  assert.equal(injected.malformed[0].file, "DOC-004-notes.md");
  assert.equal(s.list().length, 3);

  fs.rmSync(badPath);
  const restored = s.listWithMalformed();
  assert.equal(restored.items.length, 3);
  assert.deepEqual(restored.malformed, []);
});

test("AC4: a real READ failure still throws — never an empty listing / all-malformed", () => {
  const dir = tmpDir();
  const s = createDocumentStore(dir);
  writeRawDoc(dir, "DOC-001-a.md");
  fs.rmSync(dir, { recursive: true, force: true });
  assert.throws(() => s.list(), /ENOENT/);
  assert.throws(() => s.listWithMalformed(), /ENOENT/);
});

test("AC4: an unreadable carrier FILE still throws (a read failure is not a parse failure)", () => {
  const dir = tmpDir();
  const s = createDocumentStore(dir);
  writeRawDoc(dir, "DOC-001-a.md");
  const p = path.join(dir, "DOC-002-secret.md");
  fs.writeFileSync(p, "---\nid: DOC-002\ntitle: s\nstatus: active\nkind: skill\n---\nb\n");
  fs.chmodSync(p, 0o000);
  // ⛔ `chmod 000` is NOT a portable way to construct "unreadable". The CI runner runs the suite
  // as uid 0 (measured `uid=0`; gap-develop-ci-red-node20-floor-and-static-not-evaluated) and
  // CAP_DAC_OVERRIDE ignores the mode bits — the read then SUCCEEDS, `assert.throws(/EACCES/)`
  // finds no exception ("Missing expected exception"), and this test red-ed CI deterministically
  // on all four sibling stores while passing on every developer checkout.
  // Rather than SKIP the arm (which would leave the contract unexercised exactly where CI needs
  // it), fall back to an inducement uid 0 cannot bypass: a DIRECTORY at the same path makes
  // `readFileSync` throw EISDIR. The listing filter is name-based (`endsWith(".md")`), so the
  // directory still reaches `readFileSync` — what the assertion pins either way is that a READ
  // failure throws rather than being collected as a malformed entry (硬规则 3b).
  let unreadable = false;
  try { fs.accessSync(p, fs.constants.R_OK); } catch { unreadable = true; }
  if (!unreadable) {
    fs.rmSync(p, { force: true });
    fs.mkdirSync(p);
  }
  try {
    assert.throws(() => s.list(), /EACCES|EISDIR/);
    assert.throws(() => s.listWithMalformed(), /EACCES|EISDIR/);
  } finally {
    // unlink needs write on the DIRECTORY, not on the file, so the 0o000 mode does not block
    // this; `recursive` covers the directory arm.
    fs.rmSync(p, { recursive: true, force: true });
  }
});
