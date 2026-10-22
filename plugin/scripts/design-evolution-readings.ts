#!/usr/bin/env node
// design-evolution-readings.ts — 设计演进读数的 report-only 例行机件 / design-evolution readings.
// (tasks/gap-design-evolution-readings-report-only-routine; DIR-133 裁定 3，2026-10-22)
//
// ── THE QUESTION THIS MAKES ASKABLE ───────────────────────────────────────────────────────────────
// 「扩展点模板」这个元机制到底管不管用？ — measured by two readings that come from OUTSIDE the
// mechanism itself (硬规则 4b: a reading produced by the thing it measures stops updating exactly when
// that thing fails, and looks identical to "all fine"):
//   • RM1 — 分解后子系统增量落回中心文件的占比. `share = centralΔ / (centralΔ + nonCentralΔ)`.
//     A subsystem decomposed behind an extension point should keep NEW code OUT of its central
//     files (measured 1% for serve); one that was only carved out keeps landing there (measured 82%
//     for worker). One formula, both ends read from git.
//   • RM2 — 热点文件的并发争用. Two shapes only, both read from `.quay/worker-outcome.jsonl`:
//     (1) the dispatcher's `selector_reason` names the file AND carries a contention token;
//     (2) the record contains `Merge conflict in <path>` (the raw git merge output).
//     Identities are REPO-RELATIVE paths (worktree roots and checkout roots stripped); a basename is
//     display only, and a path that cannot be mapped is reported in `unresolvedPaths` instead of
//     being folded into some other key.
//
// ── WHY THIS FILE EXISTS AT ALL (the finding it replaces) ─────────────────────────────────────────
// Both readings were ONCE-OFF commands pasted into the body of
// `tasks/gap-design-evolution-meta-mechanism-readings.md` (done). Three things went wrong with them
// THE SAME DAY, all measured:
//   • 口径不一 — serve's and worker's commands used DIFFERENT denominators (worker's dropped the
//     growth of non-central files that already existed at baseline; its baseline was corrected
//     88% → 82%). Re-running the wrong command reproduces the wrong number exactly.
//   • 改路径读空 — serve's central file moved `packages/quay/src/serve-handlers.ts` →
//     `packages/quay/src/serve/serve-handlers.ts`; the old command reads 0 lines on the new tree and
//     computes a meaningless share.
//   • 搬家冒充增长 — two GOAL-909 commits moved 400 lines from worker-driver.ts into worker-pool.ts;
//     the same formula across that window reads 82% → 69%, and the whole drop is the MOVE.
// So: the readings live in a MECHANISM (this file + a declarative routine in `quality-gate-driver`)
// that appends one line per due round to `.quay/design-evolution-history.jsonl`, and they are
// reproducible by whoever reads the line, without remembering a shell incantation.
//
// ── THREE-VALUED, NEVER BOOLEAN (硬规则 3b) ────────────────────────────────────────────────────────
// Both readings can be UNEVALUABLE, and that value is kept distinct from a passing reading:
//   RM1  evaluated:false + reason naming the exact path/condition, `share: null` — ⛔ never 0 and
//        never a share. Triggers: the baseline ref does not resolve; any central file is absent at
//        either end; `centralΔ + nonCentralΔ <= 0`.
//   RM2  evaluated:false when the carrier is missing, when it cannot be parsed, or when the BUILT-IN
//        KNOWN-TRUE sample line fails either predicate (`predicate-selfcheck-failed`). That last one
//        is 硬规则 4 推论二's detection half: a broken predicate must not look like 「零争用」.
// `evaluated:false` lines are APPENDED TOO — a round that could not read must leave a trace, or
// 「没读过」 and 「读过且干净」 are the same history (硬规则 3b).
//
// ── AN ATTACHED READING: ADR-008 phase-declaration staleness ──────────────────────────────────────
// `phaseStaleness` (tasks/gap-adr008-phase-declaration-staleness-reading) rides along in this round's
// record and Fact: commits / new goals / days since `.quay/two-phase-state.json`'s latest declaration.
// It is ATTACHED INFORMATION — the carrier had zero readers, and this is the first. ⛔ It never
// changes `evaluated` (a stale declaration is content, not a failure), ⛔ it is not a gate, ⛔ it is
// not a threshold, and ⛔ nothing switches the phase automatically. The reading is taken by its
// carrier's owner (`phase-declare.ts` `readPhaseStaleness`), not re-implemented here.
//
// ── REPORT ONLY, NEVER A GATE ─────────────────────────────────────────────────────────────────────
// Following `arch-coverage-report.ts` / `arch-cycle-report` (the same family): a non-zero share or a
// non-zero contention count is the reading's CONTENT, ⛔ not `failed`. No ratchet here, and no numeric
// threshold that would auto-judge "is this a move?" (硬规则 4 推论: no thresholds for an unmeasured
// cost structure). Instead every line carries the window's single largest central-file commit AND
// every commit whose central files shrank while a module file grew (`oppositeSignCommits`, a raw sign
// pair, not a classifier) — a move split across several commits is invisible to the single-largest
// field alone (measured: GOAL-909's two commits each stayed below the largest, so the move vanished).
//
// ── SIBLING, NOT DUPLICATE ────────────────────────────────────────────────────────────────────────
// `arch-coverage-report.ts` answers "who analyzed which language"; `arch-cycle-report` answers
// "which directory cycles exist". This one answers "where did new code land, and which files keep
// producing contention". It imports neither and neither imports it.
//
// ── DIRECT ENTRY (for humans / for a one-off reading; the routine is the production path) ─────────
//   node --experimental-strip-types plugin/scripts/design-evolution-readings.ts \
//     [--root <repo>] [--config <section.yml>] [--head <rev>] [--top-n <n>] \
//     [--history <path>] [--no-history] [--json]
// `--config` reads a file whose content IS the `design_evolution_readings` section body
// (`enabled` / `subsystems` / `top_n`) — needed because this repo's `.quay/config.yml` is
// gitignored (`.gitignore:578`): a reading must be reproducible without editing the live config.
// Exit: 0 = record produced and evaluated:true; 3 = record produced but evaluated:false
// (NOT-EVALUATED — a distinct value, ⛔ not "failed"); 4 = the carrier could not be written;
// 2 = usage / input error.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { isDirectEntry } from "./gate-script-base.ts";
import { repoRoot as findRepoRoot } from "./repo-root.ts";
// The ADR-008 phase declaration's OWN staleness (tasks/gap-adr008-phase-declaration-staleness-reading).
// Attached to this round because this routine is already a read-only git reading that lands a
// quality-round Fact — adding a SECOND routine/carrier for one number is the drift the task forbids.
// phase-declare.ts is direct-entry guarded, so importing it never runs its CLI.
import { readPhaseStaleness } from "./phase-declare.ts";
import type { PhaseStalenessReading } from "./phase-declare.ts";

/** The append-only carrier (gitignored; registered in `docs/carrier-registry.json`). */
export const DESIGN_EVOLUTION_HISTORY_REL = path.posix.join(".quay", "design-evolution-history.jsonl");

/** Routine name = the quality-round Fact name and the `.quay/routine-last-run.json` key. */
export const DESIGN_EVOLUTION_ROUTINE_NAME = "design-evolution-readings";

/** Default cadence (minutes). Same rationale as arch-cycle-report: each round is a handful of git
 *  reads (sub-second), while the reading moves with commits — a tighter cadence only lengthens the
 *  carrier without adding information. */
export const DESIGN_EVOLUTION_INTERVAL_MIN_DEFAULT = 360;

/** Declared-interval floor (minutes) — same family bound as arch-cycle-report: a slow variable is not
 *  made more accurate by observing it more often. */
export const DESIGN_EVOLUTION_MIN_INTERVAL_MINUTES = 60;

/** RM2's contention vocabulary — THE ONE EXPORT. ⛔ Never copy this list anywhere else: two copies
 *  drift, and a drifted copy silently changes what counts as contention. */
export const CONTENTION_TOKENS: readonly string[] = Object.freeze([
  "contention",
  "avoid",
  "避开",
  "争用",
  "同样触及",
  "先于",
  "串行",
  "都 touch",
]);

/** How many hit samples each non-zero count carries (task id + time). */
export const CONTENTION_SAMPLE_LIMIT = 3;

/** How many files the RM2 top list carries by default. */
export const CONTENTION_TOP_N_DEFAULT = 10;

/** The worker-outcome ledger RM2 reads. */
export const OUTCOME_CARRIER_REL = path.posix.join(".quay", "worker-outcome.jsonl");

/** Where a subsystem's baseline/head paths may differ (a file that was MOVED). */
export interface CentralFileSpec {
  atBaseline: string;
  atHead: string;
}

export interface SubsystemSpec {
  name: string;
  /** Baseline commit (any rev). The window is `baseline..head`. */
  baseline: string;
  /** Right end of the window; default `HEAD`. Pinning it is what makes a historical reading
   *  reproducible (AC2 reads worker at `ff32d031d`, not at today's HEAD). */
  head?: string;
  central: CentralFileSpec[];
  modules: string[];
}

// ── git helpers（本文件的 git 读取只有这一层：失败必须是可区分的取值，⛔ 不是空字符串）─────────────

interface GitRead {
  ok: boolean;
  stdout: string;
  error: string | null;
}

/** Run git in `root`. A failed invocation is a VALUE (`ok:false`), never an exception and never a
 *  silently-empty stdout — hard rule 3b: 「读不懂」 must not share a shape with 「读到空」. */
function gitRead(root: string, args: string[]): GitRead {
  try {
    const stdout = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout, error: null };
  } catch (e) {
    const err = e as { stderr?: unknown; status?: unknown; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    // A quiet git failure (e.g. `rev-parse --quiet` on an unknown ref) has EMPTY stderr; the raw
    // exec message ("Command failed: git -C …") names the whole command line, which then lands in a
    // carrier line as noise. Prefer stderr, then a short status, then the message.
    const short =
      stderr !== ""
        ? stderr
        : typeof err.status === "number"
          ? `git ${args[0]} exited ${err.status}`
          : err.message || String(e);
    return { ok: false, stdout: "", error: short };
  }
}

