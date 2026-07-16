# Generalizing quay's task store to a kind-scoped entity model (task | directive) — design discussion

- **Status:** design discussion, **not adopted**. No implementation, no
  protocol amendment, no directive has been created from this document.
  Recorded so a future decision (by the human, or a future iteration if the
  human explicitly promotes this to an instance objective) has a concrete
  design to start from instead of re-deriving it.
- **Date:** 2026-07-16
- **Context:** captured from a live conversation between the human (Yale) and
  a Claude Code session, prompted by an observation about
  `experiments/quay-core-bootstrap/`'s actual development pattern: work there
  (like `experiments/quay-native-bootstrap/` before it) is driven primarily by
  a self-evaluating iteration loop (iteration reports, directives,
  provenance/σ tracking), with quay's own task system used as a secondary
  bookkeeping/provenance artifact rather than the primary planning
  mechanism. This document discusses one specific architectural response:
  whether quay's task store could be generalized to also natively support
  **directives** (the experiment's external-steering-input mechanism) as a
  second, first-class entity kind alongside tasks.

## 1. Motivation

`experiments/quay-native-bootstrap/directives/` and
`experiments/quay-core-bootstrap/directives/` hold a steering-directive
mechanism (`pending/DIR-NNN-slug.md` → `archive/DIR-NNN-slug.md`, lifecycle
pending → applied/deferred/rejected) that has been in continuous use across
both experiments (29 directive files as of this writing: 27 in experiment 1's
archive + 2 pending, 2 pending in experiment 2). It is pure hand-maintained
markdown with no CLI/MCP/Web UI support — listing pending directives across
experiments requires manual `ls`, and there is no mechanical check that a
directive marked `applied`/`rejected` actually has a non-empty `Resolution`
section before archival.

quay's task store (`packages/quay-native/src/store.js`), by contrast, already
has CAS-write, frontmatter parsing, and a structural gate (`task_check`) that
enforces required sections and checkbox state before a status transition is
allowed. The question discussed: could quay's store be generalized so
directives get the same tooling (CLI/MCP list/get, a real gate check) for
free, or close to it?

The initial framing ("just add `kind: task | directive` and reuse
`status`/`task_check` as-is") turned out to be more optimistic than the code
supports. This document records the corrected analysis and a concrete
alternative design, on the premise (confirmed acceptable by the human) that
the **directive's own file format and schema may also change**, not only
quay's — the design does not need to force directives into the current task
schema unchanged.

## 2. Current-state facts (verified against code, not assumed)

From `packages/quay-native/src/store.js` and `mcp-server.js`:

1. **`status` is a closed, global enum**: `VALID_STATUSES = ["todo", "ready",
   "done", "needs-human"]` (store.js:13), enforced on every write
   (store.js:230-234). Directive vocabulary (`pending`, `applied`,
   `deferred`, `rejected`) does not overlap with this set at all — it is not
   a subset that could reuse the same enum unmodified.
2. **`task_check` hardcodes a fixed section list**: Proposal, Plan, AC, DoD,
   each requiring ≥40 non-whitespace characters (store.js:319-334), with
   AC-checkbox-based gating for `todo→ready` and `ready→done`
   (store.js:347-442). This structurally assumes a two-phase author→execute
   workflow that directives don't have (directives are single-shot: recorded,
   then triaged to one of three terminal-ish outcomes).
3. **No archive concept exists in the task store at all.** `done` tasks stay
   in place (store.js:444-471); there is no file-move operation anywhere in
   `store.js`/`bin/quay-native.js`/`mcp-server.js`. The directives'
   `pending/` → `archive/` physical `git mv` is a convention layered entirely
   outside quay's tooling.
4. **No `author_by`/`execute_by`/`gate_by` provenance-triple fields exist in
   the task schema.** These are prose-only conventions documented in
   `provenance.md` / `SKILL.md` files, referenced by task ID, not actual
   frontmatter fields — a previous version of this discussion mistakenly
   assumed they already existed on tasks; they do not.
5. **What genuinely generalizes for free:** the CAS-write mechanism
   (optimistic concurrency via `expectedStatus`, store.js:229-272) is
   kind-agnostic already — it just compares a caller-supplied expected value
   against the on-disk value, whatever the vocabulary. `extra:
   z.record(z.any())` (mcp-server.js:99) and `labels` (free-form string
   array) are already open extension points.
6. **Directive files are not in quay's frontmatter format at all.** The
   current format (`.claude/skills/quay-native-methodology/templates/
   directive-template.md`) is an H1 heading followed by a markdown bullet
   list (`- status: pending`, `- created_by: ...`), not YAML frontmatter
   (`---\n...\n---`). quay's store parser would not recognize it as-is.

## 3. Proposed design

Given the schema is allowed to change on both sides, the design generalizes
the store around a **kind** concept rather than bolting a directive-shaped
peg into a task-shaped hole:

### 3.1 `kind` as a first-class frontmatter field

```yaml
kind: task | directive
```

Not smuggled into `labels` — a real field, filterable (`--kind directive`),
renderable as a distinct Web UI section, and extensible to future kinds
(e.g. a possible future `audit` kind) without overloading `labels`, which
should stay free-form user-assigned tags.

### 3.2 Kind-scoped status vocabularies

```js
STATUS_BY_KIND = {
  task:      ["todo", "ready", "done", "needs-human"],
  directive: ["pending", "applied", "deferred", "rejected"],
}
```

`store.js`'s status validation (currently one global array, lines 230-234)
becomes a lookup keyed by `kind`. This is a small, local change — existing
task behavior is unaffected; directives get their own, already-established
vocabulary instead of being forced into the task one.

### 3.3 Kind-scoped section/gate schema

```js
SECTIONS_BY_KIND = {
  task:      ["Proposal", "Plan", "AC", "DoD"],
  directive: ["Finding", "Requested action"],
  // "Resolution" required only when transitioning out of "pending"
}
```

`task_check`'s current logic (verify required headings exist with a minimum
length, store.js:319-334) generalizes naturally by parameterizing the
heading list per kind — it is a section-presence/length checker already;
swapping which headings it looks for is not a rewrite. This also yields a
genuine new capability, not just parity: the gate can mechanically enforce
that a directive cannot be marked `applied`/`rejected` without a non-empty
`Resolution` section, which today is only an unenforced convention in the
README.

