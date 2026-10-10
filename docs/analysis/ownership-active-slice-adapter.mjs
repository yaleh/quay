// Minimal Quay adapter for ArchGuard's Refactor Slice / Expected Delta primitive.
//
// WHAT THE PRIMITIVE IS (verified, not assumed): `docs/experiments/layer-map/slice-delta.mjs` in the
// ArchGuard repo — a deterministic EXPERIMENT script. It is NOT in the published @yalehwang/archguard
// 0.1.38 package and has no CLI/MCP entry, so Quay has no first-class consumption path. This adapter is the
// smallest honest bridge: build the explicit slice input, shell out to the script, normalise its report,
// and record exactly which script/version produced the reading. Absent script => `unavailable`
// (a capability gap), never an LLM-estimated delta.
//
// What the model supplies: a STRUCTURED cut (moves: file/from/to/symbols). What it may NOT supply: the delta.
// The negative control (restore the cut edges, the cycle must come back) is DERIVED from the graph here —
// the model cannot choose an edge it likes, and a cut that explains no edge is `not-evaluated`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { normalizeRepoPath } from "./ownership-active-contract.mjs";
import { defaultAnalyzePackageGraph } from "./ownership-active-executor.mjs";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export const SLICE_DELTA_SURFACE = Object.freeze({
  tool: "archguard docs/experiments/layer-map/slice-delta.mjs",
  shipped_in_published_package: false,
  cli: null,
  mcp: null,
  consumption: "script path (ARCHGUARD_SLICE_DELTA) — experiment, no stable interface",
});

export function resolveSliceDelta() {
  const script = process.env.ARCHGUARD_SLICE_DELTA || "/data/home/yale/work/archguard/docs/experiments/layer-map/slice-delta.mjs";
  if (!fs.existsSync(script)) return { available: false, script, surface: SLICE_DELTA_SURFACE };
  const dir = path.dirname(script);
  const git = (a) => { try { return execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 20_000 }).trim(); } catch { return null; } };
  return {
    available: true, script, surface: SLICE_DELTA_SURFACE,
    script_sha256: sha(fs.readFileSync(script)),
    archguard_repo_head: git(["rev-parse", "HEAD"]),
    script_modified_vs_head: git(["diff", "--quiet", "HEAD", "--", script]) === null,
  };
}

const internalNodes = (graph) => new Set((graph.nodes || []).filter((n) => n.type === "internal").map((n) => n.id));
const hasName = (edge, symbols) => (edge.importedNames || []).some((n) => symbols.includes(n));

/**
 * Pure: proposal.slice + package graph -> {ok, slice|reason}. No I/O.
 * `restoreEdges` are the edges INTO a move's `from` dir, originating at its `to` dir, that import a moved symbol.
 */
