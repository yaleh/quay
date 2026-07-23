# M117 iteration-0 — TS migration P5-B (quay-backlog provider, DIR-058)

**Task:** `exp5-M-TS-MIGRATION-P5-B`
**Charter:** `experiments/quay-perpetual-stream/charters/M117-ts-migration-p5-b.md`
**Commit:** `8c4bc9e` — "feat(M117): TS migration P5-B (DIR-058) — migrate quay-backlog src/*.js to .ts"

## What changed (file-by-file)

All 3 files were moved with `git mv` (history preserved via `git log --follow`, confirmed below),
then edited in place (type annotations only, no logic changes):

### 1. `packages/quay-backlog/src/manifest.js` → `src/manifest.ts`

- Added `import type { Manifest } from "../../quay/src/abi.ts";`
- `readManifest()` → `readManifest(): Manifest`
- `YAML.parse(raw)` → `YAML.parse(raw) as Manifest`

### 2. `packages/quay-backlog/src/backlog-client.js` → `src/backlog-client.ts`

- Removed the `@ts-nocheck` ramp-list line (file is now real-typechecked).
- Added `import type { Task } from "../../quay/src/abi.ts";`
- `mapStatus(rawStatus)` → `mapStatus(rawStatus: unknown): "todo" | "done"`
- `parseTaskFile(raw, sourcePath)` → `parseTaskFile(raw: string, sourcePath: string): Task`
- `YAML.parse(m[1]) ?? {}` → cast `as Record<string, unknown>`
- `labels: Array.isArray(frontmatter.labels) ? frontmatter.labels : []` → cast the truthy arm
  `as string[]`
- `createBacklogClient(boardDir)` → `createBacklogClient(boardDir: string)`
- `listFiles()` → `listFiles(): string[]`
- `readAll()` → `readAll(): Task[]`
- `list({ status, label } = {})` → `list({ status, label }: { status?: string; label?: string } = {}): Task[]`
- `get(id)` → `get(id: string): Task | null`
- `check(id)` → `check(id: string): Record<string, unknown>` (matches the same convention used by
  `quay-github/src/github-client.ts#check()` and `quay-native/src/store.ts#check()`)

### 3. `packages/quay-backlog/src/mcp-server.js` → `src/mcp-server.ts`

- Removed the `@ts-nocheck` ramp-list line.
- `import { createBacklogClient } from "./backlog-client.js"` → `"./backlog-client.ts"`
- `import { readManifest } from "./manifest.js"` → `"./manifest.ts"`
- `startMcpServer({ tasksDir })` → `startMcpServer({ tasksDir }: { tasksDir: string }): Promise<void>`

### Necessary collateral edits (import-specifier fixups, not logic changes)

Renaming the 3 `src/*.js` files broke two `.js`-suffixed import specifiers elsewhere (Node's
native TS type-stripping resolves import specifiers literally, same as every prior P1–P5-A phase —
confirmed against the P3-C precedent, `git show 78ec963`, which did the identical fixup for
quay-github):

- `packages/quay-backlog/bin/quay-backlog.ts` (already `.ts` since P5-A/M116) — 3 import specifiers
  updated: `"../src/backlog-client.js"` → `.ts`, `"../src/mcp-server.js"` → `.ts`,
  `"../src/manifest.js"` → `.ts`. No other change to this file.
- `packages/quay-backlog/test/backlog-client.test.mjs` — 1 import specifier updated:
  `"../src/backlog-client.js"` → `.ts`. No other change to this file.

(`test/mcp-server.test.mjs` needed no change — it spawns `bin/quay-backlog.ts` over stdio rather
than importing `src/mcp-server.ts` directly.)

## Golden-diff (pre-migration `.js` blob vs post-migration `.ts` file)

Pre-migration blobs captured via `git show HEAD:<path> > /tmp/old-*.js` before `git mv`, one per
file, then diffed against the final `.ts` content.

### `manifest.ts` vs pre-migration `manifest.js`

```
$ diff /tmp/old-manifest.js packages/quay-backlog/src/manifest.ts
8a9
> import type { Manifest } from "../../quay/src/abi.ts";
13c14
< export function readManifest() {
---
> export function readManifest(): Manifest {
15c16
<   return YAML.parse(raw);
---
>   return YAML.parse(raw) as Manifest;
```

