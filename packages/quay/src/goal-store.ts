// quay Core: goal store — GOAL + AC records, the THIRD sibling kind
// (tasks/gap-spec-goal-store-third-sibling-kind, orchestration/SPEC-goal-store-2026-08-09.md,
//  revised by orchestration/SPEC-goal-mechanism-2026-09-06.md §2 — PHASE-NNN → GOAL-NNN).
//
// A goal record is a SEPARATE object kind from tasks (a Provider's own store), ADRs
// (adr-store.js), and documents (document-store.js): a stage goal / acceptance-criterion
// that ACHIEVES (or is superseded), not a decision (proposed→accepted) and not a method
// artifact (draft→active→retired). It reuses the SAME generic frontmatter/lock/filename-
// resolution mechanics as its two siblings via frontmatter-store-base.js — mechanics are
// shared, schemas are not (the base header's "shared MECHANICS, independent SCHEMAS"
// rule; this is the third application).
//
// The kind's four load-bearing fields (why it cannot collapse into any prior kind):
//   1. `criterion` — a RUNNABLE shell command (reuses the task acceptance-runner shape;
//      NOT document `contracts`, which are in-process grep/not-grep over the doc's own body).
//      Empty/missing criterion ⇒ the goal gate FAILS CLOSED (never a silent PASS).
//   2. `status` includes `achieved` — decisions don't achieve, ACs do.
//   3. `goal` — the ACTIVE SET is DERIVED from the goal's status, never hand-listed.
//   4. `origin` — the empirical basis for the AC; REQUIRED (empty origin writes nothing).
//
// Invariants (SPEC-goal-mechanism-2026-09-06.md §4 — I1 superseded by I1′):
//   I1′ — at most `cap` `status: active` GOALs at a time (default 3, configurable via
//         .quay/config.yml `goals:`). Goal switch stays a SINGLE ATOMIC write, fail-closed:
//         activating a goal that would exceed cap is REJECTED unless the same call disposes
//         an active goal (`disposeOld` → achieved, or `supersedes: [oldId]` → superseded).
//         The rejection message ENUMERATES the current active set (hard rule 3: enumerate,
//         don't boolean — "which goals hold the slots" is the actionable info).
//   I2 — a GOAL is achieved ⟺ ALL its ACs are achieved. DERIVED at read time
//        (`isGoalAchieved`), never stored.
//   I3 — staleness is THREE-STATE (fresh / stale / notEvaluated), never a fresh/stale binary
//        (a binary would judge a never-evaluated goal as healthy — hard rule 3b). The clock is
//        `lastProgressAt` = its ACs' `evidence.at` max, DERIVED never stored — NEVER the goal's
//        own `updatedAt` (hard rule 4b: a quantity the measured object produces is not a
//        measurement). Zero ACs (or no evidence.at) ⇒ notEvaluated.
//   I4 — divergence: `status: active` while `isGoalAchieved()` is true ⇒ "achieved but nobody
//        closed it", reported by `check --staleness`.
//
// cap / stale are HUMAN-GIVEN initial policy values with NO cost-structure backing (hard rule 4:
// no numeric threshold before the cost is measured). Re-estimate from .quay/goal-round.jsonl's
// real distribution after the goal-driver runs 30 calendar days (SPEC §4.2).
//
// Naming: `GOAL-NNN` / `AC-NNN` — pure sequence ids, meaning lives in `title` (the SPEC's
// four-name decision: id never moves even when goal prose drifts). GOAL records have NO
// `criterion` field (their criterion is the conjunction of their ACs).
//
// Goal view-model: { id, title, status, kind, goal, criterion, expect, origin, evidence,
// supersedes, supersededBy, body, updatedAt }

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import YAML from "yaml";
import {
  parseFrontmatter,
  serializeFrontmatter,
  fileNameForId,
  withFileLock,
  slugify,
} from "./frontmatter-store-base.ts";

export const VALID_GOAL_STATUSES = ["draft", "active", "achieved", "superseded", "retired"];

