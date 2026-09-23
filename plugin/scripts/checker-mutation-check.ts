#!/usr/bin/env node
// checker-mutation-check.ts — mutation-test the CHECKERS themselves (the L_S instrument,
// tasks/gap-checkers-have-never-been-shown-to-fail, spec AC1 priority).
//
// (tasks/gap-arch-tsify-checker-mutation-check-sh — SPEC-architecture-consolidation §5 Phase 5.2:
//  this file is the former plugin/scripts/checker-mutation-check.sh, whose 490 code lines are now ONE
//  program instead of a bash program with awk/grep/sed inside it. The `.sh` beside it is a thin entry
//  that execs this file, because `checker-mutation-check.sh` is a WRITTEN-DOWN interface:
//  runner-static-gate.ts invokes it twice by that exact path (the full-tier `--check` registration and
//  the change-tier `--check-changed` companion), the capability catalog declares it by that basename,
//  and the mutation case for this script itself (checker-mutation-cases/checker-mutation-check.sh)
//  invokes it by that path. Behavior is pinned by
//  plugin/test/checker-mutation-check-characterization.test.mjs, committed BEFORE this rewrite.)
//
// NOT a mutation test of product code. The object being mutated is the guard: for every
// registered checker we deliberately break what it claims to check and assert the checker
// goes RED; restore; assert GREEN. A checker that never goes red under a defect it claims
// to catch is indistinguishable from a checker that always returns "pass" — exactly the
// #6 instance (rename negative control whose zero-dependency probe could not fail) and
// #10 instance (/live acceptance that only tested the data-missing direction) that are
// the day's real failures this task exists to make impossible.
//
// THE MANIFEST IS NEVER HAND-WRITTEN (AC1b). Registered checkers are parsed out of
// runner-static-gate.ts's run_static_checks / run_operational_checks functions, scripts/test.sh's
// run_doc_checks function, and the CI workflows (.github/workflows/*.yml):
//   - run_static_checks / run_operational_checks / run_doc_checks: every invocation of
//     `plugin/scripts/<name>.(sh|ts)` inside that function body
//   - CI: every `node --experimental-strip-types scripts/<name>.ts` gate step
// A checker added to either surface appears in the manifest automatically; if it has no
// mutation case in plugin/scripts/checker-mutation-cases/ it is reported UNCOVERED and the
// --check gate fails — a new checker with no mutation case can never silently slip through.
//
// THE MECHANISM MUTATES ITSELF TOO (AC1c/AC4): `--selftest` breaks each of the mechanism's
// own core behaviors (parser returns nothing / case loop skipped / RED inverted) and asserts
// the gate FAILS. A mutation-testing harness that cannot fail when broken is the exact thing
// it exists to catch.
//
// Usage:
//   checker-mutation-check.sh --list               # text manifest (names + coverage + totals)
//   checker-mutation-check.sh --list --json        # machine-readable manifest
//   checker-mutation-check.sh --run [--json]       # run every mutation case + the AC5 regressions
//   checker-mutation-check.sh --check              # fail-closed gate (wired into run_static_checks)
//   checker-mutation-check.sh --selftest           # meta-mutation self-check (AC4)
//   checker-mutation-check.sh --repo-root <dir>    # parse THIS root's test.sh/workflows (tests only)
//   checker-mutation-check.sh --meta-inject <mode> # test-only breakage: empty-manifest|skip-cases|invert-red
//   checker-mutation-check.sh --check --only <csv> # run ONLY the named checkers' cases (narrowed cost)
//   checker-mutation-check.sh --check-changed      # change-tier companion: run the cases of only the
//                                                  # checkers THIS delta touches (see below)
//
// Case-script contract (plugin/scripts/checker-mutation-cases/<name>.sh):
//   bash <case>.sh <workdir>
//   Exit 0 = mutation behaved (baseline GREEN → inject → RED → restore → GREEN all proven)
//   Exit 3 = STAYED-GREEN (defect present, checker still exited 0) → counts as mutations_that_stayed_green
//   Exit 4 = ALWAYS-RED (restored object, checker still exited non-zero)
//   Exit 2 = infrastructure error (case could not run)
//
// Exit codes: 0 = all mutation cases behaved; 1 = violations found (stayed-green / always-red /
// uncovered checker / empty manifest); 2 = usage/environment error — INCLUDING a case file that
// could not be EVALUATED at all (missing / empty / not parseable as shell), which is reported as
// `not-evaluated` and is NEVER folded into "pass" (hard rule 3b, see below).
//
// ── NOT-EVALUATED: "cannot read the input" is its own value (硬规则 3b) ──────────────────────────
// A case file that cannot be RUN TO A VERDICT (missing, empty after stripping comments, or rejected
// by `bash -n`) is classified `not-evaluated` — not `pass`, and not the `error` bucket. Before this
// the only reachable values were the case's own exit codes, so a case file structurally incapable of
// reporting a verdict produced the same shape as one that reported "behaved" (or, for a file that
// cannot even be parsed, a bare exit-2 that reads as an ordinary infra error). The JSON carries
// `evaluated:false` plus `not_evaluated:[names]`, the plain report prints the names under a
// `not_evaluated:` line, and the process exits 2 — never 0. ⛔ DIVERGENCE (recorded in the task
// Evidence with both outputs side by side): the old bash classified the same malformed input as
// `error` (the file exits 2 when `bash` fails to parse it) and exited 1; the verdict vocabulary here
// is one value wider so the unreadable state can never be mistaken for a verdict.
//
// ── --check-changed: the CHANGE-TIER COMPANION (gap-checker-mutation-check-has-no-change-tier-companion) ──
// The full-tier registration above is the whole-store兜底: it mutation-tests ALL registered checkers
// in one ~19s-median (55.6s median over the last 7 recorded) pass, and it is DEFERRED out of scoped
// runs — so the cost of a stale mutation case falls on an UNRELATED task's fan-in, but the task that
// actually edited the checker never pays. Measured (`.quay/verification-round.jsonl`,
// `STATIC_CHECK_FAILED: checker-mutation-check`): 8 fan-in静态闸 failures, last 2026-09-13T04:41:32Z.
// This mode is the既定解法 this repo already used for the same defect class
// (`quay-init-closure-ratchet-stale`, gap-quay-init-closure-ratchet-manual-reanchor-recurs: its
// companion drove that checker's fan-in reds 35 → 0 after 2026-09-06): narrow the judgment to THIS
// delta so it fires at the CHANGER's own scoped gate, while the full-tier check stays byte-unchanged
// as the whole-store兜底 (delay ≠ drop, same design as gap-scoped-runs-pay-full-static-check-overhead).
//
// Judgment domain = the checkers THIS delta touches, derived from git (NOT the whole manifest):
//   base = first resolvable of develop / origin/develop / master / origin/master
//   delta = `git diff --name-only base...HEAD` ∪ `git diff --name-only HEAD` ∪ untracked
//   carriers = delta paths that name a REGISTERED checker, either
//              `plugin/scripts/<name>.{sh,ts}` or `plugin/scripts/checker-mutation-cases/<name>.sh`
//              (the mutation case IS a checker carrier: editing it changes what the checker is
//              proven to catch). Plus: if the MANIFEST SOURCE itself changed
//              (`plugin/scripts/runner-static-gate.ts` / `scripts/test.sh` / `.github/workflows/*.yml`)
//              the registered SET may have grown ⇒ the whole-manifest覆盖度 (uncovered) dimension is
//              re-verified here too — cheap, `--list`-based, no case execution.
//   exit 0 = every touched checker's case behaved (and, when the manifest source moved, uncovered=0)
//   exit 1 = a touched checker's case stayed-green / always-red / errored, OR a registered checker
//            has no mutation case after a manifest-source change
//
// NOT-EVALUATED is reported as an explicit `NOT-EVALUATED` LINE with exit 0, NOT as exit 2 — a
// deliberate deviation from this script's own exit-2 convention: the SCOPED runner
// (`scripts/test.sh:run_scoped_static_checks_sel`) evaluates each selected checker command with a raw
// `eval` under `set -euo pipefail`, so any non-zero — including 2 — ABORTS an innocent task's scoped
// run. A delta whose Touches name a checker but whose actual git delta does not contain it (Touches
// ⊋ delta is normal) must not abort; it must say so. Same scoped-safe convention as
// `suite-bucket-drift-check` ("缓存缺失 ⇒ NOT-EVALUATED (exit 0 但可区分输出, 硬规则 3b)"). The
// output vocabulary stays three-valued (PASS / RED / NOT-EVALUATED), so hard rule 3b holds: the
// not-evaluated state is visible and never同形于 pass.
//
// ── DELIBERATE DIVERGENCES from the bash it replaces ────────────────────────────────────────────
// ① the case-file precondition above (`not-evaluated`) — the only verdict-vocabulary addition.
// ② The bounded-parallel case pool is a real async pool here (the bash backgrounded subshells and
//    brought exit codes back through a results FILE). Same pool cap (CHECKER_MUTATION_PARALLEL →
//    STATIC_CHECK_CONCURRENCY → the host's processor count, never a literal), same semantics; a case
//    killed by a signal is still an `error`, never a pass (the bash's missing-results-entry rule).
// ③ `--help` prints the tool_help-shaped banner plus THIS file's header comments (the header is the
//    usage 正本); the bash printed the `.sh`'s first 120 comment lines. The exit code and the
//    "usage text lives in the header" contract are unchanged; no test pins the body.
// ④ Manifest parsing, sorting and all string assembly are native: awk/grep/sed/sort are gone from
//    the hot path. Outputs stay byte-for-byte identical on `--list` / `--list --json` and
//    per-case verdicts + exit codes stay identical on `--run`, verified by
//    plugin/test/checker-mutation-check-characterization.test.mjs (old bash vs this file,逐用例).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { helpExit, isDirectEntry } from "./gate-script-base.ts";
// The registry's location has ONE owner (select-static-checks-for-touches.ts's REGISTRY_REL_CANDIDATES,
// derived from REGISTRY_BASENAME). Read it, ⛔ never re-spell the literal here (hard rule 5b).
import { REGISTRY_REL_CANDIDATES } from "./select-static-checks-for-touches.ts";

