// ownership/architecture ACTIVE INVESTIGATION — the declarative contract (PURE: no I/O, no clock, no LLM).
//
// One round = the model chooses ONE evidence request (or a terminal action); a deterministic gate admits
// or refuses it; a bounded executor runs it; the result is appended with provenance. This file is the
// whole policy surface: what may be requested, how much, and what a terminal proposal must contain.
// Nothing here can write, create a task/goal, or call a model.
//
// Division of labour (ADR-033, unchanged): the model only (a) picks the next request, (b) updates its
// concern hypothesis, (c) says whether evidence is sufficient, (d) proposes a candidate slice. Schema,
// budgets, tool allow-list, path scope, dedup and admission are all decided HERE, in plain JS.
//
// Reuses the existing shadow envelope (`ownership-shadow-proposer.mjs`): a terminal proposal is
// converted to that envelope and still passes its `deterministicGate`.

export const CONTRACT_VERSION = "ownership-active-investigation/1";

/** Hard budgets. Exhaustion is a TERMINAL abstain (`not-enough-evidence`), never a guess. */
export const DEFAULT_BUDGET = Object.freeze({
  max_rounds: 8,                    // model turns, including the terminal one and refused requests
  max_evidence_requests: 6,         // requests that actually reach a tool
  max_total_evidence_bytes: 90_000, // sum of evidence text kept in the log
  max_result_bytes: 9_000,          // per-request clip
  max_read_lines: 160,              // per read_file range
  max_grep_hits: 50,
  max_grep_paths: 5,
});

export const EVIDENCE_KINDS = Object.freeze(["read_file", "grep", "archguard_query"]);

/**
 * ArchGuard query kinds. `implemented:false` kinds are DECLARED so the model can name what it needs and the
 * result is an explicit `capability_gap` — never a fabricated reading and never a silent empty answer.
 * Gaps are facts about the production tool surface, recorded with the surfaces that DO exist.
 */
export const ARCHGUARD_QUERY_KINDS = Object.freeze({
  package_cycles:   { implemented: true,  args: [] },
  // directory-level edges (with imported names) from ArchGuard's own module graph — the same artefact the slice primitive consumes
  package_edges:    { implemented: true,  args: ["scope_root", "from", "to"] },
  package_stats:    { implemented: true,  args: ["top"] },
  dependencies:     { implemented: true,  args: ["name", "depth"] },
  used_by:          { implemented: true,  args: ["name", "depth"] },
  file_entities:    { implemented: true,  args: ["path"] },
  duplicates:       { implemented: false, args: [], gap: { capability: "archguard.duplicates", available_via: { mcp: "archguard_detect_duplicates", cli: null }, reason: "duplicate detection exists only as an MCP tool; the CLI `query` surface used by the bounded executor has no duplicates query" } },
  literal_dispersion: { implemented: false, args: [], gap: { capability: "archguard.literal_dispersion", available_via: { mcp: "archguard_detect_shape_smells / archguard_get_literal_dispersion", cli: null }, reason: "literal-dispersion exists only as MCP tools; no CLI query, and its default-source run can be silently empty" } },
});

export const STEP_ACTIONS = Object.freeze(["request_evidence", "investigate_more", "abstain", "propose_slice"]);
export const CONCERN_KINDS = Object.freeze(["package-cycle", "duplicate", "canonicalization", "other-boundary"]);

/** Paths the investigator may never read: evaluator-side benchmark artefacts and tool/runtime state. */
export const DENY_PATH_PATTERNS = Object.freeze([
  /(^|\/)reference\.json$/,
  /(^|\/)outcome\.json$/,
  /^plugin\/fixtures\/meta-driver-replay\//,
  /^docs\/analysis\/ownership-/,
  /^docs\/analysis\/dossier-evidence\//,
  /^docs\/analysis\/rich-dossier-spec\.json$/,
  /^docs\/analysis\/two-stage-corpus-spec\.json$/,
  /^\.quay\//,
  /^\.git(\/|$)/,
  /^\.archguard\//,
  /^\.claude\//,
  /(^|\/)node_modules\//,
]);

const IDENT = /^[A-Za-z0-9_$.:/@<>-]{1,120}$/;

/** Normalise a repo-relative POSIX path; returns {ok, path|reason}. Never touches the filesystem. */
export function normalizeRepoPath(p) {
  if (typeof p !== "string" || !p.trim() || p.length > 300 || p.includes("\0")) return { ok: false, reason: "PATH_MALFORMED" };
  let s = p.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (s.startsWith("/")) return { ok: false, reason: "PATH_ABSOLUTE" };
  const parts = [];
  for (const seg of s.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return { ok: false, reason: "PATH_ESCAPES_ROOT" };
    parts.push(seg);
  }
  s = parts.join("/");
  if (!s) return { ok: false, reason: "PATH_EMPTY" };
  if (DENY_PATH_PATTERNS.some((re) => re.test(s))) return { ok: false, reason: "PATH_DENIED" };
  return { ok: true, path: s };
}

