// packages/quay/src/init/delivery-surface.ts — the post-init delivery/install phase: L1 delivery-surface + provider-runtime existence reports, .claude/settings writing, the closed-set reading, and the install-steps report
//
// Extracted VERBATIM from packages/quay/src/init.ts (2026-10-29,
// gap-routine-architecture-analysis-core-src-flat-root-god-modules) as one PHASE of that god-module's
// split. `init.ts` re-exports every public symbol declared here, so all existing
// `from "./init.ts"` imports keep resolving; nothing in this file is a second implementation.
//
// Dependency direction is ONE-WAY (init.ts → delivery-surface → provider-maintenance → carrier-env):
// a phase module may import the ones BELOW it in that list and never `../init.ts` itself — importing
// the barrel back would close a cycle.


import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { userScopedInstallReading, type UserScopedInstallReading } from "../core/loaded-version.ts";
import { providerEntryFile } from "./provider-maintenance.ts";

/** One closed-set item's state, measured against the pre-write snapshot. */
export interface ClosedSetStateEntry {
  item: string;
  state: "written" | "pre-existing" | "unwritten" | "unreadable";
}

/** The auto-commit step's reading — enumerated, never a boolean (硬规则 3b). */
export interface AutoCommitReading {
  state: "committed" | "skipped" | "declined" | "not-a-repo";
  files: string[];
  detail: string;
}

/**
 * `json.load(open(p))[field]` → string, or `fallback` when the file is unreadable or the field is
 * absent. The `fallback` is the CALLER's literal (`unknown` / `quay` / ``) — it is passed in rather
 * than defaulted here so the caller's contract stays visible at the call site.
 */
export function readJsonField(jsonPath: string, field: string, fallback: string): string {
  try {
    const doc = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
    const v = doc[field];
    if (v === undefined || v === null) return fallback;
    return typeof v === "string" ? v : String(v);
  } catch {
    return fallback;
  }
}

/**
 * `verify_delivery_surface_l1` — the post-init six-category L1 delivery-completeness check.
 *
 * Ported from the retired shell entry by
 * `gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch` for the same reason the
 * runtime-existence check below was: the entry is a shim over this engine now, and a check left
 * behind is a check dropped from every `quay init`. It runs against the SHIPPED delivery surface
 * (the checkout root — the SPEC lives at `<root>/orchestration/`, outside the plugin bundle), and in
 * a BARE plugin copy the repo-level SPEC is absent, so it reports SKIP and returns ok — never a
 * silent pass (硬规则 3b: "nothing to check here" is its own line, not the absence of one).
 */
export function deliverySurfaceL1Report(pluginRoot?: string | null): { ok: boolean; lines: string[]; errors: string[] } {
  if (!pluginRoot) return { ok: true, lines: [], errors: [] };
  const l1Script = path.join(pluginRoot, "scripts", "l1-delivery-surface-check.ts");
  if (!fs.existsSync(l1Script)) return { ok: true, lines: [], errors: [] };
  const deliveryRoot = path.dirname(pluginRoot);
  const specFile = path.join(deliveryRoot, "orchestration", "SPEC-complete-delivery-surface-2026-08-05.md");
  if (!fs.existsSync(specFile)) {
    return {
      ok: true,
      lines: [`  delivery-surface-l1: SKIP (repo-level SPEC not found at ${specFile} — bare plugin copy; referenced⊆landed still guards the mechanism axis)`],
      errors: [],
    };
  }
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", l1Script, "--surface", "--root", deliveryRoot, "--spec", specFile],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (r.status !== 0) {
    return {
      ok: false,
      lines: [],
      errors: ["ERROR: delivery-surface L1 check failed — the six-category delivery surface is incomplete."],
    };
  }
  return { ok: true, lines: (r.stdout ?? "").trimEnd().split("\n").filter((l) => l !== ""), errors: [] };
}

/**
 * `verify_provider_runtime_existence` — the post-init check that the runtime file the config binds
 * actually EXISTS, and (for quay's own bundles) is not a stale copy left by an older install.
 *
 * Ported from the retired shell entry by
 * `gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch`: that entry is now a shim
 * over this engine, so the check belongs here — leaving it behind would have silently dropped it
 * from every `quay init` (a real regression, not a wording change). The output lines are the shell
 * function's, verbatim, so an operator's muscle memory and the callers' assertions still hold.
 *
 * THREE STATES, and "could not judge" is its own (硬规则 3b): an unresolvable plugin root is
 * `NOT-EVALUATED — …`, never a silent pass; a missing runtime is `FAIL (referenced-runtime-missing)`.
 * `ok:false` is the caller's cue to exit non-zero (the shell's `|| exit 2`).
 */
