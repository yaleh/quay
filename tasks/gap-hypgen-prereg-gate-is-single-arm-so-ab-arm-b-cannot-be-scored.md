---
id: gap-hypgen-prereg-gate-is-single-arm-so-ab-arm-b-cannot-be-scored
title: "arch-hypothesis-generation: the pre-registration gate only knows
  single-arm keys, so arm B of a pre-registered A/B experiment is refused by
  match/verify/review"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
---
## Proposal
On 2026-10-12 the pre-registered A/B experiment `E-HYPGEN-AB-1` ran. Its pre-registration is `/data/home/yale/work/quay-scratch/ab1/prereg.json`, sha256 `d4c3ba26d6c4b4470b681f1ab28dace0df17c9708b47f5d5aa410d40a32fcd19`. It is read-only and was written before every run. Besides the single-arm keys, it records arm-scoped hashes: `prompt-investigator-A/-B`, `inventory-A/-B`.

The tool was `docs/analysis/arch-hypothesis-generation.mjs` at `a827a1300`. Arm A (neutral inventory + frozen prompt) was matched and verified normally. Arm B (provenance inventory + its own prompt) was refused by both steps. No model call was made, and the run files were intact:
- `match ... --inventory inventory-provenance.txt --investigator-prompt prompt-B.txt --prereg prereg.json` printed `PREREG_HASH_MISMATCH:prompt-investigator, PREREG_HASH_MISMATCH:inventory`.
- `verify` with the same inputs exited 4 with the same reasons.

The cause: `expectedFromArtifacts` (around line 1342) always returns the fixed keys `prompt-investigator` / `inventory`. `runPromptRefusal`'s `expectedPromptSha` reads `expected["prompt-investigator"]` (around line 1038). The help text says "A provenance run needs its OWN prompt file + pre-registration", yet one pre-registration cannot cover two arms. A post-hoc second pre-registration would violate the rule that the prereg must be older than the runs. So arm B of a correctly pre-registered A/B experiment cannot be scored at all.

## Plan
- Add an optional `--arm <id>` to `match`, `verify` and `review`, where `<id>` matches `[A-Za-z0-9]+`. With `--arm X`, the gate compares the supplied prompt and inventory bytes against `hashes["prompt-investigator-X"]` and `hashes["inventory-X"]`. `runPromptRefusal`'s `expectedPromptSha` uses the arm-scoped prompt key.
- An arm key that is absent from the pre-registration gives its own refusal, `PREREG_HASH_ABSENT:prompt-investigator-X`. It is never a fallback to the unscoped key.
- Without `--arm`, behaviour is byte-identical to today.
- Do not change the mtime rule or any other gate.

## Acceptance Criteria
- [ ] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0, with new cases:
  - (a) With `--arm B` and a pre-registration holding `-B` keys that match the supplied bytes, the gate passes.
  - (b) With `--arm B` and a pre-registration lacking `-B` keys, the gate refuses with `PREREG_HASH_ABSENT:prompt-investigator-B`. It does not fall back to the unscoped keys.
  - (c) With `--arm B`, a run whose recorded prompt digest does not match the B bytes is refused.
  - (d) Without `--arm`, an existing single-arm fixture behaves exactly as before.
- [ ] Real reproduction on the frozen artifacts in `/data/home/yale/work/quay-scratch/ab1/`, without modifying any of them. Paste the outputs:
  - First run `sha256sum prereg.json`; it must still equal `d4c3ba26…`.
  - `match --runs runs-B --labels labels-ab-sealed.json --prereg prereg.json --inventory inventory-provenance.txt --investigator-prompt prompt-B.txt --run-count 3 --arm B --out <tmp>` exits 0.
  - The same command with `--arm A` refuses with a hash mismatch (negative control).
- [ ] Mutation control: make `--arm` fall back to the unscoped keys when the arm key is absent, and show case (b) goes red. Paste the output, then revert.

## Definition of Done
- All AC ticked with outputs pasted.
- `scripts/test.sh --for-task gap-hypgen-prereg-gate-is-single-arm-so-ab-arm-b-cannot-be-scored` green.
- No file under `/data/home/yale/work/quay-scratch/ab1/` modified.

## Touches
- tasks/gap-hypgen-prereg-gate-is-single-arm-so-ab-arm-b-cannot-be-scored.md
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/arch-hypothesis-generation.test.mjs
