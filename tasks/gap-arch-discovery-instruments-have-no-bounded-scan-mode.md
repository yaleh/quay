---
id: gap-arch-discovery-instruments-have-no-bounded-scan-mode
title: "arch-discovery instruments only run as a one-off pre/post experiment: no
  bounded periodic scan mode, unstable finding identity, output dir not
  gitignored"
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
`docs/analysis/arch-discovery-space.mjs` and `docs/analysis/arch-discovery-time.mjs` landed via the done task `gap-architecture-discovery-shadow-space-and-time-not-in-repo`. I re-ran both independently on 2026-10-11 in a worktree pinned at develop `15478f9f3`, and they reproduce:
- **space:** TP 3, FP 0, FN 0, TN 1, 2 abstains; the validator accepted 154 records and refused 0; 4.1 s; 134 git calls.
- **time:** B1 `prediction-held`, B2 `split`, B3 0, B4 red/green = 1.01 (`not-red-specific`), B5 enrichment 26.86; the validator accepted 57 and refused 0; 6.0 s.
- **independent control:** I injected one reaper red after the located change and B1 flipped to `refuted`; injecting the same red before the change kept it at `prediction-held`.

Both tools are shaped as a single experiment, so they cannot run periodically yet:
- **Space needs `--pre`/`--post` plus labels.** A periodic scan has neither; it needs to score the current HEAD alone and run with no labels.
- **Time hardcodes its windows.** `arch-discovery-time.mjs` hardcodes the journal window `--since 2026-09-18` (around `:150`) and `DEFAULT_CUT` (`:33`). B1 is a single prediction for one case.
  - It reads whole carriers into memory. `.quay/gate-events.jsonl` is 144 MB today.
  - It has no wall-time or record cap.
- **Finding identity is not stable across runs.** `subject_key` is stable, but nothing derives a fingerprint that excludes `ts` and fixes the order of (subject_key, verdict, evidence sha256s). So two identical runs cannot be deduplicated.
- **Default output dir is not gitignored.** Both tools default `--out` to `.quay/arch-discovery-shadow/`. `git check-ignore` reports nothing for that path, so every default run leaves untracked files in the shared checkout.

## Plan
1. Add `--scan` mode to both tools.
   - **Space `--scan`:** pre = post = `--rev` (default HEAD); no labels; candidates come from the checker at that rev.
   - **Time `--scan`:** reads only events inside `--since <iso>` (required in scan mode; there is no hardcoded date); the journal is read with the same window. B1 is skipped in scan mode, with an explicit `not-applicable` and the reason. Grouping, recurrence, the file-only/cross-file counterexamples, the B4 green control, and B5 all run inside the window.
2. Bounds, enforced inside the tool. Each one, when hit, makes the tool exit with a distinct non-zero code and append nothing. This is fail-closed: never a partial output.
   - `--max-ms`: wall-time budget.
   - `--max-records`: output cap.
   - `--max-candidates` / `--max-groups`.
   - Stream jsonl carriers line by line instead of `readFileSync` of the whole file.
3. Finding fingerprint: `finding_fp = sha256(subject_key + verdict + sorted evidence sha256s)`, excluding every `ts`, written on each outcome and counterexample record. Two runs on the same inputs must produce identical `finding_fp` sets.
4. Move the default `--out` to a gitignored path, and add the ignore rule to `.gitignore` if needed. Paste the `git check-ignore -v` output.

## Acceptance Criteria
- [ ] `node --test plugin/test/arch-discovery-space.test.mjs plugin/test/arch-discovery-time.test.mjs` exits 0, with new cases covering:
  - (a) two `--scan` runs on the same fixture give identical `finding_fp` sets;
  - (b) each bound (`--max-ms`, `--max-records`, `--max-candidates`/`--max-groups`) exits with its own code and leaves the out file byte-identical;
  - (c) time `--scan` without `--since` is refused;
  - (d) B1 reports `not-applicable` in scan mode.
- [ ] Real-data scan, space: `node --experimental-strip-types docs/analysis/arch-discovery-space.mjs --scan --root /data/home/yale/work/quay --out <tmp>`. Paste the per-candidate verdict table, wall ms, and the validator tally. Refused must be 0.
- [ ] Real-data scan, time: `node docs/analysis/arch-discovery-time.mjs --scan --since <now-7d> --root /data/home/yale/work/quay --out <tmp>`. Paste the group count, recurrent groups, counterexample counts, B4 red/green, B5 enrichment, wall ms, and peak RSS (`/usr/bin/time -v`).
- [ ] Determinism on real data: run the time scan twice back to back with the same `--since`, then `diff` the sorted `finding_fp` lists. Paste the diff; it must be empty. If a live carrier grew in between, say so and pin `--until` as well.
- [ ] `git check-ignore -v <default out path>` prints a matching rule.
- [ ] The experiment mode is unchanged: `--pre c010f023a --post 15478f9f3` still gives TP 3, FP 0, FN 0, and the reaper B1 run still gives `prediction-held`. Paste both outputs.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-arch-discovery-instruments-have-no-bounded-scan-mode` green.

## Touches
- tasks/gap-arch-discovery-instruments-have-no-bounded-scan-mode.md
- docs/analysis/arch-discovery-space.mjs
- docs/analysis/arch-discovery-time.mjs
- plugin/test/arch-discovery-space.test.mjs
- plugin/test/arch-discovery-time.test.mjs
- .gitignore
