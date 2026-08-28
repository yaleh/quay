// @test-group engine
// delivery-inventory-drift-gate.test.mjs — unit tests for the file-set change gate
// (gap-delivery-inventory-drift-needs-file-add-gate, AC2/AC4 + gap-drift-gate-covers-only-plugin-
// scripts-not-workflows AC2 + Contract invariants).
//
// The gate answers: "Did this change ADD/DELETE a file under plugin/scripts/ WITHOUT updating the
// outline §6 DELIVERY-INVENTORY snapshot in the same change?" — the 2026-08-10 red family
// (r216/r222/r223/r226/r248/r253) fixed at the ROOT CAUSE instead of the symptom (7d2faf06). And,
// since gap-drift-gate-covers-only-plugin-scripts-not-workflows (2026-08-11, r265 red M143/AC9/C6):
// "did this change ADD/DELETE a file under .claude/workflows/ WITHOUT touching the plugin/workflows/
// mirror in the same change?" — the r265 root cause was a NEW workflow (execute-suite-fix.js,
// pool-quality-judge.js) added to .claude/workflows/ without a plugin/workflows/ mirror.
//
// Coverage map (task ACs + Contract):
//   AC2 — candidate B: `--diff-filter=AD` on plugin/scripts ⇒ the same change set must update the
//         outline; FAIL-closed. Exercised via the WORKING-TREE surface (a new untracked script
//         without an outline update → exit 1) AND the COMMITTED surface (a committed deletion
//         without an outline update → exit 1).
//   Contract invariant new_script_requires_outline = 1 — add a script ⇒ same-change outline update,
//         else FAIL. (RED test.)
//   Contract invariant content_only_change_skipped = 1 — editing an existing script's content does
//         NOT trigger. (GREEN test.)
//   outline_updated_alongside — add a script + update the outline in the same change ⇒ PASS.
//   AC2 (workflows) — .claude/workflows A/D ⇒ the same change set must touch plugin/workflows/
//         (the mirror); FAIL-closed. Exercised on the WORKING-TREE surface (a new untracked
//         workflow without a mirror → exit 1) AND the COMMITTED surface (a committed workflow
//         deletion without a mirror deletion → exit 1).
//   Contract invariant new_workflow_requires_mirror = 1 — add a .claude/workflows file ⇒ same-change
//         plugin/workflows mirror touch, else FAIL. (RED test.)
//   Contract invariant content_only_change_skipped = 1 (workflows) — editing an existing workflow's
//         content does NOT trigger. (GREEN test.)
//   workflow_mirror_alongside — add a workflow + mirror it in the same change ⇒ PASS.
//   AC3 — existing verify-delivery-surface tests are not broken (run separately via the task's
//         ## Test-Files declaration; this file does not duplicate them).
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
const OUTLINE_REL = path.join("docs", "proposals", "quay-product-outline.md");

function t(name, fn) {
  test(name, fn);
}

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
  return r.stdout.trim();
}

/** Build a temp GIT repo with an outline snapshot (scripts=1) + one existing script, committed. */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inv-drift-gate-"));
  fs.mkdirSync(path.join(root, "docs", "proposals"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "workflows"), { recursive: true });
  fs.writeFileSync(
    path.join(root, OUTLINE_REL),
    "# outline\n\n<!-- DELIVERY-INVENTORY-BEGIN -->\nscripts=1\n<!-- DELIVERY-INVENTORY-END -->\n"
  );
  fs.writeFileSync(path.join(root, "plugin", "scripts", "existing.sh"), "#!/usr/bin/env bash\necho existing\n");
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

// ── AC2 / new_script_requires_outline ──────────────────────────────────────────────────────────────

t("GREEN — a clean tree with no plugin/scripts A/D passes", () => {
  const root = makeRepo();
  try {
    const r = runGate(root);
    assert.equal(r.status, 0, `clean tree must pass:\n${r.stderr}`);
    assert.match(r.stdout, /PASS/);
  } finally { rmrf(root); }
});

t("RED — a NEW plugin/scripts file without an outline update fails FAIL-closed (new_script_requires_outline)", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "plugin", "scripts", "foo-new.sh"), "#!/usr/bin/env bash\necho new\n");
    const r = runGate(root);
    assert.equal(r.status, 1, "script addition without outline update must fail (FAIL-closed)");
    assert.match(r.stderr, /DELIVERY-INVENTORY|quay-product-outline/, "the failure must name the outline snapshot");
  } finally { rmrf(root); }
});

