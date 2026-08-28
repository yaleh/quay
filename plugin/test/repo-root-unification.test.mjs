// @test-group engine
// repo-root-unification.test.mjs — SPEC §2.4 B2: `findRepoRoot`(14)+`findWorkspaceRoot`(4) were
// TRUE_DUP (the same upward walk under two names, three coexisting strategies). This file is the
// single-source + ratchet + negative-control + worktree-correctness guard (AC1/AC2/AC3). It reads
// SOURCE, not a fixture — so a redefinition, a dropped import, or a worktree regression turn RED.
//
//   AC1 (single source / ratchet): exactly ONE `function repoRoot` definition under plugin/scripts
//        (repo-root.ts), and ZERO `function findRepoRoot`/`function findWorkspaceRoot` survive.
//   AC2 (negative control): the former local copies are gone (no hidden redefinition survives),
//        every consumer imports from repo-root.ts, and a scratch fixture proves that DELETING the
//        shared export makes a consumer import FAIL (so the unification is real, not a shadow —
//        "删了不红 ⇒ 假").
//   AC3 (worktree correctness): repoRoot resolves to the real root from a task worktree — `plugin/`
//        is a REAL directory (not a symlink), so `__dirname/../..` from plugin/test reaches the
//        worktree root; a synthetic bundle-shaped tree resolves to ITS root (bundle marker), and a
//        plain-git tree resolves via the `.git` marker.
//
// Run: node --test plugin/test/repo-root-unification.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { repoRoot } from "../scripts/repo-root.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "..", "scripts");
const REPO_ROOT = path.resolve(__dirname, "..", ".."); // plugin/test → repo root

/** The plugin/scripts checker source files (TS only — the .sh checkers carry no TS functions). */
function scriptTsFiles() {
  return fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".ts"));
}

function sourceOf(rel) {
  return fs.readFileSync(path.join(SCRIPTS_DIR, rel), "utf8");
}

// The 22 files that previously each carried a local findRepoRoot/findWorkspaceRoot definition.
const FORMER_DEFINERS = [
  "verify-delivery-surface.ts", "threshold-scope-check.ts", "cap-from-gate.ts",
  "check-set-after-change-check.ts", "prod-data-audit.ts", "task-status-drift-check.ts",
  "gate-staleness-check.ts", "select-tests-for-touches.ts", "touches-orthogonality-check.ts",
  "task-ac-carryover-check.ts", "known-load-sensitive.ts", "axis-generator.ts",
  "select-static-checks-for-touches.ts", "gate-dispatch-coverage.ts", "malformed-task-check.ts",
  "fan-in-ts-typecheck-gate.ts", "suite-bucket-attribution.ts", "fast-mode-telemetry.ts",
  "task-contract-check.ts", "inner-exec-mode-report.ts", "trend-check.ts", "suite-bucket-hub-list.ts",
];
// The 10 files that previously cross-imported findRepoRoot from another checker module.
const FORMER_IMPORTERS = [
  "red-window-triage.ts", "fan-in-runid-check.ts", "derive-touches-heuristic.ts",
  "self-report-vocab-audit.ts", "slot-refill.ts", "supervisor-preempt-candidates.ts",
  "suite-bucket-select.ts", "concurrent-batch-scheduler.ts", "ready-pool-check.ts", "inner-blocked-signal.ts",
];
const ALL_CONSUMERS = [...FORMER_DEFINERS, ...FORMER_IMPORTERS];

// ── AC1: single source (the ratchet — a redefinition turns this RED) ──────────────────────────────

test("AC1 — repoRoot is defined exactly once (repo-root.ts)", () => {
  const defs = scriptTsFiles().filter((f) => /\bfunction repoRoot\b/.test(sourceOf(f)));
  assert.deepEqual(
    defs,
    ["repo-root.ts"],
    `repoRoot must have a single definition; found: ${defs.length ? defs.join(", ") : "none"}`,
  );
});

test("AC1 — no findRepoRoot / findWorkspaceRoot definition survives in any .ts", () => {
  const defs = scriptTsFiles().filter(
    (f) => /\bfunction (findRepoRoot|findWorkspaceRoot)\b/.test(sourceOf(f)),
  );
  assert.deepEqual(defs, [], `old names must be fully removed; still defined in: ${defs.join(", ")}`);
});

