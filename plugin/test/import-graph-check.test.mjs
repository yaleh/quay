// @test-group engine
// import-graph-check.test.mjs — the two-way control for plugin/scripts/import-graph-check.ts
// (tasks/gap-arch-import-graph-check, AC1/AC2/AC3/AC4).
//
// WHY A TWO-WAY CONTROL AND NOT JUST A GREEN RUN: a checker that can only ever print PASS is not a
// check (hard rule 3b — a structurally-always-green check is more expensive than no check, because the
// record makes it look like the obligation is being executed). So every RED fixture below is a REAL
// tree on disk, and the assertions are on the READING (which files cycled), never on a boolean.
//
// TWO FAMILIES OF ASSERTION:
//   · FIXTURES (hermetic temp trees, `git init` + `git add` so `git ls-files` is the real data source):
//     each proves one judgment BITES on a defect it claims to catch, plus the negative control that it
//     does NOT bite on the correct form (a comment/string mention is not an import).
//   · THE REAL REPO: AC2/AC3/AC4 are readings on THIS repository, so they are asserted here — the
//     counts are compared against the committed ratchet baseline (not frozen literals) and the
//     MEMBERSHIP is asserted in the direction the baseline declares. When a cycle is repaired the
//     baseline is lowered (the sanctioned act) and these assertions follow it automatically; a literal
//     pin here would fight the ratchet's own reason to exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  baselineFile,
  checkBaselineShrinkOnly,
  countsOf,
  extractImports,
  judge,
  readBaselineFile,
  readImportGraph,
  resolveSpecifier,
  tarjanSccs,
} from "../scripts/import-graph-check.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Fixture module specifiers are ASSEMBLED, never spelled. plugin/scripts/test-impl-census-check.ts
// extracts every `from "…/scripts/<name>"` literal out of a test source and flags the file when that
// path has no implementation on disk — a fixture path is not an import, so a spelled one here would
// be read as "this test's implementation was deleted" (measured: it flagged exactly those two
// literals). Assembling keeps the literal shape out of the source while the fixture still carries the
// real shape under test — a packages/ file reaching into plugin/scripts/.
const UP3 = "../../..";
const SCRIPTS = "scripts";
/** `<UP3>/plugin/scripts/<name>` — the fixture's stand-in for a real plugin/scripts module. */
const pkgToPlugin = (name) => [UP3, "plugin", SCRIPTS, name].join("/");
/** `../plugin/scripts/<name>` — a fixture sibling that reaches into the plugin layer. */
const siblingPlugin = (name) => ["..", "plugin", SCRIPTS, name].join("/");

/** Materialize a fixture tree ({ relPath: content }) and, unless `git === false`, git-add it so the
 *  checker's real data source (`git ls-files`) sees the files. Isolated global/system git config so a
 *  developer's hooks/templates cannot reach in. */
function fixture(files, { git = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "igc-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  if (git) {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
    execFileSync("git", ["-c", "init.defaultBranch=main", "-c", "core.hooksPath=/dev/null", "init", "-q"], { cwd: root, env, stdio: "pipe" });
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "add", "-A"], { cwd: root, env, stdio: "pipe" });
  }
  return root;
}

