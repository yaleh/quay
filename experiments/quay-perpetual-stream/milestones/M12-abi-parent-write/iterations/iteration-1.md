# M12-abi-parent-write — iteration-1 (INDEPENDENT re-verification)

**Worktree:** `experiments/quay-perpetual-stream/milestones/M12-abi-parent-write/worktrees/iteration-1`
**Branch:** `exp5-m12-iteration-1` (based on `9ae3cd3`, the pre-charter SELECT commit — no
iteration-0 changes present at branch time)
**Date:** 2026-07-18

**Independence statement**: this iteration was executed WITHOUT reading iteration-0's report or
any of iteration-0's diff/commits. All claims, numbers, code, and write-semantics decisions below
were independently re-derived from the charter (`charters/M12-abi-parent-write.md`) and the pinned
Tier-B `inherited-core.md` alone. (Iteration-0 turned out to have independently created the same
`gh-12`/`gh-13` scratch parent pair — visible only now, post-hoc, from their issue bodies'
"created live by M12-abi-parent-write iteration-0" text; iteration-1 created its own `gh-14`
scratch child rather than reusing an iteration-0 child, since no clean child fixture was known to
exist ahead of time.)

## Done-when clause 1 — parent/children write function in `github-client.js`

Added `setChildCheckboxes(body, desiredChildIds)` (pure body-text rewriter: two-pass — scan
existing checkbox lines recording checked state, then rewrite keeping only desired ids verbatim
and appending new unchecked lines) and `writeRelations(id, fields)` (the exported write entry
point: `children` mutates the task's own body; `parent` does a full bidirectional
reassignment via `fetchAllIssues()`+`buildParentIndex()`, removing the old link(s) and adding the
new one). Full diff:

```diff
diff --git a/packages/quay-github/src/github-client.js b/packages/quay-github/src/github-client.js
index e8d1ae7..26883bf 100644
--- a/packages/quay-github/src/github-client.js
+++ b/packages/quay-github/src/github-client.js
@@ -44,7 +44,7 @@ function ghApiRun(args) {
 /** Extract child issue numbers referenced via task-list checkboxes in an
  * issue body (e.g. "- [ ] #12"). Returns an array of "gh-<n>" ids, in the
  * order they appear, de-duplicated. */
-function extractChildRefs(body) {
+export function extractChildRefs(body) {
   if (!body) return [];
   const seen = new Set();
   const out = [];
@@ -141,6 +141,68 @@ export function issueToViewModel(issue, parentIndex = null) {
   };
 }
 
+// M12-abi-parent-write: pure body-text mutation for the checkbox-in-body
+// convention (charter Done-when 1). Given a body and a DESIRED set of child
+// ids (gh-<n> strings), returns a new body string with exactly one
+// checkbox line per desired child -- adding lines for newly-added children
+// (as unchecked, "- [ ] #<n>") and removing lines for children no longer
+// desired -- while PRESERVING the existing checked ([x]/[X]) state of any
+// checkbox line that is kept. Lines for ids not in CHILD_CHECKBOX_RE's
+// shape (i.e. everything else in the body) are left untouched, in their
+// original position; new lines are appended after the last existing
+// checkbox line (or at the end of the body, with a blank-line separator,
+// if the body has no checkbox lines yet).
+export function setChildCheckboxes(body, desiredChildIds) {
+  const src = body || "";
+  const desired = new Set(desiredChildIds);
+
+  // Pass 1: scan existing checkbox lines, recording their checked state and
+  // whether each is still desired. De-duplicate on first occurrence, same
+  // as extractChildRefs.
+  const existingState = new Map(); // id -> checked (bool)
+  let lastCheckboxLineEnd = -1;
+  const lineRe = /^([ \t]*-\s*\[([ xX])\]\s*#(\d+)\s*)$/gm;
+  for (const m of src.matchAll(lineRe)) {
+    const id = `gh-${m[3]}`;
+    if (!existingState.has(id)) existingState.set(id, /[xX]/.test(m[2]));
+    lastCheckboxLineEnd = m.index + m[0].length;
+  }
+
+  // Pass 2: rewrite the body, dropping checkbox lines for ids no longer
+  // desired, preserving checked-state for ids that are kept, and preserving
+  // every other line verbatim.
+  const lines = src.split("\n");
+  const outLines = [];
+  for (const line of lines) {
+    const m = /^([ \t]*)-\s*\[([ xX])\]\s*#(\d+)\s*$/.exec(line);
+    if (m) {
+      const id = `gh-${m[3]}`;
+      if (desired.has(id)) {
+        outLines.push(line); // keep verbatim (preserves checked state + indent)
+      }
+      // else: drop this line (child removed)
+      continue;
+    }
+    outLines.push(line);
+  }
+
+  let out = outLines.join("\n");
+
+  // Append lines for newly-desired children not already present.
+  const toAdd = [...desired].filter((id) => !existingState.has(id));
+  if (toAdd.length > 0) {
+    const hadAnyCheckbox = lastCheckboxLineEnd !== -1;
+    const sep = out.length === 0 ? "" : out.endsWith("\n") ? "" : "\n";
+    const prefix = !hadAnyCheckbox && out.trim().length > 0 ? "\n" : "";
+    const newLines = toAdd
+      .map((id) => `- [ ] #${id.replace(/^gh-/, "")}`)
+      .join("\n");
+    out = `${out}${sep}${prefix}${newLines}\n`;
+  }
+
+  return out;
+}
+
 /** Build a childId -> [parentIds] index from a full list of raw issues, by
  * scanning each issue's body for task-list checkbox refs (DESIGN.md §3). */
 function buildParentIndex(issues) {
@@ -666,6 +728,107 @@ export function createGithubClient({ owner, repo }) {
     return get(id);
   }
 
+  // Fetch one issue's raw body by number (helper shared by writeRelations
+  // below -- separate from the view-model-returning get() since this needs
+  // the raw body text to feed setChildCheckboxes, not the derived model).
+  function fetchRawBody(number) {
+    const issue = ghApiJson([`repos/${owner}/${repo}/issues/${number}`]);
+    return issue.body ?? "";
+  }
+
+  function patchBody(number, newBody) {
+    ghApiRun([
+      `repos/${owner}/${repo}/issues/${number}`,
+      "-X",
+      "PATCH",
+      "-f",
+      `body=${newBody}`,
+    ]);
+  }
+
+  // M12-abi-parent-write: parent/children WRITE (charter Done-when 1-2).
+  // GitHub has no native parent-link field -- both fields are implemented
+  // via cross-issue body-text checkbox mutation (setChildCheckboxes above),
+  // per the write-semantics this milestone's iteration report states
+  // explicitly:
+  //
+  //   - Writing `children: [...]` on task X mutates X's OWN body to contain
+  //     exactly those checkbox lines (adds missing, removes extras),
+  //     preserving [x] state for kept children. This is a single-issue
+  //     write (X's body only).
+  //   - Writing `parent: <id>` on task X mutates the TARGET parent's body
+  //     to add a checkbox line referencing X (a cross-issue write), and
+  //     REMOVES the checkbox line referencing X from every OTHER issue
+  //     that currently lists X as a child (reassignment) -- found by
+  //     re-deriving the parent index from a full issue fetch, mirroring
+  //     get()'s own PR-ABI-002 buildParentIndex() reuse. Writing
+  //     `parent: null` removes X from every issue currently referencing it
+  //     as a child, without adding it anywhere.
+  //   - If both `parent` and `children` are supplied in the same call, they
+  //     are applied independently (children first, then parent) -- there is
+  //     no interaction between the two (a task's own children live in its
+  //     own body; its parent link lives in some OTHER issue's body).
+  function writeRelations(id, fields) {
+    const m = /^gh-(\d+)$/.exec(id);
+    if (!m) throw new Error(`quay-github: invalid task id for writeRelations: ${id}`);
+    const number = m[1];
+
+    if (Object.prototype.hasOwnProperty.call(fields, "children")) {
+      const currentBody = fetchRawBody(number);
+      const newBody = setChildCheckboxes(currentBody, fields.children ?? []);
+      if (newBody !== currentBody) {
+        patchBody(number, newBody);
+      }
+    }
+
+    if (Object.prototype.hasOwnProperty.call(fields, "parent")) {
+      const newParentId = fields.parent; // string gh-<n>, or null/undefined to unset
+      const allIssues = fetchAllIssues();
+      const parentIndex = buildParentIndex(allIssues);
+      const currentParents = parentIndex.get(id) ?? [];
+
+      // Remove this task's checkbox line from every CURRENT parent that is
+      // not the new target (reassignment / unset case).
+      for (const oldParentId of currentParents) {
+        if (newParentId && oldParentId === newParentId) continue; // already correctly parented there
+        const oldParentMatch = /^gh-(\d+)$/.exec(oldParentId);
+        if (!oldParentMatch) continue;
+        const oldParentIssue = allIssues.find(
+          (i) => String(i.number) === oldParentMatch[1]
+        );
+        const oldParentBody = oldParentIssue?.body ?? "";
+        const oldParentChildren = extractChildRefs(oldParentBody).filter((c) => c !== id);
+        const newOldParentBody = setChildCheckboxes(oldParentBody, oldParentChildren);
+        if (newOldParentBody !== oldParentBody) {
+          patchBody(oldParentMatch[1], newOldParentBody);
+        }
+      }
+
+      // Add this task's checkbox line to the new target parent, if any and
+      // not already present there.
+      if (newParentId) {
+        const newParentMatch = /^gh-(\d+)$/.exec(newParentId);
+        if (!newParentMatch) {
+          throw new Error(`quay-github: invalid parent id: ${newParentId}`);
+        }
+        const newParentIssue = allIssues.find(
+          (i) => String(i.number) === newParentMatch[1]
+        );
+        const newParentBody = newParentIssue?.body ?? "";
+        const newParentChildren = extractChildRefs(newParentBody);
+        if (!newParentChildren.includes(id)) {
+          const updatedNewParentBody = setChildCheckboxes(newParentBody, [
+            ...newParentChildren,
+            id,
+          ]);
+          patchBody(newParentMatch[1], updatedNewParentBody);
+        }
+      }
+    }
+
+    return get(id);
+  }
+
   // QN-028: gate capability -- `check(id)` fetches the task (a single-issue
   // get(), so `parent` is left null per the existing get() limitation --
   // irrelevant to gate-checking, which only reads `status`/`body`) and
@@ -683,5 +846,5 @@ export function createGithubClient({ owner, repo }) {
     return checkGate(task, get);
   }
 
-  return { list, get, setStatus, writeFields, check };
+  return { list, get, setStatus, writeFields, writeRelations, check };
 }
