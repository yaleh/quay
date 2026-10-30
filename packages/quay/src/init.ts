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
import { execFileSync, spawnSync } from "node:child_process";
import YAML from "yaml";
import {
  ensureBranchModel,
  formatBranchModelReport,
  ensureDocBranch,
  formatDocBranchReport,
  moveCheckoutOntoLandingBaseline,
  landingBaselineEstablishedNow,
  formatBaselineCheckoutReport,
  checkDocBranchInvariant,
  type BranchModelReport,
  type DocBranchInvariantReport,
  type DocBranchReport,
} from "./core/branch-model.ts";
// The ONE regex-literal escaper (kernel leaf). This file used to inline the escape body at the
// `key`-literal site — one of the spelling variants invisible to the previous sweep's byte needle
// (finding `escaperegexp-sweep-missed-two`, routine `semantic-dedup-scan`; see
// packages/quay/test/kernel-regex-escape.test.mjs ④).
import { escapeRegExp } from "./kernel/regex-escape.ts";
// The ONE binding judge (gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver):
// `verify_provider_runtime_existence`'s reader resolves the native provider's runtime file through
// the SAME function the runtime and the validator use, so an omitted binding is verified (from the
// plugin root) instead of silently skipped.
import { resolveProviderEntry, NATIVE_PROVIDER_UNRESOLVABLE } from "./config.ts";
// The ONE config judge (gap-init-single-engine-state-based-upgrade-validate-before-write AC3): the
// upgrade engine validates its candidate TEXT through the SAME `runChecks` pipeline
// `quay config validate` and MCP `config_validate` use — never a second copy of the checks.
import { validateConfigText, type ConfigIssue } from "./config-validate.ts";
// The project-scope version cross-check (gap-init-plugin-version-crosscheck-project-scope-shadow):
// what version THIS project will actually load (the session layer's projectPath tier rule) vs the
// version running init. The reading lives in loaded-version.ts — the ONE module that reads the install
// record — ⛔ not re-parsed here (硬规则 5b).
import {
  projectScopedVersionReading,
  userScopedInstallReading,
  type ProjectScopedVersionReading,
  type UserScopedInstallReading,
} from "./loaded-version.ts";
// The fresh-install provider EXTENSION POINT (gap-init-ts-4214-line-slice-with-extension-point-
// first): every provider-specific line of the `providers:` section is rendered by a descriptor
// registered in init-provider-registry.ts. ⛔ This file must never name a concrete provider here —
// adding one means registering a descriptor over there, with no edit to the centre.
import {
  PROVIDER_ENTRIES_HELP,
  renderProviderSection,
  type ProviderInitRegistry,
} from "./init-provider-registry.ts";

// Kept as a RE-EXPORT because it was this module's public surface before the slice (its unit tests
// and any external caller import it from here) — the implementation lives in the registry module.
export { mcpEntryForProvider } from "./init-provider-registry.ts";

// ── PHASE MODULES — the god-module split (gap-routine-architecture-analysis-core-src-flat-root-god-modules)
// This file was 4,157 lines / 79 exports with no phase boundary. Three phases now live in `init/`,
// VERBATIM; this file keeps the orchestration (runInit / runInitImpl) and the shared config text
// engine, and re-exports every moved symbol so the 74 existing `from "./init.ts"` import sites (and
// the package's published surface) resolve unchanged.
//
// ⛔ Dependency direction is one-way: init.ts → delivery-surface → provider-maintenance → carrier-env.
// ⛔ A phase module must never import `../init.ts` — that would close a directory cycle.
import { ensureProviderCarrierEnvText } from "./init/carrier-env.ts";
import {
  migrateStaleMcpEntry,
  readPluginRootVersion,
  retireProjectPluginLink,
  type ProjectPluginLinkReading,
} from "./init/provider-maintenance.ts";
import {
  autoCommitClosedSet,
  closedSetBanner,
  closedSetReport,
  ensureGitignore,
  printInstallSteps,
  readPluginName,
  readPluginVersion,
  snapshotClosedSet,
  writeClaudeSettings,
  type AutoCommitReading,
  type ClosedSetStateEntry,
} from "./init/delivery-surface.ts";

// ── Barrel: the public surface the moved phases used to declare here ──────────────────────────────
export {
  ensureProviderCarrierEnv,
  ensureProviderCarrierEnvText,
  type CarrierEnvTextResult,
  type EnsureCarrierEnvOpts,
  type EnsureCarrierEnvTextOpts,
} from "./init/carrier-env.ts";
export {
  DEFAULT_NEVER_LAYDOWN,
  deriveLoopScripts,
  deriveLoopScriptsClosure,
  migrateStaleMcpEntry,
  providerEntryFile,
  readPluginRootVersion,
  retireProjectPluginLink,
  switchEnabledProviderText,
  type MigrateMcpEntryOpts,
  type ProjectPluginLinkOpts,
  type ProjectPluginLinkReading,
  type SwitchEnabledProviderResult,
  type SwitchProviderNote,
} from "./init/provider-maintenance.ts";
export {
  CLOSED_SET_ITEMS,
  autoCommitClosedSet,
  closedSetBanner,
  closedSetFingerprint,
  closedSetReport,
  deliverySurfaceL1Report,
  ensureGitignore,
  printInstallSteps,
  providerRuntimeExistenceReport,
  readJsonField,
  readPluginName,
  readPluginVersion,
  snapshotClosedSet,
  writeClaudeSettings,
  type AutoCommitReading,
  type ClosedSetStateEntry,
  type InstallStepsOptions,
} from "./init/delivery-surface.ts";

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
  /**
   * The provider the loop driver scans (`readLoopParams().board` → the MCP `task_list`/`task_write`
   * `provider` argument in `plugin/skills/loop-driver/SKILL.md`). A REQUIRED key of the `loop:`
   * schema (`loop-params.ts` FAIL-CLOSES without it, and `config-validate.ts` rejects a config that
   * omits it) — so a fresh install that does not write it produces a config that fails
   * `quay config validate` and a loop-driver that refuses to run.
   *
   * A VERSION-LEVEL constant because a fresh workspace enables exactly ONE provider and it is the
   * reference one: `detectProvider()` is native-only and no CLI/MCP surface exposes a provider
   * choice at init time. A config that enables a DIFFERENT provider gets `board` bound to that
   * provider by `generateConfigContent` (which overrides this default with its own `providerId`),
   * never by a constant written over a disagreement.
   *
   * ⛔ Mirror: `plugin/scripts/quay-init.sh`'s fresh-install heredoc writes the same value from its
   * own literal (shell cannot import this table); `plugin/test/quay-init.test.mjs` pins the two to
   * each other, so a change here that is not mirrored there is RED.
   */
  board: "native",
  /**
   * The gate(s) the loop driver runs on each task (`readLoopParams().gates` → the `gate_run`
   * `gate` argument in `plugin/skills/loop-driver/SKILL.md`). REQUIRED for the same reason as
   * `board` above.
   *
   * `acceptance` is a BUILT-IN gate (`gate/registry.ts`), so it resolves on a workspace whose own
   * `gates:` section is still the commented-out scaffold — which is exactly the fresh-install state.
   * That matters twice over: `config-validate.ts` check 6 rejects an unresolved name, and an empty
   * list would leave the driver with no gate to run (`params.gates[0]` undefined). A project with a
   * real gate registry overrides this in its own config; the key is only a default, never a policy.
   *
   * ⛔ Mirror: same heredoc pin as `board` above.
   */
  gates: ["acceptance"],
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

// ── There is NO `serve:` version-default table (GOAL-029 / AC-330, 人 2026-10-07) ──────────────────
//
// The `serve:` section used to have its own seed table (`SERVE_VERSION_DEFAULTS`), written by the
// fresh-install template and filled by the reconcile. It was removed because EVERY entry equalled the
// resolver's own fallback, i.e. the table could only ever deliver a value that says nothing: a
// workspace without a `serve:` section and a workspace carrying `serve.host: 0.0.0.0` behave
// IDENTICALLY (`resolveServeBinding` falls back to the very same constant). Writing it was pure
// noise — and worse, it made a fresh install and an upgrade disagree about whether the section
// exists at all.
//
// The ONE definition of what an absent `serve:` means stays where it always was: `SERVE_BINDING_FALLBACK`
// in `serve-binding.ts`. A user who pins their own `host:`/`port:` keeps it — the upgrade never
// rewrites a key it does not own, and `serve:` is now entirely the user's to write.

export interface ReconcileReport {
  /** `loop:` keys that were absent from the config and were filled from LOOP_VERSION_DEFAULTS. */
  added: string[];
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
  const migrated: string[] = [];

  for (const [key, value] of Object.entries(LOOP_VERSION_DEFAULTS)) {
    if (doc.hasIn(["loop", key])) continue;
    doc.setIn(["loop", key], value);
    added.push(key);
  }

  // ⛔ `serve:` is NOT filled here (AC-330). There is no version-level serve default any more — every
  // candidate value equalled the resolver's fallback, so filling it delivered nothing and made the
  // section's presence depend on WHICH entry point wrote the config. An absent section is the
  // identical reading (`SERVE_BINDING_FALLBACK`), and a user's own `host:`/`port:` is untouched
  // because nothing below ever writes under `serve:`.

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
  const unchanged = added.length === 0 && migrated.length === 0;
  return { content: unchanged ? raw : doc.toString(), report: { added, migrated, unchanged } };
}

// ── The retired-key registry — the ONE place a config key is declared dead ─────────────────────────
//
// GOAL-029 (人 2026-10-07): the upgrade must delete keys THIS version has retired, and the list of
// dead keys must be a REGISTRY rather than a scattering of ad-hoc deletions — adding an entry here
// is the whole change for a future retirement.
//
// ⛔ APPEND-ONLY (只增不减): removing an entry would make an old config's dead key invisible to a
// later upgrade — the key would silently survive, exactly the failure this table exists to prevent.
// A key that is retired and later REINSTATED gets a new entry (or none), never a deletion here.
//
// The `path` is a dotted Document-API path (the same shape `doc.deleteIn` takes); `why` is the
// reason, kept next to the key so the registry is self-explanatory in review.
export interface RetiredConfigKey {
  path: readonly string[];
  /** Human-readable dotted path, as it appears in a config file and in the report. */
  label: string;
  why: string;
}
export const RETIRED_CONFIG_KEYS: readonly RetiredConfigKey[] = [
  {
    path: ["providers", "native", "path"],
    label: "providers.native.path",
    why:
      "The native provider is resolved from the plugin root (plugin-root.ts); a config-declared path " +
      "freezes the runtime to the install-cache version that wrote it, so a plugin upgrade never takes " +
      "effect (gap-config-provider-path-frozen-to-versioned-cache-dir).",
  },
  {
    path: ["providers", "native", "mcp_entry"],
    label: "providers.native.mcp_entry",
    why:
      "Same as providers.native.path — Core derives the native launcher from the plugin root; a declared " +
      "mcp_entry pins the runtime to the version that wrote the config.",
  },
];

// ── The known-top-level-keys registry (for the unknown-key WARNING) ────────────────────────────────
//
// GOAL-029: an unrecognized key is PRESERVED (never silently dropped) but the operator is WARNED.
// This list is what "recognized" means for TOP-LEVEL keys of `.quay/config.yml`. It is deliberately
// permissive: a false warning is noise, while a false silence hides a typo'd section. Nested
// sections are NOT enumerated here — `gates:`/`loop:` already have their own validators, and a
// provider map is open by design.
export const KNOWN_TOP_LEVEL_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "providers",
  "gates",
  "loop",
  "serve",
  "suite",
  "goals",
]);

export interface UpgradeOptions {
  workspaceRoot: string;
  /** The plugin root this run executes from — threaded to the validator's native-binding resolution. */
  pluginRoot?: string | null;
  /** `--drop-incompatible`: delete the user values the candidate validator rejects, instead of failing. */
  dropIncompatible?: boolean;
  /**
   * The four PROJECT-DERIVED `loop:` values to merge into an existing config — COMMENT-PRESERVING
   * and PER-KEY, through the same Document API the rest of the upgrade uses (the shipped shell
   * entry's `ensure_loop_config` re-serializes the whole document and drops comments; the CLI must
   * not). A key whose document value already equals the resolved value is left byte-untouched, so a
   * current config stays a no-op. Absent ⇒ no project-value merge (the shape the pure-engine
   * callers and their unit tests use).
   */
  projectValues?: ProjectLoopValues;
}

export interface UpgradeReport {
  /** `loop:` keys absent from the config and filled from LOOP_VERSION_DEFAULTS. */
  added: string[];
  /** `key: old -> new` rewrites from LOOP_VALUE_MIGRATIONS. */
  migrated: string[];
  /** Retired keys deleted per RETIRED_CONFIG_KEYS. */
  removed: string[];
  /** `providers.native.env.*` carrier-dir pins backfilled. */
  pinned: string[];
  /** Unrecognized top-level keys — PRESERVED, and reported so the operator can look. */
  unknownKeys: string[];
  /** Keys deleted by `--drop-incompatible` after the candidate failed validation. */
  dropped: string[];
  /** The four PROJECT-DERIVED `loop:` keys updated to this run's resolved values. */
  projectValues: string[];
  /** True when nothing at all needed doing ⇒ the caller must not rewrite the file. */
  untouched: boolean;
}

