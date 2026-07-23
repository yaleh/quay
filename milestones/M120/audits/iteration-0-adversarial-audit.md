# M120 — Independent Adversarial Acceptance Audit (iteration 0)

**Audit session id:** a913b84eb5f2265f9
**Orchestrator session id:** 145cc0be-0e0e-4eb4-a1aa-9d47637114c0

**Note (orchestrator-authored, per inherited-core.md's Adversarial-audit role item 5):** the line
above was written by the ORCHESTRATOR, using the `Agent` tool's own returned dispatch id
(`a913b84eb5f2265f9`), recorded in `/tmp/m120-dispatch-record.txt` at dispatch time — not
self-reported by the subagent. This artifact was produced in the subagent's own isolated worktree
(its sandbox declined a direct write to the shared checkout) and landed into the main tree by the
orchestrator afterward, content unchanged. This audit's own AC1/AC4 findings will be cited in a
later, final task write-back once Phase 5 Stage 5.2 (the real release-workflow trigger, reserved
for the orchestrator) produces AC2/AC3's evidence — see the task's eventual `## Resolution`.

**Task:** `exp5-M-NODE-FLOOR-DISTRIBUTION-FIX` (DIR-060, release-blocking)
**Auditor stance:** REFUTE-FIRST, fresh context, NOT the implementing session.
**Audited commit:** `3decd71` (Merge M120 implementation (Phases 1-4) into master) — tip of `master`.
**Audit date:** 2026-07-23
**Host Node:** v25.2.0 (NOT Node 20 — see AC2/AC3 scope note).

## Verdict: **CONCERNS** (one non-blocking finding; no Done-when claim refuted)

I could not REFUTE any of the milestone's locally-verifiable claims. Every check that could be
run locally reproduces the implementation report's results. I record one legitimate CONCERNS-level
finding (the dependency-bundling deviation, finding #5) that is real but non-blocking and, on
investigation, largely harmless.

---

## Worktree-state note (procedural)

My worktree was checked out at `ad49578` (an M117-era commit), NOT the promised M120 tip. `3decd71`
existed in the repo but was not an ancestor of my HEAD, and `packages/quay/scripts/build-dist.mjs`
did not exist. I `git reset --hard 3decd71` (working tree was clean) to reach the M120 merge tip,
confirmed `build-dist.mjs` then present, and ran all checks from there. No dependencies were
installed in the fresh worktree; I ran `npm install` at the root (npm workspaces) — this is the only
source of the `M package-lock.json` entry in `git status` (verified: `git log f969373..3decd71 --
package-lock.json` is empty, i.e. M120 did not touch the lockfile).

---

## 1. Full test suites — re-run SEQUENTIALLY, independently (not trusting pasted output)

| Suite | Command | Result | Report claim | Match |
|---|---|---|---|---|
| quay | `node --test <46 files, excl serve-github/provider-abi>` | **tests 371 / pass 371 / fail 0** (~157s) | 371/371 | ✅ |
| quay-native | `node --test test/*.test.mjs` (16 files) | **tests 42 / pass 42 / fail 0** | 42/42 | ✅ |
| plugin | `node --test test/*.mjs` (3 files) | **tests 23 / pass 23 / fail 0** | 23/23 | ✅ |

File counts (46 / 16 / 3) independently confirmed via `ls`. All three suites GREEN, exactly matching
the iteration-0 report. **AC4 (full non-flaky suite green before/after) is genuinely MET.** No port
collision or flakiness observed running sequentially.

## 2. AC1 grep — genuinely passes

```
grep -rIl 'bin/quay\(-native\|-github\|-backlog\)\?\.ts' .github/workflows/ plugin/.mcp.json
→ no match
```
**AC1 is genuinely MET.** I additionally confirmed the two former offenders are fixed: `plugin/.mcp.json`
now points at `vendor/quay/dist/quay.js`, and `release.yml`'s release-notes body was reworded from
`bin/quay.ts` to `built as dist/quay.js` (the ROUND-1-correction leftover the plan flagged).

## 3. Build works — independently rebuilt

`rm -rf packages/quay/dist` then `bash packages/quay/scripts/build-dist.sh` → succeeds
(`dist/quay.js  1.2mb`, 116ms). Then:
- `node packages/quay/dist/quay.js --version` → `0.3.5` ✅
- `node packages/quay/dist/quay.js --help` → full usage banner, exit 0 ✅

The build is reproducible from a clean worktree with only `npm install`.

## 4. `exports` genuinely NOT touched — CRITICAL regression check PASSES

The single most important regression (an earlier architect-review round found repointing `exports`
to `./dist/*.js` would break ~29 of 64 test files with `ERR_MODULE_NOT_FOUND`).

`git diff f969373 3decd71 -- packages/quay/package.json` shows **only two hunks**:
- `bin.quay`: `./bin/quay.ts` → `./dist/quay.js`
- `files`: gains `"dist"`

The `exports` block is **byte-identical** before and after — still
`{"./adr-store":"./src/adr-store.ts","./document-store":"./src/document-store.ts","./contract-validator":"./src/contract-validator.ts"}`.
`engines.node` stays `>=20.0.0`. The rejected change was **correctly not made**. The in-workspace
consumer (quay-native, which imports those 3 subpaths) suite is green (42/42), corroborating.

## 6. Git history clean

- `git status`: clean except my own `npm install` lockfile churn (accounted for above).
- `packages/quay/dist/quay.js` is correctly `.gitignore`d (`git check-ignore` confirms); the build I
  ran left no un-ignored stray files.
- `git log --follow -- packages/quay/scripts/build-dist.mjs` → single sensible commit `d627575`
  (Phase 1). `plugin/vendor/quay/dist/quay.js` → `2cc4677` (Phase 3). History is clean and
  phase-attributed.

## 7. Actual diffs spot-checked (not just the report summary)

- **`.gitignore`**: correct `!plugin/vendor/quay/dist/` + `**` negation of the bare `dist/` pattern.
- **`release.yml`**: `release` job Node `20→24` (RUNNER only, `engines` untouched, well-commented);
  `sea-release` stays 20; new `dist-verify-node-floor` job pinned Node `'20'`, `needs: release`.
- **`ci.yml`**: `test` job Node `20→24`; new standalone `dist-verify-node-floor` (Node `'20'`,
  self-builds tarball via `package.sh`, `npm install -g`, runs `quay --help`/`--version`).
- **`package.sh`**: builds `dist/` via `build-dist.sh` before `npm pack`. Correct.
- **`sync-vendor.sh`**: now builds+copies the bundled `dist/quay.js`, slims vendor `package.json`
  (drops `dependencies`), removes `package-lock.json` + the `npm install` step. Well-commented.
- **`plugin/.mcp.json`**: `bin/quay.ts` → `dist/quay.js`. Correct.

**"Mirrors sea-verify-node-free" claim verified genuine:** the `release.yml` floor job's private-repo
asset-fetch (resolve asset id from the release-by-tag API, GET `/releases/assets/{id}` with
`Accept: application/octet-stream`) is **byte-identical** to the existing, proven `sea-verify-node-free`
job (release.yml:227-235 vs :283-291). Reusing a working pattern raises the odds the orchestrator's
real run goes green.

**Vendor bundle standalone runnability independently reproduced:** copying `dist/quay.js` +its sibling
`package.json` into an isolated `/tmp` tree (zero node_modules) and running `--version` → `0.3.5`.
This also reproduces the report's *disclosed* Phase-3 deviation (i): copying `quay.js` *truly* alone
crashes on `version.ts`'s `../package.json` read (I reproduced the exact `ENOENT`), so "standalone"
correctly means zero-node_modules, not zero-sibling-files. The vendor tree carries that package.json;
`vendor package.json` is properly slimmed to name/version/type (`0.3.5`); banner present on line 2
(line 1 is the shebang).

## 8. AC/DoD satisfiability from here

- **AC1**: MET (grep no match, verified).
- **AC4 / full-suite green**: MET (371/371 + 42/42 + 23/23, verified).
- **AC2** (a CI job builds+runs the tarball under Node 20): the job is authored and correct
  (`dist-verify-node-floor` in both workflows, Node `'20'` pinned) but has NO real run evidence yet —
  correctly reserved for the orchestrator's Phase 5 Stage 5.2. **Not faulted** (expected at this
  stage, per audit scope).
- **AC3 / DoD** (real Release-workflow `release` job GREEN): likewise reserved for Stage 5.2. **Not
  faulted.** Everything locally provable is correct, giving the orchestrator's real push the best
  chance of going green.

---

## 5. CONCERNS — dependency-bundling deviation (the one substantive finding)

**Confirmed real:** `packages/quay/scripts/build-dist.mjs` calls `esbuild.build({bundle:true, ...})`
with **no `external` option**, so third-party deps are inlined into `dist/quay.js`. Verified in both
the freshly-built and the committed vendor bundle: 56 `@modelcontextprotocol/sdk` references,
`node_modules/yaml` and `.../sdk/dist/esm/server/zod-compat.js` strings present in the output.

**This does contradict the task `## Proposal`'s own "Alternatives considered and rejected" item**
(`tasks/exp5-M-NODE-FLOOR-DISTRIBUTION-FIX.md:213-214`): *"Ship third-party deps inlined into the
bundle — rejected: duplicates `dependencies`, forfeits npm-level dependency auditing."* (Note: this
item lives in the task's Proposal, not the plan record — the audit brief attributed it to "the plan";
substance is the same.)