/** `git rev-parse <rev>^{commit}` — null when the ref does not resolve (⛔ never the literal ref). */
export function resolveCommit(root: string, rev: string): { sha: string | null; error: string | null } {
  const r = gitRead(root, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  if (!r.ok || r.stdout.trim() === "") {
    return { sha: null, error: r.error ?? `'${rev}' does not resolve to a commit` };
  }
  return { sha: r.stdout.trim(), error: null };
}

/** One glob per module pattern: `**` crosses directories, `*` does not, `?` is one non-slash char.
 *  ⛔ Not minimatch — deliberately small and dependency-free, and its semantics are stated here so a
 *  reader can re-derive a reading from the declaration. */
export function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("\\^$+.|()[]{}".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(out + "$");
}

/** All tracked paths at `rev`, or null when the tree cannot be listed (⛔ not `[]`). */
export function listTrackedPaths(root: string, rev: string): string[] | null {
  const r = gitRead(root, ["ls-tree", "-r", "--name-only", "-z", rev]);
  if (!r.ok) return null;
  return r.stdout.split("\0").filter((p) => p !== "");
}

// ── Path identity: every observation is keyed by a REPO-RELATIVE path ─────────────────────────────
//
// WHY THIS EXISTS (task gap-design-evolution-readings-path-identity-and-split-move, 2026-10-22):
// the first production RM2 record aggregated by BASENAME (`split("/").pop()`), so
//   • two unrelated files called `index.ts` in different directories became ONE key, and
//   • one file spelled three ways (`worker-driver.ts`, `plugin/scripts/worker-driver.ts`,
//     `///home/yale/work/quay-worktrees/<task>/plugin/scripts/worker-driver.ts`) became THREE keys —
//     the first record's `observedPaths` was a list of worktree absolute paths, i.e. not a
//     repo-relative identity a reader can re-check against the tree (硬规则 4b: prefer the direct
//     quantity, not a lossy projection of it).
// So: strip a worktree root (`<…>/quay-worktrees/<task-id>/`), strip a known checkout root, strip
// redundant leading slashes, and key on what remains. A bare basename carries no directory identity
// and is resolved against the repo's tracked paths; when that is ambiguous or impossible, the token
// goes to `unresolvedPaths` — ⛔ never merged into some other key (硬规则 3b: 「读不懂」 must not
// share a shape with 「读到了」).

/** `<anything>/quay-worktrees/<task-id>/<repo-relative>` → `<repo-relative>` (null when absent). */
export function stripWorktreePrefix(p: string): string | null {
  const m = /(?:^|\/)quay-worktrees\/[^/]+\/(.+)$/.exec(p);
  return m === null ? null : m[1];
}

export interface PathIdentity {
  /** The repo-relative path, or null when the token cannot be mapped (then `reason` names why). */
  rel: string | null;
  reason: string | null;
}

export interface PathIdentityResolver {
  /** Map ONE observed path token to a repo-relative path (or a named refusal). */
  resolve(raw: string): PathIdentity;
  /** Tracked paths available for bare-name disambiguation; null when no index could be read. */
  indexSize: number | null;
}

/** Absolute spellings of `root` (the path itself and its realpath). A checkout reached through a
 *  symlinked parent has more than one spelling, and the carrier contains both. */
function rootSpellings(root: string): string[] {
  const abs = path.resolve(root);
  const out = new Set<string>();
  const push = (p: string) => {
    const stripped = p.replace(/\/+$/, "").replace(/^\/+/, "");
    if (stripped !== "") out.add(stripped);
  };
  push(abs);
  try {
    push(fs.realpathSync(abs));
  } catch {
    // A root that cannot be realpath'd still has its literal spelling.
  }
  return [...out];
}

/** Build the token → repo-relative-path mapper used by RM2.
 *
 *  `repoPaths` (test seam) OVERRIDES the index; passing `null` declares "no index available". When
 *  absent the index is `git ls-tree -r HEAD` in `root` — the real reading always has it, and a
 *  fixture without git simply keeps a bare token as its literal spelling (never as another file). */
export function createPathIdentityResolver(
  root: string,
  opts: { repoPaths?: readonly string[] | null } = {},
): PathIdentityResolver {
  const roots = rootSpellings(root);
  const index: readonly string[] | null =
    opts.repoPaths !== undefined ? opts.repoPaths : listTrackedPaths(root, "HEAD");
  const byBasename = new Map<string, string[]>();
  const tracked = index === null ? null : new Set(index);
  if (index !== null) {
    for (const p of index) {
      const b = path.posix.basename(p);
      const arr = byBasename.get(b);
      if (arr === undefined) byBasename.set(b, [p]);
      else arr.push(p);
    }
  }

  const resolve = (rawInput: string): PathIdentity => {
    const raw = rawInput.trim();
    if (raw === "") return { rel: null, reason: "empty-path-token" };
    const p = raw.replace(/^(\.\/)+/, "");

    // A worktree path is the same file as the main checkout's — strip it BEFORE anything else, so the
    // absolute/relative distinction below never sees `quay-worktrees` as a repo directory.
    const wt = stripWorktreePrefix(p);
    if (wt !== null) {
      const rel = wt.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
      return rel === "" ? { rel: null, reason: `empty-after-worktree-prefix: ${raw}` } : { rel, reason: null };
    }

    if (p.startsWith("/")) {
      const stripped = p.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
      for (const rootRel of roots) {
        if (stripped === rootRel) return { rel: null, reason: `points-at-repo-root: ${raw}` };
        if (stripped.startsWith(rootRel + "/")) return { rel: stripped.slice(rootRel.length + 1), reason: null };
      }
      // NOT under a known root — but another checkout of THIS repo is still this repo. Take the
      // longest suffix that is a tracked path, so an alternate/symlinked checkout spelling
      // (`/home/…/quay/plugin/scripts/x.ts` next to `/data/…/quay/…`) identifies the same file. The
      // tracked index is the authority here; ⛔ no guess beyond "this exact path exists in the tree".
      if (tracked !== null) {
        const segs = stripped.split("/");
        for (let i = 0; i < segs.length; i++) {
          const candidate = segs.slice(i).join("/");
          if (tracked.has(candidate)) return { rel: candidate, reason: null };
        }
      }
      return { rel: null, reason: `absolute-path-outside-repo: ${raw}` };
    }

    if (!p.includes("/")) {
      // A bare basename carries no identity. Only the index can say WHICH file it names.
      if (index === null) return { rel: p, reason: null };
      const matches = byBasename.get(p) ?? [];
      if (matches.length === 1) return { rel: matches[0], reason: null };
      if (matches.length === 0) return { rel: p, reason: null }; // possibly a since-deleted file
      const named = matches.slice(0, 3).join(", ") + (matches.length > 3 ? ", …" : "");
      return { rel: null, reason: `ambiguous-bare-name: ${raw} matches ${matches.length} repo paths (${named})` };
    }
    return { rel: p.replace(/\/{2,}/g, "/").replace(/\/+$/, ""), reason: null };
  };

  return { resolve, indexSize: index === null ? null : index.length };
}

/** Line count of `relPath` at `rev` — `wc -l` semantics (newline count), the same caliber the
 *  finding used. Returns null ONLY when the file is absent at that rev; a git failure while the file
 *  is present throws up as `{lines:null, error}` so the caller can tell the two apart. */
export function lineCountAt(
  root: string,
  rev: string,
  relPath: string,
  presentPaths: ReadonlySet<string> | null,
): { lines: number | null; error: string | null } {
  if (presentPaths !== null && !presentPaths.has(relPath)) return { lines: null, error: null };
  const r = gitRead(root, ["show", `${rev}:${relPath}`]);
  if (!r.ok) return { lines: null, error: r.error ?? "git show failed" };
  return { lines: (r.stdout.match(/\n/g) ?? []).length, error: null };
}

// ── RM1 ────────────────────────────────────────────────────────────────────────────────────────────

export interface CentralFileReading {
  atBaseline: string;
  atHead: string;
  baselineLines: number;
  headLines: number;
  delta: number;
}

export interface MaxCentralChangeCommit {
  sha: string;
  /** Net line delta of the subsystem's central files in THIS commit. */
  centralDelta: number;
  /** Net line delta of the subsystem's non-central module files in THIS commit. */
  nonCentralDelta: number;
}

/** A commit that SHRANK the central files while GROWING a module file — the signature of a move.
 *  ⛔ No threshold and no classifier: the predicate is the raw sign pair, and every match is listed
 *  (task gap-design-evolution-readings-path-identity-and-split-move 缺陷 3: a move split across
 *  commits never wins 「single largest |centralΔ|」, so it was invisible). */
export interface OppositeSignCommit {
  sha: string;
  centralDelta: number;
  nonCentralDelta: number;
  /** First line of the commit message (which commit did the moving). */
  subject: string;
}

export interface SubsystemReading {
  name: string;
  evaluated: boolean;
  /** null when evaluated; otherwise NAMES the exact path/condition (硬规则 3b). */
  reason: string | null;
  baseline: string;
  head: string;
  baselineSha: string | null;
  headSha: string | null;
  central: CentralFileSpec[];
  modules: string[];
  /** `centralΔ`, `nonCentralΔ`, their sum, and the share — ALL null when not evaluated. */
  centralDelta: number | null;
  nonCentralDelta: number | null;
  denominator: number | null;
  share: number | null;
  /** `share * 100` at 2 decimals; null when not evaluated. ⛔ Never 0 for an unevaluable window. */
  sharePercent: number | null;
  /** `Math.round(share * 100)` — the integer the finding's tables quote (1 / 82). */
  sharePercentRounded: number | null;
  centralFiles: CentralFileReading[];
  /** How many module files the window covers (present at either end). */
  moduleFileCount: number | null;
  /** Module files that exist ONLY at head (created inside the window). */
  newModuleFiles: string[] | null;
  /** The single commit with the largest |centralΔ| inside the window (a MOVE shows up here). ⛔ No
   *  classifier decides "this is a move" (硬规则 4 推论) — the raw commit is put in front of the
   *  reader. */
  maxCentralChangeCommit: MaxCentralChangeCommit | null;
  /** EVERY commit in the window with `centralΔ < 0 && nonCentralΔ > 0` — a move split across several
   *  commits is invisible to the single-largest field above (缺陷 3). Empty list = none; null = the
   *  git read failed (⛔ never conflated with 「没有搬家」). */
  oppositeSignCommits: OppositeSignCommit[] | null;
}

/** `share` (0..1) → percent, rounded to 2 decimals. ⛔ Never applied twice — a double ×100 reads
 *  `129.69%` for a `1.3%` share, which is exactly the kind of plausible-looking wrong number this
 *  file exists to prevent. */
const pct = (share: number) => Math.round(share * 100 * 100) / 100;

/** Measure ONE subsystem over `baseline..head`. Pure git reads; never throws.
 *
 *  THE ONE FORMULA: `share = centralΔ / (centralΔ + nonCentralΔ)`.
 *    centralΔ    = Σ over central files of (lines@head − lines@baseline), each end read at ITS OWN
 *                  path (a moved central file is declared with both paths).
 *    nonCentralΔ = Σ over every other module file (present at baseline OR head, matching `modules`,
 *                  NEW files included) of the same difference, with 0 for the end it is absent at.
 *  Three-valued (硬规则 3b): an unresolvable baseline/head, a central path absent at either end, or a
 *  non-positive denominator all yield `evaluated:false` with a reason naming the exact cause, and
 *  every numeric field stays null. */
export function measureSubsystem(
  root: string,
  spec: SubsystemSpec,
  opts: { head?: string } = {},
): SubsystemReading {
  const headRef = opts.head ?? spec.head ?? "HEAD";
  const base: SubsystemReading = {
    name: spec.name,
    evaluated: false,
    reason: null,
    baseline: spec.baseline,
    head: headRef,
    baselineSha: null,
    headSha: null,
    central: spec.central,
    modules: spec.modules,
    centralDelta: null,
    nonCentralDelta: null,
    denominator: null,
    share: null,
    sharePercent: null,
    sharePercentRounded: null,
    centralFiles: [],
    moduleFileCount: null,
    newModuleFiles: null,
    maxCentralChangeCommit: null,
    oppositeSignCommits: null,
  };
  const unevaluated = (reason: string, extra: Partial<SubsystemReading> = {}): SubsystemReading => ({
    ...base,
    ...extra,
    evaluated: false,
    reason,
  });

  const head = resolveCommit(root, headRef);
  const baseline = resolveCommit(root, spec.baseline);
  // The two ends are resolved BEFORE anything else so a bad ref is reported as exactly that.
  const shas = { baselineSha: baseline.sha, headSha: head.sha };
  if (baseline.sha === null) return unevaluated(`baseline-unresolvable: ${spec.baseline} — ${baseline.error ?? "does not resolve"}`, shas);
  if (head.sha === null) return unevaluated(`head-unresolvable: ${headRef} — ${head.error ?? "does not resolve"}`, shas);

  const baselinePaths = listTrackedPaths(root, baseline.sha);
  if (baselinePaths === null) return unevaluated(`baseline-tree-unreadable: git ls-tree failed at ${baseline.sha}`, shas);
  const headPaths = listTrackedPaths(root, head.sha);
  if (headPaths === null) return unevaluated(`head-tree-unreadable: git ls-tree failed at ${head.sha}`, shas);
  const baseSet = new Set(baselinePaths);
  const headSet = new Set(headPaths);

  const moduleRes = spec.modules.map(globToRegExp);
  const matchesModules = (p: string) => moduleRes.some((re) => re.test(p));

  const moduleFiles = [...new Set([...baselinePaths, ...headPaths])].filter(matchesModules).sort();
  const newModuleFiles = moduleFiles.filter((p) => !baseSet.has(p) && headSet.has(p));

  // CENTRAL — each file is read at its OWN path at each end. A missing end is NOT 0: it means the
  // declared path no longer describes the window (the exact failure the finding hit when serve's
  // central file moved), so the whole subsystem becomes NOT-EVALUATED and names the path.
  const centralPaths = new Set<string>();
  const centralFiles: CentralFileReading[] = [];
  let centralDelta = 0;
  for (const c of spec.central) {
    centralPaths.add(c.atBaseline);
    centralPaths.add(c.atHead);
    const atBase = lineCountAt(root, baseline.sha, c.atBaseline, baseSet);
    if (atBase.lines === null) {
      return unevaluated(
        atBase.error !== null
          ? `central-unreadable-at-baseline: ${c.atBaseline} — ${atBase.error}`
          : `central-absent-at-baseline: ${c.atBaseline} (declared central path does not exist at ${spec.baseline})`,
        { ...shas, moduleFileCount: moduleFiles.length, newModuleFiles },
      );
    }
    const atHead = lineCountAt(root, head.sha, c.atHead, headSet);
    if (atHead.lines === null) {
      return unevaluated(
        atHead.error !== null
          ? `central-unreadable-at-head: ${c.atHead} — ${atHead.error}`
          : `central-absent-at-head: ${c.atHead} (declared central path does not exist at ${headRef})`,
        { ...shas, moduleFileCount: moduleFiles.length, newModuleFiles },
      );
    }
    const delta = atHead.lines - atBase.lines;
    centralDelta += delta;
    centralFiles.push({ atBaseline: c.atBaseline, atHead: c.atHead, baselineLines: atBase.lines, headLines: atHead.lines, delta });
  }

  let nonCentralDelta = 0;
  for (const p of moduleFiles) {
    if (centralPaths.has(p)) continue;
    const b = lineCountAt(root, baseline.sha, p, baseSet);
    if (b.error !== null) return unevaluated(`module-unreadable-at-baseline: ${p} — ${b.error}`, { ...shas, moduleFileCount: moduleFiles.length, newModuleFiles });
    const h = lineCountAt(root, head.sha, p, headSet);
    if (h.error !== null) return unevaluated(`module-unreadable-at-head: ${p} — ${h.error}`, { ...shas, moduleFileCount: moduleFiles.length, newModuleFiles });
    nonCentralDelta += (h.lines ?? 0) - (b.lines ?? 0);
  }

  // The commit-level view is RAW GIT HISTORY: it stays readable even when the share itself is
  // not-evaluated (a non-positive denominator must not also erase the moves that produced it).
  // `--no-renames` keeps the per-commit paths literal (with rename detection a moved file appears as
  // `old => new`, which matches neither declared path and would silently read 0). Merge commits
  // contribute no numstat by git's default — the changes are counted on the commits that actually
  // carry them, which is what we want.
  const commitStats = readCommitStats(
    root,
    baseline.sha,
    head.sha,
    centralPaths,
    matchesModules,
    [...new Set([...centralPaths, ...spec.modules])],
  );
  const maxCentralChangeCommit = pickLargestCentralChange(commitStats);
  const opposite = pickOppositeSignCommits(commitStats);

  const denominator = centralDelta + nonCentralDelta;
  if (denominator <= 0) {
    return unevaluated(
      `non-positive-denominator: centralΔ=${centralDelta} nonCentralΔ=${nonCentralDelta} (sum ${denominator}) — a share of a non-growing subsystem is not a reading`,
      { ...shas, centralFiles, moduleFileCount: moduleFiles.length, newModuleFiles, maxCentralChangeCommit, oppositeSignCommits: opposite },
    );
  }
  const share = centralDelta / denominator;

  return {
    ...base,
    ...shas,
    evaluated: true,
    reason: null,
    centralDelta,
    nonCentralDelta,
    denominator,
    share,
    sharePercent: pct(share),
    sharePercentRounded: Math.round(share * 100),
    centralFiles,
    moduleFileCount: moduleFiles.length,
    newModuleFiles,
    maxCentralChangeCommit,
    oppositeSignCommits: opposite,
  };
}

interface CommitStat {
  sha: string;
  subject: string;
  centralDelta: number;
  nonCentralDelta: number;
}

/** Per-commit net line deltas via `git log --numstat --no-renames`, newest first.
 *  Returns null when the git read fails — ⛔ never `[]` (「读不懂」 must not look like 「没有提交」). */
function readCommitStats(
  root: string,
  baseSha: string,
  headSha: string,
  centralPaths: ReadonlySet<string>,
  matchesModules: (p: string) => boolean,
  pathFilter: string[] = [],
): CommitStat[] | null {
  // The pathspec is a SUPERSET filter (git's `*` crosses `/`, ours does not), so it can only remove
  // rows we would have ignored anyway — it keeps `--numstat` from streaming every file of every
  // commit in a months-long window.
  const spec = pathFilter.length > 0 ? ["--", ...pathFilter] : [];
  const r = gitRead(root, ["log", "--numstat", "--no-renames", "--format=%x00%H%x1f%s", `${baseSha}..${headSha}`, ...spec]);
  if (!r.ok) return null;
  const out: CommitStat[] = [];
  for (const chunk of r.stdout.split("\0")) {
    const lines = chunk.split("\n");
    const header = lines.shift() ?? "";
    const sep = header.indexOf("\x1f");
    const sha = (sep === -1 ? header : header.slice(0, sep)).trim();
    if (sha === "") continue;
    const subject = sep === -1 ? "" : header.slice(sep + 1).trim();
    let centralDelta = 0;
    let nonCentralDelta = 0;
    for (const row of lines) {
      if (row === "") continue;
      const [ins, del, file] = row.split("\t");
      if (!file || ins === "-" || del === "-") continue; // binary: no line caliber
      const delta = Number(ins) - Number(del);
      if (!Number.isFinite(delta)) continue;
      if (centralPaths.has(file)) centralDelta += delta;
      else if (matchesModules(file)) nonCentralDelta += delta;
    }
    out.push({ sha, subject, centralDelta, nonCentralDelta });
  }
  return out;
}

function pickLargestCentralChange(stats: CommitStat[] | null): MaxCentralChangeCommit | null {
  if (stats === null) return null;
  let best: MaxCentralChangeCommit | null = null;
  for (const s of stats) {
    if (best === null || Math.abs(s.centralDelta) > Math.abs(best.centralDelta)) {
      best = { sha: s.sha, centralDelta: s.centralDelta, nonCentralDelta: s.nonCentralDelta };
    }
  }
  return best;
}

/** EVERY commit whose central files shrank while a module file grew — no threshold, so a move split
 *  across commits is listed in full (缺陷 3). `[]` = none; `null` = the git read failed. */
function pickOppositeSignCommits(stats: CommitStat[] | null): OppositeSignCommit[] | null {
  if (stats === null) return null;
  return stats
    .filter((s) => s.centralDelta < 0 && s.nonCentralDelta > 0)
    .map((s) => ({ sha: s.sha, centralDelta: s.centralDelta, nonCentralDelta: s.nonCentralDelta, subject: s.subject }));
}

/** The single largest-|centralΔ| commit in the window. Exported for the test seam; never throws (a
 *  git failure yields null — the reading itself is still valid, only this auxiliary field is not). */
export function largestCentralChangeCommit(
  root: string,
  baseSha: string,
  headSha: string,
  centralPaths: ReadonlySet<string>,
  matchesModules: (p: string) => boolean,
  pathFilter: string[] = [],
): MaxCentralChangeCommit | null {
  return pickLargestCentralChange(readCommitStats(root, baseSha, headSha, centralPaths, matchesModules, pathFilter));
}

/** Every central-shrinking / module-growing commit in the window. Exported for the test seam. */
export function oppositeSignCommits(
  root: string,
  baseSha: string,
  headSha: string,
  centralPaths: ReadonlySet<string>,
  matchesModules: (p: string) => boolean,
  pathFilter: string[] = [],
): OppositeSignCommit[] | null {
  return pickOppositeSignCommits(readCommitStats(root, baseSha, headSha, centralPaths, matchesModules, pathFilter));
}

// ── RM2 ────────────────────────────────────────────────────────────────────────────────────────────

/** A path-looking token. Deliberately extension-anchored: prose mentions of a symbol are not files.
 *  ⚠️ The alternatives are ordered LONGEST-FIRST and the match must end on a word boundary: JS regex
 *  alternation is first-match, so `js|json` would turn `foo.baseline.json` into `foo.baseline.js`
 *  and then no key could ever be found for it — that is exactly why the FIRST production record
 *  reported a form-2 count with an EMPTY `observedPaths` (task ...-path-identity-and-split-move
 *  缺陷 2: the count had no provenance because the extension was silently truncated). */
const PATH_TOKEN_RE =
  /[A-Za-z0-9_./-]+\.(?:jsonl|json|tsx|mts|cts|ts|mjs|cjs|js|yaml|yml|sh|md|py|toml)\b/g;
const MERGE_CONFLICT_RE = /Merge conflict in ([^\s\\"']+)/g;

/** The two RM2 predicates, injectable ONLY so a test can break them (AC4's negative control). The
 *  built-in self-check runs the SAME injected pair, so a broken predicate turns the reading into
 *  `evaluated:false` instead of 「零争用」. */
export interface ContentionPredicates {
  /** Form 1: files named in `selector_reason` when that string also carries a contention token. */
  form1Files: (record: Record<string, unknown>) => string[];
  /** Form 2: files whose `Merge conflict in <path>` appears anywhere in the record. */
  form2Files: (record: Record<string, unknown>) => string[];
}

/** Every string in a JSON value (depth-first). */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

/** The path tokens in `text` AS SPELLED (deduped, order preserved). ⛔ The predicates must NOT fold
 *  to basenames here: identity is decided in ONE place (`createPathIdentityResolver`), which knows
 *  the repo roots and the tracked-file index. Folding here is what merged two `index.ts` and split
 *  one `worker-driver.ts` into three keys (缺陷 1). */
export function pathTokens(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.match(PATH_TOKEN_RE) ?? []) {
    const t = m.replace(/^(\.\/)+/, "");
    if (t !== "") seen.add(t);
  }
  return [...seen];
}

export const DEFAULT_CONTENTION_PREDICATES: ContentionPredicates = {
  form1Files(record) {
    const reason = record["selector_reason"];
    if (typeof reason !== "string" || reason === "") return [];
    if (!CONTENTION_TOKENS.some((t) => reason.includes(t))) return [];
    return pathTokens(reason);
  },
  form2Files(record) {
    const files = new Set<string>();
    for (const s of collectStrings(record)) {
      for (const m of s.matchAll(MERGE_CONFLICT_RE)) {
        const p = m[1].replace(/^(\.\/)+/, "");
        if (p !== "") files.add(p);
      }
    }
    return [...files];
  },
};

/** The BUILT-IN KNOWN-TRUE sample (硬规则 4 推论二 的检测半边). It carries BOTH shapes against one
 *  fake path, and that path exists nowhere in the repo, so a hit can only come from the predicate
 *  actually working. */
export const PREDICATE_SELFCHECK_SAMPLE: Record<string, unknown> = Object.freeze({
  task: "predicate-selfcheck-sample",
  ts: "1970-01-01T00:00:00.000Z",
  selector_reason:
    "内置已知为真的样本行：避开 plugin/scripts/design-evolution-selfcheck.ts 的争用（predicate self-check, not a real dispatch）",
  mechanical_fan_in: {
    reason:
      "Auto-merging plugin/scripts/design-evolution-selfcheck.ts\nCONFLICT (content): Merge conflict in plugin/scripts/design-evolution-selfcheck.ts",
  },
});
/** Both shapes spell the sample the SAME way, because identity is now the full repo-relative path
 *  (a bare basename would need the index — and the self-check must not depend on one). */
export const PREDICATE_SELFCHECK_PATH = "plugin/scripts/design-evolution-selfcheck.ts";

export interface ContentionSample {
  task: string | null;
  ts: string | null;
  recordIndex: number;
}

export interface ContentionFileReading {
  /** THE KEY: a repo-relative path. ⛔ Not a basename — two different files that happen to share one
   *  must not merge (缺陷 1). */
  file: string;
  /** `basename(file)`, carried for display only. */
  basename: string;
  form1: number;
  form2: number;
  total: number;
  windowForm1: number;
  windowForm2: number;
  windowTotal: number;
  samples: { form1: ContentionSample[]; form2: ContentionSample[] };
  /** The repo-relative spellings observed for this key (every raw spelling is normalized first, so a
   *  worktree absolute path never appears here). ⛔ Always non-empty: a count with no provenance is
   *  not checkable by its reader (缺陷 2 / 硬规则 3b). */
  observedPaths: string[];
}

/** A path token that could not be mapped to a repo-relative path. Reported SEPARATELY — ⛔ never
 *  folded into some other key, and never silently dropped. */
export interface UnresolvedPath {
  raw: string;
  reason: string;
}

export interface ContentionReading {
  evaluated: boolean;
  reason: string | null;
  carrierPath: string;
  carrierExists: boolean;
  carrierRecords: number | null;
  /** Records with index < windowStartIndex are NOT counted in the `window*` fields. */
  windowStartIndex: number;
  windowSource: "previous-record" | "no-previous-record" | "previous-record-unusable";
  topN: number;
  /** Whether a tracked-file index was available to disambiguate BARE basenames. Without one a bare
   *  name keeps its literal spelling (it is not merged into another file's key either way). */
  pathIndex: { available: boolean; files: number | null };
  predicateSelfCheck: { ok: boolean; form1: boolean; form2: boolean };
  /** Paths that named a contention hot file but could not be mapped to a repo-relative path. */
  unresolvedPaths: UnresolvedPath[];
  files: ContentionFileReading[];
}

export interface ContentionOptions {
  carrierPath?: string;
  topN?: number;
  /** `previousRecord.carrierRecords` from the last history line; absent ⇒ the window is the whole
   *  carrier (there is no earlier line to start from). */
  windowStartIndex?: number;
  windowSource?: ContentionReading["windowSource"];
  predicates?: ContentionPredicates;
  /** Test seam: the tracked-path index for bare-name disambiguation. `null` = "no index". Omitted ⇒
   *  read `git ls-tree -r HEAD` in `root`. */
  repoPaths?: readonly string[] | null;
  /** Test seam: supply the whole resolver (overrides `repoPaths`). */
  resolver?: PathIdentityResolver;
}

/** Scan the worker-outcome ledger for the two contention shapes. Never throws.
 *
 *  Counts are per RECORD, not per occurrence: one dispatch log quoting the same `Merge conflict in X`
 *  twice in two fields is ONE conflict (measured: three records on 2026-08-29/30 carry the text in
 *  both `mechanical_fan_in.reason` and a nested log, and counting occurrences inflated 6 → 9). */
export function scanContention(root: string, opts: ContentionOptions = {}): ContentionReading {
  const carrierPath = opts.carrierPath
    ? path.resolve(opts.carrierPath)
    : path.join(path.resolve(root), OUTCOME_CARRIER_REL);
  const topN = opts.topN ?? CONTENTION_TOP_N_DEFAULT;
  const predicates = opts.predicates ?? DEFAULT_CONTENTION_PREDICATES;
  const windowStartIndex = opts.windowStartIndex ?? 0;
  const windowSource = opts.windowSource ?? "no-previous-record";
  const resolver =
    opts.resolver ??
    createPathIdentityResolver(path.resolve(root), opts.repoPaths !== undefined ? { repoPaths: opts.repoPaths } : {});
  const pathIndex = { available: resolver.indexSize !== null, files: resolver.indexSize };

  // THE SELF-CHECK RUNS FIRST — before the carrier is read, so a broken predicate can never be
  // reported as "zero contention". Both shapes must hit the built-in sample.
  const form1Self = predicates.form1Files(PREDICATE_SELFCHECK_SAMPLE).includes(PREDICATE_SELFCHECK_PATH);
  const form2Self = predicates.form2Files(PREDICATE_SELFCHECK_SAMPLE).includes(PREDICATE_SELFCHECK_PATH);
  const predicateSelfCheck = { ok: form1Self && form2Self, form1: form1Self, form2: form2Self };
  if (!predicateSelfCheck.ok) {
    const broken = [!form1Self ? "form1" : null, !form2Self ? "form2" : null].filter(Boolean).join("+");
    return {
      evaluated: false,
      reason: `predicate-selfcheck-failed: ${broken} did not match the built-in known-true sample (${PREDICATE_SELFCHECK_PATH}) — 「谓词坏了」 must not look like 「零争用」`,
      carrierPath,
      carrierExists: fs.existsSync(carrierPath),
      carrierRecords: null,
      windowStartIndex,
      windowSource,
      topN,
      pathIndex,
      predicateSelfCheck,
      unresolvedPaths: [],
      files: [],
    };
  }

  let text: string;
  try {
    text = fs.readFileSync(carrierPath, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return {
      evaluated: false,
      reason: code === "ENOENT"
        ? `carrier-missing: ${carrierPath} (no dispatch has been logged yet — this is NOT 「零争用」)`
        : `carrier-unreadable: ${carrierPath} — ${(e as Error).message}`,
      carrierPath,
      carrierExists: false,
      carrierRecords: null,
      windowStartIndex,
      windowSource,
      topN,
      pathIndex,
      predicateSelfCheck,
      unresolvedPaths: [],
      files: [],
    };
  }

  const rows: Record<string, unknown>[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) rows.push(parsed as Record<string, unknown>);
      else malformed++;
    } catch {
      malformed++;
    }
  }

  interface Agg {
    form1: number;
    form2: number;
    windowForm1: number;
    windowForm2: number;
    samples: { form1: ContentionSample[]; form2: ContentionSample[] };
    observedPaths: Set<string>;
  }
  const agg = new Map<string, Agg>();
  const touch = (file: string, record: Record<string, unknown>, index: number, form: "form1" | "form2") => {
    let a = agg.get(file);
    if (a === undefined) {
      a = { form1: 0, form2: 0, windowForm1: 0, windowForm2: 0, samples: { form1: [], form2: [] }, observedPaths: new Set() };
      agg.set(file, a);
    }
    // A count ALWAYS carries its own provenance: the repo-relative key itself is the path a reader
    // can go and check. (The provenance pass below can only see tokens the extension regex
    // recognises; a hit like `Merge conflict in .gitignore` has no extension, and used to leave the
    // count with an EMPTY observedPaths — 缺陷 2's exact shape.)
    a.observedPaths.add(file);
    a[form]++;
    if (index >= windowStartIndex) {
      if (form === "form1") a.windowForm1++;
      else a.windowForm2++;
    }
    if (a.samples[form].length < CONTENTION_SAMPLE_LIMIT) {
      a.samples[form].push({
        task: typeof record["task"] === "string" ? record["task"] : null,
        ts: typeof record["ts"] === "string" ? record["ts"] : null,
        recordIndex: index,
      });
    }
  };

  // A raw token that cannot be mapped is NOT dropped silently: it is reported by name (硬规则 3b).
  const unresolved = new Map<string, string>();

  /** Predicate output → repo-relative keys, deduped. A single record that spells one file two ways
   *  (`worker-driver.ts` and `plugin/scripts/worker-driver.ts`) must count ONCE. */
  const resolveHits = (raws: string[]): string[] => {
    const keys = new Set<string>();
    for (const raw of raws) {
      const id = resolver.resolve(raw);
      if (id.rel !== null) keys.add(id.rel);
      else if (!unresolved.has(raw)) unresolved.set(raw, id.reason ?? "unresolved");
    }
    return [...keys];
  };

  rows.forEach((record, index) => {
    // ONE record contributes at most ONE hit per file per shape.
    for (const file of resolveHits(predicates.form1Files(record))) touch(file, record, index, "form1");
    for (const file of resolveHits(predicates.form2Files(record))) touch(file, record, index, "form2");
  });

  // PROVENANCE, pass 2: every spelling observed anywhere in the record that maps onto a counted key.
  // Normalized first, so `observedPaths` never carries a worktree absolute path (缺陷 1/2).
  const hotBasenames = new Set([...agg.keys()].map((f) => path.posix.basename(f)));
  for (const record of rows) {
    for (const s of collectStrings(record)) {
      for (const token of s.match(PATH_TOKEN_RE) ?? []) {
        const raw = token.replace(/^(\.\/)+/, "");
        const id = resolver.resolve(raw);
        if (id.rel !== null) {
          agg.get(id.rel)?.observedPaths.add(id.rel);
        } else if (hotBasenames.has(path.posix.basename(raw)) && !unresolved.has(raw)) {
          unresolved.set(raw, id.reason ?? "unresolved");
        }
      }
    }
  }

  const files: ContentionFileReading[] = [...agg.entries()]
    .map(([file, a]) => ({
      file,
      basename: path.posix.basename(file),
      form1: a.form1,
      form2: a.form2,
      total: a.form1 + a.form2,
      windowForm1: a.windowForm1,
      windowForm2: a.windowForm2,
      windowTotal: a.windowForm1 + a.windowForm2,
      samples: a.samples,
      observedPaths: [...a.observedPaths].sort(),
    }))
    .sort((x, y) => y.total - x.total || x.file.localeCompare(y.file))
    .slice(0, Math.max(1, topN));

  return {
    evaluated: true,
    reason: malformed > 0 ? `carrier-partially-unparsed: ${malformed} line(s) skipped (counts are over the ${rows.length} parseable records)` : null,
    carrierPath,
    carrierExists: true,
    carrierRecords: rows.length,
    windowStartIndex,
    windowSource,
    topN,
    pathIndex,
    predicateSelfCheck,
    unresolvedPaths: [...unresolved.entries()].map(([raw, reason]) => ({ raw, reason })).sort((a, b) => a.raw.localeCompare(b.raw)),
    files,
  };
}

// ── The per-round record + carrier ────────────────────────────────────────────────────────────────

export const DESIGN_EVOLUTION_MODE = "design-evolution-readings-round";

export interface DesignEvolutionReadingsRecord {
  ts: string;
  mode: typeof DESIGN_EVOLUTION_MODE;
  evaluated: boolean;
  reason: string | null;
  head: string | null;
  rm1: {
    evaluated: boolean;
    reason: string | null;
    subsystems: SubsystemReading[];
  };
  rm2: ContentionReading;
  /** How many worker-outcome records this round scanned — the WATERMARK the NEXT round's window
   *  starts from (an offset, not a timestamp: two records can share a ts). */
  carrierRecords: number | null;
  /** ADR-008 phase-declaration staleness — commits / new goals / days since the last declaration.
   *  ATTACHED INFORMATION ONLY: it is never folded into `evaluated`, never a gate, and never a
   *  trigger (tasks/gap-adr008-phase-declaration-staleness-reading Plan §3-4). Its own unreadable
   *  state is `evaluated:false` inside the field, which must not change the ROUND's verdict. */
  phaseStaleness: PhaseStalenessReading;
  /** The round's own JUDGMENT (gap-design-evolution-readings-emit-findings): `stable` /
   *  `regression` / `no-prior` / `not-evaluated`, plus the per-subsystem table. Present on every
   *  record this module writes (a `stable` round is still an assessment); ABSENT on records written
   *  before the judgment existed — an absent field is 「这一轮没有判定」, ⛔ never `stable` (硬规则 6). */
  evolution?: EvolutionVerdict;
  reportOnly: true;
}

export interface ReadingsOptions {
  ts?: string;
  head?: string;
  subsystems: SubsystemSpec[];
  carrierPath?: string;
  topN?: number;
  windowStartIndex?: number;
  windowSource?: ContentionReading["windowSource"];
  predicates?: ContentionPredicates;
}

/** Produce ONE round's reading (both RMs). Pure: no writes. The caller decides where it lands. */
export function buildReadings(root: string, opts: ReadingsOptions): DesignEvolutionReadingsRecord {
  const subsystems = opts.subsystems.map((s) => measureSubsystem(root, s, opts.head ? { head: opts.head } : {}));
  const rm1Evaluated = subsystems.length > 0 && subsystems.every((s) => s.evaluated);
  const rm1Reason =
    subsystems.length === 0
      ? "rm1-no-subsystems-declared: no subsystem is declared, so there is no decomposition reading to take"
      : rm1Evaluated
        ? null
        : subsystems.filter((s) => !s.evaluated).map((s) => `${s.name}: ${s.reason ?? "not evaluated"}`).join("; ");
  const rm2 = scanContention(root, {
    ...(opts.carrierPath ? { carrierPath: opts.carrierPath } : {}),
    ...(opts.topN !== undefined ? { topN: opts.topN } : {}),
    ...(opts.windowStartIndex !== undefined ? { windowStartIndex: opts.windowStartIndex } : {}),
    ...(opts.windowSource ? { windowSource: opts.windowSource } : {}),
    ...(opts.predicates ? { predicates: opts.predicates } : {}),
  });
  const evaluated = rm1Evaluated && rm2.evaluated;
  const reason = evaluated
    ? null
    : [rm1Evaluated ? null : `rm1: ${rm1Reason}`, rm2.evaluated ? null : `rm2: ${rm2.reason ?? "not evaluated"}`]
        .filter(Boolean)
        .join(" | ");
  const ts = opts.ts ?? new Date().toISOString();
  // `ts` doubles as the deterministic clock for the staleness distance, so a replayed round reports
  // the same number of days it did when it was taken.
  const now = new Date(ts);
  return {
    ts,
    mode: DESIGN_EVOLUTION_MODE,
    evaluated,
    reason,
    head: subsystems[0]?.headSha ?? null,
    rm1: { evaluated: rm1Evaluated, reason: rm1Reason, subsystems },
    rm2,
    carrierRecords: rm2.carrierRecords,
    phaseStaleness: readPhaseStaleness(root, Number.isFinite(now.getTime()) ? { now } : {}),
    reportOnly: true,
  };
}

/** Append one line to the carrier. Fail-closed `{ok,error}` (never throws): a write failure must
 *  surface as `failed`, not as a silently verified round. */
export function appendHistoryRecord(
  root: string,
  record: DesignEvolutionReadingsRecord,
  opts: { historyPath?: string } = {},
): { path: string; ok: boolean; error: string | null } {
  const file = opts.historyPath ? path.resolve(opts.historyPath) : path.join(path.resolve(root), DESIGN_EVOLUTION_HISTORY_REL);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
    return { path: file, ok: true, error: null };
  } catch (e) {
    return { path: file, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The previous round's watermark, read from the LAST line of the carrier.
 *
 *  Unreadable/corrupt last line is a DISTINCT value (`previous-record-unusable`), not "no previous
 *  record": the window then falls back to the whole carrier AND the record says so, so a reader can
 *  tell a genuinely first round from a lost watermark. */
export function readPreviousWindow(
  root: string,
  opts: { historyPath?: string } = {},
): { windowStartIndex: number; windowSource: ContentionReading["windowSource"] } {
  const file = opts.historyPath ? path.resolve(opts.historyPath) : path.join(path.resolve(root), DESIGN_EVOLUTION_HISTORY_REL);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { windowStartIndex: 0, windowSource: "no-previous-record" };
  }
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { windowStartIndex: 0, windowSource: "no-previous-record" };
  try {
    const last = JSON.parse(lines[lines.length - 1]) as { mode?: unknown; carrierRecords?: unknown };
    if (last.mode !== DESIGN_EVOLUTION_MODE || typeof last.carrierRecords !== "number" || !Number.isFinite(last.carrierRecords)) {
      return { windowStartIndex: 0, windowSource: "previous-record-unusable" };
    }
    return { windowStartIndex: Math.max(0, Math.trunc(last.carrierRecords)), windowSource: "previous-record" };
  } catch {
    return { windowStartIndex: 0, windowSource: "previous-record-unusable" };
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// FROM A READING TO A FINDING (tasks/gap-design-evolution-readings-emit-findings, 2026-10-22)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// WHAT WAS MISSING. Everything above produces a reading and stops. `quality-gate-driver`'s
// design-evolution routine appended one line per due round and reported it, and NOTHING downstream
// read that line: the second half of the meta-mechanism (「检出回归就立案」) did not exist. The filing
// track DID exist an arm's length away — `.quay/routine-findings.jsonl` → `routine-file-gate.ts`
// (quality / dedup / rate) → `quay:run-routines` — with 2924 records and `architecture-analysis`
// already among its producers. The readings were simply never connected to it. The two historical
// events a regression detector would have caught (the ~7h directory cycle, the worker god-file
// growth) were found by a human reading, not by this routine.
//
// WHAT THIS ADDS, and what it deliberately does NOT:
//   ⛔ no new driver, ⛔ no model call, ⛔ no task creation from here. A `regression` verdict becomes a
//   FINDING in the EXISTING carrier; whether it becomes a task stays the existing gate's call.
//
// THE TRIGGERS ARE STRUCTURAL, NEVER THRESHOLDS (硬规则 4 推论 — no numeric threshold for a cost
// structure nobody has measured). At the task's reading the carrier held 9 records with almost no
// variance (serve 1.31% ×8, worker-history 82.46% ×7), so a `>50%` / `>1%` bar would be invented:
//   • `share-up`      — same subsystem, same baseline, and THIS round's denominator AND its central
//                       delta both grew ⇒ new lines were produced AND new lines landed in the central
//                       file. The finding carries Δcentral / Δdenominator / Δnon-central and the
//                       cumulative share. Noise is absorbed by the gate's DEDUP branch (one filing per
//                       subsystem+trigger), ⛔ never by an invented cut-off.
//                       DECLARED BOUNDARY: `Δdenominator <= 0` is NOT a share-up even when Δcentral > 0
//                       — a window that only moved lines INTO the central file is not "new code
//                       landing in central", and the task names this trigger by that shape.
//   • `dark-streak`   — a subsystem read `evaluated:false` for ≥ `dark_streak_rounds` consecutive
//                       rounds. ← the ONLY round count here, and it is a POLICY choice (one failure
//                       can be transient, two is worth a task), ⛔ not a measurement; the default is
//                       stated once, below, and the config key only overrides it.
//   • `source-missing`— a subsystem the previous round measured is GONE. Identity is `baseline` +
//                       the central file set, ⛔ not the label: a rename does not remove a reading.
//                       (Measured on the real carrier — record #1 renames `worker` → `worker-history`
//                       with the same baseline 2440b52d0 and the same central files. A label-keyed
//                       rule would have filed a "subsystem vanished" task for a config rename.)
//
// THE INSTRUMENT GOING DARK IS ITSELF A FINDING (`dark-streak`), or this mechanism is blind exactly
// when its instruments are — the lesson of `gap-instrument-decay-check-unwired-and-blind-to-content-
// dark`. ⛔ This does not re-detect decay; it consumes its OWN dark rounds.
//
// EVERY ROUND LEAVES A TRACE, `stable` INCLUDED: the verdict is embedded in the round's own carrier
// record (`evolution`), so 「这条例程评估过几轮、触发过几次」 is a query over the carrier, not a
// memory. (`arch-cycle-report`'s 25/25 `evaluated:false` is the measured cost of skipping this.)
//
// THE DEDUP IDENTITY IS MECHANICAL: `evolution:<target>:<trigger>`, emitted as the finding's SYMBOL,
// so `routine-file-gate`'s existing subject key (`symbols:<sorted set>`) keys on it with NO new
// parser. ⛔ The rationale (which a fresh context would paraphrase every round) never reaches the
// key — the same measured lesson as `semantic-dedup-scan`'s 76 recurring clusters / 0 cross-round
// prose keys.

/** The one POLICY number in this mechanism. WHY 2: one dark round can be a transient (a resolve
 *  failure, a carrier being rewritten); two consecutive is worth a task. ⛔ This is a choice about
 *  when to spend a human's attention — it is NOT a measured threshold (硬规则 4 推论), and it must
 *  not be quoted as if a reading had produced it. The single definition point; the config key
 *  `design_evolution_readings.dark_streak_rounds` only OVERRIDES it (⛔ no second default). */
export const DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT = 2;

/** The existing routine-findings carrier this mechanism appends FINDINGS to (⛔ not a new carrier:
 *  `quay:run-routines` / `routine-file-gate` already read this one, and a private file would need a
 *  new consumer — the exact "detects but nothing acts" shape this task closes). */
export const EVOLUTION_FINDINGS_REL = path.posix.join(".quay", "routine-findings.jsonl");

/** Round-level judgment states. `not-evaluated` is spelled the way the Fact vocabulary spells it. */
export const EVOLUTION_STATE_STABLE = "stable";
export const EVOLUTION_STATE_REGRESSION = "regression";
export const EVOLUTION_STATE_NO_PRIOR = "no-prior";
export const EVOLUTION_STATE_NOT_EVALUATED = "not-evaluated";
export type EvolutionState =
  | typeof EVOLUTION_STATE_STABLE
  | typeof EVOLUTION_STATE_REGRESSION
  | typeof EVOLUTION_STATE_NO_PRIOR
  | typeof EVOLUTION_STATE_NOT_EVALUATED;

/** The three triggers — the ONE vocabulary. ⛔ Never copy this list: a drifted copy silently changes
 *  what counts as a regression (and what the finding key means). */
export const EVOLUTION_TRIGGER_VALUES = ["share-up", "dark-streak", "source-missing"] as const;
export type EvolutionTrigger = (typeof EVOLUTION_TRIGGER_VALUES)[number];
export const EVOLUTION_TRIGGER_SHARE_UP = "share-up";
export const EVOLUTION_TRIGGER_DARK_STREAK = "dark-streak";
export const EVOLUTION_TRIGGER_SOURCE_MISSING = "source-missing";

/** RM2's row in the per-subsystem table. RM2 is a whole-repo reading, not a declared subsystem, and
 *  it must still be able to go dark — naming it here keeps the table exhaustive without pretending
 *  it is a `subsystems:` entry. */
export const EVOLUTION_RM2_TARGET = "rm2";

/** Per-subsystem row states: the three triggers plus four non-triggering values. ⛔ Each is distinct
 *  (硬规则 3): 「没变化」(`stable`), 「这轮才出现」(`new`), 「上一轮没有可比值」(`no-prior`) and
 *  「这一轮读不出来」(`not-evaluated`) must never share one spelling. */
export type SubsystemRowState = EvolutionTrigger | "stable" | "new" | "no-prior" | "not-evaluated";

export interface SubsystemVerdict {
  name: string;
  state: SubsystemRowState;
  /** THIS round's increment over the previous one (⛔ not the cumulative reading — both are carried:
   *  `deltaCentral` here, the cumulative `sharePercent` alongside). null when incomparable. */
  deltaCentral: number | null;
  deltaNonCentral: number | null;
  deltaDenominator: number | null;
  /** The CUMULATIVE share the subsystem reports this round (2 decimals). */
  sharePercent: number | null;
  /** Consecutive `evaluated:false` rounds ENDING at this round (`dark-streak` rows only). */
  darkRounds: number | null;
  /** Names the exact cause whenever a number is null (硬规则 3b). */
  reason: string | null;
}

/** One trigger hit — the shape both the finding and the summary line read. */
export interface EvolutionTriggerHit {
  trigger: EvolutionTrigger;
  target: string;
  deltaCentral: number | null;
  deltaNonCentral: number | null;
  deltaDenominator: number | null;
  sharePercent: number | null;
  darkRounds: number | null;
}

export interface EvolutionVerdict {
  state: EvolutionState;
  /** NON-NULL ONLY for `regression`, and never empty there. Otherwise `null` — ⛔ not `[]`: an empty
   *  array makes 「无触发」 and 「判不了」 share one shape (硬规则 3b). */
  triggers: EvolutionTriggerHit[] | null;
  /** The full per-subsystem table (triggering rows AND non-triggering ones) — the AC3 surface. */
  subsystems: SubsystemVerdict[];
  /** ONE deterministic line. Never null, so a `stable` round is still a visible assessment. */
  summary: string;
  /** Why the judgment could not be taken (`not-evaluated` only), else null. */
  reason: string | null;
  currTs: string;
  currEvaluated: boolean;
  priorTs: string | null;
  /** THREE-VALUED, kept apart from `priorTs === null`: a first round and a corrupt carrier are not
   *  the same fact (硬规则 3b). */
  priorState: "ok" | "no-prior-record" | "previous-record-unusable";
  darkStreakRounds: number;
}

/** A finding this mechanism would file. Every field is derived from the readings — ⛔ no prose enters
 *  the KEY, and the key is the only thing dedup sees. */
export interface EvolutionFinding {
  /** `evolution:<target>:<trigger>` — the mechanical identity (see the header block). */
  key: string;
  target: string;
  trigger: EvolutionTrigger;
  readingTs: string;
  priorReadingTs: string | null;
  deltaCentral: number | null;
  deltaNonCentral: number | null;
  deltaDenominator: number | null;
  sharePercent: number | null;
  darkRounds: number | null;
  rationale: string;
  suggestedAction: string;
  files: string[];
}

/** `evolution:<target>:<trigger>`. ⛔ ONE construction point — the carrier record and the rendered
 *  candidate must key identically, or dedup silently stops working. */
export function evolutionFindingKey(target: string, trigger: EvolutionTrigger): string {
  return `evolution:${target}:${trigger}`;
}

// ── reading the carrier's HISTORY (not just its watermark) ───────────────────────────────────────

export type HistoryReadState = "ok" | "carrier-missing" | "unreadable";

export interface HistoryRead {
  state: HistoryReadState;
  /** [] unless `state === "ok"` (⛔ a half-parsed list must not be presented as the history). */
  records: DesignEvolutionReadingsRecord[];
  /** Non-blank lines that did not parse into a round record — reported, never silently dropped. */
  malformed: number;
  reason: string | null;
}

function isRoundRecord(x: unknown): x is DesignEvolutionReadingsRecord {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  if (r.mode !== DESIGN_EVOLUTION_MODE) return false;
  if (typeof r.ts !== "string" || typeof r.evaluated !== "boolean") return false;
  const rm1 = r.rm1 as { subsystems?: unknown } | undefined;
  if (rm1 === null || typeof rm1 !== "object" || !Array.isArray(rm1?.subsystems)) return false;
  const rm2 = r.rm2 as { evaluated?: unknown } | undefined;
  return rm2 !== null && typeof rm2 === "object" && typeof rm2?.evaluated === "boolean";
}

/** Read EVERY round record the carrier holds, oldest first.
 *
 *  THREE-VALUED (硬规则 3b): a missing carrier and an unparseable one are different facts, and a
 *  carrier with some good and some corrupt lines is `ok` carrying `malformed > 0` — the caller can
 *  see what it is standing on. A carrier whose non-blank lines ALL fail to parse is `unreadable`
 *  (reading it produced nothing, so presenting it as "no history" would be a lie). */
export function readDesignEvolutionHistory(root: string, opts: { historyPath?: string } = {}): HistoryRead {
  const file = opts.historyPath ? path.resolve(opts.historyPath) : path.join(path.resolve(root), DESIGN_EVOLUTION_HISTORY_REL);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") return { state: "carrier-missing", records: [], malformed: 0, reason: `${file} does not exist` };
    return { state: "unreadable", records: [], malformed: 0, reason: `${file} is unreadable — ${(e as Error).message}` };
  }
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const records: DesignEvolutionReadingsRecord[] = [];
  let malformed = 0;
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    if (!isRoundRecord(parsed)) {
      malformed += 1;
      continue;
    }
    records.push(parsed);
  }
  if (lines.length > 0 && records.length === 0) {
    return { state: "unreadable", records: [], malformed, reason: `${file} carries ${lines.length} line(s) but none is a round record` };
  }
  return { state: "ok", records, malformed, reason: null };
}

/** Consecutive `evaluated:false` rounds for `name`, counting BACKWARDS from the last record. A record
 *  that does not carry the subsystem BREAKS the streak (absent ≠ dark — 硬规则 6: 缺值 ≠ 为假). */
export function trailingDarkRounds(records: readonly DesignEvolutionReadingsRecord[], name: string): number {
  let n = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const s = records[i].rm1.subsystems.find((x) => x.name === name);
    if (!s || s.evaluated !== false) break;
    n += 1;
  }
  return n;
}

/** Same for RM2's whole-repo reading. */
export function trailingRm2DarkRounds(records: readonly DesignEvolutionReadingsRecord[]): number {
  let n = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].rm2.evaluated !== false) break;
    n += 1;
  }
  return n;
}

