// @test-group product
// The meta store — META records, the FOURTH sibling kind (adr-store → document-store → goal-store
// → meta-store): a MESSAGE SENT TO the meta-driver whose ANSWER is embedded on the SAME record.
// Its own proposed→answered lifecycle, never todo→done / proposed→accepted / draft→active.
//
// This file is NEW with gap-store-list-all-or-nothing-unparseable-file-kills-whole-listing —
// `meta-store.test.mjs` did not exist (the other three sibling kinds each had one), so the
// per-store tolerance work for this kind had no test carrier at all until now.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMetaStore, VALID_META_STATUSES } from "../src/meta-store.ts";

// Every tmp dir is removed once at the end of this file (the carrier-array + after() pattern) — a
// mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _createdDirs = [];
function tmpDir(tag = "meta") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `meta-store-${tag}-`));
  _createdDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("VALID_META_STATUSES is the message lifecycle (no done/accepted/draft)", () => {
  assert.deepEqual(VALID_META_STATUSES, ["proposed", "answered"]);
  for (const other of ["done", "accepted", "draft", "active"]) {
    assert.ok(!VALID_META_STATUSES.includes(other), `meta status must not include ${other}`);
  }
});

test("write rejects an id not matching ^META-NNN", () => {
  const s = createMetaStore(tmpDir());
  assert.throws(() => s.write("META-1", { title: "x" }), /invalid meta id/);
  assert.throws(() => s.write("ADR-001", { title: "x" }), /invalid meta id/);
  assert.throws(() => s.write("../../etc/x", { title: "x" }), /invalid meta id/);
});

test("write rejects an invalid status", () => {
  const s = createMetaStore(tmpDir());
  assert.throws(() => s.write("META-001", { title: "x", status: "done" }), /invalid meta status/);
  assert.throws(() => s.write("META-001", { title: "x", status: "accepted" }), /invalid meta status/);
});

test("write round-trips title/status/handler/reply; handler defaults to meta-driver", () => {
  const s = createMetaStore(tmpDir());
  const rec = s.write("META-001", { title: "why is X?", body: "## Question\nq" });
  assert.equal(rec.id, "META-001");
  assert.equal(rec.status, "proposed");
  assert.equal(rec.handler, "meta-driver");
  assert.equal(rec.reply, null);
  const answered = s.write("META-001", { status: "answered", reply: "because Y" });
  assert.equal(answered.status, "answered");
  assert.equal(answered.reply, "because Y");
  const reread = s.get("META-001");
  assert.equal(reread.reply, "because Y");
});

test("get returns null for a missing id", () => {
  assert.equal(createMetaStore(tmpDir()).get("META-999"), null);
});

test("list filters by status; empty dir → []", () => {
  const dir = tmpDir();
  const s = createMetaStore(dir);
  assert.deepEqual(s.list(), []);
  s.write("META-001", { title: "a" });
  s.write("META-002", { title: "b" });
  s.write("META-002", { status: "answered", reply: "r" });
  assert.equal(s.list().length, 2);
  assert.deepEqual(s.list({ status: "proposed" }).map((m) => m.id), ["META-001"]);
  assert.deepEqual(s.list({ status: "answered" }).map((m) => m.id), ["META-002"]);
});

// ── gap-store-list-all-or-nothing-unparseable-file-kills-whole-listing ──────────────────────────
// A carrier file whose NAME matches the collection predicate (`META-*.md`) but whose CONTENT
// carries no frontmatter block used to take down the ENTIRE meta listing
// (readdirSync().map(裸调 parseFrontmatter)) — the meta-driver's inbound queue would go dark on
// one stray prose file.
function writeRawMeta(dir, fileName, status = "proposed") {
  const id = fileName.slice(0, 8);
  fs.writeFileSync(path.join(dir, fileName), `---\nid: ${id}\ntitle: t-${id}\nstatus: ${status}\n---\nbody\n`);
}

test("AC1: list() returns the remaining records when one matched file has no frontmatter", () => {
  const dir = tmpDir("malformed");
  const s = createMetaStore(dir);
  writeRawMeta(dir, "META-001-a.md", "proposed");
  writeRawMeta(dir, "META-002-b.md", "answered");
  fs.writeFileSync(path.join(dir, "META-003-notes.md"), "# notes\n\nprose, no frontmatter.\n");
  const listed = s.list();
  assert.deepEqual(listed.map((m) => m.id), ["META-001", "META-002"]);
  assert.deepEqual(listed.map((m) => m.status), ["proposed", "answered"]);
});

test("AC2: listWithMalformed() enumerates the bad file with the parser's own error", () => {
  const dir = tmpDir("malformed");
  const s = createMetaStore(dir);
  writeRawMeta(dir, "META-001-a.md");
  fs.writeFileSync(path.join(dir, "META-002-notes.md"), "# notes\n\nprose, no frontmatter.\n");
  const { items, malformed } = s.listWithMalformed();
  assert.equal(items.length, 1);
  assert.deepEqual(malformed, [
    { file: "META-002-notes.md", error: "malformed file: missing YAML frontmatter block" },
  ]);
});

test("AC3: bidirectional negative control — inject ⇒ N-1 good + 1 malformed; remove ⇒ N-1 good + 0", () => {
  const dir = tmpDir("malformed");
  const s = createMetaStore(dir);
  writeRawMeta(dir, "META-001-a.md");
  writeRawMeta(dir, "META-002-b.md");
  writeRawMeta(dir, "META-003-c.md");
  const badPath = path.join(dir, "META-004-notes.md");
  fs.writeFileSync(badPath, "no frontmatter\n");

  const injected = s.listWithMalformed();
  assert.equal(injected.items.length, 3);
  assert.equal(injected.malformed.length, 1);
  assert.equal(injected.malformed[0].file, "META-004-notes.md");
  assert.equal(s.list().length, 3);

  fs.rmSync(badPath);
  const restored = s.listWithMalformed();
  assert.equal(restored.items.length, 3);
  assert.deepEqual(restored.malformed, []);
});

test("AC4: a real READ failure still throws — never an empty listing / all-malformed", () => {
  const dir = tmpDir("malformed");
  const s = createMetaStore(dir);
  writeRawMeta(dir, "META-001-a.md");
  fs.rmSync(dir, { recursive: true, force: true });
  assert.throws(() => s.list(), /ENOENT/);
  assert.throws(() => s.listWithMalformed(), /ENOENT/);
});

test("AC4: an unreadable carrier FILE still throws (a read failure is not a parse failure)", () => {
  const dir = tmpDir("malformed");
  const s = createMetaStore(dir);
  writeRawMeta(dir, "META-001-a.md");
  const p = path.join(dir, "META-002-secret.md");
  fs.writeFileSync(p, "---\nid: META-002\ntitle: s\nstatus: proposed\n---\nb\n");
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
