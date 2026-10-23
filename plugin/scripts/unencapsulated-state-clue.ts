#!/usr/bin/env node
// unencapsulated-state-clue.ts — STAGE 1 of the two-stage admission pipeline for the
// `unencapsulated-state` concern kind (task gap-unencapsulated-state-clue-judge-e2e, GOAL-911 AC-924).
//
// THE QUESTION IT MAKES ASKABLE:
//   "Where in this tree does mutable state live OUTSIDE any owning object?" — asked as a CLUE question,
//   never as a verdict. This script scans source files and reports, per file, whether a mechanical
//   signal fired. It never says a concern is present; that is stage 2
//   (`plugin/scripts/unencapsulated-state-judge.ts`, a recorded-verdict replay).
//
// ── WHY THE CLUE LAYER CANNOT OUTPUT A CONFIRMATION (hard rule 3b) ────────────────────────────────────
//   The value list this layer emits is `CLUE_STATES` from `docs/analysis/semantic-admission-contract.mjs`
//   — `candidate` / `clear` / `not-evaluated`. There is no `confirmed` in that vocabulary, and
//   `clueRecord()` rejects a judge value BY NAME at the write site. The separation is structural, not a
//   convention: `assertClueStatesDisjoint` in the contract module is what keeps the two lists apart, and
//   this file imports the list rather than declaring a second copy (a second copy would be free to drift).
//
// ── THE MECHANICAL PREDICATE (deliberately crude) ────────────────────────────────────────────────────
//   A file is a CANDIDATE when it carries at least two of the following readings, counted mechanically:
//     statefulDeclarations — a module-level `let`/`var` binding; a `new Map|Set|WeakMap|WeakSet`
//                            binding (any scope, incl. a class field / `this.x =` assignment);
//     mutationSites        — a `.set(`/`.add(`/`.delete(`/`.clear(` call, or an assignment
//                            (`=`, `+=`, `-=`, `*=`, `/=`, `++`, `--`) to one of the module-level
//                            `let`/`var` bindings above (its own declaration line excluded).
//   Two readings, not one: a single memo table or a single counter is the overwhelmingly common shape in
//   this repo and firing on it alone would make the candidate list useless. The fixtures show why even
//   the two-reading version is still only a LEAD — a memo (`new Map` + `.set`) and a counter (`let` +
//   `+=`) both clear it and both are refuted by the judge.
//
//   ⛔ COMMENTS AND LITERAL TEXT ARE STRIPPED BEFORE COUNTING (hard rule 2 — a mention is not a hit).
//   String/template content is blanked as well, so `counter=${count}` inside a template is text rather
//   than a reassignment. The scanner is quote-aware, so a `//` inside a URL never eats the rest of a line.
//
// ── "I COULD NOT READ THIS FILE" IS ITS OWN STATE (hard rule 3b/6) ───────────────────────────────────
//   A file that cannot be read — permission error, a decode failure, or NUL bytes (a binary wearing a
//   source extension) — is reported as `not-evaluated`, NEVER as `clear`. `clear` means "scanned, the
//   predicate did not fire"; collapsing the two would make an unreadable tree look like a clean one.
//   For the same reason a missing `--root` / missing scan directory is a USAGE error (exit 2), not an
//   empty candidate list.
//
// ── WHY THE CONTRACT MODULE IS LOADED AT RUNTIME (NOT `import`) ──────────────────────────────────────
//   This file lives in `plugin/scripts/`, the SHIPPED surface. The artifact is assembled by staging
//   `plugin/` alone as the artifact root (`packages/quay/scripts/package.sh`), so a static
//   `../../docs/analysis/…` specifier is unresolvable there and esbuild would inline a module whose own
//   direct-entry guard could hijack this bundle's main. The repo solved that exact defect once already
//   (`routine-engine-module-loader.ts`); this file reuses that loader instead of re-deriving the rule.
//
// USAGE
//   node --experimental-strip-types plugin/scripts/unencapsulated-state-clue.ts --root <dir> --json
//   node --experimental-strip-types plugin/scripts/unencapsulated-state-clue.ts --root <dir> \
//        --scan plugin/fixtures/unencapsulated-state --json
//
//   --root <dir>     the directory subject paths are relative to (default: this script's repo root).
//   --scan <rel>     a directory or file to scan, relative to --root. Repeatable. Default:
//                    `packages/quay/src` and `plugin/scripts`.
//   --json           machine-readable output `{root, scan, records, summary}`.
//
// Exit: 0 = a reading was produced (even if every record is a candidate);
//       2 = usage / environment error (missing root, missing scan target);
//       3 = the reading itself is not trustworthy (a record outside the clue vocabulary — an instrument
//           failure, reported instead of being dropped on the floor).

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
import { resolveEngineModuleIn, importEngineModuleAt, SCRIPT_REPO_ROOT } from "./routine-engine-module-loader.ts";

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_INSTRUMENT = 3;