export interface UpgradeResult {
  /** False when the candidate does not validate (and `--drop-incompatible` did not fix it). */
  ok: boolean;
  /** The candidate config text. Written only when `ok` and not `report.untouched`. */
  content: string;
  report: UpgradeReport;
  /** The validator's verdict on the candidate — the errors that made `ok` false, when it is. */
  issues: ConfigIssue[];
}

/** Parse a validator `field` path (`loop.gates`, `gates.testPass[0].command`) into a Document path. */
function fieldToPath(field: string): Array<string | number> | null {
  const segments: Array<string | number> = [];
  for (const part of field.split(".")) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) return null;
    if (m[1]) segments.push(m[1]);
    for (const idx of m[2]!.matchAll(/\[(\d+)\]/g)) segments.push(Number(idx[1]));
  }
  return segments.length > 0 ? segments : null;
}

/**
 * The path to DELETE for an incompatibility at `field`: the deepest container, so deleting an
 * element of a bad array removes the element rather than one field of it (`gates.testPass[0].command`
 * ⇒ `gates.testPass[0]`, `loop.gates` ⇒ `loop.gates`).
 */
function deletionPath(field: string): Array<string | number> | null {
  const path = fieldToPath(field);
  if (!path) return null;
  const idx = path.findIndex((s) => typeof s === "number");
  return idx >= 0 ? path.slice(0, idx + 1) : path;
}

/** Serialize a Document only when a change actually happened — a no-op pass must not reformat. */
function documentToString(doc: YAML.Document.Parsed, raw: string, changed: boolean): string {
  return changed ? doc.toString() : raw;
}

/**
 * The single upgrade engine (GOAL-029): take an EXISTING, parseable `.quay/config.yml`'s bytes and
 * compute the CURRENT version's config — in memory, comment-preserving, without writing.
 *
 * The pipeline, in order:
 *   1. delete retired keys (RETIRED_CONFIG_KEYS) through the Document API;
 *   2. fill absent `loop:` version-level defaults (LOOP_VERSION_DEFAULTS);
 *   3. apply LOOP_VALUE_MIGRATIONS;
 *   4. backfill the provider carrier-dir env pins;
 *   5. VALIDATE THE CANDIDATE TEXT (validateConfigText — the same judge `quay config validate` runs).
 *      If it fails and `--drop-incompatible` was given, delete the offending values, re-fill required
 *      defaults, and re-validate; otherwise the caller must NOT write.
 *
 * `serve:` is NOT touched at all (GOAL-029 的「serve 默认值（等于回退值）不写进配置」): there is no
 * version-level serve default left to deliver, and a user-pinned `host:`/`port:` is preserved for the
 * trivial reason that this pipeline never writes under that key.
 *
 * The caller distinguishes "unchanged" via `report.untouched`; writing then would be the gratuitous
 * rewrite the reconcile discipline forbids.
 */
export function upgradeConfigContent(raw: string, opts: UpgradeOptions): UpgradeResult {
  const report: UpgradeReport = {
    added: [], migrated: [], removed: [], pinned: [], unknownKeys: [], dropped: [], projectValues: [], untouched: false,
  };

  const doc = YAML.parseDocument(raw);
  if (doc.errors.length > 0) {
    // classifyConfig already answered "corrupt" for a file with parse errors; reaching here means the
    // bytes changed underneath the caller. Report honestly rather than pretending to upgrade.
    return {
      ok: false,
      content: raw,
      report,
      issues: [{ severity: "error", field: "config.yml", message: `YAML parse failed: ${doc.errors[0]!.message}` }],
    };
  }

  let changed = false;

  // 1. Retired keys — registry-driven, Document-API deletion (comments around them survive).
  for (const retired of RETIRED_CONFIG_KEYS) {
    if (!doc.hasIn(retired.path as string[])) continue;
    doc.deleteIn(retired.path as string[]);
    report.removed.push(retired.label);
    changed = true;
  }

  // 2. Version-level `loop:` defaults — an absent key is filled; a present one is the user's.
  for (const [key, value] of Object.entries(LOOP_VERSION_DEFAULTS)) {
    if (doc.hasIn(["loop", key])) continue;
    doc.setIn(["loop", key], value);
    report.added.push(key);
    changed = true;
  }

  // 3. `serve:` — deliberately NOTHING. See the header: there is no version-level serve default any
  //    more, a user's own value is already present, and an absent section is the same reading as the
  //    resolver's fallback (so writing one would say nothing and would make fresh vs. upgraded
  //    configs disagree about the section's existence).

  // 4. Declared value migrations.
  for (const [key, rule] of Object.entries(LOOP_VALUE_MIGRATIONS)) {
    const current = doc.getIn(["loop", key]);
    if (typeof current !== "string" || !rule.from.includes(current)) continue;
    doc.setIn(["loop", key], rule.to);
    report.migrated.push(`${key}: ${current} -> ${String(rule.to)}`);
    changed = true;
  }

  // 4b. The PROJECT-DERIVED `loop:` values (AC-331). Merged PER KEY through the Document API — the
  //     same comment-preserving discipline as everything above — and only when the resolved value
  //     actually differs, so a current config is still byte-identical (no gratuitous rewrite). This is
  //     the CLI's equivalent of the shell entry's `ensure_loop_config` step, minus its whole-document
  //     re-serialization (which drops the user's comments).
  if (opts.projectValues) {
    const pv = opts.projectValues;
    const merged: Array<[string, unknown]> = [
      ["repo_root", pv.repoRoot],
      ["test_command", pv.testCommand],
      ["tmux_session", pv.tmuxSession],
      ["worktree_root", pv.worktreeRoot],
    ];
    for (const [key, value] of merged) {
      const current = doc.getIn(["loop", key]);
      // `null` and "absent" are the SAME reading for `tmux_session` (an undetected session must not
      // write `tmux_session: null` over an absent key and turn a no-op into a write).
      if (current === value || (current === undefined && value === null)) continue;
      doc.setIn(["loop", key], value);
      report.projectValues.push(key);
      changed = true;
    }
  }

  // 5. Unknown top-level keys — PRESERVED (nothing is deleted), reported for the operator.
  const contents = doc.contents;
  if (YAML.isMap(contents)) {
    for (const item of contents.items) {
      const keyNode = item.key as unknown;
      const key = typeof keyNode === "object" && keyNode !== null && "value" in (keyNode as object)
        ? String((keyNode as { value: unknown }).value)
        : String(keyNode);
      if (!KNOWN_TOP_LEVEL_CONFIG_KEYS.has(key)) report.unknownKeys.push(key);
    }
  }

  let content = documentToString(doc, raw, changed);

  // 6. Carrier-dir env pins — a LINE-LEVEL insert, so it must run on the serialized TEXT (it is the
  //     same single implementation the shell step uses).
  const carrier = ensureProviderCarrierEnvText(content, { wsRoot: opts.workspaceRoot });
  if (carrier.pinned.length > 0) {
    report.pinned = carrier.pinned.map((p) => p.key);
    content = carrier.text;
  }

  report.untouched =
    report.removed.length === 0 &&
    report.added.length === 0 &&
    report.migrated.length === 0 &&
    report.pinned.length === 0 &&
    report.projectValues.length === 0;

  // 7. Judge the candidate BEFORE anyone writes it.
  let verdictResult = validateConfigText({ text: content, workspaceRoot: opts.workspaceRoot, pluginRoot: opts.pluginRoot });

  // 7b. `--drop-incompatible`: remove the user values the judge rejects, then judge again.
  if (!verdictResult.ok && opts.dropIncompatible === true) {
    const seen = new Set<string>();
    for (const issue of verdictResult.issues) {
      if (issue.severity !== "error") continue;
      const path = deletionPath(issue.field);
      if (!path || seen.has(path.join("."))) continue;
      seen.add(path.join("."));
      if (!doc.hasIn(path as string[])) continue;
      doc.deleteIn(path as string[]);
      report.dropped.push(issue.field);
      changed = true;
    }
    if (report.dropped.length > 0) {
      // The deletion may have removed a REQUIRED key (loop.gates) — re-fill the version defaults.
      for (const [key, value] of Object.entries(LOOP_VERSION_DEFAULTS)) {
        if (doc.hasIn(["loop", key])) continue;
        doc.setIn(["loop", key], value);
        report.added.push(key);
      }
      content = doc.toString();
      const carrier2 = ensureProviderCarrierEnvText(content, { wsRoot: opts.workspaceRoot });
      if (carrier2.pinned.length > 0) {
        report.pinned = carrier2.pinned.map((p) => p.key);
        content = carrier2.text;
      }
      report.untouched =
        report.removed.length === 0 && report.added.length === 0 &&
        report.migrated.length === 0 && report.pinned.length === 0 && report.dropped.length === 0 &&
        report.projectValues.length === 0;
      verdictResult = validateConfigText({ text: content, workspaceRoot: opts.workspaceRoot, pluginRoot: opts.pluginRoot });
    }
  }

  return { ok: verdictResult.ok, content, report, issues: verdictResult.issues };
}

/**
 * The path an unreadable config's bytes are preserved at: `<configPath>.corrupt-<stamp>`, with a `-N`
 * suffix when that exact name is already taken. Two rebuilds in the same second must not overwrite
 * the earlier backup — overwriting it would destroy the only copy of the user's original file, which
 * is the whole reason the backup exists (硬规则 3b: the salvage step must not become the loss).
 *
 * Extracted so the no-overwrite property is directly testable with a FIXED stamp: an integration test
 * cannot reliably make two runs land in the same instant, so the collision arm would otherwise be
 * unreachable by construction.
 */
