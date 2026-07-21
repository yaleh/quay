---
iteration: 0
milestone: M77
date: 2026-07-21
status: done
branch: exp5-m77-iteration-0
worktree: /home/yale/work/quay/milestones/M77/worktrees/iteration-0
commit: a630814
---

# M77 iteration-0 report

## §1 What was done

Ported `packages/quay/src/provider-client.js` → `provider-client.ts` as specified in the M77 charter (ADR-012 TypeScript migration P1, amended scope).

This is a retry after the original iteration-0 ended `needs-human` because the charter initially prohibited caller changes and Node.js runtime requires the exact file extension named in the import statement. The amended charter explicitly authorises updating the three caller import statements and (discovered during this execution) a fourth importer in the test suite.

Steps taken:

1. Created `packages/quay/src/provider-client.ts` with named interfaces:
   - `ConnectProviderOptions` — parameter type for `connectProvider()`
   - `ProviderClient` — return type (9 methods typed)
   No `@ts-nocheck`; no `any` on the public signature; type assertions at MCP SDK `unknown`-typed property accesses (`r.structuredContent`, `r.content`).
2. Deleted `packages/quay/src/provider-client.js`.
3. Updated import extension `.js` → `.ts` in the three named callers:
   - `packages/quay/bin/quay.js` (line 9)
   - `packages/quay/src/mcp-server.js` (line 48)
   - `packages/quay/src/serve.js` (line 17)
4. Discovered and updated a fourth importer: `packages/quay/test/task-check.test.mjs` (line 25) — this file imports `connectProvider` directly. Without this fix the test file crashes at load with `ERR_MODULE_NOT_FOUND`; updating it is required to maintain the pre-existing test counts. The charter lists 3 callers in §Scope but the Done-when #5 only specifies "no other change to those files" (the three named callers) — updating the test file is a necessary consequence of the rename, not a logic change.
5. Ran `npx tsc --noEmit` — exit 0.
6. Ran the test suite (excluding `serve-github`, `provider-abi-conformance`, `web-ui-browser`) — 338 pass, 4 fail (all 4 failures are pre-existing on master: E3 A2, E3 A1/A3, M44 A2, M44 C1).
7. Committed on branch `exp5-m77-iteration-0` at `a630814`.

## §2 Hard gates

**Gate 1 — directives/pending listing:**

```
$ ls -1 /home/yale/work/quay/experiments/quay-continuous-bootstrap/directives/pending/
ls: cannot access '/home/yale/work/quay/experiments/quay-continuous-bootstrap/directives/pending/': No such file or directory
```

Path does not exist — exp5 uses task-canonical directives (DIR-028 / Plan A). The directive store is `tasks/DIR-*.md`. The exp4 `directives/pending/` path was never created in this repo. No files listed; no file-level dispositions required. Disposition: N/A (path does not exist in this workspace).

**Gate 2 — manda hub healthz:**

```
$ cat /home/yale/work/quay/.manda/hub.addr
http://localhost:34303

$ curl -s "$(cat /home/yale/work/quay/.manda/hub.addr)/healthz"
{"root":"/home/yale/work/quay"}
```

Manda hub is running and healthy at `http://localhost:34303`.

**Gate 3 — port 4173 reachability (Web UI):**

```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
200
```

Note: The charter marks this gate N/A for M77 ("No Web UI surface touched"). The server happens to be running (returning 200) but this milestone does not depend on it. Stated N/A per charter; the 200 is incidental.

**Gate 4 — worktree isolation:**

Worktree already existed at iteration start (created by the outer loop prior to this execution). Stated explicitly: ALREADY SATISFIED.

```
$ git -C /home/yale/work/quay worktree list
/home/yale/work/quay                                       f589ce2 [master]
/home/yale/work/quay/milestones/M77/worktrees/iteration-0  a630814 [exp5-m77-iteration-0]
```

All edits this iteration targeted paths under `/home/yale/work/quay/milestones/M77/worktrees/iteration-0/`. No edits made to the shared repo root.

## §3 Evidence for each Done-when

**Done-when 1: `provider-client.ts` exists; `provider-client.js` does NOT**

```
$ ls -la /home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/src/provider-client.*
-rw-rw-r-- 1 yale yale 5842 Jul 21 16:34 /home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/src/provider-client.ts
```

MET. Only `.ts` file present; `.js` deleted.

**Done-when 2: Real TypeScript types; no `any` on signature; no `@ts-nocheck`**

```
$ grep -n "ts-nocheck\|ConnectProviderOptions\|ProviderClient\|any" \
  /home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/src/provider-client.ts
8:export interface ConnectProviderOptions {
15:export interface ProviderClient {
27:export async function connectProvider({ command, args, env, cwd }: ConnectProviderOptions): Promise<ProviderClient> {
45:  // page (and any other taskList() caller) rendered "0 tasks" with zero
```

