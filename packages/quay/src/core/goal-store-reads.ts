// quay Core: the goal store's READ surface — `get` / `list` / `listWithMalformed` and the
// derived judgments over a listing (`activeGoals`, `listActiveCriteria`, `isGoalAchieved`).
//
// Extracted verbatim from `createGoalStore`'s closure (tasks/gap-routine-architecture-analysis-
// god-function-creategoalstore): the factory keeps the store's write + orchestration, this module
// owns "what is on disk, projected". ⛔ PURE-READ — nothing here runs a criterion or writes a file.
//
// `createGoalReads` is a FACTORY over `(goalDir, assertSafeId)` rather than a set of free
// functions because `goalDir` is bound once per store instance and `assertSafeId` is the store's
// own id-safety gate (the same one `write` uses) — passing both explicitly keeps the ONE
// definition instead of re-deriving either.

import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, fileNameForId } from "./frontmatter-store-base.ts";
import { isGoalId, type GoalFilter, type GoalFrontmatter, type GoalViewModel } from "./goal-store-types.ts";
import { ledgerEvidenceMap, type LedgerEvidence } from "./goal-store-ledger.ts";
import { readGoalStalenessIndex } from "./goal-staleness.ts";


export interface GoalReads {
  toViewModel: (
    frontmatter: GoalFrontmatter,
    body: string,
    evidenceMap: Map<string, LedgerEvidence>,
    updatedAt?: number,
  ) => GoalViewModel;
  get: (id: string) => GoalViewModel | null;
  listWithMalformed: (filter?: GoalFilter) => {
    items: GoalViewModel[];
    malformed: Array<{ file: string; error: string }>;
  };
  list: (filter?: GoalFilter) => GoalViewModel[];
  activeGoals: () => GoalViewModel[];
  listActiveCriteria: () => GoalViewModel[];
  isGoalAchieved: (goalId: string) => boolean;
}

