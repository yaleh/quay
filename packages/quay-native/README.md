# quay-native

`quay-native` is the **Native Provider** for [quay (Core)](../quay) — the
reference implementation of the Provider ABI. Where Core is deliberately
provider-agnostic, `quay-native` is the concrete store Core was written
against first: a **markdown + YAML-frontmatter task store on local disk**
where each file in `tasks/*.md` IS a task. The package exposes that store
two ways:

- a raw CLI (`quay-native task …`) for direct file operations, and
- an **MCP server** (`quay-native mcp`) — the formal ABI transport Core
  spawns via `mcp_entry` in `.quay/config.yml`.

## The data model

A task is a markdown file with YAML frontmatter and a body carrying the
four task sections (`## Proposal`, `## Plan`, `## Acceptance Criteria`,
`## Definition of Done`):

```markdown
---
id: DEMO-1
title: A sample task
status: ready
labels: []
---

## Proposal
…
```

- `id` — the filename stem (e.g. `DEMO-1` from `tasks/DEMO-1.md`).
- `status` — one of four states: `todo`, `ready`, `done` (terminal), or
  `needs-human` (terminal soft stop).
- `role` — never stored; derived from whether `children` is non-empty
  (`compound` epic vs `primitive`).
- `parent` / `children` — link tasks into epics.

Because the store is plain files, it is trivially inspectable and
versionable with git — the reference against which every other Provider is
measured.

## Relationship to Core

Core (`quay`) is written against the Provider ABI's canonical task
view-model (`{id, title, status, role, labels, parent/children, body}`),
never against a specific backend. `quay-native` is that backend — the
reference/local-file implementation. Core selects it as the default
`enabled: true` provider in `.quay/config.yml`; any `quay` command
(`task list`, `task view`, `gate`, `complete`, …) works against it with no
Provider-specific code in Core.

`quay-native` also declares the two-layer Skill set (`quay:author` /
`quay:execute`) used by this repo's own task-driven development loop, and
ships a minimal documented sample workspace under
`examples/sample-workspace/` (5 illustrative tasks — a compound epic with
two primitive children plus two standalone tasks).

## Usage

Point the provider at a workspace's `tasks/` directory — either explicitly
via `QUAY_NATIVE_TASKS_DIR`, or by running from a workspace root that has a
`.quay/config.yml` (the CLI walks up to find it):

```sh
# From a workspace with tasks/*.md:
node --experimental-strip-types packages/quay-native/bin/quay-native.ts task list
node --experimental-strip-types packages/quay-native/bin/quay-native.ts task get DEMO-1
node --experimental-strip-types packages/quay-native/bin/quay-native.ts task check DEMO-1
node --experimental-strip-types packages/quay-native/bin/quay-native.ts task create --title "…"   # create a new task
node --experimental-strip-types packages/quay-native/bin/quay-native.ts task edit DEMO-1 --status done
node --experimental-strip-types packages/quay-native/bin/quay-native.ts mcp                      # start the MCP server
```

Or through Core, which reads the provider from `.quay/config.yml`:

```sh
node --experimental-strip-types packages/quay/bin/quay.ts task list
node --experimental-strip-types packages/quay/bin/quay.ts task view DEMO-1
```

Other subcommands: `quay-native init` (scaffold a fresh workspace with a
`.quay/config.yml`), `quay-native adr …` / `quay-native doc …` (the sibling
ADR/document stores), and `quay-native manifest` (print this package's
`provider.yml`).

See [`provider.yml`](provider.yml) for the current, honest capability
declaration, and
[`examples/sample-workspace/README.md`](examples/sample-workspace/README.md)
for a walkable example store. Released under the repo's
[`LICENSE`](../../LICENSE).
