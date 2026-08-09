// quay Core: goal store — PHASE + AC records, the THIRD sibling kind
// (tasks/gap-spec-goal-store-third-sibling-kind, orchestration/SPEC-goal-store-2026-08-09.md).
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
//   3. `phase` — the ACTIVE SET is DERIVED from the phase's status, never hand-listed.
//   4. `origin` — the empirical basis for the AC; REQUIRED (empty origin writes nothing).
//
// Two invariants (human-agreed, SPEC §2b):
//   I1 — at most ONE `status: active` PHASE at a time. Phase switch is a SINGLE ATOMIC
//        write, fail-closed: activating a new phase while another is active is REJECTED
//        unless the same call supplies the old phase's disposition (`disposeOld` → achieved,
//        or `supersedes: [oldId]` → superseded).
//   I2 — a PHASE is achieved ⟺ ALL its ACs are achieved. DERIVED at read time
//        (`isPhaseAchieved`), never stored.
//
// Naming: `PHASE-NNN` / `AC-NNN` — pure sequence ids, meaning lives in `title` (the SPEC's
// four-name decision: id never moves even when goal prose drifts). PHASE records have NO
// `criterion` field (their criterion is the conjunction of their ACs).
//
// Goal view-model: { id, title, status, kind, phase, criterion, expect, origin, evidence,
// supersedes, supersededBy, body, updatedAt }

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  parseFrontmatter,
  serializeFrontmatter,
  fileNameForId,
  withFileLock,
  slugify,
} from "./frontmatter-store-base.ts";

export const VALID_GOAL_STATUSES = ["active", "achieved", "superseded", "retired"];

const PHASE_ID_RE = /^PHASE-\d{3,}$/;
const AC_ID_RE = /^AC-\d{3,}$/;

// Frontmatter keys the view-model owns explicitly; everything else in the frontmatter
// (any future field) is preserved verbatim — the same discipline as adr-store/document-store.
const OWNED_KEYS = new Set([
  "id", "title", "status", "kind", "phase", "criterion", "expect", "origin", "evidence",
  "supersedes", "superseded-by",
]);

interface GoalFrontmatter {
  [key: string]: unknown;
  id?: string;
  title?: string;
  status?: string;
  kind?: string;
  phase?: string;
  criterion?: string;
  expect?: string;
  origin?: string;
  evidence?: { at?: string; verdict?: string; reading?: string };
  supersedes?: string[];
  "superseded-by"?: string[];
}

interface GoalFilter {
  status?: string;
  kind?: string;
  phase?: string;
}

interface GoalViewModel {
  id: unknown;
  title: unknown;
  status: unknown;
  kind: unknown;
  phase: unknown;
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
  /** the old active phase's id */
  id: string;
  /** what happens to it: "achieved" or "superseded" */
  to: "achieved" | "superseded";
}

export function isPhaseId(id: string): boolean {
  return typeof id === "string" && PHASE_ID_RE.test(id);
}

export function isCriterionId(id: string): boolean {
  return typeof id === "string" && AC_ID_RE.test(id);
}

/**
 * @param {string} goalDir absolute path to the goal directory (e.g. `<workspaceRoot>/goals`)
 */
