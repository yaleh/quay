// @test-group engine
// dark-axis-record-check.test.mjs — ADR-007's per-milestone predicate, at all three of its faces
// (tasks/gap-adr007-per-milestone-dark-axis-enforcement-gate, AC1/AC2/AC3).
//
// AC1 — the independently callable check: `node --experimental-strip-types
//   plugin/scripts/dark-axis-record-check.ts <task-id>` classifies a task body RECORDED /
//   DISCLAIMED / MISSING (exit 0/0/1), prints the parsed numbers when RECORDED, and gives an
//   unreadable body its OWN value (NOT-EVALUATED, exit 2) instead of folding it into MISSING.
// AC2 — negative control: a ready task with neither a reading nor a declaration FAILS the gate
//   (darkAxisGateCheck → ok:false), so the ready→done path refuses it.
// AC3 — positive control: the SAME task, after a real reading OR an explicit declaration is added,
//   PASSES the gate (ok:true).
//
// Position discipline (CLAUDE.md 硬规则 2) is tested with the real false-positive population: ~51
// task files in this repo mention "L_G"/"L_D" in PROSE. The negative controls below are that shape —
// a prose mention, a bare ADR-number citation, a mid-line mention — and each must stay MISSING. A
// keyword scanner would report RECORDED for all of them, i.e. exactly where nothing was recorded.
//
// Run: scripts/test.sh plugin/test/dark-axis-record-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  classifyDarkAxisRecord,
  darkAxisGateCheck,
  taskBodyOf,
} from "../scripts/dark-axis-record-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "plugin", "scripts", "dark-axis-record-check.ts");