### `backlog-client.ts` vs pre-migration `backlog-client.js`

```
$ diff /tmp/old-backlog-client.js packages/quay-backlog/src/backlog-client.ts
1d0
< // @ts-nocheck — TS gradual-adoption ramp list (ADR-012): tsc --noEmit real-checked this file and found pre-existing untyped-JS structural diagnostics; fixing them means real JSDoc typing / a product-code touch, out of the tooling-only phase that introduced this gate. Remove this line once this file is migrated/annotated.
41a41
> import type { Task } from "../../quay/src/abi.ts";
57c57
< export function mapStatus(rawStatus) {
---
> export function mapStatus(rawStatus: unknown): "todo" | "done" {
62c62
< function parseTaskFile(raw, sourcePath) {
---
> function parseTaskFile(raw: string, sourcePath: string): Task {
67c67
<   const frontmatter = YAML.parse(m[1]) ?? {};
---
>   const frontmatter = (YAML.parse(m[1]) ?? {}) as Record<string, unknown>;
76c76
<     labels: Array.isArray(frontmatter.labels) ? frontmatter.labels : [],
---
>     labels: Array.isArray(frontmatter.labels) ? (frontmatter.labels as string[]) : [],
94,95c94,95
< export function createBacklogClient(boardDir) {
<   function listFiles() {
---
> export function createBacklogClient(boardDir: string) {
>   function listFiles(): string[] {
109c109
<   function readAll() {
---
>   function readAll(): Task[] {
116c116
<   function list({ status, label } = {}) {
---
>   function list({ status, label }: { status?: string; label?: string } = {}): Task[] {
127c127
<   function get(id) {
---
>   function get(id: string): Task | null {
131c131
<   function check(id) {
---
>   function check(id: string): Record<string, unknown> {
```

### `mcp-server.ts` vs pre-migration `mcp-server.js`

```
$ diff /tmp/old-mcp-server.js packages/quay-backlog/src/mcp-server.ts
1d0
< // @ts-nocheck — TS gradual-adoption ramp list (ADR-012): tsc --noEmit real-checked this file and found pre-existing untyped-JS structural diagnostics; fixing them means real JSDoc typing / a product-code touch, out of the tooling-only phase that introduced this gate. Remove this line once this file is migrated/annotated.
14,15c13,14
< import { createBacklogClient } from "./backlog-client.js";
< import { readManifest } from "./manifest.js";
---
> import { createBacklogClient } from "./backlog-client.ts";
> import { readManifest } from "./manifest.ts";
17c16
< export async function startMcpServer({ tasksDir }) {
---
> export async function startMcpServer({ tasksDir }: { tasksDir: string }): Promise<void> {
```

**Every hunk in all 3 diffs is type-annotation, import-extension, or `@ts-nocheck`-removal only.
No control-flow, data-shape, or logic change in any file.**

## Verification (5 commands, exact output)

### 1. `cd packages/quay-backlog && npx tsc --noEmit -p .`

```
$ npx tsc --noEmit -p packages/quay-backlog/
(no output)
$ echo "exit=$?"
exit=0
```

### 2. `cd packages/quay-backlog && node --test test/*.mjs`

**Before** (baseline, run before any change):

