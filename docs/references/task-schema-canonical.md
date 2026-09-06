# Canonical task frontmatter schema

> Single source of truth: `plugin/scripts/task-schema.ts` — `parseFrontmatterCompletely()`.
> This document is a **readable view of that code**; if they ever disagree, the code wins
> (the doc is regenerable, never a second authoritative source).

## The one parser, three readers

Before `gap-unified-frontmatter-parser`, three frontmatter readers drifted independently:

| Reader | Where | Old semantics |
|---|---|---|
| `store.parse()` | `packages/quay-native/src/store.ts` | full `YAML.parse()` |
| `parseTask()` | `plugin/scripts/task-schema.ts` | lenient hand-parse (scalars only) |
| `readDependsOn()` | `plugin/scripts/task-schema.ts` | regex on the raw string |

Now **all three delegate to one function**:

```ts
// plugin/scripts/task-schema.ts
export function parseFrontmatterCompletely(frontmatterRaw) {
  return (parseYaml(frontmatterRaw) ?? {});   // full YAML semantics
}
```

`store.parse()` calls it to read a task file's frontmatter; `parseTask()` calls it and projects
`{ labels, extra, depends_on }`; `readDependsOn()` calls it and projects the `depends_on` list.
Because they share the same parse, a field added to the schema is visible to all three
automatically — there is no second parser to keep in sync.

## Canonical schema (TypeScript interface)

The complete field set a task frontmatter may carry (unknown keys are preserved, never dropped):

```ts
interface TaskFrontmatter {
  id?: string;                 // task id (storage key; the store falls back to the filename)
  title?: string;              // human title
  status?: string;             // todo | ready | done | needs-human | superseded
  labels?: string[];           // flow `[a, b]` or block `- a`
  parent?: string | null;      // parent task id (relation edge)
  children?: string[];         // child task ids (relation edge)
  depends_on?: string[];       // prerequisite task ids (relation edge; top-level OR legacy extra)
  extra?: {
    schema?: string;           // "v1" — the schema marker (grandfather boundary)
    dirFile?: string;          // projection-scaffolding field (forbidden by assertion A6)
    dirStatus?: string;        // directive disposition
    depends_on?: string[];     // legacy home — task_write used to nest it under extra
    malformed?: string[];      // store-injected diagnosis markers
    [key: string]: unknown;
  };
  [key: string]: unknown;      // forward-compatible: unknown fields survive the round-trip
}
```

## Example

```markdown
---
id: gap-example
title: "Example task"
status: ready
labels: [gap, defect]
parent: null
children: []
depends_on:
  - gap-prereq-a
  - gap-prereq-b
extra:
  schema: v1
---
## Finding
…
```

`depends_on` is a **first-class relation edge** (like `parent`/`children`), written top-level by
`task_write`. The legacy `extra: { depends_on: [...] }` shape is still read (for pre-existing
files), but new writes use the top-level field.

## `task_write` and `depends_on`

The `task_write` MCP tool exposes `depends_on` as an explicit top-level parameter — no `extra`
escape hatch required:

```json
{
  "id": "gap-example",
  "title": "Example task",
  "depends_on": ["gap-prereq-a", "gap-prereq-b"]
}
```

The round-trip is `task_write(depends_on)` → `store.write()` → `depends_on:` in the file →
`store.parse()` / `parseTask()` / `readDependsOn()` all read it back as `["gap-prereq-a",
"gap-prereq-b"]`.

## Commit-after-write (dispatch visibility)

`task_write` and `task_delete` are **commit-by-default**: after a successful disk write, the native
store commits `tasks/<id>.md` alone (a scoped pathspec, never `-A`), so a `task_write`-only change
is dispatch-visible without a separate manual `git commit`. The commit is **branch-aware**:

- **Main checkout** (any branch that is not `develop` and not a `task/<id>` worktree branch): the
  store commits to the current branch and then `git push . <branch>:develop` (fast-forward only), so
  the write reaches `develop` — the ref every dispatch/lifecycle consumer reads (`git show
  develop:tasks/<id>.md`). A non-fast-forward push (a forked main checkout) is left to the driver's
  standing `propagateDocBranchToDevelop` semantic sync.
- **Task worktree** (`task/<id>` branch): the store commits to the worktree's own branch and does
  NOT push to `develop` — the fan-in ff-merge remains the only path into `develop`.
- **Not in a git repo** (unit-test temp dirs): the commit is a no-op (`committed: false`), never a
  throw.

The behavior is opt-out-able per call (`store.write(id, patch, { commit: false })`) for multi-file
batch editors that commit once at the end. A failed commit does not fail the write (the disk value
is already written) — it is surfaced on stderr, never silently swallowed (CLAUDE.md 硬规则 3b).

## `task_delete`

The native Provider exposes a `task_delete(id)` ABI verb (previously absent — the only way to remove
a task was a raw `git checkout --`/`rm` on `tasks/<id>.md`). It unlinks the task file and applies the
same branch-aware commit strategy as `task_write`. A delete of a non-existent id **fails closed**
(`isError:true` / `{ ok:false, reason:"missing" }`) — never a silent no-op. The result shape is
`{ id, ok, reason, committed, propagated }`.

## Related

- `plugin/scripts/task-schema.ts` — the parser + the validator (`checkTask`) built on it.
- `packages/quay-native/src/store.ts` — the native store (`parse` delegates here).
- `packages/quay-native/src/mcp-server.ts` — the `task_write` schema (`depends_on` param).
- `tasks/gap-unified-frontmatter-parser.md` — the task that unified the readers.
