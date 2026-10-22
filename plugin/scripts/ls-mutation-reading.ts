#!/usr/bin/env node
// ls-mutation-reading.ts — the FIRST L_S (stability / behaviour-variance) reading taken ON PRODUCT
// CODE (tasks/gap-ls-product-code-behavior-variance-first-reading).
//
// WHY THIS EXISTS (the dark axis, ADR-007): ADR-007 declares L_S as "mutation / property tests".
// The only live L_S instrument in the repo is `checker-mutation-check.ts`, which mutates the
// CHECKERS; its own header says it is "NOT a mutation test of product code". The original L_S probe
// (`git-lens-l-s-behavior-variance.ts`) survives only as an archive copy that cannot run. So the
// honest statement was: L_S is LIT for checkers and DARK for `packages/` product code. This file is
// the first measurement on the product side — intentionally NOT a threshold, NOT a gate, and NOT
// wired into any loop (硬规则 4 推论: no numeric threshold before the cost structure is measured).
//
// WHAT IT MEASURES: for each named function in a target source file, apply ONE deterministic textual
// mutation at a time, run the task's own test file against that single mutant in a THROWAWAY COPY,
// and classify the mutant three ways:
//   killed          the test file really ran (≥1 passing test remains) and ≥1 test FAILED;
//   survived        every test passed;
//   not-evaluated   the test could not judge the mutant — a load/parse failure (SyntaxError,
//                   module-resolution failure), a timeout, a spawn failure, or a run where NO test
//                   passed at all. ⛔ A not-evaluated mutant is NEVER counted as killed (硬规则 3b:
//                   "I could not read the input" must not share the shape of "judged and refuted").
// The score is `killed / (mutants - notEvaluated)` and is **null** when that denominator is 0 —
// null ≠ 0 ≠ 1: a run where nothing could be evaluated has NO score, it does not have score 0.
//
// OPERATORS (deterministic, zero-dependency, applied to the function BODY only):
//   equality-flip      `===` ↔ `!==`
//   logical-operator   `&&` ↔ `||`
//   boolean-literal    `true` ↔ `false`
//   bracket-empty      a bracket group `[...]` → `[]`   (see the honest limitation below)
//   string-empty       a quoted string literal → `""`
//   return-early       the first `return <expr>;` → `return;`
//
// ⚠️ HONEST LIMITATION — NO PARSER. The operators are TEXTUAL (this task deliberately adds no
// dependency, and stryker/fast-check/Babel are out of scope). Two consequences are load-bearing:
//   · `bracket-empty` cannot tell an array LITERAL from an index expression `xs[i]` or a regex
//     character class `[ \t]`; emptying an index expression yields `xs[]`, which does not parse.
//   · Any operator can land in a spot the language will not accept.
// Both cases are exactly what `not-evaluated` exists for. The instrument reports them instead of
// pretending they were killed — an unparsable mutant proves nothing about test strength.
//
// SOURCE IS NEVER TOUCHED: the target file is copied into a temp sandbox (`os.tmpdir()`) together
// with its top-level ancestor directory and a symlink to `node_modules`; every mutant is written
// ONLY there and removed on exit. AC4 checks that the real file's md5 is unchanged.
//
// CARRIER (append-only, one JSON object per line):
//   <root>/.quay/ls-readings.jsonl
//   {ts, head, target, functions, operators, mutants, killed, survived, notEvaluated, score,
//    survivors:[{fn,line,operator}]}
// `score` is null when `mutants - notEvaluated == 0` (never 0 or 1 by convention). The carrier is
// also declared in docs/carrier-registry.json and this script in
// plugin/scripts/capability-catalog-declarations.json.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/ls-mutation-reading.ts \
//     --target packages/quay/src/kernel/task-transition.ts \
//     --functions decideTransition,edgeKindFor,patchStatusField \
//     --test packages/quay/test/task-transition.test.mjs [--root <dir>] [--json]
//     [--operators a,b] [--timeout-ms N] [--carrier <path>] [--keep-sandbox]
//
// Exit status: 0 = a reading was taken (whatever its score); 2 = usage error; 3 = NOT-EVALUATED
// (target/test unreadable, a named function not found, the UNMUTATED baseline is not green, or the
// carrier could not be written — never a silent empty reading).
//
// ⛔ This is an OBSERVATION instrument. Do not gate merges on the score, and do not add a threshold:
// the distribution has not been measured yet (硬规则 4 推论).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { escapeRegExp } from "./regex-escape.ts";
// The 1-based newline counter lives ONCE in source-text-lib.ts (finding `lineof-lineat`):
// a private copy here would re-open that family and red plugin/test/source-text-lib.test.mjs.
import { lineOf } from "./source-text-lib.ts";

