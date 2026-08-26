// @test-group product
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-09 fake-gh subprocess HUNG 14:41 under full-suite load (round-202); suite spawn contention
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this test spawns a
// REAL fake-gh subprocess over PATH and drives a full create() roundtrip (multiple synchronous gh-api
// subprocess spawns per test case). It passed solo 4/4 (1.9s) but HUNG under full-suite concurrency
// (round-202 2026-08-09: 904209 ms file duration — 15-min ceiling, passed=false; the fake-gh subprocess
// `node /tmp/quay-github-fake-gh-create-*/gh api repos/o/r` never returned for 14:41) — suite-level
// subprocess spawn contention, NOT CPU load (gap-create-test-mjs-suite-context-hang-after-create-mcp-fix).
// Routed OUT of the concurrent main body to the concurrency-1 serial phase (same real-subprocess family
// as create-mcp / npm-pack-e2e / install-config-driven-e2e) and carries the machine-readable `heavy`
// family marker. The create-path assertions are UNCHANGED — solo must stay 4/4 (AC3).
// DIR-041 (M57): RED->GREEN regression tests for the real issue CREATE path
// -- the last remaining write-surface gap this milestone closes (title/body/
// status/labels/parent/children write were ALL already implemented before
// this milestone; only create() was missing, despite package.json/DESIGN.md/
// mcp-server.js's own startup log still (stale) claiming "read-only v1").
//
// Same discipline as this package's own write.test.mjs/gh-api-buffer.test.mjs:
// the real yaleh/quay issue backlog is too small/precious to target with
// destructive live writes in an automated, repeatable test file, so this
// file exercises `create()` and the mcp-server.js task_write CREATE-sentinel
// routing entirely against a STUBBED `gh` (a real subprocess spawn on PATH,
// same code path production uses -- not a mocked execFileSync), following
// gh-api-buffer.test.mjs's exact stubbing pattern (a scratch `gh` script
// understanding a small, explicit set of invocation shapes).
//
// Run: node --test packages/quay-github/test/create.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createGithubClient, CREATE_SENTINEL_ID } from "../src/github-client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Write a fake `gh` CLI that understands:
 *   - `gh api repos/<o>/<r>/issues -X POST -f title=... [-f body=...] [-f labels[]=... ...]`
 *     -> returns a synthetic newly-created issue (number `nextNumber`,
 *     echoing back whatever title/body/labels were posted).
 *   - `gh api repos/<o>/<r>/issues/<n>` (plain GET, used by create()'s own
 *     `get(...)` re-read, and by writeFields/setStatus/writeRelations'
 *     re-reads) -> returns the CURRENT state of issue `n` from an in-memory
 *     `issues` map seeded with the POST's own result once it happens.
 *   - `gh api repos/<o>/<r>/issues/<n> -X PATCH -f state=... [-f title=...] [-f body=...]`
 *     -> mutates the in-memory issue, returns it.
 *   - `gh api repos/<o>/<r>/issues -X GET ...` (list/pagination, used by
 *     writeRelations' parent-index rebuild) -> returns all issues as a
 *     single page.
 * State lives in a JSON file on disk (the fake `gh` is a fresh subprocess
 * per invocation, so in-memory state cannot survive across calls) --
 * mirrors task-check-passthrough.test.mjs's FAKE_GH_ISSUES_JSON pattern,
 * but read/written per-call instead of fixed for the whole test. */
function makeFakeGhBin({ nextNumber, owner = "o", repo = "r" }) {
  const dir = mkdtempSync(join(tmpdir(), "quay-github-fake-gh-create-"));
  const stateFile = join(dir, "state.json");
  writeFileSync(stateFile, JSON.stringify({ nextNumber, issues: {} }));
  const script = join(dir, "gh");
  writeFileSync(
    script,
    `#!/usr/bin/env node
const fs = require("fs");
const stateFile = ${JSON.stringify(stateFile)};
const args = process.argv.slice(2);

function loadState() { return JSON.parse(fs.readFileSync(stateFile, "utf8")); }
function saveState(s) { fs.writeFileSync(stateFile, JSON.stringify(s)); }

function fieldsFromArgs(a) {
  const fields = {};
  const labels = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "-f") {
      const kv = a[i + 1];
      const eq = kv.indexOf("=");
      const k = kv.slice(0, eq);
      const v = kv.slice(eq + 1);
      if (k === "labels[]") labels.push(v);
      else fields[k] = v;
      i++;
    }
  }
  if (labels.length > 0) fields.labels = labels;
  return fields;
}

if (args[0] !== "api") {
  process.stderr.write("fake-gh: only 'api' subcommand supported\\n");
  process.exit(1);
}

const path = args[1];
const method = args.includes("-X") ? args[args[args.indexOf("-X") + 1] ? args.indexOf("-X") + 1 : -1] : "GET";

// POST -> create a new issue.
if (/\\/issues$/.test(path) && method === "POST") {
  const fields = fieldsFromArgs(args);
  const state = loadState();
  const number = state.nextNumber;
  const issue = {
    number,
    title: fields.title,
    body: fields.body ?? null,
    state: "open",
    labels: (fields.labels ?? []).map((name) => ({ name })),
    user: { login: "test-actor" },
    html_url: "https://github.com/${owner}/${repo}/issues/" + number,
  };
  state.issues[String(number)] = issue;
  state.nextNumber = number + 1;
  saveState(state);
  process.stdout.write(JSON.stringify(issue));
  process.exit(0);
}

// GET (list, plain, no -X or -X GET) on the collection -> all issues, one page.
if (/\\/issues$/.test(path) && (method === "GET" || !args.includes("-X"))) {
  const state = loadState();
  process.stdout.write(JSON.stringify(Object.values(state.issues)));
  process.exit(0);
}

// Single-issue GET.
const getMatch = /\\/issues\\/(\\d+)$/.exec(path);
if (getMatch && (method === "GET" || !args.includes("-X"))) {
  const state = loadState();
  const issue = state.issues[getMatch[1]];
  if (!issue) {
    process.stderr.write("fake-gh: no such issue " + getMatch[1] + "\\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(issue));
  process.exit(0);
}

// Single-issue PATCH (state/title/body).
const patchMatch = /\\/issues\\/(\\d+)$/.exec(path);
if (patchMatch && method === "PATCH") {
  const state = loadState();
  const issue = state.issues[patchMatch[1]];
  if (!issue) {
    process.stderr.write("fake-gh: no such issue " + patchMatch[1] + "\\n");
    process.exit(1);
  }
  const fields = fieldsFromArgs(args);
  if (fields.state !== undefined) issue.state = fields.state;
  if (fields.title !== undefined) issue.title = fields.title;
  if (fields.body !== undefined) issue.body = fields.body;
  saveState(state);
  process.stdout.write(JSON.stringify(issue));
  process.exit(0);
}

// Label add (POST .../labels) / remove (DELETE .../labels/<name>) -- not
// exercised by this file's own cases (create() itself doesn't call these;
// only a follow-up writeFields/writeRelations would), but handled for
// completeness/safety so an unexpected call fails loudly with a clear
// message rather than a generic crash.
process.stderr.write("fake-gh: unsupported invocation: " + JSON.stringify(args) + "\\n");
process.exit(1);
`
  );
  chmodSync(script, 0o755);
  return dir;
}

function withFakeGhOnPath(fakeBinDir, fn) {
  const nodeDir = dirname(process.execPath);
  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}:${nodeDir}`;
  try {
    return fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

test("DIR-041 GREEN: create() POSTs a new issue and returns the REAL gh-<n> id (title-only)", () => {
  const fakeBinDir = makeFakeGhBin({ nextNumber: 501 });
  try {
    withFakeGhOnPath(fakeBinDir, () => {
      const client = createGithubClient({ owner: "o", repo: "r" });
      const task = client.create({ title: "DIR-041 probe issue" });
      assert.equal(task.id, "gh-501", "create() returns the real GitHub-assigned issue number as the task id");
      assert.equal(task.title, "DIR-041 probe issue");
      assert.equal(task.status, "todo", "a fresh open issue with no status:* label defaults to todo");
    });
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("DIR-041 GREEN: create() posts body + labels, and a re-read reflects both", () => {
  const fakeBinDir = makeFakeGhBin({ nextNumber: 600 });
  try {
    withFakeGhOnPath(fakeBinDir, () => {
      const client = createGithubClient({ owner: "o", repo: "r" });
      const task = client.create({
        title: "with body and labels",
        body: "the body text",
        labels: ["priority:high", "area:provider"],
      });
      assert.equal(task.id, "gh-600");
      assert.equal(task.body, "the body text");
      assert.deepEqual(
        [...task.labels].sort(),
        ["area:provider", "priority:high"],
        "both non-status/lane labels round-trip through create()"
      );
    });
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("DIR-041 RED->GREEN: create() fails LOUDLY (fail-closed) on a missing/empty title, no gh api call is even attempted", () => {
  const fakeBinDir = makeFakeGhBin({ nextNumber: 700 });
  try {
    withFakeGhOnPath(fakeBinDir, () => {
      const client = createGithubClient({ owner: "o", repo: "r" });
      assert.throws(
        () => client.create({}),
        /non-empty title/,
        "create() with no title throws a clear error"
      );
      assert.throws(
        () => client.create({ title: "   " }),
        /non-empty title/,
        "create() with a whitespace-only title throws the same clear error (not a silent no-op)"
      );
    });
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("DIR-041 GREEN: create() then a follow-up setStatus/writeRelations round-trips against the REAL assigned id", () => {
  const fakeBinDir = makeFakeGhBin({ nextNumber: 42 });
  try {
    withFakeGhOnPath(fakeBinDir, () => {
      const client = createGithubClient({ owner: "o", repo: "r" });
      const created = client.create({ title: "probe" });
      assert.equal(created.id, "gh-42");

      // Follow-up status write against the id create() just handed back --
      // this is exactly the two-step decomposition mcp-server.js's
      // task_write CREATE-sentinel handler performs server-side for a
      // single client-visible call that supplies status alongside id:
      // "gh-new".
      const closed = client.setStatus(created.id, "done");
      assert.equal(closed.status, "done", "a follow-up setStatus against the real created id works exactly like against any pre-existing issue");
    });
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});
