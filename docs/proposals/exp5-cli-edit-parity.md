# exp5 CLI edit parity — Core CLI `task edit` full-field-parity design doc

**Status:** design only (no implementation). Produced by M14-cli-edit-parity iteration-1, an
independent re-derivation per the charter's own note that this milestone's design-doc completeness
(against DIR-011's 4 numbered items, plus the two concrete decision points — whole-body mode,
portable-metadata wording) is genuinely independently checkable.

**Sources:** DIR-011 (`experiments/quay-perpetual-stream/directives/archive/DIR-011-relax-core-cli-
task-edit-surface-and-formalize-portable-metadata-body-vs-extra.md`), drained at the m12→m13
boundary into `backlog.md`'s `M-CLI-EDIT-PARITY` row, deferred pending M13-task-backlog-projection's
body-vs-`extra{}` convention landing first (it has — see cross-reference in §3). Grounded in three
real, already-implemented precedents this doc cites rather than re-derives: the native provider
CLI's existing full-field `task edit` (`packages/quay-native/bin/quay-native.js`), the MCP
`task_write` schema (both `packages/quay-native/src/mcp-server.js` and `packages/quay-github/src/
mcp-server.js`), and M09-gh-write's PR-ABI-001 hard-error-floor fix (`packages/quay-github/src/
mcp-server.js`, `packages/quay-github/src/github-client.js`).

## Table of contents / DIR-011 item map

| Doc section | DIR-011 item(s) answered |
|---|---|
| §1 Core CLI `task edit` full-field parity | 1 |
| §2 Provider-capability handling | 2 |
| §3 Portable-metadata rule (formalized wording) | 3 |
| §4 Non-goals | 4 |
| §5 Verification plan (worked, ≥2 fields, both providers) | (item 2's verify-live-against-both requirement) |
| §6 Done-when clauses a future implementing milestone would need | (charter Done-when clause 5) |

Every DIR-011 numbered item (1-4) has exactly one primary home section below; none are answered
only implicitly.

---

## §1. Core CLI `task edit` full-field parity (DIR-011 item 1)

### Current state (cited, not re-derived)

The Core CLI's `task edit` (`packages/quay/bin/quay.js` lines 376-394) is hard-gated to
status-only:

```js
if (cmd === "task" && sub === "edit") {
  const id = positional[0];
  if (!flags.status) {
    console.error("quay task edit: --status <s> is required (v1 supports status-only writes)");
    process.exitCode = 1;
    return;
  }
  await withProvider(async (client) => {
    const t = await client.taskWrite({ id, status: flags.status });
    ...
  }, { providerId: flags.provider });
  return;
}
```

This is a **passthrough-layer restriction only** — `provider-client.js`'s `taskWrite(patch)`
(lines 34-38) already forwards an arbitrary patch object to `task_write` with zero backend branch
("Core just forwards whatever patch fields are given, same as taskList/taskGet forward whatever
filter/id is given" — its own comment). Both provider MCP servers already accept the fuller patch
shape: native's `task_write` schema (`packages/quay-native/src/mcp-server.js` lines 83-104) accepts
`title`/`status`/`labels`/`parent`/`children`/`body`/`extra`/`expectedStatus`; github's `task_write`
schema (`packages/quay-github/src/mcp-server.js` lines 127-137) accepts `status`/`title`/`body`/
`labels`/`parent`/`children` (not `extra` — see §2/§3). The native provider's own CLI
(`packages/quay-native/bin/quay-native.js` lines 115-155) already builds and forwards the full patch:

```js
const patch = {};
if (flags.title !== undefined) patch.title = flags.title;
if (flags.status !== undefined) patch.status = flags.status;
if (flags.labels !== undefined) patch.labels = String(flags.labels).split(",").filter(Boolean);
if (flags.parent !== undefined) patch.parent = flags.parent;
if (flags.body !== undefined) patch.body = flags.body;
if (flags.children !== undefined) patch.children = String(flags.children).split(",").filter(Boolean);
if (flags.extra !== undefined) patch.extra = JSON.parse(flags.extra);
if (flags["expect-status"] !== undefined) patch.expectedStatus = flags["expect-status"];
if (flags["append-notes"] !== undefined) { /* store.appendNote(...) */ }
```

So closing the gap is **not** a provider-ABI change — it is relaxing the Core CLI's own flag-gate
and building the same style of optional-field patch object quay-native's CLI already builds,
forwarded through the exact same `client.taskWrite(patch)` call already used for `--status`.

### Recommended design

Replace the `if (!flags.status) { ...error...; return; }` hard gate with an optional-field patch
builder mirroring quay-native's shape exactly (same flag names, for muscle-memory parity across the
two CLIs — DIR-011's own framing is "parity with the native provider CLI"):

```js
if (cmd === "task" && sub === "edit") {
  const id = positional[0];
  const patch = {};
  if (flags.title !== undefined) patch.title = flags.title;
  if (flags.status !== undefined) patch.status = flags.status;
  if (flags.labels !== undefined) patch.labels = String(flags.labels).split(",").filter(Boolean);
  if (flags.parent !== undefined) patch.parent = flags.parent;
  if (flags.children !== undefined) patch.children = String(flags.children).split(",").filter(Boolean);
  if (flags.extra !== undefined) patch.extra = JSON.parse(flags.extra);
  // body: see whole-body-replacement-mode recommendation below.
  if (flags.body !== undefined) patch.body = flags.body;
  else if (flags["body-file"] !== undefined) patch.body = readBodyFile(flags["body-file"]);
  else if (flags["body-stdin"] === true) patch.body = await readStdin();

  if (Object.keys(patch).length === 0) {
    console.error(
      "quay task edit: at least one of --title/--status/--labels/--extra/--parent/--children/" +
      "--body/--body-file/--body-stdin/--append-notes is required"
    );
    process.exitCode = 1;
    return;
  }
  await withProvider(async (client) => {
    const t = await client.taskWrite({ id, ...patch });
    if (wantsJson) printJson(t);
    else console.log(`${t.id}: ${t.title} [${t.status}]`);
  }, { providerId: flags.provider });
  return;
}
```

`--append-notes` is deliberately **not** folded into the same patch object — quay-native's own CLI
treats it as a separate, mutually-exclusive branch (`store.appendNote(id, ...)`, a different store
method than `store.write()`), and the Core CLI should mirror that same branch split rather than
inventing a combined call the provider layer doesn't actually support atomically.

**Error-message change**: the existing `"v1 supports status-only writes"` message is removed;
replaced by the "at least one field required" usage error above (mirrors `task_write`'s own
"at least one of status/title/body/labels/parent/children is required" validation message on the
github side, and its analogous native-side behavior — consistent phrasing across CLI and ABI
layers).

### Whole-body-replacement-mode recommendation (concrete, not a menu)

**Recommendation: add `--body-file <path>` as the primary first-class whole-body-replacement mode;
do NOT add a separate `--body-stdin` boolean flag as a second mode in the same milestone.**

Reasoning:
- `--body-file <path>` with the conventional `-` sentinel meaning "read stdin instead of a real
  path" is the single, well-established Unix CLI convention for "replace this field with file or
  piped content" (mirrors `git commit -F -`, `curl -d @-`, etc.) — one flag, two ways to invoke it,
  rather than two flags a user has to choose between. `readBodyFile(flags["body-file"])` above
  should special-case `flags["body-file"] === "-"` to read stdin, eliminating the need for a
  separate `--body-stdin` flag entirely. (The pseudocode above shows both for illustration of the
  underlying stdin-reading mechanism; the actual recommended CLI surface is the single `--body-file`
  flag with `-` meaning stdin, not two independent flags.)
- `--body <string>` (inline, already the design's baseline per item 1) remains adequate for short
  bodies and scripting one-liners; it is not being removed, only supplemented.
- A whole-body edit is exactly the "entire description as a unit" case DIR-011's Requested action
  names explicitly ("so a task's entire description can be edited as a unit, per the human's ask")
  — `--body-file`/`-` covers both "edit in `$EDITOR`, save to a temp file, pass the path" and
  "pipe from another command" workflows with one mechanism, which is why it is recommended as the
  sole first-class mode rather than an enumerated set of alternatives.
- This does not require any provider-ABI change: `task_write`'s `body` field is already a plain
  string; `--body-file`/stdin is pure Core-CLI-side content-sourcing, not a new wire shape.

---

## §2. Provider-capability handling, not assumption (DIR-011 item 2)

The Core CLI is provider-agnostic (per `withProvider()`'s `providerId` parameterization and
`provider-client.js`'s zero-backend-branch design, cited above) and **must not** special-case which
fields "should" work. §1's design already achieves this structurally: the patch object is built
from whatever flags were passed and forwarded verbatim to `client.taskWrite(patch)` — the Core CLI
never inspects or filters the patch by provider type. All capability-mismatch handling happens
**inside the provider's own `task_write` implementation**, which is exactly where M09-gh-write's
PR-ABI-001 fix already put it.

### Reusing the existing hard-error floor (not re-litigating it)

Per PR-ABI-001 (`packages/quay-github/src/mcp-server.js` lines 84-165), github's `task_write`:
1. Uses a raw (non-zod-typed, `.catchall(z.unknown())`) input schema specifically so unrecognized
   keys survive MCP-SDK input validation instead of being silently stripped (the original
   `task_write-unsupported-field-probe` bug this fix closed).
2. Explicitly scans `Object.keys(rawArgs)` against `TASK_WRITE_SUPPORTED_FIELDS` (`id`, `status`,
   `title`, `body`, `labels`, `parent`, `children` — `extra` is deliberately absent) and returns
   `isError: true` with an explicit message naming the unsupported field(s) if any are present.

**Design requirement for the Core CLI**: when `client.taskWrite(patch)` (provider-client.js line
34-38) receives an MCP tool error (`r.isError`), it already `throw new Error(r.content?.[0]?.text
?? "task_write failed")` — this propagates the provider's own explicit error message (e.g.
`"task_write: unsupported field(s) [extra] — this Provider does not implement writing extra.
Supported fields: id, status, title, body, labels, parent, children."`) up to the CLI's existing
`try`/`catch` in the `task edit` handler (mirroring the existing `ConflictError` catch block already
present at lines 145-152 for `--status`/CAS). The Core CLI's job is only to **not swallow or
re-word** that error — print the provider's message as-is to stderr and exit 1, exactly as the
existing `ConflictError` branch does for its own error class. No new Core-CLI-side capability
table, no "is this provider native?" branch — the hard-error floor is already correct and already
lives at the provider layer; the Core CLI's only correctness obligation is to be a transparent
passthrough for both the success and the error path, symmetric with how it already is for the
success path today.

