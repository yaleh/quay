// @test-group engine
// archive-exclusion-wiring.test.mjs — gap-archive-mechanism-and-exclusion-wiring (AC157).
// The archive mechanism's five exclusion faces (SPEC §12c): the capability catalog
// (renderer plugin/scripts/capability-catalog.ts — the .sh is a thin entry since
// gap-arch-catalog-declarations-leave-bash), runtime-usage-inventory.ts, scripts/test.sh's test
// glob, the laydown closure (quay-init.sh derive_loop_scripts + laydown-set-check.sh), and
// version-consistency-check.ts.
// Each face must exclude `archive/**`; this file proves each exclusion is REAL via a negative
// control — with the exclusion the face stays green, with the exclusion removed (or its archive
// input removed) the archived object is flagged (red). A face with no test here is a face that
// "forgot to wire" (AC3: 缺哪一条就说明那一面没真正接线).
// §12c-ii (2026-11-06) adds the one face that is NOT tree-walking code: the DISCOVERY PROBE SPECS.
// An analyst prompt that treats `archive/**` as an analysable surface reads identity that is true
// BY CONSTRUCTION (a frozen snapshot vs a live file unchanged since capture) and proposes deleting
// the historical record — finding `archive-retired-gate-scripts-still-byte-identical-to-live`. The
// last test below pins that the architecture-analysis spec carries the exclusion, through the REAL
// loader (readProbeSpec), so the clause actually reaches the spawned analyst.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { parseImports, enumerateScripts } from "../scripts/runtime-usage-inventory.ts";
import { isArchivedPath } from "../../scripts/version-consistency-check.ts";
import { readProbeSpec } from "../scripts/read-probe-spec.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const SCRIPTS_DIR = path.join(REPO_ROOT, "plugin", "scripts");
const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");

function tmpdir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `archive-excl-${tag}-`));
  return d;
}

