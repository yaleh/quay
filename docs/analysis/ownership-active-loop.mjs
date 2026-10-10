#!/usr/bin/env node
// ownership/architecture ACTIVE INVESTIGATION LOOP — shadow only.
//
//   initial mechanical facts
//     -> semantic investigator chooses ONE next evidence request        (model: judgement only)
//     -> deterministic gate admits/refuses it (kind, scope, budget, dedup)
//     -> bounded read-only executor runs it                              (read_file / grep / archguard_query)
//     -> evidence appended WITH provenance
//     -> repeat until: investigate_more | abstain | propose_slice
//     -> propose_slice: the ArchGuard Refactor Slice / Expected Delta primitive computes the delta
//     -> existing deterministicGate (schema / evidence resolution / domain / forbidden / cap / dedup) + quota
//     -> ONE record appended to the shadow carrier. Nothing else is written.
//
// ⛔ STRUCTURAL SANDBOX (asserted by plugin/test/ownership-active-loop.test.mjs): this module does not import
// fileProposals / driveItems / fileDecisions, creates no task/goal/AC, changes no status, edits no code. The
// judge runs with NO tools — every reading reaches it only through the executor, so every reading has provenance.
//
// The judge is an injectable seam (`invokeJudge`), so the suite needs no model.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  CONTRACT_VERSION, DEFAULT_BUDGET, ARCHGUARD_QUERY_KINDS, STEP_ACTIONS,
  newState, gateEvidenceRequest, validateStep, roundsExhausted, requestKey,
} from "./ownership-active-contract.mjs";
import { createExecutor } from "./ownership-active-executor.mjs";
import { computeSliceDelta, renderDelta, renderNegativeControl } from "./ownership-active-slice-adapter.mjs";
import { emptyEnvelope, deterministicGate, normalizeConcernKey } from "./ownership-shadow-proposer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
export const CARRIER_REL = ".quay/ownership-shadow-proposals.jsonl";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export const PROPOSER_ID = "ownership-active-loop";
/** Hash of the four modules that make up this capability — recorded on every carrier record so a reading is
 *  attributable to the exact code that produced it (a live reading from before a fix must not read as after it). */
export const CODE_FINGERPRINT = crypto.createHash("sha256").update(
  ["contract", "executor", "slice-adapter", "loop"].map((n) => { try { return fs.readFileSync(path.join(HERE, `ownership-active-${n}.mjs`), "utf8"); } catch { return ""; } }).join("\0"),
).digest("hex").slice(0, 16);
export const DEFAULT_QUOTA = Object.freeze({ max_proposals: 3, window_ms: 24 * 3600 * 1000 });

// ── prompt ────────────────────────────────────────────────────────────────────────────────────
export function buildInitialFacts({ commit, subject, topDirs, methodologyPresent }) {
  return { repo_commit: commit, head_subject: subject, top_level_dirs: topDirs, methodology_doc: methodologyPresent ? "docs/references/ownership-first-refactoring-methodology.md" : null };
}

