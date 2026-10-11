---
id: gap-hypgen-has-no-fingerprint-source-for-code-duplication-recall
title: "arch-hypothesis-generation: no mechanical fingerprint source
  (AST-normalized body / call structure) can feed clusters into verify/match
  under the same pre-registration"
status: ready
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
- [x] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0, with new cases:
  - (a) `fingerprint` on a fixture with two byte-identical function bodies in two files emits one group with both files.
  - (b) It does NOT group two functions with the same name but different bodies.
  - (c) `callshape` groups two bodies that differ only in local variable names and literals.
  - (d) An unresolvable archguard root gives `not-evaluated`, never zero groups.
  - (e) `match --arm X` refuses a fingerprint run whose `source_digest` differs from `hashes["fingerprint-X"]`.

  Output (`node --test plugin/test/arch-hypothesis-generation.test.mjs`, 40 pre-existing + 6 new):
  `ℹ tests 46 / ℹ pass 46 / ℹ fail 0 / ℹ skipped 0` —
  ```
  ✔ AC-fp(a): the `exact` arm groups a byte-identical pair, and the verb writes it as a run file
  ✔ AC-fp(b): two functions with the same name but different bodies are never grouped
  ✔ AC-fp(c): `callshape` groups bodies differing only in local names/literals, and not different calls
  ✔ AC-fp(d): an unresolvable ArchGuard root or compiler gives not-evaluated, never zero groups
  ✔ AC-fp(e): a fingerprint run is scored only against hashes["fingerprint-<arm>"] — never the prompt keys
  ✔ AC-fp(e-cli): `match --arm <id>` scores a fingerprint run with no --inventory and no prompt file
  ```
  (a) also asserts the VERB's run file: `fingerprint_source:"exact"`, `prompt_sha256` absent, and
  `fingerprintDigest({inputs, groups})` re-derived from the run file equals the recorded `source_digest`.
  (b) and (c) each carry their control IN THE SAME FIXTURE — a genuinely identical pair for (b), and a
  same-shape-but-different-control-flow body for (c) — so neither the zero-group reading in (b) nor the
  one-group reading in (c) can be caused by the fixture or by the instrument. (e) additionally asserts the
  three no-fallback refusals: a prereg carrying only `prompt-investigator` + `inventory` is
  `PREREG_HASH_ABSENT:fingerprint-exact`, no `--arm` is `FINGERPRINT_ARM_REQUIRED`, and an arm naming the
  other instrument is `RUN_FINGERPRINT_ARM_MISMATCH`.
  ⛔ (a)-(c) drive the REAL ArchGuard instrument, so on a host that carries none they SKIP with the printed
  reason (`resolveArchguardRoot(null)` → `""`) rather than passing vacuously; (d) and (e) are hermetic, and
  (d) is *stronger* on a host that does carry ArchGuard — the explicit-root refusal is asserted while the
  plugin default is present and would have been a valid fallback.