export function corruptBackupPathFor(configPath: string, stamp: number): string {
  const base = `${configPath}.corrupt-${stamp}`;
  if (!fs.existsSync(base)) return base;
  let n = 1;
  while (fs.existsSync(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Write `content` to `filePath` atomically: a sibling temp file then a rename, so a reader never
 *  observes a half-written config (GOAL-029: 通过才原子写). */
function writeFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Result of an init operation.
 */
export interface InitResult {
  /**
   * "written" | "dry-run" | "skipped" (legacy; no longer produced — an existing valid config is
   * UPGRADED, see "reconciled"; "corrupt" is likewise no longer produced — an unparseable config is
   * REBUILT, see "rebuilt") |
   * "rebuilt" (existing + unparseable: the bytes were preserved as `config.yml.corrupt-<ts>` and
   *            the config was rebuilt from this version's defaults; exit 0) |
   * "rebuild-invalid" (the REBUILT candidate itself fails validation ⇒ nothing was written and the
   *                    corrupt original + its backup are kept; see `rebuildIssues`) |
   * "reconciled" (existing + valid, and the config had to change) |
   * "unchanged" (existing + valid, and the config was already current) |
   * "upgrade-invalid" (existing + valid, but the upgraded CANDIDATE fails validation ⇒ nothing was
   *                    written; see `upgradeIssues`) |
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
  /**
   * Why the config could not be read — present whenever `configState === "corrupt"`. The parser's own
   * reason, surfaced verbatim: the operator must be told what actually happened, not "already exists".
   */
  corruptReason?: string;
  /**
   * Where the unreadable bytes were preserved — `<configPath>.corrupt-<ts>`, byte-identical to the
   * file that could not be parsed. Populated when a rebuild happened (`outcome === "rebuilt"`), and
   * under `--dry-run` it names the path a real run WOULD back up to. Absent when the config was not
   * corrupt. `unparseable` is not `worthless` — the rebuild over a corrupt config never discards it.
   */
  corruptBackupPath?: string;
  /**
   * The validator's verdict on the REBUILT candidate — populated only when `outcome ===
   * "rebuild-invalid"`: the rebuilt-from-defaults config did not validate, so nothing was written
   * and the corrupt original (and its backup) were left in place.
   */
  rebuildIssues?: ConfigIssue[];
  /** What the reconcile changed — present only when `outcome === "reconciled" | "unchanged"`. */
  reconcile?: ReconcileReport;
  /**
   * The full upgrade report for an existing valid config (GOAL-029 single engine): what was filled,
   * migrated, deleted, pinned, which unknown keys were kept, and which values `--drop-incompatible`
   * removed. Present for `"reconciled" | "unchanged" | "upgrade-invalid"`.
   */
  upgrade?: UpgradeReport;
  /**
   * The validator's verdict on the upgraded candidate — populated (with the errors) only when
   * `outcome === "upgrade-invalid"`, i.e. the candidate was NOT written because it did not validate.
   */
  upgradeIssues?: ConfigIssue[];
  /** Absolute path to the config file that was (or would be) written. */
  configPath: string;
  /**
   * The RESOLVED workspace root (`path.resolve(opts.root)`) — the directory the whole init ran
   * against, and the value `printNextSteps` prints as "Workspace ready at:".
   *
   * ⛔ Carried rather than re-derived by the caller. The root is `<root>/tasks`'s GRANDPARENT only
   * while the tasks dir keeps the default name `tasks`; a summary that recomputes it from
   * `tasksDir` (the pre-fix `dirname(dirname(tasksDir))`) prints the PARENT of the workspace for a
   * `--root <subdir>` run, contradicting the `Tasks dir:` line printed right below it
   * (gap-init-summary-workspace-ready-prints-parent-dir).
   */
  workspaceRoot: string;
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
  /**
   * The doc-branch bootstrap's verdict for THIS run (`ensureDocBranch`), populated on every outcome
   * that got past the branch model — see `InitOptions.docBranchName`. Absent when the run stopped
   * before the bootstrap.
   */
  docBranch?: DocBranchReport;
  /** `formatDocBranchReport(docBranch)` — the operator-facing rendering of the verdict above. */
  docBranchReport?: string;
  /**
   * The STANDING doc-branch invariant, judged AFTER this run against the on-disk state
   * (`checkDocBranchInvariant`). Four states — `satisfied` / `violated` / `pending` /
   * `not-evaluated` — never a boolean, so "the invariant could not be judged" never reads as
   * "the invariant holds" (hard rule 3b).
   *
   * ⛔ This is a READING, not a step: it creates no branch and moves no HEAD. It is what carries the
   * `pending` state out of a run whose non-interactive auto-commit DECLINED on a 0-commit repository
   * (gap-quay-init-declined-auto-commit-leaves-doc-branch-unenforced) — the state in which a later
   * EXTERNAL first commit would otherwise break the invariant with nobody looking.
   */
  docBranchInvariant: DocBranchInvariantReport;
  /**
   * The baseline→checkout handoff's report, present only when THIS run established `develop` at the
   * very commit the checkout was on and therefore moved the checkout onto it.
   */
  baselineCheckoutReport?: string;
  /**
   * The POST-WRITE branch-model re-judgment's own failure channel — set ONLY on the unborn-repository
   * path (the auto-commit created the first commit, so the model was judged a second time AFTER the
   * write). Carries the reason verbatim, for the same purpose as `failureReason` on the pre-write
   * arms.
   *
   * ⛔ It cannot reuse `failureReason`: those arms promise "NOTHING WAS WRITTEN", and by the time this
   * one can fire the config IS on disk. A caller must be able to tell the two apart, or the CLI would
   * have to state a falsehood about the tree to report a true one about the verdict.
   * (gap-init-branch-model-runs-before-auto-commit-fresh-repo-needs-two-runs)
   */
  postWriteBranchModelFailure?: string;
  /**
   * The `.quay/plugin` RETIREMENT step's outcome for THIS run. Three required states, never folded
   * into a boolean (硬规则 3b): `retired` (a symlink was deleted), `absent` (there was nothing at the
   * path) and `refused` (something is there that the closed set does not own — a regular file or
   * directory — left byte-identical). Auxiliary states that must never be read as one of those:
   * `would-retire` (a `--dry-run` found a link and wrote nothing), `delete-failed` (the unlink
   * failed), `unreadable` (the path could not be inspected at all) and `not-run` (this outcome path
   * never reaches the step, so nobody looked).
   */
  pluginLink: PluginLinkOutcome;
  /**
   * The official validator's verdict (`validateConfigText` — the same judge `quay config validate`
   * runs) on the config text this run produced or would produce:
   *   true            — the candidate passed (upgrade engine, or a fresh install's generated text);
   *   false           — the candidate FAILED; the errors ride in `validationIssues`;
   *   "not-evaluated" — no candidate text existed (a corrupt refusal, a branch-model-only entry).
   * ⛔ A boolean alone would make "no candidate to judge" read exactly like "judged and passed".
   */
  validated: boolean | "not-evaluated";
  /** The validator's errors when `validated === false` — never silently dropped. */
  validationIssues?: ConfigIssue[];
  /**
   * On a run that FAILED (a pre-write fail-closed gate, or a mid-write abort): the state of every
   * closed-set item, measured against a snapshot taken BEFORE this run touched anything. This is what
   * keeps "initialized half-way" distinguishable from both "not initialized" and "already initialized
   * before this run" (硬规则 3b — the write-side mirror). Absent on a successful run.
   */
  closedSetState?: ClosedSetStateEntry[];
  /** On a fail-closed run: the REAL cause (a missing test command, a tmpfs worktree root, …). */
  failureReason?: string;
  /** The remedy lines that accompany `failureReason` — printed verbatim, never re-derived. */
  failureDetail?: string[];
  /** What the optional auto-commit step did (AC: `--auto-commit-config`). */
  autoCommit?: AutoCommitReading;
  /** The explicit install-steps text a fresh install prints (`printInstallSteps`). */
  installSteps?: string;
  /**
   * The project-scope plugin-version cross-check (gap-init-plugin-version-crosscheck-project-scope-shadow):
   * which version THIS project will actually load (the session layer's `projectPath` tier rule) vs the
   * version running init. Carried on EVERY outcome (the wrapper attaches it) so a caller can tell
   * `match` from `mismatch` from `not-evaluated` without parsing the warning sentence (硬规则 3b).
   */
  pluginVersionForProject?: ProjectScopedVersionReading;
}

/**
 * Outcome of the `.quay/plugin` RETIREMENT step (see `InitResult.pluginLink`) — the readings
 * `retireProjectPluginLink` can produce, plus `not-run` for the outcome paths that never reach the
 * step. ⛔ `not-run` is NOT `absent` — the first means nobody looked, the second means someone looked
 * and found nothing (硬规则 3b: those must never share a value).
 */
export type PluginLinkOutcome = ProjectPluginLinkReading | { state: "not-run"; reason: string };

/**
 * Options for the init command.
 */
export interface InitOptions {
  /** Project root path (default: CWD). */
  root: string;
  /**
   * ⛔ THERE IS NO `force` AND NO `reconcile` (GOAL-029 / AC-330, 人 2026-10-07). The STATE of the
   * target decides the path — absent ⇒ write, parseable ⇒ upgrade in place, unparseable ⇒ refuse (or
   * salvage when the caller explicitly asks) — so neither flag selects anything a caller could not
   * get by simply running init. Keeping either one would re-introduce a second mode whose semantics
   * drift from the state-based one, which is the defect this whole change removes.
   */
  /** Print to stdout instead of writing to disk. */
  dryRun: boolean;
  /**
   * `--drop-incompatible` (GOAL-029): when the upgraded candidate FAILS validation, delete the user
   * values the validator rejects and retry, instead of refusing. Without it, a user's own
   * incompatible value (e.g. a `loop.gates` naming an unregistered gate) fails the upgrade — the
   * value is not silently overwritten, and the report names the offending field.
   */
  dropIncompatible?: boolean;
  /**
   * The plugin root THIS run executes from (`CLAUDE_PLUGIN_ROOT` / `--plugin-root`). Threaded to the
   * candidate validator's native-binding resolution and to the version carriers. ⛔ It does NOT
   * decide anything about `<root>/.quay/plugin` any more: that path is RETIRED (human ruling
   * 2026-10-25) and the step only ever deletes a link there, which needs no target.
   */
  pluginRoot?: string | null;
  /**
   * The PROJECT's name, used for the `.quay/profiles.yml` role session prefixes
   * (`<project>-task-worker`, …). Defaults to the basename of `root`; `--project <name>` overrides it
   * when the caller knows the project's name better than its directory's. ⛔ Never an invented
   * literal, and never quay's own `quay-` names — a third-party project copying those would collide
   * with quay's sessions, and cross-session delivery addresses peers BY NAME.
   */
  project?: string;
  /**
   * Where `~/.claude/plugins/installed_plugins.json` is read from (default: `$HOME`, else the OS
   * home). Threaded so a test can point the install-record readers at a fixture home instead of
   * mutating the operator's real record (the install steps and the project-scope version
   * cross-check must both read the SAME home).
   */
  homeDir?: string;
  /**
   * Where human-facing progress lines go (default `console.log`). The CLI's `--json` mode passes a
   * stderr sink so stdout carries exactly ONE JSON document; everything else keeps the default.
   */
  log?: (line: string) => void;
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
   * The DOC-branch NAME for the full init's doc-branch bootstrap (`--doc-branch-name <name>`).
   *
   * The retired shell entry ran `quay init --branch-model-only --doc-branch-name <name>` before its
   * closed-set write, resolving the name in its own CLI-parameter layer: flag > the target's
   * `loop.doc_branch` > `author`. That entry is now a ≤40-line shim over this engine
   * (gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch), so the bootstrap moved
   * HERE — otherwise `/quay:init` would silently stop creating the doc branch, which is a behavior
   * change rather than a refactor.
   *
   * The precedence is unchanged and is resolved by the caller + this function together: an explicit
   * `docBranchName` wins, else the target config's `loop.doc_branch`, else the `author` convention
   * (supplied in an override-channel expression, never as a bare identity literal — see
   * `target-identity-literal-check.ts`).
   */
  docBranchName?: string;
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
  /**
   * The four PROJECT-DERIVED `loop:` values, explicit (the CLI's `--repo-root` / `--test-command` /
   * `--tmux-session` / `--worktree-root`). Each is OPTIONAL: absent ⇒ the target's existing config
   * value wins, else detection / the documented default. Ported from the shipped shell entry so the
   * CLI can complete a full fresh install alone (AC-331).
   */
  repoRoot?: string;
  testCommand?: string;
  tmuxSession?: string;
  worktreeRoot?: string;
  /**
   * `--auto-commit-config` / `--auto-commit-confirm` / `--auto-commit-skip`: what the post-write
   * auto-commit step should do with the closed-set paths.
   *   "yes"    — stage ONLY those paths and commit (`chore(quay-init): …`);
   *   "no"     — skip, leave the working tree as it is;
   *   "prompt" (default) — the shipped shell entry's interactive arm: an interactive stdin may answer,
   *                        a NON-interactive one DECLINES (never sweeps a user's uncommitted work).
   */
  autoCommitConfig?: "yes" | "no" | "prompt";
}

/**
 * `LOOP_VERSION_DEFAULTS` as the fresh-install template must emit it — the table verbatim, except
 * that `board` is bound to THIS config's provider.
 *
 * WHY `board` IS THE ONE OVERRIDE: every other entry is a version constant, but `board` must name a
 * provider the config's own `providers:` map declares — `readLoopParams()` hands it to the loop
 * driver as the MCP `provider` argument, so a value disagreeing with `providers:` would point the
 * driver at a provider that does not exist. `providerId` IS that name for this call (`detectProvider()`
 * is native-only, and no CLI/MCP surface exposes a provider choice at init). ⛔ It is an OVERRIDE,
 * never a second copy: the table's own `board` stays the value the reconcile fills into a config
 * written before the key existed, and the two agree for every reachable caller today.
 */
function loopDefaultsFor(providerId: string): Array<[string, unknown]> {
  return Object.entries(LOOP_VERSION_DEFAULTS).map(([k, v]) => [k, k === "board" ? providerId : v]);
}

/**
 * Generate the full .quay/config.yml content with all 3 sections and inline
 * documentation for every supported field.
 */
export function generateConfigContent(opts: {
  providerId: string;
  providerPath: string;
  isNode: boolean;
  isGo: boolean;
  /**
   * The four PROJECT-DERIVED `loop:` values (repo_root / test_command / tmux_session /
   * worktree_root). Omitted ⇒ only the version-level defaults are emitted (the shape an upgrade
   * candidate starts from); supplied ⇒ the fresh install writes them, which is what makes the CLI
   * able to lay the whole closed set alone (AC-331).
   */
  values?: ProjectLoopValues;
  /**
   * The workspace root — when supplied, the provider's `tasks_dir` and the four `QUAY_NATIVE_*_DIR`
   * carrier pins are emitted as ABSOLUTE paths inside it, exactly as the shipped shell writer does
   * (the isolation the pins exist for must be visible in the config the user owns, and an absolute
   * path cannot silently resolve against somewhere else). Omitted ⇒ the `./`-relative forms the
   * pure-unit callers use.
   */
  root?: string;
  /**
   * The provider-descriptor table the `providers:` section is rendered from. Defaults to the
   * process-wide registry (`PROVIDER_INIT_REGISTRY`) — the production path. A caller may inject a
   * different table; that is also the seam the injection-leak arm of the extension-point criterion
   * uses (replace the lookup table, the positive arm must go red).
   */
  registry?: ProviderInitRegistry;
}): string {
  const { providerId, providerPath, isNode, isGo } = opts;
  const values = opts.values;
  const abs = (rel: string): string => (opts.root ? path.join(opts.root, rel) : `./${rel}`);

  // Build gate suggestions based on project type.
  const gateSuggestions = buildGateSuggestions({ isNode, isGo });

  const lines: string[] = [
    "# .quay/config.yml — quay workspace configuration",
    "# Generated by `quay init`. See README.md or run `quay --help` for usage.",
    "",
    "# " + ruleLine(69),
    "# Section 1: Providers — where tasks live",
    "# " + ruleLine(69),
    ...PROVIDER_ENTRIES_HELP,
    "providers:",
    // ⛔ The provider entries are NOT spelled out here any more (gap-init-ts-4214-line-slice-with-
    // extension-point-first): each one is a `ProviderInitDescriptor` registered in
    // init-provider-registry.ts, rendered from the table below. Adding a provider = registering a
    // descriptor there; this call site does not change.
    ...renderProviderSection({ providerId, providerPath, abs, registry: opts.registry }),
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
    "#   routines:                 OPTIONAL — standing routine track (periodic probe routines):",
    "#     - name: <string>          routine name",
    "#       trigger: interval:<N>m  when to fire (two-layer time; `every(N)`/`on(<event>)` are legacy)",
    "#       dispatch: <prompt>      (legacy) prompt to dispatch",
    "#       probe: <name>           (DIR-056) probe-spec name under the plugin's probes/ dir",
    "#",
    "loop:",
    // ── The four PROJECT-DERIVED values, emitted FIRST so `loop.repo_root` is the section's first key
    //    (the shipped shell writer's shape, and what the fresh-install readers expect to find up top).
    //    ⛔ Only present when `values` was supplied: an upgrade candidate starts from version defaults
    //    alone, because the user's own project values are already in their config and must win.
    ...(values
      ? [
        `  repo_root: ${versionDefaultLine(values.repoRoot)}`,
        "  # quay's mechanical fan-in runs this project's test entrypoint with its own value-taking flags",
        "  # (--buckets / --root / --state-dir / --runner / --log-file / --run-id, plus --test-concurrency=N).",
        "  # If you ship scripts/test.sh, it MUST consume such a flag together with its VALUE (shift 2) and",
        "  # MUST NOT read a flag's value as a positional test-file argument — otherwise every fan-in round",
        "  # reds with \"Could not find '<value>'\" and burns a whole worker session. Full contract:",
        "  # plugin/skills/init/SKILL.md, section \"loop.test_command contract\".",
        `  test_command: ${versionDefaultLine(values.testCommand)}`,
        `  tmux_session: ${values.tmuxSession === null ? "null" : versionDefaultLine(values.tmuxSession)}`,
        `  worktree_root: ${versionDefaultLine(values.worktreeRoot)}`,
      ]
      : []),
    // EVERY default in this section — `board` and `gates` included — is EMITTED FROM THE SAME TABLE
    // the reconcile fills from (`LOOP_VERSION_DEFAULTS`) rather than re-typed here. Two hand-kept
    // copies of one list is the defect this whole change exists to remove: a fresh workspace must not
    // be born one reconcile behind, which is exactly what a template that forgets a key the reconcile
    // knows about produces. It is also what a template that writes a key the RECONCILE then
    // DUPLICATES produces — so neither key is spelled out literally below.
    // The version-level defaults, EMITTED FROM THE SAME TABLE the reconcile fills from
    // (`LOOP_VERSION_DEFAULTS`) rather than re-typed here. Two hand-kept copies of one list is the
    // defect this whole change exists to remove: a fresh workspace must not be born one reconcile
    // behind, which is exactly what a template that forgets a key the reconcile knows about produces.
    // `loopDefaultLine` (not `String(v)`) so a LIST value emits a real YAML flow sequence —
    // `String(["a"])` is `"a"`, which parses back as the scalar `a` and silently turns a list into a
    // string (the same class as the "a value that looks like a declaration but is not one" defect).
    ...loopDefaultsFor(providerId).map(([k, v]) => `  ${k}: ${versionDefaultLine(v)}`),
    "  # stop: \"once\"                # uncomment and set your preferred stop policy",
    "  # policy: \"ready-first\"        # uncomment to customize task selection",
    "  # execution: \"dispatched\"      # uncomment to use inline builds",
    "  # audit: \"adversarial\"         # uncomment to skip adversarial audit",
    "  # concurrency: 1               # uncomment for parallel builds (requires touches-disjoint)",
    // ── Standing routine track, WRITTEN (not commented): a fresh workspace must be born with at least
    //    one driver routine that actually schedules a probe. gap-architecture-analysis-probe-not-wired-
    //    into-driver-routine-or-init：the architecture-analysis probe is the only mechanism that really
    //    consults archguard, and before this it was scheduled by nothing a general workspace runs.
    //    The fallback is declared HERE because it is what makes an archguard-less host safe: the probe
    //    routine reports a legible `not-evaluated` instead of a spawn error when the primary instrument
    //    is absent (quality-gate-driver's instrument preflight).
    "  routines:",
    "    # Each entry needs an `interval:<N>m` trigger (two-layer time; `every(N)` is the retired",
    "    # iteration-count grammar and can never fire in fast mode) and a probe-spec name.",
    "    # architecture-analysis: shallow structural pass (dependency cycles / god-packages / duplication).",
    "    #   primary instrument: archguard; fallback: git-lens (plugin/probes/architecture-analysis.md).",
    "    - name: \"architecture-analysis\"",
    "      trigger: \"interval:1440m\"",
    "      probe: \"architecture-analysis\"",
    "",
    "# " + ruleLine(69),
    "# Section 4: Serve — the web server's bind binding (OPTIONAL, COMMENTED OUT)",
    "# " + ruleLine(69),
    "# The web server's bind host/port. ⛔ NOT WRITTEN: the uncommented defaults below are exactly the",
    "# values `resolveServeBinding` falls back to, so writing them would say nothing — and it made a",
    "# fresh install and an upgrade disagree about whether the section exists at all (AC-330).",
    "# Uncomment ONLY to pin your own values; the ones shown ARE the effective defaults.",
    "#",
    "# Exactly ONE reader: `resolveServeBinding` (packages/quay/src/serve/serve-binding.ts). An explicit",
    "# command-line `--host` / `--port` still wins over this section; a malformed value here (a",
    "# non-integer port, a blank host) REFUSES the start rather than silently falling back — so",
    "# 「配错了」 and 「没配」 are never the same reading.",
    "#",
    "# serve:",
    "#   host: \"0.0.0.0\"   # the declared fallback: listen on all interfaces",
    "#   port: 0           # 0 = NO CONSTRAINT — the kernel assigns an ephemeral port, read back",
    "#                     # from .quay/server.json (the section is PER-CHECKOUT: .quay/config.yml",
    "#                     # is gitignored, so two workspaces on one machine pick different ports)",
    "",
    "# " + ruleLine(69),
    "# Section 5: Release — the DECLARED release-branch model (OPTIONAL, COMMENTED OUT)",
    "# " + ruleLine(69),
    "# Declares which branch releases ADVANCE, which branch they are cut from, which branch",
    "# names count as release branches, and what a version tag looks like. A project with no",
    "# release process should LEAVE THIS OUT — absence is a real state (`release-model-check.ts`",
    "# reports it as `not-configured`, ⛔ never as a pass), and nothing forces `master` /",
    "# `release/*` / hotfix branches on a project that does not use them.",
    "#",
    "# The defaults below are the model quay itself uses. Every key has a named reader:",
    "#   line        release-master-advance-needs-check.ts + release-model-check.ts",
    "#   baseline    release-cut.mjs, release-branch-finish.sh, release-branch-janitor.ts",
    "#   globs       the same three carriers' branch-name / ref enumeration",
    "#   tag_prefix  release-cut.mjs (tag + branch naming) + release-model-check.ts",
    "#   advance     release-model-check.ts (ci ⇒ the advance job's needs: invariant is judged)",
    "#",
    "# release:",
    "#   line: \"master\"                     # the branch that must stop at the most recent green release",
    "#   baseline: \"develop\"                # releases are cut from, and merged back into, this branch",
    "#   globs: [\"release/*\", \"release-*\"]   # branch names that ARE release branches",
    "#   tag_prefix: \"v\"                    # v1.2.3 (use \"\" for bare 1.2.3 tags)",
    "#   advance: \"ci\"                      # ci | manual | none",
    "",
  ];

  return lines.join("\n");
}

function ruleLine(len: number): string {
  return "─".repeat(len);
}

/** Render ONE version-level default value (`LOOP_VERSION_DEFAULTS`) as
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

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// Project-value DETECTION — the four `loop:` values that depend on the TARGET project (never on the
// quay version). Ported from `plugin/scripts/quay-init.sh`'s `detect_test_command` /
// `detect_tmux_session` / `validate_worktree_root` so the CLI can complete a fresh install alone
// (gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script / AC-331).
//
// ⛔ These are NOT version-level defaults: `LOOP_VERSION_DEFAULTS` holds constants only, and a
// constant invented for a project-derived value would write a confidently wrong value into a user's
// config — strictly worse than leaving it out (that table's own header says so).
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The target project's test command — the CONFIG-PRESERVING ladder the shipped shell entry uses, first
 * match wins:
 *   scripts/test.sh             → "bash scripts/test.sh"   (quay's own convention)
 *   package.json scripts.test   → "npm test"               (non-blank; an unreadable/odd package.json
 *                                                           is a MISS, never a crash)
 *   go.mod                      → "go test ./..."
 *   Cargo.toml                  → "cargo test"
 * Returns null when nothing is detected. The caller FAILS CLOSED on null — this never guesses.
 */
export function detectTestCommand(root: string): string | null {
  if (fs.existsSync(path.join(root, "scripts", "test.sh"))) return "bash scripts/test.sh";
  if (fs.existsSync(path.join(root, "package.json")) && hasNpmTestScript(path.join(root, "package.json"))) {
    return "npm test";
  }
  if (fs.existsSync(path.join(root, "go.mod"))) return "go test ./...";
  if (fs.existsSync(path.join(root, "Cargo.toml"))) return "cargo test";
  return null;
}

/**
 * The detected tmux session for `project`, by NAME PREFIX (`<project>` or `<project>-*`) over
 * `tmux list-sessions`. Three-state, never a guess folded into a match (硬规则 3b):
 *   `unique`   — exactly one session matched (`session` is its name);
 *   `multiple` — several matched (`matches` lists them all) — the caller leaves `loop.tmux_session`
 *                null rather than picking one;
 *   `none`     — tmux absent, or nothing matched.
 * ⛔ A GUESSED session name only works for the project it was written for, and a monitor aimed at a
 * nonexistent session reports a LIVE inner as GONE — the false-negative this detection exists to kill
 * (gap-init-guesses-the-tmux-session).
 */
export function detectTmuxSession(project: string): { state: "unique" | "none" | "multiple"; session: string | null; matches: string[] } {
  let out = "";
  try {
    out = execFileSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return { state: "none", session: null, matches: [] };
  }
  const matches = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && (l === project || l.startsWith(`${project}-`)));
  if (matches.length === 1) return { state: "unique", session: matches[0]!, matches };
  if (matches.length > 1) return { state: "multiple", session: null, matches };
  return { state: "none", session: null, matches: [] };
}

/**
 * FAIL-CLOSED judge of a worktree root: `/tmp` (and any tmpfs) is RAM, not disk, and the 2026-08-04
 * machine-wide OOM traced straight to in-flight worktrees living in it
 * (gap-the-shipped-tick-doc-teaches-every-project-to-put-worktrees-in-tmpfs). The root itself may not
 * exist yet, so the NEAREST EXISTING ANCESTOR is the one stat-ed.
 *
 * Returns the probed path and its filesystem type so the caller can name both in the refusal (the
 * message must say WHY and WHAT TO DO — an unexplained refusal sends the operator guessing).
 */
export function validateWorktreeRoot(root: string): { ok: boolean; probe: string; fsType: string } {
  let probe = root;
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
  let fsType = "unknown";
  try {
    fsType = execFileSync("stat", ["-f", "-c", "%T", probe], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    fsType = "unknown";
  }
  return { ok: fsType !== "tmpfs", probe, fsType };
}

/** The four project-derived `loop:` values a fresh install (or an upgrade) writes. */
export interface ProjectLoopValues {
  repoRoot: string;
  testCommand: string;
  tmuxSession: string | null;
  worktreeRoot: string;
}

/**
 * Why a project-value resolution could not produce a usable set — surfaced verbatim (硬规则 3b: the
 * CLI must print the REAL cause, not a generic refusal).
 */
export interface ProjectValueFailure {
  reason: string;
  /** Extra operator-facing lines (the remedy), printed under the reason. */
  detail: string[];
}

/**
 * Resolve the four project-derived `loop:` values with the SHELL ENTRY's precedence — an EXPLICIT
 * parameter wins, else the target's existing `loop:` value (config-preserving upgrade), else
 * detection / the documented default. `repo_root` defaults to the workspace root; `worktree_root`
 * defaults to a sibling of `repo_root` and is validated (tmpfs ⇒ fail closed).
 *
 * Returns `{ ok: false }` with the real cause when the test command cannot be resolved — the caller
 * must fail closed BEFORE writing anything (a workspace whose fan-in command is wrong is worse than
 * an uninitialized one).
 */
export function resolveProjectLoopValues(
  root: string,
  configPath: string,
  explicit: { repoRoot?: string; testCommand?: string; tmuxSession?: string; worktreeRoot?: string; projectName?: string },
  log?: (line: string) => void,
): { ok: true; values: ProjectLoopValues } | { ok: false; failure: ProjectValueFailure } {
  const say = log ?? ((l: string) => console.log(l));
  // The name tmux detection matches against: the EXPLICIT `--project` when given (the caller may know
  // the project's name better than its directory's), else the directory basename — the same rule the
  // role-session prefixes use.
  const projectName = explicit.projectName && explicit.projectName !== "" ? explicit.projectName : path.basename(root);

  // repo_root: explicit → existing → the workspace root.
  let repoRoot = explicit.repoRoot && explicit.repoRoot !== "" ? explicit.repoRoot : readExistingLoopValue(configPath, "repo_root");
  if (repoRoot === "") repoRoot = root;

  // test_command: explicit → existing → detection → FAIL CLOSED.
  let testCommand = explicit.testCommand && explicit.testCommand !== "" ? explicit.testCommand : readExistingLoopValue(configPath, "test_command");
  if (testCommand !== "") {
    say(
      explicit.testCommand && explicit.testCommand !== ""
        ? `  using explicit --test-command: ${testCommand}`
        : `  using existing config loop.test_command: ${testCommand} (config-preserving upgrade — explicit --test-command overrides)`,
    );
  }
  if (testCommand === "") {
    const detected = detectTestCommand(root);
    if (detected === null) {
      return {
        ok: false,
        failure: {
          reason: `quay init needs the target project's test command but none could be detected in ${root}.`,
          detail: [
            "Searched: scripts/test.sh → package.json scripts.test → go.mod → Cargo.toml.",
            "Pass --test-command <cmd> explicitly.",
          ],
        },
      };
    }
    testCommand = detected;
    say(`  detected test command: ${testCommand} (from the target project — confirm this is correct)`);
  }

  // tmux_session: OPTIONAL since the outer/inner dual-tmux model retired. explicit → existing →
  // best-effort detection; zero/ambiguous matches leave NULL (never a guess, never a hard failure).
  let tmuxSession: string | null;
  if (explicit.tmuxSession && explicit.tmuxSession !== "") {
    tmuxSession = explicit.tmuxSession;
    say(`  using explicit --tmux-session: ${tmuxSession}`);
  } else {
    const existing = readExistingLoopValue(configPath, "tmux_session");
    if (existing !== "" && existing !== "null") {
      tmuxSession = existing;
      say(`  using existing config loop.tmux_session: ${tmuxSession} (config-preserving upgrade — explicit --tmux-session overrides)`);
    } else {
      const project = projectName;
      const detected = detectTmuxSession(project);
      if (detected.state === "unique") {
        tmuxSession = detected.session;
        say(`  detected tmux session: ${tmuxSession} (matching project '${project}' — confirm this is correct)`);
      } else {
        tmuxSession = null;
        if (detected.state === "multiple") {
          say(`  note: multiple tmux sessions match project '${project}' — loop.tmux_session left null (tmux is optional; pass --tmux-session to pin one)`);
        } else {
          say(`  note: no tmux session detected for project '${project}' — loop.tmux_session left null (tmux is optional; SPEC-tmux-retirement-2026-09-03)`);
        }
      }
    }
  }

  // worktree_root: explicit → existing → a sibling of repo_root. Validated (tmpfs ⇒ fail closed).
  //
  // The DEFAULT is `path.resolve`d, never string-templated. `${repoRoot}/../x-worktrees` resolves to
  // the same directory but PERSISTS a literal `..` segment into .quay/config.yml, and a
  // non-canonical path is a string-equality hazard for every consumer that compares paths by text
  // (gap-init-worktree-root-default-written-unnormalized). Normalization happens here, BEFORE
  // `validateWorktreeRoot`, so the tmpfs probe and the value actually written are the same string.
  //
  // Only the DEFAULT is normalized. An EXPLICIT `--worktree-root` and an EXISTING
  // `loop.worktree_root` read back from config are both persisted VERBATIM — the spelling a user put
  // in their config is theirs, and silently rewriting one of the four project-derived loop values
  // would be an unrequested edit to a file this command's whole doctrine is to preserve. So a config
  // written by an older quay keeps its `/../` spelling until the operator changes it (delete the key
  // to re-derive the default, or pass --worktree-root); what this fix guarantees is that quay never
  // WRITES that spelling itself again. This also makes re-running init idempotent: the resolved
  // default matches what the first run wrote, so the merge in writeInitConfig sees `current === value`
  // and reports the config unchanged.
  let worktreeRoot = explicit.worktreeRoot && explicit.worktreeRoot !== "" ? explicit.worktreeRoot : readExistingLoopValue(configPath, "worktree_root");
  const defaultWorktreeRoot = path.resolve(repoRoot, "..", `${path.basename(repoRoot)}-worktrees`);
  if (worktreeRoot === "") worktreeRoot = defaultWorktreeRoot;
  const wt = validateWorktreeRoot(worktreeRoot);
  if (!wt.ok) {
    return {
      ok: false,
      failure: {
        reason: `worktree root '${worktreeRoot}' is on tmpfs ('${wt.probe}' is tmpfs) — this is memory, not disk.`,
        detail: [
          "Every worktree under it consumes RAM; the 2026-08-04 machine-wide OOM traced straight to it.",
          `Change it to a real disk path — e.g. '${defaultWorktreeRoot}', or pass --worktree-root.`,
        ],
      },
    };
  }
  say(`  worktree root: ${worktreeRoot} (filesystem: ${wt.fsType} — not tmpfs, OK)`);

  return { ok: true, values: { repoRoot, testCommand, tmuxSession, worktreeRoot } };
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
        // ⛔ These three are the SHIPPED template's env block (plugin/.claude/launch.settings.json),
        // and the list is load-bearing, not decorative: `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` and
        // `CLAUDE_CODE_DISABLE_MOUSE` were added to the shipped file 2026-08-11 (cold-start
        // usability) and this inline copy was NOT updated — so every project initialised through the
        // TS engine got a launch settings file MISSING them, while one initialised by the shell entry
        // (which copied the shipped file verbatim) got them. Two writers, two answers (硬规则 5b).
        // The shell entry is a shim now, so this is the only writer — and `packages/quay/test/
        // init.test.mjs` pins this table to the shipped file byte-for-byte, the same executable
        // invariant its `.quay/profiles.yml` sibling has. Edit both or neither.
        env: {
          CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1",
          CLAUDE_CODE_DISABLE_MOUSE: "1",
          CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false",
        },
      },
      null,
      2,
    ) + "\n"
  );
}