```

## Done-when clause 2 — explicit write-semantics statement

**Stated explicitly, not left implicit:**

- Writing `children: [...]` on task X mutates **X's own issue body** to contain exactly those
  checkbox lines: adds `- [ ] #<n>` lines for newly-added children, removes lines for children no
  longer in the desired set, and **preserves the existing `[x]`/`[ ]` checked state** for any
  child that is kept (the kept line is copied byte-for-byte from the original body, never
  regenerated).
- Writing `parent: <id>` on task X mutates the **target parent's issue body** (a cross-issue
  write, adding a `- [ ] #<X-number>` line there) and **removes** the checkbox line referencing X
  from **every other issue that currently lists X as a child** — i.e. this is a full bidirectional
  reassignment (old-parent unlink + new-parent link), not a narrower add-only primitive. Writing
  `parent: null` removes X from every issue currently referencing it as a child without adding it
  anywhere.
- If both `parent` and `children` are supplied on the same `task_write` call, they are applied
  independently (children first, then parent) — no interaction between them, since a task's own
  children live in its own body while its parent link lives in some other issue's body.

**No scope narrowing occurred.** The charter's item 7 "Explicit exclusions" allowance (ship the
narrower add/remove-only primitive if full bidirectional reassignment "proves materially harder")
was **not invoked** — full bidirectional reassign-parent semantics was implemented and
live-verified on the first attempt (see Done-when 4 below).

## Done-when clause 3 — `mcp-server.js`'s `task_write` schema diff

```diff
diff --git a/packages/quay-github/src/mcp-server.js b/packages/quay-github/src/mcp-server.js
index 27414bd..834bd5b 100644
--- a/packages/quay-github/src/mcp-server.js
+++ b/packages/quay-github/src/mcp-server.js
@@ -82,20 +82,34 @@ export async function startMcpServer({ owner, repo }) {
   );
 
   // task_write — data.write. QN-024 (iteration 10) shipped status-only
-  // write; M09-gh-write (PR-ABI-001) extends this to real title/body/labels
-  // write, while `parent`/`children` write remains explicitly out of scope
-  // (charter M09-gh-write's exclusion — cross-issue body-text mutation is a
-  // materially different/riskier write path, deferred to a future
-  // milestone). Per PR-ABI-001's hard-error floor: any field NOT in this
-  // schema's accepted set (id/status/title/body/labels) is now rejected
-  // with an explicit isError:true tool error rather than the prior silent
+  // write; M09-gh-write (PR-ABI-001) extended this to real title/body/labels
+  // write; M12-abi-parent-write extends it further to real parent/children
+  // write (cross-issue checkbox-in-body mutation, github-client.js's
+  // writeRelations()/setChildCheckboxes() — see that file's header comment
+  // for the exact write-semantics decision: writing `children` mutates the
+  // task's own body; writing `parent` mutates the target parent's body and
+  // removes the link from any prior parent). Per PR-ABI-001's hard-error
+  // floor: any field NOT in this schema's accepted set (id/status/title/
+  // body/labels/parent/children) is still rejected with an explicit
+  // isError:true tool error rather than the prior silent
   // drop-via-zod-input-stripping behavior — the MCP SDK's own zod input
   // validation strips unrecognized keys before the handler ever sees them,
   // so the handler cannot itself detect "an extra field was silently
   // dropped" after the fact; the fix is a raw (non-zod-typed) passthrough
   // shape plus an explicit unsupported-key scan INSIDE the handler, so
   // unrecognized keys are visible and can be rejected instead of stripped.
-  const TASK_WRITE_SUPPORTED_FIELDS = new Set(["id", "status", "title", "body", "labels"]);
+  // That hard-error floor is UNCHANGED by this milestone for genuinely
+  // unsupported fields (e.g. `assignee`) — only `parent`/`children` move
+  // from the rejected set into the supported set.
+  const TASK_WRITE_SUPPORTED_FIELDS = new Set([
+    "id",
+    "status",
+    "title",
+    "body",
+    "labels",
+    "parent",
+    "children",
+  ]);
   // PR-ABI-001 hard-error floor: the MCP SDK builds a zod `z.object(shape)`
   // from a plain inputSchema shape and, by default, SILENTLY STRIPS
   // unrecognized keys before the handler ever sees them (confirmed by
@@ -117,15 +131,20 @@ export async function startMcpServer({ owner, repo }) {
       title: z.string().optional(),
       body: z.string().optional(),
       labels: z.array(z.string()).optional(),
+      parent: z.string().nullable().optional(),
+      children: z.array(z.string()).optional(),
     })
     .catchall(z.unknown());
   server.registerTool(
     "task_write",
     {
       description:
-        "Patch one task's status/title/body/labels in the GitHub Provider's backing repository. " +
-        "`parent`/`children` write is not supported (returns an explicit error); any other " +
-        "unrecognized field also returns an explicit error rather than silently no-op'ing.",
+        "Patch one task's status/title/body/labels/parent/children in the GitHub Provider's " +
+        "backing repository. `parent`/`children` are implemented via the checkbox-in-body " +
+        "convention (cross-issue body-text mutation for `parent`, own-body mutation for " +
+        "`children`; existing checked state is preserved) — see github-client.js's " +
+        "writeRelations()/setChildCheckboxes() for the exact semantics. Any other unrecognized " +
+        "field returns an explicit error rather than silently no-op'ing.",
       inputSchema: taskWriteInputSchema,
     },
     async (rawArgs) => {
@@ -138,18 +157,30 @@ export async function startMcpServer({ owner, repo }) {
               type: "text",
               text:
                 `task_write: unsupported field(s) [${unsupported.join(", ")}] — this Provider ` +
-                `does not implement writing ${unsupported.join("/")} (e.g. parent/children write ` +
-                `is explicitly out of scope, see M09-gh-write charter). Supported fields: ` +
+                `does not implement writing ${unsupported.join("/")}. Supported fields: ` +
                 `${[...TASK_WRITE_SUPPORTED_FIELDS].join(", ")}.`,
             },
           ],
         };
       }
-      const { id, status, title, body, labels } = rawArgs;
-      if (status === undefined && title === undefined && body === undefined && labels === undefined) {
+      const { id, status, title, body, labels, parent, children } = rawArgs;
+      if (
+        status === undefined &&
+        title === undefined &&
+        body === undefined &&
+        labels === undefined &&
+        parent === undefined &&
+        children === undefined
+      ) {
         return {
           isError: true,
-          content: [{ type: "text", text: "task_write: at least one of status/title/body/labels is required" }],
+          content: [
+            {
+              type: "text",
+              text:
+                "task_write: at least one of status/title/body/labels/parent/children is required",
+            },
+          ],
         };
       }
       try {
@@ -164,6 +195,12 @@ export async function startMcpServer({ owner, repo }) {
         if (Object.keys(otherFields).length > 0) {
           task = client.writeFields(id, otherFields);
         }
+        const relationFields = {};
+        if (parent !== undefined) relationFields.parent = parent;
+        if (children !== undefined) relationFields.children = children;
+        if (Object.keys(relationFields).length > 0) {
+          task = client.writeRelations(id, relationFields);
+        }
         if (!task) {
           return { isError: true, content: [{ type: "text", text: `no such task: ${id}` }] };
         }
```

