---
id: gap-prepare-milestone-noisy-agent-raw-json-parse
title: prepare-milestone.js's Admission/Preflight result parsing used a bare
  JSON.parse(result.raw), which threw and wrongly failed the phase closed
  when a dispatched agent's reported "stdout verbatim" included stderr noise
  ahead of the real JSON -- fixed with a bracket-scanning extractor, first
  real defect found by a genuine Workflow dispatch of the Preflight phase
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test plugin/test/prepare-milestone-convergence.test.mjs
---
## Proposal

Replace the three bare `JSON.parse(result.raw)` call sites in `prepare-milestone.js` (Admission
verdict, Preflight-content verdict, Preflight-plan verdict) with a shared `_parseAgentJson(raw)`
helper that extracts the first balanced, valid `{...}` object span from the string, rather than
assuming the entire `raw` string IS the JSON.

## Finding

Discovered 2026-07-29 during M202/DIR-126-C's own real `prepare-milestone` cold dispatch (`wf_
15785b68-d15`) — the FIRST genuine `Workflow`-dispatched exercise of the M201/DIR-126-B `Preflight`
phase since it landed (Build's own DoD evidence for that phase used a scratch harness with a
mocked `agent()`, never a real dispatch through the actual `Workflow` tool). The real dispatch
failed closed with `{outcome:'needs-human', reason:'preflight-check-failed'}` even though the
underlying `prepare-admission-check.ts --preflight` CLI call itself succeeded cleanly
(`{"ok":true,"policyVersion":"preflight-v1","findings":[]}`) — the dispatched agent's reported
`raw` field had a Node `MODULE_TYPELESS_PACKAGE_JSON` stderr warning line prepended before the real
JSON (despite the agent prompt's explicit instruction "report stdout verbatim... do not paraphrase
or reformat"), and `JSON.parse()` on that noisy string threw, tripping the fail-closed branch on a
call that had actually succeeded. The SAME `JSON.parse(result.raw)` pattern exists at the Admission
verdict and Preflight-plan verdict call sites too — same exposure, confirmed by code read, not yet
independently reproduced live at those two sites (the Admission call in this same real dispatch
happened to get a clean `raw` with no warning noise, so it didn't trip — but it uses the identical
unguarded pattern).

## Requested action

1. Add `_parseAgentJson(raw)` to `prepare-milestone.js` (+ `plugin/workflows/` mirror): scan for
   every `{` occurrence in order (not just the first — a real Node warning's own
   `[MODULE_TYPELESS_PACKAGE_JSON]` bracket-shaped text can itself derail a naive
   first-bracket-of-either-kind search), extract a balanced (string/escape-aware) `{...}` span, and
   return the first one that parses as valid JSON.
2. Replace all three `JSON.parse(result.raw)` call sites (Admission, Preflight-content,
   Preflight-plan verdicts) with `_parseAgentJson(result.raw)`.
3. Add a regression test (real `Workflow`-dispatched-shape mocked-agent harness, not a unit test of
   the helper in isolation) confirming a noisy raw (stderr warning prepended to valid JSON) at both
   the Admission and Preflight-content call sites still parses correctly and does NOT fail the
   phase closed.
4. Re-verify no regression on the existing malformed-JSON fail-closed test (`'not valid json {{{'`
   must still correctly fail closed — the fix must not accidentally make fail-closed detection
   MORE permissive than before).

## Acceptance Criteria

- [x] `_parseAgentJson()` is real, wired at all three call sites, in both
  `.claude/workflows/prepare-milestone.js` and the byte-identical `plugin/workflows/` mirror
  (`cmp`, zero output).
- [x] Confirmed via direct source read: all three `JSON.parse(result.raw)` call sites in
  `prepare-milestone.js` (Admission, Preflight-content, Preflight-plan verdicts) now call
  `_parseAgentJson(raw)`, which extracts the first balanced `{...}` object span rather than
  assuming `raw` is JSON verbatim.
- [x] A new regression test confirms a noisy raw (real Node-warning-shaped prefix, including the
  bracket-shaped `[MODULE_TYPELESS_PACKAGE_JSON]` substring that broke a first naive fix attempt)
  parses correctly at both the Admission and Preflight-content call sites, and ProposalAuthors
  dispatches normally afterward (proving neither phase failed closed). Full suite:
  `plugin/test/prepare-milestone-convergence.test.mjs` 32/32 pass.
- [x] No regression: the existing "Admission-phase error (malformed CLI output) fails closed"
  test (`'not valid json {{{'`) still passes — fail-closed behavior on genuinely malformed input is
  unchanged.
- [x] `plugin/test/prepare-milestone-preparation-e2e.test.mjs` (2/2) and
  `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` (61/61, unaffected file,
  sanity check) stay green.
- [x] **Grounding evidence (exhaustive identifiers, wiring-coverage completeness):** confirmed real
  via direct source read — all three `JSON.parse(result.raw)` sites in `prepare-milestone.js` now
  call `_parseAgentJson(result.raw)`, which extracts the first balanced `{...}` span rather than
  assuming the whole string is JSON.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/prepare-milestone.js`, the control-plane script every future milestone's
  Prepare stage runs through).
- [x] Real, non-fixture evidence: M202/DIR-126-C's own real cold `prepare-milestone` dispatch hit
  this exact defect live; the fix is verified against the exact noisy-raw shape that dispatch
  produced, not a synthetic guess.

## Touches

- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- plugin/test/prepare-milestone-convergence.test.mjs
