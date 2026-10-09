#!/usr/bin/env node
// SEMANTIC ownership/architecture proposer for the shadow pipeline.
// Implements step 2 of the shadow-proposer work: replace the deterministic baseline's *semantic*
// fields with a real LLM judgement, while keeping EVERYTHING downstream mechanical.
//
// Division of labour (ADR-033, unchanged): the LLM may only fill the envelope's semantic fields.
// deterministicGate() still polices schema / evidence-resolution / domain-scope / forbidden
// actions / cap / dedup — the model cannot talk its way past it.
//
// ⛔ Shadow only: writes nothing but sandbox records. No task/goal/AC, no status change, and the
// fileProposals / driveItems / fileDecisions machinery is not reachable from here.
//
// The judge call is an INJECTABLE seam (`invokeJudge`) so the test suite never needs an external
// model; the live path passes a real launcher invocation.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyEnvelope } from "./ownership-shadow-proposer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

/** Structured evidence the proposer may reason over. Deliberately NARROW: this project's own
 *  ownership/architecture surface, never a general project-management view. */
export function buildSemanticEvidence(root = REPO_ROOT) {
  const ev = { sources: {}, archguard: {}, goals: {}, tasks: {}, methodology_excerpt: "" };

  // 1. ArchGuard artifacts — the existing structural instrument, read from its own on-disk output
  const qdir = path.join(root, ".archguard", "query");
  if (fs.existsSync(qdir)) {
    const scopes = fs.readdirSync(qdir).filter((d) => fs.statSync(path.join(qdir, d)).isDirectory());
    let best = null;
    for (const s of scopes) {
      const f = path.join(qdir, s, "arch.json");
      if (!fs.existsSync(f)) continue;
      const st = fs.statSync(f);
      if (!best || st.mtimeMs > best.mtimeMs) best = { scope: s, file: f, mtimeMs: st.mtimeMs };
    }
    if (best) {
      ev.sources.archguard = `archguard:latest_snapshot`;
      ev.archguard = { scope: best.scope, snapshot_mtime: new Date(best.mtimeMs).toISOString(), path: path.relative(root, best.file) };
    }
  }

  // 2. goals / tasks shape
  const tally = (dir, prefix) => {
    const out = {};
    if (!fs.existsSync(dir)) return out;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md") && (!prefix || x.startsWith(prefix)))) {
      const m = fs.readFileSync(path.join(dir, f), "utf8").match(/^status:\s*(\S+)/m);
      const s = m ? m[1] : "unknown";
      out[s] = (out[s] || 0) + 1;
    }
    return out;
  };
  ev.goals = { status_tally: tally(path.join(root, "goals"), "GOAL-") };
  ev.tasks = { status_tally: tally(path.join(root, "tasks")) };

  // 3. the ownership-first methodology — the project's own worked method for exactly this domain
  const meth = path.join(root, "docs", "references", "ownership-first-refactoring-methodology.md");
  if (fs.existsSync(meth)) {
    ev.sources.methodology = "docs/references/ownership-first-refactoring-methodology.md";
    ev.methodology_excerpt = fs.readFileSync(meth, "utf8").split("\n").filter((l) => l.startsWith("#")).slice(0, 25).join("\n");
  }
  return ev;
}

/** Evidence ids a proposal may cite. MUST match what the gate polices (the live runner learned
 *  this the hard way — a namespace mismatch made every citation unresolvable). */
export function semanticEvidenceRefs(ev) {
  const refs = new Set(["goals:status_tally", "tasks:status_tally"]);
  if (ev.sources.archguard) refs.add(ev.sources.archguard);
  if (ev.sources.methodology) refs.add("methodology:ownership-first");
  return refs;
}

export function buildSemanticPrompt(ev) {
  return `You are a NARROW ownership/architecture proposer for the quay repository.

Your domain is ONLY: ownership, canonicalization, dependency boundaries, and small-slice
architecture opportunities. Anything else (product planning, roadmap, prioritisation, UI work)
is out of domain — if that is all you see, answer with recommended_next_action "abstain".

You are in SHADOW mode: your output is recorded and never executed. You cannot create tasks or
goals. Propose from the EVIDENCE below only; do not invent readings.

## EVIDENCE
${JSON.stringify({ archguard: ev.archguard, goals: ev.goals, tasks: ev.tasks, methodology_excerpt: ev.methodology_excerpt }, null, 2)}

## CITE ONLY THESE evidence_refs
${[...semanticEvidenceRefs(ev)].map((r) => `- ${r}`).join("\n")}

## OUTPUT — a single JSON object, no prose, matching exactly:
{
  "concern": "<one sentence naming an ownership/canonicalization/dependency-boundary concern>",
  "evidence_refs": ["<ids from the list above>"],
  "candidate_interventions": [{"title": "...", "rationale": "..."}],   // <= 3
  "recommended_next_action": "abstain" | "investigate" | "propose-goal",
  "scope": {"in_scope": ["..."], "non_goals": ["..."]},
  "expected_mechanical_delta": "<what a concrete before/after measurement would show>",
  "negative_control": "<the check that would distinguish 'it worked' from 'it looks like it worked'>",
  "abandon_or_reconsider_condition": "<evidence that would make you abandon this>",
  "confidence": {"level": "low"|"medium"|"high", "basis": "<why, grounded in the evidence above>"}
}
If the evidence does not support any ownership concern, return recommended_next_action "abstain"
with an empty candidate_interventions array. Abstaining is a correct answer, not a failure.`;
}