/** The prior-dark map the pure judge consumes: one entry per target the CURRENT round can report. */
export function priorDarkRoundsFor(
  records: readonly DesignEvolutionReadingsRecord[],
  names: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of names) out[name] = trailingDarkRounds(records, name);
  out[EVOLUTION_RM2_TARGET] = trailingRm2DarkRounds(records);
  return out;
}

// ── THE JUDGMENT (pure; ⛔ no I/O, ⛔ no model) ──────────────────────────────────────────────────

/** A subsystem's IDENTITY across rounds: what it MEASURES, not what it is called. A renamed
 *  subsystem (same baseline, same central files) is the SAME reading — measured on the real carrier:
 *  `worker` → `worker-history` at record #1, both at baseline 2440b52d0. */
export function subsystemIdentity(s: { baseline: string; baselineSha?: string | null; central: readonly CentralFileSpec[] }): string {
  const baseline = s.baselineSha ?? s.baseline;
  return `${baseline}|${s.central.map((c) => c.atHead).slice().sort().join(",")}`;
}

export interface JudgeOptions {
  /** Rounds a subsystem must read `evaluated:false` consecutively before it counts as a regression. */
  darkStreakRounds?: number;
  /** Consecutive dark rounds immediately BEFORE `curr`, per target (see `priorDarkRoundsFor`).
   *  Absent ⇒ derived from `prev` alone (1 when `prev` carries the subsystem unevaluated, else 0),
   *  which is exactly the pair-wise reading for the default threshold of 2. */
  priorDarkRounds?: Readonly<Record<string, number>>;
  /** Why `prev` is what it is. Defaults to `no-prior-record` when `prev` is null, else `ok`. */
  prevState?: EvolutionVerdict["priorState"];
  prevStateReason?: string | null;
}

