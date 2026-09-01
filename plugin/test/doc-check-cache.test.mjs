// @test-group engine
// doc-check-cache.test.mjs — the docs-face cache-key + green-verdict cache roundtrip
// (gap-fan-in-doc-check-cache). Pure-function tests over a real temp git repo, no spawn/concurrency.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { makeGitRoot, makeRoot, runGit } from "./helpers/worker-driver-harness.mjs";
import {
  computeDocCheckFaceKey,
  readDocCheckCache,
  writeDocCheckCache,
} from "../scripts/doc-check-cache.ts";

// A minimal-but-parseable scripts/test.sh fixture: run_doc_checks() with the # @static-object
// annotations docClassPatterns (precommit-guard) parses — the SINGLE source the cache key reuses.
function writeFixture(root) {
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "test.sh"), [
    "#!/usr/bin/env bash",
    "run_doc_checks() {",
    "  # @static-object orchestration/ docs/proposals/",
    '  echo "strategic-doc-staleness-check"',
    "  # @static-object plugin/loop/ CLAUDE.md",
    '  echo "drive-contract-check"',
    "}",
    "",
  ].join("\n"));
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "scripts", "strategic-doc-staleness-check.ts"), "// checker\n");
  fs.writeFileSync(path.join(root, "plugin", "scripts", "runner-static-gate.ts"), "// harness\n");
  fs.mkdirSync(path.join(root, "orchestration"), { recursive: true });
  fs.writeFileSync(path.join(root, "orchestration", "manager-tick-core.md"), "# core\n");
  fs.mkdirSync(path.join(root, "plugin", "loop"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "loop", "fast-mode-loop-tick.md"), "# loop\n");
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "# claude\n");
  fs.mkdirSync(path.join(root, "packages"), { recursive: true });
  fs.writeFileSync(path.join(root, "packages", "foo.ts"), "export const x = 1;\n");
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-q", "-m", "fixture"]);
}

test("computeDocCheckFaceKey — idempotent; doc content edit invalidates (AC2 失效重跑)", (t) => {
  const root = makeGitRoot("dcc-key");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFixture(root);

  const k1 = computeDocCheckFaceKey(root);
  assert.equal(typeof k1, "string", "a git repo with a docs face yields a key");
  assert.equal(computeDocCheckFaceKey(root), k1, "same tree ⇒ same key (idempotent)");

  fs.writeFileSync(path.join(root, "orchestration", "manager-tick-core.md"), "# core CHANGED\n");
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-q", "-m", "doc content change"]);
  assert.notEqual(computeDocCheckFaceKey(root), k1, "doc content edit invalidates the key");
});

test("computeDocCheckFaceKey — non-doc CONTENT edit leaves the key unchanged (AC3 非 doc 不重跑)", (t) => {
  const root = makeGitRoot("dcc-nondoc");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFixture(root);

  const k1 = computeDocCheckFaceKey(root);
  fs.writeFileSync(path.join(root, "packages", "foo.ts"), "export const x = 2;\n");
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-q", "-m", "non-doc content change"]);
  assert.equal(computeDocCheckFaceKey(root), k1, "non-doc content edit does NOT invalidate");
});

test("computeDocCheckFaceKey — non-doc ADD (structure) invalidates (AC3 反之/无假命中)", (t) => {
  const root = makeGitRoot("dcc-struct");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFixture(root);

  const k1 = computeDocCheckFaceKey(root);
  fs.writeFileSync(path.join(root, "packages", "bar.ts"), "export const y = 2;\n");
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-q", "-m", "non-doc add (structure)"]);
  assert.notEqual(computeDocCheckFaceKey(root), k1, "basename/stem add ANYWHERE invalidates (stale-path layer)");
});

test("computeDocCheckFaceKey — non-git root ⇒ null (fail-closed, never a hit)", (t) => {
  const root = makeRoot("dcc-nogit");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(computeDocCheckFaceKey(root), null, "git failure ⇒ null ⇒ no cache read/write");
});

test("read/write cache — green roundtrip, wrong-key/corrupt/not-green ⇒ miss (⛔ never a false hit)", (t) => {
  const root = makeRoot("dcc-cache");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cacheFile = path.join(root, ".quay", "doc-check-cache.json");

  assert.equal(readDocCheckCache(cacheFile, "k"), null, "absent cache ⇒ null");
  writeDocCheckCache(cacheFile, "k");
  assert.equal(readDocCheckCache(cacheFile, "k"), true, "green entry roundtrips as a hit");
  assert.equal(readDocCheckCache(cacheFile, "other"), null, "wrong key ⇒ miss");

  fs.writeFileSync(cacheFile, "{not json");
  assert.equal(readDocCheckCache(cacheFile, "k"), null, "corrupt entry ⇒ null (fail-closed)");

  fs.writeFileSync(cacheFile, JSON.stringify({ key: "k", ok: false }));
  assert.equal(readDocCheckCache(cacheFile, "k"), null, "not-green (ok!=true) entry is never a hit");
});
