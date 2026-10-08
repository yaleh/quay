// @test-group engine
// carrier-registry-completeness.test.mjs — the COMPLETENESS gate for docs/carrier-registry.json
// (tasks/gap-carrier-registry-declaration-with-unregistered-red-check).
//
// WHY: quay's processes have no RPC; their coupling lives in PERSISTENT CARRIER files under
// .quay/* (…-outcome.jsonl, …-control.json, …-state.json …). A static import graph cannot see
// them, so "who writes / who reads" could only be guessed by lexical search. This test turns the
// registry into a MECHANICAL contract:
//   (1) every carrier name that appears in non-test code as a string/template literal is DECLARED
//       in docs/carrier-registry.json — a newly-written carrier literal that is NOT registered
//       fails here (and therefore in the fan-in suite);
//   (2) the registry carries no STALE entry — a declared name that no longer appears in code also
//       fails, so the registry cannot rot in either direction;
//   (3) the carriers declared by DRIVER_KINDS (plugin/scripts/driver-runtime.ts) carry their
//       kind's driver file as `owner`, so a driver↔registry drift fails too. Dually, an owner
//       OUTSIDE those drivers must name a real module file in the repo (`ownerIsRealModule`) — the
//       registry schema permits a declared non-driver writer module (e.g. a kernel primitive), and a
//       fabricated path is still rejected.
//
// POSITION, NOT KEYWORD (硬规则 2): comments are MASKED before extraction (via the shared
// source-text-lib.ts#maskComments, a lexical state machine that skips string/template literals),
// so a carrier name merely MENTIONED in a comment never counts; only a literal does.
//
// THE PREDICATE (one definition — the registry was built with it; this test judges against it):
// a carrier name is a `/`-separated PATH SEGMENT of a string/template literal whose value fully
// matches  [.]?<name>( .jsonl | -control.json | -state.json | -desired.json | -takeover.json ),
// plus the four fixed names anchor.json / server.json / full-suite-state.json / worker-dispatch.json.
// The segment boundary (string edge or `/`) is load-bearing: it rejects a suffix that only
// EXTENDS an interpolated prefix (`` `${id}.audit.jsonl` `` is not a name) and a name embedded in a
// larger sentence (`<transcript.jsonl>` inside a usage string).
//
// The first test pins a KNOWN-TRUE sample, so a predicate that silently stops matching reports
// 谓词失效 instead of passing vacuously (硬规则 2 — the zero-count control).
//
// Run: scripts/test.sh plugin/test/carrier-registry-completeness.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maskComments } from "../scripts/source-text-lib.ts";
import { DRIVER_KINDS } from "../scripts/driver-runtime.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY_PATH = path.join(REPO_ROOT, "docs", "carrier-registry.json");

/** The one name predicate. A path segment (or a fixed name) that IS a carrier filename. */
const CARRIER_SEGMENT =
  /^[.]?([A-Za-z0-9][A-Za-z0-9_.-]*)((?:[.]jsonl|-control[.]json|-state[.]json|-desired[.]json|-takeover[.]json))$/;
const FIXED_NAMES = new Set(["anchor.json", "server.json", "full-suite-state.json", "worker-dispatch.json"]);
const KIND_VOCABULARY = new Set(["jsonl-log", "state-json", "control-json", "lock", "other"]);
const UNOWNED = "unowned-yet";
const KNOWN_TRUE_SAMPLE = "worker-outcome.jsonl";

/** Is `owner` a real module file (a repo-relative path to a tracked source file)?
 *
 *  The registry schema is `owner: <declared writer module repo-relative path> | "unowned-yet"`, so a
 *  module OUTSIDE the six DRIVER_KINDS drivers is a legitimate owner — e.g. the kernel primitive
 *  `packages/quay/src/kernel/task-transition.ts` writes `.quay/task-status-events.jsonl`
 *  (GOAL-030). The original rule (owner MUST be a DRIVER_KINDS driver) predates non-driver owned
 *  carriers; this keeps its intent — owning a carrier is a DECLARED act, so a fabricated or typo'd
 *  path is still rejected — without confining ownership to drivers. */
function ownerIsRealModule(owner) {
  if (typeof owner !== "string" || !/\.(ts|mts|cts|mjs|cjs|js)$/.test(owner)) return false;
  try {
    return fs.statSync(path.join(REPO_ROOT, owner)).isFile();
  } catch {
    return false;
  }
}

/** Every carrier name carried by a single string/template literal VALUE (path-segment semantics). */
function carrierNamesInValue(value) {
  const out = [];
  for (const seg of String(value).split("/")) {
    if (CARRIER_SEGMENT.test(seg) || FIXED_NAMES.has(seg)) out.push(seg);
  }
  return out;
}

/** All non-test .ts under packages/<pkg>/src and plugin/scripts — the scanned corpus. */
function listSourceFiles() {
  const out = [];
  const walk = (dir) => {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith(".ts") && !/\.test\.ts$|\.spec\.ts$/.test(e.name)) out.push(full);
    }
  };
  const packagesDir = path.join(REPO_ROOT, "packages");
  for (const p of fs.readdirSync(packagesDir)) {
    const src = path.join(packagesDir, p, "src");
    if (fs.existsSync(src)) walk(src);
  }
  walk(path.join(REPO_ROOT, "plugin", "scripts"));
  return out;
}

