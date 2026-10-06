// quay init — workspace scaffolding (DIR-098 / M164).
// Generates .quay/config.yml with all 4 sections (providers, gates, loop, serve) +
// inline documentation, creates tasks/ dir, prints next-step instructions.
//
// Shared between Core CLI (packages/quay/bin/quay.ts) and native CLI
// (packages/quay-native/bin/quay-native.ts).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { ensureBranchModel, formatBranchModelReport, type BranchModelReport } from "./branch-model.ts";
// The ONE regex-literal escaper (kernel leaf). This file used to inline the escape body at the
// `key`-literal site — one of the spelling variants invisible to the previous sweep's byte needle
// (finding `escaperegexp-sweep-missed-two`, routine `semantic-dedup-scan`; see
// packages/quay/test/kernel-regex-escape.test.mjs ④).
import { escapeRegExp } from "./kernel/regex-escape.ts";
// The serve binding's ONE fallback (a leaf module): the seed values of the `serve:` config section
// are THAT constant, so the delivered key and the code's fallback cannot become two defaults.
import { SERVE_BINDING_FALLBACK } from "./serve-binding.ts";
// The ONE plugin-tree resolver (gap-project-quay-pointer-is-init-plugin-root-and-version-records-
// derive-from-it): the project link's source-checkout guard reuses `isPluginSourceCheckout` so the
// "is this an install or a working tree" judgment cannot fork into two spellings.
import { isPluginSourceCheckout } from "./plugin-root.ts";
// The ONE binding judge (gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver):
// `verify_provider_runtime_existence`'s reader resolves the native provider's runtime file through
// the SAME function the runtime and the validator use, so an omitted binding is verified (from the
// plugin root) instead of silently skipped.
import { resolveProviderEntry, NATIVE_PROVIDER_UNRESOLVABLE } from "./config.ts";

// ── Three-state classification of an existing `.quay/config.yml` ────────────────────────────────────
// (SPEC-quay-init-reconcile-and-native-implementation-2026-09-18 §3.3; AC1.)
//
// WHY THREE STATES AND NOT A BOOLEAN: `fs.existsSync` answers "is there a file at this path", and the
// callers used that answer for a different question — "is there a config I must not clobber". The two
// coincide only while every existing file happens to be usable. A file that exists but cannot be
// parsed is NOT a config: reporting it through the same branch as a valid one hides the real cause
// behind "already exists, use --force" (the user cannot tell a name conflict from a broken file), and
// reporting it as "absent" would silently overwrite whatever the user still has on disk.
// 硬规则 3b: a judge that cannot read its input must not return the value it returns on a verdict —
// so "corrupt" is its OWN state with its OWN reason string, never folded into either neighbour.
export type ConfigState = "absent" | "valid" | "corrupt";

export interface ConfigClassification {
  state: ConfigState;
  /** Absolute path that was classified. */
  configPath: string;
  /** Parsed document — present only when `state === "valid"` (an empty file yields `{}`). */
  config?: Record<string, unknown>;
  /**
   * The file's bytes as read, present whenever the file exists and was readable. Carried so the
   * reconcile edits the SAME bytes this classification judged, instead of re-reading the path and
   * re-opening the window between "is it valid?" and "what do I edit?".
   */
  raw?: string;
  /**
   * Why this file is not usable, verbatim from the reader/parser — present only when
   * `state === "corrupt"`. Surfaced to the operator unchanged: the whole point of the third state is
   * that the operator is told the REAL cause instead of a generic "already exists".
   */
  reason?: string;
}

/**
 * Classify an existing `.quay/config.yml` into absent / valid / corrupt.
 *
 * "valid" means: the file was read AND `YAML.parse` produced a plain object (or nothing, for an empty
 * file). Everything else that exists is "corrupt" — unreadable bytes, a YAML syntax error, or a
 * document whose top level is a scalar/list (which no consumer downstream can read as a config map).
 */
export function classifyConfig(configPath: string): ConfigClassification {
  if (!fs.existsSync(configPath)) return { state: "absent", configPath };

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    return { state: "corrupt", configPath, reason: `cannot read the file: ${err instanceof Error ? err.message : String(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    return { state: "corrupt", configPath, reason: `YAML parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (parsed === null || parsed === undefined) return { state: "valid", configPath, config: {}, raw };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      state: "corrupt",
      configPath,
      raw,
      reason: `the document's top level is ${Array.isArray(parsed) ? "a list" : `a ${typeof parsed}`}, not a mapping — no quay consumer can read it as a config`,
    };
  }
  return { state: "valid", configPath, config: parsed as Record<string, unknown>, raw };
}

// ── The current-version `loop:` default schema — THE single source of truth (SPEC §3.2) ─────────────
//
// THE DEFECT THIS REPLACES: every new version-level `loop:` default had to be hand-copied into a
// purpose-built merge function (`quay-init.sh`'s `ensure_loop_config` knows exactly four keys;
// `ensure_provider_carrier_env` knows exactly three more). A default added to the fresh-install
// template but not to those functions is unreachable for every project that was initialized before
// it — forever, no matter how many times the upgrade entry re-runs. Measured on a real project
// (quay-fleet, 2026-09-18): `fork_baseline` / `merge_target` were added to the template three days
// after that project's init (`fe053af7`), and re-running `/quay:init` left the config's mtime
// unchanged. That is not an oversight to fix once — it is the SHAPE of the mechanism, so the fix is
// to remove the second place: there is now ONE table, and adding a key here is the whole change.
//
// ⛔ ONLY version-level CONSTANTS belong here. A key whose right value depends on the project
// (repo_root / test_command / tmux_session / worktree_root / worktree path) is DETECTED, not
// defaulted, and inventing a constant for it would write a confidently wrong value into a user's
// config — strictly worse than leaving it out.
export const LOOP_VERSION_DEFAULTS: Readonly<Record<string, unknown>> = {
  /** The branch a task worktree forks from (SPEC-branching-model current ruling: `develop`). */
  fork_baseline: "develop",
  /**
   * The doc/code declaration the mechanical fan-in reads to decide whether a task branch's delta may
   * skip the full suite (`select-static-checks-for-touches.ts --classify-delta`, through its
   * `resolveDocSurfaceDecision`; gap-fan-in-delta-classify-declared-doc-surfaces).
   *
   * A VERSION-LEVEL constant, not a detected value: quay can name the surfaces IT writes into every
   * workspace (the task board, the goal store, this config dir), and a project EXTENDS the list with
   * its own documentation/telemetry prefixes. Anything not listed is CODE (fail-closed), so the cost
   * of a too-short list is a suite run, while the cost of a missing entry is a lost verification.
   * ⛔ It only decides on a tree that carries no quay checker registry — that registry decides on
   * quay's own tree, where the declaration is inert.
   * ⛔ Mirror: `plugin/scripts/quay-init.sh`'s fresh-install heredoc writes the same value from its
   * own DEFAULT_DOC_SURFACES (shell cannot import this table) — change both together, as that file's
   * own note about mirroring version-level defaults requires.
   */
  doc_surfaces: ["tasks/", "goals/", ".quay/"],
};

// ⛔ `merge_target` is DELIBERATELY NOT in the table above, and the reason is executable rather than
// editorial: `plugin/test/quay-init.test.mjs` asserts the loop section must NOT carry it
// ("the zero-consumer key is deleted from the writer face — the negative control is that the dead key
// is NOT written, not merely unwired", from gap-config-key-consumer-check-mechanical-enumeration).
// This task's own AC2 named both keys in its regression fixture, on the strength of the quay-fleet
// symptom; that fixture was written before this constraint was discovered, and it is the constraint
// that wins, because the alternative is two fresh-install writers that disagree about what this
// version emits — the exact drift this whole change exists to remove. `merge_target` is display-only
// here: `serve-render.ts` reads `loop.merge_target ?? loop.fork_baseline`, so a config without it is
// still honestly rendered from the fork baseline, and `worker-driver.ts` never reads the config for
// it at all (`mergeTarget ?? "develop"` is an OPTION default). A config that already carries it keeps
// its value (the reconcile preserves what it does not own); one carrying the retired `integration` is
// still migrated — see LOOP_VALUE_MIGRATIONS. See this task's DoD evidence for the recorded deviation.

/**
 * Explicit migration table for values this version considers incompatible (SPEC §3.2).
 *
 * Keyed by `loop:` key → the set of values that must NOT survive a reconcile, with the replacement.
 * Distinct from both neighbours on purpose: a key absent from the config is FILLED from
 * `LOOP_VERSION_DEFAULTS`; a key carrying an ordinary user value is PRESERVED verbatim; only a value
 * listed here is rewritten. That is the third arm the SPEC asks for ("不是简单保留也不是简单覆盖").
 */
export const LOOP_VALUE_MIGRATIONS: Readonly<Record<string, { from: readonly string[]; to: unknown; why: string }>> = {
  merge_target: {
    from: ["integration"],
    to: "develop",
    why: "`integration` was the landing branch of the retired classic milestone loop (ADR-022); a config still naming it as the fan-in target points at a branch nothing maintains.",
  },
};

/**
 * The current-version `serve:` default schema — the SAME single-source discipline as
 * `LOOP_VERSION_DEFAULTS`, for the web binding (gap-serve-binding-defaults-three-copies-to-one-
 * definition-point). The seed values ARE the fallback (⛔ not a literal port): a fresh workspace is
 * born carrying the same values `resolveServeBinding` falls back to, so the delivered key and the
 * code's fallback cannot drift into two defaults. Keyed `serve:` → key, filled by the same
 * comment-preserving reconcile that fills `loop:` — without that, the key is unreachable for every
 * project initialized before it, forever (the defect `init.ts:90` records verbatim).
 */
export const SERVE_VERSION_DEFAULTS: Readonly<Record<string, unknown>> = {
  host: SERVE_BINDING_FALLBACK.host,
  port: SERVE_BINDING_FALLBACK.port,
};

export interface ReconcileReport {
  /** `loop:` keys that were absent from the config and were filled from LOOP_VERSION_DEFAULTS. */
  added: string[];
  /** `serve:` keys that were absent and were filled from SERVE_VERSION_DEFAULTS. Kept SEPARATE from
   *  `added` so "the version-required loop keys" keeps meaning exactly that (the pinned schema test
   *  reads `added`), while the fill is still reported to the operator. */
  addedServe: string[];
  /** `key: old -> new` for values rewritten via LOOP_VALUE_MIGRATIONS. */
  migrated: string[];
  /**
   * True when the reconciled document is byte-identical to the input ⇒ nothing was written. Kept as
   * its own field (not inferred from `added.length === 0`) because a migration and a fill can cancel
   * out byte-wise; "did we write" is the question the caller must be able to answer.
   */
  unchanged: boolean;
}

