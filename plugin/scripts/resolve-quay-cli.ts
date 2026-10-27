// resolve-quay-cli.ts — REFERENCE IMPLEMENTATION of the external-consumer contract in
// `docs/references/external-consumer-cli-location.md`. That document is the single source of truth;
// this file is what "follow the contract" looks like when written as code. If the two disagree, the
// doc wins and this file is wrong (tasks/gap-external-consumer-cli-location-contract-doc).
//
// WHO NEEDS THIS: a process that is NOT inside a Claude Code session — a cron job, a systemd unit, a
// web server, another agent runtime — and must run quay's CLI. Such a process has:
//   · no `${CLAUDE_PLUGIN_ROOT}` (Claude Code expands it only in skill/hook/agent contexts),
//   · no `<plugin-root>/bin` on PATH (Claude Code prepends it to ITS Bash tool's PATH only),
//   · no guarantee that `quay` on PATH is the version this project is pinned to.
// The ONE documented answer is the Claude Code plugin **install record**
// (`~/.claude/plugins/installed_plugins.json`) read through the session layer's tier rule. Nothing
// else is a version-pinned answer, so this resolver reads nothing else.
//
// ⛔ THE NEGATIVE CONTROL IS THE POINT (AC4): when the record is missing / unparsable / names a
// directory that no longer exists, the answer is `absent` or `not-evaluated` — its OWN value — and
// ⛔ NEVER "whatever `quay` is on PATH". Falling back to PATH would silently swap the version the
// project pinned for an arbitrary one: two versions of this tool have different verbs and different
// `.quay/` semantics, so that failure is silent and consequential. A caller that receives
// `absent`/`not-evaluated` is expected to FAIL, not to guess.
//
// SHAPE (硬规则 3 / 3b — every "I could not tell" has its own value, never the same shape as "fine"):
//   resolved       — an install record names a version directory that resolves and carries the CLI.
//   absent         — the record was READ, and it does not give this project a usable CLI:
//                    no project/local entry for this project and no user entry; or the winning
//                    entry's `installPath` does not exist; or that directory carries no CLI.
//   not-evaluated  — the record itself could not be read (missing / unreadable / unparsable).
//                    ⛔ Not `absent`: "no record file" and "record says nothing for you" are
//                    different facts, and only the second one means the plugin is not installed.
// Exit codes mirror the state 1:1 so a shell caller never parses prose: 0 / 2 / 3.
//
// WHY THIS FILE HAS NO DEPENDENCIES BEYOND NODE BUILTINS: a consumer runs it from a plugin cache
// directory (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`) that carries no
// `packages/` tree and no `node_modules`. It therefore imports nothing outside `node:*`, and it
// reads no state of its own except the filesystem. (It is also bundled to
// `scripts/dist/resolve-quay-cli.js` — the shipped artifact deletes raw `.ts` — so an installed
// consumer runs the bundle, and a source checkout runs this file under
// `node --experimental-strip-types`.)
//
// THE TIER RULE (the session layer's, copied from the record that established it — NOT invented
// here): a `project`/`local` record whose `projectPath` resolves to this project WINS; otherwise the
// `user` record. Same rule as `packages/quay/src/loaded-version.ts`'s `projectScopedVersionReading`
// and as `packages/quay/src/init.ts`'s plugin-link header ("the registry tier rule
// (`projectPath`-matching local/project entry wins, else the `user` entry)", measured 2026-10-06).
// ⛔ Two live consumers of one rule is already one too many; if the tier rule ever changes it must
// change in BOTH, and the doc says so.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** One normalised `quay@<marketplace>` install record entry. Unknown/missing fields are `null` —
 *  ⛔ not `""` and not `false`: "the field was not there" is not a value of that field. */
export interface InstallRecordEntry {
  /** The plugin id this entry belongs to (`quay@quay`, `quay@quay-dev`, …). */
  id: string;
  scope: string | null;
  installPath: string | null;
  version: string | null;
  installedAt: string | null;
  projectPath: string | null;
}

/** How the record file itself read. `ok` is the only state that can produce `absent`. */
export type RecordReadState = "ok" | "missing" | "unreadable" | "unparsable";

export interface RecordRead {
  state: RecordReadState;
  /** Every entry for every `quay@*` plugin, in file order. Empty when state !== "ok". */
  entries: InstallRecordEntry[];
  recordPath: string;
  /** Non-null for every non-`ok` state (an empty reason is indistinguishable from "no problem"). */
  reason: string | null;
}

/** The three-valued answer. See the SHAPE note above. */
export type ResolveState = "resolved" | "absent" | "not-evaluated";

