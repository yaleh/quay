---
id: gap-hypgen-prereg-gate-is-single-arm-so-ab-arm-b-cannot-be-scored
title: "arch-hypothesis-generation: the pre-registration gate only knows
  single-arm keys, so arm B of a pre-registered A/B experiment is refused by
  match/verify/review"
status: done
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
- [x] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0, with new cases:
  - (a) With `--arm B` and a pre-registration holding `-B` keys that match the supplied bytes, the gate passes.
  - (b) With `--arm B` and a pre-registration lacking `-B` keys, the gate refuses with `PREREG_HASH_ABSENT:prompt-investigator-B`. It does not fall back to the unscoped keys.
  - (c) With `--arm B`, a run whose recorded prompt digest does not match the B bytes is refused.
  - (d) Without `--arm`, an existing single-arm fixture behaves exactly as before.
  ```
  $ node --test plugin/test/arch-hypothesis-generation.test.mjs
  ✔ AC-arm(a): --arm B scores when the prereg records the matching -B keys
  ✔ AC-arm(b): --arm B with no -B key refuses as ABSENT and never falls back to the unscoped keys
  ✔ AC-arm(c): --arm B refuses a run whose recorded prompt identity is not the B one
  ✔ AC-arm(d): without --arm the round-1 single-arm keys are unchanged
  ✔ AC-arm(e): the --arm id vocabulary admits only [A-Za-z0-9]+
  ℹ tests 34
  ℹ pass 34
  ℹ fail 0
  ```
  (e) is an added case: `ARM_ID_RE` admits only `[A-Za-z0-9]+`, so a rejected id can never become a key suffix.
- [x] Real reproduction on the frozen artifacts in `/data/home/yale/work/quay-scratch/ab1/`, without modifying any of them. Paste the outputs:
  - First run `sha256sum prereg.json`; it must still equal `d4c3ba26…`.
  - `match --runs runs-B --labels labels-ab-sealed.json --prereg prereg.json --inventory inventory-provenance.txt --investigator-prompt prompt-B.txt --run-count 3 --arm B --out <tmp>` exits 0.
  - The same command with `--arm A` refuses with a hash mismatch (negative control).
  ```
  $ sha256sum /data/home/yale/work/quay-scratch/ab1/prereg.json
  d4c3ba26d6c4b4470b681f1ab28dace0df17c9708b47f5d5aa410d40a32fcd19  /data/home/yale/work/quay-scratch/ab1/prereg.json
  (== prereg.sha256, written with the prereg)

  $ node docs/analysis/arch-hypothesis-generation.mjs match \
      --runs /data/home/yale/work/quay-scratch/ab1/runs-B \
      --labels /data/home/yale/work/quay-scratch/ab1/labels-ab-sealed.json \
      --prereg /data/home/yale/work/quay-scratch/ab1/prereg.json \
      --inventory /data/home/yale/work/quay-scratch/ab1/inventory-provenance.txt \
      --investigator-prompt /data/home/yale/work/quay-scratch/ab1/prompt-B.txt \
      --run-count 3 --arm B --out <tmp>/mechanical-matches-B.json --out-dir <tmp>
  {"matches":4,"by_case":{…},"validator":{"accepted":8,"refused":0}}
  EXIT=0

  $ (same command, --arm A)                                   # negative control
  arch-hypothesis-generation match: PREREG_HASH_MISMATCH:prompt-investigator-A, PREREG_HASH_MISMATCH:inventory-A
  EXIT=4
  ```
  Both `verify` arms of the same change, on the same artifacts (a bogus pin-dir so the refusal comes from a LATER
  cause than the prereg gate — exit 3 ≠ 4 is the evidence the gate PASSED for `--arm B`):
  ```
  $ node docs/analysis/arch-hypothesis-generation.mjs verify --pin-dir <tmp>/nonexistent --runs …/runs-B … --arm B
  arch-hypothesis-generation verify: CWD_NOT_STRIPPED_PIN
  EXIT=3
  $ (same, --arm A)
  arch-hypothesis-generation verify: PREREG_HASH_MISMATCH:prompt-investigator-A, PREREG_HASH_MISMATCH:inventory-A
  EXIT=4
  $ (match, --arm "B-1")                                      # id outside the vocabulary
  arch-hypothesis-generation match: --arm must match ^[A-Za-z0-9]+$, got "B-1"
  EXIT=2
  ```
  Default path unchanged on the real artifacts (no `--arm`, arm A):
  ```
  $ node docs/analysis/arch-hypothesis-generation.mjs match --runs …/runs-A --labels …/labels-ab-sealed.json \
      --prereg …/prereg.json --inventory …/inventory-neutral.txt --investigator-prompt …/prompt-A.txt --run-count 3
  {"matches":10,…,"validator":{"accepted":20,"refused":0}}
  EXIT=0
  ```
  Frozen artifacts untouched (nothing written after the last pre-existing mtime, 01:34):
  ```
  $ find /data/home/yale/work/quay-scratch/ab1 -newermt "2026-10-12 01:34"
  (no output)
  ```
- [x] Mutation control: make `--arm` fall back to the unscoped keys when the arm key is absent, and show case (b) goes red. Paste the output, then revert.
  ```
  mutation (temporary, in preregRefusal):
      const base = k.replace(/-[A-Za-z0-9]+$/, "");
      const hk = hashes[k] !== undefined ? k : (base !== k && hashes[base] !== undefined ? base : k);
      if (hashes[hk] === undefined) reasons.push(`PREREG_HASH_ABSENT:${k}`);
      else if (hashes[hk] !== v) reasons.push(`PREREG_HASH_MISMATCH:${k}`);

  $ node --test --test-name-pattern="AC-arm" plugin/test/arch-hypothesis-generation.test.mjs
  ✔ AC-arm(a): --arm B scores when the prereg records the matching -B keys
  ✖ AC-arm(b): --arm B with no -B key refuses as ABSENT and never falls back to the unscoped keys
  ✔ AC-arm(c): --arm B refuses a run whose recorded prompt identity is not the B one
  ✖ AC-arm(d): without --arm the round-1 single-arm keys are unchanged
  ✔ AC-arm(e): the --arm id vocabulary admits only [A-Za-z0-9]+
  ℹ tests 5   ℹ pass 3   ℹ fail 2
    AC-arm(b): actual: [ 'PREREG_HASH_MISMATCH:prompt-investigator-B', 'PREREG_HASH_MISMATCH:inventory-B' ]
               expected: [ 'PREREG_HASH_ABSENT:prompt-investigator-B', 'PREREG_HASH_ABSENT:inventory-B' ]
  (AC-arm(d) flips too: the fallback found the unscoped key and scored, so the `--arm B`-on-single-arm refusal vanished.)

  revert: cp backup over the tool → md5 7a7b41c8bf85cb281e83729a9ade0ed4 (identical to the pre-mutation backup),
          `grep -c "MUTATION CONTROL"` = 0; post-revert `node --test` = ℹ tests 34 / ℹ pass 34 / ℹ fail 0.
  ```

## Definition of Done
- All AC ticked with outputs pasted.
- `scripts/test.sh --for-task gap-hypgen-prereg-gate-is-single-arm-so-ab-arm-b-cannot-be-scored` green.
- No file under `/data/home/yale/work/quay-scratch/ab1/` modified.

## Touches
- tasks/gap-hypgen-prereg-gate-is-single-arm-so-ab-arm-b-cannot-be-scored.md
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/arch-hypothesis-generation.test.mjs
