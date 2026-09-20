#!/usr/bin/env node
// cross-machine-verify.ts — cross-machine VERIFICATION of post-merge delivery.
// (tasks/gap-no-post-merge-cross-machine-verification-detection-latency-is-luck)
// (tasks/gap-arch-tsify-cross-machine-verify-sh — SPEC-architecture-consolidation §5 Phase 5.2: this
//  file is the former plugin/scripts/cross-machine-verify.sh, whose 489 code lines and five embedded
//  `python3` invocations are now ONE program instead of a bash program with a python program inside it.
//  The `.sh` beside it is a thin entry that execs this file, because `cross-machine-verify.sh` is a
//  written-down interface several callers invoke by that exact path. Behavior is pinned by
//  plugin/test/cross-machine-verify-characterization.test.mjs, which was committed BEFORE this rewrite.)
//
// THE GAP IT CLOSES: a wrong merge resolution has NO mechanism that finds it. Detection latency d is
// pure luck — the 4+3 real defects from the 2026-08-06 cross-machine merges were caught by ad-arm1's
// cold-start gate (a machine that happened to exist and happened to be running a gate), NOT by the
// merging machine's own suite (which had not run since 07:07Z while 161 commits landed). The conflict
// cost model (orchestration/ANALYSIS-when-should-B-develop-vs-only-file-tasks-2026-08-06.md) shows
// mechanical conflict resolution is negligible (c=0.006h) and essentially ALL cost is p·d — a wrong
// resolution that stays undetected. The parent environment masks the parent's defects (the verifying
// environment == the defect-producing environment), so the VERIFIER must be a machine that did NOT
// participate in the merge — a structural requirement, not redundancy.
//
// THE MECHANISM (slot-refill double-trigger pattern, per the task's Chosen mechanism — the SAME
// pattern the cross-machine sync mechanism uses; NO system crontab, this is the shipped mechanism):
//   1. event-driven (accelerated): at land time the MERGING machine records the merge it just landed
//      (`--record-merge <sha>` — called right after the land closure, same round). The merger identity
//      is therefore recorded by the ONLY machine that knows it — no attribution guessing.
//   2. tick-heartbeat (fallback must-run): every loop tick (both machines) UNCONDITIONALLY runs
//      `--verify` — it asks "are there merges a NON-participating machine can verify?" and runs the
//      fast gate for each. It does NOT depend on any completion event.
//
// SHARED STATE: git notes, pushed to the shared remote (origin) like the sync mechanism uses origin
// refs. Two notes refs:
//   refs/notes/quay-cmv-merge    per merge commit  {"type":"merge","sha":..,"branch":..,
//                                                    "merger_machine":"<hostname>","at":"<ISO commit time>"}
//   refs/notes/quay-cmv-verdict  per merge commit  {"type":"verdict","verifier_machine":"<hostname>",
//                                                    "at":"<ISO verdict time>","verdict":"green|red",
//                                                    "gate":"<name>","files":[...]}   (appendable)
// The notes refs ride the upgrade channel with the plugin and are the ONLY shared cross-machine channel
// besides the git refs themselves. A machine that did NOT record the merge fetches the notes and
// verifies. Merges with NO merge note (the land event was missed) are surfaced as UNATTRIBUTED and are
// NOT verified (fail-closed: you cannot prove non-participation for a merge you cannot attribute).
//
// THE FAST GATE: cold-start/smoke level (NOT the full suite — the full suite is 38 min and does not fit
// the d budget). Default = the cold-start gate `laydown-set-check.sh` (derived laydown set green) — the
// SAME gate that actually caught the 4+3 defects. Override with `--gate "<command>"`. The gate MUST
// name the failing file on red (negative control: deliberately break a tested function → the gate goes
// red AND names the file; a gate that cannot see a broken change is no gate at all).
//
// MEASUREMENT (the ## Contract surface):
//   detection_latency_h = post_merge_latency_h in `--report --json` — verified merge: verdict time −
//     merge commit time; pending merge: now − merge commit time. Mechanically readable, never recalled.
//   verifier_is_participant = (--report --json `verifier_machine` == `merger_machine` ? 1 : 0), band 0.
//
// Usage:
//   cross-machine-verify.sh [--root <repo>] [--remote <name>] [--branches "<b1> <b2>"]
//                           [--machine <id>] [--no-push] [--json] [--gate <cmd>]
//                           (--record-merge <sha> [<sha>...] | --verify | --report | --help)
//
//   --record-merge <sha>...  event-driven RECORD — the merging machine records the merges it just
//                            landed (idempotent: a merge note that already exists is skipped). Attaches
//                            a quay-cmv-merge note (merger_machine = this machine) and pushes notes.
//   --verify                 the heartbeat/event-driven VERIFY action — fetch notes, find merges on the
//                            target branches that (a) have a merge note, (b) merger_machine != this
//                            machine, (c) have NO verdict yet from a non-participating machine; run the
//                            fast gate for each (oldest first); attach a quay-cmv-verdict note and push.
//   --report (default)       list merges on the target branches with their merge/verdict notes;
//                            show which are unverified and how long each has waited; output the
//                            verifier_machine/merger_machine/post_merge_latency_h fields (--json).
//   --gate-run               run the fast gate directly and print its verdict JSON (the negative-control
//                            surface). Default gate: laydown-set-check.sh.
//   --gate <cmd>             override the fast-gate command (used by --verify / --gate-run). Default:
//                            `laydown-set-check.sh --root <repo>` (the cold-start gate).
//   --root <repo>            repo root (default: auto-derived from this script's location).
//   --remote <name>          notes remote (default: origin).
//   --branches "<b1> <b2>"   the merge-target branches to track (default: "develop integration").
//   --branch <b>             singular alias — the wiring (orchestrator 3b / periodic-push-backup hook)
//                            passes one branch.
//   --machine <id>           machine identity (default: `hostname`). Same namespace for merger and
//                            verifier so verifier_is_participant is mechanically comparable.
//   --no-push                never fetch/push notes (measure-only / local demo; default OFF).
//
// Exit codes:
//   0  success (recorded / verified / report emitted / gate green)
//   1  gate verdict red (--gate / --verify when a gate goes red) / report found unverified merges
//   2  usage / not a git repo / remote missing / branch missing / bad sha (fail-closed)
//
// ── DELIBERATE DIVERGENCES from the bash it replaces (both recorded in the task Evidence) ──────────
// ① NO HANG ON A TRAILING VALUE-FLAG. The bash's `case` loop did `shift 2` for `--gate`/`--root`/
//    `--remote`/`--branches`/`--machine`; when such a flag was the LAST argument, `shift 2` FAILED (n >
//    $#), the loop condition stayed true, and the script looped forever — measured: `timeout 5 bash
//    plugin/scripts/cross-machine-verify.sh --gate` → rc=124 (killed); same for `--root` and
//    `--machine`. An infinite loop is a defect, not a behavior to transport, so here a missing value is
//    the EMPTY STRING and the loop advances. Nothing else about argument handling changes; the
//    characterization test cannot pin the bash's case (a non-terminating input has no observable
//    output), which is why it is recorded here and in the Evidence instead of asserted.
// ② NO PYTHON3 DEPENDENCY. The five embedded `python3` invocations (JSON object scanning, ISO→epoch,
//    hours-between, the gate's file extraction, the report's JSON emission) are now native. The JSON
//    transforms are reproduced bit-for-bit, including Python's `json.dumps` separators (compact for the
//    note lines, `indent=2` for the report) and `repr(float)` (an integral float prints as `0.0`, never
//    `0`), because those strings are the contract the characterization test pins and the bytes the
//    cross-machine notes carry.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const MERGE_REF = "quay-cmv-merge";
const VERDICT_REF = "quay-cmv-verdict";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// Python-compatible value formatting
//
// These are NOT cosmetic. The bash emitted JSON produced by `json.dumps` and numbers produced by
// `repr(float)`, and those exact strings are what the characterization test pins and what the notes
// (the cross-machine carrier) store. A formatter that "looks right" but prints `0` where Python prints
// `0.0` would change the note bytes and the report the ## Contract is read from.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** A value that must be emitted as a JSON FLOAT. Python's `json.dumps` distinguishes `0` from `0.0`,
 *  and JS numbers do not — so a float-valued field carries this marker explicitly instead of relying on
 *  a "looks integral" heuristic, which would silently print `0` for a 0-hour latency. */
