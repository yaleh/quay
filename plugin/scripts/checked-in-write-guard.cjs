// checked-in-write-guard.cjs — the RUNTIME half of `checked-in-write-check.ts`
// (tasks/gap-fixture-dir-write-races-whole-tree-copy).
//
// INVARIANT (the one this whole task exists to defend):
//   测试不得在已签入路径下创建或删除条目；一切临时产物落在进程私有临时目录。
//   A test must not create or delete entries under a checked-in path; every temporary
//   artifact belongs in a process-private temp dir (os.tmpdir()/mkdtemp).
//
// WHY A RUNTIME GUARD AND NOT A SOURCE SCANNER — 按位置判定（CLAUDE.md 硬规则 2）lives at the
//   level of the RESOLVED TARGET PATH, not of source text. A scanner that reads source has to
//   re-derive, by hand, what a path expression evaluates to (identifier scoping, template
//   literals, aliasing, helper return values). That re-derivation is an approximation of the
//   language, and every approximation is wrong somewhere — the first prototype for this task
//   reported 605 "violations" on a tree whose real count is 0, almost all of them lexer bugs
//   (identifiers harvested out of string literals). Interposing on `node:fs` instead makes the
//   judge exact: the target path is already resolved by the time we see it, and there is no
//   expression left to interpret. The cost of the runtime approach is that it only sees what
//   actually runs — which is stated in the checker's output, not hidden.
//
// HOW IT IS LOADED — `node --require <this file> <script>` (CommonJS, via --require).
//   The `--require` ordering is LOAD-BEARING, not incidental. Patching through `--import` (ESM)
//   is a silent no-op for `import { mkdirSync } from "node:fs"`: the ESM facade snapshots the
//   builtin's exports when it is first imported, and an ESM preload has already imported
//   `node:fs` by then, so the snapshot holds the ORIGINAL functions. A CJS `--require` preload
//   runs before any ESM instantiation, so the facade snapshots the PATCHED functions and every
//   access form is covered. Measured on this repo's Node 24:
//     --import  => intercepts fs.mkdirSync only; `import {mkdirSync}` and `await import("node:fs")` BYPASS
//     --require => intercepts all four forms (default-export property, static named import,
//                  dynamic-import namespace, `.default.` property)
//   A guard that silently misses the named-import form is the failure mode CLAUDE.md 硬规则 3b
//   names: it would report "clean" for a file that writes into the tree.
//
// CONFIG (env — the checker sets these; the guard never guesses):
//   QUAY_WRITE_GUARD_ROOT   absolute repo root. A target strictly inside it is judged. Unset ⇒
//                           the guard records `guard-not-configured` and judges nothing.
//   QUAY_WRITE_GUARD_LOG    absolute path of the JSONL log. Unset ⇒ records go to stderr only
//                           (still visible, but not machine-readable).
//   QUAY_WRITE_GUARD_WATCH  newline-separated absolute paths of the input files the checker handed
//                           the runtime. A read-open of one of them is logged as `moduleOpened` —
//                           the LIVENESS evidence that lets the checker distinguish "this file ran
//                           and wrote nothing" from "this file never loaded, so nothing was judged"
//                           (硬规则 3b). Without it a file that fails to load reads as clean.
//
// ⛔ THIS GUARD NEVER THROWS ON THE HOST TEST. It records; the checker decides. Throwing here
//   would turn an isolation defect into a random unrelated test failure and make the report
//   point at the wrong place — the same misattribution this task was filed to stop.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const ROOT = process.env.QUAY_WRITE_GUARD_ROOT || "";
const LOG = process.env.QUAY_WRITE_GUARD_LOG || "";

// ── the original appendFileSync, captured BEFORE patching ───────────────────────────────────
// The guard's own bookkeeping must not go through the guard. `fs.appendFileSync` is a judged verb,
// so logging through the patched binding re-enters judge() and recurses until the stack dies.
const ORIG_APPEND = fs.appendFileSync;
function recordRaw(obj) {
  if (!LOG) return;
  try { ORIG_APPEND.call(fs, LOG, JSON.stringify(obj) + "\n"); } catch { /* the log is best-effort */ }
}

