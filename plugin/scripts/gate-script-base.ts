// gate-script-base.ts — shared framework primitives for TypeScript gate scripts.
// Import the functions/classes you need from this module.
//
// Usage:
//   import { parseArgs, flagValue, readFrontmatter, emitPass, emitFail, emitNotEvaluated, emitVerdict, requireArg, isDirectEntry, git, gitLastCommitForPath } from "./gate-script-base.ts";

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export interface FlagSpec {
  type: "string" | "boolean";
  description?: string;
}

export interface CliSpec {
  /** Minimum number of positional args required (default: 1). */
  minArgs?: number;
  /** Usage string for error messages, e.g. "<task-file> [<task-file> ...]". */
  usage: string;
  /** Named flags accepted by this command. */
  flags?: Record<string, FlagSpec>;
  /**
   * Reject an UNRECOGNIZED `--flag` (stderr `unknown argument: --<flag>`, exit 2) instead of
   * accepting it as an undeclared string flag. Default false, so no existing caller's input
   * language changes; see the parseArgs block below for why the default is not strict.
   */
  strict?: boolean;
  /**
   * How `--help` / `-h` is handled. "exit" (default) = the shared contract: print usage to stdout,
   * exit 0, no business side effect. "return" = set `ParsedArgs.help = true` and return WITHOUT
   * exiting, so a caller that owns a richer multi-line help text (or must not kill the process)
   * can print it and return on its own. See the parseArgs block for why this mode exists.
   */
  help?: "exit" | "return";
}

export interface ParsedArgs {
  /** Positional (non-flag) args. */
  args: string[];
  /** Flag values keyed by flag name (without leading --). */
  flags: Record<string, string | boolean>;
  /**
   * True iff `spec.help === "return"` and argv carried `--help`/`-h`. Absent on the exit path (which
   * never returns) and on every normal run — so a caller reads it as `help === true`, never as a
   * three-valued "did help happen / could I not tell".
   */
  help?: boolean;
}

// ── helpExit ────────────────────────────────────────────────────────────────────────────────────────
// Print a usage line to stdout and exit 0 — the single `--help` contract shared by every checker
// (gap-help-contract-incompatible-behaviors): usage FIRST, exit 0, NO business side effect. Call this
// BEFORE any argument parsing / repo-root resolution / file write; a checker that reaches its own
// full-check logic on `--help` violates the contract (it silently runs — or worse, appends to a
// history/ledger file, as measure-trend-check did to .quay/measure-history.jsonl).
export function helpExit(usage: string): never {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}

