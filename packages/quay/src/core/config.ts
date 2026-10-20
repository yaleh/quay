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
