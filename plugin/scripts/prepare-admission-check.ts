// prepare-admission-check.ts — M200/DIR-126-A: single-flight admission for prepare-milestone.js.
// First child of DIR-126's 5-way split (`split-subsystem-blocking-cluster`, M199/DIR-126's real
// ProposalReview run). Closes the concrete overlap DIR-126's own Finding measured (two M196
// generations for the same task overlapped, adding ~54 duplicate workflow-minutes,
// `tasks/DIR-126.md:86`) — `prepare-milestone.js` has no admission/ownership check today
// (confirmed: `grep -n "fs\.\|^import\|require("` on it returns zero matches).
//
// Exports pure-ish decision functions (`acquireLease`/`renewLease`/`releaseLease`/
// `checkStaleOwner`) with `fs` I/O isolated inside them (same "pure decision + thin CLI" shape as
// `milestone-preparation-check.ts`'s `buildReceipt`/`computeCurrentHashes`), plus a CLI wrapper
// (`--acquire`/`--renew`/`--release`/`--force-release <reason>`) invoked by `prepare-milestone.js`'s
// new `Admission` phase via an `agent()`-dispatched shell command (the workflow DSL has no `fs`/
// import capability of its own — same dispatch shape `wiring-coverage-check.ts` already uses).
//
// Lease primitive: `fs.writeFileSync(path, json, {flag:'wx'})` (Node's atomic exclusive-create,
// throws EEXIST on contention) — the real, live precedent in this repo is
// `packages/quay/src/frontmatter-store-base.ts`'s `withFileLock()` and
// `packages/quay-native/src/store.ts`'s `acquireLock`/`releaseLock`/`withLock`, NOT
// `gate-event-store.ts`'s `appendGateEvent()` (confirmed plain `appendFileSync`-only, not a `wx`
// precedent). Deliberately re-implemented locally rather than imported from
// `packages/quay/src/frontmatter-store-base.ts`, to avoid a new `experiments/` -> `packages/`
// dependency edge for a ~10-line primitive (task's own Non-goals / Alternatives-rejected #4).
//
// Lease record shape maps 1:1 onto DIR-124's real field vocabulary from
// `docs/proposals/quay-milestone-workflow-stage-pipelining-and-leases.md` §6.3: `key,
// ownerExecutionId, attempt, stage, fencingToken, baseCommit, acquiredAt, leaseUntil, heartbeatAt`
// (plus `highRisk`/`recoveredFrom`, additive fields needed by this prototype's renew/reclaim logic,
// not a departure from that vocabulary). Lease lives at a gitignored path,
// `.quay/prepare-leases/<taskId>.json` — pure local runtime-mutex state, matching CLAUDE.md's
// DIR-027 single-shared-working-tree-on-`master` assumption (not a distributed lock).
//
// `ownerExecutionId` is the real, harness-verified `$CLAUDE_CODE_SESSION_ID` — unlike every OTHER
// agent-dispatch in `prepare-milestone.js` (which cannot read `process.env` and must ask an agent
// to `echo $CLAUDE_CODE_SESSION_ID` and report it back), this module's CLI is itself invoked as a
// real shell command inside the SAME agent's own turn, so its Node process genuinely inherits the
// shell environment and reads `process.env.CLAUDE_CODE_SESSION_ID` directly — fail-closed
// (`missing-session-id`) if unset, never a caller-asserted placeholder.

import fs from "node:fs";
import path from "node:path";
import { parseArgs, isDirectEntry } from "./gate-script-base.ts";

// ── Staleness window — derived (Proposal's "Staleness-window default" table), not asserted. ───────
// ProposalReview soft budget (45m/75m) + PlanAuthor allowance (~20m) + up to 3 safety-margined
// PlanCheck rounds (~210m, unconditional on highRisk per `MAX_PLANCHECK_ROUNDS = 3`) + Receipt
// buffer (~10m) = 285m raw, rounded to 300m ordinary / 315m raw rounded up to 360m highRisk for
// extra headroom. A real named constant, not an inline literal at each call site.
export const DEFAULT_STALENESS_MS = { ordinary: 300 * 60 * 1000, highRisk: 360 * 60 * 1000 };

function stalenessMsFor(highRisk) {
  return highRisk ? DEFAULT_STALENESS_MS.highRisk : DEFAULT_STALENESS_MS.ordinary;
}

function leaseDir(workspace) {
  return path.join(workspace, ".quay", "prepare-leases");
}
// Defensive: a taskId is always a plain id in real production use (e.g. "DIR-126-A"), but a test
// fixture or a future caller could pass something path-like — never let taskId escape leaseDir via
// a path separator (no `..`/`/`/`\` traversal out of `.quay/prepare-leases/`).
function safeTaskIdSegment(taskId) {
  return String(taskId).replace(/[\\/]/g, "_");
}
function leasePath(workspace, taskId) {
  return path.join(leaseDir(workspace), `${safeTaskIdSegment(taskId)}.json`);
}
function auditPath(workspace, taskId) {
  return path.join(leaseDir(workspace), `${safeTaskIdSegment(taskId)}.audit.jsonl`);
}
function leaseKey(workspace, taskId) {
  return `${workspace}::${taskId}`;
}

