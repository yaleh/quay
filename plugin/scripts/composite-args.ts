// composite-args.ts — M189/DIR-119-B Stage 2.1: argument normalization for `execute-milestone`.
//
// Extends the workflow's argument surface from scalar-only `{taskId, charterFile,
// absorbEntryFile}` to ALSO accept `{milestoneCandidate:{taskIds,...}, charterFile,
// compositeManifestFile, absorbEntryFile}` (plan doc
// `docs/plans/adaptive-composite-milestone-select-and-execution.md` §Phase 2 / Stage 2.1).
// Both shapes normalize to ONE internal `taskIds: string[]`. This is the single normalization
// point (ADR-004) — `execute-milestone.js`'s inline arg-handling and any future caller import
// from here rather than re-deriving the shape rules.
//
// Hard invariant (Done-when clause 1): NEVER reject on `taskIds.length` — 1, 3, 5, 10, or any
// other width is equally valid. The only rejections are identity/consistency problems: missing
// task identity, invalid/duplicate ids, a stale source hash, or legacy+new args that disagree.

import { normalizeLegacyCall, type LegacyWorkflowArgs } from "./candidate-contracts.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export interface MilestoneCandidateRef {
  candidateId?: string;
  /** Non-empty; NO maximum enforced anywhere in this module. */
  taskIds: string[];
  /** Optional per-task source-hash provenance, checked against `opts.currentSourceHashes` when given. */
  sourceHashes?: Record<string, string>;
}

export interface NewExecuteArgs {
  milestoneCandidate: MilestoneCandidateRef;
  charterFile?: string;
  compositeManifestFile?: string;
  absorbEntryFile?: string;
}

/** The raw `args`/`$a` object a workflow caller might pass — legacy fields, new fields, or both. */
export type RawExecuteArgs = Partial<LegacyWorkflowArgs & NewExecuteArgs> & Record<string, unknown>;

export interface NormalizedExecuteArgs {
  taskIds: string[];
  charterFile?: string;
  absorbEntryFile?: string;
  compositeManifestFile?: string;
  candidateId?: string;
  /** true iff this call arrived via the NEW `milestoneCandidate` shape (even if taskIds.length===1). */
  isComposite: boolean;
}

export interface NormalizeOpts {
  /** Current on-disk/live source hash per task id, for stale-hash detection. Omit to skip the check. */
  currentSourceHashes?: Record<string, string>;
}

export class ExecuteArgsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ExecuteArgsError";
    this.code = code;
  }
}

// ── normalizeExecuteArgs ───────────────────────────────────────────────────────────────────────────

export function normalizeExecuteArgs(raw: RawExecuteArgs, opts: NormalizeOpts = {}): NormalizedExecuteArgs {
  if (!raw || typeof raw !== "object") {
    throw new ExecuteArgsError("invalid-args", "args must be an object");
  }

  const hasLegacyTaskId = typeof raw.taskId === "string" && raw.taskId.length > 0;
  const hasNewCandidate = raw.milestoneCandidate != null && typeof raw.milestoneCandidate === "object";

  if (!hasLegacyTaskId && !hasNewCandidate) {
    throw new ExecuteArgsError(
      "missing-task-identity",
      "neither legacy `taskId` nor new `milestoneCandidate.taskIds` was provided",
    );
  }

  // ── Conflicting legacy/new args: both given AND they disagree ──
  if (hasLegacyTaskId && hasNewCandidate) {
    const candTaskIds = Array.isArray(raw.milestoneCandidate!.taskIds) ? raw.milestoneCandidate!.taskIds : [];
    const agrees = candTaskIds.length === 1 && candTaskIds[0] === raw.taskId;
    if (!agrees) {
      throw new ExecuteArgsError(
        "conflicting-legacy-and-new-args",
        `both taskId ("${raw.taskId}") and milestoneCandidate.taskIds (${JSON.stringify(candTaskIds)}) were given and do not agree`,
      );
    }
    // agrees (redundant restatement of the same singleton) — fall through to new-shape handling below.
  }

  if (hasNewCandidate) {
    const mc = raw.milestoneCandidate as MilestoneCandidateRef;
    if (!Array.isArray(mc.taskIds) || mc.taskIds.length === 0) {
      // Zero tasks is an identity problem (nothing to execute), NOT a "too small" length rejection —
      // any length >= 1 is accepted; length === 0 is not a composite at all.
      throw new ExecuteArgsError("empty-task-array", "milestoneCandidate.taskIds must be a non-empty array");
    }
    for (const id of mc.taskIds) {
      if (typeof id !== "string" || id.length === 0) {
        throw new ExecuteArgsError("invalid-task-id", `invalid task id in milestoneCandidate.taskIds: ${JSON.stringify(id)}`);
      }
    }
    const seen = new Set<string>();
    for (const id of mc.taskIds) {
      if (seen.has(id)) {
        throw new ExecuteArgsError("duplicate-task-id", `duplicate task id in milestoneCandidate.taskIds: ${id}`);
      }
      seen.add(id);
    }
    if (mc.sourceHashes && opts.currentSourceHashes) {
      for (const id of mc.taskIds) {
        const declared = mc.sourceHashes[id];
        const current = opts.currentSourceHashes[id];
        if (declared != null && current != null && declared !== current) {
          throw new ExecuteArgsError(
            "stale-hash",
            `source hash for ${id} is stale: candidate declared ${declared}, current is ${current}`,
          );
        }
      }
    }
    return {
      taskIds: mc.taskIds,
      charterFile: raw.charterFile as string | undefined,
      absorbEntryFile: raw.absorbEntryFile as string | undefined,
      compositeManifestFile: raw.compositeManifestFile as string | undefined,
      candidateId: mc.candidateId,
      isComposite: true,
    };
  }

  // ── Legacy-only path: delegate to the existing single-source normalizer (compatibility
  // invariant #2 — DO NOT re-derive `[taskId]` here). ──
  const legacy = normalizeLegacyCall({
    taskId: raw.taskId as string,
    charterFile: raw.charterFile as string | undefined,
    absorbEntryFile: raw.absorbEntryFile as string | undefined,
  });
  return {
    taskIds: legacy.taskIds,
    charterFile: legacy.charterFile,
    absorbEntryFile: legacy.absorbEntryFile,
    compositeManifestFile: raw.compositeManifestFile as string | undefined,
    isComposite: false,
  };
}

