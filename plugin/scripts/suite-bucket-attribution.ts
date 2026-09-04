// suite-bucket-attribution.ts — gap-ac120-suite-bucket-attribution-mechanism: bucket-level test
// attribution. Input = one test file path; output = the set of buckets it belongs to, drawn from
// { P, S, M }, or UNRESOLVED when the file's subject cannot be statically located.
//
// This is the mechanism half of the "suite 三桶划分" phase (manager-phase-goal AC120): a coarser
// granularity than the FILE-level scoped gate (`select-tests-for-touches.ts`, which stays untouched —
// different granularity, different judgment). The three buckets and their judgment are:
//
//   P — 产品包 / deliverable  : the test's subject is the product package source
//       (`packages/*/(src|bin|dist)`, or the file itself lives under `packages/*/test/`).
//   S — 套件基础设施           : the test's subject is the suite/test-runner surface
//       (`scripts/test.sh`).
//   M — 其余机件               : the test's subject is a plugin mechanism (`plugin/scripts`).
//
// JUDGMENT = STATIC REFERENCE CLOSURE. A test file is attributed by what its text STATICALLY
// references, never by basename pairing and never by directory-ownership ALONE (`plugin/` ships
// wholesale — a file's directory does not decide M). Three reference forms are read:
//
//   1. RELATIVE references — import specifiers and relative path strings (`./x`, `../x`), resolved
//      against the file's own directory and normalized, then classified by which source tree they
//      land in. This is what catches `import … from "../scripts/foo.ts"` (→ `plugin/scripts/foo.ts`).
//   2. PATH LITERALS — the repo-relative path prefixes `plugin/scripts`, `packages/*/(src|bin|dist)`,
//      and `scripts/test.sh` appearing as literal text (a spawned script, a fixture path, a `Run:`
//      header that names how the file is executed). Matched over the raw text — the measured baseline
//      (`orchestration/manager-phase-goal.md` 切换前实测基线) reproduces ONLY when comment/header
//      mentions are counted, so a header comment that names the subject IS a reference for this
//      mechanism.
//   3. SEGMENTED PATH LITERALS — `path.join(…)` / `path.resolve(…)` (and the destructured `join(…)` /
//      `resolve(…)`) calls whose ADJACENT string-literal arguments, joined with `/`, spell a
//      source-tree path (`path.join(repoRoot, "plugin", "scripts", "x.sh")` → `plugin/scripts/x.sh`).
//      Neither form 1 (needs the whole path in one quote pair) nor form 2 (needs contiguous text — a
//      comma-space breaks it) sees the segmented subject; joining the adjacent literal run recovers it
//      (gap-path-join-segmented-parse-blind-spot).
//
// ⛔ A file whose bucket cannot be statically determined returns UNRESOLVED — never a silent default.
//    Defaulting an unreadable subject to a bucket is the "read-unreadable disguised as qualified"
//    defect (hard rule 3b): a test whose subject's prefix is a computed variable
//    (`path.join(pluginDir, "scripts", …)` with `pluginDir = path.resolve(__dirname, "..")`) or lives
//    in a helper module still has NO literal subject path, so it must be reported, not guessed.
//
// Output (canonical, buckets in P,S,M order):
//   P | S | M | P+S | P+M | S+M | P+S+M | UNRESOLVED
//
// Run:
//   node --experimental-strip-types suite-bucket-attribution.ts <test-file> [--root <dir>] [--json]

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry, normalizeRel } from "./gate-script-base.ts";

export type Bucket = "P" | "S" | "M";

// Canonical bucket order for the string form (P first, the deliverable).
const BUCKET_ORDER: readonly Bucket[] = ["P", "S", "M"];

