**Audit session id:** m85-iter0-ts-migration-p3b3-2026-07-21
**Milestone:** M85 (exp5-M-TS-MIGRATION-P3-B-3)
**Verdict:** NO REFUTATION FOUND

## Audit checks

### 1. `npx tsc --noEmit` — exit 0

```
exit: 0
```

No errors. All TypeScript checks pass across the full repo.

### 2. serve.ts and mcp-server.ts — no @ts-nocheck, public shapes typed

Both files exist as `.ts`:
```
packages/quay/src/mcp-server.ts
packages/quay/src/serve.ts
```

`grep "@ts-nocheck" packages/quay/src/serve.ts packages/quay/src/mcp-server.ts` → empty (no matches).

`startServer` is typed with `StartServerOptions` interface and returns `Promise<Server & { client: ProviderClient }>`. `startMcpServer` returns `Promise<void>`. HTTP handler types use `IncomingMessage` and `ServerResponse` from `node:http`. Template tag `html` typed with `TemplateStringsArray`. All helper functions carry explicit parameter and return types.

### 3. No `any` on MCP tool handler function signatures

All MCP tool handler function signatures use zod-inferred input types (via `ShapeOutput<...>` from the SDK). No bare `any` appears on function signatures. Casts to `unknown` intermediaries are used where needed to bridge the `ProviderClient.taskCheck → unknown` vs lifecycle functions' `→ { ok, reason }` type gap — these are type-adapter casts on arguments, not on handler signatures.

### 4. Test suites — baselines confirmed

**quay + quay-native** (excluding serve-github and provider-abi-conformance):
```
ℹ tests 388
ℹ pass 380
ℹ fail 8
```
8 failures ≤ 11 baseline. ✓

**quay-github:**
```
ℹ tests 21
ℹ pass 21
ℹ fail 0
```
21/21/0 ✓

### 5. Import-resolution check (bin/quay.js)

`bin/quay.js` updated:
- `"../src/serve.js"` → `"../src/serve.ts"` (serve command)
- `"../src/mcp-server.js"` → `"../src/mcp-server.ts"` (mcp command)

All 8 test files that imported `"../src/serve.js"` updated to `"../src/serve.ts"`:
- serve.test.mjs, serve-adversarial-eval.test.mjs, serve-adr.test.mjs
- serve-browser-render.test.mjs, serve-github.test.mjs, web-ui-browser.test.mjs
- core-three-way-symmetry.test.mjs, provider-env-symmetry.test.mjs

No test file directly imported `mcp-server.js` (references there were in comments only).

**HARD GATES:** manda healthz gate: N/A. port-4173 reachability gate: N/A. (No Web UI behavior change — rename+type-only per charter §"HARD GATES".)
