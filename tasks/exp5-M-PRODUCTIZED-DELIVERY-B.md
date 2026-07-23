---
id: exp5-M-PRODUCTIZED-DELIVERY-B
title: "Productized delivery child B: checked-in delivery-manifest (single
  source of the shipped artifact set: 4 package tarballs + plugin bundle) + a
  test that asserts release.yml produces EXACTLY that set"
status: todo
labels:
  - milestone-candidate
  - milestone:M-129
parent: exp5-M-PRODUCTIZED-DELIVERY
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-PRODUCTIZED-DELIVERY-B
    experiments/quay-perpetual-stream/charters/M129-productized-delivery-b-manifest.md
    /tmp/m129-absorb-entry.md
  schema: v1
---
## Proposal

SPLIT-OR-COMMIT child 2 of [[exp5-M-PRODUCTIZED-DELIVERY]] (DIR-061), attacking the **manifest-items**
conjunct of chart-2 **S2 Delivery-completeness**. Author a checked-in **delivery-manifest** that enumerates
every release artifact (tarballs for `quay`, `quay-native`, `quay-github`, `quay-backlog` + the Claude Code
plugin bundle), and a test that asserts `release.yml` produces EXACTLY that set — no more, no less.

This manifest is deliberately the **single source of truth** that [[DIR-065]] anchors the redefinition of
"product" to (product = manifest-declared shipped files + the pipeline producing them), so the two land as
one coherent single-source, not two drifting lists. Loop-autonomous (manifest file + assertion test at the
config level; no real release needed to complete this child — the real release is
[[exp5-M-PRODUCTIZED-DELIVERY-C]]). Depends on [[exp5-M-PRODUCTIZED-DELIVERY-A]] so the manifest carries the
unified version.

## Plan
N/A — focused milestone. Design surface (manifest shape) is genuine but small; fix it minimally as the
single source both the release gate and DIR-065's classifier read.

## Acceptance Criteria
- [ ] A checked-in delivery-manifest file exists and enumerates every release artifact (4 package tarballs
  + plugin bundle).
- [ ] A test asserts the artifact set `release.yml` produces == the manifest set; RED when they diverge
  (a deliberately-removed artifact makes it fail — pasted), GREEN when aligned (pasted).
- [ ] Sibling `*.test.mjs` ≥80% coverage; `loadbearing-test-gate.sh` PASS.
- [ ] `node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')` + any
  `plugin/test/*.mjs` stay green.

## Definition of Done
Standard inherited-core DoD clauses apply. Per DIR-026 Reading A: a manifest that merely exists is
necessary-not-sufficient — done ONLY when the assertion actually runs GREEN against the real `release.yml`
AND a deliberate divergence makes it RED, both pasted.
- [ ] RED+GREEN of the manifest↔release.yml assertion demonstrated on the real pipeline.
- [ ] The manifest is referenced as the single source by the release gate (not a parallel copy).
- [ ] it0 DoD meta-enforcer passes all clauses.
- [ ] Depends-on [[exp5-M-PRODUCTIZED-DELIVERY-A]] recorded satisfied (unified version present in manifest).