const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const sub = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);

/** Judge ONE round against its predecessor. Four states, pairwise distinguishable:
 *    `stable`         — a usable prior exists and nothing triggered;
 *    `regression`     — ≥1 trigger (triggers non-empty);
 *    `no-prior`       — this is the first reading (priorTs null, priorState `no-prior-record`);
 *    `not-evaluated`  — THIS round cannot be judged (its own readings are dark short of a streak, or
 *                       the previous record is unreadable). `reason` is non-null and `triggers` null.
 *  ⛔ `stable` and `no-prior` differ in `state` AND `priorTs`; ⛔ `not-evaluated` never borrows
 *  `triggers: []`. */
export function judgeEvolutionRegression(
  prev: DesignEvolutionReadingsRecord | null,
  curr: DesignEvolutionReadingsRecord,
  opts: JudgeOptions = {},
): EvolutionVerdict {
  const threshold = opts.darkStreakRounds ?? DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT;
  const priorState: EvolutionVerdict["priorState"] = opts.prevState ?? (prev === null ? "no-prior-record" : "ok");
  const derivedDark: Readonly<Record<string, number>> =
    opts.priorDarkRounds ??
    (prev === null
      ? {}
      : Object.fromEntries(
          prev.rm1.subsystems.map((s) => [s.name, s.evaluated === false ? 1 : 0] as const),
        ));
  const base = {
    currTs: curr.ts,
    currEvaluated: curr.evaluated === true,
    priorTs: prev?.ts ?? null,
    priorState,
    darkStreakRounds: threshold,
  };

  if (!isRoundRecord(curr)) {
    return {
      ...base,
      state: EVOLUTION_STATE_NOT_EVALUATED,
      triggers: null,
      subsystems: [],
      summary: `${EVOLUTION_STATE_NOT_EVALUATED} @${String((curr as { ts?: unknown })?.ts ?? "?")} — the round record could not be read`,
      reason: "current-record-unreadable: the argument is not a design-evolution round record (mode/ts/evaluated/rm1.subsystems/rm2.evaluated missing)",
    };
  }
  if (priorState === "previous-record-unusable") {
    return {
      ...base,
      state: EVOLUTION_STATE_NOT_EVALUATED,
      triggers: null,
      subsystems: [],
      summary: `${EVOLUTION_STATE_NOT_EVALUATED} @${curr.ts} — the previous round could not be read, so no comparison exists`,
      reason: opts.prevStateReason ?? "previous-record-unusable: the last carrier line is not a round record, so there is no baseline to compare against (⛔ not the same as a first round)",
    };
  }

  const rows: SubsystemVerdict[] = [];
  const prevSubs = prev?.rm1.subsystems ?? null;
  const usedPrev = new Set<number>();

  const judgeOne = (cs: (typeof curr.rm1.subsystems)[number], ps: (typeof curr.rm1.subsystems)[number] | null): SubsystemVerdict => {
    const dark = derivedDark[cs.name] ?? 0;
    if (cs.evaluated !== true) {
      const darkRounds = dark + 1;
      if (darkRounds >= threshold) {
        return {
          name: cs.name, state: EVOLUTION_TRIGGER_DARK_STREAK,
          deltaCentral: null, deltaNonCentral: null, deltaDenominator: null, sharePercent: null,
          darkRounds, reason: cs.reason ?? "the reading reports evaluated:false without a reason",
        };
      }
      return {
        name: cs.name, state: EVOLUTION_STATE_NOT_EVALUATED,
        deltaCentral: null, deltaNonCentral: null, deltaDenominator: null, sharePercent: null,
        darkRounds, reason: cs.reason ?? "the reading reports evaluated:false without a reason",
      };
    }
    const sharePercent = num(cs.sharePercent);
    if (ps === null) {
      return {
        name: cs.name, state: prev === null ? EVOLUTION_STATE_NO_PRIOR : "new",
        deltaCentral: null, deltaNonCentral: null, deltaDenominator: null, sharePercent,
        darkRounds: null,
        reason: prev === null ? "first round — there is no previous reading to compare against" : "this subsystem is absent from the previous round",
      };
    }
    if (ps.evaluated !== true) {
      return {
        name: cs.name, state: EVOLUTION_STATE_NO_PRIOR,
        deltaCentral: null, deltaNonCentral: null, deltaDenominator: null, sharePercent,
        darkRounds: null,
        reason: `the previous round could not evaluate this subsystem (${ps.reason ?? "no reason recorded"}) ⇒ the increment is not computable`,
      };
    }
    const deltaCentral = sub(num(cs.centralDelta), num(ps.centralDelta));
    const deltaNonCentral = sub(num(cs.nonCentralDelta), num(ps.nonCentralDelta));
    const deltaDenominator = sub(num(cs.denominator), num(ps.denominator));
    const sameBaseline = subsystemIdentity(cs) === subsystemIdentity(ps);
    const shareUp =
      sameBaseline && deltaDenominator !== null && deltaCentral !== null &&
      deltaDenominator > 0 && deltaCentral > 0;
    return {
      name: cs.name,
      state: shareUp ? EVOLUTION_TRIGGER_SHARE_UP : EVOLUTION_STATE_STABLE,
      deltaCentral, deltaNonCentral, deltaDenominator, sharePercent, darkRounds: null,
      reason: shareUp
        ? null
        : sameBaseline
          ? "no new lines landed in the central file this round (Δcentral <= 0 or Δdenominator <= 0)"
          : "the subsystem's baseline identity changed between the two rounds ⇒ the increment is not comparable",
    };
  };

  for (const cs of curr.rm1.subsystems) {
    let pi = -1;
    if (prevSubs !== null) {
      pi = prevSubs.findIndex((p, i) => !usedPrev.has(i) && p.name === cs.name);
      if (pi < 0) pi = prevSubs.findIndex((p, i) => !usedPrev.has(i) && subsystemIdentity(p) === subsystemIdentity(cs));
      if (pi >= 0) usedPrev.add(pi);
    }
    rows.push(judgeOne(cs, pi >= 0 ? prevSubs![pi] : null));
  }
  // `source-missing` rows: what the previous round measured and this one does not.
  if (prevSubs !== null) {
    for (const [i, ps] of prevSubs.entries()) {
      if (usedPrev.has(i)) continue;
      rows.push({
        name: ps.name, state: EVOLUTION_TRIGGER_SOURCE_MISSING,
        deltaCentral: null, deltaNonCentral: null, deltaDenominator: null, sharePercent: null,
        darkRounds: null,
        reason: `the previous round measured this subsystem (${subsystemIdentity(ps)}) and this round does not declare it`,
      });
    }
  }
  // RM2's own row — the contention reading can go dark too, and an instrument that goes dark silently
  // is the failure class this whole section exists for.
  const rm2Dark = (derivedDark[EVOLUTION_RM2_TARGET] ?? 0) + (curr.rm2.evaluated === true ? 0 : 1);
  if (curr.rm2.evaluated !== true) {
    rows.push({
      name: EVOLUTION_RM2_TARGET,
      state: rm2Dark >= threshold ? EVOLUTION_TRIGGER_DARK_STREAK : EVOLUTION_STATE_NOT_EVALUATED,
      deltaCentral: null, deltaNonCentral: null, deltaDenominator: null, sharePercent: null,
      darkRounds: rm2Dark, reason: curr.rm2.reason ?? "rm2 reports evaluated:false without a reason",
    });
  } else if (prev !== null && prev.rm2.evaluated !== true) {
    rows.push({
      name: EVOLUTION_RM2_TARGET, state: EVOLUTION_STATE_NO_PRIOR,
      deltaCentral: null, deltaNonCentral: null, deltaDenominator: null, sharePercent: null,
      darkRounds: null, reason: "the previous round could not take the contention reading",
    });
  } else {
    rows.push({
      name: EVOLUTION_RM2_TARGET, state: EVOLUTION_STATE_STABLE,
      deltaCentral: null, deltaNonCentral: null, deltaDenominator: null, sharePercent: null,
      darkRounds: null, reason: null,
    });
  }

  const triggers: EvolutionTriggerHit[] = rows
    .filter((r) => r.state === EVOLUTION_TRIGGER_SHARE_UP || r.state === EVOLUTION_TRIGGER_DARK_STREAK || r.state === EVOLUTION_TRIGGER_SOURCE_MISSING)
    .map((r) => ({
      trigger: r.state as EvolutionTrigger,
      target: r.name,
      deltaCentral: r.deltaCentral,
      deltaNonCentral: r.deltaNonCentral,
      deltaDenominator: r.deltaDenominator,
      sharePercent: r.sharePercent,
      darkRounds: r.darkRounds,
    }));

  const notEvaluatedRows = rows.filter((r) => r.state === EVOLUTION_STATE_NOT_EVALUATED);
  const state: EvolutionState =
    triggers.length > 0
      ? EVOLUTION_STATE_REGRESSION
      // ⚠️ Derived from the ROWS, not only from `curr.evaluated`: a row that could not be taken means
      // this round cannot be judged, even if a caller handed us a record whose summary boolean says
      // otherwise. `curr.evaluated === false` is checked too, because a record can be unevaluated for
      // a reason no row captures (rm1 with no subsystem declared at all).
      : notEvaluatedRows.length > 0 || curr.evaluated !== true
        ? EVOLUTION_STATE_NOT_EVALUATED
        : prev === null
          ? EVOLUTION_STATE_NO_PRIOR
          : EVOLUTION_STATE_STABLE;

  const reason =
    state === EVOLUTION_STATE_NOT_EVALUATED
      ? curr.evaluated !== true
        ? `current-round-not-evaluated: ${curr.reason ?? "the round reports evaluated:false without a reason"}`
        : `sub-readings-not-evaluated: ${notEvaluatedRows.map((r) => `${r.name} (${r.reason ?? "no reason recorded"})`).join("; ")} — one dark round is not yet a streak (threshold ${threshold})`
      : null;

  const summary =
    `${state} @${curr.ts} vs ${prev === null ? "(no prior reading)" : prev.ts}` +
    (triggers.length > 0
      ? ` — ${triggers
          .map((t) =>
            t.trigger === EVOLUTION_TRIGGER_SHARE_UP
              ? `${t.trigger}:${t.target} (Δcentral=${t.deltaCentral} Δdenominator=${t.deltaDenominator} Δnon-central=${t.deltaNonCentral} share=${t.sharePercent}%)`
              : t.trigger === EVOLUTION_TRIGGER_DARK_STREAK
                ? `${t.trigger}:${t.target} (${t.darkRounds} consecutive rounds evaluated:false)`
                : `${t.trigger}:${t.target} (measured by the previous round, not declared now)`,
          )
          .join(", ")}`
      : reason !== null
        ? ` — ${reason}`
        : "");

  return {
    ...base,
    state,
    triggers: triggers.length > 0 ? triggers : null,
    subsystems: rows,
    summary,
    reason,
  };
}

