// suite-fs-trace-preload.cjs — the runtime file-access tracer for
// gap-suite-bucket-dynamic-truth-drift-detector (phase A: dynamic truth).
//
// Loaded via `node --require suite-fs-trace-preload.cjs <test-file>` (a CJS preload — `--require`
// runs BEFORE the ESM module graph is instantiated, so a `import { spawnSync } from
// "node:child_process"` NAMED import in the test resolves against the patched module.exports; an
// ESM `--import` preload does NOT — measured: the named-import binding snapshots the original).
//
// WHAT IT RECORDS (the ground-truth observation, not a static guess): every repo-file path the test
// actually touches at runtime through
//   - node:fs            readFileSync/readFile/readdirSync/statSync/readlinkSync (reads) and
//                        writeFileSync/writeFile/appendFileSync/appendFile/copyFileSync/mkdirSync/
//                        rmSync/rmdirSync/symlinkSync/chmodSync (writes),
//   - node:child_process spawn/spawnSync/execFile/execFileSync/fork — the command and every argv
//     entry that resolves to a file under the repo root (a `spawnSync("bash",
//     [path.join(pluginDir, "scripts", "quay-init.sh")])` records `plugin/scripts/quay-init.sh`
//     even though `pluginDir` is a VARIABLE the static attribution cannot see).
// Each path is `path.resolve`d against the call's cwd, normalized to repo-relative, and dropped when
// it escapes the repo root or lives under node_modules/.git. Only paths under QUAY_FS_TRACE_ROOT are
// kept, so a worktree's node_modules symlink (→ the main checkout) never pollutes the trace.
//
// ACTIVATION: the tracer is inert unless BOTH env vars are set (the collector sets them per traced
// subprocess, so it can never accidentally instrument a live full-suite process):
//   QUAY_FS_TRACE_FILE  the absolute path to write the per-test trace JSON on process exit
//   QUAY_FS_TRACE_ROOT  the repo root the recorded paths are normalized against
//
// The trace is written on `process.on("exit")` with the ORIGINAL fs (never the patched one) so the
// tracer cannot recurse into itself. Output shape: { testFile, reads: [rel...], writes: [rel...] }.
"use strict";

const path = require("node:path");
const origFs = require("node:fs");
const origCp = require("node:child_process");

const traceFile = process.env.QUAY_FS_TRACE_FILE;
const traceRoot = process.env.QUAY_FS_TRACE_ROOT;