export function providerRuntimeExistenceReport(
  cfgPath: string,
  pluginRoot?: string | null,
  o: { dryRun?: boolean } = {},
): { ok: boolean; lines: string[]; errors: string[] } {
  if (o.dryRun) {
    return { ok: true, lines: ["  verify-provider-runtime-existence: (dry-run, skipped)"], errors: [] };
  }
  if (!fs.existsSync(cfgPath)) {
    return { ok: false, lines: [], errors: ["  verify-provider-runtime-existence: FAIL — no .quay/config.yml to verify"] };
  }
  const entryFile = providerEntryFile(cfgPath, pluginRoot);
  if (entryFile.startsWith("NOT-EVALUATED:")) {
    return {
      ok: true,
      lines: [`  verify-provider-runtime-existence: NOT-EVALUATED — ${entryFile.slice("NOT-EVALUATED:".length)}`],
      errors: [],
    };
  }
  if (entryFile === "") {
    return {
      ok: false,
      lines: [],
      errors: ["  verify-provider-runtime-existence: FAIL — no runtime file could be determined (provider-entry-file returned nothing)"],
    };
  }
  if (!fs.existsSync(entryFile)) {
    return {
      ok: false,
      lines: [],
      errors: [`  FAIL (referenced-runtime-missing): the provider mcp_entry references ${entryFile} but it does not exist in the target`],
    };
  }
  const lines = [`  verify-provider-runtime-existence: OK (${entryFile} exists)`];
  // Freshness (gap-upgrade-channel-cant-sync-build-artifacts-dist-stale): the referenced runtime must
  // be byte-identical to the plugin's CURRENT vendored bundle. A copy that differs is a stale dist
  // from an older install (git pull synced source; the gitignored target dist did not follow) and
  // FAILS CLOSED. Scoped to quay's known runtime basenames; an arbitrary runtime is existence-only.
  const base = path.basename(entryFile);
  const srcBundle =
    base === "quay.js"
      ? pluginRoot
        ? path.join(pluginRoot, "vendor", "quay", "dist", "quay.js")
        : ""
      : base === "quay-native.js"
        ? pluginRoot
          ? path.join(pluginRoot, "vendor", "quay-native", "dist", "quay-native.js")
          : ""
        : "";
  if (srcBundle !== "" && fs.existsSync(srcBundle)) {
    if (!fs.readFileSync(entryFile).equals(fs.readFileSync(srcBundle))) {
      return {
        ok: false,
        lines: [],
        errors: [
          `  FAIL (stale-runtime): ${entryFile} differs from the plugin's current vendored bundle (${srcBundle}) — a stale dist from an older install`,
        ],
      };
    }
    lines.push(`  verify-provider-runtime-freshness: OK (${entryFile} matches the plugin's current vendored bundle)`);
  }
  return { ok: true, lines, errors: [] };
}

/**
 * `write_claude_settings` — generate/patch `.claude/settings.json`: enable the plugin for this
 * project (`enabledPlugins: {"<name>@<name>": true}`) and pre-approve its MCP tools
 * (`permissions.allow: ["mcp__plugin_<name>_<name>__*"]`).
 *
 * An EXISTING file is read-modify-written so unrelated user settings survive; an unparseable one is
 * treated as `{}` (the Python did the same — this step's job is the quay block, not salvaging
 * arbitrary JSON). Output formatting is Python's `json.dump(data, f, indent=2)` + a trailing
 * newline, which `JSON.stringify(data, null, 2)` reproduces exactly.
 */