export function buildStepPrompt({ facts, state, refusals, mustTerminate }) {
  const b = state.budget;
  const left = { rounds: b.max_rounds - state.rounds_used + 1, evidence_requests: b.max_evidence_requests - state.requests_used, evidence_bytes: b.max_total_evidence_bytes - state.bytes_used };
  const kinds = Object.keys(ARCHGUARD_QUERY_KINDS).join(" | ");
  return `You are a NARROW ownership/architecture investigator for one repository, in SHADOW mode.
Domain: ownership, canonicalization, package-dependency boundaries, and ONE small refactor slice. Anything else
(roadmap, product planning, UI) is out of domain. You cannot create tasks or goals and nothing you say is executed.
You have NO tools. All evidence reaches you only through the evidence requests below.

## PROTOCOL — each turn you return exactly ONE JSON object, no prose
{
  "action": "request_evidence" | "investigate_more" | "abstain" | "propose_slice",
  "hypothesis": "<your current concern hypothesis, 1-2 sentences, revised from the evidence so far>",
  "sufficient": true | false,                 // is the evidence so far enough to propose a slice?
  "why": "<one sentence>",
  // action = request_evidence  (ONE request only):
  "request": { "kind": "read_file", "path": "<repo-relative>", "start_line": N, "end_line": N }          // <= ${b.max_read_lines} lines
           | { "kind": "grep", "pattern": "<POSIX extended regex>", "paths": ["<scoped repo-relative path>", ...] }   // <= ${b.max_grep_paths} paths, no repo-wide '.'; NO (?:..), \\d or lookaround
           | { "kind": "archguard_query", "query": "${kinds}", "args": { "name"?: "<entity>", "depth"?: 1-3, "path"?: "<file>", "top"?: N, "scope_root"?: "<repo-relative dir>", "from"?: "<pkg>", "to"?: "<pkg>" } },
  //   query notes: dependencies / used_by take an ENTITY name (class, function, interface) — NOT a directory or a file path.
  //                package_edges takes { "scope_root", "from"?, "to"? } and returns the directory-level edges, with the names each edge
  //                imports, among the packages under scope_root. Package ids are directories relative to scope_root; the root is "".
  // action = investigate_more:  "what_is_missing": "<what evidence you would need and why you cannot get it>"
  // action = abstain:           (use "why")
  // action = propose_slice:     "proposal": {
  //   "concern_kind": "package-cycle" | "duplicate" | "canonicalization" | "other-boundary",
  //   "concern": "<one sentence>", "evidence_refs": ["ev-N", ...],        // only readings with status ok
  //   "candidate_interventions": [{"title": "...", "rationale": "..."}],   // 1-3, first = recommended
  //   "scope": {"in_scope": ["..."], "non_goals": ["..."]},
  //   "negative_control": "<what distinguishes 'it worked' from 'it looks like it worked'>",
  //   "abandon_or_reconsider_condition": "<evidence that would make you abandon this>",
  //   "confidence": {"level": "low|medium|high", "basis": "<grounded in the evidence>"},
  //   // package-cycle ONLY — a STRUCTURED cut; do NOT state the resulting cycle size, the tool computes it:
  //   "slice": { "scope_root": "<repo-relative dir that CONTAINS the cycle's packages>", "subject": "<package dir, relative to scope_root, whose cycle membership to track>",
  //              "moves": [{"file": "<path relative to scope_root>", "from": "<dir rel. scope_root>", "to": "<dir rel. scope_root>", "symbols": ["<exported names that move>"]}],
  //              "consumers": [{"file": "...", "dir": "...", "imports": ["..."]}] (optional), "forbidden_new_edges": [{"from": "...", "to": "..."}] (optional) },
  //   // every other concern_kind:
  //   "declared_measurement": "<the before/after reading that would show success; will be marked UNVERIFIED>" }
}
Rules: ONE evidence request per turn. A request refused by the gate still costs you a turn. Do not repeat a request.
If a request returns status capability_gap, that reading DOES NOT EXIST on this tool surface — never reason as if it did;
you may ask for something else, or say investigate_more / abstain. Abstaining is a correct answer. Never guess.
Package ids in an ArchGuard package-cycle reading are directories; the root of the analysed tree is the empty string.

## INITIAL MECHANICAL FACTS
${JSON.stringify(facts, null, 1)}

## BUDGET REMAINING
${JSON.stringify(left)}${mustTerminate ? "\nNO further evidence requests are possible: you must now choose investigate_more, abstain or propose_slice." : ""}

## EVIDENCE LOG (${state.evidence.filter((e) => e.id !== "ev-0").length})
${state.evidence.filter((e) => e.id !== "ev-0").length ? state.evidence.filter((e) => e.id !== "ev-0").map((e) => `### [${e.id}] status=${e.status}  request=${JSON.stringify(e.request)}\n${e.text}`).join("\n\n") : "(none yet)"}
${refusals.length ? `\n## GATE REFUSALS SO FAR\n${refusals.map((r) => `- round ${r.round}: ${r.reasons.join(", ")}`).join("\n")}\n` : ""}
Reply with the single JSON object for your next turn.`;
}

/** Fail-closed: unreadable output => null (never a half-formed step). */
export function parseStep(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) return null;
  const cands = [];
  const fenced = stdout.match(/```(?:json)?\s*([\s\S]*?)```/g);
  if (fenced) for (const b of fenced) cands.push(b.replace(/```(?:json)?/g, ""));
  cands.push(stdout);
  for (const c of cands) {
    const s = c.indexOf("{"), e = c.lastIndexOf("}");
    if (s < 0 || e <= s) continue;
    try { const o = JSON.parse(c.slice(s, e + 1)); if (o && typeof o === "object" && !Array.isArray(o)) return o; } catch { /* next */ }
  }
  return null;
}