/**
 * Reconcile an existing config's `loop:` section to the current version's schema.
 *
 * PRESERVATION IS THE DEFAULT: the document is edited through `YAML.parseDocument` / `doc.setIn` —
 * the comment-preserving Document API — so every key the user already has (and every comment, which
 * `YAML.parse` + a re-dump would silently destroy) survives byte-for-byte; only the keys this
 * function actually sets appear in the output. Callers must not write the file when `unchanged` is
 * true (mirrors `quay-init.sh`'s AC3 "no gratuitous rewrite" discipline: a version-level no-op must
 * not reformat a project's config).
 *
 * @throws when the input is not parseable — callers reach this only after `classifyConfig` returned
 *         "valid", so a throw here means the file changed underneath them; it is never swallowed.
 */
export function reconcileConfigContent(raw: string): { content: string; report: ReconcileReport } {
  const doc = YAML.parseDocument(raw);
  const added: string[] = [];
  const addedServe: string[] = [];
  const migrated: string[] = [];

  for (const [key, value] of Object.entries(LOOP_VERSION_DEFAULTS)) {
    if (doc.hasIn(["loop", key])) continue;
    doc.setIn(["loop", key], value);
    added.push(key);
  }

  // The serve binding's version-level defaults travel through the SAME comment-preserving
  // reconcile — an absent `serve:` section is filled, a present one is left byte-for-byte alone.
  for (const [key, value] of Object.entries(SERVE_VERSION_DEFAULTS)) {
    if (doc.hasIn(["serve", key])) continue;
    doc.setIn(["serve", key], value);
    addedServe.push(key);
  }

  for (const [key, rule] of Object.entries(LOOP_VALUE_MIGRATIONS)) {
    const current = doc.getIn(["loop", key]);
    if (typeof current !== "string" || !rule.from.includes(current)) continue;
    doc.setIn(["loop", key], rule.to);
    migrated.push(`${key}: ${current} -> ${String(rule.to)}`);
  }

  // ⛔ `unchanged` is decided by "was there anything to do", NOT by `doc.toString() === raw`.
  // Those are not the same question, and answering the byte question would be wrong in the
  // direction that matters: the Document API normalizes some formatting it did not change the
  // MEANING of (a trailing blank line, say), so a no-op reconcile of a current config would report
  // "changed" and rewrite the file — the gratuitous rewrite this whole discipline exists to avoid.
  // A reconcile with nothing to add and nothing to migrate has nothing to write, full stop.
  const unchanged = added.length === 0 && addedServe.length === 0 && migrated.length === 0;
  return { content: unchanged ? raw : doc.toString(), report: { added, addedServe, migrated, unchanged } };
}

/**
 * Result of an init operation.
 */
export interface InitResult {
  /**
   * "written" | "dry-run" | "skipped" (existing + valid, no --force/--reconcile) |
   * "corrupt" (existing + unparseable, no --force/--reconcile) |
   * "reconciled" (existing + valid + --reconcile, and the config had to change) |
   * "unchanged" (existing + valid + --reconcile, and the config was already current) |
   * "branch-model-blocked" (divergent landing baseline without adoption) |
   * "branch-model-only" (the config-free branch-model entry — see `branchModelOnly`).
   */
  outcome: string;
  /**
   * Three-state classification of the config BEFORE this run (AC1). Carried on the result so every
   * caller can distinguish "there was no config" from "there was one and it was broken" — the
   * distinction the boolean `configExists` this replaces could not express (硬规则 3b).
   */
  configState: ConfigState;
  /** Why the config was unreadable — present only when `outcome === "corrupt"`. */
  corruptReason?: string;
  /** What the reconcile changed — present only when `outcome === "reconciled" | "unchanged"`. */
  reconcile?: ReconcileReport;
  /** Absolute path to the config file that was (or would be) written. */
  configPath: string;
  /** Absolute path to the tasks dir that was (or would be) created. */
  tasksDir: string;
  /** The full generated config YAML content (for dry-run printing). */
  content: string;
  /** Absolute path to the .claude/launch.settings.json scaffold. */
  launchSettingsPath: string;
  /** The full generated launch.settings.json content (for dry-run printing). */
  launchSettingsContent: string;
  /** Absolute path to the .quay/profiles.yml scaffold. */
  profilesPath: string;
  /** The full generated .quay/profiles.yml content (for dry-run printing). */
  profilesContent: string;
  /**
   * The quay branch model this init established (or would establish). See branch-model.ts: the
   * landing baseline (`develop`) the fan-in/anti-drift path reads is ESTABLISHED here, never
   * assumed — that is the whole fix for
   * gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing.
   */
  branchModel: BranchModelReport;
  /** `formatBranchModelReport(branchModel)` — the operator-facing rendering. */
  branchModelReport: string;
}

/**
 * Options for the init command.
 */
export interface InitOptions {
  /** Project root path (default: CWD). */
  root: string;
  /** Overwrite existing config. */
  force: boolean;
  /** Print to stdout instead of writing to disk. */
  dryRun: boolean;
  /**
   * Reconcile an EXISTING config to this version's schema instead of refusing it (SPEC §3.2).
   *
   * This is the mode `/quay:init` needs: the shipped upgrade path must be able to re-run on an
   * already-initialized project and bring its config up to what THIS version of quay requires —
   * filling keys the version added since the project was initialized (`LOOP_VERSION_DEFAULTS`) and
   * rewriting values this version considers incompatible (`LOOP_VALUE_MIGRATIONS`) — while leaving
   * every other key and comment byte-for-byte alone.
   *
   * Robustness is the point, so the flag is total over the three states (AC1): absent ⇒ a normal
   * fresh write; corrupt ⇒ salvage-by-rebuild (the unparseable file is preserved beside the new one);
   * valid ⇒ the per-key diff. With it, re-running init is always a legal, idempotent operation.
   *
   * `force` still wins where both are given: an explicit overwrite is not a diff.
   */
  reconcile?: boolean;
  /** Provider id override (default: auto-detect). */
  provider?: string;
  /**
   * Adopt a foreign landing baseline instead of refusing it (branch-model.ts). When the target
   * project already has a `develop` (or `author`) that is NOT a continuation of its default branch,
   * the default behavior is to REFUSE — reusing it silently would make every task's anti-drift diff
   * meaningless. With this flag the existing tip is preserved under
   * `<branch>-pre-quay-init-<sha>` and the branch is re-pointed at the default branch tip.
   * Nothing is destroyed either way; the flag only decides whether init proceeds or stops.
   */
  adoptBranchModel?: boolean;
  /**
   * The CONFIG-FREE branch-model entry (`quay init --branch-model-only`) — establish the quay branch
   * model in an ALREADY-initialized project and touch nothing else.
   *
   * WHY THIS EXISTS (gap-upgrade-entry-never-establishes-branch-model): the SHIPPED upgrade entry is
   * `plugin/scripts/quay-init.sh` (SPEC §5 — what a real user runs, and what `/quay:init` runs), not
   * this CLI. `ensureBranchModel` was reachable only through a full `quay init`, which REWRITES the
   * whole config surface (`generateConfigContent`) — so on an existing project with its own `gates:`
   * / `loop:` / `routines:` the one available remedy was also the one that destroys the user's
   * config. That is exactly the write the shipped script's config-preserving branch exists to avoid.
   * The result was a project whose `develop` is a foreign fork having NO path that both establishes
   * the branch model and preserves its config — so it stayed un-landable forever, and the shell entry
   * silently wrote `fork_baseline: develop` (`quay-init.sh:995/:2217`) without ever establishing it.
   *
   * ⇒ This flag runs `ensureBranchModel` (the SAME single implementation, ADR-004 — the shell does not
   * re-implement `classifyBranch`) and returns immediately: no config write, no tasks/ mkdir, no
   * profiles/launch-settings lay-down. The config-exists refusal that guards the full `quay init` does
   * NOT apply here (an existing config is the NORMAL input — this entry exists for initialized
   * projects).
   */
  branchModelOnly?: boolean;
}

// These strings contain characters that confuse Node 26's TypeScript parser
// when embedded in template literals, so they are stored as raw strings.
const GH_TOKEN_REF = "$GITHUB_TOKEN";
const GH_TOKEN_SHELL_REF = "${GITHUB_TOKEN}";

/**
 * Pick the provider MCP server launch entry based on the RESOLVED provider
 * path form (gap-init-scaffolds-mcp-entry-to-raw-ts-fails-on-installed-copy).
 *
 * - INSTALLED form (the provider path contains a `node_modules` segment —
 *   e.g. `./node_modules/quay-native`, an npm-installed copy): launch the
 *   bundled dist ESM `./dist/quay-native.js` — the SAME target package.json's
 *   `bin` field points at. Raw `.ts` under node_modules is refused by Node
 *   ≥23.7 (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so the bundled JS
 *   is the only runnable form there.
 * - DEV form (the provider path is inside the repo tree — e.g.
 *   `./packages/quay-native` or a `../../...` repo-relative path): keep the
 *   raw TypeScript entry `./bin/quay-native.ts`, which runs fine outside
 *   node_modules.
 *
 * The Core's provider launcher resolves mcp_entry relative to provider.path,
 * so both forms are `./`-relative within the provider package root.
 */
export function mcpEntryForProvider(providerPath: string): string {
  const segments = providerPath.split(/[\\/]+/);
  const installed = segments.includes("node_modules");
  return installed
    ? '["node", "./dist/quay-native.js", "mcp"]'
    : '["node", "./bin/quay-native.ts", "mcp"]';
}

/**
 * Generate the full .quay/config.yml content with all 3 sections and inline
 * documentation for every supported field.
 */
