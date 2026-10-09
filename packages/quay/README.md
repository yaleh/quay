# quay (Core)

`quay` is the provider-agnostic **Core** package: a CLI, a small web UI, and
an MCP client, all talking to whichever **Provider** is enabled in
`.quay/config.yml` over the Provider ABI. Core itself has no opinion about
where tasks are actually stored — that's the Provider's job (see
[`quay-native`](../quay-native), the reference/local-file Provider, and
[`quay-github`](../quay-github), the GitHub Issues Provider, for the two
real implementations in this repo).

See the [repo root README](../../README.md) for the three-package overview
and the monorepo-wide install/dev instructions.

## Install

> **The npm and SEA release channels are retired** (human ruling 2026-09-16:
> 「取消 sea 和 npm release。这些是我们最近没有精力去保障的。」 /
> 「按照 claude code plugin 发布和安装。CI 应当按此设计。」). No GitHub Release
> carries a `.tgz` or a SEA archive any more. The **Claude Code plugin is the sole
> supported install path**; both retired artifacts remain buildable locally from a
> source checkout. Full ruling text and history:
> [repo root README § Install](../../README.md#install).

### Option A — as a Claude Code plugin (recommended)

```
/plugin marketplace add yaleh/quay
/plugin install quay
```

The plugin ships this package's bundled CLI (`vendor/quay/dist/quay.js`, a
self-contained esbuild output on Node ≥ 20) behind a `bin/quay` shim, so
`quay --version`, `quay --help` and `quay config validate` all work inside any
session with the plugin enabled — no `npm install` at all.

### Option B — from source

```sh
git clone https://github.com/yaleh/quay.git
cd quay
npm install
node --experimental-strip-types packages/quay/bin/quay.ts --version
```

### Option C — npm global install (build the tarball yourself)

There is no published tarball to download. `scripts/package.sh` packs one
**locally** from a source checkout (Option B) — run it from the repo root:

```sh
npm install                              # from the repo root, once (npm workspaces)
bash packages/quay/scripts/package.sh    # -> packages/quay/quay-<version>.tgz
npm install -g packages/quay/quay-<version>.tgz
quay --version
quay --help
```