export class PyFloat {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
}

/** JSON string quoting, Python `ensure_ascii=True` flavour (control chars escaped, non-ASCII \uXXXX). */
export function pyStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 0x20 || c > 0x7e) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

/** `repr(float)` for the value ranges this script carries: an integral float prints as `0.0`, never `0`. */
export function pyFloat(x: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return `${x}.0`;
  const s = String(x);
  if (Math.abs(x) >= 1e-4 || /e/.test(s)) return s;
  // Python switches to exponent form below 1e-4 (e.g. 1e-05); JS does not until 1e-7.
  const [mant, expPart] = x.toExponential().split("e");
  const e = Number(expPart);
  return `${mant}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}

export function numOf(v: unknown): number {
  return v instanceof PyFloat ? v.value : typeof v === "number" ? v : Number.parseFloat(String(v));
}

/** Python `round(x, 2)`: nearest multiple of 0.01 to the DOUBLE's exact value, ties to even.
 *  Implemented on the double's exact dyadic decomposition — `x * 100` in floating point introduces its
 *  own rounding, and an exact half-way case is REACHABLE here (epoch-second differences make x a
 *  multiple of 1/3600, and 18/3600 = 0.005 sits exactly on the boundary). */
export function pyRound2(x: number): number {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0;
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  const m = expBits === 0 ? frac : frac | (1n << 52n);
  const e = expBits === 0 ? -1074 : expBits - 1075;
  if (m === 0n) return 0;
  // x * 100 = m * 2^e * 100 = (25 * m) * 2^(e + 2) — exact, because x*100 is a dyadic rational.
  const num = 25n * m;
  const sh = e + 2;
  let q: bigint;
  if (sh >= 0) {
    q = num << BigInt(sh);
  } else {
    const den = 1n << BigInt(-sh);
    const quo = num / den;
    const rem = num % den;
    const twice = rem * 2n;
    if (twice > den) q = quo + 1n;
    else if (twice < den) q = quo;
    else q = quo % 2n === 0n ? quo : quo + 1n; // exact tie ⇒ half to EVEN (Python's rule)
  }
  const r = Number(q) / 100;
  return neg ? -r : r;
}

function jsonScalar(v: unknown): string | null {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return pyStr(v);
  if (v instanceof PyFloat) return pyFloat(v.value);
  if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) < 1e16 ? String(v) : pyFloat(v);
  return null;
}

/** Python `json.dumps(v)` with the DEFAULT separators `(', ', ': ')`. */
export function pyJsonCompact(v: unknown): string {
  const scalar = jsonScalar(v);
  if (scalar !== null) return scalar;
  if (Array.isArray(v)) return "[" + v.map(pyJsonCompact).join(", ") + "]";
  return "{" + Object.entries(v as Record<string, unknown>).map(([k, x]) => `${pyStr(k)}: ${pyJsonCompact(x)}`).join(", ") + "}";
}

/** Python `json.dumps(v, indent=2, sort_keys=False)`. */
export function pyJsonIndent(v: unknown, indent = 2): string {
  const emit = (x: unknown, depth: number): string => {
    const scalar = jsonScalar(x);
    if (scalar !== null) return scalar;
    const pad = " ".repeat(indent * (depth + 1));
    const closePad = " ".repeat(indent * depth);
    if (Array.isArray(x)) {
      if (x.length === 0) return "[]";
      return "[\n" + x.map((e) => pad + emit(e, depth + 1)).join(",\n") + "\n" + closePad + "]";
    }
    const entries = Object.entries(x as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return "{\n" + entries.map(([k, e]) => `${pad}${pyStr(k)}: ${emit(e, depth + 1)}`).join(",\n") + "\n" + closePad + "}";
  };
  return emit(v, 0);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// the REPLACED python3 contracts — ported 1:1
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `parse_notes <msg>` — scan a note message for concatenated JSON objects, oldest first. The scan is
 * brace-depth based and NOT a split on `}{`: a verdict note is APPENDED to, so one note body can hold
 * several objects, and a naive split would corrupt any object carrying a brace inside a string. An
 * unparseable object is skipped and the scan continues past it — the bash returned exactly that (its
 * python caught the exception and carried on).
 */
export function parseNotes(text: string): unknown[] {
  const objs: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    const j = text.indexOf("{", i);
    if (j === -1) break;
    let depth = 0;
    let found = false;
    for (let k = j; k < text.length; k++) {
      if (text[k] === "{") depth++;
      else if (text[k] === "}") {
        depth--;
        if (depth === 0) {
          try {
            objs.push(JSON.parse(text.slice(j, k + 1)));
          } catch {
            /* an unparseable object is skipped, and the scan resumes AFTER it */
          }
          i = k + 1;
          found = true;
          break;
        }
      }
    }
    if (!found) i = j + 1;
  }
  return objs;
}

/** `epoch <iso>` — epoch SECONDS from an ISO-8601 timestamp; 0 when unparseable (the python printed 0
 *  on exception and the shell carried `|| echo 0`). */
export function epoch(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.trunc(t / 1000);
}

/** `hours_between <start> <end>` — decimal hours rounded to 2 places. */
export function hoursBetween(aIso: string, bIso: string): number {
  return pyRound2((epoch(bIso) - epoch(aIso)) / 3600.0);
}

/** One string field out of a parsed note object, or "" — the python's `.get(k, "")` with an exception
 *  fallback to "". */
function field(o: unknown, key: string): string {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    const v = (o as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return "";
}

/** `str(True)` / `str(False)` — capitalised, unlike JSON's lowercase. */
function pyBool(v: unknown): string {
  return v ? "True" : "False";
}
/** `str(None)` — the human report renders a JSON null as `None`, ⛔ not `null`. */
function pyNone(v: unknown): string {
  return v === null || v === undefined ? "None" : String(v);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const SELF = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SELF);
/** The public written-down entry name: this file's `.sh` twin.
 *  ⛔ `cross-machine-verify.sh` is what callers invoke (`periodic-push-backup.sh`, the loop docs), so
 *  the usage line names IT even when this file was run directly — the help describes the entry the
 *  reader is meant to use, not the interpreter invocation that happens to be running. */
const ENTRY_NAME = "cross-machine-verify.sh";

function usage(): never {
  process.stdout.write(
    `用法: bash ${ENTRY_NAME} [参数…] — 详见下方脚本头部用法注释（--help|-h 仅打印用法，无副作用，退出 0）\n`,
  );
  try {
    for (const l of fs.readFileSync(SELF, "utf8").split("\n").slice(0, 120)) {
      if (!l.startsWith("#")) continue;
      const stripped = l.replace(/^# ?/, "");
      if (stripped.startsWith("!")) continue;
      process.stdout.write(stripped + "\n");
    }
  } catch {
    /* the usage line above is already printed — a help that cannot read its own header still helps */
  }
  process.exit(0);
}

export interface Opts {
  mode: string;
  remote: string;
  branches: string;
  machine: string;
  json: boolean;
  noPush: boolean;
  gateCmd: string;
  repoRoot: string;
  mergeShas: string[];
}

export function parseArgv(argv: string[], defaultRoot: string): Opts {
  const o: Opts = {
    mode: "report",
    remote: "origin",
    branches: "develop integration",
    machine: os.hostname() || "unknown",
    json: false,
    noPush: false,
    gateCmd: "",
    repoRoot: defaultRoot,
    mergeShas: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // `--flag value` consumes the next token; a MISSING value is the EMPTY STRING and the loop still
    // advances. (The bash looped FOREVER here — see divergence ① in the header.)
    const next = (): string => (i + 1 < argv.length ? argv[++i] : "");
    if (a === "--record-merge") o.mode = "record-merge";
    else if (a === "--verify") o.mode = "verify";
    else if (a === "--report") o.mode = "report";
    else if (a === "--gate-run") o.mode = "gate";
    else if (a === "--gate") o.gateCmd = next();
    else if (a === "--root") o.repoRoot = next();
    else if (a === "--remote") o.remote = next();
    else if (a === "--branches" || a === "--branch") o.branches = next();
    else if (a === "--machine") o.machine = next();
    else if (a === "--no-push") o.noPush = true;
    else if (a === "--json") o.json = true;
    else if (a === "--help" || a === "-h") usage();
    else if (a.startsWith("-")) {
      process.stderr.write(`cross-machine-verify: unknown argument: ${a}\n`);
      process.exit(2);
    } else o.mergeShas.push(a);
  }
  return o;
}

/** The gate id the bash derived from a gate command: basename of its LAST script-like token, or
 *  `gate` when there is none. */
export function gateNameOf(cmd: string): string {
  let tok = "";
  for (const t of cmd.split(/\s+/)) if (/\.(sh|ts|mjs|tsx)$/.test(t)) tok = t;
  return tok ? path.basename(tok) : "gate";
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════════════════════════════
export function main(argv: string[], defaultRoot: string, out = process.stdout, err = process.stderr): number {
  const o = parseArgv(argv, defaultRoot);
  const root = o.repoRoot;
  const branchList = o.branches.split(/\s+/).filter((b) => b.length > 0);
  const write = (s: string): void => void out.write(s + "\n");

  if (o.remote === "") {
    err.write("cross-machine-verify: empty --remote\n");
    return 2;
  }
  if (o.branches === "") {
    err.write("cross-machine-verify: empty --branches\n");
    return 2;
  }

  // ── fail-closed preflight ─────────────────────────────────────────────────────────────────────────
  if (spawnSync("git", ["-C", root, "rev-parse", "--git-dir"], { stdio: "ignore" }).status !== 0) {
    err.write(`cross-machine-verify: not a git repo: ${root}\n`);
    return 2;
  }
  for (const b of branchList) {
    const r = spawnSync("git", ["-C", root, "show-ref", "--verify", "--quiet", `refs/heads/${b}`], { stdio: "ignore" });
    if ((r.status ?? 1) !== 0) {
      err.write(`cross-machine-verify: local branch not found: ${b}\n`);
      return 2;
    }
  }
  if (spawnSync("git", ["-C", root, "remote", "get-url", o.remote], { stdio: "ignore" }).status !== 0) {
    err.write(`cross-machine-verify: remote not found: ${o.remote}\n`);
    return 2;
  }

  // ── git plumbing ──────────────────────────────────────────────────────────────────────────────────
  // `git ... 2>/dev/null || true` — the value is "" on any failure, and a caller cannot tell a real
  // empty result from a failed read. That is the bash's behavior, reproduced deliberately: the notes
  // channel is best-effort by design (see HAZARD C3b in the characterization test — an unreachable
  // remote degrades to 「nothing to verify」, which this task PINS, does not fix).
  const gitQuiet = (args: string[]): string => {
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 120_000 });
    return (r.stdout ?? "").replace(/\n+$/, "");
  };
  const gitOk = (args: string[]): boolean =>
    spawnSync("git", ["-C", root, ...args], { stdio: "ignore", timeout: 120_000 }).status === 0;
  const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const commitIso = (sha: string): string => {
    const r = spawnSync("git", ["-C", root, "show", "-s", "--format=%cI", sha], { encoding: "utf8", timeout: 120_000 });
    const v = (r.stdout ?? "").replace(/\n+$/, "");
    return r.status === 0 && v !== "" ? v : nowIso();
  };
  const noteShow = (ref: string, sha: string): string => gitQuiet(["notes", `--ref=${ref}`, "show", sha]);
  const noteHas = (ref: string, sha: string): boolean =>
    gitQuiet(["notes", `--ref=${ref}`, "list"])
      .split("\n")
      .some((l) => l.endsWith(` ${sha}`));
  const noteAdd = (ref: string, msg: string, sha: string): void => void gitQuiet(["notes", `--ref=${ref}`, "add", "-m", msg, sha]);
  const noteAppend = (ref: string, msg: string, sha: string): void =>
    void gitQuiet(["notes", `--ref=${ref}`, "append", "-m", msg, sha]);
  // Both refs go in ONE push, exactly as the bash did — including the consequence that a push whose
  // second src refspec does not exist is aborted AS A WHOLE (characterization test C1h pins it).
  const fetchNotes = (): void =>
    void gitQuiet([
      "fetch",
      o.remote,
      `refs/notes/${MERGE_REF}:refs/notes/${MERGE_REF}`,
      `refs/notes/${VERDICT_REF}:refs/notes/${VERDICT_REF}`,
    ]);
  const pushNotes = (): void =>
    void gitQuiet([
      "push",
      o.remote,
      `refs/notes/${MERGE_REF}:refs/notes/${MERGE_REF}`,
      `refs/notes/${VERDICT_REF}:refs/notes/${VERDICT_REF}`,
    ]);

  // ── the fast gate ─────────────────────────────────────────────────────────────────────────────────
  interface GateResult {
    verdict: string;
    gate: string;
    files: string[];
    code: number;
  }
  /** Run the fast gate and return its verdict. ⛔ Prints nothing: the bash's `run_gate` wrote the JSON
   *  line to stdout unconditionally, and `--verify` CAPTURED it in a command substitution (so it never
   *  reached the terminal) while `--gate-run` let it through. Printing here and letting the caller
   *  decide is the same contract without depending on the caller's shell quoting. */
  const execGate = (): GateResult => {
    const cmd = o.gateCmd !== "" ? o.gateCmd : `bash ${SCRIPT_DIR}/laydown-set-check.sh --root ${root}`;
    const gate = gateNameOf(cmd);
    const r = spawnSync("bash", ["-c", cmd], { cwd: root, encoding: "utf8", timeout: 600_000 });
    const text = (r.stdout ?? "") + (r.stderr ?? "");
    // A gate killed by a signal has `status === null`; 128+SIGTERM is what a shell would report, and
    // any value outside {0,1} is the `error` verdict — ⛔ never silently `red`.
    const rc = r.status !== null ? r.status : 143;
    const verdict = rc === 0 ? "green" : rc === 1 ? "red" : "error";
    const files: string[] = [];
    for (const line of text.split("\n")) {
      const isFailureContext =
        line.includes("✖") ||
        line.includes("not ok") ||
        line.toUpperCase().includes("FAIL") ||
        line.toLowerCase().includes("error") ||
        /\bat\s+[^ ]+\.(?:mjs|js|ts|sh)/.test(line);
      if (!isFailureContext) continue;
      for (const m of line.matchAll(/plugin\/[A-Za-z0-9_./-]+\.(?:test\.mjs|mjs|js|ts|sh)/g)) {
        if (!files.includes(m[0])) files.push(m[0]);
      }
    }
    return { verdict, gate, files, code: verdict === "green" ? 0 : verdict === "red" ? 1 : 2 };
  };
  const gateLine = (g: GateResult): string =>
    `{"verdict":"${g.verdict}","gate":"${g.gate}","files":${pyJsonCompact(g.files)}}`;

  // ── branch detection / enumeration ────────────────────────────────────────────────────────────────
  const isAncestor = (ancestor: string, descendant: string): boolean =>
    spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", ancestor, descendant], { stdio: "ignore" }).status === 0;
  const detectBranch = (sha: string): string => {
    for (const b of branchList) if (isAncestor(sha, `refs/heads/${b}`)) return b;
    return branchList[0] ?? "";
  };
  const notedShas = (): string[] =>
    gitQuiet(["notes", `--ref=${MERGE_REF}`, "list"])
      .split("\n")
      .map((l) => l.split(/\s+/)[1])
      .filter((s) => !!s);

  /** Commits on the tracked branches carrying a merge note, oldest (by sha) first — `sort -k1`. */
  const enumerateRecordedMerges = (): Array<{ sha: string; branch: string }> => {
    if (!o.noPush) fetchNotes();
    const rows: Array<{ sha: string; branch: string }> = [];
    for (const sha of notedShas()) {
      for (const br of branchList) {
        if (isAncestor(sha, `refs/heads/${br}`)) {
          rows.push({ sha, branch: br });
          break;
        }
      }
    }
    rows.sort((x, y) => (x.sha < y.sha ? -1 : x.sha > y.sha ? 1 : 0));
    return rows;
  };

  /** Commits that landed after the mechanism started tracking (baseline = the recorded merge with the
   *  OLDEST merged_at) but carry NO merge note: their record event was missed, so they cannot be
   *  cross-machine verified (no merger identity to prove non-participation) → fail-closed, surfaced,
   *  ⛔ never silently assumed verified. Without a recorded merge the baseline is not established. */
  const unattributedCommits = (): Array<{ sha: string; branch: string }> => {
    const recorded = notedShas();
    if (recorded.length === 0) return [];
    let baseline = "";
    let baselineTs = "";
    for (const r of recorded) {
      const ts = commitIso(r);
      if (baselineTs === "" || epoch(ts) < epoch(baselineTs)) {
        baseline = r;
        baselineTs = ts;
      }
    }
    if (baseline === "") return [];
    const rows: Array<{ sha: string; branch: string }> = [];
    for (const br of branchList) {
      if (gitQuiet(["rev-parse", `refs/heads/${br}`]) === "") continue;
      for (const c of gitQuiet(["log", br, "--format=%H", "-n", "300"]).split("\n")) {
        if (c === "" || noteHas(MERGE_REF, c)) continue;
        if (isAncestor(baseline, c)) rows.push({ sha: c.slice(0, 12), branch: br });
      }
    }
    return rows;
  };

  /** One recorded merge with its verdict state. `text` is the emitted JSON line and `obj` the same
   *  data — the bash carried merge rows as LINES through `report_merges` and re-parsed them for the
   *  `--json` half, so both consumers read the same shape here too. */
  const mergeStatus = (sha: string, br: string): { obj: Record<string, unknown>; text: string } => {
    const mergeNote = parseNotes(noteShow(MERGE_REF, sha)).pop();
    const merger = field(mergeNote, "merger_machine") || "unknown";
    let mergedAt = field(mergeNote, "at");
    if (mergedAt === "") mergedAt = commitIso(sha);

    const vline = parseNotes(noteShow(VERDICT_REF, sha)).pop();
    let verified = false;
    let verdict: string | null = null;
    let verifier: string | null = null;
    let verdictAt: string | null = null;
    let vlat = 0;
    if (vline !== undefined) {
      const vv = field(vline, "verdict");
      const vvm = field(vline, "verifier_machine");
      const vat = field(vline, "at");
      // A verdict counts ONLY when the verifier is not the merger (the AC4 structural requirement).
      if (vvm !== "" && vvm !== merger) {
        verified = true;
        verdict = vv === "null" ? null : vv; // the bash's `s()` sentinel
        verifier = vvm;
        verdictAt = vat;
        vlat = hoursBetween(mergedAt, vat);
      }
    }
    const waitH = verified ? vlat : hoursBetween(mergedAt, nowIso());
    const obj: Record<string, unknown> = {
      sha,
      branch: br,
      merger_machine: merger,
      merged_at: mergedAt,
      verified,
      verdict,
      verifier_machine: verifier,
      verdict_at: verdictAt,
      wait_h: new PyFloat(waitH),
      post_merge_latency_h: new PyFloat(waitH),
    };
    return { obj, text: pyJsonCompact(obj) };
  };

  // ── MODE: record-merge (event-driven, the merging machine) ────────────────────────────────────────
  const modeRecordMerge = (): number => {
    if (o.mergeShas.length === 0) {
      err.write("cross-machine-verify: --record-merge requires at least one <sha> (the merges this machine just landed)\n");
      return 2;
    }
    if (!o.noPush) fetchNotes();
    const now = nowIso();
    let recorded = 0;
    let skipped = 0;
    let missing = 0;
    for (const sha of o.mergeShas) {
      if (!gitOk(["cat-file", "-e", `${sha}^{commit}`])) {
        err.write(`cross-machine-verify: not a commit: ${sha}\n`);
        missing++;
        continue;
      }
      if (noteHas(MERGE_REF, sha)) {
        skipped++;
        continue;
      }
      const br = detectBranch(sha);
      const ctime = commitIso(sha);
      noteAdd(
        MERGE_REF,
        `{"type":"merge","sha":"${sha}","branch":"${br}","merger_machine":"${o.machine}","at":"${ctime}","recorded_at":"${now}"}`,
        sha,
      );
      write(`recorded merge: ${sha.slice(0, 12)} branch=${br} merger_machine=${o.machine} at=${ctime}`);
      recorded++;
    }
    if (!o.noPush) pushNotes();
    write(`cross-machine-verify: record-merge done (recorded ${recorded} / skipped ${skipped} / missing ${missing})`);
    return 0;
  };

  // ── MODE: verify (heartbeat / event-driven — a NON-participating machine runs the fast gate) ──────
  const modeVerify = (): number => {
    let verified = 0;
    let skippedParticipant = 0;
    let skippedUnattributed = 0;
    let skippedDone = 0;
    let reds = 0;
    let errors = 0;
    for (const { sha, branch: br } of enumerateRecordedMerges()) {
      const mergeNoteText = noteShow(MERGE_REF, sha);
      const merger = field(parseNotes(mergeNoteText).pop(), "merger_machine") || "unknown";
      if (merger === "unknown") {
        write(`verify: skip ${sha.slice(0, 12)} — unattributed merge (no merger identity); fail-closed, NOT verified`);
        skippedUnattributed++;
        continue;
      }
      if (merger === o.machine) {
        write(`verify: skip ${sha.slice(0, 12)} — this machine (${o.machine}) IS the merger; a parent cannot verify its own merge (AC4)`);
        skippedParticipant++;
        continue;
      }
      // Already verified by SOMEONE OTHER THAN THE MERGER? (the bash compared against `merger`, ⛔ not
      // against this machine — reproduced: a verdict written by the merger does not count as done.)
      const already = parseNotes(noteShow(VERDICT_REF, sha)).some((v) => {
        const vm = field(v, "verifier_machine");
        return vm !== "" && vm !== merger;
      });
      if (already) {
        skippedDone++;
        continue;
      }
      const now = nowIso();
      write(`verify: verifying ${sha.slice(0, 12)} (merger=${merger}, verifier=${o.machine}) — running fast gate...`);
      const g = execGate();
      let mergedAt = field(parseNotes(mergeNoteText).pop(), "at");
      if (mergedAt === "") mergedAt = commitIso(sha);
      noteAppend(
        VERDICT_REF,
        `{"type":"verdict","verifier_machine":"${o.machine}","at":"${now}","verdict":"${g.verdict}","gate":"${g.gate}","files":${pyJsonCompact(g.files)}}`,
        sha,
      );
      const lat = hoursBetween(mergedAt, now);
      if (g.verdict === "red") {
        reds++;
        write(`verify: ${sha.slice(0, 12)} verdict=RED post_merge_latency_h=${lat} files=${pyJsonCompact(g.files)} — DETECTED by cross-machine gate`);
      } else if (g.verdict === "green") {
        verified++;
        write(`verify: ${sha.slice(0, 12)} verdict=green post_merge_latency_h=${lat}`);
      } else {
        errors++;
        write(`verify: ${sha.slice(0, 12)} gate error — verdict not recorded (verdict=error)`);
      }
    }
    // Unattributed merges (landed but never recorded — the event-driven record was missed): cannot be
    // verified (no merger identity) → fail-closed, counted, NOT verified.
    for (const { sha, branch: br } of unattributedCommits()) {
      write(`verify: skip ${sha} ${br} — unattributed merge (no merger identity); fail-closed, NOT verified`);
      skippedUnattributed++;
    }
    if (!o.noPush) pushNotes();
    write(
      `cross-machine-verify: verify done (green ${verified} / red ${reds} / gate-error ${errors} / skipped-participant ${skippedParticipant} / skipped-unattributed ${skippedUnattributed} / already-verified ${skippedDone})`,
    );
    return reds === 0 ? 0 : 1;
  };

  // ── MODE: report (default — the ## Contract measure surface) ──────────────────────────────────────
  const modeReport = (): number => {
    const rows: Array<{ sha: string; obj: Record<string, unknown>; text: string }> = [];
    let nUnverified = 0;
    let nVerified = 0;
    let newestPending = "";
    let newestPendingWait = "0";
    for (const { sha, branch: br } of enumerateRecordedMerges()) {
      const st = mergeStatus(sha, br);
      rows.push({ sha, obj: st.obj, text: st.text });
      if (st.obj.verified === true) {
        nVerified++;
      } else {
        nUnverified++;
        const w = pyFloat(st.obj.wait_h instanceof PyFloat ? st.obj.wait_h.value : Number(st.obj.wait_h));
        if (Number.parseFloat(w) > Number.parseFloat(newestPendingWait)) {
          newestPending = sha;
          newestPendingWait = w;
        }
        if (newestPending === "") {
          newestPending = sha;
          newestPendingWait = w;
        }
      }
    }

    // The ## Contract's target merge is the one the invariant cares most about: the OLDEST unverified
    // merge (largest wait — its wait IS the current detection latency d). verifier_machine is the
    // machine that ACTUALLY gave the verdict, so verifier_is_participant mechanically proves the AC4
    // structural requirement once verified.
    let top: Record<string, unknown> | null = null;
    if (newestPending !== "") {
      top = mergeStatus(newestPending, branchList[0] ?? "").obj;
    } else {
      const last = rows[rows.length - 1];
      if (last && last.obj.verified === true) top = last.obj;
    }
    let topMerger = "null";
    let topVerifier = "null";
    let topLat = "0";
    if (top) {
      topMerger = pyJsonCompact(top.merger_machine);
      topVerifier = top.verifier_machine ? pyJsonCompact(top.verifier_machine) : "null";
      topLat = pyFloat(numOf(top.post_merge_latency_h));
    }
    let verifierIsParticipant = 0;
    if (topVerifier !== "null" && topMerger !== "null") {
      if (topMerger.replace(/"/g, "") === topVerifier.replace(/"/g, "")) verifierIsParticipant = 1;
    }
    let postLat = topLat || "0";
    if (newestPending !== "") postLat = newestPendingWait;

    const unattr = unattributedCommits();
    const unattrCount = unattr.length;

    if (o.json) {
      const doc = {
        verifier_machine: topVerifier === "null" ? null : JSON.parse(topVerifier),
        merger_machine: topMerger === "null" ? null : JSON.parse(topMerger),
        verifier_is_participant: verifierIsParticipant,
        post_merge_latency_h: new PyFloat(Number.parseFloat(postLat)),
        unverified_merges: nUnverified,
        verified_merges: nVerified,
        unattributed_commits: unattrCount,
        merges: rows.map((r) => r.obj),
        notes_refs: [`refs/notes/${MERGE_REF}`, `refs/notes/${VERDICT_REF}`],
        machine: o.machine,
      };
      out.write(pyJsonIndent(doc) + "\n");
    } else {
      write(`cross-machine-verify: report (machine=${o.machine})`);
      write(`  verifier_machine: ${topVerifier.replace(/"/g, "")}`);
      write(`  merger_machine: ${topMerger.replace(/"/g, "")}`);
      write(`  verifier_is_participant: ${verifierIsParticipant}  (band 0)`);
      write(`  post_merge_latency_h: ${postLat}  (band 0..1)`);
      write(`  unverified_merges: ${nUnverified} / verified_merges: ${nVerified} / unattributed_commits: ${unattrCount}`);
      if (nUnverified > 0 || unattrCount > 0) {
        write("  UNVERIFIED — the detection latency d for each pending merge is its wait_h (this is the failure surface):");
      } else {
        write("  all recorded merges cross-machine verified");
      }
      for (const r of rows) {
        const a = r.obj;
        write(
          `  ${String(a.sha).slice(0, 12)} ${a.branch} merger=${a.merger_machine} verified=${pyBool(a.verified)} verdict=${pyNone(a.verdict)} verifier=${pyNone(a.verifier_machine)} wait_h=${pyFloat(numOf(a.wait_h))}`,
        );
      }
      if (unattrCount > 0) {
        write("  unattributed commits (landed but NOT recorded by a merger — cannot prove non-participation, NOT verified):");
        for (const { sha, branch: br } of unattr) write(`    ${sha} ${br}`);
      }
    }
    return nUnverified === 0 && unattrCount === 0 ? 0 : 1;
  };

  // ── dispatch ──────────────────────────────────────────────────────────────────────────────────────
  switch (o.mode) {
    case "record-merge":
      return modeRecordMerge();
    case "verify":
      return modeVerify();
    case "gate": {
      const g = execGate();
      out.write(gateLine(g) + "\n");
      return g.code;
    }
    case "report":
      return modeReport();
    default:
      err.write(`cross-machine-verify: unknown mode ${o.mode}\n`);
      return 2;
  }
}

// ── entry guard: run only when executed, never when imported by a test ────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  process.exit(main(process.argv.slice(2), path.resolve(SCRIPT_DIR, "..", "..")));
}
