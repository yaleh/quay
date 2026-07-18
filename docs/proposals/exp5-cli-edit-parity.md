# exp5 CLI edit parity — Core CLI `task edit` full-field-parity design doc

**Status:** design only (no implementation). Produced by M14-cli-edit-parity iteration-0, per the
human's own routing decision quoted in DIR-011 ("Design-only at this stage, same routing as
DIR-009").

**Source:** DIR-011 (`experiments/quay-perpetual-stream/directives/archive/DIR-011-relax-core-cli-
task-edit-surface-and-formalize-portable-metadata-body-vs-extra.md`), drained at the m12→m13
boundary into `backlog.md`'s `M-CLI-EDIT-PARITY` row, selected at the m13→m14 boundary once
M13-task-backlog-projection's body-vs-`extra{}` convention landed
(`docs/proposals/exp5-task-backlog-primitive-projection.md`, §11) satisfying M-CLI-EDIT-PARITY's
stated dependency.

## Table of contents / DIR-011 item map

| Doc section | DIR-011 item(s) answered |
|---|---|
| §1 Core CLI `task edit` full-field parity | 1 |
| §2 Provider-capability handling | 2 |
| §3 Portable-metadata rule (proposed wording) | 3 |
| §4 Non-goals | 4 |
| §5 Verification plan (worked, ≥2 fields, both providers) | (item 2's verification requirement) |
| §6 Done-when clauses for a future implementing milestone | (charter in-scope item 4 / Done-when 5) |

Every DIR-011 numbered item (1-4) has exactly one home section below; none is answered only
implicitly.

---

## §1. Core CLI `task edit` full-field parity (DIR-011 item 1)

### 1.1 Current state (cite, don't re-derive)

The Core CLI (`packages/quay/bin/quay.js`, `task edit` handler, lines 376-394) is gated to
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
```

`client.taskWrite(patch)` (`packages/quay/src/provider-client.js`, lines 34-38) is already a
**generic, provider-agnostic passthrough** — it forwards whatever patch object it is given to the
active Provider's `task_write` MCP tool and throws on `isError:true`. It does not need to change at
all for this design; the restriction is entirely in the Core CLI's own flag-parsing/validation
above `taskWrite`, not in the transport.

The native provider CLI (`packages/quay-native/bin/quay-native.js`, `task edit` handler, lines
115-155) already builds a full patch object from `--title`/`--status`/`--labels`/`--parent`/
`--body`/`--children`/`--extra` (JSON) and a distinct `--append-notes` path (`store.appendNote`,
not part of `patch`, handled as an early return). The MCP `task_write` tool schema itself
(`packages/quay-native/src/mcp-server.js`, lines 79-104) accepts
`{id, title?, status?, labels?, parent?, children?, body?, extra?, expectedStatus?}`.

### 1.2 Design: relax the Core CLI flag surface

Add flag parsing for `--title`, `--body`, `--labels`, `--extra`, `--parent`, `--children`,
`--append-notes` to the Core CLI's `task edit` handler, mirroring the native CLI's own flag→patch
construction **exactly** (same flag names, same `--labels`/`--children` comma-split, same
`JSON.parse` for `--extra`), so a user who has learned the native CLI's flags needs to learn
nothing new for the Core CLI:

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
  if (flags.body !== undefined) patch.body = await resolveBody(flags); // see §1.3
  if (Object.keys(patch).length === 0 && flags["append-notes"] === undefined) {
    console.error("quay task edit: at least one of --title/--status/--body/--labels/--extra/" +
      "--parent/--children/--append-notes is required");
    process.exitCode = 1;
    return;
  }
  await withProvider(async (client) => {
    if (flags["append-notes"] !== undefined) {
      // no native appendNote passthrough on the ABI yet (see §4 non-goals) —
      // out of scope this milestone; ships as a `patch.body`-based append
      // helper in the Core CLI itself if picked up (§6 Done-when).
    }
    const t = await client.taskWrite({ id, ...patch });
    if (wantsJson) printJson(t);
    else console.log(`${t.id}: ${t.title} [${t.status}]`);
  }, { providerId: flags.provider });
  return;
}
```

The `--status <s> is required` guard is REMOVED (replaced by an "at least one field" guard, since
status is no longer the only writable field). This is the single behavior-visible break from v1 —
existing `quay task edit <id> --status <s>` invocations continue to work unchanged (status remains
a valid, still-optional field in the patch), so this is additive, not breaking, for all existing
callers.

**`--expect-status` (CAS)** is already wired symmetrically on the native CLI (QN-015) and already
passes through generically today via `client.taskWrite`'s passthrough shape — it should be added to
the Core CLI's flag list at the same time for full symmetry, though it is not itself a DIR-011-named
field and is called out here only so a future implementer does not have to re-discover it
separately.

### 1.3 Whole-body-replacement mode — concrete recommendation

DIR-011 item 1 explicitly asks for a decision, not a menu: **recommend `--body-file <path>` as the
first-class whole-body-replacement mode, with `-` accepted as a `<path>` value meaning "read from
stdin."** Do **not** add a second, separate `--body-stdin` boolean flag — one flag, one
convention (`-` for stdin) keeps the flag surface minimal and matches a common Unix CLI convention
(e.g. `tar -f -`, `git apply -`) rather than inventing a bespoke boolean.

Reasoning against the alternatives DIR-011's own item 1 names:
- **Plain `--body <string>`** (already in the flag list above) remains available for short bodies
  passed directly as a shell argument — useful for scripting/automation with short strings, but
  shell-quoting a large multi-paragraph markdown body as a single CLI argument is exactly the
  friction DIR-011 item 1 is asking to solve ("a task's entire description can be edited as a
  unit").
- **`--body-file <path>`** reads the file's full contents as the new body verbatim (whole-body
  REPLACEMENT semantics — not a merge/patch of sections; a task author who wants to edit one
  section of an existing body edits it in their own file, still whole-body-replacing on write).
  This is the natural mode for an agent or a human editing a task body in an actual editor before
  committing the write, and is the mode DIR-009/M13's own workflow (rich structured body sections,
  §9-§11 of that design) will actually exercise most: an agent composes a body in memory/a temp
  file, then applies it in one write.
