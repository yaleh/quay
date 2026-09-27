// tmp-workspace.mjs — shared mkdtemp helper for the test suite.
//
// gap-tmp-leak-is-live-r6-absolves-a-file-for-one-cleanup-call: the /tmp (tmpfs) leak was caused by
// test files that mkdtemp()'d fixture dirs and never removed them. The previous round fixed the then
// top-5 by writing one-off `finally { rmSync(...) }` blocks per site; that only covered the sites
// that were edited, and the hidden partial-cleanup files (a mkdtemp helper whose returned dir no
// caller removes) kept leaking ~1,800 dirs/hour.
//
// THIS helper centralizes the mkdtemp + cleanup pair: every directory it creates is registered with a
// node:test file-level `after()` hook (the same pattern document-store/adr-store adopted) and removed
// automatically at the end of the importing test file. A test that needs a tmp workspace calls
// `makeTmpWorkspace(tag, { nativeBin, nativeProviderDir })` (or `makeTmpDir(tag)`) instead of
// hand-writing `fs.mkdtempSync(...)` + its own cleanup — one cleanup point per file, shared across
// packages (packages/quay, packages/quay-backlog, experiments/...) via a relative import.
//
// The file-level `after()` is registered per importing test file (node --test runs each file in its
// own process), so the tracked-dirs list never crosses file boundaries.
//
// Isolation contract R1: this helper writes only to per-run-unique paths under a WritableTmpRoot it
// selected itself (see below) — never a fixed path under the shared checkout.
//
// ── WritableTmpRoot: why the tmp root is RESOLVED, not read once ─────────────────────────────────
//
// gap-ac233-criterion-not-hermetic-host-quota-false-red: `os.tmpdir()` is a PROXY for "somewhere I
// can write", and on this host it diverges from it. `$TMPDIR` (and `os.tmpdir()`, which just returns
// it) points at `/data/scratch/yale`, whose mount carries `usrquota,prjquota` and whose user quota
// sits at its boundary — so the SAME unmodified tree, seconds apart, produces mkdtemp EDQUOT
// (errno 122) or success. A criterion that reads that proxy turns "the host is out of quota right
// now" into "the deliverable is broken": identical exit code 1, no way downstream to tell them
// apart (硬规则 3b/4c — 恒假, the shape where a CORRECT implementation is judged failed).
//
// So the root is CHOSEN, by a real write probe, from an ordered candidate list:
//
//   1. the ambient env tmp vars ($TMPDIR / $TMP / $TEMP — the user's stated intent),
//   2. `os.tmpdir()` (host API; equals 1 when any env var is set, the platform default otherwise),
//   3. the platform's OWN default tmp root, read from a child node process launched with a scrubbed
//      env — this is "read the host", not a hardcoded `/tmp` literal (硬规则 4 推论二: a literal is a
//      host-dependent constant that becomes a real, SILENT limit on a different machine),
//   4. the user's home cache dir (last resort; may share the quota'd filesystem, hence last).
//
// No candidate is authoritative — each is accepted only after `mkdtempSync` + a real write to it
// succeeded — so a quota-blocked or read-only root is skipped rather than fatal, and the selection
// degrades to whatever IS writable instead of reporting a false red.
//
// When NO candidate is writable the helper does not throw an ordinary Error: an assertion failure
// and "cannot evaluate" would both surface as exit 1, i.e. two different states sharing one output
// byte (硬规则 3b). It exits TMP_ROOT_UNAVAILABLE_EXIT (2) with a TMP_ROOT_UNAVAILABLE marker on
// stderr — a distinguishable "this run could not be evaluated" verdict.

import { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Directories created by this helper, removed once at the end of the importing test file. */
const _created = new Set();

after(() => {
  for (const dir of _created) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort: the dir may already be gone (a test's own cleanup ran first)
    }
  }
  _created.clear();
});

/** Marker on stderr + exit code for "no writable tmp root exists" — deliberately NOT 1, and not a
 * thrown assertion error, so a caller can tell "cannot evaluate" from "the assertion went red". */
export const TMP_ROOT_UNAVAILABLE = "TMP_ROOT_UNAVAILABLE";
export const TMP_ROOT_UNAVAILABLE_EXIT = 2;

/** Raised by `resolveTmpRoot` when every candidate root failed the write probe. Carries the probed
 * candidate list so the failure names what was tried (枚举，不布尔 — a bare "failed" is not a reading). */
export class TmpRootUnavailableError extends Error {
  constructor(candidates) {
    super(
      `${TMP_ROOT_UNAVAILABLE}: no writable temporary root among ${JSON.stringify(candidates)}`
    );
    this.name = "TmpRootUnavailableError";
    this.code = TMP_ROOT_UNAVAILABLE;
    this.candidates = candidates;
  }
}

/** True iff `dir` accepts a real mkdtemp + write right now. A directory that exists but is
 * read-only, quota-blocked, or absent fails here — the probe is the measurement, not a stat(). */
function probeWritable(dir) {
  let made = null;
  try {
    made = fs.mkdtempSync(path.join(dir, ".quay-writable-probe-"));
    fs.writeFileSync(path.join(made, "probe"), "x");
    return true;
  } catch {
    return false;
  } finally {
    if (made !== null) {
      try {
        fs.rmSync(made, { recursive: true, force: true });
      } catch {
        // best-effort: the probe dir is disposable by construction
      }
    }
  }
}