const GOAL_ID_RE = /^GOAL-\d{3,}$/;
const AC_ID_RE = /^AC-\d{3,}$/;

// Frontmatter keys the view-model owns explicitly; everything else in the frontmatter
// (any future field) is preserved verbatim — the same discipline as adr-store/document-store.
const OWNED_KEYS = new Set([
  "id", "title", "status", "kind", "goal", "criterion", "expect", "origin", "activatedAt",
  "labels", "evidence", "supersedes", "superseded-by",
]);

// ── cap / stale policy values ────────────────────────────────────────────────────────────────
// Both are HUMAN-GIVEN initial strategy values with NO cost-structure backing (hard rule 4:
// no numeric threshold before the cost is measured). Configurable via `.quay/config.yml`'s
// `goals:` section (read by the CLI at invocation, passed into createGoalStore). Re-estimate
// from `.quay/goal-round.jsonl`'s real distribution after the goal-driver runs 30 calendar
// days (SPEC-goal-mechanism-2026-09-06.md §4.2) — any "too tight/loose" claim before then is dataless.
const DEFAULT_GOAL_CAP = 3;
const DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Parse a `stale` duration into milliseconds. Accepted forms: "7d" / "12h" / "90m" (suffixed)
// or a bare number = days. Returns null when unparseable (caller falls back to the default).
function parseStaleMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value * 86400_000;
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*(d|h|m)$/i);
    if (m) {
      const n = Number(m[1]);
      const unit = m[2].toLowerCase();
      const mult = unit === "d" ? 86400_000 : unit === "h" ? 3600_000 : 60_000;
      return n * mult;
    }
  }
  return null;
}

// Read `.quay/config.yml`'s `goals:` section from the workspace root. cap/stale are OPTIONAL
// overrides of the defaults above; an absent/unparseable config or `goals:` section yields the
// defaults (never a crash — the store must work in a bare checkout with no config.yml).
export function readGoalConfig(workspaceRoot: string): { cap: number; staleMs: number } {
  let cap = DEFAULT_GOAL_CAP;
  let staleMs = DEFAULT_STALE_MS;
  const cfgPath = path.join(workspaceRoot, ".quay", "config.yml");
  if (fs.existsSync(cfgPath)) {
    try {
      const parsed = YAML.parse(fs.readFileSync(cfgPath, "utf8"));
      const goals = parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).goals
        : undefined;
      if (goals && typeof goals === "object") {
        const g = goals as Record<string, unknown>;
        if (typeof g.cap === "number" && Number.isFinite(g.cap) && g.cap >= 1) cap = g.cap;
        const sd = parseStaleMs(g.stale);
        if (sd !== null) staleMs = sd;
      }
    } catch { /* unparseable config.yml → defaults (never crash the store) */ }
  }
  return { cap, staleMs };
}

interface GoalFrontmatter {
  [key: string]: unknown;
  id?: string;
  title?: string;
  status?: string;
  kind?: string;
  goal?: string;
  criterion?: string;
  expect?: string;
  origin?: string;
  activatedAt?: string;
  labels?: string[];
  evidence?: { at?: string; verdict?: string; reading?: string };
  supersedes?: string[];
  "superseded-by"?: string[];
}

interface GoalFilter {
  status?: string;
  kind?: string;
  goal?: string;
}

interface GoalViewModel {
  id: unknown;
  title: unknown;
  status: unknown;
  kind: unknown;
  goal: unknown;
  criterion: unknown;
  expect: unknown;
  origin: unknown;
  evidence: unknown;
  supersedes: unknown[];
  supersededBy: unknown[];
  body: string;
  updatedAt?: number;
}

export interface DisposeOld {
  /** the old active goal's id */
  id: string;
  /** what happens to it: "achieved" or "superseded" */
  to: "achieved" | "superseded";
}

export function isGoalId(id: string): boolean {
  return typeof id === "string" && GOAL_ID_RE.test(id);
}

export function isCriterionId(id: string): boolean {
  return typeof id === "string" && AC_ID_RE.test(id);
}