// ── parseArgs ──────────────────────────────────────────────────────────────────────────────────────
// Parse CLI arguments according to a spec. Flags are parsed as --name value or --name=value (string),
// or --name alone (boolean). Positional args are everything else.
//
// `--help` / `-h` anywhere in argv ⇒ print usage to stdout and exit 0 (the shared contract above),
// evaluated BEFORE the minArgs failure path so `--help` never reads as a missing-arg error.
// Otherwise exits with code 2 and a usage message if fewer than minArgs positional args are provided.
//
// `spec.help: "return"` REPLACES the `--help`/exit arm with a non-exiting one: `--help` sets
// `result.help = true` and returns immediately (still BEFORE minArgs, same rule), leaving the
// process alive for the caller to print its OWN usage and return. This exists because the exit-only
// `--help` was the single blocker named by a `semantic-dedup-scan` pass (.quay/routine-findings.jsonl
// finding `parse-args-handrolled-variants`, runId `semantic-dedup-scan-1791536153223`, suggestedAction
// "merge — give the shared parser a non-exiting help mode"): `plugin/scripts/perfile-failure-rate.ts` / `psi-window-join.ts` /
// `psi-failure-correlation-check.ts` each carry a private if/else flag loop that sets `help:true` and
// lets `main()` print a multi-line usage, and they COULD NOT adopt this parser while it killed the
// process on a flag they handle themselves. What the mode does NOT change: the exit path stays the
// default (so every caller that already relied on `--help` ⇒ exit 0 keeps that byte-for-byte), and
// `minArgs` is never enforced on the return path (help is not a missing-arg error in either mode).
//
// WHY `strict` EXISTS — a semantic-dedup-scan pass (.quay/routine-findings.jsonl, routine
// `semantic-dedup-scan`, runId `semantic-dedup-scan-1790503843524`, finding `parseargs-local-copies`,
// verdict `divergent-implementation`) counted 21 files under plugin/scripts declaring a private
// `parseArgs`, of which only 3 imported this one, and named the axes they diverge on as "argv
// slicing, unknown-arg handling and missing-value shape".
//
// MEASURED (not assumed) for the unknown-arg axis, with this spec `{minArgs:0, flags:{root,json}}`:
//     parseArgs(["node","s","--bogus"], spec)  ⇒  { args: [], flags: { bogus: "" } }   exit 0
// i.e. this function SILENTLY ACCEPTS a flag it was never told about, while every one of those 21
// private copies rejects it (throw / exit 2 / an `error` field). That asymmetry is why the copies
// could not converge here: adopting the base as-is would have DELETED their unknown-arg guard, and a
// typo'd `--rrot /tmp` would then fall through to the caller's `?? default` — the substitution of a
// value the user never supplied, which is exactly the failure mode 硬规则 3b forbids ("读不懂" must
// not come back shaped like "合格"). `strict` restores the guard as an OPT-IN, so the three existing
// call sites (enum-surface-parity-check / prepare-admission-check / proposal-convergence — none of
// which passes a `strict` key) keep their input language byte-for-byte.
//
// ⛔ Still NOT expressible by this spec, and deliberately not added here — each is a separate CLI
// contract, not incidental trivia, so folding those callers needs its own finding:
//   • a GREEDY list (`--files a b c`, checked-in-write-check.ts): measured, this parser reads
//     `files:"a"` and leaks `b`,`c` into `args` — folding that caller would silently drop 2 of 3
//     input files from the judgement.
//   • a NON-EXITING ERROR return (loadbearing-test-gate.ts returns `{error}` for a bad usage rather
//     than killing the process): `spec.help: "return"` covers ONLY the `--help` arm — the minArgs
//     failure path still owns `process.exit(2)`, so a caller whose absent-argument case must stay
//     alive cannot fold here yet.
export function parseArgs(argv: string[], spec: CliSpec): ParsedArgs {
  const result: ParsedArgs = { args: [], flags: {} };
  const raw = argv.slice(2);
  const flagDefs = spec.flags || {};

  const scriptName = path.basename(argv[1] || "script");
  if (raw.includes("--help") || raw.includes("-h")) {
    if (spec.help === "return") {
      // Non-exiting help mode: return BEFORE minArgs (a `--help` with no positionals is never a
      // missing-arg error — the same rule the exit path keeps by exiting first). Nothing is parsed
      // onto the result: the caller is expected to print its own usage and return on `help === true`.
      result.help = true;
      return result;
    }
    helpExit(`usage: ${scriptName} ${spec.usage}`);
  }

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      const name = eqIdx >= 0 ? a.slice(2, eqIdx) : a.slice(2);
      const def = flagDefs[name];
      if (!def && spec.strict) {
        console.error(`unknown argument: --${name}`);
        process.exit(2);
      }
      if (def?.type === "boolean") {
        result.flags[name] = true;
      } else if (eqIdx >= 0) {
        result.flags[name] = a.slice(eqIdx + 1);
      } else if (i + 1 < raw.length) {
        result.flags[name] = raw[++i];
      } else {
        result.flags[name] = "";
      }
    } else {
      result.args.push(a);
    }
  }

  const minArgs = spec.minArgs ?? 1;
  if (result.args.length < minArgs) {
    console.error(`Usage: ${scriptName} ${spec.usage}`);
    process.exit(2);
  }

  return result;
}

// ── flagValue ───────────────────────────────────────────────────────────────────────────────────────
// Read ONE `--flag <value>` pair out of an already-sliced argv (callers pass `argv.slice(2)` — the
// positional args, NOT the whole `process.argv`). Returns the token following `name`, or `undefined`
// when `name` is absent or is the last token with no value after it.
//
// WHY THIS EXPORT EXISTS — it is an extraction, not a new idea. A `semantic-dedup-scan` pass
// (.quay/routine-findings.jsonl, routine `semantic-dedup-scan`, runId `semantic-dedup-scan-1789723686226`,
// finding `arg-parsing-helper-family`, verdict `real-duplication`, suggestedAction `extract`) found
// ~60 private copies of this idiom across plugin/scripts under 9 spellings (getArgValue / argValue /
// getFlagValue / parseArg / flagVal / …) and noted that THIS file, imported by the whole checker
// surface, exported no arg helper for them to converge on. Every copy carried the SAME
// `indexOf(name)` + "next token" algorithm; they differed only in trivia (ternary vs early-return,
// typed vs untyped) EXCEPT at one input where the trivia is load-bearing — an EMPTY-STRING value
// (`prog --flag ""`):
//   • `""`          — the majority form: `idx === -1 ? undefined : args[idx + 1]`
//   • `undefined`   — the falsy form:  `idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined`
// The falsy form is RETIRED here rather than preserved, because its only effect is that a value the
// user DID pass reads as absent, and the caller's `?? default` then silently substitutes the
// default for it (硬规则 3b: "读不懂" 不得伪装成 "没给"). A caller that wants that reading must say
// so at its own call site (`flagValue(args, "--x") || undefined`) instead of inheriting it from a
// private copy. See plugin/test/gate-script-base-flag-value.test.mjs for the control that pins the
// two apart.
//
// ⛔ What this helper deliberately does NOT do:
//   • It does NOT accept the `--flag=value` spelling. No copy it replaces did either (`indexOf`
//     matches the exact token `--flag`), so gaining the `=` form here would change every caller's
//     input language at once. Use parseArgs()'s spec-driven path where `=` must be supported.
//   • It does NOT treat a missing value as an error. Pair it with requireArg() when an absent value
//     must be a usage error (exit 2) rather than a silent fallback.
//   • It is NOT the arity-1 `argvFlag(name)` shape: the callers that read `process.argv` directly
//     now write `flagValue(process.argv, name)`, so the token source stays visible at the call site.
export function flagValue(argv: readonly string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx === -1 ? undefined : argv[idx + 1];
}

