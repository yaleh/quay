// checked-in-write-check.ts — does any test create or delete entries under a CHECKED-IN path?
// (tasks/gap-fixture-dir-write-races-whole-tree-copy)
//
// INVARIANT IT JUDGES (the product this task exists to leave behind):
//   测试不得在已签入路径下创建或删除条目；一切临时产物落在进程私有临时目录。
//   A test must not create or delete entries under a checked-in path; every temporary artifact
//   belongs in a process-private temp dir.
//
// WHY THE INVARIANT NEEDS A JUDGE AT ALL: the repository tree is simultaneously the INPUT of other
//   tests and tools. `test/cold-start-oneliner-e2e.sh:82` does `cp -r "$PLUGIN_SRC" "$QUAY_DEV/plugin"`;
//   a copier that has already readdir'd `plugin/fixtures/workflow-replay/` then fails `stat` on an
//   entry a test removed in between (`cp: cannot stat …/_tmp-bad-schema: No such file or directory`).
//   The failure lands on the COPIER, not on the writer — measured pre-fix at 2/400 concurrent-arm
//   failures vs 0/25 solo-arm, i.e. concurrency is the independent variable, not noise. Two fan-in
//   runs were already burned misattributing that red to whichever task happened to be landing.
//
// ── 按位置判定（硬规则 2）: the judge reads the RESOLVED TARGET PATH, never a source-text keyword ──
//   `plugin/scripts/checked-in-write-guard.cjs` (loaded via `node --require`) interposes on the write
//   verbs of `node:fs` / `node:fs/promises` and reports every call whose resolved target lands strictly
//   inside the repo root and outside `os.tmpdir()`. Judging the resolved path is exact: there is no path
//   expression left to interpret. The alternative — a source scanner re-deriving what each expression
//   evaluates to — was prototyped first and reported 605 "violations" on a tree whose true count is 0
//   (it harvested identifiers out of string literals); it was discarded rather than tuned. The price of
//   the runtime judge is stated in the output, not hidden: it only sees what RUNS.
//
// ── NOT-EVALUATED is a first-class reading (硬规则 3b) ─────────────────────────────────────────────
//   This criterion can also FAIL to have judged anything, and says so distinctly from PASS:
//     · no input files matched / the scan dir is absent or empty
//     · the guard file or the runner file is missing
//     · the guard never loaded in a child (no `guardLoaded` marker)      → judged nothing
//     · an input's module evaluation did not complete                    → judged nothing
//   The last is the subtle one, and it is checked TWICE from two independent readings: the runner
//   records whether the import resolved, and the guard records whether the runtime opened the file.
//   A file that fails to load performs no writes, so a judge that merely counts writes calls it clean;
//   it is not clean, it is UNREAD. exit 3.
//
// Run:
//   node --experimental-strip-types plugin/scripts/checked-in-write-check.ts [--root <dir>]
//        [--dir <dir>] [--files <f> [<f>…]] [--changed [--base <ref>]] [--json] [--timeout-ms <n>]
//   --dir defaults to `plugin/test`; --files overrides it. One child process per input file, so the
//   cost is linear in the inputs — pass the files a change touched, or sweep with --dir.
// exit: 0 = every executed input wrote nothing into the checked-in tree · 1 = ≥1 such write (each
//       named with verb + resolved target + call site) · 3 = NOT-EVALUATED (see above)
//
// ── --changed: the DELTA-SCOPED mode (gap-suite-glob-universe-fixture-write-toctou) ──────────────
//   The invariant above had a JUDGE but no EXECUTOR: nothing in `scripts/test.sh` /
//   `runner-static-gate.ts` ran this file, so the second instance of the defect class (a fixture
//   created and deleted under `plugin/test/`, i.e. INSIDE the SUITE_GLOBS universe) lived on
//   unnoticed while the first (`plugin/fixtures/`) was fixed. Wiring the judge into the STONE gate
//   raises one cost question: this judge RUNS each input, so sweeping the corpus (336 files under
//   plugin/test, ~1s–60s each) is two orders of magnitude too expensive for a gate that runs every
//   suite. `--changed` is the repo's既定 answer for exactly this shape — the same delta-scoped
//   companion convention as `it0-split-or-commit-check.ts --changed` and
//   `checker-mutation-check.sh --check-changed`: judge the DELTA (a new or edited test file is
//   judged at its OWN landing), never the whole store; the full sweep stays available manually via
//   `--dir plugin/test`.
//     base  = `--base <ref>`, else the first resolvable of develop / origin/develop / master / origin/master
//     delta = `git diff --name-only <base>...HEAD`  (three-dot ⇒ merge-base: this branch's side only)
//             ∪ `git diff --name-only HEAD`         (uncommitted: staged + unstaged)
//             ∪ `git ls-files --others --exclude-standard`  (a new, not-yet-committed test file)
//             then filtered to EXISTING `*.test.mjs` / `*.test.ts` files.
//   COVERAGE IS PARTIAL AND SAID SO: a test file nobody changed this delta is not judged by
//   `--changed`. "Judged nothing" and "judged clean" must never share an output (硬规则 3b), so an
//   empty delta reports NOT-EVALUATED with the base it resolved — not PASS. And in this mode
//   NOT-EVALUATED exits 0, NOT 3: the scoped runner (`scripts/test.sh:run_scoped_static_checks_sel`)
//   evaluates each selected checker under `set -euo pipefail`, so exit 3 would ABORT an innocent
//   task whose delta happens to carry no test file (the same scoped-safe convention as
//   it0-split-or-commit-check --changed / suite-bucket-drift-check). The three-state VOCABULARY is
//   unchanged — the line still prints `NOT-EVALUATED:`; only the process code is scoped-safe.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { helpExit, emitPass, emitFail, emitNotEvaluated } from "./gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Default judged root = the repo this script is checked into (this file is <repo>/plugin/scripts/). */
export const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");
/** Default judged surface: the test corpus the defect class lives in. */
export const DEFAULT_TEST_DIR_REL = "plugin/test";
/** The runtime judge (CommonJS, loaded via `node --require`). */
export const GUARD_REL = "plugin/scripts/checked-in-write-guard.cjs";
/** The per-input loader that imports one input and records whether its evaluation completed. */
export const RUNNER_REL = "plugin/scripts/checked-in-write-run.cjs";
/** Per-input wall clock. A timeout is reported as an evaluation that could not be confirmed. */
export const DEFAULT_TIMEOUT_MS = 300_000;