### 3.4 Kind-scoped storage root, namespaces kept separate

Directive IDs (`DIR-NNN`) and task IDs (`QN-*`/`QC-*`) are, and should
remain, separate ID spaces — and directives should stay physically under
`experiments/<name>/directives/{pending,archive}/`, not merged into a flat
`tasks/` directory. The store gains a per-kind root-directory configuration;
the same underlying code serves both trees. CLI/MCP exposure can be a thin
wrapper (`quay directive list`) or a generic filter
(`quay task list --kind directive --root <dir>`).

### 3.5 Optional: generalize archival as a real store operation

Currently no kind has archival support in the store. If pursued, a
terminal-status-triggers-archive-move operation could be added generically
(configurable per kind: which statuses are archival, which directory they
move to) — this would actually be the first time the `pending → archive`
move becomes mechanical rather than a manually-run `git mv`. This is a
reasonable generalization (not directive-specific hackery) since ordinary
tasks arguably have similar dormant-after-done value, but it is the most
invasive single part of this design and could be deferred to a later stage
or dropped entirely without undermining 3.1-3.4.

### 3.6 Format migration required

Existing directive files (29 total: 27 archived + 2 pending in experiment 1,
2 pending in experiment 2) are in the informal bullet-list header format,
not YAML frontmatter. Adopting this design requires a mechanical,
git-history-preserving migration of all 29 files to frontmatter, plus
updates to the three documents that describe the current format:
`experiments/quay-native-bootstrap/directives/README.md`,
`.claude/skills/quay-native-methodology/templates/directive-template.md`,
and `.claude/skills/quay-native-methodology/reference/directive-lifecycle.md`.

## 4. What this buys vs. what it costs

**Benefits, concretely:**
- One CLI/MCP call lists all pending directives across both experiments
  (today: manual `ls` per experiment).
- A mechanical gate preventing a directive from being archived as
  `applied`/`rejected` with an empty `Resolution` section (today: an
  unenforced convention).
- A reusable "kind-scoped lightweight entity" primitive in the store, which
  could serve a future third kind (e.g. an `audit` record) without
  redesigning again.
- Directly advances the running experiment's own `core_abi_symmetry`
  instance objective in spirit (CLI/MCP/Web-UI symmetry for another Core
  artifact type) — though see §5 on why this should not be folded into that
  objective's existing scope without an explicit decision.

**Costs, concretely:**
- Real engineering across `store.js`, `mcp-server.js`,
  `bin/quay-native.js`, and (if Web-UI parity is wanted) `packages/quay`'s
  server/templates — not a one-line change.
- Migration of 29 existing files' format, plus 3 documentation files.
- New tests for directive-kind behavior; existing task tests must keep
  passing unmodified.
- Being a Core change, it triggers the experiment's own G3 out-of-band-audit
  requirement.
- Realistically sized as **multiple QC-* tasks**, not one.

## 5. Recommendation on adoption path

This design is self-consistent and not merely a workaround forced by one
experiment's needs — the "kind-scoped lightweight entity with per-kind
status/section/storage rules" primitive is a genuine, reusable generalization
of what the store already does for tasks. That said:

- It does not move any of the four "Done when" clauses already locked into
  `docs/proposals/quay-core-bootstrap-experiment-v2.md` §4, and the
  experiment's binding-zero factor right now is `web_ui_verification`
  (0.0), not directive tooling.
- Per the experiment's own G5 (walking-skeleton, no scope creep mid-flight)
  discipline, this should **not** be silently absorbed into the existing
  instance objectives, and should **not** be handed to the running iteration
  as an implicit expectation.
- If it is to be pursued, there are two legitimate paths, and choosing
  between them is a human-level decision, not one the running iteration
  should make on its own:
  1. **Promote it to an explicit fifth instance objective** — requires
     amending `quay-core-bootstrap-experiment-v2.md` §4/§5 with its own
     "Done when" clause, at the same deliberateness level §4 itself required
     before the experiment started.
  2. **Park it as an optional, explicitly deferrable directive** the
     experiment may pick up opportunistically (e.g. once the current four
     factors are closer to converged), without it counting toward
     V_instance/V_meta unless/until promoted per path 1.

No directive has been created from this document yet, per the instruction
that prompted it — this is the design record only, for whichever path is
chosen later.