/**
 * Generate the `.codex/config.toml` content laid down by `quay init` (AC-932): register the quay MCP
 * server over stdio, with `cwd` pinned to the init TARGET root and `args` naming the INSTALLED dist
 * bundle — never the dev-tree source `packages/quay/bin/quay.ts` (the AC-931 publish surface).
 *
 * `cwd` is the load-bearing half (SPEC-codex-long-term-support-2026-10-29 §3.2): codex-cli resolves
 * relative `args` against the SESSION working directory, so a consumer project that omits `cwd` gets a
 * server that ENOENTs silently from any subdirectory. The value is computed at runtime from `root`,
 * never baked in — a hardcoded host path is exactly what AC-932's reverse arm forbids.
 *
 * When `pluginRoot` is known (the real install path: `/quay:init` runs from the installed plugin and
 * carries `CLAUDE_PLUGIN_ROOT`), `args[0]` is the absolute `<pluginRoot>/vendor/quay/dist/quay.js`
 * (the same bundle `plugin/.mcp.json` names for Claude Code). Without a plugin root there is no
 * spawnable absolute path to compute, so the RELATIVE artifact name is laid down with the comment
 * saying to re-run with `--plugin-root` — never an invented path (硬规则 3b).
 *
 * `default_tools_approval_mode = "approve"` is the other load-bearing half
 * (gap-codex-host-config-approval-policy-blocks-mcp): codex-cli's session approval policy defaults to
 * `never`, under which every quay MCP tool call is refused before the server is even spawned. The
 * MCP-server-scoped key that unblocks those calls is `default_tools_approval_mode` (enum
 * `auto`/`prompt`/`writes`/`approve`) — NOT the top-level profile key `approval_policy`, which codex
 * 0.165.0 warns is "ignored" under `[mcp_servers.quay]` (verified: `approval_policy = "on-request"`
 * leaves `task_list` refused; `default_tools_approval_mode = "approve"` lets `task_list` complete).
 * `approve` auto-approves the quay MCP tools, which is the only value that actually fixes the silent
 * skip under `approval: never`; the value is emitted verbatim so the reverse arm can flip it.
 */