/** The ambient env tmp vars, in the same precedence `os.tmpdir()` uses (TMPDIR, TMP, TEMP). */
function envTmpCandidates() {
  return [process.env.TMPDIR, process.env.TMP, process.env.TEMP];
}

let _hostDefaultTmpRootComputed = false;
let _hostDefaultTmpRoot = null;

/** The platform's own default tmp root — asked of a child node process launched WITHOUT the env tmp
 * vars, so it reports what the host would use absent our override. Reading the host keeps this free
 * of a hardcoded path literal; the answer is cached (and only ever computed when the env-derived
 * candidates all failed the probe, i.e. the pathological path — the normal path never spawns). */
function hostDefaultTmpRoot() {
  if (_hostDefaultTmpRootComputed) return _hostDefaultTmpRoot;
  _hostDefaultTmpRootComputed = true;
  const env = { ...process.env };
  delete env.TMPDIR;
  delete env.TMP;
  delete env.TEMP;
  try {
    const res = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(require('node:os').tmpdir())"],
      { encoding: "utf8", env, timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }
    );
    const out = typeof res.stdout === "string" ? res.stdout.trim() : "";
    _hostDefaultTmpRoot = res.status === 0 && out ? out : null;
  } catch {
    _hostDefaultTmpRoot = null;
  }
  return _hostDefaultTmpRoot;
}

/** Home-derived candidates — deliberately LAST: a home dir frequently lives on the very quota'd
 * filesystem this helper exists to route around. */
function homeTmpCandidates() {
  const out = [];
  try {
    const home = os.homedir();
    if (home) out.push(path.join(home, ".cache"));
  } catch {
    // no home is a fine outcome: the candidate simply does not exist
  }
  return out;
}

/** Normalize a raw candidate list: drop non-strings/empties, dedupe, preserve order. */
function normalizeCandidates(raw) {
  const out = [];
  for (const c of raw) {
    if (typeof c === "string" && c.length > 0 && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * The first writable root among `candidates` (default: the ordered list documented in the header).
 * Throws TmpRootUnavailableError naming every probed candidate when none is writable.
 *
 * Exported so the selection is directly unit-testable with an explicit candidate list — the
 * "preferred root unwritable ⇒ fall back" and "all unwritable ⇒ distinguishable failure" arms do
 * not need a real quota-blocked host. Never construct a hardcoded candidate list in a test to work
 * around a red: fix the probe/ordering here instead (single source of truth).
 */
export function resolveTmpRoot(candidates) {
  const list = normalizeCandidates(
    candidates ?? [
      ...envTmpCandidates(),
      os.tmpdir(),
      hostDefaultTmpRoot(),
      ...homeTmpCandidates(),
    ]
  );
  for (const dir of list) {
    if (probeWritable(dir)) return dir;
  }
  throw new TmpRootUnavailableError(list);
}

let _resolvedRoot = null;

/** The process-wide resolved writable root (probed once, then cached). */
export function writableTmpRoot() {
  if (_resolvedRoot === null) _resolvedRoot = resolveTmpRoot();
  return _resolvedRoot;
}

/** Emit the distinguishable "cannot evaluate" verdict and exit — never exit 1. */
export function tmpRootUnavailableExit(err) {
  const candidates = err && Array.isArray(err.candidates) ? err.candidates : [];
  process.stderr.write(
    `${TMP_ROOT_UNAVAILABLE}: no writable temporary root among ${JSON.stringify(candidates)} — ` +
      `refusing to run. Exit ${TMP_ROOT_UNAVAILABLE_EXIT} means "this run could not be evaluated" ` +
      `and is deliberately distinct from exit 1 ("the assertion under test went red").\n`
  );
  process.exit(TMP_ROOT_UNAVAILABLE_EXIT);
}

/** mkdtemp under the resolved writable root, removed at the end of the test file. */
export function makeTmpDir(tag) {
  let root;
  try {
    root = writableTmpRoot();
  } catch (err) {
    if (err instanceof TmpRootUnavailableError) tmpRootUnavailableExit(err);
    throw err;
  }
  const dir = fs.mkdtempSync(path.join(root, tag));
  _created.add(dir);
  return dir;
}

/**
 * A disposable native-provider workspace: a tasks dir + a workspace root with a `.quay/config.yml`
 * (provider map form with mcp_entry, mirroring gate.test.mjs makeWorkspace()). Both dirs are removed
 * automatically at the end of the test file. Returns { workspaceRoot, tasksDir }.
 *
 * `tag` must be a unique-per-test prefix (e.g. `quay-qeng1-ac1`). `opts` may carry the native
 * package's `nativeBin` / `nativeProviderDir` paths when the tests drive the real CLI; when omitted,
 * only the two dirs + `.quay/` are created (no config.yml).
 */
export function makeTmpWorkspace(tag, { nativeBin, nativeProviderDir } = {}) {
  const tasksDir = makeTmpDir(`${tag}-tasks-`);
  const workspaceRoot = makeTmpDir(`${tag}-ws-`);
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  if (nativeBin && nativeProviderDir) {
    fs.writeFileSync(
      path.join(workspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
        `    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"`,
        `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
        "",
      ].join("\n")
    );
  }
  return { workspaceRoot, tasksDir };
}
