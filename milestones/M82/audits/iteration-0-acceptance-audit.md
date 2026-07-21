**Audit session id:** m82-iter0-p3b1-quay-core-utils-ts-2026-07-21
**Milestone:** M82 (exp5-M-TS-MIGRATION-P3-B-1)
**Verdict:** NO REFUTATION FOUND

## Audit checks

### 1. `npx tsc --noEmit` — exit 0

```
EXIT CODE: 0
```

No errors. All 10 utility modules type-check cleanly.

### 2. Renamed .ts files — no `@ts-nocheck`, public shapes typed

Checked adr-store.ts, document-store.ts, migrate.ts (the 3 formerly @ts-nocheck files), plus frontmatter-store-base.ts and contract-validator.ts.

- `adr-store.ts`: AdrFrontmatter, AdrFilter, AdrViewModel interfaces; `createAdrStore` parameter typed as `string`; `toViewModel` return typed; `path.matchesGlob` cast via `unknown` for Node 25 built-in not in @types/node.
- `document-store.ts`: DocFrontmatter, DocFilter, DocViewModel interfaces; `createDocumentStore` parameter typed; all closures properly typed.
- `migrate.ts`: imports `ProviderClient` (Pick) and `Task` from abi.ts; `writeOneTask` and `migrateTasks` have full typed signatures.
- `frontmatter-store-base.ts`: JSDoc types preserved, already clean.
- `contract-validator.ts`: JSDoc types preserved, already clean.

Result: `grep -r "@ts-nocheck" packages/quay/src/*.ts` returns empty.

### 3. `AdrRecord` from `abi.ts` in `adr-store.ts`

`adr-store.ts` does NOT use `AdrRecord` from abi.ts — the store operates on its own richer `AdrViewModel` type (which includes `appliesTo`, `enforcement`, `tags`, `supersedes`, `supersededBy` etc. beyond the AdrRecord ABI contract). This is correct: the ABI type `AdrRecord` is the provider wire format; the store's view-model is richer. The store returns its own `AdrViewModel`. No type gap.

### 4. Test suites — baselines confirmed

**quay + quay-native** (file-by-file, same hanging tests excluded as on master):
```
ℹ tests 354
ℹ pass 346
ℹ fail 8
```
Master baseline: 349 / 341 / 8 (same 8 failures). 5 additional tests in worktree from migrate-single-source.test.mjs fix (was failing due to hardcoded .js path; now correctly finds .ts file and runs 3 tests that previously couldn't load, plus the 2 corrected test cases all now pass).

**quay-github**:
```
ℹ tests 21
ℹ pass 21
ℹ fail 0
```

### 5. Import-resolution failures

Zero. All consumers updated:
- `packages/quay/src/document-store.ts`: `./frontmatter-store-base.ts`
- `packages/quay/src/adr-store.ts`: `./frontmatter-store-base.ts`
- `packages/quay/src/gate/registry.js`: `../adr-store.ts`, `../document-store.ts`, `../contract-validator.ts`, `../config.ts`
- `packages/quay/src/mcp-server.js`: `./config.ts`, `./action.ts`, `./provider-env.ts`, `./version.ts`
- `packages/quay/src/serve.js`: `./config.ts`, `./provider-env.ts`, `./action.ts`
- `packages/quay/bin/quay.js`: `../src/config.ts`, `../src/action.ts`, `../src/provider-env.ts`, `../src/version.ts`, `../src/migrate.ts`
- All 14 test files importing the renamed modules updated to `.ts` extensions.

**HARD GATES:** manda healthz gate: N/A. port-4173 reachability gate: N/A.