Installing from the tarball also runs this package's `postinstall` hook
(`scripts/register-plugin.mjs`), which registers the bundled Claude Code plugin
— see the [repo root README § Using the npm-installed quay with Claude
Code](../../README.md#using-the-npm-installed-quay-with-claude-code-quayinit).

## Configuration

`quay` reads `.quay/config.yml` at the workspace root. Each provider entry's
keys follow this order (matching this repo's own `.quay/config.yml`, the
canonical example):

```yaml
providers:
  native:
    enabled: true
    path: "./packages/quay-native"
    tasks_dir: "./tasks"
    mcp_entry: ["node", "./bin/quay-native.ts", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "./tasks"

  github:
    enabled: false                       # native is the default; select explicitly via --provider github
    path: "./packages/quay-github"
    mcp_entry: ["node", "./bin/quay-github.ts", "mcp"]
    env:
      QUAY_GITHUB_REPO: "yaleh/quay"     # owner/repo this Provider reads issues from
```

- `enabled` — whether this provider is available at all (`quay mcp` only
  aggregates `enabled: true` providers).
- `path` — where the Provider's own code + `provider.yml` live. **Optional for the native
  provider**: when omitted, Core resolves it from its own plugin root
  (`<plugin-root>/vendor/quay-native`), which is what `quay-init` writes for a fresh install.
  Required for every other provider.
- `tasks_dir` — (native only) storage path for this workspace's tasks.
- `mcp_entry` — the command Core spawns to launch this Provider's MCP server. **Optional for the
  native provider** (derived from the plugin root alongside `path`); required for every other
  provider. `quay config validate` accepts both the omitted and the explicit native form.
- `env` — environment variables passed to the spawned `mcp_entry` process.

The first `enabled: true` provider is the default. Use `--provider <id>` on
any command to explicitly select a different one (it does not need to be
`enabled: true` to be selected this way):

```sh
quay task list --provider github
quay action run gh-3 advance --provider github
```

## Usage

### `quay --version` / `quay -V`

Prints the real installed package version and exits 0:

```
$ node --experimental-strip-types packages/quay/bin/quay.ts --version
0.3.4
$ node --experimental-strip-types packages/quay/bin/quay.ts -V
0.3.4
```

### `quay task list`

```
quay task list [--status <status>] [--label <label>] [--prefix <prefix>]
                [--sort id|status|updated] [--search <query>]
                [--page-size <n>] [--json | --format json]
                [--provider <id>]
```

- `--status <status>` — filter by status (`todo`, `ready`, `done`, `needs-human`, ...).
- `--label <label>` — filter by label; repeat the flag for an AND-join
  (`--label A --label B` returns tasks with both labels).
- `--prefix <prefix>` — filter by task-id prefix (e.g. `--prefix QX` for `QX-*` tasks).
- `--sort id|status|updated` — sort order (default: insertion order).
- `--search <query>` — case-insensitive substring match against title + body.
- `--page-size <n>` — limit output to the first `n` tasks (after all other
  filters/sort are applied). `n` must be a positive integer; `0`, negative
  values, and non-numeric values are a usage error (exit 1 with a message),
  not a silent fall-back to showing everything.
- `--json` — output as a JSON array.
- `--format json` — alias for `--json`, identical output. Any other
  `--format` value (e.g. `--format yaml`) is a usage error.
- `--provider <id>` — select a specific provider instead of the default.

```
$ node --experimental-strip-types packages/quay/bin/quay.ts task list --prefix QX --page-size 2
QX-001	done	primitive	Wire task_write into quay-native CLI/MCP with full frontmatter patch semantics	...
QX-002	done	primitive	Build the GitHub Provider (second real backend, proves ABI)	...

$ node --experimental-strip-types packages/quay/bin/quay.ts task list --prefix QX --page-size 2 --format json
[
  { "id": "QX-001", ... },
  { "id": "QX-002", ... }
]
```

### `quay task view <task-id>` / `quay task edit <task-id> [flags]`

```
$ node --experimental-strip-types packages/quay/bin/quay.ts task view QN-001
QN-001: Wire task_write into quay-native CLI/MCP with full frontmatter patch semantics [done]
...

$ node --experimental-strip-types packages/quay/bin/quay.ts task edit QN-001 --status done --json
{ "id": "QN-001", "status": "done", ... }
```

`task edit` supports full-field parity with the native provider CLI (M16-cli-edit-parity-impl,
per `docs/proposals/exp5-cli-edit-parity.md`):

- `--title <string>` — new title.
- `--status <status>` — new status.
- `--body <string>` — new body (whole-body replacement), passed directly as a shell argument.
  Mutually exclusive with `--body-file`.
- `--body-file <path>` — new body (whole-body replacement) read from a file; use `--body-file -`
  to read from stdin. Mutually exclusive with `--body`.
- `--append-notes <text>` — read-then-write convenience: appends `text` to the task's current
  body rather than replacing it. No new ABI tool is involved — this is a Core-CLI-side
  `taskGet` + `taskWrite` composition.
- `--labels <a,b,c>` — comma-separated label list (whole-list replacement).
- `--parent <task-id>` — reassign parent.
- `--children <a,b,c>` — comma-separated children list (whole-list replacement).
- `--extra <json>` — arbitrary JSON merged into the task's native-only `extra{}` map (see the
  Portable-metadata convention in `experiments/quay-perpetual-stream/inherited-core.md`: `extra{}`
  is a native-only convenience, never the sole copy of a portable fact). Providers that don't
  implement `extra` (e.g. GitHub) hard-error rather than silently drop it (PR-ABI-001 floor).
