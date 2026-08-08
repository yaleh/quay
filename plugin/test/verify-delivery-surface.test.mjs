// @test-group governance
// verify-delivery-surface.test.mjs — L1 six-category delivery-completeness check
// (gap-complete-delivery-surface-spec-and-l1-verification, AC2/AC5).
//
// Coverage map (task ACs + Contract):
//   AC2  — the L1 check extends to all six categories: `--surface` reports
//          surface_categories_covered=N/6; every category's deliverables must exist
//          under the checked root (before-install = the bundle, after-install = a laid
//          down target). The Contract control "任一类无交付物 ⇒ L1 必报缺；补齐 ⇒ 6/6"
//          is exercised per-category (each category's deliverables removed → reported
//          MISSING; complete fixture → 6/6).
//   Contract invariant spec_is_live = 1 — the SPEC doc's L1-MANIFEST block must match the
//          executable manifest; a drifted doc → spec_is_live=0.
//   AC4  — attribution holes are reported: a category whose owning task is absent is
//          surfaced (attributionHoles), so the six-category attribution is resolvable.
//   AC5  — this file uses node:test and declares // @test-group governance.
//
// Run:
//   scripts/test.sh plugin/test/verify-delivery-surface.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir) {
  // Worktree-safe: the main checkout AND task worktrees have package.json + plugin/ + scripts/test.sh;
  // .quay/config.yml is gitignored so a fresh worktree lacks it.
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (
      fs.existsSync(path.join(dir, "package.json")) &&
      fs.existsSync(path.join(dir, "plugin")) &&
      fs.existsSync(path.join(dir, "scripts", "test.sh"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root from " + startDir);
}

const REPO_ROOT = findRepoRoot(__dirname);
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "verify-delivery-surface.ts");
const SPEC_DOC = path.join(REPO_ROOT, "orchestration", "SPEC-complete-delivery-surface-2026-08-05.md");

// ── Script runner + module import (same pattern as build-evidence-manifest.test.mjs) ────────────────

let MOD;
async function mod() {
  if (!MOD) MOD = await import(SCRIPT);
  return MOD;
}

function runScript(args = [], opts = {}) {
  const cwd = opts.cwd || REPO_ROOT;
  try {
    const stdout = execFileSync(
      "node",
      ["--experimental-strip-types", SCRIPT, ...args],
      { cwd, encoding: "utf8", timeout: 30_000 }
    );
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status ?? 1, stdout: (e.stdout ?? "").toString(), stderr: (e.stderr ?? "").toString() };
  }
}

// ── Fixture builder ────────────────────────────────────────────────────────────────────────────────
// A "complete" workspace fixture carries every category's deliverables at the manifest's relative
// paths, the SPEC doc's L1-MANIFEST block, and every attribution task under tasks/. Scratch lives in
// os.tmpdir() (test-isolation R1/R7: per-run-unique root, never the shared checkout).

