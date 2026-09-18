// run-identity.ts — DIR-124-B1 (M253): the canonical RunIdentity factory + CLI for the
// milestone-execution substrate. Mechanism 1 of the DIR-124-B 4-way split: the ONE
// identity-minting entry point (`--create`) that derives `runId` from the harness
// `CLAUDE_CODE_SESSION_ID` (env-inherited subprocess, DD2), binds `baseCommit` to the live
// `git rev-parse HEAD` (DD3), and records sha256 hashes of every material input — never content
// (DD7).
//
// Byte-identical mirror: plugin/scripts/run-identity.ts
//
// Zero npm dependencies — Node.js built-ins only (node:fs, node:path, node:crypto,
// node:child_process). No build step; dispatched exclusively via the established
// `node --experimental-strip-types <abs path>/run-identity.ts <mode>` agent-dispatch pattern.
//
// Export surfaces:
//   - Types: RunIdentity, MintRunIdentityInput
//   - Functions: mintRunIdentity(input), serializeIdentity(identity),
//     toBuildManifestRunIdentity(identity), bindCandidateCommit(identity, commit),
//     checkCandidateCommit(identity, observedCommit), selftest()
//   - CLI: --create '<json>', --bind-candidate-commit '<identity-json>' <commit>,
//     --check-candidate-commit '<identity-json>' <observedCommit>, --selftest
//
// All fail-closed error modes exit non-zero with a structured JSON error on stdout:
//   missing-session-id, session-id-conflict, base-commit-mismatch, base-commit-unresolved,
//   invalid-task-ids, material-input-missing, workflow-source-missing, mirror-drift,
//   candidate-commit-unbound, candidate-commit-moved.
// Defensive input-validation codes (still fail-closed, not in the enumerated ten):
//   invalid-candidate-id, invalid-workflow-source-path, workflow-source-path-absolute,
//   invalid-material-path, invalid-attempt, invalid-json, invalid-identity,
//   invalid-candidate-commit, create-input-missing, bind-input-missing, check-input-missing.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createSelftest } from "./gate-script-base.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = "1" as const;

export interface MintRunIdentityInput {
  /** Milestone id for a singleton; composite `candidateId` for a composite. Disambiguates runs in one session. */
  candidateId: string;
  /** Non-empty; width 1 = singleton, width N = composite. */
  taskIds: string[];
  /** Per-dispatch nonce; defaults to 1 on cold dispatch (journal-monotonic from B3). */
  attempt?: number;
  /** Caller-supplied canonical path of the installed workflow source. */
  workflowSourcePath: string;
  /** Parallel array to taskIds — the task-file path for each taskId. */
  taskFiles: string[];
  /** Charter file path (material input). */
  charterFile: string;
  /** Plan file path (material input). */
  planFile: string;
  /** Caller-supplied baseCommit — must match `git rev-parse HEAD` or the mint fails closed. */
  baseCommit?: string;
  /** Caller-supplied sessionId — must equal the env value or the mint fails closed. */
  sessionId?: string;
}

/** The canonical 16-field RunIdentity envelope, versioned from birth (schemaVersion "1"). */
export interface RunIdentity {
  schemaVersion: "1";
  runId: string;
  sessionId: string;
  candidateId: string;
  taskIds: string[];
  attempt: number;
  baseCommit: string;
  candidateCommit: string | null;
  workflowSourcePath: string;
  workflowSourceHash: string;
  workflowSourceCommit: string;
  runtimeGeneration: string;
  taskHash: string;
  charterHash: string;
  planHash: string;
  materialInputHashes: Record<string, string>;
}

// ── Error helper (prepares an Error with a structured `code`) ───────────────────────────────────────

function identityError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

// ── sha256 helpers ──────────────────────────────────────────────────────────────────────────────────

function sha256OfBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ── git helpers (inline; same shape as build-evidence-gate.ts) ──────────────────────────────────────

function git(args: string[], cwd: string): string {
  return execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf8", timeout: 10_000 }).trim();
}

function deriveBaseCommit(cwd: string): string {
  try {
    return git(["rev-parse", "HEAD"], cwd);
  } catch {
    throw identityError(
      "base-commit-unresolved",
      `git rev-parse HEAD failed in ${cwd} — an unbindable identity is a validation failure`
    );
  }
}

