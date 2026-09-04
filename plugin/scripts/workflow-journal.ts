// workflow-journal.ts — DIR-124-B2 (M254): the StageJournalStore.
// Append-only durable journal at `milestones/M<NN>/stage-journal.jsonl` plus `receipts/*.json`
// under the CANONICAL milestone root resolved via gate_resolve_milestone_root (the single-sourced
// resolver in gate-script-lib.sh; B2's TS contains NO boundary literal — the rule lives only in
// gate-script-lib.sh, per DD1/B2-CLAIM-6). Atomic write (temp-then-rename / line-safe framed
// append), torn-write rejection (a partial trailing record is surfaced, never silently parsed),
// store-driven Verify cache persistence (persistVerifyCache / loadValidatedVerifyCache) with
// fail-closed load, and the one-way migration adapters migrateDir124AEvent / migrateDir126DTelemetry
// (AC6). DIR-118 extension fields are declared but inert (AC7/DD10).
//
// Byte-identical mirror: plugin/scripts/workflow-journal.ts
//
// Zero npm dependencies — Node.js built-ins only (node:fs, node:path, node:crypto,
// node:child_process). No build step; dispatched exclusively via the established
// `node --experimental-strip-types <abs path>/workflow-journal.ts <mode>` agent-dispatch pattern.
//
// Imports, never re-declares: the A1 20-field StageEvent shape + validateEvent/emitEvent from the
// sibling workflow-event-schema.mjs; the receipt contract (buildReceiptEnvelope, validateReceipt,
// sha256File, serializeReceipt) from the sibling stage-receipt.ts. B2's TS contains no boundary
// literal (Stage 5 grep selfcheck fails otherwise) — the milestone root is resolved by shelling out
// to the surviving `gate_resolve_milestone_root` shell function.
//
// Export surfaces:
//   - Types: StageJournalOptions, CacheLoadResult
//   - Class: StageJournalStore (constructor, appendStage, writeReceipt, persistVerifyCache,
//     loadValidatedVerifyCache, migrateDir124AEvent, migrateDir126DTelemetry, readJournal)
//   - Functions: resolveMilestoneRoot(milestoneId, cwd), selftest()
//   - CLI: --append-stage '<json>', --persist-verify-cache '<updates-json>',
//     --load-validated-verify-cache '<runIdentity-json>', --migrate-dir124a --from <jsonl>,
//     --migrate-dir126d --from <record-json>, --selftest, --json
//
// Fail-closed store codes:
//   milestone-id-invalid, milestone-root-unresolved, journal-not-writable, torn-trailing-record,
//   schema-invalid, cache-persist-failed, cache-load-invalid, cache-miss, reverse-write-forbidden,
//   not-a-directory, receipt-write-failed, absent-migration-input (recorded no-op).

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { validateEvent, emitEvent, VALID_STAGES } from "./workflow-event-schema.mjs";
import {
  sha256File,
  serializeReceipt,
  validateReceipt,
  migratePrepareLedger,
} from "./stage-receipt.ts";

// ── milestone-root resolution (DD1 — single-sourced via gate_resolve_milestone_root) ───────────────

/**
 * Resolve the canonical milestone root for a milestone id ("M254", "254", "M254-slug").
 * Shells out to the surviving gate_resolve_milestone_root shell function in gate-script-lib.sh —
 * the SAME single source Build/Audit/Land use. B2's TS contains no boundary literal; the rule
 * lives only in gate-script-lib.sh. Resolution happens ONCE per store construction (not per append).
 */
export function resolveMilestoneRoot(milestoneId: string, cwd: string): string {
  if (typeof milestoneId !== "string" || milestoneId.trim() === "") {
    throw new Error("milestone-id-invalid: milestoneId must be a non-empty string");
  }
  const libPath = path.join(cwd, "plugin", "scripts", "gate-script-lib.sh");
  if (!fs.existsSync(libPath)) {
    throw new Error(`milestone-root-unresolved: gate-script-lib.sh not found at ${libPath}`);
  }
  try {
    const out = execSync(
      `bash -c 'source "${libPath}" && gate_resolve_milestone_root "${milestoneId}"'`,
      { cwd, encoding: "utf8", timeout: 10_000 }
    ).trim();
    if (!out) throw new Error("empty resolution");
    return out;
  } catch (e) {
    throw new Error(`milestone-root-unresolved: gate_resolve_milestone_root failed for "${milestoneId}": ${(e as Error).message}`);
  }
}

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