/** The append-only carrier, relative to the workspace root (`<root>/.quay/ls-readings.jsonl`). */
export const CARRIER_REL = ".quay/ls-readings.jsonl";

/** Default per-mutant wall clock. A mutant that hangs is NOT a kill — it is not-evaluated. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** The operator vocabulary, in the order mutants are enumerated. */
export const OPERATORS = [
  "equality-flip",
  "logical-operator",
  "boolean-literal",
  "bracket-empty",
  "string-empty",
  "return-early",
] as const;

export type OperatorName = (typeof OPERATORS)[number];

export type MutantVerdict = "killed" | "survived" | "not-evaluated";

/** One mutation site: the single textual edit that defines a mutant. */
export interface MutantSite {
  fn: string;
  operator: OperatorName;
  /** Absolute offsets into the ORIGINAL source text. */
  start: number;
  end: number;
  /** Replacement text for `[start,end)`. */
  to: string;
  /** The text being replaced (kept for a human-readable diagnosis; not written to the carrier). */
  from: string;
  /** 1-based line of the mutation site in the ORIGINAL source text. */
  line: number;
}

/** The carrier record — exactly the shape the task's Plan §2 declares. */
export interface LsReading {
  ts: string;
  head: string | null;
  target: string;
  functions: string[];
  operators: string[];
  mutants: number;
  killed: number;
  survived: number;
  notEvaluated: number;
  score: number | null;
  survivors: { fn: string; line: number; operator: string }[];
}

// ── lexical helpers (strings / comments / matching brackets) ──────────────────────────────────────
//
// A tiny scanner is unavoidable here: the mutation span must be the function BODY, so that a type
// annotation in the signature (which type-stripping erases) can never masquerade as a live mutant.
// These helpers do NOT try to be a parser — they only need to find balanced delimiters while
// skipping strings, templates and comments.

/** Index just past the closing quote of the string/template starting at `i`, or -1. */
function skipQuoted(src: string, i: number): number {
  const q = src[i];
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === q) return i + 1;
    i++;
  }
  return -1;
}

/** Index of the delimiter matching the one at `open` ( `(`/`[`/`{` ), or -1. */
function findMatching(src: string, open: number): number {
  const openCh = src[open];
  const closeCh = openCh === "(" ? ")" : openCh === "[" ? "]" : "}";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const after = skipQuoted(src, i);
      if (after === -1) return -1;
      i = after - 1;
      continue;
    }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** First index ≥ `from` whose char is not whitespace, or src.length. */
