// @test-group engine
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
//   AC5  — this file uses node:test and declares // @test-group engine.
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

// Consumer LAID fixture (gap-verify-delivery-surface-checks-source-layout-not-consumer-laid): builds
// a quay-init --loop consumer's laid layout — every laid-manifest deliverable at its consumer path
// (orchestration/+docs/analysis/+plugin/scripts/+.quay/runtime). Attribution tasks are NOT created:
// a consumer does not own quay's gap tasks (reported as attribution-holes, not fatal).
function buildLaidFixture(manifest) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "l1-laid-"));
  for (const cat of manifest) {
    for (const d of cat.deliverables) {
      const p = path.join(base, d);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "");
    }
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

// ── Delivery inventory (gap-delivery-inventory-check-time-computation): computed at check time ─────
// The outline §6 DELIVERY-INVENTORY counts were a COMMITTED snapshot (scripts=N · …) that every
// plugin/scripts A/D had to co-touch — a shared merge-conflict hotspot. The snapshot is REMOVED; the
// counts are now COMPUTED AT CHECK TIME by `--inventory`, a REPORT (exit 0) rather than a drift check.
// AC1 — outline §6 no longer carries a committed snapshot; AC4 — `--inventory` still yields the
// delivery-surface summary (release/human audit: one command).

test("compute-at-check-time — --inventory computes the eight delivery dirs and exits 0 (no snapshot)", async () => {
  const m = await mod();
  assert.ok(Array.isArray(m.DELIVERY_INVENTORY) && m.DELIVERY_INVENTORY.length >= 8,
    "the delivery inventory must cover the eight plugin-bundle directories");
  const r = runScript(["--inventory", "--root", REPO_ROOT]);
  assert.equal(r.status, 0, `--inventory must be a report that exits 0:\n${r.stdout}`);
  assert.match(r.stdout, /inventory_snapshot=none/, "no committed snapshot — computed at check time");
  for (const e of m.DELIVERY_INVENTORY) {
    assert.match(r.stdout, new RegExp(`${e.name}=`), `the inventory must print the ${e.name} count`);
  }
  assert.doesNotMatch(r.stdout, /inventory_drift/, "a report has no drift line (no snapshot to drift against)");
});

test("compute-at-check-time — --inventory counts disk entries (a dir with 2 files reports its count, exit 0)", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "l1-inv-compute-"));
  try {
    fs.mkdirSync(path.join(base, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(base, "plugin", "scripts", "a.sh"), "");
    fs.writeFileSync(path.join(base, "plugin", "scripts", "b.ts"), "");
    const r = runScript(["--inventory", "--root", base]);
    assert.equal(r.status, 0, `--inventory must exit 0 on a partial tree (a report, not a fail-closed check):\n${r.stdout}`);
    assert.match(r.stdout, /scripts=2/, "the computed scripts count must reflect disk");
  } finally { rmrf(base); }
});

test("AC1 — outline §6 no longer carries a committed DELIVERY-INVENTORY snapshot", () => {
  const outline = fs.readFileSync(path.join(REPO_ROOT, "docs", "proposals", "quay-product-outline.md"), "utf8");
  assert.doesNotMatch(outline, /<!-- DELIVERY-INVENTORY-BEGIN -->/, "the snapshot block must be gone");
  assert.doesNotMatch(outline, /scripts=\d+/, "no hand-edited scripts=N token remains");
});

test("--write-inventory is retired (exit 2, points at --inventory)", () => {
  const r = runScript(["--write-inventory", "--root", REPO_ROOT]);
  assert.equal(r.status, 2, "--write-inventory must be retired (exit 2)");
  assert.match(r.stderr, /retired/, "the retired message must name the retirement");
});

// ── LAID layout (gap-verify-delivery-surface-checks-source-layout-not-consumer-laid) ────────────────
// The task: verify-delivery-surface checked the SOURCE layout (plugin/loop/, plugin/scripts/ = quay's
// own repo) and reported 0/6 for EVERY quay-init consumer (archguard's laid layout is orchestration/ +
// docs/analysis/). AC1 — a consumer laid root must report covered > 0 (not 0/6); AC2 — a complete
// current-release consumer must pass laid mode 6/6; AC4 — the source layout must stay supported.