function runCli(args, cwd = REPO_ROOT) {
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", CLI, ...args], {
    cwd,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function tmpTasksDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quay-dark-axis-"));
  const tasksDir = path.join(root, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  for (const [id, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(tasksDir, `${id}.md`), text, "utf8");
  }
  return root;
}

const FM = (id) => `---\nid: ${id}\nstatus: ready\n---\n`;

// ── AC1: the three states ────────────────────────────────────────────────────────────────────────

test("AC1: a task body carrying a numeric L_D/L_G reading is RECORDED, and the numbers are returned", () => {
  const v = classifyDarkAxisRecord("## DoD\n- L_G archguard: cycles=0, god-modules=0\n");
  assert.equal(v.state, "RECORDED");
  assert.deepEqual(v.readings.map((r) => r.axis), ["L_G"]);
  assert.deepEqual(v.readings[0].numbers, [0, 0], "the parsed concrete values are the reading");
  assert.equal(darkAxisGateCheck({ body: "## DoD\n- L_G archguard: cycles=0, god-modules=0\n" }).ok, true);
});

test("AC1: the L_D/L_G proxy's OWN stdout classifies RECORDED verbatim (a real reading, not a paraphrase)", () => {
  // git-lens-l-d-code-doc-ratio.ts prints exactly this line; the L_G proxy prints a header followed
  // by indented per-signal lines. Both are the pasted shapes AC3 names.
  const ld = classifyDarkAxisRecord("L_D code:doc — docLines=812 codeLines=6500 ratio=1:8 verdict=PROSE_HEAVY\n");
  assert.equal(ld.state, "RECORDED");
  assert.deepEqual(ld.readings[0].numbers, [812, 6500, 1, 8]);

  const lg = classifyDarkAxisRecord(
    "L_G structural-drift (fallback proxy) — scanned 6050 files under packages/\n  cycles found: 0\n  god-modules found: 0\n  verdict: PASS\n"
  );
  assert.equal(lg.state, "RECORDED", "the axis header + its indented continuation lines are one reading block");
  assert.deepEqual(lg.readings[0].numbers, [0, 0]);
});

test("AC1: a reading recorded in a CHECKED DoD box is RECORDED (a DoD checklist is where authors write it)", () => {
  // Regression from the live end-to-end run: the first version of the line anchor did not accept a
  // `- [x] ` checkbox prefix, so a reading written in the natural DoD form was a false negative.
  const v = classifyDarkAxisRecord(
    "## Definition of Done\n- [x] L_G structural-drift (fallback proxy) — scanned 6050 files\n      cycles found: 0\n      god-modules found: 0\n"
  );
  assert.equal(v.state, "RECORDED");
  assert.deepEqual(v.readings[0].numbers, [0, 0]);
  // …and an UNCHECKED box is the same line shape — the anchor is a line prefix, not a completion claim
  // (the predicate asks "is a reading recorded", never "was the box ticked").
  assert.equal(classifyDarkAxisRecord("- [ ] L_G: cycles=0\n").state, "RECORDED");
});

test("AC1: the explicit 该轴仍暗,理由:<...> declaration is DISCLAIMED (and needs no numbers)", () => {
  const v = classifyDarkAxisRecord("## DoD\n该轴仍暗，理由：本任务只改文档，无结构/依赖面变更\n");
  assert.equal(v.state, "DISCLAIMED");
  assert.equal(v.disclaimer.reason, "本任务只改文档，无结构/依赖面变更");
  assert.equal(darkAxisGateCheck({ body: "该轴仍暗，理由：纯文档改动\n" }).ok, true);
});

test("AC1: neither present is MISSING and the gate fails closed", () => {
  const v = classifyDarkAxisRecord("## DoD\n- [x] the tests pass\n");
  assert.equal(v.state, "MISSING");
  assert.equal(darkAxisGateCheck({ body: "## DoD\n- [x] the tests pass\n" }).ok, false);
});

test("AC1/硬规则 3b: an UNREADABLE body gets its own NOT-EVALUATED value, never MISSING and never RECORDED", () => {
  const v = classifyDarkAxisRecord(undefined);
  assert.equal(v.state, "NOT-EVALUATED");
  // Fail-closed at the gate, but with a distinguishable reason — "absent" and "could not be read"
  // must not share an output (硬规则 3b).
  const g = darkAxisGateCheck({});
  assert.equal(g.ok, false);
  assert.match(g.reason, /NOT-EVALUATED/);
  // The distinction is REAL, not cosmetic: an empty-but-readable body is MISSING, not NOT-EVALUATED.
  assert.equal(classifyDarkAxisRecord("").state, "MISSING");
});

// ── Position discipline: the ~51 prose mentions must NOT read as records (AC1's anti-keyword face) ─

test("position: a prose mention of the axes is NOT a reading (the repo's own 51-file population)", () => {
  const controls = [
    "## Context\nL_G (reinvented/duplicated abstractions) 仍暗，见 ADR-007 §5。\n",
    "# 本任务不涉及 L_D / L_G / L_S\n这是对暗轴的讨论，没有读数。\n",
    "## Proposal\nThe ADR requires an L_D/L_G reading before a milestone is called done.\n",
  ];
  for (const body of controls) {
    assert.equal(classifyDarkAxisRecord(body).state, "MISSING", `must stay MISSING: ${JSON.stringify(body)}`);
  }
});

test("position: a bare number in the axis line is NOT a reading — (ADR-007) is a citation, not a quantity", () => {
  // The exact false positive a keyword/number scan produces: the axis token plus a number, where the
  // number is an ADR id or a date, not a measurement.
  const controls = [
    "- L_G (ADR-007) 未测\n",
    "L_G 记录于 2026-09-13 12:30 尚未测量\n",
    "L_D: 见 ADR-007\n",
  ];
  for (const body of controls) {
    assert.equal(classifyDarkAxisRecord(body).state, "MISSING", `must stay MISSING: ${JSON.stringify(body)}`);
  }
});

test("position: a mid-line mention is NOT a reading — the axis token must sit at a line start", () => {
  const v = classifyDarkAxisRecord("本任务未记录 L_G: cycles=0\n");
  assert.equal(v.state, "MISSING");
});

test("fail-closed: a declaration without a reason does NOT discharge the obligation", () => {
  assert.equal(classifyDarkAxisRecord("该轴仍暗\n").state, "MISSING", "a bare marker is not a decision");
  assert.equal(classifyDarkAxisRecord("该轴仍暗，理由不明\n").state, "MISSING", "理由 must be followed by an actual reason");
  assert.equal(classifyDarkAxisRecord("该轴仍暗，理由：\n").state, "MISSING", "an empty reason is not a reason");
});

test("the declaration may span the marker and its reason line", () => {
  const v = classifyDarkAxisRecord("该轴仍暗\n理由：纯文档改动，无新抽象\n");
  assert.equal(v.state, "DISCLAIMED");
  assert.equal(v.disclaimer.reason, "纯文档改动，无新抽象");
});

// ── AC2 / AC3: the negative control and the positive control on the SAME task ─────────────────────

test("AC2/AC3: the same task flips MISSING → RECORDED/DISCLAIMED as the record is added", () => {
  const base = "## DoD\n- [x] suite green\n";
  assert.equal(darkAxisGateCheck({ body: base }).ok, false, "AC2: no record ⇒ refused");

  const withReading = `${base}L_G archguard: cycles=0 god-modules=0\n`;
  assert.equal(darkAxisGateCheck({ body: withReading }).ok, true, "AC3: real reading ⇒ passes");

  const withDisclaimer = `${base}该轴仍暗，理由：本任务只改测试，无结构面变更\n`;
  assert.equal(darkAxisGateCheck({ body: withDisclaimer }).ok, true, "AC3: explicit declaration ⇒ passes");

  // …and the ORIGINAL task is still refused: the flip is caused by the record, not by evaluation
  // order or by any sticky state (the counterfactual that makes the control a control).
  assert.equal(darkAxisGateCheck({ body: base }).ok, false);
});

// ── AC1: the CLI's exit codes and its printed values ──────────────────────────────────────────────

test("CLI: MISSING ⇒ exit 1, RECORDED ⇒ exit 0, and the parsed numbers are PRINTED", () => {
  const root = tmpTasksDir({
    "T-missing": `${FM("T-missing")}## DoD\n- [x] suite green, no dark-axis record anywhere\n`,
    "T-recorded": `${FM("T-recorded")}## DoD\nL_G structural-drift — scanned 6050 files\n  cycles found: 0\n  god-modules found: 0\n`,
    "T-disclaimed": `${FM("T-disclaimed")}## DoD\n该轴仍暗，理由：纯文档改动\n`,
  });

  const missing = runCli(["T-missing", "--root", root]);
  assert.equal(missing.status, 1, `MISSING must exit 1; stderr=${missing.stderr}`);
  assert.match(missing.stdout, /state:\s+MISSING/);

  const recorded = runCli(["T-recorded", "--root", root]);
  assert.equal(recorded.status, 0);
  assert.match(recorded.stdout, /state:\s+RECORDED/);
  assert.match(recorded.stdout, /numbers:\s+0, 0/, "AC1: the parsed concrete values are printed");

  const disclaimed = runCli(["T-disclaimed", "--root", root]);
  assert.equal(disclaimed.status, 0);
  assert.match(disclaimed.stdout, /state:\s+DISCLAIMED/);

  const json = runCli(["T-recorded", "--root", root, "--json"]);
  assert.equal(json.status, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.task, "T-recorded");
  assert.equal(parsed.state, "RECORDED");
  assert.deepEqual(parsed.numbers, [0, 0]);
});

test("CLI: a task file that cannot be read is NOT-EVALUATED (exit 2), not MISSING", () => {
  const root = tmpTasksDir({});
  const r = runCli(["T-absent", "--root", root]);
  assert.equal(r.status, 2, "an unreadable object must not be reported as 'nothing recorded' (硬规则 3b)");
  assert.match(r.stdout, /NOT-EVALUATED/);
});

test("CLI: no task id is a usage error (exit 2), not a default-to-pass", () => {
  const r = runCli(["--root", REPO_ROOT]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /<task-id> is required/);
});

// ── taskBodyOf: the frontmatter boundary is a LINE-START fence, never a naive split ───────────────

test("taskBodyOf strips frontmatter by line-start fence and keeps a body containing --- intact", () => {
  const text = "---\nid: X\nstatus: ready\n---\n## DoD\nbefore\n---\nafter\n";
  const body = taskBodyOf(text);
  assert.match(body, /^## DoD/);
  assert.match(body, /after/, "a `---` INSIDE the body must not truncate it (the naive split('---')[1] bug)");
  assert.match(body, /before\n---\nafter/);
});

test("taskBodyOf leaves a fence-less file whole rather than dropping it", () => {
  assert.equal(taskBodyOf("## DoD\nL_G: cycles=0\n"), "## DoD\nL_G: cycles=0\n");
});

// ── The predicate is wired to the repo's OWN ready→done path, not only to this test ───────────────

test("wiring (AC2): the workspace declares ADR-007, so the built-in dark-axis gate is on the ready→done path", () => {
  // If this breaks, the predicate became documentation again — read the gate config the way
  // lifecycle.ts's workspaceEnforcesDarkAxis reads it.
  const cfg = fs.readFileSync(path.join(REPO_ROOT, ".quay", "config.yml"), "utf8");
  assert.match(cfg, /ADR-007/, "the workspace must keep declaring ADR-007, else the ready→done enforcement is silently off");
  const registry = fs.readFileSync(path.join(REPO_ROOT, "packages", "quay", "src", "gate", "registry.ts"), "utf8");
  assert.match(registry, /"dark-axis"/, "the named gate must stay registered");
  const lifecycle = fs.readFileSync(path.join(REPO_ROOT, "packages", "quay", "src", "gate", "lifecycle.ts"), "utf8");
  assert.match(lifecycle, /enforceDarkAxis\(/, "runComplete/runCompleteLoop must run it on the ready→done path");
});
