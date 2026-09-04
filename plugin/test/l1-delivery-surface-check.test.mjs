// @test-group engine
// l1-delivery-surface-check.test.mjs — gap-complete-delivery-surface-spec-and-l1-verification.
// Tests for plugin/scripts/l1-delivery-surface-check.ts — the SIX-category L1 delivery-completeness
// check.
//
// Coverage map (task ACs):
//   AC1 — the SPEC (orchestration/SPEC-complete-delivery-surface-2026-08-05.md) is the LIVE
//         six-category single source: exactly six `<!-- l1-category: … -->` machine-readable
//         markers, each declaring deliverables + owning task.
//   AC2 — the L1 check extends the delivery surface to ALL SIX categories: against the real repo
//         it reports 6/6; per-category fixtures (removing a category's deliverable) MUST drop the
//         covered count below 6 and NAME the missing deliverable (the Contract control).
//   AC4 — no holes: removing a category's owning task file MUST drop the count below 6 and name the
//         missing task (every gap resolves to a filed task).
//   AC5 — quay-init wiring: the L1 check ships in the derived laydown set and is invoked post-
//         laydown beside verify_referenced_landed (runnable before AND after install).
//   AC3 — the three L2 continuous-health categories (语义一致 / 升级正确性 / 三层完整性) are
//         carried by gap-quality-criteria-are-point-in-time-no-trend-criteria (cross-annotation).
//   AC7 — this file is node:test + // @test-group engine.
//
// Run:
//   scripts/test.sh plugin/test/l1-delivery-surface-check.test.mjs
//   node --test plugin/test/l1-delivery-surface-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugin");
const SCRIPTS_DIR = path.join(PLUGIN_DIR, "scripts");
const CLI = path.join(SCRIPTS_DIR, "l1-delivery-surface-check.ts");
const SPEC = path.join(REPO_ROOT, "orchestration", "SPEC-complete-delivery-surface-2026-08-05.md");
const SPEC_BASENAME = "SPEC-complete-delivery-surface-2026-08-05.md";


function runCli(root, spec) {
  const args = ["--no-warnings", "--experimental-strip-types", CLI, "--surface", "--root", root];
  if (spec) args.push("--spec", spec);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function parseCovered(stdout, stderr = "") {
  const m = /surface-categories-covered: (\d+)\/(\d+)/.exec(stdout);
  if (!m) throw new Error(`no covered line in stdout: ${JSON.stringify(stdout)} / stderr: ${JSON.stringify(stderr)}`);
  return { covered: Number(m[1]), total: Number(m[2]) };
}

function parseDetail(stdout) {
  const lines = stdout.split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

/** The task files the SPEC's six markers reference (AC4 no-holes fixture). */
const OWNING_TASKS = [
  "gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down",
  "gap-productize-the-manager-layer",
  "gap-crystallize-launch-config-into-checked-in-settings-file",
  "gap-tmux-session-topology-no-factory-definition",
  "gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash",
  "gap-quality-criteria-are-point-in-time-no-trend-criteria",
];

/** A minimal delivery-surface root: plugin/ + the owning tasks + launch settings + the SPEC. */
function makeFixtureRoot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l1-surface-"));
  fs.cpSync(PLUGIN_DIR, path.join(tmp, "plugin"), { recursive: true });
  // R7 test-isolation: write targets must resolve through a per-run-unique (tmp) root — the write
  // goes to `path.join(tmp, "tasks", …)`, never a live `tasks/` dir. The SOURCE read from the repo
  // is data, not a write target.
  fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
  for (const t of OWNING_TASKS) {
    fs.writeFileSync(path.join(tmp, "tasks", `${t}.md`), fs.readFileSync(path.join(REPO_ROOT, "tasks", `${t}.md`)));
  }
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, ".claude", "launch.settings.json"), path.join(tmp, ".claude", "launch.settings.json"));
  // R7: .quay is a live data dir (runtime state) — do NOT copy from REPO_ROOT/.quay; write a stub.
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".quay", "profiles.yml"), "version: 1\n");
  fs.mkdirSync(path.join(tmp, "orchestration"), { recursive: true });
  fs.copyFileSync(SPEC, path.join(tmp, "orchestration", SPEC_BASENAME));
  return tmp;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── AC1 — the SPEC is the LIVE six-category single source ────────────────────────────────────────
test("AC1 — the SPEC declares exactly six machine-readable categories (live single source, spec_is_live)", () => {
  const spec = fs.readFileSync(SPEC, "utf8");
  const markers = spec.match(/<!--\s*l1-category:\s*([^>]*?)\s*-->/g) ?? [];
  const numbered = markers.filter((m) => {
    const body = m.replace(/<!--\s*l1-category:\s*/, "").replace(/\s*-->$/, "");
    const first = body.split(";")[0].trim();
    return /^\d+$/.test(first) || /^id:\s*\d+$/.test(first);
  });
  assert.equal(numbered.length, 6, "the SPEC must declare exactly six categories");
  // Each marker must carry at least one deliverable AND an owning task (AC4: no holes).
  for (const m of numbered) {
    assert.match(m, /deliverable:/, "every category marker must declare a deliverable");
    assert.match(m, /task:/, "every category marker must declare an owning task");
  }
});