// ── quota (carrier-level, deterministic) ──────────────────────────────────────────────────────
export function quotaGate(history, { max_proposals, window_ms } = DEFAULT_QUOTA, nowMs = Date.now()) {
  const recent = history.filter((h) => h.proposer_id === PROPOSER_ID && h.action === "propose-goal" && h.gate_ok === true && nowMs - Date.parse(h.ts_iso || 0) <= window_ms);
  return { ok: recent.length < max_proposals, used: recent.length, max: max_proposals };
}

// ── terminal -> envelope (deterministic; the model contributes only its semantic fields) ──────
const DOMAIN_PREFIX = "Ownership/dependency-boundary concern";
export function toEnvelope({ terminal, state, slice }) {
  const env = emptyEnvelope(PROPOSER_ID);
  const allIds = state.evidence.map((e) => e.id);
  const okIds = state.evidence.filter((e) => e.status === "ok").map((e) => e.id);
  const down = [];
  if (terminal.kind === "propose_slice") {
    const p = terminal.step.proposal;
    env.concern = p.concern;
    env.evidence_refs = p.evidence_refs;
    env.candidate_interventions = p.candidate_interventions.slice(0, 3).map((c) => ({ title: String(c.title), rationale: String(c.rationale) }));
    env.scope = { in_scope: p.scope.in_scope.map(String), non_goals: p.scope.non_goals.map(String) };
    env.abandon_or_reconsider_condition = p.abandon_or_reconsider_condition;
    env.confidence = { level: p.confidence.level, basis: p.confidence.basis };
    env.recommended_next_action = "propose-goal";
    if (p.concern_kind === "package-cycle") {
      env.expected_mechanical_delta = renderDelta(slice);
      env.negative_control = `${p.negative_control} ${renderNegativeControl(slice)}`.trim();
      if (slice.status !== "evaluated") down.push(`DELTA_${String(slice.status).toUpperCase()}:${slice.reason || ""}`);
      else if (!slice.negative_control.falsified) down.push("NEGATIVE_CONTROL_NOT_FALSIFIED");
    } else {
      env.expected_mechanical_delta = `UNVERIFIED declared measurement (no ArchGuard primitive computes this for concern_kind=${p.concern_kind}): ${p.declared_measurement}`;
      env.negative_control = p.negative_control;
      // an unverified delta may be PROPOSED but never at high confidence
      if (env.confidence.level === "high") env.confidence = { level: "medium", basis: `capped: delta is a declared, unverified measurement. ${env.confidence.basis}` };
    }
    if (down.length) {
      env.recommended_next_action = "investigate";
      env.confidence = { level: "low", basis: `downgraded from propose-goal: ${down.join("; ")}` };
    }
  } else {
    const why = terminal.kind === "abstain" ? terminal.why : terminal.what_is_missing;
    env.concern = `${DOMAIN_PREFIX} (unresolved): ${terminal.hypothesis || "none established"}`;
    env.evidence_refs = allIds;
    env.recommended_next_action = terminal.kind === "abstain" ? "abstain" : "investigate";
    env.scope = { in_scope: [], non_goals: ["no slice is proposed from this evidence"] };
    env.expected_mechanical_delta = `n/a — no slice proposed (${terminal.kind}: ${String(why).slice(0, 200)})`;
    env.negative_control = "n/a — no slice proposed";
    env.abandon_or_reconsider_condition = `n/a — terminal ${terminal.kind}: ${String(why).slice(0, 200)}`;
    env.confidence = { level: "low", basis: String(why).slice(0, 200) || "terminal without proposal" };
  }
  return { envelope: env, downgrades: down, okIds };
}

// ── the loop ──────────────────────────────────────────────────────────────────────────────────
/**
 * @param {object} o
 * @param {string} o.root           tree to investigate (live repo root or a replay worktree)
 * @param {function} o.invokeJudge  async (prompt) => {stdout,status,error}
 * @param {object} [o.deps]         { executor?, sliceDeps?, history? , now? }
 */
