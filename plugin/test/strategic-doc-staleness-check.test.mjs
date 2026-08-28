// @test-group engine
// strategic-doc-staleness-check.test.mjs — tasks/gap-establish-daily-review-cadence-mechanism
// (AC2/AC3/AC7/AC8): the generic strategic-document staleness checker.
//
// Coverage map (task ACs):
//   AC2  — the checker scans docs/proposals + orchestration/*.md for references to the
//          classic-pipeline script files ADR-022 deleted (prepare-milestone.js, execute-milestone.js,
//          milestone-worktree.ts), judged by PATH EXISTENCE (only the deleted basenames flag, never
//          an existing script) + RETIRED-MECHANISM reference with an annotation exemption.
//          (The orchestration arm was widened from the dead *ROADMAP* glob to orchestration/*.md by
//          gap-stale-check-orchestration-arm-is-a-dead-glob, 2026-08-05 — AC1/AC2 below.)
//   AC3  — the default doc gate is wired into scripts/test.sh run_static_checks (asserted here as a
//          regression: the REAL repo's gate exits 0, i.e. no NEW stale doc beyond the baseline).
//   AC7  — this file uses node:test and declares // @test-group engine.
//   AC8  — pool-candidate mode judges ready-pool promotion candidates: an unannotated reference to a
//          deleted script flags the candidate. Regression control: gap-prepare-milestone-no-size-
//          aware-routing (references prepare-milestone.js / execute-milestone.js, both ADR-022-deleted)
//          MUST be flagged.
//
// No global counts are hardcoded: every assertion is relative to a fixture or to the AC8 specimen's
// own two known references.
//
// Run:
//   scripts/test.sh plugin/test/strategic-doc-staleness-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKER = path.join(REPO_ROOT, "plugin/scripts/strategic-doc-staleness-check.ts");

/** Run the checker with args; returns the spawnSync result (status + stdout). */
function run(...args) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", REPO_ROOT, ...args],
    { encoding: "utf8" },
  );
}

/** Run the checker against a temp workspace root (not the real repo). */
function runIn(root, ...args) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, ...args],
    { encoding: "utf8" },
  );
}

/** A temp workspace with docs/proposals + orchestration dirs. Cleaned in an after() hook. */
function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sds-check-"));
  fs.mkdirSync(path.join(dir, "docs", "proposals"), { recursive: true });
  fs.mkdirSync(path.join(dir, "orchestration"), { recursive: true });
  return dir;
}

test("AC8 — pool-candidate mode flags gap-prepare-milestone-no-size-aware-routing (genuine plain-text ref survives)", () => {
  // AC8 regression control (gap-judgepoolcandidate-keyword-vs-position, 2026-08-12): the task is
  // STILL flagged, but only via its GENUINE plain-text reference — line 31 "execute-milestone.js
  // touch; …" (a live reference to the ADR-022-deleted script). The backticked provenance-note hit
  // ("a real `prepare-milestone.js` ProposalReview run …") is a QUOTE, not a live reference, so the
  // position-not-keyword fix removes it — this assertion pins that the backticked class no longer
  // flags while the plain-text class still does (AC3/AC4: genuine retired-mechanism still blocked).
  const res = run("--pool-candidate", "gap-prepare-milestone-no-size-aware-routing", "--json");
  assert.equal(res.status, 1, `expected exit 1 (flagged), got ${res.status}:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.mode, "pool-candidate");
  assert.equal(out.flagged, true);
  const hits = out.refs.map((r) => r.hit);
  assert.ok(hits.includes("execute-milestone.js"), `expected execute-milestone.js hit, got ${hits}`);
  assert.ok(!hits.includes("prepare-milestone.js"), `backticked provenance-note hit must be gone, got ${hits}`);
});

test("AC8 — a candidate that mentions the deleted scripts ONLY under a strong ADR-022 annotation is clean", () => {
  // gap-establish-daily-review-cadence-mechanism (this task) names prepare-milestone.js /
  // execute-milestone.js in its Proposal, but every such line carries the strong marker
  // "ADR-022 已退休" — so the annotation rule keeps it clean. This proves the pool-candidate mode
  // does not flag a task that is ABOUT the retirement, only one that references deleted code as LIVE.
  const res = run("--pool-candidate", "gap-establish-daily-review-cadence-mechanism", "--json");
  assert.equal(res.status, 0, `expected clean, got ${res.status}:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.flagged, false);
});