// ── resolveRoot ─────────────────────────────────────────────────────────────────────────────────────
// Resolve a caller-supplied `--root <dir>` value to an absolute path, falling back to the current
// working directory when the flag is absent. The relative/absolute decision is `path.resolve`'s, so a
// RELATIVE `--root` resolves against cwd (the conventional CLI reading) rather than against this
// module's own directory — a checker invoked from anywhere lands on the directory the user named.
//
// WHY THIS EXPORT EXISTS — an extraction, not a new idea (semantic-dedup-scan routine, runId
// `semantic-dedup-scan-1790028867335`, findingId `resolveroot`, verdict `real-duplication`,
// suggestedAction `extract`): five checkers (concurrency-literal-check / instrument-failure-check /
// landing-target-check / suite-slot-ssot-check / task-file-bypass-check) carried this byte-identical
// body, and all five ALREADY imported this module — so the shared home existed and the copies were
// pure maintainability debt. Each call site now reads `resolveRoot(flagValue(args, "--root"))`, which
// keeps the token source visible per flagValue's own contract, and the arity-1 `flagVal` closure that
// existed only to feed the private copy is gone with it.
//
// ⛔ NOT the same function as `repoRoot()` (repo-root.ts): that one WALKS UPWARD from a start dir to
// discover the repo/workspace root; this one only converts a value the caller already named. The three
// checkers that default `--root` to the REPO ROOT instead of cwd (fan-in-runid-check / inner-idle-log /
// crystallization-half-life) are therefore a different behavior and are deliberately NOT folded in
// here — that divergence is a separate filed finding (`resolveroot-2`).
export function resolveRoot(rootArg: string | undefined): string {
  return path.resolve(rootArg ?? process.cwd());
}

// ── parseJsonArg ────────────────────────────────────────────────────────────────────────────────────
// Parse a CLI `<json>` argument: strip ONE layer of matching single/double quotes (the shell keeps the
// quotes when a caller writes `--x '{...}'`) then `JSON.parse`. The quote-strip-then-parse body was
// carried byte-identically by five `plugin/scripts/*.ts` entry points; only the failure mode differed
// (semantic-dedup-scan routine, runId `semantic-dedup-scan-1791142275270`, findingId `near-25`,
// verdict `real-duplication`, suggestedAction `extract`). Three threw a typed structured error
// (`identityError` / `receiptError` / a plain `invalid-json:` Error) and two let JSON.parse's
// SyntaxError escape. All five ALREADY imported this module, so — as with flagValue / resolveRoot
// above — the shared home existed and the copies were pure maintainability debt.
//
// THE CALLER OWNS HOW A PARSE FAILURE SURFACES, via `makeError(code, message)`, so each CLI keeps its
// exact error contract without re-copying the logic. run-identity in particular must pass
// `identityError`: plugin/test/run-identity.test.mjs pins `code: "invalid-json"` on malformed input,
// and the default (plain Error, no `.code`) would degrade it to `run-identity-error`.
//
// ⛔ Callers that pass NO factory get a plain `Error` with the `invalid JSON argument: <raw>` message.
// That is a DELIBERATE unification for the two former bare copies (execution-policy /
// finding-backpropagate), which previously let JSON.parse throw an unadorned SyntaxError: both read
// fail-closed either way (the process exits non-zero), so no caller's control flow changes — only the
// message gains the offending argument.
export type JsonArgErrorFactory = (code: string, message: string) => Error;

export function parseJsonArg(raw: string, makeError?: JsonArgErrorFactory): unknown {
  let s = raw;
  if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1);
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  try {
    return JSON.parse(s);
  } catch {
    const message = `invalid JSON argument: ${raw}`;
    throw makeError ? makeError("invalid-json", message) : new Error(message);
  }
}

