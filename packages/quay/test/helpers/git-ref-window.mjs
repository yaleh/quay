// git-ref-window.mjs — packages/quay/test/helpers/
//
// The ONE implementation of the git-graph test family's "frozen ref window"
// (gap-git-graph-live-ref-oracle-siblings-unfrozen). Extracted from the two earlier fixes so the
// family stops re-deriving the same oracle independently — that re-derivation IS how this defect
// reached four files at once.
//
// ── THE RACE ────────────────────────────────────────────────────────────────────────────────────
// A "对拍" judgment compares the data layer (`readGitHistory` → `git log <scope> --topo-order -n N`)
// against a git oracle (`git log --graph` / `%D` / `-1`) over the SAME window. Both sides used to be
// INDEPENDENT LIVE reads of `--all`. Any ref that advances between them shifts the window head by K
// and drops K off the tail ⇒ exactly K mismatches, every one shaped `git=undefined` (a commit the
// oracle no longer sees) or `dropped K` — a window SHIFT, not a rendering/topology bug. This repo's
// loop keeps committing to `develop`/`author` WHILE the suite runs, so `--all`'s stability was an
// assumption these tests never held and production never satisfies. Measured 2026-09-20 08:09:35Z:
// it killed `gap-fan-in-cert-flip-commit-identity-inert`'s fan-in at the scoped gate.
//
// ── THE FIX ─────────────────────────────────────────────────────────────────────────────────────
// snapshotRefWindow() freezes the ref set ONCE into immutable object names; both sides then read
// `git log <those object names>`. A log over immutable objects is a pure function of the object
// database — no live ref is read on either side, so there is no instant at which the two windows can
// disagree. The PRODUCTION read path (`observation.ts`) is UNCHANGED: the frozen list enters through
// its existing `exec` host-read seam (`GitExec`), which exists for exactly this. This is NOT a
// fixture — the real `git` binary reads the real repo; only the START-POINT LIST is pinned.
//
// The frozen list mirrors production's ref SCOPE: `refs/notes/*` is EXCLUDED, because
// `GIT_HISTORY_REF_SCOPE` excludes it. Freezing alone was never enough — a stable window that still
// carries the notes chain is stably WRONG (measured 2026-09-18: 200/200 commits were notes at
// `-n 200`). The scope is read from the same exported constant production uses, never respelled here.
//
// 干跑 (byte-equivalence, this repo, 181 ref object names incl. 18 ANNOTATED tags, 2026-09-20):
//   `git log --exclude=refs/notes/* --all --topo-order -n {5,50,200,500}` ≡ `git log <frozen> …`  ✅
//   `git log --graph --exclude=refs/notes/* --all -n {5,50,200,500}` ≡ `git log --graph <frozen> …` ✅
//   `git log <scope> -1 --pretty=%H` ≡ `git log <frozen> -1 --pretty=%H`                        ✅
// (Annotated tags are peeled by `git log` exactly as `--all` peels them, so `%(objectname)` — the tag
// OBJECT sha — is the correct start point; the equivalence above covers it.)
//
// ── THE SECOND MECHANISM: freezing the ref SET does not freeze %D ───────────────────────────────
// MEASURED, not inferred (2026-09-20, isolated clone + ref churn): over ONE frozen object list, two
// consecutive `git log <frozen> --pretty=%H%x01%D` reads DISAGREE —
//     read 1: `b644776…_churn`      read 2: `b644776…`
// because the churn ref advanced to a commit outside the frozen list, so the commit that HAD the
// decoration lost it. Decorations (`%D`) are computed by git from the LIVE ref table; pinning the
// commit set therefore removes the window-shift class but NOT the decoration class. A decoration
// judgment ("does the rendered label set equal the %D-nonempty set?") is still a live-ref oracle.
//
// There is no way to pin `%D` for two sides without making one side an echo of the other (硬规则 4) or
// reimplementing git's decoration rendering — both forbidden by AC3 ("判据不得退化"). So the residual
// is closed by `withStableWindow()`: it re-takes the WHOLE judgment (both reads) whenever the ref
// mapping moved across it. That never weakens a verdict — a failing judgment whose refs held still is
// reported immediately as the real failure it is; only a verdict taken over a MOVING target is
// discarded and retried, and exhaustion FAILS (fail-closed, 硬规则 3b) rather than silently passing.
//
// ── NEGATIVE CONTROL (硬规则 4 推论三: a judge only fixture/injection satisfies is not a measurement)
// `QUAY_TEST_GIT_GRAPH_LIVE_REFS=1` turns the freeze OFF on BOTH sides of every judgment in the
// family, restoring the pre-fix shape. Under an isolated clone + ref churn that arm must go RED; the
// frozen arm must stay GREEN. Both arms are real readings of the real git binary — the same file, the
// same judge, only the window's stability differs. ⛔ ONE switch, one name, for the whole family —
// never add a second semantically-identical knob.
//
// USAGE — a paired judgment resolves the window ONCE, before either side reads:
//   const refs = resolveRefWindow();
//   const history = readGitHistory(REPO_ROOT, { limit: LIMIT, exec: windowGitExec(refs) });
//   const oracle  = execFileSync("git", ["-C", REPO_ROOT, "log", ...windowScopeArgs(refs), ...]);
// `refs === null` is the live arm; `windowScopeArgs(null)` then yields the production scope verbatim.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GIT_HISTORY_REF_SCOPE, realGitExec } from "../../src/observation.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** This repo's root, from `packages/quay/test/helpers/` — four levels up (test → quay → packages → root). */
export const QUAY_REPO_ROOT = path.resolve(__dirname, "../../../..");

