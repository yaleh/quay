---
id: DIR-042-A
title: "DIR-042 child A: generic runner-agnostic DoD gate SET
  (test-pass/coverage-floor/red-green) parameterized by workspace config; exp5's
  own it0 checks re-expressed as consumers"
status: done
labels:
  - directive
  - milestone-candidate
parent: DIR-042
children: []
extra:
  schema: v1
  dirStatus: resolved
---
## Proposal
Child A (of [[DIR-042]]) — Level A: deliver the **generic, runner-agnostic DoD gate SET** (test-pass / coverage-floor / red-green) as a product deliverable, parameterized entirely by workspace config (command + threshold), with zero test-runner or language name anywhere in delivered `packages/**` code. Then re-express exp5's OWN `it0-*.sh` DoD checks as CONSUMERS of these product gates (its node:test commands supplied as data), closing the single-source gap DIR-042's Finding identified (`.quay/gates.yml` `it0:` entries currently point at exp5's own scripts, not a product gate factory).

## Plan
N/A — resolved via an in-repo product milestone. Extends the existing data-driven gate engine (`makeIt0Gate`/`makeAdrGate`/`makeFixedScriptGate` in `packages/quay/src/gate/registry.js`, ADR-013) with new generic factories; no separate staged plan file needed at this scope.

## Finding
Carried from [[DIR-042]]'s Finding: the gate ENGINE is already data-driven (✅), but the DoD-check LOGIC (test-pass / coverage-floor / RED→GREEN evidence) exists only as exp5's own `experiments/quay-perpetual-stream/scripts/it0-*.sh`, node:test-shaped and exp5-located — a foreign project must reimplement it rather than configure it.

## Requested action
1. Add generic gate factories to the product's gate registry: `test-pass` (runs a workspace-configured test command, PASS iff exit 0), `coverage-floor` (runs a workspace-configured coverage command + compares against a workspace-configured threshold), `red-green` (the reusable RED→GREEN evidence-shape check, parameterized, not node:test-specific).
2. Wire these via `.quay/gates.yml` config (command + threshold as workspace data), mirroring the existing `makeAdrGate`/`makeFixedScriptGate` pattern.
3. Re-express AT LEAST ONE of exp5's own it0 DoD checks (e.g. the test-pass or coverage-floor shape, whichever it0 script most directly matches) as a CONSUMER of the new product gate, with exp5's node:test command supplied as its own workspace config — proving single-source dogfooding, not a second implementation.
4. Confirm zero runner/language name leaks into delivered `packages/**` source.

## Acceptance Criteria
- [x] `grep -riE 'vitest|node --test|go test|pytest|jest' packages/**/src packages/**/bin` returns NOTHING in delivered code — the gate factories take commands as pure config, never a hardcoded runner invocation.
- [x] A scratch/fixture workspace configures a `coverage-floor` gate with its OWN command + threshold via `.quay/gates.yml` → `quay gate <task> --gate coverage-floor` PASSes when actual coverage is above the floor and FAILs when below (a RED+GREEN fixture pair, both demonstrated).
- [x] At least one of exp5's own `it0-*.sh`-shaped DoD checks is re-expressed as a CONSUMER of the new product gate set (its node:test command supplied as `.quay/gates.yml`/`extra` config) — `grep` confirms the check LOGIC lives once, in the product gate, not forked into exp5's script.
- [x] `bash packages/quay/test/delivery-standalone-smoke.sh` stays 0 RED.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts. Done ONLY when:
- [x] The new generic gate factories are real, tested (RED→GREEN, ADR-001), and demonstrated PASS/FAIL correctly against a scratch workspace's own command+threshold, not a fixture-only assertion.
- [x] At least one exp5 it0 check now consumes the product gate (single-source proven by grep + a real re-run), not a duplicated implementation.
- [x] No runner/language name in delivered code (grep-verified); delivery-standalone-smoke stays 0 RED; the it0 DoD meta-enforcer passes.
- [x] Per DIR-026: lands done or `needs-human`; no prose-only deferral.

## Human verification when exp5 marks this done
1. Does `grep -riE 'vitest|node --test|go test|pytest'` over delivered `packages/**` return nothing?
2. Does a scratch workspace's own coverage-floor command+threshold genuinely PASS/FAIL the gate correctly (both directions demonstrated)?
3. Is at least one exp5 it0 check now a CONSUMER of the product gate (not a second implementation)?
4. Does delivery-standalone-smoke stay 0 RED?
5. If the DoD logic still only exists as exp5's own script, or any runner name leaked into delivered code, it is NOT landed — send back.