export function generateCodexConfigToml(root: string, pluginRoot?: string | null): string {
  const cwd = path.resolve(root);
  const runtime = pluginRoot
    ? path.join(pluginRoot, "vendor", "quay", "dist", "quay.js")
    : "vendor/quay/dist/quay.js";
  return [
    "# Project-scoped Codex configuration laid down by `quay init` (AC-932).",
    "#",
    "# Registers the quay MCP server over stdio. `cwd` pins the server's working directory to THIS",
    "# project root — codex-cli resolves relative `args` against the session working directory, so",
    "# without an explicit `cwd` the server ENOENTs silently from a subdirectory",
    "# (SPEC-codex-long-term-support-2026-10-29 §3.2).",
    "#",
    "# `default_tools_approval_mode = \"approve\"` is REQUIRED: codex-cli's session approval policy",
    "# defaults to `never`, which refuses every quay MCP tool call before the server is spawned",
    "# (gap-codex-host-config-approval-policy-blocks-mcp). `approve` auto-approves the quay MCP tools",
    "# so `task_list`/`task_get`/`task_write` complete under `approval: never`.",
    "#",
    "# `args[0]` names the INSTALLED dist bundle (vendor/quay/dist/quay.js) — the AC-931 publish",
    "# surface — never the dev-tree source. Re-run `quay init --plugin-root <root>` if the plugin",
    "# root could not be resolved and the relative path below is not spawnable.",
    "",
    "[mcp_servers.quay]",
    'command = "node"',
    `args = [${JSON.stringify(runtime)}, "mcp"]`,
    `cwd = ${JSON.stringify(cwd)}`,
    'default_tools_approval_mode = "approve"',
    "",
  ].join("\n");
}

/**
 * The SHIPPED `AGENTS.md` template for CONSUMER projects (AC-932) — the ONE authored copy of the
 * Codex-facing resident guide, byte-identical to the checked-in `plugin/.codex/AGENTS.md` (the same
 * executable invariant as its launch.settings.json / profiles.yml siblings; the duplication is
 * packaging, not preference — see `generateProfilesContent`). Concise by design: the repeatable
 * workflows and the operator/directive lifecycle policy stay in `plugin/skills/`; this file only
 * POINTS at them, so it carries no drift-prone policy text to copy (the AC-932 single-source guard).
 */
export function generateAgentsMd(): string {
  return AGENTS_MD_TEMPLATE;
}

const AGENTS_MD_TEMPLATE = [
  "# AGENTS.md",
  "",
  "Durable guidance for an AI agent (e.g. Codex) operating in THIS project. Laid down by",
  "`quay init`. Concise by design — the repeatable workflows live in the quay Skills, not here.",
  "",
  "## What this project uses",
  "",
  "This project's task store is `quay` (a provider-agnostic task board). Task state is",
  "authoritative through the Provider ABI (`.quay/config.yml`); transcripts and session notes",
  "are diagnostic context, never authoritative state.",
  "",
  "## The quay MCP server",
  "",
  "Prefer the quay MCP server registered in `.codex/config.toml`: tools `task_list`,",
  "`task_get`, `task_check`, `task_write`. If it is unavailable, degrade explicitly to the quay",
  "CLI read path — never skip an authorization or a check because the MCP server is down.",
  "",
  "## quay Skills (invoke explicitly)",
  "",
  "- `$quay-task-operator` — bounded, human-authorized task read/check/create/edit transaction.",
  "- `$quay-directive` — record a directive as a task-canonical `label:directive` task.",
  "",
  "The skills are single-sourced in the quay plugin (`plugin/skills/`); `.agents/skills/` is the",
  "Codex host surface and carries no copied policy.",
].join("\n") + "\n";

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
 * The operator-facing WARNING for a project-scope version cross-check `mismatch` — the sentence
 * `runInit` emits (to STDERR) when `projectScopedVersionReading` reports `mismatch`.
 *
 * ⛔ 它必须同时点名**两个版本**与**命中的 scope**：只说「版本不一致」会让操作者去查是哪一个入口的版本、
 * 以及为什么配置与运行时不同 —— 而那正是本条缺陷在修好前让人查不到的东西
 * (gap-init-plugin-version-crosscheck-project-scope-shadow)。⛔ 不含任何动作 —— warn-only，
 * 退出码不变（硬规则 12：读数不得阻塞一次合法 init）。
 */
export function formatProjectVersionMismatchWarning(r: ProjectScopedVersionReading): string {
  const scope = r.registryScope ?? r.scope ?? "unknown";
  return (
    `warning: this project will load quay plugin ${r.loaded} (scope "${scope}"), but init is running as ` +
    `${r.self}. Claude Code resolves a projectPath-matching project/local entry over the user entry, so this ` +
    `project's sessions load ${r.loaded} while init wrote a ${r.self} config. Align the "${scope}"-scope entry ` +
    `for this project with ${r.self} (inspect with \`claude plugin list --json\`), or the config's runtime and ` +
    `the loaded runtime will keep disagreeing. (warning only — init's exit code is unchanged)`
  );
}

/**
 * Run the init operation.
 *
 * @returns InitResult on success.
 * @throws Error on unexpected filesystem errors (permissions, etc.).
 */
