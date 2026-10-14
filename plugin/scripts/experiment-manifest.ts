#!/usr/bin/env node
// experiment-manifest.ts — the RESUMABLE LONG EXPERIMENT manifest + checkpoint + resume-plan
// bookkeeping (tasks/gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler).
//
// THE CAPABILITY: a long-running measurement experiment (e.g. the 32/48/64-lane × ≥3-round suite
// comparison) must survive a worker redispatch or a driver restart without re-paying for stages that
// already completed. The failure this exists for is measured, not hypothetical: an ad-hoc 32/48/64-lane
// bash loop writing to /tmp had no checkpoint of its own, so ANY interruption re-ran lane 32 from
// round 1 — the worker's 26 GiB diagnostic run had no way to resume and stopping it lost the run.
//
// ⛔ THIS MODULE IS NOT A SCHEDULER. It starts no loop, no timer, no daemon and no second process that
// could compete with the worker-driver's dispatch. It is a SYNCHRONOUS library: given the manifest and
// the checkpoint carrier it answers "which stages still owe work, and why", and (via runStages) walks
// that answer ONCE, in the caller's own turn, with the stage executor INJECTED. The thing that makes a
// long experiment resumable is therefore the worker-driver's EXISTING adopt/restart path
// (plugin/scripts/worker-driver.ts) rediscovering the manifest on redispatch — not a new dispatcher.
//
// THE THREE RECORDS, all under the task's state dir (⛔ NOT the worktree — a worktree can be recreated
// or cleaned under us, which is exactly when a checkpoint must still be there):
//   manifest.json        the declared experiment: inputs, config summary, host/commit identity, stages
//                        and each stage's expected artifacts. Written once by the author.
//   checkpoints.json     one record per COMPLETED stage: its inputs hash, the IDENTITY FINGERPRINT it
//                        was produced under, and the measurement itself (artifacts, verdict, wall time,
//                        and the null-or-number resource readings — ⛔ never a fabricated 0).
//   invalidations.json   append-only: every checkpoint this module REFUSED to reuse and why. A mismatch
//                        is RECORDED, never silently overwritten — a resume that quietly re-ran a stage
//                        while leaving the old record in place would be indistinguishable from a resume
//                        that trusted it (硬规则 3b).
//
// IDENTITY CHANGE INVALIDATES, IT DOES NOT SILENTLY CONTINUE. A checkpoint is trusted only when ALL of
// (a) its inputs hash, (b) its commit, (c) its host and (d) its declared-policy hash still match the
// current run. Any difference ⇒ that stage is NOT reused: it lands in the plan's `invalidated` list,
// its reason names the changed field with both values, and the refusal is appended to
// invalidations.json before the stage runs again.
//
// SMOKE FIRST (a cheap correctness run is itself a checkpointed stage). A stage whose kind is "smoke"
// must complete with verdict "pass" before ANY kind:"full" stage may run — a broken harness then fails
// fast instead of burning the full experiment budget. A smoke stage that completes with verdict "fail"
// is checkpointed as such (it will not be re-run on resume) and permanently blocks the full stages
// until the inputs or the identity change.
//
// RUNNING IT (the CLI is what the worker's dispatch prompt points at — see worker-driver.ts
// experimentResumeClause):
//   node --experimental-strip-types experiment-manifest.ts --plan --task <id> [--root <dir>] [--json]
//   node --experimental-strip-types experiment-manifest.ts --run  --task <id> [--root <dir>]
// ⛔ `--run` executes the plan's stages ONE AT A TIME, synchronously, in the foreground: the worker's
// own turn is the only loop. Killing that process (e.g. `quay driver stop --kind worker`) mid-stage
// leaves every COMPLETED stage's checkpoint on disk and the interrupted stage un-checkpointed, so the
// next dispatch re-runs exactly the remainder.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
// The shared gate-script primitives (⛔ not a private copy): flag parsing / the direct-entry guard /
// the fail-closed git runner. `checker-mechanical-spine-check` and the position/slice-name family
// both red on a re-declared helper, and these are exactly the shapes it names.
import { flagValue, isDirectEntry, git } from "./gate-script-base.ts";
// The ONE atomic JSON state write (⛔ not a private tmp+rename copy — that split is what
// gap-writestate-atomicity-split closed, and a seventh body would re-open it).
import { writeJsonAtomic } from "./write-json-atomic.ts";