function deriveWorkflowSourceCommit(workflowSourcePath: string, cwd: string): string {
  try {
    return git(["log", "-1", "--format=%H", "--", workflowSourcePath], cwd);
  } catch {
    return "";
  }
}

// ── DD6 mirror derivation (`.claude/workflows/` ↔ `plugin/workflows/`) ─────────────────────────────

function mirrorWorkflowPath(workflowSourcePath: string): string | null {
  const p = workflowSourcePath.split(path.sep).join("/");
  const CANONICAL_PREFIX = ".claude/workflows/";
  const PLUGIN_PREFIX = "plugin/workflows/";
  if (p.startsWith(CANONICAL_PREFIX)) return PLUGIN_PREFIX + p.slice(CANONICAL_PREFIX.length);
  if (p.startsWith(PLUGIN_PREFIX)) return CANONICAL_PREFIX + p.slice(PLUGIN_PREFIX.length);
  return null;
}

// ── The ONE factory (AC1/AC3) ───────────────────────────────────────────────────────────────────────

export function mintRunIdentity(input: MintRunIdentityInput): RunIdentity {
  const cwd = process.cwd();

  // ── DD2 — env-read session, fail-closed, never caller-asserted ──────────────────────────────────
  const envSessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (!envSessionId) {
    throw identityError(
      "missing-session-id",
      "CLAUDE_CODE_SESSION_ID is not set in this process environment — the RunIdentity cannot be minted without the harness session id"
    );
  }
  if (input.sessionId != null && input.sessionId !== envSessionId) {
    throw identityError(
      "session-id-conflict",
      `caller-supplied sessionId "${input.sessionId}" conflicts with env CLAUDE_CODE_SESSION_ID — the session half of runId is never caller-asserted`
    );
  }
  const sessionId = envSessionId;

  // ── required input field validation ─────────────────────────────────────────────────────────────
  if (typeof input.candidateId !== "string" || input.candidateId.trim() === "") {
    throw identityError("invalid-candidate-id", "candidateId must be a non-empty string");
  }
  if (typeof input.workflowSourcePath !== "string" || input.workflowSourcePath.trim() === "") {
    throw identityError("invalid-workflow-source-path", "workflowSourcePath must be a non-empty string");
  }
  if (path.isAbsolute(input.workflowSourcePath)) {
    throw identityError(
      "workflow-source-path-absolute",
      `workflowSourcePath must be a repo-relative canonical path (e.g. plugin/workflows/execute-milestone.js), got an absolute path: ${input.workflowSourcePath} — an absolute path would disable the DD6 mint-time mirror-parity invariant`
    );
  }
  if (typeof input.charterFile !== "string" || input.charterFile.trim() === "") {
    throw identityError("invalid-material-path", "charterFile must be a non-empty string");
  }
  if (typeof input.planFile !== "string" || input.planFile.trim() === "") {
    throw identityError("invalid-material-path", "planFile must be a non-empty string");
  }

  // ── taskIds / taskFiles validation (mirrors composite-args.ts inline normalization) ──────────────
  if (!Array.isArray(input.taskIds) || input.taskIds.length === 0) {
    throw identityError("invalid-task-ids", "taskIds must be a non-empty array");
  }
  const seenTaskIds = new Set<string>();
  for (const t of input.taskIds) {
    if (typeof t !== "string" || t.trim() === "" || seenTaskIds.has(t)) {
      throw identityError("invalid-task-ids", `taskIds contains an empty, non-string, or duplicate id: ${JSON.stringify(t)}`);
    }
    seenTaskIds.add(t);
  }
  if (!Array.isArray(input.taskFiles) || input.taskFiles.length !== input.taskIds.length) {
    throw identityError("invalid-task-ids", `taskFiles must be a parallel array to taskIds (got ${input.taskFiles?.length} for ${input.taskIds.length})`);
  }
  for (const f of input.taskFiles) {
    if (typeof f !== "string" || f.trim() === "") {
      throw identityError("invalid-task-ids", `taskFiles contains an empty or non-string entry: ${JSON.stringify(f)}`);
    }
  }

  // ── attempt — default 1 on cold dispatch (B3 makes it journal-monotonic later) ───────────────────
  const attempt = input.attempt == null ? 1 : input.attempt;
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw identityError("invalid-attempt", `attempt must be a positive integer, got ${JSON.stringify(input.attempt)}`);
  }

  // ── workflow source (DD7 — hashes only, never content) ──────────────────────────────────────────
  const workflowSourceAbs = path.resolve(cwd, input.workflowSourcePath);
  if (!fs.existsSync(workflowSourceAbs)) {
    throw identityError("workflow-source-missing", `workflow source not found: ${input.workflowSourcePath}`);
  }
  const workflowSourceBytes = fs.readFileSync(workflowSourceAbs);
  const workflowSourceHash = sha256OfBuffer(workflowSourceBytes);

  // ── DD6 — mint-time mirror-parity: the installed workflow source must match its mirror ───────────
  const mirrorRel = mirrorWorkflowPath(input.workflowSourcePath);
  if (mirrorRel) {
    const mirrorAbs = path.resolve(cwd, mirrorRel);
    if (fs.existsSync(mirrorAbs)) {
      const mirrorBytes = fs.readFileSync(mirrorAbs);
      if (!mirrorBytes.equals(workflowSourceBytes)) {
        throw identityError(
          "mirror-drift",
          `workflow mirror drift at mint time: ${input.workflowSourcePath} and ${mirrorRel} differ`
        );
      }
    }
  }

  // ── material inputs (DD7) ───────────────────────────────────────────────────────────────────────
  const taskFilesAbs = input.taskFiles.map((f) => path.resolve(cwd, f));
  const charterAbs = path.resolve(cwd, input.charterFile);
  const planAbs = path.resolve(cwd, input.planFile);
  for (const f of [...taskFilesAbs, charterAbs, planAbs]) {
    if (!fs.existsSync(f)) {
      throw identityError("material-input-missing", `material input file not found: ${path.relative(cwd, f)}`);
    }
  }

  // ── DD3 — derive-don't-trust baseCommit ─────────────────────────────────────────────────────────
  const derivedBaseCommit = deriveBaseCommit(cwd);
  if (input.baseCommit != null && input.baseCommit !== derivedBaseCommit) {
    throw identityError(
      "base-commit-mismatch",
      `caller-supplied baseCommit "${input.baseCommit}" does not match git rev-parse HEAD "${derivedBaseCommit}"`
    );
  }
  const baseCommit = derivedBaseCommit;

  const workflowSourceCommit = deriveWorkflowSourceCommit(input.workflowSourcePath, cwd);

  // ── taskHash — sha256 over task-file bytes concatenated in sorted-taskId order (deterministic) ──
  const sortedPairs = input.taskIds
    .map((id, i) => ({ id, fileRel: input.taskFiles[i], fileAbs: taskFilesAbs[i] }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const taskHash = sha256OfBuffer(Buffer.concat(sortedPairs.map((p) => fs.readFileSync(p.fileAbs))));

  const charterHash = sha256OfBuffer(fs.readFileSync(charterAbs));
  const planHash = sha256OfBuffer(fs.readFileSync(planAbs));

  // ── materialInputHashes — {path: sha256} over every material input, deterministic key order ─────
  const materialKeys = [
    ...sortedPairs.map((p) => p.fileRel),
    input.charterFile,
    input.planFile,
  ].sort();
  const materialInputHashes: Record<string, string> = {};
  for (const key of materialKeys) {
    materialInputHashes[key] = sha256OfBuffer(fs.readFileSync(path.resolve(cwd, key)));
  }

  const runId = `${sessionId}::${input.candidateId}::${attempt}`;
  // ── DD5 — fixed runtime-generation derivation, pinned by fixtures ───────────────────────────────
  const runtimeGeneration = sha256OfBuffer(Buffer.from(workflowSourceHash, "utf8")).slice(0, 12);

  return {
    schemaVersion: "1",
    runId,
    sessionId,
    candidateId: input.candidateId,
    taskIds: [...input.taskIds],
    attempt,
    baseCommit,
    candidateCommit: null, // DD4 — deferred, immutably-bound field
    workflowSourcePath: input.workflowSourcePath,
    workflowSourceHash,
    workflowSourceCommit,
    runtimeGeneration,
    taskHash,
    charterHash,
    planHash,
    materialInputHashes,
  };
}

// ── Deterministic serialization (A1a emitEvent sorted-copy precedent) ──────────────────────────────

/**
 * Deterministic single-line JSON: top-level keys sorted, and the nested `materialInputHashes`
 * object serialized with its own keys sorted, so identical identities serialize byte-identically
 * (C8) regardless of key insertion order. Never lossy — every field survives.
 */
export function serializeIdentity(identity: RunIdentity): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(identity).sort()) {
    const value = (identity as Record<string, unknown>)[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        nested[k] = (value as Record<string, unknown>)[k];
      }
      sorted[key] = nested;
    } else {
      sorted[key] = value;
    }
  }
  return JSON.stringify(sorted);
}

