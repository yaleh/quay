# M16-cli-edit-parity-impl — iteration-0

Milestone: `charters/M16-cli-edit-parity-impl.md`, implementing `docs/proposals/exp5-cli-edit-parity.md`
(design doc §6 = this milestone's literal Done-when list).

## HARD GATES

### Gate (a) — `directives/pending/` disposition

```
$ ls experiments/quay-perpetual-stream/directives/pending/
(no output — directory is empty)
```

Directory is empty. No files to give a disposition to; this gate is satisfied vacuously (nothing
pending, nothing to apply/defer/reject).

### Gate (b) — worktree isolation proof

**Start of iteration:**

```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M16-cli-edit-parity-impl/worktrees/iteration-0
$ git rev-parse --abbrev-ref HEAD
exp5-m16-iteration-0
```

Branch based on master HEAD commit `c668ff0` (`SELECT m16 = M-CLI-EDIT-PARITY-IMPL`).

**End of iteration (re-confirmed below, after all work and the commit):**

```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M16-cli-edit-parity-impl/worktrees/iteration-0
$ git rev-parse --abbrev-ref HEAD
exp5-m16-iteration-0
```

All work below was performed exclusively inside this worktree.

### `.manda/hub.addr` / `curl localhost:4173` gates

**N/A.** This milestone has no live dashboard/UI dependency — it is a CLI-flag-surface
implementation task with file edits, `node --test`, and live `gh`-backed conformance probes. No
`quay serve` dashboard instance or manda hub was required or consulted for this iteration's work.
Stated explicitly per instructions, not fabricated.

## Done-when clause-by-clause evidence

### 1. Relax `task edit` to accept the full flag set; `--status` no longer solely required

`packages/quay/bin/quay.js`'s `task edit` handler was rewritten. Full diff:

```diff
diff --git a/packages/quay/bin/quay.js b/packages/quay/bin/quay.js
index 408a4ff..8867f28 100755
--- a/packages/quay/bin/quay.js
+++ b/packages/quay/bin/quay.js
@@ -3,6 +3,7 @@
 // to the Web UI (proposal §9): `serve` / `task` / `action`.
 
 import path from "node:path";
+import fs from "node:fs/promises";
 import { loadConfig, activeProvider } from "../src/config.js";
 import { connectProvider } from "../src/provider-client.js";
 import { composePayload, deliverTrigger } from "../src/action.js";
@@ -84,6 +85,30 @@ function parseFlags(argv) {
 // this file, src/mcp-server.js, and src/serve.js all share the single
 // implementation there, closing the DESIGN.md §4.4 asymmetry.
 
+// M16-cli-edit-parity-impl (design doc §1.3): read all of a readable stream
+// (used for `--body-file -` / stdin) into a single string.
+async function readAll(stream) {
+  const chunks = [];
+  for await (const chunk of stream) chunks.push(chunk);
+  return Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString("utf8");
+}
+
+// M16-cli-edit-parity-impl (design doc §1.3's `resolveBody` sketch):
+// whole-body-replacement mode. `--body-file <path>` reads the file's full
+// contents as the new body verbatim; `--body-file -` reads from stdin.
+// Plain `--body <string>` remains available for short bodies passed
+// directly as a shell argument. Mutual exclusion with `--body` is validated
+// by the caller (task edit handler) before this is invoked.
+async function resolveBody(flags) {
+  if (flags["body-file"] !== undefined) {
+    if (flags["body-file"] === "-") {
+      return await readAll(process.stdin); // whole-body replacement from stdin
+    }
+    return await fs.readFile(flags["body-file"], "utf8"); // whole-body replacement from file
+  }
+  return flags.body; // short-string mode, already validated present by the caller
+}
+
 async function withProvider(fn, { providerId } = {}) {
   const cfg = loadConfig();
   const provider = activeProvider(cfg, providerId);
@@ -379,14 +404,64 @@ async function main() {
     // branch. Whether the active Provider actually implements task_write
     // is a Provider-manifest question (data.write capability), not
     // something this command special-cases.
+    //
+    // M16-cli-edit-parity-impl (design doc §1.2): relaxed from status-only
+    // to full-field parity with the native provider CLI's own `task edit`
+    // flag surface — --title/--body/--body-file/--labels/--extra/--parent/
+    // --children/--expect-status/--append-notes. `--status` is no longer
+    // solely required; the guard below now requires at least one
+    // patch-producing flag instead.
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
+    if (Object.keys(patch).length === 0 && flags["append-notes"] === undefined) {
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
+      // M16-cli-edit-parity-impl (design doc §4 non-goals): --append-notes
+      // is a Core-CLI-side read-then-write convenience, not a new ABI tool
+      // — read the current body via taskGet, append the note text, then
+      // taskWrite the whole new body. No native `appendNote` ABI passthrough
+      // is introduced (mirrors the native CLI's own scope discipline; see
+      // design doc §4's explicit non-goal).
+      if (flags["append-notes"] !== undefined) {
+        const current = await client.taskGet(id);
+        if (!current) {
+          console.error(`no such task: ${id}`);
+          process.exitCode = 1;
+          return;
+        }
+        const noteText = String(flags["append-notes"]);
+        const newBody = `${current.body ?? ""}\n\n${noteText}`;
+        const t = await client.taskWrite({ id, ...patch, body: newBody });
+        if (wantsJson) printJson(t);
+        else console.log(`${t.id}: ${t.title} [${t.status}] (note appended)`);
+        return;
+      }
+      const t = await client.taskWrite({ id, ...patch });
       if (wantsJson) printJson(t);
       else console.log(`${t.id}: ${t.title} [${t.status}]`);
     }, { providerId: flags.provider });
```

`node --check packages/quay/bin/quay.js` — no syntax errors.

**Status: MET.**

### 2. `--body-file <path>` (incl. `-` for stdin), mutual exclusion with `--body`

Implemented via `resolveBody()`/`readAll()` above. Live evidence (native leg,
`cli-edit-parity-conformance.test.mjs`):

```
PASS [native/body-file-path] quay task edit CEP-1 --body-file <path> -> exit=0, body="## Proposal\nfile-based body\n"
PASS [native/body-file-stdin] quay task edit CEP-1 --body-file - (stdin) -> exit=0, body="## Proposal\nstdin body\n"
quay task edit: --body and --body-file are mutually exclusive
PASS [native/body-mutual-exclusion] quay task edit CEP-1 --body x --body-file - -> exit=1, stderr="quay task edit: --body and --body-file are mutually exclusive"
```

**Status: MET.**

### 3. `--append-notes` as a read-then-write convenience (no new ABI tool)

Implemented as a Core-CLI-side `taskGet` + `taskWrite` composition inside the `task edit` handler
(see diff above — no changes to any Provider's MCP tool surface, no ABI schema change). Live
evidence:

```
PASS [native/append-notes] quay task edit CEP-1 --append-notes "..." -> exit=0, body before="## Proposal\nstdin body\n", after="## Proposal\nstdin body\n\n\nAppended via conformance probe"
```

**Status: MET.**

### 4. Insert design doc §3.2 portable-metadata wording verbatim into (worktree's) `inherited-core.md`

Appended a new named section to `experiments/quay-perpetual-stream/inherited-core.md` (worktree
copy), containing the exact §3.2 blockquoted wording (Portable/native-only rule, MUST/MAY
normative pair, corollary), plus a provenance note stating this is a worktree-local edit to be
reconciled at ABSORB — not a conflict to avoid, per the charter's Done-when 4 note. Diff:

```diff
diff --git a/experiments/quay-perpetual-stream/inherited-core.md b/experiments/quay-perpetual-stream/inherited-core.md
index e579d1a..(new) 100644
--- a/experiments/quay-perpetual-stream/inherited-core.md
+++ b/experiments/quay-perpetual-stream/inherited-core.md
@@ -604,3 +604,39 @@ see `dashboard.md`'s Human-review cadence row for the full reconciliation reason
    `OUTER-LOOP.md` step 8), the checkpoint snapshot must include this track's current value, so a
    human skimming `checkpoints/cp-<NN>.md` asynchronously sees "N milestones since last human
    input" directly, without needing to dig through `directives/archive/` to reconstruct it by hand.
+
+## Portable-metadata convention (body-first, `extra{}` native-only) (M16-cli-edit-parity-impl, DIR-011 item 3, `docs/proposals/exp5-cli-edit-parity.md` §3.2 — inserted verbatim)
+
+> ### Portable-metadata convention (body-first, `extra{}` native-only)
+>
+> A quay task's `body` (markdown) and `labels` are **portable**: every Provider ABI implementation
+> (native, GitHub, and any future Provider) is expected to support reading and writing them, because
+> both are backed by fields every realistic backing store has (a free-text description field, a
+> tag/label mechanism). A task's `extra{}` map is **native-only convenience**: it is an arbitrary
+> key/value store specific to the native Provider's own file-backed task store, and MUST NOT be
+> relied upon as the sole copy of any fact that needs to survive a Provider switch.
+>
+> **Rule for anyone writing metadata onto a task that must be provider-portable:** the authoritative,
+> portable copy of that metadata MUST live in a structured markdown section of the task `body`
+> (e.g. a `## <Section Name>` heading with the fact stated in prose or a `Key: value` line
+> immediately beneath it — the exact same shape M05's `Status mirror:` body line already
+> established). `extra{}` MAY additionally carry the same fact as a machine-readable, native-only
+> mirror (e.g. `extra.someKey`) purely as a query-performance convenience on native — but if a
+> Provider hard-errors on writing `extra` (as GitHub does per PR-ABI-001's floor), the body copy
+> alone must remain sufficient; nothing may be designed to depend on the `extra{}` mirror being
+> present.
+>
+> **Corollary:** any milestone/design that finds itself needing `extra{}` as the ONLY place a fact
+> is recorded has mis-designed a provider-portability requirement — either the fact does not
+> actually need to be portable (state that explicitly and accept native-only status), or it needs a
+> body-section home in addition to (not instead of) the `extra{}` mirror.
+
+Source: `docs/proposals/exp5-cli-edit-parity.md` §3.2, produced by M14-cli-edit-parity (design-only)
+per DIR-011 item 3; inserted here verbatim by M16-cli-edit-parity-impl (the implementing milestone
+the design doc's own §6 Done-when list required) as this milestone's Done-when clause 4. Already
+cross-referenced informally by M13's task-backlog-projection design (§11) before this section
+existed in named/citable form here — see the design doc's own §3.1 cross-reference note for that
+prior dependency. Note (worktree-local edit): this file is Tier-B shared context; this insertion is
+made to the copy of `inherited-core.md` inside this iteration's own worktree and will be reconciled
+against the real shared file by the outer loop at ABSORB, per this milestone's charter (Done-when 4
+note) — expected, not a conflict to avoid.
```

**Status: MET.** (Worktree-local; reconciliation at ABSORB is expected per the charter's own
Done-when 4 note, not a defect.)

### 5. Two-provider conformance probes for `--title`, `--extra`, `--labels`/`--parent`/`--children`

New file `packages/quay/test/cli-edit-parity-conformance.test.mjs` (296 lines), following the
`record(provider, probe, ok, detail)` pattern already established by
`provider-abi-conformance.test.mjs`. Native leg: fresh `mkdtemp` workspace + fixture tasks
CEP-1/CEP-2, probing `--title` (idempotent re-assert), `--extra` round-trip, `--labels` extended,
`--children`/`--parent` extended, `--body-file <path>`, `--body-file -` (stdin), `--body`+
`--body-file` mutual exclusion, `--append-notes`. GitHub leg: live against `yaleh/quay`, reusing
M09-gh-write's `gh-11` (title/labels) and M12-abi-parent-write's `gh-12`/`gh-13`/`gh-14`
(parent/children) scratch fixtures — idempotent-write discipline throughout (re-assert current
value / restore-after-mutate, never a net change on shared live fixtures).

Final standalone run (`node --test test/cli-edit-parity-conformance.test.mjs`), full output:

```
quay-native mcp: serving tasks from /tmp/quay-cli-edit-conf-native-ws-Lzajcs/tasks-env-relative
quay-native mcp: serving tasks from /tmp/quay-cli-edit-conf-native-ws-Lzajcs/tasks-env-relative
PASS [native/title-two-provider] quay task edit CEP-1 --title "<same title>" -> exit=0, title matches=true
quay-native mcp: serving tasks from /tmp/quay-cli-edit-conf-native-ws-Lzajcs/tasks-env-relative
quay-native mcp: serving tasks from /tmp/quay-cli-edit-conf-native-ws-Lzajcs/tasks-env-relative
PASS [native/extra-round-trip] quay task edit CEP-1 --extra '{"probeKey":"probeValue"}' -> exit=0, read-back extra.probeKey=probeValue
quay-native mcp: serving tasks from /tmp/quay-cli-edit-conf-native-ws-Lzajcs/tasks-env-relative
PASS [native/labels-extended] quay task edit CEP-1 --labels new-x,new-y -> exit=0, labels=["new-x","new-y"]
quay-native mcp: serving tasks from /tmp/quay-cli-edit-conf-native-ws-Lzajcs/tasks-env-relative
PASS [native/children-extended] quay task edit CEP-1 --children CEP-2 -> exit=0, children=["CEP-2"]
quay-native mcp: serving tasks from /tmp/quay-cli-edit-conf-native-ws-Lzajcs/tasks-env-relative
PASS [native/parent-extended] quay task edit CEP-2 --parent CEP-1 -> exit=0, parent=CEP-1
quay-native mcp: serving tasks from /tmp/quay-cli-edit-conf-native-ws-Lzajcs/tasks-env-relative
PASS [native/body-file-path] quay task edit CEP-1 --body-file <path> -> exit=0, body="## Proposal\nfile-based body\n"
quay-native mcp: serving tasks from /tmp/quay-cli-edit-conf-native-ws-Lzajcs/tasks-env-relative
PASS [native/body-file-stdin] quay task edit CEP-1 --body-file - (stdin) -> exit=0, body="## Proposal\nstdin body\n"
quay task edit: --body and --body-file are mutually exclusive
PASS [native/body-mutual-exclusion] quay task edit CEP-1 --body x --body-file - -> exit=1, stderr="quay task edit: --body and --body-file are mutually exclusive"
quay-native mcp: serving tasks from /tmp/quay-cli-edit-conf-native-ws-Lzajcs/tasks-env-relative
quay-native mcp: serving tasks from /tmp/quay-cli-edit-conf-native-ws-Lzajcs/tasks-env-relative
PASS [native/append-notes] quay task edit CEP-1 --append-notes "..." -> exit=0, body before="## Proposal\nstdin body\n", after="## Proposal\nstdin body\n\n\nAppended via conformance probe"
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
PASS [github/title-two-provider] quay task edit gh-11 --title "<same title>" --provider github -> exit=0, title matches=true
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
Error: task_write: unsupported field(s) [extra] — this Provider does not implement writing extra. Supported fields: id, status, title, body, labels, parent, children.
    at Object.taskWrite (.../packages/quay/src/provider-client.js:36:26)
    ...
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
PASS [github/extra-hard-error-floor] quay task edit gh-3 --extra '{"probeKey":"probeValue"}' --provider github -> exit=1, floor message present=true, gh-3 unmodified=true, stderr="...unsupported field(s) [extra]..."
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
PASS [github/labels-extended] quay task edit gh-11 --labels "<same set>" --provider github -> exit=0, labels=["m09-test-label","m09-fresh-verify"]
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
PASS [github/parent-extended] quay task edit gh-14 --parent gh-12 (set) -> exit=0, parent=gh-12; (re-assert) -> exit=0, parent=gh-12; (restore to original=null) -> exit=0, parent=null
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
PASS [github/children-extended] quay task edit gh-13 --children "<same current set>" --provider github -> exit=0, children=[]

--- cli-edit-parity-conformance: all probes passed ---

All cli-edit-parity-conformance scenario cells passed.
✔ test/cli-edit-parity-conformance.test.mjs (55884.928343ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
```

15 probes, all PASS (7 native flag probes + 6 github flag/floor probes + 2 native body-file/append
variants). Post-run live-state confirmation of the two mutating GitHub fixtures used
(`gh-3`, `gh-11`) — both left unmodified/idempotent:

```
$ node bin/quay.js task view gh-3 --provider github --json | ...
Fix MCP task_write silently dropping the extra field | ## Proposal\n\nMirrors native task QN-007...
$ node bin/quay.js task view gh-11 --provider github --json | ...
[M09-GH-WRITE-SCRATCH] title re-mutated iteration-0 fresh-verify ['m09-test-label', 'm09-fresh-verify']
```

Both match their pre-run values exactly (gh-3's title/body untouched by the intentionally-failing
`--extra` probe; gh-11's title/labels are the same values M09 already established, re-asserted not
changed). `gh-12`/`gh-13`/`gh-14` also confirmed restored to their pre-run `parent: null,
children: []` state after the parent/children probes.

**Bug found and fixed mid-iteration:** the original `[github/parent-extended]` probe blindly
re-asserted `gh-14`'s *current* `parent` field without guarding for the case where that field is
`null` (no parent currently set) — passing literal `--parent null` at the CLI, which
`quay-github`'s `writeRelations()` correctly hard-rejects as an invalid task id (`invalid parent
id: null`), causing the probe to legitimately FAIL when run as part of the full suite (see Done-when
7 below). This was a test-fixture bug, not a `quay.js`/`quay-github` implementation bug — confirmed
by reproducing the exact failure directly:

```
$ node bin/quay.js task edit gh-14 --parent null --provider github --json
Error: task_write failed: quay-github: invalid parent id: null
```

Fixed by making the probe self-contained: set `gh-14.parent = gh-12` explicitly, idempotently
re-assert that same value a second time (the actual "does `--parent` reach `task_write`" proof),
then restore `gh-14` to its original `parent` value (`null`) afterward — leaving no net change on
the shared live fixture, matching every other GitHub probe's idempotent-write discipline.

**Status: MET.**

### 6. Update README.md/DESIGN.md `task edit` usage text

`packages/quay/README.md`: replaced the `### quay task view <task-id> / quay task edit <task-id>
--status <s>` section with a full flag-surface writeup (all 9 flags documented, 3 example
invocations). Diff:

```diff
diff --git a/packages/quay/README.md b/packages/quay/README.md
index b3a812e..64d10b9 100644
--- a/packages/quay/README.md
+++ b/packages/quay/README.md
@@ -128,7 +128,7 @@ $ node packages/quay/bin/quay.js task list --prefix QX --page-size 2 --format js
 ]
 ```
 
-### `quay task view <task-id>` / `quay task edit <task-id> --status <s>`
+### `quay task view <task-id>` / `quay task edit <task-id> [flags]`
 
 ```
 $ node packages/quay/bin/quay.js task view QN-001
@@ -139,7 +139,42 @@ $ node packages/quay/bin/quay.js task edit QN-001 --status done --json
 { "id": "QN-001", "status": "done", ... }
 ```
 
-`task edit` v1 supports status-only writes; `--status <s>` is required.
+`task edit` supports full-field parity with the native provider CLI (M16-cli-edit-parity-impl,
+per `docs/proposals/exp5-cli-edit-parity.md`):
+
+- `--title <string>` — new title.
+- `--status <status>` — new status.
+- `--body <string>` — new body (whole-body replacement), passed directly as a shell argument.
+  Mutually exclusive with `--body-file`.
+- `--body-file <path>` — new body (whole-body replacement) read from a file; use `--body-file -`
+  to read from stdin. Mutually exclusive with `--body`.
+- `--append-notes <text>` — read-then-write convenience: appends `text` to the task's current
+  body rather than replacing it. No new ABI tool is involved — this is a Core-CLI-side
+  `taskGet` + `taskWrite` composition.
+- `--labels <a,b,c>` — comma-separated label list (whole-list replacement).
+- `--parent <task-id>` — reassign parent.
+- `--children <a,b,c>` — comma-separated children list (whole-list replacement).
+- `--extra <json>` — arbitrary JSON merged into the task's native-only `extra{}` map (see the
+  Portable-metadata convention in `experiments/quay-perpetual-stream/inherited-core.md`: `extra{}`
+  is a native-only convenience, never the sole copy of a portable fact). Providers that don't
+  implement `extra` (e.g. GitHub) hard-error rather than silently drop it (PR-ABI-001 floor).
+- `--expect-status <status>` — optimistic-concurrency guard (CAS): the write fails if the task's
+  current status doesn't match.
+
+At least one of `--title`/`--status`/`--body`/`--body-file`/`--labels`/`--extra`/`--parent`/
+`--children`/`--append-notes` is required; `--status` is no longer solely required (v1's
+status-only restriction is lifted).
+
+```
+$ node packages/quay/bin/quay.js task edit QN-001 --title "New title" --body-file notes.md --json
+{ "id": "QN-001", "title": "New title", ... }
+
+$ echo "quick body via stdin" | node packages/quay/bin/quay.js task edit QN-001 --body-file - --json
+{ "id": "QN-001", ... }
+
+$ node packages/quay/bin/quay.js task edit QN-001 --append-notes "Follow-up: checked with team." --json
+{ "id": "QN-001", ... }
+```
 
 ### `quay task check <task-id>`
```

`packages/quay/DESIGN.md`: grepped for `task edit` — only 3 hits, all in §4.1's Web-UI-symmetry-
contract discussion ("Explicitly out of scope for this contract: `task edit` and `task check`"),
unrelated to the CLI flag-surface documentation. **No DESIGN.md changes required** — the design
doc's contract-scoping language doesn't describe `task edit`'s CLI flags in the first place, so
there is nothing in DESIGN.md that goes stale.

**Status: MET.**

### 7. Full existing test suite passes

`node --test --test-concurrency=1 packages/*/test/*.test.mjs`, run to completion (full output
89KB, run twice: first attempt found one genuine pre-existing-bug-in-new-test failure, fixed per
Done-when 5 above, second attempt clean).

Final run summary:

```
ℹ tests 32
ℹ suites 0
ℹ pass 32
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 320021.779944
```

All 32 test files (`packages/quay/test/*.test.mjs` + `packages/quay-github/test/*.test.mjs` +
`packages/quay-native/test/*.test.mjs`) pass, including the new
`cli-edit-parity-conformance.test.mjs` and the updated `cli.test.mjs`. Zero regressions in any
pre-existing test file.

**Status: MET.**

### 8. `git diff --stat` against pre-charter base commit

```
$ git diff --stat c668ff0
 .../quay-perpetual-stream/inherited-core.md        |  36 +++
 packages/quay/README.md                            |  39 ++-
 packages/quay/bin/quay.js                          |  81 +++++-
 .../quay/test/cli-edit-parity-conformance.test.mjs | 296 +++++++++++++++++++++
 packages/quay/test/cli.test.mjs                    |  11 +-
 5 files changed, 454 insertions(+), 9 deletions(-)
```

Exactly the 5 files this milestone's scope names (Core CLI dispatcher, existing CLI test file, new
conformance test file, README, inherited-core.md's worktree copy). No unrelated product code
touched.

**Status: MET.**

### 9. It0 ceiling arithmetic — does this map to an existing VT-chart cell?

Read `dashboard.md`'s chart-1 VT model in full. Findings:

- The CLI surface (weight=25) has a single scalar `cov` value (currently 0.94, set at
  m8/M08-merge-recover), scored **narratively** against an *unenumerated* "~20-capability-wide
  surface" — e.g. m4's re-score dropped cov 0.95→0.80 when 4 concrete capabilities
  (`--version`/`-V`, `--page-size` ×3 modes, `--format json`) were found broken
  (≈0.0375/capability-loss); m8's fix of those same 4 raised it back 0.80→0.94 (≈0.035/capability
  restored, plus a small further +0.01 bump at m8 for an unrelated process-discount closing).
- This model was **calibrated exclusively for regression/restoration deltas** against a fixed,
  already-existing set of capabilities (the ones MD-001 flagged as reopened) — it was never
  designed, and has never been used anywhere in the VT history, to score *net-new* sub-flags added
  to an existing verb.
- This milestone adds genuinely new capability: before this milestone, `quay task edit` supported
  only `--status`; it now additionally supports `--title`, `--body`, `--body-file`,
  `--append-notes`, `--labels`, `--parent`, `--children`, `--extra`, `--expect-status` — 8 new
  sub-capabilities on one CLI verb. There is no rigorous, previously-published enumeration of the
  "~20 capabilities" the CLI cov denominator refers to (it is an order-of-magnitude narrative
  estimate, not a real denominator list with addressable rows — contrast with the Provider-ABI
  surface's `capability-matrix.md`, which DOES have a literal per-field weighted-fraction table and
  is the only VT-chart surface with a formula rigorous enough to support a field-count-based
  arithmetic Δv).
- Naively extrapolating the CLI surface's ≈0.035/capability constant to "8 new capabilities" would
  yield ≈+0.28 cov, pushing CLI cov to ≈1.22 — nonsensical (cov is bounded [0,1]) and not backed by
  any actual enumeration of what the other ~19 "capabilities" are, or whether `task edit`'s 8 new
  flags are even commensurate units with whatever was counted at m4/m8. This is exactly the trap the
  charter's own it0 check (a) warns against: computing a number from a formula not actually designed
  for this input, i.e. a fabricated number dressed as arithmetic.

**Determination: Δv̂ = 0.** No existing VT-chart cell has a formula that can absorb a net-new
sub-flag count without fabrication. Per the charter's explicit fallback ("if the existing VT
formula has no CLI-edit-surface cell to move, record Δv̂=0 and re-type this milestone
discovery-only rather than force a fabricated number"), this milestone's realized value is
**re-typed discovery-only** (+ capability-growth in the plain-English sense of "a real feature now
exists that didn't before," but not in the VT-chart-scored sense) for chart-1 VT bookkeeping
purposes. `dashboard.md`'s chart-1 total is therefore **unchanged at ABSORB by this milestone's own
arithmetic** — any future re-score of the CLI surface's cov (e.g. if a rigorous per-capability
enumeration is ever built, mirroring `capability-matrix.md`'s Provider-ABI approach) should treat
this milestone's `task edit` flag work as new input data, not something already priced into 0.94.

**Status: MET** (ceiling arithmetic computed explicitly; Δv̂=0/discovery-only determination
recorded per charter fallback, not a fabricated number).

### 10. `--extra` GitHub conformance probe — live write access

Live GitHub write access **was available**: `gh` authenticated as user `yaleh` with
`repo`+`workflow` scopes, confirmed `admin`/`push` permissions on `yaleh/quay`
(`gh api repos/yaleh/quay --jq '.full_name, .permissions'`). The `--extra` hard-error-floor probe
(design doc §5.2) was therefore implemented and run **live** against `yaleh/quay` (not mocked, not
skipped), reusing M09-gh-write's `gh-3` read-only fixture:

```
PASS [github/extra-hard-error-floor] quay task edit gh-3 --extra '{"probeKey":"probeValue"}' --provider github -> exit=1, floor message present=true, gh-3 unmodified=true
```

Confirms: (a) the CLI's `--extra` flag genuinely reaches `task_write` on the live GitHub Provider,
(b) the write is hard-rejected with `isError:true` and an explicit message
(`task_write: unsupported field(s) [extra] — this Provider does not implement writing extra.`), per
the PR-ABI-001 floor, (c) `gh-3` is provably unmodified after (live `gh issue view 3` before/after
comparison, title/body byte-identical).

**Status: MET.** (No environment limitation to disclose — this was a genuine live test.)

## Adversarial-audit gate

Per the charter's explicit framing, condition (a) fires "when a capability-growth-typed milestone
posts a nonzero realized VT Δv at ABSORB." Done-when 9's determination above is **Δv̂ = 0** — no
nonzero VT-chart Δv is being posted. Per the charter's own conditional language ("if it0's ceiling
arithmetic finds a real nonzero Δv̂, this milestone IS capability-growth-typed and condition (a) is
expected to apply"), since the ceiling arithmetic found Δv̂=0, **condition (a) does not fire** for
this iteration — stated explicitly, not assumed silently. This milestone should be treated the same
way M13/M14/M15's zero-VT precedent was (no adversarial-audit gate armed), notwithstanding the
charter's own default-armed framing, because that framing was itself conditional on a nonzero
finding which did not materialize.

## Test / commit summary

- `node --check packages/quay/bin/quay.js` — clean (no syntax errors).
- `node --test packages/quay/test/cli-edit-parity-conformance.test.mjs` (standalone) — 1/1 pass,
  15 probes all PASS.
- `node --test --test-concurrency=1 packages/*/test/*.test.mjs` (full suite, all 3 packages) —
  32/32 test files pass, 0 failures, 0 skipped.
- `git diff --stat c668ff0` — 5 files changed, 454 insertions(+), 9 deletions(-), matching exactly
  the milestone's in-scope file set.
- Live GitHub scratch fixtures (`gh-3`, `gh-11`, `gh-12`, `gh-13`, `gh-14`) all confirmed
  unmodified/idempotent after the full probe run.

## Bug found and fixed (recorded for completeness, not a gap-list entry — no exp5 gap-list.md exists)

The first draft of `cli-edit-parity-conformance.test.mjs`'s `[github/parent-extended]` probe had a
latent bug: it blindly re-asserted `gh-14`'s live `parent` field without guarding for `null` (no
parent currently set), which surfaced only when the file was run inside the full concurrent test
suite (`gh-14`'s state had settled to `parent: null` from prior milestones' own idempotent cleanup).
Fixed by making the probe self-contained (set→re-assert→restore), confirmed clean on both a
standalone re-run and the full-suite re-run. This was a test-fixture-assumption bug in code
authored this iteration, not a regression in `quay.js`/`quay-github`'s actual implementation — no
product code changed as a result.

## Commit

All changes committed on branch `exp5-m16-iteration-0`, from inside the worktree, as commit
`5f1f1be` ("M16-cli-edit-parity-impl iteration-0: full task-edit flag parity"). **Not merged to
master** — the outer loop will merge both iteration-0 and iteration-1 after both complete.

**End-of-iteration worktree isolation re-confirmation:**

```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M16-cli-edit-parity-impl/worktrees/iteration-0
$ git rev-parse --abbrev-ref HEAD
exp5-m16-iteration-0
$ git status --short
(clean)
```
