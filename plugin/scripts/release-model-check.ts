#!/usr/bin/env node
// release-model-check.ts — the GENERAL meter for a project's DECLARED release-branch model.
//
// SPEC: tasks/gap-release-branch-model-hardcoded-not-configurable.
//
// THE DEFECT THIS CLOSES: quay's release branch model (which branch releases advance, which branch
// they are cut from, which names are release-shaped, what a version tag looks like, who may advance
// the line) lived ONLY as literals in quay's own private scripts. A second quay-driven project with
// no `master` and no `release/*` could not DECLARE its own model, so it could not check the one
// invariant that actually matters: **the release line is locally readable, is never committed to
// directly, and stands at the most recent fully-green release**. This script is that invariant,
// runnable against ANY repository, from the `.quay/config.yml` `release:` section.
//
// WHAT IS CONVERGED (the invariant, not the mechanism): a project may use one `main`, a
// `release/*` train, or hotfix branches. Nothing here forces `master`/`release/*`/hotfix. What must
// hold is that the DECLARED line is readable, parked on a tag of the DECLARED shape, and (when
// `advance: ci`) is advanced only by a fully-green release run.
//
// FOUR-STATE OUTPUT — the whole point (硬规则 3b):
//
//   exit 0  pass            the configured model's invariants all hold (evaluated:true)
//   exit 1  fail            at least one invariant is false (evaluated:true)
//   exit 3  not-evaluated   the section/config/repo could not be READ (evaluated:false)
//                           ⛔ NEVER the same value as pass
//   exit 4  not-configured  there is no `release:` section at all (evaluated:false)
//                           ⛔ a project that declares nothing has NOT passed; it has declared
//                           nothing, and the reading says exactly that
//
// The four states do not share a word, a status string, or an exit code. That is the acceptance
// criterion this file exists for: 「没配」/「合格」/「不合格」/「无法评估」 must be distinguishable.
//
// Run:
//   node --experimental-strip-types plugin/scripts/release-model-check.ts --root <repo> [--json]
//   node --experimental-strip-types plugin/scripts/release-model-check.ts --print-globs --root <repo>
//     (config-reader mode for the shell carrier: `#source=config|default` then one glob per line;
//      exit 3 when a present `release:` section is unreadable — ⛔ never a silent default)
//   ⛔ With no arguments this is a USAGE ERROR (exit 2): an exit-0 run that judged nothing would be
//   isomorphic to the `pass` reading.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { isDirectEntry } from "./gate-script-base.ts";
import { git, nonEmptyLines } from "./git-runner.ts";

// ── the declared model (a shipped twin of packages/quay/src/core/config.ts's reader) ─────────────
//
// ⛔ This is a TWO-LAYER COPY BY DESIGN, the same shape as every other shipped plugin script: the
// product reader lives in `packages/quay/src/core/config.ts` (used by `quay config validate` and
// `quay init`), and the shipped carriers cannot import the product source tree. The shapes must
// stay identical, and `plugin/test/release-model-check.test.mjs` holds the parity: both judges are
// run over one table of inputs and must agree. Do not "fix" one without the other.

export type ReleaseAdvance = "ci" | "manual" | "none";

export interface ReleaseConfig {
  line: string;
  baseline: string;
  globs: string[];
  tag_prefix: string;
  advance: ReleaseAdvance;
}

export const RELEASE_ADVANCE_VALUES: readonly ReleaseAdvance[] = ["ci", "manual", "none"];

/** The historical model quay's carriers used before the section existed — ONE definition point, so
 *  the carriers' backward-compatible fallback cannot drift from the meter's `not-configured` read. */
export const RELEASE_CONFIG_DEFAULTS: Readonly<ReleaseConfig> = Object.freeze({
  line: "master",
  baseline: "develop",
  globs: Object.freeze(["release/*", "release-*"]) as unknown as string[],
  tag_prefix: "v",
  advance: "ci",
});

