#!/usr/bin/env node
// LIVE shadow run for the ownership/architecture proposer.
// Implements the "live shadow" half of tasks/gap-ownership-shadow-proposer-contract-and-replay.md.
//
// Reads the CURRENT workspace's mechanical state, proposes, gates, and APPENDS to the sandbox
// carrier — recording proposer attribution, wall-clock, and dedup/repetition hits ACROSS rounds
// (unlike the offline replay, where dedup is correctly per-round because each case is an
// independent historical decision point; here every run is the same evolving present, so a
// repeat IS a repeat).
//
// ⛔ Writes ONLY to the sandbox carrier (.quay/ownership-shadow-proposals.jsonl, gitignored).
// Creates no task/goal/AC, changes no status, executes no proposal.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deterministicGate, normalizeConcernKey } from "./ownership-shadow-proposer.mjs";
import { baselinePropose, buildEvidenceIndex } from "./ownership-shadow-replay.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CARRIER = path.join(REPO_ROOT, ".quay", "ownership-shadow-proposals.jsonl");

/** Read the CURRENT mechanical state. Deliberately narrow: only what is cheaply and reliably
 *  readable from disk (no network, no LLM, no heavy MCP call) — the proposer's job is to reason
 *  over readings, not to gather them (ADR-033). */
export function readLiveEvidence(root = REPO_ROOT) {
  const idx = new Map();

  // goals: status tallies + the active set (the things a proposal could actually concern)
  const goalsDir = path.join(root, "goals");
  const goalStatus = {};
  const activeGoals = [];
  if (fs.existsSync(goalsDir)) {
    for (const f of fs.readdirSync(goalsDir).filter((x) => x.startsWith("GOAL-") && x.endsWith(".md"))) {
      const txt = fs.readFileSync(path.join(goalsDir, f), "utf8");
      const m = txt.match(/^status:\s*(\S+)/m);
      const s = m ? m[1] : "unknown";
      goalStatus[s] = (goalStatus[s] || 0) + 1;
      if (s === "active") activeGoals.push(f.replace(/-.*$/, ""));
    }
  }
  idx.set("goals:status_tally", goalStatus);
  idx.set("goals:active", activeGoals);

  // tasks: status tallies (board pressure is a legitimate ownership-adjacent signal)
  const tasksDir = path.join(root, "tasks");
  const taskStatus = {};
  if (fs.existsSync(tasksDir)) {
    for (const f of fs.readdirSync(tasksDir).filter((x) => x.endsWith(".md")).slice(0, 4000)) {
      const m = fs.readFileSync(path.join(tasksDir, f), "utf8").match(/^status:\s*(\S+)/m);
      const s = m ? m[1] : "unknown";
      taskStatus[s] = (taskStatus[s] || 0) + 1;
    }
  }
  idx.set("tasks:status_tally", taskStatus);

  // the most recent landed goal merges — the "recent outcome" evidence
  idx.set("goals:recently_achieved", goalStatus.achieved ? [`achieved=${goalStatus.achieved}`] : []);
  return idx;
}

/** Build an input shaped like the replay corpus's `input.json` so baselinePropose can be REUSED
 *  verbatim (⛔ no second proposer implementation to drift). */
export function liveInputFromEvidence(idx) {
  const tally = idx.get("goals:status_tally") || {};
  const tasks = idx.get("tasks:status_tally") || {};
  return {
    case_id: "LIVE",
    context: {
      repo_state_summary: `live workspace: goals ${JSON.stringify(tally)}; tasks ${JSON.stringify(tasks)}`,
      archguard_readings_before: {
        note: "no live archguard snapshot wired in this v1 — the baseline proposer therefore has only workspace-shape evidence, and its OUT_OF_DOMAIN/dedup behaviour (not its architectural insight) is what this run measures",
        goals_status_tally: JSON.stringify(tally),
        tasks_status_tally: JSON.stringify(tasks),
      },
      code_pointers: [],
      related_landed_tasks: [],
      prior_goal_precedents: [],
    },
  };
}

export function readCarrierHistory(carrier = CARRIER) {
  if (!fs.existsSync(carrier)) return [];
  return fs
    .readFileSync(carrier, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

/** One live shadow round. Records; never acts. */
export function runLiveRound({ root = REPO_ROOT, carrier = CARRIER } = {}) {
  const started = Date.now();
  const input = liveInputFromEvidence(readLiveEvidence(root));
  const envelope = baselinePropose(input);
  // ⛔ The gate must police the SAME evidence namespace the proposer cited from. Deriving it from
  // readLiveEvidence() instead (which uses goals:/tasks: keys) made every archguard: citation
  // unresolvable — a real integration bug the OFFLINE replay never hit, because there both sides
  // used buildEvidenceIndex(input). Caught by the first live round.
  const proposerIdx = buildEvidenceIndex(input);

  // dedup ACROSS LIVE rounds (this is the evolving present, not independent historical cases).
  // ⛔ Scoped to LIVE records only: the same carrier also holds OFFLINE REPLAY records (which
  // carry `case`), and matching a live proposal against a historical replay case would flag a
  // genuine current-state proposal as a "repeat" of an unrelated past decision.
  const history = readCarrierHistory(carrier).filter((h) => h.proposer_id && !h.case);
  const existingKeys = new Set(history.map((h) => h.concern_key).filter(Boolean));
  const key = normalizeConcernKey(envelope.concern);

  const gate = deterministicGate(envelope, {
    evidenceRefs: new Set(proposerIdx.keys()),
    existingConcernKeys: existingKeys,
  });

  const record = {
    ts_iso: new Date(started).toISOString(),
    proposer_id: envelope.proposer_id,
    action: envelope.recommended_next_action,
    gate_ok: gate.ok,
    gate_reasons: gate.reasons,
    concern_key: key,
    is_repeat: existingKeys.has(key),
    elapsed_ms: Date.now() - started,
    executed: false,
    note: "shadow only — recorded, never executed",
  };

  fs.mkdirSync(path.dirname(carrier), { recursive: true });
  fs.appendFileSync(carrier, JSON.stringify(record) + "\n", "utf8");
  return record;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rounds = Number(process.argv[process.argv.indexOf("--rounds") + 1] || 1);
  const out = [];
  for (let i = 0; i < rounds; i++) out.push(runLiveRound({}));
  console.log(JSON.stringify(out, null, 2));
}