// ── selftest ───────────────────────────────────────────────────────────────────────────────────────

export function selftest(): boolean {
  let allPassed = true;
  function check(name: string, condition: boolean, detail: string): void {
    if (condition) {
      console.log(`SELFTEST PASS: ${name} — ${detail}`);
    } else {
      console.error(`SELFTEST FAIL: ${name} — ${detail}`);
      allPassed = false;
    }
  }
  function throws(fn: () => unknown): ExecuteArgsError | null {
    try {
      fn();
      return null;
    } catch (e) {
      return e as ExecuteArgsError;
    }
  }

  // Legacy shape normalizes exactly as before (compatibility invariant #1/#2).
  const legacy = normalizeExecuteArgs({ taskId: "DIR-1", charterFile: "c.md", absorbEntryFile: "a.md" });
  check("legacy-normalizes", legacy.taskIds.length === 1 && legacy.taskIds[0] === "DIR-1" && legacy.isComposite === false, JSON.stringify(legacy));

  // New shape at widths 1, 3, 5, 10 — NEVER rejected on length.
  for (const n of [1, 3, 5, 10, 50]) {
    const taskIds = Array.from({ length: n }, (_, i) => `T-${i}`);
    const wide = normalizeExecuteArgs({ milestoneCandidate: { candidateId: `c-${n}`, taskIds } });
    check(`new-shape-width-${n}-accepted`, wide.taskIds.length === n && wide.isComposite === true, JSON.stringify(wide.taskIds.length));
  }

  // Duplicate task ids rejected.
  const dup = throws(() => normalizeExecuteArgs({ milestoneCandidate: { taskIds: ["A", "B", "A"] } }));
  check("duplicate-task-id-rejected", dup?.code === "duplicate-task-id", String(dup));

  // Invalid (empty-string) task id rejected.
  const invalid = throws(() => normalizeExecuteArgs({ milestoneCandidate: { taskIds: ["A", ""] } }));
  check("invalid-task-id-rejected", invalid?.code === "invalid-task-id", String(invalid));

  // Empty task array rejected (identity problem, not a "too small" length rejection).
  const empty = throws(() => normalizeExecuteArgs({ milestoneCandidate: { taskIds: [] } }));
  check("empty-task-array-rejected", empty?.code === "empty-task-array", String(empty));

  // Missing identity entirely rejected.
  const missing = throws(() => normalizeExecuteArgs({ charterFile: "c.md" }));
  check("missing-identity-rejected", missing?.code === "missing-task-identity", String(missing));

  // Conflicting legacy+new args (disagreeing) rejected.
  const conflict = throws(() =>
    normalizeExecuteArgs({ taskId: "DIR-1", milestoneCandidate: { taskIds: ["DIR-2", "DIR-3"] } }),
  );
  check("conflicting-legacy-new-rejected", conflict?.code === "conflicting-legacy-and-new-args", String(conflict));

  // Compatible overlap (legacy taskId restates the sole candidate task) is accepted, not a conflict.
  const compatible = normalizeExecuteArgs({ taskId: "DIR-1", milestoneCandidate: { taskIds: ["DIR-1"] } });
  check("compatible-legacy-new-restatement-accepted", compatible.taskIds.length === 1 && compatible.taskIds[0] === "DIR-1", JSON.stringify(compatible));

  // Stale hash rejected when a currentSourceHashes map is supplied and disagrees.
  const stale = throws(() =>
    normalizeExecuteArgs(
      { milestoneCandidate: { taskIds: ["A"], sourceHashes: { A: "old-hash" } } },
      { currentSourceHashes: { A: "new-hash" } },
    ),
  );
  check("stale-hash-rejected", stale?.code === "stale-hash", String(stale));

  // Matching hash accepted.
  const fresh = normalizeExecuteArgs(
    { milestoneCandidate: { taskIds: ["A"], sourceHashes: { A: "same-hash" } } },
    { currentSourceHashes: { A: "same-hash" } },
  );
  check("matching-hash-accepted", fresh.taskIds.length === 1, JSON.stringify(fresh));

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

if (process.argv[1] != null && process.argv[1].endsWith("composite-args.ts") && process.argv.includes("--selftest")) {
  process.exitCode = selftest() ? 0 : 1;
}