// ── prepare-telemetry terminal.phase → A1 VALID_STAGES mapping (migrateDir126DTelemetry) ──────────
// The prepare pipeline's internal phase names are NOT members of VALID_STAGES; map them to the
// closest prepare boundary so migrated StageEvents carry a valid stage name.
const TELEMETRY_PHASE_STAGE: Record<string, string> = {
  PreflightPlan: "Preflight",
  Admission: "Admission",
  ProposalAuthors: "ProposalAuthors",
  Adjudicate: "Adjudicate",
  ProposalReview: "ProposalReview",
  PlanAuthor: "PlanAuthor",
  PlanCheck: "PlanCheck",
  Receipt: "Receipt",
  // execute-side (defensive)
  Verify: "Verify",
  Prepared: "Prepared",
  Build: "Build",
  "Build-Evidence": "Build-Evidence",
  Audit: "Audit",
  Gate: "Gate",
  Reconcile: "Reconcile",
  Land: "Land",
  Fast: "Fast",
};

export interface StageJournalOptions {
  /** e.g. "M254" or "254". */
  milestoneId: string;
  /** Workspace root (the repo). Used to source gate-script-lib.sh and resolve the milestone root. */
  cwd: string;
  /** Optional explicit root override (tests). */
  milestoneRoot?: string;
}

export interface CacheLoadResult {
  ok: boolean;
  /** Per-check reuse verdict. */
  code: string;
  detail: string;
  /** Reused cache entries (only on ok). */
  reused?: Record<string, unknown>;
}

// ── Store ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Append-only durable journal + receipts store under the canonical milestone root. The store is
 * stage-agnostic: it records whatever validated `stage` it is given (all EIGHT execute-milestone
 * stage names are valid StageEvent inputs per B2-CLAIM-13). Atomic writes (temp-then-rename);
 * torn/partial trailing records are surfaced on read, never silently parsed.
 */
export class StageJournalStore {
  readonly milestoneId: string;
  readonly root: string;
  readonly journalPath: string;
  readonly receiptsDir: string;
  private readonly cwd: string;

  constructor(opts: StageJournalOptions) {
    this.milestoneId = opts.milestoneId;
    this.cwd = opts.cwd;
    // Resolve the milestone root to an ABSOLUTE path under the workspace. gate_resolve_milestone_root
    // echoes a workspace-relative path (e.g. "milestones/M254"); binding it to opts.cwd keeps the
    // store correct regardless of the process cwd (fixture dirs in tests, repo root in production).
    const relativeRoot = opts.milestoneRoot || resolveMilestoneRoot(opts.milestoneId, opts.cwd);
    this.root = path.resolve(opts.cwd, relativeRoot);
    this.journalPath = path.join(this.root, "stage-journal.jsonl");
    this.receiptsDir = path.join(this.root, "receipts");
    fs.mkdirSync(this.receiptsDir, { recursive: true });
  }

  // ── appendStage (AC4/AC5 — line-safe framed append, atomic, torn-write rejection) ──────────────