// ── The declared experiment ──────────────────────────────────────────────────────────────────────

/** Which stage kinds exist. "smoke" is the cheap correctness stage that gates every "full" stage. */
export type StageKind = "smoke" | "full";

/** One stage = one unit of paid-for work (e.g. one lane × one round). */
export interface ExperimentStage {
  /** Stable id — the checkpoint is keyed by it, so it must not be reused for different work. */
  id: string;
  kind: StageKind;
  /** The inputs that distinguish this stage (hashed into the checkpoint; a change invalidates it). */
  inputs: Record<string, unknown>;
  /** argv of the command that performs the measurement (used by `--run`; ⛔ not by planResume). */
  command: string[];
  /** Artifacts this stage promises to produce, relative to the experiment's output dir. */
  expectedArtifacts: string[];
  /** Optional path (relative to the output dir) of a measurement JSON the command writes; when it is
   *  absent at the end of a stage the numeric output fields stay null (⛔ never fabricated as 0). */
  measurementFile?: string;
}

/** The declared experiment. Written by the author of the experiment, read by every resume. */
export interface ExperimentManifest {
  /** The quay task (or experiment name) this manifest belongs to — the state dir is keyed by it. */
  experiment: string;
  /** Declared inputs shared by every stage (e.g. { lanes: [32,48,64], rounds: 3 }). */
  inputs: Record<string, unknown>;
  /** Configuration summary the checkpoints are bound to: declared memory policy + quay/plugin version. */
  config: Record<string, unknown>;
  /** Host identity the manifest was authored on (hostname; null = not declared). */
  host: string | null;
  /** The commit the manifest was authored at (null = not declared / unreadable). */
  gitCommit: string | null;
  /** Output dir for the stages' artifacts (absolute, or relative to the state dir). */
  outputDir: string;
  stages: ExperimentStage[];
}

/** The measurement a completed stage produced. Numeric fields are null when NOT MEASURED — 硬规则 3b:
 *  a stage whose resource counters were never read is not a stage that measured zero. */
export interface StageOutputs {
  artifacts: string[];
  filesPlanned: number | null;
  oomKill: number | null;
  peakRssBytes: number | null;
  wallMs: number;
  /** pass = the stage's own correctness signal said so; fail = it said otherwise. */
  verdict: "pass" | "fail";
  note: string | null;
}

/** The identity a checkpoint was produced under. Every field is re-checked before the checkpoint is
 *  trusted (identity change invalidates). `null` = not declared / unreadable, ⛔ not "". */
export interface ExperimentIdentity {
  commit: string | null;
  host: string | null;
  policyHash: string;
}

/** One checkpoint = one COMPLETED stage (including a smoke stage that completed with verdict "fail"). */
export interface StageCheckpoint {
  stageId: string;
  inputsHash: string;
  identity: ExperimentIdentity;
  outputs: StageOutputs;
  completedAt: string;
}

/** A refusal to reuse a checkpoint. Append-only in the carrier; the reason names the changed field. */
export interface CheckpointInvalidation {
  stageId: string;
  reason: string;
  /** The fingerprint the stale checkpoint carried (null when the field was absent). */
  wasInputsHash: string | null;
  wasIdentity: ExperimentIdentity | null;
  nowInputsHash: string;
  nowIdentity: ExperimentIdentity;
  at: string;
}

// ── State-dir layout (single definition — every path is derived here, never re-spelled) ──────────

