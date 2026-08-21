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

### Option A — global install from a release artifact (recommended)

Download the latest release from the
[GitHub Releases page](https://github.com/yaleh/quay/releases) and either:

- **npm package** (`quay-<version>.tgz`, requires a local Node.js >= 20):

  ```sh
  npm install -g quay-0.3.4.tgz   # replace with the actual filename from the release
  quay --version
  quay --help
  ```

- **single-file executable** (no Node.js install required at all — see
  [Distribution: single-file executables (SEA)](#distribution-single-file-executables-sea)
  below).

### Option B — from source

```sh
git clone https://github.com/yaleh/quay.git
cd quay
npm install
node --experimental-strip-types packages/quay/bin/quay.ts --version
```

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
- `path` — where the Provider's own code + `provider.yml` live.
- `tasks_dir` — (native only) storage path for this workspace's tasks.
- `mcp_entry` — the command Core spawns to launch this Provider's MCP server.
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

## Distribution: single-file executables (SEA)

In addition to the npm-installable package (Option A above), every tagged
release also publishes **platform-specific single-file executables** built
with [Node.js SEA (Single Executable Application)](https://nodejs.org/api/single-executable-applications.html) —
these require **no separately-installed Node.js runtime** on the end user's
machine at all.

Each release's GitHub Release page includes archives named
`quay-sea-<version>-<platform>.{tar.gz,zip}` for `linux-x64`, `macos-arm64`,
and `windows-x64`. Each archive bundles:

- `quay` (or `quay.exe` on Windows) — the Core CLI/web-UI/MCP binary, built
  via `packages/quay/scripts/build-sea.sh`.
- `quay-native` (or `quay-native.exe`) — the native Provider binary, built
  via `packages/quay-native/scripts/build-sea.sh`. Both binaries are needed
  because Core spawns the active Provider's `mcp_entry` as a child process;
  `quay serve` is only genuinely Node-free end-to-end if `mcp_entry` also
  points at a compiled binary, not `node ...`.
- A packaged `.quay/config.yml` wiring the two binaries together
  (`mcp_entry: ["./quay-native", "mcp"]`) and a `tasks/` directory.

```sh
tar xzf quay-sea-0.3.4-linux-x64.tar.gz
cd <extracted-dir>
./quay --help
./quay serve
```

No `npm install`, no Node.js on `PATH`, nothing beyond the extracted
archive is required. This is verified on every release by a dedicated CI
job (`sea-verify-node-free` in `.github/workflows/release.yml`) that
downloads the just-published Linux archive into a `debian:stable-slim`
container that has never had Node.js installed, and runs the extracted
binary directly — proving the executable is genuinely self-contained, not
merely "the build succeeded locally."

Build the SEA binaries yourself from source:

```sh
bash packages/quay/scripts/build-sea.sh          # -> packages/quay/dist-sea/quay
bash packages/quay-native/scripts/build-sea.sh   # -> packages/quay-native/dist-sea/quay-native
```

## Running the test suite

```sh
node --test packages/quay/test/*.test.mjs
```

Some tests (any spawning `--provider github`) additionally require an
authenticated `gh auth status` session with read access to `yaleh/quay`.

## License

MIT — see [`LICENSE.md`](LICENSE.md).
