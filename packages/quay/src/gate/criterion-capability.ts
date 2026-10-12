// QENG — criterion CAPABILITY judge: "is this criterion a READING, or an ACTION?"
// (tasks/gap-criterion-side-effect-unguarded-at-write-and-execution-surface, ADR-004 hardening)
//
// WHY THIS MODULE EXISTS. A goal `criterion` is free-text shell, and the goal paths re-execute
// criteria on a schedule with nobody watching: `check --stale-pass --sweep` rotates the frozen
// population forever, `check --achieved-failing` re-runs every achieved AC in scope. A criterion
// that WRITES is therefore not "a check that happens to have a side effect" — it is an unattended,
// open-ended writer. Measured on the incident that produced this file: one `achieved` AC was
// evaluated in **112 goal rounds**, its criterion really calling `session_create`/`session_send`
// against a live gateway (`quay-fleet` AC-020, 2026-10-12).
//
// The channel conflates 「读数」(a reading — re-running it forever is free) with 「动作」(an action
// — re-running it forever is a machine that keeps acting). This module is the executable form of
// 「criterion 必须是读数」 — the rule previously lived ONLY as prose in an incident document, which
// ADR-004 forbids for a load-bearing rule.
//
// ── ⛔ THE VERDICT COMES FROM CAPABILITY, NEVER FROM SPELLING ────────────────────────────────────
// A criterion string CANNOT be classified by how it is written. Measured on this repository's own
// 227 live criteria, each naive spelling axis fires on things that are plainly readings:
//
//   * 「写动词」(`create|send|commit|push|post|…` as a token)  → 87 hits, all of them DATA:
//     `store-writes-raw-commit`, `post_upgrade_task_count`, `commit_sha`, `merge-base`. A token
//     that happens to contain a write word is not a write.
//   * 「端点字面量」(any `scheme://…` or `host:port`)          → 21 hits, all of them READ-ONLY
//     live probes (`curl -sf … http://$a$ROUTE`) that this repo runs on purpose.
//   * 「按文件名/路径拼写」                                    → the incident proved this twice: the
//     first lock asked "does the file define a `callTool` method" and the offending file HAD one —
//     a forwarding shell straight to the real client; and moving the file out of `test/` "fixed"
//     nothing, because a criterion naming it by EXPLICIT path still executes it (that is how the
//     storm was re-armed 13 minutes after the first "fix").
//
// So the three axes that survive are the ones that judge a MECHANISM:
//   1. `declared-real-infra-artifact`  — the artifact the criterion EXECUTES declares, in its own
//      bytes, that it reaches real infrastructure (`@real-infra`). Same dialect as the workspace
//      static locks, so one declaration serves both readers.
//   2. `declared-write-capable-command` / `declared-real-endpoint` — the WORKSPACE declares the
//      capability in `.quay/criterion-capabilities.json` (an API surface + its proof, or a real
//      endpoint literal). ⛔ Core ships NO cross-project table: which verbs write is a fact about a
//      project, and only that project can declare it.
//   3. `uncertifiable-executed-artifact` — the criterion executes a literal path that does not
//      resolve in the tree it will run in, so its capability cannot be established at all ⇒ the
//      third state, NOT a guess (hard rule 3b). Respelling is irrelevant: `x/y.mjs`,
//      `./x/y.mjs` and `a/../x/y.mjs` resolve identically, which is the whole point of not keying
//      on the string.
//
// ── 三态 (hard rule 3b — a verdict machine must not return "looks fine" for "could not read the
//    input") ───────────────────────────────────────────────────────────────────────────────────
//   read-only      — nothing above fired; the criterion is re-runnable forever.
//   side-effecting — a capability was DECLARED (axes 1/2) ⇒ refuse.
//   not-evaluated  — the capability could not be established (axis 3) ⇒ refuse, with a DIFFERENT
//                    stable code, because "declared dangerous" and "unreadable" are different
//                    facts and a caller must be able to tell them apart.
// ⛔ Both refusals are fail-closed and carry a stable `code`; a caller branches on the code, never
//   on the message text.
//
// ⛔ PURE READER — nothing here executes anything, and nothing here spawns. Text in, verdict out
//   (the same "pure judgment + injected seam" shape as `criterion-fidelity.ts`, the sibling axis).

