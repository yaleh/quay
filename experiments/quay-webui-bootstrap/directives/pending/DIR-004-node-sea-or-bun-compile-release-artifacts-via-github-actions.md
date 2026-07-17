# DIR-004

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-17
- title: Adopt Node SEA or Bun compile for release artifacts; require a GitHub Actions workflow to build and publish them

## Finding

In this conversation, the human asked for an analysis of whether `packages/quay`'s
current implementation language (plain Node.js/ESM) is suitable for future
multi-platform installation and deployment, and what would be better suited
to broad distribution.

Investigation of the actual code (not assumption) found:
- `packages/quay/package.json`: `"type": "module"`, dependencies are exactly
  two pure-JS packages — `@modelcontextprotocol/sdk` and `yaml` — with
  **no native bindings** (no node-gyp, no prebuilt native addons).
- Root `package.json`: `"engines": { "node": ">=20" }`, npm workspaces.
- `packages/quay/bin/quay.js` is the CLI entrypoint (`#!/usr/bin/env node`),
  wired via `"bin": { "quay": "./bin/quay.js" }`.

Because there are no native dependencies, this codebase is unusually
well-suited to packaging as a single-file executable without a rewrite.
The human's conclusion, reached in this conversation, was:

- Keep the Node.js implementation (rewriting in Go/Rust is not justified —
  low ROI given the current dependency footprint and the MCP SDK's TS/JS-first
  ecosystem maturity vs. Go's less mature MCP SDK support).
- Instead, close the actual distribution gap — requiring end users to
  install Node.js themselves — by producing **single-file executables** via
  either:
  - Node's built-in **SEA** (Single Executable Applications, available
    Node ≥20, matching the existing `engines.node` floor), or
  - **Bun compile** (or Deno compile) as an alternative toolchain, if it
    proves smoother for this dependency set.
- Automate this via **GitHub Actions**: a workflow that builds the
  executable(s) for the target platforms and publishes them as release
  artifacts, rather than relying on manual/local builds.

This directive is a **forward-looking scope addition** for whichever
iteration next takes up packaging/distribution concerns — it is not itself
a claim that current V_instance factors (`ui_read_capability`,
`visual_design_quality`, `verified_by_construction`, `backlog_health`) are
unmet. No iteration has attempted packaging work yet as of this directive.

## Requested action

1. **Do not rewrite the implementation language.** The existing Node.js/ESM
   codebase in `packages/quay` should be kept as the source of truth; this
   directive is about the *release artifact* produced from it, not the
   source language.

2. **Add a build step producing single-file executables** for at least
   Linux, macOS, and Windows, using Node SEA or Bun compile (whichever the
   applying iteration finds actually works cleanly for this dependency set
   — record which was chosen and why, including any blockers hit with the
   other option).

3. **Add a GitHub Actions workflow** (e.g.
   `.github/workflows/release.yml` or similar) that:
   - builds the executable(s) for each target platform,
   - runs on tagged releases (or another concrete, stated trigger — the
     applying iteration should pick and record the trigger, e.g. `on:
     push: tags: ['v*']`),
   - publishes the built artifacts to GitHub Releases (or another concrete,
     stated distribution channel — do not leave the publish target vague).

4. **Verify the produced executable actually runs** the CLI and `serve`
   subcommands without a separately-installed Node.js runtime present, on
   at least one platform, with evidence recorded (not just "the build
   succeeded").

5. **Record which V_instance factor, if any, this work should be credited
   toward** (or whether it constitutes a new, distinct concern outside the
   current four factors — e.g. a deployment/distribution dimension) when
   the applying iteration picks this up. This directive does not itself
   assert which factor it belongs to.

6. Record the resolution of this directive (applied/deferred/rejected,
   with evidence) in whichever iteration first acts on it.

## Resolution

**Status**: DEFERRED — iteration 3, 2026-07-17

**Rationale**: This directive is packaging/distribution scope, outside the current experiment's four V_instance factors (ui_read_capability, visual_design_quality, verified_by_construction, backlog_health). Iteration 3's scope is Web UI functional capability and visual quality. Applying this directive would require substantial work (Node SEA build pipeline, GitHub Actions workflow, cross-platform verification) that does not advance any current factor. Per the directive's own §5, which factor this belongs to is not yet asserted.

**Deferred to**: Future iteration (iteration 4 or later) when distribution/packaging work is prioritized, or when the experiment explicitly designates a packaging factor.