/** The family's single negative-control seam. Unset (default) = frozen; `1` = live `--all` both sides. */
export const LIVE_REFS = process.env.QUAY_TEST_GIT_GRAPH_LIVE_REFS === "1";

/**
 * The repo's ref set frozen into immutable object names, plus a provenance record (which refs, when).
 * Mirrors production's ref scope: `refs/notes/*` excluded (see the header block). HEAD is added
 * explicitly because `--all` includes it while `for-each-ref refs/` does not.
 */
export function snapshotRefWindow(repoRoot = QUAY_REPO_ROOT) {
  const out = execFileSync("git", ["-C", repoRoot, "for-each-ref", "--format=%(objectname)%09%(refname)"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const shas = new Set();
  const refMap = {}; // refname -> objectname, the WHOLE mapping (not just the sha set)
  const heads = [];
  const tags = [];
  for (const line of out.split("\n")) {
    const [sha, ref] = line.split("\t");
    if (!sha || !ref) continue;
    if (ref.startsWith("refs/notes/")) continue;
    shas.add(sha);
    refMap[ref] = sha;
    if (ref.startsWith("refs/heads/")) heads.push(ref);
    else if (ref.startsWith("refs/tags/")) tags.push(ref);
  }
  try {
    const h = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (h) { shas.add(h); refMap["HEAD"] = h; } // `--all` includes HEAD, `for-each-ref refs/` does not
  } catch { /* unborn HEAD — `%D` still marks it when it exists */ }
  return { shas: [...shas].sort(), refCount: shas.size, refMap, heads, tags, at: new Date().toISOString() };
}

/** True iff no ref moved between two snapshots. Used by `withStableWindow` as the "did the target
 *  move while I was judging it" test. Compares the FULL refname→objectname mapping, not the sha SET:
 *  a set misses a ref that moved onto a commit another ref already names (the set is unchanged, but
 *  `%D` on two commits changed). */
export function sameRefMap(a, b) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

/** The window for ONE reading: frozen by default, `null` only under the negative-control seam.
 *  Call this once per judgment and thread the result into both sides — never twice. */
export function resolveRefWindow(repoRoot = QUAY_REPO_ROOT) {
  return LIVE_REFS ? null : snapshotRefWindow(repoRoot);
}

/** Production's own ref-scope argv slice: the frozen object names by default, the live
 *  `GIT_HISTORY_REF_SCOPE` only under the negative-control seam. */
export function windowScopeArgs(refs) {
  return refs ? refs.shas : [...GIT_HISTORY_REF_SCOPE];
}

/** A `GitExec` pinning every `log` invocation to the frozen ref window (⛔ no live `--all`).
 *  Fail-closed: a `log` invocation that does not ask for the `--all` scope THROWS rather than
 *  silently answering a different question (硬规则 3b — a seam that quietly served an unasked-for
 *  window would make the verdict a function of the seam, not of production). Non-`log` invocations
 *  (`rev-parse HEAD`) pass through untouched. */
export function frozenGitExec(repoRoot, shas) {
  return (args, opts = {}) => {
    if (!args.includes("log")) {
      return execFileSync("git", args, { encoding: "utf8", timeout: opts.timeout ?? 15_000, stdio: ["ignore", "pipe", "pipe"] });
    }
    if (!args.includes("--all")) throw new Error(`frozen-window seam got a log invocation with no --all scope: ${args.join(" ")}`);
    return execFileSync("git", args.flatMap((a) => (a === "--all" ? shas : [a])), {
      encoding: "utf8",
      timeout: opts.timeout ?? 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  };
}

/** The `exec` for one reading: the frozen window, or production's own runner under the control seam.
 *  (Passing `realGitExec` verbatim keeps the live arm on production's cached path; an injected exec
 *  is deliberately never memoized — see `readGitHistory`.) */
export function windowGitExec(refs, repoRoot = QUAY_REPO_ROOT) {
  return refs ? frozenGitExec(repoRoot, refs.shas) : realGitExec;
}

/**
 * Run ONE paired judgment over ONE frozen ref window, re-running it while refs are moving.
 *
 * `body(refs)` takes the window ONCE and must read BOTH sides from it (data layer + oracle); it
 * reports failure by throwing (assertions stay inline). Rules:
 *   • body passes              → the verdict stands (both sides agreed over the window they read).
 *   • body throws, refs STILL  → propagate: the failure is real, not an artifact of a moving target.
 *   • body throws, refs MOVED  → retry with a fresh window (a verdict over a moving target is not a
 *                                verdict, and reporting one is how this family produced false reds).
 *   • attempts exhausted       → throw, naming the moving target. NEVER a silent pass.
 * Negative-control arm (`refs === null`, QUAY_TEST_GIT_GRAPH_LIVE_REFS=1): no snapshot exists, so
 * there is nothing to gate on — the body runs exactly once, i.e. the pre-fix shape, single attempt.
 */
export function withStableWindow(body, { maxAttempts = 5, repoRoot = QUAY_REPO_ROOT, label = "ref-window" } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const refs = resolveRefWindow(repoRoot);
    console.log(`[${label}] attempt ${attempt}/${maxAttempts}: ${describeWindow(refs)}`);
    try {
      body(refs);
      return;
    } catch (err) {
      lastErr = err;
      if (!refs) throw err; // live arm: no window to hold still — single attempt, pre-fix shape
      if (sameRefMap(refs.refMap, snapshotRefWindow(repoRoot).refMap)) throw err; // refs held ⇒ real
      console.log(`[${label}] refs moved during the judgment (attempt ${attempt}); retrying`);
    }
  }
  throw new Error(
    `the ref window never held still across ${maxAttempts} attempts — this judgment was taken over a ` +
      `moving target, so no verdict is reportable (last error: ${lastErr && lastErr.message})`,
  );
}

/** One-line provenance for a reading's log/assertion message: WHERE the window comes from and WHEN
 *  it was taken (the two facts that make a window-shift verdict read as such instead of as a bug in
 *  the thing under test). */
export function describeWindow(refs) {
  const where = "packages/quay/test/helpers/git-ref-window.mjs snapshotRefWindow() → windowScopeArgs()/windowGitExec()";
  return refs
    ? `FROZEN at ${refs.at} (${refs.refCount} ref object names); ${where}`
    : `LIVE --all, no snapshot (negative-control seam QUAY_TEST_GIT_GRAPH_LIVE_REFS=1); ${where}`;
}