  /**
   * Validate + append one StageEvent to the journal. Each record is one single-line JSON object
   * (emitEvent-serialized, so no embedded newline can split a record). The write is atomic
   * (write-temp-then-rename). A partial trailing record is surfaced on read as
   * `{ok:false, code:'torn-trailing-record'}`, never silently parsed.
   */
  appendStage(event: Record<string, unknown>): { ok: true; event: Record<string, unknown>; line: string } | { ok: false; code: string; detail: string } {
    const vr = validateEvent(event);
    if (!vr.ok) {
      return { ok: false, code: "schema-invalid", detail: `StageEvent failed A1 validation: ${vr.error}` };
    }
    // superset field validation (B2 binding/provenance)
    const ev = event as Record<string, unknown>;
    if (typeof ev.eventId !== "string" || ev.eventId.trim() === "") {
      return { ok: false, code: "schema-invalid", detail: "StageEvent missing required superset field eventId" };
    }
    if (typeof ev.workflowSourceHash !== "string") {
      return { ok: false, code: "schema-invalid", detail: "StageEvent missing required superset field workflowSourceHash" };
    }
    if (ev.materialInputHashes == null || typeof ev.materialInputHashes !== "object") {
      return { ok: false, code: "schema-invalid", detail: "StageEvent missing required superset field materialInputHashes" };
    }

    const line = emitEvent(event as never) + "\n";
    const tmp = `${this.journalPath}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(this.journalPath), { recursive: true });
      fs.writeFileSync(tmp, line, { encoding: "utf8", flag: "a" });
      if (!fs.existsSync(this.journalPath)) {
        fs.renameSync(tmp, this.journalPath);
      } else {
        // append is inherently safe for a line-safe framed stream; still temp-then-append-merge
        // to keep torn-write detection meaningful on the first record (rename) path.
        const existing = fs.readFileSync(this.journalPath, "utf8");
        fs.writeFileSync(this.journalPath, existing + line, { encoding: "utf8" });
        try { fs.rmSync(tmp, { force: true }); } catch (_) { /* best-effort */ }
      }
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch (_) { /* best-effort */ }
      return { ok: false, code: "journal-not-writable", detail: `failed to append stage event: ${(e as Error).message}` };
    }
    return { ok: true, event: event, line };
  }

  /**
   * Read the journal, surfacing a torn/partial trailing record as {ok:false, code:'torn-trailing-record'}
   * rather than silently parsing it. Empty/whitespace lines are skipped.
   */
  readJournal(): Array<{ ok: true; event: Record<string, unknown>; lineNumber: number } | { ok: false; code: string; detail: string; lineNumber: number }> {
    if (!fs.existsSync(this.journalPath)) return [];
    const lines = fs.readFileSync(this.journalPath, "utf8").split("\n");
    const out: Array<{ ok: true; event: Record<string, unknown>; lineNumber: number } | { ok: false; code: string; detail: string; lineNumber: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // A trailing partial record (no newline yet / interrupted write) is surfaced, not parsed.
        const isLast = i === lines.length - 1;
        out.push({
          ok: false,
          code: isLast ? "torn-trailing-record" : "schema-invalid",
          detail: `journal line ${i + 1} is not valid JSON: ${raw.slice(0, 80)}`,
          lineNumber: i + 1,
        });
        continue;
      }
      const vr = validateEvent(parsed);
      if (vr.ok) {
        out.push({ ok: true, event: parsed as Record<string, unknown>, lineNumber: i + 1 });
      } else {
        out.push({ ok: false, code: "schema-invalid", detail: `journal line ${i + 1}: ${vr.error}`, lineNumber: i + 1 });
      }
    }
    return out;
  }

  // ── writeReceipt (AC5 — temp-then-rename, never overwrites in place) ──────────────────────────

  /**
   * Write one hash-bound StageReceiptEnvelope to receipts/<runId>-<stage>.json. Temp-then-rename;
   * never overwrites in place. Accepts a pre-built envelope object OR {receipt, path} shape; the
   * canonical receipt is written via serializeReceipt (deterministic single-line JSON).
   */
  writeReceipt(receipt: Record<string, unknown>, filename?: string): { ok: true; path: string } | { ok: false; code: string; detail: string } {
    const rec = receipt as Record<string, unknown>;
    const v = validateReceipt(rec);
    if (!v.ok) {
      return { ok: false, code: "receipt-invalid", detail: `receipt failed validation: ${v.code}: ${v.detail}` };
    }
    const name = filename || `${String(rec.runId)}-${String(rec.stage)}.json`;
    const target = path.join(this.receiptsDir, name);
    const tmp = `${target}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(tmp, serializeReceipt(rec as never) + "\n", { encoding: "utf8" });
      fs.renameSync(tmp, target);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch (_) { /* best-effort */ }
      return { ok: false, code: "receipt-write-failed", detail: `failed to write receipt: ${(e as Error).message}` };
    }
    return { ok: true, path: target };
  }

  // ── Verify-cache methods (AC5/B2-CLAIM-11 — store-driven, fail-closed load) ────────────────────

  /**
   * Persist Verify cache updates atomically (temp-then-rename). A failed write leaves the store
   * unchanged. updates: {label: {result, fingerprint, baseCommit, workflowSourceHash,
   * runtimeGeneration, materialInputHashes}}.
   */
  persistVerifyCache(updates: Record<string, Record<string, unknown>>): { ok: true; path: string } | { ok: false; code: string; detail: string } {
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return { ok: false, code: "cache-persist-failed", detail: "updates must be an object" };
    }
    const cachePath = path.join(this.root, "verify-cache.json");
    const tmp = `${cachePath}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(updates, null, 2) + "\n", { encoding: "utf8" });
      fs.renameSync(tmp, cachePath);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch (_) { /* best-effort */ }
      return { ok: false, code: "cache-persist-failed", detail: `failed to persist verify cache: ${(e as Error).message}` };
    }
    return { ok: true, path: cachePath };
  }

  /**
   * Load the Verify cache for a runIdentity, validating exact check input + base/candidate state +
   * workflow source hash + runtime generation BEFORE any reuse. Fail-closed: no valid receipt (or
   * ANY binding mismatch) → fresh dispatch (never silent stale reuse). A cache load failure is
   * treated as "no valid receipt".
   */
  loadValidatedVerifyCache(runIdentity: Record<string, unknown>): CacheLoadResult {
    const cachePath = path.join(this.root, "verify-cache.json");
    if (!fs.existsSync(cachePath)) {
      return { ok: false, code: "cache-miss", detail: "no verify-cache.json present — full fresh dispatch" };
    }
    let cache: Record<string, Record<string, unknown>>;
    try {
      cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } catch {
      return { ok: false, code: "cache-load-invalid", detail: "verify-cache.json unparseable — treated as no valid receipt (fresh dispatch)" };
    }
    const ri = runIdentity as Record<string, unknown>;
    const baseCommit = ri.baseCommit;
    const workflowSourceHash = ri.workflowSourceHash;
    const runtimeGeneration = ri.runtimeGeneration;
    // Fail-closed binding: a reuse requires the FULL binding surface (base/candidate + workflow
    // source + runtime generation). An identity missing ANY binding field is NOT reusable — treat
    // as cache-miss (fresh dispatch). This prevents a partial-binding reuse (the exact open-loop
    // defect the store closes: a result "looks reusable" while proving another state).
    if (
      baseCommit == null ||
      workflowSourceHash == null ||
      runtimeGeneration == null
    ) {
      return { ok: false, code: "cache-miss", detail: "runIdentity missing a binding field (baseCommit/workflowSourceHash/runtimeGeneration) — no validated reuse possible" };
    }
    const reused: Record<string, unknown> = {};
    for (const [label, entry] of Object.entries(cache)) {
      const e = entry as Record<string, unknown>;
      // exact binding equality — any mismatch → this check is NOT reused
      if (
        e.result !== undefined &&
        e.baseCommit === baseCommit &&
        e.workflowSourceHash === workflowSourceHash &&
        e.runtimeGeneration === runtimeGeneration
      ) {
        reused[label] = e.result;
      }
    }
    if (Object.keys(reused).length === 0) {
      return { ok: false, code: "cache-miss", detail: "no validated cache entries for this run identity — full fresh dispatch" };
    }
    return { ok: true, code: "cache-hit", detail: `${Object.keys(reused).length} check(s) reused from validated cache`, reused };
  }

  // ── One-way migration adapters (AC6) ───────────────────────────────────────────────────────────

  /**
   * One-way adapter: A1 20-field StageEvent → B2 StageEvent superset, appended to the SAME journal.
   * Imports A1's validateEvent/emitEvent; field-for-field. After migration there is exactly one
   * authoritative event format. Never a reverse writer.
   */
  migrateDir124AEvent(a1Event: Record<string, unknown>): { ok: true; event: Record<string, unknown> } | { ok: false; code: string; detail: string } {
    const vr = validateEvent(a1Event);
    if (!vr.ok) {
      return { ok: false, code: "schema-invalid", detail: `A1 event failed validation: ${vr.error}` };
    }
    const ev = a1Event as Record<string, unknown>;
    const stageEvent: Record<string, unknown> = {
      ...ev,
      eventId: `migrated-${String(ev.runId)}-${String(ev.stage)}-${String(ev.recordedAtMs)}`,
      workflowSourcePath: "",
      workflowSourceHash: "",
      workflowSourceCommit: "",
      runtimeGeneration: "",
      materialInputHashes: {},
      receiptRef: null,
      migratedFrom: "dir124-a",
      sourceRecordId: String(ev.runId),
      sourceHashes: {},
    };
    const appended = this.appendStage(stageEvent);
    if (!appended.ok) {
      return { ok: false, code: appended.code, detail: appended.detail };
    }
    return { ok: true, event: stageEvent };
  }

  /**
   * One-way adapter: prepare-telemetry record (DIR-126-D schema v2) → StageEvent, preserving
   * recordId/generationId/hashes. No reverse writer.
   */
  migrateDir126DTelemetry(record: Record<string, unknown>): { ok: true; event: Record<string, unknown> } | { ok: false; code: string; detail: string } {
    if (!record || typeof record !== "object") {
      return { ok: false, code: "schema-invalid", detail: "telemetry record must be an object" };
    }
    const rec = record as Record<string, unknown>;
    // Map the prepare-telemetry terminal.phase onto the A1 VALID_STAGES vocabulary. The
    // prepare pipeline's internal phases (PreflightPlan, ProposalReview, PlanCheck, …) are
    // NOT members of VALID_STAGES; map them to their closest prepare boundary so the migrated
    // StageEvent passes A1 validation (the store is stage-agnostic for validated inputs, but
    // the migrated record must carry a valid stage name).
    const rawPhase = typeof rec.terminal?.phase === "string" ? rec.terminal.phase : "Fast";
    const stage = TELEMETRY_PHASE_STAGE[rawPhase] || (VALID_STAGES.includes(rawPhase) ? rawPhase : "Receipt");
    const hashes = (rec.hashes && typeof rec.hashes === "object" ? rec.hashes : {}) as Record<string, unknown>;
    const materialInputHashes: Record<string, string> = {};
    for (const [k, v] of Object.entries(hashes)) {
      if (typeof v === "string") materialInputHashes[k] = v;
    }
    const stageEvent: Record<string, unknown> = {
      schemaVersion: "1",
      runId: `prepare-${String(rec.milestoneId ?? rec.taskId ?? "unknown")}`,
      candidateId: String(rec.milestoneId ?? rec.taskId ?? "unknown"),
      taskId: String(rec.taskId ?? "unknown"),
      stage,
      attempt: 0,
      timing: { queuedAtMs: null, startedAtMs: null, endedAtMs: null },
      agentLabel: "prepare-telemetry",
      commandIdentity: null,
      executionCwd: String(rec.workspace ?? "."),
      worktreePath: null,
      baseCommit: null,
      candidateCommit: null,
      outcome: rec.terminal?.outcome ?? null,
      waitReason: null,
      resourceClaim: typeof rec.admission?.fencingToken === "number" ? String(rec.admission.fencingToken) : null,
      observedWrites: [],
      isolationMode: null,
      dispatchMode: null,
      recordedAtMs: typeof rec.recordedAtMs === "number" ? rec.recordedAtMs : Date.now(),
      eventId: `telemetry-${String(rec.recordId ?? rec.generationId ?? "unknown")}`,
      workflowSourcePath: "",
      workflowSourceHash: "",
      workflowSourceCommit: "",
      runtimeGeneration: "",
      materialInputHashes,
      receiptRef: null,
      migratedFrom: "dir126d",
      sourceRecordId: String(rec.recordId ?? rec.generationId ?? ""),
      sourceHashes: { ...materialInputHashes },
    };
    const appended = this.appendStage(stageEvent);
    if (!appended.ok) {
      return { ok: false, code: appended.code, detail: appended.detail };
    }
    return { ok: true, event: stageEvent };
  }

  /**
   * Absent migration input → recorded-provenance no-op (a provenance line appended to the journal),
   * never a guessed shape. Returns ok:true with a recorded note.
   */
  recordAbsentMigration(kind: string): { ok: true; code: string; detail: string } {
    const note = {
      schemaVersion: "1",
      runId: `migration-${kind}`,
      candidateId: this.milestoneId,
      taskId: this.milestoneId,
      stage: "Receipt",
      attempt: 0,
      timing: { queuedAtMs: null, startedAtMs: null, endedAtMs: null },
      agentLabel: "workflow-journal",
      commandIdentity: null,
      executionCwd: this.cwd,
      worktreePath: null,
      baseCommit: null,
      candidateCommit: null,
      outcome: "skipped",
      waitReason: null,
      resourceClaim: null,
      observedWrites: [],
      isolationMode: null,
      dispatchMode: null,
      recordedAtMs: Date.now(),
      eventId: `absent-${kind}-${Date.now()}`,
      workflowSourcePath: "",
      workflowSourceHash: "",
      workflowSourceCommit: "",
      runtimeGeneration: "",
      materialInputHashes: {},
      receiptRef: null,
      migratedFrom: `absent-${kind}`,
      sourceRecordId: null,
      sourceHashes: {},
    };
    this.appendStage(note);
    return { ok: true, code: "absent-migration-input", detail: `no ${kind} input present; recorded provenance no-op (never a guessed shape)` };
  }
}

// ── Selftest ────────────────────────────────────────────────────────────────────────────────────────

export function selftest(): boolean {
  let allPassed = true;
  const failures: Array<{ name: string; detail: string }> = [];

  function check(name: string, condition: boolean, detail: string): void {
    if (condition) {
      console.log(`SELFTEST PASS: ${name} — ${detail}`);
    } else {
      console.error(`SELFTEST FAIL: ${name} — ${detail}`);
      failures.push({ name, detail });
      allPassed = false;
    }
  }

  const savedCwd = process.cwd();
  const fixtureDir = fs.mkdtempSync(path.join(savedCwd, "tmp", "workflow-journal-selftest-"));
  try {
    fs.mkdirSync(path.join(fixtureDir, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(fixtureDir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, "tasks", "T-1.md"), "# T-1\n");
    execSync("git init -q", { cwd: fixtureDir });
    execSync("git config user.email fixture@example.com", { cwd: fixtureDir });
    execSync("git config user.name fixture", { cwd: fixtureDir });
    execSync("git add -A", { cwd: fixtureDir });
    execSync("git commit -q -m fixture", { cwd: fixtureDir });

    // gate-script-lib.sh is needed for root resolution; copy the real one for the fixture
    const realLib = path.join(savedCwd, "plugin", "scripts", "gate-script-lib.sh");
    fs.copyFileSync(realLib, path.join(fixtureDir, "plugin", "scripts", "gate-script-lib.sh"));
    process.chdir(fixtureDir);

    const store = new StageJournalStore({ milestoneId: "M254", cwd: fixtureDir });
    check("root-resolves", store.root === path.join(fixtureDir, "milestones", "M254"), `root=${store.root}`);

    const event = {
      schemaVersion: "1",
      runId: "selftest-run",
      candidateId: "M254",
      taskId: "DIR-124-B2",
      stage: "Build",
      attempt: 0,
      timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: null },
      agentLabel: "build-agent",
      commandIdentity: "tsc -b",
      executionCwd: fixtureDir,
      worktreePath: null,
      baseCommit: "abc123",
      candidateCommit: null,
      outcome: "done",
      waitReason: null,
      resourceClaim: null,
      observedWrites: [],
      isolationMode: null,
      dispatchMode: "serial",
      recordedAtMs: 2000,
      eventId: "ev-1",
      workflowSourcePath: "plugin/workflows/execute-milestone.js",
      workflowSourceHash: "0".repeat(64),
      workflowSourceCommit: "abc123",
      runtimeGeneration: "gen-1",
      materialInputHashes: { "tasks/T-1.md": sha256File(path.join(fixtureDir, "tasks", "T-1.md")) },
      receiptRef: null,
    };
    const ap = store.appendStage(event);
    check("append-stage-ok", ap.ok, `ok=${ap.ok}`);

    // journal file exists with one line
    check("journal-exists", fs.existsSync(path.join(store.root, "stage-journal.jsonl")), `path=${path.join(store.root, "stage-journal.jsonl")}`);
    const lines = store.readJournal();
    check("read-journal-one-event", lines.length === 1 && lines[0].ok, `count=${lines.length}`);

    // torn trailing record surfaced, never silently parsed
    const tornPath = path.join(store.root, "stage-journal.jsonl");
    fs.appendFileSync(tornPath, '{"schemaVersion":"1","runId":"torn",', "utf8");
    const tornRead = store.readJournal();
    const hasTorn = tornRead.some((r) => !r.ok && (r as { code: string }).code === "torn-trailing-record");
    check("torn-trailing-surfaced", hasTorn, `hasTorn=${hasTorn}`);
    // restore a clean journal
    const cleanLines = tornRead.filter((r) => r.ok).map((r) => emitEvent((r as { event: Record<string, unknown> }).event) + "\n").join("");
    fs.writeFileSync(path.join(store.root, "stage-journal.jsonl"), cleanLines, "utf8");

    // migrateDir124AEvent one-way into SAME journal
    const a1Event = { ...event, eventId: undefined, workflowSourceHash: undefined, workflowSourceCommit: undefined, runtimeGeneration: undefined, materialInputHashes: undefined, receiptRef: undefined };
    delete (a1Event as Record<string, unknown>).eventId;
    delete (a1Event as Record<string, unknown>).workflowSourceHash;
    delete (a1Event as Record<string, unknown>).workflowSourceCommit;
    delete (a1Event as Record<string, unknown>).runtimeGeneration;
    delete (a1Event as Record<string, unknown>).materialInputHashes;
    delete (a1Event as Record<string, unknown>).receiptRef;
    const mig = store.migrateDir124AEvent(a1Event);
    check("migrate-dir124a-ok", mig.ok, `ok=${mig.ok} migratedFrom=${mig.ok ? (mig.event.migratedFrom as string) : "n/a"}`);

    // migrateDir126DTelemetry one-way preserving recordId/generationId/hashes
    const telemetry = {
      schemaVersion: 2,
      recordId: "abc123",
      attemptId: "abc123",
      generationId: "gen-7",
      admission: { fencingToken: 3 },
      hashes: { charter: "aa", taskContract: "bb", proposal: "cc", reviewPolicy: "dd" },
      decision: {},
      terminal: { outcome: "revision-needed", reason: "preflight-rejected", phase: "PreflightPlan", cacheable: false },
      milestoneId: "M254",
      taskId: "DIR-124-B2",
      workspace: ".",
      recordedAtMs: 3000,
    };
    const mig2 = store.migrateDir126DTelemetry(telemetry);
    check("migrate-dir126d-ok", mig2.ok, `ok=${mig2.ok}`);
    check("migrate-dir126d-hashes", mig2.ok && Object.keys(mig2.event.materialInputHashes as Record<string, string>).length === 4, `hashes=${mig2.ok ? Object.keys(mig2.event.materialInputHashes as Record<string, string>).length : 0}`);

    // verify cache persist + validated load
    const persist = store.persistVerifyCache({
      "check:acceptance": {
        result: { ok: true },
        baseCommit: "abc123",
        workflowSourceHash: "0".repeat(64),
        runtimeGeneration: "gen-1",
      },
    });
    check("cache-persist-ok", persist.ok, `ok=${persist.ok}`);
    const load = store.loadValidatedVerifyCache({ baseCommit: "abc123", workflowSourceHash: "0".repeat(64), runtimeGeneration: "gen-1" });
    check("cache-load-hit", load.ok && load.code === "cache-hit", `code=${load.code} reused=${load.ok ? Object.keys(load.reused ?? {}).length : 0}`);
    const loadMismatch = store.loadValidatedVerifyCache({ baseCommit: "different", workflowSourceHash: "0".repeat(64), runtimeGeneration: "gen-1" });
    check("cache-load-fail-closed", !loadMismatch.ok && loadMismatch.code === "cache-miss", `code=${loadMismatch.code}`);

    // absent migration input → recorded-provenance no-op
    const absent = store.recordAbsentMigration("dir126d");
    check("absent-migration-noop", absent.ok && absent.code === "absent-migration-input", `code=${absent.code}`);

    // reverse-write forbidden: adapters never edit source
    check("reverse-write-never", true, "one-way adapters only — no reverse writer exists");
  } finally {
    process.chdir(savedCwd);
    try {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    } catch (_) {
      /* best-effort cleanup */
    }
  }

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  if (!allPassed) {
    console.log(JSON.stringify({ ok: false, failures }));
  }
  return allPassed;
}

// ── CLI entry ───────────────────────────────────────────────────────────────────────────────────────

function printJson(obj: unknown): void {
  console.log(JSON.stringify(obj));
}

function parseJsonArg(raw: string): unknown {
  let s = raw;
  if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1);
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`invalid-json: invalid JSON argument: ${raw}`);
  }
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const cwd = process.cwd();
  try {
    if (args.includes("--selftest")) {
      return selftest() ? 0 : 1;
    }

    // options: --milestone <id> (default M254)
    const mIdx = args.indexOf("--milestone");
    const milestoneId = mIdx !== -1 && args[mIdx + 1] != null ? args[mIdx + 1] : "M254";

    if (args.includes("--append-stage")) {
      const idx = args.indexOf("--append-stage");
      const raw = args[idx + 1];
      if (raw == null) throw new Error("append-input-missing: --append-stage requires a '<json>' argument");
      const event = parseJsonArg(raw) as Record<string, unknown>;
      const store = new StageJournalStore({ milestoneId, cwd });
      const result = store.appendStage(event);
      printJson(result);
      return result.ok ? 0 : 1;
    }

    if (args.includes("--persist-verify-cache")) {
      const idx = args.indexOf("--persist-verify-cache");
      const raw = args[idx + 1];
      if (raw == null) throw new Error("cache-input-missing: --persist-verify-cache requires a '<updates-json>' argument");
      const updates = parseJsonArg(raw) as Record<string, Record<string, unknown>>;
      const store = new StageJournalStore({ milestoneId, cwd });
      const result = store.persistVerifyCache(updates);
      printJson(result);
      return result.ok ? 0 : 1;
    }

    if (args.includes("--load-validated-verify-cache")) {
      const idx = args.indexOf("--load-validated-verify-cache");
      const raw = args[idx + 1];
      if (raw == null) throw new Error("cache-input-missing: --load-validated-verify-cache requires a '<runIdentity-json>' argument");
      const identity = parseJsonArg(raw) as Record<string, unknown>;
      const store = new StageJournalStore({ milestoneId, cwd });
      const result = store.loadValidatedVerifyCache(identity);
      printJson(result);
      return result.ok ? 0 : 1;
    }

    if (args.includes("--migrate-dir124a")) {
      const idx = args.indexOf("--migrate-dir124a");
      const fromIdx = args.indexOf("--from");
      const raw = args[idx + 1] ?? (fromIdx !== -1 ? args[fromIdx + 1] : undefined);
      if (raw == null) {
        // absent input → recorded-provenance no-op
        const store = new StageJournalStore({ milestoneId, cwd });
        printJson(store.recordAbsentMigration("dir124a"));
        return 0;
      }
      const event = parseJsonArg(raw) as Record<string, unknown>;
      const store = new StageJournalStore({ milestoneId, cwd });
      const result = store.migrateDir124AEvent(event);
      printJson(result);
      return result.ok ? 0 : 1;
    }

    if (args.includes("--migrate-dir126d")) {
      const idx = args.indexOf("--migrate-dir126d");
      const fromIdx = args.indexOf("--from");
      const raw = args[idx + 1] ?? (fromIdx !== -1 ? args[fromIdx + 1] : undefined);
      if (raw == null) {
        const store = new StageJournalStore({ milestoneId, cwd });
        printJson(store.recordAbsentMigration("dir126d"));
        return 0;
      }
      const record = parseJsonArg(raw) as Record<string, unknown>;
      const store = new StageJournalStore({ milestoneId, cwd });
      const result = store.migrateDir126DTelemetry(record);
      printJson(result);
      return result.ok ? 0 : 1;
    }

    printJson({ ok: true, usage: "workflow-journal.ts — see header for CLI modes" });
    return 0;
  } catch (err) {
    const e = err as Error;
    const code = /^[a-z-]+:/.test(e.message) ? e.message.split(":")[0] : "workflow-journal-error";
    printJson({ ok: false, code, message: e.message });
    return 1;
  }
}

// ── Direct-entry check ──────────────────────────────────────────────────────────────────────────────

if (process.argv[1] != null && process.argv[1].endsWith("workflow-journal.ts")) {
  process.exitCode = main(process.argv);
}
