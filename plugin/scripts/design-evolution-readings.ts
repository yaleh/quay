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
// ── REPORT ONLY, NEVER A GATE ─────────────────────────────────────────────────────────────────────
// Following `arch-coverage-report.ts` / `arch-cycle-report` (the same family): a non-zero share or a
// non-zero contention count is the reading's CONTENT, ⛔ not `failed`. No ratchet here, and no numeric
// threshold that would auto-judge "is this a move?" (硬规则 4 推论: no thresholds for an unmeasured
// cost structure). Instead every line carries the window's single largest central-file commit so a
// reader can SEE a move in the data rather than trust a classifier.
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

  const denominator = centralDelta + nonCentralDelta;
  if (denominator <= 0) {
    return unevaluated(
      `non-positive-denominator: centralΔ=${centralDelta} nonCentralΔ=${nonCentralDelta} (sum ${denominator}) — a share of a non-growing subsystem is not a reading`,
      { ...shas, centralFiles, moduleFileCount: moduleFiles.length, newModuleFiles },
    );
  }
  const share = centralDelta / denominator;

  // The window's single largest central-file change. `--no-renames` keeps the per-commit paths
  // literal (with rename detection a moved file appears as `old => new`, which matches neither
  // declared path and would silently read 0). Merge commits contribute no numstat by git's default —
  // the changes are counted on the commits that actually carry them, which is what we want.
  const maxCentralChangeCommit = largestCentralChangeCommit(
    root,
    baseline.sha,
    head.sha,
    centralPaths,
    matchesModules,
    [...new Set([...centralPaths, ...spec.modules])],
  );

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
  };
}

/** Per-commit net line deltas via `git log --numstat --no-renames`, reduced to the largest
 *  |centralΔ|. Exported for the test seam; never throws (a git failure yields null — the reading
 *  itself is still valid, only this auxiliary field is not, and null says so). */
export function largestCentralChangeCommit(
  root: string,
  baseSha: string,
  headSha: string,
  centralPaths: ReadonlySet<string>,
  matchesModules: (p: string) => boolean,
  pathFilter: string[] = [],
): MaxCentralChangeCommit | null {
  // The pathspec is a SUPERSET filter (git's `*` crosses `/`, ours does not), so it can only remove
  // rows we would have ignored anyway — it keeps `--numstat` from streaming every file of every
  // commit in a months-long window.
  const spec = pathFilter.length > 0 ? ["--", ...pathFilter] : [];
  const r = gitRead(root, ["log", "--numstat", "--no-renames", "--format=%x00%H", `${baseSha}..${headSha}`, ...spec]);
  if (!r.ok) return null;
  let best: MaxCentralChangeCommit | null = null;
  for (const chunk of r.stdout.split("\0")) {
    const lines = chunk.split("\n");
    const sha = (lines.shift() ?? "").trim();
    if (sha === "") continue;
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
    if (best === null || Math.abs(centralDelta) > Math.abs(best.centralDelta)) {
      best = { sha, centralDelta, nonCentralDelta };
    }
  }
  return best;
}

// ── RM2 ────────────────────────────────────────────────────────────────────────────────────────────

/** A path-looking token. Deliberately extension-anchored: prose mentions of a symbol are not files. */
const PATH_TOKEN_RE = /[A-Za-z0-9_./-]+\.(?:ts|tsx|mts|cts|js|mjs|cjs|sh|json|jsonl|md|yml|yaml|py|toml)/g;
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

/** Basenames of the path tokens in `text` (deduped, order preserved). Aggregating by BASENAME is
 *  deliberate: form 1 names `worker-driver.ts` while form 2 quotes `plugin/scripts/worker-driver.ts`;
 *  one file must not appear twice. The full spellings seen are preserved on the reading
 *  (`observedPaths`), so the merge is visible rather than hidden. */
