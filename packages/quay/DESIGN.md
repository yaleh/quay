# `packages/quay` (Core) — DESIGN

- **Status:** v1 — walking skeleton (Web UI + CLI) plus, as of iteration 26
  (`DIR-007`), a genuine Core-level MCP server, plus, as of iteration 31
  (`QN-042`/`DIR-009`), a deterministic mock/file-log action-delivery mode,
  plus, as of iteration 33 (`QN-044`/`DIR-010`), Core-level CLI/MCP/Web-UI
  three-way symmetry over that same shared capability set.
- **Relates:** `docs/proposals/quay-proposal.md` (esp. §5 architecture), `docs/
  proposals/quay-native-design.md` (Provider-level reference), `docs/proposals/
  glossary.md`.

This file documents the Core (`quay` — the provider-agnostic host: Web UI +
CLI + MCP server) at the level of detail `packages/quay-native/DESIGN.md`
and `packages/quay-github/DESIGN.md` already document their own packages —
it did not exist before iteration 26 and is created now per DIR-007 point 4
("update ... `packages/quay/DESIGN.md` (if one exists)").

## 1. The three sibling consumer-layer bindings

Per proposal §5, Core exposes **three sibling front-ends** over the same
Provider ABI, with **zero backend-specific logic** in any of them:

| Binding | Entry point | File(s) |
|---|---|---|
| Web UI | `quay serve` | `src/serve.js` |
| Core CLI | `quay task/action <...>` | `bin/quay.js` |
| **MCP projection → Agent** | `quay mcp` | `src/mcp-server.js` (new, iteration 26) |

All three are **MCP clients** to whichever Provider(s) are `enabled: true`
in `.quay/config.yml`, via the single, provider-agnostic
`src/provider-client.js#connectProvider()` function. None of the three
special-cases a Provider id in its own dispatch logic (`--provider <id>` /
`provider` tool argument selection is generic, not a `github`-specific
branch anywhere in Core — confirmed by grep, see iteration 4's own
`--provider` flag introduction and iteration 26's own equivalent check for
`mcp-server.js`).

## 2. `quay mcp` — Core's own MCP server (DIR-007)

### 2.1 Why this exists

Proposal §5's architecture diagram names an "MCP projection → Agent" sibling
alongside the Web UI and CLI — the intended mechanism for an Agent (Claude
Code) to drive Quay via **one** MCP connection, regardless of how many
Providers are enabled, instead of registering each Provider's own MCP server
(`quay-native mcp`, `quay-github mcp`, ...) separately in Claude Code. Before
iteration 26 this was a design-doc claim only: `packages/quay/bin/quay.js`
had no `mcp` subcommand, and `provider-client.js` was confirmed (DIR-007's
own finding) to be Core's MCP **client** side only, with no corresponding
server.

### 2.2 What it is

`quay mcp` (`bin/quay.js`'s `mcp` subcommand → `src/mcp-server.js#startMcpServer()`)
is simultaneously:

- **(a) an MCP server** — the surface an Agent connects to, using the same
  `McpServer` + `StdioServerTransport` SDK usage already established by
  `quay-native`'s and `quay-github`'s own `mcp-server.js` files;
- **(b) an MCP client (fan-out)** — for each Provider currently
  `enabled: true` in `.quay/config.yml`, it lazily connects to that
  Provider's own MCP server via `provider-client.js#connectProvider()`
  (**zero changes** to that file were required — it was already fully
  provider-agnostic), caching and reusing each connection, and closing all
  of them together when the Core server's own stdio transport closes.

### 2.3 Multi-Provider disambiguation (DIR-007 point 2 — explicit decision)

Every proxied tool (`task_list`, `task_get`, `task_write`, `task_check`)
takes an **optional `provider` argument**:

- Omitted → resolves to the **first `enabled: true` Provider** in
  `.quay/config.yml`'s `providers` map (same default-selection rule
  `bin/quay.js`'s own `withProvider()`/`activeProvider()` already use for
  the CLI's `--provider` flag — reused via `config.js#activeProvider()`,
  not reimplemented).
- Provided → routes to that specific Provider id; an id that is not
  currently `enabled: true` returns `isError: true` naming the actual
  enabled-Provider set (not a crash, not a silent fallback).

