// Bounded, READ-ONLY evidence executor for the ownership active-investigation loop.
//
// It runs exactly the request kinds the contract admits and nothing else:
//   read_file       -> `git show <commit>:<path>` (line-sliced)        — never the working tree, never a write
//   grep            -> `git grep <commit> -- <scoped paths>`           — same
//   archguard_query -> the ArchGuard CLI `query` over a snapshot built from the tree (temp work-dir only)
//
// Every result carries provenance (tool, repo ref/commit, path+range or ArchGuard scope+flags, timestamp,
// content hash). A request the production tool surface cannot answer is returned as `capability_gap`
// with the surfaces that DO exist — it is never faked and never silently empty (hard rule 3b).
//
// All I/O goes through injectable `deps`, so the test-suite exercises the policy without git/ArchGuard/LLM.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { ARCHGUARD_QUERY_KINDS, DEFAULT_BUDGET, DENY_PATH_PATTERNS } from "./ownership-active-contract.mjs";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const SCANNED_DIRS = ["packages", "plugin/scripts", "scripts"];

export function resolveArchguardCli() {
  const cands = [process.env.ARCHGUARD_CLI, "/data/home/yale/.claude/plugins/npm-cache/node_modules/@yalehwang/archguard/dist/cli/index.js"].filter(Boolean);
  return cands.find((p) => fs.existsSync(p)) || null;
}

/** Version the INSTALLED CLI reports about itself (`--version`), or null. Never the repo's package.json. */
export function archguardCliVersion(cli) {
  try { return execFileSync("node", [cli, "--version"], { encoding: "utf8", timeout: 30_000 }).trim(); } catch { return null; }
}

/** Clip to a UTF-8 byte budget, reporting truncation (never silently). */
export function clipBytes(text, max) {
  if (Buffer.byteLength(text, "utf8") <= max) return { text, truncated: false, total_bytes: Buffer.byteLength(text, "utf8") };
  let s = text.slice(0, max);
  while (Buffer.byteLength(s, "utf8") > max) s = s.slice(0, -Math.max(1, Math.ceil((Buffer.byteLength(s, "utf8") - max) / 3)));
  return { text: s + "\n…[truncated]", truncated: true, total_bytes: Buffer.byteLength(text, "utf8") };
}


/** Package-level ArchJSON (moduleGraph) of a SUBTREE, built into TEMP dirs — the analysed tree is never written. */
export function defaultAnalyzePackageGraph(absScopeRoot) {
  const cli = resolveArchguardCli();
  if (!cli) return null;
  const w = fs.mkdtempSync(path.join(os.tmpdir(), "own-active-pkg-"));
  execFileSync("node", [cli, "analyze", "-s", absScopeRoot, "-f", "json", "--diagrams", "package", "--work-dir", path.join(w, "work"), "--cache-dir", path.join(w, "cache"), "--output-dir", path.join(w, "out"), "-e", "**/.quay/**", "**/.claude/**", "**/.archguard/**", "**/node_modules/**", "**/dist/**"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  const f = path.join(w, "out", "overview", "package.json");
  return { file: f, json: JSON.parse(fs.readFileSync(f, "utf8")) };
}

export function defaultDeps(root) {
  const cli = resolveArchguardCli();
  const g = (args, opts = {}) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000, ...opts });
  let snapshot = null;
  return {
    git: (args) => g(args),
    gitMaybe: (args) => { try { return { out: g(args), code: 0, err: "" }; } catch (e) { return { out: String(e.stdout || ""), code: typeof e.status === "number" ? e.status : 2, err: String(e.stderr || e.message || "").slice(0, 300) }; } },
    archguardAvailable: () => !!cli,
    archguardVersion: () => { try { return execFileSync("node", [cli, "--version"], { encoding: "utf8", timeout: 30_000 }).trim(); } catch { return null; } },
    /** Build (once) a snapshot of the tree in TEMP dirs — the analysed tree is never written. */
    ensureSnapshot: () => {
      if (snapshot) return snapshot;
      const w = fs.mkdtempSync(path.join(os.tmpdir(), "own-active-ag-"));
      execFileSync("node", [cli, "analyze", "-s", root, "-f", "json", "--diagrams", "package", "--work-dir", path.join(w, "work"), "--cache-dir", path.join(w, "cache"), "--output-dir", path.join(w, "out"),
        // never analyse tool/runtime state or foreign checkouts: .quay holds whole-repo deliver worktrees
        "-e", "**/.quay/**", "**/.claude/**", "**/.archguard/**", "**/node_modules/**", "**/dist/**"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
      const qdir = path.join(w, "work", "query");
      const scopes = fs.readdirSync(qdir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
        const f = path.join(qdir, e.name, "arch.json");
        if (!fs.existsSync(f)) return null;
        const d = JSON.parse(fs.readFileSync(f, "utf8"));
        return { key: e.name, language: d.language, entities: d.entities.length };
      }).filter(Boolean).filter((s) => s.language === "typescript").sort((a, b) => b.entities - a.entities);
      if (!scopes.length) throw new Error("no typescript scope in snapshot");
      snapshot = { workDir: path.join(w, "work"), scope: scopes[0].key, entities: scopes[0].entities, built_at: new Date().toISOString() };
      return snapshot;
    },
    analyzePackageGraph: (absScopeRoot) => defaultAnalyzePackageGraph(absScopeRoot),
    archguardQuery: (snap, flags) => execFileSync("node", [cli, "query", "--arch-dir", snap.workDir, "--scope", snap.scope, ...flags], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }),
  };
}