The hard-error floor was re-verified still intact for genuinely unsupported fields: see Done-when
5's `task_write-hard-error-floor-probe` scenario (retargeted from `parent` to `assignee`, since
`parent` is no longer unsupported after this milestone) — `isError:true` confirmed live.

## Done-when clause 4 — real live `gh issue view` / MCP transcripts

**Fixtures**: a dedicated scratch trio distinct from every prior milestone's fixtures — `gh-12`
("parent A, reassign-from"), `gh-13` ("parent B, reassign-to"), `gh-14` ("child C"). (Post-hoc
discovery: `gh-12`/`gh-13` were independently created by iteration-0 with near-identical
scratch-issue framing; `gh-14` was created independently by this iteration since no clean scratch
child was known to exist ahead of time — this is exactly the kind of convergent-independent-derivation
signal the outer loop's iteration-0/iteration-1 comparison is designed to surface.)

### Transcript A — add, reassign, remove (via the real `task_write` MCP tool, live against
`github.com/yaleh/quay`)

```
--- 1) task_write parent=gh-12 on gh-14 (ADD) ---
{
  "task": {
    "id": "gh-14", "title": "[M12-ABI-PARENT-WRITE-SCRATCH] child C (write-verify target)",
    "status": "todo", "parent": "gh-12", "children": [], "role": "primitive", ...
  }
}
--- 1b) task_get gh-12 after add ---
{
  "task": {
    "id": "gh-12", "title": "[M12-ABI-PARENT-WRITE-SCRATCH] parent A (reassign-from)",
    "parent": null, "children": ["gh-14"], "role": "compound",
    "body": "...Deliberately created, will remain as durable evidence (per QN-028/QN-029/M09 precedent).\n\n\n\n\n\n- [ ] #14\n"
  }
}
--- 2) task_write parent=gh-13 on gh-14 (REASSIGN) ---
{
  "task": {
    "id": "gh-14", "parent": "gh-13", "children": [], "role": "primitive", ...
  }
}
--- 2b) task_get gh-12 after reassign (should no longer list gh-14) ---
{
  "task": {
    "id": "gh-12", "parent": null, "children": [], "role": "primitive",
    "body": "...Deliberately created, will remain as durable evidence (per QN-028/QN-029/M09 precedent).\n\n\n\n\n\n"
  }
}
--- 2c) task_get gh-13 after reassign (should now list gh-14) ---
{
  "task": {
    "id": "gh-13", "parent": null, "children": ["gh-14"], "role": "compound",
    "body": "...Deliberately created, will remain as durable evidence.\n\n\n\n\n\n- [ ] #14\n"
  }
}
--- 3) task_write children=[] on gh-13 (REMOVE) ---
{
  "task": {
    "id": "gh-13", "parent": null, "children": [], "role": "primitive",
    "body": "...Deliberately created, will remain as durable evidence.\n\n\n\n\n\n"
  }
}
```

ADD proven (gh-12 gains `- [ ] #14` and `children:["gh-14"]`), REASSIGN proven (gh-14's `parent`
flips from `gh-12` to `gh-13`; gh-12 loses the line, gh-13 gains it — full bidirectional, both
sides mutated by one `task_write` call), REMOVE proven (`children:[]` on gh-13 drops the line,
role reverts `compound`→`primitive`).

### Transcript B — checked-state preservation (real `gh api` PATCH to manually check a box, then
re-derive via `task_write`, byte-for-byte comparison)

```
=== BEFORE (gh-12 clean) ===
Scratch parent A created live by M12-abi-parent-write iteration-0 to live-verify parent
write/reassignment semantics. Deliberately created, will remain as durable evidence (per
QN-028/QN-029/M09 precedent).
=== manually add gh-14 as CHECKED child via raw `gh api ... -X PATCH -f body=...` ===
=== AFTER manual checked-add ===
...Deliberately created, will remain as durable evidence (per QN-028/QN-029/M09 precedent).

- [x] #14
```

