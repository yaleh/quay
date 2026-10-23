// Reads .quay/config.yml — per-workspace config: which Providers are
// enabled, storage paths / credentials (quay-proposal.md §10). Travels with
// the user's project (distinct from provider.yml, which travels with the
// Provider code).

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { resolvePluginRoot } from "./plugin-root.ts";

export function findConfig(startDir = process.cwd()) {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, ".quay", "config.yml");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadConfig(startDir = process.cwd()) {
  const configPath = findConfig(startDir);
  if (!configPath) {
    throw new Error(
      "no .quay/config.yml found (searched from " + startDir + " upward). Run in a workspace with .quay/config.yml."
    );
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const config = YAML.parse(raw);
  const workspaceRoot = path.dirname(path.dirname(configPath));
  return { config, configPath, workspaceRoot };
}

/**
 * Returns a provider's launch info.
 *
 * v0 default (single-provider) behavior is preserved: with no `id` argument,
 * returns the first *enabled* provider. Iteration 4 (QN-002 execution) adds
 * explicit selection by id — `quay --provider <id> ...` — so the Core CLI
 * can be pointed at either `native` or `github` without any code change
 * (proposal §5: "the consumer layer needs zero changes" to add a Provider).
 * Explicit-id selection does not require the provider to be `enabled: true`
 * in config — enabled/disabled only affects the *default* pick.
 */
/**
 * Returns the `.quay/config.yml` `loop:` section — the three target-project values
 * (repo_root / test_command / tmux_session) that `quay-init --loop` writes as the single
 * config source for the two-layer loop (SPEC AC2/AC3). Returns null when absent.
 *
 * gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them: install is
 * configuration-driven, not text-substitution — laid-down files are byte-identical to the
 * product (SPEC AC1) and scripts / tick docs READ these values at runtime instead of having
 * them baked in at install. `loop.test_command` is the value that would previously have been
 * text-substituted for `scripts/test.sh` in the laid-down tick docs.
 */
export function readLoopConfig(startDir = process.cwd()) {
  try {
    const { config } = loadConfig(startDir);
    const loop = config.loop;
    if (loop && typeof loop === "object") return loop;
  } catch {
    // no .quay/config.yml found — no loop config to read
  }
  return null;
}

// ── The `release:` section — the DECLARED release-branch model ───────────────────────────────────
//
// THE DEFECT THIS CLOSES (gap-release-branch-model-hardcoded-not-configurable): quay's release
// branch model (which branch releases advance, which branch they are cut from, which branch names
// are release-shaped, what a version tag looks like, who advances the line) lived only as literals
// in quay's own private scripts. A second quay-driven project could not DECLARE its own model, so
// it could not check the invariant "the release line is never committed to directly and stops at
// the most recent fully-green release". The invariant converges; the mechanism does not — a project
// may use a single `main`, a `release/*` train, or hotfix branches.
//
// THREE-STATE RESOLUTION, never two (hard rule 3b):
//   configured  — the section is present and readable; `config` is what it declares.
//   default     — no `.quay/config.yml`, or no `release:` key at all. `config` is the historical
//                 model the shipped carriers have always used, and `source` says so. ⛔ This is NOT
//                 "configured": the release MODEL meter reports it as `not-configured`, not a pass.
//   unreadable  — the section is present but does not have the declared shape. ⛔ Never silently
//                 replaced by the defaults: "I could not read what you declared" must not look like
//                 "you declared the default" (hard rule 3b).
export type ReleaseAdvance = "ci" | "manual" | "none";

export interface ReleaseConfig {
  /** The branch releases ADVANCE (the line that must stand at the most recent green release). */
  line: string;
  /** The branch releases are cut FROM and merged back into. */
  baseline: string;
  /** Glob patterns that name a release-shaped branch (e.g. `release/*`, `release-*`). */
  globs: string[];
  /** The prefix of a version tag (`v` for `v1.2.3`; `""` for `1.2.3`). */
  tag_prefix: string;
  /** Who is allowed to advance `line`. `ci` = only a fully-green release run (the release.yml
   *  `advance-master` needs: invariant); `manual`/`none` = the meter does not judge an advancer. */
  advance: ReleaseAdvance;
}

export const RELEASE_ADVANCE_VALUES: readonly ReleaseAdvance[] = ["ci", "manual", "none"];

/** The historical model the shipped carriers used before this section existed. Kept in ONE place so
 *  the carriers' backward-compatible fallback and the meter's `not-configured` reading cannot drift
 *  apart. */
export const RELEASE_CONFIG_DEFAULTS: Readonly<ReleaseConfig> = Object.freeze({
  line: "master",
  baseline: "develop",
  globs: Object.freeze(["release/*", "release-*"]),
  tag_prefix: "v",
  advance: "ci",
}) as Readonly<ReleaseConfig>;

export type ReleaseConfigResolution =
  | { state: "configured"; config: ReleaseConfig; configPath: string; source: "config" }
  | { state: "default"; config: ReleaseConfig; configPath: string | null; source: "default" }
  | { state: "unreadable"; reason: string; configPath: string | null };

/**
 * Judge ONE raw `release:` value (already YAML-parsed). THE single shape judge — the runtime reader,
 * `config-validate`, and the shipped `release-model-check.ts` meter all ask THIS question, so a
 * config that one accepts and another rejects is impossible by construction.
 *
 * This judges a PRESENT value only: absence (`undefined`) is the caller's decision (carriers treat
 * it as the historical default, the meter as `not-configured`), while a present-but-empty key
 * (`release:` with no body ⇒ `null`) is a shape error — "declared nothing" must not silently read
 * as "declared the default".
 */
export function parseReleaseConfig(
  raw: unknown
): { ok: true; config: ReleaseConfig } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: false, reason: "`release:` is absent (the caller decides what absence means)" };
  if (raw === null) return { ok: false, reason: "`release:` is empty — declare line/baseline/globs/tag_prefix/advance, or remove the key" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "`release:` must be a mapping" };
  }
  const r = raw as Record<string, unknown>;
  const str = (key: string): string | null => {
    const v = r[key];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };
  const line = str("line");
  const baseline = str("baseline");
  const tagPrefix = r["tag_prefix"] === undefined
    ? RELEASE_CONFIG_DEFAULTS.tag_prefix
    : typeof r["tag_prefix"] === "string"
      ? (r["tag_prefix"] as string)
      : null;
  const advance = r["advance"] === undefined ? RELEASE_CONFIG_DEFAULTS.advance : r["advance"];
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
      if (typeof g !== "string" || g.trim() === "") {
        return { ok: false, reason: "`release.globs` entries must be non-empty strings" };
      }
    }
  }
  const unknown = Object.keys(r).filter((k) => !["line", "baseline", "globs", "tag_prefix", "advance"].includes(k));
  if (unknown.length > 0) {
    return { ok: false, reason: `unknown \`release:\` key(s): ${unknown.join(", ")}` };
  }
  return { ok: true, config: { line, baseline, globs, tag_prefix: tagPrefix, advance: advance as ReleaseAdvance } };
}

