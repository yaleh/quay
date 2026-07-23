# Charter M129-productized-delivery-b — delivery-manifest + release.yml assertion

**Milestone id:** M129
**Task:** `tasks/exp5-M-PRODUCTIZED-DELIVERY-B.md`
**Surface:** development-class / capability-growth (chart-2 S2, manifest-items conjunct)
**Base commit:** master HEAD (13d18b2, M128 ABSORB)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

DIR-061 SPLIT into 4 children. Child A (version-consistency, M126) is done. Child B is now unblocked —
author a checked-in delivery-manifest enumerating all release artifacts + a test asserting release.yml
produces exactly that set. The manifest is the single source for DIR-065's product redefinition.

## SELECT

DIR-066 Round-1: incoming streak=1 (M127 N; M128 exempt). f=0.167, dSeats=1, nSeats=3.
Shortlist: {PRODUCTIZED-DELIVERY-B (D, rank 1), ...}. Round 2: PRODUCTIZED-DELIVERY-B —
only autonomous D candidate, chart-2 S2 mover (manifest-items conjunct), unblocked post-M126.

## Scope

1. A checked-in `delivery-manifest.yml` (or `.json`) enumerating 4 package tarballs + plugin bundle.
2. A test asserting release.yml's artifact set == manifest set.
3. RED (deliberate divergence) + GREEN (aligned) demonstrated.

## Class routing

Development-class (new manifest file + test). Design surface is small/fixed — direct dispatch.

## GATE-HASH-REF

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93
