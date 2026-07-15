# DIR-007

- status: pending
- created_by: human (Yale), asserted directly in this live conversation
- created_at: 2026-07-15
- title: Implement the Core's own MCP server ("MCP projection → Agent") — quay's `mcp` subcommand

## Finding

`docs/proposal/quay-proposal.md` §5's architecture diagram declares three
sibling consumer-layer front-ends over the Provider ABI: Web UI, `quay`
CLI, and an **"MCP projection → Agent"** — with the Core (`quay`) acting as
the single MCP endpoint agents (Claude Code) connect to, which then
internally fans out as an MCP **client** to each enabled Provider's own MCP
server (per `.quay/config.yml`'s `mcp_entry` entries). This is the intended
mechanism for supporting multiple Providers without requiring separate
per-Provider MCP registration in Claude Code.

A direct check of the repository, performed in this conversation, confirms
this consumer-facing MCP server does **not exist**:

```
$ grep -rln "McpServer\|StdioServerTransport" packages/*/src packages/*/bin
packages/quay-github/src/mcp-server.js
packages/quay-native/bin/quay-native.js
packages/quay/src/provider-client.js
packages/quay-native/src/mcp-server.js
packages/quay-github/bin/quay-github.js
```

Only `quay-native` and `quay-github` have real MCP **server**
implementations. `packages/quay/src/provider-client.js` is confirmed (by
reading its source and header comment) to be the Core's MCP **client**
side only — used internally by `serve.js`/`quay.js` to talk to whichever
Provider is active. There is no `packages/quay/src/mcp-server.js` or
equivalent, and `quay`'s CLI (`packages/quay/bin/quay.js`) has no `mcp`
subcommand at all (confirmed: only `quay-native` and `quay-github` expose
an `mcp` subcommand today).

Practical consequence, also discussed in this conversation: today, the
only way for Claude Code (or any MCP client) to drive quay via MCP is to
register each Provider's own MCP server (`quay-native mcp`,
`quay-github mcp`) **separately** — there is no proxy/gateway layer to
verify or exercise, and no way to test the "adding a Provider requires
zero consumer-layer changes" claim from `quay-proposal.md` §5, since the
consumer layer that claim describes has never been built.

## Requested action

A future iteration should implement `quay`'s own MCP server — the "MCP
projection → Agent" binding named in `quay-proposal.md` §5 — as a genuine,
live-verified capability, not merely a design-doc claim:

1. Add an `mcp` subcommand to `packages/quay/bin/quay.js` (paralleling the
   existing `quay-native mcp` / `quay-github mcp` subcommands), backed by a
   new `packages/quay/src/mcp-server.js` (or equivalent) that starts a real
   MCP server (`McpServer` + `StdioServerTransport`, matching the SDK usage
   already established in `quay-native`/`quay-github`'s own server files).
2. This server must genuinely proxy/aggregate: for each Provider currently
   `enabled: true` in `.quay/config.yml`, the Core connects to that
   Provider's own MCP server as a client (reusing
   `packages/quay/src/provider-client.js`'s existing `connectProvider()`)
   and exposes the aggregated `task_list`/`task_get`/`task_write`/
   `task_check`/`provider://manifest` surface back out over its own MCP
   server — with an explicit, documented decision on how multi-Provider
   tool/resource naming or routing is disambiguated (e.g. a `provider`
   argument on each tool, or per-Provider-namespaced tool names) rather
   than silently assuming single-Provider use.
3. Live-verify this end-to-end against the two real Providers already in
   this repo (native + github), the same evidentiary standard already
   established for other quay-github/quay-native capabilities (QN-028,
   QN-029, QN-033, QN-034): spawn `quay mcp` as a real subprocess MCP
   server, connect a real MCP client to it, and confirm it correctly
   proxies `task_list`/`task_get`/`task_check` (and `provider://manifest`)
   calls through to both the native and github Providers' own live MCP
   servers, with results matching what calling each Provider's `mcp`
   subcommand directly would return.
4. Update `docs/proposal/quay-proposal.md` / `packages/quay/DESIGN.md` (if
   one exists) to reflect the now-implemented consumer-layer MCP surface,
   and record the task(s) in `provenance.md` so it counts toward
   `abi_symmetry`/`skeleton` (V_instance) and toward genuinely testing the
   "adding a Provider needs zero consumer-layer changes" architectural
   claim (V_meta `reusability`'s own underlying premise).
5. If, on inspection, a specific design sub-question (e.g. multi-Provider
   tool namespacing) turns out to need a decision this directive doesn't
   settle, the iteration should make and record an explicit, reasoned
   choice — not defer implementation entirely on that basis alone.

## Resolution

- **resolved_by:** iteration 26
- **outcome:** applied in full
- **task:** `tasks/QN-036.md` (native lifecycle: `todo → ready → done`,
  provenance `{author_by: native, execute_by: native, gate_by: native}`)

All 5 requested actions completed and live-verified:

1. **`mcp` subcommand added to `packages/quay/bin/quay.js`**, backed by a
   new `packages/quay/src/mcp-server.js`, starting a genuine MCP server
   (`McpServer` + `StdioServerTransport`, matching the SDK usage already
   established in `quay-native`/`quay-github`'s own server files).
2. **Genuine proxy/aggregation implemented**: for each Provider currently
   `enabled: true` in `.quay/config.yml`, Core connects to that Provider's
   own MCP server as a client, reusing `provider-client.js#connectProvider()`
   **unmodified**, and exposes the aggregated `task_list`/`task_get`/
   `task_write`/`task_check`/`provider://manifest` surface back out over
   its own MCP server. Multi-Provider disambiguation resolved via an
   explicit, documented decision: every proxied tool takes an **optional
   `provider` argument** (default: first `enabled: true` Provider) rather
   than per-Provider tool-name namespacing — see `packages/quay/DESIGN.md`
   §2.3 for the rejected-alternative rationale.
3. **Live-verified end-to-end against both real Providers in this repo**:
   `quay mcp` spawned as a real subprocess, a real MCP client connected to
   it, confirming `task_list`/`task_get`/`task_check` (and
   `provider://manifest`) proxy correctly through to both native and github
   (the latter against the real, live `yaleh/quay` repository, including
   the real compound/epic fixture `gh-7` from iteration 25's QN-035), with
   results byte-identical (`JSON.stringify(...) === JSON.stringify(...)` on
   `structuredContent`) to calling each Provider's own `mcp` subcommand
   directly. `.quay/config.yml`'s `github.enabled` was temporarily flipped
   to `true` only for the duration of this live check, then restored (`git
   diff .quay/config.yml` confirmed empty before commit). A committed,
   network-independent regression test (`packages/quay/test/
   mcp-server.test.mjs`, 13 assertions) reproduces the same proof using two
   isolated local native task stores as a permanent, CI-safe equivalent.
4. **`docs/proposal/quay-proposal.md` §5 updated** (implementation-status
   note appended after the architecture diagram) and **`packages/quay/
   DESIGN.md` created** (did not exist before this task) documenting the
   full design and live-verification transcript. `experiment/provenance.md`
   updated with QN-036's provenance record and σ recomputation — this now
   counts toward `abi_symmetry`/`skeleton` (V_instance) and toward
   genuinely testing the "adding a Provider needs zero consumer-layer
   changes" architectural claim (V_meta `reusability`'s own underlying
   premise, since Core's MCP server itself required zero
   Provider-specific branching to support a second, heterogeneous
   Provider).
5. **No sub-part proved infeasible or under-specified enough to defer.**
   The one genuine design sub-question DIR-007 itself flagged as possibly
   needing a decision (multi-Provider tool/resource naming or routing) was
   resolved explicitly (argument-based tool routing; alias +
   per-id-namespaced resource URIs) and recorded, per point 5's own
   instruction, rather than left to block implementation.

See `experiment/iterations/iteration-26.md` for the full execution
transcript, V_instance/V_meta scoring, and honest gap analysis (including
what this task does **not** yet cover, e.g. exercising `quay mcp` from
inside a real live Claude Code session's own MCP client registration,
which remains untested — a standalone Node MCP client stands in for that
this iteration, the same standing limitation already named for
`quay-native`/`quay-github`'s own MCP transports).