// Inert when not armed (the collector arms only the traced subprocess).
if (!traceFile || !traceRoot) {
  module.exports = {};
} else {
  const rootAbs = path.resolve(traceRoot);
  const reads = new Set();
  const writes = new Set();

  // classify one raw path (absolute or relative-to-cwd) → repo-relative, or null when it escapes the
  // repo root or lives in a dependency/self path. Pure string + path.resolve (no fs syscalls — the
  // path may not exist yet; a test constructing a path to a not-yet-written file still counts as an
  // access of that subject).
  function record(raw, cwd) {
    if (raw == null) return;
    if (typeof raw !== "string") return;
    let p = raw;
    // URL forms (fs accepts file:// URLs) — keep only the pathname.
    if (p.startsWith("file://")) {
      try { p = new URL(p).pathname; } catch { return; }
    }
    if (p === "") return;
    const abs = path.resolve(cwd, p);
    const rel = path.relative(rootAbs, abs);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return; // escapes the repo root
    const segs = rel.split(path.sep);
    if (segs.includes("node_modules") || segs.includes(".git")) return;
    if (rel === path.relative(rootAbs, path.resolve(traceFile))) return; // the tracer's own output
    return rel;
  }

  function recordPathSet(set, raw, cwd) {
    const rel = record(raw, cwd);
    if (rel) set.add(rel);
  }

  // A spawn argv entry is a file PATH only when it carries a directory separator (or is . / ..).
  // Bare argv tokens — git subcommands (`add`/`commit`/`init`), flags (`-b`/`%T`), emails
  // (`test@example.com`), bare binaries (`bash`/`git`/`stat`), config VALUES that happen to collide
  // with a repo-relative bare name (`git config user.name test` while a `test/` dir exists at the
  // repo root) — are NOT file accesses; recording them would pollute the ground truth with argv
  // noise. A path in argv is a path in argv: it has a separator (the blind spot this whole task
  // closes is `path.join(pluginDir, "scripts", "quay-init.sh")`, which always produces one).
  function recordArg(raw, cwd) {
    if (raw == null || typeof raw !== "string") return;
    let p = raw;
    if (p.startsWith("file://")) { try { p = new URL(p).pathname; } catch { return; } }
    if (p === "") return;
    if (!/[\\/]/.test(p) && p !== "." && p !== "..") return; // bare token — not a path
    const rel = record(p, cwd);
    if (rel) reads.add(rel);
  }

  // ── node:fs — patch the read/write surface (originals captured above, so recording never recurses)
  const READ_SYNC = ["readFileSync", "readdirSync", "statSync", "readlinkSync"];
  const WRITE_SYNC = ["writeFileSync", "appendFileSync", "copyFileSync", "mkdirSync", "rmSync", "rmdirSync", "symlinkSync", "chmodSync"];
  const READ_ASYNC = ["readFile", "readdir", "stat", "readlink"];
  const WRITE_ASYNC = ["writeFile", "appendFile", "copyFile", "mkdir", "rm", "rmdir", "symlink", "chmod"];

  for (const name of READ_SYNC) {
    const orig = origFs[name];
    if (typeof orig !== "function") continue;
    origFs[name] = function (p, ...rest) { recordPathSet(reads, p, process.cwd()); return orig.call(this, p, ...rest); };
  }
  for (const name of WRITE_SYNC) {
    const orig = origFs[name];
    if (typeof orig !== "function") continue;
    origFs[name] = function (p, ...rest) { recordPathSet(writes, p, process.cwd()); return orig.call(this, p, ...rest); };
  }
  // Async fs: the path is the FIRST arg and the callback is LAST — record the path, keep the callback.
  for (const name of READ_ASYNC) {
    const orig = origFs[name];
    if (typeof orig !== "function") continue;
    origFs[name] = function (p, ...rest) { recordPathSet(reads, p, process.cwd()); return orig.call(this, p, ...rest); };
  }
  for (const name of WRITE_ASYNC) {
    const orig = origFs[name];
    if (typeof orig !== "function") continue;
    origFs[name] = function (p, ...rest) { recordPathSet(writes, p, process.cwd()); return orig.call(this, p, ...rest); };
  }

  // ── node:child_process — record the command + argv paths (and the option's cwd as the base) ──────
  function patchSpawn(fn) {
    return function (cmd, args, opts) {
      const cwd = (opts && typeof opts === "object" && opts.cwd) ? path.resolve(opts.cwd) : process.cwd();
      recordArg(cmd, cwd);
      if (Array.isArray(args)) for (const a of args) recordArg(a, cwd);
      else if (typeof args === "string") recordArg(args, cwd);
      return fn.apply(this, arguments);
    };
  }
  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "fork"]) {
    const orig = origCp[name];
    if (typeof orig !== "function") continue;
    origCp[name] = patchSpawn(orig);
  }

  const testFile = process.argv[1] ? path.relative(rootAbs, path.resolve(process.argv[1])) : null;

  // Flush on exit with the ORIGINAL fs (the patched one must never write the trace itself).
  process.on("exit", () => {
    try {
      const payload = {
        testFile,
        reads: [...reads].sort(),
        writes: [...writes].sort(),
      };
      const out = path.resolve(traceFile);
      const orig = require("node:fs");
      orig.mkdirSync(path.dirname(out), { recursive: true });
      orig.writeFileSync(out, JSON.stringify(payload) + "\n", "utf8");
    } catch {
      // best-effort — a failed trace write must never alter the traced process's exit code
    }
  });

  module.exports = { record, reads, writes };
}
