// @test-group governance
// delivery-inventory-drift-gate.test.mjs — unit tests for the plugin/workflows mirror gate
// (gap-drift-gate-covers-only-plugin-scripts-not-workflows AC2 + Contract invariants).
//
// The gate answers: "Did this change ADD/DELETE a file under .claude/workflows/ WITHOUT touching the
// plugin/workflows/ mirror in the same change?" — the r265 root cause was a NEW workflow
// (execute-suite-fix.js, pool-quality-judge.js) added to .claude/workflows/ without a mirror.
// The ORIGINAL outline-snapshot trigger (plugin/scripts A/D without updating the outline §6
// DELIVERY-INVENTORY snapshot — gap-delivery-inventory-drift-needs-file-add-gate, the 2026-08-10 red
// family) is RETIRED (gap-delivery-inventory-check-time-computation): the inventory is computed at
// check time, so there is no snapshot for a script A/D to co-touch.
//
// Coverage map (task ACs + Contract):
//   AC2 (workflows) — .claude/workflows A/D ⇒ the same change set must touch plugin/workflows/
//         (the mirror); FAIL-closed. Exercised on the WORKING-TREE surface (a new untracked
//         workflow without a mirror → exit 1) AND the COMMITTED surface (a committed workflow
//         deletion without a mirror deletion → exit 1).
//   Contract invariant new_workflow_requires_mirror = 1 — add a .claude/workflows file ⇒ same-change
//         plugin/workflows mirror touch, else FAIL. (RED test.)
//   Contract invariant content_only_change_skipped = 1 (workflows) — editing an existing workflow's
//         content does NOT trigger. (GREEN test.)
//   workflow_mirror_alongside — add a workflow + mirror it in the same change ⇒ PASS.
//
// Run:
//   scripts/test.sh plugin/test/delivery-inventory-drift-gate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GATE = path.join(REPO_ROOT, "plugin", "scripts", "delivery-inventory-drift-gate.sh");

// Governance self-skip (AC7 @test-group governance, ADR-019 decision #1): in a DEFAULT
// (product,engine) run this file reports `skipped`, not absent — QUAY_TEST_GROUPS is set to
// product,engine on the default path, so the real tests run only with `--group governance`
// or in the explicit-file form (QUAY_TEST_GROUPS unset).
const GOV_SKIP_REASON =
  process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")
    ? "set QUAY_TEST_GROUPS=governance to run"
    : false;
function t(name, fn) {
  test(name, GOV_SKIP_REASON ? { skip: GOV_SKIP_REASON } : {}, fn);
}

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
  return r.stdout.trim();
}

/** Build a temp GIT repo with one committed mirrored workflow pair, committed. */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inv-drift-gate-"));
  fs.mkdirSync(path.join(root, ".claude", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "workflows"), { recursive: true });
  // Committed mirrored workflow pair — the .claude/workflows/ canonical source + plugin/workflows/ mirror.
  fs.writeFileSync(
    path.join(root, ".claude", "workflows", "existing-wf.js"),
    'export const meta = { name: "existing-wf" };\n'
  );
  fs.writeFileSync(
    path.join(root, "plugin", "workflows", "existing-wf.js"),
    'export const meta = { name: "existing-wf" };\n'
  );
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@test");
  git(root, "config", "user.name", "t");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "baseline");
  return root;
}

/** Run the gate against a root with the committed range pinned empty (working-tree surface). */
function runGate(root, extraArgs = []) {
  const res = spawnSync("bash", [GATE, "--root", root, "--base", "HEAD", ...extraArgs], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// ── workflows trigger (gap-drift-gate-covers-only-plugin-scripts-not-workflows, AC2) ──────────────

const WF_CANONICAL = path.join(".claude", "workflows");
const WF_MIRROR = path.join("plugin", "workflows");

t("GREEN — a clean tree with no .claude/workflows A/D passes", () => {
  const root = makeRepo();
  try {
    const r = runGate(root);
    assert.equal(r.status, 0, `clean tree must pass:\n${r.stderr}`);
  } finally { rmrf(root); }
});

t("RED — a NEW .claude/workflows file without a plugin/workflows mirror fails FAIL-closed (new_workflow_requires_mirror)", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, WF_CANONICAL, "foo-new.js"), 'export const meta = { name: "foo-new" };\n');
    const r = runGate(root);
    assert.equal(r.status, 1, "workflow addition without mirror must fail (FAIL-closed)");
    assert.match(r.stderr, /plugin\/workflows|mirror/, "the failure must name the plugin/workflows mirror");
  } finally { rmrf(root); }
});

