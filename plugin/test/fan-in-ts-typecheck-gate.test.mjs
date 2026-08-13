// @test-group governance
// fan-in-ts-typecheck-gate.test.mjs — RED/GREEN tests for the fan-in ts-typecheck admission
// pre-check (plugin/scripts/fan-in-ts-typecheck-gate.ts, gap-ts-touching-fan-in-needs-typecheck-gate).
//
// The defect: fan-in admission only looks at scoped green — but a task that ADDS/MOVES .ts files
// changes the TYPE GRAPH, and scoped tests do not catch type errors (round 52 red: cli-import-
// migration's 17 new .ts files passed scoped 79/0 green but failed `npx tsc --noEmit` with 73
// errors in src/cli/). This module is the admission pre-check: when the task's ## Touches cover a
// NEW/MOVED .ts file in the task's git diff (vs the merge target), the ts-typecheck gate MUST run
// before fan-in — and a red typecheck BLOCKS the fan-in regardless of scoped green.
//
// Covered here:
//   - parseTouches: the ## Touches section parses through the ONE touches-parser (annotations,
//     backticks, full-width (…) stripped).
//   - listNewMovedTsFiles: filters `git diff --name-only` output to NEW/MOVED .ts files.
//   - touchCoversFile / requiresTypecheck: the decision — exact-file touch, directory touch, glob
//     touch; GREEN (no trigger) and RED (trigger) both directions.
//   - resolveTypecheckCommand: config-absent → canonical; a config declaring `ts-typecheck` → the
//     configured command (ADR-013 — the command is workspace data, not hardcoded).
//   - runTypecheckGate: the fake-gate backdoor (test-only) proves pass/fail verdict wiring.
//   - CLI negative control (AC3): a task that adds a new .ts file is BLOCKED on a red typecheck
//     (exit 1) and ADMITTED on a green one (exit 0); a task with no new/moved .ts is admitted
//     WITHOUT running the gate; a git-diff failure fails CLOSED (exit 1).
//
// Run:
//   scripts/test.sh plugin/test/fan-in-ts-typecheck-gate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  parseTouches,
  listNewMovedTsFiles,
  touchCoversFile,
  requiresTypecheck,
  resolveTypecheckCommand,
  runTypecheckGate,
  CANONICAL_TYPECHECK_CMD,
  main,
} from "../scripts/fan-in-ts-typecheck-gate.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "fan-in-ts-typecheck-gate.ts");

// ── parseTouches: the ONE touches-parser surfaces the bare paths ────────────────────────────────────
test("parseTouches: parses the ## Touches section through the single touches-parser", () => {
  const body = [
    "# T",
    "body",
    "## Touches",
    "- plugin/scripts/fan-in-ts-typecheck-gate.ts（新：fan-in 前置检查）",
    "- `plugin/test/fan-in-ts-typecheck-gate.test.mjs` (new)",
    "- src/cli/ (moved)",
    "## AC",
    "- [ ] AC1",
  ].join("\n");
  assert.deepEqual(parseTouches(body), [
    "plugin/scripts/fan-in-ts-typecheck-gate.ts",
    "plugin/test/fan-in-ts-typecheck-gate.test.mjs",
    "src/cli/",
  ]);
});

test("parseTouches: missing section yields an empty list", () => {
  assert.deepEqual(parseTouches("# T\nbody only\n"), []);
  assert.deepEqual(parseTouches(""), []);
});

// ── listNewMovedTsFiles: filter `git diff --name-only` output to NEW/MOVED .ts ─────────────────────
test("listNewMovedTsFiles: keeps .ts/.d.ts, drops non-ts, handles CRLF and blank lines", () => {
  const out = "src/cli/a.ts\nsrc/cli/b.ts\nsrc/cli/c.d.ts\npackages/quay/src/index.ts\nREADME.md\nplugin/scripts/x.ts\r\n";
  assert.deepEqual(listNewMovedTsFiles(out), [
    "src/cli/a.ts",
    "src/cli/b.ts",
    "src/cli/c.d.ts",
    "packages/quay/src/index.ts",
    "plugin/scripts/x.ts",
  ]);
});

test("listNewMovedTsFiles: empty / absent output yields []", () => {
  assert.deepEqual(listNewMovedTsFiles(""), []);
  assert.deepEqual(listNewMovedTsFiles("\n\n"), []);
  assert.deepEqual(listNewMovedTsFiles(null), []);
});

// ── touchCoversFile: the cover relation ─────────────────────────────────────────────────────────────
test("touchCoversFile: exact file, directory, and glob touches cover a file", () => {
  assert.equal(touchCoversFile("src/cli/import.ts", "src/cli/import.ts"), true);   // exact file
  assert.equal(touchCoversFile("src/cli/", "src/cli/import.ts"), true);            // directory
  assert.equal(touchCoversFile("src/cli", "src/cli/import.ts"), true);             // directory (no slash)
  assert.equal(touchCoversFile("src/*", "src/cli/import.ts"), true);               // glob → directory prefix
  assert.equal(touchCoversFile("./src/cli/import.ts", "src/cli/import.ts"), true); // leading ./
});