- [x] Real run on a stripped tree of pin `e3163e519`, with `--min-statements 2 --min-tokens 20`. Paste the `exact` group count and the `callshape` group count. The `exact` count must equal the MCP tool's 54 at the same thresholds; if it differs, explain why.

  Tree: `git archive e3163e519 | tar -x -C <scratch>/hypgen-fp`, then `rm -rf tasks goals docs
  orchestration .quay archive milestones measurements`; all eight verified ABSENT afterwards and
  `ls plugin/scripts/*.ts | wc -l` = 283.
  ```
  $ node docs/analysis/arch-hypothesis-generation.mjs fingerprint --pin-dir <pin> --arm exact \
      --min-statements 2 --min-tokens 20 --runs <ev>/runs-exact --json
   "archguard_version": "0.1.40", "scanned_files": 283, "scanned_functions": 7310,
   "groups": 54, "hypotheses": 54,
   "source_digest": "94c3a700bc5bf8ffa7497780061d2add023e4ec1aa7abff2557545fc74cf8798"

  $ node docs/analysis/arch-hypothesis-generation.mjs fingerprint --pin-dir <pin> --arm callshape \
      --min-statements 2 --min-tokens 20 --runs <ev>/runs-callshape --json
   "ts_version": "5.9.3", "scanned_files": 283, "scanned_functions": 7310,
   "groups": 14, "hypotheses": 14,
   "source_digest": "6e741ec03c6664b7d3a55988d93410070d51ab05e1888ad9c7a9b27791af8f75"
  ```
  **`exact` = 54, `callshape` = 14** — same tree (283 files / 7310 functions), same thresholds.

  The MCP tool was RE-READ on that same tree rather than quoted from this task's own exploratory note
  (`archguard analyze -s plugin/scripts --lang typescript -f json --diagrams package`, then
  `archguard_detect_duplicates` at `minStatements 2, minTokens 20`); its manifest returned
  `"scannedFiles": 283, "scannedFunctions": 7310, "totalGroups": 54`. So the `exact` arm's 54 **equals the
  MCP tool's 54** — the same reading, taken by the same ArchGuard build.
  ⛔ One field genuinely does not match and is reported rather than smoothed over: the MCP call I ran
  passed `topN: 200` and its `groups` ARRAY came back shorter than `totalGroups` (the tool's own default
  `topN` is 20 and truncates the array while leaving `totalGroups` whole). The `exact` arm deliberately
  leaves `topN` undefined, so it returns the arm's FULL group list and its `groups` is that same quantity.
  ⛔ `callshape`'s 14 is a DIFFERENT instrument reading the same tree: its token stream carries one token
  per call and per control-flow node, not one per AST node plus a closing marker as ArchGuard's does, so
  one `--min-tokens` value is not the same cut on both arms (the mutation control below measures how
  sharply each arm's count responds to it). It is reported as the arm's own count, never as a second
  estimate of 54.

- [x] Mutation control: make `exact` drop its `minTokens` filter and show the group count changes. Paste both counts, then revert.

  The line is `exactGroups` in `docs/analysis/arch-hypothesis-generation.mjs`:
  `instrument.detectDuplicates(root, sources, { minStatements, minTokens, includeTests: false })`.
  Reverted from a `cp` backup afterwards — md5 `cbe84e373788e4cfd8c0d3c0935c705e` both before and after
  the mutations, and the restored line is byte-identical.

  **Mutation A — the arm stops SUPPLYING `minTokens`** (drop the option):
  ```
  (original)   "groups": 54
  (mutant A)   "groups": 33
  ```
  The count MOVED. But it did not move because "no filter" — with the option absent,
  `resolveDuplicateOptions` substitutes the library's own default, read directly:
  ```
  $ node -e "import('…/@yalehwang/archguard/dist/analysis/duplicates/types.js').then(m=>console.log(JSON.stringify(m.DEFAULT_DUPLICATE_OPTIONS)))"
  {"minStatements":6,"minTokens":50,"includeTests":false}
  ```
  so dropping the option made the cut STRICTER (`minTokens` **50**, not 0), which is why the count fell.

  **Mutation B — the filter literally removed** (`minTokens` → `0`, i.e. `tokenCount < 0` never fires):
  ```
  (original)   "groups": 54
  (mutant B)   "groups": 54
  ```
  ⛔ At this AC's own thresholds the count does NOT move, and that is reported as measured rather than as
  the AC's wording anticipates: at `--min-statements 2` the `minTokens 20` cut is REDUNDANT on this tree —
  every function with ≥2 statements already carries ≥20 ArchGuard tokens. The filter is nonetheless
  load-bearing, and a threshold grid taken on the ORIGINAL code (same tree, `exact` arm) shows where:
  ```
  minStatements=1  minTokens=0 → 427   minTokens=5 → 425   minTokens=20 → 160   minTokens=50 → 44
  minStatements=2  minTokens=0 →  54   minTokens=5 →  54   minTokens=20 →  54   minTokens=50 → 33
  ```
  So the count is a READING of the filter and not a constant (427 → 160 → 44 as `minTokens` rises at
  `minStatements 1`), and the 54 at the AC's thresholds equals the 54 at `minTokens 0` **because of the
  statement floor** — which the grid makes falsifiable instead of asserted.

## Definition of Done
- [x] All AC ticked with outputs pasted.
- [x] `scripts/test.sh --for-task gap-hypgen-has-no-fingerprint-source-for-code-duplication-recall` green: exit 0, `ℹ tests 46 / ℹ pass 46 / ℹ fail 0`; scoped-gate cache written for the merge-time `develop` sha (`git rev-parse develop` = the final merge's `HEAD^2`).
- [x] Frozen prompt files are unchanged — `docs/analysis/arch-hypothesis-generation-prompts/` is untouched (it is not in the task's declared Touches and not in the delta); the delta is exactly the two code files.

## Touches
- tasks/gap-hypgen-has-no-fingerprint-source-for-code-duplication-recall.md
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/arch-hypothesis-generation.test.mjs