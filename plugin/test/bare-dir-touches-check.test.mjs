// @test-group governance
// bare-dir-touches-check.test.mjs — the bare-directory + uncertain-annotation Touches rule
// (tasks/gap-touches-bare-dir-uncertain-declaration-drags-the-pool, AC1). A Touches entry must NOT
// declare a BARE DIRECTORY with an UNCERTAIN annotation ('若成脚本' / '或等价' / '可能') — a bare dir
// expands to everything under it (a SPECULATIVE broad declaration that collides with every other task
// touching that dir; measured: branch-model's `plugin/scripts/（…，若成脚本）` expanded to 100+ files and
// sank 5/6 pool candidates). Rule: declare a CONCRETE path, or PRE-CLAIM an explicit candidate path
// (e.g. `plugin/scripts/branch-helper.sh`).
//
// This file pins:
//   * the MECHANICAL flag — flagBareDirUncertainTouches in the ONE Touches parser
//     (touches-parser.ts, ADR-004 single-source);
//   * the CONSUMER check — `bare-dir-uncertain-touch` in task-contract-check.ts, wired into the
//     scoped static-check tier (subset-touched) so a filing with the pattern is flagged, plus a
//     shrink-only grandfather baseline for pre-rule debt.
//
// AC1 negative controls: a CONCRETE file path with an uncertain annotation is NOT flagged; a bare dir
// with a NON-uncertain annotation is NOT flagged; an existing extension-less file (plugin/VERSION) is
// NOT mistaken for a bare directory.
//
// Run: scripts/test.sh plugin/test/bare-dir-touches-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { flagBareDirUncertainTouches } from "../scripts/touches-parser.ts";
import {
  scanTaskText,
  checkBareDirUncertainTouches,
  readBareDirTouchesBaseline,
  BARE_DIR_TOUCHES_BASELINE_REL,
} from "../scripts/task-contract-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "task-contract-check.ts");

// R6 (gap-tests-never-clean-up-their-tmpdirs): every mkdtemp dir is tracked and removed at the end.
const tempDirs = [];
function makeGitRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bdt-${tag}-`));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "analysis"), { recursive: true });
  return dir;
}
after(() => {
  for (const d of tempDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
});

const fm = (labels = [], status = "todo") =>
  `---\nid: T\ntitle: t\nstatus: ${status}\nlabels:\n${(labels || []).map((l) => `  - ${l}`).join("\n")}\nextra:\n  schema: "v1"\n---\n`;

function bodyWithTouches(touchesSection, labels = ["gap"]) {
  return `${fm(labels)}\n## Proposal\n\nproposal body body\n\n## Touches\n\n${touchesSection}\n`;
}

// ── flagBareDirUncertainTouches ─────────────────────────────────────────────────────────────────────

test("flag: bare-directory + '若成脚本' annotation is flagged", () => {
  const section = "- plugin/scripts/（机械检查，若成脚本）";
  const flagged = flagBareDirUncertainTouches(section);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].path, "plugin/scripts/");
  assert.match(flagged[0].annotation, /若成脚本/);
});

test("flag: bare-directory + '或等价' / '可能' / '待定' annotations are flagged", () => {
  for (const ann of ["或等价", "可能", "待定", "或新共享进程预算"]) {
    const section = `- plugin/scripts/（扩展 helper，${ann}）`;
    const flagged = flagBareDirUncertainTouches(section);
    assert.equal(flagged.length, 1, `expected ${ann} to flag`);
  }
});

test("flag: an entry that is ONLY an annotation (no path) is flagged", () => {
  const section = "- （外层收尾探测若成脚本，落 plugin/scripts/ 下）";
  const flagged = flagBareDirUncertainTouches(section);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].path, "");
});

test("flag AC1-negative: a CONCRETE file path with an uncertain annotation is NOT flagged", () => {
  const section = "- plugin/scripts/branch-helper.sh（若成脚本）";
  const flagged = flagBareDirUncertainTouches(section);
  assert.equal(flagged.length, 0, JSON.stringify(flagged));
});

test("flag AC1-negative: a bare directory WITHOUT an uncertain annotation is NOT flagged", () => {
  const section = "- plugin/scripts/（本轮涉及的所有脚本）";
  const flagged = flagBareDirUncertainTouches(section);
  assert.equal(flagged.length, 0, JSON.stringify(flagged));
});

test("flag AC1-negative: an existing extension-less file (plugin/VERSION) is NOT a bare directory", () => {
  const root = makeGitRoot("versionfile");
  fs.mkdirSync(path.join(root, "plugin"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "VERSION"), "0.0.1\n");
  const section = "- plugin/VERSION（新增，或 git describe 派生）";
  const flagged = flagBareDirUncertainTouches(section, root);
  assert.equal(flagged.length, 0, JSON.stringify(flagged));
});