- **`--body-file -` (stdin)** covers the pipeline case (`some-generator | quay task edit T1
  --body-file -`) without inventing a second flag, and is the natural complement once `--body-file`
  exists — stdin is just "the path is unavailable, use fd 0."
- **Rejected: a separate `--body-stdin` boolean.** Redundant with `--body-file -`; would require
  documenting and testing two flags that do the same job through two different spellings, with no
  offsetting benefit.
- **Rejected: an interactive `$EDITOR` launch mode** (like `git commit` with no `-m`). Plausible
  future ergonomic addition, but out of scope for a design doc whose Done-when requires a *concrete*
  recommendation implementable in one pass — an editor-launch mode adds a process-spawn/tty
  dependency this CLI does not currently have anywhere, a bigger design surface than DIR-011 item 1
  asks for.

Implementation sketch for `resolveBody(flags)` (referenced in §1.2's patch-construction code):

```js
async function resolveBody(flags) {
  if (flags["body-file"] !== undefined) {
    if (flags["body-file"] === "-") {
      return await readAll(process.stdin); // whole-body replacement from stdin
    }
    return await fs.readFile(flags["body-file"], "utf8"); // whole-body replacement from file
  }
  return flags.body; // short-string mode, already validated present by the caller
}
```

`--body` and `--body-file` are mutually exclusive; the Core CLI should reject supplying both with a
clear "quay task edit: --body and --body-file are mutually exclusive" error rather than silently
preferring one (the same "surface, don't silently pick" discipline §2 applies to provider-capability
mismatches).

---

## §2. Provider-capability handling (DIR-011 item 2)

### 2.1 The Core CLI must not assume native

The Core CLI is provider-agnostic by construction (`withProvider(...)`, `provider-client.js`'s
generic `taskWrite` passthrough) — §1's design adds no provider-specific branch to the Core CLI
itself. Whether a given field is writable is entirely a fact about the ACTIVE PROVIDER, discovered
at write time by the provider's own `task_write` MCP tool, not something the Core CLI pre-filters
or special-cases per provider.

### 2.2 The existing hard-error floor (M09 PR-ABI-001) already does exactly what item 2 asks for

`client.taskWrite` (`provider-client.js` line 36) already does:

```js
async function taskWrite(patch) {
  const r = await client.callTool({ name: "task_write", arguments: patch });
  if (r.isError) throw new Error(r.content?.[0]?.text ?? "task_write failed");
  return r.structuredContent?.task ?? null;
}
```

— any `isError:true` MCP tool response becomes a thrown `Error` with the Provider's own explicit
message. The GitHub provider's `task_write` handler (`packages/quay-github/src/mcp-server.js`,
lines 104-165) implements exactly the hard-error floor DIR-011 item 2 asks to reuse:

```js
const TASK_WRITE_SUPPORTED_FIELDS = new Set(["id", "status", "title", "body", "labels", "parent", "children"]);
...
const unsupported = Object.keys(rawArgs).filter((k) => !TASK_WRITE_SUPPORTED_FIELDS.has(k));
if (unsupported.length > 0) {
  return {
    isError: true,
    content: [{ type: "text", text:
      `task_write: unsupported field(s) [${unsupported.join(", ")}] — this Provider does not ` +
      `implement writing ${unsupported.join("/")}. Supported fields: ${[...TASK_WRITE_SUPPORTED_FIELDS].join(", ")}.` }],
  };
}
```

**Design decision: change NOTHING about this mechanism.** §1's Core CLI relaxation needs zero new
error-handling code beyond what `withProvider`'s existing top-level error reporting already does
(uncaught errors from the async callback surface as a CLI error message + non-zero exit code — the
same path `client.taskWrite`'s `throw new Error(...)` already flows through today for the
status-only case). Concretely: `quay task edit gh-3 --extra '{"foo":"bar"}'` against the GitHub
provider will throw `Error: task_write: unsupported field(s) [extra] — this Provider does not
implement writing extra. Supported fields: id, status, title, body, labels, parent, children.`,
which the Core CLI's existing top-level catch prints to stderr and sets `process.exitCode = 1` —
this is the SAME "surface the provider's existing hard error, don't silently drop" behavior item 2
asks for, inherited for free by not special-casing anything.

### 2.3 Post-M12 state: `parent`/`children` are no longer GitHub-unsupported