export function generateConfigContent(opts: { providerId: string; providerPath: string; isNode: boolean; isGo: boolean }): string {
  const { providerId, providerPath, isNode, isGo } = opts;

  // Build gate suggestions based on project type.
  const gateSuggestions = buildGateSuggestions({ isNode, isGo });

  const lines: string[] = [
    "# .quay/config.yml — quay workspace configuration",
    "# Generated by `quay init`. See README.md or run `quay --help` for usage.",
    "",
    "# " + ruleLine(69),
    "# Section 1: Providers — where tasks live",
    "# " + ruleLine(69),
    "# quay is provider-agnostic: tasks can live on a local filesystem",
    "# (native provider), in GitHub Issues (github provider), or in any",
    "# backend that implements the Provider ABI.",
    "#",
    "# Each provider entry declares:",
    "#   enabled: true/false     — exactly ONE provider must be enabled",
    "#   path: <dir>             — provider package root (relative to workspaceRoot). OPTIONAL for the",
    "#                             native provider: Core resolves it from the plugin root when omitted.",
    "#   tasks_dir: <dir>        — where task files live (relative to workspaceRoot)",
    "#   mcp_entry: [cmd, args]  — how to launch the provider's MCP server (relative to provider.path).",
    "#                             OPTIONAL for the native provider (Core derives it from the plugin root);",
    "#                             REQUIRED for every other provider.",
    "#   env: <map>              — environment variables passed to the MCP server process",
    "#   default_task_status: todo|ready  — status for new tasks when none is specified (default: todo)",
    "#",
    "providers:",
    "  " + providerId + ":",
    "    enabled: true",
    "    path: \"" + providerPath + "\"",
    "    tasks_dir: \"./tasks\"",
    "    mcp_entry: " + mcpEntryForProvider(providerPath),
    "    env:",
    "      QUAY_NATIVE_TASKS_DIR: \"./tasks\"",
    "    # default_task_status: todo   # uncomment to change default status for new tasks",
    "",
    "  # GitHub provider (uncomment to use GitHub Issues as your task store):",
    "  # github:",
    "  #   enabled: false",
    "  #   path: \"./node_modules/quay-github\"",
    "  #   tasks_dir: \"./tasks\"",
    "  #   mcp_entry: [\"node\", \"./bin/quay-github.mjs\", \"mcp\"]",
    "  #   env:",
    "  #     GITHUB_TOKEN: \"" + GH_TOKEN_SHELL_REF + "\"",
    "  #     GITHUB_REPO: \"owner/repo\"",
    "",
    "# " + ruleLine(69),
    "# Section 2: Gates — automated quality checks",
    "# " + ruleLine(69),
    "# Gates are named, runnable checks that evaluate tasks. The gate engine",
    "# (QENG) runs them via `quay gate <task-id> [--gate <name>]`.",
    "#",
    "# Six gate types are supported:",
    "#   it0            — runs a script with args; argsKey names a task.extra",
    "#                    field whose value is passed as the script argument.",
    "#   adr            — checks that an ADR exists in the workspace adr/ dir.",
    "#   fixed          — runs a fixed script (no per-task args).",
    "#   testPass       — runs a test command; PASS if exit 0.",
    "#   coverageFloor  — runs a coverage command; parses output for a",
    "#                     percentage and PASS if >= floor.",
    "#   redGreen       — runs a RED command (must fail), then a GREEN",
    "#                     command (must pass) — RED->GREEN per ADR-001.",
    "#",
    "# All gate entries support optional cwd (working directory override) and",
    "# timeoutMs (millisecond deadline override).",
    "#",
    "gates:",
    "  # Built-in acceptance gate — always available, runs task.extra.acceptance",
    "  # as a shell command. Fail-closed if unset on a task.",
    "",
    "  # it0 gates — script-driven checks with per-task args:",
    "  # it0:",
    "  #   - name: dod-check          # gate name (used with --gate dod-check)",
    "  #     script: \"./scripts/it0-dod-check.sh\"",
    "  #     argsKey: acceptance       # reads task.extra.acceptance as the arg",
    "  #     # cwd: \"./subdir\"         # optional working directory",
    "  #     # timeoutMs: 120000        # optional timeout in milliseconds",
    "",
    "  # ADR gates — existence checks on architecture decision records:",
    "  # adr:",
    "  #   - ADR-001",
    "  #   - ADR-002",
    "",
    "  # Fixed-script gates — same script every run, no per-task args:",
    "  # fixed:",
    "  #   - name: lint",
    "  #     script: \"./scripts/lint.sh\"",
    "",
    "  # Test-pass gate" + gateSuggestions.testPassComment + ":",
    ...gateSuggestions.testPassLines,
    "",
    "  # Coverage-floor gate — runs a command and checks coverage percentage:",
    "  # coverageFloor:",
    "  #   - name: coverage-80",
    "  #     command: \"node --test --experimental-test-coverage test/*.mjs\"",
    "  #     floor: 80",
    "  #     # pattern: \"All files\"     # optional regex to extract coverage line",
    "",
    "  # Red-green gate — RED must fail, GREEN must pass (ADR-001):",
    "  # redGreen:",
    "  #   - name: red-green-tests",
    "  #     red: \"node --test --test-name-pattern='failing test' test/*.mjs\"",
    "  #     green: \"node --test test/*.mjs\"",
    "",
    "# " + ruleLine(69),
    "# Section 3: Loop — autonomous iteration driver",
    "# " + ruleLine(69),
    "# The loop driver (`quay run`) scans the board for ready tasks and drives",
    "# them through gate checks. Configured here or in .quay/loop.yml (legacy).",
    "#",
    "# Fields:",
    "#   board: <provider>         REQUIRED — which provider to scan (e.g. \"native\")",
    "#   gates: <name> | [names]   REQUIRED — gate(s) to run on each task",
    "#   stop: <policy>            OPTIONAL — when to stop (default \"once\"):",
    "#                               \"once\"         — process one ready task",
    "#                               \"until(.halt)\"  — stop when .halt sentinel exists",
    "#                               \"until(empty)\"  — stop when no ready tasks remain",
    "#                               \"until(<cond>)\" — stop on custom condition",
    "#   policy: <name>            OPTIONAL — task selection ranking (default \"ready-first\")",
    "#   execution: dispatched|inline  OPTIONAL — build style (default \"dispatched\"):",
    "#                               \"dispatched\" — fresh background subagent per task",
    "#                               \"inline\"     — run in the driver's own context",
    "#   audit: adversarial|none   OPTIONAL — audit style (default \"adversarial\"):",
    "#                               \"adversarial\" — fresh subagent audits diff before land",
    "#                               \"none\"        — gate-output only, no independent audit",
    "#   concurrency: <int>        OPTIONAL — max parallel builds (default 1, serial).",
    "#                               >1 requires touches-disjoint tasks.",
    "#   routines:                 OPTIONAL — standing routine track (periodic tasks):",
    "#     - name: <string>          routine name",
    "#       trigger: every(N)|on(<event>)  when to fire",
    "#       dispatch: <prompt>      (legacy) prompt to dispatch",
    "#       probe: <name>           (DIR-056) probe-spec name",
    "#",
    "loop:",
    "  board: \"" + providerId + "\"",
    "  gates: []",
    // The version-level defaults, EMITTED FROM THE SAME TABLE the reconcile fills from
    // (`LOOP_VERSION_DEFAULTS`) rather than re-typed here. Two hand-kept copies of one list is the
    // defect this whole change exists to remove: a fresh workspace must not be born one reconcile
    // behind, which is exactly what a template that forgets a key the reconcile knows about produces.
    // `loopDefaultLine` (not `String(v)`) so a LIST value emits a real YAML flow sequence —
    // `String(["a"])` is `"a"`, which parses back as the scalar `a` and silently turns a list into a
    // string (the same class as the "a value that looks like a declaration but is not one" defect).
    ...Object.entries(LOOP_VERSION_DEFAULTS).map(([k, v]) => `  ${k}: ${versionDefaultLine(v)}`),
    "  # stop: \"once\"                # uncomment and set your preferred stop policy",
    "  # policy: \"ready-first\"        # uncomment to customize task selection",
    "  # execution: \"dispatched\"      # uncomment to use inline builds",
    "  # audit: \"adversarial\"         # uncomment to skip adversarial audit",
    "  # concurrency: 1               # uncomment for parallel builds (requires touches-disjoint)",
    "  # routines:                    # uncomment to add periodic routines",
    "  #   - name: \"health-check\"",
    "  #     trigger: \"every(60)\"",
    "  #     probe: \"health\"",
    "",
    "# " + ruleLine(69),
    "# Section 4: Serve — the web server's bind binding",
    "# " + ruleLine(69),
    "# OPTIONAL. The web server's bind host/port. Absent ⇒ the declared fallback below (a host on",
    "# all interfaces, and port 0 = NO CONSTRAINT — the kernel assigns an ephemeral port that is",
    "# read back from .quay/server.json). This section is PER-CHECKOUT by construction:",
    "# `.quay/config.yml` is gitignored, so two workspaces on one machine pick different ports.",
    "#",
    "# Exactly ONE reader: `resolveServeBinding` (packages/quay/src/serve-binding.ts). An explicit",
    "# command-line `--host` / `--port` still wins over this section; a malformed value here (a",
    "# non-integer port, a blank host) REFUSES the start rather than silently falling back — so",
    "# 「配错了」 and 「没配」 are never the same reading.",
    "#",
    "serve:",
    // Emitted from the SAME table the reconcile fills from (SERVE_VERSION_DEFAULTS), whose values are
    // the ONE fallback constant — a fresh workspace is born carrying exactly what the code falls back
    // to, so the delivered key cannot drift into a second default.
    ...Object.entries(SERVE_VERSION_DEFAULTS).map(([k, v]) => `  ${k}: ${versionDefaultLine(v)}`),
    "",
  ];

  return lines.join("\n");
}

function ruleLine(len: number): string {
  return "─".repeat(len);
}

/** Render ONE version-level default value (`LOOP_VERSION_DEFAULTS` / `SERVE_VERSION_DEFAULTS`) as
 *  YAML for the fresh-install template. A string array becomes a flow sequence of double-quoted
 *  scalars (`["a", "b"]`) — `String(v)` would emit `a,b`, which YAML reads back as the single scalar
 *  `a,b` (a list silently becoming a string is the kind of quiet mis-typing the template must not
 *  introduce). Every other value keeps the historical `String(v)` rendering, so no existing key's
 *  emitted bytes move. */
function versionDefaultLine(v: unknown): string {
  if (Array.isArray(v)) {
    return `[${v.map((x) => JSON.stringify(String(x))).join(", ")}]`;
  }
  return String(v);
}

interface GateSuggestion {
  testPassComment: string;
  testPassLines: string[];
}

function buildGateSuggestions({ isNode, isGo }: { isNode: boolean; isGo: boolean }): GateSuggestion {
  if (isNode) {
    return {
      testPassComment: " — runs a test command, PASS if exit 0",
      testPassLines: [
        "  # testPass:",
        "  #   - name: node-tests",
        "  #     command: \"node --test test/*.mjs\"",
      ],
    };
  }
  if (isGo) {
    return {
      testPassComment: " — runs a test command, PASS if exit 0",
      testPassLines: [
        "  # testPass:",
        "  #   - name: go-tests",
        "  #     command: \"go test ./...\"",
      ],
    };
  }
  return {
    testPassComment: " (no project-type detected; uncomment and edit to match your stack)",
    testPassLines: [
      "  # testPass:",
      "  #   - name: tests",
      "  #     command: \"your-test-command-here\"",
    ],
  };
}

/**
 * Detect the project type from the target root.
 */
export function detectProjectType(root: string): { isNode: boolean; isGo: boolean } {
  const isNode = fs.existsSync(path.join(root, "package.json"));
  const isGo = fs.existsSync(path.join(root, "go.mod"));
  return { isNode, isGo };
}

/**
 * Auto-detect the provider id. Defaults to "native".
 */
export function detectProvider(): string {
  return "native";
}