import fs from "node:fs";
import path from "node:path";

/** The capability pragma an artifact carries in its own head. ONE dialect, two consumers: this
 *  judge (execution surface) and a workspace's static lock over `goals/**` (commit surface). */
export const REAL_INFRA_PRAGMA = "@real-infra";

/** The file a workspace uses to declare capability it owns. Read from the goal store's `.quay/`. */
export const CAPABILITY_FILE = "criterion-capabilities.json";

/** The three-state capability verdict. */
export type CriterionCapability = "read-only" | "side-effecting" | "not-evaluated";

/** The stable refusal codes. ⛔ Callers branch on THESE, never on a message. */
export type CriterionCapabilityCode = "criterion-side-effect" | "criterion-capability-unevaluable";

/** The mechanism that produced a reason — enumerated so a red can be argued with, not just obeyed. */
export type CapabilityRule =
  | "declared-real-infra-artifact"
  | "declared-write-capable-command"
  | "declared-real-endpoint"
  | "uncertifiable-executed-artifact";

export interface CapabilityReason {
  rule: CapabilityRule;
  /** what fired (the artifact path / the command id / the endpoint literal) */
  detail: string;
  /** the MECHANISM behind the declaration — the evidence, so the red is arguable */
  proof?: string;
}

export interface CapabilityJudgment {
  capability: CriterionCapability;
  /** non-null exactly when `capability !== "read-only"` */
  code: CriterionCapabilityCode | null;
  /** empty ⟺ read-only. Never empty for a refusal (hard rule 3: enumerate, don't boolean). */
  reasons: CapabilityReason[];
}

/** A workspace's declared capability. `writeCapableCommands[].pattern` is a regex SOURCE string
 *  (data, not code — Core never imports workspace code). */
export interface CapabilityDeclaration {
  writeCapableCommands?: Array<{ id: string; pattern: string; capability?: string; proof?: string }>;
  realEndpoints?: string[];
}

const DECLARATION_EMPTY: CapabilityDeclaration = Object.freeze({ writeCapableCommands: [], realEndpoints: [] });

/**
 * Read the workspace's capability declaration. ⛔ Best-effort by design: an absent or unreadable
 * file means "this workspace declared nothing", which is a fact about the workspace — it is NOT
 * silently equal to "this workspace declared everything is safe" (that would be hard rule 3b's
 * failure mode). The axes that do not depend on a declaration (artifact pragma, uncertifiable
 * artifact) keep working either way.
 */
export function readCapabilityDeclaration(root: string): CapabilityDeclaration {
  const file = path.join(root, ".quay", CAPABILITY_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return DECLARATION_EMPTY;
  }
  try {
    const parsed = JSON.parse(raw) as CapabilityDeclaration;
    if (!parsed || typeof parsed !== "object") return DECLARATION_EMPTY;
    return {
      writeCapableCommands: Array.isArray(parsed.writeCapableCommands) ? parsed.writeCapableCommands.filter((c) => c && typeof c.pattern === "string") : [],
      realEndpoints: Array.isArray(parsed.realEndpoints) ? parsed.realEndpoints.filter((e) => typeof e === "string") : [],
    };
  } catch {
    return DECLARATION_EMPTY;
  }
}

// ── shell tokenization (quote-aware) ─────────────────────────────────────────────────────────────
// Only enough shell to find EXECUTED ARTIFACTS — ⛔ not a shell parser, and never a place where a
// verdict is decided (that is the declaration axes' job above).

/** A `#` in a command WORD position starts a comment to end of line (POSIX sh). ⛔ Must be handled
 *  or a commented-out line is read as if the shell would run it — measured: AC-294's criterion
 *  carries `# … /manager assertions were …`, and treating that as a command invented an
 *  unresolvable `/manager` "artifact" out of prose. */