export function runInit(opts: InitOptions): InitResult {
  // ── the project-scope version cross-check (gap-init-plugin-version-crosscheck-project-scope-shadow) ──
  // BEFORE the engine runs: answer "which plugin version will THIS project actually load" — the session
  // layer's projectPath tier rule, NOT "the highest version installed on this machine" — and warn when it
  // disagrees with the version running init. ⛔ WARN-ONLY: the exit code is unchanged (硬规则 12 — a
  // reading must not block a legitimate init), and the sentence goes to STDERR (a warning is not progress
  // on stdout, and `--json` promises stdout carries exactly one document).
  const root = path.resolve(opts.root);
  const homeDir = opts.homeDir ?? process.env.HOME ?? os.homedir();
  const pluginVersionForProject = projectScopedVersionReading(
    homeDir,
    root,
    readPluginRootVersion(opts.pluginRoot ?? null),
  );
  if (pluginVersionForProject.state === "mismatch") {
    process.stderr.write(formatProjectVersionMismatchWarning(pluginVersionForProject) + "\n");
  }
  // `workspaceRoot` is attached HERE, not at each of `runInitImpl`'s dozen return sites: this wrapper
  // already resolves the root, and a root derived in twelve places is twelve chances to derive a
  // different one. `runInitImpl` returns the result WITHOUT it (see its signature) so the compiler
  // forces exactly this one site to supply it.
  //
  // The STANDING doc-branch invariant is attached here for the same reason — ONE site, reading the
  // state the run actually left on disk (branch-model.ts `checkDocBranchInvariant`). Read-only: it
  // neither creates the doc branch nor moves HEAD, so an init that already did the right thing is
  // not perturbed by being measured afterwards.
  const result = runInitImpl(opts);
  return {
    ...result,
    workspaceRoot: root,
    pluginVersionForProject,
    docBranchInvariant: checkDocBranchInvariant(root, { name: resolveDocBranchName(root, opts.docBranchName) }),
  };
}

/**
 * Resolve the DOC-branch NAME with the shipped precedence: explicit parameter > the target's
 * `loop.doc_branch` > the `author` convention.
 *
 * ⛔ `author` rides an `??` chain on purpose — a BARE identity literal is what
 * `target-identity-literal-check.ts` fails RED on (`"author"` is deliberately NOT in
 * `LEGAL_IDENTITY_VALUES`), and this is the ONE place the convention is spelled. ⛔ An explicitly
 * supplied empty string is NOT replaced (it is the caller saying "no name" and must keep reaching
 * `ensureDocBranch` / `checkDocBranchInvariant` as NOT-EVALUATED).
 */
export function resolveDocBranchName(root: string, explicit?: string): string {
  const configured = (() => {
    try {
      const cfg = classifyConfig(path.join(root, ".quay", "config.yml"));
      const loop = (cfg.config?.["loop"] ?? {}) as Record<string, unknown>;
      return typeof loop["doc_branch"] === "string" ? (loop["doc_branch"] as string) : undefined;
    } catch {
      // An unreadable/missing config has no opinion — fall through to the convention rather than
      // turning a name resolution into a failure (the state that matters is reported elsewhere).
      return undefined;
    }
  })();
  return explicit ?? configured ?? "author";
}

