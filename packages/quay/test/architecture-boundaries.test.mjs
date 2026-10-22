// @test-group product
// GOAL-910 / AC-917 — RESPONSIBILITY-shaped cycle breaking, not merely "make the cycle disappear".
//
// AC-917 is a SHELL criterion (`grep -lE "from .\./serve/" packages/quay/src/*.ts` etc.). A grep is
// takeable-false only as long as someone keeps it honest; this file is the executable form of the
// same three predicates, decided by POSITION rather than by keyword:
//
//   P1  the shared server runtime-state carrier lives in `core/server-state.ts`, NOT `serve/`.
//   P2  no ROOT-LEVEL file under `packages/quay/src/` imports `./serve/`.
//   P3  no `observation/*.ts` file reaches a ROOT-LEVEL module via `../X.ts` (core/ or kernel/ are
//       the legal targets — the abi.ts facade is the EXTERNAL surface, not an internal seam).
//
// The expect text of AC-917 explicitly rules out the cheap way to kill the cycle (moving
// `goal-preview.ts` INTO `serve/`): the cycle would vanish while the UI layer ends up owning core
// preview logic. P1-P3 are the responsibility-shaped form, so this guard must fail when a future
// refactor re-introduces any of them.
//
// THREE ARMS (the third one is why this file exists at all):
//   ① the REAL tree satisfies all three predicates;
//   ② a synthetic fixture violates each predicate IN TURN and the reader names it (takeable-false);
//   ③ a scan surface where no cross-directory import parses at all is INSTRUMENT-FAILURE
//      (`evaluated:false`), NOT "0 violations" (hard rule 3b — "could not read" must never share an
//      output shape with "read it and it was clean").
//
// Position-based parsing is NOT re-implemented here: `extractImports` (the import-graph-check
// reader) is reused, so comments/strings/regex literals mentioning `./serve/` cannot satisfy or
// violate a predicate. (Hard rule 2; `buildNonCodeMask` underneath is the repo's single mask.)
//
// Run (scoped): node --test packages/quay/test/architecture-boundaries.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractImports } from "../../../plugin/scripts/import-graph-check.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const SRC_REL = "packages/quay/src";

/** `../<one-segment>.ts` — reaches a module that sits DIRECTLY under `src/` (not a subdirectory). */
const ROOT_LEVEL_SPEC_RE = /^\.\.\/[A-Za-z0-9_-]+\.ts$/;

const CORE_CARRIER_REL = "core/server-state.ts";
const SERVE_CARRIER_REL = "serve/server-state.ts";

/**
 * Read the AC-917 scan surface under `srcRoot` and decide the three predicates.
 *
 * `evaluated:false` means the surface could not be READ (missing root, no files, or zero
 * cross-directory edges parsed) — a distinct outcome from `evaluated:true, violations:[]`.
 *
 * @param {string} srcRoot absolute path to a `src/`-shaped directory
 */
