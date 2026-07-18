# M09-gh-write — iteration-0

Worktree: `experiments/quay-perpetual-stream/milestones/M09-gh-write/worktrees/iteration-0`
Branch: `exp5-m09-iteration-0`, base `75a57df` ("exp5 SELECT m9 = M-GH-WRITE (bundled with
M-GH-PARENT): author charter").

## §1. Context read

Read ONLY `experiments/quay-perpetual-stream/charters/M09-gh-write.md` (Tier-A) and
`experiments/quay-perpetual-stream/inherited-core.md` (Tier-B), per this experiment's Tier-A/
Tier-B discipline — no wider history read.

## §2. HARD GATES — raw output (pasted verbatim, not summarized)

### Gate 1 — pending directives listing + disposition

```
$ ls experiments/quay-perpetual-stream/directives/pending/
(empty)
```
At worktree branch-point (base commit `75a57df`), `directives/pending/` was empty — zero pending
directives to disposition at dispatch time.

**Note (honesty disclosure, not a worktree-isolation violation):** partway through this
iteration, a NEW directive (`DIR-006-webui-browser-verification-regression.md`) was created
directly in the shared repo root (`/home/yale/work/quay`, outside this worktree, timestamped
2026-07-18 11:57 — after this worktree/branch had already been created and work was underway).
This is outer-loop business (a new pending directive for the NEXT SELECT decision), not
in-scope for this already-dispatched inner iteration, and its presence in the shared root is
correctly untracked/uncommitted (not a leak of THIS iteration's work) — see §8 isolation proof.
It is flagged here for the outer loop's awareness, not actioned by this inner iteration.

### Gate 2 — manda hub reachability

```
$ cat .manda/hub.addr
http://localhost:46215
$ curl -s "$(cat .manda/hub.addr)/healthz"
{"root":"/home/yale/work/quay"}
```
PASS.

### Gate 3 — localhost:4173 reachability (G7)

```
$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4173
HTTP 200
```
PASS.

### Gate 4 — worktree creation

```
$ git worktree list | grep M09
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M09-gh-write/worktrees/iteration-0  75a57df [exp5-m09-iteration-0]
```
PASS — worktree exists on branch `exp5-m09-iteration-0`, base `75a57df`.

## §3. it0 systematic-explore checks (charter §4.4, run before first work)

### (a) Ceiling/floor arithmetic re-verification

Re-read `packages/quay-github/src/mcp-server.js` and `github-client.js` at worktree HEAD
(pre-edit) directly: confirmed `task_write`'s `inputSchema` was `{ id: z.string(), status:
z.string() }` only (no title/body/labels), and `github-client.js#get()`'s comment block
self-documented `parent` unconditionally left `null` in the single-issue path. Both
PR-ABI-001 and PR-ABI-002 were still live-confirmed present on this worktree's base commit —
matches charter-authoring-time evidence, no drift.

### (b) Gate-hash/transclusion

`GATE-HASH-REF` cited by reference in the charter; verified via
`experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference
charters/M09-gh-write.md` — PASS (hash matches pinned source, no drift). The full literal
gate text was resolved and supplied to this dispatched iteration by the orchestrator per the
charter's own "Charter thinness ≠ agent prompt thinness" clause.

### (c) Dogfooding evidence-gate

Every Done-when clause below is backed by pasted live command output, not prose — see §6.

### (d) Domain-misfit audit-channel

Per `inherited-core.md`'s CONSOLIDATED `domain-audit-channel ≡ CI-job` pattern
(φ-confirmed at m3, consolidated at m7's ABSORB, reused at m8): attempted a fresh,
independently-provisioned Docker container (`debian:stable-slim`, never had this milestone's
code "baked in" as trusted) that installs `curl`, `git`, Node.js 22.x, and the real `gh` CLI
(via the official apt repo — chosen specifically because M08's own audit channel found a
`gh`-CLI-missing gap in a minimal `node:20-slim` image, and this milestone's fix is
CENTRALLY dependent on `gh api` calls, so a container without `gh` would not actually
exercise the code path under audit), then runs `npm install` + the updated
`provider-abi-conformance.test.mjs` conformance suite.

This container run proved far slower than M08's own (which used a pre-built `node:20-slim`
image with `gh` NOT installed, and got a partial-negative result specifically because of
that gap) — installing `gh` from scratch inside `debian:stable-slim` pulls a large
`apt-get`/`dpkg` dependency chain. See §3(d)-RESULT below for the outcome as observed at
report-writing time.