// ── the FINDING (mechanical text; ⛔ nothing here calls a model, ⛔ nothing here files a task) ────

/** Render the findings a verdict justifies. `stable` / `no-prior` / `not-evaluated` yield NONE — a
 *  non-triggering round's assessment already lives in the carrier record, and filing it would turn
 *  the routine into a heartbeat spammer. */
export function evolutionFindings(record: DesignEvolutionReadingsRecord, verdict: EvolutionVerdict): EvolutionFinding[] {
  if (verdict.state !== EVOLUTION_STATE_REGRESSION || verdict.triggers === null) return [];
  const hist = DESIGN_EVOLUTION_HISTORY_REL;
  return verdict.triggers.map((t) => {
    const reading = record.rm1.subsystems.find((s) => s.name === t.target) ?? null;
    const files = reading
      ? [...new Set([...reading.centralFiles.map((c) => c.atHead), ...reading.central.map((c) => c.atHead)])]
      : t.target === EVOLUTION_RM2_TARGET
        ? [OUTCOME_CARRIER_REL]
        : [];
    const where = `读数载体 \`${hist}\` 的 ts=\`${record.ts}\`（上一条 \`${verdict.priorTs ?? "<none>"}\`）`;
    if (t.trigger === EVOLUTION_TRIGGER_SHARE_UP) {
      return {
        key: evolutionFindingKey(t.target, t.trigger),
        target: t.target,
        trigger: t.trigger,
        readingTs: record.ts,
        priorReadingTs: verdict.priorTs,
        deltaCentral: t.deltaCentral,
        deltaNonCentral: t.deltaNonCentral,
        deltaDenominator: t.deltaDenominator,
        sharePercent: t.sharePercent,
        darkRounds: null,
        rationale:
          `子系统 \`${t.target}\` 本轮相对上一条读数分母增加 \`${t.deltaDenominator}\`、中心增量 \`${t.deltaCentral}\`、` +
          `非中心增量 \`${t.deltaNonCentral}\` ⇒ 新增的行落进了中心文件（分解没有把新代码挡在外面）。` +
          `累计占比 \`${t.sharePercent}%\`（centralΔ=\`${reading?.centralDelta ?? "?"}\` / denominator=\`${reading?.denominator ?? "?"}\`）。${where}。`,
        suggestedAction:
          `复核 \`${t.target}\` 本轮新增的中心文件行是否本应落在扩展点之外的模块里；若是，把新增逻辑移到模块文件并在 ` +
          `\`${hist}\` 的后续读数上看到中心增量回落；若否，在任务体写明「这轮增长确实属于中心文件的职责」。`,
        files,
      };
    }
    if (t.trigger === EVOLUTION_TRIGGER_DARK_STREAK) {
      return {
        key: evolutionFindingKey(t.target, t.trigger),
        target: t.target,
        trigger: t.trigger,
        readingTs: record.ts,
        priorReadingTs: verdict.priorTs,
        deltaCentral: null,
        deltaNonCentral: null,
        deltaDenominator: null,
        sharePercent: null,
        darkRounds: t.darkRounds,
        rationale:
          `\`${t.target}\` 连续 \`${t.darkRounds}\` 轮读数 \`evaluated:false\`（阈值 \`${verdict.darkStreakRounds}\` 轮，策略选择）。` +
          `最近一条原因：\`${reading?.reason ?? (t.target === EVOLUTION_RM2_TARGET ? record.rm2.reason : null) ?? "no reason recorded"}\`。${where}。`,
        suggestedAction:
          `读 \`${hist}\` 的最近记录，定位 \`${t.target}\` 读不出的确切条件` +
          `（baseline 不可解析 / 中心文件在某端缺失 / 分母非正 / 载体缺失），修好仪器或改正声明；⛔ 不要靠调高 dark_streak_rounds 让这条消掉。`,
        files,
      };
    }
    return {
      key: evolutionFindingKey(t.target, t.trigger),
      target: t.target,
      trigger: t.trigger,
      readingTs: record.ts,
      priorReadingTs: verdict.priorTs,
      deltaCentral: null,
      deltaNonCentral: null,
      deltaDenominator: null,
      sharePercent: null,
      darkRounds: null,
      rationale:
        `上一轮（\`${verdict.priorTs ?? "<none>"}\`）测量的子系统 \`${t.target}\` 在本轮读数中不存在` +
        `（identity=\`${reading === null ? "unavailable" : subsystemIdentity(reading)}\`）⇒ 这条读数来源消失了。` +
        `⛔ 改名不算消失（identity 由 baseline + 中心文件集构成）；这是「声明里不再有它」。${where}。`,
      suggestedAction:
        `确认 \`${t.target}\` 是有意从 \`.quay/config.yml\` \`loop.design_evolution_readings.subsystems:\` 移除的：` +
        `是 ⇒ 在任务体写明移除理由并结案；否 ⇒ 恢复该子系统声明，并让 \`${hist}\` 的下一条记录重新列出它。`,
      files,
    };
  });
}

