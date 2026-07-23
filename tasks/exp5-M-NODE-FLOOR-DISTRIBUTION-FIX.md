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
  proposalStatus: revised-post-review
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-NODE-FLOOR-DISTRIBUTION-FIX
    experiments/quay-perpetual-stream/charters/M120-node-floor-distribution-fix.md
    /tmp/m120-absorb-entry.md
---
## Proposal

Source: adjudicated, 2026-07-23, minimal-surface-area + pattern-consistency; **revised post-architect-review** (2026-07-23) to address a confirmed blocking finding.

Problem framing: The M116 `.ts`-entrypoint migration made every package's CLI a `.ts` file run
directly via shebang, which only Node >=23 (or 22.6+ behind a flag) can execute natively (native
type-stripping), while `package.json` `engines`, `ci.yml`, and `release.yml` all pin/declare Node
>=20. This is two independent failures from the same root cause: (a) the actually-distributed
surfaces — the npm-pack tarball's `bin` field and the plugin's vendored `.mcp.json`, which still
point straight at `.ts` — fail with `ERR_UNKNOWN_FILE_EXTENSION` on a real Node-20 install (the real
`v0.3.5` release attempt's failure); and (b) this repo's own CI/release "Run tests" step spawns
`bin/*.ts` as a real subprocess in ~15+ test files under a Node-20 runner, which fails regardless of
any packaging fix. `plugin/vendor/quay/bin/` is currently STALE — its own `quay.js` predates the
M116 rename (last synced at commit `093a912`), while `plugin/.mcp.json` already references
`vendor/quay/bin/quay.ts`, a file that does not exist in the vendor tree today — `sync-vendor.sh`
simply has not been re-run since M116; the plugin is not "accidentally safe," it is currently
broken in a different, undiscovered way (confirm actual state via `git log -- plugin/vendor/quay`
before diffing against it). Local dev (Node 25 on this host) never surfaced any of this; it was only
caught by an actual out-of-band CI run on the real declared floor. Direction (a) — transpile-on-
publish, not raise the floor — is already chosen (DIR-060's lower-blast-radius default, avoiding
pushing the constraint onto every downstream consumer, e.g. archguard's own `engines: >=18`); this
proposal is the mechanics.

Approach: Generalize the one bundling mechanism this repo already has and has already proven for
exactly this class of problem — `packages/quay/scripts/esbuild-sea.mjs` (esbuild, single
self-contained bundle) — into a second, sibling build target for `packages/quay`: a bundled **ESM**
`dist/` build, produced by a new `scripts/build-dist.mjs` (+ thin `build-dist.sh` wrapper), invoked
as an **explicit script step** mirroring `build-sea.sh` -> `esbuild-sea.mjs` -> gitignored
`dist-sea/` (confirmed: `.gitignore` already carries a bare `dist/` pattern parallel to
`**/dist-sea/`, and no npm lifecycle hook exists anywhere in this repo today). `package.sh` calls
`build-dist.sh` before `npm pack`, the same way `release.yml` already calls `build-sea.sh` as an
explicit step.

**REVISED SCOPE (post-architect-review): `package.json`'s `bin` field ONLY — `exports` map is
explicitly NOT touched.** The architect-review confirmed a real, reproducible blocker: `exports` is
consulted by Node's resolver for EVERY resolution of a bare specifier, including workspace-internal
ones — `packages/quay-native/bin/quay-native.ts` and `packages/quay-native/src/mcp-server.ts` import
`quay/adr-store`/`quay/document-store`/`quay/contract-validator` by package name, resolved today via
`node_modules/quay` (an npm-workspaces symlink) through `packages/quay/package.json`'s `exports` map
to `./src/adr-store.ts` etc. Repointing those 3 entries to `./dist/*.js` (which only exists AFTER
`build-dist.sh` runs, and nothing builds it before tests run in either workflow) would break
`ERR_MODULE_NOT_FOUND` for the ~29 of 64 test files across `packages/quay` + `packages/quay-native`
that spawn the native-provider binary as a subprocess for test setup — confirmed via a live
`require.resolve('quay/adr-store', {paths: [...]})` reproduction by the architect-review, not a
hypothetical. Per the review's own recommendation: nothing about the Node-floor/distribution goal
requires touching `exports` — those 3 subpaths are consumed only by an in-workspace sibling package
(`quay-native`), never distributed to or imported by an actual end user of the CLI, so they have no
Node-floor requirement of their own. `exports` stays pointed at `./src/*.ts` unchanged; only `bin`
(`./dist/quay.js`) changes.

`packages/quay/package.json`'s `bin` field is updated to point at `./dist/quay.js`, with `files`
gaining `"dist"` (`bin`/`src` stay in `files` too — `.quay/config.yml`'s `mcp_entry` and the root
`.mcp.json` are repo-local dev configuration, used with the local Node >=25 host per CLAUDE.md, and
keep pointing at source `.ts` unchanged; rebuilding `dist/` before every local edit-test cycle would
reintroduce exactly the friction M116 removed).

`plugin/scripts/sync-vendor.sh` changes to invoke `build-dist.sh` against `packages/quay` and copy
`dist/` into `plugin/vendor/quay/dist/` (replacing whatever the vendor tree's CURRENT — confirmed
stale — bin/src copy actually is; re-verify its real state first, do not assume the pre-revision
proposal's "replacing raw .ts+src copy" framing describes it accurately); `plugin/.mcp.json`'s arg
changes from `vendor/quay/bin/quay.ts` to `vendor/quay/dist/quay.js`. Whether the vendor tree's own
`package.json`/`package-lock.json`/`npm install --omit=dev` step (which exists so an UNBUNDLED
raw-source vendor copy can resolve its own `node_modules` at runtime) is now dead weight, given a
fully-bundled `dist/quay.js` has no external runtime dependency to resolve, is a concrete open
question for the plan to resolve (remove it, or confirm it's still needed for some other reason) —
not re-litigated here.

Scoped to what is demonstrably exercised today: only `packages/quay`'s own `npm pack` path and its
plugin-vendored copy get the new `dist/` build in this pass. `quay-native`/`quay-github`/
`quay-backlog` are explicitly NOT given their own `build-dist.mjs`/`dist/` in this milestone — none
currently has a standalone npm-pack distribution path (quay-native ships only via its own
already-correct, already-CJS SEA build, unaffected by this defect); adding it now would be
speculative surface with no exercised path to validate against, deferred as a near-zero-cost
follow-up if one of them gains its own npm-pack distribution later.

**Explicitly out of scope, disclosed not silently dropped:**
- `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` (the SEA binary's separate `import.meta.url`-in-CJS-bundle
  crash) — a different defect in the same neighborhood, not fixed here.
- DIR-061's full productized-delivery scope — DIR-061 explicitly depends on THIS directive landing
  first; not this milestone's scope.
- **NEW finding from architect-review, disclosed here rather than silently absorbed:**
  `packages/quay/src/gate/registry.ts:21,25`'s `REPO_ROOT` computation
  (`path.resolve(__dirname, "..", "..", "..", "..")`, 4 levels up from `src/gate/`) is DEPTH-DEPENDENT
  and will resolve to the WRONG directory once bundled to `packages/quay/dist/quay.js` (only 3 levels
  below repo root, not 4) — the exact "sibling file that won't exist relative to the bundle" class of
  bug already tracked separately for the SEA/CJS build. **Assessed as non-blocking for THIS
  milestone's own AC/DoD** for two independently-verified reasons: (1) `makeDocumentContractGate`'s
  filesystem access is LAZY (confirmed by reading `factories/document-contract.ts` — the `docDir`
  read only happens inside the gate function's own async body, never at module load), so a wrong
  `REPO_ROOT` does not crash module load, `--help`, or any other command that doesn't specifically
  invoke the `doc-quay-directive-skill` gate; (2) `docs-managed/` is a REPO-internal directory never
  included in any distributed artifact (`files` never lists it) — so this gate ALREADY fails
  (`ENOENT`) for any real distributed install today, before this milestone, regardless of `REPO_ROOT`
  correctness; this milestone changes HOW it fails (wrong-path-ENOENT vs already-would-be-ENOENT-
  anyway), not WHETHER a real distributed user could ever have used it (they couldn't, either way).
  Recorded here as a known, disclosed, pre-existing architectural gap (a repo-internal-development-
  only gate baked unconditionally into the product's shipped gate registry) — NOT fixed by this
  milestone, and NOT silently found-and-ignored either.

Separately, and independently of the packaging fix: bump the Node version `ci.yml`/`release.yml`'s
"Run tests" step actually runs under (not the declared `engines` floor) high enough to execute `.ts`
source directly as a subprocess — confirmed by the architect-review reading actual test files
(`packages/quay/test/cli.test.mjs:99-100,127` does a literal `execFileSync("node", [coreBin, ...])`
spawn of `bin/quay.ts`; the pattern recurs in 8+ files directly, more transitively via the native
provider). Since `ci.yml`/`release.yml` each have exactly ONE `setup-node` step per job (not scoped
per-step), bumping it bumps the WHOLE job including `npm install` — state this precisely in the plan.
Pin an EXACT version (not "a version that natively runs `.ts`" — 22.x needs an explicit flag, only
23+ is unflagged-by-default) — use `'24'` per CLAUDE.md's own "repo developed on Node 25" framing, one
version inside the unflagged-native-strip-types range with headroom. `engines` itself stays
`>=20.0.0`, the distributed-artifact floor this task protects — bumping CI's own runner version is
orthogonal to the declared floor.

Add a new floor-verification job (in `release.yml`, mirrored in `ci.yml` for continuous coverage)
that mirrors the existing `sea-verify-node-free` independent-verification-job pattern: after
`package.sh` produces the tgz, a fresh job installs it with Node pinned to `'20'` and runs
`quay --help` (+ a `task list`/serve smoke check) — a hard, runnable check, not prose. This is the
mechanical guard that would have caught the actual regression before a real release attempt did.

Key design decisions:
- Bundle, not per-file transpile/`tsc --outDir`: esbuild's non-bundled/`outDir` mode does not
  rewrite import-specifier text, and the repo's `.ts` files use explicit `from "../src/x.ts"`-style
  relative imports throughout — a transpiled-in-place file would still import `./abi.ts` and fail to
  resolve; no specifier-rewrite pass exists anywhere in this repo, and `tsc`'s emit mode conflicts
  with the current `allowImportingTsExtensions: true` + `noEmit: true` tsconfig. Bundling (as
  `esbuild-sea.mjs` already does) resolves and inlines all of that for free. Architect-review
  confirmed the actual TS surface has no enums/namespaces/decorators/constructor-parameter-
  properties — plain erasable-syntax TS throughout, consistent with bundling working cleanly; dynamic
  imports found (`bin/quay.ts`, `src/serve-handlers.ts`) are all local literal-path imports, which
  esbuild's bundler inlines fine.
- `src/version.ts`'s own `__dirname`-relative `package.json` read is SAFE under ESM bundling
  (confirmed by architect-review): unlike the CJS SEA build (where `import.meta.url` is emptied),
  ESM output preserves `import.meta.url` as the bundle's own file URL, and `dist/`/`src/` are direct
  siblings under `packages/quay/`, so no shim is needed here (only `registry.ts`'s DEEPER,
  4-level-relative path is affected — see disclosed-out-of-scope item above).
- Output format: ESM, not CJS. The SEA build's CJS choice is a documented Node-SEA-specific
  constraint — `build-sea.sh`'s own header comment: "Node SEA does not support ESM main modules...
  CJS output makes `import.meta.url` empty... fixed via a build-time shim" — not a general packaging
  requirement. A plain npm-pack tarball has no such constraint; every package already declares
  `"type": "module"` and uses `import.meta.url`/top-level-await patterns that ESM output preserves
  unmodified, avoiding the extra shimming CJS would otherwise force onto this new build path too.
- Build invocation & output location: an explicit named script (`build-dist.sh` -> `build-dist.mjs`)
  invoked directly by `package.sh`/CI, writing to a gitignored `dist/` directory sibling to
  `dist-sea/` — matching this repo's one existing, proven convention for generated build output —
  rather than an npm `prepack`/`postpack` lifecycle hook (doesn't exist anywhere in this repo today,
  harder to discover/debug standalone).
- `files` gains `"dist"`; whether `"bin"`/`"src"` (raw `.ts` source) should be REMOVED from `files`
  now that `bin`'s runtime path is `dist/quay.js` (avoiding shipping unused-at-runtime source in the
  tarball) is an explicit open decision for the plan, not pre-decided here.
- Two Node-version problems are distinct and need two independent fixes: the npm-pack tarball
  needing to run on Node 20 (packaging, solved by the `dist/` bundle above, `bin` field only) vs. the
  repo's own CI/release "Run tests" step spawning `bin/*.ts` as a subprocess directly on a Node-20
  runner (a separate, already-broken thing today) — fixed by bumping that step's `setup-node` version
  to an exact pinned value, without touching `engines`.
- Floor-check job: mirrors `sea-verify-node-free`'s shape (Node 20, download/install the just-built
  tarball, run its packaged CLI's `--help`/smoke check) — added to `release.yml` and mirrored in
  `ci.yml` so the check runs on every push/PR, not just at release time.
- Scope: fix only the two paths currently exercised — `packages/quay/package.json`'s `bin` field +
  `package.sh`'s existing `npm pack` call, and `plugin/scripts/sync-vendor.sh` + `plugin/.mcp.json`.
  Do NOT touch `exports`. Do NOT add `build-dist.mjs`/`dist/` to quay-native/quay-github/
  quay-backlog's package.json in this pass.

Alternatives considered and rejected:
- Raise the whole project's `engines` floor to `>=23` — rejected (task framing and both blind
  proposals, independently): pushes the constraint onto every downstream consumer, e.g. archguard's
  own `engines: >=18`.
- Per-file `tsc --outDir` / non-bundled esbuild transpile mirroring the source tree — rejected (both
  blind proposals, independently, same reasoning): esbuild's non-bundled mode does not rewrite
  import-specifier text; would need a new import-specifier-rewrite pass with no existing precedent
  here, and conflicts with the current tsconfig.
- CJS bundle output, exactly mirroring the SEA build — rejected in favor of ESM (see original
  Adjudication note below): CJS was needed only because "Node SEA does not support ESM main modules,"
  a constraint specific to the SEA blob-embedding mechanism, not to a plain npm-pack tarball.
- Ephemeral generation via npm `prepack`/`postpack` lifecycle hooks — rejected in favor of an explicit
  `build-dist.sh` step (see original Adjudication note): no lifecycle hook exists anywhere in this
  repo today.
- **Repointing `exports` to `./dist/*.js` alongside `bin` — REJECTED IN THIS REVISION** (was the
  adjudicated design pre-review): confirmed by architect-review to break `ERR_MODULE_NOT_FOUND` for
  ~29 of 64 test files across 2 packages, since `dist/` doesn't exist until `build-dist.sh` runs and
  nothing builds it before tests run in either CI workflow. `exports`'s 3 subpaths are consumed only
  by an in-workspace sibling package with no Node-floor requirement of its own — dropping this from
  scope entirely resolves the blocker with no loss relative to this milestone's actual goal.
- A permanent, git-COMMITTED `dist/` directory — not applicable; confirmed `dist/` is `.gitignore`d,
  matching the existing `dist-sea/` precedent, so this objection doesn't apply to the adopted design.
- Fold the "runs on Node 20" floor-check into the existing test step — rejected (both blind proposals,
  independently): that step needs a modern Node version bumped away from 20 to spawn source `.ts`
  bins as subprocesses at all; conflating it with "prove the distributed artifact satisfies the
  declared floor" would force one job to juggle two incompatible Node versions.
- Do nothing to the test-step Node version, treating this purely as a packaging problem — rejected:
  confirmed by architect-review (`cli.test.mjs:99-100,127` and 7+ other files) that real test files
  spawn `.ts` bins as subprocesses; fails on Node 20 regardless of any packaging fix.
- Extend the new dist-build treatment to quay-native/quay-github/quay-backlog now — rejected: none has
  an actual npm-pack distribution path today; speculative surface with no exercised path to validate.
- Change repo-local dev config to point at built output too — rejected (both blind proposals,
  independently): would reintroduce exactly the friction M116 removed.
- Ship third-party deps inlined into the bundle — rejected: duplicates `dependencies`, forfeits
  npm-level dependency auditing.

### Adjudication note (original, Stage 6.3 — unchanged by this revision)

CLASSIFICATION: DIVERGE. Both blind proposals agreed on the overall shape (reuse `esbuild-sea.mjs`'s
bundling approach; keep local dev pointed at source `.ts`; add a floor-check job; treat CI Node
version and packaging as separate problems) but disagreed on three axes: (1) output format (CJS vs
ESM) — resolved to ESM, grounded in `build-sea.sh`'s own header comment establishing CJS as a
SEA-specific constraint; (2) build invocation (ephemeral prepack/postpack vs explicit script + `dist/`)
— resolved to the explicit-script approach, grounded in `.gitignore` already having a `dist/` pattern
and no lifecycle hook existing anywhere in this repo; (3) scope breadth (quay-only vs implied
per-package) — resolved to the narrower quay-only scope, since quay-native already ships correctly via
its own unaffected SEA/CJS build and quay-github/quay-backlog have no exercised distribution path.

### Post-review revision note (this revision)

Architect-review (2026-07-23) REJECTED the adjudicated design's inclusion of the `exports` map change
as a confirmed, reproduced blocker (not hypothetical) — see "Alternatives considered and rejected"
above for the specific finding and fix. This revision drops `exports` from scope entirely (bin-field-
only), and separately discloses (without fixing) a second, lower-severity latent bug the same review
surfaced in `gate/registry.ts`'s bundle-depth-dependent `REPO_ROOT` computation, with the concrete
reasoning for why it's non-blocking for this milestone's own AC/DoD (lazy evaluation + docs-managed/
never being shipped anyway). Re-review requested before plan authoring proceeds.

## Plan
N/A — mechanical build-step addition (esbuild bundle, reusing the existing SEA build's toolchain),
plus one new CI job + one Node-version bump. Design decisions resolved above (adjudication + revision);
no staged design doc needed.

## Acceptance Criteria
- [ ] `grep -rIl 'bin/quay\(-native\|-github\|-backlog\)\?\.ts' .github/workflows/ plugin/.mcp.json` returns no MATCH (distributed configs reference `.js`, not `.ts`).
- [ ] A CI job builds the `npm pack` tarball and runs `quay --help` under the declared-floor Node version (20), exiting `0` — pasted job log.
- [ ] The `Release` workflow (or a `workflow_dispatch` dry-run) completes with the `release` job (npm-pack test + build + upload) GREEN — pasted run URL/status. (SEA jobs MAY still be red on `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` — out of this milestone's scope, must be noted not silently passed.)
- [ ] `node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')` stays green locally before/after (golden-diff, no product-behavior change from the build-step addition) — INCLUDING `packages/quay-native/test/*.test.mjs` (the architect-review's flagged risk surface), confirming the exports-map decision did not regress the native provider.

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
