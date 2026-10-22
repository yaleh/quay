// @test-group engine
// directory-cycle.test.mjs — the regression guard for AC-916: `packages/quay/src` must have ZERO
// directory-level dependency cycles.
//
// WHY THIS FILE EXISTS (task gap-arch-directory-cycle-src-observation-serve, GOAL-910 AC-916):
// two pure-relocation commits — e7e84366a (serve* modules into `src/serve/`) and d21a018aa
// (observation.ts split into a root facade + `observation/`) — each looked harmless, and together
// they closed the 3-directory SCC {".", "observation", "serve"}. The criterion was only evaluated
// by AC-916's ad-hoc goal script, so the next relocation could close a cycle with nothing watching.
// This test is the standing guard: it re-derives the SAME directory graph the goal criterion does.
//
// THE GRAPH (identical 口径 to AC-916's criterion, which was cross-checked against archguard's
// package-scoped moduleGraph — 27/27 directory pairs matched):
//   · nodes  = directories under `packages/quay/src` containing at least one `.ts` file
//   · edges  = for every LINE-START `import` / `export … from` statement whose specifier is an
//              in-repo relative path, `dirname(importer)` → `dirname(target)`; self-edges dropped
//   · cycles = strongly connected components with ≥ 2 members (Tarjan)
// Only statement POSITION counts (硬规则 2): a path mentioned in a comment or string is not an edge.
//
// ⛔ THE THIRD ARM IS THE POINT (硬规则 3b): if the parser resolves ZERO cross-directory edges, that
// is an INSTRUMENT FAILURE, not "0 cycles" — the two readings are different facts and must not share
// an output. A regex that silently stopped matching (e.g. `.js` specifiers replacing `.ts`) would
// otherwise turn this guard permanently green while measuring nothing. The same distinction lives in
// the goal criterion (exit 2 vs exit 0).
//
// Run:
//   node --test packages/quay/test/directory-cycle.test.mjs
//   scripts/test.sh packages/quay/test/directory-cycle.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root = nearest ancestor carrying `.quay/config.yml` (worktree-safe: never assumes depth). */
function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}

const REPO_ROOT = findRepoRoot(__dirname);
const SRC_REL = "packages/quay/src";

/** Statement-position import specifier, relative only — byte-for-byte the AC-916 criterion's regex. */
const IMPORT_RE = /^\s*(?:import|export)\b[^'"]*?(?:from\s+)?['"]((?:\.{1,2}\/)[^'"]+)['"]/;

/** Every `.ts` file under `dirAbs` (`.d.ts` excluded — declarations carry no runtime edge). */
function walkTs(dirAbs, out = []) {
  for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const p = path.join(dirAbs, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Build the directory graph and its SCCs.
 *
 * Returns `{ evaluated, instrumentFailure, edges, dirs, sccs }`:
 *   · evaluated:false + instrumentFailure:true  — zero cross-directory edges were parsed
 *   · evaluated:true  + sccs:[]                — the tree was measured and has no cycle
 *   · evaluated:true  + sccs:[[…]]             — cycles, each a sorted member list
 * ⛔ `instrumentFailure` is a SEPARATE value, never folded into `sccs.length === 0`.
 */
export function analyzeDirectoryCycles(root, srcRel = SRC_REL) {
  const srcAbs = path.join(root, srcRel);
  const files = fs.existsSync(srcAbs) ? walkTs(srcAbs) : [];
  const relDir = (absFile) => {
    const rel = path.relative(srcAbs, path.dirname(absFile));
    return rel === "" ? "." : rel;
  };

  const graph = new Map();
  const dirSet = new Set();
  let edges = 0;
  for (const f of files) {
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = line.match(IMPORT_RE);
      if (!m) continue;
      const target = path.normalize(path.join(path.dirname(f), m[1]));
      // In-src only; a specifier escaping `src/` (or pointing at a package) is not a directory edge.
      if (!target.startsWith(srcAbs + path.sep) && target !== srcAbs) continue;
      const from = relDir(f);
      const to = relDir(target);
      if (from === to) continue;
      dirSet.add(from);
      dirSet.add(to);
      if (!graph.has(from)) graph.set(from, new Set());
      graph.get(from).add(to);
      edges++;
    }
  }

  if (edges === 0) {
    return { evaluated: false, instrumentFailure: true, edges: 0, dirs: dirSet.size, sccs: [] };
  }

  // Tarjan, iterative-free (small graphs; recursion depth bounded by the directory count).
  let idx = 0;
  const stack = [];
  const onStack = new Set();
  const index = new Map();
  const low = new Map();
  const sccs = [];
  const strongConnect = (v) => {
    index.set(v, idx);
    low.set(v, idx);
    idx++;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const members = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        members.push(w);
      } while (w !== v);
      if (members.length > 1) sccs.push(members.sort());
    }
  };
  for (const v of graph.keys()) if (!index.has(v)) strongConnect(v);

  return { evaluated: true, instrumentFailure: false, edges, dirs: dirSet.size, sccs };
}