/** The state dir ROOT (relative to the workspace root). ⛔ Deliberately outside `.quay/*.jsonl`-style
 *  single-carrier names: the state is a DIRECTORY per task, so a new experiment needs no new
 *  gitignore/registry entry (`.quay/` untracked state is already benign for the fan-in ff). */
export const EXPERIMENT_STATE_REL = path.join(".quay", "experiments");

export function experimentStateDir(root: string, experiment: string): string {
  return path.join(root, EXPERIMENT_STATE_REL, experiment);
}
export function manifestFile(stateDir: string): string {
  return path.join(stateDir, "manifest.json");
}
export function checkpointsFile(stateDir: string): string {
  return path.join(stateDir, "checkpoints.json");
}
export function invalidationsFile(stateDir: string): string {
  return path.join(stateDir, "invalidations.json");
}

// ── Fingerprints ─────────────────────────────────────────────────────────────────────────────────

/** Deterministic JSON: object keys sorted at every depth, so a re-serialized manifest hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/** The declared-policy half of the identity: the config summary, hashed. A policy change (e.g. a
 *  different MemoryMax) is an identity change, so the checkpoints taken under the old one are not reused. */
export function computePolicyHash(config: Record<string, unknown> | null | undefined): string {
  return sha256Hex(canonicalJson(config ?? null));
}

export function computeIdentity(opts: {
  commit?: string | null;
  host?: string | null;
  config?: Record<string, unknown> | null;
}): ExperimentIdentity {
  return {
    commit: opts.commit ?? null,
    host: opts.host ?? null,
    policyHash: computePolicyHash(opts.config ?? null),
  };
}

/**
 * The reason this checkpoint's identity may NOT be reused, or null when every field matches.
 * Enumeration, not a boolean (硬规则 3): the caller must be able to NAME what moved — "identity
 * changed" alone cannot be recorded in a way a reader can check.
 */
export function identityMismatch(was: ExperimentIdentity, now: ExperimentIdentity): string | null {
  const diffs: string[] = [];
  if (was.commit !== now.commit) diffs.push(`commit ${fmt(was.commit)} -> ${fmt(now.commit)}`);
  if (was.host !== now.host) diffs.push(`host ${fmt(was.host)} -> ${fmt(now.host)}`);
  if (was.policyHash !== now.policyHash) diffs.push(`policy ${was.policyHash.slice(0, 12)} -> ${now.policyHash.slice(0, 12)}`);
  return diffs.length === 0 ? null : diffs.join("; ");
}

function fmt(v: string | null): string {
  return v === null ? "(none)" : v;
}

/** The inputs hash of a stage: the manifest's shared inputs + the stage's own inputs. A change in
 *  either (e.g. the lane list) invalidates that stage's checkpoint. */
export function computeStageInputsHash(manifest: ExperimentManifest, stage: ExperimentStage): string {
  return sha256Hex(canonicalJson({ inputs: manifest.inputs, stage: stage.inputs, id: stage.id }));
}

// ── Reading the carriers (缺值 ≠ 读不懂 — 硬规则 3b) ────────────────────────────────────────────────

/** The manifest: `readable:false` means the file exists but could not be read/parsed. An ABSENT file
 *  is also not readable, and `exists:false` distinguishes "no experiment declared" from "declared but
 *  unreadable" — the caller must not treat a corrupt manifest as "nothing to resume". */
export interface ManifestReadResult {
  manifest: ExperimentManifest | null;
  exists: boolean;
  readable: boolean;
  error: string | null;
}

export function readManifest(stateDir: string): ManifestReadResult {
  const res = readJson<ExperimentManifest>(manifestFile(stateDir));
  return { manifest: res.readable ? res.value : null, exists: res.exists, readable: res.readable, error: res.error };
}

/** Checkpoints. `exists:false` = no stage has completed yet (a REAL reading); `readable:false` with
 *  `exists:true` = the carrier is there but unreadable, which is NOT the same thing and must never
 *  make the resumer conclude "nothing was paid for" silently — planResume marks every stage
 *  invalidated with `checkpoints-unreadable` and records it. */
