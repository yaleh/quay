# Plan: Fix `.ts`-entrypoint × Node-floor distribution regression (DIR-060, release-blocking)

- **Source proposal:** `tasks/exp5-M-NODE-FLOOR-DISTRIBUTION-FIX.md` `## Proposal` (adjudicated 2026-07-23, revised post-architect-review to drop the `exports` change, re-reviewed and APPROVED). This plan implements that proposal's already-settled design decisions; it does not re-derive them.
- **Nature of this deliverable:** overwhelmingly executable code + build/CI config (a new `.mjs` build script, a thin `.sh` wrapper, `package.json`/workflow-YAML edits, a shell vendor-sync script). The TDD ≥80%-coverage code branch applies to the new `.mjs`; the shell/YAML/JSON edits use this repo's own actual practice for those asset types — RED/GREEN exit-code selfcheck cases for shell (no bash coverage tool exists in this repo — confirmed: no `kcov`/`bashcov` anywhere), and `grep`/parse mechanical checks for YAML/JSON manifests (same shape `plugin/test/plugin-packaging.test.mjs` already uses for `.mcp.json`/`plugin.json`) — stated honestly, not a fabricated percentage.
- **Grounding note:** every file path/line number below was read directly (not assumed) during planning, and the core bundling mechanism was **empirically test-built and run** (esbuild invoked live against `bin/quay.ts`, `--help`/`--version`/`task list`/`serve`/`mcp` all executed against the real repo workspace) — see "Grounded findings" below for two concrete issues this surfaced that the approved proposal did not call out.

## Grounded findings (new, surfaced during plan authoring — not in the proposal)

1. **A naive ESM `bundle:true` build of `bin/quay.ts` crashes at runtime.** Built via `esbuild.build({entryPoints:['bin/quay.ts'], bundle:true, platform:'node', format:'esm', outfile:'dist/quay.js'})` (no banner) and ran `node dist/quay.js --help`:
   ```
   Error: Dynamic require of "process" is not supported
       at .../node_modules/yaml/dist/compose/composer.js
   ```
   `yaml`'s CJS interop shim does a dynamic `require()` that esbuild's ESM-output `__require` polyfill can't satisfy without a real `require` in scope. **Fix, verified working:** add `banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }` to the esbuild options. After the banner, `--help`, `--version` (prints `0.3.5`), `task list --json`, `serve --port` (`curl` → `http_code:200`), and a raw MCP `initialize` handshake over `quay mcp` were all run end-to-end and succeeded. This banner is now a **load-bearing build option**, not an optional nicety.

2. **`plugin/vendor/quay/dist/` would be silently gitignored.** `.gitignore` line 4 is a bare `dist/` pattern, matching at any depth. Verified fix: appending
   ```
   !plugin/vendor/quay/dist/
   !plugin/vendor/quay/dist/**
   ```
   makes it `git add`-able. Without this fix, Phase 3's sync would silently never land in git.

3. **`build-dist.mjs` does not itself need Node ≥23 to run** — esbuild parses TS with its own bundled parser. Confirmed by the *existing, unmodified* `sea-release` job already running `node scripts/esbuild-sea.mjs` under Node 20 today. Means the floor-verification job can build+install+smoke-test in one Node-20-pinned job.

4. **`npm pack` DOES include a `dist/` entry once added to `files`**, despite `.gitignore`'s pattern — verified via `npm pack --dry-run --json`.

5. **DIR-061 presumes `plugin/vendor/quay/package.json` continues to exist and carry a version.** Resolution: slim (name/version/type only, drop `dependencies`), remove `package-lock.json`, drop the `npm install --omit=dev` instruction from `sync-vendor.sh`.

