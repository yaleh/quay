# M12-abi-parent-write — iteration-0

Worktree: `experiments/quay-perpetual-stream/milestones/M12-abi-parent-write/worktrees/iteration-0`
Branch: `exp5-m12-iteration-0`, base `9ae3cd3`.

**Resumption note (honesty disclosure, required by the dispatch prompt for this iteration):**
iteration-0 was originally dispatched to a prior agent instance that crashed on a transient API
error (socket closed) after ~22 minutes of work, leaving substantial real, uncommitted work in
this worktree. That work — `github-client.js`'s `reconcileChildCheckboxes`/`writeChildren`/
`writeParent`, `mcp-server.js`'s schema/handler wiring, and the `task_write-children-real-*`
probes in `provider-abi-conformance.test.mjs` — was independently reviewed by a human, confirmed
correct/complete, and is **inherited verified-correct** by this iteration, not redone from
scratch. The full pre-existing test suite (30 files at that point) had already been run and
confirmed green, including live GitHub API calls, before this iteration resumed. What this
iteration ADDED: live verification of `writeParent` (add + reassignment, the one code path with
zero live-verification backing it at resumption time), a corresponding `task_write-parent-real-*`
probe trio in the conformance suite, and finalization of `dashboard.md`/`capability-matrix.md`'s
draft claims (which, at resumption, cited (d) parent-add and (e) reassignment evidence that did
not yet exist — this iteration captured that evidence for real, confirming the draft text's
claims were accurate once actually run).

## §1. Context read

Read `experiments/quay-perpetual-stream/charters/M12-abi-parent-write.md` (Tier-A) and
`experiments/quay-perpetual-stream/inherited-core.md` (Tier-B pinned pointer), per this
experiment's Tier-A/Tier-B discipline.

## §2. HARD GATES — raw output (pasted verbatim, not summarized)

### Gate 1 — pending directives listing + disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
```
(empty — no output, directory has zero pending directive files.) Zero pending directives to
disposition this iteration.

### Gate 2 — manda hub reachability

```
$ cat /home/yale/work/quay/.manda/hub.addr
http://localhost:46215
$ curl -s "http://localhost:46215/healthz"
{"root":"/home/yale/work/quay"}
```
PASS. (`.manda/hub.addr` lives at the shared repo root, not per-worktree — same discipline
M09-gh-write's iteration-0 used.)

### Gate 3 — localhost:4173 reachability (G7)

```
$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4173
HTTP 200
```
PASS.

### Gate 4 — worktree creation

```
$ git worktree list | grep M12
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M12-abi-parent-write/worktrees/iteration-0  9ae3cd3 [exp5-m12-iteration-0]
```
PASS — worktree exists on branch `exp5-m12-iteration-0`, base `9ae3cd3`. All of this iteration's
edits target paths under this worktree, not the shared root at repo root (§8 has the isolation
proof).

## §3. it0 systematic-explore checks (charter §4.4, re-verified before this iteration's own work)

### (a) Ceiling/floor arithmetic re-verification

Re-confirmed against the CURRENT `dashboard.md` (not stale): the m9 ABSORB total was
**109.11/120**, Provider-ABI cov 12/13=0.9231 (read 5/5, write 4/5, gate 2/2, skill 1/1).
Closing write to 5/5 moves cov to 13/13=1.00, Provider-ABI term 20×1.00=20.00 (+1.54 vs
20×0.9231=18.46), so total 109.11+1.54=**110.65/120** — matches the charter's own ceiling
exactly (verified again below in §6 after the real work).

### (b) Gate-hash/transclusion

```
$ bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M12-abi-parent-write.md
PASS: experiments/quay-perpetual-stream/charters/M12-abi-parent-write.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
```
PASS — no drift. The literal HARD GATES text (lines 100-131 of
`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`) was supplied in full in this
iteration's own dispatch prompt (not just a hash), satisfying the charter's own "charter thinness
≠ agent prompt thinness" clause.

### (c) Dogfooding evidence-gate

Every Done-when clause below is backed by a pasted diff, raw test output, or a real `gh issue
view`/direct-client-call transcript — see §6.

### (d) Domain-misfit audit-channel

Per `inherited-core.md`'s consolidated `domain-audit-channel ≡ CI-job` pattern, this milestone's
own `provider-abi-conformance.test.mjs` is the domain's existing, already-twice-confirmed (M03,
M09) audit channel — a third reuse, same domain. This iteration used it as the primary evidence
mechanism for the new `writeParent` probes (§4/§6), consistent with M09's own precedent. (Unlike
M09's own it0d, this iteration did not additionally stand up a fresh Docker container — the
charter's it0d for M12 names the SAME mechanism, `provider-abi-conformance.test.mjs`, as the
domain-audit-channel, without requiring a fresh-container re-run; the conformance suite itself
already runs against the real live GitHub API via `gh`, which is the independent-environment
property M09's container was chasing for a DIFFERENT reason — that milestone's it0d text
specifically called for a container. This milestone's it0d text (§4.4d in the charter) says only
"a THIRD reuse of this convention" — the conformance suite reuse itself, not an additional
container — so no container run was performed this iteration.)

## §4. Work completed (inherited + this iteration's additions)

### Inherited from the crashed prior agent (verified, not redone)

1. **`github-client.js`** — `reconcileChildCheckboxes(body, desiredChildNumbers)` (pure function),
   `writeChildren(id, desiredChildIds)`, `writeParent(id, newParentId)`, `fetchRawBody`,
   `patchBody` helpers, all exported from `createGithubClient()`'s return object.
2. **`mcp-server.js`** — `TASK_WRITE_SUPPORTED_FIELDS` extended with `parent`/`children`, zod
   schema extended (`parent: z.string().nullable().optional()`, `children:
   z.array(z.string()).optional()`), tool description updated, handler wired to call
   `writeChildren`/`writeParent`.
3. **`provider-abi-conformance.test.mjs`** — hard-error-floor probe repointed from `parent` to
   `assignee` (parent is now supported); `task_write-children-real-add`/`-remove`/`-restore`
   probes against `gh-11`.

### This iteration's additions

4. **`provider-abi-conformance.test.mjs`** — three new probes:
   `task_write-parent-real-add` (`task_write{id:"gh-11", parent:"gh-12"}`, asserts `gh-12`'s
   `children` now includes `gh-11`), `task_write-parent-real-reassign`
   (`task_write{id:"gh-11", parent:"gh-13"}`, asserts `gh-12`'s children no longer includes
   `gh-11` AND `gh-13`'s children now does), `task_write-parent-real-restore`
   (`task_write{id:"gh-11", parent:null}`, asserts `gh-13`'s children no longer includes
   `gh-11` — leaves both scratch parents childless again for future test runs, mirroring the
   inherited `children-real-restore` probe's discipline).
5. **Cleanup of stray state left by the crashed prior agent's manual testing**: found `gh-13`
   already had a stray `- [ ] #11` checkbox line (from partial manual testing before the crash)
   while `gh-12` did not — patched `gh-13`'s body back to its clean, childless state via a direct
   `gh api ... -X PATCH` call before running any scripted probes, so this iteration's evidence
   starts from a known-clean baseline (see §6 for the before/after transcripts that confirm this).
