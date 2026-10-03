// @test-group product
// Stage 1 — native ADR store. ADRs are a SEPARATE kind from tasks: a decision
// lifecycle (proposed/accepted/superseded/deprecated/rejected), NOT todo→done;
// no parent/children/role; global ADR-NNN id. RED-first per ADR-001 (TDD).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAdrStore, VALID_ADR_STATUSES } from "../src/adr-store.ts";

// gap-tests-never-clean-up-their-tmpdirs: every tmpDir() created a per-run-unique dir that was never
// removed — /tmp (tmpfs) accumulated 3,590 `adr-store-*` dirs. The node:test file-level after() hook
// removes every created dir after the file's tests complete (it runs even on test failure, unlike a
// process.on('exit') hook which does not run on process.exit(1) in hand-rolled harnesses).
const _createdDirs = [];
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));
  _createdDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("VALID_ADR_STATUSES is the decision lifecycle (no 'done')", () => {
  assert.deepEqual(VALID_ADR_STATUSES, ["proposed", "accepted", "superseded", "deprecated", "rejected"]);
  assert.ok(!VALID_ADR_STATUSES.includes("done"));
});

test("write rejects an id not matching ^ADR-NNN", () => {
  const s = createAdrStore(tmpDir());
  assert.throws(() => s.write("ADR-1", { title: "x", status: "proposed" }), /invalid ADR id/);
  assert.throws(() => s.write("DEC-001", { title: "x", status: "proposed" }), /invalid ADR id/);
  assert.throws(() => s.write("../../etc/x", { title: "x", status: "proposed" }), /invalid ADR id/);
});

test("write rejects status:'done' and any non-ADR status", () => {
  const s = createAdrStore(tmpDir());
  assert.throws(() => s.write("ADR-001", { title: "x", status: "done" }), /invalid ADR status/);
  assert.throws(() => s.write("ADR-001", { title: "x", status: "todo" }), /invalid ADR status/);
});

test("write accepts each valid decision status and round-trips", () => {
  const dir = tmpDir();
  const s = createAdrStore(dir);
  for (const [i, status] of VALID_ADR_STATUSES.entries()) {
    const id = `ADR-0${10 + i}`;
    const adr = s.write(id, { title: `t ${status}`, status, body: "## Decision\nx" });
    assert.equal(adr.status, status);
    assert.equal(adr.id, id);
  }
});

test("get returns a decision view-model with NO parent/children/role (anti-conflation)", () => {
  const s = createAdrStore(tmpDir());
  s.write("ADR-001", {
    title: "TDD scope", status: "accepted", date: "2026-07-19",
    supersedes: [], supersededBy: [], tags: ["testing"],
    body: "## Context\nc\n## Decision\nd\n## Consequences\ne",
  });
  const adr = s.get("ADR-001");
  assert.equal(adr.title, "TDD scope");
  assert.equal(adr.status, "accepted");
  assert.equal(adr.date, "2026-07-19");
  assert.deepEqual(adr.tags, ["testing"]);
  assert.match(adr.body, /## Decision/);
  assert.ok(!("parent" in adr), "ADR must not have parent");
  assert.ok(!("children" in adr), "ADR must not have children");
  assert.ok(!("role" in adr), "ADR must not have role");
});

test("get returns null for a missing id", () => {
  assert.equal(createAdrStore(tmpDir()).get("ADR-999"), null);
});

test("supersedes / superseded-by / tags round-trip", () => {
  const s = createAdrStore(tmpDir());
  s.write("ADR-002", { title: "new", status: "accepted", supersedes: ["ADR-001"], body: "## Decision\nd" });
  s.write("ADR-001", { title: "old", status: "superseded", supersededBy: ["ADR-002"], body: "## Decision\nd" });
  assert.deepEqual(s.get("ADR-002").supersedes, ["ADR-001"]);
  assert.deepEqual(s.get("ADR-001").supersededBy, ["ADR-002"]);
});

test("list filters by status and by tag; empty dir → []", () => {
  const dir = tmpDir();
  const s = createAdrStore(dir);
  assert.deepEqual(s.list(), []);
  s.write("ADR-001", { title: "a", status: "accepted", tags: ["x"], body: "## Decision\nd" });
  s.write("ADR-002", { title: "b", status: "proposed", tags: ["y"], body: "## Decision\nd" });
  assert.equal(s.list().length, 2);
  assert.deepEqual(s.list({ status: "accepted" }).map((a) => a.id), ["ADR-001"]);
  assert.deepEqual(s.list({ tag: "y" }).map((a) => a.id), ["ADR-002"]);
});

test("reserved future fields (applies-to, enforcement) round-trip verbatim (forward-compat)", () => {
  const dir = tmpDir();
  const s = createAdrStore(dir);
  s.write("ADR-001", { title: "a", status: "accepted", body: "## Decision\nd" });
  // hand-write reserved fields into the file, then confirm a re-write preserves them
  const file = fs.readdirSync(dir).find((f) => f.startsWith("ADR-001"));
  const raw = fs.readFileSync(path.join(dir, file), "utf8");
  fs.writeFileSync(path.join(dir, file), raw.replace(/^---\n/, "---\napplies-to:\n  - 'packages/**'\nenforcement: adr-tdd\n"));
  s.write("ADR-001", { title: "a renamed", status: "accepted", body: "## Decision\nd2" });
  const raw2 = fs.readFileSync(path.join(dir, file), "utf8");
  assert.match(raw2, /applies-to/);
  assert.match(raw2, /enforcement: adr-tdd/);
  assert.match(raw2, /a renamed/);
});

test("a title/slug change keeps the same id file (no orphan)", () => {
  const dir = tmpDir();
  const s = createAdrStore(dir);
  s.write("ADR-001", { title: "First Title", status: "proposed", body: "## Decision\nd" });
  s.write("ADR-001", { title: "Second Title", status: "accepted", body: "## Decision\nd" });
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("ADR-001") && f.endsWith(".md"));
  assert.equal(files.length, 1, "exactly one file for ADR-001");
  assert.equal(s.get("ADR-001").title, "Second Title");
});