6. **[ROUND-1 CORRECTION] The proposal's "already-would-be-ENOENT-anyway" characterization of the `registry.ts` `REPO_ROOT` bug is imprecise, and it hides a real side effect.** Empirically re-verified this round: built the ESM bundle to its real target location (`packages/quay/dist/quay.js`) and ran `quay gate <task> --gate doc-quay-directive-skill` against it. Actual observed behavior is **not** a raw `ENOENT` — `document-store.ts:66`'s `createDocumentStore` unconditionally does `fs.mkdirSync(docDir, { recursive: true })` *before* trying to read anything, so the wrongly-computed `REPO_ROOT` (one level *above* the real repo root when resolved from `dist/`, confirmed: `path.resolve(".../packages/quay/dist", "..","..","..","..")` lands at the repo's *parent* directory, not the repo root — the bundle is one directory level shallower than `src/gate/` was) causes a **silently-created stray `docs-managed/` directory one level above the repo root** on every invocation, then `document-store.ts#get()` returns `null` (file not found in that now-real-but-empty dir) and the gate fails cleanly with `{ ok: false, reason: "no such document: DOC-001" }` — never a thrown/uncaught `ENOENT`. The functional conclusion in the proposal (this gate is non-blocking, already unusable in a real distributed install either way) still holds and does not need to change. But the *mechanism* is a silent filesystem side effect (an unwanted directory written into a real user's filesystem tree at an unpredictable location, one level above wherever `dist/quay.js` happens to sit), not a clean read failure — this is a materially different, and arguably worse, disclosed-non-blocking gap than what's written up. Stage 1.2(d) below is corrected to assert the actually-observed behavior instead of a fictional `ENOENT`. No scope change: still disclosed, still non-blocking, still not fixed by this milestone — the correction is to the plan's own acceptance wording, not to scope.

## Phase overview and dependency order

| Phase | Title | Depends on | Nature |
|---|---|---|---|
| 1 | Build infrastructure (`dist/quay.js` ESM bundle) | — | code |
| 2 | Wire `package.json`/`package.sh`, verify `npm pack` e2e | 1 | code |
| 3 | Plugin vendor sync (`sync-vendor.sh` + `.mcp.json` + `.gitignore`) | 1 | code + config |
| 4 | CI/release workflow changes (Node bump + floor-verify job) | 2 | config (YAML) |
| 5 | Full local verification + real release-workflow trigger | 2, 3, 4 | verification + handoff |

2 and 3 can run in parallel once Phase 1 lands. 4 depends on 2. 5 depends on 2, 3, 4 all landing.

**Size budget:** ≤200 lines/stage, ≤500 lines/phase, ≤2000 lines/milestone. Running total: **≈845 lines**.

## Phase 1 — Build infrastructure: `scripts/build-dist.mjs` / `build-dist.sh` → `packages/quay/dist/quay.js`

### Stage 1.1 — `scripts/build-dist.mjs` + `scripts/build-dist.sh`, test-first
- **Files:** new `packages/quay/scripts/build-dist.mjs` (~55 lines), new `packages/quay/scripts/build-dist.sh` (~30 lines), new `packages/quay/test/build-dist.test.mjs` (~90 lines).
- **Work:** write test FIRST (RED). (a) happy path: `dist/quay.js` exists, `--help`/`--version` succeed. (b) regression-pin the banner requirement (grep-style string assertion for `createRequire`). (c) failure path via a `QUAY_BUILD_DIST_ENTRY` env-var testability hook. Then implement to GREEN.
- **Tag:** `[code]`.
- **TDD acceptance:** ≥80% line coverage of `scripts/build-dist.mjs`, `node --test --experimental-test-coverage`, test-first.

### Stage 1.2 — Standalone-runnability + disclosed-gap verification
- **Files:** new `packages/quay/test/build-dist-smoke.test.mjs` (~140 lines).
- **Work:** (a) run from a different cwd against a temp native-provider workspace, exercising `task list`/`task get`/`gate --list`. (b) `serve --port` + curl. (c) raw MCP `initialize` round-trip. (d) invoke `doc-quay-directive-skill` gate and assert it fails with `{ ok: false, reason: "no such document: DOC-001" }` — **[ROUND-1 CORRECTION]** not a raw `ENOENT` as the proposal's prose implied; empirically re-verified this round (see Grounded finding 6 above): `document-store.ts`'s `createDocumentStore` calls `fs.mkdirSync(docDir, { recursive: true })` before any read, so the wrong `REPO_ROOT` produces a silently-created stray directory + a clean "no such document" gate failure, never an uncaught `ENOENT`. Assert on the actual `reason` string, and additionally assert the stray directory this creates lands under a scratch/temp root in the test (never the real repo tree) so the test itself doesn't litter the workspace.
- **Tag:** `[code]`.
- **TDD acceptance:** all assertions PASS, 0 failures, output pasted, including the corrected "no such document" (not `ENOENT`) assertion. **[ROUND-2 CORRECTION]** `build-dist-smoke.test.mjs` is itself a new `.test.mjs` file — per the `quay-task-to-plan` skill's own classifier (`.claude/skills/quay-task-to-plan/SKILL.md` §"TDD ≥80% hard gate"), a test file is explicitly code-branch ("JS/shell/any `.mjs`/`.sh`/etc. source **or test file**"), and the classifier defines only two branches (code/prose) with no third "smoke-test exemption" — the gate is "mandatory and MUST NOT be skipped ... regardless of stage size." Declining to measure at all (as the prior wording did) is not an authorized outcome. Corrected: run `node --test --experimental-test-coverage packages/quay/test/build-dist-smoke.test.mjs` and paste the actual number — literal compliance, not a waiver (expected trivially ~100%, since the file is a linear sequence of subprocess-invocation assertions with no untested branches). Disclosed, not glossed over: this percentage covers only the test file's own lines — it cannot and does not reach into the spawned `dist/quay.js` subprocess's own internal execution (a distinct, separate limitation of `node --experimental-test-coverage` against forked child processes, not a reason to skip measuring what it *can* measure).

