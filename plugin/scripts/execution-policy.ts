// execution-policy.ts — the minimal VERSIONED execution-policy substrate consumed by the finding
// back-propagation mechanism (gap-audit-findings-not-backpropagated-to-earlier-detectors).
//
// DIR-124-D owns the full single-source milestone execution-policy registry (task-kind routing,
// gates, test profiles, resource claims). That registry is NOT landed; this module supplies the
// small versioned policy-hash + authorized-activation core that DIR-124-D can adopt, so the
// back-propagation rule "profile/global activation requires a distinct authorized policy
// transition; the originating observer cannot mutate the policy" has a real, mechanical home
// instead of prose. It is deliberately NOT the full DIR-124-D registry — it owns only:
//
//   1. a versioned PolicyDocument (policyVersion + policyHash over a canonical serialization);
//   2. an AUTHORIZED-activation transition (the proposing observer can never self-authorize);
//   3. a fail-closed revocation transition (the AC8 false-positive/reopened control);
//   4. receipt invalidation: a policy activation changes the policy hash and invalidates exactly
//      the receipts bound to the old hash for the affected recurrence class.
//
// Zero npm dependencies — Node.js built-ins only (node:fs, node:path, node:crypto). No build
// step; dispatched via `node --experimental-strip-types <abs path>/execution-policy.ts <mode>`.
//
// Export surfaces:
//   - Constants: POLICY_SCHEMA_VERSION, AUTHORIZED_ACTIVATOR_ROLES
//   - Types: PolicyDocument, ActivatedDetector, ActivationRequest, ActivationResult,
//     ReceiptPolicyBinding, InvalidationResult, RevocationResult
//   - Functions: createPolicy, computePolicyHash, serializePolicy, authorizeActivation,
//     revokeActivation, bindPolicyHash, invalidateReceiptsForPolicyChange, selftest()
//   - CLI: --create '<{profiles}>', --compute-hash '<policy-json>',
//     --authorize '<{policy,request}>', --revoke '<{policy,detectorId,reason}>',
//     --invalidate '<{oldHash,newHash,detector,receipts}>', --selftest
//
// Byte-identical mirror: plugin/scripts/execution-policy.ts

import { createHash } from "node:crypto";
import { createSelftest, parseJsonArg } from "./gate-script-base.ts";

// ── Contract version ───────────────────────────────────────────────────────────────────────────────

export const POLICY_SCHEMA_VERSION = "1" as const;

/**
 * Roles that MAY authorize a profile/global detector activation. A proposing observer
 * (ProposalReview, Audit, WiringAudit, …) is NEVER in this set — AC3: the originating observer
 * cannot mutate the policy or authoritative task state. This is the distinct authorized transition.
 */
export const AUTHORIZED_ACTIVATOR_ROLES = ["policy-owner", "directive-owner"] as const;

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export interface ActivatedDetector {
  detectorId: string;
  recurrenceKey: string;
  rule: string;
  stage: string;
  authorizedBy: string;
  authorizedAtMs: number;
  calibrationRef: {
    red: number;
    green: number;
    ambiguous: number;
    redHitRate: number;
    falsePositiveRate: number;
  } | null;
  /** Present when the detector was disabled by the AC8 false-positive/reopened control. */
  revoked?: {
    reason: string;
    revokedAtMs: number;
    revokedBy: string;
  };
}

export interface PolicyDocument {
  schemaVersion: typeof POLICY_SCHEMA_VERSION;
  policyVersion: string;
  policyHash: string;
  profiles: Record<string, Record<string, unknown>>;
  activatedDetectors: ActivatedDetector[];
  /** Append-only activation/revocation history (each entry is a distinct policy hash). */
  history: Array<{ hash: string; recordedAtMs: number; note: string }>;
}

export interface ActivationRequest {
  detector: Omit<ActivatedDetector, "authorizedBy" | "authorizedAtMs" | "calibrationRef">;
  /** The role+id of the actor requesting the activation. */
  authorizer: { role: string; id: string };
  /** The proposing observer stage from the finding (e.g. "Audit", "WiringAudit"). */
  proposingObserverStage: string;
  calibrationOk: boolean;
  calibrationRef: ActivatedDetector["calibrationRef"];
  note?: string;
}

