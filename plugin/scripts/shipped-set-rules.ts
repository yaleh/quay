#!/usr/bin/env node
// shipped-set-rules.ts — the ONE implementation of "what does NOT ship in the plugin artifact",
// and of the shrink-only size ratchet over what DOES ship.
//
// (tasks/gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-size-ratchet;
//  GOAL-029 「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」,人 2026-10-07 裁定.)
//
// THE DEFECT THIS CLOSES (measured, not impression — 0.17.0 发布形态产物):
//   plugin/scripts/publish-dist-branch.sh assembled the orphan branch with a bare
//   `rsync -a --exclude='.git' "${PLUGIN_DIR}/" "${WORK}/"` — the WHOLE plugin/ tree. The
//   published artifact was 66 MB / 1062 files, of which 641 were test/fixture files (11.7 MB),
//   93 were checker-mutation cases, and the rest included every dev-period
//   baseline/exception/violation manifest. Verification and delivery tooling was shipped as
//   product, and NOTHING watched the number (硬规则 3b: an unread quantity is not a checked one).
//
// TWO READINGS, ONE RULE SET (plugin/shipped-set-rules.txt, parsed here and nowhere else):
//   ① `forbidden` — paths PRESENT in an artifact that a rule excludes, aggregated into the three
//      ratchet axes (files / bytes / `.sh` code lines). On a correct publish this is ZERO; it is
//      non-zero exactly when the assembly step regressed. A SHRINK-ONLY ratchet against
//      `plugin/shipped-set-baseline.json` (the same shape as plugin/scripts/sh-census-check.ts:
//      reading > baseline ⇒ red, and a WORKING-TREE baseline raised past git HEAD's ⇒ red, so
//      「调高基线」 alone cannot buy a pass).
//   ② `totals`    — the artifact's OWN files / bytes / `.sh` code lines. Recorded in the baseline
//      and compared by the RELEASE GATE (`verify-plugin-channel-assertions.ts`) against the
//      recorded clean reading.
//
// ⛔ WHY THE RATCHET'S AXES ARE THE FORBIDDEN READING AND NOT THE ARTIFACT'S OWN TOTALS
// (measured 2026-10-07, and the reason this module does not gate the totals on every run): the
// artifact is dominated by 112 REGENERATED `dist/*.js` bundles (~36 MB of the 54 MB total) plus the
// vendored prebuilts, so its byte count moves whenever ANY bundled source changes. Measured churn
// on develop over the preceding 2 days: 41 commits touching the artifact's build inputs, 23 touching
// the hand-authored shipped content alone — i.e. ~1 commit/hour at the narrowest scope. A per-run
// exact ratchet there would fire on unrelated code edits, and a ratchet that fires on unrelated
// edits is re-anchored blindly until it means nothing (硬规则 4: a quantity that moves for reasons
// other than the thing it guards is not a measurement of that thing). The forbidden reading is the
// one that is EXACTLY zero by policy, so the shrink-only ceiling is meaningful at every cadence; the
// size ceiling is enforced where a human is in the loop (the release gate). Both live in the same
// baseline file, so neither can drift from the other.
//
// ⛔ THREE-VALUED (硬规则 3b): `evaluated:false` when the artifact, the rule file, or the baseline
// could not be read — NEVER folded into "clean". A rules file that parsed to ZERO rules is
// likewise `evaluated:false`: with no rules nothing is forbidden, and a PASS from that state is a
// false assurance of exactly the kind this checker exists to remove.
//
// ⛔ The `.sh` line count reuses `countCodeLines` from sh-census-check.ts — ONE definition of
// "code line" (blank lines and pure-comment lines excluded), not a second copy (硬规则 5b).
//
// CLI:
//   node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --check <artifactDir> [--json]
//   node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --print-rsync-excludes
//   node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --reanchor <artifactDir> [--why <text>]
// exit 0 = clean and within baseline · 1 = forbidden content present / over baseline / baseline
// raised · 2 = usage or NOT-EVALUATED (unreadable artifact, rules, or baseline).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { helpExit, isDirectEntry, flagValue } from "./gate-script-base.ts";
import { countCodeLines } from "./sh-census-check.ts";

export const RULES_FILE_REL = "plugin/shipped-set-rules.txt";
export const BASELINE_FILE_REL = "plugin/shipped-set-baseline.json";

// ── the rules ────────────────────────────────────────────────────────────────────────────────────