**But on investigation it is non-blocking and largely harmless — here is why I did not escalate it to
REFUTED:**

1. **The stated primary harm does not materialize.** `packages/quay/package.json` **still declares**
   `dependencies: {"@modelcontextprotocol/sdk":"^1.12.0","yaml":"^2.5.1"}` (unchanged by M120). So a
   normal `npm install` of the published package still resolves those into `node_modules` and
   `npm audit` still sees them — npm-level dependency auditing is **not** actually forfeited. The
   "duplicates dependencies" objection is technically true (deps exist both bundled and in
   node_modules), but is exactly the same trade-off the repo already accepted.

2. **Bundling is the established repo precedent, not a new choice.** The existing, unmodified
   `packages/quay/scripts/esbuild-sea.mjs` (the SEA build) also does `bundle:true` with no `external`.
   `build-dist.mjs` explicitly bills itself as "the sibling of the SEA build," and the adjudicated
   design decision (task Proposal / adjudication note) was to **"reuse `esbuild-sea.mjs`'s bundling
   approach."** SEA-style bundling *inherently* inlines deps. The "inline deps — rejected" bullet is
   therefore internally inconsistent with the proposal's own adopted design — a documentation defect
   in the rejected-alternatives list, not an implementation deviation from the operative decision.

3. **The plugin-vendor use case genuinely requires self-containment.** Phase 3's whole point is a
   `plugin/vendor/quay/dist/quay.js` that runs with **zero node_modules** (I reproduced this).
   `sync-vendor.sh`'s own new comment states the vendor copy is "fully self-contained (zero external
   runtime deps)" — for this path, bundling is not optional, it's the requirement, and it lets the
   milestone correctly drop the vendor `dependencies`/`package-lock.json`/`npm install` step.