- `--expect-status <status>` — optimistic-concurrency guard (CAS): the write fails if the task's
  current status doesn't match.

At least one of `--title`/`--status`/`--body`/`--body-file`/`--labels`/`--extra`/`--parent`/
`--children`/`--append-notes` is required; `--status` is no longer solely required (v1's
status-only restriction is lifted).

```
$ node --experimental-strip-types packages/quay/bin/quay.ts task edit QN-001 --title "New title" --body-file notes.md --json
{ "id": "QN-001", "title": "New title", ... }

$ echo "quick body via stdin" | node --experimental-strip-types packages/quay/bin/quay.ts task edit QN-001 --body-file - --json
{ "id": "QN-001", ... }

$ node --experimental-strip-types packages/quay/bin/quay.ts task edit QN-001 --append-notes "Follow-up: checked with team." --json
{ "id": "QN-001", ... }
```

### `quay task check <task-id>`

Runs the ABI's **gate**: asserts a task's status transitions are honestly
earned (e.g. every AC checkbox that claims done is actually backed by
evidence), not merely that the checkboxes are ticked. Exit code mirrors the
result (`0` = pass, `1` = fail).

```
$ node --experimental-strip-types packages/quay/bin/quay.ts task check QN-001
QN-001: PASS — terminal
```

### `quay action list <task-id>` / `quay action run <task-id> <action-id>`

`action list` shows the action buttons applicable to a task's current status
(from the active Provider's manifest); `action run` composes and delivers
the corresponding trigger (e.g. to invoke a Skill).

```
$ node --experimental-strip-types packages/quay/bin/quay.ts action list QN-001
advance	Advance

$ node --experimental-strip-types packages/quay/bin/quay.ts action run QN-001 advance
[quay action run] composed trigger for QN-001 (status=ready, skill=quay:execute):
  ...
```

### Gate & lifecycle commands (QENG-1..4)

`quay` ships a small **gate engine + lifecycle-transition layer** on top of
the same task view-model: a **gate** evaluates a named check against a task
and appends an immutable **GateEvent** to
`<workspaceRoot>/.quay/gate-events.jsonl` (gitignored); **lifecycle** verbs
drive a task's `status` forward/backward over the `{todo, ready, done,
needs-human}` phases, each write itself gated by a gate check. A **driver**
loop (`run`) scans the board and drives every actionable task through
`complete`, unattended.

#### `quay gate <task-id> [--gate <name>]` / `quay gate --list`

Runs a named gate check against `<task-id>` and appends a GateEvent (see
`gate-log` below). Exit code mirrors the verdict: `0` = PASS, `1` = FAIL.

- (no `--gate`) — runs the **`acceptance`** gate: executes
  `task.extra.acceptance` (set via `task edit --acceptance <cmd>`, see
  above) as a shell command. **Fail-closed** if `extra.acceptance` is unset
  (no runnable meter = FAIL, not a silent pass).
- `--gate dod` — runs the **`dod`** gate: a status-relative check (the same
  one `task check` runs) that a task's Proposal/Plan/Acceptance
  Criteria/Definition of Done sections are actually present before it may
  advance `todo -> ready`.
- `--gate <name>` — select any other registered gate (e.g. a workspace's own
  named gates declared in `.quay/gates.yml`, if present).
- `--list` (no task id required) — list every registered gate name for this
  workspace instead of running one.

```
$ node --experimental-strip-types packages/quay/bin/quay.ts gate --list
dod
acceptance

$ node --experimental-strip-types packages/quay/bin/quay.ts task edit DEMO-1 --acceptance true --json
{ "id": "DEMO-1", "extra": { "acceptance": "true" }, ... }

