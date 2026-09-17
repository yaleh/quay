// @test-group engine
// readme-positioning-criterion.test.mjs — the in-repo guard for GOAL-021 / AC-276
// (task gap-readme-positioning-software-engineering-agent).
//
// WHY this test exists: AC-276 states that README.md's first 6000 characters must carry the
// positioning statement ("quay is a software engineering agent;" "Claude Code is the infrastructure
// it runs on") and must NOT carry the reversed phrasing. Today that criterion lives ONLY in
// `goals/AC-276-*.md` and is evaluated by the goal driver — so a README edit that drops the
// paragraph again would be invisible until the next goal-driver round.
//
// SINGLE SOURCE (ADR-004): this test does NOT restate the predicate. It reads AC-276's `criterion`
// field out of the goal file with the repo's own `parseFrontmatterCompletely` (the same parser the
// goal store uses) and executes THAT string. Copying the three regexes / the two keyword lists here
// would be a second home for one rule — i.e. the drift this repo's single-source principle exists to
// prevent. If the criterion changes upstream, this test follows automatically.
//
// The test carries its OWN negative control: the same criterion is run against a throwaway README
// that has no positioning terms, and must exit 1 with CAUSE=positioning-missing. Without it the
// positive assertion would also pass against a criterion that is trivially green (硬规则 3b / 4).
//
// Run: scripts/test.sh plugin/test/readme-positioning-criterion.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { parseFrontmatterCompletely } from "../scripts/task-schema.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

// ── AC-276's criterion, read from the goal file (never re-typed) ────────────────────────────────
function readAc276Criterion() {
  const goalsDir = path.join(ROOT, "goals");
  const file = fs
    .readdirSync(goalsDir)
    .find((f) => f.startsWith("AC-276-") && f.endsWith(".md"));
  assert.ok(file, "goals/AC-276-*.md not found — the criterion this guard pins is gone");
  const raw = fs.readFileSync(path.join(goalsDir, file), "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(m, `goals/${file} has no YAML frontmatter block`);
  const fm = parseFrontmatterCompletely(m[1]);
  assert.equal(typeof fm.criterion, "string", "AC-276 carries no string `criterion` field");
  assert.ok(fm.criterion.trim().length > 0, "AC-276's `criterion` is blank");
  return fm.criterion;
}

// The goal store runs a criterion through `runAcceptance({command: criterion, cwd: root})` — i.e. a
// shell in the workspace root. Reproduce that shape exactly: `bash -c <criterion>`, cwd = the tree
// whose README.md is under test.
function runCriterion(criterion, cwd) {
  return spawnSync("bash", ["-c", criterion], { cwd, encoding: "utf8" });
}

test("AC-276 criterion passes on this repo's README.md", () => {
  const criterion = readAc276Criterion();
  const res = runCriterion(criterion, ROOT);
  assert.equal(
    res.status,
    0,
    `AC-276 criterion must exit 0 on ${path.join(ROOT, "README.md")}\n` +
      `stdout: ${res.stdout}\nstderr: ${res.stderr}`,
  );
  assert.equal(res.stderr, "", "a passing AC-276 run must not write to stderr");
});

test("negative control: the same criterion fails on a README without the positioning statement", () => {
  const criterion = readAc276Criterion();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac276-negative-control-"));
  try {
    fs.writeFileSync(
      path.join(tmp, "README.md"),
      "# quay\n\nA provider-agnostic task board. Nothing about agents or Claude Code here.\n",
      "utf8",
    );
    const res = runCriterion(criterion, tmp);
    assert.equal(res.status, 1, `expected exit 1, got ${res.status}\nstderr: ${res.stderr}`);
    assert.match(res.stderr, /CAUSE=positioning-missing/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