**§3(d)-RESULT:** The container completed successfully (exit code 0) after ~24 minutes
(dominated by `apt-get`/`dpkg` package-installation overhead for `curl`, `git`, Node.js 22.x,
and the `gh` CLI inside a bare `debian:stable-slim` image — no caching/pre-built layer
available in this environment). Full raw output:

```
$ docker run --rm --name m09-audit -v "$(pwd)":/repo:ro -e GH_TOKEN="$(gh auth token)" debian:stable-slim bash /run.sh
v22.23.1
gh version 2.96.0 (2026-07-02)
https://github.com/cli/cli/releases/tag/v2.96.0
quay-native mcp: serving tasks from /tmp/quay-abi-conf-native-tJ0Hg6
PASS [native/primitive/task_list] task_list returns array including ABI-P1 (got 3 tasks)
PASS [native/primitive/task_get] task_get ABI-P1 -> status=todo, role=primitive
PASS [native/primitive/task_write-status] task_write status todo->ready -> status=ready
PASS [native/primitive/task_check] task_check ABI-P1 (status=ready, AC checked) -> ok=true, gate=execute->done
PASS [native/compound/task_list] task_list includes ABI-C1 (compound parent)
PASS [native/compound/task_get] task_get ABI-C1 -> role=compound, children=["ABI-C1-CHILD"]
PASS [native/compound/task_write-status] task_write status (idempotent ready->ready) on compound parent -> status=ready
PASS [native/compound/task_check] task_check ABI-C1 (compound, child done) -> ok=true, childrenStatus present=true
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
PASS [github/primitive/task_list] task_list includes known real issues gh-3, gh-4 (got 11 tasks)
PASS [github/primitive/task_get] task_get gh-3 -> status=ready, role=primitive
PASS [github/primitive/task_write-status] task_write status (idempotent, ready->ready) -> status=ready
PASS [github/primitive/task_write-unsupported-field-probe] task_write with 'title' field on github (NOW a real, supported write per M09-gh-write) -> isError=undefined, title (idempotent re-assert of its own current value)=true — MATCHES native's own explicit-field write support (real write, not silent drop; see gap-list PR-ABI-001 closure)
PASS [github/primitive/task_write-hard-error-floor-probe] task_write with unsupported 'parent' field on github -> isError=true (expected true: explicit MCP tool error, not a silent no-op — PR-ABI-001 floor, Done-when 4)
PASS [github/primitive/task_check] task_check gh-3 -> ok=false, gate=execute->done
PASS [github/compound/task_get] task_get gh-7 -> role=compound, children=["gh-5","gh-6"], status=done
PASS [github/compound/task_list] task_list's own gh-7 entry has role=compound (role derived by list(), not just get())
PASS [github/compound/task_get-vs-task_list-parent-probe] gh-5's 'parent' field: task_get -> "gh-7", task_list -> "gh-7" — CONFIRMED FIXED, both entry points agree (PR-ABI-002 closed, M09-gh-write); native's own store.js#get()/list() already resolved 'parent' identically -- github now matches
PASS [github/compound/task_write-status] task_write status (idempotent, done->done) on compound parent gh-7 -> status=done
PASS [github/compound/task_check] task_check gh-7 (compound, both children done, issue CLOSED) -> ok=true, childrenStatus present=true

--- 19 scenario cells run (native: 8, github: 11) ---
native/primitive: 4 cells, 4 ok, 0 fail
github/primitive: 6 cells, 6 ok, 0 fail
native/compound: 4 cells, 4 ok, 0 fail
github/compound: 5 cells, 5 ok, 0 fail

All provider-abi-conformance scenario cells passed (this is a CONFORMANCE report, not a claim of feature-parity — see the unsupported-field probe above and dashboard.md/gap-list.md for divergence findings logged separately, not failed as test assertions since they are documented, expected-per-scope divergences, not regressions).
```