export function writeClaudeSettings(dst: string, pluginName: string): void {
  let data: Record<string, unknown> = {};
  if (fs.existsSync(dst)) {
    try {
      data = JSON.parse(fs.readFileSync(dst, "utf8")) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  let ep = data["enabledPlugins"];
  if (typeof ep !== "object" || ep === null || Array.isArray(ep)) {
    ep = {};
    data["enabledPlugins"] = ep;
  }
  (ep as Record<string, unknown>)[`${pluginName}@${pluginName}`] = true;
  let perm = data["permissions"];
  if (typeof perm !== "object" || perm === null || Array.isArray(perm)) {
    perm = {};
    data["permissions"] = perm;
  }
  let allow = (perm as Record<string, unknown>)["allow"];
  if (!Array.isArray(allow)) {
    allow = [];
    (perm as Record<string, unknown>)["allow"] = allow;
  }
  const entry = `mcp__plugin_${pluginName}_${pluginName}__*`;
  if (!(allow as unknown[]).includes(entry)) (allow as unknown[]).push(entry);
  fs.writeFileSync(dst, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// Fresh-install completion (AC-331) — the parts of the shipped shell entry's closed-set write the CLI
// used to leave to the script: the `goals/` dir, `.gitignore`, `.claude/settings.json`, the optional
// auto-commit, the install-steps text, and the closed-set failure report.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** The seven-item closed set (SPEC §6) — the exact relative paths a quay-init laydown may write. */
export const CLOSED_SET_ITEMS: readonly string[] = [
  ".quay/config.yml",
  ".quay/profiles.yml",
  "tasks",
  "goals",
  ".gitignore",
  ".claude/launch.settings.json",
  ".claude/settings.json",
];

/**
 * Fingerprint ONE closed-set item for the failure report: `ABSENT` / `UNREADABLE` / a content hash.
 * A DIRECTORY is hashed by its sorted entry listing (the exact granularity quay-init's only directory
 * write — `mkdir -p` — can change); a FILE by its bytes. `UNREADABLE` is kept DISTINCT from `ABSENT`
 * (硬规则 3b: "could not look" must not be reported with the shape of "not there").
 */
export function closedSetFingerprint(absPath: string): string {
  try {
    const st = fs.statSync(absPath);
    if (st.isDirectory()) {
      const entries = fs.readdirSync(absPath).slice().sort();
      return createHash("sha256").update(entries.join("\n")).digest("hex");
    }
    return createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
  } catch {
    return fs.existsSync(absPath) ? "UNREADABLE" : "ABSENT";
  }
}

/** Take the pre-write snapshot the failure report compares against. */
export function snapshotClosedSet(root: string): Record<string, string> {
  const snap: Record<string, string> = {};
  for (const item of CLOSED_SET_ITEMS) snap[item] = closedSetFingerprint(path.join(root, item));
  return snap;
}

/** Classify each closed-set item against the pre-write snapshot (the four-state vocabulary). */
export function closedSetReport(root: string, before: Record<string, string>): ClosedSetStateEntry[] {
  return CLOSED_SET_ITEMS.map((item) => {
    const now = closedSetFingerprint(path.join(root, item));
    let state: ClosedSetStateEntry["state"];
    if (now === "UNREADABLE") state = "unreadable";
    else if (now === "ABSENT") state = "unwritten";
    else if (before[item] === now) state = "pre-existing";
    else state = "written";
    return { item, state };
  });
}

/** Read the plugin's `name` from its manifest (the `.claude/settings.json` enable key's first half). */
export function readPluginName(pluginRoot: string | null | undefined): string {
  if (!pluginRoot) return "quay";
  const name = readJsonField(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "name", "quay");
  return name === "" ? "quay" : name;
}

/** Read the plugin's `version` from its manifest (`unknown` when unreadable — never a guess). */
export function readPluginVersion(pluginRoot: string | null | undefined): string {
  if (!pluginRoot) return "unknown";
  const v = readJsonField(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "version", "unknown");
  return v === "" ? "unknown" : v;
}

/** Lines of a manifest file, comments and blanks dropped. */
function readManifestLines(p: string): string[] {
  try {
    return fs
      .readFileSync(p, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
  } catch {
    return [];
  }
}

/**
 * Append the quay runtime ignore rules to `<root>/.gitignore` — idempotent, append-only, never
 * rewriting or reordering the consumer's own content:
 *   1. the `.quay/*` block (with the `config.yml`/`profiles.yml` negations, which stay tracked);
 *   2. the runtime-artifact block, whose PATTERNS are READ from the single-source manifest
 *      `plugin/scripts/quay-runtime-artifacts.txt` — the same file the fan-in's clean-tree judgment
 *      and `gitignore-runtime-coverage-check.ts` bind to. Re-listing them here would re-create the
 *      copy-that-drifted defect (硬规则 5b).
 *
 * Without (2) a consumer goes dirty on ANY task-store read (the parse cache, telemetry, event logs
 * all live OUTSIDE `.quay/`), and the mechanical fan-in's `ff` then refuses for every task forever.
 * A missing manifest is REPORTED, never silent.
 */
export function ensureGitignore(root: string, opts: { runtimeArtifactsManifest?: string | null; log?: (l: string) => void } = {}): { wrote: boolean; warnings: string[] } {
  const say = opts.log ?? ((l: string) => console.log(l));
  const gi = path.join(root, ".gitignore");
  const warnings: string[] = [];
  let wrote = false;

  const existing = (): string => (fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "");
  const blockPresent = (header: string): boolean => existing().split("\n").some((l) => l.trim() === header);

  const entries = [
    "# quay runtime state (generated by the loop — .quay/config.yml + .quay/profiles.yml stay tracked)",
    ".quay/*",
    "!.quay/config.yml",
    "!.quay/profiles.yml",
  ];
  if (!blockPresent(entries[0]!)) {
    fs.appendFileSync(gi, entries.join("\n") + "\n", "utf8");
    wrote = true;
    say("  appended: .quay/* (+ negation for config.yml/profiles.yml) to .gitignore");
  } else {
    say("  skipped: .gitignore already carries .quay/*");
  }

  const RUNTIME_HEADER =
    "# quay runtime artifacts outside .quay/ (written by quay itself; list = plugin/scripts/quay-runtime-artifacts.txt — do NOT hand-edit, add to that manifest)";
  if (!opts.runtimeArtifactsManifest) {
    warnings.push("runtime-artifact manifest path unknown — no quay runtime ignore rules written (a consumer project will go dirty on any task-store read)");
    say(`  WARNING: ${warnings[warnings.length - 1]}`);
    return { wrote, warnings };
  }
  const patterns = readManifestLines(opts.runtimeArtifactsManifest);
  if (patterns.length === 0) {
    warnings.push(`runtime-artifact manifest not found or empty at ${opts.runtimeArtifactsManifest} — no quay runtime ignore rules written`);
    say(`  WARNING: ${warnings[warnings.length - 1]}`);
    return { wrote, warnings };
  }
  if (blockPresent(RUNTIME_HEADER)) {
    say("  skipped: .gitignore already carries the quay runtime-artifact block");
    return { wrote, warnings };
  }
  const present = new Set(existing().split("\n").map((l) => l.trim()));
  const lines = [RUNTIME_HEADER];
  for (const p of patterns) if (!present.has(p)) lines.push(p);
  fs.appendFileSync(gi, lines.join("\n") + "\n", "utf8");
  wrote = true;
  say(`  appended: quay runtime-artifact block (${patterns.length} pattern(s))`);
  return { wrote, warnings };
}

/** Options for `printInstallSteps`. */
export interface InstallStepsOptions {
  /**
   * Where `~/.claude/plugins/installed_plugins.json` is read from (default: `$HOME`, else the OS
   * home). Threaded so a test can point the reader at a fixture home instead of mutating the
   * operator's real install record.
   */
  homeDir?: string;
  /**
   * The caller has EXPLICITLY asked for a project-/local-scope record for this project. Only then
   * does the printout present that install command — and always with the "pins the version, does
   * NOT follow user-scope upgrades" warning.
   */
  requestedScope?: "user" | "project" | "local";
}

/**
 * The explicit install steps. `enabledPlugins` only toggles an ALREADY-INSTALLED plugin and an
 * untrusted directory's project settings are not read at all, so "config committed ⇒ auto-installed"
 * is FALSE (SPEC §6 T3).
 *
 * ⚠️ THE USER-SCOPE PRE-CHECK (gap-init-install-steps-must-detect-existing-user-scope-install):
 * init does NOT install — it only PRINTS steps, and an agent follows them. So the printout must ask
 * FIRST whether `quay@quay` already has a user-scope record. Presenting user/project/local as three
 * equivalent choices when the user-scope install already exists is what made an agent add a second,
 * project-scoped record that PINS its version and never follows the user-scope upgrades
 * (plantuml-js 2026-10-21: user 0.19.0, then a project record pinned to 0.20.0).
 *
 * Three states, and they read differently on purpose (硬规则 3b): `present` ⇒ say "already installed
 * at user scope (version X), do NOT install again"; `absent` ⇒ the original three-way recipe;
 * `not-evaluated` (the record is missing/unparsable) ⇒ say the record could not be read and check it
 * FIRST — ⛔ never the `absent` recipe, which would read as "there is no user install".
 */
export function printInstallSteps(opts: InstallStepsOptions = {}): string {
  const homeDir = opts.homeDir ?? process.env.HOME ?? os.homedir();
  const userScope = userScopedInstallReading(homeDir);
  const requestedProjectScope = opts.requestedScope === "project" || opts.requestedScope === "local";
  return [
    "",
    "━━━ quay plugin install steps (explicit — config does NOT auto-install) ━━━",
    "The files just written ENABLE the quay plugin for this project, but they DO NOT install it.",
    "`enabledPlugins` only toggles an ALREADY-INSTALLED plugin, and an untrusted directory's project",
    "settings are not read at all — so \"config committed => auto-installed\" is FALSE.",
    "",
    ...(userScope.state === "present" ? alreadyUserScopedInstallSteps(userScope, opts, requestedProjectScope) : []),
    ...(userScope.state === "not-evaluated" ? unreadableInstallRecordSteps(userScope) : []),
    ...(userScope.state === "present" ? upgradeAndTrustSteps() : freshInstallSteps(opts.requestedScope)),
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
  ].join("\n");
}

/** The `present` arm: the user-scope record already covers this project, so installing again is the
 *  defect. The project/local command appears ONLY when the caller explicitly requested it, and the
 *  pin warning rides with it (never as a bare option). */
function alreadyUserScopedInstallSteps(
  r: UserScopedInstallReading,
  opts: InstallStepsOptions,
  requestedProjectScope: boolean,
): string[] {
  const version = r.version === null ? "(version not recorded)" : r.version;
  const lines = [
    `  ✓ ALREADY INSTALLED at user scope: quay@quay ${version}`,
    "    → do NOT install it again. One user-scope record serves every project on this machine;",
    "      upgrade it IN PLACE with `claude plugin update quay@quay --scope user` and this project",
    "      follows that upgrade with no record of its own.",
    "",
    "  # ⛔ Do NOT add a project/local scope record just to \"enable\" this project: such a record PINS",
    "  #    a version for this project and does NOT follow the user-scope upgrades (that is exactly",
    "  #    the version drift this step exists to prevent).",
  ];
  if (requestedProjectScope) {
    // Explicitly requested ⇒ print it, WITH the pin warning attached to the same block.
    lines.push(
      `  # You explicitly requested --scope ${opts.requestedScope}. This PINS the version for this`,
      "  # project and it will NOT follow user-scope upgrades:",
      `  claude plugin install quay@quay --scope ${opts.requestedScope}`,
    );
  }
  lines.push("");
  return lines;
}

/** The `not-evaluated` arm: the record could not be read, so we cannot say whether a user-scope
 *  install exists. Say that, give the check command, and only then fall back to the fresh recipe —
 *  the sentence is what keeps this state from reading exactly like `absent` (硬规则 3b). */
function unreadableInstallRecordSteps(r: UserScopedInstallReading): string[] {
  return [
    `  ⚠ the plugin install record could not be read — ${r.reason}`,
    "    → CHECK IT FIRST: if it already lists a user-scope quay@quay, do NOT install a project/local",
    "      record for this project (that PINS a version and does NOT follow user-scope upgrades):",
    "      claude plugin list --json | jq -r '.[] | select(.id==\"quay@quay\") | .scope' | sort -u",
    "",
  ];
}

/** The `absent` arm — the original behaviour when no user-scope record exists (AC: unchanged).
 *  Also used by the `not-evaluated` arm after its warning line (the recipe is the same; the state
 *  sentence printed above it is what tells the two states apart). */
function freshInstallSteps(requestedScope?: "user" | "project" | "local"): string[] {
  return [
    "  # 1. register the PUBLISHED marketplace source — the github channel. The CLI takes exactly ONE",
    "  #    <source> argument: `marketplace add <name> <source>` is rejected outright.",
    "  claude plugin marketplace add yaleh/quay",
    "",
    "  # 2. install it, at the scope YOU choose (⛔ `claude plugin install` defaults to `user`, so pass",
    "  #    --scope explicitly — but the VALUE is yours):",
    "  #      --scope user     one version for every project on this machine; upgrade once, here",
    "  #      --scope project  a per-project switch, version pinned in <cwd>/.claude/settings.json",
    "  #      --scope local    this working copy only, not committed",
    requestedScope === "project" || requestedScope === "local"
      ? `  claude plugin install quay@quay --scope ${requestedScope}`
      : "  claude plugin install quay@quay --scope <user|project|local>",
    "",
    "  # (or the npm-global path: `npm install -g quay` — its register-plugin.mjs postinstall registers",
    "  #  the marketplace source only; pass QUAY_PLUGIN_SCOPE=user|project|local to enable it in the same run)",
    "  #",
    ...upgradeAndTrustSteps(),
  ];
}

/** Steps 3-4 shared by every arm: upgrade IN PLACE, then trust + restart. */
function upgradeAndTrustSteps(): string[] {
  return [
    "  # 3. UPGRADE LATER — IN PLACE, at the scope that already holds the record (⛔ never `uninstall`",
    "  #    then `install --scope ...`: that replaces the record you have):",
    "  #      claude plugin list --json | jq -r '.[] | select(.id==\"quay@quay\") | .scope' | sort -u",
    "  #      claude plugin update quay@quay --scope <the scope just printed>",
    "  #    then re-run /quay:init in the project (it fills version-level `loop:` defaults; `.quay/plugin`",
    "  #    is no longer created — external consumers locate the CLI via the Claude Code plugin scope).",
    "",
    "  # 4. accept the trust dialog the FIRST time you enter this directory, then restart the session.",
    "After that, the enabledPlugins block below takes effect (a restart is required to apply).",
  ];
}

/**
 * `auto_commit_laid_down`: stage ONLY the closed-set paths and commit — so the enable propagates on
 * clone. NEVER sweeps pre-existing changes: only the six laid-down paths are `git add`-ed, and an
 * unrelated edit stays uncommitted. Non-interactive without `--auto-commit-config` DECLINES (a tool
 * must not silently commit a working tree it did not create).
 */
export function autoCommitClosedSet(root: string, mode: "yes" | "no" | "prompt", pluginVersion: string): AutoCommitReading {
  const git = (args: string[]): { ok: boolean; out: string } => {
    try {
      const out = execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { ok: true, out };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string };
      return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  };
  if (!git(["rev-parse", "--is-inside-work-tree"]).ok) {
    return { state: "not-a-repo", files: [], detail: "SKIP (not a git repository — the laid-down files are not committed; init a repo or commit manually)" };
  }
  const status = git(["status", "--porcelain"]).out;
  if (status.trim() === "") {
    return { state: "skipped", files: [], detail: "nothing to commit (working tree clean)" };
  }
  if (mode === "no") {
    return { state: "skipped", files: [], detail: "skipped as chosen — the laid-down files remain uncommitted" };
  }
  if (mode !== "yes" && !process.stdin.isTTY) {
    return {
      state: "declined",
      files: [],
      detail: "DECLINED (non-interactive — pass --auto-commit-config to commit, or --auto-commit-skip to skip)",
    };
  }
  const paths = [".quay/config.yml", ".quay/profiles.yml", "tasks", "goals", ".gitignore", ".claude/launch.settings.json", ".claude/settings.json"];
  for (const p of paths) {
    if (fs.existsSync(path.join(root, p))) git(["add", "--", p]);
  }
  const staged = git(["diff", "--cached", "--name-only"]).out.split("\n").map((l) => l.trim()).filter(Boolean);
  if (staged.length === 0) {
    return { state: "skipped", files: [], detail: "nothing staged (all laid-down files are gitignored or already committed)" };
  }
  const commit = git(["commit", "-q", "-m", `chore(quay-init): initialize quay project files (plugin v${pluginVersion})`]);
  if (!commit.ok) {
    return {
      state: "skipped",
      files: staged,
      detail: `ERROR: auto-commit failed (git commit returned non-zero). Configure git identity, then re-run init (idempotent) to commit. ${commit.out.trim()}`.trim(),
    };
  }
  return { state: "committed", files: staged, detail: `committed ${staged.length} file(s) as chore(quay-init) (plugin v${pluginVersion})` };
}