// ── locations ──────────────────────────────────────────────────────────────────────────────────────

export function defaultRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** The paths `--repo-root` re-derives (the bash re-assigned all four on that flag). */
export interface Ctx {
  root: string;
  casesDir: string;
  testSh: string;
  staticGate: string;
  workflowsDir: string;
}

export function makeCtx(root: string): Ctx {
  const abs = path.resolve(root);
  return {
    root: abs,
    casesDir: path.join(abs, "plugin", "scripts", "checker-mutation-cases"),
    testSh: path.join(abs, "scripts", "test.sh"),
    staticGate: path.join(abs, REGISTRY_REL_CANDIDATES[0]),  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
    workflowsDir: path.join(abs, ".github", "workflows"),
  };
}

/** The two AC5 regression cases: part of the mechanism's whole-store self-check, never of a per-delta run. */
export const REGRESSION_CASES = [
  "regression-rename-negative-control-probe",
  "regression-live-telemetry-empty-activity",
];

export type CaseResult = "pass" | "stayed-green" | "always-red" | "error" | "not-evaluated";

// ── manifest parsing (AC1: run_static_checks + run_operational_checks + run_doc_checks + CI, never hand-written) ──

/** Extract the body of a `name() { … }` function: from the `name() {` line to its own closing `}`.
 *  Byte-equivalent to the awk the bash used (`/^fn\(\)/{f=1;next} f && /^}/{f=0} f`), including the
 *  detail that the closing `}` line is consumed but never emitted. */
