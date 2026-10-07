// @test-group product
// gap-quay-native-adr-cli-looser-bypass-of-core-validation — `quay-native adr` was a second,
// LOOSER, un-declared entrance to the same ADR store Core's `quay adr` writes (it calls
// createAdrStore() in-process, skipping the MCP adr_write validation layer). These tests pin
// the resolution:
//   AC1  `adr --help` DECLARES the bypass and steers normal use to `quay adr`
//   AC2  `new`/`edit` carry the title-required guard Core's cli/adr.ts enforces
//   AC3  the decision-lifecycle verbs (accept/deprecate/reject/supersede) are mirrored
//   AC4  the existing CLI surface keeps working (no regression)
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

// Every adr dir is removed once at the end of this file (carrier-array + after() pattern) —
// a mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpAdrDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-adr-cli-${tag}-`));
  _tmpDirs.push(dir);
  return dir;
}

function runNative(args, adrDir) {
  try {
    const out = execFileSync("node", [nativeBin, ...args], {
      encoding: "utf8",
      env: { ...process.env, QUAY_NATIVE_ADR_DIR: adrDir },
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

function listIds(adrDir) {
  const l = runNative(["adr", "list", "--json"], adrDir);
  assert.equal(l.status, 0, l.stderr);
  return JSON.parse(l.stdout).map((a) => a.id);
}

// ── AC1: the help text declares the bypass ────────────────────────────────────
test("adr --help exits 0 and declares this CLI bypasses Core, steering to `quay adr`", () => {
  const dir = tmpAdrDir("help");
  const h = runNative(["adr", "--help"], dir);
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /BYPASS/i, "must name the bypass channel");
  assert.match(h.stdout, /quay adr/, "must steer normal use to Core's `quay adr`");
  assert.equal(h.stderr, "", "help goes to stdout, not stderr");
});

test("bare `adr` (no subcommand) prints the same help, exit 0", () => {
  const dir = tmpAdrDir("barehelp");
  const h = runNative(["adr"], dir);
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /BYPASS/i);
});

// ── AC2: title-required guard on new/edit ─────────────────────────────────────
test("adr new without --title fails closed (exit 1) and writes nothing", () => {
  const dir = tmpAdrDir("new-notitle");
  const r = runNative(["adr", "new", "ADR-001"], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--title/);
  assert.deepEqual(listIds(dir), [], "no ADR written on a refused create");
});

test("adr new with an empty --title fails closed (exit 1)", () => {
  const dir = tmpAdrDir("new-emptytitle");
  const r = runNative(["adr", "new", "ADR-001", "--title", ""], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--title/);
  assert.deepEqual(listIds(dir), []);
});

test("adr new with --title succeeds and round-trips (no regression)", () => {
  const dir = tmpAdrDir("new-ok");
  const w = runNative(["adr", "new", "ADR-001", "--title", "TDD scope", "--body", "## Decision\nd"], dir);
  assert.equal(w.status, 0, w.stderr);
  const g = runNative(["adr", "get", "ADR-001", "--json"], dir);
  assert.equal(g.status, 0);
  const adr = JSON.parse(g.stdout);
  assert.equal(adr.title, "TDD scope");
  assert.equal(adr.status, "proposed");
});

test("adr edit of an existing ADR without --title keeps the existing title", () => {
  const dir = tmpAdrDir("edit-keep");
  runNative(["adr", "new", "ADR-001", "--title", "keep me", "--body", "b"], dir);
  const e = runNative(["adr", "edit", "ADR-001", "--status", "accepted"], dir);
  assert.equal(e.status, 0, e.stderr);
  const adr = JSON.parse(runNative(["adr", "get", "ADR-001", "--json"], dir).stdout);
  assert.equal(adr.title, "keep me");
  assert.equal(adr.status, "accepted");
});

test("adr edit of a non-existent id without --title fails closed (no create-through-edit)", () => {
  const dir = tmpAdrDir("edit-create");
  const e = runNative(["adr", "edit", "ADR-404", "--body", "b"], dir);
  assert.equal(e.status, 1);
  assert.match(e.stderr, /--title/);
  assert.deepEqual(listIds(dir), [], "edit must not create a titleless ADR");
});

test("adr new/edit require an <id>", () => {
  const dir = tmpAdrDir("no-id");
  assert.equal(runNative(["adr", "new", "--title", "x"], dir).status, 1);
  assert.equal(runNative(["adr", "edit", "--title", "x"], dir).status, 1);
});

// ── AC3: the decision-lifecycle verbs ─────────────────────────────────────────
test("adr accept/deprecate/reject flip status like Core", () => {
  const dir = tmpAdrDir("verbs");
  runNative(["adr", "new", "ADR-001", "--title", "a", "--body", "b"], dir);
  runNative(["adr", "new", "ADR-002", "--title", "b", "--body", "b"], dir);
  runNative(["adr", "new", "ADR-003", "--title", "c", "--body", "b"], dir);
  assert.equal(runNative(["adr", "accept", "ADR-001"], dir).status, 0);
  assert.equal(runNative(["adr", "deprecate", "ADR-002"], dir).status, 0);
  assert.equal(runNative(["adr", "reject", "ADR-003"], dir).status, 0);
  assert.equal(JSON.parse(runNative(["adr", "get", "ADR-001", "--json"], dir).stdout).status, "accepted");
  assert.equal(JSON.parse(runNative(["adr", "get", "ADR-002", "--json"], dir).stdout).status, "deprecated");
  assert.equal(JSON.parse(runNative(["adr", "get", "ADR-003", "--json"], dir).stdout).status, "rejected");
});

test("adr supersede links BOTH records", () => {
  const dir = tmpAdrDir("supersede");
  runNative(["adr", "new", "ADR-001", "--title", "old", "--body", "b"], dir);
  runNative(["adr", "new", "ADR-002", "--title", "new", "--body", "b"], dir);
  const s = runNative(["adr", "supersede", "ADR-001", "--by", "ADR-002"], dir);
  assert.equal(s.status, 0, s.stderr);
  const old = JSON.parse(runNative(["adr", "get", "ADR-001", "--json"], dir).stdout);
  const next = JSON.parse(runNative(["adr", "get", "ADR-002", "--json"], dir).stdout);
  assert.equal(old.status, "superseded");
  assert.deepEqual(old.supersededBy, ["ADR-002"]);
  assert.deepEqual(next.supersedes, ["ADR-001"]);
});

test("adr supersede without --by fails closed", () => {
  const dir = tmpAdrDir("supersede-noby");
  runNative(["adr", "new", "ADR-001", "--title", "a", "--body", "b"], dir);
  assert.equal(runNative(["adr", "supersede", "ADR-001"], dir).status, 1);
});

// ── AC4: the raw `write` primitive stays, and the surface declares itself ─────
test("adr write stays the raw store primitive (no title guard — declared in --help)", () => {
  const dir = tmpAdrDir("raw-write");
  const w = runNative(["adr", "write", "ADR-050", "--body", "raw body"], dir);
  assert.equal(w.status, 0, w.stderr);
  const g = JSON.parse(runNative(["adr", "get", "ADR-050", "--json"], dir).stdout);
  assert.equal(g.status, "proposed");
});

test("unknown adr subcommand exits 1 and names the real verbs", () => {
  const dir = tmpAdrDir("unknown");
  const r = runNative(["adr", "frobnicate"], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /accept/);
  assert.match(r.stderr, /supersede/);
});