6. **`dashboard.md`/`capability-matrix.md` review** — the inherited draft text already claimed
   live evidence for scenarios (a)-(e) including parent-add and reassignment, which did NOT
   actually exist at resumption (no test probe or transcript backed them). This iteration
   captured that evidence for real (§6) and confirms the draft text's claims are now accurate —
   no correction was needed to the substance of the claims (see §6 Done-when 6 for the exact
   verification), only the underlying evidence now genuinely exists to back them.

## §5. Write-semantics decision (charter Done-when 2 — stated explicitly, not implicit)

As documented in `github-client.js`'s own header comment above `writeChildren`/`writeParent`
(inherited from the crashed agent, verified correct by inspection and by this iteration's live
tests):

- **`children: [...]` write** edits task X's OWN body: the desired child id set is reconciled
  against X's existing checkbox lines — children no longer desired are REMOVED, newly-desired
  children are APPENDED as new `- [ ] #<n>` lines, and any surviving line's existing checked state
  (`[x]`) is PRESERVED verbatim (never regenerated from scratch).
- **`parent: <id>` write** edits the TARGET parent's body: a `- [ ] #<X>` line referencing X is
  added there (existing checked state preserved if the line already exists). If X currently has a
  DIFFERENT parent (reassignment, detected via the same `buildParentIndex()` logic `get()`/`list()`
  already use), the checkbox line referencing X is ALSO removed from the OLD parent's body — a
  second, separate PATCH against the old parent issue. `parent: null` removes X's line from its
  current parent (if any) and adds none.
- **`parent` and `children` are mutually exclusive in a single `writeFields`-adjacent call** —
  they mutate DIFFERENT issues' bodies; a combined call would need to reconcile two
  potentially-conflicting cross-issue edits in one pass, deliberately deferred (not needed by any
  Done-when clause).

This is the FULL bidirectional reassign-parent semantics the charter's item 2 described as the
target, not the narrower "add/remove-child-on-one-issue primitive" fallback the charter's item 7
flagged as an acceptable narrower outcome. **No scope was narrowed — full semantics shipped and
live-verified (§6)**, so charter Done-when 8 (new backlog row for narrowed scope) does NOT apply
this iteration; noted explicitly per Done-when 8's own instruction to state this rather than leave
it implicit.