/** A fresh loop state (pure value). */
export function newState(budget = DEFAULT_BUDGET) {
  return { budget: { ...budget }, rounds_used: 0, requests_used: 0, bytes_used: 0, seen: [], evidence: [], gaps: [] };
}

/** Validate ONE evidence request. Returns {ok, reasons[], normalized}. Every refusal has a distinct code. */
export function validateRequest(req, budget = DEFAULT_BUDGET) {
  const reasons = [];
  if (!req || typeof req !== "object" || Array.isArray(req)) return { ok: false, reasons: ["REQUEST_NOT_OBJECT"] };
  if (!EVIDENCE_KINDS.includes(req.kind)) return { ok: false, reasons: [`KIND_NOT_ALLOWED:${String(req.kind)}`] };
  const n = { kind: req.kind };

  if (req.kind === "read_file") {
    const p = normalizeRepoPath(req.path);
    if (!p.ok) reasons.push(p.reason); else n.path = p.path;
    const s = Number(req.start_line), e = req.end_line === undefined ? s + 79 : Number(req.end_line);
    if (!Number.isInteger(s) || s < 1) reasons.push("START_LINE_INVALID");
    else if (!Number.isInteger(e) || e < s) reasons.push("END_LINE_INVALID");
    else if (e - s + 1 > budget.max_read_lines) reasons.push(`RANGE_TOO_LARGE:${e - s + 1}>${budget.max_read_lines}`);
    else { n.start_line = s; n.end_line = e; }
  } else if (req.kind === "grep") {
    if (typeof req.pattern !== "string" || !req.pattern.trim() || req.pattern.length > 200) reasons.push("PATTERN_INVALID");
    else {
      n.pattern = req.pattern; n.fixed = req.fixed === true;
      if (!n.fixed) {
        try { new RegExp(req.pattern); } catch { reasons.push("PATTERN_NOT_A_REGEX"); }
        // the executor runs `git grep -E` (POSIX ERE). A pattern JS accepts but ERE cannot run would pass the gate and
        // then fail inside the tool — refuse the PCRE-only constructs here, with their own code.
        if (/\(\?|\\[dDWSpP]\b|\\k</.test(req.pattern)) reasons.push("PATTERN_NOT_ERE");
      }
    }
    if (!Array.isArray(req.paths) || req.paths.length === 0 || req.paths.length > budget.max_grep_paths) reasons.push("GREP_PATHS_REQUIRED_SCOPED");
    else {
      const ok = [];
      for (const p of req.paths) { const r = normalizeRepoPath(p); if (!r.ok) reasons.push(`${r.reason}:${String(p).slice(0, 60)}`); else ok.push(r.path); }
      n.paths = ok.sort();
    }
  } else {
    const q = ARCHGUARD_QUERY_KINDS[req.query];
    if (!q) reasons.push(`QUERY_KIND_UNKNOWN:${String(req.query)}`);
    else {
      n.query = req.query; n.args = {};
      const a = req.args && typeof req.args === "object" ? req.args : {};
      if (req.query === "package_stats") { const t = a.top === undefined ? 12 : Number(a.top); if (!Number.isInteger(t) || t < 1 || t > 40) reasons.push("TOP_INVALID"); else n.args.top = t; }
      if (req.query === "dependencies" || req.query === "used_by") {
        if (typeof a.name !== "string" || !IDENT.test(a.name)) reasons.push("NAME_INVALID"); else n.args.name = a.name;
        const d = a.depth === undefined ? 1 : Number(a.depth); if (!Number.isInteger(d) || d < 1 || d > 3) reasons.push("DEPTH_INVALID"); else n.args.depth = d;
      }
      if (req.query === "package_edges") {
        const r = normalizeRepoPath(a.scope_root);
        if (!r.ok) reasons.push(`SCOPE_ROOT_${r.reason}`); else n.args.scope_root = r.path;
        for (const k of ["from", "to"]) if (a[k] !== undefined) { if (typeof a[k] !== "string" || !/^[A-Za-z0-9_$.:/@-]{0,120}$/.test(a[k])) reasons.push(`${k.toUpperCase()}_INVALID`); else n.args[k] = a[k]; }
      }
      if (req.query === "file_entities") { const p = normalizeRepoPath(a.path); if (!p.ok) reasons.push(p.reason); else n.args.path = p.path; }
    }
  }
  return { ok: reasons.length === 0, reasons, normalized: reasons.length ? null : n };
}

export const requestKey = (normalized) => JSON.stringify(normalized);

/** Admission for the NEXT request: validity + budgets + dedup. Pure; `state` is not mutated. */
export function gateEvidenceRequest(req, state) {
  const v = validateRequest(req, state.budget);
  if (!v.ok) return { ok: false, reasons: v.reasons, normalized: null };
  const reasons = [];
  if (state.requests_used >= state.budget.max_evidence_requests) reasons.push("BUDGET_EXHAUSTED:requests");
  if (state.bytes_used >= state.budget.max_total_evidence_bytes) reasons.push("BUDGET_EXHAUSTED:bytes");
  if (state.seen.includes(requestKey(v.normalized))) reasons.push("DUPLICATE_REQUEST");
  return { ok: reasons.length === 0, reasons, normalized: v.normalized };
}

/** Round-level budget: the model gets `max_rounds` turns in total. */
export const roundsExhausted = (state) => state.rounds_used >= state.budget.max_rounds;

const str = (x, n = 10) => typeof x === "string" && x.trim().length >= n;
const ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Validate a step (the model's whole reply). `state.evidence` supplies the citable ids. */
export function validateStep(step, state) {
  const reasons = [];
  if (!step || typeof step !== "object" || Array.isArray(step)) return { ok: false, reasons: ["STEP_NOT_OBJECT"] };
  if (!STEP_ACTIONS.includes(step.action)) return { ok: false, reasons: [`ACTION_NOT_IN_VOCAB:${String(step.action)}`] };
  if (!str(step.hypothesis, 10)) reasons.push("HYPOTHESIS_TOO_THIN");
  if (typeof step.sufficient !== "boolean") reasons.push("SUFFICIENT_NOT_BOOLEAN");

  if (step.action === "request_evidence") {
    if (!step.request) reasons.push("REQUEST_MISSING");
    if (step.sufficient === true) reasons.push("SUFFICIENT_CONTRADICTS_REQUEST");
  } else if (step.action === "investigate_more") {
    if (!str(step.what_is_missing, 15)) reasons.push("WHAT_IS_MISSING_TOO_THIN");
  } else if (step.action === "abstain") {
    if (!str(step.why, 10)) reasons.push("WHY_TOO_THIN");
  } else if (step.action === "propose_slice") {
    if (step.sufficient !== true) reasons.push("PROPOSE_REQUIRES_SUFFICIENT");
    const p = step.proposal;
    if (!p || typeof p !== "object") reasons.push("PROPOSAL_MISSING");
    else {
      if (!CONCERN_KINDS.includes(p.concern_kind)) reasons.push(`CONCERN_KIND_NOT_IN_VOCAB:${String(p.concern_kind)}`);
      if (!str(p.concern, 20)) reasons.push("CONCERN_TOO_THIN");
      const ids = new Map(state.evidence.map((e) => [e.id, e]));
      if (!Array.isArray(p.evidence_refs) || p.evidence_refs.length === 0) reasons.push("EVIDENCE_REFS_EMPTY");
      else {
        const bad = p.evidence_refs.filter((r) => !ids.has(r));
        if (bad.length) reasons.push(`EVIDENCE_UNRESOLVED:${bad.slice(0, 5).join(",")}`);
        const ungrounded = p.evidence_refs.filter((r) => ids.has(r) && ids.get(r).status !== "ok");
        if (ungrounded.length) reasons.push(`EVIDENCE_NOT_A_READING:${ungrounded.slice(0, 5).join(",")}`);
      }
      if (!Array.isArray(p.candidate_interventions) || p.candidate_interventions.length < 1) reasons.push("CANDIDATES_REQUIRED");
      else if (p.candidate_interventions.length > 3) reasons.push(`TOO_MANY_INTERVENTIONS:${p.candidate_interventions.length}>3`);
      if (!p.scope || !Array.isArray(p.scope.in_scope) || !Array.isArray(p.scope.non_goals) || p.scope.non_goals.length === 0) reasons.push("SCOPE_MALFORMED");
      if (!str(p.negative_control, 20)) reasons.push("NEGATIVE_CONTROL_TOO_THIN");
      if (!str(p.abandon_or_reconsider_condition, 20)) reasons.push("ABANDON_CONDITION_TOO_THIN");
      if (!p.confidence || !["low", "medium", "high"].includes(p.confidence.level) || !str(p.confidence.basis, 10)) reasons.push("CONFIDENCE_MALFORMED");
      if (p.concern_kind === "package-cycle") {
        const s = p.slice;
        if (!s || typeof s !== "object") reasons.push("SLICE_REQUIRED_FOR_PACKAGE_CYCLE");
        else {
          if (typeof s.subject !== "string") reasons.push("SLICE_SUBJECT_MISSING");
          if (typeof s.scope_root !== "string") reasons.push("SLICE_SCOPE_ROOT_MISSING");
          if (!Array.isArray(s.moves) || s.moves.length === 0) reasons.push("SLICE_MOVES_EMPTY");
          else for (const [i, m] of s.moves.entries()) {
            const okMove = m && typeof m.file === "string" && m.file && typeof m.from === "string" && typeof m.to === "string" && m.from !== m.to
              && Array.isArray(m.symbols) && m.symbols.length > 0 && m.symbols.every((x) => typeof x === "string" && ident.test(x));
            if (!okMove) reasons.push(`SLICE_MOVE_MALFORMED:${i}`);
          }
        }
        // the model must NOT supply the delta — it is computed from the graph by the ArchGuard primitive
        if ("expected_mechanical_delta" in p) reasons.push("DELTA_MUST_BE_COMPUTED_NOT_DECLARED");
      } else if (!str(p.declared_measurement, 15)) reasons.push("DECLARED_MEASUREMENT_REQUIRED_FOR_NON_CYCLE_KIND");
    }
  }
  return { ok: reasons.length === 0, reasons };
}