export function buildSliceInput({ graph, proposal, provenance }) {
  const s = proposal.slice;
  const dirs = internalNodes(graph);
  const bad = (reason, extra = {}) => ({ ok: false, reason, valid_dirs: [...dirs].sort(), ...extra });
  if (!dirs.has(s.subject)) return bad(`SUBJECT_NOT_AN_INTERNAL_DIR:${JSON.stringify(s.subject)}`);
  for (const m of s.moves) {
    if (!dirs.has(m.from)) return bad(`MOVE_FROM_NOT_AN_INTERNAL_DIR:${JSON.stringify(m.from)}`);
    if (!dirs.has(m.to)) return bad(`MOVE_TO_NOT_AN_INTERNAL_DIR:${JSON.stringify(m.to)}`);
  }
  // Which edges does this cut remove? The primitive's own rule (README, "读法与边界"): an edge INTO a moved-from dir is
  // explained iff its whole importedNames set is covered by the symbols moved out of that dir. The importer may be the
  // destination dir (the import becomes intra-dir) OR any other dir (the import is redirected to the destination).
  // The negative control is derived from the SAME rule, so the model cannot pick a convenient edge.
  const movedFrom = new Map();
  for (const m of s.moves) { const set = movedFrom.get(m.from) || new Set(); for (const x of m.symbols) set.add(x); movedFrom.set(m.from, set); }
  const restore = new Map();
  const explainedBy = [];
  for (const [from, syms] of movedFrom) {
    for (const e of graph.edges || []) {
      if (e.to !== from || e.from === from) continue;
      const names = e.importedNames || [];
      if (names.length > 0 && names.every((n) => syms.has(n))) {
        restore.set(`${e.from}\t${e.to}`, { from: e.from, to: e.to });
        explainedBy.push({ edge: `${JSON.stringify(e.from)} -> ${JSON.stringify(e.to)}`, names });
      }
    }
  }
  if (restore.size === 0) return bad("NO_EDGE_EXPLAINED_BY_MOVES", { note: "no edge into a moved-from dir has its whole imported-name set covered by the moved symbols — the cut explains no edge, so there is no delta to compute (a partial cover is not guessed or pro-rated)" });

  // dirs the cut legitimately changes: subject, move endpoints, declared consumers, AND both ends of every edge the cut
  // removes (an importer dir such as `cli` loses an edge by construction — it is not "untouched").
  const involved = new Set([s.subject, ...s.moves.flatMap((m) => [m.from, m.to]), ...(Array.isArray(s.consumers) ? s.consumers.map((c) => c.dir) : []), ...[...restore.values()].flatMap((e) => [e.from, e.to])]);
  const forbidden = [];
  for (const f of Array.isArray(s.forbidden_new_edges) ? s.forbidden_new_edges : []) {
    if (f && dirs.has(f.from) && dirs.has(f.to)) forbidden.push({ from: f.from, to: f.to });
  }
  const consumers = (Array.isArray(s.consumers) ? s.consumers : []).filter((c) => c && typeof c.file === "string" && typeof c.dir === "string" && Array.isArray(c.imports));
  return {
    ok: true,
    explained_by: explainedBy,
    slice: {
      subject: s.subject,
      concern: String(proposal.concern).slice(0, 300),
      provenance,
      proposedCut: { note: "structured cut supplied by the semantic investigator; the delta below is computed from the graph", moves: s.moves.map(({ file, from, to, symbols, note }) => ({ file, from, to, symbols, ...(note ? { note } : {}) })), consumers },
      mustNotChange: { forbiddenNewEdges: forbidden, untouchedDirs: [...dirs].filter((d) => !involved.has(d)).sort(), note: "untouchedDirs derived: every internal dir the cut does not name" },
      negativeControl: { description: "re-inject the cut edge(s); the subject's cycle membership must return to its before-state", restoreEdges: [...restore.values()] },
    },
  };
}

/** Deterministic text for the envelope — built by JS from the report, never by the model. */
export function renderDelta(r) {
  if (r.status !== "evaluated" && r.status !== "guard-violated") return `NOT COMPUTED: ${r.status}${r.reason ? ` (${r.reason})` : ""}`;
  const d = r.delta;
  const q = (x) => (x === "" ? '"" (root)' : x);
  const sub = r.subject ? q(r.subject.tracked) : "?";
  return [
    `ArchGuard slice-delta (computed, not estimated): the cycle containing ${sub}: size ${d.before.scc_size} -> ${d.after.scc_size}; members before [${d.before.members.map(q).join(", ")}] after [${d.after.members.map(q).join(", ")}]; left that cycle [${d.left.map(q).join(", ")}].`,
    `Removed edges: ${d.removed_edges.map((e) => `${q(e.from)} -> ${q(e.to)} (${e.names.join(", ")})`).join("; ") || "none"}. Added edges: ${d.added_edges.length}.`,
    `Guards: ${r.guards.violations.length ? "VIOLATED " + JSON.stringify(r.guards.violations) : "none violated"}.`,
    r.model_subject_view ? `(Tracked from the canonical subject; the model's own subject ${q(r.model_subject_view.subject)} sees size ${r.model_subject_view.delta.before.scc_size} -> ${r.model_subject_view.delta.after.scc_size}.)` : "",
  ].filter(Boolean).join(" ");
}

export function renderNegativeControl(r) {
  const n = r.negative_control;
  if (!n) return "";
  return `Computed negative control: re-adding ${n.restore_edges.map((e) => `${JSON.stringify(e.from)} -> ${JSON.stringify(e.to)}`).join(", ")} returns the subject's cycle to [${n.members_after_restore.join(", ")}]; falsified=${n.falsified}.`;
}