test("POSITION-NOT-KEYWORD (gap-judgepoolcandidate-keyword-vs-position) — a provenance note quoting a deleted script in backticks is clean (DIR-103 repro)", () => {
  // DIR-103's false positive: the deleted script name appears in backticks inside a "Split …
  // ProposalReview run" provenance note (line 25) AND in a backticked Requested-action mention
  // (line 59) — both are QUOTES, not live references (the task's subject is the LIVE
  // acceptance-runner.ts). A mention inside an inline code span must not flag the candidate.
  const ws = makeWorkspace();
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "tasks", "DIR-103-like.md"),
    [
      "## Proposal",
      "",
      "Improve the acceptance runner's operability.",
      "",
      "**Split 2026-08-01 (DIR-026 SPLIT-OR-COMMIT):** a real `prepare-milestone.js`",
      "`ProposalReview` run against this task's Proposal returned needs-human.",
      "",
      "## Requested action",
      "",
      "Execute A; each is independently `prepare-milestone.js` + `execute-milestone.js` dispatched.",
      "",
    ].join("\n"),
  );
  const res = runIn(ws, "--pool-candidate", "DIR-103-like", "--json");
  assert.equal(res.status, 0, `backticked provenance/quote mentions must be clean, got ${res.status}:\n${res.stdout}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.flagged, false, `expected clean, got refs: ${JSON.stringify(out.refs)}`);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("POSITION-NOT-KEYWORD (gap-judgepoolcandidate-keyword-vs-position) — a PLAIN-TEXT deleted-script reference is still flagged (no over-strip)", () => {
  // The fix strips inline code spans ONLY. A plain-text reference to a deleted script (not inside
  // backticks) is still a live reference to a retired mechanism and must keep flagging (AC4: the
  // guard is not relaxed).
  const ws = makeWorkspace();
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "tasks", "genuine-retired.md"),
    "## Proposal\n\nTarget mechanism: prepare-milestone.js (live).\n",
  );
  const res = runIn(ws, "--pool-candidate", "genuine-retired", "--json");
  assert.equal(res.status, 1, `plain-text reference must flag, got ${res.status}:\n${res.stdout}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.flagged, true);
  assert.ok(out.refs.some((r) => r.hit === "prepare-milestone.js"), `expected prepare-milestone.js hit, got ${JSON.stringify(out.refs)}`);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("annotation rule — a strong retirement marker on the wrapped previous line suppresses", () => {
  const ws = makeWorkspace();
  const f = path.join(ws, "docs", "proposals", "annotated.md");
  fs.writeFileSync(
    f,
    "## Proposal\n\n但整篇建立在已废除的经典 milestone\n管线上——`prepare-milestone.js`/`execute-milestone.js`。\n",
  );
  const res = runIn(ws, "--judge", path.join("docs", "proposals", "annotated.md"), "--json");
  const out = JSON.parse(res.stdout);
  assert.equal(res.status, 0, `expected clean (strong marker on prev line), got ${res.status}:\n${res.stdout}`);
  assert.equal(out.flagged, false);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("annotation rule — a weak 'historical' marker only suppresses on the SAME line", () => {
  const ws = makeWorkspace();
  // Same line: "historical" is an annotation → clean.
  const same = path.join(ws, "docs", "proposals", "same-line.md");
  fs.writeFileSync(same, "The historical prepare-milestone.js pipeline is gone.\n");
  const r1 = runIn(ws, "--judge", path.join("docs", "proposals", "same-line.md"), "--json");
  assert.equal(r1.status, 0, `same-line 'historical' should suppress, got ${r1.status}`);
  assert.equal(JSON.parse(r1.stdout).flagged, false);

  // Adjacent line only: "historical" is too weak for the window → still stale.
  const adj = path.join(ws, "docs", "proposals", "adjacent.md");
  fs.writeFileSync(adj, "Some historical STATUS prose\nuses prepare-milestone.js today.\n");
  const r2 = runIn(ws, "--judge", path.join("docs", "proposals", "adjacent.md"), "--json");
  assert.equal(r2.status, 1, `adjacent-only 'historical' must NOT suppress, got ${r2.status}`);
  assert.equal(JSON.parse(r2.stdout).flagged, true);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("path existence — only the DELETED basenames flag, never an existing script", () => {
  const ws = makeWorkspace();
  const clean = path.join(ws, "docs", "proposals", "existing.md");
  // ready-pool-check.ts EXISTS in the live tree — referencing it is NOT a stale reference.
  fs.writeFileSync(clean, "The pool mechanism is plugin/scripts/ready-pool-check.ts.\n");
  const r = runIn(ws, "--judge", path.join("docs", "proposals", "existing.md"), "--json");
  assert.equal(r.status, 0, `existing-script reference must be clean, got ${r.status}`);
  assert.equal(JSON.parse(r.stdout).flagged, false);

  // execute-milestone.js was DELETED by ADR-022 — unannotated reference flags.
  const stale = path.join(ws, "docs", "proposals", "stale.md");
  fs.writeFileSync(stale, "Phase 2 deploys execute-milestone.js.\n");
  const r2 = runIn(ws, "--judge", path.join("docs", "proposals", "stale.md"), "--json");
  assert.equal(r2.status, 1, `deleted-script reference must flag, got ${r2.status}`);
  assert.equal(JSON.parse(r2.stdout).flagged, true);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("default doc gate — a NEW stale strategic doc reddens the gate; restore greens it", () => {
  const ws = makeWorkspace();
  // GREEN baseline: only a clean doc.
  fs.writeFileSync(path.join(ws, "docs", "proposals", "clean.md"), "# Clean\n\nReferences only the fast mode.\n");
  const r0 = runIn(ws);
  assert.equal(r0.status, 0, `clean baseline should pass, got ${r0.status}:\n${r0.stdout}`);

  // INJECT a NEW stale doc (not in the KNOWN_STALE baseline) → RED.
  fs.writeFileSync(path.join(ws, "docs", "proposals", "fresh-stale.md"), "# Fresh\n\nUses prepare-milestone.js.\n");
  const r1 = runIn(ws, "--json");
  const out1 = JSON.parse(r1.stdout);
  assert.equal(r1.status, 1, `new stale doc must redden the gate, got ${r1.status}`);
  assert.equal(out1.stale_refs_found, 1, `expected 1 new stale ref, got ${out1.stale_refs_found}`);
  assert.equal(out1.new_stale_docs.length, 1);

  // RESTORE: remove the stale doc → GREEN again.
  fs.rmSync(path.join(ws, "docs", "proposals", "fresh-stale.md"));
  const r2 = runIn(ws, "--json");
  assert.equal(r2.status, 0, `restored tree should pass, got ${r2.status}`);
  assert.equal(JSON.parse(r2.stdout).stale_refs_found, 0);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("AC1 — orchestration arm covers orchestration/*.md: the dead *ROADMAP* glob is gone", () => {
  const src = fs.readFileSync(CHECKER, "utf8");
  // The dead glob must not return (gap-stale-check-orchestration-arm-is-a-dead-glob).
  assert.ok(!src.includes('includes("ROADMAP")'), "dead orchestration *ROADMAP* glob must be gone");
  // The orchestration arm must iterate every .md under orchestration/ (not a single filename pattern).
  const m = src.match(/const orchDir = path\.join\(root, "orchestration"\);[\s\S]*?return files\.sort\(\);/);
  assert.ok(m, "collectStrategicDocs orchestration arm block not found");
  assert.ok(m[0].includes('e.endsWith(".md")'), "orchestration arm must match all .md, not a single filename pattern");
});

test("AC2 — a stale SPEC-* orchestration doc is now detected (dead glob eliminated)", () => {
  const ws = makeWorkspace();
  // SPEC-* is the orchestration naming convention the *ROADMAP* glob NEVER matched. A stale ref
  // there must redden the gate now that the arm covers orchestration/*.md.
  fs.writeFileSync(path.join(ws, "orchestration", "SPEC-foo.md"), "# SPEC\n\nUses prepare-milestone.js.\n");
  const r = runIn(ws, "--json");
  assert.equal(r.status, 1, `SPEC-* stale ref must redden the gate, got ${r.status}:\n${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.stale_refs_found, 1, `expected 1 new stale ref, got ${out.stale_refs_found}`);
  assert.equal(out.new_stale_docs.length, 1);
  assert.ok(
    out.new_stale_docs[0].rel.startsWith("orchestration/"),
    `rel must be under orchestration/, got ${out.new_stale_docs[0].rel}`,
  );
  fs.rmSync(ws, { recursive: true, force: true });
});

test("AC2 — a clean orchestration/SPEC-* doc keeps the gate green (no false positive)", () => {
  const ws = makeWorkspace();
  fs.writeFileSync(path.join(ws, "orchestration", "SPEC-clean.md"), "# SPEC\n\nReferences only the fast mode.\n");
  const r = runIn(ws, "--json");
  assert.equal(r.status, 0, `clean SPEC-* doc must stay green, got ${r.status}:\n${r.stdout}`);
  assert.equal(JSON.parse(r.stdout).stale_refs_found, 0);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("AC3 — the REAL repo's default gate passes (no NEW stale doc beyond the baseline)", () => {
  const res = run("--json");
  assert.equal(res.status, 0, `real-repo gate must pass, got ${res.status}:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.stale_refs_found, 0, `expected 0 NEW stale refs on the real repo, got ${out.stale_refs_found}`);
  // The baseline itself must be reported (audit trail) — at least the roadmap doc.
  const known = out.known_stale_docs.map((d) => d.rel);
  assert.ok(
    known.some((rel) => rel.includes("quay-harness-crystallization-roadmap")),
    `roadmap doc must be reported as known-stale, got ${known}`,
  );
});