/** The carrier RECORD a finding lands as. Shape = the EXISTING `.quay/routine-findings.jsonl`
 *  `kind:"finding"` record (⛔ a second record shape would need a second reader): `symbols` carries
 *  the mechanical key, so `routine-file-gate`'s subject dedup reads it with no new parser, and
 *  `recurrenceByKey` counts rounds for the same key. */
export function evolutionFindingRecord(f: EvolutionFinding, ts: string): Record<string, unknown> {
  const ms = Date.parse(ts);
  return {
    ts,
    kind: "finding",
    routine: DESIGN_EVOLUTION_ROUTINE_NAME,
    probe: DESIGN_EVOLUTION_ROUTINE_NAME,
    runId: `${DESIGN_EVOLUTION_ROUTINE_NAME}-${Number.isFinite(ms) ? ms : ts}`,
    findingId: `${f.target}-${f.trigger}`,
    dupKind: "evolution-regression",
    subject: f.target,
    symbols: [f.key],
    files: f.files,
    verdict: "confirmed",
    rationale: f.rationale,
    suggestedAction: f.suggestedAction,
    // The trigger's own numbers, carried verbatim so a reader never has to re-derive them from prose.
    target: f.target,
    trigger: f.trigger,
    readingTs: f.readingTs,
    priorReadingTs: f.priorReadingTs,
    deltaCentral: f.deltaCentral,
    deltaNonCentral: f.deltaNonCentral,
    deltaDenominator: f.deltaDenominator,
    sharePercent: f.sharePercent,
    darkRounds: f.darkRounds,
    margin: null,
  };
}