function nextNonWs(src: string, from: number): number {
  let i = from;
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

/**
 * Find the opening `{` of a function BODY, starting the scan at `from` (just past the parameter
 * list). The return-type annotation may contain object types (`{ok: true}`) and unions (`| {…}`),
 * so a candidate brace followed by `|`/`&`/`,` is a TYPE member, and a candidate brace followed by
 * another `{` is a type annotation whose BODY is the following brace. Anything else is the body.
 */
function findBodyBrace(src: string, from: number): number {
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const after = skipQuoted(src, i);
      if (after === -1) return -1;
      i = after;
      continue;
    }
    if (c === "(" || c === "[") {
      const m = findMatching(src, i);
      if (m < 0) return -1;
      i = m + 1;
      continue;
    }
    if (c === "{") {
      const m = findMatching(src, i);
      if (m < 0) return -1;
      const after = nextNonWs(src, m + 1);
      const ch = src[after];
      if (ch === "|" || ch === "&" || ch === ",") {
        i = m + 1; // a member of a union/intersection type
        continue;
      }
      if (ch === "{") {
        i = after; // a type object; the body is the NEXT brace
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

/** The body span of `name`, or null when the function is not declared in `src`. */
export function findFunctionBody(src: string, name: string): { bodyStart: number; bodyEnd: number; line: number } | null {
  const esc = escapeRegExp(name);
  const declRe = new RegExp(`(?:^|\\n)[ \\t]*(?:export[ \\t]+)?(?:async[ \\t]+)?function[ \\t]+${esc}[ \\t]*\\(`);
  const decl = declRe.exec(src);
  if (decl) {
    const parenOpen = src.indexOf("(", decl.index + decl[0].length - 1);
    const parenClose = findMatching(src, parenOpen);
    if (parenClose < 0) return null;
    const bodyOpen = findBodyBrace(src, parenClose + 1);
    if (bodyOpen < 0) return null;
    const bodyClose = findMatching(src, bodyOpen);
    if (bodyClose < 0) return null;
    return { bodyStart: bodyOpen + 1, bodyEnd: bodyClose, line: lineOf(src, decl.index) };
  }

  const arrowRe = new RegExp(`(?:^|\\n)[ \\t]*(?:export[ \\t]+)?(?:const|let|var)[ \\t]+${esc}[ \\t]*(?::[^=\\n]*)?=`);
  const arrow = arrowRe.exec(src);
  if (!arrow) return null;
  const arrowIdx = src.indexOf("=>", arrow.index + arrow[0].length);
  if (arrowIdx < 0) return null;
  const afterArrow = nextNonWs(src, arrowIdx + 2);
  if (src[afterArrow] === "{") {
    const close = findMatching(src, afterArrow);
    if (close < 0) return null;
    return { bodyStart: afterArrow + 1, bodyEnd: close, line: lineOf(src, arrow.index) };
  }
  // expression-bodied arrow: the body runs to the terminating `;`
  const end = findStatementEnd(src, afterArrow);
  if (end < 0) return null;
  return { bodyStart: afterArrow, bodyEnd: end, line: lineOf(src, arrow.index) };
}

/** Index of the first `;` at depth 0 from `from` (skipping strings and nested delimiters), or -1. */
function findStatementEnd(src: string, from: number): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const after = skipQuoted(src, i);
      if (after === -1) return -1;
      i = after - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) return i;
  }
  return -1;
}

// ── operators ─────────────────────────────────────────────────────────────────────────────────────
//
// Each operator returns edits in ABSOLUTE offsets. A site whose replacement equals the original text
// is dropped (mutating `""` to `""` is not a mutant).

interface Edit {
  start: number;
  end: number;
  to: string;
}

function sitesForOperator(op: OperatorName, src: string, worker: string, bodyStart: number, bodyEnd: number): MutantSite[] {
  const region = src.slice(bodyStart, bodyEnd);
  const out: MutantSite[] = [];
  const push = (relStart: number, relEnd: number, to: string) => {
    const from = region.slice(relStart, relEnd);
    if (from === to) return;
    const start = bodyStart + relStart;
    out.push({ fn: worker, operator: op, start, end: bodyStart + relEnd, to, from, line: lineOf(src, start) });
  };

  if (op === "equality-flip") {
    for (const m of region.matchAll(/===|!==/g)) {
      push(m.index!, m.index! + m[0].length, m[0] === "===" ? "!==" : "===");
    }
  } else if (op === "logical-operator") {
    for (const m of region.matchAll(/&&|\|\|/g)) {
      push(m.index!, m.index! + m[0].length, m[0] === "&&" ? "||" : "&&");
    }
  } else if (op === "boolean-literal") {
    for (const m of region.matchAll(/\b(true|false)\b/g)) {
      push(m.index!, m.index! + m[0].length, m[0] === "true" ? "false" : "true");
    }
  } else if (op === "bracket-empty") {
    // TEXTUAL bracket group — see the header's honest-limitation note (indices and regex character
    // classes are matched too; an unparsable result is classified not-evaluated, never killed).
    for (const m of region.matchAll(/\[[^[\]]*\]/g)) {
      if (m[0].length <= 2) continue;
      push(m.index!, m.index! + m[0].length, "[]");
    }
  } else if (op === "string-empty") {
    for (const m of region.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g)) {
      if (m[0].length <= 2) continue;
      push(m.index!, m.index! + m[0].length, '""');
    }
  } else if (op === "return-early") {
    const m = /\breturn\b/.exec(region);
    if (m) {
      const exprStart = nextNonWs(region, m.index + m[0].length);
      if (region[exprStart] !== ";") {
        const end = findStatementEnd(region, exprStart);
        if (end > exprStart) push(exprStart, end, "");
      }
    }
  }
  return out;
}

