// @test-group product
//
// verdict-parse-ownership.test.mjs — POSITION-INDEPENDENT ownership regression for the kernel
// verdict parser (task gap-ac349-criterion-reanchor-after-core-sink; GOAL-032).
//
// WHAT THIS FILE IS FOR. GOAL-032 converged the two fail-closed "judge stdout → three-state
// verdict" parse loops onto ONE kernel implementation,
// `packages/quay/src/kernel/verdict-parse.ts::parseBinaryVerdict`. Two callers remain, and each
// must stay a THIN wrapper that DELEGATES:
//   · packages/quay/src/**/criterion-fidelity.ts::parseFidelityVerdict       (faithful / vacuous)
//   · plugin/scripts/goal-driver.ts::parseSemanticSufficiencyVerdict          (covered / insufficient)
//
// WHY THIS TEST EXISTS (and why it is NOT a path pin). Commit `35dc5da93` sank the gate substrate
// into `src/core/`: the implementation moved from `packages/quay/src/criterion-fidelity.ts` down to
// `packages/quay/src/core/criterion-fidelity.ts`, and the src-root file became a pure forwarding
// re-export. NOTHING regressed — but AC-349's shipped criterion was pinned to the OLD PATH, so it
// went red while the guarantee it measures stayed true (硬规则 4c: the quantity a criterion names
// must survive every intermediate layer). This file is the durable half of that re-anchor: it asks
// "is there exactly ONE definition, and does it DELEGATE?" over the tree, and it locates the tree
// from ITS OWN path, so a future legal layering move cannot red it while a real regression —
// implementation deleted (0 definitions), copied (≥2), or inlined away from the kernel (no
// delegation) — still can.
//
// ⛔ IT DOES NOT PIN ARGUMENT SPELLING. Both wrappers may gain parameters; only "the body mentions
// parseBinaryVerdict" is asserted. Pinning the call spelling would red on a legal signature change
// (the same rot class this task exists to remove, one layer down).
//
// ⛔ READ FROM THE FILE SYSTEM, NEVER FROM `cwd`. The scan root is derived from this file's own
// location, so the test measures whatever tree it was copied into: a task worktree during dispatch,
// `develop` during fan-in, or a one-off stub tree. The task's AC4 copies it into a stub whose
// implementation does NOT delegate and requires a RED that NAMES that file — a green there would
// mean the test is an echo, not a measurement (硬规则 4 推论三).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root of THIS checkout — a task worktree during dispatch, `develop` during fan-in, or a
 *  one-off stub tree when this file is copied there for the negative control. ⛔ Never `cwd`. */
const REPO = path.resolve(HERE, "..", "..", "..");
const SRC = path.join(REPO, "packages", "quay", "src");
const GOAL_DRIVER = path.join(REPO, "plugin", "scripts", "goal-driver.ts");
const KERNEL = path.join(SRC, "kernel", "verdict-parse.ts");

/** The definition header, anchored at column 0 so a mention inside a comment/string never counts
 *  (硬规则 2: judge by position, not by keyword). ⛔ The parameter list is NOT part of the match. */
const FID_DEF_RE = /^export function parseFidelityVerdict\s*\(/m;

const rel = (p) => path.relative(REPO, p) || p;

/** Every `.ts` file under `dir`, recursively. The scan surface is the WHOLE Core src tree — a
 *  future `core/`→`kernel/`/`<other>` move must not require editing this file. */
function tsFilesUnder(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      if (ent.name === "node_modules") continue;
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile() && p.endsWith(".ts")) out.push(p);
    }
  }
  return out.sort();
}

/** The brace-balanced body of the first function whose header starts with `header` (a prefix, so a
 *  gained parameter or return annotation does not break the lookup). Returns null when the header
 *  is absent — the caller must FAIL on null, ⛔ never treat "could not read it" as "fine"
 *  (硬规则 3b). */
function bodyOf(text, header) {
  const i = text.indexOf(header);
  if (i < 0) return null;
  const open = text.indexOf("{", i);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    const c = text[j];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(open, j + 1);
    }
  }
  return null;
}

/** The files under the Core src tree that DEFINE `parseFidelityVerdict`. Enumerated (not a
 *  boolean) so a "0 files" reading and a "2 files" reading are distinguishable in the message. */
function fidelityDefiningFiles() {
  const files = tsFilesUnder(SRC);
  assert.ok(
    files.length > 0,
    `no .ts files under ${SRC} — the scan surface itself is missing; this is NOT-EVALUATED, not PASS`,
  );
  return files.filter((f) => FID_DEF_RE.test(fs.readFileSync(f, "utf8")));
}

test("exactly one `export function parseFidelityVerdict(` definition exists under packages/quay/src", () => {
  const defining = fidelityDefiningFiles();
  assert.equal(
    defining.length,
    1,
    `expected exactly 1 definition of parseFidelityVerdict under ${rel(SRC)}, found ${defining.length}` +
      (defining.length > 0 ? `:\n  ${defining.map(rel).join("\n  ")}` : "") +
      "\n  0 = the wrapper was deleted (callers lost the delegation); ≥2 = the implementation was" +
      " copied/half-moved instead of kept as one thin wrapper.",
  );
});

test("the single parseFidelityVerdict definition DELEGATES to parseBinaryVerdict", () => {
  const defining = fidelityDefiningFiles();
  assert.equal(defining.length, 1, "precondition: exactly one definition (see the previous test)");
  const file = defining[0];
  const body = bodyOf(fs.readFileSync(file, "utf8"), "export function parseFidelityVerdict");
  assert.ok(
    body !== null,
    `${rel(file)} defines parseFidelityVerdict but its body could not be read — NOT-EVALUATED, not PASS`,
  );
  assert.match(
    body,
    /parseBinaryVerdict/,
    `${rel(file)} defines parseFidelityVerdict WITHOUT delegating to parseBinaryVerdict — the` +
      " fail-closed parse loop was re-inlined (GOAL-032's single-implementation guarantee is gone).",
  );
});

test("goal-driver's parseSemanticSufficiencyVerdict DELEGATES to parseBinaryVerdict", () => {
  assert.ok(
    fs.existsSync(GOAL_DRIVER),
    `${rel(GOAL_DRIVER)} is missing — the sufficiency caller cannot be judged (NOT-EVALUATED, not PASS)`,
  );
  const body = bodyOf(fs.readFileSync(GOAL_DRIVER, "utf8"), "export function parseSemanticSufficiencyVerdict");
  assert.ok(
    body !== null,
    `${rel(GOAL_DRIVER)} no longer defines parseSemanticSufficiencyVerdict — the sufficiency side` +
      " of GOAL-032's convergence cannot be judged (NOT-EVALUATED, not PASS)",
  );
  assert.match(
    body,
    /parseBinaryVerdict/,
    `${rel(GOAL_DRIVER)}::parseSemanticSufficiencyVerdict does not delegate to parseBinaryVerdict —` +
      " the fail-closed parse loop was re-inlined on the driver side.",
  );
});

test("the kernel still exports parseBinaryVerdict", () => {
  assert.ok(
    fs.existsSync(KERNEL),
    `${rel(KERNEL)} is missing — the shared parser both wrappers delegate to is gone (NOT-EVALUATED, not PASS)`,
  );
  assert.match(
    fs.readFileSync(KERNEL, "utf8"),
    /^export function parseBinaryVerdict\b/m,
    `${rel(KERNEL)} no longer exports parseBinaryVerdict — both thin wrappers would be delegating to nothing.`,
  );
});