// ── readFrontmatter ─────────────────────────────────────────────────────────────────────────────────
// Read and parse YAML frontmatter from a markdown file.
// Returns a Record of key→value for simple scalar/list fields, or null if no frontmatter found.
export function readFrontmatter(filePath: string): Record<string, any> | null {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (e: any) {
    // 文件在扫描期间被并发删除（测试 fixture 竞态 / 并发写 tasks/）⇒ 视为不存在（缺值=未查，
    // 硬规则 6——不因 ENOENT 崩溃整个检测器）。missing file has no frontmatter → null（与注释语义一致）。
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw e;
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;

  const front: Record<string, any> = {};
  for (const line of m[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value: any = trimmed.slice(colonIdx + 1).trim();
    if (value === "" || value === "[]" || value === "null") {
      value = value === "null" ? null : value === "[]" ? [] : "";
    } else if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^['"]|['"]$/g, ""));
    }
    front[key] = value;
  }
  return front;
}

// ── readFileSafe ────────────────────────────────────────────────────────────────────────────────────
// Read a file as UTF-8, returning "" on any error (missing file, permission, etc.) instead of
// throwing — the single shared "read or empty" primitive (gap-b3-readfilesafe-normalizerel-unification:
// was 4 byte-identical per-checker copies). Callers that must distinguish "absent" from "unreadable"
// should read directly; this is the checker convention of "treat unreadable as empty".
export function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

// ── readJsonLines ───────────────────────────────────────────────────────────────────────────────────
// Read a JSONL ledger (`.quay/*.jsonl`, `.quay/per-task-suite-records.jsonl`, …) into
// `Record<string, unknown>[]`, tolerating the two things an append-only carrier genuinely produces:
// blank lines and a malformed/torn line at the tail.
//
// WHY THIS EXISTS: semantic-dedup-scan finding `readjsonlines-seven-defs-three-behaviors`
// (.quay/routine-findings.jsonl, runId `semantic-dedup-scan-1790118332027`, verdict
// `real-duplication`) found SEVEN private copies, none imported, in obligation-ledger.ts /
// obligation-ledger-check.ts / psi-failure-correlation-check.ts / psi-window-join.ts /
// freshness-producer-coverage-check.ts / ready-pool-check.ts / trend-check.ts — all seven declaring
// (or implying, in the two exported JS-mode ones) `Record<string, unknown>[]`.
//
// They collapsed to THREE runtime behaviors, differing on exactly TWO axes:
//   axis 1 — line splitting: `split("\n")` (5 copies) vs `split(/\r?\n/)` (2).
//   axis 2 — the non-object guard: none (4) | `v && typeof v === "object"` (2 — a TRUTHY check, and
//            `typeof [] === "object"`, so it admits ARRAYS) | `typeof r === "object" && r !== null &&
//            !Array.isArray(r)` (1).
// ⇒ a line whose top-level JSON value is not an object (`null`, `42`, `"x"`, `[1,2]`) became a ROW in
// 6 of the 7 copies and was dropped in the 7th: the same ledger yielded different row sets per caller.
// Both axes are settled here, once:
//   axis 1 → `split(/\r?\n/)`. Strictly WIDER than `split("\n")` (a lone `\r` still separates), so no
//            caller loses a row it used to get.
//   axis 2 → the strict non-array object guard. Every consumer indexes fields off the row
//            (`r.fullSuiteRan`, `obj.cpu_stall`, …), so a `null` row is a TypeError rather than a
//            datum — the 6 permissive copies were violating their own declared return type.
//            ⛔ This is not a silent narrowing of a load-bearing difference: every writer of every
//            ledger this reads serializes an OBJECT (checker-cost.ts / runner-state-write.ts /
//            suite-load-sampler.ts / obligation-ledger.ts `JSON.stringify(rec)` of an object,
//            per-task-suite-record.ts likewise), so the guard drops only corrupt input. The control
//            that pins the divergence — and that the retired copies agree on every other input — is
//            in plugin/test/gate-script-base.test.mjs.
//
// FAIL-OPEN by design: an absent or unreadable file yields `[]`, never a throw. The distinction a
// reader cannot make here is the CALLER's: a checker that must report NOT-EVALUATED for "the carrier
// is absent" (硬规则 3b) rather than PASS for "the carrier is empty" must stat the file itself —
// freshness-producer-coverage-check.ts does exactly that with `fs.existsSync` before calling, and
// reports the two states with different `reason` strings.
export function readJsonLines(file: string): Record<string, unknown>[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return []; // absent / unreadable carrier = no history (see the fail-open note above)
  }
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (typeof v === "object" && v !== null && !Array.isArray(v)) rows.push(v as Record<string, unknown>);
    } catch {
      // A malformed line is skipped rather than fatal — these carriers are append-only across many
      // writers, and one torn line must not blind the whole judgement.
    }
  }
  return rows;
}

// ── readJsonlLines ──────────────────────────────────────────────────────────────────────────────────
// The SENTINEL-PRESERVING sibling of `readJsonLines` above. Same job (a `.quay/*.jsonl` carrier →
// `Record<string, unknown>[]`), deliberately DIFFERENT contract on the two inputs a checker must be
// able to read separately. Extracted here — byte-identical from two private copies — by
// semantic-dedup-scan finding `byte-identical-body` (`.quay/routine-findings.jsonl`, routine
// `semantic-dedup-scan`, runId `semantic-dedup-scan-1790592211995`, verdict `real-duplication`,
// requested action `extract the counting variant`), which named its two carriers:
//   direct-to-develop-bypass-check.ts:926 / fan-in-ff-protocol-check.ts:280.
//
// ⛔ DO NOT collapse this into `readJsonLines` above. The divergence is load-bearing on BOTH axes, and
// folding it in disarms two checkers (硬规则 3b — a judge that cannot read its input must not return a
// value shaped like "qualified"):
//   axis 1 — absent file ⇒ `null`, NOT `[]`. `readJsonLines`'s fail-open `[]` makes "the carrier was
//            never written" indistinguishable from "the carrier exists and is empty"; both callers
//            branch on the distinction (`no-lock-events-file` / `no-lock-events (vacuous…)`). A
//            caller that must report NOT-EVALUATED for an absent carrier can still stat the file
//            itself (freshness-producer-coverage-check.ts does), but these two do not — they need the
//            reader to say it.
//   axis 2 — a corrupt/torn line ⇒ a `{__unparseable: true}` PLACEHOLDER ROW, NOT a skip. The
//            placeholder keeps the row→line correspondence so a caller can report
//            `malformed-lock-events (NOT-EVALUATED)`. `readJsonLines` drops the line instead, which
//            would make `rows.some(r => r.__unparseable)` permanently FALSE ⇒ the malformed branch
//            goes dead and a NOT-EVALUATED state silently becomes a PASS. It is consumed at exactly
//            those call sites (`.some(e => e && e.__unparseable)` in both carriers).
// The prior disposition of the sibling finding `readjsonllines-load-bearing-unparseable-sentinel`
// (same runId) was "do not fold"; that stands — this extraction moves the code WITHOUT touching the
// agreed contract. The mechanical form of the boundary is in plugin/test/gate-script-base.test.mjs
// ("BOUNDARY: …") — folding the pair in goes RED there rather than quietly disarming two checkers.
//
// Behaviour beyond the two axes is `readJsonLines`-equivalent (blank lines skipped, non-object rows
// kept as-is — a check this file's sibling reader does not make, and the callers index only on
// `__unparseable`). A path that exists but cannot be READ (e.g. a directory: EISDIR) still THROWS —
// unchanged from both former copies, and deliberately not widened to `null` here: `null` means "no
// carrier", which these callers treat as a vacuous PASS.
export function readJsonlLines(file: string): Record<string, unknown>[] | null {
  if (!fs.existsSync(file)) return null;
  const out: Record<string, unknown>[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { out.push({ __unparseable: true }); }
  }
  return out;
}