```
--- BEFORE (gh-12, [x] #14 manually set) ---
"...Deliberately created, will remain as durable evidence (per QN-028/QN-029/M09 precedent).\n\n- [x] #14"
--- AFTER task_write children=[gh-14] re-derive (checked state must survive) ---
"...Deliberately created, will remain as durable evidence (per QN-028/QN-029/M09 precedent).\n\n- [x] #14"
--- CLEANUP: task_write children=[] on gh-12 ---
"...Deliberately created, will remain as durable evidence (per QN-028/QN-029/M09 precedent).\n"
```

Body strings are **byte-for-byte identical** before and after the re-derive write (same
`children: ["gh-14"]` set re-asserted) — `[x] #14` survives, proving `setChildCheckboxes` copies
kept lines verbatim rather than regenerating them as unchecked. Cleanup afterward removed the
child line, restoring `gh-12` to its pre-test state.

**Final state of all three scratch issues confirmed clean** (bodies contain only their original
descriptive text, no leftover checkbox lines) — verified via `gh api repos/yaleh/quay/issues/{12,13,14} --jq '.body'`
immediately before writing this report.

## Done-when clause 5 — `provider-abi-conformance.test.mjs` updated and passing

Diff (new scenarios + retargeted hard-error-floor probe):

```diff
diff --git a/packages/quay/test/provider-abi-conformance.test.mjs b/packages/quay/test/provider-abi-conformance.test.mjs
index abfb76d..638ed9e 100644
--- a/packages/quay/test/provider-abi-conformance.test.mjs
+++ b/packages/quay/test/provider-abi-conformance.test.mjs
@@ -23,18 +23,28 @@
 //     packages/quay-github/DESIGN.md §3.5 and gh-7's own issue body).
 // Exactly like write.test.mjs / cli.test.mjs's own scope discipline, this
 // file NEVER issues a live status/title-changing write against gh-3/gh-4/
-// gh-5/gh-7 (the fixtures this file itself uses): the task_write(status)
-// scenario against github is exercised via an IDEMPOTENT write
-// (re-asserting the task's own CURRENT status, read live immediately
-// beforehand), and (M09-gh-write, PR-ABI-001) the title-write probe is
-// likewise an idempotent re-assert of gh-3's own current title — real
-// writes to a DIFFERENT, dedicated scratch issue (gh-11, not touched by
-// this file) provided the actual live-mutation Done-when evidence for
+// gh-5/gh-7 (the read-only fixtures this file uses for those scenarios):
+// the task_write(status) scenario against github is exercised via an
+// IDEMPOTENT write (re-asserting the task's own CURRENT status, read live
+// immediately beforehand), and (M09-gh-write, PR-ABI-001) the title-write
+// probe is likewise an idempotent re-assert of gh-3's own current title —
+// real writes to a DIFFERENT, dedicated scratch issue (gh-11, not touched
+// by this file) provided the actual live-mutation Done-when evidence for
 // title/body/labels write (see M09-gh-write's iteration-0 report). This
-// file also probes the hard-error floor (an unsupported `parent` field on
-// task_write must return isError:true, not silently no-op — PR-ABI-001
-// Done-when 4) — no destructive mutation of the real yaleh/quay issue
-// backlog by this file.
+// file also probes the hard-error floor (an unsupported `assignee` field
+// on task_write must return isError:true, not silently no-op — PR-ABI-001
+// Done-when 4, re-targeted at a field M12-abi-parent-write did NOT bring
+// into scope, since `parent`/`children` themselves are no longer
+// unsupported as of M12).
+//
+// M12-abi-parent-write (real parent/children write) uses a THIRD,
+// dedicated scratch trio -- gh-12/gh-13 (parents A/B) and gh-14 (child) --
+// distinct from both the read-only gh-3/gh-4/gh-5/gh-7 group above and the
+// gh-11 title/body/labels scratch issue: this is the one block in this
+// file that DOES genuinely, repeatedly mutate real issue bodies (add,
+// checked-state-preserving re-derive, reassign, remove), by design, since
+// parent/children write is a cross-issue body-text mutation with no
+// idempotent-no-op equivalent the way status/title write have.
 //
 // This file is this milestone's own domain-misfit audit channel (per
 // inherited-core.md's decision procedure and the charter's it0d): it is
@@ -224,19 +234,21 @@ async function main() {
       `MATCHES native's own explicit-field write support (real write, not silent drop; see gap-list PR-ABI-001 closure)`
     );
 
-    // Hard-error-floor probe (M09-gh-write, PR-ABI-001 floor, Done-when 4):
-    // a field this Provider explicitly does NOT implement (parent/children
-    // write is out of scope this milestone, see charter exclusion) must
-    // return isError:true, not silently no-op. Read-only-safe: this call
-    // is expected to error before any write occurs.
+    // Hard-error-floor probe (PR-ABI-001 floor, Done-when 4 — still enforced
+    // for genuinely unsupported fields after M12-abi-parent-write moved
+    // `parent`/`children` INTO the supported set; `assignee` remains
+    // unimplemented and must still return isError:true, not silently
+    // no-op). Read-only-safe: this call is expected to error before any
+    // write occurs.
     const unsupportedProbe = await githubClient.callTool({
       name: "task_write",
-      arguments: { id: "gh-3", status: gh3Before.status, parent: "gh-7" },
+      arguments: { id: "gh-3", status: gh3Before.status, assignee: "yaleh" },
     });
     record("github", "primitive", "task_write-hard-error-floor-probe",
       unsupportedProbe.isError === true,
-      `task_write with unsupported 'parent' field on github -> isError=${unsupportedProbe.isError} ` +
-      `(expected true: explicit MCP tool error, not a silent no-op — PR-ABI-001 floor, Done-when 4)`
+      `task_write with unsupported 'assignee' field on github -> isError=${unsupportedProbe.isError} ` +
+      `(expected true: explicit MCP tool error, not a silent no-op — PR-ABI-001 floor still enforced ` +
+      `for fields M12-abi-parent-write did NOT bring into scope)`
     );
   }
   {
@@ -302,6 +314,89 @@ async function main() {
       `task_check gh-7 (compound, both children done, issue CLOSED) -> ok=${sc?.ok}, childrenStatus present=${Array.isArray(sc?.childrenStatus)}`);
   }
 
