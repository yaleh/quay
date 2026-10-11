// Quay adapter for ArchGuard's Refactor Slice / Expected Delta capability — PUBLISHED PRODUCT SURFACE ONLY.
//
// Dependency: the installed `@yalehwang/archguard` (>= 0.1.39) CLI subcommand `archguard slice-delta`
// (MCP twin: `archguard_simulate_refactor_slice`). Both are the released, versioned interface for the same
// deterministic simulation: the caller supplies an explicit cut, ArchGuard computes the delta and a
// negative control, and produces no pass/fail gate. The adapter resolves the INSTALLED CLI, probes its
// version and subcommand, and records version + command + input/output hashes + the tool's own provenance
// on every reading.
//
// ⛔ It does NOT read, import, or shell out to anything inside the ArchGuard SOURCE repository (the earlier
// experiment script path is retired; a test forbids the strings). Missing/too-old ArchGuard => an explicit
// `unavailable` capability gap — never an LLM-estimated delta.
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
import { defaultAnalyzePackageGraph, resolveArchguardCli, archguardCliVersion } from "./ownership-active-executor.mjs";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export const MIN_ARCHGUARD_VERSION = "0.1.39";
export const SLICE_DELTA_SURFACE = Object.freeze({
  surface: "archguard-cli",
  command: "archguard slice-delta",
  mcp_equivalent: "archguard_simulate_refactor_slice",
  shipped_in_published_package: true,
  min_version: MIN_ARCHGUARD_VERSION,
});

/** "0.1.39" >= "0.1.39"; non-numeric/missing => false (a version we cannot read is not a version we can rely on). */
export function versionAtLeast(v, min = MIN_ARCHGUARD_VERSION) {
  const a = String(v || "").match(/^(\d+)\.(\d+)\.(\d+)/), b = String(min).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) { if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]); }
  return true;
}

/**
 * Resolve the INSTALLED surface. deps (injectable): { cli, version(cli), probeSubcommand(cli) -> {status} }.
 * Returns {available, cli, version, reason?}. Never throws.
 */