// ── Build-manifest projection (CLAIM-B1-C7) — consumable where build-evidence-manifest's
// inline `{milestoneId, taskIds, composite, attempt, sessionId}` shape is expected, WITHOUT
// editing build-evidence-manifest.ts. `composite` is a DERIVED property (Alt3). ────────────────

export function toBuildManifestRunIdentity(identity: RunIdentity): {
  milestoneId: string;
  taskIds: string[];
  composite: boolean;
  attempt: number;
  sessionId: string;
} {
  return {
    milestoneId: identity.candidateId,
    taskIds: identity.taskIds,
    composite: identity.taskIds.length > 1,
    attempt: identity.attempt,
    sessionId: identity.sessionId,
  };
}

// ── DD4 — bind/check candidateCommit (SOLE bind site is Build-integrate; B4 wires it) ───────────────

/** Pure, immutable re-derivation: returns a NEW identity with candidateCommit set. */
export function bindCandidateCommit(identity: RunIdentity, commit: string): RunIdentity {
  if (typeof commit !== "string" || commit.trim() === "") {
    throw identityError("invalid-candidate-commit", "candidateCommit must be a non-empty commit hash");
  }
  return { ...identity, candidateCommit: commit };
}

/** Fail-closed re-check for the moved-candidate hazard at Audit/Gate/Land. */
export function checkCandidateCommit(
  identity: RunIdentity,
  observedCommit: string
): { ok: true } | { ok: false; code: string; message: string } {
  if (identity.candidateCommit == null) {
    return { ok: false, code: "candidate-commit-unbound", message: "candidateCommit is null — cannot validate against nothing" };
  }
  if (identity.candidateCommit !== observedCommit) {
    return {
      ok: false,
      code: "candidate-commit-moved",
      message: `candidateCommit moved: expected ${identity.candidateCommit}, observed ${observedCommit}`,
    };
  }
  return { ok: true };
}