## §6. Binary Done-when checklist — evidence

### 1. `[x]` `github-client.js` gains a parent/children write function, pasted diff

```diff
+export function reconcileChildCheckboxes(body, desiredChildNumbers) {
+  const src = body || "";
+  const desired = new Set(desiredChildNumbers.map(String));
+  const existingChecked = new Map(); // number -> true/false (checked state)
+  const lineRe = /^\s*-\s*\[([ xX])\]\s*#(\d+)\s*$/;
+  const lines = src.split("\n");
+  const keptLines = [];
+  for (const line of lines) {
+    const m = lineRe.exec(line);
+    if (m) {
+      const num = m[2];
+      if (desired.has(num)) {
+        existingChecked.set(num, m[1] !== " ");
+        keptLines.push(line); // preserve verbatim, including checked state
+      }
+      // else: a checkbox line for a child no longer desired -- dropped.
+    } else {
+      keptLines.push(line);
+    }
+  }
+  let newBody = keptLines.join("\n");
+  const toAppend = [...desired].filter((n) => !existingChecked.has(n));
+  if (toAppend.length > 0) {
+    const sep = newBody.endsWith("\n") || newBody === "" ? "" : "\n";
+    newBody = newBody + sep + toAppend.map((n) => `- [ ] #${n}`).join("\n") + "\n";
+  }
+  return newBody;
+}
```
(Full diff for `github-client.js`, 167 insertions across `reconcileChildCheckboxes`,
`fetchRawBody`, `patchBody`, `writeChildren`, `writeParent` — see `git diff` in §7. `writeParent`'s
core reassignment logic:)

```diff
+  function writeParent(id, newParentId) {
+    const m = /^gh-(\d+)$/.exec(id);
+    if (!m) throw new Error(`quay-github: invalid task id for writeParent: ${id}`);
+    const childNumber = m[1];
+    const allIssues = fetchAllIssues();
+    const parentIndex = buildParentIndex(allIssues);
+    const currentParents = parentIndex.get(id) ?? [];
+    const currentParentId = currentParents.length > 0 ? currentParents[0] : null;
+    if (newParentId !== null) {
+      const pm = /^gh-(\d+)$/.exec(newParentId);
+      if (!pm) throw new Error(`quay-github: invalid parent id: ${newParentId}`);
+    }
+    if (currentParentId !== null && currentParentId !== newParentId) {
+      // Reassignment (or removal): drop the checkbox line from the OLD parent's body.
+      const oldParentNumber = /^gh-(\d+)$/.exec(currentParentId)[1];
+      const oldParentIssue = allIssues.find((i) => `gh-${i.number}` === currentParentId);
+      const oldParentBody = oldParentIssue ? (oldParentIssue.body ?? "") : fetchRawBody(oldParentNumber);
+      const remainingChildren = extractChildRefs(oldParentBody)
+        .filter((cid) => cid !== id)
+        .map((cid) => /^gh-(\d+)$/.exec(cid)[1]);
+      const newOldParentBody = reconcileChildCheckboxes(oldParentBody, remainingChildren);
+      if (newOldParentBody !== oldParentBody) {
+        patchBody(oldParentNumber, newOldParentBody);
+      }
+    }
+    if (newParentId !== null && newParentId !== currentParentId) {
+      // Add the checkbox line to the NEW parent's body.
+      const newParentNumber = /^gh-(\d+)$/.exec(newParentId)[1];
+      const newParentIssue = allIssues.find((i) => `gh-${i.number}` === newParentId);
+      const newParentBody = newParentIssue ? (newParentIssue.body ?? "") : fetchRawBody(newParentNumber);
+      const desiredChildren = [
+        ...extractChildRefs(newParentBody).map((cid) => /^gh-(\d+)$/.exec(cid)[1]),
+        childNumber,
+      ];
+      const newNewParentBody = reconcileChildCheckboxes(newParentBody, desiredChildren);
+      if (newNewParentBody !== newParentBody) {
+        patchBody(newParentNumber, newNewParentBody);
+      }
+    }
+    return get(id);
+  }
...
-  return { list, get, setStatus, writeFields, check };
+  return { list, get, setStatus, writeFields, writeChildren, writeParent, check };
```
**MET.** Checked-state preservation is verified live in Done-when 4 below.

### 2. `[x]` Write semantics stated explicitly

See §5 above — stated in full, not implicit.

### 3. `[x]` `mcp-server.js` accepts `parent`/`children`, stale hard-error text removed, diff pasted

```diff
-  const TASK_WRITE_SUPPORTED_FIELDS = new Set(["id", "status", "title", "body", "labels"]);
+  const TASK_WRITE_SUPPORTED_FIELDS = new Set([
+    "id", "status", "title", "body", "labels", "parent", "children",
+  ]);
...
       title: z.string().optional(),
       body: z.string().optional(),
       labels: z.array(z.string()).optional(),
