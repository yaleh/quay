// @test-group engine
// Unit tests for gate-script-base.ts — shared framework primitives for TypeScript gate scripts.
// Written RED-first per ADR-001 fixture-first discipline: this test file covers all exported
// functions from the load-bearing gate-script-base.ts utility module (created M151/M152).
// Run:
//   node --test experiments/quay-perpetual-stream/test/gate-script-base.test.mjs
//   node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/gate-script-base.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseArgs,
  readFrontmatter,
  emitPass,
  emitFail,
  requireArg,
  isDirectEntry,
} from "../scripts/gate-script-base.ts";

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gate-script-base-${label}-`));
}

function captureStdout(fn) {
  const orig = process.stdout.write;
  const chunks = [];
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join("");
}

function captureStderr(fn) {
  const orig = process.stderr.write;
  const chunks = [];
  process.stderr.write = (chunk) => { chunks.push(chunk); return true; };
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return chunks.join("");
}

// ── parseArgs ────────────────────────────────────────────────────────────────────────────────────

test("parseArgs: basic positional args with no flags", () => {
  const r = parseArgs(["node", "script", "file1.md", "file2.md"], { usage: "<files>" });
  assert.deepEqual(r.args, ["file1.md", "file2.md"]);
  assert.deepEqual(r.flags, {});
});

test("parseArgs: single positional arg (default minArgs=1)", () => {
  const r = parseArgs(["node", "script", "single.md"], { usage: "<file>" });
  assert.deepEqual(r.args, ["single.md"]);
  assert.deepEqual(r.flags, {});
});

test("parseArgs: string flag with space-separated value", () => {
  const r = parseArgs(["node", "script", "--name", "myvalue", "file.md"], {
    usage: "<file>",
    flags: { name: { type: "string" } },
  });
  assert.equal(r.flags.name, "myvalue");
  assert.deepEqual(r.args, ["file.md"]);
});

test("parseArgs: string flag with = syntax", () => {
  const r = parseArgs(["node", "script", "--name=myvalue", "file.md"], {
    usage: "<file>",
    flags: { name: { type: "string" } },
  });
  assert.equal(r.flags.name, "myvalue");
  assert.deepEqual(r.args, ["file.md"]);
});

test("parseArgs: boolean flag is true when present", () => {
  const r = parseArgs(["node", "script", "--verbose", "file.md"], {
    usage: "<file>",
    flags: { verbose: { type: "boolean" } },
  });
  assert.equal(r.flags.verbose, true);
  assert.deepEqual(r.args, ["file.md"]);
});

test("parseArgs: multiple flags of mixed types", () => {
  const r = parseArgs(
    ["node", "script", "--name", "x", "--verbose", "--dir=/tmp", "file.md"],
    {
      usage: "<file>",
      flags: {
        name: { type: "string" },
        verbose: { type: "boolean" },
        dir: { type: "string" },
      },
    },
  );
  assert.equal(r.flags.name, "x");
  assert.equal(r.flags.verbose, true);
  assert.equal(r.flags.dir, "/tmp");
  assert.deepEqual(r.args, ["file.md"]);
});

test("parseArgs: flag value defaults to empty string when no value follows", () => {
  const r = parseArgs(["node", "script", "file.md", "--name"], {
    usage: "<file>",
    flags: { name: { type: "string" } },
  });
  assert.equal(r.flags.name, ""); // --name is last, no value after it
  assert.deepEqual(r.args, ["file.md"]);
});

test("parseArgs: unrecognized flag with no def still stored as string", () => {
  const r = parseArgs(["node", "script", "--unknown=stuff", "file.md"], {
    usage: "<file>",
    flags: {},
  });
  assert.equal(r.flags.unknown, "stuff");
  assert.deepEqual(r.args, ["file.md"]);
});

test("parseArgs: repeated flag — last one wins", () => {
  const r = parseArgs(["node", "script", "--name", "a", "--name=b", "file.md"], {
    usage: "<file>",
    flags: { name: { type: "string" } },
  });
  assert.equal(r.flags.name, "b");
});

test("parseArgs: missing boolean flag defaults to undefined (not in flags object)", () => {
  const r = parseArgs(["node", "script", "file.md"], {
    usage: "<file>",
    flags: { verbose: { type: "boolean" } },
  });
  assert.ok(!("verbose" in r.flags));
  assert.deepEqual(r.args, ["file.md"]);
});

test("parseArgs: insufficient positional args exits with code 2 (default minArgs=1)", () => {
  const origExit = process.exit;
  let exitCode = null;
  const origStderr = process.stderr.write;
  process.stderr.write = () => true;
  process.exit = (c) => { exitCode = c; throw new Error("exit"); };
  try {
    parseArgs(["node", "script"], { usage: "<file>" });
    assert.fail("should have thrown from exit mock");
  } catch (e) {
    if (e.message !== "exit") throw e;
  } finally {
    process.exit = origExit;
    process.stderr.write = origStderr;
  }
  assert.equal(exitCode, 2);
});

test("parseArgs: custom minArgs: 0 positional args allowed", () => {
  const r = parseArgs(["node", "script"], { usage: "[files]", minArgs: 0 });
  assert.deepEqual(r.args, []);
  assert.deepEqual(r.flags, {});
});

test("parseArgs: custom minArgs > 1 with enough args passes", () => {
  const r = parseArgs(["node", "script", "a", "b", "c"], { usage: "<files>", minArgs: 3 });
  assert.deepEqual(r.args, ["a", "b", "c"]);
});

test("parseArgs: custom minArgs > 1 with insufficient args exits 2", () => {
  const origExit = process.exit;
  let exitCode = null;
  const origStderr = process.stderr.write;
  process.stderr.write = () => true;
  process.exit = (c) => { exitCode = c; throw new Error("exit"); };
  try {
    parseArgs(["node", "script", "a"], { usage: "<a> <b>", minArgs: 2 });
    assert.fail("should have thrown");
  } catch (e) {
    if (e.message !== "exit") throw e;
  } finally {
    process.exit = origExit;
    process.stderr.write = origStderr;
  }
  assert.equal(exitCode, 2);
});

// ── readFrontmatter ─────────────────────────────────────────────────────────────────────────────

test("readFrontmatter: parses scalar frontmatter fields", () => {
  const d = tmpDir("fm-scalar");
  const file = path.join(d, "task.md");
  fs.writeFileSync(file, "---\nid: T1\ntitle: My Title\nstatus: todo\n---\nbody text");
  const fm = readFrontmatter(file);
  assert.equal(fm.id, "T1");
  assert.equal(fm.title, "My Title");
  assert.equal(fm.status, "todo");
  fs.rmSync(d, { recursive: true });
});

test("readFrontmatter: parses list values (bracket style)", () => {
  const d = tmpDir("fm-list");
  const file = path.join(d, "task.md");
  fs.writeFileSync(file, "---\nlabels: [bug, ux, priority]\n---\nbody");
  const fm = readFrontmatter(file);
  assert.deepEqual(fm.labels, ["bug", "ux", "priority"]);
  fs.rmSync(d, { recursive: true });
});

test("readFrontmatter: parses empty list [] as empty array", () => {
  const d = tmpDir("fm-empty-list");
  const file = path.join(d, "task.md");
  fs.writeFileSync(file, "---\nlabels: []\n---\nbody");
  const fm = readFrontmatter(file);
  assert.deepEqual(fm.labels, []);
  fs.rmSync(d, { recursive: true });
});

test("readFrontmatter: parses null value as null", () => {
  const d = tmpDir("fm-null");
  const file = path.join(d, "task.md");
  fs.writeFileSync(file, "---\nparent: null\n---\nbody");
  const fm = readFrontmatter(file);
  assert.equal(fm.parent, null);
  fs.rmSync(d, { recursive: true });
});

test("readFrontmatter: parses empty value as empty string", () => {
  const d = tmpDir("fm-empty");
  const file = path.join(d, "task.md");
  fs.writeFileSync(file, "---\ntitle:\n---\nbody");
  const fm = readFrontmatter(file);
  assert.equal(fm.title, "");
  fs.rmSync(d, { recursive: true });
});

test("readFrontmatter: returns null for file with no frontmatter", () => {
  const d = tmpDir("fm-none");
  const file = path.join(d, "note.md");
  fs.writeFileSync(file, "# Just a heading\n\nbody text here");
  const fm = readFrontmatter(file);
  assert.equal(fm, null);
  fs.rmSync(d, { recursive: true });
});

test("readFrontmatter: skips comment lines (starting with #)", () => {
  const d = tmpDir("fm-comment");
  const file = path.join(d, "task.md");
  fs.writeFileSync(file, "---\n# this is a comment\nid: T1\n# another comment\nstatus: todo\n---\nbody");
  const fm = readFrontmatter(file);
  assert.equal(fm.id, "T1");
  assert.equal(fm.status, "todo");
  assert.ok(!("this is a comment" in fm));
  assert.ok(!("#" in fm));
  fs.rmSync(d, { recursive: true });
});

test("readFrontmatter: skips blank lines in frontmatter", () => {
  const d = tmpDir("fm-blank");
  const file = path.join(d, "task.md");
  fs.writeFileSync(file, "---\n\nid: T1\n\nstatus: todo\n---\nbody");
  const fm = readFrontmatter(file);
  assert.equal(fm.id, "T1");
  assert.equal(fm.status, "todo");
  fs.rmSync(d, { recursive: true });
});

test("readFrontmatter: handles CRLF line endings", () => {
  const d = tmpDir("fm-crlf");
  const file = path.join(d, "task.md");
  fs.writeFileSync(file, "---\r\nid: T1\r\nstatus: todo\r\n---\r\nbody");
  const fm = readFrontmatter(file);
  assert.equal(fm.id, "T1");
  assert.equal(fm.status, "todo");
  fs.rmSync(d, { recursive: true });
});

test("readFrontmatter: missing file returns null (ENOENT during scan = race, not a crash)", () => {
  assert.equal(readFrontmatter("/nonexistent/path/task.md"), null);
});

test("readFrontmatter: non-ENOENT read errors still throw", () => {
  assert.throws(() => readFrontmatter("/"));
});

test("readFrontmatter: list values strip surrounding quotes", () => {
  const d = tmpDir("fm-quotes");
  const file = path.join(d, "task.md");
  fs.writeFileSync(file, "---\nlabels: ['dir', \"milestone\"]\n---\nbody");
  const fm = readFrontmatter(file);
  assert.deepEqual(fm.labels, ["dir", "milestone"]);
  fs.rmSync(d, { recursive: true });
});

// ── emitPass ─────────────────────────────────────────────────────────────────────────────────────

test("emitPass: outputs 'PASS: <message>' to stdout", () => {
  const out = captureStdout(() => emitPass("all checks green"));
  assert.equal(out.trim(), "PASS: all checks green");
});

test("emitPass: handles empty message", () => {
  const out = captureStdout(() => emitPass(""));
  assert.match(out, /^PASS:\s*$/m);
});

// ── emitFail ─────────────────────────────────────────────────────────────────────────────────────

test("emitFail: outputs 'FAIL: <message>' to stdout", () => {
  const out = captureStdout(() => emitFail("test failed"));
  assert.equal(out.trim(), "FAIL: test failed");
});

test("emitFail: handles empty message", () => {
  const out = captureStdout(() => emitFail(""));
  assert.match(out, /^FAIL:\s*$/m);
});

// ── requireArg ───────────────────────────────────────────────────────────────────────────────────

test("requireArg: does not exit for non-empty string", () => {
  // should not throw or exit
  requireArg("hello", "name");
  assert.ok(true);
});

test("requireArg: does not exit for number value", () => {
  requireArg(42, "count");
  assert.ok(true);
});

test("requireArg: does not exit for object value", () => {
  requireArg({ key: "val" }, "config");
  assert.ok(true);
});

test("requireArg: exits 2 for undefined value", () => {
  const origExit = process.exit;
  let exitCode = null;
  const origStderr = process.stderr.write;
  process.stderr.write = () => true;
  process.exit = (c) => { exitCode = c; throw new Error("exit"); };
  try {
    requireArg(undefined, "filename");
    assert.fail("should have thrown");
  } catch (e) {
    if (e.message !== "exit") throw e;
  } finally {
    process.exit = origExit;
    process.stderr.write = origStderr;
  }
  assert.equal(exitCode, 2);
});

test("requireArg: exits 2 for null value", () => {
  const origExit = process.exit;
  let exitCode = null;
  const origStderr = process.stderr.write;
  process.stderr.write = () => true;
  process.exit = (c) => { exitCode = c; throw new Error("exit"); };
  try {
    requireArg(null, "config");
    assert.fail("should have thrown");
  } catch (e) {
    if (e.message !== "exit") throw e;
  } finally {
    process.exit = origExit;
    process.stderr.write = origStderr;
  }
  assert.equal(exitCode, 2);
});

test("requireArg: exits 2 for empty string", () => {
  const origExit = process.exit;
  let exitCode = null;
  const origStderr = process.stderr.write;
  process.stderr.write = () => true;
  process.exit = (c) => { exitCode = c; throw new Error("exit"); };
  try {
    requireArg("", "filename");
    assert.fail("should have thrown");
  } catch (e) {
    if (e.message !== "exit") throw e;
  } finally {
    process.exit = origExit;
    process.stderr.write = origStderr;
  }
  assert.equal(exitCode, 2);
});

test("requireArg: exits 2 for 0 (falsy number)", () => {
  // 0 is NOT undefined/null/empty — should NOT exit
  requireArg(0, "count");
  assert.ok(true);
});

test("requireArg: exits 2 for false (falsy boolean)", () => {
  // false is NOT undefined/null/empty — should NOT exit
  requireArg(false, "flag");
  assert.ok(true);
});

// ── isDirectEntry ────────────────────────────────────────────────────────────────────────────────

// The identity is NAME-based, never URL-based (gap-drivers-yml-interval-not-honored-for-routine-kinds):
// under bundling every inlined module shares ONE `import.meta.url`, so a URL/file-identity guard is
// true for every inlined library at once and the first one in bundle order wins — measured on the
// shipped plugin/scripts/dist bundles, where the three routine drivers all ran pool-quality-judge's
// main instead of their own. `expectedBase` is therefore REQUIRED and `importMeta` is ignored.

const THIS_BASE = path.basename(fileURLToPath(import.meta.url)).replace(/\.(?:js|ts|mjs)$/, "");

test("isDirectEntry: returns true when argv1's basename matches expectedBase", () => {
  // When running as test, this file is process.argv[1], so the named form must match it.
  const entry = isDirectEntry(import.meta, undefined, THIS_BASE);
  assert.equal(entry, true, `expected isDirectEntry to return true for the test file; got ${entry}`);
});

test("isDirectEntry: returns false when argv1's basename does not match expectedBase", () => {
  const fakeImportMeta = { url: "file:///some/other/script.ts" };
  const entry = isDirectEntry(fakeImportMeta, "/actual/entry/point.mjs", "some-other-tool");
  assert.equal(entry, false);
});

test("isDirectEntry: returns false when argv1 is empty and process.argv[1] does not match", () => {
  const fakeImportMeta = { url: "file:///some/script.ts" };
  const entry = isDirectEntry(fakeImportMeta, "", "definitely-not-the-running-entry");
  assert.equal(entry, false);
});

test("isDirectEntry: resolves both relative and absolute argv1 by basename", () => {
  // The check is basename-based, so a relative argv1 and its absolute form resolve identically —
  // and no filesystem stat is involved (the retired URL form needed fs.realpathSync and threw ENOENT
  // for a path not on disk; the name form has no such dependency).
  const realFile = fileURLToPath(import.meta.url);
  const fakeImportMeta = { url: pathToFileURL(realFile).href };
  const base = path.basename(realFile).replace(/\.(?:js|ts|mjs)$/, "");
  assert.equal(isDirectEntry(fakeImportMeta, realFile, base), true);
  assert.equal(isDirectEntry(fakeImportMeta, path.relative(process.cwd(), realFile), base), true);
  assert.equal(isDirectEntry(fakeImportMeta, "/nonexistent/on/disk/nowhere.ts", "nowhere"), true);
});

test("isDirectEntry: importMeta.url is NOT consulted (the bundling-hijack invariant)", () => {
  // This is the regression guard for the defect itself: a mismatching — or entirely absent — URL
  // must NOT change the verdict, because under bundling every inlined module carries the SAME URL.
  // A URL-sensitive implementation here would re-open the hijack window.
  const matching = "some-tool";
  assert.equal(isDirectEntry({ url: "file:///totally/different/place.ts" }, "/a/b/some-tool.js", matching), true);
  assert.equal(isDirectEntry(undefined, "/a/b/some-tool.js", matching), true);
  // ...and the converse: a matching URL with a non-matching basename is still false.
  assert.equal(isDirectEntry({ url: pathToFileURL(fileURLToPath(import.meta.url)).href }, "/a/b/other.ts", matching), false);
});