export function pathTokens(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.match(PATH_TOKEN_RE) ?? []) {
    const bare = m.replace(/^\.\//, "").split("/").pop();
    if (bare !== undefined && bare !== "") seen.add(bare);
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
        const bare = m[1].replace(/^\.\//, "").split("/").pop();
        if (bare !== undefined && bare !== "") files.add(bare);
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
    "内置已知为真的样本行：避开 design-evolution-selfcheck.ts 的争用（predicate self-check, not a real dispatch）",
  mechanical_fan_in: {
    reason:
      "Auto-merging plugin/scripts/design-evolution-selfcheck.ts\nCONFLICT (content): Merge conflict in plugin/scripts/design-evolution-selfcheck.ts",
  },
});
export const PREDICATE_SELFCHECK_PATH = "design-evolution-selfcheck.ts";

export interface ContentionSample {
  task: string | null;
  ts: string | null;
  recordIndex: number;
}

export interface ContentionFileReading {
  file: string;
  form1: number;
  form2: number;
  total: number;
  windowForm1: number;
  windowForm2: number;
  windowTotal: number;
  samples: { form1: ContentionSample[]; form2: ContentionSample[] };
  /** The distinct path spellings folded into this basename key. */
  observedPaths: string[];
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
  predicateSelfCheck: { ok: boolean; form1: boolean; form2: boolean };
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
      predicateSelfCheck,
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
      predicateSelfCheck,
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

  rows.forEach((record, index) => {
    // ONE record contributes at most ONE hit per file per shape.
    for (const file of new Set(predicates.form1Files(record))) touch(file, record, index, "form1");
    for (const file of new Set(predicates.form2Files(record))) touch(file, record, index, "form2");
    // Remember every spelling observed for the basename key (form 1's short name vs form 2's path).
    for (const s of collectStrings(record)) {
      for (const m of s.match(PATH_TOKEN_RE) ?? []) {
        const bare = m.replace(/^\.\//, "").split("/").pop();
        const a = bare === undefined ? undefined : agg.get(bare);
        if (a !== undefined) a.observedPaths.add(m.replace(/^\.\//, ""));
      }
    }
  });

  const files: ContentionFileReading[] = [...agg.entries()]
    .map(([file, a]) => ({
      file,
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
    predicateSelfCheck,
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
  return {
    ts: opts.ts ?? new Date().toISOString(),
    mode: DESIGN_EVOLUTION_MODE,
    evaluated,
    reason,
    head: subsystems[0]?.headSha ?? null,
    rm1: { evaluated: rm1Evaluated, reason: rm1Reason, subsystems },
    rm2,
    carrierRecords: rm2.carrierRecords,
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

// ── Direct entry ──────────────────────────────────────────────────────────────────────────────────

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_NOT_EVALUATED = 3;
export const EXIT_HISTORY_WRITE_FAILED = 4;

const USAGE = `usage: design-evolution-readings [--root <repo>] [--config <section.yml>] [--head <rev>]
                                   [--top-n <n>] [--history <path>] [--no-history] [--json]

  RM1 (decomposition share) is taken for every subsystem declared in the \`design_evolution_readings\`
  section (--config points at a file holding the SECTION BODY; default: the \`loop.\` section of
  <root>/.quay/config.yml). RM2 (hot-file contention) is zero-config and always taken from
  <root>/.quay/worker-outcome.jsonl.

  exit 0 = record produced, evaluated:true   exit 3 = record produced, NOT-EVALUATED (a distinct value)
  exit 4 = history carrier not writable      exit 2 = usage / input error`;

export interface DesignEvolutionSectionConfig {
  enabled: boolean;
  /** null when disabled (the routine does not participate in scheduling). */
  intervalMinutes: number | null;
  subsystems: SubsystemSpec[];
  topN: number;
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
  const known = new Set(["enabled", "interval", "subsystems", "top_n"]);
  const unknown = Object.keys(rec).filter((k) => !known.has(k));
  if (unknown.length > 0) return { config: null, error: cfgBad(`has unknown key(s): ${unknown.join(", ")} — a silently ignored key would make the reading lie`) };
  if (typeof rec.enabled !== "boolean") {
    return { config: null, error: cfgBad(`needs a boolean 'enabled' (got ${rec.enabled === undefined ? "missing" : JSON.stringify(rec.enabled)})`) };
  }
  if (rec.enabled === false) return { config: { enabled: false, intervalMinutes: null, subsystems: [], topN: CONTENTION_TOP_N_DEFAULT }, error: null };

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
  return { config: { enabled: true, intervalMinutes, subsystems, topN }, error: null };
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

function renderHuman(record: DesignEvolutionReadingsRecord): string {
  const out: string[] = [];
  out.push(`design-evolution-readings  evaluated=${record.evaluated}  ts=${record.ts}`);
  if (record.reason !== null) out.push(`  reason: ${record.reason}`);
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
  }
  out.push(`RM2 — 热点文件并发争用  carrier=${record.rm2.carrierPath}`);
  if (!record.rm2.evaluated) out.push(`  NOT-EVALUATED — ${record.rm2.reason}`);
  else {
    out.push(`  ${record.rm2.carrierRecords} records, window starts at #${record.rm2.windowStartIndex} (${record.rm2.windowSource}); predicate self-check ${record.rm2.predicateSelfCheck.ok ? "PASS" : "FAIL"}`);
    if (record.rm2.reason !== null) out.push(`  note: ${record.rm2.reason}`);
    for (const f of record.rm2.files) {
      out.push(`  ${f.file}: form1=${f.form1} form2=${f.form2} total=${f.total} (window ${f.windowTotal})`);
      for (const form of ["form1", "form2"] as const) {
        for (const smp of f.samples[form]) out.push(`    [${form}] #${smp.recordIndex} ${smp.task ?? "?"} ${smp.ts ?? "?"}`);
      }
    }
  }
  return out.join("\n");
}

export function main(argv: string[]): number {
  let rootArg: string | undefined;
  let configPath: string | undefined;
  let historyPath: string | undefined;
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

  const previous = readPreviousWindow(root, historyPath ? { historyPath } : {});
  const record = buildReadings(root, {
    subsystems: section.config.subsystems,
    topN: topN ?? section.config.topN,
    ...(head ? { head } : {}),
    windowStartIndex: previous.windowStartIndex,
    windowSource: previous.windowSource,
  });

  process.stdout.write((json ? JSON.stringify(record, null, 2) : renderHuman(record)) + "\n");
  if (!noHistory) {
    const appended = appendHistoryRecord(root, record, historyPath ? { historyPath } : {});
    if (!appended.ok) {
      process.stderr.write(`design-evolution-readings: history carrier not writable at ${appended.path} — ${appended.error}\n`);
      return EXIT_HISTORY_WRITE_FAILED;
    }
    process.stderr.write(`design-evolution-readings: record appended to ${appended.path}\n`);
  }
  return record.evaluated ? EXIT_OK : EXIT_NOT_EVALUATED;
}

if (isDirectEntry(import.meta, process.argv[1], "design-evolution-readings")) {
  process.exitCode = main(process.argv.slice(2));
}