export interface CheckpointReadResult {
  records: StageCheckpoint[];
  exists: boolean;
  readable: boolean;
  error: string | null;
}

export function readCheckpoints(stateDir: string): CheckpointReadResult {
  const res = readJson<{ records?: StageCheckpoint[] }>(checkpointsFile(stateDir));
  if (!res.exists) return { records: [], exists: false, readable: true, error: null };
  if (!res.readable) return { records: [], exists: true, readable: false, error: res.error };
  const records = Array.isArray(res.value?.records) ? res.value!.records : [];
  return { records, exists: true, readable: true, error: null };
}

function readJson<T>(file: string): { value: T | null; exists: boolean; readable: boolean; error: string | null } {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") return { value: null, exists: false, readable: true, error: null };
    return { value: null, exists: true, readable: false, error: err?.code ?? String(e) };
  }
  try {
    return { value: JSON.parse(text) as T, exists: true, readable: true, error: null };
  } catch (e) {
    return { value: null, exists: true, readable: false, error: `parse: ${(e as Error).message}` };
  }
}

/** Atomic write (tmp + rename) — delegated to the single shared implementation, so a reader (including
 *  the NEXT dispatch after a mid-write kill) never sees a torn or empty carrier. */
export function writeManifest(stateDir: string, manifest: ExperimentManifest): void {
  writeJsonAtomic(manifestFile(stateDir), manifest);
}

/** Upsert one checkpoint (keyed by stageId) — read-modify-write, atomic. */
export function writeCheckpoint(stateDir: string, checkpoint: StageCheckpoint): void {
  const current = readCheckpoints(stateDir);
  const records = current.records.filter((r) => r.stageId !== checkpoint.stageId);
  records.push(checkpoint);
  records.sort((a, b) => (a.stageId < b.stageId ? -1 : a.stageId > b.stageId ? 1 : 0));
  writeJsonAtomic(checkpointsFile(stateDir), { records });
}

export function readInvalidations(stateDir: string): CheckpointInvalidation[] {
  const res = readJson<{ records?: CheckpointInvalidation[] }>(invalidationsFile(stateDir));
  if (!res.readable) return [];
  return Array.isArray(res.value?.records) ? res.value!.records : [];
}

/** Append a refusal to the invalidations carrier (read-modify-write, atomic). ⛔ Never drops an older
 *  refusal: the record of "this was thrown away and why" is the whole reason the carrier exists. */
export function recordInvalidation(stateDir: string, record: CheckpointInvalidation): void {
  const records = readInvalidations(stateDir);
  records.push(record);
  writeJsonAtomic(invalidationsFile(stateDir), { records });
}

// ── The resume plan ──────────────────────────────────────────────────────────────────────────────

/** What the resumer decided for one stage. FOUR values, not a boolean (硬规则 3): "skip" (paid for and
 *  trusted) and "invalidated" (paid for but REFUSED) are different outcomes with different evidence,
 *  and "blocked" (never eligible: the smoke gate) is a third. */
export type StageDisposition = "run" | "skip" | "invalidated" | "blocked";

export interface StagePlanEntry {
  stageId: string;
  kind: StageKind;
  disposition: StageDisposition;
  reason: string | null;
}