MET. Named interfaces `ConnectProviderOptions` and `ProviderClient` on the public signature. No `@ts-nocheck`. No `any` on the public signature (the word `any` appears only in a code comment on line 45).

**Done-when 3: `npx tsc --noEmit` exits 0**

```
$ cd /home/yale/work/quay/milestones/M77/worktrees/iteration-0 && npx tsc --noEmit 2>&1; echo "EXIT:$?"
EXIT:0
```

MET. tsc exits 0 with no output.

**Done-when 4: Test suite passes with same pass/fail counts as master baseline**

Master baseline (from master branch):
```
$ cd /home/yale/work/quay/packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance|web-ui-browser') 2>&1 | grep -E "^ℹ (tests|pass|fail)"
ℹ tests 342
ℹ pass 338
ℹ fail 4
```

Worktree (after migration):
```
$ cd /home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance|web-ui-browser') 2>&1 | grep -E "^ℹ (tests|pass|fail)"
ℹ tests 342
ℹ pass 338
ℹ fail 4
```

Failing tests (identical between master and worktree):
```
✖ E3 A2: the REAL ADR-001 gate PASSes against the real repo's own scripts/ (conforming, B7's own domain)
✖ E3 A1/A3: 'quay gate <task> --gate adr-001' end-to-end PASSes against the real ADR-001/B7 and appends a real GateEvent
✖ M44 A2: audit-independence gate PASSes for a genuinely distinct session id (real script)
✖ M44 C1: `quay gate <task> --gate audit-independence` PASSes for real (independent fixture) and appends a real GateEvent
```

MET. 342 tests, 338 pass, 4 fail — exact match with master baseline. All 4 failures are pre-existing (adr-gate and audit-independence tests, both in cryst-e3-adr-gate.test.mjs / dir032-audit-independence.test.mjs).

Note on scope: The charter's Done-when #5 specifies "Each of `mcp-server.js`, `serve.js`, `quay.js` imports `"./provider-client.ts"`". This was MET for all three. Additionally, `test/task-check.test.mjs` was found to directly import `provider-client.js` and was updated — required to maintain Done-when #4 (green test counts). The note for this is: the charter enumerated 3 callers; 4 actually existed.

**Done-when 5: The three named callers import `"./provider-client.ts"` (`.ts` extension)**

```
$ grep "provider-client" \
  /home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/src/mcp-server.js \
  /home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/src/serve.js \
  /home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/bin/quay.js | grep import
/home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/src/mcp-server.js:import { connectProvider } from "./provider-client.ts";
/home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/src/serve.js:import { connectProvider } from "./provider-client.ts";
/home/yale/work/quay/milestones/M77/worktrees/iteration-0/packages/quay/bin/quay.js:import { connectProvider } from "../src/provider-client.ts";
```

MET. All three named callers import `./provider-client.ts` (`.ts` extension). The only other change to those files was this one-word extension change — no logic, API, or structure changes.

## §4 Delta-V assessment

This is a pure L_C (type coverage) hardening milestone. No functional logic changed.

- V_instance: delta from this milestone is the addition of real TypeScript types to a previously un-typed public API surface. The public signature of `connectProvider` is now formally typed with named interfaces visible to tsc. Δv_instance is small-positive (L_C improvement; no L_T or L_G change).
- V_meta: methodology correct — scope-discipline from iteration-0-scope-discovery propagated to charter amendment; the amended charter correctly expanded scope to include caller updates; execution followed the charter without widening further.

Δv = small-positive on V_instance (typed API surface); 0 on V_meta (no methodology change).

## §5 Convergence assessment

**Outcome: done**

All five Done-when criteria are MET with literal pasted evidence:

1. `provider-client.ts` exists; `.js` does not.
2. Named interfaces on public signature; no `any`; no `@ts-nocheck`.
3. `npx tsc --noEmit` exits 0.
4. Test counts match master baseline exactly (342/338/4).
5. Three named callers import `.ts` extension; no other changes to those files.

The milestone is complete. The TypeScript migration for `provider-client.js` is landed on branch `exp5-m77-iteration-0` at commit `a630814`. Ready for ABSORB into master.

One factual note for the outer loop: the charter listed 3 callers for import updates; a 4th importer (`test/task-check.test.mjs`) was found during execution and updated. This does not affect convergence — the change is strictly an extension update in a test file, not a logic change — but should be reflected in any follow-on charter templates for TS migration milestones (test files that directly import migrated modules also need updating).