t("RED — a committed .claude/workflows DELETION without a mirror deletion fails (committed path)", () => {
  const root = makeRepo();
  try {
    fs.rmSync(path.join(root, WF_CANONICAL, "existing-wf.js"));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "delete workflow without mirror");
    const res = spawnSync("bash", [GATE, "--root", root, "--base", "HEAD~1"], { encoding: "utf8" });
    assert.equal(res.status, 1, "committed workflow deletion without mirror deletion must fail");
    assert.match(res.stdout + res.stderr, /plugin\/workflows|mirror/);
  } finally { rmrf(root); }
});

t("GREEN — a content-only edit to an existing workflow does NOT trigger (content_only_change_skipped)", () => {
  const root = makeRepo();
  try {
    fs.appendFileSync(path.join(root, WF_CANONICAL, "existing-wf.js"), "\n// changed\n");
    const r = runGate(root);
    assert.equal(r.status, 0, "workflow content-only edit must not trigger");
  } finally { rmrf(root); }
});

t("GREEN — a NEW workflow WITH a plugin/workflows mirror in the same change passes (workflow_mirror_alongside)", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, WF_CANONICAL, "bar-new.js"), 'export const meta = { name: "bar-new" };\n');
    fs.writeFileSync(path.join(root, WF_MIRROR, "bar-new.js"), 'export const meta = { name: "bar-new" };\n');
    const r = runGate(root);
    assert.equal(r.status, 0, "workflow addition WITH mirror must pass");
  } finally { rmrf(root); }
});

t("GREEN — a DELETION of a workflow WITH its mirror deleted in the same change passes", () => {
  const root = makeRepo();
  try {
    fs.rmSync(path.join(root, WF_CANONICAL, "existing-wf.js"));
    fs.rmSync(path.join(root, WF_MIRROR, "existing-wf.js"));
    const r = runGate(root);
    assert.equal(r.status, 0, "workflow deletion WITH mirror deletion must pass");
  } finally { rmrf(root); }
});

// gap-select-preflight-retirement-decision (2026-08-16): the gate's workflows trigger assumes every
// deleted workflow HAD a mirror. A legacy workflow that predates the plugin/workflows/ mirror
// convention (select-preflight.js) was NEVER mirrored — its deletion leaves no stale mirror, so the
// deletion must NOT be structural (no mirror touch required). ADDITIONS still always require a
// mirror (new_workflow_requires_mirror stays FAIL-closed), and a deletion whose mirror exists at
// base still fails if the mirror is not deleted in the same change (pinned above).
t("GREEN — DELETION of a legacy .claude/workflows file that NEVER had a plugin/workflows mirror passes (no stale mirror to remove)", () => {
  const root = makeRepo();
  try {
    // Add a legacy unmirrored workflow in its own baseline commit (canonical only, no mirror).
    fs.writeFileSync(path.join(root, WF_CANONICAL, "legacy-wf.js"), 'export const meta = { name: "legacy-wf" };\n');
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "add legacy unmirrored workflow baseline");
    // Delete it WITHOUT touching plugin/workflows/ — there is no mirror to delete.
    fs.rmSync(path.join(root, WF_CANONICAL, "legacy-wf.js"));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "delete legacy unmirrored workflow");
    const res = spawnSync("bash", [GATE, "--root", root, "--base", "HEAD~1"], { encoding: "utf8" });
    assert.equal(res.status, 0, `legacy unmirrored workflow deletion must pass (no stale mirror):\n${res.stderr}`);
    assert.match(res.stdout, /PASS/);
  } finally { rmrf(root); }
});

// ── non-git fail-open ──────────────────────────────────────────────────────────────────────────────

t("GREEN — a non-git root is skipped (fail-open: no change set to evaluate)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inv-drift-gate-nogit-"));
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "x.sh"), "echo x\n");
    const r = runGate(root);
    assert.equal(r.status, 0, "non-git root must be skipped, not failed");
    assert.match(r.stdout, /not a git worktree/);
  } finally { rmrf(root); }
});