export function functionBody(src: string, fnName: string): string {
  const open = new RegExp(`^${fnName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\(\\)`);
  const out: string[] = [];
  let inFn = false;
  for (const line of src.split("\n")) {
    if (open.test(line)) {
      inFn = true;
      continue;
    }
    if (inFn && /^\}/.test(line)) {
      inFn = false;
      continue;
    }
    if (inFn) out.push(line);
  }
  return out.join("\n");
}

function readText(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Byte-order sort, deduped — the `sort -u` of the bash pipeline (verified against the live tree:
 *  the environment's `sort` order equals byte order for this name set). */
function sortUnique(names: Iterable<string>): string[] {
  return [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Parse the run_static_checks()/run_operational_checks() bodies (runner-static-gate.ts) and the
 *  run_doc_checks() body (scripts/test.sh) for `plugin/scripts/<name>.(sh|ts)`.
 *  The doc-class checkers MOVED to run_doc_checks under AC51 and the OPERATIONAL-class ones to
 *  run_operational_checks under the 2026-09-02 passive-machine ruling — BOTH families' mutation
 *  cases MUST stay in this manifest (the L_S instrument is not weakened by either split). */
export function listRunStaticChecksCheckers(ctx: Ctx): string[] {
  const parts: string[] = [];
  const gate = readText(ctx.staticGate);
  if (gate !== null) {
    parts.push(functionBody(gate, "run_static_checks"));
    parts.push(functionBody(gate, "run_operational_checks"));
  }
  const testSh = readText(ctx.testSh);
  if (testSh !== null) parts.push(functionBody(testSh, "run_doc_checks"));

  const names: string[] = [];
  for (const part of parts) {
    const re = /\$\{repo_root\}\/plugin\/scripts\/([A-Za-z0-9_.-]+)\.(?:sh|ts)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(part)) !== null) names.push(m[1]);
  }
  return sortUnique(names);
}

/** CI workflow run: steps for `node [--flags] scripts/<name>.ts` gates. */
export function listCiCheckers(ctx: Ctx): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(ctx.workflowsDir).filter((f) => f.endsWith(".yml"));
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const f of entries.sort()) {
    const text = readText(path.join(ctx.workflowsDir, f));
    if (text === null) continue;
    const re = /node (?:--[a-z-]+ )*scripts\/([A-Za-z0-9_.-]+)\.ts/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) names.push(m[1]);
  }
  return sortUnique(names);
}

export interface Manifest {
  checkers: string[];
  runStatic: Set<string>;
  ci: Set<string>;
}

/** The full registered manifest: union of both sources, deduped — parsed ONCE per invocation
 *  (the bash re-parsed on every call; identical output, since the sources cannot change mid-run). */
export function buildManifest(ctx: Ctx): Manifest {
  const runStatic = listRunStaticChecksCheckers(ctx);
  const ci = listCiCheckers(ctx);
  return { checkers: sortUnique([...runStatic, ...ci]), runStatic: new Set(runStatic), ci: new Set(ci) };
}

/** source of a checker: run_static_checks / ci / both. */
export function sourceOf(m: Manifest, name: string): string {
  let src = "";
  if (m.runStatic.has(name)) src = "run_static_checks";
  if (m.ci.has(name)) src = src ? `${src}+ci` : "ci";
  return src || "unknown";
}

export function hasCase(ctx: Ctx, name: string): boolean {
  return fs.existsSync(path.join(ctx.casesDir, `${name}.sh`));
}

/** `covered_count` — registered checkers that carry a mutation case. ⛔ Independent of a run's
 *  `uncovered` list, which ALSO collects the two missing regression cases (they are part of the
 *  mechanism's self-check, not of the registered manifest): deriving covered from the run's list
 *  reports a negative checker count on a root whose cases directory is empty. */
export function coveredCount(ctx: Ctx, m: Manifest): number {
  return m.checkers.filter((n) => hasCase(ctx, n)).length;
}

// ── --list ─────────────────────────────────────────────────────────────────────────────────────────

/** `printf '%-40s'` — left-justified to width, wider values untouched. */
function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