// ── readJsonOrNull ──────────────────────────────────────────────────────────────────────────────────
// The whole-file JSON reader: parse `file`, or `null` when it is absent / unreadable / unparseable.
// Both consumers are state readers for which "no state on disk" and "unreadable state" are the SAME
// decision — overwrite with a fresh state, so a `null` is the right answer rather than a throw.
// Extracted here — byte-identical from both private copies — by semantic-dedup-scan finding
// `read-current-state-duplicate` (`.quay/routine-findings.jsonl`, routine `semantic-dedup-scan`,
// runId `semantic-dedup-scan-1791536153223`, kind `byte-identical-body`, verdict `real-duplication`,
// requested action `merge into one shared readJsonOrNull`), which named its two carriers:
//   plugin/scripts/mirror-full-suite-state.ts:128 / plugin/scripts/red-window-triage.ts:159
// (the first was an exported entry point and keeps that name, feeding its mirror-write skip guard;
// the second was private to red-window-triage.ts).
//
// ⛔ Why this is NOT `readJsonLines` above: that reader is LINE-delimited (JSONL) and fail-open to
// `[]`; this one parses ONE JSON document and its `null` is load-bearing (the callers branch on
// "unreadable ⇒ refuse/write-fresh"). Two different carriers, two contracts — do not fold them.
export function readJsonOrNull<T = any>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

// ── normalizeRel ────────────────────────────────────────────────────────────────────────────────────
// Normalize a repo-relative path or glob to a canonical form: backslashes → forward slashes, drop
// empty (`//`) and `.` segments, resolve `..` (a leading `..` is dropped), strip a leading `./`,
// drop a trailing `/`. Wildcard segments are preserved untouched. This is the single normalization
// the touches/resolver scripts share so path-shape tricks (`./`, `//`, trailing `/`) cannot spoof
// identity (gap-b3: was 4 byte-identical per-file copies, two of whose comments each claimed to be
// the canonical version — the code was identical, so this is that shared code).
export function normalizeRel(p: string): string {
  const parts = String(p).replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return out.join("/");
}

// ── seededRng (the ONE deterministic PRNG) ──────────────────────────────────────────────────────────
// mulberry32. ONE implementation for the whole plugin/scripts tree — it was three byte-identical copies
// under two names (`mulberry32` in defect-latency-pair.ts / rework-predictors.ts, `makeRng` in
// discovery-path-classify.ts); .quay/routine-findings.jsonl finding
// `seeded-prng-three-copies-two-names-reproducibility-primitive`, routine `semantic-dedup-scan`.
// Those three sites now re-export from here under their historical names (ADR-004 single source).
//
// WHY THIS MATTERS BEYOND TIDINESS: a seed is the reproducibility primitive cross-report seed
// comparability depends on — a seed recorded in a doc must reproduce the same draw for every reader,
// so the extraction MUST NOT move a single output value. The third copy carried the same algorithm in a
// different expression form (`a = (a + c) | 0` and `(t + …) ^ t` instead of `(a + c) >>> 0` and
// `t ^= …`). Measured 2026-09-26 over 10 seeds × 10000 draws: 0/100000 mismatches — and the same
// comparator reads 100000/100000 against a deliberately perturbed increment, so the zero is a
// measurement rather than a blind instrument (硬规则 2: a zero count needs the predicate dry-run against
// a known-true sample). The `>>> 0` form is kept as canonical.
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Verdict emission (the behavior contract) ─────────────────────────────────────────────────────────
// The three-state verdict output layer shared by checkers: PASS (exit 0) / FAIL (exit 1) /
// NOT-EVALUATED (exit 3 — the harness-canonical third state per gap-not-evaluated-harness-third-state;
// the mechanical-spine vocabulary {0,1,2,3} reserves 2 for usage/env error and 3 for NOT-EVALUATED).
// The three states converge on driver-result.ts's DriverResult<T> (verified↔pass, failed↔fail,
// not-evaluated↔not-evaluated) — this is the OUTPUT rendering of that same three-state, NOT a new
// competing vocabulary (SPEC-methodology-layer-architecture §2.3a: reuse, don't design a new contract).
//
// Each emit* accepts an optional structured `detail` (violations, counts, exemptions, …) that is
// merged into the `--json` output, so a checker expresses a violations list / structured verdict
// without hand-rolling JSON.stringify. `emitVerdict` (and each emit*) RETURNS the exit code — the
// base owns the verdict→exit-code mapping, not each checker (the behavior contract this module was
// missing: emitPass/emitFail used to print only and leave the exit code to the caller).

