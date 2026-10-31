import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/resolve-quay-cli.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
var CONSULTED_PLUGIN_IDS = ["quay@quay", "quay@quay-dev"];
var PROJECT_SCOPES = /* @__PURE__ */ new Set(["project", "local"]);
function asString(v) {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function readInstallRecord(homeDir) {
  const recordPath = path.join(homeDir, ".claude", "plugins", "installed_plugins.json");
  const notOk = (state, reason) => ({
    state,
    entries: [],
    recordPath,
    reason
  });
  let raw;
  try {
    raw = fs.readFileSync(recordPath, "utf8");
  } catch (e) {
    const code = e?.code;
    if (code === "ENOENT") {
      return notOk("missing", `no Claude Code plugin install record at ${recordPath} \u2014 nothing to read`);
    }
    return notOk(
      "unreadable",
      `the Claude Code plugin install record at ${recordPath} exists but could not be read (${code ?? String(e)})`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return notOk("unparsable", `the plugin install record at ${recordPath} is not valid JSON (${e.message})`);
  }
  const plugins = parsed?.plugins;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) {
    return notOk(
      "unparsable",
      `the plugin install record at ${recordPath} has no \`plugins\` object \u2014 its shape is not the one this contract documents`
    );
  }
  const entries = [];
  for (const id of CONSULTED_PLUGIN_IDS) {
    const list = plugins[id];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item;
      entries.push({
        id,
        scope: asString(o.scope),
        installPath: asString(o.installPath),
        version: asString(o.version),
        installedAt: asString(o.lastUpdated) ?? asString(o.installedAt),
        projectPath: asString(o.projectPath)
      });
    }
  }
  return { state: "ok", entries, recordPath, reason: null };
}
function normalisePath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
function compareVersions(a, b) {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === void 0) return -1;
    if (y === void 0) return 1;
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
function highestVersion(entries) {
  let best = null;
  for (const e of entries) {
    if (e.version === null) continue;
    if (best === null || compareVersions(e.version, best) > 0) best = e.version;
  }
  if (best === null) return [];
  return entries.filter((e) => e.version === best);
}
function selectTier(entries, projectDir) {
  const projectNorm = normalisePath(projectDir);
  const projectMatches = entries.filter(
    (e) => e.scope !== null && PROJECT_SCOPES.has(e.scope) && e.projectPath !== null && normalisePath(e.projectPath) === projectNorm
  );
  if (projectMatches.length > 0) {
    const top = highestVersion(projectMatches);
    if (top.length === 0) {
      return {
        tier: "project",
        entries: projectMatches,
        reason: `a project/local install record for ${projectNorm} exists but carries no usable \`version\` \u2014 cannot pick a directory deterministically`
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
        reason: `a user-scope install record exists but carries no usable \`version\``
      };
    }
    return { tier: "user", entries: top, reason: null };
  }
  return {
    tier: null,
    entries: [],
    reason: `the install record names no plugin entry for this project: no project/local entry whose projectPath resolves to ${projectNorm}, and no user-scope entry`
  };
}
function readJsonVersion(pluginRoot) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"))?.version;
    return asString(v);
  } catch {
    return null;
  }
}
function readOrphanedAt(pluginRoot) {
  try {
    const raw = fs.readFileSync(path.join(pluginRoot, ".orphaned_at"), "utf8").trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}
function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function resolveQuayCli(opts = {}) {
  const homeDir = path.resolve(opts.homeDir ?? os.homedir());
  const projectDir = path.resolve(opts.projectDir ?? process.cwd());
  const base = {
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
    consultedIds: [...CONSULTED_PLUGIN_IDS]
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
  const withEntry = {
    ...base,
    tier: selected.tier,
    scope: winner.scope,
    pluginId: winner.id,
    version: winner.version,
    installPath: winner.installPath
  };
  if (winner.installPath === null) {
    return {
      ...withEntry,
      state: "absent",
      reason: `the winning ${winner.id} entry (scope ${String(winner.scope)}) carries no \`installPath\` \u2014 there is no directory to resolve`
    };
  }
  const installPath = normalisePath(winner.installPath);
  const resolvedEntry = { ...withEntry, installPath, rootVersion: readJsonVersion(installPath), orphanedAtMs: readOrphanedAt(installPath) };
  if (!exists(installPath)) {
    return {
      ...resolvedEntry,
      state: "absent",
      reason: `the winning ${winner.id} entry (scope ${String(winner.scope)}, version ${String(winner.version)}) names ${installPath}, but that directory does not exist \u2014 the record is stale (Claude Code deletes old version directories; see the doc's .orphaned_at section). \u26D4 Not falling back to \`quay\` on PATH.`
    };
  }
  const cliPath = path.join(installPath, "bin", "quay");
  const bundlePath = path.join(installPath, "vendor", "quay", "dist", "quay.js");
  const hasCli = exists(cliPath);
  const hasBundle = exists(bundlePath);
  const withPaths = {
    ...resolvedEntry,
    cli: hasCli ? cliPath : null,
    cliExecutable: hasCli ? isExecutable(cliPath) : null,
    bundle: hasBundle ? bundlePath : null
  };
  if (!hasCli && !hasBundle) {
    return {
      ...withPaths,
      state: "absent",
      reason: `${installPath} exists but carries no CLI: neither bin/quay nor vendor/quay/dist/quay.js is present. That is not a quay plugin tree (or an unpublished/broken build) \u2014 \u26D4 not falling back to \`quay\` on PATH.`
    };
  }
  return { ...withPaths, state: "resolved", reason: null };
}
var USAGE = `usage: resolve-quay-cli [--project <dir>] [--home <dir>] [--json | --field <name>]

Resolve the quay CLI for a project from the Claude Code plugin install record.
Contract: docs/references/external-consumer-cli-location.md

  --project <dir>   project whose pinned plugin version applies (default: cwd)
  --home <dir>      where .claude/plugins/installed_plugins.json lives (default: $HOME)
  --json            print the full Resolution as one JSON document
  --field <name>    print a single field (cli, bundle, installPath, version, state, ...)
  --help            this text

exit: 0 resolved \xB7 2 absent \xB7 3 not-evaluated \xB7 64 usage error
\u26D4 never falls back to \`quay\` on PATH \u2014 an unresolvable pin is a refusal, not a substitution.`;
function fail(message, code) {
  process.stderr.write(`resolve-quay-cli: ${message}
`);
  process.exit(code);
}
function main(argv) {
  let projectDir;
  let homeDir;
  let json = false;
  let field = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(`${USAGE}
`);
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
      fail(`unexpected argument ${JSON.stringify(a)}

${USAGE}`, 64);
    }
  }
  const r = resolveQuayCli({ homeDir, projectDir });
  if (field !== null) {
    const value = r[field];
    if (value === void 0) fail(`no such field: ${field}`, 64);
    if (value !== null) process.stdout.write(`${String(value)}
`);
  } else if (json) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}
