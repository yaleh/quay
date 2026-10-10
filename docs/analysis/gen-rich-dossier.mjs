#!/usr/bin/env node
// Generator for the RICH EVIDENCE BUNDLE ("dossier") variant of the GOAL-030..033 replay corpus.
//
// WHY (from the two-stage A/B): the 1-2 KB static JSON bundle starved both models — 0/8 reached
// `sufficient` granularity and Flash/Opus tied on nearly everything. A human deciding a goal had the
// whole repo + ArchGuard. This generator rebuilds that evidence, cutoff-safely:
//
//   • every code/doc excerpt is read from a GIT OBJECT at the stage's cutoff commit
//     (`git show <commit>:<path>` / `git grep <commit>`), never from the working tree;
//   • every ArchGuard-derived fact is computed from the arch.json of a worktree whose scanned code
//     is verified identical to the stage cutoff commit (git diff --name-only, recorded);
//   • every section records its provenance (commit, path, line range / command, sha256 of the
//     excerpt) so the integrity test can RE-DERIVE it and compare byte for byte;
//   • reference.json / outcome.json are never opened here.
//
// Stage A = T0 commit, instrument-pass material (the picture a first scan gives).
// Stage B = T1 commit = A's sections + drill-down raw material + the investigation findings.
//
// Usage: node docs/analysis/gen-rich-dossier.mjs [--only GOAL-032]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CORPUS = path.join(REPO, "plugin", "fixtures", "meta-driver-replay");
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, "rich-dossier-spec.json"), "utf8"));
const TWO_STAGE = JSON.parse(fs.readFileSync(path.join(HERE, "two-stage-corpus-spec.json"), "utf8"));

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const git = (...args) => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const gitSafe = (...args) => { try { return git(...args); } catch { return null; } };

const DEFAULT_MAX = 9000;
const clip = (text, max) => (text.length > max ? { text: text.slice(0, max), truncated: true, total_chars: text.length } : { text, truncated: false, total_chars: text.length });
const numbered = (lines, startLine) => lines.map((l, i) => `${String(startLine + i).padStart(5)}| ${l}`).join("\n");

// ── git-backed section kinds ───────────────────────────────────────────────────────────────────
function showLines(commit, p) {
  const raw = gitSafe("show", `${commit}:${p}`);
  if (raw === null) throw new Error(`path not in commit: ${commit.slice(0, 9)}:${p}`);
  return raw.split("\n");
}

function secGitFile(s, ctx) {
  const lines = showLines(ctx.commit, s.path);
  const ranges = s.ranges || [[1, lines.length]];
  const parts = ranges.map(([a, b]) => numbered(lines.slice(a - 1, b), a));
  const { text, truncated, total_chars } = clip(parts.join("\n  ...\n"), s.max_chars || DEFAULT_MAX);
  return { text, provenance: { kind: "git_file", commit: ctx.commit, path: s.path, ranges, command: `git show ${ctx.commit.slice(0, 12)}:${s.path}`, truncated, total_chars } };
}

// A top-level function: [preceding contiguous comment block] .. first column-0 closing brace.
function secGitFunc(s, ctx) {
  const lines = showLines(ctx.commit, s.path);
  const re = new RegExp(`^(export\\s+)?(async\\s+)?function\\s+${s.symbol}\\b`);
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) throw new Error(`function ${s.symbol} not found in ${ctx.commit.slice(0, 9)}:${s.path}`);
  let end = start;
  while (end < lines.length && lines[end] !== "}") end++;
  let from = start;
  if (!s.no_doc) while (from > 0 && /^\s*(\/\/|\/\*\*|\*|\*\/)/.test(lines[from - 1])) from--;
  const { text, truncated, total_chars } = clip(numbered(lines.slice(from, end + 1), from + 1), s.max_chars || DEFAULT_MAX);
  return { text, provenance: { kind: "git_file", commit: ctx.commit, path: s.path, ranges: [[from + 1, end + 1]], symbol: s.symbol, command: `git show ${ctx.commit.slice(0, 12)}:${s.path}  (function ${s.symbol}${s.no_doc ? "" : " + leading doc comment"})`, truncated, total_chars } };
}

