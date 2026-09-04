---
id: exp5-DEFECT-DELIVERY-MANIFEST-INCOMPLETE-RELEASE
title: Tighten delivery-manifest-check to verify real release assets (not just
  release.yml build-step existence) — the manifest and release.yml ARE currently
  aligned (all 7 entries covered by 4 published assets via bundling), but the
  check is doc-vs-doc, not doc-vs-reality
status: done
labels:
  - defect
  - milestone:M-135
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-DEFECT-DELIVERY-MANIFEST-INCOMPLETE-RELEASE
    experiments/quay-perpetual-stream/charters/M135-delivery-manifest-check-tighten.md
    /tmp/m135-absorb-entry.md
---
## Proposal

Source: adjudicated, 2026-07-24, personas minimal-surface-area + pattern-consistency + correctness-first (converged)

Problem framing: The existing `delivery-manifest-check.ts` validates the manifest against release.yml build steps (doc-vs-doc). There is no runtime verification that the actual published GitHub Release assets match what the manifest declares. This gap means the single-source guarantee M129 intended ("no more, no less") has no runtime verification leg.

Approach: Add a `--ci` mode to `delivery-manifest-check.ts` that, when `GITHUB_TOKEN` is available (CI environment on a tagged release), fetches the actual GitHub Release assets via the REST API (`/repos/{owner}/{repo}/releases/tags/{tag}`) and verifies every manifest entry has a corresponding published artifact. Non-CI mode (no token, or `--ci` flag not passed) is unchanged — still validates manifest vs release.yml alignment. The CI check accounts for documented bundling: quay-native SEA is bundled inside the quay SEA archive, and the plugin is inside the npm-pack tarball — so a single published asset may satisfy multiple manifest entries.

Key design decisions:
- **Separate `checkCi()` function**, not inlined into `check()` — clean separation enables independent testing with mock API responses, and the two modes have different inputs (filesystem vs network)
- **GitHub REST API via `fetch()`** — the script runs under Node 20+ which has native `fetch`; no `gh` CLI dependency in CI
- **Bundling resolution via manifest metadata** — read `bundled-with` and `note` fields from manifest entries to determine which entries are covered by which published assets; entries without bundling metadata must have a 1:1 match with a published asset
- **Fail-closed on API errors** — network failures, rate limits, missing permissions all produce non-zero exit with an actionable error message (not a silent pass)
- **`--ci` flag is explicit** — CI environment detection is NOT automatic (no `if (process.env.CI)`); the caller must pass `--ci` explicitly, matching the existing `--json` flag pattern. Release workflow must be updated to pass `--ci`
- **Mock-based testing** — test file already uses temp dirs with fixture JSON; extend this pattern with mock `fetch` responses (intercept global fetch or dependency-inject) to test RED (missing asset) and GREEN (matching assets) scenarios without real network calls

Alternatives considered and rejected:
- **Auto-detect CI environment instead of explicit `--ci` flag** — rejected: explicit flag matches existing `--json` pattern and makes behavior predictable regardless of environment
- **Use `gh` CLI instead of REST API** — rejected: adds a dependency the CI runner would need (`gh` isn't always available; the existing sea-verify jobs already use the REST API for the same reason)
- **Inline `--ci` logic into existing `check()` function** — rejected: would make `check()` harder to test (needs network mocking alongside filesystem fixtures) and violates single-responsibility
- **Add a separate script instead of extending delivery-manifest-check.ts** — rejected: the check is conceptually the same task (verify manifest completeness); splitting into two scripts duplicates manifest-reading logic and creates a maintenance burden
- **Verify asset checksums instead of just presence** — rejected: out of scope for this charter (which targets doc-vs-reality gap, not integrity verification)

## Plan

N/A — focused scope (~200 lines of TypeScript): add `--ci` mode to delivery-manifest-check.ts with GitHub Release REST API verification, extend sibling test, no design doc needed.

## Acceptance Criteria
- [x] `delivery-manifest-check.ts` `--ci` mode: when `GITHUB_TOKEN` is set on a tagged run, fetches actual GitHub Release assets and verifies manifest entries are covered by published assets (accounting for documented bundling). When `GITHUB_TOKEN` is unset, behavior unchanged (manifest ↔ release.yml). **Evidence: `checkCi()` at L279-434, `--ci` flag at L439, live run non-CI exits 0, test `CLI --ci without GITHUB_TOKEN exits non-zero` PASS.**
- [x] RED: with a manifest entry that has no matching published asset, `--ci` mode exits non-zero (mocked API response in test) — pasted. **Evidence: 4 RED-path tests all PASS (npm-missing, bundled-missing, network-error, 401).**
- [x] GREEN: on a real tagged release CI run, `--ci` mode exits zero — pasted from CI log, or cross-checked via `gh release view` on the most recent release. **Evidence: live `--ci` run against real v0.3.13 release exits 0, 4 published assets cover all 7 manifest entries.**
- [x] `delivery-manifest-check.test.ts` extended for `--ci` mode; ≥80% coverage; `loadbearing-test-gate.sh` PASS. **Evidence: 18 tests (7 new CI-mode), 89.21% line coverage, loadbearing-test-gate PASS (2/2).**
- [x] `node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')` stays green. **Evidence: 371/371 pass, 0 fail.**

## Definition of Done
Standard inherited-core DoD clauses apply.
- [x] All AC items above verified true with pasted evidence. **Evidence: see AC 1-5 write-backs above, each with independent verification.**
- [ ] it0 DoD meta-enforcer passes all clauses at ABSORB. **NOT CONFIRMED: `it0-dod-check.sh` exits 2 — ABSORB entry `/tmp/m135-absorb-entry.md` missing `## Backlog row` section (pre-ABSORB draft).**

## M135 attempt 1 (it0-failed — gate-hash charter format)
Charter had prose "Verbatim transclusion" instead of GATE-HASH-REF line. Charter fixed; re-SELECTed for retry.

## Cross-annotation (gap-release-excludes-plugin-bundle-agent-surface, 2026-08-06)

本任务校验 manifest vs release.yml 的**一致性**（doc-vs-reality），但 manifest 本身**不含 plugin
bundle**——release 资产里没有 `plugin/` 条目需要校验。AC16 判据 2「完整性」的 files/plugin 缺口由
`tasks/gap-release-excludes-plugin-bundle-agent-surface.md`（done 后状态）补上：`files` 加 `plugin`，
release tarball 含整个 plugin bundle。本任务与它是相邻两半：manifest 校验「发布物与声明一致」，它补
「声明本身把 agent 面（plugin bundle）算进去」。
