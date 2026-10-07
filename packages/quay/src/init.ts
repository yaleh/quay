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
  type BranchModelReport,
  type DocBranchReport,
} from "./branch-model.ts";
// The ONE regex-literal escaper (kernel leaf). This file used to inline the escape body at the
// `key`-literal site — one of the spelling variants invisible to the previous sweep's byte needle
// (finding `escaperegexp-sweep-missed-two`, routine `semantic-dedup-scan`; see
// packages/quay/test/kernel-regex-escape.test.mjs ④).
import { escapeRegExp } from "./kernel/regex-escape.ts";
// The ONE plugin-tree resolver (gap-project-quay-pointer-is-init-plugin-root-and-version-records-
// derive-from-it): the project link's source-checkout guard reuses `isPluginSourceCheckout` so the
// "is this an install or a working tree" judgment cannot fork into two spellings.
import { isPluginSourceCheckout, resolvePluginRoot } from "./plugin-root.ts";
// The ONE binding judge (gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver):
// `verify_provider_runtime_existence`'s reader resolves the native provider's runtime file through
// the SAME function the runtime and the validator use, so an omitted binding is verified (from the
// plugin root) instead of silently skipped.
import { resolveProviderEntry, NATIVE_PROVIDER_UNRESOLVABLE } from "./config.ts";
// The ONE config judge (gap-init-single-engine-state-based-upgrade-validate-before-write AC3): the
// upgrade engine validates its candidate TEXT through the SAME `runChecks` pipeline
// `quay config validate` and MCP `config_validate` use — never a second copy of the checks.
import { validateConfigText, type ConfigIssue } from "./config-validate.ts";

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
   * The baseline→checkout handoff's report, present only when THIS run established `develop` at the
   * very commit the checkout was on and therefore moved the checkout onto it.
   */
  baselineCheckoutReport?: string;
  /**
   * The `.quay/plugin` link step's outcome for THIS run. Three states, never folded into a boolean
   * (硬规则 3b): `linked` (the link was refreshed), `not-evaluated` (the step RAN and could not
   * decide — an unknown or source-checkout plugin root) and `not-run` (this outcome path never
   * reaches the step, so nobody looked). "not-run" ≠ "not-evaluated": the first means no judgment was
   * attempted, the second means one was attempted and the input was undecidable.
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
}

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
 * Outcome of the `.quay/plugin` link step (see `InitResult.pluginLink`): the two readings
 * `refreshProjectPluginLink` can produce, plus `not-run` for the outcome paths that never reach the
 * step. ⛔ `not-run` is NOT `not-evaluated` — the first means nobody looked, the second means someone
 * looked and the input was undecidable (硬规则 3b: those must never share a value).
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
   * candidate validator's native-binding resolution, and used to refresh `<root>/.quay/plugin` AFTER
   * the config write succeeds (GOAL-029 ordering: a link pointing at a version whose config upgrade
   * failed would name a runtime the project is not configured for). Absent ⇒ the link step is
   * skipped (the shell's own `refresh-plugin-link` step still owns it until AC-331).
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
  /**
   * Allow the `.quay/plugin` guidance link to point at a SOURCE CHECKOUT (the dev tree) when the
   * target has NO link yet. ⛔ Default false: on an EXISTING project a source-checkout root must leave
   * the link untouched and report NOT-EVALUATED (gap-project-quay-pointer-is-init-plugin-root-and-
   * version-records-derive-from-it (A)) — a working tree is not an install, and silently re-pointing
   * a project at one would freeze it to uncommitted state. The FRESH-install arm is the one case where
   * nothing is being preserved and the closed set would otherwise be incomplete (AC-331 requires the
   * link), so the caller opts in explicitly.
   */
  allowSourceCheckoutLink?: boolean;
}