/**
 * Resolve the workspace's DECLARED release model. Never throws, never conflates the three states.
 * `startDir` is searched upward for `.quay/config.yml` exactly like `loadConfig`.
 */
export function readReleaseConfig(startDir = process.cwd()): ReleaseConfigResolution {
  let configPath: string | null = null;
  try {
    configPath = findConfig(startDir);
  } catch {
    configPath = null;
  }
  if (!configPath) {
    return { state: "default", config: { ...RELEASE_CONFIG_DEFAULTS, globs: [...RELEASE_CONFIG_DEFAULTS.globs] }, configPath: null, source: "default" };
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    return { state: "unreadable", reason: `config.yml did not parse: ${(err as Error)?.message ?? String(err)}`, configPath };
  }
  const section = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).release : undefined;
  if (section === undefined) {
    return { state: "default", config: { ...RELEASE_CONFIG_DEFAULTS, globs: [...RELEASE_CONFIG_DEFAULTS.globs] }, configPath, source: "default" };
  }
  const judged = parseReleaseConfig(section);
  if ("reason" in judged) return { state: "unreadable", reason: judged.reason, configPath };
  return { state: "configured", config: judged.config, configPath, source: "config" };
}

export function activeProvider(cfg, id, pluginRoot = resolvePluginRoot()) {
  const providers = cfg.config.providers ?? {};
  if (id) {
    if (!providers[id]) throw new Error(`no such provider "${id}" in .quay/config.yml`);
    return withNativeDefaults(id, { id, ...providers[id] }, pluginRoot);
  }
  const enabledId = Object.keys(providers).find((pid) => providers[pid].enabled);
  if (!enabledId) throw new Error("no enabled provider in .quay/config.yml");
  return withNativeDefaults(enabledId, { id: enabledId, ...providers[enabledId] }, pluginRoot);
}

/**
 * The stable error code for a native provider whose `path`/`mcp_entry` were omitted (a SUPPORTED
 * form — Core derives both from the plugin root) while NO plugin root could be resolved. A named
 * code, never a bare crash: "could not resolve this" must be readable as such (硬规则 3b).
 */