/**
 * Generate the `.claude/launch.settings.json` content laid down by `quay init`.
 *
 * gap-quay-init-launch-settings-template-missing-permissions-and-exclude-dynamic:
 * the scaffold previously laid down NO launch.settings.json at all — consumers
 * hand-copied it, and the copy was missing the `permissions.defaultMode:
 * "bypassPermissions"` block (measured F1/F2 on ad-arm1 archguard: inner
 * cold-start hit a permission prompt on its own loop scripts,
 * monitor-mount-check.sh).
 *
 * AC154 (profile 抽层): `_launchSpec` is GONE — launch.settings.json now carries
 * ONLY Claude Code keys ($schema/permissions/env). The profile/roles (launcher/
 * model/--bare/-n/unset) + flag-only params live in the sibling `.quay/profiles.yml`
 * scaffold (generateProfilesContent). Roles default to the generic `claude` launcher
 * / null model; a consumer edits them to their stack (quay itself uses
 * claude-fjdac + deepseek-v4-pro-anthropic).
 */
export function generateLaunchSettingsContent(): string {
  return (
    JSON.stringify(
      {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        permissions: { defaultMode: "bypassPermissions" },
        env: { CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false" },
      },
      null,
      2,
    ) + "\n"
  );
}

/** Build the `<project>-<role>` session-name prefix. Mirrored (same rule, same output) by
 * `quay-init.sh`'s `profiles_name_prefix()`; a divergence is caught by the byte-equality test in
 * `plugin/test/profiles-role-coverage-check.test.mjs`. */
export function profilesNamePrefix(projectName: string): string {
  const cleaned = projectName.replace(/[^A-Za-z0-9._-]/g, "-");
  return cleaned === "" ? "quay" : cleaned;
}

/**
 * The SHIPPED `.quay/profiles.yml` template — the ONE authored copy of the profile carrier.
 * Byte-identical to the checked-in `plugin/.quay/profiles.yml` (the file `quay-init.sh` copies
 * into a target workspace and `quay-launch.sh` falls back to), with the role session names
 * parameterised on the project.
 *
 * ⛔ Why the template is duplicated here instead of read from disk (packaging, not preference):
 * this function must work from `src/init.ts` AND from the bundled `dist/quay.js` in every layout
 * the package ships in — repo source tree, the `quay` npm package, the plugin's vendored mirror
 * (`plugin/vendor/quay/dist/`). The shipped file's path relative to this module differs across
 * all three, so no single path is correct in all of them. The duplication is therefore bound by
 * an EXECUTABLE invariant rather than by discipline: `packages/quay/test/init.test.mjs` asserts
 * `generateProfilesContent("quay") === readFileSync(plugin/.quay/profiles.yml)` byte-for-byte, so
 * a one-sided edit cannot land (hard rule 9 — give the rule a product, not a reminder).
 *
 * ⛔ Role session names are `<project>-<role>`, NOT a hardcoded `quay-` prefix. A third-party
 * project that copied quay's literal names collided with quay's OWN sessions, and cross-session
 * delivery addresses peers BY NAME ⇒ misrouting (`sendmessage-shared-worker-name-misroutes`).
 */
export function generateProfilesContent(projectName: string = "quay"): string {
  return SHIPPED_PROFILES_TEMPLATE.replace(/^(\s*name:\s*)quay-/gm, `$1${profilesNamePrefix(projectName)}-`);
}

const SHIPPED_PROFILES_TEMPLATE = [
  "# plugin/.quay/profiles.yml — shipped fallback profile carrier (AC154 profile 抽层）。",
  "# 裸机 / 未迁移目标没有 dev-tree 根 .quay/profiles.yml 时，quay-launch.sh 回退到本文件（同 settings 的",
  "# plugin/.claude/launch.settings.json 回退手法，见 gap-manager-layer-no-verified-install-vector）。",
  "# 通用默认：launcher=claude、model=null——消费者按自己的栈编辑（dev-tree 用 claude-fjdac +",
  "# deepseek-v4-pro-anthropic，见根 .quay/profiles.yml；两份 profiles 结构一致，只差 launcher/model 取值）。",
  "version: 1",
  "",
  "# flag-only 启动参数（对全部 role 生效；与 dev-tree 根 profiles.yml 一致）。",
  "excludeDynamicSystemPromptSections: true",
  "promptSuggestions: false",
  "",
  "profiles:",
  "  worker-default:",
  "    launcher: claude",
  "    model: null",
  "    bare: false",
  "    auth: key              # 原生 claude 读 ANTHROPIC_API_KEY",
  "  manager-local:",
  "    launcher: claude",
  "    model: null",
  "    bare: false",
  "    auth: key",
  "    # 无 unset：出厂 settings（plugin/.claude/launch.settings.json）的 env 本就没有 917k 三件套",
  "    # （裸机通用模板），manager 直接继承文件逐字。dev-tree 根的 manager-local 才需要 unset 917k",
  "    # （dev settings env 含 917k）。",
  "",
  "roles:",
  "  manager:",
  "    profile: manager-local",
  "    name: quay-manager",
  "  outer:",
  "    profile: worker-default",
  "    name: quay-outer",
  "  # 三个 worker role + pool-judge/meta-driver 与 dev-tree 根 profiles.yml 同构：共享 worker-default，",
  "  # 只声明 name 差异（launcher/model 从 profile 继承）。role 键集一致是 DoD——worker-driver 派发",
  "  # `launchArgv(\"task-worker\", …)` 经 profile-policy.ts resolveRole，缺失 role 抛 `role not found`",
  "  # （fail-closed，无回退）⇒ 第三方项目永不派发（gap-shipped-profiles-missing-worker-roles）。",
  "  # ⚠️ mcpBlacklist 同样必须在【两份 carrier】上都落地（gap-worker-mcp-blacklist-strict-config）：",
  "  #   本文件是 quay-init 逐字铺进消费者 .quay/ 的那一份；只改 dev-tree 根 ⇒ 第三方项目功能静默失效",
  "  #   ——这正是 profiles-role-coverage-check.ts 存在的那个「修了一份、init 铺的是另一份」缺陷形状。",
  "  task-worker:",
  "    profile: worker-default",
  "    name: quay-task-worker",
  "    env:",
  "      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: \"0\"    # 驱动的外部超时是唯一兜底（无此键 claude -p 有 600s end_turn 后台任务宽限）",
  "    # 角色层（⛔ 非 profile 层）：outer 与它们共享 worker-default，挂 profile 会连坐 outer。",
  "    # 三个 role 各写一份（⛔ 不用 YAML 锚点——本文件被 quay-launch.sh 的 python3+yaml 与 TS 的",
  "    # profile-policy.ts 两条路径读，保持与两份 carrier 既有写法一致的朴素形状）。",
  "    mcpBlacklist:",
  "      - chrome-devtools",
  "      - playwright",
  "  selector:",
  "    profile: worker-default",
  "    name: quay-selector",
  "    mcpBlacklist:",
  "      - chrome-devtools",
  "      - playwright",
  "  fix-worker:",
  "    profile: worker-default",
  "    name: quay-fix-worker",
  "    env:",
  "      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: \"0\"    # 同 task-worker",
  "    mcpBlacklist:",
  "      - chrome-devtools",
  "      - playwright",
  "  pool-judge:",
  "    profile: worker-default",
  "    name: quay-pool-judge",
  "  meta-driver:",
  "    profile: worker-default",
  "    name: quay-meta-driver",
  "",
].join("\n");

/**
 * Run the init operation.
 *
 * @returns InitResult on success.
 * @throws Error on unexpected filesystem errors (permissions, etc.).
 */
export function runInit(opts: InitOptions): InitResult {
  const root = path.resolve(opts.root);
  const quayDir = path.join(root, ".quay");
  const configPath = path.join(quayDir, "config.yml");
  const tasksDir = path.join(root, "tasks");
  const launchSettingsPath = path.join(root, ".claude", "launch.settings.json");
  const launchSettingsContent = generateLaunchSettingsContent();
  const profilesPath = path.join(quayDir, "profiles.yml");
  // The role session names are derived from THIS project (AC4): a third-party project must not
  // copy quay's literal `quay-*` names, or its sessions collide with quay's own and name-addressed
  // cross-session delivery misroutes. `quay-init.sh` applies the same rule to the file it copies.
  const profilesContent = generateProfilesContent(path.basename(root));

  // ── The CONFIG-FREE branch-model entry (gap-upgrade-entry-never-establishes-branch-model) ──────
  // FIRST, before the config-exists refusal: an existing `.quay/config.yml` is this entry's NORMAL
  // input (the shipped upgrade entry runs on an already-initialized project), and nothing below this
  // branch may run — the whole point is that the config surface is never touched. Same
  // `ensureBranchModel` the full init uses: one judgment source, no second predicate (ADR-004).
  if (opts.branchModelOnly === true) {
    const branchModel = ensureBranchModel(root, {
      adopt: opts.adoptBranchModel === true,
      dryRun: opts.dryRun === true,
    });
    return {
      outcome: "branch-model-only",
      configState: classifyConfig(configPath).state,
      configPath,
      tasksDir,
      content: "",
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel,
      branchModelReport: formatBranchModelReport(branchModel),
    };
  }

  // ── What does the target already have? (three-state — AC1; not `fs.existsSync`) ────────────────
  const existing = classifyConfig(configPath);
  const reconcileMode = opts.reconcile === true && !opts.force;

  // EXISTING + UNPARSEABLE, and the caller asked for neither an overwrite nor a reconcile: stop, and
  // say WHY. This branch is the whole reason the classification is three-valued — the pre-fix code
  // answered `existsSync` here and printed "already exists, use --force", which is a true statement
  // about a DIFFERENT problem (a name conflict) and sent the operator looking for a conflict that
  // does not exist (硬规则 3b).
  if (existing.state === "corrupt" && !reconcileMode && !opts.force && !opts.dryRun) {
    return {
      outcome: "corrupt",
      configState: "corrupt",
      corruptReason: existing.reason,
      configPath,
      tasksDir,
      content: "",
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel: { ok: true, skipped: true, defaultBranch: null, entries: [], remedy: null },
      branchModelReport: "",
    };
  }

  // EXISTING + USABLE, no overwrite, no reconcile: refuse, exactly as before (AC3).
  if (existing.state === "valid" && !reconcileMode && !opts.force && !opts.dryRun) {
    const result: InitResult = {
      outcome: "skipped",
      configState: "valid",
      configPath,
      tasksDir,
      content: "",
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel: { ok: true, skipped: true, defaultBranch: null, entries: [], remedy: null },
      branchModelReport: "",
    };
    return result;
  }

  // ── The reconcile diff (SPEC §3.2; AC2) ────────────────────────────────────────────────────────
  // Reached only for a VALID config under `--reconcile`. The content is edited in place, so the
  // report below describes exactly the keys added/migrated and nothing else. A no-op reconcile writes
  // NOTHING: re-running `/quay:init` on a current project must leave the config byte-identical.
  if (existing.state === "valid" && reconcileMode) {
    const { content, report } = reconcileConfigContent(existing.raw ?? "");
    if (!opts.dryRun && !report.unchanged) {
      fs.writeFileSync(configPath, content, "utf8");
    }
    return {
      outcome: report.unchanged ? "unchanged" : "reconciled",
      configState: "valid",
      configPath,
      tasksDir,
      content,
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      reconcile: report,
      branchModel: { ok: true, skipped: true, defaultBranch: null, entries: [], remedy: null },
      branchModelReport: "",
    };
  }

  // EXISTING + UNPARSEABLE, with an explicit overwrite/reconcile decision: salvage by rebuild. The
  // unreadable bytes are preserved beside the new file rather than discarded — "the parser could not
  // read it" is not evidence that the content is worthless (the SPEC's §3.3 asks for exactly this
  // salvage step; the backup is what makes it non-destructive).
  let corruptBackupPath: string | undefined;
  if (existing.state === "corrupt" && !opts.dryRun) {
    corruptBackupPath = `${configPath}.corrupt-${Date.now()}`;
    fs.copyFileSync(configPath, corruptBackupPath);
    // fall through to the fresh-write path below
  }

  // ── Branch model (gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing) ──────
  // Run BEFORE writing anything: if the project's `develop` is a foreign line, init must stop with
  // the tree untouched (a half-initialized project is worse than an uninitialized one). The
  // landing baseline the fan-in / anti-drift path reads (`develop`) is ESTABLISHED here — that is
  // what turns the shipped `?? "develop"` default from an assumption into a fact.
  const branchModel = ensureBranchModel(root, {
    adopt: opts.adoptBranchModel === true,
    dryRun: opts.dryRun === true,
  });
  const branchModelReport = formatBranchModelReport(branchModel);
  if (!branchModel.ok && !opts.dryRun) {
    return {
      outcome: "branch-model-blocked",
      configState: existing.state,
      configPath,
      tasksDir,
      content: "",
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel,
      branchModelReport,
    };
  }

  // Detect project type.
  const { isNode, isGo } = detectProjectType(root);

  // Resolve provider.
  const providerId = opts.provider ?? detectProvider();

  // Compute relative provider path from workspace root to quay-native package.
  const providerPath = resolveProviderPath(root);

  // Generate config content.
  const content = generateConfigContent({ providerId, providerPath, isNode, isGo });

  if (opts.dryRun) {
    return { outcome: "dry-run", configState: existing.state, configPath, tasksDir, content, launchSettingsPath, launchSettingsContent, profilesPath, profilesContent, branchModel, branchModelReport };
  }

  // Write config.
  fs.mkdirSync(quayDir, { recursive: true });
  fs.writeFileSync(configPath, content, "utf8");

  // Create tasks dir if it doesn't exist.
  if (!fs.existsSync(tasksDir)) {
    fs.mkdirSync(tasksDir, { recursive: true });
  }

  // Lay down .claude/launch.settings.json (with bypassPermissions) so a cold-start
  // inner does not hit a permission prompt on its own loop scripts. Create-if-absent
  // on a fresh init; --force overwrites a stale copy. Never silently overwrite a
  // user's launch settings on a plain re-init (that path returns "skipped" anyway).
  if (opts.force || !fs.existsSync(launchSettingsPath)) {
    fs.mkdirSync(path.dirname(launchSettingsPath), { recursive: true });
    fs.writeFileSync(launchSettingsPath, launchSettingsContent, "utf8");
  }

  // Lay down .quay/profiles.yml (the profile carrier, AC154) so quay-launch.sh can
  // resolve launcher/model/--bare/-n/unset + flag-only params. Same create-if-absent /
  // --force semantics as launch.settings.json.
  if (opts.force || !fs.existsSync(profilesPath)) {
    fs.mkdirSync(path.dirname(profilesPath), { recursive: true });
    fs.writeFileSync(profilesPath, profilesContent, "utf8");
  }

  return {
    outcome: "written",
    configState: existing.state,
    ...(corruptBackupPath ? { corruptReason: `unparseable config preserved at ${corruptBackupPath}` } : {}),
    configPath,
    tasksDir,
    content,
    launchSettingsPath,
    launchSettingsContent,
    profilesPath,
    profilesContent,
    branchModel,
    branchModelReport,
  };
}

/**
 * Resolve a relative path from workspace root to quay-native package root.
 * Uses a heuristic: if quay-native is findable relative to the current
 * module's location (inside packages/quay), compute the relative path;
 * otherwise default to "./node_modules/quay-native".
 */
function resolveProviderPath(workspaceRoot: string): string {
  // Try to locate quay-native relative to this module's location.
  try {
    const moduleDir = import.meta.url
      ? path.dirname(new URL(import.meta.url).pathname)
      : path.dirname(process.argv[1] ?? ".");

    // Walk up from moduleDir to find quay-native package root.
    let candidate = path.resolve(moduleDir, "..", "..", "quay-native");
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      const rel = path.relative(workspaceRoot, candidate);
      if (rel && !rel.startsWith("..")) {
        return rel.startsWith(".") ? rel : "./" + rel;
      }
      return rel;
    }
    // Also try cwd-based resolution for when running from within the quay repo.
    candidate = path.resolve(process.cwd(), "packages", "quay-native");
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      const rel = path.relative(workspaceRoot, candidate);
      if (rel && !rel.startsWith("..")) {
        return rel.startsWith(".") ? rel : "./" + rel;
      }
      return rel;
    }
  } catch {
    // Fall through to default.
  }

  // Default: assume quay-native is installed as a dependency.
  return "./node_modules/quay-native";
}