+      parent: z.string().nullable().optional(),
+      children: z.array(z.string()).optional(),
     })
     .catchall(z.unknown());
...
       description:
-        "Patch one task's status/title/body/labels in the GitHub Provider's backing repository. " +
-        "`parent`/`children` write is not supported (returns an explicit error); any other " +
-        "unrecognized field also returns an explicit error rather than silently no-op'ing.",
+        "Patch one task's status/title/body/labels/parent/children in the GitHub Provider's " +
+        "backing repository. `parent`/`children` write mutates checkbox lines ('- [ ] #<n>') in " +
+        "issue body text (the same convention the read side already parses) — `children` edits " +
+        "this task's OWN body, `parent` edits the TARGET parent's body (and the OLD parent's body " +
+        "on reassignment); existing checked ('[x]') state is preserved. Any other unrecognized " +
+        "field returns an explicit error rather than silently no-op'ing.",
...
-        `does not implement writing ${unsupported.join("/")} (e.g. parent/children write ` +
-        `is explicitly out of scope, see M09-gh-write charter). Supported fields: ` +
+        `does not implement writing ${unsupported.join("/")}. Supported fields: ` +
...
+        if (children !== undefined) {
+          task = client.writeChildren(id, children);
+        }
+        if (parent !== undefined) {
+          task = client.writeParent(id, parent);
+        }
```
The old text citing "M09-gh-write charter" as the reason `parent`/`children` were rejected is
gone; the hard-error floor (rejecting genuinely unsupported fields) is retained — see the
`assignee` probe in Done-when 5.

**MET.**

### 4. `[x]` Real live `gh issue view` before/after transcripts proving parent-add AND reassignment

**Scenario (a) — children add** (inherited mechanism, re-confirmed fresh this iteration):
```
$ node -e '... client.writeChildren("gh-11", ["gh-3"]) ...'
BEFORE: {"body":"body re-mutated by fresh iteration-0 verify at 2026-07-18T12:00:49.766Z\n"}
AFTER (writeChildren return): "body re-mutated by fresh iteration-0 verify at 2026-07-18T12:00:49.766Z\n- [ ] #3\n"
$ gh issue view 11 -R yaleh/quay --json body   # independent confirm
{"body":"body re-mutated by fresh iteration-0 verify at 2026-07-18T12:00:49.766Z\n- [ ] #3\n"}
```

**Scenario (b) — checked-state preservation** (this iteration, run exactly as
`capability-matrix.md`'s draft text describes: manually check `- [x] #3` on gh-11, re-write
`children:["gh-3"]`, confirm the check state survives):
```
$ gh api repos/yaleh/quay/issues/11 -X PATCH -f 'body=body re-mutated by fresh iteration-0 verify at 2026-07-18T12:00:49.766Z
- [x] #3
'
$ gh issue view 11 -R yaleh/quay --json body
{"body":"body re-mutated by fresh iteration-0 verify at 2026-07-18T12:00:49.766Z\n- [x] #3\n"}

$ node -e '... client.writeChildren("gh-11", ["gh-3"]) ...'   # idempotent re-write, same set
"body re-mutated by fresh iteration-0 verify at 2026-07-18T12:00:49.766Z\n- [x] #3\n"

$ gh issue view 11 -R yaleh/quay --json body   # independent confirm — [x] state SURVIVED
{"body":"body re-mutated by fresh iteration-0 verify at 2026-07-18T12:00:49.766Z\n- [x] #3\n"}
```
Confirmed: re-writing the SAME desired child set does not reset the checked state.

**Scenario (c) — removal / cleanup:**
```
$ node -e '... client.writeChildren("gh-11", []) ...'
"body re-mutated by fresh iteration-0 verify at 2026-07-18T12:00:49.766Z\n"
$ gh issue view 11 -R yaleh/quay --json body   # independent confirm — restored to original
{"body":"body re-mutated by fresh iteration-0 verify at 2026-07-18T12:00:49.766Z\n"}
```
gh-11 restored EXACTLY to its pre-probe state (matches its state before ANY of this iteration's
probes ran).

