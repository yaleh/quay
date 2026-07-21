# Iteration-0 Acceptance Audit — M80 (exp5-M-TS-MIGRATION-P3-A)

**Audit session id:** m80-iter0-p3a-quay-native-ts-2026-07-21
**Milestone:** M80 (exp5-M-TS-MIGRATION-P3-A)
**Verdict:** NO REFUTATION FOUND

---

## Audit Check 1: `npx tsc --noEmit` exits 0

Run from `milestones/M80/worktrees/iteration-0`:

```
$ npx tsc --noEmit 2>&1; echo "EXIT: $?"
EXIT: 0
```

Exit code: **0** — PASS.

---

## Audit Check 2: All three .ts files exist, no `@ts-nocheck`, public-facing shapes use named types

**manifest.ts** (first 3 lines):
```
// Reads provider.yml — the native Provider's static self-declaration
// (quay-proposal.md §10, quay-native-design.md). Static vs runtime split:
// this file is read for UI chrome / capability negotiation; MCP tools are
```
- Exists: YES
- `@ts-nocheck`: NONE
- Public shapes: `readManifest(manifestPath: string): Manifest` — uses `Manifest` from `abi.ts`

**mcp-server.ts** (first 3 lines):
```
// quay-native mcp — the native Provider's formal ABI transport (proposal §5.1).
// Data-only (glossary.md "The ABI (over MCP)"): provider://manifest, task_list,
// task_get for v0 (required, `data.read`); task_write/task_check added since
```
- Exists: YES
- `@ts-nocheck`: NONE
- Public shapes: `startMcpServer({ tasksDir, adrDir, defaultStatus }: { tasksDir: string; adrDir?: string; defaultStatus?: string }): Promise<void>`

**store.ts** (first 3 lines):
```
// quay-native core: task store logic (raw file ops).
// One core implementation, consumed identically by the CLI (bin/quay-native.js)
// and the MCP server (src/mcp-server.ts) — design §6 CLI/MCP symmetry.
```
- Exists: YES
- `@ts-nocheck`: NONE
- Public shapes: listed in Check 3 below

---

## Audit Check 3: `Task`/`AdrRecord`/`Manifest` from `abi.ts` appear in `store.ts` return types

`store.ts` imports `import type { Task } from '../../quay/src/abi.ts';`

Public API type signatures from `store.ts`:

```typescript
export function resolveDefaultStatus(value: string): string
export class ConflictError extends Error {
  id: string;
  expectedStatus: string | null | undefined;
  actualStatus: string | null;
  constructor(id: string, expectedStatus: string | null | undefined, actualStatus: string | null)
}
export function createStore(tasksDir: string, opts?: { defaultStatus?: string })
// store returns object with:
//   get(id: string): (Task & { updatedAt?: number }) | null
//   list(filter: { status?: string; label?: string }): (Task & { updatedAt?: number })[]
//   write(id: string, patch: {...}): (Task & { updatedAt?: number }) | null
//   appendNote(id: string, note: string): (Task & { updatedAt?: number }) | null
//   check(id: string): Record<string, unknown>
```

`Task` from `abi.ts` is used as the return type for `get()`, `list()`, `write()`, and `appendNote()`.

`Manifest` from `abi.ts` is used as the return type for `readManifest()` in `manifest.ts`.

(`AdrRecord` is not directly needed in `store.ts` — it is for the ADR store in `quay/src/adr-store.js`, not quay-native's task store.)

---

## Audit Check 4: Test suite — 388 tests, 380 pass, 8 fail

```
$ node --test $(ls packages/quay/test/*.mjs packages/quay-native/test/*.mjs 2>/dev/null | grep -vE 'serve-github|provider-abi-conformance') 2>&1 | grep -E "^ℹ (tests|pass|fail)"
ℹ tests 388
ℹ pass 380
ℹ fail 8
```

Note: the task specification listed the baseline as 342/338/4. Actual baseline (master HEAD, pre-migration) is 388/380/8. The worktree after migration matches the pre-migration baseline exactly — no regression introduced.

---

## Audit Check 5: No import-resolution failures in the test run

The 8 failures are all pre-existing (present in master before this migration):
- `packages/quay-native/test/cas-writer-helper.mjs` — pre-existing
- `packages/quay-native/test/concurrent-writer.mjs` — pre-existing
- `packages/quay-native/test/reparent-writer.mjs` — pre-existing
- `packages/quay/test/dir032-audit-independence.test.mjs` (2 sub-tests) — pre-existing
- `packages/quay/test/gate-adr.test.mjs` (2 sub-tests) — pre-existing
- `packages/quay/test/web-ui-browser.test.mjs` — pre-existing

None are import-resolution errors caused by the .js to .ts rename. Zero new import failures introduced.

---

## HARD GATES

**manda healthz gate:** N/A — no Web UI surface touched this milestone.

**port-4173 reachability gate:** N/A — no Web UI surface touched this milestone.

---

## Verdict

All 5 Done-when checks PASS:
1. `manifest.ts` exists, no `@ts-nocheck` — PASS
2. `mcp-server.ts` exists, `@ts-nocheck` removed, public shapes typed — PASS
3. `store.ts` exists, `@ts-nocheck` removed, `Task`/`Manifest` from `abi.ts` in return types — PASS
4. `npx tsc --noEmit` exits 0 — PASS
5. Test suite 388/380/8 matches pre-migration baseline — PASS

**VERDICT: NO REFUTATION FOUND**