export type VerdictStatus = "pass" | "fail" | "not-evaluated";

export interface Verdict {
  status: VerdictStatus;
  message: string;
  /** Arbitrary structured payload (violations, counts, …) merged into the --json output. */
  detail?: unknown;
}

export interface EmitOptions {
  /** Emit a structured JSON verdict (single line) instead of a human "PASS: …" line. */
  json?: boolean;
  /** Which stream the verdict line goes to (default "stdout"). */
  stream?: "stdout" | "stderr";
}

/** Verdict status → exit code (pass→0, fail→1, not-evaluated→3). The single statement of the mapping. */
export const VERDICT_EXIT_CODE: Readonly<Record<VerdictStatus, number>> = {
  pass: 0,
  fail: 1,
  "not-evaluated": 3,
};

export function verdictExitCode(status: VerdictStatus): number {
  return VERDICT_EXIT_CODE[status];
}

/** Emit a three-state verdict and return its exit code. Human mode prints one
 *  `PASS:` / `FAIL:` / `NOT-EVALUATED:` line; --json mode prints
 *  `{ status, ok, message, ...detail }`. */
export function emitVerdict(verdict: Verdict, opts: EmitOptions = {}): number {
  const { json = false, stream = "stdout" } = opts;
  const out = stream === "stderr" ? process.stderr : process.stdout;
  if (json) {
    const detail = verdict.detail;
    const base: Record<string, unknown> =
      detail !== null && typeof detail === "object" && !Array.isArray(detail)
        ? { ...(detail as Record<string, unknown>) }
        : detail === undefined
          ? {}
          : { detail };
    base.status = verdict.status;
    base.ok = verdict.status === "pass";
    base.message = verdict.message;
    out.write(JSON.stringify(base) + "\n");
  } else {
    const prefix =
      verdict.status === "pass" ? "PASS" : verdict.status === "fail" ? "FAIL" : "NOT-EVALUATED";
    out.write(`${prefix}: ${verdict.message}\n`);
  }
  return verdictExitCode(verdict.status);
}

export function emitPass(message: string, detail?: unknown, opts?: EmitOptions): number {
  return emitVerdict({ status: "pass", message, detail }, opts);
}

export function emitFail(message: string, detail?: unknown, opts?: EmitOptions): number {
  return emitVerdict({ status: "fail", message, detail }, opts);
}

export function emitNotEvaluated(message: string, detail?: unknown, opts?: EmitOptions): number {
  return emitVerdict({ status: "not-evaluated", message, detail }, opts);
}

// ── requireArg ──────────────────────────────────────────────────────────────────────────────────────
// Check that a value is present (not undefined, null, or empty string).
// Exits with code 2 if the value is missing.
export function requireArg(value: any, name: string): void {
  if (value === undefined || value === null || value === "") {
    console.error(`ERROR: ${name} is required`);
    process.exit(2);
  }
}

