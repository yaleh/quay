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
  goal_ac?: string;            // owning goal AC id (task→AC linkage, G7; top-level single scalar, optional)
  extra?: {
    schema?: string;           // "v1" — the schema marker (grandfather boundary)
    dirFile?: string;          // projection-scaffolding field (forbidden by assertion A6)
    dirStatus?: string;        // directive disposition
    depends_on?: string[];     // legacy home — task_write used to nest it under extra
    malformed?: string[];      // store-injected diagnosis markers
    deliveryCriticalSource?: string; // "evidence" | "adhoc" — which source attached the delivery-critical label
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

## `task_write` and `goal_ac`

`goal_ac` is the task→goal-AC linkage field (G7, `SPEC-goal-mechanism-2026-09-06.md` §7): a task
declares **at most one** owning AC, stored **top-level** as a single scalar (not an array, unlike
`depends_on`). It is **optional** — `gap-*` defect tasks carry none. It is **one-way** (written on the
task side only; the goal/AC record lists no children), so there is no two-way sync and therefore no
drift surface.

```json
{
  "id": "gap-goal-driver-mechanical-ring",
  "goal_ac": "AC-177"
}
```

The read path is `frontmatterGoalAc()` / `readGoalAc()` / `parseTask()` — all delegate to the single
frontmatter parser. Absent / empty ⇒ `null` (缺值 = 未查, distinguishable from any concrete AC id).
The field is deliberately **not** read from `extra` (the `depends_on` legacy home): nesting it under
`extra` was exactly the `depends_on` read-failure lesson (AC-178's `origin`).

The mechanical consumer is `plugin/scripts/goal-driver.ts`'s `computeGoalGaps()`: for each
unachieved (status `active`) AC, `count(task where goal_ac == AC and status ∈ {todo, ready}) == 0`
⇒ a **gap** — the three-state output (`in-progress` / `gap` / `not-evaluated`) keeps "read the
input and found nothing advancing this AC" distinct from "could not read the input at all".

## `deliveryCriticalSource` — the `delivery-critical` label's source discriminator

`extra.deliveryCriticalSource` is an **optional** `extra.*` scalar that records *which source*
attached the `delivery-critical` label. It exists because the label now has two legal sources that
were previously conflated into a single prose claim ("由 outer 按证据打，从不移除"):

| Value | Source | Write path |
|---|---|---|
| `evidence` | 立案/晋升时按证据打（outer 已退役；晋升路径现在只【保留】已存在的标签，`ensureDeliveryCriticalLabel` 在**新增**标签时盖 `evidence`） | `plugin/scripts/task-ops.ts` `ensureDeliveryCriticalLabel` (promote gate) |
| `adhoc` | DIR-130 授权 manager 按人类临时插队指令加/删 | `task_write(extra: { deliveryCriticalSource: "adhoc" })` — 纯 `extra.*` 透传，无专码 |
| *(absent)* | 历史遗留：任务先于该字段存在，来源不可考 | — |

The read path is `frontmatterDeliveryCriticalSource()` in `plugin/scripts/task-schema.ts` (the same
projection family as `frontmatterStatus` / `frontmatterGoalAc`). It returns an **explicit
three-state** (硬规则 3b): `"evidence"` / `"adhoc"` are returned verbatim; **anything else —
absent (legacy) OR an unrecognized value — returns `"unknown"`**, never conflated with either
concrete source. A legacy delivery-critical task (the 110 pre-field tasks in the store) is therefore
*not* misjudged as "source unclear ⇒ problem" — `unknown` is a legitimate, named legacy condition.

## CLI write surface for the top-level fields

`depends_on` and `goal_ac` are writable through the CLI — not only through MCP `task_write`:

```bash
quay task edit gap-example --depends-on gap-prereq-a,gap-prereq-b --goal-ac AC-177
quay task create gap-new --title "…" --depends-on gap-prereq-a --goal-ac AC-177
quay-native task edit gap-example --depends-on gap-prereq-a,gap-prereq-b --goal-ac AC-177
quay-native task create gap-new --depends-on gap-prereq-a --goal-ac AC-177
```

`--depends-on <id[,id...]>` writes a top-level `depends_on` array (comma-split, mirroring
`--children`); `--goal-ac <AC-NNN>` writes the top-level `goal_ac` scalar. Omitting either flag on a
subsequent `task edit` leaves the existing value untouched (the patch is read-merge-write, never a
whole-frontmatter replace) — the idempotent negative control.

Alignment is machine-checked: `packages/quay/test/cli-write-surface-parity.test.mjs` machine-reads
the native MCP `task_write` zod `inputSchema` (the single source of truth) and asserts every writable
field is CLI-flag-wired in both the Core CLI (`packages/quay/src/cli/task-edit.ts`) and the native CLI
(`packages/quay-native/bin/quay-native.ts`). Do **not** hand-maintain a second field list here — a
field that drifts out of the CLI surface fails that test. On the GitHub Provider these fields are
stored in the issue body's hidden `quay-meta` block (surfaced through `extra`); `extra` itself
remains not CLI-writable on GitHub.

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
- `packages/quay-native/src/mcp-server.ts` — the `task_write` schema (`depends_on` / `goal_ac` params).
- `plugin/scripts/goal-driver.ts` — the G7 gap calc (`computeGoalGaps`) that consumes `goal_ac`.
- `tasks/gap-unified-frontmatter-parser.md` — the task that unified the readers.