/** Every single-mutation site for the named functions, in (function, operator, offset) order. */
export function collectMutantSites(src: string, functions: string[], operators: readonly OperatorName[]): MutantSite[] {
  const out: MutantSite[] = [];
  for (const fn of functions) {
    const body = findFunctionBody(src, fn);
    if (!body) continue;
    for (const op of operators) out.push(...sitesForOperator(op, src, fn, body.bodyStart, body.bodyEnd));
  }
  return out;
}

/** Apply exactly one site to the original source. */
export function applySite(src: string, site: MutantSite): string {
  return src.slice(0, site.start) + site.to + src.slice(site.end);
}

// ── sandbox + one mutant run ─────────────────────────────────────────────────────────────────────

function copyTree(src: string, dst: string): void {
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (p) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(p),
  });
}

/**
 * Materialize a throwaway workspace containing the target/test's top-level ancestor directories
 * plus the root `package.json` and a symlink to the real `node_modules`. Returns its path.
 */
export function buildSandbox(root: string, rels: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-mutation-reading-"));
  const tops = new Set(rels.map((r) => r.split("/")[0]));
  for (const top of tops) {
    const from = path.join(root, top);
    const to = path.join(dir, top);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
  const pkg = path.join(root, "package.json");
  if (fs.existsSync(pkg) && !tops.has("package.json")) fs.copyFileSync(pkg, path.join(dir, "package.json"));
  const nm = path.join(root, "node_modules");
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dir, "node_modules"), "dir");
  return dir;
}

interface RunOutcome {
  verdict: MutantVerdict;
  exitCode: number | null;
  detail: string;
}

/**
 * Run ONE test file and classify the outcome three ways. The classification is deliberately
 * conservative: a non-zero exit is NOT enough to be "killed" — at least one test must have actually
 * PASSED alongside the failure, and the output must not carry a load/parse failure signature. An
 * unparsable mutant, a module-resolution error, a timeout, or a run where nothing passed is
 * not-evaluated: it tells us nothing about the tests' ability to detect a behaviour change.
 */
export function runTestOnce(cwd: string, testRel: string, timeoutMs: number): RunOutcome {
  // ⚠️ flag ORDER matters: a `--test-reporter` placed AFTER the positional test file is passed to the
  // test file itself, so node falls back to the spec reporter and the TAP `# pass`/`# fail` summary
  // disappears — which would silently classify EVERY run as not-evaluated (found by the baseline
  // guard going RED on a green test file, which is exactly what that guard is for).
  // ⚠️ The child must NOT inherit the node:test context. When this instrument is itself run from a
  // test file (plugin/test/ls-mutation-reading.test.mjs does exactly that), the ambient
  // NODE_TEST_CONTEXT / NODE_TEST_WORKER_ID make the spawned `node --test` a REPORTER CHILD of the
  // outer run, and its TAP `# pass`/`# fail` summary never reaches our stdout ⇒ every run, including
  // the unmutated baseline, was classified `no-test-ran`. A child measurement must be a plain run.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "NODE_TEST_CONTEXT" || key === "NODE_TEST_WORKER_ID") delete env[key];
  }
  const res = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-reporter=tap", testRel], {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  if (res.error && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    return { verdict: "not-evaluated", exitCode: null, detail: "timeout" };
  }
  if (res.error) return { verdict: "not-evaluated", exitCode: null, detail: `spawn-error:${res.error.message}` };
  const fail = /^# fail (\d+)$/m.exec(stdout);
  const pass = /^# pass (\d+)$/m.exec(stdout);
  const failed = fail ? Number(fail[1]) : 0;
  const passed = pass ? Number(pass[1]) : 0;
  const output = stdout + stderr;
  const loadFailure = /SyntaxError|ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED|Cannot find module|Unexpected token|Unexpected end of input/.test(output);
  if (loadFailure) return { verdict: "not-evaluated", exitCode: res.status, detail: "load-or-parse-failure" };
  if (failed >= 1 && passed >= 1) return { verdict: "killed", exitCode: res.status, detail: `fail:${failed}/${passed + failed}` };
  if (failed === 0 && passed >= 1 && res.status === 0) {
    return { verdict: "survived", exitCode: res.status, detail: `pass:${passed}` };
  }
  return { verdict: "not-evaluated", exitCode: res.status, detail: "no-test-ran" };
}

