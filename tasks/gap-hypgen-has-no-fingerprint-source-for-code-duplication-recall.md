---
id: gap-hypgen-has-no-fingerprint-source-for-code-duplication-recall
title: "arch-hypothesis-generation: no mechanical fingerprint source
  (AST-normalized body / call structure) can feed clusters into verify/match
  under the same pre-registration"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-hypgen-model-identity-and-token-cost-are-not-measured
---
## Proposal
Track F of the next experiment recalls duplicated logic MECHANICALLY at a pinned commit. The same independent verifier (supported / refuted / intentional) and the same scoring then separate four outcomes:
- true duplicate authority;
- intentional separation;
- shared implementation;
- different contracts behind the same name.

Today this is impossible. `verify` / `match` only accept investigator run files whose recorded `prompt_sha256` must equal sha256(prompt bytes + inventory bytes) (`runPromptRefusal`), so a cluster that comes from a fingerprint, not a prompt, can never pass the pre-registration gate.

**Measured feasibility (2026-10-12, exploratory, at pin `e3163e519`; NOT an experiment reading):**
- ArchGuard 0.1.40's `detect_duplicates` (MCP tool `archguard_detect_duplicates`; identifiers and literals normalized; exact structural clones of function bodies) runs on a stripped pinned tree after `archguard analyze -s plugin/scripts --lang typescript -f json --diagrams package` (5.4 s, 1.4 GB peak).
- With `minStatements 2, minTokens 20` it reported 54 groups over 283 files / 7310 functions.
- The archguard CLI has no `duplicates` subcommand. The implementation is `dist/analysis/duplicates/group.js` in the archguard package (`/data/home/yale/.claude/plugins/npm-cache/node_modules/@yalehwang/archguard`).
- That package also ships `typescript` 5.9.3 with a working `createSourceFile`. The repo's own `typescript` is 7.0.2, which has no JS AST API.

## Plan
1. **New verb `fingerprint`.**
   - Inputs: `--pin-dir <stripped pinned tree> --archguard-root <dir>`, plus thresholds `--min-statements`, `--min-tokens`.
   - **Arm `exact`:** run ArchGuard's duplicate grouping. Use the package's exported API if one exists, else the MCP tool through a stdio client, else report `not-evaluated`. Never re-implement the hashing.
   - **Arm `callshape`:** for each function in scope, a call-structure fingerprint computed with the archguard-shipped `typescript` (resolved from `--archguard-root`): the ordered list of callee names plus control-flow node kinds, with identifiers of locals normalized. Group equal fingerprints across ≥2 files.
   - If the parser cannot be resolved, `callshape` is `not-evaluated` with the reason. It never silently returns zero groups.
2. **Output.** Write each group as a hypothesis-shaped record into a run file:
   - `components` = member files, `concept_kind: "identity"`, `claim` = a TEMPLATED neutral sentence naming members and line ranges;
   - `fingerprint_source`: `exact` or `callshape`;
   - `source_digest` = sha256 of (verb inputs + raw grouping output), stored in place of `prompt_sha256`.
3. **Pre-registration.** `verify` / `match` / `review` accept fingerprint runs when the prereg holds `hashes["fingerprint-<arm>"]` equal to the run's `source_digest` and `--arm` names that arm. A missing key ⇒ refuse (no fallback).
4. **No new verifier and no new scoring.** Fingerprint clusters go through the existing `verify` (both strategies) and `match` unchanged.

## Acceptance Criteria
- [ ] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0, with new cases:
  - (a) `fingerprint` on a fixture with two byte-identical function bodies in two files emits one group with both files.
  - (b) It does NOT group two functions with the same name but different bodies.
  - (c) `callshape` groups two bodies that differ only in local variable names and literals.
  - (d) An unresolvable archguard root gives `not-evaluated`, never zero groups.
  - (e) `match --arm X` refuses a fingerprint run whose `source_digest` differs from `hashes["fingerprint-X"]`.
- [ ] Real run on a stripped tree of pin `e3163e519`, with `--min-statements 2 --min-tokens 20`. Paste the `exact` group count and the `callshape` group count. The `exact` count must equal the MCP tool's 54 at the same thresholds; if it differs, explain why.
- [ ] Mutation control: make `exact` drop its `minTokens` filter and show the group count changes. Paste both counts, then revert.

## Definition of Done
- All AC ticked with outputs pasted.
- `scripts/test.sh --for-task gap-hypgen-has-no-fingerprint-source-for-code-duplication-recall` green.
- Frozen prompt files are unchanged.

## Touches
- tasks/gap-hypgen-has-no-fingerprint-source-for-code-duplication-recall.md
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/arch-hypothesis-generation.test.mjs