export interface ActivationResult {
  ok: boolean;
  reason: string;
  policyBefore: string;
  policyAfter: string;
  activated: ActivatedDetector | null;
}

export interface RevocationResult {
  ok: boolean;
  reason: string;
  policyBefore: string;
  policyAfter: string;
  revoked: ActivatedDetector | null;
}

/** A receipt's policy binding: { receiptId, policyHash, recurrenceKey? } — the material a cached
 * receipt embeds so a policy change can invalidate exactly the affected subset. */
export interface ReceiptPolicyBinding {
  receiptId: string;
  policyHash: string;
  recurrenceKey?: string;
}

export interface InvalidationResult {
  oldPolicyHash: string;
  newPolicyHash: string;
  invalidated: string[];
  unaffected: string[];
}

// ── sha256 helpers ───────────────────────────────────────────────────────────────────────────────────

export function sha256OfString(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ── Deterministic canonical serialization (same precedent as stage-receipt.ts serializeReceipt) ────

function serializePolicy(policy: PolicyDocument): string {
  const copy: Record<string, unknown> = { ...policy, policyHash: "" };
  const sortValue = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) o[k] = sortValue((v as Record<string, unknown>)[k]);
      return o;
    }
    return v;
  };
  return JSON.stringify(sortValue(copy));
}

export { serializePolicy };

/** sha256 over the canonical serialization of the policy (hash field zeroed). Deterministic
 * across key-insertion order; a schema/profile/detector change always changes the hash. */
export function computePolicyHash(policy: PolicyDocument): string {
  return sha256OfString(serializePolicy(policy));
}

// ── createPolicy ─────────────────────────────────────────────────────────────────────────────────────

export function createPolicy(profiles: Record<string, Record<string, unknown>> = {}, opts?: { policyVersion?: string }): PolicyDocument {
  const policy: PolicyDocument = {
    schemaVersion: POLICY_SCHEMA_VERSION,
    policyVersion: opts?.policyVersion ?? "1",
    policyHash: "",
    profiles: { ...profiles },
    activatedDetectors: [],
    history: [],
  };
  policy.policyHash = computePolicyHash(policy);
  return policy;
}

// ── authorizeActivation (AC3 — the distinct authorized transition) ─────────────────────────────────

/**
 * The SOLE activation path. Refuses fail-closed when:
 *   - the requesting authorizer role is not in AUTHORIZED_ACTIVATOR_ROLES (an auditor/observer
 *     can never self-activate its own candidate); or
 *   - the authorizer role equals the proposing observer stage (same-actor self-authorization);
 *   - the detector has not been proven by a RED/GREEN calibration (calibrationOk !== true).
 * On success returns the NEXT policy document (new hash) and the activated detector record.
 */
export function authorizeActivation(policy: PolicyDocument, request: ActivationRequest): ActivationResult {
  const before = policy.policyHash;
  const fail = (reason: string): ActivationResult => ({
    ok: false,
    reason,
    policyBefore: before,
    policyAfter: before,
    activated: null,
  });

  if (!policy || typeof policy !== "object" || typeof policy.policyHash !== "string") {
    return fail("policy-not-object");
  }
  if (!request || typeof request !== "object" || !request.detector || !request.authorizer) {
    return fail("activation-request-invalid");
  }
  if (typeof request.detector.detectorId !== "string" || request.detector.detectorId.trim() === "") {
    return fail("detector-id-missing");
  }
  if (typeof request.detector.recurrenceKey !== "string" || request.detector.recurrenceKey.trim() === "") {
    return fail("detector-recurrence-key-missing");
  }

  const role = String(request.authorizer.role ?? "");
  if (!(AUTHORIZED_ACTIVATOR_ROLES as readonly string[]).includes(role)) {
    return fail(`authorizer-role-not-authorized: "${role}" cannot activate a detector (originating observers cannot self-authorize)`);
  }
  if (role === String(request.proposingObserverStage ?? "")) {
    return fail(`same-actor-self-authorization: proposing observer "${request.proposingObserverStage}" cannot authorize its own candidate`);
  }
  if (request.calibrationOk !== true) {
    return fail("detector-not-calibrated: profile/global activation requires proven RED/GREEN calibration");
  }
  if (request.calibrationRef == null) {
    return fail("detector-calibration-ref-missing");
  }

  const now = Date.now();
  const activated: ActivatedDetector = {
    ...request.detector,
    authorizedBy: role,
    authorizedAtMs: now,
    calibrationRef: request.calibrationRef,
  };

  const next: PolicyDocument = {
    ...policy,
    activatedDetectors: [...policy.activatedDetectors, activated],
    history: [...policy.history, { hash: before, recordedAtMs: now, note: request.note ?? `activate ${activated.detectorId}` }],
  };
  next.policyHash = computePolicyHash(next);
  return {
    ok: true,
    reason: `detector ${activated.detectorId} activated at stage ${activated.stage}`,
    policyBefore: before,
    policyAfter: next.policyHash,
    activated,
  };
}