**Scenario (d) — parent add** (the primary gap this iteration closed — zero live-verification
existed at resumption):
```
BEFORE:
$ gh issue view 12 -R yaleh/quay --json body
{"body":"Scratch parent A created live by M12-abi-parent-write iteration-0 to live-verify parent write/reassignment semantics. Deliberately created, will remain as durable evidence (per QN-028/QN-029/M09 precedent).\n"}

$ node -e '... client.writeParent("gh-11", "gh-12") ...'
{
  "id": "gh-11",
  ...
  "parent": "gh-12",
  "children": [],
  ...
}

AFTER:
$ gh issue view 12 -R yaleh/quay --json body   # independent confirm
{"body":"Scratch parent A created live by M12-abi-parent-write iteration-0 to live-verify parent write/reassignment semantics. Deliberately created, will remain as durable evidence (per QN-028/QN-029/M09 precedent).\n- [ ] #11\n"}
```
`- [ ] #11` checkbox line added to gh-12's body — REAL, confirmed via independent `gh issue view`.

**Scenario (e) — reassignment** (the second half of the primary gap — bidirectional
add-to-new/remove-from-old in one call):
```
BEFORE:
$ gh issue view 12 -R yaleh/quay --json body
{"body":"...\n- [x] #11\n"}   # (checked manually between (d) and (e) to also test preservation semantics across the parent path)
$ gh issue view 13 -R yaleh/quay --json body
{"body":"Scratch parent B created live by M12-abi-parent-write iteration-0 to live-verify parent write/reassignment semantics. Deliberately created, will remain as durable evidence.\n"}

$ node -e '... client.writeParent("gh-11", "gh-13") ...'
{
  "id": "gh-11",
  ...
  "parent": "gh-13",
  ...
}

AFTER:
$ gh issue view 12 -R yaleh/quay --json body   # independent confirm — line REMOVED
{"body":"Scratch parent A created live by M12-abi-parent-write iteration-0 to live-verify parent write/reassignment semantics. Deliberately created, will remain as durable evidence (per QN-028/QN-029/M09 precedent).\n"}
$ gh issue view 13 -R yaleh/quay --json body   # independent confirm — line ADDED
{"body":"Scratch parent B created live by M12-abi-parent-write iteration-0 to live-verify parent write/reassignment semantics. Deliberately created, will remain as durable evidence.\n- [ ] #11\n"}
```
Both halves independently confirmed via `gh issue view`: the checkbox line referencing gh-11 was
REMOVED from gh-12's body AND ADDED to gh-13's body, in one `writeParent` call. **Note (honest
disclosure):** the checked state (`[x]`) from gh-12's line was NOT carried over to the fresh line
added on gh-13 (gh-13's new line is `- [ ] #11`, unchecked) — this is the correct, expected
behavior per the design in §5 (checked state is a property of a specific issue's own body/list,
not a property that travels with the child reference across a reassignment; the charter's Done-when
3 preservation requirement only covers "reordering/re-deriving the children list" on the SAME
issue, not a cross-issue reassignment inventing a state that never existed on the target issue).

**Cleanup (restore scratch issues to clean state for future test runs):**
```
$ node -e '... client.writeParent("gh-11", null) ...'
{ "id": "gh-11", ..., "parent": null, "children": [], ... }
$ gh issue view 12 -R yaleh/quay --json body
{"body":"...evidence (per QN-028/QN-029/M09 precedent).\n"}
$ gh issue view 13 -R yaleh/quay --json body
{"body":"...evidence.\n"}
$ gh issue view 11 -R yaleh/quay --json body
{"body":"body re-mutated by fresh iteration-0 verify at 2026-07-18T12:00:49.766Z\n"}
```
gh-11/gh-12/gh-13 all end this iteration in the SAME clean state they were in before any of this
iteration's probes ran (gh-11 childless/parentless, gh-12/gh-13 childless).

**MET** — both the add transcript and the reassignment transcript required by Done-when 4 are
above, both real, both independently confirmed via a fresh `gh issue view` call (not just the
write call's own echoed response).

### 5. `[x]` `provider-abi-conformance.test.mjs` updated and passing, full raw output pasted

Direct re-run of just this file (final, after all probes and cleanup above):

```
$ node packages/quay/test/provider-abi-conformance.test.mjs
quay-native mcp: serving tasks from /tmp/quay-abi-conf-native-Hmm6eh
PASS [native/primitive/task_list] task_list returns array including ABI-P1 (got 3 tasks)
PASS [native/primitive/task_get] task_get ABI-P1 -> status=todo, role=primitive
PASS [native/primitive/task_write-status] task_write status todo->ready -> status=ready
PASS [native/primitive/task_check] task_check ABI-P1 (status=ready, AC checked) -> ok=true, gate=execute->done
PASS [native/compound/task_list] task_list includes ABI-C1 (compound parent)
PASS [native/compound/task_get] task_get ABI-C1 -> role=compound, children=["ABI-C1-CHILD"]
PASS [native/compound/task_write-status] task_write status (idempotent ready->ready) on compound parent -> status=ready
PASS [native/compound/task_check] task_check ABI-C1 (compound, child done) -> ok=true, childrenStatus present=true
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
PASS [github/primitive/task_list] task_list includes known real issues gh-3, gh-4 (got 13 tasks)
PASS [github/primitive/task_get] task_get gh-3 -> status=ready, role=primitive
PASS [github/primitive/task_write-status] task_write status (idempotent, ready->ready) -> status=ready
PASS [github/primitive/task_write-unsupported-field-probe] task_write with 'title' field on github (NOW a real, supported write per M09-gh-write) -> isError=undefined, title (idempotent re-assert of its own current value)=true — MATCHES native's own explicit-field write support (real write, not silent drop; see gap-list PR-ABI-001 closure)
PASS [github/primitive/task_write-hard-error-floor-probe] task_write with unsupported 'assignee' field on github -> isError=true (expected true: explicit MCP tool error, not a silent no-op — PR-ABI-001 floor, Done-when 4; 'parent'/'children' graduated OUT of this floor at M12-abi-parent-write, see the real-write probe below)
PASS [github/primitive/task_write-children-real-add] task_write children:['gh-3'] on gh-11 -> role=compound, children=["gh-3"] (REAL write, checkbox line added to gh-11's own body)
PASS [github/primitive/task_write-children-real-remove] task_write children:[] on gh-11 -> role=primitive, children=[] (REAL write, checkbox line removed from gh-11's own body — restores gh-11 to its pre-probe childless state)
PASS [github/primitive/task_write-children-real-restore] gh-11's pre-probe children was [] (empty, as expected) -- add+remove round trip above leaves gh-11 in the same state it started this test run in
PASS [github/primitive/task_write-parent-real-add] task_write parent:'gh-12' on gh-11 -> gh-12.children=["gh-11"] (REAL write, checkbox line '- [ ] #11' added to gh-12's own body; gh-12 children before this probe was [])
PASS [github/primitive/task_write-parent-real-reassign] task_write parent:'gh-13' on gh-11 (reassignment from gh-12) -> gh-12.children=[] (expected: no longer includes gh-11), gh-13.children=["gh-11"] (expected: includes gh-11) (REAL write, checkbox line removed from gh-12's body AND added to gh-13's body)
PASS [github/primitive/task_write-parent-real-restore] task_write parent:null on gh-11 -> gh-13.children=[] (expected: no longer includes gh-11) -- gh-12/gh-13 both restored to their pre-probe childless state
PASS [github/primitive/task_check] task_check gh-3 -> ok=false, gate=execute->done
PASS [github/compound/task_get] task_get gh-7 -> role=compound, children=["gh-5","gh-6"], status=done
PASS [github/compound/task_list] task_list's own gh-7 entry has role=compound (role derived by list(), not just get())
PASS [github/compound/task_get-vs-task_list-parent-probe] gh-5's 'parent' field: task_get -> "gh-7", task_list -> "gh-7" — CONFIRMED FIXED, both entry points agree (PR-ABI-002 closed, M09-gh-write); native's own store.js#get()/list() already resolved 'parent' identically -- github now matches
PASS [github/compound/task_write-status] task_write status (idempotent, done->done) on compound parent gh-7 -> status=done
PASS [github/compound/task_check] task_check gh-7 (compound, both children done, issue CLOSED) -> ok=true, childrenStatus present=true

--- 25 scenario cells run (native: 8, github: 17) ---
native/primitive: 4 cells, 4 ok, 0 fail
github/primitive: 12 cells, 12 ok, 0 fail
native/compound: 4 cells, 4 ok, 0 fail
github/compound: 5 cells, 5 ok, 0 fail

All provider-abi-conformance scenario cells passed (this is a CONFORMANCE report, not a claim of feature-parity — see the unsupported-field probe above and dashboard.md/gap-list.md for divergence findings logged separately, not failed as test assertions since they are documented, expected-per-scope divergences, not regressions).
```
**MET.**

### 6. `[x]` `dashboard.md`'s Provider-ABI write cov re-derived per-capability, pasted diff

```diff
+### Chart-1 re-score (M12-abi-parent-write, Provider-ABI write cov 12/13→13/13) — 2026-07-18
+
+| surface | prior cov (m9) | new cov | rationale |
+|---|---|---|---|
+| Provider-ABI | 0.9231 (12/13) | **1.00 (13/13)** | write 0.80→**1.00** — parent/children write closed ... |
+| **VT chart-1 total (after m12)** | **109.11/120** | **110.65/120** | ... Provider-ABI 20×1.00=**20.00** (+1.54 vs m9's 18.46). Total = 23.50+18.00+18.40+18.00+12.75+20.00 = **110.65/120** ...|
```
(Full text already present in the worktree from the crashed prior agent — reviewed by this
iteration and confirmed the underlying claim is now genuinely backed by real evidence, see §6
Done-when 4 above. No correction to the substance of the claim was needed; the arithmetic was
re-verified independently below.)

**Arithmetic re-check (this iteration, fresh):**
```
$ python3 -c "print(23.50+18.00+18.40+18.00+12.75+20*13/13)"
110.65
```
Confirmed: **110.65/120**, Δv = 110.65 − 109.11 = **+1.54** — matches the charter's own Δv̂≈+1.54
ceiling EXACTLY (§3(a) re-verified this same ceiling before work began). This is achieved because
the FULL parent/children write scope shipped (including bidirectional reassignment), not the
narrower fallback primitive the charter flagged as acceptable.

`capability-matrix.md`'s parent/children row (write side) was also reviewed — its draft text
citing scenarios (a)-(e) is now genuinely backed by this iteration's own live evidence (§6
Done-when 4), no correction needed to the claim's substance.

**MET.**

### 7. `[x]` Full existing test suite passes, pasted raw output (not summarized)

```
$ node --test --test-concurrency=1 packages/*/test/*.test.mjs
```
(Raw output is ~1050 lines of individual PASS assertions across 31 files — full log saved at
`/tmp/m12-full-suite-output.txt` during this run; per-file completion lines and the final summary
block, pasted verbatim below, are the load-bearing evidence for this Done-when clause):

```
✔ packages/quay-github/test/cli.test.mjs (15375.423685ms)
✔ packages/quay-github/test/compound-gate.test.mjs (61.335229ms)
✔ packages/quay-github/test/gate-gameability.test.mjs (55.382489ms)
✔ packages/quay-github/test/gate.test.mjs (65.640873ms)
✔ packages/quay-github/test/mcp-server.test.mjs (21891.06964ms)
✔ packages/quay-github/test/pagination.test.mjs (56.433521ms)
✔ packages/quay-github/test/task-check-passthrough.test.mjs (15343.53486ms)
✔ packages/quay-github/test/view-model.test.mjs (67.261448ms)
✔ packages/quay-github/test/write.test.mjs (52.387995ms)
✔ packages/quay-native/test/cas-write.test.mjs (404.03304ms)
✔ packages/quay-native/test/compound-gate-recursive.test.mjs (184.712789ms)
✔ packages/quay-native/test/compound-gate.test.mjs (206.339945ms)
✔ packages/quay-native/test/create-validation.test.mjs (476.120087ms)
✔ packages/quay-native/test/edit-validation.test.mjs (732.282697ms)
✔ packages/quay-native/test/gate-checked-state.test.mjs (232.547249ms)
✔ packages/quay-native/test/gate-correctness.test.mjs (172.683738ms)
✔ packages/quay-native/test/gate-gameability.test.mjs (214.21075ms)
✔ packages/quay-native/test/lock.test.mjs (458.117181ms)
✔ packages/quay/test/action-mock-delivery.test.mjs (81.15214ms)
✔ packages/quay/test/cli.test.mjs (56665.233614ms)
✔ packages/quay/test/config.test.mjs (104.844035ms)
✔ packages/quay/test/core-three-way-symmetry.test.mjs (6621.168963ms)
✔ packages/quay/test/mcp-server.test.mjs (41639.675853ms)
✔ packages/quay/test/provider-abi-conformance.test.mjs (84646.685618ms)
✔ packages/quay/test/provider-env-symmetry.test.mjs (1951.296069ms)
✔ packages/quay/test/serve-action-delivery.test.mjs (124.371531ms)
✔ packages/quay/test/serve-browser-render.test.mjs (1453.351385ms)
✔ packages/quay/test/serve-github.test.mjs (4581.125104ms)
✔ packages/quay/test/serve.test.mjs (27043.070192ms)
✔ packages/quay/test/task-check.test.mjs (2445.19729ms)
✔ packages/quay/test/web-ui-browser.test.mjs (5245.366052ms)
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 288685.356356
```
**31/31 test FILES pass, 0 fail (all 31 files enumerated via `ls packages/*/test/*.test.mjs`
diff-checked against the run's own `✔` lines — exact 1:1 match, zero missing, zero extra).
`provider-abi-conformance.test.mjs` (84.6s — real GitHub API calls, including this iteration's new
parent-write probes) is among the 31. MET.**

### 8. `[x]` No scope narrowed — explicitly stated, no new backlog row needed

Per §5's closing note: the FULL charter-scoped parent/children write semantics shipped, including
bidirectional reassignment (the harder half the charter's item 7 flagged as an acceptable
fallback-away-from target). No scope was narrowed relative to the charter's in-scope-work items
1-6, so Done-when 8's "new backlog.md candidate row" requirement does NOT fire this iteration —
stated explicitly per that clause's own instruction, not left implicit. **MET (vacuously — the
triggering condition did not occur).**

## §7. Files changed (summary)

```
$ git diff --stat
 experiments/quay-perpetual-stream/dashboard.md                                          |  34 +++++
 .../milestones/M03-abi-eval/capability-matrix.md                                        |  39 ++---
 packages/quay-github/src/github-client.js                                               | 167 ++++++++++++++++++++-
 packages/quay-github/src/mcp-server.js                                                  |  73 ++++++---
 .../quay/test/provider-abi-conformance.test.mjs                                         | 126 ++++++++++++++--
 5 files changed, 387 insertions(+), 52 deletions(-)
```
(387/52 reflects both the inherited crashed-agent work AND this iteration's additions — the
`provider-abi-conformance.test.mjs` delta of 126/− includes this iteration's own +63 lines of new
`task_write-parent-real-*` probes on top of the inherited `task_write-children-real-*` probes.)

## §8. End-of-iteration isolation proof

```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M12-abi-parent-write/worktrees/iteration-0
$ git branch --show-current
exp5-m12-iteration-0
$ git status --short
 M experiments/quay-perpetual-stream/dashboard.md
 M experiments/quay-perpetual-stream/milestones/M03-abi-eval/capability-matrix.md
 M packages/quay-github/src/github-client.js
 M packages/quay-github/src/mcp-server.js
 M packages/quay/test/provider-abi-conformance.test.mjs
?? experiments/quay-perpetual-stream/milestones/M12-abi-parent-write/iterations/iteration-0.md
```
(5 modified files, all in-scope, plus this new report file; no leftover temp scripts — all
verification `node -e '...'` one-liners were run inline via Bash, not saved as files.)

All development/verification this iteration targeted this worktree exclusively — no edits made
to the shared repo root at `/home/yale/work/quay`.

## §9. Reflection — status and next-step

**All 8 Done-when clauses are MET with live evidence.** The one clause with a genuine nuance
worth flagging: Done-when 3's checked-state-preservation requirement is satisfied for the
same-issue reconciliation case (children write, and re-adding an already-present parent-ref) but,
by design (§6 scenario (e) honest disclosure), does NOT carry a checked state across a
reassignment onto a DIFFERENT issue's body — this is the semantically correct behavior (there is
no meaningful "existing checked state" to preserve on an issue that never had the reference
before), not a bug or a scope gap, but it is worth stating explicitly rather than silently
assuming the reader infers it.

