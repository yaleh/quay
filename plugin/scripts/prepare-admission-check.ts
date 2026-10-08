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
//
// SHALLOW-CLONE BEHAVIOR (2026-08-03, CI red): the precedent/stale-AC checks ask git
// (`git cat-file -e <sha>^{commit}`) whether a cited commit exists in the WORKSPACE. In a shallow
// clone (actions/checkout default depth-1), old commits are absent → EVERY real precedent is judged
// missing. Both codes are PREFLIGHT_CALIBRATED false (non-blocking, record-only), so the production
// impact is log noise, not blocked work — but a `missing-precedent`/`stale-ac-refs` finding under a
// shallow clone does NOT mean the precedent is really missing; re-run on a full clone to confirm.
// Tests must not cite this repo's real history (hermetic temp-repo fixtures instead, see
// plugin/test/prepare-admission-check.test.mjs makeGitWorkspaceWithCommit).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs, isDirectEntry } from "./gate-script-base.ts";
import { extractSection, checkTouches, countBoxes } from "./task-schema.ts";
// SINGLE-SOURCE (gap-task-body-has-n-parsers-and-no-authority): the ONE Touches bullet parser.
import { parseTouchEntries } from "./touches-parser.ts";
import { splitSentences } from "./wiring-coverage-check.ts";
// parsePlanStages / validatePlanStructure are inlined below (retired from
// ./milestone-preparation-check.ts at gap-retire-the-prepare-execute-pipeline-cluster).

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
//
// SINGLE SOURCE (gap-routine-semantic-dedup-scan-safe-task-id-segment): the ONE taskId-to-path-
// segment sanitizer for the whole `.quay/prepare-*` lease-path family. proposal-convergence.ts
// imports THIS function rather than holding its own private copy — the two copies were byte-
// identical (both `String(taskId).replace(/[\\/]/g, "_")`) while their comments each claimed
// verbatim reuse, so a change to the traversal guard here would have silently missed every lease/
// checkpoint/epoch/telemetry path over there. Keep exactly one definition; extend this one.
export function safeTaskIdSegment(taskId) {
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

// ── _readLeaseFileWithRetry — gap-prepare-milestone-lease-read-race (M203/DIR-126-D): a bounded,
// documented resilience measure against a REAL, twice-observed condition where a real
// `Workflow({scriptPath:'.claude/workflows/prepare-milestone.js'})` dispatch's own SUBSEQUENT
// `agent()`-dispatched subprocess ENOENT'd reading this exact path moments after the
// immediately-preceding subprocess (a SEPARATE OS process — this repo's own sandboxed-workflow-
// dispatches-real-subprocess architecture) reported writing it successfully
// (`milestones/M203/telemetry-real-journal-proof.md`, occurrences on `wf_49d73fc5-782` and
// `wf_7caf2523-9c0`). A direct manual reproduction attempt (the same two CLI calls run back-to-back
// in one shell, one process) did NOT reproduce it — so this is treated as a plausible cross-
// subprocess filesystem-visibility gap specific to the real `agent()` dispatch environment, not a
// located defect in this file's own read/write ordering (no missing `fsync`/caching layer was
// found: `fs.writeFileSync` here has no `{flush:false}`-style opt-out, and Node's `fs` sync API
// offers no cross-process durability primitive beyond what `writeFileSync` already does) — so this
// is a bounded, documented retry (the task's own Requested-action option 3), not a fix to a
// pinpointed root cause.
//
// Retries ONLY `ENOENT` (any other error — `EACCES`, a downstream `JSON.parse` `SyntaxError`, etc.
// — propagates immediately, unretried, so a genuinely malformed lease file is never masked as
// "missing"). A FIXED, bounded number of extra attempts (`LEASE_READ_RETRY_ATTEMPTS`, currently 3 —
// "one immediate re-read on ENOENT" per the task's own wording, widened from a single retry to a
// short backed-off series after real local reproduction showed a single fixed 20ms gap alone is not
// always enough margin under load; still a small, fixed bound, never unbounded/never a polling loop)
// with a short real sleep between attempts (`Atomics.wait` on a throwaway `SharedArrayBuffer` — the
// only synchronous sleep primitive available in a `.ts` CLI script without spawning a subprocess).
// Total worst-case added latency across all retries is on the order of ~150ms — negligible next to
// the multi-second/-minute real agent() dispatches this sits between. A genuinely-missing lease (no
// lease ever acquired, or one already legitimately released) still ends up `ENOENT` after this
// bounded window, so callers' existing missing-lease semantics (`_readLease` -> `null`,
// `_decideResumeCli` -> `decision-exception`, `renewLease`/`releaseLease` -> `{ok:false,
// error:'lease-missing'}`) stay intact — never masked into a false "found", never an unbounded retry.
const LEASE_READ_RETRY_DELAYS_MS = [20, 40, 80];
function _syncSleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
export function _readLeaseFileWithRetry(p) {
  for (let i = 0; i < LEASE_READ_RETRY_DELAYS_MS.length; i++) {
    try {
      return fs.readFileSync(p, "utf8");
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      _syncSleepMs(LEASE_READ_RETRY_DELAYS_MS[i]);
    }
  }
  return fs.readFileSync(p, "utf8"); // last attempt — a still-missing file propagates ENOENT here
}

function _readLease(workspace, taskId) {
  const p = leasePath(workspace, taskId);
  try {
    return JSON.parse(_readLeaseFileWithRetry(p));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── Preflight — M201/DIR-126-B: deterministic mechanical rejection of five recurring
// prepare-milestone failure classes, dispatched BEFORE any expensive LLM content-generation/review
// agent — second child of DIR-126's 5-way split, sharing THIS module (not a new script) with
// DIR-126-A's admission/lease primitives above. See tasks/DIR-126-B.md's `## Proposal` /
// docs/plans/M201-dir-126-b.md for the full design; this block implements the "Chosen mechanism"
// table's five named detectors plus the `runPreflightChecks` entry point both new CLI modes call.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// A plain, manually-bumped literal (not a source-derived hash) — the task's own Chosen-mechanism
// decision: simpler and less fragile than a content hash nothing else in this file family computes
// today. Bump this whenever a detector's blocking boundary changes; DIR-126-C consumes it for cache
// invalidation (this child only emits it).
export const PREFLIGHT_POLICY_VERSION = "preflight-v1";

// Calibrate-then-enforce (task's own "Repair/calibrate before fail-closed activation" AC): a
// detector's `blocking:true` verdict is only actually ENFORCED once its own known-bad/known-good/
// ambiguous-valid fixture triad is green — see prepare-admission-check.test.mjs's `describe('...
// calibration')` block. A `false` entry here still runs its detector and still reports the finding
// (logged, non-blocking) — never silently skipped — matching the "partially-calibrated detector
// set... still lands" design decision.
//
// `preflight-stale-ac-refs`/`preflight-missing-precedent` downgraded to `false` (2026-07-29, THREE
// independent adversarial audit rounds, M201/DIR-126-B): each round found a NEW real false-positive
// class in these two detectors specifically — round 1: bare filenames not at the repo root; round
// 2's own fix: a directory-qualified-but-fabricated path slipping through via an unconditional
// basename match, AND a file the task's own Touches declares as future work being misread as a
// stale precedent (round 2 fixed both, but introduced a narrower regression restricting the
// basename fallback too far — directory-qualified-but-SHORTENED real paths, e.g.
// `` `scripts/foo.sh` `` for the real `` `experiments/quay-perpetual-stream/scripts/foo.sh` ``, no
// longer resolve); round 3: a live, currently-blocking case on a real open task
// (`` `iteration-N.md` ``, a generic placeholder, not a literal file — the SAME class DIR-126-B's
// own AC text already had to work around once, per the Touches-membership check's own trailing-prose
// gap) plus a distinct commit-hash-vs-session-id collision. Regex-based exact-resolution matching
// against this repo's organically-varied, ever-growing task-prose corpus cannot be made
// false-positive-free by iterating individual shapes — each fix closes known cases and can miss or
// reopen others. Per this task's OWN "Repair/calibrate before fail-closed activation" AC and this
// exact `PREFLIGHT_CALIBRATED` mechanism's stated purpose, these two detectors' blocking boundary is
// NOT proven safe against real content after three independent audit attempts, so they run
// non-blocking/logged-only — real findings are still surfaced for a human/reviewer to see, never
// silently dropped, but never wrongly reject a genuinely valid task before an author agent runs.
// The other three detectors (merged-markdown-claims, touches-mismatch, invalid-plan-command) held
// up across all three audit rounds with zero real false positives found — stay `true`.
export const PREFLIGHT_CALIBRATED = {
  "preflight-merged-markdown-claims": true,
  "preflight-stale-ac-refs": false,
  "preflight-touches-mismatch": true,
  "preflight-missing-precedent": false,
  "preflight-invalid-plan-command": true,
};

function _ambiguousCode(baseCode) {
  return `preflight-ambiguous-${baseCode.replace(/^preflight-/, "")}`;
}

function _mkFinding(code, blocking, message, evidence, disposition) {
  return { code, blocking, subsystem: "preflight", message, evidence, disposition, policyVersion: PREFLIGHT_POLICY_VERSION };
}

// ── shared: commit-hash-shaped / file-path-shaped backtick-token resolution. Used by BOTH
// preflight-stale-ac-refs (AC/DoD section) and preflight-missing-precedent (Finding/Requested
// action/Proposal) — the SAME mechanical resolution primitive, applied to different sections, per
// this module's own "reuse, never re-derive" discipline (the same posture wiring-coverage-check.ts
// documents for its own single-implementation-two-callers shape). ──────────────────────────────────
const _COMMIT_HASH_RE = /^[0-9a-f]{7,40}$/;
const _FILE_PATH_RE = /^[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]{1,6}$|^[\w.-]+\.(?:ts|js|mjs|md|yml|yaml|json|sh)$/;

function _isGitRepo(workspace) {
  try {
    execFileSync("git", ["-C", workspace, "rev-parse", "--git-dir"], { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}
function _gitCommitExists(workspace, sha) {
  try {
    execFileSync("git", ["-C", workspace, "cat-file", "-e", `${sha}^{commit}`], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

// Real, reproducible defect found by the M201/iteration-0 adversarial audit dogfooding this CLI
// against DIR-126-B's/DIR-126-A's own real task+charter files (both rejected): a bare filename
// reference (e.g. `` `prepare-admission-check.ts` ``, no directory component) is this repo's
// DOMINANT authoring convention for naming a file in prose — but the file it names almost never
// lives at the repo root, so a literal `fs.existsSync(join(workspace, tok))` check on the bare
// token alone false-positives on essentially every ordinarily-written task. Fixed by falling back
// to a repo-wide basename search (via `git ls-files`, computed once per scan, not once per token)
// before declaring a file-shaped token stale — a token whose basename resolves ANYWHERE in the
// tracked tree is real, not dangling, regardless of which directory it lives in.
function _repoBasenames(workspace) {
  try {
    const out = execFileSync("git", ["-C", workspace, "ls-files"], { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const set = new Set();
    for (const f of out.split("\n")) {
      if (f) set.add(path.basename(f));
    }
    return set;
  } catch {
    return null;
  }
}

// Scans `text`'s backtick-quoted tokens for commit-hash-shaped / file-path-shaped references and
// resolves each against `workspace`. Returns { stale: [{token,kind}], ambiguous: boolean } —
// `ambiguous` is true iff a commit-hash-shaped token was found but `workspace` is not a git repo
// (mechanically cannot verify — routes to reviewer-required, never a false claim of resolution).
// `touchesGlobs` (optional, a Set/array of the CALLING task's own `## Touches` glob strings): a
// file-shaped token this task's own Touches declares in-scope is future work the task itself
// brings into existence, not a claimed pre-existing precedent — never stale.
//
// Independent PlanCheck-round-4-equivalent audit finding (M201/DIR-126-B, second adversarial audit
// round, 2026-07-29): the basename fallback below was ORIGINALLY unconditional (any file-shaped
// token whose basename matched anywhere in the repo was accepted), which silently passed a
// directory-QUALIFIED but entirely fabricated path whenever some unrelated file happened to share
// its basename (e.g. `` `packages/nonexistent-fabricated-package/package.json` `` — a fabricated
// directory, but `package.json` is a real basename shared by dozens of real files) — a silent false
// pass, the exact failure mode "no heuristic overreach" forbids. Fixed by restricting the basename
// fallback to BARE tokens only (no `/` at all) — the actual shape of the original bug
// (`` `prepare-admission-check.ts` ``, `` `wiring-coverage-check.test.mjs` ``, always bare); a
// directory-qualified token that fails its literal join now only escapes "stale" via the
// touchesGlobs check below, never via basename-anywhere.
function _scanStaleReferences(text, workspace, touchesGlobs) {
  const tokens = [...(text || "").matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
  const stale = [];
  let sawCommitShaped = false;
  const gitRepo = _isGitRepo(workspace);
  const basenames = gitRepo ? _repoBasenames(workspace) : null;
  const globs = touchesGlobs ? [...touchesGlobs] : [];
  for (const tok of new Set(tokens)) {
    if (_COMMIT_HASH_RE.test(tok)) {
      sawCommitShaped = true;
      if (gitRepo && !_gitCommitExists(workspace, tok)) stale.push({ token: tok, kind: "commit" });
    } else if (_FILE_PATH_RE.test(tok)) {
      // `.quay/` is this repo's own established per-workspace RUNTIME state prefix (CLAUDE.md:
      // ".quay/config.yml" is per-workspace, never repo-tracked; .gitignore already excludes
      // "**/.quay/prepare-leases/") — a `.quay/`-prefixed token in prose illustrates a runtime
      // location, never a claimed repo-tracked precedent, so it is never file-existence-checked at
      // all (independent-audit-round-2 finding: DIR-099/DIR-100/DIR-104 all cite `.quay/gates.yml`
      // this way and were false-positived pre-fix).
      if (tok.startsWith(".quay/")) continue;
      if (fs.existsSync(path.join(workspace, tok))) continue;
      if (!tok.includes("/") && basenames && basenames.has(path.basename(tok))) continue;
      // This repo's own Touches-list convention commonly appends a trailing parenthetical
      // annotation INSIDE the same backtick span ("`foo.ts (new)`", "`bar.ts (or sibling path)`" —
      // confirmed real via direct read of tasks/DIR-099.md, DIR-100.md, DIR-101.md, DIR-104.md,
      // DIR-121.md), which the actual AC/Finding citation never repeats — strip it before matching,
      // local to this membership check only (never mutates the shared `extractTouchesGlobs`
      // output `preflightTouchesMismatch` also consumes, to avoid widening that detector's own,
      // separately-calibrated boundary).
      if (globs.some((g) => _globCoversPath(g.replace(/\s*\([^)]*\)\s*$/, "").trim(), tok))) continue;
      stale.push({ token: tok, kind: "file" });
    }
  }
  return { stale, ambiguous: sawCommitShaped && !gitRepo };
}

// ── preflight-merged-markdown-claims ────────────────────────────────────────────────────────────
// Reuses splitSentences (list-aware, `335317d`-fixed) from wiring-coverage-check.ts — called, never
// reimplemented. The already-fixed splitter correctly isolates one block per LINE-START bullet; the
// real remaining gap it does not close is a bullet marker embedded MID-LINE (two claims crammed onto
// one physical line, e.g. "`foo.ts` - update `bar.ts` invokes ..." with no line break between them)
// — this detector's own new, narrow logic layered on top of the reused splitter.
//
// `_MID_BULLET_RE` alone over-matches two shapes that are NOT a merged-claims bullet marker
// (gap-preflight-merged-markdown-ascii-dash-false-positive /
// gap-preflight-merged-markdown-claims-code-span-subtraction-false-positive, both 2026-07):
//   1. a backtick-wrapped subtraction expression, e.g. `` `endedAtMs - startedAtMs` `` — the regex
//      has no concept of code-span boundaries, so a math `-` inside backticks reads as a bullet.
//   2. an ordinary ASCII " - " prose dash/aside, e.g. "..., and `qux.ts` - all four files share
//      one helper module" — a ` - ` between two prose words is not a bullet marker just because it
//      sits in a block that also happens to name >=2 backtick identifiers earlier in the sentence.
// `_findGenuineMidBullet` closes (1) by skipping any match whose span falls entirely inside a
// `` `...` `` code span — unconditionally correct, code-span content is never prose structure.
//
// Closing (2) went through THREE designs; the first two were REFUTED by independent review
// (2026-07-31) before landing and are recorded here so neither is reintroduced.
//
// Design 1: "genuine iff another backtick identifier occurs ANYWHERE LATER in the block."
// Refuted with a live counterexample — "`foo.ts`, `bar.ts`, `baz.ts`, and `qux.ts` - fix the null
// check in the first two - also rename the last two files for clarity." — a REAL crammed-two-claims
// defect whose identifiers are all front-loaded BEFORE the dashes, so it silently passed with ZERO
// findings — a false NEGATIVE that defeats a hard-blocking safety check.
//
// Design 2: direction-agnostic — look only at the single word immediately after each marker;
// genuine iff that word is a backtick identifier or is NOT in a closed-class continuation-stopword
// list ("the", "and", "also", "it", ...). Also refuted, with a WORSE counterexample —
// "`foo.ts`, `bar.ts`, `baz.ts`, and `qux.ts` - The new caching layer must invalidate stale entries
// on write, not just on read." — front-loaded identifiers, second claim starts with "The" (a
// stopword) — silently passed with ZERO findings again. The reviewer's point: a stoplist keyed on
// the FIRST WORD of a continuation cannot work, because genuine second claims and prose asides draw
// from the exact same function-word-heavy distribution of English sentence openers ("This also...",
// "It must...", "The new..." are all completely ordinary ways to START a real second claim).
//
// Design 3 (this one): stop trying to build a perfect binary genuine/not-genuine classifier — no
// finite heuristic over unstructured English prose can be both sound and complete, and the last two
// attempts both erred by ever fully SUPPRESSING a match (returning zero findings) based on a
// necessarily-imperfect signal. Instead, the ASCII-dash prose signal (still the same continuation-
// stopword idea, kept because it correctly identifies the two ORIGINAL false-positive shapes) is
// now bounded to a SEVERITY DOWNGRADE ONLY: a block whose mid-bullet match(es) all look like a
// prose dash/aside — via `_isProseDashTail`, same stopword-adjacency test as design 2's tail check,
// but reused only to soften rather than to gate — is downgraded from the blocking (`>=4`
// identifiers) tier to the ambiguous/`reviewer-required` (`preflight-ambiguous-merged-markdown-
// claims`) tier, EXACTLY the outcome both original tasks' own Acceptance Criteria explicitly permit
// ("returns zero findings, OR AT MOST a non-blocking ambiguous variant"). It can never drop all the
// way to zero findings by this signal alone — the block still surfaces as a real, visible,
// human-reviewed finding, just not a hard block. This bounds the blast radius of getting the
// heuristic wrong: worst case, a genuine crammed-claims defect gets flagged non-blocking instead of
// blocking (still caught by a human), never silently missed entirely — the actual property both
// prior refutations were pointing at, stated precisely instead of chased informally with a bigger
// heuristic. Re-verified against ALL FOUR known shapes plus both design-1/2 counterexamples:
//   - bad.md ("`FooModule` - update `BarService` invokes ...", genuine, must block): its one match's
//     tail is "update" (not a stopword) -> not a prose dash -> full severity -> still BLOCKS.
//   - design-1's counterexample ("... - fix the null check ... - also rename ...", genuine, must
//     block): "fix" is not a stopword -> at least one match is NOT prose-dash -> `every()` is false
//     -> full severity -> still BLOCKS (the OTHER match, "also", being a stopword, does not matter —
//     downgrade requires EVERY match in the block to look like prose, not just one).
//   - the original #7 repro and design-2's counterexample ("... - all four files share ...", "...
//     - The new caching layer must invalidate ...", both prose, must not hard-block): single match,
//     tail starts with a stopword ("all"/"The") -> every() true -> DOWNGRADED to ambiguous, not
//     blocking — satisfies "at most ambiguous" without ever going silent.
//   - design-1's other counterexample ("... - the main entry point - and also `bar.ts` ...", prose,
//     must not hard-block): two matches, tails "the"/"and", both stopwords -> every() true ->
//     DOWNGRADED to ambiguous.
//   - code-span-subtraction.md (`` `endedAtMs - startedAtMs` ``): unchanged from design 1/2 — a
//     match entirely inside a backtick code span is excluded before this signal is even computed,
//     unconditionally correct since code-span content is never prose structure; this is the one part
//     of the fix neither prior review disputed.
const _MID_BULLET_RE = /\S[ \t]+[-*][ \t]+\S/g;

const _CONTINUATION_STOPWORDS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "all", "both", "each", "every", "some",
  "any", "no", "none", "and", "or", "but", "so", "yet", "for", "nor", "also", "then", "thus",
  "hence", "therefore", "meanwhile", "otherwise", "however", "moreover", "furthermore",
  "additionally", "plus", "which", "who", "whom", "whose", "where", "when", "while", "since",
  "because", "although", "though", "it", "they", "we", "you", "he", "she", "i", "with", "without",
  "within", "into", "onto", "upon", "about", "above", "below", "under", "over", "between",
  "among", "during", "before", "after", "until", "unless", "per", "via", "as", "is", "are", "was",
  "were", "be", "being", "been", "has", "have", "had", "not", "only", "just", "still", "already",
  "even", "rather", "instead",
]);

// Returns true only when the tail POSITIVELY looks like a prose continuation (starts with a
// continuation-stopword). Any unclear/unrecognized shape defaults to FALSE (not prose) — the
// safety-preferred direction here, since false=>"do not downgrade" keeps the block at full
// severity, whereas the earlier designs' analogous defaults controlled whether a match was
// suppressed entirely, a much higher-stakes decision this design no longer makes from this signal.
function _isProseDashTail(tail) {
  const trimmed = tail.replace(/^[ \t]+/, "");
  if (trimmed.startsWith("`")) return false;
  const wordMatch = trimmed.match(/^[A-Za-z']+/);
  if (!wordMatch) return false;
  return _CONTINUATION_STOPWORDS.has(wordMatch[0].toLowerCase());
}

// Returns every non-code-span mid-bullet match in `block`, each tagged with whether its tail looks
// like a prose dash. Never filters a match out based on the prose signal — only code-span exclusion
// removes a match entirely (unconditionally safe, see header comment above).
function _midBulletMatches(block) {
  const codeSpanRanges = [...block.matchAll(/`[^`]*`/g)].map((m) => [m.index, m.index + m[0].length]);
  const re = new RegExp(_MID_BULLET_RE.source, _MID_BULLET_RE.flags);
  const out = [];
  let match;
  while ((match = re.exec(block))) {
    const start = match.index;
    const end = start + match[0].length;
    const insideCodeSpan = codeSpanRanges.some(([s, e]) => start >= s && end <= e);
    if (insideCodeSpan) continue;
    // `end - 1` because _MID_BULLET_RE's final `\S` already consumed the first character of the
    // word that follows the marker — start the tail there, not one character late.
    const tail = block.slice(end - 1);
    out.push({ text: match[0], looksLikeProseDash: _isProseDashTail(tail) });
  }
  return out;
}

export function preflightMergedMarkdownClaims({ taskBody }) {
  const code = "preflight-merged-markdown-claims";
  const sections = ["Requested action", "Proposal", "Finding"]
    .map((h) => extractSection(taskBody, h))
    .filter(Boolean)
    .join("\n\n");
  if (!sections.trim()) return null;
  const blocks = splitSentences(sections);
  let worstBlock = null;
  let worstIdentifierCount = 0;
  let anyAmbiguous = false;
  for (const block of blocks) {
    const midBulletMatches = _midBulletMatches(block);
    if (midBulletMatches.length === 0) continue;
    const identifiers = new Set([...block.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    // Every mid-bullet match in this block must look like a prose dash to downgrade — a single
    // genuine-looking match (e.g. design-1's "- fix the null check...") keeps full severity even
    // if another match in the same block ("- also rename...") looks like prose.
    const allLookLikeProseDash = midBulletMatches.every((m) => m.looksLikeProseDash);
    if (identifiers.size >= 4 && !allLookLikeProseDash) {
      if (identifiers.size > worstIdentifierCount) { worstIdentifierCount = identifiers.size; worstBlock = block; }
    } else if (identifiers.size >= 2) {
      // 2-3 identifiers (original ambiguous tier), OR >=4 identifiers but every mid-bullet match
      // looks like a prose dash — downgraded here rather than suppressed (see header comment).
      anyAmbiguous = true;
      if (!worstBlock) worstBlock = block;
    }
  }
  if (worstIdentifierCount >= 4) {
    return _mkFinding(code, true,
      `a claim-bearing block still crams >=2 distinct wiring claims onto one un-split line (${worstIdentifierCount} backtick identifiers, a mid-line bullet marker the list-aware splitter's line-start-only detection cannot see)`,
      worstBlock.slice(0, 200), "unresolved");
  }
  if (anyAmbiguous) {
    return _mkFinding(_ambiguousCode(code), false,
      "a block has a mid-line bullet marker with 2-3 backtick identifiers (or >=4 identifiers but every marker looks like a prose dash/aside) — plausibly one claim with an inline aside, not confidently a merged-claims case",
      worstBlock ? worstBlock.slice(0, 200) : "", "reviewer-required");
  }
  return null;
}

// ── preflight-stale-ac-refs ─────────────────────────────────────────────────────────────────────
export function preflightStaleAcRefs({ taskBody, workspace }) {
  const code = "preflight-stale-ac-refs";
  const ac = extractSection(taskBody, "Acceptance Criteria") || "";
  const dod = extractSection(taskBody, "Definition of Done") || "";
  const touchesGlobs = extractTouchesGlobs(extractSection(taskBody, "Touches"));
  const { stale, ambiguous } = _scanStaleReferences(`${ac}\n${dod}`, workspace, touchesGlobs);
  if (stale.length > 0) {
    return _mkFinding(code, true,
      `'## Acceptance Criteria'/'## Definition of Done' cite ${stale.length} reference(s) that do not resolve against the current repository: ${stale.map((s) => `${s.kind}:${s.token}`).join(", ")}`,
      stale.map((s) => s.token).join(", "), "unresolved");
  }
  if (ambiguous) {
    return _mkFinding(_ambiguousCode(code), false,
      "'## Acceptance Criteria'/'## Definition of Done' cite a commit-hash-shaped token but `workspace` is not a git repository — cannot mechanically verify, routes to reviewer-required rather than a false pass/fail",
      "", "reviewer-required");
  }
  return null;
}

// ── preflight-missing-precedent ─────────────────────────────────────────────────────────────────
export function preflightMissingPrecedent({ taskBody, workspace }) {
  const code = "preflight-missing-precedent";
  const sections = ["Finding", "Requested action", "Proposal"].map((h) => extractSection(taskBody, h) || "").join("\n");
  const touchesGlobs = extractTouchesGlobs(extractSection(taskBody, "Touches"));
  const { stale, ambiguous } = _scanStaleReferences(sections, workspace, touchesGlobs);
  if (stale.length > 0) {
    return _mkFinding(code, true,
      `'## Finding'/'## Requested action'/'## Proposal' cite ${stale.length} claimed precedent(s) (commit-hash-shaped or file-path-shaped) that do not resolve against the current repository: ${stale.map((s) => `${s.kind}:${s.token}`).join(", ")}`,
      stale.map((s) => s.token).join(", "), "unresolved");
  }
  if (ambiguous) {
    return _mkFinding(_ambiguousCode(code), false,
      "a claimed precedent is commit-hash-shaped but `workspace` is not a git repository — cannot mechanically verify, routes to reviewer-required",
      "", "reviewer-required");
  }
  return null;
}

// ── preflight-touches-mismatch ──────────────────────────────────────────────────────────────────
// checkTouches() (task-schema.ts) is a well-formedness PRECONDITION only — it validates glob syntax,
// it never cross-checks against a second source. The set-difference cross-source comparison below is
// genuinely new logic layered on top, per the task's own Chosen-mechanism table. Called from TWO
// distinct sites with different `secondaryLabel`s (WIRING-CLAIM 6): 'charter' (task Touches vs the
// charter's own, pre-ProposalAuthors) and 'plan-files' (task Touches vs the checked Plan's aggregate
// '- Files:' lines, pre-PlanCheck round 1) — ONE implementation, two call sites.
// _stripWrappingBacktick — shared by both sides of preflightTouchesMismatch's comparison
// (gap-prepare-admission-check-plan-files-backtick-asymmetry / found during real-dispatch
// evidence-gathering for DIR-126-D's REFUTED audit AC12): a Touches bullet's backticks were
// stripped here, but a Plan Stage's own '- Files:' line (parsed by milestone-preparation-check.ts's
// parsePlanStages, reused not reinvented) was compared VERBATIM with no stripping at all — a
// PlanAuthor that (stylistically, non-deterministically) backtick-wraps its Files: entries
// produced a permanent, unfixable-by-redispatch false mismatch, since the wrapped/unwrapped forms
// never string-equal or regex-match each other.
//
// Trailing-annotation stripping (gap-preflight-touches-mismatch-plan-files-annotation, M205): the
// same non-deterministic PlanAuthor also appends parenthetical annotations to '- Files:' entries —
// e.g. `wiring-coverage-check.ts (read-only input: tasks/DIR-126-D.md)` or `sync-vendor.sh (all
// read-only)`. The annotation rides along inside the comma-separated path token, so a Touches entry
// naming the bare path never matches the annotated form. Strip ONE trailing ` (…)` annotation after
// backtick-stripping. This is NOT over-permissive: repo paths never contain parentheses, and the
// stripped path must still exactly/glob-match a declared '## Touches' entry via _globCoversPath
// (the match predicate is unchanged) — only the cosmetic annotation is removed before matching.
function _stripWrappingBacktick(g) {
  g = g.trim();
  if (g.startsWith("`") && g.endsWith("`") && g.length >= 2) g = g.slice(1, -1).trim();
  g = g.replace(/\s+\(.*$/, "").trim();
  return g;
}
// _splitTopLevelCommas — split a Plan '- Files:' value on commas WITHOUT splitting inside a
// parenthetical annotation. The non-deterministic PlanAuthor appends annotations that may
// themselves contain commas — e.g. `a.test.mjs, b.test.mjs (both run, neither modified)` — so a
// naive `.split(",")` shreds ` (both run, neither modified)` into bogus path tokens (`(both run`,
// `neither modified)`) that can never match a '## Touches' entry. Track paren depth and split only
// at depth 0; per-token annotation stripping then removes each path's own trailing ` (…)`.
function _splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}
export function extractTouchesGlobs(sectionText) {
  // SINGLE-SOURCE (gap-task-body-has-n-parsers-and-no-authority): delegate to the ONE shared
  // Touches bullet parser. The old inline loop (bullet match + _stripWrappingBacktick) had the
  // residual-backtick bug — `` - `x.ts` (new) `` lost its leading backtick, kept the annotation,
  // then the annotation strip left a trailing backtick → a wrong glob. parseTouchEntries strips
  // quotes/backticks before AND after the annotation strip (both annotation forms).
  return parseTouchEntries(sectionText);
}
function _globCoversPath(glob, filePath) {
  if (glob === filePath) return true;
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "@@DOUBLESTAR@@")
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp("@@DOUBLESTAR@@", "g"), ".*");
  return new RegExp(`^${escaped}$`).test(filePath);
}
export function preflightTouchesMismatch({ taskBody, secondaryBody, secondaryLabel }) {
  const code = "preflight-touches-mismatch";
  const touchesCheck = checkTouches({ body: taskBody }, "milestone-candidate");
  if (!touchesCheck.ok) {
    return _mkFinding(code, true,
      `task's own '## Touches' is ill-formed (${touchesCheck.code}): ${touchesCheck.message}`,
      touchesCheck.code, "unresolved");
  }
  const taskGlobs = new Set(extractTouchesGlobs(extractSection(taskBody, "Touches")));
  if (taskGlobs.size === 0) return null; // touches-absent-* / touches-na — nothing to cross-check

  let secondaryGlobs;
  if (secondaryLabel === "charter") {
    // A charter that DELEGATES ("Per `tasks/X.md`'s own '## Touches' list — not duplicated here",
    // this task's own real charter's exact phrasing) has no distinct list of its own — the common,
    // expected shape — never a mismatch. Matched narrowly on the literal delegation phrase only
    // (NOT a looser "own...Touches...list" pattern — that shape ALSO matches a charter's own
    // genuine claim like "declares its OWN Touches list", the opposite of delegating).
    if (/not duplicated here/i.test(secondaryBody || "")) {
      return null;
    }
    const charterTouchesSection = extractSection(secondaryBody || "", "Touches");
    if (charterTouchesSection === null) return null; // charter names no Touches of its own
    secondaryGlobs = new Set(extractTouchesGlobs(charterTouchesSection));
  } else {
    // 'plan-files': aggregate every Stage's '- Files:' line (comma-separated real paths) — reuses
    // milestone-preparation-check.ts's own stage-block parser, never a second Markdown parser.
    const stages = parsePlanStages(secondaryBody || "");
    secondaryGlobs = new Set(stages.flatMap((s) => _splitTopLevelCommas(s.files || "").map((f) => _stripWrappingBacktick(f)).filter(Boolean)));
  }
  if (secondaryGlobs.size === 0) return null;

  const unmatched = [...secondaryGlobs].filter((f) => ![...taskGlobs].some((g) => _globCoversPath(g, f)));
  if (unmatched.length === 0) return null;
  // Fixture/test-corpus paths are a documented, expected touch-set expansion (this task's own Plan
  // Stage-6 precedent — DIR-126-A/M200's Stage 9 handled the identical class up front) — not
  // enumerated in a task's '## Touches' by convention, so an unmatched path under `test/fixtures/`
  // is reviewer-required, not a hard block.
  const trulyUnmatched = unmatched.filter((f) => !/test\/fixtures\//.test(f));
  if (trulyUnmatched.length === 0) {
    return _mkFinding(_ambiguousCode(code), false,
      `${secondaryLabel} references only fixture/test-corpus path(s) not enumerated in the task's '## Touches' (${unmatched.join(", ")}) — a documented, expected touch-set expansion, not confidently a real mismatch`,
      unmatched.join(", "), "reviewer-required");
  }
  return _mkFinding(code, true,
    `${secondaryLabel === "charter" ? "charter" : "Plan"}'s own Touches/Files reference path(s) not covered by the task's '## Touches': ${trulyUnmatched.join(", ")}`,
    trulyUnmatched.join(", "), "unresolved");
}

// ── plan-structure parsing (inlined from the retired ./milestone-preparation-check.ts) ─────────────
// The same mechanical '### Stage N'/'- AC:'/'- Files:'/'- Command:' block shape that
// milestone-preparation-check.ts parsed at Receipt time — never a third Markdown parser. These were
// imported from that module until the prepare/execute pipeline was retired (ADR-022 /
// gap-retire-the-prepare-execute-pipeline-cluster); they now live here, single-sourced, because this
// file's `--preflight-plan` detector is their only surviving consumer.

const STAGE_HEADER_RE = /^###\s+Stage\s+(\d+)\s*:\s*(.*)$/gm;

export function parsePlanStages(planText) {
  const text = String(planText ?? "");
  const headers = [...text.matchAll(STAGE_HEADER_RE)];
  const stages = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index + headers[i][0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index : text.length;
    const block = text.slice(start, end);
    const acMatch = block.match(/^-\s*AC:\s*(.+)$/im);
    const filesMatch = block.match(/^-\s*Files:\s*(.+)$/im);
    const checkMatch = block.match(/^-\s*(?:Command|Check):\s*(.+)$/im);
    const ac = acMatch
      ? acMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n))
      : [];
    stages.push({
      number: Number(headers[i][1]),
      title: headers[i][2].trim(),
      ac,
      files: filesMatch ? filesMatch[1].trim() : "",
      check: checkMatch ? checkMatch[1].trim() : "",
    });
  }
  return stages;
}

export function validatePlanStructure(planText, acCount) {
  const stages = parsePlanStages(planText);
  if (stages.length === 0) {
    return { ok: false, code: "plan-no-stages", message: "checked Plan has no '### Stage <N>: ...' blocks — cannot verify AC-to-stage mapping mechanically" };
  }
  for (const s of stages) {
    if (s.ac.length === 0) {
      return { ok: false, code: "plan-stage-missing-ac", message: `Stage ${s.number} ("${s.title}") has no '- AC: ...' mapping` };
    }
    if (!s.files) {
      return { ok: false, code: "plan-stage-missing-files", message: `Stage ${s.number} ("${s.title}") has no '- Files: ...' entry` };
    }
    if (!s.check) {
      return { ok: false, code: "plan-stage-missing-command", message: `Stage ${s.number} ("${s.title}") has no '- Command:'/'- Check:' entry` };
    }
  }
  if (Number.isFinite(acCount) && acCount > 0) {
    const covered = new Set(stages.flatMap((s) => s.ac));
    const missing = [];
    for (let i = 1; i <= acCount; i++) if (!covered.has(i)) missing.push(i);
    if (missing.length > 0) {
      return { ok: false, code: "plan-ac-not-mapped", message: `task Acceptance Criteria item(s) #${missing.join(", #")} are not mapped to any Plan stage (task declares ${acCount} AC item(s))` };
    }
  }
  return { ok: true, code: "plan-structure-ok", message: `Plan has ${stages.length} stage(s), all ${acCount} task AC item(s) mapped` };
}

// ── preflight-invalid-plan-command ──────────────────────────────────────────────────────────────
// Exported so the PlanAuthor prompt contract (prepare-milestone.js's `_planShapeContract`) could be
// anti-drift-tested against the REAL acceptance rule rather than a prose restatement of it
// (gap-planauthor-shape-rules-not-injected, 2026-08-02). prepare-milestone.js is retired, but the
// detector and its tests remain.
export const _RUNNABLE_COMMAND_RE = /^(?:node|npm|npx|bash|sh|git|scripts\/|`)/i;
export function preflightInvalidPlanCommand({ planBody, acCount }) {
  const code = "preflight-invalid-plan-command";
  const structural = validatePlanStructure(planBody, acCount);
  if (!structural.ok) {
    return _mkFinding(code, true, structural.message, structural.code, "unresolved");
  }
  const stages = parsePlanStages(planBody);
  const nonRunnable = stages.filter((s) => !_RUNNABLE_COMMAND_RE.test((s.check || "").trim()));
  if (nonRunnable.length > 0) {
    return _mkFinding(_ambiguousCode(code), false,
      `Stage(s) ${nonRunnable.map((s) => s.number).join(", ")} have a '- Command:'/'- Check:' value that does not start with a recognizable interpreter/backtick — cannot mechanically confirm it is directly runnable (may be a valid prose check)`,
      nonRunnable.map((s) => s.check).join(" | "), "reviewer-required");
  }
  return null;
}

// ── runPreflightChecks — the one entry point both CLI modes call. ──────────────────────────────────
export function runPreflightChecks({ mode, taskBody, charterBody, planBody, workspace }) {
  const findings = [];
  function record(finding) {
    if (!finding) return;
    // Calibration is keyed on the detector's BASE code — an ambiguous finding's code carries the
    // `preflight-ambiguous-` prefix (see _ambiguousCode) but is still produced by the same
    // calibrated-or-not detector, so strip it before the PREFLIGHT_CALIBRATED lookup (cosmetic-only:
    // an ambiguous finding is already `blocking:false` regardless of calibration, this only keeps
    // the returned `calibrated` field truthful).
    const baseCode = finding.code.replace(/^preflight-ambiguous-/, "preflight-");
    const calibrated = PREFLIGHT_CALIBRATED[baseCode] === true;
    const blocking = finding.blocking === true && calibrated;
    const disposition = blocking ? finding.disposition : (finding.disposition === "unresolved" ? "reviewer-required" : finding.disposition);
    findings.push({ ...finding, blocking, disposition, calibrated });
  }

  if (mode === "content") {
    record(preflightMergedMarkdownClaims({ taskBody }));
    record(preflightStaleAcRefs({ taskBody, workspace }));
    record(preflightTouchesMismatch({ taskBody, secondaryBody: charterBody, secondaryLabel: "charter" }));
    record(preflightMissingPrecedent({ taskBody, workspace }));
  } else if (mode === "plan") {
    const acSection = extractSection(taskBody, "Acceptance Criteria") || "";
    const { total: acCount } = countBoxes(acSection);
    record(preflightTouchesMismatch({ taskBody, secondaryBody: planBody, secondaryLabel: "plan-files" }));
    record(preflightInvalidPlanCommand({ planBody, acCount }));
  } else {
    throw new Error(`runPreflightChecks: unknown mode ${JSON.stringify(mode)} (expected 'content' or 'plan')`);
  }

  const ok = findings.every((f) => f.blocking !== true);
  return { ok, policyVersion: PREFLIGHT_POLICY_VERSION, findings };
}

// ── Exposed for tests/fixtures (not part of the CLI contract). ─────────────────────────────────────
export const _internal = { leaseDir, leasePath, auditPath, leaseKey, stalenessMsFor, safeTaskIdSegment, _readLease, _readLeaseFileWithRetry };

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
async function main(argv) {
  const spec = {
    usage: "(--acquire|--renew|--release|--force-release <reason>|--preflight|--preflight-plan) --taskId <id> --workspace <dir> [--highRisk] [--stage <name>] [--baseCommit <sha>] [--reason <text>] [--charterFile <path>] [--planFile <path>]",
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
      // M201/DIR-126-B: same spec.flags object, same parseArgs/isDirectEntry machinery the
      // acquire/renew/release modes already use — no new arg-parsing implementation (WIRING-CLAIM 9).
      preflight: { type: "boolean" },
      "preflight-plan": { type: "boolean" },
      planFile: { type: "string" },
      charterFile: { type: "string" },
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
          : parsed.flags.preflight
            ? "preflight"
            : parsed.flags["preflight-plan"]
              ? "preflight-plan"
              : null;
  if (!mode) {
    console.error(`usage: node prepare-admission-check.ts ${spec.usage}`);
    return 2;
  }
  const now = Date.now();
  try {
    // M207: every JSON verdict this CLI prints carries ONE additive `nowMs: now` field, reusing
    // the single already-computed `const now = Date.now()` above — ZERO new Date.now() sites in
    // this file. This is the per-phase-boundary self-report prepare-milestone.js reads out of the
    // parsed verdict (never computing a clock read in the sandbox itself — AC19's regression class
    // f6db2a8/7357a91, and acquireLease's own `missing-now` contract above). Lease-mode `result`
    // objects gain it by non-clobbering `{...result, nowMs: now}` spread; the two preflight modes
    // spread the object `runPreflightChecks(...)` RETURNED so the existing `{ok, policyVersion,
    // findings}` keys downstream Preflight verdict parsing reads survive unchanged; the inline
    // error literals and the catch-all carry it too, so a failure verdict also self-reports when
    // the subprocess answered. The pure decision functions above stay untouched (already
    // `now`-injected) — the pure-decision/thin-CLI split and every direct-import unit test holds.
    if (mode === "preflight" || mode === "preflight-plan") {
      const taskPath = path.join(workspace, "tasks", `${taskId}.md`);
      if (!fs.existsSync(taskPath)) {
        console.log(JSON.stringify({ outcome: "error", code: "preflight-check-failed", message: `task file not found: ${taskPath}`, nowMs: now }));
        return 2;
      }
      const taskBody = fs.readFileSync(taskPath, "utf8");
      if (mode === "preflight") {
        const charterBody = parsed.flags.charterFile && fs.existsSync(parsed.flags.charterFile)
          ? fs.readFileSync(parsed.flags.charterFile, "utf8")
          : "";
        const result = runPreflightChecks({ mode: "content", taskBody, charterBody, workspace });
        console.log(JSON.stringify({ ...result, nowMs: now }));
        return result.ok ? 0 : 1;
      }
      // mode === 'preflight-plan'
      if (!parsed.flags.planFile || !fs.existsSync(parsed.flags.planFile)) {
        console.log(JSON.stringify({ outcome: "error", code: "preflight-check-failed", message: `--planFile not found: ${parsed.flags.planFile}`, nowMs: now }));
        return 2;
      }
      const planBody = fs.readFileSync(parsed.flags.planFile, "utf8");
      const result = runPreflightChecks({ mode: "plan", taskBody, planBody, workspace });
      console.log(JSON.stringify({ ...result, nowMs: now }));
      return result.ok ? 0 : 1;
    }
    if (mode === "acquire") {
      const ownerExecutionId = process.env.CLAUDE_CODE_SESSION_ID;
      if (!ownerExecutionId) {
        console.log(JSON.stringify({ outcome: "error", code: "missing-session-id", message: "CLAUDE_CODE_SESSION_ID is not set in this process environment", nowMs: now }));
        return 2;
      }
      const result = acquireLease({
        workspace, taskId,
        highRisk: parsed.flags.highRisk === true,
        stage: parsed.flags.stage || "Admission",
        baseCommit: parsed.flags.baseCommit || null,
        now, ownerExecutionId,
      });
      console.log(JSON.stringify({ ...result, nowMs: now }));
      return result.outcome === "acquired" ? 0 : 1;
    }
    if (mode === "renew") {
      const result = renewLease({ workspace, taskId, stage: parsed.flags.stage, now });
      console.log(JSON.stringify({ ...result, nowMs: now }));
      return result.ok ? 0 : 1;
    }
    if (mode === "release") {
      const result = releaseLease({ workspace, taskId, method: "normal", reason: parsed.flags.reason || null, now });
      console.log(JSON.stringify({ ...result, nowMs: now }));
      return result.ok ? 0 : 1;
    }
    // mode === 'force-release'
    const reason = parsed.flags["force-release"];
    if (!reason) {
      console.error("ERROR: --force-release requires a <reason>");
      return 2;
    }
    const result = releaseLease({ workspace, taskId, method: "force-release", reason, now });
    console.log(JSON.stringify({ ...result, nowMs: now }));
    return result.ok ? 0 : 1;
  } catch (err) {
    console.log(JSON.stringify({ outcome: "error", code: err.code || "admission-check-failed", message: err.message, nowMs: now }));
    return 2;
  }
}

if (isDirectEntry(import.meta, undefined, "prepare-admission-check")) {
  main(process.argv).then((code) => process.exit(code));
}