function startsComment(text: string, i: number): boolean {
  if (text[i] !== "#") return false;
  if (i === 0) return true;
  const prev = text[i - 1];
  return /[\s;|&(]/.test(prev);
}

/**
 * If a here-doc operator (`<<`, `<<-`) starts at `at`, return the index of the LAST character of
 * its body (the newline that ends the delimiter line), else null.
 *
 * The delimiter is the next word, with any quoting removed (`<<'P'` and `<<P` both delimit on `P`);
 * the body runs to the first line that is exactly the delimiter (leading tabs stripped for `<<-`).
 */
function readHereDoc(text: string, at: number): { end: number } | null {
  let i = at + 2;
  let stripTabs = false;
  if (text[i] === "-") {
    stripTabs = true;
    i++;
  }
  while (text[i] === " " || text[i] === "\t") i++;
  let delim = "";
  let quote: string | null = null;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) {
        quote = null;
        continue;
      }
      delim += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (/[\s;|&<>]/.test(c)) break;
    delim += c;
  }
  if (delim === "") return null;
  // skip to the end of the opening line
  let j = text.indexOf("\n", i);
  if (j === -1) return null;
  for (;;) {
    const lineEnd = text.indexOf("\n", j + 1);
    const rawLine = text.slice(j + 1, lineEnd === -1 ? text.length : lineEnd);
    const line = stripTabs ? rawLine.replace(/^\t+/, "") : rawLine;
    if (line === delim || (lineEnd === -1 && line === delim)) return { end: lineEnd === -1 ? text.length : lineEnd };
    if (lineEnd === -1) return null; // unterminated here-doc — treat the rest as the body
    j = lineEnd;
  }
}

/** Split a criterion into the command strings a shell would run (split on UNQUOTED `|`, `&`,
 *  `;`, newline). Quoted separators are preserved — that is what keeps `node -e "a | b"` one
 *  command and, later, keeps an inline program from being mistaken for a path. */