/** The `--changed` base resolution order (the repo's delta-companion convention —
 *  it0-split-or-commit-check.ts --changed / checker-mutation-check.sh --check-changed). */
export const DELTA_BASE_CANDIDATES: readonly string[] = ["develop", "origin/develop", "master", "origin/master"];

/** The delta-scoped reading of ONE checker invocation: which test files the change touched. */
export interface ChangedSelection {
  /** The base ref that was resolved, or null when none resolved. */
  base: string | null;
  /** Absolute paths of the delta's existing test files — the inputs `--changed` will judge. */
  inputs: string[];
  /** Every delta path considered (before the test-file/existence filter), for transparency. */
  deltaPaths: string[];
  /** Why the selection could not be made (≠ "the delta had no test file"). */
  notEvaluated?: string;
}

export interface WriteViolation {
  fn: string;
  target: string;
  /** Where the entry actually lands (nearest existing ancestor resolved, final component literal). */
  located: string;
  rawArg: string;
  cwd: string;
  stack: string;
}

export interface UnreadInput {
  input: string;
  error: string;
}

export interface CheckedInWriteResult {
  /** true iff evaluated && no violation (硬规则 3b: never conflated with not-evaluated). */
  ok: boolean;
  /** false when the criterion could not be evaluated at all. */
  evaluated: boolean;
  /** Why not-evaluated, when evaluated is false. */
  notEvaluatedReason?: string;
  /** Absolute paths of the input files the criterion ran. */
  inputs: string[];
  /** Inputs whose module evaluation completed (runner reading). */
  evaluatedInputs: string[];
  /** Inputs the runtime opened (guard reading) — the second, independent liveness reading. */
  opened: string[];
  /** Inputs whose evaluation did not complete, with the reason. */
  unread: UnreadInput[];
  /** Total write-verb calls the guard judged — the denominator a PASS rests on. */
  judgedCalls: number;
  /** Every judged call whose target resolved inside the checked-in tree. */
  violations: WriteViolation[];
  /** Child exit statuses, reported for transparency — never used to decide this criterion. */
  childStatuses: (number | null)[];
}

