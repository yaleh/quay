# M120 — iteration 0 (`exp5-M-NODE-FLOOR-DISTRIBUTION-FIX`, DIR-060)

Implements Phases 1–4 of `docs/plans/m120-node-floor-distribution-fix-plan.md` plus Phase 5
Stage 5.1 (local full-suite green). Phase 5 Stage 5.2 (push + real GitHub Actions release-workflow
trigger) is RESERVED for the orchestrator per prior human confirmation — NOT done here, nothing
pushed to any remote, no workflow triggered.

**Root cause fixed:** M116 made every CLI entrypoint a `.ts` file, runnable natively only on Node
≥23, while `engines`/CI/release pin Node 20 — the real v0.3.5 release attempt failed on exactly
this. Fix (DIR-060): transpile-on-publish (a bundled ESM `dist/quay.js`), NOT raise the floor.

Commits (this worktree, off `master` f969373):
- `d627575` Phase 1 — ESM dist/quay.js bundle build infra
- `ab75190` Phase 2 — wire bin->dist/quay.js + package.sh, npm-pack e2e
- `2cc4677` Phase 3 — vendor a bundled dist/quay.js into the plugin
- `e61474c` Phase 4 — CI Node bump + dist floor-verification jobs

---

## Discipline note: coverage of new `.test.mjs` files (real tooling behavior, disclosed not waived)

The plan's ROUND-2 correction requires Stages 1.2 and 3.2 (each a new `.test.mjs`) to compute and
paste the test file's OWN coverage number. Empirically confirmed this iteration: **Node's
`--experimental-test-coverage` structurally EXCLUDES the test file it is executing from its own
coverage report** — verified by inspecting the raw report and by `--test-coverage-include` failing
to force the row in. So "the test file's own %" is not a number Node's tool emits. Handled honestly
per the "no fabricated coverage numbers" rule:

- Every subtest of both files PASSES → every line of each test file executes (full execution).
- The command's measurable output — the coverage of the **imported source** each test exercises
  in-process (`scripts/build-dist.mjs`) — IS pasted below and is ≥80%.