$ node --experimental-strip-types packages/quay/bin/quay.ts gate DEMO-1
PASS
```

(Example output for a fresh/minimal workspace; a workspace with `.quay/gates.yml` custom gates —
like this repo's own — will list additional named gates beyond `dod`/`acceptance`.)

#### `quay gate-log <task-id> [--gate <name>] [--json] [--file <log-path>]`

Prints the GateEvent history for `<task-id>` — the audit trail every `gate`/
lifecycle-verb call appends to. Human-readable by default; `--json` prints
the raw GateEvent array. `--file <log-path>` overrides the log path (default
`<workspaceRoot>/.quay/gate-events.jsonl`).

```
$ node --experimental-strip-types packages/quay/bin/quay.ts gate-log DEMO-1
2026-07-20T10:25:04.436Z acceptance pass

$ node --experimental-strip-types packages/quay/bin/quay.ts gate-log DEMO-1 --json
[
  {
    "id": "0583c50b-...",
    "item_id": "DEMO-1",
    "gate": "acceptance",
    "actor": "quay-cli",
    "verdict": "pass",
    "timestamp": "2026-07-20T10:25:04.436Z",
    "payload": { "reason": "acceptance passed (exit 0)" }
  }
]
```

#### Lifecycle verbs — `complete` / `adjudicate` / `promote` / `retreat`

These are the status-writing verbs over the `{todo, ready, done,
needs-human}` phases; each forward write runs a gate check first and refuses
to write on FAIL.

- **`quay complete <task-id> [--file <log-path>]`** — precondition
  `status=ready`; runs the `acceptance` gate; on PASS writes `status=done`
  (exit 0); on FAIL leaves status unchanged (exit 1). A task not in `ready`
  exits 1 with no gate run and no write.
- **`quay adjudicate <task-id> [--file <log-path>]`** — an independent,
  read-only audit pass: records an audit GateEvent but never writes
  `status`. Always exits 0.
- **`quay promote <task-id> [--file <log-path>]`** — advances exactly one
  legal forward step: `todo -> ready` via the `dod` gate, or `ready -> done`
  via the same path as `complete`.
- **`quay retreat <task-id> --reason <reason> [--file <log-path>]`** — moves
  exactly one legal step backward (`done -> ready`, `ready -> todo`).
  `--reason` is required and is recorded in the GateEvent. An illegal
  transition (e.g. retreating from `todo`) exits nonzero with a message.

```
$ node --experimental-strip-types packages/quay/bin/quay.ts complete DEMO-1
PASS — status=done

$ node --experimental-strip-types packages/quay/bin/quay.ts retreat DEMO-1 --reason "re-open for a fix"
RETREAT done → ready (re-open for a fix)