export interface ResumePlan {
  entries: StagePlanEntry[];
  /** Stages that still OWE work (no trusted checkpoint — a missing one, or one this run REFUSED), in
   *  manifest order. `invalidated` is the subset whose refusal is also recorded. */
  run: string[];
  /** Paid for, identity+inputs matched ⇒ ⛔ must NOT be recomputed. */
  skip: string[];
  /** Paid for, but refused (inputs/identity/unreadable carrier) ⇒ rerun, and the refusal is recorded. */
  invalidated: { stageId: string; reason: string; checkpoint: StageCheckpoint | null }[];
  /** Owes work but is NOT eligible yet this instant (a kind:"full" stage with the smoke gate unsatisfied).
   *  A SNAPSHOT — runStages re-evaluates the gate as it walks, so a smoke stage that passes inside the
   *  same pass unblocks the full stages behind it. */
  blocked: { stageId: string; reason: string }[];
  /** False when the checkpoint carrier could not be read — every stage then reads "invalidated", and
   *  the fact that this is a NOT-EVALUATED replay (not a first run) travels with the plan. */
  checkpointsReadable: boolean;
  smoke: { required: boolean; satisfied: boolean; reason: string | null };
}

/** The smoke gate, evaluated from the checkpoints a caller currently has. Exported because runStages
 *  must re-ask it between stages (a smoke stage that passed seconds ago is not in the plan's snapshot). */
export function smokeGate(
  manifest: ExperimentManifest,
  checkpoints: CheckpointReadResult,
  identity: ExperimentIdentity,
): { required: boolean; satisfied: boolean; reason: string | null } {
  const byId = new Map<string, StageCheckpoint>();
  for (const r of checkpoints.records) byId.set(r.stageId, r);
  const smokeStages = manifest.stages.filter((s) => s.kind === "smoke");
  let satisfied = false;
  let reason: string | null = null;
  for (const s of smokeStages) {
    const cp = byId.get(s.id);
    if (!cp || !checkpoints.readable) continue;
    if (computeStageInputsHash(manifest, s) !== cp.inputsHash) continue;
    if (identityMismatch(cp.identity, identity) !== null) continue;
    if (cp.outputs.verdict === "pass") {
      satisfied = true;
      break;
    }
    reason = `smoke stage ${s.id} completed with verdict fail${cp.outputs.note ? ` (${cp.outputs.note})` : ""}`;
  }
  const required = smokeStages.length > 0;
  if (required && !satisfied && reason === null) {
    reason = `no passing smoke stage yet (${smokeStages.map((s) => s.id).join(", ")})`;
  }
  return { required, satisfied, reason };
}

/**
 * Decide, per stage, whether it is already paid for. PURE — it reads nothing and writes nothing; the
 * caller passes the already-read carriers, so the same inputs always yield the same plan (and the
 * fixture can drive it without touching a disk).
 *
 * Order of judgment per stage (each earlier one wins, so the reason names the FIRST thing that moved):
 *   1. carrier unreadable          ⇒ invalidated (checkpoints-unreadable)
 *   2. no checkpoint               ⇒ run (first time this stage is executed)
 *   3. inputs hash differs         ⇒ invalidated (inputs-changed)
 *   4. identity differs            ⇒ invalidated (identity-changed)
 *   5. otherwise                   ⇒ skip
 * The smoke gate is reported SEPARATELY (blocked = the subset of `run` that is kind:"full" while the
 * gate is unsatisfied) rather than folded into the dispositions: a stage that owes work still owes it
 * after the smoke stage passes, and a disposition that expired mid-walk would be a lie.
 */
