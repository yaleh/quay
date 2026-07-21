# Iteration-0 Acceptance Audit — M81 (exp5-M-TS-MIGRATION-P3-C)

**Audit session id:** m81-iter0-p3c-quay-github-ts-2026-07-21
**Milestone:** M81 (exp5-M-TS-MIGRATION-P3-C)
**Verdict:** NO REFUTATION FOUND

---

## Audit checks

### 1. `npx tsc --noEmit` — exit 0

Run from `milestones/M81/worktrees/iteration-0`:

```
EXIT: 0
```

Exit code confirmed 0. No type errors.

### 2. `.ts` files exist, no `@ts-nocheck`, public shapes typed

**manifest.ts** — first 3 lines:
```
// Reads provider.yml (proposal §10) — static self-declaration for the
// GitHub Provider. Mirrors quay-native's src/manifest.js shape for
// consistency (design §6 "native as conformance reference").
```
No `@ts-nocheck` present. `readManifest()` has explicit `Manifest` return type.

**mcp-server.ts** — main export signature:
```typescript
export async function startMcpServer({ owner, repo }: { owner: string; repo: string }): Promise<void>
```
No `@ts-nocheck` present. Parameter types + return type explicit.

**github-client.ts** — `issueToViewModel` signature:
```typescript
export function issueToViewModel(issue: Record<string, unknown>, parentIndex: Map<string, string[]> | null = null): Task
```
No `@ts-nocheck` present. Returns `Task` from `abi.ts`.

### 3. `Task` from `abi.ts` in `github-client.ts`; `Manifest` in `manifest.ts`

**github-client.ts** imports:
```typescript
import type { Task } from "../../quay/src/abi.ts";
```
`issueToViewModel` returns `Task`; `list()` returns `Task[]`; `get()` returns `Task | null`; `setStatus()` returns `Task | null`; `create()` returns `Task | null`.

**manifest.ts** imports:
```typescript
import type { Manifest } from "../../quay/src/abi.ts";
```
`readManifest()` returns `Manifest`.

### 4. Test baselines

**quay + quay-native (excl. serve-github + provider-abi-conformance):**
```
ℹ tests 388
ℹ pass 380
ℹ fail 8
```
Matches baseline (388/380/8).

**quay-github offline (all 13 test files):**
```
ℹ tests 21
ℹ pass 21
ℹ fail 0
```
Matches baseline (21/21/0). All pass.

### 5. No import-resolution failures in test runs

All test files import from `../src/github-client.ts`, `../src/manifest.ts`, `../src/mcp-server.ts` (updated from `.js` to `.ts`). No `ERR_MODULE_NOT_FOUND` errors in either test suite run. Node 25 resolves `.ts` imports natively (strips types at load time).

The `bin/quay-github.js` static import and dynamic `import()` calls also updated to `.ts`.

---

## Hard gates

**manda healthz gate:** N/A — no Web UI surface touched.

**port-4173 reachability gate:** N/A — no Web UI surface touched.

---

## Adversarial checks

The `task-check-passthrough.test.mjs` file contains adversarial break/restore tests (QN-072, QN-073) that temporarily mutate `github-client.ts` to confirm gate assertions have real teeth. All three adversarial cycles completed and restored the file to its original content. Confirmed by the `assert(restored === original, ...)` assertions passing.