export const NATIVE_PROVIDER_UNRESOLVABLE = "native-provider-unresolvable";

/** True iff `entry.mcp_entry` is a usable launch argv (a non-empty array). */
function hasMcpEntry(entry) {
  return Array.isArray(entry?.mcp_entry) && entry.mcp_entry.length > 0;
}

/**
 * Resolve ONE provider entry to its effective launch info — the SINGLE judge of the question "does
 * this provider have a launchable `mcp_entry`?". The runtime (`activeProvider` → `withNativeDefaults`),
 * the validator (`config-validate.ts`) and the launch paths (`providerMcpEntry`) all read THIS
 * function, so the two裁判 cannot drift (the defect this exists to close: the validator re-derived
 * the answer from the raw YAML and demanded an `mcp_entry` the runtime does not need).
 *
 * `pluginRoot` is injectable so a caller (a test, or a fixture) can reproduce "the plugin root is
 * unresolvable" by passing `null` without moving this module. Omitted/undefined ⇒ the real resolver.
 *
 * Returns `{ entry, mcpEntry, unresolvable }`: `mcpEntry` is null when the entry names no launchable
 * argv (never conflated with "fine"), and `unresolvable` marks the native-omitted case where no
 * plugin root could supply the default.
 */
export function resolveProviderEntry(providerId, entry, pluginRoot = resolvePluginRoot()) {
  if (providerId !== "native") {
    return { entry, mcpEntry: hasMcpEntry(entry) ? entry.mcp_entry : null, unresolvable: false };
  }
  if (!pluginRoot) {
    // ⛔ Never invent a path that was not asked for (硬规则 3b): the omitted binding stays absent and
    // the caller reports it (providerMcpEntry throws the stable code; the validator emits it).
    return { entry, mcpEntry: hasMcpEntry(entry) ? entry.mcp_entry : null, unresolvable: !hasMcpEntry(entry) };
  }
  const dir = path.join(pluginRoot, "vendor", "quay-native");
  const out = { ...entry };
  if (typeof out.path !== "string" || out.path === "") out.path = dir;
  if (!hasMcpEntry(out)) {
    out.mcp_entry = ["node", path.join(dir, "dist", "quay-native.js"), "mcp"];
  }
  return { entry: out, mcpEntry: out.mcp_entry, unresolvable: false };
}

/**
 * The launch argv for a RESOLVED provider — or a THROW carrying a stable `code`.
 *
 * The three launch paths (`mcp-server.ts`, `cli/shared.ts`, `serve.ts`) read this instead of
 * destructuring `provider.mcp_entry` directly: destructuring `undefined` yields a bare
 * `TypeError: … is not iterable`, which is indistinguishable from a crash and names nothing
 * (硬规则 3b). The error message always contains the code so a caller/CI can grep for it.
 */
export function providerMcpEntry(provider) {
  if (hasMcpEntry(provider)) return provider.mcp_entry;
  const isNative = provider?.id === "native";
  const err: Error & { code?: string } = new Error(
    isNative
      ? `${NATIVE_PROVIDER_UNRESOLVABLE}: provider "native" omits path/mcp_entry (Core resolves them ` +
        `from the plugin root) but no plugin root could be resolved. Re-run /quay:init from an ` +
        `installed plugin, set QUAY_PLUGIN_ROOT, or declare mcp_entry explicitly.`
      : `enabled provider "${provider?.id ?? "?"}" is missing mcp_entry (must be a non-empty array)`,
  );
  err.code = isNative ? NATIVE_PROVIDER_UNRESOLVABLE : "provider-missing-mcp-entry";
  throw err;
}

/**
 * Fill the native provider's launch info from the plugin tree when the config omits `path`/
 * `mcp_entry` (gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it (D)).
 *
 * WHY the config no longer carries them: a `path` in the config is a BINDING (it decides behavior),
 * and binding it to a link or a versioned directory froze the provider to whatever quay-init resolved
 * at install time. Core can resolve the native provider from its OWN install location — that is what
 * `plugin-root.ts` exists for — so the binding is removed and the resolution is relocated to where it
 * cannot go stale.
 *
 * ⛔ Only `native` gets a default: a custom provider (`github`, a dev checkout, anything with its own
 * tree) MUST name its own `path`/`mcp_entry`, and its config is left exactly as written. An
 * unresolvable plugin root also leaves the entry as-is — the caller's existing "no mcp_entry" error
 * path is the honest reading (硬规则 3b: never invent a path that was not asked for).
 */
export function withNativeDefaults(providerId, entry, pluginRoot = resolvePluginRoot()) {
  return resolveProviderEntry(providerId, entry, pluginRoot).entry;
}