export type ReleaseModelResolution =
  | { state: "configured"; config: ReleaseConfig; configPath: string; source: "config" }
  | { state: "default"; config: ReleaseConfig; configPath: string | null; source: "default" }
  | { state: "unreadable"; reason: string; configPath: string | null };

/** The single shape judge (twin of `parseReleaseConfig`). A PRESENT value is judged here; absence
 *  is the caller's decision. */
export function parseReleaseConfig(
  raw: unknown
): { ok: true; config: ReleaseConfig } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: false, reason: "`release:` is absent (the caller decides what absence means)" };
  if (raw === null) return { ok: false, reason: "`release:` is empty — declare line/baseline/globs/tag_prefix/advance, or remove the key" };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "`release:` must be a mapping" };
  const r = raw as Record<string, unknown>;
  const str = (key: string): string | null => {
    const v = r[key];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };
  const line = str("line");
  const baseline = str("baseline");
  const tagPrefix = r.tag_prefix === undefined
    ? RELEASE_CONFIG_DEFAULTS.tag_prefix
    : typeof r.tag_prefix === "string"
      ? (r.tag_prefix as string)
      : null;
  const advance = r.advance === undefined ? RELEASE_CONFIG_DEFAULTS.advance : r.advance;
  if (!line) return { ok: false, reason: "`release.line` must be a non-empty string" };
  if (!baseline) return { ok: false, reason: "`release.baseline` must be a non-empty string" };
  if (tagPrefix === null) return { ok: false, reason: "`release.tag_prefix` must be a string (may be empty)" };
  if (!RELEASE_ADVANCE_VALUES.includes(advance as ReleaseAdvance)) {
    return { ok: false, reason: `\`release.advance\` must be one of ${RELEASE_ADVANCE_VALUES.join("|")}` };
  }
  let globs: string[];
  if (r.globs === undefined) {
    globs = [...RELEASE_CONFIG_DEFAULTS.globs];
  } else if (!Array.isArray(r.globs) || r.globs.length === 0) {
    return { ok: false, reason: "`release.globs` must be a non-empty list of branch-name glob patterns" };
  } else {
    globs = r.globs as string[];
    for (const g of globs) {
      if (typeof g !== "string" || g.trim() === "") return { ok: false, reason: "`release.globs` entries must be non-empty strings" };
    }
  }
  const allowed = ["line", "baseline", "globs", "tag_prefix", "advance"];
  const unknown = Object.keys(r).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) return { ok: false, reason: `unknown \`release:\` key(s): ${unknown.join(", ")}` };
  return { ok: true, config: { line, baseline, globs, tag_prefix: tagPrefix, advance: advance as ReleaseAdvance } };
}

/** Find `.quay/config.yml` upward from `startDir`, exactly like the product reader. */
function findConfig(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, ".quay", "config.yml");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Resolve the DECLARED model. Never throws; never conflates configured / default / unreadable. */
export function readReleaseModel(startDir: string): ReleaseModelResolution {
  const configPath = findConfig(startDir);
  if (!configPath) {
    return { state: "default", config: { ...RELEASE_CONFIG_DEFAULTS, globs: [...RELEASE_CONFIG_DEFAULTS.globs] }, configPath: null, source: "default" };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    return { state: "unreadable", reason: `config.yml did not parse: ${(err as Error)?.message ?? String(err)}`, configPath };
  }
  const section = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).release : undefined;
  if (section === undefined) {
    return { state: "default", config: { ...RELEASE_CONFIG_DEFAULTS, globs: [...RELEASE_CONFIG_DEFAULTS.globs] }, configPath, source: "default" };
  }
  const judged = parseReleaseConfig(section);
  if (!judged.ok) return { state: "unreadable", reason: judged.reason, configPath };
  return { state: "configured", config: judged.config, configPath, source: "config" };
}