let _scan = null;
/** name → first occurrence {file, line} over the code corpus. Computed once, shared by all tests. */
function scanCodeCarriers() {
  if (_scan) return _scan;
  const names = new Map();
  for (const file of listSourceFiles()) {
    const src = fs.readFileSync(file, "utf8");
    const mask = maskComments(src);
    const n = src.length;
    let i = 0;
    while (i < n) {
      const c = src[i];
      if ((c === '"' || c === "'" || c === "`") && mask[i] !== 1) {
        const q = c;
        const start = i;
        i++;
        let value = "";
        let closed = false;
        while (i < n) {
          if (src[i] === "\\") {
            value += src[i] + (src[i + 1] ?? "");
            i += 2;
            continue;
          }
          if (src[i] === q) {
            closed = true;
            i++;
            break;
          }
          value += src[i];
          i++;
        }
        if (closed) {
          const line = src.slice(0, start).split("\n").length;
          for (const name of carrierNamesInValue(value)) {
            if (!names.has(name)) names.set(name, { file: path.relative(REPO_ROOT, file), line });
          }
        }
        continue;
      }
      i++;
    }
  }
  _scan = names;
  return names;
}

function readRegistry() {
  const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  assert.ok(Array.isArray(parsed.carriers), "docs/carrier-registry.json must carry a `carriers` array");
  return parsed.carriers;
}

// ── the zero-count control: the predicate still matches a KNOWN-TRUE sample ─────────────────────

test("dry-run: the name predicate extracts the known-true sample (worker-outcome.jsonl)", () => {
  const names = scanCodeCarriers();
  assert.ok(
    names.has(KNOWN_TRUE_SAMPLE),
    `谓词失效 / PREDICATE-FAILED: the known-true sample "${KNOWN_TRUE_SAMPLE}" (a real carrier read ` +
      `and written across many files) was NOT extracted by the name predicate. This is a BROKEN ` +
      `PREDICATE, not a registry gap — fix the predicate, do not add the sample to the registry.`,
  );
});

// ── (1) code ⊆ registry : an unregistered carrier literal fails ─────────────────────────────────

test("completeness: every carrier name in code is declared in the registry", () => {
  const names = scanCodeCarriers();
  const declared = new Set(readRegistry().map((e) => e.name));
  const missing = [...names.keys()]
    .filter((n) => !declared.has(n))
    .sort()
    .map((n) => `${n} (first seen ${names.get(n).file}:${names.get(n).line})`);
  assert.deepEqual(
    missing,
    [],
    `未登记的载体 / unregistered carriers (code has a carrier name that docs/carrier-registry.json ` +
      `does not declare — add an entry):\n  ${missing.join("\n  ")}`,
  );
});

// ── (2) registry ⊆ code : a stale entry fails ───────────────────────────────────────────────────

test("staleness: every registry entry still appears in code (no stale entry)", () => {
  const names = scanCodeCarriers();
  const stale = readRegistry()
    .map((e) => e.name)
    .filter((n) => !names.has(n))
    .sort();
  assert.deepEqual(
    stale,
    [],
    `陈旧条目 / stale registry entries (declared but no longer present in code — remove or repoint ` +
      `them):\n  ${stale.join("\n  ")}`,
  );
});

// ── registry structure (kind vocabulary + the honest unowned value) ─────────────────────────────

test("structure: each entry has name/kind/owner/readers; kind ∈ vocabulary", () => {
  const entries = readRegistry();
  const problems = [];
  const seen = new Set();
  for (const e of entries) {
    if (typeof e?.name !== "string" || !e.name) problems.push(`bad name: ${JSON.stringify(e)}`);
    if (seen.has(e.name)) problems.push(`duplicate entry: ${e.name}`);
    seen.add(e.name);
    if (!KIND_VOCABULARY.has(e.kind)) problems.push(`${e.name}: kind "${e.kind}" not in vocabulary`);
    if (typeof e.owner !== "string" || !e.owner) problems.push(`${e.name}: empty owner`);
    if (e.readers !== "unaudited") problems.push(`${e.name}: readers "${e.readers}" (declaration-only ⇒ "unaudited")`);
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

// ── (3) DRIVER_KINDS-declared carriers carry their driver as owner ──────────────────────────────

test("DRIVER_KINDS: each declared carrier's registry owner is its kind's driver file", () => {
  const byName = new Map(readRegistry().map((e) => [e.name, e]));
  const problems = [];
  let checked = 0;
  const declaredOwnerPaths = new Set();
  for (const kind of Object.keys(DRIVER_KINDS)) {
    const spec = DRIVER_KINDS[kind];
    const expected = `plugin/scripts/${spec.driver}`;
    declaredOwnerPaths.add(expected);
    for (const name of [...spec.carriers, spec.controlFile]) {
      checked++;
      const entry = byName.get(name);
      if (!entry) {
        problems.push(`${kind}: ${name} missing from registry`);
      } else if (entry.owner !== expected) {
        problems.push(`${kind}: ${name} owner="${entry.owner}" but this kind's driver is "${expected}"`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
  // The converse: no entry may claim an owner that is NEITHER a DRIVER_KINDS driver NOR a real
  // module file in the repo (owning a carrier is a DECLARED act — an ad-hoc / fabricated owner path
  // would be an undeclared claim). See `ownerIsRealModule` for why a non-driver owner is legitimate.
  for (const e of readRegistry()) {
    if (e.owner !== UNOWNED && !declaredOwnerPaths.has(e.owner) && !ownerIsRealModule(e.owner)) {
      problems.push(`${e.name}: owner "${e.owner}" is neither a DRIVER_KINDS driver nor a real module file in the repo`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
  assert.ok(checked > 0, "DRIVER_KINDS declared no carriers — the registry/kind source drifted apart");
});
