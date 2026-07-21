---
iteration: 0
milestone: M77
date: 2026-07-21
status: needs-human
branch: exp5-m77-iteration-0
worktree: /home/yale/work/quay/milestones/M77/worktrees/iteration-0
---

# M77 iteration-0 report

## §1 What was done

Attempted to port `packages/quay/src/provider-client.js` → `provider-client.ts` as specified in the M77 charter (ADR-012 TypeScript migration P1, golden-diff).

Execution steps taken:

1. Read the original `provider-client.js` (100 lines, one exported function `connectProvider`).
2. Created `provider-client.ts` with real TypeScript types: `ConnectProviderOptions` interface for the parameter, `ProviderClient` interface for the return, and inline type annotations on all inner functions.
3. Deleted `provider-client.js`.
4. Ran `npx tsc --noEmit` — initial run produced 7 errors due to `structuredContent` being typed as `unknown` in the MCP SDK and the `readResource` return being a union type. Fixed by adding targeted type assertions at property access sites.
5. Re-ran `npx tsc --noEmit` — **exit 0** (tsc clean).
6. Ran the test suite (`node --test`, excluding live-GitHub and browser tests) — **all tests failed** with `ERR_MODULE_NOT_FOUND` for `provider-client.js`.

**Root cause:** Node.js runtime module resolution does NOT implement the Bundler `.js` → `.ts` fallback. That resolution is TypeScript compile-time only. Node 25's native TypeScript support runs `.ts` files directly, but callers must import them by their actual `.ts` extension (or a `.js` shim must re-export). Since three callers (`bin/quay.js`, `src/mcp-server.js`, `src/serve.js`) import `"./provider-client.js"` using the literal `.js` extension, deleting the `.js` file breaks Node runtime loading — regardless of what TypeScript resolves at compile time.

**Charter trigger:** "if caller changes ARE needed beyond what Bundler moduleResolution handles, outcome = `needs-human`." Caller changes are required. Outcome: **needs-human**.

The worktree was restored to its clean state (the `.ts` file was removed; the original `.js` file was restored from its content). No commit was made. The worktree branch `exp5-m77-iteration-0` is clean at the pre-iteration HEAD (`3bcf7b5`).

## §2 Hard gates

**exp5 HARD GATES dispositions (each with N/A reason):**

- `ls -1 experiments/quay-continuous-bootstrap/directives/pending/` — **N/A**: exp5 uses task-canonical directives (DIR-028 / Plan A). The canonical store is `tasks/DIR-*.md`. The exp4 `directives/pending/` path does not exist in this repo. No files to list; no dispositions required.

- `cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"` — **N/A**: No manda/hub is deployed in exp5. The `.manda/` directory does not exist in this workspace.

- `curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"` — **N/A**: Web UI server is not running and was not touched by this milestone. No port 4173 listener.

- `git worktree add ...` — **DONE** (worktree already existed at iteration start). Isolation evidence:

```
$ git -C /home/yale/work/quay worktree list
/home/yale/work/quay                                       05a0088 [master]
/home/yale/work/quay/milestones/M77/worktrees/iteration-0  3bcf7b5 [exp5-m77-iteration-0]
```

All development activity during this iteration targeted paths under `/home/yale/work/quay/milestones/M77/worktrees/iteration-0/`. No edits were made to the shared repo root.

## §3 Evidence for each Done-when

**Done-when 1: `packages/quay/src/provider-client.ts` exists and `.js` does NOT**

NOT MET. The `.ts` file was created and tested but had to be removed because deleting `.js` breaks Node runtime loading. The worktree is clean at the pre-iteration HEAD:

```
$ ls /home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/src/provider-client.*
/home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/src/provider-client.js

$ git -C /home/yale/work/quay/milestones/M77/worktrees/iteration-0 status
On branch exp5-m77-iteration-0
nothing to commit, working tree clean
```

**Done-when 2: Real TypeScript types, no `any` on signature, no `@ts-nocheck`**

NOT MET (see Done-when 1 — the `.ts` file does not exist in the committed worktree).

The `.ts` file that was authored during this iteration DID have real types (no `any` on the public signature, no `@ts-nocheck`) and tsc accepted it with exit 0. The types authored were:

```typescript
export interface ConnectProviderOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export async function connectProvider(
  { command, args, env, cwd }: ConnectProviderOptions
): Promise<ProviderClient> { ... }
```