`);
  } else {
    const lines = [
      `state:    ${r.state}`,
      `project:  ${r.projectDir}`,
      `record:   ${r.recordPath}`
    ];
    if (r.state === "resolved") {
      lines.push(
        `tier:     ${String(r.tier)} (scope ${String(r.scope)})`,
        `plugin:   ${String(r.pluginId)} ${String(r.version)}${r.rootVersion !== null && r.rootVersion !== r.version ? ` (on-disk plugin.json says ${r.rootVersion})` : ""}`,
        `root:     ${String(r.installPath)}`,
        `cli:      ${String(r.cli)}${r.cliExecutable === false ? "  \u26A0 present but NOT executable" : ""}`,
        `bundle:   ${String(r.bundle)}`
      );
      if (r.orphanedAtMs !== null) {
        lines.push(
          `\u26A0 .orphaned_at ${r.orphanedAtMs} (${new Date(r.orphanedAtMs).toISOString()}) \u2014 Claude Code marked this version directory for deletion; do not treat this path as permanent`
        );
      }
    } else {
      lines.push(`reason:   ${String(r.reason)}`);
    }
    process.stdout.write(`${lines.join("\n")}
`);
  }
  return r.state === "resolved" ? 0 : r.state === "absent" ? 2 : 3;
}
var isDirectInvocation = process.argv[1] !== void 0 && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && path.basename(process.argv[1]).replace(/\.(js|ts|mjs)$/, "") === "resolve-quay-cli";
if (isDirectInvocation) process.exitCode = main(process.argv.slice(2));
export {
  CONSULTED_PLUGIN_IDS,
  readInstallRecord,
  resolveQuayCli,
  selectTier
};