/** The concern kind this clue reader produces candidates for. The registry entry's `detector` points
 *  here (docs/analysis/ownership-active-limited-proposal.mjs), so the two can never drift silently. */
export const CLUE_KIND = "unencapsulated-state";

/** Default scan set: the two source surfaces this repo calls "the instrument tree". */
export const DEFAULT_SCAN_DIRS = ["packages/quay/src", "plugin/scripts"] as const;

/** Directory NAMES never descended into, whatever the scan set. `worktrees` keeps a task worktree from
 *  re-scanning its siblings' checkouts; `dist` keeps bundles from counting as source. */
const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "dist", "dist-sea", "worktrees"]);

/** Root-relative prefixes skipped in DEFAULT mode only — an explicit `--scan` may name them. */
const DEFAULT_SKIP_PREFIXES = ["plugin/test/", "plugin/fixtures/"];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

const CONTRACT_DIR_REL = "docs/analysis";
const CONTRACT_FILE = "semantic-admission-contract.mjs";

// ── the contract module, resolved from disk (see the header for why this is not a static import) ─────
const contractCache = new Map<string, unknown>();

/** Load `docs/analysis/semantic-admission-contract.mjs` for a given repo root.
 *
 *  Resolution order is the shared loader's: this script's own repo first, the given root second. A miss
 *  THROWS with the paths it tried — an unresolved vocabulary must never be read as "no candidates". */
export async function loadContract(root: string): Promise<any> {
  const r = resolveEngineModuleIn(root, CONTRACT_FILE, CONTRACT_DIR_REL);
  if (r.path === null) {
    throw new Error(
      `CAUSE=semantic-admission-contract-unresolved — the clue vocabulary lives in ${CONTRACT_FILE} and could not be found; tried ${r.tried.join(" , ")}`,
    );
  }
  return importEngineModuleAt(r.path, contractCache);
}

// ── comment / literal stripping (position-based counting, hard rule 2) ───────────────────────────────
/** Remove comments AND blank out string/template literal CONTENT, keeping line structure intact.
 *
 *  Two different jobs, both required by hard rule 2 ("a mention is not a hit"):
 *    • a comment mentioning `new Map(` is prose, not state — it must not count;
 *    • a template literal spelling `counter=${count}` is TEXT, not a reassignment — it must not count
 *      either. Literal content is replaced by spaces (quotes and newlines kept) so token boundaries and
 *      line numbers survive; only the code characters are left to be counted.
 *
 *  This is a small scanner rather than a regex because a regex cannot tell a `//` inside a URL string
 *  from a line comment, and silently eating the rest of a line is exactly the kind of unverified
 *  filtering hard rule 4b warns about. When the scanner loses track of a quote it keeps going instead of
 *  aborting: this is a CLUE reader, and over-counting a candidate is harmless while dropping a file is
 *  not (that would be `clear` shaped like a measurement). */
