# M79 Iteration-0 Acceptance Audit

**Audit session id:** m79-iter0-abi-ts-typed-returns-2026-07-21

**Worktree:** `/home/yale/work/quay/milestones/M79/worktrees/iteration-0`
**Branch:** `exp5-m79-iteration-0`
**Commit:** `5f7ad7c`
**Date:** 2026-07-21

---

## Check 1 — `abi.ts` exists

**Command:**
```
ls /home/yale/work/quay/milestones/M79/worktrees/iteration-0/packages/quay/src/abi.ts
```

**Output:**
```
/home/yale/work/quay/milestones/M79/worktrees/iteration-0/packages/quay/src/abi.ts
EXIT: 0
```

**File contents:**
```typescript
// Provider ABI view-model types (ADR-012 single-source ABI contract).
// All providers (native, github) and Core are type-checked against these
// interfaces via tsc --noEmit; runtime enforcement remains in
// provider-abi-conformance.test.mjs.

export interface Task {
  id: string;
  title: string;
  status: 'todo' | 'ready' | 'done' | 'needs-human';
  role: 'primitive' | 'compound';
  labels: string[];
  parent: string | null;
  children: string[];
  body: string;
  extra: Record<string, unknown>;
}

export interface AdrRecord {
  id: string;
  title: string;
  status: string;
  body: string;
}

export interface Manifest {
  [key: string]: unknown;
}
```

**Verdict: CONFIRMED** — File exists. `Task`, `AdrRecord`, `Manifest` interfaces are all present.

**`any` check on abi.ts:**
```
grep -n "any" abi.ts
grep exit: 1
```
No `any` on any field. `extra: Record<string, unknown>` and `Manifest: { [key: string]: unknown }` use `unknown` not `any`. **CONFIRMED — no `any`.**

---

## Check 2 — `ProviderClient` interface uses typed returns

**Command:**
```
grep -A 20 "export interface ProviderClient" packages/quay/src/provider-client.ts
```

**Output:**
```typescript
export interface ProviderClient {
  taskList(filter?: Record<string, unknown>): Promise<Task[]>;
  taskGet(id: string): Promise<Task>;
  taskWrite(patch: Record<string, unknown>): Promise<Task>;
  taskCheck(id: string): Promise<unknown>;          // gate result — keep unknown
  adrList(filter?: Record<string, unknown>): Promise<AdrRecord[]>;
  adrGet(id: string): Promise<AdrRecord>;
  adrWrite(patch: Record<string, unknown>): Promise<AdrRecord>;
  manifest(): Promise<Manifest>;
  close(): Promise<void>;
}
```

**Verdict: CONFIRMED** — All task/adr methods use typed returns (Task/AdrRecord/Manifest). `taskCheck` retains `Promise<unknown>` with an explicit comment (consistent with the Done-when criterion: "taskCheck uses unknown").

**Import at top of provider-client.ts:**
```typescript
import type { Task, AdrRecord, Manifest } from './abi.ts';
```
**CONFIRMED** — import is present and correct.

---

## Check 3 — No `any` type in provider-client.ts

**Command:**
```
grep -n "any" packages/quay/src/provider-client.ts
```

**Output:**
```
46:  // page (and any other taskList() caller) rendered "0 tasks" with zero
```

The only hit is in a comment (`any other taskList() caller`), not a type annotation. **CONFIRMED — no `any` type usage.**

**Note on `null as unknown as Task` casts:** The implementation uses `null as unknown as Task` and `null as unknown as AdrRecord` in error/null-return paths (6 occurrences). This is a compile-time type assertion bypass — it tells the compiler the null is a Task when it is not. This is a pre-existing pattern (mirrors the pre-typed `return null` behavior). The Done-when criteria does not prohibit this; the interface-level requirement (typed returns on `ProviderClient`) is met. This is noted as a CONCERN but does not constitute a refutation.

---

## Check 4 — `npx tsc --noEmit` exits 0

**Command:**
```
cd /home/yale/work/quay/milestones/M79/worktrees/iteration-0 && npx tsc --noEmit 2>&1; echo "EXIT_CODE: $?"
```

**Output:**
```
EXIT_CODE: 0
```

**Verdict: CONFIRMED** — TypeScript compilation is clean with zero errors.

---

## Check 5 — Test suite: 342/338/4 matches P1 baseline

**Command:**
```
cd packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance|web-ui-browser') 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

**Output:**
```
ℹ tests 342
ℹ pass 338
ℹ fail 4
```

**Baseline verification:** Tests were also run at HEAD~1 (commit `699146f`, the SELECT commit pre-M79 changes), which produced the same counts:
```
ℹ tests 342
ℹ pass 338
ℹ fail 4
```

The 4 pre-existing failures (not introduced by M79):
- `E3 A2: the REAL ADR-001 gate PASSes against the real repo's own scripts/`
- `E3 A1/A3: 'quay gate <task> --gate adr-001' end-to-end PASSes...`
- `M44 A2: audit-independence gate PASSes for a genuinely distinct session id`
- `M44 C1: 'quay gate <task> --gate audit-independence' PASSes for real...`

These failures are in the ADR-001 and audit-independence gates and appear to be environment/state-dependent (real repo state), not caused by M79 changes.

**Verdict: CONFIRMED** — 342/338/4 exactly matches the P1 baseline. No regressions introduced.

---

## Check 6 — No logic changes in provider-client.ts

**Command:**
```
git diff HEAD~1 -- packages/quay/src/provider-client.ts
```

**Summary of diff:** The diff shows only:
1. Addition of `import type { Task, AdrRecord, Manifest } from './abi.ts';`
2. `ProviderClient` interface method signatures changed from `Promise<unknown>` / `Promise<unknown[]>` to typed equivalents
3. Internal function signatures updated to match interface (e.g., `Promise<unknown[]>` → `Promise<Task[]>`)
4. Casts added on null returns: `null as unknown as Task`, `null as unknown as AdrRecord`
5. `manifest()` body: `return JSON.parse(...)` → `return JSON.parse(...) as Manifest`

No control-flow changes, no logic changes, no new error handling. All behavioral paths are identical.

**Verdict: CONFIRMED** — Only type-annotation changes, no runtime behavior change.

---

## Summary

| # | Done-when criterion | Verdict |
|---|---|---|
| 1 | `abi.ts` exists with `Task`, `AdrRecord`, `Manifest`; no `any` on any field | CONFIRMED |
| 2 | `ProviderClient` uses typed ABI returns (not `Promise<unknown>`) | CONFIRMED |
| 3 | `npx tsc --noEmit` exits 0 | CONFIRMED |
| 4 | Test suite 342/338/4 matches P1 baseline | CONFIRMED |
| 5 | No runtime behavior change / no import-resolution failures | CONFIRMED |

**CONCERNS (not blocking):**
- `null as unknown as Task` pattern (6 occurrences in implementation functions) silently lies to the type system in null/error return paths. The interface contract is correct; these are implementation-level type assertion bypasses. Future work could tighten these to `Task | null` return types, but this is outside M79 scope.

---

## Final Verdict

**NO REFUTATION FOUND**

All five Done-when criteria are independently verified. The 4 test failures are pre-existing baseline failures, not introduced by M79. TypeScript compilation is clean. No runtime behavior was changed.