Important correction to DIR-011's own framing (item 2 names `extra`/`parent`/`children` together
as the unsupported-on-GitHub set): that was accurate when DIR-011 was filed (m12→m13 boundary), but
M12-abi-parent-write (m12, already merged) moved `parent`/`children` from the rejected set INTO
`TASK_WRITE_SUPPORTED_FIELDS` (see the code excerpt above — both are now present in the set,
implementing real bidirectional reassign-parent semantics via body-checkbox mutation,
`github-client.js`'s `writeRelations()`/`setChildCheckboxes()`). As of this design doc, **only
`extra` remains hard-error-rejected on GitHub** among the fields DIR-011 originally listed (plus any
other field never in the schema, e.g. `assignee`, per the conformance test's own probe). §1's design
correctly makes no assumption either way — it passes `parent`/`children` through generically and
lets the active provider's own manifest/hard-error floor be the actual source of truth, so this
correction does not require any code-shape change to §1, only an accurate expectation in this doc
and in §5's verification plan below.

---

## §3. Portable-metadata rule — proposed wording (DIR-011 item 3)

### 3.1 Cross-reference to M13's existing reliance on this rule

`docs/proposals/exp5-task-backlog-primitive-projection.md` §11 ("Portable metadata vs native-only
convenience") already assumes and depends on this exact rule for DIR-009 item 11 — it states the
constraint informally ("Every field this design introduces... is designed **body-first**... `extra{}`
is used only as an *optional* native-only convenience mirror") and explicitly notes: *"The Core CLI
edit-surface work actually needed to write these body sections and labels through the CLI (not just
MCP `task_write`) is correctly split out to DIR-011/`M-CLI-EDIT-PARITY`... this doc does not re-scope
that work in."* This design doc is that split-out work's design half; §3.2 below is the first place
the rule is stated as adoptable prose rather than assumed informally.

### 3.2 Proposed wording (insertable, verbatim)

The following is proposed for insertion into `inherited-core.md` (as a new named section, e.g.
"Portable-metadata convention") and/or a provider-ABI doc (e.g. a new section in
`packages/quay-github/DESIGN.md` / `packages/quay/DESIGN.md`):

> ### Portable-metadata convention (body-first, `extra{}` native-only)
>
> A quay task's `body` (markdown) and `labels` are **portable**: every Provider ABI implementation
> (native, GitHub, and any future Provider) is expected to support reading and writing them, because
> both are backed by fields every realistic backing store has (a free-text description field, a
> tag/label mechanism). A task's `extra{}` map is **native-only convenience**: it is an arbitrary
> key/value store specific to the native Provider's own file-backed task store, and MUST NOT be
> relied upon as the sole copy of any fact that needs to survive a Provider switch.
>
> **Rule for anyone writing metadata onto a task that must be provider-portable:** the authoritative,
> portable copy of that metadata MUST live in a structured markdown section of the task `body`
> (e.g. a `## <Section Name>` heading with the fact stated in prose or a `Key: value` line
> immediately beneath it — the exact same shape M05's `Status mirror:` body line already
> established). `extra{}` MAY additionally carry the same fact as a machine-readable, native-only
> mirror (e.g. `extra.someKey`) purely as a query-performance convenience on native — but if a
> Provider hard-errors on writing `extra` (as GitHub does per PR-ABI-001's floor), the body copy
> alone must remain sufficient; nothing may be designed to depend on the `extra{}` mirror being
> present.
>
> **Corollary:** any milestone/design that finds itself needing `extra{}` as the ONLY place a fact
> is recorded has mis-designed a provider-portability requirement — either the fact does not
> actually need to be portable (state that explicitly and accept native-only status), or it needs a
> body-section home in addition to (not instead of) the `extra{}` mirror.

### 3.3 Why this wording, not a different formulation

- States the rule as a **MUST/MAY** normative pair (portable body-first is a MUST when portability
  is required; `extra{}` mirroring is a MAY, never a substitute) rather than descriptive prose, so
  it is directly citable the way M05's `Status mirror:`/`extra.dirStatus` pairing already is.
  cited/enforced elsewhere.
- Names the exact mechanism ("a `## <Section Name>` heading... `Key: value` line") rather than
  leaving the body's internal shape unspecified, because M13 §9/§10/§6 already use this exact shape
  (`## Backfill provenance`, `## Execution record`, `## Status mirror`) and a vaguer rule would
  invite drift across future body-writing designs.
- Includes the corollary explicitly because it is the actual failure mode DIR-011 item 3 exists to
  prevent (a design silently depending on `extra{}` as the sole copy, only discovered broken against
  GitHub later) — stating it as a checkable self-test ("does this design depend on `extra{}` alone?")
  gives a future author something to run against their own design, not just a rule to remember.

---

## §4. Non-goals (DIR-011 item 4)

- **GitHub `extra{}` write support is explicitly OUT OF SCOPE, not a defect.** The hard-error floor
  (§2.2) is the *correct* behavior for a field GitHub's issue model has no slot for — this design
  does not propose adding an `extra`-to-GitHub-issue mapping (e.g. via a hidden HTML comment or a
  side-channel gist), which would be a much larger, riskier ABI change than DIR-011 asked to scope,
  and would violate §3's own "body is the portable channel" rule by creating a second, GitHub-only
  portability mechanism outside the body.
- **MCP `task_write` and the native provider CLI are NOT touched.** Both already implement the full
  field set (§1.1) — this design's only product-code-shaped change is the Core CLI's flag-parsing/
  validation layer (§1.2/§1.3), a thin passthrough addition, never the transport or either
  provider's write logic.
- **No new Provider ABI capability is introduced.** `parent`/`children`/`extra` support is exactly
  what each Provider's existing manifest already declares (post-M12 for GitHub's `parent`/
  `children`; native has always supported all fields) — this design surfaces the CLI to that
  existing capability set, it does not grow the capability set itself.
- **`--append-notes`'s CLI-level exposure is scoped narrowly.** The native store's `appendNote`
  mechanism (`store.appendNote`) is a native-provider-internal convenience with no dedicated
  `task_write`-schema equivalent on the ABI today (native CLI's own `--append-notes` handling is a
  special early-return outside the generic `patch` object, per §1.1's citation). This design
  recommends the Core CLI's `--append-notes` be implemented as a `--body-file`-style READ-then-
  WRITE convenience in the Core CLI itself (read current body via `taskGet`, append the note text,
  `taskWrite` the whole new body) rather than requiring a new ABI tool — this keeps the ABI surface
  unchanged (consistent with the "MCP/native CLI not touched" non-goal above) while still giving
  Core CLI users the same ergonomic shortcut. This is flagged as an explicit open design point for
  the future implementing milestone (§6), not fully specified here, because it is genuinely
  secondary to DIR-011's core ask (full-field parity + portable-metadata rule) and small enough that
  over-specifying it now risks the same "re-derive vs. cite" mismatch this doc's own charter warns
  against for the other three items.

---

## §5. Verification plan — worked example, ≥2 fields, both providers (DIR-011 item 2's verification
## requirement, charter in-scope item 4)

Modeled directly on `packages/quay/test/provider-abi-conformance.test.mjs`'s existing differential-
conformance style (per-provider `record(providerName, shape, probeName, ok, message)` calls,
idempotent probes against real fixtures where possible — `gh-3`/`gh-7` on GitHub, native store
fixtures on native). A future implementing milestone would ADD new probes to this same file (or a
new sibling `cli-edit-parity-conformance.test.mjs`, if the CLI-level surface — not just the MCP
tool — needs its own harness invoking `packages/quay/bin/quay.js` as a subprocess) asserting the
following, worked through for two representative newly-relaxed fields:

### 5.1 `--title` — supported on both providers (relaxed field #1)

**Native:**
```js
const before = await nativeClient.callTool({ name: "task_get", arguments: { id: "QX-001" } });
const t0 = before.structuredContent.task;
// Core CLI subprocess invocation (or direct client.taskWrite call, same effective assertion):
const r = await coreCliTaskWrite({ id: "QX-001", title: t0.title }); // idempotent re-assert
assert(r.exitCode === 0);
assert(r.stdoutJson.title === t0.title);
```
Assertion: `quay task edit QX-001 --title "<same title>"` exits 0 and the returned task's `title`
field equals the value written — i.e. the Core CLI's new `--title` flag actually reaches the
native store's `title` field through the full `Core CLI → provider-client.js → MCP task_write →
store.write()` path, not just that the flag is parsed.

**GitHub:**
```js
const before = await githubClient.callTool({ name: "task_get", arguments: { id: "gh-3" } });
const t0 = before.structuredContent.task;
const r = await coreCliTaskWrite({ id: "gh-3", title: t0.title, provider: "github" }); // idempotent
assert(r.exitCode === 0);
assert(r.stdoutJson.title === t0.title);
```
Assertion: identical shape to native — `--title` reaches GitHub's real issue title via
`github-client.js#writeFields`'s already-shipped (M09) title write. Mirrors the existing
`task_write-unsupported-field-probe` in `provider-abi-conformance.test.mjs` (lines 224-235), which
already performs exactly this idempotent title-reassert probe at the MCP-tool layer — the new
probe's only addition is invoking it through the CLI subprocess instead of `callTool` directly, to
prove the CLI's new flag-parsing layer itself (not just the ABI beneath it) works.

### 5.2 `--extra` — supported on native, hard-error on GitHub (relaxed field #2)

**Native (supported):**
```js
const r = await coreCliTaskWrite({ id: "QX-001", extra: JSON.stringify({ probeKey: "probeValue" }) });
assert(r.exitCode === 0);
const after = await nativeClient.callTool({ name: "task_get", arguments: { id: "QX-001" } });
assert(after.structuredContent.task.extra.probeKey === "probeValue");
```
Assertion: `--extra '{"probeKey":"probeValue"}'` reaches `store.write()`'s `extra` merge and is
readable back via `task_get` — full round-trip through the Core CLI, not just the native CLI (which
already covers this — QN-024's own reasoning explicitly leans on this being unchanged).

**GitHub (hard-error floor, per §2.2/§2.3):**
```js
const r = await coreCliTaskWrite({ id: "gh-3", extra: JSON.stringify({ probeKey: "probeValue" }), provider: "github" });
assert(r.exitCode === 1); // non-zero exit — Core CLI's top-level catch on the thrown Error
assert(/unsupported field.*extra/.test(r.stderr));
assert(/Supported fields: id, status, title, body, labels, parent, children/.test(r.stderr));
```
Assertion: `quay task edit gh-3 --extra '{"probeKey":"probeValue"}' --provider github` exits
non-zero, its stderr contains the GitHub provider's own literal hard-error message text
(`task_write: unsupported field(s) [extra] — this Provider does not implement writing extra.`),
and — critically — that gh-3's actual title/body/labels are UNCHANGED after the call (read gh-3
again, assert equality with the pre-call snapshot), proving no partial silent write occurred before
the hard-error fired. This is the direct CLI-level equivalent of
`provider-abi-conformance.test.mjs`'s existing `task_write-hard-error-floor-probe` (lines 243-252),
which already proves the ABI-layer floor with `assignee`; this new probe proves the SAME floor is
visible through the newly-relaxed Core CLI, using `extra` specifically (the still-current
GitHub-unsupported field DIR-011 named, per §2.3's correction).

### 5.3 Why these two fields

`--title` (relaxed-but-supported-everywhere) and `--extra` (relaxed-but-hard-errors-on-GitHub) are
the minimum pair that together exercises BOTH branches DIR-011 item 2 asks to verify: "does a
newly-relaxed field actually write through on a provider that supports it" and "does a newly-relaxed
field surface the existing hard-error floor, not silently drop, on a provider that doesn't." A
future implementing milestone's Done-when (§6) extends the same two-branch pattern to `--body`/
`--body-file`, `--labels`, and `--parent`/`--children` (all-provider-supported post-M12, per §2.3)
for full coverage, but `--title`+`--extra` alone already prove the CLI relaxation's core claim on
both axes.

---

## §6. Done-when clauses a future implementing milestone would need

- [ ] `packages/quay/bin/quay.js`'s `task edit` handler relaxed per §1.2 (accepts `--title`/
      `--body`/`--body-file`/`--labels`/`--extra`/`--parent`/`--children`/`--expect-status`,
      `--status` no longer solely required) — pasted diff.
- [ ] `--body-file <path>` (including `-` for stdin) implemented per §1.3's `resolveBody` sketch,
      with `--body`+`--body-file` mutual-exclusion validated and erroring clearly — pasted example
      invocation + output for both the file-path and stdin (`-`) forms.
- [ ] `--append-notes` implemented as the read-then-write convenience described in §4 (no new ABI
      tool added) — pasted before/after `task_get` body showing the note appended.
- [ ] The proposed portable-metadata-rule wording (§3.2) inserted verbatim into `inherited-core.md`
      (new named section) — pasted diff.
- [ ] `--title` two-provider conformance probe (§5.1) added to
      `provider-abi-conformance.test.mjs` (or a new CLI-level sibling harness) and passing on both
      native and GitHub — pasted PASS output.
- [ ] `--extra` two-provider conformance probe (§5.2) added and passing: native round-trip succeeds,
      GitHub hard-errors with the exact PR-ABI-001 floor message AND leaves gh-3 unmodified — pasted
      PASS output for both branches.
- [ ] `--labels`/`--parent`/`--children` conformance probes extended per §5.3's "full coverage"
      note (all three are all-provider-supported post-M12 per §2.3) — pasted PASS output.
- [ ] `packages/quay/README.md` / `packages/quay/DESIGN.md`'s existing `task edit` usage text
      (currently documents only `--status`, per the citation in §1.1's grep) updated to the full
      flag set — pasted diff.
- [ ] Full existing test suite still passes post-change (pasted raw output) — same closing gate
      M05/M13's own Done-when clauses used.
- [ ] `git diff --stat` against this milestone's own pre-charter base commit shows only the expected
      files touched (`packages/quay/bin/quay.js`, `inherited-core.md`, README/DESIGN docs, new/
      extended conformance test file — no unrelated product code) — same evidence-gate discipline
      this doc's own charter Done-when clause 6 demonstrates below in the iteration report.

## Outer-loop reconciliation note (ABSORB, m14, 2026-07-18)

Both iteration-0 (`6ce284e`) and iteration-1 (`9ddc75b`) independently derived this design from the
charter and the same primary sources (native CLI, MCP schemas, DIR-011, M13's doc), without reading
each other's work. Unlike m13's merge (a genuine substantive disagreement on the DIR-010 namespace
decision), this was **not** a real conflict — both iterations converged on the identical concrete
recommendation for every decision point the charter required: `--body-file <path>` (with `-` for
stdin) as the whole-body-replacement mode, reuse of the existing PR-ABI-001 hard-error floor
unchanged (no new provider-branching logic), and the same two fields (`--title`, `--extra`) chosen
for the worked two-provider verification example. The merge conflict was purely a file-level add/add
collision (both wrote a full document to the same path), not a decision-level one.

This version (iteration-0's) was kept as canonical because it additionally documents a real,
citable correction that iteration-1's version does not make explicit: DIR-011's own Finding (filed
at the m12→m13 boundary) names `extra`/`parent`/`children` together as GitHub-unsupported, but
M12-abi-parent-write (already merged before this milestone was chartered) moved `parent`/`children`
into GitHub's `TASK_WRITE_SUPPORTED_FIELDS` — see this doc's §2.3. Iteration-1's doc reaches the same
underlying facts (its own §1 cites the GitHub `task_write` schema as accepting `parent`/`children`)
but does not flag the discrepancy against DIR-011's original framing the way §2.3 does, which matters
for a future implementer reading DIR-011 at face value. iteration-1's full report (including its own
independently-written doc) is retained at `milestones/M14-cli-edit-parity/iterations/iteration-1.md`
and the `exp5-m14-iteration-1` branch tip, for provenance — consistent with this stream's standing
practice of never silently discarding a reconciled-away iteration's work.