**Not provisional — this iteration's own evidence is settled, not drafted-pending-iteration-1**:
unlike M09's own iteration-0 (which marked its dashboard numbers DRAFT pending independent
re-derivation), this iteration directly re-verified (not merely trusted) the inherited
children-write evidence AND added the previously-missing parent-write evidence, with every
transcript captured fresh during this session, not carried forward from the crashed agent's
unverifiable claims.

**Per the charter's own "Adversarial-audit gate" section**: this milestone is
capability-growth-typed with a nonzero realized Δv (+1.54, at ceiling) — condition (a) of
`inherited-core.md`'s Adversarial-audit cadence rule fires. Per the charter's explicit instruction,
the dispatched out-of-band adversarial-audit role must be run by the OUTER loop itself before the
VT-curve append / Done-when-complete claim is finalized — **this inner iteration does not itself
run that audit** (it is scoped to the outer loop, not this dispatched inner iteration), flagging
it here for the outer loop's ABSORB step as the charter requires.

**Next-step recommendation for the outer loop:**
1. Dispatch the adversarial-audit role per the charter's gate (first genuine trigger of this
   mechanism since it was built at M10 — M11's ABSORB determined it correctly did NOT fire there).
2. If the audit confirms this iteration's evidence, ABSORB M12 with VT chart-1 total
   **110.65/120** (Δv=+1.54), Provider-ABI cov **13/13=1.00** (the first point since M03's origin
   scoring that the capability-matrix has zero remaining non-N/A gaps).
3. `gh-11`/`gh-12`/`gh-13` remain open on `yaleh/quay` as durable scratch/test fixtures (all
   restored to their clean, childless/parentless pre-probe state by this iteration's cleanup) —
   available for reuse by any future milestone needing live parent/children write evidence again.