function secGitGrep(s, ctx) {
  const flags = s.fixed ? "-nF" : "-nE";
  const args = ["grep", flags, ...(s.context ? [`-C${s.context}`] : []), s.pattern, ctx.commit, "--", ...s.pathspec];
  let out = gitSafe(...args) || "";
  const prefix = `${ctx.commit}:`;
  let rows = out.split("\n").filter(Boolean).map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l.replace(new RegExp(`^${ctx.commit}[-:]`), "")));
  if (s.exclude_re) { const ex = new RegExp(s.exclude_re); rows = rows.filter((l) => !ex.test(l)); }
  const hits = rows.filter((l) => !/^--$/.test(l)).length;
  const max = s.max_lines || 80;
  const truncated = rows.length > max;
  const body = rows.slice(0, max).map((l) => (l.length > 230 ? l.slice(0, 230) + " …" : l)).join("\n");
  const text = body + (truncated ? `\n… (${rows.length - max} more lines omitted)` : "") + (rows.length === 0 ? "(no matches)" : "");
  return { text, provenance: { kind: "git_grep", commit: ctx.commit, command: `git grep ${flags}${s.context ? ` -C${s.context}` : ""} '${s.pattern}' ${ctx.commit.slice(0, 12)} -- ${s.pathspec.join(" ")}`, hit_lines: hits, truncated } };
}

function secGitCat(s, ctx) {
  let p = s.path;
  if (s.glob_prefix) {
    // -z: NUL-delimited, so non-ASCII file names (the goal files are Chinese) are not C-quoted.
    const names = git("ls-tree", "--name-only", "-r", "-z", ctx.commit, "--", s.dir).split("\0").filter(Boolean);
    const hit = names.filter((n) => path.basename(n).startsWith(s.glob_prefix));
    if (hit.length !== 1) throw new Error(`glob ${s.dir}/${s.glob_prefix}* matched ${hit.length} at ${ctx.commit.slice(0, 9)}`);
    p = hit[0];
  }
  const raw = gitSafe("show", `${ctx.commit}:${p}`);
  if (raw === null) throw new Error(`path not in commit: ${ctx.commit.slice(0, 9)}:${p}`);
  const { text, truncated, total_chars } = clip(raw, s.max_chars || DEFAULT_MAX);
  return { text: text + (truncated ? `\n… [truncated: first ${text.length} of ${total_chars} chars]` : ""), provenance: { kind: "git_file", commit: ctx.commit, path: p, ranges: null, command: `git show ${ctx.commit.slice(0, 12)}:${p}`, truncated, total_chars } };
}

function secGitLs(s, ctx) {
  const rows = git("ls-tree", "-l", ctx.commit, `${s.path}/`).split("\n").filter(Boolean).map((l) => { const m = l.match(/^\S+\s+(\S+)\s+\S+\s+(\S+)\t(.+)$/); return m ? `${m[2].padStart(8)}  ${m[3]}` : l; });
  return { text: rows.join("\n"), provenance: { kind: "git_ls", commit: ctx.commit, path: s.path, command: `git ls-tree -l ${ctx.commit.slice(0, 12)} ${s.path}/`, entries: rows.length } };
}