// ── Selftest ────────────────────────────────────────────────────────────────────────────────────────

function _createGitFixture(dir: string): void {
  fs.mkdirSync(path.join(dir, "plugin", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".claude", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "charters"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "plans"), { recursive: true });
  const wf = "# workflow fixture\n";
  fs.writeFileSync(path.join(dir, "plugin", "workflows", "execute-milestone.js"), wf);
  fs.writeFileSync(path.join(dir, ".claude", "workflows", "execute-milestone.js"), wf);
  for (const t of ["T-1", "T-2", "T-3"]) {
    fs.writeFileSync(path.join(dir, "tasks", `${t}.md`), `# ${t}\n`);
  }
  fs.writeFileSync(path.join(dir, "charters", "M253.md"), "# charter\n");
  fs.writeFileSync(path.join(dir, "docs", "plans", "M253.md"), "# plan\n");
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email fixture@example.com", { cwd: dir });
  execSync("git config user.name fixture", { cwd: dir });
  execSync("git add -A", { cwd: dir });
  execSync("git commit -q -m fixture", { cwd: dir });
}

export function selftest(): boolean {
  const st = createSelftest({ flavor: "cases", collectFailures: true, dumpFailuresJson: true });
  const check = st.check;

  const savedCwd = process.cwd();
  const savedSession = process.env.CLAUDE_CODE_SESSION_ID;
  fs.mkdirSync(path.join(savedCwd, "tmp"), { recursive: true });
  const fixtureDir = fs.mkdtempSync(path.join(savedCwd, "tmp", "run-identity-selftest-"));

  try {
    process.env.CLAUDE_CODE_SESSION_ID = "selftest-session-1";
    _createGitFixture(fixtureDir);
    process.chdir(fixtureDir);

    const fullInput: MintRunIdentityInput = {
      candidateId: "M253",
      taskIds: ["T-1"],
      workflowSourcePath: "plugin/workflows/execute-milestone.js",
      taskFiles: ["tasks/T-1.md"],
      charterFile: "charters/M253.md",
      planFile: "docs/plans/M253.md",
    };

    // ── factory round-trip: mint → serialize → parse → re-serialize deep-equal ────────────────────
    const identity = mintRunIdentity(fullInput);
    const serialized = serializeIdentity(identity);
    const reparsed = JSON.parse(serialized) as RunIdentity;
    check("roundtrip-serialize-equal", serializeIdentity(reparsed) === serialized, "mint → serialize → parse → re-serialize is byte-identical");
    check("roundtrip-runId", reparsed.runId === "selftest-session-1::M253::1", `runId=${reparsed.runId}`);

    // ── singleton-vs-composite same-envelope ──────────────────────────────────────────────────────
    const composite = mintRunIdentity({
      ...fullInput,
      taskIds: ["T-1", "T-2", "T-3"],
      taskFiles: ["tasks/T-1.md", "tasks/T-2.md", "tasks/T-3.md"],
    });
    const singletonKeys = Object.keys(identity).sort();
    const compositeKeys = Object.keys(composite).sort();
    check("same-envelope-keys", JSON.stringify(singletonKeys) === JSON.stringify(compositeKeys), "identical envelope key sets");
    check("same-schemaVersion", identity.schemaVersion === composite.schemaVersion && composite.schemaVersion === "1", `schemaVersion=${composite.schemaVersion}`);

    // ── runId-embeds-sessionId ────────────────────────────────────────────────────────────────────
    check("runId-embeds-sessionId", identity.runId.startsWith(`${identity.sessionId}::`), identity.runId);

    // ── deterministic serialization ──────────────────────────────────────────────────────────────
    check("serialize-deterministic", serializeIdentity(identity) === serialized, "two calls → byte-identical");

    // ── hash determinism ──────────────────────────────────────────────────────────────────────────
    const identityAgain = mintRunIdentity(fullInput);
    check(
      "hash-determinism",
      identity.workflowSourceHash === identityAgain.workflowSourceHash &&
        identity.taskHash === identityAgain.taskHash &&
        identity.runtimeGeneration === identityAgain.runtimeGeneration,
      "same input → same hashes"
    );

    // ── missing-env fail-closed ───────────────────────────────────────────────────────────────────
    delete process.env.CLAUDE_CODE_SESSION_ID;
    try {
      mintRunIdentity(fullInput);
      check("missing-env-fail-closed", false, "should have thrown missing-session-id");
    } catch (err) {
      check("missing-env-fail-closed", (err as Error & { code?: string }).code === "missing-session-id", (err as Error & { code?: string }).code ?? "no code");
    }
    process.env.CLAUDE_CODE_SESSION_ID = "selftest-session-1";

    // ── conflicting-arg rejection ─────────────────────────────────────────────────────────────────
    try {
      mintRunIdentity({ ...fullInput, sessionId: "other-session" });
      check("conflicting-arg-rejected", false, "should have thrown session-id-conflict");
    } catch (err) {
      check("conflicting-arg-rejected", (err as Error & { code?: string }).code === "session-id-conflict", (err as Error & { code?: string }).code ?? "no code");
    }

    // ── mirror-drift fixture ──────────────────────────────────────────────────────────────────────
    const driftDir = fs.mkdtempSync(path.join(fixtureDir, "drift-"));
    fs.mkdirSync(path.join(driftDir, "plugin", "workflows"), { recursive: true });
    fs.mkdirSync(path.join(driftDir, ".claude", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(driftDir, "plugin", "workflows", "execute-milestone.js"), "content A");
    fs.writeFileSync(path.join(driftDir, ".claude", "workflows", "execute-milestone.js"), "content B");
    process.chdir(driftDir);
    try {
      mintRunIdentity(fullInput);
      check("mirror-drift", false, "should have thrown mirror-drift");
    } catch (err) {
      check("mirror-drift", (err as Error & { code?: string }).code === "mirror-drift", (err as Error & { code?: string }).code ?? "no code");
    }
    process.chdir(fixtureDir);
  } finally {
    process.env.CLAUDE_CODE_SESSION_ID = savedSession;
    process.chdir(savedCwd);
    try {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    } catch (_) {
      /* best-effort cleanup */
    }
  }
  return st.report();
}

// ── CLI entry ───────────────────────────────────────────────────────────────────────────────────────

function printJson(obj: unknown): void {
  console.log(JSON.stringify(obj));
}

function usage(): string {
  return [
    "run-identity.ts — canonical RunIdentity factory + CLI (DIR-124-B1)",
    "Usage:",
    "  node --experimental-strip-types run-identity.ts --create '<json>'",
    "  node --experimental-strip-types run-identity.ts --bind-candidate-commit '<identity-json>' <commit>",
    "  node --experimental-strip-types run-identity.ts --check-candidate-commit '<identity-json>' <observedCommit>",
    "  node --experimental-strip-types run-identity.ts --selftest",
    "",
    "Input for --create: {candidateId, taskIds, attempt?, workflowSourcePath, taskFiles,",
    "  charterFile, planFile, baseCommit?, sessionId?}",
  ].join("\n");
}

function parseJsonArg(raw: string): unknown {
  let s = raw;
  if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1);
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  try {
    return JSON.parse(s);
  } catch {
    throw identityError("invalid-json", `invalid JSON argument: ${raw}`);
  }
}

