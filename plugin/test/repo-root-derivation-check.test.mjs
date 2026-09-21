// @test-group engine
// repo-root-derivation-check.test.mjs — tasks/gap-repo-root-derivation-bypasses-shared-accessor (AC7).
//
// Coverage map (task ACs):
//   AC4 — the ratchet can take the value TRUE: a real pre-migration sample (the exact line
//         measure-trend-check.ts carried before this task) is judged a HIT, with file:line named.
//   AC5 — the ratchet can take the value FALSE on the three legitimate literal mentions: a shell
//         `#` comment, a TS line comment, and a bare copy-list string. Two of those live in the SAME
//         file as a genuine hit, so the test pins the POSITION predicate, not a keyword scan.
//   3b  — an absent / empty scan surface is NOT-EVALUATED (exit 3), never PASS.
//
// Both halves are asserted — a fixture that only proves "hits are reported" cannot tell a ratchet
// from a checker that always returns FAIL, and one that only proves "clean input passes" cannot tell
// it from one that always returns PASS (硬规则 3 + 3b).
//
// Run:
//   node --test plugin/test/repo-root-derivation-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "repo-root-derivation-check.ts");

// The defect shape, assembled from fragments so this file's own SOURCE does not carry the literal
// (the same self-reference discipline the checker follows). The fragments are the same tokens a
// reader would write; only their adjacency in the source text is broken.
const CALL = ["path", "resolve"].join(".") + "(";
const UP = JSON.stringify("..");
/** `<indent>const X = path.resolve(<dirConst>, "..", "..");` — one real instance of the defect. */
function defectLine(indent, constName, dirConst) {
  return `${indent}const ${constName} = ${CALL}${dirConst}, ${UP}, ${UP});`;
}

function runChecker(root, extraArgs = []) {
  return spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, "--json", ...extraArgs],
    { encoding: "utf8" },
  );
}

function makeRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-root-derivation-"));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, "utf8");
  }
  return root;
}

// ── AC4 — the positive direction: a real pre-migration sample is a HIT ──────────────────────────────
test("AC4: a real pre-migration sample (measure-trend-check's own line, verbatim shape) is a HIT", () => {
  const root = makeRoot({
    "plugin/scripts/measure-trend-check.ts": [
      `import path from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `const __dirname = path.dirname(fileURLToPath(import.meta.url));`,
      defectLine("", "REPO_ROOT", "__dirname"),
      `export const DEFAULT_LOG_FILE = path.join(REPO_ROOT, ".quay", "full-suite.log");`,
      "",
    ].join("\n"),
  });
  try {
    const r = runChecker(root);
    assert.equal(r.status, 1, `expected RED, got ${r.status}: ${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hits, 1);
    assert.equal(out.violations.length, 1);
    assert.match(out.violations[0], /^plugin\/scripts\/measure-trend-check\.ts:4:/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4: the same sample with that line migrated is a clean PASS (the judgment can take both values)", () => {
  const root = makeRoot({
    "plugin/scripts/measure-trend-check.ts": [
      `import path from "node:path";`,
      `import { repoRoot } from "./repo-root.ts";`,
      `const REPO_ROOT = repoRoot();`,
      `export const DEFAULT_LOG_FILE = path.join(REPO_ROOT, ".quay", "full-suite.log");`,
      "",
    ].join("\n"),
  });
  try {
    const r = runChecker(root);
    assert.equal(r.status, 0, `expected PASS, got ${r.status}: ${r.stdout}${r.stderr}`);
    assert.equal(JSON.parse(r.stdout).hits, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC5 — the negative direction: legitimate mentions are NOT counted ───────────────────────────────
test("AC5: a shell `#` comment, a TS line comment, and a bare copy-list string are all NOT hits — while the code line in the SAME file is", () => {
  const root = makeRoot({
    // A shell comment that spells the shape (repo-root.sh:2 / quay-init.sh:669 shape).
    "plugin/scripts/repo-root.sh": [
      "#!/usr/bin/env bash",
      `# repo-root.sh — single bash counterpart of repo-root.ts (bare ${CALL}__dirname, ${UP}, ${UP}) is not the accessor)`,
      "set -u",
      "",
    ].join("\n"),
    // A TS line comment spelling it, PLUS the real code line, PLUS a copy-list string spelling the
    // module BASENAME (plugin/test/driver-cli.test.mjs:58 shape — the "9 literals" false positive).
    "plugin/scripts/allowed-tools-plugin-prefix-check.ts": [
      `import path from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `const __dirname = path.dirname(fileURLToPath(import.meta.url));`,
      `// the pre-migration form was ${CALL}__dirname, ${UP}, ${UP}) — never do this again`,
      `const DEFAULT_ROOT = ${CALL}__dirname, ${UP}, ${UP});`,
      `const COPY_LIST = ["repo-root.ts", "gate-script-base.ts"];`,
      "",
    ].join("\n"),
  });
  try {
    const r = runChecker(root);
    assert.equal(r.status, 1, `expected exactly one RED, got ${r.status}: ${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hits, 1, `expected the ONE code line to be the only hit, got: ${JSON.stringify(out.violations)}`);
    assert.match(out.violations[0], /allowed-tools-plugin-prefix-check\.ts:5:/, "the hit must be the code line, not the comment on line 4");
    assert.ok(!out.violations.some((v) => /:4:/.test(v)), "line 4 (the line COMMENT) must not be reported");
    assert.ok(!out.violations.some((v) => /repo-root\.sh/.test(v)), "the shell COMMENT file must not be reported");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC5: the checker's own source carries none of the shape it catches (it is inside its own scan surface)", () => {
  const src = fs.readFileSync(CHECKER, "utf8");
  const ac1Grep = new RegExp(`${CALL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(SCRIPT_DIR|__dirname), *${UP.replace(/\./g, "\\.")}, *${UP.replace(/\./g, "\\.")}\\)`);
  assert.equal(ac1Grep.test(src), false, "the checker's own source spells the pattern it catches");
  // and the repo-wide reading the task actually asks for (AC2): the shipped tree is clean
  const inRepo = spawnSync("bash", ["-c", `node --no-warnings --experimental-strip-types ${JSON.stringify(CHECKER)} --root ${JSON.stringify(REPO_ROOT)}`], { encoding: "utf8" });
  assert.equal(inRepo.status, 0, `the real plugin/scripts tree must be CLEAN after the migration: ${inRepo.stdout}${inRepo.stderr}`);
});

// ── 硬规则 3b — an empty scan surface must not read as PASS ─────────────────────────────────────────
test("3b: an EMPTY scan surface is NOT-EVALUATED (exit 3), never PASS", () => {
  const root = makeRoot({ "plugin/scripts/.keep": "" });
  try {
    const r = runChecker(root);
    assert.equal(r.status, 3, `expected NOT-EVALUATED, got ${r.status}: ${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, "not-evaluated");
    assert.notEqual(out.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("3b: a NON-EXISTENT scan surface is NOT-EVALUATED (exit 3), never PASS", () => {
  const r = runChecker(path.join(os.tmpdir(), "repo-root-derivation-does-not-exist-xyz"));
  assert.equal(r.status, 3, `expected NOT-EVALUATED, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.notEqual(JSON.parse(r.stdout).ok, true);
});