export function createExecutor({ root, ref = null, budget = DEFAULT_BUDGET, deps = defaultDeps(root), now = () => new Date().toISOString() } = {}) {
  let commit = null;
  let counter = 0;
  const resolveCommit = () => (commit ||= deps.git(["rev-parse", ref || "HEAD"]).trim());
  const base = (request, status, text, prov, extra = {}) => {
    const c = clipBytes(text, budget.max_result_bytes);
    return {
      id: `ev-${++counter}`, request, status, text: c.text, bytes: Buffer.byteLength(c.text, "utf8"),
      truncated: c.truncated, total_bytes: c.total_bytes,
      provenance: { ...prov, ref_commit: resolveCommit(), ts: now(), content_sha256: sha(c.text) },
      ...extra,
    };
  };
  // `git grep -n` rows are `path:line:content`; repo paths never contain ':' here.
  const denyFilter = (rows) => rows.filter((r) => !DENY_PATH_PATTERNS.some((re) => re.test(r.split(":")[0])));

  function readFile(req) {
    const c = resolveCommit();
    const t = deps.gitMaybe(["cat-file", "-t", `${c}:${req.path}`]);
    if (t.code !== 0) return base(req, "error", `path not present at ${c.slice(0, 12)}: ${req.path}`, { tool: "read_file", path: req.path }, { reason: "PATH_NOT_IN_REF" });
    if (t.out.trim() !== "blob") return base(req, "error", `${req.path} is a ${t.out.trim()}, not a file`, { tool: "read_file", path: req.path }, { reason: "NOT_A_FILE" });
    const lines = deps.git(["show", `${c}:${req.path}`]).split("\n");
    const s = req.start_line, e = Math.min(req.end_line, lines.length);
    if (s > lines.length) return base(req, "error", `start_line ${s} beyond end of file (${lines.length} lines)`, { tool: "read_file", path: req.path, total_lines: lines.length }, { reason: "RANGE_PAST_EOF" });
    const body = lines.slice(s - 1, e).map((l, i) => `${String(s + i).padStart(5)}| ${l}`).join("\n");
    return base(req, "ok", body, { tool: "read_file", path: req.path, range: [s, e], total_lines: lines.length, command: `git show ${c.slice(0, 12)}:${req.path}` });
  }

  function grep(req) {
    const c = resolveCommit();
    const r = deps.gitMaybe(["grep", req.fixed ? "-nF" : "-nE", "--no-color", "-I", "-e", req.pattern, c, "--", ...req.paths]);
    if (r.code > 1) return base(req, "error", `git grep failed (exit ${r.code}): ${r.err || "no message"}. Patterns are POSIX extended regex (git grep -E): no (?:…), \\d, lookaround.`, { tool: "grep", paths: req.paths, pattern: req.pattern }, { reason: "GREP_FAILED" });
    const prefix = `${c}:`;
    const all = r.out.split("\n").filter(Boolean).map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l));
    const rows = denyFilter(all);
    const dropped = all.length - rows.length;
    const kept = rows.slice(0, budget.max_grep_hits).map((l) => (l.length > 220 ? l.slice(0, 220) + " …" : l));
    const text = (kept.length ? kept.join("\n") : "(no matches)") + (rows.length > kept.length ? `\n… ${rows.length - kept.length} more hits omitted` : "");
    return base(req, "ok", text, { tool: "grep", pattern: req.pattern, fixed: req.fixed, paths: req.paths, command: `git grep ${req.fixed ? "-nF" : "-nE"} -e '${req.pattern}' ${c.slice(0, 12)} -- ${req.paths.join(" ")}` },
      { hits: rows.length, denied_rows_dropped: dropped });
  }

  function archguard(req) {
    const kind = ARCHGUARD_QUERY_KINDS[req.query];
    if (!kind.implemented) {
      return base(req, "capability_gap", `CAPABILITY GAP: ${kind.gap.capability} is not reachable on this tool surface. ${kind.gap.reason}. Available via: ${JSON.stringify(kind.gap.available_via)}. No reading was produced.`,
        { tool: "archguard_query", query: req.query }, { gap: kind.gap });
    }
    if (!deps.archguardAvailable()) {
      return base(req, "capability_gap", "CAPABILITY GAP: archguard.cli — the ArchGuard CLI is not installed on this host.", { tool: "archguard_query", query: req.query },
        { gap: { capability: "archguard.cli", available_via: { mcp: "archguard_*", cli: null }, reason: "ArchGuard CLI not resolvable" } });
    }
    let snap;
    try { snap = deps.ensureSnapshot(); } catch (e) { return base(req, "error", `snapshot build failed: ${String(e.message).slice(0, 200)}`, { tool: "archguard_query", query: req.query }, { reason: "SNAPSHOT_FAILED" }); }
    const a = req.args || {};
    if (req.query === "package_edges") return packageEdges(req, a);
    if (req.query === "dependencies" || req.query === "used_by") {
      // The CLI answers "(none)" for an UNKNOWN entity and for a package DIRECTORY exactly as it does for an entity that
      // exists and has no edges. Disambiguate before reporting, or an empty reading reads as a finding (hard rule 3b).
      let ent = "";
      try { ent = deps.archguardQuery(snap, ["--entity", a.name]); } catch { /* fall through: the query below reports its own failure */ }
      if (/\(none\)/.test(ent) && !/Total: [1-9]/.test(ent)) {
        return base(req, "error", `ENTITY_NOT_FOUND: no entity named "${a.name}" in this snapshot. dependencies/used_by take an ENTITY name (a class, function or interface), not a package directory or a file path. For directory-level edges use query "package_edges" with a scope_root; for the entities defined in one file use "file_entities".`,
          { tool: "archguard_query", query: req.query, name: a.name }, { reason: "ENTITY_NOT_FOUND" });
      }
    }
    const flags = {
      package_cycles: ["--cycles", "--output-scope", "package"],
      package_stats: ["--package-stats", "3", "--package-stats-top", String(a.top ?? 12)],
      dependencies: ["--deps-of", a.name, "--depth", String(a.depth ?? 1), "--output-scope", "class"],
      used_by: ["--used-by", a.name, "--depth", String(a.depth ?? 1), "--output-scope", "class"],
      file_entities: ["--file", a.path],
    }[req.query];
    let out;
    try { out = deps.archguardQuery(snap, flags); } catch (e) { return base(req, "error", `archguard query failed: ${String(e.stderr || e.message).slice(0, 300)}`, { tool: "archguard_query", query: req.query }, { reason: "QUERY_FAILED" }); }
    const changed = deps.gitMaybe(["diff", "--name-only", "HEAD", "--", ...SCANNED_DIRS]).out.split("\n").filter(Boolean);
    const extra = {};
    if (req.query === "package_cycles") {
      extra.cycles = [...out.matchAll(/Cycle \d+ \(size (\d+)\): (.+)/g)].map((m) => ({ size: Number(m[1]), members: m[2].split(" -> ").map((s) => s.trim()) }));
    }
    return base(req, "ok", out.trim() || "(empty output)", {
      tool: "archguard_query", query: req.query, flags, archguard_version: deps.archguardVersion?.() ?? null,
      snapshot_scope: snap.scope, snapshot_entities: snap.entities, snapshot_built_at: snap.built_at,
      snapshot_matches_ref: changed.length === 0, tracked_changes_in_scanned_dirs: changed.slice(0, 10),
    }, extra);
  }

  const graphCache = new Map();
  function packageEdges(req, a) {
    const abs = path.join(root, a.scope_root);
    let built = graphCache.get(a.scope_root);
    try { if (!built) { built = deps.analyzePackageGraph(abs); if (built) graphCache.set(a.scope_root, built); } } catch (e) {
      return base(req, "error", `package graph build failed: ${String(e.message).slice(0, 200)}`, { tool: "archguard_query", query: "package_edges", scope_root: a.scope_root }, { reason: "SNAPSHOT_FAILED" });
    }
    if (!built) return base(req, "capability_gap", "CAPABILITY GAP: archguard.cli — the ArchGuard CLI is not installed on this host.", { tool: "archguard_query", query: "package_edges" }, { gap: { capability: "archguard.cli", available_via: { mcp: "archguard_*", cli: null }, reason: "ArchGuard CLI not resolvable" } });
    const mg = built.json?.extensions?.tsAnalysis?.moduleGraph;
    if (!mg) return base(req, "error", "the analysed subtree produced no module graph (no TypeScript sources under scope_root?)", { tool: "archguard_query", query: "package_edges", scope_root: a.scope_root }, { reason: "NO_MODULE_GRAPH" });
    const internal = new Set((mg.nodes || []).filter((n) => n.type === "internal").map((n) => n.id));
    const edges = (mg.edges || []).filter((e) => internal.has(e.from) && internal.has(e.to) && e.from !== e.to
      && (a.from === undefined || e.from === a.from) && (a.to === undefined || e.to === a.to)).sort((x, y) => (y.strength || 0) - (x.strength || 0));
    const q = (s) => (s === "" ? '"" (root of scope_root)' : s);
    const cyc = (mg.cycles || []).map((c, i) => `cycle ${i + 1}: size ${c.modules.length}: ${c.modules.map((m) => (m === "" ? '""' : m)).join(" | ")}`);
    const rows = edges.slice(0, 80).map((e) => `${String(e.strength).padStart(4)}  ${q(e.from)} -> ${q(e.to)}   value=${e.valueStrength} typeOnly=${e.typeOnlyStrength}   names=[${(e.importedNames || []).slice(0, 14).join(", ")}${(e.importedNames || []).length > 14 ? ", …" : ""}]`);
    const text = [`package edges under ${a.scope_root} (package ids are directories RELATIVE to scope_root; the root is ""): ${edges.length} internal edges${a.from !== undefined || a.to !== undefined ? " (filtered)" : ""}`,
      `internal packages: ${[...internal].sort().map((s) => (s === "" ? '""' : s)).join(", ")}`,
      ...(cyc.length ? cyc : ["cycles: none"]), "strength  from -> to", ...rows, ...(edges.length > 80 ? [`… ${edges.length - 80} more edges omitted`] : [])].join("\n");
    let treeSha = null, changed = [];
    try { treeSha = deps.git(["rev-parse", `${resolveCommit()}:${a.scope_root}`]).trim(); } catch { /* recorded as null */ }
    try { changed = deps.gitMaybe(["diff", "--name-only", "HEAD", "--", a.scope_root]).out.split("\n").filter(Boolean); } catch { /* unknown */ }
    return base(req, "ok", text, { tool: "archguard_query", query: "package_edges", scope_root: a.scope_root, filter: { from: a.from ?? null, to: a.to ?? null }, tree_sha: treeSha, snapshot_matches_ref: changed.length === 0, tracked_changes_in_scope: changed.slice(0, 10), graph_sha256: sha(JSON.stringify(mg)) },
      { cycles: (mg.cycles || []).map((c) => ({ size: c.modules.length, members: c.modules })) });
  }

  return {
    commit: resolveCommit,
    execute(req) {
      if (req.kind === "read_file") return readFile(req);
      if (req.kind === "grep") return grep(req);
      if (req.kind === "archguard_query") return archguard(req);
      throw new Error(`executor reached with a kind the gate should have refused: ${req.kind}`);   // defence in depth
    },
  };
}
