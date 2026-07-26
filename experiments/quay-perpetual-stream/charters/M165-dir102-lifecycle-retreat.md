# M165 — Allow lifecycle_retreat from needs-human to todo
**Task:** DIR-102 · **Counter:** 165 · **Chart:** 2 · **Class:** development · **Value type:** capability-growth · **Deliverable:** no
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93
## Value hypothesis
Δv̂ = 0. Allows retreating needs-human tasks back to todo.
## Scope
Add retreat transition: needs-human → todo.
## Touches
- packages/quay/src/gate/lifecycle.ts
## Done-when
1. lifecycle_retreat supports needs-human → todo transition.
2. Existing lifecycle tests pass.
## Pointer
inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
