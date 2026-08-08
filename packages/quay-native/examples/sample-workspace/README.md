# Sample workspace (quay-native)

A minimal, documented example task store — 5 illustrative tasks
demonstrating the `quay` task view-model shape (DIR-035-C):

> **Prefer `quay init`** to scaffold a fresh workspace instead of copying
> this directory. `quay init` generates a complete `.quay/config.yml` with
> all three sections (providers, gates, loop) and inline documentation.
> See the root `README.md` "Creating a workspace" section.

| Task | Role (derived) | Status | Notes |
|---|---|---|---|
| `SAMPLE-1` | compound (has children) | ready | Epic grouping SAMPLE-1A/1B; `task check` reports `ok:false` until SAMPLE-1B is done |
| `SAMPLE-1A` | primitive | done | Child of SAMPLE-1, has `extra.acceptance` |
| `SAMPLE-1B` | primitive | todo | Child of SAMPLE-1 |
| `SAMPLE-2` | primitive | ready | Standalone, no parent/children |
| `SAMPLE-3` | primitive | todo | Standalone, multiple labels, discovery-shaped AC |

Every task's body carries the same `## Proposal` / `## Plan` /
`## Acceptance Criteria` / `## Definition of Done` sections real tasks in
this repo's own backlog use (see `tasks/DIR-035-C.md` at the repo root for
a real example of the same shape). `role` (`primitive`/`compound`) is never
a stored field — it's derived from whether a task's `children` array is
non-empty (`packages/quay-native/src/store.js`).

## Try it

Point `quay-native` (or `quay` Core) at ONLY this directory via
`QUAY_NATIVE_TASKS_DIR`, with no other workspace config in scope:

```sh
cd packages/quay-native/examples/sample-workspace
QUAY_NATIVE_TASKS_DIR="$(pwd)/tasks" node --experimental-strip-types ../../bin/quay-native.ts task list
QUAY_NATIVE_TASKS_DIR="$(pwd)/tasks" node --experimental-strip-types ../../bin/quay-native.ts task get SAMPLE-1
QUAY_NATIVE_TASKS_DIR="$(pwd)/tasks" node --experimental-strip-types ../../bin/quay-native.ts task check SAMPLE-1
```

Or via Core, using this directory's own `.quay/config.yml`:

```sh
cd packages/quay-native/examples/sample-workspace
node --experimental-strip-types ../../../quay/bin/quay.ts task list
node --experimental-strip-types ../../../quay/bin/quay.ts task view SAMPLE-1A
node --experimental-strip-types ../../../quay/bin/quay.ts gate SAMPLE-1A
```

This is a **separate, minimal store** from the repo root's own `tasks/`
(this repo's live ~267-file dogfooding backlog for the `quay-perpetual-stream`
experiment) — see the root `README.md`'s "Sample workspace vs. this repo's
own backlog" section for why the two are kept apart.