export interface ShippedSetRule {
  /** The verbatim line, trailing `/` included — this is what becomes an rsync `--exclude` arg. */
  raw: string;
  dirOnly: boolean;
  /** A pattern carrying an internal `/` is anchored at the artifact root (rsync's own rule). */
  anchored: boolean;
  /** `raw` with the directory marker stripped; the glob the matcher compiles. */
  glob: string;
}

/** Parse the rule file. Blank and `#`-comment lines are ignored; every other line is a rule.
 *  Returns `[]` for a text with no rules (the caller reports that as NOT-EVALUATED, never PASS). */
export function parseRules(text: string): ShippedSetRule[] {
  const rules: ShippedSetRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const dirOnly = line.endsWith("/");
    const glob = dirOnly ? line.slice(0, -1) : line;
    rules.push({ raw: line, dirOnly, anchored: glob.includes("/"), glob });
  }
  return rules;
}

/** rsync's glob, spelled once: `*` never crosses `/`, `?` is one non-`/` character. */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (const ch of glob) {
    if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** Does ONE rule match this artifact-relative path? `dirOnly` rules only ever match directories. */
export function ruleMatches(rule: ShippedSetRule, rel: string, isDir: boolean): boolean {
  if (rule.dirOnly && !isDir) return false;
  const target = rule.anchored ? rel : path.posix.basename(rel);
  return globToRegExp(rule.glob).test(target);
}

/** The first rule that excludes `rel`, or null. First-match (not any-match) so the violation can
 *  name the rule the reader should look at. */
export function firstMatchingRule(rel: string, isDir: boolean, rules: readonly ShippedSetRule[]): ShippedSetRule | null {
  for (const rule of rules) if (ruleMatches(rule, rel, isDir)) return rule;
  return null;
}

export function isExcluded(rel: string, isDir: boolean, rules: readonly ShippedSetRule[]): boolean {
  return firstMatchingRule(rel, isDir, rules) !== null;
}

// ── where the rules + baseline live (SOURCE repo, never the artifact) ─────────────────────────────
//
// The assertion and the test run from the SOURCE checkout by design (publish-dist-branch.sh deletes
// every raw plugin `.ts`, so a checker that lived only in the artifact would not exist there). The
// two files therefore live at the plugin root of whichever tree this module was loaded from. The
// search walks up a few levels so the SAME code works from `plugin/scripts/` (source) and from a
// bundled `plugin/scripts/dist/` (should this ever become an entry) — a single hardcoded `..` would
// be silently wrong in the second layout.

function findUp(start: string, rel: string): string | null {
  let dir = start;
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, ...rel.split("/"));
    if (fs.existsSync(candidate)) return candidate;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function rulesFileAbs(): string {
  return findUp(moduleDir(), RULES_FILE_REL) ?? path.join(moduleDir(), "..", path.basename(RULES_FILE_REL));
}

export function baselineFileAbs(): string {
  return findUp(moduleDir(), BASELINE_FILE_REL) ?? path.join(moduleDir(), "..", path.basename(BASELINE_FILE_REL));
}

/** The source repo root this module is running from — the tree whose git HEAD carries the
 *  committed baseline. `null` when the layout has no repo above the plugin root. */
export function sourceRepoRoot(): string | null {
  const pluginRoot = path.dirname(rulesFileAbs());
  const repoRoot = path.dirname(pluginRoot);
  return fs.existsSync(path.join(repoRoot, "plugin")) ? repoRoot : null;
}

// ── the walk + the reading ───────────────────────────────────────────────────────────────────────

export interface ArtifactEntry {
  /** artifact-relative, POSIX separators. */
  rel: string;
  isDir: boolean;
  /** `lstat` size in bytes. A symlink counts as its link length (an artifact is `rsync -a`
   *  output; nothing here follows links out of the tree). Directories are 0. */
  bytes: number;
}

export interface ShippedSetTotals {
  files: number;
  bytes: number;
  shLines: number;
}

export interface ShippedSetViolation {
  path: string;
  isDir: boolean;
  rule: string;
}

export interface ShippedSetReading {
  /** false ⇒ this is NOT a "clean" reading (硬规则 3b). */
  evaluated: boolean;
  reason?: string;
  /** The artifact's OWN totals — reported, and the size ceiling the release gate compares. */
  totals: ShippedSetTotals;
  /** Aggregated over `violations`: the ratchet's three axes. Zero on a correct publish. */
  forbidden: ShippedSetTotals;
  /** Paths present in the artifact that a rule excludes — must be empty after a correct publish. */
  violations: ShippedSetViolation[];
  /** `.sh` files whose text could not be read (their lines are NOT silently counted as 0). */
  unreadable: string[];
  /** How many rules were in force. Carried so "0 rules" can never read as "nothing forbidden". */
  rulesInForce: number;
}

const EMPTY_TOTALS: ShippedSetTotals = { files: 0, bytes: 0, shLines: 0 };

function notEvaluated(reason: string, rulesInForce = 0): ShippedSetReading {
  return { evaluated: false, reason, totals: { ...EMPTY_TOTALS }, violations: [], unreadable: [], rulesInForce };
}

/** Walk an assembled artifact. Directories are returned too (a `dirOnly` rule needs to see them).
 *
 *  ⛔ The walk ALWAYS descends, even into a violated directory. Stopping at the first offending
 *  directory would make the `totals` a reading of a TRUNCATED tree — and the truncation would be
 *  largest exactly when the artifact is most broken, so the over-baseline message would report a
 *  number smaller than the truth (measured 2026-10-07: a full-tree artifact reported as 290 files
 *  instead of 1062). Violations are therefore collected over the whole tree and reported
 *  shallowest-first, while the totals stay the artifact's real totals. */
export function walkArtifact(root: string, rules: readonly ShippedSetRule[] = []): {
  entries: ArtifactEntry[];
  violations: ShippedSetViolation[];
  unreadable: string[];
} {
  const entries: ArtifactEntry[] = [];
  const violations: ShippedSetViolation[] = [];
  const unreadable: string[] = [];
  const visit = (dir: string, relPrefix: string): void => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      unreadable.push(`${relPrefix || "."}: ${(err as Error).message.split("\n")[0]}`);
      return;
    }
    for (const d of dirents) {
      const rel = relPrefix === "" ? d.name : `${relPrefix}/${d.name}`;
      let isDir = d.isDirectory();
      let bytes = 0;
      try {
        const st = fs.lstatSync(path.join(dir, d.name));
        isDir = st.isDirectory();
        bytes = st.isDirectory() ? 0 : st.size;
      } catch (err) {
        unreadable.push(`${rel}: ${(err as Error).message.split("\n")[0]}`);
        continue;
      }
      entries.push({ rel, isDir, bytes });
      const rule = firstMatchingRule(rel, isDir, rules);
      if (rule !== null) violations.push({ path: rel, isDir, rule: rule.raw });
      if (isDir) visit(path.join(dir, d.name), rel);
    }
  };
  if (!fs.existsSync(root)) return { entries, violations, unreadable };
  visit(root, "");
  // Shallowest first: the offending DIRECTORY is the actionable line; its 500 children are noise.
  violations.sort((a, b) => {
    const da = a.path.split("/").length;
    const db = b.path.split("/").length;
    return da !== db ? da - db : a.path.localeCompare(b.path);
  });
  return { entries, violations, unreadable };
}