function runInitImpl(opts: InitOptions): Omit<InitResult, "workspaceRoot" | "docBranchInvariant"> {
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
  // `--project <name>` overrides the directory basename (the caller may know the project's name
  // better than its directory's); an absent flag keeps the basename, never an invented literal.
  const profilesContent = generateProfilesContent(opts.project ?? path.basename(root));

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
      pluginLink: { state: "not-run", reason: "the config-free branch-model entry touches no config" },
      validated: "not-evaluated",
    };
  }

  // ── What does the target already have? (three-state — AC1; not `fs.existsSync`) ────────────────
  // Computed BEFORE the project-value resolution because a fail-closed result carries this state.
  const existing = classifyConfig(configPath);

  // ── Branch model (gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing) ──────
  // Run BEFORE writing anything — on the UPGRADE path as much as the fresh one: if the project's
  // `develop` is a foreign line, init must stop with the tree untouched (a half-initialized project
  // is worse than an uninitialized one), and an upgrade that rewrote the config first would have
  // already broken that promise. The landing baseline the fan-in / anti-drift path reads (`develop`)
  // is ESTABLISHED here — that is what turns the shipped `?? "develop"` default from an assumption
  // into a fact.
  //
  // ⛔ WHY IT SITS THIS EARLY (gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch):
  // the retired shell entry ran the CONFIG-FREE branch-model entry — `quay init --branch-model-only
  // --doc-branch-name <name>` — as its FIRST step, before its closed-set write, so EVERY shipped
  // init judged the baseline and established the doc branch. The entry is a shim over this engine
  // now, so that first step has to live here; leaving it inside the fresh-install arm would make an
  // upgrade stop judging its baseline (silently writing `fork_baseline: develop` for a `develop` it
  // never validated) and `/quay:init` stop creating the doc branch.
  // `let`, not `const`: a repo that is UNBORN as this judgment runs gets a SECOND judgment later in
  // the SAME run (the auto-commit below creates its first commit) — see the re-evaluation block
  // after the write section. Every other path keeps the pre-write verdict, byte-identical.
  let branchModel = ensureBranchModel(root, {
    adopt: opts.adoptBranchModel === true,
    dryRun: opts.dryRun === true,
  });
  let branchModelReport = formatBranchModelReport(branchModel);
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
      pluginLink: { state: "not-run", reason: "init refused before the link step (nothing was written)" },
      validated: "not-evaluated",
    };
  }

  // ── The DOC-branch bootstrap (gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch)
  // ──
  // The same first step's second half: the branch-model entry ALSO created/switched the doc-only work
  // branch. Runs BEFORE any write, exactly as the shell's `set -e` abort did: a REFUSED doc branch (a
  // name collision) leaves the tree untouched rather than half-initialized.
  // Precedence, unchanged: explicit `--doc-branch-name` > the target's `loop.doc_branch` > the
  // `author` convention — and it is spelled ONCE, in `resolveDocBranchName`, because the CLI's check
  // verb and the post-run invariant reading must resolve the SAME name this step establishes
  // (ADR-004: one judgment source, never a second predicate). ⛔ `ensureDocBranch` invents no name of
  // its own (see its header).
  const docBranchName = resolveDocBranchName(root, opts.docBranchName);
  // The baseline→checkout handoff the branch-model-only entry performs (and ONLY when the baseline
  // was established by THIS run and points at the very commit the checkout is on): metadata-only,
  // never under --dry-run. It must precede the doc-branch judgment — `ensureDocBranch` reads the
  // CHECKED-OUT branch, and the unmoved checkout is the state that makes it land on its no-op arm.
  let baselineCheckoutReport: string | null = null;
  if (opts.dryRun !== true && landingBaselineEstablishedNow(branchModel)) {
    const checkout = moveCheckoutOntoLandingBaseline(root);
    baselineCheckoutReport = formatBaselineCheckoutReport(checkout);
    if (!checkout.ok) {
      return {
        outcome: "doc-branch-blocked",
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
        pluginLink: { state: "not-run", reason: "init refused before the link step (nothing was written)" },
        validated: "not-evaluated",
        failureReason:
          "could not move the main checkout onto the landing baseline it just established — refusing " +
          "to continue, because the doc-branch bootstrap would then read the unmoved checkout.",
      };
    }
  }
  let docBranch = ensureDocBranch(root, {
    name: docBranchName,
    dryRun: opts.dryRun === true,
    adopt: opts.adoptBranchModel === true,
  });
  let docBranchReport = formatDocBranchReport(docBranch);
  if (!docBranch.ok && opts.dryRun !== true) {
    return {
      outcome: "doc-branch-blocked",
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
      docBranch,
      docBranchReport,
      pluginLink: { state: "not-run", reason: "init refused before the link step (nothing was written)" },
      validated: "not-evaluated",
      failureReason: docBranch.detail,
    };
  }
  // `let`: the unborn-repository re-evaluation after the write section REBUILDS this bundle from the
  // second judgment. Every return ABOVE keeps the pre-write one, which is the whole point — the
  // pre-write judgment is what makes a refused project leave the tree untouched.
  let docBranchFields = {
    docBranch,
    docBranchReport,
    ...(baselineCheckoutReport !== null ? { baselineCheckoutReport } : {}),
  };

  // ── The PROJECT-DERIVED `loop:` values (AC-331) ──────────────────────────────────────────────
  // Resolved for EVERY non-branch-model mode — fresh AND upgrade — exactly as the shipped shell entry
  // does: an explicit parameter wins, else the target's existing value, else detection / the
  // documented default. A missing TEST COMMAND fails closed BEFORE anything is written: a workspace
  // whose fan-in command is wrong is worse than an uninitialized one, and the report must name the
  // real cause (硬规则 3b) rather than quietly proceeding without it.
  const preWriteSnapshot = snapshotClosedSet(root);
  const say = opts.log ?? ((l: string) => console.log(l));
  const projectValues = resolveProjectLoopValues(
    root,
    configPath,
    {
      repoRoot: opts.repoRoot,
      testCommand: opts.testCommand,
      tmuxSession: opts.tmuxSession,
      worktreeRoot: opts.worktreeRoot,
      projectName: opts.project,
    },
    say,
  );
  // `=== false`, not `!projectValues.ok`: this repo's root tsconfig is `strict: false`, under which
  // the NEGATIVE branch of an `ok: true | false` union is not narrowed ⇒ `.failure` would be TS2339.
  // (Same note lives on `ensureGoalBranch` in branch-model.ts; the fan-in ts-typecheck gate runs real
  // `npx tsc` and reds three `ts-typecheck-gate-*` tests when this is got wrong.)
  if (projectValues.ok === false) {
    return {
      outcome: "project-values-unresolved",
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
      ...docBranchFields,
      pluginLink: { state: "not-run", reason: "init refused before the link step (nothing was written)" },
      validated: "not-evaluated",
      failureReason: projectValues.failure.reason,
      failureDetail: projectValues.failure.detail,
      closedSetState: closedSetReport(root, preWriteSnapshot),
    };
  }
  const values = projectValues.values;

  // ── EXISTING + UNPARSEABLE ⇒ SALVAGE-BY-REBUILD (no flag: the file's STATE decides) ────────────
  // GOAL-029 / 人 2026-10-07: the three states map to three actions and nothing else — absent ⇒ fresh
  // install, valid ⇒ upgrade (validate-before-write), corrupt ⇒ back the unreadable bytes up and
  // rebuild from this version's defaults. Corrupt is NOT a refusal: the state is a fact about the
  // file, not a question for the operator, and the pre-fix refusal left a project with a broken
  // config NO in-band way to repair it (while 硬规则 3b still requires the real cause — a parse
  // error, not "already exists" — to be printed). The rebuild is the SAME fresh-install path below,
  // so there is one template and one writer; only the outcome token and the backup differ.
  //
  // ⛔ No selector reaches this path either (AC-330 removed the last one): the backup happens for
  // every corrupt state, and the salvage is reported by the caller (`corruptBackupPath`).

  // ── EXISTING + USABLE ⇒ the SINGLE UPGRADE ENGINE (GOAL-029 single engine) ─────────────────────
  // Plain `quay init` and `--drop-incompatible` land here — there is no second upgrade path. The
  // candidate is computed IN MEMORY, judged by the SAME validator `quay config validate` runs, and
  // written only when it validates: a failed upgrade leaves the original bytes untouched and exits
  // non-zero (硬规则 3b — "could not be made valid" is its own outcome, and the operator is told
  // WHICH field failed rather than getting a generic refusal).
  if (existing.state === "valid") {
    // ── STEP 0: the LEGACY-RUNTIME migration, FIRST ───────────────────────────────────────────────
    // The shipped shell entry runs this before the reconcile (its `write_config` existing-config arm):
    // it deletes the retired native `path`/`mcp_entry` LINES and retires a stale project-local
    // `.quay/runtime/` copy — reversible, and only when unreferenced + recognizably quay's own +
    // stale. The upgrade engine below then reads the POST-migration text, so one run reaches the
    // fixpoint (a second run is a no-op) exactly as the shell's does.
    // Only when the plugin root is known — the judgment needs THIS delivery's vendored bundles to
    // tell "stale" from "byte-current" (with no root there is nothing to compare against, and
    // guessing would retire a current copy).
    let rawForUpgrade = existing.raw ?? "";
    if (opts.pluginRoot) {
      const providerRoot = path.join(opts.pluginRoot, "vendor", "quay-native");
      migrateStaleMcpEntry({
        cfgPath: configPath,
        installProvider: providerRoot,
        installRuntime: path.join(providerRoot, "dist", "quay-native.js"),
        installCore: path.join(opts.pluginRoot, "vendor", "quay", "dist", "quay.js"),
        wsRoot: root,
        dryRun: opts.dryRun === true,
        backupTs: String(Math.floor(Date.now() / 1000)),
        log: opts.log,
      });
      try {
        rawForUpgrade = fs.readFileSync(configPath, "utf8");
      } catch {
        // the file vanished under us — keep the pre-migration text rather than crashing
      }
    }
    const up = upgradeConfigContent(rawForUpgrade, {
      workspaceRoot: root,
      // ⛔ `undefined`, never `null`: the validator reads `null` as "no plugin root could be resolved"
      // (the state a fixture injects) and `undefined` as "resolve it yourself" — passing `null` here
      // would make every upgrade fail with `native-provider-unresolvable`.
      pluginRoot: opts.pluginRoot ?? undefined,
      dropIncompatible: opts.dropIncompatible === true,
      // AC-331: the four project-derived values follow the same comment-preserving, per-key pipeline
      // as the version defaults — the CLI's equivalent of the shell entry's `ensure_loop_config`.
      projectValues: values,
    });
    const base = {
      configState: "valid" as const,
      configPath,
      tasksDir,
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel,
      branchModelReport,
      ...docBranchFields,
      upgrade: up.report,
      validated: up.ok,
      ...(up.ok ? {} : { validationIssues: up.issues }),
    };
    // A candidate that does not validate is NOT written, and nothing downstream of the write runs:
    // the link step below would otherwise point the project at a runtime whose config upgrade failed.
    if (!up.ok) {
      return {
        outcome: "upgrade-invalid", content: up.content, upgradeIssues: up.issues,
        pluginLink: { state: "not-run", reason: "the upgrade was refused before the link step (nothing was written)" },
        ...base,
      };
    }
    // A no-op upgrade writes NOTHING: re-running init on a current project must leave the config
    // byte-identical (the reconcile discipline this replaces already enforced this).
    if (!opts.dryRun && !up.report.untouched) {
      writeFileAtomic(configPath, up.content);
    }
    // The `.quay/plugin` RETIREMENT step runs AFTER the config write succeeded. It no longer needs to
    // know which plugin this run came from — it only ever deletes a symlink — so it runs on EVERY
    // upgrade, including `--dry-run` (report only, nothing unlinked: AC5).
    // ⛔ Its progress lines go through `opts.log`: on `--json` they must land on stderr, or they
    // corrupt the one JSON document stdout is promised to carry.
    const pluginLink: PluginLinkOutcome = retireProjectPluginLink({
      wsRoot: root,
      dryRun: opts.dryRun,
      log: opts.log,
    });
    // The closed set is committed outside `--dry-run` (nothing to commit) — the shipped shell entry
    // runs this step on EVERY mode, so a re-run can commit scaffolds an earlier run left behind.
    const upgradeAutoCommit = opts.dryRun ? undefined : autoCommitClosedSet(root, opts.autoCommitConfig ?? "prompt", readPluginVersion(opts.pluginRoot));
    return {
      outcome: up.report.untouched ? "unchanged" : "reconciled",
      content: up.content,
      pluginLink,
      ...(upgradeAutoCommit ? { autoCommit: upgradeAutoCommit } : {}),
      ...base,
    };
  }

  // ── EXISTING + UNPARSEABLE ⇒ salvage by rebuild, automatically (GOAL-029 状态自动决定) ────────────
  // The STATE decides; no flag asks for this. It has to be automatic: an unreadable config is the one
  // condition the repair entry exists for (the MCP `init` tool is REGISTERED on the degraded path so
  // it can be reached exactly here), and with the retired selectors gone there is no in-band way to
  // request a rebuild — leaving a refusal would be a dead end.
  //
  // The unreadable bytes are preserved beside the new file rather than discarded — "the parser could
  // not read it" is not evidence that the content is worthless. The backup is what makes the
  // overwrite non-destructive, and it is computed HERE (a candidate path even under `--dry-run`, so
  // the plan can name it) but only COPIED once we are past the dry-run and branch-model gates — a
  // blocked run must not leave a stray backup behind.
  const isRebuild = existing.state === "corrupt";
  let corruptBackupPath: string | undefined;
  if (isRebuild) {
    // Second-granularity stamp (see `corruptBackupPathFor`): the `-N` suffix is what makes two
    // rebuilds inside one second NOT collide, so the earlier backup survives.
    corruptBackupPath = corruptBackupPathFor(configPath, Math.floor(Date.now() / 1000));
  }

  // Detect project type.
  const { isNode, isGo } = detectProjectType(root);

  // Resolve provider.
  const providerId = opts.provider ?? detectProvider();

  // Compute relative provider path from workspace root to quay-native package.
  const providerPath = resolveProviderPath(root);

  // Generate config content. A REBUILD then runs the SAME upgrade engine over that template, for two
  // reasons that are one fix: (a) it brings the rebuilt file to the fixpoint an upgrade would produce
  // (the retired native binding dropped, the carrier env pinned), so a rebuilt workspace is not born
  // one `quay init` behind and re-running init on it is a byte-level no-op (idempotent); (b) that
  // engine ALSO judges the candidate — its `ok` IS validate-before-write, so the corrupt path needs
  // no second validator. A template that cannot be made valid (e.g. a provider id the YAML cannot
  // carry) therefore writes NOTHING: the corrupt original and its backup are kept and the failure is
  // named (硬规则 3b — "could not produce a valid config" is its own outcome, never a silent
  // "written").
  let content = generateConfigContent({ providerId, providerPath, isNode, isGo, values, root });
  if (isRebuild) {
    const fixpoint = upgradeConfigContent(content, {
      workspaceRoot: root,
      // ⛔ `undefined`, never `null` — same reading as the upgrade path above.
      pluginRoot: opts.pluginRoot ?? undefined,
    });
    if (!fixpoint.ok) {
      return {
        outcome: "rebuild-invalid",
        configState: "corrupt",
        corruptReason: existing.reason,
        corruptBackupPath,
        rebuildIssues: fixpoint.issues,
        configPath,
        tasksDir,
        content: fixpoint.content,
        launchSettingsPath,
        launchSettingsContent: "",
        profilesPath,
        profilesContent: "",
        branchModel,
        branchModelReport,
        ...docBranchFields,
        pluginLink: { state: "not-run", reason: "the rebuild was refused before the link step (nothing was written)" },
        validated: false,
        validationIssues: fixpoint.issues,
        closedSetState: closedSetReport(root, preWriteSnapshot),
      };
    }
    content = fixpoint.content;
  }

  // Judge the candidate with the SAME validator `quay config validate` runs, so the report's
  // `validated` field is a real reading rather than a claim. (The upgrade path judges its candidate
  // inside `upgradeConfigContent`; a REBUILD's candidate was judged by the fixpoint above — the same
  // validator over the same text, so this reading agrees by construction, and the `rebuild-invalid`
  // arm above is where a failure is carried.)
  const freshVerdict = validateConfigText({ text: content, workspaceRoot: root, pluginRoot: opts.pluginRoot ?? undefined });

  if (opts.dryRun) {
    return {
      outcome: "dry-run",
      configState: existing.state,
      ...(corruptBackupPath ? { corruptBackupPath } : {}),
      configPath,
      tasksDir,
      content,
      launchSettingsPath,
      launchSettingsContent,
      profilesPath,
      profilesContent,
      branchModel,
      branchModelReport,
      ...docBranchFields,
      pluginLink: retireProjectPluginLink({ wsRoot: root, dryRun: true, log: opts.log }),
      validated: freshVerdict.ok,
      ...(freshVerdict.ok ? {} : { validationIssues: freshVerdict.issues }),
    };
  }

  // ── The WRITE section ────────────────────────────────────────────────────────────────────────
  // Everything below MUTATES the target, so it is wrapped: a mid-write abort (a `.claude` FILE where a
  // directory is needed, a permission error) must be reported with the per-item closed-set state —
  // "initialized half-way" must stay distinguishable from "not initialized" (硬规则 3b, write side).
  const goalsDir = path.join(root, "goals");
  const settingsPath = path.join(root, ".claude", "settings.json");
  const pluginVersion = readPluginVersion(opts.pluginRoot);
  const installStepsText = printInstallSteps({ homeDir: opts.homeDir ?? process.env.HOME ?? os.homedir() });
  let autoCommit: AutoCommitReading | undefined;
  let pluginLink: PluginLinkOutcome = { state: "not-run", reason: "the run aborted before the link step" };
  // The unborn-repository re-judgment's own failure channel (see the block after this try). `null`
  // while nothing has gone wrong — including on every path that never reaches that block.
  let postWriteBranchModelFailure: string | null = null;
  const gitignoreWarnings: string[] = [];
  try {
    // The backup lands FIRST (and only now, past every gate): between the copy and the rebuild there
    // is no window in which the original is gone.
    if (isRebuild && corruptBackupPath) fs.copyFileSync(configPath, corruptBackupPath);
    fs.mkdirSync(quayDir, { recursive: true });
    writeFileAtomic(configPath, content);

    // .quay/profiles.yml (the profile carrier, AC154) — create-if-absent discipline. Written BEFORE
    // the `.claude/*` files, in the shipped shell entry's order, so a `.claude` that cannot be
    // created aborts AFTER the config surface is complete (the partial-state report must be truthful
    // about WHICH items landed).
    if (!fs.existsSync(profilesPath)) {
      fs.mkdirSync(path.dirname(profilesPath), { recursive: true });
      fs.writeFileSync(profilesPath, profilesContent, "utf8");
    }

    // tasks/ + goals/ — the dual carrier the native provider's goal store needs.
    if (!fs.existsSync(tasksDir)) fs.mkdirSync(tasksDir, { recursive: true });
    if (!fs.existsSync(goalsDir)) fs.mkdirSync(goalsDir, { recursive: true });

    // .gitignore — the quay runtime rules (state inside AND outside `.quay/`).
    const manifest = opts.pluginRoot ? path.join(opts.pluginRoot, "scripts", "quay-runtime-artifacts.txt") : null;
    gitignoreWarnings.push(...ensureGitignore(root, { runtimeArtifactsManifest: manifest, log: say }).warnings);

    // .claude/launch.settings.json (with bypassPermissions) so a cold-start inner does not hit a
    // permission prompt on its own loop scripts. ⛔ CREATE-IF-ABSENT, never overwrite (AC-330): an
    // existing file is the user's and is left alone.
    if (!fs.existsSync(launchSettingsPath)) {
      fs.mkdirSync(path.dirname(launchSettingsPath), { recursive: true });
      fs.writeFileSync(launchSettingsPath, launchSettingsContent, "utf8");
    }

    // .claude/settings.json — project-level plugin enable + MCP pre-approval. Read-modify-write: an
    // existing file keeps every unrelated key.
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeClaudeSettings(settingsPath, readPluginName(opts.pluginRoot));

    // ── The Codex host trio (AC-932) ──────────────────────────────────────────────────────────────
    // `.codex/config.toml` (MCP registration, cwd = THIS target root) + the `.agents/skills` host
    // directory + `AGENTS.md`. All three are CREATE-IF-ABSENT, like launch.settings.json: an existing
    // file is the consumer's own and is left alone (a config.toml already present must not be clobbered).
    const codexConfigPath = path.join(root, ".codex", "config.toml");
    if (!fs.existsSync(codexConfigPath)) {
      fs.mkdirSync(path.dirname(codexConfigPath), { recursive: true });
      fs.writeFileSync(codexConfigPath, generateCodexConfigToml(root, opts.pluginRoot), "utf8");
    }
    const agentsSkillsDir = path.join(root, ".agents", "skills");
    if (!fs.existsSync(agentsSkillsDir)) fs.mkdirSync(agentsSkillsDir, { recursive: true });
    const agentsMdPath = path.join(root, "AGENTS.md");
    if (!fs.existsSync(agentsMdPath)) {
      fs.writeFileSync(agentsMdPath, generateAgentsMd(), "utf8");
    }

    // The `.quay/plugin` RETIREMENT (human ruling 2026-10-25): init no longer creates the guidance
    // link. A symlink left by an older init is deleted here; anything else at that name is the user's
    // and is left byte-identical (`refused`). ⛔ There is no "create" branch left to reach.
    pluginLink = retireProjectPluginLink({ wsRoot: root, dryRun: false, log: say });

    autoCommit = autoCommitClosedSet(root, opts.autoCommitConfig ?? "prompt", pluginVersion);
  } catch (err: unknown) {
    return {
      outcome: "write-failed",
      configState: existing.state,
      ...(isRebuild ? { corruptReason: existing.reason, corruptBackupPath } : {}),
      configPath,
      tasksDir,
      content,
      launchSettingsPath,
      launchSettingsContent,
      profilesPath,
      profilesContent,
      branchModel,
      branchModelReport,
      ...docBranchFields,
      pluginLink: { state: "not-run", reason: "the run aborted mid-write" },
      validated: freshVerdict.ok,
      ...(freshVerdict.ok ? {} : { validationIssues: freshVerdict.issues }),
      failureReason: err instanceof Error ? err.message : String(err),
      closedSetState: closedSetReport(root, preWriteSnapshot),
    };
  }

  // ── The UNBORN-repository re-evaluation ───────────────────────────────────────────────────────
  // (gap-init-branch-model-runs-before-auto-commit-fresh-repo-needs-two-runs)
  //
  // ============================ WHY THE ORDER IS WHAT IT IS ============================
  // The branch model MUST be judged before the config WRITE — that is the load-bearing half: a
  // project whose `develop` is a foreign line is refused with the tree untouched, and a run that had
  // already rewritten the config could not keep that promise (a half-initialized project is worse
  // than an uninitialized one). Verbatim inherited: the retired `quay-init.sh` ran
  // `ensure_target_branch_model` at its line 1290 and `auto_commit_laid_down` at its 1328 — i.e.
  // branch model → closed-set write → auto-commit, the SAME sequence, since long before this engine.
  //
  // ⛔ But "before the COMMIT" is NOT the load-bearing half, and it is the half that bites. An
  // auto-commit is by construction a commit OF the just-written config, so it can only ever run after
  // the write — and on a repository with ZERO commits it is also the event that brings the branch
  // model's entire input into existence. `ensureBranchModel` therefore judged an unborn repository
  // (`skipReason: "no-commits"`), `ensureDocBranch` read an unborn HEAD (`NOT-EVALUATED`), and the
  // first commit appeared one step LATER. Measured 2026-10-12 on `git init -b develop` (0 commits):
  // run 1 printed `branch model: SKIPPED` + `[NOT-EVALUATED] doc-branch`, then
  // `auto-commit: committed 5 file(s)`; run 2 printed `[CREATED] doc-branch -> author … and switched
  // the main checkout to it`. One init could not converge, and the run that DID converge changed the
  // user's working branch with a bracketed line as its only notice.
  //
  // ============================ WHAT THIS BLOCK IS (AND IS NOT) ============================
  // ⛔ NOT a second judgment path and NOT a relaxation of the pre-write gate: it re-runs the SAME
  // `ensureBranchModel` / `moveCheckoutOntoLandingBaseline` / `ensureDocBranch` primitives, in the
  // SAME order, that the NEXT `quay init` would have run — so one run now reaches the fixpoint two
  // runs used to (ADR-004: one judgment source, never a second predicate).
  //
  // Gated on `skipReason === "no-commits"` — a POSITION, never a keyword match on a prose detail
  // (hard rule 2). `not-a-git-worktree` is excluded on purpose: no commit this run makes can change
  // it, so re-judging would only re-print the same verdict. Every repo that already HAD a commit
  // keeps its pre-write verdict byte-identical — the common path is untouched.
  if (branchModel.skipReason === "no-commits") {
    const reJudged = ensureBranchModel(root, { adopt: opts.adoptBranchModel === true });
    // The verdict is replaced EITHER WAY: the pre-write report said only "SKIPPED … nothing to branch
    // from", so there is nothing in it to lose. What differs is whether the replacement is a VERDICT
    // or a still-withheld one.
    branchModel = reJudged;
    branchModelReport = formatBranchModelReport(reJudged);
    if (reJudged.skipReason !== null) {
      // Still unborn: this run's auto-commit did not create a commit (declined, skipped, or not a
      // repo). The verdict is genuinely WITHHELD, and `formatBranchModelReport` already renders it in
      // the NOT-EVALUATED shape — the one that names the remedy ("re-run once the repository has a
      // first commit"). ⛔ Never reshaped into the ok value (hard rule 3b).
      postWriteBranchModelFailure = null;
    } else if (!reJudged.ok) {
      // A refusal from the SECOND judgment. Argued unreachable — `develop` can only enter this branch
      // ABSENT (any resolvable `develop` would have made the pre-write probe return a real
      // classification instead of `no-commits`), and an absent role is CREATED at the default tip, so
      // it comes out `compatible`. Carried anyway because the alternative is to fall through and
      // report a refused landing baseline as a written config with exit 0 — the one thing the
      // pre-write arm exists to prevent (hard rule 3b).
      postWriteBranchModelFailure =
        "the branch model RE-JUDGED after the auto-commit created the repository's first commit is a " +
        "REFUSAL — this run's config is already on disk, and the landing baseline is not a continuation " +
        "of the project's default branch. Carry out the remedy above, then re-run init.";
    } else {
      // The baseline→checkout handoff, under the SAME two conditions the pre-write step uses (a
      // baseline (re)established by THIS judgment AND a ref rename with zero tree effect). A fresh
      // `git init -b main` reaches here with `develop` ABSENT ⇒ the call above just created it, and
      // without this the doc-branch judgment would read the unmoved checkout and truthfully report a
      // NO-OP — the exact silent no-op that handoff exists to end.
      // ⛔ A FAILED handoff is NOT swallowed: continuing would land in that same silent no-op, so the
      // failure rides the post-write channel instead (the pre-write step refuses with the same
      // failure — only the wording about the tree differs, because here the tree was already written).
      if (landingBaselineEstablishedNow(reJudged)) {
        const checkout = moveCheckoutOntoLandingBaseline(root);
        baselineCheckoutReport = formatBaselineCheckoutReport(checkout);
        if (!checkout.ok) {
          postWriteBranchModelFailure =
            "could not move the main checkout onto the landing baseline this run established — " +
            "refusing to report a converged branch model, because the doc-branch judgment below read " +
            "the UNMOVED checkout and its NO-OP would then be an artefact of the failed move, not a " +
            "statement about the project.";
        }
      }
      docBranch = ensureDocBranch(root, {
        name: docBranchName,
        adopt: opts.adoptBranchModel === true,
      });
      docBranchReport = formatDocBranchReport(docBranch);
      docBranchFields = {
        docBranch,
        docBranchReport,
        ...(baselineCheckoutReport !== null ? { baselineCheckoutReport } : {}),
      };
    }
  }

  return {
    outcome: isRebuild ? "rebuilt" : "written",
    configState: existing.state,
    // The rebuild's own facts: WHY the old file could not be read, and WHERE its bytes were kept.
    // Both are carried on the result so no caller has to re-derive them from stdout.
    ...(isRebuild ? { corruptReason: existing.reason, corruptBackupPath } : {}),
    configPath,
    tasksDir,
    content,
    launchSettingsPath,
    launchSettingsContent,
    profilesPath,
    profilesContent,
    branchModel,
    branchModelReport,
    ...docBranchFields,
    pluginLink,
    validated: freshVerdict.ok,
    ...(freshVerdict.ok ? {} : { validationIssues: freshVerdict.issues }),
    installSteps: installStepsText,
    ...(autoCommit ? { autoCommit } : {}),
    ...(postWriteBranchModelFailure !== null
      ? { postWriteBranchModelFailure }
      : {}),
    ...(gitignoreWarnings.length > 0 ? { failureDetail: gitignoreWarnings } : {}),
  };
}