function _readLease(workspace, taskId) {
  const p = leasePath(workspace, taskId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function _writeLeaseOverwrite(workspace, taskId, record) {
  fs.mkdirSync(leaseDir(workspace), { recursive: true });
  fs.writeFileSync(leasePath(workspace, taskId), JSON.stringify(record, null, 2));
}
function _appendAudit(workspace, taskId, record) {
  fs.mkdirSync(leaseDir(workspace), { recursive: true });
  fs.appendFileSync(auditPath(workspace, taskId), JSON.stringify(record) + "\n");
}

function _grantLeaseAtomic({ workspace, taskId, highRisk, stage, baseCommit, ownerExecutionId, now }) {
  const record = {
    key: leaseKey(workspace, taskId),
    ownerExecutionId,
    attempt: 1,
    stage: stage || "Admission",
    fencingToken: 0,
    baseCommit: baseCommit || null,
    acquiredAt: now,
    leaseUntil: now + stalenessMsFor(highRisk),
    heartbeatAt: now,
    highRisk: !!highRisk,
    recoveredFrom: null,
  };
  fs.mkdirSync(leaseDir(workspace), { recursive: true });
  // The atomic-create primitive: throws EEXIST if a lease already exists — this IS the single-
  // flight mechanism (two real OS processes racing this same call, only one wins).
  fs.writeFileSync(leasePath(workspace, taskId), JSON.stringify(record, null, 2), { flag: "wx" });
  return { outcome: "acquired", lease: record, reclaimed: false };
}

function _grantLeaseReclaim({ workspace, taskId, highRisk, stage, baseCommit, ownerExecutionId, now, priorLease }) {
  const record = {
    key: leaseKey(workspace, taskId),
    ownerExecutionId,
    attempt: (priorLease?.attempt || 0) + 1,
    stage: stage || "Admission",
    fencingToken: (priorLease?.fencingToken || 0) + 1,
    baseCommit: baseCommit || null,
    acquiredAt: now,
    leaseUntil: now + stalenessMsFor(highRisk),
    heartbeatAt: now,
    highRisk: !!highRisk,
    // Copies the prior lease's full contents VERBATIM — never silently discarded. This is the
    // evidence a "Lease recovery is fail-closed" AC/fixture checks for.
    recoveredFrom: priorLease,
  };
  _writeLeaseOverwrite(workspace, taskId, record);
  return { outcome: "acquired", lease: record, reclaimed: true };
}

// ── checkStaleOwner — the deterministic reclaim decision. Given an EXISTING lease (already read
// by the caller) and `now`, either rejects (lease still held, non-expired -> 'prepare-already-
// running') or reclaims (lease expired -> new owner granted, `recoveredFrom` + `fencingToken`
// bumped, an audit-trail record written for the superseded lease with releaseMethod:'stale-
// reclaim' — the SAME releaseMethod-tagged shape every release path writes, per WIRING-CLAIM 4). ──
export function checkStaleOwner({ workspace, taskId, existingLease, now, highRisk, stage, baseCommit, ownerExecutionId }) {
  if (!existingLease) {
    return _grantLeaseReclaim({ workspace, taskId, highRisk, stage, baseCommit, ownerExecutionId, now, priorLease: null });
  }
  if (now <= existingLease.leaseUntil) {
    // Active, non-expired owner — cannot be stolen. A distinct verdict, never a silent success.
    return {
      outcome: "prepare-already-running",
      owner: {
        ownerExecutionId: existingLease.ownerExecutionId,
        acquiredAt: existingLease.acquiredAt,
        leaseUntil: existingLease.leaseUntil,
        stage: existingLease.stage,
      },
    };
  }
  // now > leaseUntil: stale. Reclaim deterministically — this SAME path covers both a genuinely
  // dead owner (advanced-clock fixture) and a crashed one that never called --release (no
  // permanent lockout — recoverable on the next dispatch via this identical branch, no special-
  // cased "crash" logic needed).
  _appendAudit(workspace, taskId, {
    releaseMethod: "stale-reclaim",
    releasedAt: now,
    reason: `stale-owner reclaimed (now=${now} > leaseUntil=${existingLease.leaseUntil})`,
    lease: existingLease,
  });
  return _grantLeaseReclaim({ workspace, taskId, highRisk, stage, baseCommit, ownerExecutionId, now, priorLease: existingLease });
}

// ── acquireLease — the single entrypoint the Admission phase's `--acquire` CLI mode calls. ────────
export function acquireLease({ workspace, taskId, highRisk = false, stage = "Admission", baseCommit = null, now, ownerExecutionId }) {
  if (!ownerExecutionId) {
    const err = new Error("missing-session-id: ownerExecutionId (CLAUDE_CODE_SESSION_ID) is required and was not provided");
    err.code = "missing-session-id";
    throw err;
  }
  if (!Number.isFinite(now)) {
    const err = new Error("missing-now: a real epoch-ms `now` is required (workflow scripts cannot call Date.now(); this CLI computes it itself when run directly)");
    err.code = "missing-now";
    throw err;
  }
  try {
    return _grantLeaseAtomic({ workspace, taskId, highRisk, stage, baseCommit, ownerExecutionId, now });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const existing = _readLease(workspace, taskId);
    return checkStaleOwner({ workspace, taskId, existingLease: existing, now, highRisk, stage, baseCommit, ownerExecutionId });
  }
}

// ── renewLease — dispatched at every phase boundary (Admission->Adjudicate/ProposalReview, each
// ProposalReview delta round, PlanAuthor, each PlanCheck round, Receipt: 6 boundaries) to extend
// `leaseUntil` before it can expire mid-generation. ─────────────────────────────────────────────
export function renewLease({ workspace, taskId, stage, now }) {
  const existing = _readLease(workspace, taskId);
  if (!existing) return { ok: false, error: "lease-missing" };
  if (!Number.isFinite(now)) return { ok: false, error: "missing-now" };
  const updated = { ...existing, stage: stage || existing.stage, heartbeatAt: now, leaseUntil: now + stalenessMsFor(existing.highRisk) };
  _writeLeaseOverwrite(workspace, taskId, updated);
  return { ok: true, lease: updated };
}

// ── releaseLease — the shared release primitive for BOTH `--release` (normal, called before every
// post-Admission terminal `return` in prepare-milestone.js) and `--force-release <reason>` (human
// escape hatch against a still-active, non-expired lease). Every call writes the SAME
// releaseMethod-tagged audit record — 'normal' | 'force-release' | 'stale-reclaim' (the latter
// written by checkStaleOwner above) — so a force-release is always distinguishable after the fact
// from an ordinary automatic reclaim. Never a silent unlock. ──────────────────────────────────────
export function releaseLease({ workspace, taskId, method = "normal", reason = null, now }) {
  const existing = _readLease(workspace, taskId);
  if (!existing) return { ok: false, error: "lease-missing" };
  _appendAudit(workspace, taskId, { releaseMethod: method, releasedAt: now, reason, lease: existing });
  fs.rmSync(leasePath(workspace, taskId), { force: true });
  return { ok: true, releaseMethod: method };
}

// ── Exposed for tests/fixtures (not part of the CLI contract). ─────────────────────────────────────
export const _internal = { leaseDir, leasePath, auditPath, leaseKey, stalenessMsFor, _readLease };

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
async function main(argv) {
  const spec = {
    usage: "(--acquire|--renew|--release|--force-release <reason>) --taskId <id> --workspace <dir> [--highRisk] [--stage <name>] [--baseCommit <sha>] [--reason <text>]",
    minArgs: 0,
    flags: {
      acquire: { type: "boolean" },
      renew: { type: "boolean" },
      release: { type: "boolean" },
      "force-release": { type: "string" },
      taskId: { type: "string" },
      workspace: { type: "string" },
      highRisk: { type: "boolean" },
      stage: { type: "string" },
      baseCommit: { type: "string" },
      reason: { type: "string" },
    },
  };
  const parsed = parseArgs(argv, spec);
  const taskId = parsed.flags.taskId;
  const workspace = parsed.flags.workspace;
  if (!taskId || !workspace) {
    console.error(`usage: node prepare-admission-check.ts ${spec.usage}`);
    return 2;
  }
  const mode = parsed.flags.acquire
    ? "acquire"
    : parsed.flags.renew
      ? "renew"
      : parsed.flags.release
        ? "release"
        : typeof parsed.flags["force-release"] === "string"
          ? "force-release"
          : null;
  if (!mode) {
    console.error(`usage: node prepare-admission-check.ts ${spec.usage}`);
    return 2;
  }
  const now = Date.now();
  try {
    if (mode === "acquire") {
      const ownerExecutionId = process.env.CLAUDE_CODE_SESSION_ID;
      if (!ownerExecutionId) {
        console.log(JSON.stringify({ outcome: "error", code: "missing-session-id", message: "CLAUDE_CODE_SESSION_ID is not set in this process environment" }));
        return 2;
      }
      const result = acquireLease({
        workspace, taskId,
        highRisk: parsed.flags.highRisk === true,
        stage: parsed.flags.stage || "Admission",
        baseCommit: parsed.flags.baseCommit || null,
        now, ownerExecutionId,
      });
      console.log(JSON.stringify(result));
      return result.outcome === "acquired" ? 0 : 1;
    }
    if (mode === "renew") {
      const result = renewLease({ workspace, taskId, stage: parsed.flags.stage, now });
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }
    if (mode === "release") {
      const result = releaseLease({ workspace, taskId, method: "normal", reason: parsed.flags.reason || null, now });
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }
    // mode === 'force-release'
    const reason = parsed.flags["force-release"];
    if (!reason) {
      console.error("ERROR: --force-release requires a <reason>");
      return 2;
    }
    const result = releaseLease({ workspace, taskId, method: "force-release", reason, now });
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch (err) {
    console.log(JSON.stringify({ outcome: "error", code: err.code || "admission-check-failed", message: err.message }));
    return 2;
  }
}

if (isDirectEntry(import.meta)) {
  main(process.argv).then((code) => process.exit(code));
}