export function stripCommentsAndLiterals(src: string): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, " ");
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : "";
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i = Math.min(n, i + 2);
      out += blank(src.slice(start, i));
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const start = i;
      i += 1;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i += 1;
          break;
        }
        if (quote !== "`" && src[i] === "\n") {
          // An unterminated single-line literal: resync at the newline and keep scanning.
          break;
        }
        i += 1;
      }
      const literal = src.slice(start, Math.min(i, n));
      // Keep the delimiters (so `"…"` stays a token) and the newlines; blank everything between.
      const head = literal[0] ?? "";
      const tail = literal.length > 1 ? literal[literal.length - 1] : "";
      const inner = literal.slice(1, Math.max(1, literal.length - 1));
      out += head + blank(inner) + (literal.length > 1 ? tail : "");
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// ── the mechanical predicate ─────────────────────────────────────────────────────────────────────────
const COLLECTION_NEW_RE = /\bnew\s+(?:Map|Set|WeakMap|WeakSet)\s*(?:<[^<>()]*>)?\s*\(/g;
const MODULE_LET_RE = /^(?:export\s+)?(let|var)\s+([A-Za-z_$][\w$]*)/;
const MUTATION_CALL_RE = /\.(?:set|add|delete|clear)\s*\(/g;

export interface SourceReading {
  readonly statefulDeclarations: number;
  readonly mutationSites: number;
  /** What fired, in source order — the evidence a reviewer reads instead of re-deriving the count. */
  readonly declarations: string[];
  readonly mutations: string[];
}

/** Count the two proxy readings in one source text. Pure: no I/O, no vocabulary, no verdict. */
export function analyzeSource(raw: string): SourceReading {
  const src = stripCommentsAndLiterals(raw);
  const lines = src.split("\n");
  let statefulDeclarations = 0;
  let mutationSites = 0;
  const declarations: string[] = [];
  const mutations: string[] = [];
  const moduleLetBindings = new Set<string>();

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    // Module-level (column 0) `let` / `var`: the clearest "this file carries state" signal.
    const m = MODULE_LET_RE.exec(line);
    if (m) {
      moduleLetBindings.add(m[2]);
      statefulDeclarations += 1;
      declarations.push(`L${idx + 1}: module-level ${m[1]} ${m[2]}`);
    }
    // Collection bindings at ANY scope. A local `new Map()` inside a call is still a mutable collection;
    // the clue layer does not try to decide whether it escapes (that is the judge's question).
    for (const hit of line.matchAll(COLLECTION_NEW_RE)) {
      statefulDeclarations += 1;
      declarations.push(`L${idx + 1}: ${hit[0].trim()} collection`);
    }
    // Mutation call sites.
    for (const hit of line.matchAll(MUTATION_CALL_RE)) {
      mutationSites += 1;
      mutations.push(`L${idx + 1}: ${hit[0].trim()}`);
    }
  }

  // Reassignments to the module-level bindings (the counter / hook shape). Done as a second pass so the
  // declaration line itself is excluded: `let x = 0` is a declaration, not a mutation site.
  for (const name of moduleLetBindings) {
    // `x = …` but not `==`/`===`/`=>`; or a compound assignment; or `x++` / `x--`. The leading group keeps
    // `obj.x = …` and `foo_x = …` from counting as mutations of THIS binding.
    const assignRe = new RegExp(
      `(?:^|[^\\w$.#])${escapeRegExp(name)}\\s*(?:\\+\\+|--|\\+=|-=|\\*=|/=|=(?![=>]))`,
      "g",
    );
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      if (MODULE_LET_RE.test(line)) continue; // a module-level declaration line is not a mutation
      const hits = line.match(assignRe);
      if (!hits) continue;
      mutationSites += hits.length;
      mutations.push(`L${idx + 1}: reassignment of ${name}`);
    }
  }

  return { statefulDeclarations, mutationSites, declarations, mutations };
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The state a reading maps to. ≥2 readings ⇒ `candidate`, else `clear`. Pure and total. */
export function stateOfReading(reading: SourceReading): "candidate" | "clear" {
  return reading.statefulDeclarations + reading.mutationSites >= 2 ? "candidate" : "clear";
}

// ── walking the tree ────────────────────────────────────────────────────────────────────────────────
const toPosix = (p: string): string => p.split(path.sep).join("/");

/** Every source file under `targetAbs`, as root-relative POSIX paths, sorted. Missing target ⇒ throws
 *  (a scan set that names a directory this tree does not have is a USAGE error, never an empty scan). */
export function collectSourceFiles(rootAbs: string, targetRel: string, { defaultMode }: { defaultMode: boolean }): string[] {
  const targetAbs = path.resolve(rootAbs, targetRel);
  const st = fs.statSync(targetAbs); // throws ENOENT — the caller turns that into a usage error
  if (st.isFile()) {
    const rel = toPosix(path.relative(rootAbs, targetAbs));
    return SOURCE_EXTENSIONS.has(path.extname(rel)) ? [rel] : [];
  }
  const out: string[] = [];
  const walk = (absDir: string): void => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      const rel = toPosix(path.relative(rootAbs, abs));
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        if (defaultMode && DEFAULT_SKIP_PREFIXES.some((p) => `${rel}/`.startsWith(p))) continue;
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      out.push(rel);
    }
  };
  walk(targetAbs);
  return out.sort();
}