// ── glob → branch matching (shared by the carriers, so they cannot disagree) ─────────────────────

/** Convert ONE shell-style glob (`*`, `?`) to an anchored RegExp. Kept deliberately small: the
 *  strings it sees are branch-name patterns, not arbitrary regexes. */
export function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (const ch of glob) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out + "$");
}

/** A predicate over branch names built from the DECLARED globs. */
export function makeBranchMatcher(globs: readonly string[]): (branch: string) => boolean {
  const res = globs.map(globToRegExp);
  return (branch: string) => res.some((re) => re.test(branch));
}

/** The literal prefix a script needs when CREATING a release branch (`release/*` ⇒ `release/`). */
export function releaseBranchPrefix(globs: readonly string[]): string {
  for (const g of globs) {
    const i = g.indexOf("*");
    if (i > 0) return g.slice(0, i);
    if (i === -1) return g.endsWith("/") ? g : g + "/";
  }
  return "";
}

// ── the meter ────────────────────────────────────────────────────────────────────────────────────

export type InvariantState = "pass" | "fail" | "not-evaluated" | "skipped";

export interface InvariantReading {
  id: string;
  state: InvariantState;
  detail: string;
}

export type MeterState = "pass" | "fail" | "not-evaluated" | "not-configured";

export interface MeterReading {
  state: MeterState;
  evaluated: boolean;
  config: ReleaseConfig | null;
  configSource: "config" | "default" | "none";
  configPath: string | null;
  invariants: InvariantReading[];
  reason?: string;
}

function gitOk(root: string, args: string[]): { ok: true; stdout: string } | { ok: false; reason: string } {
  const r = git(root, args);
  if (r.status !== 0) return { ok: false, reason: `git ${args.join(" ")} exited ${r.status}: ${(r.stderr ?? "").trim()}` };
  return { ok: true, stdout: r.stdout ?? "" };
}

/** Invariant 1 — the DECLARED line is locally readable. */
function lineReadable(root: string, line: string): InvariantReading {
  const repo = gitOk(root, ["rev-parse", "--git-dir"]);
  if (!repo.ok) {
    return { id: "line-readable", state: "not-evaluated", detail: `'${root}' is not a readable git checkout: ${repo.reason}` };
  }
  const ref = `refs/heads/${line}`;
  const r = git(root, ["rev-parse", "--verify", "--quiet", ref]);
  if (r.status === 0 && r.stdout.trim() !== "") {
    return { id: "line-readable", state: "pass", detail: `${ref} resolves to ${r.stdout.trim()}` };
  }
  if (r.status === 1) {
    return { id: "line-readable", state: "fail", detail: `${ref} does not resolve — the declared release line is not locally readable` };
  }
  return { id: "line-readable", state: "not-evaluated", detail: `could not resolve ${ref} (git exited ${r.status}): ${(r.stderr ?? "").trim()}` };
}

/** Invariant 2 — the line stands at the most recent release tag, i.e. nothing was committed to it
 *  directly since that release (a directly-committed line would have advanced past its tag). */
function lineParkedOnTag(root: string, line: string, tagPrefix: string, lineOk: boolean): InvariantReading {
  if (!lineOk) {
    return { id: "line-parked-on-tag", state: "not-evaluated", detail: "the declared line is not readable, so where it stands cannot be judged" };
  }
  const r = gitOk(root, ["tag", "--points-at", `refs/heads/${line}`]);
  if (!r.ok) return { id: "line-parked-on-tag", state: "not-evaluated", detail: `could not list tags at the line: ${r.reason}` };
  const tags = nonEmptyLines(r.stdout);
  const versionTags = tags.filter((t) => t.startsWith(tagPrefix));
  if (versionTags.length > 0) {
    return { id: "line-parked-on-tag", state: "pass", detail: `line tip is held by ${versionTags.join(", ")}` };
  }
  return {
    id: "line-parked-on-tag",
    state: "fail",
    detail: `line tip is on NO tag starting with '${tagPrefix}' (tags seen: ${tags.length === 0 ? "none" : tags.join(", ")}) — the line has moved past its release, i.e. it was committed to directly`,
  };
}