// ── The ONE init report (AC-330) ────────────────────────────────────────────────────────────────────
//
// `quay init --json` and the MCP `init` tool must hand back the SAME document, and that document must
// answer the questions an operator (or a script) actually has: what happened, which keys were filled /
// migrated / removed, what was warned about, whether the result validated, and what the `.quay/plugin`
// retirement step did. Two builders would drift the moment one of them learned a new field — so there
// is ONE, and both surfaces call it.
export interface InitReport {
  /** The outcome token (`written` / `reconciled` / `unchanged` / `upgrade-invalid` / `dry-run` / …). */
  outcome: string;
  /** The three-state classification of the config BEFORE this run. */
  configState: ConfigState;
  /** The parser's own reason the config could not be read — `null` when it was readable. */
  corruptReason: string | null;
  /**
   * Where the unreadable bytes were preserved (`<configPath>.corrupt-<ts>`, byte-identical) — the
   * path a real run wrote to, or would write to under a dry run. `null` is a real reading ("no
   * backup"), never a stand-in for "not reported".
   */
  corruptBackupPath: string | null;
  /** True when nothing was written to disk. */
  dryRun: boolean;
  /**
   * The official validator's verdict on the config text this run produced/would produce.
   * `"not-evaluated"` when there was no candidate to judge.
   */
  validated: boolean | "not-evaluated";
  /** Validator issues (errors AND warnings) on the candidate — empty when it passed. */
  issues: ConfigIssue[];
  /** Operator-facing warnings — unrecognized top-level keys are kept, never silently dropped. */
  warnings: string[];
  configPath: string;
  tasksDir: string;
  /** `loop:` keys filled from the version defaults (absent before this run). */
  added: string[];
  /** `key: old -> new` rewrites from the declared migration table. */
  migrated: string[];
  /** Retired keys deleted. */
  removed: string[];
  /** `providers.native.env.*` carrier-dir pins backfilled. */
  pinned: string[];
  /** Keys deleted by `--drop-incompatible`. */
  dropped: string[];
  /** The four PROJECT-DERIVED `loop:` keys updated to this run's resolved values (AC-331). */
  projectValues: string[];
  /** Unrecognized top-level keys, PRESERVED and reported. */
  unknownKeys: string[];
  /** The `.quay/plugin` retirement step's outcome (three required + auxiliary states, see `PluginLinkOutcome`). */
  pluginLink: PluginLinkOutcome;
  /**
   * The STANDING doc-branch invariant after this run (`checkDocBranchInvariant`) — the same four
   * states the CLI renders as `doc-branch-invariant: <STATE>`, carried in the one JSON document so
   * a caller never has to parse prose to tell `pending` from `satisfied`.
   */
  docBranchInvariant: DocBranchInvariantReport;
  /** The generated config text — present only in a dry run (nothing else has a use for the bytes). */
  content?: string;
}

/**
 * Build the ONE init report from a `runInit` result. `dryRun` is passed in rather than read off the
 * result because an UPGRADE under `--dry-run` reports `reconciled`/`unchanged` (the same outcome
 * tokens as a real write), so the outcome alone cannot answer "did anything touch the disk".
 */
export function buildInitReport(result: InitResult, o: { dryRun: boolean }): InitReport {
  const issues = result.validationIssues ?? result.upgradeIssues ?? [];
  const unknownKeys = result.upgrade?.unknownKeys ?? [];
  const warnings = [
    ...unknownKeys.map((k) => `unrecognized top-level config key "${k}" — kept as-is (not deleted)`),
    ...(result.validated === false
      ? issues.filter((i) => i.severity === "error").map((i) => `candidate config did not validate: ${i.field} — ${i.message}`)
      : []),
  ];
  return {
    outcome: result.outcome,
    configState: result.configState,
    corruptReason: result.corruptReason ?? null,
    corruptBackupPath: result.corruptBackupPath ?? null,
    dryRun: o.dryRun,
    validated: result.validated,
    issues,
    warnings,
    configPath: result.configPath,
    tasksDir: result.tasksDir,
    added: result.upgrade?.added ?? [],
    migrated: result.upgrade?.migrated ?? [],
    removed: result.upgrade?.removed ?? [],
    pinned: result.upgrade?.pinned ?? [],
    dropped: result.upgrade?.dropped ?? [],
    projectValues: result.upgrade?.projectValues ?? [],
    unknownKeys,
    pluginLink: result.pluginLink,
    docBranchInvariant: result.docBranchInvariant,
    ...(o.dryRun ? { content: result.content } : {}),
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
 *
 * `workspaceRoot` is the RESOLVED root the run used (`InitResult.workspaceRoot`) — passed in, never
 * re-derived from `tasksDir`. The pre-fix body printed `dirname(dirname(tasksDir))`, which is the
 * workspace only while the tasks dir is literally `<root>/tasks`; on `quay init --root <subdir>` it
 * printed the PARENT of the workspace while the `Tasks dir:` line below named the real root, so the
 * summary contradicted itself
 * (gap-init-summary-workspace-ready-prints-parent-dir).
 */
export function printNextSteps(providerId: string, tasksDir: string, workspaceRoot: string): void {
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

  Workspace ready at: ${workspaceRoot}
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
// WHY NOT `runInit` ABOVE. `runInit` is the provider-map SCAFFOLDER: fresh install, in-place
// upgrade, branch model. The functions below are the shell entry's INCREMENTAL-UPGRADE steps — they edit an
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
  console.log("  wrote: .quay/config.yml loop: (repo_root/test_command/tmux_session/worktree_root updated, doc_surfaces filled when absent; 其余 loop 键保留— config 保留 增量升级)");
}

export interface ReconcileConfigFileOpts {
  cfgPath: string;
  dryRun: boolean;
}

/**
 * `reconcile_config` — the VERSION-LEVEL half of an upgrade, delivered by the SHELL entry too
 * (gap-quay-init-sh-upgrade-leaves-version-level-loop-defaults-unfilled).
 *
 * THE DEFECT THIS CLOSES (measured 2026-10-07, release rehearsal on 0.17.0): a project initialized
 * by 0.16.0 and then re-initialized by `bash quay-init.sh` from 0.17.0 had its `.quay/plugin` link
 * and provider binding migrated, but `quay config validate` still failed with
 * `loop.board — Missing required field` / `loop.gates — Missing required field`: those are VERSION-
 * LEVEL defaults (`LOOP_VERSION_DEFAULTS`), and the only things that delivered them to an existing
 * config were the CLI and the MCP `init` tool — never the script. `ensureLoopConfig`
 * above is deliberately the four project-DERIVED values and must stay so (its writer drops comments).
 * So the documented upgrade ("re-run /quay:init") left the official validator red until the user
 * discovered a third, hidden command.
 *
 * Same function the CLI/MCP upgrade uses (`reconcileConfigContent`) — ONE implementation, no second
 * copy: comment-preserving, per-key, and a no-op reconcile writes NOTHING (byte-identical config).
 *
 * NOT-EVALUATED is a voiced state, not a pass: an absent or unparseable config is REPORTED as such and
 * left untouched (salvaging a corrupt file is plain `quay init`'s state-based job — it rebuilds from
 * the version defaults and keeps the broken bytes beside the new file — not something a shell step
 * should decide silently).
 */
export function reconcileConfigFile(o: ReconcileConfigFileOpts): void {
  const cls = classifyConfig(o.cfgPath);
  if (cls.state !== "valid") {
    console.log(`  reconcile: NOT-EVALUATED — .quay/config.yml is ${cls.state}${cls.state === "corrupt" ? ` (${cls.reason})` : ""}; left untouched (run \`quay init\` in the project to rebuild it from this version's defaults)`);
    return;
  }
  const { content, report } = reconcileConfigContent(cls.raw ?? "");
  if (report.unchanged) {
    console.log("  unchanged: .quay/config.yml (already current for this version of quay — version-level defaults present, not rewritten)");
    return;
  }
  const lines = [
    ...report.added.map((k) => `loop.${k}`),
    ...report.migrated.map((m) => `loop.${m}`),
  ];
  if (o.dryRun) {
    console.log(`  would-reconcile: .quay/config.yml (${lines.join(", ")})`);
    return;
  }
  fs.writeFileSync(o.cfgPath, content, "utf8");
  console.log(`  reconciled: .quay/config.yml version-level defaults (${lines.join(", ")}); comments and every other key preserved`);
}