export function planResume(opts: {
  manifest: ExperimentManifest;
  checkpoints: CheckpointReadResult;
  identity: ExperimentIdentity;
}): ResumePlan {
  const { manifest, checkpoints, identity } = opts;
  const byId = new Map<string, StageCheckpoint>();
  for (const r of checkpoints.records) byId.set(r.stageId, r);
  const smoke = smokeGate(manifest, checkpoints, identity);

  const entries: StagePlanEntry[] = [];
  const run: string[] = [];
  const skip: string[] = [];
  const invalidated: { stageId: string; reason: string; checkpoint: StageCheckpoint | null }[] = [];
  const blocked: { stageId: string; reason: string }[] = [];

  for (const stage of manifest.stages) {
    const cp = byId.get(stage.id) ?? null;
    const push = (disposition: StageDisposition, reason: string | null): void => {
      entries.push({ stageId: stage.id, kind: stage.kind, disposition, reason });
    };
    if (checkpoints.exists && !checkpoints.readable) {
      const reason = `checkpoints-unreadable: ${checkpoints.error ?? "unknown"}`;
      invalidated.push({ stageId: stage.id, reason, checkpoint: cp });
      run.push(stage.id);
      push("invalidated", reason);
      continue;
    }
    if (cp === null) {
      run.push(stage.id);
      if (stage.kind === "full" && smoke.required && !smoke.satisfied) {
        blocked.push({ stageId: stage.id, reason: smoke.reason ?? "smoke-not-passed" });
        push("blocked", smoke.reason);
      } else {
        push("run", "no checkpoint");
      }
      continue;
    }
    const inputsHash = computeStageInputsHash(manifest, stage);
    if (cp.inputsHash !== inputsHash) {
      const reason = `inputs-changed: ${cp.inputsHash.slice(0, 12)} -> ${inputsHash.slice(0, 12)}`;
      invalidated.push({ stageId: stage.id, reason, checkpoint: cp });
      run.push(stage.id);
      push("invalidated", reason);
      continue;
    }
    const mismatch = identityMismatch(cp.identity, identity);
    if (mismatch !== null) {
      const reason = `identity-changed: ${mismatch}`;
      invalidated.push({ stageId: stage.id, reason, checkpoint: cp });
      run.push(stage.id);
      push("invalidated", reason);
      continue;
    }
    skip.push(stage.id);
    push("skip", "checkpoint trusted (inputs + identity match)");
  }

  return {
    entries,
    run,
    skip,
    invalidated,
    blocked,
    checkpointsReadable: checkpoints.readable,
    smoke,
  };
}

// ── Walking the plan (ONE synchronous pass; no loop, no timer, no scheduler) ─────────────────────

export type StageExecutor = (stage: ExperimentStage, ctx: { manifest: ExperimentManifest; stateDir: string }) => StageOutputs;

export interface ExperimentRunReport {
  ran: string[];
  skipped: string[];
  invalidated: { stageId: string; reason: string }[];
  blocked: { stageId: string; reason: string }[];
  smoke: ResumePlan["smoke"];
}

/**
 * Walk the stages that owe work ONCE, synchronously, checkpointing after each. Any throw from
 * `execute` (a driver restart killing the process, a Ctrl-C, a stage that explodes) propagates — and
 * every stage that COMPLETED before the throw already has its checkpoint on disk, while the
 * interrupted stage has none, so the next dispatch re-runs exactly the remainder. ⛔ No try/catch:
 * swallowing the interruption here would turn "the experiment died mid-stage" into "the experiment
 * finished" — the exact confusion this capability exists to remove.
 *
 * Two orderings are load-bearing:
 *   • A refusal (invalidated) is recorded BEFORE its stage re-runs, so a crash during the re-run still
 *     leaves the fact that the old checkpoint was discarded.
 *   • The SMOKE GATE is re-asked before every kind:"full" stage, reading the checkpoints from disk —
 *     a snapshot taken at entry would leave the full stages blocked for the whole pass after the smoke
 *     stage they depend on had just passed, and the experiment would need a second invocation to make
 *     any progress (the "always one step short" shape, 硬规则 12). A smoke stage that fails leaves the
 *     full stages in `blocked` and is NOT retried, so the expensive work is never reached.
 */