// ── the reading ───────────────────────────────────────────────────────────────────────────────────

function gitHead(root: string): string | null {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

export interface TakeReadingArgs {
  root: string;
  target: string;
  functions: string[];
  test: string;
  operators?: readonly OperatorName[];
  timeoutMs?: number;
  keepSandbox?: boolean;
}

export interface TakeReadingResult {
  reading: LsReading;
  sites: MutantSite[];
  verdicts: { site: MutantSite; verdict: MutantVerdict; detail: string }[];
}

/**
 * Take ONE reading. Throws (never returns a fabricated reading) when the inputs cannot be judged:
 * a missing target/test, a named function that is not declared, or an UNMUTATED baseline that is not
 * green. A red baseline would make every "killed" a lie, so it is NOT-EVALUATED, not a reading.
 */
export function takeReading(args: TakeReadingArgs): TakeReadingResult {
  const root = path.resolve(args.root);
  const targetAbs = path.join(root, args.target);
  const testAbs = path.join(root, args.test);
  if (!fs.existsSync(targetAbs)) throw new Error(`target-not-found: ${args.target}`);
  if (!fs.existsSync(testAbs)) throw new Error(`test-not-found: ${args.test}`);
  const operators = args.operators && args.operators.length > 0 ? args.operators : (OPERATORS as readonly OperatorName[]);
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const src = fs.readFileSync(targetAbs, "utf8");

  const missing = args.functions.filter((fn) => findFunctionBody(src, fn) === null);
  if (missing.length > 0) throw new Error(`functions-not-found: ${missing.join(",")}`);

  const sites = collectMutantSites(src, args.functions, operators);
  if (sites.length === 0) throw new Error("no-mutants: no operator matched inside the named functions");

  const sandbox = buildSandbox(root, [args.target, args.test]);
  const sandboxTarget = path.join(sandbox, args.target);
  const sandboxTest = args.test.split(path.sep).join("/");
  try {
    fs.mkdirSync(path.dirname(sandboxTarget), { recursive: true });
    fs.writeFileSync(sandboxTarget, src);
    const baseline = runTestOnce(sandbox, sandboxTest, timeoutMs);
    if (baseline.verdict !== "survived") {
      throw new Error(`baseline-not-green: ${baseline.detail} (a red baseline makes every kill meaningless)`);
    }

    const verdicts: { site: MutantSite; verdict: MutantVerdict; detail: string }[] = [];
    for (const site of sites) {
      fs.writeFileSync(sandboxTarget, applySite(src, site));
      const outcome = runTestOnce(sandbox, sandboxTest, timeoutMs);
      verdicts.push({ site, verdict: outcome.verdict, detail: outcome.detail });
    }
    fs.writeFileSync(sandboxTarget, src);
    return { reading: summarize(args, operators, sites, verdicts, root), sites, verdicts };
  } finally {
    if (args.keepSandbox) process.stderr.write(`ls-mutation-reading: sandbox kept at ${sandbox}\n`);
    else fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function summarize(
  args: TakeReadingArgs,
  operators: readonly OperatorName[],
  sites: MutantSite[],
  verdicts: { site: MutantSite; verdict: MutantVerdict; detail: string }[],
  root: string,
): LsReading {
  const killed = verdicts.filter((v) => v.verdict === "killed").length;
  const survived = verdicts.filter((v) => v.verdict === "survived").length;
  const notEvaluated = verdicts.filter((v) => v.verdict === "not-evaluated").length;
  const denominator = sites.length - notEvaluated;
  return {
    ts: new Date().toISOString(),
    head: gitHead(root),
    target: args.target.split(path.sep).join("/"),
    functions: [...args.functions],
    operators: [...operators],
    mutants: sites.length,
    killed,
    survived,
    notEvaluated,
    score: denominator > 0 ? Number((killed / denominator).toFixed(4)) : null,
    survivors: verdicts
      .filter((v) => v.verdict === "survived")
      .map((v) => ({ fn: v.site.fn, line: v.site.line, operator: v.site.operator })),
  };
}

// ── carrier ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Append one reading to the carrier, FAIL-LOUD. `appendJsonlLine` in gate-script-base.ts is
 * best-effort by contract (it swallows write errors); for THIS file the carrier IS the reading, so a
 * swallowed write would turn "measured" into "never measured" while looking identical (硬规则 3b).
 * A write failure therefore throws and the process exits 3.
 */
export function appendReading(carrierPath: string, reading: LsReading): void {
  fs.mkdirSync(path.dirname(carrierPath), { recursive: true });
  fs.appendFileSync(carrierPath, JSON.stringify(reading) + "\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

function usage(): string {
  return [
    "ls-mutation-reading — the first L_S (behaviour-variance) reading on product code (observation only; no gate, no threshold)",
    "",
    "  node --experimental-strip-types plugin/scripts/ls-mutation-reading.ts \\",
    "    --target <repo-relative source file> --functions <a,b,c> --test <repo-relative test file>",
    "",
    "Options:",
    "  --root <dir>         workspace root (default: cwd); carrier and git HEAD resolve here",
    "  --operators <list>   comma-separated subset of: " + OPERATORS.join(","),
    "  --timeout-ms <n>     per-mutant timeout (default " + DEFAULT_TIMEOUT_MS + ")",
    "  --carrier <path>     carrier path (default: <root>/" + CARRIER_REL + ")",
    "  --json               print the reading record as JSON on stdout",
    "  --keep-sandbox       keep the temp sandbox (debugging)",
    "  --help               print this text",
    "",
    "Exit: 0 reading taken (whatever the score); 2 usage error; 3 NOT-EVALUATED (inputs unreadable,",
    "      a named function missing, the unmutated baseline not green, or the carrier unwritable).",
  ].join("\n");
}

function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage() + "\n");
    return 0;
  }
  const root = path.resolve(flagValue(argv, "--root") ?? process.cwd());
  const target = flagValue(argv, "--target");
  const test = flagValue(argv, "--test");
  const functions = (flagValue(argv, "--functions") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!target || !test || functions.length === 0) {
    process.stderr.write("ls-mutation-reading: usage error — --target, --functions and --test are required\n" + usage() + "\n");
    return 2;
  }
  const operatorArg = flagValue(argv, "--operators");
  const operators: OperatorName[] = operatorArg
    ? operatorArg.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
        if (!(OPERATORS as readonly string[]).includes(s)) throw new Error(`unknown-operator: ${s}`);
        return s as OperatorName;
      })
    : [...OPERATORS];
  const timeoutRaw = flagValue(argv, "--timeout-ms");
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    process.stderr.write("ls-mutation-reading: usage error — --timeout-ms must be a positive number\n");
    return 2;
  }
  const carrier = path.resolve(flagValue(argv, "--carrier") ?? path.join(root, CARRIER_REL));

  try {
    const { reading } = takeReading({
      root,
      target,
      functions,
      test,
      operators,
      timeoutMs,
      keepSandbox: argv.includes("--keep-sandbox"),
    });
    appendReading(carrier, reading);
    if (argv.includes("--json")) {
      process.stdout.write(JSON.stringify(reading) + "\n");
    } else {
      process.stdout.write(
        `ls-mutation-reading: ${reading.target} | mutants=${reading.mutants} killed=${reading.killed} ` +
          `survived=${reading.survived} notEvaluated=${reading.notEvaluated} score=${reading.score === null ? "null" : reading.score}\n` +
          `  carrier: ${carrier}\n` +
          (reading.survivors.length > 0
            ? `  survivors:\n${reading.survivors.map((s) => `    ${s.fn}:${s.line} ${s.operator}`).join("\n")}\n`
            : ""),
      );
    }
    return 0;
  } catch (err) {
    process.stderr.write(`ls-mutation-reading: NOT-EVALUATED — ${(err as Error).message}\n`);
    return 3;
  }
}

const invokedDirectly = (() => {
  try {
    return isDirectEntry(import.meta, undefined, "ls-mutation-reading");
  } catch {
    return false;
  }
})();
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