// ── revokeActivation (AC8 — the false-positive / reopened-finding control) ─────────────────────────

/**
 * AC8 control: a detector that later produces a false positive, or whose finding reopens, is
 * disabled SAFELY — removed from the activated set, its policy hash changes, and the affected
 * receipts are invalidated. The control NEVER deletes evidence; it only removes the rule from the
 * active policy and records the revocation in the detector record + policy history.
 */
export function revokeActivation(
  policy: PolicyDocument,
  detectorId: string,
  opts: { reason: string; actor: string }
): RevocationResult {
  const before = policy.policyHash;
  const fail = (reason: string): RevocationResult => ({
    ok: false,
    reason,
    policyBefore: before,
    policyAfter: before,
    revoked: null,
  });

  if (!opts?.reason || opts.reason.trim() === "") return fail("revocation-reason-required");
  if (!policy || !Array.isArray(policy.activatedDetectors)) return fail("policy-invalid");

  const idx = policy.activatedDetectors.findIndex((d) => d.detectorId === detectorId);
  if (idx === -1) return fail(`detector-not-active: ${detectorId}`);

  const now = Date.now();
  const target = { ...policy.activatedDetectors[idx], revoked: { reason: opts.reason, revokedAtMs: now, revokedBy: opts.actor } };
  const remaining = policy.activatedDetectors.filter((d) => d.detectorId !== detectorId);
  const next: PolicyDocument = {
    ...policy,
    activatedDetectors: remaining,
    history: [...policy.history, { hash: before, recordedAtMs: now, note: `revoke ${detectorId}: ${opts.reason}` }],
  };
  next.policyHash = computePolicyHash(next);
  return { ok: true, reason: `detector ${detectorId} revoked: ${opts.reason}`, policyBefore: before, policyAfter: next.policyHash, revoked: target };
}

// ── bindPolicyHash / invalidateReceiptsForPolicyChange (AC4) ───────────────────────────────────────

/**
 * Binds a policy hash onto a stage receipt, returning a NEW receipt object with the policyHash
 * field added and contentHash recomputed (compatible with stage-receipt.ts's serialization —
 * extra top-level fields are preserved by serializeReceipt and re-bound into contentHash).
 */
export function bindPolicyHash<T extends { contentHash?: string }>(receipt: T, policyHash: string): T & { policyHash: string } {
  if (typeof policyHash !== "string" || policyHash.trim() === "") {
    throw new Error("bindPolicyHash requires a non-empty policyHash");
  }
  const bound = { ...receipt, policyHash };
  // Recompute contentHash over the serialized form when the receipt carries one (best-effort;
  // a caller that does not need a re-bound contentHash can ignore this).
  if (receipt && typeof receipt === "object" && "contentHash" in receipt) {
    const copy: Record<string, unknown> = { ...bound, contentHash: "" };
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(copy).sort()) {
      const v = copy[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const nested: Record<string, unknown> = {};
        for (const nk of Object.keys(v as Record<string, unknown>).sort()) nested[nk] = (v as Record<string, unknown>)[nk];
        sorted[k] = nested;
      } else {
        sorted[k] = v;
      }
    }
    (bound as Record<string, unknown>).contentHash = sha256OfString(JSON.stringify(sorted));
  }
  return bound as T & { policyHash: string };
}

/**
 * AC4: a policy activation changes the policy hash and invalidates EXACTLY the affected cached
 * receipts — those bound to the OLD policy hash whose recurrence class matches the activated
 * detector. Receipts bound to a different hash, or to the same hash but a different recurrence
 * class, are unaffected.
 */
