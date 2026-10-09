// @test-group engine
// Regression pin for gap-meta-driver-snapshot-tracked-changes-reference-error.
//
// The defect: meta-driver.ts used `export { snapshotTrackedChanges, probeWriteViolations } from
// "./probe-write-guard.ts"` (a re-export, which binds the EXPORT TABLE only — not module scope)
// while calling both names bare inside its own body. Result: `ReferenceError:
// snapshotTrackedChanges is not defined` on every semantic-half round for 27 days, while the
// mechanical heartbeat kept ticking and looked healthy.
//
// This test asserts the CLASS, not the instance: any bare call to a name re-exported from
// probe-write-guard.ts must ALSO be bound by a real `import` in the same file. A `export ... from`
// alone does not discharge it. The negative control is in the task body: delete the import line
// and this test must go red.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const META_DRIVER = path.join(HERE, "..", "scripts", "meta-driver.ts");

/** Strip line comments and block comments so a symbol named inside prose never counts as a use
 *  (位置判定, not keyword matching — CLAUDE.md hard rule 2). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const SYMBOLS = ["snapshotTrackedChanges", "probeWriteViolations"];

test("meta-driver.ts binds every bare-called probe-write-guard symbol with a real import (not just a re-export)", () => {
  const raw = fs.readFileSync(META_DRIVER, "utf8");
  const code = stripComments(raw);

  for (const sym of SYMBOLS) {
    const bareCall = new RegExp(`(^|[^.\\w])${sym}\\s*\\(`, "m");
    if (!bareCall.test(code)) continue; // not called bare here — nothing to bind

    const imported = new RegExp(`^import\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}\\s*from\\s*["']\\./probe-write-guard\\.ts["']`, "m");
    assert.match(
      code,
      imported,
      `meta-driver.ts calls ${sym}(...) bare but has no \`import { ... ${sym} ... } from "./probe-write-guard.ts"\`. ` +
        `A bare \`export { ${sym} } from "..."\` binds the export table ONLY, not module scope — ` +
        `the bare call throws ReferenceError at runtime (gap-meta-driver-snapshot-tracked-changes-reference-error).`
    );
  }
});

test("the re-export is retained (ADR-004 single source — existing callers/tests keep their import path)", () => {
  const code = stripComments(fs.readFileSync(META_DRIVER, "utf8"));
  const reExport = /^export\s*\{[^}]*\bsnapshotTrackedChanges\b[^}]*\}\s*from\s*["']\.\/probe-write-guard\.ts["']/m;
  assert.match(code, reExport, "meta-driver.ts must keep re-exporting the guard so existing import paths keep working");
});

test("probe-write-guard.ts remains the single implementation (meta-driver.ts defines neither symbol itself)", () => {
  const code = stripComments(fs.readFileSync(META_DRIVER, "utf8"));
  for (const sym of SYMBOLS) {
    const defines = new RegExp(`^(export\\s+)?function\\s+${sym}\\s*\\(`, "m");
    assert.ok(!defines.test(code), `meta-driver.ts must not define ${sym} itself — the single source is probe-write-guard.ts`);
  }
});
