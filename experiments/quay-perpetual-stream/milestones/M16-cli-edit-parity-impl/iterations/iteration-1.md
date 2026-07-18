# M16-cli-edit-parity-impl — iteration-1

**Independent re-derivation.** This iteration did NOT read iteration-0's worktree, branch
(`exp5-m16-iteration-0`), or report — it independently implemented the same charter from the same
design doc (`docs/proposals/exp5-cli-edit-parity.md`) and base commit `c668ff0` (SELECT m16), for
the outer loop to compare both derivations before merging.

**Worktree:** `experiments/quay-perpetual-stream/milestones/M16-cli-edit-parity-impl/worktrees/iteration-1`
**Branch:** `exp5-m16-iteration-1`
**Final commit:** `cb59284585915f73e2c8cd854c4f1371222f66b5`

## §1. HARD GATES (literal command output)

### Gate 1 — directives/pending/ disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
(no output, empty directory, exit 0)
```

**Disposition: N/A — no files present.** The directory is empty; there is nothing to disposition
this iteration. (`dashboard.md`'s own m16 SELECT log entry confirms: "`directives/pending/`
re-drained: empty." — consistent with what this iteration independently observed.)

### Gate 2 — worktree isolation proof

At start:
```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M16-cli-edit-parity-impl/worktrees/iteration-1
$ git rev-parse --abbrev-ref HEAD
exp5-m16-iteration-1
$ git log -1 --oneline
c668ff0 SELECT m16 = M-CLI-EDIT-PARITY-IMPL
```

At end:
```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M16-cli-edit-parity-impl/worktrees/iteration-1
$ git rev-parse --abbrev-ref HEAD
exp5-m16-iteration-1
$ git log -1 --oneline
cb59284 M16-cli-edit-parity-impl iteration-1: task edit full-field parity
```

All development/test edits targeted paths under this worktree directory only. The
`experiments/quay-perpetual-stream/inherited-core.md` edit (Done-when 4) was made to the COPY of
that file *inside this worktree* (`.../worktrees/iteration-1/experiments/quay-perpetual-stream/
inherited-core.md`), per the task instructions — it will be reconciled against the shared main
tree's copy at merge time by the outer loop, not applied directly to the shared tree from here.

### `.manda/hub.addr` / `curl localhost:4173` reachability gates

**N/A, stated explicitly.** This milestone has no live dashboard/UI dependency (per the task
prompt's own framing) — no manda hub, no `quay serve` dependency for any Done-when clause. Not
fabricated.

## §2. Done-when clause-by-clause status

### 1. `task edit` handler relaxed per §1.2 — pasted diff

**MET.** `packages/quay/bin/quay.js`'s `task edit` handler now accepts `--title`, `--body`,
`--body-file`, `--labels`, `--extra`, `--parent`, `--children`, `--expect-status`, `--append-notes`;
the `--status <s> is required` guard is replaced by an "at least one field" guard. Full diff:

```diff
--- a/packages/quay/bin/quay.js
+++ b/packages/quay/bin/quay.js
@@ -3,6 +3,7 @@
 // to the Web UI (proposal §9): `serve` / `task` / `action`.
 
 import path from "node:path";
+import fs from "node:fs/promises";
 import { loadConfig, activeProvider } from "../src/config.js";
 import { connectProvider } from "../src/provider-client.js";
 import { composePayload, deliverTrigger } from "../src/action.js";
@@ -51,6 +52,33 @@ function resolvePageSize(flags) {
   return { pageSize: n, error: null };
 }
 