/** Parse the guard/runner JSONL. Unparseable lines become `badLines` (counted, never silently dropped). */
export function parseGuardLog(text: string): {
  guardLoaded: number;
  judgedCalls: number;
  opened: Set<string>;
  evaluated: Set<string>;
  unread: UnreadInput[];
  violations: WriteViolation[];
  badLines: string[];
} {
  let guardLoaded = 0;
  let judgedCalls = 0;
  const opened = new Set<string>();
  const evaluated = new Set<string>();
  const unread: UnreadInput[] = [];
  const violations: WriteViolation[] = [];
  const badLines: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let rec: Record<string, unknown>;
    try { rec = JSON.parse(t) as Record<string, unknown>; } catch { badLines.push(t); continue; }
    if (rec.guardLoaded) { guardLoaded++; continue; }
    // Each child reports its own tally on exit; the total is the sum across children.
    if (typeof rec.judgedTotal === "number") { judgedCalls += rec.judgedTotal; continue; }
    if (typeof rec.moduleOpened === "string") { opened.add(rec.moduleOpened); continue; }
    if (typeof rec.evaluated === "string") { evaluated.add(rec.evaluated); continue; }
    if (typeof rec.evaluationFailed === "string") {
      unread.push({ input: rec.evaluationFailed, error: String(rec.error ?? "") });
      continue;
    }
    if (typeof rec.fn === "string" && typeof rec.target === "string") {
      violations.push({
        fn: rec.fn,
        target: rec.target,
        located: String(rec.located ?? rec.target),
        rawArg: String(rec.rawArg ?? ""),
        cwd: String(rec.cwd ?? ""),
        stack: String(rec.stack ?? ""),
      });
    }
  }
  return { guardLoaded, judgedCalls, opened, evaluated, unread, violations, badLines };
}

function listInputs(dir: string): string[] {
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return []; }
  return entries
    .filter((f) => f.endsWith(".test.mjs"))
    .map((f) => path.join(dir, f))
    .sort();
}

