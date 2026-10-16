// @test-group engine
// gap-routine-semantic-dedup-scan-read-file-join-root-pair.test.mjs — semantic-dedup-scan finding
// `read-file-join-root-pair` (runId `semantic-dedup-scan-1792168649663`, dupKind `byte-identical-body`,
// verdict `real-duplication`, suggestedAction "extract — one shared root-relative reader") named TWO
// sibling checkers that each carried, privately and byte-identically, the root-relative read-or-empty
// pair:
//     const p = path.join(root, rel);
//     return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
//   → plugin/scripts/dual-source-check.ts:66 / plugin/scripts/retired-clause-check.ts:196
//
// WHAT THIS PINS — the CLASS, not the two call sites. The reading is the invariant that CLOSES the
// finding: `plugin/scripts` carries ZERO private copies of that pair, and the one shared home
// (`gate-script-base.ts` → `readRootRel`) is what every former carrier now calls. The 硬规则⑤b sweep for
// the same principle found a THIRD member that the probe's two-file grouping missed —
// `plugin/scripts/red-on-omission-audit.ts:43 readUnder`, byte-identical to the other two after
// identifier normalization — and it is migrated too, so the class is closed rather than half-closed.
//
// The predicate is STRUCTURAL and NAME-AGNOSTIC: it keys on a defined function whose parameters are
// (root…, rel…) and whose body binds a local to `path.join(…)` and then guards a read of THAT SAME
// local with `existsSync`. A rename of the helper (`readFile` / `readUnder` / anything else) cannot
// hide it — the backreference ties the guard and the read to the joined local, not to a name.
//
// ⛔ WHY THE NEGATIVE HALF MATTERS (硬规则 2 / 3b): a predicate that only ever reads "no private copy
// here" against sources that already lack one is an echo — it cannot take a false value, so it proves
// nothing about the tree. Both directions are therefore exercised on fixtures below: the VERBATIM
// retired bodies must read as private copies, and the adopted/renamed/unrelated spellings must not.
//
// Run: node --test plugin/test/gap-routine-semantic-dedup-scan-read-file-join-root-pair.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { readRootRel, readFileSafe } from "../scripts/gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "..", "scripts");

function scriptTsFiles() {
  return fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".ts"));
}

function sourceOf(rel) {
  return fs.readFileSync(path.join(SCRIPTS_DIR, rel), "utf8");
}

/** The three files the finding named (two) plus the 5b sweep's third member — all now migrated. */
const FORMER_CARRIERS = [
  "dual-source-check.ts",
  "retired-clause-check.ts",
  "red-on-omission-audit.ts",
];

// ── the structural, name-agnostic predicate ─────────────────────────────────────────────────────────

/** Body text of the brace block whose `{` sits at `open`, by brace matching (string/comment naive —
 *  the retired bodies and this tree's carriers carry no braces inside strings in this shape). */
function blockAt(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

/** `function name(a, b) {` and `const name = (a, b) => {` — both definition forms get scanned, so the
 *  ratchet does not depend on which style a future carrier picks. */
const DEFINITIONS = [
  /\bfunction\s+(\w+)\s*\(([^)]*)\)[^{;]*\{/g,
  /\b(?:const|let|var)\s+(\w+)\s*=\s*\(([^)]*)\)\s*=>\s*\{/g,
];

/** A local bound to `path.join(…)`, then an `existsSync(<that same local>)` ternary whose read arm is
 *  `readFileSync(<that same local>, …)` and whose empty arm is a string literal. */
const PRIVATE_ROOT_READER_BODY =
  /(?:const|let|var)\s+(\w+)\s*=\s*path\.join\([^)]*\)[\s\S]{0,200}?existsSync\(\s*\1\s*\)[\s\S]{0,120}?readFileSync\(\s*\1\s*[,)][\s\S]{0,60}?\)\s*:\s*["'`]/;

/** Names of functions in `source` that ARE a private root-relative read-or-empty helper. */
function privateRootReaders(source) {
  const found = [];
  for (const re of DEFINITIONS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source))) {
      const [, name, params] = m;
      if (!/\broot\b/.test(params) || !/\brel\b/.test(params)) continue;
      if (PRIVATE_ROOT_READER_BODY.test(blockAt(source, m.index + m[0].length - 1))) found.push(name);
    }
  }
  return found;
}

// ── AC1 — the single source (the ratchet: a redefinition turns this RED) ─────────────────────────────

test("AC1 — readRootRel is defined exactly once, in gate-script-base.ts", () => {
  const defs = scriptTsFiles().filter((f) => /\bfunction readRootRel\b/.test(sourceOf(f)));
  assert.deepEqual(
    defs,
    ["gate-script-base.ts"],
    `readRootRel must have a single definition; found: ${defs.length ? defs.join(", ") : "none"}`,
  );
});

// ── AC1/AC2 — the class is closed: no private copy survives anywhere under plugin/scripts ────────────