export function scanTree(srcRoot) {
  /** @type {{evaluated: boolean, reason?: string, scannedFiles: number, importEdges: number, crossDirEdges: number, violations: Array<{predicate: string, detail: string}>}} */
  const out = { evaluated: false, scannedFiles: 0, importEdges: 0, crossDirEdges: 0, violations: [] };
  if (!fs.existsSync(srcRoot) || !fs.statSync(srcRoot).isDirectory()) {
    out.reason = `scan root is missing or not a directory: ${srcRoot}`;
    return out;
  }

  const rootFiles = fs
    .readdirSync(srcRoot, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => e.name);
  const observationDir = path.join(srcRoot, "observation");
  const observationFiles = fs.existsSync(observationDir) && fs.statSync(observationDir).isDirectory()
    ? fs
        .readdirSync(observationDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".ts"))
        .map((e) => `observation/${e.name}`)
    : [];
  const scanned = [...rootFiles, ...observationFiles].sort();
  out.scannedFiles = scanned.length;

  if (scanned.length === 0) {
    out.reason = "scan surface has no .ts files — nothing was read, so nothing was verified";
    return out;
  }

  // P1 — the carrier's home is `core/`, never `serve/`.
  const coreCarrier = fs.existsSync(path.join(srcRoot, CORE_CARRIER_REL));
  const serveCarrier = fs.existsSync(path.join(srcRoot, SERVE_CARRIER_REL));
  if (!coreCarrier || serveCarrier) {
    out.violations.push({
      predicate: "P1",
      detail: `server-state.ts must live in ${CORE_CARRIER_REL} (core=${coreCarrier ? "present" : "MISSING"}), not ${SERVE_CARRIER_REL} (serve=${serveCarrier ? "PRESENT" : "absent"})`,
    });
  }

  for (const rel of scanned) {
    const src = fs.readFileSync(path.join(srcRoot, rel), "utf8");
    for (const imp of extractImports(src)) {
      if (!imp.spec.startsWith(".")) continue; // bare specifier: not a repo-internal edge
      out.importEdges++;

      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), imp.spec));
      if (path.posix.dirname(target) !== path.posix.dirname(rel)) out.crossDirEdges++;

      // P2 — a root-level file (no `/` in its relative path) reaching into serve/.
      if (!rel.includes("/") && imp.spec.startsWith("./serve/")) {
        out.violations.push({
          predicate: "P2",
          detail: `${rel}:${imp.line} imports "${imp.spec}" — root-level modules must not depend on serve/ (the UI layer imports core, never the reverse)`,
        });
      }

      // P3 — observation/ reaching a module that sits directly under src/ (the abi.ts facade or a
      // pre-refactor root carrier). `../core/types.ts` / `../kernel/*.ts` are the legal shape.
      if (rel.startsWith("observation/") && ROOT_LEVEL_SPEC_RE.test(imp.spec)) {
        out.violations.push({
          predicate: "P3",
          detail: `${rel}:${imp.line} imports "${imp.spec}" — observation/ must reach core/ or kernel/ directly, not a root-level module`,
        });
      }
    }
  }

  // Arm ③'s condition: a reader that parses nothing would otherwise report "0 violations" forever.
  if (out.crossDirEdges === 0) {
    out.reason = `no cross-directory import was parsed from ${scanned.length} scanned file(s) — the reader is blind, so this is NOT a clean result`;
    return out;
  }

  out.evaluated = true;
  return out;
}