test("touchCoversFile: disjoint paths do not cover", () => {
  assert.equal(touchCoversFile("src/cli/", "src/other.ts"), false);
  assert.equal(touchCoversFile("docs/", "src/cli/import.ts"), false);
  assert.equal(touchCoversFile("src/cli", "src/cli-other.ts"), false); // prefix is segment-bound
  assert.equal(touchCoversFile("", "src/cli/import.ts"), false);
});

// ── requiresTypecheck: the AC1 decision (Touches ∩ new/moved .ts ≠ ∅) ──────────────────────────────
test("requiresTypecheck: GREEN — no new/moved .ts in Touches", () => {
  assert.equal(requiresTypecheck([], ["src/cli/a.ts"]), false);        // empty touches
  assert.equal(requiresTypecheck(["docs/"], []), false);               // empty diff
  assert.equal(requiresTypecheck(["docs/"], ["src/cli/a.ts"]), false); // disjoint
  assert.equal(requiresTypecheck(["src/cli/"], ["docs/a.md"]), false); // diff has no .ts covered
});

test("requiresTypecheck: RED — Touches cover new/moved .ts (the cli-import-migration shape)", () => {
  // directory touch covering the 20 new files of cli-import-migration
  assert.equal(requiresTypecheck(["src/cli/"], ["src/cli/a.ts", "src/cli/b.ts"]), true);
  // exact .ts-file touch
  assert.equal(requiresTypecheck(["src/cli/import-migration.ts"], ["src/cli/import-migration.ts"]), true);
  // glob touch
  assert.equal(requiresTypecheck(["src/cli/*"], ["src/cli/a.ts"]), true);
  // one covered among many
  assert.equal(requiresTypecheck(["src/"], ["src/other.ts", "src/cli/a.ts"]), true);
});

// ── resolveTypecheckCommand: workspace data, config-aware with canonical fallback ───────────────────
test("resolveTypecheckCommand: config-absent root falls back to the canonical per-package loop", async () => {
  const cmd = await resolveTypecheckCommand(REPO_ROOT);
  assert.equal(cmd, CANONICAL_TYPECHECK_CMD);
});

test("resolveTypecheckCommand: a config declaring ts-typecheck yields ITS command (ADR-013)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-ts-gate-cfg-"));
  try {
    const declared = 'for d in packages/*/; do echo custom-typecheck; done';
    fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".quay", "config.yml"),
      `gates:\n  testPass:\n    - name: ts-typecheck\n      command: "${declared}"\n`, "utf8");
    // configRoot has no packages tree — the loader module resolves from REPO_ROOT's packages tree
    // (moduleRoot), while the config TEXT is read from configRoot.
    const cmd = await resolveTypecheckCommand(tmp, REPO_ROOT);
    assert.equal(cmd, declared);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── runTypecheckGate: fake-gate verdict wiring (test-only backdoor) ─────────────────────────────────
test("runTypecheckGate: fake pass/fail short-circuit without executing a command", async () => {
  const p = await runTypecheckGate(REPO_ROOT, REPO_ROOT, { fakeGate: "pass" });
  assert.equal(p.ok, true);
  assert.equal(p.fake, true);
  const f = await runTypecheckGate(REPO_ROOT, REPO_ROOT, { fakeGate: "fail" });
  assert.equal(f.ok, false);
  assert.equal(f.fake, true);
});

// ── CLI integration (negative control — AC3 + AC2 gate-run wiring) ──────────────────────────────────
// Builds a temp git repo shaped like an inner task worktree:
//   base commit = the task file (## Touches: src/) with NO src/ yet;
//   tip commit  = adds a NEW .ts file under src/  ⇒ the task's own diff vs HEAD~1 contains a
//                 new/moved .ts covered by the Touches ⇒ the gate MUST run before fan-in.
function makeTempTaskRepo({ touches, withNewTs, typeError = false }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-ts-gate-repo-"));
  const tasksDir = path.join(tmp, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  const touchesBullets = touches.map((t) => `- ${t}`).join("\n");
  fs.writeFileSync(path.join(tasksDir, "GAP-TS-NEG.md"),
    `---\nid: GAP-TS-NEG\ntitle: neg\nstatus: todo\n---\n\n## Proposal\nbody\n\n## Touches\n${touchesBullets}\n`, "utf8");
  // base commit (the fork point — the merge target the task rebased onto)
  runGit(tmp, ["init", "-q"]);
  runGit(tmp, ["config", "user.email", "test@example.com"]);
  runGit(tmp, ["config", "user.name", "Test"]);
  runGit(tmp, ["add", "-A"]);
  runGit(tmp, ["commit", "-q", "-m", "base"]);
  // ALWAYS a tip commit (so `HEAD~1...HEAD` is a valid diff): the new/moved .ts when asked,
  // otherwise a non-.ts file (docs/guide.md) so the diff provably contains no .ts.
  if (withNewTs) {
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "new-verb.ts"),
      typeError ? "export const x: number = 'not-a-number';\n" : "export const x: number = 1;\n", "utf8");
  } else {
    fs.mkdirSync(path.join(tmp, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "docs", "guide.md"), "# guide\n", "utf8");
  }
  runGit(tmp, ["add", "-A"]);
  runGit(tmp, ["commit", "-q", "-m", "tip"]);
  return tmp;
}