+// M16-cli-edit-parity-impl (design doc exp5-cli-edit-parity.md §1.3): reads
+// stdin to completion as a UTF-8 string. Shared by resolveBody's `-` case.
+async function readAllStdin() {
+  const chunks = [];
+  for await (const chunk of process.stdin) chunks.push(chunk);
+  return Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString("utf8");
+}
+
+// M16-cli-edit-parity-impl (design doc §1.3's resolveBody sketch): resolves
+// the new body value for `task edit` ...
+async function resolveBody(flags) {
+  if (flags["body-file"] !== undefined) {
+    if (flags["body-file"] === "-") {
+      return await readAllStdin();
+    }
+    return await fs.readFile(flags["body-file"], "utf8");
+  }
+  return flags.body;
+}
+
 function parseFlags(argv) {
...
   if (cmd === "task" && sub === "edit") {
     // QN-024 ... (comment expanded, see full file diff for wording)
     const id = positional[0];
-    if (!flags.status) {
-      console.error("quay task edit: --status <s> is required (v1 supports status-only writes)");
+
+    if (flags.body !== undefined && flags["body-file"] !== undefined) {
+      console.error("quay task edit: --body and --body-file are mutually exclusive");
+      process.exitCode = 1;
+      return;
+    }
+
+    if (flags["append-notes"] !== undefined) {
+      await withProvider(async (client) => {
+        const before = await client.taskGet(id);
+        if (!before) {
+          console.error(`no such task: ${id}`);
+          process.exitCode = 1;
+          return;
+        }
+        const noteText = flags["append-notes"] === true ? "" : String(flags["append-notes"]);
+        const separator = before.body && before.body.length > 0 && !before.body.endsWith("\n") ? "\n" : "";
+        const newBody = `${before.body ?? ""}${separator}${noteText}\n`;
+        const patch = { id, body: newBody };
+        if (flags.title !== undefined) patch.title = flags.title;
+        if (flags.status !== undefined) patch.status = flags.status;
+        if (flags.labels !== undefined) patch.labels = String(flags.labels).split(",").filter(Boolean);
+        if (flags.parent !== undefined) patch.parent = flags.parent;
+        if (flags.children !== undefined) patch.children = String(flags.children).split(",").filter(Boolean);
+        if (flags.extra !== undefined) patch.extra = JSON.parse(flags.extra);
+        if (flags["expect-status"] !== undefined) patch.expectedStatus = flags["expect-status"];
+        const t = await client.taskWrite(patch);
+        if (wantsJson) printJson(t);
+        else console.log(`${t.id}: ${t.title} [${t.status}]`);
+      }, { providerId: flags.provider });
+      return;
+    }
+
+    const patch = {};
+    if (flags.title !== undefined) patch.title = flags.title;
+    if (flags.status !== undefined) patch.status = flags.status;
+    if (flags.labels !== undefined) patch.labels = String(flags.labels).split(",").filter(Boolean);
+    if (flags.parent !== undefined) patch.parent = flags.parent;
+    if (flags.children !== undefined) patch.children = String(flags.children).split(",").filter(Boolean);
+    if (flags.extra !== undefined) patch.extra = JSON.parse(flags.extra);
+    if (flags.body !== undefined || flags["body-file"] !== undefined) {
+      patch.body = await resolveBody(flags);
+    }
+    if (flags["expect-status"] !== undefined) patch.expectedStatus = flags["expect-status"];
+
+    if (Object.keys(patch).length === 0) {
+      console.error(
+        "quay task edit: at least one of --title/--status/--body/--body-file/--labels/--extra/" +
+        "--parent/--children/--append-notes is required"
+      );
       process.exitCode = 1;
       return;
     }
+
     await withProvider(async (client) => {
-      const t = await client.taskWrite({ id, status: flags.status });
+      const t = await client.taskWrite({ id, ...patch });
       if (wantsJson) printJson(t);
       else console.log(`${t.id}: ${t.title} [${t.status}]`);
     }, { providerId: flags.provider });
```

(Full, uncompressed diff is in commit `cb59284`; `git show cb59284 -- packages/quay/bin/quay.js`.)

Live invocation proving existing `--status`-only callers still work unchanged:
```
$ node packages/quay/bin/quay.js task edit QN-001 --status done --json
{ "id": "QN-001", "status": "done", ... }
```
(unchanged from pre-milestone behavior — status remains a valid, optional field.)

### 2. `--body-file <path>` (incl. `-` for stdin) implemented, mutual-exclusion validated

**MET.**

File-path form:
```
$ echo "Body from a file, multi-line.
Second line." > /tmp/body-test.md
$ node packages/quay/bin/quay.js task edit ZZ-TEST1 --body-file /tmp/body-test.md --json
{
  "id": "ZZ-TEST1", "title": "New title", "status": "todo", "labels": ["a","b"],
  "parent": null, "children": [], "role": "primitive", "extra": {},
  "body": "Body from a file, multi-line.\nSecond line.\n",
  "updatedAt": 1784392138441.1548
}
```

Stdin (`-`) form:
```
$ echo "Body from stdin" | node packages/quay/bin/quay.js task edit ZZ-TEST1 --body-file - --json
{
  "id": "ZZ-TEST1", "title": "New title", "status": "todo", "labels": ["a","b"],
  ...
  "body": "Body from stdin\n",
  "updatedAt": 1784392139325.1526
}
```

Mutual-exclusion validation:
```
$ node packages/quay/bin/quay.js task edit ZZ-TEST1 --body "inline" --body-file /tmp/body-test.md
quay task edit: --body and --body-file are mutually exclusive
exit=1
```

### 3. `--append-notes` implemented — before/after `task_get` body

**MET.**
```
$ node packages/quay/bin/quay.js task view ZZ-TEST1 --json   # BEFORE
{ ..., "body": "Body from stdin\n", ... }

$ node packages/quay/bin/quay.js task edit ZZ-TEST1 --append-notes "Follow-up note added." --json
{ ..., "body": "Body from stdin\nFollow-up note added.\n", ... }   # AFTER — note appended
```
Implemented as the read-then-write convenience described in design doc §4: `client.taskGet(id)` →
append note text to the existing body → `client.taskWrite({id, body: newBody, ...otherFlags})`. No
new ABI tool was added — `provider-client.js` is untouched.

### 4. Portable-metadata-rule wording inserted verbatim into `inherited-core.md`

**MET.** Diff (against the worktree's own copy of `inherited-core.md`):
```diff
+## Portable-metadata convention (body-first, `extra{}` native-only) (M16-cli-edit-parity-impl,
+## design doc `docs/proposals/exp5-cli-edit-parity.md` §3.2 — inserted verbatim per Done-when 4)
+
+A quay task's `body` (markdown) and `labels` are **portable**: every Provider ABI implementation
+(native, GitHub, and any future Provider) is expected to support reading and writing them, because
+both are backed by fields every realistic backing store has (a free-text description field, a
+tag/label mechanism). A task's `extra{}` map is **native-only convenience**: it is an arbitrary
+key/value store specific to the native Provider's own file-backed task store, and MUST NOT be
+relied upon as the sole copy of any fact that needs to survive a Provider switch.
+
+**Rule for anyone writing metadata onto a task that must be provider-portable:** the authoritative,
+portable copy of that metadata MUST live in a structured markdown section of the task `body`
+(e.g. a `## <Section Name>` heading with the fact stated in prose or a `Key: value` line
+immediately beneath it — the exact same shape M05's `Status mirror:` body line already
+established). `extra{}` MAY additionally carry the same fact as a machine-readable, native-only
+mirror (e.g. `extra.someKey`) purely as a query-performance convenience on native — but if a
+Provider hard-errors on writing `extra` (as GitHub does per PR-ABI-001's floor), the body copy
+alone must remain sufficient; nothing may be designed to depend on the `extra{}` mirror being
+present.
+
+**Corollary:** any milestone/design that finds itself needing `extra{}` as the ONLY place a fact
+is recorded has mis-designed a provider-portability requirement — either the fact does not
+actually need to be portable (state that explicitly and accept native-only status), or it needs a
+body-section home in addition to (not instead of) the `extra{}` mirror.
```
Verified byte-for-byte against design doc §3.2's proposed wording — verbatim match.

### 5. `--title` two-provider conformance probe — PASS output both native and GitHub

**MET.** New file `packages/quay/test/cli-edit-parity-conformance.test.mjs`. Live PASS output:
```
PASS: native: quay task edit EP-1 --title reaches store.write()'s title field (status=0, title=Edit-parity conformance fixture (renamed))
PASS: github: quay task edit gh-3 --title (idempotent re-assert) reaches github-client.js's real title write (status=0, title=Fix MCP task_write silently dropping the extra field)
```

### 6. `--extra` two-provider conformance probe — PASS both branches

**MET.** Native round-trip:
```
PASS: native: quay task edit EP-1 --extra reaches store.write()'s extra merge, readable back (extra={"probeKey":"probeValue"})
```
GitHub hard-error floor (exact PR-ABI-001 message, gh-3 unmodified):
```
$ node packages/quay/bin/quay.js task edit gh-3 --extra '{"probeKey":"probeValue"}' --provider github --json
Error: task_write: unsupported field(s) [extra] — this Provider does not implement writing extra. Supported fields: id, status, title, body, labels, parent, children.
    at Object.taskWrite (.../packages/quay/src/provider-client.js:36:26)
    ...
exit=1

PASS: github: quay task edit gh-3 --extra exits non-zero (status=1)
PASS: github: stderr contains the EXACT PR-ABI-001 hard-error floor message (expected substring present: true)
PASS: github: gh-3 is UNMODIFIED after the --extra hard-error (title/status/body/labels all unchanged) — proves no partial silent write occurred before the floor fired
```

### 7. `--labels`/`--parent`/`--children` conformance probes extended, all passing

**MET.**
```
PASS: native: quay task edit EP-1 --labels alpha,beta reaches store.write()'s labels field (labels=["alpha","beta"])
PASS: native: quay task edit EP-CHILD --parent EP-PARENT reaches store.write()'s parent field (parent=EP-PARENT)
PASS: native: quay task edit EP-PARENT --children EP-CHILD reaches store.write()'s children field (children=["EP-CHILD"])
PASS: github: quay task edit gh-3 --labels (idempotent re-assert of "") reaches github-client.js's real labels write (labels=[])
PASS: github: quay task edit gh-14 --parent gh-12 reaches github-client.js's real writeRelations() (gh-14.parent=gh-12, gh-12.children=["gh-14"])
PASS: github: quay task edit gh-14 --parent gh-13 (reassign) reaches github-client.js's real writeRelations() reassign path (gh-14.parent=gh-13)
```
Full run summary: `--- cli-edit-parity-conformance: ALL PASS ---` (13/13 assertions, 0 failures).
The GitHub `parent`/`children` probes reuse the dedicated gh-12/gh-13/gh-14 scratch trio
`provider-abi-conformance.test.mjs`'s own M12 block already established (never touching the
read-only gh-3/gh-7 title/status/labels fixtures for destructive writes), and this test's own final
state (gh-14.parent=gh-13, gh-12 empty) matches the convergent state `provider-abi-conformance.
test.mjs` itself leaves things in when run — confirmed no cross-file fixture drift by re-running
`provider-abi-conformance.test.mjs` immediately after and observing all 23 of its own scenario cells
still PASS.

### 8. README/DESIGN `task edit` usage text updated to full flag set

**MET (README.md; DESIGN.md has no `task edit` flag-reference text to update — see note below).**
Diff (`packages/quay/README.md`):
```diff
-### `quay task view <task-id>` / `quay task edit <task-id> --status <s>`
+### `quay task view <task-id>` / `quay task edit <task-id> [flags]`
...
-`task edit` v1 supports status-only writes; `--status <s>` is required.
+`task edit` (M16-cli-edit-parity-impl) has full-field parity with the native
+provider CLI/MCP `task_write`: at least one of `--title` / `--status` /
+`--body` / `--body-file` / `--labels` / `--extra` / `--parent` / `--children`
+/ `--append-notes` is required ...
+
+| Flag | Meaning |
+| --- | --- |
+| `--title <t>` | Set title (portable — every Provider is expected to support it) |
+| `--status <s>` | Set status |
+| `--body <text>` | Set body verbatim (short-string mode; shell argument) |
+| `--body-file <path>` | Set body verbatim from a file; `-` reads from stdin. ... |
+| `--labels <a,b,c>` | Set labels (comma-separated; portable) |
+| `--extra <json>` | Set the `extra{}` map ... **Native-only** — GitHub hard-errors ... |
+| `--parent <id>` | Set parent task id |
+| `--children <a,b,c>` | Set children task ids (comma-separated) |
+| `--expect-status <s>` | Compare-and-swap ... |
+| `--append-notes <text>` | Read-then-write convenience ... |
+
+$ node packages/quay/bin/quay.js task edit QN-001 --title "New title" --labels bug,p1
+$ node packages/quay/bin/quay.js task edit QN-001 --body-file ./new-body.md
+$ cat notes.md | node packages/quay/bin/quay.js task edit QN-001 --body-file -
+$ node packages/quay/bin/quay.js task edit QN-001 --append-notes "Investigated further, see PR #42"
+
+A Provider that does not implement writing a given field ... surfaces its own
+explicit hard-error message and a non-zero exit code ...
```
`quay.js`'s own `--help` text was also updated (usage synopsis + a new "Options for task edit"
block + 3 new examples), so `quay --help` and `quay task --help` are consistent with README.md.

`packages/quay/DESIGN.md` was audited (grep for `task edit`) and found to contain NO flag-usage
reference text for `task edit` at all — its 3 mentions (lines 293/308/339) are all about the
Core-level three-way (CLI/MCP/Web UI) symmetry contract explicitly scoping `task edit`/`task check`
OUT of the Web UI, unrelated to flag documentation. There is nothing in DESIGN.md to update for this
Done-when clause; README.md is the sole file with actual `task edit` usage/flag-reference text, and
it is updated. (Named explicitly rather than silently assumed covered.)

### 9. Full existing test suite passes post-change — raw output

**MET.**
```
$ node --test --test-concurrency=1 packages/*/test/*.test.mjs
```
All 30 test files (`packages/quay-github/test/*.test.mjs` [9 files], `packages/quay-native/test/
*.test.mjs` [8 files], `packages/quay/test/*.test.mjs` [13 files, including the 2 new/re-run
conformance files]) completed with `✔` — zero `✖`, zero `not ok` lines anywhere in the full log.
Per-file completion lines (representative excerpt):
```
✔ packages/quay-github/test/cli.test.mjs (11981.520159ms)
✔ packages/quay-github/test/mcp-server.test.mjs (20797.807351ms)
✔ packages/quay-native/test/edit-validation.test.mjs (630.241297ms)
✔ packages/quay/test/cli-edit-parity-conformance.test.mjs (39573.633732ms)
✔ packages/quay/test/cli.test.mjs (60965.721276ms)
✔ packages/quay/test/provider-abi-conformance.test.mjs (70300.781166ms)
✔ packages/quay/test/mcp-server.test.mjs (42422.084021ms)
✔ packages/quay/test/serve.test.mjs (28022.068253ms)
✔ packages/quay/test/web-ui-browser.test.mjs (5419.29643ms)
  ℹ tests 32
  ℹ pass 32
  ℹ fail 0
```
Total PASS assertion count across the full log: **1053 PASS, 0 FAIL** (`grep -c "^PASS"` / `grep -c
"^FAIL"` over the captured log). Full run took ≈317s wall-clock (dominated by live-GitHub-network
tests, browser-driven Web UI tests, and this milestone's own new live-GitHub conformance probes).

### 10. `--extra` GitHub conformance probe — live GitHub write access

**MET, NOT blocked-on-environment.** `gh auth status` in this environment shows an authenticated
session (`yaleh`, scopes including `repo`) with real write access to `yaleh/quay`. Rather than
requiring a Docker audit-channel wrapper (the M09/M12 pattern was for an *independently-provisioned,
differently-configured* environment audit, not a prerequisite for having `gh` access at all), this
iteration ran the live GitHub probes directly against the host's own already-authenticated `gh` CLI,
which the GitHub Provider's `github-client.js` shells out to. This satisfies the charter's "live
external-system access required" note directly — see Done-when 5-7's pasted PASS output above,
all of which include real, live `yaleh/quay` reads/writes (gh-3's idempotent title/labels
re-assert, gh-12/13/14's real parent/children mutation, gh-3's real hard-error-floor probe). No
Docker container was additionally built this iteration (unlike M09's own two-container precedent) —
that pattern exists to prove the fix works in an *independently-provisioned* environment as a
domain-misfit audit channel, which is a different concern from "is live GitHub write access
available at all" (which it demonstrably is, confirmed above). This is disclosed explicitly as a
scope note, not silently substituted.

## §3. it0 ceiling arithmetic (Done-when 9 in the "Your task" numbering, it0 check (a) in the
## charter)

**Does this CLI-edit-surface closure map to an existing VT-chart cell?**

The VT chart's CLI surface (weight=25) is currently scored `cov=0.94` (23.50/25 points), last
re-derived at m8 (`dashboard.md` line 134). That rationale explicitly enumerates ALL FOUR specific
capability losses that motivated the <1.0 score (`--version`/`-V`, `--page-size` in 3 modes,
`--format json` alias) and states the residual gap as **"no other CLI surface was touched this
milestone (out of scope per charter item 9), same ceiling reasoning iteration-0 gave"** — i.e. the
0.06-point gap below 1.0 is an unattributed, unitemized "not perfect" residual, not a named,
scored gap tied to `task edit`'s status-only restriction.

Cross-checked against `gap-list.md`: `task edit`'s status-only restriction on the **Core CLI** was
never itself logged as a standalone CLI-surface gap entry. The one related entry, PR-ABI-001,
is about the **GitHub Provider's own `task_write` MCP tool schema** silently dropping unsupported
fields (already closed at M09-gh-write) — a different (ABI/Provider-layer) gap from the Core CLI's
own flag-parsing restriction this milestone closes. DIR-011/M14's design doc named the Core CLI's
status-only restriction informally, but it was never translated into a scored CLI-cov deduction at
any chart re-score (m4 or m8).

**Conclusion: this closure does NOT map to a named, already-scored VT-chart cell.** Per the
charter's own explicit instruction ("if the existing VT formula has no CLI-edit-surface cell to
move, record Δv̂=0 and re-type this milestone discovery-only rather than force a fabricated
number") and the standing "no VT-chart claim without ceiling/floor arithmetic" it0 check:

**Δv̂ = 0, recorded explicitly.**

This milestone is re-typed at ABSORB time as **capability-growth in spirit (a real, evidenced,
tested CLI usability closure — status-only → full-field parity) but VT-zero in the chart-formula
sense**, matching M13/M14/M15's own zero-VT precedent rather than M09/M12's positive-Δv precedent.
This has a direct consequence for the charter's own "Adversarial-audit gate — expected to trigger"
section: that section predicted the gate would fire under condition (a) ("a capability-growth-typed
milestone posts a nonzero realized VT Δv at ABSORB") IF the ceiling arithmetic found a real nonzero
Δv̂. Since this iteration's independent ceiling arithmetic finds Δv̂=0, condition (a) does **NOT**
apply by this iteration's own derivation — this is a genuine finding for the outer loop to
reconcile against iteration-0's own independent arithmetic (which this iteration deliberately did
not read).

## §4. `git diff --stat` against the pre-charter base commit

```
$ git diff c668ff0 --stat
 .../quay-perpetual-stream/inherited-core.md        |  25 +++++
 packages/quay/README.md                            |  34 +++++-
 packages/quay/bin/quay.js                          | 123 ++++++++++++++++++++-
 3 files changed, 176 insertions(+), 6 deletions(-)
```
Plus one new file (not shown by `--stat` against a diff target until staged/committed):
`packages/quay/test/cli-edit-parity-conformance.test.mjs` (new, 265 lines). Final committed diff
(`git show cb59284 --stat`):
```
 experiments/quay-perpetual-stream/inherited-core.md |  25 +++
 packages/quay/README.md                             |  34 ++-
 packages/quay/bin/quay.js                            | 123 +++++++++-
 packages/quay/test/cli-edit-parity-conformance.test.mjs | 265 ++++++++++++
 4 files changed, 441 insertions(+), 6 deletions(-)
```
Exactly the expected file set per Done-when 10's own enumeration: `packages/quay/bin/quay.js`,
`inherited-core.md`, README.md (DESIGN.md untouched — no relevant text to update, see §2 item 8),
and one new conformance test file. No unrelated product code touched.

## §5. Self-check pass — defects/gaps actively hunted (independent re-verification discipline)

Per the task's own framing that iteration-1 across 5 of this experiment's prior milestones caught
something real that iteration-0-equivalent work missed, this iteration actively looked for defects
rather than assuming the first pass was complete:

1. **`--extra` with invalid JSON** — throws an unhandled `SyntaxError` (ugly stack trace, exit 1),
   rather than a clean CLI error message. Checked whether this is a regression this milestone
   introduces: confirmed byte-identical behavior already exists on the **native provider CLI**
   (`quay-native task edit ... --extra 'not-json'` throws the exact same `SyntaxError` shape) — this
   is a genuine, pre-existing parity match, not a new defect. Named here rather than silently
   fixed out-of-scope (fixing it would mean diverging from the native CLI's own established
   behavior, which the design doc's own §1.2 explicitly asks to mirror "exactly").
2. **`--body-file` with a nonexistent path** — verified it fails clearly (`Error: ENOENT: no such
   file or directory, open '...'`, exit 1) rather than silently writing an empty/garbage body.
   Confirmed correct behavior (fail-clear, no silent data loss).
3. **`task edit <nonexistent-id>` auto-creates the task** — found this pre-existing behavior while
   probing the `--append-notes` path against a missing id (this milestone's own `taskGet`-based
   guard correctly errors `no such task: <id>` for `--append-notes` specifically, but the *plain*
   `task edit <missing-id> --title x` path silently upserts a new task via the native store's own
   `write()` semantics, printing `<id>: x [undefined]` and exiting 0). Verified via `git stash` that
   this exact behavior (auto-create-on-edit, `[undefined]` status print) already exists on
   **unmodified master** for the pre-existing `--status`-only path too (`task edit <missing-id>
   --status todo` → `<id>: undefined [todo]`, exit 0) — **confirmed pre-existing, not a regression
   introduced by this milestone.** Flagged here as a genuine, independently-discovered gap
   (undocumented upsert-on-edit semantics, `[undefined]` title print) worth a future milestone's
   attention, but explicitly out of this charter's in-scope-work list (item 7: "do not expand scope
   beyond the design doc's own §6 checklist").
4. **`--append-notes` with no value** (flag present but no following string, e.g. trailing
   `--append-notes` with nothing after it) — `parseFlags()` sets `flags["append-notes"] = true` in
   this case (boolean, not a string). Verified the handler's `noteText = flags["append-notes"] ===
   true ? "" : String(...)` branch handles this gracefully (appends a blank line, does not crash) —
   confirmed live: task's body became `"orig body\n\n"`, no error.
5. **Hard-error message wording exact-match** — cross-checked the GitHub provider's literal
   `task_write` unsupported-field message text
   (`packages/quay-github/src/mcp-server.js` lines 156-162) character-for-character against the
   conformance test's own assertion string; they match exactly (`task_write: unsupported field(s)
   [extra] — this Provider does not implement writing extra. Supported fields: id, status, title,
   body, labels, parent, children.`), including the em-dash and period placement — not a
   loosely-matching substring/regex that would pass on a wording drift.
6. **README/DESIGN drift audit** — grepped both files for every stale reference to "status-only" /
   "v1 supports"; found and fixed the one in README.md (Done-when 8), confirmed DESIGN.md has none
   (see §2 item 8's note).

No further defects found in the implemented surface. Items 1 and 3 are real, named findings that
were NOT introduced by this milestone (pre-existing on master) — surfaced honestly rather than
silently worked around or silently claimed as this milestone's own new gap.

## §6. Summary

Implemented all 10 Done-when clauses from the charter/design-doc §6 checklist:
- `task edit` relaxed to full-field parity (`--title`/`--body`/`--body-file`/`--labels`/`--extra`/
  `--parent`/`--children`/`--expect-status`/`--append-notes`), mirroring the native CLI's own
  flag→patch construction exactly.
- `--body-file <path>` (incl. `-` for stdin) implemented per the design doc's `resolveBody` sketch;
  `--body`/`--body-file` mutual exclusion validated with a clear error.
- `--append-notes` implemented as a read-then-write convenience (no new ABI tool; `provider-
  client.js` untouched).
- Portable-metadata convention (design doc §3.2) inserted verbatim into the worktree's copy of
  `inherited-core.md`.
- New CLI-subprocess-level two-provider conformance test file
  (`packages/quay/test/cli-edit-parity-conformance.test.mjs`, 13 assertions, all PASS) covering
  `--title`/`--extra`/`--labels`/`--parent`/`--children` on both native and live `yaleh/quay`
  GitHub, including the PR-ABI-001 hard-error floor for `--extra` with the exact message text.
  Live GitHub write access was available and used directly (no environment blocker).
- README.md's `task edit` usage text updated to the full flag set (table + 4 new examples);
  DESIGN.md audited and found to have no relevant flag-reference text to update.
- Full existing test suite (30 files, 1053 assertions) passes, zero failures, including the two new
  conformance runs.
- `git diff --stat` against base `c668ff0` confirms only the expected files touched.

**it0 ceiling arithmetic (independent derivation): Δv̂ = 0.** The CLI-surface VT chart cell
(weight=25, cov=0.94) has no named, scored sub-gap corresponding to `task edit`'s status-only
restriction — the 0.06-point residual below 1.0 is an unattributed "not perfect" note from m8, not
a citable target this closure moves. Per the charter's own explicit anti-fabrication instruction,
this milestone is recorded as **Δv̂=0, discovery/usability-closure-typed, not VT-scored** — a
genuine independent finding for the outer loop to reconcile against iteration-0's own arithmetic
(deliberately not read before deriving this).

Self-check pass (§5) found two genuine, pre-existing (not-regressed-by-this-milestone) gaps worth
naming for a future milestone: (1) `--extra`'s invalid-JSON failure mode is an unhandled stack
trace rather than a clean CLI error, matching the native CLI's own existing behavior exactly
(intentional parity, not a new defect); (2) `task edit` on a nonexistent task id silently
auto-creates it with an `[undefined]`-status print rather than erroring — confirmed pre-existing on
unmodified master via `git stash`, not introduced here, and explicitly out of this charter's
in-scope-work list.

**Final commit:** `cb59284585915f73e2c8cd854c4f1371222f66b5` on branch `exp5-m16-iteration-1`.
