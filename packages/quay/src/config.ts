// Reads .quay/config.yml — per-workspace config: which Providers are
// enabled, storage paths / credentials (quay-proposal.md §10). Travels with
// the user's project (distinct from provider.yml, which travels with the
// Provider code).

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

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

export function activeProvider(cfg, id) {
  const providers = cfg.config.providers ?? {};
  if (id) {
    if (!providers[id]) throw new Error(`no such provider "${id}" in .quay/config.yml`);
    return { id, ...providers[id] };
  }
  const enabledId = Object.keys(providers).find((pid) => providers[pid].enabled);
  if (!enabledId) throw new Error("no enabled provider in .quay/config.yml");
  return { id: enabledId, ...providers[enabledId] };
}