// ── ArchGuard-derived section kinds (arch.json of a worktree whose code == stage commit) ───────
const archCache = new Map();
function loadArch(wt) {
  if (archCache.has(wt)) return archCache.get(wt);
  const qdir = path.join(wt, ".archguard", "query");
  const scope = fs.readdirSync(qdir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(qdir, e.name, "arch.json"))
    .filter((f) => fs.existsSync(f)).map((f) => ({ f, d: JSON.parse(fs.readFileSync(f, "utf8")) })).filter((x) => x.d.language === "typescript").sort((a, b) => b.d.entities.length - a.d.entities.length)[0];
  const fileOf = (id) => { const m = String(id).match(/^(.*?\.(?:ts|tsx|mjs|js|cjs))\./); return m ? m[1] : null; };
  const pkgOfFile = (f) => (f ? path.posix.dirname(f) : null);
  const rel = [];
  for (const r of scope.d.relations) {
    if (r.type !== "dependency") continue;
    const sf = fileOf(r.source), tf = fileOf(r.target);
    if (!sf || !tf) continue;
    rel.push({ sf, tf, sp: pkgOfFile(sf), tp: pkgOfFile(tf) });
  }
  const out = { rel, entities: scope.d.entities.length, sourceFiles: scope.d.sourceFiles.length };
  archCache.set(wt, out);
  return out;
}

function tarjan(nodes, adj) {
  let idx = 0; const st = []; const on = new Set(); const index = new Map(); const low = new Map(); const sccs = [];
  const visit = (v) => {
    index.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
    for (const w of adj.get(v) || []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); sccs.push(c); }
  };
  for (const n of nodes) if (!index.has(n)) visit(n);
  return sccs;
}

const archProv = (ctx, extra) => ({ kind: "archguard_derived", tool: "ArchGuard 0.1.38 analyze (TypeScript scope)", analysis_commit: ctx.case.analysis_commit, stage_commit: ctx.commit, ...ctx.identity, derivation: "package = directory of the entity's source file; edge = one 'dependency' relation in arch.json", ...extra });

function secArchScc(s, ctx) {
  const a = loadArch(ctx.case.archguard_wt);
  const adj = new Map(); const nodes = new Set();
  for (const r of a.rel) { nodes.add(r.sp); nodes.add(r.tp); if (r.sp !== r.tp) { if (!adj.has(r.sp)) adj.set(r.sp, new Set()); adj.get(r.sp).add(r.tp); } }
  const sccs = tarjan([...nodes], adj).filter((c) => c.length > 1).sort((x, y) => y.length - x.length);
  const lines = [`scanned: ${a.sourceFiles} source files, ${a.entities} entities, ${a.rel.length} file-level dependency relations`, `package-level strongly-connected components with more than one member: ${sccs.length}`];
  sccs.forEach((c, i) => lines.push(`  SCC#${i + 1} size=${c.length}: ${c.sort().join(" | ")}`));
  if (!sccs.length) lines.push("  (none)");
  return { text: lines.join("\n"), provenance: archProv(ctx, { query: "package-level Tarjan SCC over arch.json dependency relations", sccs: sccs.map((c) => c.length) }) };
}

function secArchPkgEdges(s, ctx) {
  const a = loadArch(ctx.case.archguard_wt);
  const match = (p, spec) => (spec.endsWith("*") ? p.startsWith(spec.slice(0, -1)) : p === spec);
  const sel = a.rel.filter((r) => r.sp !== r.tp && match(r.sp, s.from) && match(r.tp, s.to));
  const byTarget = new Map(); for (const r of sel) byTarget.set(r.tp, (byTarget.get(r.tp) || 0) + 1);
  const lines = [`edges  ${s.from}  ->  ${s.to}  :  ${sel.length} dependency relations`];
  for (const [t, n] of [...byTarget].sort((x, y) => y[1] - x[1])) lines.push(`  ${String(n).padStart(4)}  -> ${t}`);
  if (s.pairs) {
    const pairs = new Map(); for (const r of sel) { const k = `${r.sf}  ->  ${r.tf}`; pairs.set(k, (pairs.get(k) || 0) + 1); }
    lines.push("file pairs (relations per pair):");
    [...pairs].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, s.max_pairs || 40).forEach(([k, n]) => lines.push(`  ${String(n).padStart(3)}  ${k}`));
    if (pairs.size > (s.max_pairs || 40)) lines.push(`  … ${pairs.size - (s.max_pairs || 40)} more pairs omitted`);
  }
  return { text: lines.join("\n"), provenance: archProv(ctx, { query: `edges ${s.from} -> ${s.to}`, relations: sel.length }) };
}

