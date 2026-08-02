// @test-group product
// Stage 1 — native ADR store. ADRs are a SEPARATE kind from tasks: a decision
// lifecycle (proposed/accepted/superseded/deprecated/rejected), NOT todo→done;
// no parent/children/role; global ADR-NNN id. RED-first per ADR-001 (TDD).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAdrStore, VALID_ADR_STATUSES } from "../src/adr-store.ts";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));
}

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