/** Normalise the primitive's report into the adapter's result. */
export function normalizeReport(report, exit_code) {
  const cd = report.computedDelta || {}, nc = report.negativeControl || {}, cur = report.current || {};
  return {
    delta: {
      before: { scc_size: cur.sccSize, members: cur.sccMembers || [] },
      after: { scc_size: (cd.sccAfter || []).length, members: cd.sccAfter || [] },
      left: cd.sccLeft || [],
      removed_edges: (cd.removedEdges || []).map((e) => ({ from: e.from, to: e.to, becomes: e.becomes, names: e.importedNames || [] })),
      added_edges: cd.addedEdges || [],
      why_left: cd.whyLeft || [],
      assumptions: (report.proposedCut || {}).assumptions || [],
    },
    guards: { violations: (report.mustNotChange || {}).violations || [], forbidden_new_edges: (report.mustNotChange || {}).forbiddenNewEdges || [] },
    negative_control: { restore_edges: nc.restoreEdges || [], members_after_restore: nc.subjectSccMembersAfterRestore || [], subject_back_in_scc: !!nc.subjectBackInScc, falsified: !!nc.falsified },
    exit_code,
  };
}

/**
 * Compute the expected delta for a propose_slice(package-cycle) proposal.
 * deps (injectable): { sliceDelta: resolveSliceDelta(), analyzePackageGraph(absRoot), git(args), runScript(script, argv) }.
 */