test("get()/list() surface appliesTo/enforcement from frontmatter (E3, view-model extension)", () => {
  const dir = tmpDir();
  const s = createAdrStore(dir);
  s.write("ADR-001", { title: "a", status: "accepted", body: "## Decision\nd" });
  const file = fs.readdirSync(dir).find((f) => f.startsWith("ADR-001"));
  const raw = fs.readFileSync(path.join(dir, file), "utf8");
  fs.writeFileSync(
    path.join(dir, file),
    raw.replace(
      /^---\n/,
      "---\napplies-to:\n  - 'packages/**'\nenforcement: 'echo ok'\n"
    )
  );
  const got = s.get("ADR-001");
  assert.deepEqual(got.appliesTo, ["packages/**"]);
  assert.equal(got.enforcement, "echo ok");
  assert.deepEqual(s.list()[0].appliesTo, ["packages/**"]);
});

test("get()/list() default appliesTo/enforcement safely when absent", () => {
  const dir = tmpDir();
  const s = createAdrStore(dir);
  s.write("ADR-001", { title: "a", status: "accepted", body: "## Decision\nd" });
  const got = s.get("ADR-001");
  assert.deepEqual(got.appliesTo, []);
  assert.equal(got.enforcement, undefined);
});

test("list({ appliesTo }) filters to ADRs whose applies-to glob-matches the given path", () => {
  const dir = tmpDir();
  const s = createAdrStore(dir);
  s.write("ADR-001", { title: "a", status: "accepted", body: "## Decision\nd" });
  s.write("ADR-002", { title: "b", status: "accepted", body: "## Decision\nd" });
  for (const [id, glob] of [["ADR-001", "experiments/quay-perpetual-stream/scripts/**"], ["ADR-002", "docs/**"]]) {
    const file = fs.readdirSync(dir).find((f) => f.startsWith(id));
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    fs.writeFileSync(path.join(dir, file), raw.replace(/^---\n/, `---\napplies-to:\n  - '${glob}'\n`));
  }
  const matched = s.list({ appliesTo: "experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.ts" });
  assert.deepEqual(matched.map((a) => a.id), ["ADR-001"]);
  const matchedDocs = s.list({ appliesTo: "docs/proposals/x.md" });
  assert.deepEqual(matchedDocs.map((a) => a.id), ["ADR-002"]);
  const matchedNone = s.list({ appliesTo: "packages/quay/src/gate/registry.js" });
  assert.deepEqual(matchedNone.map((a) => a.id), []);
});