const RUN_IDENTITY_FIELDS = [
  "schemaVersion",
  "runId",
  "sessionId",
  "candidateId",
  "taskIds",
  "attempt",
  "baseCommit",
  "candidateCommit",
  "workflowSourcePath",
  "workflowSourceHash",
  "workflowSourceCommit",
  "runtimeGeneration",
  "taskHash",
  "charterHash",
  "planHash",
  "materialInputHashes",
];

/** Fail-closed structural validation for a deserialized RunIdentity passed to bind/check. */
function validateRunIdentityShape(obj: unknown): RunIdentity {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw identityError("invalid-identity", "expected a serialized RunIdentity JSON object");
  }
  const rec = obj as Record<string, unknown>;
  for (const field of RUN_IDENTITY_FIELDS) {
    if (!(field in rec)) {
      throw identityError("invalid-identity", `identity missing required field "${field}"`);
    }
  }
  return obj as RunIdentity;
}

function requireIdentity(raw: string): RunIdentity {
  return validateRunIdentityShape(parseJsonArg(raw));
}

/** Sole `process.exit()` owner (via process.exitCode in the direct-entry guard). */
export function main(argv: string[]): number {
  const args = argv.slice(2);
  try {
    if (args.includes("--selftest")) {
      return selftest() ? 0 : 1;
    }

    if (args.includes("--create")) {
      const idx = args.indexOf("--create");
      const raw = args[idx + 1];
      if (raw == null) throw identityError("create-input-missing", "--create requires a '<json>' argument");
      const input = parseJsonArg(raw) as MintRunIdentityInput;
      const identity = mintRunIdentity(input);
      console.log(serializeIdentity(identity));
      return 0;
    }

    if (args.includes("--bind-candidate-commit")) {
      const idx = args.indexOf("--bind-candidate-commit");
      if (args[idx + 1] == null || args[idx + 2] == null) {
        throw identityError("bind-input-missing", "--bind-candidate-commit requires '<identity-json>' <commit>");
      }
      const identity = requireIdentity(args[idx + 1]);
      const bound = bindCandidateCommit(identity, args[idx + 2]);
      console.log(serializeIdentity(bound));
      return 0;
    }

    if (args.includes("--check-candidate-commit")) {
      const idx = args.indexOf("--check-candidate-commit");
      if (args[idx + 1] == null || args[idx + 2] == null) {
        throw identityError("check-input-missing", "--check-candidate-commit requires '<identity-json>' <observedCommit>");
      }
      const identity = requireIdentity(args[idx + 1]);
      const result = checkCandidateCommit(identity, args[idx + 2]);
      printJson(result);
      return result.ok ? 0 : 1;
    }

    console.log(usage());
    return 0;
  } catch (err) {
    const e = err as Error & { code?: string };
    printJson({ ok: false, code: e.code || "run-identity-error", message: e.message });
    return 1;
  }
}

// ── Direct-entry check ──────────────────────────────────────────────────────────────────────────────

if (process.argv[1] != null && process.argv[1].endsWith("run-identity.ts")) {
  process.exitCode = main(process.argv);
}