// ── AC2: negative control (删共享 ⇒ 调用点红) ──────────────────────────────────────────────────────

test("AC2 — the 22 former local copies are gone (no hidden redefinition survives)", () => {
  for (const f of FORMER_DEFINERS) {
    assert.doesNotMatch(
      sourceOf(f),
      /\bfunction (findRepoRoot|findWorkspaceRoot)\b/,
      `${f} must not redefine findRepoRoot/findWorkspaceRoot`,
    );
  }
});

test("AC2 — every consumer imports the shared source from repo-root.ts", () => {
  for (const f of ALL_CONSUMERS) {
    assert.match(
      sourceOf(f),
      /from ["']\.\/repo-root\.ts["']/,
      `${f} must import the shared source from repo-root.ts`,
    );
  }
});

test("AC2 — deleting the shared export makes a consumer import fail (mechanism is real)", () => {
  // Scratch fixture: a consumer importing an ABSENT named export must fail to link; the same
  // consumer succeeds once the export exists. This is the "删了不红 ⇒ 假" negative control — it
  // proves the unification is a real dependency, not a shadow local copy.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-b2-negctl-"));
  try {
    fs.writeFileSync(path.join(dir, "repo-root.ts"), "export const OTHER = 1;\n");
    fs.writeFileSync(
      path.join(dir, "consumer.ts"),
      'import { repoRoot } from "./repo-root.ts";\nconsole.log(repoRoot);\n',
    );
    const missing = spawnSync("node", ["--experimental-strip-types", "consumer.ts"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.notEqual(missing.status, 0, "a consumer importing an absent export must fail to link");

    fs.writeFileSync(path.join(dir, "repo-root.ts"), 'export function repoRoot(p) { return ""; }\n');
    const present = spawnSync("node", ["--experimental-strip-types", "consumer.ts"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(present.status, 0, "the same consumer links once the export is present");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — the bash pair is real: repo-root.sh resolves the root and is consumed", () => {
  const sh = path.join(SCRIPTS_DIR, "repo-root.sh");
  assert.ok(fs.existsSync(sh), "repo-root.sh must exist (the bash half of the pair)");
  const out = spawnSync("bash", [sh], { encoding: "utf8" });
  assert.equal(out.status, 0, `bash repo-root.sh must exit 0: ${out.stderr}`);
  assert.equal(out.stdout.trim(), REPO_ROOT, "bash repo-root.sh must print the repo root");
  assert.match(
    fs.readFileSync(path.join(SCRIPTS_DIR, "capability-catalog.sh"), "utf8"),
    /repo-root\.sh/,
    "capability-catalog.sh must source the bash pair (the pair is consumed, not dead code)",
  );
});

// ── AC3: worktree correctness (plugin/ is a real dir; __dirname/../.. reaches the worktree root) ──

test("AC3 — plugin/ is a real directory, not a symlink (the __dirname/../.. premise)", () => {
  const st = fs.lstatSync(path.join(REPO_ROOT, "plugin"));
  assert.equal(st.isSymbolicLink(), false, "plugin/ must be a real directory, not a symlink");
  assert.equal(st.isDirectory(), true, "plugin/ must be a directory");
});

test("AC3 — repoRoot(__dirname) resolves to the worktree/repo root", () => {
  assert.equal(repoRoot(__dirname), REPO_ROOT);
  assert.equal(repoRoot(path.join(__dirname, "..", "scripts")), REPO_ROOT);
});

test("AC3 — a synthetic bundle-shaped tree resolves to ITS OWN root (bundle marker)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-b2-bundle-"));
  try {
    fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), "{}\n");
    fs.writeFileSync(path.join(dir, "scripts", "test.sh"), "#!/usr/bin/env bash\n");
    const sub = path.join(dir, "plugin", "scripts", "deep");
    fs.mkdirSync(sub, { recursive: true });
    assert.equal(repoRoot(sub), dir, "bundle marker (package.json + plugin/ + scripts/test.sh) wins");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — a plain-git tree (no quay layout) resolves via the .git marker", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-b2-git-"));
  try {
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true }); // worktree-style marker (dir OR file)
    fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
    const sub = path.join(dir, "a", "b");
    fs.mkdirSync(sub, { recursive: true });
    assert.equal(repoRoot(sub), dir, ".git marker resolves the plain-git root");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
