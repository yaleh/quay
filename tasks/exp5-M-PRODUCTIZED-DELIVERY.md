---
id: exp5-M-PRODUCTIZED-DELIVERY
title: "Complete productized delivery: all 4 packages + Claude Code plugin as
  one version-consistent unit (DIR-061)"
status: todo
labels:
  - milestone-candidate
  - epic
parent: null
children:
  - exp5-M-PRODUCTIZED-DELIVERY-A
  - exp5-M-PRODUCTIZED-DELIVERY-B
  - exp5-M-PRODUCTIZED-DELIVERY-C
  - exp5-M-PRODUCTIZED-DELIVERY-D
extra:
  schema: v1
---
## Proposal

DIR-061 (2026-07-23, from a delivery-scope audit + a read-only inspection of the real downstream
consumer `/home/yale/work/archguard`): the intended productized delivery is all 4 packages (`quay`,
`quay-native`, `quay-github`, `quay-backlog`) + the Claude Code plugin, but the current release
pipeline delivers only a fragment (Core-only npm-pack; SEA covers quay+quay-native only;
quay-github's tests excluded from the release gate; quay-github/quay-backlog never published), ships
with pervasive version drift (5 different version numbers for the same plugin observed across the
installed cache, plugin.json, 2 marketplace.json files, and vendored Core), and provides no coherent
way for a foreign workspace (verified against archguard) to actually install the Provider entrypoints
Core needs to spawn.

**Blocked on `exp5-M-NODE-FLOOR-DISTRIBUTION-FIX` (DIR-060)** — no real release can be cut/proven
until the Node-floor distribution regression is fixed; DIR-061's own text explicitly sequences this
directive second.

This is a design-carrying, multi-part epic per DIR-061's own admission — requires SPLIT-OR-COMMIT
(DIR-026) into completable children before any one is selected:
1. Delivery-manifest authoring + release.yml coverage extension (all 4 package tarballs + plugin bundle).
2. Version-unification single-source + fail-closed drift check (RED/GREEN demonstrated).
3. Foreign-workspace Provider-install mechanism (bundle providers in the plugin, or a documented
   runnable install step).
4. End-to-end proof against archguard (real Provider-ABI task-status write observed).

## Plan
N/A — this epic requires the `quay-task-to-plan` pipeline once DIR-060 clears and it's ready to be
split into children (design surface: manifest shape, versioning single source, provider-install
mechanism — genuine design decisions, not a mechanical port).

## Acceptance Criteria
- [ ] A checked-in delivery-manifest file exists and enumerates every release artifact; a test asserts `release.yml` produces exactly that set.
- [ ] A version-consistency check FAILs on drift and PASSes only when all 4 packages + plugin manifest fields + vendored Core carry the SAME version — RED+GREEN demonstrated.
- [ ] A real release run (post-DIR-060) publishes tarballs for all packages on the manifest AND the plugin bundle.
- [ ] In a clean foreign workspace (archguard or equivalent), `quay --provider native task list` resolves the Provider MCP and returns tasks, AND a real task-status transition is observed via `quay gate-log`/`task get`.
- [ ] `node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')` + `node --test plugin/test/*.mjs` stay green before/after.

## Definition of Done
Standard inherited-core DoD clauses apply. Per DIR-026 Reading A: NOT done when a manifest/check
merely exists — necessary-not-sufficient. Done ONLY when a real release has published the full
manifest artifact set AND the foreign-workspace proof is a real observed object (not "should work").
- [ ] SPLIT-OR-COMMIT applied before any child is selected (DIR-026) — this parent stays `todo`
  until fully decomposed into independently-completable children, none selected partial.
- [ ] All 5 AC items above satisfied by the children collectively, each with pasted evidence.
- [ ] it0 DoD meta-enforcer passes all clauses.
- [ ] DIR-061 dispositioned `applied` with this task's completion evidence cited in its own Resolution.

## Not selected (M120)

Not selected M120 — deliberately deferred: this directive's own text sequences it AFTER
`exp5-M-NODE-FLOOR-DISTRIBUTION-FIX` (DIR-060), and its own scope explicitly requires SPLIT-OR-COMMIT
into children before any single child can be selected (not yet decomposed). Blocked, not abandoned.

## Not selected (M121)

Still not decomposed into children (SPLIT-OR-COMMIT not yet applied) — not selectable as-is.
`exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` selected instead, itself a real prerequisite of good standing
for a future productized-delivery push (a working Core SEA binary).

## Split (SPLIT-OR-COMMIT applied, 2026-07-23 — human-steered, post-cp-125)

Human-steering decision after cp-125's HALT-RECOMMENDED (governance:product 431:1): the governance-heavy
window (chart-2 stand-up + distribution hardening + DoD-checker defect clearance, M121–M125) is confirmed a
legitimate but **completed** phase; SELECT is redirected to this epic — the darkest product surfaces are
chart-2 **S2 Delivery-completeness = 0.00** and **S3 External-validation-reach = 0.10**. DIR-060 is applied,
so this epic is now decomposed into 4 independently-completable children (DIR-026 SPLIT-OR-COMMIT satisfied):

| child | attacks | selectable | steering | Δv it moves |
|---|---|---|---|---|
| [[exp5-M-PRODUCTIZED-DELIVERY-A]] version single-source + fail-closed drift gate | S2 conjunct *version-consistent* | **now** (no dep) | loop-autonomous | ratio (adds real product-pipeline code); S2 cov only at C |
| [[exp5-M-PRODUCTIZED-DELIVERY-B]] delivery-manifest single-source + release.yml coverage assertion | S2 conjunct *manifest-items* | after A | loop-autonomous | ratio; also the single source [[DIR-065]] anchors "product" to |
| [[exp5-M-PRODUCTIZED-DELIVERY-C]] REAL full-manifest release | S2 conjunct *published* → **realizes S2** | after A+B | **human-steered** (real outward publish) | real S2 chart-2 Δv |
| [[exp5-M-PRODUCTIZED-DELIVERY-D]] foreign-workspace install + archguard E2E | S3 external-validation | after C | **human-steered** (touches foreign workspace) | real S3 chart-2 Δv |

Honest note on the ratio vs. VT split: A/B are real product-pipeline work and are the loop-autonomous entry
point, but S2 **cov** (and thus chart-2 Δv) only realizes at C's real publish and D's real foreign install —
you cannot fake a real npm publish or a real foreign GateEvent. So A/B build confidence + gates now; C/D are
the human-steered outward acts that actually move S2/S3. Whether A/B's pipeline scripts COUNT as "product"
in the governance:product ratio depends on [[DIR-065]] (product = manifest-declared shipped files + the
pipeline producing them) — that is an instrument fix, tracked separately, NOT a way to clear this HALT.

This parent stays `todo` (epic umbrella) until the 4 children collectively satisfy all 5 AC.