export async function runActiveInvestigation({ root, invokeJudge, budget = DEFAULT_BUDGET, deps = {}, existingConcernKeys = [], history = [], quota = DEFAULT_QUOTA, onRound = () => {}, label = "live", triggers = [] }) {
  const executor = deps.executor || createExecutor({ root, budget });
  const now = deps.now || (() => new Date().toISOString());
  const state = newState(budget);
  const commit = executor.commit();
  let subject = "";
  let topDirs = [];
  try {
    const g = deps.git || ((a) => execGit(root, a));
    subject = g(["log", "-1", "--format=%s", commit]).trim();
    topDirs = g(["ls-tree", "--name-only", commit]).split("\n").filter(Boolean).slice(0, 60);
  } catch { /* facts stay minimal — recorded as such */ }
  const facts = buildInitialFacts({ commit, subject, topDirs, methodologyPresent: topDirs.includes("docs") });
  // Mechanical TRIGGERS: readings produced by a detector OUTSIDE this loop (e.g. a duplicate-group or dispersion probe).
  // They are inputs with provenance, recorded verbatim and citable — the investigator drills into them. The loop does not
  // vouch for them; `source` names which tool produced the reading and from which tree.
  facts.mechanical_triggers = triggers.map((tr, i) => ({ id: `ev-t${i + 1}`, source: tr.source, analysed_tree: tr.analysed_tree ?? null, reading: String(tr.text).slice(0, 4000) }));
  for (const [i, tr] of triggers.entries()) {
    const txt = String(tr.text).slice(0, 4000);
    state.evidence.push({ id: `ev-t${i + 1}`, request: { kind: "trigger", source: tr.source }, status: "ok", text: txt, bytes: Buffer.byteLength(txt, "utf8"), truncated: txt.length < String(tr.text).length, provenance: { tool: tr.source, ref_commit: commit, analysed_tree: tr.analysed_tree ?? null, recorded: true, content_sha256: sha(txt), ts: now() } });
  }
  // the initial facts are themselves a citable reading (git), so an abstain that rests on them resolves in the gate
  const factsText = JSON.stringify(facts);
  state.evidence.push({ id: "ev-0", request: { kind: "initial_facts" }, status: "ok", text: factsText, bytes: Buffer.byteLength(factsText, "utf8"), truncated: false, provenance: { tool: "git", ref_commit: commit, ts: now(), command: "git log -1 / git ls-tree --name-only" } });

  const steps = [], refusals = [];
  let terminal = null, unparseable = 0, invalid = 0, forced = null;
  const t0 = Date.now();

  while (!terminal) {
    if (roundsExhausted(state)) { forced = "not-enough-evidence:rounds"; break; }
    state.rounds_used++;
    const mustTerminate = state.requests_used >= budget.max_evidence_requests || state.bytes_used >= budget.max_total_evidence_bytes || state.rounds_used >= budget.max_rounds;
    const prompt = buildStepPrompt({ facts, state, refusals, mustTerminate });
    const r = await invokeJudge(prompt);
    const round = state.rounds_used;
    if (!r || r.error || (typeof r.status === "number" && r.status !== 0)) {
      steps.push({ round, outcome: "judge-error", reason: r?.error?.message || `exit ${r?.status}` });
      forced = "judge-unavailable"; break;
    }
    const step = parseStep(r.stdout);
    if (!step) {
      steps.push({ round, outcome: "unparseable" });
      if (++unparseable >= 2) { forced = "judge-output-unreadable"; break; }
      continue;
    }
    const v = validateStep(step, state);
    if (!v.ok) {
      steps.push({ round, outcome: "step-invalid", action: step.action, reasons: v.reasons });
      refusals.push({ round, reasons: v.reasons });
      if (++invalid >= 3) { forced = "too-many-invalid-steps"; break; }
      continue;
    }
    if (step.action === "request_evidence") {
      const gate = gateEvidenceRequest(step.request, state);
      if (!gate.ok) {
        steps.push({ round, outcome: "request-refused", action: step.action, request: step.request, reasons: gate.reasons, hypothesis: step.hypothesis });
        refusals.push({ round, reasons: gate.reasons });
        if (gate.reasons.some((x) => x.startsWith("BUDGET_EXHAUSTED"))) { forced = `not-enough-evidence:${gate.reasons.find((x) => x.startsWith("BUDGET_EXHAUSTED")).split(":")[1]}`; break; }
        continue;
      }
      const ev = executor.execute(gate.normalized);
      state.seen.push(requestKey(gate.normalized));
      if (ev.status === "capability_gap") state.gaps.push(ev.provenance.query ? { query: ev.provenance.query, ...ev.gap } : ev.gap);
      else { state.requests_used++; state.bytes_used += ev.bytes; }
      state.evidence.push(ev);
      steps.push({ round, outcome: "evidence", action: step.action, request: gate.normalized, evidence_id: ev.id, evidence_status: ev.status, hypothesis: step.hypothesis, sufficient: step.sufficient });
      onRound({ round, steps, state });
      continue;
    }
    steps.push({ round, outcome: "terminal", action: step.action, hypothesis: step.hypothesis, sufficient: step.sufficient });
    terminal = { kind: step.action, step, hypothesis: step.hypothesis, why: step.why, what_is_missing: step.what_is_missing };
  }

  // "could not evaluate" is NOT "evaluated and abstained" (hard rule 3b). If the judge never produced a usable judgment
  // the run ends NOT-EVALUATED: no envelope, nothing that can enter dedup history or the proposal quota. Only a run that
  // JUDGED the evidence insufficient (budget/rounds exhausted) is an abstain.
  const NOT_EVALUATED_CAUSES = ["judge-unavailable", "judge-output-unreadable", "too-many-invalid-steps"];
  if (!terminal && NOT_EVALUATED_CAUSES.includes(forced)) {
    return {
      contract_version: CONTRACT_VERSION, code_fingerprint: CODE_FINGERPRINT, proposer_id: PROPOSER_ID, label, state: "not-evaluated",
      commit, facts, budget, usage: { rounds: state.rounds_used, evidence_requests: state.requests_used, evidence_bytes: state.bytes_used },
      steps, terminal: { kind: "not-evaluated", forced: true, forced_cause: forced }, capability_gaps: state.gaps,
      requested_kinds: [...new Set(state.evidence.filter((e) => e.id !== "ev-0" && e.request.kind !== "trigger").map((e) => e.request.kind === "archguard_query" ? `archguard:${e.request.query}` : e.request.kind))],
      evidence: state.evidence.map((e) => ({ id: e.id, request: e.request, status: e.status, bytes: e.bytes, provenance: e.provenance, text_sha256: sha(e.text) })),
      slice_delta: null, downgrades: [], envelope: null, gate_ok: null, gate_reasons: [`NOT_EVALUATED:${forced}`], concern_key: null,
      action: "not-evaluated", executed: false, elapsed_ms: Date.now() - t0,
    };
  }
  if (!terminal) {
    // forced terminal: NEVER a guess — budget exhaustion ends as an honest abstain with the cause named
    terminal = { kind: "abstain", step: null, hypothesis: steps.filter((s) => s.hypothesis).slice(-1)[0]?.hypothesis || "none established", why: forced || "no terminal action", forced: true };
  }

  let slice = null;
  if (terminal.kind === "propose_slice" && terminal.step.proposal.concern_kind === "package-cycle") {
    slice = computeSliceDelta({ root, commit, proposal: terminal.step.proposal, deps: deps.sliceDeps || {}, now });
  }
  const { envelope, downgrades } = toEnvelope({ terminal, state, slice });

  const evidenceRefs = new Set(state.evidence.map((e) => e.id));
  const gate = deterministicGate(envelope, { evidenceRefs, existingConcernKeys });
  const reasons = [...gate.reasons];
  let finalAction = envelope.recommended_next_action;
  if (finalAction === "propose-goal") {
    const q = quotaGate(history, quota);
    if (!q.ok) { reasons.push(`QUOTA_EXHAUSTED:${q.used}/${q.max}`); }
  }
  const gate_ok = reasons.length === 0;

  return {
    contract_version: CONTRACT_VERSION, code_fingerprint: CODE_FINGERPRINT, proposer_id: PROPOSER_ID, label,
    commit, facts, triggers: triggers.map((x) => ({ source: x.source, analysed_tree: x.analysed_tree ?? null, text_sha256: sha(String(x.text)) })), budget, usage: { rounds: state.rounds_used, evidence_requests: state.requests_used, evidence_bytes: state.bytes_used },
    steps, terminal: { kind: terminal.kind, forced: terminal.forced === true, forced_cause: forced },
    capability_gaps: state.gaps, requested_kinds: [...new Set(state.evidence.filter((e) => e.id !== "ev-0" && e.request.kind !== "trigger").map((e) => e.request.kind === "archguard_query" ? `archguard:${e.request.query}` : e.request.kind))],
    evidence: state.evidence.map((e) => ({ id: e.id, request: e.request, status: e.status, bytes: e.bytes, truncated: e.truncated, provenance: e.provenance, text_head: e.text.slice(0, 1500), text_sha256: sha(e.text), ...(e.cycles ? { cycles: e.cycles } : {}), ...(e.gap ? { gap: e.gap } : {}) })),
    slice_delta: slice ? { status: slice.status, reason: slice.reason || null, provenance: slice.provenance, delta: slice.delta || null, guards: slice.guards || null, negative_control: slice.negative_control || null, gap: slice.gap || null } : null,
    downgrades, envelope, gate_ok, gate_reasons: reasons, concern_key: gate.concern_key,
    action: finalAction, executed: false, elapsed_ms: Date.now() - t0,
  };
}