/** Invariant 3 — when `advance: ci`, the release workflow's advancing job must depend on EVERY
 *  other job, so a partially-green run cannot move the line. Delegated to the ONE existing judge
 *  (`release-master-advance-needs-check.ts`) rather than re-derived here: two implementations of
 *  "needs: covers every job" would be two definitions that drift. */
function advanceInvariant(root: string, advance: ReleaseAdvance): InvariantReading {
  if (advance !== "ci") {
    return { id: "advance-ci-needs", state: "skipped", detail: `advance=${advance} — the CI-advance invariant is not declared` };
  }
  const sibling = path.join(path.dirname(fileURLToPath(import.meta.url)), "release-master-advance-needs-check.ts");
  if (!fs.existsSync(sibling)) {
    return { id: "advance-ci-needs", state: "not-evaluated", detail: `the advance judge is absent at ${sibling}` };
  }
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", sibling, "--root", root, "--json"],
    { encoding: "utf8" }
  );
  if (r.status === 0) return { id: "advance-ci-needs", state: "pass", detail: "the advancing job's needs: covers every other job" };
  if (r.status === 1) return { id: "advance-ci-needs", state: "fail", detail: "the advancing job's needs: does NOT cover every other job — a partially-green run could move the line" };
  return { id: "advance-ci-needs", state: "not-evaluated", detail: `the advance judge exited ${r.status}: ${(r.stderr ?? "").trim()}` };
}

/** Judge a repository against its DECLARED model. Pure over `readReleaseModel` + git. */
export function judgeReleaseModel(root: string): MeterReading {
  const resolved = readReleaseModel(root);
  if (resolved.state === "unreadable") {
    return {
      state: "not-evaluated",
      evaluated: false,
      config: null,
      configSource: "none",
      configPath: resolved.configPath,
      invariants: [],
      reason: `the release: section is present but unreadable — ${resolved.reason}`,
    };
  }
  if (resolved.state === "default") {
    return {
      state: "not-configured",
      evaluated: false,
      config: resolved.config,
      configSource: "default",
      configPath: resolved.configPath,
      invariants: [],
      reason:
        resolved.configPath === null
          ? "no .quay/config.yml found — this project has not declared a release-branch model"
          : `no \`release:\` section in ${resolved.configPath} — this project has not declared a release-branch model (the carriers fall back to the historical model; that is NOT a declared model and NOT a pass)`,
    };
  }

  const cfg = resolved.config;
  const readable = lineReadable(root, cfg.line);
  const invariants: InvariantReading[] = [
    readable,
    lineParkedOnTag(root, cfg.line, cfg.tag_prefix, readable.state === "pass"),
    advanceInvariant(root, cfg.advance),
  ];

  const failed = invariants.some((i) => i.state === "fail");
  const unknown = invariants.some((i) => i.state === "not-evaluated");
  const state: MeterState = failed ? "fail" : unknown ? "not-evaluated" : "pass";
  return {
    state,
    evaluated: true,
    config: cfg,
    configSource: "config",
    configPath: resolved.configPath,
    invariants,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

const USAGE =
  "Usage: release-model-check.ts --root <repo> [--json]\n" +
  "       release-model-check.ts --print-globs|--print-model --root <repo>\n" +
  "       release-model-check.ts --help\n" +
  "Exit: 0 = pass (configured model holds) | 1 = fail | 3 = not-evaluated (could not read) |\n" +
  "      4 = not-configured (no release: section — ⛔ NOT a pass) | 2 = usage/environment error.\n" +
  "⛔ With no arguments this is a USAGE ERROR; it never judges process.cwd() implicitly.";

function parseCli(
  argv: string[]
): { root: string; json: boolean; printGlobs: boolean; printModel: boolean } | "help" | null {
  let root = "";
  let json = false;
  let printGlobs = false;
  let printModel = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = argv[++i] ?? "";
      if (root === "") return null;
    } else if (a === "--json") json = true;
    else if (a === "--print-globs") printGlobs = true;
    else if (a === "--print-model") printModel = true;
    // `--help` is a SUCCESS path (exit 0, usage on stdout, zero business side effect) — the
    // contract every `-check.ts` shares (plugin/test/help-contract-incompatible-behaviors AC1).
    // ⛔ Do not fold it into the `null` (usage-error, exit 2) path: that made a harness asking
    // "what are your flags?" read a failure and was the exact red this file introduced.
    else if (a === "--help" || a === "-h") return "help";
    else return null;
  }
  if (root === "") return null;
  return { root, json, printGlobs, printModel };
}