/** Compose the read surface over ONE goals directory. `assertSafeId` is the store's id gate. */
export function createGoalReads(
  goalDir: string,
  assertSafeId: (id: string) => void,
): GoalReads {
// ── lastProgressAt / firstEvidenceAt for GOAL rows (M1 time columns) ──────────────────────────
// A GOAL's time is DERIVED from its ACs' ledger-derived evidence — NEVER its own `updatedAt`
// (mtime) and never a stored field (hard rule 4b: a quantity the measured object produces is not
// a measurement). lastProgressAt = max over ACs of `evidence.at` (its most recent progress);
// firstEvidenceAt = min over ACs of `evidence.firstAt` (its earliest evidence). Criterion records
// already carry their own last/first from toViewModel (their own gate events); this pass overrides
// the (undefined) GOAL values. Runs over the FULL pre-filter list so a `?kind=goal`/`?goal=` filter
// can never empty a goal's AC set (hard rule 3b — the rollup and time must not collapse under filter).
function annotateGoalProgress(all: GoalViewModel[]): void {
  const byGoal = new Map<string, GoalViewModel[]>();
  for (const g of all) {
    if (typeof g.goal !== "string") continue;
    const arr = byGoal.get(g.goal) ?? [];
    arr.push(g);
    byGoal.set(g.goal, arr);
  }
  for (const g of all) {
    if (!isGoalId(String(g.id))) continue;
    const acs = byGoal.get(String(g.id)) ?? [];
    let lastMs: number | undefined;
    let firstMs: number | undefined;
    let lastStr: string | undefined;
    let firstStr: string | undefined;
    for (const ac of acs) {
      const ev = ac.evidence as { at?: unknown; firstAt?: unknown } | undefined;
      if (ev && typeof ev.at === "string") {
        const t = Date.parse(ev.at);
        if (!Number.isNaN(t) && (lastMs === undefined || t > lastMs)) { lastMs = t; lastStr = ev.at; }
      }
      if (ev && typeof ev.firstAt === "string") {
        const t = Date.parse(ev.firstAt);
        if (!Number.isNaN(t) && (firstMs === undefined || t < firstMs)) { firstMs = t; firstStr = ev.firstAt; }
      }
    }
    g.lastProgressAt = lastStr;
    g.firstEvidenceAt = firstStr;
  }
}

/**
 * Attach the derived staleness judgment to every GOAL row in `all` (gap-goal-status-stale-achieved-
 * after-new-active-criterion-filed AC2). Reads the carrier ONCE for the whole list, ⛔ not per row —
 * the same "compute over the FULL pre-filter list" discipline `annotateGoalProgress` uses, so a
 * `?kind=criterion` filter can never change what a goal's staleness reads as.
 *
 * Set on GOAL records ONLY: staleness is a claim about a GOAL's own `status` field, and an AC
 * record carries no such field (attaching it there would be a value with no subject).
 */
function annotateGoalStaleness(all: GoalViewModel[], goalDir: string): void {
  if (!all.some((g) => isGoalId(String(g.id)))) return;
  const idx = readGoalStalenessIndex(goalDir);
  for (const g of all) {
    if (!isGoalId(String(g.id))) continue;
    if (!idx.evaluated) {
      // Unreadable carrier ⇒ EVERY goal reads `not-evaluated`, never `clean` (hard rule 3b).
      g.staleness = { state: "not-evaluated", signals: [], reason: idx.reason };
      continue;
    }
    const signals = idx.byGoal.get(String(g.id)) ?? [];
    g.staleness = signals.length > 0 ? { state: "stale", signals } : { state: "clean", signals: [] };
  }
}

  function toViewModel(
    frontmatter: GoalFrontmatter,
    body: string,
    evidenceMap: Map<string, LedgerEvidence>,
    updatedAt?: number,
  ): GoalViewModel {
    const evidence = evidenceMap.get(String(frontmatter.id ?? ""));
    const vm: GoalViewModel = {
      id: frontmatter.id,
      title: frontmatter.title,
      status: frontmatter.status,
      kind: frontmatter.kind,
      goal: frontmatter.goal,
      criterion: frontmatter.criterion,
      expect: frontmatter.expect,
      origin: frontmatter.origin,
      posture: frontmatter.posture,
      timeoutMs: frontmatter.timeoutMs,
      longTerm: frontmatter["long-term"] === true,
      // Undeclared reads as `false` (SPEC §4.1: 「缺省 = false = 现状」) — a three-state answer here
      // would put the two consumers that must treat them identically (branch or not) at odds.
      branch: frontmatter.branch === true,
      // SPEC-goal-branch §4.7: undeclared reads as `pre-merge` (the failure-visible default). The
      // write path refuses any other value, so a legacy/hand-written file carrying an unknown token
      // also projects as `pre-merge` — never as an `undefined` a driver would have to guess at.
      phase: frontmatter.phase === "post-merge" ? "post-merge" : "pre-merge",
      fidelity: frontmatter.fidelity,
      evidence,
      // Own-record time (a criterion): lastProgressAt = its LAST gate=goal event, firstEvidenceAt =
      // its FIRST. A GOAL's own fields are undefined here (GOALs carry no criterion and are never
      // gated themselves) — list() derives a GOAL's time from its ACs via annotateGoalProgress.
      lastProgressAt: typeof evidence?.at === "string" ? evidence.at : undefined,
      firstEvidenceAt: typeof evidence?.firstAt === "string" ? evidence.firstAt : undefined,
      activatedAt: frontmatter.activatedAt,
      statusLog: frontmatter.statusLog,
      supersedes: frontmatter.supersedes ?? [],
      supersededBy: frontmatter["superseded-by"] ?? [],
      body,
    };
    if (updatedAt !== undefined) vm.updatedAt = updatedAt;
    return vm;
  }

  function get(id: string): GoalViewModel | null {
    assertSafeId(id);
    const file = fileNameForId(goalDir, id);
    if (!file) return null;
    const p = path.join(goalDir, file);
    const { frontmatter, body } = parseFrontmatter(fs.readFileSync(p, "utf8"));
    let updatedAt: number | undefined;
    try {
      updatedAt = fs.statSync(p).mtimeMs;
    } catch { /* omit */ }
    const vm = toViewModel(frontmatter as GoalFrontmatter, body, ledgerEvidenceMap(goalDir), updatedAt);
    // Same derived judgment `list()` attaches, for the single-record reader (goal_get / `goal show`
    // / write()'s own return) — ⛔ no second implementation, `annotateGoalStaleness` is the ONE.
    annotateGoalStaleness([vm], goalDir);
    return vm;
  }

  // gap-store-list-all-or-nothing-unparseable-file-kills-whole-listing: the
  // TOLERANT walk. A carrier file whose NAME matches the collection predicate
  // (GOAL-* / AC-*) but whose CONTENT carries no frontmatter block poisons
  // exactly its own entry — never the whole listing. Same shape as the three
  // sibling stores (adr / document / meta); the failure list is the SAME
  // `{ file, error }` shape the task board returns from `listWithMalformed()`
  // (DoD2/DoD3).
  //
  // Collect-vs-throw is decided by TYPE of failure (AC4):
  //   - `readdirSync` is NOT caught — a missing/unreadable carrier DIRECTORY
  //     still throws; a loud failure must never degrade into an empty listing.
  //   - `readFileSync` is NOT caught — an unreadable FILE (EACCES/ENOENT) is a
  //     real read failure and still throws. It is not a parse failure.
  //   - ONLY the frontmatter parse is caught → collected as a malformed entry.
  //
  // The malformed files are excluded BEFORE the derived annotations, which keep
  // running over the FULL parseable list (a bad sibling file must not change
  // what a healthy goal's progress/staleness reads as — hard rule 3b).
  //
  // `includeEvidence:false` (gap-goal-list-ledger-scan) is the LEDGER-FREE projection: the whole
  // evidence derivation is skipped at its SOURCE (no `ledgerEvidenceMap` scan — that single call is
  // the ~1.3s cost this option exists to remove) and so are the two annotations built on it. The
  // output is still the complete `GoalViewModel[]`; `evidence` / `staleness` / `lastProgressAt` (and
  // `firstEvidenceAt`) are simply ABSENT, ⛔ not present-and-empty — "not read" must not be able to
  // look like "read, nothing there" (hard rule 3b).
  function listWithMalformed(filter: GoalFilter = {}): {
    items: GoalViewModel[];
    malformed: Array<{ file: string; error: string }>;
  } {
    const includeEvidence = filter.includeEvidence !== false;
    const evidenceMap = includeEvidence
      ? ledgerEvidenceMap(goalDir)
      // ⛔ the empty Map is the point, not a fallback: with the option off, no ledger read happens at
      // all. A caller that opted out gets undefined evidence on every row (the `get()` of an empty map).
      : new Map<string, LedgerEvidence>();
    const malformed: Array<{ file: string; error: string }> = [];
    const all: GoalViewModel[] = [];
    for (const f of fs.readdirSync(goalDir)) {
      if (!(f.endsWith(".md") && (f.startsWith("GOAL-") || f.startsWith("AC-")))) continue;
      const p = path.join(goalDir, f);
      const raw = fs.readFileSync(p, "utf8");
      let parsed: { frontmatter: GoalFrontmatter; body: string } | null = null;
      try {
        parsed = parseFrontmatter(raw) as { frontmatter: GoalFrontmatter; body: string };
      } catch (err) {
        malformed.push({ file: f, error: (err as Error).message });
      }
      if (!parsed) continue;
      let updatedAt: number | undefined;
      try { updatedAt = fs.statSync(p).mtimeMs; } catch { /* optional mtime, same as get() */ }
      all.push(toViewModel(parsed.frontmatter, parsed.body, evidenceMap, updatedAt));
    }
    if (includeEvidence) {
      // GOAL rows' time is derived from their ACs — computed over the FULL list before any filter.
      annotateGoalProgress(all);
      // …and their staleness is derived from the side carrier, over the SAME full list (a filter must
      // never be able to change what a goal's staleness reads as — hard rule 3b).
      annotateGoalStaleness(all, goalDir);
    }
    return {
      items: all
        .filter((g) => (filter.status ? g.status === filter.status : true))
        .filter((g) => (filter.kind ? g.kind === filter.kind : true))
        .filter((g) => (filter.goal ? g.goal === filter.goal : true))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
      malformed,
    };
  }

  // The plain ARRAY view of the SAME walk: one unparseable carrier file must
  // not take down the listing. Callers that must not lose a file — that need
  // to know WHICH file was skipped and WHY — use listWithMalformed().
  function list(filter: GoalFilter = {}): GoalViewModel[] {
    return listWithMalformed(filter).items;
  }

  // I1: the (at most one) currently-active GOAL. Derived from stored status, never hand-listed.
  function activeGoals(): GoalViewModel[] {
    return list().filter((g) => isGoalId(String(g.id)) && g.status === "active");
  }

  // AC4: the ACTIVE SET is DERIVED from goal status, never a hand-maintained checklist.
  // A criterion record is "active" ⟺ its goal's stored status is `active`.
  function listActiveCriteria(): GoalViewModel[] {
    const activeGoalIds = new Set(activeGoals().map((p) => String(p.id)));
    return list().filter((g) => !isGoalId(String(g.id)) && activeGoalIds.has(String(g.goal)));
  }

  // I2: a GOAL is achieved ⟺ ALL its ACs are achieved. Evaluated at read time, never stored.
  function isGoalAchieved(goalId: string): boolean {
    assertSafeId(goalId);
    if (!isGoalId(goalId)) {
      throw new Error(`isGoalAchieved requires a GOAL-NNN id, got ${JSON.stringify(goalId)}`);
    }
    const acs = list().filter((g) => String(g.goal) === goalId);
    if (acs.length === 0) return false; // a goal with no ACs is not achieved
    return acs.every((g) => g.status === "achieved");
  }

  return { toViewModel, get, listWithMalformed, list, activeGoals, listActiveCriteria, isGoalAchieved };
}