const execGit = (root, args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });

// ── carrier (the ONLY thing this module ever persists) ─────────────────────────────────────────
export function readCarrierHistory(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
export function appendCarrier(root, rec) {
  const file = path.join(root, CARRIER_REL);
  if (!file.endsWith(CARRIER_REL)) throw new Error("carrier path is fixed");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(rec) + "\n", "utf8");
  return file;
}

/** The runtime seam: what launcher/model this judge actually resolves to (for the future escalation path). */
export function resolveRuntime(launchArgv, role, root) {
  const argv = launchArgv(role, "", root, { promptViaStdin: true });
  const mi = argv.indexOf("--model");
  return { role, launcher: argv[0], model: mi >= 0 ? argv[mi + 1] : null, escalation: { enabled: false, seam: "set a different role in the loop options; no automatic escalation in v1" } };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────
async function cli() {
  const { launchArgv, runAsync } = await import("../../plugin/scripts/driver-runtime.ts");
  const args = process.argv.slice(2);
  const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const role = val("--role", "meta-driver");
  const runtime = resolveRuntime(launchArgv, role, REPO_ROOT);
  // pure completion: no tools, no slash commands, no session — evidence only via the executor
  const invokeJudge = async (prompt) => {
    const argv = launchArgv(role, prompt, REPO_ROOT, { promptViaStdin: true });
    argv.splice(argv.length - 1, 0, "--tools", "", "--disable-slash-commands", "--no-session-persistence", "--strict-mcp-config");
    return runAsync(argv, { timeoutMs: 600_000, collectStderr: true, stdinData: prompt });
  };
  const rounds = Number(val("--rounds", 1));
  const out = [];
  if (args.includes("--live")) {
    const root = REPO_ROOT;
    for (let i = 0; i < rounds; i++) {
      const carrier = path.join(root, CARRIER_REL);
      const history = readCarrierHistory(carrier);
      const existing = history.filter((h) => h.state !== "not-evaluated").map((h) => h.concern_key).filter(Boolean);
      const res = await runActiveInvestigation({ root, invokeJudge, existingConcernKeys: existing, history, label: "live" });
      const rec = { ts_iso: new Date().toISOString(), runtime, ...res };
      appendCarrier(root, rec);
      out.push(rec);
      process.stderr.write(`live round ${i + 1}: ${res.terminal.kind}${res.terminal.forced ? "(forced:" + res.terminal.forced_cause + ")" : ""} action=${res.action} gate_ok=${res.gate_ok} rounds=${res.usage.rounds} requests=${res.usage.evidence_requests}\n`);
      if (res.state === "not-evaluated") await new Promise((r) => setTimeout(r, 20_000));   // do not hammer an unavailable judge
    }
  } else if (args.includes("--replay")) {
    const { prepareTree } = await import("./ownership-tool-replay.mjs");
    const caseId = val("--replay"), stage = val("--stage", "B");
    const tree = prepareTree(caseId, stage);
    const trig = val("--trigger", null) ? [JSON.parse(fs.readFileSync(val("--trigger"), "utf8"))] : [];
    const res = await runActiveInvestigation({ root: tree.dir, invokeJudge, triggers: trig, label: `replay:${caseId}:${stage}${trig.length ? ":triggered" : ":discovery"}` });
    out.push({ ts_iso: new Date().toISOString(), runtime, tree: { dir: tree.dir, commit: tree.commit, archguard_snapshot: tree.archguard_snapshot }, ...res });
  } else {
    console.error("usage: ownership-active-loop.mjs --live [--rounds N] | --replay GOAL-0xx --stage A|B   [--role meta-driver]");
    process.exit(2);
  }
  console.log(JSON.stringify(out, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) cli();
