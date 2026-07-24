# M135 — delivery-manifest-check --ci mode (plan)

**Task:** `exp5-DEFECT-DELIVERY-MANIFEST-INCOMPLETE-RELEASE`
**Charter:** `experiments/quay-perpetual-stream/charters/M135-delivery-manifest-check-tighten.md`
**Class:** development (capability-growth/instrument-correction)
**Proposal source:** adjudicated 2026-07-24, 3-persona convergence
**Milestone line budget:** ~180 lines (well under ≤2000 ceiling)

## Phase 1 — Implementation (~180 lines)

### Stage 1: `checkCi()` function + `--ci` CLI flag [code] (~120 lines)

**File:** `scripts/delivery-manifest-check.ts`

**Dependencies:** none (reads only existing `readManifest()`, delivery-manifest.json)

**What:**
1. Add `CiCheckResult` interface (extends `ManifestCheckResult` with `ciMode`, `releaseTag`, `publishedAssetCount`)
2. Add `checkCi(root: string, githubToken: string): Promise<CiCheckResult>` function:
   - Read manifest via existing `readManifest()`
   - Determine `GITHUB_REPOSITORY` and current tag from env (`GITHUB_REPOSITORY`, `GITHUB_REF_NAME`)
   - Fetch release assets via `GET /repos/{owner}/{repo}/releases/tags/{tag}` with `Authorization: Bearer ${githubToken}`
   - Build set of published asset names from API response
   - For each manifest entry, determine if a matching published asset exists:
     - **npm-tarball entries:** match by `artifactPattern` (e.g. `quay-{version}.tgz` → check asset names against pattern)
     - **SEA binary entries without `bundled-with`:** match by package name + platform (e.g. `quay-sea-{version}-linux-x64.tar.gz`)
     - **SEA binary entries with `bundled-with`:** skip individual match — satisfied iff the `bundled-with` package's asset exists
     - **plugin entries with `note` containing "Included in the npm-pack tarball":** skip individual match — satisfied iff the npm tarball asset exists
   - Report issues for any manifest entry not covered by a published asset
   - Fail-closed on API errors (network failure, 4xx, 5xx → non-zero exit with actionable message)
3. Update CLI section to parse `--ci` flag and dispatch to `checkCi()` when present, `check()` when absent
4. When `--ci` is passed but `GITHUB_TOKEN` is not set, exit with error: "GITHUB_TOKEN not set — --ci mode requires a GitHub token"

**TDD acceptance:** >=80% line coverage on new code (checkCi function + CLI dispatch)

**Line estimate:** ~120 lines

### Stage 2: Test extension [code] (~60 lines)

**File:** `scripts/delivery-manifest-check.test.ts`

**Dependencies:** Stage 1 (checkCi function exported)

**What:**
1. Add mock `fetch` helper that returns configurable JSON responses
2. Test: `checkCi` GREEN — mock API returns assets matching manifest entries → ok=true, no issues
3. Test: `checkCi` RED — mock API returns assets missing a declared entry → ok=false, issues include the gap
4. Test: `checkCi` RED — manifest entry with `bundled-with` but bundled package's asset missing → ok=false
5. Test: `checkCi` fail-closed — mock `fetch` throws/rejects (network error) → ok=false
6. Test: `checkCi` fail-closed — mock API returns 401 → ok=false
7. Test: CLI `--ci` with mock token → integration test (execSync with mocked env)
8. Test: CLI `--ci` without GITHUB_TOKEN → exits non-zero with clear message

**TDD acceptance:** >=80% overall test coverage (combined Stage 1 + Stage 2 lines)

**Line estimate:** ~60 lines

## Per-stage TDD gate summary

| Stage | Tag | TDD gate | Estimate |
|-------|-----|----------|----------|
| Stage 1 | [code] | >=80% line coverage | ~120 lines |
| Stage 2 | [code] | >=80% line coverage (combined) | ~60 lines |
| **Total** | | | **~180 lines** |