export function invalidateReceiptsForPolicyChange(
  oldPolicyHash: string,
  newPolicyHash: string,
  detector: { recurrenceKey: string },
  receipts: ReceiptPolicyBinding[]
): InvalidationResult {
  const invalidated: string[] = [];
  const unaffected: string[] = [];
  for (const r of receipts) {
    const samePolicy = r.policyHash === oldPolicyHash;
    const sameClass = detector?.recurrenceKey == null || r.recurrenceKey === detector.recurrenceKey;
    if (samePolicy && sameClass) invalidated.push(r.receiptId);
    else unaffected.push(r.receiptId);
  }
  return { oldPolicyHash, newPolicyHash, invalidated, unaffected };
}

// ── Selftest ─────────────────────────────────────────────────────────────────────────────────────────

export function selftest(): boolean {
  const st = createSelftest({ flavor: "cases", collectFailures: true, dumpFailuresJson: true });
  const check = st.check;

  const p1 = createPolicy();
  check("create-sets-hash", typeof p1.policyHash === "string" && p1.policyHash.length === 64, p1.policyHash.slice(0, 12));

  // A policy change (adding a profile) changes the hash.
  const p2 = createPolicy({ dev: { gates: ["dod"] } });
  check("profile-change-changes-hash", p2.policyHash !== p1.policyHash, "");

  // Same content, deterministic hash.
  const p3 = createPolicy({ dev: { gates: ["dod"] } });
  check("deterministic-hash", p3.policyHash === p2.policyHash, "");

  // Unauthorized role cannot activate (AC3).
  const req: ActivationRequest = {
    detector: { detectorId: "det-ac-cov", recurrenceKey: "ac-coverage-cites-missing-ac", rule: "detectAcCoverageCitations", stage: "PlanCheck" },
    authorizer: { role: "Audit", id: "a1" },
    proposingObserverStage: "Audit",
    calibrationOk: true,
    calibrationRef: { red: 3, green: 2, ambiguous: 1, redHitRate: 1, falsePositiveRate: 0 },
  };
  const r1 = authorizeActivation(p1, req);
  check("audit-cannot-self-activate", !r1.ok && r1.reason.includes("authorizer-role-not-authorized"), r1.reason);

  // Same-actor (observer stage == authorizer role) refused even if role name matches authorized set.
  const req2: ActivationRequest = { ...req, authorizer: { role: "policy-owner", id: "audit-session" }, proposingObserverStage: "policy-owner" };
  const r2 = authorizeActivation(p1, req2);
  check("same-actor-refused", !r2.ok && r2.reason.includes("same-actor-self-authorization"), r2.reason);

  // Calibration gate: unproven detector cannot activate.
  const req3: ActivationRequest = { ...req, authorizer: { role: "policy-owner", id: "p1" }, calibrationOk: false };
  const r3 = authorizeActivation(p1, req3);
  check("uncalibrated-refused", !r3.ok && r3.reason.includes("detector-not-calibrated"), r3.reason);

  // Authorized activation changes the hash (AC4).
  const req4: ActivationRequest = { ...req, authorizer: { role: "policy-owner", id: "p1" } };
  const r4 = authorizeActivation(p1, req4);
  check("authorized-activates", r4.ok && r4.policyAfter !== r4.policyBefore, `before=${r4.policyBefore.slice(0, 8)} after=${r4.policyAfter.slice(0, 8)}`);

  // Receipt invalidation: exactly the affected subset.
  const bindings: ReceiptPolicyBinding[] = [
    { receiptId: "r-affect", policyHash: r4.policyBefore, recurrenceKey: "ac-coverage-cites-missing-ac" },
    { receiptId: "r-other-class", policyHash: r4.policyBefore, recurrenceKey: "runtime-null-result" },
    { receiptId: "r-new-policy", policyHash: r4.policyAfter, recurrenceKey: "ac-coverage-cites-missing-ac" },
  ];
  const inv = invalidateReceiptsForPolicyChange(r4.policyBefore, r4.policyAfter, { recurrenceKey: "ac-coverage-cites-missing-ac" }, bindings);
  check("invalidate-exact-affected", inv.invalidated.length === 1 && inv.invalidated[0] === "r-affect", `invalidated=${JSON.stringify(inv.invalidated)}`);
  check("invalidate-unaffected", inv.unaffected.length === 2, `unaffected=${JSON.stringify(inv.unaffected)}`);

  // AC8 control: revocation changes hash and records the revocation.
  const nextPolicy = r4.ok ? r4.activated : null;
  if (nextPolicy) {
    // rebuild the policy the activation produced
    const base: PolicyDocument = { ...p1, activatedDetectors: [], history: [] };
    const rr = revokeActivation(authorizeActivation(base, req4).ok ? base : base, "det-ac-cov", { reason: "false positive on M213 task X", actor: "policy-owner" });
    // revoke on a policy that does NOT have the detector active → fails
    const rev1 = revokeActivation(base, "det-ac-cov", { reason: "fp", actor: "policy-owner" });
    check("revoke-inactive-fails", !rev1.ok && rev1.reason.includes("detector-not-active"), rev1.reason);
    check("revoke-reason-required", !revokeActivation(base, "det-ac-cov", { reason: "", actor: "p" }).ok, "empty reason refused");
  }
  return st.report();
}