function emitReading(reading: MeterReading, json: boolean): number {
  const exitCode = reading.state === "pass" ? 0 : reading.state === "fail" ? 1 : reading.state === "not-evaluated" ? 3 : 4;
  if (json) {
    process.stdout.write(
      JSON.stringify({
        status: reading.state,
        ok: reading.state === "pass",
        evaluated: reading.evaluated,
        config: reading.config,
        configSource: reading.configSource,
        configPath: reading.configPath,
        invariants: reading.invariants,
        ...(reading.reason ? { reason: reading.reason } : {}),
      }) + "\n"
    );
    return exitCode;
  }
  const prefix =
    reading.state === "pass" ? "PASS" : reading.state === "fail" ? "FAIL" : reading.state === "not-evaluated" ? "NOT-EVALUATED" : "NOT-CONFIGURED";
  process.stdout.write(`${prefix}: release model (${reading.state})\n`);
  if (reading.reason) process.stdout.write(`  reason: ${reading.reason}\n`);
  if (reading.config) {
    process.stdout.write(
      `  model: line=${reading.config.line} baseline=${reading.config.baseline} globs=[${reading.config.globs.join(", ")}] tag_prefix='${reading.config.tag_prefix}' advance=${reading.config.advance} (source=${reading.configSource})\n`
    );
  }
  for (const inv of reading.invariants) process.stdout.write(`  ${inv.state.toUpperCase().padEnd(13)} ${inv.id}: ${inv.detail}\n`);
  return exitCode;
}

function main(argv: string[]): number {
  if (argv.length === 0) {
    process.stderr.write(USAGE + "\n");
    return 2;
  }
  const cli = parseCli(argv);
  if (cli === "help") {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  if (!cli) {
    process.stderr.write(USAGE + "\n");
    return 2;
  }
  if (cli.printGlobs || cli.printModel) {
    const resolved = readReleaseModel(cli.root);
    if (resolved.state === "unreadable") {
      process.stderr.write(`CAUSE=release-model-unreadable — ${resolved.reason} (${resolved.configPath})\n`);
      return 3;
    }
    const source = resolved.state === "configured" ? "config" : "default";
    if (cli.printGlobs) {
      process.stdout.write(`#source=${source}\n`);
      for (const g of resolved.config.globs) process.stdout.write(`${g}\n`);
      return 0;
    }
    process.stdout.write(
      [
        `#source=${source}`,
        `line=${resolved.config.line}`,
        `baseline=${resolved.config.baseline}`,
        `tag_prefix=${resolved.config.tag_prefix}`,
        `advance=${resolved.config.advance}`,
        ...resolved.config.globs.map((g) => `glob=${g}`),
      ].join("\n") + "\n"
    );
    return 0;
  }
  return emitReading(judgeReleaseModel(cli.root), cli.json);
}

if (isDirectEntry(import.meta, process.argv[1], "release-model-check")) {
  process.exit(main(process.argv.slice(2)));
}
