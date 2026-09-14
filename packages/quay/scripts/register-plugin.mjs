#!/usr/bin/env node
// register-plugin.mjs — register the INSTALLED quay plugin with Claude Code.
//
// Gap: `npm install -g quay-*.tgz` landed the package (and its plugin/ bundle)
// under $(npm root -g)/quay, but nothing told Claude Code about it — so after a
// clean install the canonical entry point `/quay:init` did not exist in a Claude
// Code session (measured on two machines: npm-root plugin dir present, referenced
// by ~/.claude/settings.json on neither; dev-tree and bare-name refs on the two).
// This hook is the missing registration step.
//
// Mechanism (matching a machine whose config is known-good): write the installed
// plugin directory as a Claude Code DIRECTORY marketplace source and materialize the
// MARKETPLACE via the CLI. It does NOT write a user-level enabledPlugins entry —
// enabling is left to the target project's <repo>/.claude/settings.json (AC-161).
//
// SCOPE POLICY (AC-161; re-fixed 2026-09-14 by
// gap-ac161-postinstall-rematerializes-user-scope-enable): the user level carries
// ONLY the marketplace source. The enable step is therefore OFF by default:
// `claude plugin install` defaults to `--scope user` (measured against Claude Code
// 2.1.271), so calling it unconditionally wrote a user-level
// `enabledPlugins["quay@quay"]` and re-reddened the STANDING goal AC-161 on every
// real global install. Set `QUAY_PLUGIN_SCOPE=user|project|local` to opt in
// explicitly (documented in README) — e.g. a deliberate user-scope install.
//
//   "extraKnownMarketplaces": { "quay": { "source": { "source": "directory", "path": "<installed>/quay/plugin" } } }
//
// The directory must contain `.claude-plugin/marketplace.json` + `plugin.json`;
// the shipped tarball carries both (verified at pack time, AC16), so the
// installed artifact is itself a legal directory marketplace — it only lacked the
// registration. Nothing in this file hand-edits any other settings key.
//
// Guard rails:
//   * Runs ONLY on a GLOBAL install (npm_config_global === "true"). During a
//     monorepo dev `npm install` npm runs every workspace's postinstall too; that
//     must NOT rewrite the user's ~/.claude/settings.json to point at a dev-tree
//     path (that exact failure — a settings entry referencing a deleted dev tree —
//     is what this gap measured on machine B).
//   * `QUAY_SKIP_PLUGIN_REGISTER=1` opts out (documented in README) — the only
//     supported way to install quay for the CLI alone.
//   * `QUAY_PLUGIN_SCOPE` is the ONLY way to get a user-level enable out of this
//     script; unset (or any unrecognized value) means "register the marketplace,
//     enable nothing".
//   * FAILS CLOSED on a genuine error (missing bundle, unparsable settings.json,
//     unwritable home) rather than silently producing a broken install.

import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(pkgRoot, "plugin");
const marketplaceJson = path.join(pluginDir, ".claude-plugin", "marketplace.json");
const pluginJson = path.join(pluginDir, ".claude-plugin", "plugin.json");

// 1. Explicit opt-out.
if (process.env.QUAY_SKIP_PLUGIN_REGISTER === "1") {
  console.log("[quay] QUAY_SKIP_PLUGIN_REGISTER=1 — skipping Claude Code plugin registration");
  process.exit(0);
}

// 2. Global install only.
if (process.env.npm_config_global !== "true") {
  console.log("[quay] not a global install — skipping Claude Code plugin registration");
  process.exit(0);
}

// 3. The installed artifact must actually carry the plugin bundle.
for (const f of [marketplaceJson, pluginJson]) {
  if (!fs.existsSync(f)) {
    console.error(`[quay] ERROR: installed plugin bundle is incomplete — missing ${f}.`);
    console.error("       The release tarball must carry plugin/.claude-plugin/{marketplace.json,plugin.json}.");
    process.exit(1);
  }
}

// 4. Derive the plugin reference (`pluginName@marketplaceName`) from the
//    manifests so it stays correct if either name ever changes.
let marketplace;
let plugin;
try {
  marketplace = JSON.parse(fs.readFileSync(marketplaceJson, "utf8"));
  plugin = JSON.parse(fs.readFileSync(pluginJson, "utf8"));
} catch (err) {
  console.error(`[quay] ERROR: cannot parse plugin manifest: ${err.message}`);
  process.exit(1);
}
const marketplaceName = marketplace?.name;
const pluginName = plugin?.name ?? marketplace?.plugins?.[0]?.name;
if (!marketplaceName || !pluginName) {
  console.error("[quay] ERROR: plugin manifest missing name fields — cannot register.");
  process.exit(1);
}
const pluginRef = `${pluginName}@${marketplaceName}`;

// 5. Merge into ~/.claude/settings.json, preserving every other key.
const home = os.homedir();
const settingsPath = path.join(home, ".claude", "settings.json");
let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (err) {
    console.error(`[quay] ERROR: cannot parse ${settingsPath}: ${err.message}`);
    console.error("       Refusing to overwrite a malformed settings file. Fix it, then reinstall quay.");
    process.exit(1);
  }
}
if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
  console.error(`[quay] ERROR: ${settingsPath} is not a JSON object; refusing to overwrite.`);
  process.exit(1);
}
settings.extraKnownMarketplaces = settings.extraKnownMarketplaces || {};
settings.extraKnownMarketplaces[marketplaceName] = {
  source: { source: "directory", path: pluginDir },
};