export function createGoalStore(goalDir: string) {
  fs.mkdirSync(goalDir, { recursive: true });

  function assertSafeId(id: string) {
    if (typeof id !== "string" || !(PHASE_ID_RE.test(id) || AC_ID_RE.test(id))) {
      throw new Error(
        `invalid goal id ${JSON.stringify(id)}: must match PHASE-NNN or AC-NNN (>=3 digits)`
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
      phase: frontmatter.phase,
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
      .filter((f) => f.endsWith(".md") && (f.startsWith("PHASE-") || f.startsWith("AC-")))
      .map((f) => {
        const { frontmatter, body } = parseFrontmatter(fs.readFileSync(path.join(goalDir, f), "utf8"));
        return toViewModel(frontmatter as GoalFrontmatter, body, fs.statSync(path.join(goalDir, f)).mtimeMs);
      })
      .filter((g) => (filter.status ? g.status === filter.status : true))
      .filter((g) => (filter.kind ? g.kind === filter.kind : true))
      .filter((g) => (filter.phase ? g.phase === filter.phase : true))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  // I1: the (at most one) currently-active PHASE. Derived from stored status, never hand-listed.
  function activePhases(): GoalViewModel[] {
    return list().filter((g) => isPhaseId(String(g.id)) && g.status === "active");
  }

  // AC4: the ACTIVE SET is DERIVED from phase status, never a hand-maintained checklist.
  // A criterion record is "active" ⟺ its phase's stored status is `active`.
  function listActive(): GoalViewModel[] {
    const activePhaseIds = new Set(activePhases().map((p) => String(p.id)));
    return list().filter((g) => !isPhaseId(String(g.id)) && activePhaseIds.has(String(g.phase)));
  }

  // I2: a PHASE is achieved ⟺ ALL its ACs are achieved. Evaluated at read time, never stored.
  function isPhaseAchieved(phaseId: string): boolean {
    assertSafeId(phaseId);
    if (!isPhaseId(phaseId)) {
      throw new Error(`isPhaseAchieved requires a PHASE-NNN id, got ${JSON.stringify(phaseId)}`);
    }
    const acs = list().filter((g) => String(g.phase) === phaseId);
    if (acs.length === 0) return false; // a phase with no ACs is not achieved
    return acs.every((g) => g.status === "achieved");
  }

  // I1 checker (SPEC §2b.5-c): "exactly one active phase". ok=true only when count === 1.
  function checkExactlyOneActivePhase(): { ok: boolean; count: number; active: string[] } {
    const ap = activePhases();
    return { ok: ap.length === 1, count: ap.length, active: ap.map((p) => String(p.id)) };
  }

  /** Direct read-modify-write of the old phase's file (inside the NEW phase's write lock). */
  function flipPhase(oldId: string, patch: { status: string; supersededBy?: string[] }) {
    const file = fileNameForId(goalDir, oldId);
    if (!file) return;
    const p = path.join(goalDir, file);
    const { frontmatter, body } = parseFrontmatter(fs.readFileSync(p, "utf8"));
    const fm = frontmatter as GoalFrontmatter;
    fm.status = patch.status;
    if (patch.supersededBy !== undefined) fm["superseded-by"] = patch.supersededBy;
    fs.writeFileSync(p, serializeFrontmatter(fm, body), "utf8");
  }

  function write(id: string, {
    title, status, phase, criterion, expect, origin, evidence,
    supersedes, supersededBy, body, disposeOld,
  }: {
    title?: string;
    status?: string;
    phase?: string;
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
    const isPhaseRecord = isPhaseId(id);
    // SPEC §2b: PHASE records carry NO criterion field — their criterion is the conjunction
    // of their ACs. Refusing beats silently dropping the field.
    if (isPhaseRecord && criterion !== undefined) {
      throw new Error(
        `${id} is a PHASE record and cannot carry a \`criterion\` field — a phase is judged by the conjunction of its ACs`
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
      frontmatter.status = status ?? frontmatter.status ?? "active";
      // `kind` is derived from the id prefix — never caller-supplied.
      frontmatter.kind = isPhaseRecord ? "phase" : "criterion";
      if (phase !== undefined) frontmatter.phase = phase;
      if (criterion !== undefined) frontmatter.criterion = criterion;
      if (expect !== undefined) frontmatter.expect = expect;
      if (origin !== undefined) frontmatter.origin = origin;
      if (evidence !== undefined) frontmatter.evidence = evidence;
      if (supersedes !== undefined) frontmatter.supersedes = supersedes;
      if (supersededBy !== undefined) frontmatter["superseded-by"] = supersededBy;

      // A criterion record MUST point at a phase (its activeness derives from that phase).
      if (!isPhaseRecord && (typeof frontmatter.phase !== "string" || frontmatter.phase.trim() === "")) {
        throw new Error(`AC record ${id} must declare a \`phase: PHASE-NNN\` — activeness derives from the phase`);
      }

      // AC6 / SPEC §2.4 — `origin` REQUIRED: an AC without a basis is cargo cult. Empty
      // (or missing) origin writes nothing, on create AND on any update that would blank it.
      if (typeof frontmatter.origin !== "string" || frontmatter.origin.trim() === "") {
        throw new Error(
          `origin is required for ${id} — an AC/goal without an empirical basis is cargo cult; empty origin writes nothing`
        );
      }

      // I1 — SINGLE ATOMIC phase switch, fail-closed (SPEC §2b.5-a).
      if (isPhaseRecord && frontmatter.status === "active") {
        const existingActive = activePhases().filter((p) => String(p.id) !== id);
        if (existingActive.length > 0) {
          const oldId = String(existingActive[0].id);
          let disposed = false;
          if (disposeOld && String(disposeOld.id) === oldId) {
            flipPhase(oldId, {
              status: disposeOld.to === "achieved" ? "achieved" : "superseded",
              supersededBy: disposeOld.to === "achieved" ? undefined : [id],
            });
            disposed = true;
          } else if (Array.isArray(supersedes) && supersedes.includes(oldId)) {
            flipPhase(oldId, { status: "superseded", supersededBy: [id] });
            disposed = true;
          }
          if (!disposed) {
            throw new Error(
              `cannot activate ${id}: ${oldId} is already active — a phase switch must dispose of the old phase in the SAME call (disposeOld {id, to} or supersedes:[${oldId}])`
            );
          }
        }
      }

      const ordered: GoalFrontmatter = {};
      for (const k of [
        "id", "title", "status", "kind", "phase", "criterion", "expect", "origin", "evidence",
        "supersedes", "superseded-by",
      ]) {
        if (frontmatter[k] !== undefined) ordered[k] = frontmatter[k];
      }
      for (const k of Object.keys(frontmatter)) {
        if (!OWNED_KEYS.has(k)) ordered[k] = frontmatter[k];
      }
      const finalBody = body !== undefined ? body : existingBody;
      const fileName = existingFile ?? `${id}-${slugify(title, "goal")}.md`;
      fs.writeFileSync(path.join(goalDir, fileName), serializeFrontmatter(ordered, finalBody), "utf8");
      return get(id) as GoalViewModel;
    });
  }

  return { list, get, write, activePhases, listActive, isPhaseAchieved, checkExactlyOneActivePhase };
}

// ── Direct-invocation entry (Contract invoke: `node packages/quay/src/goal-store.ts`) ──────────────
// Subcommands (workspace root auto-derived from the script location, or --root <dir>):
//   list                      — list all goal records (PHASE + AC) as JSON
//   get <id>                  — one record as JSON
//   write <id> --title ... --status ... --phase ... --criterion ... --origin ... [--expect ...]
//   gate <id> [--root <dir>]  — run the record's `criterion` via the acceptance runner and append
//                               one GateEvent (verdict+timestamp) to <root>/.quay/gate-events.jsonl;
//                               empty criterion fails CLOSED (red) and still records the event.
//   check                     — I1 checker: exactly-one-active-phase (exit 1 when not)
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
  const store = createGoalStore(goalDir);

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
        if (key === "title" || key === "status" || key === "phase" || key === "criterion" ||
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
        phase: opts.phase as string | undefined,
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
      const r = store.checkExactlyOneActivePhase();
      process.stdout.write(JSON.stringify(r, null, 2) + "\n");
      return r.ok ? 0 : 1;
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