function secArchMatrix(s, ctx) {
  const a = loadArch(ctx.case.archguard_wt);
  const mem = s.members; const cnt = new Map();
  for (const r of a.rel) if (r.sp !== r.tp && mem.includes(r.sp) && mem.includes(r.tp)) cnt.set(`${r.sp}\t${r.tp}`, (cnt.get(`${r.sp}\t${r.tp}`) || 0) + 1);
  const short = (p) => p.replace("packages/quay/src", "root").replace(/^root\//, "");
  const lines = ["relation counts between the members of the cycle (row -> column), cross-package only:"];
  for (const f of mem) lines.push(`  ${short(f).padEnd(14)} -> ` + mem.filter((t) => t !== f).map((t) => `${short(t)}:${cnt.get(`${f}\t${t}`) || 0}`).join("  "));
  return { text: lines.join("\n"), provenance: archProv(ctx, { query: "member-to-member relation counts", members: mem }) };
}

function secArchMetrics(s, ctx) {
  const a = loadArch(ctx.case.archguard_wt);
  const m = new Map();
  for (const r of a.rel) { if (r.sp === r.tp) continue; for (const [p, k] of [[r.sp, "out"], [r.tp, "in"]]) { if (!p.startsWith(s.prefix)) continue; const o = m.get(p) || { in: 0, out: 0 }; o[k]++; m.set(p, o); } }
  const rows = [...m].sort((x, y) => y[1].in - x[1].in).slice(0, s.top || 12).map(([p, o]) => `  fanIn=${String(o.in).padStart(4)} fanOut=${String(o.out).padStart(4)}  ${p}`);
  const note = "(computed here from file-level 'dependency' relations only; ArchGuard's own package-metrics tool also counts composition/inheritance/call relations, so its absolute numbers are larger)";
  return { text: [`package fan-in / fan-out (cross-package dependency relations), prefix ${s.prefix}:`, note, ...rows].join("\n"), provenance: archProv(ctx, { query: `package metrics for ${s.prefix}*` }) };
}

function secEvidenceFile(s, ctx) {
  const p = path.join(HERE, "dossier-evidence", s.file);
  const raw = fs.readFileSync(p, "utf8");
  const { text, truncated, total_chars } = clip(raw, s.max_chars || DEFAULT_MAX);
  return { text, provenance: { kind: "recorded_tool_output", tool: s.tool, file: `docs/analysis/dossier-evidence/${s.file}`, analysis_commit: ctx.case.analysis_commit, file_sha256: sha(raw), note: s.note || null, truncated, total_chars } };
}

function secAuthored(s, ctx) {
  const c = TWO_STAGE.cases.find((x) => x.id === ctx.case.id);
  const items = c[s.from_spec];
  const text = (Array.isArray(items) ? items : [items]).map((x, i) => `${i + 1}. ${x}`).join("\n");
  return { text, provenance: { kind: "authored_findings", source: `docs/analysis/two-stage-corpus-spec.json#${ctx.case.id}.${s.from_spec}`, note: "Investigation results the decision-maker had established by T1 (recorded in the goal/AC bodies at activation). Not a git excerpt.", text_sha256: sha(text) } };
}

const KINDS = { git_file: secGitFile, git_func: secGitFunc, git_grep: secGitGrep, git_cat: secGitCat, git_ls: secGitLs, arch_scc: secArchScc, arch_pkg_edges: secArchPkgEdges, arch_matrix: secArchMatrix, arch_metrics: secArchMetrics, evidence_file: secEvidenceFile, authored: secAuthored };

// ── per-case build ─────────────────────────────────────────────────────────────────────────────
function commitTime(commit) { return git("show", "-s", "--format=%cI", commit).trim(); }

function identityOf(c, commit) {
  const dirs = SPEC.scanned_dirs;
  const files = git("diff", "--name-only", c.analysis_commit, commit, "--", ...dirs).split("\n").filter(Boolean);
  return { scanned_code_identical_to_stage_commit: files.length === 0, differing_files_in_scanned_dirs: files };
}

function buildStage(c, stage) {
  const t = TWO_STAGE.cases.find((x) => x.id === c.id);
  const commit = stage === "A" ? c.t0_commit : c.t1_commit;
  const cutoff = stage === "A" ? t.t0 : t.t1;
  const ct = commitTime(commit);
  if (new Date(ct) > new Date(cutoff)) throw new Error(`${c.id} stage ${stage}: commit ${commit.slice(0, 9)} (${ct}) is AFTER cutoff ${cutoff}`);
  const ctx = { case: c, commit, identity: identityOf(c, commit) };
  const specs = stage === "A" ? c.A : [...c.A, ...c.B];
  const sections = specs.map((s) => {
    const r = KINDS[s.kind](s, ctx);
    return { id: s.id, title: s.title, kind: s.kind, provenance: r.provenance, text: r.text, bytes: Buffer.byteLength(r.text, "utf8"), text_sha256: sha(r.text) };
  });
  const ids = sections.map((x) => x.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${c.id}: duplicate section ids`);

  const stageFile = JSON.parse(fs.readFileSync(path.join(CORPUS, c.id, stage === "A" ? "stage_a.json" : "stage_b.json"), "utf8"));
  const note = " The EVIDENCE DOSSIER is raw tool output and source excerpts: it contains material unrelated to the concern (other duplicate groups, unrelated call sites, etc.) — judging relevance is part of the task. Section ids ARE the citable evidence refs.";
  const schema = JSON.parse(JSON.stringify(stageFile.task.response_schema));
  if (stage === "B") {
    // Stage B (baseline) never asked for refs, so its grounding could not be measured. With a 20-60 KB
    // dossier it can, and should be: an optional-in-baseline field becomes required here.
    schema.required = [...new Set([...(schema.required || []), "evidence_refs"])];
    schema.properties.evidence_refs = { type: "array", items: { type: "string" }, description: "dossier section ids that support the recommended slice" };
  }
  const task = { ...stageFile.task, instructions: stageFile.task.instructions + note, response_schema: schema, citable_evidence_refs: ids };
  const doc = {
    case_id: c.id, stage, stage_name: stageFile.stage_name, mode: "rich-bundle",
    cutoff, cutoff_label: stageFile.cutoff_label, cutoff_commit: commit, cutoff_commit_time: ct,
    ...(stage === "B" ? { confirmed_concern: stageFile.confirmed_concern } : {}),
    dossier: { total_bytes: sections.reduce((n, x) => n + x.bytes, 0), section_count: sections.length, sections },
    citable_evidence_refs: ids,
    task,
  };
  return doc;
}

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const c of Object.values(SPEC.cases)) {
    if (only && c.id !== only) continue;
    for (const stage of ["A", "B"]) {
      const doc = buildStage(c, stage);
      fs.writeFileSync(path.join(CORPUS, c.id, `rich_${stage.toLowerCase()}.json`), JSON.stringify(doc, null, 2) + "\n", "utf8");
      process.stderr.write(`  ${c.id} stage ${stage}: ${doc.dossier.section_count} sections, ${(doc.dossier.total_bytes / 1024).toFixed(1)} KB  commit ${doc.cutoff_commit.slice(0, 9)}  identical=${doc.dossier.sections.find((s) => s.provenance.scanned_code_identical_to_stage_commit !== undefined)?.provenance.scanned_code_identical_to_stage_commit}\n`);
    }
  }
}
export { buildStage, SPEC, KINDS };
