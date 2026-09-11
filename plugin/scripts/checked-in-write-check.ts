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
//        [--dir <dir>] [--files <f> [<f>…]] [--json] [--timeout-ms <n>]
//   --dir defaults to `plugin/test`; --files overrides it. One child process per input file, so the
//   cost is linear in the inputs — pass the files a change touched, or sweep with --dir.
// exit: 0 = every executed input wrote nothing into the checked-in tree · 1 = ≥1 such write (each
//       named with verb + resolved target + call site) · 3 = NOT-EVALUATED (see above)

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

export interface WriteViolation {
  fn: string;
  target: string;
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
    return {
      ...base, ok: false, evaluated: false,
      notEvaluatedReason:
        `the runtime guard never loaded (no guardLoaded marker in ${logPath}) — the ${files.length} input(s) were not judged`,
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

function parseArgs(argv: string[]): { root: string; dir?: string; files: string[]; json: boolean; timeoutMs?: number } {
  let root = DEFAULT_ROOT;
  let dir: string | undefined;
  let timeoutMs: number | undefined;
  const files: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--root": root = argv[++i]; break;
      case "--dir": dir = argv[++i]; break;
      case "--files": while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) files.push(argv[++i]); break;
      case "--json": json = true; break;
      case "--timeout-ms": timeoutMs = Number(argv[++i]); break;
      default: console.error(`unknown: ${argv[i]}`); process.exit(2);
    }
  }
  return { root, dir, files, json, timeoutMs };
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    helpExit("usage: node checked-in-write-check.ts [--root <dir>] [--dir <dir>] [--files <f>…] [--json] [--timeout-ms <n>]");
  }
  const { root, dir, files, json, timeoutMs } = parseArgs(argv);
  const res = checkCheckedInWrites({ root, files, dir, timeoutMs });

  if (!res.evaluated) {
    return emitNotEvaluated(res.notEvaluatedReason ?? "could not evaluate the checked-in-write surface", res, {
      json, stream: json ? "stdout" : "stderr",
    });
  }
  if (res.ok) {
    return emitPass(
      `no checked-in-tree writes: ${res.judgedCalls} write-verb call(s) across ${res.inputs.length} executed input(s), 0 inside the tree`,
      res,
      { json },
    );
  }
  if (!json) {
    for (const v of res.violations) {
      process.stderr.write(`  ${v.fn}(${v.rawArg}) -> ${v.target}\n`);
      for (const line of v.stack.split("\n").filter(Boolean).slice(0, 3)) process.stderr.write(`      ${line.trim()}\n`);
    }
  }
  return emitFail(
    `${res.violations.length} write(s) into the checked-in tree across ${res.inputs.length} input(s): ` +
    res.violations.slice(0, 4).map((v) => `${v.fn} -> ${v.target}`).join("; "),
    res,
    { json },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
