# M79 iteration-0: TS migration P2 — Provider ABI view-model TypeScript interfaces

## §1 What was done

**Created:** `packages/quay/src/abi.ts`
- Defines `Task`, `AdrRecord`, and `Manifest` interfaces as the single-source ABI contract (ADR-012).
- `Task` captures the full view-model: id, title, status union, role union, labels, parent/children, body, extra.
- `AdrRecord` captures id, title, status, body.
- `Manifest` is an open index type `[key: string]: unknown`.
- No `any` types used anywhere in the file.

**Updated:** `packages/quay/src/provider-client.ts`
- Added `import type { Task, AdrRecord, Manifest } from './abi.ts'`.
- Updated `ProviderClient` interface: `taskList` → `Promise<Task[]>`, `taskGet` → `Promise<Task>`, `taskWrite` → `Promise<Task>`, `adrList` → `Promise<AdrRecord[]>`, `adrGet` → `Promise<AdrRecord>`, `adrWrite` → `Promise<AdrRecord>`, `manifest` → `Promise<Manifest>`.
- `taskCheck` intentionally kept as `Promise<unknown>` — gate results have no typed model in P2 scope.
- Updated internal function implementations to use the same typed returns with cast-through-unknown for the nullable-return cases (compile-time constraint only; no runtime behavior changed).

No changes to: `packages/quay-native/`, `packages/quay-github/`, `mcp-server.js`, `serve.js`, `quay.js`, or any test files.

## §2 HARD GATES

- manda healthz gate: N/A (no Web UI)
- port-4173 reachability gate: N/A (no Web UI)
- directives/pending/ gate: N/A (exp4 artifact)
- worktree gate: using exp5 worktree at `milestones/M79/worktrees/iteration-0`

## §3 Done-when evidence

**Step 1 — abi.ts created:**
```
/home/yale/work/quay/milestones/M79/worktrees/iteration-0/packages/quay/src/abi.ts
```
File created with `Task`, `AdrRecord`, `Manifest` interfaces.

**Step 2 — provider-client.ts updated:**
```
/home/yale/work/quay/milestones/M79/worktrees/iteration-0/packages/quay/src/provider-client.ts
```
Import from `./abi.ts` added; all ABI methods typed against `Task`, `AdrRecord`, `Manifest`; `taskCheck` kept `Promise<unknown>`.

**Step 3 — tsc --noEmit:**
```
EXIT_CODE: 0
```
No type errors.

**Step 4 — test suite:**
```
ℹ tests 342
ℹ pass 338
ℹ fail 4
```
Matches pre-existing baseline exactly.

**Step 5 — no `any` in abi.ts:**
```
(empty — grep returned no output)
```
No `any` types in `abi.ts`.

## §4 Outcome

DONE