export interface FindingsAppend {
  path: string;
  appended: number;
  ok: boolean;
  error: string | null;
}

/** Append the findings to the EXISTING routine-findings carrier. Fail-closed `{ok,error}` (never
 *  throws) — a write failure must surface as `failed`, never as a silently verified round.
 *  ⚠️ The carrier is TRACKED (unlike the history carrier): the append is left in the working tree,
 *  and the existing per-round commit in `probe-routine.ts` (`commitRoutineWrite` on the same path)
 *  is what lands it. ⛔ This module does not commit — a report-only routine must not create commits. */
export function appendEvolutionFindings(
  root: string,
  record: DesignEvolutionReadingsRecord,
  findings: readonly EvolutionFinding[],
  opts: { carrierPath?: string } = {},
): FindingsAppend {
  const file = opts.carrierPath ? path.resolve(opts.carrierPath) : path.join(path.resolve(root), EVOLUTION_FINDINGS_REL);
  if (findings.length === 0) return { path: file, appended: 0, ok: true, error: null };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, findings.map((f) => JSON.stringify(evolutionFindingRecord(f, record.ts)) + "\n").join(""));
    return { path: file, appended: findings.length, ok: true, error: null };
  } catch (e) {
    return { path: file, appended: 0, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── ONE round, end to end (both entry points call THIS — ⛔ no second orchestration) ──────────────

export interface TakeRoundOptions extends ReadingsOptions {
  /** The carrier the verdict is embedded in; also the source of the previous round. */
  historyPath?: string;
  /** Where findings land (default `<root>/.quay/routine-findings.jsonl`). */
  findingsPath?: string;
  /** `false` ⇒ take the reading and judge it, but persist NOTHING (and therefore file nothing: a
   *  finding cites a record that must exist). The direct entry's `--no-history`. */
  persist?: boolean;
  darkStreakRounds?: number;
}

export interface TakenRound {
  record: DesignEvolutionReadingsRecord;
  verdict: EvolutionVerdict;
  findings: EvolutionFinding[];
  history: { path: string; appended: boolean; error: string | null };
  findingsCarrier: FindingsAppend;
  /** True when the previous record could not be read (a `not-evaluated` verdict for that reason). */
  priorUnreadable: boolean;
  /** Non-blank carrier lines that were not round records (⛔ never silently dropped). */
  historyMalformed: number;
}

/** Read the history → take the reading → judge it → persist the record → file what the judgment
 *  justifies. The ONE orchestration both the routine and the direct entry use. */
export function takeEvolutionRound(root: string, opts: TakeRoundOptions): TakenRound {
  const resolvedRoot = path.resolve(root);
  const historyPath = opts.historyPath ? path.resolve(opts.historyPath) : path.join(resolvedRoot, DESIGN_EVOLUTION_HISTORY_REL);
  const prior = readDesignEvolutionHistory(resolvedRoot, { historyPath });
  const previous = readPreviousWindow(resolvedRoot, { historyPath });
  const record = buildReadings(resolvedRoot, {
    ...(opts.ts ? { ts: opts.ts } : {}),
    subsystems: opts.subsystems,
    ...(opts.carrierPath ? { carrierPath: opts.carrierPath } : {}),
    ...(opts.topN !== undefined ? { topN: opts.topN } : {}),
    windowStartIndex: previous.windowStartIndex,
    windowSource: previous.windowSource,
    ...(opts.predicates ? { predicates: opts.predicates } : {}),
    ...(opts.head ? { head: opts.head } : {}),
  });
  const names = record.rm1.subsystems.map((s) => s.name);
  const verdict = judgeEvolutionRegression(prior.state === "ok" ? prior.records[prior.records.length - 1] ?? null : null, record, {
    ...(opts.darkStreakRounds !== undefined ? { darkStreakRounds: opts.darkStreakRounds } : {}),
    priorDarkRounds: prior.state === "ok" ? priorDarkRoundsFor(prior.records, names) : {},
    prevState:
      prior.state === "ok"
        ? prior.records.length === 0
          ? "no-prior-record"
          : "ok"
        : prior.state === "carrier-missing"
          ? "no-prior-record"
          : "previous-record-unusable",
    ...(prior.state === "unreadable" ? { prevStateReason: `previous-record-unusable: ${prior.reason}` } : {}),
  });
  // The trace is part of the RECORD (AC6): a `stable` round is still an assessment, and a reader
  // must be able to ask 「评估过几轮」 of the carrier alone.
  record.evolution = verdict;
  if (opts.persist === false) {
    return {
      record,
      verdict,
      findings: [],
      history: { path: historyPath, appended: false, error: null },
      findingsCarrier: { path: opts.findingsPath ?? path.join(resolvedRoot, EVOLUTION_FINDINGS_REL), appended: 0, ok: true, error: null },
      priorUnreadable: prior.state === "unreadable",
      historyMalformed: prior.malformed,
    };
  }
  const appended = appendHistoryRecord(resolvedRoot, record, { historyPath });
  const findings = appended.ok ? evolutionFindings(record, verdict) : [];
  const findingsCarrier = appendEvolutionFindings(resolvedRoot, record, findings, opts.findingsPath ? { carrierPath: opts.findingsPath } : {});
  return {
    record,
    verdict,
    findings,
    history: { path: appended.path, appended: appended.ok, error: appended.error },
    findingsCarrier,
    priorUnreadable: prior.state === "unreadable",
    historyMalformed: prior.malformed,
  };
}

// ── Direct entry ──────────────────────────────────────────────────────────────────────────────────

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_NOT_EVALUATED = 3;
export const EXIT_HISTORY_WRITE_FAILED = 4;
/** The history record landed but the FINDINGS carrier could not be written. A distinct exit code
 *  because it is a distinct failure (硬规则 3): the reading exists, the filing did not. */
export const EXIT_FINDINGS_WRITE_FAILED = 5;

const USAGE = `usage: design-evolution-readings [--root <repo>] [--config <section.yml>] [--head <rev>]
                                   [--top-n <n>] [--history <path>] [--findings <path>]
                                   [--carrier <worker-outcome.jsonl>] [--no-history] [--json]

  RM1 (decomposition share) is taken for every subsystem declared in the \`design_evolution_readings\`
  section (--config points at a file holding the SECTION BODY; default: the \`loop.\` section of
  <root>/.quay/config.yml). RM2 (hot-file contention) is zero-config and always taken from
  <root>/.quay/worker-outcome.jsonl.

  The round is then JUDGED against the previous record in the history carrier (stable / regression /
  no-prior / not-evaluated). A \`regression\` appends one finding per trigger to the routine-findings
  carrier (default <root>/.quay/routine-findings.jsonl, --findings overrides); the existing
  routine-file-gate decides whether it becomes a task — this command never files one.

  --no-history  take the reading and the judgment but write NOTHING (no record ⇒ no finding: a finding
                cites a record that must exist).

  exit 0 = record produced, evaluated:true   exit 3 = record produced, NOT-EVALUATED (a distinct value)
  exit 4 = history carrier not writable      exit 5 = findings carrier not writable
  exit 2 = usage / input error`;

export interface DesignEvolutionSectionConfig {
  enabled: boolean;
  /** null when disabled (the routine does not participate in scheduling). */
  intervalMinutes: number | null;
  subsystems: SubsystemSpec[];
  topN: number;
  /** `dark_streak_rounds` — how many CONSECUTIVE `evaluated:false` rounds make a subsystem's darkness
   *  a finding. The default is defined ONCE (`DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT`); this key
   *  only overrides it. ⛔ It is a policy about when to spend attention, not a measured threshold. */
  darkStreakRounds: number;
}

export interface SectionRead {
  present: boolean;
  config: DesignEvolutionSectionConfig | null;
  error: string | null;
}

export const cfgBad = (msg: string) => `loop.design_evolution_readings ${msg}`;

/** Parse one subsystem entry. Unknown/misspelled keys are REFUSED (a silently ignored `module:`
 *  would make a subsystem read as "no module files" — the exact failure this task exists to remove). */
export function parseSubsystemEntry(raw: unknown, index: number): { spec: SubsystemSpec | null; error: string | null } {
  const where = `subsystems[${index}]`;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { spec: null, error: cfgBad(`${where} must be a mapping`) };
  }
  const rec = raw as Record<string, unknown>;
  const known = new Set(["name", "baseline", "head", "central", "modules"]);
  const unknown = Object.keys(rec).filter((k) => !known.has(k));
  if (unknown.length > 0) return { spec: null, error: cfgBad(`${where} has unknown key(s): ${unknown.join(", ")}`) };
  if (typeof rec.name !== "string" || rec.name.trim() === "") return { spec: null, error: cfgBad(`${where}.name must be a non-empty string`) };
  if (typeof rec.baseline !== "string" || rec.baseline.trim() === "") return { spec: null, error: cfgBad(`${where}.baseline must be a non-empty commit-ish string`) };
  if (rec.head !== undefined && (typeof rec.head !== "string" || rec.head.trim() === "")) {
    return { spec: null, error: cfgBad(`${where}.head must be a non-empty commit-ish string when present`) };
  }
  if (!Array.isArray(rec.central) || rec.central.length === 0) {
    return { spec: null, error: cfgBad(`${where}.central must be a non-empty list (a path, or {at_baseline, at_head})`) };
  }
  const central: CentralFileSpec[] = [];
  for (const [j, c] of (rec.central as unknown[]).entries()) {
    if (typeof c === "string" && c !== "") {
      central.push({ atBaseline: c, atHead: c });
      continue;
    }
    if (c !== null && typeof c === "object" && !Array.isArray(c)) {
      const o = c as Record<string, unknown>;
      const extra = Object.keys(o).filter((k) => k !== "at_baseline" && k !== "at_head");
      if (extra.length > 0) return { spec: null, error: cfgBad(`${where}.central[${j}] has unknown key(s): ${extra.join(", ")}`) };
      if (typeof o.at_baseline !== "string" || o.at_baseline === "" || typeof o.at_head !== "string" || o.at_head === "") {
        return { spec: null, error: cfgBad(`${where}.central[${j}] needs non-empty 'at_baseline' and 'at_head'`) };
      }
      central.push({ atBaseline: o.at_baseline, atHead: o.at_head });
      continue;
    }
    return { spec: null, error: cfgBad(`${where}.central[${j}] must be a path or a mapping with 'at_baseline'/'at_head'`) };
  }
  if (!Array.isArray(rec.modules) || rec.modules.length === 0 || !(rec.modules as unknown[]).every((m) => typeof m === "string" && m !== "")) {
    return { spec: null, error: cfgBad(`${where}.modules must be a non-empty list of path globs`) };
  }
  return {
    spec: {
      name: rec.name,
      baseline: rec.baseline,
      ...(typeof rec.head === "string" ? { head: rec.head } : {}),
      central,
      modules: rec.modules as string[],
    },
    error: null,
  };
}

/** Pure parse of a `design_evolution_readings` section (the mapping under `loop:`).
 *  Same family semantics as `parseArchCycleSection`:
 *   • `enabled` is REQUIRED and boolean; `enabled:false` returns immediately (the kill switch must
 *     win even when other keys are malformed — otherwise a typo silently keeps the routine writing);
 *   • `interval` is optional (default 360m) but once declared must be `interval:<N>m` and ≥ the floor
 *     — a malformed interval is REFUSED, never silently rounded back to the default;
 *   • `subsystems` and `top_n` are optional; a malformed entry is an error, never dropped. */
export function parseDesignEvolutionSection(raw: unknown): { config: SectionRead["config"]; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, error: cfgBad(`must be a mapping (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`) };
  }
  const rec = raw as Record<string, unknown>;
  const known = new Set(["enabled", "interval", "subsystems", "top_n", "dark_streak_rounds"]);
  const unknown = Object.keys(rec).filter((k) => !known.has(k));
  if (unknown.length > 0) return { config: null, error: cfgBad(`has unknown key(s): ${unknown.join(", ")} — a silently ignored key would make the reading lie`) };
  if (typeof rec.enabled !== "boolean") {
    return { config: null, error: cfgBad(`needs a boolean 'enabled' (got ${rec.enabled === undefined ? "missing" : JSON.stringify(rec.enabled)})`) };
  }
  if (rec.enabled === false) {
    return {
      config: { enabled: false, intervalMinutes: null, subsystems: [], topN: CONTENTION_TOP_N_DEFAULT, darkStreakRounds: DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT },
      error: null,
    };
  }

  let intervalMinutes = DESIGN_EVOLUTION_INTERVAL_MIN_DEFAULT;
  if (rec.interval !== undefined && rec.interval !== null) {
    if (typeof rec.interval !== "string") {
      return { config: null, error: cfgBad(`'interval' must be a string of the form interval:<N>m (got ${JSON.stringify(rec.interval)})`) };
    }
    const m = /^interval:(\d+)m$/.exec(rec.interval);
    if (m === null) return { config: null, error: cfgBad(`'interval' must be interval:<N>m (got '${rec.interval}')`) };
    intervalMinutes = Number(m[1]);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < DESIGN_EVOLUTION_MIN_INTERVAL_MINUTES) {
      return { config: null, error: cfgBad(`interval ${rec.interval} is below the ${DESIGN_EVOLUTION_MIN_INTERVAL_MINUTES}m floor — refused, not silently rounded`) };
    }
  }

  let topN = CONTENTION_TOP_N_DEFAULT;
  if (rec.top_n !== undefined && rec.top_n !== null) {
    if (typeof rec.top_n !== "number" || !Number.isInteger(rec.top_n) || rec.top_n < 1) {
      return { config: null, error: cfgBad(`'top_n' must be a positive integer (got ${JSON.stringify(rec.top_n)})`) };
    }
    topN = rec.top_n;
  }

  // ⚠️ A malformed value is REFUSED, never silently rounded back to the default (the same rule this
  // section applies to `interval`): a `dark_streak_rounds: 0` would make every dark round a finding,
  // and a typo that silently became 2 would hide the operator's intent.
  let darkStreakRounds = DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT;
  if (rec.dark_streak_rounds !== undefined && rec.dark_streak_rounds !== null) {
    if (typeof rec.dark_streak_rounds !== "number" || !Number.isInteger(rec.dark_streak_rounds) || rec.dark_streak_rounds < 1) {
      return { config: null, error: cfgBad(`'dark_streak_rounds' must be a positive integer (got ${JSON.stringify(rec.dark_streak_rounds)})`) };
    }
    darkStreakRounds = rec.dark_streak_rounds;
  }

  const subsystems: SubsystemSpec[] = [];
  if (rec.subsystems !== undefined && rec.subsystems !== null) {
    if (!Array.isArray(rec.subsystems)) return { config: null, error: cfgBad(`'subsystems' must be a list`) };
    for (const [i, entry] of (rec.subsystems as unknown[]).entries()) {
      const parsed = parseSubsystemEntry(entry, i);
      if (parsed.error !== null || parsed.spec === null) return { config: null, error: parsed.error ?? cfgBad(`subsystems[${i}] is invalid`) };
      if (subsystems.some((s) => s.name === parsed.spec!.name)) {
        return { config: null, error: cfgBad(`duplicate subsystem name '${parsed.spec.name}' — the carrier would carry two rows with one key`) };
      }
      subsystems.push(parsed.spec);
    }
  }
  return { config: { enabled: true, intervalMinutes, subsystems, topN, darkStreakRounds }, error: null };
}