// ── Source-tree reference patterns ────────────────────────────────────────────────────────────────────
// A reference is classified by which source tree it lands in. Each pattern is a literal path prefix:
//   M — `plugin/scripts` as a path segment (followed by `/`, a quote, whitespace, or end — so the bare
//       directory name `"plugin/scripts"` counts, not just `plugin/scripts/…`).
//   P — `packages/<pkg>/(src|bin|dist)/` (a product source tree; the trailing `/` keeps `test/`,
//       `helpers/`, etc. out of the product bucket).
//   S — `scripts/test.sh` (the suite script; matched as a bare substring because a `Run:` header may
//       continue "… must set NODE_COMPILE_CACHE" right after it).
const M_PREFIX = /plugin\/scripts(?=\/|["'`\s]|$)/;
const P_PREFIX = /packages\/[^/]+\/(?:src|bin|dist)\//;
const S_PREFIX = /scripts\/test\.sh/;

// The directory home signal for P: a test file living under `packages/*/test/` belongs to the product
// bucket. This is ONE signal, not the sole one (the reference closure above is the other) — directory
// ownership alone never decides M/S (`plugin/` ships wholesale).
const P_TEST_DIR = /^packages\/[^/]+\/test\//;

/**
 * Classify one normalized repo-relative path-ish reference into a bucket, or null when it names none
 * of the three source trees.
 * @param {string} s — a repo-relative path (already resolved/normalized, or a raw literal).
 * @returns {Bucket | null}
 */
export function classifyPath(s: string): Bucket | null {
  if (M_PREFIX.test(s)) return "M";
  if (P_PREFIX.test(s)) return "P";
  if (S_PREFIX.test(s)) return "S";
  return null;
}

/**
 * Classify a set of repo-relative paths (a dynamic-truth trace's reads+writes) into the bucket set
 * they land in — the SAME classifyPath classifier, applied to RUNTIME-observed paths rather than
 * statically-extracted references. Exported for suite-bucket-drift-check.ts (the dynamic half of the
 * static-vs-truth comparison): the checker unions this with the static `bucketSetOf` and flags a
 * bucket present here but absent there as a `static-vs-truth-drift`.
 * @param {readonly string[]} paths — repo-relative paths (already normalized).
 * @returns {Set<Bucket>}
 */
export function bucketsFromPaths(paths: readonly string[]): Set<Bucket> {
  const out = new Set<Bucket>();
  for (const p of paths ?? []) {
    const b = classifyPath(p);
    if (b) out.add(b);
  }
  return out;
}

/**
 * Resolve a relative specifier (`./x`, `../x`) against a test file's repo-relative path to an
 * absolute repo-relative path.
 * @param {string} fileRel — the test file's repo-relative path (e.g. `plugin/test/foo.test.mjs`).
 * @param {string} spec — the relative specifier (e.g. `../scripts/foo.ts`).
 * @returns {string}
 */
export function resolveRelative(fileRel: string, spec: string): string {
  const dir = path.posix.dirname(normalizeRel(fileRel));
  const joined = dir === "." ? spec : `${dir}/${spec}`;
  return normalizeRel(joined);
}

/**
 * Extract relative import/path specifiers from raw file text: any quoted string (single, double,
 * backtick) that starts with `./` or `../`. Template-literal interpolations (`${…}`) are skipped —
 * they are not static. This one matcher covers both `import … from "./x"` and a relative path literal.
 * @param {string} text
 * @returns {string[]}
 */
export function extractRelativeSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/["'`](\.\.?\/[^"'`\n]*?)["'`]/g)) {
    const spec = m[1];
    if (spec.includes("${")) continue; // dynamic interpolation — not a static reference
    out.push(spec);
  }
  return out;
}

// ── Segmented path.join(…) / path.resolve(…) literal runs ────────────────────────────────────────────
// A subject built as `path.join(repoRoot, "plugin", "scripts", "x.sh")` has no single quoted relative
// path (signal 2's regex needs the whole path in one pair of quotes) and no contiguous `plugin/scripts`
// literal (signal 3 needs contiguous text — a comma-space breaks it). The segmented form spells the
// subject out as a RUN of adjacent string literals; joining the run with `/` recovers the path.

/** The path.join / path.resolve callee: `path.join(`, `path.resolve(`, or the destructured `join(` /
 *  `resolve(` (bare — not a member access like `arr.join(`, which the lookbehind rejects). */
const JOIN_CALL = /(?<![.\w])(?:path\.)?(?:join|resolve)\s*\(/g;

/**
 * Skip over a string/template literal starting at `text[i]` (its opening quote), returning the index
 * just past its closing quote. Handles backslash escapes.
 * @param {string} text
 * @param {number} i — index of the opening quote.
 * @returns {number}
 */
function skipStringLiteral(text: string, i: number): number {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === "\\") { j += 2; continue; }
    if (text[j] === quote) return j + 1;
    j++;
  }
  return j;
}

/**
 * Parse the argument list of a call whose `(` is at `text[openIdx]`, returning the top-level arguments
 * (trimmed), or null when the parens are unbalanced. Nested `()[]{}` and string/template literals are
 * skipped so a `,` or `)` inside them does not split the list.
 * @param {string} text
 * @param {number} openIdx — index of the opening `(`.
 * @returns {string[] | null}
 */
function parseArgList(text: string, openIdx: number): string[] | null {
  let depth = 0;
  const args: string[] = [];
  let start = openIdx + 1;
  let i = openIdx;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") { i = skipStringLiteral(text, i); continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; i++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (ch === ")" && depth === 0) {
        const arg = text.slice(start, i).trim();
        if (arg) args.push(arg);
        return args;
      }
      i++;
      continue;
    }
    if (ch === "," && depth === 1) {
      const arg = text.slice(start, i).trim();
      if (arg) args.push(arg);
      start = i + 1;
      i++;
      continue;
    }
    i++;
  }
  return null; // unbalanced — no closing paren
}

/**
 * The string VALUE of one call argument that is exactly one static string literal, else null. A
 * single/double quoted string always qualifies; a backtick string qualifies only without `${…}` (a
 * template interpolation is not static).
 * @param {string} arg — one trimmed call argument.
 * @returns {string | null}
 */
function staticLiteralValue(arg: string): string | null {
  const q = /^(["'])((?:[^\\"']|\\.)*)\1$/.exec(arg);
  if (q) return q[2];
  const t = /^`([\s\S]*)`$/.exec(arg);
  if (t && !t[1].includes("${")) return t[1];
  return null;
}

/**
 * Extract the segmented-path literal runs from raw file text: within every `path.join(…)` /
 * `path.resolve(…)` call (or the destructured `join(…)` / `resolve(…)`), each maximal run of ≥2
 * ADJACENT static string-literal arguments is joined with `/`. A run interrupted by a non-literal
 * argument (a variable, `os.tmpdir()`, …) is not joined past the interruption — only truly-adjacent
 * literals spell one path segment sequence. This is the "path.join 分段拼接" blind spot: the subject
 * is written out as adjacent literal arguments, invisible to both the relative-path regex (needs the
 * whole path in one quote pair) and the raw path-literal scan (needs contiguous text).
 * @param {string} text
 * @returns {string[]}
 */
export function extractJoinedPathSegments(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(JOIN_CALL)) {
    const openIdx = m.index + m[0].length - 1; // the '('
    const args = parseArgList(text, openIdx);
    if (!args) continue;
    let run: string[] = [];
    const flush = () => {
      if (run.length >= 2) out.push(run.join("/"));
      run = [];
    };
    for (const arg of args) {
      const lit = staticLiteralValue(arg);
      if (lit === null) flush();
      else run.push(lit);
    }
    flush();
  }
  return out;
}

/**
 * Extract candidate repo-relative paths from `path.join(...)` calls: the quoted string fragments
 * concatenated with `/` (e.g. `path.join(REPO_ROOT, "plugin", "scripts", "foo.sh")` →
 * `plugin/scripts/foo.sh`). Variables and `${…}` interpolations are skipped — not static. A
 * candidate leading `./`/`../` is resolved against the file's dir by the caller (like a relative
 * specifier). This closes the path.join-constructed-path blind spot
 * (gap-suite-bucket-attribution-pathjoin-run-header-blind-spot): a mechanism test that references
 * its subject only via `path.join(…, "plugin", "scripts", …)` (no relative import) previously lost
 * the M signal entirely.
 * @param {string} text
 * @returns {string[]}
 */
export function extractPathJoinSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/path\.join\(([^)]*)\)/g)) {
    const frags = [...m[1].matchAll(/["'`]([^"'`${}]+)["'`]/g)].map((x) => x[1]);
    if (frags.length >= 2) out.push(frags.join("/"));
  }
  return out;
}


/**
 * Coerce a file reference (repo-relative or absolute) to a repo-relative path.
 * @param {string} fileRef
 * @param {string} root — repo root (absolute).
 * @returns {string}
 */
export function toRepoRel(fileRef: string, root: string): string {
  const abs = path.isAbsolute(fileRef) ? fileRef : path.join(root, fileRef);
  const rel = path.relative(root, abs);
  return normalizeRel(rel);
}

/**
 * Attribute one test file to its bucket set. Returns the empty set when the subject is statically
 * unlocatable (the caller maps that to UNRESOLVED — never a silent default bucket).
 *
 * @param {string} fileRef — repo-relative (e.g. `plugin/test/foo.test.mjs`) or absolute path.
 * @param {string} [root] — repo root; defaults to `repoRoot()`.
 * @returns {Set<Bucket>}
 */
export function bucketSetOf(fileRef: string, root = repoRoot()): Set<Bucket> {
  const fileRel = toRepoRel(fileRef, root);
  const text = fs.readFileSync(path.join(root, fileRel), "utf8");
  const buckets = new Set<Bucket>();

  // 1. Directory home — `packages/*/test/` → P (one signal, not the whole judgment).
  if (P_TEST_DIR.test(fileRel)) buckets.add("P");

  // 2. Relative references — imports and relative path strings, resolved + classified.
  for (const spec of extractRelativeSpecifiers(text)) {
    const b = classifyPath(resolveRelative(fileRel, spec));
    if (b) buckets.add(b);
  }

  // 2b. path.join(...) constructed paths — the fragments hide the subject (the M/P signal was lost
  //     before this; gap-suite-bucket-attribution-pathjoin-run-header-blind-spot). Join static
  //     fragments; a `./`/`../`-leading candidate resolves against the file's dir.
  for (const spec of extractPathJoinSpecifiers(text)) {
    const candidate = spec.startsWith("./") || spec.startsWith("../") ? resolveRelative(fileRel, spec) : spec;
    const b = classifyPath(candidate);
    if (b) buckets.add(b);
  }

  // 3. Path literals — repo-relative tree prefixes as literal text (spawn args, fixture paths, the
  //    `Run:` header). Matched over the raw text (the baseline reproduces only with these counted).
  // The `Run:` header block ("how to run", e.g. `// Run:\n//   scripts/test.sh …`) is NOT subject
  // evidence ("what it tests") — strip the command lines so a Run:-header `scripts/test.sh` does not
  // alone pin a mechanism test to S (gap-suite-bucket-attribution-pathjoin-run-header-blind-spot).
  // Other comment/assertion mentions of `scripts/test.sh` still count (a test that genuinely asserts
  // a property of test.sh keeps its S signal).
  const subjectText = text.replace(
    /^[ \t]*\/\/[ \t]*Run:[^\n]*(?:\n[ \t]*\/\/[ \t]+(?:scripts\/|node |bash |npx |npm )[^\n]*)*/gm,
    "",
  );
  for (const m of subjectText.matchAll(/plugin\/scripts(?=\/|["'`\s]|$)|packages\/[^/]+\/(?:src|bin|dist)\/|scripts\/test\.sh/g)) {
    const b = classifyPath(m[0]);
    if (b) buckets.add(b);
  }

  // 4. Segmented path literals — `path.join(…, "plugin", "scripts", …)` / `path.resolve(…)` runs of
  //    adjacent string literals, joined and classified (the "path.join 分段拼接" blind spot). Only a
  //    REPO-RELATIVE joined string (starting `plugin/` / `packages/` / `scripts/`) is classified; a
  //    `.`/`..`-prefixed run is RELATIVE to some anchor (signal 2's job — resolve against the file's
  //    directory), and classifyPath would substring-match its embedded source-tree prefix.
  for (const joined of extractJoinedPathSegments(text)) {
    if (joined.startsWith(".")) continue;
    const b = classifyPath(joined);
    if (b) buckets.add(b);
  }

  return buckets;
}

/**
 * Canonical string form of a bucket set: `P | S | M | P+S | P+M | S+M | P+S+M | UNRESOLVED`.
 * @param {Set<Bucket>} buckets
 * @returns {string}
 */
export function canonicalBuckets(buckets: Set<Bucket>): string {
  if (buckets.size === 0) return "UNRESOLVED";
  return BUCKET_ORDER.filter((b) => buckets.has(b)).join("+");
}

/**
 * Attribute one test file to its canonical bucket string.
 * @param {string} fileRef
 * @param {string} [root]
 * @returns {string}
 */
export function attributeBuckets(fileRef: string, root = repoRoot()): string {
  return canonicalBuckets(bucketSetOf(fileRef, root));
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

const usage = `suite-bucket-attribution.ts — bucket-level test attribution (gap-ac120)

Usage:
  node --experimental-strip-types suite-bucket-attribution.ts <test-file> [--root <dir>] [--json]

Output: P | S | M | P+S | P+M | S+M | P+S+M | UNRESOLVED`;

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const fileRef = args[0];
  const rootArg = getArgValue(args, "--root");
  const asJson = args.includes("--json");

  if (!fileRef) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }
  const root = path.resolve(rootArg ?? repoRoot());
  const abs = path.isAbsolute(fileRef) ? fileRef : path.join(root, fileRef);
  if (!fs.existsSync(abs)) {
    process.stderr.write(`suite-bucket-attribution: file not found: ${abs}\n`);
    return 2;
  }

  const buckets = bucketSetOf(fileRef, root);
  const canonical = canonicalBuckets(buckets);
  if (asJson) {
    process.stdout.write(JSON.stringify({ file: toRepoRel(fileRef, root), buckets: [...buckets], canonical }, null, 2) + "\n");
  } else {
    process.stdout.write(`${canonical}\n`);
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "suite-bucket-attribution")) {
  process.exitCode = main(process.argv);
}