/** Run one git command in `root`. Returns stdout (trimmed) and whether it succeeded. */
function runGit(root: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

/** Resolve the delta base ref: the `--base` override, else the first resolvable candidate. */
export function resolveDeltaBase(root: string, override?: string): string | null {
  const candidates = override ? [override] : [...DELTA_BASE_CANDIDATES];
  for (const c of candidates) {
    if (runGit(root, ["rev-parse", "--verify", "--quiet", `${c}^{commit}`]).ok) return c;
  }
  return null;
}

/**
 * Select the test files THIS DELTA touches — the `--changed` input set. Derived from git, never
 * from a hand-maintained list: committed-on-this-branch (merge-base three-dot) ∪ uncommitted
 * (staged+unstaged) ∪ untracked, filtered to files that still exist and are `*.test.mjs`/`*.test.ts`.
 * A deleted test file cannot be judged (there is nothing to run), so it drops out of the input set
 * — that is a filter, not a claim that it was clean, and it is why `deltaPaths` is returned
 * alongside `inputs` (the caller reports both).
 */
export function changedTestInputs(root: string, override?: string): ChangedSelection {
  const base = resolveDeltaBase(root, override);
  if (!base) {
    return {
      base: null, inputs: [], deltaPaths: [],
      notEvaluated:
        `no delta base ref resolved (tried ${(override ? [override] : DELTA_BASE_CANDIDATES).join(", ")}) — ` +
        `cannot tell which files this change touched`,
    };
  }
  const committed = runGit(root, ["diff", "--name-only", `${base}...HEAD`]);
  const working = runGit(root, ["diff", "--name-only", "HEAD"]);
  const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"]);
  for (const [what, r] of [["diff base...HEAD", committed], ["diff HEAD", working], ["ls-files --others", untracked]] as const) {
    if (!r.ok) return { base, inputs: [], deltaPaths: [], notEvaluated: `git ${what} failed in ${root}` };
  }
  const deltaPaths = [...new Set(
    [committed.out, working.out, untracked.out]
      .flatMap((t) => t.split("\n"))
      .map((s) => s.trim())
      .filter(Boolean),
  )].sort();
  const inputs = deltaPaths
    .filter((p) => p.endsWith(".test.mjs") || p.endsWith(".test.ts"))
    .map((p) => path.resolve(root, p))
    .filter((abs) => fs.existsSync(abs));
  return { base, inputs, deltaPaths };
}

export function checkCheckedInWrites(opts: {
  root: string;
  files?: string[];
  dir?: string;
  timeoutMs?: number;
  /** Test seam: overrides the per-input spawn so a case can drive a synthetic child. */
  spawnInput?: (input: string, opts: { guard: string; runner: string; logPath: string; root: string; timeoutMs: number }) => number | null;
}): CheckedInWriteResult {
  const root = path.resolve(opts.root);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scanDir = path.resolve(root, opts.dir ?? DEFAULT_TEST_DIR_REL);
  const files = (opts.files && opts.files.length > 0 ? opts.files : listInputs(scanDir)).map((f) => path.resolve(f));

  const empty = (reason: string): CheckedInWriteResult => ({
    ok: false, evaluated: false, notEvaluatedReason: reason,
    inputs: files, evaluatedInputs: [], opened: [], unread: [], judgedCalls: 0, violations: [], childStatuses: [],
  });

  if (files.length === 0) {
    return empty(`no input files matched under ${scanDir} — nothing was judged`);
  }
  const guard = path.resolve(root, GUARD_REL);
  if (!fs.existsSync(guard)) return empty(`the runtime guard is missing: ${guard}`);
  const runner = path.resolve(root, RUNNER_REL);
  if (!fs.existsSync(runner)) return empty(`the per-input runner is missing: ${runner}`);

  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length > 0) return empty(`input file(s) unreadable: ${missing.join(", ")}`);

  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "checked-in-write-check-"));
  const logPath = path.join(logDir, "guard.jsonl");

  const spawnInput = opts.spawnInput ?? ((input: string, o: { guard: string; runner: string; logPath: string; root: string; timeoutMs: number }) => {
    const res = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--require", o.guard, o.runner],
      {
        cwd: o.root,
        env: {
          ...process.env,
          // QUAY_TEST_NESTED / _ROOT — the judged child is NOT inside a suite, but it must behave
          // like a nested suite invocation for two reasons, and this is the same marker
          // scripts/test.sh:mark_nested() sets: (1) RECURSION — a test file that spawns
          // `scripts/test.sh` would otherwise re-enter run_static_checks, which is where THIS
          // checker is wired, and loop (checker → test.sh → checker → …); (2) SEMANTICS — inside a
          // real suite a nested invocation skips the whole-store work the OUTER pass already ran
          // (run_static_checks / build_dist_once), and this checker IS an outer whole-store pass,
          // so the nested run must skip exactly the same work. QUAY_TEST_NESTED_ROOT = this judged
          // root keeps test.sh's own same-root guard intact: a child that spawns test.sh in a
          // DIFFERENT tree still pays that tree's checks.
          QUAY_TEST_NESTED: "1",
          QUAY_TEST_NESTED_ROOT: o.root,
          QUAY_WRITE_GUARD_ROOT: o.root,
          QUAY_WRITE_GUARD_LOG: o.logPath,
          QUAY_WRITE_GUARD_WATCH: input,
          QUAY_WRITE_GUARD_INPUT: input,
        },
        encoding: "utf8",
        timeout: o.timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (res.error && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      fs.appendFileSync(o.logPath, JSON.stringify({ evaluationFailed: input, error: `timeout after ${o.timeoutMs}ms` }) + "\n");
      return null;
    }
    return res.status;
  });

  const childStatuses: (number | null)[] = [];
  for (const input of files) childStatuses.push(spawnInput(input, { guard, runner, logPath, root, timeoutMs }));

  let text = "";
  try { text = fs.readFileSync(logPath, "utf8"); } catch { text = ""; }
  const parsed = parseGuardLog(text);
  // This criterion's own scratch dir is process-private and must not outlive the run — the same
  // invariant it judges (R6 mkdtemp-no-cleanup / gap-tmp-leak-is-live): a judge that leaks a temp
  // dir per invocation into tmpfs would be the defect it reports.
  try { fs.rmSync(logDir, { recursive: true, force: true }); } catch { /* best-effort */ }

  const base = {
    inputs: files,
    evaluatedInputs: [...parsed.evaluated].sort(),
    opened: [...parsed.opened].sort(),
    unread: parsed.unread,
    judgedCalls: parsed.judgedCalls,
    violations: parsed.violations,
    childStatuses,
  };

  if (parsed.guardLoaded === 0) {
    // The scratch log is already gone by now (this criterion cleans up after itself), so carry the
    // evidence that made the call into the message instead of pointing at a deleted path.
    const sample = text.split("\n").filter(Boolean).slice(0, 2).join(" | ").slice(0, 300);
    return {
      ...base, ok: false, evaluated: false,
      notEvaluatedReason:
        `the runtime guard never loaded (no guardLoaded marker; child status(es) ${JSON.stringify(childStatuses)}) — ` +
        `the ${files.length} input(s) were not judged. First log line(s): ${sample || "<log empty>"}`,
    };
  }
  if (parsed.unread.length > 0) {
    const first = parsed.unread.slice(0, 3).map((u) => `${u.input} (${u.error})`).join("; ");
    return {
      ...base, ok: false, evaluated: false,
      notEvaluatedReason:
        `${parsed.unread.length}/${files.length} input(s) did not finish evaluation — a file that never loaded ` +
        `performs no writes, which is UNREAD, not clean: ${first}`,
    };
  }
  const evaluatedSet = new Set([...parsed.evaluated].map((p) => path.resolve(p)));
  const openedSet = new Set([...parsed.opened].map((p) => path.resolve(p)));
  const unexplained = files.filter((f) => !evaluatedSet.has(f) || !openedSet.has(f));
  if (unexplained.length > 0) {
    return {
      ...base, ok: false, evaluated: false,
      notEvaluatedReason:
        `${unexplained.length}/${files.length} input(s) have no confirmed evaluation+open pair — ` +
        `the two independent readings disagree, so nothing is claimed about them: ${unexplained.slice(0, 5).join(", ")}`,
    };
  }
  return { ...base, ok: parsed.violations.length === 0, evaluated: true };
}

