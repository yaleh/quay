---
id: exp5-M-NODE-FLOOR-DISTRIBUTION-FIX
title: Fix .ts-entrypoint × Node-floor distribution regression (DIR-060,
  release-blocking)
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: null
children: []
extra:
  schema: v1
---
## Proposal

DIR-060 found (2026-07-23, during an actual release attempt) that the M116 `bin/*.js` → `bin/*.ts`
migration (commit `3667b02`) broke distribution: `.ts` shebang entrypoints require Node's native
type-stripping, which needs Node >= 23 (22.6+ behind a flag), but this project declares and CI/release
pin a Node >= 20 floor. The real `v0.3.5` release attempt failed on exactly this
(`ERR_UNKNOWN_FILE_EXTENSION ".ts"` on Node 20). Local dev (Node 25 on this host) never surfaced it —
this was only caught by an actual out-of-band CI run on the real declared floor, exactly the kind of
independent verification channel this repo's domain-misfit audit-channel discipline calls for.

Direction chosen for this milestone: **(a) transpile-on-publish** (DIR-060's lower-blast-radius
default) — keep authoring in `.ts`, but ship `.js` (via esbuild, already used by the SEA build path)
in the npm-pack tarball and the plugin's vendored Core, so distributed bins run on Node >=20 unchanged.
This avoids raising the floor for every downstream consumer (archguard's own `engines` is `>=18`).

Scope:
1. Add a build step (reuse `esbuild-sea.mjs`'s existing esbuild dependency, or a lighter sibling
   script) that transpiles each package's `bin/*.ts` (and any `.ts` it imports) to plain `.js` for the
   npm-pack tarball — output format ESM (not the SEA path's CJS), so `import.meta.url` etc. keep
   working unmodified.
2. Wire this into `.github/workflows/release.yml`'s npm-pack job, replacing the direct `.ts` shebang
   reference with the transpiled `.js` output.
3. Update `plugin/scripts/sync-vendor.sh` to transpile (not just `cp`) when vendoring Core into the
   plugin, so the NEXT plugin publish ships runnable `.js`, not `.ts`.
4. Add a runnable floor-check CI job: build the npm-pack artifact, run it under the DECLARED floor
   Node version (20), execute `quay --help` + `task list` — PASS iff exit 0. This is the mechanical
   guard that would have caught this regression before a real release attempt did.
5. Dry-run the release workflow (a pre-release tag or `workflow_dispatch`) and confirm the `release`
   job (npm-pack test + build + upload) is GREEN — pasted run URL, not asserted.

**Explicitly out of scope (per DIR-060's own cross-link):** `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH`
(the SEA binary's separate `import.meta.url`-in-CJS-bundle crash) — a different defect in the same
neighborhood, not fixed here. `docs/proposals/quay-perpetual-stream-experiment-v5.md`
`DIR-061`'s full productized-delivery scope (manifest, version-unification, foreign-workspace install)
— DIR-061 explicitly depends on THIS directive landing first; not this milestone's scope.

## Plan
N/A — mechanical build-step addition (esbuild transpile, reusing the existing SEA build's toolchain),
plus one new CI job. No design doc needed; direction (a) vs (b) is the design decision, already made
and justified above per DIR-060's own analysis.

## Acceptance Criteria
- [ ] `grep -rIl 'bin/quay\(-native\|-github\|-backlog\)\?\.ts' .github/workflows/ plugin/.mcp.json` returns no MATCH (distributed configs reference `.js`, not `.ts`).
- [ ] A CI job builds the `npm pack` tarball and runs `quay --help` under the declared-floor Node version (20), exiting `0` — pasted job log.
- [ ] The `Release` workflow (or a `workflow_dispatch` dry-run) completes with the `release` job (npm-pack test + build + upload) GREEN — pasted run URL/status. (SEA jobs MAY still be red on `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` — out of this milestone's scope, must be noted not silently passed.)
- [ ] `node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')` stays green locally before/after (golden-diff, no product-behavior change from the build-step addition).

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence). Per DIR-026 Reading A: NOT done when the workflow YAML
merely references `.js`, or a floor-check script merely exists — necessary-not-sufficient. Done ONLY
when a REAL release-workflow run has executed the new floor-check and the `release` job's npm-pack
path GREEN, with the run URL + floor-check job log pasted into the Resolution.
- [ ] All 4 AC items above verified true with pasted command output (including the real run URL).
- [ ] it0 DoD meta-enforcer passes all clauses.
- [ ] DIR-060 dispositioned `applied` with this task's completion evidence cited in its own Resolution.
