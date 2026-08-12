// @test-group product
// Stage 1 (exp5-M-CRYST-D1) — shared frontmatter-store-base helper, factored
// out of adr-store.js so document-store.js can reuse the same
// parse/serialize/lock/filename-resolution logic without coupling the two
// object kinds' schemas together. RED-first per ADR-001 (TDD).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseFrontmatter,
  serializeFrontmatter,
  fileNameForId,
  withFileLock,
  slugify,
} from "../src/frontmatter-store-base.ts";

// Every tmp dir is removed once at the end of this file (the carrier-array + after() pattern) — a
// mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontmatter-store-base-"));
  _tmpDirs.push(dir);
  return dir;
}

test("parseFrontmatter extracts YAML frontmatter + body", () => {
  const raw = "---\nid: X-1\ntitle: hello\n---\n## Body\ncontent\n";
  const { frontmatter, body } = parseFrontmatter(raw);
  assert.equal(frontmatter.id, "X-1");
  assert.equal(frontmatter.title, "hello");
  assert.equal(body, "## Body\ncontent\n");
});

test("parseFrontmatter throws on malformed input (no frontmatter block)", () => {
  assert.throws(() => parseFrontmatter("no frontmatter here"), /missing YAML frontmatter block/);
});

test("serializeFrontmatter round-trips with parseFrontmatter", () => {
  const raw = serializeFrontmatter({ id: "X-1", title: "hello" }, "## Body\ncontent");
  const { frontmatter, body } = parseFrontmatter(raw);
  assert.equal(frontmatter.id, "X-1");
  assert.equal(body, "## Body\ncontent");
});

test("slugify lowercases, replaces non-alnum runs with '-', trims, caps length", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify(""), "adr");
  assert.equal(slugify(undefined), "adr");
  assert.equal(slugify("a".repeat(100)).length <= 60, true);
});

test("slugify accepts a custom fallback for the empty-title case", () => {
  assert.equal(slugify("", "doc"), "doc");
});

test("fileNameForId matches exact <id>.md or <id>-<slug>.md, not a longer id (dash delimiter)", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "X-001-my-title.md"), "x");
  fs.writeFileSync(path.join(dir, "X-0011-other.md"), "x");
  assert.equal(fileNameForId(dir, "X-001"), "X-001-my-title.md");
  // X-001 must NOT match the X-0011 file (dash-delimited prefix match only).
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  const found = files.find((f) => f === "X-001.md" || f.startsWith("X-001-"));
  assert.equal(found, "X-001-my-title.md");
});

test("fileNameForId returns null when no file matches", () => {
  const dir = tmpDir();
  assert.equal(fileNameForId(dir, "X-999"), null);
});

test("fileNameForId scopes its directory listing via the passed-in dir param (no hardcoded path)", () => {
  const dirA = tmpDir();
  const dirB = tmpDir();
  fs.writeFileSync(path.join(dirA, "X-001-a.md"), "x");
  fs.writeFileSync(path.join(dirB, "X-001-b.md"), "x");
  assert.equal(fileNameForId(dirA, "X-001"), "X-001-a.md");
  assert.equal(fileNameForId(dirB, "X-001"), "X-001-b.md");
});

test("withFileLock serializes access via a per-id lockfile inside the passed-in dir", () => {
  const dir = tmpDir();
  let ran = false;
  const result = withFileLock(dir, "X-001", () => {
    ran = true;
    // While inside the lock, the lockfile must exist.
    assert.equal(fs.existsSync(path.join(dir, "X-001.lock")), true);
    return 42;
  });
  assert.equal(ran, true);
  assert.equal(result, 42);
  // Lock released after the callback returns.
  assert.equal(fs.existsSync(path.join(dir, "X-001.lock")), false);
});

test("withFileLock releases the lock even if the callback throws", () => {
  const dir = tmpDir();
  assert.throws(() => withFileLock(dir, "X-001", () => { throw new Error("boom"); }), /boom/);
  assert.equal(fs.existsSync(path.join(dir, "X-001.lock")), false);
});

test("withFileLock recovers a stale lock (older than the stale threshold)", () => {
  const dir = tmpDir();
  const lockPath = path.join(dir, "X-001.lock");
  fs.writeFileSync(lockPath, "99999");
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, past, past);
  const result = withFileLock(dir, "X-001", () => 7);
  assert.equal(result, 7);
});
