// @test-group engine
// archive-exclusion-wiring.test.mjs — gap-archive-mechanism-and-exclusion-wiring (AC157).
// The archive mechanism's five exclusion faces (SPEC §12c): capability-catalog.sh,
// runtime-usage-inventory.ts, scripts/test.sh's test glob, the laydown closure
// (quay-init.sh derive_loop_scripts + laydown-set-check.sh), and version-consistency-check.ts.
// Each face must exclude `archive/**`; this file proves each exclusion is REAL via a negative
// control — with the exclusion the face stays green, with the exclusion removed (or its archive
// input removed) the archived object is flagged (red). A face with no test here is a face that
// "forgot to wire" (AC3: 缺哪一条就说明那一面没真正接线).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { parseImports, enumerateScripts } from "../scripts/runtime-usage-inventory.ts";
import { isArchivedPath } from "../../scripts/version-consistency-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
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

    // Remove the archive/** exclusion (the "撤排除" negative control).
    let src = fs.readFileSync(renderer, "utf8");
    const before = src;
    src = src.replace('new Set(["checker-mutation-cases", "archive"])', 'new Set(["checker-mutation-cases"])');
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

// ── quay-init.sh derive_loop_scripts: archived scripts are dropped from the laydown set ──────
test("derive_loop_scripts drops an archived doc-referenced script (negative control: absent archive/ keeps it)", () => {
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

    const derive = (root) => spawnSync("bash", ["-c", `
      export CLAUDE_PLUGIN_ROOT="${SCRIPTS_DIR}/.."
      set --
      . "${path.join(SCRIPTS_DIR, "quay-init.sh")}"
      PLUGIN_ROOT="${root}/plugin"
      derive_loop_scripts
    `], { encoding: "utf8" });

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
