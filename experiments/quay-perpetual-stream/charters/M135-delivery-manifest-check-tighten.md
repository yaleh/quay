# M135 — delivery-manifest-check tighten (doc-vs-doc → doc-vs-reality)

**Task:** `exp5-DEFECT-DELIVERY-MANIFEST-INCOMPLETE-RELEASE`
**Milestone counter:** 135
**Chart:** 2
**Class:** development (capability-growth/instrument-correction — shipped check code)
**Value type:** instrument-correction
**Cadence:** exploit (streak=2/4, not due for explore)
**Deliverable:** yes (shipped CI check code consumed by the release pipeline)
**Charter tokens:** ~1.5 K

## Value hypothesis

`Δv̂ = 0` (S2 already at 1.00 — all 3 conjuncts true; this fix tightens an existing check's
honesty without changing cov). Real value is instrument-correction: preventing a future silent
divergence where the check passes on build-step existence but the actual release is incomplete.

**Metric Y:** `delivery-manifest-check` `--ci` mode exit code on the next tagged release run.
RED when a declared artifact is missing from the actual GitHub Release; GREEN when all declared
artifacts are present.

## Scope

### Investigation finding (pre-build)

The original defect task claimed release.yml publishes 4/7 manifest entries. Live inspection
(2026-07-24) reveals:

- **release.yml DOES build quay-native SEA** (`bash packages/quay-native/scripts/build-sea.sh`
  confirmed present on the `sea-release` job, line-matched via `grep`).
- **The manifest correctly documents bundling:** quay-native SEA is assembled together with quay
  SEA in one archive per platform (manifest `sea-binaries[quay-native].note`); the plugin is
  inside the npm-pack tarball (`manifest.plugin.note`).
- **4 published assets cover all 7 entries via bundling** — the "4/7" count is a counting
  artifact (GitHub Release asset count ≠ manifest entry count when bundling is documented).

The REAL gap is narrower: `delivery-manifest-check.ts` validates manifest ↔ release.yml
(build-step existence), not manifest ↔ actual published release assets. Both doc sources agree —
but neither is checked against reality. The single-source guarantee M129 intended ("no more, no
less") has no runtime verification leg.

### Real scope

1. **Add `--ci` mode to `delivery-manifest-check.ts`** — when `GITHUB_TOKEN` is available (CI
   environment on a tagged release), fetch the actual GitHub Release assets via the REST API and
   verify every manifest entry has a corresponding published artifact (accounting for bundling:
   quay-native inside quay SEA archive, plugin inside npm tarball). Non-CI mode (no token) is
   unchanged — still validates manifest ↔ release.yml alignment.
2. **RED fixture:** with a deliberately missing artifact entry in the manifest (one that doesn't
   correspond to any real published asset), `--ci` mode exits non-zero.
3. **GREEN proof:** on a real tagged release run, `--ci` mode exits zero — all declared
   artifacts present in the actual GitHub Release.
4. **Sibling test:** `delivery-manifest-check.test.ts` extended to cover `--ci` mode parsing
   (mock GitHub API responses), ≥80% coverage.

### Explicit exclusions

- Do NOT extend release.yml (it already builds quay-native SEA; bundling is correct).
- Do NOT change the manifest structure (it already correctly documents reality).
- Do NOT change `chart2-s2-delivery-completeness.ts` or S2 cov (S2 is already 1.00; this
  tightens the evidence backing, not the score).

## Done-when (binary)

1. `delivery-manifest-check.ts --ci` mode exists: when `GITHUB_TOKEN` is set and the run is on
   a tag, fetches actual GitHub Release assets and verifies manifest entries are covered. When
   `GITHUB_TOKEN` is unset, unchanged behavior (manifest ↔ release.yml).
2. RED fixture: a manifest entry with no matching published asset → `--ci` mode exits non-zero
   (pasted).
3. GREEN: `--ci` mode on a real release run exits zero (pasted from CI log, or proven via
   `gh release view` cross-check on the most recent release).
4. `delivery-manifest-check.test.ts` extended, ≥80% coverage, `loadbearing-test-gate.sh` PASS.
5. `node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')`
   stays green.

## Inner termination

- **Done-when-complete** (all 5 clauses satisfied) OR
- **ΔV < 0.02 K=2 consecutive** (N/A — instrument-correction, Δv̂=0) OR
- **Budget ≈ 10 ∧ not climbing** (this is an exploit, small scope — 1 build iteration +
  verification) OR
- **Ceiling → redesign** (not applicable — small scope) OR
- **External HALT** (.halt sentinel)

## it0 systematic-explore checks

**In-scope gap subset:** none — this is a newly-discovered defect (2026-07-24), not tracked in
the inherited exp4 gap-list (`experiments/quay-continuous-bootstrap/gap-list.md`). The task
is a native task-store entry, not a gap-list row. No gap-list IDs or directive IDs cited.

### a. Ceiling arithmetic

Scope is ~200 lines of TypeScript (the `--ci` mode addition to `delivery-manifest-check.ts` +
test extension). Well within ≤2000-line ceiling. No phase/stage plan needed.

### b. Gate-hash (invariant 3)

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131, the HARD GATES block)

### c. Dogfooding evidence-gate

The check itself IS the deliverable — it runs on quay's own release pipeline. Evidence is
self-dogfooding by construction.

### d. Domain-misfit audit-channel

The CI runner in a tagged release workflow IS the independent audit channel (differently
provisioned environment, external trigger). Same established pattern as M01-dist/M03-abi-eval
(confirmed, consolidated in `inherited-core.md`).

### e. Line-budget gate

Run `scripts/it0-ceiling-line-budget-check.sh` against this charter before dispatch.

## Charter pinned reference

- **inherited-core.md** (Tier-B): `experiments/quay-perpetual-stream/inherited-core.md`
  at `git rev-parse HEAD:experiments/quay-perpetual-stream/inherited-core.md`