test("flag: no-annotation / (new) / (delete) entries are never flagged", () => {
  const section = [
    "- plugin/scripts/fork-baseline.ts",
    "- plugin/scripts/new-helper.sh（new）",
    "- plugin/scripts/old-helper.sh（delete）",
    "- tasks/T.md",
  ].join("\n");
  const flagged = flagBareDirUncertainTouches(section);
  assert.equal(flagged.length, 0, JSON.stringify(flagged));
});

// ── checkBareDirUncertainTouches (consumer, baseline-aware) ─────────────────────────────────────────

test("consumer: a NON-grandfathered task with the pattern → bare-dir-uncertain-touch violation", () => {
  const root = makeGitRoot("consumer");
  const text = bodyWithTouches("- plugin/scripts/（机械检查，若成脚本）");
  const { violations } = scanTaskText(text, "tasks/gap-new-task.md", { root });
  const v = violations.find((x) => x.code === "bare-dir-uncertain-touch");
  assert.ok(v, JSON.stringify(violations));
  assert.match(v.what, /gap-touches-bare-dir-uncertain-declaration-drags-the-pool/);
});

test("consumer: the SAME pattern is NOT a violation when the file IS on the shrink-only grandfather list", () => {
  const root = makeGitRoot("grandfathered");
  const text = bodyWithTouches("- plugin/scripts/（机械检查，若成脚本）");
  const grandfathered = new Set(["tasks/gap-old-task.md"]);
  const { violations } = scanTaskText(text, "tasks/gap-old-task.md", { root, bareDirTouchesBaseline: grandfathered });
  assert.ok(!violations.some((x) => x.code === "bare-dir-uncertain-touch"), JSON.stringify(violations));
});

test("consumer: no ## Touches section → no finding", () => {
  const text = `${fm()}\n## Proposal\n\nproposal body body\n`;
  const { violations } = scanTaskText(text, "tasks/no-touches.md", {});
  assert.ok(!violations.some((x) => x.code === "bare-dir-uncertain-touch"), JSON.stringify(violations));
});

test("readBareDirTouchesBaseline: absent file → empty set + null count", () => {
  const root = makeGitRoot("baseline-absent");
  const { baseline, baselineCount } = readBareDirTouchesBaseline(root);
  assert.equal(baseline.size, 0);
  assert.equal(baselineCount, null);
});

// ── CLI integration (ratchet: new violation exits 1; baseline exempts; ceiling breach exits 1) ───────

const CLEAN_TASK = `---
id: t-clean
title: clean
status: todo
labels:
  - gap
extra:
  schema: v1
---

## Proposal

body body body body body
`;

const BARE_DIR_TASK = `---
id: t-bare
title: bare-dir
status: todo
labels:
  - gap
extra:
  schema: v1
---

## Proposal

body body body body body

## Touches

- plugin/scripts/（机械检查，若成脚本）
`;

test("CLI AC1: a NEW task with the pattern (no baseline) is REPORTED; ratchet growth → exit 1", () => {
  const root = makeGitRoot("clinew");
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  // Establish the contract ratchet over a clean store (baseline-count 0).
  let r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--write-ratchet"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // A NEW task with the bare-dir pattern, NOT on the (absent) grandfather list → new violation → exit 1.
  fs.writeFileSync(path.join(root, "tasks", "t-bare.md"), BARE_DIR_TASK);
  r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /bare-dir-uncertain-touch/);
  assert.match(r.stdout, /new since baseline: 1/);
});

test("CLI AC1: with the file on the grandfather list, the same pattern is NOT a violation (exit 0)", () => {
  const root = makeGitRoot("cligrand");
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  // Write the bare-dir grandfather baseline listing the pattern task as grandfathered.
  fs.writeFileSync(path.join(root, BARE_DIR_TOUCHES_BASELINE_REL), `# baseline-count: 1\n\ntasks/t-bare.md\n`);
  fs.writeFileSync(path.join(root, "tasks", "t-bare.md"), BARE_DIR_TASK);
  let r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(!report.violations.some((v) => v.code === "bare-dir-uncertain-touch"), JSON.stringify(report.violations));
});

test("CLI AC1: the grandfather baseline itself is shrink-only — a ceiling breach exits 1", () => {
  const root = makeGitRoot("cliceiling");
  fs.writeFileSync(path.join(root, "tasks", "t-clean.md"), CLEAN_TASK);
  // baseline-count says 1 but the file lists 2 entries → the list grew → breach.
  fs.writeFileSync(path.join(root, BARE_DIR_TOUCHES_BASELINE_REL), `# baseline-count: 1\n\ntasks/a.md\ntasks/b.md\n`);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /BARE-DIR-TOUCHES BASELINE CEILING BREACH/);
});

test("CLI AC1 strict-subset: a touched task carrying the pattern FAILS the scoped run (filing-time flag)", () => {
  const root = makeGitRoot("clisubset");
  fs.writeFileSync(path.join(root, "tasks", "t-bare.md"), BARE_DIR_TASK);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, "--strict-subset", path.join(root, "tasks", "t-bare.md")], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /bare-dir-uncertain-touch/);
  assert.match(r.stdout, /strict-subset/);
});