// ── isDirectEntry ───────────────────────────────────────────────────────────────────────────────────
// Standard "is this file being run directly?" check for CLI scripts.
// Usage (expectedBase is REQUIRED — see below):
//   if (isDirectEntry(import.meta, undefined, "tool-name")) main(process.argv).then(code => process.exit(code));
//
// BUNDLER-FRIENDLY (gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact): when a
// plugin .ts is bundled into a single ESM file, EVERY inlined module shares the bundle's
// `import.meta.url`, so the URL-equality check alone returns true for imported libraries too — the
// library's top-level CLI block would fire while another tool runs. Callers therefore pass their own
// canonical basename as `expectedBase`; the check requires the executed file's basename to match,
// which holds for the entry in both source and bundle forms and never for an inlined library (the
// bundle's basename is the entry's, not the library's).
//
// ⛔ The bare `isDirectEntry(import.meta)` form NO LONGER EXISTS, on purpose
// (gap-drivers-yml-interval-not-honored-for-routine-kinds). It compared `realpath(argv[1])` against
// `import.meta.url`, which is a FILE identity — correct in the source layout, but under bundling the
// whole inlined module set shares one file, so every inlined module's guard became true at once and
// the FIRST one in bundle order won. Measured 2026-09-13 on the shipped `plugin/scripts/dist/`
// bundles: `dist/{goal,quality-gate,meta}-driver.js` all executed `pool-quality-judge`'s main (the
// first inlined library carrying a bare guard) instead of their own — the routine drivers therefore
// printed the pool judge's JSON and exited 0 in <1s, and the supervisor respawned them every
// `--restart-delay` (5s). The declared `drivers.yml <kind>.interval_ms` never entered the cadence
// because the driver process never reached its resident loop. Making `expectedBase` REQUIRED is the
// mechanism, not a reminder: a bare guard is now a type error instead of a silent wrong-module run.
// `importMeta` is kept ONLY for call-site compatibility (100+ callers pass it positionally) and is
// deliberately not consulted — module identity cannot come from the URL under bundling.
export function isDirectEntry(importMeta: ImportMeta, argv1: string | undefined, expectedBase: string): boolean {
  void importMeta; // identity is name-based, never URL-based (see above)
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// ── git helpers ─────────────────────────────────────────────────────────────────────────────────────
// The ONE in-process `git <args...>` runner for gate scripts. Extracted (routine `semantic-dedup-scan`,
// finding `git-helper-collector-gate`, runId `semantic-dedup-scan-1790995446200`, verdict
// real-duplication, suggestedAction extract) from build-evidence-collector.ts / build-evidence-gate.ts,
// which each carried a byte-identical private copy of `GitResult` + `git()`.
//
// FAIL-CLOSED by contract: a git command failure is a DISTINGUISHABLE result (`ok:false` + `error`),
// never conflated with a legitimately empty diff (`ok:true` + empty stdout) — hard rule 3b. This module
// deliberately exports only the fail-closed form, so no caller can mistake "git could not run" for
// "git said nothing".

export interface GitResult {
  ok: boolean;
  stdout: string;
  error?: string;
}

/** Run `git <args...>` in `cwd`. Returns trimmed stdout on success; a failed invocation is a RESULT
 *  (`ok:false`, `error` = the exec error message), not an exception. */
export function git(args: string[], cwd: string): GitResult {
  try {
    const stdout = execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf8", timeout: 10_000 }).trim();
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: "", error: (e as Error).message };
  }
}

/** The last commit that touched `relPath` (repo-relative) in `cwd`, or "" when git cannot answer.
 *  Extracted (routine `semantic-dedup-scan`, finding `ident-fcdeccc5d81b054c`, runId
 *  `semantic-dedup-scan-1791142275270`, verdict real-duplication, suggestedAction extract) from
 *  run-identity.ts / stage-receipt.ts, which each carried a byte-identical `deriveWorkflowSourceCommit`
 *  wrapping the same `git log -1 --format=%H -- <path>` invocation. Both callers returned "" on a
 *  failed invocation, so a never-committed path and an un-runnable git stay one "" result — this
 *  helper preserves exactly that. */
export function gitLastCommitForPath(cwd: string, relPath: string): string {
  const result = git(["log", "-1", "--format=%H", "--", relPath], cwd);
  return result.ok ? result.stdout : "";
}

// ── Deterministic canonical JSON serialization ───────────────────────────────────────────────────────
// The ONE implementation of "single-line JSON whose key ORDER cannot leak into the bytes": top-level
// keys sorted, and each nested plain object's keys sorted too, so two structurally-equal values
// serialize byte-identically regardless of key insertion order. Never lossy — every field survives,
// including array elements and nulls, which are emitted as-is (arrays are NOT re-ordered: their order
// is data, not a set).
//
// WHY THIS EXPORT EXISTS — it is an extraction, not a new idea (same mandate as `flagValue` / `git` /
// `gitLastCommitForPath` above; ADR-004/DIR-091). A `semantic-dedup-scan` pass
// (.quay/routine-findings.jsonl, routine `semantic-dedup-scan`, runId `semantic-dedup-scan-1791631645924`,
// finding `serializeidentity-serializereceipt`, verdict `real-duplication`, suggestedAction `extract`)
// found the body CHARACTER-IDENTICAL under two names — `serializeIdentity` (run-identity.ts) and
// `serializeReceipt` (stage-receipt.ts) — and the same principle-5b sweep of this carrier found a third
// copy inlined in `execution-policy.ts`'s `bindPolicyHash`. All three callers already import this
// module, so the shared accessor belongs here rather than in a new file.
//
// ⛔ ONE NESTING LEVEL, NOT RECURSIVE — deliberately, and this is load-bearing, not an oversight.
// `serializePolicy` (execution-policy.ts) sorts RECURSIVELY and is intentionally left alone; folding it
// onto this helper would change the bytes it hashes. Here, a value nested two levels deep keeps its own
// insertion order. That asymmetry is the pre-extraction behavior of all three call sites (measured, not
// assumed), and the serialized bytes of a stage receipt are HASH-BOUND (contentHash), so widening the
// sort would silently re-hash every existing receipt. Use a recursive serializer where depth is
// unbounded; use this one where the envelope is a flat record of scalars + one level of sub-records.
export function serializeSortedJson(value: unknown): string {
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const v = source[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        nested[k] = (v as Record<string, unknown>)[k];
      }
      sorted[key] = nested;
    } else {
      sorted[key] = v;
    }
  }
  return JSON.stringify(sorted);
}