### What this means concretely for each newly-relaxed flag

| Flag | native | github | Core CLI's role |
|---|---|---|---|
| `--title` | real write | real write (M09) | pure passthrough, both succeed |
| `--body` / `--body-file` | real write | real write (M09) | pure passthrough, both succeed |
| `--labels` | real write | real write (M09) | pure passthrough, both succeed |
| `--parent` / `--children` | real write | real write (M12-abi-parent-write) | pure passthrough, both succeed |
| `--extra` | real write (native-only field) | **hard error** (PR-ABI-001 floor, `extra` not in `TASK_WRITE_SUPPORTED_FIELDS`) | pure passthrough; github's explicit error propagates unmodified |

Note `--parent`/`--children` are now real writes on **both** providers as of M12-abi-parent-write
(the design doc must not describe them as github-unsupported — that was true only through M09, and
DIR-011's own Finding predates M12; this doc corrects for that landed change). The one flag that
genuinely diverges at the ABI layer today is `--extra`, which is exactly the case §2/§3 are built
around.

### Differential-conformance verification approach (pointer to §5's worked-through detail)

Per the charter's item 4 / DIR-011 item 2's "verify live against BOTH providers, in the
M03-abi-eval/M09 differential-conformance style" instruction: the existing
`packages/quay/test/provider-abi-conformance.test.mjs` file already runs exactly this style of
paired native/github probe (see its `task_write-unsupported-field-probe` and
`task_write-hard-error-floor-probe` cases, lines 224-252, cited verbatim in §5). A future
implementing milestone's verification plan is to **extend this same file** with Core-CLI-level
probes (spawning `quay task edit` as a child process against both providers, not just calling
`task_write` directly as the existing file does) — §5 works this through concretely for two fields.

---

## §3. Formalize the portable-metadata rule (DIR-011 item 3)

### Constraint this rule resolves (cited, not re-derived)

Native's `extra{}` (`packages/quay-native/src/mcp-server.js` line 99: `extra: z.record(z.any())
.optional()`) is an arbitrary JSON k/v map — a native-store-only feature. GitHub's `task_write`
explicitly excludes `extra` from `TASK_WRITE_SUPPORTED_FIELDS` and hard-errors on it (§2's table).
Any metadata that must survive a provider switch (or must be writable when GitHub is the active
provider at all) cannot rely on `extra{}` as its sole representation.

### Proposed rule text (insertable prose)

The following is the actual proposed wording, suitable for direct insertion into
`inherited-core.md` and/or a provider-ABI doc (e.g. as a new subsection titled "Portable metadata:
body vs. `extra{}`"):

> **Portable metadata convention.** Any task metadata that must be readable or writable
> regardless of which Provider is active MUST be represented as a **structured markdown section
> within the task's `body` field** (e.g. a `## <Label>` heading followed by a short value line or
> block), never as the sole copy in `extra{}`. `extra{}` is a **native-Provider-only convenience
> mirror**: it MAY additionally hold a machine-readable copy of the same fact for native-only
> tooling that wants to query it without markdown-parsing the body, but nothing in this
> experiment's (or a future consumer's) design may depend on `extra{}` being present, because the
> GitHub Provider cannot write it at all — `task_write` hard-errors (`isError: true`) on any
> `extra` field per the PR-ABI-001 fix, rather than silently dropping it. When in doubt about
> where a new field belongs: if the fact must be readable after a provider switch, or written at
> all while GitHub is active, it goes in the body first; `extra{}` is additive, never load-bearing.