function parseArgs(argv: string[]): { root: string; dir?: string; files: string[]; json: boolean; timeoutMs?: number; changed: boolean; base?: string } {
  let root = DEFAULT_ROOT;
  let dir: string | undefined;
  let timeoutMs: number | undefined;
  const files: string[] = [];
  let json = false;
  let changed = false;
  let base: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--root": root = argv[++i]; break;
      case "--dir": dir = argv[++i]; break;
      case "--files": while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) files.push(argv[++i]); break;
      case "--changed": changed = true; break;
      case "--base": base = argv[++i]; break;
      case "--json": json = true; break;
      case "--timeout-ms": timeoutMs = Number(argv[++i]); break;
      default: console.error(`unknown: ${argv[i]}`); process.exit(2);
    }
  }
  if (changed && (files.length > 0 || dir !== undefined)) {
    console.error("--changed selects its own inputs from the git delta; it cannot be combined with --files/--dir");
    process.exit(2);
  }
  return { root, dir, files, json, timeoutMs, changed, base };
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    helpExit(
      "usage: node checked-in-write-check.ts [--root <dir>] [--dir <dir>] [--files <f>…] " +
        "[--changed [--base <ref>]] [--json] [--timeout-ms <n>]",
    );
  }
  const { root, dir, files, json, timeoutMs, changed, base } = parseArgs(argv);

  if (changed) {
    const selection = changedTestInputs(root, base);
    // (1) The selection itself could not be made (no base, git failed) — nothing was judged.
    if (selection.notEvaluated) {
      return changedNotEvaluated(
        `--changed: ${selection.notEvaluated}`,
        { evaluated: false, inputs: selection.inputs, deltaPaths: selection.deltaPaths },
        json,
      );
    }
    // (2) The delta carries no test file — NOT-EVALUATED, never PASS. "I had nothing to judge" and
    //     "I judged it clean" must not share an output (硬规则 3b): the whole point of this mode is
    //     that the un-judged surface stays visible.
    if (selection.inputs.length === 0) {
      return changedNotEvaluated(
        `--changed: the delta against ${selection.base} carries no existing *.test.mjs/*.test.ts file ` +
          `(${selection.deltaPaths.length} delta path(s) considered) — nothing was judged`,
        { evaluated: false, base: selection.base, deltaPaths: selection.deltaPaths },
        json,
      );
    }
    const res = checkCheckedInWrites({ root, files: selection.inputs, timeoutMs });
    return render(res, json, { changed: true, base: selection.base, deltaPaths: selection.deltaPaths });
  }

  const res = checkCheckedInWrites({ root, files, dir, timeoutMs });
  return render(res, json);
}