export function runStages(opts: {
  manifest: ExperimentManifest;
  stateDir: string;
  identity: ExperimentIdentity;
  execute: StageExecutor;
  /** Test seam for the clock (⛔ production never passes it). */
  nowMs?: () => number;
}): ExperimentRunReport {
  const { manifest, stateDir, identity, execute } = opts;
  const nowMs = opts.nowMs ?? (() => Date.now());
  const plan = planResume({ manifest, checkpoints: readCheckpoints(stateDir), identity });

  for (const inv of plan.invalidated) {
    const stage = manifest.stages.find((s) => s.id === inv.stageId);
    recordInvalidation(stateDir, {
      stageId: inv.stageId,
      reason: inv.reason,
      wasInputsHash: inv.checkpoint?.inputsHash ?? null,
      wasIdentity: inv.checkpoint?.identity ?? null,
      nowInputsHash: stage ? computeStageInputsHash(manifest, stage) : "",
      nowIdentity: identity,
      at: new Date(nowMs()).toISOString(),
    });
  }

  const ran: string[] = [];
  const blocked: { stageId: string; reason: string }[] = [];
  for (const stage of manifest.stages) {
    if (!plan.run.includes(stage.id)) continue;
    if (stage.kind === "full") {
      const gate = smokeGate(manifest, readCheckpoints(stateDir), identity);
      if (gate.required && !gate.satisfied) {
        blocked.push({ stageId: stage.id, reason: gate.reason ?? "smoke-not-passed" });
        continue;
      }
    }
    const startedMs = nowMs();
    const outputs = execute(stage, { manifest, stateDir });
    const completedAt = new Date(nowMs()).toISOString();
    writeCheckpoint(stateDir, {
      stageId: stage.id,
      inputsHash: computeStageInputsHash(manifest, stage),
      identity,
      outputs: { ...outputs, wallMs: outputs.wallMs > 0 ? outputs.wallMs : nowMs() - startedMs },
      completedAt,
    });
    ran.push(stage.id);
  }

  return {
    ran,
    skipped: [...plan.skip],
    invalidated: plan.invalidated.map(({ stageId, reason }) => ({ stageId, reason })),
    blocked,
    // The FINAL gate reading, not the entry snapshot: after the walk the reader needs to know whether
    // the smoke stage the full stages depend on ended up passing (⛔ an entry snapshot would report
    // "not satisfied" for a pass that happened three lines later).
    smoke: smokeGate(manifest, readCheckpoints(stateDir), identity),
  };
}

// ── Identity resolution for the CLI ──────────────────────────────────────────────────────────────

/** The commit at `root` (null = not a git repo / git unavailable — 硬规则 3b, ⛔ never ""). */
export function resolveCommit(root: string): string | null {
  const r = git(["rev-parse", "HEAD"], root);
  if (!r.ok) return null;
  return r.stdout === "" ? null : r.stdout;
}

/** The host identity a checkpoint is bound to. `os.hostname()` is the same direct reading
 *  cross-machine-verify.ts uses; a checkpoint taken on another host is NOT reused here. */