```
✔ mapStatus maps any 'Done'-containing status to done, everything else to todo (1.075593ms)
✔ list() reads every *.md file in the board dir and maps the view-model shape (11.777453ms)
✔ get() returns one task by id, or null when not found (1.215955ms)
✔ list() with a status filter applies the MAPPED status, not the raw Backlog.md string (1.709979ms)
✔ check() reports ok:false 'not supported' — this Provider is read-only, no gate (1.584397ms)
✔ a malformed task file (no frontmatter) throws a clear error, not a silent skip (0.722349ms)
✔ list() against a non-existent board dir returns an empty array, not a throw (0.149441ms)
quay-backlog mcp: serving read-only tasks from /tmp/quay-backlog-mcp-fixture-ItnUBk
✔ provider://manifest resource returns the correct name/read-only capabilities (317.362571ms)
quay-backlog mcp: serving read-only tasks from /tmp/quay-backlog-mcp-fixture-Ucg8eE
✔ task_list returns the fixture task with the mapped view-model shape (278.971689ms)
quay-backlog mcp: serving read-only tasks from /tmp/quay-backlog-mcp-fixture-0HcAB0
✔ task_get for a known id returns the task; for an unknown id returns isError:true (321.179495ms)
quay-backlog mcp: serving read-only tasks from /tmp/quay-backlog-mcp-fixture-9tgQSz
✔ adr_list degrades to an empty array (this Provider does not support ADRs) (304.377586ms)
quay-backlog mcp: serving read-only tasks from /tmp/quay-backlog-mcp-fixture-koD17f
✔ there is no task_write tool registered (read-only provider, no write surface) (309.463062ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1771.79317
```

**After** (post-migration):

```
✔ mapStatus maps any 'Done'-containing status to done, everything else to todo (1.135914ms)
✔ list() reads every *.md file in the board dir and maps the view-model shape (11.714578ms)
✔ get() returns one task by id, or null when not found (1.157124ms)
✔ list() with a status filter applies the MAPPED status, not the raw Backlog.md string (1.084063ms)
✔ check() reports ok:false 'not supported' — this Provider is read-only, no gate (0.941091ms)
✔ a malformed task file (no frontmatter) throws a clear error, not a silent skip (0.803179ms)
✔ list() against a non-existent board dir returns an empty array, not a throw (0.187512ms)
quay-backlog mcp: serving read-only tasks from /tmp/quay-backlog-mcp-fixture-rLjx1H
✔ provider://manifest resource returns the correct name/read-only capabilities (311.324716ms)
quay-backlog mcp: serving read-only tasks from /tmp/quay-backlog-mcp-fixture-Z8D4Dv
✔ task_list returns the fixture task with the mapped view-model shape (315.14766ms)
quay-backlog mcp: serving read-only tasks from /tmp/quay-backlog-mcp-fixture-mYljF9
✔ task_get for a known id returns the task; for an unknown id returns isError:true (303.483593ms)
quay-backlog mcp: serving read-only tasks from /tmp/quay-backlog-mcp-fixture-JtIWom
✔ adr_list degrades to an empty array (this Provider does not support ADRs) (290.009864ms)
quay-backlog mcp: serving read-only tasks from /tmp/quay-backlog-mcp-fixture-uARW3s
✔ there is no task_write tool registered (read-only provider, no write surface) (324.42691ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1795.294827
```

12/12 pass before and after, identical test set, zero behavior change.

### 3. `cd packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')`

(Run as an explicit literal file list, equivalent to the glob-exclusion in the charter/CLAUDE.md,
since this sandbox's command-safety check rejects `$(...)`/glob-exclusion compound commands from a
worktree — the file set is identical: all 42 non-flaky test files.)

**Before** (baseline, run before any change):

```
...
✔ test/web-ui-browser.test.mjs (8390.514056ms)
ℹ tests 354
ℹ suites 0
ℹ pass 354
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 152945.055795
```

**After** (post-migration):

```
...
✔ test/web-ui-browser.test.mjs (7902.139512ms)
ℹ tests 354
ℹ suites 0
ℹ pass 354
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 151206.082297
```