$ node --experimental-strip-types packages/quay/bin/quay.ts promote DEMO-1
PASS — status=done
```

#### `quay run [--once] [--file <log-path>]`

The autonomous driver loop, **as code**: scans the board for actionable
`ready` tasks (status `ready` AND a non-empty `extra.acceptance` meter) and
drives each through `complete`, lowest task-id first (deterministic).

- `--once` — process exactly ONE actionable task then stop; always exits 0
  (a meter FAIL is recorded as a GateEvent and leaves the task `ready`, not
  treated as an error). No actionable task -> prints `nothing to do`, exit 0.
- (no flag) — loops to a fixpoint (no actionable tasks left) or until the
  stop sentinel `<workspaceRoot>/.quay/.stop` appears (checked at each
  iteration boundary); both exit 0. Only the runaway safety ceiling
  (`maxIterations`) exits 1.

```
$ node --experimental-strip-types packages/quay/bin/quay.ts run --once
FAIL — acceptance failed (exit 1)
DEMO-2: FAIL — acceptance failed (exit 1) (left ready)
```

### `quay serve [--host <host>] [--port <port>]`

Starts the web UI. Defaults to binding `0.0.0.0` on port `4173`; pass
`--host` to bind a specific interface (e.g. `127.0.0.1` for a localhost-only
binding) and `--port` for a different port:

```sh
node --experimental-strip-types packages/quay/bin/quay.ts serve --host 0.0.0.0 --port 4173
```

The UI renders the full 15-view site nav — four groups — plus per-item
detail pages:

- **核心 (Core)** — `Dashboard` (the landing page; `/` redirects here),
  `Tasks`.
- **观测 (Observation)** — `Live`, `Board`, `System`, `Manager`.
- **记录 (Records)** — `Journal`, `Git History`, `Tests`, `Sessions`.
- **知识 (Knowledge)** — `ADRs`, `Goals`, `Docs`, `Architecture`.

View highlights:

- **Dashboard** — the landing page, with a task-ledger card and workspace
  status.
- **Tasks** — the task board. The list page supports the same
  filter/sort/search affordances as the CLI, plus a `?pageSize=` query
  param (10/20/50/100 selector rendered on the page) mirroring
  `--page-size`. An invalid `?pageSize=` value falls back to the default
  (20) with a visible warning banner, rather than silently showing
  everything. Each task links to a `/task/<id>` detail page.
- **Live** / **Board** / **System** / **Manager** — workspace observation:
  live loop state, the intent/execution/landing inconsistency verdict,
  resource-gate + process-budget system status, and the manager view.
- **Journal** / **Git History** / **Tests** / **Sessions** — records: the
  loop journal (escalations, tick log, recent commits), a server-rendered
  commit-landing timeline SVG, the test-suite view, and session history.
- **ADRs** / **Goals** / **Docs** / **Architecture** — knowledge: list +
  detail pages for each kind (`/adr` + `/adr/<id>`, `/goal` + `/goal/<id>`,
  `/doc` + `/doc/<id>`), plus the architecture view.

### `quay mcp`

Starts Core's own MCP server, aggregating every `enabled: true` Provider
from `.quay/config.yml` behind a single MCP endpoint — the binding an agent
(e.g. Claude Code) registers once instead of registering each Provider's
own `<provider> mcp` separately.

## Public API: `quay/dashboard-kernel`

This package publishes exactly one subpath meant for an **external** package consumer: the pure
packing half of the dashboard's "Loop pulse" gantt.

```js
import { FIXED_GANTT_LANES, mergeLiveAndHistoryIntervals, packLanes } from "quay/dashboard-kernel";