/** Read the artifact against the rules: totals + forbidden-present + unreadable. */
export function readShippedSet(artifactRoot: string, rules: readonly ShippedSetRule[]): ShippedSetReading {
  if (rules.length === 0) {
    return notEvaluated(
      "the rule file parsed to ZERO rules — with no rules nothing is forbidden, and a PASS from this state is a false assurance (硬规则 3b)",
    );
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(artifactRoot);
  } catch (err) {
    return notEvaluated(`artifact root is unreadable (${artifactRoot}): ${(err as Error).message.split("\n")[0]}`, rules.length);
  }
  if (!st.isDirectory()) return notEvaluated(`artifact root is not a directory (${artifactRoot})`, rules.length);

  const { entries, violations, unreadable } = walkArtifact(artifactRoot, rules);
  if (entries.length === 0) {
    return notEvaluated(`the artifact at ${artifactRoot} carries no entries — an empty tree is not a clean publish`, rules.length);
  }

  // Per-entry `.sh` code lines: read once, used for BOTH the artifact totals and the forbidden
  // aggregate (a violated subtree's `.sh` lines are part of the forbidden axis).
  const lineFailures: string[] = [];
  const shLinesOf = new Map<string, number>();
  let bytes = 0;
  let files = 0;
  for (const e of entries) {
    if (e.isDir) continue;
    files++;
    bytes += e.bytes;
    if (!e.rel.endsWith(".sh")) continue;
    try {
      shLinesOf.set(e.rel, countCodeLines(fs.readFileSync(path.join(artifactRoot, ...e.rel.split("/")), "utf8")));
    } catch (err) {
      lineFailures.push(`${e.rel}: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  const shLines = [...shLinesOf.values()].reduce((a, b) => a + b, 0);

  // The forbidden aggregate: every FILE at or under a violated path. Ancestor-set membership
  // (never a per-violation subtree sum) so a nested violation — `test/` AND `test/a.test.mjs` both
  // match — cannot count the same file twice.
  const violated = new Set(violations.map((v) => v.path));
  let fFiles = 0;
  let fBytes = 0;
  let fShLines = 0;
  for (const e of entries) {
    if (e.isDir) continue;
    const parts = e.rel.split("/");
    let under = false;
    for (let i = 1; i <= parts.length && !under; i++) under = violated.has(parts.slice(0, i).join("/"));
    if (!under) continue;
    fFiles++;
    fBytes += e.bytes;
    fShLines += shLinesOf.get(e.rel) ?? 0;
  }

  return {
    evaluated: true,
    totals: { files, bytes, shLines },
    forbidden: { files: fFiles, bytes: fBytes, shLines: fShLines },
    violations,
    unreadable: [...unreadable, ...lineFailures],
    rulesInForce: rules.length,
  };
}

export function readRulesFromFile(abs: string): { rules: ShippedSetRule[] } | null {
  try {
    return { rules: parseRules(fs.readFileSync(abs, "utf8")) };
  } catch {
    return null;
  }
}

// ── the ratchet ──────────────────────────────────────────────────────────────────────────────────

export const BASELINE_AXES = ["files", "bytes", "shLines"] as const;
export type BaselineAxis = (typeof BASELINE_AXES)[number];

export interface ShippedSetBaseline {
  /** The ratchet: rule-excluded content PRESENT in the artifact. Exactly 0 on a correct publish. */
  files: number;
  bytes: number;
  shLines: number;
  /** The artifact's OWN totals as last read from a real clean build — the SIZE ceiling the release
   *  gate compares against. Optional so an older baseline file still parses. */
  shipped?: ShippedSetTotals;
}

/** The ratchet's measured value: the forbidden aggregate, never the artifact's own totals. */
export function measuredOf(r: ShippedSetReading): ShippedSetBaseline {
  return { files: r.forbidden.files, bytes: r.forbidden.bytes, shLines: r.forbidden.shLines };
}

/** The artifact's own totals — reported everywhere, and gated by the RELEASE gate only. */
export function shippedOf(r: ShippedSetReading): ShippedSetTotals {
  return { files: r.totals.files, bytes: r.totals.bytes, shLines: r.totals.shLines };
}

/**
 * The axes of the SIZE ceiling. ⛔ `bytes` is deliberately NOT here, and that is a MEASURED
 * conclusion, not a convenience:
 *   · esbuild writes each inlined module's path into the bundle as a comment/key RELATIVE to the
 *     output dir, so the byte total depends on where the build tree sits relative to `node_modules`.
 *     Measured 2026-10-07: the same source, published from a stub whose `node_modules` is symlinked
 *     from elsewhere, produced +225,828 bytes (every yaml-importing bundle +2,448) versus a stub one
 *     directory closer — the artifact's byte count is a HOST-DEPENDENT constant (硬规则 4 推论二).
 *   · the same build run twice differs by ±3 bytes (esbuild module-ordering non-determinism).
 * Neither `files` nor `shLines` has either property, so those two gate; `bytes` is reported.
 */
export const SIZE_GATED_AXES = ["files", "shLines"] as const;
export type SizeAxis = (typeof SIZE_GATED_AXES)[number];

export interface SizeVerdict {
  ok: boolean;
  over: SizeAxis[];
  measured: ShippedSetTotals;
  ceiling: ShippedSetTotals;
  /** Informational only — never gates (see SIZE_GATED_AXES). */
  bytesDelta: number;
}

/** The SIZE ceiling: the artifact's totals against the recorded clean reading. Enforced by the
 *  release gate (a human is in the loop there), NOT by the per-run ratchet — see the churn note at
 *  the top of this file. */
export function judgeShippedSize(measured: ShippedSetTotals, ceiling: ShippedSetTotals): SizeVerdict {
  return {
    ok: SIZE_GATED_AXES.every((k) => measured[k] <= ceiling[k]),
    over: SIZE_GATED_AXES.filter((k) => measured[k] > ceiling[k]),
    measured,
    ceiling,
    bytesDelta: measured.bytes - ceiling.bytes,
  };
}

export interface RatchetVerdict {
  ok: boolean;
  over: BaselineAxis[];
  baselineRaised: BaselineAxis[];
  /** The baseline git HEAD carries (null when HEAD has none, or no repo is resolvable). */
  headBaseline: ShippedSetBaseline | null;
  bootstrap: boolean;
}

function isBaseline(v: unknown): v is ShippedSetBaseline {
  const o = v as Partial<ShippedSetBaseline> | null;
  return (
    !!o &&
    typeof o.files === "number" &&
    typeof o.bytes === "number" &&
    typeof o.shLines === "number"
  );
}

export function readBaselineText(text: string): ShippedSetBaseline | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isBaseline(parsed)) return null;
    const shipped = (parsed as { shipped?: unknown }).shipped;
    const hasShipped = isBaseline(shipped);
    return {
      files: parsed.files,
      bytes: parsed.bytes,
      shLines: parsed.shLines,
      ...(hasShipped ? { shipped: { files: shipped.files, bytes: shipped.bytes, shLines: shipped.shLines } } : {}),
    };
  } catch {
    return null;
  }
}

export function readBaselineFile(abs: string): ShippedSetBaseline | null {
  try {
    return readBaselineText(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

/** The baseline git HEAD carries. A missing file at HEAD is BOOTSTRAP (null + the caller's flag),
 *  not "no ceiling" — callers must not conflate the two. */
export function readHeadBaseline(repoRoot: string, rel: string): ShippedSetBaseline | null {
  try {
    const out = execFileSync("git", ["-C", repoRoot, "show", `HEAD:${rel}`], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return readBaselineText(out);
  } catch {
    return null;
  }
}

/** Shrink-only guard on the BASELINE FILE itself: a working-tree baseline above git HEAD's means
 *  the ceiling was raised in an uncommitted edit — raising it for real takes a commit, which is
 *  the reviewable act (same rule as sh-census-check.ts). */
export function checkBaselineShrinkOnly(
  worktree: ShippedSetBaseline | null,
  head: ShippedSetBaseline | null,
): { raised: BaselineAxis[]; bootstrap: boolean } {
  if (head === null) return { raised: [], bootstrap: true };
  if (worktree === null) return { raised: [], bootstrap: false };
  return { raised: BASELINE_AXES.filter((k) => worktree[k] > head[k]), bootstrap: false };
}

export function judge(
  measured: ShippedSetBaseline,
  baseline: ShippedSetBaseline,
  worktree: ShippedSetBaseline | null,
  head: ShippedSetBaseline | null,
): RatchetVerdict {
  const over = BASELINE_AXES.filter((k) => measured[k] > baseline[k]);
  const shrink = checkBaselineShrinkOnly(worktree, head);
  return {
    ok: over.length === 0 && shrink.raised.length === 0,
    over,
    baselineRaised: shrink.raised,
    headBaseline: head,
    bootstrap: shrink.bootstrap,
  };
}

/** The one reanchor command, quoted into every over-baseline failure message (AC3). */
export function reanchorCommand(artifactRoot: string): string {
  return `node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --reanchor ${artifactRoot}`;
}

/** The failure text for an over-baseline reading: WHICH axis, by HOW MUCH, and the reanchor
 *  command — never just "FAIL". (AC3: the message must name the quantity and the excess.) */
export function overBaselineMessage(measured: ShippedSetBaseline, baseline: ShippedSetBaseline, artifactRoot: string): string {
  const parts = BASELINE_AXES.filter((k) => measured[k] > baseline[k]).map(
    (k) => `${k} ${measured[k]} > baseline ${baseline[k]} (exceeds by ${measured[k] - baseline[k]})`,
  );
  return `${parts.join("; ")} — reanchor with: ${reanchorCommand(artifactRoot)}`;
}

/** The failure text for the SIZE ceiling (the release gate's half). */
export function overSizeMessage(v: SizeVerdict, artifactRoot: string): string {
  const parts = v.over.map((k) => `${k} ${v.measured[k]} > ceiling ${v.ceiling[k]} (exceeds by ${v.measured[k] - v.ceiling[k]})`);
  return `the artifact's size exceeds the recorded clean reading — ${parts.join("; ")} (bytes ${v.measured.bytes}, ${v.bytesDelta >= 0 ? "+" : ""}${v.bytesDelta} vs the recorded ${v.ceiling.bytes}: reported, not gated — see SIZE_GATED_AXES) — reanchor with: ${reanchorCommand(artifactRoot)} (record the before/after run output)`;
}

// ── the CLI ──────────────────────────────────────────────────────────────────────────────────────

const USAGE = `shipped-set-rules.ts — what does NOT ship in the plugin artifact, and its shrink-only ratchet.

Usage:
  node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --check <artifactDir> [--json] [--size-ceiling]
  node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --print-rsync-excludes
  node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --reanchor <artifactDir> [--why <text>]

  --check <dir>       read an assembled artifact: report any rule-excluded path that is PRESENT, the
                      file/byte/.sh-line totals of that forbidden content (the ratchet's axes, against
                      ${BASELINE_FILE_REL}), and the artifact's own totals
  --size-ceiling      ALSO gate the artifact's own totals against the recorded clean reading. ⛔ Off by
                      default: those totals move with every regenerated bundle (measured ~1 build-input
                      commit/hour on develop), so they are gated at RELEASE cadence by
                      verify-plugin-channel-assertions.ts's shipped-set-clean, not per run — see the
                      churn note at the top of this file
  --print-rsync-excludes   one rule per line (publish-dist-branch.sh turns them into --exclude args)
  --reanchor <dir>    write ${BASELINE_FILE_REL} from this artifact's OWN reading, appending an
                      entry to its _reanchorLog (the deliberate shrink-only re-anchor)
  --rules <file>      override the rule file (default: the plugin root this file lives under)
  --baseline <file>   override the baseline file (tests)

Exit: 0 = clean and within baseline · 1 = forbidden content / over baseline / baseline raised
      2 = usage, or NOT-EVALUATED (artifact, rule file, or baseline unreadable)`;

export interface CheckOutcome {
  reading: ShippedSetReading;
  baseline: ShippedSetBaseline | null;
  verdict: RatchetVerdict | null;
  /** Present only when the baseline carries a recorded clean reading. */
  size: SizeVerdict | null;
  code: number;
}

export function check(
  artifactRoot: string,
  rulesAbs: string,
  baselineAbs: string,
  repoRootForHead: string | null,
  opts: { sizeCeiling?: boolean } = {},
): CheckOutcome {
  const loaded = readRulesFromFile(rulesAbs);
  if (loaded === null) {
    return { reading: notEvaluated(`the rule file is unreadable (${rulesAbs})`), baseline: null, verdict: null, size: null, code: 2 };
  }
  const reading = readShippedSet(artifactRoot, loaded.rules);
  if (!reading.evaluated) return { reading, baseline: null, verdict: null, size: null, code: 2 };
  const baseline = readBaselineFile(baselineAbs);
  if (baseline === null) {
    return { reading, baseline: null, verdict: null, size: null, code: 2 };
  }
  const rel = BASELINE_FILE_REL;
  const head = repoRootForHead === null ? null : readHeadBaseline(repoRootForHead, rel);
  const verdict = judge(measuredOf(reading), baseline, baseline, head);
  const size = baseline.shipped ? judgeShippedSize(shippedOf(reading), baseline.shipped) : null;
  const code = reading.violations.length > 0 || !verdict.ok || (opts.sizeCeiling === true && size !== null && !size.ok) ? 1 : 0;
  return { reading, baseline, verdict, size, code };
}

function report(o: CheckOutcome, asJson: boolean): void {
  const r = o.reading;
  const measured = r.evaluated ? measuredOf(r) : null;
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          evaluated: r.evaluated,
          reason: r.reason ?? null,
          totals: r.totals,
          forbidden: r.forbidden,
          violations: r.violations,
          unreadable: r.unreadable,
          rulesInForce: r.rulesInForce,
          baseline: o.baseline,
          verdict: o.verdict,
          size: o.size,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!r.evaluated) {
    console.log(`shipped-set-rules: NOT-EVALUATED — ${r.reason ?? "the artifact could not be read"}`);
    return;
  }
  console.log(
    `shipped-set-rules: artifact ${r.totals.files} files · ${r.totals.bytes} bytes · ${r.totals.shLines} .sh lines · ${r.rulesInForce} rule(s) in force`,
  );
  console.log(`  ratchet (rule-excluded content present): ${JSON.stringify(r.forbidden)}`);
  if (r.violations.length > 0) {
    console.log(`  forbidden content PRESENT (${r.violations.length}):`);
    for (const v of r.violations.slice(0, 8)) console.log(`    ${v.path}${v.isDir ? "/" : ""}  <- rule ${v.rule}`);
    if (r.violations.length > 8) console.log(`    … ${r.violations.length - 8} more`);
  }
  if (r.unreadable.length > 0) {
    for (const u of r.unreadable.slice(0, 5)) console.log(`  UNREADABLE: ${u}`);
  }
  if (o.baseline && measured) {
    console.log(`  measured: ${JSON.stringify(measured)}`);
    console.log(`  baseline: ${JSON.stringify({ files: o.baseline.files, bytes: o.baseline.bytes, shLines: o.baseline.shLines })}`);
  }
  if (o.size) console.log(`  size ceiling: ${JSON.stringify(o.size.measured)} vs recorded ${JSON.stringify(o.size.ceiling)}`);
  if (o.verdict) {
    console.log(`  headBaseline: ${o.verdict.bootstrap ? "absent-bootstrap" : JSON.stringify(o.verdict.headBaseline)}`);
    for (const k of o.verdict.over) console.log(`  OVER baseline on ${k}: ${measured ? measured[k] : "?"} > ${o.baseline ? o.baseline[k] : "?"}`);
    for (const k of o.verdict.baselineRaised) console.log(`  BASELINE RAISED past HEAD on ${k}`);
  }
}

/** Write the baseline from this artifact's OWN reading. The values are never hand-fitted; the
 *  caller must record the before/after run output (the ratchet can only get SHORTER without one). */
export function reanchor(
  artifactRoot: string,
  rulesAbs: string,
  baselineAbs: string,
  why: string,
): { ok: boolean; reason: string } {
  const loaded = readRulesFromFile(rulesAbs);
  if (loaded === null) return { ok: false, reason: `the rule file is unreadable (${rulesAbs})` };
  const reading = readShippedSet(artifactRoot, loaded.rules);
  if (!reading.evaluated) return { ok: false, reason: `NOT-EVALUATED: ${reading.reason ?? "artifact unreadable"}` };
  if (reading.violations.length > 0) {
    return {
      ok: false,
      reason: `refusing to re-anchor: ${reading.violations.length} rule-excluded path(s) are PRESENT in ${artifactRoot} — fix the assembly step, do not pin a baseline over forbidden content`,
    };
  }
  const measured = measuredOf(reading);
  const previous = readBaselineFile(baselineAbs);
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(fs.readFileSync(baselineAbs, "utf8")) as Record<string, unknown>;
  } catch {
    doc = {};
  }
  const shipped = shippedOf(reading);
  const log = Array.isArray(doc._reanchorLog) ? (doc._reanchorLog as unknown[]) : [];
  log.push({ when: new Date().toISOString(), from: previous, to: measured, shipped, why });
  doc._reanchorLog = log;
  doc._axes = doc._axes ?? {
    files: "RATCHET — files of rule-excluded content PRESENT in the artifact (exactly 0 on a correct publish)",
    bytes: "RATCHET — their bytes",
    shLines: "RATCHET — their blank/comment-free *.sh lines (sh-census-check.ts countCodeLines)",
    shipped: "the artifact's OWN totals as last read from a clean build; compared by the release gate's shipped-set-clean",
  };
  doc._note =
    doc._note ??
    "Shrink-only ratchet over the published plugin artifact's DEV-ONLY content. The three axes are the files/bytes/.sh-lines of rule-excluded content that is PRESENT in the artifact — 0 on a correct publish — so a reading above the baseline is RED and a working-tree baseline raised above git HEAD's is also RED (raising it for real takes a commit). `shipped` records the artifact's own totals for the release gate's size ceiling; it is NOT the per-run ratchet (see the churn note in plugin/scripts/shipped-set-rules.ts). Reanchored only from an artifact's own reading — see _reanchorLog.";
  doc.files = measured.files;
  doc.bytes = measured.bytes;
  doc.shLines = measured.shLines;
  doc.shipped = shipped;
  fs.writeFileSync(baselineAbs, JSON.stringify(doc, null, 2) + "\n");
  return { ok: true, reason: `baseline re-anchored to ${JSON.stringify(measured)} (artifact totals ${JSON.stringify(shipped)})` };
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) helpExit(USAGE);
  const asJson = args.includes("--json");
  const rulesAbs = path.resolve(flagValue(args, "--rules") ?? rulesFileAbs());
  const baselineAbs = path.resolve(flagValue(args, "--baseline") ?? baselineFileAbs());
  const positional = args.filter(
    (a, i) => !a.startsWith("--") && args[i - 1] !== "--rules" && args[i - 1] !== "--why" && args[i - 1] !== "--baseline",
  );

  if (args.includes("--print-rsync-excludes")) {
    const loaded = readRulesFromFile(rulesAbs);
    if (loaded === null || loaded.rules.length === 0) {
      // ⛔ fail-closed: an empty list would turn the assembly step back into the full-tree rsync
      // this file exists to prevent, and the caller (a `$( )` under `set -e`) must abort on it.
      process.stderr.write(`shipped-set-rules: NOT-EVALUATED — no rules read from ${rulesAbs}; refusing to print an empty exclusion list\n`);
      return 2;
    }
    for (const r of loaded.rules) process.stdout.write(`${r.raw}\n`);
    return 0;
  }

  if (args.includes("--reanchor")) {
    const dir = positional[0];
    if (!dir) helpExit(USAGE, 2);
    const why = flagValue(args, "--why") ?? "(no reason recorded)";
    const res = reanchor(path.resolve(dir), rulesAbs, baselineAbs, why);
    process.stdout.write(`shipped-set-rules: ${res.ok ? "OK" : "REFUSED"} — ${res.reason}\n`);
    return res.ok ? 0 : 1;
  }

  if (args.includes("--check")) {
    const dir = positional[0];
    if (!dir) helpExit(USAGE, 2);
    const outcome = check(path.resolve(dir), rulesAbs, baselineAbs, sourceRepoRoot(), { sizeCeiling: args.includes("--size-ceiling") });
    report(outcome, asJson);
    if (!outcome.reading.evaluated) {
      process.stderr.write(`shipped-set-rules: NOT-EVALUATED — ${outcome.reading.reason ?? "the artifact could not be read"}\n`);
      return 2;
    }
    if (outcome.baseline === null || outcome.verdict === null) {
      process.stderr.write(`shipped-set-rules: NOT-EVALUATED — baseline missing or malformed (${baselineAbs})\n`);
      return 2;
    }
    if (outcome.reading.violations.length > 0) {
      process.stderr.write(
        `shipped-set-rules: FAIL — ${outcome.reading.violations.length} rule-excluded path(s) present in the artifact (the assembly step regressed); ${overBaselineMessage(outcome.reading.forbidden, outcome.baseline, path.resolve(dir))}\n`,
      );
      return 1;
    }
    if (outcome.verdict.over.length > 0) {
      process.stderr.write(
        `shipped-set-rules: FAIL — ${overBaselineMessage(outcome.reading.forbidden, outcome.baseline, path.resolve(dir))}\n`,
      );
      return 1;
    }
    if (outcome.verdict.baselineRaised.length > 0) {
      process.stderr.write(
        `shipped-set-rules: FAIL — the working-tree baseline was RAISED past git HEAD on ${outcome.verdict.baselineRaised.join(", ")} (a baseline may only shrink; commit the raise deliberately, with a _reanchorLog entry)\n`,
      );
      return 1;
    }
    if (args.includes("--size-ceiling") && outcome.size !== null && !outcome.size.ok) {
      process.stderr.write(`shipped-set-rules: FAIL — ${overSizeMessage(outcome.size, path.resolve(dir))}\n`);
      return 1;
    }
    if (!asJson) {
      process.stdout.write(
        `PASS — no rule-excluded content; ratchet ${JSON.stringify(outcome.reading.forbidden)} ≤ baseline ${JSON.stringify({ files: outcome.baseline.files, bytes: outcome.baseline.bytes, shLines: outcome.baseline.shLines })}\n`,
      );
    }
    return 0;
  }

  helpExit(USAGE, 2);
  return 2;
}

if (isDirectEntry(import.meta, process.argv[1], "shipped-set-rules")) {
  process.exit(main(process.argv));
}
