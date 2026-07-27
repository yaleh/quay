// candidate-synthesis-fixtures.ts — M188/DIR-119-A Stage 1.1: the six deterministic historical-replay
// fixtures named in the charter/task AC, as data (not prose) — single-source for
// candidate-synthesis.test.mjs (and any future consumer) so the fixture shapes are never hand-copied
// into more than one place. Each fixture is a plain {tasks, explicitEdges} fact set consumable
// directly by coupling-graph.ts / candidate-synthesis.ts / portfolio-choice.ts — no I/O, no task-store
// dependency, fully deterministic.
//
// These are DELIBERATELY synthetic stand-ins for the real historical task records they name (DIR-114,
// DIR-115, DIR-109..112, DIR-062-B/-C) — Stage 1.2's job is a live task-store extractor; Stage 1.1's
// job (this file) is only to prove the CONTRACT/SYNTHESIS/PORTFOLIO shapes can represent the outcomes
// those real records are known to require, without needing a live task-store read to prove it.

import type { TaskCandidate, CouplingEdge } from "./candidate-contracts.ts";

function task(id: string, touches: string[], estimatedValue = 5, lineEstimate = 60, dependsOn: string[] = []): TaskCandidate {
  return {
    version: 1,
    id,
    status: "todo",
    labels: [],
    valueType: "capabilityGrowth",
    eligible: true,
    estimatedValue,
    deliverySurface: ["method-infra"],
    touches,
    semanticResources: [],
    dependsOn,
    verificationBoundary: "scripts/test.sh",
    acCount: 3,
    lineEstimate,
    sourceHash: `fixture-hash-${id}`,
  };
}

export interface HistoricalFixture {
  name: string;
  description: string;
  tasks: TaskCandidate[];
  explicitEdges: CouplingEdge[];
}

// ── (a) DIR-114 + M176-capture-gap + DIR-115: a 3-task workflow-hardening candidate ─────────────────
// All three genuinely touch the same workflow-capture surface — real coupling, not an inflated bundle.
export const FIXTURE_A_WORKFLOW_HARDENING: HistoricalFixture = {
  name: "workflow-hardening-triad",
  description: "DIR-114 + M176 capture-gap + DIR-115 form a 3-task workflow-hardening candidate",
  tasks: [
    task("DIR-114", [".claude/workflows/execute-milestone.js", "experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.ts"], 8),
    task("gap-absorb-charter-audit-not-committed", [".claude/workflows/execute-milestone.js"], 4),
    task("DIR-115", [".claude/workflows/execute-milestone.js", "experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.ts"], 6),
  ],
  explicitEdges: [],
};

// ── (b) DIR-109–DIR-112: multiple comparable shapes, not one forced bundle ──────────────────────────
// 109/110 share one implementation surface; 111/112 share a DIFFERENT one. A weak single-file overlap
// links the two pairs so a maximal 4-task shape IS reachable, but the synthesizer must also retain the
// smaller, tighter 2-task alternative per seed (multiple comparable shapes).
export const FIXTURE_B_MULTI_SHAPE: HistoricalFixture = {
  name: "dir109-112-multi-shape",
  description: "DIR-109–DIR-112 generates multiple comparable shapes rather than forcing one bundle",
  tasks: [
    task("DIR-109", ["experiments/quay-perpetual-stream/scripts/it0-dod-check.ts"], 7),
    task("DIR-110", ["experiments/quay-perpetual-stream/scripts/it0-dod-check.ts"], 7),
    task("DIR-111", ["experiments/quay-perpetual-stream/scripts/rolling-slope-check.ts"], 6),
    task("DIR-112", ["experiments/quay-perpetual-stream/scripts/rolling-slope-check.ts"], 6),
  ],
  explicitEdges: [],
};

// ── (c) DIR-062-B → DIR-062-C: kept separate by their next-generation proof edge ────────────────────
// They genuinely share touches (both edit the same classifier module), which WOULD read as positive
// coupling — but DIR-062-C is a cold-generation proof of DIR-062-B's own wiring (the same
// "bootstrap-paradox" this milestone documents for itself), so they must never land in one candidate.
export const FIXTURE_C_NEXT_GENERATION_SPLIT: HistoricalFixture = {
  name: "dir062-b-c-next-generation-split",
  description: "DIR-062-B and DIR-062-C stay in separate candidates because of their next-generation proof edge",
  tasks: [
    task("DIR-062-B", ["experiments/quay-perpetual-stream/scripts/human-steered-classify.ts"], 9),
    task("DIR-062-C", ["experiments/quay-perpetual-stream/scripts/human-steered-classify.ts"], 9),
  ],
  explicitEdges: [
    {
      a: "DIR-062-B",
      b: "DIR-062-C",
      kind: "next-generation",
      evidence: "DIR-062-C is a cold, later-generation real-wiring proof of DIR-062-B — cannot be self-certified in the same generation/candidate",
    },
  ],
};

// ── (d) a ten-task homogeneous reconciliation group NOT rejected for cardinality ────────────────────
export const FIXTURE_D_TEN_TASK_RECONCILE: HistoricalFixture = {
  name: "ten-task-reconciliation",
  description: "a ten-task homogeneous reconciliation group remains eligible — no cardinality cap",
  tasks: Array.from({ length: 10 }, (_, i) => task(`RECON-${i}`, ["experiments/quay-perpetual-stream/scripts/task-schema.ts"], 3, 20)),
  explicitEdges: [],
};

// ── (e) a disconnected value-inflating addition is rejected ─────────────────────────────────────────
// UNRELATED-HIGH-VALUE shares no touches/semantic-resource/dependency edge with anything — however
// valuable it claims to be, it can never join a composite; it can only ever be its own singleton.
export const FIXTURE_E_DISCONNECTED_REJECTED: HistoricalFixture = {
  name: "disconnected-value-inflating-addition",
  description: "an unrelated disconnected task cannot be added merely to inflate value",
  tasks: [
    task("CORE-1", ["packages/quay/src/gate/engine.ts"], 8),
    task("CORE-2", ["packages/quay/src/gate/engine.ts"], 8),
    task("UNRELATED-HIGH-VALUE", ["docs/proposals/unrelated-proposal.md"], 500),
  ],
  explicitEdges: [],
};

// ── (f) a task cannot occur in two SELECTED milestone candidates ───────────────────────────────────
// Two overlapping composite shapes over the same 3-task pool (a genuine tie-breaking scenario) — the
// synthesizer may offer both as alternatives; portfolio-choice.ts must select only ONE and reject the
// other with an explicit overlap reason, so no task ends up double-booked.
export const FIXTURE_F_NO_DOUBLE_MEMBERSHIP: HistoricalFixture = {
  name: "no-double-membership",
  description: "a task cannot occur in two selected milestone candidates",
  tasks: [task("SHARE-1", ["shared-hub.ts"], 6), task("SHARE-2", ["shared-hub.ts"], 6), task("SHARE-3", ["shared-hub.ts"], 6)],
  explicitEdges: [],
};

export const ALL_HISTORICAL_FIXTURES: HistoricalFixture[] = [
  FIXTURE_A_WORKFLOW_HARDENING,
  FIXTURE_B_MULTI_SHAPE,
  FIXTURE_C_NEXT_GENERATION_SPLIT,
  FIXTURE_D_TEN_TASK_RECONCILE,
  FIXTURE_E_DISCONNECTED_REJECTED,
  FIXTURE_F_NO_DOUBLE_MEMBERSHIP,
];