/** Fail-closed parse: unreadable model output yields null, never a half-formed envelope
 *  (CLAUDE.md hard rule 3b — "could not read it" must not look like "read it and it was fine"). */
export function parseSemanticEnvelope(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) return null;
  const candidates = [];
  const fenced = stdout.match(/```(?:json)?\s*([\s\S]*?)```/g);
  if (fenced) for (const b of fenced) candidates.push(b.replace(/```(?:json)?/g, ""));
  candidates.push(stdout);
  for (const c of candidates) {
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    let obj;
    try { obj = JSON.parse(c.slice(start, end + 1)); } catch { continue; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
    const env = emptyEnvelope("ownership-shadow-semantic");
    for (const k of Object.keys(env)) if (k in obj) env[k] = obj[k];
    if (typeof env.confidence !== "object" || env.confidence === null) env.confidence = { level: "low", basis: "unparsed" };
    return env;
  }
  return null;
}

/** One semantic round. `invokeJudge(prompt) -> {stdout, status, error}` is injected. */
export async function proposeSemantic(ev, { invokeJudge }) {
  const t0 = Date.now();
  const prompt = buildSemanticPrompt(ev);
  const r = await invokeJudge(prompt);
  const elapsed_ms = Date.now() - t0;
  if (!r || r.error || (typeof r.status === "number" && r.status !== 0)) {
    return { envelope: null, elapsed_ms, prompt_chars: prompt.length, state: "not-evaluated", reason: r?.error?.message || `exit ${r?.status}` };
  }
  const envelope = parseSemanticEnvelope(r.stdout);
  if (!envelope) return { envelope: null, elapsed_ms, prompt_chars: prompt.length, state: "not-evaluated", reason: "unparseable judge output" };
  return { envelope, elapsed_ms, prompt_chars: prompt.length, state: "verified", reason: null, raw_chars: (r.stdout || "").length };
}

// ── live CLI: real judge, sandbox-recorded, shadow only ────────────────────────────────────────
// ⛔ Kept behind a direct-entry check so importing this module for reuse never fires a model call.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { deterministicGate, normalizeConcernKey } = await import("./ownership-shadow-proposer.mjs");
  const { readCarrierHistory } = await import("./ownership-shadow-live.mjs");
  const { launchArgv, runAsync } = await import("../../plugin/scripts/driver-runtime.ts");

  const args = process.argv.slice(2);
  const rounds = Number(args[args.indexOf("--rounds") + 1] || 1);
  const root = REPO_ROOT;
  const carrier = path.join(root, ".quay", "ownership-shadow-proposals.jsonl");

  // the LIVE judge: the same launcher path the meta probe uses (prompt via stdin — the
  // MAX_ARG_STRLEN fix from gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen).
  const invokeJudge = async (prompt) => {
    const argv = launchArgv("meta-driver", prompt, root, { promptViaStdin: true });
    return runAsync(argv, { timeoutMs: 600_000, collectStderr: true, stdinData: prompt });
  };

  const out = [];
  for (let i = 0; i < rounds; i++) {
    const ev = buildSemanticEvidence(root);
    const res = await proposeSemantic(ev, { invokeJudge });
    const rec = {
      ts_iso: new Date().toISOString(),
      proposer_id: "ownership-shadow-semantic",
      round: i + 1,
      state: res.state,
      reason: res.reason,
      latency_ms: res.elapsed_ms,
      prompt_chars: res.prompt_chars,
      executed: false,
    };
    if (res.envelope) {
      const history = readCarrierHistory(carrier).filter((h) => h.proposer_id && !h.case);
      const existing = new Set(history.map((h) => h.concern_key).filter(Boolean));
      const gate = deterministicGate(res.envelope, { evidenceRefs: semanticEvidenceRefs(ev), existingConcernKeys: existing });
      rec.action = res.envelope.recommended_next_action;
      rec.is_abstain = res.envelope.recommended_next_action === "abstain";
      rec.gate_ok = gate.ok;
      rec.gate_reasons = gate.reasons;
      rec.concern_key = gate.concern_key;
      rec.is_repeat = existing.has(gate.concern_key);
      rec.interventions = (res.envelope.candidate_interventions || []).length;
      rec.envelope = res.envelope;
    } else {
      rec.gate_ok = false;
      rec.gate_reasons = [`NOT_EVALUATED:${res.reason}`];
    }
    fs.mkdirSync(path.dirname(carrier), { recursive: true });
    fs.appendFileSync(carrier, JSON.stringify(rec) + "\n", "utf8");
    out.push(rec);
  }
  console.log(JSON.stringify(out, null, 2));
}