// ── temp allowance, resolved once ───────────────────────────────────────────────────────────
// `os.tmpdir()` can itself be a symlink (/tmp -> /private/tmp on macOS); compare on realpaths so a
// write through either spelling is recognised. A temp dir that cannot be realpath'd falls back to
// its literal value — never to "allow everything".
function realOrSelf(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}
const TMP = realOrSelf(os.tmpdir());
const ROOT_REAL = ROOT ? realOrSelf(ROOT) : "";

/** Is `target` strictly inside `base`? */
function isInside(base, target) {
  if (!base || !target) return false;
  const rel = path.relative(base, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// ── the write-verb table: fn name → index of the DESTINATION argument ──────────────────────
// (src, dest) pairs are the majority of the "why did my scanner flag a read" traps: for
// copyFile/cp/rename/symlink/link the SECOND argument is the one that creates an entry. Judging
// argument 0 there reports the *source* — a file the test only reads — as the offender.
const DEST_0 = [
  "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync", "writeFile", "writeFileSync",
  "appendFile", "appendFileSync", "rm", "rmSync", "rmdir", "rmdirSync", "unlink", "unlinkSync",
  "truncate", "truncateSync", "createWriteStream",
  "chmod", "chmodSync", "lchmod", "lchmodSync", "chown", "chownSync", "lchown", "lchownSync",
  "utimes", "utimesSync", "futimes", "futimesSync",
];
const DEST_1 = ["copyFile", "copyFileSync", "cp", "cpSync", "rename", "renameSync", "symlink", "symlinkSync", "link", "linkSync"];
// open/openSync are NOT write verbs per se — `fs.openSync(p, "r")` is how the ESM loader reads
// every module in the process, so judging argument 0 unconditionally reports the whole program as
// a tree mutator (measured: the first guard prototype logged `openSync(<the test file>)` before a
// single test body had run). They are judged only when the flags can create/truncate, and are
// separately used as the liveness probe (the loader's read-open is how we see a module load).
const OPEN_VERBS = ["open", "openSync"];
const OPEN_WRITE_FLAG_RE = /[wa]|^r\+|\+/;
const READ_VERBS = ["open", "openSync", "readFile", "readFileSync"];

const TABLE = new Map();
for (const n of DEST_0) TABLE.set(n, 0);
for (const n of DEST_1) TABLE.set(n, 1);
for (const n of OPEN_VERBS) TABLE.set(n, 0);

/** Normalise the destination argument to an absolute path, or null when it is not judgeable. */
function toTarget(arg) {
  // The ESM loader hands `openSync` a `file://` URL *string* (observed in this Node); `path.resolve`
  // on that literal would invent a `<cwd>/file:/…` path and judge the wrong thing.
  if (typeof arg === "string") {
    if (arg.startsWith("file://")) { try { return path.resolve(fileURLToPath(arg)); } catch { return null; } }
    return path.resolve(arg);
  }
  if (arg instanceof URL) { try { return path.resolve(fileURLToPath(arg)); } catch { return null; } }
  if (Buffer.isBuffer(arg)) return path.resolve(arg.toString());
  // A file descriptor (number) or a non-path argument: the guard cannot see where it points.
  return null;
}

// ── liveness: which of the checker's inputs did the runtime actually open? ─────────────────
const WATCH = new Set(
  String(process.env.QUAY_WRITE_GUARD_WATCH || "")
    .split("\n").map((s) => s.trim()).filter(Boolean)
    .map((s) => realOrSelf(s)),
);
function noteOpened(fnName, args) {
  try {
    if (WATCH.size === 0) return;
    if (!READ_VERBS.includes(fnName)) return;
    const target = toTarget(args[0]);
    if (target === null) return;
    const real = realOrSelf(target);
    if (!WATCH.has(real)) return;
    recordRaw({ moduleOpened: real });
  } catch { /* the guard must never break the host process */ }
}

/** Write-verb calls this process actually judged — the denominator a PASS rests on. */
let judged = 0;
function record(fnName, argIndex, rawArg, target) {
  recordRaw({
    fn: fnName,
    argIndex,
    target,
    rawArg: typeof rawArg === "string" ? rawArg : String(rawArg),
    cwd: process.cwd(),
    // the frames above this guard file — the call site that made the write, minus guard plumbing
    stack: String(new Error().stack || "").split("\n").slice(2, 6).join("\n"),
  });
  try { process.stderr.write(`[checked-in-write-guard] ${fnName}(${rawArg}) -> ${target}\n`); } catch { /* ignore */ }
}

/** Judge one call. Recording is the whole effect — nothing is thrown at the host. */
function judge(fnName, args) {
  try {
    noteOpened(fnName, args);
    if (!ROOT) { record(fnName, -1, args[0], "<guard-not-configured: QUAY_WRITE_GUARD_ROOT unset>"); return; }
    const idx = TABLE.get(fnName);
    if (idx === undefined) return;
    if (OPEN_VERBS.includes(fnName) && !OPEN_WRITE_FLAG_RE.test(String(args[1] ?? "r"))) return;
    const target = toTarget(args[idx]);
    if (target === null) return; // fd / non-path — not judgeable, and NOT counted as judged-clean
    judged++;
    const targetReal = realOrSelf(target);
    // ORDER IS LOAD-BEARING: root membership is judged FIRST, the temp allowance only covers paths
    // that are NOT in the tree. A temp dir that lives inside the checked-in tree is not private —
    // a whole-tree copier sees it exactly like any other entry — so "it is under os.tmpdir()" must
    // not excuse it. Measured consequence of the opposite order: a fabricated root inside /tmp
    // reported 0 violations for an input that created entries in it, i.e. the judge could not
    // judge its own test. No test in this repo redirects os.tmpdir() into the tree (checked:
    // the only TMPDIR-shaped assignments are TMUX_TMPDIR, which does not move os.tmpdir()).
    if (targetReal === ROOT_REAL || isInside(ROOT_REAL, targetReal)) { record(fnName, idx, args[idx], target); return; }
    if (targetReal === TMP || isInside(TMP, targetReal)) return;
  } catch { /* the guard must never break the host process */ }
}

/** Patch one module object in place. Absent / frozen members are skipped, not forced. */
function patchModule(mod) {
  if (!mod || typeof mod !== "object") return 0;
  let n = 0;
  for (const fnName of TABLE.keys()) {
    const orig = mod[fnName];
    if (typeof orig !== "function") continue;
    const wrapper = function (...args) { judge(fnName, args); return orig.apply(this, args); };
    try {
      Object.defineProperty(wrapper, "name", { value: fnName, configurable: true });
      Object.defineProperty(wrapper, "length", { value: orig.length, configurable: true });
    } catch { /* cosmetic only */ }
    try { mod[fnName] = wrapper; n++; } catch { /* frozen member — leave it */ }
  }
  return n;
}

const patchedSync = patchModule(fs);
// fs.promises / node:fs/promises are the same object in this Node (measured), so one patch covers
// both spellings — applied here, before any ESM facade for node:fs/promises can be instantiated.
let patchedPromises = 0;
try { patchedPromises = patchModule(fs.promises); } catch { /* ignore */ }

// Record that the guard is alive, and — on the way out — how many write calls it judged, so the
// checker can tell "the guard ran and found nothing" from "the guard never loaded" and can state a
// non-vacuous denominator. 硬规则 3b: a missing guard must not look like a clean run.
recordRaw({ guardLoaded: true, pid: process.pid, patchedSync, patchedPromises, root: ROOT, tmp: TMP });
process.on("exit", () => recordRaw({ judgedTotal: judged, pid: process.pid }));