// ── AC2 — the L1 check covers all six categories against the real delivery surface ────────────────
test("AC2 — the L1 check reports 6/6 against the real delivery surface (six-category full coverage)", () => {
  const r = runCli(REPO_ROOT);
  assert.equal(r.status, 0, `l1 check must exit 0 against the repo:\n${r.stderr}`);
  const { covered, total } = parseCovered(r.stdout);
  assert.equal(total, 6, "the SPEC must declare exactly six categories");
  assert.equal(covered, 6, "all six categories must be covered (band 6)");
});

// ── AC2 per-category fixtures — removing a category's deliverable MUST drop the count ─────────────
test("AC2 — removing a category deliverable drops the covered count and names it (per-category fixture)", () => {
  const base = parseDetail(runCli(REPO_ROOT).stdout);
  for (const c of base.categories) {
    const tmp = makeFixtureRoot();
    try {
      // Remove the first deliverable that is NOT the SPEC itself (removing the SPEC would make the
      // check's single source undefined — the category-6 control removes a mechanism deliverable instead).
      const deliv = c.category.deliverables.find((d) => path.posix.basename(d) !== SPEC_BASENAME);
      assert.ok(deliv, `category ${c.category.id} must have a non-SPEC deliverable to remove`);
      const abs = path.resolve(tmp, deliv);
      assert.ok(fs.existsSync(abs), `fixture must contain deliverable ${deliv}`);
      fs.rmSync(abs, { recursive: true, force: true });
      const r = runCli(tmp);
      if (r.status === 0) {
        // diagnostic on unexpected pass
        throw new Error(`expected FAIL for ${deliv} but got status 0: ${r.stdout} / ${r.stderr}`);
      }
      const { covered, total } = parseCovered(r.stdout, r.stderr);
      assert.equal(total, 6, "still six categories declared");
      assert.ok(covered < 6, `covered must drop below 6 when ${deliv} is removed`);
      assert.match(r.stderr, escapeRe(deliv), "must name the missing deliverable");
    } finally { cleanup(tmp); }
  }
});

// ── AC4 no-holes — removing an owning task MUST drop the count ────────────────────────────────────
test("AC4 — removing a category's owning task file drops the covered count and names it (no holes)", () => {
  const base = parseDetail(runCli(REPO_ROOT).stdout);
  const withTask = base.categories.filter((c) => c.category.task);
  assert.ok(withTask.length >= 5, "at least the five gap categories must carry an owning task");
  for (const c of withTask) {
    const tmp = makeFixtureRoot();
    try {
      const taskId = c.category.task;
      const taskPath = path.join(tmp, "tasks", `${taskId}.md`);
      assert.ok(fs.existsSync(taskPath), `fixture must contain task ${taskId}`);
      fs.rmSync(taskPath, { force: true });
      const r = runCli(tmp);
      assert.notEqual(r.status, 0,
        `category ${c.category.id} (${c.category.name}) must FAIL when task ${taskId} is missing`);
      const { covered, total } = parseCovered(r.stdout);
      assert.equal(total, 6);
      assert.ok(covered < 6, "covered must drop below 6 when an owning task is missing");
      assert.match(r.stderr, escapeRe(taskId), "must name the missing owning task");
    } finally { cleanup(tmp); }
  }
});

// ── AC2/AC5 — the check is runnable BEFORE install (repo) AND the quay-init wiring runs it post-laydown ──
test("AC5 — quay-init wiring: the L1 check ships in the derived set and is invoked beside verify_referenced_landed", () => {
  const qinit = fs.readFileSync(path.join(SCRIPTS_DIR, "quay-init.sh"), "utf8");
  // The (c) explicit additions must ship the check with the loop (装后能跑).
  const explicitBlock = qinit.slice(qinit.indexOf("derive_loop_scripts"), qinit.indexOf("sort -u \"$out\" -o \"$out\""));
  assert.match(explicitBlock, /l1-delivery-surface-check\.ts/, "the derived laydown set must ship the L1 check");
  // The post-laydown verification must invoke it in --surface mode beside verify_referenced_landed.
  assert.match(qinit, /verify_referenced_landed/, "the wiring sits beside verify_referenced_landed (category 1)");
  assert.match(qinit, /l1_script/, "quay-init must invoke the L1 check (via its resolved script path)");
  assert.match(qinit, /--surface/, "quay-init must invoke the L1 check in --surface mode");
});

// ── AC3 — the three L2 continuous-health categories are carried by the trend-criteria task ────────
test("AC3 — 语义一致 / 升级正确性 / 三层完整性 are carried by gap-quality-criteria-are-point-in-time-no-trend-criteria", () => {
  const t = fs.readFileSync(
    path.join(REPO_ROOT, "tasks", "gap-quality-criteria-are-point-in-time-no-trend-criteria.md"), "utf8");
  for (const k of ["语义一致", "升级正确性", "三层完整性"]) {
    assert.ok(t.includes(k), `the L2 carrier task must carry the ${k} continuous-health category`);
  }
});

function escapeRe(s) {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