function rm(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── AC1: archive/INDEX.tsv seven-field header ──────────────────────────────────────────────
test("AC1 — archive/INDEX.tsv carries the SPEC §12a seven-field header", () => {
  const idx = path.join(REPO_ROOT, "archive", "INDEX.tsv");
  assert.ok(fs.existsSync(idx), "archive/INDEX.tsv must exist");
  const first = fs.readFileSync(idx, "utf8").split("\n")[0];
  const fields = first.split("\t");
  assert.deepEqual(
    fields,
    ["original_path", "archive_path", "date", "reason_code", "evidence", "restore_cmd", "commit"],
    "header must be the seven SPEC §12a fields, tab-separated",
  );
});

// ── runtime-usage-inventory.ts: whole-tree import scan skips archive/** ──────────────────────
test("runtime-usage-inventory parseImports skips archive/** (negative control: non-archive dir is walked)", () => {
  const d = tmpdir("rui");
  try {
    // live.ts lives under plugin/scripts (a script root). dead.ts (archived) imports it via a
    // relative specifier that resolves back into plugin/scripts; sibling.ts (not archived) imports
    // it too. The archive/ dir must be skipped by walkSourceFiles, so ONLY sibling.ts should count
    // as an importer.
    fs.mkdirSync(path.join(d, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(d, "archive", "2026-09-05", "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(d, "plugin", "scripts", "live.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(d, "plugin", "scripts", "sibling.ts"), "import { x } from \"./live.ts\";\n");
    fs.writeFileSync(path.join(d, "archive", "2026-09-05", "plugin", "scripts", "dead.ts"),
      "import { x } from \"../../plugin/scripts/live.ts\";\n");

    const { scripts } = enumerateScripts(d);
    const live = scripts.find((s) => s.basename === "live.ts");
    assert.ok(live, "live.ts must be enumerated as a script");
    const importers = parseImports(d, [live]).get(live.realPath) ?? [];

    // Positive: the archived importer is NOT seen (walkSourceFiles skips archive/**).
    assert.ok(
      !importers.some((r) => r.includes("archive/")),
      `archived importer must be skipped, got: ${JSON.stringify(importers)}`,
    );
    // Negative control: a NON-archived sibling IS seen — proving the walk reaches ordinary dirs and
    // the skip is archive-specific, not "the walk ignores everything".
    assert.ok(
      importers.some((r) => r.endsWith("plugin/scripts/sibling.ts")),
      `non-archive sibling must be walked, got: ${JSON.stringify(importers)}`,
    );
  } finally {
    rm(d);
  }
});

// ── version-consistency-check.ts: isArchivedPath predicate ──────────────────────────────────
test("version-consistency-check isArchivedPath classifies archive/** (negative control: non-archive stays read)", () => {
  assert.equal(isArchivedPath("archive"), true);
  assert.equal(isArchivedPath("archive/2026-09-05/packages/quay/package.json"), true);
  assert.equal(isArchivedPath("x/archive/y"), true);
  assert.equal(isArchivedPath("packages/quay/package.json"), false);
  assert.equal(isArchivedPath("plugin/.claude-plugin/plugin.json"), false);
});

// ── capability-catalog: recursive enumeration skips archive/** ──────────────────────────────
// Materialize the real plugin/scripts corpus (so every script is declared), drop a fake archived
// script under plugin/scripts/archive/, and assert the catalog stays green. Then remove the
// archive/** exclusion and assert the catalog goes red (the archived script is unclassified).
// ⛔ The exclusion lives in the RENDERER (capability-catalog.ts), not in the .sh: the entry is a
// thin exec wrapper since gap-arch-catalog-declarations-leave-bash, so the injection target is the
// renderer's SKIPPED_SEGMENTS set — injecting into the .sh would change nothing and the negative
// control would read green forever.
test("capability-catalog excludes archive/** (negative control: removing the exclusion reddens it)", () => {
  const d = tmpdir("catalog");
  try {
    const sdir = path.join(d, "plugin", "scripts");
    fs.mkdirSync(sdir, { recursive: true });
    for (const f of fs.readdirSync(SCRIPTS_DIR)) {
      const src = path.join(SCRIPTS_DIR, f);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(sdir, f));
    }
    const cat = path.join(sdir, "capability-catalog.sh");
    const renderer = path.join(sdir, "capability-catalog.ts");
    assert.ok(fs.existsSync(renderer), "the renderer must travel with the entry (it is the injected target)");
    fs.mkdirSync(path.join(sdir, "archive", "2026-09-05"), { recursive: true });
    fs.writeFileSync(path.join(sdir, "archive", "2026-09-05", "ghost-archived.sh"),
      "#!/usr/bin/env bash\necho ghost\n");

    const green = spawnSync("bash", [cat, "--summary"], { encoding: "utf8" });
    assert.equal(green.status, 0, `catalog must stay green with archive/ excluded:\n${green.stderr}`);

    // Remove the archive/** exclusion (the "撤排除" negative control). The injection target is the
    // exclusion's CURRENT carrier — a literal `archive/` path pattern in the renderer
    // (gap-ac157-catalog-carrier-moved-criterion-stale). Injecting into the retired basename set the
    // exclusion used to live in would change nothing and this control would read green forever.
    let src = fs.readFileSync(renderer, "utf8");
    const before = src;
    src = src.replace('new RegExp("(^|/)archive/")', 'new RegExp("(^|/)__archive_exclusion_removed__/")');
    assert.notEqual(src, before, "archive exclusion must be present and removable in the renderer");
    fs.writeFileSync(renderer, src);

    const red = spawnSync("bash", [cat, "--json"], { encoding: "utf8" });
    assert.notEqual(red.status, 0, "removing the archive/** exclusion must redden the catalog");
    const rows = JSON.parse(red.stdout);
    const ghost = rows.find((r) => r.file === "ghost-archived.sh");
    assert.ok(ghost, "the archived script must be enumerated once the exclusion is gone");
    assert.equal(ghost.question, null, "and it is the UNCLASSIFIED entry that reddens the gate");
  } finally {
    rm(d);
  }
});

// ── the laydown derivation: archived scripts are dropped from the set ─────────────────────────
test("the laydown derivation drops an archived doc-referenced script (negative control: absent archive/ keeps it)", () => {
  const d = tmpdir("derive");
  try {
    fs.mkdirSync(path.join(d, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(d, "plugin", "loop"), { recursive: true });
    fs.mkdirSync(path.join(d, "plugin", "skills", "cold-start"), { recursive: true });
    fs.writeFileSync(path.join(d, "plugin", "skills", "cold-start", "SKILL.md"), "");
    fs.writeFileSync(path.join(d, "plugin", "loop", "tick.md"),
      "run: node --experimental-strip-types plugin/scripts/archived-check.sh\n");
    // The script was archived (moved out of plugin/scripts) but the doc ref remains.
    fs.mkdirSync(path.join(d, "archive", "2026-09-05", "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(d, "archive", "2026-09-05", "plugin", "scripts", "archived-check.sh"),
      "#!/usr/bin/env bash\n");

    // AC-331 (gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script):
    // the derivation moved OUT of quay-init.sh's library mode (that mode's guard is now a safety guard
    // only, and derive_loop_scripts was deleted) into `deriveLoopScripts`, reached through the sibling
    // step CLI. Same single source, same archive/** exclusion — only the call changed.
    const derive = (root) => spawnSync("node", [
      "--no-warnings", "--experimental-strip-types",
      path.join(SCRIPTS_DIR, "quay-init-steps.ts"),
      "laydown-set", path.join(root, "plugin"),
    ], { encoding: "utf8" });

    const withArchive = derive(d);
    assert.equal(withArchive.status, 0, `derive must succeed:\n${withArchive.stderr}`);
    assert.ok(
      !withArchive.stdout.split("\n").includes("archived-check.sh"),
      "archived-check.sh must be dropped from the laydown set when present under archive/",
    );

    // Negative control: same fixture, archive/ removed → the doc ref flows through un-filtered.
    fs.rmSync(path.join(d, "archive"), { recursive: true, force: true });
    const withoutArchive = derive(d);
    assert.equal(withoutArchive.status, 0, `derive must succeed:\n${withoutArchive.stderr}`);
    assert.ok(
      withoutArchive.stdout.split("\n").includes("archived-check.sh"),
      "archived-check.sh must be derived when no archive/ dir filters it (the exclusion is what drops it)",
    );
  } finally {
    rm(d);
  }
});

// ── scripts/test.sh: the deduped test glob drops archive/** ─────────────────────────────────
test("scripts/test.sh build_deduped_files drops archive/** (negative control: filter line present + filter drops archive paths)", () => {
  // The filter is a real line in build_deduped_files — a regression guard so it cannot be silently
  // removed. Its behavior is exercised directly below on the same awk predicate.
  const src = fs.readFileSync(TEST_SH, "utf8");
  assert.ok(
    src.includes('$1 !~ "(^|/)archive/"'),
    "archive/** filter line must be present in build_deduped_files",
  );

  const sample = [
    "/repo/plugin/test/real.test.mjs\tserial",
    "/repo/archive/2026-09-05/plugin/test/dead.test.mjs\tmain",
    "/repo/packages/quay/test/other.test.mjs\tmain",
  ].join("\n");
  const out = spawnSync("awk", ["-F", "\t", '$1 !~ "(^|/)archive/"'], { input: sample, encoding: "utf8" });
  assert.equal(out.status, 0, "awk filter must run");
  const kept = out.stdout.split("\n").filter(Boolean);
  assert.deepEqual(kept, [
    "/repo/plugin/test/real.test.mjs\tserial",
    "/repo/packages/quay/test/other.test.mjs\tmain",
  ], "archive/** realpaths must be filtered out of the deduped glob");
});

// ── §12c-ii: the ANALYST-INSTRUCTION face — probe specs put archive/** out of scope ──────────
// Why this is a real face and not prose-for-its-own-sake: the probe spec's BODY is the prompt a
// fresh-context analyst receives. `identity-replication-check.ts` (findByteIdenticalPairs) pairs
// `plugin/scripts/*` against `experiments/*/scripts/*` only, so the mechanical instruments CANNOT
// see an archive/ pair — but a free-form analyst pass over the whole tree can, and that is exactly
// what produced finding `archive-retired-gate-scripts-still-byte-identical-to-live` (2026-11-06):
// 6 archive↔live byte-identical pairs, already recorded per-file as `byte_identical=yes` in
// `archive/INDEX.tsv` nine days earlier, reported as duplication with a remedy (delete the archive
// copies) that reddens `plugin/test/gate-scripts-retirement.test.mjs` (measured: 4 pass / 1 fail).
// The clause is what stops the next analyst re-deriving it; this test is what stops the clause from
// being silently paraphrased away (ADR-004).

const ARCHIVE_SCOPE_ANCHOR =
  "`archive/**` IS OUT OF DUPLICATION SCOPE — LIVE↔ARCHIVE BYTE-IDENTITY IS NOT A DEFECT.";

/** Does this analyst objective surrender `archive/**` as a duplication surface — and name the
 *  carriers that make the surrender checkable, rather than asserting it in the abstract? */
function declaresArchiveOutOfDuplicationScope(objective) {
  const text = String(objective ?? "");
  if (!text.includes(ARCHIVE_SCOPE_ANCHOR)) return false;
  return (
    text.includes("archive/INDEX.tsv") &&
    text.includes("NEVER propose deleting archive copies") &&
    text.includes("gate-scripts-retirement.test.mjs")
  );
}

/** The clause paragraph and its index, as it sits in the spec body (-1/-1 when absent). */
function locateClause(objective) {
  const text = String(objective ?? "");
  const at = text.indexOf(ARCHIVE_SCOPE_ANCHOR);
  if (at === -1) return { text, start: -1, end: -1 };
  const start = text.lastIndexOf("\n\n", at) + 2;
  const nl = text.indexOf("\n\n", at);
  const end = nl === -1 ? text.length : nl;
  return { text, start, end };
}

test("§12c-ii: the architecture-analysis probe spec puts archive/** out of duplication scope (negative control: the same predicate is FALSE on the pre-fix objective)", () => {
  // Arm 1 — through the REAL loader. Asserting on the loaded `objective` (not on the file bytes)
  // proves the clause actually reaches the spawned analyst, and would fail if readProbeSpec ever
  // stopped returning the body it parses.
  const spec = readProbeSpec("architecture-analysis", PLUGIN_ROOT);
  assert.equal(typeof spec.objective, "string");
  assert.ok(
    declaresArchiveOutOfDuplicationScope(spec.objective),
    "the architecture-analysis analyst prompt must carry the archive-exclusion clause (`archive/**` IS OUT OF DUPLICATION SCOPE …) naming archive/INDEX.tsv, the ⛔ no-delete remedy, and the executable pin gate-scripts-retirement.test.mjs — without it a frozen snapshot is re-reported as a live duplicate and the proposed remedy deletes the historical record",
  );

  // Arm 2 — the PRE-FIX objective (the clause paragraph cut out). The predicate must read FALSE, or
  // arm 1 measures nothing but "the spec is non-empty" (hard rule 4: a check that cannot take a
  // false value is not a measurement).
  const { text, start, end } = locateClause(spec.objective);
  assert.ok(start >= 0 && end > start, "the clause paragraph must be locatable in the objective");
  const prefixed = text.slice(0, start) + text.slice(end).replace(/^\n+/, "");
  assert.equal(
    declaresArchiveOutOfDuplicationScope(prefixed), false,
    "the predicate must be FALSE on the pre-fix objective (clause removed) — otherwise it is not measuring the clause",
  );

  // Arm 3 — the clause without its checkable carrier. Keeping the anchor but dropping the
  // `archive/INDEX.tsv` pointer must also read FALSE: the exclusion has to name the record that
  // makes "this pair is governed, not silent" verifiable.
  const carrierless = text.slice(0, start) +
    text.slice(start, end).replace(/archive\/INDEX\.tsv/g, "the archive index file") +
    text.slice(end);
  assert.equal(
    declaresArchiveOutOfDuplicationScope(carrierless), false,
    "the predicate must be FALSE when the clause no longer names archive/INDEX.tsv (each conjunct is load-bearing)",
  );
});