/** Read the section from `<root>/.quay/config.yml` (absent file / absent `loop:` / absent section ⇒
 *  `present:false`; unparseable YAML ⇒ `error`, fail-closed). */
export function readDesignEvolutionConfig(workspaceRoot: string): SectionRead {
  const file = path.join(workspaceRoot, ".quay", "config.yml");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { present: false, config: null, error: null };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (e) {
    return { present: true, config: null, error: `.quay/config.yml is not valid YAML — ${(e as Error).message}` };
  }
  const loop = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).loop : undefined;
  if (loop === null || loop === undefined) return { present: false, config: null, error: null };
  if (typeof loop !== "object" || Array.isArray(loop)) return { present: true, config: null, error: "FAIL-CLOSED: .quay/config.yml 'loop:' must be a mapping" };
  const raw = (loop as Record<string, unknown>).design_evolution_readings;
  if (raw === undefined || raw === null) return { present: false, config: null, error: null };
  const { config, error } = parseDesignEvolutionSection(raw);
  return { present: true, config, error };
}

/** Read a STANDALONE section body (the `--config` seam). Same parser, same error vocabulary. */
export function readStandaloneSection(file: string): SectionRead {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { present: true, config: null, error: `--config ${file} is unreadable — ${(e as Error).message}` };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (e) {
    return { present: true, config: null, error: `--config ${file} is not valid YAML — ${(e as Error).message}` };
  }
  const { config, error } = parseDesignEvolutionSection(parsed);
  return { present: true, config, error };
}

function renderHuman(record: DesignEvolutionReadingsRecord, findings: readonly EvolutionFinding[] = []): string {
  const out: string[] = [];
  out.push(`design-evolution-readings  evaluated=${record.evaluated}  ts=${record.ts}`);
  if (record.reason !== null) out.push(`  reason: ${record.reason}`);
  // The judgment comes RIGHT AFTER the round header: the reading is the input, the verdict is what
  // the mechanism now does with it, and a reader must not have to scroll past 40 lines of RM1 detail
  // to find out whether anything was filed.
  const v = record.evolution;
  out.push("JUDGMENT — 本轮相对上一条读数");
  if (v === undefined) {
    out.push("  (not taken — this record predates the judgment)");
  } else {
    out.push(`  state=${v.state}  prior=${v.priorTs ?? "(none)"}  priorState=${v.priorState}  darkStreakRounds=${v.darkStreakRounds}`);
    out.push(`  ${v.summary}`);
    if (v.reason !== null) out.push(`  reason: ${v.reason}`);
    for (const r of v.subsystems) {
      const d =
        r.deltaCentral === null
          ? ""
          : `  Δcentral=${r.deltaCentral >= 0 ? "+" : ""}${r.deltaCentral} ΔnonCentral=${r.deltaNonCentral === null ? "?" : (r.deltaNonCentral >= 0 ? "+" : "") + r.deltaNonCentral} Δdenominator=${r.deltaDenominator === null ? "?" : (r.deltaDenominator >= 0 ? "+" : "") + r.deltaDenominator}`;
      out.push(`    ${r.name}: ${r.state}${d}${r.sharePercent === null ? "" : `  share=${r.sharePercent}%`}${r.reason === null ? "" : `  — ${r.reason}`}`);
    }
    out.push(`  findings: ${findings.length}`);
    for (const f of findings) out.push(`    ${f.key}  files=${f.files.length > 0 ? f.files.join(", ") : "(none)"}`);
  }
  out.push("RM1 — 分解后增量落回中心文件的占比  share = centralΔ / (centralΔ + nonCentralΔ)");
  if (record.rm1.subsystems.length === 0) out.push(`  (none declared) ${record.rm1.reason ?? ""}`);
  for (const s of record.rm1.subsystems) {
    if (!s.evaluated) {
      out.push(`  ${s.name}: NOT-EVALUATED — ${s.reason}`);
      continue;
    }
    const cp = s.centralDelta ?? 0;
    const np = s.nonCentralDelta ?? 0;
    out.push(
      `  ${s.name}: centralΔ=${cp >= 0 ? "+" : ""}${cp} nonCentralΔ=${np >= 0 ? "+" : ""}${np} share=${s.sharePercentRounded}% (${(s.sharePercent ?? 0).toFixed(2)}%)  [${s.baseline} → ${s.head} (${s.headSha?.slice(0, 9)}), ${s.moduleFileCount} module files]`,
    );
    for (const c of s.centralFiles) {
      out.push(`    central ${c.atBaseline}${c.atHead !== c.atBaseline ? ` → ${c.atHead}` : ""}: ${c.baselineLines} → ${c.headLines} (${c.delta >= 0 ? "+" : ""}${c.delta})`);
    }
    const m = s.maxCentralChangeCommit;
    out.push(m === null ? "    largest central change in window: (unavailable)" : `    largest central change in window: ${m.sha.slice(0, 9)} centralΔ=${m.centralDelta >= 0 ? "+" : ""}${m.centralDelta} nonCentralΔ=${m.nonCentralDelta >= 0 ? "+" : ""}${m.nonCentralDelta}`);
    if (s.oppositeSignCommits === null) out.push("    opposite-sign commits in window: (unavailable)");
    else if (s.oppositeSignCommits.length === 0) out.push("    opposite-sign commits in window: (none)");
    else {
      out.push(`    opposite-sign commits in window (centralΔ<0 ∧ nonCentralΔ>0): ${s.oppositeSignCommits.length}`);
      for (const c of s.oppositeSignCommits) {
        out.push(`      ${c.sha.slice(0, 9)} centralΔ=${c.centralDelta} nonCentralΔ=+${c.nonCentralDelta}  ${c.subject}`);
      }
    }
  }
  out.push(`RM2 — 热点文件并发争用  carrier=${record.rm2.carrierPath}`);
  if (!record.rm2.evaluated) out.push(`  NOT-EVALUATED — ${record.rm2.reason}`);
  else {
    out.push(`  ${record.rm2.carrierRecords} records, window starts at #${record.rm2.windowStartIndex} (${record.rm2.windowSource}); predicate self-check ${record.rm2.predicateSelfCheck.ok ? "PASS" : "FAIL"}`);
    if (record.rm2.reason !== null) out.push(`  note: ${record.rm2.reason}`);
    for (const f of record.rm2.files) {
      out.push(`  ${f.file}: form1=${f.form1} form2=${f.form2} total=${f.total} (window ${f.windowTotal})`);
      out.push(`    observed: ${f.observedPaths.length > 0 ? f.observedPaths.join(", ") : "(none)"}`);
      for (const form of ["form1", "form2"] as const) {
        for (const smp of f.samples[form]) out.push(`    [${form}] #${smp.recordIndex} ${smp.task ?? "?"} ${smp.ts ?? "?"}`);
      }
    }
    if (record.rm2.unresolvedPaths.length > 0) {
      out.push(`  unresolved paths (⛔ not merged into any key): ${record.rm2.unresolvedPaths.length}`);
      for (const u of record.rm2.unresolvedPaths) out.push(`    ${u.raw} — ${u.reason}`);
    }
  }
  // ATTACHED reading (gap-adr008-phase-declaration-staleness-reading): content, never a verdict.
  const ps = record.phaseStaleness;
  out.push(`PHASE-STALENESS (ADR-008 declaration, read-only; ⛔ never a gate)`);
  if (!ps.evaluated) out.push(`  NOT-EVALUATED — ${ps.reason}`);
  else out.push(`  phase=${ps.phase} declaredAt=${ps.declaredAt} commits=${ps.commitsSince} newGoals=${ps.newGoalsSince?.length ?? 0} days=${ps.daysSince}`);
  return out.join("\n");
}

export function main(argv: string[]): number {
  let rootArg: string | undefined;
  let configPath: string | undefined;
  let historyPath: string | undefined;
  let findingsPath: string | undefined;
  let carrierPath: string | undefined;
  let head: string | undefined;
  let topN: number | undefined;
  let json = false;
  let noHistory = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      rootArg = argv[++i];
      if (rootArg === undefined) {
        process.stderr.write(`design-evolution-readings: --root requires a path\n${USAGE}\n`);
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--config") {
      configPath = argv[++i];
      if (configPath === undefined) {
        process.stderr.write(`design-evolution-readings: --config requires a path\n${USAGE}\n`);
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--history") {
      historyPath = argv[++i];
      if (historyPath === undefined) {
        process.stderr.write(`design-evolution-readings: --history requires a path\n${USAGE}\n`);
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--findings") {
      findingsPath = argv[++i];
      if (findingsPath === undefined) {
        process.stderr.write(`design-evolution-readings: --findings requires a path\n${USAGE}\n`);
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--carrier") {
      carrierPath = argv[++i];
      if (carrierPath === undefined) {
        process.stderr.write(`design-evolution-readings: --carrier requires a path\n${USAGE}\n`);
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--head") {
      head = argv[++i];
      if (head === undefined) {
        process.stderr.write(`design-evolution-readings: --head requires a rev\n${USAGE}\n`);
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--top-n") {
      const raw = argv[++i];
      const n = raw === undefined ? NaN : Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        process.stderr.write(`design-evolution-readings: --top-n requires a positive integer\n${USAGE}\n`);
        return EXIT_USAGE;
      }
      topN = n;
      continue;
    }
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--no-history") {
      noHistory = true;
      continue;
    }
    if (a.startsWith("--")) {
      process.stderr.write(`design-evolution-readings: unknown flag ${a}\n${USAGE}\n`);
      return EXIT_USAGE;
    }
    if (rootArg !== undefined) {
      process.stderr.write(`design-evolution-readings: unexpected extra argument ${a}\n${USAGE}\n`);
      return EXIT_USAGE;
    }
    rootArg = a;
  }

  const root = path.resolve(rootArg ?? findRepoRoot());
  const section = configPath !== undefined ? readStandaloneSection(configPath) : readDesignEvolutionConfig(root);
  if (section.error !== null) {
    process.stderr.write(`design-evolution-readings: ${section.error}\n`);
    return EXIT_USAGE;
  }
  if (!section.present || section.config === null) {
    process.stderr.write(
      "design-evolution-readings: no design_evolution_readings section declared (neither --config nor .quay/config.yml). RM1 needs declared subsystems; RTFM the task body's config example.\n",
    );
    return EXIT_USAGE;
  }
  if (!section.config.enabled) {
    process.stderr.write("design-evolution-readings: enabled:false — kill switch engaged, zero reading, zero write\n");
    return EXIT_OK;
  }

  // ONE orchestration with the routine (`takeEvolutionRound`): the direct entry must produce the
  // SAME judgment and the SAME findings, or 「人手工跑的读数」 and 「例程跑的读数」 become two mechanisms.
  const taken = takeEvolutionRound(root, {
    subsystems: section.config.subsystems,
    topN: topN ?? section.config.topN,
    darkStreakRounds: section.config.darkStreakRounds,
    ...(head ? { head } : {}),
    ...(historyPath ? { historyPath } : {}),
    ...(findingsPath ? { findingsPath } : {}),
    ...(carrierPath ? { carrierPath } : {}),
    ...(noHistory ? { persist: false } : {}),
  });
  const { record } = taken;

  process.stdout.write((json ? JSON.stringify(record, null, 2) : renderHuman(record, taken.findings)) + "\n");
  if (!noHistory) {
    if (!taken.history.appended) {
      process.stderr.write(`design-evolution-readings: history carrier not writable at ${taken.history.path} — ${taken.history.error}\n`);
      return EXIT_HISTORY_WRITE_FAILED;
    }
    process.stderr.write(`design-evolution-readings: record appended to ${taken.history.path}\n`);
    if (!taken.findingsCarrier.ok) {
      process.stderr.write(
        `design-evolution-readings: findings carrier not writable at ${taken.findingsCarrier.path} — ${taken.findingsCarrier.error} (the reading landed; ${taken.findings.length} finding(s) did NOT)\n`,
      );
      return EXIT_FINDINGS_WRITE_FAILED;
    }
    if (taken.findingsCarrier.appended > 0) {
      process.stderr.write(`design-evolution-readings: ${taken.findingsCarrier.appended} finding(s) appended to ${taken.findingsCarrier.path}\n`);
    }
  }
  return record.evaluated ? EXIT_OK : EXIT_NOT_EVALUATED;
}

if (isDirectEntry(import.meta, process.argv[1], "design-evolution-readings")) {
  process.exitCode = main(process.argv.slice(2));
}