**Verdict: PASS, clean, in a genuinely independent, freshly-provisioned environment** (bare
`debian:stable-slim`, never had Node/gh pre-installed, entirely separate from the dev sandbox
that wrote the fix) — all 19 scenario cells passed, INCLUDING both new probes added this
iteration (`task_write-hard-error-floor-probe`, and the re-purposed
`task_write-unsupported-field-probe`/`task_get-vs-task_list-parent-probe`). Unlike M08's own
audit-channel run (which hit a `gh`-CLI-missing gap because its minimal image didn't install
`gh`), this container deliberately installed the real `gh` CLI first, so the audit channel
genuinely exercised the same `execFileSync("gh", ...)` code path production traffic would —
no environment-provisioning gap to explain away this time.

## §4. Work completed

1. **PR-ABI-001, real write (`writeFields`, `github-client.js`)** — new `writeFields(id,
   fields)` function: applies `title`/`body` via `gh api repos/<owner>/<repo>/issues/<n> -X
   PATCH -f title=... -f body=...` (same PATCH-on-self endpoint `setStatus` already uses for
   state); applies `labels` by computing an add/remove diff against the issue's current
   NON-status/lane ("other") labels only — `status:*`/`lane:*` labels remain owned by the
   separate `setStatus`/`computeStatusWrite` path, untouched by this write, preserving
   DESIGN.md §3.1's precedence discipline. Uses the same `ghApiRun`/`ghApiJson` helpers and
   the same race-tolerant try/catch-on-404 pattern `setStatus` already established.

2. **PR-ABI-001, MCP schema + hard-error floor (`mcp-server.js`)** — `task_write`'s
   `inputSchema` rebuilt as an explicit `z.object({id, status?, title?, body?,
   labels?}).catchall(z.unknown())`. This required source-diving into the MCP SDK
   (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` +
   `zod-compat.js#normalizeObjectSchema`) to discover: a plain JS shape object (`{k:
   zodType}`) is auto-detected as a "raw shape" and silently rebuilt into a default
   `z.object()` that STRIPS unrecognized keys before the handler ever sees them (this is the
   actual mechanism behind PR-ABI-001's originally-reported silent-drop bug); but an ACTUAL
   Zod schema instance (has `_def`) is used AS GIVEN, so `.catchall(z.unknown())` on an
   explicit `z.object({...})` preserves unrecognized keys through validation. The handler
   then explicitly scans `Object.keys(rawArgs)` against a `TASK_WRITE_SUPPORTED_FIELDS` set
   and returns `{isError: true, ...}` for anything outside `{id, status, title, body,
   labels}` — turning the prior silent no-op into a real, explicit tool-level error.

3. **PR-ABI-002 (`github-client.js#get()`)** — `get()` now calls `buildParentIndex
   (fetchAllIssues())` before building its view-model (the SAME functions `list()` already
   used), instead of passing `null` and unconditionally leaving `parent` empty. Closes the
   `task_get` vs `task_list` parent-resolution asymmetry.

4. **Test fixture fix (`fake-gh.mjs`)** — extended to answer the paged list call
   (`repos/yaleh/quay-fixture/issues`) with an empty page `[]`, since `get()` now issues this
   call too (a consequence of item 3) — needed to keep `task-check-passthrough.test.mjs`
   passing (see §5 regression note).

5. **`provider-abi-conformance.test.mjs` updated** — `task_write-unsupported-field-probe`
   scenario changed from asserting the OLD silent-drop divergence to asserting the NEW
   matching-native real-write behavior (idempotent re-assert of `gh-3`'s own current title);
   NEW `task_write-hard-error-floor-probe` scenario added (probes `parent: "gh-7"`, asserts
   `isError === true`); `task_get-vs-task_list-parent-probe` changed from asserting the OLD
   divergence to asserting the NEW symmetry (`getParent === "gh-7" && listParent === "gh-7"`).

6. **`capability-matrix.md` re-scored** — write table's title/body/labels rows for `github`
   moved from `none` to `full` (PR-ABI-001 closed) with live-evidence citations; parent/
   children write row marked as a deliberate, charter-scoped exclusion, now hard-erroring
   instead of silently no-op'ing; read table's parent/children row moved from `partial` to
   `full` (PR-ABI-002 closed). Summary cell-count section and findings section rewritten to
   reflect 13/14 non-N/A cells now full/full symmetric (up from 9/13).

7. **`dashboard.md` re-scored** — new "Chart-1 re-score (M09-gh-write...)" section appended,
   explicitly marked ITERATION-0 DRAFT pending iteration-1's independent re-derivation (this
   experiment's own standing convention, precedent at M08).

## §5. Live-write evidence — Done-when 1-3 (title/body/labels)

A dedicated **scratch/test issue was created specifically for this milestone**
(`yaleh/quay#11`, title-prefixed `[M09-GH-WRITE-SCRATCH]`) — the existing conformance-suite
fixtures (`gh-3`/`gh-4`/`gh-5`/`gh-7`) were NOT used for non-idempotent mutation, per the
milestone's own safety discipline (do not mutate an issue that matters to this repo's own
tracking).