export interface Resolution {
  state: ResolveState;
  /** Non-null unless state === "resolved" — a refusal always says why. */
  reason: string | null;
  /** Which tier of the session layer's rule won. `null` when no entry won. */
  tier: "project" | "user" | null;
  /** The winning entry's raw `scope` (`project` / `local` / `user`) — the tier collapses
   *  project|local, so the raw word is what a human needs to see. */
  scope: string | null;
  /** The winning entry's plugin id (so a `quay@quay-dev` win is visible, not silent). */
  pluginId: string | null;
  /** The `version` the record claims. ⛔ Not `quay --version`: the shipped bundle embeds the dev
   *  version, so that is a different quantity (gap-release-bundle-embeds-dev-version-after-stamp). */
  version: string | null;
  /** The version read from `<installPath>/.claude-plugin/plugin.json` — the on-disk truth. A
   *  disagreement with `version` is a real reading, reported rather than reconciled. */
  rootVersion: string | null;
  installPath: string | null;
  /** `<installPath>/bin/quay` (the plugin's own CLI shim) when it exists. */
  cli: string | null;
  /** True when `cli` exists AND is executable — a separate reading, because a shim that exists but
   *  is not +x fails at spawn with EACCES, which is not the same problem as a missing shim. */
  cliExecutable: boolean | null;
  /** `<installPath>/vendor/quay/dist/quay.js` when it exists (the bundle the shim execs, and the
   *  fallback entry a consumer can invoke with its own Node). */
  bundle: string | null;
  /** Milliseconds from `<installPath>/.orphaned_at`, when that marker exists: Claude Code has
   *  marked this version directory for deletion (see the doc's `.orphaned_at` section). A consumer
   *  that resolves into such a directory must be prepared for it to disappear. */
  orphanedAtMs: number | null;
  /** Everything below is context, echoed back so a log line needs no second lookup. */
  homeDir: string;
  projectDir: string;
  recordPath: string;
  /** Which record ids were consulted (`quay@quay`, `quay@quay-dev`, …) — enumerated, not a boolean. */
  consultedIds: string[];
}

/** The plugin ids this resolver consults, in order. `quay-dev` is the dev channel (SPEC §4b): a
 *  project that installed it deliberately is running THAT build, so it must be able to resolve. */
export const CONSULTED_PLUGIN_IDS: readonly string[] = ["quay@quay", "quay@quay-dev"];

/** The project/local scopes of the session layer's rule. */
const PROJECT_SCOPES: ReadonlySet<string> = new Set(["project", "local"]);

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Read + normalise the install record. This is the ONLY place that distinguishes "the record could
 * not be read" from "the record says nothing" — every caller goes through it (硬规则 5b: a second
 * parser would drift from this one).
 */
export function readInstallRecord(homeDir: string): RecordRead {
  const recordPath = path.join(homeDir, ".claude", "plugins", "installed_plugins.json");
  const notOk = (state: RecordReadState, reason: string): RecordRead => ({
    state,
    entries: [],
    recordPath,
    reason,
  });

  let raw: string;
  try {
    raw = fs.readFileSync(recordPath, "utf8");
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "ENOENT") {
      return notOk("missing", `no Claude Code plugin install record at ${recordPath} — nothing to read`);
    }
    return notOk(
      "unreadable",
      `the Claude Code plugin install record at ${recordPath} exists but could not be read (${code ?? String(e)})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return notOk("unparsable", `the plugin install record at ${recordPath} is not valid JSON (${(e as Error).message})`);
  }

  const plugins = (parsed as { plugins?: unknown } | null)?.plugins;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) {
    return notOk(
      "unparsable",
      `the plugin install record at ${recordPath} has no \`plugins\` object — its shape is not the one this contract documents`,
    );
  }

  const entries: InstallRecordEntry[] = [];
  for (const id of CONSULTED_PLUGIN_IDS) {
    const list = (plugins as Record<string, unknown>)[id];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      entries.push({
        id,
        scope: asString(o.scope),
        installPath: asString(o.installPath),
        version: asString(o.version),
        installedAt: asString(o.lastUpdated) ?? asString(o.installedAt),
        projectPath: asString(o.projectPath),
      });
    }
  }
  return { state: "ok", entries, recordPath, reason: null };
}

/** realpath when it exists, else resolve — a `projectPath` written by Claude Code and a `--project`
 *  given by a caller need not be spelled identically (symlinks, trailing slashes, `/home` aliases). */
function normalisePath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** `1.2.10` > `1.2.9`; unorderable ⇒ a deterministic lexical fallback (never "first one wins"). */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Highest version among entries; version-less entries never win (a null version is not a reading). */
function highestVersion(entries: readonly InstallRecordEntry[]): InstallRecordEntry[] {
  let best: string | null = null;
  for (const e of entries) {
    if (e.version === null) continue;
    if (best === null || compareVersions(e.version, best) > 0) best = e.version;
  }
  if (best === null) return [];
  return entries.filter((e) => e.version === best);
}

