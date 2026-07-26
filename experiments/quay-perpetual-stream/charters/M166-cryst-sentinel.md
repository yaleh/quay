# M166 — rm -f for idempotent sentinel removal
**Task:** exp5-CRYST-SENTINEL-REMOVAL-IDEMPOTENT · **Counter:** 166 · **Chart:** 2
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93
## Scope
Replace rm with rm -f for sentinel file removal operations.
## Touches
- experiments/quay-perpetual-stream/OUTER-LOOP.md
## Done-when
1. rm -f used for sentinel removal (idempotent when absent).
## Pointer
inherited-core.md @ d6738ba