test("AC1 — no plugin/scripts source defines a private root-relative read-or-empty helper", () => {
  const offenders = scriptTsFiles()
    .map((f) => [f, privateRootReaders(sourceOf(f))])
    .filter(([, names]) => names.length > 0)
    .map(([f, names]) => `${f}: ${names.join(", ")}`);
  assert.deepEqual(
    offenders,
    [],
    `the root-relative read-or-empty pair must have exactly one home (gate-script-base.readRootRel); ` +
      `still privately defined in: ${offenders.join(" | ") || "none"}`,
  );
});

test("AC2 — each former carrier imports and CALLS the shared reader", () => {
  for (const f of FORMER_CARRIERS) {
    const src = sourceOf(f);
    assert.match(
      src,
      /import\s*\{[^}]*\breadRootRel\b[^}]*\}\s*from\s*["']\.\/gate-script-base\.ts["']/,
      `${f} must import readRootRel from ./gate-script-base.ts`,
    );
    assert.match(src, /\breadRootRel\s*\(/, `${f} must CALL the shared reader (an import alone is inert)`);
  }
});

// ── AC2 — the negative control (both directions, on fixtures) ────────────────────────────────────────

test("AC2 — the predicate can take BOTH values (硬规则 2 negative control)", () => {
  // The VERBATIM retired bodies for all three carriers — these MUST read as private copies.
  const retired = {
    "readFile (dual-source-check / retired-clause-check, retired)": `
function readFile(root: string, rel: string): string {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}
`,
    "readUnder (red-on-omission-audit, retired)": `
function readUnder(root: string, rel: string): string {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
}
`,
    "renamed copy (name must NOT hide it)": `
function loadRelative(root: string, rel: string): string {
  const target = path.join(root, rel);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
}
`,
    "arrow-form copy (definition style must NOT hide it)": `
const readRel = (root: string, rel: string) => {
  const q = path.join(root, rel);
  return fs.existsSync(q) ? fs.readFileSync(q, "utf8") : "";
};
`,
  };
  for (const [label, src] of Object.entries(retired)) {
    assert.notDeepEqual(privateRootReaders(src), [], `${label} must read as a private root reader`);
  }

  // What replaced them: the shared reader, called. Plus two look-alikes that are NOT this class, so the
  // predicate is not merely "any existsSync + readFileSync".
  const adopted = {
    "carrier (adopted)": `
function runCheck(root: string): string {
  const text = readRootRel(root, "orchestration/orchestrator-tick-core.md");
  return text;
}
`,
    "guarded read of a NON-root-relative path (signature arm)": `
function readCliConfig(cliPath: string): string {
  return fs.existsSync(cliPath) ? fs.readFileSync(cliPath, "utf8") : "";
}
`,
    "existsSync + readFileSync on DIFFERENT locals (shape arm)": `
function loadPair(root: string, rel: string): string {
  const p = path.join(root, rel);
  return fs.existsSync(root) ? fs.readFileSync(p, "utf8") : "";
}
`,
  };
  for (const [label, src] of Object.entries(adopted)) {
    assert.deepEqual(privateRootReaders(src), [], `${label} must NOT read as a private root reader`);
  }
});

// ── AC2 — semantics: the shared reader is exactly readFileSafe ∘ path.join ───────────────────────────

test("AC2 — readRootRel reads UTF-8 and agrees with readFileSafe(path.join(root, rel))", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "readrootrel-"));
  try {
    fs.writeFileSync(path.join(dir, "present.txt"), "hello\n");
    fs.mkdirSync(path.join(dir, "nested"));
    fs.writeFileSync(path.join(dir, "nested", "deep.txt"), "deep\n");

    for (const rel of ["present.txt", "nested/deep.txt", "absent.txt"]) {
      assert.equal(
        readRootRel(dir, rel),
        readFileSafe(path.join(dir, rel)),
        `readRootRel(root, ${JSON.stringify(rel)}) must equal readFileSafe(path.join(root, rel))`,
      );
    }
    assert.equal(readRootRel(dir, "present.txt"), "hello\n");
    assert.equal(readRootRel(dir, "nested/deep.txt"), "deep\n");
    assert.equal(readRootRel(dir, "absent.txt"), "");

    // The ONE documented divergence from the retired copies: an existing-but-UNREADABLE path. The
    // copies let `readFileSync` throw; readFileSafe's convention ("treat unreadable as empty") returns
    // "". Both former carriers consume "" as a FAILURE signal, never as a pass — so this cannot turn a
    // real problem green. A directory is the portable unreadable path (EISDIR).
    //
    // ⛔ Asserted as a MEASURED divergence, not asserted by construction (硬规则 2/4): the retired
    // expression is really run here and really throws — otherwise the `""` below would be an echo of
    // "readFileSync on a directory happens to return empty", which it does not.
    const dirAbs = path.join(dir, "nested");
    assert.equal(fs.existsSync(dirAbs), true, "the unreadable path must EXIST (else it is the absent case)");
    assert.throws(
      () => fs.readFileSync(dirAbs, "utf8"),
      "the retired expression (readFileSync with NO existsSync-ternary guard for the throw) really throws",
    );
    assert.equal(readRootRel(dir, "nested"), "", "…while the shared reader yields \"\" instead");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