This is a direct formalization of DIR-011's own Finding #2 ("`extra{}` is not provider-portable;
the task body is") into adoptable convention prose, not a new decision — the wording states the
constraint DIR-011 already discovered, in a form suitable for a skill or ABI-doc author to paste in
verbatim.

### Cross-reference: M13's own reliance on this exact rule

`docs/proposals/exp5-task-backlog-primitive-projection.md` §11 ("Portable metadata vs native-only
convenience", answering DIR-009 item 11) already assumes and applies precisely this rule, **before
it was formalized as citable prose** — this is the gap DIR-011 item 3 exists to close. M13 §11
states:

> "Every field this design introduces... is designed **body-first**: the authoritative, portable
> copy lives in a structured markdown section of the task body, writable on both providers.
> `extra{}` is used only as an *optional* native-only convenience mirror for machine-readable
> queries... never as the sole copy of anything this design needs to survive a provider switch."

M13 §9 (selection provenance) and §10 (execution provenance) both instantiate this pattern
concretely: `Not selected @M-NN: <reason>` as a body line with an optional `extra.notSelected`
mirror (§9), and `## Execution record` as a body section (§10) — the same shape M05's own `Status
mirror:` body line / `extra.dirStatus` pairing established even earlier. **This design doc's
contribution is not a new pattern** — it is lifting the pattern M05 originated and M13 already
reused into a single, explicitly labeled, insertable convention-doc paragraph (the blockquote
above) so that a *third* future consumer does not have to re-derive it by reading M05's and M13's
prose and inferring the rule themselves, which is exactly the drift-risk DIR-011's own Finding
flags ("land it where both the `/quay-directive` skill and any future milestone-tracking skill will
read it").

**Recommended landing spot**: `inherited-core.md`, as a new short subsection near wherever ABI/
provider-capability conventions are already documented (this milestone does not edit that file —
see §4/Done-when clause 6 — a future implementing milestone inserts the blockquote above verbatim
or near-verbatim).

---

## §4. Non-goals (DIR-011 item 4)

- **GitHub `extra` storage stays out of scope.** The hard-error floor (§2, §3) is the correct,
  final behavior for `extra` on GitHub — not a defect this or any future milestone should "fix" by
  finding some GitHub-side encoding trick (e.g. stuffing JSON into a hidden body section). §3's
  rule exists precisely so metadata that needs to survive on GitHub is expressed as a portable body
  section instead; inventing a GitHub-side `extra` emulation would undermine that convention by
  giving `extra{}` a second, inconsistent portable pathway.
- **MCP `task_write` and the native provider CLI (`quay-native task edit`) are not touched.** Both
  already implement the full field set (cited in §1) — this design is a **Core-CLI-passthrough +
  convention-documentation change only**. No schema change to either MCP server's `task_write`
  tool, no new provider-side capability.
- This milestone (M14) itself performs **no implementation** — no `packages/quay/bin/quay.js` edit,
  no `inherited-core.md` edit, no provider ABI file change (confirmed via `git diff --stat` in the
  iteration report). This doc specifies; a future SELECT dispatches, per DIR-011's own
  "design-only at this stage" routing instruction.

---

## §5. Verification plan — worked through for 2 relaxed fields against both providers

Following the `provider-abi-conformance.test.mjs` differential-conformance style already
established (M03-abi-eval, extended by M09-gh-write/M12-abi-parent-write — cited fully in §2), a
future implementing milestone adds Core-CLI-level probes to that same file (or a sibling
`quay-task-edit-cli.test.mjs`, spawning `node packages/quay/bin/quay.js task edit ...` as a child
process against both a native fixture and the live github fixture, the same dual-fixture setup the
existing file already uses).

### Worked example 1 — `--title` against both providers (relaxed, real-write field)

**Assertion shape** (mirrors the existing `task_write-unsupported-field-probe` case at lines
224-235, lifted one layer up to the CLI):

- **Native**: run `quay task edit <native-fixture-id> --title "CLI-parity probe title"`.
  Assert: (a) process exit code 0; (b) `quay task view <id> --json` afterward shows
  `title === "CLI-parity probe title"`; (c) immediately follow with a second `task edit --title
  <original-title>` call to restore state (idempotent-restore discipline, mirroring the existing
  file's gh-3 title-restore pattern at line 226).
- **GitHub**: run the identical CLI invocation against the github fixture (`gh-3`, the same fixture
  `provider-abi-conformance.test.mjs` already uses), asserting the same three things — GitHub's
  `task_write` already real-writes `title` since M09 (§2's table), so the expected outcome on both
  providers is **success**, and the test's pass condition is that both behave identically (same
  "MATCHES native's own explicit-field write support" framing the existing probe already uses).
- **What this specifically tests that the existing MCP-level probe doesn't**: that the Core CLI's
  new flag-parsing/patch-building code (§1) correctly threads `--title` through
  `client.taskWrite()` with no CLI-side field-dropping bug of its own (the CLI layer is new code
  this milestone's future implementer writes; the ABI layer underneath is already covered by the
  existing test file).

### Worked example 2 — `--extra` against native (success) + GitHub (hard-error path)

**Assertion shape** (mirrors the existing `task_write-hard-error-floor-probe` case at lines
237-252):

- **Native**: run `quay task edit <native-fixture-id> --extra '{"probeKey":"probeValue"}'`.
  Assert: (a) exit code 0; (b) `quay task view <id> --json` shows `extra.probeKey ===
  "probeValue"`; (c) follow with a restore call resetting `extra` to its pre-probe value (same
  idempotent-restore discipline).
- **GitHub**: run `quay task edit gh-3 --extra '{"probeKey":"probeValue"}'`. Assert: (a) **non-zero
  exit code** (the Core CLI's `try`/`catch` around `client.taskWrite()`, §2, must convert the
  provider's `isError: true` into a CLI-level failure, not a silent success); (b) stderr contains
  the provider's own hard-error message text (or a substring — e.g. `"unsupported field(s)
  [extra]"`) unmodified, per §2's "transparent passthrough for the error path" requirement — the
  test should assert this exact substring is present, not merely that *some* error occurred, since
  a generic uncaught-exception failure would also produce a non-zero exit and would incorrectly
  pass a weaker assertion; (c) `quay task view gh-3 --json` afterward shows the task **unchanged**
  (no partial write occurred — GitHub's `task_write` handler returns its error before calling
  `client.writeFields`/`writeRelations`, so this should hold structurally, but the test should
  verify it empirically rather than assume it).
- **What this specifically tests**: that the Core CLI does not accidentally swallow, re-word, or
  (worst case) silently succeed-with-partial-write on a hard-error from the provider — the single
  highest-risk regression this milestone's future implementation could introduce, since it is new
  CLI-side error-handling code, not a re-exercise of already-tested ABI-layer behavior.

### General pattern for any additional relaxed field a future implementer wants to cover

For each of `--labels`, `--parent`, `--children`, `--body`/`--body-file`: the same "native succeeds,
github succeeds (both real-write since M09/M12), Core CLI is a transparent passthrough" shape as
worked example 1 applies — no new pattern needed, `--title`'s worked-through case generalizes
directly. Only `--extra` needs the divergent hard-error-path shape (worked example 2), because it
is the one field where the two providers' `task_write` behavior genuinely differs (§2's table).