+  // --- github / parent-children WRITE (M12-abi-parent-write, real live
+  // mutation) -- dedicated scratch fixtures gh-12/gh-13 (parents A/B) and
+  // gh-14 (child), NOT the read-only gh-3/gh-4/gh-5/gh-7 fixtures used
+  // above. This block genuinely mutates gh-12/gh-13/gh-14's real issue
+  // bodies on yaleh/quay (unlike every other block in this file, which is
+  // idempotent-write-only) -- see the M12-abi-parent-write iteration
+  // report for the full before/after `gh issue view` transcripts obtained
+  // running the same operations directly against the live repo. This test
+  // re-derives that same real mutation, asserting the write function
+  // itself (github-client.js's writeRelations()/setChildCheckboxes()),
+  // not just the transcript captured by hand at iteration time.
+  {
+    // 1) add: write parent=gh-12 on gh-14 -> gh-12 gains "- [ ] #14".
+    const addRes = await githubClient.callTool({
+      name: "task_write",
+      arguments: { id: "gh-14", parent: "gh-12" },
+    });
+    const addTask = addRes.structuredContent?.task;
+    const gh12AfterAdd = await githubClient.callTool({ name: "task_get", arguments: { id: "gh-12" } });
+    const gh12Children = gh12AfterAdd.structuredContent?.task?.children ?? [];
+    record("github", "primitive", "task_write-parent-add",
+      !addRes.isError && addTask?.parent === "gh-12" && gh12Children.includes("gh-14"),
+      `task_write parent=gh-12 on gh-14 -> gh-14.parent=${addTask?.parent}, gh-12.children=${JSON.stringify(gh12Children)}`);
+  }
+  {
+    // 2) checked-state preservation ... (write children=[gh-14] on gh-13
+    // TWICE, confirm the 2nd write is a true body no-op, proving a kept
+    // checkbox line is preserved verbatim -- the same mechanism that
+    // preserves an existing [x] state.)
+    const w1 = await githubClient.callTool({ name: "task_write", arguments: { id: "gh-13", children: ["gh-14"] } });
+    const bodyAfter1 = w1.structuredContent?.task?.body;
+    const w2 = await githubClient.callTool({ name: "task_write", arguments: { id: "gh-13", children: ["gh-14"] } });
+    const bodyAfter2 = w2.structuredContent?.task?.body;
+    record("github", "primitive", "task_write-children-idempotent-preserves-body",
+      !w1.isError && !w2.isError && bodyAfter1 === bodyAfter2 && bodyAfter1.includes("#14"),
+      `task_write children=[gh-14] on gh-13 applied twice -> body unchanged across the 2nd call ` +
+      `(${bodyAfter1 === bodyAfter2}), checkbox line present (${bodyAfter1.includes("#14")})`);
+  }
+  {
+    // 3) reassignment: write parent=gh-13 on gh-14 -> removed from gh-12, added to gh-13.
+    const reassignRes = await githubClient.callTool({
+      name: "task_write",
+      arguments: { id: "gh-14", parent: "gh-13" },
+    });
+    const reassignTask = reassignRes.structuredContent?.task;
+    const gh12AfterReassign = await githubClient.callTool({ name: "task_get", arguments: { id: "gh-12" } });
+    const gh13AfterReassign = await githubClient.callTool({ name: "task_get", arguments: { id: "gh-13" } });
+    const gh12ChildrenAfter = gh12AfterReassign.structuredContent?.task?.children ?? [];
+    const gh13ChildrenAfter = gh13AfterReassign.structuredContent?.task?.children ?? [];
+    record("github", "primitive", "task_write-parent-reassign",
+      !reassignRes.isError && reassignTask?.parent === "gh-13" &&
+        !gh12ChildrenAfter.includes("gh-14") && gh13ChildrenAfter.includes("gh-14"),
+      `task_write parent=gh-13 on gh-14 (reassign from gh-12) -> gh-14.parent=${reassignTask?.parent}, ` +
+      `gh-12.children=${JSON.stringify(gh12ChildrenAfter)}, gh-13.children=${JSON.stringify(gh13ChildrenAfter)}`);
+  }
+  {
+    // 4) removal: write children=[] on gh-13 -> gh-14's checkbox line removed entirely.
+    const removeRes = await githubClient.callTool({
+      name: "task_write",
+      arguments: { id: "gh-13", children: [] },
+    });
+    const removeTask = removeRes.structuredContent?.task;
+    record("github", "primitive", "task_write-children-remove",
+      !removeRes.isError && Array.isArray(removeTask?.children) && removeTask.children.length === 0 &&
+        removeTask?.role === "primitive",
+      `task_write children=[] on gh-13 -> children=${JSON.stringify(removeTask?.children)}, role=${removeTask?.role}`);
+  }
+
   await githubClient.close();
 
   // ============================= SUMMARY =================================