// ── Selftest harness (ADR-018 selfcheck-fixture pattern) ─────────────────────────────────────────────
// The ONE implementation of the per-gate `--selftest` fixture harness. Every ADR-018 selfcheck needs the
// same four things — a `check(name, condition, detail)` assertion, a pass/fail tally, the verdict, and a
// one-line summary — and before this export the whole surface carried its own copy of that bookkeeping
// (semantic-dedup-scan routine, finding `check-harness-three-incompatible-shapes`, runId
// semantic-dedup-scan-1789723686226, verdict real-duplication, suggestedAction extract; ADR-018 itself
// names DIR-091 as the extraction mandate, which M152 executed for parseArgs / verdict emission /
// requireArg / isDirectEntry but NOT for this harness).
//
// ⚠️ `flavor` is NOT a gratuitous knob — it is the CENSUS of the summary spellings the copies had, and
// the copies' outputs are load-bearing (a gate's selftest line is read by humans and, in at least one
// case, asserted by a test: `plugin/test/external-dogfooding-check.test.mjs` matches
// /SELFTEST: all fixture cases PASS\./ — WITH the period). Extracting the harness must therefore NOT
// silently re-word any gate's output; each spelling is preserved verbatim and named here.
//   • "counters"      — per-failure `FAIL: <name>[ — <detail>]` on STDERR; summary
//                       `\n<label> --selftest: N passed, M failed` on STDOUT; verdict `fail === 0`.
//   • "cases"         — `SELFTEST PASS: <name> — <detail>` on STDOUT / `SELFTEST FAIL: …` on STDERR;
//                       summary `\nSELFTEST: all fixture cases PASS` | `SOME FIXTURES FAILED` on STDOUT.
//   • "cases-period"  — same per-case lines; summary `SELFTEST: all fixture cases PASS.` on STDOUT |
//                       `SELFTEST: one or more fixture cases FAILED.` on STDERR (no leading newline).
//
// `detail` is deliberately NOT defaulted: the copies disagreed here by omission, and `${detail}` renders
// an omitted detail as the literal `undefined` under "cases" (matching the copies) while the falsy test
// under "counters" renders it as no suffix at all (also matching). A `detail = ""` default would have
// changed the "cases" output of any call site that omitted it.
//
// `collectFailures` / `dumpFailuresJson` are the shape the five accumulator copies had (execution-policy /
// finding-backpropagate / run-identity / stage-receipt / workflow-journal): the same lines plus
// `JSON.stringify({ ok: false, failures })` on STDOUT when the verdict is fail.
export interface SelftestFailure {
  name: string;
  detail?: string;
}

export type SelftestFlavor = "counters" | "cases" | "cases-period";

export interface SelftestOptions {
  flavor: SelftestFlavor;
  /** "counters" only: the label in `<label> --<verb>: N passed, M failed` (the script's own name). */
  label?: string;
  /** "counters" only: the summary verb. The family has TWO observed spellings — `--selftest` (24 copies)
   *  and `--selfcheck` (pane-state-classify / transcript-delivery-check); the flag each script accepts is
   *  unchanged, only the published summary word is declared here. */
  verb?: "selftest" | "selfcheck";
  /** "cases"/"cases-period": keep every failure's {name, detail} in `failures`. */
  collectFailures?: boolean;
  /** "cases"/"cases-period": print `JSON.stringify({ ok: false, failures })` when the verdict is fail. */
  dumpFailuresJson?: boolean;
}

export interface Selftest {
  /** Assert one fixture case. `detail` is rendered verbatim (see the note above). */
  check(name: string, condition: boolean, detail?: string): void;
  readonly pass: number;
  readonly fail: number;
  readonly allPassed: boolean;
  readonly failures: ReadonlyArray<SelftestFailure>;
  /** Print the flavor's summary line(s) and return the verdict (true = every fixture case passed). */
  report(): boolean;
}

export function createSelftest(opts: SelftestOptions): Selftest {
  const { flavor, label, verb = "selftest", collectFailures = false, dumpFailuresJson = false } = opts;
  let pass = 0;
  let fail = 0;
  let allPassed = true;
  const failures: SelftestFailure[] = [];

  const check = (name: string, condition: boolean, detail?: string): void => {
    if (condition) {
      pass++;
      if (flavor !== "counters") console.log(`SELFTEST PASS: ${name} — ${detail}`);
      return;
    }
    fail++;
    allPassed = false;
    if (flavor === "counters") {
      console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
      return;
    }
    console.error(`SELFTEST FAIL: ${name} — ${detail}`);
    if (collectFailures) failures.push({ name, detail });
  };

  const report = (): boolean => {
    if (flavor === "counters") {
      console.log(`\n${label} --${verb}: ${pass} passed, ${fail} failed`);
      return fail === 0;
    }
    if (flavor === "cases-period") {
      if (allPassed) {
        console.log("SELFTEST: all fixture cases PASS.");
        return true;
      }
      console.error("SELFTEST: one or more fixture cases FAILED.");
      return false;
    }
    console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
    if (dumpFailuresJson && !allPassed) console.log(JSON.stringify({ ok: false, failures }));
    return allPassed;
  };

  return {
    check,
    get pass() { return pass; },
    get fail() { return fail; },
    get allPassed() { return allPassed; },
    get failures() { return failures; },
    report,
  };
}