// These strings contain characters that confuse Node 26's TypeScript parser
// when embedded in template literals, so they are stored as raw strings.
const GH_TOKEN_REF = "$GITHUB_TOKEN";
const GH_TOKEN_SHELL_REF = "${GITHUB_TOKEN}";

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
    // ⛔ NO `path:` / NO `mcp_entry:` for the NATIVE provider (gap-project-quay-pointer-is-init-plugin-
    // root-and-version-records-derive-from-it (D), human ruling 2026-10-06): a declared path freezes
    // the runtime to the install-cache version that wrote it, so a plugin upgrade never takes effect.
    // Core resolves the native binding from its OWN plugin root (`plugin-root.ts`) — the single
    // resolver — and the shipped shell writer emits the same shape. The two fresh-install writers
    // disagreeing about these two keys is exactly the drift AC-331 removes.
    // (`mcpEntryForProvider` below remains the ONE chooser for a provider that DOES need a declared
    // entry — e.g. a custom or github provider — and is unit-tested directly.)
    "    tasks_dir: " + JSON.stringify(abs("tasks")),
    "    env:",
    "      QUAY_NATIVE_TASKS_DIR: " + JSON.stringify(abs("tasks")),
    "      QUAY_NATIVE_GOAL_DIR: " + JSON.stringify(abs("goals")),
    "      QUAY_NATIVE_ADR_DIR: " + JSON.stringify(abs("adr")),
    "      QUAY_NATIVE_META_DIR: " + JSON.stringify(abs("meta")),
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
    "  # routines:                    # uncomment to add periodic routines",
    "  #   - name: \"health-check\"",
    "  #     trigger: \"every(60)\"",
    "  #     probe: \"health\"",
    "",
    "# " + ruleLine(69),
    "# Section 4: Serve — the web server's bind binding (OPTIONAL, COMMENTED OUT)",
    "# " + ruleLine(69),
    "# The web server's bind host/port. ⛔ NOT WRITTEN: the uncommented defaults below are exactly the",
    "# values `resolveServeBinding` falls back to, so writing them would say nothing — and it made a",
    "# fresh install and an upgrade disagree about whether the section exists at all (AC-330).",
    "# Uncomment ONLY to pin your own values; the ones shown ARE the effective defaults.",
    "#",
    "# Exactly ONE reader: `resolveServeBinding` (packages/quay/src/serve-binding.ts). An explicit",
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
  let worktreeRoot = explicit.worktreeRoot && explicit.worktreeRoot !== "" ? explicit.worktreeRoot : readExistingLoopValue(configPath, "worktree_root");
  if (worktreeRoot === "") worktreeRoot = `${repoRoot}/../${path.basename(repoRoot)}-worktrees`;
  const wt = validateWorktreeRoot(worktreeRoot);
  if (!wt.ok) {
    return {
      ok: false,
      failure: {
        reason: `worktree root '${worktreeRoot}' is on tmpfs ('${wt.probe}' is tmpfs) — this is memory, not disk.`,
        detail: [
          "Every worktree under it consumes RAM; the 2026-08-04 machine-wide OOM traced straight to it.",
          `Change it to a real disk path — e.g. '${repoRoot}/../${path.basename(repoRoot)}-worktrees', or pass --worktree-root.`,
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
      pluginLink: { state: "not-run", reason: "init refused before the link step (nothing was written)" },
      validated: "not-evaluated",
    };
  }

  // ── The DOC-branch bootstrap (gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch)
  // ──
  // The same first step's second half: the branch-model entry ALSO created/switched the doc-only work
  // branch. Runs BEFORE any write, exactly as the shell's `set -e` abort did: a REFUSED doc branch (a
  // name collision) leaves the tree untouched rather than half-initialized.
  const existingLoop = (existing.config?.["loop"] ?? {}) as Record<string, unknown>;
  const configuredDocBranch =
    typeof existingLoop["doc_branch"] === "string" ? (existingLoop["doc_branch"] as string) : undefined;
  // Precedence, unchanged: explicit `--doc-branch-name` > the target's `loop.doc_branch` > the
  // `author` convention. ⛔ `author` rides an override-channel expression on purpose — a BARE
  // identity literal is what `target-identity-literal-check.ts` fails RED on, and a default with no
  // override would be one. `ensureDocBranch` invents no name of its own (see its header).
  const docBranchName = opts.docBranchName ?? configuredDocBranch ?? "author";
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
  const docBranch = ensureDocBranch(root, {
    name: docBranchName,
    dryRun: opts.dryRun === true,
    adopt: opts.adoptBranchModel === true,
  });
  const docBranchReport = formatDocBranchReport(docBranch);
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
  const docBranchFields = {
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
    // The `.quay/plugin` link refresh runs AFTER the config write succeeded (GOAL-029 ordering): a
    // link pointing at a version whose config upgrade failed would name a runtime the project is not
    // configured for. Only when the plugin root is known — the shell's own step still owns the link
    // until AC-331; an unknown root is SKIPPED here, and the outcome rides on `pluginLink` so the
    // JSON report can carry it (硬规则 3b: "skipped" is its own state, never folded into "linked").
    // ⛔ Its progress lines go through `opts.log`: on `--json` they must land on stderr, or they
    // corrupt the one JSON document stdout is promised to carry.
    const pluginLink: PluginLinkOutcome = opts.dryRun || !opts.pluginRoot
      ? {
        state: "not-run",
        reason: opts.dryRun
          ? "a dry run writes nothing, so the link step is not run"
          : "no plugin root was given for this run (CLAUDE_PLUGIN_ROOT / --plugin-root unset)",
      }
      : refreshProjectPluginLink({ wsRoot: root, pluginRoot: opts.pluginRoot, dryRun: false, log: opts.log });
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
      pluginLink: { state: "not-run", reason: "a dry run writes nothing, so the link step is not run" },
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
  const installStepsText = printInstallSteps();
  let autoCommit: AutoCommitReading | undefined;
  let pluginLink: PluginLinkOutcome = { state: "not-run", reason: "the run aborted before the link step" };
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

    // The `.quay/plugin` guidance link (AC-331): the CLI completes the closed set on its own.
    // `allowSourceCheckout: true` is the FRESH arm only — there is no existing link to preserve, and a
    // dev-tree run (the goal's own environment) would otherwise leave the closed set incomplete.
    const resolvedPluginRoot = opts.pluginRoot
      ?? (process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT !== "" ? process.env.CLAUDE_PLUGIN_ROOT : resolvePluginRoot());
    // ⛔ The source-checkout opt-in applies ONLY when the target has NO link yet. An EXISTING link is
    // the state the 2026-10-06 ruling protects (a working tree is not an install — re-pointing a
    // project at one would freeze it to uncommitted state), so it is left untouched and reported
    // NOT-EVALUATED no matter what the caller asked for.
    let linkExists = false;
    try {
      linkExists = fs.lstatSync(path.join(quayDir, "plugin")).isSymbolicLink();
    } catch {
      linkExists = false;
    }
    pluginLink = resolvedPluginRoot
      ? refreshProjectPluginLink({
        wsRoot: root,
        pluginRoot: resolvedPluginRoot,
        dryRun: false,
        log: say,
        allowSourceCheckout: opts.allowSourceCheckoutLink === true && !linkExists,
      })
      : { state: "not-run", reason: "no plugin root could be resolved (CLAUDE_PLUGIN_ROOT / --plugin-root / module location)" };

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
    ...(gitignoreWarnings.length > 0 ? { failureDetail: gitignoreWarnings } : {}),
  };
}

// ── The ONE init report (AC-330) ────────────────────────────────────────────────────────────────────
//
// `quay init --json` and the MCP `init` tool must hand back the SAME document, and that document must
// answer the questions an operator (or a script) actually has: what happened, which keys were filled /
// migrated / removed, what was warned about, whether the result validated, and what the `.quay/plugin`
// link did. Two builders would drift the moment one of them learned a new field — so there is ONE, and
// both surfaces call it.
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
  /** The `.quay/plugin` link step's outcome (three states, see `PluginLinkOutcome`). */
  pluginLink: PluginLinkOutcome;
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

export interface EnsureCarrierEnvOpts {
  cfgPath: string;
  wsRoot: string;
  dryRun: boolean;
}

export interface EnsureCarrierEnvTextOpts {
  wsRoot: string;
}

export interface CarrierEnvTextResult {
  /** The possibly-updated config text (byte-identical to the input when `pinned` is empty). */
  text: string;
  /** The keys appended, in the order they were appended. */
  pinned: Array<{ key: string; value: string }>;
  /** Why nothing was pinned — never silently absent (硬规则 3b: an unreadable shape is its own state). */
  note: null | "no-providers" | "no-native" | "inline-env";
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
 *
 * ⛔ This is the TEXT-ONLY half (gap-init-single-engine-state-based-upgrade-validate-before-write):
 * the upgrade engine edits an IN-MEMORY candidate, so the insert must be expressible as
 * text → text. `ensureProviderCarrierEnv` below is the file-writing wrapper over this ONE
 * implementation — there is no second copy of the line-level logic.
 */
// ── line-address helpers shared by EVERY text-level edit of `.quay/config.yml` ────────────────────
// These three are the whole addressing model for a comment-preserving edit: a `key:` is located by
// INDENTATION, never by a YAML round-trip (a round-trip reformats the file and drops the comments
// that document which providers exist and what each one needs).
//
// ⛔ Module scope, not closures inside one caller (硬规则 5b): `ensureProviderCarrierEnvText` and
// `switchEnabledProviderText` are two edits of the SAME file, and a second private copy of the
// indentation rules is exactly how the two would come to disagree about where a block ends.
function indentOf(s: string): number {
  return s.length - s.trimStart().length;
}

/** First index >= start+1 in `lines` that is non-blank with indent <= parentInd, else lines.length. */
function blockEnd(lines: string[], start: number, parentInd: number): number {
  let j = start + 1;
  while (j < lines.length) {
    if (lines[j]!.trim() && indentOf(lines[j]!) <= parentInd) return j;
    j++;
  }
  return lines.length;
}

/** [index, indent] of the first `key:` line in lines[start, end) at indent >= minIndent. */
function findChild(lines: string[], start: number, end: number, key: string, minIndent: number): [number, number] | null {
  const pat = new RegExp("^(\\s*)" + escapeRegExp(key) + "\\s*:");
  for (let i = start; i < end; i++) {
    const m = pat.exec(lines[i]!);
    if (m && m[1]!.length >= minIndent) return [i, m[1]!.length];
  }
  return null;
}

export function ensureProviderCarrierEnvText(text: string, o: EnsureCarrierEnvTextOpts): CarrierEnvTextResult {
  const lines = text.split("\n");
  const noop = (note: CarrierEnvTextResult["note"]): CarrierEnvTextResult => ({ text, pinned: [], note });

  // ── locate providers: → native: → env: by INDENTATION, not by a yaml round-trip ─────────────────
  const prov = findChild(lines, 0, lines.length, "providers", 0);
  if (!prov) return noop("no-providers");
  const native = findChild(lines, prov[0] + 1, blockEnd(lines, prov[0], prov[1]), "native", prov[1] + 1);
  if (!native) return noop("no-native");
  const nativeEnd = blockEnd(lines, native[0], native[1]);
  const env = findChild(lines, native[0] + 1, nativeEnd, "env", native[1] + 1);

  // ── collect the keys the env block already carries ──────────────────────────────────────────────
  const present: Record<string, string> = {};
  if (env) {
    const rest = lines[env[0]]!.slice(lines[env[0]]!.indexOf(":") + 1).trim();
    if (rest && !rest.startsWith("{")) return noop("inline-env");
    if (rest.startsWith("{")) {
      for (const m of rest.matchAll(/(QUAY_NATIVE_\w+)\s*:/g)) present[m[1]!] = "";
    } else {
      const keyRe = /^(\s*)(QUAY_NATIVE_\w+)\s*:\s*(.*)$/;
      for (let i = env[0] + 1; i < blockEnd(lines, env[0], env[1]); i++) {
        const m = keyRe.exec(lines[i]!);
        if (m && m[1]!.length > env[1]) present[m[2]!] = m[3]!.trim();
      }
    }
  }

  const missing = CARRIER_KINDS.filter(([k]) => !(k in present));
  if (missing.length === 0) return noop(null);

  const rawTasks = (present["QUAY_NATIVE_TASKS_DIR"] ?? "./tasks").trim().replace(/^["']|["']$/g, "");
  const absolute = rawTasks.startsWith("/") || rawTasks.startsWith("~");
  const valueFor = (kind: string): string => (absolute ? `${o.wsRoot}/${kind}` : `./${kind}`);
  const pinned = missing.map(([k, kind]) => ({ key: k, value: valueFor(kind) }));

  // ── append the missing keys to the END of the env block (or create the block, if absent) ────────
  const newLines = [...lines];
  let insertAt: number;
  let baseInd: number;
  let added: string[];
  if (!env) {
    insertAt = nativeEnd;
    baseInd = native[1] + 2;
    added = [" ".repeat(baseInd) + "env:", ...pinned.map((p) => `${" ".repeat(baseInd + 2)}${p.key}: "${p.value}"`)];
  } else {
    let last = env[0];
    for (let i = env[0] + 1; i < blockEnd(lines, env[0], env[1]); i++) {
      if (lines[i]!.trim()) last = i;
    }
    insertAt = last + 1;
    baseInd = env[1] + 2;
    added = pinned.map((p) => `${" ".repeat(baseInd)}${p.key}: "${p.value}"`);
  }
  newLines.splice(insertAt, 0, ...added);
  return { text: newLines.join("\n"), pinned, note: null };
}

/**
 * The FILE-writing wrapper over `ensureProviderCarrierEnvText` — the shell step's entry. Prints the
 * step's report lines (byte-identical to the pre-refactor output) and writes only when something
 * was actually pinned.
 */
export function ensureProviderCarrierEnv(o: EnsureCarrierEnvOpts): void {
  if (!fs.existsSync(o.cfgPath)) return;
  const res = ensureProviderCarrierEnvText(fs.readFileSync(o.cfgPath, "utf8"), { wsRoot: o.wsRoot });

  if (res.note === "no-providers") {
    console.log("  note: .quay/config.yml has no providers: section — carrier env pins not applicable (nothing written)");
    return;
  }
  if (res.note === "no-native") {
    console.log("  note: providers: has no native: entry — carrier env pins not applicable (nothing written)");
    return;
  }
  if (res.note === "inline-env") {
    console.error(
      "  note: providers.native.env has an unrecognized inline form — carrier env pins NOT applied " +
        "(add QUAY_NATIVE_ADR_DIR/QUAY_NATIVE_GOAL_DIR/QUAY_NATIVE_META_DIR by hand)",
    );
    return;
  }
  if (res.pinned.length === 0) {
    console.log("  unchanged: .quay/config.yml providers.native.env: (four carrier dirs already pinned — no rewrite, AC4)");
    return;
  }

  if (o.dryRun) {
    for (const p of res.pinned) {
      console.log(`  would-pin: providers.native.env.${p.key}: "${p.value}" (carrier dir pin — AC4)`);
    }
    return;
  }

  fs.writeFileSync(o.cfgPath, res.text, "utf8");
  for (const p of res.pinned) {
    console.log(`  pinned: .quay/config.yml providers.native.env.${p.key}: "${p.value}" (carrier dir pin — AC4)`);
  }
}

// ── `quay provider switch <name>` — the TEXT half of the enabled-provider flip ─────────────────────
// (gap-provider-switch-no-dedicated-entry-point). Before this, the ONLY writer of a provider's
// `enabled:` was `generateConfigContent` — a FRESH workspace. Switching an existing project from
// native to github (or back) meant hand-editing `.quay/config.yml` with no validation before or
// after, which is the缺口 this closes.
//
// Same discipline as `ensureProviderCarrierEnvText`: a LINE-LEVEL edit, never a YAML round-trip — a
// round-trip reformats every other key and drops the comments that tell the operator which providers
// exist and what each one needs. Only the `enabled:` lines that actually CHANGE are rewritten, so a
// switch that is a no-op produces a byte-identical string (the caller writes nothing).

/** Why the flip could not be expressed. An INDEPENDENT state, never conflated with "nothing to do". */
export type SwitchProviderNote = null | "no-providers" | "inline-providers" | "no-target";

export interface SwitchEnabledProviderResult {
  /** The candidate text (byte-identical to the input when `changed` and `added` are both empty). */
  text: string;
  /** The `enabled:` rewrites actually applied, in file order. */
  changed: Array<{ provider: string; from: string; to: "true" | "false" }>;
  /** Providers that carried no `enabled:` key and gained one (only ever the target). */
  added: string[];
  note: SwitchProviderNote;
}

/**
 * Make `target` the enabled provider in a `.quay/config.yml` TEXT: `enabled: true` on the target's
 * entry, `enabled: false` on every other entry that currently says otherwise.
 *
 * A provider entry with NO `enabled:` key is already disabled (the runtime reads `enabled === true`,
 * `activeProvider` in config.ts) — so it is left alone rather than being spelled out: an absent key
 * and an explicit `false` mean the same thing, and rewriting the absent one would put a line the
 * user never wrote into their file.
 */
export function switchEnabledProviderText(text: string, target: string): SwitchEnabledProviderResult {
  const lines = text.split("\n");
  const noop = (note: SwitchProviderNote): SwitchEnabledProviderResult => ({ text, changed: [], added: [], note });

  const prov = findChild(lines, 0, lines.length, "providers", 0);
  if (!prov) return noop("no-providers");
  // `providers: {native: {...}}` (a flow mapping) has no per-provider LINE to rewrite. Refusing is
  // the honest answer (硬规则 3b) — the alternative is a full re-serialization of the user's file.
  const provRest = lines[prov[0]]!.slice(lines[prov[0]]!.indexOf(":") + 1).trim();
  if (provRest !== "" && !provRest.startsWith("#")) return noop("inline-providers");

  // The provider entries are the block's DIRECT children — the smallest indent of a `key:` line
  // inside it. Deriving it (rather than assuming two spaces) keeps this edit working on a config
  // indented any other way.
  const provEnd = blockEnd(lines, prov[0], prov[1]);
  let childInd: number | null = null;
  for (let i = prov[0] + 1; i < provEnd; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^(\s*)[A-Za-z0-9_-]+\s*:/.exec(line);
    if (!m) continue;
    const ind = m[1]!.length;
    if (ind > prov[1] && (childInd === null || ind < childInd)) childInd = ind;
  }
  if (childInd === null) return noop("no-target");

  // Collect the entries FIRST (with their block extents), then apply the edits back-to-front: an
  // insert shifts every later index, and rewriting in reverse keeps every earlier index valid.
  const entries: Array<{ pid: string; start: number; end: number }> = [];
  for (let i = prov[0] + 1; i < provEnd; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^(\s*)([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (!m || m[1]!.length !== childInd) continue;
    entries.push({ pid: m[2]!, start: i, end: blockEnd(lines, i, childInd) });
  }
  if (!entries.some((e) => e.pid === target)) return noop("no-target");

  const out = [...lines];
  const changed: SwitchEnabledProviderResult["changed"] = [];
  const added: string[] = [];

  for (let n = entries.length - 1; n >= 0; n--) {
    const { pid, start, end } = entries[n]!;
    const want: "true" | "false" = pid === target ? "true" : "false";
    const at = findChild(out, start + 1, Math.min(end, out.length), "enabled", childInd + 1);
    if (!at) {
      if (pid !== target) continue; // no `enabled:` key ⇒ already disabled (see the doc comment above)
      out.splice(start + 1, 0, `${" ".repeat(childInd + 2)}enabled: ${want}`);
      added.push(pid);
      continue;
    }
    const [lineIdx, lineInd] = at;
    const rawValue = out[lineIdx]!.slice(out[lineIdx]!.indexOf(":") + 1);
    const hash = rawValue.indexOf("#");
    const valuePart = hash >= 0 ? rawValue.slice(0, hash) : rawValue;
    const current = valuePart.trim();
    if (current === want) continue;
    // The trailing comment AND the whitespace run before it are PRESERVED — on a real config that
    // comment is the sentence explaining why this provider is (or is not) the default, and the run
    // is what aligns it with the neighbouring lines. Dropping either would silently rewrite
    // documentation the edit was never asked to touch (and would make a switch-and-switch-back
    // non-byte-identical, which is the property the round-trip test pins).
    const pad = valuePart.slice(valuePart.trimEnd().length);
    out[lineIdx] = `${" ".repeat(lineInd)}enabled: ${want}${pad}${hash >= 0 ? rawValue.slice(hash) : ""}`;
    changed.push({ provider: pid, from: current, to: want });
  }

  changed.reverse(); // the edits were applied back-to-front; report them in FILE order
  return { text: out.join("\n"), changed, added, note: null };
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
  /**
   * Where the human-facing lines go (default `console.log`). ⛔ `quay init --json` must put ONE
   * parseable JSON document on stdout, so its caller passes a sink that writes to stderr — otherwise
   * this step's reporting would corrupt the machine-readable output it promises.
   */
  log?: (line: string) => void;
  /**
   * Permit a SOURCE-CHECKOUT plugin root as the link target. ⛔ Default false, and that default is the
   * 2026-10-06 ruling: a working tree is not an install, so an existing project's link is left
   * untouched and the step reports NOT-EVALUATED. `true` is for the FRESH-install arm only — there is
   * no link to preserve there, and the closed set would otherwise be incomplete (AC-331).
   */
  allowSourceCheckout?: boolean;
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
  const log = o.log ?? ((line: string) => console.log(line));
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
    if (isPluginSourceCheckout(root) && o.allowSourceCheckout !== true) {
      return { state: "not-evaluated", reason: `${root} is a source checkout (dev tree), not an installed plugin` };
    }
    return { state: "linked", pluginRoot: root, version: readPluginRootVersion(root) };
  };
  const reading = decide();

  if (reading.state === "not-evaluated") {
    log(`  project-plugin-link: NOT-EVALUATED — ${reading.reason} (existing link left unchanged)`);
    return reading;
  }

  if (existing && !existing.isSymbolicLink()) {
    log(`  project-plugin-link: REFUSED — ${linkPath} exists and is not a symlink (left unchanged)`);
    return { state: "not-evaluated", reason: `${linkPath} exists and is not a symlink` };
  }

  if (o.dryRun) {
    log(
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
  log(`  linked: .quay/plugin -> ${reading.pluginRoot} (v${reading.version ?? "?"} — the plugin root this init ran from)`);
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
  /**
   * Where the human-facing report lines go (default `console.log`). ⛔ The CLI's `--json` mode MUST
   * pass a stderr sink: stdout carries exactly ONE JSON document, and these lines would otherwise
   * splice themselves into it.
   */
  log?: (line: string) => void;
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
  const say = o.log ?? ((line: string) => console.log(line));
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
      say(`  would-retire-orphan-runtime: ${rtDir} -> ${dest} (retired layout, unreferenced, stale vs this delivery — AC1)`);
    } else {
      fs.mkdirSync(backupDir, { recursive: true });
      let n = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(backupDir, `runtime-${n}`);
        n++;
      }
      fs.renameSync(rtDir, dest);
      say(`  retired-orphan-runtime: ${rtDir} -> backup ${dest} (retired layout, unreferenced, stale vs this delivery — AC1)`);
    }
  } else if (rtState === "retire") {
    say(`  kept-referenced-runtime: ${rtDir} (still referenced by the provider binding — NOT retired)`);
  } else if (rtState === "keep") {
    say(`  kept-runtime-copy: ${rtDir} (byte-identical to this delivery — untouched, AC3)`);
  } else if (rtState === "unknown") {
    say(`  kept-unrecognized-runtime-dir: ${rtDir} (not quay's install-generated runtime shape — never touched)`);
  }

  if (!changed) return;
  const note = "the native provider is resolved from the plugin root, so the config carries no path";
  if (o.dryRun) {
    for (const m of removed) say(`  would-remove: ${m} (${note})`);
    return;
  }
  fs.writeFileSync(o.cfgPath, stripped.text, "utf8");
  for (const m of removed) say(`  removed: ${m} (${note})`);
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
 * The COMPLETE laydown-set derivation — the TS home of `quay-init.sh`'s `_derive_loop_scripts_once`
 * (+ its stability-checked `derive_loop_scripts` wrapper). Ported verbatim so the shell's derivation
 * helpers (and the library-mode `source` contract they served) can be DELETED
 * (gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script AC4/AC5):
 * `plugin/scripts/laydown-set-check.sh` — the sole remaining consumer — now calls this through the
 * step CLI instead of sourcing the installer.
 *
 * The set is the union of FOUR sources, so there is no second hand-maintained copy to drift:
 *   (a) prefix-derived — every `plugin/scripts/<name>` reference in ALL shipped skills + loop docs +
 *       delivered workflows (a delivered workflow calling a script makes it a required landing);
 *   (b) bare-resolved  — every BARE `<name>.<ext>` token in the MECHANISM corpus (the cold-start skill
 *       + the loop tick docs) that exists under `<pluginRoot>/scripts/`;
 *   (c) explicit       — the mechanism files the docs name with NO path at all, plus the checkers'
 *       ESM-`./` transitive deps (invisible to the `${SCRIPT_DIR}/` closure), plus the self-describing
 *       capability catalog and the L1/L2 delivery-surface checkers;
 *   (c2/c3) consolidated grouped-entry members and the three exec-core tick docs;
 *   (d) closure        — every `${SCRIPT_DIR}/<sibling>` reference, repeated to a fixpoint.
 * `archive/**` is excluded: a doc-referenced script moved to `archive/<date>/…` is no longer part of
 * the live set (restore re-registers it).
 *
 * STABILITY CHECK (gap-quay-init-torn-read-derive-loop-scripts): the derivation greps the shipped
 * corpus, and under heavy load a killed grep/sort returns a PARTIAL (torn) set — which then lays
 * fewer scripts than the docs reference. Two independent passes must agree, retried up to three
 * times; the last snapshot is returned when they never do (a torn set is caught downstream by the
 * referenced-not-landed gate).
 */
export function deriveLoopScripts(o: { pluginRoot: string; neverLaydown: string }): { names: string[]; stable: boolean } {
  const never = new Set(o.neverLaydown.split(/\s+/).filter(Boolean));
  return stableDerivation(() => deriveLoopScriptsOnce(o.pluginRoot, never));
}

/**
 * The installer itself is never a laydown member: it is the script DOING the laying down, and a
 * target that received a copy of it would be carrying a second installer. The default lives here so
 * the gate does not have to name it — a consumer that must spell the installer's path is a consumer
 * that still reads as depending on it.
 */
export const DEFAULT_NEVER_LAYDOWN = "quay-init.sh";

/** Retry the derivation until two independent passes agree (see `deriveLoopScripts`). */
function stableDerivation(once: () => string[]): { names: string[]; stable: boolean } {
  let last: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = once();
    const b = once();
    if (a.length > 0 && a.join("\n") === b.join("\n")) return { names: a, stable: true };
    last = a;
  }
  return { names: last, stable: false };
}

function listFilesSafe(patternDir: string, filter: (name: string) => boolean): string[] {
  try {
    return fs.readdirSync(patternDir).filter(filter).map((n) => path.join(patternDir, n));
  } catch {
    return [];
  }
}

/** One derivation pass — steps (a)+(b)+(c)+(c2)+(c3) + the archive filter + the (d) closure. */
function deriveLoopScriptsOnce(pluginRoot: string, never: Set<string>): string[] {
  const read = (p: string): string => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  const names = new Set<string>();

  // (a) prefix-derived over the FULL corpus — shipped skills, loop docs, AND delivered workflows.
  const aFiles = [
    ...listFilesSafe(path.join(pluginRoot, "skills"), () => true).flatMap((d) => listFilesSafe(d, (n) => n === "SKILL.md")),
    ...listFilesSafe(path.join(pluginRoot, "loop"), (n) => n.endsWith(".md")),
    ...listFilesSafe(path.join(pluginRoot, "workflows"), (n) => n.endsWith(".js")),
  ];
  for (const f of aFiles) {
    for (const m of read(f).matchAll(/plugin\/scripts\/([a-zA-Z0-9._-]+)/g)) names.add(m[1]!);
  }

  // (b) bare-resolved over the MECHANISM corpus (cold-start skill + the loop tick docs).
  const mechFiles = [
    path.join(pluginRoot, "skills", "cold-start", "SKILL.md"),
    ...listFilesSafe(path.join(pluginRoot, "loop"), (n) => n.endsWith(".md")),
  ].filter((f) => fs.existsSync(f));
  for (const f of mechFiles) {
    for (const m of read(f).matchAll(/(^|[^/a-zA-Z0-9._-])([a-zA-Z0-9._-]+\.[a-zA-Z0-9]+)/g)) {
      const tok = m[2]!;
      if (never.has(tok)) continue;
      if (!fs.existsSync(path.join(pluginRoot, "scripts", tok))) continue;
      names.add(tok);
    }
  }

  // (c) explicit additions — bare-name mechanism files the docs never spell with a path, the
  //     checkers' ESM-`./` transitive deps (invisible to the `${SCRIPT_DIR}/` closure below), the
  //     capability catalog, and the L1/L2 delivery-surface checkers. Each entry's REASON lives in the
  //     shell file's own header before the retirement; the list itself is data, not prose.
  for (const explicit of [
    "inner-idle-log.ts", "it0-split-or-commit-check.ts", "pipe-exit-code-check.sh",
    "gate-script-base.ts", "workflow-event-schema.mjs", "task-schema.ts", "task-ops.ts",
    "shape-sections.ts", "regex-escape.ts", "touches-parser.ts", "task-status.ts",
    "wiring-coverage-check.ts", "capability-catalog.sh", "l1-delivery-surface-check.ts",
    "dead-loop-check.sh", "inner-blocked-signal.ts", "inner-forensics.mjs",
    "task-contract-check.ts", "task-status-drift-check.ts", "touches-orthogonality-check.ts",
    "verify-delivery-surface.ts", "precommit-guard.ts", "touches-one-entry-one-path-check.ts",
    "quay-session.ts", "repo-root.sh", "repo-root.ts", "checker-io.ts", "driver-result.ts",
    "canonical-test-files.ts", "suite-params.ts", "over90-task-gate.ts", "semantic-trigger.ts",
    "main-thread-edit-check.ts", "per-file-cpu-report.mjs",
  ]) names.add(explicit);

  // (c2) consolidated grouped-entry members: `name: "X", file: "Y"` declarations in `quay-*.ts`.
  for (const f of listFilesSafe(path.join(pluginRoot, "scripts"), (n) => n.startsWith("quay-") && n.endsWith(".ts"))) {
    for (const m of read(f).matchAll(/name: "[a-zA-Z0-9._-]+", file: "([a-zA-Z0-9._-]+)"/g)) {
      const member = m[1]!;
      if (never.has(member)) continue;
      if (!fs.existsSync(path.join(pluginRoot, "scripts", member))) continue;
      names.add(member);
    }
  }

  // (c3) the exec-core tick docs (shipped from plugin/loop/, laid into orchestration/).
  for (const tick of ["orchestrator-tick-core.md", "fast-mode-tick-core.md", "manager-tick-core.md"]) names.add(tick);

  // archive/** exclusion: a doc-referenced script that has been archived is no longer part of the set.
  const archiveDir = path.join(pluginRoot, "..", "archive");
  if (fs.existsSync(archiveDir)) {
    const archived = new Set<string>();
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else archived.add(e.name);
      }
    };
    try {
      walk(archiveDir);
    } catch {
      /* unreadable archive ⇒ no exclusion, the safe direction (lays MORE, never fewer) */
    }
    for (const name of [...names]) if (archived.has(name)) names.delete(name);
  }

  // (d) dependency closure to a fixpoint — the same single implementation the shell step uses.
  const tmp = path.join(os.tmpdir(), `quay-laydown-derive-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmp, [...names].sort().map((x) => x + "\n").join(""), "utf8");
  try {
    deriveLoopScriptsClosure({ outPath: tmp, pluginRoot, neverLaydown: [...never].join(" ") });
    return fs.readFileSync(tmp, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
  }
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

/**
 * The explicit install steps. `enabledPlugins` only toggles an ALREADY-INSTALLED plugin and an
 * untrusted directory's project settings are not read at all, so "config committed ⇒ auto-installed"
 * is FALSE (SPEC §6 T3). The text must say so, must carry the FULL single-`<source>` recipe (the
 * two-arg form is rejected outright by the CLI), and must present `--scope` as the caller's choice
 * rather than pushing `project` as the only correct value.
 */
export function printInstallSteps(): string {
  return [
    "",
    "━━━ quay plugin install steps (explicit — config does NOT auto-install) ━━━",
    "The files just written ENABLE the quay plugin for this project, but they DO NOT install it.",
    "`enabledPlugins` only toggles an ALREADY-INSTALLED plugin, and an untrusted directory's project",
    "settings are not read at all — so \"config committed => auto-installed\" is FALSE. Install it first:",
    "",
    "  # 1. register the PUBLISHED marketplace source — the github channel. The CLI takes exactly ONE",
    "  #    <source> argument: `marketplace add <name> <source>` is rejected outright.",
    "  claude plugin marketplace add yaleh/quay",
    "",
    "  # 2. install it, at the scope YOU choose (⛔ `claude plugin install` defaults to `user`, so pass",
    "  #    --scope explicitly — but the VALUE is yours):",
    "  #      --scope user     one version for every project on this machine; upgrade once, here",
    "  #      --scope project  a per-project switch, version pinned in <cwd>/.claude/settings.json",
    "  #      --scope local    this working copy only, not committed",
    "  claude plugin install quay@quay --scope <user|project|local>",
    "",
    "  # (or the npm-global path: `npm install -g quay` — its register-plugin.mjs postinstall registers",
    "  #  the marketplace source only; pass QUAY_PLUGIN_SCOPE=user|project|local to enable it in the same run)",
    "  #",
    "  # 3. UPGRADE LATER — IN PLACE, at the scope that already holds the record (⛔ never `uninstall`",
    "  #    then `install --scope ...`: that replaces the record you have):",
    "  #      claude plugin list --json | jq -r '.[] | select(.id==\"quay@quay\") | .scope' | sort -u",
    "  #      claude plugin update quay@quay --scope <the scope just printed>",
    "  #    then re-run /quay:init so `.quay/plugin` re-points at the new version's directory.",
    "",
    "  # 4. accept the trust dialog the FIRST time you enter this directory, then restart the session.",
    "After that, the enabledPlugins block below takes effect (a restart is required to apply).",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
  ].join("\n");
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