export function computeSliceDelta({ root, commit, proposal, deps = {}, now = () => new Date().toISOString() }) {
  const sd = deps.sliceDelta || resolveSliceDelta();
  const prov = (extra = {}) => ({ tool: { ...SLICE_DELTA_SURFACE, script: sd.script, script_sha256: sd.script_sha256 ?? null, archguard_repo_head: sd.archguard_repo_head ?? null, script_modified_vs_head: sd.script_modified_vs_head ?? null }, ref_commit: commit, ts: now(), ...extra });
  if (!sd.available) {
    return { status: "unavailable", reason: "SLICE_DELTA_SCRIPT_NOT_FOUND", gap: { capability: "archguard.slice_delta", surface: SLICE_DELTA_SURFACE, reason: "the Refactor Slice / Expected Delta primitive is an ArchGuard-repo experiment script, not part of the installed package" }, provenance: prov() };
  }
  const rawRoot = normalizeRepoPath(proposal.slice.scope_root ?? "");
  const scopeRel = proposal.slice.scope_root === "" ? "" : rawRoot.ok ? rawRoot.path : null;
  if (scopeRel === null) return { status: "not-evaluated", reason: `SCOPE_ROOT_INVALID:${rawRoot.reason}`, provenance: prov() };
  const git = deps.git || ((a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", timeout: 30_000 }));
  let treeSha = null;
  try { treeSha = git(["rev-parse", `${commit}:${scopeRel}`]).trim(); } catch { return { status: "not-evaluated", reason: `SCOPE_ROOT_NOT_A_TREE_AT_REF:${scopeRel}`, provenance: prov() }; }
  let changed = [];
  try { changed = git(["diff", "--name-only", "HEAD", "--", scopeRel || "."]).split("\n").filter(Boolean); } catch { /* unknown => reported below */ }

  const absScope = path.join(root, scopeRel);
  let built;
  try { built = (deps.analyzePackageGraph || defaultAnalyzePackageGraph)(absScope); } catch (e) { return { status: "not-evaluated", reason: `PACKAGE_GRAPH_BUILD_FAILED:${String(e.message).slice(0, 120)}`, provenance: prov({ scope_root: scopeRel, tree_sha: treeSha }) }; }
  if (!built) return { status: "unavailable", reason: "ARCHGUARD_CLI_NOT_FOUND", gap: { capability: "archguard.cli", reason: "cannot build the package-level ArchJSON" }, provenance: prov() };
  const graph = built.json?.extensions?.tsAnalysis?.moduleGraph;
  if (!graph) return { status: "not-evaluated", reason: "NO_MODULE_GRAPH_IN_ARCHJSON", provenance: prov({ scope_root: scopeRel, tree_sha: treeSha }) };

  const provenance = { repo: root, ref: commit, commit, worktree: `analysed subtree ${scopeRel || "."} treeSha ${treeSha}`, scope_root: scopeRel, tracked_changes_in_scope: changed.slice(0, 10) };
  const built2 = buildSliceInput({ graph, proposal, provenance });
  const baseProv = prov({ scope_root: scopeRel, tree_sha: treeSha, graph_sha256: sha(JSON.stringify(graph)), snapshot_matches_ref: changed.length === 0, tracked_changes_in_scope: changed.slice(0, 10) });
  if (!built2.ok) return { status: "not-evaluated", reason: built2.reason, detail: { valid_dirs: built2.valid_dirs, note: built2.note }, provenance: baseProv };

  // run the primitive on files in a temp dir
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "own-active-sd-"));
  const archFile = path.join(tmp, "current.arch.json");
  fs.writeFileSync(archFile, JSON.stringify(built.json));
  const run = deps.runScript || ((script, argv) => { const r = spawnSync("node", [script, ...argv], { encoding: "utf8", timeout: 120_000 }); return { status: r.status, stdout: r.stdout, stderr: r.stderr }; });
  let seq = 0;
  const evaluate = (slice) => {
    const sliceFile = path.join(tmp, `slice-${++seq}.json`), outFile = path.join(tmp, `report-${seq}.json`);
    fs.writeFileSync(sliceFile, JSON.stringify(slice));
    const r = run(sd.script, [archFile, "--slice", sliceFile, "--json", outFile]);
    let report = null;
    try { report = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch { /* handled by caller */ }
    return { r, report, slice_sha256: sha(JSON.stringify(slice)) };
  };
  const first = evaluate(built2.slice);
  const full = { ...baseProv, slice_sha256: first.slice_sha256, explained_by: built2.explained_by };
  if (!first.report) return { status: "not-evaluated", reason: `NO_REPORT:exit=${first.r.status}`, provenance: full };
  if (first.report.status !== "evaluated" || first.r.status === 2) return { status: "not-evaluated", reason: String(first.report.reason || "primitive reported not-evaluated").slice(0, 300), provenance: full };

  // The primitive reports the cycle AS SEEN FROM `subject`. If the model chose the dir that LEAVES (e.g. fan-in), `sccLeft`
  // lists everyone else and a naive "size 6 -> 1" reads as nonsense. Headline reading = a CANONICAL subject chosen by rule
  // (a cycle member that is not a moved-from dir; the first move's destination if it is one). The model's own view is kept.
  const movedFrom = new Set(proposal.slice.moves.map((m) => m.from));
  const members = (first.report.current || {}).sccMembers || [];
  const cand = members.filter((m) => !movedFrom.has(m));
  const firstTo = proposal.slice.moves[0].to;
  const canonical = cand.includes(firstTo) ? firstTo : [...cand].sort()[0];
  let head = first, headSubject = proposal.slice.subject, modelView = null;
  if (canonical !== undefined && canonical !== proposal.slice.subject) {
    const alt = buildSliceInput({ graph, proposal: { ...proposal, slice: { ...proposal.slice, subject: canonical } }, provenance });
    if (alt.ok) {
      const second = evaluate(alt.slice);
      if (second.report && second.report.status === "evaluated" && second.r.status !== 2) {
        modelView = { subject: proposal.slice.subject, ...normalizeReport(first.report, first.r.status) };
        head = second; headSubject = canonical;
      }
    }
  }
  const n = normalizeReport(head.report, head.r.status);
  return {
    status: head.r.status === 1 ? "guard-violated" : "evaluated", ...n,
    subject: { tracked: headSubject, model_chosen: proposal.slice.subject, rule: headSubject === proposal.slice.subject ? "model subject (already a surviving cycle member)" : "canonical: surviving cycle member (first move destination, else first non-moved-from member)" },
    ...(modelView ? { model_subject_view: modelView } : {}),
    provenance: { ...full, slice_sha256: head.slice_sha256 }, slice_input: built2.slice,
  };
}
