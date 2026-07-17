# quay

`quay` is a provider-agnostic task board: a small **Core** CLI/MCP client
plus a pluggable **Provider ABI** for where tasks actually live. A task can
be stored as local markdown+frontmatter files, mirrored to GitHub Issues,
or (in principle) backed by any other tracker that implements the same
ABI — `quay` Core doesn't know or care which.

This repository is also the live workspace for a BAIME (Bootstrapped AI
Methodology Engineering) research experiment in which `quay-native`'s own
development backlog is driven, progressively, by `quay-native` itself. See
[**docs/proposals/**](docs/proposals/) below if you want that deeper story —
it is not required reading to install or use `quay`.

## The three packages

| Package | Role | Binary |
|---|---|---|
| [`packages/quay`](packages/quay) | **Core** — provider-agnostic CLI, web UI, and MCP client. Talks to whichever Provider is enabled in `.quay/config.yml` over the Provider ABI. | `quay` |
| [`packages/quay-native`](packages/quay-native) | **Native Provider** (the reference implementation) — a markdown+frontmatter task store on local disk, exposed over both a raw CLI and an MCP server. | `quay-native` |
| [`packages/quay-github`](packages/quay-github) | **GitHub Provider** — maps GitHub Issues onto the same canonical task view-model, proving the ABI transfers to a second, real backend. | `quay-github` |

A task has an `id`, `title`, `status` (`todo` / `ready` / `in-progress` /
`done`, etc. — Provider-defined), `role` (`primitive` or `compound`),
`labels`, `parent`/`children`, and a markdown `body` carrying Proposal /
Plan / AC (Acceptance Criteria) / DoD sections. Every Provider exposes the
same shape; `quay` Core is written against that shape only, never against
a specific backend.

## Install

Requires Node.js >= 20 (this repo is developed against Node v25; see each
package's `package.json` `engines` field for the exact floor).

### Option A — global install from a release artifact (recommended for most users)

Download the latest `quay-*.tgz` from the [GitHub Releases page](https://github.com/yaleh/quay/releases),
then install it globally with npm:

```sh
npm install -g quay-0.2.0.tgz   # replace with the actual filename from the release
quay --help
```

This installs the `quay` binary on your PATH. Node.js >= 20 must already be installed.

### Option B — from source (for development or the latest unreleased changes)

```sh
git clone https://github.com/yaleh/quay.git
cd quay
npm install
```

This is an npm workspaces monorepo (`package.json` `"workspaces": ["packages/*"]`)
— one `npm install` at the repo root wires up all three packages and their
shared dependency tree (`@modelcontextprotocol/sdk`, `yaml`, `zod`).

Each package also has its own binary you can invoke directly with `node`,
which is how every example below is actually run (no global install step
required):

```sh
node packages/quay/bin/quay.js <command>
node packages/quay-native/bin/quay-native.js <command>
node packages/quay-github/bin/quay-github.js <command>
```

## Updating quay

If you update quay (by installing a new release artifact or pulling from source)
while a Claude Code session that registered the `quay` MCP server is already open,
**restart the Claude Code session** for the MCP server to pick up the changes.
The MCP server process is started once when Claude Code launches and does not
auto-restart when the underlying files change. After a restart, the updated tool
schemas and any new parameters will be available to the AI agent.

## Configuration

`quay` Core reads `.quay/config.yml` at the repo root to decide which
Provider(s) are available and how to launch each one's MCP server. This
repository's own config (used to drive its own backlog) looks like this:

```yaml
providers:
  native:
    enabled: true
    path: "./packages/quay-native"
    tasks_dir: "./tasks"
    mcp_entry: ["node", "./bin/quay-native.js", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "./tasks"

  github:
    enabled: false                       # native is the default; select explicitly via --provider github
    path: "./packages/quay-github"
    mcp_entry: ["node", "./bin/quay-github.js", "mcp"]
    env:
      QUAY_GITHUB_REPO: "yaleh/quay"     # owner/repo this Provider reads issues from
```

## Usage

All commands below are real, live-run invocations against this
repository's own task backlog at the time this README was written — not
invented examples.

### `quay` Core CLI

`quay`'s own usage line (this is the literal message printed for an
unrecognized/missing subcommand):

```
usage: quay <task list|view|edit|check|action list|run|serve|mcp> ...
```

List tasks through the active Provider (JSON form, truncated here for
brevity — the real output is the full task list):

```
$ node packages/quay/bin/quay.js task list --json
quay-native mcp: serving tasks from /home/yale/work/quay/tasks
[
  {
    "id": "QN-001",
    "title": "Wire task_write into quay-native CLI/MCP with full frontmatter patch semantics",
    "status": "done",
    "labels": ["v1", "data.write"],
    "parent": null,
    "children": [],
    "role": "primitive",
    "extra": {},
    "body": "..."
  },
  ...
]
```

View a single task, and run its gate check:

```
$ node packages/quay/bin/quay.js task view QN-001
quay-native mcp: serving tasks from /home/yale/work/quay/tasks
QN-001: Wire task_write into quay-native CLI/MCP with full frontmatter patch semantics [done]

## Proposal
...

$ node packages/quay/bin/quay.js task check QN-001
quay-native mcp: serving tasks from /home/yale/work/quay/tasks
QN-001: PASS — terminal
```

`quay task check <id>` is the ABI's **gate**: it asserts a task's
`author -> ready` and `execute -> done` transitions are honestly earned
(e.g. every AC checkbox that claims done is actually backed by evidence),
not merely that the checkboxes are ticked.

`quay serve` starts the web UI; `quay mcp` starts Core's own MCP server,
aggregating every `enabled: true` Provider from `.quay/config.yml` behind
a single MCP endpoint for an agent (e.g. Claude Code) to register once.

### `quay-native` (the reference Provider)

`quay-native`'s own CLI exposes raw local file operations directly
(mainly a convenience/debugging surface — the MCP server, started via
`quay-native mcp`, is the real ABI transport that `quay` Core and
Skill-driven agents actually use):

```
$ node packages/quay-native/bin/quay-native.js task list
QN-001	done	primitive	Wire task_write into quay-native CLI/MCP with full frontmatter patch semantics
QN-002	done	primitive	Build the GitHub Provider (second real backend, proves ABI)
QN-003	done	primitive	Port quay:author orchestration Skill (retire authoring seed dependency)
...
```

```
$ node packages/quay-native/bin/quay-native.js task get QN-001
QN-001: Wire task_write into quay-native CLI/MCP with full frontmatter patch semantics [done]

## Proposal
...
```

```
$ node packages/quay-native/bin/quay-native.js manifest
{
  "id": "native",
  "name": "quay-native",
  "description": "Reference Provider: markdown+frontmatter task store, two-layer Skill set, data-only MCP ABI.\n",
  "capabilities": {
    "data.read": true,
    "manifest": true,
    "data.write": true,
    "gate": true,
    "skill": true
  },
  "statuses": [
    { "id": "todo", "terminal": false },
    { "id": "ready", "terminal": false },
    ...
  ]
}
```

Other `quay-native task` subcommands: `edit` (status/body/labels/etc.
patch), `create`, and `check` (the same gate `quay task check` calls
through the ABI).

### `quay-github` (the second Provider — proves the ABI transfers)

`quay-github` maps GitHub Issues in a configured `owner/repo`
(`QUAY_GITHUB_REPO`, default `yaleh/quay`) onto the same task shape:

```
$ node packages/quay-github/bin/quay-github.js task list
gh-10	done	compound	[QN-037] Epic: live quay:execute Skill-driven compound-recursion end-to-end proof
gh-9	done	primitive	[QN-037-fixture] Child B: primitive leaf under live quay:execute epic-drive test
gh-8	done	primitive	[QN-037-fixture] Child A: primitive leaf under live quay:execute epic-drive test
...
```

It also exposes `task get <id>`, `task edit <id> --status <s>` (status-only
write path, v1), `manifest`, and `mcp` (its MCP server), mirroring
`quay-native`'s shape on whatever subset of the ABI this Provider
implements (v1 is read-primary; write is status-only).

## Running the test suite

```sh
node --test packages/*/test/*.test.mjs
```

This is the same command every iteration of this repository's own
development process uses to self-verify (see `docs/proposals/` for why).

## Deeper design and methodology material

The [`docs/proposals/`](docs/proposals/) directory is **internal experiment
documentation**, not primary user documentation — it captures the design
of the Provider ABI, the native Provider, and (distinctly) the BAIME
bootstrap-experiment protocol under which this repository's own backlog
has been developed. Start with:

- [`docs/proposals/glossary.md`](docs/proposals/glossary.md) — frozen
  vocabulary (Provider, Skill, status, lane, task, run, action button,
  capability) used consistently across the rest of `docs/`.
- [`docs/proposals/quay-proposal.md`](docs/proposals/quay-proposal.md) — the
  original Core/Provider-ABI design proposal.
- [`docs/proposals/quay-native-design.md`](docs/proposals/quay-native-design.md)
  — the native Provider's design (task store, ABI, gate, Skills).
- [`docs/proposals/quay-bootstrap-experiment.md`](docs/proposals/quay-bootstrap-experiment.md)
  — the BAIME self-hosting bootstrap experiment protocol that has driven
  this repository's own iterative development (`experiments/quay-native-bootstrap/` holds its
  running log, provenance ledger, and per-iteration reports).

If you only want to install and use `quay`, you can stop here — none of
`docs/proposals/` is required reading for that.

## License

MIT — see [`LICENSE`](LICENSE).