export function splitShellCommands(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (startsComment(text, i)) {
      while (i < text.length && text[i] !== "\n") i++;
      out.push(cur); // a comment runs to end-of-line ⇒ it always ends the command
      cur = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "\\") {
      cur += c + (text[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === "<" && text[i + 1] === "<") {
      // A here-doc: everything up to the delimiter line is the PROGRAM BODY, not shell. ⛔ Skipping
      // it is not tidiness — the body of `python3 - <<'P' … P` is a Python program whose docstrings
      // are prose, and reading that prose as shell invented `/manager` out of a sentence in AC-294.
      const here = readHereDoc(text, i);
      if (here !== null) {
        out.push(cur);
        cur = "";
        i = here.end;
        continue;
      }
    }
    if (c === "\n" || c === ";") {
      out.push(cur);
      cur = "";
      continue;
    }
    if (c === "|" || c === "&") {
      out.push(cur);
      cur = "";
      if (text[i + 1] === c) i++;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

interface Word {
  text: string;
  /** true when the word came from a quoted region — quoted words are never a script path */
  quoted: boolean;
}

/** Quote-aware word split: whitespace OUTSIDE quotes separates; a quoted region becomes ONE word
 *  with its quotes removed (so `'a b.mjs'` is a single word containing a space, which the
 *  path test below rejects as "not a single path token"). */
function splitWords(cmd: string): Word[] {
  const out: Word[] = [];
  let cur = "";
  let quote: string | null = null;
  let quoted = false;
  let started = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote !== null) {
      if (c === quote) {
        quote = null;
        continue;
      }
      cur += c;
      started = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      quoted = true;
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) out.push({ text: cur, quoted });
      cur = "";
      quoted = false;
      started = false;
      continue;
    }
    cur += c;
    started = true;
  }
  if (started) out.push({ text: cur, quoted });
  return out;
}

/** Interpreters whose first non-flag argument is the program they execute. */
const INTERPRETERS = new Set(["node", "nodejs", "python", "python3", "bash", "sh", "dash", "zsh", "bun", "deno", "ruby", "perl"]);

/** Interpreter flags whose ARGUMENT is the program text itself (`node -e '<program>'`), so the
 *  next word is never an artifact. */
const INLINE_PROGRAM_FLAGS = new Set(["-e", "-c", "--eval", "-p", "--print", "-m"]);

const SCRIPT_EXT = /\.(mjs|cjs|js|jsx|mts|cts|ts|tsx|sh|bash|py|rb|pl|zsh)$/;

/** Characters that make a token a NON-literal: a variable reference, a glob, a regex, a
 *  substitution, a URL query… None of them names a file we could read, so none is an artifact.
 *  ⛔ This is not a spelling rule — it is "the string does not denote one file at judge time". */
const NON_LITERAL = /[$`*?[\]{}()<>^~!]/;

/** Can this token denote a single file path? */
function isLiteralPathToken(text: string, quoted: boolean): boolean {
  if (quoted) return false;
  if (text.length < 3) return false;
  if (/\s/.test(text)) return false;
  if (text.startsWith("-")) return false;
  if (NON_LITERAL.test(text)) return false;
  return text.includes("/") || SCRIPT_EXT.test(text);
}

/** One program a criterion executes, and HOW the shell reaches it — the distinction decides whether
 *  a missing file is `not-runnable` (the shell says so, precisely) or a lie (the interpreter says
 *  "false" about a command that never ran). See `executedArtifacts`. */
export interface ExecutedArtifact {
  path: string;
  via: "interpreter" | "direct";
}

/**
 * The artifacts a criterion EXECUTES (as opposed to merely reads). ⛔ Deliberately narrow: only a
 * program POSITION counts — `node <path>`, `python3 <path>`, `bash <path>`, `--test <path>`, or a
 * directly-executed `./x` / `x.sh`. A path mentioned inside an inline program (`node -e "…import(
 * './x.ts')…"`), inside a grep pattern, or as a data file argument is NOT an execution.
 *
 * ⛔ This function produces CANDIDATES for the `uncertifiable` axis only. It never decides
 * "dangerous" — a name is not a capability.
 *
 * `via` is not bookkeeping. A MISSING directly-executed program (`./scripts/gone.sh`) makes the
 * SHELL exit 126/127, which `verdictFromAcceptance` already maps to `not-evaluated (not-runnable)`
 * — a precise, existing answer. A missing INTERPRETER argument (`node gone/x.mjs`) makes the
 * interpreter exit 1 ("Cannot find module"), which the runner maps to **`fail`** — it asserts "this
 * criterion is FALSE" about a command that never ran. Same class of defect as the one this module
 * exists for, so only the second arm is worth pre-empting (measured: taking both arms pre-empted
 * `goal-gate-verdict-mapping.test.mjs`'s own 127 case and made a precise verdict vaguer).
 */
export function executedArtifacts(criterion: string): ExecutedArtifact[] {
  const out: ExecutedArtifact[] = [];
  for (const cmd of splitShellCommands(String(criterion))) {
    const words = splitWords(cmd).filter((w) => w.text !== "");
    let i = 0;
    // leading `VAR=value` assignments (and an `env` prefix) are not the command word
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i].text)) i++;
    if (words[i]?.text === "env") {
      i++;
      while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i].text)) i++;
    }
    const head = words[i]?.text;
    if (!head) continue;
    if (!INTERPRETERS.has(path.basename(head))) {
      // A directly-executed program — but `./x.sh` / `x.sh` only. ⛔ A bare `/word` is NOT an
      // execution: a URL route (`/manager`, `/architecture`) reads as one, and "it starts with a
      // slash" is exactly the spelling-based judgment this judge refuses to make. An absolute path
      // to a compiler-less executable without a script extension is a MISS for the uncertifiable
      // axis — the axis is a backstop, and losing a backstop case is preferable to inventing one.
      if (head.startsWith("./") || (SCRIPT_EXT.test(head) && head.includes("/"))) {
        if (isLiteralPathToken(head, words[i].quoted)) out.push({ path: head, via: "direct" });
      }
      continue;
    }
    // the interpreter's own program argument: the first non-flag word
    let skipNext = false;
    for (let k = i + 1; k < words.length; k++) {
      const w = words[k];
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (w.text === "-") break; // stdin (a pipe or a here-doc) — no external artifact
      if (w.text.startsWith("-")) {
        const flag = w.text.split("=")[0];
        if (INLINE_PROGRAM_FLAGS.has(flag) && !w.text.includes("=")) skipNext = true;
        continue;
      }
      if (isLiteralPathToken(w.text, w.quoted)) out.push({ path: w.text, via: "interpreter" });
      break;
    }
  }
  return out;
}

