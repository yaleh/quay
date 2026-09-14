// @test-group engine
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
  resolveTypecheckCommandDetailed,
  resolveConfigLoaderPath,
  runTypecheckGate,
  FALLBACK_TYPECHECK_CMD,
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

// ── resolveTypecheckCommand: workspace data read ACROSS the project boundary ────────────────────────
// The defect (gap-fan-in-ts-typecheck-gate-cannot-read-third-party-config): the loader MODULE base was
// `repoRoot(configRoot)` — the project under test — so a third-party project (no quay source tree)
// could never have its own declaration read, and the fallback was quay's own `packages/*/` loop,
// which dies with TS5058 on any project without a `packages/` dir.
//
// `makeThirdPartyProject` is the hermetic fixture for that shape. It is deliberately a CONSUMER root
// (package.json + .quay/config.yml, no `packages/`, no quay source) AND a git repo, so the PRE-FIX
// `repoRoot(configRoot)` resolves to the fixture itself and finds no loader — i.e. the AC1/AC2
// assertions below are RED on the pre-fix code, not vacuously green via a cwd fallback.
function makeThirdPartyProject({ declared }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-ts-gate-3p-"));
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "third-party-fixture", private: true }), "utf8");
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  const gate = declared == null ? "" : `gates:\n  testPass:\n    - name: ${declared.name}\n      command: "${declared.command}"\n`;
  fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), gate, "utf8");
  try { runGit(tmp, ["init", "-q"]); } catch { /* git optional — package.json already pins repoRoot */ }
  return tmp;
}

test("resolveConfigLoaderPath: the loader is found from THIS script's install location, not the target project", () => {
  // The probe's anchor is the script's own dir, so the quay source is reachable even when the
  // workspace under test has none. (Pre-fix there was no probe at all: the base was the workspace.)
  const found = resolveConfigLoaderPath();
  assert.ok(found, "expected a reachable Core config loader from the script's own install location");
  assert.ok(found.endsWith(path.join("gate", "config", "loader.ts")), `unexpected loader path: ${found}`);
});

test("AC1: a third-party project (no packages/ tree) declaring `ts-typecheck` yields ITS command verbatim", async () => {
  const declared = "npx tsc --noEmit -p tsconfig.json";
  const tmp = makeThirdPartyProject({ declared: { name: "ts-typecheck", command: declared } });
  try {
    assert.equal(fs.existsSync(path.join(tmp, "packages")), false, "fixture must have no packages/ tree");
    // NO explicit moduleRoot — this is the production call shape (main() passes the worktree's own
    // root, which the probe then fails to find the loader under and falls through to script-side).
    const r = await resolveTypecheckCommandDetailed(tmp);
    assert.equal(r.command, declared, "the project's OWN declared command, verbatim");
    assert.equal(r.source, "config");
    assert.equal(r.declaredAs, "ts-typecheck");
    // and the same through main()'s call shape: the workspace root as the explicit module base
    assert.equal(await resolveTypecheckCommand(tmp, tmp), declared);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2: the same project with NO typecheck declaration falls back to a third-party-valid command (never `packages/*/`)", async () => {
  const tmp = makeThirdPartyProject({ declared: null });
  try {
    const r = await resolveTypecheckCommandDetailed(tmp);
    assert.equal(r.command, FALLBACK_TYPECHECK_CMD);
    assert.equal(r.source, "fallback");
    assert.equal(r.reason, "no-declaration");
    // The defect's signature string: bash leaves `packages/*/` unexpanded ⇒ tsc TS5058 on any
    // project without that dir. It must never come back as the fallback.
    assert.doesNotMatch(r.command, /packages\/\*\//, `fallback still assumes quay's layout: ${r.command}`);
    assert.equal(await resolveTypecheckCommand(tmp, tmp), FALLBACK_TYPECHECK_CMD);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("resolveTypecheckCommand: a config declaring `typecheck` is also read (the real third-party name)", async () => {
  // ad-arm1/archguard declares `- name: typecheck` / `command: npx tsc --noEmit` (measured
  // 2026-09-14). Matching only `ts-typecheck` would leave that project's declaration unread.
  const tmp = makeThirdPartyProject({ declared: { name: "typecheck", command: "npx tsc --noEmit" } });
  try {
    const r = await resolveTypecheckCommandDetailed(tmp);
    assert.equal(r.command, "npx tsc --noEmit");
    assert.equal(r.source, "config");
    assert.equal(r.declaredAs, "typecheck");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("resolveTypecheckCommand: quay's own repo still reads its declared per-package loop (no regression)", async () => {
  // DoD control: quay's own ts-typecheck judgement is unchanged — it declares `ts-typecheck` in
  // `.quay/config.yml`, which is matched FIRST (ahead of the `typecheck` alias).
  const r = await resolveTypecheckCommandDetailed(REPO_ROOT);
  assert.equal(r.source, "config");
  assert.equal(r.declaredAs, "ts-typecheck");
  assert.match(r.command, /packages\/\*\//, "quay's own gate keeps the per-package loop");
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