/** In `--changed` mode NOT-EVALUATED exits 0 (scoped-safe — see the header); the line still says
 *  NOT-EVALUATED, so the three-state vocabulary is unchanged and "nothing judged" stays visible. */
function changedNotEvaluated(message: string, detail: unknown, json: boolean): number {
  emitNotEvaluated(message, detail, { json, stream: json ? "stdout" : "stderr" });
  return 0;
}

/** Render one `checkCheckedInWrites` result as a three-state verdict and return its exit code. */
function render(
  res: CheckedInWriteResult,
  json: boolean,
  changed?: { changed: true; base: string | null; deltaPaths: string[] },
): number {
  const detail = changed ? { ...res, ...changed } : res;
  if (!res.evaluated) {
    const code = emitNotEvaluated(res.notEvaluatedReason ?? "could not evaluate the checked-in-write surface", detail, {
      json, stream: json ? "stdout" : "stderr",
    });
    return changed ? 0 : code;
  }
  if (res.ok) {
    const message = changed
      ? `no checked-in-tree writes: ${res.judgedCalls} write-verb call(s) across ${res.inputs.length} executed input(s), 0 inside the tree ` +
        `— delta against ${changed.base} (${res.inputs.length} of ${changed.deltaPaths.length} delta path(s) judged; ` +
        `unchanged test files are NOT judged by --changed)`
      : `no checked-in-tree writes: ${res.judgedCalls} write-verb call(s) across ${res.inputs.length} executed input(s), 0 inside the tree`;
    return emitPass(message, detail, { json });
  }
  if (!json) {
    for (const v of res.violations) {
      // Report WHERE IT LANDED, not merely what was named — the landing path is the actionable fact
      // (a call may name a scratch path and land in the tree through a symlinked parent).
      process.stderr.write(
        v.located === v.target
          ? `  ${v.fn}(${v.rawArg}) -> ${v.located}\n`
          : `  ${v.fn}(${v.rawArg}) -> ${v.located}  [named: ${v.target}]\n`,
      );
      for (const line of v.stack.split("\n").filter(Boolean).slice(0, 3)) process.stderr.write(`      ${line.trim()}\n`);
    }
  }
  return emitFail(
    `${res.violations.length} write(s) into the checked-in tree across ${res.inputs.length} input(s): ` +
    res.violations.slice(0, 4).map((v) => `${v.fn} -> ${v.located}`).join("; "),
    detail,
    { json },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