test("AC1 — a partial consumer (archguard shape: tick docs only) auto-detects laid layout and reports covered > 0", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "l1-laid-partial-"));
  try {
    fs.mkdirSync(path.join(base, "orchestration"), { recursive: true });
    fs.mkdirSync(path.join(base, "docs", "analysis"), { recursive: true });
    fs.writeFileSync(path.join(base, "orchestration", "orchestrator-loop-tick.md"), "");
    fs.writeFileSync(path.join(base, "docs", "analysis", "fast-mode-loop-tick.md"), "");
    const r = runScript(["--surface", "--root", base]);
    assert.ok(r.stdout.includes("layout=laid"), "consumer root must auto-detect laid layout");
    const covered = Number(/surface_categories_covered=(\d+)\/6/.exec(r.stdout)?.[1]);
    assert.ok(Number.isFinite(covered) && covered > 0,
      `a laid consumer must report covered > 0 (was structurally 0/6 before the fix), got:\n${r.stdout}`);
    assert.ok(r.stdout.includes("consumer_surface_ok=1"), "the outer's ok/PASS measure must count the consumer surface");
  } finally { rmrf(base); }
});

test("AC2 — a complete quay-init --loop consumer fixture passes laid mode 6/6 (explicit --layout laid AND auto-detect)", async () => {
  const m = await mod();
  const root = buildLaidFixture(m.LAID_MANIFEST);
  try {
    const r = runScript(["--surface", "--root", root, "--layout", "laid"]);
    assert.equal(r.status, 0, `complete laid fixture must pass:\n${r.stderr ?? ""}\n${r.stdout}`);
    assert.match(r.stdout, /surface_categories_covered=6\/6/, "laid fixture must report 6/6");
    assert.match(r.stdout, /layout=laid/);
    assert.match(r.stdout, /spec_is_live=n\/a/, "a consumer has no SPEC doc → n/a, not a false fail");
    // Auto-detection (no --layout) must resolve the same consumer to laid and pass.
    const ra = runScript(["--surface", "--root", root]);
    assert.equal(ra.status, 0, `auto-detect laid must pass:\n${ra.stderr ?? ""}\n${ra.stdout}`);
    assert.match(ra.stdout, /layout=laid/);
  } finally { rmrf(root); }
});

test("AC4 — source layout preserved: the bundle root still reports 6/6 with explicit --layout source", async () => {
  const r = runScript(["--surface", "--root", REPO_ROOT, "--layout", "source"]);
  assert.equal(r.status, 0, `bundle root with --layout source must pass:\n${r.stderr ?? ""}\n${r.stdout}`);
  assert.match(r.stdout, /layout=source/);
  assert.match(r.stdout, /surface_categories_covered=6\/6/);
});

test("AC4 — both manifests carry six categories; auto-detection maps bundle→source and consumer→laid", async () => {
  const m = await mod();
  assert.equal(m.MANIFEST.length, 6, "source manifest must declare exactly six categories");
  assert.equal(m.LAID_MANIFEST.length, 6, "laid manifest must declare exactly six categories");
  assert.equal(m.detectLayout(REPO_ROOT), "source", "the bundle root auto-detects source (has scripts/test.sh)");
  const consumer = buildLaidFixture(m.LAID_MANIFEST);
  try {
    assert.equal(m.detectLayout(consumer), "laid", "a consumer root auto-detects laid (orchestration/ + docs/analysis/)");
  } finally { rmrf(consumer); }
});