function buildFixture(manifest, specDocText) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "l1-surface-"));
  for (const cat of manifest) {
    for (const d of cat.deliverables) {
      const p = path.join(base, d);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "");
    }
    for (const t of cat.attribution) {
      const p = path.join(base, "tasks", `${t}.md`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `---\nid: ${t}\nstatus: todo\n---\n`);
    }
  }
  if (specDocText) {
    const p = path.join(base, "orchestration", "SPEC-complete-delivery-surface-2026-08-05.md");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, specDocText);
  }
  return base;
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// Remove every deliverable file of one category from a fixture root.
function removeCategoryDeliverables(root, cat) {
  for (const d of cat.deliverables) {
    const p = path.join(root, d);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
}

// ── AC1/AC2: the real bundle (before-install) covers all six categories ────────────────────────────

test("AC2 — the real bundle root reports 6/6 covered and spec_is_live=1 (before-install)", async () => {
  const m = await mod();
  assert.equal(m.MANIFEST.length, 6, "manifest must declare exactly six categories");
  const r = runScript(["--surface", "--root", REPO_ROOT]);
  assert.equal(r.status, 0, `bundle root must pass:\n${r.stderr ?? ""}\n${r.stdout}`);
  assert.match(r.stdout, /surface_categories_covered=6\/6/, "bundle root must report 6/6");
  assert.match(r.stdout, /spec_is_live=1/, "bundle root's SPEC doc must match the executable manifest");
});

test("AC2 — the default root (no --root) resolves the bundle in a worktree and reports 6/6", async () => {
  // findRepoRoot walks up from the script's own dir (package.json + plugin/ + scripts/test.sh
  // sentinel — worktree-safe, since .quay/config.yml is gitignored in a fresh worktree).
  const r = runScript(["--surface"]);
  assert.equal(r.status, 0, `default-root run must pass:\n${r.stderr ?? ""}\n${r.stdout}`);
  assert.match(r.stdout, /surface_categories_covered=6\/6/, "default-root run must report 6/6");
});

test("AC4 — every attribution task in the manifest resolves on the real bundle (no holes)", async () => {
  const r = runScript(["--json", "--root", REPO_ROOT]);
  assert.equal(r.status, 0, `json mode must pass on the bundle root:\n${r.stderr ?? ""}\n${r.stdout}`);
  const json = JSON.parse(r.stdout);
  const holes = json.categories.flatMap((c) => c.attributionHoles);
  assert.deepEqual(holes, [], "every attribution task must resolve on the bundle (AC4 no-hole)");
  const attributed = json.categories.filter((c) => c.attribution.length > 0);
  assert.ok(attributed.length >= 5, "at least five categories carry attribution to a filed task");
});

// ── AC2: a complete laid-down target (after-install) resolves all six categories ───────────────────

test("AC2 — a complete target fixture (after-install) resolves all six categories → 6/6", async () => {
  const m = await mod();
  const specText = fs.readFileSync(SPEC_DOC, "utf8");
  const root = buildFixture(m.MANIFEST, specText);
  try {
    const r = runScript(["--surface", "--root", root]);
    assert.equal(r.status, 0, `complete fixture must pass:\n${r.stderr ?? ""}\n${r.stdout}`);
    assert.match(r.stdout, /surface_categories_covered=6\/6/, "complete fixture must report 6/6");
    assert.match(r.stdout, /spec_is_live=1/, "complete fixture's copied SPEC doc must match");
  } finally {
    rmrf(root);
  }
});

// ── Contract control: 逐类 fixture —— 任一类无交付物 ⇒ L1 必报缺 ───────────────────────────────────

test("Contract control — removing any one category's deliverables makes L1 report it MISSING (5/6)", async () => {
  const m = await mod();
  const specText = fs.readFileSync(SPEC_DOC, "utf8");
  for (const cat of m.MANIFEST) {
    // A category with an EMPTY deliverables array (e.g. id=5 periodic-anchor, excluded from
    // delivery by human ruling 2026-08-06 — a quay-development-stage tool, not shipped) is
    // vacuously covered by design (missing.length === 0 trivially) and CANNOT be driven to
    // MISSING by removing files it has none of. Skip it here rather than let the assertion
    // fail silently misleading — this is the intended invariant, not a broken control.
    if (cat.deliverables.length === 0) continue;
    const root = buildFixture(m.MANIFEST, specText);
    try {
      removeCategoryDeliverables(root, cat);
      const r = runScript(["--surface", "--root", root]);
      assert.equal(r.status, 1, `category ${cat.name} (no deliverables) must fail`);
      assert.match(
        r.stdout,
        new RegExp(`\\[${cat.id}/6\\] ${cat.name} .*: MISSING`),
        `category ${cat.name} must be reported MISSING`
      );
      assert.match(r.stdout, /surface_categories_covered=5\/6/, `category ${cat.name} removal → 5/6`);
    } finally {
      rmrf(root);
    }
  }
});

// ── Contract invariant: spec_is_live must be 1; a frozen/drifted SPEC doc → 0 ──────────────────────

test("Contract invariant — a SPEC doc whose L1-MANIFEST drifts from the executable manifest → spec_is_live=0", async () => {
  const m = await mod();
  const specText = fs.readFileSync(SPEC_DOC, "utf8");
  const drifted = specText.replace("mechanism-and-runtime", "mechanism-and-runtime-DRIFTED");
  const root = buildFixture(m.MANIFEST, drifted);
  try {
    const r = runScript(["--surface", "--root", root]);
    assert.equal(r.status, 1, "a drifted SPEC doc must fail the check");
    assert.match(r.stdout, /spec_is_live=0/, "drifted doc → spec_is_live=0");
  } finally {
    rmrf(root);
  }
});

test("Contract invariant — a target without the SPEC doc reports spec_is_live=n/a and still checks deliverables", async () => {
  const m = await mod();
  const root = buildFixture(m.MANIFEST, null); // no SPEC doc
  try {
    const r = runScript(["--surface", "--root", root]);
    assert.equal(r.status, 0, "no SPEC doc → spec_is_live n/a must not fail an otherwise complete target");
    assert.match(r.stdout, /surface_categories_covered=6\/6/);
    assert.match(r.stdout, /spec_is_live=n\/a/, "absent SPEC doc → n/a");
  } finally {
    rmrf(root);
  }
});

// ── AC4: attribution holes are reported (each gap resolves to a filed task) ────────────────────────

test("AC4 — an attribution task missing from the board is reported as a hole", async () => {
  const m = await mod();
  const specText = fs.readFileSync(SPEC_DOC, "utf8");
  const root = buildFixture(m.MANIFEST, specText);
  try {
    // Remove one attribution task that a category actually attributes to.
    const target = m.MANIFEST.find((c) => c.attribution.length > 0);
    assert.ok(target, "at least one category must carry attribution");
    const taskRel = path.join("tasks", `${target.attribution[0]}.md`);
    fs.rmSync(path.join(root, taskRel), { force: true });
    const r = runScript(["--json", "--root", root]);
    assert.equal(r.status, 0, "attribution holes are reported, not fatal");
    const json = JSON.parse(r.stdout);
    const cat = json.categories.find((c) => c.id === target.id);
    assert.ok(cat, "the category must appear in json output");
    assert.deepEqual(cat.attributionHoles, [target.attribution[0]], "missing task must be surfaced as an attribution hole");
  } finally {
    rmrf(root);
  }
});

// ── --json machine-readable surface (Contract measure consumed by the outer) ───────────────────────

test("Contract measure — --json emits surface_categories_covered + spec_is_live for the bundle root", async () => {
  const r = runScript(["--json", "--root", REPO_ROOT]);
  assert.equal(r.status, 0, `json mode must pass on the bundle root:\n${r.stderr ?? ""}\n${r.stdout}`);
  const json = JSON.parse(r.stdout);
  assert.equal(json.surface_categories_covered, "6/6");
  assert.equal(json.covered, 6);
  assert.equal(json.total, 6);
  assert.equal(json.spec_is_live, 1);
  assert.equal(json.categories.length, 6, "all six categories present in json output");
});

// ── AC1/AC2 (gap-delivery-outline-vs-verify-surface-single-source): delivery inventory ─────────────
// AC1 — verify-delivery-surface is the SINGLE SOURCE for the plugin-bundle directory counts; the
//       outline §6 carries a derived snapshot that `--inventory` validates. AC2 — outline drift is
//       mechanically caught: a snapshot that disagrees with disk ⇒ inventory_drift reported + exit 1.

test("AC1/AC2 — the real bundle inventory matches the outline §6 snapshot (--inventory exits 0)", async () => {
  const m = await mod();
  assert.ok(Array.isArray(m.DELIVERY_INVENTORY) && m.DELIVERY_INVENTORY.length >= 8,
    "the delivery inventory must cover the eight plugin-bundle directories");
  const r = runScript(["--inventory", "--root", REPO_ROOT]);
  assert.equal(r.status, 0, `bundle inventory must be consistent:\n${r.stdout}`);
  assert.match(r.stdout, /inventory_snapshot=present/, "outline §6 must carry the derived snapshot block");
  assert.match(r.stdout, /inventory_drift=0/, "no inventory drift on the bundle root (AC2)");
});

test("AC2 control — a drifted outline snapshot is reported (--inventory exits 1, names the drifted dir)", async () => {
  const m = await mod();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "l1-inv-drift-"));
  try {
    for (const e of m.DELIVERY_INVENTORY) {
      const p = path.join(base, e.dir);
      fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(path.join(p, "a.txt"), "");
      fs.writeFileSync(path.join(p, "b.txt"), "");
    }
    // A snapshot block that claims scripts=999 while disk has 2 → drift on the scripts entry.
    const outline = `# x\n\n${m.INV_BEGIN_MARKER}\nscripts=999 · skills=2\n${m.INV_END_MARKER}\n`;
    const outlineFile = path.join(base, "docs", "proposals", "quay-product-outline.md");
    fs.mkdirSync(path.dirname(outlineFile), { recursive: true });
    fs.writeFileSync(outlineFile, outline);
    const r = runScript(["--inventory", "--root", base]);
    assert.equal(r.status, 1, "a drifted outline snapshot must fail --inventory");
    assert.match(r.stdout, /inventory_drift=1/, "drift count must be reported");
    assert.match(r.stdout, /\[DRIFT\] scripts/, "the drifted dir must be named");
  } finally { rmrf(base); }
});

