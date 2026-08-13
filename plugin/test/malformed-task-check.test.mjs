// @test-group governance
// malformed-task-check.test.mjs — RED/GREEN tests for the malformed-task gate
// (plugin/scripts/malformed-task-check.ts, gap-malformed-task-silent-vanish-no-alert).
//
// The defect: a task file whose YAML frontmatter fails to parse is SILENTLY removed from the
// whole store — the only signal is a one-line Warning on `quay task list` stdout and NO checker
// read it (invisible ≡ non-existent, hard rule ④). This checker consumes the store's OWN
// malformed array (store.listWithMalformed(), the same producer `task list`'s Warning reads) and
// turns a non-empty malformed list RED — the missing consumer.
//
// Covered here:
//   - GREEN: a clean tasks dir reports zero malformed (scanMalformed returns []).
//   - RED:   the live-sample shape (`title: [封存] …` — YAML flow sequence with a trailing
//         scalar, the exact 2026-08-13 sample) IS reported malformed, with file + parser error.
//   - resolveTasksDir: config-absent roots fall back to <root>/tasks (fresh-worktree shape).
//   - checkRoot over the REAL repo: exit 0 (the corpus is currently clean).
//   - CLI: the malformed path exits 1 and prints each excluded file.
//
// Run:
//   scripts/test.sh plugin/test/malformed-task-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scanMalformed, resolveTasksDir, checkRoot } from "../scripts/malformed-task-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "malformed-task-check.ts");

// The live-sample malformed shape: `title: [封存] …` — YAML parses `[封存]` as a flow sequence and
// the trailing ` bare-dir thing` as an "unexpected scalar at node end".
const LIVE_SAMPLE_BAD = "---\nid: BAD-1\ntitle: [封存] bare-dir thing\n---\nbody\n";
const CLEAN = "---\nid: OK-1\ntitle: a well-formed task\n---\nbody\n";

function makeTasksDir(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "malformed-task-check-"));
  const tasksDir = path.join(tmp, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tasksDir, name), content, "utf8");
  }
  return { tmp, tasksDir };
}

// ── GREEN: clean store reports zero malformed ─────────────────────────────────────────────────────
test("GREEN: a clean tasks dir reports zero malformed", async () => {
  const { tmp, tasksDir } = makeTasksDir({ "OK-1.md": CLEAN, "OK-2.md": CLEAN });
  try {
    const malformed = await scanMalformed(tasksDir, REPO_ROOT);
    assert.deepEqual(malformed, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── RED: the live-sample malformed shape is detected with file + error ────────────────────────────
test("RED: the [封存] live-sample shape is reported malformed with file + error", async () => {
  const { tmp, tasksDir } = makeTasksDir({ "OK-1.md": CLEAN, "BAD-1.md": LIVE_SAMPLE_BAD });
  try {
    const malformed = await scanMalformed(tasksDir, REPO_ROOT);
    assert.ok(Array.isArray(malformed));
    assert.equal(malformed.length, 1, "exactly the bad file is malformed");
    assert.equal(malformed[0].file, "BAD-1.md");
    assert.match(malformed[0].error, /Unexpected scalar at node end/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── resolveTasksDir: config-absent root falls back to <root>/tasks (fresh-worktree shape) ─────────
test("resolveTasksDir falls back to <root>/tasks when config is absent", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "malformed-task-check-root-"));
  try {
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    // No .quay/config.yml, no packages/ — must still resolve to <root>/tasks.
    assert.equal(await resolveTasksDir(tmp), path.join(tmp, "tasks"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── checkRoot over the REAL repo: corpus is currently clean → exit 0 ──────────────────────────────
test("checkRoot over the real repo reports zero malformed", async () => {
  const { malformed } = await checkRoot(REPO_ROOT);
  assert.deepEqual(malformed, []);
});

// ── CLI RED: malformed path exits 1 and prints each excluded file ────────────────────────────────
test("CLI exits 1 and prints the excluded file when a task is malformed", () => {
  const { tmp, tasksDir } = makeTasksDir({ "BAD-1.md": LIVE_SAMPLE_BAD });
  try {
    const r = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", tmp],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    assert.equal(r.status, 1, "malformed non-empty ⇒ exit 1");
    assert.match(r.stderr, /BAD-1\.md/);
    assert.match(r.stderr, /Unexpected scalar at node end/);
    // The report names the tasks dir — no silent drop.
    assert.match(r.stderr, new RegExp(tasksDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── CLI GREEN: a clean root exits 0 ───────────────────────────────────────────────────────────────
test("CLI exits 0 on a clean root", () => {
  const { tmp, tasksDir } = makeTasksDir({ "OK-1.md": CLEAN });
  try {
    const r = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", tmp],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