/** Does the file carry the artifact's own capability declaration in its head? A read failure is
 *  NOT a claim either way (⛔ it is not "safe") — the `uncertifiable` axis handles the absence. */
function artifactDeclaresRealInfra(abs: string): boolean {
  try {
    return fs.readFileSync(abs, "utf8").slice(0, 4096).includes(REAL_INFRA_PRAGMA);
  } catch {
    return false;
  }
}

/**
 * Judge ONE criterion string. Pure: `root` is the tree the criterion will run in (the criterion's
 * cwd — a branch-mode goal's criterion worktree when that is what the caller resolved), and every
 * path is resolved against it, so the verdict survives being respelled.
 */
export function judgeCriterionCapability(
  criterion: string,
  opts: { root: string; declaration?: CapabilityDeclaration },
): CapabilityJudgment {
  const source = typeof criterion === "string" ? criterion : "";
  const declaration = opts.declaration ?? readCapabilityDeclaration(opts.root);
  const sideEffecting: CapabilityReason[] = [];

  // axis 2a — the workspace declares a write-capable API surface
  for (const cmd of declaration.writeCapableCommands ?? []) {
    let re: RegExp;
    try {
      re = new RegExp(cmd.pattern);
    } catch {
      continue; // an unparseable pattern declares nothing — ⛔ never a silent "safe" either way
    }
    if (re.test(source)) {
      sideEffecting.push({ rule: "declared-write-capable-command", detail: cmd.id, ...(cmd.proof ? { proof: cmd.proof } : {}) });
    }
  }
  // axis 2b — the workspace declares a real endpoint
  for (const endpoint of declaration.realEndpoints ?? []) {
    if (endpoint !== "" && source.includes(endpoint)) {
      sideEffecting.push({ rule: "declared-real-endpoint", detail: endpoint });
    }
  }

  // axis 1 + axis 3 — the artifacts the criterion executes
  const uncertifiable: CapabilityReason[] = [];
  for (const artifact of executedArtifacts(source)) {
    const abs = path.isAbsolute(artifact.path) ? artifact.path : path.join(opts.root, artifact.path);
    if (!fs.existsSync(abs)) {
      // ⛔ ONLY the interpreter arm — see `ExecutedArtifacts`' own note: a missing direct-exec makes
      // the shell say 126/127 (already `not-runnable`, precise), while a missing interpreter argument
      // would be reported as a plain `fail`, i.e. as "this criterion is false". Pre-empting the first
      // would trade a precise verdict for a vaguer one and protect nothing (the file is not there to
      // run); pre-empting the second replaces a lie with the truth.
      if (artifact.via === "interpreter") {
        uncertifiable.push({ rule: "uncertifiable-executed-artifact", detail: artifact.path, proof: "does not resolve under the criterion's cwd, so its capability cannot be established (and the interpreter would report its absence as a plain failure, ⛔ not as not-evaluated)" });
      }
      continue;
    }
    if (artifactDeclaresRealInfra(abs)) {
      sideEffecting.push({ rule: "declared-real-infra-artifact", detail: artifact.path, proof: `${path.basename(abs)} carries ${REAL_INFRA_PRAGMA} in its own head` });
    }
  }

  // A DECLARED capability outranks an uncertifiable one: "this is known to write" is a stronger
  // and more actionable statement than "this could not be read", and both refuse anyway.
  if (sideEffecting.length > 0) return { capability: "side-effecting", code: "criterion-side-effect", reasons: sideEffecting };
  if (uncertifiable.length > 0) return { capability: "not-evaluated", code: "criterion-capability-unevaluable", reasons: uncertifiable };
  return { capability: "read-only", code: null, reasons: [] };
}

/** One-line, log-shaped rendering of a refusal — ⛔ the `code` is what callers branch on; this is
 *  for a human reading a ledger. */
export function capabilityRefusalReason(j: CapabilityJudgment): string {
  const why = j.reasons.map((r) => `${r.rule}: ${r.detail}${r.proof ? ` (${r.proof})` : ""}`).join("; ");
  return `${j.code}: criterion refused BEFORE execution — it is not a reading. ${why}. Fix: make it a zero-side-effect reading (assert on a file/log/state); if a real one-shot proof is needed, run it explicitly with --allow-side-effects.`;
}