4. **Residual actual risk is minor and pre-existing.** The only genuine downside is *version freeze*:
   the bundled bin is pinned to the deps resolved at build time, so a consumer's `npm audit fix`
   wouldn't patch the running bin without a rebuild/republish. `package.sh` rebuilds `dist/`
   immediately before every `npm pack`, so at publish time the bundle matches the declared ranges;
   the vendor bundle is regenerated by `sync-vendor.sh`. This freeze behavior is **identical to the
   pre-existing SEA build**, so M120 introduces no new class of risk. Larger tarball is negligible
   (~1.2mb, and the SEA path already ships a bundle).

**Disclosure gap (the legitimate part of the concern):** this deviation was **NOT disclosed** in the
iteration-0 report's "Deviations" sections. The report discloses only: Phase 1 (i) depth-matched
temp tree, (ii) `task view` vs `task get`; Phase 3 (i) standalone needs sibling package.json, (ii)
`mcp` needs a parseable config. None mentions that the build inlines deps in direct tension with the
proposal's own rejected-alternatives bullet. An honest report should have noted that the
rejected-alternatives list is inconsistent with the adopted SEA-bundling design. This is a
*documentation/traceability* gap, not a functional defect.

**Recommended (non-blocking) follow-up:** reconcile the proposal's "inline deps — rejected" bullet
with the adopted "reuse SEA bundling" decision (they contradict); optionally add a one-line note in
the milestone record that the dist bundle inlines deps by design (mirroring SEA) while `package.json`
retains declared `dependencies` for auditing.

---

## What I specifically tried to break and could not

- Tried to catch `exports` having been repointed to `./dist/*.js` (the rejected, ~29-test-breaking
  change) → it is byte-identical to base; the guard test asserts this and passes.
- Tried to catch the AC1 grep still matching a stale `.ts` reference → no match; both former
  offenders fixed.
- Tried to catch the pasted test counts being inflated → reproduced 371/42/23 exactly, sequentially.
- Tried to catch the build not actually producing a runnable artifact → rebuilt from clean, runs.
- Tried to catch the "mirrors sea-verify-node-free" claim being loose → asset-fetch is byte-identical.
- Tried to catch stray/un-gitignored scratch files or bad history → clean; `dist/` ignored.
- Tried to escalate the dependency-bundling deviation to a real defect → the declared `dependencies`
  field + the SEA precedent + the plugin's genuine zero-deps requirement reduce it to a disclosed-
  nowhere-but-harmless documentation inconsistency.

**Verdict: CONCERNS** — no Done-when claim refuted; one non-blocking finding (undisclosed
dependency-bundling deviation that contradicts the proposal's own rejected-alternatives bullet but is
functionally harmless because `dependencies` is still declared, bundling mirrors the existing SEA
build, and the plugin-vendor path genuinely requires self-containment). AC2/AC3 correctly reserved
for the orchestrator's real workflow run; everything locally provable is correct.