export function listPlain(ctx: Ctx, m: Manifest): string {
  const lines: string[] = [];
  const uncovered = m.checkers.filter((n) => !hasCase(ctx, n));
  const covered = m.checkers.length - uncovered.length;
  lines.push(
    `checkers_total: ${m.checkers.length} (parsed from run_static_checks + run_operational_checks + run_doc_checks + CI, never hand-written)`,
  );
  lines.push(`checkers_with_mutation: ${covered}`);
  if (covered === m.checkers.length) lines.push("uncovered: none");
  else lines.push(`uncovered: ${uncovered.map((n) => `${n} `).join("")}`);
  lines.push("");
  lines.push(`${pad("checker", 40)} ${pad("covered", 8)} source`);
  for (const name of m.checkers) {
    lines.push(`${pad(name, 40)} ${pad(hasCase(ctx, name) ? "yes" : "NO", 8)} ${sourceOf(m, name)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function listJson(ctx: Ctx, m: Manifest): string {
  const uncovered = m.checkers.filter((n) => !hasCase(ctx, n));
  const covered = m.checkers.length - uncovered.length;
  const checkers = m.checkers
    .map((n) => `{"name":"${n}","source":"${sourceOf(m, n)}","covered":${hasCase(ctx, n) ? "true" : "false"}}`)
    .join(",");
  return (
    `{"checkers_total":${m.checkers.length},"checkers_with_mutation":${covered},` +
    `"uncovered":[${uncovered.map((n) => `"${n}"`).join(", ")}],` +
    `"checkers":[${checkers}]}\n`
  );
}

// ── running mutation cases ─────────────────────────────────────────────────────────────────────────

/** Host-derived pool size — NEVER a literal: a number that merely happens to equal "no limit" on
 *  today's host is a real cap on the next one, silently (hard rule 4 推论二). A non-numeric / zero
 *  value degrades to the HOST READ, never to "no throttle". */
export function resolvePoolMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CHECKER_MUTATION_PARALLEL ?? env.STATIC_CHECK_CONCURRENCY ?? "";
  const max = /^[0-9]+$/.test(raw)
    ? raw
    : String(os.availableParallelism ? os.availableParallelism() : os.cpus().length || 4);
  return Number(max) >= 1 ? Number(max) : 1;
}

/** Run a case file: `bash <case>.sh <workdir>`, stdout+stderr captured (the bash teed them to a log
 *  and `cat`-ed it in plain mode). */
function runCaseFile(
  casePath: string,
  workdir: string,
): Promise<{ status: number | null; signal: NodeJS.Signals | null; output: string }> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn("bash", [casePath, workdir], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    child.on("error", () => resolve({ status: null, signal: null, output: out }));
    child.on("close", (status, signal) => resolve({ status, signal, output: out }));
  });
}

/** The case-file PRECONDITION (硬规则 3b): can this file be evaluated at all?
 *  null = it can; otherwise the reason it cannot. `bash -n` is a pure syntax parse — it runs no part
 *  of the case. */
export function casePrecondition(casePath: string): string | null {
  let src: string;
  try {
    src = fs.readFileSync(casePath, "utf8");
  } catch (err) {
    return `case file unreadable (${(err as Error).message.split("\n")[0]})`;
  }
  const codeLines = src.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
  if (codeLines.length === 0) {
    return "case file carries no code (empty or comment-only): nothing in it could report a verdict";
  }
  const r = spawnSync("bash", ["-n", casePath], { encoding: "utf8" });
  if (r.status !== 0) {
    const why = ((r.stderr ?? "").trim().split("\n").pop() ?? "").trim();
    return `bash -n rejected the case file (syntax error)${why ? `: ${why}` : ""}`;
  }
  return null;
}

export interface RunOutcome {
  /** case name → verdict. */
  results: Map<string, CaseResult>;
  stayedGreen: string[];
  alwaysRed: string[];
  errorNames: string[];
  notEvaluated: string[];
  /** names of the checker set that carry no mutation case. */
  uncovered: string[];
  /** reasons for the not-evaluated cases, in discovery order. */
  notEvaluatedReasons: Map<string, string>;
  regressionGreen: number;
  executed: string[];
  durationMs: number;
  overall: number;
}

export interface RunOptions {
  json: boolean;
  onlyCsv: string;
  metaInject: string;
  /** injectable clock, for the characterization harness. */
  now?: () => number;
}

export interface RunSink {
  /** case output as it completes (plain mode only). */
  caseOutput(text: string): void;
  /** the `MUTATION <name>: <verdict>` line (plain mode only). */
  verdict(name: string, res: CaseResult): void;
}

const NULL_SINK: RunSink = { caseOutput: () => {}, verdict: () => {} };

export async function runCases(
  ctx: Ctx,
  m: Manifest,
  opts: RunOptions,
  sink: RunSink = NULL_SINK,
): Promise<RunOutcome> {
  const json = opts.json;
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const out: RunOutcome = {
    results: new Map(),
    stayedGreen: [],
    alwaysRed: [],
    errorNames: [],
    notEvaluated: [],
    uncovered: [],
    notEvaluatedReasons: new Map(),
    regressionGreen: 0,
    executed: [],
    durationMs: 0,
    overall: 0,
  };

  // --only: restrict the run to the named registered checkers. An unregistered name is a usage
  // error (exit 2), never a silent no-op — a narrowed run that silently ran nothing would be
  // indistinguishable from a green one (hard rule 3b).
  let checkers: string[];
  const onlyCsv = opts.onlyCsv;
  if (onlyCsv !== "") {
    checkers = [];
    for (const rawName of onlyCsv.split(",")) {
      const on = rawName.replace(/[ \t]/g, "");
      if (on === "") continue;
      if (!m.checkers.includes(on)) {
        process.stderr.write(`checker-mutation-check: ERROR — --only names an unregistered checker: ${on}\n`);
        out.overall = 2;
        return out;
      }
      if (!checkers.includes(on)) checkers.push(on);
    }
    if (checkers.length === 0) {
      process.stderr.write(`checker-mutation-check: ERROR — --only carried no checker name ('${onlyCsv}')\n`);
      out.overall = 2;
      return out;
    }
  } else {
    checkers = [...m.checkers];
  }

  const caseList: string[] = [];
  for (const name of checkers) {
    if (hasCase(ctx, name)) caseList.push(name);
    else out.uncovered.push(name);
  }
  // The two AC5 regression cases are part of the mechanism's WHOLE-STORE self-check, not of a
  // per-delta judgment — in --only mode they are out of scope by construction (the full-tier
  // registration still runs them every round).
  if (onlyCsv === "") {
    for (const reg of REGRESSION_CASES) {
      if (hasCase(ctx, reg)) caseList.push(reg);
      else out.uncovered.push(reg);
    }
  }
  // Any --meta-inject short-circuits the case loop: the injection IS the broken state being
  // demonstrated (parser empty / loop skipped / detection inverted), so the gate must fail without
  // paying the cost of a real run. The per-case behavior is tested by the plain run.
  const effectiveCases = opts.metaInject !== "" ? [] : caseList;
  out.executed = [...effectiveCases];

  const poolMax = resolvePoolMax();
  const pending = new Set<Promise<void>>();
  const channels = new Map<string, string>();
  for (const name of effectiveCases) {
    while (pending.size >= poolMax) await Promise.race(pending);
    const task = (async () => {
      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "cmc-case-"));
      try {
        const casePath = path.join(ctx.casesDir, `${name}.sh`);
        const precondition = casePrecondition(casePath);
        if (precondition !== null) {
          channels.set(name, `#not-evaluated:${precondition}`);
          return;
        }
        const r = await runCaseFile(casePath, workdir);
        if (!json) sink.caseOutput(r.output);
        if (r.status === null) {
          // Killed before reporting, or the launcher never started: an ERROR, never a pass
          // (硬规则 3b — "读不懂输入" must not share the output shape of "合格").
          channels.set(name, `#error:${r.signal ? `case killed by signal ${r.signal}` : "case process failed to launch"}`);
          return;
        }
        channels.set(name, `#exit:${r.status}`);
      } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
      }
    })();
    const tracked = task.finally(() => pending.delete(tracked));
    pending.add(tracked);
  }
  // Reap EVERY case before reading the channel — after this line every channel value is complete.
  await Promise.all(pending);

  for (const name of effectiveCases) {
    const raw = channels.get(name) ?? "#error:no channel entry (the case never reported a status)";
    let res: CaseResult;
    if (raw.startsWith("#not-evaluated:")) {
      res = "not-evaluated";
      out.notEvaluated.push(name);
      out.notEvaluatedReasons.set(name, raw.slice("#not-evaluated:".length));
    } else if (raw.startsWith("#error:")) {
      res = "error";
      out.errorNames.push(name);
      out.notEvaluatedReasons.set(name, raw.slice("#error:".length));
    } else {
      const exitCode = Number(raw.slice("#exit:".length));
      switch (exitCode) {
        case 0:
          res = "pass";
          if (name.startsWith("regression-")) out.regressionGreen += 1;
          break;
        case 3:
          res = "stayed-green";
          out.stayedGreen.push(name);
          break;
        case 4:
          res = "always-red";
          out.alwaysRed.push(name);
          break;
        default:
          res = "error";
          out.errorNames.push(name);
          out.notEvaluatedReasons.set(name, `case exited ${exitCode}`);
          break;
      }
    }
    out.results.set(name, res);
    if (!json) sink.verdict(name, res);
  }
  out.durationMs = now() - started;

  if (out.stayedGreen.length > 0 || out.alwaysRed.length > 0 || out.errorNames.length > 0 || out.uncovered.length > 0) {
    out.overall = 1;
  }
  // A case file that could not be EVALUATED at all is neither a violation of a checker nor a pass:
  // it is this script's "could not evaluate" state, which is exit 2 (its own usage/env code).
  if (out.notEvaluated.length > 0) out.overall = 2;
  if (checkers.length === 0) {
    process.stderr.write(
      "checker-mutation-check: ERROR — manifest is EMPTY (parser found no checkers; is scripts/test.sh / .github/workflows present and parseable?)\n",
    );
    out.overall = out.overall === 2 ? 2 : 1;
  }
  for (const mode of ["empty-manifest", "skip-cases", "invert-red"]) {
    if (opts.metaInject !== mode) continue;
    const why =
      mode === "empty-manifest"
        ? "manifest deliberately returned empty"
        : mode === "skip-cases"
          ? "case loop deliberately skipped — zero mutations ran"
          : "every RED assertion inverted";
    process.stderr.write(`checker-mutation-check: [meta-inject ${mode}] ${why} — gate must fail\n`);
    out.overall = out.overall === 2 ? 2 : 1;
  }
  return out;
}