// ── gap-store-list-all-or-nothing-unparseable-file-kills-whole-listing ──────────────────────────
// A carrier file whose NAME matches the collection predicate but whose CONTENT carries no
// frontmatter block must poison exactly its own row, never the whole listing. The real-world
// trigger (third-party workspace /data/home/yale/work/claudecodeui/adr/) is an ADR companion
// note `ADR-003-验证记录.md`: it starts with `ADR-` and ends with `.md` but is prose, so the
// old `readdirSync().map(裸调 parse)` threw and the ENTIRE ADR list came back as an error.
function writeRawAdr(dir, fileName, status = "proposed") {
  const id = fileName.slice(0, 7);
  fs.writeFileSync(
    path.join(dir, fileName),
    `---\nid: ${id}\ntitle: t-${id}\nstatus: ${status}\n---\n## Decision\nd\n`
  );
}

test("AC1: list() returns the remaining ADRs when one matched file has no frontmatter", () => {
  const dir = tmpDir();
  const s = createAdrStore(dir);
  writeRawAdr(dir, "ADR-001-a.md", "accepted");
  writeRawAdr(dir, "ADR-002-b.md", "proposed");
  writeRawAdr(dir, "ADR-003-c.md", "superseded");
  fs.writeFileSync(path.join(dir, "ADR-003-验证记录.md"), "# 验证记录\n\n不是该 ADR 的一部分。\n");
  const listed = s.list();
  assert.deepEqual(listed.map((a) => a.id), ["ADR-001", "ADR-002", "ADR-003"]);
  assert.deepEqual(listed.map((a) => a.status), ["accepted", "proposed", "superseded"]);
});

test("AC2: listWithMalformed() enumerates the bad file with the parser's own error", () => {
  const dir = tmpDir();
  const s = createAdrStore(dir);
  writeRawAdr(dir, "ADR-001-a.md");
  fs.writeFileSync(path.join(dir, "ADR-002-验证记录.md"), "# 验证记录\n\nprose, no frontmatter.\n");
  const { items, malformed } = s.listWithMalformed();
  assert.equal(items.length, 1);
  assert.deepEqual(malformed, [
    { file: "ADR-002-验证记录.md", error: "malformed ADR file: missing YAML frontmatter block" },
  ]);
});

test("AC3: bidirectional negative control — inject ⇒ N-1 good + 1 malformed; remove ⇒ N-1 good + 0", () => {
  const dir = tmpDir();
  const s = createAdrStore(dir);
  writeRawAdr(dir, "ADR-001-a.md", "accepted");
  writeRawAdr(dir, "ADR-002-b.md", "proposed");
  writeRawAdr(dir, "ADR-003-c.md", "proposed");
  const badPath = path.join(dir, "ADR-004-验证记录.md");
  fs.writeFileSync(badPath, "no frontmatter\n");

  const injected = s.listWithMalformed();
  assert.equal(injected.items.length, 3, "the 3 healthy ADRs survive");
  assert.equal(injected.malformed.length, 1, "exactly the injected file is reported");
  assert.equal(injected.malformed[0].file, "ADR-004-验证记录.md");
  assert.equal(s.list().length, 3, "list() agrees with the array view");

  fs.rmSync(badPath);
  const restored = s.listWithMalformed();
  assert.equal(restored.items.length, 3);
  assert.deepEqual(restored.malformed, [], "no failure entry once the bad file is gone");
  assert.equal(s.list().length, 3);
});

test("AC4: a real READ failure still throws — never an empty listing / all-malformed", () => {
  const dir = tmpDir();
  const s = createAdrStore(dir);
  writeRawAdr(dir, "ADR-001-a.md");
  // Carrier DIRECTORY gone: readdirSync is deliberately outside the try → throws.
  fs.rmSync(dir, { recursive: true, force: true });
  assert.throws(() => s.list(), /ENOENT/);
  assert.throws(() => s.listWithMalformed(), /ENOENT/);
});

test("AC4: an unreadable carrier FILE still throws (a read failure is not a parse failure)", () => {
  const dir = tmpDir();
  const s = createAdrStore(dir);
  writeRawAdr(dir, "ADR-001-a.md");
  const p = path.join(dir, "ADR-002-secret.md");
  fs.writeFileSync(p, "---\nid: ADR-002\ntitle: s\nstatus: proposed\n---\nb\n");
  fs.chmodSync(p, 0o000);
  try {
    assert.throws(() => s.list(), /EACCES/);
    assert.throws(() => s.listWithMalformed(), /EACCES/);
  } finally {
    fs.chmodSync(p, 0o600); // restore so the file-level after() cleanup can remove the dir
  }
});
