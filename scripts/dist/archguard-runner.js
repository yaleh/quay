#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/archguard-runner.ts
import fs from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { createRequire as nodeCreateRequire } from "node:module";
import { spawnSync } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/gate-script-base.ts
import path from "node:path";
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/archguard-runner.ts
var SCOPES = [
  { source: "packages/quay/src", label: "src" },
  { source: "plugin/scripts", label: "scripts" },
  { source: "packages/quay-native/src", label: "quay-native-src" },
  { source: "packages/quay-github/src", label: "quay-github-src" },
  { source: "packages/quay-backlog/src", label: "quay-backlog-src" },
  { source: "experiments/quay-perpetual-stream/scripts", label: "experiments-scripts" }
];
var CROSS_SCOPE_NOT_EVALUATED = {
  crossScope: "not-evaluated",
  crossScopeReason: "six scopes are analyzed independently (one scope per source \u21D2 no cross-scope edges); plugin/scripts \u2194 packages/*/src edges are absent from EVERY analysis \u2014 unmeasured, not measured-zero"
};
function fail(msg) {
  process.stderr.write(`archguard-runner: ${msg}
`);
  process.exit(1);
}
var USAGE_TEXT = "usage: node --experimental-strip-types plugin/scripts/archguard-runner.ts --root <repo-root> [--work-dir <dir>]\n";
function usage(msg) {
  process.stderr.write(`archguard-runner: ${msg}
`);
  process.stderr.write(USAGE_TEXT);
  process.exit(2);
}
var ARCHGUARD_PKG_NAME = "@yalehwang/archguard";
var ARCHGUARD_CLI_REL = path2.posix.join("dist", "cli", "index.js");
function isExecutableFile(p) {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function claudePluginRoots() {
  const roots = [];
  const cfg = (process.env.CLAUDE_CONFIG_DIR ?? "").trim();
  if (cfg) roots.push(path2.join(cfg, "plugins"));
  try {
    roots.push(path2.join(os.homedir(), ".claude", "plugins"));
  } catch {
  }
  return [...new Set(roots)];
}
function archguardPluginCandidateRoots(pluginsRoot) {
  const out = [];
  const push = (p) => {
    if (typeof p === "string" && p.length > 0 && !out.includes(p) && fs.existsSync(p)) out.push(p);
  };
  try {
    const rec = JSON.parse(fs.readFileSync(path2.join(pluginsRoot, "installed_plugins.json"), "utf8"));
    const plugins = rec?.plugins;
    if (plugins && typeof plugins === "object" && !Array.isArray(plugins)) {
      for (const [key, entries] of Object.entries(plugins)) {
        if (!key.startsWith("archguard@")) continue;
        for (const e of Array.isArray(entries) ? entries : []) push(e?.installPath);
      }
    }
  } catch {
  }
  try {
    const cacheParent = path2.join(pluginsRoot, "cache");
    for (const marketplace of fs.readdirSync(cacheParent)) {
      const pkgParent = path2.join(cacheParent, marketplace, "archguard");
      let versions = [];
      try {
        versions = fs.readdirSync(pkgParent);
      } catch {
        continue;
      }
      for (const v of versions) push(path2.join(pkgParent, v));
    }
  } catch {
  }
  return out;
}
function resolveArchguardInPluginRoot(pluginRoot, searched) {
  const direct = path2.join(pluginRoot, "node_modules", ...ARCHGUARD_PKG_NAME.split("/"), ...ARCHGUARD_CLI_REL.split("/"));
  searched.push(direct);
  if (isFile(direct)) return direct;
  try {
    const req = nodeCreateRequire(path2.join(pluginRoot, "package.json"));
    const resolved = req.resolve(`${ARCHGUARD_PKG_NAME}/${ARCHGUARD_CLI_REL}`);
    searched.push(`createRequire(${pluginRoot}) \u2192 ${resolved}`);
    if (isFile(resolved)) return resolved;
  } catch (err) {
    searched.push(`createRequire(${pluginRoot}) \u2192 ${err?.message?.split("\n")[0] ?? "unresolvable"}`);
  }
  let cur = path2.resolve(pluginRoot);
  for (let i = 0; i < 8; i += 1) {
    const candidate = path2.join(cur, "npm-cache", "node_modules", ...ARCHGUARD_PKG_NAME.split("/"), ...ARCHGUARD_CLI_REL.split("/"));
    searched.push(candidate);
    if (isFile(candidate)) return candidate;
    const parent = path2.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}
function resolveArchguardCliWithSource() {
  const searched = [];
  const override = (process.env.ARCHGUARD_RUNNER_CLI ?? "").trim();
  if (override) {
    searched.push(`ARCHGUARD_RUNNER_CLI=${override}`);
    if (fs.existsSync(override)) {
      return { cli: override, source: "env", viaNode: !isExecutableFile(override), searched };
    }
    return { cli: null, source: null, viaNode: false, searched };
  }
  searched.push("PATH (command -v archguard)");
  const r = spawnSync("sh", ["-c", "command -v archguard"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) {
    const cli = r.stdout.trim();
    return { cli, source: "path", viaNode: !isExecutableFile(cli), searched };
  }
  for (const pluginsRoot of claudePluginRoots()) {
    const candidates = archguardPluginCandidateRoots(pluginsRoot);
    if (candidates.length === 0) searched.push(`${pluginsRoot} (no archguard plugin install recorded)`);
    for (const pluginRoot of candidates) {
      const found = resolveArchguardInPluginRoot(pluginRoot, searched);
      if (found) return { cli: found, source: "plugin", viaNode: !isExecutableFile(found), searched };
    }
  }
  return { cli: null, source: null, viaNode: false, searched };
}
function resolveArchguardCli() {
  return resolveArchguardCliWithSource().cli;
}
function readArchguardVersion(cli, viaNode = false) {
  const r = viaNode ? spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" }) : spawnSync(cli, ["--version"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const first = String(r.stdout ?? "").trim().split("\n")[0].trim();
  return first.length > 0 ? first : null;
}
function runAnalyze(cli, root, workDir, source, label, opts = {}) {
  const outputDir = path2.join(workDir, "output", opts.outputLabel ?? label);
  const argv = [
    "analyze",
    "--lang",
    "typescript",
    "--format",
    "json",
    ...opts.diagrams && opts.diagrams.length > 0 ? ["--diagrams", ...opts.diagrams] : [],
    ...opts.noCache ? ["--no-cache"] : [],
    "--work-dir",
    workDir,
    "--output-dir",
    outputDir,
    "-s",
    source
  ];
  const r = opts.viaNode ? spawnSync(process.execPath, [cli, ...argv], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) : spawnSync(cli, argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    process.stderr.write(
      `archguard-runner: analyze failed for ${source} (exit ${r.status})
${(r.stderr || "").split("\n").slice(-5).join("\n")}
`
    );
  }
  return r.status ?? 1;
}
function gitTrackedFileCount(root, source) {
  const r = spawnSync("git", ["ls-files", "--", source], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return null;
  return String(r.stdout ?? "").split("\n").filter((l) => l.trim().length > 0).length;
}
function gitTrackedFiles(root, source) {
  const r = spawnSync("git", ["ls-files", "-z", "--", source], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return null;
  return String(r.stdout ?? "").split("\0").filter((l) => l.length > 0);
}
var TS_SOURCE_FILE_RE = /\.(ts|tsx|mts|cts)$/;
var TS_TEST_FILE_RE = /\.(test|spec)\.[cm]?[tj]sx?$/;
function singleDirectoryBasis(root, source) {
  const all = gitTrackedFiles(root, source);
  if (all === null) {
    return { single: false, files: 0, dirs: [], reason: `git ls-files -- ${source} failed \u2014 the single-directory judgment is NOT evaluated` };
  }
  const srcDir = path2.posix.normalize(source.replace(/\/+$/, ""));
  const dirs = /* @__PURE__ */ new Set();
  let files = 0;
  for (const f of all) {
    if (!TS_SOURCE_FILE_RE.test(f) || TS_TEST_FILE_RE.test(f)) continue;
    if (/(^|\/)__tests__\//.test(f)) continue;
    files += 1;
    dirs.add(path2.posix.dirname(f));
  }
  if (files === 0) {
    return { single: false, files: 0, dirs: [], reason: `no tracked non-test TypeScript files under ${source}` };
  }
  const sorted = [...dirs].sort();
  return { single: sorted.length === 1 && sorted[0] === srcDir, files, dirs: sorted, reason: null };
}
function commitsSince(root, source, since) {
  if (typeof since !== "string" || since === "") return null;
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) return null;
  if (sinceMs > Date.now()) return 0;
  const strictlyAfter = new Date(Math.floor(sinceMs / 1e3) * 1e3 + 1e3).toISOString();
  const r = spawnSync("git", ["rev-list", "--count", `--since=${strictlyAfter}`, "HEAD", "--", source], {
    cwd: root,
    encoding: "utf8"
  });
  if (r.status !== 0) return null;
  const n = Number.parseInt(String(r.stdout ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}
function numeric(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function normalizeFsPath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path2.resolve(p);
  }
}
function readQueryManifest(workDir) {
  const queryDir = path2.join(workDir, "query");
  const manifestFile = path2.join(queryDir, "manifest.json");
  let manifestRaw;
  try {
    manifestRaw = fs.readFileSync(manifestFile, "utf8");
  } catch {
    return { ok: false, code: "unreadable", reason: `cannot read query manifest ${manifestFile}` };
  }
  try {
    return { ok: true, manifestFile, manifest: JSON.parse(manifestRaw) };
  } catch {
    return { ok: false, code: "malformed", reason: `query manifest ${manifestFile} is not valid JSON` };
  }
}
function readQueryScopeArch(workDir, key) {
  const archFile = path2.join(workDir, "query", key, "arch.json");
  let raw;
  try {
    raw = fs.readFileSync(archFile, "utf8");
  } catch {
    return { ok: false, code: "unreadable", reason: `cannot read query scope artifact ${archFile}` };
  }
  try {
    return { ok: true, archFile, arch: JSON.parse(raw) };
  } catch {
    return { ok: false, code: "malformed", reason: `query scope artifact ${archFile} is not valid JSON` };
  }
}
function readDirectoryCycles(root, workDir, source) {
  const notEvaluated = (reason, artifactTimestamp2 = null) => ({
    directoryCyclesEvaluated: false,
    directoryCyclesReason: reason,
    directoryCycleCount: null,
    directoryCycles: null,
    directoryCyclesBasis: null,
    artifactTimestamp: artifactTimestamp2,
    readingFreshness: null,
    fileListReadAt: null
  });
  const manifestRead = readQueryManifest(workDir);
  if (!manifestRead.ok) {
    return notEvaluated(
      manifestRead.code === "unreadable" ? `${manifestRead.reason} \u2014 directory-level cycles are NOT evaluated (not "0 cycles")` : manifestRead.reason
    );
  }
  const { manifestFile, manifest } = manifestRead;
  const entries = Array.isArray(manifest?.scopes) ? manifest.scopes : [];
  if (entries.length === 0) {
    return notEvaluated(`query manifest ${manifestFile} lists no scopes`);
  }
  const wanted = normalizeFsPath(path2.resolve(root, source));
  const matches = entries.filter(
    (e) => Array.isArray(e?.sources) && e.sources.some((s) => typeof s === "string" && normalizeFsPath(s) === wanted)
  );
  if (matches.length === 0) {
    return notEvaluated(
      `query manifest ${manifestFile} has no scope covering ${source} \u2014 directory-level cycles are NOT evaluated`
    );
  }
  matches.sort((a, b) => String(b?.generatedAt ?? "").localeCompare(String(a?.generatedAt ?? "")));
  const entry = matches[0];
  if (typeof entry?.key !== "string" || entry.key.length === 0) {
    return notEvaluated(`query manifest ${manifestFile}: the matching scope has no key`);
  }
  const manifestTimestamp = typeof entry.generatedAt === "string" && entry.generatedAt !== "" ? entry.generatedAt : null;
  const archRead = readQueryScopeArch(workDir, entry.key);
  if (!archRead.ok) {
    return notEvaluated(
      archRead.code === "unreadable" ? `${archRead.reason} \u2014 directory-level cycles are NOT evaluated` : archRead.reason,
      manifestTimestamp
    );
  }
  const { arch } = archRead;
  const artifactTimestamp = typeof arch.timestamp === "string" && arch.timestamp !== "" ? arch.timestamp : manifestTimestamp;
  const moduleGraph = arch?.extensions?.tsAnalysis?.moduleGraph;
  if (moduleGraph == null || typeof moduleGraph !== "object") {
    const sd = singleDirectoryBasis(root, source);
    if (sd.single) {
      return {
        directoryCyclesEvaluated: true,
        directoryCyclesReason: null,
        directoryCycleCount: 0,
        directoryCycles: [],
        directoryCyclesBasis: "single-directory",
        artifactTimestamp,
        // The cycle conclusion comes from the file list just read — the artifact above is provenance
        // for "which analyze we looked at", NOT the evidence for `cycleCount: 0`.
        readingFreshness: "live-file-list",
        fileListReadAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    const why = sd.reason ?? `${sd.files} tracked non-test TypeScript file(s) across ${sd.dirs.length} directories (${sd.dirs.slice(0, 4).join(", ")}${sd.dirs.length > 4 ? ", \u2026" : ""}) \u2014 NOT single-directory`;
    return notEvaluated(
      `moduleGraph not produced (package-level diagram not requested) \u2014 query scope ${entry.key} for ${source} has no extensions.tsAnalysis.moduleGraph (language: ${String(arch?.language ?? "unknown")}); ${why}; directory-level cycles are NOT evaluated (not "0 cycles")`,
      artifactTimestamp
    );
  }
  const rawCycles = moduleGraph.cycles;
  if (!Array.isArray(rawCycles)) {
    return notEvaluated(
      `query scope ${entry.key} for ${source}: moduleGraph.cycles is not an array \u2014 directory-level cycles are NOT evaluated`,
      artifactTimestamp
    );
  }
  const cycles = [];
  for (const c of rawCycles) {
    if (c == null || !Array.isArray(c.modules) || !c.modules.every((m) => typeof m === "string")) {
      return notEvaluated(
        `query scope ${entry.key} for ${source}: moduleGraph.cycles contains a malformed entry (modules must be string[])`,
        artifactTimestamp
      );
    }
    cycles.push({ size: c.modules.length, modules: [...c.modules] });
  }
  return {
    directoryCyclesEvaluated: true,
    directoryCyclesReason: null,
    directoryCycleCount: cycles.length,
    directoryCycles: cycles,
    directoryCyclesBasis: "module-graph",
    artifactTimestamp,
    // Read from the persisted artifact ⇒ its age is meaningful (it can fall behind the tree).
    readingFreshness: "artifact",
    fileListReadAt: null
  };
}
function aggregateDirectoryCycleReading(workDir, scopes) {
  const timestamps = scopes.filter((s) => s.evaluated && s.basis === "module-graph").map((s) => s.artifactTimestamp).filter((v) => typeof v === "string" && v !== "" && Number.isFinite(Date.parse(v)));
  const artifactTimestamp = timestamps.length > 0 ? timestamps.reduce((a, b) => a <= b ? a : b) : null;
  const failed = scopes.filter((s) => !s.evaluated);
  const status = failed.length === 0 ? "complete" : failed.length === scopes.length ? "none" : "partial";
  const evaluated = status !== "none";
  return {
    workDir,
    evaluated,
    status,
    reason: status === "complete" ? null : `${status === "partial" ? "partial" : "not-evaluated"} (${failed.length} of ${scopes.length} scopes not evaluated): ${failed.map((s) => `${s.scope}: ${s.reason}`).join(" | ")}`,
    totalCycleCount: status === "none" ? null : scopes.reduce((n, s) => n + (s.cycleCount ?? 0), 0),
    behindScopes: scopes.filter((s) => s.behindSources === true).map((s) => s.scope),
    notEvaluatedScopes: failed.map((s) => s.scope),
    scopes,
    artifactTimestamp
  };
}
function readDirectoryCycleReading(root, workDir) {
  const resolvedRoot = path2.resolve(root);
  const resolvedWorkDir = workDir ? path2.resolve(workDir) : path2.join(resolvedRoot, ".archguard");
  const scopes = SCOPES.map(({ source, label }) => {
    const r = readDirectoryCycles(resolvedRoot, resolvedWorkDir, source);
    const commitsSinceArtifact = r.readingFreshness === "live-file-list" ? null : commitsSince(resolvedRoot, source, r.artifactTimestamp);
    return {
      scope: label,
      source,
      evaluated: r.directoryCyclesEvaluated,
      reason: r.directoryCyclesReason,
      cycleCount: r.directoryCycleCount,
      cycles: r.directoryCycles,
      basis: r.directoryCyclesBasis,
      artifactTimestamp: r.artifactTimestamp,
      readingFreshness: r.readingFreshness,
      fileListReadAt: r.fileListReadAt,
      commitsSinceArtifact,
      behindSources: commitsSinceArtifact === null ? null : commitsSinceArtifact > 0
    };
  });
  return aggregateDirectoryCycleReading(resolvedWorkDir, scopes);
}
function scopeNeedsRefresh(scope) {
  if (scope.behindSources === true) return true;
  if (!scope.evaluated && typeof scope.reason === "string" && scope.reason.includes("moduleGraph not produced")) return true;
  return false;
}
function selectRefreshTargets(reading) {
  const artifactMs = (s) => {
    const ms = s.artifactTimestamp ? Date.parse(s.artifactTimestamp) : NaN;
    return Number.isFinite(ms) ? ms : null;
  };
  return reading.scopes.filter(scopeNeedsRefresh).sort((a, b) => {
    const ca = a.commitsSinceArtifact;
    const cb = b.commitsSinceArtifact;
    if (ca !== cb) {
      if (ca === null) return 1;
      if (cb === null) return -1;
      return cb - ca;
    }
    const ta = artifactMs(a);
    const tb = artifactMs(b);
    if (ta !== tb) {
      if (ta === null) return 1;
      if (tb === null) return -1;
      return ta - tb;
    }
    return a.scope.localeCompare(b.scope);
  });
}
function refreshBehindScopes(root, workDir, reading, opts = {}) {
  const at = opts.now ?? (/* @__PURE__ */ new Date()).toISOString();
  const wanted = opts.scopes ? new Set(opts.scopes) : null;
  const targets = selectRefreshTargets(reading).filter((s) => wanted === null || wanted.has(s.scope));
  const base = {
    attempted: false,
    refreshedScopes: [],
    deferredScopes: [],
    instrument: null,
    instrumentSource: null,
    searched: [],
    exitCode: null,
    at
  };
  if (targets.length === 0) {
    return { ...base, skipped: "no-scope-needs-refresh", detail: "no scope's artifact is behind its sources (or its staleness is not computable)" };
  }
  const resolvedRoot = path2.resolve(root);
  const resolvedWorkDir = workDir ? path2.resolve(workDir) : path2.join(resolvedRoot, ".archguard");
  const resolution = resolveArchguardCliWithSource();
  if (!resolution.cli) {
    return {
      ...base,
      skipped: "instrument-absent",
      detail: `archguard CLI not found \u2014 probed: ${resolution.searched.join(" ; ")}`,
      searched: resolution.searched
    };
  }
  const refreshedScopes = [];
  for (const target of targets) {
    const rc = runAnalyze(resolution.cli, resolvedRoot, resolvedWorkDir, target.source, target.scope, {
      diagrams: ["package"],
      outputLabel: `arch-cycle-refresh-${target.scope}`,
      viaNode: resolution.viaNode,
      noCache: true
    });
    refreshedScopes.push({
      scope: target.scope,
      source: target.source,
      artifactTimestamp: target.artifactTimestamp,
      commitsSinceArtifact: target.commitsSinceArtifact,
      exitCode: rc,
      ok: rc === 0
    });
  }
  const failed = refreshedScopes.filter((s) => !s.ok);
  return {
    ...base,
    attempted: true,
    refreshedScopes,
    skipped: failed.length === 0 ? null : failed.length === refreshedScopes.length ? "analyze-failed" : "partial",
    detail: refreshedScopes.map((s) => `archguard analyze --diagrams package \u2192 ${s.source} (exit ${s.exitCode})`).join(" ; "),
    instrument: resolution.cli,
    instrumentSource: resolution.source,
    searched: resolution.searched,
    exitCode: failed.length === 0 ? 0 : failed[0]?.exitCode ?? 1
  };
}
function downgradeStaleScopes(reading, causes) {
  if (causes.size === 0) return reading;
  const scopes = reading.scopes.map((s) => {
    const cause = causes.get(s.scope);
    if (cause === void 0) return s;
    const behind = s.commitsSinceArtifact === null ? "an unknown number of" : `${s.commitsSinceArtifact}`;
    const artifact = s.artifactTimestamp ?? "an unknown artifact timestamp";
    return {
      ...s,
      evaluated: false,
      reason: `artifact-behind-sources: artifact ${artifact} is behind ${behind} commit(s) touching ${s.source} \u2014 ${cause}; this scope's cycle count is NOT the current tree (\u26D4 not "0 cycles")`,
      cycleCount: null,
      cycles: null,
      basis: null
    };
  });
  return aggregateDirectoryCycleReading(reading.workDir, scopes);
}
var TOP_OUT_DEGREE_LIMIT_DEFAULT = 10;
function readGraphSummaryReading(root, workDir, opts = {}) {
  const resolvedRoot = path2.resolve(root);
  const resolvedWorkDir = workDir ? path2.resolve(workDir) : path2.join(resolvedRoot, ".archguard");
  const limit = opts.limit ?? TOP_OUT_DEGREE_LIMIT_DEFAULT;
  const unevaluated = (reason, known2 = {}) => ({
    workDir: resolvedWorkDir,
    evaluated: false,
    reason,
    scopeKey: null,
    scopeLabel: null,
    artifactTimestamp: null,
    ...known2,
    entityCount: null,
    relationCount: null,
    relationCountByType: null,
    entitiesWithOutgoingRelations: null,
    topByOutDegreeLimit: limit,
    topByOutDegree: null,
    topByOutDegreeTruncated: null
  });
  const manifestRead = readQueryManifest(resolvedWorkDir);
  if (!manifestRead.ok) {
    return unevaluated(`${manifestRead.reason} \u2014 the graph summary is NOT evaluated (not an empty graph)`);
  }
  const { manifestFile, manifest } = manifestRead;
  const key = manifest?.globalScopeKey;
  if (typeof key !== "string" || key.length === 0) {
    return unevaluated(`query manifest ${manifestFile} carries no globalScopeKey \u2014 the graph summary is NOT evaluated`);
  }
  const entry = Array.isArray(manifest?.scopes) ? manifest.scopes.find((e) => e?.key === key) : void 0;
  const scopeLabel = typeof entry?.label === "string" ? entry.label : null;
  const manifestTimestamp = typeof entry?.generatedAt === "string" && entry.generatedAt !== "" ? entry.generatedAt : null;
  const archRead = readQueryScopeArch(resolvedWorkDir, key);
  if (!archRead.ok) {
    return unevaluated(`${archRead.reason} \u2014 the graph summary is NOT evaluated (not an empty graph)`, {
      scopeKey: key,
      scopeLabel,
      artifactTimestamp: manifestTimestamp
    });
  }
  const arch = archRead.arch;
  const artifactTimestamp = typeof arch?.timestamp === "string" && arch.timestamp !== "" ? arch.timestamp : manifestTimestamp;
  const known = { scopeKey: key, scopeLabel, artifactTimestamp };
  if (arch == null || typeof arch !== "object") {
    return unevaluated(`query scope ${key} is not an object \u2014 the graph summary is NOT evaluated`, known);
  }
  if (!Array.isArray(arch.entities) || !Array.isArray(arch.relations)) {
    return unevaluated(`query scope ${key} has no entities[]/relations[] arrays \u2014 the graph summary is NOT evaluated`, known);
  }
  const byType = {};
  const outDegree = /* @__PURE__ */ new Map();
  for (let i = 0; i < arch.relations.length; i += 1) {
    const rel = arch.relations[i];
    if (rel == null || typeof rel !== "object" || typeof rel.source !== "string" || typeof rel.type !== "string") {
      return unevaluated(
        `query scope ${key}: relations[${i}] is malformed (source/type must be strings) \u2014 the graph summary is NOT evaluated`,
        known
      );
    }
    byType[rel.type] = (byType[rel.type] ?? 0) + 1;
    outDegree.set(rel.source, (outDegree.get(rel.source) ?? 0) + 1);
  }
  const entityById = /* @__PURE__ */ new Map();
  for (const e of arch.entities) {
    if (e != null && typeof e === "object" && typeof e.id === "string") entityById.set(e.id, e);
  }
  const ranked = [...outDegree.entries()].map(([entityId, degree]) => {
    const e = entityById.get(entityId);
    const loc = e?.sourceLocation;
    return {
      entityId,
      name: typeof e?.name === "string" && e.name !== "" ? e.name : entityId.split(".").pop() ?? entityId,
      outDegree: degree,
      kind: typeof e?.type === "string" ? e.type : null,
      file: typeof loc?.file === "string" ? loc.file : null,
      startLine: typeof loc?.startLine === "number" && Number.isFinite(loc.startLine) ? loc.startLine : null
    };
  }).sort((a, b) => b.outDegree - a.outDegree || a.entityId.localeCompare(b.entityId));
  const top = ranked.slice(0, Math.max(0, limit));
  return {
    workDir: resolvedWorkDir,
    evaluated: true,
    reason: null,
    scopeKey: key,
    scopeLabel,
    artifactTimestamp,
    entityCount: arch.entities.length,
    relationCount: arch.relations.length,
    relationCountByType: byType,
    entitiesWithOutgoingRelations: ranked.length,
    topByOutDegreeLimit: limit,
    topByOutDegree: top,
    topByOutDegreeTruncated: ranked.length > top.length
  };
}
function readScopeSignal(root, workDir, label, source, analyzeRc) {
  const base = {
    scope: label,
    evaluated: false,
    reason: null,
    entitySccCount: null,
    entityCount: null,
    totalRelations: null,
    maxInDegree: null,
    maxOutDegree: null,
    sourceFiles: null,
    gitSourceFiles: null,
    directoryCyclesEvaluated: false,
    directoryCyclesReason: null,
    directoryCycleCount: null,
    directoryCycles: null,
    directoryCyclesBasis: null
  };
  const directory = analyzeRc === 0 ? readDirectoryCycles(root, workDir, source) : {
    directoryCyclesEvaluated: false,
    directoryCyclesReason: `analyze exited ${analyzeRc} \u2014 no product to read`,
    directoryCycleCount: null,
    directoryCycles: null,
    directoryCyclesBasis: null
  };
  const withDirectory = { ...base, ...directory };
  const unevaluated = (reason) => ({ ...withDirectory, reason });
  if (analyzeRc !== 0) return unevaluated(`analyze exited ${analyzeRc} \u2014 no product to read`);
  const file = path2.join(workDir, "output", label, path2.basename(source), "class", "all-classes.json");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return unevaluated(`cannot read archguard output ${file} \u2014 did analyze actually run?`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return unevaluated(`archguard output ${file} is not valid JSON`);
  }
  const mv = data?.metricVector;
  if (mv == null || typeof mv !== "object") {
    return unevaluated(`archguard output ${file} has no metricVector`);
  }
  const entitySccCount = numeric(mv.sccCount);
  const entityCount = numeric(mv.totalEntities);
  const missingMetrics = [
    entitySccCount === null ? "sccCount" : null,
    entityCount === null ? "totalEntities" : null
  ].filter((k) => k !== null);
  if (missingMetrics.length > 0) {
    return unevaluated(`archguard output ${file}: metricVector lacks numeric ${missingMetrics.join(", ")}`);
  }
  if (!Array.isArray(data.sourceFiles)) {
    return unevaluated(`archguard output ${file}: artifact has no sourceFiles array \u2014 analysis coverage cannot be reconciled`);
  }
  const entries = data.sourceFiles.filter((e) => typeof e === "string");
  if (entries.length !== data.sourceFiles.length) {
    return unevaluated(`archguard output ${file}: sourceFiles contains non-string entries`);
  }
  const unique = /* @__PURE__ */ new Set();
  const duplicateSamples = [];
  for (const entry of entries) {
    let key;
    try {
      key = fs.realpathSync(entry);
    } catch {
      key = path2.resolve(root, entry);
    }
    if (unique.has(key)) {
      if (duplicateSamples.length < 3) duplicateSamples.push(entry);
    } else {
      unique.add(key);
    }
  }
  const gitSourceFiles = gitTrackedFileCount(root, source);
  if (gitSourceFiles === null) {
    return unevaluated(`git ls-files -- ${source} failed \u2014 sourceFiles cannot be reconciled (not evaluated, not "clean")`);
  }
  if (gitSourceFiles > 0 && entityCount === 0) {
    return unevaluated(
      `${source}: ${gitSourceFiles} git-tracked file(s) but analyze produced 0 entities \u2014 analysis did not cover its input`
    );
  }
  const notes = [];
  const duplicateCount = entries.length - unique.size;
  if (duplicateCount > 0) {
    notes.push(
      `${duplicateCount} duplicate sourceFiles entr${duplicateCount === 1 ? "y" : "ies"} (same realpath resolved twice \u2014 symlink double-resolution?): ${duplicateSamples.join(", ")}`
    );
  }
  if (unique.size !== gitSourceFiles) {
    notes.push(
      `sourceFiles=${unique.size} vs git ls-files ${source}=${gitSourceFiles} (diff ${unique.size - gitSourceFiles})`
    );
  }
  return {
    ...withDirectory,
    evaluated: true,
    reason: notes.length > 0 ? `reconciliation: ${notes.join("; ")}` : null,
    entitySccCount,
    entityCount,
    totalRelations: numeric(mv.totalRelations),
    maxInDegree: numeric(mv.maxInDegree),
    maxOutDegree: numeric(mv.maxOutDegree),
    sourceFiles: unique.size,
    gitSourceFiles
  };
}
function currentCommitSha(root) {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}
function appendHistory(workDir, record) {
  const file = path2.join(workDir, "metrics-history.jsonl");
  try {
    fs.mkdirSync(path2.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
  } catch (e) {
    fail(`cannot append to ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
function fmt(v) {
  return v === null ? "null" : String(v);
}
function main() {
  const args = process.argv.slice(2);
  let root = "";
  let workDirArg = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      root = args[i + 1] ?? "";
      i++;
    } else if (args[i] === "--work-dir") {
      workDirArg = args[i + 1] ?? "";
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      process.stdout.write(USAGE_TEXT);
      process.exit(0);
    } else {
      usage(`unknown argument: ${args[i]}`);
    }
  }
  if (!root) usage("--root is required");
  root = path2.resolve(root);
  const workDir = workDirArg ? path2.resolve(workDirArg) : path2.join(root, ".archguard");
  if (!fs.existsSync(path2.join(root, ".quay", "config.yml")) && !fs.existsSync(path2.join(root, ".git"))) {
    usage(`--root ${root} is not a repo worktree`);
  }
  const resolution = resolveArchguardCliWithSource();
  const cli = resolution.cli;
  if (!cli) {
    const reason = `archguard CLI not found \u2014 probed: ${resolution.searched.join(" ; ")} \u2014 the meter must be runnable`;
    appendHistory(workDir, {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      tool: "archguard-runner",
      commitSha: currentCommitSha(root),
      archguardVersion: null,
      evaluated: false,
      reason,
      entitySccCount: null,
      entitySccEvaluated: false,
      entitySccReason: reason,
      directoryCycleCount: null,
      directoryCyclesEvaluated: false,
      directoryCyclesReason: reason,
      sourceFiles: null,
      entityCount: null,
      verdict: "fail",
      ...CROSS_SCOPE_NOT_EVALUATED,
      scopes: []
    });
    fail(`${reason} (fail-closed)`);
  }
  const archguardVersion = readArchguardVersion(cli, resolution.viaNode);
  const versionReason = archguardVersion === null ? "archguard --version produced no readable version \u2014 record is not version-anchored" : null;
  const scopes = SCOPES.map(({ source, label }) => {
    process.stdout.write(`archguard-runner: analyzing ${label} (${source})
`);
    const rc = runAnalyze(cli, root, workDir, source, label, { viaNode: resolution.viaNode });
    return readScopeSignal(root, workDir, label, source, rc);
  });
  const entityUnevaluated = scopes.filter((s) => !s.evaluated);
  const directoryUnevaluated = scopes.filter((s) => !s.directoryCyclesEvaluated);
  const entityViolated = scopes.filter((s) => s.evaluated && s.entitySccCount !== 0);
  const directoryViolated = scopes.filter(
    (s) => s.directoryCyclesEvaluated && (s.directoryCycleCount ?? 0) > 0
  );
  const entityEvaluated = versionReason === null && entityUnevaluated.length === 0;
  const directoryEvaluated = versionReason === null && directoryUnevaluated.length === 0;
  const evaluated = entityEvaluated && directoryEvaluated;
  const violated = entityViolated.length > 0 || directoryViolated.length > 0;
  const verdict = evaluated && !violated ? "pass" : "fail";
  const reasons = [];
  if (versionReason) reasons.push(versionReason);
  for (const s of scopes) {
    if (s.reason) reasons.push(`${s.scope}: ${s.reason}`);
  }
  const entityReasons = [
    ...versionReason ? [versionReason] : [],
    ...entityUnevaluated.map((s) => `${s.scope}: ${s.reason ?? "not evaluated"}`)
  ];
  const directoryReasons = [
    ...versionReason ? [versionReason] : [],
    ...directoryUnevaluated.map((s) => `${s.scope}: ${s.directoryCyclesReason ?? "not evaluated"}`)
  ];
  const complete = entityUnevaluated.length === 0;
  const directoryComplete = directoryUnevaluated.length === 0;
  const record = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    tool: "archguard-runner",
    commitSha: currentCommitSha(root),
    archguardVersion,
    evaluated,
    reason: reasons.length > 0 ? reasons.join("; ") : null,
    entitySccCount: complete ? scopes.reduce((n, s) => n + (s.entitySccCount ?? 0), 0) : null,
    entitySccEvaluated: entityEvaluated,
    entitySccReason: entityReasons.length > 0 ? entityReasons.join("; ") : null,
    directoryCycleCount: directoryComplete ? scopes.reduce((n, s) => n + (s.directoryCycleCount ?? 0), 0) : null,
    directoryCyclesEvaluated: directoryEvaluated,
    directoryCyclesReason: directoryReasons.length > 0 ? directoryReasons.join("; ") : null,
    sourceFiles: complete ? scopes.reduce((n, s) => n + (s.sourceFiles ?? 0), 0) : null,
    entityCount: complete ? scopes.reduce((n, s) => n + (s.entityCount ?? 0), 0) : null,
    verdict,
    ...CROSS_SCOPE_NOT_EVALUATED,
    scopes
  };
  appendHistory(workDir, record);
  for (const s of scopes) {
    process.stdout.write(
      `archguard-runner: ${s.scope} \u2014 evaluated=${s.evaluated} entitySccCount=${fmt(s.entitySccCount)} directoryCycleCount=${fmt(s.directoryCycleCount)} directoryCyclesEvaluated=${s.directoryCyclesEvaluated} entities=${fmt(s.entityCount)} relations=${fmt(s.totalRelations)} sourceFiles=${fmt(s.sourceFiles)} gitSourceFiles=${fmt(s.gitSourceFiles)} maxInDegree=${fmt(s.maxInDegree)} maxOutDegree=${fmt(s.maxOutDegree)}${s.reason ? ` reason=${s.reason}` : ""}${s.directoryCyclesReason ? ` directoryReason=${s.directoryCyclesReason}` : ""}
`
    );
  }
  if (!evaluated) {
    const detail = [
      entityEvaluated ? null : `entity: ${entityReasons.join("; ")}`,
      directoryEvaluated ? null : `directory: ${directoryReasons.join("; ")}`
    ].filter((v) => v !== null).join(" | ");
    fail(`NOT EVALUATED \u2014 at least one scope could not be read; refusing to report "0 cycles" (\u786C\u89C4\u5219 3b): ${detail}`);
  }
  if (entityViolated.length > 0) {
    fail(
      `structural violation: entity-level dependency cycles detected in ${entityViolated.map((s) => s.scope).join(", ")} \u2014 entitySccCount must be 0`
    );
  }
  if (directoryViolated.length > 0) {
    const detail = directoryViolated.map((s) => `${s.scope}: ${(s.directoryCycles ?? []).map((c) => JSON.stringify(c.modules)).join(" ")}`).join("; ");
    fail(
      `structural violation: directory-level dependency cycles detected \u2014 ${detail} \u2014 directoryCycleCount must be 0`
    );
  }
  process.stdout.write("archguard-runner: PASS \u2014 no dependency cycles in any scope\n");
}
if (isDirectEntry(import.meta, process.argv[1], "archguard-runner")) main();
export {
  TOP_OUT_DEGREE_LIMIT_DEFAULT,
  commitsSince,
  downgradeStaleScopes,
  readDirectoryCycleReading,
  readGraphSummaryReading,
  refreshBehindScopes,
  resolveArchguardCli,
  resolveArchguardCliWithSource,
  scopeNeedsRefresh,
  selectRefreshTargets,
  singleDirectoryBasis
};