Fresh live re-verification (run at report-writing time, via `packages/quay-github/src/
github-client.js#writeFields` directly):

```
$ node live-verify.mjs   # (temp script, deleted before commit — see §8)
=== BEFORE (gh-11 current state) ===
{
  "id": "gh-11",
  "title": "[M09-GH-WRITE-SCRATCH] title mutated by task_write live test",
  ...
  "labels": ["m09-test-label"],
  "body": "body mutated by task_write live test (M09-gh-write iteration-0)"
}
=== WRITE: title+body+labels ===
{
  "id": "gh-11",
  "title": "[M09-GH-WRITE-SCRATCH] title re-mutated iteration-0 fresh-verify",
  ...
  "labels": ["m09-test-label", "m09-fresh-verify"],
  "body": "body re-mutated by fresh iteration-0 verify at 2026-07-18T12:00:49.766Z"
}
=== AFTER (via get()) ===
{
  "id": "gh-11",
  "title": "[M09-GH-WRITE-SCRATCH] title re-mutated iteration-0 fresh-verify",
  ...
  "labels": ["m09-test-label", "m09-fresh-verify"],
  "body": "body re-mutated by fresh iteration-0 verify at 2026-07-18T12:00:49.766Z"
}
```

`AFTER` was fetched via a fresh `get()` call (a real, independent `gh api` round-trip, not
just the write call's own echoed response) — confirms the mutation is real and persisted on
GitHub's servers, not merely reflected in the write call's return value. Original mutation
(prior to this report's fresh re-verify pass, same mechanism) additionally confirmed
independently via the raw `gh` CLI itself:

```
$ gh issue view 11 --repo yaleh/quay --json number,title,body,labels
{"body":"body mutated by task_write live test (M09-gh-write iteration-0)","labels":[{"name":"lane:execution",...},{"name":"m09-test-label",...}],"number":11,"title":"[M09-GH-WRITE-SCRATCH] title mutated by task_write live test"}
```

**Done-when 1 (title), 2 (body), 3 (labels): MET** — all three real, live-mutating writes
against a real `yaleh/quay` issue (`gh-11`, dedicated scratch issue), verified via
independent `gh issue view`/`get()` round-trips, not just the write call's own response.

## §6. Binary Done-when checklist — evidence

### 1. `[x]` `task_write` with a real `title` value against a real scratch/test issue actually changes the title

See §5 — `gh-11` title mutated and independently re-confirmed via `gh issue view`.

### 2. `[x]` `task_write` with a real `body` value actually changes the body

See §5 — `gh-11` body mutated and independently re-confirmed.

### 3. `[x]` `task_write` with a real `labels` value actually adds/removes labels

See §5 — `gh-11` labels changed (`m09-fresh-verify` added, `lane:execution` correctly
preserved as it is a status/lane label not targeted by this write), independently
re-confirmed.

### 4. `[x]` `task_write` with an unimplemented field (`parent`/`children`) returns an explicit MCP tool error

Live-verified via the REAL MCP server over stdio (`@modelcontextprotocol/sdk`'s own
`Client`/`StdioClientTransport`, not a hand-rolled RPC client), spawning
`packages/quay-github/bin/quay-github.js mcp`:

```
$ node mcp-hard-error-probe.mjs   # (temp script, deleted before commit — see §8)
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
=== HARD-ERROR-FLOOR PROBE: task_write gh-5 {parent: 'gh-7'} (unsupported field) ===
{
  "content": [
    {
      "type": "text",
      "text": "task_write: unsupported field(s) [parent] — this Provider does not implement writing parent (e.g. parent/children write is explicitly out of scope, see M09-gh-write charter). Supported fields: id, status, title, body, labels."
    }
  ],
  "isError": true
}
```
`isError: true`, clear descriptive message — not a silent no-op. **MET.**

### 5. `[x]` `task_get gh-5` reports `parent` matching `task_list`'s result (PR-ABI-002 fixed)

Fresh live re-verification via `github-client.js` directly:

```
$ node parent-symmetry-verify.mjs   # (temp script, deleted before commit — see §8)
=== task_get gh-5 ===
parent: "gh-7"
=== task_list -> gh-5 entry ===
parent: "gh-7"
=== SYMMETRIC? === true
```
Both entry points now agree — `"gh-7"` from both `get()` and `list()` for the same real
task. **MET.**

### 6. `[x]` conformance suite updated + full test suite passes (pasted raw output)

`provider-abi-conformance.test.mjs` updated per §4 item 5. Direct fresh re-run of just this
file:

```
$ node packages/quay/test/provider-abi-conformance.test.mjs
quay-native mcp: serving tasks from /tmp/quay-abi-conf-native-rrnffw
PASS [native/primitive/task_list] task_list returns array including ABI-P1 (got 3 tasks)
PASS [native/primitive/task_get] task_get ABI-P1 -> status=todo, role=primitive
PASS [native/primitive/task_write-status] task_write status todo->ready -> status=ready
PASS [native/primitive/task_check] task_check ABI-P1 (status=ready, AC checked) -> ok=true, gate=execute->done
PASS [native/compound/task_list] task_list includes ABI-C1 (compound parent)
PASS [native/compound/task_get] task_get ABI-C1 -> role=compound, children=["ABI-C1-CHILD"]
PASS [native/compound/task_write-status] task_write status (idempotent ready->ready) on compound parent -> status=ready
PASS [native/compound/task_check] task_check ABI-C1 (compound, child done) -> ok=true, childrenStatus present=true
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
PASS [github/primitive/task_list] task_list includes known real issues gh-3, gh-4 (got 11 tasks)
PASS [github/primitive/task_get] task_get gh-3 -> status=ready, role=primitive
PASS [github/primitive/task_write-status] task_write status (idempotent, ready->ready) -> status=ready
PASS [github/primitive/task_write-unsupported-field-probe] task_write with 'title' field on github (NOW a real, supported write per M09-gh-write) -> isError=undefined, title (idempotent re-assert of its own current value)=true — MATCHES native's own explicit-field write support (real write, not silent drop; see gap-list PR-ABI-001 closure)
PASS [github/primitive/task_write-hard-error-floor-probe] task_write with unsupported 'parent' field on github -> isError=true (expected true: explicit MCP tool error, not a silent no-op — PR-ABI-001 floor, Done-when 4)
PASS [github/primitive/task_check] task_check gh-3 -> ok=false, gate=execute->done
PASS [github/compound/task_get] task_get gh-7 -> role=compound, children=["gh-5","gh-6"], status=done
PASS [github/compound/task_list] task_list's own gh-7 entry has role=compound (role derived by list(), not just get())
PASS [github/compound/task_get-vs-task_list-parent-probe] gh-5's 'parent' field: task_get -> "gh-7", task_list -> "gh-7" — CONFIRMED FIXED, both entry points agree (PR-ABI-002 closed, M09-gh-write); native's own store.js#get()/list() already resolved 'parent' identically -- github now matches
PASS [github/compound/task_write-status] task_write status (idempotent, done->done) on compound parent gh-7 -> status=done
PASS [github/compound/task_check] task_check gh-7 (compound, both children done, issue CLOSED) -> ok=true, childrenStatus present=true

--- 19 scenario cells run (native: 8, github: 11) ---
native/primitive: 4 cells, 4 ok, 0 fail
github/primitive: 6 cells, 6 ok, 0 fail
native/compound: 4 cells, 4 ok, 0 fail
github/compound: 5 cells, 5 ok, 0 fail

All provider-abi-conformance scenario cells passed (this is a CONFORMANCE report, not a claim of feature-parity — see the unsupported-field probe above and dashboard.md/gap-list.md for divergence findings logged separately, not failed as test assertions since they are documented, expected-per-scope divergences, not regressions).
```

Full existing test suite (native + github, all 31 test files, serial to avoid port-collision
false-negatives in parallel mode):

```
$ node --test --test-concurrency=1 packages/*/test/*.test.mjs
... (1017 individual PASS assertions across 31 files) ...
✔ packages/quay/test/web-ui-browser.test.mjs (12446.503221ms)
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 245333.170277
```
**31/31 test FILES pass, 0 fail. MET.**

**Regression caught and fixed during this iteration** (honesty disclosure): the PR-ABI-002
fix to `get()` (§4 item 3) initially broke `task-check-passthrough.test.mjs` (19 failures),
because that test's `fake-gh.mjs` fixture only understood single-issue GET calls, but `get()`
now also issues a paged list call to build the parentIndex. Fixed by extending the fixture
(§4 item 4) to answer that call with an empty page — the fixture's own assertions never
depend on `parent`, so this is a safe, targeted fix, not a workaround. Re-ran the file after
the fix: all 19 assertions passed (also included, unchanged, in the 31/31 full-suite result
above).

### 7. `[x]` capability-matrix.md / dashboard.md re-scored from live evidence, PR-ABI-001/002 entries updated

See §4 items 6-7 for the mechanism; see below for the derivation, cited from live evidence
gathered in this same iteration (§5/§6).

**Provider-ABI cov re-derivation:**
```
read:  5/5 (was 4.5/5 — PR-ABI-002 closed, get()/list() parent now symmetric)
write: 4/5 (was 1/5 — PR-ABI-001 closed for title/body/labels; parent/children remains a
             deliberate charter-scoped exclusion, now hard-erroring correctly)
gate:  2/2 (unchanged)
skill: 1/1 (unchanged)
cov = (5+4+2+1) / (5+5+2+1) = 12/13 = 0.9231 (up from 0.654)
```

**VT chart-1 re-score:**
```
$ python3 -c "print(23.50+18.00+18.40+18.00+12.75+20*12/13)"
109.11153846153847
```
Total: **109.11/120** (up from 103.73/120 at m8's ABSORB), Δv = **+5.38** — larger than the
charter's own conservative pre-dispatch estimate (Δv̂≈+2.9), because the realized write
fraction (4/5) exceeded the charter's conservative "~3/5 realistic" placeholder AND the
read-side PR-ABI-002 fix contributed an additional read 0.90→1.00 delta the placeholder
arithmetic did not separately itemize. Full derivation, arithmetic re-check, and VT curve
append are in `dashboard.md`'s own appended M09 section (marked ITERATION-0 DRAFT, per this
experiment's standing iteration-1-independently-re-derives convention — precedent: M08).

`capability-matrix.md`'s write/read tables and "Summary — cell count"/"Findings" sections
updated with PR-ABI-001/PR-ABI-002 CLOSED write-ups citing this iteration's own live command
output (see §4 item 6, and the file's own diff for full text).

**Done-when 7: MET (provisional/draft status, per this experiment's own convention — see
Reflection §9).**

## §7. Files changed (summary)

```
 experiments/quay-perpetual-stream/dashboard.md                              |  42 +++++++++
 .../milestones/M03-abi-eval/capability-matrix.md                            |  83 ++++++++++------
 packages/quay-github/src/github-client.js                                   |  90 ++++++++++++++++--
 packages/quay-github/src/mcp-server.js                                      | 105 ++++++++++++++++++---
 packages/quay-github/test/fixtures/fake-gh.mjs                              |  25 ++++-
 packages/quay/test/provider-abi-conformance.test.mjs                        |  82 ++++++++++------
 6 files changed, 341 insertions(+), 86 deletions(-)
```

## §8. End-of-iteration isolation proof

Temp verification scripts (`live-verify.mjs`, `parent-symmetry-verify.mjs`,
`mcp-hard-error-probe.mjs`, `smoke-test.mjs`, and others used during development) were all
deleted before commit — confirmed via `git status --short` showing only the 6 intentional
file changes below.

**Worktree (`experiments/quay-perpetual-stream/milestones/M09-gh-write/worktrees/iteration-0`):**
```
$ git status --short
 M experiments/quay-perpetual-stream/dashboard.md
 M experiments/quay-perpetual-stream/milestones/M03-abi-eval/capability-matrix.md
 M packages/quay-github/src/github-client.js
 M packages/quay-github/src/mcp-server.js
 M packages/quay-github/test/fixtures/fake-gh.mjs
 M packages/quay/test/provider-abi-conformance.test.mjs
```
(6 modified files, all in-scope, no leftover temp files, no untracked stray files.)

**Shared repo root (`/home/yale/work/quay`):**
```
$ git status --short
?? experiments/quay-perpetual-stream/directives/pending/DIR-006-webui-browser-verification-regression.md
?? tasks/DIR-006.md
```
The shared root shows two untracked files, but they are **NOT a leak from this iteration's
work** — both are `DIR-006`, a new directive created by a separate, concurrent process
directly in the shared root (timestamped 2026-07-18 11:57, AFTER this worktree/branch had
already been created), entirely disjoint from the 6 files this iteration touched (see §2
Gate 1 note). This iteration's own edits are 100% isolated to the worktree above — zero of
this iteration's file changes appear in the shared root's `git status`.

## §9. Reflection — status and next-step for iteration-1

**All 7 Done-when clauses are MET with live evidence** (§6), including the "real-write
stretch" (Done-when 1-3) that the charter treated as potentially-infeasible-fallback —
title, body, AND labels all got real, verified writes against a dedicated scratch issue, not
just the non-negotiable hard-error floor (Done-when 4).

**Provisional / needs iteration-1 re-verification (be honest, per this experiment's own base
rate):**
- Done-when 7's `capability-matrix.md`/`dashboard.md` numbers (cov 0.654→0.923, VT
  103.73→109.11/120, Δv=+5.38) are computed by THIS iteration from THIS iteration's own live
  evidence — correct by construction if the underlying live-write/live-read evidence is
  correct, but not yet independently re-derived from a FRESH worktree by a differently-primed
  agent. Flag as DRAFT in `dashboard.md` (already done).
- The domain-misfit audit-channel Docker container run (it0d) completed cleanly — see
  §3(d)-RESULT (19/19 scenario cells PASS in a fresh, independently-provisioned
  `debian:stable-slim` container with a real `gh` CLI installed). Not provisional; this is
  settled evidence. One process note for future milestones: this container took ~24 minutes
  end-to-end, almost entirely `apt-get`/`dpkg` overhead installing `curl`/`git`/Node.js/`gh`
  from scratch with no cached layer available — a future milestone's audit-channel run could
  go faster by building (and reusing) a purpose-built image with these preinstalled, rather
  than re-installing from scratch every time.
- `gh-11` (the scratch issue used for live-write evidence) remains open on `yaleh/quay` in a
  test-mutated state (title/body/labels all bear test-marker text) — this is intentional
  (a dedicated scratch fixture, not a production-tracking issue) but iteration-1 or a later
  milestone may want to close it or leave a note explaining its purpose, so a future reader
  of the issue tracker isn't confused by it.

**Next-step recommendation for iteration-1:** independently re-verify Done-when 1-7 from a
FRESH worktree (branch `exp5-m09-iteration-1`) using fresh command output (not trusting this
report's pasted transcripts), specifically re-checking: (a) the live write evidence against
`gh-11` still holds (re-read current state, don't just re-trust this report); (b) the
`get()`/`list()` parent symmetry fix on `gh-5`/`gh-7`; (c) the hard-error floor via the real
MCP stdio path; (d) full test suite still 31/31; (e) independently re-derive
`capability-matrix.md`/`dashboard.md`'s cov and VT arithmetic from scratch; (f) the
domain-misfit audit-channel Docker result above (already PASS, but per this experiment's own
base rate, re-run rather than just re-trust).