// ── one file ⇒ one clue record ─────────────────────────────────────────────────────────────────────
/**
 * Scan one root-relative file and build its clue record through the contract module's `clueRecord`.
 * @returns the frozen clue record.
 */
export async function clueForFile(
  rootAbs: string,
  subject: string,
  contract: { clueRecord: (o: Record<string, unknown>) => any; CLUE_STATE: Record<string, string> },
): Promise<any> {
  const abs = path.resolve(rootAbs, subject);
  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (e: any) {
    return contract.clueRecord({
      kind: CLUE_KIND,
      subject,
      state: contract.CLUE_STATE.NOT_EVALUATED,
      evidence_ref: `${subject}: unreadable (${e?.code ?? e?.message ?? "unknown error"})`,
    });
  }
  if (raw.includes("\u0000")) {
    // A NUL byte is the definition of "not source text" (a binary wearing a source extension). Counting
    // it would be reading bytes as if they were code — 未查, not 干净.
    return contract.clueRecord({
      kind: CLUE_KIND,
      subject,
      state: contract.CLUE_STATE.NOT_EVALUATED,
      evidence_ref: `${subject}: contains NUL bytes (binary, not source text)`,
    });
  }
  const reading = analyzeSource(raw);
  return contract.clueRecord({
    kind: CLUE_KIND,
    subject,
    state: stateOfReading(reading),
    proxy_reading: `statefulDeclarations=${reading.statefulDeclarations} mutationSites=${reading.mutationSites}`,
    evidence_ref: subject,
  });
}

// ── the whole scan ──────────────────────────────────────────────────────────────────────────────────
export interface ScanResult {
  readonly root: string;
  readonly scan: string[];
  readonly records: any[];
  /** Counts keyed by the CLUE vocabulary, plus `invalid` for a record outside it (fail-closed). */
  readonly summary: Record<string, number>;
  readonly invalid: number;
}