function runGit(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function runCli(cwd, args) {
  try {
    const out = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], {
      cwd, encoding: "utf8",
    });
    return { status: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: String(err) };
  }
}

test("CLI AC3 negative control: a task whose Touches cover a NEW .ts file is BLOCKED on a red typecheck and ADMITTED on green", () => {
  const tmp = makeTempTaskRepo({ touches: ["src/"], withNewTs: true, typeError: true });
  try {
    // red typecheck ⇒ BLOCKED (exit 1) — the cli-import-migration shape must NOT fan in
    const red = runCli(tmp, ["--task", "GAP-TS-NEG", "--worktree", tmp, "--merge-target", "HEAD~1", "--fake-gate", "fail"]);
    assert.equal(red.status, 1, `expected BLOCKED; stdout=${red.stdout} stderr=${red.stderr}`);
    assert.match(red.stdout, /BLOCKED/);
    assert.match(red.stdout, /type graph changed/); // decision path reached: a new/moved .ts in Touches
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI AC2/AC3: a clean new .ts file is ADMITTED when the typecheck is green, and the gate RUNS", () => {
  const tmp = makeTempTaskRepo({ touches: ["src/"], withNewTs: true, typeError: false });
  try {
    const green = runCli(tmp, ["--task", "GAP-TS-NEG", "--worktree", tmp, "--merge-target", "HEAD~1", "--fake-gate", "pass"]);
    assert.equal(green.status, 0, `expected ADMITTED; stdout=${green.stdout} stderr=${green.stderr}`);
    assert.match(green.stdout, /ADMITTED/);
    assert.match(green.stdout, /running ts-typecheck gate/); // AC2: the gate IS run when triggered
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI AC1: a task with no new/moved .ts is ADMITTED WITHOUT running the gate (even a red fake would not fire)", () => {
  const tmp = makeTempTaskRepo({ touches: ["docs/"], withNewTs: false });
  try {
    // fake-gate=fail would block if the gate ran — it must NOT run (no type-graph change in Touches).
    const r = runCli(tmp, ["--task", "GAP-TS-NEG", "--worktree", tmp, "--merge-target", "HEAD~1", "--fake-gate", "fail"]);
    assert.equal(r.status, 0, `expected ADMITTED (no ts touch); stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stdout, /no new\/moved \.ts in the declared write surface/);
    assert.doesNotMatch(r.stdout, /running ts-typecheck gate/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI: an UNCOMMITTED new .ts file in the working tree also triggers the gate (the union of committed + working-tree diff)", () => {
  // base repo with a committed task file (Touches: src/), then a NEW .ts added but NOT committed.
  const tmp = makeTempTaskRepo({ touches: ["src/"], withNewTs: false }); // tip commits docs/guide.md (non-ts)
  try {
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "uncommitted.ts"), "export const x: number = 'bad';\n", "utf8");
    // not committed — only the working-tree diff carries it
    const r = runCli(tmp, ["--task", "GAP-TS-NEG", "--worktree", tmp, "--merge-target", "HEAD~1", "--fake-gate", "fail"]);
    assert.equal(r.status, 1, `expected BLOCKED (uncommitted new .ts); stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stdout, /type graph changed/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI fail-closed: an unavailable git diff blocks (never admits an unknown type-graph change)", () => {
  const tmp = makeTempTaskRepo({ touches: ["src/"], withNewTs: true });
  try {
    const r = runCli(tmp, ["--task", "GAP-TS-NEG", "--worktree", tmp, "--merge-target", "definitely-not-a-ref", "--fake-gate", "pass"]);
    assert.equal(r.status, 1, `expected fail-closed BLOCKED; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /could not compute the task's git diff/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI --check-only reports the decision without running the gate", () => {
  const tmp = makeTempTaskRepo({ touches: ["src/"], withNewTs: true });
  try {
    const r = runCli(tmp, ["--task", "GAP-TS-NEG", "--worktree", tmp, "--merge-target", "HEAD~1", "--check-only", "--json"]);
    assert.equal(r.status, 0);
    const j = JSON.parse(r.stdout);
    assert.equal(j.required, true);
    assert.equal(j.typecheck.ran, false);
    assert.equal(j.reason, "new-moved-ts-in-touches"); // decision only — no gate run
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