t("RED — a staged NEW plugin/scripts file (git add) without an outline update also fails", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "plugin", "scripts", "staged-new.sh"), "#!/usr/bin/env bash\necho staged\n");
    git(root, "add", "plugin/scripts/staged-new.sh");
    const r = runGate(root);
    assert.equal(r.status, 1, "staged addition without outline update must fail (A status is structural)");
  } finally { rmrf(root); }
});

t("GREEN — a NEW file under plugin/scripts/checker-mutation-cases/ does NOT trigger (fixture, not a shipped script; the snapshot counts top-level entries only — gap-checker-mutation-cases-4-checkers)", () => {
  const root = makeRepo();
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts", "checker-mutation-cases"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "plugin", "scripts", "checker-mutation-cases", "cap-counts-subagents-check.sh"),
      "#!/usr/bin/env bash\necho fixture\n"
    );
    const r = runGate(root);
    assert.equal(r.status, 0, `mutation-case fixture must NOT be structural:\n${r.stderr}`);
    assert.match(r.stdout, /PASS/);
  } finally { rmrf(root); }
});

t("RED — a committed plugin/scripts DELETION without an outline update fails (committed path)", () => {
  const root = makeRepo();
  try {
    fs.rmSync(path.join(root, "plugin", "scripts", "existing.sh"));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "delete script without outline");
    // Committed range must be the previous commit (--base HEAD would be an empty range now).
    const res = spawnSync("bash", [GATE, "--root", root, "--base", "HEAD~1"], { encoding: "utf8" });
    assert.equal(res.status, 1, "committed deletion without outline update must fail");
    assert.match(res.stdout + res.stderr, /DELIVERY-INVENTORY|quay-product-outline/);
  } finally { rmrf(root); }
});

// ── content_only_change_skipped ────────────────────────────────────────────────────────────────────

t("GREEN — a content-only edit to an existing script does NOT trigger (content_only_change_skipped)", () => {
  const root = makeRepo();
  try {
    fs.appendFileSync(path.join(root, "plugin", "scripts", "existing.sh"), "\necho changed\n");
    const r = runGate(root);
    assert.equal(r.status, 0, "content-only edit must not trigger candidate B");
  } finally { rmrf(root); }
});

t("GREEN — a content-only edit with NO outline change and a committed-only change passes", () => {
  const root = makeRepo();
  try {
    fs.appendFileSync(path.join(root, "plugin", "scripts", "existing.sh"), "\necho changed\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "content edit only");
    const res = spawnSync("bash", [GATE, "--root", root, "--base", "HEAD~1"], { encoding: "utf8" });
    assert.equal(res.status, 0, "committed content-only edit must not trigger (M status is not structural)");
  } finally { rmrf(root); }
});

// ── outline_updated_alongside ──────────────────────────────────────────────────────────────────────

t("GREEN — a NEW script WITH an outline update in the same change passes", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "plugin", "scripts", "bar-new.sh"), "#!/usr/bin/env bash\necho bar\n");
    const outlinePath = path.join(root, OUTLINE_REL);
    fs.writeFileSync(outlinePath, fs.readFileSync(outlinePath, "utf8").replace("scripts=1", "scripts=2"));
    const r = runGate(root);
    assert.equal(r.status, 0, "script addition WITH outline update must pass");
  } finally { rmrf(root); }
});

t("GREEN — a DELETION WITH an outline update in the same change passes", () => {
  const root = makeRepo();
  try {
    fs.rmSync(path.join(root, "plugin", "scripts", "existing.sh"));
    const outlinePath = path.join(root, OUTLINE_REL);
    fs.writeFileSync(outlinePath, fs.readFileSync(outlinePath, "utf8").replace("scripts=1", "scripts=0"));
    const r = runGate(root);
    assert.equal(r.status, 0, "script deletion WITH outline update must pass");
  } finally { rmrf(root); }
});

t("GREEN — a committed script ADD + outline MODIFY in the same commit passes (outline touched via M, not A/D)", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "plugin", "scripts", "committed-new.sh"), "#!/usr/bin/env bash\necho committed\n");
    const outlinePath = path.join(root, OUTLINE_REL);
    fs.writeFileSync(outlinePath, fs.readFileSync(outlinePath, "utf8").replace("scripts=1", "scripts=2"));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "script add + outline modify in one commit");
    // Committed range = HEAD~1..HEAD: the outline appears as M (not A/D) — a --diff-filter=AD-only
    // committed scan would MISS it (the 2026-08-10 post-commit regression this test pins).
    const res = spawnSync("bash", [GATE, "--root", root, "--base", "HEAD~1"], { encoding: "utf8" });
    assert.equal(res.status, 0, "committed script-add + outline-modify must pass (outline touched via M status)");
  } finally { rmrf(root); }
});

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