test("AC2 negative — --inventory fails closed when the outline §6 snapshot block is absent", async () => {
  const m = await mod();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "l1-inv-missing-"));
  try {
    for (const e of m.DELIVERY_INVENTORY) {
      fs.mkdirSync(path.join(base, e.dir), { recursive: true });
      fs.writeFileSync(path.join(base, e.dir, "a.txt"), "");
    }
    // No outline at all → the derived snapshot is absent → AC1 violated → fail-closed.
    const r = runScript(["--inventory", "--root", base]);
    assert.equal(r.status, 1, "missing outline snapshot block must fail --inventory (AC1: outline must derive)");
    assert.match(r.stdout, /inventory_snapshot=missing/, "must report the snapshot as missing");
  } finally { rmrf(base); }
});

test("AC1 generation — --write-inventory regenerates the outline snapshot to match disk", async () => {
  const m = await mod();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "l1-inv-write-"));
  try {
    for (const e of m.DELIVERY_INVENTORY) {
      fs.mkdirSync(path.join(base, e.dir), { recursive: true });
      fs.writeFileSync(path.join(base, e.dir, "a.txt"), "");
    }
    const outline = `# x\n\n${m.INV_BEGIN_MARKER}\nscripts=999\n${m.INV_END_MARKER}\n`;
    const outlineFile = path.join(base, "docs", "proposals", "quay-product-outline.md");
    fs.mkdirSync(path.dirname(outlineFile), { recursive: true });
    fs.writeFileSync(outlineFile, outline);
    const r = runScript(["--write-inventory", "--root", base]);
    assert.equal(r.status, 0, "--write-inventory must exit 0");
    assert.match(r.stdout, /inventory_drift=0/, "after regeneration the snapshot must match disk");
    const after = fs.readFileSync(outlineFile, "utf8");
    assert.match(after, /scripts=1/, "the regenerated snapshot must carry the disk count");
  } finally { rmrf(base); }
});

// ── AC5: this file uses node:test with a governance group declaration (checked by policy) ─────────