export function runPlain(ctx: Ctx, m: Manifest, o: RunOutcome, opts: RunOptions): string {
  const lines: string[] = [];
  lines.push("");
  // Narrowed runs say so LOUDLY (hard rule 3b): `checkers_total` is a manifest fact (whole store),
  // so a reader must never mistake "1 case ran" for "83 checkers verified".
  if (opts.onlyCsv !== "") {
    lines.push(`checkers_executed: ${o.executed.length}`);
    lines.push(`only (delta-narrowed — ⛔ NOT the whole manifest): ${o.executed.join(" ")}`);
  }
  lines.push(`checkers_total: ${m.checkers.length}`);
  lines.push(`checkers_with_mutation: ${coveredCount(ctx, m)}`);
  lines.push(`mutations_that_stayed_green: ${o.stayedGreen.length}`);
  if (o.stayedGreen.length > 0) {
    lines.push("stayed-green (defect present, checker still green) — THE FINDINGS:");
    for (const n of o.stayedGreen) lines.push(`  - ${n}`);
  }
  lines.push(`mutations_that_always_red: ${o.alwaysRed.length}`);
  if (o.alwaysRed.length > 0) {
    lines.push("always-red (restore still red):");
    for (const n of o.alwaysRed) lines.push(`  - ${n}`);
  }
  lines.push(`uncovered (registered checker with no mutation case): ${o.uncovered.length}`);
  if (o.uncovered.length > 0) {
    for (const n of o.uncovered) lines.push(`  - ${n}`);
  }
  lines.push(`errors: ${o.errorNames.length}`);
  lines.push(`not_evaluated: ${o.notEvaluated.length}`);
  if (o.notEvaluated.length > 0) {
    lines.push("not-evaluated (the case file could not be read/evaluated at all — ⛔ not a pass):");
    for (const n of o.notEvaluated) lines.push(`  - ${n}  (${o.notEvaluatedReasons.get(n) ?? "reason not recorded"})`);
  }
  lines.push(`duration_ms: ${o.durationMs}`);
  if (o.notEvaluated.length > 0) {
    lines.push(
      "RESULT: NOT-EVALUATED — at least one case file could not be evaluated (see the list above); a case that cannot report a verdict is never a pass.",
    );
  } else if (o.overall !== 0) {
    lines.push("RESULT: FAIL — a checker stayed green under a defect it should catch, or the manifest is incomplete/broken.");
  } else if (opts.onlyCsv !== "") {
    lines.push(
      "RESULT: PASS — every checker IN THIS DELTA went RED under its injected defect and GREEN on restore (narrowed run; the whole-store set is the full-tier registration's job).",
    );
  } else {
    lines.push(
      "RESULT: PASS — every registered checker went RED under its injected defect and GREEN on restore; mutations_that_stayed_green = 0.",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** `join_json_names` — a JSON string array, ", "-joined, safe for zero args. */
export function joinJsonNames(names: readonly string[]): string {
  return names.map((n) => `"${n}"`).join(", ");
}

/** `csv_to_json_array` — a JSON string array from a comma-separated list, ","-joined, [] for empty. */
export function csvToJsonArray(csv: string): string {
  return csv
    .split(",")
    .map((n) => n.replace(/[ \t]/g, ""))
    .filter((n) => n !== "")
    .map((n) => `"${n}"`)
    .join(",");
}

export function runJsonLine(ctx: Ctx, m: Manifest, o: RunOutcome, opts: RunOptions): string {
  const resultsJson = `{${[...o.results.entries()].map(([n, r]) => `"${n}":"${r}"`).join(",")}}`;
  return (
    `{"checkers_total":${m.checkers.length},"checkers_with_mutation":${coveredCount(ctx, m)},` +
    `"mutations_that_stayed_green":${o.stayedGreen.length},"stayed_green":[${joinJsonNames(o.stayedGreen)}],` +
    `"mutations_that_always_red":${o.alwaysRed.length},"always_red":[${joinJsonNames(o.alwaysRed)}],` +
    `"errors":${o.errorNames.length},"error_names":[${joinJsonNames(o.errorNames)}],` +
    `"uncovered":[${joinJsonNames(o.uncovered)}],"results":${resultsJson},` +
    `"duration_ms":${o.durationMs},"only":[${csvToJsonArray(opts.onlyCsv)}],` +
    `"checkers_executed":[${joinJsonNames(o.executed)}],` +
    `"evaluated":${o.notEvaluated.length === 0},"not_evaluated":[${joinJsonNames(o.notEvaluated)}]}\n`
  );
}

// ── --check-changed (change-tier companion) ─────────────────────────────────────────────────────────

/** The first resolvable delta base under ctx.root. null when none resolves (a non-git root, or a
 *  checkout with no develop/master) — "读不懂输入" must not be turned into "no carriers". */
export function deltaBase(ctx: Ctx): string | null {
  for (const b of ["develop", "origin/develop", "master", "origin/master"]) {
    const r = spawnSync("git", ["-C", ctx.root, "rev-parse", "--verify", "--quiet", `${b}^{commit}`], {
      encoding: "utf8",
    });
    if (r.status === 0) return b;
  }
  return null;
}

/** This delta's changed paths, repo-relative, deduped — committed branch delta (three-dot, so a
 *  develop that advanced past the fork does not show up as OUR change) ∪ working-tree delta vs HEAD
 *  ∪ untracked. A committed change and an uncommitted one are both "this delta" (the worker runs the
 *  scoped gate before AND after committing). */
export function deltaFiles(ctx: Ctx, base: string): string[] {
  const run = (args: string[]): string => {
    const r = spawnSync("git", ["-C", ctx.root, ...args], { encoding: "utf8" });
    return r.status === 0 ? (r.stdout ?? "") : "";
  };
  const files = new Set<string>();
  for (const chunk of [
    run(["diff", "--name-only", `${base}...HEAD`]),
    run(["diff", "--name-only", "HEAD"]),
    run(["ls-files", "--others", "--exclude-standard"]),
  ]) {
    for (const raw of chunk.split("\n")) {
      const f = raw.replace(/^\.\//, "").trim();
      if (f !== "") files.add(f);
    }
  }
  return sortUnique(files);
}

/** `--check-changed` — judge only THIS delta's checker carriers. Emits its lines to `out` in order
 *  (the bash echoed its own header lines and then called run_plain / run_json, so both land on
 *  stdout in the same order). Returns the status. */
export async function runChanged(
  ctx: Ctx,
  m: Manifest,
  json: boolean,
  out: (line: string) => void,
  runOpts: Partial<RunOptions> = {},
): Promise<number> {
  const base = deltaBase(ctx);
  if (base === null) {
    out(
      `checker-mutation-check [--check-changed]: NOT-EVALUATED — no delta base (develop / origin/develop / master / origin/master) resolvable under ${ctx.root}; cannot derive this change's checker carriers.`,
    );
    return 0;
  }
  const delta = deltaFiles(ctx, base);

  // Names of the REGISTERED checkers this delta carries — either the checker script itself or its
  // mutation case (editing the case changes what the checker is proven to catch).
  const registered = new Set(m.checkers);
  const carriers: string[] = [];
  let registryHit = false;
  for (const f of delta) {
    if (f === "plugin/scripts/runner-static-gate.ts" || f === "scripts/test.sh" || /^\.github\/workflows\/.*\.yml$/.test(f)) {
      registryHit = true;
    }
    let name: string | null = null;
    let mm = /^plugin\/scripts\/checker-mutation-cases\/(.+)\.sh$/.exec(f);
    if (mm) name = mm[1];
    else {
      mm = /^plugin\/scripts\/(.+)\.(?:sh|ts)$/.exec(f);
      if (mm) name = mm[1];
    }
    if (name === null) continue;
    if (registered.has(name) && !carriers.includes(name)) carriers.push(name);
  }

  if (carriers.length === 0 && !registryHit) {
    out(
      `checker-mutation-check [--check-changed]: NOT-EVALUATED — this delta (base ${base}) carries no checker carrier (no registered checker script, no mutation case, and no manifest source), so no mutation case of it can be stale. The whole-store set is still verified by the full-tier registration.`,
    );
    return 0;
  }

  // The manifest source moved ⇒ the registered SET may have grown ⇒ re-verify the whole-manifest
  // 覆盖度 (uncovered) HERE, at the changer's gate — the AC1b dimension ("a new checker with no
  // mutation case can never silently slip through") arriving at the task that added it instead of at
  // an unrelated task's fan-in. Cheap: file existence, no case execution.
  let rc = 0;
  const uncovered = registryHit ? m.checkers.filter((n) => !hasCase(ctx, n)) : [];
  if (registryHit) {
    if (uncovered.length > 0) {
      rc = 1;
      out(
        `checker-mutation-check [--check-changed]: RED — the manifest source (runner-static-gate.ts / scripts/test.sh / .github/workflows) changed in this delta and ${uncovered.length} registered checker(s) have NO mutation case:`,
      );
      for (const n of uncovered) out(`  - ${n}`);
    } else {
      out(
        `checker-mutation-check [--check-changed]: manifest source changed in this delta — all ${m.checkers.length} registered checkers have a mutation case (uncovered = 0).`,
      );
    }
  }

  if (carriers.length === 0) {
    if (json) {
      out(
        `{"mode":"check-changed","delta_base":"${base}","registry_changed":true,"carriers":[],"uncovered":[${joinJsonNames(uncovered)}],"checkers_total":${m.checkers.length},"result":"${rc === 0 ? "pass" : "fail"}"}`,
      );
    } else {
      out(
        "checker-mutation-check [--check-changed]: no checker carrier in this delta — 只做了 manifest 覆盖度复验（未执行任何 mutation case；whole-store 全量仍由 full-tier 注册承担）。",
      );
      out(`checkers_total: ${m.checkers.length}`);
      out(`uncovered: ${uncovered.length}`);
      out("duration_ms: 0");
      out(
        rc !== 0
          ? "RESULT: FAIL — a registered checker has no mutation case (uncovered > 0)."
          : "RESULT: PASS — manifest coverage verified; nothing else to judge for this delta.",
      );
    }
    return rc;
  }

  out(
    `checker-mutation-check [--check-changed]: delta base ${base}; ${carriers.length} checker carrier(s) in THIS delta (⛔ not the whole ${m.checkers.length}-checker manifest): ${carriers.join(" ")}`,
  );
  const opts: RunOptions = { json, onlyCsv: carriers.join(","), metaInject: "", now: runOpts.now };
  const outcome = await runCases(ctx, m, opts, {
    caseOutput: (t) => process.stdout.write(t),
    verdict: (name, res) => out(`MUTATION ${name}: ${res}`),
  });
  if (json) out(runJsonLine(ctx, m, outcome, opts).replace(/\n$/, ""));
  else out(runPlain(ctx, m, outcome, opts).replace(/\n$/, ""));
  if (outcome.overall !== 0) rc = outcome.overall === 2 ? 2 : 1;
  return rc;
}

// ── --selftest (AC4 meta-mutation: break the mechanism, it must fail) ───────────────────────────────

export const SELF_MODULE = fileURLToPath(import.meta.url);

export function runSelftest(deps: { spawnSelf: (mode: string) => number }): { lines: string[]; code: number } {
  const lines: string[] = [];
  let fail = 0;
  lines.push("checker-mutation-check --selftest (AC4: breaking the mechanism must fail)");
  for (const mode of ["empty-manifest", "skip-cases", "invert-red"]) {
    const status = deps.spawnSelf(mode);
    if (status === 0) {
      process.stderr.write(`FAIL: --meta-inject ${mode} did NOT fail the gate\n`);
      lines.push(`FAIL: --meta-inject ${mode} did NOT fail the gate`);
      fail = 1;
    } else {
      lines.push(`PASS: ${mode} injection fails the gate`);
    }
  }
  lines.push(`checker-mutation-check --selftest: ${fail === 0 ? "ALL PASS" : "FAILED"}`);
  return { lines, code: fail };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

export function usageText(): string {
  const self = SELF_MODULE;
  const lines: string[] = [
    `用法: bash ${path.basename(self).replace(/\.ts$/, ".sh")} [参数…] — 详见下方脚本头部用法注释（--help|-h 仅打印用法，无副作用，退出 0）`,
  ];
  const src = readText(self);
  if (src !== null) {
    // The tool_help shape (the leading comment block IS the usage contract), with the `.ts` header
    // convention (`//`) accepted alongside the `.sh` one (`#`). The shebang is dropped exactly as
    // tool_help drops it — its `!` body is not part of the usage text.
    for (const l of src.split("\n").slice(0, 120)) {
      let stripped: string | null = null;
      if (l.startsWith("#")) stripped = l.replace(/^# ?/, "");
      else if (l.startsWith("//")) stripped = l.replace(/^\/\/ ?/, "");
      if (stripped === null || stripped.startsWith("!")) continue;
      lines.push(stripped);
    }
  }
  return lines.join("\n");
}

interface Parsed {
  cmd: "" | "list" | "run" | "check" | "selftest" | "check-changed";
  json: boolean;
  root: string;
  onlyCsv: string;
  metaInject: string;
  usageError: boolean;
}

export function parseCli(argv: string[]): Parsed {
  const p: Parsed = { cmd: "", json: false, root: defaultRepoRoot(), onlyCsv: "", metaInject: "", usageError: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--list":
        p.cmd = "list";
        break;
      case "--run":
        p.cmd = "run";
        break;
      case "--check":
        p.cmd = "check";
        break;
      case "--selftest":
        p.cmd = "selftest";
        break;
      case "--check-changed":
        p.cmd = "check-changed";
        break;
      case "--only":
        i++;
        p.onlyCsv = `${p.onlyCsv ? `${p.onlyCsv},` : ""}${argv[i] ?? ""}`;
        break;
      case "--json":
        p.json = true;
        break;
      case "--repo-root":
        i++;
        p.root = argv[i] ?? "";
        break;
      case "--meta-inject":
        i++;
        p.metaInject = argv[i] ?? "";
        break;
      default:
        p.usageError = true;
        break;
    }
  }
  // --check-changed derives its own narrowing from the delta; an explicit --only would silently
  // override it (fail-closed on the ambiguous combination rather than picking one).
  if (p.cmd === "check-changed" && p.onlyCsv !== "") p.usageError = true;
  return p;
}

function dieUsage(): never {
  process.stderr.write(
    "Usage: checker-mutation-check.sh --list [--json] | --run [--json] | --check | --selftest [--repo-root <dir>] [--meta-inject <mode>]\n",
  );
  process.exit(2);
}

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  // The bash checked ONLY $1 (`--help` must be the first argument) — preserved.
  if (args[0] === "--help" || args[0] === "-h") helpExit(usageText());

  const p = parseCli(args);
  if (p.usageError) dieUsage();
  const ctx = makeCtx(p.root);
  const m = buildManifest(ctx);
  const opts: RunOptions = { json: p.json, onlyCsv: p.onlyCsv, metaInject: p.metaInject };
  const write = (s: string): void => void process.stdout.write(s);

  switch (p.cmd) {
    case "list":
      write(p.json ? listJson(ctx, m) : listPlain(ctx, m));
      return 0;
    case "run":
    case "check": {
      const outcome = await runCases(ctx, m, opts, {
        caseOutput: write,
        verdict: (name, res) => write(`MUTATION ${name}: ${res}\n`),
      });
      write(p.json ? runJsonLine(ctx, m, outcome, opts) : runPlain(ctx, m, outcome, opts));
      return outcome.overall;
    }
    case "check-changed":
      return await runChanged(ctx, m, p.json, (line) => write(`${line}\n`));
    case "selftest": {
      const r = runSelftest({
        spawnSelf: (mode) => {
          const res = spawnSync(
            process.execPath,
            ["--no-warnings", "--experimental-strip-types", SELF_MODULE, "--repo-root", ctx.root, "--check", "--meta-inject", mode],
            { encoding: "utf8", stdio: "ignore" },
          );
          return res.status ?? 1;
        },
      });
      for (const line of r.lines) write(`${line}\n`);
      return r.code;
    }
    default:
      dieUsage();
  }
}

if (isDirectEntry(import.meta, undefined, "checker-mutation-check")) {
  process.exit(await main(process.argv));
}