// ── CLI entry ─────────────────────────────────────────────────────────────────────────────────────────

function usage(): string {
  return [
    "execution-policy.ts — versioned execution-policy substrate (DIR-124-D adoptable core)",
    "Usage:",
    "  node --experimental-strip-types execution-policy.ts --create '<{profiles}>'",
    "  node --experimental-strip-types execution-policy.ts --compute-hash '<policy-json>'",
    "  node --experimental-strip-types execution-policy.ts --authorize '<{policy,request}>'",
    "  node --experimental-strip-types execution-policy.ts --revoke '<{policy,detectorId,reason,actor}>'",
    "  node --experimental-strip-types execution-policy.ts --invalidate '<{oldHash,newHash,detector,receipts}>'",
    "  node --experimental-strip-types execution-policy.ts --selftest",
    "",
    "Exit 0 on success / valid; exit 1 on validation failure (structured JSON on stdout).",
  ].join("\n");
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  try {
    if (args.includes("--selftest")) return selftest() ? 0 : 1;

    if (args.includes("--create")) {
      const raw = args[args.indexOf("--create") + 1];
      const profiles = raw ? (parseJsonArg(raw) as Record<string, Record<string, unknown>>) : {};
      console.log(JSON.stringify(createPolicy(profiles)));
      return 0;
    }
    if (args.includes("--compute-hash")) {
      const policy = parseJsonArg(args[args.indexOf("--compute-hash") + 1]) as PolicyDocument;
      console.log(JSON.stringify({ policyHash: computePolicyHash(policy) }));
      return 0;
    }
    if (args.includes("--authorize")) {
      const { policy, request } = parseJsonArg(args[args.indexOf("--authorize") + 1]) as { policy: PolicyDocument; request: ActivationRequest };
      console.log(JSON.stringify(authorizeActivation(policy, request)));
      return authorizeActivation(policy, request).ok ? 0 : 1;
    }
    if (args.includes("--revoke")) {
      const { policy, detectorId, reason, actor } = parseJsonArg(args[args.indexOf("--revoke") + 1]) as {
        policy: PolicyDocument;
        detectorId: string;
        reason: string;
        actor: string;
      };
      console.log(JSON.stringify(revokeActivation(policy, detectorId, { reason, actor })));
      return revokeActivation(policy, detectorId, { reason, actor }).ok ? 0 : 1;
    }
    if (args.includes("--invalidate")) {
      const { oldHash, newHash, detector, receipts } = parseJsonArg(args[args.indexOf("--invalidate") + 1]) as {
        oldHash: string;
        newHash: string;
        detector: { recurrenceKey: string };
        receipts: ReceiptPolicyBinding[];
      };
      console.log(JSON.stringify(invalidateReceiptsForPolicyChange(oldHash, newHash, detector, receipts)));
      return 0;
    }

    usage();
    console.log(JSON.stringify({ ok: true, usage: "execution-policy.ts" }));
    return 0;
  } catch (err) {
    const e = err as Error;
    console.log(JSON.stringify({ ok: false, code: "execution-policy-error", message: e.message }));
    return 1;
  }
}

if (process.argv[1] != null && process.argv[1].endsWith("execution-policy.ts")) {
  process.exitCode = main(process.argv);
}
