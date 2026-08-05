// @test-group governance
// strategic-doc-staleness-check.test.mjs — tasks/gap-establish-daily-review-cadence-mechanism
// (AC2/AC3/AC7/AC8): the generic strategic-document staleness checker.
//
// Coverage map (task ACs):
//   AC2  — the checker scans docs/proposals + orchestration/*ROADMAP* for references to the
//          classic-pipeline script files ADR-022 deleted (prepare-milestone.js, execute-milestone.js,
//          milestone-worktree.ts), judged by PATH EXISTENCE (only the deleted basenames flag, never
//          an existing script) + RETIRED-MECHANISM reference with an annotation exemption.
//   AC3  — the default doc gate is wired into scripts/test.sh run_static_checks (asserted here as a
//          regression: the REAL repo's gate exits 0, i.e. no NEW stale doc beyond the baseline).
//   AC7  — this file uses node:test and declares // @test-group governance.
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

test("AC8 — pool-candidate mode flags gap-prepare-milestone-no-size-aware-routing", () => {
  const res = run("--pool-candidate", "gap-prepare-milestone-no-size-aware-routing", "--json");
  assert.equal(res.status, 1, `expected exit 1 (flagged), got ${res.status}:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.mode, "pool-candidate");
  assert.equal(out.flagged, true);
  const hits = out.refs.map((r) => r.hit);
  assert.ok(hits.includes("prepare-milestone.js"), `expected prepare-milestone.js hit, got ${hits}`);
  assert.ok(hits.includes("execute-milestone.js"), `expected execute-milestone.js hit, got ${hits}`);
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