export function resolveSliceDelta(deps = {}) {
  const cli = deps.cli !== undefined ? deps.cli : resolveArchguardCli();
  if (!cli) return { available: false, reason: "ARCHGUARD_CLI_NOT_INSTALLED", surface: SLICE_DELTA_SURFACE };
  const version = (deps.version || archguardCliVersion)(cli);
  if (!versionAtLeast(version)) return { available: false, cli, version: version ?? null, reason: `ARCHGUARD_VERSION_TOO_OLD:${version ?? "unreadable"}<${MIN_ARCHGUARD_VERSION}`, surface: SLICE_DELTA_SURFACE };
  const probe = (deps.probeSubcommand || ((c) => spawnSync("node", [c, "slice-delta", "--help"], { encoding: "utf8", timeout: 30_000 })))(cli);
  if (probe.status !== 0) return { available: false, cli, version, reason: "SLICE_DELTA_SUBCOMMAND_MISSING", surface: SLICE_DELTA_SURFACE };
  return { available: true, cli, version, surface: SLICE_DELTA_SURFACE };
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

  // ── Partial-cover complement: which names STAY? ─────────────────────────────────────────────────
  // An edge into a moved-from dir whose importedNames are only PARTLY covered (≥1 name moves, ≥1 does not)
  // is refused by ArchGuard (`切法覆盖不足`) unless the caller declares the remaining names as
  // `proposedCut.stays`. The complement is computed from the SAME real edges — a name is emitted only if it
  // literally occurs in some edge's `importedNames` — aggregated per moved-from dir, and emitted as
  // `{ dir, symbols }[]` (the primitive's SliceStay shape). It is NOT a "make it pass" patch: it enters the
  // primitive's documented PARTIAL-MIGRATION path, where the original edge SURVIVES (it is not removed) and
  // each genuinely-moved symbol adds a retargeted edge. A declaration that ArchGuard cannot reconcile is
  // refused HERE rather than emitted: the same name declared staying under two different dirs, or a name both
  // moved and staying, makes the report `目的地冲突` => not-evaluated. The honest degradation is to emit no
  // `stays` at all and let the cut stay under-covered — never a fabricated success.
  // (Two further invariants hold BY CONSTRUCTION and are asserted on the output in the test rather than
  //  guarded here: a declared name always occurs on a real edge's `importedNames`, and the declared set is
  //  always disjoint from every `moves[].symbols` — both follow from `allMoved` below.)
  const allMoved = new Set();
  for (const [, syms] of movedFrom) for (const x of syms) allMoved.add(x);
  const staysByDir = new Map();      // destination dir -> Set(name) that stays there
  const stayedOwners = new Map();    // name -> Set(dir) it was seen staying in
  // Scope: EVERY internal edge the cut touches — the primitive decides "touched" by imported NAME
  // (`names.some(n => destOfSymbol.has(n))`), NOT by `e.to` being a moved-from dir. An edge `X -> Y` whose
  // importedNames merely CONTAIN a moved name is reconciled too (the name may be re-exported through Y), so
  // its non-moved names must be declared staying in Y as well. Covering only edges INTO a moved-from dir
  // leaves exactly those collateral edges uncovered.
  for (const e of graph.edges || []) {
    if (e.from === e.to || !dirs.has(e.to)) continue;
    const names = e.importedNames || [];
    if (!names.some((n) => allMoved.has(n))) continue;   // the cut does not touch this edge at all
    for (const n of names) {
      if (allMoved.has(n)) continue;                     // this name is moved, not staying
      if (!staysByDir.has(e.to)) staysByDir.set(e.to, new Set());
      staysByDir.get(e.to).add(n);
      if (!stayedOwners.has(n)) stayedOwners.set(n, new Set());
      stayedOwners.get(n).add(e.to);
    }
  }
  const crossDir = [...stayedOwners.entries()].filter(([, owners]) => owners.size > 1).map(([n]) => n).sort();
  let stays = [], staysSkipped = null;
  if (staysByDir.size === 0) staysSkipped = null;                                  // nothing partial — byte-identical output
  else if (crossDir.length) staysSkipped = `CROSS_DIR_CONFLICT:${crossDir.join(",")}`;
  else stays = [...staysByDir.entries()].map(([dir, set]) => ({ dir, symbols: [...set].sort() })).sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  const partialEdges = stays.length === 0 ? [] : (graph.edges || []).filter((e) => e.from !== e.to && dirs.has(e.to) && (e.importedNames || []).some((n) => allMoved.has(n)) && (e.importedNames || []).some((n) => !allMoved.has(n))).map((e) => ({ from: e.from, to: e.to }));

  // dirs the cut legitimately changes: subject, move endpoints, declared consumers, AND both ends of every edge the cut
  // removes (an importer dir such as `cli` loses an edge by construction — it is not "untouched") — and both ends of
  // every PARTIAL edge (its importer keeps the surviving edge but gains a retargeted one, so it is not "untouched" either).
  const involved = new Set([s.subject, ...s.moves.flatMap((m) => [m.from, m.to]), ...(Array.isArray(s.consumers) ? s.consumers.map((c) => c.dir) : []), ...[...restore.values()].flatMap((e) => [e.from, e.to]), ...partialEdges.flatMap((e) => [e.from, e.to])]);
  const forbidden = [];
  for (const f of Array.isArray(s.forbidden_new_edges) ? s.forbidden_new_edges : []) {
    if (f && dirs.has(f.from) && dirs.has(f.to)) forbidden.push({ from: f.from, to: f.to });
  }
  const consumers = (Array.isArray(s.consumers) ? s.consumers : []).filter((c) => c && typeof c.file === "string" && typeof c.dir === "string" && Array.isArray(c.imports));
  return {
    ok: true,
    explained_by: explainedBy,
    stays,
    stays_skipped: staysSkipped,
    partial_edges: partialEdges,
    slice: {
      subject: s.subject,
      concern: String(proposal.concern).slice(0, 300),
      provenance,
      proposedCut: { note: "structured cut supplied by the semantic investigator; the delta below is computed from the graph", moves: s.moves.map(({ file, from, to, symbols, note }) => ({ file, from, to, symbols, ...(note ? { note } : {}) })), consumers, ...(stays.length ? { stays } : {}) },
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
    `Guards: ${r.guards.violations.length ? "must-not-change VIOLATED " + JSON.stringify(r.guards.violations) : "no must-not-change violation"}; negative control falsified=${r.negative_control ? r.negative_control.falsified : "n/a"}${r.negative_control && !r.negative_control.falsified ? " (the cut does not change the cycle's membership, so there is nothing for the control to restore)" : ""}.`,
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
    guards: {
      clean: report.guards ? !!report.guards.clean : ((report.mustNotChange || {}).violations || []).length === 0,
      violations: (report.mustNotChange || {}).violations || [],
      forbidden_new_edges: (report.mustNotChange || {}).forbiddenNewEdges || [],
    },
    strengthened_edges: cd.strengthenedEdges || [],
    // Per-edge reconciliation, emitted by ArchGuard only on the partial-migration path (a `stays` clause /
    // a multi-destination or barrel edge). Read it to pin a claim on ONE edge's own entry instead of on the
    // report-wide status — the primitive matches coverage by symbol NAME, not by edge, so a name declared
    // staying for dir A also settles the same-named import on an edge into dir B.
    accounting: (report.accounting || []).map((a) => ({ edge: a.edge, names: a.names || [], moving: a.moving || [], staying: a.staying || [], unaccounted: a.unaccounted || [], destinations: a.destinations || [], barrel: !!a.barrel, certainty: a.certainty ?? null, ...(a.survives ? { survives: true, strength: a.strength ?? null } : {}) })),
    affected_consumers: (report.affectedConsumers || []).map((c) => ({ edge: c.edge, source_dir: c.sourceDir, moved_from_dir: c.movedFromDir, moved_to_dir: c.movedToDir, imported_names: c.importedNames || [], becomes: c.becomes })),
    negative_control: { restore_edges: nc.restoreEdges || [], members_after_restore: nc.subjectSccMembersAfterRestore || [], subject_back_in_scc: !!nc.subjectBackInScc, falsified: !!nc.falsified },
    exit_code,
  };
}

/**
 * Compute the expected delta for a propose_slice(package-cycle) proposal via the INSTALLED ArchGuard CLI.
 * deps (injectable): { sliceDelta: resolveSliceDelta(), analyzePackageGraph(absRoot), git(args), runCli(cli, argv) }.
 */
export function computeSliceDelta({ root, commit, proposal, deps = {}, now = () => new Date().toISOString() }) {
  const sd = deps.sliceDelta || resolveSliceDelta();
  const prov = (extra = {}) => ({ surface: SLICE_DELTA_SURFACE, archguard_version: sd.version ?? null, cli_path: sd.cli ?? null, ref_commit: commit, ts: now(), ...extra });
  if (!sd.available) {
    return { status: "unavailable", reason: sd.reason || "SLICE_DELTA_UNAVAILABLE", gap: { capability: "archguard.slice_delta", surface: SLICE_DELTA_SURFACE, installed_version: sd.version ?? null, reason: `the released ArchGuard slice-delta surface is not usable here (${sd.reason || "unavailable"}); requires @yalehwang/archguard >= ${MIN_ARCHGUARD_VERSION}` }, provenance: prov() };
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
  const archText = JSON.stringify(built.json);
  const baseProv = prov({ scope_root: scopeRel, tree_sha: treeSha, graph_sha256: sha(JSON.stringify(graph)), arch_sha256: sha(archText), snapshot_matches_ref: changed.length === 0, tracked_changes_in_scope: changed.slice(0, 10) });
  if (!built2.ok) return { status: "not-evaluated", reason: built2.reason, detail: { valid_dirs: built2.valid_dirs, note: built2.note }, provenance: baseProv };

  // run the released CLI on files in a temp dir
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "own-active-sd-"));
  const archFile = path.join(tmp, "current.arch.json");
  fs.writeFileSync(archFile, archText);
  const runCli = deps.runCli || ((cli, argv) => { const r = spawnSync("node", [cli, ...argv], { encoding: "utf8", timeout: 120_000 }); return { status: r.status, stdout: r.stdout, stderr: r.stderr }; });
  let seq = 0;
  const evaluate = (slice) => {
    const sliceFile = path.join(tmp, `slice-${++seq}.json`), outFile = path.join(tmp, `report-${seq}.json`);
    fs.writeFileSync(sliceFile, JSON.stringify(slice));
    const argv = ["slice-delta", "--arch", archFile, "--slice", sliceFile, "--root", root, "--json", outFile];
    const r = runCli(sd.cli, argv);
    let report = null, reportText = null;
    try { reportText = fs.readFileSync(outFile, "utf8"); report = JSON.parse(reportText); } catch { /* handled by caller */ }
    return { r, report, slice_sha256: sha(JSON.stringify(slice)), report_sha256: reportText ? sha(reportText) : null, command: `archguard slice-delta --arch <arch.json> --slice <slice.json> --root ${root} --json <report.json>` };
  };
  const first = evaluate(built2.slice);
  const full = { ...baseProv, slice_sha256: first.slice_sha256, report_sha256: first.report_sha256, command: first.command, exit_code: first.r.status, explained_by: built2.explained_by,
    tool_reported: first.report?.provenance?.tool ?? null, provenance_consistency: first.report?.provenance?.provenanceConsistency ?? null };
  if (!first.report) return { status: "not-evaluated", reason: `NO_REPORT:exit=${first.r.status}`, provenance: full };
  if (first.report.status !== "evaluated" || first.r.status === 2) {
    // Honesty signal (rule 3b): if we DECLARED a partial cover (`stays`) and the tool still refused for a
    // coverage shortfall, the installed CLI does not implement the `stays` clause — the declaration is inert
    // here. Distinguish "the declaration worked" from "the tool ignored it" instead of reporting one shape.
    const declared = built2.slice.proposedCut.stays || [];
    const reason = String(first.report.reason || "ArchGuard slice-delta reported not-evaluated").slice(0, 300);
    const ignored = declared.length > 0 && /覆盖不足|uncovered/i.test(reason);
    return { status: "not-evaluated", reason, provenance: full, ...(declared.length ? { stays_declared: declared, stays_ignored_by_tool: ignored } : {}) };
  }

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
  const reason = head.r.status !== 1 ? null
    : n.guards.violations.length ? "MUST_NOT_CHANGE_VIOLATED"
    : !n.negative_control.falsified ? "NEGATIVE_CONTROL_NOT_FALSIFIED:the cut leaves the cycle's membership unchanged (computed, not a tool failure)"
    : "GUARD_TRIGGERED";
  return {
    status: head.r.status === 1 ? "guard-violated" : "evaluated", ...(reason ? { reason } : {}), ...n,
    subject: { tracked: headSubject, model_chosen: proposal.slice.subject, rule: headSubject === proposal.slice.subject ? "model subject (already a surviving cycle member)" : "canonical: surviving cycle member (first move destination, else first non-moved-from member)" },
    ...(modelView ? { model_subject_view: modelView } : {}),
    provenance: { ...full, slice_sha256: head.slice_sha256, report_sha256: head.report_sha256, exit_code: head.r.status,
      tool_reported: head.report?.provenance?.tool ?? full.tool_reported, provenance_consistency: head.report?.provenance?.provenanceConsistency ?? full.provenance_consistency },
    slice_input: built2.slice,
  };
}