- The spawned `dist/quay.js` child process's internal execution is not reachable by in-process
  coverage (a separate, disclosed limit of Node's tool against forked children).

This is literal compliance (ran the exact command, pasted the exact output), not a waiver.

---

## Phase 1 — build infrastructure (`scripts/build-dist.mjs` / `build-dist.sh`) `[code]`

New: `packages/quay/scripts/build-dist.mjs`, `packages/quay/scripts/build-dist.sh`,
`packages/quay/test/build-dist.test.mjs`, `packages/quay/test/build-dist-smoke.test.mjs`.

The load-bearing `banner: { js: 'import { createRequire } ...' }` (Grounded finding 1) is baked in:
a naive ESM bundle crashes with `Dynamic require of "process" is not supported` from `yaml`'s
CJS-interop shim; the banner resolves it. Reproduced the crash class this iteration (bundling to a
bare scratch dir) before landing the fix.

### Stage 1.1 — test-first RED → GREEN, ≥80% coverage

RED (before `build-dist.mjs` existed):
```
Error [ERR_MODULE_NOT_FOUND]
  url: '.../packages/quay/scripts/build-dist.mjs'
✖ packages/quay/test/build-dist.test.mjs
ℹ pass 0  ℹ fail 1
```

GREEN + coverage (`node --test --experimental-test-coverage packages/quay/test/build-dist.test.mjs`):
```
✔ (a) happy path: buildDist() writes a runnable ESM bundle; --help and --version succeed
✔ (b) banner regression-pin: the built bundle contains the load-bearing createRequire banner
✔ (c) failure path: a nonexistent QUAY_BUILD_DIST_ENTRY makes buildDist() reject loudly
✔ (d) shell wrapper: `bash scripts/build-dist.sh` exits 0 and writes the canonical dist/quay.js
ℹ tests 4  ℹ pass 4  ℹ fail 0
ℹ    build-dist.mjs   | 100.00 |    80.00 |   50.00 |      <- 100% line coverage (≥80% ✓)
```
Shell wrapper: no bash coverage tool in this repo (confirmed no kcov/bashcov) → RED/GREEN exit-code +
existence assertion, per the plan's shell strategy.

### Stage 1.2 — standalone-runnability + disclosed-gap verification

`build-dist-smoke.test.mjs` builds into a DEPTH-MATCHED temp tree (`<root>/l1/l2/pkg/dist/quay.js`
with a copied `package.json`) so `version.ts`'s `../package.json` read AND `registry.ts`'s
4-levels-up `REPO_ROOT` both resolve INSIDE the temp root (never the repo, never `/tmp/package.json`).

GREEN (`node --test --experimental-test-coverage packages/quay/test/build-dist-smoke.test.mjs`):
```
✔ (a) different-cwd: task list / task view --json / gate --list run against the bundle
✔ (b) serve --port + HTTP GET returns 200
✔ (c) raw MCP initialize round-trip over stdio
✔ (d) doc gate fails 'no such document: DOC-001'; stray docs-managed lands in temp, not the repo
ℹ tests 4  ℹ pass 4  ℹ fail 0
ℹ    build-dist.mjs   | 96.30 | 28.57 | 50.00 | 66-68   <- imported source, ≥80% ✓
```
(d) confirms Grounded finding 6 / ROUND-1 correction empirically: the wrong bundle-relative
`REPO_ROOT` does NOT throw a raw `ENOENT` — `createDocumentStore` unconditionally `mkdirSync`s a
stray `docs-managed/` (contained in the temp root here), then the gate fails cleanly with
`FAIL — no such document: DOC-001`. Disclosed, non-blocking, not fixed by this milestone.

**Deviations (grounded corrections):** (i) the bundle cannot build to a bare `/tmp` scratch —
`version.ts` reads `../package.json` at import and `registry.ts` computes `REPO_ROOT` 4 levels up,
so a depth-matched temp tree is required (the smoke test's structure). (ii) the plan's "task get"
is a native-provider verb; the Core CLI verb is `task view` — corrected.

---

## Phase 2 — wire `package.json` + `package.sh`, `npm pack` e2e `[code]`

### Stage 2.1 — manifest edits, test-first RED → GREEN

Golden-diff of the behavior change: `bin.quay` was `./bin/quay.ts`, now `./dist/quay.js`.

RED (against today's `bin`, before the edit):
```
✖ bin.quay points at the transpiled ./dist/quay.js ...          (bin was ./bin/quay.ts)
✖ files ships the dist bundle plus the pre-existing entries
✔ REGRESSION GUARD: exports is unchanged — still ./src/*.ts ...  (guard passes both before & after)
✔ engines.node stays >=20.0.0 ...
✖ package.sh builds dist/ (build-dist.sh) BEFORE npm pack
ℹ pass 2  ℹ fail 3
```
GREEN (after editing `package.json` bin→`./dist/quay.js`, `files`+`"dist"`; `package.sh` runs
`build-dist.sh` before `npm pack`):
```
✔ bin.quay points at the transpiled ./dist/quay.js (Node-20-runnable), not ./bin/quay.ts
✔ files ships the dist bundle plus the pre-existing entries
✔ REGRESSION GUARD: exports is unchanged — still ./src/*.ts, never repointed to ./dist/*.js
✔ engines.node stays >=20.0.0 (the declared distribution floor is untouched)
✔ package.sh builds dist/ (build-dist.sh) BEFORE npm pack
ℹ tests 5  ℹ pass 5  ℹ fail 0
```
`exports` was NOT touched (architect-review-rejected change that breaks ~29 test files) — asserted
as a hard regression guard. `100%-of-changed-fields` manifest assertion (grep/parse), stated as
such — not a fabricated line-coverage %.

`npm pack --dry-run` confirms the tarball ships the bundle:
```
has dist/quay.js: true
has package.json: true
bin field: ./dist/quay.js
```

### Stage 2.2 — `npm pack` → install → run e2e

`npm-pack-e2e.test.mjs`: real `package.sh` → `npm pack` → install the tarball into a scratch prefix
→ run the installed `dist/quay.js` bin.
```
✔ the installed tarball's bin resolves to dist/quay.js and it exists
✔ installed `quay --help` runs and prints usage (Node 25 host — NOT a Node-20 proof)
✔ installed `quay --version` prints the package version
✔ installed `quay task list` does a real provider round-trip against a native workspace
ℹ tests 4  ℹ pass 4  ℹ fail 0
```
**Honestly scoped:** this run is Node 25 (this host) — it CANNOT prove Node-20 compatibility. That
is Phase 4's floor-verification job, exercised for real only by Phase 5 Stage 5.2 (orchestrator).
No line-coverage % applies: `package.sh` is shell (no bash coverage tool), the test file is excluded
by Node's tool, and the installed binary is a forked child — the check is RED/GREEN exit-code +
runnable-artifact assertions per the repo's shell strategy. The behavior-defining test-first
RED/GREEN for the Phase-2 change is Stage 2.1's manifest test (proven RED before the edit); this
e2e is the integration validation of that same landed change.

---

## Phase 3 — plugin vendor sync `[code + config]`

### Stage 3.1 — `.gitignore` fix + `sync-vendor.sh` + `.mcp.json`, test-first

Edits: `.gitignore` (+negation for `plugin/vendor/quay/dist/`, Grounded finding 2);
`plugin/scripts/sync-vendor.sh` (build+copy `dist/quay.js` instead of raw `bin/src`; slim
`package.json` to name/version/type; drop `package-lock.json` + npm-install step — a fully-bundled
copy resolves zero node_modules, Grounded finding 5); `plugin/.mcp.json`
(`vendor/quay/bin/quay.ts` → `vendor/quay/dist/quay.js`). `git rm` of the obsolete tracked
`bin/quay.js`, `src/*.ts`, and `package-lock.json` (1190 lines).

RED (new M120 assertions against the stale tree) → GREEN (post-`sync-vendor.sh`):
```
RED:  ✖ M120: .mcp.json invokes the bundled vendor/quay/dist/quay.js ...
      ✖ M120: the vendored dist bundle exists, is git-trackable, and carries the createRequire banner
      ✖ M120: the stale raw bin/ + src/ vendor copies are gone ...
      ✖ M120: package-lock.json is gone and package.json is slimmed ...
      ℹ pass 8  ℹ fail 4
GREEN: ℹ tests 12  ℹ pass 12  ℹ fail 0
```
`git check-ignore plugin/vendor/quay/dist/quay.js` → NOT ignored (negation works); the bundle is
staged and tracked.

### Stage 3.2 — `node_modules`-free execution proof

`plugin-vendor-standalone.test.mjs`: copy the vendor tree into an isolated scratch with zero
node_modules, run `--help` + a raw MCP `initialize`.
```
✔ vendor bundle runs --help from an isolated copy with zero node_modules present
✔ vendor bundle serves a raw MCP initialize round-trip standalone
✔ sanity: the bundle is the ESM build (createRequire banner) — the reason it needs no deps
ℹ tests 3  ℹ pass 3  ℹ fail 0
```
Coverage command run; Node's report is empty of relevant rows (`all files | 100.00`) because the
test imports no `src` and Node excludes the test file it runs — full execution evidenced by 3/3
green (see the discipline note above).

**Deviations (grounded refinements):** (i) "copy `dist/quay.js` alone" is imprecise — the bundle
needs its sibling-parent `package.json` (`version.ts`'s `../package.json` read; copying the file
truly alone crashes on the version read). The vendor tree carries that package.json;
"standalone" = zero node_modules / zero external deps, asserted directly. (ii) the Core `mcp` server
calls `loadConfig()` at startup (providers connect only lazily, never during `initialize`), so the
isolated root is given a parseable `.quay/config.yml`.

---

## Phase 4 — CI/release workflow changes `[prose]` (YAML manifests)

### Stage 4.1 — Node bump + retire stale `bin/quay.ts` reference

- `.github/workflows/ci.yml` `test` job `setup-node`: `'20'` → `'24'`.
- `.github/workflows/release.yml` `release` job `setup-node`: `'20'` → `'24'` (`sea-release` stays
  `'20'`).
- `release.yml` GitHub-Release-notes body: `` `bin/quay.ts` `` → `` built as `dist/quay.js` `` (the
  leftover prose string the milestone's own AC1 grep matched — ROUND-1 correction).
- `engines` unchanged (`>=20.0.0`).

Mechanical acceptance:
```
=== AC1 grep (want NO match) ===
grep -rIl 'bin/quay\(-native\|-github\|-backlog\)\?\.ts' .github/workflows/ plugin/.mcp.json
→ no match (AC1 satisfied)

=== per-job node pins (YAML-parsed) ===
ci.yml       test                     node 24
ci.yml       dist-verify-node-floor   node 20
release.yml  release                  node 24
release.yml  sea-release              node 20
release.yml  sea-verify-node-free     node (none)   # container job, no setup-node
release.yml  dist-verify-node-floor   node 20
engines.node → >=20.0.0
```

### Stage 4.2 — floor-verification job in both workflows

- `release.yml` `dist-verify-node-floor` (`needs: release`): mirrors `sea-verify-node-free`'s
  private-repo asset-fetch shape (resolve asset id from the release-by-tag API, GET the assets
  endpoint with octet-stream Accept), installs the just-published `quay-<version>.tgz` under Node
  PINNED to `'20'`, runs `quay --help`/`--version`.
- `ci.yml` `dist-verify-node-floor` (standalone): self-builds the tarball (no GitHub Release on
  push/PR) and installs+runs it under Node `'20'`.

Mechanical acceptance:
```
both YAMLs parse valid (jobs enumerated above)
dist-verify-node-floor node-version: 20 in BOTH workflows
ci.yml floor job: needs null (self-builds); release.yml floor job: needs "release" (asset-fetch)
```
Whether the job passes on a real Node-20 runner is empirically unknown until Phase 5 Stage 5.2's
real run (orchestrator).

---

## Phase 5 Stage 5.1 — local full-suite green (golden-diff checkpoint) `[code]`

All three suites, against the fully-landed Phases 1–4, exit 0:

```
quay        (46 files, excl. serve-github + provider-abi-conformance):
            ℹ tests 371  ℹ pass 371  ℹ fail 0   (duration ~159s)
quay-native (16 files):
            ℹ tests 42   ℹ pass 42   ℹ fail 0
plugin      (3 files):
            ℹ tests 23   ℹ pass 23   ℹ fail 0
```

No product-behavior change from the build-step addition; the native provider (the architect-review's
flagged risk surface for the exports decision) is green, confirming `exports` was correctly left
untouched.

---

## AC / DoD status

| Item | Status (this iteration, Phases 1–4 + 5.1) |
|---|---|
| AC1: distributed configs reference `.js` not `.ts` (grep no match) | **MET** — grep returns no match. |
| AC2: a CI job builds the tarball + runs `quay --help` under Node 20, exit 0 (pasted job log) | **Built, not yet run for real** — `dist-verify-node-floor` job added to both workflows (Node 20); a REAL run is Stage 5.2 (orchestrator). |
| AC3: `Release` workflow `release` job GREEN (pasted run URL) | **Reserved for Stage 5.2** (orchestrator) — not pushed/triggered here. |
| AC4: quay + quay-native suites green before/after (golden-diff) | **MET** — 371/371 + 42/42, 0 fail. |
| DoD: real release-workflow run w/ floor-check + release GREEN | **Reserved for Stage 5.2** (orchestrator). |

Scope handled exactly per plan: `packages/quay` `bin` field + `package.sh` + plugin vendor only;
`exports` untouched; quay-native/github/backlog not given `dist/` builds; the `registry.ts`
`REPO_ROOT` gap disclosed + not fixed. Out-of-scope items (SEA-build crash, DIR-061 full scope)
left untouched.