/**
 * Print next-step instructions after a successful init.
 */
export function printNextSteps(providerId: string, tasksDir: string): void {
  console.log(`
Next steps:
  1. Create your first task:
       quay task create TASK-001 --title "My first task"

  2. List all tasks:
       quay task list

  3. Start the MCP server (for AI agent integration):
       quay mcp

  4. Run the gate engine on a task:
       quay gate TASK-001

  Workspace ready at: ${path.dirname(path.dirname(tasksDir))}
  Provider: ${providerId}
  Tasks dir: ${tasksDir}
`);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// The SHELL ENTRY's steps (gap-arch-quay-init-sh-python-heredocs-to-native)
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// `plugin/scripts/quay-init.sh` used to carry TWELVE `python3` invocations — eight `<<'PYEOF'`
// heredocs plus four `python3 -c` one-liners. They are now the functions below, driven by
// `plugin/scripts/quay-init-steps.ts` (the shell entry's step CLI, which acquires this module
// layout-independently via `core-src-import.ts` and is bundled self-contained into
// `plugin/scripts/dist/quay-init-steps.js` for shipped layouts). The shell keeps the ORCHESTRATION —
// "把「程序」收进 TS，把「胶水」留在 bash" (SPEC-architecture-consolidation §2 P4) — and the logic lives
// here, in Core, so there is ONE implementation of each step.
//
// WHY NOT `runInit` ABOVE. `runInit` is the provider-map SCAFFOLDER: fresh install, `--reconcile`,
// branch model. The functions below are the shell entry's INCREMENTAL-UPGRADE steps — they edit an
// EXISTING consumer's `.quay/config.yml` in place (loop values, carrier-dir pins, the retired
// runtime binding) and read small fields back out of it for shell variables. They are deliberately
// NOT folded into `runInit`: the shell entry's ORDERING, its report LINES and its dry-run semantics
// are its own contract, pinned by `plugin/test/quay-init*.test.mjs`.
//
// BYTE-EQUIVALENCE IS THE ACCEPTANCE BAR (the shell entry's `AC3`): each function is a line-for-line
// port, and the two YAML WRITERS must reproduce
// `yaml.safe_dump(d, allow_unicode=True, sort_keys=False, default_flow_style=False)` byte-for-byte —
// the pre-port behaviour on an upgrade path that actually fires. `pyYamlDump` does that: the `yaml`
// package with `PYYAML_DUMP_OPTS`, plus `foldPlainScalars` (PyYAML folds a plain scalar at a single
// space whose column exceeds `best_width`(80); the `yaml` package's own wrapping breaks at different
// points, so it is turned off with `lineWidth: 0` and the fold re-applied here).
//
// ⛔ DO NOT "SIMPLIFY" THE TWO WRITERS INTO LINE-LEVEL EDITS. The round-trip IS the old behaviour —
// it rewrites the whole document and DROPS COMMENTS. That is unlovely, but it is what shipped, and
// the port's contract is equivalence, not improvement: a line-level edit would preserve comments and
// therefore differ byte-for-byte from the pre-port output on exactly the input classes the
// characterization pins.

/** PyYAML's `best_width` (Emitter: 80 unless a larger `width` is passed, which none of the ported
 *  call sites do). A plain scalar is folded at the first single space whose column exceeds it. */
const PYYAML_BEST_WIDTH = 80;

/**
 * `yaml.safe_dump(d, allow_unicode=True, sort_keys=False, default_flow_style=False)` emulation.
 *
 * - `sort_keys=False` — preserve insertion order (the `yaml` package always preserves it).
 * - `default_flow_style=False` — block style; `YAML.stringify` emits block for plain JS objects.
 * - `allow_unicode=True` — raw UTF-8, no `\uXXXX` escaping (`YAML.stringify` does not escape by
 *   default).
 * - `indent: 2` matches PyYAML's `best_indent`; `indentSeq: false` matches PyYAML's habit of
 *   putting a block sequence's `-` at the PARENT key's indent.
 * - `lineWidth: 0` disables the `yaml` package's own folding so `foldPlainScalars` owns it.
 */
const PYYAML_DUMP_OPTS = {
  indent: 2,
  indentSeq: false,
  lineWidth: 0,
  defaultStringType: "PLAIN",
  defaultKeyType: "PLAIN",
  nullStr: "null",
} as const;

/** A rendered line's plain scalar, split into the part that is NOT folded and the part that is. */
const PLAIN_LINE_RE = /^(\s*(?:- )?)(.*)$/;

/**
 * Re-apply PyYAML's plain-scalar folding to a document already rendered with `lineWidth: 0`.
 *
 * PyYAML's `write_plain` breaks at a SPACE when (a) the run is exactly ONE space, (b) the column
 * BEFORE that space is strictly greater than `best_width`, (c) the space is neither the scalar's
 * first nor its last character. The continuation is indented to `lineIndent + best_indent` — read
 * off the emitter empirically (a value at indent 0 continues at 2, at indent 2 at 4, a sequence
 * item `- x` at indent 2 continues at 4), which is `lineIndent + 2` in every block context this
 * document shape reaches.
 *
 * Only PLAIN scalars are folded; a quoted scalar, a block scalar (`|`/`>`), an anchor/alias/tag or a
 * flow collection is emitted verbatim — PyYAML does not fold through those either, and rewriting
 * them here would corrupt them. The `yaml` package quotes any scalar containing `": "`, so a line
 * with more than one `": "` is quoted and therefore skipped by the same guard.
 */
export function foldPlainScalars(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const m = PLAIN_LINE_RE.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const [, indentPart, rest] = m;
    let prefix: string;
    let value: string;
    if (indentPart.endsWith("- ")) {
      prefix = indentPart;
      value = rest;
    } else {
      const sep = rest.indexOf(": ");
      if (sep < 0 || rest.startsWith("- ")) {
        out.push(line);
        continue;
      }
      prefix = indentPart + rest.slice(0, sep + 2);
      value = rest.slice(sep + 2);
    }
    // Verbatim forms — never folded.
    if (value === "" || /^["'|>&*!%@`[\]{},#]/.test(value)) {
      out.push(line);
      continue;
    }
    const lineIndent = indentPart.length - indentPart.trimStart().length;
    const cont = " ".repeat(lineIndent + 2);
    let rendered = prefix;
    let col = prefix.length;
    let i = 0;
    const n = value.length;
    while (i < n) {
      if (value[i] === " ") {
        let j = i;
        while (j < n && value[j] === " ") j++;
        const runLen = j - i;
        const isLast = j === n;
        if (runLen === 1 && col > PYYAML_BEST_WIDTH && i !== 0 && !isLast) {
          rendered += "\n" + cont;
          col = cont.length;
        } else {
          rendered += value.slice(i, j);
          col += runLen;
        }
        i = j;
      } else {
        let j = i;
        while (j < n && value[j] !== " ") j++;
        rendered += value.slice(i, j);
        col += j - i;
        i = j;
      }
    }
    out.push(rendered);
  }
  return out.join("\n");
}

/** The ONE serializer for `.quay/config.yml` in this module — PyYAML-byte-compatible. */
export function pyYamlDump(doc: unknown): string {
  return foldPlainScalars(YAML.stringify(doc, PYYAML_DUMP_OPTS));
}

/** Python `str(value)` / the `or ""` falsy-collapse the ported readers rely on. */
function pythonTruthyString(v: unknown): string {
  if (v === undefined || v === null || v === "" || v === 0 || v === false) return "";
  if (v === true) return "True";
  return typeof v === "string" ? v : String(v);
}

/**
 * `read_existing_loop_value <key>` — ONE key out of an existing config's `loop:` section (the
 * config-preserving upgrade's source of truth: an explicit CLI flag wins, else the value the
 * consumer already chose, else the fresh-install default). Empty when the config is absent, the
 * `loop:` section is missing, the key is unset, or the file cannot be read as YAML — the SAME
 * four-way silent-empty contract the Python had (`except Exception: pass` + `or ""`).
 */
export function readExistingLoopValue(cfgPath: string, key: string): string {
  try {
    if (!fs.existsSync(cfgPath)) return "";
    const doc = (YAML.parse(fs.readFileSync(cfgPath, "utf8")) ?? {}) as Record<string, unknown>;
    const loop = doc["loop"];
    if (typeof loop !== "object" || loop === null || Array.isArray(loop)) return "";
    return pythonTruthyString((loop as Record<string, unknown>)[key]);
  } catch {
    return "";
  }
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
 * `detect_test_command`'s package.json rung: does `scripts.test` exist as a NON-BLANK string?
 * Returns a boolean rather than printing, because the caller's ladder picks the command string.
 */
export function hasNpmTestScript(pkgPath: string): boolean {
  try {
    const doc = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    const scripts = doc["scripts"];
    if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) return false;
    const t = (scripts as Record<string, unknown>)["test"];
    return typeof t === "string" && t.trim() !== "";
  } catch {
    return false;
  }
}

export interface EnsureLoopConfigOpts {
  cfgPath: string;
  repoRoot: string;
  testCommand: string;
  tmuxSession: string;
  worktreeRoot: string;
  dryRun: boolean;
}

/**
 * `ensure_loop_config` — add/update the four fast-mode target-project values in an EXISTING config's
 * `loop:` section. MERGED, never replaced: every other `loop:` key (the loop-driver schema's
 * `board`/`gates`/`stop`/`policy`, fast mode's `concurrency_bands`/`fork_baseline`/`routines`, and the
 * version-level `doc_surfaces`) survives. NO GRATUITOUS REWRITE: a re-dump is not free (it reformats
 * the whole document), so the write happens ONLY when a VALUE actually changed — equal ⇒ no write at
 * all.
 *
 * ⛔ A VERSION-LEVEL default must NOT be routed through this function (gap-fan-in-delta-classify-
 * declared-doc-surfaces): its writer is `pyYamlDump`, which re-serialises the whole document and DROPS
 * every comment — the exact cost the "no gratuitous rewrite" rule exists to avoid. `doc_surfaces` is
 * therefore delivered by the comment-preserving per-key reconcile (`LOOP_VERSION_DEFAULTS` +
 * `reconcileConfigContent` below), not here. This step stays the four project-DERIVED values.
 *
 * An empty tmux session is written as an explicit YAML null, not `""`: the session is optional
 * since SPEC-tmux-retirement-2026-09-03 and null is the honest "not set".
 *
 * ⚠️ The step runs only on an EXISTING config; a config-less target gets its `loop:` section from
 * `write_config`'s own heredoc in the shell entry.
 */
export function ensureLoopConfig(o: EnsureLoopConfigOpts): void {
  if (!fs.existsSync(o.cfgPath)) return;
  const data = (YAML.parse(fs.readFileSync(o.cfgPath, "utf8")) ?? {}) as Record<string, unknown>;
  const before = pyYamlDump(data);
  let loop = data["loop"];
  if (typeof loop !== "object" || loop === null || Array.isArray(loop)) loop = {};
  const l = loop as Record<string, unknown>;
  l["repo_root"] = o.repoRoot;
  l["test_command"] = o.testCommand;
  l["tmux_session"] = o.tmuxSession ? o.tmuxSession : null;
  l["worktree_root"] = o.worktreeRoot;
  data["loop"] = l;
  const after = pyYamlDump(data);
  if (after === before) {
    console.log("  unchanged: .quay/config.yml loop: (values already current — no gratuitous rewrite, AC3)");
    return;
  }
  if (o.dryRun) {
    console.log("  would-write: .quay/config.yml loop: (repo_root/test_command/tmux_session/worktree_root updated, doc_surfaces filled when absent; 其余 loop 键保留 — config 保留 增量升级)");
    return;
  }
  fs.writeFileSync(o.cfgPath, after, "utf8");
  console.log("  wrote: .quay/config.yml loop: (repo_root/test_command/tmux_session/worktree_root updated, doc_surfaces filled when absent; 其余 loop 键保留 — config 保留 增量升级)");
}

export interface EnsureCarrierEnvOpts {
  cfgPath: string;
  wsRoot: string;
  dryRun: boolean;
}

/** The carrier-directory pins `ensure_provider_carrier_env` backfills, with the directory each names. */
const CARRIER_KINDS: ReadonlyArray<readonly [string, string]> = [
  ["QUAY_NATIVE_ADR_DIR", "adr"],
  ["QUAY_NATIVE_GOAL_DIR", "goals"],
  ["QUAY_NATIVE_META_DIR", "meta"],
];

/**
 * `ensure_provider_carrier_env` — pin the provider's carrier directories in an EXISTING config's
 * `providers.native.env` map. The root cause (carrier-dirs derived from the resolved tasks dir) is
 * already fixed; this pin is the second, independent half — it makes the isolation VISIBLE AND
 * AUDITABLE in the config the user owns instead of leaving it implicit.
 *
 * IDEMPOTENT + MINIMAL is the whole design: a LINE-LEVEL insert, never a YAML round-trip (a
 * `safe_dump` would reformat every other key of a file that needed no change and lose its
 * comments). Only the MISSING keys are appended to the env block, adjacent to the existing ones; a
 * key already present is NEVER overwritten (the user's own value wins), and a config whose env
 * block already carries all three is left byte-for-byte untouched — no write, hence no diff.
 *
 * The inserted values MIRROR the form of the existing tasks-dir pin (`./tasks` → `./adr`, an
 * absolute `/ws/tasks` → `/ws/adr`), so the env block does not mix absolute and relative forms.
 */
export function ensureProviderCarrierEnv(o: EnsureCarrierEnvOpts): void {
  if (!fs.existsSync(o.cfgPath)) return;
  const lines = fs.readFileSync(o.cfgPath, "utf8").split("\n");

  const indentOf = (s: string): number => s.length - s.trimStart().length;

  /** First index >= start+1 that is non-blank with indent <= parentInd, else lines.length. */
  const blockEnd = (start: number, parentInd: number): number => {
    let j = start + 1;
    while (j < lines.length) {
      if (lines[j]!.trim() && indentOf(lines[j]!) <= parentInd) return j;
      j++;
    }
    return lines.length;
  };
  /** [index, indent] of the first `key:` line in [start, end) at indent >= minIndent. */
  const findChild = (start: number, end: number, key: string, minIndent: number): [number, number] | null => {
    const pat = new RegExp("^(\\s*)" + escapeRegExp(key) + "\\s*:");
    for (let i = start; i < end; i++) {
      const m = pat.exec(lines[i]!);
      if (m && m[1]!.length >= minIndent) return [i, m[1]!.length];
    }
    return null;
  };

  // ── locate providers: → native: → env: by INDENTATION, not by a yaml round-trip ─────────────────
  const prov = findChild(0, lines.length, "providers", 0);
  if (!prov) {
    console.log("  note: .quay/config.yml has no providers: section — carrier env pins not applicable (nothing written)");
    return;
  }
  const native = findChild(prov[0] + 1, blockEnd(prov[0], prov[1]), "native", prov[1] + 1);
  if (!native) {
    console.log("  note: providers: has no native: entry — carrier env pins not applicable (nothing written)");
    return;
  }
  const nativeEnd = blockEnd(native[0], native[1]);
  const env = findChild(native[0] + 1, nativeEnd, "env", native[1] + 1);

  // ── collect the keys the env block already carries ──────────────────────────────────────────────
  const present: Record<string, string> = {};
  if (env) {
    const rest = lines[env[0]]!.slice(lines[env[0]]!.indexOf(":") + 1).trim();
    if (rest && !rest.startsWith("{")) {
      console.error(
        "  note: providers.native.env has an unrecognized inline form — carrier env pins NOT applied " +
          "(add QUAY_NATIVE_ADR_DIR/QUAY_NATIVE_GOAL_DIR/QUAY_NATIVE_META_DIR by hand)",
      );
      return;
    }
    if (rest.startsWith("{")) {
      for (const m of rest.matchAll(/(QUAY_NATIVE_\w+)\s*:/g)) present[m[1]!] = "";
    } else {
      const keyRe = /^(\s*)(QUAY_NATIVE_\w+)\s*:\s*(.*)$/;
      for (let i = env[0] + 1; i < blockEnd(env[0], env[1]); i++) {
        const m = keyRe.exec(lines[i]!);
        if (m && m[1]!.length > env[1]) present[m[2]!] = m[3]!.trim();
      }
    }
  }

  const missing = CARRIER_KINDS.filter(([k]) => !(k in present));
  if (missing.length === 0) {
    console.log("  unchanged: .quay/config.yml providers.native.env: (four carrier dirs already pinned — no rewrite, AC4)");
    return;
  }

  const rawTasks = (present["QUAY_NATIVE_TASKS_DIR"] ?? "./tasks").trim().replace(/^["']|["']$/g, "");
  const absolute = rawTasks.startsWith("/") || rawTasks.startsWith("~");
  const valueFor = (kind: string): string => (absolute ? `${o.wsRoot}/${kind}` : `./${kind}`);

  if (o.dryRun) {
    for (const [k, kind] of missing) {
      console.log(`  would-pin: providers.native.env.${k}: "${valueFor(kind)}" (carrier dir pin — AC4)`);
    }
    return;
  }

  // ── append the missing keys to the END of the env block (or create the block, if absent) ────────
  const newLines = [...lines];
  let insertAt: number;
  let baseInd: number;
  let added: string[];
  if (!env) {
    insertAt = nativeEnd;
    baseInd = native[1] + 2;
    added = [" ".repeat(baseInd) + "env:", ...missing.map(([k, kind]) => `${" ".repeat(baseInd + 2)}${k}: "${valueFor(kind)}"`)];
  } else {
    let last = env[0];
    for (let i = env[0] + 1; i < blockEnd(env[0], env[1]); i++) {
      if (lines[i]!.trim()) last = i;
    }
    insertAt = last + 1;
    baseInd = env[1] + 2;
    added = missing.map(([k, kind]) => `${" ".repeat(baseInd)}${k}: "${valueFor(kind)}"`);
  }
  newLines.splice(insertAt, 0, ...added);
  fs.writeFileSync(o.cfgPath, newLines.join("\n"), "utf8");
  for (const [k, kind] of missing) {
    console.log(`  pinned: .quay/config.yml providers.native.env.${k}: "${valueFor(kind)}" (carrier dir pin — AC4)`);
  }
}

// ── project-internal plugin link (gap-config-provider-path-frozen-to-versioned-cache-dir; the
//    SELECTION RULE rewritten by gap-project-quay-pointer-is-init-plugin-root-and-version-records-
//    derive-from-it) ────────────────────────────────────────────────────────────────────────────────
//
// DEFECT (first half). `/quay:init` wrote the provider binding as `<installPath>/vendor/quay-native`,
// where `installPath` is the plugin MARKETPLACE cache dir — a path that CONTAINS the installed version
// (`~/.claude/plugins/cache/quay/quay/0.14.0/`). Upgrading the plugin left the config untouched, so
// Core kept launching the OLD provider bundle forever.
//
// DEFECT (second half, this task). The replacement — an INTERNAL link `<project>/.quay/plugin ->
// <that project's registry-resolved installPath>` — gave the link a SECOND resolver. The session layer
// decides which plugin version a session actually loads; the registry tier rule (`projectPath`-matching
// local/project entry wins, else the `user` entry) is a DIFFERENT rule, so the two necessarily diverge.
// Measured 2026-10-06: claudecodeui's project record stayed at 0.14.0 while the user entry moved to
// 0.15.0, and every session started after 07:14:55 loaded 0.15.0 — the link, if re-pointed from the
// registry, would have named a version no session was running.
//
// RULING (human, 2026-10-06): the link target is the plugin root THIS init run executes from
// (`${CLAUDE_PLUGIN_ROOT}` / `--plugin-root`) — ⛔ never a registry lookup. There is exactly ONE
// binding producer (this link), one guidance consumer (a Core-absent consumer such as a CloudCLI
// server `execFile`, cwd = the project root), and the drift between them is REPORTED by `driver
// status`'s `pointer` reading — never auto-corrected (several plugin versions can be live in one
// project at once, so a runtime refresh would clobber whichever wrote last).
//
// ⛔ Core NEVER writes this link from any runtime path (driver start / serve / MCP). Only `/quay:init`
// writes it.
//
// NOT-EVALUATED (and the existing link is LEFT UNCHANGED — 硬规则 3b: "cannot decide" must not share
// an outcome with "decided") when the plugin root is unknown or is a SOURCE CHECKOUT (the dev tree
// `<repo>/plugin` is a working tree, not an install — pointing a project at it would freeze that
// project to uncommitted state).

export type ProjectPluginLinkReading =
  | { state: "linked"; pluginRoot: string; version: string | null }
  | { state: "not-evaluated"; reason: string };

/** Version of a plugin ROOT (its `.claude-plugin/plugin.json` `version`). null = unreadable.
 *  ⛔ NEVER `quay --version` output — the shipped bundle embeds the dev version, so that reading is a
 *  different quantity (gap-release-bundle-embeds-dev-version-after-stamp). */
export function readPluginRootVersion(pluginRoot: string | null): string | null {
  if (!pluginRoot) return null;
  try {
    const v = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"))?.version;
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}

export interface ProjectPluginLinkOpts {
  wsRoot: string;
  /** The plugin root THIS init run executes from (`CLAUDE_PLUGIN_ROOT` / `--plugin-root`). */
  pluginRoot: string | null;
  dryRun: boolean;
}

/**
 * Refresh `<ws>/.quay/plugin` so it points at the plugin root THIS init run executes from. Idempotent:
 * an already-correct link is re-created (cheap) but the RESULT is stable; an unknown / source-checkout
 * plugin root leaves the existing link UNTOUCHED and reports `NOT-EVALUATED` (never folded into
 * "linked").
 *
 * A real (non-symlink) file/dir at the link path is REFUSED, never clobbered — the closed set does not
 * own arbitrary user content at that name.
 */
export function refreshProjectPluginLink(o: ProjectPluginLinkOpts): ProjectPluginLinkReading {
  const linkPath = path.join(o.wsRoot, ".quay", "plugin");

  let existing: fs.Stats | null = null;
  try {
    existing = fs.lstatSync(linkPath);
  } catch {
    existing = null;
  }
  const currentTarget = existing?.isSymbolicLink()
    ? (() => { try { return fs.readlinkSync(linkPath); } catch { return null; } })()
    : null;

  const decide = (): ProjectPluginLinkReading => {
    if (!o.pluginRoot) {
      return { state: "not-evaluated", reason: "plugin root unknown (CLAUDE_PLUGIN_ROOT / --plugin-root unset)" };
    }
    const root = path.resolve(o.pluginRoot);
    if (!fs.existsSync(path.join(root, ".claude-plugin", "plugin.json"))) {
      return { state: "not-evaluated", reason: `${root} is not a quay plugin root (no .claude-plugin/plugin.json)` };
    }
    if (isPluginSourceCheckout(root)) {
      return { state: "not-evaluated", reason: `${root} is a source checkout (dev tree), not an installed plugin` };
    }
    return { state: "linked", pluginRoot: root, version: readPluginRootVersion(root) };
  };
  const reading = decide();

  if (reading.state === "not-evaluated") {
    console.log(`  project-plugin-link: NOT-EVALUATED — ${reading.reason} (existing link left unchanged)`);
    return reading;
  }

  if (existing && !existing.isSymbolicLink()) {
    console.log(`  project-plugin-link: REFUSED — ${linkPath} exists and is not a symlink (left unchanged)`);
    return { state: "not-evaluated", reason: `${linkPath} exists and is not a symlink` };
  }

  if (o.dryRun) {
    console.log(
      currentTarget === reading.pluginRoot
        ? `  would-keep: .quay/plugin -> ${reading.pluginRoot} (v${reading.version ?? "?"}; already current)`
        : `  would-link: .quay/plugin -> ${reading.pluginRoot} (v${reading.version ?? "?"})`,
    );
    return reading;
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  if (existing) {
    try { fs.rmSync(linkPath, { force: true }); } catch { /* recreate below */ }
  }
  fs.symlinkSync(reading.pluginRoot, linkPath);
  console.log(`  linked: .quay/plugin -> ${reading.pluginRoot} (v${reading.version ?? "?"} — the plugin root this init ran from)`);
  return reading;
}

export interface MigrateMcpEntryOpts {
  cfgPath: string;
  installProvider: string;
  installRuntime: string;
  installCore: string;
  wsRoot: string;
  dryRun: boolean;
  backupTs: string;
}

/**
 * `migrate_stale_mcp_entry` — the UPGRADE-CHANNEL migration for the RETIRED project-local runtime.
 *
 * Ruling (AC1 of gap-dist-runtime-not-self-contained-reads-external-package-json; UPDATED by
 * gap-config-provider-path-frozen-to-versioned-cache-dir): the provider binding is migrated to the
 * project-internal STABLE link `<ws>/.quay/plugin/vendor/quay-native` (an absolute path whose TEXT
 * carries no version segment) — a rebuild to `$PLUGIN_ROOT` would re-freeze it to the running
 * version. A versioned install-cache path (which still EXISTS on disk) is now ALSO a migration
 * trigger. The now-unreferenced project-local copy is retired to a backup ONLY when it is
 * unreferenced, recognizably quay's own install-generated runtime, and STALE; a byte-current copy
 * is left byte-identical (AC3), and a directory we cannot recognize is NEVER touched (硬规则 3b:
 * "could not evaluate" must not share an output with "evaluated, fine").
 *
 * SCOPE GUARD: an arbitrary dangling path (e.g. `./nonexistent/runtime.js`) is left untouched so the
 * vendor-runtime negative control keeps its meaning.
 */
export function migrateStaleMcpEntry(o: MigrateMcpEntryOpts): void {
  if (!fs.existsSync(o.cfgPath)) return;
  const data = (YAML.parse(fs.readFileSync(o.cfgPath, "utf8")) ?? {}) as Record<string, unknown>;
  const providers = data["providers"];
  const prov = (typeof providers === "object" && providers !== null ? (providers as Record<string, unknown>)["native"] : undefined) as
    | Record<string, unknown>
    | undefined;
  if (typeof prov !== "object" || prov === null || Array.isArray(prov)) return;

  const sha = (p: string): string | null => {
    try {
      return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    } catch {
      return null;
    }
  };
  const under = (p: string, base: string): boolean => {
    const abs = path.resolve(p);
    return abs === base || abs.startsWith(base + path.sep);
  };

  const rtDir = path.join(o.wsRoot, ".quay", "runtime");
  const inRetiredRuntime = (p: unknown): boolean => {
    const s = String(p);
    const cands = path.isAbsolute(s) ? [s] : [s, path.join(o.wsRoot, s)];
    return cands.some((c) => under(c, rtDir));
  };

  // The single source of truth for the fate of <ws>/.quay/runtime, computed ONCE from the ORIGINAL
  // bytes (before any move), so "the runtime dir is stale" has one definition.
  //   absent | retire (stale) | keep (byte-identical) | unknown (not quay's shape / unreadable)
  const retiredRtState = (): "absent" | "retire" | "keep" | "unknown" => {
    let st: fs.Stats;
    try {
      st = fs.statSync(rtDir);
    } catch {
      return "absent";
    }
    if (!st.isDirectory()) return "absent";
    const known = [
      [path.join(rtDir, "bin", "quay-native.js"), o.installRuntime],
      [path.join(rtDir, "bin", "quay.js"), o.installCore],
    ].filter(([t]) => fs.existsSync(t!));
    if (known.length === 0 || known.some(([, s]) => sha(s!) === null)) return "unknown";
    return known.some(([t, s]) => sha(t!) !== sha(s!)) ? "retire" : "keep";
  };
  const rtState = retiredRtState();

  let changed = false;
  const removed: string[] = [];

  // (gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it): the provider
  // binding no longer names a provider DIRECTORY at all — Core resolves the native provider from its
  // own plugin root (`plugin-root.ts`; the default is `<plugin-root>/vendor/quay-native`). So the two
  // keys that used to carry a path are DELETED here, LINE-WISE. ⛔ Never a YAML re-serialization: that
  // drops every comment, and `.quay/` is gitignored so the original bytes are unrecoverable.
  //
  // The `.quay/runtime` judgment below is unchanged and reads the ORIGINAL binding (whether it
  // referenced the retired dir) — ⛔ not the text this step deletes.
  const stripped = stripNativeProviderBindingLines(fs.readFileSync(o.cfgPath, "utf8"));
  if (stripped.removed.length > 0) {
    changed = true;
    for (const r of stripped.removed) removed.push(`providers.native.${r}`);
  }

  // Whether ANYTHING in the (post-deletion) config still points at the retired runtime. Read from the
  // STRIPPED text, ⛔ not from the parsed `prov`: the native binding this step just deleted is exactly
  // the reference that used to keep the runtime alive, so consulting the pre-deletion parse would
  // keep a now-orphaned copy forever.
  const referencedByBinding = (): boolean =>
    stripped.text.includes(rtDir) || /(^|[\s"'])\.quay\/runtime/.test(stripped.text);

  const backupDir = path.join(o.wsRoot, ".quay", "quay-init-backups", o.backupTs);
  if (rtState === "retire" && !referencedByBinding()) {
    let dest = path.join(backupDir, "runtime");
    if (o.dryRun) {
      console.log(`  would-retire-orphan-runtime: ${rtDir} -> ${dest} (retired layout, unreferenced, stale vs this delivery — AC1)`);
    } else {
      fs.mkdirSync(backupDir, { recursive: true });
      let n = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(backupDir, `runtime-${n}`);
        n++;
      }
      fs.renameSync(rtDir, dest);
      console.log(`  retired-orphan-runtime: ${rtDir} -> backup ${dest} (retired layout, unreferenced, stale vs this delivery — AC1)`);
    }
  } else if (rtState === "retire") {
    console.log(`  kept-referenced-runtime: ${rtDir} (still referenced by the provider binding — NOT retired)`);
  } else if (rtState === "keep") {
    console.log(`  kept-runtime-copy: ${rtDir} (byte-identical to this delivery — untouched, AC3)`);
  } else if (rtState === "unknown") {
    console.log(`  kept-unrecognized-runtime-dir: ${rtDir} (not quay's install-generated runtime shape — never touched)`);
  }

  if (!changed) return;
  const note = "the native provider is resolved from the plugin root, so the config carries no path";
  if (o.dryRun) {
    for (const m of removed) console.log(`  would-remove: ${m} (${note})`);
    return;
  }
  fs.writeFileSync(o.cfgPath, stripped.text, "utf8");
  for (const m of removed) console.log(`  removed: ${m} (${note})`);
}

/**
 * Delete `providers.native.path` and `providers.native.mcp_entry` from a config's TEXT, line-wise,
 * leaving every other line (comments included) byte-for-byte. Returns the new text and the list of
 * `<key> <value>` descriptions of what went.
 *
 * A key with an INLINE value is one line; the block-sequence form (`mcp_entry:` then `- node` …) is
 * the key line plus its contiguous list items. Both forms are deleted. The scan is scoped to the
 * `providers:` → `native:` block by indentation, so a `path:` under another provider is untouched.
 */
function stripNativeProviderBindingLines(text: string): { text: string; removed: string[] } {
  const lines = text.split("\n");
  const out: string[] = [];
  const removed: string[] = [];
  let inProviders = false;
  let nativeIndent: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "") { out.push(line); continue; }
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      inProviders = /^providers:\s*(#.*)?$/.test(line);
      nativeIndent = null;
      out.push(line);
      continue;
    }
    if (!inProviders) { out.push(line); continue; }
    if (nativeIndent === null) {
      if (/^native:\s*(#.*)?$/.test(trimmed)) nativeIndent = indent;
      out.push(line);
      continue;
    }
    if (indent <= nativeIndent) { nativeIndent = null; out.push(line); continue; }
    const m = /^(path|mcp_entry):\s*(.*)$/.exec(trimmed);
    if (!m) { out.push(line); continue; }
    const inline = m[2]!.replace(/\s+#.*$/, "").trim();
    if (inline === "") {
      // Block-sequence form: consume the key line plus its contiguous `- …` items.
      let j = i + 1;
      const items: string[] = [];
      while (j < lines.length) {
        const l = lines[j]!;
        const lt = l.trim();
        if (lt === "" || lt.startsWith("#")) break;
        const li = l.length - l.trimStart().length;
        if (li < indent || !lt.startsWith("- ")) break;
        items.push(lt.replace(/^- /, ""));
        j++;
      }
      removed.push(`${m[1]}: [${items.join(", ")}]`);
      i = j - 1;
      continue;
    }
    removed.push(`${m[1]}: ${inline}`);
    // (the inline line itself is dropped)
  }
  return { text: out.join("\n"), removed };
}

/**
 * `_derive_loop_scripts_once`'s dependency-closure pass (step (d)): repeat to a fixpoint — for every
 * script name in the round-start snapshot, read its `${SCRIPT_DIR}/<rel>` references and append the
 * ones that are non-empty, not in the NEVER_LAYDOWN set, and exist under `<pluginRoot>/scripts/`.
 * Then rewrite the file with the sorted unique names.
 *
 * The closure regex keeps the PACKAGED two-segment form `${SCRIPT_DIR}/dist/X.js`: `package.sh`
 * rewrites `.ts` refs to `dist/X.js`, and a single-segment `[a-zA-Z0-9._-]*` used to truncate that
 * to `dist`, so the bundle never entered the laydown set. The prefix is STRIPPED (not the basename),
 * so `dist/X.js` stays scripts/-relative.
 *
 * ONE pass replaces the retired per-script `grep`/`sed`/`sort` triple + per-dep `grep -qxF`; those
 * per-script subprocess spawns were the dominant wall-clock cost of the derivation.
 */
export function deriveLoopScriptsClosure(o: { outPath: string; pluginRoot: string; neverLaydown: string }): void {
  const never = new Set(o.neverLaydown.split(/\s+/).filter(Boolean));
  const REF_RE = /(?:\$\{SCRIPT_DIR\}\/|\$SCRIPT_DIR\/)([a-zA-Z0-9][a-zA-Z0-9._/-]*)/g;
  const read = (p: string): string => {
    try {
      return fs.readFileSync(p).toString("utf8");
    } catch {
      return "";
    }
  };
  const names: string[] = [];
  for (const ln of fs.readFileSync(o.outPath, "utf8").split("\n")) {
    const t = ln.replace(/\n$/, "");
    if (t) names.push(t);
  }
  const seen = new Set(names);
  let changed = true;
  let rnd = 0;
  while (changed && rnd < 20) {
    changed = false;
    rnd += 1;
    for (const s of [...names]) {
      const script = path.join(o.pluginRoot, "scripts", s);
      if (!fs.existsSync(script) || !fs.statSync(script).isFile()) continue;
      for (const m of read(script).matchAll(REF_RE)) {
        const dep = m[1]!;
        if (!dep) continue;
        if (never.has(dep)) continue;
        const depPath = path.join(o.pluginRoot, "scripts", dep);
        if (!fs.existsSync(depPath) || !fs.statSync(depPath).isFile()) continue;
        if (!seen.has(dep)) {
          names.push(dep);
          seen.add(dep);
          changed = true;
        }
      }
    }
  }
  const outText = [...new Set(names)].sort().map((x) => x + "\n").join("");
  fs.writeFileSync(o.outPath, outText, "utf8");
}

/**
 * `verify_provider_runtime_existence`'s reader: the runtime file the native provider's launch argv
 * names — `mcp_entry[1]` (the canonical `["node", <runtime>, …]` slot), resolved through the SAME
 * judge the runtime uses (`resolveProviderEntry`) so an OMITTED binding is no longer "nothing to
 * verify": native omits path/mcp_entry by design, and the file to verify is then
 * `<plugin-root>/vendor/quay-native/dist/quay-native.js`.
 *
 * Three-state return (硬规则 3b — "could not evaluate" must not print as "evaluated, fine"):
 *   `<path>`             the runtime file to check for existence/freshness.
 *   `NOT-EVALUATED:<why>` no native provider entry, or the native binding was omitted AND no plugin
 *                        root could be resolved. The caller reports this as its own state.
 *
 * `pluginRoot` is the caller's already-resolved plugin root (the shell passes `$PLUGIN_ROOT`);
 * omitted/undefined ⇒ the real `resolvePluginRoot()`.
 */
export function providerEntryFile(cfgPath: string, pluginRoot?: string | null): string {
  try {
    const doc = (YAML.parse(fs.readFileSync(cfgPath, "utf8")) ?? {}) as Record<string, unknown>;
    const providers = doc["providers"];
    const prov = (typeof providers === "object" && providers !== null ? (providers as Record<string, unknown>)["native"] : undefined) as
      | Record<string, unknown>
      | undefined;
    if (typeof prov !== "object" || prov === null || Array.isArray(prov)) {
      return "NOT-EVALUATED:no providers.native entry in the config";
    }
    const resolved = resolveProviderEntry("native", prov, pluginRoot);
    const mcp = resolved.mcpEntry;
    if (Array.isArray(mcp) && mcp.length >= 2) return String(mcp[1]);
    return `NOT-EVALUATED:${NATIVE_PROVIDER_UNRESOLVABLE} (native omits path/mcp_entry and no plugin root could be resolved)`;
  } catch (e: unknown) {
    return `NOT-EVALUATED:unreadable config (${e instanceof Error ? e.message : String(e)})`;
  }
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
