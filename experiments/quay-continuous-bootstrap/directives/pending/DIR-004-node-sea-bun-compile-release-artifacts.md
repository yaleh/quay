# DIR-004 (carried forward from experiment 3)

- status: pending
- priority: **URGENT — dedicated iteration requested** (added 2026-07-17, see "Priority amendment" below)
- created_by: human (Yale Huang), via experiment 3's pending directive
- created_at: 2026-07-17 (originally filed in experiment 3)
- experiment-3-origin: experiments/quay-webui-bootstrap/directives/pending/DIR-004-node-sea-or-bun-compile-release-artifacts-via-github-actions.md
- carried-forward-at: experiment 4 iteration 0 (2026-07-17), per protocol §8 and DIR-007 action 4
- scope-change: DEFERRED under experiment 3 (out-of-scope for Web-UI-only objective). Now IN SCOPE under experiment 4's whole-project objective (protocol §3). Status changes from "deferred, out of scope" to "pending, in scope, not yet prioritized."
- title: Adopt Node SEA or Bun compile for release artifacts; require a GitHub Actions workflow to build and publish them

## Priority amendment (2026-07-17)

- amended_by: human (Yale Huang), asserted directly in this live conversation
- Iterations 4 through 8 have each acknowledged this directive and deferred it
  every time (most recently iteration 8: "packaging scope larger than this
  iteration's MCP focus. Will be addressed in a future iteration dedicated to
  CB-008") — reasonable per-iteration judgment, but the net effect is 8+
  iterations with zero progress on this directive.
- **The human is now explicitly requesting this be prioritized and executed
  in its own dedicated iteration as soon as possible**, rather than continuing
  to be deferred in favor of other gap-list work. This does not override the
  applying iteration's own judgment on implementation details (which of SEA
  vs. Bun, which platforms first, etc. — see "Requested action" below,
  unchanged) — it overrides only the *scheduling* deferral.
- This amendment does not change the directive's Finding or Requested action
  sections below, which remain as originally filed.

## Finding (verbatim from experiment 3's DIR-004)

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

## Requested action (inherited verbatim from experiment 3's DIR-004)

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
   toward** — under experiment 4's dimensions, this is `capability_breadth`
   (a reasonable user of quay should be able to install and run it without
   requiring a separately-installed Node.js runtime; this is a gap in the
   currently-known capability surface).

6. Record the resolution of this directive (applied/deferred/rejected,
   with evidence) in whichever iteration first acts on it.

## Resolution
<!-- to be filled in by whichever iteration applies it -->