/** Write a synthetic tree from `{ "rel/path.ts": "content" }` and return its absolute root. */
function makeFixture(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac917-arch-boundaries-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

/** The smallest fixture that satisfies all three predicates (one cross-dir edge keeps it evaluated). */
const GOOD_FIXTURE = {
  "core/server-state.ts": "export const SERVER_STATE_REL = '.quay/server-state.json';\n",
  "core/types.ts": "export const TASK_STATUS = ['todo'];\n",
  "kernel/touches-annotation.ts": "export const strip = 1;\n",
  "observation/model.ts": 'import { TASK_STATUS } from "../core/types.ts";\nexport const m = TASK_STATUS;\n',
  "goal-preview.ts": "export const preview = 1;\n",
  "loaded-version.ts": "export const loaded = 1;\n",
};

test("arm 1 — real packages/quay/src satisfies AC-917's three responsibility predicates", () => {
  const reading = scanTree(path.join(REPO_ROOT, SRC_REL));
  console.log(
    `[arm1] scanned=${reading.scannedFiles} importEdges=${reading.importEdges} crossDirEdges=${reading.crossDirEdges} violations=${reading.violations.length}`,
  );
  assert.equal(reading.evaluated, true, `instrument could not read the real tree: ${reading.reason ?? ""}`);
  assert.deepEqual(reading.violations, [], `AC-917 violated in the real tree:\n${reading.violations.map((v) => `  ${v.predicate}: ${v.detail}`).join("\n")}`);
  assert.ok(reading.crossDirEdges > 0, "real tree must produce parsed cross-directory edges, else arm 3's guard is meaningless");
});

test("arm 2 — each predicate is takeable-false on a synthetic fixture", async (t) => {
  await t.test("baseline fixture is clean (the violations below are the ONLY difference)", () => {
    const reading = scanTree(makeFixture(t, GOOD_FIXTURE));
    console.log(`[arm2-baseline] evaluated=${reading.evaluated} crossDirEdges=${reading.crossDirEdges} violations=${reading.violations.length}`);
    assert.equal(reading.evaluated, true, reading.reason ?? "");
    assert.deepEqual(reading.violations, []);
  });

  await t.test("P1: server-state.ts parked in serve/ is reported", () => {
    const files = { ...GOOD_FIXTURE };
    delete files["core/server-state.ts"];
    files["serve/server-state.ts"] = "export const SERVER_STATE_REL = '.quay/server-state.json';\n";
    const reading = scanTree(makeFixture(t, files));
    console.log(`[arm2-P1] ${reading.violations.map((v) => v.detail).join(" | ")}`);
    assert.equal(reading.evaluated, true, reading.reason ?? "");
    assert.equal(reading.violations.length, 1);
    assert.equal(reading.violations[0].predicate, "P1");
  });

  await t.test("P2: a root-level file importing ./serve/ is reported", () => {
    const files = {
      ...GOOD_FIXTURE,
      "goal-preview.ts": 'import { adr } from "./serve/serve-adr.ts";\nexport const preview = adr;\n',
      "serve/serve-adr.ts": "export const adr = 1;\n",
    };
    const reading = scanTree(makeFixture(t, files));
    console.log(`[arm2-P2] ${reading.violations.map((v) => v.detail).join(" | ")}`);
    assert.equal(reading.evaluated, true, reading.reason ?? "");
    assert.equal(reading.violations.length, 1);
    assert.equal(reading.violations[0].predicate, "P2");
  });

  await t.test("P3: observation/ reaching a root-level module via ../X.ts is reported", () => {
    const files = {
      ...GOOD_FIXTURE,
      "abi.ts": "export const TASK_STATUS = ['todo'];\n",
      "observation/model.ts": 'import { TASK_STATUS } from "../abi.ts";\nexport const m = TASK_STATUS;\n',
    };
    const reading = scanTree(makeFixture(t, files));
    console.log(`[arm2-P3] ${reading.violations.map((v) => v.detail).join(" | ")}`);
    assert.equal(reading.evaluated, true, reading.reason ?? "");
    assert.equal(reading.violations.length, 1);
    assert.equal(reading.violations[0].predicate, "P3");
  });

  await t.test("P2/P3 are position-based: comments and string literals mentioning ./serve/ or ../abi.ts do not count", () => {
    const files = {
      ...GOOD_FIXTURE,
      "goal-preview.ts": [
        '// import { adr } from "./serve/serve-adr.ts";',
        'const doc = \'import { TASK_STATUS } from "../abi.ts";\';',
        "export const preview = doc;\n",
      ].join("\n"),
    };
    const reading = scanTree(makeFixture(t, files));
    console.log(`[arm2-position] evaluated=${reading.evaluated} violations=${reading.violations.length} importEdges=${reading.importEdges}`);
    assert.equal(reading.evaluated, true, reading.reason ?? "");
    assert.deepEqual(reading.violations, [], "comment/string mentions must not be read as module edges");
  });
});

test("arm 3 — a scan surface with zero parsed cross-directory imports is instrument-failure, not a pass", (t) => {
  // The files exist and even a root-level file is present — but nothing imports across a directory
  // boundary. A reader that returned "violations: []" here would be indistinguishable from a reader
  // that actually verified a tree (hard rule 3b).
  const reading = scanTree(
    makeFixture(t, {
      "core/server-state.ts": "export const x = 1;\n",
      "goal-preview.ts": "export const preview = 1;\n",
      "observation/model.ts": "export const m = 1;\n",
    }),
  );
  console.log(`[arm3] evaluated=${reading.evaluated} reason=${reading.reason ?? "(none)"} violations=${reading.violations.length}`);
  assert.equal(reading.evaluated, false, "zero parsed edges must NOT read as a clean tree");
  assert.match(reading.reason ?? "", /no cross-directory import was parsed/i);
});