/**
 * The session layer's tier rule: a `project`/`local` entry whose `projectPath` resolves to this
 * project wins; else any `user` entry. Returns every entry at the winning version so a tie (same
 * plugin at project AND local scope for one directory) is visible rather than silently picked.
 */
export function selectTier(
  entries: readonly InstallRecordEntry[],
  projectDir: string,
): { tier: "project" | "user" | null; entries: InstallRecordEntry[]; reason: string | null } {
  const projectNorm = normalisePath(projectDir);
  const projectMatches = entries.filter(
    (e) => e.scope !== null && PROJECT_SCOPES.has(e.scope) && e.projectPath !== null && normalisePath(e.projectPath) === projectNorm,
  );
  if (projectMatches.length > 0) {
    const top = highestVersion(projectMatches);
    if (top.length === 0) {
      return {
        tier: "project",
        entries: projectMatches,
        reason: `a project/local install record for ${projectNorm} exists but carries no usable \`version\` — cannot pick a directory deterministically`,
      };
    }
    return { tier: "project", entries: top, reason: null };
  }

  const userEntries = entries.filter((e) => e.scope === "user");
  if (userEntries.length > 0) {
    const top = highestVersion(userEntries);
    if (top.length === 0) {
      return {
        tier: "user",
        entries: userEntries,
        reason: `a user-scope install record exists but carries no usable \`version\``,
      };
    }
    return { tier: "user", entries: top, reason: null };
  }

  return {
    tier: null,
    entries: [],
    reason:
      `the install record names no plugin entry for this project: no project/local entry whose projectPath resolves to ` +
      `${projectNorm}, and no user-scope entry`,
  };
}

function readJsonVersion(pluginRoot: string): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"))?.version;
    return asString(v);
  } catch {
    return null;
  }
}