/** Build a throwaway `<root>/packages/quay/src/...` fixture from `{ relPath: content }`. */
function makeFixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "directory-cycle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

// ── arm 1: the real tree ───────────────────────────────────────────────────────────────────────────

test("arm 1 — the real packages/quay/src has ZERO directory cycles (AC-916)", () => {
  const r = analyzeDirectoryCycles(REPO_ROOT);
  assert.equal(r.instrumentFailure, false, "the parser read no cross-directory edges — instrument failure, not 0 cycles");
  assert.equal(r.evaluated, true);
  assert.deepEqual(r.sccs, [], `directory cycle(s) under ${SRC_REL}: ${JSON.stringify(r.sccs)}`);
  assert.ok(r.edges > 0, "a measured tree must have edges");
});

// ── arm 2: the guard can go red ────────────────────────────────────────────────────────────────────

test("arm 2 — a synthetic two-directory cycle IS reported (the guard takes false)", (t) => {
  const root = makeFixture(t, {
    [`${SRC_REL}/alpha/index.ts`]: 'import { b } from "../beta/index.ts";\nexport const a = b;\n',
    [`${SRC_REL}/beta/index.ts`]: 'import { a } from "../alpha/index.ts";\nexport const b = a;\n',
  });
  const r = analyzeDirectoryCycles(root);
  assert.equal(r.evaluated, true);
  assert.equal(r.instrumentFailure, false);
  assert.deepEqual(r.sccs, [["alpha", "beta"]], `expected exactly the alpha↔beta SCC; got ${JSON.stringify(r.sccs)}`);
});

test("arm 2b — a same-directory import is NOT a cross-directory edge (no false cycle)", (t) => {
  const root = makeFixture(t, {
    [`${SRC_REL}/solo/one.ts`]: 'import { two } from "./two.ts";\nexport const one = two;\n',
    [`${SRC_REL}/solo/two.ts`]: "export const two = 1;\n",
  });
  const r = analyzeDirectoryCycles(root);
  // Zero CROSS-directory edges here — this fixture exists to prove the edge filter, so the reading
  // is the instrument-failure value (arm 3), NOT a silent "0 cycles".
  assert.equal(r.edges, 0);
  assert.equal(r.instrumentFailure, true);
  assert.deepEqual(r.sccs, []);
});

// ── arm 3: "read nothing" ≠ "0 cycles" ────────────────────────────────────────────────────────────

test("arm 3 — ZERO parsed cross-directory edges is INSTRUMENT FAILURE, never '0 cycles'", (t) => {
  const root = makeFixture(t, {
    // File present, but only node builtins are imported: nothing in-src to connect.
    [`${SRC_REL}/only/index.ts`]: 'import fs from "node:fs";\nexport const x = fs;\n',
  });
  const r = analyzeDirectoryCycles(root);
  assert.equal(r.evaluated, false, "a parser that read nothing must not claim to have evaluated the tree");
  assert.equal(r.instrumentFailure, true);
  assert.deepEqual(r.sccs, [], "the empty list is not the verdict — instrumentFailure is");
});

test("a comment mentioning a path is not an edge (position judgment, 硬规则 2)", (t) => {
  const root = makeFixture(t, {
    [`${SRC_REL}/alpha/index.ts`]: '// import { b } from "../beta/index.ts";\nexport const a = 1;\n',
    [`${SRC_REL}/beta/index.ts`]: '/* import { a } from "../alpha/index.ts"; */\nimport fs from "node:fs";\nexport const b = fs;\n',
  });
  const r = analyzeDirectoryCycles(root);
  // Comment lines do not start with `import`/`export` as a statement ⇒ zero edges ⇒ instrument
  // failure. If comments were counted this would instead read an alpha↔beta cycle.
  assert.equal(r.instrumentFailure, true);
  assert.deepEqual(r.sccs, []);
});