const merged = mergeLiveAndHistoryIntervals(inFlight, historyRecords, windowStartMs, nowMs);
const { lanes, overflow } = packLanes(merged); // ≤ FIXED_GANTT_LANES lanes; `overflow` is never dropped
```

- **What it is** — `FIXED_GANTT_LANES` (the fixed 5-lane cap, the dashboard's visual contract),
  `mergeLiveAndHistoryIntervals` (in-flight runs + `worker-outcome.jsonl` history → one interval
  list, filtered to the time window and deduped on `(taskId, startMs)`), and `packLanes` (greedy
  packing onto ≤ 5 lanes plus an explicit `overflow` count), together with the interval type and the
  published state vocabulary (`LIVE_INTERVAL_PHASES`, `LIVE_INTERVAL_FINAL_STATES`).
- **What it is NOT** — the SVG renderer, the CSS colour tokens and the label catalogue stay in
  Core's dashboard. The kernel publishes *which states exist*, never *what colour they are*: map the
  state values onto your own palette.
- **Zero dependencies** — the module is a zero-import leaf, so importing it never drags Core's
  web/render/i18n dependency graph into the consumer's bundle.
- **Runtime and types** — the `exports` map resolves the runtime to the built
  `dist/dashboard-kernel.js` and TypeScript to the `.ts` source. The built file (produced by
  `bash packages/quay/scripts/build-dist.sh`, which `package.sh` runs before `npm pack`) is
  required rather than the `.ts` source because Node refuses to strip types for anything under
  `node_modules` — which is exactly where an externally installed copy lives.
- **Equivalence vector** — `dashboard-kernel-vectors.json` ships with the package (and is resolvable
  as `quay/dashboard-kernel/vectors`). It is the cross-project contract test: replay each vector
  through your copy and assert identical lane assignment and `overflow`. That is how a consumer
  proves it runs the same algorithm rather than a look-alike.
- **Reaching it from an installed plugin — the form a consuming project actually uses.** A project
  consumes quay as the **Claude Code plugin** (marketplace → the `dist-plugin` branch → user scope),
  not as an npm package, and the plugin artifact mirrors this subpath's built bundle and its vector
  next to each other under the plugin's `vendor/quay/dist/`. A consumer resolves them **by path**:

  ```js
  // `pluginRoot` = the directory the quay plugin was installed into. Both paths are
  // artifact-relative, exactly as they appear in the published tree.
  const kernel = await import(new URL("vendor/quay/dist/dashboard-kernel.js", pluginRoot));
  const vectors = JSON.parse(
    await readFile(new URL("vendor/quay/dist/dashboard-kernel-vectors.json", pluginRoot), "utf8")
  );
  ```

  This path contract (`<plugin-root>/vendor/quay/dist/dashboard-kernel.js` +
  `…/dashboard-kernel-vectors.json`) is what the plugin ships today, and it is why the kernel bundle
  exists as a **standalone plain-JS file**: it has zero imports, so importing it needs no
  `node_modules` resolution, no package manager and no build step on the consumer side, and the file
  keeps working when copied out of its original tree. The `exports` map above
  (`quay/dashboard-kernel`, `quay/dashboard-kernel/vectors`) is the **package-manager** form of the
  same two files — it applies when the *package* is installed, which is not the channel an installed
  plugin provides. `plugin/scripts/sync-vendor.sh` mirrors both files into the artifact and its
  `--check` mode fails loudly if either is missing or differs from the source build, so an absent or
  stale kernel in a published artifact is a red check rather than a silent gap.
- **Stability** — this subpath is a semver-governed public contract. Changing the parameter or
  return shape of `packLanes` / `mergeLiveAndHistoryIntervals`, or removing an exported name, is a
  **breaking** change and calls for the package's major-version bump; adding an export or widening
  an input type is not.
- **Known consumers** — `claudecodeui`'s Quay tab is the first external consumer: it feeds
  `quay driver live --json` output through this kernel and renders the lanes with its own
  React/Tailwind components.

> **Distribution note.** The npm and SEA release channels are retired (see Install above). The live
> channel is the **plugin marketplace** (the CI-published `dist-plugin` orphan branch, installed at
> user scope), and the kernel reaches a consumer there through the mirrored
> `vendor/quay/dist/dashboard-kernel.js` path documented above. Installing a locally built tarball
> (`bash packages/quay/scripts/package.sh` → `npm install <path-to-quay-*.tgz>`) or a `file:`
> dependency on a checkout also works, via the `exports` map. The stability promise above is a
> promise about the exported shape, and it holds however the artifact is delivered.

## Distribution: single-file executables (SEA) — **no longer published**

> **Retired with the npm channel** by the 2026-09-16 ruling — no release page carries a
> `quay-sea-*.tar.gz`/`.zip` any more. The build still works locally
> (`bash packages/quay/scripts/build-sea.sh` → `packages/quay/dist-sea/quay`); full ruling
> text, the two-binary rationale, and the verification script are documented once, at the
> repo root: [`README.md` § Distribution: single-file executables (SEA)](../../README.md#distribution-single-file-executables-sea).

## Running the test suite

The repo-wide canonical entry point is `scripts/test.sh` (see the repo root README) — it runs
this package's tests as part of its full-suite pass. To run only this package's tests directly:

```sh
node --test packages/quay/test/*.test.mjs
```

Some tests (any spawning `--provider github`) additionally require an
authenticated `gh auth status` session with read access to `yaleh/quay`.

## License

MIT — see [`LICENSE.md`](LICENSE.md).