export async function scanRoot({
  root,
  scanDirs = [...DEFAULT_SCAN_DIRS],
  defaultMode = true,
}: {
  root: string;
  scanDirs?: string[];
  defaultMode?: boolean;
}): Promise<ScanResult> {
  const rootAbs = path.resolve(root);
  if (!fs.existsSync(rootAbs) || !fs.statSync(rootAbs).isDirectory()) {
    throw new Error(`CAUSE=root-not-a-directory — ${rootAbs} does not exist or is not a directory`);
  }
  const contract = await loadContract(rootAbs);
  const subjects: string[] = [];
  for (const dir of scanDirs) {
    for (const rel of collectSourceFiles(rootAbs, dir, { defaultMode })) {
      if (!subjects.includes(rel)) subjects.push(rel);
    }
  }
  subjects.sort();
  const records: any[] = [];
  for (const subject of subjects) records.push(await clueForFile(rootAbs, subject, contract));

  const summary: Record<string, number> = {};
  for (const state of contract.CLUE_STATES as string[]) summary[state] = 0;
  let invalid = 0;
  for (const r of records) {
    if (Object.prototype.hasOwnProperty.call(summary, r.state)) summary[r.state] += 1;
    else invalid += 1;
  }
  // ⛔ `confirmed` is NOT a measurement here — the clue vocabulary has no such value and `clueRecord`
  // rejects it, so this key can only ever be 0. It is reported because the AC names it (the reader must
  // PROVE it never confirms); the real guard is the vocabulary check above, which routes any state
  // outside CLUE_STATES to `invalid` and makes the process exit 3.
  summary.confirmed = 0;

  return { root: rootAbs, scan: scanDirs, records, summary, invalid };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────
const USAGE =
  "unencapsulated-state-clue.ts --root <dir> [--scan <rel> ...] [--json]\n" +
  "  stage 1 of the two-stage admission pipeline: emits clue records (candidate / clear / not-evaluated),\n" +
  "  never a verdict. Default scan set: packages/quay/src + plugin/scripts.";

export async function main(argv: string[]): Promise<number> {
  let root = SCRIPT_REPO_ROOT;
  const scanDirs: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(USAGE + "\n");
      return EXIT_OK;
    }
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--root") {
      root = argv[i + 1];
      i += 1;
      if (!root) {
        process.stderr.write("CAUSE=missing-argument — --root needs a directory\n" + USAGE + "\n");
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--scan") {
      const v = argv[i + 1];
      i += 1;
      if (!v) {
        process.stderr.write("CAUSE=missing-argument — --scan needs a path\n" + USAGE + "\n");
        return EXIT_USAGE;
      }
      scanDirs.push(v);
      continue;
    }
    process.stderr.write(`CAUSE=unknown-argument — ${a}\n` + USAGE + "\n");
    return EXIT_USAGE;
  }

  const explicit = scanDirs.length > 0;
  let result: ScanResult;
  try {
    result = await scanRoot({ root, scanDirs: explicit ? scanDirs : [...DEFAULT_SCAN_DIRS], defaultMode: !explicit });
  } catch (e: any) {
    process.stderr.write(`${e?.message ?? e}\n`);
    return EXIT_USAGE;
  }

  if (json) {
    process.stdout.write(JSON.stringify({ root: result.root, scan: result.scan, records: result.records, summary: result.summary }, null, 2) + "\n");
  } else {
    process.stdout.write(`clue scan: ${result.records.length} file(s) under ${result.scan.join(" + ")}\n`);
    for (const state of Object.keys(result.summary)) process.stdout.write(`  ${state}: ${result.summary[state]}\n`);
    if (result.invalid > 0) process.stdout.write(`  INVALID (outside CLUE_STATES): ${result.invalid}\n`);
    for (const r of result.records.filter((x) => x.state === "candidate").slice(0, 20)) {
      process.stdout.write(`  candidate  ${r.subject}  ${r.proxy_reading ?? ""}\n`);
    }
  }

  if (result.invalid > 0) {
    process.stderr.write(
      `CAUSE=instrument-failure — ${result.invalid} record(s) carry a state outside CLUE_STATES; a clue value the vocabulary does not contain means the reader is broken, so this reading is refused rather than partly reported\n`,
    );
    return EXIT_INSTRUMENT;
  }
  return EXIT_OK;
}

// 直接入口守卫：canonical isDirectEntry（按 basename 判，bundler-friendly —— 见 gate-script-base.ts）。
if (isDirectEntry(import.meta, process.argv[1], "unencapsulated-state-clue")) {
  process.exit(await main(process.argv.slice(2)));
}