function readOrphanedAt(pluginRoot: string): number | null {
  try {
    const raw = fs.readFileSync(path.join(pluginRoot, ".orphaned_at"), "utf8").trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function exists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the CLI for one project. Pure with respect to the filesystem except for reads — it takes
 * `homeDir`/`projectDir` explicitly so a caller (and a test) never has to inherit the process's own
 * `$HOME`/cwd (硬规则 4b: a reading produced by the object under test is not a reading).
 *
 * ⛔ There is deliberately NO PATH lookup anywhere in this function, and none in the CLI below.
 */
export function resolveQuayCli(opts: { homeDir?: string; projectDir?: string } = {}): Resolution {
  const homeDir = path.resolve(opts.homeDir ?? os.homedir());
  const projectDir = path.resolve(opts.projectDir ?? process.cwd());
  const base: Omit<Resolution, "state" | "reason"> = {
    tier: null,
    scope: null,
    pluginId: null,
    version: null,
    rootVersion: null,
    installPath: null,
    cli: null,
    cliExecutable: null,
    bundle: null,
    orphanedAtMs: null,
    homeDir,
    projectDir,
    recordPath: path.join(homeDir, ".claude", "plugins", "installed_plugins.json"),
    consultedIds: [...CONSULTED_PLUGIN_IDS],
  };

  const record = readInstallRecord(homeDir);
  if (record.state !== "ok") {
    return { ...base, state: "not-evaluated", reason: record.reason };
  }

  const selected = selectTier(record.entries, projectDir);
  if (selected.tier === null || selected.reason !== null) {
    return { ...base, state: "absent", reason: selected.reason };
  }

  const winner = selected.entries[0];
  const withEntry: Omit<Resolution, "state" | "reason"> = {
    ...base,
    tier: selected.tier,
    scope: winner.scope,
    pluginId: winner.id,
    version: winner.version,
    installPath: winner.installPath,
  };

  if (winner.installPath === null) {
    return {
      ...withEntry,
      state: "absent",
      reason: `the winning ${winner.id} entry (scope ${String(winner.scope)}) carries no \`installPath\` — there is no directory to resolve`,
    };
  }

  const installPath = normalisePath(winner.installPath);
  const resolvedEntry = { ...withEntry, installPath, rootVersion: readJsonVersion(installPath), orphanedAtMs: readOrphanedAt(installPath) };

  if (!exists(installPath)) {
    return {
      ...resolvedEntry,
      state: "absent",
      reason:
        `the winning ${winner.id} entry (scope ${String(winner.scope)}, version ${String(winner.version)}) names ` +
        `${installPath}, but that directory does not exist — the record is stale (Claude Code deletes old version ` +
        `directories; see the doc's .orphaned_at section). ⛔ Not falling back to \`quay\` on PATH.`,
    };
  }

  const cliPath = path.join(installPath, "bin", "quay");
  const bundlePath = path.join(installPath, "vendor", "quay", "dist", "quay.js");
  const hasCli = exists(cliPath);
  const hasBundle = exists(bundlePath);
  const withPaths: Omit<Resolution, "state" | "reason"> = {
    ...resolvedEntry,
    cli: hasCli ? cliPath : null,
    cliExecutable: hasCli ? isExecutable(cliPath) : null,
    bundle: hasBundle ? bundlePath : null,
  };

  if (!hasCli && !hasBundle) {
    return {
      ...withPaths,
      state: "absent",
      reason:
        `${installPath} exists but carries no CLI: neither bin/quay nor vendor/quay/dist/quay.js is present. ` +
        `That is not a quay plugin tree (or an unpublished/broken build) — ⛔ not falling back to \`quay\` on PATH.`,
    };
  }

  return { ...withPaths, state: "resolved", reason: null };
}

// ── CLI surface ─────────────────────────────────────────────────────────────────────────────────
//
// `--project <dir>`  the project whose pinned version to resolve (default: cwd)
// `--home <dir>`     where `~/.claude/plugins/installed_plugins.json` is read from (default: $HOME).
//                    Exists for callers running under a different account/sandbox, and for the
//                    negative-control runs in the doc — not as a way to dodge the real record.
// `--json`           one JSON document on stdout (the Resolution above)
// `--field <name>`   print one field (e.g. `cli`) for `$(…)` use — prints nothing when null
// `--help`
//
// Exit: 0 resolved · 2 absent · 3 not-evaluated · 64 usage error.

const USAGE = `usage: resolve-quay-cli [--project <dir>] [--home <dir>] [--json | --field <name>]

Resolve the quay CLI for a project from the Claude Code plugin install record.
Contract: docs/references/external-consumer-cli-location.md

  --project <dir>   project whose pinned plugin version applies (default: cwd)
  --home <dir>      where .claude/plugins/installed_plugins.json lives (default: $HOME)
  --json            print the full Resolution as one JSON document
  --field <name>    print a single field (cli, bundle, installPath, version, state, ...)
  --help            this text

exit: 0 resolved · 2 absent · 3 not-evaluated · 64 usage error
⛔ never falls back to \`quay\` on PATH — an unresolvable pin is a refusal, not a substitution.`;

function fail(message: string, code: number): never {
  process.stderr.write(`resolve-quay-cli: ${message}\n`);
  process.exit(code);
}

function main(argv: string[]): number {
  let projectDir: string | undefined;
  let homeDir: string | undefined;
  let json = false;
  let field: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    } else if (a === "--json") {
      json = true;
    } else if (a === "--project") {
      projectDir = argv[++i];
      if (!projectDir) fail("--project needs a directory", 64);
    } else if (a === "--home") {
      homeDir = argv[++i];
      if (!homeDir) fail("--home needs a directory", 64);
    } else if (a === "--field") {
      field = argv[++i] ?? null;
      if (!field) fail("--field needs a field name", 64);
    } else {
      fail(`unexpected argument ${JSON.stringify(a)}\n\n${USAGE}`, 64);
    }
  }

  const r = resolveQuayCli({ homeDir, projectDir });

  if (field !== null) {
    const value = (r as unknown as Record<string, unknown>)[field];
    if (value === undefined) fail(`no such field: ${field}`, 64);
    if (value !== null) process.stdout.write(`${String(value)}\n`);
  } else if (json) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  } else {
    const lines = [
      `state:    ${r.state}`,
      `project:  ${r.projectDir}`,
      `record:   ${r.recordPath}`,
    ];
    if (r.state === "resolved") {
      lines.push(
        `tier:     ${String(r.tier)} (scope ${String(r.scope)})`,
        `plugin:   ${String(r.pluginId)} ${String(r.version)}${r.rootVersion !== null && r.rootVersion !== r.version ? ` (on-disk plugin.json says ${r.rootVersion})` : ""}`,
        `root:     ${String(r.installPath)}`,
        `cli:      ${String(r.cli)}${r.cliExecutable === false ? "  ⚠ present but NOT executable" : ""}`,
        `bundle:   ${String(r.bundle)}`,
      );
      if (r.orphanedAtMs !== null) {
        lines.push(
          `⚠ .orphaned_at ${r.orphanedAtMs} (${new Date(r.orphanedAtMs).toISOString()}) — Claude Code marked this ` +
            `version directory for deletion; do not treat this path as permanent`,
        );
      }
    } else {
      lines.push(`reason:   ${String(r.reason)}`);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  return r.state === "resolved" ? 0 : r.state === "absent" ? 2 : 3;
}

// Direct-invocation guard (the `capability-catalog.ts` idiom): importing this module must not run
// the CLI or set an exit code. A guard that misfires cannot pass silently — it would print nothing
// and exit 0, which every caller reads as "resolved".
const isDirectInvocation =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  path.basename(process.argv[1]).replace(/\.(js|ts|mjs)$/, "") === "resolve-quay-cli";
if (isDirectInvocation) process.exitCode = main(process.argv.slice(2));