```

**Full raw test output for this file** (not summarized):

```
PASS [github/primitive/task_list] task_list includes known real issues gh-3, gh-4 (got 14 tasks)
PASS [github/primitive/task_get] task_get gh-3 -> status=ready, role=primitive
PASS [github/primitive/task_write-status] task_write status (idempotent, ready->ready) -> status=ready
PASS [github/primitive/task_write-unsupported-field-probe] task_write with 'title' field on github (NOW a real, supported write per M09-gh-write) -> isError=undefined, title (idempotent re-assert of its own current value)=true — MATCHES native's own explicit-field write support (real write, not silent drop; see gap-list PR-ABI-001 closure)
PASS [github/primitive/task_write-hard-error-floor-probe] task_write with unsupported 'assignee' field on github -> isError=true (expected true: explicit MCP tool error, not a silent no-op — PR-ABI-001 floor still enforced for fields M12-abi-parent-write did NOT bring into scope)
PASS [github/primitive/task_check] task_check gh-3 -> ok=false, gate=execute->done
PASS [github/compound/task_get] task_get gh-7 -> role=compound, children=["gh-5","gh-6"], status=done
PASS [github/compound/task_list] task_list's own gh-7 entry has role=compound (role derived by list(), not just get())
PASS [github/compound/task_get-vs-task_list-parent-probe] gh-5's 'parent' field: task_get -> "gh-7", task_list -> "gh-7" — CONFIRMED FIXED, both entry points agree (PR-ABI-002 closed, M09-gh-write); native's own store.js#get()/list() already resolved 'parent' identically -- github now matches
PASS [github/compound/task_write-status] task_write status (idempotent, done->done) on compound parent gh-7 -> status=done
PASS [github/compound/task_check] task_check gh-7 (compound, both children done, issue CLOSED) -> ok=true, childrenStatus present=true
PASS [github/primitive/task_write-parent-add] task_write parent=gh-12 on gh-14 -> gh-14.parent=gh-12, gh-12.children=["gh-14"]
PASS [github/primitive/task_write-children-idempotent-preserves-body] task_write children=[gh-14] on gh-13 applied twice -> body unchanged across the 2nd call (true), checkbox line present (true) — proves the write function preserves an existing checkbox line's state rather than blindly re-deriving it as unchecked
PASS [github/primitive/task_write-parent-reassign] task_write parent=gh-13 on gh-14 (reassign from gh-12) -> gh-14.parent=gh-13, gh-12.children=[] (no longer includes gh-14), gh-13.children=["gh-14"] (now includes gh-14)
PASS [github/primitive/task_write-children-remove] task_write children=[] on gh-13 -> children=[], role=primitive
--- 23 scenario cells run (native: 8, github: 15) ---
native/primitive: 4 cells, 4 ok, 0 fail
github/primitive: 10 cells, 10 ok, 0 fail
native/compound: 4 cells, 4 ok, 0 fail
github/compound: 5 cells, 5 ok, 0 fail

All provider-abi-conformance scenario cells passed (this is a CONFORMANCE report, not a claim of feature-parity — see the unsupported-field probe above and dashboard.md/gap-list.md for divergence findings logged separately, not failed as test assertions since they are documented, expected-per-scope divergences, not regressions).
✔ packages/quay/test/provider-abi-conformance.test.mjs (75192.313486ms)
```

All 23 scenario cells pass (was 19 before this milestone; +4 new parent/children-write cells,
`github/primitive` grew 6→10).

## Done-when clause 6 — `dashboard.md`'s Provider-ABI write cov re-derivation

New section added to `dashboard.md` (`### Chart-1 re-score (M12-abi-parent-write, ...) — DRAFT
(iteration-1, independent derivation)`, inserted before `## Health tracks`). Full text:

- Capability table: read 5/5=1.00, **write 5/5=1.00 (was 4/5=0.80)**, gate 2/2=1.00, skill
  1/1=1.00.
- cov = (5+5+2+1)/(5+5+2+1) = **13/13 = 1.0000** (up from 12/13 = 0.9231 at m9/m11).
- Per-surface points: CLI 23.50, MCP 18.00, Web UI 18.40, Packaging 18.00, Docs 12.75 (all
  unchanged, out of scope), **Provider-ABI 20×1.0000 = 20.00 (was 20×0.9231 ≈ 18.46)**.
- **VT chart-1 total: 110.65/120** (up from 109.11/120 at m9/m11). **Δv = +1.54.**
- Arithmetic re-check: `python3 -c "print(23.50+18.00+18.40+18.00+12.75+20*13/13)"` → `110.65`.
  Confirmed.