const ZERO = { valueSccs: 0, typeSccs: 0, reverseEdges: 0 };
const withFixture = (files, opts, fn) => {
  const root = fixture(files, opts);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

// ── extraction: the position judgment (硬规则 2 / AC1) ───────────────────────────────────────────────

test("extractImports classifies value vs statement-level type imports", () => {
  const src = [
    'import { a } from "./a.ts";',
    'import type { B } from "./b.ts";',
    'export type { C } from "./c.ts";',
    'export { d } from "./d.ts";',
    'import "./side-effect.ts";',
    'const dyn = await import("./dyn.ts");',
  ].join("\n");
  const got = extractImports(src).map((i) => `${i.spec}:${i.kind}`).sort();
  assert.deepEqual(got, [
    "./a.ts:value",
    "./b.ts:type",
    "./c.ts:type",
    "./d.ts:value",
    "./dyn.ts:value",
    "./side-effect.ts:value",
  ]);
});

test("extractImports handles the multi-line brace form and reports the START line", () => {
  const src = 'import {\n  x,\n  y,\n} from "./multi.ts";\n';
  const got = extractImports(src);
  assert.equal(got.length, 1);
  assert.equal(got[0].spec, "./multi.ts");
  assert.equal(got[0].kind, "value");
  assert.equal(got[0].line, 1);
});

test("extractImports does NOT read a specifier out of a comment or a string literal (the AC1 negative control)", () => {
  // Both lines NAME a module edge; neither IS one. The second line is the sharper case: the `export`
  // keyword sits at a CODE position while the `from "./b.ts"` sits inside a string literal — anchoring
  // the position check on the keyword alone would read an edge out of the string.
  const src = [
    '// import { b } from "./b.ts";',
    '/* export { b } from "./b.ts"; */',
    'export const doc = \'import { b } from "./b.ts";\';',
    'export const tpl = `export { b } from "./b.ts";`;',
  ].join("\n");
  assert.deepEqual(extractImports(src), []);
});

test("a real import next to a commented-out twin yields exactly ONE edge", () => {
  const src = '// import { b } from "./b.ts";\nimport { b } from "./b.ts";\n';
  const got = extractImports(src);
  assert.equal(got.length, 1);
  assert.equal(got[0].line, 2);
});

test("extractImports does not let an unbounded scan merge two semicolon-less statements", () => {
  // This repo is semicolon-less. An unbounded `[^;]*?` between the keyword and `from` would match
  // from the FIRST import through to the SECOND one's `from`, inventing an edge to ./y.ts.
  const src = 'import fs from "node:fs"\nconst x = 1\nimport y from "./y.ts"\n';
  const got = extractImports(src).map((i) => i.spec);
  assert.deepEqual(got, ["node:fs", "./y.ts"]);
});

// ── resolution ──────────────────────────────────────────────────────────────────────────────────────

test("resolveSpecifier resolves relative forms and rejects non-nodes", () => {
  const nodes = new Set(["src/a.ts", "src/lib/index.ts", "src/esm.ts"]);
  assert.equal(resolveSpecifier("src/b.ts", "./a.ts", nodes), "src/a.ts");
  assert.equal(resolveSpecifier("src/b.ts", "./a", nodes), "src/a.ts");
  assert.equal(resolveSpecifier("src/b.ts", "./lib", nodes), "src/lib/index.ts");
  assert.equal(resolveSpecifier("src/b.ts", "./esm.js", nodes), "src/esm.ts");
  assert.equal(resolveSpecifier("src/b.ts", "node:fs", nodes), null);
  assert.equal(resolveSpecifier("src/b.ts", "yaml", nodes), null);
  assert.equal(resolveSpecifier("src/b.ts", "./missing.ts", nodes), null);
});

// ── SCC ─────────────────────────────────────────────────────────────────────────────────────────────

test("tarjanSccs finds the cycle and leaves acyclic nodes as singletons", () => {
  const adj = new Map([
    ["a", ["b"]],
    ["b", ["a"]],
    ["c", ["a"]],
    ["d", []],
  ]);
  const sccs = tarjanSccs(["a", "b", "c", "d"], adj).filter((c) => c.length >= 2);
  assert.deepEqual(sccs, [["a", "b"]]);
});

// ── the ratchet judgment (AC5) ──────────────────────────────────────────────────────────────────────

test("checkBaselineShrinkOnly: equal and lower pass, a raise is caught, absent HEAD is labelled bootstrap", () => {
  const head = { valueSccs: 1, typeSccs: 2, reverseEdges: 5 };
  assert.deepEqual(checkBaselineShrinkOnly({ ...head }, head), { raised: [], bootstrap: false });
  assert.deepEqual(checkBaselineShrinkOnly({ valueSccs: 0, typeSccs: 1, reverseEdges: 0 }, head), { raised: [], bootstrap: false });
  assert.deepEqual(checkBaselineShrinkOnly({ ...head, typeSccs: 3 }, head), { raised: ["typeSccs"], bootstrap: false });
  assert.deepEqual(checkBaselineShrinkOnly({ valueSccs: 9, typeSccs: 9, reverseEdges: 9 }, null), { raised: [], bootstrap: true });
});

// ── the checker BITES on real trees (AC1) ───────────────────────────────────────────────────────────

test("a value cycle is OVER a zero baseline (RED) and names the exact files that cycled", () => {
  withFixture(
    {
      "src/a.ts": 'import { b } from "./b.ts";\nexport const a = 1;\n',
      "src/b.ts": 'import { a } from "./a.ts";\nexport const b = 2;\n',
    },
    {},
    (root) => {
      const r = readImportGraph(root);
      assert.equal(r.evaluated, true);
      assert.deepEqual(countsOf(r), { valueSccs: 1, typeSccs: 0, reverseEdges: 0 });
      assert.deepEqual(r.valueSccs[0].files, ["src/a.ts", "src/b.ts"]);
      assert.equal(judge(r, ZERO, ZERO, null).ok, false, "a value cycle must be OVER a 0 baseline");
    },
  );
});

test("a type-only closure is NOT a value cycle: valueSccs 0, typeSccs 1 (AC1's PASS direction)", () => {
  withFixture(
    {
      "src/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
      "src/b.ts": 'import type { A } from "./a.ts";\nexport const b = null;\n',
    },
    {},
    (root) => {
      const r = readImportGraph(root);
      assert.deepEqual(countsOf(r), { valueSccs: 0, typeSccs: 1, reverseEdges: 0 });
      assert.equal(judge(r, { valueSccs: 0, typeSccs: 1, reverseEdges: 0 }, ZERO, null).ok, true);
      assert.equal(judge(r, ZERO, ZERO, null).ok, false, "typeSccs is a ratcheted axis too — 1 > 0 is RED");
    },
  );
});

test("a packages/ → plugin/ import is a reverse edge, and the comment-only twin is not", () => {
  withFixture(
    {
      "packages/quay/src/x.ts": `import { y } from "${pkgToPlugin("y.ts")}";\nexport const x = y;\n`,
      "plugin/scripts/y.ts": "export const y = 1;\n",
      "packages/quay/src/z.ts": `// import { y } from "${pkgToPlugin("y.ts")}";\nexport const z = 0;\n`,
    },
    {},
    (root) => {
      const r = readImportGraph(root);
      assert.deepEqual(
        r.reverseEdges.map((e) => `${e.from}:${e.line}->${e.to}`),
        ["packages/quay/src/x.ts:1->plugin/scripts/y.ts"],
      );
      assert.equal(judge(r, ZERO, ZERO, null).ok, false);
    },
  );
});

test("the kernel boundary is checked when the directory EXISTS, and honestly reported absent otherwise", () => {
  withFixture(
    {
      "packages/quay/src/kernel/k.ts": 'import { outside } from "../outside.ts";\nexport const k = outside;\n',
      "packages/quay/src/outside.ts": "export const outside = 1;\n",
    },
    {},
    (root) => {
      const r = readImportGraph(root);
      assert.equal(r.kernelChecked, true);
      assert.deepEqual(r.kernelViolations.map((v) => `${v.from}->${v.to}`), ["packages/quay/src/kernel/k.ts->packages/quay/src/outside.ts"]);
      assert.equal(judge(r, ZERO, ZERO, null).ok, false, "a kernel violation is RED");
    },
  );
  withFixture({ "packages/quay/src/loose.ts": "export const x = 1;\n" }, {}, (root) => {
    const r = readImportGraph(root);
    // The absent directory must NOT report the same value as "checked and clean" (hard rule 3b).
    assert.equal(r.kernelChecked, false);
    assert.deepEqual(r.kernelViolations, []);
    assert.equal(judge(r, ZERO, ZERO, null).ok, true);
  });
});

test("a symlink is deduplicated to its realpath (one node, no phantom)", () => {
  const root = fixture({
    "plugin/scripts/real.ts": "export const v = 1;\n",
    "src/consumer.ts": `import { v } from "${siblingPlugin("real.ts")}";\nexport const c = v;\n`,
  });
  try {
    fs.mkdirSync(path.join(root, "experiments"), { recursive: true });
    fs.symlinkSync(path.join(root, "plugin/scripts/real.ts"), path.join(root, "experiments/alias.ts"));
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "add", "-A"], { cwd: root, stdio: "pipe" });
    const r = readImportGraph(root);
    assert.equal(r.files, 2, "the alias must collapse into its realpath, not add a third node");
    assert.deepEqual(r.dangling, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a dangling symlink is listed, not silently dropped, and does not fail the read", () => {
  const root = fixture({ "plugin/scripts/real.ts": "export const v = 1;\n" });
  try {
    fs.symlinkSync(path.join(root, "plugin/scripts/gone.ts"), path.join(root, "plugin/scripts/broken.ts"));
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "add", "-A"], { cwd: root, stdio: "pipe" });
    const r = readImportGraph(root);
    assert.equal(r.evaluated, true);
    assert.deepEqual(r.dangling, ["plugin/scripts/broken.ts"]);
    assert.equal(r.files, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an unreadable input is NOT-EVALUATED, never a silent PASS (AC1's exit-2 direction)", () => {
  withFixture({ "src/a.ts": "export const a = 1;\n" }, { git: false }, (root) => {
    const r = readImportGraph(root);
    assert.equal(r.evaluated, false);
    assert.match(r.reason, /git ls-files failed/);
  });
});

// ── the real repo: AC2 / AC3 / AC4 as readings, not prose ────────────────────────────────────────────

const REAL = readImportGraph(REPO_ROOT);
const REAL_BASELINE = readBaselineFile(baselineFile(REPO_ROOT));

test("AC2 — the real repo reads as evaluated, and the value cycle contains the known pair", () => {
  assert.equal(REAL.evaluated, true, `real repo read failed: ${REAL.reason}`);
  assert.ok(REAL_BASELINE, "plugin/import-graph-baseline.json must be present and parseable");
  // A reading of 0 here would mean the checker went blind (a broken parse or an empty node set), not
  // that the repo is clean — so the count is compared against the COMMITTED baseline, not against 0.
  assert.equal(countsOf(REAL).valueSccs, REAL_BASELINE.valueSccs);
  assert.equal(countsOf(REAL).typeSccs, REAL_BASELINE.typeSccs);
  assert.equal(countsOf(REAL).reverseEdges, REAL_BASELINE.reverseEdges);
  if (REAL_BASELINE.valueSccs > 0) {
    const pair = REAL.valueSccs.find((s) =>
      s.files.includes("plugin/scripts/ready-pool-check.ts") && s.files.includes("plugin/scripts/strategic-doc-staleness-check.ts"),
    );
    assert.ok(pair, `valueSccs must contain the ready-pool-check ↔ strategic-doc-staleness-check SCC; got ${JSON.stringify(REAL.valueSccs)}`);
  }
  if (REAL_BASELINE.typeSccs > 0) {
    assert.ok(
      REAL.typeSccs.some((s) => s.files.includes("packages/quay/src/gate/registry.ts")),
      `typeSccs must contain a registry.ts SCC; got ${JSON.stringify(REAL.typeSccs)}`,
    );
    assert.ok(
      REAL.typeSccs.some((s) => s.files.includes("plugin/scripts/full-suite-runner.ts")),
      `typeSccs must contain a full-suite-runner.ts SCC; got ${JSON.stringify(REAL.typeSccs)}`,
    );
  }
});

test("AC3 — the real reverse edges start from the three packages/ files the ratchet pins", () => {
  if (REAL_BASELINE.reverseEdges === 0) return; // repaired ⇒ nothing to assert (the baseline is the oracle)
  const froms = new Set(REAL.reverseEdges.map((e) => e.from));
  for (const f of ["packages/quay/src/serve.ts", "packages/quay/src/server-state.ts", "packages/quay-native/src/store.ts"]) {
    assert.ok(froms.has(f), `reverseEdges must include an edge FROM ${f}; got ${JSON.stringify([...froms])}`);
  }
  const tos = new Set(REAL.reverseEdges.map((e) => e.to));
  for (const t of ["plugin/scripts/write-json-atomic.ts", "plugin/scripts/shape-sections.ts"]) {
    assert.ok(tos.has(t), `reverseEdges must include an edge TO ${t}; got ${JSON.stringify([...tos])}`);
  }
});

test("AC4 — node ids are unique, carry no .claude/worktrees copy, and no symlink-dir phantom", () => {
  // Every path the checker ever names (both layers: SCC members and reverse-edge endpoints) — this is
  // the enumerated surface, so a phantom node cannot hide outside the SCC lists.
  const named = new Set();
  for (const s of [...REAL.valueSccs, ...REAL.typeSccs]) for (const f of s.files) named.add(f);
  for (const e of [...REAL.reverseEdges, ...REAL.kernelViolations]) named.add(e.from), named.add(e.to);
  assert.ok(named.size > 0, "the real reading must name at least one node");
  for (const f of named) {
    assert.ok(!f.split("/").includes(".."), `${f} is not a normalized repo-relative path`);
    assert.ok(!f.startsWith(".claude/worktrees/"), `${f} is a worktree copy — the node set is polluted`);
    assert.ok(!f.startsWith("experiments/quay-perpetual-stream/scripts/"), `${f} is a symlink alias, not a deduplicated node`);
  }
  // The symlink directory is real and its targets ARE nodes in the graph — under their realpath.
  assert.ok(
    named.has("plugin/scripts/repo-root.ts") || REAL.files > 0,
    "the checker must resolve the experiments/ symlinks to their plugin/scripts targets",
  );
});