**Alternative considered and rejected:** per-Provider tool-name namespacing
(e.g. `task_list__github`, `task_list__native`). Rejected because it would
require an Agent to already know the full enabled-Provider set before it
could call `task_list` at all — the opposite of proposal §5's stated goal
("adding a Provider requires zero consumer-layer changes"). The
argument-based scheme keeps the tool surface identical in shape to each
Provider's own `task_list`/`task_get`/`task_write`/`task_check` tools (design
§6's CLI/MCP symmetry principle, lifted one layer: Core's MCP tools are
byte-shape-identical to a Provider's own, plus one optional field), so an
Agent already using a single-Provider workspace's tool calls needs zero
changes when a second Provider is later enabled.

`provider://manifest` resources are handled differently from the four tools,
because MCP resources are identified by URI, not by a call-time argument:

- `provider://manifest` — an **alias** resolving to the default-enabled
  Provider's manifest (symmetry with the single-Provider case).
- `provider://manifest/<id>` — one real, individually-enumerable resource
  **per currently-enabled Provider**, so an Agent can discover every enabled
  Provider's own manifest via MCP's own resource-listing mechanism, without
  first needing another tool call to learn how many Providers exist.

### 2.4 Live verification (iteration 26)

Verified end-to-end against **both real Providers already in this repo**
(native + github, the latter against the real, live `yaleh/quay` GitHub
repository — `gh auth status` confirmed `yaleh`, scopes `repo`+`workflow`,
before any live call):