/**
 * COMMIT-AFTER-WRITE (gap-meta-commitgoalfile): commit a goal file to git immediately after
 * writeFileSync. The goal store is the SOURCE of goal writes — the CLI `write`/`gate` (evidence
 * back-write), meta-driver's two write paths, all funnel through `write()`/`flipGoal()` — so the
 * commit lives HERE, not in each caller (meta-driver's `commitGoalFile` covered only its two paths,
 * leaving a direct `goal-store write` untracked ⇒ `git merge --ff-only develop` failed on untracked
 * `goals/*.md` and develop→doc sync stalled). pathspec-limited to the single file (`--` the rel),
 * ⛔ never a bare `git commit` — the index is SHARED across layers, a bare commit would sweep
 * whatever another layer staged. Repo-less roots (unit-test temp dirs, bare checkouts) are a no-op
 * (return false, not a throw) — the same shape as task-ops.ts commitTaskFile. Returns true when the
 * commit landed; false when the goal dir is not in a git work tree / git errors (observable, not
 * silent).
 */
function commitGoalFileAfterWrite(goalDir: string, fileName: string, id: string): boolean {
  const root = path.dirname(goalDir);
  let inside = "false";
  try {
    inside = execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
  } catch {
    return false;
  }
  if (inside !== "true") return false;
  const rel = `goals/${fileName}`;
  try {
    execFileSync("git", ["-C", root, "add", "--", rel]);
    execFileSync("git", ["-C", root, "commit", "--no-verify", "-m", `goals: ${id} 写盘即提交（goal-store）`, "--", rel]);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} goalDir absolute path to the goal directory (e.g. `<workspaceRoot>/goals`)
 * @param {{cap?: number, staleMs?: number}} opts I1′/I3 policy values; default cap=3, stale=7d
 *   (readGoalConfig supplies the .quay/config.yml values at the CLI entry; library callers that
 *   only list/get omit opts and get the defaults).
 */
export function createGoalStore(goalDir: string, opts: { cap?: number; staleMs?: number } = {}) {
  fs.mkdirSync(goalDir, { recursive: true });
  const cap = opts.cap ?? DEFAULT_GOAL_CAP;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;

  function assertSafeId(id: string) {
    if (typeof id !== "string" || !(GOAL_ID_RE.test(id) || AC_ID_RE.test(id))) {
      throw new Error(
        `invalid goal id ${JSON.stringify(id)}: must match GOAL-NNN or AC-NNN (>=3 digits)`
      );
    }
    return id;
  }

  function assertSafeStatus(status: string | undefined) {
    if (status !== undefined && !VALID_GOAL_STATUSES.includes(status)) {
      throw new Error(
        `invalid goal status "${status}" — must be one of ${VALID_GOAL_STATUSES.join(", ")}`
      );
    }
  }

  function toViewModel(frontmatter: GoalFrontmatter, body: string, updatedAt?: number): GoalViewModel {
    const vm: GoalViewModel = {
      id: frontmatter.id,
      title: frontmatter.title,
      status: frontmatter.status,
      kind: frontmatter.kind,
      goal: frontmatter.goal,
      criterion: frontmatter.criterion,
      expect: frontmatter.expect,
      origin: frontmatter.origin,
      evidence: frontmatter.evidence,
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
    return toViewModel(frontmatter as GoalFrontmatter, body, updatedAt);
  }

  function list(filter: GoalFilter = {}): GoalViewModel[] {
    return fs
      .readdirSync(goalDir)
      .filter((f) => f.endsWith(".md") && (f.startsWith("GOAL-") || f.startsWith("AC-")))
      .map((f) => {
        const { frontmatter, body } = parseFrontmatter(fs.readFileSync(path.join(goalDir, f), "utf8"));
        return toViewModel(frontmatter as GoalFrontmatter, body, fs.statSync(path.join(goalDir, f)).mtimeMs);
      })
      .filter((g) => (filter.status ? g.status === filter.status : true))
      .filter((g) => (filter.kind ? g.kind === filter.kind : true))
      .filter((g) => (filter.goal ? g.goal === filter.goal : true))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
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

  // I1′ checker — the invariant is "active count ≤ cap", NOT "exactly one". Splitting
  // withinCap (invariant holds) from hasDirection (≥1 active) keeps "over cap" and "none
  // active" from collapsing into one boolean (hard rule 3b: distinct states, distinct values).
  function checkWithinCap(): {
    withinCap: boolean;
    hasDirection: boolean;
    activeCount: number;
    cap: number;
    active: string[];
  } {
    const ap = activeGoals();
    const activeCount = ap.length;
    return {
      withinCap: activeCount <= cap,
      hasDirection: activeCount >= 1,
      activeCount,
      cap,
      active: ap.map((p) => String(p.id)),
    };
  }

  // I3 + I4 checker (check --staleness). THREE named buckets, structurally always present
  // (possibly empty arrays) — never a binary fresh/stale that would judge an unevaluated goal
  // as healthy (hard rule 3b). `lastProgressAt` is DERIVED from the ACs' `evidence.at` max —
  // never the goal's own `updatedAt` (hard rule 4b). `divergent` is the I4 signal: status
  // active while `isGoalAchieved()` is true ("achieved but nobody closed it").
  function checkStaleness(nowMs: number = Date.now()): {
    fresh: string[];
    stale: string[];
    notEvaluated: string[];
    divergent: string[];
    cap: number;
    staleMs: number;
  } {
    const all = list();
    const fresh: string[] = [];
    const stale: string[] = [];
    const notEvaluated: string[] = [];
    const divergent: string[] = [];
    for (const g of activeGoals()) {
      const gid = String(g.id);
      if (isGoalAchieved(gid)) divergent.push(gid); // I4 — active yet all ACs achieved
      let lastProgressAt: number | undefined;
      for (const ac of all.filter((r) => String(r.goal) === gid)) {
        const ev = ac.evidence as { at?: unknown } | undefined;
        if (ev && typeof ev.at === "string") {
          const t = Date.parse(ev.at);
          if (!Number.isNaN(t) && (lastProgressAt === undefined || t > lastProgressAt)) {
            lastProgressAt = t;
          }
        }
      }
      if (lastProgressAt === undefined) {
        notEvaluated.push(gid); // no ACs, or no evidence.at anywhere → never evaluated
      } else if (nowMs - lastProgressAt > staleMs) {
        stale.push(gid);
      } else {
        fresh.push(gid);
      }
    }
    return { fresh, stale, notEvaluated, divergent, cap, staleMs };
  }

  /** Direct read-modify-write of the old goal's file (inside the NEW goal's write lock). */
  function flipGoal(oldId: string, patch: { status: string; supersededBy?: string[] }) {
    const file = fileNameForId(goalDir, oldId);
    if (!file) return;
    const p = path.join(goalDir, file);
    const { frontmatter, body } = parseFrontmatter(fs.readFileSync(p, "utf8"));
    const fm = frontmatter as GoalFrontmatter;
    fm.status = patch.status;
    if (patch.supersededBy !== undefined) fm["superseded-by"] = patch.supersededBy;
    fs.writeFileSync(p, serializeFrontmatter(fm, body), "utf8");
    commitGoalFileAfterWrite(goalDir, file, oldId);
  }

  function write(id: string, {
    title, status, goal, criterion, expect, origin, evidence,
    supersedes, supersededBy, body, disposeOld,
  }: {
    title?: string;
    status?: string;
    goal?: string;
    criterion?: string;
    expect?: string;
    origin?: string;
    evidence?: { at?: string; verdict?: string; reading?: string };
    supersedes?: string[];
    supersededBy?: string[];
    body?: string;
    disposeOld?: DisposeOld;
  }): GoalViewModel {
    assertSafeId(id);
    assertSafeStatus(status);
    const isGoalRecord = isGoalId(id);
    // SPEC §2b: GOAL records carry NO criterion field — their criterion is the conjunction
    // of their ACs. Refusing beats silently dropping the field.
    if (isGoalRecord && criterion !== undefined) {
      throw new Error(
        `${id} is a GOAL record and cannot carry a \`criterion\` field — a goal is judged by the conjunction of its ACs`
      );
    }
    return withFileLock(goalDir, id, () => {
      const existingFile = fileNameForId(goalDir, id);
      let frontmatter: GoalFrontmatter = {};
      let existingBody = "";
      if (existingFile) {
        const parsed = parseFrontmatter(fs.readFileSync(path.join(goalDir, existingFile), "utf8"));
        frontmatter = { ...(parsed.frontmatter as GoalFrontmatter) };
        existingBody = parsed.body;
      }
      // Apply owned fields (preserving any unknown frontmatter keys verbatim).
      frontmatter.id = id;
      if (title !== undefined) frontmatter.title = title;
      frontmatter.status = status ?? frontmatter.status ?? "draft";
      // `kind` is derived from the id prefix — never caller-supplied.
      frontmatter.kind = isGoalRecord ? "goal" : "criterion";
      if (goal !== undefined) frontmatter.goal = goal;
      if (criterion !== undefined) frontmatter.criterion = criterion;
      if (expect !== undefined) frontmatter.expect = expect;
      if (origin !== undefined) frontmatter.origin = origin;
      if (evidence !== undefined) frontmatter.evidence = evidence;
      if (supersedes !== undefined) frontmatter.supersedes = supersedes;
      if (supersededBy !== undefined) frontmatter["superseded-by"] = supersededBy;

      // A criterion record MUST point at a goal (its activeness derives from that goal).
      if (!isGoalRecord && (typeof frontmatter.goal !== "string" || frontmatter.goal.trim() === "")) {
        throw new Error(`AC record ${id} must declare a \`goal: GOAL-NNN\` — activeness derives from the goal`);
      }

      // AC6 / SPEC §2.4 — `origin` REQUIRED: an AC without a basis is cargo cult. Empty
      // (or missing) origin writes nothing, on create AND on any update that would blank it.
      if (typeof frontmatter.origin !== "string" || frontmatter.origin.trim() === "") {
        throw new Error(
          `origin is required for ${id} — an AC/goal without an empirical basis is cargo cult; empty origin writes nothing`
        );
      }

      // I1′ — hard cap, write-time fail-closed (SPEC-goal-mechanism-2026-09-06.md §4.1).
      // Activating `id` must not push the active-GOAL count past `cap`. A call may free a slot
      // first by disposing an active goal in the SAME atomic write (`disposeOld` → achieved, or
      // `supersedes: [oldId]` → superseded). The rejection message ENUMERATES the active set
      // (hard rule 3: enumerate, don't boolean) — "which goals hold the slots" is the actionable info.
      if (isGoalRecord && frontmatter.status === "active") {
        // Apply any explicit dispositions first (inside the new goal's write lock).
        if (disposeOld) {
          flipGoal(String(disposeOld.id), {
            status: disposeOld.to === "achieved" ? "achieved" : "superseded",
            supersededBy: disposeOld.to === "achieved" ? undefined : [id],
          });
        }
        if (Array.isArray(supersedes)) {
          for (const oldId of supersedes) flipGoal(String(oldId), { status: "superseded", supersededBy: [id] });
        }
        const remainingActive = activeGoals().filter((p) => String(p.id) !== id);
        if (remainingActive.length >= cap) {
          throw new Error(
            `cannot activate ${id}: active GOAL count would exceed cap ${cap} — currently active: ${remainingActive
              .map((p) => String(p.id))
              .join(", ")} (dispose one via disposeOld {id, to} or supersedes:[id])`
          );
        }
      }

      const ordered: GoalFrontmatter = {};
      for (const k of [
        "id", "title", "status", "kind", "goal", "criterion", "expect", "origin", "activatedAt",
        "labels", "evidence", "supersedes", "superseded-by",
      ]) {
        if (frontmatter[k] !== undefined) ordered[k] = frontmatter[k];
      }
      for (const k of Object.keys(frontmatter)) {
        if (!OWNED_KEYS.has(k)) ordered[k] = frontmatter[k];
      }
      const finalBody = body !== undefined ? body : existingBody;
      const fileName = existingFile ?? `${id}-${slugify(title, "goal")}.md`;
      fs.writeFileSync(path.join(goalDir, fileName), serializeFrontmatter(ordered, finalBody), "utf8");
      commitGoalFileAfterWrite(goalDir, fileName, id);
      return get(id) as GoalViewModel;
    });
  }

  return { list, get, write, activeGoals, listActiveCriteria, isGoalAchieved, checkWithinCap, checkStaleness };
}

// ── Direct-invocation entry (Contract invoke: `node packages/quay/src/goal-store.ts`) ──────────────
// Subcommands (workspace root auto-derived from the script location, or --root <dir>):
//   list                      — list all goal records (GOAL + AC) as JSON
//   get <id>                  — one record as JSON
//   write <id> --title ... --status ... --goal ... --criterion ... --origin ... [--expect ...]
//   gate <id> [--root <dir>]  — run the record's `criterion` via the acceptance runner and append
//                               one GateEvent (verdict+timestamp) to <root>/.quay/gate-events.jsonl;
//                               empty criterion fails CLOSED (red) and still records the event.
//   check                     — I1′ checker: withinCap + hasDirection (exit 1 when over cap)
//   check --staleness         — I3 three-bucket staleness (fresh/stale/notEvaluated) + I4
//                               divergence (exit 1 when a divergent goal exists)
import { fileURLToPath } from "node:url";

async function main(argv: string[]) {
  const args = argv.slice(2);
  const rootFlagIdx = args.indexOf("--root");
  let root: string | null = null;
  if (rootFlagIdx >= 0) {
    root = args[rootFlagIdx + 1] ?? null;
    args.splice(rootFlagIdx, 2);
  }
  // Find the workspace root: walk up from this module until a .git is found; fall back to cwd.
  if (!root) {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i++) {
      if (fs.existsSync(path.join(dir, ".git"))) { root = dir; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  root = root ?? process.cwd();
  const goalDir = path.join(root, "goals");
  const logPath = path.join(root, ".quay", "gate-events.jsonl");
  const goalCfg = readGoalConfig(root);
  const store = createGoalStore(goalDir, { cap: goalCfg.cap, staleMs: goalCfg.staleMs });

  const [sub, ...rest] = args;
  switch (sub) {
    case "list": {
      const filter: GoalFilter = {};
      const fi = rest.indexOf("--status");
      if (fi >= 0) filter.status = rest[fi + 1];
      process.stdout.write(JSON.stringify(store.list(filter), null, 2) + "\n");
      return 0;
    }
    case "get": {
      if (rest.length === 0) { console.error("goal-store: get requires <id>"); return 2; }
      const rec = store.get(rest[0]);
      if (!rec) { console.error(`goal-store: no such goal: ${rest[0]}`); return 1; }
      process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
      return 0;
    }
    case "write": {
      const id = rest[0];
      if (!id) { console.error("goal-store: write requires <id>"); return 2; }
      const opts: Record<string, unknown> = {};
      for (let i = 1; i < rest.length; i++) {
        const k = rest[i];
        const v = rest[i + 1];
        if (!k.startsWith("--")) continue;
        const key = k.slice(2);
        if (key === "title" || key === "status" || key === "goal" || key === "criterion" ||
            key === "expect" || key === "origin" || key === "superseded-by" ||
            key === "dispose-old" || key === "dispose-to") {
          opts[key] = v;
          i++;
        } else {
          console.error(`goal-store: unknown write flag: ${k}`); return 2;
        }
      }
      if (typeof opts.origin !== "string") {
        console.error("goal-store: write requires --origin <text> (AC6: empty origin writes nothing)");
        return 2;
      }
      let disposeOld: DisposeOld | undefined;
      if (opts["dispose-old"] !== undefined) {
        const to = opts["dispose-to"] === "achieved" ? "achieved" as const
          : opts["dispose-to"] === "superseded" ? "superseded" as const : null;
        if (!to) {
          console.error("goal-store: --dispose-old requires --dispose-to achieved|superseded");
          return 2;
        }
        disposeOld = { id: String(opts["dispose-old"]), to };
      }
      const rec = store.write(id, {
        title: opts.title as string | undefined,
        status: opts.status as string | undefined,
        goal: opts.goal as string | undefined,
        criterion: opts.criterion as string | undefined,
        expect: opts.expect as string | undefined,
        origin: opts.origin as string,
        supersededBy: Array.isArray(opts["superseded-by"])
          ? opts["superseded-by"] as string[]
          : (typeof opts["superseded-by"] === "string" ? [opts["superseded-by"] as string] : undefined),
        disposeOld,
      });
      process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
      return 0;
    }
    case "gate": {
      const id = rest[0];
      if (!id) { console.error("goal-store: gate requires <id>"); return 2; }
      // Criterion execution REUSES the task acceptance-runner shape (SPEC §3) and the gate
      // ledger REUSES the existing GateEvent format (.quay/gate-events.jsonl).
      const { runAcceptance } = await import("./gate/acceptance-runner.ts");
      const { appendGateEvent } = await import("./gate/gate-event-store.ts");
      const rec = store.get(id);
      if (!rec) { console.error(`goal-store: no such goal: ${id}`); return 2; }
      const criterion = rec.criterion;
      let verdict: string;
      let reason: string;
      if (typeof criterion !== "string" || criterion.trim() === "") {
        // AC2 — empty criterion FAILS CLOSED (red), never a silent PASS.
        verdict = "fail";
        reason = `${id} has no criterion defined (fail-closed — an unenforceable AC must never silently pass)`;
      } else {
        const result = runAcceptance({ command: criterion, cwd: root, timeoutMs: 60000 });
        verdict = result.ok ? "pass" : "fail";
        reason = result.reason;
      }
      const event = {
        id: randomUUID(),
        item_id: id,
        pipeline_id: id,
        gate: "goal",
        actor: "goal-cli",
        verdict,
        timestamp: new Date().toISOString(),
        payload: { reason },
      };
      appendGateEvent(logPath, event);
      // Best-effort evidence update so the record itself carries the last verdict + time.
      try {
        store.write(id, { evidence: { at: event.timestamp, verdict, reading: reason.slice(0, 200) } });
      } catch { /* evidence write is best-effort — the ledger is authoritative */ }
      const out = { id, verdict, reason, timestamp: event.timestamp, event };
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      return verdict === "pass" ? 0 : 1;
    }
    case "check": {
      if (rest.includes("--staleness")) {
        const r = store.checkStaleness();
        process.stdout.write(JSON.stringify(r, null, 2) + "\n");
        return r.divergent.length === 0 ? 0 : 1;
      }
      const r = store.checkWithinCap();
      process.stdout.write(JSON.stringify(r, null, 2) + "\n");
      return r.withinCap ? 0 : 1;
    }
    default: {
      console.error(
        `goal-store: unknown subcommand ${JSON.stringify(sub)} — expected list|get|write|gate|check`
      );
      return 2;
    }
  }
}

// Direct-invocation guard: this module is BOTH a library (imported by serve-handlers / the gate
// registry — which BUNDLE it into dist/quay.js) and the Contract's CLI entry (`node
// packages/quay/src/goal-store.ts`). The guard must survive the bundle: full-path equality with
// import.meta.url fails there (in a bundle every module shares the bundle's URL, so a bundled
// library module would self-identify as main and run its CLI on every `quay` invocation). The
// `.endsWith("goal-store.ts")` form matches the source path when invoked directly and is false for
// the bundle — the same pattern every plugin/scripts dual library+CLI module uses.
const isMain =
  process.argv[1] != null && process.argv[1].endsWith("goal-store.ts");
if (isMain) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