---

## §6. Done-when clauses a future implementing milestone would need

- [ ] `packages/quay/bin/quay.js`'s `task edit` handler relaxed per §1's design (optional-field
      patch builder, `--append-notes` kept as a separate branch) — no `--status`-required hard
      gate remains; a `task edit <id>` call with zero recognized flags produces the "at least one
      field required" usage error, pasted transcript.
- [ ] `--body-file <path>` implemented with `-` meaning stdin (§1's whole-body-replacement-mode
      recommendation) — pasted transcript of both a real-file and a piped-stdin invocation
      succeeding.
- [ ] `printHelp()`'s `task edit` usage line and Options section updated to list the full relaxed
      flag set (currently shows only `--status <status>`, `packages/quay/bin/quay.js` line 148) —
      pasted before/after diff.
- [ ] Worked examples 1 and 2 (§5) implemented as real automated tests (extending
      `provider-abi-conformance.test.mjs` or a sibling CLI-level test file) and passing against
      both a native fixture and the live github fixture — pasted raw test-run output.
- [ ] At least one additional relaxed field beyond `--title`/`--extra` (e.g. `--labels` or
      `--parent`/`--children`) covered by an analogous CLI-level differential-conformance test,
      per §5's "general pattern" — pasted raw test-run output.
- [ ] `inherited-core.md` (or the chosen provider-ABI doc) updated with §3's proposed portable-
      metadata-rule blockquote, inserted verbatim or near-verbatim — pasted diff.
- [ ] Full existing test suite (including the now-extended `provider-abi-conformance.test.mjs`)
      still passes post-change — pasted raw output, same closing-gate discipline M05's/M13's own
      Done-when clauses used.
- [ ] `git diff --stat` against that future milestone's own pre-charter base commit shows only
      `packages/quay/bin/quay.js`, the test file(s), and `inherited-core.md` touched — no
      unrelated product code, no provider-ABI (`packages/quay-native`/`packages/quay-github`)
      change, consistent with §4's non-goals (provider layer is already sufficient, untouched).
- [ ] `backlog.md`'s `M-CLI-EDIT-PARITY` row (or its successor, once implemented) updated at
      ABSORB pointing at the shipped change, marked DONE with realized Δv recorded (this design
      doc's own charter has Δv̂=0 by design; the future implementing milestone is where
      capability-growth value is actually realized, per this doc's parent charter's Value
      hypothesis section).