// 6. Write atomically (temp file + rename) so a crash never leaves a truncated settings.json.
try {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.quay-tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  fs.renameSync(tmp, settingsPath);
} catch (err) {
  console.error(`[quay] ERROR: could not write ${settingsPath}: ${err.message}`);
  console.error("       quay's plugin cannot be registered while ~/.claude is unwritable.");
  process.exit(1);
}

console.log("[quay] Registered the installed quay plugin with Claude Code:");
console.log(`       marketplace "${marketplaceName}" -> ${pluginDir}`);
console.log(`       plugin "${pluginRef}"`);
console.log(`       wrote ${settingsPath}`);

// 7. BEST-EFFORT materialization: writing settings.json makes the marketplace
//    KNOWN; `claude plugin marketplace add` additionally materializes the
//    marketplace itself into ~/.claude/plugins (cache + known_marketplaces.json)
//    so a Claude Code session can resolve plugins from it with NO user step.
//    This is enhancement, not the fail-closed core: if `claude` is missing (the
//    user has not installed Claude Code yet — /quay:init is moot for them) or a
//    step errors, we keep the settings.json registration and say what to run.
//
//    ⚠️ The ENABLE step is deliberately NOT part of the default flow — see the
//    SCOPE POLICY note at the top of this file. `claude plugin install` defaults
//    to `--scope user` and therefore writes a user-level
//    `enabledPlugins["quay@quay"]`, which is exactly how STANDING goal AC-161
//    got re-reddened by every real global install
//    (gap-ac161-user-scope-enable-repolluted-by-cli-materialization, 2026-09-11,
//    registered the materialization as a "known residual, product decision not
//    made" — the third regression filed above retired that residual: an
//    undecided product question must not sit permanently on top of a standing
//    criterion). Enabling is the target project's job:
//
//      "<repo>/.claude/settings.json": { "enabledPlugins": { "quay@quay": true } }
//
//    Callers who deliberately want a materialized enable opt in with
//    `QUAY_PLUGIN_SCOPE=user|project|local`.
function runCli(args) {
  try {
    return spawnSync("claude", args, {
      encoding: "utf8",
      stdio: "inherit",
      timeout: 180000,
      env: { ...process.env },
    });
  } catch (err) {
    return { status: 1, error: err };
  }
}

// 8. Which scope (if any) to ENABLE at. This is the AC-161 fix point: an
//    unconditional `claude plugin install` writes user-level enabledPlugins
//    (CLI default scope is `user`), so the enable is opt-in only. Unset and
//    unrecognized both mean "register the marketplace, enable nothing" — the
//    fail-closed direction for a criterion that says the user level must not
//    carry a quay enable.
const ENABLE_SCOPES = new Set(["user", "project", "local"]);
const rawScope = (process.env.QUAY_PLUGIN_SCOPE ?? "").trim().toLowerCase();
const enableScope = ENABLE_SCOPES.has(rawScope) ? rawScope : null;
if (rawScope && !enableScope) {
  console.log(`[quay] warning: unrecognized QUAY_PLUGIN_SCOPE=${JSON.stringify(rawScope)} —`);
  console.log(`       expected one of: ${[...ENABLE_SCOPES].join(", ")}. Skipping the enable step.`);
}

if (process.env.QUAY_SKIP_PLUGIN_CLI === "1") {
  console.log("[quay] QUAY_SKIP_PLUGIN_CLI=1 — skipping claude CLI materialization (settings.json only)");
} else {
  const add = runCli(["plugin", "marketplace", "add", pluginDir]);
  if (add.error && add.error.code === "ENOENT") {
    console.log("[quay] `claude` CLI not found on PATH — the quay marketplace is registered in");
    console.log("       settings.json and will be recognized when Claude Code next starts.");
    console.log("       To use /quay:init immediately, run:  /plugin install quay  in a session.");
  } else if (add.status !== 0) {
    console.log(`[quay] warning: 'claude plugin marketplace add' exited ${add.status}; the plugin is`);
    console.log("       registered in settings.json but not yet materialized. Run, once:");
    console.log(`       claude plugin marketplace add ${pluginDir}`);
    if (enableScope) console.log(`       claude plugin install ${pluginRef} --scope ${enableScope}`);
  } else if (!enableScope) {
    console.log("[quay] The marketplace is registered; the plugin is NOT enabled at user scope");
    console.log("       (AC-161: the user level carries only the marketplace source). Enable it per");
    console.log(`       project by adding  "enabledPlugins": { "${pluginRef}": true }  to that project's`);
    console.log("       .claude/settings.json — or re-run this install with QUAY_PLUGIN_SCOPE=user for");
    console.log("       a deliberate user-scope enable.");
  } else {
    const install = runCli(["plugin", "install", pluginRef, "--scope", enableScope]);
    if (install.status !== 0) {
      console.log(`[quay] warning: 'claude plugin install ${pluginRef} --scope ${enableScope}' exited ${install.status};`);
      console.log("       the plugin is registered in settings.json but not yet materialized. Run, once:");
      console.log(`       claude plugin install ${pluginRef} --scope ${enableScope}`);
    }
  }
}

console.log("       Restart Claude Code, then run /quay:init in a session.");
console.log(`       Verify: grep -c "${pluginDir}" ${settingsPath}`);