test("Contract control — removing one laid category's deliverables makes laid mode report it MISSING", async () => {
  const m = await mod();
  for (const cat of m.LAID_MANIFEST) {
    if (cat.deliverables.length === 0) continue;
    const root = buildLaidFixture(m.LAID_MANIFEST);
    try {
      removeCategoryDeliverables(root, cat);
      const r = runScript(["--surface", "--root", root, "--layout", "laid"]);
      assert.equal(r.status, 1, `laid category ${cat.name} (deliverables removed) must fail`);
      assert.match(
        r.stdout,
        new RegExp(`\\[${cat.id}/6\\] ${cat.name} .*: MISSING`),
        `laid category ${cat.name} must be reported MISSING`
      );
    } finally { rmrf(root); }
  }
});

test("CLI — --layout with an unknown value fails closed (usage error, exit 2)", async () => {
  const r = runScript(["--surface", "--layout", "bogus"]);
  assert.equal(r.status, 2, "unknown --layout value must be a usage error");
  assert.match(r.stderr ?? "", /unknown --layout value/, "the error must name the bad value");
});

test("Contract measure — a complete laid consumer emits an ok/PASS token the outer's grep counts", async () => {
  const m = await mod();
  const root = buildLaidFixture(m.LAID_MANIFEST);
  try {
    const r = runScript(["--surface", "--root", root]);
    assert.equal(r.status, 0, "complete laid consumer must pass");
    const matches = (r.stdout.match(/ok|PASS/g) ?? []).length;
    assert.ok(matches > 0, `the consumer_surface measure greps 'ok|PASS' and must find > 0, got:\n${r.stdout}`);
  } finally { rmrf(root); }
});

// ── selector wiring (gap-delivery-inventory-check-time-computation) ─────────────────────────────────
// The DELIVERY-INVENTORY scoped drift check is RETIRED. A new plugin/scripts file no longer drifts a
// committed snapshot (the inventory is computed at check time), so the scoped tier no longer selects a
// `delivery-inventory` checker — but the capability-catalog AC1c gate for a new script REMAINS. AC5:
// the five historical drift scripts still exist (regression guard that the retired drift's historical
// surfaces stay put).

test("a NEW plugin/scripts touch selects capability-catalog but NOT the retired delivery-inventory (selector wiring)", async () => {
  const sel = await import(path.join(REPO_ROOT, "plugin", "scripts", "select-static-checks-for-touches.ts"));
  const { selected } = sel.selectStaticChecksForTouches(
    ["tasks/foo.md", "plugin/scripts/new-helper.ts"],
    [],
    { newTouches: ["plugin/scripts/new-helper.ts"] },
  );
  assert.ok(selected.some((s) => s.name === "capability-catalog"),
    `capability-catalog must still be selected for a new plugin/scripts touch: ${selected.map((s) => s.name)}`);
  assert.ok(!selected.some((s) => s.name === "delivery-inventory"),
    `delivery-inventory must NOT be selected (retired): ${selected.map((s) => s.name)}`);
});

test("AC5 — the historical drift scripts exist and --inventory computes the current bundle", async () => {
  // The prior drift instances each added a plugin/scripts file without regenerating the outline §6
  // snapshot (halt-check/spec-goal/accounting-emit/DIR-043/inner-exec-mode). The snapshot is now gone,
  // but these shipped surfaces must stay put (regression guard against a future edit silently dropping
  // them); halt-check.sh was retired 2026-08-29 (gap-retire-halt-file-driver-based) and
  // inner-exec-mode-report.ts was deleted 2026-09-01 (gap-retire-inner-hygiene-delete-session-face), so
  // both dropped from the shipped-surface guard. --inventory must still compute the current bundle.
  const shipped = [
    "plugin/scripts/accounting-emit.ts",
    "plugin/scripts/external-dogfooding-check.ts",
    "plugin/scripts/tmp-leak-pairing-check.sh",
    "plugin/scripts/tmp-leak-pairing-check.ts",
    "plugin/scripts/stale-ready-audit.ts",
  ];
  for (const rel of shipped) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, rel)), `${rel} must exist (a shipped plugin/scripts surface)`);
  }
  const r = runScript(["--inventory", "--root", REPO_ROOT]);
  assert.equal(r.status, 0, `--inventory must compute the current bundle:\n${r.stdout}`);
});

// ── AC5: this file uses node:test with a governance group declaration (checked by policy) ─────────