The return type was a named `ProviderClient` interface with all 9 methods typed. This is the correct shape; it just cannot be landed without caller changes.

**Done-when 3: `npx tsc --noEmit` exits 0**

The tsc check on the authored `.ts` file passed (after fixing MCP SDK `unknown`-typed property accesses with type assertions):

```
$ cd /home/yale/work/quay/milestones/M77/worktrees/iteration-0 && npx tsc --noEmit
[no output, exit 0]
```

This was verified with both `.js` and `.ts` files present. Without the `.ts` file (current clean state), tsc still exits 0 (no regression; the original `.js` has `@ts-nocheck`).

**Done-when 4: Test suite passes green**

With both `.js` and `.ts` coexisting (tsc passes), the test suite was run:

```
$ cd /home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay
$ node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance|web-ui-browser|dir032') 2>&1 | grep -E "tests |pass |fail " | tail -5
ℹ tests 328
ℹ pass 326
ℹ fail 2
```

The 2 failures (`adr-gate.test.mjs` E3 A1/A3 and E3 A2) are pre-existing on master — identical failure on master baseline:

```
$ node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance|web-ui-browser|dir032') 2>&1 | grep -E "fail " | tail -2
ℹ fail 2
```

No regression introduced. However, when only the `.ts` file exists (`.js` deleted), ALL tests fail with `ERR_MODULE_NOT_FOUND` for `provider-client.js`, confirming the Node runtime resolution gap.

**Done-when 5: No caller file was modified**

MET. No caller was modified at any point during this iteration.

```
$ grep -r "provider-client" \
  /home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/src/ \
  /home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/bin/ \
  | grep "import"
src/mcp-server.js:import { connectProvider } from "./provider-client.js";
src/serve.js:import { connectProvider } from "./provider-client.js";
bin/quay.js:import { connectProvider } from "../src/provider-client.js";
```

All three caller import statements are unchanged from master.

## §4 Delta-V assessment

No committed change. Δv = 0 on both layers.

The investigation produced useful findings (documented in §5) that inform the required human decision. The `.ts` file was fully authored and type-checked successfully — the blocker is entirely the Node runtime resolution gap, not a typing problem.

- V_instance: no change from pre-iteration baseline
- V_meta: no change; scope discipline applied correctly (needs-human triggered rather than widening scope)

## §5 Convergence assessment

**Outcome: needs-human**

**Reason:** The TypeScript "Bundler" `moduleResolution` that resolves `.js` imports to `.ts` files is a compile-time TypeScript behavior only. Node.js runtime (even Node 25 with native TypeScript type-stripping) does NOT implement this fallback — it strictly requires the file named in the import statement to exist on disk. Three callers import `"./provider-client.js"` (literal extension): `bin/quay.js`, `src/mcp-server.js`, `src/serve.js`. Deleting `provider-client.js` causes all tests and all runtime invocations to fail with `ERR_MODULE_NOT_FOUND`.

**Decision required from human:**

One of the following approaches is needed, each involving caller changes:

**Option A — Update callers to import `.ts` directly**

Change the three import statements from `"./provider-client.js"` to `"./provider-client.ts"`. Node 25 supports this natively (type-stripping). `tsc --noEmit` with `allowImportingTsExtensions: true` already permits it. This is the cleanest migration path.

Callers to update:
- `packages/quay/bin/quay.js` line ~5: `import { connectProvider } from "../src/provider-client.js";`
- `packages/quay/src/mcp-server.js` line ~9: `import { connectProvider } from "./provider-client.js";`
- `packages/quay/src/serve.js` line ~7: `import { connectProvider } from "./provider-client.js";`

**Option B — Keep a `.js` shim**

Leave `provider-client.js` as a thin re-export shim:
```js
export { connectProvider } from "./provider-client.ts";
```
This preserves the `.js` import path for callers without touching them. Node 25 can import `.ts` from `.js`. However this is a dual-source anti-pattern and leaves the shim as permanent maintenance burden.

**Option C — Adjust tsconfig to not use Bundler**

Change `moduleResolution` to `Node16` or `NodeNext` and update all import extensions to `.js` (the standard ESM pattern for TypeScript). This is a larger scope change.

**Recommendation:** Option A is the smallest, cleanest change. It updates 3 caller lines and has no runtime ambiguity. The outer loop should expand M77 scope to include the 3 caller import updates, or create a follow-on milestone for that.

The TypeScript file (`provider-client.ts`) is ready and correct — it just cannot be landed alone.