354/354 pass before and after (matches the charter's stated baseline count exactly).

### 4. `for d in packages/*/; do npx tsc --noEmit -p "$d"; echo "$d exit=$?"; done`

(Run as 4 separate per-package invocations — same sandbox constraint as above; same DIR-059
per-package gate the loop form invokes.)

```
$ npx tsc --noEmit -p packages/quay-backlog/; echo "packages/quay-backlog/ exit=$?"
packages/quay-backlog/ exit=0

$ npx tsc --noEmit -p packages/quay-github/; echo "packages/quay-github/ exit=$?"
packages/quay-github/ exit=0

$ npx tsc --noEmit -p packages/quay-native/; echo "packages/quay-native/ exit=$?"
packages/quay-native/ exit=0

$ npx tsc --noEmit -p packages/quay/; echo "packages/quay/ exit=$?"
packages/quay/ exit=0
```

All 4 packages exit 0, no output (no diagnostics at all — not even the pre-existing documented
TS2589 errors mentioned as tolerable in the task's AC2; there are none currently).

### 5. `find packages -path '*/node_modules/*' -prune -o -name '*.js' -print | grep -v '/test/'`

```
$ find packages -path '*/node_modules/*' -prune -o -name '*.js' -print | grep -v '/test/'
packages/quay-native/scripts/manifest.sea-shim.js
packages/quay/scripts/version-sea-shim.js
```

Only the 2 permanently-exempted SEA shims remain. Full JS-elimination (per DIR-058's AC1/AC2)
confirmed.

## `git log --follow` (history preservation)

```
$ git log --follow --oneline -- packages/quay-backlog/src/manifest.ts
8c4bc9e feat(M117): TS migration P5-B (DIR-058) — migrate quay-backlog src/*.js to .ts
c005bbd M62: DIR-039 task migration/import — generic ABI migrate + Backlog.md provider
def5c92 Execute QN-002: implement GitHub Provider, prove ABI transfers

$ git log --follow --oneline -- packages/quay-backlog/src/backlog-client.ts
8c4bc9e feat(M117): TS migration P5-B (DIR-058) — migrate quay-backlog src/*.js to .ts
61f02e7 M63 BUILD: TS migration P0 tooling (ADR-012) — tsconfig + tsc gate + node-native .ts run/test path
c005bbd M62: DIR-039 task migration/import — generic ABI migrate + Backlog.md provider

$ git log --follow --oneline -- packages/quay-backlog/src/mcp-server.ts
8c4bc9e feat(M117): TS migration P5-B (DIR-058) — migrate quay-backlog src/*.js to .ts
61f02e7 M63 BUILD: TS migration P0 tooling (ADR-012) — tsconfig + tsc gate + node-native .ts run/test path
c005bbd M62: DIR-039 task migration/import — generic ABI migrate + Backlog.md provider
```

## Task AC / Charter DoD status

Task `exp5-M-TS-MIGRATION-P5-B` Acceptance Criteria:

1. ✅ All 3 `src/*.js` files renamed/ported to `.ts`, typechecking against the Provider ABI the same
   way quay-native/quay-github do (uses `import type { Task, Manifest } from "../../quay/src/abi.ts"`,
   identical pattern to `quay-github/src/{github-client,manifest}.ts`).
2. ✅ `npx tsc --noEmit -p packages/quay-backlog` exits 0, no errors at all (not even a pre-existing
   TS2589 — none exist in this package).
3. ✅ `packages/quay-backlog`'s own test suite (`backlog-client.test.mjs`, `mcp-server.test.mjs`) is
   green before (12/12) and after (12/12).
4. ✅ Full non-flaky `packages/quay` suite green before (354/354) and after (354/354).

Charter Definition of Done:

1. ✅ All 3 files are `.ts` on the branch (this worktree's branch, fast-forwarded from and to be
   merged into `master`); `git log --follow` shows each file's rename commit (`8c4bc9e`) with prior
   history intact (pasted above).
2. ✅ `tsc --noEmit` + relevant suite(s) pasted as evidence above (verbatim, not paraphrased).
3. ✅ No behavior change: golden-diff (pasted above) shows only type-annotation/import-extension/
   `@ts-nocheck`-removal hunks in all 3 files; test suites confirm identical pass/fail behavior
   before and after.

**All 4 task ACs and all 3 charter DoD items are met with evidence.**

## Out of scope for this iteration (charter's "Additional Done-when", not part of this task's own
AC/DoD)

The charter's own body also lists 3 "Additional Done-when" items (since P5-B is the sibling that
completes DIR-058 in full): the repo-wide find-check (done above, item 5), a post-migration
archguard structural-analysis run recorded on `dashboard.md`, and dispositioning DIR-058 `applied`
with this task's evidence cited. Those two remaining items are outer-loop/ABSORB-stage bookkeeping
actions (governance of the directive record and dashboard, not this task's own file scope) and were
not part of this implementation subagent's explicit assignment — flagged here for the ABSORB step
to pick up, not silently dropped.