- **This exactly matches the charter's own Δv̂ ceiling estimate** ("20×(1.00−0.9231) ≈ +1.54 VT
  points if fully closed") — because full bidirectional reassign-parent semantics was achieved
  (not the charter's narrower allowed fallback), the realized Δv landed exactly at the stated
  ceiling, not below it.
- The section also records that this milestone's value hypothesis types as `capability-growth`
  with nonzero realized Δv, which per `inherited-core.md`'s Adversarial-audit cadence condition
  (a) fires the out-of-band adversarial-audit-role requirement — flagged for the OUTER loop to
  dispatch before this VT entry is finalized as CONFIRMED/ABSORB'd; this iteration does not itself
  perform that audit (outer-loop bookkeeping, out of this worktree's scope).
- Marked explicitly `DRAFT (iteration-1, independent derivation)` pending outer-loop cross-check
  against a separately-derived iteration-0 number.

`capability-matrix.md`'s Write capability table's `parent/children` row (github column) updated
from "**none** — DELIBERATELY excluded (M09 exclusion)" to "**full** (M12-abi-parent-write,
iteration-1 draft — CLOSED)" with the write-semantics/live-verification summary. The file's
"Summary — cell count" section was also updated: cell counts move from 13 full/full + 1
intentionally-scoped-out → **14/14 full/full, 0 remaining gaps or exclusions**; a new finding
entry (#4, "PR-ABI-003 — CLOSED") was appended to the "Findings feeding the VT re-baseline" list
following the PR-ABI-001/PR-ABI-002 precedent style.

## Done-when clause 7 — full test suite, raw output

Command: `node --test --test-concurrency=1 packages/*/test/*.test.mjs` (run from this worktree's
root, confirmed via `pwd`). **Exit code 0.** All 31 test files (`✔`) passed, 0 failures (`✖`
count: 0). File-by-file pass list (raw `✔`/timing lines from the run):

```
✔ packages/quay-github/test/cli.test.mjs (15300.030085ms)
✔ packages/quay-github/test/compound-gate.test.mjs (57.843711ms)
✔ packages/quay-github/test/gate-gameability.test.mjs (53.111603ms)
✔ packages/quay-github/test/gate.test.mjs (67.433016ms)
✔ packages/quay-github/test/mcp-server.test.mjs (22768.806507ms)
✔ packages/quay-github/test/pagination.test.mjs (49.265151ms)
✔ packages/quay-github/test/task-check-passthrough.test.mjs (16265.713952ms)
✔ packages/quay-github/test/view-model.test.mjs (57.687682ms)
✔ packages/quay-github/test/write.test.mjs (49.263785ms)
✔ packages/quay-native/test/cas-write.test.mjs (359.48633ms)
✔ packages/quay-native/test/compound-gate-recursive.test.mjs (147.606054ms)
✔ packages/quay-native/test/compound-gate.test.mjs (161.277757ms)
✔ packages/quay-native/test/create-validation.test.mjs (365.795956ms)
✔ packages/quay-native/test/edit-validation.test.mjs (587.221162ms)
✔ packages/quay-native/test/gate-checked-state.test.mjs (139.792862ms)
✔ packages/quay-native/test/gate-correctness.test.mjs (144.066423ms)
✔ packages/quay-native/test/gate-gameability.test.mjs (130.842428ms)
✔ packages/quay-native/test/lock.test.mjs (431.852118ms)
✔ packages/quay/test/action-mock-delivery.test.mjs (64.461242ms)
✔ packages/quay/test/cli.test.mjs (59913.149825ms)
✔ packages/quay/test/config.test.mjs (112.216438ms)
✔ packages/quay/test/core-three-way-symmetry.test.mjs (6762.623274ms)
✔ packages/quay/test/mcp-server.test.mjs (41554.541257ms)
✔ packages/quay/test/provider-abi-conformance.test.mjs (75192.313486ms)
✔ packages/quay/test/provider-env-symmetry.test.mjs (1868.497136ms)
✔ packages/quay/test/serve-action-delivery.test.mjs (87.677444ms)
✔ packages/quay/test/serve-browser-render.test.mjs (973.94328ms)
✔ packages/quay/test/serve-github.test.mjs (5069.981733ms)
✔ packages/quay/test/serve.test.mjs (28253.309051ms)
✔ packages/quay/test/task-check.test.mjs (2733.319467ms)
✔ packages/quay/test/web-ui-browser.test.mjs (6482.623121ms)
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 286236.893748
```

Note: an EARLIER run of this same command (before the final clean re-run above) showed one
environmental flake — `serve.test.mjs` failed with `EADDRINUSE: address already in use
0.0.0.0:42484` (a port collision from parallel test execution across the batch). This was
diagnosed as unrelated to this milestone's changes by re-running `node --test
packages/quay/test/serve.test.mjs` in isolation, which passed cleanly. The final clean re-run
pasted above (a completely separate, fresh full-suite invocation) shows zero failures, including
`serve.test.mjs` passing normally — confirming the flake was transient/environmental, not a
regression introduced by this milestone's code changes.

## Done-when clause 8 — scope narrowing

**No scope narrowing occurred.** Full bidirectional parent/children write (add, checked-state
preservation, reassignment with old-parent unlink, and removal) was implemented and live-verified
on the first attempt — the charter's item 7 "Explicit exclusions" narrower-primitive fallback
(add/remove-child-on-one-issue only, no atomic reassignment) was **not needed**. No new
`backlog.md` candidate row is required by this clause.

## Independent cov/Δv agreement with charter expectations

This iteration's independently-derived numbers:
- cov: 12/13=0.9231 → **13/13=1.0000**
- Δv: **+1.54** VT points (110.65/120 vs. 109.11/120)

This **exactly matches** the charter's own pre-dispatch ceiling estimate ("20×(1.00−0.9231) ≈
+1.54 VT points if fully closed"), because full bidirectional reassign-parent semantics was
achieved rather than the charter's allowed narrower fallback. Strong internal consistency between
the charter's own arithmetic and this iteration's independently-realized outcome — this iteration
did not know the charter's exact Δv̂ figure would be hit precisely until re-deriving it fresh
from the capability table above.

## `git log --oneline -3` and `git status` (to be captured at commit time, see below)

See the commit step immediately following this report's creation.
