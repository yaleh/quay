# M168 — Wire human-steered definition into inherited-core + OUTER-LOOP SELECT

**Task:** DIR-062-B · **Counter:** 168 · **Chart:** 2
**Class:** development · **Value type:** governance-integrity
**Deliverable:** yes · **Charter tokens:** ~0.8 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0. Wires DIR-062-A's human-steered-classify into the OUTER-LOOP SELECT step, replacing per-task hand-labeling with a computed classification. The 3-part definition (driver-self-rewrite / mission-redirection / cross-workspace) becomes the canonical statement in inherited-core.md. `label:human-steered` retained as override/escape hatch only.

## Scope
Two driver edits per DIR-062-B:
1. Record the tightened 3-part human-steered definition in inherited-core.md
2. Wire OUTER-LOOP.md SELECT to invoke the already-landed human-steered-classify script

## Touches
- experiments/quay-perpetual-stream/inherited-core.md
- experiments/quay-perpetual-stream/OUTER-LOOP.md

## Done-when
1. inherited-core.md contains the three clause markers (driver-self-rewrite / mission-redirection / cross-workspace) with clause-3 naming drivable-workspaces.yml
2. OUTER-LOOP.md SELECT step invokes human-steered-classify
3. Golden-replay: classifier verdict matches existing hand-labels
4. All existing driver selfchecks + fixtures stay green
5. split-or-commit check passes

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