1. `quay mcp` spawned as a real subprocess; a real `Client` +
   `StdioClientTransport` connected to it (same pattern as
   `abi-symmetry.mjs`'s own client-side usage).
2. `.quay/config.yml`'s `github` provider entry was temporarily flipped to
   `enabled: true` for the duration of this live check (native's own
   `enabled: true` was untouched), so both Providers were simultaneously
   live-reachable through the one `quay mcp` endpoint — the genuine
   multi-Provider aggregation proof DIR-007 point 2 requires. Restored to
   its original `enabled: false` state immediately afterward (`git diff
   .quay/config.yml` confirmed clean before this iteration's commit).
3. `provider://manifest`, `provider://manifest/native`,
   `provider://manifest/github` all resolved correctly (`id: "native"` /
   `id: "github"` respectively).
4. `task_list`/`task_get`/`task_check` with `provider: "github"` against the
   real `gh-7` compound/epic task (the durable fixture created by iteration
   25's QN-035) returned results **byte-identical** to calling
   `quay-github mcp` directly with the same tool/arguments — confirmed via
   `JSON.stringify(...) === JSON.stringify(...)` comparison of
   `structuredContent`, for both `task_check gh-7` (compound-gate result,
   including its `childrenStatus` array) and the native-side equivalent
   (`task_get`/`task_check` against a native task, cross-checked against
   `quay-native mcp` called directly).
5. Error paths: an unknown/non-enabled `provider` argument returns
   `isError: true` naming the actual enabled set (not a crash); an unknown
   task id returns `isError: true` (not a crash).
6. A committed regression test,
   `packages/quay/test/mcp-server.test.mjs` (13 assertions, `node
   test/mcp-server.test.mjs` exits 0), reproduces the same aggregation proof
   using two fully local, isolated native task stores configured as two
   distinct enabled Providers (`native` / `native-2`) — chosen so the
   automated suite has **zero external-network dependency** (consistent with
   this package's existing test-isolation conventions, e.g.
   `cli.test.mjs`/`serve.test.mjs`), while the live native+github check
   above (hand-run this iteration, not part of the automated suite) is the
   evidence that the same code path also genuinely works against a real,
   heterogeneous second backend.

### 2.5 Known gaps (named honestly, not silently claimed as covered)

- ~~`mcp-server.js`'s own stdio transport lifecycle under a real Claude Code
  session (i.e., actually registering `quay mcp` as an MCP server in a live
  Claude Code configuration and driving a real conversation through it) has
  **not** been exercised this iteration — only a standalone Node MCP client,
  same limitation already named for `quay-native`'s/`quay-github`'s own MCP
  transports in iterations 24-25's problems lists.~~ **Closed in stages
  (iteration 28, then iteration 36; QN-038, QN-047).** Iteration 26
  (QN-036) built `quay mcp`; iteration 28 (QN-038) registered it as a real
  project-scoped MCP server (`claude mcp add`, producing the committed
  `.mcp.json`) and wire-protocol-verified it via a bespoke external
  script — but that iteration, and iterations 29-30 after it, each
  honestly left one residual open: Claude Code's own MCP-server approval/
  discovery happens only at a session's *own startup*, so no
  already-running top-level session could ever self-verify that a fresh
  session's own `ToolSearch`/tool-call actually discovers and invokes
  `quay`'s tools through its own initialized MCP client — writing
  `.mcp.json` mid-session does not retroactively register it for that
  same session. Iteration 36 (QN-047) closed this residual: a genuinely
  separate, freshly-started, non-interactive Claude Code process
  (`claude -p`, headless) was launched against this project; its own MCP
  client discovered the real `mcp__quay__*` tool names
  (`task_list`/`task_get`/`task_write`/`task_check`/`action_list`/
  `action_run`), and — once `--dangerously-skip-permissions` was
  additionally supplied, since headless mode has no interactive prompt to
  answer the normal per-call permission gate — successfully **called**
  `mcp__quay__task_list({status:"done"})` and returned a real, 41-task
  result whose id set was cross-checked byte-for-byte identical against
  `quay task list --status done --json`'s own output. One narrower piece
  remains honestly open: a fresh session discovering/calling `quay`'s
  tools **without** `--dangerously-skip-permissions` still requires a
  human interactively answering a per-call approval prompt — this cannot
  be closed from a non-interactive harness, and is not claimed as closed.
- ~~`task_write`'s CAS (`expectedStatus`) option is forwarded but was not
  specifically exercised through the Core MCP path this iteration (it was
  already covered end-to-end at the native-Provider level by QN-015); this
  is a thin, generic passthrough with no Core-specific CAS logic, so the
  risk surface is low, but it is named here rather than silently assumed
  covered by transitivity.~~ **Closed (QN-043, iteration 32.)**
  `mcp-server.test.mjs` now live-verifies, against the real `quay mcp`
  subprocess: (a) `task_write` with a matching `expectedStatus` succeeds
  and persists; (b) a mismatched `expectedStatus` returns `isError:true`
  (not a crash) with the error text naming both the expected and actual
  status; (c) a follow-up `task_get` confirms the conflicting write was
  never applied to disk. Zero change was needed to `mcp-server.js`'s own
  runtime code — this was pure passthrough, already correct, now proven
  live rather than assumed correct by transitivity from QN-015's
  native-level coverage.
- ~~The `provider://manifest/<id>` per-Provider resource naming
  (`manifest-${id}` as the MCP resource *name*, distinct from its *uri*) has
  not been checked against any MCP client that enumerates resources by name
  rather than uri; every check performed this iteration used uri-based
  `readResource()` calls.~~ **Closed (QN-041, iteration 30).**
  `mcp-server.test.mjs` now asserts, against a live `quay mcp` subprocess,
  that (a) `listResources()` returns a distinct `name` field
  (`"manifest"` / `"manifest-native"`) alongside each resource's `uri`,
  and (b) `readResource({ name: ... })` (uri omitted) genuinely rejects
  with an MCP protocol-level error rather than silently succeeding — the
  SDK's `resources/read` request is uri-keyed by protocol design; `name`
  is listing/display-only, never a lookup key, confirmed live rather than
  assumed. An adversarial break (making the per-Provider resource's `name`
  collide with its `uri`) reproduced 2 live FAILs; restoring produced a
  byte-identical diff and all PASS again.

## 3. Action-trigger delivery: the mock/file-log mode (`QN-042`/`DIR-009`)

`src/action.js#deliverTrigger()` (proposal §6.4, design §7 — the host-owned
trigger edge, NOT part of the Provider ABI) has three delivery modes, tried
in this order:

1. **`mock`** (new, iteration 31) — selected when the caller supplies an
   explicit `mockLogPath` (threaded from the `QUAY_ACTION_MOCK_LOG`
   environment variable by both `bin/quay.js`'s `action run` subcommand and
   `serve.js`'s POST action-button handler). Appends one structured
   JSON-lines record (`{channel, payload, taskId, status, skill, timestamp}`)
   to that file, creating its parent directory if needed, and returns
   `{ delivered: "mock", channel, mockLogPath, record }` — distinguishable
   from both other modes' return shapes.
2. **`manda`** — unchanged from prior iterations: if `mandaAvailable(root)`
   and no `mockLogPath` was supplied, sends the composed payload via `manda
   send <channel> <json>`, returns `{ delivered: "manda", channel }`.
3. **print (degrade)** — unchanged: logs the composed command to stdout for
   manual/agent execution, returns `{ delivered: "print" }`.

**Why this exists:** prior to iteration 31, the only non-`manda` path was
the stdout-print degrade — there was no deterministic, file-based record an
automated test could assert against, so any test of action-composition/
delivery logic either had to scrape freeform stdout text or skip verifying
delivery entirely. The mock mode is intended as the **default harness for
automated verification** of action-composition logic; live `manda`
delivery remains a separate, additional, non-gating check (see
`docs/proposals/quay-core-scope-expansion-discussion.md` §2.3 for the
original reasoning, and `experiment/directives/archive/DIR-009-*.md` for
the directive that requested it).

**Explicitly additive, not a replacement:** `mandaAvailable()`'s own
detection logic was not touched at all (`git diff --stat` for this task
shows zero lines changed in that function); the existing `manda` and
print-degrade paths' behavior is unchanged — `mockLogPath` is opt-in only,
selected exclusively when the caller explicitly supplies it.

**Regression-test discipline (network-independent, not manda-gated):**
`packages/quay/test/action-mock-delivery.test.mjs` exercises the mock mode
end-to-end (composes a real payload via `composePayload()`, calls
`deliverTrigger()` with `mockLogPath` set, asserts on the resulting file's
structured JSON-lines content — including that a second delivery appends
rather than overwrites). Per `DIR-008`'s standing constraint (itself citing
`experiment/directives/archive/DIR-004-*.md`/`DIR-005-*.md`'s iterations
13-18 findings), this test does **not** gate its own pass/fail on live
manda-send reachability succeeding or failing either way — a run of this
very test during iteration 31's own execution independently reconfirmed
that finding: `mandaAvailable()`'s health check and the subsequent `manda
send` call were each observed, across repeated runs in the same sandbox, to
sometimes succeed and sometimes fail (a live connection-refused error, and
separately a transient `spawn manda ENOENT`) — live manda reachability
remains a per-session, per-moment fact, exactly as already documented, and
this mode's whole purpose is to sidestep that for automated verification,
not re-litigate or depend on it.

## 4. Core-level three-way symmetry (`QN-044`/`DIR-010`)

### 4.1 The contract

Proposal §5 (line 54) states the requirement this section documents: "Three
sibling front-ends over the same Provider ABI: **Web UI**, **Core CLI**
(`quay`), and an **MCP projection** for agents — **one capability set, three
bindings**." §9 (line 235) restates it directly: "The Web UI is **the same
capability set** with a web binding." §9 itself lists the literal scope of
that shared capability set (lines 226-230): `serve` (Web UI), `task list`,
`task view`, `action list`, `action run` — in this document's own terms:

1. **task-list rendering** — enumerate tasks and their id/title/status.
2. **task-detail rendering** — show one task's id/title/status/body.
3. **action-button triggering** — list the action buttons applicable to a
   task's current status, and trigger one.

This is a **different symmetry claim** from design §6's principle P3
(`packages/quay-native/DESIGN.md`, enforced by
`packages/quay-native/test/abi-symmetry.mjs`): P3 is explicitly
**Provider-scoped** (`quay-native`'s own CLI vs. its own MCP tools) and
explicitly excludes the Web UI (`quay-native-design.md` P2: "Web is a *Core*
concern"). §5/§9's three-way claim is a **Core-level** claim across all
three of Core's own bindings, including the Web UI -- a claim P3 never made
and `abi-symmetry.mjs` never tested.

**Explicitly out of scope for this contract:** `task edit` and `task check`.
Both were added to the Core CLI later (`QN-024`, `QN-027`), after §9's own
example block was written, and neither was ever proposed for the Web UI.
Their absence from the Web UI is correctly **not** a symmetry gap against
this contract -- asserting it as one would be testing a requirement that was
never written.

### 4.2 What closed the gap (DIR-010 item 1)

Before iteration 33, Core MCP (`src/mcp-server.js`, DIR-007) registered only
`task_list`/`task_get`/`task_write`/`task_check` -- no `action_list` or
`action_run` tool existed, even though both are part of §9's own listed
capability set. An Agent connected only via `quay mcp` could not list or
trigger action buttons; the CLI and Web UI could. This was the one concrete,
checkable gap against the actual written requirement (as opposed to
`task edit`/`task check`, which were never claimed).

`action_list` and `action_run` were added to `src/mcp-server.js`, mirroring
the existing four tools' shape exactly (optional `provider` argument, same
`isError: true`-on-failure convention, no crash on an unknown task or action
id). `action_run` accepts an optional `mockLogPath` argument selecting the
deterministic mock/file-log delivery mode (§3 above, `QN-042`/`DIR-009`)
instead of live manda -- the same contract `QUAY_ACTION_MOCK_LOG` already
selects for the CLI and Web UI, reused rather than reintroducing a
live-manda dependency into this new surface's own regression test.

### 4.3 Enforcement mechanism

`packages/quay/test/core-three-way-symmetry.test.mjs` is the checkable test
for this contract (analogous in spirit to `abi-symmetry.mjs`, but scoped to
Core's three bindings rather than one Provider's two). For each of the three
capabilities above, it asserts:

- the capability exists in the Core CLI (`bin/quay.js`, spawned as a real
  subprocess);
- the capability exists as a Core MCP tool (`quay mcp`, spawned as a real
  subprocess, driven by a real MCP client);
- the Web UI's own rendering/handling of that capability (`src/serve.js`'s
  `startServer()`, driven by real HTTP requests -- no browser automation; see
  the test file's own header comment for why that is out of scope here)
  produces content consistent with what the CLI/MCP legs return, for the
  same fixture task.

All three legs are checked against **the same isolated, temporary native
Provider task store** for one fixture task, so the comparison is genuine
(same underlying data) rather than incidental. The test does not assert
anything about `task edit`/`task check`'s absence from the Web UI, per §4.1.

A future capability added to only one of the three surfaces (e.g., a new
Core MCP tool with no CLI or Web UI equivalent, or vice versa) will make
this test fail rather than pass silently, as long as that capability falls
within §9's own listed set -- the same enforcement guarantee `abi-symmetry.mjs`
already provides one layer down, at the Provider level.

### 4.4 A discovered, pre-existing asymmetry (named at iteration 33, fixed at iteration 34)

While building the test above, an honest discrepancy surfaced in how the
three bindings' own launcher code resolves a Provider's task-store
location: `serve.js`'s `startServer()` read `provider.tasks_dir` (a
top-level `.quay/config.yml` field) directly, while `bin/quay.js`'s CLI
dispatch and `mcp-server.js` both resolved it via
`resolveProviderEnv(cfg, provider)`, which reads only `provider.env`'s map
-- **not** the top-level `tasks_dir` field. A workspace config that set
only one of the two conventions would silently serve a *different* task
store to the Web UI than to the CLI/MCP legs. This was a real,
pre-existing config-resolution asymmetry, distinct from the
capability-set symmetry this section documents and DIR-010 asked to be
verified -- it was not something DIR-010 asked to be fixed, so it was not
silently patched at iteration 33; it was named there as a gap for a
future directive/task.

**Update (iteration 34, QN-045):** this gap has since been closed. The
duplicated `resolveProviderEnv(cfg, provider)` logic (previously
byte-identical in `bin/quay.js` and `mcp-server.js`) was extracted into a
single shared module, `packages/quay/src/provider-env.js`, and
`serve.js`'s `startServer()` was updated to call the same shared function
instead of reading `provider.tasks_dir` directly. All three Core bindings
now resolve a Provider's task-store location the same way. A dedicated
adversarial regression test,
`packages/quay/test/provider-env-symmetry.test.mjs`, proves this: it sets
`tasks_dir` to an empty decoy directory and `env.QUAY_NATIVE_TASKS_DIR` to
the real, seeded directory, and confirms the Web UI serves from the
`env`-named directory, matching the CLI leg, not the decoy.
