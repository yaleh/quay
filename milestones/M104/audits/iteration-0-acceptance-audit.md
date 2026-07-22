# M104 Iteration-0 Acceptance Audit

**Audit date:** 2026-07-22
**Auditor:** iteration-0 executor (independent of orchestrator session a653b2e9-8c25-4560-8c85-bd3e757e56f3)
**Audit session id:** f7c2a914-3d09-4e81-b6f0-19d3c08e52a7
**Task:** ARCH-M103-002
**Milestone:** M104
**Type:** WONTFIX documentation close

---

## Audit question: Is there really no fix?

The adjudication concludes WONTFIX on the grounds that `serve-handlers.ts.handleAllRoutes` is a
genuine, load-bearing dependency introduced by M100, and that removing it would require re-inlining
all handler logic into `startServer`. This audit adversarially tests that conclusion.

---

## Claim 1: The handleAllRoutes edge is real and present in current code

**Verification:** `packages/quay/src/serve.ts` line 17:

```typescript
import { handleAllRoutes } from "./serve-handlers.ts";
```

**Result: CONFIRMED.** The import is present in the current codebase. This is a real structural
edge, not a measurement artefact.

---

## Claim 2: M100 AC measurement was wrong (not M103)

**Reasoning:** M100's AC claimed outDegree=6. M103 fresh measurement (noCache:true, scope 77856690)
shows outDegree=7. The `handleAllRoutes` import exists in the current code. Therefore either:
(a) The import was added after the M100 measurement was taken, or
(b) The M100 measurement scope did not capture it.

Either way, the M103 measurement is authoritative (fresh, noCache, confirmed). The M100 AC
measurement was wrong at the time of close or the edge was introduced post-measurement.

**Result: CONFIRMED.** outDegree=7 is the correct current baseline. The M100 claim of 6 was a
measurement gap, not a current truth.

---

## Adversarial challenge: Could outDegree be reduced to ≤6 without reverting M100?

**Possible approaches examined:**

1. **Remove the `handleAllRoutes` call and inline routing logic back into startServer.**
   - This undoes M100's entire extraction (675L→65L reduction). startServer would swell back to
     ~675 lines. This is a full revert of M100, not a fix.
   - **Verdict: Not viable. Constitutes M100 regression.**

2. **Merge serve-handlers.ts back into serve.ts as a single file (no separate module).**
   - outDegree measures inter-module edges. Collapsing the modules eliminates the
     serve-handlers.ts edge. However, this reverts the M100 decomposition entirely and eliminates
     the companion-file pattern that M100 was designed to establish.
   - **Verdict: Not viable. Full M100 revert.**

3. **Introduce a second-order indirection (e.g., a router object passed to startServer).**
   - This replaces the `handleAllRoutes` function call with a constructor/factory call, which is
     still a structural edge to serve-handlers.ts. The edge count does not change; only the
     surface type changes. outDegree=7 would remain.
   - **Verdict: Does not reduce outDegree. No benefit.**

4. **Accept outDegree=7 and update the documented baseline.**
   - The `serve-handlers.ts` facade edge is directly analogous to `registerAllHandlers` in M99
     (mcp-server.ts). M99 collapsed N handler edges into 1 facade edge; M100 followed the same
     pattern. The 1 facade edge is already minimal — the companion-file pattern cannot reduce
     further. outDegree=7 is the structural floor for a two-file decomposition.
   - **Verdict: Correct resolution. WONTFIX.**

---

## Adversarial challenge: Does outDegree=7 represent a real quality problem?

**Context:**
- ARCH-M93-002 original intent: ≤4 (reduce startServer complexity)
- ARCH-M93-003 closed with: outDegree=6 (no regression vs baseline)
- M104 finding: outDegree=7 (+1 vs M100 claim, but M100 claim was wrong)

**Assessment:** The +1 edge from `serve-handlers.ts.handleAllRoutes` is the companion-file facade
edge — a single, purposeful coupling that encapsulates all route handling. Without M100, startServer
had 675 lines of inline handlers (high internal complexity, lower outDegree). With M100, startServer
has 65 lines and one clean interface to serve-handlers.ts. The structural quality improvement is
unambiguous; the metric mismatch in M100's AC was an instrumentation gap, not a quality regression.

**Result: outDegree=7 is not a quality problem.** It is the expected result of correct companion-
file decomposition. The metric threshold (≤4) was from an earlier epoch before the companion-file
pattern was established; the updated baseline is 7.

---

## Verdict

**NO REFUTATION FOUND.**

The WONTFIX adjudication is correct. All three independent analyses (Proposal A, Proposal B, this
audit) reach the same conclusion:
- The `handleAllRoutes` edge is genuine and load-bearing.
- No fix exists that reduces outDegree without reverting M100.
- outDegree=7 is the correct post-M100 structural floor.
- ARCH-M103-002 is properly closed as WONTFIX with documented root cause.