**Phase 1 acceptance:** `dist/quay.js` runs standalone from any cwd, contains the banner, disclosed gap behaves as predicted. **Total ≈315 lines.**

## Phase 2 — Wire `package.json` + `package.sh`, verify `npm pack` end-to-end

### Stage 2.1 — `package.json`/`package.sh` edits + manifest-assertion test
- **Files:** edit `packages/quay/package.json` (`bin.quay: "./dist/quay.js"`, `files` gains `"dist"`; `exports` and `bin`/`src` in `files` unchanged); edit `packages/quay/scripts/package.sh`; new `packages/quay/test/package-json-bin.test.mjs` (~90 lines) asserting exact manifest fields including a regression guard that `exports` is still `./src/*.ts`.
- **Tag:** `[code]`.
- **TDD acceptance:** test-first (RED against today's `bin`), GREEN after edit; 100%-of-changed-fields-asserted (stated explicitly, not a fabricated line-coverage %).

### Stage 2.2 — `npm pack` → install → run, full golden-diff
- **Files:** new `packages/quay/test/npm-pack-e2e.test.mjs` (~140 lines).
- **Work:** real `package.sh` run, install into scratch dir, run `quay --help`/`task list`. State explicitly this local run (Node 25) cannot prove Node-20 compatibility. Then full existing suite rerun: `packages/quay/test/*.mjs` (44 files, all of which match `*.test.mjs`) + `packages/quay-native/test/*.test.mjs` (**[ROUND-1 CORRECTION] 16 files, not 20** — `packages/quay-native/test/` has 20 total `.mjs` files, but 4 (`abi-symmetry.mjs`, `cas-writer-helper.mjs`, `concurrent-writer.mjs`, `reparent-writer.mjs`) are non-test helper modules imported by other test files, not standalone suites matching the `*.test.mjs` glob actually invoked — verified via `ls packages/quay-native/test/*.test.mjs | wc -l`).
- **Tag:** `[code]`.
- **TDD acceptance:** test-first RED/GREEN for the new test; golden-diff mechanical check for the existing-suite rerun (44 + 16 = 60 files), pasted green output. No line-coverage % applies to the golden-diff half — it's a full-suite rerun of pre-existing tests, not new source; the ≥80% bar applies only to the new `npm-pack-e2e.test.mjs`'s own exercise of `package.sh`'s logic path, stated honestly rather than blending it with the rerun's pass/fail count.

**Phase 2 acceptance:** `npm pack`→install→run succeeds locally; full quay+quay-native suites green. **Total ≈230 lines.**

## Phase 3 — Plugin vendor sync

### Stage 3.1 — `.gitignore` fix + `sync-vendor.sh` + `.mcp.json`, test-first
- **Files:** edit `.gitignore` (+3 lines negation pattern); edit `plugin/scripts/sync-vendor.sh` (~40-line diff); edit `plugin/.mcp.json`; extend `plugin/test/plugin-packaging.test.mjs` (~55 new lines).
- **Work:** write assertions FIRST against current stale state (RED). Make edits, re-run sync-vendor.sh, re-test (GREEN). `git rm` the now-obsolete `package-lock.json` (1190 lines) and tracked bin/src copies.
- **Tag:** `[code]`.
- **TDD acceptance:** RED (stale)→GREEN (post-sync) assertion pairs per changed branch, stated as the mechanical-check standing in for coverage.

### Stage 3.2 — `node_modules`-free execution proof
- **Files:** new `plugin/test/plugin-vendor-standalone.test.mjs` (~110 lines).
- **Work:** copy `dist/quay.js` alone into an isolated scratch dir, run `--help` + MCP `initialize`, asserting zero `node_modules` resolution needed.
- **Tag:** `[code]`.
- **TDD acceptance:** both assertions PASS in isolated copy, test-first (RED today — no vendor dist exists). **[ROUND-2 CORRECTION]** same fix as Stage 1.2 above: `plugin-vendor-standalone.test.mjs` is a new `.test.mjs` file — code-branch per the classifier, not exemptable. Run `node --test --experimental-test-coverage plugin/test/plugin-vendor-standalone.test.mjs` and paste the actual (expected trivially ~100%) number; disclose, without using as a reason to skip, that it measures only this test file's own lines, not the spawned standalone `dist/quay.js` copy's internal execution.

**Phase 3 acceptance:** `.mcp.json` points at a real, git-trackable `vendor/quay/dist/quay.js`; runs standalone with zero deps; `package-lock.json` gone. **Total ≈205 lines.**

## Phase 4 — CI/release workflow changes

### Stage 4.1 — Bump the "Run tests" step's Node version to `'24'` + retire the stale `bin/quay.ts` release-notes reference
- **Files:** edit `.github/workflows/ci.yml` (`test` job's `setup-node`: `'20'`→`'24'`); edit `.github/workflows/release.yml` (only the `release` job's `setup-node`: `'20'`→`'24'` — `sea-release` stays `'20'`). **[ROUND-1 CORRECTION, new file-scope item]** also edit `.github/workflows/release.yml:70` — the `release` job's GitHub-Release-notes body (`softprops/action-gh-release`'s `body:` block) contains the literal prose string `` the CLI entrypoint (`bin/quay.ts`) `` ; this milestone's own Acceptance Criterion 1 (`grep -rIl 'bin/quay\(-native\|-github\|-backlog\)\?\.ts' .github/workflows/ plugin/.mcp.json` must return **no MATCH**) currently matches this exact line — verified empirically this round (`grep -n ... release.yml` → line 70). Left untouched, AC 1 fails post-implementation on this one leftover prose string even though every executable path is fixed. Reword to name the dist-bundle entrypoint (e.g. "the CLI entrypoint (built as `dist/quay.js`)") or drop the parenthetical.
- **Work:** `engines` unchanged (`>=20.0.0`).
- **Tag:** `[prose]` (YAML manifest, including the release-notes markdown body).
- **Mechanical acceptance:** grep confirms exact node-version pins per job; YAML parses valid; `grep -rIl 'bin/quay\(-native\|-github\|-backlog\)\?\.ts' .github/workflows/ plugin/.mcp.json` returns **no MATCH** (the milestone's own AC 1, now genuinely satisfiable after this stage — previously it was not, see correction above).

### Stage 4.2 — New floor-verification job, mirrored in both workflows
- **Files:** new job in `release.yml` (~45 lines, `dist-verify-node-floor`, mirrors `sea-verify-node-free`'s asset-fetch shape); new job in `ci.yml` (~40 lines, self-builds the tarball since no GH Release exists on push/PR).
- **Tag:** `[prose]` (YAML, copy-adapted from existing job).
- **Mechanical acceptance:** YAML valid; grep confirms both jobs pin `node-version: '20'`; structural mirror of `sea-verify-node-free` confirmed. Whether the job passes is empirically unknown until Phase 5's real run.

**Phase 4 acceptance:** both workflows declare correct Node versions per job; new floor-verification job in both. **Total ≈95 lines.**

## Phase 5 — Full verification + real release-workflow trigger

### Stage 5.1 — Local full-suite green (golden-diff checkpoint)
- **Work:** re-run all 3 suites (quay, quay-native, plugin) together against the fully-landed changes.
- **Tag:** `[code]` (test-runner invocation, no new source, no coverage % applies).
- **Acceptance:** exit 0 across all three suites.

### Stage 5.2 — HANDOFF: real GitHub Actions release-workflow trigger
- **Precondition:** pushing + triggering/observing the actual Release workflow run is explicitly authorized to be done by the ORCHESTRATOR directly, per prior human confirmation. Not implemented/automated by this plan's stages.
- **Acceptance:** milestone's own AC #2/#3/DoD verbatim — pasted real run URL, floor-check job log, release job GREEN (SEA jobs may still be red on the separately-tracked SEA-crash defect, noted not silently passed).

**Phase 5 acceptance:** local suites green; a REAL release-workflow run shows floor-check passing and release job green. **Total: 0 new lines.**

## Running line-budget total

| Phase | Lines (≤500 ceiling) |
|---|---|
| 1 | ≈315 |
| 2 | ≈230 |
| 3 | ≈205 |
| 4 | ≈95 |
| 5 | 0 |
| **Milestone total (≤2000 ceiling)** | **≈845** |

Every stage is ≤200 lines (largest: Stage 1.2/2.2 at ~140).

## Test/verification strategy (stated honestly, split by asset type)

- **New executable code**: TDD, ≥80% line coverage, test-first, `node --test --experimental-test-coverage`.
- **Shell**: no bash coverage tool in this repo — RED/GREEN exit-code/existence assertions instead.
- **JSON/YAML manifests**: grep-checkable field assertions + YAML-parses-valid checks, never a fabricated coverage percentage.
- **The one thing not locally provable:** genuine Node-20 compatibility can only be proven by an actual Node-20 runtime (this host is Node 25) — that's Phase 4's floor-verification job, executed for real only via Phase 5's orchestrator-driven release-workflow trigger.

## Round-1 grounded-check note (this pass)

Budget gate: **PASS** (already run by the orchestrator — scope within the small-milestone norm, no declared line budget > 2000, in-scope item count at or under threshold 8; consumed as ground truth, not re-run).

Independently re-verified this round, empirically, not by re-reading prose: `.gitignore` line 4 is a bare `dist/` pattern (confirmed); the negation-pattern fix in Grounded finding 2 actually un-ignores a nested path under `git check-ignore`/`git add` (reproduced in an isolated scratch git repo); the naive-ESM-bundle crash in Grounded finding 1 reproduces verbatim (`Error: Dynamic require of "process" is not supported`, at `yaml/dist/compose/composer.js`) and the banner fix verifiably resolves it, tested at the real target path `packages/quay/dist/quay.js` (`--help`, `--version` → `0.3.5`, `task list --json`, `serve --port` + curl → `200`, all real); `sea-verify-node-free`/`sea-release` exist in `release.yml` in the shape described (Node `'20'` pinned per job, container-based Node-free verification job downloading the just-published SEA asset); `plugin/vendor/quay/package-lock.json` exists and is exactly 1190 lines (`wc -l` confirms); `registry.ts:21,25` (`__dirname`/`REPO_ROOT`) and `factories/document-contract.ts`'s lazy `docDir` access are exactly as cited; archguard's real `package.json` does declare `"engines": {"node": ">=18.0.0"}`; quay-native's `bin/quay-native.ts` + `src/mcp-server.ts` do import exactly the 3 `quay/*` exports subpaths cited (`adr-store`, `document-store`, `contract-validator`); `.quay/config.yml` and the root `.mcp.json` still point at source `.ts` (repo-local dev config genuinely unaffected).

One proposal-level factual wrinkle noted but not requiring a plan change: the proposal's own prose says the plugin vendor tree was "last synced at commit `093a912`" — `git log --oneline -- plugin/vendor/quay` shows the actual last-touching commit is `8d1ded4` (M109), which is *later* than `093a912` (M86) but still *before* M116 (`3667b02`, the bin-rename commit) — so the substantive claim (stale, pre-M116, `.mcp.json` points at a `.ts` file that doesn't exist in the vendor tree) holds true regardless; only the specific commit hash cited is off by a few commits. The draft plan itself never repeats this hash, so no correction was needed to the plan record.

**F_i = 4** material findings this round, all corrected in place above:
1. Stage 2.2: `packages/quay-native/test/*.test.mjs` file count was wrong (stated 20, actually 16 — 4 of the 20 `.mjs` files in that directory are non-test helper modules, not matched by the `*.test.mjs` glob the stage's own command uses).
2. Stage 1.2(d): acceptance criterion asserted a fictional `ENOENT` failure mode for the disclosed `registry.ts` `REPO_ROOT` bug; empirically the actual behavior is a caught `{ok:false, reason:"no such document: DOC-001"}` gate failure, preceded by a silent stray-directory creation (`document-store.ts:66`'s unconditional `mkdirSync`) — a real, previously-undisclosed side effect. Corrected to assert the real behavior; scope unchanged (still non-blocking, still not fixed here).
3. Phase 4 / Stage 4.1: missing file-scope item — `.github/workflows/release.yml:70`'s release-notes prose contains a literal `bin/quay.ts` string that the milestone's own AC 1 greps for; left unaddressed, AC 1 would still fail post-implementation. Added to Stage 4.1's file list and acceptance.
4. Stages 1.2, 2.2 (rerun half), and 3.2: tagged `[code]` but stated acceptance criteria never mentioned coverage, without explicitly disclaiming why (unlike Stage 5.1, which already does state "no coverage % applies" for its own no-new-source stage) — an internal inconsistency in how the code-vs-prose classifier was applied. Added matching explicit "no coverage % applies" disclaimers for consistency and honesty.

**Convergence verdict: NOT CONVERGED (F_i = 4 > 0).** A round 2 check should confirm the 4 corrections above read correctly in context and re-scan for any further drift they introduce (none expected — all 4 are localized wording/scope corrections, no stage was added, removed, reordered, or re-budgeted).

## Round-2 grounded-check note (this pass)

Budget gate: **PASS** (already run by the orchestrator against this round's file — scope within the small-milestone norm, no declared line budget > 2000, in-scope item count at or under threshold 8, no phase/stage plan required; consumed as ground truth, not re-run).

**Independently re-verified all 4 round-1 corrections myself (not trusted on say-so):**
1. `ls packages/quay-native/test/*.test.mjs | wc -l` → **16** (confirmed). `ls packages/quay-native/test/*.mjs | wc -l` → 20 (confirmed, matches the "20 total .mjs" framing). All 4 named files (`abi-symmetry.mjs`, `cas-writer-helper.mjs`, `concurrent-writer.mjs`, `reparent-writer.mjs`) exist on disk and are confirmed NOT matched by the `*.test.mjs` glob. Also re-verified the `packages/quay/test/*.mjs` count independently: **44** (matches Stage 2.2's "44 files" claim; all 44 do end in `.test.mjs`, so `44 + 16 = 60` holds).
2. Read `packages/quay/src/document-store.ts` directly: line 66, `createDocumentStore`'s FIRST statement is an unconditional `fs.mkdirSync(docDir, { recursive: true })`, before `get`/`list`/`write` are even defined, let alone called — confirms the "silent stray-directory creation before any read" claim exactly as worded.
3. `grep -n 'bin/quay\.ts' .github/workflows/release.yml` → line 70, literal text `...and the CLI entrypoint (`bin/quay.ts`).` inside the `softprops/action-gh-release` release-notes `body:` block — confirmed. Re-ran the milestone's own AC1 grep verbatim (`grep -rIl 'bin/quay\(-native\|-github\|-backlog\)\?\.ts' .github/workflows/ plugin/.mcp.json`) → matches both `plugin/.mcp.json` and `.github/workflows/release.yml` — confirms the AC would genuinely fail without Stage 4.1's added edit.
4. Re-read the disclaimer text in context — clear prose, no ambiguity.

**New finding this round (the independent re-scan required by this check's own charter):** cross-checked round-1's new "no line-coverage % applies" disclaimers (added to Stages 1.2 and 3.2) against the actual governing rule — `.claude/skills/quay-task-to-plan/SKILL.md`'s "TDD ≥80% hard gate — code-vs-prose classifier" section, read in full. That classifier defines exactly two branches: code (coverage ≥80%, applies to "JS/shell/any `.mjs`/`.sh`/etc. source **or test file**") and prose (mechanical-check, for `SKILL.md`/templates/manifests only) — with an explicit blanket rule that the gate is "mandatory and MUST NOT be skipped ... regardless of stage size," and a named `forbid` on skipping the code-branch gate for any reason. Stages 1.2 and 3.2 each introduce a brand-new `.test.mjs` file as their sole `Files:` deliverable, tagged `[code]` — unambiguously the classifier's code branch (a "test file" is explicitly enumerated, not exempted) — yet round 1's fix declared "no % applies" and declined to measure anything at all. That is a genuine, previously-uncaught conflict with the plan's own governing hard-gate rule, introduced by round 1 while it was fixing a different problem (its own finding #4). Stage 2.2's analogous disclaimer and Stage 5.1 are NOT affected by this: Stage 2.2's "no % applies" scope is explicitly the 60-file *pre-existing*-suite rerun (not a stage `Files:` deliverable at all), and Stage 5.1 has no `Files:` entry whatsoever (a bare re-run invocation) — both correctly fall outside the classifier's scope already.

**Fix applied in place above:** Stages 1.2 and 3.2 now require the literal coverage number be computed (`node --test --experimental-test-coverage` against the new test file) and pasted — expected trivially near 100% given the files' linear subprocess-invocation shape, but computed and disclosed rather than waived — with an explicit, honest caveat that the number covers only the test file's own lines, not the spawned external binary's internal execution (a real, separate, disclosed technical limit of Node's coverage tool against forked child processes — not a license to skip measuring what it *can* measure).

**Independent re-scan for anything else (per this round's charter, not trusting round 1's "none expected" claim):** read `packages/quay/scripts/package.sh` in full — no stale `.ts` references, no path-depth-dependent computation, nothing else for the plan to touch. Read `plugin/scripts/sync-vendor.sh` in full — its current `cp -r "${SRC}/bin"`/`cp -r "${SRC}/src"` behavior is exactly the stale raw-source-copy mechanism Stage 3.1 is scoped to replace; no additional file or step found needing mention. Read `plugin/.mcp.json` in full (8 lines) — single `args` entry pointing at `vendor/quay/bin/quay.ts`, already covered by Stage 3.1/AC1. Additionally grepped the whole repo (excluding `node_modules`/`experiments`/`.git`) for the AC1 pattern to confirm no other CI/config surface was missed beyond what the plan already lists: every other hit is either a package's own legitimate current `bin` field (quay-native/quay-github/quay-backlog, explicitly out of scope per the proposal), a test file spawning that package's own binary (unrelated to this milestone), or a task/milestone-record mention (historical prose, not a live config surface) — no new in-scope file surfaced. Also independently re-derived the `REPO_ROOT`-one-level-above-repo-root arithmetic from `registry.ts:21,25` against the real bundle target `packages/quay/dist/quay.js` (4 levels up from `packages/quay/dist/` lands one directory above the actual repo root) — matches the plan's own math exactly; `factories/document-contract.ts`'s `makeDocumentContractGate` re-read in full confirms `createDocumentStore`/`store.get` are called only inside the returned async gate function's body, never at module load — the "lazy" claim holds.

**Stage ordering/dependency check:** unchanged by any of round 1's or round 2's corrections — Phase 1 → {2, 3 in parallel} → 4 (depends on 2) → 5 (depends on 2, 3, 4). No forward-dependency violation found.

**Per-stage TDD tag/acceptance check:** with the Stage 1.2/3.2 fix applied above, every `[code]`-tagged stage now either (a) states a literal ≥80% coverage requirement against a real new source/test file, or (b) is explicitly out of the classifier's scope (Stage 2.2's pre-existing-suite-rerun half; Stage 5.1's no-new-Files invocation) with that scoping stated honestly rather than blended into a fabricated percentage. Every `[prose]`-tagged stage (4.1, 4.2) uses the mechanical-check/grep-verification branch, consistent with the classifier. No remaining inconsistency found.

**F_i = 1** material finding this round:
1. Stages 1.2 and 3.2: round-1's own new "no line-coverage % applies" disclaimers (added to fix round-1 finding #4) conflict with the `quay-task-to-plan` skill's own mandatory, no-exceptions code-branch coverage gate — a `.test.mjs` file is explicitly code-branch, not exemptable, regardless of how trivial the resulting number is expected to be. Corrected in place: both stages now require the actual (expected ~100%) coverage number to be computed and pasted, with an honest caveat about what it does and doesn't measure, rather than declining to measure at all.

**Convergence verdict: NOT CONVERGED (F_i = 1 > 0).** One localized wording fix (both instances are the same root cause); no stage added/removed/reordered/re-budgeted; a round 3 check should confirm this fix reads correctly and do one more independent scan, per the 3-round cap.