export function resolveHost(): string | null {
  const h = os.hostname();
  return h && h.trim() !== "" ? h.trim() : null;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

/** `--run`'s default executor: run the stage's declared argv SYNCHRONOUSLY, in the foreground, and
 *  read back the measurement JSON if the stage declared one. ⛔ One child at a time, awaited by the
 *  caller's own turn — this is what keeps the experiment inside the normal worker process (visible in
 *  worker-round observability, stoppable by the per-kind/worker stop path) instead of in a second loop. */
export function spawnStageExecutor(): StageExecutor {
  return (stage, ctx) => {
    const outDir = path.isAbsolute(ctx.manifest.outputDir)
      ? ctx.manifest.outputDir
      : path.resolve(ctx.stateDir, ctx.manifest.outputDir);
    fs.mkdirSync(outDir, { recursive: true });
    const startedMs = Date.now();
    const r = spawnSync(stage.command[0] ?? "", stage.command.slice(1), {
      cwd: outDir,
      stdio: "inherit",
      env: { ...process.env, QUAY_EXPERIMENT_STAGE: stage.id, QUAY_EXPERIMENT_OUT: outDir },
    });
    const wallMs = Date.now() - startedMs;
    // The measurement file is OPTIONAL: absent / unreadable ⇒ every numeric field stays null
    // (硬规则 3b — an unread counter is not a measured zero).
    let measured: Record<string, unknown> | null = null;
    if (stage.measurementFile) {
      const mf = path.resolve(outDir, stage.measurementFile);
      try {
        measured = JSON.parse(fs.readFileSync(mf, "utf8")) as Record<string, unknown>;
      } catch {
        measured = null;
      }
    }
    const num = (k: string): number | null => {
      const v = measured?.[k];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    const artifacts = stage.expectedArtifacts
      .map((a) => path.resolve(outDir, a))
      .filter((a) => fs.existsSync(a));
    return {
      artifacts,
      filesPlanned: num("files_planned"),
      oomKill: num("oom_kill"),
      peakRssBytes: num("peak_rss_bytes"),
      wallMs,
      verdict: r.status === 0 ? "pass" : "fail",
      note: r.status === 0 ? null : `command exited ${r.status ?? `signal ${r.signal}`}`,
    };
  };
}

export function main(argv: string[]): number {
  const task = flagValue(argv, "--task") ?? null;
  const root = flagValue(argv, "--root") ?? process.cwd();
  const wantJson = argv.includes("--json");
  const wantRun = argv.includes("--run");
  if (!task) {
    process.stderr.write("experiment-manifest: --task <id> is required\n");
    return 2;
  }
  const stateDir = experimentStateDir(root, task);
  const res = readManifest(stateDir);
  if (!res.exists) {
    process.stderr.write(`experiment-manifest: no manifest at ${manifestFile(stateDir)} — this task declares no resumable experiment\n`);
    return 3;
  }
  if (!res.readable || !res.manifest) {
    process.stderr.write(`experiment-manifest: manifest at ${manifestFile(stateDir)} is present but NOT READABLE (${res.error}) — refusing to plan a resume against it\n`);
    return 3;
  }
  const manifest = res.manifest;
  // `--measure-root` = the tree the experiment MEASURES (the worker's worktree / task branch); `--root`
  // = the workspace the STATE lives in (the durable main checkout). Binding the identity to `--root`
  // would invalidate every checkpoint each time an unrelated task's fan-in fast-forwards develop —
  // an experiment that can never finish (硬规则 12). They coincide when the experiment runs in the
  // workspace itself.
  const measureRoot = flagValue(argv, "--measure-root") ?? root;
  const identity = computeIdentity({
    commit: flagValue(argv, "--commit") ?? resolveCommit(measureRoot),
    host: flagValue(argv, "--host") ?? resolveHost(),
    config: manifest.config,
  });
  const plan = planResume({ manifest, checkpoints: readCheckpoints(stateDir), identity });

  if (wantRun) {
    const report = runStages({ manifest, stateDir, identity, execute: spawnStageExecutor() });
    process.stdout.write(`${JSON.stringify({ identity, report }, null, 2)}\n`);
    return report.blocked.length > 0 && report.ran.length === 0 ? 1 : 0;
  }

  if (wantJson) {
    process.stdout.write(`${JSON.stringify({ identity, plan }, null, 2)}\n`);
  } else {
    process.stdout.write(`experiment-manifest: ${manifest.experiment} — identity commit=${fmt(identity.commit)} host=${fmt(identity.host)} policy=${identity.policyHash.slice(0, 12)}\n`);
    for (const e of plan.entries) {
      process.stdout.write(`  [${e.disposition}] ${e.stageId} (${e.kind})${e.reason ? ` — ${e.reason}` : ""}\n`);
    }
    process.stdout.write(`  => run ${plan.run.length} / skip ${plan.skip.length} / invalidated ${plan.invalidated.length} / blocked ${plan.blocked.length}\n`);
  }
  return 0;
}

/** Expected basename for the direct-entry guard (name-based, never URL-based — see gate-script-base). */
export const ENTRY_BASE = "experiment-manifest";

if (isDirectEntry(import.meta, process.argv[1], ENTRY_BASE)) process.exit(main(process.argv.slice(2)));
